import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { blankApplication } = await import("../src/lib/application-model.ts");
const { blankBorrower } = await import("../src/lib/urla.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { mockCreditAusRuns, runMockCreditAus } = await import("../src/lib/mock-credit-aus.ts");
const { readIncomingLoanWorkPage } = await import("../src/lib/incoming-loan-work.ts");
const { readActionCounts } = await import("../src/lib/workspace-action-counts.ts");
const { countFileExceptions, readFileExceptions, nameFileExceptions } = await import("../src/lib/file-exceptions.ts");
const { classifyUnderwritingLookup } = await import("../src/lib/underwriting-lookup.ts");

const loanId = "fictional-aus-loan";
const at = "2026-11-09T17:00:00.000Z";
const officer = { name: "Fictional Officer", email: "officer@example.test", brokerage: { id: "fictional", role: "LO", pilot: true } };

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  insertContact(db, { id: "sample-borrower", name: "Fictional Borrower", email: "sample@example.test", phone: "", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId: "sample-borrower", partnerId: null, officer: officer.name, officerEmail: officer.email,
    stage: "Underwriting", stageSince: at, address: "", amount: 250000, purpose: "Purchase" });
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, revision, updatedAt, submittedAt)
    VALUES (?, ?, ?, ?, 3, ?, ?)`).run(loanId, randomUUID(), at, JSON.stringify(blankApplication()), at, at);
  const send = (input, staff = officer) => executeCommand(db, { loanId, ...input }, staff, undefined, [], { scopedLoanUpdates: true });
  const read = () => mockCreditAusRuns(db, loanId);
  return { db, send, read };
}

function pair(creditId, revision = 3) {
  return { type: "runMockPairedAus", loanId, batchId: randomUUID(), creditId, applicationRevision: revision, orders: {
    DU: { attemptId: randomUUID(), previousId: null, scenario: "review" },
    LPA: { attemptId: randomUUID(), previousId: null, scenario: "failure" },
  } };
}

async function orderCredit(send) {
  const attemptId = randomUUID();
  const credit = { type: "runMockCredit", attemptId, previousId: null, authorized: true, scenario: "ready", applicationRevision: 3 };
  assert.match((await send({ ...credit, authorized: false })).error, /true/i);
  const result = await send(credit);
  const report = result.loanWork.mockCreditAusRuns[0];
  assert.equal(report.id, attemptId);
  assert.equal(report.applicationRevision, 3);
  assert.equal(report.authorization.recordedBy, officer.email);
  assert.match(report.authorization.reference, /^MOCK-AUTH-/);
  return report;
}

test("paired mock AUS retains independent findings, retry and current 1003 evidence", async (t) => {
  const { db, send, read } = fixture(t);
  assert.match((await send(pair(randomUUID()))).error, /authorized mock credit/i);
  const report = await orderCredit(send);
  const command = pair(report.id);
  const unrelated = { ...officer, email: "other@example.test" };
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  assert.match((await send(command, unrelated)).error, /access/i);
  assert.match((await send(command, processor)).error, /access/i);
  assert.match((await send({ ...command, applicationRevision: 2 })).error, /1003 changed/i);
  assert.match((await send({ ...command, orders: { ...command.orders, LPA: { ...command.orders.LPA, previousId: randomUUID() } } })).error, /newer request/i);
  assert.equal(read().length, 1);

  const { loanWork } = await send(command);
  const du = loanWork.mockCreditAusRuns.find(({ service }) => service === "DU");
  const lpa = loanWork.mockCreditAusRuns.find(({ service }) => service === "LPA");
  assert.equal(du.result.recommendation, "Review required");
  assert.equal(lpa.result.status, "Failed");
  assert.notEqual(du.reference, lpa.reference);
  for (const order of [du, lpa]) {
    assert.equal(order.batchId, command.batchId);
    assert.equal(order.creditId, report.id);
    assert.equal(order.applicationRevision, 3);
  }
  const retry = { type: "retryMockCreditAus", service: "LPA", attemptId: randomUUID(), previousId: lpa.id, applicationRevision: 3 };
  assert.match((await send({ ...retry, service: "DU", previousId: du.id })).error, /latest failed/i);
  const retried = (await send(retry)).loanWork.mockCreditAusRuns[0];
  assert.equal(retried.result.status, "Findings ready");
  assert.equal(retried.retryOf, lpa.id);
  assert.equal(retried.batchId, command.batchId);
  assert.equal(retried.creditId, report.id);
  assert.notEqual(retried.reference, lpa.reference);
  assert.deepEqual(read().find(({ service }) => service === "DU"), du);
  assert.match((await send(retry)).message, /already/i);
  assert.match((await send(command)).message, /already/i);
  assert.match((await send({ ...command, creditId: randomUUID() })).error, /refresh/i);
  assert.equal(read().length, 4);

  const more = pair(report.id);
  more.orders.DU.previousId = du.id;
  more.orders.DU.scenario = "failure";
  more.orders.LPA.previousId = retried.id;
  assert.ok((await send(more)).loanWork);
  db.prepare("UPDATE applications SET revision = 4, submittedAt = NULL WHERE loanId = ?").run(loanId);
  assert.match((await send({ ...retry, attemptId: randomUUID(), previousId: more.orders.LPA.attemptId, applicationRevision: null })).error, /1003 changed/i);
  db.prepare("UPDATE applications SET revision = 5, submittedAt = ? WHERE loanId = ?").run(at, loanId);
  assert.match((await send(pair(report.id, 5))).error, /authorized mock credit/i);
  assert.equal(read().length, 6);
});

test("paired mock AUS rolls back both orders when persistence is interrupted", async (t) => {
  const { db, send, read } = fixture(t);
  const credit = await orderCredit(send);
  const command = pair(credit.id);
  const historyCount = () => Number(db.prepare("SELECT COUNT(*) AS count FROM activity WHERE loanId = ?").get(loanId).count);
  const before = historyCount();
  db.exec(`CREATE TRIGGER reject_sample_lpa BEFORE INSERT ON mock_credit_aus_runs
    WHEN NEW.service = 'LPA' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`);
  assert.throws(() => db.transaction(() => runMockCreditAus(db, command, officer, at)), /simulated write failure/);
  assert.deepEqual(read().map(({ service }) => service), ["Credit"]);
  assert.equal(historyCount(), before);
  db.exec("DROP TRIGGER reject_sample_lpa");
  assert.ok((await send(command)).loanWork);
  assert.equal(historyCount(), before + 2);
});

test("joint credit evidence binds both applicants and checks uncertain results without another order", async (t) => {
  const { db, send, read } = fixture(t);
  const draft = blankApplication();
  draft.urla.credit.fields.type = "Joint";
  draft.urla.additional.push(blankBorrower());
  db.prepare("UPDATE applications SET draft = ? WHERE loanId = ?").run(JSON.stringify(draft), loanId);
  const primary = await orderCredit(send);
  assert.equal(primary.borrowerCount, 1);
  assert.match((await send(pair(primary.id))).error, /authorized mock credit/i);
  const joint = { type: "runMockCredit", attemptId: randomUUID(), previousId: primary.id, authorized: true,
    borrowers: "all", scenario: "uncertain", applicationRevision: 3 };
  assert.match((await send(joint)).message, /check the original/i);
  const pending = read()[0];
  assert.equal(pending.borrowerCount, 2);
  assert.equal(pending.result.status, "Awaiting confirmation");
  assert.match((await send(joint)).message, /already/i);
  assert.match((await send({ ...joint, attemptId: randomUUID(), previousId: pending.id })).error, /check the original/i);
  const check = { type: "reconcileMockCreditAus", attemptId: pending.id };
  const unrelated = { ...officer, email: "other@example.test" };
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  assert.match((await send(check, unrelated)).error, /access/i);
  assert.match((await send(check, processor)).error, /access/i);
  assert.match((await send({ ...check, attemptId: randomUUID() })).error, /unavailable/i);
  assert.match((await send(check)).message, /confirmed/i);
  assert.match((await send(check)).message, /already/i);
  const report = read()[0];
  assert.equal(report.id, pending.id);
  assert.equal(report.reference, pending.reference);
  assert.deepEqual(report.authorization, pending.authorization);
  assert.equal(report.result.status, "Report ready");
  assert.ok(report.reconciledAt);
  assert.equal(read().length, 2);

  const command = pair(report.id);
  command.orders.LPA.scenario = "uncertain";
  assert.match((await send(command)).message, /LPA awaiting confirmation/i);
  const [lpa, du] = read();
  assert.equal(lpa.borrowerCount, 2);
  assert.equal(du.borrowerCount, 2);
  assert.equal(lpa.result.status, "Awaiting confirmation");
  assert.match((await send({ type: "retryMockCreditAus", service: "LPA", attemptId: randomUUID(),
    previousId: lpa.id, applicationRevision: 3 })).error, /check the original/i);
  const duplicate = pair(report.id);
  duplicate.orders.DU.previousId = du.id;
  duplicate.orders.LPA.previousId = lpa.id;
  assert.match((await send(duplicate)).error, /check the original/i);
  db.prepare("UPDATE applications SET revision = 4 WHERE loanId = ?").run(loanId);
  assert.match((await send({ ...check, attemptId: lpa.id })).message, /confirmed/i);
  assert.equal(read()[0].reference, lpa.reference);
  assert.equal(read()[0].applicationRevision, 3);
  assert.equal(read()[0].result.status, "Findings ready");
  assert.deepEqual(read()[1], du);
  assert.match((await send(pair(report.id, 4))).error, /authorized mock credit/i);
  assert.equal(read().length, 4);
});

test("underwriting work follows loan ownership and clears only after a definitive lookup", async (t) => {
  const { db, send, read } = fixture(t);
  const other = { ...officer, name: "Fictional Backup LO", email: "backup@example.test" };
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  const queue = (staff = officer, options = {}, limit) =>
    readIncomingLoanWorkPage(db, { view: "today", ...options }, staff, officer.brokerage.id, undefined, new Date(), limit);
  const items = (staff) => queue(staff).items.filter(({ kind }) => kind === "underwriting");
  const counts = () => readActionCounts(db, officer, officer.brokerage.id).today;
  const baseline = counts();
  const order = { type: "runMockCredit", attemptId: randomUUID(), previousId: null, authorized: true,
    scenario: "uncertain-unavailable", applicationRevision: 3 };
  assert.ok((await send(order)).message);
  assert.deepEqual(items().map(({ id }) => id), [order.attemptId]);
  assert.equal(counts(), baseline + 1);
  const page = queue(officer, {}, 1);
  assert.equal(page.items[0].id, order.attemptId);
  assert.equal(page.next.kind, "underwriting");
  assert.ok(queue(officer, { after: page.next }).items.every(({ id }) => id !== order.attemptId));
  assert.deepEqual(items(other), []);
  assert.ok(queue(processor).error);
  assert.ok(queue({ ...officer, brokerage: { ...officer.brokerage, id: "other" } }).error);
  assert.deepEqual(items({ ...officer, brokerage: { ...officer.brokerage, pilot: false } }), []);
  const check = { type: "reconcileMockCreditAus", attemptId: order.attemptId, lookupId: randomUUID() };
  const [pending] = read();
  assert.match((await send(check)).message, /inconclusive/i);
  assert.match((await send(check)).message, /already recorded/i);
  assert.equal(read()[0].result.status, "Awaiting confirmation");
  assert.equal(read()[0].reference, pending.reference);
  assert.ok(read()[0].lastCheckedAt);
  assert.equal(counts(), baseline + 1);
  assert.match((await send({ ...order, attemptId: randomUUID(), previousId: order.attemptId })).error, /original/i);

  db.prepare("UPDATE loans SET officer = ?, officerEmail = ? WHERE id = ?").run(other.name, other.email, loanId);
  assert.deepEqual(items(), []);
  assert.deepEqual(items(other).map(({ id }) => id), [order.attemptId]);
  assert.match((await send(check)).error, /access/i);
  const confirm = { ...check, lookupId: randomUUID() };
  assert.match((await send(confirm, other)).message, /confirmed/i);
  assert.match((await send(check, other)).message, /already recorded/i);
  assert.deepEqual(items(other), []);
  assert.equal(read().length, 1);
  assert.equal(read()[0].reference, pending.reference);
  assert.equal(read()[0].result.status, "Report ready");

  const command = pair(order.attemptId);
  command.orders.LPA.scenario = "uncertain-rejected";
  assert.match((await send(command, other)).message, /LPA awaiting confirmation/i);
  const [lpa, du] = read();
  assert.deepEqual(items(other).map(({ id }) => id), [lpa.id]);
  const reconcileLpa = { ...check, attemptId: lpa.id, lookupId: randomUUID() };
  assert.match((await send(reconcileLpa, other)).message, /no order was placed/i);
  assert.equal(read()[0].id, lpa.id);
  assert.equal(read()[0].result.status, "Failed");
  assert.deepEqual(read()[1], du);
  assert.deepEqual(items(other), []);
  assert.match((await send(reconcileLpa, other)).message, /already recorded/i);
  assert.match((await send({ type: "retryMockCreditAus", service: "LPA", attemptId: randomUUID(), previousId: lpa.id, applicationRevision: 3 }, other)).message, /ready/i);
  assert.equal(read()[0].retryOf, lpa.id);
});

test("sandbox lookup fixtures match the original scope and quarantine inconsistent evidence", () => {
  const identity = { brokerageId: "fictional", loanId, orderId: randomUUID(), service: "DU", applicationRevision: 3, borrowerCount: 2 };
  const reference = "FICT-ORDER-123";
  const accepted = { outcome: "accepted", identity, reference };
  assert.deepEqual(classifyUnderwritingLookup(identity, { outcome: "inconclusive" }), { outcome: "inconclusive" });
  assert.deepEqual(classifyUnderwritingLookup(identity, accepted, reference), { outcome: "accepted" });
  assert.deepEqual(classifyUnderwritingLookup(identity, { ...accepted, outcome: "rejected" }), { outcome: "rejected" });
  for (const changed of [{ brokerageId: "other" }, { loanId: "other" }, { orderId: randomUUID() }, { service: "LPA" },
    { applicationRevision: 4 }, { borrowerCount: 1 }]) {
    assert.equal(classifyUnderwritingLookup(identity, { ...accepted, identity: { ...identity, ...changed } }).outcome, "conflict");
  }
  assert.equal(classifyUnderwritingLookup(identity, { ...accepted, reference: "FICT-OTHER" }, reference).outcome, "conflict");
});

test("only the brokerage admin dismisses conflicting evidence, leaving the original attempt pending", async (t) => {
  const { db, send, read } = fixture(t);
  const admin = { ...officer, name: "Fictional Admin", email: "admin@example.test", brokerage: { ...officer.brokerage, role: "Admin" } };
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  const order = { type: "runMockCredit", attemptId: randomUUID(), previousId: null, authorized: true, scenario: "uncertain-conflict", applicationRevision: 3 };
  const check = { type: "reconcileMockCreditAus", attemptId: order.attemptId };
  const exceptions = (staff = admin) => readFileExceptions(db, { filter: "Underwriting conflicts" }, staff, officer.brokerage.id);
  const count = () => countFileExceptions(db, admin, officer.brokerage.id, new Date(), 100);
  const baseline = count();
  assert.ok((await send(order)).message);
  assert.deepEqual(exceptions().rows, []);
  assert.match((await send(check)).message, /admin review/i);
  const [pending] = read();
  assert.equal(pending.result.status, "Awaiting confirmation");
  assert.notEqual(pending.conflict.reference, pending.reference);
  assert.equal(count(), baseline + 1);
  assert.equal(nameFileExceptions(exceptions(), []).items[0].target, `credit-aus-order-${order.attemptId}`);
  assert.ok(exceptions(officer).error);
  assert.ok(exceptions({ ...admin, brokerage: { ...admin.brokerage, id: "other" } }).error);
  assert.match((await send(check)).error, /admin must review/i);
  assert.match((await send({ ...order, attemptId: randomUUID(), previousId: pending.id })).error, /original/i);
  const { reference, detectedAt } = pending.conflict;
  const review = { type: "reviewMockUnderwritingConflict", attemptId: pending.id, reference, detectedAt };
  assert.match((await send(review)).error, /admin/i);
  assert.match((await send(review, processor)).error, /access/i);
  assert.match((await send({ ...review, reference: "FICT-STALE" }, admin)).error, /changed/i);
  assert.equal(count(), baseline + 1);
  assert.match((await send(review, admin)).message, /still needs confirmation/i);
  assert.match((await send(review, admin)).message, /already/i);
  assert.equal(read()[0].conflict.reviewedBy, admin.name);
  assert.equal(read()[0].result.status, "Awaiting confirmation");
  assert.equal(count(), baseline);
  assert.equal(readIncomingLoanWorkPage(db, { view: "today" }, officer, officer.brokerage.id).items[0].id, pending.id);
  assert.match((await send(check)).message, /confirmed/i);
  assert.equal(read().length, 1);
  assert.equal(read()[0].reference, pending.reference);
  assert.equal(read()[0].result.status, "Report ready");
  assert.equal(read()[0].conflict.reference, reference);
});

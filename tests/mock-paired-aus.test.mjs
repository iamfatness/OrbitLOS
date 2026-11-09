import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { blankApplication } = await import("../src/lib/application-model.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { mockCreditAusRuns, runMockCreditAus } = await import("../src/lib/mock-credit-aus.ts");

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

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { blankApplication, sampleApplication } = await import("../src/lib/application-model.ts");
const { borrowerCommandResult } = await import("../src/lib/applications.ts");
const { portalToken } = await import("../src/lib/brokerage-model.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { incomeWorksheetWork } = await import("../src/lib/income-review.ts");
const { incomeSourceMonthly, monthlyWorksheetTotal } = await import("../src/lib/income-review-model.ts");
const { easternDate } = await import("../src/lib/client-retention.ts");
const { readOfficerQueue } = await import("../src/lib/officer-queue.ts");

test("sample income arithmetic reconciles wages, documented month totals and adjustments", () => {
  const wage = { included: true, method: "Amount per pay period", amount: 325000, periods: 24, adjustment: 0 };
  const business = { included: true, method: "Total across months", amount: 123456, periods: 3, adjustment: -152 };
  const excluded = { ...wage, included: false };
  assert.equal(incomeSourceMonthly(wage), 650000);
  assert.equal(incomeSourceMonthly(business), 41000);
  assert.equal(monthlyWorksheetTotal([wage, business, excluded]), 691000);
});

test("approval attaches to accepted evidence and prevents reuse of a stale pricing source", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const at = "2026-11-09T17:00:00.000Z";
  const tenant = randomUUID();
  const staff = (role) => ({ name: `Fictional ${role}`, email: `${role.toLowerCase()}@example.test`, brokerage: { id: tenant, role, pilot: true } });
  const officer = staff("LO");
  const processor = staff("Processor");
  const loanId = randomUUID();
  const token = portalToken(tenant);
  const documentId = randomUUID();
  const send = (input) => executeCommand(db, { loanId, ...input }, officer);
  const work = (input, actor = officer, brokerage = tenant) => incomeWorksheetWork(db, { loanId, ...input }, actor, brokerage, new Date(at));
  const revision = 3;
  const mutate = (type, version, fields = {}) => ({ type, revision: version, applicationRevision: revision, requestId: randomUUID(), ...fields });
  insertContact(db, { id: "borrower", name: "Fictional Borrower", email: "", phone: "", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId: "borrower", partnerId: null, officer: officer.name, officerEmail: officer.email,
    stage: "Application", stageSince: at, address: "", amount: 350000, purpose: "Purchase" });
  const draft = { ...sampleApplication({ ...blankApplication(), borrowerName: "Fictional Borrower" }), confirmedDemo: true };
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, revision, updatedAt, submittedAt, reviewedAt)
    VALUES (?, ?, '2099-01-01', ?, ?, ?, ?, ?)`).run(loanId, token, JSON.stringify(draft), revision, at, at, at);
  db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, status, requestedAt, revision)
    VALUES (?, ?, 'Pay stub', '', 'Accepted', ?, 2)`).run(documentId, loanId, at);
  const source = { id: randomUUID(), recipient: "Primary borrower", label: "Fictional wages", kind: "Wages",
    method: "Amount per pay period", included: true, start: "", end: "2026-06-15", amount: 325000, periods: 24,
    adjustment: -5000, rationale: "Fictional monthly adjustment.", evidence: [{ id: documentId, revision: 2 }] };
  assert.match(work({ type: "read" }, processor).error, /fictional loans/i);
  assert.match(work({ type: "read" }, officer, randomUUID()).error, /fictional loans/i);
  const saved = work(mutate("save", 0, { sources: [source] })).page;
  assert.equal(saved.record.stage, "Draft");
  assert.match(work(mutate("submit", 1)).error, /source period/);
  assert.match(work(mutate("save", 1, { sources: [{ ...source, evidence: [{ id: randomUUID(), revision: 2 }] }] })).error, /evidence changed/);
  assert.equal(work(mutate("save", 1, { sources: [{ ...source, start: "2026-06-01" }] })).page.record.amount, 645000);
  const submitted = mutate("submit", 2);
  assert.equal(work(submitted).page.record.stage, "Ready for review");
  assert.equal(work(submitted).page.record.revision, 3);
  assert.match(work(mutate("approve", 2, { note: "Stale revision." })).error, /worksheet changed/i);
  const approve = work(mutate("approve", 3, { note: "Reviewed sample pay and adjustment." })).page.record;
  assert.equal(approve.stage, "Approved");
  assert.equal(approve.revision, 4);
  assert.equal(approve.evidence[0].revision, 2);
  assert.equal(approve.amount, 645000);

  const price = { type: "runPricing", applicationRevision: revision, incomeReviewRevision: approve.revision, scenario: {
    purpose: "Purchase", loanAmount: 350000, propertyValue: 450000, purchasePrice: null, zip: "48304",
    creditScore: 760, monthlyIncome: 6450, occupancy: "Primary residence", propertyType: "Single family", firstTimeBuyer: false,
  } };
  assert.match((await send({ ...price, incomeReviewRevision: 3 })).error, /reviewed income/i);
  assert.match((await send({ ...price, scenario: { ...price.scenario, monthlyIncome: 6500 } })).error, /reviewed income/i);
  const run = (await send(price)).state.pricingRuns[0];
  assert.equal(run.mode, "mock");
  assert.equal(run.incomeReviewRevision, 4);
  assert.equal(run.incomeReviewCurrent, true);
  const choice = { runId: run.id, offerId: run.offers[0].id };
  assert.ok((await send({ type: "selectOffer", ...choice })).message);
  assert.ok((await send({ type: "publishQuote", ...choice })).message);
  const borrowerStatus = () => borrowerCommandResult(db, { type: "status", token }).statusView.loanStatus;
  assert.ok(borrowerStatus().quote);
  assert.doesNotMatch(JSON.stringify(borrowerStatus()), /Fictional wages|Reviewed sample pay/);

  db.prepare("UPDATE document_requests SET status = 'Accepted', revision = 4 WHERE id = ?").run(documentId);
  assert.equal(work({ type: "read" }).page.stale, "Evidence changed");
  assert.equal(borrowerStatus().quote, null);
  for (const request of [price, { type: "selectOffer", ...choice }, { type: "publishQuote", ...choice },
    { type: "sendApplication", revision, quote: choice }]) {
    assert.match((await send(request)).error, /reviewed income/i);
  }
  const manual = (await send({ ...price, incomeReviewRevision: undefined })).state;
  assert.equal(manual.pricingRuns.find(({ id }) => id === run.id).incomeReviewCurrent, false);
  assert.equal(manual.pricingRuns.find(({ id }) => id !== run.id).incomeReviewRevision, null);
});

test("income verification approval pins the borrower and return through an older mock quote", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const now = new Date(), at = now.toISOString();
  const loanId = randomUUID(), tenant = randomUUID(), token = portalToken(tenant);
  let revision = 1;
  const officer = { name: "Fictional LO", email: "lo@example.test", brokerage: { id: tenant, role: "LO", pilot: true } };
  const processor = { name: "Fictional Processor", email: "processor@example.test", brokerage: { ...officer.brokerage, role: "Processor" } };
  const outsider = { ...processor, email: "another@example.test" };
  insertContact(db, { id: loanId, name: "Fictional Borrower", email: "", phone: "", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId: loanId, partnerId: null, officer: officer.name, officerEmail: officer.email,
    stage: "Application", stageSince: at, address: "", amount: 350000, purpose: "Purchase" });
  const draft = { ...sampleApplication({ ...blankApplication(), borrowerName: "Fictional Borrower" }), confirmedDemo: true };
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, revision, updatedAt, submittedAt, reviewedAt)
    VALUES (?, ?, '2099-01-01', ?, ?, ?, ?, ?)`).run(loanId, token, JSON.stringify(draft), revision, at, at, at);
  db.prepare(`INSERT INTO joint_applications (loanId, token, expiresAt, draft, updatedAt) VALUES (?, ?, '2099-01-01', '{}', ?)`)
    .run(loanId, portalToken(tenant), at);
  db.prepare(`INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision)
    VALUES (?, ?, ?, 'In processing', '', ?, 1)`).run(loanId, processor.email, processor.name, at);
  const send = (input, actor = officer) => executeCommand(db, { loanId, ...input }, actor, undefined, [], { scopedLoanUpdates: true });
  const work = (input, actor = officer) => incomeWorksheetWork(db, { loanId, ...input }, actor, tenant, now);
  const mutate = (type, version, fields = {}) => ({ type, revision: version, applicationRevision: revision, requestId: randomUUID(), ...fields });
  const orderId = randomUUID(), assetId = randomUUID();
  const prior = { type: "createServiceOrder", orderId: randomUUID(), kind: "Employment verification", dueOn: easternDate(now),
    recipient: "Co-borrower", note: "", applicationRevision: null };
  db.prepare("UPDATE applications SET submittedAt = NULL WHERE loanId = ?").run(loanId);
  assert.ok((await send(prior, processor)).message);
  db.prepare("UPDATE applications SET submittedAt = ? WHERE loanId = ?").run(at, loanId);
  assert.match((await send(prior, processor)).message, /already recorded/);
  const delayedReturn = { type: "updateServiceOrder", orderId: prior.orderId, revision: 0, action: "Simulate return", note: "" };
  assert.ok((await send(delayedReturn, processor)).message);
  assert.ok((await send({ ...delayedReturn, revision: 1, action: "Accept" }, processor)).message);
  assert.equal(db.prepare("SELECT applicationRevision FROM service_orders WHERE id = ?").get(prior.orderId).applicationRevision, null);
  assert.deepEqual(work({ type: "read" }).page.eligible, []);
  for (const [id, kind] of [[orderId, "Income verification"], [assetId, "Asset verification"]]) {
    const created = await send({ type: "createServiceOrder", orderId: id, kind, dueOn: easternDate(now), recipient: "Co-borrower",
      note: "", applicationRevision: revision }, processor);
    assert.ok(created.message, created.error);
    const received = await send({ type: "updateServiceOrder", orderId: id, revision: 0, action: "Simulate return", note: "" }, processor);
    assert.ok(received.message, received.error);
    assert.ok(!work({ type: "read" }).page.eligible.some((item) => item.id === id));
    const accepted = await send({ type: "updateServiceOrder", orderId: id, revision: 1, action: "Accept", note: "" }, processor);
    assert.ok(accepted.message, accepted.error);
  }
  const [eligible] = work({ type: "read" }).page.eligible;
  assert.equal(eligible.id, orderId);
  assert.equal(eligible.recipient, "Co-borrower");
  assert.equal(eligible.verification.acceptedBy, processor.name);
  assert.match(eligible.returnReference, /^MOCK-INCOME-VERIFICATION-.*-V1$/);
  assert.ok(!work({ type: "read" }).page.eligible.some(({ id }) => id === assetId));
  const { id, revision: orderRevision, returnReference } = eligible;
  const source = { id: randomUUID(), recipient: "Co-borrower", label: "Fictional verified wages", kind: "Wages", method: "Monthly amount",
    included: true, start: "2026-06-01", end: "2026-06-30", amount: 625000, periods: null, adjustment: 0, rationale: "",
    evidence: [{ id, revision: orderRevision, returnReference }] };
  assert.match(work(mutate("save", 0, { sources: [{ ...source, recipient: "Primary borrower" }] }), processor).error, /evidence changed/);
  assert.match(work(mutate("save", 0, { sources: [{ ...source, evidence: [{ id, revision: orderRevision, returnReference: "wrong-return" }] }] }), processor).error, /evidence changed/);
  assert.match(work(mutate("save", 0, { sources: [{ ...source, evidence: [{ id, revision: orderRevision }] }] }), processor).error, /evidence changed/);
  assert.equal(work(mutate("save", 0, { sources: [source] }), processor).page.record.amount, 625000);
  const incomeWork = (actor) => readOfficerQueue(db, { horizon: 1 }, actor, tenant, now).items.filter(({ kind }) => kind === "income-review");
  assert.deepEqual(incomeWork(officer), []);
  assert.equal(work(mutate("submit", 1), processor).page.record.stage, "Ready for review");
  assert.deepEqual(incomeWork(officer).map(({ recordId, target, overdue }) => ({ recordId, target, overdue })),
    [{ recordId: loanId, target: "income-worksheet", overdue: false }]);
  assert.deepEqual(incomeWork({ ...officer, email: outsider.email }), []);
  assert.deepEqual(incomeWork({ ...officer, brokerage: { ...officer.brokerage, pilot: false } }), []);
  db.prepare("UPDATE loans SET officerEmail = ? WHERE id = ?").run(outsider.email, loanId);
  assert.deepEqual(incomeWork(officer), []);
  assert.equal(incomeWork({ ...officer, email: outsider.email }).length, 1);
  db.prepare("UPDATE loans SET officerEmail = ? WHERE id = ?").run(officer.email, loanId);
  db.prepare("UPDATE applications SET reviewedAt = NULL WHERE loanId = ?").run(loanId);
  assert.deepEqual(incomeWork(officer), []);
  db.prepare("UPDATE applications SET reviewedAt = ? WHERE loanId = ?").run(at, loanId);
  assert.match(work(mutate("approve", 2, { note: "Verified sample return" }), processor).error, /loan officer/);
  const approved = work(mutate("approve", 2, { note: "Verified sample return" })).page.record;
  assert.deepEqual(incomeWork(officer), []);
  assert.deepEqual(approved.evidence, [eligible]);
  const price = { type: "runPricing", applicationRevision: revision, incomeReviewRevision: approved.revision, scenario: {
    purpose: "Purchase", loanAmount: 350000, propertyValue: 450000, purchasePrice: null, zip: "48304",
    creditScore: 760, monthlyIncome: 6250, occupancy: "Primary residence", propertyType: "Single family", firstTimeBuyer: false,
  } };
  const priced = await send(price);
  const quote = (priced.loanWork ?? priced.state).pricingRuns[0];
  assert.equal(quote.mode, "mock");
  assert.equal(quote.incomeReviewRevision, approved.revision);
  assert.equal(quote.incomeReviewCurrent, true);
  assert.deepEqual(work({ type: "read", worksheetRevision: quote.incomeReviewRevision }).page.requested, approved);
  assert.match(work({ type: "read", worksheetRevision: 100 }).error, /unavailable/);
  assert.match(work({ type: "read", worksheetRevision: approved.revision }, outsider).error, /fictional loans/);
  db.prepare("UPDATE service_orders SET revision = revision + 1 WHERE id = ?").run(orderId);
  assert.equal(work({ type: "read" }).page.stale, "Evidence changed");
  assert.match((await send({ type: "selectOffer", runId: quote.id, offerId: quote.offers[0].id })).error, /reviewed income/i);
  const updated = work(mutate("save", approved.revision, { sources: [] })).page.record;
  assert.equal(updated.stage, "Draft");
  const historical = work({ type: "read", worksheetRevision: quote.incomeReviewRevision }).page;
  assert.equal(historical.record.revision, approved.revision + 1);
  assert.deepEqual(historical.requested, approved);

  revision += 2;
  db.prepare("UPDATE applications SET revision = ? WHERE loanId = ?").run(revision, loanId);
  const corrected = work({ type: "read", worksheetRevision: approved.revision }).page;
  assert.equal(corrected.stale, "1003 changed");
  assert.deepEqual(corrected.requested, approved);
  assert.deepEqual(corrected.eligible, []);
  assert.match(work(mutate("save", updated.revision, { sources: [source] }), processor).error, /evidence changed/);
  const newOrder = { ...prior, orderId: randomUUID(), kind: "Income verification", applicationRevision: revision };
  assert.ok((await send(newOrder, processor)).message);
  assert.ok((await send({ ...delayedReturn, orderId: newOrder.orderId }, processor)).message);
  assert.ok((await send({ ...delayedReturn, orderId: newOrder.orderId, revision: 1, action: "Accept" }, processor)).message);
  assert.deepEqual(work({ type: "read" }).page.eligible.map(({ id }) => id), [newOrder.orderId]);
});

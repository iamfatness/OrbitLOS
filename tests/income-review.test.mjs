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

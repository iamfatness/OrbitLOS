import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { workOnRealtorFinancing, borrowerRealtorFinancing } = await import("../src/lib/realtor-financing.ts");
const { realtorReferrals } = await import("../src/lib/realtor-portal.ts");

function fixture(t, joint = false) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { prepare: sql => sqlite.prepare(sql), exec: sql => sqlite.exec(sql), transaction(run) {
    sqlite.exec("BEGIN");
    try { const result = run(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const loanId = "fictional-purchase";
  const now = new Date("2026-11-12T15:00:00.000Z"), at = now.toISOString();
  const staff = { name: "Fictional Officer", email: "officer@example.test",
    brokerage: { id: randomUUID(), name: "Fictional brokerage", pilot: true, role: "LO" } };
  const borrower = "a".repeat(64), coBorrower = "b".repeat(64), realtor = "c".repeat(64), otherRealtor = "d".repeat(64);
  for (const [id, role] of [["borrower", "Borrower"], ["partner", "Realtor"], ["other", "Realtor"]]) {
    insertContact(db, { id, role, name: "Fictional " + id, email: id + "@example.test", phone: "" });
  }
  insertLoan(db, { id: loanId, contactId: "borrower", partnerId: "partner", officer: staff.name, officerEmail: staff.email,
    address: "Fictional address", amount: 350000, purpose: "Purchase", stage: "Application", stageSince: at });
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt, reviewedAt, revision)
    VALUES (?, ?, '2099-01-01', '{"confirmedDemo":true,"privateField":"private draft"}', ?, ?, ?, 1)`).run(loanId, borrower, at, at, at);
  if (joint) db.prepare(`INSERT INTO joint_applications (loanId, token, expiresAt, draft, updatedAt, submittedAt, primarySubmittedAt, confirmedDemo)
    VALUES (?, ?, '2099-01-01', '{}', ?, ?, ?, 1)`).run(loanId, coBorrower, at, at, at);
  db.prepare("INSERT INTO realtor_portals (realtorId, token, expiresAt) VALUES ('partner', ?, '2099-01-01'), ('other', ?, '2099-01-01')")
    .run(realtor, otherRealtor);
  db.prepare(`INSERT INTO pricing_runs (id, loanId, provider, mode, scenario, offers, notices, quotedAt, applicationRevision)
    VALUES ('run', ?, 'UWM', 'mock', '{"privateField":"private pricing assumptions"}', '[]', '[]', ?, 1)`).run(loanId, at);
  const quote = JSON.stringify({ primary: { runId: "run", offerId: "offer", purpose: "Purchase", years: 30, loanAmount: 350000,
    rate: 6.125, principalAndInterest: 2110, product: "Private product label", estimate: { cashToClose: 1600000 } }, alternatives: [] });
  db.prepare(`INSERT INTO published_quotes (loanId, runId, offerId, product, rate, principalAndInterest, quotedAt, publishedAt, presentation, expiresOn)
    VALUES (?, 'run', 'offer', 'Private product label', 6.125, 2110, ?, ?, ?, '2026-11-12')`).run(loanId, at, at, quote);
  const work = (data = { type: "read" }, actor = staff, clock = now) =>
    workOnRealtorFinancing(db, { loanId, ...data }, actor, staff.brokerage.id, clock);
  const read = (token = borrower) => borrowerRealtorFinancing(db, { type: "read", token }, now);
  const portal = (token = realtor, clock = now, pilot = true) => realtorReferrals(db, { type: "read", token }, clock.toISOString(), pilot);
  const answer = (token, requestId, decision, operationId = randomUUID()) => borrowerRealtorFinancing(db,
    { type: "respond", token, requestId, decision, operationId }, now);
  return { db, loanId, staff, borrower, coBorrower, realtor, otherRealtor, work, read, portal, answer };
}

test("both borrowers must grant permission before the LO can publish the exact redacted quote summary", t => {
  const { db, staff, borrower, coBorrower, realtor, otherRealtor, work, read, portal, answer } = fixture(t, true);
  assert.equal(work({ type: "read" }, { ...staff, email: "other@example.test" }).status, 404);
  assert.equal(work({ type: "read" }, { ...staff, brokerage: { ...staff.brokerage, role: "Processor" } }).status, 404);
  assert.equal(work({ type: "read" }, { ...staff, brokerage: { ...staff.brokerage, pilot: false } }).status, 404);
  const { basis, terms } = work().value.preview;
  assert.deepEqual(terms, { program: "Conventional", termYears: 30, amountCents: 35000000, quoteExpiresOn: "2026-11-12" });
  const request = { type: "request", requestId: randomUUID(), basis };
  const publish = { ...request, type: "publish" };
  assert.equal(work({ ...request, basis: "a".repeat(64) }).status, 409);
  assert.equal(work(request).value.request.id, request.requestId);
  assert.equal(work(request).value.request.id, request.requestId);
  assert.equal(work(publish).status, 409);
  assert.equal(read().value.request.permission, "Pending");
  assert.equal(read(coBorrower).value.request.permission, "Pending");
  assert.equal(answer(realtor, request.requestId, "Approve").status, 404);
  const firstAnswerId = randomUUID();
  assert.equal(answer(borrower, request.requestId, "Approve", firstAnswerId).value.request.permission, "Approved");
  assert.equal(answer(borrower, request.requestId, "Approve", firstAnswerId).value.request.permission, "Approved");
  assert.equal(answer(coBorrower, request.requestId, "Approve", firstAnswerId).status, 404);
  assert.equal(work(publish).status, 409);
  assert.equal(answer(coBorrower, request.requestId, "Approve").value.request.permission, "Approved");
  assert.equal(portal().value.referrals[0].financing, undefined);
  const published = work(publish).value.request.publishedAt;
  assert.equal(work(publish).value.request.publishedAt, published);
  assert.deepEqual(portal().value.referrals[0].financing, { ...terms, publishedAt: published });
  assert.deepEqual(portal(otherRealtor).value.referrals, []);
  assert.equal(portal(realtor, new Date("2026-11-13T04:59:59.999Z")).value.referrals[0].financing.publishedAt, published);
  assert.equal(portal(realtor, new Date("2026-11-13T05:00:00.000Z")).value.referrals[0].financing, undefined);
  assert.equal(portal(realtor, undefined, false).value.referrals[0].financing, undefined);
  assert.equal(answer(coBorrower, request.requestId, "Revoke").value.request, null);
  assert.equal(work(publish).status, 409);
  assert.equal(portal().value.referrals[0].financing, undefined);
  assert.deepEqual(work().value.request.permissions.map(({ status }) => status), ["Approved", "Revoked"]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM realtor_financing_decisions").get().count, 3);
});

test("changing the quote or realtor ends a published summary permanently", t => {
  const { db, borrower, work, portal, answer } = fixture(t);
  function publish() {
    const input = { type: "request", requestId: randomUUID(), basis: work().value.preview.basis };
    assert.equal(work(input).value.current, true);
    assert.equal(answer(borrower, input.requestId, "Approve").value.request.permission, "Approved");
    assert.ok(work({ ...input, type: "publish" }).value.request.publishedAt);
    assert.ok(portal().value.referrals[0].financing);
  }
  publish();
  db.exec("UPDATE loans SET partnerId = 'other'; UPDATE loans SET partnerId = 'partner';");
  assert.equal(portal().value.referrals[0].financing, undefined);
  assert.equal(work().value.request.endReason, "Loan or recipients changed");
  publish();
  db.exec("UPDATE published_quotes SET reviewReason = 'Sample quote changed', reviewRevision = 1; UPDATE published_quotes SET reviewReason = NULL;");
  assert.equal(portal().value.referrals[0].financing, undefined);
  assert.equal(work().value.request.endReason, "Shared quote changed");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

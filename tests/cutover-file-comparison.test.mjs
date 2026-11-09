import assert from "node:assert/strict";
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

const { initializeStore, insertContact, insertLoan, insertSubmission } = await import("../src/lib/store.ts");
const { cutoverFileSource, cutoverFileSourceSection } = await import("../src/lib/cutover-file-model.ts");
const { readFileComparison } = await import("../src/lib/cutover-file-comparison.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { fundingTaskId } = await import("../src/lib/playbook-model.ts");

const at = "2026-11-08T15:00:00.000Z";
const later = "2026-11-09T15:00:00.000Z";
const dueOn = "2026-11-15";
const photo = { kind: "Photo ID", instructions: "Provide sample ID", status: "Requested", dueOn: null };
const condition = { id: "condition", category: "Income", group: null, description: "Confirm income", uploaded: false, satisfiedAt: null };
const file = { lender: "Example Wholesale", reference: "SAMPLE-1003", status: "Acknowledged", conditions: [
  { category: "Income", description: "Confirm income", status: "Open" },
] };
const noFunding = { closingDate: null, fundingDate: null, fundedPrincipalCents: null,
  borrowerFollowUp: null, realtorFollowUp: null, borrowerCallback: null };
const closingDate = "2026-11-06";
const fundingDate = "2026-11-07";
const funded = { ...noFunding, closingDate, fundingDate, fundedPrincipalCents: 27_500_000 };
const borrowerTaskId = fundingTaskId("target", "borrower");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction: (run) => run() };
  initializeStore(db, false);
  insertContact(db, { id: "borrower", name: "Fictional borrower", email: "", phone: "", role: "Borrower" });
  for (const id of ["target", "other"]) insertLoan(db, { id, contactId: "borrower", partnerId: null, officer: "Fictional LO", officerEmail: "lo@example.test",
    address: "", amount: 275000, purpose: "Purchase", stage: "Lead", stageSince: at });
  const read = (item, source) => readFileComparison(db, "target", item, cutoverFileSource.parse({ version: 1, ...source }));
  const doc = ({ id, loanId = "target", kind = photo.kind, instructions = photo.instructions, status = photo.status,
    dueOn = null, revision = 0, submissionId = null, conditionId = null }) => db.prepare(`INSERT INTO document_requests
    (id, loanId, kind, instructions, requestedAt, status, dueOn, revision, submissionId, conditionId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, loanId, kind, instructions, at, status, dueOn, revision, submissionId, conditionId);
  const submission = (options = {}) => insertSubmission(db, { id: "file", loanId: "target", lender: file.lender, externalId: file.reference,
    status: file.status, conditions: [condition], syncedAt: null, ...options });
  const conditions = (id, records) => db.prepare("UPDATE submissions SET conditions = ? WHERE id = ?").run(JSON.stringify(records), id);
  const staff = { name: "Fictional LO", email: "lo@example.test",
    brokerage: { id: crypto.randomUUID(), name: "Fictional brokerage", role: "Admin", pilot: true } };
  const run = async (input) => {
    const result = await executeCommand(db, { loanId: "target", ...input }, staff);
    assert.ok(result.state, result.error);
    return result.state;
  };
  return { db, read, doc, submission, conditions, run };
}

test("inventory schema distinguishes omitted and empty sections and bounds accepted metadata", () => {
  assert.equal(cutoverFileSource.safeParse({ version: 1 }).success, false);
  assert.equal(cutoverFileSource.safeParse({ version: 1, documents: [] }).success, true);
  assert.equal(cutoverFileSource.safeParse({ version: 1, lenderFiles: [] }).success, true);
  assert.equal(cutoverFileSource.safeParse({ version: 1, documents: [{ ...photo, dueOn: "2026-02-30" }] }).success, false);
  assert.equal(cutoverFileSource.safeParse({ version: 1, documents: [{ ...photo, body: "never retain contents" }] }).success, false);
  assert.equal(cutoverFileSource.safeParse({ version: 1, lenderFiles: [file, { ...file, lender: "example  wholesale" }] }).success, false);
  assert.equal(cutoverFileSource.safeParse({ version: 1, documents: Array(101).fill(photo) }).success, false);
  assert.equal(cutoverFileSource.safeParse({ version: 1, documents: Array(100).fill({ ...photo, instructions: "ö".repeat(500) }) }).success, false);
});

test("funding evidence validates dates, exact cents, and explicit follow-up absence", () => {
  const parse = (funding) => cutoverFileSource.safeParse({ version: 1, funding }).success;
  assert.equal(cutoverFileSourceSection.funding, "funding");
  assert.equal(parse(noFunding), true);
  assert.equal(parse(funded), true);
  assert.equal(parse({ ...funded, fundedPrincipalCents: Number.MAX_SAFE_INTEGER }), true);
  assert.equal(parse({ ...funded, fundedPrincipalCents: Number.MAX_SAFE_INTEGER + 1 }), false);
  assert.equal(parse({ ...funded, fundedPrincipalCents: 0 }), false);
  assert.equal(parse({ ...funded, fundedPrincipalCents: null }), false);
  assert.equal(parse({ ...funded, closingDate: null }), false);
  assert.equal(parse({ ...funded, closingDate: "2026-11-08" }), false);
  assert.equal(parse({ ...noFunding, borrowerFollowUp: { dueOn, status: "Open" } }), false);
  assert.equal(parse({ ...funded, borrowerCallback: { dueOn, status: "Pending" } }), false);
});

test("document comparison preserves duplicate identity, source section isolation, and destination version evidence", (t) => {
  const { db, read, doc, submission } = fixture(t);
  submission();
  doc({ id: "first", status: "Received", dueOn });
  doc({ id: "second", status: "Accepted", submissionId: "file", conditionId: condition.id });
  doc({ id: "added", kind: "Tax form" });
  doc({ id: "outside", loanId: "other", kind: "Bank statement" });
  const documents = [photo, { ...photo, kind: "photo id", instructions: " provide  SAMPLE id ", status: "Received", dueOn },
    { ...photo, kind: "Bank statement" }];
  const result = read("documents", { documents });
  assert.deepEqual(result.rows.map(({ status }) => status), ["Missing", "Matched", "Changed", "Added"]);
  assert.equal(result.rows[1].source, `Received · Due ${dueOn}`);
  assert.equal(result.rows[2].destination, "Accepted · No due date");
  assert.equal(read("documents", { documents, lenderFiles: [file] }).fingerprint, result.fingerprint);
  assert.equal(read("documents", { documents: [...documents].reverse() }).fingerprint, result.fingerprint);
  assert.equal(read("documents", { lenderFiles: [file] }), null);
  assert.ok(read("documents", { documents: [] }).rows.every(({ status }) => status === "Added"));
  db.prepare("UPDATE document_requests SET revision = revision + 1 WHERE id = 'second'").run();
  const replacement = read("documents", { documents });
  assert.notEqual(replacement.fingerprint, result.fingerprint);
  assert.deepEqual(replacement.rows, result.rows);
});

test("lender status tracks current manual and mock delivery, and ignores sync-only refreshes", (t) => {
  const { db, read, doc, submission, conditions } = fixture(t);
  const manual = { revision: 1, owner: "Fictional LO", confirmedDelivery: null, deliveries: [] };
  submission({ conditions: [{ ...condition, manual }] });
  submission({ id: "uwm", lender: "UWM", externalId: "DEMO-1003", syncedAt: at });
  doc({ id: "manual-doc", status: "Accepted", revision: 1, submissionId: "file", conditionId: condition.id });
  doc({ id: "mock-doc", status: "Accepted", revision: 1, submissionId: "uwm", conditionId: condition.id });
  const lenderFiles = [file, { ...file, lender: "uwm", reference: "DEMO-1003" }];
  const initial = read("lender", { lenderFiles });
  assert.equal(initial.rows.length, 4);
  assert.ok(initial.rows.every(({ status }) => status === "Matched"));
  assert.equal(read("lender", { lenderFiles, documents: [photo] }).fingerprint, initial.fingerprint);
  db.prepare("UPDATE submissions SET syncedAt = ? WHERE id = 'uwm'").run(later);
  assert.equal(read("lender", { lenderFiles }).fingerprint, initial.fingerprint);

  const delivery = { ...manual, revision: 2, deliveries: [{ documentRevision: 1, reference: "MANUAL-1", at }] };
  conditions("file", [{ ...condition, uploaded: true, manual: delivery }]);
  db.prepare("INSERT INTO uwm_document_deliveries (requestId, receipt, sentAt, documentRevision) VALUES ('mock-doc', 'DEMO-RECEIPT', ?, 1)").run(at);
  const delivered = read("lender", { lenderFiles });
  assert.notEqual(delivered.fingerprint, initial.fingerprint);
  assert.deepEqual(delivered.rows.filter(({ status }) => status === "Changed").map(({ destination }) => destination), ["Delivered", "Delivered"]);
  db.prepare("UPDATE uwm_document_deliveries SET receipt = 'DEMO-RECEIPT-REPLACED' WHERE requestId = 'mock-doc'").run();
  const changedReceipt = read("lender", { lenderFiles });
  assert.deepEqual(changedReceipt.rows, delivered.rows);
  assert.notEqual(changedReceipt.fingerprint, delivered.fingerprint);
  db.prepare("UPDATE document_requests SET revision = 2 WHERE id IN ('manual-doc', 'mock-doc')").run();
  const replaced = read("lender", { lenderFiles });
  assert.ok(replaced.rows.every(({ status }) => status === "Matched"));
  assert.notEqual(replaced.fingerprint, initial.fingerprint);
  conditions("uwm", [{ ...condition, uploaded: true, satisfiedAt: later }]);
  assert.equal(read("lender", { lenderFiles }).rows.find(({ status }) => status === "Changed").destination, "Cleared");
  conditions("uwm", [{ ...condition, mockReopenedAt: later }]);
  const reopened = read("lender", { lenderFiles });
  assert.ok(reopened.rows.every(({ status }) => status === "Matched"));
  assert.notEqual(reopened.fingerprint, replaced.fingerprint);
  conditions("uwm", Array.from({ length: 101 }, (_, index) => ({ ...condition, id: `over-limit-${index}` })));
  assert.equal(read("lender", { lenderFiles }), null);
  db.prepare("UPDATE submissions SET conditions = 'invalid JSON' WHERE id = 'uwm'").run();
  assert.equal(read("lender", { lenderFiles }), null);
});

test("funding comparison uses actual dates, whole-dollar Orbit principal, and Eastern due days", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T15:00:00.000Z") });
  const { db, read, run, doc } = fixture(t);
  assert.equal(read("funding", { documents: [] }), null);
  const blank = read("funding", { funding: noFunding });
  assert.deepEqual(blank.rows, []);
  db.prepare("INSERT INTO closing_plans VALUES ('target', ?)").run(closingDate);
  db.prepare("UPDATE loans SET amount = 300000 WHERE id = 'target'").run();
  db.prepare("INSERT INTO closing_progress (loanId, disclosureDate, revision) VALUES ('target', ?, 1)").run(closingDate);
  doc({ id: "unrelated" });
  assert.equal(read("funding", { funding: noFunding, documents: [photo] }).fingerprint, blank.fingerprint);
  assert.deepEqual(read("funding", { funding: funded }).rows.map(({ status }) => status), ["Missing", "Missing", "Missing"]);
  db.prepare("UPDATE loans SET amount = 275000 WHERE id = 'target'").run();
  insertContact(db, { id: "partner", name: "Fictional realtor", email: "", phone: "", role: "Realtor" });
  db.prepare("UPDATE loans SET partnerId = 'partner' WHERE id = 'target'").run();
  await run({ type: "recordClosing", closingDate, revision: 0 });
  await run({ type: "recordFunding", fundingDate, revision: 1 });
  db.prepare("UPDATE tasks SET dueAt = '2026-11-15T01:00:00.000Z' WHERE id = ?").run(borrowerTaskId);
  const current = { ...funded, fundedPrincipalCents: 27_500_001, borrowerFollowUp: { dueOn: "2026-11-14", status: "Open" },
    realtorFollowUp: { dueOn: "2026-11-14", status: "Open" } };
  const compared = read("funding", { funding: current });
  assert.deepEqual(compared.rows.map(({ status }) => status), ["Matched", "Matched", "Changed", "Matched", "Matched"]);
  assert.equal(compared.rows[2].source, "$275,000.01");
  assert.equal(compared.rows[2].destination, "$275,000.00");
  assert.match(compared.rows[2].label, /Orbit loan amount/);
  assert.equal(read("funding", { funding: { ...current, fundedPrincipalCents: Number.MAX_SAFE_INTEGER } }).rows[2].source, "$90,071,992,547,409.91");
  db.prepare("UPDATE closing_progress SET disclosureDate = ?, revision = revision + 1 WHERE loanId = 'target'").run(later.slice(0, 10));
  assert.equal(read("funding", { funding: current }).fingerprint, compared.fingerprint);
  db.prepare("UPDATE tasks SET dueAt = '2026-11-15T02:00:00.000Z' WHERE id = ?").run(borrowerTaskId);
  const changedTime = read("funding", { funding: current });
  assert.deepEqual(changedTime.rows, compared.rows);
  assert.notEqual(changedTime.fingerprint, compared.fingerprint);
});

test("funding comparison excludes reversed check-ins and tasks even when completion instants repeat", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T15:00:00.000Z") });
  const { db, read, run } = fixture(t);
  await run({ type: "recordClosing", closingDate, revision: 0 });
  await run({ type: "recordFunding", fundingDate, revision: 0 });
  const originalId = crypto.randomUUID();
  await run({ type: "recordFundingCheckIn", eventId: originalId, fundingRevision: 1, kind: "Call", outcome: "Left message",
    note: "Fictional follow-up", followUp: "2026-11-12", purpose: "Loan service" });
  const current = { ...funded, borrowerFollowUp: { dueOn: "2026-11-14", status: "Completed" },
    borrowerCallback: { dueOn: "2026-11-12", status: "Open" } };
  const first = read("funding", { funding: current });
  assert.ok(first.rows.every(({ status }) => status === "Matched"));
  assert.match(first.rows.at(-1).label, /callback or next follow-up/);
  await run({ type: "reverseFunding", fundingDate, revision: 1, reason: "Fictional reversal" });
  const reversed = read("funding", { funding: current });
  assert.deepEqual(reversed.rows.map(({ status }) => status), ["Matched", "Missing", "Missing", "Missing", "Missing"]);
  assert.equal(db.prepare("SELECT count(*) AS total FROM tasks WHERE id GLOB 'reversed-funding:*'").get().total, 1);
  await run({ type: "recordFunding", fundingDate, revision: 2 });
  await run({ type: "completeTask", id: borrowerTaskId, completed: true });
  assert.equal(read("funding", { funding: current }).rows.at(-1).status, "Missing");
  await run({ type: "completeTask", id: borrowerTaskId, completed: false });
  const currentId = crypto.randomUUID();
  await run({ type: "recordFundingCheckIn", eventId: currentId, fundingRevision: 3, kind: "Call", outcome: "Requested callback",
    note: "New fictional follow-up", followUp: "2026-11-12", purpose: "Loan service" });
  const refunded = read("funding", { funding: current });
  assert.deepEqual(refunded.rows, first.rows);
  assert.notEqual(refunded.fingerprint, first.fingerprint);
  db.prepare("UPDATE contact_activity SET completedAt = ? WHERE id = ?").run(later, currentId);
  assert.equal(read("funding", { funding: current }).rows.at(-1).destination, "Completed · Due 2026-11-12");
  await run({ type: "recordFunding", fundingDate: "2026-11-08", revision: 3 });
  assert.equal(read("funding", { funding: current }).rows.at(-1).destination, "Completed · Due 2026-11-12");
});

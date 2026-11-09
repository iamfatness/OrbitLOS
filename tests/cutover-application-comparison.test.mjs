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

const { readApplicationComparison } = await import("../src/lib/cutover-application-comparison.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { borrowerCommandResult } = await import("../src/lib/applications.ts");
const { initializeStore, insertContact } = await import("../src/lib/store.ts");
const { blankBorrower } = await import("../src/lib/urla.ts");

const fields = { firstName: "Riley", middleName: "Pilot", lastName: "Example", suffix: "Jr.", amount: "280000.50", purpose: "Purchase",
  occupancy: "Primary residence", street: "102 Fictional Avenue", unit: "", city: "Troy", state: "MI", zip: "48084" };

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = { exec: (query) => sqlite.exec(query), prepare: (query) => sqlite.prepare(query), transaction(run) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = run(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const staff = { name: "Pilot admin", email: "pilot@example.test",
    brokerage: { id: crypto.randomUUID(), name: "Fictional brokerage", role: "Admin", pilot: true } };
  const send = (input) => executeCommand(db, input, staff);
  const request = (overrides = {}) => ({ type: "importMismo", requestId: crypto.randomUUID(), fictional: true, fields, ...overrides });
  const read = (loanId) => readApplicationComparison(db, loanId);
  function update(loanId, change, revision) {
    const old = db.prepare("SELECT draft, revision FROM applications WHERE loanId = ?").get(loanId);
    const draft = change(JSON.parse(old.draft));
    db.prepare("UPDATE applications SET draft = ?, revision = ? WHERE loanId = ?").run(JSON.stringify(draft), revision ?? old.revision, loanId);
  }
  return { db, send, request, read, update };
}

test("compares the retained MISMO values with the exact 1003 revision and exposes only selected fields", async (t) => {
  const { db, send, request, read, update } = fixture(t);
  const result = await send(request({ extraBorrowers: 2 }));
  assert.ok(result.applicationLoanId, result.error);
  const id = result.applicationLoanId;
  const first = read(id);
  assert.equal(first.revision, 0);
  assert.equal(first.sourceExtraBorrowers, 2);
  assert.equal(first.draftExtraBorrowers, 0);
  assert.equal(first.missingExtraBorrowers, 2);
  assert.equal(first.rows.find(({ key }) => key === "borrowerName").source, "Riley Pilot Example Jr.");
  assert.deepEqual(first.rows.map(({ status }) => status),
    ["Matched", "Matched", "Matched", "Matched", "Matched", "Not supplied", "Matched", "Matched", "Matched"]);
  const { token } = db.prepare("SELECT token FROM applications WHERE loanId = ?").get(id);
  const opened = borrowerCommandResult(db, { type: "read", token });
  assert.ok(opened.application, opened.error);
  const saved = borrowerCommandResult(db, { type: "save", token, step: 1, revision: opened.application.revision, draft: opened.application.draft });
  assert.ok(saved.application, saved.error);
  assert.equal(read(id).revision, 1);
  assert.equal(read(id).fingerprint, first.fingerprint);

  update(id, (draft) => ({ ...draft, borrowerName: "riley  pilot example jr.", loanAmount: "0280000.5" }));
  const formatting = read(id);
  assert.equal(formatting.fingerprint, first.fingerprint);
  assert.equal(formatting.rows.find(({ key }) => key === "loanAmount").draft, "280000.50");

  update(id, (draft) => {
    const named = blankBorrower();
    named.identity = { ...named.identity, fields: { name: "Private co-borrower name" } };
    const unnamed = blankBorrower();
    unnamed.identity = { ...unnamed.identity, fields: { name: "   " } };
    draft.urla.additional.push(named, unnamed);
    draft.urla.credit.fields.type = "Joint";
    draft.urla.primary.identity.fields.taxId = "000-00-9876";
    return { ...draft, email: "private@example.test", currentAddress: "Private current address", occupancy: "Second home", propertyAddress: "",
      propertyLocation: { ...draft.propertyLocation, unit: "2" } };
  }, 2);
  const changed = read(id);
  assert.equal(changed.revision, 2);
  assert.notEqual(changed.fingerprint, first.fingerprint);
  assert.equal(changed.draftExtraBorrowers, 1);
  assert.equal(changed.missingExtraBorrowers, 1);
  const statuses = Object.fromEntries(changed.rows.map(({ key, status }) => [key, status]));
  assert.equal(statuses.occupancy, "Changed");
  assert.equal(statuses.street, "Missing in draft");
  assert.equal(statuses.unit, "Added in draft");
  assert.doesNotMatch(JSON.stringify(changed), /Private|private@example|000-00-9876/);
  update(id, (draft) => draft, 3);
  assert.equal(read(id).revision, 3);
  assert.equal(read(id).fingerprint, changed.fingerprint);
  update(id, (draft) => ({ ...draft, employer: "Unmapped employment change" }));
  const manualChange = read(id);
  assert.notEqual(manualChange.fingerprint, changed.fingerprint);
  assert.deepEqual(manualChange.rows, changed.rows);
  update(id, (draft) => ({ ...draft, urla: { ...draft.urla, credit: { ...draft.urla.credit, fields: { type: "Individual" } } } }));
  assert.equal(read(id).draftExtraBorrowers, 0);
  assert.equal(read(id).missingExtraBorrowers, 2);
});

test("MISMO co-borrower metadata preserves replay, duplicate review, and an unknown legacy source count", async (t) => {
  const { db, send, request, read, update } = fixture(t);
  const contactId = crypto.randomUUID();
  insertContact(db, { id: contactId, name: "Riley Example", email: "riley@example.test", phone: "", role: "Borrower" });
  const known = request({ existingContactId: contactId, extraBorrowers: 0 });
  const result = await send(known);
  assert.ok(result.applicationLoanId, result.error);
  assert.equal(read(result.applicationLoanId).sourceExtraBorrowers, 0);
  assert.equal((await send(known)).applicationLoanId, result.applicationLoanId);
  assert.equal((await send({ ...known, extraBorrowers: undefined })).applicationLoanId, result.applicationLoanId);
  assert.match((await send({ ...known, extraBorrowers: 1 })).error, /different file or borrower/);
  assert.equal((await send({ ...known, requestId: crypto.randomUUID(), extraBorrowers: 1 })).mismoDuplicateLoanId, result.applicationLoanId);

  const legacy = request({ fields: { ...fields, middleName: undefined, suffix: undefined } });
  const old = await send(legacy);
  assert.ok(old.applicationLoanId, old.error);
  const id = old.applicationLoanId;
  assert.equal((await send({ ...legacy, extraBorrowers: 3 })).applicationLoanId, id);
  assert.equal(read(id).sourceExtraBorrowers, null);
  update(id, (draft) => {
    delete draft.urla;
    delete draft.propertyLocation;
    return { ...draft, coBorrowerName: "Legacy co-borrower", propertyAddress: "102 Fictional Avenue, Troy, MI 48084" };
  });
  assert.equal(read(id).draftExtraBorrowers, 1);
  assert.equal(read(id).missingExtraBorrowers, 0);
  assert.ok(read(id).rows.filter(({ key }) => ["street", "city", "state", "zip"].includes(key)).every(({ status }) => status === "Matched"));

  db.exec(`ALTER TABLE migration_cutover_loan_reviews DROP COLUMN applicationRevision;
    ALTER TABLE migration_cutover_loan_reviews DROP COLUMN applicationFingerprint;
    ALTER TABLE mismo_rehearsals DROP COLUMN sourceExtraBorrowers;`);
  initializeStore(db, false);
  initializeStore(db, false);
  assert.equal(read(id).sourceExtraBorrowers, null);
  assert.equal(read(id).draftExtraBorrowers, 1);
  assert.ok(db.prepare("SELECT applicationFingerprint, applicationRevision FROM migration_cutover_loan_reviews").all());
  assert.equal(read("missing-loan"), null);
  db.prepare("UPDATE mismo_rehearsals SET fields = 'invalid JSON' WHERE loanId = ?").run(id);
  assert.equal(read(id), null);
});

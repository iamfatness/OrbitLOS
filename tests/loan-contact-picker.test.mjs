import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { executeCommand } = await import("../src/lib/commands.ts");
const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { readLoanContactPicker } = await import("../src/lib/loan-contact-picker.ts");
const { getApplication } = await import("../src/lib/applications.ts");

test("loan contact options page, pin current choices, and enforce current contact access", (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const staff = { email: "officer@example.test", name: "Fictional officer", brokerage: { id: "fixture", role: "LO", pilot: true } };
  for (let i = 1; i <= 24; i++) {
    const id = String(i).padStart(2, "0");
    insertContact(db, { id, name: `Borrower ${id}`, role: "Borrower", email: `borrower-${id}@example.test`, phone: "", addedBy: staff.email });
  }
  insertContact(db, { id: "20b", name: "borrower 20", role: "Borrower", email: "", phone: "", addedBy: staff.email });
  insertContact(db, { id: "linked", name: "Ésmé Linked", role: "Co-borrower", email: "", phone: "(248) 555-0199" });
  insertContact(db, { id: "hidden", name: "Ésmé Restricted", role: "Borrower", email: "", phone: "" });
  insertContact(db, { id: "partner", name: "Linked Realtor", role: "Realtor", email: "", phone: "" });
  insertLoan(db, { id: "existing", contactId: "linked", partnerId: "partner", officer: staff.name, officerEmail: staff.email,
    stage: "Lead", stageSince: "2026-11-01T10:00:00.000Z", amount: 250000, purpose: "Purchase", address: "" });
  const query = { kind: "borrower", search: "", selectedId: "linked" };
  const first = readLoanContactPicker(db, query, staff);
  assert.equal(first.options.length, 20);
  assert.equal(first.selected.name, "Ésmé Linked");
  assert.equal(first.selectedHasLoan, true);
  const next = readLoanContactPicker(db, { ...query, after: first.next }, staff);
  assert.equal(next.next, null);
  assert.equal(next.options[0].id, "20b");
  assert.equal(new Set([...first.options, ...next.options].map(({ id }) => id)).size, 26);
  assert.deepEqual(readLoanContactPicker(db, { ...query, search: "ESME", selectedId: "hidden" }, staff).options.map(({ id }) => id), ["linked"]);
  assert.equal(readLoanContactPicker(db, { ...query, search: "2485550199", selectedId: "hidden" }, staff).selected, null);
  assert.deepEqual(readLoanContactPicker(db, { ...query, search: "2485550199" }, staff).options.map(({ id }) => id), ["linked"]);
  assert.deepEqual(readLoanContactPicker(db, { kind: "realtor", search: "" }, staff).options.map(({ id }) => id), ["partner"]);
  assert.ok(readLoanContactPicker(db, query, { ...staff, brokerage: { ...staff.brokerage, role: "Processor" } }).error);
});

test("a scoped loan form save opens a prefilled 1003 and protects its borrower on edit", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const staff = { email: "officer@example.test", name: "Fictional officer", brokerage: { id: "fixture", role: "LO", pilot: true } };
  const insert = (id, name, role, addedBy = staff.email) => insertContact(db, {
    id, name, role, addedBy, email: `${id}@example.test`, phone: "2485550180",
  });
  insert("borrower", "Fictional borrower", "Borrower");
  insert("second", "Another borrower", "Borrower");
  insert("partner", "Fictional realtor", "Realtor");
  insert("hidden", "Unassigned borrower", "Borrower", "other@example.test");
  const input = { type: "loan", address: "", amount: 250000, purpose: "Refinance", stage: "Lead", officer: staff.name,
    contactId: "borrower", borrower: "", partnerId: "partner", start1003: true };
  const save = (data) => executeCommand(db, data, staff, undefined, [], { scopedLoanUpdates: true });
  assert.ok((await save({ ...input, contactId: "hidden" })).error);
  const created = await save(input);
  assert.ok(created.loanWork, created.error);
  assert.equal(created.state, undefined);
  assert.equal(created.loanFormSaved, true);
  const loan = created.loanWork.loans[0];
  assert.equal(loan.officerEmail, staff.email);
  assert.equal(loan.partnerId, "partner");
  assert.ok(created.loanWork.tasks.some(({ id }) => id === `first-contact:${loan.id}`));
  const application = getApplication(db, loan.id);
  assert.equal(created.applicationToken, application.token);
  const draft = JSON.parse(application.draft);
  assert.equal(draft.borrowerName, "Fictional borrower");
  assert.equal(draft.email, "borrower@example.test");
  const edit = { ...input, id: loan.id, start1003: false, address: "1 Fictional Way" };
  const saved = await save(edit);
  assert.ok(saved.loanWork, saved.error);
  assert.equal(saved.loanWork.loans[0].address, edit.address);
  assert.equal(saved.loanWork.loans[0].partnerId, "partner");
  assert.equal(getApplication(db, loan.id).token, application.token);
  assert.match((await save({ ...edit, contactId: "second" })).error, /1003 link belongs/);
});

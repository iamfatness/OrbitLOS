import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { readContactDirectory } = await import("../src/lib/contact-directory.ts");
const { readWorkspaceSearch } = await import("../src/lib/workspace-search.ts");
const { executeCommand } = await import("../src/lib/commands.ts");

test("directory pages through tied names and searches within the current role scope", (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const officer = { name: "Fictional LO", email: "officer@example.test", brokerage: { id: "fixture", role: "LO", pilot: true } };
  const processor = { name: "Fictional processor", email: "processor@example.test", brokerage: { ...officer.brokerage, role: "Processor" } };
  for (let i = 1; i <= 32; i++) {
    const id = String(i).padStart(2, "0");
    insertContact(db, { id, name: i % 2 ? "A. Sample" : "a. sample", role: "Borrower", email: "", phone: "", addedBy: officer.email });
  }
  insertContact(db, { id: "linked", name: "Ésmé Linked", role: "Co-borrower", email: "", phone: "(248) 555-0199" });
  insertContact(db, { id: "partner", name: "Fictional partner", role: "Realtor", email: "", phone: "" });
  insertContact(db, { id: "hidden", name: "Ésmé Hidden", role: "Co-borrower", email: "", phone: "(248) 555-0199" });
  for (let i = 1; i <= 23; i++) {
    insertLoan(db, { id: `loan-${String(i).padStart(2, "0")}`, contactId: "linked", partnerId: "partner",
      officer: officer.name, officerEmail: officer.email, stage: "Lead", stageSince: "2026-11-01T10:00:00.000Z",
      amount: 250000, purpose: "Purchase", address: "" });
  }
  db.prepare("UPDATE loans SET createdAt = NULL").run();
  db.prepare("INSERT INTO loan_processing VALUES (?, ?, ?, 'Assigned', '', ?, 1)")
    .run("loan-21", processor.email, processor.name, "2026-11-01T10:00:00.000Z");

  const list = { type: "list", search: "" };
  const first = readContactDirectory(db, list, officer);
  const second = readContactDirectory(db, { ...list, after: first.next }, officer);
  assert.equal(first.rows.length, 30);
  assert.deepEqual(second.rows.map(({ id }) => id), ["31", "32", "partner", "linked"]);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.rows, ...second.rows].map(({ id }) => id)).size, 34);
  for (const search of ["esme", "2485550199", "Co-borrower"]) {
    assert.deepEqual(readContactDirectory(db, { ...list, search }, officer).rows.map(({ id }) => id), ["linked"]);
  }
  assert.deepEqual(readContactDirectory(db, list, processor).rows.map(({ id }) => id), ["partner", "linked"]);
  const open = { type: "open", id: "linked" };
  assert.ok(readContactDirectory(db, { ...open, id: "hidden" }, officer).error);
  assert.deepEqual(readContactDirectory(db, open, processor).loans.map(({ id }) => id), ["loan-21"]);
  const contact = readContactDirectory(db, open, officer);
  assert.deepEqual(Object.keys(contact.contact).sort(), ["email", "id", "name", "outreachSuppressed", "phone", "role"]);
  assert.equal(contact.loans.length, 20);
  const more = readContactDirectory(db, { ...open, after: contact.nextLoan }, officer);
  assert.deepEqual(more.loans.map(({ id }) => id), ["loan-21", "loan-22", "loan-23"]);
  assert.equal(more.nextLoan, null);
  assert.deepEqual(readWorkspaceSearch(db, { ...open, kind: "contact" }, officer, officer.brokerage.id), contact);
  assert.equal(readContactDirectory(db, { ...open, id: "hidden" }, null).contact.id, "hidden");
});

test("contact CSV previews and exports follow role scope while import checks the whole brokerage once", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const staff = (role, email) => ({ name: "Fictional staff", email, brokerage: { id: "fixture", role, pilot: true } });
  const officer = staff("LO", "officer@example.test");
  const other = staff("LO", "other@example.test");
  const processor = staff("Processor", "processor@example.test");
  const admin = staff("Admin", "admin@example.test");
  const visible = { name: "=Fictional, \"Visible\"", email: "visible@example.test", phone: "+1 (248) 555-0177", role: "Borrower" };
  const hidden = { name: "Fictional private", email: "private@example.test", phone: "555-0555", role: "Borrower" };
  insertContact(db, { ...visible, id: "visible", addedBy: officer.email });
  insertContact(db, { ...hidden, id: "hidden", addedBy: other.email });
  const rows = [
    { name: "Existing phone", email: "", phone: "2485550177", role: "Co-borrower" },
    { name: "Private email match", email: hidden.email, phone: "", role: "Borrower" },
    { name: "A different role", email: visible.email, phone: "", role: "Realtor" },
    { name: "a DIFFERENT role", email: "", phone: "", role: "Realtor" },
    { name: "Keep separate", email: visible.email, phone: "", role: "Co-borrower", separate: true },
  ];
  const preview = { type: "previewCsv", rows };
  assert.deepEqual(readContactDirectory(db, preview, officer), { kind: "previewCsv", duplicates: [true, false, false, true, true] });
  assert.deepEqual(readContactDirectory(db, preview, admin).duplicates, [true, true, false, true, true]);
  assert.ok(readContactDirectory(db, preview, processor).error);
  const exportRequest = { type: "exportCsv" };
  assert.equal(readContactDirectory(db, exportRequest, officer).csv,
    `name,email,phone,role\r\n"'=Fictional, ""Visible""","visible@example.test","'+1 (248) 555-0177","Borrower"`);
  assert.match(readContactDirectory(db, exportRequest, admin).csv, /private@example\.test/);
  assert.ok(readContactDirectory(db, exportRequest, processor).error);

  const input = { type: "importContacts", batchId: crypto.randomUUID(), rows };
  const write = (actor, command) => executeCommand(db, command, actor, undefined, [], { scopedContactUpdates: true });
  assert.ok((await write(processor, input)).error);
  const imported = await write(officer, input);
  assert.deepEqual(imported, { contactsChanged: true, contactId: undefined, message: "2 contacts imported · 3 possible duplicates skipped." });
  assert.deepEqual(await write(officer, input), imported);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Imported contacts'").get().count, 1);
  assert.doesNotMatch(readContactDirectory(db, exportRequest, other).csv, /Keep separate|A different role/);
  assert.match(readContactDirectory(db, exportRequest, officer).csv, /Keep separate/);
  assert.match(readContactDirectory(db, exportRequest, officer).csv, /A different role/);
});

test("scoped admin contact saves refresh the directory and enforce current contact guards", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const admin = { name: "Fictional admin", email: "admin@example.test", brokerage: { id: "fixture", role: "Admin", pilot: true } };
  const officer = { ...admin, brokerage: { ...admin.brokerage, role: "LO" } };
  const write = (input, actor = admin) => executeCommand(db, input, actor, undefined, [], { scopedContactUpdates: true });
  const input = { type: "contact", name: "Fictional original", email: "updated@example.test", phone: "", role: "Borrower" };
  assert.ok((await write(input, officer)).error);
  const created = await write(input);
  assert.equal(created.contactsChanged, true);
  assert.equal(created.state, undefined);
  const id = created.contactId;
  assert.equal(readContactDirectory(db, { type: "open", id }, admin).contact.name, input.name);
  const edit = { ...input, id, name: "Fictional updated" };
  assert.equal((await write(edit)).contactId, id);
  assert.equal(readContactDirectory(db, { type: "list", search: input.name }, admin).rows.length, 0);
  assert.equal(readContactDirectory(db, { type: "list", search: edit.name }, admin).rows[0].id, id);
  assert.equal((await write({ type: "deleteContact", id })).contactId, id);
  assert.ok(readContactDirectory(db, { type: "open", id }, admin).error);
  assert.ok((await write(edit)).error);
});

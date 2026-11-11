import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { readLoanAssignments } = await import("../src/lib/loan-assignments.ts");
const { assignProcessor, readProcessorAssignmentReceipt } = await import("../src/lib/loan-processing.ts");
const { assignLoan, loanAccess } = await import("../src/lib/workspace-access.ts");

const brokerageId = "fictional-team";
const member = (name, email, role) => ({ name, email, role, status: "Active" });
const staff = (identity) => ({ ...identity, brokerage: { id: brokerageId, role: identity.role, pilot: true } });
const owner = member("Fictional Owner", "admin@example.test", "Admin");
const officer = member("Fictional Officer", "officer@example.test", "LO");
const processor = member("Fictional Processor", "processor@example.test", "Processor");
const backup = member("Fictional Backup Processor", "backup@example.test", "Processor");
const at = "2026-11-09T15:00:00.000Z";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  function loan(id, name = "Fictional Borrower") {
    insertContact(db, { id: `borrower-${id}`, name, email: "private@example.test", phone: "555-0100", role: "Borrower" });
    insertLoan(db, { id, contactId: `borrower-${id}`, partnerId: null, officer: officer.name, officerEmail: officer.email,
      stage: "Processing", stageSince: at, address: "Sample Way", amount: 200000, purpose: "Purchase" });
  }
  const list = (search = "", after) => readLoanAssignments(db, { type: "list", search, after }, staff(owner), brokerageId);
  const open = (loanId, actor = owner, id = brokerageId) => readLoanAssignments(db, { type: "open", loanId }, staff(actor), id);
  return { db, loan, list, open };
}

test("the assignment directory pages tied files and opens an exact off-page loan without unrelated data", (t) => {
  const { loan, list, open } = fixture(t);
  for (let index = 0; index < 32; index++) loan(`loan-${String(index).padStart(2, "0")}`);
  loan("last", "ÉLODIE Pilot");
  const first = list();
  assert.equal(first.loans.length, 20);
  const next = list("", first.next);
  assert.equal(next.loans.length, 13);
  assert.equal(new Set([...first.loans, ...next.loans].map(({ id }) => id)).size, 33);
  assert.equal(next.next, null);
  assert.equal(open("loan-31").loan.id, "loan-31");
  assert.deepEqual(list("élodie").loans.map(({ id }) => id), ["last"]);
  assert.doesNotMatch(JSON.stringify([first, next, open("loan-31")]), /private@example.test|555-0100|"tasks"|"draft"/);
  assert.ok(open("loan-31", officer).error);
  assert.ok(open("loan-31", processor).error);
  assert.ok(open("loan-31", owner, "different-team").error);
  assert.ok(open("missing").error);
});

test("assignment details reflect the committed roles, reject stale writes, and preserve the active handoff", (t) => {
  const { db, loan, open } = fixture(t);
  const loanId = "ready";
  loan(loanId);
  db.prepare("INSERT INTO loan_processing VALUES (?, ?, ?, 'Ready for processing', 'Private handoff note', ?, 2)")
    .run(loanId, processor.email, processor.name, at);
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES ('follow-up', ?, 'Fictional task', ?)").run(loanId, at);
  assert.equal(open(loanId).processing.revision, 2);
  assert.ok(assignProcessor(db, staff(owner), { loanId, revision: 1, member: backup }).error);
  assert.ok(assignProcessor(db, staff(owner), { loanId, revision: 2, member: backup }).message);
  assert.ok(assignProcessor(db, staff(owner), { loanId, revision: 2, member: backup }).message);
  const current = open(loanId);
  assert.equal(current.processing.processorEmail, backup.email);
  assert.equal(current.processing.status, "Ready for processing");
  assert.equal(current.processing.updatedAt, at);
  assert.equal(current.processing.revision, 3);
  assert.equal(db.prepare("SELECT note FROM loan_processing WHERE loanId = ?").get(loanId).note, "Private handoff note");
  assert.equal(loanAccess(db, staff(processor), loanId), null);
  assert.equal(loanAccess(db, staff(backup), loanId), "processor");
  assert.ok(assignLoan(db, staff(owner), { loanId, previousEmail: null, member: owner }).error);
  assert.ok(assignLoan(db, staff(owner), { loanId, previousEmail: officer.email, member: owner }).message);
  assert.equal(open(loanId).loan.officerEmail, owner.email);
  assert.equal(db.prepare("SELECT dueAt FROM tasks WHERE id = 'follow-up'").get().dueAt, at);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Assigned shared processor'").get().count, 1);
});

test("processor assignment receipts prove the exact save across retries and newer changes", (t) => {
  const { db, loan, open } = fixture(t);
  const loanId = "receipt-file";
  loan(loanId);
  loan("other-file");
  const actor = staff(owner);
  const input = { loanId, revision: 0, member: processor, requestId: crypto.randomUUID() };
  const receipt = () => readProcessorAssignmentReceipt(db, actor, loanId, input.requestId).outcome;
  assert.equal(receipt(), "missing");
  assert.match(assignProcessor(db, actor, input).message, /granted/);
  assert.equal(receipt(), "saved");
  assert.equal(assignProcessor(db, actor, input).message, "Processor access confirmed.");
  assert.ok(assignProcessor(db, actor, { ...input, member: backup }).error);
  assert.equal(readProcessorAssignmentReceipt(db, actor, "other-file", input.requestId).outcome, "missing");
  assert.equal(readProcessorAssignmentReceipt(db, staff({ ...owner, email: "other-owner@example.test" }), loanId, input.requestId).outcome, "missing");

  assert.ok(assignProcessor(db, actor, { loanId, revision: 1, member: backup, requestId: crypto.randomUUID() }).message);
  assert.equal(receipt(), "newer");
  assert.ok(assignProcessor(db, actor, input).error);
  assert.ok(assignProcessor(db, actor, { ...input, member: backup, requestId: crypto.randomUUID() }).error);
  assert.equal(open(loanId).processing.processorEmail, backup.email);
  assert.equal(db.prepare("SELECT count(*) AS n FROM workspace_access_history WHERE action = 'Assigned shared processor'").get().n, 2);
});

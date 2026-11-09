import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { readDraftQueue } = await import("../src/lib/communication-draft-query.ts");
const { currentDraftMilestone } = await import("../src/lib/communication-templates.ts");
const { draftMilestones, stages } = await import("../src/lib/model.ts");
const { executeCommand } = await import("../src/lib/commands.ts");

const at = "2026-11-09T17:00:00.000Z";
const tenant = "fictional";
const staff = (role) => ({ name: `Fictional ${role}`, email: `${role.toLowerCase()}@example.test`, brokerage: { id: tenant, role, pilot: true } });
const officer = staff("LO");
const other = { ...officer, email: "other@example.test" };
const admin = staff("Admin");
const processor = staff("Processor");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  function contact(id, role = "Borrower") {
    insertContact(db, { id, name: `Fictional ${id}`, email: `${id}@example.test`, phone: "", role });
    return id;
  }
  function loan(id, owner = officer, stage = "Underwriting", partnerId = null) {
    insertLoan(db, { id, contactId: contact(`${id}-borrower`), partnerId, officer: owner.name, officerEmail: owner.email,
      stage, stageSince: at, address: "", amount: 250000, purpose: "Purchase" });
    return id;
  }
  function draft(id, loanId, { contactId = `${loanId}-borrower`, audience = "Borrower", milestone = "Application received",
    emailCopiedAt = null, textCopiedAt = null, supersededAt = null } = {}) {
    db.prepare(`INSERT INTO communication_drafts (id, loanId, contactId, audience, milestone, createdAt, eventKey, emailCopiedAt, textCopiedAt, supersededAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, loanId, contactId, audience, milestone, at, id, emailCopiedAt, textCopiedAt, supersededAt);
    return id;
  }
  return { db, contact, loan, draft };
}

test("draft views filter before stable paging and redact historical recipients outside scope", (t) => {
  const { db, contact, loan, draft } = fixture(t);
  const partner = contact("current-partner", "Realtor");
  const former = contact("former-partner", "Realtor");
  const owned = loan("owned", officer, "Underwriting", partner);
  const outside = loan("outside", other, "Underwriting", former);
  for (let i = 0; i < 23; i++) draft(`ready-${String(i).padStart(2, "0")}`, owned);
  draft("copied-text", owned, { textCopiedAt: at });
  draft("closing-without-date", owned, { milestone: "Closing complete" });
  draft("superseded", owned, { milestone: "Lender review started", supersededAt: at });
  draft("earlier-stage", owned, { milestone: "Processing" });
  draft("former-recipient", owned, { contactId: former, audience: "Realtor", emailCopiedAt: at });
  draft("zz-private-draft", outside);
  db.prepare("INSERT INTO loan_processing VALUES (?, ?, ?, 'Assigned', '', ?, 1)").run(owned, processor.email, processor.name, at);
  const read = (view, actor = officer, after) => readDraftQueue(db, { view, after }, actor);
  const first = read("Ready to copy");
  const second = read("Ready to copy", officer, first.next);
  assert.equal(first.rows.length, 20);
  assert.equal(first.rows[0].id, "ready-22");
  assert.deepEqual(second.rows.map(({ id }) => id), ["ready-02", "ready-01", "ready-00"]);
  assert.equal(second.next, null);
  assert.equal(first.templates, undefined);
  assert.ok(read("All drafts", admin).templates);
  assert.ok(read("Ready to copy", admin).rows.some(({ id }) => id === "zz-private-draft"));
  assert.equal(read("Ready to copy", processor).rows.length, 20);
  for (const actor of [officer, processor]) {
    const copied = read("Copied", actor);
    assert.deepEqual(copied.rows.map(({ id }) => id), ["former-recipient", "copied-text"]);
    assert.equal(copied.rows[0].recipient, null);
    assert.equal(copied.rows[0].linked, false);
    assert.equal(copied.rows[1].recipient, "Fictional owned-borrower");
  }
  assert.equal(read("Copied", admin).rows[0].recipient, "Fictional former-partner");
  db.prepare("UPDATE loan_processing SET processorEmail = ? WHERE loanId = ?").run(other.email, owned);
  assert.equal(read("All drafts", processor).rows.length, 0);
});

test("SQL current milestones match the loan preview at every stage and closing state", (t) => {
  const { db, loan, draft } = fixture(t);
  const id = loan("match");
  for (const [index, milestone] of draftMilestones.entries()) draft(`draft-${index}`, id, { milestone });
  const read = (after) => readDraftQueue(db, { view: "All drafts", after }, officer);
  for (const stage of stages) {
    db.prepare("UPDATE loans SET stage = ? WHERE id = ?").run(stage, id);
    for (const closingDate of ["", "2026-11-08"]) {
      db.prepare(`INSERT INTO past_client_profiles (loanId, closingDate) VALUES (?, ?)
        ON CONFLICT(loanId) DO UPDATE SET closingDate = excluded.closingDate`).run(id, closingDate);
      const first = read();
      const rows = first.next ? [...first.rows, ...read(first.next).rows] : first.rows;
      assert.equal(rows.length, draftMilestones.length);
      for (const row of rows) assert.equal(row.current, currentDraftMilestone(row.milestone, stage, !!closingDate), `${stage} ${row.milestone}`);
    }
  }
});

test("template revisions and draft copy receipts stay scoped and preserve independent copy stamps", async (t) => {
  const { db, contact, loan, draft } = fixture(t);
  const id = loan("copy");
  const draftId = draft(crypto.randomUUID(), id);
  const write = (actor, input) => executeCommand(db, input, actor, undefined, [], { scopedLoanUpdates: true, scopedTemplateUpdates: true });
  const input = { type: "saveBrokerageTemplate", audience: "Borrower", milestone: "Application received", body: "Fictional update.", revision: 0 };
  assert.ok((await write(officer, input)).error);
  const saved = await write(admin, input);
  assert.equal(saved.state, undefined);
  assert.equal(saved.template.revision, 1);
  assert.equal((await write(admin, input)).template.revision, 1);
  assert.ok((await write(admin, { ...input, body: "Stale revision" })).error);
  const copy = { type: "copyDraft", loanId: id, contactId: "copy-borrower", audience: "Borrower",
    milestone: "Application received", channel: "Email", draftId };
  assert.ok((await write(other, copy)).error);
  const first = await write(officer, copy);
  assert.equal(first.state, undefined);
  assert.equal(first.loanWork.brokerageTemplates[0].body, input.body);
  const emailAt = first.loanWork.communicationDrafts[0].emailCopiedAt;
  assert.ok(emailAt);
  assert.equal((await write(officer, copy)).loanWork.communicationDrafts[0].emailCopiedAt, emailAt);
  const text = await write(officer, { ...copy, channel: "Text" });
  assert.ok(text.loanWork.communicationDrafts[0].textCopiedAt);
  assert.equal(text.loanWork.communicationDrafts[0].emailCopiedAt, emailAt);
  assert.equal(db.prepare("SELECT count(*) AS total FROM activity WHERE loanId = ? AND text LIKE 'Copied %'").get(id).total, 2);
  assert.equal(readDraftQueue(db, { view: "Ready to copy" }, officer).rows.length, 0);
  assert.equal(readDraftQueue(db, { view: "Copied" }, officer).rows[0].id, draftId);
  db.prepare("UPDATE loans SET contactId = ? WHERE id = ?").run(contact("new-recipient"), id);
  assert.match((await write(officer, copy)).error, /recipient has changed/);
  assert.equal(readDraftQueue(db, { view: "Copied" }, officer).rows[0].recipient, null);
  assert.equal((await write(admin, { ...input, body: "", revision: 1 })).template.body, "");
});

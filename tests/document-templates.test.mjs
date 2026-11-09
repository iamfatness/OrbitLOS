import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { blankApplication } = await import("../src/lib/application-model.ts");
const { borrowerCommandResult } = await import("../src/lib/applications.ts");
const { documentTemplateWork, applyDocumentTemplate } = await import("../src/lib/document-templates.ts");
const { nameFileExceptions, readFileExceptions } = await import("../src/lib/file-exceptions.ts");

const at = "2026-11-10T04:55:00.000Z";
const asOf = "2026-11-09";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const brokerage = { id: crypto.randomUUID(), name: "Fictional Brokerage", role: "Admin", pilot: true };
  const admin = { name: "Fictional Admin", email: "admin@example.test", brokerage };
  const officer = { name: "Fictional LO", email: "officer@example.test", brokerage: { ...brokerage, role: "LO" } };
  const processor = { name: "Fictional Processor", email: "processor@example.test", brokerage: { ...brokerage, role: "Processor" } };
  const templateId = crypto.randomUUID();
  const config = { title: "Purchase starter documents", purpose: "Purchase", items: [
    { kind: "Photo ID", instructions: "Use sample ID.", dueDays: 0 },
    { kind: "Bank statement", instructions: "Use a sample statement.", dueDays: 3 },
    { kind: "Pay stub", instructions: "Use a sample pay statement.", dueDays: null },
  ] };
  const publish = { type: "publish", id: templateId, revision: 0, config };
  const work = (input, actor = admin, id = brokerage.id) => documentTemplateWork(db, input, actor, id, new Date(at));
  const apply = (loanId, actor, overrides = {}) => db.transaction(() =>
    applyDocumentTemplate(db, { loanId, templateId, revision: 1, asOf, ...overrides }, actor, at));
  const loan = (purpose = "Purchase") => {
    const id = crypto.randomUUID();
    const token = id.replaceAll("-", "").repeat(2);
    insertContact(db, { id, name: "Fictional Borrower", email: "borrower@example.test", phone: "", role: "Borrower" });
    insertLoan(db, { id, contactId: id, partnerId: null, officer: officer.name, officerEmail: officer.email,
      address: "", amount: 300000, purpose, stage: "Processing", stageSince: at });
    db.prepare("INSERT INTO applications (loanId, token, draft, expiresAt, updatedAt, submittedAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, token, JSON.stringify(blankApplication()), "2099-01-01T00:00:00.000Z", at, at);
    return { id, token };
  };
  return { db, admin, officer, processor, templateId, config, publish, work, apply, loan };
}

test("brokerage admins publish immutable versions and can retire and restore a checklist", (t) => {
  const { db, admin, officer, processor, templateId, config, publish, work, loan } = fixture(t);
  const purchase = loan();
  const refinance = loan("Refinance");
  assert.ok(work(publish, officer).error);
  assert.ok(work(publish, admin, crypto.randomUUID()).error);
  assert.ok(work(publish, { ...admin, brokerage: { ...admin.brokerage, pilot: false } }).error);
  assert.ok(work({ ...publish, config: { ...config, items: [config.items[0], config.items[0]] } }).error);
  assert.equal(work(publish).templates[0].revision, 1);
  assert.equal(work(publish).templates[0].revision, 1);
  assert.ok(work({ ...publish, id: crypto.randomUUID(), config: { ...config, title: config.title.toUpperCase() } }).error);
  assert.equal(work({ type: "loan", loanId: purchase.id }, officer).templates[0].id, templateId);
  assert.deepEqual(work({ type: "loan", loanId: refinance.id }, officer).templates, []);
  assert.ok(work({ type: "loan", loanId: purchase.id }, processor).error);
  const update = { ...publish, revision: 1, config: { ...config, title: "Updated purchase documents" } };
  assert.equal(work(update).templates[0].revision, 2);
  assert.match(work({ ...publish, revision: 1 }).error, /template changed/);
  const archive = { type: "archive", id: templateId, revision: 2, archived: true };
  assert.equal(work(archive).templates[0].archived, true);
  assert.equal(work(archive).templates[0].revision, 3);
  assert.deepEqual(work({ type: "loan", loanId: purchase.id }, officer).templates, []);
  assert.equal(work({ ...archive, revision: 3, archived: false }).templates[0].revision, 4);
  const versions = db.prepare("SELECT config FROM document_checklist_versions WHERE templateId = ? ORDER BY revision").all(templateId);
  assert.deepEqual(versions.map(({ config }) => JSON.parse(config).title), [config.title, update.config.title, update.config.title, update.config.title]);
});

test("applying a checklist preserves existing requests and exposes only borrower fields", (t) => {
  const { db, admin, officer, processor, config, publish, work, apply, loan } = fixture(t);
  const { id, token } = loan();
  work(publish);
  assert.ok(apply(id, processor).error);
  assert.ok(apply(loan("Refinance").id, officer).error);
  assert.match(apply(id, officer, { asOf: "2026-11-10" }).error, /template changed/);
  db.prepare(`INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision)
    VALUES (?, ?, ?, 'In processing', '', ?, 1)`).run(id, processor.email, processor.name, at);
  const existingId = crypto.randomUUID();
  db.prepare("INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, dueOn) VALUES (?, ?, 'Pay stub', 'Keep this instruction', ?, '2026-11-16')")
    .run(existingId, id, at);
  assert.match(apply(id, processor).message, /^Added 2/);
  assert.match(apply(id, processor).message, /already on the checklist/);
  const before = db.prepare("SELECT id, kind, instructions, dueOn FROM document_requests WHERE loanId = ? ORDER BY kind").all(id);
  assert.deepEqual(before.map(({ kind, dueOn, instructions }) => [kind, dueOn, instructions]), [
    ["Bank statement", "2026-11-12", "Use a sample statement."], ["Pay stub", "2026-11-16", "Keep this instruction"],
    ["Photo ID", "2026-11-09", "Use sample ID."],
  ]);
  const { statusView: { loanStatus: { documents } } } = borrowerCommandResult(db, { type: "status", token });
  assert.equal(documents.length, 3);
  assert.equal(documents.find(({ kind }) => kind === "Photo ID").dueOn, asOf);
  assert.ok(documents.every((row) => !("templateTitle" in row) && !("templateRevision" in row)));
  work({ ...publish, revision: 1, config: { ...config, title: "Updated", items: [{ ...config.items[0], dueDays: 7 }] } });
  assert.ok(apply(id, processor).error);
  assert.deepEqual(db.prepare("SELECT id, kind, instructions, dueOn FROM document_requests WHERE loanId = ? ORDER BY kind").all(id), before);
  assert.equal(db.prepare("SELECT count(*) AS total FROM document_checklist_origins WHERE revision = 1").get().total, 2);
  assert.equal(db.prepare("SELECT count(*) AS total FROM activity WHERE loanId = ? AND text LIKE 'Applied %'").get(id).total, 1);
  const candidates = readFileExceptions(db, { filter: "Missing evidence" }, admin, admin.brokerage.id, new Date("2026-11-10T15:00:00Z"));
  const exceptions = nameFileExceptions(candidates, [{ name: officer.name, email: officer.email, role: "LO", status: "Active", accessRevision: 0 }]);
  const due = exceptions.items.find(({ title }) => title === "Photo ID");
  assert.equal(due?.owner, officer.name);
  assert.equal(due?.overdue, true);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("a failed batch rolls back every request and its provenance", (t) => {
  const { db, officer, publish, work, apply, loan } = fixture(t);
  const { id } = loan();
  work(publish);
  db.exec(`CREATE TRIGGER interrupted_checklist BEFORE INSERT ON document_requests WHEN NEW.kind = 'Bank statement'
    BEGIN SELECT RAISE(ABORT, 'fixture interruption'); END`);
  assert.throws(() => apply(id, officer), /fixture interruption/);
  for (const table of ["document_requests", "document_checklist_origins", "activity"]) {
    assert.equal(db.prepare(`SELECT count(*) AS total FROM ${table}`).get().total, 0);
  }
  db.exec("DROP TRIGGER interrupted_checklist");
  assert.match(apply(id, officer).message, /^Added 3/);
});

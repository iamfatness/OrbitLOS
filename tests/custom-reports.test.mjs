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

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { customReportWork } = await import("../src/lib/custom-reports.ts");
const { defaultCustomReport } = await import("../src/lib/custom-report-model.ts");
const { crmFieldWork } = await import("../src/lib/crm-fields.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = {
    prepare: (sql) => sqlite.prepare(sql), exec: (sql) => sqlite.exec(sql),
    transaction(run) {
      sqlite.exec("BEGIN");
      try { const result = run(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  initializeStore(db, false);
  const now = new Date("2026-11-10T12:00:00.000Z");
  const brokerageId = crypto.randomUUID();
  const staff = (name, role) => ({ name, email: `${name.toLowerCase()}@example.test`,
    brokerage: { id: brokerageId, name: "Fictional Reports", role, pilot: true } });
  const admin = staff("Admin", "Admin");
  const officer = staff("Officer", "LO");
  const other = staff("Other", "LO");
  const processor = staff("Processor", "Processor");
  const work = (input, actor = admin, workspace = brokerageId) => customReportWork(db, input, actor, workspace, now);
  const save = (definition = defaultCustomReport, options = {}, actor = admin) =>
    work({ type: "save", id: crypto.randomUUID(), revision: 0, ...options, definition }, actor);
  const run = ({ id, revision }, actor = admin, after) => work({ type: "run", id, revision, after }, actor);
  const records = ({ id, revision }, metric, actor = admin, more = {}) => work({ type: "records", id, revision, metric, ...more }, actor);
  const file = (id, owner, options = {}) => {
    insertContact(db, { id: `contact-${id}`, name: `Borrower ${id}`, email: "", phone: "", role: "Borrower" });
    insertLoan(db, { id, contactId: `contact-${id}`, partnerId: null, officer: owner?.name ?? "", officerEmail: owner?.email ?? null,
      address: "", amount: 300000, purpose: "Purchase", stage: "Processing", stageSince: now.toISOString(), ...options });
  };
  const inquiry = (id, owner, loanId = null, options = {}) => {
    const at = options.at ?? "2026-11-03T16:00:00.000Z";
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt,
      dueAt, importSource, loanId, resolvedAt) VALUES (?, ?, NULL, ?, '', '', 'Purchase', ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, id, `Lead ${id}`, owner?.name ?? "", owner?.email ?? null, at, at,
        options.source ?? "Website quote request", loanId, loanId || options.archived ? at : null);
  };
  return { db, now, brokerageId, admin, officer, other, processor, work, save, run, records, file, inquiry };
}

test("CRM filters keep counts and drilldowns scoped and refuse revoked or archived fields", (t) => {
  const { db, brokerageId, admin, officer, other, processor, work, save, run, records, inquiry, file } = fixture(t);
  const fieldId = crypto.randomUUID();
  const fields = (input, actor = admin, tenant = brokerageId) => crmFieldWork(db, input, actor, tenant);
  const definition = { label: "Outreach score", kind: "Number", options: [], roles: ["LO", "Processor"] };
  const create = { type: "saveField", fieldId, revision: 0, definition };
  assert.ok(fields(create, officer).error);
  assert.equal(fields(create).field.revision, 1);
  assert.ok(fields({ type: "list" }, officer, "other-tenant").error);
  inquiry("mine", officer);
  inquiry("unscoped", other);
  inquiry("other-score", officer);
  inquiry("shared", null);
  file("production", officer);
  file("unassigned", other);
  db.prepare("INSERT INTO loan_processing VALUES ('production', ?, ?, 'Accepted', '', ?, 1)")
    .run(processor.email, processor.name, "2026-11-10T12:00:00.000Z");
  const set = (record, recordId, value, options = {}) => ({
    type: "saveValue", record, recordId, fieldId, value, fieldRevision: 1, revision: 0, ...options,
  });
  const value = "999999999999.0001";
  assert.equal(fields(set("lead", "mine", value), officer).entries[0].value, value);
  assert.ok(fields(set("lead", "mine", "99"), officer).error);
  assert.ok(fields(set("lead", "unscoped", value), officer).error);
  assert.ok(fields(set("lead", "shared", value), officer).error);
  assert.ok(fields(set("lead", "other-score", "2e4"), officer).error);
  assert.equal(fields(set("lead", "other-score", "-00.0000"), officer).entries[0].value, "0");
  assert.equal(fields(set("lead", "other-score", null, { revision: 1 }), officer).entries[0].revision, 2);
  assert.ok(fields(set("lead", "other-score", value), officer).error);
  fields(set("lead", "unscoped", value));
  fields(set("contact", "contact-production", value));
  fields(set("contact", "contact-unassigned", value));
  assert.equal(fields({ type: "values", record: "contact", recordId: "contact-production" }, processor).editable, false);
  assert.ok(fields({ type: "values", record: "contact", recordId: "contact-unassigned" }, processor).error);
  assert.ok(fields(set("contact", "contact-production", "1", { revision: 1 }), processor).error);

  const customFilter = { fieldId, value };
  const setup = { ...defaultCustomReport, name: "Priority intake", roles: ["LO"], customFilter };
  const { report } = save(setup);
  assert.equal(run(report).totals.inquiries, 2);
  assert.equal(run(report, officer).totals.inquiries, 1);
  assert.deepEqual(records(report, "inquiries", officer).rows.map(({ id }) => id), ["mine"]);
  const { report: production } = save({ ...setup, name: "Priority production", dataset: "Loan production", metrics: ["files"], roles: ["Processor"] });
  assert.equal(run(production, processor).totals.files, 1);
  assert.deepEqual(records(production, "files", processor).rows.map(({ id }) => id), ["production"]);

  assert.equal(fields({ ...create, revision: 1, definition: { ...definition, roles: [] } }).field.revision, 2);
  assert.match(save({ ...setup, name: "Unavailable to LO" }).error, /every role/);
  assert.equal(work({ type: "list" }, officer).reports.length, 0);
  assert.ok(run(report, officer).error);
  assert.ok(records(report, "inquiries", officer).error);
  assert.ok(run(production, processor).error);
  assert.equal(run(report).totals.inquiries, 2);
  assert.equal(fields({ type: "archiveField", fieldId, revision: 2 }).kind, "archived");
  assert.ok(work({ type: "list" }).reports.some(({ id }) => id === report.id));
  assert.match(run(report).error, /CRM field is unavailable/);
  assert.match(records(report, "inquiries").error, /CRM field is unavailable/);
  const repaired = save({ ...setup, customFilter: undefined }, report);
  assert.equal(run(repaired.report, officer).totals.inquiries, 2);
});

test("intake report uses current ownership for open and converted leads and keeps drilldowns within the shared role", (t) => {
  const { db, now, brokerageId, admin, officer, other, processor, work, save, run, records, file, inquiry } = fixture(t);
  file("owned", officer);
  file("transferred", other);
  file("unassigned", null);
  inquiry("open", officer);
  inquiry("converted", other, "owned");
  inquiry("from-me", officer, "transferred", { source: "Campaign import" });
  inquiry("orphan", officer, "unassigned");
  inquiry("hidden", other);
  inquiry("shared", null);
  inquiry("archived", officer, null, { archived: true });
  db.exec(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt)
    VALUES ('owned', 'owned-token', '${now.toISOString()}', '{}', '${now.toISOString()}');
    INSERT INTO application_versions (loanId, revision, draft, submittedAt) VALUES ('owned', 1, '{}', '2026-12-01T15:00:00.000Z');
    INSERT INTO closing_progress (loanId, fundingDate) VALUES ('owned', '2026-12-08');`);
  const setup = { ...defaultCustomReport, name: "Fictional intake", roles: ["LO"], columns: ["Purpose"] };
  const { report } = save(setup);
  assert.equal(run(report).totals.inquiries, 6);
  assert.deepEqual(run(report, officer).totals, { inquiries: 2, converted: 1, cohortFunded: 1 });
  const scoped = run(report, officer);
  assert.deepEqual(scoped.groups.map(({ name }) => name), ["Website quote request"]);
  const drill = records(report, "inquiries", officer, { group: scoped.groups[0].key });
  assert.deepEqual(drill.rows.map(({ destination }) => destination), [{ kind: "lead", id: "open" }, { kind: "loan", id: "owned" }]);
  assert.deepEqual(drill.rows[0].values, { Purpose: "Purchase" });
  assert.deepEqual(records(report, "inquiries", officer, { group: "Campaign import" }).rows, []);
  assert.equal(work({ type: "list" }, officer).reports.length, 1);
  assert.deepEqual(work({ type: "list" }, processor).reports, []);
  assert.ok(run(report, processor).error);
  assert.ok(work({ type: "run", id: report.id, revision: report.revision }, admin, crypto.randomUUID()).error);
  assert.ok(work({ type: "list" }, null, brokerageId).error);
  assert.ok(save(setup, {}, officer).error);
  assert.ok(save({ ...setup, name: "Processor lead report", roles: ["Processor"] }).error);
  assert.match(save({ ...setup, name: "FICTIONAL INTAKE" }).error, /different name/);
  const edited = save({ ...setup, roles: [], source: "Website quote request" }, report);
  assert.equal(edited.report.revision, 2);
  assert.equal(run(edited.report).totals.inquiries, 5);
  assert.ok(run(report, officer).error);
  assert.ok(records(report, "inquiries", officer).error);
  assert.ok(run(report).error);
  assert.match(save({ ...setup, name: "Stale update" }, report).error, /changed/);
  assert.deepEqual(work({ type: "list" }, officer).reports, []);
  const archive = { type: "archive", id: report.id, revision: 2 };
  assert.equal(work(archive, officer).error, "This custom report is unavailable in your workspace.");
  assert.deepEqual(work(archive), { kind: "archived" });
  assert.deepEqual(work(archive), { kind: "archived" });
  assert.ok(run(edited.report).error);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Archived custom report'").get().count, 1);
});

test("production reports use event dates and restrict processors before aggregation and pagination", (t) => {
  const { db, now, officer, other, processor, save, run, records, file } = fixture(t);
  file("boundary", officer, { createdAt: "2026-11-01T04:00:00.000Z" });
  file("old", other, { createdAt: "2026-11-01T03:59:59.999Z" });
  file("december", officer, { createdAt: "2026-12-01T05:00:00.000Z" });
  for (let index = 0; index < 22; index++) file(`page-${String(index).padStart(2, "0")}`, index === 21 ? other : officer);
  db.exec(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt)
    VALUES ('old','old-token','${now.toISOString()}','{}','${now.toISOString()}','2026-12-04T15:00:00.000Z');
    INSERT INTO application_versions (loanId, revision, draft, submittedAt) VALUES ('old', 1, '{}', '2026-11-06T15:00:00.000Z');
    INSERT INTO closing_progress (loanId, fundingDate) VALUES ('old','2026-11-08'), ('december','2026-12-04');`);
  const assign = db.prepare("INSERT INTO loan_processing VALUES (?, ?, ?, 'Accepted', '', ?, 1)");
  for (const id of ["boundary", "old", ...Array.from({ length: 21 }, (_, index) => `page-${String(index).padStart(2, "0")}`)]) {
    assign.run(id, processor.email, processor.name, now.toISOString());
  }
  const { report } = save({ ...defaultCustomReport, name: "Fictional production", dataset: "Loan production", groupBy: "Current stage",
    metrics: ["files", "applications", "funding"], roles: ["LO", "Processor"], columns: ["Loan amount", "Current status"] });
  assert.deepEqual(run(report).totals, { files: 23, applications: 1, funding: 1 });
  assert.deepEqual(run(report, officer).totals, { files: 22, applications: 0, funding: 0 });
  const scoped = run(report, processor);
  assert.deepEqual(scoped.totals, { files: 22, applications: 1, funding: 1 });
  assert.equal(scoped.groups[0].name, "Processing");
  const page = records(report, "files", processor, { group: scoped.groups[0].key });
  assert.equal(page.rows.length, 20);
  assert.equal(page.rows[0].values["Loan amount"], 300000);
  const next = records(report, "files", processor, { group: scoped.groups[0].key, after: page.next });
  assert.equal(next.rows.length, 2);
  assert.equal(new Set([...page.rows, ...next.rows].map(({ id }) => id)).size, 22);
  assert.deepEqual(records(report, "applications", processor).rows.map(({ id, at }) => ({ id, at })),
    [{ id: "old", at: "2026-11-06T15:00:00.000Z" }]);
  assert.equal(records(report, "funding", processor).rows[0].destination.id, "old");
  db.exec("UPDATE closing_progress SET fundingDate = NULL WHERE loanId = 'old'");
  assert.equal(run(report, processor).totals.funding, 0);
  assert.deepEqual(records(report, "funding", processor).rows, []);
  db.exec("DELETE FROM loan_processing WHERE loanId = 'old'");
  assert.equal(run(report, processor).totals.applications, 0);
  assert.ok(records(report, "inquiries", processor).error);
});

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
const { reportScheduleWork } = await import("../src/lib/report-schedules.ts");
const { defaultCustomReport } = await import("../src/lib/custom-report-model.ts");
const { crmFieldWork } = await import("../src/lib/crm-fields.ts");
const { readCsv } = await import("../src/lib/contact-csv.ts");
const { saveCrmSegment } = await import("../src/lib/crm-segments.ts");

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
  const download = ({ id, revision }, actor = admin, options = {}) =>
    work({ type: "export", id, revision, from: "2026-11-01", through: "2026-11-30", ...options }, actor);
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
  return { db, now, brokerageId, admin, officer, other, processor, work, save, run, records, download, file, inquiry };
}

test("CRM filters keep counts and drilldowns scoped and refuse revoked or archived fields", (t) => {
  const { db, brokerageId, admin, officer, other, processor, work, save, run, records, download, inquiry, file } = fixture(t);
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
  const output = download(report, officer);
  assert.equal(output.count, 1);
  assert.deepEqual(readCsv(output.csv).at(-1).slice(3, 6), ["Lead mine", "lead", "mine"]);
  assert.doesNotMatch(output.csv, /Priority|999999999999\.0001|unscoped/);
  const { report: production } = save({ ...setup, name: "Priority production", dataset: "Loan production", metrics: ["files"], roles: ["Processor"] });
  assert.equal(run(production, processor).totals.files, 1);
  assert.deepEqual(records(production, "files", processor).rows.map(({ id }) => id), ["production"]);

  assert.equal(fields({ ...create, revision: 1, definition: { ...definition, roles: [] } }).field.revision, 2);
  assert.match(save({ ...setup, name: "Unavailable to LO" }).error, /every role/);
  assert.equal(work({ type: "list" }, officer).reports.length, 0);
  assert.ok(run(report, officer).error);
  assert.ok(records(report, "inquiries", officer).error);
  assert.ok(download(report, officer).error);
  assert.ok(download(production, processor).error);
  assert.ok(run(production, processor).error);
  assert.equal(run(report).totals.inquiries, 2);
  assert.equal(fields({ type: "archiveField", fieldId, revision: 2 }).kind, "archived");
  assert.ok(work({ type: "list" }).reports.some(({ id }) => id === report.id));
  assert.match(run(report).error, /CRM field is unavailable/);
  assert.match(records(report, "inquiries").error, /CRM field is unavailable/);
  assert.match(download(report).error, /CRM field is unavailable/);
  const repaired = save({ ...setup, customFilter: undefined }, report);
  assert.equal(run(repaired.report, officer).totals.inquiries, 2);
});

test("CSV exports include all authorized pages, honor the selected count, and encode safe cells", (t) => {
  const { db, admin, officer, other, processor, save, run, records, download, inquiry, file, work } = fixture(t);
  file("file-1", officer);
  inquiry("original", officer, "file-1", { source: "Campaign import" });
  inquiry("other", other);
  inquiry("shared", null);
  for (let index = 0; index < 23; index++) inquiry(`inquiry-${index}`, officer);
  db.prepare("UPDATE referral_leads SET name = ? WHERE id = 'inquiry-22'").run('=HYPERLINK("https://example.test","Fictional, café")');
  db.exec("INSERT INTO closing_progress (loanId, fundingDate) VALUES ('file-1','2026-11-08')");
  const { report } = save({ ...defaultCustomReport, name: "Officer pipeline / QA", groupBy: "Purpose", roles: ["LO"], columns: ["Purpose", "Loan amount"] });
  const all = download(report, officer);
  assert.equal(all.kind, "export");
  assert.equal(all.filename, "orbit-officer-pipeline-qa-v1-2026-11-01-2026-11-30.csv");
  const [header, ...rows] = readCsv(all.csv);
  assert.deepEqual(header, ["Metric", "Group (Purpose)", "Event date", "Name", "Record type", "Record ID", "Purpose", "Loan amount"]);
  const totals = run(report, officer).totals;
  assert.equal(all.count, totals.inquiries + totals.cohortFunded);
  assert.equal(rows.length, all.count);
  assert.ok(rows.some((row) => row[3] === '\'=HYPERLINK("https://example.test","Fictional, café")'));
  assert.ok(rows.every((row) => !["other", "shared"].includes(row[5])));
  assert.ok(rows.some((row) => row[4] === "loan" && row[5] === "file-1" && row[7] === "300000"));
  const grouped = download(report, officer, { metric: "inquiries", group: "Purchase" });
  const drill = records(report, "inquiries", officer, { group: "Purchase" });
  const next = records(report, "inquiries", officer, { group: "Purchase", after: drill.next });
  assert.deepEqual(readCsv(grouped.csv).slice(1).map((row) => row[5]),
    [...drill.rows, ...next.rows].map(({ destination }) => destination.id));
  const empty = download(report, officer, { metric: "converted" });
  assert.equal(empty.count, 0);
  assert.deepEqual(readCsv(empty.csv), [header]);
  assert.match(download(report, officer, { through: "2026-12-01" }).error, /Run the report again/);
  assert.ok(download(report, officer, { revision: report.revision + 1 }).error);
  assert.ok(download(report, officer, { metric: "funding" }).error);
  assert.ok(download(report, officer, { group: "Purchase" }).error);
  assert.ok(download(report, processor).error);
  assert.ok(work({ type: "export", id: report.id, revision: report.revision, from: "2026-11-01", through: "2026-11-30" }, admin, "another-brokerage").error);
  const audit = db.prepare("SELECT actor, subject FROM workspace_access_history WHERE action = 'Prepared custom report CSV'").all();
  assert.equal(audit.length, 3);
  assert.ok(audit.every(({ actor, subject }) => actor === officer.email && subject.includes(report.id) && !subject.includes("Fictional")));
});

test("oversized reports require a narrower export instead of returning partial data", (t) => {
  const { db, officer, save, download, inquiry } = fixture(t);
  db.transaction(() => {
    for (let index = 0; index < 2_001; index++) inquiry(`lead-${index}`, officer);
  });
  const { report } = save({ ...defaultCustomReport, name: "Oversized intake" });
  assert.match(download(report).error, /more than 2,000 report rows/);
  assert.equal(download(report, undefined, { metric: "cohortFunded" }).count, 0);
  assert.equal(db.prepare("SELECT count(*) AS total FROM workspace_access_history WHERE action = 'Prepared custom report CSV'").get().total, 1);
});

test("loan fields keep separate values for the same borrower and require record and field access", (t) => {
  const { db, now, brokerageId, admin, officer, other, processor, work, save, run, records, download, file } = fixture(t);
  const fields = (input, actor = admin, tenant = brokerageId) => crmFieldWork(db, input, actor, tenant);
  const fieldId = crypto.randomUUID();
  const config = { label: "Closing lane", kind: "Choice", options: ["Priority", "Standard"],
    recordScope: "Loan file", roles: ["LO", "Processor"], editRoles: ["Processor"] };
  const create = { type: "saveField", fieldId, revision: 0, definition: config };
  assert.equal(fields(create).kind, "savedField");
  assert.ok(!db.prepare("SELECT 1 FROM crm_fields WHERE id = ?").get(fieldId));
  assert.ok(fields({ ...create, revision: 1, definition: { ...config, recordScope: "Lead and borrower", editRoles: undefined } }).error);
  assert.ok(fields({ ...create, revision: 1, definition: { ...config, roles: ["LO"] } }).error);

  const legacyId = crypto.randomUUID();
  const legacy = { label: "Existing outreach tier", kind: "Short text", options: [], roles: ["LO"] };
  db.prepare("INSERT INTO crm_fields (id, label, revision, definition) VALUES (?, ?, 1, ?)").run(legacyId, legacy.label, JSON.stringify(legacy));
  assert.equal(fields({ ...create, fieldId: legacyId, revision: 1, definition: legacy }).field.revision, 1);
  file("purchase", officer);
  insertLoan(db, { id: "refinance", contactId: "contact-purchase", partnerId: null, officer: officer.name, officerEmail: officer.email,
    amount: 300000, address: "", purpose: "Refinance", stage: "Processing", stageSince: now.toISOString() });
  file("other", other);
  db.prepare("INSERT INTO loan_processing VALUES ('purchase', ?, ?, 'Accepted', '', ?, 1)").run(processor.email, processor.name, now.toISOString());
  const values = (recordId, actor = admin, record = "loan") => fields({ type: "values", record, recordId }, actor);
  assert.deepEqual(values("purchase", officer).entries.map(({ field, editable }) => [field.id, editable]), [[fieldId, false]]);
  assert.deepEqual(values("contact-purchase", officer, "contact").entries.map(({ field }) => field.id), [legacyId]);
  assert.equal(values("purchase", processor).entries[0].editable, true);
  assert.ok(values("purchase", other).error);
  assert.ok(values("refinance", processor).error);
  assert.ok(fields({ type: "values", record: "loan", recordId: "purchase" }, admin, "another-workspace").error);

  const set = (recordId, value, options = {}) =>
    ({ type: "saveValue", record: "loan", recordId, fieldId, fieldRevision: 1, revision: 0, value, ...options });
  assert.ok(fields(set("purchase", "Priority"), officer).error);
  assert.ok(fields(set("refinance", "Priority"), processor).error);
  assert.ok(fields(set("contact-purchase", "Priority", { record: "contact" })).error);
  assert.ok(fields(set("purchase", "Priority", { fieldId: legacyId })).error);
  assert.equal(fields(set("purchase", "Priority"), processor).entries[0].value, "Priority");
  assert.equal(values("refinance").entries[0].value, null);
  assert.equal(fields(set("refinance", "Standard")).entries[0].value, "Standard");
  assert.equal(fields(set("other", "Priority")).entries[0].value, "Priority");

  const customFilter = { fieldId, value: "Priority" };
  assert.ok(save({ ...defaultCustomReport, name: "Intake with loan field", customFilter }).error);
  assert.ok(saveCrmSegment(db, admin, { id: crypto.randomUUID(), revision: 0, name: "Invalid loan segment", kind: "Past clients",
    quietDays: 7, customFilter }, now.toISOString()).error);
  const { report } = save({ ...defaultCustomReport, name: "Loan priority", dataset: "Loan production", groupBy: "None",
    metrics: ["files"], roles: ["LO", "Processor"], customFilter });
  assert.equal(run(report).totals.files, 2);
  assert.equal(run(report, officer).totals.files, 1);
  assert.equal(run(report, processor).totals.files, 1);
  assert.deepEqual(records(report, "files", officer).rows.map(({ destination }) => destination.id), ["purchase"]);
  assert.equal(download(report, processor).count, 1);
  assert.equal(readCsv(download(report, officer).csv)[1][4], "purchase");
  assert.ok(fields({ ...create, revision: 1, definition: { ...config, editRoles: [] } }).field);
  assert.equal(values("purchase", processor).entries[0].editable, false);
  assert.ok(fields(set("purchase", "Standard", { fieldRevision: 2, revision: 1 }), processor).error);
  assert.equal(run(report, processor).totals.files, 1);
  assert.ok(fields({ ...create, revision: 2, definition: { ...config, roles: ["LO"], editRoles: ["LO"] } }).field);
  assert.deepEqual(values("purchase", processor).entries, []);
  assert.equal(work({ type: "list" }, processor).reports.length, 0);
  assert.ok(download(report, processor).error);
  assert.equal(download(report, officer).count, 1);
  db.prepare("DELETE FROM loans WHERE id = 'purchase'").run();
  assert.ok(!db.prepare("SELECT 1 FROM crm_loan_field_values WHERE recordId = 'purchase'").get());
  assert.equal(run(report, officer).totals.files, 0);
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

test("scheduled report previews pin their date, recipients and counts and record one recoverable receipt", t => {
  const f = fixture(t);
  const admin = { ...f.admin, brokerage: { ...f.admin.brokerage, accessRevision: 2 } };
  const recipient = { email: "recipient@example.test", name: "Fictional second admin", status: "Active", role: "Admin", accessRevision: 3 };
  const members = [{ ...admin, status: "Active", role: "Admin", accessRevision: 2 }, recipient];
  const scope = (input, options = {}) => reportScheduleWork(f.db, input, options.staff ?? admin, options.brokerageId ?? f.brokerageId,
    options.members ?? members, options.now ?? f.now);
  const { report } = f.save({ ...defaultCustomReport, name: "Scheduled intake", period: { kind: "Last 30 days" } });
  const reportId = report.id;
  const save = { type: "save", reportId, reportRevision: 1, revision: 0, operationId: crypto.randomUUID(),
    cadence: "Weekly", startsOn: "2026-11-10", recipients: [recipient.email, admin.email] };
  assert.match(scope(save, { staff: f.officer }).error, /admins/);
  assert.match(scope(save, { brokerageId: crypto.randomUUID() }).error, /admins/);
  assert.match(scope({ ...save, recipients: [f.officer.email] }).error, /active brokerage admins/);
  assert.equal(scope(save).schedule.nextOn, "2026-11-10");
  assert.equal(scope(save).schedule.revision, 1);
  const reference = { reportId, revision: 1, scheduledOn: "2026-11-10" };
  assert.match(scope({ type: "preview", ...reference }, { now: new Date("2026-11-10T04:59:59.999Z") }).error, /future day/);
  f.inquiry("first", f.officer);
  const original = scope({ type: "preview", ...reference });
  assert.equal(original.totals.inquiries, 1);
  assert.equal(original.through, "2026-11-10");
  const run = { type: "run", ...reference, fingerprint: original.fingerprint, operationId: crypto.randomUUID() };
  f.inquiry("second", f.officer);
  assert.match(scope(run).error, /summary changed/);
  const preview = scope({ type: "preview", ...reference });
  const accepted = { ...run, fingerprint: preview.fingerprint };
  const receipt = scope(accepted);
  assert.equal(receipt.kind, "receipt");
  assert.equal(receipt.totals.inquiries, 2);
  assert.equal(receipt.nextOn, "2026-11-17");
  assert.equal(receipt.fingerprint, undefined);
  assert.deepEqual(scope(accepted), receipt);
  assert.match(scope({ ...accepted, operationId: crypto.randomUUID() }).error, /schedule changed/i);
  assert.equal(scope({ type: "history", reportId }).receipts.length, 1);
  assert.equal(f.work({ type: "archive", id: reportId, revision: 1 }).kind, "archived");
  assert.equal(scope({ type: "list" }).schedules[0].state, "Report archived");
  assert.deepEqual(scope({ type: "history", reportId }).receipts[0], receipt);
});

test("monthly schedules preserve their anchor through shorter months and require current approvals after changes", t => {
  const f = fixture(t);
  const staff = { ...f.admin, brokerage: { ...f.admin.brokerage, accessRevision: 0 } };
  const owner = { email: staff.email, name: staff.name, role: "Admin", status: "Active", accessRevision: 0 };
  const recipient = { email: "another@example.test", name: "Another admin", role: "Admin", status: "Active", accessRevision: 1 };
  const { report } = f.save({ ...defaultCustomReport, name: "Monthly production" });
  const reportId = report.id;
  const work = (input, at, members = [owner, recipient]) => reportScheduleWork(f.db, { reportId, ...input }, staff, f.brokerageId, members, new Date(at));
  const save = { type: "save", reportRevision: 1, revision: 0, cadence: "Monthly", startsOn: "2027-01-31",
    recipients: [recipient.email], operationId: crypto.randomUUID() };
  const january = "2027-01-31T12:00:00.000Z", february = "2027-02-28T12:00:00.000Z";
  const reference = { scheduledOn: "2027-01-31", revision: 1 };
  assert.equal(work(save, january).schedule.nextOn, "2027-01-31");
  assert.match(work({ type: "preview", ...reference }, january, [owner, { ...recipient, accessRevision: 2 }]).error, /recipients/);
  assert.equal(work({ type: "setPaused", paused: true, revision: 1, operationId: crypto.randomUUID() }, january).schedule.state, "Paused");
  assert.match(work({ type: "preview", ...reference, revision: 2 }, january).error, /status/);
  assert.equal(work({ type: "setPaused", paused: false, revision: 2, operationId: crypto.randomUUID() }, january).schedule.state, "Active");
  const run = (scheduledOn, revision, at) => {
    const preview = work({ type: "preview", scheduledOn, revision }, at);
    return work({ type: "run", scheduledOn, revision, operationId: crypto.randomUUID(), fingerprint: preview.fingerprint }, at);
  };
  assert.equal(run("2027-01-31", 3, january).nextOn, "2027-02-28");
  const revised = f.work({ type: "save", id: reportId, revision: 1, definition: { ...defaultCustomReport, name: "Updated monthly production" } });
  assert.equal(revised.report.revision, 2);
  assert.match(work({ type: "preview", scheduledOn: "2027-02-28", revision: 3 }, february).error, /saved report/);
  assert.equal(work({ ...save, reportRevision: 2, revision: 3, operationId: crypto.randomUUID() }, february).schedule.nextOn, "2027-02-28");
  assert.equal(run("2027-02-28", 4, february).nextOn, "2027-03-31");
});

test("owner schedule attention separates due work from report and recipient blockers", t => {
  const f = fixture(t);
  const admin = { ...f.admin, brokerage: { ...f.admin.brokerage, accessRevision: 0 } };
  const self = { email: admin.email, name: admin.name, role: "Admin", status: "Active", accessRevision: 0 };
  const recipient = { email: "other-admin@example.test", name: "Other admin", role: "Admin", status: "Active", accessRevision: 4 };
  const roster = [self, recipient];
  const work = (input, options = {}) => reportScheduleWork(f.db, input, options.staff ?? admin,
    options.brokerageId ?? f.brokerageId, options.roster ?? roster, options.now ?? f.now);
  function schedule(name, startsOn = "2026-11-10", recipients = [self.email], extra = {}) {
    const definition = { ...defaultCustomReport, name, ...extra };
    const { report } = f.save(definition);
    const result = work({ type: "save", reportId: report.id, reportRevision: 1, revision: 0,
      cadence: "Weekly", startsOn, recipients, operationId: crypto.randomUUID() });
    assert.equal(result.kind, "saved");
    return { id: report.id, definition };
  }
  const due = schedule("Due intake summary");
  const changed = schedule("Report revision blocked");
  const recipientsChanged = schedule("Recipient approval blocked", "2026-11-17", [recipient.email]);
  const paused = schedule("Paused schedule");
  schedule("Future schedule", "2026-11-17");
  const archived = schedule("Archived report");
  assert.equal(f.work({ type: "archive", id: archived.id, revision: 1 }).kind, "archived");
  const fieldId = crypto.randomUUID();
  assert.equal(crmFieldWork(f.db, { type: "saveField", fieldId, revision: 0,
    definition: { label: "Outreach score", kind: "Number", options: [], roles: [] } }, admin, f.brokerageId).kind, "savedField");
  const field = schedule("Unavailable CRM filter", "2026-11-12", [self.email], { customFilter: { fieldId, value: "10" } });
  assert.equal(crmFieldWork(f.db, { type: "archiveField", fieldId, revision: 1 }, admin, f.brokerageId).kind, "archived");
  assert.equal(f.work({ type: "save", id: changed.id, revision: 1, definition: { ...changed.definition, name: "Changed intake report" } }).kind, "saved");
  assert.equal(work({ type: "setPaused", reportId: paused.id, revision: 1, paused: true,
    operationId: crypto.randomUUID() }).schedule.state, "Paused");
  const newRoster = [self, { ...recipient, accessRevision: 5 }];
  const attention = work({ type: "attention" }, { roster: newRoster });
  assert.equal(attention.due, 1);
  assert.equal(attention.blocked, 3);
  assert.deepEqual(attention.items.map(item => [item.reportId, item.status]), [
    [due.id, "Due today"], [changed.id, "Report changed"], [field.id, "Report filter unavailable"], [recipientsChanged.id, "Recipients changed"],
  ]);
  assert.doesNotMatch(JSON.stringify(attention), /@example|totals|recipientEmail/);
  assert.equal(work({ type: "attention" }, { now: new Date("2026-11-10T04:59:59Z"), roster: newRoster }).due, 0);
  assert.equal(work({ type: "attention" }, { now: new Date("2026-11-11T05:00:00Z"), roster: newRoster }).items[0].status, "Overdue");
  assert.match(work({ type: "attention" }, { staff: f.officer }).error, /admins/);
  assert.match(work({ type: "attention" }, { brokerageId: crypto.randomUUID() }).error, /admins/);

  const preview = work({ type: "preview", reportId: due.id, revision: 1, scheduledOn: "2026-11-10" });
  const run = work({ type: "run", reportId: due.id, revision: 1, scheduledOn: "2026-11-10", fingerprint: preview.fingerprint,
    operationId: crypto.randomUUID() });
  assert.equal(run.kind, "receipt");
  assert.equal(work({ type: "attention" }, { roster: newRoster }).due, 0);
});

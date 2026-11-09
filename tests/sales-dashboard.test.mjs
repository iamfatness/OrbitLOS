import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { changeSalesSettings, readSalesDashboard } = await import("../src/lib/sales-dashboard.ts");

function setup(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const admin = { name: "Manager", email: "manager@example.test", brokerage: { id: "fixture", name: "Fictional", role: "Admin" } };
  const now = new Date("2026-11-08T17:00:00.000Z");
  const filters = { channel: "Campaigns", from: "2026-11-01", through: "2026-11-07", owner: "" };
  const read = (query = {}, staff = admin, tenant = admin.brokerage.id) =>
    readSalesDashboard(db, { kind: "summary", ...filters, ...query }, staff, tenant, now);
  const loan = (id, officer = "Second officer", officerEmail = "second@example.test") => {
    insertContact(db, { id: `contact-${id}`, name: id, email: "", phone: "", role: "Borrower" });
    insertLoan(db, { id, contactId: `contact-${id}`, partnerId: null, officer, officerEmail, address: "", amount: 300000,
      purpose: "Purchase", stage: "Processing", stageSince: "2026-11-02T12:00:00.000Z" });
  };
  const lead = (id, date, loanId = null, realtorId = null) => db.prepare(`INSERT INTO referral_leads
    (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, resolvedAt, loanId, realtorId)
    VALUES (?, ?, ?, '', '', 'Purchase', 'First officer', 'first@example.test', ?, ?, ?, ?, ?)`)
    .run(id, id, id, date, date, loanId ? date : null, loanId, realtorId);
  const campaign = (id, name = id) => db.prepare("INSERT INTO call_campaigns VALUES (?, ?, '2026-10-01T12:00:00.000Z')").run(id, name);
  const member = (leadId, campaignId, at, attempts = 0) =>
    db.prepare("INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, attempts) VALUES (?, ?, ?, ?)").run(leadId, campaignId, at, attempts);
  return { admin, db, lead, loan, campaign, member, read };
}

test("sales cohorts use Eastern entry dates and reconcile recorded outreach, funding and repeat records", (t) => {
  const { db, admin, read, lead, loan, campaign, member } = setup(t);
  insertContact(db, { id: "realtor", name: "Fictional realtor", email: "", phone: "", role: "Realtor" });
  campaign("campaign", "Fictional campaign");
  loan("funded-file");
  loan("repeat-file");
  lead("buyer", "2026-10-31T22:00:00.000Z", "funded-file", "realtor");
  lead("previous", "2026-11-01T03:59:59.999Z");
  lead("unworked", "2026-11-03T11:00:00.000Z");
  lead("outside", "2026-11-08T05:00:00.000Z");
  member("buyer", "campaign", "2026-11-01T04:00:00.000Z", 2);
  member("previous", "campaign", "2026-11-01T03:59:59.999Z");
  member("unworked", "campaign", "2026-11-03T11:00:00.000Z");
  member("outside", "campaign", "2026-11-08T05:00:00.000Z", 1);
  db.exec(`INSERT INTO lead_follow_up (leadId, firstContactAt) VALUES ('buyer', '2026-10-31T23:00:00.000Z');
    INSERT INTO lead_events VALUES ('mock-send', 'unworked', '2026-11-03T12:00:00.000Z', 'Orbit', 'Note', NULL, 'Mock delivery recorded');
    INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt)
      VALUES ('funded-file', 'test-funding', '2026-12-01', '{}', '2026-11-04'), ('repeat-file', 'test-repeat', '2026-12-01', '{}', '2026-11-08');
    INSERT INTO application_versions (loanId, revision, draft, submittedAt) VALUES ('funded-file', 1, '{}', '2026-11-02T12:00:00.000Z');
    INSERT INTO closing_progress (loanId, fundingDate) VALUES ('funded-file', '2026-11-08');
    INSERT INTO returning_client_loans VALUES ('funded-file', 'repeat-file');`);
  const report = read();
  assert.deepEqual(report.periods.selected, { from: "2026-11-01", through: "2026-11-07", leads: 2, outreach: 1, submitted: 1, funded: 1, repeat: 1, maturing: 0 });
  assert.equal(report.periods.previous.leads, 1);
  assert.deepEqual(report.groups[0].selected, { leads: 2, outreach: 1, submitted: 1, funded: 1, repeat: 1, maturing: 0 });
  assert.equal(read({ owner: "email:first@example.test" }).periods.selected.funded, 0);
  assert.equal(read({ owner: "email:second@example.test" }).periods.selected.leads, 1);
  const drilldown = { kind: "records", period: "selected", metric: "repeat", groupId: "campaign" };
  assert.deepEqual(read(drilldown).records.map(({ id, repeatLoanId }) => ({ id, repeatLoanId })), [{ id: "buyer", repeatLoanId: "repeat-file" }]);
  assert.equal(read({ ...drilldown, groupId: "missing" }).records.length, 0);
  const referral = read({ channel: "Realtors" });
  assert.equal(referral.periods.selected.leads, 0);
  assert.equal(referral.periods.previous.funded, 1);
  assert.equal(referral.periods.previous.outreach, 1);
  db.exec("UPDATE closing_progress SET fundingDate = NULL WHERE loanId = 'funded-file';");
  assert.equal(read().periods.selected.funded, 0);
  assert.equal(read(drilldown).records.length, 0);
  db.exec("UPDATE closing_progress SET fundingDate = '2026-11-07' WHERE loanId = 'funded-file';");
  assert.equal(read().periods.selected.repeat, 1);
  for (const role of ["LO", "Processor"]) {
    assert.ok(read({}, { ...admin, brokerage: { ...admin.brokerage, role } }).error);
    assert.ok(read(drilldown, { ...admin, brokerage: { ...admin.brokerage, role } }).error);
  }
  assert.ok(read(drilldown, admin, "other-brokerage").error);
  assert.ok(read({ from: "2020-01-01" }).error);
});

test("source and record pages retain all counts when names and dates tie", (t) => {
  const { db, read, lead } = setup(t);
  const at = "2026-11-02T13:00:00.000Z";
  for (let i = 0; i < 23; i++) {
    const id = String(i).padStart(2, "0");
    const realtorId = `realtor-${id}`;
    insertContact(db, { id: realtorId, name: i % 2 ? "Fictional name" : "fictional name", email: "", phone: "", role: "Realtor" });
    lead(`lead-${id}`, at, null, realtorId);
  }
  const filter = { channel: "Realtors" };
  const first = read(filter);
  const second = read({ ...filter, afterGroup: first.next });
  assert.equal(first.periods.selected.leads, 23);
  assert.equal(second.periods.selected.leads, 23);
  assert.equal(first.groups.length, 20);
  assert.equal(second.groups.length, 3);
  assert.equal(new Set([...first.groups, ...second.groups].map(({ id }) => id)).size, 23);
  const records = { ...filter, kind: "records", period: "selected", metric: "leads", groupId: null };
  const rows = read(records);
  const rest = read({ ...records, after: rows.next });
  assert.equal(new Set([...rows.records, ...rest.records].map(({ id }) => id)).size, 23);
  assert.equal(rest.next, null);
});

test("lead-source cohorts preserve intake attribution through campaign enrollment and conversion", (t) => {
  const { db, admin, read, lead, loan, campaign, member } = setup(t);
  const at = "2026-11-01T04:00:00.000Z";
  insertContact(db, { id: "realtor", name: "Fictional realtor", email: "", phone: "", role: "Realtor" });
  campaign("intake");
  for (const id of ["website-file", "direct-file", "previous-file"]) loan(id);
  lead("website", at, "website-file");
  lead("referral", at, null, "realtor");
  lead("campaign-import", at);
  lead("crm-import", at);
  for (const id of ["website", "referral", "campaign-import", "crm-import"]) member(id, "intake", at);
  db.exec(`UPDATE referral_leads SET importSource = 'Imported CRM' WHERE id IN ('campaign-import', 'crm-import');
    INSERT INTO migration_records VALUES ('call-intake','Lead:campaign-import','campaign-import'), ('call-intake','Lead:crm-import','crm-import');
    INSERT INTO migration_imports VALUES ('receipt','call-intake','${at}','Admin',NULL,NULL,1);
    INSERT INTO migration_import_rows (importId, recordKey, label, outcome, targetId)
      VALUES ('receipt','Lead:crm-import','Fictional lead','Create','crm-import');
    UPDATE loans SET createdAt = NULL, stageSince = '2026-11-01T00:00:00-04:00' WHERE id = 'direct-file';
    UPDATE loans SET createdAt = '2026-11-01T00:00:00+00:00' WHERE id = 'previous-file';
    INSERT INTO lead_follow_up (leadId, firstContactAt) VALUES ('campaign-import','2026-11-08T05:00:00.000Z');
    INSERT INTO activity (id, loanId, text, createdAt, kind, outcome)
      VALUES ('direct-call','direct-file','Connected','2026-11-08T04:59:59.999Z','Call','Connected');
    INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt)
      VALUES ('website-file','test-intake','2026-12-01','{}','2026-11-02','2026-11-02T12:00:00.000Z');
    INSERT INTO closing_progress (loanId, fundingDate) VALUES ('website-file','2026-11-06');`);
  const filter = { channel: "Lead sources" };
  const report = read(filter);
  assert.deepEqual(report.groups.map(({ id, selected }) => [id, selected.leads]), [
    ["Campaign import", 1], ["Direct", 1], ["Imported CRM", 1], ["Realtor referral", 1], ["Website quote request", 1],
  ]);
  assert.deepEqual(report.periods.selected, { from: "2026-11-01", through: "2026-11-07", leads: 5, outreach: 2, submitted: 1, funded: 1, repeat: 0, maturing: 0 });
  assert.equal(report.periods.previous.leads, 1);
  assert.equal(read({ ...filter, owner: "email:second@example.test" }).periods.selected.leads, 2);
  const funded = { ...filter, kind: "records", period: "selected", metric: "funded", groupId: "Website quote request" };
  assert.deepEqual(read(funded).records.map(({ id, loanId }) => [id, loanId]), [["website", "website-file"]]);
  assert.ok(read(funded, { ...admin, brokerage: { ...admin.brokerage, role: "LO" } }).error);
  assert.ok(read(funded, admin, "other-brokerage").error);
  const timed = read({ ...filter, windowDays: 7 });
  assert.equal(timed.periods.selected.outreach, 1);
  assert.equal(timed.groups.find(({ id }) => id === "Direct").selected.outreach, 1);
  assert.equal(timed.groups.find(({ id }) => id === "Campaign import").selected.outreach, 0);
});

test("fixed observation windows match the Eastern cutoff and separate immature leads and undated calls", (t) => {
  const { db, read, lead, loan, campaign, member } = setup(t);
  campaign("timed");
  const entry = "2026-10-30T12:00:00.000Z";
  const inside = "2026-11-06T04:59:59.999Z";
  const cutoff = "2026-11-06T05:00:00.000Z";
  for (const id of ["timely", "late", "repeat-in", "repeat-late"]) loan(id);
  for (const [id, at, loanId] of [["on-time", entry, "timely"], ["late-call", entry, "late"], ["undated-call", entry, null],
    ["maturing", "2026-11-05T12:00:00.000Z", null]]) {
    lead(id, at, loanId);
    member(id, "timed", at, id === "maturing" ? 0 : 1);
  }
  db.exec(`INSERT INTO lead_events VALUES
    ('event-timely','on-time','${inside}','LO','Call','Connected','Connected · Call campaign · Timed'),
    ('event-late','late-call','${cutoff}','LO','Call','Connected','Connected · Call campaign · Timed'),
    ('event-mock','undated-call','${inside}','Orbit','Note',NULL,'Mock delivery recorded');
    ALTER TABLE call_campaign_members DROP COLUMN firstCallAt;`);
  initializeStore(db, false);
  initializeStore(db, false);
  assert.equal(db.prepare("SELECT firstCallAt FROM call_campaign_members WHERE leadId = 'on-time'").get().firstCallAt, inside);
  assert.equal(db.prepare("SELECT firstCallAt FROM call_campaign_members WHERE leadId = 'undated-call'").get().firstCallAt, null);
  db.exec(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt) VALUES
    ('timely','test-timely','2026-12-01','{}','${inside}','${inside}'), ('late','test-late','2026-12-01','{}','${cutoff}','${cutoff}'),
    ('repeat-in','test-repeat-in','2026-12-01','{}','${inside}',NULL), ('repeat-late','test-repeat-late','2026-12-01','{}','${cutoff}',NULL);
    INSERT INTO closing_progress (loanId, fundingDate) VALUES ('timely','2026-11-05'), ('late','2026-11-06');
    INSERT INTO returning_client_loans VALUES ('timely','repeat-in'), ('late','repeat-late');
    UPDATE loans SET createdAt = '${inside}' WHERE id = 'repeat-in';
    UPDATE loans SET createdAt = '${cutoff}' WHERE id = 'repeat-late';`);
  const filters = { from: "2026-10-30", through: "2026-11-07", windowDays: 7 };
  assert.deepEqual(read(filters).groups[0].selected, { leads: 3, outreach: 1, submitted: 1, funded: 1, repeat: 1, maturing: 1 });
  assert.equal(read({ ...filters, windowDays: 0 }).groups[0].selected.outreach, 3);
  const drills = { ...filters, kind: "records", period: "selected", groupId: "timed" };
  assert.deepEqual(read({ ...drills, metric: "repeat" }).records.map(({ id }) => id), ["on-time"]);
  assert.deepEqual(read({ ...drills, metric: "outreach" }).records.map(({ id }) => id), ["on-time"]);
  assert.deepEqual(read({ ...drills, metric: "maturing" }).records.map(({ id, maturesAt }) => ({ id, maturesAt })),
    [{ id: "maturing", maturesAt: "2026-11-12T05:00:00.000Z" }]);
});

test("lead-source settings upgrade populated campaign and realtor target tables", (t) => {
  const { db, admin, read } = setup(t);
  db.exec(`DROP TABLE sales_conversion_targets;
    CREATE TABLE sales_conversion_targets (
      channel TEXT NOT NULL CHECK (channel IN ('Campaigns', 'Realtors')), windowDays INTEGER NOT NULL,
      submitted INTEGER NOT NULL, funded INTEGER NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY (channel, windowDays));
    INSERT INTO sales_conversion_targets VALUES ('Campaigns',30,25,11,2), ('Realtors',7,50,30,3);`);
  initializeStore(db, false);
  const filters = { channel: "Lead sources", windowDays: 30, owner: "", from: "2026-11-01", through: "2026-11-07" };
  const view = { id: crypto.randomUUID(), name: "Intake review", filters };
  const save = (input) => changeSalesSettings(db, input, admin, admin.brokerage.id);
  assert.equal(save({ type: "saveTarget", channel: filters.channel, windowDays: 30, submitted: 30, funded: 15, revision: 0 }).message, "Sales targets saved.");
  assert.equal(save({ type: "saveView", ...view }).message, "Sales view saved.");
  initializeStore(db, false);
  assert.deepEqual(read({ windowDays: 30 }).target, { submitted: 25, funded: 11, revision: 2 });
  assert.deepEqual(read({ channel: "Realtors", windowDays: 7 }).target, { submitted: 50, funded: 30, revision: 3 });
  assert.deepEqual(read(filters).target, { submitted: 30, funded: 15, revision: 1 });
  assert.deepEqual(read(filters).views, [view]);
});

test("saved sales views and channel-window targets are authorized, retryable and revision checked", (t) => {
  const { db, admin, read } = setup(t);
  const id = crypto.randomUUID();
  const filters = { from: "2026-11-01", through: "2026-11-07", channel: "Campaigns", owner: "", windowDays: 30 };
  const change = (input, staff = admin, brokerage = admin.brokerage.id) => changeSalesSettings(db, input, staff, brokerage);
  const view = { type: "saveView", id, name: "Campaign review", filters };
  const target = { type: "saveTarget", channel: "Campaigns", windowDays: 30, submitted: 25, funded: 10, revision: 0 };
  assert.ok(change(view, { ...admin, brokerage: { ...admin.brokerage, role: "Processor" } }).error);
  assert.ok(change(target, admin, "other-brokerage").error);
  assert.equal(change(view).message, "Sales view saved.");
  assert.equal(change(view).message, "Sales view saved.");
  assert.ok(change({ ...view, id: crypto.randomUUID(), name: "campaign review" }).error);
  assert.equal(change(target).message, "Sales targets saved.");
  assert.equal(change(target).message, "Sales targets saved.");
  assert.ok(change({ ...target, funded: 11 }).error);
  assert.equal(change({ ...target, funded: 11, revision: 1 }).message, "Sales targets saved.");
  assert.deepEqual(read(filters).views, [{ id, name: view.name, filters }]);
  assert.deepEqual(read(filters).target, { submitted: 25, funded: 11, revision: 2 });
  assert.equal(read({ ...filters, owner: "name:Another owner" }).target, null);
  assert.equal(read({ ...filters, channel: "Realtors" }).target, null);
  assert.equal(read({ ...filters, windowDays: 0 }).target, null);
  assert.equal(change({ type: "removeView", id }).message, "Sales view removed.");
  assert.equal(change({ type: "removeView", id }).message, "Sales view removed.");
  assert.ok(change(view).error);
  assert.deepEqual(read(filters).views, []);
});

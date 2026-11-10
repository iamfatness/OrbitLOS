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
const { readCampaignManager } = await import("../src/lib/campaign-manager.ts");
const { readCampaignSequencePerformance } = await import("../src/lib/campaign-sequence-performance.ts");
const { campaignManagerUnavailable } = await import("../src/lib/campaign-manager-model.ts");
const { defaultNewLeadSteps } = await import("../src/lib/campaign-sequence-model.ts");

const joined = "2026-11-06T12:00:00.000Z";
const earlier = "2026-11-08T12:00:00.000Z";
const due = "2026-11-09T14:59:59.999Z";
const now = "2026-11-09T15:00:00.000Z";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction: (fn) => fn() };
  initializeStore(db, false);
  db.prepare("INSERT INTO call_campaigns (id, name, createdAt) VALUES ('main', 'Fictional main', ?), ('other', 'Fictional other', ?)")
    .run(joined, joined);
  db.prepare("INSERT INTO campaign_sequence_versions (version, steps) VALUES (1, ?)").run(JSON.stringify(defaultNewLeadSteps));
  const brokerage = { id: crypto.randomUUID(), name: "Fictional brokerage", role: "Admin", pilot: true };
  const admin = { name: "Fictional admin", email: "admin@example.test", brokerage };
  const read = (input = {}, actor = admin, scope = brokerage.id) =>
    readCampaignManager(db, { campaignId: "main", ...input }, actor, scope, new Date(now));

  function add(id, { campaign = "main", sequence = due, outcome = null, callback = null, callOutcome = null, complete = null,
    shared = false, held = false, replied = false, archived = false, loanId = null, email = `${id}@example.test`, phone = "" } = {}) {
    db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt,
      heldAt, resolvedAt, archiveToken, loanId) VALUES (?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, id, id, email, phone, shared ? "" : "Fictional officer", shared ? null : "officer@example.test", joined, earlier,
        held ? earlier : null, archived || loanId ? earlier : null, archived ? id + "-archive" : null, loanId);
    const taskId = callback ? id + "-callback" : null;
    if (taskId) db.prepare("INSERT INTO lead_import_tasks (id, leadId, title, dueAt, completedAt) VALUES (?, ?, 'Fictional task', ?, ?)")
      .run(taskId, id, callback, complete);
    db.prepare("INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, lastOutcome, callbackTaskId) VALUES (?, ?, ?, ?, ?)")
      .run(id, campaign, joined, callOutcome, taskId);
    db.prepare("INSERT INTO campaign_sequence_enrollments (leadId, version, dueAt, outcome) VALUES (?, 1, ?, ?)").run(id, sequence, outcome);
    if (replied) db.prepare("INSERT INTO lead_follow_up (leadId, status, revision, replyReceivedAt) VALUES (?, 'Stopped', 1, ?)").run(id, earlier);
  }
  return { db, add, read, admin, brokerage };
}

test("manager outcomes count distinct campaign leads and list only overdue open work", (t) => {
  const { db, add, read } = fixture(t);
  insertContact(db, { id: "borrower", name: "Fictional borrower", role: "Borrower", email: "borrower@example.test", phone: "2485550100" });
  insertLoan(db, { id: "loan", contactId: "borrower", partnerId: null, officer: "Current LO", officerEmail: "current@example.test",
    address: "", amount: 300000, purpose: "Purchase", stage: "Application", stageSince: earlier });

  add("both", { callback: earlier, callOutcome: "No response" });
  add("shared", { shared: true });
  add("future", { sequence: now, callback: now });
  add("held", { held: true });
  add("held paused", { held: true, outcome: "Paused" });
  add("paused with callback", { callback: due, callOutcome: "Requested callback", outcome: "Paused" });
  add("archived", { archived: true, replied: true });
  add("converted", { loanId: "loan", replied: true });
  add("reply and promise", { replied: true, callback: due, callOutcome: "Requested callback" });
  add("reply and retry", { replied: true, callback: due, callOutcome: "Left message" });
  add("old logged reply", { sequence: null });
  db.prepare("INSERT INTO lead_events (id, leadId, at, actor, kind, outcome, text) VALUES ('reply', 'old logged reply', ?, 'Staff', 'Text', 'Reply received', 'Fictional reply')").run(earlier);
  add("completed", { sequence: null, callback: earlier, complete: earlier });
  add("aliased opt-out", { phone: "2485550100" });
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', 'email:borrower@example.test', NULL, ?)").run(earlier);
  add("direct opt-out", { sequence: null, outcome: "Opted out" });
  add("foreign", { campaign: "other" });

  const page = read();
  assert.deepEqual(page.counts, { overdue: 4, paused: 2, replies: 5, conversions: 1, optOuts: 3 });
  assert.deepEqual(page.items.map(({ leadId }) => leadId), ["both", "paused with callback", "reply and promise", "shared"]);
  assert.deepEqual(page.items[0].overdue, [
    { title: "Campaign call retry", dueAt: earlier }, { title: "New Lead · Call the new lead", dueAt: due },
  ]);
  assert.deepEqual(page.items[1].overdue, [{ title: "Campaign callback", dueAt: due }]);
  assert.equal(page.items[3].owner, "Shared inbox");
  assert.deepEqual(read({ view: "paused" }).items.map(({ leadId, sequence }) => [leadId, sequence.held, sequence.dueAt]),
    [["held paused", true, due], ["paused with callback", false, due]]);
  assert.equal(read({ view: "replies" }).items[0].archived, true);
  assert.deepEqual(read({ view: "conversions" }).items[0], {
    leadId: "converted", name: "converted", owner: "Current LO", loanId: "loan", archived: false, overdue: [],
  });
  assert.deepEqual(read({ view: "optOuts" }).items.map(({ leadId }) => leadId), ["aliased opt-out", "converted", "direct opt-out"]);
  assert.deepEqual(read({ campaignId: "other" }).items.map(({ leadId }) => leadId), ["foreign"]);
});

test("manager reporting restricts access and bounds drilldowns without truncating counts", (t) => {
  const { add, read, admin, brokerage } = fixture(t);
  for (let index = 0; index < 23; index++) add(String(index).padStart(2, "0"));
  assert.equal(read().items.length, 20);
  const page = read({ page: 2 });
  assert.deepEqual(page.items.map(({ leadId }) => leadId), ["20", "21", "22"]);
  assert.equal(page.counts.overdue, 23);
  assert.equal(read({ page: 4 }).page, 2);
  assert.ok(read({ view: "other" }).error);
  assert.ok(read({ campaignId: "missing" }).error);
  for (const actor of [null, { ...admin, brokerage: { ...brokerage, role: "LO" } },
    { ...admin, brokerage: { ...brokerage, role: "Processor" } }, { ...admin, brokerage: { ...brokerage, pilot: false } }]) {
    assert.deepEqual(read({}, actor), { error: campaignManagerUnavailable });
  }
  assert.deepEqual(read({}, admin, crypto.randomUUID()), { error: campaignManagerUnavailable });
});

test("sequence performance isolates versions, attributes the first reply, and pages active overdue steps", (t) => {
  const { db, add, admin, brokerage } = fixture(t);
  const read = (input = {}, actor = admin, scope = brokerage.id) =>
    readCampaignSequencePerformance(db, { campaignId: "main", ...input }, actor, scope, new Date(now));
  assert.deepEqual(read().steps, []);
  for (let index = 0; index < 23; index++) add(`stalled-${String(index).padStart(2, "0")}`);
  add("paused", { outcome: "Paused" });
  add("held", { held: true });
  add("upcoming", { sequence: now });
  add("suppressed");
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', 'email:suppressed@example.test', NULL, ?)").run(earlier);
  add("other campaign", { campaign: "other" });
  add("older reply", { replied: true, archived: true, sequence: null });
  add("credited reply", { replied: true, sequence: null, outcome: "Reply received" });
  db.prepare("INSERT INTO campaign_sequence_touches (leadId, position, at) VALUES ('credited reply', 0, ?), ('credited reply', 1, ?)").run(joined, earlier);
  add("separate version", { sequence: due });
  db.prepare("INSERT INTO campaign_sequence_versions (version, steps) VALUES (2, ?)")
    .run(JSON.stringify([{ ...defaultNewLeadSteps[2], title: "Revised email" }]));
  db.prepare("UPDATE campaign_sequence_enrollments SET version = 2 WHERE leadId = 'separate version'").run();

  assert.deepEqual(read().versions, [{ version: 2, enrolled: 1 }, { version: 1, enrolled: 29 }]);
  assert.deepEqual(read().steps, [{ title: "Revised email", channel: "Email", touches: 0, replies: 0, stalled: 1 }]);
  const v1 = read({ version: 1 });
  assert.deepEqual(v1.steps.map(({ touches, replies, stalled }) => [touches, replies, stalled]), [[1, 0, 23], [1, 1, 0], [0, 0, 0]]);
  assert.equal(v1.unattributed, 1);
  assert.equal(read({ version: 1, drilldown: { metric: "unattributed" } }).items[0].archived, true);
  assert.deepEqual(read({ version: 1, drilldown: { metric: "replies", position: 1 } }).items.map(({ leadId, when }) => [leadId, when]),
    [["credited reply", earlier]]);
  assert.deepEqual(read({ version: 1, drilldown: { metric: "touches", position: 0 } }).items.map(({ leadId }) => leadId), ["credited reply"]);
  const page = read({ version: 1, drilldown: { metric: "stalled", position: 0 }, page: 2 });
  assert.equal(page.steps[0].stalled, 23);
  assert.deepEqual(page.items.map(({ leadId, when }) => [leadId, when]), [["stalled-20", due], ["stalled-21", due], ["stalled-22", due]]);
  assert.ok(read({ version: 2, drilldown: { metric: "stalled", position: 1 } }).error);
  assert.ok(read({ campaignId: "other", version: 2 }).error);
  assert.deepEqual(read({}, { ...admin, brokerage: { ...brokerage, role: "LO" } }), { error: campaignManagerUnavailable });
  assert.deepEqual(read({}, admin, crypto.randomUUID()), { error: campaignManagerUnavailable });
});

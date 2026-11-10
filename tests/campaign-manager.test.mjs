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
  assert.deepEqual(page.counts, { overdue: 3, replies: 5, conversions: 1, optOuts: 3 });
  assert.deepEqual(page.items.map(({ leadId }) => leadId), ["both", "reply and promise", "shared"]);
  assert.deepEqual(page.items[0].overdue, [
    { title: "Campaign call retry", dueAt: earlier }, { title: "New Lead · Call the new lead", dueAt: due },
  ]);
  assert.deepEqual(page.items[1].overdue, [{ title: "Campaign callback", dueAt: due }]);
  assert.equal(page.items[2].owner, "Shared inbox");
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

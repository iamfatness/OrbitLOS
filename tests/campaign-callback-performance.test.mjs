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

const { initializeStore } = await import("../src/lib/store.ts");
const { readCampaignCallbackPerformance } = await import("../src/lib/campaign-callback-performance.ts");
const { callbackPerformanceUnavailable } = await import("../src/lib/campaign-callback-performance-model.ts");

const checkedAt = "2026-11-09T15:00:00.000Z";
const defaultAt = "2026-11-08T13:00:00.000Z";
const defaultDueAt = "2026-11-10T15:00:00.000Z";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction: (fn) => fn() };
  initializeStore(db, false);
  db.prepare("INSERT INTO call_campaigns (id, name, createdAt) VALUES ('pilot', 'Pilot callbacks', ?), ('other', 'Other callbacks', ?)")
    .run(defaultAt, defaultAt);
  const brokerage = { id: crypto.randomUUID(), name: "Fictional brokerage", role: "Admin", pilot: true };
  const admin = { name: "Fictional admin", email: "admin@example.test", brokerage };
  const read = (input = {}, staff = admin, expected = brokerage.id) =>
    readCampaignCallbackPerformance(db, { campaignId: "pilot", ...input }, staff, expected, new Date(checkedAt));

  function add(id, { campaignId = "pilot", at = defaultAt, originalDueAt = defaultDueAt, dueAt = null, held = false, shared = false,
    requestId = `${id}-request`, attemptAt, attemptId = attemptAt ? `${id}-attempt` : null, closedAt = null, closeReason = null } = {}) {
    const leadId = `lead-${id}`;
    db.prepare(`INSERT INTO referral_leads (id,requestId,name,email,phone,purpose,officer,officerEmail,createdAt,dueAt,heldAt)
      VALUES (?, ?, ?, '', '', 'Purchase', ?, ?, ?, ?, ?)`).run(leadId, leadId, id, shared ? "" : "Fictional officer",
      shared ? null : "officer@example.test", at, originalDueAt, held ? at : null);
    db.prepare("INSERT INTO call_campaign_members (leadId,campaignId,joinedAt) VALUES (?, ?, ?)").run(leadId, campaignId, at);
    const addEvent = db.prepare("INSERT INTO lead_events (id,leadId,at,actor,kind,outcome,text) VALUES (?, ?, ?, ?, 'Call', ?, ?)");
    if (requestId === `${id}-request`) addEvent.run(requestId, leadId, at, "Fictional requester", "Requested callback", `${id} promise`);
    if (attemptAt) addEvent.run(attemptId, leadId, attemptAt, "Fictional caller", "Connected", `${id} attempted`);
    db.prepare(`INSERT INTO campaign_follow_up_runs
      (id,leadId,campaignId,callNumber,outcome,ruleRevision,delayDays,taskId,taskTitle,dueAt,status,reason,at,
        promiseRequestEventId,promiseDueAt,promiseAttemptEventId,promiseClosedAt,promiseCloseReason)
      VALUES (?, ?, ?, 1, ?, 0, NULL, ?, 'Fictional task', ?, 'Completed', '', ?, ?, ?, ?, ?, ?)`)
      .run(id, leadId, campaignId, requestId ? "Requested callback" : "No response", `${id}-task`, originalDueAt, at,
        requestId, dueAt, attemptId, closedAt, closeReason);
  }
  return { add, read, admin, brokerage };
}

test("callback performance scopes the 30-day cohort and preserves exact attempt evidence and durable outcomes", (t) => {
  const { add, read, admin, brokerage } = fixture(t);
  add("foreign", { campaignId: "other", attemptAt: checkedAt });
  add("cutoff", { at: "2026-10-10T15:00:00.000Z", originalDueAt: checkedAt, dueAt: checkedAt, attemptAt: checkedAt, closedAt: checkedAt });
  add("older", { at: "2026-10-10T14:59:59.999Z" });
  add("future", { at: "2026-11-09T15:00:00.001Z" });
  add("automatic", { requestId: null });
  const lateDue = "2026-11-09T14:59:59.999Z";
  add("late", { dueAt: lateDue, attemptAt: checkedAt });
  add("unavailable evidence", { requestId: "foreign-request", attemptId: "foreign-attempt", closedAt: checkedAt });
  add("closed", { closedAt: checkedAt, closeReason: "Lead archived" });
  add("held", { held: true, originalDueAt: checkedAt });
  add("overdue", { originalDueAt: checkedAt });
  add("upcoming", { at: checkedAt, shared: true });

  for (const actor of [null, { ...admin, brokerage: { ...brokerage, role: "LO" } },
    { ...admin, brokerage: { ...brokerage, role: "Processor" } }, { ...admin, brokerage: { ...brokerage, pilot: false } }]) {
    assert.deepEqual(read({}, actor), { error: callbackPerformanceUnavailable });
  }
  assert.deepEqual(read({}, admin, crypto.randomUUID()), { error: callbackPerformanceUnavailable });
  assert.ok(read({ status: "Invalid" }).error);

  const page = read();
  assert.deepEqual(page.counts, { "On time": 2, Late: 1, "Closed without attempt": 1, "On hold": 1, Overdue: 1, Upcoming: 1 });
  assert.deepEqual(new Set(page.items.map(({ id }) => id)), new Set(["cutoff", "late", "unavailable evidence", "closed", "held", "overdue", "upcoming"]));
  const rows = Object.fromEntries(page.items.map((row) => [row.id, row]));
  assert.deepEqual(rows.cutoff.attempt, { id: "cutoff-attempt", at: checkedAt, actor: "Fictional caller", text: "cutoff attempted" });
  assert.deepEqual(rows.cutoff.request, { id: "cutoff-request", at: "2026-10-10T15:00:00.000Z", actor: "Fictional requester", text: "cutoff promise" });
  assert.equal(rows.late.originalDueAt, defaultDueAt);
  assert.equal(rows.late.dueAt, lateDue);
  assert.equal(rows.late.closedAt, checkedAt);
  assert.equal(rows.closed.closeReason, "Lead archived");
  assert.equal(rows.upcoming.owner, "Shared inbox");
  assert.equal(rows["unavailable evidence"].status, "On time");
  assert.equal(rows["unavailable evidence"].request, null);
  assert.equal(rows["unavailable evidence"].attempt, null);
  assert.equal(page.next, null);
});

test("callback performance pages tied promise times without changing cohort counts", (t) => {
  const { add, read } = fixture(t);
  for (let index = 0; index < 23; index++) add(`promise-${String(index).padStart(2, "0")}`);
  add("closed", { at: checkedAt, closedAt: checkedAt, closeReason: "Borrower opted out" });
  const first = read({ status: "Upcoming" });
  assert.equal(first.counts.Upcoming, 23);
  assert.equal(first.counts["Closed without attempt"], 1);
  assert.equal(first.items.length, 20);
  assert.equal(first.items[0].id, "promise-22");
  assert.deepEqual(first.next, { at: defaultAt, id: "promise-03" });
  const second = read({ status: "Upcoming", after: first.next });
  assert.deepEqual(second.counts, first.counts);
  assert.deepEqual(second.items.map(({ id }) => id), ["promise-02", "promise-01", "promise-00"]);
  assert.equal(second.next, null);
  assert.deepEqual(read({ status: "Closed without attempt" }).items.map(({ id }) => id), ["closed"]);
});

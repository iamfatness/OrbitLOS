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
const { isOpenOverdueCallbackPromise, readCampaignCallbackExceptions } = await import("../src/lib/campaign-callback-exceptions.ts");
const { callbackExceptionUnavailable } = await import("../src/lib/campaign-callback-exceptions-model.ts");

const checkedAt = "2026-11-09T15:00:00.000Z";
const requestedAt = "2026-11-08T15:00:00.000Z";
const earlier = "2026-11-09T14:00:00.000Z";
const later = "2026-11-10T15:00:00.000Z";
const officerEmail = "officer@example.test";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction: (fn) => fn() };
  initializeStore(db, false);
  db.prepare("INSERT INTO call_campaigns (id,name,createdAt) VALUES ('pilot', 'Pilot callbacks', ?), ('other', 'Other callbacks', ?)")
    .run(requestedAt, requestedAt);
  const brokerage = { id: crypto.randomUUID(), name: "Fictional brokerage", role: "Admin", pilot: true };
  const admin = { name: "Fictional admin", email: "admin@example.test", brokerage };
  const read = (input = {}, staff = admin, expected = brokerage.id) => readCampaignCallbackExceptions(db, input, staff, expected, new Date(checkedAt));
  const open = (id, leadId = `lead-${id}`) => isOpenOverdueCallbackPromise(db, id, leadId, checkedAt);

  function add(id, { campaignId = "pilot", memberCampaignId = campaignId, dueAt = checkedAt, scheduledAt = dueAt, status = "Completed",
    email = `${id}@example.test`, ownerEmail = officerEmail, requestId = `${id}-request`, memberOutcome = "Requested callback", memberCall = 1 } = {}) {
    const leadId = `lead-${id}`;
    db.prepare(`INSERT INTO referral_leads (id,requestId,name,email,phone,purpose,officer,officerEmail,createdAt,dueAt)
      VALUES (?, ?, ?, ?, '', 'Purchase', ?, ?, ?, ?)`).run(leadId, leadId, id, email, ownerEmail ? "Fictional officer" : "", ownerEmail, requestedAt, checkedAt);
    const taskId = `${id}-task`;
    if (scheduledAt) db.prepare("INSERT INTO lead_import_tasks (id,leadId,title,dueAt) VALUES (?, ?, 'Fictional callback', ?)")
      .run(taskId, leadId, scheduledAt);
    db.prepare(`INSERT INTO call_campaign_members (leadId,campaignId,joinedAt,attempts,lastOutcome,callbackTaskId) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(leadId, memberCampaignId, requestedAt, memberCall, memberOutcome, scheduledAt ? taskId : null);
    if (requestId === `${id}-request`) db.prepare(`INSERT INTO lead_events (id,leadId,at,actor,kind,outcome,text)
      VALUES (?, ?, ?, 'Fictional requester', 'Call', 'Requested callback', ?)`).run(requestId, leadId, requestedAt, `${id} promise`);
    db.prepare(`INSERT INTO campaign_follow_up_runs (id,leadId,campaignId,callNumber,outcome,ruleRevision,delayDays,taskId,taskTitle,
      dueAt,status,reason,at,promiseRequestEventId,promiseDueAt) VALUES (?, ?, ?, 1, 'Requested callback', 0, NULL, ?, 'Fictional callback', ?, ?, '', ?, ?, ?)`)
      .run(id, leadId, campaignId, taskId, earlier, status, requestedAt, requestId, dueAt);
  }
  return { db, add, read, open, admin, brokerage };
}

test("overdue callback exceptions retain missed promises, separate their scheduled task, and enforce current scope", (t) => {
  const { db, add, read, open, admin, brokerage } = fixture(t);
  add("exact boundary");
  add("late reschedule", { dueAt: earlier, scheduledAt: later });
  add("early reschedule", { dueAt: later });
  add("failed", { status: "Failed", scheduledAt: null });
  add("shared", { campaignId: "other", ownerEmail: null });
  add("wrong evidence", { requestId: "shared-request" });
  add("newer call", { memberCall: 2 });
  add("newer outcome", { memberOutcome: "Connected" });
  add("campaign moved", { memberCampaignId: "other" });
  add("legacy", { requestId: null });
  for (const id of ["held", "resolved", "attempted", "closed", "suppressed"]) add(id);
  db.prepare("UPDATE referral_leads SET heldAt = ? WHERE id = 'lead-held'").run(earlier);
  db.prepare("UPDATE referral_leads SET resolvedAt = ? WHERE id = 'lead-resolved'").run(earlier);
  db.prepare("UPDATE campaign_follow_up_runs SET promiseAttemptEventId = 'attempted-event' WHERE id = 'attempted'").run();
  db.prepare("UPDATE campaign_follow_up_runs SET promiseClosedAt = ? WHERE id = 'closed'").run(earlier);
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', 'email:suppressed@example.test', NULL, ?)").run(earlier);
  db.prepare("UPDATE call_campaign_members SET callbackTaskId = 'shared-task' WHERE leadId = 'lead-wrong evidence'").run();

  const page = read();
  assert.deepEqual(page.items.map(({ id }) => id), ["late reschedule", "exact boundary", "failed", "shared", "wrong evidence"]);
  assert.deepEqual(page.items[0], { id: "late reschedule", leadId: "lead-late reschedule", campaignId: "pilot", campaignName: "Pilot callbacks",
    name: "late reschedule", owner: "Fictional officer", ownerEmail: officerEmail, dueAt: earlier, scheduledAt: later, needsRecovery: false,
    request: { at: requestedAt, actor: "Fictional requester", text: "late reschedule promise" } });
  assert.equal(page.items[2].needsRecovery, true);
  assert.equal(page.items[2].scheduledAt, null);
  assert.equal(page.items[4].request, null);
  assert.equal(page.items[4].scheduledAt, null);
  assert.equal(page.next, null);
  assert.deepEqual(read({ ownerEmail: null }).items.map(({ id }) => id), ["shared"]);
  assert.deepEqual(read({ ownerEmail: officerEmail, campaignId: "other" }).items, []);
  assert.deepEqual(read({ campaignId: "pilot" }).items.map(({ id }) => id), ["late reschedule", "exact boundary", "failed", "wrong evidence"]);
  for (const id of ["exact boundary", "late reschedule", "failed", "shared", "wrong evidence"]) assert.equal(open(id), true, id);
  for (const id of ["early reschedule", "newer call", "newer outcome", "campaign moved", "legacy", "held", "resolved", "attempted", "closed", "suppressed"]) {
    assert.equal(open(id), false, id);
  }
  assert.equal(open("failed", "lead-shared"), false);

  for (const staff of [null, { ...admin, brokerage: { ...brokerage, role: "LO" } },
    { ...admin, brokerage: { ...brokerage, role: "Processor" } }, { ...admin, brokerage: { ...brokerage, pilot: false } }]) {
    assert.deepEqual(read({}, staff), { error: callbackExceptionUnavailable });
  }
  assert.deepEqual(read({}, admin, crypto.randomUUID()), { error: callbackExceptionUnavailable });
});

test("callback exception cursors advance across a fully suppressed scan and tied deadlines", (t) => {
  const { db, add, read } = fixture(t);
  for (let index = 0; index < 61; index++) add(`hidden-${String(index).padStart(2, "0")}`, { dueAt: earlier, email: "suppressed@example.test" });
  for (let index = 0; index < 23; index++) add(`visible-${String(index).padStart(2, "0")}`);
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', 'email:suppressed@example.test', NULL, ?)").run(earlier);
  const first = read();
  assert.deepEqual(first, { items: [], next: { dueAt: earlier, id: "hidden-59" } });
  const second = read({ after: first.next });
  assert.equal(second.items.length, 20);
  assert.deepEqual(second.next, { dueAt: checkedAt, id: "visible-19" });
  const third = read({ after: second.next });
  assert.deepEqual(third.items.map(({ id }) => id), ["visible-20", "visible-21", "visible-22"]);
  assert.equal(third.next, null);
});

test("a carried callback is filtered by the current loan owner and drops out after an attempt, hold, or opt-out", (t) => {
  const { db, add, read, open } = fixture(t);
  add("loan callback", { dueAt: earlier, scheduledAt: later });
  const loanId = "converted-loan";
  const contactId = "converted-borrower";
  const taskId = "loan callback-task";
  const ownerEmail = "loan-owner@example.test";
  insertContact(db, { id: contactId, name: "Current borrower", email: "current@example.test", phone: "", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: "Current owner", officerEmail: ownerEmail,
    address: "", amount: 300000, purpose: "Purchase", stage: "Application", stageSince: earlier });
  db.prepare("UPDATE referral_leads SET loanId = ?, resolvedAt = ? WHERE id = 'lead-loan callback'").run(loanId, earlier);
  db.prepare("UPDATE campaign_follow_up_runs SET promiseClosedAt = ?, promiseCloseReason = '1003 started' WHERE id = 'loan callback'").run(earlier);
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES (?, ?, 'Callback', ?, 'Prospecting')").run(taskId, loanId, later);

  assert.equal(open("loan callback"), false);
  assert.deepEqual(read({ ownerEmail: officerEmail }).items, []);
  const [row] = read({ campaignId: "pilot", ownerEmail }).items;
  assert.equal(row.owner, "Current owner");
  assert.equal(row.name, "Current borrower");
  assert.equal(row.dueAt, earlier);
  assert.deepEqual(row.loanTask, { loanId, taskId, dueAt: later });
  assert.equal(row.request.text, "loan callback promise");
  db.prepare("UPDATE loans SET disposition = 'On hold' WHERE id = ?").run(loanId);
  assert.deepEqual(read().items, []);
  db.prepare("UPDATE loans SET disposition = 'Active' WHERE id = ?").run(loanId);
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', 'email:current@example.test', NULL, ?)").run(earlier);
  assert.deepEqual(read().items, []);
  db.prepare("DELETE FROM outreach_opt_outs").run();
  db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ?").run(earlier, taskId);
  assert.deepEqual(read().items, []);
  db.prepare("UPDATE tasks SET completedAt = NULL WHERE id = ?").run(taskId);
  db.prepare("UPDATE campaign_follow_up_runs SET promiseAttemptEventId = 'attempt-event' WHERE id = 'loan callback'").run();
  assert.deepEqual(read().items, []);
});

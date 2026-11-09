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

const { initializeStore, insertContact, insertLoan, insertSubmission } = await import("../src/lib/store.ts");
const { readCampaignCallbacks, readOfficerQueue, readWorkspaceCalendar, readWorkspaceTasks } = await import("../src/lib/officer-queue.ts");
const { officerDashboardWork } = await import("../src/lib/officer-dashboard.ts");
const { readFundingDashboard } = await import("../src/lib/funding-dashboard.ts");
const { readSalesDashboard } = await import("../src/lib/sales-dashboard.ts");
const { blockedOutreachKeys, outreachSuppressionKeys } = await import("../src/lib/outreach-preferences.ts");
const { changeProcessingView, readProcessorQueue } = await import("../src/lib/processor-queue.ts");
const { changeConversation, readConversations } = await import("../src/lib/conversations.ts");
const { readEditableLoan, readLoanHandoff } = await import("../src/lib/editable-loan.ts");
const { borrowerCommandResult } = await import("../src/lib/applications.ts");
const { readIncomingLoanWorkPage } = await import("../src/lib/incoming-loan-work.ts");
const { readEditableLead } = await import("../src/lib/editable-lead.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { defaultPlaybook } = await import("../src/lib/playbook-model.ts");
const { writePlaybook } = await import("../src/lib/playbooks.ts");
const { assignProcessor, updateProcessing } = await import("../src/lib/loan-processing.ts");
const { recordUwmAlerts } = await import("../src/lib/uwm-alerts.ts");
const { workOnAppointment } = await import("../src/lib/appointments.ts");
const { appointmentInstant } = await import("../src/lib/appointment-model.ts");
const { coverageWork } = await import("../src/lib/coverage.ts");
const { coverageInput } = await import("../src/lib/coverage-model.ts");
const { initializeBrokerages, changeBrokerage, selectedActiveMembers, activateBrokerages } = await import("../src/lib/brokerages.ts");
const { readFileExceptions, nameFileExceptions } = await import("../src/lib/file-exceptions.ts");
const { recordManualLenderReturn } = await import("../src/lib/lender-export.ts");
const { recordManualReturnFollowUp } = await import("../src/lib/manual-lender-work.ts");
const { readRecordHistory } = await import("../src/lib/record-history.ts");
const { applicationSteps, blankApplication, sampleApplication } = await import("../src/lib/application-model.ts");
const { demoGuideState, loadPilotScenario, loadProtectedPilotScenario, pilotReview, recordPilotMeasurement } = await import("../src/lib/pilot.ts");

function fixture(t, now = "2026-11-08T12:00:00.000Z") {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction: (fn) => fn() };
  initializeStore(db, false);
  const brokerage = { id: crypto.randomUUID(), name: "Fictional brokerage", role: "LO" };
  const officer = { name: "Alex Sample", email: "alex@example.test", brokerage };
  const other = { ...officer, email: "other@example.test", name: "Other officer" };
  const lead = (id, dueAt, owner = officer, email = `${id}@example.test`) => db.prepare(`INSERT INTO referral_leads
    (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
    VALUES (?, ?, ?, ?, '', 'Purchase', ?, ?, ?, ?)`).run(id, id, id, email, owner.name, owner.email, "2026-10-01T12:00:00.000Z", dueAt);
  const loan = (id, owner = officer) => {
    insertContact(db, { id: `${id}-contact`, name: id, role: "Borrower", phone: "", email: `${id}@example.test` });
    insertLoan(db, { id, contactId: `${id}-contact`, partnerId: null, officer: owner.name, officerEmail: owner.email,
      address: "", amount: 350000, purpose: "Purchase", stage: "Underwriting", stageSince: now });
  };
  const read = (input = { horizon: 1 }, actor = officer, tenant = brokerage.id) => readOfficerQueue(db, input, actor, tenant, new Date(now));
  return { db, read, lead, loan, officer, other };
}

test("active tasks page ties and respect exact time windows and role scope", async (t) => {
  const at = "2026-11-09T15:00:00.000Z";
  const { db, loan, officer, other } = fixture(t, at);
  loan("mine");
  loan("other", other);
  const task = db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES (?, ?, ?, ?, 'Loan service')");
  for (let i = 0; i < 24; i++) {
    const id = `task-${String(i).padStart(2, "0")}`;
    task.run(id, "mine", id, "2026-11-09T14:59:59.999Z");
  }
  task.run("exact", "mine", "Exact start", at);
  task.run("inclusive-end", "mine", "Exact end", "2026-11-10T15:00:00.000Z");
  task.run("too-late", "mine", "Outside window", "2026-11-10T15:00:00.001Z");
  task.run("private", "other", "Another officer's task", at);
  const query = { type: "list", scope: "Mine", view: "Open", group: "Loan follow-ups" };
  const read = (input = query, actor = officer, clock = new Date(at)) => readWorkspaceTasks(db, input, actor, officer.brokerage.id, clock);
  const first = read();
  assert.equal(first.items.length, 20);
  const next = read({ ...query, after: first.next, checkedAt: first.checkedAt }, officer, new Date("2026-11-09T15:01:00.000Z"));
  assert.equal(next.checkedAt, first.checkedAt);
  assert.equal(new Set([...first.items, ...next.items].map(({ id }) => id)).size, 27);
  assert.ok(![...first.items, ...next.items].some(({ id }) => id === "private"));
  assert.deepEqual(read({ ...query, view: "Due in 24 hours" }).items.map(({ id }) => id), ["exact", "inclusive-end"]);
  assert.ok(read({ ...query, view: "Overdue" }).items.every(({ overdue }) => overdue));
  assert.ok(read({ ...query, scope: "Team" }).error);
  assert.ok(readWorkspaceTasks(db, query, officer, "another-brokerage", new Date(at)).error);
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin" } };
  assert.ok(read({ ...query, scope: "Team", view: "Due in 24 hours" }, admin).items.some(({ id }) => id === "private"));
  assert.ok(read({ ...query, after: first.next, checkedAt: first.checkedAt }, officer, new Date("2026-11-09T15:16:00.000Z")).error);
  const completed = await executeCommand(db, { type: "completeTask", id: "exact", completed: true }, officer, undefined, [], { scopedTaskUpdates: true });
  assert.deepEqual(completed, { tasksChanged: true, message: "Task completed." });
  assert.deepEqual(read({ ...query, view: "Due in 24 hours" }).items.map(({ id }) => id), ["inclusive-end"]);
  assert.ok((await executeCommand(db, { type: "completeTask", id: "private", completed: true }, officer, undefined, [], { scopedTaskUpdates: true })).error);
});

test("active tasks expose current document, lender alert, and assigned contact work", async (t) => {
  const at = "2026-11-09T15:00:00.000Z";
  const { db, lead, loan, officer, other } = fixture(t, at);
  loan("owned");
  loan("unrelated", other);
  lead("shared", at);
  db.exec("UPDATE referral_leads SET officerEmail = NULL, officer = '' WHERE id = 'shared'");
  const doc = db.prepare("INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, status, dueOn) VALUES (?, ?, ?, '', ?, ?, ?)");
  doc.run("waiting", "owned", "Pay stub", at, "Requested", "2026-11-09");
  doc.run("review", "owned", "Bank statement", at, "Received", null);
  doc.run("hidden", "unrelated", "Pay stub", at, "Received", null);
  insertSubmission(db, { id: "demo", loanId: "owned", lender: "UWM", externalId: "DEMO-1", status: "Conditions", conditions: [], syncedAt: at });
  const alertId = crypto.randomUUID();
  db.prepare("INSERT INTO uwm_alerts (id, loanId, submissionId, kind, message, detectedAt) VALUES (?, 'owned', 'demo', 'Status changed', 'Mock lender update', ?)").run(alertId, at);
  const callbackId = crypto.randomUUID();
  db.prepare(`INSERT INTO contact_activity (id, contactId, officer, officerEmail, kind, outcome, text, createdAt, dueAt, followUpOwner, followUpOwnerEmail, purpose)
    VALUES (?, 'unrelated-contact', ?, ?, 'Call', 'Requested callback', 'Fictional callback', ?, ?, ?, ?, 'Loan service')`)
    .run(callbackId, other.name, other.email, at, at, officer.name, officer.email);
  const query = { type: "list", view: "Open", scope: "Mine" };
  const read = (input, actor = officer) => readWorkspaceTasks(db, input, actor, officer.brokerage.id, new Date(at));
  assert.deepEqual(read({ ...query, group: "Documents" }).items.map(({ id, target }) => [id, target]),
    [["waiting", "document-waiting"], ["review", "document-review"]]);
  assert.deepEqual(read({ ...query, group: "Lender updates" }).items.map(({ id }) => id), [alertId]);
  assert.ok(read({ ...query, scope: "Available", group: "Leads and callbacks" }).items.some(({ id }) => id === "shared"));
  assert.ok(!read({ ...query, group: "Leads and callbacks" }).items.some(({ id }) => id === "shared"));
  const exact = { type: "contact", id: callbackId };
  assert.equal(read(exact).contact.id, "unrelated-contact");
  assert.ok(read(exact, other).error);
  const processor = { ...other, brokerage: { ...other.brokerage, role: "Processor" } };
  db.prepare("INSERT INTO loan_processing VALUES ('owned', ?, ?, 'In processing', '', ?, 1)").run(processor.email, processor.name, at);
  assert.ok(read(exact, processor).error);
  assert.deepEqual(read({ ...query, group: "Documents" }, processor).items.map(({ id }) => id), ["waiting", "review"]);
  assert.deepEqual(read({ ...query, group: "Lender updates" }, processor).items, []);
  assert.deepEqual(read({ ...query, group: "Loan follow-ups" }, processor).items.map(({ id, target }) => [id, target]),
    [["owned", "processing-handoff"]]);
  const marked = await executeCommand(db, { type: "reviewUwmAlert", loanId: "owned", alertId }, officer, undefined, [], { scopedTaskUpdates: true });
  assert.equal(marked.tasksChanged, true);
  assert.deepEqual(read({ ...query, group: "Lender updates" }).items, []);
  db.prepare("UPDATE contact_activity SET followUpOwnerEmail = ? WHERE id = ?").run(other.email, callbackId);
  assert.ok(read(exact).error);
});

test("completed task history pages newest first across sources and preserves blocked history", async (t) => {
  const at = "2026-11-09T15:00:00.000Z";
  const { db, loan, officer, other } = fixture(t, at);
  loan("owned");
  loan("private", other);
  const task = db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, completedAt, purpose) VALUES (?, ?, ?, ?, ?, ?)");
  for (let i = 0; i < 21; i++) {
    const id = `done-${String(i).padStart(2, "0")}`;
    task.run(id, "owned", id, at, at, i === 0 ? "Prospecting" : "Loan service");
  }
  task.run("other-done", "private", "Private history", at, at, "Loan service");
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('test', 'email:owned@example.test', NULL, ?)").run(at);
  db.prepare(`INSERT INTO contact_activity (id, contactId, officer, officerEmail, kind, outcome, text, createdAt, dueAt, completedAt,
    followUpOwner, followUpOwnerEmail, purpose) VALUES ('callback-done', 'owned-contact', ?, ?, 'Call', 'Requested callback',
    'Fictional callback', ?, ?, ?, ?, ?, 'Loan service')`).run(officer.name, officer.email, at, at, at, officer.name, officer.email);
  const query = { type: "list", view: "Completed", scope: "Mine" };
  const read = (input = query) => readWorkspaceTasks(db, input, officer, officer.brokerage.id, new Date(at));
  const first = read();
  assert.equal(first.items.length, 20);
  assert.equal(first.items[0].id, "done-20");
  const more = read({ ...query, after: first.next, checkedAt: first.checkedAt });
  assert.deepEqual(more.items.map(({ id }) => id), ["done-00", "callback-done"]);
  assert.ok(more.items.find(({ id }) => id === "done-00").blocked);
  assert.equal(more.items[0].completedAt, at);
  assert.equal(more.next, null);
  const reopened = await executeCommand(db, { type: "completeTask", id: "done-20", completed: false }, officer, undefined, [], { scopedTaskUpdates: true });
  assert.equal(reopened.tasksChanged, true);
  assert.ok(!read().items.some(({ id }) => id === "done-20"));
});

test("paged playbooks and holds retain policy deadlines, role checks, and one row per action", (t) => {
  const at = "2026-11-09T17:00:00.000Z";
  const prior = "2026-11-07T17:00:00.000Z";
  const { db, lead, loan, officer, other } = fixture(t, at);
  for (const id of ["quiet", "connected", "held-lead", "still-new"]) lead(id, id === "still-new" ? "2026-11-11T17:00:00.000Z" : at);
  db.prepare("UPDATE referral_leads SET heldAt = ?, holdReason = 'Awaiting decision', revisitDate = '2026-11-10' WHERE id = 'held-lead'").run(prior);
  const event = db.prepare("INSERT INTO lead_events (id, leadId, at, actor, kind, outcome, text) VALUES (?, ?, ?, ?, 'Call', ?, '')");
  event.run("quiet-outreach", "quiet", prior, officer.name, "No response");
  event.run("newer-note", "quiet", at, officer.name, null);
  event.run("connected-outreach", "connected", prior, officer.name, "Connected");
  db.prepare("INSERT INTO lead_follow_up (leadId, firstContactAt) VALUES ('quiet', ?), ('connected', ?)").run(prior, prior);
  for (const id of ["held-loan", "review-loan", "ready", "assign-loan", "funded"]) loan(id);
  db.exec("UPDATE loans SET disposition = 'On hold', revisitDate = '2026-11-10', dispositionReason = 'Borrower requested pause' WHERE id = 'held-loan'");
  db.exec("UPDATE loans SET stage = 'Funded' WHERE id = 'funded'");
  const app = db.prepare("INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt, reviewedAt, revision) VALUES (?, ?, ?, '{}', ?, ?, ?, 2)");
  app.run("review-loan", "review-token", at, at, prior, null);
  app.run("ready", "ready-token", at, at, prior, prior);
  app.run("assign-loan", "assign-token", at, at, prior, prior);
  db.prepare("INSERT INTO application_versions (loanId, revision, draft, submittedAt, reviewedAt) VALUES ('review-loan', 1, '{}', ?, ?)").run(prior, prior);
  db.prepare("INSERT INTO loan_processing VALUES ('ready', ?, ?, 'Ready for processing', '', ?, 1), ('review-loan', ?, ?, 'Ready for processing', '', ?, 1)")
    .run(other.email, other.name, prior, other.email, other.name, prior);
  db.prepare(`INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES
    ('application-follow-up:review-loan', 'review-loan', 'Review current file', ?, 'Loan service'),
    ('post-funding:borrower:funded', 'funded', 'Post-funding borrower check-in', ?, 'Loan service')`).run(at, at);
  const processor = { ...other, brokerage: { ...other.brokerage, role: "Processor" } };
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin" } };
  const query = { type: "list", view: "Open", scope: "Mine" };
  const read = (input = query, actor = officer) => readWorkspaceTasks(db, input, actor, officer.brokerage.id, new Date(at));
  const holds = read({ ...query, group: "Holds" }).items;
  assert.deepEqual(holds.map(({ id, dueAt }) => [id, dueAt]), [["held-lead", "2026-11-10T17:00:00.000Z"], ["held-loan", "2026-11-10T17:00:00.000Z"]]);
  const all = read().items;
  assert.equal(all.find(({ id }) => id === "quiet").dueAt, at);
  assert.ok(!all.some(({ id }) => id === "connected"));
  assert.equal(all.filter(({ id }) => id === "quiet").length, 1);
  assert.equal(all.find(({ id }) => id === "review-loan").title, "Review corrected 1003");
  assert.equal(all.find(({ id }) => id === "assign-loan").title, "Assign a processor");
  assert.ok(!all.some(({ id }) => id === "application-follow-up:review-loan" || id === "ready"));
  assert.equal(all.filter(({ id }) => id === "post-funding:borrower:funded").length, 1);
  assert.equal(all.find(({ id }) => id === "post-funding:borrower:funded").target, "funding-check-in");
  const team = { ...query, scope: "Team" };
  assert.equal(read(team, admin).items.filter(({ id }) => id === "ready").length, 1);
  assert.equal(read(query, processor).items.find(({ id }) => id === "ready").title, "Accept processing handoff");
  writePlaybook(db, { ...defaultPlaybook, requireSecondReview: true });
  assert.ok(!read(query, processor).items.some(({ id }) => id === "ready"));
  const stalled = () => readProcessorQueue(db, { readyOnly: false, exception: "Stalled handoffs" }, admin, admin.brokerage.id,
    new Date("2026-11-10T18:00:00.000Z")).files;
  assert.ok(!stalled().some(({ id }) => id === "ready"));
  db.prepare(`INSERT INTO loan_reviews (id, loanId, title, category, requesterEmail, requesterName, reviewerEmail, reviewerName, reviewerRole,
    reviewerAccessRevision, dueOn, status, applicationRevision, createdAt, updatedAt)
    VALUES ('review', 'ready', 'Second review', '1003 second review', ?, ?, ?, ?, 'Admin', 1, '2026-11-09', 'Approved', 1, ?, ?)`)
    .run(officer.email, officer.name, admin.email, admin.name, prior, prior);
  assert.ok(!read(query, processor).items.some(({ id }) => id === "ready"));
  assert.ok(!stalled().some(({ id }) => id === "ready"));
  db.exec("UPDATE loan_reviews SET applicationRevision = 2 WHERE id = 'review'");
  assert.equal(read(query, processor).items.find(({ id }) => id === "ready").title, "Accept processing handoff");
  assert.ok(stalled().some(({ id }) => id === "ready"));
  db.exec("UPDATE loan_reviews SET applicationRevision = 1 WHERE id = 'review'; UPDATE loan_processing SET status = 'Returned to LO' WHERE loanId = 'ready';");
  assert.ok(stalled().some(({ id }) => id === "ready"));
});

function callbackFeedFixture(t) {
  const at = "2026-11-09T15:00:00.000Z";
  const base = fixture(t, at);
  const { db, lead, officer, other } = base;
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin" } };
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  const addCampaign = db.prepare("INSERT INTO call_campaigns VALUES (?, ?, ?)");
  addCampaign.run("first", "Fictional first campaign", at);
  addCampaign.run("second", "Fictional second campaign", at);
  const addTask = db.prepare("INSERT INTO lead_import_tasks (id, leadId, title, dueAt, purpose) VALUES (?, ?, 'Campaign callback', ?, 'Prospecting')");
  const enroll = db.prepare(`INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, attempts, lastOutcome, callbackTaskId)
    VALUES (?, ?, ?, 1, ?, ?)`);
  function add(id, dueAt = at, { owner = officer, campaign = "first", outcome = "Requested callback", email, taskId = `task-${id}` } = {}) {
    lead(id, dueAt, owner, email);
    addTask.run(taskId, id, dueAt);
    enroll.run(id, campaign, at, outcome, taskId);
  }
  const query = (input = { view: "Due" }, actor = officer, brokerageId = officer.brokerage.id, time = at) =>
    readCampaignCallbacks(db, input, actor, brokerageId, new Date(time));
  return { ...base, at, admin, processor, add, query };
}

test("signed-in campaign callbacks split the exact due boundary across campaigns and enforce personal brokerage scope", (t) => {
  const { at, add, query, admin, processor, officer } = callbackFeedFixture(t);
  const earlier = "2026-11-09T14:59:59.999Z";
  const upcoming = "2026-11-09T15:00:00.001Z";
  add("exact", at, { campaign: "second" });
  add("future", upcoming);
  add("earlier", earlier, { outcome: "No response" });
  add("admin-callback", at, { owner: admin });
  add("shared", at, { owner: { name: "", email: null } });
  const due = query();
  assert.equal(due.checkedAt, at);
  assert.equal(due.next, null);
  assert.deepEqual(due.items.map(({ leadId, taskId, dueAt, campaignName, name, requested }) => [leadId, taskId, dueAt, campaignName, name, requested]), [
    ["earlier", "task-earlier", earlier, "Fictional first campaign", "earlier", false],
    ["exact", "task-exact", at, "Fictional second campaign", "exact", true],
  ]);
  const upcomingQuery = { view: "Upcoming" };
  assert.deepEqual(query(upcomingQuery).items.map(({ leadId, dueAt }) => [leadId, dueAt]), [["future", upcoming]]);
  assert.deepEqual(query(upcomingQuery, officer, undefined, upcoming).items, []);
  assert.deepEqual(query(undefined, officer, undefined, upcoming).items.map(({ leadId }) => leadId), ["earlier", "exact", "future"]);
  assert.deepEqual(query(undefined, admin).items.map(({ leadId }) => leadId), ["admin-callback"]);
  assert.ok(query(undefined, processor).error);
  assert.ok(query(undefined, null).error);
  assert.ok(query(undefined, officer, crypto.randomUUID()).error);
});

test("campaign callback pages keep task-id ties and make progress past hidden candidates", (t) => {
  const { db, at, add, query } = callbackFeedFixture(t);
  const due = { view: "Due" };
  const leads = Array.from({ length: 23 }, (_, index) => `tie-${String(index).padStart(2, "0")}`);
  for (const [index, id] of leads.entries()) add(id, at, { taskId: `ordered-${String(23 - index).padStart(2, "0")}` });
  const first = query(due);
  assert.equal(first.items.length, 20);
  assert.deepEqual(first.next, { dueAt: at, id: first.items.at(-1).taskId });
  const second = query({ ...due, after: first.next });
  assert.equal(second.next, null);
  assert.deepEqual([...first.items, ...second.items].map(({ leadId }) => leadId), leads.toReversed());

  const future = "2026-11-10T15:00:00.000Z";
  const email = "suppressed@example.test";
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('feed-test', ?, NULL, ?)").run(`email:${email}`, at);
  for (let index = 0; index < 64; index++) add(`hidden-${index}`, future, { email });
  add("visible-tail", future);
  let page = query({ view: "Upcoming" });
  assert.deepEqual(page.items, []);
  assert.ok(page.next);
  const found = [...page.items];
  for (let index = 0; page.next && index < 5; index++) {
    const after = page.next;
    page = query({ view: "Upcoming", after });
    assert.notDeepEqual(page.next, after);
    found.push(...page.items);
  }
  assert.equal(page.next, null);
  assert.deepEqual(found.map(({ leadId }) => leadId), ["visible-tail"]);
});

test("personal campaign callbacks merge lead and loan tasks at tied deadlines and keep the current loan owner", (t) => {
  const { db, at, add, loan, read, query, officer, other } = callbackFeedFixture(t);
  const future = "2026-11-24T15:00:00.000Z";
  const open = { view: "Upcoming" };
  for (let index = 0; index < 22; index++) {
    const id = `lead-${index.toString().padStart(2, "0")}`;
    add(id, future);
    if (index % 2 === 0) continue;
    const loanId = `loan-${id}`;
    loan(loanId);
    db.prepare("UPDATE referral_leads SET resolvedAt = ?, loanId = ? WHERE id = ?").run(at, loanId, id);
    db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES (?, ?, 'Promised callback', ?, 'Prospecting')")
      .run(`task-${id}`, loanId, future);
    db.prepare(`INSERT INTO campaign_follow_up_runs (id, leadId, campaignId, callNumber, outcome, ruleRevision, taskId, taskTitle,
      dueAt, status, reason, at, promiseRequestEventId, promiseDueAt, promiseClosedAt, promiseCloseReason)
      VALUES (?, ?, 'first', 1, 'Requested callback', 0, ?, 'Promised callback', ?, 'Completed', '', ?, ?, ?, ?, '1003 started')`)
      .run(id, id, `task-${id}`, future, at, `request-${id}`, future, at);
  }
  const first = query(open);
  const second = query({ ...open, after: first.next });
  assert.equal(first.items.length, 20);
  assert.equal(second.next, null);
  const all = [...first.items, ...second.items];
  assert.deepEqual(all.map(({ taskId }) => taskId), Array.from({ length: 22 }, (_, index) => `task-lead-${index.toString().padStart(2, "0")}`));
  const carried = all.at(-1);
  assert.equal(carried.loanId, "loan-lead-21");
  assert.equal(carried.requested, true);
  assert.equal(query().items.length, 0);
  assert.equal(query(undefined, officer, undefined, future).items.length, 20);
  assert.ok(!read({ horizon: 7 }).items.some(({ id }) => id === carried.taskId));
  db.prepare("UPDATE loans SET officerEmail = ? WHERE id = ?").run(other.email, carried.loanId);
  assert.deepEqual(query(open, other).items, [carried]);
  assert.ok(!query({ ...open, after: first.next }).items.some(({ taskId }) => taskId === carried.taskId));
  db.prepare("UPDATE loans SET disposition = 'On hold' WHERE id = ?").run(carried.loanId);
  assert.deepEqual(query(open, other).items, []);
  db.prepare("UPDATE loans SET disposition = 'Active' WHERE id = ?").run(carried.loanId);
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('callback', ?, NULL, ?)").run(`email:${carried.loanId}@example.test`, at);
  assert.deepEqual(query(open, other).items, []);
  db.prepare("DELETE FROM outreach_opt_outs").run();
  db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ?").run(at, carried.taskId);
  assert.deepEqual(query(open, other).items, []);
});

test("campaign callback feed excludes inactive or suppressed work and preserves requested callbacks after a borrower reply", (t) => {
  const { db, at, add, query } = callbackFeedFixture(t);
  add("closed");
  add("held");
  add("completed");
  add("old-task");
  add("explicit-opt-out", at, { outcome: "Opted out" });
  add("matched-opt-out");
  add("replied-automatic", at, { outcome: "Left message" });
  add("replied-requested");
  db.prepare("UPDATE referral_leads SET resolvedAt = ? WHERE id = 'closed'").run(at);
  db.prepare("UPDATE referral_leads SET heldAt = ? WHERE id = 'held'").run(at);
  db.prepare("UPDATE lead_import_tasks SET completedAt = ? WHERE leadId = 'completed'").run(at);
  db.exec("UPDATE call_campaign_members SET callbackTaskId = NULL WHERE leadId = 'old-task'");
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('feed-test', 'email:matched-opt-out@example.test', NULL, ?)").run(at);
  db.prepare("INSERT INTO lead_follow_up (leadId, replyReceivedAt) VALUES ('replied-automatic', ?), ('replied-requested', ?)").run(at, at);
  assert.deepEqual(query().items.map(({ leadId, requested }) => [leadId, requested]), [["replied-requested", true]]);
});

test("stalled loans page active owned files at seven days, preserving stage filters and ties", (t) => {
  const { db, officer, other, loan } = fixture(t);
  const now = new Date("2026-11-08T12:00:00.000Z");
  const tenant = officer.brokerage.id;
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin" } };
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  const add = (id, stage = "Underwriting", disposition = "Active", stageSince = "2026-11-01T12:00:00.000Z", owner = officer) => {
    loan(id, owner);
    db.prepare("UPDATE loans SET stage = ?, disposition = ?, stageSince = ? WHERE id = ?").run(stage, disposition, stageSince, id);
  };
  add("legacy-date", "Lead", "Active", "2026-10-31");
  add("offset-date", "Processing", "Active", "2026-11-01T07:00:00.000-05:00");
  add("too-recent", "Lead", "Active", "2026-11-01T12:00:00.001Z");
  add("held", "Underwriting", "On hold");
  add("funded", "Funded");
  add("ended", "Lead", "Withdrawn");
  add("other-owner", "Lead", "Active", "2026-10-01", other);
  for (let index = 0; index < 14; index++) add(`tie-${String(index).padStart(2, "0")}`);
  const query = (fields = {}, actor = officer, brokerageId = tenant) => officerDashboardWork(db,
    { type: "stalledLoans", ownerEmail: other.email, ...fields }, actor, brokerageId, now);
  const first = query();
  assert.equal(first.items.length, 12);
  assert.deepEqual(first.items.slice(0, 2).map(({ id, days }) => [id, days]), [["legacy-date", 8], ["offset-date", 7]]);
  const second = query({ after: first.next });
  assert.equal(second.next, null);
  assert.equal(new Set([...first.items, ...second.items].map(({ id }) => id)).size, 16);
  assert.deepEqual(query({ stage: "Lead" }).items.map(({ id }) => id), ["legacy-date"]);
  assert.deepEqual(query({}, admin).items.map(({ id }) => id), ["other-owner"]);
  assert.ok(query({}, processor).error);
  assert.ok(query({}, officer, "other-brokerage").error);
  assert.match(readEditableLoan(db, { stalledLoanId: "too-recent" }, officer, tenant, undefined, now.getTime()).error, /no longer/);
  assert.match(readEditableLoan(db, { stalledLoanId: "legacy-date" }, admin, tenant, undefined, now.getTime()).error, /no longer/);
  assert.ok(readEditableLoan(db, "legacy-date", admin, tenant).loans.length);
  db.exec("UPDATE loans SET disposition = 'On hold' WHERE id = 'legacy-date'");
  assert.match(readEditableLoan(db, { stalledLoanId: "legacy-date" }, officer, tenant, undefined, now.getTime()).error, /no longer/);
  assert.equal(query({ stage: "Lead" }).items.length, 0);
});

test("stalled loans show the current blocker and reopen into fresh condition, document and task actions", (t) => {
  const { db, officer, other, loan } = fixture(t, "2026-10-01T12:00:00.000Z");
  const now = new Date("2026-11-08T12:00:00.000Z");
  const tenant = officer.brokerage.id;
  const at = "2026-11-02T12:00:00.000Z";
  loan("condition-loan");
  loan("task-loan");
  loan("review-loan");
  const app = db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt, reviewedAt, revision, uwmReference)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`);
  app.run("condition-loan", "test-condition", at, JSON.stringify(blankApplication()), at, at, at, "MOCK-1");
  app.run("review-loan", "test-review", at, JSON.stringify(blankApplication()), at, at, null, null);
  db.prepare(`INSERT INTO application_versions (loanId, revision, draft, submittedAt, reviewedAt, uwmReceipt, uwmSentAt)
    VALUES ('condition-loan', 1, ?, ?, ?, 'MOCK-1', ?)`).run(JSON.stringify(blankApplication()), at, at, at);
  insertSubmission(db, { id: "uwm-stalled", loanId: "condition-loan", lender: "UWM", externalId: "MOCK-1", status: "Approved", syncedAt: at,
    conditions: [{ id: "c1", category: "Income", description: "Verify earnings", group: null, uploaded: false, satisfiedAt: null }] });
  db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, status, submissionId, conditionId)
    VALUES ('doc-stalled', 'condition-loan', 'Pay stubs', '', ?, 'Requested', 'uwm-stalled', 'c1')`).run(at);
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('test', 'email:task-loan@example.test', NULL, ?)").run(at);
  db.exec(`INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES
    ('blocked-task', 'task-loan', 'Prospect', '2026-10-03T12:00:00.000Z', 'Prospecting'),
    ('service-task', 'task-loan', 'Call about closing', '2026-10-04T12:00:00.000Z', 'Loan service');`);
  const read = () => officerDashboardWork(db, { type: "stalledLoans" }, officer, tenant, now).items;
  const open = (stalledLoanId, actor = officer) => readEditableLoan(db, { stalledLoanId }, actor, tenant, undefined, now.getTime());
  const rows = read();
  assert.deepEqual(rows.map(({ action, blocker }) => [action, blocker]), [
    ["Follow up on Pay stubs", "Waiting on borrower"], ["Review submitted 1003", null], ["Call about closing", null],
  ]);
  assert.ok(rows[1].dueAt);
  assert.doesNotMatch(JSON.stringify(rows), /example\.test|test-condition|Verify earnings/);
  assert.equal(open("condition-loan").workTarget, "lender-condition-uwm-stalled:c1");
  assert.equal(open("task-loan").workTarget, "loan-task-service-task");
  db.exec("UPDATE document_requests SET status = 'Received' WHERE id = 'doc-stalled'");
  assert.equal(open("condition-loan").workTarget, "document-doc-stalled");
  assert.equal(read()[0].action, "Review Pay stubs");
  db.prepare("UPDATE loans SET officerEmail = ? WHERE id = 'condition-loan'").run(other.email);
  assert.match(open("condition-loan").error, /no longer/);
  assert.equal(open("condition-loan", other).workTarget, "document-doc-stalled");
});

test("brokerage workload reconciles counts and filters, with admin-only reads and current drilldowns", (t) => {
  const { db, officer, other, loan } = fixture(t, "2026-10-01T12:00:00.000Z");
  const now = new Date("2026-11-08T12:00:00.000Z");
  const tenant = officer.brokerage.id;
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin" } };
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  loan("owned-old");
  loan("owned-recent");
  loan("admin-old", admin);
  loan("unassigned-old");
  loan("held");
  loan("closed");
  for (let index = 0; index < 12; index++) loan(`page-${String(index).padStart(2, "0")}`, admin);
  db.exec(`UPDATE loans SET stage = 'Lead' WHERE id IN ('admin-old', 'owned-recent');
    UPDATE loans SET stageSince = '2026-11-07T00:00:00.000Z' WHERE id = 'owned-recent';
    UPDATE loans SET officerEmail = NULL WHERE id = 'unassigned-old';
    UPDATE loans SET disposition = 'On hold' WHERE id = 'held';
    UPDATE loans SET stage = 'Closed' WHERE id = 'closed';`);
  const request = { type: "brokerageStalledLoans", owner: "" };
  const query = (fields = {}, actor = admin, brokerageId = tenant) => officerDashboardWork(db, { ...request, ...fields }, actor, brokerageId, now);
  const open = (stalledLoanId, actor = admin, brokerageId = tenant) => readEditableLoan(db,
    { stalledLoanId, scope: "brokerage" }, actor, brokerageId, undefined, now.getTime());
  const all = query();
  assert.equal(all.kind, "brokerageStalledLoans");
  assert.deepEqual(all.stages.filter(({ active }) => active), [
    { stage: "Lead", active: 2, stalled: 1 }, { stage: "Underwriting", active: 14, stalled: 14 },
  ]);
  const more = query({ after: all.next });
  assert.equal(more.next, null);
  assert.equal(new Set([...all.items, ...more.items].map(({ id }) => id)).size, 15);
  assert.deepEqual(query({ stage: "Lead" }).items.map(({ id }) => id), ["admin-old"]);
  assert.deepEqual(query({ stage: "Lead", owner: officer.email }).items, []);
  assert.deepEqual(query({ owner: officer.email }).stages.filter(({ active }) => active), [
    { stage: "Lead", active: 1, stalled: 0 }, { stage: "Underwriting", active: 1, stalled: 1 },
  ]);
  assert.deepEqual(query({ owner: "unassigned" }).items.map(({ id, owner }) => [id, owner]), [["unassigned-old", "Unassigned"]]);
  assert.deepEqual(all.owners.find(({ email }) => email === officer.email), { email: officer.email, name: officer.name, stalled: 1 });
  assert.ok(query({}, officer).error);
  assert.ok(query({}, processor).error);
  assert.ok(query({}, admin, "other-brokerage").error);
  assert.ok(open("owned-old", officer).error);
  assert.ok(open("owned-old", admin, "other-brokerage").error);
  assert.equal(open("owned-old").workTarget, "loan-application");
  db.exec(`INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES
    ('manager-work', 'owned-old', 'Confirm revised terms', '2026-11-09T12:00:00.000Z', 'Loan service');`);
  assert.equal(open("owned-old").workTarget, "loan-task-manager-work");
  db.prepare("UPDATE loans SET officerEmail = ?, officer = ? WHERE id = 'owned-old'").run(admin.email, admin.name);
  assert.deepEqual(query({ owner: officer.email }).items, []);
  assert.equal(open("owned-old").workTarget, "loan-task-manager-work");
  db.exec("UPDATE loans SET disposition = 'On hold' WHERE id = 'owned-old'");
  assert.ok(open("owned-old").error);
});

test("a fresh fictional pilot gives its chosen officer a stalled file to rehearse", (t) => {
  const { db, officer, other } = fixture(t);
  const tenant = officer.brokerage.id;
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin", pilot: true } };
  const result = loadPilotScenario(db, admin, { type: "loadPilotScenario", id: crypto.randomUUID(), previousId: null,
    officerEmail: officer.email }, officer);
  assert.match(result.message, /ready/);
  const page = officerDashboardWork(db, { type: "stalledLoans" }, officer, tenant);
  assert.deepEqual(page.items.map(({ name, stage, days }) => ({ name, stage, days })), [
    { name: "Morgan Pilot Borrower", stage: "Lead", days: 9 },
  ]);
  assert.deepEqual(officerDashboardWork(db, { type: "stalledLoans" }, admin, tenant).items, []);
});

test("paired pilot measurements preserve legacy runs, distinguish zero from missing, and replay safely", (t) => {
  const { db, officer, other } = fixture(t);
  const outside = fixture(t);
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin", pilot: true } };
  const totals = { seconds: 240, repeatEntries: 4, systemSwitches: 3 };
  const legacy = { type: "recordPilotMeasurement", id: crypto.randomUUID(), walkthrough: "Campaign lead to repeat loan",
    caseLabel: "Fictional purchase", orbit: totals, baseline: totals };
  assert.ok(recordPilotMeasurement(db, admin, legacy).message);
  const pair = { ...legacy, id: crypto.randomUUID(), orbit: { ...totals, handling: { officerSeconds: 90, staffHandoffs: 0, waitingSeconds: 30 } },
    baseline: { ...totals, handling: { officerSeconds: 180, processorSeconds: 80, staffHandoffs: 2 } } };
  assert.ok(recordPilotMeasurement(db, admin, pair).message);
  assert.ok(recordPilotMeasurement(db, admin, pair).message);
  assert.ok(recordPilotMeasurement(db, admin, legacy).message);
  const changed = { ...pair, orbit: { ...pair.orbit, handling: { ...pair.orbit.handling, staffHandoffs: 1 } } };
  assert.match(recordPilotMeasurement(db, admin, changed).error, /different measurements/);
  assert.match(recordPilotMeasurement(db, admin, { ...pair, id: crypto.randomUUID(),
    orbit: { ...pair.orbit, handling: { waitingSeconds: 241 } } }).error, /within the elapsed time/);
  assert.ok(recordPilotMeasurement(db, { ...officer, brokerage: { ...officer.brokerage, pilot: true } }, { ...pair, id: crypto.randomUUID() }).error);
  const rows = pilotReview(db).pilotBenchmarks;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find(({ id }) => id === legacy.id).orbit, totals);
  assert.deepEqual(rows.find(({ id }) => id === pair.id).orbit, pair.orbit);
  assert.deepEqual(rows.find(({ id }) => id === pair.id).baseline, pair.baseline);
  assert.deepEqual(pilotReview(outside.db).pilotBenchmarks, []);
});

test("the presenter scenario reseeds dated work and report outcomes without duplicating or crossing the fixture", async (t) => {
  const { db, loan, officer, other } = fixture(t);
  const outside = fixture(t);
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin", pilot: true } };
  const tenant = officer.brokerage.id;
  loan("independent-file");
  outside.loan("outside-file");
  db.exec("ALTER TABLE pilot_scenario DROP COLUMN presenter");
  initializeStore(db, false);
  const first = { type: "loadPilotScenario", id: crypto.randomUUID(), previousId: null, officerEmail: officer.email, presenter: true };
  const now = new Date("2026-11-30T22:00:00.000Z");
  const reload = (input, at = now, actor = admin) => loadPilotScenario(db, actor, input, officer, at);
  const loans = () => db.prepare("SELECT id FROM loans ORDER BY id").all().map(({ id }) => id);
  const report = (from, through) => readFundingDashboard(db, { from, through, owner: "", metric: "actual", period: "selected" }, admin, tenant);
  assert.ok(reload(first, now, officer).error);
  assert.ok(reload(first, now, { ...admin, brokerage: { ...admin.brokerage, pilot: false } }).error);
  assert.ok(reload(first).message);
  assert.equal(pilotReview(db).pilotScenario.presenter, true);
  const firstIds = loans();
  assert.equal(firstIds.length, 6);
  const seed = demoGuideState(db);
  const oldToken = db.prepare("SELECT token FROM realtor_portals").get().token;
  const due = db.prepare("SELECT createdAt, dueAt FROM referral_leads WHERE id = ?").get(seed.leadId);
  assert.equal(due.createdAt, "2026-11-30T19:00:00.000Z");
  assert.equal(due.dueAt, "2026-11-30T21:00:00.000Z");
  const queue = readOfficerQueue(db, { horizon: 7 }, officer, tenant, now);
  assert.ok(queue.items.some(({ name, dueAt }) => name === "Riley Pilot Referral" && dueAt === due.dueAt));
  assert.ok(queue.items.some(({ name, title }) => name === "Quinn Demo Closing" && title === "Confirm the sample title package"));
  const exceptions = readFileExceptions(db, { filter: "Missing evidence" }, admin, tenant, now);
  assert.deepEqual(exceptions.rows.map(({ borrower, title, dueOn }) => ({ borrower, title, dueOn })),
    [{ borrower: "Quinn Demo Closing", title: "Homeowners insurance", dueOn: "2026-12-01" }]);
  const closingLoan = `demo-presenter:${first.id}:closing`;
  const insurance = () => db.prepare("SELECT id, dueOn, deadlineRevision FROM document_requests WHERE loanId = ?").get(closingLoan);
  assert.match(insurance().id, /^[0-9a-f-]{36}$/);
  const legacyId = `${closingLoan}:insurance`;
  db.prepare("UPDATE document_requests SET id = ? WHERE loanId = ?").run(legacyId, closingLoan);
  db.prepare("INSERT INTO document_files (requestId, objectId, attemptedAt) VALUES (?, 'fixture-object', 0)").run(legacyId);
  const staleFollowUp = `application-follow-up:${closingLoan}`;
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, 'Follow up on 1003', ?)").run(staleFollowUp, closingLoan, now.toISOString());
  initializeStore(db, false);
  const repairedId = insurance().id;
  assert.match(repairedId, /^[0-9a-f-]{36}$/);
  initializeStore(db, false);
  assert.equal(insurance().id, repairedId);
  assert.equal(db.prepare("SELECT requestId FROM document_files").get().requestId, repairedId);
  assert.deepEqual(db.prepare("SELECT * FROM document_file_cleanup").all(), []);
  assert.equal(db.prepare("SELECT completedAt FROM tasks WHERE id = ?").get(staleFollowUp).completedAt, now.toISOString());
  assert.equal(db.prepare("SELECT count(*) AS count FROM tasks WHERE id LIKE 'application-follow-up:%'").get().count, 1);
  const edited = await executeCommand(db, { type: "setDocumentDeadline", loanId: closingLoan, requestId: repairedId,
    revision: 0, deadlineRevision: 0, dueOn: "2026-12-02" }, officer);
  assert.equal(edited.message, "Document due date saved.");
  assert.deepEqual({ ...insurance() }, { id: repairedId, dueOn: "2026-12-02", deadlineRevision: 1 });
  const funding = report("2026-11-01", "2026-11-30");
  assert.deepEqual(funding.periods.selected.actual, { count: 1, volume: 310_000 });
  assert.deepEqual(funding.periods.previous.actual, { count: 1, volume: 290_000 });
  assert.deepEqual(funding.periods.selected.projected, { count: 1, volume: 340_000 });
  const sales = readSalesDashboard(db, { kind: "summary", from: "2026-11-01", through: "2026-11-30", channel: "Realtors", owner: "" }, admin, tenant, now);
  assert.equal(sales.periods.selected.funded, 1);
  assert.equal(sales.periods.previous.funded, 1);
  assert.ok(reload(first).message);
  assert.deepEqual(loans(), firstIds);
  assert.ok(reload({ ...first, presenter: false }).error);
  assert.ok(reload({ ...first, id: crypto.randomUUID() }).error);

  const next = { ...first, id: crypto.randomUUID(), previousId: first.id };
  assert.ok(reload(next, new Date("2026-12-01T17:00:00.000Z")).message);
  assert.equal(loans().length, 6);
  assert.deepEqual(loans().filter((id) => firstIds.includes(id)), ["independent-file"]);
  assert.ok(!db.prepare("SELECT 1 FROM referral_leads WHERE id = ?").get(seed.leadId));
  assert.ok(!db.prepare("SELECT 1 FROM realtor_portals WHERE token = ?").get(oldToken));
  const afterReset = readFileExceptions(db, { filter: "Missing evidence" }, admin, tenant, new Date("2026-12-01T17:00:00.000Z"));
  assert.deepEqual(afterReset.rows.map(({ loanId, dueOn }) => ({ loanId, dueOn })),
    [{ loanId: `demo-presenter:${next.id}:closing`, dueOn: "2026-12-02" }]);
  assert.deepEqual(report("2026-12-01", "2026-12-31").periods.selected.projected, { count: 1, volume: 340_000 });
  assert.equal(db.prepare("SELECT count(*) AS count FROM pilot_sample_contacts").get().count, 6);
  assert.equal(outside.db.prepare("SELECT id FROM loans").get().id, "outside-file");
});

test("pilot realtor revocation protects the selected link before removing it and preserves a concurrent replacement", async (t) => {
  const { db, officer, other } = fixture(t);
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin", pilot: true } };
  const scenario = { type: "loadPilotScenario", id: crypto.randomUUID(), previousId: null, officerEmail: officer.email };
  assert.ok(loadPilotScenario(db, admin, scenario, officer).message);
  const currentLink = () => db.prepare("SELECT realtorId, token, expiresAt FROM realtor_portals").get();
  const original = currentLink();
  const revoke = { type: "revokeRealtorPortal", realtorId: original.realtorId };
  const protectedTokens = [];
  const run = (staff, protectPilotLinks) => executeCommand(db, revoke, staff, undefined, [], { protectPilotLinks });
  assert.match((await run(officer, async () => assert.fail("Unauthorized staff cannot write protection"))).error, /access/i);
  assert.match((await run(admin, async () => false)).error, /could not protect/i);
  assert.deepEqual(currentLink(), original);
  const concurrent = await run(admin, async (links) => {
    protectedTokens.push(...links);
    const replaced = await executeCommand(db, { type: "createRealtorPortal", realtorId: original.realtorId }, admin);
    assert.ok(replaced.message);
    return true;
  });
  assert.match(concurrent.error, /link changed/i);
  const replacement = currentLink();
  assert.notEqual(replacement.token, original.token);
  assert.ok((await run(admin, async (links) => {
    protectedTokens.push(...links);
    return true;
  })).message);
  assert.deepEqual(protectedTokens, [original, replacement].map(({ token, expiresAt }) => ({ token, expiresAt })));
  assert.equal(currentLink(), undefined);
});

test("a pilot reset retires only links on the outgoing scenario and retries if its link set changed", async (t) => {
  const { db, loan, officer, other } = fixture(t);
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin", pilot: true } };
  const first = { type: "loadPilotScenario", id: crypto.randomUUID(), previousId: null, officerEmail: officer.email, presenter: true };
  assert.ok(loadPilotScenario(db, admin, first, officer).message);
  const borrower = `demo-presenter:${first.id}:closing`;
  const issue = (loanId) => executeCommand(db, { type: "startApplication", loanId }, officer);
  loan("independent");
  assert.ok((await issue("independent")).message);
  const readToken = (loanId) => db.prepare("SELECT token FROM applications WHERE loanId = ?").get(loanId)?.token;
  const independent = readToken("independent");
  const realtor = demoGuideState(db).realtorToken;
  const next = { ...first, id: crypto.randomUUID(), previousId: first.id };
  const reset = (protect, actor = admin) => loadProtectedPilotScenario(db, actor, next, officer, protect);
  assert.match((await reset(async () => false)).error, /could not protect/i);
  assert.equal(pilotReview(db).pilotScenario.id, first.id);
  assert.ok((await reset(async () => assert.fail("Only an admin can reset"), officer)).error);
  const interrupted = await reset(async (links) => {
    assert.deepEqual(links.map(({ token }) => token), [realtor]);
    assert.ok((await issue(borrower)).message);
    return true;
  });
  assert.match(interrupted.error, /link changed/i);
  assert.equal(pilotReview(db).pilotScenario.id, first.id);
  const outgoing = readToken(borrower);
  assert.ok((await reset(async (links) => {
    assert.deepEqual(new Set(links.map(({ token }) => token)), new Set([outgoing, realtor]));
    return true;
  })).message);
  assert.equal(readToken(borrower), undefined);
  assert.equal(readToken("independent"), independent);
  assert.notEqual(demoGuideState(db).realtorToken, realtor);
  assert.ok((await reset(async () => assert.fail("A reset retry cannot retire its newly issued links"))).message);
});

test("imported lead tasks open for their current owner and retain service work after an outreach opt-out", async (t) => {
  const { db, read, lead, officer, other } = fixture(t);
  const tenant = officer.brokerage.id;
  const leadId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const dueAt = "2026-11-08T15:00:00.000Z";
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin" } };
  lead(leadId, dueAt);
  const addTask = db.prepare("INSERT INTO lead_import_tasks (id, leadId, title, dueAt, purpose) VALUES (?, ?, ?, ?, ?)");
  addTask.run(taskId, leadId, "Imported service callback", dueAt, "Loan service");
  addTask.run("prospecting", leadId, "Imported prospecting", dueAt, "Prospecting");
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', ?, NULL, ?)").run(`email:${leadId}@example.test`, dueAt);
  const query = { leadId, task: { kind: "lead-task", id: taskId } };
  const open = (input, staff) => readEditableLead(db, input, staff, tenant);
  assert.deepEqual(read().items.map(({ id, kind }) => [id, kind]), [[taskId, "lead-task"]]);
  assert.equal(open(query, officer).lead.id, leadId);
  assert.ok(open({ ...query, task: { ...query.task, id: "prospecting" } }, officer).error);
  assert.ok(open(query, other).error);
  assert.ok(open({ ...query, task: { ...query.task, team: true } }, other).error);
  assert.equal(open({ ...query, task: { ...query.task, team: true } }, admin).lead.id, leadId);
  const calendar = readWorkspaceCalendar(db, { week: "2026-11-02", scope: "Team", group: "Outreach" }, admin, tenant);
  assert.deepEqual(calendar.items.map(({ id }) => id), [taskId]);
  const completed = await executeCommand(db, { type: "completeLeadTask", leadId, taskId, completed: true },
    officer, undefined, [], { scopedLeadUpdates: true });
  assert.ok(completed.leadWork.lead.importedTasks.find(({ id }) => id === taskId).completedAt);
  assert.ok(open(query, officer).error);
  assert.equal(read().items.length, 0);
});

test("personal production reconciles to assigned funded files and keeps targets private and revision checked", (t) => {
  const { db, officer, other, loan } = fixture(t);
  const id = officer.brokerage.id;
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin" } };
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  const read = (input, actor = officer, now = "2026-11-08T12:00:00.000Z", tenant = id) => officerDashboardWork(db, input, actor, tenant, new Date(now));
  for (const name of ["current", "previous", "projected-only", "reversed"]) loan(name);
  loan("other-current", other);
  db.exec(`INSERT INTO closing_progress (loanId, fundingDate) VALUES
    ('current','2026-11-02'), ('previous','2026-10-31'), ('other-current','2026-11-06'), ('reversed',NULL);
    INSERT INTO closing_plans VALUES ('projected-only','2026-11-20');
    UPDATE loans SET amount = 400000 WHERE id = 'current';`);
  const summary = { type: "production", officerEmail: other.email };
  const list = { type: "fundedLoans", month: "2026-11", officerEmail: other.email };
  assert.deepEqual(read(summary).current, { month: "2026-11", count: 1, volume: 400000 });
  assert.deepEqual(read(summary).previous, { month: "2026-10", count: 1, volume: 350000 });
  assert.deepEqual(read(list).loans.map(({ id }) => id), ["current"]);
  assert.deepEqual(read(list, admin).loans.map(({ id }) => id), ["other-current"]);
  const team = readFundingDashboard(db, { from: "2026-11-01", through: "2026-11-30", owner: `email:${officer.email}`, metric: "actual", period: "selected" }, admin, id);
  assert.deepEqual(team.periods.selected.actual, { count: 1, volume: 400000 });
  assert.ok(read(summary, processor).error);
  assert.ok(read(summary, officer, undefined, crypto.randomUUID()).error);
  assert.equal(read(summary, officer, "2026-12-01T04:59:59.000Z").current.month, "2026-11");
  assert.equal(read(summary, officer, "2026-12-01T05:00:00.000Z").current.month, "2026-12");

  const target = { type: "saveTarget", month: "2026-11", count: 3, volume: 900000, revision: 0, officerEmail: other.email };
  assert.equal(read(target).target.revision, 1);
  assert.equal(read(target).target.revision, 1);
  assert.match(read({ ...target, count: 4 }).error, /changed/);
  assert.ok(read({ ...target, month: "2026-10" }).error);
  assert.equal(read(summary).target.count, 3);
  assert.equal(read(summary, admin).target, null);
  assert.ok(read(target, processor).error);
  assert.ok(read(target, officer, undefined, "other-brokerage").error);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Saved personal production targets'").get().count, 1);
  assert.equal(read(summary, officer, "2026-12-01T05:00:00.000Z").target, null);

  db.exec("UPDATE closing_progress SET fundingDate = '2026-10-31' WHERE loanId = 'current';");
  assert.equal(read(summary).current.count, 0);
  assert.equal(read(summary).previous.volume, 750000);
  assert.deepEqual(read(list).loans, []);
  db.prepare("UPDATE loans SET officerEmail = ? WHERE id = 'previous'").run(other.email);
  assert.equal(read(summary).previous.volume, 400000);
  assert.equal(read(summary, admin).previous.volume, 350000);
  db.exec("UPDATE closing_progress SET fundingDate = NULL WHERE loanId = 'current';");
  assert.equal(read(summary).previous.count, 0);
});

test("past-client opportunities page owned open tasks with a reason, excluding opt-outs and stale triggers", (t) => {
  const { db, officer, other, loan } = fixture(t);
  const now = new Date("2026-11-08T12:00:00.000Z");
  const id = officer.brokerage.id;
  const work = (after, actor = officer, tenant = id) => officerDashboardWork(db, { type: "opportunities", after }, actor, tenant, now);
  const due = "2026-11-10T17:00:00.000Z";
  const create = (name, owner = officer, stage = "Funded", observedRate = 6) => {
    loan(name, owner);
    db.prepare("UPDATE loans SET stage = ? WHERE id = ?").run(stage, name);
    db.prepare(`INSERT INTO past_client_profiles (loanId, closingDate, currentRate, targetRate, observedRate, checkedAt, watchEnabled)
      VALUES (?, '2024-11-10', 6.75, 6.125, ?, ?, 1)`).run(name, observedRate, now.toISOString());
  };
  const task = (id, loanId, date = due) => db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES (?, ?, 'Sample follow-up', ?, 'Prospecting')").run(id, loanId, date);
  for (const name of ["visible", "hidden-optout", "completed", "outside-window", "anniversary", ...Array.from({ length: 8 }, (_, n) => `tied-${n}`)]) create(name);
  create("wrong-owner", other);
  create("not-past", officer, "Underwriting");
  create("above-target", officer, "Funded", 6.25);
  for (const name of ["visible", "hidden-optout", "completed", "wrong-owner", "not-past", "above-target", ...Array.from({ length: 8 }, (_, n) => `tied-${n}`)]) task(`rate-watch:${name}`, name);
  task("closing-anniversary:anniversary:2026-11-10", "anniversary");
  task("closing-anniversary:anniversary:2025-11-10", "anniversary", "2025-11-10T17:00:00.000Z");
  task("closing-anniversary:outside-window:2026-12-09", "outside-window", "2026-12-09T05:00:00.000Z");
  db.prepare("UPDATE tasks SET completedAt = ? WHERE id = 'rate-watch:completed'").run(now.toISOString());
  insertContact(db, { id: "opt-out-alias", role: "Borrower", name: "Private alias", email: "hidden-optout@example.test", phone: "2485550193" });
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('test', 'phone:2485550193', NULL, ?)").run(now.toISOString());

  const first = work();
  assert.equal(first.items.length, 6);
  assert.ok(first.next);
  const second = work(first.next);
  assert.equal(second.next, null);
  const rows = [...first.items, ...second.items];
  assert.equal(new Set(rows.map(({ id }) => id)).size, 10);
  assert.deepEqual(rows[0], { kind: "Closing anniversary", loanId: "anniversary", name: "anniversary", closingDate: "2024-11-10",
    id: "closing-anniversary:anniversary:2025-11-10", dueAt: "2025-11-10T17:00:00.000Z" });
  assert.match(rows.find((item) => item.loanId === "visible").context, /Observed 6\.000% · Target 6\.125% · Current 6\.750%/);
  assert.doesNotMatch(JSON.stringify(rows), /hidden-optout|outside-window|wrong-owner|not-past|above-target|completed|example\.test/);
  assert.deepEqual(work(undefined, other).items.map(({ loanId }) => loanId), ["wrong-owner"]);
  assert.ok(work(undefined, officer, "other-brokerage").error);
  db.prepare("UPDATE tasks SET completedAt = ? WHERE id = 'closing-anniversary:anniversary:2025-11-10'").run(now.toISOString());
  assert.ok(work().items.some(({ id }) => id === "closing-anniversary:anniversary:2026-11-10"));
});

test("the officer queue reconciles owned due work, reassignment, and suppression across sources", (t) => {
  const { db, read, lead, loan, officer, other } = fixture(t);
  const overdue = "2026-11-08T04:30:00.000Z";
  const due = "2026-11-08T15:00:00.000Z";
  lead("owned", overdue);
  lead("held", overdue);
  db.prepare("UPDATE referral_leads SET heldAt = ? WHERE id = 'held'").run(overdue);
  lead("unowned", overdue, other);
  lead("next-week", "2026-11-11T15:00:00.000Z");
  lead("suppressed", overdue, officer, "alias@example.test");
  insertContact(db, { id: "alias", name: "Alias", role: "Borrower", email: "alias@example.test", phone: "+1 (248) 555-0101" });
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', 'phone:2485550101', NULL, ?)").run(overdue);
  lead("campaign-lead", overdue);
  db.prepare("INSERT INTO lead_follow_up (leadId, firstContactAt) VALUES ('campaign-lead', ?)").run(overdue);
  db.prepare("INSERT INTO call_campaigns VALUES ('campaign-id', 'Fictional campaign', ?)").run(overdue);
  db.prepare("INSERT INTO lead_import_tasks (id, leadId, title, dueAt, purpose) VALUES ('call-id', 'campaign-lead', 'Callback', ?, 'Prospecting')").run(due);
  db.prepare(`INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, lastOutcome, callbackTaskId)
    VALUES ('campaign-lead', 'campaign-id', ?, 'Requested callback', 'call-id')`).run(overdue);

  loan("loan-id");
  loan("other-loan", other);
  db.prepare(`INSERT INTO contact_activity (id, contactId, officer, officerEmail, kind, outcome, text, createdAt, dueAt, followUpOwner, followUpOwnerEmail, purpose)
    VALUES ('contact-task', 'other-loan-contact', ?, ?, 'Call', 'Requested callback', '', ?, ?, ?, ?, 'Loan service')`)
    .run(other.name, other.email, overdue, due, officer.name, officer.email);
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES ('loan-task', 'loan-id', 'Review documents', ?, 'Loan service')").run(due);
  db.exec(`INSERT INTO closing_plans VALUES ('loan-id', '2026-11-08'), ('other-loan', '2026-11-08');
    INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES ('checklist-task', 'loan-id', 'Confirm signing', 'Alex', '2026-11-08');`);
  insertSubmission(db, { id: "mock-file", loanId: "loan-id", lender: "UWM", externalId: "DEMO-1", status: "Approved", conditions: [], syncedAt: due });
  db.prepare(`INSERT INTO mock_uwm_rates (loanId, submissionId, loanNumber, runId, offerId, product, rate, quotedAt, floatReference, floatedAt, lockExpiresAt)
    VALUES ('loan-id', 'mock-file', 'DEMO-1', 'run', 'offer', 'Sample', 6.25, ?, 'float', ?, ?)`).run(overdue, overdue, due);

  const today = read({ horizon: 1, owner: other.email });
  assert.deepEqual(today.items.map(({ kind, id }) => `${kind}:${id}`),
    ["lead:owned", "checklist:checklist-task", "closing:loan-id", "campaign:call-id", "contact:contact-task", "loan:loan-task", "lock:loan-id"]);
  assert.deepEqual(today.items.filter((item) => item.overdue).map(({ id }) => id), ["owned"]);
  assert.equal(today.items.find(({ kind }) => kind === "campaign").campaignId, "campaign-id");
  assert.ok(!today.items.some((row) => "phone" in row || "email" in row));
  assert.ok(read({ horizon: 7 }).items.some(({ id }) => id === "next-week"));
  assert.ok(read({ horizon: 1 }, { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } }).error);
  assert.ok(read({ horizon: 1 }, officer, crypto.randomUUID()).error);
  db.prepare("UPDATE referral_leads SET officerEmail = ? WHERE id = 'campaign-lead'").run(other.email);
  assert.ok(!read().items.some(({ id }) => id === "call-id"));
  assert.ok(read({ horizon: 1 }, other).items.some(({ id }) => id === "call-id"));
  db.exec("UPDATE contact_activity SET completedAt = dueAt WHERE id = 'contact-task'; UPDATE mock_uwm_rates SET lockCancelledAt = lockExpiresAt;");
  assert.ok(!read().items.some(({ kind }) => kind === "contact" || kind === "lock"));
});

test("a returned handoff reaches the current owner immediately with the playbook deadline and exact loan target", (t) => {
  const { db, read, loan, officer, other } = fixture(t);
  const now = new Date("2026-11-08T12:00:00.000Z");
  const returnedAt = "2026-11-08T11:30:00.000Z";
  const tenant = officer.brokerage.id;
  const processor = { ...other, brokerage: { ...other.brokerage, role: "Processor" } };
  writePlaybook(db, { ...defaultPlaybook, handoffHours: 36 });
  loan("returned");
  db.prepare("INSERT INTO loan_processing VALUES ('returned', ?, ?, 'In processing', '', ?, 1)")
    .run(processor.email, processor.name, returnedAt);
  assert.equal(read().items.length, 0);
  assert.ok(updateProcessing(db, processor, { type: "updateProcessing", loanId: "returned", revision: 1, action: "Return to LO",
    note: "Mock lender conditions cleared." }, returnedAt).message);
  assert.deepEqual(read().items, [{ kind: "handoff", id: "returned", recordId: "returned", name: "returned",
    title: "Returned from processing", dueAt: returnedAt, handoffDueAt: "2026-11-09T23:30:00.000Z", target: "processing-handoff", overdue: false }]);
  assert.deepEqual(read({ horizon: 1 }, other).items, []);
  assert.ok(read({ horizon: 1 }, processor).error);
  assert.deepEqual(readWorkspaceCalendar(db, { week: "2026-11-08", group: "All", scope: "Mine" }, officer, tenant, now).items, []);
  assert.equal(readOfficerQueue(db, { horizon: 1 }, officer, tenant, new Date("2026-11-10T00:00:00.000Z")).items[0].overdue, true);
  db.prepare("UPDATE loans SET officerEmail = ? WHERE id = 'returned'").run(other.email);
  assert.deepEqual(read().items, []);
  assert.equal(read({ horizon: 1 }, other).items[0].id, "returned");
  assert.ok(updateProcessing(db, other, { type: "updateProcessing", loanId: "returned", revision: 2, action: "Complete handoff", note: "" },
    now.toISOString()).message);
  assert.deepEqual(read({ horizon: 1 }, other).items, []);
});

test("the officer queue pages tied deadlines across Eastern midnight without duplicating or losing work", (t) => {
  const { db, read, lead, loan } = fixture(t, "2026-07-10T11:00:00.000Z");
  for (let i = 0; i < 42; i++) lead(`lead-${String(i).padStart(2, "0")}`, "2026-07-10T04:00:00.000Z");
  lead("before-summer-midnight", "2026-07-11T03:59:59.999Z");
  lead("after-summer-midnight", "2026-07-11T04:00:00.000Z");
  loan("calendar-loan");
  db.exec("INSERT INTO closing_plans VALUES ('calendar-loan', '2026-07-10');");
  const rows = [];
  let after;
  do {
    const page = read({ horizon: 1, after });
    assert.ok(page.items.length <= 20);
    rows.push(...page.items);
    after = page.next;
  } while (after);
  assert.equal(rows[0].id, "calendar-loan");
  assert.equal(rows.at(-1).id, "before-summer-midnight");
  assert.equal(new Set(rows.map(({ id }) => id)).size, 44);
  db.exec("DROP INDEX active_leads_by_officer_due; DROP INDEX open_tasks_by_loan_due;");
  initializeStore(db, false);
  initializeStore(db, false);
  assert.deepEqual(read().items, rows.slice(0, 20));
});

test("the calendar follows deadlines, closing completion, processor coverage, and brokerage permissions", (t) => {
  const now = new Date("2026-11-08T12:00:00.000Z");
  const { db, lead, loan, officer, other } = fixture(t, now.toISOString());
  const as = (staff, role) => ({ ...staff, brokerage: { ...staff.brokerage, role } });
  const admin = as(officer, "Admin");
  const processor = as(other, "Processor");
  const query = { week: "2026-11-09", scope: "Mine", group: "All" };
  const calendar = (actor, filters = {}, tenant = officer.brokerage.id) => readWorkspaceCalendar(db, { ...query, ...filters }, actor, tenant, now);
  const ids = (page) => page.items.map(({ id, kind }) => `${kind}:${id}`);
  const due = "2026-11-10T16:00:00.000Z";
  loan("closing");
  loan("unassigned-file");
  lead("other-first-contact", due, other);
  lead("already-due", "2026-11-08T13:00:00.000Z");
  lead("call-lead", due);
  db.prepare("INSERT INTO lead_follow_up (leadId, firstContactAt) VALUES ('call-lead', ?)").run(now.toISOString());
  db.prepare("INSERT INTO call_campaigns VALUES ('calendar-campaign', 'Fictional calendar campaign', ?)").run(now.toISOString());
  db.prepare("INSERT INTO lead_import_tasks (id, leadId, title, dueAt, purpose) VALUES ('call-id', 'call-lead', 'Callback', ?, 'Prospecting')").run(due);
  db.prepare(`INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, lastOutcome, callbackTaskId)
    VALUES ('call-lead', 'calendar-campaign', ?, 'Requested callback', 'call-id')`).run(now.toISOString());
  db.prepare("INSERT INTO loan_processing VALUES ('closing', ?, ?, 'Assigned', '', ?, 1)").run(other.email, other.name, now.toISOString());
  db.exec(`INSERT INTO closing_plans VALUES ('closing', '2026-11-10'), ('unassigned-file', '2026-11-10');
    INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES ('signing', 'closing', 'Confirm signing', 'Processor', '2026-11-10');`);
  db.prepare(`INSERT INTO loan_conversations (id, loanId, contactId, audience, ownerRole, dueOn, updatedAt)
    VALUES ('thread', 'closing', 'closing-contact', 'Borrower', 'Processor', '2026-11-10', ?)`).run(now.toISOString());
  insertSubmission(db, { id: "mock-file", loanId: "closing", lender: "UWM", externalId: "DEMO-1", status: "Approved", conditions: [], syncedAt: due });
  db.prepare(`INSERT INTO mock_uwm_rates (loanId, submissionId, loanNumber, runId, offerId, product, rate, quotedAt, floatReference, floatedAt, lockExpiresAt)
    VALUES ('closing', 'mock-file', 'DEMO-1', 'run', 'offer', 'Sample', 6.25, ?, 'float', ?, ?)`).run(now.toISOString(), now.toISOString(), due);

  assert.deepEqual(ids(calendar(officer)), ["checklist:signing", "closing:closing", "closing:unassigned-file", "campaign:call-id", "lock:closing"]);
  assert.deepEqual(ids(calendar(processor)), ["checklist:signing", "closing:closing", "conversation:thread"]);
  assert.equal(calendar(processor).items[0].target, "closing-checklist-signing");
  assert.deepEqual(calendar(officer, { group: "Outreach" }).items.map(({ recordId, campaignId }) => [recordId, campaignId]), [["call-lead", "calendar-campaign"]]);
  const team = calendar(admin, { scope: "Team" });
  assert.equal(team.items.find(({ id }) => id === "thread").owner, other.name);
  assert.equal(team.items.find(({ id }) => id === "other-first-contact").owner, other.name);
  assert.ok(team.items.every((item) => !("email" in item || "phone" in item)));
  for (const actor of [officer, processor]) assert.ok(calendar(actor, { scope: "Team" }).error);
  assert.ok(calendar(admin, {}, crypto.randomUUID()).error);
  assert.ok(calendar(null).error);
  assert.ok(calendar(admin, { day: "2026-11-08" }).error);

  db.exec(`UPDATE closing_plans SET targetDate = '2026-11-12' WHERE loanId = 'closing';
    UPDATE closing_items SET completedAt = '2026-11-08T12:01:00.000Z' WHERE id = 'signing';
    UPDATE loan_conversations SET status = 'Closed' WHERE id = 'thread';
    UPDATE mock_uwm_rates SET lockCancelledAt = '2026-11-08T12:02:00.000Z' WHERE loanId = 'closing';
    UPDATE lead_import_tasks SET dueAt = '2026-11-12T20:00:00.000Z' WHERE id = 'call-id';`);
  assert.deepEqual(ids(calendar(processor, { day: "2026-11-12" })), ["closing:closing"]);
  assert.deepEqual(ids(calendar(officer, { day: "2026-11-12" })), ["closing:closing", "campaign:call-id"]);
  assert.deepEqual(ids(calendar(officer, { day: "2026-11-10" })), ["closing:unassigned-file"]);
  db.prepare("UPDATE loan_processing SET processorEmail = ?, processorName = ? WHERE loanId = 'closing'").run(officer.email, officer.name);
  assert.deepEqual(ids(calendar(processor)), []);
  assert.deepEqual(ids(calendar(as(officer, "Processor"))), ["closing:closing"]);
});

test("calendar pagination respects both Eastern week boundaries across the fall clock change", (t) => {
  const { db, lead, loan, officer } = fixture(t);
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const query = { week: "2026-10-26", scope: "Team", group: "All" };
  const read = (after) => readWorkspaceCalendar(db, { ...query, after }, admin, officer.brokerage.id, new Date("2026-11-01T10:00:00.000Z"));
  lead("outside-before", "2026-10-26T03:59:59.999Z");
  for (let i = 0; i < 45; i++) lead(`lead-${String(i).padStart(2, "0")}`, "2026-10-26T04:00:00.000Z");
  lead("sunday-night", "2026-11-02T04:59:59.999Z");
  lead("outside-after", "2026-11-02T05:00:00.000Z");
  loan("all-day-closing");
  db.exec("INSERT INTO closing_plans VALUES ('all-day-closing', '2026-10-26')");
  const items = [];
  let next;
  do {
    const page = read(next);
    assert.ok(page.items.length <= 20);
    items.push(...page.items);
    next = page.next;
  } while (next);
  assert.equal(items[0].id, "all-day-closing");
  assert.equal(items.at(-1).id, "sunday-night");
  assert.equal(new Set(items.map(({ id }) => id)).size, 47);
});

test("loan appointments move and cancel once, follow assignment, and reject ambiguous Eastern times", (t) => {
  const { db, loan, officer, other } = fixture(t);
  const now = new Date("2026-10-31T12:00:00.000Z");
  const as = (staff, role) => ({ ...staff, brokerage: { ...staff.brokerage, role } });
  const admin = as(officer, "Admin");
  const processor = as(other, "Processor");
  const work = (input, actor = officer, brokerageId = officer.brokerage.id) => workOnAppointment(db, input, actor, brokerageId, now);
  const calendar = (week, actor, scope = "Mine") => readWorkspaceCalendar(db, { week, scope, group: "Appointments" }, actor, officer.brokerage.id, now);
  loan("appointment-file");
  loan("other-file", other);
  db.prepare("INSERT INTO loan_processing VALUES ('appointment-file', ?, ?, 'Assigned', '', ?, 1)").run(other.email, other.name, now.toISOString());
  const input = { type: "save", loanId: "appointment-file", id: crypto.randomUUID(), revision: 0,
    title: "Fictional signing", localStart: "2026-11-01T01:30", durationMinutes: 45, ownerRole: "Processor" };
  assert.equal(appointmentInstant("2026-03-08T02:30"), null);
  assert.equal(appointmentInstant("2026-07-10T09:15"), "2026-07-10T13:15:00.000Z");
  assert.match(work(input).error, /repeated hour/);
  assert.match(work({ ...input, localStart: "2026-10-31T07:00" }).error, /future/);
  assert.ok(work({ ...input, loanId: "other-file" }).error);
  assert.ok(work({ ...input, ownerRole: "Loan officer" }, processor).error);
  assert.ok(work(input, admin, crypto.randomUUID()).error);
  const saved = { ...input, localStart: "2026-11-01T02:30" };
  assert.equal(work(saved).items[0].startsAt, "2026-11-01T07:30:00.000Z");
  assert.equal(work(saved).items[0].revision, 1);
  assert.equal(Object.getPrototypeOf(work(saved).items[0]), Object.prototype);
  assert.ok(work({ ...saved, loanId: "other-file" }, admin).error);
  assert.deepEqual(calendar("2026-10-26", officer).items, []);
  assert.equal(calendar("2026-10-26", processor).items[0].target, `loan-appointment-${input.id}`);
  assert.equal(calendar("2026-10-26", admin, "Team").items[0].owner, other.name);

  const move = { ...saved, revision: 1, localStart: "2026-11-02T09:15" };
  assert.equal(work(move, processor).items[0].startsAt, "2026-11-02T14:15:00.000Z");
  assert.equal(work(move, processor).items[0].revision, 2);
  assert.ok(work({ ...move, title: "Stale title" }, processor).error);
  assert.deepEqual(calendar("2026-10-26", processor).items, []);
  assert.equal(calendar("2026-11-02", processor).items.length, 1);

  db.prepare("UPDATE loan_processing SET processorEmail = ?, processorName = ? WHERE loanId = 'appointment-file'").run(officer.email, officer.name);
  assert.ok(work({ type: "list", loanId: input.loanId, focusId: input.id }, processor).error);
  assert.deepEqual(calendar("2026-11-02", processor).items, []);
  const cancel = { type: "cancel", loanId: input.loanId, id: input.id, revision: 2 };
  const newProcessor = as(officer, "Processor");
  assert.ok(work(cancel, newProcessor).items[0].cancelledAt);
  assert.equal(work(cancel, newProcessor).items[0].revision, 3);
  assert.deepEqual(calendar("2026-11-02", admin, "Team").items, []);
  assert.equal(db.prepare("SELECT count(*) AS count FROM activity WHERE loanId = ? AND text LIKE 'Appointment %'").get(input.loanId).count, 3);
});

test("a dated backup can work owned callbacks and deadlines without acquiring the loan or changing owners", (t) => {
  const { db, loan, lead, officer, other } = fixture(t);
  const manager = { name: "Manager", email: "manager@example.test", brokerage: { ...officer.brokerage, role: "Admin" } };
  const members = [officer, other, manager].map(({ name, email, brokerage }) => ({ name, email, role: brokerage.role, status: "Active" }));
  const at = "2026-11-08T13:00:00.000Z";
  const request = (input, actor = other, now = at, roster = members) => coverageWork(db, input, actor, officer.brokerage.id, roster, new Date(now));
  const id = crypto.randomUUID();
  const schedule = { type: "schedule", id, absentEmail: officer.email, backupEmail: other.email, startsOn: "2026-11-08", endsOn: "2026-11-09" };
  const queue = { type: "queue", id };
  assert.ok(request(schedule).error);
  assert.equal(request(schedule, manager).kind, "saved");
  assert.equal(request(schedule, manager).kind, "saved");
  assert.ok(request({ ...schedule, id: crypto.randomUUID() }, manager).error);
  assert.ok(request({ ...schedule, id: crypto.randomUUID(), absentEmail: other.email, backupEmail: manager.email }, manager).error);
  assert.ok(request(queue, other, "2026-11-08T04:59:59.999Z").error);
  assert.ok(request(queue, officer).error);
  assert.ok(coverageWork(db, queue, other, crypto.randomUUID(), members, new Date(at)).error);
  assert.ok(request(queue, other, at, members.map((member) => ({ ...member, accessRevision: 1 }))).error);
  assert.ok(request(queue, other, at, members.filter((member) => member.email !== officer.email)).error);

  const due = "2026-11-08T14:00:00.000Z";
  loan("covered-loan");
  loan("foreign-loan", other);
  db.exec(`INSERT INTO closing_plans VALUES ('covered-loan', '2026-11-08'), ('foreign-loan', '2026-11-08');
    INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES ('covered-item', 'covered-loan', 'Confirm signing', 'LO', '2026-11-08');
    INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, dueOn)
      VALUES ('covered-doc', 'covered-loan', 'Tax form', 'Fictional sample', '${at}', '2026-11-09');`);
  const contactTask = db.prepare(`INSERT INTO contact_activity (id, contactId, officer, officerEmail, kind, outcome, text, createdAt, dueAt, followUpOwner, followUpOwnerEmail, purpose)
    VALUES (?, 'covered-loan-contact', ?, ?, 'Call', 'Requested callback', 'Fictional callback', ?, ?, ?, ?, 'Loan service')`);
  contactTask.run("borrower-callback", officer.name, officer.email, at, due, officer.name, officer.email);
  contactTask.run("later-callback", officer.name, officer.email, at, "2026-11-10T14:00:00.000Z", officer.name, officer.email);
  lead("covered-lead", due);
  lead("blocked-lead", due);
  db.exec(`INSERT INTO call_campaigns VALUES ('covered-campaign', 'Fictional campaign', '${at}');
    INSERT INTO lead_import_tasks (id, leadId, title, dueAt, purpose) VALUES
      ('campaign-callback', 'covered-lead', 'Callback', '${due}', 'Prospecting'), ('blocked-callback', 'blocked-lead', 'Callback', '${due}', 'Prospecting');
    INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, lastOutcome, callbackTaskId) VALUES
      ('covered-lead', 'covered-campaign', '${at}', 'Requested callback', 'campaign-callback'),
      ('blocked-lead', 'covered-campaign', '${at}', 'Requested callback', 'blocked-callback');
    INSERT INTO outreach_opt_outs VALUES ('blocked', 'email:blocked-lead@example.test', NULL, '${at}');`);
  assert.deepEqual(request(queue).items.map(({ id }) => id), ["covered-item", "covered-loan", "campaign-callback", "borrower-callback", "covered-doc"]);
  assert.ok(request(queue).items.every((item) => !("phone" in item || "email" in item || "recordId" in item)));
  const readItem = (kind, itemId) => request({ type: "item", id, item: { kind, id: itemId } });
  assert.ok(readItem("closing", "foreign-loan").error);
  assert.ok(readItem("campaign", "blocked-callback").error);
  assert.ok(readItem("contact", "later-callback").error);
  assert.equal(readItem("campaign", "campaign-callback").item.email, "covered-lead@example.test");
  assert.equal(Object.getPrototypeOf(request({ type: "list" }).windows[0]), Object.prototype);
  assert.ok(readEditableLoan(db, "covered-loan", other, officer.brokerage.id).error);

  const act = (update) => ({ type: "act", id, operationId: crypto.randomUUID(), update });
  const call = act({ kind: "campaign", id: "campaign-callback", revision: 0, outcome: "Connected", note: "Fictional call handled." });
  assert.equal(request(call).kind, "saved");
  assert.equal(request(call).kind, "saved");
  assert.ok(request({ ...call, update: { ...call.update, note: "Conflicting replay" } }).error);
  assert.equal(db.prepare("SELECT attempts FROM call_campaign_members WHERE leadId = 'covered-lead'").get().attempts, 1);
  assert.equal(db.prepare("SELECT actor FROM lead_events WHERE leadId = 'covered-lead' AND outcome = 'Connected'").get().actor, other.name);
  assert.equal(request(act({ kind: "contact", id: "borrower-callback", revision: 0, outcome: "Connected", note: "Reached borrower." })).kind, "saved");
  assert.equal(db.prepare("SELECT actorEmail FROM contact_follow_up_completions WHERE activityId = 'borrower-callback'").get().actorEmail, other.email);
  assert.ok(request(act({ kind: "document", id: "covered-doc", revision: 0, deadlineRevision: 9, dueOn: "2026-11-10" })).error);
  assert.equal(request(act({ kind: "document", id: "covered-doc", revision: 0, deadlineRevision: 0, dueOn: "2026-11-10" })).kind, "saved");
  assert.equal(request(act({ kind: "closing", id: "covered-loan", previous: "2026-11-08", dueOn: "2026-11-11" })).kind, "saved");
  assert.equal(request(act({ kind: "checklist", id: "covered-item", revision: 1 })).kind, "saved");
  assert.deepEqual(request(queue).items, []);
  assert.equal(db.prepare("SELECT officerEmail FROM loans WHERE id = 'covered-loan'").get().officerEmail, officer.email);
  assert.equal(db.prepare("SELECT officerEmail FROM referral_leads WHERE id = 'covered-lead'").get().officerEmail, officer.email);
  assert.equal(db.prepare("SELECT followUpOwnerEmail FROM contact_activity WHERE id = 'borrower-callback'").get().followUpOwnerEmail, officer.email);
  assert.equal(request(queue, other, "2026-11-10T04:59:59.999Z").kind, "queue");
  assert.ok(request(queue, other, "2026-11-10T05:00:00.000Z").error);
  assert.equal(request({ type: "end", id }, manager).kind, "saved");
  assert.ok(request(queue).error);
});

test("coverage completes the exact imported lead follow-up without transferring ownership", async (t) => {
  const { db, officer, other } = fixture(t);
  const { id: brokerageId } = officer.brokerage;
  const manager = { ...other, email: "manager@example.test", name: "Manager", brokerage: { ...officer.brokerage, role: "Admin", pilot: true } };
  const roster = [officer, other, manager].map(({ name, email, brokerage }) => ({ name, email, role: brokerage.role, status: "Active" }));
  const at = "2026-11-08T13:00:00.000Z";
  const due = "2026-11-08T14:00:00.000Z";
  const importInput = { type: "migratePipeline", origin: "coverage-rehearsal", decisions: {}, rows: [
    { type: "Lead", externalId: "lead", parentId: "", name: "Fictional covered lead", email: "covered-import@example.test", phone: "248-555-0143",
      purpose: "Purchase", source: "Imported CRM", zip: "48304", ownerEmail: officer.email, createdAt: at, dueAt: due },
    { type: "Task", externalId: "service", parentId: "lead", dueAt: due, completedAt: "", text: "Imported service callback", taskPurpose: "Loan service" },
    { type: "Task", externalId: "prospecting", parentId: "lead", dueAt: due, completedAt: "", text: "Imported prospecting callback", taskPurpose: "Prospecting" },
  ] };
  const reviewed = await executeCommand(db, importInput, manager, undefined, roster);
  assert.ok(reviewed.migration, reviewed.error);
  const imported = await executeCommand(db, { ...importInput, preview: reviewed.migration.fingerprint }, manager, undefined, roster);
  assert.ok(imported.migration, imported.error);
  const target = (key) => imported.migration.rows.find((row) => row.key === key).targetId;
  const leadId = target("Lead:lead");
  const taskId = target("Task:service");
  const prospectingId = target("Task:prospecting");
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', 'email:covered-import@example.test', NULL, ?)").run(at);

  const id = crypto.randomUUID();
  const work = (input, actor = other, tenant = brokerageId) => coverageWork(db, coverageInput.parse(input), actor, tenant, roster, new Date(at));
  const queue = { type: "queue", id };
  const item = (task) => ({ type: "item", id, item: { kind: "lead-task", id: task } });
  const act = { type: "act", id, operationId: crypto.randomUUID(), update: { kind: "lead-task", id: taskId, previous: due } };
  assert.equal(work({ type: "schedule", id, absentEmail: officer.email, backupEmail: other.email, startsOn: "2026-11-08", endsOn: "2026-11-08" }, manager).kind, "saved");
  assert.deepEqual(work(queue).items.map(({ kind, id, dueAt }) => ({ kind, id, dueAt })), [{ kind: "lead-task", id: taskId, dueAt: due }]);
  assert.equal(work(item(taskId)).item.email, "covered-import@example.test");
  assert.ok(work(item(prospectingId)).error);
  assert.ok(work(item(taskId), other, crypto.randomUUID()).error);
  assert.ok(readEditableLead(db, { leadId, task: { kind: "lead-task", id: taskId } }, other, brokerageId).error);

  db.prepare("UPDATE referral_leads SET heldAt = ? WHERE id = ?").run(at, leadId);
  assert.ok(work(act).error);
  db.prepare("UPDATE referral_leads SET heldAt = NULL, resolvedAt = ? WHERE id = ?").run(at, leadId);
  assert.ok(work(act).error);
  db.prepare("UPDATE referral_leads SET resolvedAt = NULL, officerEmail = ? WHERE id = ?").run(other.email, leadId);
  assert.ok(work(act).error);
  db.prepare("UPDATE referral_leads SET officerEmail = ? WHERE id = ?").run(officer.email, leadId);
  const campaign = crypto.randomUUID();
  db.prepare("INSERT INTO call_campaigns VALUES (?, 'Fictional campaign', ?)").run(campaign, at);
  db.prepare("INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, callbackTaskId) VALUES (?, ?, ?, ?)").run(leadId, campaign, at, taskId);
  assert.ok(work(act).error);
  db.prepare("UPDATE call_campaign_members SET callbackTaskId = NULL WHERE leadId = ?").run(leadId);
  db.prepare("UPDATE lead_import_tasks SET dueAt = ? WHERE id = ?").run("2026-11-08T15:00:00.000Z", taskId);
  assert.match(work(act).error, /deadline changed/);
  db.prepare("UPDATE lead_import_tasks SET dueAt = ? WHERE id = ?").run(due, taskId);

  assert.equal(work(act).kind, "saved");
  assert.equal(work(act).kind, "saved");
  assert.ok(work({ ...act, operationId: crypto.randomUUID() }).error);
  assert.deepEqual(work(queue).items, []);
  assert.equal(db.prepare("SELECT officerEmail FROM referral_leads WHERE id = ?").get(leadId).officerEmail, officer.email);
  assert.deepEqual({ ...db.prepare("SELECT dueAt, completedAt FROM lead_import_tasks WHERE id = ?").get(taskId) }, { dueAt: due, completedAt: at });
  const history = db.prepare("SELECT actor FROM workspace_access_history WHERE action = 'Worked staff coverage item'").all();
  assert.deepEqual(history.map(({ actor }) => actor), [other.email]);
  assert.equal(work({ type: "end", id }, manager).kind, "saved");
  assert.ok(work(act).error);
  assert.ok(work(item(taskId)).error);
});

test("processing coverage follows assigned deadlines and does not return after a directory role reset", (t) => {
  const { db, loan, officer, other } = fixture(t);
  const at = "2026-11-08T13:00:00.000Z";
  initializeBrokerages(db);
  const manager = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const tenant = manager.brokerage.id;
  db.prepare("INSERT INTO brokerages (id, name, pilot) VALUES (?, 'Fictional team', 1)").run(tenant);
  const addMember = db.prepare("INSERT INTO brokerage_members (brokerageId,email,name,role,status) VALUES (?, ?, ?, ?, 'Active')");
  addMember.run(tenant, officer.email, officer.name, "Admin");
  addMember.run(tenant, other.email, other.name, "Processor");
  const roster = () => selectedActiveMembers(db, tenant, [officer.email, other.email], []);
  const read = (input) => coverageWork(db, input, manager, tenant, roster(), new Date(at));
  loan("processor-file");
  db.prepare("INSERT INTO loan_processing VALUES ('processor-file', ?, ?, 'Assigned', '', ?, 1)").run(other.email, other.name, at);
  db.exec("INSERT INTO closing_plans VALUES ('processor-file', '2026-11-08')");
  const id = crypto.randomUUID();
  assert.equal(read({ type: "schedule", id, absentEmail: other.email, backupEmail: officer.email, startsOn: "2026-11-08", endsOn: "2026-11-08" }).kind, "saved");
  const queue = { type: "queue", id };
  assert.deepEqual(read(queue).items.map(({ id }) => id), ["processor-file"]);
  assert.ok(changeBrokerage(db, tenant, manager, [], { type: "role", email: other.email, role: "LO" }).message);
  assert.ok(read(queue).error);
  assert.ok(changeBrokerage(db, tenant, manager, [], { type: "role", email: other.email, role: "Processor" }).message);
  assert.ok(read(queue).error);
  assert.ok(changeBrokerage(db, tenant, manager, [], { type: "revoke", email: other.email }).message);
  assert.equal(roster().length, 1);
  assert.ok(changeBrokerage(db, tenant, manager, [], { type: "invite", email: other.email, role: "Processor" }).message);
  activateBrokerages(db, other, []);
  assert.equal(roster().length, 2);
  assert.ok(read(queue).error);
});

test("contact identity indexing keeps one-hop opt-outs intact during migration, edits and deletion", (t) => {
  const { db } = fixture(t);
  db.exec(`DROP TRIGGER contact_outreach_insert; DROP TRIGGER contact_outreach_update;
    DROP TABLE contact_outreach_keys; DROP TABLE contact_outreach_pending;
    DELETE FROM settings WHERE key = 'contactOutreachIndexV1';
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1600)
    INSERT INTO contacts (id, name, email, phone, role) SELECT printf('prior-%05d', n), 'Fictional contact', '', '', 'Borrower' FROM seq;`);
  insertContact(db, { id: "zz-alias", name: "Alias", role: "Borrower", email: "ALIAS@example.test", phone: "+1 (248) 555-0101" });
  insertContact(db, { id: "zz-second-hop", name: "Second hop", role: "Borrower", email: "alias@example.test", phone: "2485550102" });
  db.exec("INSERT INTO outreach_opt_outs VALUES ('fixture', 'phone:2485550101', NULL, '2026-11-07T12:00:00.000Z');");
  initializeStore(db, false);
  const candidates = [{ email: "alias@example.test" }, { phone: "2485550102" }];
  assert.deepEqual([...blockedOutreachKeys(db, candidates)], ["email:alias@example.test"]);
  assert.ok(db.prepare("SELECT 1 FROM contact_outreach_pending WHERE contactId = 'zz-alias'").get());
  initializeStore(db, false);
  assert.deepEqual([...blockedOutreachKeys(db, candidates)], ["email:alias@example.test"]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM contact_outreach_pending").get().count, 0);
  assert.equal(outreachSuppressionKeys(db).has("phone:2485550102"), false);
  db.exec("UPDATE contacts SET email = 'updated@example.test' WHERE id = 'zz-alias';");
  assert.deepEqual([...blockedOutreachKeys(db, [...candidates, { email: "updated@example.test" }])], ["email:updated@example.test"]);
  db.exec("UPDATE contacts SET role = 'Realtor' WHERE id = 'zz-alias';");
  assert.equal(blockedOutreachKeys(db, [{ email: "updated@example.test" }]).size, 0);
  db.exec("UPDATE contacts SET role = 'Borrower' WHERE id = 'zz-alias';");
  assert.ok(blockedOutreachKeys(db, [{ email: "updated@example.test" }]).size);
  db.exec("DELETE FROM contacts WHERE id = 'zz-alias';");
  assert.equal(blockedOutreachKeys(db, [{ email: "updated@example.test" }]).size, 0);
});

test("processing pages reveal conditions and closing work only on authorized assigned files", (t) => {
  const { db, loan, officer, other } = fixture(t);
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const now = "2026-11-08T12:00:00.000Z";
  const add = db.prepare("INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision) VALUES (?, ?, ?, ?, '', ?, 1)");
  for (let n = 0; n < 21; n++) {
    const id = `owned-${String(n).padStart(2, "0")}`;
    loan(id);
    add.run(id, processor.email, processor.name, n === 0 ? "Ready for processing" : "In processing", now);
  }
  loan("another-processor");
  add.run("another-processor", other.email, other.name, "In processing", now);
  loan("finished");
  add.run("finished", processor.email, processor.name, "Complete", now);
  const condition = (id, category, satisfiedAt = null) => ({ id, category, description: "Fictional request", satisfiedAt });
  insertSubmission(db, { id: "mock-condition-file", loanId: "owned-00", lender: "UWM", externalId: "DEMO-PROCESSOR", status: "Conditions",
    syncedAt: now, conditions: [condition("income", "Income"), condition("bank", "Bank statement"), condition("done", "Cleared", now)] });
  db.prepare(`INSERT INTO document_requests (id, loanId, kind, status, instructions, requestedAt, submissionId, conditionId)
    VALUES ('requested-bank', 'owned-00', 'Bank statement', 'Received', 'Fictional evidence', ?, 'mock-condition-file', 'bank')`).run(now);
  db.exec(`INSERT INTO closing_plans VALUES ('owned-00', '2026-11-12');
    INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES ('closing-item', 'owned-00', 'Confirm closing', 'Alex', '2026-11-10');`);
  const read = (staff = processor, input = { readyOnly: false }, tenant = officer.brokerage.id) => readProcessorQueue(db, input, staff, tenant);
  const page = read();
  assert.equal(page.files.length, 20);
  assert.equal(page.files[0].condition.count, 2);
  assert.equal(page.files[0].condition.title, "Bank statement");
  assert.equal(page.files[0].condition.action, "Review received document");
  assert.match(page.files[0].condition.target, /bank$/);
  assert.deepEqual(page.files[0].closing, { count: 1, dueDate: "2026-11-10" });
  assert.deepEqual(read(processor, { readyOnly: false, after: page.next }).files.map(({ id }) => id), ["owned-20"]);
  assert.deepEqual(read(processor, { readyOnly: true }).files.map(({ id }) => id), ["owned-00"]);
  assert.ok(read(admin).files.some(({ id }) => id === "another-processor"));
  assert.ok(read(officer).error);
  assert.ok(read(processor, { readyOnly: false }, crypto.randomUUID()).error);
  const submit = db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt)
    VALUES (?, ?, ?, ?, ?, ?)`);
  for (let n = 0; n < 21; n++) {
    const id = `blocked-${String(n).padStart(2, "0")}`;
    loan(id);
    add.run(id, processor.email, processor.name, "Ready for processing", now);
    submit.run(id, id, now, JSON.stringify(blankApplication()), now, now);
  }
  assert.equal(read().files[0].id, "blocked-00");
  const actionable = read(processor, { readyOnly: true });
  assert.deepEqual(actionable.files.map(({ id }) => id), ["owned-00"]);
  assert.equal(actionable.next, null);
  insertSubmission(db, { id: "unrelated-file", loanId: "another-processor", lender: "UWM", externalId: "DEMO-UNRELATED",
    status: "Conditions", syncedAt: now, conditions: [] });
  db.exec("UPDATE submissions SET conditions = 'unreadable' WHERE id = 'unrelated-file';");
  const editable = (staff = processor, tenant = officer.brokerage.id) => readEditableLoan(db, "owned-00", staff, tenant);
  const file = editable();
  assert.equal(file.loans[0].id, "owned-00");
  assert.deepEqual(file.contacts.map(({ id }) => id), ["owned-00-contact"]);
  assert.equal(file.submissions[0].conditions.length, 3);
  assert.equal(file.documentRequests[0].id, "requested-bank");
  assert.equal(file.closingItems[0].id, "closing-item");
  assert.equal(file.callReportFiles, null);
  assert.equal(editable(admin).callReportFiles[0].loanId, "owned-00");
  assert.ok(editable(processor, crypto.randomUUID()).error);
  assert.ok(editable(other).error);
  db.prepare("UPDATE loan_processing SET processorEmail = ? WHERE loanId = 'owned-00'").run(other.email);
  assert.deepEqual(read(processor, { readyOnly: true }).files, []);
  assert.deepEqual(read({ ...other, brokerage: processor.brokerage }, { readyOnly: true }).files.map(({ id }) => id), ["owned-00"]);
  assert.ok(editable().error);
  assert.equal(editable({ ...other, brokerage: processor.brokerage }).loans[0].id, "owned-00");
});

test("loan handoff checks return only the current authorized file after a borrower change", (t) => {
  const { db, loan, officer, other } = fixture(t);
  const tenant = officer.brokerage.id;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const token = "a".repeat(64);
  const draft = { ...sampleApplication({ ...blankApplication(), borrowerName: "Riley Fictional", email: "riley@example.test", phone: "2485550196" }), confirmedDemo: true };
  loan("handoff-file");
  loan("separate-file", other);
  db.prepare("INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run("handoff-file", token, expiresAt, JSON.stringify(draft), now);
  const check = (version, actor = officer, brokerage = tenant) => readLoanHandoff(db, "handoff-file", version, actor, brokerage);
  const initial = readEditableLoan(db, "handoff-file", officer, tenant);
  assert.match(initial.handoffVersion, /^[a-f0-9]{64}$/);
  assert.deepEqual(check(initial.handoffVersion), { unchanged: true });
  assert.ok(check(initial.handoffVersion, other).error);
  assert.ok(check(initial.handoffVersion, officer, crypto.randomUUID()).error);
  assert.ok(check("not-a-version").error);

  const submit = borrowerCommandResult(db, { type: "submit", token, step: applicationSteps.length - 1, revision: 0, draft });
  assert.ok(submit.application?.submittedAt, submit.error);
  const submitted = check(initial.handoffVersion);
  assert.equal(submitted.applications[0].submittedAt, submit.application.submittedAt);
  assert.deepEqual(submitted.loans.map(({ id }) => id), ["handoff-file"]);
  assert.deepEqual(check(submitted.handoffVersion), { unchanged: true });

  const requestId = crypto.randomUUID();
  const insertRequest = db.prepare("INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt) VALUES (?, ?, 'Pay stub', '', ?)");
  insertRequest.run(crypto.randomUUID(), "separate-file", now);
  assert.deepEqual(check(submitted.handoffVersion), { unchanged: true });
  insertRequest.run(requestId, "handoff-file", now);
  const requested = check(submitted.handoffVersion);
  assert.equal(requested.documentRequests[0].status, "Requested");
  const attached = borrowerCommandResult(db, { type: "attachSample", token, requestId, revision: 0, statusOnly: true });
  assert.equal(attached.statusView?.loanStatus.documents[0].status, "Received");
  const received = check(requested.handoffVersion);
  assert.equal(received.documentRequests[0].status, "Received");
  assert.deepEqual(check(received.handoffVersion), { unchanged: true });
});

test("incoming borrower work preserves current ownership, exact revisions, and paging", (t) => {
  const { db, loan, officer, other } = fixture(t);
  const { id: tenant } = officer.brokerage;
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const processor = { ...other, brokerage: { ...officer.brokerage, role: "Processor" } };
  const backup = { ...processor, email: "backup@example.test" };
  const at = "2026-11-09T15:00:00.000Z";
  const draft = JSON.stringify(blankApplication());
  loan("submitted");
  loan("documents");
  loan("private", other);
  loan("held");
  db.prepare("UPDATE loans SET disposition = 'On hold' WHERE id = 'held'").run();
  const application = db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt, revision)
    VALUES (?, ?, '2026-11-16T15:00:00.000Z', ?, ?, ?, 2)`);
  application.run("submitted", "submitted-token", draft, at, at);
  application.run("private", "private-token", draft, at, at);
  db.prepare("INSERT INTO application_versions (loanId, revision, draft, submittedAt) VALUES ('submitted', 1, ?, ?)").run(draft, at);
  const assign = db.prepare(`INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision)
    VALUES (?, ?, ?, 'In processing', '', ?, 1)`);
  assign.run("documents", processor.email, processor.name, at);
  assign.run("private", backup.email, backup.name, at);
  assign.run("held", processor.email, processor.name, at);
  const document = db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, submittedAt, status, revision)
    VALUES (?, ?, 'Pay stub', '', ?, ?, 'Received', 3)`);
  document.run("exact-document", "documents", at, at);
  document.run("other-document", "private", at, at);
  document.run("held-document", "held", at, at);
  for (let index = 0; index < 8; index++) {
    const id = `arrival-${index}`;
    loan(id);
    document.run(id, id, at, at);
  }
  const today = (after) => readIncomingLoanWorkPage(db, { view: "today", after }, officer, tenant);
  const first = today();
  assert.equal(first.items.length, 8);
  const arrivals = [...first.items, ...today(first.next).items];
  assert.equal(new Set(arrivals.map(({ id }) => id)).size, 10);
  assert.deepEqual(arrivals.find(({ kind }) => kind === "application"), { kind: "application", id: "submitted", loanId: "submitted",
    name: "submitted", receivedAt: at, revision: 2, title: "Corrected 1003", assignee: null, linkedCondition: false, note: null });
  assert.ok(arrivals.some(({ id, revision }) => id === "exact-document" && revision === 3));
  assert.ok(!arrivals.some(({ loanId }) => loanId === "private" || loanId === "held"));
  const processing = (actor, brokerageId = tenant) => readIncomingLoanWorkPage(db, { view: "processing" }, actor, brokerageId);
  assert.deepEqual(processing(processor).items.map(({ id }) => id), ["exact-document"]);
  assert.deepEqual(processing(backup).items.map(({ id }) => id), ["other-document"]);
  assert.deepEqual(processing(admin).items.map(({ id }) => id).sort(), ["exact-document", "other-document"]);
  assert.ok(processing(officer).error);
  assert.ok(processing(processor, crypto.randomUUID()).error);
  assert.ok(readIncomingLoanWorkPage(db, { view: "today" }, processor, tenant).error);
  const later = "2026-11-10T15:00:00.000Z";
  for (let index = 0; index < 40; index++) {
    const id = `other-arrival-${index}`;
    loan(id, other);
    assign.run(id, backup.email, backup.name, later);
    document.run(id, id, later, later);
  }
  assert.deepEqual(today(), first);
  assert.deepEqual([...today().items, ...today(first.next).items], arrivals);
  assert.deepEqual(processing(processor).items.map(({ id }) => id), ["exact-document"]);
  db.prepare("UPDATE document_requests SET status = 'Accepted' WHERE id = 'exact-document'").run();
  assert.deepEqual(processing(processor).items, []);
  db.prepare("UPDATE applications SET reviewedAt = ? WHERE loanId = 'submitted'").run(at);
  const remaining = today();
  assert.equal(remaining.next, null);
  assert.equal(remaining.items.length, 8);
  assert.ok(remaining.items.every(({ kind }) => kind === "document"));

  const changeHandoff = db.prepare("UPDATE loan_processing SET status = ?, note = ?, revision = revision + 1 WHERE loanId = 'documents'");
  changeHandoff.run("Ready for processing", "Staff-only send note");
  const [ready] = processing(processor).items;
  assert.equal(ready.kind, "handoff");
  assert.equal(ready.loanId, "documents");
  assert.equal(ready.revision, 2);
  assert.equal(ready.note, "Staff-only send note");
  assert.ok(!processing(backup).items.some(({ loanId }) => loanId === "documents"));
  assert.ok(!today().items.some(({ kind }) => kind === "handoff"));
  changeHandoff.run("Returned to LO", "Staff-only return note");
  const returned = today().items.find(({ kind }) => kind === "handoff");
  assert.equal(returned.loanId, "documents");
  assert.equal(returned.revision, 3);
  assert.equal(returned.note, "Staff-only return note");
  assert.deepEqual(processing(processor).items, []);
  assert.ok(!readIncomingLoanWorkPage(db, { view: "today" }, other, tenant).items.some(({ kind }) => kind === "handoff"));
  changeHandoff.run("Complete", "");
  assert.ok(!today().items.some(({ kind }) => kind === "handoff"));
});

test("closing workload reconciles windows and processor scope at Eastern midnight", (t) => {
  const at = "2026-11-08T04:59:00.000Z";
  const { db, loan, officer, other } = fixture(t, at);
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  const second = { ...other, brokerage: processor.brokerage };
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const tenant = admin.brokerage.id;
  const add = (id, owner, target, status = "In processing") => {
    loan(id);
    if (owner) db.prepare("INSERT INTO loan_processing VALUES (?, ?, ?, ?, '', ?, 1)").run(id, owner.email, owner.name, status, at);
    if (target) db.prepare("INSERT INTO closing_plans VALUES (?, ?)").run(id, target);
  };
  add("past", processor, "2026-11-06");
  add("start", processor, "2026-11-07");
  add("end", processor, "2026-11-13");
  add("later", second, "2026-11-14");
  add("no-target", null, null);
  add("recorded", second, "2026-11-14");
  add("held", processor, "2026-11-08");
  add("finished", processor, "2026-11-08", "Complete");
  for (let n = 0; n < 20; n++) add(`tie-${String(n).padStart(2, "0")}`, second, "2026-11-13");
  db.exec(`UPDATE loans SET disposition = 'On hold' WHERE id = 'held';
    INSERT INTO past_client_profiles (loanId, closingDate) VALUES ('recorded', '2026-11-05');
    INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES
      ('next-a', 'start', 'Confirm signing', 'Processor', '2026-11-07'),
      ('next-b', 'start', 'Review the file', 'Processor', '2026-11-07');`);
  const read = (filters = {}, actor = admin, date = at, id = tenant) => readProcessorQueue(db,
    { readyOnly: false, workload: { processor: "", ...filters } }, actor, id, new Date(date));
  const all = read();
  assert.equal(all.workload.through, "2026-11-13");
  assert.deepEqual(all.workload.windows.map(({ files }) => files), [1, 22, 1, 1, 1]);
  assert.equal(all.workload.processors.find(({ email }) => email === processor.email).files, 3);
  assert.deepEqual(all.files.slice(0, 3).map(({ id }) => id), ["recorded", "past", "start"]);
  assert.deepEqual(all.files[2].closing, { count: 2, dueDate: "2026-11-07", target: "closing-checklist-next-a" });
  const upcoming = read({ window: "Next 7 days" });
  const next = read({ window: "Next 7 days", after: upcoming.workload.next });
  assert.equal(new Set([...upcoming.files, ...next.files].map(({ id }) => id)).size, 22);
  assert.equal(next.workload.next, null);
  assert.equal(read({ processor: "unassigned", window: "No target" }).files[0].assignmentRevision, 0);
  assert.deepEqual(read({ processor: second.email, window: "Closing recorded" }).files.map(({ id }) => id), ["recorded"]);
  assert.deepEqual(read({ window: "Past target" }, processor, "2026-11-08T05:00:00.000Z").files.map(({ id }) => id), ["past", "start"]);
  assert.deepEqual(read({}, processor).workload.processors, []);
  assert.deepEqual(read({}, processor).files.map(({ id }) => id), ["past", "start", "end"]);
  assert.ok(read({ processor: second.email }, processor).error);
  assert.ok(read({}, officer).error);
  assert.ok(read({}, admin, at, "other-brokerage").error);
  db.prepare("UPDATE loan_processing SET processorEmail = ? WHERE loanId = 'start'").run(second.email);
  assert.deepEqual(read({}, processor).files.map(({ id }) => id), ["past", "end"]);
  assert.ok(readEditableLoan(db, "start", processor, tenant).error);
});

test("processing views persist only permitted filters for the current staff member and role", (t) => {
  const at = "2026-11-08T14:00:00.000Z";
  const { db, loan, officer, other } = fixture(t, at);
  const now = new Date(at);
  const tenant = officer.brokerage.id;
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  const backup = { ...other, brokerage: processor.brokerage };
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const otherBrokerage = fixture(t, at);
  const otherAdmin = { ...admin, brokerage: { ...otherBrokerage.officer.brokerage, role: "Admin" } };
  db.exec("DROP TABLE processing_dashboard_views");
  initializeStore(db, false);
  for (const [id, owner] of [["owned-processing-file", processor], ["backup-processing-file", backup]]) {
    loan(id);
    db.prepare("INSERT INTO loan_processing VALUES (?, ?, ?, 'In processing', '', ?, 1)").run(id, owner.email, owner.name, at);
    db.prepare("INSERT INTO closing_plans VALUES (?, '2026-11-09')").run(id);
  }
  const save = (input, actor = admin, id = tenant) => changeProcessingView(db, input, actor, id, now);
  const read = (actor = admin, filters = { readyOnly: false }, id = tenant) => readProcessorQueue(db, filters, actor, id, now);
  const id = crypto.randomUUID();
  const name = "Closing this week";
  const adminFilters = { readyOnly: false, workload: { processor: backup.email, window: "Next 7 days" } };
  const view = { type: "saveView", id, name, filters: { ...adminFilters,
    workload: { ...adminFilters.workload, after: { date: "2026-11-09", id: "backup-processing-file" } } } };
  assert.ok(save(view, processor).error);
  assert.ok(save({ ...view, filters: { readyOnly: false, exception: "Unassigned" } }, processor).error);
  assert.ok(save(view, officer).error);
  assert.ok(save(view, null).error);
  assert.ok(save(view, admin, otherAdmin.brokerage.id).error);
  assert.ok(save(view).message);
  assert.ok(save(view).message);
  assert.ok(save({ ...view, id: crypto.randomUUID(), name: name.toUpperCase() }).error);
  assert.ok(save({ ...view, filters: { readyOnly: true } }).error);
  initializeStore(db, false);
  assert.deepEqual(read().views, [{ id, name, filters: adminFilters }]);
  assert.deepEqual(read(admin, read().views[0].filters).files.map((file) => file.id), ["backup-processing-file"]);
  assert.deepEqual(readProcessorQueue(otherBrokerage.db, { readyOnly: false }, otherAdmin, otherAdmin.brokerage.id, now).views, []);
  assert.deepEqual(read(processor).views, []);
  assert.deepEqual(read(backup).views, []);

  const personalFilters = { readyOnly: false, workload: { processor: "", window: "Next 7 days" } };
  assert.ok(save({ ...view, filters: personalFilters }, processor).message);
  assert.deepEqual(read(processor).views, [{ id, name, filters: personalFilters }]);
  assert.deepEqual(read(processor, read(processor).views[0].filters).files.map((file) => file.id), ["owned-processing-file"]);
  const remove = { type: "removeView", id };
  assert.ok(save(remove, backup).message);
  assert.equal(read(processor).views.length, 1);
  assert.ok(save(remove, processor).message);
  assert.ok(save(remove, processor).message);
  assert.ok(save({ ...view, filters: personalFilters }, processor).error);
  assert.deepEqual(read(processor).views, []);
  assert.equal(read().views.length, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Saved processing view'").get().count, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Removed processing view'").get().count, 1);
});

test("processing replies follow the assigned processor and give admins a way to recover unassigned threads", (t) => {
  const at = "2026-11-08T14:00:00.000Z";
  const { db, loan, officer, other, read } = fixture(t, at);
  const now = new Date(at);
  const id = officer.brokerage.id;
  const actor = (role, name) => ({ name, email: `${name}@example.test`, brokerage: { ...officer.brokerage, role } });
  const admin = actor("Admin", "Manager");
  const processor = actor("Processor", "Processor");
  const replacement = actor("Processor", "Backup");
  const assigned = (loanId, staff, revision = 0) => assignProcessor(db, admin,
    { loanId, revision, member: staff && { ...staff, role: "Processor", status: "Active" } });
  const write = (input, staff = admin) => {
    const result = changeConversation(db, input, staff, id, now);
    assert.ok(result.id, result.error);
    return result.id;
  };
  const action = (threadId, revision, fields, staff) => write({ id: threadId, revision, eventId: crypto.randomUUID(), ...fields }, staff);
  function thread(loanId, owner = processor, ownedByProcessor = true) {
    loan(loanId);
    assert.ok(assigned(loanId, owner).message);
    const threadId = write({ type: "start", loanId, contactId: `${loanId}-contact`, audience: "Borrower" });
    if (ownedByProcessor) action(threadId, 1, { type: "assign", ownerRole: "Processor" });
    action(threadId, ownedByProcessor ? 2 : 1, { type: "sampleReply" });
    return threadId;
  }
  const own = Array.from({ length: 6 }, (_, index) => thread(`processor-${index}`));
  const elsewhere = thread("backup-file", replacement);
  const officerReply = thread("officer-file", processor, false);
  const standalone = write({ type: "startContact", contactId: "officer-file-contact" });
  action(standalone, 1, { type: "sampleReply" });
  action(own[0], 3, { type: "followUp", dueOn: "2026-11-09" }, processor);
  action(own[0], 4, { type: "read" }, processor);

  const page = (staff, query = { readyOnly: false }, tenant = id) => readProcessorQueue(db, query, staff, tenant, now);
  const first = page(processor);
  const second = page(processor, { readyOnly: false, replyAfter: first.replies.next });
  assert.equal(first.replies.items.length, 5);
  assert.equal(second.replies.items.length, 1);
  const ownResults = [...first.replies.items, ...second.replies.items];
  assert.deepEqual(ownResults.map(({ id }) => id).sort(), [...own].sort());
  assert.partialDeepStrictEqual(ownResults.find(({ id }) => id === own[0]), { unread: false, dueOn: "2026-11-09", owner: processor.name });
  assert.equal(page(replacement).replies.items[0].id, elsewhere);
  assert.ok(page(other).error);
  assert.ok(page(processor, { readyOnly: false }, crypto.randomUUID()).error);
  assert.equal(page(processor, { readyOnly: true }).replies, undefined);
  assert.ok(page(processor, { readyOnly: true, replyAfter: first.replies.next }).error);
  const team = page(admin);
  const teamRest = page(admin, { readyOnly: false, replyAfter: team.replies.next });
  assert.deepEqual([...team.replies.items, ...teamRest.replies.items].map(({ id }) => id).sort(), [...own, elsewhere].sort());
  assert.deepEqual(read().replies.items.map(({ id }) => id), [officerReply]);

  assert.ok(assigned("processor-0", replacement, 1).message);
  assert.ok(page(processor).replies.items.every(({ id }) => id !== own[0]));
  const open = (staff) => readConversations(db, { type: "thread", id: own[0] }, staff, id, now);
  assert.ok(open(processor).error);
  assert.equal(open(replacement).thread.owner, replacement.name);
  assert.partialDeepStrictEqual(page(replacement).replies.items.find(({ id }) => id === own[0]), { dueOn: "2026-11-09", unread: false });
  assert.ok(assigned("processor-0", null, 2).message);
  assert.ok(open(replacement).error);
  const unassigned = page(admin);
  const allAdmin = [...unassigned.replies.items, ...page(admin, { readyOnly: false, replyAfter: unassigned.replies.next }).replies.items];
  assert.equal(allAdmin.find(({ id }) => id === own[0]).owner, "Unassigned processor");
  action(own[0], open(admin).thread.revision, { type: "assign", ownerRole: "Loan officer" });
  assert.ok(read().replies.items.some(({ id }) => id === own[0]));
});

test("manager handoff exceptions apply the current deadline and exclude paused, funded and review-blocked files", (t) => {
  const { db, loan, officer, other } = fixture(t);
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const processor = { ...other, brokerage: { ...officer.brokerage, role: "Processor" } };
  const now = new Date("2026-11-08T12:00:00.000Z");
  const old = "2026-11-08T06:00:00.000Z";
  const boundary = "2026-11-08T08:00:00.000Z";
  const reviewed = db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt, reviewedAt, correctionNote)
    VALUES (?, ?, ?, '{}', ?, ?, ?, ?)`);
  const assign = db.prepare("INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision) VALUES (?, ?, ?, ?, '', ?, 1)");
  for (const id of ["needs-processor", "reviewed-early", "bare-lead", "funded", "held", "review-blocked", "waiting", "too-new", "needs-send", "returned", "accepted"]) loan(id);
  db.exec(`UPDATE loans SET stage = 'Lead' WHERE id IN ('reviewed-early','bare-lead');
    UPDATE loans SET stage = 'Funded' WHERE id = 'funded';
    UPDATE loans SET disposition = 'On hold' WHERE id = 'held';`);
  for (const id of ["reviewed-early", "needs-send", "returned"]) reviewed.run(id, id, old, old, old, old, "");
  reviewed.run("review-blocked", "review-blocked", old, old, old, null, "New correction");
  for (const [id, status, since] of [["waiting", "Ready for processing", boundary], ["too-new", "Ready for processing", "2026-11-08T08:00:01.000Z"],
    ["needs-send", "Assigned", now.toISOString()], ["returned", "Returned to LO", old], ["accepted", "In processing", old],
    ["review-blocked", "Ready for processing", old], ["funded", "Ready for processing", old], ["held", "Ready for processing", old]]) {
    assign.run(id, processor.email, processor.name, status, since);
  }
  writePlaybook(db, { ...defaultPlaybook, handoffHours: 4 });
  const read = (exception, staff = admin, brokerage = admin.brokerage.id) =>
    readProcessorQueue(db, { readyOnly: false, exception }, staff, brokerage, now);
  assert.deepEqual(read("Unassigned").files.map(({ id }) => id), ["reviewed-early", "needs-processor"]);
  const stalled = read("Stalled handoffs");
  assert.equal(stalled.handoffHours, 4);
  assert.deepEqual(stalled.files.map(({ id }) => id), ["needs-send", "returned", "waiting"]);
  assert.equal(stalled.files.at(-1).handoffDueAt, now.toISOString());
  assert.ok(read("Unassigned", processor).error);
  assert.ok(read("Stalled handoffs", admin, crypto.randomUUID()).error);
});

test("direct processing assignment uses the unassigned queue revision and preserves owner access", (t) => {
  const { db, loan, officer, other } = fixture(t);
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const processor = { ...other, role: "Processor", status: "Active" };
  const replacement = { ...processor, email: "replacement@example.test", name: "Replacement" };
  const processorActor = { ...other, brokerage: { ...officer.brokerage, role: "Processor" } };
  const pending = "waiting-for-processor";
  const paused = "paused-after-read";
  const reopened = "application-corrected-after-read";
  for (const id of [pending, paused, reopened]) loan(id);
  const read = () => readProcessorQueue(db, { readyOnly: false, exception: "Unassigned" }, admin, admin.brokerage.id);
  const revision = (id) => read().files.find((file) => file.id === id).assignmentRevision;
  const submit = (loanId, revision, member = processor, actor = admin) =>
    assignProcessor(db, actor, { loanId, revision, member, requireUnassigned: true });
  const observed = revision(pending);
  const observedPaused = revision(paused);
  const observedReopened = revision(reopened);
  assert.equal(observed, 0);
  assert.ok(submit(pending, observed, processor, officer).error);
  assert.ok(submit(pending, observed, { ...processor, status: "Revoked" }).error);
  assert.ok(submit(pending, observed, null).error);
  const beforeAssignment = readEditableLoan(db, pending, officer, officer.brokerage.id);
  assert.equal(beforeAssignment.applications.length, 0);
  const first = submit(pending, observed);
  assert.equal(first.processing.status, "Assigned");
  assert.equal(first.processing.revision, 1);
  assert.equal(read().files.some((file) => file.id === pending), false);
  assert.ok(readEditableLoan(db, pending, officer, officer.brokerage.id).loans.length);
  assert.ok(readEditableLoan(db, pending, processorActor, officer.brokerage.id).loans.length);
  const assignmentUpdate = readLoanHandoff(db, pending, beforeAssignment.handoffVersion, officer, officer.brokerage.id);
  assert.equal(assignmentUpdate.loanProcessing[0].processorEmail, processor.email);
  assert.match(submit(pending, observed, replacement).error, /changed or left/);
  assert.deepEqual(submit(pending, observed).processing, first.processing);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Assigned shared processor'").get().count, 1);

  assert.ok(assignProcessor(db, admin, { loanId: pending, revision: 1, member: null }).message);
  assert.equal(revision(pending), 2);
  assert.match(submit(pending, observed, replacement).error, /changed or left/);
  assert.equal(submit(pending, revision(pending), replacement).processing.processorEmail, replacement.email);
  db.prepare("UPDATE loans SET disposition = 'On hold' WHERE id = ?").run(paused);
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt, correctionNote)
    VALUES (?, 'correction', '2099-01-01', '{}', '2026-11-08', '2026-11-08', 'Review the corrected 1003')`).run(reopened);
  assert.match(submit(paused, observedPaused).error, /changed or left/);
  assert.match(submit(reopened, observedReopened).error, /changed or left/);
});

test("condition aging pages by recorded opening, keeps age on sync, and starts over after reopening", async (t) => {
  const { db, loan, officer, other } = fixture(t);
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const processor = { ...other, brokerage: { ...officer.brokerage, role: "Processor" } };
  const first = "2026-10-28T12:00:00.000Z";
  const later = "2026-11-08T10:00:00.000Z";
  const now = new Date("2026-11-08T12:00:00.000Z");
  const condition = (id, category = id) => ({ id, category, description: "Fictional condition", group: null, uploaded: false, satisfiedAt: null });
  for (const id of ["aged", "undated", "manual", "held"]) loan(id);
  const known = Array.from({ length: 21 }, (_, index) => condition(`condition-${String(index).padStart(2, "0")}`));
  const mock = { id: "uwm-age", loanId: "aged", lender: "UWM", externalId: "AGE-TEST", status: "Open", syncedAt: first, conditions: known };
  insertSubmission(db, mock);
  recordUwmAlerts(db, mock, null, first);
  insertSubmission(db, { ...mock, id: "uwm-undated", loanId: "undated", externalId: "AGE-UNKNOWN", conditions: [condition("unknown")] });
  insertSubmission(db, { ...mock, id: "uwm-held", loanId: "held", externalId: "AGE-HELD", conditions: [condition("held")] });
  db.exec(`UPDATE loans SET disposition = 'On hold' WHERE id = 'held';
    DROP TRIGGER processing_conditions_insert; DROP TRIGGER processing_conditions_update;
    DROP TABLE processing_open_conditions; DELETE FROM settings WHERE key = 'processingConditionsV1';`);
  initializeStore(db, false);
  initializeStore(db, false);
  const read = (after, staff = admin) => readProcessorQueue(db, { readyOnly: false, exception: "Aging conditions", after }, staff, admin.brokerage.id, now);
  const page = read();
  assert.equal(page.files.length, 20);
  assert.equal(page.files[0].condition.openedAt, first);
  assert.match(page.files[0].condition.target, /condition-00$/);
  assert.match(read(page.next).files[0].condition.target, /condition-20$/);
  assert.equal(read(page.next).files.length, 1);
  assert.ok(read(undefined, processor).error);
  db.prepare("UPDATE submissions SET syncedAt = ? WHERE id IN ('uwm-age', 'uwm-undated')").run(later);
  assert.equal(read().files[0].condition.openedAt, first);
  assert.equal(db.prepare("SELECT openedAt FROM processing_open_conditions WHERE submissionId = 'uwm-undated'").get().openedAt, null);
  const saveConditions = db.prepare("UPDATE submissions SET conditions = ?, syncedAt = ? WHERE id = 'uwm-age'");
  saveConditions.run(JSON.stringify([{ ...known[0], satisfiedAt: later }, ...known.slice(1)]), later);
  assert.match(read().files[0].condition.target, /condition-01$/);
  saveConditions.run(JSON.stringify([{ ...known[0], mockReopenedAt: later }, ...known.slice(1)]), later);
  assert.equal(read(read().next).files[0].condition.openedAt, later);
  insertSubmission(db, { id: "manual-age", loanId: "manual", lender: "Fictional Lender", externalId: "MANUAL-AGE", status: "Open", syncedAt: null, conditions: [] });
  const conditionId = crypto.randomUUID();
  const manual = await executeCommand(db, { type: "saveManualCondition", loanId: "manual", submissionId: "manual-age",
    conditionId, revision: 0, category: "Income", description: "Fictional document", owner: "Processor" }, admin);
  assert.equal(manual.error, undefined);
  const firstPage = read();
  assert.ok([...firstPage.files, ...read(firstPage.next).files].some((file) => file.condition.target.endsWith(conditionId) && file.condition.openedAt));
});

test("manual return deadlines are fixed at recording and surface overdue work at the same instant", (t) => {
  const { db, loan, officer } = fixture(t);
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const returnedAt = "2026-11-08T14:00:00.000Z";
  const dueAt = "2026-11-08T20:00:00.000Z";
  const afterDue = "2026-11-08T20:00:00.001Z";
  const roster = [{ name: officer.name, email: officer.email, role: "LO", status: "Active" }];
  const manager = (filter, now) => nameFileExceptions(readFileExceptions(db, { filter }, admin, admin.brokerage.id, new Date(now)), roster).items;
  const personal = (now) => readIncomingLoanWorkPage(db, { view: "today" }, officer, officer.brokerage.id, undefined, new Date(now)).items;
  writePlaybook(db, { ...defaultPlaybook, manualReturnHours: 6 });
  for (const id of ["timed", "legacy"]) {
    loan(id);
    insertSubmission(db, { id: `${id}-file`, loanId: id, lender: "Fictional Wholesale", externalId: id,
      status: "Acknowledged", conditions: [], syncedAt: null });
    db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt, reviewedAt, revision)
      VALUES (?, ?, '2026-11-16T15:00:00.000Z', ?, ?, ?, ?, 1)`).run(id, id, JSON.stringify(blankApplication()), returnedAt, returnedAt, returnedAt);
    const acknowledgment = crypto.randomUUID();
    db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, 'Acknowledged', ?)").run(acknowledgment, id, returnedAt);
    db.prepare(`INSERT INTO application_handoff_events (activityId, loanId, applicationRevision, lenderRevision, outcome, submissionId)
      VALUES (?, ?, 1, 0, 'Acknowledged', ?)`).run(acknowledgment, id, `${id}-file`);
    const eventId = crypto.randomUUID();
    const result = recordManualLenderReturn(db, { loanId: id, revision: 1, note: "Fictional correction.",
      lenderReturn: { eventId, submissionId: `${id}-file`, lenderRevision: 0 } }, returnedAt);
    assert.deepEqual(result, { alreadyRecorded: false });
    if (id === "legacy") db.prepare("UPDATE application_handoff_events SET followUpDueAt = NULL WHERE activityId = ?").run(eventId);
  }
  writePlaybook(db, { ...defaultPlaybook, manualReturnHours: 1 });
  assert.deepEqual(manager("Overdue lender returns", dueAt), []);
  assert.deepEqual(manager("Overdue lender returns", afterDue).map(({ id, returnDueAt, overdue }) => ({ id, returnDueAt, overdue })),
    [{ id: "timed-file", returnDueAt: dueAt, overdue: true }]);
  assert.deepEqual(personal(dueAt).find(({ id }) => id === "timed-file").returnDeadline, { dueAt, overdue: false });
  assert.deepEqual(personal(afterDue).find(({ id }) => id === "timed-file").returnDeadline, { dueAt, overdue: true });
  assert.equal(manager("Manual lender returns", afterDue).find(({ id }) => id === "legacy-file").returnDueAt, "2026-11-09T14:00:00.000Z");
});

test("return follow-up is private to staff, idempotent, and scoped to the current return and owner", (t) => {
  const { db, loan, officer, other } = fixture(t);
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin" } };
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  const returnedAt = "2026-11-08T12:00:00.000Z";
  const now = new Date("2026-11-09T14:00:00.000Z");
  const token = "a".repeat(64);
  loan("returning");
  insertSubmission(db, { id: "return-file", loanId: "returning", lender: "Fictional Wholesale", externalId: "FICT-1",
    status: "Returned for changes", conditions: [], syncedAt: null });
  db.prepare("INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, correctionNote) VALUES (?, ?, ?, ?, ?, ?)")
    .run("returning", token, "2099-11-16T15:00:00.000Z", JSON.stringify(blankApplication()), returnedAt, "Borrower instructions");
  function appendReturn(applicationRevision, at) {
    const eventId = crypto.randomUUID();
    db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, 'returning', 'Returned', ?)").run(eventId, at);
    db.prepare(`INSERT INTO application_handoff_events (activityId, loanId, applicationRevision, lenderRevision, outcome, submissionId)
      VALUES (?, 'returning', ?, 0, 'Returned for changes', 'return-file')`).run(eventId, applicationRevision);
    return eventId;
  }
  const eventId = appendReturn(0, returnedAt);
  const input = { loanId: "returning", submissionId: "return-file", eventId, entryId: crypto.randomUUID(),
    party: "Borrower", channel: "Call", note: "Left a fictional voicemail." };
  const save = (data = input, actor = officer, brokerageId = officer.brokerage.id) => recordManualReturnFollowUp(db, data, actor, brokerageId, undefined, now);
  const manager = (filter) => nameFileExceptions(readFileExceptions(db, { filter }, admin, officer.brokerage.id, now), []).items;
  const today = (actor = officer) => readIncomingLoanWorkPage(db, { view: "today" }, actor, officer.brokerage.id, undefined, now).items;
  const unattended = "Overdue lender returns without follow-up";
  assert.deepEqual(manager(unattended).map(({ id }) => id), ["return-file"]);
  assert.ok(save(input, officer, "another-brokerage").error);
  for (const actor of [null, other, admin, processor]) assert.ok(save(input, actor).error);
  assert.match(save({ ...input, eventId: crypto.randomUUID() }).error, /return changed/);
  assert.match(save({ ...input, submissionId: "wrong" }).error, /return changed/);
  assert.match(save({ ...input, note: " " }).error, /short outcome/);
  const first = save();
  assert.equal(first.followUp.note, input.note);
  assert.deepEqual(save(), first);
  assert.match(save({ ...input, note: "Different note" }).error, /new follow-up entry/);
  assert.deepEqual(manager(unattended), []);
  assert.deepEqual(manager("Overdue lender returns").map(({ overdue, returnFollowUp }) => ({ overdue, returnFollowUp })),
    [{ overdue: true, returnFollowUp: first.followUp }]);
  assert.deepEqual(today()[0].returnFollowUp, first.followUp);
  db.prepare("UPDATE loans SET officer = ?, officerEmail = ? WHERE id = 'returning'").run(other.name, other.email);
  assert.deepEqual(today(), []);
  assert.deepEqual(today(other)[0].returnFollowUp, first.followUp);
  assert.ok(save(input).error);
  const second = save({ ...input, entryId: crypto.randomUUID(), party: "Lender", channel: "Portal", note: "Requested a response." }, other);
  assert.deepEqual(today(other)[0].returnFollowUp, second.followUp);
  assert.deepEqual(manager("All file exceptions")[0].returnFollowUp, second.followUp);
  const history = readRecordHistory(db, other, { record: "loan", id: "returning" });
  assert.equal(history.events.filter(({ text }) => text.startsWith("Lender return follow-up")).length, 2);
  const borrower = borrowerCommandResult(db, { type: "read", token });
  assert.equal(borrower.application.correctionNote, "Borrower instructions");
  assert.ok(!JSON.stringify(borrower).includes(input.note));
  const next = appendReturn(1, now.toISOString());
  assert.match(save({ ...input, entryId: crypto.randomUUID() }, other).error, /return changed/);
  assert.equal(today(other)[0].returnEventId, next);
  assert.equal(today(other)[0].returnFollowUp, undefined);
});

test("manager file exceptions track lender reopenings independently of alert review and reconcile linked evidence", async (t) => {
  const { db, loan, officer, other } = fixture(t);
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const processor = { ...other, brokerage: { ...officer.brokerage, role: "Processor" } };
  const roster = [officer, processor].map(({ email, name, brokerage }) => ({ email, name, role: brokerage.role, status: "Active" }));
  const start = "2026-11-06T15:00:00.000Z";
  const opened = "2026-11-07T15:00:00.000Z";
  const now = new Date("2026-11-08T15:00:00.000Z");
  const read = (filter = "All file exceptions", staff = admin, id = admin.brokerage.id) => {
    const page = readFileExceptions(db, { filter }, staff, id, now);
    return "error" in page ? page : nameFileExceptions(page, roster);
  };
  for (const id of ["mock-loan", "manual-loan", "held-loan", "funded-loan"]) loan(id);
  db.exec("UPDATE loans SET disposition = 'On hold' WHERE id = 'held-loan'; UPDATE loans SET stage = 'Funded' WHERE id = 'funded-loan';");
  db.prepare("INSERT INTO loan_processing VALUES ('mock-loan', ?, ?, 'In processing', '', ?, 1)").run(processor.email, processor.name, start);
  const base = { id: "income", category: "Income", description: "Fictional lender instructions", group: null, uploaded: false, satisfiedAt: start };
  const file = { id: "mock-file", loanId: "mock-loan", lender: "UWM", externalId: "MOCK-EXCEPTION", status: "Open", syncedAt: start, conditions: [base] };
  insertSubmission(db, file);
  const request = db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, status, dueOn, revision, submissionId, conditionId)
    VALUES (?, ?, 'Pay stub', '', ?, ?, '2026-11-07', 2, ?, ?)`);
  request.run("linked", "mock-loan", start, "Needs replacement", file.id, base.id);
  request.run("independent", "manual-loan", start, "Requested", null, null);
  request.run("held", "held-loan", start, "Requested", null, null);
  request.run("funded", "funded-loan", start, "Requested", null, null);
  assert.deepEqual(read().items.map(({ id }) => id), ["independent"]);

  const update = db.prepare("UPDATE submissions SET conditions = ?, syncedAt = ? WHERE id = ?");
  const reopened = { ...file, conditions: [{ ...base, satisfiedAt: null }] };
  update.run(JSON.stringify(reopened.conditions), opened, file.id);
  recordUwmAlerts(db, reopened, file, opened);
  db.prepare("UPDATE uwm_alerts SET reviewedAt = ? WHERE submissionId = ?").run(opened, file.id);
  assert.equal(read("Missing evidence").items.length, 2);
  const overview = read();
  assert.deepEqual(overview.items.map(({ id }) => id), ["independent", "income"]);
  assert.equal(overview.items[0].target, "document-independent");
  const condition = overview.items[1];
  assert.equal(condition.target, "lender-condition-mock-file:income");
  assert.equal(condition.reopenedAt, opened);
  assert.equal(condition.owner, processor.name);
  assert.equal(condition.ownerAvailable, true);
  assert.equal(condition.evidence, "Document revision 2");
  assert.equal(condition.action, "Follow up on borrower evidence");
  assert.doesNotMatch(JSON.stringify(overview), /@example\.test|Fictional lender instructions/);
  assert.ok(read(undefined, processor).error);
  assert.ok(read(undefined, admin, crypto.randomUUID()).error);
  db.exec("UPDATE document_requests SET status = 'Received' WHERE id IN ('independent', 'linked');");
  assert.equal(read().items[0].action, "Review received evidence");
  update.run(JSON.stringify(file.conditions), opened, file.id);
  assert.deepEqual(read().items, []);

  const manual = { ...file, id: "manual-file", loanId: "manual-loan", lender: "Fictional Lender", externalId: "MANUAL-EXCEPTION", syncedAt: null, conditions: [] };
  insertSubmission(db, manual);
  const manualId = crypto.randomUUID();
  const ids = { loanId: manual.loanId, submissionId: manual.id, conditionId: manualId };
  const run = async (data) => { const response = await executeCommand(db, { ...ids, ...data }, admin); assert.ok(response.state, response.error); };
  await run({ type: "saveManualCondition", revision: 0, category: "Assets", description: "Fictional evidence", owner: "Lender" });
  assert.deepEqual(read("Reopened conditions").items, []);
  await run({ type: "recordManualClearance", revision: 1, cleared: true, confirmation: "Fictional confirmation" });
  await run({ type: "recordManualClearance", revision: 2, cleared: false, confirmation: "Fictional reopen reason" });
  const [manualItem] = read("Reopened conditions").items;
  assert.equal(manualItem.nextParty, "Lender");
  assert.equal(manualItem.owner, officer.name);
  assert.equal(manualItem.target, `lender-condition-${manual.id}:${manualId}`);
  await run({ type: "recordManualClearance", revision: 3, cleared: true, confirmation: "Fictional re-clear" });
  assert.deepEqual(read("Reopened conditions").items, []);
});

test("manager evidence pagination keeps tied dates stable and omits closed pipeline files", (t) => {
  const { db, loan, officer } = fixture(t);
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const read = (after) => readFileExceptions(db, { filter: "All file exceptions", after }, admin, admin.brokerage.id);
  for (let i = 0; i < 25; i++) {
    const id = `loan-${String(i).padStart(2, "0")}`;
    loan(id);
    db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt) VALUES (?, ?, 'Photo ID', '', '2026-11-08T10:00:00.000Z')`).run(id, id);
  }
  db.exec("UPDATE loans SET stage = 'Closed' WHERE id = 'loan-24'");
  const first = read();
  const second = read(first.next);
  assert.deepEqual([first.rows.length, second.rows.length], [20, 4]);
  assert.equal(new Set([...first.rows, ...second.rows].map(({ id }) => id)).size, 24);
  assert.equal(second.next, null);
});

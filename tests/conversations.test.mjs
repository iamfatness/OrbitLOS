import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { changeConversation, readConversations } = await import("../src/lib/conversations.ts");
const { readOfficerQueue, readWorkspaceCalendar } = await import("../src/lib/officer-queue.ts");
const { realtorReferrals } = await import("../src/lib/realtor-portal.ts");
const { changeInboundReply, readInboundReplies } = await import("../src/lib/inbound-replies.ts");
const { blockedOutreachKeys } = await import("../src/lib/outreach-preferences.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { recordCampaignCall } = await import("../src/lib/call-campaigns.ts");
const { readEditableLead } = await import("../src/lib/editable-lead.ts");
const { readCampaignCallbackPerformance } = await import("../src/lib/campaign-callback-performance.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const brokerage = { id: crypto.randomUUID(), name: "Fictional", pilot: true };
  const actor = (name, role) => ({ name, email: `${name.toLowerCase()}@example.test`, brokerage: { ...brokerage, role } });
  const admin = actor("Admin", "Admin");
  const lo = actor("Officer", "LO");
  const processor = actor("Processor", "Processor");
  const replacement = actor("Replacement", "Processor");
  const other = actor("Other", "LO");
  const now = new Date("2026-11-08T17:00:00.000Z");
  const at = now.toISOString();
  const create = (id, owner = lo) => {
    insertContact(db, { id: `${id}-borrower`, name: `${id} borrower`, email: "", phone: "", role: "Borrower" });
    insertContact(db, { id: `${id}-realtor`, name: `${id} realtor`, email: "", phone: "", role: "Realtor" });
    insertLoan(db, { id, contactId: `${id}-borrower`, partnerId: `${id}-realtor`, officer: owner.name, officerEmail: owner.email,
      address: "", amount: 300000, purpose: "Purchase", stage: "Processing", stageSince: at });
    return { loanId: id, contactId: `${id}-borrower`, audience: "Borrower" };
  };
  const subject = create("sample");
  db.prepare(`INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision)
    VALUES ('sample', ?, ?, 'In processing', '', ?, 1)`).run(processor.email, processor.name, at);
  const write = (input, staff = lo, tenant = brokerage.id) => changeConversation(db, input, staff, tenant, now);
  const read = (input, staff = lo, tenant = brokerage.id) => readConversations(db, input, staff, tenant, now);
  const list = (filter, staff = lo, mine = false, after) => read({ type: "list", filter, mine, after }, staff);
  const lead = (name) => {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
      VALUES (?, ?, ?, ?, '', 'Purchase', ?, ?, ?, ?)`).run(id, id, name, `${id}@example.test`, lo.name, lo.email, at, at);
    return id;
  };
  return { db, create, subject, write, read, list, admin, lo, processor, replacement, other, brokerage, now, lead };
}

test("conversation ownership, unread state, follow-up and histories are loan scoped and retry safe", (t) => {
  const { db, subject, write, read, list, lo, admin, processor, replacement, other, brokerage, now } = fixture(t);
  assert.equal(read({ type: "loan", ...subject }).kind, "new");
  assert.ok(write({ type: "start", ...subject, contactId: "sample-realtor" }).error);
  assert.ok(write({ type: "start", ...subject }, other).error);
  assert.ok(write({ type: "start", ...subject }, lo, crypto.randomUUID()).error);
  const start = { type: "start", ...subject };
  const { id } = write(start);
  assert.equal(write(start).id, id);
  const thread = (staff = lo, after) => read({ type: "thread", id, after }, staff);
  const action = (type, extra = {}, actor = lo) => write({ type, id, revision: thread(actor).thread.revision, eventId: crypto.randomUUID(), ...extra }, actor);
  const outbound = { type: "message", id, eventId: crypto.randomUUID(), revision: 1, direction: "Outbound", channel: "Text", text: "Fictional update logged." };
  assert.equal(write(outbound).id, id);
  assert.equal(write(outbound).id, id);
  assert.ok(write({ ...outbound, text: "Different request." }).error);
  assert.equal(thread().events.length, 1);
  assert.equal(thread().thread.status, "Waiting on contact");
  assert.equal(thread(processor).thread.canManage, false);
  assert.ok(action("sampleReply", {}, processor).error);
  assert.ok(write({ type: "sampleReply", id, eventId: crypto.randomUUID(), revision: 1 }).error);
  assert.equal(action("sampleReply").id, id);
  assert.equal(thread().events.find(({ kind }) => kind === "Inbound").origin, "Simulated");
  assert.equal(list("Unread").rows.length, 1);
  assert.equal(action("note", { text: "Fictional staff-only note." }).id, id);
  assert.equal(action("read").id, id);
  assert.equal(list("Unread").rows.length, 0);
  assert.equal(list("Needs reply").rows.length, 1);
  assert.equal(action("followUp", { dueOn: "2026-11-08" }).id, id);
  assert.equal(list("Follow-up due").rows[0].id, id);
  const today = () => readOfficerQueue(db, { horizon: 1 }, lo, brokerage.id, now);
  assert.partialDeepStrictEqual(today().replies.items[0], { id, unread: false, dueOn: "2026-11-08" });
  assert.equal(today().items.some((item) => item.recordId === id), false);
  const handoff = { type: "assign", id, eventId: crypto.randomUUID(), revision: thread().thread.revision, ownerRole: "Processor" };
  assert.equal(write(handoff).id, id);
  assert.equal(write(handoff).id, id);
  assert.equal(thread().thread.canManage, false);
  assert.equal(list("Active", processor, true).rows[0].id, id);
  assert.equal(today().replies.items.length, 0);
  db.prepare("UPDATE loan_processing SET processorEmail = ?, processorName = ? WHERE loanId = 'sample'").run(replacement.email, replacement.name);
  assert.ok(thread(processor).error);
  assert.equal(list("Active", processor, true).rows.length, 0);
  assert.equal(thread(replacement).thread.owner, replacement.name);
  assert.equal(action("resolve", { closed: true }, replacement).id, id);
  assert.equal(list("Follow-up due", admin).rows.length, 0);
  assert.equal(list("Closed", admin).rows.length, 1);
  assert.equal(action("sampleReply", {}, replacement).id, id);
  assert.equal(list("Needs reply", replacement, true).rows[0].unread, true);
  const realtor = write({ type: "start", loanId: "sample", audience: "Realtor", contactId: "sample-realtor" }, admin);
  db.prepare("INSERT INTO realtor_portals (realtorId,token,expiresAt,officer) VALUES ('sample-realtor',?,'2026-12-01T00:00:00.000Z','Officer')").run("a".repeat(64));
  assert.equal(action("note", { text: "Fictional confidential routing." }, replacement).id, id);
  assert.equal(read({ type: "thread", id: realtor.id }).events.length, 0);
  assert.doesNotMatch(JSON.stringify(realtorReferrals(db, { token: "a".repeat(64) }, now.toISOString())), /confidential routing|staff-only note|conversation/);
  db.exec("UPDATE loans SET partnerId = NULL WHERE id = 'sample';");
  assert.ok(read({ type: "thread", id: realtor.id }, admin).error);
  assert.ok(thread(other).error);
});

test("conversation pages combine leads and loans without leaking unrelated work or duplicating tied rows", (t) => {
  const { create, lead, write, list, read, lo, other, admin } = fixture(t);
  for (let i = 0; i < 23; i++) write({ type: "start", ...create(`page-${i}`) });
  write({ type: "startLead", leadId: lead("Fictional lead") });
  write({ type: "start", ...create("restricted", other) }, other);
  const first = list("Active");
  const second = list("Active", lo, false, first.next);
  assert.equal(first.rows.length, 20);
  assert.equal(second.rows.length, 4);
  assert.equal(new Set([...first.rows, ...second.rows].map(({ id }) => id)).size, 24);
  assert.equal([...first.rows, ...second.rows].filter(({ leadId }) => leadId).length, 1);
  assert.equal(list("Active", admin).rows.length, 20);
  const id = first.rows[0].id;
  for (let i = 0; i < 23; i++) write({ type: "note", id, eventId: crypto.randomUUID(), revision: i + 1, text: `Fictional note ${i}` });
  const history = read({ type: "thread", id });
  const older = read({ type: "thread", id, after: history.next });
  assert.equal(history.events.length, 20);
  assert.equal(older.events.length, 3);
  assert.equal(new Set([...history.events, ...older.events].map(({ id }) => id)).size, 23);
});

test("Today pages owned replies independently from deadlines and keeps the calendar date", (t) => {
  const { db, subject, create, lead, write, read, lo, other, admin, processor, brokerage, now } = fixture(t);
  const reply = (start, actor = lo) => {
    const { id } = write(start, actor);
    assert.ok(id);
    assert.ok(write({ type: "sampleReply", id, revision: 1, eventId: crypto.randomUUID() }, actor).id);
    return id;
  };
  const loanThread = reply({ type: "start", ...subject });
  const contactThread = reply({ type: "startContact", contactId: subject.contactId });
  const restrictedThread = reply({ type: "start", ...create("unrelated", other) }, other);
  const leadId = lead("Fictional held lead");
  const leadThreads = [
    reply({ type: "startLead", leadId }),
    ...Array.from({ length: 4 }, (_, index) => reply({ type: "startLead", leadId: lead(`Fictional lead ${index}`) })),
  ];
  db.prepare("UPDATE referral_leads SET heldAt = ? WHERE id = ?").run(now.toISOString(), leadId);
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', ?, NULL, ?)").run(`email:${leadId}@example.test`, now.toISOString());
  const update = (id, revision, fields) => write({ id, revision, eventId: crypto.randomUUID(), ...fields });
  assert.ok(update(contactThread, 2, { type: "followUp", dueOn: "2026-11-10" }).id);

  const today = (staff = lo, query = { horizon: 1 }, localName) => readOfficerQueue(db, query, staff, brokerage.id, now, localName);
  const first = today();
  const second = today(lo, { horizon: 7, replyAfter: first.replies.next });
  assert.equal(first.replies.items.length, 5);
  assert.equal(second.replies.items.length, 2);
  assert.equal(second.replies.next, null);
  const all = [...first.replies.items, ...second.replies.items];
  assert.deepEqual(all.map(({ id }) => id).sort(), [loanThread, contactThread, ...leadThreads].sort());
  assert.ok(all.every(({ id }) => read({ type: "thread", id }).kind === "thread"));
  assert.partialDeepStrictEqual(all.find(({ id }) => id === leadThreads[0]), { held: true, outreachBlocked: true });
  assert.partialDeepStrictEqual(all.find(({ id }) => id === contactThread), { dueOn: "2026-11-10", unread: true });
  assert.ok(!second.items.some((item) => item.recordId === contactThread));
  assert.equal(today(other).replies.items[0].id, restrictedThread);
  assert.equal(today(admin).replies.items.length, 0);
  assert.ok(today(processor).error);
  assert.ok(today(lo, { horizon: 1, replyAfter: { at: now.toISOString(), id: "invalid" } }).error);

  const calendar = readWorkspaceCalendar(db, { week: "2026-11-08", scope: "Mine", group: "Conversations" }, lo, brokerage.id, now);
  assert.deepEqual(calendar.items.map(({ recordId, dueAt }) => [recordId, dueAt]), [[contactThread, "2026-11-10"]]);
  assert.ok(update(contactThread, 3, { type: "message", direction: "Outbound", channel: "Email", text: "Fictional answer." }).id);
  assert.ok(update(leadThreads[0], 2, { type: "resolve", closed: true }).id);
  assert.equal(today().replies.next, null);
  assert.ok(today().replies.items.every(({ id }) => id !== contactThread && id !== leadThreads[0]));
  db.prepare("UPDATE loans SET officerEmail = NULL WHERE id = ?").run(subject.loanId);
  assert.equal(today(admin, { horizon: 1 }, lo.name).replies.items[0].id, loanThread);
  assert.ok(today().replies.items.every(({ id }) => id !== loanThread));
});

test("lead conversations carry ownership, campaign call history, and deadlines through 1003 conversion", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-09T17:00:00.000Z") });
  const { db, lead, write, read, list, admin, lo, processor, other, brokerage, now } = fixture(t);
  const leadId = lead("Fictional campaign prospect");
  const campaignId = crypto.randomUUID();
  db.prepare("INSERT INTO call_campaigns (id, name, createdAt) VALUES (?, 'Fictional conversation campaign', ?)").run(campaignId, now.toISOString());
  db.prepare("INSERT INTO call_campaign_members (leadId, campaignId, joinedAt) VALUES (?, ?, ?)").run(leadId, campaignId, now.toISOString());
  const callbackAt = "2026-11-09T18:30:00.000Z";
  const call = db.transaction(() => recordCampaignCall(db, lo, { campaignId, leadId, revision: 0,
    outcome: "Requested callback", note: "Fictional purchase callback.", callbackAt }, now.toISOString()));
  assert.ok(call.message, call.error);
  assert.ok(write({ type: "startLead", leadId }, processor).error);
  assert.ok(write({ type: "startLead", leadId }, other).error);
  assert.ok(read({ type: "lead", leadId }, lo, crypto.randomUUID()).error);
  const { id } = write({ type: "startLead", leadId });
  assert.equal(write({ type: "startLead", leadId }).id, id);
  const thread = (actor = lo) => read({ type: "thread", id }, actor);
  assert.equal(thread().events[0].origin, "Lead log");
  assert.match(thread().events[0].text, /Fictional purchase callback/);
  const action = (type, actor, extra = {}) => ({ type, id, eventId: crypto.randomUUID(), revision: thread(actor).thread.revision, ...extra });
  const note = action("note", lo, { text: "Fictional internal context." });
  assert.ok(write(note).message);
  assert.ok(write(action("sampleReply", lo)).message);
  const followUp = action("followUp", lo, { dueOn: "2026-11-08" });
  assert.ok(write(followUp).message);
  const promised = thread().thread.campaignCallback;
  assert.equal(promised.dueAt, callbackAt);
  assert.equal(thread().thread.canOpenCampaignCallback, true);
  assert.equal(thread(admin).thread.canOpenCampaignCallback, false);
  const myReplies = read({ type: "myReplies" });
  const today = readOfficerQueue(db, { horizon: 1 }, lo, brokerage.id, now).replies;
  assert.deepEqual(myReplies.page, today);
  assert.deepEqual(myReplies.page.items.find(({ id: key }) => key === id).campaignCallback, promised);
  assert.ok(read({ type: "myReplies" }, processor).error);
  assert.equal(read({ type: "myReplies" }, other).page.items.length, 0);
  const callbackLink = { leadId, task: { kind: "campaign", id: promised.taskId, expectedCallbackAt: callbackAt } };
  assert.equal(readEditableLead(db, callbackLink, lo, brokerage.id).member.callbackDueAt, callbackAt);
  assert.ok(readEditableLead(db, { ...callbackLink, task: { ...callbackLink.task, expectedCallbackAt: now.toISOString() } }, lo, brokerage.id).error);
  assert.ok((await executeCommand(db, { type: "assignInboxLead", leadId, email: other.email, previousEmail: lo.email }, admin, undefined,
    [{ ...other, role: "LO", status: "Active" }])).state);
  assert.ok(thread().error);
  assert.equal(thread(other).thread.owner, other.name);
  assert.deepEqual(read({ type: "myReplies" }, other).page.items[0].campaignCallback, promised);
  assert.ok(list("Follow-up due", other, true).rows.some(({ id: key }) => key === id));
  const converted = await executeCommand(db, { type: "convertReferral", referralId: leadId, contactId: null }, other);
  assert.ok(converted.referralLoanId, converted.error);
  const after = thread(other);
  assert.equal(after.thread.loanId, converted.referralLoanId);
  assert.equal(after.thread.dueOn, followUp.dueOn);
  const carried = { loanId: converted.referralLoanId, taskId: promised.taskId, dueAt: callbackAt };
  assert.deepEqual(after.thread.campaignCallback, carried);
  const openCallback = (actor = other, request = callbackLink, workspace = brokerage.id) => readEditableLead(db, request, actor, workspace);
  const moved = openCallback();
  assert.equal(moved.loanWork.loanId, carried.loanId);
  assert.equal(moved.callbackTaskId, promised.taskId);
  assert.equal(moved.loanWork.tasks.find(({ id }) => id === promised.taskId).campaignCallback, "Pending");
  for (const actor of [lo, admin, processor]) assert.ok(openCallback(actor).error);
  assert.ok(openCallback(other, callbackLink, crypto.randomUUID()).error);
  assert.ok(openCallback(other, { ...callbackLink, leadId: crypto.randomUUID() }).error);
  assert.ok(openCallback(other, { ...callbackLink, task: { ...callbackLink.task, id: crypto.randomUUID() } }).error);
  assert.ok(openCallback(other, { leadId, task: { kind: "campaign", id: promised.taskId } }).error);
  db.prepare("INSERT INTO outreach_opt_outs (source, identityKey, recordedAt) VALUES ('test', ?, ?)").run(`lead:${leadId}`, callbackAt);
  assert.ok(openCallback().error);
  db.prepare("DELETE FROM outreach_opt_outs WHERE source = 'test' AND identityKey = ?").run(`lead:${leadId}`);
  assert.equal(after.thread.canOpenCampaignCallback, true);
  assert.deepEqual(read({ type: "myReplies" }, other).page.items[0].campaignCallback, carried);
  assert.equal(after.thread.unread, true);
  assert.equal(after.events.length, 4);
  assert.equal(read({ type: "lead", leadId }, other).thread.id, id);
  assert.ok(converted.state.tasks.some(({ id, loanId, dueAt, completedAt }) => id === promised.taskId && loanId === converted.referralLoanId && dueAt === callbackAt && !completedAt));
  assert.ok(write({ ...followUp, eventId: crypto.randomUUID() }, other).error);
  assert.equal(db.prepare("SELECT count(*) AS total FROM lead_conversations").get().total, 0);
  assert.equal(db.prepare("SELECT count(*) AS total FROM lead_conversation_events").get().total, 0);
  assert.ok(readOfficerQueue(db, { horizon: 1 }, other, brokerage.id, now).replies.items.some(({ id: key }) => key === id));
  const replay = await executeCommand(db, { type: "convertReferral", referralId: leadId, contactId: null }, other);
  assert.equal(replay.referralLoanId, converted.referralLoanId);
  assert.equal(replay.state.tasks.filter(({ id }) => id === promised.taskId).length, 1);
  const report = (at = now) => readCampaignCallbackPerformance(db, { campaignId }, admin, brokerage.id, at);
  assert.equal(report().items[0].status, "Upcoming");
  assert.equal(report().items[0].continuedOnLoan, true);
  assert.equal(report().items[0].closedAt, null);
  assert.equal(replay.state.tasks.find(({ id }) => id === promised.taskId).campaignCallback, "Pending");
  const completed = await executeCommand(db, { type: "completeTask", id: promised.taskId, completed: true }, other);
  assert.ok(completed.message, completed.error);
  assert.ok(openCallback().error);
  assert.equal(thread(other).thread.campaignCallback, undefined);
  assert.equal(read({ type: "myReplies" }, other).page.items[0].campaignCallback, undefined);
  assert.equal(report().items[0].status, "Closed without attempt");
  assert.ok((await executeCommand(db, { type: "completeTask", id: promised.taskId, completed: false }, other)).message);

  const input = { type: "recordCarriedCampaignCallback", ...carried, eventId: crypto.randomUUID(), outcome: "Connected", note: "Discussed the fictional purchase." };
  const log = (action = input, actor = other) => executeCommand(db, action, actor, undefined, [], { scopedLoanUpdates: true });
  assert.ok((await log(input, lo)).error);
  assert.ok((await log(input, processor)).error);
  assert.ok((await log({ ...input, dueAt: now.toISOString() })).error);
  db.prepare("UPDATE loans SET disposition = 'On hold' WHERE id = ?").run(carried.loanId);
  assert.ok(openCallback().error);
  assert.equal(report().items[0].status, "On hold");
  assert.match((await log()).error, /Reopen the loan/);
  db.prepare("UPDATE loans SET disposition = 'Active' WHERE id = ?").run(carried.loanId);
  const revision = replay.state.tasks.find(({ id }) => id === promised.taskId).campaignCallbackRevision;
  const revisedDueAt = "2026-11-09T18:00:00.000Z";
  const reschedule = { type: "rescheduleCarriedCampaignCallback", ...carried, revision, callbackAt: revisedDueAt,
    reason: "Borrower moved the fictional call earlier.", eventId: crypto.randomUUID() };
  assert.ok((await log(reschedule, lo)).error);
  assert.ok((await log(reschedule, processor)).error);
  assert.match((await log({ ...reschedule, callbackAt: now.toISOString() })).error, /future/);
  const rescheduled = await log(reschedule);
  assert.equal(rescheduled.loanWork?.tasks.find(({ id }) => id === promised.taskId)?.dueAt, revisedDueAt, rescheduled.error);
  assert.equal(report().items[0].dueAt, revisedDueAt);
  assert.equal(report().items[0].originalDueAt, callbackAt);
  assert.equal(thread(other).thread.campaignCallback.dueAt, revisedDueAt);
  assert.ok(openCallback().error);
  assert.equal(openCallback(other, { ...callbackLink, task: { ...callbackLink.task, expectedCallbackAt: revisedDueAt } }).loanWork.loanId, carried.loanId);
  assert.ok((await log(reschedule)).message);
  assert.ok((await log({ ...reschedule, reason: "Different reason" })).error);
  assert.ok((await log({ ...reschedule, eventId: crypto.randomUUID(), callbackAt: callbackAt })).error);
  assert.equal(db.prepare("SELECT count(*) AS total FROM activity WHERE id = ?").get(reschedule.eventId).total, 1);

  t.mock.timers.setTime(Date.parse(revisedDueAt) + 1);
  const lateMove = { ...reschedule, revision: revision + 1, dueAt: revisedDueAt, callbackAt,
    reason: "Borrower changed availability after the deadline.", eventId: crypto.randomUUID() };
  assert.ok((await log(lateMove)).message);
  assert.equal(report(new Date()).items[0].status, "Overdue");
  assert.equal(report(new Date()).items[0].dueAt, revisedDueAt);
  assert.equal(report(new Date()).items[0].scheduledAt, callbackAt);
  assert.equal(thread(other).thread.campaignCallback.dueAt, callbackAt);
  assert.ok((await log({ ...reschedule, eventId: crypto.randomUUID() })).error);
  const logged = await log();
  assert.ok(logged.loanWork, logged.error);
  assert.ok(openCallback().error);
  const loggedTask = logged.loanWork.tasks.find(({ id }) => id === promised.taskId);
  assert.equal(loggedTask.campaignCallback, "Recorded");
  assert.equal((await log()).loanWork.tasks.find(({ id }) => id === promised.taskId).completedAt, loggedTask.completedAt);
  assert.ok((await log({ ...input, outcome: "Left message" })).error);
  assert.ok((await log({ ...input, eventId: crypto.randomUUID() })).error);
  assert.ok((await executeCommand(db, { type: "completeTask", id: promised.taskId, completed: false }, other)).error);
  assert.equal(thread(other).thread.campaignCallback, undefined);
  const result = report(new Date(loggedTask.completedAt));
  assert.equal(result.items[0].status, "Late");
  assert.equal(result.counts.Late, 1);
  assert.equal(result.items[0].dueAt, revisedDueAt);
  assert.equal(result.items[0].scheduledAt, callbackAt);
  assert.equal(result.items[0].attempt.id, input.eventId);
  assert.equal(result.items[0].attempt.actor, other.name);
  assert.match(result.items[0].attempt.text, /Connected.*fictional purchase/);
  assert.equal(db.prepare("SELECT count(*) AS total FROM lead_events WHERE leadId = ? AND outcome = 'Connected'").get(leadId).total, 1);
  assert.equal(db.prepare("SELECT count(*) AS total FROM activity WHERE loanId = ? AND outcome = 'Connected'").get(carried.loanId).total, 1);
});

test("an older workspace upgrades without losing loan conversation entries", (t) => {
  const { db, subject, write, read, lead } = fixture(t);
  const { id } = write({ type: "start", ...subject });
  assert.ok(write({ type: "note", id, eventId: crypto.randomUUID(), revision: 1, text: "Existing fictional loan history." }).message);
  db.exec(`DROP INDEX inbound_replies_by_lead_conversation; ALTER TABLE inbound_replies DROP COLUMN leadConversationId;
    DROP TABLE lead_conversation_events; DROP TABLE lead_conversations;
    DROP INDEX inbound_replies_by_contact_conversation; ALTER TABLE inbound_replies DROP COLUMN contactConversationId;
    DROP TABLE contact_conversation_events; DROP TABLE contact_conversations;
    DROP INDEX conversations_by_source_lead; ALTER TABLE loan_conversations DROP COLUMN sourceLeadId;`);
  initializeStore(db, false);
  initializeStore(db, false);
  assert.equal(read({ type: "thread", id }).events[0].text, "Existing fictional loan history.");
  assert.ok(write({ type: "startLead", leadId: lead("Fictional lead on upgraded workspace") }).id);
  assert.ok(write({ type: "startContact", contactId: subject.contactId }).id);
});

test("an inbound receipt matches both an open lead and a loan and follows the chosen lead through conversion", async (t) => {
  const { db, subject, lead, admin, lo, other, brokerage, now, read } = fixture(t);
  const leadId = lead("Fictional lead with a linked contact");
  const archived = lead("Fictional archived lead");
  const sender = "incoming@example.test";
  db.prepare("UPDATE contacts SET email = ? WHERE id = ?").run(sender, subject.contactId);
  db.prepare("UPDATE referral_leads SET importedContactId = ? WHERE id = ?").run(subject.contactId, leadId);
  db.prepare("UPDATE referral_leads SET email = ?, resolvedAt = ? WHERE id = ?").run(sender, now.toISOString(), archived);
  const save = (input, actor = admin, workspace = brokerage.id) => changeInboundReply(db, input, actor, workspace, now);
  const review = (id) => readInboundReplies(db, { type: "reply", id }, admin, brokerage.id);
  const input = { type: "simulate", channel: "Email", sourceId: "fictional-pre-1003", sender, text: "Could we schedule a fictional callback?" };
  const { id } = save(input);
  assert.deepEqual(review(id).matches.map((item) => [item.kind, item.leadId ?? item.loanId ?? item.contactId]),
    [["contact", subject.contactId], ["lead", leadId], ["loan", subject.loanId]]);
  const attach = { type: "attachLead", id, revision: 1, leadId };
  assert.ok(save(attach, lo).error);
  assert.ok(save(attach, admin, crypto.randomUUID()).error);
  assert.ok(save({ ...attach, leadId: archived }).error);
  db.prepare("UPDATE referral_leads SET importedContactId = NULL WHERE id = ?").run(leadId);
  assert.match(save(attach).error, /no longer matches that open lead/);
  db.prepare("UPDATE referral_leads SET importedContactId = ? WHERE id = ?").run(subject.contactId, leadId);
  assert.equal(save(input).id, id);
  const linked = save(attach);
  assert.ok(linked.conversationId, linked.error);
  assert.equal(save(attach).conversationId, linked.conversationId);
  assert.equal(review(id).reply.conversationId, linked.conversationId);
  assert.ok(read({ type: "thread", id: linked.conversationId }, other).error);
  const before = read({ type: "thread", id: linked.conversationId }, lo);
  assert.equal(before.thread.leadId, leadId);
  assert.equal(before.thread.unread, true);
  assert.equal(before.events.length, 1);
  assert.equal(before.events[0].origin, "Simulated");

  const pending = save({ ...input, sourceId: "fictional-stale-target" });
  assert.ok(review(pending.id).matches.some((item) => item.kind === "lead" && item.leadId === leadId));
  const converted = await executeCommand(db, { type: "convertReferral", referralId: leadId, contactId: null }, lo);
  assert.ok(converted.referralLoanId, converted.error);
  assert.equal(review(id).reply.conversationId, linked.conversationId);
  assert.equal(save(input).id, id);
  assert.equal(save(attach).conversationId, linked.conversationId);
  assert.equal(review(id).reply.replayCount, 2);
  assert.match(save({ ...attach, id: pending.id }).error, /no longer matches that open lead/);
  assert.ok(review(pending.id).matches.every((item) => item.kind !== "lead"));
  assert.ok(review(pending.id).matches.some((item) => item.loanId === converted.referralLoanId));
  const after = read({ type: "thread", id: linked.conversationId }, lo);
  assert.equal(after.thread.loanId, converted.referralLoanId);
  assert.deepEqual(after.events, before.events);
  assert.equal(db.prepare("SELECT leadConversationId FROM inbound_replies WHERE id = ?").get(id).leadConversationId, null);
});

test("lead reply matches normalize phone numbers and page across a bounded backfill", (t) => {
  const { db, lead, subject, admin, brokerage, now } = fixture(t);
  const phone = "+1 (248) 555-0199";
  const matched = db.prepare("UPDATE referral_leads SET phone = ? WHERE id = ?");
  for (let i = 0; i < 501; i++) {
    const leadId = lead(`Fictional indexed lead ${i}`);
    if (i < 21) matched.run(phone, leadId);
  }
  db.prepare("UPDATE contacts SET phone = ? WHERE id = ?").run(phone, subject.contactId);
  const receipt = changeInboundReply(db, { type: "simulate", channel: "Text", sourceId: "fictional-phone-index", sender: "2485550199",
    text: "Fictional text reply." }, admin, brokerage.id, now);
  const readPage = (after) => readInboundReplies(db, { type: "reply", id: receipt.id, after }, admin, brokerage.id);
  assert.equal(readPage().indexing, true);
  const first = readPage();
  assert.equal(first.matches.length, 20);
  assert.equal(first.matches[0].kind, "contact");
  assert.ok(first.matches.slice(1).every(({ kind }) => kind === "lead"));
  const last = readPage(first.next);
  assert.deepEqual(last.matches.map(({ kind }) => kind), ["lead", "lead", "loan"]);
  assert.equal(new Set([...first.matches, ...last.matches].flatMap(({ leadId }) => leadId ? [leadId] : [])).size, 21);
  assert.equal(last.next, null);
});

test("first conversation after conversion follows the current loan and links the exact borrower", async (t) => {
  const { db, lead, lo, other, admin, processor, write, read, now } = fixture(t);
  async function convert(name) {
    const leadId = lead(name);
    assert.equal(read({ type: "lead", leadId }).kind, "new");
    const result = await executeCommand(db, { type: "convertReferral", referralId: leadId, contactId: null }, lo);
    assert.ok(result.referralLoanId, result.error);
    const loan = result.state.loans.find(({ id }) => id === result.referralLoanId);
    return { leadId, loanId: loan.id, contactId: loan.contactId };
  }
  const { leadId, loanId, contactId } = await convert("Fictional first conversation");
  const leadStart = { type: "startLead", leadId };
  const source = { type: "lead", leadId };
  db.prepare("UPDATE loans SET officerEmail = ?, officer = ? WHERE id = ?").run(other.email, other.name, loanId);
  db.prepare(`INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision)
    VALUES (?, ?, ?, 'Assigned', '', ?, 1)`).run(loanId, processor.email, processor.name, now.toISOString());
  for (const actor of [lo, processor]) {
    assert.ok(read(source, actor).error);
    assert.ok(write(leadStart, actor).error);
  }
  assert.ok(write(leadStart, other, crypto.randomUUID()).error);
  assert.equal(read(source, other).convertedLoan, true);
  assert.equal(read(source, admin).subject.leadId, leadId);
  assert.equal(db.prepare("SELECT count(*) AS total FROM loan_conversations WHERE loanId = ?").get(loanId).total, 0);
  db.prepare("UPDATE loans SET disposition = 'On hold' WHERE id = ?").run(loanId);
  assert.ok(write(leadStart, other).error);
  db.prepare("UPDATE loans SET disposition = 'Active' WHERE id = ?").run(loanId);
  db.prepare("UPDATE applications SET revokedAt = ? WHERE loanId = ?").run(now.toISOString(), loanId);
  const direct = write({ type: "start", loanId, contactId, audience: "Borrower" }, other);
  assert.ok(direct.id, direct.error);
  assert.equal(db.prepare("SELECT sourceLeadId FROM loan_conversations WHERE id = ?").get(direct.id).sourceLeadId, null);
  const note = { type: "note", id: direct.id, eventId: crypto.randomUUID(), revision: direct.opened.thread.revision, text: "Fictional pre-existing note." };
  assert.ok(write(note, other).message);
  const linked = write(leadStart, other);
  assert.equal(linked.id, direct.id);
  assert.equal(linked.opened.events[0].text, note.text);
  assert.equal(linked.opened.thread.revision, direct.opened.thread.revision + 2);
  assert.equal(write(leadStart, other).opened.thread.revision, linked.opened.thread.revision);
  assert.equal(write(leadStart, processor).id, linked.id);

  const conflicted = await convert("Fictional different source");
  const ordinary = write({ type: "start", loanId: conflicted.loanId, contactId: conflicted.contactId, audience: "Borrower" });
  const otherSource = lead("Fictional conflicting source");
  db.prepare("UPDATE loan_conversations SET sourceLeadId = ? WHERE id = ?").run(otherSource, ordinary.id);
  assert.ok(write({ type: "startLead", leadId: conflicted.leadId }).error);
  assert.equal(db.prepare("SELECT sourceLeadId FROM loan_conversations WHERE id = ?").get(ordinary.id).sourceLeadId, otherSource);

  const withoutApplication = await convert("Fictional legacy loan without application");
  db.prepare("DELETE FROM applications WHERE loanId = ?").run(withoutApplication.loanId);
  assert.ok(write({ type: "startLead", leadId: withoutApplication.leadId }).error);
  assert.ok(write({ type: "start", loanId: withoutApplication.loanId, contactId: withoutApplication.contactId, audience: "Borrower" }).id);
});

test("a delayed reply to a lead is recorded without resetting newer call and follow-up work", (t) => {
  const { db, lead, admin, lo, write, read, brokerage, now } = fixture(t);
  const leadId = lead("Fictional lead with a newer call");
  const older = new Date(now.getTime() - 3_600_000);
  const { id: receiptId } = changeInboundReply(db, { type: "simulate", channel: "Email", sourceId: "fictional-older-lead-reply",
    sender: `${leadId}@example.test`, text: "Fictional older reply." }, admin, brokerage.id, older);
  const { id } = write({ type: "startLead", leadId });
  db.prepare(`INSERT INTO lead_events (id, leadId, actor, at, kind, outcome, text) VALUES (?, ?, ?, ?, 'Call', 'Connected', 'Fictional newer call.')`)
    .run(crypto.randomUUID(), leadId, lo.name, now.toISOString());
  assert.ok(write({ type: "followUp", id, eventId: crypto.randomUUID(), revision: 1, dueOn: "2026-11-09" }).message);
  const linked = changeInboundReply(db, { type: "attachLead", id: receiptId, leadId, revision: 1 }, admin, brokerage.id, now);
  assert.equal(linked.conversationId, id);
  const thread = read({ type: "thread", id });
  assert.equal(thread.thread.unread, false);
  assert.equal(thread.thread.status, "Open");
  assert.equal(thread.thread.dueOn, "2026-11-09");
  assert.equal(thread.events.at(-1).text, "Fictional older reply.");
});

test("held and opted-out leads keep conversation history while prospecting reminders stay out of the queues", async (t) => {
  const { db, lead, write, read, list, lo, brokerage, now } = fixture(t);
  const leadId = lead("Fictional opted-out prospect");
  const { id } = write({ type: "startLead", leadId });
  assert.ok(write({ type: "followUp", id, eventId: crypto.randomUUID(), revision: 1, dueOn: "2026-11-08" }).message);
  db.prepare("UPDATE referral_leads SET heldAt = ? WHERE id = ?").run(now.toISOString(), leadId);
  assert.equal(read({ type: "thread", id }).thread.held, true);
  assert.equal(list("Follow-up due").rows.length, 0);
  db.prepare("UPDATE referral_leads SET heldAt = NULL WHERE id = ?").run(leadId);
  assert.ok((await executeCommand(db, { type: "leadOptOut", leadId }, lo)).state);
  assert.equal(read({ type: "thread", id }).thread.outreachBlocked, true);
  const converted = await executeCommand(db, { type: "convertReferral", referralId: leadId, contactId: null }, lo);
  assert.ok(converted.referralLoanId, converted.error);
  const linked = read({ type: "thread", id });
  assert.equal(linked.thread.outreachBlocked, true);
  assert.equal(linked.events.length, 1);
  assert.ok(write({ type: "followUp", id, revision: linked.thread.revision, eventId: crypto.randomUUID(), dueOn: "2026-11-09" }).error);
  assert.equal(list("Follow-up due").rows.length, 0);
  assert.equal(readOfficerQueue(db, { horizon: 7 }, lo, brokerage.id, now).items.some(({ id: key }) => key === id), false);
});

test("pilot reply review requires an explicit current match and deduplicates source replays before and after linking", (t) => {
  const { db, admin, lo, processor, create, brokerage, now, read } = fixture(t);
  create("repeat");
  db.exec(`UPDATE contacts SET email = 'Buyer@Example.test' WHERE id = 'sample-borrower';
    UPDATE loans SET contactId = 'sample-borrower', purpose = 'Refinance' WHERE id = 'repeat';`);
  const reply = { type: "simulate", channel: "Email", sourceId: "mock-email-1", sender: "buyer@example.test", text: "Fictional question about the refinance." };
  const update = (input, staff = admin, tenant = brokerage.id) => changeInboundReply(db, input, staff, tenant, now);
  const queue = (input, staff = admin, tenant = brokerage.id) => readInboundReplies(db, input, staff, tenant);
  assert.ok(update(reply, lo).error);
  assert.ok(update(reply, admin, crypto.randomUUID()).error);
  assert.ok(update(reply, { ...admin, brokerage: { ...admin.brokerage, pilot: false } }).error);
  const { id } = update(reply);
  assert.equal(update({ ...reply, sender: "BUYER@example.test" }).id, id);
  assert.ok(update({ ...reply, text: "Different payload." }).error);
  assert.equal(queue({ type: "list", status: "Pending" }).rows.length, 1);
  assert.ok(queue({ type: "reply", id }, processor).error);
  let receipt = queue({ type: "reply", id });
  assert.equal(receipt.reply.replayCount, 1);
  assert.equal(receipt.matches[0].contactId, "sample-borrower");
  assert.deepEqual(receipt.matches.filter(({ kind }) => kind === "loan").map(({ loanId, purpose }) => [loanId, purpose]),
    [["repeat", "Refinance"], ["sample", "Purchase"]]);
  assert.equal(db.prepare("SELECT count(*) AS total FROM conversation_events").get().total, 0);
  const attach = { type: "attach", id, revision: receipt.reply.revision, loanId: "repeat", contactId: "sample-borrower", audience: "Borrower" };
  assert.ok(update({ ...attach, revision: 2 }).error);
  db.exec("UPDATE contacts SET email = 'updated@example.test' WHERE id = 'sample-borrower';");
  assert.ok(update(attach).error);
  assert.equal(queue({ type: "reply", id }).matches.length, 0);
  db.exec("UPDATE contacts SET email = 'buyer@example.test' WHERE id = 'sample-borrower';");
  const linked = update(attach);
  assert.equal(update(attach).conversationId, linked.conversationId);
  assert.ok(update({ ...attach, loanId: "sample" }).error);
  assert.equal(update(reply).id, id);
  assert.equal(queue({ type: "list", status: "Pending" }).rows.length, 0);
  receipt = queue({ type: "reply", id });
  assert.equal(receipt.reply.status, "Linked");
  assert.equal(receipt.reply.replayCount, 2);
  const result = read({ type: "thread", id: linked.conversationId }, lo);
  assert.equal(result.thread.loanId, "repeat");
  assert.equal(result.thread.status, "Needs reply");
  assert.equal(result.thread.unread, true);
  assert.deepEqual(result.events.map(({ origin, text }) => ({ origin, text })), [{ origin: "Simulated", text: reply.text }]);
});

test("a delayed realtor text preserves newer conversation work and the identity index keeps borrower suppression separate", (t) => {
  const { db, admin, brokerage, read, write, now } = fixture(t);
  const earliest = new Date(now.getTime() - 3_600_000);
  db.exec(`UPDATE contacts SET phone = '+1 (248) 555-0199', email = 'partner@example.test' WHERE id = 'sample-realtor';
    INSERT INTO outreach_opt_outs VALUES ('fixture', 'email:partner@example.test', NULL, '${now.toISOString()}');
    DROP TRIGGER realtor_reply_insert; DROP TRIGGER realtor_reply_update;
    DELETE FROM settings WHERE key = 'realtorReplyIndexV1';
    DROP TABLE realtor_reply_keys; DROP TABLE realtor_reply_pending;`);
  initializeStore(db, false);
  assert.equal(blockedOutreachKeys(db, [{ phone: "2485550199" }]).size, 0);
  const reply = { type: "simulate", channel: "Text", sourceId: "mock-text-1", sender: "248-555-0199", text: "Fictional realtor reply." };
  const { id } = changeInboundReply(db, reply, admin, brokerage.id, earliest);
  const subject = { loanId: "sample", contactId: "sample-realtor", audience: "Realtor" };
  const { id: threadId } = write({ type: "start", ...subject }, admin);
  assert.equal(write({ type: "message", id: threadId, eventId: crypto.randomUUID(), revision: 1,
    direction: "Outbound", channel: "Text", text: "A newer fictional reply." }, admin).id, threadId);
  assert.equal(write({ type: "followUp", id: threadId, eventId: crypto.randomUUID(), revision: 2, dueOn: "2026-11-09" }, admin).id, threadId);
  const review = readInboundReplies(db, { type: "reply", id }, admin, brokerage.id);
  assert.deepEqual(review.matches.map(({ kind, contactId, loanId }) => [kind, contactId, loanId]),
    [["contact", "sample-realtor", undefined], ["loan", "sample-realtor", "sample"]]);
  assert.equal(changeInboundReply(db, { type: "attach", id, revision: review.reply.revision, ...subject }, admin, brokerage.id, now).conversationId, threadId);
  const thread = read({ type: "thread", id: threadId }, admin);
  assert.equal(thread.thread.status, "Waiting on contact");
  assert.equal(thread.thread.unread, false);
  assert.equal(thread.thread.dueOn, "2026-11-09");
  assert.equal(thread.events.at(-1).at, earliest.toISOString());
  const unmatched = changeInboundReply(db, { ...reply, sourceId: "unmatched", sender: "5555550100" }, admin, brokerage.id, now);
  assert.equal(readInboundReplies(db, { type: "reply", id: unmatched.id }, admin, brokerage.id).matches.length, 0);
  const dismiss = { type: "dismiss", id: unmatched.id, revision: 1 };
  assert.equal(changeInboundReply(db, dismiss, admin, brokerage.id, now).message, "Reply dismissed.");
  assert.equal(changeInboundReply(db, dismiss, admin, brokerage.id, now).message, "Reply dismissed.");
});

test("standalone contact follow-ups and simulated replies stay with their assigned officer", (t) => {
  const { db, write, read, list, admin, lo, other, processor, brokerage, now } = fixture(t);
  const contactId = "fictional-past-client";
  const sender = "past-client@example.test";
  insertContact(db, { id: contactId, name: "Fictional past client", email: sender, phone: "", role: "Borrower", addedBy: lo.email });
  const start = { type: "startContact", contactId };
  assert.equal(read({ type: "contact", contactId }).kind, "new");
  assert.ok(write(start, other).error);
  assert.ok(write(start, processor).error);
  const { id } = write(start);
  assert.ok(id);
  assert.equal(write(start, admin).id, id);
  const thread = { type: "thread", id };
  const action = (type, fields = {}, staff = lo) => ({ type, id, revision: read(thread, staff).thread.revision, eventId: crypto.randomUUID(), ...fields });
  assert.equal(write(action("message", { direction: "Outbound", channel: "Call", text: "Fictional annual check-in." })).id, id);
  assert.equal(write(action("followUp", { dueOn: "2026-11-08" })).id, id);
  const today = (staff) => readOfficerQueue(db, { horizon: 1 }, staff, brokerage.id, now).items.some((item) => item.recordId === id);
  assert.equal(today(lo), true);
  const assign = action("assignContact", { email: other.email });
  assert.ok(changeConversation(db, assign, lo, brokerage.id, now, other).error);
  assert.ok(changeConversation(db, assign, admin, brokerage.id, now, null).error);
  assert.equal(changeConversation(db, assign, admin, brokerage.id, now, other).id, id);
  assert.equal(changeConversation(db, assign, admin, brokerage.id, now, other).id, id);
  assert.ok(read(thread, lo).error);
  assert.ok(write(start, lo).error);
  assert.ok(read(thread, processor).error);
  assert.ok(read(thread, other, crypto.randomUUID()).error);
  assert.equal(today(lo), false);
  assert.equal(today(other), true);
  const calendar = readWorkspaceCalendar(db, { week: "2026-11-08", scope: "Mine", group: "Conversations" }, other, brokerage.id, now);
  assert.ok(calendar.items.some((item) => item.recordId === id && item.owner === other.name));

  const save = (input, staff = admin, at = new Date(now.getTime() + 60_000)) => changeInboundReply(db, input, staff, brokerage.id, at);
  const simulated = { type: "simulate", channel: "Email", sourceId: "fictional-contact-reply", sender, text: "I’d like to schedule a check-in." };
  const receipt = save(simulated);
  const review = () => readInboundReplies(db, { type: "reply", id: receipt.id }, admin, brokerage.id);
  assert.deepEqual(review().matches, [{ kind: "contact", contactId, name: "Fictional past client", role: "Borrower", owner: other.name }]);
  const attach = { type: "attachContact", id: receipt.id, revision: 1, contactId };
  assert.ok(save(attach, other).error);
  db.prepare("UPDATE contacts SET email = 'changed@example.test' WHERE id = ?").run(contactId);
  assert.match(save(attach).error, /no longer matches that contact/);
  db.prepare("UPDATE contacts SET email = ? WHERE id = ?").run(sender, contactId);
  assert.equal(save(attach).conversationId, id);
  assert.equal(save(attach).conversationId, id);
  assert.equal(save(simulated).id, receipt.id);
  assert.equal(review().reply.conversationId, id);
  assert.equal(review().reply.replayCount, 1);
  const unread = list("Unread", other, true).rows;
  assert.equal(unread[0].id, id);
  assert.equal(unread[0].status, "Needs reply");
  assert.equal(read(thread, other).events.filter((event) => event.origin === "Simulated").length, 1);

  assert.equal(write(action("followUp", { dueOn: "2026-11-08" }, other), other).id, id);
  db.prepare("INSERT INTO outreach_opt_outs VALUES (?, ?, NULL, ?)").run("fixture-contact", `email:${sender}`, now.toISOString());
  assert.equal(today(other), false);
  assert.equal(list("Follow-up due", other).rows.length, 0);
  assert.ok(write(action("message", { direction: "Outbound", channel: "Call", text: "Blocked outreach." }, other), other).error);
  assert.equal(read(thread, other).thread.outreachBlocked, true);
});

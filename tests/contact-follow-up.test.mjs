import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
      return next(`${specifier}.ts`, context);
    }
  },
});

const { executeCommand } = await import("../src/lib/commands.ts");
const { initializeStore, insertContact, insertLoan, readStaffWorkspaceEntry } = await import("../src/lib/store.ts");
const { easternDate } = await import("../src/lib/client-retention.ts");
const { readRecordHistory } = await import("../src/lib/record-history.ts");
const { changeConversation, readConversations } = await import("../src/lib/conversations.ts");
const { assignProcessor } = await import("../src/lib/loan-processing.ts");
const { contactFollowUpExceptions, ownerRecoveryWork, playbookWork } = await import("../src/lib/playbook-model.ts");
const { loanNextAction } = await import("../src/lib/loan-workflow.ts");
const { assignLoan } = await import("../src/lib/workspace-access.ts");

async function fixture(t, purpose = "Loan service") {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    exec: (query) => sqlite.exec(query),
    prepare: (query) => sqlite.prepare(query),
    transaction(run) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = run();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  initializeStore(db, false);
  const id = crypto.randomUUID();
  const actor = (name, role) => ({ name, email: `${name.toLowerCase()}@example.test`, brokerage: { id, role, pilot: true, name: "Fictional team" } });
  const admin = actor("Manager", "Admin");
  const author = actor("Author", "LO");
  const assignee = actor("Assignee", "LO");
  const processor = actor("Processor", "Processor");
  const contactId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  insertContact(db, { id: contactId, name: "Fictional borrower", email: "borrower@example.test", phone: "2485550131", role: "Borrower", addedBy: author.email });
  const command = (staff, input) => executeCommand(db, input, staff, undefined, [admin, author, assignee]);
  const original = "Borrower asked for a status update.";
  const logged = await command(author, { type: "logContactActivity", contactId, eventId, kind: "Call", outcome: "Connected",
    text: original, followUp: easternDate(new Date(Date.now() + 86_400_000)), purpose });
  assert.ok(logged.state, logged.error);
  const assigned = await command(admin, { type: "assignContactFollowUp", contactId, eventId, revision: 0, email: assignee.email });
  assert.ok(assigned.state, assigned.error);
  return { db, command, admin, author, assignee, processor, contactId, eventId, original };
}

test("staff entry preserves templates and creates retention work for the right queue without returning records", async (t) => {
  const { db, admin, author, assignee, processor, contactId } = await fixture(t);
  const addFunded = (id, owner) => {
    insertLoan(db, { id, contactId, partnerId: null, officer: owner.name, officerEmail: owner.email,
      amount: 260_000, address: "Fictional property", purpose: "Purchase", stage: "Funded", stageSince: "2024-01-03T00:00:00.000Z" });
    db.prepare(`INSERT INTO past_client_profiles (loanId, closingDate, watchEnabled, targetRate, observedRate)
      VALUES (?, '2024-01-03', 1, 6.25, 5.75)`).run(id);
  };
  addFunded("owned-funded", author);
  addFunded("peer-funded", assignee);
  db.prepare("INSERT INTO brokerage_templates VALUES ('Borrower', 'Clear to Close', 'Fictional custom wording', 1)").run();
  const tasks = () => db.prepare("SELECT loanId FROM tasks ORDER BY loanId").all().map(({ loanId }) => loanId);
  assert.deepEqual(readStaffWorkspaceEntry(db, processor).loans, []);
  assert.deepEqual(tasks(), []);
  const entry = readStaffWorkspaceEntry(db, author);
  assert.deepEqual(entry.loans, []);
  assert.deepEqual(entry.contacts, []);
  assert.deepEqual(entry.contactActivity, []);
  assert.deepEqual(entry.brokerageTemplates.map(({ body }) => body), ["Fictional custom wording"]);
  assert.deepEqual(tasks(), ["owned-funded", "owned-funded"]);
  readStaffWorkspaceEntry(db, author);
  assert.deepEqual(tasks(), ["owned-funded", "owned-funded"]);
  readStaffWorkspaceEntry(db, admin);
  assert.deepEqual(tasks(), ["owned-funded", "owned-funded", "peer-funded", "peer-funded"]);
});

test("a reassigned reminder records a durable outcome and rejects competing revisions", async (t) => {
  const { db, command, admin, author, assignee, processor, contactId, eventId, original } = await fixture(t);
  const completion = { type: "completeContactFollowUp", contactId, eventId, revision: 1, completed: true,
    resolution: { outcome: "Sent update", note: "Shared the status with the borrower." } };
  assert.ok((await command(author, completion)).error);
  assert.ok((await command(processor, completion)).error);
  assert.ok((await command(assignee, { ...completion, revision: 0 })).error);
  const saved = await command(assignee, completion);
  assert.ok(saved.state, saved.error);
  assert.equal(saved.state.contacts.length, 0);
  assert.deepEqual(saved.state.followUpContacts.map((contact) => contact.id), [contactId]);
  const entry = saved.state.contactActivity.find((item) => item.id === eventId);
  assert.equal(entry.text, original);
  assert.equal(entry.officer, author.name);
  assert.deepEqual(entry.latestCompletion, { at: entry.completedAt, actor: assignee.name, ...completion.resolution });
  assert.ok((await command(assignee, completion)).state);
  assert.ok((await command(admin, completion)).error);
  assert.ok((await command(assignee, { ...completion, resolution: { ...completion.resolution, note: "Replacement note" } })).error);
  const reopened = await command(assignee, { type: "completeContactFollowUp", contactId, eventId, revision: 2, completed: false });
  assert.equal(reopened.state.contactActivity[0].completedAt, null);
  assert.deepEqual(reopened.state.contactActivity[0].latestCompletion, entry.latestCompletion);
  assert.ok((await command(assignee, completion)).error);
  const updated = await command(assignee, { ...completion, revision: 3, resolution: { outcome: "Resolved", note: "Confirmed with borrower." } });
  assert.equal(updated.state.contactActivity[0].latestCompletion.outcome, "Resolved");
  assert.equal(db.prepare("SELECT count(*) AS total FROM contact_follow_up_completions WHERE activityId = ?").get(eventId).total, 2);
});

test("an outreach opt-out blocks completion of a reassigned prospecting reminder", async (t) => {
  const { db, command, author, assignee, contactId, eventId } = await fixture(t, "Prospecting");
  assert.ok((await command(author, { type: "optOutContact", contactId })).state);
  const result = await command(assignee, { type: "completeContactFollowUp", contactId, eventId, revision: 1, completed: true,
    resolution: { outcome: "Connected", note: "" } });
  assert.match(result.error, /opted out/);
  assert.equal(db.prepare("SELECT count(*) AS total FROM contact_follow_up_completions WHERE activityId = ?").get(eventId).total, 0);
  assert.equal(db.prepare("SELECT completedAt FROM contact_activity WHERE id = ?").get(eventId).completedAt, null);
});

test("ownership recovery finds held leads and open servicing reminders when an owner is no longer an LO", async (t) => {
  const { db, command, admin, author, assignee, contactId, eventId } = await fixture(t);
  const leadId = crypto.randomUUID();
  const at = "2026-11-08T17:00:00.000Z";
  const revisitDate = "2026-12-09";
  db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer,
    officerEmail, createdAt, dueAt, heldAt, holdReason, revisitDate)
    VALUES (?, ?, 'Fictional prospect', 'prospect@example.test', '2485550191', 'Purchase', ?, ?, ?, ?, ?, 'Wait for update', ?)`)
    .run(leadId, leadId, assignee.name, assignee.email, at, at, at, revisitDate);
  const { state } = await command(admin, { type: "refreshWorkspace" });
  const member = { email: assignee.email, name: assignee.name, role: "LO", status: "Active" };
  assert.deepEqual(ownerRecoveryWork(state, [member]), []);
  assert.deepEqual(contactFollowUpExceptions(state, [member], Date.parse(at)), []);
  const recovery = ownerRecoveryWork(state, [{ ...member, role: "Processor" }]);
  assert.deepEqual(recovery.map(({ kind, recordId }) => [kind, recordId]), [["lead-owner", leadId]]);
  assert.equal(recovery[0].dueAt, `${revisitDate}T17:00:00.000Z`);
  const [followUp] = contactFollowUpExceptions(state, [], Date.parse(at));
  assert.equal(followUp.recordId, contactId);
  assert.equal(followUp.id, eventId);
  const leadMove = await command(admin, { type: "assignInboxLead", leadId, email: author.email, previousEmail: assignee.email });
  assert.equal(leadMove.state.inboxLeads[0].revisitDate, revisitDate);
  const assigned = await command(admin, { type: "assignContactFollowUp", contactId, eventId, revision: followUp.activity.revision, email: author.email });
  assert.equal(assigned.state.contactActivity[0].dueAt, followUp.dueAt);
  const owners = [{ ...member, name: author.name, email: author.email }];
  assert.deepEqual(ownerRecoveryWork(assigned.state, owners), []);
  assert.deepEqual(contactFollowUpExceptions(assigned.state, owners, Date.parse(at)), []);
});

test("a replacement processor inherits the in-progress handoff while access follows current roles", async (t) => {
  const { db, command, admin, author, assignee, processor, contactId } = await fixture(t);
  const loanId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const dueAt = "2026-12-09T17:00:00.000Z";
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: author.name, officerEmail: author.email,
    address: "", amount: 0, purpose: "Purchase", stage: "Processing", stageSince: dueAt });
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, 'Follow up with borrower', ?)").run(taskId, loanId, dueAt);
  const activeMember = (staff) => ({ ...staff, role: staff.brokerage.role, status: "Active" });
  const demoted = { ...author, brokerage: { ...author.brokerage, role: "Processor" } };
  const replacement = { ...processor, email: "replacement@example.test", name: "Replacement" };
  assert.equal((await command(processor, { type: "refreshWorkspace" })).state.loans.length, 0);
  assert.ok(assignProcessor(db, admin, { loanId, revision: 0, member: activeMember(processor) }).message);
  const beforeSend = (await command(processor, { type: "refreshWorkspace" })).state;
  assert.equal(beforeSend.loans[0].id, loanId);
  assert.equal(beforeSend.loanProcessing[0].status, "Assigned");
  assert.match((await command(processor, { type: "updateProcessing", loanId, revision: 1, action: "Accept handoff", note: "" })).error, /unavailable/);
  const send = await command(author, { type: "updateProcessing", loanId, revision: 1, action: "Send to processing", note: "Review received documents." });
  assert.ok(send.state, send.error);
  assert.match((await command(author, { type: "updateProcessing", loanId, revision: 2, action: "Accept handoff", note: "" })).error, /unavailable/);
  assert.match((await command(replacement, { type: "updateProcessing", loanId, revision: 2, action: "Accept handoff", note: "" })).error, /access/);
  const accepted = await command(processor, { type: "updateProcessing", loanId, revision: 2, action: "Accept handoff", note: "Working on the lender checklist." });
  assert.ok(accepted.state, accepted.error);
  const original = accepted.state.loanProcessing[0];

  assert.equal((await command(demoted, { type: "refreshWorkspace" })).state.loans.length, 0);
  assert.ok(readRecordHistory(db, demoted, { record: "loan", id: loanId }).error);
  assert.ok(readRecordHistory(db, demoted, { record: "contact", id: contactId }).error);
  const { state } = await command(admin, { type: "refreshWorkspace" });
  const members = [activeMember(demoted), activeMember(assignee), activeMember(replacement)];
  assert.deepEqual(ownerRecoveryWork(state, members).filter((item) => item.recordId === loanId)
    .map(({ kind, dueAt }) => [kind, dueAt]), [["loan-owner", dueAt], ["processor-owner", null]]);

  assert.ok(assignLoan(db, admin, { loanId, previousEmail: author.email, member: activeMember(demoted) }).error);
  assert.ok(assignLoan(db, admin, { loanId, previousEmail: author.email, member: activeMember(assignee) }).message);
  assert.ok(assignProcessor(db, admin, { loanId, revision: 2, member: activeMember(replacement) }).error);
  assert.ok(assignProcessor(db, admin, { loanId, revision: original.revision, member: activeMember(replacement) }).message);
  assert.equal((await command(processor, { type: "refreshWorkspace" })).state.loans.length, 0);
  const reassigned = (await command(replacement, { type: "refreshWorkspace" })).state;
  assert.deepEqual(reassigned.loanProcessing[0], { ...original, processorEmail: replacement.email, processorName: replacement.name, revision: 4 });
  assert.ok(readRecordHistory(db, replacement, { record: "loan", id: loanId }).events.some((item) => item.text.includes(original.note)));
  assert.equal((await command(assignee, { type: "refreshWorkspace" })).state.tasks.find((task) => task.id === taskId).dueAt, dueAt);
  const returned = await command(replacement, { type: "updateProcessing", loanId, revision: 4, action: "Return to LO", note: "Ready for LO review." });
  assert.equal(returned.state.loanProcessing[0].status, "Returned to LO");
  const completed = await command(assignee, { type: "updateProcessing", loanId, revision: 5, action: "Complete handoff", note: "Reviewed." });
  assert.equal(completed.state.loanProcessing[0].status, "Complete");
});

test("reassigning a held loan preserves its tasks and resumes the existing processor handoff after reopening", async (t) => {
  const { db, command, admin, author, assignee, processor, contactId } = await fixture(t);
  const loanId = crypto.randomUUID();
  const revisitDate = easternDate(new Date(Date.now() + 3 * 86_400_000));
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: author.name, officerEmail: author.email,
    address: "", amount: 300000, purpose: "Purchase", stage: "Processing", stageSince: new Date().toISOString() });
  const member = (staff) => ({ ...staff, role: staff.brokerage.role, status: "Active" });
  assert.ok(assignProcessor(db, admin, { loanId, revision: 0, member: member(processor) }).message);
  const task = await command(author, { type: "createTask", loanId, title: "Confirm borrower timeline", days: 1, purpose: "Loan service" });
  assert.ok(task.state, task.error);
  const sent = await command(author, { type: "updateProcessing", loanId, revision: 1, action: "Send to processing", note: "Resume after the borrower responds." });
  assert.ok(sent.state, sent.error);
  const accept = { type: "updateProcessing", loanId, revision: 2, action: "Accept handoff", note: "" };
  const hold = await command(author, { type: "loanDisposition", loanId, disposition: "On hold", reason: "Borrower requested more time.", revisitDate, revision: 0 });
  assert.ok(hold.state, hold.error);
  assert.match((await command(processor, accept)).error, /Reopen the loan/);
  assert.ok(assignLoan(db, admin, { loanId, previousEmail: author.email, member: member(assignee) }).message);
  const held = (await command(assignee, { type: "refreshWorkspace" })).state;
  const heldLoan = held.loans.find((item) => item.id === loanId);
  assert.deepEqual(loanNextAction(heldLoan, held), { title: "Review hold", target: "loan-workflow",
    dueAt: `${revisitDate}T17:00:00.000Z`, blocker: "Borrower requested more time." });
  assert.equal(playbookWork(held).some((item) => item.recordId === loanId && item.kind === "accept"), false);
  assert.equal((await command(author, { type: "refreshWorkspace" })).state.loans.length, 0);
  const reopen = { type: "loanDisposition", loanId, disposition: "Active", reason: "", revisitDate: null, revision: 1 };
  assert.match((await command(author, reopen)).error, /access/);
  const reopened = await command(assignee, reopen);
  assert.ok(reopened.state, reopened.error);
  assert.deepEqual(reopened.state.tasks, task.state.tasks);
  assert.equal(reopened.state.loans[0].revisitDate, null);
  assert.equal(reopened.state.loans[0].officerEmail, assignee.email);
  const processing = (await command(processor, { type: "refreshWorkspace" })).state;
  assert.deepEqual(processing.loanProcessing[0], sent.state.loanProcessing[0]);
  assert.equal(playbookWork(processing).filter((item) => item.recordId === loanId && item.kind === "accept").length, 1);
  assert.equal((await command(processor, accept)).state.loanProcessing[0].status, "In processing");
  assert.match((await command(processor, accept)).error, /handoff changed/);
});

test("record history pages across tied timestamps and honors task-only access", async (t) => {
  const { db, command, admin, author, assignee, processor, contactId, eventId } = await fixture(t);
  const at = "2026-10-03T15:00:00.000Z";
  const loanId = crypto.randomUUID();
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: author.name, officerEmail: author.email,
    address: "", amount: 0, purpose: "Purchase", stage: "Lead", stageSince: at });
  const addLoan = db.prepare("INSERT INTO activity (id, loanId, kind, text, createdAt) VALUES (?, ?, ?, ?, ?)");
  const addContact = db.prepare("INSERT INTO contact_activity (id, contactId, officer, officerEmail, kind, text, createdAt) VALUES (?, ?, ?, ?, 'Note', ?, ?)");
  for (let i = 0; i < 35; i++) {
    addLoan.run(`event-${i}`, loanId, "Call", `Loan interaction ${i}`, at);
    addContact.run(`event-${i}`, contactId, author.name, author.email, `Contact interaction ${i}`, at);
  }
  addLoan.run("private-note", loanId, "Note", "Loan note", at);
  const lean = await command(author, { type: "refreshWorkspace" });
  assert.ok(lean.state, lean.error);
  assert.deepEqual(lean.state.contactActivity.map((item) => item.id), [eventId]);
  assert.equal(lean.state.loans[0].lastOutreachAt, at);

  const onlyAssigned = readRecordHistory(db, assignee, { record: "contact", id: contactId });
  assert.deepEqual(onlyAssigned.events.map((item) => item.id), [eventId]);
  assert.ok(readRecordHistory(db, assignee, { record: "loan", id: loanId }).error);
  assert.ok(readRecordHistory(db, processor, { record: "contact", id: contactId }).error);
  assert.ok(assignProcessor(db, admin, { loanId, revision: 0, member: { ...processor, role: "Processor", status: "Active" } }).message);
  const processingHistory = readRecordHistory(db, processor, { record: "contact", id: contactId });
  assert.equal(processingHistory.events.length, 30);
  assert.ok(processingHistory.events.every((item) => item.source === "loan"));

  const items = [];
  let before;
  do {
    const page = readRecordHistory(db, author, { record: "contact", id: contactId, before });
    assert.ok(page.events.length <= 30);
    items.push(...page.events);
    before = page.next ?? undefined;
  } while (before);
  assert.equal(items.length, 71);
  assert.equal(new Set(items.map((item) => `${item.source}:${item.id}`)).size, items.length);
  assert.equal(readRecordHistory(db, author, { record: "loan", id: loanId }).events.length, 30);
  assert.ok(readRecordHistory(db, author, { record: "contact", id: contactId, before: { source: "unknown" } }).error);
});

test("contact history shows only visible correspondence and keeps the thread through lead conversion", async (t) => {
  const { db, command, admin, author, assignee, processor, contactId } = await fixture(t);
  const now = new Date("2026-11-08T14:00:00.000Z");
  const at = now.toISOString();
  const brokerage = admin.brokerage.id;
  const other = { ...author, name: "Other officer", email: "other@example.test" };
  insertContact(db, { id: "partner", name: "Fictional Realtor", role: "Realtor", email: "", phone: "" });
  const loan = (id, staff) => insertLoan(db, { id, contactId, partnerId: "partner", officer: staff.name, officerEmail: staff.email,
    address: "", amount: 0, purpose: "Purchase", stage: "Lead", stageSince: at });
  loan("assigned", author);
  loan("other-file", other);
  assert.ok(assignProcessor(db, admin, { loanId: "assigned", revision: 0, member: { ...processor, role: "Processor", status: "Active" } }).message);

  const leadId = crypto.randomUUID();
  db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, importedContactId)
    VALUES (?, ?, 'Fictional repeat prospect', 'borrower@example.test', '', 'Refinance', ?, ?, ?, ?, ?)`)
    .run(leadId, leadId, author.name, author.email, at, at, contactId);
  const callId = crypto.randomUUID();
  db.prepare(`INSERT INTO lead_events (id, leadId, kind, outcome, text, actor, at)
    VALUES (?, ?, 'Call', 'Connected', 'Original campaign call', ?, ?)`).run(callId, leadId, author.name, at);
  const write = (input, staff) => {
    const result = changeConversation(db, input, staff, brokerage, now);
    assert.ok(result.id, result.error);
    return result.id;
  };
  const leadThread = write({ type: "startLead", leadId }, author);
  const contactThread = write({ type: "startContact", contactId }, author);
  const loanThread = write({ type: "start", loanId: "assigned", audience: "Borrower", contactId }, author);
  const partnerThread = write({ type: "start", loanId: "assigned", audience: "Realtor", contactId: "partner" }, author);
  const otherThread = write({ type: "start", loanId: "other-file", audience: "Borrower", contactId }, other);
  const action = (id, staff, revision, fields) => write({ id, revision, eventId: crypto.randomUUID(), ...fields }, staff);
  action(leadThread, author, 1, { type: "sampleReply" });
  action(contactThread, author, 1, { type: "message", direction: "Outbound", channel: "Email", text: "Annual contact check-in" });
  action(contactThread, author, 2, { type: "note", text: "Private contact note" });
  action(loanThread, author, 1, { type: "message", direction: "Inbound", channel: "Text", text: "Loan update received" });
  action(loanThread, author, 2, { type: "followUp", dueOn: "2026-11-09" });
  action(partnerThread, author, 1, { type: "message", direction: "Outbound", channel: "Call", text: "Realtor-only outreach" });
  action(otherThread, other, 1, { type: "message", direction: "Outbound", channel: "Call", text: "Other loan’s outreach" });

  const read = (staff, id = contactId, before) => readRecordHistory(db, staff, { record: "contact", id, before });
  const events = (staff, id = contactId) => read(staff, id).events.filter((event) => event.source === "conversation");
  const before = events(author);
  assert.deepEqual(before.map(({ targetId }) => targetId).sort(), [leadThread, contactThread, loanThread].sort());
  const leadEvent = before.find(({ targetId }) => targetId === leadThread);
  assert.partialDeepStrictEqual(leadEvent, { conversationType: "Lead", direction: "Inbound", kind: "Email", origin: "Simulated", author: author.name });
  assert.deepEqual(events(assignee), []);
  assert.deepEqual(events(processor).map(({ targetId }) => targetId), [loanThread]);
  assert.deepEqual(events(other).map(({ targetId }) => targetId), [otherThread]);
  assert.deepEqual(events(author, "partner").map(({ targetId }) => targetId), [partnerThread]);
  assert.equal(events(admin).length, 4);
  assert.ok(!JSON.stringify(read(admin)).includes("Private contact note"));
  assert.equal(read(admin).events.filter((event) => event.id === callId).length, 1);

  const converted = await command(author, { type: "convertReferral", referralId: leadId, contactId });
  assert.ok(converted.referralLoanId, converted.error);
  const convertedEvent = events(author).find(({ targetId }) => targetId === leadThread);
  assert.deepEqual(convertedEvent, { ...leadEvent, conversationType: "Loan" });
  assert.equal(readConversations(db, { type: "thread", id: leadThread }, author, brokerage, now).thread.loanId, converted.referralLoanId);
  assert.equal(read(author).events.filter((event) => event.id === callId).length, 1);

  const old = db.prepare(`INSERT INTO contact_conversation_events (id, conversationId, kind, channel, origin, text, actor, actorEmail, at, request)
    VALUES (?, ?, 'Outbound', 'Call', 'Manual log', 'Archived outreach', ?, ?, ?, '{}')`);
  for (let n = 0; n < 35; n++) old.run(crypto.randomUUID(), contactThread, author.name, author.email, at);
  const first = read(author);
  const second = read(author, contactId, first.next);
  assert.equal(first.events.length, 30);
  const both = [...first.events, ...second.events];
  assert.equal(both.filter((event) => event.targetId === contactThread).length, 36);
  assert.equal(new Set(both.map((event) => `${event.source}:${event.id}`)).size, both.length);
  db.exec("UPDATE loans SET partnerId = NULL WHERE id = 'assigned'");
  assert.deepEqual(events(admin, "partner"), []);
});

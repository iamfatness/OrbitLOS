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
const { activateBrokerages, activeBrokerages, changeBrokerage, departureRoster, initializeBrokerages } = await import("../src/lib/brokerages.ts");
const { departureWork, hasDepartureWork } = await import("../src/lib/offboarding.ts");
const { offboardingInput } = await import("../src/lib/offboarding-model.ts");
const { loanReviewWork } = await import("../src/lib/loan-reviews.ts");
const { coverageWork } = await import("../src/lib/coverage.ts");
const { changeConversation, readConversations } = await import("../src/lib/conversations.ts");
const { changeInboundReply, readInboundReplies } = await import("../src/lib/inbound-replies.ts");
const { readOfficerQueue } = await import("../src/lib/officer-queue.ts");
const { defaultLeadRouting } = await import("../src/lib/lead-inbox-model.ts");
const { leadRouting, writeLeadRouting } = await import("../src/lib/lead-inbox.ts");
const { quoteIntakeRouting, workOnQuoteSettings } = await import("../src/lib/quote-intake.ts");
const { defaultQuoteIntakeConfig } = await import("../src/lib/quote-intake-model.ts");

const at = "2026-11-08T15:00:00.000Z";
const now = new Date(at);
const oldDue = "2026-11-06T21:00:00.000Z";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction(fn) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = fn(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  initializeBrokerages(db);
  const id = crypto.randomUUID();
  const admin = { name: "Owner", email: "owner@example.test", brokerage: { id, role: "Admin", pilot: true, name: "Departure QA" } };
  const bootstrap = [admin.email];
  assert.equal(changeBrokerage(db, "orbit-demo", admin, bootstrap, { type: "create", name: "Departure QA", id, pilot: true }).error,
    "Only a brokerage admin can manage access and loan assignments.");
  activateBrokerages(db, admin, bootstrap);
  assert.equal(changeBrokerage(db, "orbit-demo", admin, bootstrap, { type: "create", name: "Departure QA", id, pilot: true }).created, id);
  function invite(name, role) {
    const staff = { name, email: `${name}@example.test`, brokerage: { ...admin.brokerage, role } };
    assert.ok(changeBrokerage(db, id, admin, bootstrap, { type: "invite", email: staff.email, role }).message);
    activateBrokerages(db, staff, bootstrap);
    return staff;
  }
  const officer = invite("officer", "LO");
  const processor = invite("processor", "Processor");
  const backup = invite("backup", "Processor");
  const roster = (staff, subject, replacement) => departureRoster(db, staff, id, bootstrap, subject.email, replacement?.email);
  const member = (staff) => roster(admin, staff).member;
  const run = (input, subject, replacement) => departureWork(db, offboardingInput.parse({ ...input, email: subject.email }),
    roster(admin, subject, replacement), admin, id, now);
  const preview = (subject, filter = "All work", after) => run({ type: "offboardingPreview", filter, after }, subject);
  const move = (subject, row, destination, fields = {}) => run({ type: "offboardingTransfer", kind: row.kind, id: row.id, revision: row.revision,
    memberRevision: member(subject).accessRevision, replacement: destination?.email ?? null, operationId: crypto.randomUUID(),
    routeKey: row.routeKey, ...fields }, subject, destination);
  const revoke = (subject, expected = member(subject).accessRevision) => changeBrokerage(db, id, admin, bootstrap,
    { type: "revoke", email: subject.email, expectedAccessRevision: expected });
  const loan = (owner) => {
    insertContact(db, { id: "borrower", name: "Fictional borrower", role: "Borrower", phone: "", email: "borrower@example.test" });
    insertLoan(db, { id: "loan", contactId: "borrower", partnerId: null, officer: owner.name, officerEmail: owner.email, address: "", purpose: "Purchase",
      stage: "Processing", stageSince: at, amount: 275000 });
  };
  const lead = (leadId, owner) => db.prepare(`INSERT INTO referral_leads (id,requestId,name,email,phone,purpose,officer,officerEmail,createdAt,dueAt)
    VALUES (?, ?, ?, 'prospect@example.test', '', 'Purchase', ?, ?, ?, ?)`).run(leadId, leadId, `Fictional ${leadId}`, owner.name, owner.email, at, oldDue);
  return { db, id, admin, officer, processor, backup, bootstrap, roster, member, preview, move, revoke, loan, lead };
}

test("recovers a departing officer’s realtor and quote routes with original links and policy", (t) => {
  const { db, admin, officer, processor, preview, move, revoke } = fixture(t);
  const token = "b".repeat(64);
  const quoteToken = "c".repeat(64);
  const expiry = "2026-11-15T15:00:00.000Z";
  for (const id of ["realtor-active", "realtor-expired"]) {
    insertContact(db, { id, name: id, role: "Realtor", phone: "", email: "" });
    db.prepare("INSERT INTO realtor_portals (realtorId, token, expiresAt, officerEmail, officer) VALUES (?, ?, ?, ?, ?)")
      .run(id, id === "realtor-active" ? token : "d".repeat(64), id === "realtor-active" ? expiry : oldDue, officer.email, officer.name);
  }
  writeLeadRouting(db, { ...defaultLeadRouting, websiteOwner: officer.email, quoteToken, realtorRoute: "Assigned officer",
    realtorOwner: officer.email, firstContactHours: 6 });
  const first = preview(officer);
  assert.equal(first.remaining, true);
  assert.equal(hasDepartureWork(db, officer.email, now), true);
  assert.deepEqual(first.items.map(({ id }) => id), ["realtor-active", "quote", "realtor"]);
  assert.match(first.items[0].detail, /Brokerage routing takes precedence/);
  assert.ok(!JSON.stringify(first).includes(token));
  assert.ok(!JSON.stringify(first).includes(quoteToken));
  assert.match(move(officer, first.items[0], processor).error, /active loan officer/);
  assert.match(move(officer, first.items[0], admin, { routeKey: undefined }).error, /link changed/);
  assert.ok(revoke(officer).message);
  assert.equal(preview(officer).member.status, "Revoked");
  assert.ok(move(officer, first.items[0], admin).message);
  assert.ok(move(officer, first.items[1], admin).message);
  assert.match(move(officer, first.items[2], null).error, /item changed/);
  assert.ok(move(officer, preview(officer, "Intake route").items[0], null).message);
  assert.equal(hasDepartureWork(db, officer.email, now), false);
  assert.deepEqual({ ...db.prepare("SELECT token, expiresAt, officerEmail FROM realtor_portals WHERE realtorId = 'realtor-active'").get() },
    { token, expiresAt: expiry, officerEmail: admin.email });
  assert.deepEqual(leadRouting(db), { ...defaultLeadRouting, revision: 3, websiteOwner: admin.email, quoteToken,
    realtorRoute: "Shared inbox", realtorOwner: null, firstContactHours: 6 });
});

test("reassigns a purpose profile during offboarding without rotating its public link", (t) => {
  const { db, id, admin, officer, processor, preview, move } = fixture(t);
  const token = "c".repeat(64);
  writeLeadRouting(db, { ...defaultLeadRouting, quoteToken: token });
  const config = { ...defaultQuoteIntakeConfig, ownerEmail: officer.email, title: "Fictional refinance intake" };
  const published = workOnQuoteSettings(db, { type: "publish", profile: "Refinance", revision: 0, config }, admin, id, at, officer);
  const [route] = preview(officer, "Intake route").items;
  assert.equal(route.id, "quote:Refinance");
  assert.equal(route.revision, published.revision);
  assert.match(move(officer, route, processor).error, /active loan officer/);
  assert.ok(move(officer, route, admin).message);
  assert.deepEqual(preview(officer, "Intake route").items, []);
  const current = quoteIntakeRouting(db, "Refinance");
  assert.equal(current.routing.quoteToken, token);
  assert.equal(current.ownerEmail, admin.email);
  assert.equal(current.form.config.title, config.title);
  assert.equal(current.form.revision, published.revision + 1);
});

test("hands off a lead callback, file, contact follow-up, and coverage with deadlines and history intact", (t) => {
  const { db, id, admin, officer, bootstrap, member, preview, move, revoke, loan, lead } = fixture(t);
  loan(officer);
  lead("lead", officer);
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES ('task', 'loan', 'File follow-up', ?)").run(oldDue);
  db.prepare("INSERT INTO call_campaigns VALUES ('campaign', 'Demo campaign', ?)").run(at);
  db.prepare("INSERT INTO lead_import_tasks (id, leadId, title, dueAt) VALUES ('callback', 'lead', 'Requested callback', ?)").run(oldDue);
  db.prepare(`INSERT INTO call_campaign_members (leadId,campaignId,joinedAt,attempts,lastOutcome,callbackTaskId)
    VALUES ('lead','campaign',?,1,'Requested callback','callback')`).run(at);
  db.prepare(`INSERT INTO contact_activity (id,contactId,officer,officerEmail,kind,text,createdAt,dueAt,followUpOwner,followUpOwnerEmail)
    VALUES ('contact-work','borrower',?,?,'Call','Fictional note',?,?,?,?)`).run(officer.name, officer.email, at, oldDue, officer.name, officer.email);
  const window = crypto.randomUUID();
  assert.equal(coverageWork(db, { type: "schedule", id: window, absentEmail: officer.email, backupEmail: admin.email,
    startsOn: "2026-11-08", endsOn: "2026-11-09" }, admin, id, [member(admin), member(officer)], now).kind, "saved");
  const rows = preview(officer).items;
  assert.deepEqual(rows.map(({ kind }) => kind), ["Lead", "Loan", "Contact follow-up", "Coverage"]);
  assert.equal(rows[0].campaignId, "campaign");
  assert.equal(rows[0].due, oldDue);
  assert.equal(rows[0].dueLabel, "Callback due");
  assert.equal(preview(officer, "Processing").remaining, true);
  assert.ok(move(officer, rows[0], admin, { memberRevision: 0 }).error);
  assert.ok(move(officer, rows[0], admin, { revision: 1 }).error);
  for (const row of rows) assert.ok(move(officer, row, row.kind === "Coverage" ? null : admin).message, row.kind);
  assert.equal(hasDepartureWork(db, officer.email, now), false);
  assert.equal(db.prepare("SELECT dueAt FROM lead_import_tasks WHERE id = 'callback'").get().dueAt, oldDue);
  assert.equal(db.prepare("SELECT dueAt FROM contact_activity WHERE id = 'contact-work'").get().dueAt, oldDue);
  assert.equal(db.prepare("SELECT officerEmail FROM contact_activity WHERE id = 'contact-work'").get().officerEmail, officer.email);
  assert.equal(db.prepare("SELECT endedAt FROM staff_coverage WHERE id = ?").get(window).endedAt, at);
  assert.ok(readOfficerQueue(db, { horizon: 7 }, admin, id, now).items.some(({ id }) => id === "task"));
  assert.match(move(officer, rows[0], admin).message, /no longer open/);
  assert.ok(revoke(officer).message);
  assert.equal(activeBrokerages(db, officer.email, bootstrap).length, 0);
  assert.equal(preview(officer).member.status, "Revoked");
});

test("recovers work after urgent removal and preserves an overdue review and processing handoff", (t) => {
  const { db, id, admin, officer, processor, backup, member, preview, move, revoke, loan } = fixture(t);
  loan(officer);
  db.prepare("INSERT INTO loan_processing VALUES ('loan', ?, ?, 'In processing', 'Fictional handoff note', ?, 1)").run(processor.email, processor.name, oldDue);
  const reviewId = crypto.randomUUID();
  const reviewedAt = new Date("2026-11-06T15:00:00.000Z");
  assert.equal(loanReviewWork(db, { type: "create", id: reviewId, loanId: "loan", title: "Fictional review", category: "General file review",
    reviewerEmail: processor.email, dueOn: "2026-11-06", note: "Retained evidence" }, officer, id, [member(officer), member(processor)], reviewedAt).kind, "saved");
  db.prepare("UPDATE loan_reviews SET escalatedAt = ?, applicationRevision = 7 WHERE id = ?").run(oldDue, reviewId);
  const revision = member(processor).accessRevision;
  assert.ok(revoke(processor).message);
  assert.ok(revoke(processor, revision).message);
  const recovery = preview(processor);
  assert.equal(recovery.member.status, "Revoked");
  assert.deepEqual(recovery.items.map(({ kind }) => kind), ["Processing", "Reviewer"]);
  assert.ok(move(processor, recovery.items[0], backup).message);
  assert.ok(move(processor, recovery.items[1], backup).message);
  const current = db.prepare("SELECT status, note, updatedAt FROM loan_processing WHERE loanId = 'loan'").get();
  assert.deepEqual({ ...current }, { status: "In processing", note: "Fictional handoff note", updatedAt: oldDue });
  assert.equal(preview(processor).remaining, false);
  const review = db.prepare("SELECT dueOn, escalatedAt, applicationRevision, reviewerEmail, requesterEmail FROM loan_reviews WHERE id = ?").get(reviewId);
  assert.deepEqual({ ...review }, { dueOn: "2026-11-06", escalatedAt: oldDue, applicationRevision: 7, reviewerEmail: backup.email, requesterEmail: officer.email });
  const requester = preview(officer, "Review requester").items[0];
  assert.ok(move(officer, requester, admin).message);
  assert.equal(db.prepare("SELECT requesterEmail FROM loan_reviews WHERE id = ?").get(reviewId).requesterEmail, admin.email);
  assert.deepEqual(db.prepare("SELECT action FROM loan_review_events ORDER BY sequence").all().map(({ action }) => action),
    ["Requested", "Reviewer handed off", "Requester handed off"]);
});

test("contact conversation handoff preserves unread replies, ownership history, and Today follow-ups", (t) => {
  const { db, id, admin, officer, processor, bootstrap, preview, move, revoke } = fixture(t);
  const create = (contactId) => {
    insertContact(db, { id: contactId, name: `Fictional ${contactId}`, role: "Realtor", phone: "", email: `${contactId}@example.test`, addedBy: officer.email });
    const opened = changeConversation(db, { type: "startContact", contactId }, officer, id, now);
    assert.ok(opened.id, opened.error);
    return opened.id;
  };
  const active = create("partner");
  const closed = create("closed");
  const read = (threadId, staff = admin) => readConversations(db, { type: "thread", id: threadId }, staff, id, now);
  const action = (threadId, type, fields, staff = officer) => changeConversation(db, {
    type, id: threadId, revision: read(threadId, staff).thread.revision, eventId: crypto.randomUUID(), ...fields,
  }, staff, id, now);
  assert.equal(action(closed, "resolve", { closed: true }).id, closed);
  const receive = (sender, at = now) => {
    const receipt = changeInboundReply(db, { type: "simulate", channel: "Email", sourceId: `reply-${sender}`,
      sender: `${sender}@example.test`, text: "Fictional partner reply" }, admin, id, at);
    const linked = changeInboundReply(db, { type: "attachContact", id: receipt.id, revision: 1, contactId: sender }, admin, id, at);
    assert.ok(linked.conversationId, linked.error);
    return receipt.id;
  };
  const receipt = receive("partner");
  assert.equal(action(active, "followUp", { dueOn: "2026-11-08" }).id, active);
  const due = (staff) => readOfficerQueue(db, { horizon: 1 }, staff, id, now).replies.items;
  assert.partialDeepStrictEqual(due(officer)[0], { id: active, unread: true, dueOn: "2026-11-08" });
  assert.equal(hasDepartureWork(db, officer.email, now), true);
  const open = preview(officer, "Contact conversation");
  assert.deepEqual(open.items.map(({ id, recordId, detail, due }) => [id, recordId, detail, due]),
    [[active, active, "Realtor · Needs reply · Unread", "2026-11-08"]]);
  const [row] = open.items;
  assert.match(move(officer, row, processor).error, /active loan officer or admin/);
  assert.match(move(officer, row, null).error, /active loan officer or admin/);
  assert.equal(action(active, "note", { text: "Last call before departure" }).id, active);
  assert.match(move(officer, row, admin).error, /item changed/);
  const current = preview(officer, "Contact conversation").items[0];
  const operationId = crypto.randomUUID();
  assert.match(move(officer, current, admin, { operationId }).message, /reply state and follow-up date/);
  assert.match(move(officer, current, admin, { operationId }).message, /no longer open/);
  assert.equal(hasDepartureWork(db, officer.email, now), false);
  assert.equal(due(officer).length, 0);
  assert.partialDeepStrictEqual(due(admin)[0], { id: active, unread: true, dueOn: "2026-11-08" });
  assert.ok(read(active, officer).error);
  const transferred = read(active);
  assert.equal(transferred.thread.owner, admin.name);
  assert.equal(transferred.thread.status, "Needs reply");
  assert.equal(transferred.thread.unread, true);
  assert.equal(transferred.thread.dueOn, "2026-11-08");
  assert.equal(transferred.events.filter((event) => event.text === "Assigned to Owner.").length, 1);
  assert.equal(transferred.events.filter((event) => event.text === "Fictional partner reply").length, 1);
  assert.equal(readInboundReplies(db, { type: "reply", id: receipt }, admin, id).reply.conversationId, active);
  assert.equal(db.prepare("SELECT count(*) AS total FROM workspace_access_history WHERE action = 'Reassigned contact conversation'").get().total, 1);

  assert.ok(revoke(officer).message);
  assert.deepEqual(activeBrokerages(db, officer.email, bootstrap), []);
  assert.equal(preview(officer, "Contact conversation").remaining, false);
  receive("closed", new Date(now.getTime() + 60_000));
  const recovery = preview(officer, "Contact conversation");
  assert.equal(recovery.member.status, "Revoked");
  assert.equal(recovery.items[0].id, closed);
  assert.ok(move(officer, recovery.items[0], admin).message);
  assert.equal(read(closed).thread.unread, true);
  assert.equal(preview(officer, "Contact conversation").remaining, false);
});

test("keeps the last admin, denies unrelated workspaces and roles, and pages stable open assignments", (t) => {
  const { db, id, admin, officer, processor, bootstrap, roster, member, preview, move, revoke, lead } = fixture(t);
  assert.equal(preview(admin).canRevoke, false);
  assert.equal(preview(admin).member.ownsFinancials, true);
  assert.match(revoke(admin).error, /at least one active admin/);
  assert.equal(roster(officer, admin), null);
  assert.equal(departureRoster(db, admin, "unrelated", bootstrap, officer.email), null);
  const query = { type: "offboardingPreview", filter: "All work", email: officer.email };
  assert.ok(departureWork(db, query, roster(admin, officer), officer, id, now).error);
  assert.ok(departureWork(db, query, roster(admin, officer), admin, "unrelated", now).error);
  for (let number = 0; number < 24; number += 1) lead(`lead-${String(number).padStart(2, "0")}`, officer);
  const first = preview(officer);
  db.prepare("INSERT INTO lead_follow_up (leadId, nextAt) VALUES ('lead-00', ?)").run(at);
  assert.equal(preview(officer).items[0].due, oldDue);
  assert.equal(preview(officer).items[0].dueLabel, "First contact due");
  const second = preview(officer, "All work", first.next);
  assert.deepEqual([first.items.length, second.items.length, second.next], [20, 4, null]);
  assert.equal(new Set([...first.items, ...second.items].map(({ id }) => id)).size, 24);
  assert.ok(move(officer, first.items[0], processor).error);
  const revision = member(officer).accessRevision;
  assert.ok(revoke(officer, revision).message);
  assert.ok(changeBrokerage(db, id, admin, bootstrap, { type: "invite", role: "LO", email: officer.email }).message);
  activateBrokerages(db, officer, bootstrap);
  assert.match(revoke(officer, revision).error, /access changed/);
  assert.ok(move(officer, first.items[0], admin, { memberRevision: revision }).error);
});

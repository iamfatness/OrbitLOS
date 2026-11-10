import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
      return next(`${specifier}.ts`, context);
    }
  },
});

const { executeCommand } = await import("../src/lib/commands.ts");
const { initializeStore, insertContact, insertLoan, insertSubmission, workspace } = await import("../src/lib/store.ts");
const { exportPilotPipeline } = await import("../src/lib/pipeline-export.ts");
const { reviewMigrationRecovery } = await import("../src/lib/migration-recovery.ts");
const { exportCutoverHandoff, lookupCutoverFile, readCutoverApplicationComparison, readCutoverFileInventory, readMigrationCutover,
  saveCutoverFileInventory, saveMigrationCutover } = await import("../src/lib/migration-cutover.ts");
const { cutoverReadinessLimit } = await import("../src/lib/migration-cutover-model.ts");
const { migrationFile, mappedMigrationRows, migrationFileByteLimit } = await import("../src/lib/pipeline-migration-model.ts");
const { optOutContact, optOutLead, outreachSuppressionKeys, prospectiveOptOutKeys } = await import("../src/lib/outreach-preferences.ts");
const { campaignCallNote, campaignCallQueues, campaignFollowUpRecipient, campaignFollowUpSource, campaignOrigin, campaignRehearsalCsv,
  nextCampaignCallId, parseCampaignLeadCsv, renderCampaignFollowUp } = await import("../src/lib/call-campaign-model.ts");
const { linkCampaignLead, recordCampaignCall } = await import("../src/lib/call-campaigns.ts");
const { enrollCampaignSequence, isCurrentSequenceCall, recordSequenceMock } = await import("../src/lib/campaign-sequences.ts");
const { updateInboxLead } = await import("../src/lib/lead-inbox.ts");
const { nextBorrowerContactTime } = await import("../src/lib/borrower-hours.ts");
const { campaignOptOutPlans } = await import("../src/lib/campaign-routing.ts");
const { borrowerCommandResult, startApplication } = await import("../src/lib/applications.ts");
const { sampleApplication } = await import("../src/lib/application-model.ts");
const { blankBorrower, blankLenderDetails } = await import("../src/lib/urla.ts");
const { easternDate } = await import("../src/lib/client-retention.ts");
const { readRecordHistory } = await import("../src/lib/record-history.ts");
const { campaignFollowUpWork, playbookWork } = await import("../src/lib/playbook-model.ts");
const { playbookRunWork } = await import("../src/lib/playbook-runs.ts");
const { changeConversation, readConversations } = await import("../src/lib/conversations.ts");
const { contactMergeWork } = await import("../src/lib/contact-merge.ts");
const { crmFieldWork } = await import("../src/lib/crm-fields.ts");
const { indexPendingContactOutreach, indexPendingRealtorReplies } = await import("../src/lib/outreach-preferences.ts");
const { readWorkspaceSearch } = await import("../src/lib/workspace-search.ts");
const { realtorReferrals } = await import("../src/lib/realtor-portal.ts");
const { readOfficerQueue } = await import("../src/lib/officer-queue.ts");
const { defaultManagerExceptionFilters, managerExceptions } = await import("../src/lib/manager-exception-model.ts");
const { readManagerExceptionWork } = await import("../src/lib/manager-exceptions.ts");
const { readMigrationRecord } = await import("../src/lib/migration-record.ts");
const { readEditableLead } = await import("../src/lib/editable-lead.ts");
const { applyCampaignMutation, applyCampaignNavigation, applyCampaignQueue, applyLeadMutation, applyLeadWork } = await import("../src/lib/lead-work-model.ts");
const { readCampaignCallbackPerformance } = await import("../src/lib/campaign-callback-performance.ts");
const { readCampaignCallbackExceptions } = await import("../src/lib/campaign-callback-exceptions.ts");
const { readCampaignManager } = await import("../src/lib/campaign-manager.ts");
const { readCampaignSequencePerformance } = await import("../src/lib/campaign-sequence-performance.ts");
const { defaultCampaignSequenceSteps } = await import("../src/lib/campaign-sequence-model.ts");
const { borrowerHttp } = await import("../src/lib/borrower-http.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = {
    exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql),
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
  const staff = { name: "Pilot admin", email: "admin@example.test",
    brokerage: { id: crypto.randomUUID(), name: "Fictional brokerage", role: "Admin", pilot: true } };
  return { db, staff };
}

test("CRM field matches drive segment previews without overriding outreach rules or existing borrower values", async (t) => {
  const { db, staff } = fixture(t);
  const fields = (input) => crmFieldWork(db, input, staff, staff.brokerage.id);
  const fieldId = crypto.randomUUID();
  const config = { type: "saveField", fieldId, revision: 0,
    definition: { label: "Outreach tier", kind: "Choice", options: ["Priority", "Standard"], roles: ["LO"] } };
  assert.equal(fields(config).kind, "savedField");
  const campaignId = crypto.randomUUID();
  const write = (input) => executeCommand(db, input, staff, undefined, [], { scopedLeadUpdates: true });
  assert.ok(!(await write({ type: "createCallCampaign", id: campaignId, name: "Fictional priority campaign" })).error);
  const segmentId = crypto.randomUUID();
  const segment = { type: "saveCrmSegment", id: segmentId, revision: 0, name: "Priority quiet leads", kind: "Quiet leads", quietDays: 7,
    customFilter: { fieldId, value: "Priority" } };
  assert.ok(!(await write(segment)).error);
  const at = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const [mine, blocked, standard] = ["0151", "0152", "0153"].map((suffix) => {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
      VALUES (?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?)`).run(id, id, `Fictional ${suffix}`, `qa-${suffix}@example.test`, `248555${suffix}`, staff.name, staff.email, at, at);
    return id;
  });
  const set = (record, recordId, value, revision = 0) =>
    fields({ type: "saveValue", record, recordId, fieldId, fieldRevision: 1, revision, value });
  assert.equal(set("lead", mine, "Priority").kind, "values");
  assert.equal(set("lead", blocked, "Priority").kind, "values");
  assert.equal(set("lead", standard, "Standard").kind, "values");
  assert.ok(!(await write({ type: "leadOptOut", leadId: blocked })).error);
  const enroll = { type: "enrollCrmSegment", segmentId, campaignId };
  const first = (await write(enroll)).segmentPreview;
  assert.deepEqual(first.rows.map(({ id, status }) => [id, status]), [[mine, "Eligible"], [blocked, "Opted out"]]);
  assert.equal(set("lead", mine, "Standard", 1).kind, "values");
  assert.match((await write({ ...enroll, fingerprint: first.fingerprint, selectedIds: [mine] })).error, /results changed/);
  assert.equal(set("lead", mine, "Priority", 2).kind, "values");
  const refreshed = (await write(enroll)).segmentPreview;
  assert.ok(!(await write({ ...enroll, fingerprint: refreshed.fingerprint, selectedIds: [mine] })).error);
  const converted = await write({ type: "convertReferral", referralId: mine, contactId: null });
  assert.ok(converted.referralLoanId, converted.error);
  const contactId = db.prepare("SELECT contactId FROM loans WHERE id = ?").get(converted.referralLoanId).contactId;
  assert.equal(fields({ type: "values", record: "contact", recordId: contactId }).entries[0].value, "Priority");
  assert.ok(fields({ type: "values", record: "lead", recordId: mine }).error);
  db.prepare("UPDATE referral_leads SET importedContactId = ? WHERE id = ?").run(contactId, standard);
  assert.ok((await write({ type: "convertReferral", referralId: standard, contactId: null })).referralLoanId);
  assert.equal(fields({ type: "values", record: "contact", recordId: contactId }).entries[0].value, "Priority");

  assert.equal(fields({ type: "archiveField", fieldId, revision: 1 }).kind, "archived");
  assert.match((await write(enroll)).error, /field is unavailable/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("CSV sequence progress survives a manager pause and retires on reply, conversion, opt-out or archive", async (t) => {
  const { db, staff } = fixture(t);
  const officer = { ...staff, name: "Fictional officer", email: "sequence-officer@example.test", brokerage: { ...staff.brokerage, role: "LO" } };
  const another = { ...officer, email: "another-officer@example.test" };
  const campaignId = crypto.randomUUID();
  const write = (data, actor = staff) => executeCommand(db, data, actor, undefined,
    [staff, officer, another].map((person) => ({ ...person, status: "Active" })), { scopedLeadUpdates: true });
  const apply = async (data, actor) => {
    const result = await write(data, actor);
    assert.ok(!result.error, result.error);
    return result;
  };
  await apply({ type: "createCallCampaign", id: campaignId, name: "Fictional sequences" });
  const steps = [{ channel: "Call", title: "Call new lead", delay: 0, body: "" },
    { channel: "Text", title: "First text", delay: 0, body: "Fictional text draft" },
    { channel: "Email", title: "Follow up", delay: 1, body: "Fictional email draft" }];
  const attach = { type: "saveCampaignSequence", campaignId, expectedVersion: null, expectedTemplateVersion: null, steps };
  assert.match((await write(attach, officer)).error, /admin/);
  assert.equal((await apply(attach)).campaignQueue.campaign.sequenceConfig.attachedVersion, 1);
  const csv = (indices) => ({ type: "migratePipeline", campaignId, origin: campaignOrigin(campaignId), decisions: {},
    rows: parseCampaignLeadCsv(["id,name,phone,email", ...indices.map((n) =>
      `${n},Fictional Sequence ${n},248555018${n},sequence-${n}@example.test`)].join("\n"), new Date().toISOString())
      .map((row) => ({ ...row, ownerEmail: officer.email })) });
  const importCsv = async (request) => {
    const preview = await apply(request);
    return apply({ ...request, preview: preview.migration.fingerprint });
  };
  const initial = csv([1, 2, 3]);
  const [replyLead, convertedLead, optedLead] = (await importCsv(initial)).migration.rows.map(({ targetId }) => targetId);
  assert.equal(db.prepare("SELECT count(*) AS count FROM campaign_sequence_enrollments").get().count, 3);
  assert.equal((await importCsv(initial)).migration.rows[0].targetId, replyLead);
  assert.equal(db.prepare("SELECT count(*) AS count FROM campaign_sequence_enrollments").get().count, 3);
  const update = { ...attach, expectedVersion: 1, expectedTemplateVersion: 1, steps: [steps[1]] };
  assert.equal((await apply(update)).campaignQueue.campaign.sequenceConfig.attachedVersion, 2);
  assert.match((await write(update)).error, /changed/);
  const [newLead] = (await importCsv(csv([4]))).migration.rows.map(({ targetId }) => targetId);
  const queue = (actor = officer, now = new Date()) => readOfficerQueue(db, { horizon: 7 }, actor, staff.brokerage.id, now).items;
  const stepFor = (id, actor, now) => queue(actor, now).find((item) => item.recordId === id && item.kind === "sequence");
  const revision = (id) => db.prepare("SELECT revision FROM lead_follow_up WHERE leadId = ?").get(id)?.revision ?? 0;
  const control = (leadId, action) => ({ type: "changeCampaignSequence", campaignId, leadId, action, revision: revision(leadId) });
  const report = (view) => readCampaignManager(db, { campaignId, view }, staff, staff.brokerage.id, new Date(Date.now() + 1000));
  const performance = (version, drilldown) => readCampaignSequencePerformance(db, { campaignId, version, drilldown }, staff, staff.brokerage.id);
  const callStep = stepFor(replyLead);
  assert.equal(callStep.sequence.version, 1);
  assert.equal(callStep.sequence.channel, "Call");
  assert.equal(stepFor(newLead).sequence.version, 2);
  assert.equal(stepFor(replyLead, another), undefined);
  assert.ok(!queue().some((item) => item.recordId === replyLead && item.kind === "lead"));
  const open = { leadId: replyLead, task: { kind: "sequence", id: callStep.id } };
  const { lead } = readEditableLead(db, open, officer, staff.brokerage.id);
  assert.ok(readEditableLead(db, open, another, staff.brokerage.id).error);
  const call = { type: "recordCampaignCall", campaignId, leadId: replyLead, revision: lead.followUp.revision,
    outcome: "Connected", callbackAt: null, note: "Fictional sequence call" };
  const pause = control(replyLead, "Pause");
  assert.match((await write(pause, officer)).error, /admin/);
  assert.ok((await write({ ...pause, campaignId: crypto.randomUUID() })).error);
  assert.equal((await apply(pause)).leadWork.member.sequence.paused, true);
  assert.equal(stepFor(replyLead), undefined);
  assert.ok(!queue().some((item) => item.recordId === replyLead && item.kind === "lead"));
  assert.ok(readEditableLead(db, open, officer, staff.brokerage.id).error);
  assert.ok((await write(call, officer)).error);
  assert.ok(!report("overdue").items.some(({ leadId }) => leadId === replyLead));
  assert.equal(report("paused").items[0].sequence.dueAt, callStep.dueAt);
  assert.equal((await apply(control(replyLead, "Resume"))).leadWork.member.sequence.paused, false);
  assert.ok((await write(pause)).error);
  assert.equal(stepFor(replyLead).id, callStep.id);
  assert.equal(stepFor(replyLead).dueAt, callStep.dueAt);
  await apply({ ...call, revision: revision(replyLead) }, officer);
  assert.ok(readEditableLead(db, open, officer, staff.brokerage.id).error);
  const { version, position, recipient } = stepFor(replyLead).sequence;
  const mock = { type: "recordSequenceMock", leadId: replyLead, version, position, recipient };
  assert.ok((await write(mock, another)).error);
  assert.ok((await write({ ...mock, recipient: "someone-else@example.test" }, officer)).error);
  const textStep = stepFor(replyLead);
  await apply(control(replyLead, "Pause"));
  assert.ok((await write(mock, officer)).error);
  assert.equal(stepFor(replyLead), undefined);
  await apply(control(replyLead, "Resume"));
  assert.equal(stepFor(replyLead).id, textStep.id);
  assert.equal(stepFor(replyLead).dueAt, textStep.dueAt);
  await apply(mock, officer);
  assert.ok((await write(mock, officer)).error);
  const scheduled = stepFor(replyLead);
  assert.equal(scheduled.sequence.channel, "Email");
  assert.ok(scheduled.dueAt > new Date().toISOString());
  assert.ok((await write({ ...mock, position: scheduled.sequence.position, recipient: scheduled.sequence.recipient }, officer)).error);
  await apply(control(replyLead, "Pause"));
  assert.equal(report("paused").items[0].sequence.dueAt, scheduled.dueAt);
  const thread = db.prepare("SELECT id, revision FROM lead_conversations WHERE leadId = ?").get(replyLead);
  assert.ok(changeConversation(db, { ...thread, type: "sampleReply", eventId: crypto.randomUUID() }, officer, staff.brokerage.id).id);
  assert.deepEqual(performance(1).steps.map(({ touches, replies }) => [touches, replies]), [[1, 0], [1, 0], [0, 0]]);
  const replyThread = db.prepare("SELECT id, revision FROM lead_conversations WHERE leadId = ?").get(replyLead);
  assert.ok(changeConversation(db, { ...replyThread, type: "message", direction: "Inbound", channel: "Email",
    text: "Fictional reply to the mock sequence", eventId: crypto.randomUUID() }, officer, staff.brokerage.id).id);
  assert.deepEqual(performance(1).steps.map(({ touches, replies }) => [touches, replies]), [[1, 0], [1, 1], [0, 0]]);
  assert.deepEqual(performance(1, { metric: "replies", position: 1 }).items.map(({ leadId }) => leadId), [replyLead]);
  await apply(control(convertedLead, "Pause"));
  await apply({ type: "convertReferral", referralId: convertedLead, contactId: null }, officer);
  await apply(control(optedLead, "Pause"));
  await apply({ type: "leadOptOut", leadId: optedLead }, officer);
  const ended = db.prepare("SELECT dueAt, outcome FROM campaign_sequence_enrollments WHERE leadId = ?");
  for (const [id, outcome] of [[replyLead, "Reply received"], [convertedLead, "Converted"], [optedLead, "Opted out"]]) {
    assert.deepEqual({ ...ended.get(id) }, { dueAt: null, outcome });
    assert.equal(stepFor(id), undefined);
    assert.ok((await write(control(id, "Resume"))).error);
  }
  assert.equal(report("paused").counts.paused, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM lead_events WHERE leadId = ? AND text LIKE 'Mock campaign follow-up%'").get(replyLead).count, 1);
  const [skippedLead] = (await importCsv(csv([6]))).migration.rows.map(({ targetId }) => targetId);
  db.prepare("UPDATE referral_leads SET phone = '' WHERE id = ?").run(skippedLead);
  await apply({ type: "recordSequenceMock", leadId: skippedLead, version: 2, position: 0, recipient: null }, officer);
  assert.equal(performance(2).steps[0].touches, 0);
  assert.equal((await apply({ ...update, expectedVersion: 2, expectedTemplateVersion: 2, steps: null })).campaignQueue.campaign.sequenceConfig.attachedVersion, null);
  assert.equal(stepFor(newLead).sequence.version, 2);
  const [afterDetach] = (await importCsv(csv([5]))).migration.rows.map(({ targetId }) => targetId);
  assert.equal(stepFor(afterDetach), undefined);
  await apply(control(newLead, "Pause"));
  await apply({ type: "dismissReferral", referralId: newLead, revision: revision(newLead) }, officer);
  assert.deepEqual({ ...ended.get(newLead) }, { dueAt: null, outcome: "Archived" });
  assert.ok((await write(control(newLead, "Resume"))).error);
});

test("borrower channel preferences skip campaign steps without recording touches and survive conversion", async (t) => {
  const { db, staff } = fixture(t);
  const officer = { ...staff, email: "channel-owner@example.test", brokerage: { ...staff.brokerage, role: "LO" } };
  const another = { ...officer, email: "another-officer@example.test" };
  const members = [staff, officer, another].map((person) => ({ ...person, status: "Active" }));
  const write = (input, actor = staff) => executeCommand(db, input, actor, undefined, members, { scopedLeadUpdates: true });
  const apply = async (input, actor) => {
    const result = await write(input, actor);
    assert.ok(!result.error, result.error);
    return result;
  };
  const campaignId = crypto.randomUUID();
  await apply({ type: "createCallCampaign", id: campaignId, name: "Fictional channel preferences" });
  await apply({ type: "saveCampaignSequence", campaignId, expectedVersion: null, expectedTemplateVersion: null,
    steps: [{ channel: "Call", title: "First call", delay: 0, body: "" },
      { channel: "Email", title: "First email", delay: 0, body: "Fictional email draft" },
      { channel: "Text", title: "First text", delay: 0, body: "Fictional text draft" },
      { channel: "Email", title: "Follow-up email", delay: 2, body: "Fictional email draft" }] });
  const request = { type: "migratePipeline", campaignId, origin: campaignOrigin(campaignId), decisions: {},
    rows: parseCampaignLeadCsv(`id,name,phone,email\nchannel-a,Fictional Channel A,2485550183,channel-a@example.test\nchannel-b,Fictional Channel B,2485550184,channel-b@example.test`,
      new Date().toISOString()).map((row) => ({ ...row, ownerEmail: officer.email })) };
  const preview = await apply(request);
  const [first, second] = (await apply({ ...request, preview: preview.migration.fingerprint })).migration.rows.map(({ targetId }) => targetId);
  const step = (id) => readOfficerQueue(db, { horizon: 7 }, officer, staff.brokerage.id).items.find((item) => item.kind === "sequence" && item.recordId === id);
  const revision = (id) => db.prepare("SELECT revision FROM lead_follow_up WHERE leadId = ?").get(id)?.revision ?? 0;
  const prefs = (id, expected, blocked, target = "lead") => ({ type: "saveBorrowerChannels", target, recordId: id, expected, blocked });
  const control = (leadId, action) => apply({ type: "changeCampaignSequence", campaignId, leadId, action, revision: revision(leadId) });
  const mock = (leadId) => {
    const { version, position, recipient } = step(leadId).sequence;
    return { type: "recordSequenceMock", leadId, version, position, recipient };
  };

  const call = step(first);
  assert.equal(call.sequence.channel, "Call");
  assert.ok((await write(prefs(first, 0, 3), another)).error);
  await apply(prefs(first, 0, 3), officer);
  assert.match((await write(prefs(first, 0, 1), officer)).error, /preferences changed/);
  assert.equal(step(first).sequence.channel, "Text");
  assert.equal(step(first).dueAt, call.dueAt);
  assert.ok(readEditableLead(db, { leadId: first, task: { kind: "sequence", id: call.id } }, officer, staff.brokerage.id).error);
  assert.match((await write({ type: "recordCampaignCall", campaignId, leadId: first, revision: revision(first),
    outcome: "Connected", callbackAt: null, note: "Fictional blocked call" }, officer)).error, /blocks/i);
  await apply(mock(first), officer);
  assert.equal(step(first), undefined);
  const touches = db.prepare("SELECT position FROM campaign_sequence_touches WHERE leadId = ?").all(first);
  assert.deepEqual(touches.map(({ position }) => position), [2]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM lead_events WHERE leadId = ? AND text LIKE '%Skipped step%'").get(first).count, 3);

  await control(second, "Pause");
  await apply(prefs(second, 0, 1));
  assert.equal(db.prepare("SELECT position FROM campaign_sequence_enrollments WHERE leadId = ?").get(second).position, 0);
  await control(second, "Resume");
  assert.equal(step(second).sequence.channel, "Email");
  const staleDraft = mock(second);
  await apply(prefs(second, 1, 3));
  assert.ok((await write(staleDraft, officer)).error);
  assert.equal(step(second).sequence.channel, "Text");
  await apply(prefs(second, 3, 7));
  assert.equal(step(second), undefined);
  const conversion = await apply({ type: "convertReferral", referralId: second, contactId: null }, officer);
  const contactId = db.prepare("SELECT contactId FROM loans WHERE id = ?").get(conversion.referralLoanId).contactId;
  assert.equal(db.prepare("SELECT blocked FROM borrower_contact_channels WHERE contactId = ?").get(contactId).blocked, 7);
  await apply(prefs(contactId, 7, 5, "contact"), officer);
  assert.equal(db.prepare("SELECT blocked FROM borrower_contact_channels WHERE contactId = ?").get(contactId).blocked, 5);
});

test("the borrower portal updates only its contact, skips linked outreach, and records the exact changes for staff", async (t) => {
  const { db, staff } = fixture(t);
  const now = new Date().toISOString();
  const owner = { ...staff, email: "portal-owner@example.test", brokerage: { ...staff.brokerage, role: "LO" } };
  const other = { ...owner, email: "portal-other@example.test" };
  const add = (name, email, phone) => {
    const id = crypto.randomUUID();
    const loanId = crypto.randomUUID();
    insertContact(db, { id, name, email, phone, role: "Borrower" });
    insertLoan(db, { id: loanId, contactId: id, officer: owner.name, officerEmail: owner.email, partnerId: null,
      stage: "Lead", stageSince: now, amount: 250000, purpose: "Purchase", address: "" });
    assert.equal(startApplication(db, loanId, now, staff.brokerage.id), true);
    return { id, loanId, token: db.prepare("SELECT token FROM applications WHERE loanId = ?").get(loanId).token };
  };
  const borrower = add("Fictional Portal Borrower", "portal-borrower@example.test", "2485550181");
  const another = add("Fictional Other Borrower", "portal-other-borrower@example.test", "2485550182");
  const command = (input) => borrowerCommandResult(db, { token: borrower.token, ...input });
  const preferences = { type: "contactPreferences" };
  const save = (expected, blocked) => ({ type: "saveContactPreferences", expected, blocked });
  const draftBefore = command({ type: "read" }).application;
  const apply = async (input) => {
    const result = await executeCommand(db, input, staff, undefined, [staff, owner], { scopedLeadUpdates: true });
    assert.ok(!result.error, result.error);
    return result;
  };
  const campaignId = crypto.randomUUID();
  await apply({ type: "createCallCampaign", id: campaignId, name: "Fictional portal preferences" });
  await apply({ type: "saveCampaignSequence", campaignId, expectedVersion: null, expectedTemplateVersion: null,
    steps: [{ channel: "Call", title: "First call", delay: 0, body: "" },
      { channel: "Text", title: "First text", delay: 0, body: "Fictional text" },
      { channel: "Email", title: "First email", delay: 0, body: "Fictional email" }] });
  const request = { type: "migratePipeline", campaignId, origin: campaignOrigin(campaignId), decisions: {},
    rows: parseCampaignLeadCsv("id,name,phone,email\nreturning,Fictional Portal Borrower,2485550181,portal-borrower@example.test", now)
      .map((row) => ({ ...row, ownerEmail: owner.email })) };
  const imported = await apply({ ...request, preview: (await apply(request)).migration.fingerprint });
  const leadId = imported.migration.rows[0].targetId;
  assert.equal(db.prepare("SELECT importedContactId FROM referral_leads WHERE id = ?").get(leadId).importedContactId, borrower.id);
  const next = () => readOfficerQueue(db, { horizon: 7 }, owner, staff.brokerage.id).items.find(({ recordId, kind }) => recordId === leadId && kind === "sequence");
  assert.equal(next().sequence.channel, "Call");

  const url = "https://orbit.example.test/api/demo-application";
  const http = (input, origin = "https://orbit.example.test") => borrowerHttp(new Request(url, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, token: borrower.token }),
  }), async (input) => borrowerCommandResult(db, input));
  assert.equal((await http(save(0, 5), "https://other.example.test")).status, 403);
  const result = await http(save(0, 5));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await result.json(), { blocked: 5, optedOut: false });
  assert.deepEqual(command(save(0, 5)), { preferences: { blocked: 5, optedOut: false } });
  assert.equal(command(save(0, 2)).status, 409);
  assert.equal(command({ ...save(5, 2), contactId: another.id }).status, 400);
  assert.deepEqual(command({ ...preferences, token: another.token }), { preferences: { blocked: 0, optedOut: false } });
  assert.deepEqual(command({ type: "read" }).application, draftBefore);
  assert.equal(next().sequence.channel, "Email");
  assert.equal(db.prepare("SELECT count(*) AS count FROM campaign_sequence_touches").get().count, 0);

  const history = (record, id, actor = owner) => readRecordHistory(db, actor, { record, id });
  for (const [record, id] of [["loan", borrower.loanId], ["contact", borrower.id]]) {
    const events = history(record, id).events.filter(({ text }) => text.startsWith("Borrower updated contact preferences"));
    assert.equal(events.length, 1);
    assert.equal(events[0].text, "Borrower updated contact preferences · Calls blocked · Texts blocked");
    assert.ok(events[0].createdAt >= now);
    assert.ok(history(record, id, other).error);
  }
  assert.deepEqual(command(save(5, 4)), { preferences: { blocked: 4, optedOut: false } });
  assert.ok(history("contact", borrower.id).events.some(({ text }) => text === "Borrower updated contact preferences · Calls allowed"));
  assert.equal(next().sequence.channel, "Email");
  optOutContact(db, borrower.id, now);
  assert.deepEqual(command(preferences), { preferences: { blocked: 4, optedOut: true } });
  assert.equal(command(save(4, 0)).status, 409);
  db.prepare("UPDATE applications SET revokedAt = ? WHERE loanId = ?").run(now, borrower.loanId);
  db.prepare("UPDATE applications SET expiresAt = ? WHERE loanId = ?").run(now, another.loanId);
  assert.equal(command(preferences).status, 404);
  assert.equal(command({ ...save(0, 7), token: another.token }).status, 404);
});

test("preferred contact hours use local time across DST gaps, repeated hours, and half-hour offsets", () => {
  const pacific = { start: "09:00", end: "17:00", timeZone: "America/Los_Angeles" };
  assert.equal(nextBorrowerContactTime("2026-03-07T17:00:00.000Z", pacific), "2026-03-07T17:00:00.000Z");
  assert.equal(nextBorrowerContactTime("2026-03-08T01:00:00.000Z", pacific), "2026-03-08T16:00:00.000Z");
  const spring = { ...pacific, start: "02:30", end: "03:30" };
  assert.equal(nextBorrowerContactTime("2026-03-08T09:30:00.000Z", spring), "2026-03-08T10:00:00.000Z");
  assert.equal(nextBorrowerContactTime("2026-03-08T09:30:00.000Z", { ...spring, end: "02:50" }), "2026-03-09T09:30:00.000Z");
  assert.equal(nextBorrowerContactTime("2026-11-01T08:50:00.000Z", { ...pacific, start: "01:15", end: "01:45" }),
    "2026-11-01T09:15:00.000Z");
  assert.equal(nextBorrowerContactTime("2026-06-01T02:00:00.000Z", { ...pacific, timeZone: "Asia/Kolkata" }), "2026-06-01T03:30:00.000Z");
});

test("preferred contact hours choose weekdays and weekends using the borrower's local date", () => {
  const hours = { start: "17:00", end: "19:00", timeZone: "America/Los_Angeles", weekend: { start: "10:00", end: "12:00" } };
  // Already Saturday in UTC, but still Friday and within weekday hours in California.
  assert.equal(nextBorrowerContactTime("2026-07-11T01:00:00.000Z", hours), "2026-07-11T01:00:00.000Z");
  assert.equal(nextBorrowerContactTime("2026-07-11T02:00:00.000Z", hours), "2026-07-11T17:00:00.000Z");
  assert.equal(nextBorrowerContactTime("2026-07-12T18:59:59.999Z", hours), "2026-07-12T18:59:59.999Z");
  assert.equal(nextBorrowerContactTime("2026-07-12T19:00:00.000Z", hours), "2026-07-14T00:00:00.000Z");
  const spring = { ...hours, weekend: { start: "02:30", end: "03:30" } };
  assert.equal(nextBorrowerContactTime("2026-03-08T09:30:00.000Z", spring), "2026-03-08T10:00:00.000Z");
  assert.equal(nextBorrowerContactTime("2026-03-08T10:30:00.000Z", spring), "2026-03-10T00:00:00.000Z");
});

test("portal contact hours defer campaign calls and mock email and text, even after a window closes", async (t) => {
  const { db, staff } = fixture(t);
  const contactId = crypto.randomUUID();
  const loanId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const at = "2099-07-06T12:00:00.000Z";
  const contact = { id: contactId, name: "Fictional local hours", email: "local-hours@example.test", phone: "2485550185", role: "Borrower" };
  insertContact(db, contact);
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: staff.name, officerEmail: staff.email,
    stage: "Lead", stageSince: at, amount: 250000, purpose: "Purchase", address: "" });
  assert.ok(startApplication(db, loanId, new Date().toISOString(), staff.brokerage.id));
  const { token } = db.prepare("SELECT token FROM applications WHERE loanId = ?").get(loanId);
  const hours = { start: "16:00", end: "18:00", timeZone: "America/Los_Angeles" };
  const save = (expected, value) => borrowerCommandResult(db, { type: "saveContactPreferences", token, expected: 0, blocked: 0,
    hours: { expected, value } });
  const steps = [{ channel: "Call", title: "Call at local time", delay: 0, body: "" },
    { channel: "Text", title: "Text at local time", delay: 1, body: "Fictional text" }];
  assert.ok(!(await executeCommand(db, { type: "createCallCampaign", id: campaignId, name: "Fictional preferred hours" }, staff)).error);
  assert.ok(!(await executeCommand(db, { type: "saveCampaignSequence", campaignId, expectedVersion: null,
    expectedTemplateVersion: null, steps }, staff)).error);
  const addLead = () => {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, importedContactId)
      VALUES (?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?, ?)`)
      .run(id, id, contact.name, contact.email, contact.phone, staff.name, staff.email, at, at, contactId);
    return id;
  };
  const campaignLead = addLead();
  assert.ok(!linkCampaignLead(db, campaignId, campaignLead, at).error);
  const template = { kind: "New Lead", version: 1, steps };
  enrollCampaignSequence(db, campaignLead, template, at);
  const queue = (when) => readOfficerQueue(db, { horizon: 7 }, staff, staff.brokerage.id, new Date(when)).items;
  const step = (when, lead = campaignLead) => queue(when).find(({ kind, recordId }) => kind === "sequence" && recordId === lead);
  const revision = (id) => db.prepare("SELECT revision FROM lead_follow_up WHERE leadId = ?").get(id)?.revision ?? 0;
  const opened = "2099-07-06T23:00:00.000Z";
  assert.equal(step(at).dueAt, at);
  assert.equal(save(null, { ...hours, timeZone: "+01:00" }).status, 400);
  assert.equal(save(null, { ...hours, start: "19:00" }).status, 400);
  assert.deepEqual(save(null, hours).preferences.hours, hours);
  assert.equal(step(at).dueAt, opened);
  assert.ok(!queue(at).some(({ kind, recordId }) => kind === "lead" && recordId === campaignLead));
  assert.equal(save(null, { ...hours, end: "19:00" }).status, 409);
  assert.deepEqual(save(hours, null).preferences, { blocked: 0, optedOut: false });
  assert.equal(step(at).dueAt, at);
  assert.deepEqual(save(null, hours).preferences.hours, hours);
  assert.equal(step(at).dueAt, opened);
  assert.ok(readRecordHistory(db, staff, { record: "contact", id: contactId }).events.some(({ text }) =>
    text === "Borrower updated contact preferences · Preferred contact hours 16:00–18:00 (America/Los Angeles)"));

  const enrolled = addLead();
  assert.ok(!linkCampaignLead(db, campaignId, enrolled, at).error);
  enrollCampaignSequence(db, enrolled, template, at);
  assert.equal(step(at, enrolled).dueAt, opened);
  const call = { campaignId, leadId: campaignLead, revision: revision(campaignLead), outcome: "Connected", note: "", callbackAt: null };
  assert.equal(isCurrentSequenceCall(db, campaignLead, step(at).id, at), false);
  assert.match(recordCampaignCall(db, staff, call, at).error, /preferred hours/);
  assert.equal(isCurrentSequenceCall(db, campaignLead, step(opened).id, opened), true);
  assert.ok(!recordCampaignCall(db, staff, call, opened).error);
  const textAt = "2099-07-07T23:00:00.000Z";
  assert.equal(step(opened).dueAt, textAt);
  const missed = "2099-07-08T01:00:00.000Z";
  const resumedAt = "2099-07-08T23:00:00.000Z";
  const text = step(missed).sequence;
  assert.equal(text.waitUntil, resumedAt);
  const mock = { leadId: campaignLead, position: text.position, version: text.version, recipient: text.recipient };
  assert.match(recordSequenceMock(db, staff, mock, missed).error, /preferred contact window/);
  assert.ok(!recordSequenceMock(db, staff, mock, resumedAt).error);

  const inboxLead = addLead();
  const inbox = (action, time) => updateInboxLead(db, staff, { type: "leadSequence", leadId: inboxLead, revision: revision(inboxLead), action }, [], time);
  assert.ok(!inbox("Start", at).error);
  assert.equal(db.prepare("SELECT nextAt FROM lead_follow_up WHERE leadId = ?").get(inboxLead).nextAt, opened);
  assert.match(inbox("Mock send", "2099-07-07T01:00:00.000Z").error, /preferred contact window/);
  assert.ok(!inbox("Mock send", textAt).error);

  const weekend = { start: "10:00", end: "12:00" };
  const split = { ...hours, weekend };
  assert.equal(save(hours, { ...hours, weekend: { start: "12:00", end: "10:00" } }).status, 400);
  assert.deepEqual(save(hours, { ...hours, weekend: { start: hours.start, end: hours.end } }).preferences.hours, hours);
  assert.deepEqual(save(hours, split).preferences.hours, split);
  assert.equal(save(hours, { ...hours, end: "19:00" }).status, 409);
  assert.ok(readRecordHistory(db, staff, { record: "contact", id: contactId }).events.some(({ text }) =>
    text === "Borrower updated contact preferences · Preferred contact hours Weekdays 16:00–18:00 · Weekends 10:00–12:00 (America/Los Angeles)"));

  const fridayClose = "2099-07-11T01:00:00.000Z";
  const saturdayOpen = "2099-07-11T17:00:00.000Z";
  const weekendLead = addLead();
  assert.ok(!linkCampaignLead(db, campaignId, weekendLead, fridayClose).error);
  enrollCampaignSequence(db, weekendLead, template, fridayClose);
  assert.equal(step(fridayClose, weekendLead).dueAt, saturdayOpen);
  const weekendCall = { ...call, leadId: weekendLead, revision: revision(weekendLead) };
  assert.match(recordCampaignCall(db, staff, weekendCall, fridayClose).error, /preferred hours/);
  assert.ok(!recordCampaignCall(db, staff, weekendCall, saturdayOpen).error);
  const sundayClose = "2099-07-12T19:00:00.000Z";
  const mondayOpen = "2099-07-13T23:00:00.000Z";
  assert.equal(step(saturdayOpen, weekendLead).dueAt, mondayOpen);
  assert.match(inbox("Mock send", sundayClose).error, /preferred contact window/);
  assert.ok(!inbox("Mock send", mondayOpen).error);
});

test("reusable reactivation and past-client sequences enroll the right audiences and keep their versions in Today", async (t) => {
  const { db, staff } = fixture(t);
  const officer = { ...staff, name: "Fictional outreach LO", email: "outreach-lo@example.test", brokerage: { ...staff.brokerage, role: "LO" } };
  const [cold, reused, past] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const write = (input, actor = staff) => executeCommand(db, input, actor, undefined,
    [staff, officer].map((member) => ({ ...member, status: "Active" })), { scopedLeadUpdates: true });
  const apply = async (input, actor) => {
    const result = await write(input, actor);
    assert.ok(!result.error, result.error);
    return result;
  };
  for (const [id, name] of [[cold, "Fictional cold outreach"], [reused, "Fictional reused outreach"], [past, "Fictional past clients"]]) {
    const created = await apply({ type: "createCallCampaign", id, name });
    assert.equal(created.campaignQueue.campaign.sequenceConfig.attachedKind, null);
  }
  const attach = (campaignId, kind, expectedVersion = null, expectedTemplateVersion = null, steps = defaultCampaignSequenceSteps[kind]) =>
    ({ type: "saveCampaignSequence", campaignId, kind, expectedVersion, expectedTemplateVersion, steps });
  assert.match((await write(attach(cold, "Cold Lead Reactivation"), officer)).error, /admin/);
  const attachCold = await apply(attach(cold, "Cold Lead Reactivation"));
  const attachReused = await apply(attach(reused, "Cold Lead Reactivation", null, 1));
  assert.equal(attachReused.campaignQueue.campaign.sequenceConfig.attachedVersion, attachCold.campaignQueue.campaign.sequenceConfig.attachedVersion);
  await apply(attach(past, "Past Client Outreach"));
  await apply({ type: "saveCampaignRouting", campaignId: past, revision: 0, enabled: true, officers: [{ email: officer.email, limit: 5 }] });

  const old = new Date(Date.now() - 15 * 86_400_000).toISOString();
  const quietLead = crypto.randomUUID();
  db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
    VALUES (?, ?, 'Fictional dormant lead', 'dormant@example.test', '2485550141', 'Purchase', ?, ?, ?, ?)`)
    .run(quietLead, quietLead, officer.name, officer.email, old, old);
  const quietSegment = crypto.randomUUID();
  const pastSegment = crypto.randomUUID();
  await apply({ type: "saveCrmSegment", id: quietSegment, revision: 0, name: "Quiet outreach QA", kind: "Quiet leads", quietDays: 7 });
  await apply({ type: "saveCrmSegment", id: pastSegment, revision: 0, name: "Past clients QA", kind: "Past clients", quietDays: 7 });
  const enrollment = (campaignId, segmentId) => ({ type: "enrollCrmSegment", campaignId, segmentId });
  assert.match((await write(enrollment(cold, pastSegment))).error, /Past Client Outreach/);
  const stale = await apply(enrollment(cold, quietSegment));
  assert.deepEqual(stale.segmentPreview.sequence, { kind: "Cold Lead Reactivation", version: 1 });
  const revised = defaultCampaignSequenceSteps["Cold Lead Reactivation"].map((step, i) => i === 0 ? { ...step, title: "Reconnect about your mortgage" } : step);
  const edited = await apply(attach(cold, "Cold Lead Reactivation", 1, 1, revised));
  assert.equal(edited.campaignQueue.campaign.sequenceConfig.latest["Past Client Outreach"].version, 2);
  assert.match((await write({ ...enrollment(cold, quietSegment), fingerprint: stale.segmentPreview.fingerprint, selectedIds: [quietLead] })).error, /results changed/);
  const quiet = await apply(enrollment(reused, quietSegment));
  const quietResult = await apply({ ...enrollment(reused, quietSegment), fingerprint: quiet.segmentPreview.fingerprint, selectedIds: [quietLead] });
  assert.equal(quietResult.campaignWork.inboxLeads[0].officerEmail, officer.email);
  await apply(attach(reused, "Cold Lead Reactivation", 1, 3, revised));

  function funded(name, phone) {
    const id = crypto.randomUUID();
    insertContact(db, { id, name, email: `${name.toLowerCase().replaceAll(" ", "-")}@example.test`, phone, role: "Borrower" });
    insertLoan(db, { id: crypto.randomUUID(), contactId: id, partnerId: null, officer: officer.name, officerEmail: officer.email,
      address: "", amount: 300000, purpose: "Purchase", stage: "Funded", stageSince: old });
    return id;
  }
  const returningContact = funded("Fictional past client", "2485550142");
  const suppressed = funded("Fictional suppressed client", "2485550143");
  const unselected = funded("Fictional unselected client", "2485550145");
  optOutContact(db, suppressed, old);
  const pastPreview = (await apply(enrollment(past, pastSegment))).segmentPreview;
  assert.deepEqual(pastPreview.sequence, { kind: "Past Client Outreach", version: 2 });
  assert.equal(pastPreview.eligible, 2);
  assert.equal(pastPreview.rows.find(({ name }) => name === "Fictional suppressed client").status, "Opted out");
  const selectedPastId = pastPreview.rows.find(({ name }) => name === "Fictional past client").id;
  const applyPast = { ...enrollment(past, pastSegment), fingerprint: pastPreview.fingerprint, selectedIds: [selectedPastId] };
  const pastResult = await apply(applyPast);
  const [returning] = pastResult.campaignWork.inboxLeads;
  assert.equal(returning.importedContactId, returningContact);
  assert.equal(returning.officerEmail, officer.email);
  assert.equal(returning.purpose, "Refinance");
  assert.equal(db.prepare("SELECT 1 FROM referral_leads WHERE importedContactId = ?").get(unselected), undefined);
  assert.match((await write(applyPast)).error, /results changed/);

  const queue = () => readOfficerQueue(db, { horizon: 7 }, officer, staff.brokerage.id).items;
  const next = (id) => queue().find((item) => item.recordId === id && item.kind === "sequence");
  assert.match(next(quietLead).title, /^Cold Lead Reactivation · Still considering/);
  assert.equal(next(quietLead).sequence.version, 1);
  assert.match(next(returning.id).title, /^Past Client Outreach · Check in/);
  assert.equal(next(returning.id).sequence.version, 2);
  assert.ok(!queue().some((item) => [quietLead, returning.id].includes(item.recordId) && item.kind === "lead"));
  const { version, position, recipient } = next(quietLead).sequence;
  await apply({ type: "recordSequenceMock", leadId: quietLead, version, position, recipient }, officer);
  assert.equal(next(quietLead).sequence.channel, "Call");
  assert.deepEqual(readCampaignSequencePerformance(db, { campaignId: reused }, staff, staff.brokerage.id).versions,
    [{ kind: "Cold Lead Reactivation", version: 1, enrolled: 1 }]);
  const csv = { type: "migratePipeline", campaignId: cold, origin: campaignOrigin(cold), decisions: {},
    rows: parseCampaignLeadCsv("id,name,phone,email\nnew-cold,Fictional imported reactivation,2485550144,cold-import@example.test", new Date().toISOString())
      .map((row) => ({ ...row, ownerEmail: officer.email })) };
  const imported = await apply({ ...csv, preview: (await apply(csv)).migration.fingerprint });
  assert.equal(next(imported.migration.rows[0].targetId).sequence.version, 3);
  assert.match(next(imported.migration.rows[0].targetId).title, /Reconnect about your mortgage/);
});

test("segment enrollment requires a current selection and enrolls only the chosen eligible borrowers across pages", async (t) => {
  const { db, staff } = fixture(t);
  const campaignId = crypto.randomUUID();
  const segmentId = crypto.randomUUID();
  const send = (input, actor = staff) => executeCommand(db, input, actor, undefined, [staff], { scopedLeadUpdates: true });
  const apply = async (input) => {
    const result = await send(input);
    assert.ok(!result.error, result.error);
    return result;
  };
  await apply({ type: "createCallCampaign", id: campaignId, name: "Selective segment QA" });
  await apply({ type: "saveCrmSegment", id: segmentId, revision: 0, name: "Dormant borrowers", kind: "Quiet leads", quietDays: 7 });
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const insert = db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, createdAt, dueAt, heldAt)
    VALUES (?, ?, ?, ?, ?, 'Purchase', '', ?, ?, ?)`);
  const ids = Array.from({ length: 103 }, (_, index) => {
    const id = crypto.randomUUID();
    insert.run(id, id, `Fictional borrower ${index}`, `borrower-${index}@example.test`, `248555${String(index + 100).padStart(4, "0")}`,
      old, old, index === 102 ? old : null);
    return id;
  });
  const request = { type: "enrollCrmSegment", campaignId, segmentId };
  const first = (await apply(request)).segmentPreview;
  const second = (await apply({ ...request, previewPage: 2 })).segmentPreview;
  assert.deepEqual([first.eligible, first.excluded, first.page, first.pages], [102, 1, 1, 2]);
  assert.deepEqual([second.rows.length, second.page, second.pages], [2, 2, 2]);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.rows.find(({ id }) => id === ids[102]).status, "Lead on hold");
  const commit = { ...request, fingerprint: first.fingerprint };
  const fromFirst = first.rows[0].id;
  const fromSecond = second.rows[0].id;
  for (const selectedIds of [undefined, [], [fromFirst, fromFirst], [fromFirst, ids[102]], [crypto.randomUUID()]]) {
    assert.ok((await send({ ...commit, selectedIds })).error);
  }
  assert.ok((await send({ ...request, selectedIds: [fromFirst] })).error);
  assert.match((await send({ ...commit, selectedIds: [fromFirst] }, { ...staff, brokerage: { ...staff.brokerage, role: "LO" } })).error, /admin/);
  assert.equal(db.prepare("SELECT count(*) AS total FROM call_campaign_members").get().total, 0);
  const valid = { ...commit, selectedIds: [fromFirst, fromSecond] };
  const enrolled = await apply(valid);
  assert.deepEqual(new Set(enrolled.campaignWork.callCampaignMembers.map(({ leadId }) => leadId)), new Set([fromFirst, fromSecond]));
  assert.match((await send(valid)).error, /results changed/);
  const remaining = (await apply(request)).segmentPreview;
  assert.equal(remaining.eligible, 100);
  assert.ok(remaining.rows.some(({ id, status }) => id === second.rows[1].id && status === "Eligible"));
});

test("migration results follow the current lead, loan and exact evidence behind a receipt", async (t) => {
  const { db, staff } = fixture(t);
  const at = "2026-11-09T15:00:00.000Z";
  const origin = "record-review";
  const input = { type: "migratePipeline", origin, decisions: {}, rows: [
    { type: "Contact", externalId: "buyer", name: "Fictional Borrower", role: "Borrower", email: "buyer@example.test", phone: "" },
    { type: "Lead", externalId: "lead", parentId: "buyer", name: "Fictional Borrower", email: "buyer@example.test", phone: "",
      ownerEmail: "", purpose: "Purchase", source: "Imported CRM", zip: "", createdAt: at, dueAt: at },
    { type: "Note", externalId: "note", parentId: "lead", createdAt: at, text: "Fictional outreach evidence" },
    { type: "Task", externalId: "follow-up", parentId: "lead", dueAt: at, completedAt: "", text: "Follow up with borrower" },
  ] };
  const write = (value) => executeCommand(db, value, staff, undefined, [], { scopedMigrationUpdates: true });
  const preview = await write(input);
  assert.equal(preview.state, undefined);
  assert.equal(preview.migrationChanged, false);
  const query = (row) => ({ type: "result", origin, key: row.key, targetId: row.targetId });
  const lookup = (row, actor = staff) => readMigrationRecord(db, query(row), actor);
  assert.ok(lookup(preview.migration.rows[0]).error);
  const imported = await write({ ...input, preview: preview.migration.fingerprint });
  assert.equal(imported.migrationChanged, true);
  assert.equal(imported.state, undefined);
  const [contact, lead, note, task] = imported.migration.rows;
  assert.deepEqual(lookup(contact).destination, { kind: "contact", id: contact.targetId });
  assert.deepEqual(lookup(lead).destination, { kind: "lead", id: lead.targetId });
  assert.equal(lookup(note).evidence.text, "Fictional outreach evidence");
  assert.equal(lookup(task).evidence.dueAt, at);
  const { imports: [receipt] } = reviewMigrationRecovery(db, staff);
  const receiptQuery = { type: "receipt", origin, key: lead.key, receiptId: receipt.id };
  assert.deepEqual(readMigrationRecord(db, receiptQuery, staff).destination, lookup(lead).destination);
  assert.ok(readMigrationRecord(db, { ...receiptQuery, origin: "another-source" }, staff).error);
  assert.ok(lookup(lead, { ...staff, brokerage: { ...staff.brokerage, role: "LO" } }).error);
  assert.ok(lookup(lead, { ...staff, brokerage: { ...staff.brokerage, pilot: false } }).error);

  db.prepare("UPDATE referral_leads SET archiveToken = ?, resolvedAt = ? WHERE id = ?").run(crypto.randomUUID(), at, lead.targetId);
  assert.deepEqual(lookup(lead).destination, { kind: "archivedLead", id: lead.targetId });
  const loanId = crypto.randomUUID();
  insertLoan(db, { id: loanId, contactId: contact.targetId, partnerId: null, officer: staff.name, officerEmail: staff.email, stage: "Lead",
    stageSince: at, address: "", amount: 0, purpose: "Purchase" });
  db.prepare("UPDATE referral_leads SET loanId = ?, archiveToken = NULL WHERE id = ?").run(loanId, lead.targetId);
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, 'Current loan activity', ?)").run(note.targetId, loanId, at);
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, completedAt) VALUES (?, ?, 'Current loan task', ?, ?)")
    .run(task.targetId, loanId, at, at);
  assert.deepEqual(lookup(lead).destination, { kind: "loan", id: loanId, target: "loan-application" });
  assert.equal(lookup(note).destination.target, "loan-activity");
  assert.equal(lookup(note).evidence.text, "Current loan activity");
  assert.equal(lookup(task).destination.id, loanId);
  assert.equal(lookup(task).evidence.completedAt, at);
});

test("undo and correction keep an old receipt from opening a replacement record", async (t) => {
  const { db, staff } = fixture(t);
  const origin = "correction-review";
  const input = { type: "migratePipeline", origin, decisions: {},
    rows: [{ type: "Contact", externalId: "buyer", name: "Fictional Borrower", role: "Borrower", email: "undo@example.test", phone: "" }] };
  const write = (value) => executeCommand(db, value, staff, undefined, [], { scopedMigrationUpdates: true });
  const preview = await write(input);
  const committed = await write({ ...input, preview: preview.migration.fingerprint });
  const row = committed.migration.rows[0];
  const { imports: [receipt] } = reviewMigrationRecovery(db, staff);
  const recovery = reviewMigrationRecovery(db, staff, receipt.id).preview;
  const request = { type: "receipt", origin, key: row.key, receiptId: receipt.id };
  assert.equal(recovery.rows[0].canOpen, true);
  assert.ok(readMigrationRecord(db, request, staff).destination);
  const undone = await write({ type: "undoMigration", importId: receipt.id, fingerprint: recovery.fingerprint, confirmed: true });
  assert.equal(undone.migrationChanged, true);
  assert.equal(undone.state, undefined);
  assert.equal(reviewMigrationRecovery(db, staff, receipt.id).preview.rows[0].canOpen, false);
  assert.ok(readMigrationRecord(db, request, staff).error);
  const correction = { ...input, correctionKeys: [row.key] };
  const correctionPreview = await write(correction);
  const corrected = await write({ ...correction, preview: correctionPreview.migration.fingerprint });
  const replacement = corrected.migration.rows[0].targetId;
  assert.notEqual(replacement, row.targetId);
  assert.ok(readMigrationRecord(db, request, staff).error);
  assert.deepEqual(readMigrationRecord(db, { type: "result", origin, key: row.key, targetId: replacement }, staff).destination,
    { kind: "contact", id: replacement });
});

async function campaignRecoveryFixture(t) {
  const { db, staff } = fixture(t);
  const officer = { ...staff, name: "Second pilot LO", email: "lo@example.test", brokerage: { ...staff.brokerage, role: "LO" } };
  const send = (input, actor = staff) => executeCommand(db, input, actor, undefined, [staff, officer]);
  const apply = async (input, actor = staff) => {
    const result = await send(input, actor);
    assert.ok(result.state, result.error);
    return result.state;
  };
  const campaignId = crypto.randomUUID();
  await apply({ type: "loadCampaignRehearsal", id: campaignId });
  const request = { type: "migratePipeline", origin: campaignOrigin(campaignId), campaignId,
    rows: parseCampaignLeadCsv(campaignRehearsalCsv, new Date().toISOString()), decisions: {} };
  const preview = await send(request);
  const state = await apply({ ...request, preview: preview.migration.fingerprint });
  const leadId = state.campaignRehearsal.leadId;
  const reserve = state.inboxLeads.find(({ id }) => id !== leadId);
  const follow = (state, id = leadId) => state.inboxLeads.find((lead) => lead.id === id).followUp;
  const call = (state, fields = {}, id = leadId) => ({ type: "recordCampaignCall", campaignId, leadId: id, revision: follow(state, id).revision,
    outcome: "Left message", callbackAt: null, note: "Fictional call", ...fields });
  const control = (paused, revision) => ({ type: "pauseCampaignRetries", campaignId, paused, revision });
  const work = (input, actor = staff, brokerageId = staff.brokerage.id) => playbookRunWork(db, input, actor, brokerageId);
  const runs = (filter = "All runs") => work({ type: "list", automation: "Campaign follow-up", filter }).runs;
  const recovery = (run) => ({ type: "retry", source: "campaign", id: run.id, attempt: run.attemptCount, operationId: crypto.randomUUID() });
  return { db, staff, officer, state, campaignId, leadId, reserve, follow, call, control, send, apply, work, runs, recovery };
}

test("campaign import distinguishes existing leads from duplicate CSV rows and can enroll an eligible match", async (t) => {
  const { db, staff } = fixture(t);
  const at = "2026-11-08T15:00:00.000Z";
  const campaignId = crypto.randomUUID();
  const otherCampaign = crypto.randomUUID();
  const inCampaign = crypto.randomUUID();
  const available = crypto.randomUUID();
  const held = crypto.randomUUID();
  const send = (input, actor = staff) => executeCommand(db, input, actor, undefined, [staff]);
  for (const [id, name] of [[campaignId, "New campaign"], [otherCampaign, "Earlier campaign"]]) {
    assert.ok((await send({ type: "createCallCampaign", id, name })).state);
  }
  const insert = db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, createdAt, dueAt, heldAt)
    VALUES (?, ?, ?, '', ?, 'Purchase', '', ?, ?, ?)`);
  insert.run(inCampaign, inCampaign, "Existing campaign lead", "248-555-0111", at, at, null);
  insert.run(available, available, "Existing open lead", "248-555-0112", at, at, null);
  insert.run(held, held, "Existing held lead", "248-555-0113", at, at, at);
  assert.ok((await send({ type: "addCampaignLead", campaignId: otherCampaign, leadId: inCampaign })).state);
  const request = { type: "migratePipeline", origin: campaignOrigin(campaignId), campaignId, decisions: {},
    rows: parseCampaignLeadCsv(["id,name,phone", "enrolled,Other name,2485550111", "open,Alternate spelling,2485550112",
      "held,Held match,2485550113", "fresh,New buyer,2485550114", "repeat,Other CSV row,2485550114"].join("\n"), at) };
  const preview = await send(request);
  assert.deepEqual(preview.migration.rows.map(({ status }) => status), ["Review", "Review", "Review", "Create", "Review"]);
  assert.deepEqual(preview.migration.rows[0].campaignDuplicates, [{ id: inCampaign, name: "Existing campaign lead", campaignName: "Earlier campaign", canEnroll: false }]);
  assert.deepEqual(preview.migration.rows[1].campaignDuplicates, [{ id: available, name: "Existing open lead", campaignName: null, canEnroll: true }]);
  assert.deepEqual(preview.migration.rows[2].campaignDuplicates, [{ id: held, name: "Existing held lead", campaignName: null, canEnroll: false }]);
  assert.match(preview.migration.rows[4].detail, /earlier row in this CSV/);
  assert.equal(preview.migration.rows[4].campaignDuplicates, undefined);
  const officer = { ...staff, brokerage: { ...staff.brokerage, role: "LO" } };
  assert.ok((await send(request, officer)).error);
  assert.ok((await send({ type: "addCampaignLead", campaignId, leadId: inCampaign })).error);
  assert.ok((await send({ type: "addCampaignLead", campaignId, leadId: available })).state);
  assert.ok((await send({ ...request, preview: preview.migration.fingerprint })).error);
  const reviewed = { ...request, decisions: Object.fromEntries(preview.migration.rows.filter(({ status }) => status === "Review").map(({ key }) => [key, "skip"])) };
  const refreshed = await send(reviewed);
  assert.ok((await send({ ...reviewed, preview: refreshed.migration.fingerprint })).state);
  assert.equal(db.prepare("SELECT count(*) AS total FROM referral_leads").get().total, 4);
  assert.equal(db.prepare("SELECT count(*) AS total FROM call_campaign_members WHERE campaignId = ?").get(campaignId).total, 2);
});

test("campaign preview and batch saves return only affected work and preserve reports and deadlines", async (t) => {
  const { db, staff } = fixture(t);
  const campaignId = crypto.randomUUID();
  const officer = { name: "Fictional receiving officer", email: "assignee@example.test", role: "LO", status: "Active" };
  const snapshot = async () => (await executeCommand(db, { type: "refreshWorkspace" }, staff)).state;
  const save = (input) => executeCommand(db, input, staff, undefined, [staff, officer], { scopedLeadUpdates: true });
  const setup = await executeCommand(db, { type: "loadCampaignRehearsal", id: campaignId }, staff, undefined, [staff]);
  assert.ok(setup.state, setup.error);
  const at = "2026-11-08T15:00:00.000Z";
  const realtorId = crypto.randomUUID();
  const referralId = crypto.randomUUID();
  insertContact(db, { id: realtorId, name: "Fictional realtor", role: "Realtor", phone: "", email: "" });
  db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, createdAt, dueAt)
    VALUES (?, ?, ?, 'Fictional referral', 'referral@example.test', '2485550188', 'Purchase', '', ?, ?)`)
    .run(referralId, referralId, realtorId, at, at);
  const before = await snapshot();
  const input = { type: "migratePipeline", campaignId, origin: campaignOrigin(campaignId), decisions: {},
    rows: parseCampaignLeadCsv(campaignRehearsalCsv, at) };
  const preview = await save(input);
  assert.equal(preview.state, undefined);
  assert.equal(preview.campaignWork, null);
  assert.equal(preview.migration.rows.length, 2);
  assert.deepEqual(await snapshot(), before);
  const commit = await save({ ...input, preview: preview.migration.fingerprint });
  assert.ok(commit.campaignWork, commit.error);
  assert.equal(commit.state, undefined);
  assert.equal(commit.campaignWork.inboxLeads.length, 2);
  assert.equal(commit.campaignWork.campaignRehearsal.importedCount, 2);
  let merged = applyCampaignMutation(before, commit.campaignWork);
  assert.equal(merged.contacts, before.contacts);
  assert.equal(merged.loans, before.loans);
  const recordOrder = (a, b) => a.id.localeCompare(b.id);
  const assertCurrent = async () => {
    const current = await snapshot();
    for (const field of ["inboxLeads", "referralLeads", "callCampaignMembers", "unlinkedReferrals", "campaignRehearsal"]) {
      assert.deepEqual(merged[field], current[field], field);
    }
    assert.deepEqual([...merged.managerReports.records].sort(recordOrder), [...current.managerReports.records].sort(recordOrder));
    const byLead = (a, b) => a.leadId.localeCompare(b.leadId);
    assert.deepEqual([...merged.campaignResponses].sort(byLead), [...current.campaignResponses].sort(byLead));
  };
  await assertCurrent();
  const added = await save({ type: "addCampaignLead", campaignId, leadId: referralId });
  assert.ok(added.campaignWork, added.error);
  assert.deepEqual(added.campaignWork.inboxLeads.map(({ id }) => id), [referralId]);
  merged = applyCampaignMutation(merged, added.campaignWork);
  await assertCurrent();

  const selected = merged.inboxLeads.filter(({ campaignId: enrolled }) => enrolled === campaignId);
  const leads = selected.map(({ id, officerEmail }) => ({ id, previousEmail: officerEmail }));
  const assignment = { type: "assignCampaignLeads", campaignId, email: officer.email, leads };
  assert.match((await save({ ...assignment, leads: [...leads.slice(0, -1), { ...leads.at(-1), previousEmail: "stale@example.test" }] })).error, /owner changed/);
  await assertCurrent();
  const assigned = await save(assignment);
  assert.ok(assigned.campaignWork, assigned.error);
  assert.equal(assigned.state, undefined);
  assert.equal(assigned.campaignWork.inboxLeads.length, 3);
  merged = applyCampaignMutation(merged, assigned.campaignWork);
  assert.ok(merged.inboxLeads.every(({ officerEmail }) => officerEmail === officer.email));
  assert.deepEqual(merged.inboxLeads.map(({ dueAt }) => dueAt), selected.map(({ dueAt }) => dueAt));
  assert.equal(merged.unlinkedReferrals[0].officerEmail, officer.email);
  await assertCurrent();
  const retry = await save(assignment);
  assert.match(retry.message, /already assigned/);
  assert.deepEqual(applyCampaignMutation(merged, retry.campaignWork), merged);
});

test("contact merge keeps the loan, campaign and conversation IDs, with stale, rollback and replay protection", (t) => {
  const { db, staff } = fixture(t);
  const at = "2026-11-08T15:00:00.000Z";
  const tenant = staff.brokerage.id;
  const officer = { ...staff, email: "officer@example.test", brokerage: { ...staff.brokerage, role: "LO" } };
  const other = { ...officer, email: "other@example.test" };
  const borrower = (id, email, phone) => insertContact(db, { id, name: `Fictional ${id}`, role: "Borrower", email, phone });
  borrower("source", "BUYER@example.test", "248-555-0185");
  borrower("primary", "buyer@example.test", "");
  insertLoan(db, { id: "mortgage", contactId: "source", partnerId: null, officer: officer.name, officerEmail: officer.email,
    amount: 250000, address: "", purpose: "Purchase", stage: "Lead", stageSince: at });
  const write = (input) => changeConversation(db, input, staff, tenant, new Date(at));
  const loanThread = write({ type: "start", loanId: "mortgage", audience: "Borrower", contactId: "source" }).id;
  const contactThread = write({ type: "startContact", contactId: "source" }).id;
  assert.ok(write({ type: "sampleReply", id: loanThread, revision: 1, eventId: crypto.randomUUID() }).id);
  assert.ok(write({ type: "note", id: contactThread, revision: 1, eventId: crypto.randomUUID(), text: "Fictional retained note" }).id);
  db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, createdAt, dueAt, importedContactId)
    VALUES ('lead','request','Fictional lead','','','Purchase','',?,?,'source')`).run(at, at);
  db.prepare("INSERT INTO call_campaigns (id, name, createdAt) VALUES ('campaign', 'Fictional', ?)").run(at);
  db.prepare("INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, attempts) VALUES ('lead','campaign',?,1)").run(at);
  db.prepare("INSERT INTO migration_records VALUES ('example','Contact:former','source')").run();
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture','contact:source',NULL,?)").run(at);
  const review = { type: "preview", sourceId: "source", targetId: "primary" };
  const work = (input, actor = staff, brokerage = tenant) => contactMergeWork(db, input, actor, brokerage, at);
  assert.ok(work(review, officer).error);
  assert.ok(work(review, staff, "unrelated").error);
  const preview = work(review);
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.kept.phone, "248-555-0185");
  assert.equal(preview.optedOut, true);
  assert.ok(preview.links.some(({ label }) => label === "Import source links"));
  const merge = { ...review, type: "merge", fingerprint: preview.fingerprint, operationId: crypto.randomUUID() };
  db.prepare(`INSERT INTO contact_activity (id,contactId,officer,kind,text,createdAt) VALUES ('check-in','source','QA','Call','Fictional',?)`).run(at);
  assert.match(work(merge).error, /links changed/);
  const latest = { ...merge, fingerprint: work(review).fingerprint };
  db.exec(`CREATE TRIGGER prevent_fixture_move BEFORE UPDATE OF contactId ON contact_activity BEGIN SELECT RAISE(ABORT,'Fixture interruption'); END;`);
  assert.throws(() => work(latest), /Fixture interruption/);
  assert.equal(db.prepare("SELECT contactId FROM loans WHERE id = 'mortgage'").get().contactId, "source");
  assert.equal(db.prepare("SELECT count(*) AS total FROM contact_merges").get().total, 0);
  db.exec("DROP TRIGGER prevent_fixture_move;");
  assert.deepEqual(work(latest), { kind: "merged", contactId: "primary" });
  assert.deepEqual(work(latest), { kind: "merged", contactId: "primary" });
  assert.ok(work({ ...latest, fingerprint: "a".repeat(64) }).error);
  assert.equal(db.prepare("SELECT count(*) AS total FROM contacts").get().total, 1);
  assert.equal(db.prepare("SELECT contactId FROM loans WHERE id = 'mortgage'").get().contactId, "primary");
  assert.equal(db.prepare("SELECT importedContactId FROM referral_leads WHERE id = 'lead'").get().importedContactId, "primary");
  assert.equal(db.prepare("SELECT attempts FROM call_campaign_members WHERE campaignId = 'campaign' AND leadId = 'lead'").get().attempts, 1);
  assert.equal(db.prepare("SELECT targetId FROM migration_records WHERE recordKey = 'Contact:former'").get().targetId, "primary");
  assert.equal(db.prepare("SELECT contactId FROM contact_activity WHERE id = 'check-in'").get().contactId, "primary");
  const history = (id, actor) => readConversations(db, { type: "thread", id }, actor, tenant, new Date(at));
  assert.equal(history(loanThread, officer).thread.contactId, "primary");
  assert.equal(history(loanThread, officer).events[0].origin, "Simulated");
  assert.ok(history(loanThread, other).error);
  assert.equal(history(contactThread, staff).events[0].text, "Fictional retained note");
  assert.ok(db.prepare("SELECT 1 FROM outreach_opt_outs WHERE identityKey = 'contact:primary'").get());
  assert.match(work({ type: "previewUndo", mergeId: latest.operationId }).blocker, /opt-out/);
  const oldLink = { type: "open", kind: "contact", id: "source" };
  assert.equal(readWorkspaceSearch(db, oldLink, officer, tenant).contact.id, "primary");
  assert.ok(readWorkspaceSearch(db, oldLink, other, tenant).error);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("admin undo restores original links and records one receipt after checking linked changes", (t) => {
  const { db, staff } = fixture(t);
  const at = "2026-11-08T15:00:00.000Z";
  const undoAt = "2026-11-08T16:00:00.000Z";
  const tenant = staff.brokerage.id;
  const admin = { ...staff, email: "second-admin@example.test" };
  const officer = { ...staff, brokerage: { ...staff.brokerage, role: "LO" } };
  const work = (input, actor = staff, brokerage = tenant, time = at) => contactMergeWork(db, input, actor, brokerage, time);
  insertContact(db, { id: "source", name: "Fictional Source", role: "Borrower", email: "BUYER@example.test", phone: "2485550199" });
  insertContact(db, { id: "primary", name: "Fictional Primary", role: "Borrower", email: "buyer@example.test", phone: "" });
  const fieldId = crypto.randomUUID();
  const fields = (input) => crmFieldWork(db, input, staff, tenant, at);
  assert.equal(fields({ type: "saveField", fieldId, revision: 0,
    definition: { label: "Outreach note", kind: "Short text", options: [], roles: [] } }).kind, "savedField");
  assert.equal(fields({ type: "saveValue", record: "contact", recordId: "source", fieldId, fieldRevision: 1,
    revision: 0, value: "Fictional outreach tag" }).kind, "values");
  const tag = (recordId) => fields({ type: "values", record: "contact", recordId }).entries[0];
  for (const [id, contactId] of [["source-loan", "source"], ["primary-loan", "primary"]]) {
    insertLoan(db, { id, contactId, partnerId: null, officer: staff.name, officerEmail: staff.email,
      amount: 250000, address: "", purpose: "Purchase", stage: "Lead", stageSince: at });
  }
  const threadId = changeConversation(db, { type: "startContact", contactId: "source" }, staff, tenant, new Date(at)).id;
  db.prepare(`INSERT INTO referral_leads (id,requestId,name,email,phone,purpose,officer,createdAt,dueAt,importedContactId)
    VALUES ('lead','request','Fictional lead','','','Purchase','',?,?,'source')`).run(at, at);
  db.prepare("INSERT INTO call_campaigns (id,name,createdAt) VALUES ('campaign','Fictional',?)").run(at);
  db.prepare("INSERT INTO call_campaign_members (leadId,campaignId,joinedAt,attempts) VALUES ('lead','campaign',?,1)").run(at);
  db.prepare("INSERT INTO migration_records VALUES ('fixture','Contact:source','source')").run();

  const pair = { sourceId: "source", targetId: "primary" };
  const mergeId = crypto.randomUUID();
  const merge = { ...pair, type: "merge", operationId: mergeId, fingerprint: work({ ...pair, type: "preview" }).fingerprint };
  assert.deepEqual(work(merge), { kind: "merged", contactId: "primary" });
  assert.equal(tag("primary").value, "Fictional outreach tag");
  const previewInput = { type: "previewUndo", mergeId };
  const preview = work(previewInput);
  assert.equal(preview.blocker, null);
  assert.ok(preview.links.some(({ label, count }) => label === "Borrower loans" && count === 1));
  const history = { type: "history" };
  assert.equal(work(history).rows[0].actor, staff.email);
  assert.ok(work(history, officer).error);
  assert.ok(work(previewInput, staff, "another-brokerage").error);
  const undo = { type: "undo", mergeId, fingerprint: preview.fingerprint, operationId: crypto.randomUUID() };
  db.prepare(`INSERT INTO lead_events (id,leadId,at,actor,kind,text) VALUES ('new-event','lead',?,'QA','Note','New work')`).run(undoAt);
  assert.match(work(undo, admin, tenant, undoAt).error, /linked work changed/);
  assert.equal(db.prepare("SELECT count(*) AS total FROM contacts").get().total, 1);
  db.exec("DELETE FROM lead_events WHERE id = 'new-event';");
  db.exec(`CREATE TRIGGER fail_restore BEFORE UPDATE OF importedContactId ON referral_leads
    BEGIN SELECT RAISE(ABORT,'Fixture undo interruption'); END;`);
  assert.throws(() => work(undo, admin, tenant, undoAt), /Fixture undo interruption/);
  assert.equal(db.prepare("SELECT contactId FROM loans WHERE id = 'source-loan'").get().contactId, "primary");
  db.exec("DROP TRIGGER fail_restore;");

  assert.deepEqual(work(undo, admin, tenant, undoAt), { kind: "undone", contactId: "source" });
  assert.equal(tag("source").value, "Fictional outreach tag");
  assert.equal(tag("primary").value, null);
  assert.ok(tag("primary").revision > 1);
  assert.deepEqual(work(undo, admin, tenant, undoAt), { kind: "undone", contactId: "source" });
  assert.ok(work(undo).error);
  assert.match(work(merge).error, /was undone/);
  assert.equal(db.prepare("SELECT contactId FROM loans WHERE id = 'source-loan'").get().contactId, "source");
  assert.equal(db.prepare("SELECT contactId FROM loans WHERE id = 'primary-loan'").get().contactId, "primary");
  assert.equal(db.prepare("SELECT phone FROM contacts WHERE id = 'primary'").get().phone, "");
  assert.equal(db.prepare("SELECT phone FROM contacts WHERE id = 'source'").get().phone, "2485550199");
  assert.equal(db.prepare("SELECT contactId FROM contact_conversations WHERE id = ?").get(threadId).contactId, "source");
  assert.equal(db.prepare("SELECT importedContactId FROM referral_leads WHERE id = 'lead'").get().importedContactId, "source");
  assert.equal(db.prepare("SELECT targetId FROM migration_records WHERE recordKey = 'Contact:source'").get().targetId, "source");
  assert.equal(db.prepare("SELECT attempts FROM call_campaign_members WHERE leadId = 'lead'").get().attempts, 1);
  assert.deepEqual(work(history).rows.map(({ mergeId, actor, undoneBy, undoneAt }) => ({ mergeId, actor, undoneBy, undoneAt })),
    [{ mergeId, actor: staff.email, undoneBy: admin.email, undoneAt: undoAt }]);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("duplicate review preserves a compatible realtor link and blocks ambiguous records", (t) => {
  const { db, staff } = fixture(t);
  const at = "2026-11-08T15:00:00.000Z";
  const tenant = staff.brokerage.id;
  const token = "a".repeat(64);
  const expiry = "2026-11-22T15:00:00.000Z";
  insertContact(db, { id: "source", name: "Old Realtor", role: "Realtor", email: "realtor@example.test", phone: "" });
  insertContact(db, { id: "primary", name: "Fictional Realtor", role: "Realtor", email: "realtor@example.test", phone: "" });
  insertContact(db, { id: "borrower", name: "Different role", role: "Borrower", email: "realtor@example.test", phone: "" });
  db.prepare("INSERT INTO realtor_portals (realtorId, token, expiresAt) VALUES ('source', ?, ?)").run(token, expiry);
  db.prepare("INSERT INTO realtor_portals (realtorId, token, expiresAt) VALUES ('primary', ?, ?)").run("b".repeat(64), expiry);
  db.prepare(`INSERT INTO referral_leads (id,requestId,realtorId,name,email,phone,purpose,officer,createdAt,dueAt)
    VALUES ('lead','request','source','Fictional referral','','','Purchase','',?,?)`).run(at, at);
  const review = { type: "preview", sourceId: "source", targetId: "primary" };
  const work = (input) => contactMergeWork(db, input, staff, tenant, at);
  assert.ok(work({ ...review, targetId: "borrower" }).blockers.some((text) => text.includes("different contact roles")));
  const conflict = work(review);
  assert.deepEqual(conflict.blockers, ["Both realtor records have portal links."]);
  const merge = { ...review, type: "merge", fingerprint: conflict.fingerprint, operationId: crypto.randomUUID() };
  assert.ok(work(merge).error);
  db.exec("DELETE FROM realtor_portals WHERE realtorId = 'primary';");
  const valid = work(review);
  assert.deepEqual(valid.blockers, []);
  assert.equal(work({ ...merge, fingerprint: valid.fingerprint }).contactId, "primary");
  assert.deepEqual({ ...db.prepare("SELECT realtorId, token, expiresAt FROM realtor_portals").get() },
    { realtorId: "primary", token, expiresAt: expiry });
  assert.equal(db.prepare("SELECT realtorId FROM referral_leads WHERE id = 'lead'").get().realtorId, "primary");
  assert.match(JSON.stringify(realtorReferrals(db, { token }, at)), /Fictional referral/);
});

test("duplicate queue indexes existing contacts in batches and pages groups and members within a brokerage", (t) => {
  const { db, staff } = fixture(t);
  const tenant = staff.brokerage.id;
  const work = (input, actor = staff, brokerageId = tenant) => contactMergeWork(db, input, actor, brokerageId);
  const groups = { type: "duplicateGroups" };
  const add = (id, email = "", phone = "", role = "Borrower") =>
    insertContact(db, { id, name: `Fictional ${id}`, email, phone, role });
  for (const index of ["contact_outreach_keys", "realtor_reply_keys"]) {
    db.exec(`DROP TRIGGER ${index}_duplicate_insert; DROP TRIGGER ${index}_duplicate_delete;`);
  }
  for (let n = 0; n < 210; n++) add(`single-${n}`, `unique-${n}@example.test`);
  for (let n = 0; n < 15; n++) {
    add(`borrower-${n}`, `matching-${n}@example.test`);
    add(`realtor-${n}`, `MATCHING-${n}@example.test`, "", "Realtor");
    add(`phone-${String(n).padStart(2, "0")}`, "", n % 2 ? "+1 (248) 555-0141" : "2485550141");
  }
  add("blank-1", "", "1234");
  add("blank-2", "", "1234");
  indexPendingContactOutreach(db);
  indexPendingRealtorReplies(db);
  assert.equal(db.prepare("SELECT count(*) AS total FROM contact_duplicate_groups").get().total, 0);
  initializeStore(db, false);
  assert.ok(work(groups, { ...staff, brokerage: { ...staff.brokerage, role: "LO" } }).error);
  assert.ok(work(groups, staff, "wrong-tenant").error);
  assert.deepEqual(work(groups), { kind: "duplicateScan" });
  add("added-after-checkpoint", "AAA@example.test");
  add("newly-matched", "aaa@example.test");
  const first = work(groups);
  const second = work({ ...groups, after: first.next });
  assert.equal(first.rows.length, 12);
  assert.equal(second.rows.length, 5);
  const all = [...first.rows, ...second.rows];
  assert.equal(new Set(all.map(({ key }) => key)).size, 17);
  assert.deepEqual(all[0].names, ["Fictional added-after-checkpoint", "Fictional newly-matched"]);
  assert.ok(all.some(({ key, names }) => key === "email:matching-0@example.test" && names[1] === "Fictional realtor-0"));
  assert.ok(all.some(({ key, more }) => key === "phone:2485550141" && more));
  const members = { type: "duplicateMembers", key: "phone:2485550141" };
  const firstMembers = work(members);
  const nextMembers = work({ ...members, after: firstMembers.next });
  assert.equal(firstMembers.contacts.length, 12);
  assert.deepEqual(nextMembers.contacts.map(({ id }) => id), ["phone-12", "phone-13", "phone-14"]);
  assert.equal(nextMembers.next, null);
  assert.ok(work({ ...members, key: "contact:blank-1" }).error);
  assert.match(work({ type: "preview", sourceId: "realtor-0", targetId: "borrower-0" }).blockers.join(" "), /different contact roles/);

  db.prepare("UPDATE contacts SET email = ? WHERE id = ?").run("corrected@example.test", "realtor-0");
  assert.equal(work(groups).rows.some(({ key }) => key === "email:matching-0@example.test"), false);
  const pair = { sourceId: "newly-matched", targetId: "added-after-checkpoint" };
  const fingerprint = work({ type: "preview", ...pair }).fingerprint;
  const mergeId = crypto.randomUUID();
  assert.equal(work({ type: "merge", ...pair, operationId: mergeId, fingerprint }).kind, "merged");
  assert.equal(work(groups).rows.some(({ key }) => key === "email:aaa@example.test"), false);
  const undo = work({ type: "previewUndo", mergeId });
  assert.equal(work({ type: "undo", mergeId, operationId: crypto.randomUUID(), fingerprint: undo.fingerprint }).kind, "undone");
  assert.ok(work(groups).rows.some(({ key }) => key === "email:aaa@example.test"));
});

test("keeping a duplicate group separate audits the decision and reopens after details or membership change", (t) => {
  const { db, staff } = fixture(t);
  const at = "2026-11-08T15:00:00.000Z";
  const tenant = staff.brokerage.id;
  const work = (input, actor = staff, brokerage = tenant) => contactMergeWork(db, input, actor, brokerage, at);
  const key = "email:shared@example.test";
  const email = "shared@example.test";
  const add = (id, role) => insertContact(db, { id, name: `Fictional ${id}`, email, phone: "", role });
  const groups = () => work({ type: "duplicateGroups" }).rows;
  const history = () => work({ type: "duplicateHistory" }).rows;
  const members = () => work({ type: "duplicateMembers", key });
  const decision = (reason) => ({ type: "keepDuplicatesSeparate", key, revision: members().revision, reason, operationId: crypto.randomUUID() });
  add("client", "Borrower");
  add("partner", "Realtor");
  assert.equal(groups()[0].key, key);
  // Start with the previous released schema and its already indexed group.
  for (const index of ["contact_outreach_keys", "realtor_reply_keys"]) {
    db.exec(`DROP TRIGGER ${index}_duplicate_insert; DROP TRIGGER ${index}_duplicate_delete;`);
  }
  db.exec(`DROP TRIGGER contact_duplicate_name_change;
    DROP INDEX duplicate_groups_open;
    ALTER TABLE contact_duplicate_groups DROP COLUMN reviewId;
    ALTER TABLE contact_duplicate_groups DROP COLUMN revision;
    DROP TABLE contact_duplicate_reviews;`);
  initializeStore(db, false);
  assert.equal(members().revision, "legacy");
  const first = decision("Shared family email. The records represent different people.");
  assert.ok(work(first, { ...staff, brokerage: { ...staff.brokerage, role: "LO" } }).error);
  assert.ok(work(first, staff, "another-brokerage").error);
  assert.ok(work({ ...first, reason: " " }).error);
  assert.deepEqual(work(first), { kind: "duplicateReviewed" });
  assert.deepEqual(work(first), { kind: "duplicateReviewed" });
  assert.ok(work({ ...first, reason: "Different reason" }).error);
  assert.ok(work({ ...first, operationId: crypto.randomUUID() }).error);
  assert.equal(groups().length, 0);
  assert.equal(members().reviewed, true);
  assert.deepEqual(history().map(({ reviewId, names, actor, reason, reopenedAt }) => ({ reviewId, names, actor, reason, reopenedAt })),
    [{ reviewId: first.operationId, names: ["Fictional client", "Fictional partner"], actor: staff.email, reason: first.reason, reopenedAt: null }]);
  db.prepare("UPDATE contacts SET name = name, email = email, phone = phone, role = role WHERE id = 'client'").run();
  initializeStore(db, false);
  assert.equal(groups().length, 0);
  assert.equal(history()[0].reopenedAt, null);

  db.prepare("UPDATE contacts SET name = ? WHERE id = 'client'").run("Fictional corrected name");
  assert.equal(groups()[0].key, key);
  assert.ok(history()[0].reopenedAt);
  assert.equal(history()[0].reopenedBy, null);
  const stale = decision("Reviewed before a contact joined.");
  add("co-client", "Co-borrower");
  assert.match(work(stale).error, /match changed/);
  const second = decision("Three distinct contacts use the shared address.");
  assert.deepEqual(work(second), { kind: "duplicateReviewed" });
  add("household-member", "Borrower");
  assert.equal(groups()[0].key, key);
  assert.ok(history().find(({ reviewId }) => reviewId === second.operationId).reopenedAt);

  const third = decision("Reviewed all four contacts.");
  assert.deepEqual(work(third), { kind: "duplicateReviewed" });
  const reopen = { type: "reopenDuplicates", reviewId: third.operationId };
  assert.deepEqual(work(reopen), { kind: "duplicateReopened" });
  assert.deepEqual(work(reopen), { kind: "duplicateReopened" });
  assert.equal(groups()[0].key, key);
  assert.equal(history().find(({ reviewId }) => reviewId === third.operationId).reopenedBy, staff.email);
  assert.equal(db.prepare("SELECT count(*) AS total FROM workspace_access_history WHERE subject = ?").get(third.operationId).total, 2);
  assert.equal(db.prepare("SELECT count(*) AS total FROM contacts").get().total, 4);
});

test("a logged lead reply excludes quiet enrollment and retires automatic retries while preserving callbacks", async (t) => {
  const { db, staff, state, campaignId, leadId, reserve, follow, call, apply, send, runs, recovery, work } = await campaignRecoveryFixture(t);
  const tenant = staff.brokerage.id;
  const write = (input) => changeConversation(db, input, staff, tenant);
  const quietId = crypto.randomUUID();
  const segmentId = crypto.randomUUID();
  const old = new Date(Date.now() - 15 * 86_400_000).toISOString();
  db.prepare(`INSERT INTO referral_leads (id,requestId,name,email,phone,purpose,officer,officerEmail,createdAt,dueAt)
    VALUES (?, ?, 'Fictional quiet lead', 'quiet@example.test', '2485550188', 'Purchase', ?, ?, ?, ?)`).run(quietId, quietId, staff.name, staff.email, old, old);
  await apply({ type: "saveCrmSegment", id: segmentId, revision: 0, name: "Quiet QA", kind: "Quiet leads", quietDays: 7 });
  const enrollment = { type: "enrollCrmSegment", segmentId, campaignId };
  const originalPreview = (await send(enrollment)).segmentPreview;
  assert.equal(originalPreview.rows.find(({ id }) => id === quietId).status, "Eligible");
  const quietThread = write({ type: "startLead", leadId: quietId }).id;
  const manual = (id, revision = 1) => ({ type: "message", direction: "Inbound", channel: "Email", text: "Fictional buyer wants to reconnect.",
    id, revision, eventId: crypto.randomUUID() });
  assert.ok(write(manual(quietThread)).id);
  assert.match((await send({ ...enrollment, fingerprint: originalPreview.fingerprint, selectedIds: [quietId] })).error, /results changed/);
  const newPreview = (await send(enrollment)).segmentPreview;
  assert.equal(newPreview.rows.find(({ id }) => id === quietId).status, "Reply received");
  assert.ok(!readOfficerQueue(db, { horizon: 1 }, staff, tenant).items.some((item) => item.recordId === quietId));

  const called = await apply(call(state));
  const retryTask = called.callCampaignMembers.find((member) => member.leadId === leadId).callbackTaskId;
  const campaignThread = write({ type: "startLead", leadId }).id;
  assert.ok(write({ type: "sampleReply", id: campaignThread, revision: 1, eventId: crypto.randomUUID() }).id);
  const task = (id) => db.prepare("SELECT dueAt, completedAt FROM lead_import_tasks WHERE id = ?").get(id);
  assert.equal(task(retryTask).completedAt, null);
  const action = manual(campaignThread, 2);
  assert.ok(write(action).id);
  assert.ok(write(action).id);
  assert.ok(task(retryTask).completedAt);
  assert.equal(db.prepare("SELECT count(*) AS total FROM lead_conversation_events WHERE id = ?").get(action.eventId).total, 1);
  const refreshed = await apply({ type: "refreshWorkspace" });
  const member = refreshed.callCampaignMembers.find((entry) => entry.leadId === leadId);
  assert.equal(member.campaignId, campaignId);
  assert.equal(member.attempts, 1);
  assert.equal(member.lastOutcome, "Left message");
  assert.equal(member.callbackDueAt, null);
  assert.equal(follow(refreshed).status, "Stopped");
  assert.ok(follow(refreshed).replyReceivedAt);
  assert.ok(!playbookWork(refreshed).some((item) => item.id === `quiet-lead:${leadId}`));
  assert.match((await send(call(refreshed, { outcome: "No response" }))).message, /Automatic retries are off/);
  assert.equal(runs().filter((run) => run.leadId === leadId).length, 1);

  const callbackAt = new Date(Date.now() + 86_400_000).toISOString();
  const assigned = await apply({ type: "assignInboxLead", leadId: reserve.id, email: staff.email, previousEmail: reserve.officerEmail ?? null });
  const reserveState = await apply(call(assigned, { outcome: "Requested callback", callbackAt, simulateFollowUpFailure: true }, reserve.id));
  const callbackRun = runs("Failed").find((run) => run.leadId === reserve.id);
  assert.ok(callbackRun);
  const callbackThread = write({ type: "startLead", leadId: reserve.id }).id;
  assert.ok(write(manual(callbackThread)).id);
  assert.equal(work(recovery(callbackRun)).status, "Completed");
  const callbackTaskId = db.prepare("SELECT callbackTaskId FROM call_campaign_members WHERE leadId = ?").get(reserve.id).callbackTaskId;
  assert.equal(task(callbackTaskId).dueAt, callbackAt);
  assert.equal(task(callbackTaskId).completedAt, null);
  assert.equal(reserveState.callCampaignMembers.find((entry) => entry.leadId === reserve.id).lastOutcome, "Requested callback");
  assert.ok(readOfficerQueue(db, { horizon: 7 }, staff, tenant).items.some((item) => item.id === callbackTaskId));
});

test("workspace upgrades honor previous manual replies and leave simulated replies and requested callbacks alone", async (t) => {
  const { db, staff, state, leadId, reserve, call, apply, runs } = await campaignRecoveryFixture(t);
  const callbackAt = new Date(Date.now() + 86_400_000).toISOString();
  const failed = await apply(call(state, { simulateFollowUpFailure: true }));
  const callbacks = await apply(call(failed, { outcome: "Requested callback", callbackAt }, reserve.id));
  const callback = callbacks.callCampaignMembers.find((member) => member.leadId === reserve.id).callbackTaskId;
  const at = new Date().toISOString();
  const add = (id, origin) => {
    const thread = changeConversation(db, { type: "startLead", leadId: id }, staff, staff.brokerage.id).id;
    db.prepare(`INSERT INTO lead_conversation_events (id, conversationId, kind, channel, origin, text, actor, actorEmail, at, request)
      VALUES (?, ?, 'Inbound', 'Email', ?, 'Older fictional reply', ?, ?, ?, '{}')`).run(crypto.randomUUID(), thread, origin, staff.name, staff.email, at);
  };
  add(leadId, "Manual log");
  add(reserve.id, "Simulated");
  db.exec("ALTER TABLE lead_follow_up DROP COLUMN replyReceivedAt");
  initializeStore(db, false);
  const row = (id) => ({ ...db.prepare("SELECT replyReceivedAt, status, revision FROM lead_follow_up WHERE leadId = ?").get(id) });
  const recorded = row(leadId);
  assert.equal(recorded.replyReceivedAt, at);
  assert.equal(recorded.status, "Stopped");
  assert.equal(runs().find((run) => run.leadId === leadId).status, "Superseded");
  assert.equal(row(reserve.id).replyReceivedAt, null);
  assert.equal(db.prepare("SELECT completedAt FROM lead_import_tasks WHERE id = ?").get(callback).completedAt, null);
  initializeStore(db, false);
  assert.deepEqual(row(leadId), recorded);
});

test("campaign callback recovery preserves the call and the requested deadline through a task write failure", async (t) => {
  const { db, officer, state, leadId, follow, call, apply, send, work, runs, recovery } = await campaignRecoveryFixture(t);
  const callbackAt = new Date(Date.now() + 86_400_000).toISOString();
  const log = call(state, { outcome: "Requested callback", callbackAt });
  db.exec(`CREATE TRIGGER interrupt_callback BEFORE INSERT ON lead_import_tasks WHEN NEW.title LIKE 'Call back%'
    BEGIN SELECT RAISE(ABORT, 'Fictional write failure'); END;`);
  const logged = await send(log);
  assert.match(logged.message, /admin can recover/);
  assert.equal(follow(logged.state).events.filter(({ kind }) => kind === "Call").length, 1);
  assert.equal(logged.state.callCampaignMembers.find((member) => member.leadId === leadId).followUpRunStatus, "Failed");
  assert.deepEqual(campaignFollowUpWork(logged.state), []);
  assert.ok(!playbookWork(logged.state).some((item) => item.recordId === leadId));
  assert.match((await send(log)).error, /changed/);
  const [run] = runs("Failed");
  assert.equal(run.dueAt, callbackAt);
  assert.equal(run.ruleRevision, 0);
  assert.equal(run.delayDays, null);
  const retry = recovery(run);
  assert.ok(work(retry, officer).error);
  assert.ok(work(retry, undefined, crypto.randomUUID()).error);
  assert.equal(work(retry).status, "Failed");
  assert.equal(work(retry).status, "Failed");
  assert.match(work({ ...retry, operationId: crypto.randomUUID() }).error, /changed/);
  db.exec("DROP TRIGGER interrupt_callback");
  await apply({ type: "assignInboxLead", leadId, email: officer.email, previousEmail: "admin@example.test" });
  const next = recovery(runs("Failed")[0]);
  assert.equal(work(next).status, "Completed");
  assert.equal(work(next).status, "Completed");
  const current = await apply({ type: "refreshWorkspace" }, officer);
  const [callback] = campaignFollowUpWork(current);
  assert.equal(callback.dueAt, callbackAt);
  assert.equal(callback.ownerEmail, officer.email);
  assert.equal(follow(current).events.filter(({ kind }) => kind === "Call").length, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM lead_import_tasks WHERE leadId = ?").get(leadId).count, 1);
  assert.deepEqual(work({ type: "attempts", source: "campaign", id: run.id }).attempts.map(({ status }) => status), ["Completed", "Failed", "Failed"]);
});

const promiseStart = "2026-11-09T15:00:00.000Z";

function callbackPromises(db, leadId) {
  return db.prepare(`SELECT id, taskId, status, dueAt, promiseRequestEventId, promiseDueAt, promiseAttemptEventId,
    promiseClosedAt, promiseCloseReason FROM campaign_follow_up_runs WHERE leadId = ? ORDER BY callNumber`)
    .all(leadId).map((row) => ({ ...row }));
}

test("a failed callback promise keeps its exact request and closes on the next recorded campaign call", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(promiseStart) });
  const { db, staff, officer, state, leadId, reserve, follow, call, apply, send } = await campaignRecoveryFixture(t);
  const firstDue = "2026-11-09T16:00:00.000Z";
  const firstInput = call(state, { outcome: "Requested callback", callbackAt: firstDue, simulateFollowUpFailure: true });
  const first = await apply(firstInput);
  const firstEvent = follow(first).events.find(({ kind }) => kind === "Call");
  const [open] = callbackPromises(db, leadId);
  assert.deepEqual([firstEvent.at, firstEvent.outcome, open.status, open.dueAt, open.promiseRequestEventId, open.promiseDueAt,
    open.promiseAttemptEventId, open.promiseClosedAt, open.promiseCloseReason],
  [promiseStart, "Requested callback", "Failed", firstDue, firstEvent.id, firstDue, null, null, null]);
  assert.match((await send(firstInput)).error, /changed/i);
  assert.match((await send(call(first, { outcome: "Requested callback", callbackAt: promiseStart }))).error, /future/i);
  assert.deepEqual(callbackPromises(db, leadId), [open]);

  const nextDue = "2026-11-09T18:00:00.000Z";
  const nextInput = call(first, { outcome: "Requested callback", callbackAt: nextDue });
  db.exec(`CREATE TRIGGER interrupt_callback_promise BEFORE INSERT ON campaign_follow_up_runs WHEN NEW.promiseRequestEventId IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'Fictional promise write failed'); END;`);
  assert.throws(() => db.transaction(() => recordCampaignCall(db, staff, nextInput, promiseStart)), /Fictional promise write failed/);
  assert.deepEqual(callbackPromises(db, leadId), [open]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM lead_events WHERE leadId = ? AND kind = 'Call'").get(leadId).count, 1);
  db.exec("DROP TRIGGER interrupt_callback_promise");

  const next = await apply(nextInput);
  const nextEvent = follow(next).events.find(({ kind }) => kind === "Call");
  assert.equal(nextEvent.at, firstEvent.at);
  assert.notEqual(nextEvent.id, firstEvent.id);
  const [attempted, replacement] = callbackPromises(db, leadId);
  assert.deepEqual([attempted.status, attempted.promiseRequestEventId, attempted.promiseAttemptEventId,
    attempted.promiseClosedAt, attempted.promiseCloseReason], ["Superseded", firstEvent.id, nextEvent.id, promiseStart, null]);
  assert.deepEqual([replacement.status, replacement.promiseRequestEventId, replacement.promiseDueAt,
    replacement.promiseAttemptEventId, replacement.promiseClosedAt], ["Completed", nextEvent.id, nextDue, null, null]);

  const coveredInput = call(next, { outcome: "Opted out" });
  const attemptedAt = "2026-11-09T18:00:00.001Z";
  assert.match(recordCampaignCall(db, officer, coveredInput, attemptedAt).error, /outside your assigned work/i);
  assert.ok(db.transaction(() => recordCampaignCall(db, officer, coveredInput, attemptedAt, staff.email)).message);
  const coveredEvent = db.prepare("SELECT id, actor, at, outcome FROM lead_events WHERE leadId = ? AND kind = 'Call' ORDER BY rowid DESC LIMIT 1").get(leadId);
  const [, handled] = callbackPromises(db, leadId);
  assert.deepEqual([coveredEvent.actor, coveredEvent.at, coveredEvent.outcome, handled.promiseAttemptEventId, handled.promiseClosedAt,
    handled.promiseCloseReason], [officer.name, attemptedAt, "Opted out", coveredEvent.id, attemptedAt, null]);
  assert.match(db.transaction(() => recordCampaignCall(db, officer, coveredInput, attemptedAt, staff.email)).error, /opted out|changed/i);
  assert.equal(callbackPromises(db, leadId).length, 2);

  await apply(call(next, {}, reserve.id));
  const [automatic] = callbackPromises(db, reserve.id);
  assert.equal(automatic.promiseRequestEventId, null);
  assert.equal(automatic.promiseDueAt, null);
});

test("moving a campaign callback before its deadline updates the promise and moving it at the deadline preserves it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(promiseStart) });
  const { db, state, campaignId, leadId, follow, call, apply, send } = await campaignRecoveryFixture(t);
  const originalDue = "2026-11-09T16:00:00.000Z";
  const requested = await apply(call(state, { outcome: "Requested callback", callbackAt: originalDue }));
  const reschedule = (snapshot, callbackAt) => ({ type: "rescheduleCampaignCallback", campaignId, leadId,
    revision: follow(snapshot).revision, callbackAt, reason: "Fictional change to the callback time." });
  const movedDue = "2026-11-09T17:00:00.000Z";
  const moved = await apply(reschedule(requested, movedDue));
  const [updated] = callbackPromises(db, leadId);
  assert.equal(updated.dueAt, originalDue);
  assert.equal(updated.promiseDueAt, movedDue);
  assert.match((await send(reschedule(requested, "2026-11-09T19:00:00.000Z"))).error, /changed/i);
  assert.deepEqual(callbackPromises(db, leadId), [updated]);

  t.mock.timers.setTime(Date.parse(movedDue));
  const laterDue = "2026-11-09T19:00:00.000Z";
  const later = await apply(reschedule(moved, laterDue));
  assert.equal(campaignFollowUpWork(later)[0].dueAt, laterDue);
  assert.deepEqual(callbackPromises(db, leadId), [updated]);
});

test("campaign promises close without an attempt on archive, conversion, and opt-out while a hold keeps them open", async (t) => {
  for (const reason of ["Lead archived", "1003 started", "Borrower opted out", "Contact opted out", "Held"]) {
    await t.test(reason, async (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: new Date(promiseStart) });
      const { db, state, leadId, follow, call, apply, send } = await campaignRecoveryFixture(t);
      const callbackAt = "2026-11-09T17:00:00.000Z";
      const requested = await apply(call(state, { outcome: "Requested callback", callbackAt }));
      const [open] = callbackPromises(db, leadId);
      const closeTime = "2026-11-09T16:00:00.000Z";
      t.mock.timers.setTime(Date.parse(closeTime));
      if (reason === "Lead archived") {
        await apply({ type: "dismissReferral", referralId: leadId, revision: follow(requested).revision });
      } else if (reason === "1003 started") {
        const result = await send({ type: "convertReferral", referralId: leadId, contactId: null });
        assert.ok(result.referralLoanId, result.error);
        const carried = db.prepare("SELECT dueAt, completedAt FROM tasks WHERE loanId = ? AND id = ?").get(result.referralLoanId, open.taskId);
        assert.deepEqual({ ...carried }, { dueAt: callbackAt, completedAt: null });
        assert.equal((await send({ type: "convertReferral", referralId: leadId, contactId: null })).referralLoanId, result.referralLoanId);
      } else if (reason === "Borrower opted out") {
        await apply({ type: "leadOptOut", leadId });
      } else if (reason === "Contact opted out") {
        const lead = requested.inboxLeads.find(({ id }) => id === leadId);
        const contactId = crypto.randomUUID();
        insertContact(db, { id: contactId, name: lead.name, email: lead.email, phone: lead.phone, role: "Borrower" });
        await apply({ type: "optOutContact", contactId });
      } else {
        await apply({ type: "leadHold", leadId, revision: follow(requested).revision, action: "Hold", reason: "Fictional hold", revisitDate: null });
      }
      const expectedReason = reason === "Contact opted out" ? "Borrower opted out" : reason;
      assert.deepEqual(callbackPromises(db, leadId), [reason === "Held" ? open : { ...open, promiseClosedAt: closeTime, promiseCloseReason: expectedReason }]);
      assert.ok(db.prepare("SELECT 1 FROM lead_events WHERE id = ?").get(open.promiseRequestEventId));
    });
  }
});

test("campaign promise schema upgrades leave existing callback runs unclassified", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(promiseStart) });
  const { db, state, leadId, call, apply } = await campaignRecoveryFixture(t);
  const first = await apply(call(state, { outcome: "Requested callback", callbackAt: "2026-11-09T17:00:00.000Z" }));
  db.exec(`DROP INDEX campaign_callback_promises_by_campaign;
    DROP INDEX IF EXISTS open_campaign_callback_promises_by_due;
    DROP INDEX IF EXISTS carried_campaign_callback_promises_by_due;
    ALTER TABLE campaign_follow_up_runs DROP COLUMN promiseRequestEventId;
    ALTER TABLE campaign_follow_up_runs DROP COLUMN promiseDueAt;
    ALTER TABLE campaign_follow_up_runs DROP COLUMN promiseAttemptEventId;
    ALTER TABLE campaign_follow_up_runs DROP COLUMN promiseClosedAt;
    ALTER TABLE campaign_follow_up_runs DROP COLUMN promiseCloseReason;`);
  initializeStore(db, false);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'campaign_callback_promises_by_campaign'").get());
  const [legacy] = callbackPromises(db, leadId);
  assert.equal(legacy.status, "Completed");
  assert.deepEqual([legacy.promiseRequestEventId, legacy.promiseDueAt, legacy.promiseAttemptEventId, legacy.promiseClosedAt, legacy.promiseCloseReason],
    [null, null, null, null, null]);
  await apply(call(first, { outcome: "Requested callback", callbackAt: "2026-11-09T18:00:00.000Z" }));
  initializeStore(db, false);
  const [unchanged, tracked] = callbackPromises(db, leadId);
  assert.deepEqual(unchanged, legacy);
  assert.ok(tracked.promiseRequestEventId);
  assert.equal(tracked.promiseDueAt, "2026-11-09T18:00:00.000Z");
});

test("callback exception drilldown and assignment require a current overdue promise and an eligible pilot admin", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(promiseStart) });
  const { db, staff, officer, state, campaignId, leadId, reserve, follow, call, apply } = await campaignRecoveryFixture(t);
  const deadline = "2026-11-09T16:00:00.000Z";
  const requested = await apply(call(state, { outcome: "Requested callback", callbackAt: deadline }));
  await apply(call(requested, { outcome: "Requested callback", callbackAt: deadline }, reserve.id));
  const [promise] = callbackPromises(db, leadId);
  const [otherPromise] = callbackPromises(db, reserve.id);
  const processor = { ...officer, email: "processor@example.test", brokerage: { ...officer.brokerage, role: "Processor" } };
  const nonPilot = { ...staff, brokerage: { ...staff.brokerage, pilot: false } };
  const revoked = "former-officer@example.test";
  const roster = [
    ...[staff, officer, processor].map(({ name, email, brokerage }) => ({ name, email, role: brokerage.role, status: "Active" })),
    { name: "Former officer", email: revoked, role: "LO", status: "Revoked" },
  ];
  const tenant = staff.brokerage.id;
  const open = (callbackPromiseId = promise.id, actor = staff, brokerageId = tenant) =>
    readEditableLead(db, { leadId, callbackPromiseId }, actor, brokerageId);
  const assignment = { type: "assignInboxLead", leadId, email: officer.email, previousEmail: staff.email, callbackPromiseId: promise.id };
  const assign = (fields = {}, actor = staff) => executeCommand(db, { ...assignment, ...fields }, actor, undefined, roster);
  const changed = /callback promise changed|no longer overdue/i;

  assert.match(open().error, changed);
  assert.match((await assign()).error, changed);
  t.mock.timers.setTime(Date.parse(deadline));
  const exact = open();
  assert.deepEqual([exact.lead.id, exact.lead.officerEmail, exact.campaign.id, exact.member.callbackTaskId, exact.member.callbackDueAt],
    [leadId, staff.email, campaignId, promise.taskId, deadline]);
  assert.match(open(otherPromise.id).error, changed);
  assert.match(open(crypto.randomUUID()).error, changed);
  assert.ok(open(promise.id, staff, crypto.randomUUID()).error);
  for (const actor of [officer, processor, nonPilot, null]) {
    assert.ok(open(promise.id, actor).error);
    assert.ok((await assign({}, actor)).error);
  }
  assert.match((await assign({ callbackPromiseId: otherPromise.id })).error, changed);
  assert.match((await assign({ previousEmail: officer.email })).error, /owner changed/i);
  for (const email of [null, processor.email, revoked, "not-on-roster@example.test"]) {
    assert.match((await assign({ email })).error, /active loan officer or admin/i);
  }

  const assigned = await assign();
  assert.ok(assigned.state, assigned.error);
  const reassigned = open();
  assert.deepEqual([reassigned.lead.officerEmail, reassigned.member.callbackTaskId, reassigned.member.callbackDueAt],
    [officer.email, promise.taskId, deadline]);
  assert.deepEqual(callbackPromises(db, leadId), [promise]);
  assert.match((await assign()).message, /up to date/i);

  const secondDeadline = "2026-11-09T18:00:00.000Z";
  const replacementState = await apply(call(assigned.state, { outcome: "Requested callback", callbackAt: secondDeadline }), officer);
  const [, replacement] = callbackPromises(db, leadId);
  assert.equal(replacement.taskId, promise.taskId);
  assert.match(open().error, changed);
  assert.match((await assign()).error, changed);
  assert.match(open(replacement.id).error, changed);
  t.mock.timers.setTime(Date.parse(secondDeadline));
  assert.equal(open(replacement.id).member.callbackDueAt, secondDeadline);
  assert.match(open().error, changed);
  const held = await apply({ type: "leadHold", leadId, revision: follow(replacementState).revision,
    action: "Hold", reason: "Fictional hold", revisitDate: null }, officer);
  assert.match(open(replacement.id).error, changed);
  assert.match((await assign({ callbackPromiseId: replacement.id })).error, changed);
  // The callback can resume under the same owner when their campaign has room.
  await apply({ type: "assignInboxLead", leadId: reserve.id, email: staff.email, previousEmail: officer.email });
  const active = await apply({ type: "leadHold", leadId, revision: follow(held).revision, action: "Reactivate" }, officer);
  await apply(call(active, { outcome: "Connected" }), officer);
  assert.match(open(replacement.id).error, changed);
  assert.match((await assign({ callbackPromiseId: replacement.id })).error, changed);
});

test("campaign retry time is admin-only, revision-checked, and retained by older saves and pause controls", async (t) => {
  const { state, campaignId, officer, control, send, apply } = await campaignRecoveryFixture(t);
  const campaign = (snapshot, id = campaignId) => snapshot.callCampaigns.find((item) => item.id === id);
  const save = (revision, fields = {}) => ({ type: "saveCampaignRules", campaignId, revision, voicemailDays: 1, noResponseDays: 2,
    maxAttempts: 4, ...fields });
  assert.equal(campaign(state).retryTime, "10:00");
  for (const retryTime of ["9:00", "24:00", "09:60", "09:00Z"]) {
    assert.ok((await send(save(0, { retryTime }))).error);
  }
  assert.match((await send(save(0, { retryTime: "14:37" }), officer)).error, /admin|access/i);
  const configured = await apply(save(0, { retryTime: "14:37" }));
  assert.equal(campaign(configured).retryTime, "14:37");
  assert.equal(campaign(configured).revision, 1);
  assert.match((await send(save(0, { retryTime: "15:37" }))).error, /changed/i);

  const paused = await apply(control(true, 1));
  assert.equal(campaign(paused).automaticPaused, true);
  assert.equal(campaign(paused).retryTime, "14:37");
  const legacy = await apply(save(2, { voicemailDays: 3 }));
  assert.equal(campaign(legacy).automaticPaused, true);
  assert.equal(campaign(legacy).retryTime, "14:37");
  assert.equal(campaign(legacy).voicemailDays, 3);
  const resumed = await apply(control(false, 3));
  assert.equal(campaign(resumed).automaticPaused, false);
  assert.equal(campaign(resumed).retryTime, "14:37");
  assert.equal(campaign(resumed).revision, 4);

  const other = crypto.randomUUID();
  const separate = await apply({ type: "createCallCampaign", id: other, name: "Separate fictional campaign" });
  assert.equal(campaign(separate, other).retryTime, "10:00");
  assert.equal(campaign(separate).retryTime, "14:37");
});

test("automatic campaign retries use the chosen Eastern weekday and time across daylight saving transitions", async (t) => {
  const cases = [
    { label: "spring midnight", friday: "2026-03-07T04:30:00.000Z", outcome: "Left message", retryTime: "00:15", dueAt: "2026-03-09T04:15:00.000Z",
      callbackAt: "2026-03-07T18:27:41.123Z" },
    { label: "fall late evening", friday: "2026-10-31T03:30:00.000Z", outcome: "No response", retryTime: "23:45", dueAt: "2026-11-03T04:45:00.000Z",
      callbackAt: "2026-10-31T18:27:41.123Z" },
  ];
  for (const { label, friday, outcome, retryTime, dueAt, callbackAt } of cases) {
    await t.test(label, async (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: new Date(friday) });
      const { campaignId, leadId, reserve, call, apply, runs } = await campaignRecoveryFixture(t);
      const configured = await apply({ type: "saveCampaignRules", campaignId, revision: 0,
        voicemailDays: 1, noResponseDays: 1, maxAttempts: 4, retryTime });
      const logged = await apply(call(configured, { outcome }));
      const requested = await apply(call(logged, { outcome: "Requested callback", callbackAt }, reserve.id));
      const due = new Map(campaignFollowUpWork(requested).map(({ recordId, dueAt }) => [recordId, dueAt]));
      assert.deepEqual(due, new Map([[leadId, dueAt], [reserve.id, callbackAt]]));
      const automatic = runs("Completed").find((run) => run.leadId === leadId);
      assert.deepEqual([automatic.dueAt, automatic.delayDays, automatic.ruleRevision], [dueAt, 1, 1]);
    });
  }
});

test("editing campaign retry time preserves scheduled and failed deadlines and applies to the next call", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-06T17:00:00.000Z") });
  const { campaignId, leadId, reserve, call, apply, work, runs, recovery } = await campaignRecoveryFixture(t);
  const save = (revision, retryTime) => apply({ type: "saveCampaignRules", campaignId, revision,
    voicemailDays: 1, noResponseDays: 1, maxAttempts: 4, retryTime });
  const before = await save(0, "08:25");
  const logged = await apply(call(before));
  await apply(call(logged, { outcome: "No response", simulateFollowUpFailure: true }, reserve.id));
  const [failed] = runs("Failed");
  const originalDue = "2026-11-09T13:25:00.000Z";
  assert.equal(failed.dueAt, originalDue);

  const edited = await save(1, "16:50");
  assert.deepEqual(campaignFollowUpWork(edited).map(({ recordId, dueAt }) => [recordId, dueAt]), [[leadId, originalDue]]);
  assert.equal(runs("Failed")[0].dueAt, originalDue);
  assert.equal(work(recovery(failed)).status, "Completed");
  const recovered = await apply({ type: "refreshWorkspace" });
  assert.deepEqual(new Map(campaignFollowUpWork(recovered).map(({ recordId, dueAt }) => [recordId, dueAt])),
    new Map([[leadId, originalDue], [reserve.id, originalDue]]));

  const next = await apply(call(recovered, { outcome: "No response" }));
  assert.deepEqual(new Map(campaignFollowUpWork(next).map(({ recordId, dueAt }) => [recordId, dueAt])),
    new Map([[leadId, "2026-11-09T21:50:00.000Z"], [reserve.id, originalDue]]));
});

test("legacy campaign rule rows acquire the default retry time and preserve the rest of the rule", async (t) => {
  const { db, campaignId, apply } = await campaignRecoveryFixture(t);
  db.exec("ALTER TABLE call_campaign_rules DROP COLUMN retryTime");
  db.prepare("INSERT INTO call_campaign_rules (campaignId, revision, voicemailDays, noResponseDays, maxAttempts, automaticPaused) VALUES (?, 3, 2, 4, 6, 1)")
    .run(campaignId);
  initializeStore(db, false);
  const refreshed = await apply({ type: "refreshWorkspace" });
  const { retryTime, revision, voicemailDays, noResponseDays, maxAttempts, automaticPaused } = refreshed.callCampaigns[0];
  assert.deepEqual([retryTime, revision, voicemailDays, noResponseDays, maxAttempts, automaticPaused], ["10:00", 3, 2, 4, 6, true]);

  await apply({ type: "saveCampaignRules", campaignId, revision, voicemailDays, noResponseDays, maxAttempts, retryTime: "07:05" });
  initializeStore(db, false);
  assert.equal((await apply({ type: "refreshWorkspace" })).callCampaigns[0].retryTime, "07:05");
});

function campaignQueueRecord(leadId, { dueAt = null, member = {}, lead = {}, optedOut = false } = {}) {
  return {
    member: {
      leadId, resolvedAt: null, attempts: dueAt ? 1 : 0, lastOutcome: dueAt ? "Left message" : null,
      callbackTaskId: dueAt ? `callback-${leadId}` : null, callbackDueAt: dueAt, followUpRunStatus: null,
      outreachSuppressed: false, ...member,
    },
    lead: { id: leadId, officerEmail: "officer@example.test", heldAt: null, outreachSuppressed: false, followUp: { replyReceivedAt: null }, ...lead },
    optedOut,
  };
}

test("campaign call queues separate shared work and preserve assigned callback and first-call order", () => {
  const boundary = "2026-11-09T15:00:00.000Z";
  const soon = "2026-11-09T15:00:00.001Z";
  const records = [
    campaignQueueRecord("upcoming-z", { dueAt: soon }),
    campaignQueueRecord("fresh-z", { lead: { officerEmail: null } }),
    campaignQueueRecord("shared-callback", { dueAt: boundary, lead: { officerEmail: null } }),
    campaignQueueRecord("due-z", { dueAt: boundary }),
    campaignQueueRecord("upcoming-later", { dueAt: "2026-11-10T15:00:00.000Z" }),
    campaignQueueRecord("legacy-callback", { dueAt: boundary, member: { attempts: 0 } }),
    campaignQueueRecord("fresh-a"),
    campaignQueueRecord("due-a", { dueAt: boundary }),
    campaignQueueRecord("due-earlier", { dueAt: "2026-11-09T14:59:59.999Z" }),
    campaignQueueRecord("upcoming-a", { dueAt: soon }),
  ];
  const ids = (items) => items.map(({ member }) => member.leadId);
  const enrollment = ids(records);
  const { dueCallbacks, upcomingCallbacks, firstCalls } = campaignCallQueues(records, Date.parse(boundary));
  assert.deepEqual(ids(dueCallbacks), ["due-earlier", "due-a", "due-z", "legacy-callback"]);
  assert.deepEqual(ids(upcomingCallbacks), ["upcoming-a", "upcoming-z", "upcoming-later"]);
  assert.deepEqual(ids(firstCalls), ["fresh-a"]);
  assert.deepEqual(ids(records), enrollment);
  assert.deepEqual(ids(campaignCallQueues(records, Date.parse(soon)).dueCallbacks),
    ["due-earlier", "due-a", "due-z", "legacy-callback", "upcoming-a", "upcoming-z"]);
});

test("campaign call queues respect holds, opt-outs, pending recovery, and real borrower replies", () => {
  const now = "2026-11-09T15:00:00.000Z";
  const reply = { followUp: { replyReceivedAt: "2026-11-09T14:00:00.000Z" } };
  const records = [
    campaignQueueRecord("closed", { dueAt: now, member: { resolvedAt: now } }),
    campaignQueueRecord("held", { dueAt: now, lead: { heldAt: now } }),
    campaignQueueRecord("lead-opt-out", { dueAt: now, lead: { outreachSuppressed: true } }),
    campaignQueueRecord("member-opt-out", { dueAt: now, member: { outreachSuppressed: true } }),
    campaignQueueRecord("opted-out-outcome", { dueAt: now, member: { lastOutcome: "Opted out" } }),
    campaignQueueRecord("projection-opt-out", { optedOut: true }),
    { ...campaignQueueRecord("missing-lead", { dueAt: now }), lead: undefined },
    campaignQueueRecord("replied-automatic", { dueAt: now, lead: reply }),
    campaignQueueRecord("replied-uncalled", { lead: reply }),
    campaignQueueRecord("replied-callback", { dueAt: now, lead: reply, member: { lastOutcome: "Requested callback" } }),
    campaignQueueRecord("failed-task", { member: { followUpRunStatus: "Failed", followUpRun: { id: "failed-run", dueAt: now } } }),
    campaignQueueRecord("paused-task", { member: { followUpRunStatus: "Paused", followUpRun: { id: "paused-run", dueAt: now } } }),
    campaignQueueRecord("previous-call", { member: { attempts: 1, lastOutcome: "Connected" } }),
  ];
  const { dueCallbacks, upcomingCallbacks, firstCalls } = campaignCallQueues(records, Date.parse(now));
  assert.deepEqual(dueCallbacks.map(({ member }) => member.leadId), ["replied-callback"]);
  assert.deepEqual(upcomingCallbacks, []);
  assert.deepEqual(firstCalls, []);
});

test("Next call uses the officer’s due callbacks before first calls in the selected campaign and segment", () => {
  const officerEmail = "officer@example.test";
  const boundary = "2026-11-09T15:00:00.000Z";
  const earlier = "2026-11-09T14:59:59.999Z";
  const soon = "2026-11-09T15:00:00.001Z";
  const records = [
    campaignQueueRecord("first-later", { lead: { dueAt: soon } }),
    campaignQueueRecord("first-earlier", { lead: { dueAt: earlier } }),
    campaignQueueRecord("callback", { dueAt: boundary, member: { lastOutcome: "Requested callback" } }),
    campaignQueueRecord("upcoming", { dueAt: soon }),
    campaignQueueRecord("shared", { dueAt: earlier, lead: { officerEmail: null } }),
    campaignQueueRecord("other-officer", { dueAt: earlier, lead: { officerEmail: "another@example.test" } }),
    campaignQueueRecord("other-segment", { dueAt: earlier, member: { segmentId: "south" } }),
    campaignQueueRecord("other-campaign", { dueAt: earlier, member: { campaignId: "other" } }),
    campaignQueueRecord("converted", { dueAt: earlier, member: { loanId: "loan" } }),
    campaignQueueRecord("held", { dueAt: earlier, lead: { heldAt: boundary } }),
    campaignQueueRecord("opted-out", { dueAt: earlier, member: { outreachSuppressed: true } }),
  ];
  const snapshot = {
    inboxLeads: records.map(({ lead }) => lead),
    callCampaignMembers: records.map(({ member }) => ({ campaignId: "campaign", segmentId: "north", ...member })),
  };
  const next = (state, time = boundary, completedLeadId) => nextCampaignCallId(state, {
    campaignId: "campaign", segmentId: "north", officerEmail, now: Date.parse(time), completedLeadId,
  });
  assert.equal(next(snapshot), "callback");
  assert.equal(next(snapshot, boundary, "callback"), "first-earlier");
  const updated = { ...snapshot, callCampaignMembers: snapshot.callCampaignMembers.map((member) =>
    member.leadId === "callback" ? { ...member, callbackDueAt: null, lastOutcome: "Connected" } : member) };
  assert.equal(next(updated), "first-earlier");
  assert.equal(next(updated, boundary, "first-earlier"), "first-later");
  assert.equal(next(updated, soon), "upcoming");
  assert.equal(next({ ...updated, inboxLeads: updated.inboxLeads.filter(({ id }) => !id.startsWith("first-")) }), undefined);
});

test("pausing new automatic retries keeps requested callbacks active and preserves the held rule snapshot on release", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-06T17:00:00.000Z") });
  const { campaignId, reserve, leadId, officer, follow, call, control, send, apply, work, runs, recovery } = await campaignRecoveryFixture(t);
  assert.match((await send(control(true, 0), officer)).error, /admin|access/);
  const paused = await apply(control(true, 0));
  assert.equal(paused.callCampaigns[0].automaticPaused, true);
  assert.equal((await apply(control(true, 0))).callCampaigns[0].revision, 1);
  const logged = await apply(call(paused));
  const [held] = runs("Paused");
  assert.equal(held.ruleRevision, 1);
  assert.equal(held.delayDays, 1);
  assert.equal(held.dueAt, "2026-11-09T15:00:00.000Z");
  assert.equal(held.canRetry, false);
  assert.match(work(recovery(held)).error, /Resume new automatic/);
  assert.deepEqual(campaignFollowUpWork(logged), []);

  const requestedAt = new Date(Date.now() + 86_400_000).toISOString();
  const requested = await apply(call(logged, { outcome: "Requested callback", callbackAt: requestedAt }, reserve.id));
  assert.equal(campaignFollowUpWork(requested)[0].dueAt, requestedAt);
  const edited = await apply({ type: "saveCampaignRules", campaignId, revision: 1, voicemailDays: 5, noResponseDays: 2, maxAttempts: 4, retryTime: "16:50" });
  assert.equal(edited.callCampaigns[0].automaticPaused, true);
  assert.match((await send(control(false, 1))).error, /changed/);
  const resumed = await apply(control(false, 2));
  assert.equal(resumed.callCampaigns[0].voicemailDays, 5);
  assert.equal(resumed.callCampaigns[0].retryTime, "16:50");
  assert.equal(runs("Paused")[0].canRetry, true);
  const hold = await apply({ type: "leadHold", leadId, revision: follow(resumed).revision, action: "Hold", reason: "Fictional hold", revisitDate: null });
  assert.match(work(recovery(held)).error, /Reactivate/);
  await apply({ type: "leadHold", leadId, revision: follow(hold).revision, action: "Reactivate" });
  assert.equal(work(recovery(held)).status, "Completed");
  const current = await apply({ type: "refreshWorkspace" });
  assert.equal(campaignFollowUpWork(current).find(({ recordId }) => recordId === leadId).dueAt, held.dueAt);
  assert.equal(follow(current).events.filter(({ kind }) => kind === "Call").length, 1);
  assert.deepEqual(work({ type: "attempts", source: "campaign", id: held.id }).attempts.map(({ status }) => status), ["Completed", "Paused"]);
});

test("new calls and outreach opt-outs retire pending campaign runs", async (t) => {
  const { state, reserve, leadId, call, apply, work, runs, recovery } = await campaignRecoveryFixture(t);
  const first = await apply(call(state, { simulateFollowUpFailure: true }));
  const [stale] = runs("Failed");
  await apply(call(first, { outcome: "Connected" }));
  assert.match(runs("Superseded")[0].reason, /newer campaign call/i);
  assert.ok(work(recovery(stale)).error);
  const second = await apply(call(first, { simulateFollowUpFailure: true }, reserve.id));
  const [pending] = runs("Failed");
  assert.equal(second.callCampaignMembers.find((member) => member.leadId === reserve.id).followUpRunStatus, "Failed");
  const opted = await apply({ type: "leadOptOut", leadId: reserve.id });
  assert.equal(runs("Superseded").find(({ id }) => id === pending.id).reason, "Borrower opted out of outreach.");
  assert.ok(work(recovery(pending)).error);
  assert.equal(opted.callCampaignMembers.find((member) => member.leadId === leadId).attempts, 2);
  assert.deepEqual(campaignFollowUpWork(opted), []);
});

function campaignRecoverySelection(rows) {
  return {
    type: "recoverCampaignFollowUps",
    operationId: crypto.randomUUID(),
    items: rows.map(({ id, attempt, leadRevision, ownerEmail }) => ({ id, attempt, leadRevision, ownerEmail })),
  };
}

test("campaign batch preview distinguishes paused retries, held leads, and requested callbacks, then rechecks assignment", async (t) => {
  const { db, staff, officer, state, campaignId, leadId, reserve, follow, call, control, apply, work, runs } = await campaignRecoveryFixture(t);
  const preview = { type: "previewCampaignRecovery" };
  const paused = await apply(control(true, state.callCampaigns[0].revision));
  const automatic = await apply(call(paused));
  const callbackAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await apply(call(automatic, { outcome: "Requested callback", callbackAt, simulateFollowUpFailure: true }, reserve.id));
  const pending = runs();
  const autoRun = pending.find((run) => run.leadId === leadId);
  const callbackRun = pending.find((run) => run.leadId === reserve.id);

  assert.ok(work(preview, officer).error);
  assert.ok(work(preview, null).error);
  assert.ok(work(preview, staff, crypto.randomUUID()).error);
  const whilePaused = work(preview);
  assert.equal(whilePaused.kind, "campaign-recovery-preview");
  assert.deepEqual(whilePaused.ready.map(({ id, status }) => [id, status]), [[callbackRun.id, "Failed"]]);
  assert.deepEqual(whilePaused.blocked.map(({ id, status }) => [id, status]), [[autoRun.id, "Paused"]]);
  assert.match(whilePaused.blocked[0].blockedReason, /resume|paused/i);
  assert.equal(whilePaused.moreReady, false);
  assert.equal(whilePaused.moreBlocked, false);

  const resumed = await apply(control(false, paused.callCampaigns[0].revision));
  const held = await apply({ type: "leadHold", leadId, revision: follow(resumed).revision, action: "Hold", reason: "Fictional hold", revisitDate: null });
  const whileHeld = work(preview);
  assert.deepEqual(whileHeld.ready.map(({ id }) => id), [callbackRun.id]);
  assert.deepEqual(whileHeld.blocked.map(({ id }) => id), [autoRun.id]);
  assert.match(whileHeld.blocked[0].blockedReason, /reactivate|held|hold/i);
  const released = await apply({ type: "leadHold", leadId, revision: follow(held).revision, action: "Reactivate" });
  const { ready } = work(preview);
  assert.deepEqual(ready.map(({ id, dueAt }) => [id, dueAt]), [[autoRun.id, autoRun.dueAt], [callbackRun.id, callbackAt]]);
  assert.deepEqual(ready.map(({ campaignId, campaignName, borrower, blockedReason }) => [campaignId, campaignName, borrower, blockedReason]),
    [autoRun, callbackRun].map((run) => [campaignId, run.campaignName, run.borrower, null]));
  assert.deepEqual(ready.map(({ owner, ownerEmail, leadRevision }) => [owner, ownerEmail, leadRevision]),
    [[staff.name, staff.email, follow(released).revision], [officer.name, officer.email, follow(released, reserve.id).revision]]);
  assert.deepEqual(ready.map(({ outcome, delayDays }) => [outcome, delayDays]), [["Left message", autoRun.delayDays], ["Requested callback", null]]);

  const batch = campaignRecoverySelection(ready);
  assert.ok(work(batch, officer).error);
  assert.ok(work(batch, staff, crypto.randomUUID()).error);
  assert.ok(work(campaignRecoverySelection([ready[0], ready[0]])).error);
  assert.ok(work(campaignRecoverySelection(Array.from({ length: 21 }, () => ({ ...ready[0], id: crypto.randomUUID() })))).error);
  await apply({ type: "assignInboxLead", leadId, email: officer.email, previousEmail: staff.email });
  const result = work(batch);
  assert.equal(result.kind, "campaign-recovery");
  assert.deepEqual([result.recovered, result.skipped, result.failed], [1, 1, 0]);
  assert.deepEqual(result.rows.map(({ id, status }) => [id, status]), [[autoRun.id, "Skipped"], [callbackRun.id, "Recovered"]]);
  assert.ok(work({ ...batch, items: batch.items.slice(1) }).error);
  assert.ok(work(batch, { ...staff, email: "other-admin@example.test" }).error);

  const [fresh] = work(preview).ready;
  assert.equal(fresh.id, autoRun.id);
  assert.equal(fresh.ownerEmail, officer.email);
  assert.equal(work(campaignRecoverySelection([fresh])).recovered, 1);
  assert.deepEqual(work(batch), result);
  const refreshed = await apply({ type: "refreshWorkspace" }, officer);
  assert.deepEqual(new Map(campaignFollowUpWork(refreshed).map(({ recordId, ownerEmail, dueAt }) => [recordId, [ownerEmail, dueAt]])),
    new Map([[leadId, [officer.email, autoRun.dueAt]], [reserve.id, [officer.email, callbackAt]]]));
  assert.equal(db.prepare("SELECT count(*) AS count FROM lead_import_tasks WHERE leadId IN (?, ?)").get(leadId, reserve.id).count, 2);
  assert.equal(follow(refreshed).events.filter(({ kind }) => kind === "Call").length, 1);
});

test("campaign batch recovery skips a newer call, an opt-out, or a successful single retry after preview", async (t) => {
  const reasons = { "newer call": /newer campaign call/, "opt-out": /opted out/, "single retry": /already scheduled/ };
  for (const change of ["newer call", "opt-out", "single retry"]) {
    await t.test(change, async (t) => {
      const { db, state, leadId, call, apply, work, runs, recovery } = await campaignRecoveryFixture(t);
      const logged = await apply(call(state, { simulateFollowUpFailure: true }));
      const [run] = runs("Failed");
      const batch = campaignRecoverySelection(work({ type: "previewCampaignRecovery" }).ready);
      assert.equal(batch.items.length, 1);
      if (change === "newer call") await apply(call(logged, { outcome: "Connected" }));
      else if (change === "opt-out") await apply({ type: "leadOptOut", leadId });
      else assert.equal(work(recovery(run)).status, "Completed");

      const result = work(batch);
      assert.equal(result.kind, "campaign-recovery");
      assert.deepEqual([result.recovered, result.skipped, result.failed], [0, 1, 0]);
      assert.deepEqual(result.rows.map(({ id, status }) => [id, status]), [[run.id, "Skipped"]]);
      assert.match(result.rows[0].reason, reasons[change]);
      assert.deepEqual(work(batch), result);
      assert.equal(db.prepare("SELECT count(*) AS count FROM lead_import_tasks WHERE leadId = ?").get(leadId).count, change === "single retry" ? 1 : 0);
      assert.equal(work({ type: "attempts", source: "campaign", id: run.id }).attempts.length, change === "single retry" ? 2 : 1);
    });
  }
});

test("campaign batch recovery rolls back unexpected failures and records retryable task-write failures", async (t) => {
  const { db, state, leadId, reserve, call, apply, work } = await campaignRecoveryFixture(t);
  const first = await apply(call(state, { simulateFollowUpFailure: true }));
  const callbackAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await apply(call(first, { outcome: "Requested callback", callbackAt, simulateFollowUpFailure: true }, reserve.id));
  const preview = { type: "previewCampaignRecovery" };
  const { ready } = work(preview);
  const batch = campaignRecoverySelection(ready);
  const [firstRun, secondRun] = ready;
  const taskCount = (id) => db.prepare("SELECT count(*) AS count FROM lead_import_tasks WHERE leadId = ?").get(id).count;
  const attempts = (id) => work({ type: "attempts", source: "campaign", id }).attempts.map(({ status }) => status);

  db.exec(`CREATE TRIGGER interrupt_campaign_attempt BEFORE INSERT ON campaign_follow_up_attempts WHEN NEW.runId = '${secondRun.id}'
    BEGIN SELECT RAISE(ABORT, 'Unexpected campaign attempt failure'); END;`);
  assert.throws(() => work(batch), /Unexpected campaign attempt failure/);
  assert.equal(taskCount(leadId), 0);
  assert.equal(taskCount(reserve.id), 0);
  assert.deepEqual(attempts(firstRun.id), ["Failed"]);
  assert.deepEqual(attempts(secondRun.id), ["Failed"]);
  assert.deepEqual(work(preview).ready, ready);
  db.exec("DROP TRIGGER interrupt_campaign_attempt");

  db.exec(`CREATE TRIGGER interrupt_campaign_task BEFORE INSERT ON lead_import_tasks WHEN NEW.leadId = '${leadId}'
    BEGIN SELECT RAISE(ABORT, 'Fictional campaign task write failure'); END;`);
  const result = work(batch);
  assert.equal(result.kind, "campaign-recovery");
  assert.deepEqual([result.recovered, result.skipped, result.failed], [1, 0, 1]);
  assert.deepEqual(result.rows.map(({ id, status }) => [id, status]), [[firstRun.id, "Failed"], [secondRun.id, "Recovered"]]);
  assert.equal(taskCount(leadId), 0);
  assert.equal(taskCount(reserve.id), 1);
  assert.deepEqual(attempts(firstRun.id), ["Failed", "Failed"]);
  db.exec("DROP TRIGGER interrupt_campaign_task");

  assert.deepEqual(work(batch), result);
  const [fresh] = work(preview).ready;
  assert.equal(fresh.id, firstRun.id);
  assert.equal(fresh.attempt, firstRun.attempt + 1);
  assert.equal(work(campaignRecoverySelection([fresh])).recovered, 1);
  assert.deepEqual(work(batch), result);
  assert.deepEqual(attempts(firstRun.id), ["Completed", "Failed", "Failed"]);
  assert.equal(taskCount(leadId), 1);
});

test("the campaign walkthrough starts empty, tracks its two CSV rows, and stays separate from the referral scenario", async (t) => {
  const { db, staff } = fixture(t);
  const loanOfficer = { ...staff, name: "Pilot LO", email: "lo@example.test", brokerage: { ...staff.brokerage, role: "LO" } };
  const members = [staff, loanOfficer];
  const command = (input, actor = staff) => executeCommand(db, input, actor, undefined, members);
  const id = crypto.randomUUID();
  const load = { type: "loadCampaignRehearsal", id };
  assert.match((await command(load, loanOfficer)).error, /pilot admin/);
  const setup = await command(load);
  assert.ok(setup.state, setup.error);
  assert.deepEqual(setup.state.campaignRehearsal, { campaignId: id, importedCount: 0, leadId: null });
  assert.equal(setup.state.callCampaignMembers.length, 0);
  assert.equal(setup.state.loans.length, 0);
  assert.equal(setup.state.demoGuide, null);
  assert.equal((await command({ ...load, id: crypto.randomUUID() })).state.callCampaigns.length, 1);

  const csv = { type: "migratePipeline", origin: campaignOrigin(id), campaignId: id,
    rows: parseCampaignLeadCsv(campaignRehearsalCsv, "2026-11-03T15:00:00.000Z"), decisions: {} };
  const preview = await command(csv);
  assert.ok(preview.migration, preview.error);
  assert.equal(preview.state.campaignRehearsal.importedCount, 0);
  const imported = await command({ ...csv, preview: preview.migration.fingerprint });
  assert.ok(imported.state, imported.error);
  const rehearsal = imported.state.campaignRehearsal;
  assert.equal(rehearsal.importedCount, 2);
  assert.equal(imported.state.inboxLeads.find(({ id }) => id === rehearsal.leadId).officerEmail, staff.email);
  const reserve = imported.state.inboxLeads.find(({ id }) => id !== rehearsal.leadId);
  assert.equal(reserve.officerEmail, loanOfficer.email);
  const scoped = await command({ type: "refreshWorkspace" }, loanOfficer);
  assert.equal(scoped.state.campaignRehearsal, null);
  assert.deepEqual(scoped.state.callCampaignMembers.map(({ leadId }) => leadId), [reserve.id]);

  const referral = await command({ type: "loadGuidedDemo", id: crypto.randomUUID(), previousId: null });
  assert.ok(referral.state, referral.error);
  assert.deepEqual(referral.state.campaignRehearsal, rehearsal);
  const reset = await command({ type: "loadGuidedDemo", id: crypto.randomUUID(), previousId: referral.state.demoGuide.id });
  assert.ok(reset.state, reset.error);
  assert.deepEqual(reset.state.campaignRehearsal, rehearsal);

  const call = await command({ type: "recordCampaignCall", campaignId: id, leadId: rehearsal.leadId,
    revision: imported.state.inboxLeads.find(({ id }) => id === rehearsal.leadId).followUp.revision,
    outcome: "Connected", note: "Fictional call", callbackAt: null });
  assert.ok(call.state, call.error);
  const converted = await command({ type: "convertReferral", referralId: rehearsal.leadId, contactId: null });
  assert.ok(converted.referralLoanId, converted.error);
  const loanId = converted.referralLoanId;
  const currentScenario = reset.state.demoGuide;
  const samplePartner = reset.state.loans.find(({ id }) => id === currentScenario.rateLoanId).partnerId;
  const link = { type: "linkCampaignSampleRealtor", loanId, scenarioId: currentScenario.id };
  assert.match((await command({ ...link, scenarioId: referral.state.demoGuide.id })).error, /current campaign loan and sample realtor/);
  assert.match((await command({ ...link, loanId: currentScenario.rateLoanId })).error, /current campaign loan and sample realtor/);
  assert.ok((await command(link, loanOfficer)).error);
  assert.match((await command(link, { ...staff, brokerage: { ...staff.brokerage, pilot: false } })).error, /fictional pilot admin/);
  insertContact(db, { id: "existing-realtor", name: "Fictional existing realtor", email: "", phone: "", role: "Realtor" });
  db.prepare("UPDATE loans SET partnerId = 'existing-realtor' WHERE id = ?").run(loanId);
  assert.match((await command(link)).error, /already has a realtor partner/);
  db.prepare("UPDATE loans SET partnerId = NULL WHERE id = ?").run(loanId);
  db.prepare("INSERT INTO submissions (id,loanId,lender,externalId,status) VALUES ('test-handoff',?,'Test Lender','123','Received')").run(loanId);
  assert.match((await command(link)).error, /before sending/);
  db.exec("DELETE FROM submissions WHERE id = 'test-handoff';");
  const linked = await command(link);
  assert.ok(linked.state, linked.error);
  assert.equal(linked.state.loans.find(({ id }) => id === loanId).partnerId, samplePartner);
  assert.ok((await command(link)).state);
  const audit = await command({ type: "loadLoanAudit", loanId });
  assert.deepEqual(audit.loanAudit.filter(({ action }) => action === "Linked sample realtor").map(({ changes }) => changes),
    [[{ field: "Realtor partner", before: null, after: "Taylor Pilot Realtor" }]]);
});

test("an LO conversion refills one eligible campaign slot and preserves scoped access", async (t) => {
  const scenarios = [
    { name: "current rules refill once", shouldRefill: true },
    { name: "stale rules leave the shared queue available", staleRoster: true },
    { name: "an officer still at cap does not trigger a refill", aboveCapacity: true },
  ];
  for (const { name, shouldRefill = false, staleRoster, aboveCapacity } of scenarios) await t.test(name, async (caseContext) => {
    const { db, staff } = fixture(caseContext);
    const officer = { ...staff, name: "Refill LO", email: "refill-lo@example.test", role: "LO", brokerage: { ...staff.brokerage, role: "LO" } };
    const members = [staff, officer];
    const campaignId = crypto.randomUUID();
    const command = (input, actor = staff, options) => executeCommand(db, input, actor, undefined, members, options);
    const apply = async (input, actor, options) => {
      const result = await command(input, actor, options);
      assert.ok(result.state, result.error);
      return result;
    };
    await apply({ type: "createCallCampaign", id: campaignId, name: "Fictional conversion routing" });
    const routing = { type: "saveCampaignRouting", campaignId, revision: 0, enabled: true, officers: members.map(({ email }) => ({ email, limit: 1 })) };
    await apply(routing);
    const csv = ["id,name,phone,email,purpose,zip", ...[1, 2, 3, 4].map((n) =>
      `${n},Fictional Refill ${n},248555010${n},refill-${n}@example.test,Purchase,48067`)].join("\n");
    const payload = { type: "migratePipeline", campaignId, origin: campaignOrigin(campaignId), rows: parseCampaignLeadCsv(csv, new Date().toISOString()), decisions: {} };
    const preview = await apply(payload);
    const imported = await apply({ ...payload, preview: preview.migration.fingerprint });
    const adminLead = imported.state.inboxLeads.find(({ officerEmail }) => officerEmail === staff.email);
    const buyer = imported.state.inboxLeads.find(({ officerEmail }) => officerEmail === officer.email);
    const shared = imported.state.inboxLeads.filter(({ officerEmail }) => !officerEmail);
    assert.equal(shared.length, 2);
    // An earlier hold opens a second slot. Conversion still routes at most one lead.
    await apply({ type: "leadHold", leadId: adminLead.id, revision: adminLead.followUp.revision, action: "Hold", reason: "Fictional hold", revisitDate: null });
    if (staleRoster) await apply({ ...routing, revision: 1 });
    if (aboveCapacity) await apply({ type: "assignInboxLead", leadId: shared[0].id, previousEmail: null, email: officer.email }, officer);
    const waiting = (await apply({ type: "refreshWorkspace" })).state.inboxLeads.filter(({ officerEmail }) => !officerEmail);
    const options = { campaignRefillRoster: { campaignId, revision: 1, members } };
    const conversion = { type: "convertReferral", referralId: buyer.id, contactId: null };
    const refused = await command({ ...conversion, contactId: "fictional-stale-match" }, officer, options);
    assert.match(refused.error, /contact match is unavailable/);
    assert.equal((await apply({ type: "refreshWorkspace" })).state.inboxLeads.filter(({ officerEmail }) => !officerEmail).length, waiting.length);
    const results = await Promise.all([apply(conversion, officer, options), apply(conversion, officer, options)]);
    assert.equal(results[0].referralLoanId, results[1].referralLoanId);
    assert.equal(results.filter(({ message }) => message.includes("shared lead was routed")).length, shouldRefill ? 1 : 0);
    const state = (await apply({ type: "refreshWorkspace" })).state;
    const routed = state.inboxLeads.filter(({ id, officerEmail }) => waiting.some((lead) => lead.id === id) && officerEmail);
    assert.equal(routed.length, shouldRefill ? 1 : 0);
    if (shouldRefill) {
      assert.equal(routed[0].officerEmail, staff.email);
      assert.equal(routed[0].dueAt, waiting.find(({ id }) => id === routed[0].id).dueAt);
      assert.equal(routed[0].followUp.events.filter(({ actor, text }) => actor === officer.name && text === `Assigned to ${staff.name}.`).length, 1);
      assert.ok(results.every(({ state }) => !state.inboxLeads.some(({ id }) => id === routed[0].id)));
    }
  });
});

test("the last unanswered retry refills one campaign slot and keeps the lead available to its officer", async (t) => {
  const { db, staff } = fixture(t);
  const officer = { ...staff, name: "Retry LO", email: "retry-lo@example.test", role: "LO", brokerage: { ...staff.brokerage, role: "LO" } };
  const members = [officer, staff];
  const campaignId = crypto.randomUUID();
  const command = (input, actor = staff, options) => executeCommand(db, input, actor, undefined, members, options);
  const apply = async (input, actor, options) => {
    const result = await command(input, actor, options);
    assert.ok(!result.error, result.error);
    return result;
  };
  await apply({ type: "createCallCampaign", id: campaignId, name: "Fictional retry capacity" });
  await apply({ type: "saveCampaignRouting", campaignId, revision: 0, enabled: true, officers: members.map(({ email }) => ({ email, limit: 1 })) });
  await apply({ type: "saveCampaignRules", campaignId, revision: 0, voicemailDays: 1, noResponseDays: 1, maxAttempts: 2 });
  const csv = ["id,name,phone,email,purpose,zip", ...[1, 2, 3, 4].map((n) =>
    `${n},Fictional Retry ${n},248555019${n},retry-${n}@example.test,Purchase,48067`)].join("\n");
  const rows = parseCampaignLeadCsv(csv, new Date().toISOString()).map((row, index) => ({
    ...row, createdAt: new Date(Date.now() - (4 - index) * 3600_000).toISOString(),
  }));
  const payload = { type: "migratePipeline", campaignId, origin: campaignOrigin(campaignId), rows, decisions: {} };
  const preview = await apply(payload);
  const { state } = await apply({ ...payload, preview: preview.migration.fingerprint });
  const [first, other, waiting, overflow] = [1, 2, 3, 4].map((n) => state.inboxLeads.find(({ name }) => name === `Fictional Retry ${n}`));
  assert.deepEqual([first, other, waiting, overflow].map(({ officerEmail }) => officerEmail), [officer.email, staff.email, null, null]);
  const options = { scopedLeadUpdates: true, campaignRefillRoster: { campaignId, revision: 1, members } };
  const call = (lead, outcome = "No response", callbackAt = null) => ({ type: "recordCampaignCall", campaignId, leadId: lead.id,
    revision: lead.followUp.revision, outcome, callbackAt, note: "Fictional retry result" });
  const initial = await apply(call(first), officer, options);
  assert.ok(initial.leadWork.member.callbackDueAt);
  assert.equal(initial.leadWork.member.retryExhaustedAt, null);
  assert.equal((await apply({ type: "refreshWorkspace" })).state.inboxLeads.find(({ id }) => id === waiting.id).officerEmail, null);
  const lastCall = call(initial.leadWork.lead, "Left message");
  const exhausted = await apply(lastCall, officer, options);
  assert.match(exhausted.message, /attempt limit reached.*shared lead was routed/);
  const queue = exhausted.campaignQueue;
  const retained = queue.inboxLeads.find(({ id }) => id === first.id);
  const replacement = queue.inboxLeads.find(({ id }) => id === waiting.id);
  assert.equal(retained.officerEmail, officer.email);
  assert.equal(replacement.officerEmail, officer.email);
  assert.equal(replacement.dueAt, waiting.dueAt);
  assert.equal(queue.inboxLeads.find(({ id }) => id === overflow.id).officerEmail, null);
  assert.ok(!queue.inboxLeads.some(({ id }) => id === other.id));
  const member = queue.members.find(({ leadId }) => leadId === first.id);
  assert.ok(member.retryExhaustedAt);
  assert.equal(member.callbackDueAt, null);
  assert.equal(member.attempts, 2);
  assert.match((await command(lastCall, officer, options)).error, /lead changed/);
  assert.equal(db.prepare("SELECT count(*) AS count FROM lead_events WHERE leadId = ? AND text LIKE 'Assigned to %'").get(waiting.id).count, 1);

  db.exec("ALTER TABLE call_campaign_members DROP COLUMN retryExhaustedAt");
  initializeStore(db, false);
  const upgraded = (await apply({ type: "refreshCampaignQueue", campaignId }, officer)).campaignQueue;
  assert.equal(upgraded.members.find(({ leadId }) => leadId === first.id).retryExhaustedAt, member.retryExhaustedAt);
  const promisedAt = new Date(Date.now() + 86_400_000).toISOString();
  const callback = await apply(call(retained, "Requested callback", promisedAt), officer, options);
  assert.equal(callback.leadWork.member.retryExhaustedAt, null);
  assert.equal(callback.leadWork.member.callbackDueAt, promisedAt);
  const noAnswer = await apply(call(callback.leadWork.lead), officer, options);
  assert.equal(noAnswer.leadWork.member.retryExhaustedAt, null);
  assert.equal((await apply({ type: "refreshWorkspace" })).state.inboxLeads.find(({ id }) => id === overflow.id).officerEmail, null);
});

test("two-officer routing leaves overflow shared and direct assignment preserves its deadline and scope", async (t) => {
  const { db, staff } = fixture(t);
  const officer = { ...staff, name: "Pilot LO", email: "lo@example.test", role: "LO", brokerage: { ...staff.brokerage, role: "LO" } };
  const roster = [staff, officer];
  const command = (input, actor = staff) => executeCommand(db, input, actor, undefined, roster);
  const campaignId = crypto.randomUUID();
  assert.ok((await command({ type: "createCallCampaign", id: campaignId, name: "Fictional overflow" })).state);
  assert.ok((await command({ type: "saveCampaignRouting", campaignId, revision: 0, enabled: true,
    officers: roster.map(({ email }) => ({ email, limit: 1 })) })).state);
  insertContact(db, { id: "cedar-contact", name: "Fictional Cedar", email: "cedar@example.test", phone: "2485550131", role: "Borrower" });
  const csv = [
    "id,name,phone,email,purpose,zip",
    "row-1,Fictional Cedar,2485550131,cedar@example.test,Purchase,",
    "row-2,Fictional Maple,2485550132,maple@example.test,Refinance,48084",
    "row-3,Fictional Willow,2485550133,willow@example.test,Refinance,",
  ].join("\n");
  const payload = { type: "migratePipeline", campaignId, origin: campaignOrigin(campaignId),
    rows: parseCampaignLeadCsv(csv, new Date().toISOString()), decisions: {} };
  const preview = await command(payload);
  assert.ok(preview.migration.rows.every(({ detail, campaignEnrollment }) =>
    detail.startsWith("Round robin when capacity is available") && campaignEnrollment === undefined));
  const imported = await command({ ...payload, preview: preview.migration.fingerprint });
  assert.ok(imported.state, imported.error);
  const lead = (result, name) => result.state.inboxLeads.find((item) => item.name === `Fictional ${name}`);
  assert.equal(lead(imported, "Cedar").officerEmail, staff.email);
  assert.equal(lead(imported, "Maple").officerEmail, officer.email);
  const overflow = lead(imported, "Willow");
  assert.equal(overflow.officerEmail, null);
  assert.equal(imported.migration.fingerprint, preview.migration.fingerprint);
  assert.deepEqual(imported.migration.rows.map(({ status, detail, campaignEnrollment }) => ({ status, detail, campaignEnrollment })), [
    { status: "Create", detail: `Owner ${staff.name} · Existing contact matched`,
      campaignEnrollment: { owner: staff.name, firstContactDueAt: lead(imported, "Cedar").dueAt } },
    { status: "Create", detail: `Owner ${officer.name}`,
      campaignEnrollment: { owner: officer.name, firstContactDueAt: lead(imported, "Maple").dueAt } },
    { status: "Create", detail: "Shared inbox", campaignEnrollment: { owner: null, firstContactDueAt: overflow.dueAt } },
  ]);
  const replay = await command(payload);
  assert.ok(replay.migration.rows.every(({ status, campaignEnrollment }) => status === "Previously imported" && campaignEnrollment === undefined));
  const replayed = await command({ ...payload, preview: replay.migration.fingerprint });
  assert.deepEqual(replayed.migration.rows, replay.migration.rows);
  const reroute = await command({ type: "routeCampaignQueue", campaignId });
  assert.match(reroute.message, /0 routed · 1 eligible lead remains/);
  assert.equal(lead(reroute, "Willow").officerEmail, null);

  const assign = { type: "assignCampaignLeads", campaignId, email: officer.email, leads: [{ id: overflow.id, previousEmail: null }] };
  assert.ok((await command(assign, officer)).error);
  const assigned = await command(assign);
  assert.equal(lead(assigned, "Willow").officerEmail, officer.email);
  assert.equal(lead(assigned, "Willow").dueAt, overflow.dueAt);
  assert.match((await command({ ...assign, email: staff.email })).error, /owner changed/);
  const scoped = await command({ type: "refreshWorkspace" }, officer);
  assert.deepEqual(scoped.state.callCampaignMembers.map(({ name }) => name).sort(), ["Fictional Maple", "Fictional Willow"]);
  assert.equal(scoped.state.callCampaigns[0].routing, undefined);
  const queue = readOfficerQueue(db, { horizon: 7 }, officer, staff.brokerage.id);
  const task = queue.items.find(({ recordId }) => recordId === overflow.id);
  assert.equal(task.campaignId, campaignId);
  assert.equal(task.dueAt, overflow.dueAt);
  assert.ok(!queue.items.some(({ recordId }) => recordId === lead(imported, "Cedar").id));

  const maple = lead(imported, "Maple");
  const firstContact = queue.items.find(({ recordId }) => recordId === maple.id);
  assert.equal(firstContact?.kind, "lead");
  const request = { leadId: maple.id, task: { kind: "lead", id: firstContact.id } };
  const open = (actor, brokerage = staff.brokerage.id) => readEditableLead(db, request, actor, brokerage);
  const assignedLead = open(officer);
  assert.ok(assignedLead.lead, assignedLead.error);
  assert.equal(assignedLead.lead.officerEmail, officer.email);
  assert.equal(assignedLead.campaign.id, campaignId);
  assert.ok(open({ ...officer, email: "another-lo@example.test" }).error);
  assert.ok(open(officer, crypto.randomUUID()).error);
  const logged = await executeCommand(db, { type: "recordCampaignCall", campaignId, leadId: maple.id,
    revision: assignedLead.lead.followUp.revision, outcome: "Connected", callbackAt: null, note: "Fictional first contact" },
  officer, undefined, roster, { scopedLeadUpdates: true });
  assert.ok(logged.leadWork?.lead.followUp.firstContactAt, logged.error);
  assert.equal(logged.leadWork.member.lastOutcome, "Connected");
  assert.ok(open(officer).error);

  const converted = await command({ type: "convertReferral", referralId: maple.id, contactId: null }, officer);
  assert.ok(converted.referralLoanId, converted.error);
  const { token } = converted.state.applications.find(({ loanId }) => loanId === converted.referralLoanId);
  const { draft } = borrowerCommandResult(db, { type: "read", token }).application;
  assert.deepEqual({ name: draft.borrowerName, email: draft.email, phone: draft.phone, purpose: draft.purpose, zip: draft.propertyLocation.zip },
    { name: "Fictional Maple", email: "maple@example.test", phone: "2485550132", purpose: "Refinance", zip: "48084" });
});

test("manager exceptions combine intake source and campaign without losing other ownership work", async (t) => {
  const { db, staff } = fixture(t);
  const officer = { email: staff.email, name: staff.name, role: "Admin", status: "Active" };
  const at = "2026-11-08T15:00:00.000Z";
  const future = "2026-11-10T15:00:00.000Z";
  const now = Date.parse("2026-11-09T15:00:00.000Z");
  const campaign = crypto.randomUUID();
  const realtor = crypto.randomUUID();
  const add = db.prepare(`INSERT INTO referral_leads
    (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, importSource, realtorId)
    VALUES (?, ?, ?, '', ?, 'Purchase', ?, ?, ?, ?, ?, ?)`);
  insertContact(db, { id: realtor, name: "Fictional agent", email: "", phone: "", role: "Realtor" });
  const leads = {
    website: crypto.randomUUID(), referral: crypto.randomUUID(), csv: crypto.randomUUID(), callback: crypto.randomUUID(),
  };
  add.run(leads.website, "site", "Fictional Website", "2485550131", "", null, at, future, null, null);
  add.run(leads.referral, "referral", "Fictional Realtor Referral", "2485550132", "", null, at, at, null, realtor);
  add.run(leads.csv, "csv", "Fictional CSV", "2485550133", "", null, at, future, "Imported CRM", null);
  add.run(leads.callback, "callback", "Fictional Website Callback", "2485550134", staff.name, staff.email, at, at, null, null);
  db.prepare("INSERT INTO call_campaigns (id,name,createdAt) VALUES (?,'Fictional campaign',?)").run(campaign, at);
  const enroll = db.prepare("INSERT INTO call_campaign_members (campaignId,leadId,joinedAt) VALUES (?,?,?)");
  for (const id of [leads.website, leads.csv, leads.callback]) enroll.run(campaign, id, at);
  const call = await executeCommand(db, { type: "recordCampaignCall", campaignId: campaign, leadId: leads.callback,
    revision: 0, outcome: "Requested callback", note: "Fictional callback", callbackAt: future }, staff);
  assert.ok(call.state, call.error);
  const callback = campaignFollowUpWork(call.state)[0];
  const processing = { kind: "assign", id: "assign:fixture", recordId: "fixture", title: "Assign a processor",
    name: "Fictional loan", owner: "", ownerEmail: null, dueAt: future, reason: "Reviewed 1003" };
  const work = [...playbookWork(call.state), processing];
  const query = (filters, time = now, roster = [officer]) => managerExceptions(call.state, work, roster, true, time,
    { ...defaultManagerExceptionFilters, ...filters });
  const ids = (rows) => rows.map(({ item }) => item.recordId);
  for (const [filters, time, roster] of [
    [{}, now, [officer]],
    [{ type: "Unassigned", source: "Website quote request", campaign }, now, [officer]],
    [{ type: "Overdue", source: "Realtor referral", campaign: "none" }, now, [officer]],
    [{ type: "Overdue", source: "Website quote request", campaign }, Date.parse(future), [officer]],
    [{ type: "Owner unavailable", campaign }, now, []],
  ]) {
    const report = readManagerExceptionWork(db, { view: "owners", filters: { ...defaultManagerExceptionFilters, ...filters } }, staff, roster, new Date(time));
    const comparable = (rows) => rows.filter(({ item }) => item.id !== processing.id)
      .map(({ item, overdue, unassigned, unavailable, stalled, intake }) => ({ item, overdue, unassigned, unavailable, stalled, intake }))
      .sort((a, b) => a.item.id.localeCompare(b.item.id));
    assert.deepEqual(comparable(report.rows), comparable(query(filters, time, roster)));
  }
  assert.ok(ids(query({})).includes(processing.recordId));
  assert.deepEqual(ids(query({ type: "Unassigned", source: "Website quote request", campaign })), [leads.website]);
  const [website] = query({ source: "Website quote request", campaign });
  assert.deepEqual(website.intake, { source: "Website quote request", campaign: { id: campaign, name: "Fictional campaign" } });
  assert.deepEqual(ids(query({ source: "Imported CRM", campaign })), [leads.csv]);
  assert.deepEqual(ids(query({ type: "Overdue", source: "Realtor referral", campaign: "none" })), [leads.referral]);
  assert.deepEqual(query({ source: "Realtor referral", campaign }), []);
  assert.deepEqual(query({ source: "Website quote request", campaign, type: "Overdue" }, Date.parse(future)).find(({ item }) =>
    item.kind === "campaign-follow-up")?.item, callback);
  const unavailable = query({ campaign, type: "Owner unavailable" }, now, []);
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].item.id, callback.id);
  assert.equal(unavailable[0].intake.campaign.id, campaign);
});

test("manager campaign recovery surfaces pending runs before their deadlines and opens the selected run", async (t) => {
  const { db, staff, officer, state, campaignId, leadId, reserve, follow, call, control, apply, work, runs } = await campaignRecoveryFixture(t);
  const paused = await apply(control(true, state.callCampaigns[0].revision));
  const automatic = await apply(call(paused));
  const callbackAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const interrupted = await apply(call(automatic, { outcome: "Requested callback", callbackAt, simulateFollowUpFailure: true }, reserve.id));
  const [autoRun] = runs("Paused");
  const [callbackRun] = runs("Failed");
  const beforeDue = Date.parse(autoRun.dueAt) - 1;
  const members = [staff, officer].map(({ name, email, brokerage }) => ({ name, email, role: brokerage.role, status: "Active" }));
  const query = (snapshot, filters = {}, now = beforeDue) => managerExceptions(snapshot, playbookWork(snapshot), members, true, now,
    { ...defaultManagerExceptionFilters, ...filters });
  const recoveryRows = (rows) => rows.filter(({ item }) => item.kind === "campaign-recovery");
  const ids = (rows) => rows.map(({ item }) => item.id);
  const exactPreview = (runId, actor = staff, brokerage = staff.brokerage.id) =>
    work({ type: "previewCampaignRecovery", runId }, actor, brokerage);

  const all = recoveryRows(query(interrupted));
  assert.deepEqual(all.map(({ item, overdue }) => [item.id, item.recordId, item.dueAt, item.ownerEmail, overdue]), [
    [autoRun.id, leadId, autoRun.dueAt, staff.email, false],
    [callbackRun.id, reserve.id, callbackAt, officer.email, false],
  ]);
  assert.deepEqual(all[0].intake, { source: "Imported CRM", campaign: { id: campaignId, name: autoRun.campaignName } });
  assert.equal(all[0].item.title, "Paused campaign retry");
  assert.match(all[0].item.reason, /paused/i);
  assert.equal(all[1].item.title, "Interrupted campaign follow-up");
  assert.deepEqual(ids(query(interrupted, { type: "Campaign recovery", source: "Imported CRM", campaign: campaignId })), ids(all));
  const scoped = () => readManagerExceptionWork(db, { view: "owners", filters: {
    ...defaultManagerExceptionFilters, type: "Campaign recovery", source: "Imported CRM", campaign: campaignId,
  } }, staff, members, new Date(beforeDue));
  assert.deepEqual(ids(scoped().rows), ids(all));
  assert.deepEqual(query(interrupted, { type: "Campaign recovery", source: "Website quote request" }), []);
  assert.deepEqual(query(interrupted, { type: "Campaign recovery", campaign: "none" }), []);
  assert.deepEqual(query(interrupted, { type: "Campaign recovery", campaign: crypto.randomUUID() }), []);
  assert.deepEqual(recoveryRows(query(interrupted, { type: "Overdue" })), []);
  assert.deepEqual(ids(recoveryRows(query(interrupted, { type: "Overdue" }, Date.parse(autoRun.dueAt)))), [autoRun.id]);

  const callbackPreview = exactPreview(callbackRun.id);
  assert.equal(callbackPreview.kind, "campaign-recovery-preview");
  assert.deepEqual(callbackPreview.ready.map(({ id, dueAt }) => [id, dueAt]), [[callbackRun.id, callbackAt]]);
  assert.deepEqual(callbackPreview.blocked, []);
  assert.equal(callbackPreview.moreReady, false);
  assert.equal(callbackPreview.moreBlocked, false);
  const pausedPreview = exactPreview(autoRun.id);
  assert.deepEqual(pausedPreview.ready, []);
  assert.deepEqual(pausedPreview.blocked.map(({ id }) => id), [autoRun.id]);
  assert.match(pausedPreview.blocked[0].blockedReason, /resume|paused/i);
  assert.ok(exactPreview(callbackRun.id, officer).error);
  assert.ok(exactPreview(callbackRun.id, staff, crypto.randomUUID()).error);
  assert.ok(exactPreview(crypto.randomUUID()).error);

  await apply({ type: "assignInboxLead", leadId, email: officer.email, previousEmail: staff.email });
  const resumed = await apply(control(false, paused.callCampaigns[0].revision));
  const held = await apply({ type: "leadHold", leadId, revision: follow(resumed).revision, action: "Hold", reason: "Fictional hold", revisitDate: null });
  const [heldRow] = query(held, { type: "Campaign recovery" });
  assert.deepEqual([heldRow.item.id, heldRow.item.dueAt, heldRow.item.owner, heldRow.item.ownerEmail],
    [autoRun.id, autoRun.dueAt, officer.name, officer.email]);
  assert.match(heldRow.item.reason, /on hold/i);
  assert.match(scoped().rows.find(({ item }) => item.id === heldRow.item.id).item.reason, /on hold/i);
  const heldPreview = exactPreview(autoRun.id);
  assert.deepEqual(heldPreview.ready, []);
  assert.deepEqual(heldPreview.blocked.map(({ id, ownerEmail }) => [id, ownerEmail]), [[autoRun.id, officer.email]]);
  assert.match(heldPreview.blocked[0].blockedReason, /reactivate|held|hold/i);
});

test("manager deadline pages keep tied work reachable and return the current processing revision", async (t) => {
  const { db, staff } = fixture(t);
  const member = { name: staff.name, email: staff.email, role: "Admin", status: "Active" };
  const roster = [member, { name: "Active processor", email: "processor@example.test", role: "Processor", status: "Active" }];
  const opened = "2026-11-01T15:00:00.000Z";
  const now = new Date("2026-11-03T15:00:00.000Z");
  insertContact(db, { id: "borrower", name: "Fictional borrower", email: "private@example.test", phone: "", role: "Borrower" });
  for (const id of ["assign", "review", "accept", "funded"]) {
    insertLoan(db, { id, contactId: "borrower", partnerId: null, stage: id === "funded" ? "Funded" : "Processing", stageSince: opened,
      officer: staff.name, officerEmail: staff.email, address: "", amount: 100000, purpose: "Purchase" });
    if (id === "funded") {
      db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES ('post-funding:borrower:funded', 'funded', 'Borrower check-in', ?)").run(opened);
      continue;
    }
    assert.ok(startApplication(db, id, opened, staff.brokerage.id));
    db.prepare("UPDATE applications SET submittedAt = ?, reviewedAt = ? WHERE loanId = ?").run(opened, id === "review" ? null : opened, id);
  }
  db.prepare("INSERT INTO loan_processing VALUES ('accept', 'processor@example.test', 'Active processor', 'Ready for processing', '', ?, 7)").run(opened);
  for (let index = 0; index < 27; index++) {
    const id = `lead-${String(index).padStart(2, "0")}`;
    db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, createdAt, dueAt)
      VALUES (?, ?, 'Fictional prospect', 'private@example.test', '', 'Purchase', '', ?, ?)`).run(id, id, opened, opened);
  }
  const input = { view: "owners", filters: defaultManagerExceptionFilters };
  const first = readManagerExceptionWork(db, input, staff, roster, now);
  const next = readManagerExceptionWork(db, { ...input, after: first.next }, staff, roster, now);
  assert.equal(first.rows.length, 20);
  assert.equal(next.rows.length, 11);
  assert.equal(next.next, null);
  const rows = [...first.rows, ...next.rows];
  assert.equal(new Set(rows.map(({ item }) => item.id)).size, 31);
  const old = workspace(db);
  const expected = managerExceptions(old, playbookWork(old), roster, true, now.getTime(), defaultManagerExceptionFilters);
  assert.deepEqual(rows.map(({ item }) => item).sort((a, b) => a.id.localeCompare(b.id)),
    expected.map(({ item }) => item).sort((a, b) => a.id.localeCompare(b.id)));
  const accept = rows.find(({ item }) => item.kind === "accept");
  assert.equal(accept.processingRevision, 7);
  assert.equal(accept.otherOwner, staff.email);
  assert.doesNotMatch(JSON.stringify(rows), /private@example.test|expiresAt|"draft"/);
  assert.ok(readManagerExceptionWork(db, input, { ...staff, brokerage: { ...staff.brokerage, role: "LO" } }, roster, now).error);
});

test("manager campaign recovery removes archived, opted-out, superseded, and recovered runs", async (t) => {
  for (const change of ["archived", "opted out", "newer call", "recovered"]) {
    await t.test(change, async (t) => {
      const { staff, officer, state, leadId, follow, call, apply, work, runs } = await campaignRecoveryFixture(t);
      const interrupted = await apply(call(state, { simulateFollowUpFailure: true }));
      const [run] = runs("Failed");
      const members = [staff, officer].map(({ name, email, brokerage }) => ({ name, email, role: brokerage.role, status: "Active" }));
      const query = (snapshot, type) => managerExceptions(snapshot, playbookWork(snapshot), members, true, Date.parse(run.dueAt),
        { ...defaultManagerExceptionFilters, type }).filter(({ item }) => item.recordId === leadId);
      const preview = { type: "previewCampaignRecovery", runId: run.id };
      assert.deepEqual(query(interrupted, "Campaign recovery").map(({ item }) => item.id), [run.id]);

      let updated;
      if (change === "archived") {
        updated = await apply({ type: "dismissReferral", referralId: leadId, revision: follow(interrupted).revision });
      } else if (change === "opted out") {
        updated = await apply({ type: "leadOptOut", leadId });
      } else if (change === "newer call") {
        updated = await apply(call(interrupted, { outcome: "Connected" }));
      } else {
        assert.equal(work(campaignRecoverySelection(work(preview).ready)).recovered, 1);
        updated = await apply({ type: "refreshWorkspace" });
      }

      assert.deepEqual(query(updated, "Campaign recovery"), []);
      assert.ok(!query(updated, "All exceptions").some(({ item }) => item.id === run.id));
      assert.ok(work(preview).error);
      if (change === "recovered") {
        const [scheduled] = query(updated, "Overdue").filter(({ item }) => item.kind === "campaign-follow-up");
        assert.equal(scheduled.item.dueAt, run.dueAt);
      }
    });
  }
});

test("manager lead drilldown reads the current campaign and contact safeguards without loading the workspace", async (t) => {
  const { db, staff } = fixture(t);
  const at = "2026-11-08T15:00:00.000Z";
  const dueAt = new Date(Date.now() + 86_400_000).toISOString();
  const officer = { email: "recipient@example.test", name: "Fictional receiving officer", role: "LO" };
  const leadId = crypto.randomUUID();
  const otherLeadId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const oldCampaignId = crypto.randomUUID();
  const leadInsert = db.prepare(`INSERT INTO referral_leads
    (id,requestId,name,email,phone,purpose,officer,createdAt,dueAt,importSource)
    VALUES (?,?,'Fictional lead','fictional@example.test','2485550191','Purchase','',?,?,'Imported CRM')`);
  leadInsert.run(leadId, "target", at, dueAt);
  leadInsert.run(otherLeadId, "unrelated", at, dueAt);
  db.prepare("INSERT INTO call_campaigns (id,name,createdAt) VALUES (?,'Old campaign',?), (?,'Current campaign',?)").run(oldCampaignId, at, campaignId, at);
  db.prepare("INSERT INTO call_campaign_members (leadId,campaignId,joinedAt) VALUES (?,?,?)").run(leadId, oldCampaignId, at);
  const original = (await executeCommand(db, { type: "refreshWorkspace" }, staff)).state;
  db.prepare("UPDATE call_campaign_members SET campaignId = ? WHERE leadId = ?").run(campaignId, leadId);
  const assigned = await executeCommand(db, { type: "assignCampaignLeads", campaignId, email: officer.email,
    leads: [{ id: leadId, previousEmail: null }] }, staff, undefined, [officer]);
  assert.ok(assigned.state, assigned.error);
  db.prepare("UPDATE referral_leads SET officer = 'Unrelated change' WHERE id = ?").run(otherLeadId);

  for (let i = 0; i < 505; i++) {
    insertContact(db, { id: `unrelated-${i}`, name: `Fictional unrelated ${i}`, email: `unrelated-${i}@example.test`, phone: "", role: "Borrower" });
  }
  insertContact(db, { id: "z-match", name: "Fictional matching contact", email: "FICTIONAL@example.test", phone: "+1 (248) 555-0191", role: "Borrower" });
  insertContact(db, { id: "z-realtor", name: "Fictional realtor", email: "fictional@example.test", phone: "", role: "Realtor" });
  const statements = [];
  const observed = { ...db, prepare(sql) { statements.push(sql); return db.prepare(sql); } };
  const read = (id = leadId, actor = staff, brokerageId = staff.brokerage.id) => readEditableLead(observed, { leadId: id }, actor, brokerageId);
  assert.ok(read(leadId, { ...staff, brokerage: { ...staff.brokerage, role: "LO" } }).error);
  assert.ok(read(leadId, { ...staff, brokerage: { ...staff.brokerage, role: "Processor" } }).error);
  assert.ok(read(leadId, staff, "other-brokerage").error);
  assert.equal(statements.length, 0);
  const fresh = read();
  assert.equal(fresh.lead.officerEmail, officer.email);
  assert.equal(fresh.lead.dueAt, dueAt);
  assert.equal(fresh.campaign.id, campaignId);
  assert.equal(fresh.member.leadId, leadId);
  assert.deepEqual(fresh.lead.matches, [{ id: "z-match", name: "Fictional matching contact", reason: "Email and phone" }]);
  assert.ok(db.prepare("SELECT 1 FROM contact_outreach_pending WHERE contactId = 'z-match'").get());
  assert.ok(statements.some((sql) => /lead.resolvedAt IS NULL AND lead.id = \?/.test(sql)));
  assert.ok(statements.some((sql) => /WHERE campaign.id = \?/.test(sql)));
  assert.ok(statements.some((sql) => /WHERE member.leadId = \?/.test(sql)));
  assert.ok(!statements.some((sql) => /SELECT loans\.\*|SELECT \* FROM contacts ORDER BY/.test(sql)));
  assert.deepEqual(Object.keys(fresh).sort(), ["campaign", "lead", "member"]);

  const updated = applyLeadWork(original, fresh);
  assert.equal(updated.callCampaignMembers.find((member) => member.leadId === leadId).campaignId, campaignId);
  assert.equal(updated.inboxLeads.find(({ id }) => id === otherLeadId).officer, "");
  assert.equal(updated.loans, original.loans);
  assert.equal(updated.contacts, original.contacts);
  assert.deepEqual(applyLeadWork(updated, fresh), updated);
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture','contact:z-match',NULL,?)").run(at);
  const suppressed = read();
  assert.equal(suppressed.lead.outreachSuppressed, true);
  assert.equal(suppressed.member.outreachSuppressed, true);
  assert.deepEqual(suppressed.lead.matches, fresh.lead.matches);
  db.prepare("UPDATE referral_leads SET resolvedAt = ? WHERE id = ?").run(at, leadId);
  assert.ok(read().error);
});

test("individual lead assignments return only affected work and keep deadlines, reporting and assignment history", async (t) => {
  const { db, staff, officer, state, campaignId, leadId, reserve, call, apply } = await campaignRecoveryFixture(t);
  const dueAt = state.inboxLeads.find(({ id }) => id === leadId).dueAt;
  const callbackAt = new Date(Date.now() + 86_400_000).toISOString();
  const snapshot = await apply(call(state, { outcome: "Requested callback", callbackAt }));
  const assignmentCount = () => db.prepare("SELECT count(*) AS count FROM campaign_assignment_history WHERE leadId = ?").get(leadId).count;
  const before = assignmentCount();
  const statements = [];
  const store = { ...db, prepare(sql) { statements.push(sql); return db.prepare(sql); } };
  const save = (input, actor = staff) => executeCommand(store, input, actor, undefined, [staff, officer], { scopedLeadUpdates: true });
  const inboxAssignment = (id, previousEmail, email) => ({ type: "assignInboxLead", leadId: id, email, previousEmail });
  const reassignment = { type: "assignCampaignLeads", campaignId, email: officer.email, leads: [{ id: leadId, previousEmail: staff.email }] };
  assert.ok((await save(inboxAssignment(reserve.id, reserve.officerEmail, officer.email))).leadWork);
  statements.length = 0;

  const updated = await save(reassignment);
  assert.ok(updated.leadWork, updated.error);
  assert.equal(updated.state, undefined);
  assert.equal(updated.leadWork.lead.dueAt, dueAt);
  assert.equal(updated.leadWork.member.callbackDueAt, callbackAt);
  assert.equal(updated.manager.campaignResponse.currentAssignment.email, officer.email);
  assert.equal(updated.manager.campaignResponse.firstOutreach.assignment.email, staff.email);
  assert.equal(updated.leadWork.lead.followUp.events.filter(({ text }) => text === `Assigned to ${officer.name}.`).length, 1);
  assert.ok(statements.some((sql) => /campaign_assignment_history WHERE leadId = \? ORDER BY id/.test(sql)));
  assert.ok(!statements.some((sql) => /SELECT loans\.\*|SELECT \* FROM contacts ORDER BY|SELECT DISTINCT identityKey FROM outreach_opt_outs/.test(sql)));

  const merged = applyLeadMutation(snapshot, updated);
  assert.equal(merged.inboxLeads.find(({ id }) => id === leadId).officerEmail, officer.email);
  assert.equal(merged.inboxLeads.find(({ id }) => id === reserve.id).officerEmail, reserve.officerEmail);
  assert.equal(merged.managerReports.records.find((item) => item.leadId === leadId).officerEmail, officer.email);
  assert.equal(merged.campaignResponses.find((item) => item.leadId === leadId).currentAssignment.email, officer.email);
  assert.equal(merged.contacts, snapshot.contacts);
  assert.equal(merged.loans, snapshot.loans);

  assert.match((await save(inboxAssignment(leadId, staff.email, null))).error, /owner changed/);
  assert.match((await save({ ...reassignment, email: staff.email, leads: [{ id: leadId, previousEmail: null }] })).error, /owner changed/);
  assert.match((await save(reassignment)).message, /already assigned/);
  assert.equal(assignmentCount(), before + 1);
  assert.equal(readOfficerQueue(db, { horizon: 7 }, officer, staff.brokerage.id).items.find(({ recordId }) => recordId === leadId).dueAt, callbackAt);

  assert.ok((await save(inboxAssignment(leadId, officer.email, null))).leadWork);
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  assert.ok((await save(inboxAssignment(leadId, null, officer.email), processor)).error);
  const claim = await save(inboxAssignment(leadId, null, officer.email), officer);
  assert.equal(claim.leadWork.lead.officerEmail, officer.email);
  assert.equal(claim.leadWork.campaign.routing, undefined);
  assert.equal(claim.leadWork.member.callbackDueAt, callbackAt);
  assert.equal(claim.manager, undefined);

  const bulk = await save({ ...reassignment, email: staff.email, leads: [leadId, reserve.id].map((id) => ({ id, previousEmail: officer.email })) });
  assert.ok(bulk.campaignWork, bulk.error);
  assert.equal(bulk.state, undefined);
  assert.equal(bulk.campaignWork.inboxLeads.find(({ id }) => id === leadId).officerEmail, staff.email);
  assert.equal(bulk.campaignWork.callCampaignMembers.find((member) => member.leadId === leadId).callbackDueAt, callbackAt);
});

test("a stale officer claim cannot pick up a held or opted-out campaign lead", async (t) => {
  const { db, officer, reserve, apply, send, follow } = await campaignRecoveryFixture(t);
  const leadId = reserve.id;
  await apply({ type: "assignInboxLead", leadId, email: null, previousEmail: reserve.officerEmail });
  const shared = await apply({ type: "refreshWorkspace" }, officer);
  assert.equal(shared.inboxLeads.find(({ id }) => id === leadId).officerEmail, null);
  const staleClaim = { type: "assignInboxLead", leadId, email: officer.email, previousEmail: null };
  const held = await apply({ type: "leadHold", leadId, revision: follow(shared, leadId).revision,
    action: "Hold", reason: "Fictional buyer requested a pause", revisitDate: null });
  assert.match((await send(staleClaim, officer)).error, /no longer available to claim/);
  await apply({ type: "leadHold", leadId, revision: follow(held, leadId).revision, action: "Reactivate" });
  await apply({ type: "leadOptOut", leadId });
  assert.match((await send(staleClaim, officer)).error, /no longer available to claim/);
  const lead = db.prepare("SELECT officerEmail, dueAt FROM referral_leads WHERE id = ?").get(leadId);
  assert.equal(lead.officerEmail, null);
  assert.equal(lead.dueAt, reserve.dueAt);
});

test("selected campaign refresh clears stale ownership without replacing unrelated cached work", async (t) => {
  const { staff, officer, campaignId, reserve, apply, send } = await campaignRecoveryFixture(t);
  const queueInput = { type: "refreshCampaignQueue", campaignId };
  const secondId = crypto.randomUUID();
  await apply({ type: "createCallCampaign", id: secondId, name: "Fictional unaffected campaign" });
  const second = { type: "migratePipeline", campaignId: secondId, origin: campaignOrigin(secondId), decisions: {},
    rows: parseCampaignLeadCsv("id,name,phone\nunaffected,Fictional unaffected lead,2485550174", new Date().toISOString()) };
  await apply({ ...second, preview: (await send(second)).migration.fingerprint });
  const before = await apply({ type: "refreshWorkspace" }, officer);
  const own = await send(queueInput, officer);
  assert.equal(own.state, undefined);
  assert.equal(own.campaignQueue.campaign.routing, undefined);
  assert.deepEqual(own.campaignQueue.responses, []);
  assert.deepEqual(own.campaignQueue.inboxLeads.map(({ id }) => id), [reserve.id]);
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  assert.match((await send(queueInput, processor)).error, /access/i);

  await apply({ type: "assignInboxLead", leadId: reserve.id, previousEmail: officer.email, email: staff.email });
  const lost = (await send(queueInput, officer)).campaignQueue;
  assert.deepEqual(lost, { campaignId, campaign: null, members: [], inboxLeads: [], files: [], responses: [], rehearsal: null });
  const merged = applyCampaignQueue(before, lost);
  assert.deepEqual(merged.callCampaigns.map(({ id }) => id), [secondId]);
  assert.deepEqual(merged.inboxLeads, before.inboxLeads.filter((lead) => lead.campaignId === secondId));
  assert.equal(merged.contacts, before.contacts);
  assert.equal(merged.loans, before.loans);
  const adminQueue = (await send(queueInput)).campaignQueue;
  const restored = adminQueue.inboxLeads.find(({ id }) => id === reserve.id);
  assert.equal(restored.officerEmail, staff.email);
  assert.equal(restored.dueAt, reserve.dueAt);
  assert.equal(adminQueue.responses.find(({ leadId }) => leadId === reserve.id).currentAssignment.email, staff.email);
  assert.equal(adminQueue.campaign.routing.enabled, true);
});

test("campaign entry discovers newly assigned campaigns and switch reads only the requested queue", async (t) => {
  const { db, staff, officer, campaignId, reserve, apply, send } = await campaignRecoveryFixture(t);
  const before = await apply({ type: "refreshWorkspace" }, officer);
  const second = crypto.randomUUID();
  const secret = crypto.randomUUID();
  await apply({ type: "createCallCampaign", id: second, name: "New assignment campaign" });
  await apply({ type: "createCallCampaign", id: secret, name: "Private empty campaign" });
  const at = new Date().toISOString();
  const seed = db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, heldAt)
    VALUES (?, ?, ?, '', ?, 'Purchase', ?, ?, ?, ?, ?)`);
  const addLead = (name, phone, owner, heldAt = null) => {
    const id = crypto.randomUUID();
    seed.run(id, id, name, phone, owner?.name ?? "", owner?.email ?? null, at, at, heldAt);
    return id;
  };
  const available = addLead("Fresh existing lead", "2485550134");
  addLead("Held existing lead", "2485550135", undefined, at);
  const blocked = addLead("Suppressed existing lead", "2485550136");
  await apply({ type: "leadOptOut", leadId: blocked });
  const newlyAssigned = addLead("New officer lead", "2485550137", officer);
  await apply({ type: "addCampaignLead", campaignId: second, leadId: newlyAssigned });

  const entry = { type: "openCampaigns", campaignId, loadIntake: true };
  const discovered = await send(entry, officer);
  assert.equal(discovered.state, undefined);
  assert.deepEqual(discovered.campaignNavigation.campaigns.map(({ id }) => id).sort(), [campaignId, second].sort());
  assert.equal(discovered.campaignNavigation.intake, undefined);
  assert.equal(discovered.campaignNavigation.queue.campaign.routing, undefined);
  assert.deepEqual(discovered.campaignNavigation.queue.members.map(({ leadId }) => leadId), [reserve.id]);
  const picked = (await send({ type: "openCampaigns", campaignId: second }, officer)).campaignNavigation;
  assert.equal(picked.queue.campaignId, second);
  assert.deepEqual(picked.queue.members.map(({ leadId }) => leadId), [newlyAssigned]);
  const merged = applyCampaignNavigation(applyCampaignNavigation(before, discovered.campaignNavigation), picked);
  assert.equal(merged.contacts, before.contacts);
  assert.equal(merged.loans, before.loans);
  assert.deepEqual(merged.inboxLeads.filter(({ campaignId: id }) => id === second).map(({ id }) => id), [newlyAssigned]);

  const manager = (await send(entry)).campaignNavigation;
  assert.equal(manager.campaigns.length, 3);
  assert.equal(manager.queue.campaign.routing.enabled, true);
  assert.deepEqual(manager.intake.availableLeads, [{ id: available, name: "Fresh existing lead", phone: "2485550134" }]);
  await apply({ type: "assignInboxLead", leadId: newlyAssigned, email: staff.email, previousEmail: officer.email });
  const revoked = (await send({ type: "openCampaigns", campaignId: second }, officer)).campaignNavigation;
  assert.deepEqual(revoked.campaigns.map(({ id }) => id), [campaignId]);
  assert.equal(revoked.queue.campaignId, campaignId);
  assert.ok(!applyCampaignNavigation(merged, revoked).inboxLeads.some(({ id }) => id === newlyAssigned));
});

test("campaign calls and rescheduling patch the active lead, while opt-out updates matched leads", async (t) => {
  const { db, staff, officer, state, campaignId, leadId, reserve, call } = await campaignRecoveryFixture(t);
  const statements = [];
  const store = { ...db, prepare(sql) { statements.push(sql); return db.prepare(sql); } };
  const save = (input, actor = staff) => executeCommand(store, input, actor, undefined, [staff, officer], { scopedLeadUpdates: true });
  const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
  const callbackAt = daysFromNow(1);
  const reserveCall = await save(call(state, { outcome: "Requested callback", callbackAt }, reserve.id), officer);
  assert.equal(reserveCall.leadWork.member.callbackDueAt, callbackAt);
  assert.equal(reserveCall.manager, undefined);
  assert.equal(reserveCall.leadWork.campaign.routing, undefined);
  statements.length = 0;

  const logged = await save(call(state, { outcome: "Requested callback", callbackAt }));
  assert.ok(logged.leadWork, logged.error);
  assert.equal(logged.state, undefined);
  const { lead, member } = logged.leadWork;
  const callbackId = member.callbackTaskId;
  const firstContactAt = lead.followUp.firstContactAt;
  assert.equal(member.attempts, 1);
  assert.equal(member.callbackDueAt, callbackAt);
  assert.equal(logged.manager.campaignResponse.firstOutreach.at, firstContactAt);
  const patched = applyLeadMutation(state, logged);
  assert.equal(patched.managerReports.records.find((row) => row.leadId === leadId).firstContactAt, firstContactAt);
  assert.equal(patched.callCampaignMembers.find((row) => row.leadId === reserve.id).callbackTaskId, null);

  const movedAt = daysFromNow(2);
  const move = { type: "rescheduleCampaignCallback", campaignId, leadId, revision: lead.followUp.revision,
    callbackAt: movedAt, reason: "Borrower availability changed." };
  assert.match((await save(move, officer)).error, /unavailable/);
  const moved = await save(move);
  assert.ok(moved.leadWork, moved.error);
  assert.equal(moved.leadWork.member.callbackTaskId, callbackId);
  assert.equal(moved.leadWork.member.callbackDueAt, movedAt);
  assert.equal(moved.leadWork.lead.followUp.firstContactAt, firstContactAt);
  assert.match((await save(move)).error, /callback changed/);
  assert.ok(!statements.some((sql) => /SELECT loans\.\*|SELECT \* FROM contacts ORDER BY|SELECT DISTINCT identityKey FROM outreach_opt_outs/.test(sql)));
  const task = () => readOfficerQueue(db, { horizon: 7 }, staff, staff.brokerage.id).items.find(({ id }) => id === callbackId);
  assert.equal(task().dueAt, movedAt);

  const connected = await save(call(applyLeadMutation(patched, moved), { outcome: "Connected" }));
  assert.equal(connected.leadWork.member.lastOutcome, "Connected");
  assert.equal(connected.leadWork.member.callbackDueAt, null);
  assert.equal(task(), undefined);

  db.prepare("UPDATE referral_leads SET phone = ? WHERE id = ?").run(lead.phone, reserve.id);
  const optedOut = await save(call(applyLeadMutation(patched, connected), { outcome: "Opted out" }));
  assert.ok(optedOut.state, optedOut.error);
  assert.equal(optedOut.state.callCampaignMembers.find((row) => row.leadId === reserve.id).outreachSuppressed, true);
  assert.equal(optedOut.state.callCampaignMembers.find((row) => row.leadId === reserve.id).callbackDueAt, null);
});

test("prospective opt-out aliases match the write across indexed and pending contacts", async (t) => {
  const { db, state, leadId } = await campaignRecoveryFixture(t);
  const source = state.inboxLeads.find(({ id }) => id === leadId);
  const contact = (id, email, phone) => insertContact(db, { id, name: "Fictional alias", role: "Borrower", email, phone });
  for (let index = 0; index < 1000; index++) contact(`early-${index}`, "", "");
  contact("z-first", source.email, "2485550185");
  contact("z-second", "second-alias@example.test", "2485550185");
  contact("z-third", "second-alias@example.test", "2485550186");
  contact("z-fourth", "fourth-alias@example.test", "2485550186");

  const projected = prospectiveOptOutKeys(db, { kind: "lead", id: leadId });
  assert.ok(db.prepare("SELECT 1 FROM contact_outreach_pending WHERE contactId = 'z-first'").get());
  assert.ok(projected.has("email:second-alias@example.test"));
  assert.equal(projected.has("phone:2485550186"), false);
  optOutLead(db, leadId, new Date().toISOString());
  assert.deepEqual(outreachSuppressionKeys(db), projected);
  assert.equal(prospectiveOptOutKeys(db, { kind: "lead", id: leadId }).size, 0);

  const contactProjection = prospectiveOptOutKeys(db, { kind: "contact", id: "z-second" });
  assert.ok(contactProjection.has("phone:2485550186"));
  assert.equal(contactProjection.has("email:fourth-alias@example.test"), false);
  optOutContact(db, "z-second", new Date().toISOString());
  assert.deepEqual(outreachSuppressionKeys(db), new Set([...projected, ...contactProjection]));
});

test("opt-out refill uses only newly opened capacity after a manual assignment above cap", async (t) => {
  const { db, staff, officer, campaignId, leadId, reserve, apply, send } = await campaignRecoveryFixture(t);
  const request = { type: "migratePipeline", origin: campaignOrigin(campaignId), campaignId, decisions: {}, rows: parseCampaignLeadCsv(
    "id,name,phone,email,purpose,zip\nwaiting,Fictional consent refill,2485550188,capacity-waiting@example.test,Purchase,48067", new Date().toISOString()) };
  const preview = await send(request);
  const imported = await apply({ ...request, preview: preview.migration.fingerprint });
  const waiting = imported.inboxLeads.find(({ name }) => name === "Fictional consent refill");
  assert.equal(waiting.officerEmail, null);
  await apply({ type: "assignInboxLead", leadId: reserve.id, email: staff.email, previousEmail: officer.email });
  const members = [staff, officer];
  assert.deepEqual(campaignOptOutPlans(db, { kind: "lead", id: leadId }), []);
  const writeOptOut = (input) => executeCommand(db, input, staff, undefined, members,
    { campaignOptOutRoster: { plans: campaignOptOutPlans(db, input.type === "leadOptOut"
      ? { kind: "lead", id: input.leadId } : { kind: "contact", id: input.contactId }), members } });
  const first = await writeOptOut({ type: "leadOptOut", leadId });
  assert.ok(first.state, first.error);
  assert.equal(first.state.inboxLeads.find(({ id }) => id === waiting.id).officerEmail, null);
  assert.equal(first.state.inboxLeads.find(({ id }) => id === leadId).outreachSuppressed, true);
  insertContact(db, { id: "opt-out-reserve-contact", name: "Fictional reserve identity", role: "Borrower", email: reserve.email, phone: reserve.phone });
  const second = await writeOptOut({ type: "optOutContact", contactId: "opt-out-reserve-contact" });
  assert.match(second.message, /A shared lead was routed/);
  const routed = second.state.inboxLeads.find(({ id }) => id === waiting.id);
  assert.ok(routed.officerEmail);
  assert.equal(routed.dueAt, waiting.dueAt);
  assert.equal(second.state.inboxLeads.find(({ id }) => id === reserve.id).outreachSuppressed, true);
});

test("Today lead links follow current ownership and actionable callback state", async (t) => {
  const { db, staff, officer, state, campaignId, leadId, call, apply } = await campaignRecoveryFixture(t);
  const tenant = staff.brokerage.id;
  const firstContact = { leadId, task: { kind: "lead", id: leadId } };
  const read = (request, actor) => readEditableLead(db, request, actor, tenant);
  const queue = (actor) => readOfficerQueue(db, { horizon: 7 }, actor, tenant).items;
  const assign = (from, to) => apply({ type: "assignCampaignLeads", campaignId, email: to.email,
    leads: [{ id: leadId, previousEmail: from.email }] });
  const originalDue = queue(staff).find(({ recordId }) => recordId === leadId).dueAt;
  assert.equal(read(firstContact, staff).lead.dueAt, originalDue);
  assert.match(read(firstContact, officer).error, /no longer in your work queue/);
  const assigned = await assign(staff, officer);
  assert.match(read(firstContact, staff).error, /no longer in your work queue/);
  assert.equal(read({ leadId }, staff).lead.officerEmail, officer.email);
  assert.ok(read({ leadId }, officer).error);
  assert.ok(!queue(staff).some(({ recordId }) => recordId === leadId));
  assert.equal(queue(officer).find(({ recordId }) => recordId === leadId).dueAt, originalDue);

  const { email, phone } = state.inboxLeads.find(({ id }) => id === leadId);
  insertContact(db, { id: "permitted-match", name: "Fictional visible match", role: "Borrower", email, phone, addedBy: officer.email });
  insertContact(db, { id: "restricted-match", name: "Fictional restricted match", role: "Borrower", email, phone });
  const scoped = read(firstContact, officer);
  assert.equal(scoped.campaign.routing, undefined);
  assert.equal(scoped.lead.restrictedMatch, true);
  assert.deepEqual(scoped.lead.matches.map(({ id }) => id), ["permitted-match"]);
  assert.doesNotMatch(JSON.stringify(scoped), /restricted-match|restricted match/);
  assert.ok(read({ ...firstContact, task: { kind: "lead", id: "another-first-contact" } }, officer).error);

  const callbackAt = new Date(Date.now() + 86_400_000).toISOString();
  const called = await apply(call(assigned, { outcome: "Requested callback", callbackAt }), officer);
  const callback = queue(officer).find(({ kind, recordId }) => kind === "campaign" && recordId === leadId);
  const callbackLink = { leadId, task: { kind: "campaign", id: callback.id } };
  assert.equal(callback.dueAt, callbackAt);
  assert.ok(read(firstContact, officer).error);
  assert.equal(read(callbackLink, officer).member.callbackDueAt, callbackAt);
  assert.ok(read({ ...callbackLink, task: { kind: "campaign", id: crypto.randomUUID() } }, officer).error);
  const rescheduledAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  await apply({ type: "rescheduleCampaignCallback", campaignId, leadId,
    revision: called.inboxLeads.find(({ id }) => id === leadId).followUp.revision, callbackAt: rescheduledAt, reason: "Fictional later time" }, officer);
  assert.equal(read(callbackLink, officer).member.callbackDueAt, rescheduledAt);

  const returned = await assign(officer, staff);
  assert.match(read(callbackLink, officer).error, /no longer in your work queue/);
  assert.equal(read(callbackLink, staff).member.callbackDueAt, rescheduledAt);
  assert.ok(!queue(officer).some(({ recordId }) => recordId === leadId));
  assert.ok(queue(staff).some(({ id, dueAt }) => id === callback.id && dueAt === rescheduledAt));
  await apply(call(returned, { outcome: "Connected" }));
  assert.ok(read(callbackLink, staff).error);
});

test("mock campaign drafts use the saved call and stay with the conversation through conversion", async (t) => {
  const { db, staff, officer, state, campaignId, leadId, call, apply } = await campaignRecoveryFixture(t);
  const callbackAt = new Date(Date.now() + 86_400_000).toISOString();
  const logged = await apply(call(state, { outcome: "Requested callback", callbackAt, note: "Private staff note." }));
  const lead = logged.inboxLeads.find(({ id }) => id === leadId);
  const member = logged.callCampaignMembers.find((item) => item.leadId === leadId);
  const source = campaignFollowUpSource(lead, member, Date.now());
  assert.equal(source.callbackAt, callbackAt);
  assert.equal(campaignFollowUpSource(lead, member, Date.parse(callbackAt)), undefined);
  const base = { type: "recordCampaignFollowUp", campaignId, leadId, callEventId: source.callEventId, callbackAt };
  const preview = (channel) => renderCampaignFollowUp(source.outcome, channel, lead.name, lead.officer, callbackAt);
  const email = { ...base, eventId: crypto.randomUUID(), channel: "Email", recipient: campaignFollowUpRecipient("Email", lead),
    revision: lead.followUp.revision, ...preview("Email") };
  assert.match(email.subject, /callback/i);
  assert.match(email.body, /Eastern/);
  assert.doesNotMatch(email.body, /Private staff note/);
  const send = (input, actor = staff) => executeCommand(db, input, actor, undefined, [], { scopedLeadUpdates: true });
  assert.match((await send(email, officer)).error, /unavailable/);
  assert.match((await send(email, { ...staff, brokerage: { ...staff.brokerage, pilot: false } })).error, /fictional pilot/);
  assert.match((await send({ ...email, callEventId: crypto.randomUUID() })).error, /changed/);
  assert.match((await send({ ...email, recipient: "different@example.test" })).error, /changed/);
  assert.match((await send({ ...email, callbackAt: new Date(Date.parse(callbackAt) + 60_000).toISOString() })).error, /changed/);
  const recordedEmail = await send(email);
  assert.match(recordedEmail.message, /Mock email recorded/);
  assert.deepEqual((await send(email)).leadWork, recordedEmail.leadWork);
  assert.match((await send({ ...email, body: "A different draft using the same action." })).error, /already used/);
  assert.equal(recordedEmail.leadWork.member.attempts, member.attempts);
  assert.equal(recordedEmail.leadWork.member.callbackDueAt, callbackAt);
  assert.equal(recordedEmail.leadWork.lead.followUp.firstContactAt, lead.followUp.firstContactAt);
  const text = { ...base, eventId: crypto.randomUUID(), channel: "Text", recipient: campaignFollowUpRecipient("Text", lead),
    revision: recordedEmail.leadWork.lead.followUp.revision, ...preview("Text") };
  const recordedText = await send(text);
  assert.match(recordedText.message, /Mock text recorded/);
  const tenant = staff.brokerage.id;
  const thread = readConversations(db, { type: "lead", leadId }, staff, tenant);
  assert.equal(thread.kind, "thread");
  assert.equal(thread.thread.campaignCallback.dueAt, callbackAt);
  assert.deepEqual(new Set(thread.events.filter(({ origin }) => origin === "Simulated").map(({ id }) => id)), new Set([email.eventId, text.eventId]));
  assert.equal(thread.events.filter(({ channel }) => channel === "Call").length, 1);
  assert.equal(thread.thread.status, "Open");
  assert.equal(db.prepare("SELECT count(*) AS count FROM lead_events WHERE leadId = ? AND outcome = 'Sent update'").get(leadId).count, 0);

  const alias = crypto.randomUUID();
  insertContact(db, { id: alias, name: "Fictional opt-out alias", email: lead.email, phone: "", role: "Borrower" });
  await apply({ type: "optOutContact", contactId: alias });
  assert.match((await send({ ...email, eventId: crypto.randomUUID() })).error, /opted out/);
  const conversion = await executeCommand(db, { type: "convertReferral", referralId: leadId, contactId: alias }, staff);
  assert.ok(conversion.referralLoanId, conversion.error);
  const carried = readConversations(db, { type: "thread", id: thread.thread.id }, staff, tenant);
  assert.equal(carried.thread.loanId, conversion.referralLoanId);
  assert.equal(carried.events.filter(({ origin }) => origin === "Simulated").length, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM activity WHERE loanId = ? AND text LIKE 'Mock campaign follow-up recorded%'")
    .get(conversion.referralLoanId).count, 2);
});

test("rescheduling a campaign callback keeps the original call, task, and owner history", async (t) => {
  const { db, staff } = fixture(t);
  const officer = { ...staff, name: "Pilot LO", email: "lo@example.test", role: "LO", brokerage: { ...staff.brokerage, role: "LO" } };
  const another = { ...officer, name: "Second LO", email: "other@example.test" };
  const processor = { ...another, brokerage: { ...staff.brokerage, role: "Processor" } };
  const command = (input, actor = staff) => executeCommand(db, input, actor, undefined, [staff, officer, another]);
  const apply = async (input, actor) => {
    const result = await command(input, actor);
    assert.ok(result.state, result.error);
    return result;
  };
  const campaignId = crypto.randomUUID();
  await apply({ type: "loadCampaignRehearsal", id: campaignId, buyerEmail: officer.email });
  const csv = { type: "migratePipeline", origin: campaignOrigin(campaignId), campaignId,
    rows: parseCampaignLeadCsv(campaignRehearsalCsv, new Date().toISOString()), decisions: {} };
  const preview = await apply(csv);
  const imported = await apply({ ...csv, preview: preview.migration.fingerprint });
  const leadId = imported.state.campaignRehearsal.leadId;
  const lead = (result) => result.state.inboxLeads.find(({ id }) => id === leadId);
  const member = (result) => result.state.callCampaignMembers.find((item) => item.leadId === leadId);
  const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
  const originalTime = daysFromNow(1);
  const newTime = daysFromNow(2);
  const logged = await apply({ type: "recordCampaignCall", leadId, campaignId, revision: lead(imported).followUp.revision,
    outcome: "Requested callback", note: "Borrower asked for a callback · confirm the estimate.", callbackAt: originalTime }, officer);
  const taskId = member(logged).callbackTaskId;
  const request = lead(logged).followUp.events.find(({ kind }) => kind === "Call");
  const campaignName = logged.state.callCampaigns.find(({ id }) => id === campaignId).name;
  const promise = { requestEventId: request.id, originalDueAt: originalTime, dueAt: originalTime };
  assert.deepEqual(member(logged).callbackPromise, promise);
  assert.equal(campaignCallNote(request, campaignName), "Borrower asked for a callback · confirm the estimate.");
  assert.equal(campaignCallNote(request, "Renamed imported campaign"), request.text);
  const [exception] = campaignFollowUpWork(logged.state);
  assert.deepEqual({ id: exception.id, campaignId: exception.campaignId, recordId: exception.recordId, title: exception.title,
    dueAt: exception.dueAt, ownerEmail: exception.ownerEmail },
  { id: taskId, campaignId, recordId: leadId, title: "Campaign callback", dueAt: originalTime, ownerEmail: officer.email });
  assert.ok(!playbookWork(logged.state).some((item) => item.recordId === leadId && item.kind === "lead"));
  assert.deepEqual(campaignFollowUpWork((await apply({ type: "refreshWorkspace" }, another)).state), []);
  const revision = lead(logged).followUp.revision;
  const move = { type: "rescheduleCampaignCallback", leadId, campaignId, revision, callbackAt: newTime, reason: "Borrower changed availability." };
  assert.match((await command(move, another)).error, /unavailable/);
  assert.match((await command(move, processor)).error, /access/);
  assert.match((await command({ ...move, callbackAt: daysFromNow(-1) }, officer)).error, /future/);
  assert.match((await command({ ...move, callbackAt: originalTime }, officer)).error, /different/);
  const moved = await apply(move, officer);
  assert.deepEqual(member(moved), { ...member(logged), callbackDueAt: newTime, callbackPromise: { ...promise, dueAt: newTime } });
  assert.deepEqual(campaignFollowUpWork(moved.state), [{ ...exception, dueAt: newTime }]);
  assert.equal(lead(moved).followUp.firstContactAt, lead(logged).followUp.firstContactAt);
  assert.equal(lead(moved).followUp.revision, revision + 1);
  assert.deepEqual(lead(moved).importedTasks, lead(logged).importedTasks.map((task) => ({ ...task, dueAt: newTime })));
  assert.match(lead(moved).followUp.events[0].text, /Callback moved from .+ to .+ Borrower changed availability/);
  assert.equal(lead(moved).followUp.events.filter(({ kind }) => kind === "Call").length, 1);
  assert.match((await command(move, officer)).error, /changed/);

  const held = await apply({ type: "leadHold", leadId, revision: revision + 1, action: "Hold", reason: "Borrower asked to pause.", revisitDate: null }, officer);
  assert.deepEqual(campaignFollowUpWork(held.state), []);
  assert.match((await command({ ...move, revision: lead(held).followUp.revision, callbackAt: daysFromNow(3) }, officer)).error, /Reactivate/);
  await apply({ type: "leadHold", leadId, revision: lead(held).followUp.revision, action: "Reactivate" }, officer);
  const assigned = await apply({ type: "assignInboxLead", leadId, email: another.email, previousEmail: officer.email });
  assert.deepEqual(campaignFollowUpWork(assigned.state), [{ ...exception, dueAt: newTime, owner: another.name, ownerEmail: another.email }]);
  const moveAgain = { ...move, revision: lead(assigned).followUp.revision, callbackAt: daysFromNow(4) };
  assert.match((await command(moveAgain, officer)).error, /unavailable/);
  const reassigned = await apply(moveAgain, another);
  assert.equal(member(reassigned).callbackTaskId, taskId);
  assert.equal(lead(reassigned).officerEmail, another.email);
  assert.equal(lead(reassigned).followUp.events[0].actor, another.name);
  const optedOut = await apply({ type: "leadOptOut", leadId }, another);
  assert.deepEqual(campaignFollowUpWork(optedOut.state), []);
  assert.ok(lead(optedOut).importedTasks[0].completedAt);
  assert.match((await command({ ...moveAgain, revision: lead(optedOut).followUp.revision, callbackAt: daysFromNow(5) }, another)).error, /unavailable/);
  assert.equal(member(optedOut).attempts, 1);
  assert.equal(member(optedOut).callbackPromise, undefined);

  const reserve = imported.state.inboxLeads.find((item) => item.id !== leadId);
  const retry = await apply({ type: "recordCampaignCall", leadId: reserve.id, campaignId, revision: reserve.followUp.revision,
    outcome: "Left message", note: "", callbackAt: null });
  assert.equal(campaignFollowUpWork(retry.state)[0]?.title, "Campaign call retry");
  assert.equal(retry.state.callCampaignMembers.find((item) => item.leadId === reserve.id).callbackPromise, undefined);
  const retryCall = retry.state.inboxLeads.find(({ id }) => id === reserve.id).followUp.events.find(({ kind }) => kind === "Call");
  assert.equal(campaignCallNote(retryCall, campaignName), "");
  const closed = await apply({ type: "recordCampaignCall", leadId: reserve.id, campaignId,
    revision: retry.state.inboxLeads.find((item) => item.id === reserve.id).followUp.revision,
    outcome: "Connected", note: "", callbackAt: null });
  assert.deepEqual(campaignFollowUpWork(closed.state), []);
});

test("a campaign acknowledgment stays linked to one lender file through retry, upgrade, and correction", async (t) => {
  const { db, staff } = fixture(t);
  const command = (input, actor = staff) => executeCommand(db, input, actor, undefined, [staff]);
  const apply = async (input) => {
    const result = await command(input);
    assert.ok(result.state, result.error);
    return result;
  };
  const campaignId = crypto.randomUUID();
  await apply({ type: "loadCampaignRehearsal", id: campaignId });
  const csv = { type: "migratePipeline", origin: campaignOrigin(campaignId), campaignId,
    rows: parseCampaignLeadCsv(campaignRehearsalCsv, "2026-11-03T15:00:00.000Z"), decisions: {} };
  const preview = await apply(csv);
  const { state: imported } = await apply({ ...csv, preview: preview.migration.fingerprint });
  const converted = await apply({ type: "convertReferral", referralId: imported.campaignRehearsal.leadId, contactId: null });
  const loanId = converted.referralLoanId;
  const { token } = converted.state.applications.find((item) => item.loanId === loanId);
  const draft = borrowerCommandResult(db, { type: "read", token }).application;
  const submitted = borrowerCommandResult(db, { type: "submit", token, revision: draft.revision, step: 9,
    draft: { ...sampleApplication(draft.draft), confirmedDemo: true } }).application;
  const revision = submitted.revision;
  await apply({ type: "reviewApplication", loanId, revision });
  const ack = { type: "acknowledgeCampaignLenderExport", loanId, revision, lenderRevision: 0, eventId: crypto.randomUUID() };
  assert.match((await command(ack)).error, /Prepare the MISMO export/);
  const exported = { type: "exportReviewedApplication", loanId, revision, lenderRevision: 0, eventId: crypto.randomUUID(),
    names: [{ first: "Jordan", middle: "", last: "Buyer", suffix: "" }] };
  await apply(exported);
  assert.match((await command(ack)).error, /Save a mock quote/);
  assert.equal(db.prepare("SELECT count(*) AS count FROM submissions").get().count, 0);
  const priced = await apply({ type: "runPricing", loanId, applicationRevision: revision, scenario: {
    purpose: "Purchase", loanAmount: 360000, propertyValue: 450000, purchasePrice: null, zip: "48304", creditScore: 742,
    monthlyIncome: 7500, occupancy: "Primary residence", propertyType: "Single family", firstTimeBuyer: false,
  } });
  const quote = priced.state.pricingRuns[0];
  await apply({ type: "selectOffer", loanId, runId: quote.id, offerId: quote.offers[0].id });
  assert.match((await command(ack, { ...staff, brokerage: { ...staff.brokerage, pilot: false } })).error, /fictional campaign loan/);
  const saveCheckpoint = (requireSecondReview) => apply({ type: "savePlaybook", ...workspace(db).playbook, requireSecondReview });
  await saveCheckpoint(true);
  assert.match((await command(ack)).error, /approved second review/i);
  assert.equal(db.prepare("SELECT count(*) AS count FROM submissions").get().count, 0);
  await saveCheckpoint(false);
  const { state: acknowledged } = await apply(ack);
  assert.equal(acknowledged.applications[0].manualHandoff.outcome, "Acknowledged");
  assert.equal(acknowledged.submissions.length, 1);
  const file = acknowledged.submissions[0];
  assert.equal(file.lender, "Fictional demo lender");
  assert.equal(file.syncedAt, null);
  assert.equal(acknowledged.applications[0].manualHandoff.submissionId, file.id);
  const { state: worked } = await apply({ type: "saveManualCondition", loanId, submissionId: file.id, conditionId: crypto.randomUUID(),
    revision: 0, category: "Income", description: "Provide a sample pay stub.", owner: "Loan officer" });
  for (const request of [ack, { ...ack, eventId: crypto.randomUUID() }]) {
    assert.deepEqual((await apply(request)).state.submissions, worked.submissions);
  }
  const auditCount = () => db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Recorded simulated lender acknowledgment'").get().count;
  assert.equal(auditCount(), 1);
  await saveCheckpoint(true);
  assert.deepEqual((await apply(ack)).state.submissions, worked.submissions);
  assert.equal(auditCount(), 1);
  await saveCheckpoint(false);
  await apply({ type: "saveLenderDetails", loanId, revision: 0, details: blankLenderDetails() });
  assert.match((await command(ack)).error, /Lender details changed/);
  const refreshedAck = { ...ack, lenderRevision: 1, eventId: crypto.randomUUID() };
  assert.match((await command(refreshedAck)).error, /Prepare the MISMO export/);
  await apply({ ...exported, lenderRevision: 1, eventId: crypto.randomUUID() });
  assert.deepEqual((await apply(refreshedAck)).state.submissions, worked.submissions);
  assert.equal(auditCount(), 2);
  // Simulated acknowledgments issued before this version did not store the checklist ID.
  db.prepare("UPDATE application_handoff_events SET submissionId = NULL WHERE loanId = ? AND outcome = 'Acknowledged'").run(loanId);
  initializeStore(db, false);
  assert.equal((await apply(refreshedAck)).state.applications[0].manualHandoff.submissionId, file.id);
  assert.equal(auditCount(), 2);

  const returned = await apply({ type: "requestApplicationCorrection", loanId, revision, note: "Correct the fictional loan amount.",
    lenderReturn: { eventId: crypto.randomUUID(), lenderRevision: 1, submissionId: file.id } });
  assert.equal(returned.state.submissions[0].status, "Returned for changes");
  assert.equal(returned.state.applications[0].lastManualSubmissionId, file.id);
  assert.equal(returned.state.applications[0].manualHandoff?.submissionId, undefined);
  const correction = borrowerCommandResult(db, { type: "read", token }).application;
  const corrected = borrowerCommandResult(db, { type: "submit", token, revision: correction.revision, step: 9,
    draft: { ...correction.draft, loanAmount: "359500" } }).application;
  await apply({ type: "reviewApplication", loanId, revision: corrected.revision });
  const revised = { type: "recordManualHandoff", loanId, revision: corrected.revision, lenderRevision: 1,
    eventId: crypto.randomUUID(), outcome: "Acknowledged", note: "", lenderFile: { lender: file.lender, externalId: file.externalId } };
  assert.match((await command(revised)).error, /Prepare the MISMO export/);
  await apply({ ...exported, revision: corrected.revision, lenderRevision: 1, eventId: crypto.randomUUID() });
  const reacknowledged = (await apply(revised)).state;
  assert.equal(reacknowledged.applications[0].manualHandoff.submissionId, file.id);
  assert.equal(reacknowledged.submissions.length, 1);
  assert.deepEqual(reacknowledged.submissions[0].conditions, worked.submissions[0].conditions);
});

test("a selected walkthrough officer gets the buyer by source ID and must still be active when the CSV commits", async (t) => {
  const { db, staff } = fixture(t);
  const officer = { ...staff, name: "Pilot LO", email: "lo@example.test", role: "LO", brokerage: { ...staff.brokerage, role: "LO" } };
  const another = { email: "another-lo@example.test", name: "Another pilot LO", role: "LO" };
  const otherAdmin = { email: "another-admin@example.test", name: "Another pilot admin", role: "Admin" };
  const id = crypto.randomUUID();
  let members = [staff, officer, another, otherAdmin];
  const command = (input, actor = staff) => executeCommand(db, input, actor, undefined, members);
  const setup = { type: "loadCampaignRehearsal", id, buyerEmail: officer.email };
  assert.match((await command({ ...setup, buyerEmail: "other-brokerage@example.test" })).error, /active loan officer/);
  assert.match((await command({ ...setup, buyerEmail: otherAdmin.email })).error, /active loan officer/);
  const ready = await command(setup);
  assert.ok(ready.state, ready.error);
  assert.equal(ready.state.campaignRehearsal.buyerEmail, officer.email);
  assert.deepEqual(ready.state.callCampaigns[0].routing.officers.map(({ email }) => email), [officer.email, staff.email]);

  const rows = parseCampaignLeadCsv(campaignRehearsalCsv, "2026-11-03T15:00:00.000Z")
    .reverse().map((row) => ({ ...row, ownerEmail: staff.email }));
  const csv = { type: "migratePipeline", origin: campaignOrigin(id), campaignId: id, rows, decisions: {} };
  const preview = await command(csv);
  assert.ok(preview.migration, preview.error);
  assert.match(preview.migration.rows.find(({ key }) => key === "Lead:rehearsal-buyer").detail, /Pilot LO/);
  members = [staff, another];
  assert.match((await command({ ...csv, preview: preview.migration.fingerprint })).error, /preview changed/i);
  const stale = await command(csv);
  assert.equal(stale.migration.rows.find(({ key }) => key === "Lead:rehearsal-buyer").status, "Review");
  assert.match(stale.migration.rows.find(({ key }) => key === "Lead:rehearsal-buyer").detail, /unavailable/);
  assert.equal(stale.state.inboxLeads.length, 0);
  members = [staff, { ...officer, role: "Admin" }, another];
  assert.equal((await command(csv)).migration.rows.find(({ key }) => key === "Lead:rehearsal-buyer").status, "Review");

  const updated = await command({ ...setup, buyerEmail: another.email });
  assert.equal(updated.state.campaignRehearsal.buyerEmail, another.email);
  members = [staff, officer, another];
  assert.ok((await command(setup)).state);
  const next = await command(csv);
  const imported = await command({ ...csv, preview: next.migration.fingerprint });
  assert.ok(imported.state, imported.error);
  const rehearsal = imported.state.campaignRehearsal;
  assert.equal(imported.state.inboxLeads.find(({ id }) => id === rehearsal.leadId).officerEmail, officer.email);
  assert.equal(imported.state.inboxLeads.find(({ id }) => id !== rehearsal.leadId).officerEmail, staff.email);
  assert.match((await command({ ...setup, buyerEmail: another.email })).error, /campaign assignments/);

  const scoped = await command({ type: "refreshWorkspace" }, officer);
  assert.deepEqual(scoped.state.campaignRehearsal, { campaignId: id, leadId: rehearsal.leadId, importedCount: 2 });
  assert.deepEqual(scoped.state.callCampaignMembers.map(({ leadId }) => leadId), [rehearsal.leadId]);
});

test("CRM export round trips ownership, hold, suppression, and follow-ups into a different pilot", async (t) => {
  const source = fixture(t);
  const destination = fixture(t);
  const officer = { email: "lo@example.test", name: "Pilot LO" };
  const at = "2026-11-03T15:00:00.000Z";
  const dueAt = "2026-11-04T15:00:00.000Z";
  const borrower = { id: "borrower-1", name: "Casey Fictional", email: "casey@example.test", phone: "+1 248 555 0131", role: "Borrower" };
  const realtor = { id: "realtor-1", name: "Fictional Realtor", email: "partner@example.test", phone: "", role: "Realtor" };
  insertContact(source.db, borrower);
  insertContact(source.db, realtor);
  insertContact(destination.db, { ...realtor, id: "destination-realtor" });
  source.db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt,
    realtorId, importedContactId, heldAt, holdReason, revisitDate)
    VALUES ('lead-1', 'lead-1', ?, ?, ?, 'Purchase', ?, ?, ?, ?, ?, ?, ?, 'Wait for new timeline', '2026-11-19')`)
    .run(borrower.name, borrower.email, borrower.phone, officer.name, officer.email, at, dueAt, realtor.id, borrower.id, at);
  source.db.prepare("INSERT INTO lead_follow_up (leadId, firstContactAt) VALUES ('lead-1', ?)").run(at);
  optOutLead(source.db, "lead-1", at);
  const note = '=Fictional, with "quotes"\nand a second line.';
  const reminderText = "Confirm the timeline. ".repeat(70).trim();
  source.db.prepare("INSERT INTO lead_events (id, leadId, at, actor, kind, outcome, text) VALUES ('note-1', 'lead-1', ?, 'Pilot LO', 'Call', 'Connected', ?)")
    .run(at, note);
  source.db.prepare(`INSERT INTO lead_import_tasks (id, leadId, title, dueAt, purpose)
    VALUES ('task-1', 'lead-1', 'Review requested paperwork', ?, 'Loan service')`).run(dueAt);
  source.db.prepare(`INSERT INTO contact_activity (id, contactId, officer, officerEmail, kind, outcome, text, createdAt, dueAt,
    completedAt, purpose, followUpOwner, followUpOwnerEmail)
    VALUES ('task-2', ?, ?, ?, 'Email', 'Sent update', ?, ?, ?, ?, 'Loan service', ?, ?)`)
    .run(borrower.id, officer.name, officer.email, reminderText, at, dueAt, dueAt, officer.name, officer.email);

  assert.ok(exportPilotPipeline(source.db, { ...source.staff, brokerage: { ...source.staff.brokerage, role: "LO" } }).error);
  const result = exportPilotPipeline(source.db, source.staff);
  assert.equal(result.total, 6);
  const [{ csv }] = result.batches;
  assert.match(csv, /"'=Fictional/);
  assert.match(csv, /"'\+1 248/);
  const file = migrationFile(csv);
  assert.equal(file.orbitSource, result.origin);
  const rows = mappedMigrationRows(file, file.mapping);
  const input = { type: "migratePipeline", origin: result.origin, rows, batch: file.batch,
    decisions: { "Contact:realtor-1": "destination-realtor" } };
  const command = (data) => executeCommand(destination.db, data, destination.staff, undefined, [officer]);
  const preview = await command(input);
  assert.ok(preview.migration, preview.error);
  assert.ok(preview.migration.rows.every((row) => row.status === "Create" || row.status === "Reuse contact"));
  const restored = await command({ ...input, preview: preview.migration.fingerprint });
  assert.ok(restored.state, restored.error);
  const [lead] = restored.state.inboxLeads;
  assert.equal(lead.realtorId, "destination-realtor");
  assert.equal(lead.officerEmail, officer.email);
  assert.equal(lead.phone, borrower.phone);
  assert.equal(lead.outreachSuppressed, true);
  assert.equal(lead.heldAt, at);
  assert.equal(lead.revisitDate, "2026-11-19");
  assert.equal(lead.followUp.firstContactAt, at);
  assert.equal(lead.followUp.events[0].text, note);
  assert.equal(lead.followUp.events[0].outcome, "Connected");
  assert.equal(lead.importedTasks[0].dueAt, dueAt);
  assert.equal(restored.state.contactActivity[0].followUpOwnerEmail, officer.email);
  assert.equal(restored.state.contactActivity[0].text, reminderText);
  assert.equal(restored.state.contactActivity[0].completedAt, dueAt);
  assert.ok((await command(input)).migration.rows.every((row) => row.status === "Previously imported"));
});

test("numbered CRM batches restore tracked campaign promises, exact call evidence, and the mapped owner", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(promiseStart) });
  const source = await campaignRecoveryFixture(t);
  const destination = fixture(t);
  destination.staff.email = "destination-admin@example.test";
  const owner = { name: "Receiving LO", email: "receiving@example.test", role: "LO", status: "Active",
    brokerage: { ...destination.staff.brokerage, role: "LO" } };
  const { db, staff, leadId, reserve, state, apply, call, campaignId } = source;
  const firstDue = "2026-11-09T16:00:00.000Z";
  const missedDue = "2026-11-09T17:00:00.000Z";
  const scheduled = "2026-11-10T17:00:00.000Z";
  const failedDue = "2026-11-09T17:10:00.000Z";
  await apply({ type: "assignInboxLead", leadId: reserve.id, email: staff.email, previousEmail: reserve.officerEmail });
  let current = await apply(call(state, { outcome: "Requested callback", callbackAt: firstDue, note: "Initial promise" }));
  t.mock.timers.setTime(Date.parse("2026-11-09T15:30:00.000Z"));
  current = await apply(call(current, { outcome: "Requested callback", callbackAt: missedDue, note: "Attempt and replacement promise" }));
  t.mock.timers.setTime(Date.parse("2026-11-09T17:05:00.000Z"));
  current = await apply({ type: "rescheduleCampaignCallback", campaignId, leadId, callbackAt: scheduled, reason: "Moved after the promised time",
    revision: source.follow(current).revision });
  await apply(call(current, { outcome: "Requested callback", callbackAt: failedDue, note: "Interrupted callback", simulateFollowUpFailure: true }, reserve.id));
  t.mock.timers.setTime(Date.parse("2026-11-09T17:15:00.000Z"));

  const beforePromises = db.prepare(`SELECT (SELECT count(*) FROM contacts) + (SELECT count(*) FROM referral_leads) +
    (SELECT count(*) FROM lead_events) + (SELECT count(*) FROM lead_import_tasks) +
    (SELECT count(*) FROM contact_activity WHERE dueAt IS NOT NULL) AS total`).get().total;
  for (let n = beforePromises; n < 100; n++) {
    insertContact(db, { id: `pad-${n}`, name: `Fictional contact ${n}`, email: `pad-${n}@example.test`, phone: "", role: "Borrower" });
  }
  const snapshot = exportPilotPipeline(db, staff);
  assert.ok(snapshot.batches, snapshot.error);
  assert.deepEqual(snapshot.batches.map(({ count }) => count), [100, 2]);
  const batches = snapshot.batches.map(({ csv }) => {
    const file = migrationFile(csv);
    return { type: "migratePipeline", origin: snapshot.origin, rows: mappedMigrationRows(file, file.mapping), batch: file.batch, decisions: {} };
  });
  assert.ok(batches[1].rows.every(({ type }) => type === "Callback"));
  const send = (input, actor = destination.staff) => executeCommand(destination.db, input, actor, undefined, [destination.staff, owner]);
  const commit = async (input) => {
    const preview = await send(input);
    assert.ok(preview.migration, preview.error);
    assert.ok(preview.migration.rows.every(({ status }) => status !== "Review"), JSON.stringify(preview.migration.rows.filter(({ status }) => status === "Review")));
    const imported = await send({ ...input, preview: preview.migration.fingerprint });
    assert.ok(imported.state, imported.error);
    return imported;
  };
  assert.match((await send({ ...batches[1], batch: undefined })).error, /original Orbit batch/);
  const oldRows = batches[0].rows.map((row) => {
    if (row.type !== "Note") return row;
    const legacy = { ...row };
    delete legacy.leadEventActor;
    return legacy;
  });
  await commit({ ...batches[0], rows: oldRows, batch: { ...batches[0].batch, snapshot: "a".repeat(64), partCount: 1 },
    ownerMappings: { [staff.email]: owner.email } });
  await commit({ ...batches[0], ownerMappings: { [staff.email]: owner.email } });
  const scope = destination.staff.brokerage.id;
  const activeOwners = new Set([destination.staff.email, owner.email]);
  const cutover = (owners = activeOwners) => readMigrationCutover(destination.db, destination.staff, scope, snapshot.origin, owners).evidence;
  const signOff = (fields = {}, owners = activeOwners) => saveMigrationCutover(destination.db, destination.staff, scope, {
    origin: snapshot.origin, basis: batches[0].batch.snapshot, item: "callbacks", decision: "Reconciled",
    note: "Checked the fictional callback promises.", revision: 0, ...fields,
  }, new Date().toISOString(), owners);
  assert.match(signOff({ callbackFingerprint: cutover().callbacks.fingerprint }).error, /every part of the numbered/i);
  const target = (key) => destination.db.prepare("SELECT targetId FROM migration_records WHERE origin = ? AND recordKey = ?")
    .get(snapshot.origin, key)?.targetId;
  const mappedLead = target(`Lead:${leadId}`);
  const primary = batches[1].rows.find(({ parentId }) => parentId === leadId).callbackHistory;
  const mappedTask = target(`Task:${primary.currentTaskId}`);
  const changeDue = destination.db.prepare("UPDATE lead_import_tasks SET dueAt = ? WHERE id = ?");
  changeDue.run(missedDue, mappedTask);
  const mismatch = (await send(batches[1])).migration.rows.find(({ key }) => key === `Callback:${leadId}`);
  assert.equal(mismatch.status, "Review");
  assert.match(mismatch.detail, /matching campaign task/);
  changeDue.run(scheduled, mappedTask);
  const restored = await commit(batches[1]);
  const interrupted = cutover();
  assert.equal(interrupted.byType.callbacks, 2);
  assert.equal(interrupted.callbacks.counts["Needs recovery"], 1);
  assert.match(signOff({ callbackFingerprint: interrupted.callbacks.fingerprint }).error, /resolve callback/i);
  const member = () => destination.db.prepare("SELECT * FROM call_campaign_members WHERE leadId = ?").get(mappedLead);
  const importedCampaign = member().campaignId;
  assert.notEqual(importedCampaign, campaignId);
  assert.equal(member().callbackTaskId, mappedTask);
  const pending = restored.state.callCampaignMembers.find(({ leadId }) => leadId === mappedLead);
  const pendingEvent = restored.state.inboxLeads.find(({ id }) => id === mappedLead).followUp.events
    .find(({ id }) => id === pending.callbackPromise.requestEventId);
  assert.match(pendingEvent.text, /Attempt and replacement promise/);
  assert.deepEqual([pending.callbackDueAt, pending.callbackPromise.dueAt, pending.callbackPromise.originalDueAt], [scheduled, missedDue, missedDue]);
  const report = () => readCampaignCallbackPerformance(destination.db, { campaignId: importedCampaign }, destination.staff, scope);
  assert.equal(report().counts["On time"], 1);
  assert.equal(report().counts.Overdue, 2);
  const fulfilled = report().items.find(({ status }) => status === "On time");
  assert.match(fulfilled.request.text, /Initial promise/);
  assert.match(fulfilled.attempt.text, /Attempt and replacement promise/);
  assert.equal(fulfilled.attempt.actor, staff.name);
  assert.equal(fulfilled.attempt.id, target(`Note:${primary.promises[0].attemptEventId}`));
  const exceptions = readCampaignCallbackExceptions(destination.db, {}, destination.staff, scope).items;
  assert.deepEqual(exceptions.map(({ dueAt, scheduledAt, needsRecovery, ownerEmail }) => [dueAt, scheduledAt, needsRecovery, ownerEmail]),
    [[missedDue, scheduled, false, owner.email], [failedDue, null, true, owner.email]]);
  const upcoming = readOfficerQueue(destination.db, { horizon: 7 }, owner, scope).items.find(({ id }) => id === mappedTask);
  assert.equal(upcoming?.dueAt, scheduled);
  assert.ok((await send(batches[1])).migration.rows.every(({ status }) => status === "Previously imported"));

  const receipts = reviewMigrationRecovery(destination.db, destination.staff).imports;
  const evidenceReceipt = receipts.find(({ part }) => part === 1);
  const promiseReceipt = receipts.find(({ part }) => part === 2);
  const evidence = reviewMigrationRecovery(destination.db, destination.staff, evidenceReceipt.id).preview.rows;
  assert.equal(evidence.find(({ key }) => key === `Task:${primary.currentTaskId}`).result, "Keep");
  assert.equal(evidence.find(({ key }) => key === `Note:${primary.promises[0].requestEventId}`).result, "Keep");
  const undo = reviewMigrationRecovery(destination.db, destination.staff, promiseReceipt.id).preview;
  assert.ok(undo.rows.every(({ result }) => result === "Candidate"));
  assert.ok((await send({ type: "undoMigration", importId: promiseReceipt.id, fingerprint: undo.fingerprint, confirmed: true })).state);
  assert.equal(member(), undefined);
  assert.ok(destination.db.prepare("SELECT 1 FROM lead_import_tasks WHERE id = ?").get(mappedTask));
  const unrestored = cutover().callbacks;
  assert.equal(unrestored.unrestored, 2);
  assert.match(signOff({ callbackFingerprint: unrestored.fingerprint }).error, /resolve callback/i);
  assert.ok((await send(batches[1])).migration.rows.every(({ status }) => status === "Undone"));
  await commit({ ...batches[1], correctionKeys: batches[1].rows.map(({ externalId }) => `Callback:${externalId}`) });
  const failed = readCampaignCallbackExceptions(destination.db, {}, destination.staff, scope).items.find(({ needsRecovery }) => needsRecovery);
  const history = playbookRunWork(destination.db, { type: "attempts", source: "campaign", id: failed.id }, destination.staff, scope);
  assert.deepEqual(history.attempts.map(({ status, actor }) => [status, actor]), [["Failed", staff.name]]);
  const recovered = playbookRunWork(destination.db, { type: "retry", source: "campaign", id: failed.id, attempt: history.attempts[0].attempt,
    operationId: crypto.randomUUID() }, destination.staff, scope);
  assert.equal(recovered.status, "Completed", recovered.error);
  assert.equal(readOfficerQueue(destination.db, { horizon: 7 }, owner, scope).items.find(({ recordId, kind }) =>
    recordId === failed.leadId && kind === "campaign")?.dueAt, failedDue);
  const inactiveOwners = new Set([destination.staff.email]);
  const withoutOwner = cutover(inactiveOwners).callbacks;
  assert.equal(withoutOwner.counts["Needs owner"], 2);
  assert.match(signOff({ callbackFingerprint: withoutOwner.fingerprint }, inactiveOwners).error, /resolve callback/i);
  const ready = cutover().callbacks;
  assert.equal(ready.counts.Ready, 2);
  assert.equal(ready.counts.Closed, 1);
  assert.match(signOff().error, /callback evidence changed/i);
  const heldLead = (await send({ type: "refreshWorkspace" })).state.inboxLeads.find(({ id }) => id === failed.leadId);
  const held = await send({ type: "leadHold", leadId: heldLead.id, revision: heldLead.followUp.revision,
    action: "Hold", reason: "Fictional borrower asked to pause.", revisitDate: null });
  assert.ok(held.state, held.error);
  const heldEvidence = cutover().callbacks;
  assert.equal(heldEvidence.counts["On hold"], 1);
  const checked = { callbackFingerprint: heldEvidence.fingerprint };
  assert.equal(signOff(checked).message, "Cutover review saved.");
  assert.equal(signOff(checked).message, "This review is up to date.");
  assert.equal(cutover().reviews.find(({ item }) => item === "callbacks").callbackCurrent, true);
  assert.equal(cutover(inactiveOwners).reviews.find(({ item }) => item === "callbacks").callbackCurrent, false);
  const work = readEditableLead(destination.db, { leadId: mappedLead, task: { kind: "campaign", id: mappedTask } }, owner, scope);
  assert.equal(work.member.callbackDueAt, scheduled);
  const done = await send({ type: "recordCampaignCall", campaignId: importedCampaign, leadId: mappedLead,
    revision: work.lead.followUp.revision, outcome: "Connected", note: "Attempt after cutover", callbackAt: null }, owner);
  assert.ok(done.state, done.error);
  assert.equal(report().counts.Late, 1);
  assert.match(report().items.find(({ status }) => status === "Late").attempt.text, /Attempt after cutover/);
  const changed = cutover();
  assert.equal(changed.reviews.find(({ item }) => item === "callbacks").callbackCurrent, false);
  assert.match(signOff(checked).error, /callback evidence changed/i);
  assert.match(signOff({ callbackFingerprint: changed.callbacks.fingerprint }).error, /review changed/i);
  assert.equal(signOff({ callbackFingerprint: changed.callbacks.fingerprint, revision: 1 }).message, "Cutover review saved.");
  assert.equal(cutover().reviews.find(({ item }) => item === "callbacks").callbackCurrent, true);
});

test("a restored callback preserves outcomes and reschedules and can continue with its mapped owner", async (t) => {
  const source = fixture(t);
  const destination = fixture(t);
  const original = { ...source.staff, name: "Source officer", email: "source@example.test" };
  const owner = { ...destination.staff, name: "Destination officer", email: "destination@example.test",
    brokerage: { ...destination.staff.brokerage, role: "LO" } };
  const contactId = crypto.randomUUID();
  const loanId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const day = (offset) => easternDate(new Date(Date.now() + offset * 86_400_000));
  insertContact(source.db, { id: contactId, name: "Fictional borrower", email: "borrower@example.test", phone: "", role: "Borrower" });
  insertLoan(source.db, { id: loanId, contactId, partnerId: null, officer: original.name, officerEmail: original.email,
    address: "", amount: 350000, purpose: "Purchase", stage: "Clear to Close", stageSince: `${day(-4)}T17:00:00.000Z` });
  const apply = async (input) => {
    const result = await executeCommand(source.db, { loanId, contactId, eventId, ...input }, original);
    assert.ok(result.state, result.error);
    return result.state;
  };
  await apply({ type: "recordClosing", closingDate: day(-3), revision: 0 });
  const funded = await apply({ type: "recordFunding", fundingDate: day(-2), revision: 0 });
  await apply({ type: "recordFundingCheckIn", fundingRevision: funded.closingProgress[0].revision,
    kind: "Call", outcome: "Requested callback", note: "Borrower asked for a follow-up.", followUp: day(1), purpose: "Loan service" });
  const firstReason = 'Asked for "next week",\nwith more time to review.';
  await apply({ type: "rescheduleBorrowerCallback", date: day(3), reason: firstReason, revision: 0 });
  await apply({ type: "completeContactFollowUp", revision: 1, completed: true, resolution: { outcome: "Connected", note: "Reviewed options." } });
  await apply({ type: "completeContactFollowUp", revision: 2, completed: false });
  await apply({ type: "rescheduleBorrowerCallback", date: day(5), reason: "Waiting for the borrower’s reply.", revision: 3 });
  const exported = exportPilotPipeline(source.db, original);
  assert.equal(exported.total, 2);
  const file = migrationFile(exported.batches[0].csv);
  const rows = mappedMigrationRows(file, file.mapping);
  const input = { type: "migratePipeline", origin: exported.origin, batch: file.batch, rows, decisions: {},
    ownerMappings: { [original.email]: owner.email } };
  const command = (payload, actor = destination.staff) => executeCommand(destination.db, payload, actor, undefined, [owner]);
  assert.match((await command({ ...input, batch: undefined })).error, /original Orbit batch/);
  const invalidRows = structuredClone(rows);
  const invalidHistory = invalidRows.find((row) => row.type === "Task").followUpHistory;
  invalidHistory.completions[0].revision = invalidHistory.reschedules[0].revision;
  assert.match((await command({ ...input, rows: invalidRows })).error, /distinct revisions/);
  const preview = await command(input);
  assert.match(preview.migration.rows.find((row) => row.key.startsWith("Task:")).detail, /3 follow-up history events/);
  const restored = await command({ ...input, preview: preview.migration.fingerprint });
  assert.ok(restored.state, restored.error);
  const [callback] = restored.state.contactActivity;
  assert.notEqual(callback.id, eventId);
  assert.equal(callback.postFundingCheckIn, true);
  assert.equal(callback.completedAt, null);
  assert.equal(callback.revision, 4);
  assert.equal(callback.officer, original.name);
  assert.equal(callback.followUpOwnerEmail, owner.email);
  assert.equal(callback.dueAt, `${day(5)}T17:00:00.000Z`);
  assert.equal(restored.state.loans.length, 0);
  assert.equal(restored.state.managerReports.returningClients.find((row) => row.metric === "callbacks").loanId, null);
  const history = readRecordHistory(destination.db, owner, { record: "contact", id: callback.contactId });
  const first = history.events.find((item) => item.text === firstReason);
  assert.deepEqual([first.author, first.previousDueAt, first.dueAt], [original.name, `${day(1)}T17:00:00.000Z`, `${day(3)}T17:00:00.000Z`]);
  assert.equal(history.events.filter((item) => item.source === "reschedule").length, 2);
  assert.equal(history.events.find((item) => item.source === "contact").latestCompletion.note, "Reviewed options.");
  const receipts = reviewMigrationRecovery(destination.db, destination.staff);
  const review = reviewMigrationRecovery(destination.db, destination.staff, receipts.imports[0].id);
  assert.equal(review.preview.rows.find((row) => row.key.startsWith("Task:")).result, "Keep");
  const next = await command({ type: "rescheduleBorrowerCallback", contactId: callback.contactId, eventId: callback.id,
    date: day(7), reason: "Confirmed the new date after restore.", revision: callback.revision }, owner);
  assert.ok(next.state, next.error);
  assert.equal(next.state.contactActivity[0].dueAt, `${day(7)}T17:00:00.000Z`);
  assert.ok((await command(input)).migration.rows.every((row) => row.status === "Previously imported"));
  const exportedAgain = exportPilotPipeline(destination.db, destination.staff);
  const secondFile = migrationFile(exportedAgain.batches[0].csv);
  const restoredHistory = mappedMigrationRows(secondFile, secondFile.mapping).find((row) => row.type === "Task").followUpHistory;
  assert.equal(restoredHistory.completions.length, 1);
  assert.equal(restoredHistory.reschedules.length, 3);
});

test("synthetic MISMO import links the chosen borrower and requires review before creating a duplicate draft", async (t) => {
  const { db, staff } = fixture(t);
  const other = fixture(t);
  const contactId = crypto.randomUUID();
  const realtorId = crypto.randomUUID();
  const externalContactId = crypto.randomUUID();
  const contact = { id: contactId, name: "Riley M. Example", email: "riley@example.test", phone: "2485550139", role: "Borrower" };
  insertContact(db, contact);
  insertContact(db, { ...contact, id: realtorId, role: "Realtor" });
  insertContact(other.db, { ...contact, id: externalContactId });
  const command = (input, actor = staff) => executeCommand(db, input, actor);
  const original = await command({ type: "logContactActivity", contactId, eventId: crypto.randomUUID(), kind: "Note",
    outcome: null, text: "Fictional borrower asked for a purchase follow-up.", followUp: null, purpose: "Loan service" });
  assert.ok(original.state, original.error);
  const input = { type: "importMismo", requestId: crypto.randomUUID(), existingContactId: contactId, fictional: true,
    fields: { firstName: "Riley", lastName: "Example", amount: "280000.50", purpose: "Purchase", occupancy: "Primary residence",
      street: "102 Fictional Avenue", unit: "2", city: "Troy", state: "MI", zip: "48084" } };
  for (const unavailable of [realtorId, externalContactId]) {
    assert.match((await command({ ...input, existingContactId: unavailable })).error, /available borrower contact/);
  }
  assert.match((await command(input, { ...staff, brokerage: { ...staff.brokerage, role: "LO" } })).error, /pilot admin/);
  assert.equal(db.prepare("SELECT count(*) AS total FROM loans").get().total, 0);
  const imported = await command(input);
  assert.ok(imported.state, imported.error);
  assert.equal(imported.state.contacts.length, 2);
  assert.equal(imported.state.contacts.find((item) => item.id === contactId).name, contact.name);
  assert.equal(imported.state.loans[0].contactId, contactId);
  const draft = borrowerCommandResult(db, { type: "read", token: imported.state.applications[0].token }).application.draft;
  assert.equal(draft.borrowerName, "Riley Example");
  assert.equal(draft.email, contact.email);
  assert.equal(draft.phone, contact.phone);
  assert.equal(draft.propertyLocation.zip, "48084");
  assert.match((await command({ type: "exportMismo", loanId: imported.applicationLoanId })).mismoXml, /<FirstName>Riley<\/FirstName>/);
  assert.ok(readRecordHistory(db, staff, { record: "contact", id: contactId }).events.some((event) => event.text.includes("purchase follow-up")));
  assert.equal((await command(input)).applicationLoanId, imported.applicationLoanId);
  assert.match((await command({ ...input, existingContactId: undefined })).error, /different file or borrower/);
  const reupload = { ...input, requestId: crypto.randomUUID() };
  const match = await command(reupload);
  assert.equal(match.mismoDuplicateLoanId, imported.applicationLoanId);
  assert.equal(match.applicationLoanId, undefined);
  assert.equal(match.state.loans.length, 1);
  const newDraft = await command({ ...reupload, confirmedDuplicateLoanId: match.mismoDuplicateLoanId });
  assert.ok(newDraft.applicationLoanId, newDraft.error);
  assert.notEqual(newDraft.applicationLoanId, imported.applicationLoanId);
  assert.equal(newDraft.state.loans.length, 2);
  assert.equal((await command(reupload)).applicationLoanId, newDraft.applicationLoanId);
  const stale = await command({ ...reupload, requestId: crypto.randomUUID(), confirmedDuplicateLoanId: match.mismoDuplicateLoanId });
  assert.equal(stale.mismoDuplicateLoanId, newDraft.applicationLoanId);
  assert.equal(stale.state.loans.length, 2);
  const changedMapping = await command({ ...reupload, requestId: crypto.randomUUID(), fields: { ...input.fields, amount: "290000.00" } });
  assert.ok(changedMapping.applicationLoanId, changedMapping.error);
  assert.equal(changedMapping.state.loans.length, 3);
  const separate = await command({ ...input, requestId: crypto.randomUUID(), existingContactId: undefined });
  assert.ok(separate.state, separate.error);
  assert.equal(separate.state.contacts.length, 3);
  const separateContactId = separate.state.loans.find((loan) => loan.id === separate.applicationLoanId).contactId;
  assert.notEqual(separateContactId, contactId);
  const matchOnNewContact = await command({ ...input, requestId: crypto.randomUUID(), existingContactId: separateContactId });
  assert.equal(matchOnNewContact.mismoDuplicateLoanId, separate.applicationLoanId);
});

test("MISMO migration preserves the full borrower name and still recognizes older mappings", async (t) => {
  const { db, staff } = fixture(t);
  const contact = { id: crypto.randomUUID(), name: "Riley Pilot Example Jr.", email: "riley@example.test", phone: "2485550139", role: "Borrower" };
  insertContact(db, contact);
  const command = (input) => executeCommand(db, input, staff);
  const legacy = { type: "importMismo", requestId: crypto.randomUUID(), existingContactId: contact.id, fictional: true,
    fields: { firstName: "Riley", lastName: "Example", amount: "280000", purpose: "Purchase", occupancy: "Primary residence",
      street: "102 Fictional Avenue", unit: "2", city: "Troy", state: "MI", zip: "48084" } };
  const oldDraft = await command(legacy);
  assert.ok(oldDraft.applicationLoanId, oldDraft.error);
  const current = { ...legacy, requestId: crypto.randomUUID(), fields: { ...legacy.fields, middleName: "Pilot", suffix: "Jr." } };
  const match = await command(current);
  assert.equal(match.mismoDuplicateLoanId, oldDraft.applicationLoanId);
  const imported = await command({ ...current, confirmedDuplicateLoanId: match.mismoDuplicateLoanId });
  assert.ok(imported.applicationLoanId, imported.error);
  assert.equal(imported.state.contacts.length, 1);
  const application = imported.state.applications.find(({ loanId }) => loanId === imported.applicationLoanId);
  const draft = borrowerCommandResult(db, { type: "read", token: application.token }).application.draft;
  assert.equal(draft.borrowerName, contact.name);
  assert.equal(draft.email, contact.email);
  const xml = (await command({ type: "exportMismo", loanId: imported.applicationLoanId })).mismoXml;
  assert.match(xml, /<MiddleName>Pilot<\/MiddleName><SuffixName>Jr\.<\/SuffixName>/);
  assert.equal((await command(current)).applicationLoanId, imported.applicationLoanId);
  assert.equal((await command({ ...current, requestId: crypto.randomUUID() })).mismoDuplicateLoanId, imported.applicationLoanId);
});

test("cutover evidence and review decisions stay scoped to the source and its current export", async (t) => {
  const { db, staff } = fixture(t);
  const tenant = staff.brokerage.id;
  const origin = `orbit-${crypto.randomUUID()}`;
  const other = "other-source";
  const snapshot = "a".repeat(64);
  const batch = { origin, snapshot, part: 1, partCount: 2 };
  const contact = (externalId, name) => ({ type: "Contact", externalId, name, email: `${externalId}@example.test`, phone: "", role: "Borrower" });
  const borrower = contact("borrower", "Fictional cutover borrower");
  const unused = contact("unused", "Fictional undo candidate");
  const skip = contact("skip", "Fictional skipped contact");
  const command = (input) => executeCommand(db, input, staff);
  const commit = async (input) => {
    const preview = await command(input);
    assert.ok(preview.migration, preview.error);
    const result = await command({ ...input, preview: preview.migration.fingerprint });
    assert.ok(result.state, result.error);
    return result;
  };
  const read = (source = origin, actor = staff, workspace = tenant) => readMigrationCutover(db, actor, workspace, source);
  assert.deepEqual(readMigrationCutover(db, staff, tenant), { sources: [], evidence: null });
  assert.ok(read().error);
  const input = { type: "migratePipeline", origin, batch, rows: [borrower, unused, skip], decisions: { "Contact:skip": "skip" } };
  const imported = await commit(input);
  const receipt = reviewMigrationRecovery(db, staff).imports[0];
  const contactId = imported.state.contacts.find(({ name }) => name === borrower.name).id;
  const loan = await command({ type: "importMismo", requestId: crypto.randomUUID(), existingContactId: contactId, fictional: true,
    fields: { firstName: "Fictional", lastName: "Borrower", amount: "350000", purpose: "Purchase", occupancy: "Primary residence",
      street: "42 Demo Lane", unit: "", city: "Troy", state: "MI", zip: "48084" } });
  assert.ok(loan.applicationLoanId, loan.error);
  await commit({ type: "migratePipeline", origin: other, rows: [contact("other", "Unrelated source borrower")], decisions: {} });
  assert.equal(read(other).evidence.draftCount, 0);
  assert.deepEqual(read().evidence.batch, { received: 1, expected: 2, skipped: 1, suppressed: 0 });
  assert.equal(read().evidence.links, 2);
  assert.deepEqual(read().evidence.byType, { contacts: 2, leads: 0, notes: 0, tasks: 0 });
  assert.equal(read().evidence.drafts[0].id, loan.applicationLoanId);
  assert.ok(read(origin, staff, crypto.randomUUID()).error);
  const officer = { ...staff, brokerage: { ...staff.brokerage, role: "LO" } };
  assert.ok(read(origin, officer).error);

  const review = { origin, basis: snapshot, item: "documents", decision: "Reconciled", note: "Fictional checklist checked.", revision: 0 };
  const save = (input, actor = staff) => saveMigrationCutover(db, actor, tenant, input, "2026-11-08T19:00:00.000Z");
  assert.ok(save({ ...review, note: " " }).error);
  assert.ok(save(review, officer).error);
  assert.ok(save(review).message);
  assert.ok(save(review).message);
  assert.match(save({ ...review, note: "Stale edit" }).error, /review changed/);
  assert.equal(read().evidence.reviews[0].updatedBy, staff.name);
  assert.equal(read().evidence.reviews[0].revision, 1);
  db.exec("ALTER TABLE migration_cutover_reviews DROP COLUMN callbackFingerprint");
  initializeStore(db, false);
  assert.equal(read().evidence.reviews[0].revision, 1);
  assert.equal(Object.hasOwn(read().evidence.reviews[0], "callbackCurrent"), false);

  const recovery = reviewMigrationRecovery(db, staff, receipt.id).preview;
  assert.ok((await command({ type: "undoMigration", importId: receipt.id, confirmed: true, fingerprint: recovery.fingerprint })).state);
  assert.equal(read().evidence.undone, 1);
  assert.equal(read().evidence.draftCount, 1);
  await commit({ ...input, correctionKeys: ["Contact:unused"] });
  assert.equal(read().evidence.undone, 0);
  await commit({ ...input, batch: { ...batch, part: 2 }, rows: [contact("second", "Second batch contact")], decisions: {} });
  assert.equal(read().evidence.batch.received, 2);
  assert.equal(read().evidence.reviews.length, 1);
  await commit({ ...input, batch: { ...batch, snapshot: "b".repeat(64), partCount: 1 } });
  assert.deepEqual(read().evidence.reviews, []);
  assert.match(save({ ...review, revision: 1 }).error, /source changed/);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Recorded migration cutover review'").get().count, 1);
  const legacyCallbacks = { origin: other, basis: read(other).evidence.basis, item: "callbacks", revision: 0 };
  assert.match(save({ ...legacyCallbacks, decision: "Reconciled", note: "Checked the source." }).error, /numbered/i);
  assert.ok(save({ ...legacyCallbacks, decision: "Pending", note: "" }).message);
  assert.ok(save({ ...legacyCallbacks, decision: "Out of scope", revision: 1, note: "" }).error);
  assert.ok(save({ ...legacyCallbacks, decision: "Out of scope", revision: 1, note: "No tracked callbacks in this source." }).message);
  assert.equal(Object.hasOwn(read(other).evidence.reviews[0], "callbackCurrent"), false);
});

test("cutover file reviews stay with the exact draft, migration source, and current snapshot", async (t) => {
  const { db, staff } = fixture(t);
  const tenant = staff.brokerage.id;
  const origin = `orbit-${crypto.randomUUID()}`;
  const other = "unrelated-source";
  const snapshot = "a".repeat(64);
  const at = "2026-11-08T19:00:00.000Z";
  const command = (input) => executeCommand(db, input, staff);
  const contact = (externalId) => ({ type: "Contact", externalId, name: `Fictional ${externalId}`, email: `${externalId}@example.test`, phone: "", role: "Borrower" });
  const batch = { origin, snapshot, part: 1, partCount: 1 };
  const csv = { type: "migratePipeline", origin, batch, rows: [contact("borrower")], decisions: {} };
  const importCsv = async (input) => {
    const preview = await command(input);
    assert.ok(preview.migration, preview.error);
    const imported = await command({ ...input, preview: preview.migration.fingerprint });
    assert.ok(imported.state, imported.error);
    return imported.state;
  };
  const state = await importCsv(csv);
  const contactId = state.contacts[0].id;
  const secondSource = await importCsv({ ...csv, origin: other, batch: undefined, rows: [contact("outsider")] });
  const otherId = secondSource.contacts.find(({ name }) => name === "Fictional outsider").id;
  const seedDraft = (id, borrowerId, amount) => {
    insertLoan(db, { id, contactId: borrowerId, partnerId: null, officer: staff.name, officerEmail: staff.email,
      address: `${amount} Fictional Lane`, amount, purpose: "Purchase", stage: "Lead", stageSince: at });
    db.prepare("INSERT INTO mismo_rehearsals (loanId, requestId, fields, existingContactId) VALUES (?, ?, '{}', ?)")
      .run(id, crypto.randomUUID(), borrowerId);
  };
  for (let i = 0; i < 22; i++) seedDraft(`draft-${String(i).padStart(2, "0")}`, contactId, 250000 + i);
  seedDraft("outsider", otherId, 350000);
  const read = (input = origin, actor = staff, brokerage = tenant) => readMigrationCutover(db, actor, brokerage, input);
  const save = (input, actor = staff, brokerage = tenant) => saveMigrationCutover(db, actor, brokerage, input, at);
  const first = read().evidence;
  assert.equal(first.draftCount, 22);
  assert.equal(first.drafts.length, 20);
  const query = { origin, after: first.draftNext };
  const second = read(query).evidence;
  assert.deepEqual(second.drafts.map(({ id }) => id), ["draft-20", "draft-21"]);
  assert.equal(second.draftCount, 22);
  assert.equal(second.draftNext, null);
  const draftQuery = { origin, basis: snapshot, loanId: "draft-20" };
  assert.ok(saveCutoverFileInventory(db, staff, tenant, { ...draftQuery, revision: 0, fictional: true, source: { version: 1, documents: [] } }, at).message);
  const inventory = readCutoverFileInventory(db, staff, tenant, draftQuery);
  const review = { ...draftQuery, item: "documents", decision: "Reconciled", note: "Checked sample document inventory.",
    revision: 0, fileFingerprint: inventory.documents.fingerprint };
  assert.match(readCutoverApplicationComparison(db, staff, tenant, draftQuery).error, /unavailable for comparison/i);
  assert.match(save({ ...review, loanId: "outsider" }).error, /no longer linked/);
  assert.ok(save(review, { ...staff, brokerage: { ...staff.brokerage, role: "Processor" } }).error);
  assert.ok(save(review, staff, crypto.randomUUID()).error);
  assert.ok(save({ ...review, note: "" }).error);
  assert.ok(save({ ...review, item: "callbacks" }).error);
  assert.ok(save(review).message);
  assert.equal(save(review).message, "This review is up to date.");
  assert.match(save({ ...review, note: "Stale change" }).error, /review changed/);
  assert.ok(save({ ...review, loanId: "draft-21", item: "funding", decision: "Out of scope", note: "Checked sample funding history." }).message);
  assert.deepEqual(read().evidence.reviews, []);
  assert.ok(read().evidence.drafts.every(({ reviews }) => reviews.length === 0));
  const reviewed = read(query).evidence.drafts;
  assert.deepEqual(reviewed.map(({ reviews }) => reviews.map(({ item, note, revision }) => [item, note, revision])), [
    [["documents", "Checked sample document inventory.", 1]], [["funding", "Checked sample funding history.", 1]],
  ]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Recorded migration loan review'").get().count, 2);
  await importCsv({ ...csv, batch: { ...batch, snapshot: "b".repeat(64) } });
  assert.ok(read(query).evidence.drafts.every(({ reviews }) => reviews.length === 0));
  assert.match(save(review).error, /source changed/);
});

function cutoverReadinessFixture(t) {
  const { db, staff } = fixture(t);
  const tenant = staff.brokerage.id;
  const at = "2026-11-09T18:00:00.000Z";
  const origin = `orbit-${crypto.randomUUID()}`;
  const basis = "a".repeat(64);
  const contactId = "readiness-borrower";
  insertContact(db, { id: contactId, name: "Fictional Borrower", email: "", phone: "", role: "Borrower" });
  const batch = (source, snapshot) => db.prepare(`INSERT INTO migration_batches (origin, snapshot, part, partCount, contentHash, excluded)
    VALUES (?, ?, 1, 1, ?, '{}')`).run(source, snapshot, snapshot);
  const link = (source) => db.prepare("INSERT INTO migration_records (origin, recordKey, targetId) VALUES (?, 'Contact:borrower', ?)").run(source, contactId);
  batch(origin, basis);
  link(origin);
  const addDraft = (loanId, { application = false, extraBorrowers = null } = {}) => {
    insertLoan(db, { id: loanId, contactId, partnerId: null, officer: staff.name, officerEmail: staff.email,
      address: "42 Fictional Lane, Troy, MI 48084", amount: 250000, purpose: "Purchase", stage: "Lead", stageSince: at });
    const fields = { firstName: "Fictional", lastName: "Borrower", amount: "250000", purpose: "Purchase", occupancy: "",
      street: "42 Fictional Lane", unit: "", city: "Troy", state: "MI", zip: "48084" };
    db.prepare("INSERT INTO mismo_rehearsals (loanId, requestId, fields, existingContactId, sourceExtraBorrowers) VALUES (?, ?, ?, ?, ?)")
      .run(loanId, crypto.randomUUID(), JSON.stringify(fields), contactId, extraBorrowers);
    if (application) assert.equal(startApplication(db, loanId, at, tenant), true);
  };
  const read = (input = origin, actor = staff, brokerage = tenant) => readMigrationCutover(db, actor, brokerage, input);
  const save = (loanId, fields) => saveMigrationCutover(db, staff, tenant, { origin, basis, loanId, revision: 0,
    note: "Checked the fictional cutover evidence.", ...fields }, at);
  const inventory = (loanId, source) => saveCutoverFileInventory(db, staff, tenant, { origin, basis, loanId, revision: 0, fictional: true, source }, at);
  return { db, staff, tenant, origin, basis, at, batch, link, addDraft, read, save, inventory };
}

test("cutover readiness counts all linked files and keeps current reviews, exclusions, and stale evidence distinct", (t) => {
  const { db, staff, tenant, origin, basis, at, batch, link, addDraft, read, save, inventory } = cutoverReadinessFixture(t);
  for (let index = 0; index < 23; index++) {
    const id = `readiness-${String(index).padStart(2, "0")}`;
    addDraft(id, { application: [2, 3, 20, 21].includes(index), extraBorrowers: index === 3 ? 1 : null });
  }
  const emptySource = { version: 1, documents: [], lenderFiles: [], funding: { closingDate: null, fundingDate: null,
    fundedPrincipalCents: null, borrowerFollowUp: null, realtorFollowUp: null, borrowerCallback: null } };
  assert.ok(inventory("readiness-01", { version: 1, documents: [{ kind: "Fictional pay statement", instructions: "Use a sample.", dueOn: null,
    status: "Requested" }] }).message);
  assert.ok(inventory("readiness-02", emptySource).message);
  assert.ok(save(undefined, { item: "documents", decision: "Reconciled" }).message);
  const completeChecks = (loanId, excluded) => {
    assert.ok(inventory(loanId, emptySource).message);
    const query = { origin, basis, loanId };
    const application = readCutoverApplicationComparison(db, staff, tenant, query);
    const file = readCutoverFileInventory(db, staff, tenant, query);
    assert.ok(save(loanId, { item: "application", decision: "Reconciled", applicationFingerprint: application.fingerprint }).message);
    for (const item of ["documents", "lender", "funding"]) {
      assert.ok(save(loanId, item === excluded ? { item, decision: "Out of scope" } : {
        item, decision: "Reconciled", fileFingerprint: file[item].fingerprint,
      }).message);
    }
  };
  completeChecks("readiness-20");
  completeChecks("readiness-21", "funding");
  db.prepare(`INSERT INTO migration_cutover_loan_reviews (loanId, origin, basis, item, decision, note, updatedBy, updatedAt, revision)
    VALUES ('readiness-22', ?, ?, 'documents', 'Reconciled', 'Legacy sample note.', ?, ?, 1)`).run(origin, basis, staff.name, at);

  const check = (draft, item) => draft.readiness.checks.find((entry) => entry.item === item);
  const counts = { Ready: 1, "Reviewed with exclusions": 1, "Needs review": 21 };
  const first = read().evidence;
  assert.equal(first.draftCount, 23);
  assert.deepEqual(first.readiness, { counts, limit: cutoverReadinessLimit });
  assert.equal(first.drafts.length, 20);
  assert.ok(first.drafts.every(({ readiness }) => readiness.status === "Needs review"));
  assert.equal(check(first.drafts[0], "application").state, "Pending");
  assert.match(check(first.drafts[0], "application").reason, /mismo source|current 1003 draft/i);
  assert.equal(check(first.drafts[0], "documents").state, "Pending");
  assert.match(check(first.drafts[0], "lender").reason, /fictional source inventory/i);
  assert.match(check(first.drafts[1], "documents").reason, /missing file inventory/i);
  assert.match(check(first.drafts[2], "documents").reason, /ready for sign-off/i);
  assert.match(check(first.drafts[3], "application").reason, /additional borrowers/i);

  const nextPage = () => read({ origin, after: first.draftNext }).evidence;
  const second = nextPage();
  assert.deepEqual(second.readiness.counts, counts);
  assert.deepEqual(second.drafts.map(({ id, readiness }) => [id, readiness.status]), [
    ["readiness-20", "Ready"], ["readiness-21", "Reviewed with exclusions"], ["readiness-22", "Needs review"],
  ]);
  assert.equal(second.drafts[0].readiness.checks.length, 4);
  assert.ok(second.drafts[0].readiness.checks.every(({ state }) => state === "Reconciled"));
  assert.equal(check(second.drafts[1], "funding").state, "Out of scope");
  assert.equal(check(second.drafts[2], "documents").state, "Review again");

  db.prepare("UPDATE applications SET draft = json_set(draft, '$.loanAmount', '260000'), revision = revision + 1 WHERE loanId = 'readiness-20'").run();
  const changed = nextPage();
  assert.deepEqual(changed.readiness.counts, { Ready: 0, "Reviewed with exclusions": 1, "Needs review": 22 });
  assert.equal(check(changed.drafts[0], "application").state, "Review again");
  assert.match(check(changed.drafts[0], "application").reason, /evidence changed/i);
  assert.equal(check(changed.drafts[0], "documents").state, "Reconciled");

  insertSubmission(db, { id: "readiness-lender", loanId: "readiness-21", lender: "Fictional lender",
    externalId: "DEMO-READY", status: "Submitted", conditions: [], syncedAt: null });
  const changedExclusion = nextPage();
  assert.deepEqual(changedExclusion.readiness.counts, { Ready: 0, "Reviewed with exclusions": 0, "Needs review": 23 });
  assert.equal(changedExclusion.drafts[1].readiness.status, "Needs review");
  assert.equal(check(changedExclusion.drafts[1], "lender").state, "Review again");
  assert.equal(check(changedExclusion.drafts[1], "funding").state, "Out of scope");

  const otherOrigin = `orbit-${crypto.randomUUID()}`;
  batch(otherOrigin, "b".repeat(64));
  link(otherOrigin);
  assert.deepEqual(read(otherOrigin).evidence.readiness.counts, { Ready: 0, "Reviewed with exclusions": 0, "Needs review": 23 });
  batch(origin, "c".repeat(64));
  assert.deepEqual(nextPage().readiness.counts, { Ready: 0, "Reviewed with exclusions": 0, "Needs review": 23 });
  assert.equal(check(nextPage().drafts[1], "funding").state, "Pending");
  assert.ok(read(origin, staff, crypto.randomUUID()).error);
  assert.ok(read(origin, { ...staff, brokerage: { ...staff.brokerage, role: "LO" } }).error);
});

test("cutover readiness reports no totals above its cap while every visible file still has a status", (t) => {
  const { db, staff, tenant, origin, basis, addDraft, read } = cutoverReadinessFixture(t);
  for (let index = 0; index < cutoverReadinessLimit; index++) addDraft(`bounded-${String(index).padStart(3, "0")}`);
  assert.deepEqual(read().evidence.readiness, { counts: { Ready: 0, "Reviewed with exclusions": 0, "Needs review": cutoverReadinessLimit },
    limit: cutoverReadinessLimit });
  assert.match(exportCutoverHandoff(db, staff, tenant, { origin, basis }).html, /bounded-099/);
  addDraft("bounded-overflow");
  assert.deepEqual(exportCutoverHandoff(db, staff, tenant, { origin, basis }), {
    error: `This source exceeds the cutover handoff limit of ${cutoverReadinessLimit} linked files.`,
  });
  const capped = read().evidence;
  assert.equal(capped.draftCount, cutoverReadinessLimit + 1);
  assert.deepEqual(capped.readiness, { counts: null, limit: cutoverReadinessLimit });
  const second = read({ origin: capped.origin, after: capped.draftNext }).evidence;
  assert.deepEqual(second.readiness, capped.readiness);
  assert.equal(second.drafts.length, 20);
  assert.ok(second.drafts.every(({ readiness }) => readiness.status === "Needs review" && readiness.checks.length === 4));
});

test("exact cutover file lookup is independent of paging and readiness caps and refreshes the current scoped evidence", (t) => {
  const { db, staff, tenant, origin, basis, at, batch, addDraft, read } = cutoverReadinessFixture(t);
  const target = "ffffffff-ffff-4fff-8fff-ffffffffff01";
  const lookalike = "ffffffff-ffff-4fff-8fff-ffffffffff02";
  const addFiller = (index) => addDraft(`bulk-lookup-${String(index).padStart(3, "0")}`);
  for (let index = 0; index < 22; index++) addFiller(index);
  addDraft(target, { application: true });
  addDraft(lookalike, { application: true });
  const page = read().evidence;
  assert.equal(page.draftCount, 24);
  assert.ok(!page.drafts.some(({ id }) => id === target || id === lookalike));
  const laterPage = read({ origin, after: page.draftNext }).evidence;
  assert.deepEqual(laterPage.drafts.filter(({ id }) => id === target || id === lookalike).map(({ id }) => id), [target, lookalike]);

  const query = { origin, basis, reference: target };
  const lookup = (fields = {}, actor = staff, brokerage = tenant) => lookupCutoverFile(db, actor, brokerage, { ...query, ...fields });
  const reviewer = { ...staff, name: "Exact File Reviewer" };
  const alternate = { ...staff, name: "Other File Reviewer" };
  const comparison = readCutoverApplicationComparison(db, staff, tenant, { origin, basis, loanId: target });
  const review = { origin, basis, loanId: target, item: "application", decision: "Reconciled", revision: 0,
    applicationFingerprint: comparison.fingerprint, note: "Compared the exact fictional draft." };
  assert.ok(saveMigrationCutover(db, reviewer, tenant, review, at).message);
  assert.ok(saveMigrationCutover(db, alternate, tenant, { ...review, loanId: lookalike, decision: "Out of scope", applicationFingerprint: undefined }, at).message);

  const requested = lookup({ reference: ` \t${target}\r\n` }).draft;
  const similar = lookup({ reference: lookalike }).draft;
  assert.equal(requested.id, target);
  assert.equal(similar.id, lookalike);
  assert.equal(requested.name, similar.name);
  assert.equal(requested.address, similar.address);
  assert.deepEqual(requested.reviews.map(({ item, decision, updatedBy, updatedAt, applicationCurrent }) =>
    [item, decision, updatedBy, updatedAt, applicationCurrent]), [["application", "Reconciled", reviewer.name, at, true]]);
  assert.deepEqual(similar.reviews.map(({ decision, updatedBy }) => [decision, updatedBy]), [["Out of scope", alternate.name]]);
  for (const reference of [" ", "f", target.slice(0, 8), target.slice(0, -1), target.toUpperCase(), `${target.slice(0, -1)}%`, "x".repeat(101)]) {
    assert.ok(lookup({ reference }).error, JSON.stringify(reference));
  }

  const ordinaryLoan = crypto.randomUUID();
  addDraft(ordinaryLoan);
  db.prepare("DELETE FROM mismo_rehearsals WHERE loanId = ?").run(ordinaryLoan);
  assert.match(lookup({ reference: ordinaryLoan }).error, /no linked mismo draft/i);
  const unrelated = `orbit-${crypto.randomUUID()}`;
  batch(unrelated, basis);
  assert.match(lookup({ origin: unrelated }).error, /no linked mismo draft/i);
  assert.ok(lookup({}, staff, crypto.randomUUID()).error);
  const otherRoles = ["LO", "Processor"].map((role) => ({ ...staff, brokerage: { ...staff.brokerage, role } }));
  for (const actor of [null, ...otherRoles, { ...staff, brokerage: { ...staff.brokerage, pilot: false } }]) {
    assert.ok(lookup({}, actor).error);
  }

  for (let index = 22; index < cutoverReadinessLimit - 1; index++) addFiller(index);
  const capped = read().evidence;
  assert.equal(capped.draftCount, cutoverReadinessLimit + 1);
  assert.equal(capped.readiness.counts, null);
  const pageIds = ({ drafts }) => drafts.map(({ id }) => id);
  const cappedSecond = read({ origin, after: capped.draftNext }).evidence;
  assert.deepEqual(pageIds(capped), pageIds(page));
  assert.ok(!pageIds(cappedSecond).includes(target));
  assert.deepEqual(lookup().draft, requested);
  assert.deepEqual(pageIds(read().evidence), pageIds(capped));
  assert.deepEqual(read().evidence.draftNext, capped.draftNext);
  assert.deepEqual(pageIds(read({ origin, after: capped.draftNext }).evidence), pageIds(cappedSecond));

  db.prepare("UPDATE applications SET draft = json_set(draft, '$.loanAmount', '260000'), revision = revision + 1 WHERE loanId = ?").run(target);
  const refreshed = lookup().draft;
  const application = refreshed.readiness.checks.find(({ item }) => item === "application");
  assert.equal(application.state, "Review again");
  assert.match(application.reason, /evidence changed/i);
  assert.deepEqual(refreshed.reviews.map(({ decision, note, updatedBy, updatedAt, applicationCurrent }) =>
    [decision, note, updatedBy, updatedAt, applicationCurrent]), [["Reconciled", review.note, reviewer.name, at, false]]);
  assert.deepEqual(lookup({ reference: lookalike }).draft, similar);

  const nextBasis = "b".repeat(64);
  batch(origin, nextBasis);
  assert.match(lookup().error, /source changed/i);
  const newScope = lookup({ basis: nextBasis }).draft;
  assert.equal(newScope.id, target);
  assert.deepEqual(newScope.reviews, []);
  assert.equal(newScope.readiness.checks.find(({ item }) => item === "application").state, "Pending");
  db.prepare("DELETE FROM migration_records WHERE origin = ? AND recordKey = 'Contact:borrower'").run(origin);
  assert.match(lookup({ basis: nextBasis }).error, /no linked mismo draft/i);
});

test("cutover handoff exports the complete current source in one scoped snapshot", (t) => {
  const { db, staff, tenant, origin, basis, at, batch, addDraft, read, save } = cutoverReadinessFixture(t);
  const query = { origin, basis };
  const handoff = (input = query, actor = staff, brokerage = tenant, workspace = db) =>
    exportCutoverHandoff(workspace, actor, brokerage, input, undefined, at);
  const empty = handoff();
  assert.match(empty.filename, /\.html$/);
  assert.ok(empty.html);
  for (let index = 0; index < 23; index++) {
    addDraft(`handoff-${String(index).padStart(2, "0")}`, { application: index === 22 });
  }
  assert.equal(read().evidence.drafts.length, 20);
  const loanId = "handoff-22";
  const comparison = readCutoverApplicationComparison(db, staff, tenant, { ...query, loanId });
  assert.ok(save(loanId, { item: "application", decision: "Reconciled", applicationFingerprint: comparison.fingerprint,
    note: "Private fictional review note" }).message);
  let transactions = 0;
  const audited = { ...db, transaction(run) { transactions++; return db.transaction(run); } };
  const all = handoff(query, staff, tenant, audited);
  assert.equal(transactions, 1);
  assert.deepEqual(Object.keys(all).sort(), ["filename", "html"]);
  for (let index = 0; index < 23; index++) assert.match(all.html, new RegExp(`handoff-${String(index).padStart(2, "0")}`));
  assert.doesNotMatch(all.html, /Fictional Borrower|42 Fictional Lane|Private fictional review note|comparison evidence changed/i);
  db.prepare("UPDATE applications SET draft = json_set(draft, '$.loanAmount', '260000') WHERE loanId = ?").run(loanId);
  assert.match(handoff().html, /comparison evidence changed/i);
  assert.equal(read().evidence.drafts.length, 20);

  const otherOrigin = `orbit-${crypto.randomUUID()}`;
  const otherBasis = "b".repeat(64);
  batch(otherOrigin, otherBasis);
  assert.doesNotMatch(handoff({ origin: otherOrigin, basis: otherBasis }).html, /handoff-22/);
  assert.match(handoff({ origin: otherOrigin, basis }).error, /source changed/i);
  assert.ok(handoff({ ...query, after: { id: loanId, createdAt: at } }).error);
  assert.ok(handoff(query, null).error);
  assert.ok(handoff(query, staff, crypto.randomUUID()).error);
  assert.ok(handoff(query, { ...staff, brokerage: { ...staff.brokerage, role: "LO" } }).error);
  assert.ok(handoff(query, { ...staff, brokerage: { ...staff.brokerage, pilot: false } }).error);
  batch(origin, otherBasis);
  assert.match(handoff().error, /source changed/i);
  assert.doesNotMatch(handoff({ origin, basis: otherBasis }).html, /comparison evidence changed/i);
});

test("cutover file inventories are scoped, revision checked, and independently invalidate sign-off", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(promiseStart) });
  const { db, staff } = fixture(t);
  const tenant = staff.brokerage.id;
  const at = "2026-11-09T18:00:00.000Z";
  const origin = `orbit-${crypto.randomUUID()}`;
  const basis = "a".repeat(64);
  const other = { origin: `orbit-${crypto.randomUUID()}`, basis: "b".repeat(64) };
  const loanId = "fictional-inventory";
  insertContact(db, { id: "inventory-borrower", name: "Fictional Borrower", email: "", phone: "", role: "Borrower" });
  insertContact(db, { id: "inventory-realtor", name: "Fictional Realtor", email: "", phone: "", role: "Realtor" });
  insertLoan(db, { id: loanId, contactId: "inventory-borrower", partnerId: "inventory-realtor", officer: staff.name, officerEmail: staff.email,
    address: "42 Fictional Lane", amount: 250000, purpose: "Purchase", stage: "Lead", stageSince: at });
  db.prepare("INSERT INTO mismo_rehearsals (loanId, requestId, fields, existingContactId) VALUES (?, ?, '{}', 'inventory-borrower')").run(loanId, crypto.randomUUID());
  const batch = db.prepare("INSERT INTO migration_batches (origin, snapshot, part, partCount, contentHash, excluded) VALUES (?, ?, 1, 1, ?, '{}')");
  batch.run(origin, basis, basis);
  batch.run(other.origin, other.basis, other.basis);
  db.prepare("INSERT INTO migration_records (origin, recordKey, targetId) VALUES (?, 'Contact:borrower', 'inventory-borrower')").run(origin);
  const query = { origin, basis, loanId };
  const read = (fields = {}, actor = staff, brokerage = tenant) => readCutoverFileInventory(db, actor, brokerage, { ...query, ...fields });
  const store = (source, revision = 0, fields = {}, actor = staff, brokerage = tenant) =>
    saveCutoverFileInventory(db, actor, brokerage, { ...query, fictional: true, revision, source, ...fields }, at);
  const review = (item, fields = {}) => saveMigrationCutover(db, staff, tenant, { ...query, item, decision: "Reconciled",
    note: "Checked fictional inventory and recorded the differences.", revision: 0, ...fields }, at);
  const reviews = () => readMigrationCutover(db, staff, tenant, origin).evidence.drafts[0].reviews;
  const document = { kind: "Pay statement", instructions: "Use the fictional sample.", status: "Accepted", dueOn: "2026-11-12" };
  const documentsOnly = { version: 1, documents: [document] };

  assert.deepEqual(read(), { revision: 0, source: null, documents: null, lender: null, funding: null });
  assert.match(review("documents").error, /save the corresponding fictional source inventory/i);
  assert.ok(store(documentsOnly, 0, { fictional: false }).error);
  assert.ok(store({ version: 1 }).error);
  assert.match(read(other).error, /no longer linked/i);
  assert.match(store(documentsOnly, 0, other).error, /no longer linked/i);
  assert.match(read({ basis: other.basis }).error, /source changed/i);
  assert.ok(read({}, staff, crypto.randomUUID()).error);
  assert.ok(store(documentsOnly, 0, {}, staff, crypto.randomUUID()).error);
  for (const actor of [null, ...["LO", "Processor"].map((role) => ({ ...staff, brokerage: { ...staff.brokerage, role } })),
    { ...staff, brokerage: { ...staff.brokerage, pilot: false } }]) {
    assert.ok(read({}, actor).error);
    assert.ok(store(documentsOnly, 0, {}, actor).error);
  }
  assert.equal(store(documentsOnly).message, "Source inventory saved.");
  assert.equal(store(documentsOnly).message, "This source inventory is up to date.");
  assert.match(store({ version: 1, documents: [] }).error, /source inventory changed/i);
  const missingDocs = read();
  assert.equal(missingDocs.revision, 1);
  assert.deepEqual(missingDocs.source, documentsOnly);
  assert.equal(missingDocs.lender, null);
  assert.equal(missingDocs.funding, null);
  assert.deepEqual(missingDocs.documents.rows.map(({ status }) => status), ["Missing"]);
  assert.match(review("documents", { fileFingerprint: missingDocs.documents.fingerprint }).error, /resolve missing file inventory/i);
  assert.ok(review("lender", { decision: "Out of scope" }).message);
  assert.equal(Object.hasOwn(reviews().find(({ item }) => item === "lender"), "fileCurrent"), false);

  db.prepare(`INSERT INTO migration_cutover_loan_reviews (loanId, origin, basis, item, decision, note, updatedBy, updatedAt, revision)
    VALUES (?, ?, ?, 'documents', 'Reconciled', 'Legacy sample note.', ?, ?, 1)`).run(loanId, origin, basis, staff.name, at);
  db.exec("ALTER TABLE migration_cutover_loan_reviews DROP COLUMN fileFingerprint");
  initializeStore(db, false);
  assert.equal(reviews().find(({ item }) => item === "documents").fileCurrent, false);
  assert.equal(reviews().find(({ item }) => item === "documents").note, "Legacy sample note.");
  assert.equal(read().revision, 1);
  const addDocument = db.prepare("INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, dueOn, status) VALUES (?, ?, ?, ?, ?, ?, 'Requested')");
  addDocument.run("fixture-pay", loanId, document.kind, document.instructions, at, document.dueOn);
  addDocument.run("fixture-bank", loanId, "Bank statement", "Use the fictional sample.", at, null);
  const withDocs = read();
  assert.deepEqual(withDocs.documents.rows.map(({ status }) => status).sort(), ["Added", "Changed"]);
  assert.match(review("documents", { revision: 1, fileFingerprint: missingDocs.documents.fingerprint }).error, /comparison changed/i);
  assert.match(review("documents", { revision: 1 }).error, /comparison changed/i);
  assert.ok(review("documents", { revision: 1, fileFingerprint: withDocs.documents.fingerprint, note: "" }).error);
  assert.equal(review("documents", { revision: 1, fileFingerprint: withDocs.documents.fingerprint }).message, "Cutover review saved.");
  assert.equal(review("documents", { revision: 1, fileFingerprint: withDocs.documents.fingerprint }).message, "This review is up to date.");
  assert.equal(reviews().find(({ item }) => item === "documents").fileCurrent, true);

  const lenderFile = { lender: "Fictional lender", reference: "DEMO-FILE-1", status: "Approved",
    conditions: [{ category: "Income", description: "Review the fictional pay statement.", status: "Open" }] };
  const both = { ...documentsOnly, lenderFiles: [lenderFile] };
  assert.equal(store(both, 1).message, "Source inventory saved.");
  assert.equal(store(both, 1).message, "This source inventory is up to date.");
  const missingLender = read();
  assert.equal(missingLender.revision, 2);
  assert.equal(missingLender.documents.fingerprint, withDocs.documents.fingerprint);
  assert.match(review("lender", { revision: 1, fileFingerprint: missingLender.lender.fingerprint }).error, /resolve missing file inventory/i);
  insertSubmission(db, { id: "fixture-lender", loanId, lender: lenderFile.lender, externalId: lenderFile.reference, status: "Submitted",
    conditions: [{ id: "fixture-income", category: "Income", description: lenderFile.conditions[0].description, uploaded: true, satisfiedAt: null, group: null }],
    syncedAt: null });
  const withLender = read();
  assert.ok(withLender.lender.rows.some(({ status }) => status === "Changed"));
  assert.equal(review("lender", { revision: 1, fileFingerprint: withLender.lender.fingerprint }).message, "Cutover review saved.");
  assert.deepEqual(reviews().map(({ item, fileCurrent }) => [item, fileCurrent]).sort(), [["documents", true], ["lender", true]]);

  assert.match(review("funding").error, /save the corresponding fictional source inventory/i);
  db.prepare(`INSERT INTO migration_cutover_loan_reviews (loanId, origin, basis, item, decision, note, updatedBy, updatedAt, revision)
    VALUES (?, ?, ?, 'funding', 'Reconciled', 'Legacy funding note.', ?, ?, 1)`).run(loanId, origin, basis, staff.name, at);
  assert.equal(reviews().find(({ item }) => item === "funding").fileCurrent, false);
  const closingDate = "2026-11-06";
  const fundingDate = "2026-11-07";
  const callbackDate = "2026-11-10";
  const dueOn = "2026-11-14";
  const funding = { closingDate, fundingDate, fundedPrincipalCents: 24_500_000,
    borrowerFollowUp: { dueOn, status: "Completed" }, realtorFollowUp: { dueOn, status: "Open" },
    borrowerCallback: { dueOn: callbackDate, status: "Open" } };
  const inventory = { ...both, funding };
  assert.ok(store(inventory, 2).message);
  assert.equal(read().documents.fingerprint, withDocs.documents.fingerprint);
  assert.equal(read().lender.fingerprint, withLender.lender.fingerprint);

  const apply = async (input) => {
    const result = await executeCommand(db, { loanId, ...input }, staff);
    assert.ok(result.state, result.error);
    return result.state;
  };
  await apply({ type: "recordClosing", closingDate, revision: 0 });
  const funded = await apply({ type: "recordFunding", fundingDate, revision: 0, simulateFollowUpFailure: true });
  const missingFunding = read().funding;
  assert.ok(missingFunding.rows.some(({ label, status }) => /borrower.*(?:follow-up|check-in)/i.test(label) && status === "Missing"));
  assert.match(review("funding", { revision: 1, fileFingerprint: missingFunding.fingerprint }).error, /resolve missing file inventory/i);
  const [run] = playbookRunWork(db, { type: "list", filter: "Failed" }, staff, tenant).runs;
  assert.equal(playbookRunWork(db, { type: "retry", id: run.id, attempt: run.attemptCount, operationId: crypto.randomUUID() }, staff, tenant).status, "Completed");
  const fundingRevision = funded.closingProgress.find(({ loanId: id }) => id === loanId).revision;
  await apply({ type: "recordFundingCheckIn", fundingRevision, eventId: crypto.randomUUID(), kind: "Call", outcome: "Requested callback",
    note: "Fictional post-funding callback.", followUp: callbackDate });
  const fundedEvidence = read().funding;
  assert.ok(fundedEvidence.rows.some(({ label, status }) => /principal/i.test(label) && status === "Changed"));
  assert.equal(review("funding", { revision: 1, fileFingerprint: fundedEvidence.fingerprint }).message, "Cutover review saved.");
  assert.deepEqual(reviews().map(({ item, fileCurrent }) => [item, fileCurrent]).sort(), [["documents", true], ["funding", true], ["lender", true]]);

  const reversed = await apply({ type: "reverseFunding", fundingDate, revision: fundingRevision, reason: "Fictional funding reversal." });
  assert.deepEqual(reviews().map(({ item, fileCurrent }) => [item, fileCurrent]).sort(), [["documents", true], ["funding", false], ["lender", true]]);
  assert.match(review("funding", { revision: 2, fileFingerprint: fundedEvidence.fingerprint }).error, /comparison changed/i);
  const reversalRevision = reversed.closingProgress.find(({ loanId: id }) => id === loanId).revision;
  await apply({ type: "recordFunding", fundingDate, revision: reversalRevision });
  const refunded = read().funding;
  assert.ok(refunded.rows.some(({ label, status }) => /callback/i.test(label) && status === "Missing"));
  assert.match(review("funding", { revision: 2, fileFingerprint: refunded.fingerprint }).error, /resolve missing file inventory/i);

  assert.ok(store({ ...inventory, documents: [] }, 3).message);
  assert.deepEqual(reviews().map(({ item, fileCurrent }) => [item, fileCurrent]).sort(), [["documents", false], ["funding", false], ["lender", true]]);
  db.prepare("UPDATE submissions SET status = ? WHERE id = 'fixture-lender'").run("Approved");
  assert.deepEqual(reviews().map(({ item, fileCurrent }) => [item, fileCurrent]).sort(), [["documents", false], ["funding", false], ["lender", false]]);
  assert.match(review("lender", { revision: 2, fileFingerprint: withLender.lender.fingerprint }).error, /comparison changed/i);
  assert.ok(review("documents", { loanId: undefined }).message);
  assert.ok(review("funding", { loanId: undefined }).message);
  assert.ok(readMigrationCutover(db, staff, tenant, origin).evidence.reviews.every((review) => !Object.hasOwn(review, "fileCurrent")));

  const nextBasis = "c".repeat(64);
  batch.run(origin, nextBasis, nextBasis);
  assert.match(read().error, /source changed/i);
  assert.match(store(both, 4).error, /source changed/i);
  assert.deepEqual(read({ basis: nextBasis }), { revision: 0, source: null, documents: null, lender: null, funding: null });
  db.prepare("DELETE FROM migration_records WHERE origin = ? AND recordKey = 'Contact:borrower'").run(origin);
  assert.match(read({ basis: nextBasis }).error, /no longer linked/i);
  assert.match(store(both, 0, { basis: nextBasis }).error, /no longer linked/i);
});

test("file application cutover requires a current scoped comparison and preserves prior decisions when the draft changes", async (t) => {
  const { db, staff } = fixture(t);
  const tenant = staff.brokerage.id;
  const at = "2026-11-09T18:00:00.000Z";
  const origin = `orbit-${crypto.randomUUID()}`;
  const basis = "a".repeat(64);
  const other = { origin: `orbit-${crypto.randomUUID()}`, basis: "b".repeat(64) };
  const command = (input) => executeCommand(db, input, staff);
  const importContact = async (source, snapshot, id) => {
    const request = { type: "migratePipeline", origin: source, batch: { origin: source, snapshot, part: 1, partCount: 1 }, decisions: {},
      rows: [{ type: "Contact", externalId: id, role: "Borrower", name: "Fictional Borrower", email: `${id}@example.test`, phone: "" }] };
    const preview = await command(request);
    assert.ok(preview.migration, preview.error);
    const saved = await command({ ...request, preview: preview.migration.fingerprint });
    assert.ok(saved.state, saved.error);
    return saved.migration.rows[0].targetId;
  };
  const contactId = await importContact(origin, basis, "borrower");
  await importContact(other.origin, other.basis, "different-borrower");
  const imported = await command({ type: "importMismo", requestId: crypto.randomUUID(), existingContactId: contactId, extraBorrowers: 1, fictional: true,
    fields: { firstName: "Fictional", lastName: "Borrower", amount: "350000", purpose: "Purchase", occupancy: "Primary residence",
      street: "42 Fictional Lane", unit: "", city: "Troy", state: "MI", zip: "48084" } });
  const loanId = imported.applicationLoanId;
  assert.ok(loanId, imported.error);
  const query = { origin, basis, loanId };
  const read = (fields = {}, actor = staff, brokerage = tenant) => readCutoverApplicationComparison(db, actor, brokerage, { ...query, ...fields });
  const note = "Reviewed fictional source fields and documented the draft changes.";
  const review = { ...query, item: "application", decision: "Reconciled", note, revision: 1 };
  const save = (fields = {}, actor = staff, brokerage = tenant) => saveMigrationCutover(db, actor, brokerage, { ...review, ...fields }, at);
  const reviewOnFile = () => readMigrationCutover(db, staff, tenant, origin).evidence.drafts[0].reviews.find(({ item }) => item === "application");
  const roles = ["LO", "Processor"].map((role) => ({ ...staff, brokerage: { ...staff.brokerage, role } }));
  const nonPilot = { ...staff, brokerage: { ...staff.brokerage, pilot: false } };
  const initial = read();
  assert.equal(initial.missingExtraBorrowers, 1);
  assert.match(save({ applicationFingerprint: initial.fingerprint }).error, /resolve missing 1003/i);
  assert.match(read(other).error, /no longer linked/i);
  assert.match(read({ basis: other.basis }).error, /source changed/i);
  assert.match(read({ loanId: "unknown-file" }).error, /no longer linked/i);
  assert.ok(read({}, null).error);
  assert.ok(read({}, staff, crypto.randomUUID()).error);
  assert.ok(save({ applicationFingerprint: initial.fingerprint }, staff, crypto.randomUUID()).error);
  for (const actor of [...roles, nonPilot]) {
    assert.ok(read({}, actor).error);
    assert.ok(save({ applicationFingerprint: initial.fingerprint }, actor).error);
  }

  db.prepare(`INSERT INTO migration_cutover_loan_reviews (loanId, origin, basis, item, decision, note, updatedBy, updatedAt, revision)
    VALUES (?, ?, ?, 'application', 'Reconciled', ?, ?, ?, 1)`).run(loanId, origin, basis, note, staff.name, at);
  assert.deepEqual([reviewOnFile().applicationCurrent, reviewOnFile().decision, reviewOnFile().note], [false, "Reconciled", note]);
  assert.match(save().error, /application comparison changed/i);
  const draft = JSON.parse(db.prepare("SELECT draft FROM applications WHERE loanId = ?").get(loanId).draft);
  const coBorrower = blankBorrower();
  coBorrower.identity.fields.name = "Fictional Co-borrower";
  draft.urla.credit.fields.type = "Joint";
  draft.urla.additional.push(coBorrower);
  const update = db.prepare("UPDATE applications SET draft = ?, revision = revision + 1 WHERE loanId = ?");
  draft.propertyLocation.city = "";
  update.run(JSON.stringify(draft), loanId);
  const incomplete = read();
  assert.equal(incomplete.missingExtraBorrowers, 0);
  assert.equal(incomplete.rows.find(({ key }) => key === "city").status, "Missing in draft");
  assert.match(save({ applicationFingerprint: incomplete.fingerprint }).error, /resolve missing 1003/i);

  draft.propertyLocation.city = "Troy";
  draft.propertyLocation.unit = "A";
  draft.loanAmount = "351000";
  update.run(JSON.stringify(draft), loanId);
  const complete = read();
  assert.equal(complete.rows.find(({ key }) => key === "loanAmount").status, "Changed");
  assert.equal(complete.rows.find(({ key }) => key === "unit").status, "Added in draft");
  assert.match(save({ applicationFingerprint: incomplete.fingerprint }).error, /application comparison changed/i);
  assert.ok(save({ applicationFingerprint: complete.fingerprint, note: "" }).error);
  assert.equal(save({ applicationFingerprint: complete.fingerprint }).message, "Cutover review saved.");
  assert.equal(save({ applicationFingerprint: complete.fingerprint }).message, "This review is up to date.");
  assert.equal(reviewOnFile().applicationCurrent, true);
  const stored = db.prepare("SELECT applicationFingerprint, applicationRevision FROM migration_cutover_loan_reviews WHERE loanId = ?").get(loanId);
  assert.deepEqual({ ...stored }, { applicationFingerprint: complete.fingerprint, applicationRevision: complete.revision });

  update.run(JSON.stringify(draft), loanId);
  assert.equal(read().fingerprint, complete.fingerprint);
  assert.equal(reviewOnFile().applicationCurrent, true);
  assert.equal(save({ applicationFingerprint: complete.fingerprint }).message, "This review is up to date.");
  assert.equal(db.prepare("SELECT applicationRevision FROM migration_cutover_loan_reviews WHERE loanId = ?").get(loanId).applicationRevision, complete.revision);
  draft.loanAmount = "352000";
  update.run(JSON.stringify(draft), loanId);
  assert.deepEqual([reviewOnFile().applicationCurrent, reviewOnFile().decision, reviewOnFile().note], [false, "Reconciled", note]);
  assert.match(save({ applicationFingerprint: complete.fingerprint, revision: 2 }).error, /application comparison changed/i);
  const current = read();
  assert.match(save({ applicationFingerprint: current.fingerprint }).error, /review changed/i);
  assert.equal(save({ applicationFingerprint: current.fingerprint, revision: 2 }).message, "Cutover review saved.");
  assert.equal(reviewOnFile().applicationCurrent, true);
  assert.equal(save({ loanId: undefined, revision: 0 }).message, "Cutover review saved.");
  assert.equal(Object.hasOwn(readMigrationCutover(db, staff, tenant, origin).evidence.reviews[0], "applicationCurrent"), false);
});

test("a numbered snapshot resumes across imports and preserves links between batches", async (t) => {
  const source = fixture(t);
  const destination = fixture(t);
  const at = "2026-11-03T15:00:00.000Z";
  for (let i = 0; i < 101; i++) {
    insertContact(source.db, { id: `contact-${String(i).padStart(3, "0")}`, name: `Fictional Contact ${i}`, email: "", phone: "", role: "Borrower" });
  }
  const insertLead = source.db.prepare(`INSERT INTO referral_leads
    (id, requestId, name, email, phone, purpose, officer, createdAt, dueAt, importedContactId)
    VALUES (?, ?, ?, '', '', 'Purchase', '', ?, ?, 'contact-000')`);
  for (let i = 0; i < 100; i++) {
    const id = `lead-${String(i).padStart(3, "0")}`;
    insertLead.run(id, id, `Fictional Lead ${i}`, at, at);
  }
  source.db.prepare(`INSERT INTO lead_events (id, leadId, at, actor, kind, text)
    VALUES ('note-1', 'lead-000', ?, 'Pilot LO', 'Note', 'Check purchase timeline')`).run(at);
  source.db.prepare(`INSERT INTO lead_import_tasks (id, leadId, title, dueAt, purpose)
    VALUES ('task-1', 'lead-000', 'Review updated timeline', ?, 'Loan service')`).run(at);
  const result = exportPilotPipeline(source.db, source.staff);
  assert.equal(result.total, 203);
  assert.deepEqual(result.batches.map(({ count }) => count), [100, 100, 3]);
  assert.equal(exportPilotPipeline(source.db, source.staff).snapshot, result.snapshot);
  source.db.prepare("UPDATE contacts SET name = 'Changed later' WHERE id = 'contact-000'").run();
  assert.notEqual(exportPilotPipeline(source.db, source.staff).snapshot, result.snapshot);

  const inputs = result.batches.map(({ csv }) => {
    const file = migrationFile(csv);
    return { type: "migratePipeline", origin: file.orbitSource, batch: file.batch,
      rows: mappedMigrationRows(file, file.mapping), decisions: {} };
  });
  const [first, second, third] = inputs;
  const command = (data) => executeCommand(destination.db, data, destination.staff, undefined, []);
  const commit = async (data) => {
    const preview = await command(data);
    assert.ok(preview.migration, preview.error);
    assert.ok(preview.migration.rows.every(({ status }) => status === "Create"));
    const input = { ...data, preview: preview.migration.fingerprint };
    const result = await command(input);
    assert.ok(result.state, result.error);
    return { result, input };
  };
  assert.match((await command(second)).error, /Import batch 1 of 3 before batch 2/);
  assert.match((await command({ ...first, origin: "wrong-source" })).error, /source key embedded/);
  const start = await commit(first);
  assert.equal(start.result.migration.batch.nextPart, 2);
  assert.match((await command(third)).error, /Import batch 2 of 3 before batch 3/);
  const replay = await command(start.input);
  assert.deepEqual(replay.migration.batch, { completed: true, nextPart: 2 });
  assert.ok(replay.migration.rows.every(({ status }) => status === "Previously imported"));
  assert.match((await command({ ...first, rows: [{ ...first.rows[0], name: "Changed CSV" }, ...first.rows.slice(1)] })).error,
    /already imported with different records/);
  await commit(second);
  const { result: final } = await commit(third);
  assert.equal(final.migration.batch.nextPart, null);
  const restoredLead = final.state.inboxLeads.find(({ name }) => name === "Fictional Lead 0");
  const restoredContact = final.state.contacts.find(({ name }) => name === "Fictional Contact 0");
  assert.equal(restoredLead.importedContactId, restoredContact.id);
  assert.equal(restoredLead.followUp.events[0].text, "Check purchase timeline");
  assert.equal(restoredLead.importedTasks[0].title, "Review updated timeline");
  assert.equal((await command(first)).migration.batch.nextPart, null);
  assert.equal(destination.db.prepare("SELECT count(*) AS total FROM contacts").get().total, 101);
  assert.equal(destination.db.prepare("SELECT count(*) AS total FROM referral_leads").get().total, 100);
});

test("Unicode follow-ups fit the upload byte limit across export batches", (t) => {
  const { db, staff } = fixture(t);
  insertContact(db, { id: "borrower", name: "Fictional Borrower", email: "", phone: "", role: "Borrower" });
  const insert = db.prepare(`INSERT INTO contact_activity (id, contactId, officer, kind, text, createdAt, dueAt, purpose)
    VALUES (?, 'borrower', 'Pilot LO', 'Note', ?, '2026-11-03', '2026-11-04', 'Loan service')`);
  for (let i = 0; i < 50; i++) insert.run(`task-${i}`, "界".repeat(2000));
  const result = exportPilotPipeline(db, staff);
  assert.equal(result.total, 51);
  assert.ok(result.batches.length > 1);
  for (const { csv, count } of result.batches) {
    assert.ok(Buffer.byteLength(csv, "utf8") <= migrationFileByteLimit);
    assert.equal(migrationFile(csv).rows.length, count);
  }
});

test("missing owners can be mapped or left unassigned, and a saved mapping still requires an active owner", async (t) => {
  const { db, staff } = fixture(t);
  const owner = { name: "Pilot LO", email: "lo@example.test" };
  const replacement = { ...owner, email: "replacement@example.test" };
  const former = "departed@example.test";
  const otherFormer = "unassigned@example.test";
  const origin = `orbit-${crypto.randomUUID()}`;
  const batch = { origin, snapshot: "a".repeat(64), partCount: 3 };
  const at = "2026-11-03T15:00:00.000Z";
  const lead = { type: "Lead", externalId: "lead-1", parentId: "contact-1", name: "Fictional Borrower", email: "borrower@example.test",
    phone: "", ownerEmail: former, purpose: "Purchase", source: "Imported CRM", zip: "", createdAt: at, dueAt: "" };
  const followUp = { type: "Task", externalId: "follow-up-1", parentId: "contact-1", parentType: "Contact", dueAt: at,
    completedAt: "", text: "Review paperwork", ownerEmail: former, taskPurpose: "Loan service" };
  const [first, second, third] = [
    [
      { type: "Contact", externalId: "contact-1", name: lead.name, email: lead.email, phone: "", role: "Borrower" },
      lead, { ...lead, externalId: "lead-2", name: "Fictional Second Inquiry", ownerEmail: otherFormer },
      { type: "Task", externalId: "lead-task", parentId: "lead-1", dueAt: at, completedAt: "", text: "Call about timeline" },
    ],
    [followUp, { ...followUp, externalId: "follow-up-2", text: "Check if contact replied", ownerEmail: otherFormer }],
    [{ ...followUp, externalId: "follow-up-3", text: "Confirm next steps" }],
  ].map((rows, index) => ({ type: "migratePipeline", origin, batch: { ...batch, part: index + 1 }, rows, decisions: {} }));
  let members = [owner, replacement];
  const command = (data) => executeCommand(db, data, staff, undefined, members);
  const missing = await command(first);
  assert.equal(missing.migration.rows.find(({ key }) => key === "Lead:lead-1").status, "Review");
  assert.deepEqual(missing.migration.ownership.missing.map(({ email }) => email), [former, otherFormer]);
  const invalid = await command({ ...first, ownerMappings: { [former]: "other-brokerage@example.test" } });
  assert.equal(invalid.migration.rows.find(({ key }) => key === "Lead:lead-1").status, "Review");
  const choices = { [former]: owner.email, [otherFormer]: "unassigned" };
  const prepared = { ...first, ownerMappings: choices };
  const reviewed = await command(prepared);
  assert.ok(reviewed.migration.rows.every(({ status }) => status === "Create"));
  assert.equal(db.prepare("SELECT count(*) AS total FROM migration_owner_mappings").get().total, 0);
  const changed = await command({ ...prepared, ownerMappings: { ...choices, [former]: replacement.email }, preview: reviewed.migration.fingerprint });
  assert.match(changed.error, /preview changed/i);
  const imported = await command({ ...prepared, preview: reviewed.migration.fingerprint });
  assert.ok(imported.state, imported.error);
  const assigned = imported.state.inboxLeads.find(({ name }) => name === lead.name);
  assert.equal(assigned.officerEmail, owner.email);
  assert.equal(assigned.importedTasks[0].title, "Call about timeline");
  assert.equal(imported.state.inboxLeads.find(({ name }) => name === "Fictional Second Inquiry").officerEmail, null);

  const saved = await command(second);
  assert.ok(saved.migration.rows.every(({ status }) => status === "Create"));
  assert.deepEqual(saved.migration.ownership.missing.map(({ target }) => target), [owner.email, "unassigned"]);
  const next = await command({ ...second, preview: saved.migration.fingerprint });
  assert.ok(next.state, next.error);
  assert.equal(next.state.contactActivity.find(({ text }) => text === followUp.text).followUpOwnerEmail, owner.email);
  assert.equal(next.state.contactActivity.find(({ text }) => text === "Check if contact replied").followUpOwnerEmail, null);

  const earlier = await command(third);
  members = [replacement];
  assert.match((await command({ ...third, preview: earlier.migration.fingerprint })).error, /preview changed/i);
  const revoked = await command(third);
  assert.equal(revoked.migration.ownership.missing[0].target, undefined);
  assert.equal(revoked.migration.rows[0].status, "Review");
  const reassigned = { ...third, ownerMappings: { [former]: replacement.email } };
  const resolved = await command(reassigned);
  const completed = await command({ ...reassigned, preview: resolved.migration.fingerprint });
  assert.equal(completed.state.contactActivity.find(({ text }) => text === "Confirm next steps").followUpOwnerEmail, replacement.email);
  assert.equal((await command(prepared)).migration.batch.nextPart, null);
});

test("the export refuses an oversized pilot snapshot without silently truncating it", (t) => {
  const { db, staff } = fixture(t);
  for (let i = 0; i < 1001; i++) {
    insertContact(db, { id: `contact-${i}`, name: `Fictional Contact ${i}`, email: "", phone: "", role: "Borrower" });
  }
  assert.match(exportPilotPipeline(db, staff).error, /1,000 records/);
});

test("CRM undo rejects stale previews, protects worked records, and prevents replay from recreating removals", async (t) => {
  const { db, staff } = fixture(t);
  const other = fixture(t);
  const at = "2026-11-03T15:00:00.000Z";
  const contact = (externalId, name, extra = {}) => ({ type: "Contact", externalId, name,
    role: "Borrower", email: `${externalId}@example.test`, phone: "", ...extra });
  const lead = (externalId, name, parentId = "") => ({ type: "Lead", externalId, parentId, name,
    ownerEmail: "", purpose: "Purchase", source: "Imported CRM", zip: "", email: `${externalId}@example.test`, phone: "", createdAt: at, dueAt: "" });
  insertContact(db, { id: "existing-partner", name: "Fictional Existing Partner", email: "partner@example.test", phone: "", role: "Realtor" });
  const origin = `orbit-${crypto.randomUUID()}`;
  const batch = { origin, snapshot: "a".repeat(64), partCount: 2, part: 1 };
  const initial = { type: "migratePipeline", origin, batch, decisions: { "Contact:partner": "existing-partner", "Contact:skip": "skip" }, rows: [
    contact("untouched", "Fictional Untouched"),
    contact("shared", "Fictional Shared"),
    contact("opted-out", "Fictional Opt Out", { optedOut: "Yes" }),
    contact("partner", "Fictional Existing Partner", { role: "Realtor" }),
    contact("skip", "Fictional Skipped"),
    lead("untouched-lead", "Fictional Untouched", "untouched"),
    lead("worked", "Fictional Worked"),
    lead("converted", "Fictional Converted"),
    { type: "Note", externalId: "fresh-note", parentId: "untouched-lead", createdAt: at, text: "Ask about purchase timing." },
    { type: "Note", externalId: "worked-note", parentId: "worked", createdAt: at, text: "The source call notes go here." },
    { type: "Task", externalId: "fresh-task", parentId: "untouched-lead", dueAt: at, completedAt: "", text: "Review timeline" },
    { type: "Task", externalId: "converted-task", parentId: "converted", dueAt: at, completedAt: "", text: "Collect first documents" },
  ] };
  const command = (input) => executeCommand(db, input, staff);
  const commit = async (input) => {
    const preview = await command(input);
    assert.ok(preview.migration, preview.error);
    const result = await command({ ...input, preview: preview.migration.fingerprint });
    assert.ok(result.state, result.error);
    return result;
  };
  await command(initial);
  assert.deepEqual(reviewMigrationRecovery(db, staff).imports, []);
  const imported = await commit(initial);
  const [receipt] = reviewMigrationRecovery(db, staff).imports;
  assert.equal(receipt.recordCount, initial.rows.length);
  assert.deepEqual([receipt.part, receipt.partCount], [1, 2]);
  const previewFor = (id = receipt.id) => reviewMigrationRecovery(db, staff, id).preview;
  const review = () => new Map(previewFor().rows.map((row) => [row.key, row]));
  const undo = (preview) => ({ type: "undoMigration", importId: preview.receipt.id, fingerprint: preview.fingerprint, confirmed: true });
  const staleUndo = undo(previewFor());
  const before = review();
  for (const key of ["Contact:untouched", "Lead:untouched-lead", "Note:fresh-note", "Task:fresh-task", "Lead:worked", "Contact:shared"]) {
    assert.equal(before.get(key).result, "Candidate");
  }
  assert.match(before.get("Contact:partner").reason, /already existed/);
  assert.match(before.get("Contact:opted-out").reason, /opt-out/);
  assert.equal(before.get("Contact:skip").result, "No change");

  const worked = imported.state.inboxLeads.find(({ name }) => name === "Fictional Worked");
  const log = await command({ type: "leadContact", leadId: worked.id, revision: worked.followUp.revision,
    channel: "Call", outcome: "Connected", note: "Staff verified the purchase timeline." });
  assert.ok(log.state, log.error);
  const converted = imported.state.inboxLeads.find(({ name }) => name === "Fictional Converted");
  const loan = await command({ type: "convertReferral", referralId: converted.id, contactId: null, allowDuplicate: false });
  assert.ok(loan.referralLoanId, loan.error);
  await commit({ type: "migratePipeline", origin, batch: { ...batch, part: 2 }, decisions: {},
    rows: [lead("linked-later", "Fictional Later Lead", "shared")] });
  const after = review();
  assert.match(after.get("Lead:worked").reason, /worked this record/);
  assert.equal(after.get("Note:worked-note").result, "Keep");
  assert.match(after.get("Lead:converted").reason, /loan file/);
  assert.equal(after.get("Task:converted-task").result, "Keep");
  assert.match(after.get("Contact:shared").reason, /outside this recovery set/);
  assert.equal(after.get("Lead:untouched-lead").result, "Candidate");
  assert.match((await command(staleUndo)).error, /preview changed/i);
  assert.equal(db.prepare("SELECT count(*) AS total FROM migration_import_undos").get().total, 0);
  const currentUndo = undo(previewFor());
  assert.match((await executeCommand(other.db, currentUndo, other.staff)).error, /unavailable/);
  const lo = { ...staff, brokerage: { ...staff.brokerage, role: "LO" } };
  assert.match((await executeCommand(db, currentUndo, lo)).error, /pilot admin/);
  assert.ok((await command({ ...currentUndo, confirmed: false })).error);

  db.exec(`CREATE TRIGGER fail_undo BEFORE DELETE ON contacts WHEN OLD.name = 'Fictional Untouched'
    BEGIN SELECT RAISE(ABORT, 'Simulated write failure'); END;`);
  const logFailure = t.mock.method(console, "error", () => {});
  try {
    assert.match((await command(currentUndo)).error, /could not save/i);
  } finally {
    logFailure.mock.restore();
  }
  assert.equal(db.prepare("SELECT count(*) AS total FROM migration_import_undos").get().total, 0);
  assert.equal(db.prepare("SELECT count(*) AS total FROM migration_undone_records").get().total, 0);
  assert.equal(review().get("Note:fresh-note").result, "Candidate");
  db.exec("DROP TRIGGER fail_undo");

  const removed = await command(currentUndo);
  assert.match(removed.message, /Removed 4 CRM records/);
  assert.ok(removed.state.inboxLeads.some(({ id }) => id === worked.id));
  assert.ok(removed.state.contacts.some(({ name }) => name === "Fictional Shared"));
  assert.ok(!removed.state.contacts.some(({ name }) => name === "Fictional Untouched"));
  assert.equal(review().get("Contact:untouched").removal.by, staff.email);
  assert.match((await command(currentUndo)).message, /already recorded/);
  assert.equal(db.prepare("SELECT count(*) AS total FROM migration_import_undos").get().total, 1);
  const batchReplay = await command(initial);
  assert.equal(batchReplay.migration.rows.find(({ key }) => key === "Contact:untouched").status, "Undone");
  const csvReplay = await command({ ...initial, batch: undefined });
  assert.equal(csvReplay.migration.rows.find(({ key }) => key === "Contact:untouched").status, "Undone");
  assert.ok((await command({ ...initial, batch: undefined, preview: csvReplay.migration.fingerprint })).state);
  assert.equal(reviewMigrationRecovery(db, staff).imports.length, 2);
  const later = reviewMigrationRecovery(db, staff).imports.find(({ part }) => part === 2);
  assert.match((await command(undo(previewFor(later.id)))).message, /Removed 1 CRM record/);
  assert.equal(review().get("Contact:shared").result, "Candidate");
  assert.match((await command(undo(previewFor()))).message, /Removed 1 CRM record/);
  assert.equal(review().get("Contact:shared").result, "Removed");
  assert.equal(review().get("Note:fresh-note").result, "Removed");
  assert.equal(review().get("Task:converted-task").result, "Keep");
  assert.match(reviewMigrationRecovery(other.db, other.staff, receipt.id).error, /unavailable/);
  assert.match(reviewMigrationRecovery(db, lo, receipt.id).error, /pilot admin/);
  assert.equal(db.prepare("SELECT count(*) AS total FROM loans").get().total, 1);
});

test("correction mode reimports only selected undone rows under the same source and keeps both undo receipts", async (t) => {
  const { db, staff } = fixture(t);
  const at = "2026-11-03T15:00:00.000Z";
  const contact = (externalId, name) => ({ type: "Contact", externalId, name, email: `${externalId}@example.test`, phone: "", role: "Borrower" });
  const borrower = contact("borrower", "Fictional Borrower");
  const kept = contact("kept", "Fictional Retained");
  const untouched = contact("untouched", "Fictional Leave Undone");
  const lead = { type: "Lead", externalId: "lead", name: borrower.name, parentId: borrower.externalId, email: borrower.email,
    phone: "", ownerEmail: "", purpose: "Purchase", source: "Imported CRM", zip: "", createdAt: at, dueAt: "" };
  const followUp = { type: "Task", externalId: "follow-up", parentId: lead.externalId, dueAt: at, completedAt: "", text: "Check old timeline" };
  const origin = `orbit-${crypto.randomUUID()}`;
  const batch = { origin, snapshot: "c".repeat(64), partCount: 2, part: 1 };
  const original = { type: "migratePipeline", origin, batch, decisions: {}, rows: [borrower, kept, untouched, lead, followUp] };
  const command = (input) => executeCommand(db, input, staff);
  const commit = async (input) => {
    const preview = await command(input);
    assert.ok(preview.migration, preview.error);
    const result = await command({ ...input, preview: preview.migration.fingerprint });
    assert.ok(result.state, result.error);
    return result;
  };
  const receiptList = () => reviewMigrationRecovery(db, staff).imports;
  const recovery = (id) => reviewMigrationRecovery(db, staff, id).preview;
  const undo = async (id) => {
    const result = await command({ type: "undoMigration", importId: id, confirmed: true, fingerprint: recovery(id).fingerprint });
    assert.ok(result.state, result.error);
  };
  const imported = await commit(original);
  const retained = imported.state.contacts.find(({ email }) => email === kept.email);
  assert.ok((await command({ type: "contact", ...retained, name: "Fictional Staff Edit" })).state);
  const originalId = receiptList()[0].id;
  await undo(originalId);

  // Rehearse upgrading the prior SQLite schema with an existing undo.
  db.exec(`CREATE TABLE old_undo_records (origin TEXT NOT NULL, recordKey TEXT NOT NULL,
      undoId TEXT NOT NULL REFERENCES migration_import_undos(id), PRIMARY KEY (origin, recordKey));
    INSERT INTO old_undo_records SELECT origin, recordKey, undoId FROM migration_undone_records;
    DROP TABLE migration_undone_records;
    ALTER TABLE old_undo_records RENAME TO migration_undone_records;`);
  initializeStore(db, false);
  assert.equal(recovery(originalId).rows.filter(({ result }) => result === "Removed").length, 4);

  const corrected = { ...original, correctionKeys: [], rows: [
    { ...borrower, name: "Fictional Corrected Borrower" },
    { ...kept, name: "Incoming Value Must Stay Unapplied" },
    untouched,
    { ...lead, name: "Fictional Corrected Borrower" },
    { ...followUp, text: "Check corrected timeline" },
    contact("new", "Fictional Unrelated Row"),
  ] };
  const selection = ["Contact:borrower", "Lead:lead", "Task:follow-up"];
  const invalid = await command({ ...corrected, correctionKeys: ["Contact:new"] });
  assert.match(invalid.error, /select only rows/i);
  const missingParent = await command({ ...corrected, correctionKeys: ["Task:follow-up"] });
  assert.equal(missingParent.migration.rows.find(({ key }) => key === "Task:follow-up").status, "Review");
  assert.match((await command({ ...corrected, correctionKeys: undefined })).error, /different records/);

  const selected = { ...corrected, correctionKeys: selection };
  const prepared = await command(selected);
  assert.equal(prepared.migration.rows.find(({ key }) => key === "Contact:new").status, "Skipped");
  assert.equal(prepared.migration.rows.find(({ key }) => key === "Contact:untouched").status, "Undone");
  assert.ok(prepared.migration.rows.filter(({ correction, status }) => correction && status === "Create").length === 3);
  const request = { ...selected, preview: prepared.migration.fingerprint };
  const result = await command(request);
  assert.match(result.message, /Reimported 3/);
  const correctedBorrower = result.state.contacts.find(({ email }) => email === borrower.email);
  const correctedLead = result.state.inboxLeads.find(({ name }) => name === correctedBorrower.name);
  assert.equal(correctedLead.importedContactId, correctedBorrower.id);
  assert.equal(correctedLead.importedTasks[0].title, "Check corrected timeline");
  assert.equal(result.state.contacts.find(({ id }) => id === retained.id).name, "Fictional Staff Edit");
  assert.ok(!result.state.contacts.some(({ email }) => email === untouched.email || email === "new@example.test"));
  assert.match((await command(request)).error, /preview changed/i);
  const replay = await command(original);
  assert.equal(replay.migration.batch.nextPart, 2);
  assert.equal(replay.migration.rows.find(({ key }) => key === "Lead:lead").status, "Previously imported");
  assert.equal(replay.migration.rows.find(({ key }) => key === "Contact:untouched").status, "Undone");

  const correctedId = receiptList().find(({ id }) => id !== originalId).id;
  assert.equal(recovery(correctedId).rows.find(({ key }) => key === "Lead:lead").correction, true);
  assert.equal(recovery(originalId).rows.find(({ key }) => key === "Lead:lead").result, "Removed");
  await undo(correctedId);
  assert.equal(recovery(correctedId).rows.find(({ key }) => key === "Lead:lead").result, "Removed");
  assert.equal(recovery(originalId).rows.find(({ key }) => key === "Lead:lead").result, "Removed");
  assert.match((await command(request)).error, /preview changed/i);
  assert.match((await commit(selected)).message, /Reimported 3/);
});

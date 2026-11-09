import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });
const { applicationSteps, sampleApplication } = await import("../src/lib/application-model.ts");
const { coBorrowerReviewStep, primaryJointDraft, sampleCoBorrower } = await import("../src/lib/joint-application-model.ts");
const { campaignCallQueues, campaignOrigin, parseCampaignLeadCsv } = await import("../src/lib/call-campaign-model.ts");
const { afterHours, defaultPlaybook, fundingTaskId } = await import("../src/lib/playbook-model.ts");
const { defaultManagerExceptionFilters } = await import("../src/lib/manager-exception-model.ts");
const { reviewTarget } = await import("../src/lib/loan-review-model.ts");
const { shiftReportDate } = await import("../src/lib/report-date-range.ts");
const { closingReviewReady, loanNextAction } = await import("../src/lib/loan-workflow.ts");
const { manualReturnStatus, manualReturnSteps } = await import("../src/lib/lender-export-model.ts");
const { pricingScenarioOption, sampleScenarioPlan } = await import("../src/lib/loan-scenario-model.ts");
const { Miniflare, convertV4MiniflareOptions } = createRequire(import.meta.resolve("wrangler"))("miniflare");
const server = fileURLToPath(new URL("../dist/server/", import.meta.url));
const config = createRequire(import.meta.url)(join(server, "wrangler.json"));
const { default: manifest } = await import("../dist/server/__vinext_action_owner_manifest.js");
const actions = Object.fromEntries(Object.keys(manifest).map((reference) => [reference.split("#").at(-1), reference]));
const actor = (name, email, role) => ({ name, email, role, token: randomBytes(32).toString("base64url") });
const owner = actor("Fictional Owner", "working-day-owner@example.test", "Admin");
const officer = actor("Fictional Officer", "working-day-officer@example.test", "LO");
const competingOfficer = actor("Fictional Backup Officer", "working-day-backup@example.test", "LO");
const processor = actor("Fictional Processor", "working-day-processor@example.test", "Processor");
const brokerage = randomUUID();
// This entry point exists only in the local fixture so it can simulate a lost wake.
const fixtureScript = `
import worker, { OrbitWorkspace } from "./index.js";
export default worker;
export class WorkingDayWorkspace extends OrbitWorkspace {
  async missReminderAlarm() {
    const storage = this.ctx.storage;
    await storage.deleteAlarm();
    storage.sql.exec("UPDATE document_reminder_schedule SET nextAt = ? WHERE id = 1", Date.now() - 1000);
  }
}`;
const runtime = new Miniflare({ ...convertV4MiniflareOptions({
  name: "orbit-working-day", host: "127.0.0.1",
  modules: [{ type: "ESModule", path: join(server, "working-day-entry.mjs"), contents: fixtureScript },
    ...(await readdir(server, { recursive: true, withFileTypes: true }))
      .filter((file) => file.isFile() && /\.m?js$/.test(file.name))
      .map((file) => ({ type: "ESModule", path: join(file.parentPath, file.name) }))],
  modulesRoot: server, compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { ORBIT_AUTH_MODE: "google", GOOGLE_CLIENT_ID: "local-fixture", GOOGLE_CLIENT_SECRET: "local-fixture",
    ORBIT_STAFF_EMAILS: owner.email, ORBIT_DOCUMENT_UPLOADS: "mock", ORBIT_PRICING_MODE: "mock" },
  serviceBindings: { ASSETS: () => new Response(null, { status: 404 }) },
  r2Buckets: { DOCUMENTS: "working-day-fictional-documents" },
  durableObjects: { WORKSPACE: { className: "WorkingDayWorkspace", useSQLite: true } },
}), telemetry: { enabled: false } });

try {
  const { origin } = await runtime.ready;
  const workspaces = await runtime.getDurableObjectNamespace("WORKSPACE");
  const directory = workspaces.getByName("orbit-demo");
  const setupStarted = performance.now();
  const now = Date.now();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const dueAt = new Date(now - 60 * 60_000).toISOString();
  const requests = {};
  const stages = [];
  const handoffs = [];
  const countRequest = (role) => { requests[role] = (requests[role] ?? 0) + 1; };
  async function stage(name, run) {
    const start = performance.now();
    const result = await run();
    stages.push({ name, elapsedMs: Math.round(performance.now() - start) });
    return result;
  }
  async function postResponse(path, input, staff) {
    countRequest(staff?.role ?? (path.startsWith("/api/realtor") ? "Realtor" : "Borrower"));
    const response = await runtime.dispatchFetch(`${origin}${path}`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", ...(staff ? { Cookie: `__Host-orbit-session=${staff.token}` } : {}) },
      body: JSON.stringify(input),
    });
    const result = response.headers.get("Content-Type")?.includes("application/json")
      ? await response.json() : { error: await response.text() };
    return { status: response.status, result };
  }
  async function post(path, input, staff) {
    const { status, result } = await postResponse(path, input, staff);
    assert.equal(status, 200, result.error ?? path);
    return result;
  }
  async function action(staff, name, input, scope, expectedBrokerage = brokerage) {
    countRequest(staff.role);
    const response = await runtime.dispatchFetch(`${origin}/workspace?brokerage=${brokerage}`, {
      method: "POST", headers: { Origin: origin, "Next-Action": actions[name], Accept: "text/x-component",
        "Content-Type": "text/plain;charset=UTF-8", Cookie: `__Host-orbit-session=${staff.token}` },
      body: JSON.stringify(scope ? [input, expectedBrokerage, scope] : [input, expectedBrokerage]),
    });
    assert.equal(response.status, 200, name);
    const body = await response.text();
    const line = body.split("\n").find((row) => row.startsWith("0:"));
    assert.ok(line, `No action result for ${name}`);
    const { returnValue } = JSON.parse(line.slice(2));
    assert.equal(returnValue.ok, true, name);
    const data = returnValue.data;
    // React streams a long XML result as a separate length-prefixed text chunk.
    const xmlReference = /^\$([a-f0-9]+)$/.exec(data?.mismoXml ?? "");
    if (xmlReference) {
      const chunk = new RegExp(`(?:^|\\n)${xmlReference[1]}:T([a-f0-9]+),`).exec(body);
      assert.ok(chunk, "The MISMO action must include its XML text chunk");
      const bytes = Buffer.from(body.slice(chunk.index + chunk[0].length));
      data.mismoXml = bytes.subarray(0, Number.parseInt(chunk[1], 16)).toString("utf8");
    }
    return data;
  }
  async function write(staff, input) {
    const result = await action(staff, "mutate", input);
    assert.ok(result.message, result.error ?? input.type);
    return result;
  }
  const team = (staff, input) => post(`/api/brokerages?brokerage=${brokerage}`, input, staff);
  function readTeam(staff, input = {}, scope = brokerage) {
    countRequest(staff.role);
    return runtime.dispatchFetch(`${origin}/api/brokerages?${new URLSearchParams({ brokerage: scope, ...input })}`, {
      headers: { Cookie: `__Host-orbit-session=${staff.token}` },
    });
  }
  const file = async (staff, loanId) => {
    const result = await action(staff, "readLoanForWork", loanId);
    assert.equal(result.loans?.[0]?.id, loanId, result.error);
    return result;
  };
  const workspace = async (staff) => (await write(staff, { type: "refreshWorkspace" })).state;
  const queue = (staff) => action(staff, "readMyTasksToday", { horizon: 7 });
  const incoming = (staff, view) => action(staff, "readIncomingLoanWork", { view });
  async function measureHandoff(direction, send, receiver, view, loanId) {
    assert.ok(!(await incoming(receiver, view)).items.some(({ kind, id }) => kind === "handoff" && id === loanId));
    const started = performance.now();
    await send();
    const acknowledged = performance.now();
    const offered = (await incoming(receiver, view)).items.find(({ kind, id }) => kind === "handoff" && id === loanId);
    handoffs.push({ direction, writeMs: Math.round(acknowledged - started),
      firstQueueReadMs: Math.round(performance.now() - acknowledged) });
    assert.ok(offered, "The first read after acknowledgment must show the exact loan");
    return offered;
  }
  const upcomingCallbacks = (staff) => action(staff, "readMyCampaignCallbacks", { view: "Upcoming" });
  const borrower = (token, input) => post("/api/demo-application", { token, ...input });
  const realtor = (token) => post("/api/realtor-referrals", { type: "read", token });
  const loanAction = (staff, loanId, type, fields = {}) => write(staff, { type, loanId, ...fields });
  async function signIn(staff) {
    const { token, ...identity } = staff;
    await directory.activateStaff(identity, [owner.email]);
    await directory.createStaffSession(createHash("sha256").update(token).digest("base64url"), identity, now + 3_600_000, now);
  }
  async function importRows(input) {
    const migrate = async (value) => {
      if (input.campaignId) return write(owner, value);
      const result = await action(owner, "mutate", value, "migration");
      assert.equal(result.migrationChanged, Boolean(value.preview), result.error);
      assert.equal(result.state, undefined);
      return result;
    };
    const reviewed = await migrate(input);
    assert.ok(reviewed.migration.rows.every(({ status }) => status !== "Review"));
    return (await migrate({ ...input, preview: reviewed.migration.fingerprint })).migration;
  }

  await signIn(owner);
  const created = await directory.manage({ email: owner.email, name: owner.name, brokerage: { id: "orbit-demo" } },
    [owner.email], { type: "create", id: brokerage, name: "Fictional Working Day", pilot: true });
  assert.equal(created.created, brokerage, created.error);
  for (const staff of [officer, processor, competingOfficer]) {
    await team(owner, { type: "invite", email: staff.email, role: staff.role });
    await signIn(staff);
  }
  const setupMs = Math.round(performance.now() - setupStarted);

  const imported = { name: "Avery Working Day", email: "avery-working-day@example.test", phone: "248-555-0142" };
  const campaignId = randomUUID();
  const secondReview = { reviewerEmail: owner.email, dueDays: 2 };
  const checkpointPolicy = { secondReview, requireSecondReview: true };
  const campaignCallbackAt = new Date(now + 86_400_000).toISOString();
  const callbackPerformance = (staff = owner) => action(staff, "readCampaignCallbackPerformance", { campaignId });
  const leadId = await stage("Owner imports and routes CRM work", async () => {
    await write(owner, { type: "createCallCampaign", id: campaignId, name: "Fictional migrated pipeline" });
    await write(owner, { type: "saveCampaignRules", campaignId, revision: 0, voicemailDays: 1, noResponseDays: 2, maxAttempts: 3, retryTime: "15:30" });
    await write(owner, { type: "saveCampaignRouting", campaignId, revision: 0, enabled: true,
      officers: [{ email: officer.email, limit: 1 }, { email: owner.email, limit: 1 }] });
    const result = await importRows({ type: "migratePipeline", origin: "working-day", decisions: {}, rows: [
      { type: "Contact", externalId: "avery", role: "Borrower", ...imported },
      { type: "Contact", externalId: "partner", role: "Realtor", name: "Fictional Working Day Realtor",
        email: "partner-working-day@example.test", phone: "" },
      { type: "Lead", externalId: "referral", parentId: "avery", realtorId: "partner", ...imported,
        ownerEmail: "", purpose: "Purchase", source: "Realtor referral", zip: "48067", createdAt: dueAt, dueAt },
      { type: "Task", externalId: "callback", parentId: "referral", dueAt, completedAt: "", text: "Call migrated borrower", taskPurpose: "Loan service" },
    ] });
    const id = result.rows.find(({ key }) => key === "Lead:referral").targetId;
    const importedLead = { type: "result", origin: "working-day", key: "Lead:referral", targetId: id };
    assert.deepEqual((await action(owner, "openMigrationRecord", importedLead)).destination, { kind: "lead", id });
    assert.ok((await action(officer, "openMigrationRecord", importedLead)).error);
    assert.ok((await action(processor, "openMigrationRecord", importedLead)).error);
    assert.ok((await action(owner, "openMigrationRecord", importedLead, undefined, randomUUID())).error);
    await write(owner, { type: "addCampaignLead", campaignId, leadId: id });
    const extra = { type: "migratePipeline", origin: campaignOrigin(campaignId), campaignId, decisions: {},
      rows: [1, 2, 3].map((n) => ({ type: "Lead", externalId: `extra-${n}`, parentId: "",
        name: `Fictional campaign overflow ${n}`, email: `overflow-${n}@example.test`, phone: `248-555-015${n}`,
        ownerEmail: "", purpose: "Purchase", source: "Imported CRM", zip: "48067", createdAt: dueAt, dueAt })) };
    await importRows(extra);
    const replay = await write(owner, extra);
    assert.ok(replay.migration.rows.every(({ status }) => status === "Previously imported"));
    const current = await workspace(owner);
    const selected = current.inboxLeads.find(({ id: currentId }) => currentId === id);
    assert.equal(selected.officerEmail, officer.email);
    assert.deepEqual(new Set(current.inboxLeads.filter(({ campaignId: campaign }) => campaign === campaignId)
      .map(({ officerEmail }) => officerEmail)), new Set([officer.email, owner.email, null]));
    const automatic = current.inboxLeads.find(({ campaignId: campaign, officerEmail }) => campaign === campaignId && officerEmail === owner.email);
    await write(owner, { type: "recordCampaignCall", campaignId, leadId: automatic.id, revision: automatic.followUp.revision,
      outcome: "Left message", note: "Fictional voicemail for the configured retry time.", callbackAt: null });
    const retry = (await queue(owner)).items.find(({ recordId, kind }) => recordId === automatic.id && kind === "campaign");
    assert.ok(retry);
    const easternTime = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    assert.equal(easternTime.format(new Date(retry.dueAt)), "15:30");
    await write(owner, { type: "recordCampaignCall", campaignId, leadId: id, revision: selected.followUp.revision,
      outcome: "Requested callback", note: "Fictional borrower requested a follow-up.", callbackAt: campaignCallbackAt, simulateFollowUpFailure: true });
    const promised = await callbackPerformance();
    assert.equal(promised.counts.Upcoming, 1);
    assert.equal(promised.items[0].dueAt, campaignCallbackAt);
    assert.match(promised.items[0].request.text, /Fictional borrower requested a follow-up/);
    assert.equal(promised.items[0].attempt, null);
    assert.ok((await callbackPerformance(officer)).error);
    assert.ok(!(await queue(officer)).items.some(({ recordId, kind }) => recordId === id && kind === "campaign"));
    const managerQuery = { view: "owners", filters: { ...defaultManagerExceptionFilters, type: "Campaign recovery" } };
    const settings = await action(owner, "readManagerExceptions", { view: "settings" });
    assert.equal(settings.kind, "settings");
    assert.ok(settings.members.some(({ email }) => email === processor.email));
    assert.ok((await action(officer, "readManagerExceptions", managerQuery)).error);
    assert.ok((await action(owner, "readManagerExceptions", managerQuery, undefined, randomUUID())).error);
    const campaignExceptions = async () => {
      const page = await action(owner, "readManagerExceptions", managerQuery);
      assert.equal(page.kind, "owners", page.error);
      return page.rows;
    };
    const [exception] = await campaignExceptions();
    assert.equal(exception.item.recordId, id);
    assert.equal(exception.item.dueAt, campaignCallbackAt);
    assert.equal(exception.overdue, false);
    const preview = { type: "previewCampaignRecovery", runId: exception.item.id };
    assert.ok((await action(officer, "accessPlaybookRuns", preview)).error);
    const review = await action(owner, "accessPlaybookRuns", preview);
    assert.equal(review.ready.length, 1);
    const [candidate] = review.ready;
    assert.equal(candidate.ownerEmail, officer.email);
    assert.equal(candidate.dueAt, campaignCallbackAt);
    const batch = { type: "recoverCampaignFollowUps", operationId: randomUUID(), items: [
      { id: candidate.id, attempt: candidate.attempt, leadRevision: candidate.leadRevision, ownerEmail: candidate.ownerEmail },
    ] };
    const recovered = await action(owner, "accessPlaybookRuns", batch);
    assert.equal(recovered.recovered, 1);
    assert.deepEqual(await action(owner, "accessPlaybookRuns", batch), recovered);
    assert.deepEqual(await campaignExceptions(), []);
    const campaignState = await workspace(owner);
    const inbox = new Map(campaignState.inboxLeads.map((lead) => [lead.id, lead]));
    const records = campaignState.callCampaignMembers.filter((member) => member.campaignId === campaignId)
      .map((member) => ({ member, lead: inbox.get(member.leadId), optedOut: member.outreachSuppressed }));
    const callbackTime = Date.parse(campaignCallbackAt);
    const beforeCallback = campaignCallQueues(records, callbackTime - 1);
    assert.ok(beforeCallback.upcomingCallbacks.some(({ member }) => member.leadId === id));
    const whenDue = campaignCallQueues(records, callbackTime);
    assert.ok(whenDue.dueCallbacks.some(({ member }) => member.leadId === id));
    assert.ok(!whenDue.upcomingCallbacks.some(({ member }) => member.leadId === id));
    assert.equal(whenDue.firstCalls.length, 0);

    const shared = records.find(({ lead }) => lead?.officerEmail === null).lead;
    const callShared = { type: "recordCampaignCall", campaignId, leadId: shared.id, revision: shared.followUp.revision,
      outcome: "Connected", note: "Fictional shared queue call.", callbackAt: null };
    assert.match((await action(owner, "mutate", callShared)).error, /assign.*before logging/i);
    const contenders = [officer, competingOfficer];
    const views = await Promise.all(contenders.map((staff) => action(staff, "readInboxWork", { type: "list", view: "Unassigned" })));
    assert.ok(views.every(({ leads }) => leads.some(({ id, officerEmail }) => id === shared.id && officerEmail === null)));
    const claim = (staff) => ({ type: "assignInboxLead", leadId: shared.id, email: staff.email, previousEmail: null });
    const results = await Promise.all(contenders.map((staff) => action(staff, "mutate", claim(staff), "inbox")));
    assert.equal(results.filter(({ inboxChanged }) => inboxChanged).length, 1);
    const winnerIndex = results.findIndex(({ inboxChanged }) => inboxChanged);
    const winner = contenders[winnerIndex];
    const loser = contenders[1 - winnerIndex];
    assert.match(results[1 - winnerIndex].error, /already has an owner/i);
    assert.equal(results[winnerIndex].state, undefined);
    const { lead: claimed } = await action(winner, "readInboxWork", { type: "open", id: shared.id });
    assert.equal(claimed.officerEmail, winner.email);
    assert.equal(claimed.dueAt, shared.dueAt);
    assert.ok((await action(loser, "readInboxWork", { type: "open", id: shared.id })).error);
    assert.match((await action(loser, "mutate", callShared)).error, /outside your assigned work/i);
    const replayed = await write(winner, claim(winner));
    assert.equal(replayed.leadWork.lead.followUp.events.filter(({ text }) => text === `Assigned to ${winner.name}.`).length, 1);
    const logged = await write(winner, { ...callShared, revision: claimed.followUp.revision });
    assert.equal(logged.leadWork.member.attempts, 1);
    assert.equal(logged.leadWork.lead.officerEmail, winner.email);
    await write(winner, { type: "dismissReferral", referralId: shared.id, revision: logged.leadWork.lead.followUp.revision });

    const secondCampaignId = randomUUID();
    const secondCampaignName = "Fictional working-day callbacks";
    await write(owner, { type: "createCallCampaign", id: secondCampaignId, name: secondCampaignName });
    const discovery = { type: "openCampaigns", campaignId: secondCampaignId, loadIntake: true };
    const priorCampaigns = (await write(officer, discovery)).campaignNavigation;
    assert.ok(!priorCampaigns.campaigns.some(({ id }) => id === secondCampaignId));
    const secondBorrower = "Fictional Second Campaign Borrower";
    const secondRows = parseCampaignLeadCsv(`id,name,email,phone,purpose,zip\ncallback,${secondBorrower},second-campaign@example.test,248-555-0168,Purchase,48067`, dueAt);
    const second = await importRows({ type: "migratePipeline", origin: campaignOrigin(secondCampaignId), campaignId: secondCampaignId, decisions: {},
      rows: secondRows.map((row) => ({ ...row, ownerEmail: officer.email })) });
    const secondLeadId = second.rows[0].targetId;
    const discovered = (await write(officer, discovery)).campaignNavigation;
    assert.equal(discovered.queue.campaignId, secondCampaignId);
    assert.deepEqual(discovered.queue.inboxLeads.map(({ id }) => id), [secondLeadId]);
    assert.equal(discovered.intake, undefined);
    assert.match((await action(processor, "mutate", discovery)).error, /access/i);
    const secondLead = (await workspace(officer)).inboxLeads.find(({ id }) => id === secondLeadId);
    assert.equal(secondLead?.officerEmail, officer.email);
    const secondDue = Math.max(now + 9 * 86_400_000, Date.parse(retry.dueAt) + 60_000);
    const secondCallbackAt = new Date(secondDue).toISOString();
    await write(officer, { type: "recordCampaignCall", campaignId: secondCampaignId, leadId: secondLeadId, revision: secondLead.followUp.revision,
      outcome: "Requested callback", note: "Fictional callback in the second campaign.", callbackAt: secondCallbackAt });

    const [officerCallbacks, ownerCallbacks] = await Promise.all([upcomingCallbacks(officer), upcomingCallbacks(owner)]);
    const personal = officerCallbacks.items;
    assert.ok(Date.parse(officerCallbacks.checkedAt) < callbackTime);
    assert.equal(officerCallbacks.next, null);
    assert.deepEqual(personal.map(({ leadId, dueAt, campaignName, name, requested }) => [leadId, dueAt, campaignName, name, requested]), [
      [id, campaignCallbackAt, "Fictional migrated pipeline", imported.name, true],
      [secondLeadId, secondCallbackAt, secondCampaignName, secondBorrower, true],
    ]);
    assert.deepEqual(ownerCallbacks.items.map(({ leadId, taskId, requested }) => [leadId, taskId, requested]), [[automatic.id, retry.id, false]]);

    const secondTask = { leadId: secondLeadId, task: { kind: "campaign", id: personal[1].taskId } };
    const compactReplies = (staff) => action(staff, "readConversationWork", { type: "myReplies" });
    const simulated = await action(owner, "saveInboundReplyWork", { type: "simulate", channel: "Email", sourceId: "working-day-callback-reply",
      sender: "second-campaign@example.test", text: "Please keep our fictional scheduled call." });
    assert.ok(simulated.id, simulated.error);
    assert.ok(!(await compactReplies(officer)).page.items.some(({ leadId }) => leadId === secondLeadId));
    const receipt = await action(owner, "readInboundReplyWork", { type: "reply", id: simulated.id });
    const linked = await action(owner, "saveInboundReplyWork", { type: "attachLead", id: simulated.id, revision: receipt.reply.revision, leadId: secondLeadId });
    assert.ok(linked.conversationId, linked.error);
    const freshReply = (await compactReplies(officer)).page.items.find(({ id }) => id === linked.conversationId);
    assert.deepEqual(freshReply?.campaignCallback, { leadId: secondLeadId, taskId: secondTask.task.id, dueAt: secondCallbackAt });
    assert.ok(!(await compactReplies(competingOfficer)).page.items.some(({ id }) => id === linked.conversationId));
    assert.ok((await compactReplies(processor)).error);
    const openedReply = await action(officer, "readConversationWork", { type: "thread", id: linked.conversationId });
    assert.deepEqual(openedReply.thread.campaignCallback, freshReply.campaignCallback);
    assert.equal((await action(officer, "readLeadForWork", { ...secondTask, task: { ...secondTask.task, expectedCallbackAt: secondCallbackAt } })).member.callbackDueAt, secondCallbackAt);
    assert.ok((await action(officer, "readLeadForWork", { ...secondTask, task: { ...secondTask.task, expectedCallbackAt: campaignCallbackAt } })).error);
    const campaignRefresh = { type: "refreshCampaignQueue", campaignId: secondCampaignId };
    const initialQueue = await write(officer, campaignRefresh);
    assert.equal(initialQueue.state, undefined);
    assert.equal(initialQueue.campaignQueue.campaign.routing, undefined);
    assert.deepEqual(initialQueue.campaignQueue.members.map(({ leadId, callbackDueAt }) => [leadId, callbackDueAt]), [[secondLeadId, secondCallbackAt]]);
    assert.match((await action(processor, "mutate", campaignRefresh)).error, /access/i);
    const opened = await action(officer, "readLeadForWork", secondTask);
    assert.equal(opened.lead?.id, secondLeadId, opened.error);
    assert.equal(opened.member?.campaignId, secondCampaignId);
    assert.equal(opened.member?.callbackTaskId, personal[1].taskId);
    assert.equal(opened.member?.callbackDueAt, secondCallbackAt);
    assert.ok((await action(officer, "readLeadForWork", { ...secondTask, task: { kind: "campaign", id: personal[0].taskId } })).error);

    const reassignment = await action(owner, "mutate",
      { type: "assignInboxLead", leadId: secondLeadId, email: owner.email, previousEmail: officer.email }, "inbox");
    assert.equal(reassignment.inboxChanged, true, reassignment.error);
    assert.equal(reassignment.state, undefined);
    assert.equal((await write(officer, campaignRefresh)).campaignQueue.campaign, null);
    assert.equal((await write(owner, campaignRefresh)).campaignQueue.responses[0].currentAssignment.email, owner.email);
    const [officerRefreshed, ownerRefreshed] = await Promise.all([upcomingCallbacks(officer), upcomingCallbacks(owner)]);
    assert.deepEqual(officerRefreshed.items, [personal[0]]);
    assert.deepEqual(ownerRefreshed.items, [...ownerCallbacks.items, personal[1]]);
    assert.ok((await action(officer, "readLeadForWork", secondTask)).error);
    const reassigned = await action(owner, "readLeadForWork", secondTask);
    assert.equal(reassigned.lead?.officerEmail, owner.email, reassigned.error);
    assert.equal(reassigned.member?.callbackTaskId, personal[1].taskId);
    assert.equal(reassigned.member?.callbackDueAt, secondCallbackAt);

    const missedDeadline = new Date(Date.now() + 1_500).toISOString();
    await write(owner, { type: "rescheduleCampaignCallback", campaignId: secondCampaignId, leadId: secondLeadId,
      revision: reassigned.lead.followUp.revision, callbackAt: missedDeadline, reason: "Fictional borrower moved the callback earlier." });
    await delay(Math.max(0, Date.parse(missedDeadline) - Date.now() + 25));
    const callbackExceptions = (staff, filters = {}) => action(staff, "readCampaignCallbackExceptions", filters);
    const [missed] = (await callbackExceptions(owner)).items;
    assert.equal(missed.leadId, secondLeadId);
    assert.equal(missed.dueAt, missedDeadline);
    assert.match(missed.request.text, /Fictional callback in the second campaign/);
    assert.ok((await callbackExceptions(officer)).error);
    const exceptionWork = { leadId: secondLeadId, callbackPromiseId: missed.id };
    const managerWork = await action(owner, "readLeadForWork", exceptionWork);
    assert.equal(managerWork.member?.callbackTaskId, secondTask.task.id);
    await write(owner, { type: "rescheduleCampaignCallback", campaignId: secondCampaignId, leadId: secondLeadId,
      revision: managerWork.lead.followUp.revision, callbackAt: secondCallbackAt, reason: "Fictional callback moved after its promised deadline." });
    const [rescheduled] = (await callbackExceptions(owner, { campaignId: secondCampaignId, ownerEmail: owner.email })).items;
    assert.equal(rescheduled.id, missed.id);
    assert.equal(rescheduled.dueAt, missedDeadline);
    assert.equal(rescheduled.scheduledAt, secondCallbackAt);
    await write(owner, { type: "assignInboxLead", ...exceptionWork, email: officer.email, previousEmail: owner.email });
    assert.deepEqual((await callbackExceptions(owner, { ownerEmail: owner.email })).items, []);
    const [handedOff] = (await callbackExceptions(owner, { ownerEmail: officer.email })).items;
    assert.equal(handedOff.id, missed.id);
    assert.equal(handedOff.dueAt, missedDeadline);
    const callbackForNewOwner = await action(officer, "readLeadForWork", secondTask);
    assert.equal(callbackForNewOwner.lead?.officerEmail, officer.email, callbackForNewOwner.error);
    assert.equal(callbackForNewOwner.member?.callbackDueAt, secondCallbackAt);
    const converted = await write(officer, { type: "convertReferral", referralId: secondLeadId, contactId: null });
    const callbackLoanId = converted.referralLoanId;
    const loanTask = { loanId: callbackLoanId, taskId: secondTask.task.id, dueAt: secondCallbackAt };
    const [loanException] = (await callbackExceptions(owner, { campaignId: secondCampaignId, ownerEmail: officer.email })).items;
    assert.equal(loanException?.id, missed.id);
    assert.equal(loanException.dueAt, missedDeadline);
    assert.deepEqual(loanException.loanTask, loanTask);
    assert.equal((await file(owner, callbackLoanId)).tasks.find(({ id }) => id === loanTask.taskId).campaignCallback, "Pending");
    assert.ok((await action(owner, "readLeadForWork", exceptionWork)).error);
    const scheduledOnLoan = (await upcomingCallbacks(officer)).items.find(({ taskId }) => taskId === loanTask.taskId);
    assert.deepEqual(scheduledOnLoan, { ...personal[1], loanId: callbackLoanId });
    assert.ok(!(await upcomingCallbacks(owner)).items.some(({ taskId }) => taskId === loanTask.taskId));

    await team(owner, { type: "assign", loanId: callbackLoanId, previousEmail: officer.email, email: competingOfficer.email });
    assert.deepEqual((await callbackExceptions(owner, { ownerEmail: officer.email })).items, []);
    const [movedLoanException] = (await callbackExceptions(owner, { ownerEmail: competingOfficer.email })).items;
    assert.deepEqual(movedLoanException.loanTask, loanTask);
    assert.equal(movedLoanException.dueAt, missedDeadline);
    assert.ok(!(await queue(competingOfficer)).items.some(({ id }) => id === loanTask.taskId));
    assert.ok(!(await upcomingCallbacks(officer)).items.some(({ taskId }) => taskId === loanTask.taskId));
    assert.deepEqual((await upcomingCallbacks(competingOfficer)).items.find(({ taskId }) => taskId === loanTask.taskId), scheduledOnLoan);
    const taskBeforeMove = (await file(competingOfficer, callbackLoanId)).tasks.find(({ id }) => id === loanTask.taskId);
    const nextTime = new Date(secondDue + 86_400_000).toISOString();
    const reschedule = { type: "rescheduleCarriedCampaignCallback", ...loanTask, callbackAt: nextTime,
      revision: taskBeforeMove.campaignCallbackRevision, eventId: randomUUID(), reason: "Fictional borrower requested the following day." };
    assert.ok((await action(officer, "mutate", reschedule)).error);
    assert.ok((await action(processor, "mutate", reschedule)).error);
    const moved = await write(competingOfficer, reschedule);
    assert.equal(moved.loanWork.tasks.find(({ id }) => id === loanTask.taskId).dueAt, nextTime);
    await write(competingOfficer, reschedule);
    assert.equal((await upcomingCallbacks(competingOfficer)).items.find(({ taskId }) => taskId === loanTask.taskId).dueAt, nextTime);
    const [rescheduledException] = (await callbackExceptions(owner, { ownerEmail: competingOfficer.email })).items;
    assert.equal(rescheduledException.dueAt, missedDeadline);
    assert.equal(rescheduledException.loanTask.dueAt, nextTime);
    const outcome = { type: "recordCarriedCampaignCallback", ...loanTask, dueAt: nextTime, outcome: "Connected",
      note: "Fictional reassigned callback completed.", eventId: randomUUID() };
    for (const staff of [officer, processor]) assert.ok((await action(staff, "mutate", outcome)).error);
    const loggedCallback = await write(competingOfficer, outcome);
    assert.equal(loggedCallback.loanWork.tasks.find(({ id }) => id === loanTask.taskId).campaignCallback, "Recorded");
    await write(competingOfficer, outcome);
    assert.deepEqual((await callbackExceptions(owner)).items, []);
    assert.ok(!(await upcomingCallbacks(competingOfficer)).items.some(({ taskId }) => taskId === loanTask.taskId));
    const outcomeReport = await action(owner, "readCampaignCallbackPerformance", { campaignId: secondCampaignId });
    assert.equal(outcomeReport.counts.Late, 1);
    assert.equal(outcomeReport.items[0].dueAt, missedDeadline);
    assert.equal(outcomeReport.items[0].scheduledAt, nextTime);
    assert.equal(outcomeReport.items[0].attempt.id, outcome.eventId);
    const callbackHistory = await action(competingOfficer, "readHistoryPage", { record: "loan", id: callbackLoanId });
    assert.equal(callbackHistory.events.filter(({ id }) => id === outcome.eventId).length, 1);
    assert.equal(callbackHistory.events.filter(({ id }) => id === reschedule.eventId).length, 1);
    return id;
  });
  const { loanId, token, realtorToken } = await stage("Invited LO takes the callback and starts a prefilled 1003", async () => {
    const todayWork = await queue(officer);
    const callback = todayWork.items.find(({ kind, recordId }) => kind === "lead-task" && recordId === leadId);
    assert.ok(callback);
    assert.equal(callback.dueAt, dueAt);
    const recoveredCallbacks = todayWork.items.filter(({ kind, recordId }) => kind === "campaign" && recordId === leadId);
    assert.equal(recoveredCallbacks.length, 1);
    const [recovered] = recoveredCallbacks;
    assert.equal(recovered.dueAt, campaignCallbackAt);
    const campaignWork = await action(officer, "readLeadForWork", { leadId, task: { kind: recovered.kind, id: recovered.id } });
    assert.equal(campaignWork.member?.callbackTaskId, recovered.id);
    const work = await action(officer, "readLeadForWork", { leadId, task: { kind: callback.kind, id: callback.id } });
    assert.equal(work.lead.id, leadId, work.error);
    assert.equal(work.member?.campaignId, campaignId);
    await write(officer, { type: "recordCampaignCall", campaignId, leadId, revision: work.lead.followUp.revision,
      outcome: "Connected", note: "Fictional borrower is ready for the purchase application.", callbackAt: null });
    const fulfilled = await callbackPerformance();
    assert.equal(fulfilled.counts["On time"], 1);
    assert.equal(fulfilled.counts.Upcoming, 0);
    assert.equal(fulfilled.items[0].dueAt, campaignCallbackAt);
    assert.match(fulfilled.items[0].request.text, /Fictional borrower requested a follow-up/);
    assert.match(fulfilled.items[0].attempt.text, /ready for the purchase application/);
    assert.notEqual(fulfilled.items[0].request.id, fulfilled.items[0].attempt.id);
    await write(officer, { type: "completeLeadTask", leadId, taskId: callback.id, completed: true });
    const overflow = (await workspace(owner)).inboxLeads.filter(({ campaignId: campaign, officerEmail }) => campaign === campaignId && !officerEmail);
    assert.equal(overflow.length, 1);
    const conversion = { type: "convertReferral", referralId: leadId, contactId: null };
    const result = await write(officer, conversion);
    const loanId = result.referralLoanId;
    assert.match(result.message, /shared lead was routed/);
    const next = result.state.inboxLeads.find(({ id }) => id === overflow[0].id);
    assert.equal(next.officerEmail, officer.email);
    assert.equal(next.dueAt, overflow[0].dueAt);
    assert.equal((await queue(officer)).items.find(({ recordId }) => recordId === next.id)?.dueAt, next.dueAt);
    const replay = await write(officer, conversion);
    assert.equal(replay.referralLoanId, loanId);
    assert.equal(replay.state.inboxLeads.find(({ id }) => id === next.id).followUp.events.filter(({ text }) => text === `Assigned to ${officer.name}.`).length, 1);
    const current = await file(officer, loanId);
    assert.equal(current.loans[0].officerEmail, officer.email);
    const convertedQueue = (await write(officer, { type: "refreshCampaignQueue", campaignId })).campaignQueue;
    assert.ok(!convertedQueue.inboxLeads.some(({ id }) => id === leadId));
    assert.equal(convertedQueue.members.find((member) => member.leadId === leadId).loanId, loanId);
    assert.deepEqual(convertedQueue.files, [{ id: loanId, officer: officer.name, amount: current.loans[0].amount,
      stage: current.loans[0].stage, submittedAt: null, fundingDate: null }]);
    assert.equal(current.loans[0].leadSource, "Realtor referral");
    assert.ok(current.tasks.some(({ id, completedAt }) => id === callback.id && completedAt));
    const activity = await action(officer, "readHistoryPage", { record: "loan", id: loanId });
    assert.match(JSON.stringify(activity.events), /ready for the purchase application/);
    assert.match((await action(processor, "readLoanForWork", loanId)).error, /unavailable/i);
    const { partnerId } = current.loans[0];
    const created = await action(owner, "mutate", { type: "createRealtorPortal", realtorId: partnerId, officerEmail: officer.email }, "realtors");
    assert.equal(created.realtorChanged, true, created.error);
    assert.equal(created.state, undefined);
    const profile = { type: "profile", partnerId };
    const { portal } = await action(owner, "readRealtorWorkspace", profile);
    assert.equal(portal.realtorId, partnerId);
    assert.ok((await action(owner, "readRealtorWorkspace", profile, undefined, randomUUID())).error);
    assert.ok((await action(officer, "readRealtorWorkspace", profile)).error);
    assert.ok((await action(processor, "readRealtorWorkspace", profile)).error);
    const importedLead = { type: "result", origin: "working-day", key: "Lead:referral", targetId: leadId };
    assert.deepEqual((await action(owner, "openMigrationRecord", importedLead)).destination, { kind: "loan", id: loanId, target: "loan-application" });
    return { loanId, token: current.applications[0].token, realtorToken: portal.token };
  });

  await stage("Borrower saves and submits, LO reviews and prices", async () => {
    const initial = await borrower(token, { type: "read" });
    assert.equal(initial.draft.borrowerName, imported.name);
    assert.equal(initial.draft.email, imported.email);
    assert.equal(initial.draft.phone, imported.phone);
    assert.equal(initial.draft.propertyLocation.zip, "48067");
    const sample = { ...sampleApplication(initial.draft), confirmedDemo: true };
    const step = applicationSteps.length - 1;
    const saved = await borrower(token, { type: "save", revision: initial.revision, step, draft: sample });
    const resumed = await borrower(token, { type: "read" });
    assert.equal(resumed.revision, saved.revision);
    assert.deepEqual(resumed.draft, saved.draft);
    const first = { type: "submit", revision: resumed.revision, step, draft: resumed.draft };
    const second = { ...first, draft: { ...first.draft, loanAmount: String(Number(first.draft.loanAmount) - 1_000) } };
    const handoffVersion = (await file(officer, loanId)).handoffVersion;
    assert.deepEqual(await action(officer, "checkLoanHandoff", loanId, handoffVersion), { unchanged: true });
    assert.ok((await action(competingOfficer, "checkLoanHandoff", loanId, handoffVersion)).error);
    assert.ok((await action(officer, "checkLoanHandoff", loanId, handoffVersion, randomUUID())).error);
    const attempts = [first, second];
    const responses = await Promise.all(attempts.map((input) => postResponse("/api/demo-application", { token, ...input })));
    assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
    const accepted = responses.findIndex(({ status }) => status === 200);
    const submitted = responses[accepted].result;
    assert.ok(submitted.submittedAt);
    const handoff = await action(officer, "checkLoanHandoff", loanId, handoffVersion);
    assert.equal(handoff.applications[0].submittedAt, submitted.submittedAt);
    assert.deepEqual(await action(officer, "checkLoanHandoff", loanId, handoff.handoffVersion), { unchanged: true });
    const waitingReview = (await incoming(officer, "today")).items.find((item) => item.kind === "application" && item.loanId === loanId);
    assert.equal(waitingReview?.revision, submitted.revision);
    assert.ok(!(await incoming(competingOfficer, "today")).items.some((item) => item.loanId === loanId));
    assert.ok((await incoming(processor, "today")).error);
    assert.equal(submitted.draft.loanAmount, attempts[accepted].draft.loanAmount);
    assert.ok((await queue(officer)).items.some(({ recordId, title }) => recordId === loanId && /1003/.test(title)));
    const updated = await action(owner, "mutate", { ...defaultPlaybook, type: "savePlaybook", ...checkpointPolicy }, "tasks");
    assert.equal(updated.playbookSettings.revision, 1);
    assert.equal(updated.state, undefined);
    const firstReview = await loanAction(officer, loanId, "reviewApplication", { revision: submitted.revision });
    assert.match(firstReview.message, /second review was assigned/i);
    assert.ok(!(await incoming(officer, "today")).items.some((item) => item.kind === "application" && item.loanId === loanId));
    const review = (staff, input) => action(staff, "workOnLoanReview", { loanId, ...input });
    const [assigned] = (await review(owner, { type: "loan" })).reviews;
    const reviewDueOn = shiftReportDate(today, 2);
    assert.equal(assigned.dueOn, reviewDueOn);
    assert.equal(assigned.reviewerName, owner.name);
    assert.equal(assigned.requesterName, officer.name);
    assert.ok((await queue(owner)).items.some(({ id }) => id === assigned.id));
    const pendingApprovals = () => action(owner, "readManagerFileExceptions", { filter: "Required 1003 approvals" });
    const [pending] = (await pendingApprovals()).items;
    assert.equal(pending.status, "Awaiting approval");
    assert.equal(pending.target, reviewTarget(assigned.id));
    assert.equal(pending.owner, owner.name);
    assert.equal(pending.dueOn, reviewDueOn);
    const blockedSend = await action(officer, "mutate", { type: "sendApplication", loanId, revision: submitted.revision });
    assert.match(blockedSend.error, /approved second review/i);
    const beforeApproval = await file(officer, loanId);
    assert.equal(beforeApproval.applications[0].secondReviewApproved, false);
    assert.equal(beforeApproval.submissions.length, 0);
    const replay = await borrower(token, attempts[accepted]);
    assert.equal(replay.revision, submitted.revision);
    assert.equal(replay.submittedAt, submitted.submittedAt);
    assert.equal(replay.loanStatus.reviewed, true);
    const correctionNote = "Confirm the fictional requested loan amount.";
    await loanAction(officer, loanId, "requestApplicationCorrection", { revision: submitted.revision, note: correctionNote });
    const transition = await borrower(token, { type: "status" });
    assert.equal(transition.kind, "resume");
    assert.ok(!("draft" in transition) && !("loanStatus" in transition));
    const correction = await borrower(token, { type: "read" });
    assert.deepEqual((await pendingApprovals()).items, []);
    assert.equal(correction.correctionNote, correctionNote);
    assert.equal(correction.draft.loanAmount, submitted.draft.loanAmount);
    const corrected = await borrower(token, { type: "submit", revision: correction.revision, step,
      draft: { ...correction.draft, loanAmount: String(Number(correction.draft.loanAmount) - 500), confirmedDemo: true } });
    await loanAction(officer, loanId, "reviewApplication", { revision: corrected.revision });
    const detail = { type: "detail", id: assigned.id };
    const staleReview = (await review(owner, detail)).review;
    assert.equal(staleReview.evidenceChanged, true);
    assert.equal(staleReview.canDecide, false);
    const [resubmission] = (await pendingApprovals()).items;
    assert.equal(resubmission.status, "Resubmission needed");
    assert.equal(resubmission.owner, officer.name);
    assert.equal(resubmission.evidence, `Submitted 1003 revision ${corrected.revision}`);
    assert.deepEqual((await review(owner, { type: "loan" })).reviews.map(({ id }) => id), [assigned.id]);
    assert.equal((await review(officer, { type: "resubmit", id: assigned.id, revision: staleReview.revision, eventId: randomUUID(),
      dueOn: reviewDueOn, note: "Review the corrected fictional 1003." })).kind, "saved");
    const unassigned = { view: "owners", filters: { ...defaultManagerExceptionFilters, type: "Unassigned" } };
    const assignment = (await action(owner, "readManagerExceptions", unassigned)).rows.find(({ item }) => item.recordId === loanId && item.kind === "assign");
    assert.ok(assignment);
    assert.equal(assignment.otherOwner, officer.email);
    const request = { view: "loan-assignment", loanId };
    const readAssignment = async () => {
      const response = await readTeam(owner, request);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control"), /no-store/);
      return response.json();
    };
    const scoped = await readAssignment();
    assert.equal(scoped.loan.id, loanId);
    assert.equal(scoped.loan.officerEmail, officer.email);
    assert.ok(scoped.members.some(({ email }) => email === processor.email));
    assert.equal(scoped.applications, undefined);
    assert.equal((await readTeam(officer, request)).status, 403);
    assert.equal((await readTeam(processor, { view: "assignment-loans" })).status, 403);
    assert.equal((await readTeam(owner, request, randomUUID())).status, 403);
    await team(owner, { type: "assignProcessor", email: processor.email, loanId, revision: scoped.processing?.revision ?? 0 });
    assert.equal((await readAssignment()).processing.processorEmail, processor.email);
    assert.ok(!(await action(owner, "readManagerExceptions", unassigned)).rows.some(({ item }) => item.id === assignment.item.id));
    const history = (await (await readTeam(owner)).json()).history;
    assert.ok(history.some((event) => event.subject === loanId && event.loanName === imported.name && event.action === "Assigned shared processor"));
    const blockedHandoff = await action(officer, "mutate", { type: "updateProcessing", action: "Send to processing", loanId, revision: 1, note: "" });
    assert.match(blockedHandoff.error, /approved second review/i);
    const letterPath = `/api/preapproval-letters?brokerage=${brokerage}`;
    const letterRead = { type: "read", loanId };
    assert.match((await post(letterPath, letterRead, officer)).page.issue.blocked, /approved second review/i);
    assert.equal((await file(processor, loanId)).loanProcessing[0].status, "Assigned");
    const refreshedReview = (await review(owner, detail)).review;
    assert.equal(refreshedReview.applicationRevision, corrected.revision);
    assert.equal((await review(owner, { type: "decide", id: assigned.id, revision: refreshedReview.revision, eventId: randomUUID(),
      decision: "Approved", note: "Verified the corrected fictional revision." })).kind, "saved");
    assert.equal((await file(officer, loanId)).applications[0].secondReviewApproved, true);
    assert.deepEqual((await pendingApprovals()).items, []);
    const available = (await post(letterPath, letterRead, officer)).page.issue;
    assert.equal(available.applicationRevision, corrected.revision);
    const issueLetter = { type: "issue", loanId, applicationRevision: corrected.revision, previousVersion: 0, requestId: randomUUID(),
      amountCents: available.amountCents, expiresOn: available.suggestedExpiry, scope: "Property search", confirmed: true };
    assert.equal((await postResponse(letterPath, issueLetter, competingOfficer)).status, 409);
    assert.equal((await postResponse(letterPath, letterRead, processor)).status, 409);
    assert.equal((await post(letterPath, issueLetter, officer)).issuedVersion, 1);
    assert.equal((await post(letterPath, issueLetter, officer)).issuedVersion, 1);
    const downloadFirst = { type: "download", loanId, version: 1 };
    const firstLetter = await post(letterPath, downloadFirst, officer);
    assert.match(firstLetter.pdf, /^%PDF-1\.4/);
    assert.equal((await postResponse(letterPath, downloadFirst, competingOfficer)).status, 409);
    const borrowerLetter = async () => (await borrower(token, { type: "status" })).loanStatus.preapproval;
    const realtorLetter = async () => (await realtor(realtorToken)).referrals.find(({ borrowerName }) => borrowerName === imported.name)?.preapproval;
    assert.equal(await borrowerLetter(), undefined);
    assert.equal(await realtorLetter(), undefined);
    const audiences = (await post(letterPath, letterRead, officer)).page.sharing.audiences;
    const publishLetter = (audience) => ({ type: "publish", loanId, version: 1, audience, grantId: randomUUID(),
      previousGrantId: null, recipientStamp: audiences.find((item) => item.audience === audience).recipient.stamp, confirmed: true });
    const borrowerGrant = publishLetter("Borrower");
    const realtorGrant = publishLetter("Realtor");
    assert.equal((await postResponse(letterPath, realtorGrant, competingOfficer)).status, 409);
    assert.ok((await post(letterPath, borrowerGrant, officer)).shareMessage);
    assert.ok((await post(letterPath, realtorGrant, officer)).shareMessage);
    assert.equal((await borrowerLetter()).grantId, borrowerGrant.grantId);
    assert.equal((await realtorLetter()).grantId, realtorGrant.grantId);
    const sharedPath = "/api/shared-preapproval";
    const borrowerDownload = { token, audience: "Borrower", grantId: borrowerGrant.grantId };
    const realtorDownload = { token: realtorToken, audience: "Realtor", grantId: realtorGrant.grantId };
    assert.equal((await postResponse(sharedPath, { ...realtorDownload, token })).status, 404);
    assert.deepEqual(await post(sharedPath, borrowerDownload), firstLetter);
    assert.deepEqual(await post(sharedPath, realtorDownload), firstLetter);
    assert.ok((await post(letterPath, { type: "withdraw", loanId, version: 1, audience: "Realtor", grantId: realtorGrant.grantId }, officer)).shareMessage);
    assert.equal(await realtorLetter(), undefined);
    assert.equal((await postResponse(sharedPath, realtorDownload)).status, 404);
    assert.deepEqual(await post(sharedPath, borrowerDownload), firstLetter);
    assert.equal((await post(letterPath, { ...issueLetter, requestId: randomUUID(), previousVersion: 1,
      amountCents: issueLetter.amountCents - 100 }, officer)).issuedVersion, 2);
    assert.equal(await borrowerLetter(), undefined);
    assert.equal((await postResponse(sharedPath, borrowerDownload)).status, 404);
    assert.deepEqual(await post(letterPath, downloadFirst, officer), firstLetter);
    assert.deepEqual((await post(letterPath, letterRead, owner)).page.letters.map(({ status }) => status), ["Current", "Superseded"]);
    const letterHistory = await action(officer, "readHistoryPage", { record: "loan", id: loanId });
    assert.equal(letterHistory.events.filter(({ text }) => text.startsWith("Issued fictional preapproval letter")).length, 2);
    await loanAction(officer, loanId, "runMockCredit", { attemptId: randomUUID(), previousId: null, authorized: true, scenario: "ready" });
    const pricedFile = await file(officer, loanId);
    const report = pricedFile.mockCreditAusRuns.find(({ service }) => service === "Credit");
    assert.equal(report.result.status, "Report ready");
    assert.equal(report.authorization.recordedBy, officer.email);
    const duId = randomUUID();
    await loanAction(officer, loanId, "runMockAus", { attemptId: duId, previousId: null,
      method: "DU", creditId: report.id, scenario: "eligible" });
    const pair = { type: "runMockPairedAus", loanId, batchId: randomUUID(), creditId: report.id, applicationRevision: corrected.revision, orders: {
      DU: { attemptId: randomUUID(), previousId: duId, scenario: "review" },
      LPA: { attemptId: randomUUID(), previousId: null, scenario: "failure" },
    } };
    const paired = await write(officer, pair);
    const du = paired.loanWork.mockCreditAusRuns.find(({ id }) => id === pair.orders.DU.attemptId);
    const lpa = paired.loanWork.mockCreditAusRuns.find(({ id }) => id === pair.orders.LPA.attemptId);
    assert.equal(du.result.recommendation, "Review required");
    assert.equal(lpa.result.status, "Failed");
    assert.equal(du.creditId, lpa.creditId);
    assert.equal(du.batchId, lpa.batchId);
    assert.match((await write(officer, pair)).message, /already/i);
    const retryId = randomUUID();
    const retry = await loanAction(officer, loanId, "retryMockCreditAus", { service: "LPA", attemptId: retryId,
      previousId: lpa.id, applicationRevision: corrected.revision });
    const latestAus = retry.loanWork.mockCreditAusRuns;
    assert.deepEqual(latestAus.find(({ service }) => service === "DU"), du);
    assert.equal(latestAus[0].id, retryId);
    assert.equal(latestAus[0].retryOf, lpa.id);
    assert.equal(latestAus[0].batchId, pair.batchId);
    assert.equal(latestAus[0].result.status, "Findings ready");
    const draft = pricedFile.applications[0].draft;
    const priced = await loanAction(officer, loanId, "runPricing", { applicationRevision: corrected.revision, scenario: {
      purpose: draft.purpose, loanAmount: Number(draft.loanAmount), propertyValue: Number(draft.estimatedValue), purchasePrice: null,
      zip: draft.propertyLocation.zip.slice(0, 5), creditScore: report.result.score, monthlyIncome: Number(draft.monthlyIncome),
      occupancy: draft.occupancy, propertyType: "Single family", firstTimeBuyer: false,
    } });
    const run = priced.state.pricingRuns.find((quote) => quote.loanId === loanId);
    assert.equal(run.mode, "mock");
    const offer = run.offers[0];
    const scenarioPath = `/api/loan-scenarios?brokerage=${brokerage}`;
    const plan = sampleScenarioPlan(Math.round(run.scenario.loanAmount * 100), run.scenario.purpose);
    const recommended = pricingScenarioOption(run, offer, undefined, "Recommended mock quote");
    const recommendation = "Fictional recommendation for the borrower’s expected time in the home.";
    const scenarios = { type: "save", loanId, revision: 0, applicationRevision: corrected.revision, plan: {
      ...plan, propertyValue: Math.round((run.scenario.purchasePrice ?? run.scenario.propertyValue) * 100),
      options: [plan.options[0], recommended], recommendedId: recommended.id, recommendation,
    } };
    assert.equal((await postResponse(scenarioPath, scenarios, competingOfficer)).status, 409);
    const invalidSource = { ...scenarios, plan: { ...scenarios.plan,
      options: [plan.options[0], { ...recommended, quoteSource: { ...recommended.quoteSource, runId: randomUUID() } }] } };
    assert.match((await postResponse(scenarioPath, invalidSource, officer)).result.error, /pricing source/i);
    const alteredTerms = { ...scenarios, plan: { ...scenarios.plan, options: [plan.options[0], { ...recommended, rate: recommended.rate + 0.125 }] } };
    assert.match((await postResponse(scenarioPath, alteredTerms, officer)).result.error, /option terms changed/i);
    const savedPlan = await post(scenarioPath, scenarios, officer);
    const reopenedPlan = await post(scenarioPath, { type: "read", loanId }, officer);
    assert.deepEqual(reopenedPlan.record, savedPlan.record);
    assert.equal(reopenedPlan.record.plan.recommendedId, recommended.id);
    assert.deepEqual(reopenedPlan.record.plan.options[1].quoteSource, { runId: run.id, offerId: offer.id });
    const reprice = await loanAction(officer, loanId, "runPricing", { applicationRevision: corrected.revision,
      scenario: { ...run.scenario, creditScore: 725 } });
    assert.notEqual(reprice.state.pricingRuns[0].id, run.id);
    assert.equal(reprice.state.pricingRuns.find((item) => item.id === run.id).selectedId, null);
    await loanAction(officer, loanId, "selectOffer", { runId: run.id, offerId: offer.id });
    await loanAction(officer, loanId, "publishQuote", { runId: run.id, offerId: offer.id });
    const status = await borrower(token, { type: "status" });
    assert.equal(status.kind, "status");
    assert.equal(status.loanStatus.quote.rate, offer.rate);
    assert.equal(status.loanStatus.quote.presentation.primary.offerId, offer.id);
    assert.ok(!JSON.stringify(status).includes(recommendation));
    assert.ok(!JSON.stringify(status).includes("preapproval"));
    assert.ok(!("draft" in status));
    assert.match((await action(officer, "mutate", { type: "sendApplication", loanId, revision: corrected.revision,
      quote: { runId: run.id, offerId: run.offers[1].id } })).error, /saved mock quote changed/i);
    await loanAction(officer, loanId, "sendApplication", { revision: corrected.revision, quote: { runId: run.id, offerId: offer.id } });
    const handedOff = await file(officer, loanId);
    assert.ok(handedOff.applications[0].versions.find((version) => version.revision === corrected.revision).uwmReceipt);
  });

  const processing = async (staff, actionName, note = "") => {
    const work = await file(staff, loanId);
    return loanAction(staff, loanId, "updateProcessing", { action: actionName, revision: work.loanProcessing[0].revision, note });
  };
  await stage("LO sends the approved file to the assigned processor", async () => {
    const submitted = await file(officer, loanId);
    assert.ok(submitted.uwmAlerts.some(({ loanId: id }) => id === loanId));
    const offered = await measureHandoff("LO to processor", () => loanAction(officer, loanId, "updateProcessing", {
      action: "Send to processing", revision: submitted.loanProcessing[0].revision, note: "Review the mock lender evidence.",
    }), processor, "processing", loanId);
    const ready = await action(processor, "readProcessingWork", { readyOnly: true });
    assert.ok(ready.files.some(({ id, status }) => id === loanId && status === "Ready for processing"));
    const active = await file(officer, loanId);
    assert.equal(offered?.note, "Review the mock lender evidence.");
    assert.equal(offered?.revision, active.loanProcessing[0].revision);
    assert.equal(active.loans[0].officerEmail, officer.email, "The original LO stays on the file");
  });

  await stage("Processor clears two mock conditions and returns the file", async () => {
    await processing(processor, "Accept handoff");
    assert.ok(!(await incoming(processor, "processing")).items.some(({ kind, id }) => kind === "handoff" && id === loanId));
    const current = await file(processor, loanId);
    const submission = current.submissions.find(({ lender }) => lender === "UWM");
    const conditionIds = submission.conditions.filter(({ satisfiedAt }) => !satisfiedAt).map(({ id }) => id);
    assert.equal(conditionIds.length, 2);
    await loanAction(processor, loanId, "requestSuggestedUwmDocuments", { submissionId: submission.id, conditionIds });
    const requested = (await file(processor, loanId)).documentRequests;
    assert.equal(requested.length, 2);
    const [firstRequest, secondRequest] = requested;
    const saveTiming = (revision, documentReminderOffsetDays) => write(owner,
      { ...defaultPlaybook, type: "savePlaybook", revision, documentReminderOffsetDays, ...checkpointPolicy });
    await saveTiming(1, -2);
    const firstDeadline = shiftReportDate(today, 2);
    await loanAction(processor, loanId, "setDocumentDeadline", { requestId: firstRequest.id, revision: firstRequest.revision,
      deadlineRevision: firstRequest.deadlineRevision, dueOn: firstDeadline });
    const reminderCheck = { type: "checkDocuments", operationId: randomUUID(), simulate: true };
    assert.ok((await action(processor, "accessPlaybookRuns", reminderCheck)).error);
    const reminderResult = await action(owner, "accessPlaybookRuns", reminderCheck);
    assert.equal(reminderResult.interrupted, 1);
    assert.deepEqual(await action(owner, "accessPlaybookRuns", reminderCheck), reminderResult);
    const reminderRuns = (filter) => action(owner, "accessPlaybookRuns", { type: "list", filter, automation: "Document reminders" });
    const [reminder] = (await reminderRuns("Failed")).runs;
    assert.equal(reminder.requestId, firstRequest.id);
    assert.equal(reminder.eligibleOn, today);
    assert.equal(reminder.timingOffsetDays, -2);
    await saveTiming(2, 2);
    await loanAction(processor, loanId, "setDocumentDeadline", { requestId: secondRequest.id, revision: secondRequest.revision,
      deadlineRevision: secondRequest.deadlineRevision, dueOn: shiftReportDate(today, -2) });
    assert.equal((await action(owner, "accessPlaybookRuns", { ...reminderCheck, operationId: randomUUID() })).interrupted, 1);
    const recoveryPreview = { type: "previewDocumentRecovery" };
    assert.ok((await action(processor, "accessPlaybookRuns", recoveryPreview)).error);
    const preview = await action(owner, "accessPlaybookRuns", recoveryPreview);
    assert.deepEqual(preview.ready.map(({ requestId }) => requestId).sort(), [firstRequest.id, secondRequest.id].sort());
    assert.ok(preview.ready.every(({ eligibleOn }) => eligibleOn === today));
    const pendingHandoff = await file(processor, loanId);
    await borrower(token, { type: "attachSample", statusOnly: true, requestId: secondRequest.id, revision: secondRequest.revision });
    const receivedHandoff = await action(processor, "checkLoanHandoff", loanId, pendingHandoff.handoffVersion);
    assert.equal(receivedHandoff.documentRequests.find(({ id }) => id === secondRequest.id).status, "Received");
    assert.deepEqual(await action(processor, "checkLoanHandoff", loanId, receivedHandoff.handoffVersion), { unchanged: true });
    const incomingDocument = (await incoming(processor, "processing")).items.find(({ id }) => id === secondRequest.id);
    assert.equal(incomingDocument?.revision, secondRequest.revision + 1);
    assert.equal(incomingDocument?.linkedCondition, true);
    assert.ok((await incoming(officer, "today")).items.some(({ id }) => id === secondRequest.id));
    const batch = { type: "recoverDocuments", operationId: randomUUID(), items: preview.ready.map(({ id, attempt }) => ({ id, attempt })) };
    const recovered = await action(owner, "accessPlaybookRuns", batch);
    assert.equal(recovered.recovered, 1);
    assert.equal(recovered.skipped, 1);
    assert.equal(recovered.rows.find(({ id }) => id === reminder.id).status, "Recovered");
    assert.deepEqual(await action(owner, "accessPlaybookRuns", batch), recovered);
    const [mockDelivery] = (await reminderRuns("Completed")).runs;
    assert.equal(mockDelivery.dueOn, firstDeadline);
    assert.equal(mockDelivery.eligibleOn, today);
    assert.equal(mockDelivery.timingOffsetDays, -2);
    assert.equal(mockDelivery.attemptCount, 2);
    assert.match(mockDelivery.receipt, /^MOCK-DOC-/);
    const scheduledDeadline = shiftReportDate(today, -2);
    await loanAction(processor, loanId, "setDocumentDeadline", { requestId: firstRequest.id, revision: firstRequest.revision,
      deadlineRevision: mockDelivery.deadlineRevision, dueOn: scheduledDeadline });
    const scheduleQuery = { type: "documentSchedule" };
    const scheduleWork = (input) => action(owner, "accessPlaybookRuns", input);
    assert.equal((await scheduleWork(scheduleQuery)).enabled, false);
    const enabled = await scheduleWork({ type: "setDocumentSchedule", enabled: true, revision: 0 });
    assert.equal(enabled.enabled, true);
    await workspaces.getByName(brokerage).missReminderAlarm();
    await scheduleWork(scheduleQuery);
    let delivered;
    for (let attempt = 0; attempt < 40 && !delivered; attempt++) {
      delivered = (await reminderRuns("Completed")).runs.find(({ dueOn, requestId }) => dueOn === scheduledDeadline && requestId === firstRequest.id);
      if (!delivered) await delay(50);
    }
    assert.match(delivered?.receipt, /^MOCK-DOC-/);
    const attempts = await scheduleWork({ type: "attempts", id: delivered.id, source: "document" });
    assert.deepEqual(attempts.attempts.map(({ actor }) => actor), ["Scheduled mock check"]);
    assert.equal((await scheduleWork(scheduleQuery)).lastProcessed, 1);
    assert.equal((await scheduleWork({ ...reminderCheck, operationId: randomUUID() })).processed, 0);
    const paused = await scheduleWork({ type: "setDocumentSchedule", enabled: false, revision: enabled.revision });
    assert.equal(paused.nextAt, null);
    assert.equal(paused.lastProcessed, 1);
    const attach = { type: "attachSample", statusOnly: true, requestId: firstRequest.id, revision: firstRequest.revision };
    const [receipt, replay, workingFile, readingPartner] = await Promise.all([
      borrower(token, attach), borrower(token, attach), file(processor, loanId), realtor(realtorToken),
    ]);
    for (const result of [receipt, replay]) {
      assert.equal(result.kind, "status");
      assert.ok(!("draft" in result));
      const attached = result.loanStatus.documents.find(({ id }) => id === firstRequest.id);
      assert.equal(attached.status, "Received");
      assert.equal(attached.revision, firstRequest.revision + 1);
    }
    assert.ok(workingFile.documentRequests.some(({ id }) => id === firstRequest.id));
    assert.ok(readingPartner.referrals.some(({ borrowerName }) => borrowerName === imported.name));
    assert.doesNotMatch(JSON.stringify(readingPartner), /Sample document received|Review the mock lender evidence|Pay stub|MOCK-DOC-/);
    const stale = await action(processor, "mutate", { type: "reviewDocument", loanId, requestId: firstRequest.id,
      revision: firstRequest.revision, decision: "Accepted", replacementNote: "", sendToMockUwm: true });
    assert.match(stale.error, /changed|refresh/i);
    const received = (await file(processor, loanId)).documentRequests;
    const guideFile = await file(officer, loanId);
    assert.ok(guideFile.submissions.some(({ id }) => id === submission.id));
    assert.deepEqual(guideFile.documentRequests.map(({ id, status, revision }) => ({ id, status, revision })),
      received.map(({ id, status, revision }) => ({ id, status, revision })));
    assert.ok((await action(competingOfficer, "readLoanForWork", loanId)).error);
    for (const request of received) {
      assert.equal(request.status, "Received");
      await loanAction(processor, loanId, "reviewDocument", { requestId: request.id, revision: request.revision,
        decision: "Accepted", replacementNote: "", sendToMockUwm: true });
    }
    await loanAction(processor, loanId, "refreshMockUwmClearance", { submissionId: submission.id });
    const cleared = await file(processor, loanId);
    assert.ok(cleared.submissions[0].conditions.every(({ satisfiedAt }) => satisfiedAt));
    assert.ok(cleared.documentRequests.every(({ status, uwmReceipt }) => status === "Accepted" && uwmReceipt));
    assert.ok(cleared.communicationDrafts.some(({ audience, milestone }) => audience === "Realtor" && milestone === "Lender review complete"));
    const returnedWork = await measureHandoff("Processor to LO", () => loanAction(processor, loanId, "updateProcessing", {
      action: "Return to LO", revision: cleared.loanProcessing[0].revision, note: "Internal note: mock lender evidence cleared.",
    }), officer, "today", loanId);
    const returned = (await queue(officer)).items.find(({ kind, recordId }) => kind === "handoff" && recordId === loanId);
    assert.equal(returned?.target, "processing-handoff");
    assert.equal(returnedWork?.note, "Internal note: mock lender evidence cleared.");
    assert.equal(returnedWork?.revision, (await file(officer, loanId)).loanProcessing[0].revision);
    assert.ok(!(await incoming(competingOfficer, "today")).items.some(({ id }) => id === loanId));
    assert.doesNotMatch(JSON.stringify(await borrower(token, { type: "status" })), /Internal note/);
    const partner = await realtor(realtorToken);
    assert.ok(partner.referrals.some(({ borrowerName, stage }) => borrowerName === imported.name && stage === cleared.loans[0].stage));
    assert.doesNotMatch(JSON.stringify(partner), /Internal note/);
  });

  const repeatFile = await stage("LO closes, funds, and opens the repeat application", async () => {
    const markClosing = { type: "markClearToClose", loanId };
    assert.match((await action(officer, "mutate", markClosing)).error, /no longer ready/i);
    assert.match((await action(processor, "mutate", markClosing)).error, /access/i);
    await processing(officer, "Complete handoff");
    assert.ok(!(await incoming(officer, "today")).items.some(({ kind, id }) => kind === "handoff" && id === loanId));
    const ready = await file(officer, loanId);
    assert.equal(loanNextAction(ready.loans[0], { ...ready, playbook: defaultPlaybook }, officer.role).title, "Review closing readiness");
    const submission = ready.submissions[0];
    const condition = submission.conditions.find(({ category }) => category === "Income");
    await loanAction(owner, loanId, "reopenMockUwmCondition", { submissionId: submission.id, conditionId: condition.id,
      expectedSatisfiedAt: condition.satisfiedAt, expectedReopenedAt: condition.mockReopenedAt ?? null });
    assert.match((await action(officer, "mutate", markClosing)).error, /no longer ready/i);
    const reopened = await file(officer, loanId);
    assert.equal(closingReviewReady(reopened.loans[0], reopened), false);
    assert.ok(!reopened.communicationDrafts.some(({ milestone }) => milestone === "Clear to Close"));
    const request = reopened.documentRequests.find(({ conditionId }) => conditionId === condition.id);
    await borrower(token, { type: "attachSample", requestId: request.id, revision: request.revision });
    const replacement = (await file(officer, loanId)).documentRequests.find(({ id }) => id === request.id);
    await loanAction(officer, loanId, "reviewDocument", { requestId: replacement.id, revision: replacement.revision,
      decision: "Accepted", replacementNote: "", sendToMockUwm: true });
    await loanAction(officer, loanId, "refreshMockUwmClearance", { submissionId: submission.id });
    const marked = await write(officer, markClosing);
    assert.equal(marked.loanWork.loans[0].stage, "Clear to Close");
    await write(officer, markClosing);
    const closingReady = await file(officer, loanId);
    assert.equal(closingReady.loans[0].stageSince, marked.loanWork.loans[0].stageSince);
    assert.equal(closingReady.communicationDrafts.filter(({ milestone, audience }) => milestone === "Clear to Close" && audience === "Realtor").length, 1);
    assert.ok((await realtor(realtorToken)).referrals.some(({ borrowerName, stage }) => borrowerName === imported.name && stage === "Clear to Close"));
    const itemId = randomUUID();
    await loanAction(officer, loanId, "saveClosingItem", { itemId, revision: 0, title: "Confirm fictional signing package", owner: officer.name, dueDate: today });
    const closingItem = (await file(officer, loanId)).closingItems.find(({ id }) => id === itemId);
    await loanAction(officer, loanId, "completeClosingItem", { itemId, revision: closingItem.revision, completed: true });
    await loanAction(officer, loanId, "recordClosing", { revision: 0, closingDate: today });
    await loanAction(officer, loanId, "recordFunding", { revision: 0, fundingDate: today });
    const funded = await file(officer, loanId);
    assert.equal(funded.loans[0].officerEmail, officer.email);
    assert.equal(funded.loans[0].stage, "Funded");
    const fundedQueue = (await write(officer, { type: "refreshCampaignQueue", campaignId })).campaignQueue;
    const fundedCard = fundedQueue.files.find(({ id }) => id === loanId);
    assert.equal(fundedCard.fundingDate, today);
    assert.equal(fundedCard.submittedAt, funded.applications[0].versions.at(-1)?.submittedAt ?? funded.applications[0].submittedAt);
    const filters = { from: "", through: "", officer: officer.email, source: "Realtor referral" };
    const partnerId = funded.loans[0].partnerId;
    const directory = await action(owner, "readRealtorWorkspace", { type: "directory", search: "", filters });
    const partner = directory.partners.find(({ id }) => id === partnerId);
    assert.ok(partner.counts.funded > 0);
    const report = await action(owner, "readRealtorWorkspace", { type: "records", partnerId, view: "funded", filters });
    assert.equal(report.total, partner.counts.funded);
    assert.ok(report.rows.some((record) => record.id === loanId && record.fundedOn === today));
    assert.doesNotMatch(JSON.stringify(directory), new RegExp(realtorToken.split(".").at(-1)));
    assert.ok(funded.tasks.some(({ id, completedAt }) => id === fundingTaskId(loanId, "borrower") && !completedAt));
    assert.ok((await realtor(realtorToken)).referrals.some(({ borrowerName, stage }) => borrowerName === imported.name && stage === "Funded"));
    const eventId = randomUUID();
    await loanAction(officer, loanId, "recordFundingCheckIn", { eventId, fundingRevision: funded.closingProgress[0].revision,
      kind: "Call", outcome: "Requested callback", note: "Discuss a later refinance review.", followUp: today, purpose: "Loan service" });
    assert.ok((await queue(officer)).items.some(({ id }) => id === eventId));
    await loanAction(officer, loanId, "saveRetention", { revision: funded.pastClients[0].revision, closingDate: today,
      currentRate: "6.750", targetRate: "6.125", observedRate: "6.000", watchEnabled: true, note: "Fictional rate review requested." });
    const rateTaskId = `rate-watch:${loanId}`;
    assert.ok((await file(officer, loanId)).tasks.some(({ id, completedAt }) => id === rateTaskId && !completedAt));
    const sourceAddress = funded.loans[0].address;
    assert.ok(sourceAddress);
    const start = () => loanAction(officer, loanId, "startReturningClient1003", {
      purpose: "Refinance", fromRateWatch: true, confirmedPropertyAddress: sourceAddress,
    });
    const repeat = await start();
    assert.notEqual(repeat.applicationLoanId, loanId);
    assert.equal((await start()).applicationLoanId, repeat.applicationLoanId);
    const priorFile = await file(officer, loanId);
    assert.deepEqual(priorFile.returningClientLoans, [{ fundedLoanId: loanId, loanId: repeat.applicationLoanId }]);
    assert.ok(priorFile.tasks.some(({ id, completedAt }) => id === rateTaskId && completedAt));
    assert.equal(priorFile.closingProgress[0].fundingDate, today);
    const unchangedCampaign = (await write(officer, { type: "refreshCampaignQueue", campaignId })).campaignQueue;
    assert.equal(unchangedCampaign.files.find(({ id }) => id === loanId).fundingDate, today);
    assert.ok(!unchangedCampaign.files.some(({ id }) => id === repeat.applicationLoanId));
    const newFile = await file(officer, repeat.applicationLoanId);
    assert.equal(newFile.loans[0].contactId, funded.loans[0].contactId);
    const repeatBorrower = await borrower(newFile.applications[0].token, { type: "read" });
    assert.equal(repeatBorrower.draft.email, imported.email);
    assert.equal(repeatBorrower.draft.phone, imported.phone);
    assert.equal(repeatBorrower.draft.purpose, "Refinance");
    assert.equal(repeatBorrower.draft.propertyAddress, funded.applications[0].draft.propertyAddress);
    assert.equal(repeatBorrower.draft.propertyLocation.zip, funded.applications[0].draft.propertyLocation.zip);
    const returns = (await workspace(owner)).managerReports.returningClients;
    const matches = returns.filter((row) => row.metric === "applications" && row.loanId === repeat.applicationLoanId);
    assert.equal(matches.length, 1);
    const [reported] = matches;
    assert.equal(reported.sourceLoanId, loanId);
    assert.equal(reported.officerEmail, officer.email);
    assert.equal(reported.purpose, "Refinance");
    assert.equal(reported.detail, "Draft");
    const repeatDraft = { ...sampleApplication(repeatBorrower.draft), propertyAddress: "32 Updated Fictional Lane", confirmedDemo: true };
    const step = applicationSteps.indexOf("Review");
    const repeatSubmitted = await borrower(newFile.applications[0].token, { type: "submit", revision: repeatBorrower.revision, step, draft: repeatDraft });
    assert.ok(repeatSubmitted.submittedAt, repeatSubmitted.error);
    assert.match((await file(owner, reported.loanId)).loans[0].address, /^32 Updated Fictional Lane/);
    assert.equal((await file(owner, reported.sourceLoanId)).loans[0].address, sourceAddress);
    assert.match((await action(processor, "readLoanForWork", repeat.applicationLoanId)).error, /unavailable/i);

    return { id: reported.loanId, revision: repeatSubmitted.revision, token: newFile.applications[0].token };
  });

  await stage("LO exports, clears, and funds the refinance through a manual lender", async () => {
    const { id: repeatId, revision, token: repeatToken } = repeatFile;
    await loanAction(officer, repeatId, "reviewApplication", { revision });
    const handoff = { type: "recordManualHandoff", loanId: repeatId, revision, lenderRevision: 0,
      eventId: randomUUID(), outcome: "Acknowledged", note: "", lenderFile: { lender: "Fictional Wholesale", externalId: "FICT-REFI-1003" } };
    assert.match((await action(officer, "mutate", handoff)).error, /Prepare the MISMO export/);
    const names = [{ first: imported.name.split(" ")[0], middle: "", last: imported.name.split(" ").slice(1).join(" "), suffix: "" }];
    const exported = await loanAction(officer, repeatId, "exportReviewedApplication", {
      revision, lenderRevision: 0, eventId: randomUUID(), names,
    });
    assert.match(exported.mismoXml, /<LoanPurposeType>Refinance<\/LoanPurposeType>/);
    assert.match(exported.mismoXml, /<AddressLineText>32 Updated Fictional Lane<\/AddressLineText>/);
    assert.ok((await action(competingOfficer, "mutate", handoff)).error);
    const acknowledged = await write(officer, handoff);
    const submissionId = acknowledged.loanWork.applications[0].manualHandoff.submissionId;
    assert.ok(submissionId);
    assert.equal((await write(officer, handoff)).loanWork.applications[0].manualHandoff.submissionId, submissionId);
    assert.match((await action(officer, "mutate", { ...handoff, lenderFile: { ...handoff.lenderFile, externalId: "OTHER" } })).error, /new handoff entry/);
    assert.equal((await file(officer, repeatId)).submissions.length, 1);
    const review = (input) => action(owner, "workOnLoanReview", { loanId: repeatId, ...input });
    async function approveCurrent() {
      const [pending] = (await review({ type: "loan" })).reviews;
      const { review: currentReview } = await review({ type: "detail", id: pending.id });
      const approved = await review({ type: "decide", id: pending.id, revision: currentReview.revision, eventId: randomUUID(),
        decision: "Approved", note: "Reviewed the fictional refinance." });
      assert.equal(approved.kind, "saved", approved.error);
    }
    await approveCurrent();
    const conditionId = randomUUID();
    const condition = { loanId: repeatId, submissionId, conditionId };
    await write(officer, { type: "saveManualCondition", ...condition, revision: 0,
      category: "Income", owner: "Loan officer", description: "Fictional pay stub." });
    const working = await file(officer, repeatId);
    assert.equal(loanNextAction(working.loans[0], working, "LO").title, "Work income condition");
    const markClear = { type: "markClearToClose", loanId: repeatId };
    assert.match((await action(officer, "mutate", markClear)).error, /no longer ready/);
    await loanAction(officer, repeatId, "requestDocument", { kind: "Pay stub", instructions: "Attach a fictional sample.",
      condition: { submissionId, conditionId } });
    const manualRequest = (await file(officer, repeatId)).documentRequests[0];
    await borrower(repeatToken, { type: "attachSample", statusOnly: true, requestId: manualRequest.id, revision: manualRequest.revision });
    const received = (await file(officer, repeatId)).documentRequests[0];
    await loanAction(officer, repeatId, "reviewDocument", { requestId: received.id, revision: received.revision,
      decision: "Accepted", replacementNote: "" });
    const accepted = (await file(officer, repeatId)).documentRequests[0];
    await write(officer, { type: "recordManualDelivery", ...condition, revision: 1,
      documentRevision: accepted.revision, reference: "FICT-DOC-01" });
    await write(officer, { type: "recordManualClearance", ...condition, revision: 2, cleared: true, confirmation: "FICT-CLEAR-01" });
    const cleared = await file(officer, repeatId);
    assert.equal(cleared.submissions[0].conditions[0].manual.confirmedDelivery, "FICT-CLEAR-01");
    assert.equal(cleared.submissions[0].conditions[0].manual.deliveries[0].reference, "FICT-DOC-01");
    assert.equal(loanNextAction(cleared.loans[0], cleared, "LO").title, "Review closing readiness");
    await write(officer, markClear);
    await write(owner, { type: "savePlaybook", ...(await file(owner, repeatId)).playbook, manualReturnHours: 6 });
    const lenderReturn = { type: "requestApplicationCorrection", loanId: repeatId, revision,
      note: "Confirm the requested refinance amount.",
      lenderReturn: { eventId: randomUUID(), submissionId, lenderRevision: 0 } };
    assert.ok((await action(competingOfficer, "mutate", lenderReturn)).error);
    assert.match((await action(officer, "mutate", { ...lenderReturn, lenderReturn: { ...lenderReturn.lenderReturn, submissionId: randomUUID() } })).error,
      /acknowledgment changed/);
    const returned = (await write(officer, lenderReturn)).loanWork;
    assert.equal(returned.loans[0].stage, "Underwriting");
    assert.equal(returned.applications[0].lastManualSubmissionId, submissionId);
    assert.equal(returned.applications[0].manualHandoff?.submissionId, undefined);
    assert.equal(returned.submissions[0].status, "Returned for changes");
    const returns = (staff) => action(staff, "readManagerFileExceptions", { filter: "Manual lender returns" });
    const manualReturn = { eventId: lenderReturn.lenderReturn.eventId, submissionId };
    const initialReturn = (await returns(owner)).items.find((item) => item.loanId === repeatId);
    const returnDueAt = afterHours(initialReturn.reopenedAt, 6);
    await write(owner, { type: "savePlaybook", ...(await file(owner, repeatId)).playbook, manualReturnHours: 2 });
    let assignedOfficer = officer;
    let latestFollowUp;
    async function checkReturnQueues(status) {
      const personal = (await incoming(assignedOfficer, "today")).items.filter((item) => item.loanId === repeatId && item.kind !== "document");
      assert.deepEqual(personal.map(({ kind, id, returnStatus }) => ({ kind, id, returnStatus })),
        [{ kind: "lender-return", id: submissionId, returnStatus: status }]);
      assert.equal(personal[0].note, "Fictional Wholesale · FICT-REFI-1003");
      assert.equal(personal[0].returnEventId, manualReturn.eventId);
      assert.deepEqual(personal[0].returnFollowUp, latestFollowUp);
      assert.deepEqual(personal[0].returnDeadline, { dueAt: returnDueAt, overdue: false });
      const managed = (await returns(owner)).items.find((item) => item.loanId === repeatId);
      assert.equal(managed.status, status);
      assert.equal(managed.target, manualReturnSteps[status].target);
      assert.equal(managed.owner, assignedOfficer.name);
      assert.equal(managed.returnEventId, manualReturn.eventId);
      assert.deepEqual(managed.returnFollowUp, latestFollowUp);
      assert.equal(managed.returnDueAt, returnDueAt);
      assert.equal(managed.dueOn, null);
      assert.equal(managed.overdue, false);
      assert.deepEqual((await file(assignedOfficer, repeatId)).manualReturn, { ...manualReturn, status });
    }
    await checkReturnQueues(manualReturnStatus.borrower);
    const followUp = { loanId: repeatId, ...manualReturn, entryId: randomUUID(), party: "Borrower", channel: "Call", note: "Left a fictional voicemail about the return." };
    const logFollowUp = (actor, input = followUp, expectedBrokerage = brokerage) =>
      action(actor, "logLenderReturnFollowUp", input, undefined, expectedBrokerage);
    for (const actor of [competingOfficer, processor, owner]) assert.ok((await logFollowUp(actor)).error);
    assert.ok((await logFollowUp(officer, followUp, randomUUID())).error);
    const firstFollowUp = await logFollowUp(officer);
    latestFollowUp = firstFollowUp.followUp;
    assert.equal(latestFollowUp.note, followUp.note);
    assert.deepEqual(await logFollowUp(officer), firstFollowUp);
    await checkReturnQueues(manualReturnStatus.borrower);
    assert.ok(!(await incoming(competingOfficer, "today")).items.some((item) => item.loanId === repeatId));
    assert.ok(!(await incoming(owner, "today")).items.some((item) => item.loanId === repeatId));
    assert.ok((await returns(officer)).error);
    assert.equal((await write(officer, lenderReturn)).loanWork.applications[0].revision, returned.applications[0].revision);
    assert.match((await action(officer, "mutate", { ...lenderReturn, note: "A different instruction." })).error, /new lender return entry/);
    assert.match((await action(officer, "mutate", markClear)).error, /no longer ready/);
    assert.match((await action(officer, "mutate", handoff)).error, /current submitted application/);
    const reassign = { type: "assign", loanId: repeatId, previousEmail: officer.email, email: competingOfficer.email, manualReturn };
    const assignResponse = (actor, input) => postResponse(`/api/brokerages?brokerage=${brokerage}`, input, actor);
    assert.equal((await assignResponse(officer, reassign)).status, 403);
    assert.equal((await assignResponse(owner, { ...reassign, email: processor.email })).status, 403);
    const staleReturn = await assignResponse(owner, { ...reassign, manualReturn: { ...manualReturn, eventId: randomUUID() } });
    assert.equal(staleReturn.status, 409);
    assert.match(staleReturn.result.error, /lender return changed/);
    assert.equal((await assignResponse(owner, reassign)).status, 200);
    assert.equal((await assignResponse(owner, reassign)).status, 200);
    assert.equal((await assignResponse(owner, { ...reassign, email: owner.email })).status, 409);
    assignedOfficer = competingOfficer;
    assert.ok(!(await incoming(officer, "today")).items.some((item) => item.loanId === repeatId));
    assert.ok((await action(officer, "readLoanForWork", repeatId)).error);
    assert.ok((await logFollowUp(officer)).error);
    await checkReturnQueues(manualReturnStatus.borrower);
    const secondFollowUp = { ...followUp, entryId: randomUUID(), party: "Lender", channel: "Portal", note: "Fictional portal check completed." };
    latestFollowUp = (await logFollowUp(assignedOfficer, secondFollowUp)).followUp;
    assert.equal(latestFollowUp.note, secondFollowUp.note);
    await checkReturnQueues(manualReturnStatus.borrower);
    const returnActivity = await action(assignedOfficer, "readHistoryPage", { record: "loan", id: repeatId });
    assert.equal(returnActivity.events.filter(({ text }) => text.startsWith("Lender return follow-up")).length, 2);
    const transferred = await file(assignedOfficer, repeatId);
    assert.equal(transferred.applications[0].token, repeatToken);
    assert.equal(transferred.applications[0].revision, returned.applications[0].revision);
    assert.deepEqual(transferred.submissions[0].conditions, cleared.submissions[0].conditions);
    assert.equal(transferred.documentRequests[0].id, accepted.id);
    const draft = await borrower(repeatToken, { type: "read" });
    assert.equal(draft.correctionNote, lenderReturn.note);
    assert.ok(!JSON.stringify(draft).includes(followUp.note) && !JSON.stringify(draft).includes(secondFollowUp.note));
    const correctedAmount = String(Number(draft.draft.loanAmount) - 500);
    const corrected = await borrower(repeatToken, { type: "submit", revision: draft.revision, step: applicationSteps.length - 1,
      draft: { ...draft.draft, loanAmount: correctedAmount } });
    await checkReturnQueues(manualReturnStatus.review);
    await loanAction(assignedOfficer, repeatId, "reviewApplication", { revision: corrected.revision });
    await checkReturnQueues(manualReturnStatus.approval);
    await approveCurrent();
    await checkReturnQueues(manualReturnStatus.export);
    const reacknowledgment = { ...handoff, revision: corrected.revision, eventId: randomUUID() };
    assert.match((await action(assignedOfficer, "mutate", reacknowledgment)).error, /Prepare the MISMO export/);
    const revisedExport = await loanAction(assignedOfficer, repeatId, "exportReviewedApplication", {
      revision: corrected.revision, lenderRevision: 0, eventId: randomUUID(), names,
    });
    assert.ok(revisedExport.mismoXml.includes(`<NoteAmount>${correctedAmount}</NoteAmount>`));
    await checkReturnQueues(manualReturnStatus.acknowledgment);
    const pendingRevision = await file(owner, repeatId);
    assert.equal(loanNextAction(pendingRevision.loans[0], pendingRevision, "LO").title, "Prepare revised manual handoff");
    await write(assignedOfficer, reacknowledgment);
    assert.match((await logFollowUp(assignedOfficer, { ...followUp, entryId: randomUUID() })).error, /return changed/);
    const relinked = await action(owner, "checkLoanHandoff", repeatId, pendingRevision.handoffVersion);
    assert.equal(relinked.applications[0].manualHandoff.submissionId, submissionId);
    assert.equal(relinked.submissions.length, 1);
    assert.equal(relinked.submissions[0].status, "Acknowledged");
    assert.deepEqual(relinked.submissions[0].conditions, cleared.submissions[0].conditions);
    assert.equal(relinked.documentRequests[0].id, accepted.id);
    assert.equal(relinked.documentRequests[0].revision, accepted.revision);
    assert.ok(!(await incoming(assignedOfficer, "today")).items.some((item) => item.id === submissionId));
    assert.ok(!(await returns(owner)).items.some((item) => item.id === submissionId));
    const settledReturn = await assignResponse(owner, { ...reassign, previousEmail: assignedOfficer.email, email: officer.email });
    assert.equal(settledReturn.status, 409);
    assert.match(settledReturn.result.error, /lender return changed/);
    assert.equal(loanNextAction(relinked.loans[0], relinked, "LO").title, "Review closing readiness");
    await write(assignedOfficer, markClear);
    await loanAction(assignedOfficer, repeatId, "recordClosing", { closingDate: today, revision: 0 });
    await loanAction(assignedOfficer, repeatId, "recordFunding", { fundingDate: today, revision: 0 });
    const fundedRepeat = await file(assignedOfficer, repeatId);
    assert.equal(fundedRepeat.closingProgress[0].fundingDate, today);
    assert.equal(fundedRepeat.submissions[0].syncedAt, null);
    assert.equal(fundedRepeat.applications[0].uwmReference, null);
    assert.match((await action(assignedOfficer, "mutate", { ...lenderReturn, revision: corrected.revision,
      lenderReturn: { ...lenderReturn.lenderReturn, eventId: randomUUID() } })).error, /loan has closed/);
    const finalReport = (await workspace(owner)).managerReports.returningClients.find((row) => row.loanId === repeatId && row.metric === "applications");
    assert.equal(finalReport.detail, "Funded");
    assert.equal(finalReport.sourceLoanId, loanId);
    assert.equal(finalReport.officerEmail, assignedOfficer.email);
  });
  await stage("Campaign holds and archives refill without overbooking reopened leads", async () => {
    const capacityCampaign = randomUUID();
    await write(owner, { type: "createCallCampaign", id: capacityCampaign, name: "Fictional capacity lifecycle" });
    await write(owner, { type: "saveCampaignRouting", campaignId: capacityCampaign, revision: 0, enabled: true,
      officers: [{ email: officer.email, limit: 1 }] });
    const input = { type: "migratePipeline", campaignId: capacityCampaign, origin: campaignOrigin(capacityCampaign), decisions: {},
      rows: [1, 2, 3].map((n) => ({ type: "Lead", externalId: `capacity-${n}`, parentId: "", name: `Fictional capacity ${n}`,
        email: `capacity-${n}@example.test`, phone: `248-555-013${n}`, ownerEmail: "", purpose: "Purchase", source: "Imported CRM",
        zip: "48067", createdAt: new Date(now - (4 - n) * 86_400_000).toISOString(), dueAt })) };
    const { rows } = await importRows(input);
    const ids = [1, 2, 3].map((n) => rows.find(({ key }) => key === `Lead:capacity-${n}`).targetId);
    const [first, second, third] = ids;
    const read = (state, id) => state.inboxLeads.find((lead) => lead.id === id);
    const member = (state, id) => state.callCampaignMembers.find(({ leadId }) => leadId === id);
    const hold = (lead) => ({ type: "leadHold", leadId: lead.id, action: "Hold", revision: lead.followUp.revision, reason: "Fictional hold", revisitDate: null });
    const reactivate = (lead) => write(officer, { type: "leadHold", leadId: lead.id, action: "Reactivate", revision: lead.followUp.revision });
    const call = (lead) => write(officer, { type: "recordCampaignCall", campaignId: capacityCampaign, leadId: lead.id,
      revision: lead.followUp.revision, outcome: "Requested callback", note: "Fictional callback promise", callbackAt: campaignCallbackAt });
    const before = await workspace(officer);
    assert.equal(read(before, first).officerEmail, officer.email);
    assert.equal(read(before, second).officerEmail, null);
    const called = await call(read(before, first));
    const held = await write(officer, hold(called.leadWork.lead));
    assert.match(held.message, /shared lead was routed/);
    assert.equal(read(held.state, first).officerEmail, officer.email);
    assert.ok(read(held.state, first).heldAt);
    assert.equal(member(held.state, first).callbackDueAt, campaignCallbackAt);
    assert.equal(read(held.state, second).officerEmail, officer.email);
    assert.equal(read(held.state, third).officerEmail, null);
    const retried = await write(officer, hold(read(held.state, first)));
    assert.match(retried.message, /already on hold/);
    assert.equal(read(retried.state, third).officerEmail, null);

    const reopened = await reactivate(read(held.state, first));
    assert.match(reopened.message, /shared queue/);
    assert.equal(read(reopened.state, first).officerEmail, null);
    assert.equal(read(reopened.state, first).dueAt, dueAt);
    assert.equal(member(reopened.state, first).callbackDueAt, campaignCallbackAt);
    const secondCalled = await call(read(reopened.state, second));
    const archived = await write(officer, { type: "dismissReferral", referralId: second, revision: secondCalled.leadWork.lead.followUp.revision });
    assert.match(archived.message, /shared lead was routed/);
    assert.equal(read(archived.state, first).officerEmail, officer.email);
    assert.equal(member(archived.state, first).callbackDueAt, campaignCallbackAt);
    const { leads } = await action(officer, "readArchivePage", { query: "Fictional capacity 2" });
    const restore = { type: "restoreLead", leadId: second, archiveToken: leads.find(({ id }) => id === second).archiveToken };
    const restored = await write(officer, restore);
    assert.match(restored.message, /shared queue/);
    assert.equal(read(restored.state, second).officerEmail, null);
    assert.equal(read(restored.state, second).dueAt, dueAt);
    assert.equal(member(restored.state, second).callbackDueAt, null);
    assert.ok(read(restored.state, second).importedTasks.some(({ id, completedAt }) => id === secondCalled.leadWork.member.callbackTaskId && completedAt));
    assert.match((await action(officer, "mutate", restore)).error, /archived lead is unavailable/i);

    await write(owner, hold(read(restored.state, second)));
    await write(owner, hold(read(restored.state, third)));
    const heldWithoutOverflow = await write(officer, hold(read(restored.state, first)));
    const retained = await reactivate(read(heldWithoutOverflow.state, first));
    assert.equal(read(retained.state, first).officerEmail, officer.email);
    assert.equal(member(retained.state, first).callbackDueAt, campaignCallbackAt);
  });
  await stage("A covered opt-out refills only slots released across matching campaign leads", async () => {
    const firstCampaign = randomUUID();
    const secondCampaign = randomUUID();
    const names = ["Fictional opt-out source", "Fictional shared alias", "Fictional first replacement", "Fictional extra waiting",
      "Fictional owned alias", "Fictional second replacement"];
    const email = (index) => `capacity-opt-out-${index}@example.test`;
    const phone = (index) => `248-555-017${index}`;
    async function prepare(campaignId, assignee, indices) {
      await write(owner, { type: "createCallCampaign", id: campaignId, name: names[indices[0]] });
      await write(owner, { type: "saveCampaignRouting", campaignId, revision: 0, enabled: true, officers: [{ email: assignee.email, limit: 1 }] });
      const { rows } = await importRows({ type: "migratePipeline", campaignId, origin: campaignOrigin(campaignId), decisions: {},
        rows: indices.map((index) => ({ type: "Lead", externalId: `opt-out-${index}`, parentId: "", name: names[index], email: email(index),
          phone: phone(index), ownerEmail: "", purpose: "Purchase", source: "Imported CRM", zip: "48067",
          createdAt: new Date(now - (10 - index) * 86_400_000).toISOString(), dueAt })) });
      return indices.map((index) => rows.find(({ key }) => key === `Lead:opt-out-${index}`).targetId);
    }
    const [source, sharedAlias, firstReplacement, extraWaiting] = await prepare(firstCampaign, officer, [0, 1, 2, 3]);
    const [ownedAlias, secondReplacement] = await prepare(secondCampaign, competingOfficer, [4, 5]);
    const bridge = await write(owner, { type: "contact", name: "Fictional alias bridge", role: "Borrower", email: email(0), phone: phone(4) });
    assert.ok(bridge.contactId);
    assert.equal(bridge.state, undefined);
    await write(owner, { type: "contact", name: "Fictional shared alias bridge", role: "Borrower", email: email(1), phone: phone(4) });
    const read = (state, id) => state.inboxLeads.find((lead) => lead.id === id);
    const member = (state, id) => state.callCampaignMembers.find(({ leadId }) => leadId === id);
    const call = (staff, campaignId, lead) => write(staff, { type: "recordCampaignCall", campaignId, leadId: lead.id,
      revision: lead.followUp.revision, outcome: "Requested callback", note: "Fictional promise before opt-out.", callbackAt: campaignCallbackAt });
    const before = await workspace(owner);
    const sourceCall = await call(officer, firstCampaign, read(before, source));
    await call(competingOfficer, secondCampaign, read(before, ownedAlias));
    const id = randomUUID();
    const through = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const schedule = await action(owner, "workOnStaffCoverage", { type: "schedule", id, absentEmail: officer.email, backupEmail: competingOfficer.email,
      startsOn: today, endsOn: through });
    assert.equal(schedule.kind, "saved", schedule.error);
    const act = { type: "act", id, operationId: randomUUID(), update: { kind: "campaign", id: sourceCall.leadWork.member.callbackTaskId,
      revision: sourceCall.leadWork.lead.followUp.revision, outcome: "Opted out", note: "Fictional opt-out during coverage." } };
    const optedOut = await action(competingOfficer, "workOnStaffCoverage", act);
    assert.match(optedOut.message, /2 shared leads were routed/, optedOut.error);
    assert.deepEqual(await action(competingOfficer, "workOnStaffCoverage", act), optedOut);
    const after = await workspace(owner);
    for (const leadId of [source, ownedAlias, sharedAlias]) assert.equal(read(after, leadId).outreachSuppressed, true);
    assert.equal(member(after, source).callbackDueAt, null);
    assert.equal(member(after, ownedAlias).callbackDueAt, null);
    assert.equal(read(after, sharedAlias).officerEmail, null);
    assert.equal(read(after, extraWaiting).officerEmail, null);
    for (const [leadId, expected] of [[firstReplacement, officer.email], [secondReplacement, competingOfficer.email]]) {
      assert.equal(read(after, leadId).officerEmail, expected);
      assert.equal(read(after, leadId).dueAt, dueAt);
      assert.equal(read(after, leadId).followUp.events.filter(({ text }) => text.startsWith("Assigned to ")).length, 1);
    }
    const sourceReport = await action(owner, "readCampaignCallbackPerformance", { campaignId: firstCampaign });
    const aliasReport = await action(owner, "readCampaignCallbackPerformance", { campaignId: secondCampaign });
    assert.match(sourceReport.items[0].attempt.text, /Fictional opt-out during coverage/);
    assert.equal(aliasReport.items[0].attempt, null);
    assert.equal(aliasReport.items[0].closeReason, "Borrower opted out");
    const repeated = await write(owner, { type: "optOutContact", contactId: bridge.contactId });
    assert.doesNotMatch(repeated.message, /was routed|were routed/);
    assert.equal(read(repeated.state, extraWaiting).officerEmail, null);
  });
  const quoteFile = await stage("A published website quote routes through campaign capacity into a prefilled 1003", async () => {
    const campaignId = randomUUID();
    const { leadRouting: routing } = await workspace(owner);
    await write(owner, { type: "createCallCampaign", id: campaignId, name: "Fictional website quotes" });
    await write(owner, { type: "saveCampaignRouting", campaignId, revision: 0, enabled: true,
      officers: [officer, competingOfficer].map(({ email }) => ({ email, limit: 1 })) });
    await write(owner, { ...routing, type: "saveLeadRouting", websiteOwner: owner.email, firstContactHours: 1, quoteForm: "Enable or replace" });
    const { leadRouting: { quoteToken } } = await workspace(owner);
    assert.ok(quoteToken);
    const quote = (input) => post("/api/quote-requests", { token: quoteToken, ...input });
    const initial = await quote({ type: "read" });
    assert.equal(initial.revision, 0);
    const settingsPath = `/api/quote-intake-settings?brokerage=${brokerage}`;
    const config = { ...initial.config, title: "Fictional purchase quote", theme: "Navy", zip: "Required", timing: "Required",
      question: { prompt: "What is your purchase goal?", required: true }, campaignId };
    const publish = { type: "publish", revision: initial.revision, config };
    assert.equal((await postResponse(settingsPath, publish, officer)).status, 403);
    assert.equal((await postResponse(`/api/quote-intake-settings?brokerage=${randomUUID()}`, publish, owner)).status, 403);
    assert.equal((await post(settingsPath, publish, owner)).revision, 1);
    const { revision, config: publicConfig } = await quote({ type: "read" });
    assert.equal(publicConfig.title, config.title);
    assert.equal("campaignId" in publicConfig, false);
    const submission = (index, phone = `248-555-019${index}`) => ({ type: "submit", requestId: randomUUID(), formRevision: revision,
      name: `Fictional quote borrower ${index}`, email: `working-day-quote-${index}@example.test`, phone,
      purpose: "Purchase", zip: "48304", timing: "In 1 to 3 months", answer: "A fictional first home.", consent: true });
    const stale = await postResponse("/api/quote-requests", { ...submission(0), token: quoteToken, formRevision: 0 });
    assert.equal(stale.status, 409);
    const requests = [submission(1), submission(2), submission(3), submission(4, "")];
    for (const input of [...requests, requests[0]]) assert.deepEqual(await quote(input), { received: true });
    const { inboxLeads } = await workspace(owner);
    const matches = inboxLeads.filter(({ name }) => name.startsWith("Fictional quote borrower"));
    assert.equal(matches.length, 4);
    const leads = requests.map(({ name }) => matches.find((lead) => lead.name === name));
    assert.deepEqual(leads.map(({ officerEmail }) => officerEmail), [officer.email, competingOfficer.email, null, owner.email]);
    assert.deepEqual(leads.map((lead) => lead.campaignId ?? null), [campaignId, campaignId, campaignId, null]);
    assert.ok(leads.every(({ source, zip }) => source === "Website quote request" && zip === "48304"));
    const [first, , shared] = leads;
    const { referralLoanId } = await write(officer, { type: "convertReferral", referralId: first.id, contactId: null });
    const loan = await file(officer, referralLoanId);
    assert.equal(loan.loans[0].leadSource, "Website quote request");
    const application = await borrower(loan.applications[0].token, { type: "read" });
    assert.equal(application.draft.borrowerName, requests[0].name);
    assert.equal(application.draft.propertyLocation.zip, requests[0].zip);
    const history = await action(officer, "readHistoryPage", { record: "loan", id: referralLoanId });
    assert.match(JSON.stringify(history.events), /Website quote request · Form version 1.*fictional first home/);
    assert.equal((await workspace(owner)).inboxLeads.find(({ id }) => id === shared.id).officerEmail, officer.email);
    return { id: referralLoanId, token: loan.applications[0].token };
  });
  await stage("A versioned checklist reaches the borrower and assigned processor without replacing existing requests", async () => {
    const { id: loanId, token } = quoteFile;
    const path = `/api/document-templates?brokerage=${brokerage}`;
    const templateId = randomUUID();
    const config = { title: "Fictional Purchase Starter", purpose: "Purchase", items: [
      { kind: "Photo ID", instructions: "Fictional template ID instructions.", dueDays: 0 },
      { kind: "Bank statement", instructions: "Attach a sample statement with the account period.", dueDays: 0 },
    ] };
    const publish = { type: "publish", id: templateId, revision: 0, config };
    assert.equal((await postResponse(path, publish, officer)).status, 409);
    assert.equal((await post(path, publish, owner)).templates[0].revision, 1);
    const query = { type: "loan", loanId };
    assert.equal((await postResponse(path, query, competingOfficer)).status, 409);
    assert.equal((await postResponse(path, query, processor)).status, 409);
    const existingDue = shiftReportDate(today, 4);
    await loanAction(officer, loanId, "requestDocument", { kind: "Photo ID", instructions: "Keep the original ID instructions.", dueOn: existingDue });
    await team(owner, { type: "assignProcessor", email: processor.email, loanId, revision: 0 });
    const preview = await post(path, query, processor);
    assert.equal(preview.templates[0].id, templateId);
    assert.deepEqual(preview.templates[0].items, config.items);
    const apply = { type: "applyDocumentTemplate", loanId, templateId, revision: 1, asOf: preview.asOf };
    assert.ok((await action(competingOfficer, "mutate", apply)).error);
    const applied = await write(processor, apply);
    assert.match(applied.message, /Added 1 document request/);
    assert.match((await write(processor, apply)).message, /already on the checklist/);
    const checklist = (await file(processor, loanId)).documentRequests;
    const existing = checklist.find(({ kind }) => kind === "Photo ID");
    const statement = checklist.find(({ kind }) => kind === "Bank statement");
    assert.equal(existing.instructions, "Keep the original ID instructions.");
    assert.equal(existing.dueOn, existingDue);
    assert.equal(statement.dueOn, preview.asOf);
    assert.equal(statement.templateTitle, config.title);
    assert.equal(statement.templateRevision, 1);
    const draft = await borrower(token, { type: "read" });
    const sent = await borrower(token, { type: "submit", revision: draft.revision, step: applicationSteps.length - 1,
      draft: { ...sampleApplication(draft.draft), confirmedDemo: true } });
    assert.equal(sent.loanStatus.documents.find(({ id }) => id === statement.id).instructions, config.items[1].instructions);
    assert.equal(sent.loanStatus.documents.find(({ id }) => id === statement.id).dueOn, preview.asOf);
    assert.equal("templateTitle" in sent.loanStatus.documents.find(({ id }) => id === statement.id), false);
    const missing = await action(owner, "readManagerFileExceptions", { filter: "Missing evidence" });
    const exception = missing.items.find(({ id }) => id === statement.id);
    assert.equal(exception.owner, officer.name);
    assert.equal(exception.dueOn, preview.asOf);
    const v2 = { ...publish, revision: 1, config: { ...config, title: "Fictional Purchase Starter revised" } };
    assert.equal((await post(path, v2, owner)).templates[0].revision, 2);
    assert.match((await action(processor, "mutate", apply)).error, /template changed/);
    const received = await borrower(token, { type: "attachSample", requestId: statement.id, revision: statement.revision, statusOnly: true });
    const arrived = received.loanStatus.documents.find(({ id }) => id === statement.id);
    assert.equal(arrived.status, "Received");
    await loanAction(processor, loanId, "reviewDocument", { requestId: statement.id, revision: arrived.revision, decision: "Accepted", replacementNote: "" });
    assert.equal((await borrower(token, { type: "status" })).loanStatus.documents.find(({ id }) => id === statement.id).status, "Accepted");
    const history = await action(officer, "readHistoryPage", { record: "loan", id: loanId });
    assert.equal(history.events.filter(({ text }) => text.includes(`Applied ${config.title} · Version 1`)).length, 1);
  });
  const jointFile = await stage("Separate borrower links produce one reviewable joint 1003 with isolated corrections", async () => {
    const created = await write(officer, { type: "loan", contactId: "", borrower: "Fictional Joint Primary",
      borrowerEmail: "working-day-joint-primary@example.test", start1003: true, partnerId: null, officer: officer.name,
      address: "", amount: 0, purpose: "Purchase", stage: "Lead" });
    const loanId = created.loanWork.loanId;
    const initial = (await file(officer, loanId)).applications[0];
    const enable = { type: "enableJointApplication", loanId, revision: initial.revision };
    assert.ok((await action(competingOfficer, "mutate", enable)).error);
    const linked = (await write(officer, enable)).loanWork.applications[0];
    const firstCoToken = linked.joint.token;
    const primaryToken = linked.token;
    const co = (input, token = firstCoToken) => post("/api/joint-application", { token, ...input });
    assert.equal((await postResponse("/api/joint-application", { type: "read", token: primaryToken })).status, 404);
    assert.equal((await postResponse("/api/demo-application", { type: "read", token: firstCoToken })).status, 404);
    const firstPrimary = await borrower(primaryToken, { type: "read" });
    assert.equal(firstPrimary.separateJoint, true);
    const primaryAnswers = { ...primaryJointDraft(sampleApplication(firstPrimary.draft)), confirmedDemo: true };
    primaryAnswers.urla.primary.joint.fields.initials = "FJP";
    primaryAnswers.urla.primary.work.groups.jobs[0].employer = "Working Day Private Primary Employer";
    const coStart = await co({ type: "read" });
    const coAnswers = sampleCoBorrower(coStart.draft);
    coAnswers.work.groups.jobs[0].employer = "Working Day Private Co-borrower Employer";
    const saved = await co({ type: "save", revision: coStart.revision, step: coBorrowerReviewStep, draft: coAnswers, confirmedDemo: false });
    assert.deepEqual((await co({ type: "read" })).draft, saved.draft);
    const primarySubmit = { type: "submit", revision: firstPrimary.revision, step: applicationSteps.length - 1, draft: primaryAnswers };
    assert.equal((await borrower(primaryToken, primarySubmit)).loanStatus, null);
    assert.equal((await borrower(primaryToken, { type: "status" })).kind, "joint-waiting");
    const waiting = (await file(officer, loanId)).applications[0];
    assert.ok(waiting.joint.primarySubmittedAt);
    assert.equal(waiting.submittedAt, null);
    assert.deepEqual(waiting.versions, []);
    assert.ok((await action(officer, "mutate", { type: "reviewApplication", loanId, revision: waiting.revision })).error);
    assert.doesNotMatch(JSON.stringify(await co({ type: "read" })), /Private Primary Employer|working-day-joint-primary/);
    assert.doesNotMatch(JSON.stringify(await borrower(primaryToken, { type: "read" })), /Private Co-borrower Employer|joint-borrower@example.test/);
    const submit = { type: "submit", revision: saved.revision, step: coBorrowerReviewStep, draft: saved.draft, confirmedDemo: true };
    assert.equal((await co(submit)).complete, true);
    assert.equal((await co(submit)).complete, true);
    assert.equal((await borrower(primaryToken, { type: "status" })).kind, "status");
    const current = await file(officer, loanId);
    const [app] = current.applications;
    assert.equal(app.versions.length, 1);
    assert.equal(app.draft.urla.additional[0].identity.fields.name, "Jordan Sample");
    assert.equal(current.tasks.filter(({ id }) => id === `application-follow-up:${loanId}`).length, 1);
    await loanAction(officer, loanId, "reviewApplication", { revision: app.revision });
    const names = [{ first: "Fictional", middle: "Joint", last: "Primary", suffix: "" }, { first: "Jordan", middle: "", last: "Sample", suffix: "" }];
    const exported = await loanAction(officer, loanId, "exportReviewedApplication", { revision: app.revision, lenderRevision: 0, eventId: randomUUID(), names });
    assert.match(exported.mismoXml, /<FirstName>Jordan<\/FirstName>/);
    assert.match(exported.mismoXml, /<FirstName>Fictional<\/FirstName>/);
    const note = "Fictional correction for the co-borrower phone.";
    await loanAction(officer, loanId, "requestApplicationCorrection", { revision: app.revision, recipient: "Co-borrower", note });
    assert.equal((await co({ type: "read" })).correctionNote, note);
    assert.doesNotMatch(JSON.stringify(await borrower(primaryToken, { type: "read" })), /correction for the co-borrower phone/);
    await loanAction(officer, loanId, "revokeJointLink", { token: firstCoToken });
    assert.equal((await postResponse("/api/joint-application", { type: "read", token: firstCoToken })).status, 404);
    assert.equal((await borrower(primaryToken, { type: "status" })).kind, "joint-waiting");
    const replaced = await loanAction(officer, loanId, "replaceJointLink", { token: firstCoToken });
    const replacement = replaced.loanWork.applications[0].joint.token;
    assert.notEqual(replacement, firstCoToken);
    const correction = await co({ type: "read" }, replacement);
    correction.draft.identity.fields.cell = "248-555-0157";
    assert.equal((await co({ ...submit, revision: correction.revision, draft: correction.draft }, replacement)).complete, true);
    const revised = (await file(officer, loanId)).applications[0];
    assert.equal(revised.versions.length, 2);
    assert.equal(revised.draft.urla.additional[0].identity.fields.cell, "248-555-0157");
    assert.deepEqual(revised.draft.urla.primary, app.draft.urla.primary);
    assert.equal(revised.reviewedAt, null);
    return { loanId, primaryToken, coToken: replacement };
  });
  await stage("Both borrowers verify and upload only their assigned joint evidence", async () => {
    const { loanId, primaryToken, coToken } = jointFile;
    const primaryNote = "Fictional primary ID request.";
    const coNote = "Fictional co-borrower ID request.";
    await loanAction(officer, loanId, "requestDocument", { kind: "Photo ID", instructions: primaryNote });
    await loanAction(officer, loanId, "requestDocument", { kind: "Photo ID", instructions: coNote, recipient: "Co-borrower" });
    const templatePath = `/api/document-templates?brokerage=${brokerage}`;
    const { asOf, templates } = await post(templatePath, { type: "loan", loanId }, officer);
    const template = templates.find(({ title }) => title === "Fictional Purchase Starter revised");
    assert.ok(template);
    const applied = await loanAction(officer, loanId, "applyDocumentTemplate",
      { templateId: template.id, revision: template.revision, asOf, recipient: "Co-borrower" });
    assert.match(applied.message, /Added 1 document request/);
    const readCo = () => post("/api/joint-application", { type: "read", token: coToken });
    const readPrimary = () => borrower(primaryToken, { type: "status" });
    const [primary] = (await readPrimary()).loanStatus.documents;
    const coDocuments = (await readCo()).documents;
    const co = coDocuments.find(({ kind }) => kind === "Photo ID");
    assert.deepEqual(coDocuments.map(({ kind }) => kind).sort(), ["Bank statement", "Photo ID"]);
    assert.equal(primary.instructions, primaryNote);
    assert.equal(co.instructions, coNote);
    assert.doesNotMatch(JSON.stringify(await readCo()), /Fictional primary ID request/);
    assert.doesNotMatch(JSON.stringify(await readPrimary()), /Fictional co-borrower ID request|Bank statement/);
    const attach = (route, token, request) => postResponse(route, { type: "attachSample", token, requestId: request.id,
      revision: request.revision, statusOnly: true });
    assert.equal((await attach("/api/demo-application", primaryToken, co)).status, 404);
    assert.equal((await attach("/api/joint-application", coToken, primary)).status, 404);

    const verifyPath = "/api/borrower-documents/verify";
    const uploadPath = "/api/borrower-documents/upload";
    const verify = (token, code) => post(verifyPath, { token, type: "verifyCode", code });
    const primaryCode = await post(verifyPath, { type: "sendCode", token: primaryToken });
    const coCode = await post(verifyPath, { type: "sendCode", token: coToken });
    const { session: primarySession } = await verify(primaryToken, primaryCode.demoCode);
    const { session: coSession } = await verify(coToken, coCode.demoCode);
    const upload = (token, session, request, fixture = "clean") => postResponse(uploadPath,
      { token, session, requestId: request.id, revision: request.revision, fixture });
    assert.equal((await upload(coToken, primarySession, co)).status, 401);
    assert.equal((await upload(coToken, coSession, primary)).status, 404);
    assert.equal((await upload(primaryToken, primarySession, co)).status, 404);
    assert.equal((await upload(primaryToken, primarySession, primary)).status, 200);
    assert.equal((await upload(coToken, coSession, co)).status, 200);
    const received = (await readCo()).documents.find(({ id }) => id === co.id);
    assert.equal(received.status, "Received");
    assert.ok(received.pdfUploadedAt);
    const note = "Replace only the fictional co-borrower ID.";
    await loanAction(officer, loanId, "reviewDocument", { requestId: received.id, revision: received.revision,
      decision: "Needs replacement", replacementNote: note });
    const needsReplacement = (await readCo()).documents.find(({ id }) => id === co.id);
    assert.equal(needsReplacement.replacementNote, note);
    assert.doesNotMatch(JSON.stringify(await readPrimary()), /Replace only the fictional/);
    await delay(1_010);
    assert.equal((await upload(coToken, coSession, needsReplacement, "replacement")).status, 200);
    const replaced = (await readCo()).documents.find(({ id }) => id === co.id);
    await loanAction(officer, loanId, "reviewDocument", { requestId: replaced.id, revision: replaced.revision,
      decision: "Accepted", replacementNote: "" });
    assert.equal((await readCo()).documents.find(({ id }) => id === co.id).status, "Accepted");
    assert.equal((await readPrimary()).loanStatus.documents[0].status, "Received");
    const staffRequests = (await file(officer, loanId)).documentRequests;
    assert.equal(staffRequests.find(({ id }) => id === primary.id).recipient, "Primary borrower");
    assert.equal(staffRequests.find(({ id }) => id === co.id).recipient, "Co-borrower");
  });
  await stage("MISMO import returns the exact draft and a scoped duplicate receipt", async () => {
    const fields = { firstName: "Fictional", lastName: "Working Day MISMO", amount: "275000", purpose: "Purchase",
      occupancy: "Primary residence", street: "10 Fictional Way", unit: "", city: "Royal Oak", state: "MI", zip: "48067" };
    const input = { type: "importMismo", requestId: randomUUID(), fields, fictional: true };
    const writeMismo = (value) => action(owner, "mutate", value, "migration");
    const created = await writeMismo(input);
    assert.ok(created.applicationLoanId, created.error);
    assert.equal(created.state, undefined);
    const draft = await file(owner, created.applicationLoanId);
    assert.equal((await writeMismo(input)).applicationLoanId, created.applicationLoanId);
    const existing = await writeMismo({ ...input, requestId: randomUUID(), existingContactId: draft.loans[0].contactId });
    assert.equal(existing.mismoDuplicateLoanId, created.applicationLoanId, existing.error);
    assert.equal(existing.migrationChanged, false);
    assert.equal(existing.state, undefined);
  });
  console.log(JSON.stringify({ setupMs, stages, handoffs, requests, staffRoleChanges: 0, staffHandoffs: handoffs.length,
    staffHandoffsVerified: ["LO to processor", "Processor to original LO"],
    importedIdentityFieldsReentered: 0, externalSystemSwitches: 0, measurement: "Local scripted mock workflow" }, null, 2));
} finally {
  await runtime.dispose();
}

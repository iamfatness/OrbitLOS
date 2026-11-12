import { strFromU8, unzipSync } from "fflate";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createRequire, registerHooks } from "node:module";
import { join, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { readActionResult } from "./action-flight.mjs";
import { recordFictionalReplacement } from "./cutover-replacement-fixture.mjs";

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
const { defaultCampaignSequenceSteps } = await import("../src/lib/campaign-sequence-model.ts");
const { readCsv } = await import("../src/lib/contact-csv.ts");
const { migrationFile, mappedMigrationRows } = await import("../src/lib/pipeline-migration-model.ts");
const { applyLeadConversion } = await import("../src/lib/lead-work-model.ts");
const { afterHours, defaultPlaybook, fundingTaskId } = await import("../src/lib/playbook-model.ts");
const { defaultManagerExceptionFilters } = await import("../src/lib/manager-exception-model.ts");
const { reviewTarget } = await import("../src/lib/loan-review-model.ts");
const { sampleDisclosureDocuments } = await import("../src/lib/disclosure-model.ts");
const { easternDayStart } = await import("../src/lib/client-retention.ts");
const { shiftReportDate } = await import("../src/lib/report-date-range.ts");
const { emptyCallReportFacts, quarterRange } = await import("../src/lib/call-report-model.ts");
const { priorQuarter } = await import("../src/lib/call-report-quarter-model.ts");
const { closingReviewReady, loanNextAction } = await import("../src/lib/loan-workflow.ts");
const { manualReturnStatus, manualReturnSteps } = await import("../src/lib/lender-export-model.ts");
const { emptyPipelineFilters } = await import("../src/lib/pipeline-model.ts");
const { demoDocumentPdf } = await import("../src/lib/demo-document-pdf.ts");
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
const lenderBrokerage = randomUUID();
const lenderInbox = randomUUID();
const webhookToken = randomBytes(32).toString("base64url");
// This entry point exists only in the local fixture so it can simulate a lost wake.
const fixtureScript = `
import worker, { OrbitWorkspace } from "./index.js";
export default worker;
export class WorkingDayWorkspace extends OrbitWorkspace {
  async checkpointFixture(staff,revision){try{return JSON.stringify(await this.captureWorkspaceCheckpoint(staff,revision,false));}catch(error){return JSON.stringify({error:String(error),stack:error.stack});}}
  loseNextReplayReply(){this.loseReplayReply=true;}
  async applyWorkspaceRecoveryReplay(...args){const result=await super.applyWorkspaceRecoveryReplay(...args);if(this.loseReplayReply){this.loseReplayReply=false;throw new Error("Fictional lost replay reply");}return result;}
  restoreDeadlineFixture(editId){
    const row=this.ctx.storage.sql.exec("SELECT beforeState FROM recovery_edit_proofs WHERE id=?",editId).one();
    const before=JSON.parse(row.beforeState);
    this.ctx.storage.transactionSync(()=>{
      this.ctx.storage.sql.exec("UPDATE document_requests SET revision=?,deadlineRevision=?,dueOn=?,status=? WHERE id=?",before.revision,before.deadlineRevision,before.dueOn,before.status,before.id);
      this.ctx.storage.sql.exec("DELETE FROM recovery_edit_proofs WHERE id=?",editId);
    });
  }
  restoreClosingItemFixture(editId){
    const row=this.ctx.storage.sql.exec("SELECT beforeState FROM recovery_edit_proofs WHERE id=?",editId).one();
    const before=JSON.parse(row.beforeState);
    this.ctx.storage.transactionSync(()=>{
      this.ctx.storage.sql.exec("UPDATE closing_items SET revision=?,completedAt=? WHERE id=?",before.revision,before.completedAt,before.id);
      this.ctx.storage.sql.exec("DELETE FROM recovery_edit_proofs WHERE id=?",editId);
    });
  }
  advanceClosingItemFixture(itemId){this.ctx.storage.sql.exec("UPDATE closing_items SET revision=revision+1 WHERE id=?",itemId);}
  loseNextRecoveryConfirmation() {this.loseRecoveryConfirmation=true;}
  finishWorkspaceRecoveryEdit(...args) {if(this.loseRecoveryConfirmation){this.loseRecoveryConfirmation=false;throw new Error("Fictional lost receipt confirmation");}return super.finishWorkspaceRecoveryEdit(...args);}
  async recoveryFixtureCounts(loanId) {return JSON.stringify({proofs:this.ctx.storage.sql.exec("SELECT count(*) AS n FROM recovery_edit_proofs").one().n,
    activity:this.ctx.storage.sql.exec("SELECT count(*) AS n FROM activity WHERE loanId=?",loanId).one().n});}
  holdOwnerLookup() {this.ownerLookupEntered=false;this.ownerLookupHold=new Promise(resolve=>{this.releaseOwner=resolve;});}
  ownerLookupWaiting() {return this.ownerLookupEntered;}
  releaseOwnerLookup() {this.releaseOwner?.();this.ownerLookupHold=null;}
  async leadOwner(...args) {if(this.ownerLookupHold){this.ownerLookupEntered=true;await this.ownerLookupHold;}return super.leadOwner(...args);}
  restartMaintenanceFixture() { this.ctx.abort("Fictional maintenance restart"); }
  holdStaffAccess() {
    this.staffAccessEntered=false;
    this.staffAccessHold=new Promise(resolve=>{this.releaseStaffAccess=resolve;});
  }
  staffAccessWaiting() {return this.staffAccessEntered;}
  unholdStaffAccess() {this.releaseStaffAccess?.();this.staffAccessHold=null;}
  async staffSessionAccess(...args) {
    if(this.staffAccessHold){this.staffAccessEntered=true;await this.staffAccessHold;}
    return super.staffSessionAccess(...args);
  }
  async directoryPauseAlarmProbe() {
    const prior = await this.ctx.storage.getAlarm();
    try {
      await this.alarm();
      return await this.ctx.storage.getAlarm();
    } finally {
      if (prior === null) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(prior);
    }
  }
  async rejectedMaintenanceAlarm() {
    try {await this.alarm();return "Unexpectedly allowed";}catch(error){return error.message;}
  }
  async rejectedPeerCall(id,kind,input,staff) {
    const peer=this.env.WORKSPACE.getByName(id);
    try {
      if(kind==="read")await peer.read(staff);
      else if(kind==="write")await peer.write(input,staff);
      else if(kind==="alarm")return peer.rejectedMaintenanceAlarm();
      else throw new Error("Unknown fixture call");
    }catch(error){return error.message;}
    return "Unexpectedly allowed";
  }
  deliveryAttemptFixtureDate(destinationId, eventId, at) {
    const sql = this.ctx.storage.sql;
    const earlier = minutes => new Date(Date.parse(at) - minutes * 60_000).toISOString();
    this.ctx.storage.transactionSync(() => {
      sql.exec("UPDATE automation_events SET occurredAt=? WHERE id=?", earlier(7), eventId);
      sql.exec("UPDATE automation_destination_attempts SET at=CASE WHEN attempt=1 THEN ? ELSE ? END WHERE destinationId=? AND eventSequence=" +
        "(SELECT sequence FROM automation_events WHERE id=?)", earlier(6), at, destinationId, eventId);
    });
  }
  dispositionFixtureDates(loanId,fundingDate,dispositionDate) {
    const sql=this.ctx.storage.sql;
    if(fundingDate) {
      sql.exec("UPDATE loans SET stage='Funded' WHERE id=?",loanId);
      sql.exec("INSERT INTO closing_progress (loanId,fundingDate) VALUES (?,?)",loanId,fundingDate);
    } else {
      sql.exec("UPDATE loans SET dispositionDate=? WHERE id=?",dispositionDate,loanId);
    }
  }
  dispositionFixtureDate(loanId) {
    return this.ctx.storage.sql.exec("SELECT dispositionDate FROM loans WHERE id=?",loanId).one().dispositionDate;
  }
  lostImportResponse(loanId, operationId, requestId, transactionId, email, at) {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec("INSERT INTO uwm_operations (id,loanId,applicationRevision,environment,kind,requestDigest,actor,state,transactionId,startedAt,updatedAt) " +
        "VALUES (?,?,1,'production','import',?,?,'Unknown',?,?,?)",
        operationId,loanId,"a".repeat(64),email,transactionId,at,at);
      sql.exec("INSERT INTO uwm_import_checks(operationId,scan,ready,committed) VALUES (?,'{}',1,1)",operationId);
      sql.exec("INSERT INTO uwm_live_requests VALUES (?,?,'production',?,'commit-import',?,'Unknown',NULL,?,?)",
        requestId,loanId,email,"b".repeat(64),at,at);
      sql.exec("INSERT INTO uwm_request_evidence VALUES (?,1,?)",requestId,JSON.stringify({importId:operationId}));
    });
  }
  setImportCommitFixture(operationId, committed) {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE uwm_operations SET state=? WHERE id=?",committed ? "Unknown" : "Prepared",operationId);
      this.ctx.storage.sql.exec("UPDATE uwm_import_checks SET committed=? WHERE operationId=?",Number(committed),operationId);
    });
  }
  interruptNextImportCompletion() { this.interruptImportCompletion = true; }
  async completeUwmImportReceipt(...args) {
    if (this.interruptImportCompletion) {
      this.interruptImportCompletion = false;
      throw new Error("Fictional interrupted completion");
    }
    return super.completeUwmImportReceipt(...args);
  }
  removeMatchedReceiptFixture(id) {
    const result = this.ctx.storage.sql.exec("DELETE FROM uwm_webhook_receipts WHERE id=? AND kind='conditions'", id);
    if (result.rowsWritten !== 1) throw new Error("Expected one fictional matched condition to remove");
  }
  matchedReceiptIdFixture(id) {
    return this.ctx.storage.sql.exec("SELECT destinationReceiptId FROM uwm_receipt_matches WHERE receiptId=?",id).one().destinationReceiptId;
  }
  loseNextMatchedReceipt() { this.loseMatchedReceipt = true; }
  async storeMatchedUwmReceipt(...args) {
    const receipt = await super.storeMatchedUwmReceipt(...args);
    if (this.loseMatchedReceipt) {
      this.loseMatchedReceipt = false;
      throw new Error("Fictional lost match response");
    }
    return receipt;
  }
  retentionFixtureFile(requestId,objectId) {
    this.ctx.storage.sql.exec("INSERT INTO document_files (requestId,objectId,attemptedAt) VALUES (?,?,0) ON CONFLICT(requestId) DO UPDATE SET objectId=excluded.objectId",requestId,objectId);
  }
  async missReminderAlarm() {
    const storage = this.ctx.storage;
    await storage.deleteAlarm();
    storage.sql.exec("UPDATE document_reminder_schedule SET nextAt = ? WHERE id = 1", Date.now() - 1000);
  }
}`;
const {directoryEvidencePath}=await import("../src/lib/directory-evidence.ts");
const {directoryDrainObject,directoryDrainPath}=await import("../src/lib/directory-drain.ts");
const { directoryPauseKey } = await import("../src/lib/directory-traffic-pause.ts");
const runtime = new Miniflare({ ...convertV4MiniflareOptions({
  name: "orbit-working-day", host: "127.0.0.1",
  modules: [{ type: "ESModule", path: join(server, "working-day-entry.mjs"), contents: fixtureScript },
    ...(await readdir(server, { recursive: true, withFileTypes: true }))
      .filter((file) => file.isFile() && /\.m?js$/.test(file.name))
      .map((file) => ({ type: "ESModule", path: join(file.parentPath, file.name) }))],
  modulesRoot: server, compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { ORBIT_AUTH_MODE: "google", GOOGLE_CLIENT_ID: "local-fixture", GOOGLE_CLIENT_SECRET: "local-fixture",
    ORBIT_STAFF_EMAILS: owner.email, ORBIT_DOCUMENT_UPLOADS: "mock", ORBIT_PRICING_MODE: "mock", ORBIT_DEPLOYMENT: "production",
    UWM_USER_ENVIRONMENT: "production", UWM_USER_CLIENT_ID: "local-fixture", UWM_USER_CLIENT_SECRET: "local-fixture",
    UWM_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
    UWM_WEBHOOK_CONFIG: JSON.stringify({ production: { brokerageId: lenderInbox, token: webhookToken } }) },
  serviceBindings: { ASSETS: async request => {
    if(!process.argv.includes("--preview"))return new Response(null,{status:404});
    const root=resolve(server,"../client"),pathname=new URL(request.url).pathname;
    const path=resolve(root,"."+decodeURIComponent(pathname));
    if(relative(root,path).startsWith(".."))return new Response(null,{status:404});
    try{return new Response(await readFile(path),{headers:{"Content-Type":({".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".svg":"image/svg+xml"})[extname(path)]??"application/octet-stream"}});}
    catch{return new Response(null,{status:404});}
  } },
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
  async function action(staff, name, input, scope, expectedBrokerage = brokerage, routeBrokerage = brokerage) {
    countRequest(staff.role);
    const response = await runtime.dispatchFetch(`${origin}/workspace?brokerage=${routeBrokerage}`, {
      method: "POST", headers: { Origin: origin, "Next-Action": actions[name], Accept: "text/x-component",
        "Content-Type": "text/plain;charset=UTF-8", Cookie: `__Host-orbit-session=${staff.token}` },
      body: JSON.stringify(scope ? [input, expectedBrokerage, scope] : [input, expectedBrokerage]),
    });
    assert.equal(response.status, 200, name);
    return readActionResult(response, name);
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
  const sidebar = (staff) => action(staff, "readSidebarActionCounts", brokerage);
  const fileExceptions = (filter, staff = owner, expected = brokerage) =>
    action(staff, "readManagerFileExceptions", { filter }, undefined, expected);
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
    assert.deepEqual(reviewed.migration.rows.filter(({ status }) => status === "Review").map(({ detail }) => detail), []);
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

  await stage("Invited staff enter, recover from revoked access and reactivate without exposing a workspace", async () => {
    const newcomer = actor("Fictional Entry Officer", "entry-officer@example.test", "LO");
    await team(owner, { type: "invite", email: newcomer.email, role: newcomer.role });
    await directory.createStaffSession(createHash("sha256").update(newcomer.token).digest("base64url"),
      { email: newcomer.email, name: newcomer.name }, now + 3_600_000, now);
    const entry = () => runtime.dispatchFetch(`${origin}/workspace?brokerage=${brokerage}&guide=campaign`,
      { headers: { Cookie: `__Host-orbit-session=${newcomer.token}` }, redirect: "manual" });
    const invited = await entry();
    assert.equal(invited.status, 303);
    assert.equal(invited.headers.get("location"), `/login?brokerage=${brokerage}&guide=campaign`);
    await directory.activateStaff({ email: newcomer.email, name: newcomer.name }, [owner.email]);
    assert.equal((await entry()).status, 200);
    await team(owner, { type: "revoke", email: newcomer.email });
    const denied = await entry();
    assert.equal(denied.status, 403);
    const html = await denied.text();
    assert.match(html, /Workspace access unavailable/);
    assert.match(html, /href="\/workspace"/);
    assert.doesNotMatch(html, /Fictional Working Day/);
    const api = await runtime.dispatchFetch(`${origin}/api/brokerages?brokerage=${brokerage}`,
      { headers: { Cookie: `__Host-orbit-session=${newcomer.token}` }, redirect: "manual" });
    assert.notEqual(api.status, 200);
    await team(owner, { type: "invite", email: newcomer.email, role: "Processor" });
    assert.equal((await entry()).status, 303);
    await directory.activateStaff({ email: newcomer.email, name: newcomer.name }, [owner.email]);
    assert.equal((await entry()).status, 200);
    const current = await directory.staffSessionAccess(createHash("sha256").update(newcomer.token).digest("base64url"), now, [owner.email]);
    assert.equal(current.brokerages.find(({ id }) => id === brokerage).role, "Processor");
  });

  const browse = (actor, path, choice = "", { headers, method = "GET" } = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}${path}`, { method, headers: {
      Cookie: [`__Host-orbit-session=${actor.token}`, choice].filter(Boolean).join("; "),
      Accept: "text/html", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-User": "?1", ...headers,
    } }, async (response) => {
      try {
        const body = await Array.fromAsync(response);
        resolve({ status: response.statusCode, headers: new Headers(response.headers), text: () => Buffer.concat(body).toString() });
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
    request.end();
  });

  await stage("The account keeps its selected workspace across browser sessions and handles lost access explicitly", async () => {
    const operational = randomUUID();
    const result = await directory.manage({ email: owner.email, name: owner.name, brokerage: { id: "orbit-demo" } },
      [owner.email], { type: "create", id: operational, name: "Fictional Operational Entry", pilot: false });
    assert.equal(result.created, operational, result.error);
    const entryOfficer = actor("Fictional Returning Officer", "returning-officer@example.test", "LO");
    for (const id of [brokerage, operational]) {
      await post(`/api/brokerages?brokerage=${id}`, { type: "invite", email: entryOfficer.email, role: entryOfficer.role }, owner);
    }
    await signIn(entryOfficer);
    const scoped = (id) => `/workspace?brokerage=${id}`;
    const accountHash = createHash("sha256").update(entryOfficer.email).digest("base64url");
    const legacy = `__Host-orbit-workspace=${accountHash}.${brokerage}`;
    const firstOfficer = actor("Fictional First Entry Officer", "first-entry-officer@example.test", "LO");
    for (const id of [brokerage, operational]) {
      await post(`/api/brokerages?brokerage=${id}`, { type: "invite", email: firstOfficer.email, role: firstOfficer.role }, owner);
    }
    await signIn(firstOfficer);
    const firstHash = createHash("sha256").update(firstOfficer.token).digest("base64url");
    const firstAccess = () => directory.staffSessionAccess(firstHash, Date.now(), [owner.email]);
    const prefetch = await browse(firstOfficer, "/workspace", "", { headers: { "Sec-Purpose": "prefetch" } });
    assert.equal(prefetch.headers.get("set-cookie"), null);
    assert.equal((await firstAccess()).preferredWorkspace, null);
    assert.equal((await browse(firstOfficer, scoped(brokerage))).status, 200);
    assert.equal((await browse(firstOfficer, scoped(brokerage) + "&guide=1")).status, 200);
    assert.equal((await firstAccess()).preferredWorkspace, null);
    const initial = await browse(firstOfficer, "/workspace", "", { headers: { "Sec-Fetch-User": "", "Sec-Fetch-Site": "cross-site" } });
    assert.equal(initial.headers.get("location"), scoped(operational));
    assert.equal((await firstAccess()).preferredWorkspace, operational);
    const firstNewSession = { ...firstOfficer, token: randomBytes(32).toString("base64url") };
    await signIn(firstNewSession);
    assert.equal((await browse(firstNewSession, "/workspace")).headers.get("location"), scoped(operational));
    assert.equal((await browse(entryOfficer, "/workspace", legacy)).headers.get("location"), scoped(brokerage));
    assert.equal((await browse(entryOfficer, "/workspace")).headers.get("location"), scoped(brokerage));
    const selected = await browse(entryOfficer, scoped(brokerage) + "&default=1");
    assert.equal(selected.status, 303);
    assert.equal(selected.headers.get("location"), scoped(brokerage));
    const saved = selected.headers.get("set-cookie");
    assert.match(saved, /__Host-orbit-workspace-[\w-]+=.*HttpOnly; Secure; SameSite=Lax/);
    const choice = saved.split(";", 1)[0];
    assert.equal((await browse(entryOfficer, "/workspace", choice)).headers.get("location"), scoped(brokerage));
    assert.equal((await browse(entryOfficer, scoped(operational), choice)).headers.get("set-cookie"), null);
    assert.equal((await browse(entryOfficer, "/workspace")).headers.get("location"), scoped(brokerage));
    const ownerEntry = await browse(owner, "/workspace", choice);
    assert.equal(ownerEntry.headers.get("location"), scoped(operational));
    const ownerChoice = ownerEntry.headers.get("set-cookie").split(";", 1)[0];
    assert.notEqual(ownerChoice.split("=")[0], choice.split("=")[0]);
    const browserChoices = [choice, ownerChoice].join("; ");
    assert.equal((await browse(entryOfficer, "/workspace", browserChoices)).headers.get("location"), scoped(brokerage));
    assert.equal((await browse(owner, "/workspace", browserChoices)).headers.get("location"), scoped(operational));
    for (const options of [{ method: "HEAD" }, { headers: { "Sec-Purpose": "prefetch" } },
      { headers: { "Sec-Fetch-User": "" } }, { headers: { "Sec-Fetch-Site": "cross-site" } }]) {
      assert.equal((await browse(entryOfficer, scoped(operational) + "&switch=1", choice, options)).headers.get("set-cookie"), null);
    }
    assert.equal((await browse(entryOfficer, scoped(operational) + "&guide=campaign&switch=1", choice)).headers.get("set-cookie"), null);
    const other = await browse(entryOfficer, scoped(operational) + "&switch=1", choice);
    const switched = other.headers.get("set-cookie").split(";", 1)[0];
    assert.equal((await browse(entryOfficer, "/workspace", [switched, legacy].join("; "))).headers.get("location"), scoped(operational));
    assert.equal((await browse(entryOfficer, "/workspace", choice)).headers.get("location"), scoped(operational));
    const newSession = { ...entryOfficer, token: randomBytes(32).toString("base64url") };
    await signIn(newSession);
    assert.equal((await browse(newSession, "/workspace")).headers.get("location"), scoped(operational));
    assert.equal((await browse(entryOfficer, scoped(brokerage), switched)).status, 200);
    const legacySampleVisit = await browse(entryOfficer, scoped(brokerage) + "&switch=1", switched);
    assert.equal(legacySampleVisit.headers.get("location"), scoped(brokerage));
    assert.equal(legacySampleVisit.headers.get("set-cookie"), null);
    assert.equal((await browse(newSession, "/workspace")).headers.get("location"), scoped(operational));
    await post(`/api/brokerages?brokerage=${operational}`, { type: "revoke", email: entryOfficer.email }, owner);
    const denied = await browse(entryOfficer, "/workspace", switched);
    assert.equal(denied.status, 403);
    assert.match(await denied.text(), /last workspace you opened/);
    const recovered = await browse(entryOfficer, "/workspace?available=1", switched);
    assert.equal(recovered.headers.get("location"), scoped(brokerage));
    const recoveredChoice = recovered.headers.get("set-cookie").split(";", 1)[0];
    assert.equal((await browse(entryOfficer, "/workspace", recoveredChoice)).headers.get("location"), scoped(brokerage));
    assert.equal((await browse(newSession, "/workspace")).headers.get("location"), scoped(brokerage));
  });

  let sharedProcessor;
  await stage("A contract processor visits two workspaces without moving the default or mixing files", async () => {
    const alternate = randomUUID();
    const created = await directory.manage({ email: owner.email, name: owner.name, brokerage: { id: "orbit-demo" } },
      [owner.email], { type: "create", id: alternate, name: "Fictional Lakeshore Brokerage", pilot: false });
    assert.equal(created.created, alternate, created.error);
    const shared = actor("Fictional Contract Processor", "shared-processor@example.test", "Processor");
    const teamAt = (scope, input) => post(`/api/brokerages?brokerage=${scope}`, input, owner);
    for (const scope of [brokerage, alternate]) {
      await teamAt(scope, { type: "invite", email: shared.email, role: "Processor" });
    }
    await signIn(shared);
    const from = (scope, staff, name, input, expected = scope) => action(staff, name, input, undefined, expected, scope);
    const createLoan = async (scope, name) => {
      const result = await from(scope, owner, "mutate", { type: "loan", contactId: "", borrower: name,
        borrowerEmail: `${randomUUID()}@example.test`, address: "", amount: 250000, purpose: "Purchase",
        stage: "Processing", officer: owner.name, partnerId: null, start1003: true });
      assert.ok(result.loanWork?.loanId, result.error);
      return result.loanWork.loanId;
    };
    const primaryLoan = await createLoan(brokerage, "Fictional Shared Processor Primary");
    const otherLoan = await createLoan(alternate, "Fictional Shared Processor Alternate");
    const unassigned = await createLoan(alternate, "Fictional Unassigned Processor Loan");
    for (const [scope, loanId] of [[brokerage, primaryLoan], [alternate, otherLoan]]) {
      await teamAt(scope, { type: "assignProcessor", email: shared.email, loanId, revision: 0 });
      assert.equal((await from(scope, shared, "readLoanForWork", loanId)).loans[0].id, loanId);
      assert.ok((await from(scope, shared, "readProcessingWork", { readyOnly: false })).files.some(file => file.id === loanId));
    }
    assert.ok((await from(alternate, shared, "readLoanForWork", unassigned)).error);
    const fees = (scope, staff, loanId, data) => from(scope, staff, "saveProcessingView", { loanId, ...data });
    const primaryOffer = { type: "offerFeeTerms", requestId: randomUUID(), assignmentRevision: 1, expectedVersion: null,
      amountCents: 42550, reference: "Fictional primary processing agreement" };
    assert.equal((await fees(brokerage, owner, primaryLoan, primaryOffer)).message, "Fee terms v1 saved.");
    assert.deepEqual(await fees(brokerage, owner, primaryLoan, primaryOffer), { message: "Fee terms v1 saved." });
    const alternateOffer = { ...primaryOffer, requestId: randomUUID(), amountCents: 58000, reference: "Fictional alternate processing agreement" };
    assert.ok((await fees(alternate, owner, otherLoan, alternateOffer)).message);
    const accept = { type: "respondFeeTerms", version: 1, response: "Accepted" };
    assert.ok((await fees(brokerage, shared, primaryLoan, accept)).message);
    assert.equal((await fees(brokerage, shared, primaryLoan, { type: "readFeeTerms" })).agreed.amountCents, 42550);
    assert.equal((await fees(alternate, shared, otherLoan, { type: "readFeeTerms" })).current.amountCents, 58000);
    assert.ok((await fees(alternate, shared, primaryLoan, { type: "readFeeTerms" })).error);
    assert.ok((await fees(brokerage, shared, otherLoan, { type: "readFeeTerms" })).error);
    assert.ok((await fees(alternate, shared, otherLoan, { ...alternateOffer, requestId: randomUUID() })).error);
    assert.ok((await fees(brokerage, officer, primaryLoan, { type: "readFeeTerms" })).error);

    await teamAt(alternate, { type: "assignProcessor", email: shared.email, loanId: unassigned, revision: 0 });
    assert.ok((await fees(alternate, owner, unassigned, { ...alternateOffer, requestId: randomUUID() })).message);
    await teamAt(alternate, { type: "assignProcessor", email: null, loanId: unassigned, revision: 1 });
    assert.ok((await fees(alternate, shared, unassigned, { type: "readFeeTerms" })).error);
    assert.equal((await fees(alternate, owner, unassigned, { type: "readFeeTerms" })).history[0].endedReason, "Assignment ended");
    assert.equal((await fees(brokerage, shared, primaryLoan, { type: "readFeeTerms" })).agreed.amountCents, 42550);
    const pendingFees = (scope, staff) => from(scope, staff, "readProcessingWork", { readyOnly: false, feeOffers: {} });
    const renewed = { ...primaryOffer, requestId: randomUUID(), expectedVersion: 1, amountCents: 48500, reference: "Fictional primary fee amendment" };
    assert.ok((await fees(brokerage, owner, primaryLoan, renewed)).message);
    const mine = await pendingFees(brokerage, shared);
    assert.deepEqual(mine.feeOffers.rows.map(({ loanId, version }) => ({ loanId, version })), [{ loanId: primaryLoan, version: 2 }]);
    assert.equal(mine.feeOffers.count, 1);
    assert.equal((await pendingFees(alternate, shared)).feeOffers.rows[0].loanId, otherLoan);
    assert.equal((await pendingFees(alternate, owner)).feeOffers.count, 1);
    assert.ok((await pendingFees(brokerage, officer)).error);
    const previous = await fees(brokerage, shared, primaryLoan, { type: "readFeeTerms", selectedVersion: 1 });
    assert.equal(previous.selected.amountCents, 42550);
    assert.equal(previous.current.version, 2);
    assert.ok((await from(alternate, shared, "readLoanForWork", primaryLoan)).error);
    assert.ok((await from(brokerage, shared, "readLoanForWork", otherLoan)).error);
    assert.ok((await from(brokerage, shared, "readLoanForWork", otherLoan, alternate)).error);
    const finance = { type: "list", from: shiftReportDate(today, -1), through: today, view: "Funded", owner: "" };
    assert.equal((await from(brokerage, owner, "accessBrokerageFinance", finance)).error, undefined);
    assert.match((await from(brokerage, shared, "accessBrokerageFinance", finance)).error, /workspace owner/);
    const request = await from(alternate, shared, "mutate", { type: "requestDocument", loanId: otherLoan,
      kind: "Pay stub", instructions: "Fictional shared processor alternate evidence." });
    assert.ok(request.message, request.error);
    assert.ok((await from(alternate, shared, "readLoanForWork", otherLoan)).documentRequests.some(item => item.kind === "Pay stub"));
    const saved = `/workspace?brokerage=${brokerage}`;
    const visit = `/workspace?brokerage=${alternate}`;
    assert.equal((await browse(shared, saved + "&default=1")).headers.get("location"), saved);
    assert.equal((await browse(shared, visit)).headers.get("set-cookie"), null);
    assert.equal((await browse(shared, "/workspace")).headers.get("location"), saved);
    sharedProcessor = { staff: shared, alternate, primaryLoan, otherLoan };
  });

  await stage("The owner scorecard is scoped through the deployed action", async () => {
    const filters = { from: shiftReportDate(today, -7), through: today, owner: "" };
    const summary = await action(owner, "readOwnerReport", { kind: "summary", ...filters });
    assert.equal(summary.kind, "summary", summary.error);
    assert.equal(summary.sales.periods.selected.leads, 0);
    assert.equal(summary.funding.actual.count, 0);
    assert.ok((await action(officer, "readOwnerReport", { kind: "summary", ...filters })).error);
    assert.ok((await action(owner, "readOwnerReport", { kind: "summary", ...filters }, undefined, randomUUID())).error);
    const settings = { type: "saveView", id: randomUUID(), name: "Working day", filters };
    assert.ok((await action(owner, "saveOwnerReportView", settings)).message);
    assert.deepEqual((await action(owner, "readOwnerReport", { kind: "summary", ...filters })).views,
      [{ id: settings.id, name: settings.name, filters }]);
  });

  await stage("Two fictional brokerages reconcile CRM permissions and resume imported processing work", async () => {
    const [sending, receiving] = [randomUUID(), randomUUID()];
    for (const [id, name] of [[sending, "Fictional CRM Source"], [receiving, "Fictional CRM Destination"]]) {
      const created = await directory.manage({ email: owner.email, name: owner.name, brokerage: { id: "orbit-demo" } },
        [owner.email], { type: "create", id, name, pilot: true });
      assert.equal(created.created, id, created.error);
      for (const member of [officer, processor]) {
        await post(`/api/brokerages?brokerage=${id}`, { type: "invite", email: member.email, role: member.role }, owner);
      }
    }
    await directory.activateStaff({ name: officer.name, email: officer.email }, [owner.email]);
    await directory.activateStaff({ name: processor.name, email: processor.email }, [owner.email]);
    const inBrokerage = (id, actor, name, input, scope) => action(actor, name, input, scope, id, id);
    const change = (id, input) => inBrokerage(id, owner, "mutate", input, "migration");
    const parse = (csv) => {
      const file = migrationFile(csv);
      return { rows: mappedMigrationRows(file, file.mapping), origin: file.orbitSource, batch: file.batch };
    };
    const source = "fictional-salesforce-brokerage";
    const crm = parse([
      "Object,Id,Related Id,Full Name,Email,Phone,Role,Owner Email,Purpose,Source,Created Date,Due Date,Subject,Parent Type,Realtor Id,DoNotCall,HasOptedOutOfEmail,Text Opt Out,Opted Out",
      "Contact,ARIVE-C,,Fictional Arive Buyer,cutover-arive@example.test,2025550161,Borrower,,,,,,,,,true,false,false,",
      "Contact,LP-C,,Fictional LendingPad Buyer,cutover-lp@example.test,2025550162,Borrower,,,,,,,,,false,true,false,",
      "Contact,R-C,,Fictional Cutover Realtor,cutover-realtor@example.test,,Realtor,,,,,,,,,,,,",
      "Contact,STOP-C,,Fictional Suppressed Buyer,cutover-stop@example.test,2025550163,Borrower,,,,,,,,,,,,Yes",
      `Lead,LP-L,LP-C,Fictional LendingPad Buyer,cutover-lp@example.test,2025550162,,former-lo@example.test,Refinance,Realtor referral,${dueAt},${dueAt},,,R-C,false,false,1,`,
      `Task,T-1,LP-L,,,,,,,,${dueAt},${dueAt},Confirm the fictional refinance documents,Lead,,,,,`,
    ].join("\n"));
    const input = { type: "migratePipeline", ...crm, origin: source, decisions: {} };
    const first = await change(sending, input);
    assert.equal(first.migration.ownership.missing[0].email, "former-lo@example.test");
    assert.ok(first.migration.rows.some(({ status }) => status === "Review"));
    const mapped = { ...input, ownerMappings: { "former-lo@example.test": officer.email } };
    const apply = async (id, data) => {
      const preview = await change(id, data);
      assert.ok(preview.migration, preview.error);
      assert.ok(preview.migration.rows.every(({ status }) => status !== "Review"), JSON.stringify(preview.migration.rows));
      const saved = await change(id, { ...data, preview: preview.migration.fingerprint });
      assert.ok(saved.migration, saved.error);
      return saved.migration;
    };
    const saved = await apply(sending, mapped);
    const sourceIds = new Map(saved.rows.map(({ key, targetId }) => [key, targetId]));
    const readLead = (id, actor, leadId) => inBrokerage(id, actor, "readInboxWork", { type: "open", id: leadId });
    const assertLead = (lead) => {
      assert.equal(lead.officerEmail, officer.email);
      assert.equal(lead.outreachChannelBlocks, 6);
      assert.equal(lead.importedTasks[0].title, "Confirm the fictional refinance documents");
      assert.equal(lead.importedTasks[0].dueAt, dueAt);
    };
    assertLead((await readLead(sending, officer, sourceIds.get("Lead:LP-L"))).lead);
    assert.ok((await readLead(receiving, officer, sourceIds.get("Lead:LP-L"))).error);
    assert.ok((await inBrokerage(sending, officer, "readPipelineExport", sending)).error);
    const snapshot = await inBrokerage(sending, owner, "readPipelineExport", sending);
    assert.equal(snapshot.total, 6);
    const numbered = parse(snapshot.batches[0].csv);
    const transfer = { type: "migratePipeline", ...numbered, decisions: {} };
    const received = await apply(receiving, transfer);
    const destinationIds = new Map(received.rows.map(({ key, targetId }) => [key, targetId]));
    const leadId = destinationIds.get(`Lead:${sourceIds.get("Lead:LP-L")}`);
    assertLead((await readLead(receiving, officer, leadId)).lead);
    assert.notEqual(leadId, sourceIds.get("Lead:LP-L"));
    const receivingExport = await inBrokerage(receiving, owner, "readPipelineExport", receiving);
    assert.equal(parse(receivingExport.batches[0].csv).rows.find(({ email }) => email === "cutover-stop@example.test").optedOut, "Yes");
    const cutover = await action(owner, "readCutoverChecklist", receiving, undefined, numbered.origin, receiving);
    assert.equal(cutover.evidence.batch.received, 1);
    assert.equal(cutover.evidence.links, snapshot.total);

    for (const [external, lastName, purpose, street, amount] of [
      ["ARIVE-C", "Arive Buyer", "Purchase", "65 Fictional Oak Road", "325000"],
      ["LP-C", "LendingPad Buyer", "Refinance", "86 Fictional Maple Road", "265000"],
    ]) {
      const existingContactId = destinationIds.get(`Contact:${sourceIds.get(`Contact:${external}`)}`);
      const fields = { firstName: "Fictional", lastName, amount, purpose, occupancy: "Primary residence",
        street, unit: "", city: "Royal Oak", state: "MI", zip: "48067" };
      const request = { type: "importMismo", requestId: randomUUID(), fields, existingContactId, fictional: true, extraBorrowers: 0 };
      const imported = await change(receiving, request);
      assert.ok(imported.applicationLoanId, imported.error);
      assert.equal((await change(receiving, request)).applicationLoanId, imported.applicationLoanId);
      const result = await inBrokerage(receiving, owner, "readLoanForWork", imported.applicationLoanId);
      assert.equal(result.loans[0].contactId, existingContactId);
      assert.equal(result.loans[0].purpose, purpose);
      assert.equal(result.loans[0].amount, Number(amount));
      assert.equal(result.applications[0].submittedAt, null);
      assert.ok((await inBrokerage(sending, owner, "readLoanForWork", imported.applicationLoanId)).error);
      if (external !== "ARIVE-C") continue;

      const loanId = imported.applicationLoanId;
      const query = { loanId, origin: numbered.origin, basis: cutover.evidence.basis };
      const inventory = (actor = owner, id = receiving) => action(actor, "readCutoverFileInventory", id, undefined, query, id);
      const sourceInventory = { version: 1, documents: [
        { kind: "Photo ID", instructions: "Provide the fictional sample identification.", status: "Requested", dueOn: today },
        { kind: "Bank statement", instructions: "Historical file held at the source.", status: "Accepted", dueOn: null },
      ], lenderFiles: [
        { lender: "Example Wholesale", reference: "CUTOVER-FICTIONAL-01", status: "In underwriting", conditions: [
          { category: "Income", description: "Verify the fictional income statement.", status: "Open" },
          { category: "Assets", description: "Previous delivery recorded in the source.", status: "Delivered" },
        ] },
        { lender: "UWM", reference: "CUTOVER-FICTIONAL-UWM", status: "In underwriting", conditions: [
          { category: "Identity", description: "Open in the source lender portal.", status: "Open" },
        ] },
      ] };
      const savedInventory = await action(owner, "saveCutoverFileInventory", receiving, undefined,
        { ...query, revision: 0, source: sourceInventory, fictional: true }, receiving);
      assert.equal(savedInventory.message, "Source inventory saved.");
      const before = (await inventory()).openWork;
      assert.deepEqual([before.documents, before.conditions, before.review], [1, 1, 4]);
      assert.equal(before.processor, null);
      const assign = (input) => post(`/api/brokerages?brokerage=${receiving}`, { loanId, ...input }, owner);
      assert.ok((await assign({ type: "assign", previousEmail: owner.email, email: officer.email })).message);
      const requestId = randomUUID();
      const processorChange = { type: "assignProcessor", email: processor.email, revision: 0, requestId };
      const receipt = (actor, scope) => readTeam(actor, { view: "processor-assignment-receipt", loanId, requestId }, scope);
      assert.deepEqual(await (await receipt(owner, receiving)).json(), { outcome: "missing" });
      assert.ok((await assign(processorChange)).message);
      assert.deepEqual(await (await receipt(owner, receiving)).json(), { outcome: "saved" });
      assert.equal((await assign(processorChange)).message, "Processor access confirmed.");
      assert.equal((await receipt(officer, receiving)).status, 403);
      assert.equal((await receipt(processor, receiving)).status, 403);
      assert.deepEqual(await (await receipt(owner, sending)).json(), { outcome: "missing" });
      const prepared = { type: "restoreCutoverWork", ...query, preview: before.fingerprint };
      assert.match((await change(receiving, prepared)).error, /preview changed/);
      const updated = (await inventory()).openWork;
      assert.equal(updated.owner, officer.name);
      assert.equal(updated.processor, processor.name);
      const restore = { ...prepared, preview: updated.fingerprint };
      assert.ok((await inventory(officer)).error);
      assert.ok((await inventory(owner, sending)).error);
      assert.ok((await inBrokerage(receiving, officer, "mutate", restore, "migration")).error);
      assert.ok((await change(sending, restore)).error);
      const retries = await Promise.all([change(receiving, restore), change(receiving, restore)]);
      assert.equal(retries.filter((reply) => reply.migrationChanged).length, 1);
      assert.equal(retries.find((reply) => reply.migrationChanged)?.message, "Restored open work · 1 document request · 1 lender condition.");
      assert.match(retries.find((reply) => reply.error)?.error, /preview changed/);
      const resumed = await inBrokerage(receiving, officer, "readLoanForWork", loanId);
      assert.equal(resumed.loans[0].stage, "Lead");
      assert.equal(resumed.applications[0].submittedAt, null);
      assert.equal(resumed.submissions.length, 1);
      assert.equal(resumed.documentRequests.length, 1);
      assert.equal(resumed.documentRequests[0].dueOn, today);
      assert.equal(resumed.documentRequests[0].status, "Requested");
      const [lenderFile] = resumed.submissions;
      const [condition] = lenderFile.conditions;
      assert.equal(lenderFile.syncedAt, null);
      assert.equal(lenderFile.status, "In underwriting");
      assert.equal(lenderFile.conditions.length, 1);
      assert.equal(condition.manual.owner, processor.name);
      assert.equal(condition.satisfiedAt, null);
      const followUp = (actor, input) => inBrokerage(receiving, actor, "mutate", { loanId, ...input });
      assert.ok((await followUp(officer, { type: "move", id: loanId, stage: "Processing" })).message);
      const processorFile = await inBrokerage(receiving, processor, "readLoanForWork", loanId);
      assert.equal(processorFile.loans[0].stage, "Processing");
      assert.equal(processorFile.submissions[0].conditions[0].id, condition.id);
      const queue = () => inBrokerage(receiving, processor, "readProcessingWork", { readyOnly: false });
      const queueCondition = (await queue()).files.find(({ id }) => id === loanId)?.condition;
      assert.equal(queueCondition?.action, "Review lender request");
      assert.ok(queueCondition.target.includes(condition.id));
      const requestDocument = await followUp(processor, { type: "requestDocument", kind: "Pay stub", instructions: condition.description,
        condition: { submissionId: lenderFile.id, conditionId: condition.id } });
      assert.ok(requestDocument.message, requestDocument.error);
      const continued = await inBrokerage(receiving, processor, "readLoanForWork", loanId);
      assert.ok(continued.documentRequests.some((document) => document.conditionId === condition.id && document.status === "Requested"));
      assert.equal((await queue()).files.find(({ id }) => id === loanId)?.condition?.action, "Follow up on borrower document");
      const audit = await followUp(officer, { type: "loadLoanAudit" });
      assert.equal(audit.loanAudit.filter(({ action: label }) => label === "Restored fictional open work from cutover").length, 1);
      const remaining = (await inventory()).openWork;
      assert.deepEqual([remaining.documents, remaining.conditions, remaining.review], [0, 0, 4]);

      const token = resumed.applications[0].token;
      const initial = await borrower(token, { type: "read" });
      const step = applicationSteps.length - 1;
      const submitted = await borrower(token, { type: "submit", revision: initial.revision, step,
        draft: { ...sampleApplication(initial.draft), confirmedDemo: true } });
      assert.ok(submitted.submittedAt, submitted.error);
      const replacement = await recordFictionalReplacement({
        read: () => inBrokerage(receiving, processor, "readLoanForWork", loanId), write: (input) => followUp(processor, input),
        borrower: (input) => borrower(token, input), submissionId: lenderFile.id, conditionId: condition.id,
      });
      const documentedSource = { version: 1, documents: [sourceInventory.documents[0], replacement.document],
        lenderFiles: [{ ...sourceInventory.lenderFiles[0], conditions: [replacement.condition] }] };
      const exportInventory = (actor, id, route = id) => action(actor, "downloadCutoverInventory", id, undefined, loanId, route);
      assert.ok((await exportInventory(officer, receiving)).error);
      assert.ok((await exportInventory(processor, receiving)).error);
      assert.ok((await exportInventory(owner, sending)).error);
      assert.ok((await exportInventory(owner, receiving, sending)).error);
      const exported = await exportInventory(owner, receiving);
      assert.ok(exported.json, exported.error);
      const snapshot = JSON.parse(exported.json);
      assert.equal(snapshot.version, 1);
      assert.deepEqual(snapshot.documents.find(({ kind }) => kind === replacement.document.kind), replacement.document);
      assert.deepEqual(snapshot.lenderFiles[0].conditions, [replacement.condition]);
      assert.deepEqual(snapshot.funding, { closingDate: null, fundingDate: null, fundedPrincipalCents: null,
        borrowerFollowUp: null, realtorFollowUp: null, borrowerCallback: null });
      assert.ok(!exported.json.includes(token));
      const wrongReceipt = structuredClone(documentedSource);
      wrongReceipt.lenderFiles[0].conditions[0].evidence.receipts[0].reference = "CUTOVER-UNAVAILABLE-RECEIPT";
      const saveSource = (source, revision) => action(owner, "saveCutoverFileInventory", receiving, undefined,
        { ...query, revision, source, fictional: true }, receiving);
      const reconcile = (item, fileFingerprint) => action(owner, "saveCutoverReview", receiving, undefined,
        { ...query, item, fileFingerprint, decision: "Reconciled", note: "Fictional origin evidence reviewed against the restored file.", revision: 0 }, receiving);
      assert.ok((await saveSource(wrongReceipt, 1)).message);
      const incomplete = await inventory();
      assert.equal(incomplete.lender.rows.find(({ status }) => status === "Missing").evidence.find(({ status }) => status === "Missing").label,
        "Receipt CUTOVER-UNAVAILABLE-RECEIPT");
      assert.match((await reconcile("lender", incomplete.lender.fingerprint)).error, /resolve missing file inventory/i);
      assert.ok((await saveSource(documentedSource, 2)).message);
      const reconciled = await inventory();
      assert.ok(reconciled.documents.rows.every(({ status }) => status === "Matched"));
      assert.ok(reconciled.lender.rows.every(({ status }) => status === "Matched"));
      assert.match((await reconcile("lender", incomplete.lender.fingerprint)).error, /comparison changed/i);
      assert.ok((await reconcile("documents", reconciled.documents.fingerprint)).message);
      assert.ok((await reconcile("lender", reconciled.lender.fingerprint)).message);
    }
    const finalCutover = await action(owner, "readCutoverChecklist", receiving, undefined, numbered.origin, receiving);
    assert.equal(finalCutover.evidence.draftCount, 2);
    assert.equal(finalCutover.evidence.readiness.counts["Needs review"], 2);
  });

  const reportingFixture = await stage("Quarter reviews keep the original CSV after corrections", async () => {
    const reportingBrokerage = randomUUID();
    const workspace = await directory.manage({ email: owner.email, name: owner.name, brokerage: { id: "orbit-demo" } },
      [owner.email], { type: "create", id: reportingBrokerage, name: "Fictional Reporting Review", pilot: true });
    assert.equal(workspace.created, reportingBrokerage, workspace.error);
    const inReporting = (name, input) => action(owner, name, input, undefined, reportingBrokerage, reportingBrokerage);
    const report = (input) => inReporting("accessReportingReadiness", input);
    const current = { year: Number(today.slice(0, 4)), quarter: Math.ceil(Number(today.slice(5, 7)) / 3) };
    const prior = priorQuarter(current);
    const created = await inReporting("mutate", { type: "loan", contactId: "", borrower: "Fictional Quarter Loan",
      borrowerEmail: "quarter@example.test", address: "", amount: 350000, purpose: "Purchase", stage: "Lead", officer: owner.name, partnerId: null });
    assert.ok(created.message, created.error);
    const loanId = created.loanWork.loanId;
    const facts = { ...emptyCallReportFacts, eligibility: "Include", state: "MI", originator: "123456",
      receivedDate: quarterRange(prior.year, prior.quarter).from, receivedAmount: 350000 };
    assert.ok((await inReporting("mutate", { type: "saveCallReport", loanId, revision: 0, facts })).message);
    const read = (period) => report({ type: "quarterReview", ...period });
    const request = (page, note = "") => ({ type: "saveQuarterReview", ...page.period, previousVersion: page.history[0]?.version ?? null,
      evidenceKey: page.comparison.key, requestId: randomUUID(), note });
    const download = (version) => report({ type: "downloadQuarterReview", ...current, version });
    assert.ok((await action(owner, "accessReportingReadiness", { type: "quarterReview", ...prior }, undefined, reportingBrokerage)).error);
    const baseline = await read(prior);
    assert.equal(baseline.kind, "quarterReview", baseline.error);
    assert.equal((await report(request(baseline, "Initial fictional baseline."))).review.version, 1);
    const matched = await read(current);
    assert.equal(matched.comparison.prior.version, 1);
    assert.deepEqual(matched.comparison.opening, { count: 1, amount: 350000 });
    assert.equal(matched.comparison.changeCount, 0);
    const firstRequest = request(matched);
    assert.equal((await report(firstRequest)).review.version, 1);
    if (prior.year === 2026) {
      const template = await report({ type: "fv7Template", ...prior, version: 1 });
      assert.equal(template.kind, "fv7Template", template.error);
      const evidence = JSON.parse(template.json);
      assert.equal(evidence.files[0].loanId, loanId);
      const preview = { type: "fv7Preview", ...prior, version: 1, evidence: template.json };
      assert.match((await report(preview)).error, /entityReference/);
      await assert.rejects(action(officer, "accessReportingReadiness", preview, undefined, reportingBrokerage, reportingBrokerage), /403 !== 200/);
      assert.ok((await action(owner, "accessReportingReadiness", preview, undefined, reportingBrokerage, brokerage)).error);
      Object.assign(evidence, { entityReference: "Fictional Michigan broker", adjustmentLedgerReference: "No fictional adjustments",
        amountChangeLedgerReference: "No fictional amount changes" });
      evidence.priorEnding.reference = "Fictional prior ending";
      for (const totals of Object.values(evidence.priorEnding.states[0]).filter(value => typeof value === "object")) {
        Object.assign(totals, { count: 0, amount: 0 });
      }
      Object.assign(evidence.files[0], { source: "direct", intakeReference: "Fictional application receipt",
        ending: { amount: 350000, reference: "Fictional quarter ending" } });
      const checked = await report({ ...preview, evidence: JSON.stringify(evidence) });
      assert.equal(checked.kind, "fv7Preview", checked.error);
      assert.deepEqual(checked.workpaper.states[0].direct.calculated.AC090, { count: 1, amount: 350000 });
      assert.ok(checked.workpaper.pipelineReconciled);
      const save = { ...preview, type: "fv7Save", evidence: JSON.stringify(evidence), checked: checked.checked };
      const saved = await report(save);
      assert.equal(saved.kind, "fv7Saved", saved.error);
      assert.deepEqual(await report(save), saved);
      assert.equal((await report({ type: "fv7History", ...prior })).items.length, 1);
      const readSaved = { type: "fv7Read", ...prior, sequence: saved.saved.sequence };
      assert.deepEqual(await report(readSaved), {
        kind: "fv7Read", saved: saved.saved, workpaper: checked.workpaper, evidence: save.evidence,
      });
      assert.ok((await action(owner, "accessReportingReadiness", readSaved, undefined, reportingBrokerage, brokerage)).error);
    }
    const original = await download(1);
    assert.equal(original.kind, "quarterReviewDownload", original.error);
    assert.ok(original.csv.includes("350000"));
    const stale = request(await read(current), "Old review.");
    assert.ok((await inReporting("mutate", { type: "saveCallReport", loanId, revision: 1,
      facts: { ...facts, state: "OH", receivedAmount: 355000 } })).message);
    assert.ok((await report(stale)).error);
    const corrected = await read(current);
    assert.deepEqual(corrected.comparison.differences.map(({ loanId, reasons }) => ({ loanId, reasons })),
      [{ loanId, reasons: ["State changed", "Amount changed"] }]);
    assert.equal((await report(request(corrected, "Reviewed the corrected state and amount."))).review.version, 2);
    assert.equal((await download(1)).csv, original.csv);
    assert.ok((await download(2)).csv.includes("355000"));
    if (prior.year === 2026) {
      const replaced = await read(prior);
      assert.equal((await report(request(replaced, "Fictional jurisdiction and amount correction."))).review.version, 2);
      const historical = await report({ type: "fv7Read", ...prior, sequence: 1 });
      assert.equal(historical.saved.version, 1);
      assert.equal(historical.workpaper.evidence.files[0].state, "MI");
      assert.equal(historical.workpaper.states[0].direct.calculated.AC090.amount, 350000);
    }
    return { brokerage: reportingBrokerage, period: prior, loanId };
  });

  await stage("The initial guide shows when its controls are ready", async () => {
    countRequest(owner.role);
    const response = await runtime.dispatchFetch(`${origin}/workspace?brokerage=${brokerage}&guide=campaign`, {
      headers: { Cookie: `__Host-orbit-session=${owner.token}` },
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(/<fieldset(?=[^>]*aria-label="Walkthrough controls")(?=[^>]*\bdisabled="")[^>]*>/.test(html),
      "The server-rendered walkthrough must keep its controls disabled until hydration");
    assert.ok(/<button(?=[^>]*aria-label="OrbitLOS home, brokerage overview")(?=[^>]*\bdisabled="")[^>]*>/.test(html),
      "Navigation must also wait until its handlers are ready");
    assert.ok(html.includes("Getting the walkthrough ready…"), "The guide must explain the short startup state");
  });

  const imported = { name: "Avery Working Day", email: "avery-working-day@example.test", phone: "248-555-0142" };
  const campaignId = randomUUID();
  const secondReview = { reviewerEmail: owner.email, dueDays: 2 };
  const checkpointPolicy = { secondReview, requireSecondReview: true };
  const campaignCallbackAt = new Date(now + 86_400_000).toISOString();
  const callbackPerformance = (staff = owner) => action(staff, "readCampaignCallbackPerformance", { campaignId });
  const campaignImportLeadIds = new Set();
  const leadId = await stage("Owner imports and routes CRM work", async () => {
    const ownerBefore = await sidebar(owner), officerBefore = await sidebar(officer);
    assert.equal(officerBefore.exceptions, undefined);
    assert.ok((await fileExceptions("All file exceptions", officer)).error);
    assert.ok((await fileExceptions("All file exceptions", processor)).error);
    assert.ok((await fileExceptions("All file exceptions", owner, randomUUID())).error);
    assert.deepEqual(await sidebar(processor), { processing: 0 });
    assert.ok((await action(processor, "readSidebarActionCounts", randomUUID())).error);
    assert.ok((await action(owner, "readSidebarActionCounts", randomUUID())).error);
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
    assert.equal((await sidebar(owner)).leads, ownerBefore.leads + 1);
    assert.equal((await sidebar(officer)).leads, officerBefore.leads);
    const firstContacts = { type: "list", view: "Needs first contact" };
    assert.ok((await action(owner, "readInboxWork", firstContacts)).leads.some((lead) => lead.id === id));
    assert.ok(!(await action(officer, "readInboxWork", firstContacts)).leads.some((lead) => lead.id === id));
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
    const campaignImport = await importRows(extra);
    for (const row of campaignImport.rows) campaignImportLeadIds.add(row.targetId);
    const replay = await write(owner, extra);
    assert.ok(replay.migration.rows.every(({ status }) => status === "Previously imported"));
    const current = await workspace(owner);
    const selected = current.inboxLeads.find(({ id: currentId }) => currentId === id);
    assert.equal(selected.officerEmail, officer.email);
    assert.equal((await sidebar(officer)).leads, officerBefore.leads + 1);
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
    assert.equal((await sidebar(officer)).leads, officerBefore.leads);
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
    assert.deepEqual(results[1 - winnerIndex], { error: "This lead already has an owner.", claimConflict: true });
    const refreshed = (await write(loser, { type: "openCampaigns", campaignId, loadIntake: false })).campaignNavigation.queue;
    assert.ok(!refreshed.inboxLeads.some(({ id }) => id === shared.id));
    assert.ok(!refreshed.members.some(({ leadId }) => leadId === shared.id));
    const loserInbox = await action(loser, "readInboxWork", { type: "list", view: "Unassigned" });
    assert.ok(!loserInbox.leads.some(({ id }) => id === shared.id));
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
    const missedCall = await action(owner, "saveInboundReplyWork", { type: "simulate", channel: "Call", sourceId: "working-day-missed-call",
      sender: (await action(officer, "readLeadForWork", secondTask)).lead.phone });
    assert.ok(missedCall.id, missedCall.error);
    const attachedCall = await action(owner, "saveInboundReplyWork", { type: "attachLead", id: missedCall.id, revision: 1, leadId: secondLeadId });
    assert.equal(attachedCall.conversationId, linked.conversationId);
    const missedCallWork = (await compactReplies(officer)).page.items.find(({ id }) => id === linked.conversationId);
    assert.equal(missedCallWork.missedCall, true);
    assert.deepEqual(missedCallWork.campaignCallback, freshReply.campaignCallback);
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

    // The manager's inline assignment uses the campaign command, with the same deadline and ownership guarantees.
    await write(owner, { type: "assignCampaignLeads", campaignId: secondCampaignId, email: officer.email,
      leads: [{ id: secondLeadId, previousEmail: owner.email }] });
    assert.ok((await action(owner, "mutate", { type: "assignCampaignLeads", campaignId: secondCampaignId, email: competingOfficer.email,
      leads: [{ id: secondLeadId, previousEmail: owner.email }] })).error);
    assert.equal((await upcomingCallbacks(officer)).items.find(({ taskId }) => taskId === personal[1].taskId)?.dueAt, secondCallbackAt);
    assert.ok(!(await upcomingCallbacks(owner)).items.some(({ taskId }) => taskId === personal[1].taskId));
    await write(owner, { type: "assignCampaignLeads", campaignId: secondCampaignId, email: owner.email,
      leads: [{ id: secondLeadId, previousEmail: officer.email }] });

    const missedDeadline = new Date(Date.now() + 1_500).toISOString();
    await write(owner, { type: "rescheduleCampaignCallback", campaignId: secondCampaignId, leadId: secondLeadId,
      revision: (await action(owner, "readLeadForWork", secondTask)).lead.followUp.revision, callbackAt: missedDeadline, reason: "Fictional borrower moved the callback earlier." });
    await delay(Math.max(0, Date.parse(missedDeadline) - Date.now() + 25));
    const managerOverdue = await action(owner, "readCampaignManager", { campaignId: secondCampaignId, view: "overdue" });
    assert.equal(managerOverdue.items.find(({ leadId }) => leadId === secondLeadId)?.owner, owner.name);
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
    const carriedCall = (await compactReplies(officer)).page.items.find(({ id }) => id === linked.conversationId);
    assert.equal(carriedCall.missedCall, true);
    assert.equal(carriedCall.loanId, callbackLoanId);
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
    const conversionPath = `/api/lead-conversion?brokerage=${brokerage}`;
    assert.equal((await postResponse(conversionPath, conversion)).status, 401);
    assert.equal((await postResponse(conversionPath, conversion, processor)).status, 403);
    assert.equal((await postResponse(conversionPath, conversion, competingOfficer)).status, 409);
    assert.equal((await postResponse(`/api/lead-conversion?brokerage=${randomUUID()}`, conversion, officer)).status, 403);
    const foreign = await runtime.dispatchFetch(`${origin}${conversionPath}`, { method: "POST", headers: {
      Origin: "https://unrelated.example.test", "Content-Type": "application/json", Cookie: `__Host-orbit-session=${officer.token}`,
    }, body: JSON.stringify(conversion) });
    assert.equal(foreign.status, 403);
    const response = await runtime.dispatchFetch(`${origin}${conversionPath}`, { method: "POST", headers: {
      Origin: origin, "Content-Type": "application/json", Cookie: `__Host-orbit-session=${officer.token}`,
      "X-Vinext-RSC-Compatibility-Id": "fictional-previous-client",
    }, body: JSON.stringify(conversion) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.match(response.headers.get("cache-control"), /no-store/);
    const result = await response.json();
    const loanId = result.referralLoanId;
    assert.equal(result.inboxChanged, true);
    assert.equal(result.inboxLoan.loanId, loanId);
    assert.equal(result.convertedLead.id, leadId);
    assert.equal(result.convertedLead.campaignId, campaignId);
    assert.equal(result.convertedCampaign.members.find((member) => member.leadId === leadId).loanId, loanId);
    assert.ok(result.convertedCampaign.files.some(({ id }) => id === loanId));
    assert.ok(!result.convertedCampaign.inboxLeads.some(({ id }) => id === leadId));
    assert.equal(result.state, undefined);
    assert.match(result.message, /shared lead was routed/);
    const next = result.convertedCampaign.inboxLeads.find(({ id }) => id === overflow[0].id);
    assert.equal(next.officerEmail, officer.email);
    assert.equal(next.dueAt, overflow[0].dueAt);
    assert.equal((await queue(officer)).items.find(({ recordId }) => recordId === next.id)?.dueAt, next.dueAt);
    const replay = await post(conversionPath, conversion, officer);
    assert.equal(replay.referralLoanId, loanId);
    assert.equal(replay.inboxLoan.applications[0].token, result.inboxLoan.applications[0].token);
    assert.equal(replay.convertedCampaign.inboxLeads.find(({ id }) => id === next.id).followUp.events.filter(({ text }) => text === `Assigned to ${officer.name}.`).length, 1);
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
    const handoffExceptions = await fileExceptions("Unassigned handoffs");
    const handoffException = handoffExceptions.items.find((item) => item.loanId === loanId);
    assert.equal(handoffException.target, "processing-handoff");
    assert.equal(handoffException.owner, officer.name);
    assert.equal(handoffException.dueAt, assignment.item.dueAt);
    const beforeAssignment = (await sidebar(owner)).exceptions;
    const allBeforeAssignment = await fileExceptions("All file exceptions");
    assert.equal(allBeforeAssignment.next, null);
    assert.equal(beforeAssignment, allBeforeAssignment.items.length);
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
    assert.ok(!(await fileExceptions("Unassigned handoffs")).items.some((item) => item.loanId === loanId));
    assert.equal((await sidebar(owner)).exceptions, beforeAssignment - 1);
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
      scenario: { ...run.scenario, creditScore: 725, loanAmount: run.scenario.loanAmount - 500 } });
    const alternative = reprice.state.pricingRuns[0];
    assert.notEqual(alternative.id, run.id);
    assert.equal(reprice.state.pricingRuns.find((item) => item.id === run.id).selectedId, null);
    const alternativeQuote = { runId: alternative.id, offerId: alternative.offers[0].id };
    await loanAction(officer, loanId, "selectOffer", alternativeQuote);
    for (const quote of [undefined, alternativeQuote]) {
      const blocked = await action(officer, "mutate", { type: "sendApplication", loanId, revision: corrected.revision, quote });
      assert.match(blocked.error, /Save a quote for the 1003 amount before sending to mock UWM/);
    }
    assert.equal((await file(officer, loanId)).applications[0].versions.find(({ revision }) => revision === corrected.revision).uwmReceipt, null);
    await loanAction(officer, loanId, "selectOffer", { runId: run.id, offerId: offer.id });
    const feeTemplatePath = `/api/fee-templates?brokerage=${brokerage}`;
    const fees = { origination: 95000, appraisal: 62500, creditReport: 0, settlement: null, government: null, prepaid: null, escrow: null, other: null };
    const config = { title: "Fictional working-day fees", source: "Fictional staff-only fee schedule", effectiveOn: "2025-01-01",
      purpose: run.scenario.purpose, zip: run.scenario.zip, fees };
    const feeTemplate = { type: "publish", id: randomUUID(), revision: 0, config };
    assert.equal((await postResponse(feeTemplatePath, feeTemplate, officer)).status, 409);
    const forQuote = { type: "forQuote", loanId, runId: run.id };
    assert.equal((await postResponse(feeTemplatePath, forQuote, competingOfficer)).status, 409);
    const v1 = (await post(feeTemplatePath, feeTemplate, owner)).templates[0];
    assert.deepEqual((await post(feeTemplatePath, forQuote, officer)).templates, [v1]);
    const feeSelection = { runId: run.id, offerId: offer.id };
    const worksheet = { fees, purchasePrice: Math.round((run.scenario.purchasePrice ?? run.scenario.propertyValue) * 100),
      payoffs: null, deposit: 0, sellerCredits: 0, otherCredits: 0 };
    const savedFees = await loanAction(officer, loanId, "saveFeeWorksheet", { ...feeSelection, feeRevision: 0, worksheet, template: { id: v1.id, revision: 1 } });
    assert.equal(savedFees.loanWork.feeWorksheets[0].origin.source, config.source);
    await loanAction(officer, loanId, "publishQuote", { ...feeSelection, feeRevision: 1 });
    const v2 = await post(feeTemplatePath, { ...feeTemplate, revision: 1, config: { ...config, fees: { ...fees, appraisal: 72500 } } }, owner);
    assert.equal(v2.templates[0].revision, 2);
    assert.equal((await file(officer, loanId)).publishedQuotes[0].presentation.primary.feeOrigin.revision, 1);
    const status = await borrower(token, { type: "status" });
    assert.equal(status.kind, "status");
    assert.equal(status.loanStatus.quote.rate, offer.rate);
    assert.equal(status.loanStatus.quote.presentation.primary.offerId, offer.id);
    assert.deepEqual(status.loanStatus.quote.presentation.primary.estimate.inputs.fees, fees);
    assert.ok(!JSON.stringify(status).includes(config.source));
    assert.ok(!JSON.stringify(status).includes(recommendation));
    assert.ok(!JSON.stringify(status).includes("preapproval"));
    assert.ok(!("draft" in status));
    assert.match((await action(officer, "mutate", { type: "sendApplication", loanId, revision: corrected.revision,
      quote: { runId: run.id, offerId: run.offers[1].id } })).error, /saved mock quote changed/i);
    const submissionIntent = { revision: corrected.revision, quote: { runId: run.id, offerId: offer.id } };
    await loanAction(officer, loanId, "simulateMissingUwmReceipt", submissionIntent);
    const pendingReceiptFile = await file(officer, loanId);
    assert.equal(pendingReceiptFile.applications[0].uwmPendingReceipt.revision, corrected.revision);
    assert.equal(pendingReceiptFile.submissions.length, 0);
    const receiptTask = (await queue(officer)).items.find(({ id }) => id === `uwm-receipt:${loanId}:${corrected.revision}`);
    assert.equal(receiptTask.target, "loan-application");
    assert.match((await action(officer, "mutate", { type: "sendApplication", loanId, ...submissionIntent })).error, /missing submission receipt/);
    assert.ok((await action(competingOfficer, "mutate", { type: "reconcileMockUwmReceipt", loanId, revision: corrected.revision })).error);
    await loanAction(officer, loanId, "reconcileMockUwmReceipt", { revision: corrected.revision });
    const handedOff = await file(officer, loanId);
    const receipt = handedOff.applications[0].versions.find((version) => version.revision === corrected.revision).uwmReceipt;
    assert.ok(receipt);
    const replayedReceipt = await loanAction(officer, loanId, "reconcileMockUwmReceipt", { revision: corrected.revision });
    assert.deepEqual(replayedReceipt.loanWork.applications[0].versions.find((version) => version.revision === corrected.revision).uwmReceipt, receipt);
    assert.equal(replayedReceipt.loanWork.submissions.length, 1);
    assert.ok(!(await queue(officer)).items.some(({ id }) => id === receiptTask.id));
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
    const processorInbox = await incoming(processor, "processing");
    assert.equal(processorInbox.next, null);
    assert.deepEqual(await sidebar(processor), { processing: processorInbox.items.length });
    assert.equal((await sidebar(owner)).processing, (await incoming(owner, "processing")).items.length);
    assert.equal((await sidebar(officer)).processing, undefined);
    const active = await file(officer, loanId);
    assert.equal(offered?.note, "Review the mock lender evidence.");
    assert.equal(offered?.revision, active.loanProcessing[0].revision);
    assert.equal(active.loans[0].officerEmail, officer.email, "The original LO stays on the file");
  });

  await stage("Processor clears two mock conditions and returns the file", async () => {
    const beforeAcceptance = await file(officer, loanId);
    const priorHandoff = beforeAcceptance.loanProcessing[0];
    const staleAccept = { type: "updateProcessing", loanId, revision: priorHandoff.revision,
      applicationRevision: beforeAcceptance.applications[0].revision - 1, action: "Accept handoff", note: "Old 1003 note." };
    assert.match((await action(processor, "mutate", staleAccept)).error, /processing handoff changed/i);
    assert.deepEqual((await file(processor, loanId)).loanProcessing[0], priorHandoff);
    const accepted = await processing(processor, "Accept handoff");
    assert.equal(accepted.state, undefined);
    assert.equal(accepted.loanWork.loanProcessing[0].note, "Review the mock lender evidence.");
    assert.match(accepted.loanWork.processingActivity[0].text, /In processing/);
    assert.match(accepted.loanWork.processingActivity[1].text, /Review the mock lender evidence/);
    const observedAcceptance = await action(officer, "checkLoanHandoff", loanId, beforeAcceptance.handoffVersion);
    assert.equal(observedAcceptance.loanProcessing[0].status, "In processing");
    assert.match(observedAcceptance.processingActivity[1].text, /Review the mock lender evidence/);
    assert.deepEqual(await action(officer, "checkLoanHandoff", loanId, observedAcceptance.handoffVersion), { unchanged: true });
    assert.ok(!(await incoming(processor, "processing")).items.some(({ kind, id }) => kind === "handoff" && id === loanId));
    assert.deepEqual(await sidebar(processor), { processing: 0 });
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
    assert.equal(received.length, 2);
    assert.ok(received.every(({ status }) => status === "Received"));
    const selection = received.map(({ id, revision }) => ({ requestId: id, revision }));
    const bulkReview = { type: "processDocumentBatch", loanId, action: "accept-and-send", items: selection, reviewed: true, batchId: randomUUID() };
    assert.ok((await action(competingOfficer, "mutate", bulkReview)).error);
    const staleBatch = { ...bulkReview, items: [{ ...selection[0], revision: selection[0].revision - 1 }, selection[1]] };
    assert.match((await action(processor, "mutate", staleBatch)).error, /changed/i);
    assert.ok((await file(processor, loanId)).documentRequests.every(({ status }) => status === "Received"));
    assert.match((await write(processor, bulkReview)).message, /Accepted and sent 2 documents/);
    assert.match((await write(processor, bulkReview)).message, /Accepted and sent 2 documents/);
    const deliveries = (await file(processor, loanId)).documentRequests;
    const selectClear = ({ id, revision, uwmReceipt }) => ({ requestId: id, revision, receipt: uwmReceipt });
    assert.match((await loanAction(processor, loanId, "processDocumentBatch", {
      action: "clear", batchId: randomUUID(), items: [selectClear(deliveries[0])],
    })).message, /1 selected condition/);
    const partlyCleared = (await file(processor, loanId)).submissions.find(({ id }) => id === submission.id);
    assert.equal(partlyCleared.conditions.find(({ id }) => id === deliveries[1].conditionId).satisfiedAt, null);
    await loanAction(processor, loanId, "processDocumentBatch", { action: "clear", batchId: randomUUID(), items: [selectClear(deliveries[1])] });
    const cleared = await file(processor, loanId);
    assert.ok(cleared.submissions[0].conditions.every(({ satisfiedAt }) => satisfiedAt));
    assert.ok(cleared.documentRequests.every(({ status, uwmReceipt }) => status === "Accepted" && uwmReceipt));
    assert.ok(cleared.communicationDrafts.some(({ audience, milestone }) => audience === "Realtor" && milestone === "Lender review complete"));
    const beforeReturn = await file(officer, loanId);
    const independentItemId = randomUUID();
    await loanAction(owner, loanId, "saveClosingItem", { itemId: independentItemId, revision: 0,
      title: "Independent fictional closing check", owner: owner.name, dueDate: today });
    const returnedWork = await measureHandoff("Processor to LO", () => loanAction(processor, loanId, "updateProcessing", {
      action: "Return to LO", revision: cleared.loanProcessing[0].revision, note: "Internal note: mock lender evidence cleared.",
    }), officer, "today", loanId);
    const returned = (await queue(officer)).items.find(({ kind, recordId }) => kind === "handoff" && recordId === loanId);
    assert.equal(returned?.target, "processing-handoff");
    assert.equal(returnedWork?.note, "Internal note: mock lender evidence cleared.");
    const observedReturn = await action(officer, "checkLoanHandoff", loanId, beforeReturn.handoffVersion);
    assert.equal(observedReturn.loanProcessing[0].status, "Returned to LO");
    assert.equal(observedReturn.loanProcessing[0].note, returnedWork.note);
    assert.equal(observedReturn.loanProcessing[0].revision, returnedWork.revision);
    assert.ok(observedReturn.closingItems.some(({ id }) => id === independentItemId));
    assert.match((await action(owner, "mutate", { ...staleAccept, revision: beforeReturn.loanProcessing[0].revision,
      action: "Return to LO" })).error, /processing handoff changed/i);
    assert.equal((await file(owner, loanId)).loanProcessing[0].note, returnedWork.note);
    const independent = observedReturn.closingItems.find(({ id }) => id === independentItemId);
    await loanAction(owner, loanId, "completeClosingItem", { itemId: independentItemId, revision: independent.revision, completed: true });
    assert.ok((await action(competingOfficer, "checkLoanHandoff", loanId, beforeReturn.handoffVersion)).error);
    assert.ok(!(await incoming(competingOfficer, "today")).items.some(({ id }) => id === loanId));
    assert.doesNotMatch(JSON.stringify(await borrower(token, { type: "status" })), /Internal note/);
    const partner = await realtor(realtorToken);
    assert.ok(partner.referrals.some(({ borrowerName, stage }) => borrowerName === imported.name && stage === cleared.loans[0].stage));
    assert.doesNotMatch(JSON.stringify(partner), /Internal note/);
  });

  await stage("File preflight links the current evidence and keeps the processor decision", async () => {
    const preflight = (staff = officer) => action(staff, "workOnLoanReview", { type: "preflight", loanId }, brokerage);
    const review = (staff, input) => action(staff, "workOnLoanReview", { loanId, ...input }, brokerage);
    assert.ok((await preflight(competingOfficer)).error);
    const current = await preflight();
    assert.equal(current.preflight.checks.find(({ id }) => id === "lender").state, "Ready");
    assert.equal(current.preflight.checks.find(({ id }) => id === "amount").target, "loan-amount-comparison");
    assert.equal(current.preflight.checks.find(({ id }) => id === "fees").target, "preflight-fee-worksheet-settlement");
    assert.equal(current.preflight.checks.find(({ id }) => id === "documents").state, "Ready");
    const reviewId = randomUUID();
    const request = { type: "create", id: reviewId, title: "Sample closing preflight", category: "File preflight",
      reviewerEmail: processor.email, dueOn: today, note: "Review the sample evidence.", preflightKey: current.preflight.key };
    assert.equal((await review(officer, request)).kind, "saved");
    const decision = { type: "decide", id: reviewId, revision: 1, eventId: randomUUID(), decision: "Approved", note: "Sample evidence checked." };
    assert.match((await review(processor, decision)).error, /Resolve the preflight issues/);
    const currentFile = await file(officer, loanId);
    const app = currentFile.applications[0];
    {
      const readTrid = (staff, feeBasis) => action(staff, "accessComplianceCases", { type: "trid", input: { operation: "read", loanId, feeBasis } }, undefined, brokerage);
      const recordTrid = (staff, expectedRevision, event, requestId = randomUUID()) => action(staff, "accessComplianceCases",
        { type: "trid", input: { operation: "record", loanId, expectedRevision, requestId, event } }, undefined, brokerage);
      const scope = { type: "scope", coveredScenario: true, creditor: "Fictional creditor", leSender: "Creditor", zone: "America/Detroit",
        calendarFrom: "2026-07-01", calendarThrough: "2026-07-31", openWeekdays: [1, 2, 3, 4, 5], closures: ["2026-07-03"], extraOpen: [], reference: "Fictional office schedule" };
      assert.ok((await readTrid(competingOfficer)).result?.error);
      assert.ok((await recordTrid(processor, 0, scope)).result?.error);
      const requestId = randomUUID();
      assert.equal((await recordTrid(officer, 0, scope, requestId)).result.revision, 1);
      assert.equal((await recordTrid(officer, 0, scope, requestId)).result.revision, 1);
      assert.ok((await recordTrid(officer, 0, scope)).result.error);
      const keys = ["name", "income", "creditReportId", "propertyAddress", "estimatedValue", "loanAmount"];
      for (const [index, element] of keys.entries()) {
        const receipt = await recordTrid(officer, index + 1, { type: "element", element, on: "2026-07-02", reference: "Fictional intake receipt" });
        assert.equal(receipt.result.timing.applicationOn, index === 5 ? "2026-07-02" : null);
      }
      assert.equal((await readTrid(owner)).result.timing.leDue, "2026-07-08");
      const send = { type: "sent", document: "Initial CD", version: "fixture-cd", sender: "Creditor", method: "Electronic", on: "2026-07-08", reference: "Fictional delivery record" };
      assert.ok((await recordTrid(officer, 7, send)).result.error);
      const sent = await recordTrid(officer, 7, { ...send, consentReference: "Fictional consent record" });
      assert.equal(sent.result.timing.cdEarliest, null);
      const received = await recordTrid(officer, 8, { type: "received", document: "Initial CD", version: "fixture-cd", on: "2026-07-09", reference: "Fictional receipt record" });
      assert.equal(received.result.timing.cdEarliest, "2026-07-13");
      assert.equal((await readTrid(processor)).result.revision, received.result.revision);
      const corrected = await recordTrid(owner, 9, { ...send, document: "Corrected CD", version: "fixture-cd-correction",
        method: "Mail", on: "2026-07-10" });
      assert.match(corrected.result.timing.cdWait, /Review corrected CD/);
      assert.equal(corrected.result.timing.cdEarliest, null);
      const withdrawn = await recordTrid(owner, 10, { type: "void", sequence: 10, reference: "Fictional correction withdrawn" });
      assert.equal(withdrawn.result.timing.cdEarliest, "2026-07-13");
      assert.equal(withdrawn.result.entries.length, 11);
      const initialLe = { ...send, document: "Initial LE", version: "fixture-le-fees", method: "Mail", on: "2026-07-07" };
      assert.equal((await recordTrid(owner, 11, initialLe)).result.revision, 12);
      const leReceipt = { type: "received", document: "Initial LE", version: initialLe.version, on: "2026-07-10",
        localTime: "09:00", reference: "Fictional Loan Estimate receipt" };
      assert.equal((await recordTrid(officer, 12, leReceipt)).result.revision, 13);
      const intent = { type: "intent", receiptSequence: 13, on: "2026-07-10", localTime: "09:30", reference: "Fictional borrower intent" };
      assert.match((await recordTrid(officer, 13, { ...intent, receiptSequence: 9 })).result.error, /recorded Loan Estimate receipt/);
      assert.equal((await recordTrid(officer, 13, intent)).result.revision, 14);
      const fee = { type: "fee", intentSequence: 14, on: "2026-07-10", localTime: "09:15", name: "Fictional appraisal fee",
        category: "Other", activity: "Payment method required", reference: "Fictional fee activity receipt" };
      assert.ok((await recordTrid(processor, 14, fee)).result.error);
      assert.match((await recordTrid(owner, 14, fee)).result.timing.feeEvidence.at(-1).status, /before its prerequisite/);
      assert.match((await readTrid(processor)).result.timing.feeEvidence.at(-1).status, /before its prerequisite/);
      const snapshot = (evidenceSequence, borrowerCents) => ({ type: "feeSnapshot", evidenceSequence, reference: "Fictional itemized disclosure",
        complete: true, lines: [{ key: "appraisal", label: "Appraisal", borrowerCents, bucket: "Individual" }] });
      assert.match((await recordTrid(officer, 15, snapshot(10, 10000))).result.error, /active disclosure send/);
      assert.ok((await recordTrid(processor, 15, snapshot(12, 10000))).result.error);
      const feeRequest = randomUUID();
      assert.equal((await recordTrid(officer, 15, snapshot(12, 10000), feeRequest)).result.revision, 16);
      assert.equal((await recordTrid(officer, 15, snapshot(12, 10000), feeRequest)).result.revision, 16);
      assert.match((await recordTrid(officer, 16, snapshot(12, 11000))).result.error, /prior fee snapshot/);
      assert.equal((await recordTrid(owner, 16, snapshot(8, 12500))).result.revision, 17);
      const feeBasis = { estimateSequence: 16, closingSequence: 17 };
      assert.equal((await readTrid(processor, feeBasis)).result.feeReview.comparison.potentialExcessCents, 2500);
      assert.equal((await readTrid(owner, { estimateSequence: 17, closingSequence: 16 })).result.feeReview.unavailable, true);
      assert.equal((await recordTrid(owner, 17, { type: "void", sequence: 17, reference: "Fictional amounts corrected" })).result.revision, 18);
      const afterWithdrawal = (await readTrid(processor, feeBasis)).result;
      assert.equal(afterWithdrawal.feeReview.unavailable, true);
      assert.equal(afterWithdrawal.feeReview.comparison, null);
      assert.ok(afterWithdrawal.entries.some(entry => entry.sequence === 17 && entry.event.type === "feeSnapshot"));
      const revisedSend = { ...initialLe, document: "Revised LE", version: "fixture-revised-le", on: "2026-07-09" };
      assert.equal((await recordTrid(owner, 18, revisedSend)).result.revision, 19);
      assert.equal((await recordTrid(owner, 19, snapshot(19, 11250))).result.revision, 20);
      const revisionReview = { type: "estimateRevision", originalSequence: 16, revisedSequence: 20, on: "2026-07-08",
        reason: "Changed settlement charges", chargeKeys: ["appraisal"], reference: "Fictional changed circumstance",
        reviewReference: "Fictional reviewer evidence" };
      assert.match((await recordTrid(officer, 20, { ...revisionReview, chargeKeys: ["missing"] })).result.error, /affected charge keys/);
      assert.equal((await recordTrid(officer, 20, revisionReview)).result.revision, 21);
      assert.match((await readTrid(processor)).result.estimateRevisions[0].status, /on or after the initial Closing Disclosure/);
      assert.equal((await recordTrid(owner, 21, { type: "void", sequence: 20, reference: "Fictional revised amounts corrected" })).result.revision, 22);
      assert.match((await readTrid(processor)).result.estimateRevisions[0].status, /Needs active original and revised estimate evidence/);
      assert.equal((await recordTrid(owner, 22, snapshot(8, 12500))).result.revision, 23);
      const actual = { type: "consummated", on: "2026-07-13", reference: "Fictional consummation evidence" };
      assert.ok((await recordTrid(processor, 23, actual)).result.error);
      assert.equal((await recordTrid(owner, 23, actual)).result.revision, 24);
      const correction = { ...send, document: "Corrected CD", version: "fixture-cd-cure", on: "2026-07-15", method: "Mail" };
      assert.equal((await recordTrid(owner, 24, correction)).result.revision, 25);
      const cure = { type: "feeCure", on: "2026-07-14", refundCents: 2500, consummationSequence: 24,
        estimateSequence: 16, closingSequence: 23, correctedSendSequence: 25, reference: "Fictional refund evidence" };
      assert.match((await recordTrid(owner, 25, { ...cure, correctedSendSequence: 8 })).result.error, /active corrected disclosure/);
      assert.equal((await recordTrid(owner, 25, cure)).result.revision, 26);
      const cureCheck = (await readTrid(processor)).result.feeCures[0];
      assert.equal(cureCheck.dueOn, "2026-09-11");
      assert.equal(cureCheck.potential, 2500);
      assert.equal(cureCheck.correctionStatus, "Recorded within 60 days");
      const restart = { ...correction, version: "fixture-cd-restart", on: "2026-07-10" };
      assert.equal((await recordTrid(owner, 26, restart)).result.revision, 27);
      assert.equal((await recordTrid(owner, 27, { type: "received", document: "Corrected CD", version: restart.version,
        on: "2026-07-11", reference: "Fictional corrected CD receipt" })).result.revision, 28);
      const cdReview = { type: "correctedCdReview", sendSequence: 27, reason: "Loan product changed", reference: "Fictional reviewer evidence" };
      assert.equal((await recordTrid(owner, 28, cdReview)).result.revision, 29);
      const closingTiming = (await readTrid(processor)).result;
      assert.equal(closingTiming.timing.initialCdEarliest, "2026-07-13");
      assert.equal(closingTiming.correctedCds.find(item => item.sequence === 27).earliest, "2026-07-15");
      assert.match(closingTiming.correctedCds.find(item => item.sequence === 27).status, /falls short/);
      assert.equal((await recordTrid(owner, 29, { type: "void", sequence: 25, reference: "Fictional send withdrawn" })).result.revision, 30);
      assert.match((await readTrid(processor)).result.feeCures[0].correctionStatus, /Needs linked/);
    }
    await loanAction(officer, loanId, "useReviewedLoanAmount", { revision: app.revision, previousAmount: currentFile.loans[0].amount });
    const [fee] = currentFile.feeWorksheets;
    const selection = { runId: fee.runId, offerId: fee.offerId };
    const fees = Object.fromEntries(Object.entries(fee.inputs.fees).map(([key, amount]) => [key, amount ?? 0]));
    await loanAction(officer, loanId, "saveFeeWorksheet", { ...selection, feeRevision: fee.revision, worksheet: { ...fee.inputs, fees } });
    assert.match((await review(processor, decision)).error, /Preflight evidence changed/);
    const disclosureCalendar = (staff, input) => action(staff, "accessDisclosureCalendar", input);
    const calendar = await disclosureCalendar(owner, { type: "read" });
    assert.equal(calendar.current.version, 0);
    assert.ok((await disclosureCalendar(officer, { type: "read" })).error);
    const templates = (staff, input) => action(staff, "accessDisclosureTemplates", input);
    const templateId = randomUUID();
    const templateConfig = { title: "Fictional state purchase template", purpose: app.draft.purpose,
      propertyState: app.draft.propertyLocation.state, documents: sampleDisclosureDocuments };
    const publishTemplate = { type: "publish", id: templateId, revision: 0, config: templateConfig };
    assert.ok((await templates(officer, publishTemplate)).error);
    assert.ok((await action(owner, "accessDisclosureTemplates", publishTemplate, undefined, randomUUID())).error);
    assert.equal((await templates(owner, publishTemplate)).templates.find(({ id }) => id === templateId).revision, 1);
    const prepare = ({ version, anchorOn, signBy }, previousVersion = null, templateRevision = 1) => ({
      ...selection, feeRevision: fee.revision + 1, previousVersion, applicationRevision: app.revision,
      documents: sampleDisclosureDocuments, signBy, deadlineCalendar: { version, anchorOn }, template: { id: templateId, revision: templateRevision },
    });
    const firstWork = (await file(officer, loanId)).disclosureWork;
    assert.equal(firstWork.templateOptions.recommendedId, templateId);
    const before = firstWork.suggestedDeadline;
    await loanAction(officer, loanId, "prepareDisclosurePackage", prepare(before));
    const version = async () => {
      const [{ version, revision }] = (await file(officer, loanId)).disclosureWork.packages;
      return { version, revision };
    };
    const rules = { ...calendar.current.rules, holidays: [{ on: before.signBy, label: "Fictional office closure" }] };
    const preview = { type: "preview", version: 0, rules, anchorOn: before.anchorOn };
    const moved = await disclosureCalendar(owner, preview);
    assert.equal(moved.affected.find((item) => item.loanId === loanId).state, "Draft");
    assert.notEqual(moved.after.signBy, moved.before.signBy);
    const publish = { type: "publish", version: 0, rules, note: "Add the fictional closure for internal scheduling." };
    assert.equal((await disclosureCalendar(owner, publish)).current.version, 1);
    assert.ok((await action(owner, "accessDisclosureCalendar", { type: "read" }, undefined, randomUUID())).error);
    assert.match((await action(officer, "mutate", { type: "issueDisclosurePackage", loanId, ...await version() })).error, /moved this draft/);
    const after = (await file(officer, loanId)).disclosureWork.suggestedDeadline;
    assert.equal(after.signBy, moved.after.signBy);
    assert.equal((await templates(owner, { ...publishTemplate, revision: 1,
      config: { ...templateConfig, title: "Revised fictional state purchase template" } })).templates.find(({ id }) => id === templateId).revision, 2);
    assert.match((await action(officer, "mutate", { type: "prepareDisclosurePackage", loanId, ...prepare(after, 1) })).error, /template changed/);
    await loanAction(officer, loanId, "prepareDisclosurePackage", prepare(after, 1, 2));
    await loanAction(officer, loanId, "issueDisclosurePackage", await version());
    const issued = await file(officer, loanId);
    const pinned = issued.disclosureWork.packages[0];
    const reminder = `disclosure-signing:${loanId}:2`;
    assert.equal(pinned.deadlineBasis.version, 1);
    assert.equal(pinned.templateBasis.revision, 2);
    assert.equal(issued.disclosureWork.packages[1].templateBasis.title, templateConfig.title);
    assert.equal(issued.tasks.find(({ id }) => id === reminder).dueAt, easternDayStart(after.signBy));
    const longer = { ...rules, signingDays: 4 };
    assert.equal((await disclosureCalendar(owner, { ...preview, version: 1, rules: longer })).affected.find((item) => item.loanId === loanId).state, "Issued");
    assert.equal((await disclosureCalendar(owner, { ...publish, version: 1, rules: longer, note: "Extend the fictional follow-up window." })).current.version, 2);
    const afterPublish = await file(officer, loanId);
    assert.equal(afterPublish.disclosureWork.packages[0].signBy, after.signBy);
    assert.equal(afterPublish.tasks.find(({ id }) => id === reminder).dueAt, easternDayStart(after.signBy));
    await loanAction(officer, loanId, "respondToDisclosurePackage", { ...await version(), signer: "Borrower", response: "Signed" });
    assert.doesNotMatch(JSON.stringify(await borrower(token, { type: "status" })), /Fictional state purchase template|templateBasis/i);
    assert.equal((await preflight()).preflight.checks.find(({ id }) => id === "disclosures").target, "closing-disclosure-review");
    await loanAction(officer, loanId, "confirmClosingDisclosure", await version());
    const compliance = (staff, input, expected = brokerage) => action(staff, "accessComplianceCases", input, undefined, expected);
    assert.equal((await compliance(owner, { type: "list", loanId })).coverage.state, "Not evaluated");
    assert.ok((await compliance(competingOfficer, { type: "list", loanId })).error);
    assert.ok((await compliance(owner, { type: "list" }, randomUUID())).error);
    const sampleCase = { type: "openFixture", loanId, packageVersion: pinned.version };
    assert.ok((await compliance(officer, sampleCase)).error);
    const finding = await compliance(owner, sampleCase);
    assert.equal(finding.item.packageVersion, pinned.version);
    assert.equal((await compliance(owner, { type: "list" })).counts.files, 1);
    assert.equal((await compliance(processor, { type: "read", loanId, caseId: finding.item.id })).item.parentCaseId, null);
    const evidence = { type: "recordSampleReview", caseId: finding.item.id, expectedRevision: finding.item.revision,
      requestId: randomUUID(), packageRevision: (await version()).revision };
    assert.ok((await compliance(officer, evidence)).error);
    const recorded = await compliance(owner, evidence);
    assert.equal(recorded.sampleReview.mode, "Sample workbench review");
    assert.equal(recorded.item.status, "Open");
    // Research work uses the same authenticated action and canonical case store as file findings.
    const research = (staff, input, expected) => compliance(staff, { type: "research", input }, expected);
    const researchOpen = { operation: "open", sourceKey: "STATE-MI", kind: "Requirement review" };
    assert.ok((await research(officer, researchOpen)).error);
    assert.ok((await research(owner, researchOpen, randomUUID())).error);
    const researchCase = await research(owner, researchOpen);
    assert.equal(researchCase.kind, "researchDetail");
    assert.equal((await research(owner, researchOpen)).item.id, researchCase.item.id);
    const researchSave = { operation: "save", caseId: researchCase.item.id, expectedRevision: researchCase.item.revision,
      requestId: randomUUID(), ownerEmail: owner.email, status: "Awaiting review", followUpOn: today,
      nextAction: "Confirm Michigan applicability with the assigned compliance reviewer.", note: "Fictional source review queued; no legal approval recorded." };
    const researchSaved = await research(owner, researchSave);
    assert.equal(researchSaved.item.status, "Awaiting review");
    assert.equal(researchSaved.coverage.legalApproval, false);
    assert.equal((await research(owner, researchSave)).item.revision, researchSaved.item.revision);
    assert.ok((await research(owner, { ...researchSave, requestId: randomUUID() })).error);
    assert.ok((await research(processor, { operation: "read", caseId: researchCase.item.id })).error);
    const researchQueue = await research(owner, { operation: "list", filters: { jurisdiction: "MI", status: "Awaiting review", ownership: "mine" } });
    assert.equal(researchQueue.counts.total, 1);
    assert.equal(researchQueue.items[0].id, researchCase.item.id);
    const program=(staff,input,target=brokerage)=>action(staff,"accessComplianceCases",{type:"program",input},undefined,target);
    const entityRequest={operation:"createEntity",requestId:randomUUID(),name:"Michigan Pilot Compliance LLC",nmls:"",scopeNote:"Michigan pilot; user review and lawyer approval required before launch"};
    assert.ok((await program(officer,entityRequest)).error);
    assert.ok((await program(owner,entityRequest,randomUUID())).error);
    const entityResult=await program(owner,entityRequest);
    const entity=entityResult.entities.find(item=>item.name===entityRequest.name);
    assert.equal((await program(owner,entityRequest)).entities.length,entityResult.entities.length);
    const period=new Date().toISOString().slice(0,7);
    const schedule={operation:"schedule",requestId:randomUUID(),entityId:entity.id,month:period,title:"Review Michigan broker reporting scope",category:"Reporting preparation",ownerEmail:owner.email,internalTarget:period+"-01",instructions:"Confirm quarterly activity and annual financial obligations with lawyer"};
    let monthly=await program(owner,schedule);
    assert.equal(monthly.items.length,1);
    assert.equal((await program(owner,schedule)).items.length,1);
    const progress={operation:"update",requestId:randomUUID(),entityId:entity.id,month:period,id:monthly.items[0].id,expectedRevision:1,status:"Awaiting review",ownerEmail:owner.email,internalTarget:period+"-28",evidence:"Fictional review memo MI-001",note:"Prepared a source-linked review for the pilot owner"};
    monthly=await program(owner,progress);
    assert.equal(monthly.items[0].revision,2);
    assert.equal((await program(owner,progress)).items[0].revision,2);
    assert.ok((await program(owner,{...progress,requestId:randomUUID()})).error);
    const monthlyReview={operation:"reviewMonth",requestId:randomUUID(),entityId:entity.id,month:period,fingerprint:monthly.fingerprint,note:"Reporting scope still awaiting lawyer review before launch"};
    monthly=await program(owner,monthlyReview);
    assert.equal(monthly.counts.open,1);
    assert.equal(monthly.reviews[0].current,true);
    assert.equal(monthly.coverage,"Regulatory applicability not evaluated");
    assert.ok((await program(processor,{operation:"month",entityId:entity.id,month:period})).error);
    {
    const suite=async(staff,type,input)=>{
      const result=await action(staff,"accessComplianceCases",{type,input},undefined,brokerage);
      return result.result??result;
    };
    const obligationId=randomUUID();
    const obligation={operation:"save",entityId:entity.id,id:obligationId,expectedRevision:0,requestId:randomUUID(),draft:{
      title:"Fictional Michigan applicability review",sourceUrl:"https://example.test/michigan",authority:"Fictional test authority",basis:"Internal scope review fixture",
      applicability:"Needs review",applicabilityReason:"Counsel determination pending",reviewerEvidence:"",effectiveFrom:"2026-01-01",effectiveThrough:"",
      cadence:"Monthly",internalTargetDay:28,ownerEmail:owner.email}};
    assert.ok((await suite(officer,"obligations",obligation)).error);
    assert.equal((await suite(owner,"obligations",obligation)).revision,1);
    const occurrence=await suite(owner,"obligations",{operation:"generate",entityId:entity.id,id:obligationId,expectedRevision:1,requestId:randomUUID(),period:"2026-11"});
    assert.equal(occurrence.occurrence.status,"Applicability review gap");
    assert.equal((await suite(owner,"obligations",{operation:"occurrences",entityId:entity.id,id:obligationId})).items.length,1);
    const planPeriod={operation:"planWork",entityId:entity.id,id:obligationId,period:"2026-11",requestId:randomUUID()};
    const planned=await suite(owner,"obligations",planPeriod);
    assert.equal(planned.kind,"obligationWorkPlanned");
    assert.equal((await suite(owner,"obligations",{...planPeriod,requestId:randomUUID()})).workId,planned.workId);
    const plannedMonth=await program(owner,{operation:"month",entityId:entity.id,month:planned.month});
    assert.equal(plannedMonth.items.filter(i=>i.id===planned.workId).length,1);
    assert.match(plannedMonth.items.find(i=>i.id===planned.workId).instructions,/Applicability review gap/);
    const draftPolicy={operation:"createVersion",requestId:randomUUID(),contentId:randomUUID(),previousVersionId:null,kind:"Policy",title:"Fictional evidence handling policy",
      body:"Fictional exercise only. Retain evidence and escalate missing facts.",sourceReferences:"Synthetic rehearsal; no real legal review",questions:[],passPercent:100};
    const policy=await suite(owner,"learning",draftPolicy);
    assert.equal((await suite(owner,"learning",draftPolicy)).versionId,policy.versionId);
    assert.ok((await suite(owner,"learning",{operation:"publish",requestId:randomUUID(),versionId:policy.versionId})).error);
    assert.equal((await suite(owner,"learning",{operation:"review",requestId:randomUUID(),versionId:policy.versionId,note:"Fictional owner review",lawyerReviewReference:"Synthetic legal review fixture only",rightsConfirmed:true,userReviewed:true})).state,"Owner reviewed");
    assert.equal((await suite(owner,"learning",{operation:"publish",requestId:randomUUID(),versionId:policy.versionId})).state,"Internally published");
    const assigned=await suite(owner,"learning",{operation:"assign",requestId:randomUUID(),versionId:policy.versionId,employeeEmail:officer.email,dueAt:"2026-11-30T23:59:59.000Z"});
    assert.equal((await suite(officer,"learning",{operation:"myAssignments"})).items[0].id,assigned.assignmentId);
    assert.ok((await suite(processor,"learning",{operation:"readAssignment",assignmentId:assigned.assignmentId})).error);
    const acknowledgment={operation:"acknowledge",requestId:randomUUID(),assignmentId:assigned.assignmentId,versionId:policy.versionId,acknowledged:true};
    assert.equal((await suite(officer,"learning",acknowledgment)).completed,true);
    assert.equal((await suite(officer,"learning",acknowledgment)).completed,true);
    assert.equal((await suite(officer,"learning",{operation:"readAssignment",assignmentId:assigned.assignmentId})).completion.completed,true);
    }

    const ready = (await preflight()).preflight;
    assert.ok(ready.checks.every(({ state }) => state === "Ready"), JSON.stringify(ready.checks));
    assert.equal((await review(officer, { type: "resubmit", id: reviewId, revision: 1, eventId: randomUUID(),
      note: "The sample worksheet and signatures are ready.", dueOn: today, preflightKey: ready.key })).kind, "saved");
    assert.equal((await review(processor, { ...decision, eventId: randomUUID(), revision: 2 })).kind, "saved");
    const detail = await review(officer, { type: "detail", id: reviewId });
    assert.equal(detail.review.status, "Approved");
    assert.equal(detail.history[0].preflight.key, ready.key);
    assert.equal(detail.history.at(-1).preflight.key, current.preflight.key);
    assert.doesNotMatch(JSON.stringify(await borrower(token, { type: "status" })), /Sample closing preflight|Sample evidence checked/);
    const stageEdits = (staff, input) => action(staff, "accessLoanStageEdits", input);
    const controlled = await file(officer, loanId);
    const stage = controlled.loans[0].stage;
    const readControls = { type: "loan", loanId };
    const policy = { type: "publish", revision: 0, rules: { application: [stage], fees: [stage] },
      reason: "Protect the fictional preflight file." };
    assert.ok((await stageEdits(officer, policy)).error);
    assert.equal((await stageEdits(owner, policy)).revision, 1);
    assert.equal((await stageEdits(officer, readControls)).locked.fees, true);
    assert.equal((await stageEdits(processor, readControls)).canOverride, false);
    assert.ok((await stageEdits(competingOfficer, readControls)).error);
    const [controlledFee] = controlled.feeWorksheets;
    const feeEdit = { ...selection, feeRevision: controlledFee.revision,
      worksheet: { ...controlledFee.inputs, fees: { ...controlledFee.inputs.fees, settlement: 175_000 } } };
    const stageOverride = { revision: 1, stage, reason: "Reviewed the revised fictional settlement fee." };
    assert.match((await action(officer, "mutate", { type: "saveFeeWorksheet", loanId, ...feeEdit })).error, /locked at/);
    assert.match((await action(officer, "mutate", { type: "saveFeeWorksheet", loanId, ...feeEdit, stageOverride })).error, /Only a brokerage admin/);
    const beforeFeeReview = (await sidebar(owner)).exceptions;
    assert.ok(!(await action(owner, "mutate", { type: "saveFeeWorksheet", loanId, ...feeEdit, stageOverride })).error);
    const affected = await file(officer, loanId);
    assert.equal(affected.disclosureWork.packages[0].reviewReason, "Fees changed");
    assert.ok(affected.tasks.some(({ title, completedAt }) => title === "Review disclosure package · Fees changed" && !completedAt));
    const feeException = (await fileExceptions("Disclosure reviews")).items.find((item) => item.loanId === loanId);
    assert.equal(feeException.target, "loan-disclosures");
    assert.equal(feeException.status, "Fees changed");
    assert.equal((await sidebar(owner)).exceptions, beforeFeeReview + 1);
    const audit = await action(officer, "mutate", { type: "loadLoanAudit", loanId });
    assert.equal(audit.loanAudit.filter(({ action }) => action === "Admin stage override · Saved fee worksheet").length, 1);
    assert.ok(audit.loanAudit.some(({ changes }) => changes.some(({ after }) => after === stageOverride.reason)));
    assert.doesNotMatch(JSON.stringify(await borrower(token, { type: "status" })), /revised fictional settlement fee/);
    assert.equal((await stageEdits(owner, { ...policy, revision: 1, rules: { application: [], fees: [] },
      reason: "Restore the default rules for other rehearsals." })).revision, 2);
    await loanAction(officer, loanId, "prepareDisclosurePackage", { ...prepare(affected.disclosureWork.suggestedDeadline, 2, 2),
      feeRevision: controlledFee.revision + 1, reviewedPackageRevision: affected.disclosureWork.packages[0].revision,
      revisionNote: "Reviewed the revised sample settlement fee." });
    assert.ok(!(await fileExceptions("Disclosure reviews")).items.some((item) => item.loanId === loanId));
    assert.equal((await sidebar(owner)).exceptions, beforeFeeReview);
  });

  const repeatFile = await stage("LO closes, funds, and opens the repeat application", async () => {
    const markClosing = { type: "markClearToClose", loanId };
    assert.match((await action(officer, "mutate", markClosing)).error, /no longer ready/i);
    assert.match((await action(processor, "mutate", markClosing)).error, /access/i);
    const completed = await processing(officer, "Complete handoff");
    assert.match(completed.loanWork.processingActivity[0].text, /Complete/);
    assert.match(completed.loanWork.processingActivity[1].text, /Internal note: mock lender evidence cleared/);
    assert.ok(!(await incoming(officer, "today")).items.some(({ kind, id }) => kind === "handoff" && id === loanId));
    const ready = await file(officer, loanId);
    assert.equal(loanNextAction(ready.loans[0], { ...ready, playbook: defaultPlaybook }, officer.role).title, "Review closing readiness");
    const submission = ready.submissions[0];
    const condition = submission.conditions.find(({ category }) => category === "Income");
    const beforeReopen = (await sidebar(owner)).exceptions;
    await loanAction(owner, loanId, "reopenMockUwmCondition", { submissionId: submission.id, conditionId: condition.id,
      expectedSatisfiedAt: condition.satisfiedAt, expectedReopenedAt: condition.mockReopenedAt ?? null });
    assert.match((await action(officer, "mutate", markClosing)).error, /reopened mock UWM condition/i);
    for (const stage of ["Clear to Close", "Funded", "Closed"]) {
      assert.match((await action(officer, "mutate", { type: "move", id: loanId, stage })).error, /reopened mock UWM condition/i);
    }
    assert.match((await action(officer, "mutate", { type: "recordClosing", loanId, revision: 0, closingDate: today })).error,
      /reopened mock UWM condition/i);
    const reopened = await file(officer, loanId);
    assert.equal(closingReviewReady(reopened.loans[0], reopened), false);
    assert.ok(!reopened.communicationDrafts.some(({ milestone }) => milestone === "Clear to Close"));
    assert.ok(!reopened.pastClients[0]?.closingDate);
    const reopenedAlert = reopened.uwmAlerts.find(({ kind, conditionId }) => kind === "Reopened condition" && conditionId === condition.id);
    const lenderWork = await action(officer, "readTaskWork", { type: "list", view: "Open", scope: "Mine", group: "Lender updates" });
    assert.ok(reopenedAlert && lenderWork.items.some(({ id, recordId, title }) =>
      id === reopenedAlert.id && recordId === loanId && title.startsWith("Reopened · ")));
    const conditionException = (await fileExceptions("Reopened conditions")).items.find((item) => item.id === condition.id);
    assert.equal(conditionException.target, `lender-condition-${submission.id}:${condition.id}`);
    assert.equal((await sidebar(owner)).exceptions, beforeReopen + 1);
    const request = reopened.documentRequests.find(({ conditionId }) => conditionId === condition.id);
    await borrower(token, { type: "attachSample", requestId: request.id, revision: request.revision });
    const replacement = (await file(officer, loanId)).documentRequests.find(({ id }) => id === request.id);
    await loanAction(officer, loanId, "reviewDocument", { requestId: replacement.id, revision: replacement.revision,
      decision: "Accepted", replacementNote: "", sendToMockUwm: true });
    await loanAction(officer, loanId, "refreshMockUwmClearance", { submissionId: submission.id });
    assert.ok(!(await fileExceptions("Reopened conditions")).items.some((item) => item.id === condition.id));
    assert.equal((await sidebar(owner)).exceptions, beforeReopen);
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
    const assets = closingReady.submissions[0].conditions.find(({ category }) => category === "Assets");
    const openClosing = await file(officer, loanId);
    await loanAction(owner, loanId, "reopenMockUwmCondition", { submissionId: submission.id, conditionId: assets.id,
      expectedSatisfiedAt: assets.satisfiedAt, expectedReopenedAt: assets.mockReopenedAt ?? null });
    const changedClosing = await action(officer, "checkLoanHandoff", loanId, openClosing.handoffVersion);
    const hold = loanNextAction(changedClosing.loans[0], changedClosing, officer.role);
    assert.equal(hold.blocker, "Funding on hold");
    assert.equal(hold.target, `lender-condition-${submission.id}:${assets.id}`);
    assert.match((await action(officer, "mutate", { type: "recordFunding", loanId, revision: 0, fundingDate: today })).error,
      /reopened mock UWM condition/i);
    const fundingBlocked = await file(officer, loanId);
    assert.equal(fundingBlocked.pastClients[0].closingDate, today);
    assert.ok(!fundingBlocked.closingProgress[0]?.fundingDate);
    assert.equal((await borrower(token, { type: "status" })).loanStatus.closingPause.label, "Funding on hold");
    const partnerHold = (await realtor(realtorToken)).referrals.find(({ borrowerName }) => borrowerName === imported.name);
    assert.equal(partnerHold.closingPause.label, "Funding on hold");
    assert.ok(fundingBlocked.communicationDrafts.filter(({ milestone }) => milestone === "Clear to Close").every(({ supersededAt }) => supersededAt));
    assert.ok(fundingBlocked.communicationDrafts.some(({ milestone, supersededAt }) => milestone === "Closing complete" && !supersededAt));
    const bank = fundingBlocked.documentRequests.find(({ conditionId }) => conditionId === assets.id);
    await borrower(token, { type: "attachSample", requestId: bank.id, revision: bank.revision });
    const replacementBank = (await file(officer, loanId)).documentRequests.find(({ id }) => id === bank.id);
    await loanAction(officer, loanId, "reviewDocument", { requestId: bank.id, revision: replacementBank.revision,
      decision: "Accepted", replacementNote: "", sendToMockUwm: true });
    await loanAction(officer, loanId, "refreshMockUwmClearance", { submissionId: submission.id });
    assert.ok((await file(officer, loanId)).communicationDrafts.filter(({ milestone }) => milestone === "Clear to Close")
      .every(({ supersededAt }) => supersededAt));
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
    assert.equal(newFile.loans[0].address, "");
    assert.equal(newFile.applications[0].draftHasPropertyStreet, true);
    assert.equal(newFile.applications[0].draft, null);
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
    const submittedFile = await file(owner, reported.loanId);
    assert.match(submittedFile.loans[0].address, /^32 Updated Fictional Lane/);
    assert.equal(submittedFile.applications[0].draftHasPropertyStreet, undefined);
    assert.equal((await file(owner, reported.sourceLoanId)).loans[0].address, sourceAddress);
    assert.match((await action(processor, "readLoanForWork", repeat.applicationLoanId)).error, /unavailable/i);

    return { id: reported.loanId, revision: repeatSubmitted.revision, token: newFile.applications[0].token };
  });

  await stage("LO exports, clears, and funds the refinance through a manual lender", async () => {
    const { id: repeatId, revision, token: repeatToken } = repeatFile;
    await loanAction(officer, repeatId, "reviewApplication", { revision });
    const handoff = { type: "recordManualHandoff", loanId: repeatId, revision, lenderRevision: 0,
      eventId: randomUUID(), outcome: "Acknowledged", note: "", lenderFile: { lender: "Fictional Wholesale", externalId: "FICT-REFI-1003" } };
    assert.match((await action(officer, "mutate", handoff)).error, /approved second review/i);
    const names = [{ first: imported.name.split(" ")[0], middle: "", last: imported.name.split(" ").slice(1).join(" "), suffix: "" }];
    const exported = await loanAction(officer, repeatId, "exportReviewedApplication", {
      revision, lenderRevision: 0, eventId: randomUUID(), names,
    });
    assert.match(exported.mismoXml, /<LoanPurposeType>Refinance<\/LoanPurposeType>/);
    assert.match(exported.mismoXml, /<AddressLineText>32 Updated Fictional Lane<\/AddressLineText>/);
    assert.ok((await action(competingOfficer, "mutate", handoff)).error);
    assert.match((await action(officer, "mutate", handoff)).error, /approved second review/i);
    const { lenderFile, ...handoffEntry } = handoff;
    assert.match((await action(officer, "mutate", { ...handoffEntry, outcome: "Delivered manually" })).error, /approved second review/i);
    assert.equal((await file(officer, repeatId)).submissions.length, 0);
    const review = (input) => action(owner, "workOnLoanReview", { loanId: repeatId, ...input });
    async function approveCurrent() {
      const [pending] = (await review({ type: "loan" })).reviews;
      const { review: currentReview } = await review({ type: "detail", id: pending.id });
      const approved = await review({ type: "decide", id: pending.id, revision: currentReview.revision, eventId: randomUUID(),
        decision: "Approved", note: "Reviewed the fictional refinance." });
      assert.equal(approved.kind, "saved", approved.error);
    }
    const staffPackages = `/api/lender-packages?brokerage=${brokerage}`;
    const publicPackages = "/api/shared-lender-package";
    const packageCredentials = () => ({ token: `${brokerage}.${randomBytes(32).toString("hex")}`, code: randomBytes(12).toString("hex") });
    const originalPackage = { type: "create", loanId: repeatId, revision, lenderRevision: 0, shareId: randomUUID(),
      ...packageCredentials(), recipient: lenderFile.lender, hours: 1, confirmedFictional: true, names, documents: [] };
    const packageRead = ({ token, code }) => ({ type: "read", token, code });
    const packageXml = (share) => runtime.dispatchFetch(`${origin}${publicPackages}`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ...packageRead(share), type: "download", slot: 0 }) });
    const blockedPackage = await postResponse(staffPackages, originalPackage, officer);
    assert.equal(blockedPackage.status, 409);
    assert.match(blockedPackage.result.error, /approved second review/i);
    await approveCurrent();
    const acknowledged = await write(officer, handoff);
    const submissionId = acknowledged.loanWork.applications[0].manualHandoff.submissionId;
    assert.ok(submissionId);
    assert.equal((await write(officer, handoff)).loanWork.applications[0].manualHandoff.submissionId, submissionId);
    assert.match((await action(officer, "mutate", { ...handoff, lenderFile: { ...lenderFile, externalId: "OTHER" } })).error, /new handoff entry/);
    assert.equal((await file(officer, repeatId)).submissions.length, 1);
    assert.equal((await post(staffPackages, originalPackage, officer)).createdId, originalPackage.shareId);
    const originalXml = await packageXml(originalPackage);
    assert.equal(originalXml.status, 200);
    assert.match(originalXml.headers.get("Content-Disposition"), new RegExp(`^attachment; filename="orbit-fictional-1003-r${revision}-[0-9a-f]{12}\\.xml"$`));
    assert.equal(await originalXml.text(), exported.mismoXml);
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
    const additionalCondition = { loanId: repeatId, submissionId, conditionId: randomUUID() };
    await write(officer, { type: "saveManualCondition", ...additionalCondition, revision: 0,
      category: "Employment", owner: "Loan officer", description: "Verify employment using the accepted fictional pay stub." });
    const added = (await file(officer, repeatId)).submissions[0].conditions.find(({ id }) => id === additionalCondition.conditionId);
    const conditionKey = JSON.stringify([added.category, added.description, added.group, added.satisfiedAt,
      added.mockReopenedAt ?? null, added.manual?.revision ?? null]);
    const reuse = { type: "reuseConditionEvidence", ...additionalCondition, conditionKey, linkId: randomUUID(),
      target: null, source: { id: accepted.id, revision: accepted.revision }, confirmed: true };
    assert.ok((await action(competingOfficer, "mutate", reuse)).error);
    assert.match((await write(officer, reuse)).message, /Accepted evidence linked/);
    assert.match((await write(officer, reuse)).message, /Accepted evidence linked/);
    const reused = (await file(officer, repeatId)).documentRequests.find(({ id }) => id === reuse.linkId);
    assert.equal(reused.status, "Accepted");
    assert.equal(reused.evidenceLinks[0].sourceRevision, accepted.revision);
    assert.equal(reused.evidenceLinks[0].reviewedBy, officer.name);
    const borrowerChecklist = (await borrower(repeatToken, { type: "status" })).loanStatus.documents;
    assert.equal(borrowerChecklist.find(({ id }) => id === reused.id).status, "Accepted");
    assert.doesNotMatch(JSON.stringify(borrowerChecklist), /evidenceLinks|linkedBy/);
    await write(officer, { type: "recordManualDelivery", ...additionalCondition, revision: 1,
      documentRevision: reused.revision, reference: "FICT-REUSE-01" });
    await write(officer, { type: "recordManualClearance", ...additionalCondition, revision: 2, cleared: true, confirmation: "FICT-REUSE-CLEAR" });
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
    assert.equal((await packageXml(originalPackage)).status, 404);
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
    const correctedAmount = (Number(draft.draft.loanAmount) - 500.25).toFixed(2);
    const corrected = await borrower(repeatToken, { type: "submit", revision: draft.revision, step: applicationSteps.length - 1,
      draft: { ...draft.draft, loanAmount: correctedAmount } });
    await checkReturnQueues(manualReturnStatus.review);
    const reconcile = { type: "useReviewedLoanAmount", loanId: repeatId, revision: corrected.revision, previousAmount: transferred.loans[0].amount };
    const pipelineRow = async () => (await action(assignedOfficer, "readPipelineWork", {
      view: "List", search: imported.name, filters: emptyPipelineFilters,
    })).list.loans.find(({ id }) => id === repeatId);
    const unmatched = await pipelineRow();
    assert.equal(unmatched.amount, reconcile.previousAmount);
    assert.equal(unmatched.requestedAmount, Number(correctedAmount));
    assert.match((await action(assignedOfficer, "mutate", reconcile)).error, /review the current 1003/);
    await loanAction(assignedOfficer, repeatId, "reviewApplication", { revision: corrected.revision });
    await checkReturnQueues(manualReturnStatus.approval);
    assert.ok((await action(officer, "mutate", reconcile)).error);
    assert.match((await action(assignedOfficer, "mutate", { ...reconcile, revision })).error, /review the current 1003/);
    assert.match((await action(assignedOfficer, "mutate", { ...reconcile, previousAmount: reconcile.previousAmount - 1 })).error, /recorded loan amount changed/);
    const beforeAmount = await file(assignedOfficer, repeatId);
    const recordedAmount = Math.round(Number(correctedAmount));
    const matched = (await write(assignedOfficer, reconcile)).loanWork;
    assert.equal(matched.loans[0].amount, recordedAmount);
    assert.deepEqual(matched.applications[0], beforeAmount.applications[0]);
    assert.deepEqual(matched.pricingRuns, beforeAmount.pricingRuns);
    assert.equal((await action(owner, "checkLoanHandoff", repeatId, beforeAmount.handoffVersion)).loans[0].amount, recordedAmount);
    assert.equal((await write(assignedOfficer, reconcile)).loanWork.loans[0].amount, recordedAmount);
    const matchAudit = (await action(assignedOfficer, "mutate", { type: "loadLoanAudit", loanId: repeatId })).loanAudit
      .filter(({ action }) => action === "Matched recorded amount to reviewed 1003");
    assert.equal(matchAudit.length, 1);
    assert.deepEqual(matchAudit[0].changes, [{ field: "Loan amount", before: reconcile.previousAmount, after: recordedAmount }]);
    const matchedRow = await pipelineRow();
    assert.equal(matchedRow.amount, recordedAmount);
    assert.equal(matchedRow.requestedAmount, undefined);
    const reacknowledgment = { ...handoff, revision: corrected.revision, eventId: randomUUID() };
    const replacementPackage = { ...originalPackage, revision: corrected.revision, shareId: randomUUID(),
      ...packageCredentials(), replacesId: originalPackage.shareId };
    assert.equal((await postResponse(staffPackages, replacementPackage, officer)).status, 409);
    assert.match((await action(assignedOfficer, "mutate", reacknowledgment)).error, /approved second review/i);
    const blockedReplacement = await postResponse(staffPackages, replacementPackage, assignedOfficer);
    assert.equal(blockedReplacement.status, 409);
    assert.match(blockedReplacement.result.error, /approved second review/i);
    assert.ok(await directory.brokerageForPortal(originalPackage.token));
    await approveCurrent();
    await checkReturnQueues(manualReturnStatus.export);
    assert.match((await action(assignedOfficer, "mutate", reacknowledgment)).error, /Prepare the MISMO export/);
    const replaced = await post(staffPackages, replacementPackage, assignedOfficer);
    assert.deepEqual(await post(staffPackages, replacementPackage, assignedOfficer), replaced);
    assert.deepEqual(replaced.shares.map(({ id, status, applicationRevision, files }) =>
      [id, status, applicationRevision, files[0].downloads]), [
      [replacementPackage.shareId, "Available", corrected.revision, 0],
      [originalPackage.shareId, "Revoked", revision, 1],
    ]);
    assert.equal(await directory.brokerageForPortal(originalPackage.token), null);
    assert.equal((await postResponse(publicPackages, packageRead(originalPackage))).status, 404);
    assert.equal((await packageXml(originalPackage)).status, 404);
    const replacementXml = await packageXml(replacementPackage);
    assert.equal(replacementXml.status, 200);
    assert.match(replacementXml.headers.get("Content-Disposition"), new RegExp(`^attachment; filename="orbit-fictional-1003-r${corrected.revision}-[0-9a-f]{12}\\.xml"$`));
    const revisedExport = await loanAction(assignedOfficer, repeatId, "exportReviewedApplication", {
      revision: corrected.revision, lenderRevision: 0, eventId: randomUUID(), names,
    });
    assert.ok(revisedExport.mismoXml.includes(`<NoteAmount>${correctedAmount}</NoteAmount>`));
    assert.equal(await replacementXml.text(), revisedExport.mismoXml);
    await checkReturnQueues(manualReturnStatus.acknowledgment);
    const pendingRevision = await file(owner, repeatId);
    assert.equal(loanNextAction(pendingRevision.loans[0], pendingRevision, "LO").target, "manual-lender-acknowledgment");
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
    assert.match((await action(assignedOfficer, "mutate", reconcile)).error, /before closing/);
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
  await stage("Covered opt-out and exhausted retries refill only the campaign slots they release", async () => {
    const firstCampaign = randomUUID();
    const secondCampaign = randomUUID();
    const names = ["Fictional opt-out source", "Fictional shared alias", "Fictional first replacement", "Fictional extra waiting",
      "Fictional owned alias", "Fictional second replacement", "Fictional covered retry", "Fictional retry replacement", "Fictional extra retry lead"];
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
    const through = new Date(Date.parse(`${today}T12:00:00Z`) + 4 * 86_400_000).toISOString().slice(0, 10);
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

    const retryCampaign = randomUUID();
    const [unanswered, nextLead, stillShared] = await prepare(retryCampaign, officer, [6, 7, 8]);
    await write(owner, { type: "saveCampaignRules", campaignId: retryCampaign, revision: 0, voicemailDays: 1, noResponseDays: 1, maxAttempts: 2 });
    const retryLead = read(await workspace(owner), unanswered);
    const firstTry = await write(officer, { type: "recordCampaignCall", campaignId: retryCampaign, leadId: unanswered,
      revision: retryLead.followUp.revision, outcome: "Left message", note: "First fictional voicemail.", callbackAt: null });
    assert.ok(firstTry.leadWork.member.callbackDueAt);
    assert.equal(read(await workspace(owner), nextLead).officerEmail, null);
    const lastTry = { type: "act", id, operationId: randomUUID(), update: { kind: "campaign", id: firstTry.leadWork.member.callbackTaskId,
      revision: firstTry.leadWork.lead.followUp.revision, outcome: "No response", note: "Last fictional retry during coverage." } };
    const exhausted = await action(competingOfficer, "workOnStaffCoverage", lastTry);
    assert.match(exhausted.message, /attempt limit reached.*shared lead was routed/, exhausted.error);
    assert.deepEqual(await action(competingOfficer, "workOnStaffCoverage", lastTry), exhausted);
    const retried = await workspace(owner);
    assert.ok(member(retried, unanswered).retryExhaustedAt);
    assert.equal(member(retried, unanswered).callbackDueAt, null);
    assert.equal(read(retried, unanswered).officerEmail, officer.email);
    assert.equal(read(retried, nextLead).officerEmail, officer.email);
    assert.equal(read(retried, nextLead).dueAt, dueAt);
    assert.equal(read(retried, stillShared).officerEmail, null);
  });
  await stage("Team branches route ZIPs and offboarding preserves open files, deadlines, and original lead receipts", async () => {
    const id = randomUUID();
    const created = await directory.manage({ email: owner.email, name: owner.name, brokerage: { id: "orbit-demo" } },
      [owner.email], { type: "create", id, name: "Fictional branch brokerage", pilot: true });
    assert.equal(created.created, id, created.error);
    const teamPath = `/api/brokerages?brokerage=${id}`;
    const settingsPath = `/api/quote-intake-settings?brokerage=${id}`;
    const inBranchWorkspace = (actor, name, input) => action(actor, name, input, undefined, id, id);
    const branchWorkspace = async () => (await inBranchWorkspace(owner, "mutate", { type: "refreshWorkspace" })).state;
    for (const member of [officer, competingOfficer]) await post(teamPath, { type: "invite", email: member.email, role: "LO" }, owner);
    await directory.activateStaff({ email: officer.email, name: officer.name }, [owner.email]);
    const branchId = randomUUID();
    const first = { type: "saveBranch", id: branchId, revision: 0, name: "Fictional North Branch",
      staffEmails: [officer.email, competingOfficer.email], ownerEmail: officer.email };
    assert.equal((await postResponse(teamPath, first, officer)).status, 403);
    assert.equal((await postResponse(teamPath, { ...first, ownerEmail: competingOfficer.email }, owner)).status, 409);
    assert.equal((await postResponse(teamPath, { ...first, staffEmails: [processor.email], ownerEmail: null }, owner)).status, 409);
    assert.equal((await post(teamPath, first, owner)).message, "Branch created.");
    assert.equal((await post(teamPath, first, owner)).message, "Branch is up to date.");
    const branchResponse = await runtime.dispatchFetch(`${origin}${teamPath}&view=branches`, { headers: { Cookie: `__Host-orbit-session=${owner.token}` } });
    const { branches } = await branchResponse.json();
    assert.deepEqual(branches.map(({ id, revision, staff }) => [id, revision, staff.length]), [[branchId, 1, 2]]);
    const otherTenant = await runtime.dispatchFetch(`${origin}/api/brokerages?brokerage=${brokerage}&view=branches`,
      { headers: { Cookie: `__Host-orbit-session=${owner.token}` } });
    assert.deepEqual((await otherTenant.json()).branches, []);

    const { leadRouting } = await branchWorkspace();
    const enabled = await inBranchWorkspace(owner, "mutate", { ...leadRouting, type: "saveLeadRouting", quoteForm: "Enable or replace", websiteOwner: owner.email });
    assert.ok(enabled.message, enabled.error);
    const { leadRouting: { quoteToken } } = await branchWorkspace();
    const quote = (input) => post("/api/quote-requests", { token: quoteToken, ...input });
    const original = await quote({ type: "read" });
    const rule = { id: randomUUID(), branchId, name: first.name, zip: "483", ownerEmail: null };
    const config = { ...original.config, campaignId: null, branches: [rule], ownerEmail: owner.email };
    const publish = { type: "publish", revision: 0, config };
    assert.equal((await postResponse(`/api/quote-intake-settings?brokerage=${brokerage}`, publish, owner)).status, 409);
    const general = await post(settingsPath, publish, owner);
    const purchase = await post(settingsPath, { ...publish, profile: "Purchase" }, owner);
    assert.deepEqual(general.managedBranches.map(({ id }) => id), [branchId]);
    const publicForm = await quote({ type: "read", purpose: "Purchase" });
    assert.doesNotMatch(JSON.stringify(publicForm), new RegExp(`branches|ownerEmail|${branchId}`));
    const preview = () => post(settingsPath, { type: "previewRoute", profile: "General", revision: general.revision, config, zip: "48304", hasPhone: false }, owner);
    assert.equal((await preview()).routingPreview.destination, officer.name);
    const submit = async (label) => {
      const name = `Fictional branch ${label}`;
      assert.deepEqual(await quote({ type: "submit", requestId: randomUUID(), formRevision: purchase.revision, name,
        email: `branch-${label}@example.test`, phone: "", purpose: "Purchase", zip: "48304", consent: true }), { received: true });
      return (await branchWorkspace()).inboxLeads.find((lead) => lead.name === name);
    };
    const originalLead = await submit("original");
    assert.equal(originalLead.officerEmail, officer.email);
    assert.deepEqual(originalLead.initialRouting.branch, { name: first.name, zip: "483", id: branchId, revision: 1 });
    await directory.activateStaff({ email: competingOfficer.email, name: competingOfficer.name }, [owner.email]);
    assert.ok((await inBranchWorkspace(competingOfficer, "readInboxWork", { type: "open", id: originalLead.id })).error);
    const next = { ...first, name: "Fictional Renamed Branch", revision: 1, ownerEmail: competingOfficer.email };
    assert.equal((await post(teamPath, next, owner)).message, "Branch updated.");
    assert.equal((await postResponse(teamPath, { ...next, name: "Stale branch edit" }, owner)).status, 409);
    assert.equal((await preview()).routingPreview.destination, competingOfficer.name);
    const changedLead = await submit("changed");
    assert.equal(changedLead.officerEmail, competingOfficer.email);
    assert.equal(changedLead.initialRouting.branch.revision, 2);
    assert.equal(changedLead.initialRouting.branch.name, next.name);
    const earlier = (await branchWorkspace()).inboxLeads.find(({ id }) => id === originalLead.id);
    assert.deepEqual(earlier.initialRouting, originalLead.initialRouting);

    await post(teamPath, { type: "revoke", email: competingOfficer.email }, owner);
    await post(teamPath, { type: "invite", email: competingOfficer.email, role: "LO" }, owner);
    await directory.activateStaff({ email: competingOfficer.email, name: competingOfficer.name }, [owner.email]);
    const fallback = await submit("fallback");
    assert.equal(fallback.officerEmail, owner.email);
    assert.match(fallback.initialRouting.note, /branch LO was unavailable/i);
    assert.equal((await post(teamPath, { type: "setBranchActive", id: branchId, revision: 2, active: false }, owner)).message, "Branch archived.");
    const archived = await submit("archived");
    assert.equal(archived.officerEmail, owner.email);
    assert.match(archived.initialRouting.note, /branch was unavailable/i);
    assert.equal((await post(teamPath, { type: "setBranchActive", id: branchId, revision: 3, active: true }, owner)).message, "Branch reactivated.");
    assert.equal((await post(teamPath, { ...next, revision: 4 }, owner)).message, "Branch updated.");
    const reassigned = await submit("reassigned");
    assert.equal(reassigned.officerEmail, competingOfficer.email);
    assert.equal(reassigned.initialRouting.branch.revision, 5);

    const departingProcessor = actor("Fictional Departing Processor", "departing-processor@example.test", "Processor");
    const replacementProcessor = actor("Fictional Replacement Processor", "replacement-processor@example.test", "Processor");
    for (const staff of [departingProcessor,replacementProcessor]) {
      await post(teamPath,{type:"invite",email:staff.email,role:staff.role},owner);
      await signIn(staff);
    }
    const oldOfficer = competingOfficer;
    const update = async (actor,input) => {
      const saved = await inBranchWorkspace(actor,"mutate",input);
      assert.ok(saved.message,saved.error);
      return saved;
    };
    const activeLoan = await update(oldOfficer,{type:"loan",contactId:"",borrower:"Fictional Handoff Borrower",borrowerEmail:"offboard-file@example.test",
      address:"",amount:215000,purpose:"Purchase",stage:"Processing",officer:oldOfficer.name,partnerId:null,start1003:false});
    const fileId = activeLoan.loanWork.loanId;
    const readFile = actor => inBranchWorkspace(actor,"readLoanForWork",fileId);
    await update(oldOfficer,{type:"createTask",loanId:fileId,title:"Confirm borrower callback",days:1});
    const task = (await readFile(oldOfficer)).tasks.find(({title})=>title==="Confirm borrower callback");
    assert.ok(task?.dueAt);
    await post(teamPath,{type:"assignProcessor",loanId:fileId,email:departingProcessor.email,revision:0},owner);
    const handoffNote = "Preserve this fictional intake note during handoff.";
    await update(oldOfficer,{type:"updateProcessing",loanId:fileId,action:"Send to processing",revision:1,note:handoffNote});
    const processingWork = actor => inBranchWorkspace(actor,"readIncomingLoanWork",{view:"processing"});
    assert.ok((await processingWork(departingProcessor)).items.some(({id})=>id===fileId));
    assert.ok(!(await processingWork(replacementProcessor)).items.some(({id})=>id===fileId));

    const previewDeparture = (actor,filter="All work") => post(teamPath,{type:"offboardingPreview",email:actor.email,filter},owner);
    const transferInput = (actor,view,row,replacement) => ({type:"offboardingTransfer",email:actor.email,memberRevision:view.member.accessRevision,
      kind:row.kind,id:row.id,revision:row.revision,replacement,operationId:randomUUID()});
    const revokeInput = (actor,view,immediate=false) => ({type:"offboardingRevoke",email:actor.email,memberRevision:view.member.accessRevision,immediate});
    const branchPreview = await previewDeparture(oldOfficer,"Branch default");
    const branchRow = branchPreview.items.find(({id})=>id===branchId);
    assert.equal(branchRow?.revision,5,"Offboarding must include the managed branch default");
    assert.equal((await postResponse(teamPath,revokeInput(oldOfficer,branchPreview),owner)).status,409);
    assert.equal((await postResponse(teamPath,transferInput(oldOfficer,branchPreview,branchRow,owner.email),owner)).status,409,"A nonbranch admin must be rejected");
    assert.equal((await postResponse(teamPath,transferInput(oldOfficer,branchPreview,branchRow,officer.email),officer)).status,403);
    const transferBranch = transferInput(oldOfficer,branchPreview,branchRow,officer.email);
    assert.equal((await postResponse(teamPath,{...transferBranch,revision:4},owner)).status,409);
    assert.match((await post(teamPath,transferBranch,owner)).message,/New leads/);
    assert.match((await post(teamPath,transferBranch,owner)).message,/no longer open/);
    const oldWork = await previewDeparture(oldOfficer);
    assert.ok(oldWork.items.some(({kind,id})=>kind==="Loan"&&id===fileId));
    for (const row of oldWork.items) await post(teamPath,transferInput(oldOfficer,oldWork,row,officer.email),owner);
    const readyToRevoke = await previewDeparture(oldOfficer);
    assert.equal(readyToRevoke.remaining,false);
    await post(teamPath,revokeInput(oldOfficer,readyToRevoke),owner);
    const replacementQueue = await inBranchWorkspace(officer,"readMyTasksToday",{horizon:7});
    assert.equal(replacementQueue.items.find(({id})=>id===task.id)?.dueAt,task.dueAt);
    await update(officer,{type:"completeTask",id:task.id,completed:true});
    assert.ok(!(await inBranchWorkspace(officer,"readMyTasksToday",{horizon:7})).items.some(({id})=>id===task.id));

    const processorPreview = await previewDeparture(departingProcessor);
    const processingRow = processorPreview.items.find(({id,kind})=>id===fileId&&kind==="Processing");
    assert.ok(processingRow);
    await post(teamPath,revokeInput(departingProcessor,processorPreview,true),owner);
    const recovery = await previewDeparture(departingProcessor,"Processing");
    assert.equal(recovery.member.status,"Revoked");
    assert.equal(recovery.items[0].id,fileId);
    await post(teamPath,transferInput(departingProcessor,recovery,recovery.items[0],replacementProcessor.email),owner);
    assert.equal((await previewDeparture(departingProcessor)).remaining,false);
    const offered = (await processingWork(replacementProcessor)).items.find(({id})=>id===fileId);
    assert.equal(offered?.note,handoffNote);
    await update(replacementProcessor,{type:"updateProcessing",loanId:fileId,action:"Accept handoff",revision:offered.revision,note:""});
    const resumed = (await readFile(replacementProcessor)).loanProcessing[0];
    assert.equal(resumed.status,"In processing");
    assert.equal(resumed.note,handoffNote);
    for (const departed of [oldOfficer,departingProcessor]) {
      const denied = await runtime.dispatchFetch(`${origin}/workspace?brokerage=${id}`,{
        headers:{Cookie:`__Host-orbit-session=${departed.token}`},redirect:"manual"});
      assert.equal(denied.status,403);
    }
    assert.equal((await inBranchWorkspace(officer,"readLoanForWork",fileId)).loans[0].officerEmail,officer.email);
    const routedAfterDeparture = await submit("after-departure");
    assert.equal(routedAfterDeparture.officerEmail,officer.email);
    assert.equal(routedAfterDeparture.initialRouting.branch.revision,6);
    assert.deepEqual((await branchWorkspace()).inboxLeads.find(({id})=>id===reassigned.id).initialRouting,reassigned.initialRouting);
    const sharedBranchId = randomUUID();
    await post(teamPath,{type:"saveBranch",id:sharedBranchId,revision:0,name:"Fictional Shared Branch",staffEmails:[officer.email],ownerEmail:officer.email},owner);
    const sharedPreview = await previewDeparture(officer,"Branch default");
    const sharedRow = sharedPreview.items.find(({id})=>id===sharedBranchId);
    assert.match((await post(teamPath,transferInput(officer,sharedPreview,sharedRow,null),owner)).message,/shared inbox/);
    assert.ok(!(await previewDeparture(officer,"Branch default")).items.some(({id})=>id===sharedBranchId));

  });
  const crmFieldId = randomUUID();
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
      question: { prompt: "What is your purchase goal?", required: true }, campaignId,
      branches: [{ id: randomUUID(), name: "Fictional Metro Branch", zip: "483", ownerEmail: competingOfficer.email }] };
    const publish = { type: "publish", revision: initial.revision, config };
    assert.equal((await postResponse(settingsPath, publish, officer)).status, 403);
    assert.equal((await postResponse(`/api/quote-intake-settings?brokerage=${randomUUID()}`, publish, owner)).status, 403);
    const preview = { type: "previewRoute", profile: "General", revision: 0, config, zip: "48304", hasPhone: false };
    assert.equal((await postResponse(settingsPath, preview, officer)).status, 403);
    assert.equal((await post(settingsPath, preview, owner)).routingPreview.destination, competingOfficer.name);
    assert.equal((await post(settingsPath, { ...preview, hasPhone: true }, owner)).routingPreview.rule, "Call campaign");
    assert.equal((await post(settingsPath, publish, owner)).revision, 1);
    const { revision, config: publicConfig } = await quote({ type: "read" });
    assert.equal(publicConfig.title, config.title);
    assert.equal("campaignId" in publicConfig, false);
    assert.equal("branches" in publicConfig, false);
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
    assert.deepEqual(leads.map(({ officerEmail }) => officerEmail), [officer.email, competingOfficer.email, null, competingOfficer.email]);
    assert.deepEqual(leads.map((lead) => lead.campaignId ?? null), [campaignId, campaignId, campaignId, null]);
    assert.ok(leads.every(({ source, zip }) => source === "Website quote request" && zip === "48304"));
    assert.deepEqual(leads.map(({ initialRouting }) => initialRouting.rule), ["Call campaign", "Call campaign", "Call campaign", "Branch default"]);
    assert.equal(leads[3].initialRouting.branch.name, "Fictional Metro Branch");
    const purchaseProfile = { type: "publish", profile: "Purchase", revision: 0,
      config: { ...config, title: "Fictional purchase intake", ownerEmail: null } };
    const rental = { id: randomUUID(), kind: "Yes or no", prompt: "Is this for a rental?", required: true, when: null, prefill: null };
    const occupancy = { id: randomUUID(), kind: "Occupancy", prompt: "How will you use the property?", required: true,
      when: { questionId: rental.id, equals: "Yes" }, prefill: "occupancy" };
    const amount = { id: randomUUID(), kind: "Dollar amount", prompt: "What amount are you requesting?", required: true,
      when: { questionId: rental.id, equals: "Yes" }, prefill: "loanAmount" };
    const refinanceProfile = { type: "publish", profile: "Refinance", revision: 0, config: {
      ...config, title: "Fictional refinance intake", campaignId: null, ownerEmail: competingOfficer.email, zip: "Hidden", branches: [],
      contact: "Email required", question: { prompt: "What would you change?", required: true },
      questions: [rental, occupancy, amount],
    } };
    assert.equal((await postResponse(settingsPath, { ...refinanceProfile, config: { ...refinanceProfile.config, ownerEmail: processor.email } }, owner)).status, 409);
    await post(settingsPath, purchaseProfile, owner);
    const savedRefinance = await post(settingsPath, refinanceProfile, owner);
    const purchaseForm = await quote({ type: "read", purpose: "Purchase" });
    const refinanceForm = await quote({ type: "read", purpose: "Refinance" });
    assert.equal(purchaseForm.profile, "Purchase");
    assert.equal(refinanceForm.profile, "Refinance");
    assert.equal(refinanceForm.revision, savedRefinance.revision);
    assert.doesNotMatch(JSON.stringify(refinanceForm), /ownerEmail|campaignId/);
    assert.ok(refinanceForm.config.questions.every((item) => item.prefill === null));
    const qualifiedBuyer = { ...submission(5), formRevision: purchaseForm.revision, name: "Profile Purchase Fictional" };
    const refinanceLead = { ...submission(6, ""), formRevision: refinanceForm.revision, purpose: "Refinance", name: "Profile Refinance Fictional",
      answer: "Reduce the fictional payment.", answers: { [rental.id]: "Yes", [occupancy.id]: "Investment property", [amount.id]: "260000" } };
    assert.equal((await postResponse("/api/quote-requests", { ...refinanceLead, token: quoteToken, formRevision: purchaseForm.revision })).status, 409);
    assert.equal((await postResponse("/api/quote-requests", { ...refinanceLead, token: quoteToken, answers: { [rental.id]: "Yes" } })).status, 400);
    assert.deepEqual(await quote(qualifiedBuyer), { received: true });
    assert.deepEqual(await quote(refinanceLead), { received: true });
    const profiled = (await workspace(owner)).inboxLeads.filter(({ name }) => name.startsWith("Profile "));
    assert.equal(profiled.find(({ name }) => name === qualifiedBuyer.name).campaignId, campaignId);
    const routed = profiled.find(({ name }) => name === refinanceLead.name);
    assert.equal(routed.officerEmail, competingOfficer.email);
    assert.equal(routed.zip, "");
    assert.match(JSON.stringify(routed.followUp.events), /Refinance profile.*What would you change/);
    assert.deepEqual(routed.intake.answers.map(({ value }) => value), ["Yes", "Investment property", "260000"]);
    const retired = await post(settingsPath, { type: "retire", profile: "Refinance", revision: savedRefinance.revision }, owner);
    assert.equal(retired.active, false);
    assert.equal((await quote({ type: "read", purpose: "Refinance" })).profile, "General");
    assert.deepEqual(await quote(refinanceLead), { received: true });
    const conversion = { type: "convertReferral", referralId: routed.id, contactId: null,
      intakeReview: { revision: routed.intake.revision, fields: ["occupancy"] } };
    const conversionPath = `/api/lead-conversion?brokerage=${brokerage}`;
    assert.ok((await postResponse(conversionPath, conversion, officer)).status >= 400);
    const converted = await post(conversionPath, conversion, competingOfficer);
    const prefilled = await borrower(converted.inboxLoan.applications[0].token, { type: "read" });
    assert.equal(prefilled.draft.occupancy, "Investment property");
    assert.equal(prefilled.draft.loanAmount, "");
    const [first, , shared] = leads;
    const staffDocuments = `/api/lead-documents?brokerage=${brokerage}`;
    const publicDocuments = "/api/shared-lead-documents";
    const publicLeadPage = await runtime.dispatchFetch(`${origin}/lead-documents`);
    assert.equal(publicLeadPage.status, 200);
    assert.equal(publicLeadPage.headers.get("Referrer-Policy"), "no-referrer");
    const leadPageBody = await publicLeadPage.text();
    assert.match(leadPageBody, /<form\b[^>]*method="post"/);
    const codeField = leadPageBody.match(/<input\b[^>]*type="password"[^>]*>/)?.[0];
    assert.match(codeField, /\bdisabled/);
    assert.doesNotMatch(codeField, /\bname=/);
    const requestId = randomUUID();
    const document = { type: "request", leadId: first.id, requestId, kind: "Pay stub", instructions: "Use the fictional pay statement.", dueOn: today };
    assert.equal((await postResponse(staffDocuments, document, competingOfficer)).status, 409);
    assert.equal((await post(staffDocuments, document, officer)).requests[0].id, requestId);
    const token = `${brokerage}.${randomBytes(32).toString("hex")}`;
    const code = randomBytes(12).toString("hex");
    const issue = { type: "issue", leadId: first.id, linkId: randomUUID(), token, code, hours: 1, confirmedFictional: true };
    const issued = await post(staffDocuments, issue, officer);
    assert.equal(issued.createdId, issue.linkId);
    assert.doesNotMatch(JSON.stringify(issued), new RegExp(code));
    const read = { type: "read", token, code };
    assert.equal((await postResponse(publicDocuments, { ...read, code: randomBytes(12).toString("hex") })).status, 404);
    assert.equal((await post(publicDocuments, read)).requests.length, 1);
    const upload = { ...read, type: "upload", requestId, revision: 0 };
    assert.equal((await postResponse(publicDocuments, { ...upload, requestId: randomUUID(), fixture: "clean" })).status, 404);
    assert.equal((await postResponse(publicDocuments, { ...upload, fixture: "blocked" })).status, 422);
    assert.equal((await post(publicDocuments, read)).requests[0].status, "Requested");
    await delay(1_010);
    assert.equal((await post(publicDocuments, { ...upload, fixture: "clean" })).received, true);
    const received = (await post(staffDocuments, { type: "read", leadId: first.id }, officer)).requests[0];
    const reviewed = (await post(staffDocuments, { type: "review", leadId: first.id, requestId, revision: received.revision,
      decision: "Accepted", replacementNote: "" }, officer)).requests[0];
    assert.equal(reviewed.status, "Accepted");
    const pdf = (staff) => runtime.dispatchFetch(`${origin}/api/documents/download?brokerage=${brokerage}&request=${requestId}`, {
      headers: { Cookie: `__Host-orbit-session=${staff.token}` },
    });
    assert.equal((await pdf(competingOfficer)).status, 404);
    const before = await pdf(officer);
    assert.equal(before.status, 200);
    assert.deepEqual(new Uint8Array(await before.arrayBuffer()), demoDocumentPdf("clean"));
    const createField = { type: "saveField", fieldId: crmFieldId, revision: 0,
      definition: { label: "Fictional outreach tier", kind: "Choice", options: ["Priority", "Standard"], roles: ["LO", "Processor"] } };
    assert.ok((await action(officer, "accessCrmFields", createField)).error);
    assert.equal((await action(owner, "accessCrmFields", createField)).kind, "savedField");
    const saveField = { type: "saveValue", record: "lead", recordId: first.id, fieldId: crmFieldId,
      fieldRevision: 1, revision: 0, value: "Priority" };
    assert.ok((await action(competingOfficer, "accessCrmFields", saveField)).error);
    assert.equal((await action(officer, "accessCrmFields", saveField)).entries[0].value, "Priority");
    const convert = { type: "convertReferral", referralId: first.id, contactId: null };
    const { referralLoanId } = await write(officer, convert);
    assert.equal((await write(officer, convert)).referralLoanId, referralLoanId);
    assert.equal((await postResponse(publicDocuments, read)).status, 404);
    assert.equal(await directory.brokerageForPortal(token), null);
    const loan = await file(officer, referralLoanId);
    const fieldValues = { type: "values", record: "contact", recordId: loan.loans[0].contactId };
    assert.equal((await action(officer, "accessCrmFields", fieldValues)).entries[0].value, "Priority");
    assert.ok((await action(competingOfficer, "accessCrmFields", fieldValues)).error);
    assert.ok((await action(officer, "accessCrmFields", fieldValues, undefined, randomUUID())).error);
    assert.equal(loan.loans[0].leadSource, "Website quote request");
    assert.equal(loan.documentRequests[0].id, requestId);
    assert.equal(loan.documentRequests[0].status, "Accepted");
    assert.equal(loan.documentRequests[0].dueOn, today);
    assert.equal(loan.documentRequests[0].revision, reviewed.revision);
    const after = await pdf(officer);
    assert.equal(after.status, 200);
    assert.deepEqual(new Uint8Array(await after.arrayBuffer()), demoDocumentPdf("clean"));
    const application = await borrower(loan.applications[0].token, { type: "read" });
    assert.equal(application.draft.borrowerName, requests[0].name);
    assert.equal(application.draft.propertyLocation.zip, requests[0].zip);
    const history = await action(officer, "readHistoryPage", { record: "loan", id: referralLoanId });
    assert.match(JSON.stringify(history.events), /Website quote request · Form version 1.*fictional first home/);
    assert.ok(history.events.some(({ text }) => /^Call campaign .* → Fictional Officer.*Website routing$/.test(text)));
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
    assert.equal(sent.loanStatus.documents.find(({ kind }) => kind === "Pay stub").status, "Accepted");
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
  const jointFile = await stage("Separate borrower links produce a reviewable joint 1003 and recover a lender rejection", async () => {
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
    const primaryCredit = { type: "runMockCredit", loanId, attemptId: randomUUID(), previousId: null, authorized: true,
      applicationRevision: app.revision, borrowers: "primary", scenario: "ready" };
    await write(officer, primaryCredit);
    const aus = { type: "runMockAus", loanId, attemptId: randomUUID(), previousId: null, method: "DU",
      creditId: primaryCredit.attemptId, applicationRevision: app.revision, scenario: "uncertain-rejected" };
    assert.match((await action(officer, "mutate", aus)).error, /all borrowers/i);
    const jointCredit = { ...primaryCredit, attemptId: randomUUID(), previousId: primaryCredit.attemptId, borrowers: "all", scenario: "uncertain-unavailable" };
    await write(officer, jointCredit);
    const queueOrder = async (actor, id) => (await incoming(actor, "today")).items.find((item) => item.kind === "underwriting" && item.id === id);
    assert.equal((await queueOrder(officer, jointCredit.attemptId)).loanId, loanId);
    assert.equal(await queueOrder(competingOfficer, jointCredit.attemptId), undefined);
    assert.equal(await queueOrder(owner, jointCredit.attemptId), undefined);
    assert.ok(!(await incoming(processor, "processing")).items.some((item) => item.kind === "underwriting"));
    assert.match((await action(officer, "mutate", { ...jointCredit, attemptId: randomUUID(), previousId: jointCredit.attemptId })).error, /original/i);
    const confirm = { type: "reconcileMockCreditAus", loanId, attemptId: jointCredit.attemptId };
    assert.match((await action(competingOfficer, "mutate", confirm)).error, /access/i);
    const firstCheck = { ...confirm, lookupId: randomUUID() };
    const finalCheck = { ...confirm, lookupId: randomUUID() };
    const activityCount = async () => JSON.parse(await workspaces.getByName(brokerage).recoveryFixtureCounts(loanId)).activity;
    const restartWorkspace = () => assert.rejects(workspaces.getByName(brokerage).restartMaintenanceFixture());
    assert.match((await write(officer, firstCheck)).message, /inconclusive/i);
    const initialAuditCount = await activityCount();
    await restartWorkspace();
    assert.match((await write(officer, firstCheck)).message, /already recorded/i);
    assert.equal(await activityCount(), initialAuditCount);
    assert.ok(await queueOrder(officer, jointCredit.attemptId));
    await write(officer, finalCheck);
    assert.equal(await queueOrder(officer, jointCredit.attemptId), undefined);
    const confirmedAuditCount = await activityCount();
    await restartWorkspace();
    assert.match((await write(officer, finalCheck)).message, /already recorded/i);
    assert.match((await write(officer, firstCheck)).message, /already recorded/i);
    assert.match((await write(officer, jointCredit)).message, /already/i);
    assert.equal(await activityCount(), confirmedAuditCount);
    assert.equal(await queueOrder(officer, jointCredit.attemptId), undefined);
    await write(officer, { ...aus, creditId: jointCredit.attemptId });
    const pendingDu = (await file(officer, loanId)).mockCreditAusRuns.find(({ id }) => id === aus.attemptId);
    assert.equal(pendingDu.result.status, "Awaiting confirmation");
    assert.ok(await queueOrder(officer, pendingDu.id));
    assert.match((await write(officer, { ...confirm, attemptId: pendingDu.id })).message, /no order was placed/i);
    assert.equal(await queueOrder(officer, pendingDu.id), undefined);
    const orders = (await file(officer, loanId)).mockCreditAusRuns;
    assert.equal(orders.length, 3);
    assert.equal(orders[0].reference, pendingDu.reference);
    assert.equal(orders[0].result.status, "Failed");
    assert.equal(orders[0].borrowerCount, 2);
    const lpa = { ...aus, attemptId: randomUUID(), creditId: jointCredit.attemptId, method: "LPA", scenario: "uncertain-conflict" };
    await write(officer, lpa);
    const conflictedCheck = { ...confirm, attemptId: lpa.attemptId, lookupId: randomUUID() };
    await write(officer, conflictedCheck);
    const conflictAuditCount = await activityCount();
    await restartWorkspace();
    assert.match((await write(officer, conflictedCheck)).message, /already recorded/i);
    assert.equal(await activityCount(), conflictAuditCount);
    const unresolved = (await file(officer, loanId)).mockCreditAusRuns.find(({ id }) => id === lpa.attemptId);
    const exception = (await fileExceptions("Underwriting conflicts")).items.find(({ id }) => id === lpa.attemptId);
    assert.equal(exception.target, `credit-aus-order-${lpa.attemptId}`);
    assert.match((await queueOrder(officer, lpa.attemptId)).title, /admin review/i);
    assert.ok((await fileExceptions("Underwriting conflicts", officer)).error);
    const dismiss = { type: "reviewMockUnderwritingConflict", loanId, attemptId: lpa.attemptId,
      reference: unresolved.conflict.reference, detectedAt: unresolved.conflict.detectedAt };
    assert.match((await action(officer, "mutate", dismiss)).error, /admin/i);
    await write(owner, dismiss);
    assert.ok(!(await fileExceptions("Underwriting conflicts")).items.some(({ id }) => id === lpa.attemptId));
    assert.ok(await queueOrder(officer, lpa.attemptId));
    assert.match((await write(officer, conflictedCheck)).message, /already recorded/i);
    assert.ok(await queueOrder(officer, lpa.attemptId));
    await write(officer, { ...conflictedCheck, lookupId: randomUUID() });
    assert.equal(await queueOrder(officer, lpa.attemptId), undefined);
    const verified = (await file(officer, loanId)).mockCreditAusRuns.find(({ id }) => id === lpa.attemptId);
    assert.equal(verified.reference, unresolved.reference);
    assert.equal(verified.result.status, "Findings ready");
    assert.ok(verified.conflict.reviewedAt);
    assert.doesNotMatch(JSON.stringify(await borrower(primaryToken, { type: "status" })), /MOCK-AUTH|MOCK-DU|MOCK-UNMATCHED/);
    assert.doesNotMatch(JSON.stringify(await co({ type: "read" })), /MOCK-AUTH|MOCK-DU|MOCK-UNMATCHED/);
    const names = [{ first: "Fictional", middle: "Joint", last: "Primary", suffix: "" }, { first: "Jordan", middle: "", last: "Sample", suffix: "" }];
    const exported = await loanAction(officer, loanId, "exportReviewedApplication", { revision: app.revision, lenderRevision: 0, eventId: randomUUID(), names });
    assert.match(exported.mismoXml, /<FirstName>Jordan<\/FirstName>/);
    assert.match(exported.mismoXml, /<FirstName>Fictional<\/FirstName>/);
    const profile = "fictional-wholesale-v1";
    const profileExport = { type: "exportReviewedApplication", loanId, revision: app.revision, lenderRevision: 0, eventId: randomUUID(), names, profile };
    assert.match((await action(officer, "mutate", profileExport)).error, /Loan originator name/);
    const terms = { mortgage: "Conventional", rate: "6.250", term: "360", mortgageLien: "First lien", amortization: "Fixed rate",
      purchasePrice: "460000", refinance: "No cash out" };
    const details = { originator: { fields: { originator: "Working Day Officer", originatorNmls: "999991",
      organization: "Working Day Fictional Brokerage", organizationNmls: "999992" } }, supplement: { fields: terms } };
    await loanAction(officer, loanId, "saveLenderDetails", { revision: 0, details });
    assert.match((await action(officer, "mutate", profileExport)).error, /Lender details changed/);
    const checked = await loanAction(officer, loanId, "exportReviewedApplication", { ...profileExport, lenderRevision: 1 });
    assert.match(checked.mismoXml, /<LoanAmortizationPeriodCount>360<\/LoanAmortizationPeriodCount>/);
    assert.match(checked.mismoXml, /<LicenseIdentifier>999991<\/LicenseIdentifier>/);
    assert.deepEqual((await file(officer, loanId)).applications[0].manualHandoff.exportProfiles, [profile]);
    const note = "Fictional correction for the co-borrower phone.";
    const eventId = randomUUID();
    const lenderReason = "Fictional lender response JB-87";
    const rejection = { type: "requestApplicationCorrection", loanId, revision: app.revision, recipient: "Co-borrower", note,
      lenderRejection: { eventId, exportId: profileExport.eventId, lenderRevision: 1, profile,
        lender: "Fictional Wholesale Desk", reference: "JOINT-REJECT", reason: lenderReason } };
    assert.match((await write(officer, rejection)).message, /co-borrower can reopen/);
    assert.match((await write(officer, rejection)).message, /already recorded/);
    assert.match((await action(officer, "mutate", { ...rejection, recipient: "Primary borrower" })).error, /new lender rejection/);
    const waitingFor = (await incoming(officer, "today")).items.find((item) => item.id === eventId);
    assert.equal(waitingFor.returnStatus, "Waiting on co-borrower");
    const ownerWork = (await fileExceptions("Manual lender returns")).items.find((item) => item.id === eventId);
    assert.equal(ownerWork.status, "Waiting on co-borrower");
    assert.equal(ownerWork.action, "Open co-borrower corrections");
    assert.equal((await file(officer, loanId)).submissions.length, 0);
    assert.equal((await co({ type: "read" })).correctionNote, note);
    assert.doesNotMatch(JSON.stringify(await co({ type: "read" })), /JB-87|JOINT-REJECT/);
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
    assert.equal((await incoming(officer, "today")).items.find((item) => item.id === eventId).returnStatus, manualReturnStatus.review);
    return { loanId, primaryToken, coToken: replacement };
  });
  await stage("A reusable question set adds selected questions to separate borrower portals", async () => {
    const { loanId, primaryToken, coToken } = jointFile;
    const setId = randomUUID();
    const title = "Fictional joint processing review";
    const primaryPrompt = "Is the sample address current?";
    const coPrompt = "When can we review your fictional income?";
    const skippedPrompt = "Is the sample purchase price current?";
    const publish = { type: "publish", id: setId, revision: 0, config: { title, category: "Processing", items: [
      { prompt: primaryPrompt, kind: "Yes or no", dueDays: 0 },
      { prompt: coPrompt, kind: "Short answer", dueDays: null },
      { prompt: skippedPrompt, kind: "Yes or no", dueDays: null },
    ] } };
    const sets = (staff, input) => action(staff, "accessBorrowerQuestionSets", input);
    assert.ok((await sets(officer, publish)).error);
    assert.equal((await sets(owner, publish)).sets.find(({ id }) => id === setId).revision, 1);
    const { asOf, applicationRevision, recipients } = await sets(officer, { type: "preview", loanId });
    assert.deepEqual(recipients, ["Primary borrower", "Co-borrower"]);
    const selection = { batchId: randomUUID(), setId, revision: 1, asOf, applicationRevision, items: [
      { position: 0, recipient: "Primary borrower", dueOn: asOf },
      { position: 1, recipient: "Co-borrower", dueOn: null },
    ] };
    const send = () => loanAction(officer, loanId, "applyBorrowerQuestionSet", selection);
    assert.match((await send()).message, /2 borrower questions added/);
    assert.match((await send()).message, /already added/);
    const primary = (await borrower(primaryToken, { type: "status" })).loanStatus.questions;
    const co = (await post("/api/joint-application", { type: "read", token: coToken })).questions;
    assert.deepEqual(primary.map(({ prompt, dueOn }) => [prompt, dueOn]), [[primaryPrompt, asOf]]);
    assert.deepEqual(co.map(({ prompt, dueOn }) => [prompt, dueOn]), [[coPrompt, null]]);
    assert.doesNotMatch(JSON.stringify([primary, co]), /setBasis|Fictional joint processing review/);
    assert.ok((await file(officer, loanId)).borrowerQuestions.every(({ setBasis }) => setBasis?.title === title && setBasis.revision === 1));
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
  await stage("Borrower-specific mock verification returns reach the assigned processor", async () => {
    const { loanId, primaryToken, coToken } = jointFile;
    await team(owner, { type: "assignProcessor", email: processor.email, loanId, revision: 0 });
    const primary = { type: "createServiceOrder", loanId, orderId: randomUUID(), kind: "Employment verification",
      recipient: "Primary borrower", dueOn: today, note: "" };
    const co = { ...primary, orderId: randomUUID(), recipient: "Co-borrower" };
    assert.ok((await action(competingOfficer, "mutate", co)).error);
    await write(processor, primary);
    await write(processor, co);
    const returned = { type: "updateServiceOrder", loanId, orderId: co.orderId, revision: 0, action: "Simulate return", note: "" };
    await write(processor, returned);
    assert.match((await write(processor, returned)).message, /already updated/);
    const ready = (staff) => action(staff, "readProcessingWork", { readyOnly: false, serviceOrders: { view: "Ready to review" } });
    const rows = (await ready(processor)).serviceOrders.rows.filter((item) => item.loanId === loanId);
    assert.deepEqual(rows.map(({ id, recipient }) => ({ id, recipient })), [{ id: co.orderId, recipient: "Co-borrower" }]);
    assert.ok((await ready(competingOfficer)).error);
    const sample = (await file(processor, loanId)).serviceOrders.find(({ id }) => id === co.orderId).returns[0];
    await write(processor, { ...returned, revision: 1, action: "Accept", note: "Reviewed the fictional employment return." });
    assert.ok(!(await ready(processor)).serviceOrders.rows.some(({ id }) => id === co.orderId));
    const itemId = randomUUID();
    await loanAction(processor, loanId, "saveClosingItem", { itemId, revision: 0, title: "Confirm fictional employment evidence", owner: "Processor", dueDate: today });
    await loanAction(processor, loanId, "setClosingServiceEvidence", { itemId, itemRevision: 1, orderId: co.orderId, reference: sample.reference, linked: true });
    const current = await file(processor, loanId);
    assert.equal(current.closingServiceEvidence.find(({ orderId }) => orderId === co.orderId).recipient, "Co-borrower");
    assert.equal(current.serviceOrders.find(({ id }) => id === primary.orderId).status, "Ordered");
    assert.doesNotMatch(JSON.stringify(await borrower(primaryToken, { type: "status" })), /fictional employment return|MOCK-EMPLOYMENT/);
    assert.doesNotMatch(JSON.stringify(await post("/api/joint-application", { type: "read", token: coToken })), /fictional employment return|MOCK-EMPLOYMENT/);
  });
  await stage("A fictional lender downloads only the exact reviewed MISMO and approved sample PDF", async () => {
    const publicPage = await runtime.dispatchFetch(`${origin}/lender-package`);
    assert.equal(publicPage.status, 200);
    assert.equal(publicPage.headers.get("Referrer-Policy"), "no-referrer");
    const initialPage = await publicPage.text();
    assert.match(initialPage, /<form\b[^>]*method="post"/);
    const codeField = initialPage.match(/<input\b[^>]*type="password"[^>]*>/)?.[0];
    assert.match(codeField, /\bdisabled/);
    assert.doesNotMatch(codeField, /\bname=/);
    const { loanId, primaryToken, coToken } = jointFile;
    const current = await file(officer, loanId);
    const [application] = current.applications;
    await loanAction(officer, loanId, "reviewApplication", { revision: application.revision });
    const accepted = current.documentRequests.find(({ status, recipient }) => status === "Accepted" && recipient === "Co-borrower");
    const received = current.documentRequests.find(({ status, recipient }) => status === "Received" && recipient === "Primary borrower");
    assert.ok(accepted && received);
    const staffPath = `/api/lender-packages?brokerage=${brokerage}`;
    const publicPath = "/api/shared-lender-package";
    const token = `${brokerage}.${randomBytes(32).toString("hex")}`;
    const code = randomBytes(12).toString("hex");
    const share = { type: "create", loanId, revision: application.revision, lenderRevision: application.lender.revision, shareId: randomUUID(),
      profile: "fictional-wholesale-v1",
      token, code, recipient: "Fictional Wholesale Desk", hours: 1, confirmedFictional: true,
      names: [{ first: "Fictional", middle: "Joint", last: "Primary", suffix: "" }, { first: "Jordan", middle: "", last: "Sample", suffix: "" }],
      documents: [{ id: accepted.id, revision: accepted.revision }] };
    assert.equal((await postResponse(staffPath, share, competingOfficer)).status, 409);
    assert.equal((await postResponse(staffPath, share, processor)).status, 409);
    assert.equal((await postResponse(staffPath, share, officer)).status, 409);
    const review = (input, staff = owner) => action(staff, "workOnLoanReview", { loanId, ...input });
    const [pendingReview] = (await review({ type: "loan" })).reviews;
    const detailQuery = { type: "detail", id: pendingReview.id };
    let { review: detail } = await review(detailQuery);
    if (detail.evidenceChanged) {
      const resubmitted = await review({ type: "resubmit", id: detail.id, revision: detail.revision, eventId: randomUUID(),
        dueOn: detail.dueOn, note: "Review the current fictional lender package revision." }, officer);
      assert.equal(resubmitted.kind, "saved", resubmitted.error);
      ({ review: detail } = await review(detailQuery));
    }
    const approved = await review({ type: "decide", id: detail.id, revision: detail.revision, eventId: randomUUID(),
      decision: "Approved", note: "Reviewed the fictional lender package 1003." });
    assert.equal(approved.kind, "saved", approved.error);
    assert.equal((await postResponse(staffPath, { ...share, documents: [{ id: received.id, revision: received.revision }] }, officer)).status, 409);
    const created = await post(staffPath, share, officer);
    assert.equal(created.createdId, share.shareId);
    assert.equal((await post(staffPath, share, officer)).shares.length, 1);
    assert.ok(!JSON.stringify(created).includes(code) && !JSON.stringify(created).includes(token));
    const read = { type: "read", token, code };
    assert.equal((await postResponse(publicPath, { ...read, code: randomBytes(12).toString("hex") })).status, 404);
    assert.equal((await postResponse(publicPath, { ...read, token: primaryToken })).status, 404);
    assert.equal((await postResponse("/api/demo-application", { type: "read", token })).status, 404);
    const manifest = await post(publicPath, read);
    assert.deepEqual(manifest.files.map(({ label }) => label), [
      "Reviewed 1003 · MISMO 3.4 XML · Fictional Wholesale · Registration v1", "Photo ID · Co-borrower",
    ]);
    assert.equal(manifest.applicationRevision, application.revision);
    assert.match(manifest.reference, /^[0-9a-f]{12}$/);
    const packageVersion = `r${application.revision}-${manifest.reference}`;
    assert.deepEqual(manifest.files.map(({ filename }) => filename),
      [`orbit-fictional-1003-${packageVersion}.xml`, `orbit-fictional-evidence-${packageVersion}-1.pdf`]);
    const get = (slot) => runtime.dispatchFetch(`${origin}${publicPath}`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ ...read, type: "download", slot }) });
    assert.equal((await get(2)).status, 404);
    const xml = await get(0);
    assert.equal(xml.status, 200);
    assert.equal(xml.headers.get("Content-Disposition"), `attachment; filename="${manifest.files[0].filename}"`);
    const xmlContent = await xml.text();
    assert.match(xmlContent, /MISMOReferenceModelIdentifier/);
    assert.match(xmlContent, /<FirstName>Jordan<\/FirstName>/);
    const pdf = await get(1);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
    assert.equal(pdf.headers.get("Content-Disposition"), `attachment; filename="${manifest.files[1].filename}"`);
    assert.match(pdf.headers.get("Cache-Control"), /no-store/);
    assert.deepEqual(new Uint8Array(await pdf.arrayBuffer()), demoDocumentPdf("replacement"));
    const staffRead = await post(staffPath, { type: "read", loanId }, officer);
    assert.deepEqual(staffRead.shares[0].files.map(({ downloads }) => downloads), [1, 1]);
    const lenderFile = { lender: share.recipient, externalId: "JOINT-ACKNOWLEDGED" };
    const acknowledgment = { type: "recordManualHandoff", loanId, revision: application.revision, lenderRevision: share.lenderRevision,
      profile: share.profile, eventId: randomUUID(), outcome: "Acknowledged", note: "", lenderFile };
    const acknowledged = await write(officer, acknowledgment);
    const submissionId = acknowledged.loanWork.applications[0].manualHandoff.submissionId;
    assert.equal(acknowledged.loanWork.manualReturn, undefined);
    const conditionId = randomUUID();
    await loanAction(officer, loanId, "saveManualCondition", { submissionId, conditionId, revision: 0, category: "Income",
      owner: "Loan officer", description: "Fictional joint income evidence" });
    const note = "Confirm the primary borrower’s fictional phone number.";
    const responseId = randomUUID();
    const lenderReturn = { type: "requestApplicationCorrection", loanId, revision: application.revision,
      recipient: "Primary borrower", note, lenderReturn: { eventId: responseId, submissionId, lenderRevision: share.lenderRevision } };
    assert.match((await write(officer, lenderReturn)).message, /primary borrower can reopen/);
    assert.match((await write(officer, lenderReturn)).message, /already recorded/);
    assert.match((await action(officer, "mutate", { ...lenderReturn, recipient: "Co-borrower" })).error, /new lender return/);
    assert.equal((await fileExceptions("Manual lender returns")).items.find((item) => item.id === submissionId).action, "Open primary borrower corrections");
    assert.equal((await incoming(officer, "today")).items.find((item) => item.id === submissionId).returnStatus, "Waiting on primary borrower");
    assert.equal((await get(1)).status, 404);
    assert.equal((await post(staffPath, { type: "read", loanId }, officer)).shares[0].status, "File changed");
    assert.equal((await post(staffPath, { type: "revoke", loanId, shareId: share.shareId }, officer)).shares[0].status, "Revoked");
    assert.equal(await directory.brokerageForPortal(token), null);
    assert.equal((await postResponse(publicPath, read)).status, 404);
    const primary = await borrower(primaryToken, { type: "read" });
    const co = await post("/api/joint-application", { type: "read", token: coToken });
    assert.equal(primary.correctionNote, note);
    assert.ok(co.submittedAt);
    assert.equal(co.complete, false);
    assert.ok(!JSON.stringify(co).includes(note));
    primary.draft.phone = "248-555-0182";
    const corrected = await borrower(primaryToken, { type: "submit", revision: primary.revision, step: applicationSteps.length - 1, draft: primary.draft });
    const revised = (await file(officer, loanId)).applications[0];
    assert.deepEqual(revised.draft.urla.additional, application.draft.urla.additional);
    assert.equal(revised.versions.length, 3);
    assert.equal((await incoming(officer, "today")).items.find((item) => item.id === submissionId).returnStatus, manualReturnStatus.review);
    await loanAction(officer, loanId, "reviewApplication", { revision: corrected.revision });
    const [pendingRevisedReview] = (await review({ type: "loan" })).reviews;
    const { review: revisedReview } = await review({ type: "detail", id: pendingRevisedReview.id });
    assert.equal(revisedReview.applicationRevision, corrected.revision);
    const reapproved = await review({ type: "decide", id: pendingRevisedReview.id, revision: revisedReview.revision,
      eventId: randomUUID(), decision: "Approved", note: "Verified the corrected joint 1003." });
    assert.equal(reapproved.kind, "saved", reapproved.error);
    const revisedAck = { ...acknowledgment, revision: corrected.revision, eventId: randomUUID() };
    assert.match((await action(officer, "mutate", revisedAck)).error, /Prepare the MISMO export/);
    const correctedExport = await loanAction(officer, loanId, "exportReviewedApplication", { revision: corrected.revision,
      lenderRevision: share.lenderRevision, profile: share.profile, eventId: randomUUID(), names: share.names });
    assert.match(correctedExport.mismoXml, /2485550182/);
    assert.match(correctedExport.mismoXml, /2485550157/);
    const reacknowledged = await write(officer, revisedAck);
    assert.equal(reacknowledged.loanWork.submissions.length, 1);
    assert.equal(reacknowledged.loanWork.submissions[0].conditions[0].id, conditionId);
    assert.equal(reacknowledged.loanWork.manualReturn, undefined);
    assert.ok(!(await fileExceptions("Manual lender returns")).items.some((item) => item.loanId === loanId));
  });
  await stage("Processor prepares income and an LO prices from the exact approved worksheet", async () => {
    const created = await write(officer, { type: "loan", contactId: "", borrower: "Fictional Income Review",
      borrowerEmail: "working-day-income@example.test", start1003: true, partnerId: null, officer: officer.name,
      address: "", amount: 0, purpose: "Purchase", stage: "Lead" });
    const loanId = created.loanWork.loanId;
    const token = (await file(officer, loanId)).applications[0].token;
    const draft = await borrower(token, { type: "read" });
    const sent = await borrower(token, { type: "submit", revision: draft.revision, step: applicationSteps.length - 1,
      draft: { ...sampleApplication(draft.draft), confirmedDemo: true } });
    await loanAction(officer, loanId, "reviewApplication", { revision: sent.revision });
    await team(owner, { type: "assignProcessor", email: processor.email, loanId, revision: 0 });
    await loanAction(processor, loanId, "requestDocument", { kind: "Pay stub", instructions: "Fictional payroll period sample." });
    const checklist = (await borrower(token, { type: "status" })).loanStatus.documents;
    const item = checklist.find(({ kind }) => kind === "Pay stub");
    const received = (await borrower(token, { type: "attachSample", requestId: item.id, revision: item.revision, statusOnly: true }))
      .loanStatus.documents.find(({ id }) => id === item.id);
    await loanAction(processor, loanId, "reviewDocument", { requestId: item.id, revision: received.revision, decision: "Accepted", replacementNote: "" });
    const path = `/api/income-worksheet?brokerage=${brokerage}`;
    const query = { type: "read", loanId };
    assert.equal((await postResponse(path, query, competingOfficer)).status, 409);
    const orderId = randomUUID();
    await loanAction(processor, loanId, "createServiceOrder", { orderId, kind: "Income verification", recipient: "Primary borrower", dueOn: today, note: "" });
    const serviceReturn = { orderId, revision: 0, action: "Simulate return", note: "" };
    await loanAction(processor, loanId, "updateServiceOrder", serviceReturn);
    assert.ok(!(await post(path, query, processor)).page.eligible.some(({ id }) => id === orderId));
    await loanAction(processor, loanId, "updateServiceOrder", { ...serviceReturn, revision: 1, action: "Accept" });
    const page = (await post(path, query, processor)).page;
    assert.equal(page.canApprove, false);
    const accepted = page.eligible.find(({ id }) => id === item.id);
    const verification = page.eligible.find(({ id }) => id === orderId);
    assert.match(verification.returnReference, /^MOCK-INCOME-VERIFICATION-/);
    assert.equal(verification.verification.acceptedBy, processor.name);
    const source = { id: randomUUID(), recipient: "Primary borrower", label: "Fictional payroll",
      kind: "Wages", method: "Amount per pay period", included: true, start: "2026-06-01", end: "2026-06-15",
      amount: 325000, periods: 24, adjustment: 0, rationale: "", evidence: [{ id: accepted.id, revision: accepted.revision },
        { id: orderId, revision: verification.revision, returnReference: verification.returnReference }] };
    const change = (type, revision, fields = {}) => ({ type, loanId, revision, applicationRevision: sent.revision, requestId: randomUUID(), ...fields });
    const save = change("save", 0, { sources: [source] });
    assert.equal((await post(path, save, processor)).page.record.amount, 650000);
    const submit = await post(path, change("submit", 1), processor);
    assert.equal(submit.page.record.stage, "Ready for review");
    const approve = change("approve", 2, { note: "Reconciled the fictional pay stub." });
    assert.equal((await postResponse(path, approve, processor)).status, 409);
    const approved = (await post(path, approve, officer)).page.record;
    assert.equal(approved.amount, 650000);
    assert.equal(approved.stage, "Approved");
    assert.equal(approved.revision, 3);
    assert.deepEqual(approved.evidence.find(({ id }) => id === orderId), verification);
    const pricing = { applicationRevision: sent.revision, incomeReviewRevision: approved.revision, scenario: {
      purpose: "Purchase", loanAmount: Number(sent.draft.loanAmount), propertyValue: Number(sent.draft.estimatedValue), purchasePrice: null,
      zip: sent.draft.propertyLocation.zip.slice(0, 5), creditScore: 760, monthlyIncome: 6500, occupancy: sent.draft.occupancy,
      propertyType: "Single family", firstTimeBuyer: false,
    } };
    const priced = await loanAction(officer, loanId, "runPricing", pricing);
    const run = priced.state.pricingRuns.find((item) => item.loanId === loanId);
    assert.equal(run.incomeReviewRevision, 3);
    assert.equal(run.incomeReviewCurrent, true);
    const selection = { runId: run.id, offerId: run.offers[0].id };
    await loanAction(officer, loanId, "selectOffer", selection);
    await loanAction(officer, loanId, "publishQuote", selection);
    assert.ok((await borrower(token, { type: "status" })).loanStatus.quote);
    assert.doesNotMatch(JSON.stringify(await borrower(token, { type: "status" })), /MOCK-INCOME-VERIFICATION|Reconciled the fictional/);
    await post(path, change("save", 3, { sources: [{ ...source, rationale: "Recheck fictional payroll details." }] }), processor);
    assert.equal((await file(officer, loanId)).pricingRuns.find(({ id }) => id === run.id).incomeReviewCurrent, false);
    assert.equal((await borrower(token, { type: "status" })).loanStatus.quote, null);
    assert.match((await action(officer, "mutate", { type: "runPricing", loanId, ...pricing })).error, /reviewed income/i);
    assert.match((await action(officer, "mutate", { type: "publishQuote", loanId, ...selection })).error, /reviewed income/i);
    assert.equal((await post(path, query, officer)).page.history[0].note, "Reconciled the fictional pay stub.");
    const historical = (await post(path, { ...query, worksheetRevision: run.incomeReviewRevision }, officer)).page;
    assert.equal(historical.record.revision, 4);
    assert.deepEqual(historical.requested, approved);
    assert.equal((await postResponse(path, { ...query, worksheetRevision: run.incomeReviewRevision }, competingOfficer)).status, 409);
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
  await stage("The winning shared-queue claimant keeps the same callback when starting the 1003", async () => {
    const claimCampaignId = randomUUID();
    const name = "Fictional Shared Callback";
    const email = "shared-callback@example.test";
    const zip = "48304";
    await write(owner, { type: "createCallCampaign", id: claimCampaignId, name: "Fictional shared callback QA" });
    const rows = parseCampaignLeadCsv(`id,name,email,phone,purpose,zip\nshared-callback,${name},${email},313-555-0197,Purchase,${zip}`, dueAt);
    const imported = await importRows({ type: "migratePipeline", origin: campaignOrigin(claimCampaignId), campaignId: claimCampaignId, decisions: {}, rows });
    const leadId = imported.rows[0].targetId;
    const refresh = async (staff) => (await write(staff, { type: "refreshCampaignQueue", campaignId: claimCampaignId })).campaignQueue;
    const actors = [officer, competingOfficer];
    const initial = await Promise.all(actors.map(refresh));
    assert.ok(initial.every(({ inboxLeads }) => inboxLeads.some(({ id, officerEmail }) => id === leadId && officerEmail === null)));
    const claims = await Promise.all(actors.map((staff) =>
      action(staff, "mutate", { type: "assignInboxLead", leadId, email: staff.email, previousEmail: null })));
    const winner = actors[claims.findIndex(({ leadWork }) => leadWork?.lead.id === leadId)];
    const loser = actors.find((staff) => staff !== winner);
    assert.ok(winner);
    assert.equal(claims.filter(({ claimConflict }) => claimConflict).length, 1);
    const reconciled = (await write(loser, { type: "openCampaigns", campaignId: claimCampaignId, loadIntake: false })).campaignNavigation;
    assert.ok(!reconciled.campaigns.some(({ id }) => id === claimCampaignId));
    assert.ok(!reconciled.queue?.inboxLeads.some(({ id }) => id === leadId));
    const lead = (await refresh(winner)).inboxLeads.find(({ id }) => id === leadId);
    const callbackAt = new Date(now + 7 * 86_400_000).toISOString();
    const logged = await write(winner, { type: "recordCampaignCall", campaignId: claimCampaignId, leadId,
      revision: lead.followUp.revision, outcome: "Requested callback", note: "Fictional borrower requested this time.", callbackAt });
    const taskId = logged.leadWork.member.callbackTaskId;
    const personal = async (staff) => (await upcomingCallbacks(staff)).items.find((item) => item.taskId === taskId);
    const before = await personal(winner);
    assert.equal(before.dueAt, callbackAt);
    const originalLink = { leadId, task: { kind: "campaign", id: taskId, expectedCallbackAt: callbackAt } };
    assert.equal((await action(winner, "readLeadForWork", originalLink)).lead.id, leadId);
    const conversationPath = `/api/conversation-start?brokerage=${brokerage}`;
    const start = { start: { type: "startLead", leadId }, queue: { filter: "Active", mine: true } };
    assert.equal((await postResponse(conversationPath, start)).status, 401);
    assert.equal((await postResponse(conversationPath, start, loser)).status, 409);
    assert.equal((await postResponse(conversationPath, start, processor)).status, 409);
    const [firstThread, sameThread] = await Promise.all([post(conversationPath, start, winner), post(conversationPath, start, winner)]);
    assert.equal(sameThread.id, firstThread.id);
    assert.equal(firstThread.opened.thread.id, firstThread.id);
    assert.equal(firstThread.opened.thread.leadId, leadId);
    assert.deepEqual(firstThread.opened.thread.campaignCallback, { leadId, taskId, dueAt: callbackAt });
    assert.ok(firstThread.opened.events.some(({ text, origin }) => origin === "Lead log" && text.includes("Fictional borrower requested this time.")));
    assert.equal(firstThread.queue.rows.filter(({ id }) => id === firstThread.id).length, 1);
    const beforeConversion = { ...await workspace(winner), loans: [], applications: [], campaignQueueFiles: [] };
    const saved = await post(`/api/lead-conversion?brokerage=${brokerage}`,
      { type: "convertReferral", referralId: leadId, contactId: null }, winner);
    const { referralLoanId: loanId, convertedLead, convertedCampaign, inboxLoan } = saved;
    assert.equal(convertedLead.id, leadId);
    assert.equal(convertedCampaign.members.find((member) => member.leadId === leadId).loanId, loanId);
    for (const snapshot of [convertedCampaign, undefined]) {
      const view = applyLeadConversion(beforeConversion, convertedLead, inboxLoan, snapshot);
      const card = view.callCampaignMembers.find((member) => member.leadId === leadId);
      assert.equal(card.loanId, loanId);
      assert.equal(card.resolvedAt, convertedLead.resolvedAt);
      assert.ok(!view.inboxLeads.some(({ id }) => id === leadId));
      assert.deepEqual(view.campaignQueueFiles.filter(({ id }) => id === loanId), [{
        id: loanId, officer: winner.name, amount: 0, stage: "Lead", submittedAt: null, fundingDate: null,
      }]);
    }
    const converted = await file(winner, loanId);
    assert.equal(converted.loans[0].officerEmail, winner.email);
    const application = await borrower(converted.applications[0].token, { type: "read" });
    assert.equal(application.draft.borrowerName, name);
    assert.equal(application.draft.email, email);
    assert.equal(application.draft.propertyLocation.zip, zip);
    assert.deepEqual(await personal(winner), { ...before, loanId });
    const carriedThread = await post(conversationPath, { ...start, queue: { filter: "Closed", mine: true } }, winner);
    assert.equal(carriedThread.id, firstThread.id);
    assert.equal(carriedThread.opened.thread.loanId, loanId);
    assert.deepEqual(carriedThread.opened.thread.campaignCallback, { loanId, taskId, dueAt: callbackAt });
    assert.deepEqual(carriedThread.opened.events, firstThread.opened.events);
    assert.ok(!carriedThread.queue.rows.some(({ id }) => id === firstThread.id));
    assert.equal((await postResponse(conversationPath, start, loser)).status, 409);
    const carriedLink = await action(winner, "readLeadForWork", originalLink);
    assert.equal(carriedLink.loanWork.loanId, loanId);
    assert.equal(carriedLink.callbackTaskId, taskId);
    assert.equal(carriedLink.loanWork.tasks.find(({ id }) => id === taskId).dueAt, callbackAt);
    for (const staff of [loser, owner, processor]) assert.ok((await action(staff, "readLeadForWork", originalLink)).error);
    assert.equal(await personal(loser), undefined);
    assert.ok((await action(loser, "readLoanForWork", loanId)).error);
  });
  await stage("A first conversation opens on the loan after conversion in another tab", async () => {
    const campaignId = randomUUID();
    await write(owner, { type: "createCallCampaign", id: campaignId, name: "Fictional conversion before conversation" });
    const rows = parseCampaignLeadCsv("id,name,email,phone,purpose,zip\nconversation-after-conversion,Fictional Late Conversation,late-conversation@example.test,313-555-0198,Purchase,48067", dueAt);
    const imported = await importRows({ type: "migratePipeline", origin: campaignOrigin(campaignId), campaignId, decisions: {},
      rows: rows.map((row) => ({ ...row, ownerEmail: officer.email })) });
    const leadId = imported.rows[0].targetId;
    const current = (await action(officer, "readInboxWork", { type: "open", id: leadId })).lead;
    const callbackAt = new Date(now + 5 * 86_400_000).toISOString();
    const logged = await write(officer, { type: "recordCampaignCall", campaignId, leadId, revision: current.followUp.revision,
      outcome: "Requested callback", note: "Fictional call before the first conversation.", callbackAt });
    const taskId = logged.leadWork.member.callbackTaskId;
    const source = { type: "lead", leadId };
    assert.equal((await action(officer, "readConversationWork", source)).kind, "new");
    const conversion = await post(`/api/lead-conversion?brokerage=${brokerage}`, { type: "convertReferral", referralId: leadId, contactId: null }, officer);
    const loanId = conversion.referralLoanId;
    assert.equal((await action(officer, "readConversationWork", source)).convertedLoan, true);
    const path = `/api/conversation-start?brokerage=${brokerage}`;
    const start = { start: { type: "startLead", leadId }, queue: { filter: "Active", mine: true } };
    assert.equal((await postResponse(path, start, competingOfficer)).status, 409);
    const [first, repeated] = await Promise.all([post(path, start, officer), post(path, start, officer)]);
    assert.equal(first.id, repeated.id);
    assert.equal(first.opened.thread.loanId, loanId);
    assert.equal(first.opened.thread.audience, "Borrower");
    assert.deepEqual(first.opened.thread.campaignCallback, { loanId, taskId, dueAt: callbackAt });
    assert.ok(first.opened.events.some(({ text, origin }) => origin === "Lead log" && text.includes("Fictional call before the first conversation.")));
    assert.equal(first.queue.rows.filter(({ id }) => id === first.id).length, 1);
    assert.equal((await action(officer, "readConversationWork", source)).thread.id, first.id);
  });
  await stage("Shared custom reports scope totals and exact drilldowns to each signed-in role", async () => {
    const reportWork = (staff, input) => action(staff, "accessCustomReport", input);
    const save = { type: "save", id: randomUUID(), revision: 0, definition: { name: "Fictional website intake report",
      dataset: "Intake cohort", period: { kind: "Last 30 days" }, groupBy: "Lead source", metrics: ["inquiries", "converted"],
      columns: ["Loan officer", "Purpose"], source: "Website quote request", purpose: "Purchase", roles: ["LO"] } };
    assert.ok((await reportWork(officer, save)).error);
    const { report } = await reportWork(owner, save);
    const reference = { id: report.id, revision: report.revision };
    const totals = await reportWork(owner, { type: "run", ...reference });
    const officerTotals = await reportWork(officer, { type: "run", ...reference });
    assert.ok(totals.totals.inquiries > officerTotals.totals.inquiries);
    assert.ok(officerTotals.totals.inquiries > 0);
    assert.ok((await reportWork(processor, { type: "run", ...reference })).error);
    assert.ok((await action(owner, "accessCustomReport", { type: "run", ...reference }, undefined, randomUUID())).error);
    const files = await reportWork(officer, { type: "records", ...reference, metric: "inquiries", group: "Website quote request" });
    assert.ok(files.rows.every(({ values }) => values["Loan officer"] === officer.name));
    assert.ok(files.rows.some(({ destination }) => destination.kind === "loan" && destination.id === quoteFile.id));
    const privateReport = await reportWork(owner, { ...save, revision: reference.revision, definition: { ...save.definition, roles: [] } });
    assert.equal(privateReport.report.revision, 2);
    assert.ok((await reportWork(officer, { type: "records", ...reference, metric: "inquiries" })).error);
    assert.ok(!(await reportWork(officer, { type: "list" })).reports.some(({ id }) => id === reference.id));

    const assigned = (await file(owner, quoteFile.id)).loanProcessing[0];
    if (assigned?.processorEmail !== processor.email) {
      await team(owner, { type: "assignProcessor", email: processor.email, loanId: quoteFile.id, revision: assigned?.revision ?? 0 });
    }
    const production = await reportWork(owner, { ...save, id: randomUUID(), definition: {
      ...save.definition, name: "Fictional assigned production report", dataset: "Loan production", groupBy: "Current stage",
      metrics: ["files"], roles: ["Processor"],
    } });
    const productionRef = { id: production.report.id, revision: production.report.revision };
    const processorResults = await reportWork(processor, { type: "records", ...productionRef, metric: "files" });
    assert.ok(processorResults.rows.some(({ destination }) => destination.id === quoteFile.id));
    assert.equal((await reportWork(processor, { type: "run", ...productionRef })).totals.files, processorResults.rows.length);
    for (const { destination } of processorResults.rows) assert.equal((await file(processor, destination.id)).loans[0].id, destination.id);
    assert.ok((await reportWork(officer, { type: "run", ...productionRef })).error);
  });
  await stage("CRM field filtering follows the converted loan and sharing can be revoked", async () => {
    const reportWork = (staff, input) => action(staff, "accessCustomReport", input);
    const save = { type: "save", id: randomUUID(), revision: 0, definition: { name: "Fictional priority intake",
      dataset: "Intake cohort", period: { kind: "Last 30 days" }, groupBy: "Lead source", metrics: ["inquiries"],
      columns: ["Loan officer"], source: "", purpose: "", roles: ["LO"], customFilter: { fieldId: crmFieldId, value: "Priority" } } };
    const { report } = await reportWork(owner, save);
    const ref = { id: report.id, revision: report.revision };
    const run = { type: "run", ...ref };
    const records = { type: "records", ...ref, metric: "inquiries" };
    const officerRun = await reportWork(officer, run);
    assert.equal(officerRun.totals.inquiries, 1);
    assert.deepEqual((await reportWork(officer, records)).rows.map(({ destination }) => destination), [{ kind: "loan", id: quoteFile.id }]);
    assert.equal((await reportWork(competingOfficer, run)).totals.inquiries, 0);
    const download = { type: "export", ...ref, from: officerRun.from, through: officerRun.through,
      metric: "inquiries", group: "Website quote request" };
    const csv = await reportWork(officer, download);
    assert.equal(csv.count, 1);
    assert.deepEqual(readCsv(csv.csv)[1].slice(4, 6), ["loan", quoteFile.id]);
    assert.equal((await reportWork(competingOfficer, download)).count, 0);
    assert.ok((await action(officer, "accessCustomReport", download, undefined, randomUUID())).error);
    assert.equal((await action(owner, "accessCrmFields", { type: "saveField", fieldId: crmFieldId, revision: 1,
      definition: { label: "Fictional outreach tier", kind: "Choice", options: ["Priority", "Standard"], roles: [] } })).kind, "savedField");
    assert.ok((await reportWork(officer, run)).error);
    assert.ok((await reportWork(officer, records)).error);
    assert.ok((await reportWork(officer, download)).error);
    assert.equal((await reportWork(owner, run)).totals.inquiries, 1);
    assert.equal((await action(owner, "accessCrmFields", { type: "archiveField", fieldId: crmFieldId, revision: 2 })).kind, "archived");
    assert.ok((await reportWork(owner, run)).error);
    assert.ok((await reportWork(owner, download)).error);
  });
  await stage("Loan fields use assigned staff permissions and filter production exports", async () => {
    const fields = (staff, input) => action(staff, "accessCrmFields", input);
    const reportWork = (staff, input) => action(staff, "accessCustomReport", input);
    const fieldId = randomUUID();
    const create = { type: "saveField", fieldId, revision: 0,
      definition: { label: "Fictional closing lane", kind: "Choice", options: ["Escalated QA", "Normal QA"], recordScope: "Loan file",
        roles: ["LO", "Processor"], editRoles: ["Processor"] } };
    assert.equal((await fields(owner, create)).kind, "savedField");
    const record = { record: "loan", recordId: quoteFile.id };
    const set = { ...record, type: "saveValue", fieldId, fieldRevision: 1, revision: 0, value: "Escalated QA" };
    assert.ok((await fields(officer, set)).error);
    assert.ok((await fields(competingOfficer, set)).error);
    assert.equal((await fields(processor, set)).entries[0].value, "Escalated QA");
    assert.equal((await fields(officer, { ...record, type: "values" })).entries[0].editable, false);
    const snapshot = await borrower(quoteFile.token, { type: "read" });
    assert.doesNotMatch(JSON.stringify(snapshot), /Fictional closing lane|Escalated QA/);
    const { report } = await reportWork(owner, { type: "save", id: randomUUID(), revision: 0, definition: {
      name: "Fictional loan lane", dataset: "Loan production", period: { kind: "Last 30 days" }, groupBy: "Current stage",
      metrics: ["files"], columns: ["Purpose"], source: "", purpose: "", roles: ["LO", "Processor"],
      customFilter: { fieldId, value: "Escalated QA" },
    } });
    const ref = { id: report.id, revision: report.revision };
    const run = await reportWork(processor, { type: "run", ...ref });
    assert.equal(run.totals.files, 1);
    const download = { type: "export", ...ref, from: run.from, through: run.through };
    const csv = await reportWork(processor, download);
    assert.deepEqual(readCsv(csv.csv)[1].slice(4, 6), ["loan", quoteFile.id]);
    assert.equal((await reportWork(competingOfficer, download)).count, 0);
    assert.equal((await fields(owner, { ...create, revision: 1, definition: { ...create.definition, roles: ["LO"], editRoles: [] } })).kind, "savedField");
    assert.deepEqual((await fields(processor, { ...record, type: "values" })).entries, []);
    assert.ok((await reportWork(processor, download)).error);
    assert.equal((await reportWork(officer, download)).count, 1);
  });
  await stage("Brokerage policy sends closing and funding holds to their exact evidence", async () => {
    const created = await write(officer, { type: "loan", contactId: "", borrower: "Fictional gated closing",
      borrowerEmail: "working-day-closing-gates@example.test", partnerId: null, officer: officer.name,
      address: "", amount: 360000, purpose: "Purchase", stage: "Lead" });
    const loanId = created.loanWork.loanId;
    const policy = (staff, input) => action(staff, "accessClosingGates", input);
    const read = { type: "loan", loanId };
    const items = async () => (await action(owner, "readManagerFileExceptions", { filter: "Closing and funding holds" })).items.filter((item) => item.loanId === loanId);
    await loanAction(officer, loanId, "saveClosingTarget", { targetDate: today, previous: null });
    const checklist = { itemId: randomUUID(), revision: 0, title: "Fictional funding evidence", owner: "Loan officer", dueDate: today };
    await loanAction(officer, loanId, "saveClosingItem", checklist);
    const publish = { type: "publish", revision: 0, rules: { closing: ["checklist"], funding: ["1003"] },
      reason: "Rehearse distinct closing and funding evidence." };
    assert.ok((await policy(officer, publish)).error);
    assert.ok((await action(owner, "accessClosingGates", publish, undefined, randomUUID())).error);
    assert.equal((await policy(owner, publish)).revision, 1);
    assert.ok((await policy(competingOfficer, read)).error);
    const close = { type: "recordClosing", loanId, revision: 0, closingDate: today };
    assert.match((await action(officer, "mutate", close)).error, /before recording closing/);
    assert.deepEqual((await items()).map(({ status, target, dueOn }) => [status, target, dueOn]),
      [["Before closing", `closing-checklist-${checklist.itemId}`, today]]);
    await loanAction(officer, loanId, "completeClosingItem", { itemId: checklist.itemId, revision: 1, completed: true });
    await write(officer, close);
    assert.deepEqual((await items()).map(({ status, target }) => [status, target]), [["Before funding", "loan-application"]]);
    const reason = "Approved the sample funding override for this test.";
    const { funding } = await policy(owner, read);
    const fund = { type: "recordFunding", loanId, revision: 0, fundingDate: today, gateOverride: { key: funding.key, reason } };
    assert.match((await action(officer, "mutate", fund)).error, /Only a brokerage admin/);
    await write(owner, fund);
    await write(owner, fund);
    assert.deepEqual(await items(), []);
    const audit = (await action(owner, "mutate", { type: "loadLoanAudit", loanId })).loanAudit;
    const overrides = audit.filter(({ action }) => action === "Overrode required funding checks");
    assert.equal(overrides.length, 1);
    assert.ok(overrides[0].changes.some(({ field, after }) => field === "Reason" && after === reason));
    assert.equal((await policy(owner, { ...publish, revision: 1, rules: { closing: [], funding: [] } })).revision, 2);
  });
  async function verifyQuotedManualFile(purpose) {
    const isPurchase = purpose === "Purchase";
    const borrowerName = `Fictional Harbor ${purpose}`;
    const created = await write(officer, { type: "loan", contactId: "", borrower: borrowerName,
      borrowerEmail: `working-day-harbor-${purpose.toLowerCase()}@example.test`, start1003: true, partnerId: null, officer: officer.name,
      address: "", amount: 0, purpose, stage: "Lead" });
    const loanId = created.loanWork.loanId;
    const { token } = (await file(officer, loanId)).applications[0];
    const application = await borrower(token, { type: "read" });
    const draft = { ...sampleApplication(application.draft), confirmedDemo: true };
    const submitted = await borrower(token, { type: "submit", revision: application.revision, step: applicationSteps.length - 1, draft });
    await loanAction(officer, loanId, "reviewApplication", { revision: submitted.revision });
    await loanAction(officer, loanId, "saveLenderDetails", { revision: 0, details: {
      originator: { fields: { originator: officer.name, originatorNmls: "999991", organization: "Fictional Harbor Brokerage", organizationNmls: "999992" } },
      supplement: { fields: { mortgage: "Conventional", mortgageLien: "First lien", ...(isPurchase ? { purchasePrice: "450000" } :
        { refinance: "No cash out", refinanceProgram: "Full documentation", mortgagePayoffs: "345000" }) } },
    } });
    const scenario = { purpose, loanAmount: Number(draft.loanAmount), propertyValue: 450000, purchasePrice: isPurchase ? 450000 : null,
      zip: draft.propertyLocation.zip, creditScore: 760, monthlyIncome: 9500, occupancy: "Primary residence",
      propertyType: "Single family", firstTimeBuyer: false };
    const [run] = (await loanAction(officer, loanId, "runPricing", { scenario, applicationRevision: submitted.revision })).state.pricingRuns
      .filter((item) => item.loanId === loanId);
    const manualQuote = { runId: run.id, offerId: randomUUID() };
    const details = { lender: "Fictional Harbor Wholesale", reference: "HARBOR-QA-102", product: "Flex fixed", years: 20, rate: 5.875,
      apr: null, adjustment: -0.25, quotedOn: today, expiresOn: shiftReportDate(today, 7) };
    const add = () => loanAction(officer, loanId, "addManualQuote", { ...manualQuote, details });
    assert.match((await add()).message, /added to this pricing scenario/);
    assert.match((await add()).message, /already added/);
    await loanAction(officer, loanId, "selectOffer", manualQuote);
    assert.match((await action(officer, "mutate", { type: "sendApplication", loanId, revision: submitted.revision })).error, /Manual lender export/);
    const base = { loanId, revision: submitted.revision, lenderRevision: 1, profile: "fictional-wholesale-v1", manualQuote };
    const names = [{ first: "Fictional", middle: "Harbor", last: purpose, suffix: "" }];
    const result = await write(officer, { type: "exportReviewedApplication", ...base, eventId: randomUUID(), names });
    assert.match(result.mismoXml, /<NoteRatePercent>5\.875<\/NoteRatePercent>/);
    assert.match(result.mismoXml, /<LoanAmortizationPeriodCount>240<\/LoanAmortizationPeriodCount>/);
    assert.ok(result.mismoXml.includes(`<LoanPurposeType>${purpose}</LoanPurposeType>`));
    if (!isPurchase) assert.match(result.mismoXml, /<RefinanceCashOutDeterminationType>NoCashOut<\/RefinanceCashOutDeterminationType>/);
    const acknowledge = { type: "recordManualHandoff", ...base, eventId: randomUUID(), outcome: "Acknowledged", note: "",
      lenderFile: { lender: details.lender, externalId: `HARBOR-ACK-${purpose.toUpperCase()}` } };
    assert.match((await action(officer, "mutate", acknowledge)).error, /approved second review/i);
    const review = (input) => action(owner, "workOnLoanReview", { loanId, ...input });
    const [pending] = (await review({ type: "loan" })).reviews;
    const { review: currentReview } = await review({ type: "detail", id: pending.id });
    const approval = await review({ type: "decide", id: pending.id, revision: currentReview.revision, eventId: randomUUID(),
      decision: "Approved", note: "Verified the fictional lender handoff application." });
    assert.equal(approval.kind, "saved", approval.error);
    await write(officer, acknowledge);
    const [saved] = (await file(officer, loanId)).applications;
    assert.equal(saved.manualHandoff.acknowledgedQuote.reference, details.reference);
    assert.equal(saved.manualHandoff.acknowledgedQuote.offerId, manualQuote.offerId);
    assert.doesNotMatch(JSON.stringify(await borrower(token, { type: "status" })), /HARBOR-QA-102/);
    const submissionId = saved.manualHandoff.submissionId;
    const condition = { submissionId, conditionId: randomUUID() };
    await loanAction(officer, loanId, "saveManualCondition", { ...condition, revision: 0, category: "Income",
      owner: "Loan officer", description: "Confirm fictional income." });
    await loanAction(officer, loanId, "requestDocument", { kind: "Pay stub", instructions: "Use sample evidence.", condition });
    const [requested] = (await file(officer, loanId)).documentRequests;
    await borrower(token, { type: "attachSample", statusOnly: true, requestId: requested.id, revision: requested.revision });
    const [received] = (await file(officer, loanId)).documentRequests;
    await loanAction(officer, loanId, "reviewDocument", { requestId: received.id, revision: received.revision, decision: "Accepted", replacementNote: "" });
    const [accepted] = (await file(officer, loanId)).documentRequests;
    await loanAction(officer, loanId, "recordManualDelivery", { ...condition, revision: 1, documentRevision: accepted.revision, reference: "HARBOR-SAMPLE-DOC" });
    await loanAction(officer, loanId, "recordManualClearance", { ...condition, revision: 2, cleared: true, confirmation: "HARBOR-SAMPLE-CLEAR" });
    const cleared = await file(officer, loanId);
    assert.equal(closingReviewReady(cleared.loans[0], cleared), true);
    const pipelineAction = async () => (await action(officer, "readPipelineWork", {
      view: "List", search: borrowerName, filters: emptyPipelineFilters,
    })).list.loans.find(({ id }) => id === loanId).action;
    assert.equal((await pipelineAction()).title, "Review closing readiness");
    const preflight = async () => (await review({ type: "preflight" })).preflight.checks.find(({ id }) => id === "lender");
    assert.equal((await preflight()).state, "Ready");
    assert.match((await preflight()).detail, /HARBOR-QA-102/);

    const revisedQuote = { runId: run.id, offerId: randomUUID() };
    await loanAction(officer, loanId, "addManualQuote", { ...revisedQuote, details: { ...details, reference: "HARBOR-QA-REVISED", rate: 6.125 } });
    await loanAction(officer, loanId, "selectOffer", revisedQuote);
    const changed = await action(officer, "checkLoanHandoff", loanId, cleared.handoffVersion);
    assert.equal(changed.applications[0].manualHandoff.acknowledgmentOutdated, true);
    assert.equal(closingReviewReady(changed.loans[0], changed), false);
    assert.equal((await pipelineAction()).target, "manual-lender-export");
    assert.equal((await preflight()).target, "manual-lender-export");
    const closing = { type: "recordClosing", loanId, closingDate: today, revision: 0 };
    assert.match((await action(officer, "mutate", closing)).error, /current MISMO handoff/);
    assert.match((await action(officer, "mutate", { type: "move", id: loanId, stage: "Clear to Close" })).error, /current MISMO handoff/);
    const revisedBase = { ...base, manualQuote: revisedQuote };
    const replacement = await write(officer, { type: "exportReviewedApplication", ...revisedBase, eventId: randomUUID(), names });
    assert.match(replacement.mismoXml, /<NoteRatePercent>6\.125<\/NoteRatePercent>/);
    assert.equal((await preflight()).target, "manual-lender-acknowledgment");
    await write(officer, { ...acknowledge, ...revisedBase, eventId: randomUUID() });
    const ready = await file(officer, loanId);
    assert.equal(ready.submissions.length, 1);
    assert.equal(ready.submissions[0].id, submissionId);
    assert.deepEqual(ready.submissions[0].conditions, cleared.submissions[0].conditions);
    assert.equal((await preflight()).state, "Ready");
    await loanAction(officer, loanId, "markClearToClose");
    await write(officer, closing);
    const funding = { type: "recordFunding", loanId, fundingDate: today, revision: 0 };
    await loanAction(officer, loanId, "selectOffer", manualQuote);
    assert.match((await action(officer, "mutate", funding)).error, /current MISMO handoff/);
    assert.equal((await preflight()).target, "manual-lender-acknowledgment");
    await write(officer, { ...acknowledge, eventId: randomUUID() });
    await write(officer, funding);
    assert.equal((await file(officer, loanId)).loans[0].stage, "Funded");
  }
  await stage("Conventional purchase uses a quoted manual MISMO handoff through funding", () => verifyQuotedManualFile("Purchase"));
  await stage("No-cash-out refinance uses a quoted manual MISMO handoff through funding", () => verifyQuotedManualFile("Refinance"));
  await stage("A rejected manual export stays in Today and Exceptions through revised acknowledgment", async () => {
    const created = await write(officer, { type: "loan", contactId: "", borrower: "Fictional Cedar Refinance",
      borrowerEmail: "working-day-cedar-refinance@example.test", start1003: true, partnerId: null, officer: officer.name,
      address: "", amount: 350000, purpose: "Refinance", stage: "Lead" });
    const loanId = created.loanWork.loanId;
    const { token } = (await file(officer, loanId)).applications[0];
    const initial = await borrower(token, { type: "read" });
    const draft = { ...sampleApplication(initial.draft), confirmedDemo: true };
    const step = applicationSteps.length - 1;
    const submitted = await borrower(token, { type: "submit", revision: initial.revision, step, draft });
    await loanAction(officer, loanId, "reviewApplication", { revision: submitted.revision });
    const names = [{ first: "Fictional", middle: "Cedar", last: "Refinance", suffix: "" }];
    const exportApplication = (revision, eventId) => write(officer, { type: "exportReviewedApplication", loanId, revision, lenderRevision: 0, eventId, names });
    const staleExportId = randomUUID();
    const exportId = randomUUID();
    await exportApplication(submitted.revision, staleExportId);
    await exportApplication(submitted.revision, exportId);
    assert.deepEqual((await file(officer, loanId)).applications[0].manualHandoff.preparedExports, [{ eventId: exportId, profile: "basic" }]);
    const note = "Update the fictional property street address and resubmit.";
    const reason = "Private wholesale response W-42.";
    const eventId = randomUUID();
    const response = { eventId, exportId, lenderRevision: 0, profile: "basic", lender: "Fictional Cedar Wholesale", reference: "CEDAR-REJECT", reason };
    const reject = { type: "requestApplicationCorrection", loanId, revision: submitted.revision, note, lenderRejection: response };
    assert.match((await action(officer, "mutate", { ...reject, lenderRejection: { ...response, exportId: staleExportId } })).error, /prepared MISMO export changed/i);
    assert.ok((await action(competingOfficer, "mutate", reject)).error);
    assert.match((await write(officer, reject)).message, /rejection recorded/i);
    assert.match((await write(officer, reject)).message, /already recorded/i);
    assert.ok((await action(officer, "mutate", { ...reject, note: "Different borrower instructions." })).error);
    const rejected = await file(officer, loanId);
    assert.equal(rejected.applications[0].manualLenderRejected, true);
    assert.equal(rejected.applications[0].lastManualSubmissionId, undefined);
    assert.equal(rejected.submissions.length, 0);
    const history = await action(officer, "readHistoryPage", { record: "loan", id: loanId });
    assert.equal(history.events.filter((entry) => entry.text.includes(reason)).length, 1);
    const reopened = await borrower(token, { type: "read" });
    assert.equal(reopened.correctionNote, note);
    for (const payload of [reopened, await borrower(token, { type: "status" })]) {
      assert.ok(!JSON.stringify(payload).includes(reason));
      assert.ok(!JSON.stringify(payload).includes("CEDAR-REJECT"));
    }
    const todayItem = async () => (await incoming(officer, "today")).items.find((item) => item.id === eventId);
    const ownerItem = async () => (await fileExceptions("Manual lender returns")).items.find((item) => item.id === eventId);
    assert.equal((await todayItem()).returnStatus, "Waiting on borrower");
    assert.equal((await ownerItem()).target, "loan-application");
    assert.equal((await ownerItem()).returnSubmissionId, null);
    assert.deepEqual(rejected.manualReturn, { eventId, submissionId: null, status: "Waiting on borrower" });
    const followUp = { loanId, eventId, submissionId: null, entryId: randomUUID(), party: "Borrower", channel: "Call", note: "Confirmed the sample correction." };
    assert.equal((await action(officer, "logLenderReturnFollowUp", followUp)).followUp?.note, followUp.note);
    assert.equal((await ownerItem()).returnFollowUp?.note, followUp.note);
    assert.match((await action(officer, "mutate", { type: "recordClosing", loanId, closingDate: today, revision: 0 })).error, /current MISMO handoff/);
    const corrected = await borrower(token, { type: "submit", revision: reopened.revision, step,
      draft: { ...reopened.draft, propertyAddress: "96 Corrected Fictional Lane" } });
    assert.equal((await todayItem()).returnStatus, "Corrected 1003 ready for review");
    await loanAction(officer, loanId, "reviewApplication", { revision: corrected.revision });
    assert.equal((await todayItem()).returnStatus, "Awaiting second review");
    const review = (staff, input) => action(staff, "workOnLoanReview", { loanId, ...input });
    const [pending] = (await review(owner, { type: "loan" })).reviews;
    const { review: outdated } = await review(owner, { type: "detail", id: pending.id });
    assert.equal(outdated.evidenceChanged, true);
    const resubmitted = await review(officer, { type: "resubmit", id: pending.id, revision: outdated.revision,
      eventId: randomUUID(), dueOn: today, note: "Resubmitted the corrected sample 1003 for approval." });
    assert.equal(resubmitted.kind, "saved", resubmitted.error);
    const { review: current } = await review(owner, { type: "detail", id: pending.id });
    assert.equal(current.applicationRevision, corrected.revision);
    const approved = await review(owner, { type: "decide", id: pending.id, revision: current.revision, eventId: randomUUID(),
      decision: "Approved", note: "Reviewed the revised sample 1003." });
    assert.equal(approved.kind, "saved", approved.error);
    assert.equal((await todayItem()).returnStatus, "Ready for revised export");
    const replacement = await exportApplication(corrected.revision, randomUUID());
    assert.match(replacement.mismoXml, /96 Corrected Fictional Lane/);
    assert.equal((await ownerItem()).target, "manual-lender-acknowledgment");
    const accepted = await loanAction(officer, loanId, "recordManualHandoff", { eventId: randomUUID(),
      revision: corrected.revision, lenderRevision: 0, outcome: "Acknowledged", note: "",
      lenderFile: { lender: response.lender, externalId: "CEDAR-ACK" } });
    assert.equal(accepted.loanWork.submissions.length, 1);
    assert.equal(accepted.loanWork.manualReturn, undefined);
    assert.equal(await todayItem(), undefined);
    assert.equal(await ownerItem(), undefined);
  });
  async function fundMockLoan(loanId, purpose, name, assignedProcessor = null) {
    const { token } = (await file(officer, loanId)).applications[0];
    const initial = await borrower(token, { type: "read" });
    const draft = { ...sampleApplication(initial.draft), confirmedDemo: true };
    assert.equal(draft.purpose, purpose);
    assert.equal(draft.borrowerName, name);
    const { revision } = await borrower(token, { type: "submit", revision: initial.revision, step: applicationSteps.length - 1, draft });
    await loanAction(officer, loanId, "reviewApplication", { revision });
    await loanAction(officer, loanId, "saveLenderDetails", { revision: 0, details: {
      supplement: { fields: { mortgage: "Conventional", mortgageLien: "First lien", ...(purpose === "Refinance" ? {
        refinance: "No cash out", refinanceProgram: "Full documentation", mortgagePayoffs: "345000",
      } : { purchasePrice: draft.estimatedValue }) } },
    } });
    const scenario = { purpose, loanAmount: Number(draft.loanAmount), propertyValue: Number(draft.estimatedValue),
      purchasePrice: purpose === "Purchase" ? Number(draft.estimatedValue) : null,
      zip: draft.propertyLocation.zip, creditScore: 760, monthlyIncome: 9500, occupancy: "Primary residence",
      propertyType: "Single family", firstTimeBuyer: false };
    const pricing = await loanAction(officer, loanId, "runPricing", { scenario, applicationRevision: revision });
    const run = pricing.state.pricingRuns.find((item) => item.loanId === loanId);
    assert.equal(run.mode, "mock");
    const quote = { runId: run.id, offerId: run.offers[0].id };
    await loanAction(officer, loanId, "selectOffer", quote);
    const review = (input) => action(owner, "workOnLoanReview", { loanId, ...input });
    const [pending] = (await review({ type: "loan" })).reviews;
    const { review: current } = await review({ type: "detail", id: pending.id });
    const approval = await review({ type: "decide", id: pending.id, revision: current.revision, eventId: randomUUID(),
      decision: "Approved", note: "Verified the fictional 1003 for mock lender delivery." });
    assert.equal(approval.kind, "saved", approval.error);
    await loanAction(officer, loanId, "simulateMissingUwmReceipt", { revision, quote });
    await loanAction(officer, loanId, "reconcileMockUwmReceipt", { revision });
    const received = await file(officer, loanId);
    assert.equal(received.submissions.length, 1);
    const [submission] = received.submissions;
    assert.equal(submission.lender, "UWM");
    assert.match(submission.externalId, /^DEMO-/);
    const processingActor = assignedProcessor ?? officer;
    const handoff = async (actor, step, note = "") => {
      const [assignment] = (await file(actor, loanId)).loanProcessing;
      return loanAction(actor, loanId, "updateProcessing", { action: step, revision: assignment.revision, applicationRevision: revision, note });
    };
    if (assignedProcessor) {
      assert.match((await action(assignedProcessor, "readLoanForWork", loanId)).error, /unavailable/i);
      await team(owner, { type: "assignProcessor", loanId, email: assignedProcessor.email, revision: 0, requestId: randomUUID() });
      await handoff(officer, "Send to processing", "Review the returning client's fictional refinance.");
      const available = await incoming(assignedProcessor, "processing");
      assert.ok(available.items.some(({ kind, id }) => kind === "handoff" && id === loanId));
      assert.ok((await action(competingOfficer, "readLoanForWork", loanId)).error);
      await handoff(assignedProcessor, "Accept handoff");
    }
    const conditionIds = submission.conditions.filter(({ satisfiedAt }) => !satisfiedAt).map(({ id }) => id);
    assert.equal(conditionIds.length, 2);
    await loanAction(processingActor, loanId, "requestSuggestedUwmDocuments", { submissionId: submission.id, conditionIds });
    const requested = (await file(processingActor, loanId)).documentRequests;
    for (const request of requested) {
      await borrower(token, { type: "attachSample", statusOnly: true, requestId: request.id, revision: request.revision });
      const currentRequest = (await file(processingActor, loanId)).documentRequests.find(({ id }) => id === request.id);
      await loanAction(processingActor, loanId, "reviewDocument", { requestId: request.id, revision: currentRequest.revision,
        decision: "Accepted", replacementNote: "", sendToMockUwm: true });
    }
    await loanAction(processingActor, loanId, "refreshMockUwmClearance", { submissionId: submission.id });
    if (assignedProcessor) {
      assert.ok((await action(assignedProcessor, "mutate", { type: "markClearToClose", loanId })).error);
      assert.ok((await action(officer, "mutate", { type: "markClearToClose", loanId })).error);
      await handoff(assignedProcessor, "Return to LO", "Private refinance handoff note.");
      assert.ok((await queue(officer)).items.some(({ kind, recordId }) => kind === "handoff" && recordId === loanId));
      assert.equal((await file(officer, loanId)).loanProcessing[0].note, "Private refinance handoff note.");
      assert.doesNotMatch(JSON.stringify(await borrower(token, { type: "status" })), /Private refinance handoff note/);
      await handoff(officer, "Complete handoff");
      assert.ok(!(await queue(officer)).items.some(({ kind, recordId }) => kind === "handoff" && recordId === loanId));
    }
    const ready = await file(officer, loanId);
    assert.ok(ready.submissions[0].conditions.every(({ satisfiedAt }) => satisfiedAt));
    assert.equal(closingReviewReady(ready.loans[0], ready), true);
    await loanAction(officer, loanId, "markClearToClose");
    await loanAction(officer, loanId, "recordClosing", { revision: 0, closingDate: today });
    await loanAction(officer, loanId, "recordFunding", { revision: 0, fundingDate: today });
    const funded = await file(officer, loanId);
    assert.equal(funded.loans[0].stage, "Funded");
    assert.equal(funded.closingProgress[0].fundingDate, today);
    return funded.loans[0];
  }

  const returningBorrower = { name: "Fictional Lake Campaign Client", email: "working-day-lake-client@example.test", phone: "202-555-0187" };
  const crmFilter = { from: today, through: today, owner: `email:${officer.email}`, windowDays: 0 };
  const original = await stage("A portal realtor referral reaches funding and reconciles to its original partner", async () => {
    const referral = { type: "submit", token: realtorToken, requestId: randomUUID(), ...returningBorrower, purpose: "Purchase", consent: true };
    const result = await post("/api/realtor-referrals", referral);
    assert.ok(result.referrals.some(({ borrowerName, stage }) => borrowerName === returningBorrower.name && stage === "Referral received"));
    const { leads } = await action(officer, "readInboxWork", { type: "list", view: "Needs first contact" });
    const lead = leads.find(({ name }) => name === returningBorrower.name);
    assert.equal(lead?.officerEmail, officer.email);
    assert.ok((await action(competingOfficer, "readInboxWork", { type: "open", id: lead.id })).error);
    const { lead: current } = await action(officer, "readInboxWork", { type: "open", id: lead.id });
    await write(officer, { type: "leadContact", leadId: lead.id, revision: current.followUp.revision, channel: "Call", outcome: "Connected",
      note: "Fictional borrower confirmed a purchase application." });
    const converted = await post(`/api/lead-conversion?brokerage=${brokerage}`, { type: "convertReferral", referralId: lead.id, contactId: null }, officer);
    const funded = await fundMockLoan(converted.referralLoanId, "Purchase", returningBorrower.name);
    const portal = await realtor(realtorToken);
    assert.ok(portal.referrals.some(({ borrowerName, stage }) => borrowerName === returningBorrower.name && stage === "Funded"));
    assert.doesNotMatch(JSON.stringify(portal), /working-day-lake-client/);
    const records = await action(owner, "readRealtorWorkspace", { type: "records", partnerId: funded.partnerId, view: "funded",
      filters: { from: today, through: today, officer: officer.email, source: "Realtor referral" } });
    assert.equal(records.rows.find(({ id }) => id === funded.id)?.fundedOn, today);
    return { ...funded, leadId: lead.id };
  });

  await stage("A returning-client refinance crosses staff roles without exposing the original portal or referral", async () => {
    const campaignId = randomUUID();
    const campaignName = "Fictional Lake Past Clients";
    const segmentId = randomUUID();
    await write(owner, { type: "createCallCampaign", id: campaignId, name: campaignName });
    await write(owner, { type: "saveCampaignRouting", campaignId, revision: 0, enabled: true, officers: [{ email: officer.email, limit: 5 }] });
    const config = (await write(owner, { type: "refreshCampaignQueue", campaignId })).campaignQueue.campaign.sequenceConfig;
    const version = config.latest["Past Client Outreach"]?.version ?? null;
    await write(owner, { type: "saveCampaignSequence", campaignId, kind: "Past Client Outreach",
      expectedVersion: null, expectedTemplateVersion: version, steps: version ? null : defaultCampaignSequenceSteps["Past Client Outreach"] });
    await write(owner, { type: "saveCrmSegment", id: segmentId, revision: 0, name: "Fictional reactivation segment", kind: "Past clients", quietDays: 7 });
    const enroll = { type: "enrollCrmSegment", segmentId, campaignId };
    const { segmentPreview } = await write(owner, enroll);
    assert.equal(segmentPreview.rows.find(({ id }) => id === original.id)?.status, "Eligible");
    await write(owner, { ...enroll, fingerprint: segmentPreview.fingerprint, selectedIds: [original.id] });
    const campaign = (await write(officer, { type: "refreshCampaignQueue", campaignId })).campaignQueue;
    const [lead] = campaign.inboxLeads;
    assert.equal(lead.officerEmail, officer.email);
    assert.equal(lead.importedContactId, original.contactId);
    assert.equal((await file(officer, original.id)).repeatOption.kind, "campaign");
    const start = { type: "startReturningClient1003", loanId: original.id, purpose: "Refinance" };
    assert.match((await action(officer, "mutate", start)).error, /already has a campaign lead/);
    assert.ok((await queue(officer)).items.some(({ recordId, kind }) => recordId === lead.id && kind === "sequence"));
    await write(officer, { type: "recordCampaignCall", campaignId, leadId: lead.id, revision: lead.followUp.revision,
      outcome: "Left message", note: "Fictional first outreach from Today.", callbackAt: null });
    const reply = await action(owner, "saveInboundReplyWork", { type: "simulate", channel: "Email", sourceId: "working-day-past-client-reply",
      sender: returningBorrower.email, text: "I would like to discuss a fictional refinance." });
    assert.ok(reply.id, reply.error);
    const linked = await action(owner, "saveInboundReplyWork", { type: "attachLead", id: reply.id, revision: 1, leadId: lead.id });
    assert.ok(linked.conversationId, linked.error);
    assert.ok(!(await queue(officer)).items.some(({ recordId, kind }) => recordId === lead.id && kind === "sequence"));
    assert.ok((await action(officer, "readConversationWork", { type: "myReplies" })).page.items.some(({ id }) => id === linked.conversationId));
    const conversion = { type: "convertReferral", referralId: lead.id, contactId: null };
    const path = `/api/lead-conversion?brokerage=${brokerage}`;
    const { referralLoanId: repeatId } = await post(path, conversion, officer);
    assert.equal((await post(path, conversion, officer)).referralLoanId, repeatId);
    assert.equal((await write(officer, start)).applicationLoanId, repeatId);
    assert.equal((await action(officer, "readConversationWork", { type: "thread", id: linked.conversationId })).thread.loanId, repeatId);
    const originalToken = (await file(officer, original.id)).applications[0].token;
    const repeatToken = (await file(officer, repeatId)).applications[0].token;
    assert.notEqual(originalToken, repeatToken);
    const originalStatus = (await borrower(originalToken, { type: "status" })).loanStatus;
    const originalReferral = (await realtor(realtorToken)).referrals.filter(({ borrowerName }) => borrowerName === returningBorrower.name);
    assert.equal(originalReferral.length, 1);
    const unrelatedPartner = await write(owner, { type: "contact", role: "Realtor", name: "Fictional Unrelated Realtor",
      email: "working-day-unrelated-realtor@example.test", phone: "" });
    const { contactId: partnerId } = unrelatedPartner;
    await action(owner, "mutate", { type: "createRealtorPortal", realtorId: partnerId, officerEmail: competingOfficer.email }, "realtors");
    const { portal: unrelatedPortal } = await action(owner, "readRealtorWorkspace", { type: "profile", partnerId });
    const unrelatedReferralName = "Fictional Second Realtor Referral";
    await post("/api/realtor-referrals", { type: "submit", token: unrelatedPortal.token, requestId: randomUUID(),
      name: unrelatedReferralName, email: "working-day-second-referral@example.test", phone: "", purpose: "Purchase", consent: true });
    const repeat = await fundMockLoan(repeatId, "Refinance", returningBorrower.name, processor);
    assert.equal(repeat.contactId, original.contactId);
    assert.equal(repeat.partnerId, null);
    const scorecard = await action(owner, "readOwnerReport", { kind: "summary", ...crmFilter });
    assert.equal(scorecard.sales.groups.find(({ id }) => id === campaignId)?.selected.funded, 1);
    const records = (channel, groupId, metric, staff = owner) => action(staff, "readSalesReport",
      { ...crmFilter, kind: "records", channel, groupId, metric, period: "selected" });
    assert.deepEqual((await records("Campaigns", campaignId, "funded")).records.map(({ id, loanId }) => [id, loanId]), [[lead.id, repeatId]]);
    assert.ok((await records("Realtors", original.partnerId, "repeat")).records.some(({ id, repeatLoanId }) => id === original.leadId && repeatLoanId === repeatId));
    assert.ok((await records("Campaigns", campaignId, "funded", officer)).error);
    const activity = (await workspace(owner)).managerReports.returningClients.find(({ loanId }) => loanId === repeatId);
    assert.equal(activity.sourceLoanId, original.id);
    assert.equal(activity.campaignName, campaignName);
    assert.equal(activity.detail, "Funded");
    const originalPartner = await realtor(realtorToken);
    const secondPartner = await realtor(unrelatedPortal.token);
    assert.deepEqual(originalPartner.referrals.filter(({ borrowerName }) => borrowerName === returningBorrower.name), originalReferral);
    assert.ok(!originalPartner.referrals.some(({ borrowerName }) => borrowerName === unrelatedReferralName));
    assert.deepEqual(secondPartner.referrals.map(({ borrowerName }) => borrowerName), [unrelatedReferralName]);
    assert.deepEqual((await borrower(originalToken, { type: "status" })).loanStatus, originalStatus);
    const repeatStatus = (await borrower(repeatToken, { type: "status" })).loanStatus;
    assert.equal(repeatStatus.stage, "Funded");
    assert.equal(repeatStatus.documents.length, 2);
    assert.ok(repeatStatus.documents.every(({ id }) => !originalStatus.documents.some(request => request.id === id)));
    for (const [token, request] of [[repeatToken, originalStatus.documents[0]], [originalToken, repeatStatus.documents[0]]]) {
      const wrongFile = await postResponse("/api/demo-application", { type: "attachSample", token,
        requestId: request.id, revision: request.revision, statusOnly: true });
      assert.equal(wrongFile.status, 404);
    }
    assert.deepEqual((await borrower(originalToken, { type: "status" })).loanStatus, originalStatus);
    assert.deepEqual((await borrower(repeatToken, { type: "status" })).loanStatus, repeatStatus);
  });
  await stage("DSCR and bank statement comparisons recover unsupported EQ through a revised manual handoff", async () => {
    const created = await write(officer, { type: "loan", contactId: "", borrower: "Fictional Summit Investor",
      borrowerEmail: "working-day-summit-investor@example.test", start1003: true, partnerId: null, officer: officer.name,
      address: "", amount: 350000, purpose: "Refinance", stage: "Lead" });
    const loanId = created.loanWork.loanId;
    const { token } = (await file(officer, loanId)).applications[0];
    const initial = await borrower(token, { type: "read" });
    const step = applicationSteps.length - 1;
    const draft = { ...sampleApplication(initial.draft), occupancy: "Investment property", confirmedDemo: true };
    const submitted = await borrower(token, { type: "submit", revision: initial.revision, step, draft });
    await loanAction(officer, loanId, "reviewApplication", { revision: submitted.revision });
    const common = { monthlyTaxes: 450, monthlyInsurance: 125, monthlyHoa: 0, reservesMonths: 6, refinanceType: "Rate and term" };
    const base = { purpose: "Refinance", loanAmount: Number(draft.loanAmount), propertyValue: Number(draft.estimatedValue),
      purchasePrice: null, zip: draft.propertyLocation.zip, creditScore: 760, occupancy: "Investment property",
      propertyType: "Single family", firstTimeBuyer: false };
    const dscr = { ...base, nonAgency: { ...common, program: "DSCR", monthlyRent: 3600 } };
    const bank = { ...base, nonAgency: { ...common, program: "Bank statement", source: { type: "Business", expensePercent: 50, ownershipPercent: 100 },
      statementMonths: 12, averageMonthlyDeposits: 19000, monthlyDebts: 850, selfEmployed: true } };
    const price = async (scenario, applicationRevision, simulateUnsupportedEq) => (await loanAction(officer, loanId, "runPricing",
      { scenario, applicationRevision, simulateUnsupportedEq })).state.pricingRuns.find((item) => item.loanId === loanId);
    const names = [{ first: "Fictional", middle: "Summit", last: "Investor", suffix: "" }];
    const xml = (revision, manualQuote) => ({ type: "exportReviewedApplication", loanId, revision, lenderRevision: 0,
      eventId: randomUUID(), names, manualQuote });
    const review = (input, staff = owner) => action(staff, "workOnLoanReview", { loanId, ...input });
    const preflight = async () => (await review({ type: "preflight" })).preflight.checks.find(({ id }) => id === "lender");
    const add = async (run, reference, rate) => {
      const quote = { runId: run.id, offerId: randomUUID() };
      const details = { lender: "Fictional Summit Wholesale", reference, product: `${run.scenario.nonAgency.program} fixed`,
        years: 30, rate, apr: null, adjustment: null, quotedOn: today, expiresOn: shiftReportDate(today, 7) };
      await loanAction(officer, loanId, "addManualQuote", { ...quote, details });
      await loanAction(officer, loanId, "selectOffer", quote);
      return quote;
    };
    const unsupported = await price(dscr, submitted.revision, true);
    assert.equal(unsupported.outcome, "unsupported");
    assert.equal(unsupported.mode, "mock");
    assert.deepEqual(unsupported.offers, []);
    assert.deepEqual(unsupported.scenario, dscr);
    assert.equal((await preflight()).target, "loan-pricing");
    const send = { type: "sendApplication", loanId, revision: submitted.revision };
    assert.match((await action(officer, "mutate", send)).error, /manual lender offer/);
    assert.match((await action(officer, "mutate", xml(submitted.revision))).error, /manual lender offer/);
    const sample = await price(dscr, submitted.revision);
    assert.ok(sample.offers.every((item) => item.product.startsWith("DSCR")));
    const sampleChoice = { runId: sample.id, offerId: sample.offers[0].id };
    await loanAction(officer, loanId, "selectOffer", sampleChoice);
    assert.match((await action(officer, "mutate", { ...send, quote: sampleChoice })).error, /manual lender offer/);
    const dscrManual = await add(unsupported, "SUMMIT-DSCR", 7.125);
    assert.match((await write(officer, xml(submitted.revision, dscrManual))).mismoXml, /<NoteRatePercent>7\.125<\/NoteRatePercent>/);
    const comparisonOnly = await price({ ...bank, occupancy: "Primary residence" }, submitted.revision, true);
    const differentOccupancy = await add(comparisonOnly, "SUMMIT-BANK-WHAT-IF", 7.25);
    assert.match((await action(officer, "mutate", xml(submitted.revision, differentOccupancy))).error, /differ on occupancy/);
    const bankResult = await price(bank, submitted.revision, true);
    assert.equal(bankResult.outcome, "unsupported");
    assert.deepEqual(bankResult.scenario, bank);
    const bankManual = await add(bankResult, "SUMMIT-BANK", 7.375);
    const comparison = (await file(owner, loanId)).pricingRuns;
    assert.ok(comparison.some(({ id, selectedId }) => id === unsupported.id && selectedId === dscrManual.offerId));
    assert.ok(comparison.some(({ id, selectedId }) => id === bankResult.id && selectedId === bankManual.offerId));
    assert.equal((await file(officer, loanId)).submissions.length, 0);
    await loanAction(officer, loanId, "requestApplicationCorrection", { revision: submitted.revision, note: "Confirm the fictional requested loan amount." });
    const reopened = await borrower(token, { type: "read" });
    const corrected = await borrower(token, { type: "submit", revision: reopened.revision, step, draft: { ...reopened.draft, loanAmount: "340000" } });
    await loanAction(officer, loanId, "reviewApplication", { revision: corrected.revision });
    assert.match((await action(officer, "mutate", xml(corrected.revision, bankManual))).error, /current 1003/);
    const revised = await price({ ...bank, loanAmount: 340000 }, corrected.revision, true);
    const revisedManual = await add(revised, "SUMMIT-BANK-REVISED", 7.5);
    const [pending] = (await review({ type: "loan" })).reviews;
    const { review: outdated } = await review({ type: "detail", id: pending.id });
    const resubmitted = await review({ type: "resubmit", id: pending.id, revision: outdated.revision, eventId: randomUUID(),
      dueOn: outdated.dueOn, note: "Resubmitted the corrected fictional investment loan." }, officer);
    assert.equal(resubmitted.kind, "saved", resubmitted.error);
    const { review: current } = await review({ type: "detail", id: pending.id });
    const approval = await review({ type: "decide", id: pending.id, revision: current.revision, eventId: randomUUID(),
      decision: "Approved", note: "Verified the revised fictional handoff." });
    assert.equal(approval.kind, "saved", approval.error);
    const replacement = await write(officer, xml(corrected.revision, revisedManual));
    assert.match(replacement.mismoXml, /<NoteRatePercent>7\.5<\/NoteRatePercent>/);
    assert.match(replacement.mismoXml, /<NoteAmount>340000<\/NoteAmount>/);
    await loanAction(officer, loanId, "recordManualHandoff", { revision: corrected.revision, lenderRevision: 0, profile: "basic",
      eventId: randomUUID(), outcome: "Acknowledged", note: "", manualQuote: revisedManual,
      lenderFile: { lender: "Fictional Summit Wholesale", externalId: "SUMMIT-MANUAL-ACK" } });
    const ownerFile = await file(owner, loanId);
    assert.equal(ownerFile.submissions.length, 1);
    assert.equal(ownerFile.submissions[0].syncedAt, null);
    assert.equal(ownerFile.applications[0].manualHandoff.acknowledgedQuote.reference, "SUMMIT-BANK-REVISED");
    const history = await action(owner, "readHistoryPage", { record: "loan", id: loanId });
    assert.ok(history.events.some(({ text }) => text.includes("Bank statement · Unsupported")));
  });
  await stage("Maintenance pauses staff, portals and background work through restart and requires reviewed reopening",async()=>{
    const create=await write(owner,{type:"loan",contactId:"",borrower:"Fictional Maintenance Borrower",borrowerEmail:"maintenance@example.test",
      address:"",amount:250000,purpose:"Purchase",stage:"Lead",officer:owner.name,partnerId:null,start1003:true});
    const loanId=create.loanWork.loanId;
    const initial=await file(owner,loanId);
    const token=initial.applications[0].token;
    assert.ok((await borrower(token,{type:"read"})).draft);
    const state=await workspace(owner);
    const realtor=state.realtorPortals.find(row=>row.token);
    assert.ok(realtor,"Working-day realtor portal required for maintenance acceptance");
    const endpoint=`/api/workspace-maintenance?brokerage=${brokerage}`;
    const get=async(actor=owner)=>runtime.dispatchFetch(origin+endpoint,{headers:{Cookie:`__Host-orbit-session=${actor.token}`}});
    assert.equal((await get(officer)).status,403);assert.equal((await get(processor)).status,403);
    const ownerHash = createHash("sha256").update(owner.token).digest("base64url");
    const entry = (path, actor = owner) => browse(actor, path, "", { headers: { "Sec-Fetch-Site": "same-origin" } });
    const scoped = `/workspace?brokerage=${brokerage}`;
    assert.equal((await entry(scoped + "&default=1")).headers.get("location"), scoped);
    assert.equal((await entry("/workspace")).headers.get("location"), scoped);
    const original=await (await get()).json();assert.equal(original.mode,"Open");
    const inspect=async(revision,actor=owner)=>runtime.dispatchFetch(origin+endpoint+`&inspect=1&revision=${revision}`,{headers:{Cookie:`__Host-orbit-session=${actor.token}`}});
    assert.equal((await inspect(original.revision)).status,403);
    await directory.holdOwnerLookup();
    const pending=write(owner,{type:"saveRealtorLinkOwner",realtorId:realtor.realtorId,token:realtor.token,revision:realtor.revision,officerEmail:officer.email});
    let waiting=false;
    for(let i=0;i<50;i++){if(await directory.ownerLookupWaiting()){waiting=true;break;}await delay(20);}
    assert.ok(waiting,"Fixture must observe the in-flight owner lookup");
    const draining=await post(endpoint,{type:"pause",revision:original.revision,reason:"Fictional maintenance acceptance and access review.",confirmation:"Fictional Working Day"},owner);
    assert.equal(draining.mode,"Pausing");assert.equal(draining.active,1);
    assert.equal((await inspect(draining.revision)).status,403);
    assert.equal((await postResponse(endpoint,{type:"review",revision:draining.revision,review:"Too early to review active work.",checks:[true,true,true]},owner)).status,409);
    await directory.releaseOwnerLookup();await pending;
    const paused=await (await get()).json();
    assert.equal(paused.mode,"Paused");assert.equal(paused.active,0);
    assert.equal((await inspect(paused.revision,officer)).status,403);
    assert.equal((await inspect(paused.revision,processor)).status,403);
    assert.equal((await inspect(paused.revision-1)).status,403);
    const inspected=await (await inspect(paused.revision)).json();
    assert.ok(inspected.inspection,JSON.stringify(inspected));
    assert.deepEqual(inspected.inspection.unavailable,[]);
    assert.ok(inspected.inspection.records.find(item=>item.label==="Loans").count>0);
    assert.ok(inspected.inspection.documents.total>0);
    assert.ok(inspected.inspection.documents.items.some(item=>item.availability==="Available"));
    assert.equal((await (await get()).json()).revision,paused.revision);
    for(const actor of [owner,officer,processor]){
      const response=await runtime.dispatchFetch(`${origin}/workspace?brokerage=${brokerage}`,{headers:{Cookie:`__Host-orbit-session=${actor.token}`}});
      assert.equal(response.status,503);assert.match(await response.text(),/Workspace paused/);
    }
    const pausedEntry = await entry(scoped);
    const pausedHtml = await pausedEntry.text();
    const alternate = pausedHtml.match(/href="(\/workspace\?brokerage=[^"]+)">Open another available workspace/)?.[1];
    assert.ok(alternate, "The paused workspace offers a scoped temporary visit");
    assert.notEqual(alternate, scoped);
    const visit = await entry(alternate);
    assert.equal(visit.status, 200);
    assert.equal(visit.headers.get("set-cookie"), null);
    const legacyVisit = await entry("/workspace?available=1");
    assert.equal(legacyVisit.headers.get("location"), alternate);
    assert.equal(legacyVisit.headers.get("set-cookie"), null);
    assert.equal((await directory.staffSessionAccess(ownerHash, Date.now(), [owner.email])).preferredWorkspace, brokerage);
    assert.equal((await entry("/workspace")).headers.get("location"), scoped);
    assert.equal((await postResponse("/api/demo-application",{token,type:"read"})).status,503);
    assert.equal((await postResponse("/api/borrower-documents/verify",{token,type:"sendCode"})).status,503);
    assert.equal((await postResponse("/api/realtor-referrals",{token:realtor.token,type:"read"})).status,503);
    const membership=(await directory.staffBrokerages(owner.email,[owner.email])).find(row=>row.id===brokerage);
    const identity={email:owner.email,name:owner.name,brokerage:membership},store=workspaces.getByName(brokerage);
    assert.match(await directory.rejectedPeerCall(brokerage,"read",null,identity),/paused/);
    assert.match(await directory.rejectedPeerCall(brokerage,"write",{type:"startApplication",loanId},identity),/paused/);
    assert.match(await directory.rejectedPeerCall(brokerage,"alarm",null,identity),/paused/);
    const other=randomUUID();
    assert.equal((await directory.manage({email:owner.email,name:owner.name,brokerage:{id:"orbit-demo"}},[owner.email],
      {type:"create",id:other,name:"Fictional Unaffected Workspace",pilot:true})).created,other);
    const unaffected=()=>runtime.dispatchFetch(`${origin}/workspace?brokerage=${other}`,{headers:{Cookie:`__Host-orbit-session=${owner.token}`}});
    assert.equal((await unaffected()).status,200);
    try{await store.restartMaintenanceFixture();}catch{/* Following calls verify the fence. */}
    assert.equal((await (await get()).json()).mode,"Paused");
    const afterRestart=await (await inspect(paused.revision)).json();
    assert.deepEqual(afterRestart.inspection.records,inspected.inspection.records);
    assert.deepEqual(afterRestart.inspection.documents,inspected.inspection.documents);
    assert.match(await directory.rejectedPeerCall(brokerage,"read",null,identity),/paused/);
    assert.equal((await postResponse(endpoint,{type:"reopen",revision:paused.revision,confirmation:"Fictional Working Day"},owner)).status,409);
    const reviewed=await post(endpoint,{type:"review",revision:paused.revision,review:"Verified fictional saved work, documents, access and mock outcomes.",checks:[true,true,true]},owner);
    const evidence=inspected.inspection.documents.items.find(item=>item.availability==="Available");
    const decision={id:randomUUID(),revision:reviewed.revision,documents:0,requests:0,reference:evidence.reference,fingerprint:evidence.fingerprint,
      outcome:"Preserve observed result",note:"Fictional sample PDF is present in storage. This check does not verify its contents or authorize any lender retry."};
    assert.equal((await postResponse(endpoint+"&decision=1",decision,officer)).status,409);
    assert.equal((await postResponse(endpoint+"&decision=1",{...decision,fingerprint:"0".repeat(64)},owner)).status,409);
    const recorded=await post(endpoint+"&decision=1",decision,owner);
    assert.ok(recorded.decision,JSON.stringify(recorded));assert.equal(recorded.view.reviewedAt,null);
    assert.equal(recorded.view.revision,reviewed.revision+1);
    const repeated=await post(endpoint+"&decision=1",decision,owner);
    assert.equal(repeated.decision.id,recorded.decision.id);assert.equal(repeated.view.revision,recorded.view.revision);
    assert.equal((await postResponse(endpoint,{type:"reopen",revision:recorded.view.revision,confirmation:"Fictional Working Day"},owner)).status,409);
    try{await store.restartMaintenanceFixture();}catch{/* Following inspection verifies durable directory decisions. */}
    const inspectedDecision=await (await inspect(recorded.view.revision)).json();
    assert.equal(inspectedDecision.inspection.documents.items.find(item=>item.reference===evidence.reference).decisions[0].id,decision.id);
    assert.deepEqual(inspectedDecision.inspection.records,inspected.inspection.records);
    const finalReview=await post(endpoint,{type:"review",revision:recorded.view.revision,review:"Reviewed the recorded fictional decision and all reopening checks. No provider retry is authorized.",checks:[true,true,true]},owner);
    assert.equal((await postResponse(endpoint,{type:"reopen",revision:paused.revision,confirmation:"Fictional Working Day"},owner)).status,409);
    const opened=await post(endpoint,{type:"reopen",revision:finalReview.revision,confirmation:"Fictional Working Day"},owner);
    assert.equal(opened.mode,"Open");assert.equal(opened.history.length,6);
    const freshOwner = { ...owner, token: randomBytes(32).toString("base64url") };
    await signIn(freshOwner);
    assert.equal((await entry("/workspace", freshOwner)).headers.get("location"), scoped);
    assert.equal((await entry(scoped, freshOwner)).status, 200);
    assert.equal((await inspect(paused.revision)).status,403);
    assert.deepEqual((await file(owner,loanId)).applications[0].draft,initial.applications[0].draft);
    assert.ok((await borrower(token,{type:"read"})).draft);
    assert.equal((await unaffected()).status,200);
  });
  await stage("Internal edit receipts preserve interrupted outcomes for owner review without repeating changes",async()=>{
    const created=await write(owner,{type:"loan",contactId:"",borrower:"Fictional Recovery Edit",borrowerEmail:"edit-recovery@example.test",
      address:"",amount:210000,purpose:"Purchase",stage:"Lead",officer:owner.name,partnerId:null,start1003:true});
    const loanId=created.loanWork.loanId;
    await write(owner,{type:"requestDocument",loanId,kind:"Pay stub",instructions:"Fictional recovery checklist evidence."});
    let doc=(await file(owner,loanId)).documentRequests.find(item=>item.kind==="Pay stub");
    assert.ok(doc);
    await write(owner,{type:"setDocumentDeadline",loanId,requestId:doc.id,revision:doc.revision,deadlineRevision:doc.deadlineRevision,dueOn:"2030-01-01"});
    doc=(await file(owner,loanId)).documentRequests.find(item=>item.id===doc.id);
    const command={type:"setDocumentDeadline",loanId,requestId:doc.id,revision:doc.revision,deadlineRevision:doc.deadlineRevision,dueOn:"2030-02-01"};
    await directory.loseNextRecoveryConfirmation();
    assert.match((await write(owner,command)).message,/confirmation is pending/);
    const store=workspaces.getByName(brokerage),counts=await store.recoveryFixtureCounts(loanId);
    await write(owner,command);assert.deepEqual(await workspaces.getByName(brokerage).recoveryFixtureCounts(loanId),counts);
    const endpoint=`/api/workspace-maintenance?brokerage=${brokerage}`;
    const status=async()=> (await runtime.dispatchFetch(origin+endpoint,{headers:{Cookie:`__Host-orbit-session=${owner.token}`}})).json();
    const edits=async(revision,actor=owner)=>runtime.dispatchFetch(origin+endpoint+`&edits=1&revision=${revision}`,{headers:{Cookie:`__Host-orbit-session=${actor.token}`}});
    const open=await status();assert.equal((await edits(open.revision)).status,409);
    const paused=await post(endpoint,{type:"pause",revision:open.revision,reason:"Inspect interrupted fictional document edits.",confirmation:"Fictional Working Day"},owner);
    assert.equal(paused.mode,"Paused");
    assert.equal((await edits(paused.revision,officer)).status,409);
    assert.equal((await edits(paused.revision,processor)).status,409);
    const report=(await (await edits(paused.revision)).json()).inspection;
    const pending=report.items.find(item=>item.command.requestId===doc.id&&item.state==="Pending");
    assert.ok(pending?.canConfirm);assert.equal(pending.finding,"Saved revision present");
    assert.ok(report.items.some(item=>item.command.requestId===doc.id&&item.state==="Recorded"));
    try{await store.restartMaintenanceFixture();}catch{/* Saved local proof and directory intent must survive. */}
    const restarted=(await (await edits(paused.revision)).json()).inspection;
    assert.deepEqual(restarted,report);
    const reviewed=await post(endpoint,{type:"review",revision:paused.revision,review:"Fictional earlier reopening review.",checks:[true,true,true]},owner);
    const input={revision:reviewed.revision,offset:0,id:pending.id,fingerprint:pending.fingerprint,note:"Verified the exact atomic edit receipt after restart. Preserve the saved change without applying it again."};
    assert.equal((await postResponse(endpoint+"&edits=1",input,officer)).status,409);
    assert.equal((await postResponse(endpoint+"&edits=1",{...input,fingerprint:"0".repeat(64)},owner)).status,409);
    const result=await post(endpoint+"&edits=1",input,owner);assert.equal(result.view.reviewedAt,null);assert.equal(result.view.revision,reviewed.revision+1);
    assert.equal((await postResponse(endpoint+"&edits=1",input,owner)).status,409);
    assert.deepEqual(await workspaces.getByName(brokerage).recoveryFixtureCounts(loanId),counts);
    const refreshed=(await (await edits(result.view.revision)).json()).inspection;
    const resolved=refreshed.items.find(item=>item.id===pending.id);assert.equal(resolved.state,"Reviewed");assert.equal(resolved.canConfirm,false);assert.equal(resolved.review.note,input.note);
    const final=await post(endpoint,{type:"review",revision:result.view.revision,review:"Verified fictional internal edit receipts and unchanged loan history.",checks:[true,true,true]},owner);
    assert.equal((await post(endpoint,{type:"reopen",revision:final.revision,confirmation:"Fictional Working Day"},owner)).mode,"Open");
    assert.equal((await file(owner,loanId)).documentRequests.find(item=>item.id===doc.id).dueOn,"2030-02-01");
    if(process.argv.includes("--preview")){
      const current=(await file(owner,loanId)).documentRequests.find(item=>item.id===doc.id);
      await directory.loseNextRecoveryConfirmation();
      await write(owner,{...command,revision:current.revision,deadlineRevision:current.deadlineRevision,dueOn:"2030-03-01"});
    }
  });
  await stage("Owner recovers a confirmed internal edit and resumes a lost reply without duplicating history",async()=>{
    const created=await write(owner,{type:"loan",contactId:"",borrower:"Fictional Controlled Recovery",borrowerEmail:"controlled-recovery@example.test",
      address:"",amount:210000,purpose:"Purchase",stage:"Lead",officer:owner.name,partnerId:null,start1003:true});
    const loanId=created.loanWork.loanId;
    await write(owner,{type:"requestDocument",loanId,kind:"Pay stub",instructions:"Fictional controlled replay evidence."});
    const doc=(await file(owner,loanId)).documentRequests[0];
    await write(owner,{type:"setDocumentDeadline",loanId,requestId:doc.id,revision:doc.revision,deadlineRevision:doc.deadlineRevision,dueOn:"2030-05-01"});
    const endpoint=`/api/workspace-maintenance?brokerage=${brokerage}`;
    const status=async()=> (await runtime.dispatchFetch(origin+endpoint,{headers:{Cookie:`__Host-orbit-session=${owner.token}`}})).json();
    const edits=async(revision)=> (await runtime.dispatchFetch(origin+endpoint+`&edits=1&revision=${revision}`,{headers:{Cookie:`__Host-orbit-session=${owner.token}`}})).json();
    let view=await status();view=await post(endpoint,{type:"pause",revision:view.revision,reason:"Fictional controlled replay acceptance.",confirmation:"Fictional Working Day"},owner);
    let report=(await edits(view.revision)).inspection,edit=report.items.find(item=>item.command.loanId===loanId);
    assert.equal(edit.canReplay,false);
    await workspaces.getByName(brokerage).restoreDeadlineFixture(edit.id);
    report=(await edits(view.revision)).inspection;edit=report.items.find(item=>item.id===edit.id);assert.equal(edit.canReplay,true);
    const input={id:edit.id,revision:view.revision,offset:0,fingerprint:edit.fingerprint,note:"Recover the confirmed fictional deadline from the exact original document revision."};
    assert.equal((await postResponse(endpoint+"&replay=1",input,officer)).status,409);
    assert.equal((await postResponse(endpoint+"&replay=1",{...input,fingerprint:"0".repeat(64)},owner)).status,409);
    await workspaces.getByName(brokerage).loseNextReplayReply();
    assert.equal((await postResponse(endpoint+"&replay=1",input,owner)).status,409);
    view=await status();report=(await edits(view.revision)).inspection;assert.equal(report.pendingReplay.editId,edit.id);
    assert.equal(report.items.find(item=>item.id===edit.id).finding,"Saved revision present");
    assert.equal((await postResponse(endpoint,{type:"review",revision:view.revision,review:"Uncertain outcome must block review",checks:[true,true,true]},owner)).status,409);
    assert.equal((await postResponse(endpoint,{type:"reopen",revision:view.revision,confirmation:"Fictional Working Day"},owner)).status,409);
    const counts=await workspaces.getByName(brokerage).recoveryFixtureCounts(loanId);
    try{await workspaces.getByName(brokerage).restartMaintenanceFixture();}catch{/* Resume reads the durable atomic outcome. */}
    const resume={id:edit.id,resume:true};
    assert.equal((await postResponse(endpoint+"&replay=1",resume,processor)).status,409);
    const result=await post(endpoint+"&replay=1",resume,owner);assert.match(result.message,/recovered/);
    assert.deepEqual(await workspaces.getByName(brokerage).recoveryFixtureCounts(loanId),counts);
    assert.deepEqual((await post(endpoint+"&replay=1",resume,owner)).view,result.view);
    report=(await edits(result.view.revision)).inspection;assert.equal(report.pendingReplay,null);assert.equal(report.items.find(item=>item.id===edit.id).replay.state,"Applied");
    view=await post(endpoint,{type:"review",revision:result.view.revision,review:"Recovered exact fictional deadline and verified no duplicate history.",checks:[true,true,true]},owner);
    assert.equal((await post(endpoint,{type:"reopen",revision:view.revision,confirmation:"Fictional Working Day"},owner)).mode,"Open");
    assert.equal((await file(owner,loanId)).documentRequests[0].dueOn,"2030-05-01");
    if(process.argv.includes("--preview"))await workspaces.getByName(brokerage).restoreDeadlineFixture(edit.id);
  });
  await stage("Pilot restores confirmed closing checklist changes without overwriting newer work", async () => {
    const created = await write(officer,{type:"loan",contactId:"",borrower:"Fictional Checklist Recovery",borrowerEmail:"closing-recovery@example.test",
      address:"",amount:210000,purpose:"Purchase",stage:"Lead",officer:officer.name,partnerId:null,start1003:true});
    const loanId = created.loanWork.loanId;
    const item = async (title) => {
      const itemId = randomUUID();
      await write(officer,{type:"saveClosingItem",loanId,itemId,revision:0,title,owner:officer.name,dueDate:"2030-04-02"});
      return itemId;
    };
    const completed = await item("Verify wire instructions"), reopened = await item("Review settlement figures"), updated = await item("Confirm title review");
    const setStatus = (itemId,revision,completed) => ({type:"completeClosingItem",loanId,itemId,revision,completed});
    await write(officer,setStatus(completed,1,true));
    await write(officer,setStatus(reopened,1,true));
    await write(officer,setStatus(reopened,2,false));
    await write(officer,setStatus(updated,1,true));
    const fileBefore = await file(officer,loanId);
    const original = fileBefore.closingItems.find(item=>item.id===completed);
    assert.ok(original.completedAt);
    const store = workspaces.getByName(brokerage);
    const counts = await store.recoveryFixtureCounts(loanId);
    await write(officer,setStatus(completed,1,true));
    assert.equal(await store.recoveryFixtureCounts(loanId),counts);
    const endpoint = `/api/workspace-maintenance?brokerage=${brokerage}`;
    const status = async () => (await runtime.dispatchFetch(origin+endpoint,{headers:{Cookie:`__Host-orbit-session=${owner.token}`}})).json();
    const edits = async (revision) => (await runtime.dispatchFetch(origin+endpoint+`&edits=1&revision=${revision}`,{headers:{Cookie:`__Host-orbit-session=${owner.token}`}})).json();
    let view = await status();
    view = await post(endpoint,{type:"pause",revision:view.revision,reason:"Fictional closing checklist recovery.",confirmation:"Fictional Working Day"},owner);
    const report = (await edits(view.revision)).inspection;
    const select = (report,itemId,completed) => report.items.find(row=>row.command.itemId===itemId&&row.command.completed===completed);
    const completion = select(report,completed,true), reopening = select(report,reopened,false), changed = select(report,updated,true);
    assert.equal(completion.finding,"Saved revision present");
    assert.equal(completion.proof.after.completedAt,original.completedAt);
    assert.equal(reopening.proof.after.completedAt,null);
    for (const edit of [completion,reopening,changed]) await store.restoreClosingItemFixture(edit.id);
    // Emulate an independent newer checklist update after restore. Its revision
    // advances while the item stays open, so status alone cannot justify replay.
    await store.advanceClosingItemFixture(updated);
    let inspected = (await edits(view.revision)).inspection;
    assert.equal(select(inspected,updated,true).finding,"Different revision present");
    assert.equal(select(inspected,updated,true).canReplay,false);
    const recoverInput = (edit) => ({id:edit.id,revision:view.revision,offset:0,fingerprint:edit.fingerprint,
      note:"Restore the confirmed checklist change from its original revision."});
    assert.equal((await postResponse(endpoint+"&replay=1",recoverInput(select(inspected,updated,true)),owner)).status,409);
    assert.equal((await postResponse(endpoint+"&replay=1",recoverInput(select(inspected,completed,true)),officer)).status,409);
    for (const [itemId,nextCompleted] of [[completed,true],[reopened,false]]) {
      const edit = select(inspected,itemId,nextCompleted);
      assert.equal(edit.canReplay,true);
      const result = await post(endpoint+"&replay=1",recoverInput(edit),owner);
      assert.match(result.message,/Closing checklist change recovered/);
      view = result.view;
      const receiptCounts = await store.recoveryFixtureCounts(loanId);
      assert.deepEqual((await post(endpoint+"&replay=1",{id:edit.id,resume:true},owner)).view,view);
      assert.equal(await store.recoveryFixtureCounts(loanId),receiptCounts);
      inspected = (await edits(view.revision)).inspection;
      assert.equal(select(inspected,itemId,nextCompleted).replay.state,"Applied");
    }
    view = await post(endpoint,{type:"review",revision:view.revision,review:"Reconciled completion, reopening and newer work.",checks:[true,true,true]},owner);
    assert.equal((await post(endpoint,{type:"reopen",revision:view.revision,confirmation:"Fictional Working Day"},owner)).mode,"Open");
    const after = await file(officer,loanId);
    assert.equal(after.closingItems.find(item=>item.id===completed).completedAt,original.completedAt);
    assert.equal(after.closingItems.find(item=>item.id===reopened).completedAt,null);
    assert.equal(after.closingItems.find(item=>item.id===updated).completedAt,null);
    if(process.argv.includes("--preview")) await store.restoreClosingItemFixture(completion.id);
  });
  await stage("Owner retention holds protect PDFs and export verified bytes with hold history", async () => {
    const created = await write(owner, {type:"loan", contactId:"", borrower:"Fictional Retention Borrower",
      borrowerEmail:"retention@example.test", address:"", amount:195000, purpose:"Purchase", stage:"Lead",
      officer:owner.name, partnerId:null, start1003:false});
    const loanId = created.loanWork.loanId;
    const read = {type:"list", heldOnly:true, search:"Fictional Retention Borrower", offset:0};
    const retention = (input, staff=owner, scope=brokerage) => action(staff, "accessLoanRetention", input, undefined, scope);
    assert.equal((await retention(read)).total,0);
    for(const staff of [officer,processor]) assert.match((await retention(read,staff)).error,/current pilot owners/);
    assert.match((await retention(read,owner,randomUUID())).error,/current pilot owners/);
    await write(owner,{type:"requestDocument",loanId,kind:"Pay stub",instructions:"Fictional retention export."});
    const requestId=(await file(owner,loanId)).documentRequests[0].id;
    const first=randomUUID(), second=randomUUID();
    const bucket=await runtime.getR2Bucket("DOCUMENTS"), workspace=workspaces.getByName(brokerage);
    const firstKey=`${brokerage}/${first}.pdf`, secondKey=`${brokerage}/${second}.pdf`;
    await bucket.put(firstKey,demoDocumentPdf("clean"));
    await workspace.retentionFixtureFile(requestId,first);
    const archive=(staff=owner,selected=loanId)=>runtime.dispatchFetch(`${origin}/api/loan-retention/export?brokerage=${brokerage}&loan=${encodeURIComponent(selected)}`,{
      method:"POST",headers:{Origin:origin,Cookie:`__Host-orbit-session=${staff.token}`}
    });
    for(const staff of [officer,processor])assert.equal((await archive(staff)).status,404);
    assert.equal((await archive(owner,randomUUID())).status,404);
    const hold={type:"hold",id:randomUUID(),loanId,reference:"Fictional case RET-101"};
    const saved=await retention(hold);
    assert.equal(saved.message,"Retention hold placed.");
    assert.deepEqual(await retention(hold),saved);
    assert.equal((await retention(read)).loans[0].holdId,hold.id);
    assert.match((await action(owner,"mutate",{type:"deleteLoan",id:loanId})).error,/retention hold/);
    assert.equal((await file(owner,loanId)).loans[0].id,loanId);
    await workspace.retentionFixtureFile(requestId,second);
    const missing=await archive();
    assert.equal(missing.status,409);
    assert.match((await missing.json()).error,/partial archive/);
    await bucket.put(secondKey,demoDocumentPdf("replacement"));
    const downloaded=await archive();
    assert.equal(downloaded.status,200);
    assert.equal(downloaded.headers.get("Content-Type"),"application/zip");
    assert.equal(downloaded.headers.get("Cache-Control"),"private, no-store");
    const entries=unzipSync(new Uint8Array(await downloaded.arrayBuffer()));
    const manifest=JSON.parse(strFromU8(entries["manifest.json"]));
    assert.equal(manifest.loan.id,loanId);
    assert.equal(manifest.holdHistory[0].reference,hold.reference);
    assert.equal(manifest.files.length,2);
    for(const expected of [demoDocumentPdf("clean"),demoDocumentPdf("replacement")])
      assert(Object.values(entries).some(bytes=>Buffer.from(bytes).equals(expected)));
    const release={type:"release",id:randomUUID(),loanId,holdId:hold.id,reference:"Fictional case RET-101 resolved"};
    assert.match((await retention({...release,holdId:randomUUID()})).error,/changed/);
    assert.equal((await retention(release)).message,"Retention hold released.");
    assert.equal((await retention(read)).total,0);
    const history=await retention({type:"history",loanId});
    assert.equal(history.holds[0].releasedBy,owner.name);
    assert.equal(history.holds[0].releaseReference,release.reference);
    const released=await archive();
    assert.equal(released.status,200);
    const releasedEntries=unzipSync(new Uint8Array(await released.arrayBuffer()));
    const releasedManifest=JSON.parse(strFromU8(releasedEntries["manifest.json"]));
    assert.equal(releasedManifest.files.length,1);
    assert.equal(releasedManifest.holdHistory[0].releaseReference,release.reference);

  });
  await stage("Brokerage retention policy queues dated outcomes and protects holds during review", async () => {
    const workspace=workspaces.getByName(brokerage);
    const disposition=(input,staff=owner,expected=brokerage)=>action(staff,"accessLoanRetention",input,undefined,expected);
    const query={type:"dispositionQueue",offset:0};
    assert.equal((await disposition(query)).policy,null);
    for(const staff of [officer,processor])assert.match((await disposition(query,staff)).error,/current pilot owners/);
    assert.match((await disposition(query,owner,randomUUID())).error,/current pilot owners/);
    async function sample(name) {
      const result=await write(owner,{type:"loan",contactId:"",borrower:name,borrowerEmail:"",address:"",amount:195000,
        purpose:"Purchase",stage:"Lead",officer:owner.name,partnerId:null,start1003:false});
      return result.loanWork.loanId;
    }
    const funded=await sample("Fictional disposition funded");
    const withdrawn=await sample("Fictional disposition withdrawn");
    const legacy=await sample("Fictional disposition undated");
    const recent=await sample("Fictional disposition recent");
    for(const loanId of [withdrawn,legacy,recent])await write(owner,{type:"loanDisposition",loanId,disposition:"Withdrawn",reason:"Fictional borrower withdrew",revisitDate:null,revision:0});
    assert.equal(await workspace.dispositionFixtureDate(recent),today);
    await workspace.dispositionFixtureDates(funded,"2000-01-01",null);
    await workspace.dispositionFixtureDates(withdrawn,null,"2000-01-01");
    await workspace.dispositionFixtureDates(legacy,null,null);
    const policy={type:"saveDispositionPolicy",id:randomUUID(),expected:0,fundedDays:90,closedDays:30,reference:"Fictional owner approval RT-04"};
    const saved=await disposition(policy);
    assert.equal(saved.policy.version,1);
    assert.equal(saved.rows.find(row=>row.id===funded).reviewOn,"2000-03-31");
    const row=saved.rows.find(row=>row.id===withdrawn);
    assert.equal(row.reviewOn,"2000-01-31");
    assert.ok(!saved.rows.some(row=>[legacy,recent].includes(row.id)));
    assert.deepEqual(await disposition(policy),saved);
    assert.match((await disposition({...policy,id:randomUUID()})).error,/changed/);
    const decide={type:"saveDispositionReview",id:randomUUID(),loanId:withdrawn,policyVersion:1,basis:row.basis,previous:null,
      outcome:"Recommend disposition",reference:"Fictional records reviewed",offset:0};
    const hold={type:"hold",id:randomUUID(),loanId:withdrawn,reference:"Fictional records hold"};
    assert.equal((await disposition(hold)).kind,"saved");
    assert.ok(!(await disposition(query)).rows.some(row=>row.id===withdrawn));
    assert.match((await disposition(decide)).error,/no longer due/);
    await disposition({type:"release",id:randomUUID(),loanId:withdrawn,holdId:hold.id,reference:"Fictional hold released"});
    assert.match((await disposition(decide)).error,/changed/);
    const reopened=(await disposition(query)).rows.find(row=>row.id===withdrawn);
    const decision={...decide,basis:reopened.basis};
    const reviewed=await disposition(decision);
    assert.equal(reviewed.rows.find(row=>row.id===withdrawn).decision.outcome,decide.outcome);
    assert.deepEqual(await disposition(decision),reviewed);
    assert.equal((await file(owner,withdrawn)).loans[0].id,withdrawn);
    const revised=await disposition({...policy,id:randomUUID(),expected:1,reference:"Fictional updated approval RT-05"});
    assert.equal(revised.rows.find(row=>row.id===withdrawn).decision,null);
    assert.match((await disposition({...decision,id:randomUUID()})).error,/policy changed/);
    const audit={type:"retentionAudit",section:"policies",policyVersion:null,before:null};
    const exported={type:"exportRetentionAudit",policyVersion:null};
    for(const staff of [officer,processor]) {
      assert.match((await disposition(audit,staff)).error,/current pilot owners/);
      assert.match((await disposition(exported,staff)).error,/current pilot owners/);
    }
    assert.match((await disposition(exported,owner,randomUUID())).error,/current pilot owners/);
    const policies=await disposition(audit);
    assert.deepEqual(policies.policies.map(item=>item.version),[2,1]);
    assert.equal(policies.latestVersion,2);
    const history=await disposition({...audit,section:"decisions",policyVersion:1});
    assert.equal(history.decisions.find(item=>item.loanId===withdrawn).reviewOn,"2000-01-31");
    assert.equal(history.decisions.find(item=>item.loanId===withdrawn).outcome,decision.outcome);
    assert.equal((await disposition({...audit,section:"decisions",policyVersion:2})).decisions.length,0);
    assert.match((await disposition({...audit,policyVersion:100})).error,/unavailable/);
    await write(owner,{type:"deleteLoan",id:withdrawn});
    const response=await disposition({...exported,policyVersion:1});
    const auditJson=JSON.parse(response.json);
    assert.deepEqual(auditJson.policies.map(item=>item.version),[1]);
    const removed=auditJson.decisions.find(item=>item.loanId===withdrawn);
    assert.equal(removed.currentBorrower,null);
    assert.equal(removed.reference,decision.reference);
    assert.equal(removed.reviewOn,"2000-01-31");
    assert.ok(!response.json.includes(owner.email));

  });
  await stage("Owner checkpoint inspection is complete, role scoped and unavailable while work is open",async()=>{
    const endpoint=`/api/workspace-maintenance?brokerage=${brokerage}`;
    const status=async()=> (await runtime.dispatchFetch(origin+endpoint,{headers:{Cookie:`__Host-orbit-session=${owner.token}`}})).json();
    let view=await status();
    assert.equal((await postResponse(endpoint+"&checkpoints=1",{action:"list",revision:view.revision},owner)).status,409);
    view=await post(endpoint,{type:"pause",revision:view.revision,reason:"Fictional checkpoint inspection acceptance",confirmation:"Fictional Working Day"},owner);
    const identity={email:owner.email,name:owner.name,brokerage:(await directory.staffBrokerages(owner.email,[owner.email])).find(row=>row.id===brokerage)};
    const captured=JSON.parse(await workspaces.getByName(brokerage).checkpointFixture(identity,view.revision));
    assert(!captured.error,JSON.stringify(captured));assert(captured.manifest.tables.length>50);assert(captured.manifest.tables.some(table=>table.name==="loans"));
    assert.equal(captured.bookmark,"");
    assert(captured.manifest.impact.records.some(record=>record.kind==="Loan"));
    assert(captured.manifest.impact.rows.length>0);
    assert.equal((await post(endpoint+"&restore=1",{action:"status"},owner)).job,null);
    for(const person of [officer,processor])assert.equal((await postResponse(endpoint+"&restore=1",{action:"status"},person)).status,409);
    assert.equal((await postResponse(endpoint+"&restore=1",{action:"preview",checkpointId:crypto.randomUUID(),revision:view.revision-1},owner)).status,409);
    assert.deepEqual((await post(endpoint+"&checkpoints=1",{action:"list",revision:view.revision},owner)).items,[]);
    for(const person of [officer,processor])assert.equal((await postResponse(endpoint+"&checkpoints=1",{action:"list",revision:view.revision},person)).status,409);
    assert.equal((await postResponse(endpoint+"&checkpoints=1",{action:"list",revision:view.revision-1},owner)).status,409);
    view=await post(endpoint,{type:"review",revision:view.revision,review:"Verified bounded full SQL checkpoint inspection and access checks.",checks:[true,true,true]},owner);
    assert.equal((await post(endpoint,{type:"reopen",revision:view.revision,confirmation:"Fictional Working Day"},owner)).mode,"Open");
  });
  await stage("Directory pause proves admitted HTTP work drains after coordinator restart and defers alarms",async()=>{
    const bucket=await runtime.getR2Bucket("DOCUMENTS");
    const endpoint=`/api/workspace-maintenance?brokerage=${brokerage}`;
    const response=()=>runtime.dispatchFetch(origin+endpoint,{headers:{Cookie:`__Host-orbit-session=${owner.token}`}});
    const token=randomBytes(32).toString("hex");
    const evidenceToken=randomBytes(32).toString("hex");
    const marker={incident:"fixture-drain",statusTokenSha256:createHash("sha256").update(token).digest("hex"),
      evidenceTokenSha256:createHash("sha256").update(evidenceToken).digest("hex")};
    const drain=async()=>runtime.dispatchFetch(origin+directoryDrainPath,{headers:{Authorization:`Bearer ${token}`}});
    assert.equal((await response()).status,200);
    assert.equal((await drain()).status,404);
    await directory.holdStaffAccess();
    const admitted=response();
    try {
      for(let i=0;i<50&&!await directory.staffAccessWaiting();i++)await new Promise(resolve=>setTimeout(resolve,10));
      assert(await directory.staffAccessWaiting(),"The request must already be admitted");
      await bucket.put(directoryPauseKey,JSON.stringify(marker));
      assert.equal((await runtime.dispatchFetch(origin+directoryDrainPath)).status,404);
      const outstanding=await (await drain()).json();
      assert.equal(outstanding.state,"Tracked work outstanding");assert(outstanding.http>=1);
      const coordinator=workspaces.getByName(directoryDrainObject);
      try {await coordinator.restartMaintenanceFixture();} catch {/* Restart is expected. */}
      assert((await (await drain()).json()).http>=1,"An in-flight ticket must survive restart");

      const blocked=await response();
      assert.equal(blocked.status,503);
      assert.equal(blocked.headers.get("X-Orbit-Maintenance"),"directory-recovery");
      assert.equal(blocked.headers.get("Retry-After"),"60");
      for(const path of ["/api/demo-application","/api/realtor-referrals","/api/webhooks/uwm/stage/import","/api/demo-request"]){
        assert.equal((await postResponse(path,{},owner)).status,503);
      }
      const start=Date.now();
      const rescheduled=await workspaces.getByName(brokerage).directoryPauseAlarmProbe();
      assert(rescheduled>=start+60000 && rescheduled<=Date.now()+60000);
      await directory.unholdStaffAccess();
      const completed=await admitted;
      assert.equal(completed.status,200);
      await completed.arrayBuffer();
      let count;
      for(let i=0;i<50;i++){
        count=await (await drain()).json();if(count.active===0)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(count.state,"Tracked work drained");
      const evidenceId=randomUUID();
      const evidence=(method,authenticated=true)=>runtime.dispatchFetch(origin+directoryEvidencePath+`?id=${evidenceId}`,{
        method,headers:authenticated?{Authorization:`Bearer ${evidenceToken}`}:{},
      });
      assert.equal((await evidence("GET",false)).status,404);
      assert.equal((await runtime.dispatchFetch(origin+directoryEvidencePath+`?id=${evidenceId}`,{
        method:"POST",headers:{Authorization:`Bearer ${token}`},
      })).status,404);
      const saved=await evidence("POST");
      assert.equal(saved.status,201);
      const summary=await saved.json();
      assert(summary.evidence.counts.staff>=1);
      const repeated=await evidence("POST");
      assert.equal(repeated.status,200);
      assert.deepEqual(await repeated.json(),summary);
      const comparison=await (await evidence("GET")).json();
      assert.equal(comparison.matches,true);
      assert(!JSON.stringify(comparison).includes(owner.email));
      const artifact=await bucket.get(`operations/directory-recovery/evidence/${evidenceId}.json`);
      const sealed=await artifact.text();
      assert(!sealed.includes(owner.email) && !sealed.includes(owner.token));
      await bucket.delete(`operations/directory-recovery/evidence/${evidenceId}.json`);
    } finally {
      await directory.unholdStaffAccess();
      await bucket.delete(directoryPauseKey);
    }
    assert.equal((await response()).status,200);
  });
  await stage("Synthetic UWM routing verifies the committed receipt before routing later events", async () => {
    for (const [id, name] of [[lenderBrokerage, "Fictional Lender Workspace"], [lenderInbox, "Fictional Lender Inbox"]]) {
      const created = await directory.manage({ email: owner.email, name: owner.name, brokerage: { id: "orbit-demo" } },
        [owner.email], { type: "create", id, name, pilot: false });
      assert.equal(created.created, id, created.error);
    }
    const lenderOfficer = actor("Fictional Lender Officer", "lender-officer@example.test", "LO");
    const otherLenderOfficer = actor("Fictional Other Officer", "other-lender-officer@example.test", "LO");
    for (const staff of [lenderOfficer, otherLenderOfficer]) {
      await post(`/api/brokerages?brokerage=${lenderBrokerage}`, { type: "invite", email: staff.email, role: "LO" }, owner);
      await signIn(staff);
    }
    const added = await action(lenderOfficer, "mutate", { type: "loan", contactId: "", borrower: "Fictional Lender Buyer",
      borrowerEmail: "lender-buyer@example.test", address: "", amount: 280000, purpose: "Purchase", stage: "Lead",
      officer: lenderOfficer.name, partnerId: null }, undefined, lenderBrokerage, lenderBrokerage);
    assert.ok(added.loanWork?.loanId, added.error);
    const loanId = added.loanWork.loanId;
    const [operationId, requestId, transactionId] = [randomUUID(), randomUUID(), randomUUID()];
    const fixture = workspaces.getByName(lenderBrokerage);
    await fixture.lostImportResponse(loanId, operationId, requestId, transactionId, lenderOfficer.email, new Date().toISOString());
    await directory.registerUwmTransactionRoute({ email: lenderOfficer.email, name: lenderOfficer.name, brokerage: { id: lenderBrokerage } },
      operationId, transactionId, "production");
    const path = `/api/uwm-file/read?brokerage=${lenderBrokerage}`;
    const view = (staff) => post(path, { loanId, view: "activity" }, staff);
    assert.equal((await view(lenderOfficer)).requests[0].state, "Unknown");
    assert.equal((await postResponse(path, { loanId, view: "activity" }, otherLenderOfficer)).status, 409);
    const webhook = (environment, kind, token, body) => runtime.dispatchFetch(
      `${origin}/api/webhooks/uwm/${environment}/${kind}`, { method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "X-API-Key": token } : {}) },
        body: JSON.stringify(body) });
    const number = "1234567890", otherNumber = "1234567891";
    const send = (environment, token, hour = "02", loanNumber = number) => webhook(environment, "import", token, {
      TransactionId: transactionId, LoanNumber: loanNumber, LoanStatus: "Completed", LogDateTime: `2026-11-11T${hour}:00:00Z`,
    });
    const conditions = (id, loanNumber = number) => webhook("production", "conditions", webhookToken, {
      id, category: "Income", bucketKey: "income", conditionDescription: "Fictional condition", conditionSatisfactionDate: null,
      loanNumber, loanStatus: "Approved With Conditions",
    });
    const exportLoan = (loanNumber) => runtime.dispatchFetch(`${origin}/api/webhooks/uwm/production/ulad`, {
      method: "POST", headers: { "Content-Type": "application/xml", "X-API-Key": webhookToken },
      body: `<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas" MISMOReferenceModelIdentifier="3.4.032420160128"><DEAL_SETS><DEAL_SET><DEALS><DEAL><LOANS><LOAN><LOAN_IDENTIFIERS><LOAN_IDENTIFIER><LoanIdentifier>${loanNumber}</LoanIdentifier><LoanIdentifierType>LenderLoan</LoanIdentifierType></LOAN_IDENTIFIER></LOAN_IDENTIFIERS></LOAN></LOANS></DEAL></DEALS></DEAL_SET></DEAL_SETS></MESSAGE>`,
    });
    const receipts = async (id) => {
      const response = await runtime.dispatchFetch(`${origin}/api/uwm-webhook-receipts?brokerage=${id}`,
        { headers: { Cookie: `__Host-orbit-session=${owner.token}` } });
      assert.equal(response.status, 200);
      return (await response.json()).receipts;
    };
    assert.equal((await send("production", null)).status, 401);
    assert.equal((await send("stage", webhookToken)).status, 404);
    assert.equal((await view(lenderOfficer)).requests[0].state, "Unknown");
    await fixture.setImportCommitFixture(operationId, false);
    const early = await send("production", webhookToken, "01", otherNumber);
    assert.equal(early.status, 200);
    const earlyId = (await early.json()).receipt.receiptId;
    assert.equal((await view(lenderOfficer)).imports[0].state, "Prepared");
    assert.equal((await conditions("early", otherNumber)).status, 200);
    assert.equal((await receipts(lenderInbox))[0].loanNumber, otherNumber);
    await fixture.setImportCommitFixture(operationId, true);
    const earlyRetry = (await (await send("production", webhookToken, "01", otherNumber)).json()).receipt;
    assert.equal(earlyRetry.receiptId, earlyId);
    assert.equal(earlyRetry.duplicate, true);
    assert.equal((await webhook("production", "import", webhookToken, { TransactionId: transactionId, LoanNumber: otherNumber,
      LoanStatus: "Completed", LogDateTime: "2026-11-11T01:00:00Z", Message: "Reformatted fictional event" })).status, 200);
    assert.equal((await view(lenderOfficer)).requests[0].state, "Unknown");

    await fixture.interruptNextImportCompletion();
    assert.equal((await send("production", webhookToken)).status, 503);
    await fixture.restartMaintenanceFixture().catch(() => {});
    assert.equal((await view(lenderOfficer)).requests[0].state, "Unknown");
    assert.equal((await conditions("pending")).status, 200);
    assert.equal((await receipts(lenderInbox))[0].loanNumber, number);
    assert.equal((await exportLoan(number)).status, 200);
    const receipt = await send("production", webhookToken);
    assert.equal(receipt.status, 200);
    const saved = (await receipt.json()).receipt;
    assert.equal(saved.duplicate, true);
    const accepted = await view(lenderOfficer);
    assert.equal(accepted.imports[0].lenderLoanNumber, "1234567890");
    assert.deepEqual(accepted.requests.map(({ id, state }) => [id, state]), [[requestId, "Reconciled"]]);
    const repeat = (await (await send("production", webhookToken)).json()).receipt;
    assert.equal(repeat.duplicate, true);
    assert.equal(repeat.receiptId, saved.receiptId);
    await fixture.restartMaintenanceFixture().catch(() => {});
    assert.equal((await view(lenderOfficer)).requests[0].state, "Reconciled");
    assert.equal((await send("production", webhookToken, "03", otherNumber)).status, 200);
    assert.equal((await conditions("conflicting", otherNumber)).status, 200);
    assert.equal((await conditions("verified")).status, 200);
    assert.equal((await exportLoan(otherNumber)).status, 200);
    assert.equal((await exportLoan(number)).status, 200);
    assert.deepEqual((await receipts(lenderInbox)).map((row) => [row.kind, row.loanNumber]),
      [["ulad", otherNumber], ["conditions", otherNumber], ["ulad", number], ["conditions", number], ["conditions", otherNumber]]);
    assert.deepEqual((await receipts(lenderBrokerage)).filter((row) => row.kind !== "import").map((row) => [row.kind, row.loanNumber]),
      [["ulad", number], ["conditions", number]]);
    const inboxAdmin = actor("Fictional Inbox Admin", "inbox-admin@example.test", "Admin");
    await post(`/api/brokerages?brokerage=${lenderInbox}`, { type: "invite", email: inboxAdmin.email, role: "Admin" }, owner);
    await signIn(inboxAdmin);
    const inboxRows = await receipts(lenderInbox);
    const pending = inboxRows.find((row) => row.kind === "conditions" && row.loanNumber === number);
    const unknown = inboxRows.find((row) => row.loanNumber === otherNumber);
    const matchPath = `/api/uwm-webhook-receipts?brokerage=${lenderInbox}`;
    assert.equal(pending.canMatch, true);
    assert.equal((await postResponse(matchPath, { receiptId: pending.id }, inboxAdmin)).status, 409);
    assert.equal((await postResponse(matchPath, { receiptId: unknown.id }, owner)).status, 409);
    assert.equal((await postResponse(matchPath, { receiptId: pending.id, destination: lenderBrokerage }, owner)).status, 400);
    await workspaces.getByName(lenderBrokerage).loseNextMatchedReceipt();
    assert.equal((await postResponse(matchPath, { receiptId: pending.id }, owner)).status, 503);
    assert.equal((await receipts(lenderInbox)).find((row) => row.id === pending.id).status, "Awaiting reconciliation");
    const results = await Promise.all([post(matchPath, { receiptId: pending.id }, owner), post(matchPath, { receiptId: pending.id }, owner)]);
    assert.deepEqual(results, [{ status: "Matched" }, { status: "Matched" }]);
    const matched = (await receipts(lenderInbox)).find((row) => row.id === pending.id);
    assert.equal(matched.status, "Matched");
    assert.equal(matched.canMatch, false);
    assert.equal((await receipts(lenderBrokerage)).filter((row) => row.kind === "conditions").length, 2);
    assert.equal(matched.canCheck, true);
    const source = workspaces.getByName(lenderInbox), destination = workspaces.getByName(lenderBrokerage);
    const originalCopy = await source.matchedReceiptIdFixture(pending.id);
    await destination.removeMatchedReceiptFixture(originalCopy);
    assert.equal((await receipts(lenderInbox)).find((row) => row.id === pending.id).status, "Matched");
    assert.equal((await receipts(lenderBrokerage)).filter((row) => row.kind === "conditions").length, 1);
    assert.equal((await postResponse(matchPath, { receiptId: pending.id }, inboxAdmin)).status, 409);
    await destination.loseNextMatchedReceipt();
    assert.equal((await postResponse(matchPath, { receiptId: pending.id }, owner)).status, 503);
    const resumed = await Promise.all([post(matchPath, { receiptId: pending.id }, owner), post(matchPath, { receiptId: pending.id }, owner)]);
    assert.deepEqual(resumed, [{ status: "Matched" }, { status: "Matched" }]);
    const restoredCopy = await source.matchedReceiptIdFixture(pending.id);
    assert.notEqual(restoredCopy, originalCopy);
    assert.equal((await receipts(lenderBrokerage)).filter((row) => row.kind === "conditions").length, 2);
    if (process.argv.includes("--preview")) await destination.removeMatchedReceiptFixture(restoredCopy);
  });

  await stage("Pilot staff track their own support requests and the owner updates the brokerage queue", async () => {
    const endpoint = (id = brokerage) => `/api/brokerages?brokerage=${id}`;
    const exact = (id, workspace) => `${endpoint(workspace)}&view=pilot-support-requests&id=${id}`;
    const read = async (staff, url) => {
      const response = await browse(staff, url);
      assert.equal(response.status, 200);
      return JSON.parse(response.text()).items;
    };
    const id = randomUUID(), other = randomUUID();
    const report = { type: "pilotFeedback", id, step: "Documents", message: "The fictional document preview needs a second look." };
    const intake = await Promise.all([post(endpoint(), report, officer), post(endpoint(), report, officer)]);
    assert.deepEqual(intake, [{ message: "Support request saved." }, { message: "Support request saved." }]);
    await post(endpoint(), { ...report, id: other, step: "UWM conditions", message: "Check the sample condition after a refresh." }, processor);
    const adminView = await read(owner, exact(id));
    assert.equal(adminView[0].ownerName, owner.name);
    assert.equal(adminView[0].triage.author, officer.email);
    assert.deepEqual(await read(officer, exact(other)), []);
    assert.deepEqual(await read(processor, exact(id)), []);
    const otherBrokerage = await browse(owner, exact(id, lenderBrokerage));
    assert.ok(otherBrokerage.status === 403 || (otherBrokerage.status === 200 && !JSON.parse(otherBrokerage.text()).items.length));
    assert.equal((await browse(officer, "/api/brokerages?view=pilot-support-requests")).status, 403);
    const update = { type: "triagePilotFeedback", id, owner: owner.email, priority: "High", status: "Ready to retest",
      retest: "Verified with the second fictional PDF.", requesterUpdate: "Try the sample preview again.", revision: 0 };
    assert.equal((await postResponse(endpoint(), update, processor)).status, 403);
    assert.equal((await postResponse(endpoint(), { ...update, owner: "inactive@example.test" }, owner)).status, 409);
    await post(endpoint(), update, owner);
    await post(endpoint(), update, owner);
    assert.equal((await postResponse(endpoint(), { ...update, status: "In progress" }, owner)).status, 409);
    const [staffView] = await read(officer, exact(id));
    assert.equal(staffView.requesterUpdate, update.requesterUpdate);
    assert.equal(staffView.status, update.status);
    assert.equal("triage" in staffView, false);
    assert.equal((await read(owner, exact(id)))[0].triage.revision, 1);
  });

  await stage("First-day progress stays personal and scoped to the signed-in role and brokerage", async () => {
    const endpoint = (id = brokerage) => `/api/brokerages?brokerage=${id}&view=staff-first-day`;
    const checklist = async (staff, url = endpoint()) => {
      const response = await browse(staff, url);
      assert.equal(response.status, 200);
      const data = JSON.parse(response.text());
      assert.equal(data.kind, "staffFirstDay");
      return data.steps;
    };
    const staffStep = { step: "staff-access", completed: true, revision: 0 };
    assert.deepEqual((await checklist(owner)).map(({ id }) => id), ["staff-access", "loan-defaults", "lead-routing", "assign-processing"]);
    assert.deepEqual((await checklist(officer)).map(({ id }) => id), ["today", "lead-inbox", "loan-pipeline"]);
    assert.deepEqual((await checklist(processor)).map(({ id }) => id), ["accept-handoff", "assigned-files", "processing-tasks"]);
    assert.equal((await postResponse(endpoint(), staffStep, officer)).status, 409);
    assert.equal((await postResponse(endpoint(), { ...staffStep, email: processor.email }, owner)).status, 400);
    assert.equal((await browse(owner, "/api/brokerages?view=staff-first-day")).status, 403);
    const parallel = await Promise.all([post(endpoint(), staffStep, owner), post(endpoint(), staffStep, owner)]);
    assert.deepEqual(parallel[0], parallel[1]);
    assert.equal((await checklist(owner))[0].revision, 1);
    const acrossWorkspace = await checklist(owner, endpoint(lenderBrokerage));
    assert.ok(acrossWorkspace.every(step => !step.completed && step.revision === 0));
    const undo = { ...staffStep, completed: false, revision: 1 };
    await post(endpoint(), undo, owner);
    assert.equal((await postResponse(endpoint(), staffStep, owner)).status, 409);
    assert.equal((await checklist(owner))[0].revision, 2);

    await post(endpoint(), { step: "today", completed: true, revision: 0 }, officer);
    await post(endpoint(), { step: "accept-handoff", completed: true, revision: 0 }, processor);
    assert.equal((await checklist(officer))[0].completed, true);
    assert.equal((await checklist(processor))[0].completed, true);
    assert.equal((await checklist(owner))[0].completed, false);
    const alternateRole = actor("Fictional New Staff", "first-day-processor@example.test", "Processor");
    await team(owner, { type: "invite", email: alternateRole.email, role: "Processor" });
    await signIn(alternateRole);
    assert.ok((await checklist(alternateRole)).every(step => !step.completed));
    await post(endpoint(), { step: "assigned-files", completed: true, revision: 0 }, alternateRole);
    await team(owner, { type: "role", email: alternateRole.email, role: "LO" });
    assert.deepEqual((await checklist(alternateRole)).map(({ id }) => id), ["today", "lead-inbox", "loan-pipeline"]);
    assert.ok((await checklist(alternateRole)).every(step => !step.completed));
    await team(owner, { type: "revoke", email: alternateRole.email });
    assert.notEqual((await browse(alternateRole, endpoint())).status, 200);
  });

  await stage("CRM events preserve source revisions and retry a simulated failure exactly once", async () => {
    const endpoint = (id = brokerage) => `/api/brokerages?brokerage=${id}&view=automation-events`;
    const read = async (suffix = "", staff = owner, id = brokerage) => {
      const response = await browse(staff, endpoint(id) + suffix);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control"), /private, no-store/);
      return JSON.parse(response.text());
    };
    assert.equal((await browse(officer, endpoint())).status, 403);
    assert.equal((await browse(processor, endpoint())).status, 403);
    assert.equal((await browse(owner, "/api/brokerages?view=automation-events")).status, 403);
    assert.equal((await browse(owner, endpoint() + "&status=Sent")).status, 400);
    assert.equal((await browse(owner, endpoint() + "&before=0")).status, 400);

    const created = await write(owner, { type: "loan", borrower: "Fictional event timeline", borrowerEmail: "event-timeline@example.test",
      contactId: "", partnerId: null, officer: owner.name, address: "", amount: 225000, purpose: "Purchase", stage: "Lead" });
    const fundingLoan = created.loanWork.loanId;
    const priorDay = new Date(Date.parse(today + "T12:00:00Z") - 86_400_000).toISOString().slice(0, 10);
    await loanAction(owner, fundingLoan, "recordClosing", { revision: 0, closingDate: priorDay });
    await loanAction(owner, fundingLoan, "recordFunding", { revision: 0, fundingDate: priorDay });
    await loanAction(owner, fundingLoan, "recordFunding", { revision: 0, fundingDate: priorDay });
    await loanAction(owner, fundingLoan, "recordFunding", { revision: 1, fundingDate: today });
    await loanAction(owner, fundingLoan, "reverseFunding", { revision: 2, fundingDate: today, reason: "Fictional reversal for the delivery queue." });

    const seen = new Set(), all = [];
    let before = null;
    do {
      const page = await read(before ? "&before=" + before : "");
      assert.equal(page.kind, "events");
      assert.ok(page.events.length <= 20);
      for (const item of page.events) {
        assert.ok(!seen.has(item.payload.eventId));
        seen.add(item.payload.eventId);
        all.push(item);
      }
      before = page.next;
    } while (before !== null);
    assert.ok(all.length > 20);
    const timeline = all.filter(({ payload }) => payload.resource.id === fundingLoan);
    assert.deepEqual(timeline.map(({ payload }) => [payload.eventType, payload.resource.revision]), [
      ["loan.funding_reversed", 3], ["loan.funding_updated", 2], ["loan.funded", 1], ["lead.created", 1],
    ]);
    assert.ok(all.some(({ payload }) => payload.eventType === "application.submitted" && payload.resource.id === loanId));
    assert.ok(all.some(({ payload }) => payload.eventType === "loan.funded" && payload.resource.id === loanId));
    assert.equal(campaignImportLeadIds.size, 3);
    const importedEvents = all.filter(({ payload }) => payload.eventType === "lead.created" && campaignImportLeadIds.has(payload.resource.id));
    assert.equal(importedEvents.length, 3);
    assert.ok(importedEvents.every(({ payload }) => payload.source === "Campaign CSV"));
    assert.ok(!all.some(({ payload }) => payload.eventType === "lead.created" && payload.resource.id === leadId));
    for (const source of ["Realtor referral", "Website quote request", "Direct entry"]) {
      assert.ok(all.some(({ payload }) => payload.eventType === "lead.created" && payload.source === source));
    }
    assert.ok(all.every(({ status }) => status === "Queued"));
    const initial = timeline[3];
    const id = initial.payload.eventId;
    const exact = "&id=" + id;
    assert.deepEqual(Object.keys(initial.payload), ["schemaVersion", "eventId", "eventType", "occurredAt", "source", "resource"]);
    assert.deepEqual(Object.keys(initial.payload.resource), ["kind", "id", "revision"]);
    assert.equal((await browse(owner, endpoint(lenderBrokerage) + exact)).status, 404);
    const failure = { type: "attempt", id, operationId: randomUUID(), attempt: 0, simulateFailure: true };
    assert.equal((await postResponse(endpoint(), failure, officer)).status, 403);
    const failed = await Promise.all([post(endpoint(), failure, owner), post(endpoint(), failure, owner)]);
    assert.deepEqual(failed[0], failed[1]);
    assert.equal(failed[0].event.status, "Failed");
    assert.equal(failed[0].attempts.length, 1);
    assert.deepEqual(failed[0].event.payload, initial.payload);
    assert.deepEqual((await read("&status=Failed&eventType=lead.created")).events.map(({ payload }) => payload.eventId), [id]);
    assert.equal((await postResponse(endpoint(), { ...failure, operationId: randomUUID(), simulateFailure: false }, owner)).status, 409);
    const retry = { ...failure, operationId: randomUUID(), attempt: 1, simulateFailure: false };
    await post(endpoint(), retry, owner);
    await post(endpoint(), retry, owner);
    const received = await read(exact);
    assert.deepEqual(received.event.payload, initial.payload);
    assert.deepEqual(received.attempts.map(({ outcome }) => outcome), ["Simulated", "Failed"]);
    assert.equal((await postResponse(endpoint(), { ...retry, operationId: randomUUID(), attempt: 2 }, owner)).status, 409);
    assert.deepEqual((await read("&status=Failed")).events, []);
  });

  await stage("Simulated destinations receive only selected events and keep independent replay history", async () => {
    const base = (id = brokerage) => `/api/brokerages?brokerage=${id}`;
    const settings = base() + "&view=automation-destinations";
    const deliveries = id => base() + "&view=automation-events" + (id ? "&destinationId=" + id : "");
    const read = async (url, staff = owner) => {
      const response = await browse(staff, url);
      assert.equal(response.status, 200);
      return JSON.parse(response.text());
    };
    const create = (name, eventTypes) => ({ type: "createDestination", id: randomUUID(), name, eventTypes });
    const leads = create("Fictional lead handoff", ["lead.created"]);
    const closing = create("Fictional sales and funding", ["lead.created", "loan.funded"]);
    assert.equal((await postResponse(settings, leads, officer)).status, 403);
    assert.equal((await postResponse(settings, { ...leads, eventTypes: [] }, owner)).status, 400);
    assert.equal((await postResponse(settings, { ...leads, url: "https://example.test" }, owner)).status, 400);
    const created = await Promise.all([post(settings, leads, owner), post(settings, leads, owner)]);
    assert.deepEqual(created[0], created[1]);
    await post(settings, closing, owner);
    assert.equal((await read(settings)).destinations.length, 2);
    assert.equal((await browse(owner, base(lenderBrokerage) + "&view=automation-destinations&id=" + leads.id)).status, 404);
    assert.deepEqual((await read(deliveries(leads.id))).events, []);
    assert.deepEqual((await read(deliveries(closing.id))).events, []);

    const newLead = async name => (await write(owner, { type: "loan", borrower: name, contactId: "", partnerId: null, officer: owner.name,
      address: "", amount: 240000, purpose: "Purchase", stage: "Lead" })).loanWork.loanId;
    const lead = await newLead("Fictional first destination lead");
    const [original] = (await read(deliveries(leads.id))).events;
    assert.equal(original.payload.resource.id, lead);
    assert.equal(original.subscriptionRevision, 1);
    assert.deepEqual((await read(deliveries(closing.id))).events[0].payload, original.payload);

    const state = (id, revision, state) => ({ type: "setDestinationState", id, revision, state, operationId: randomUUID() });
    const pause = state(leads.id, 1, "Paused");
    await post(settings, pause, owner);
    await post(settings, pause, owner);
    const queuedWhilePaused = await newLead("Fictional paused destination lead");
    const paused = await read(deliveries(leads.id));
    assert.equal(paused.destination.state, "Paused");
    assert.equal(paused.destination.revision, 2);
    assert.equal(paused.events[0].payload.resource.id, queuedWhilePaused);
    assert.equal(paused.events[0].subscriptionRevision, 2);
    const id = original.payload.eventId;
    const attempt = (destinationId, destinationRevision, attempt, simulateFailure = false) => ({ type: "attempt", id, destinationId,
      destinationRevision, attempt, simulateFailure, operationId: randomUUID() });
    assert.match((await postResponse(deliveries(leads.id), attempt(leads.id, 2, 0), owner)).result.error, /Resume/);
    const closingDelivery = await post(deliveries(closing.id), attempt(closing.id, 1, 0), owner);
    assert.equal(closingDelivery.event.status, "Simulated");
    assert.equal((await read(deliveries(leads.id) + "&id=" + id)).event.status, "Queued");

    const edit = { type: "editDestination", id: leads.id, revision: 2, operationId: randomUUID(), name: "Fictional lead handoff",
      eventTypes: ["loan.funded"] };
    const edited = await post(settings, edit, owner);
    assert.equal(edited.destination.revision, 3);
    assert.equal((await postResponse(settings, { ...edit, operationId: randomUUID() }, owner)).status, 409);
    await post(settings, state(leads.id, 3, "Active"), owner);
    const later = await newLead("Fictional lead after a subscription edit");
    assert.ok(!(await read(deliveries(leads.id))).events.some(({ payload }) => payload.resource.id === later));
    assert.ok((await read(deliveries(closing.id))).events.some(({ payload }) => payload.resource.id === later));
    await loanAction(owner, later, "recordClosing", { revision: 0, closingDate: today });
    await loanAction(owner, later, "recordFunding", { revision: 0, fundingDate: today });
    assert.equal((await read(deliveries(leads.id) + "&eventType=loan.funded")).events[0].payload.resource.id, later);

    assert.match((await postResponse(deliveries(leads.id), attempt(leads.id, 1, 0), owner)).result.error, /destination changed/);
    const failure = attempt(leads.id, 4, 0, true);
    const failed = await post(deliveries(leads.id), failure, owner);
    await post(deliveries(leads.id), failure, owner);
    assert.equal(failed.attempts.length, 1);
    assert.deepEqual(failed.subscription.eventTypes, ["lead.created"]);
    assert.deepEqual(failed.event.payload, original.payload);
    const retried = await post(deliveries(leads.id), attempt(leads.id, 4, 1), owner);
    assert.deepEqual(retried.attempts.map(({ outcome }) => outcome), ["Simulated", "Failed"]);
    assert.deepEqual(retried.event.payload, original.payload);
    assert.equal((await read(deliveries(closing.id) + "&id=" + id)).attempts.length, 1);

    await post(settings, state(closing.id, 1, "Disconnected"), owner);
    assert.equal((await postResponse(settings, state(closing.id, 2, "Active"), owner)).status, 409);
    const closedBefore = (await read(deliveries(closing.id))).events.length;
    const next = await newLead("Fictional lead after disconnect");
    assert.equal((await read(deliveries(closing.id))).events.length, closedBefore);
    assert.ok((await read(deliveries() + "&eventType=lead.created")).events.some(({ payload }) => payload.resource.id === next));
    const pending = (await read(deliveries(closing.id) + "&status=Queued")).events[0].payload.eventId;
    assert.match((await postResponse(deliveries(closing.id), { ...attempt(closing.id, 2, 0), id: pending }, owner)).result.error, /disconnected/);
    assert.equal((await read(deliveries(closing.id) + "&id=" + id)).attempts.length, 1);

    if (process.argv.includes("--preview")) {
      await post(settings, create("Fictional partner intake", ["lead.created"]), owner);
      await newLead("Fictional destination browser lead");
    }
  });

  await stage("Destination batch receipts survive retries and recover only failed events", async () => {
    const base = (id = brokerage) => `/api/brokerages?brokerage=${id}`;
    const settings = base() + "&view=automation-destinations";
    const destinationId = randomUUID();
    await post(settings, { type: "createDestination", id: destinationId, name: "Fictional batch rehearsal", eventTypes: ["lead.created"] }, owner);
    const endpoint = base() + "&view=automation-batches&destinationId=" + destinationId;
    const events = base() + "&view=automation-events&destinationId=" + destinationId;
    const read = async (path, staff = owner) => {
      const response = await browse(staff, path);
      assert.equal(response.status, 200);
      return JSON.parse(response.text());
    };
    const create = name => write(owner, { type: "loan", borrower: name, contactId: "", partnerId: null, officer: owner.name,
      address: "", amount: 240000, purpose: "Purchase", stage: "Lead" });
    for (let index = 1; index <= 11; index++) await create("Fictional batch lead " + index);
    assert.equal((await browse(officer, endpoint)).status, 403);
    assert.equal((await browse(owner, base(lenderBrokerage) + "&view=automation-batches&destinationId=" + destinationId)).status, 404);
    const original = await read(endpoint + "&status=Queued");
    assert.equal(original.items.length, 10);
    assert.equal(original.more, true);
    const single = { type: "attempt", id: original.items[0].eventId, destinationId, destinationRevision: 1,
      operationId: randomUUID(), attempt: 0, simulateFailure: false };
    await post(events, single, owner);
    const run = (preview, failEventId) => ({ type: "run", destinationId, status: preview.status, batchId: randomUUID(),
      fingerprint: preview.fingerprint, ...(failEventId ? { failEventId } : {}) });
    assert.equal((await postResponse(endpoint, run(original), owner)).status, 409);
    assert.equal((await read(endpoint)).batches.length, 0);

    const latest = await read(endpoint + "&status=Queued");
    const failedId = latest.items[1].eventId;
    const batch = run(latest, failedId);
    assert.equal((await postResponse(endpoint, batch, processor)).status, 403);
    assert.equal((await postResponse(endpoint, { ...batch, failEventId: randomUUID() }, owner)).status, 409);
    const repeats = await Promise.all([post(endpoint, batch, owner), post(endpoint, batch, owner)]);
    assert.deepEqual(repeats[0], repeats[1]);
    const receipt = repeats[0];
    assert.equal(receipt.items.length, 10);
    assert.deepEqual(receipt.items.filter(item => item.attempt.outcome === "Failed").map(item => item.eventId), [failedId]);
    assert.equal((await read(endpoint + "&batchId=" + batch.batchId)).items[1].attempt.number, 1);
    assert.equal((await read(endpoint + "&status=Queued")).items.length, 0);

    const failure = await read(endpoint + "&status=Failed");
    assert.deepEqual(failure.items.map(({ eventId }) => eventId), [failedId]);
    const update = (revision, state) => post(settings, { type: "setDestinationState", id: destinationId,
      revision, state, operationId: randomUUID() }, owner);
    await update(1, "Paused");
    assert.equal((await postResponse(endpoint, run(failure), owner)).status, 409);
    await update(2, "Active");
    assert.equal((await postResponse(endpoint, run(failure), owner)).status, 409);
    const next = run(await read(endpoint + "&status=Failed"));
    const recovery = await post(endpoint, next, owner);
    assert.equal(recovery.items[0].attempt.number, 2);
    assert.equal(recovery.items[0].attempt.outcome, "Simulated");
    const exact = await read(events + "&id=" + failedId);
    assert.deepEqual(exact.attempts.map(({ outcome }) => outcome), ["Simulated", "Failed"]);
    assert.equal((await read(endpoint + "&status=Failed")).items.length, 0);
    await update(3, "Disconnected");
    assert.deepEqual(await post(endpoint, batch, owner), receipt);
    const history = await read(endpoint);
    assert.deepEqual(history.batches.map(({ succeeded, failed }) => [succeeded, failed]), [[1, 0], [9, 1]]);
    assert.deepEqual(await read(endpoint + "&batchId=" + batch.batchId), receipt);

    if (process.argv.includes("--preview")) {
      await post(settings, { type: "createDestination", id: randomUUID(), name: "Fictional browser batch", eventTypes: ["lead.created"] }, owner);
      await create("Fictional batch browser alpha");
      await create("Fictional batch browser beta");
      await create("Fictional batch browser gamma");
    }
  });

  await stage("Brokerage admin approval, permission decisions and revocation govern sandbox partner checks", async () => {
    const endpoint = (id = brokerage) => `/api/brokerages?brokerage=${id}&view=partner-permissions`;
    const read = async (id, staff = owner) => {
      const response = await browse(staff, endpoint() + (id ? "&id=" + id : ""));
      assert.equal(response.status, 200);
      return JSON.parse(response.text());
    };
    const request = { type: "approve", id: randomUUID(), name: "Fictional event partner", scopes: ["events.read"],
      expiresAt: new Date(now + 7 * 86_400_000).toISOString() };
    assert.equal((await browse(officer, endpoint())).status, 403);
    assert.equal((await postResponse(endpoint(), request, processor)).status, 403);
    assert.equal((await postResponse(endpoint(), { ...request, scopes: ["loans.write"] }, owner)).status, 400);
    assert.equal((await postResponse(endpoint(), { ...request, expiresAt: new Date(now - 60_000).toISOString() }, owner)).status, 409);
    const [approved, replay] = await Promise.all([post(endpoint(), request, owner), post(endpoint(), request, owner)]);
    assert.deepEqual(approved, replay);
    assert.equal(approved.grant.state, "Active");
    assert.equal((await read()).grants.length, 1);
    assert.equal((await browse(owner, endpoint(lenderBrokerage) + "&id=" + request.id)).status, 404);
    const check = { type: "check", id: request.id, clientId: approved.grant.clientId, scope: "events.read", operationId: randomUUID() };
    const allowed = await post(endpoint(), check, owner);
    assert.equal(allowed.check.decision, "Allowed");
    assert.equal(allowed.sample.eventId, "sample-event-01");
    assert.deepEqual(await post(endpoint(), check, owner), allowed);
    const blockedScope = await post(endpoint(), { ...check, scope: "loans.read", operationId: randomUUID() }, owner);
    assert.equal(blockedScope.check.decision, "Scope missing");
    assert.equal(blockedScope.sample, undefined);
    const wrong = await post(endpoint(), { ...check, clientId: randomUUID(), operationId: randomUUID() }, owner);
    assert.equal(wrong.check.decision, "Client mismatch");
    assert.equal(wrong.sample, undefined);
    const revoke = { type: "revoke", id: request.id, revision: 1, operationId: randomUUID() };
    await post(endpoint(), revoke, owner);
    assert.equal((await post(endpoint(), revoke, owner)).grant.state, "Revoked");
    assert.equal((await postResponse(endpoint(), check, owner)).status, 409);
    const blocked = await post(endpoint(), { ...check, operationId: randomUUID() }, owner);
    assert.equal(blocked.check.decision, "Revoked");
    assert.equal(blocked.sample, undefined);
    assert.equal((await read(request.id)).checks.length, 4);

    const alternateAdmin = actor("Fictional Approving Admin", "sandbox-grant-admin@example.test", "Admin");
    await team(owner, { type: "invite", email: alternateAdmin.email, role: "Admin" });
    await signIn(alternateAdmin);
    const other = { ...request, id: randomUUID(), name: "Fictional approval-bound partner" };
    const second = await post(endpoint(), other, alternateAdmin);
    await team(owner, { type: "role", email: alternateAdmin.email, role: "LO" });
    assert.equal((await browse(alternateAdmin, endpoint())).status, 403);
    const authority = await post(endpoint(), { ...check, id: other.id, clientId: second.grant.clientId, operationId: randomUUID() }, owner);
    assert.equal(authority.check.decision, "Approval changed");
    assert.equal(authority.sample, undefined);
    assert.equal((await read(other.id)).grant.state, "Approval changed");
    await team(owner, { type: "role", email: alternateAdmin.email, role: "Admin" });
    assert.equal((await read(other.id)).grant.state, "Approval changed");
    await team(owner, { type: "revoke", email: alternateAdmin.email });
  });

  await stage("Fictional sandbox event credential authorizes paged, auditable reads and revocation", async () => {
    const endpoint = `/api/brokerages?brokerage=${brokerage}&view=partner-permissions`;
    const issue = { type: "issueEventCredential", id: randomUUID(), previous: null, operationId: randomUUID() };
    const registration = { type: "approve", id: issue.id, name: "Fictional partner feed", scopes: ["events.read"],
      expiresAt: new Date(now + 7 * 86_400_000).toISOString() };
    await post(endpoint, registration, owner);
    const api = (bearer, query = "", method = "GET") => runtime.dispatchFetch(`${origin}/api/sandbox/v1/events${query}`, {
      method, redirect: "manual", headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });
    assert.equal((await api(undefined)).status, 401);
    assert.equal((await api(undefined, "", "POST")).status, 405);
    assert.equal((await postResponse(endpoint, issue, officer)).status, 403);
    const credential = await post(endpoint, issue, owner);
    assert.equal(credential.kind, "eventCredential");
    assert.equal((await postResponse(endpoint, issue, owner)).status, 409);
    const first = await api(credential.bearer, "?limit=2");
    assert.equal(first.status, 200);
    assert.match(first.headers.get("cache-control"), /no-store/);
    const receipt = first.headers.get("Orbit-Receipt-Id");
    assert.ok(receipt);
    const page = await first.json();
    assert.equal(page.events.length, 2);
    const last = await (await api(credential.bearer, "?after=" + page.nextCursor)).json();
    assert.deepEqual(last.events.map(({ eventType }) => eventType), ["loan.funded", "loan.funding_updated", "loan.funding_reversed"]);
    assert.equal(last.hasMore, false);
    assert.equal((await api(credential.bearer, "?limit=2&limit=3")).status, 400);
    assert.equal((await api(credential.bearer.replace(brokerage, lenderBrokerage))).status, 401);
    const detail = await (await readTeam(owner, { view: "partner-permissions", id: issue.id })).json();
    assert.equal(detail.eventCredential.id, credential.credential.id);
    assert.ok(detail.eventReceipts.some(row => row.id === receipt && row.eventCount === 2));
    assert.doesNotMatch(JSON.stringify(detail), /orbit_sandbox|secretHash/);
    const replace = { ...issue, previous: credential.credential.id, operationId: randomUUID() };
    const replacement = await post(endpoint, replace, owner);
    assert.equal((await api(credential.bearer)).status, 401);
    assert.equal((await api(replacement.bearer)).status, 200);
    assert.equal((await postResponse(endpoint, { ...replace, operationId: randomUUID() }, owner)).status, 409);
    await post(endpoint, { type: "revoke", id: issue.id, revision: 1, operationId: randomUUID() }, owner);
    const denied = await api(replacement.bearer, "?after=" + page.nextCursor);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "grant_unavailable" });
    const final = await (await readTeam(owner, { view: "partner-permissions", id: issue.id })).json();
    assert.equal(final.eventReceipts[0].decision, "Revoked");

    const otherScope = await post(endpoint, { ...registration, id: randomUUID(), scopes: ["leads.read"] }, owner);
    assert.equal((await postResponse(endpoint, { ...issue, id: otherScope.grant.id, operationId: randomUUID() }, owner)).status, 409);
    const alternateAdmin = actor("Fictional Feed Approver", "sandbox-feed-approver@example.test", "Admin");
    await team(owner, { type: "invite", email: alternateAdmin.email, role: "Admin" });
    await signIn(alternateAdmin);
    const second = await post(endpoint, { ...registration, id: randomUUID(), name: "Fictional feed approval change" }, alternateAdmin);
    const secondCredential = await post(endpoint, { ...issue, id: second.grant.id, operationId: randomUUID() }, owner);
    assert.equal((await api(secondCredential.bearer)).status, 200);
    await team(owner, { type: "role", email: alternateAdmin.email, role: "LO" });
    assert.equal((await api(secondCredential.bearer)).status, 403);
    await team(owner, { type: "role", email: alternateAdmin.email, role: "Admin" });
    assert.equal((await api(secondCredential.bearer)).status, 403);
    await team(owner, { type: "revoke", email: alternateAdmin.email });

    if (process.argv.includes("--preview")) {
      await post(endpoint, { ...registration, id: randomUUID(), name: "Fictional long partner name for CRM reporting acceptance" }, owner);
    }
  });

  await stage("Simulated delivery retries respect the captured delay and archive closed history", async () => {
    const settings = `/api/brokerages?brokerage=${brokerage}&view=automation-destinations`;
    const destinationId = randomUUID();
    const name = "Fictional CRM delivery recovery and long history";
    const eventTypes = ["lead.created"];
    await post(settings, { type: "createDestination", id: destinationId, name, eventTypes, retryDelayMinutes: 5 }, owner);
    const events = `/api/brokerages?brokerage=${brokerage}&view=automation-events&destinationId=${destinationId}`;
    const batches = `/api/brokerages?brokerage=${brokerage}&view=automation-batches&destinationId=${destinationId}`;
    const attempt = (id, count, fail, destinationRevision = 1) => ({
      type: "attempt", id, operationId: randomUUID(), attempt: count, simulateFailure: fail, destinationId, destinationRevision,
    });
    const makeEvent = async borrower => {
      const created = await write(owner, { type: "loan", borrower, contactId: "", partnerId: null, officer: owner.name,
        address: "", amount: 240000, purpose: "Purchase", stage: "Lead" });
      assert.ok(!created.error, created.error);
      const result = await browse(owner, events);
      assert.equal(result.status, 200);
      return JSON.parse(result.text()).events[0].payload.eventId;
    };
    const pending = await makeEvent("Fictional scheduled delivery");
    const failed = await post(events, attempt(pending, 0, true), owner);
    assert.equal(Date.parse(failed.event.retryAt) - Date.parse(failed.attempts[0].at), 300_000);
    const preview = async () => JSON.parse((await browse(owner, batches + "&status=Failed")).text());
    assert.equal((await postResponse(events, attempt(pending, 1, false), owner)).status, 409);
    assert.deepEqual((await preview()).items, []);
    const ageAttempt = (eventId, milliseconds) => workspaces.getByName(brokerage)
      .deliveryAttemptFixtureDate(destinationId, eventId, new Date(Date.now() - milliseconds).toISOString());
    await ageAttempt(pending, 360_000);
    assert.deepEqual((await preview()).items.map(item => item.eventId), [pending]);
    const retry = await post(events, attempt(pending, 1, true), owner);
    assert.equal(retry.event.attemptCount, 2);
    assert.deepEqual((await preview()).items, []);
    assert.equal((await postResponse(events, attempt(pending, 2, false), owner)).status, 409);
    await ageAttempt(pending, 31 * 86_400_000);
    const archive = JSON.parse((await browse(owner, events + "&history=archived")).text());
    assert.equal(archive.events[0].payload.eventId, pending);
    assert.equal(archive.events[0].archived, true);
    const current = JSON.parse((await browse(owner, events + "&history=current")).text());
    assert.deepEqual(current.events, []);
    const old = JSON.parse((await browse(owner, events + "&id=" + pending)).text());
    assert.equal(old.attempts.length, 2);
    assert.equal((await browse(officer, events + "&history=archived")).status, 403);
    if (process.argv.includes("--preview")) {
      const ready = await makeEvent("Fictional ready retry");
      await post(events, attempt(ready, 0, true), owner);
      await ageAttempt(ready, 360_000);
      const future = await makeEvent("Fictional waiting retry");
      await post(events, attempt(future, 0, true), owner);
    }
  });

  await stage("Owner delivery exceptions match sidebar counts and resolve the exact simulated attempts", async () => {
    const base = `/api/brokerages?brokerage=${brokerage}`;
    const settings = base + "&view=automation-destinations";
    const exceptions = base + "&view=automation-exceptions";
    const destinationId = randomUUID();
    const events = base + "&view=automation-events&destinationId=" + destinationId;
    const name = "Fictional CRM reporting destination with extended name";
    const initial = (await sidebar(owner)).deliveryExceptions ?? 0;
    await post(settings, { type: "createDestination", id: destinationId, name, eventTypes: ["lead.created"] }, owner);
    const read = async (path, staff = owner) => {
      const result = await browse(staff, path);
      assert.equal(result.status, 200);
      return JSON.parse(result.text());
    };
    const attempt = (id, count, fail) => post(events, { type: "attempt", id, operationId: randomUUID(), attempt: count,
      simulateFailure: fail, destinationId, destinationRevision: 1 }, owner);
    const makeFailure = async (borrower, exhausted = false) => {
      const created = await write(owner, { type: "loan", borrower, contactId: "", partnerId: null, officer: owner.name,
        address: "", amount: 240000, purpose: "Purchase", stage: "Lead" });
      assert.ok(!created.error, created.error);
      const id = (await read(events)).events[0].payload.eventId;
      await attempt(id, 0, true);
      if (exhausted) await attempt(id, 1, true);
      return id;
    };
    const ready = await makeFailure("Fictional reporting retry");
    const exhausted = await makeFailure("Fictional reporting exhausted", true);
    const items = (await read(exceptions)).items.filter(row => row.destinationId === destinationId);
    assert.deepEqual(items.map(row => [row.eventId, row.status]), [[exhausted, "Retry exhausted"], [ready, "Retry ready"]]);
    const counts = await sidebar(owner);
    assert.equal(counts.deliveryExceptions, initial + 2);
    assert.ok(counts.exceptions >= counts.deliveryExceptions);
    assert.equal((await sidebar(officer)).deliveryExceptions, undefined);
    assert.equal((await browse(officer, exceptions)).status, 403);
    assert.equal((await browse(processor, exceptions)).status, 403);
    assert.ok(!(await read(exceptions.replace(brokerage, lenderBrokerage))).items.some(row => row.destinationId === destinationId));
    const ack = { type: "acknowledge", id: exhausted, destinationId };
    assert.equal((await postResponse(events, { ...ack, id: ready }, owner)).status, 409);
    assert.equal((await postResponse(events, ack, officer)).status, 403);
    const reviewed = await post(events, ack, owner);
    assert.deepEqual((await post(events, ack, owner)).review, reviewed.review);
    assert.equal((await read(events + "&id=" + exhausted)).attempts.length, 2);
    assert.equal((await sidebar(owner)).deliveryExceptions, initial + 1);
    await attempt(ready, 1, false);
    assert.equal((await sidebar(owner)).deliveryExceptions ?? 0, initial);
    assert.ok(!(await read(exceptions)).items.some(row => row.destinationId === destinationId));

    if (process.argv.includes("--preview")) {
      await makeFailure("Fictional browser ready retry");
      await makeFailure("Fictional browser exhausted delivery", true);
    }
  });

  console.log(JSON.stringify({ setupMs, stages, handoffs, requests, staffRoleChanges: 0, staffHandoffs: handoffs.length,
    staffHandoffsVerified: ["LO to processor", "Processor to original LO"],
    importedIdentityFieldsReentered: 0, externalSystemSwitches: 0, measurement: "Local scripted mock workflow" }, null, 2));
  if(process.argv.includes("--preview")){
    await mkdir(new URL("../.orbit/",import.meta.url),{recursive:true});
    await writeFile(new URL("../.orbit/maintenance-preview.json",import.meta.url),JSON.stringify({origin,brokerage,owner,officer,processor,lenderInbox,lenderBrokerage,sharedProcessor,reportingFixture}),{mode:0o600});
    console.log(`Local maintenance preview ready at ${origin}`);
    await new Promise(()=>{});
  }
} finally {
  await runtime.dispose();
}

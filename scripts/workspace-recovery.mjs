import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, cp, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
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

const { Miniflare, convertV4MiniflareOptions } = createRequire(import.meta.resolve("wrangler"))("miniflare");
const server = fileURLToPath(new URL("../dist/server/", import.meta.url));
const config = createRequire(import.meta.url)(join(server, "wrangler.json"));
const { default: manifest } = await import("../dist/server/__vinext_action_owner_manifest.js");
const actions = Object.fromEntries(Object.keys(manifest).map((ref) => [ref.split("#").at(-1), ref]));
const bootstrap = "recovery-bootstrap@example.test";
const tempRoot = await realpath(tmpdir());
const root = await mkdtemp(join(tempRoot, "orbit-recovery-"));
const live = join(root, "source");
const staged = join(root, "staged");
const snapshot = join(root, "brokerage.sqlite");
const journalPath = join(root, "recovery-journal.sqlite");

// Local fixture RPCs. This module never ships with the Worker.
const script = `
import worker, { OrbitWorkspace } from "./index.js";
export default worker;
export class RecoveryWorkspace extends OrbitWorkspace {
  seedDirectory(tenants) {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      for (const { id, name, staff } of tenants) {
        sql.exec("INSERT INTO brokerages (id, name, pilot) VALUES (?, ?, 1)", id, name);
        for (const { email, name, role } of Object.values(staff)) {
          sql.exec("INSERT INTO brokerage_members (brokerageId, email, name, role, status) VALUES (?, ?, ?, ?, 'Active')", id, email, name, role);
        }
      }
    });
  }
  linkFixture(loanId) {
    const sql = this.ctx.storage.sql;
    return {
      borrower: sql.exec("SELECT token FROM applications WHERE loanId = ?", loanId).one().token,
      realtor: sql.exec("SELECT token, realtorId FROM realtor_portals").one(),
    };
  }
  revocationCount(tenant) {
    return this.ctx.storage.sql.exec("SELECT count(*) AS count FROM revoked_pilot_portals WHERE brokerageId = ?", tenant).one().count;
  }
  scenarioLoan() {
    return this.ctx.storage.sql.exec("SELECT loanId FROM pilot_scenario").one().loanId;
  }
  fileMetadata(requestId) {
    return this.ctx.storage.sql.exec("SELECT objectId FROM document_files WHERE requestId = ?", requestId).one().objectId;
  }
  loseFixtureFile(scenario, loanId) {
    const sql = this.ctx.storage.sql;
    if (sql.exec("SELECT id FROM pilot_scenario").one().id !== scenario || loanId !== "demo-presenter:" + scenario + ":closing") {
      throw new Error("Only the generated presenter file can be removed");
    }
    sql.exec("DELETE FROM loans WHERE id = ?", loanId);
  }
}`;

function start(path, modules) {
  return new Miniflare({ ...convertV4MiniflareOptions({
    name: "orbit-recovery", host: "127.0.0.1", modules, modulesRoot: server,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    bindings: { ORBIT_AUTH_MODE: "google", GOOGLE_CLIENT_ID: "local-fixture", GOOGLE_CLIENT_SECRET: "local-fixture",
      ORBIT_STAFF_EMAILS: bootstrap, ORBIT_DOCUMENT_UPLOADS: "mock" },
    serviceBindings: { ASSETS: () => new Response(null, { status: 404 }) },
    r2Buckets: { DOCUMENTS: "recovery-fictional-documents" },
    durableObjects: { WORKSPACE: { className: "RecoveryWorkspace", useSQLite: true } },
    resourcePersistencePath: path,
  }), telemetry: { enabled: false } });
}

function fixture(label) {
  const id = randomUUID();
  const scenario = randomUUID();
  const name = `Recovery fixture ${label}`;
  const staff = Object.fromEntries(Object.entries({ admin: "Admin", officer: "LO", processor: "Processor", backup: "LO" })
    .map(([kind, role]) => [kind, { email: `${kind}-${label}@example.test`, name: `${label} ${kind}`, role,
      brokerage: { id, name, role, pilot: true }, token: randomBytes(32).toString("base64url") }]));
  return { id, name, scenario, loan: `demo-presenter:${scenario}:closing`, staff };
}

function checkSnapshot(file, scenario) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT id FROM pilot_scenario WHERE singleton = 1").get()?.id, scenario, "Snapshot belongs to a different scenario");
    assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map((row) => row.integrity_check), ["ok"]);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    db.close();
  }
}

function inside(parent, target) {
  const path = relative(parent, target);
  assert.ok(path && !isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep), "Storage must stay within the fixture root");
  return path;
}

function stageInterruptedUpgrade(file, loanId, requestId) {
  const db = new DatabaseSync(file);
  const legacyId = `${loanId}:insurance`;
  try {
    db.exec("BEGIN");
    assert.equal(db.prepare("UPDATE document_requests SET id = ? WHERE id = ? AND loanId = ?").run(legacyId, requestId, loanId).changes, 1);
    db.prepare("INSERT INTO document_files (requestId, objectId, attemptedAt) VALUES (?, 'fixture-insurance-metadata', 0)").run(legacyId);
    db.exec(`DROP INDEX borrower_documents_by_due;
      CREATE TRIGGER recovery_upgrade_interrupt BEFORE UPDATE OF requestId ON document_files
      WHEN OLD.requestId <> NEW.requestId BEGIN SELECT RAISE(ABORT, 'Fictional upgrade interrupted'); END;
      COMMIT;`);
  } finally {
    db.close();
  }
  return legacyId;
}

function clearUpgradeFault(file, loanId, legacyId) {
  const db = new DatabaseSync(file);
  try {
    assert.deepEqual(db.prepare("SELECT id FROM document_requests WHERE loanId = ?").all(loanId).map(({ id }) => id), [legacyId]);
    assert.equal(db.prepare("SELECT objectId FROM document_files WHERE requestId = ?").get(legacyId).objectId, "fixture-insurance-metadata");
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'borrower_documents_by_due'").get(), undefined);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    db.exec("DROP TRIGGER recovery_upgrade_interrupt");
  } finally {
    db.close();
  }
}

function openJournal() {
  const db = new DatabaseSync(journalPath);
  db.exec(`CREATE TABLE IF NOT EXISTS receipts (
    sequence INTEGER PRIMARY KEY, brokerageId TEXT NOT NULL, scenarioId TEXT NOT NULL,
    payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'acknowledged', 'reconciled', 'rejected')), proof TEXT
  ) STRICT`);
  return db;
}

function recordIntent(db, tenant, input) {
  if (input.type === "saveClosingItem") assert.equal(input.loanId, tenant.loan);
  else {
    assert.equal(input.type, "saveCutoverReview", "This journal accepts only the generated fixture's checklist edits and lender review");
    assert.deepEqual({ loanId: input.loanId, origin: input.origin, basis: input.basis }, tenant.cutover);
    assert.equal(input.item, "lender");
    assert.equal(input.decision, "Reconciled");
  }
  return db.prepare("INSERT INTO receipts (brokerageId, scenarioId, payload) VALUES (?, ?, ?) RETURNING sequence")
    .get(tenant.id, tenant.scenario, JSON.stringify(input)).sequence;
}

function settleReceipt(db, tenant, sequence, status, proof = null) {
  const result = db.prepare("UPDATE receipts SET status = ?, proof = ? WHERE brokerageId = ? AND scenarioId = ? AND sequence = ? AND status = 'pending'")
    .run(status, proof && JSON.stringify(proof), tenant.id, tenant.scenario, sequence);
  assert.equal(result.changes, 1);
}

function readReceipts(db, tenant, checkpoint) {
  return db.prepare(`SELECT sequence, payload, status, proof FROM receipts WHERE brokerageId = ? AND scenarioId = ?
    AND sequence > ? ORDER BY sequence`).all(tenant.id, tenant.scenario, checkpoint)
    .map(({ payload, proof, ...row }) => ({ ...row, input: JSON.parse(payload), proof: proof && JSON.parse(proof) }));
}

function replayableReceipts(db, tenant, checkpoint) {
  const receipts = readReceipts(db, tenant, checkpoint);
  assert.ok(!receipts.some(({ status }) => status === "pending"), "Unresolved receipt. Keep staged recovery closed.");
  return receipts.filter(({ status }) => status !== "rejected");
}

let runtime;
let journal;
try {
  const modules = [{ type: "ESModule", path: join(server, "recovery-entry.mjs"), contents: script },
    ...(await readdir(server, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
      .map((entry) => ({ type: "ESModule", path: join(entry.parentPath, entry.name) }))];
  const a = fixture("a");
  const b = fixture("b");
  let ns;
  let origin;
  async function boot(path) {
    runtime = start(path, modules);
    ({ origin } = await runtime.ready);
    ns = await runtime.getDurableObjectNamespace("WORKSPACE");
  }

  const directory = () => ns.getByName("orbit-demo");
  async function request(tenant, action, input, actor = tenant.staff.officer, args = [input, tenant.id]) {
    const response = await runtime.dispatchFetch(`${origin}/workspace?brokerage=${tenant.id}`, {
      method: "POST", headers: { Origin: origin, "Next-Action": actions[action], Accept: "text/x-component",
        "Content-Type": "text/plain;charset=UTF-8", Cookie: `__Host-orbit-session=${actor.token}` },
      body: JSON.stringify(args),
    });
    if (response.status !== 200) return { status: response.status, body: await response.text() };
    return readActionResult(response, action);
  }
  async function write(tenant, input, actor) {
    const result = await request(tenant, "mutate", input, actor);
    assert.equal(result.error, undefined);
    assert.ok(result.message, `Write was not acknowledged for ${input.type}`);
    return result;
  }
  const migrationOrigin = `orbit-${randomUUID()}`;
  const migrationAt = new Date(Date.now() - 3_600_000).toISOString();
  const importedBorrower = { type: "Contact", externalId: "migration-contact", name: "Upgrade Fixture Borrower",
    email: "upgrade-borrower@example.test", phone: "", role: "Borrower" };
  const migratedLead = { ...importedBorrower, type: "Lead", externalId: "migration-lead", parentId: importedBorrower.externalId,
    ownerEmail: a.staff.officer.email, purpose: "Purchase", source: "Imported CRM", zip: "", createdAt: migrationAt, dueAt: "" };
  const importInput = (part, rows) => ({ type: "migratePipeline", origin: migrationOrigin,
    batch: { origin: migrationOrigin, snapshot: "a".repeat(64), part, partCount: 2 }, rows, decisions: {} });
  const firstImport = importInput(1, [importedBorrower, migratedLead, {
    type: "Task", externalId: "migration-task", parentId: migratedLead.externalId, dueAt: migrationAt,
    completedAt: "", text: "Verify imported borrower callback",
  }]);
  const secondImport = importInput(2, [{ ...importedBorrower, externalId: "second-contact",
    name: "Second Upgrade Fixture Borrower", email: "second-upgrade-borrower@example.test" }]);
  async function importBatch(input) {
    const preview = await request(a, "mutate", input, a.staff.admin);
    assert.ok(preview.migration, preview.error);
    const result = await request(a, "mutate", { ...input, preview: preview.migration.fingerprint }, a.staff.admin);
    assert.ok(result.migration, result.error);
    return result.migration;
  }
  const cutover = () => request(a, "readCutoverChecklist", migrationOrigin, a.staff.admin, [a.id, migrationOrigin]);
  const cutoverAction = (name, input, tenant = a, actor = tenant.staff.admin) => request(tenant, name, input, actor, [tenant.id, input]);
  const fileInventory = () => cutoverAction("readCutoverFileInventory", a.cutover);
  const cutoverReview = (input) => cutoverAction("saveCutoverReview", input);
  const cutoverDraft = async () => (await cutover()).evidence.drafts.find(({ id }) => id === a.cutover.loanId);
  const lenderReview = async () => (await cutoverDraft()).reviews.find(({ item }) => item === "lender");
  const cutoverLoan = (actor = a.staff.processor) => request(a, "readLoanForWork", a.cutover.loanId, actor);
  async function handoff() {
    const result = await cutoverAction("downloadCutoverHandoff", { origin: a.cutover.origin, basis: a.cutover.basis });
    assert.ok(result.html, result.error);
    const reference = /<dt>Review reference<\/dt><dd><code>([0-9A-F]{8}(?:-[0-9A-F]{8}){2})<\/code>/.exec(result.html)?.[1];
    assert.ok(reference, "The handoff must identify the exact reviewed state");
    assert.doesNotMatch(result.html, /CUTOVER-(?:PRIOR|CURRENT)-RECEIPT|CUTOVER-CLEARANCE|upgrade-borrower@example\.test/);
    return { reference, html: result.html };
  }
  async function replayReceipt({ input, proof }) {
    if (input.type === "saveClosingItem") return write(a, input);
    assert.equal(input.type, "saveCutoverReview");
    assert.ok(proof?.review.fileCurrent);
    const evidence = await fileInventory();
    assert.equal(evidence.lender.fingerprint, input.fileFingerprint, "The original lender evidence must match before recording a new review");
    const result = await cutoverReview(input);
    assert.ok(result.message, result.error);
    const { updatedAt, ...review } = await lenderReview();
    const { updatedAt: originalTime, ...original } = proof.review;
    assert.deepEqual(review, original);
    assert.ok(Date.parse(updatedAt) >= Date.parse(originalTime));
  }
  const imports = () => request(a, "readMigrationRecovery", undefined, a.staff.admin, [a.id]);
  const file = (tenant, actor) => request(tenant, "readLoanForWork", tenant.loan, actor);
  const title = (tenant, work) => work.closingItems.find(({ id }) => id === `${tenant.loan}:title`);
  const edit = (tenant, previous, next) => ({ type: "saveClosingItem", loanId: tenant.loan, itemId: previous.id,
    revision: previous.revision, title: next, owner: previous.owner, dueDate: previous.dueDate });
  const history = (tenant) => request(tenant, "readHistoryPage", { record: "loan", id: tenant.loan });
  const queue = (tenant) => request(tenant, "readMyTasksToday", { horizon: 7 });
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()).slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const through = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const funding = (tenant) => request(tenant, "readFundingDashboard", { from: `${month}-01`, through,
    owner: "", metric: "actual", period: "selected" }, tenant.staff.admin);
  async function portals(links) {
    return Promise.all([["demo-application", links.borrower], ["realtor-referrals", links.realtor.token]].map(async ([route, token]) => {
      const result = await runtime.dispatchFetch(`${origin}/api/${route}`, { method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ type: "read", token }) });
      await result.arrayBuffer();
      return result.status;
    }));
  }
  async function coPortal(token) {
    const result = await runtime.dispatchFetch(`${origin}/api/joint-application`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ type: "read", token }) });
    await result.arrayBuffer();
    return result.status;
  }
  async function borrowerAction(token, input) {
    const response = await runtime.dispatchFetch(`${origin}/api/demo-application`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ token, ...input }) });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    return result;
  }

  await boot(live);
  await directory().seedDirectory([a, b]);
  for (const tenant of [a, b]) {
    for (const { token, ...staff } of Object.values(tenant.staff)) {
      const now = Date.now();
      await directory().createStaffSession(createHash("sha256").update(token).digest("base64url"), staff, now + 3_600_000, now);
    }
    const loaded = await ns.getByName(tenant.id).loadPilot(tenant.staff.admin, {
      type: "loadPilotScenario", id: tenant.scenario, previousId: null, officerEmail: tenant.staff.officer.email, presenter: true,
    }, tenant.staff.officer);
    assert.ok(loaded.message, loaded.error);
  }
  const assigned = await ns.getByName(a.id).shareProcessing(a.staff.admin, { loanId: a.loan, revision: 0,
    member: { email: a.staff.processor.email, name: a.staff.processor.name, role: "Processor", status: "Active" } });
  assert.ok(assigned.message, assigned.error);
  const original = await file(a);
  const insurance = original.documentRequests.find(({ kind }) => kind === "Homeowners insurance");
  const due = new Date(Date.parse(insurance.dueOn) + 86_400_000).toISOString().slice(0, 10);
  await write(a, { type: "setDocumentDeadline", loanId: a.loan, requestId: insurance.id,
    revision: insurance.revision, deadlineRevision: insurance.deadlineRevision, dueOn: due });
  await write(a, { type: "startApplication", loanId: a.loan });
  await write(b, { type: "startApplication", loanId: b.loan });
  const resetLoan = await ns.getByName(a.id).scenarioLoan();
  await write(a, { type: "startApplication", loanId: resetLoan });
  const fixtureLinks = await ns.getByName(a.id).linkFixture(a.loan);
  const links = { borrower: fixtureLinks.borrower, realtor: { token: fixtureLinks.realtor.token, realtorId: fixtureLinks.realtor.realtorId } };
  const fixtureLinksB = await ns.getByName(b.id).linkFixture(b.loan);
  const otherLinks = { borrower: fixtureLinksB.borrower, realtor: { token: fixtureLinksB.realtor.token } };
  const resetBorrower = (await ns.getByName(a.id).linkFixture(resetLoan)).borrower;
  const jointDraft = (await request(a, "readLoanForWork", resetLoan)).applications[0];
  await write(a, { type: "enableJointApplication", loanId: resetLoan, revision: jointDraft.revision });
  const retiredCo = (await request(a, "readLoanForWork", resetLoan)).applications[0].joint.token;
  assert.equal(await coPortal(retiredCo), 200);
  assert.deepEqual(await portals(links), [200, 200]);
  assert.deepEqual(await portals(otherLinks), [200, 200]);
  journal = openJournal();
  const checkpointEdit = { type: "saveClosingItem", loanId: a.loan, itemId: randomUUID(), revision: 0,
    title: "Confirm the fictional wire checklist", owner: "Loan officer", dueDate: due };
  const checkpoint = recordIntent(journal, a, checkpointEdit);
  await write(a, checkpointEdit);
  settleReceipt(journal, a, checkpoint, "acknowledged");
  const firstBatch = await importBatch(firstImport);
  assert.equal(firstBatch.batch.nextPart, 2);
  const { applicationLoanId } = await write(a, { type: "importMismo", requestId: randomUUID(), fictional: true, extraBorrowers: 0,
    existingContactId: firstBatch.rows.find(({ key }) => key === "Contact:migration-contact").targetId,
    fields: { firstName: "Upgrade Fixture", lastName: "Borrower", amount: "275000", purpose: "Purchase", occupancy: "Primary residence",
      street: "16 Fictional Way", unit: "", city: "Troy", state: "MI", zip: "48084" } }, a.staff.admin);
  a.cutover = { loanId: applicationLoanId, origin: migrationOrigin, basis: firstImport.batch.snapshot };
  const target = { loanId: applicationLoanId };
  const adminWrite = (input) => write(a, { ...input, ...target }, a.staff.admin);
  const processorWrite = (input) => write(a, { ...input, ...target }, a.staff.processor);
  const shared = await ns.getByName(a.id).shareProcessing(a.staff.admin, { ...target, revision: 0,
    member: { email: a.staff.processor.email, name: a.staff.processor.name, role: "Processor", status: "Active" } });
  assert.ok(shared.message, shared.error);
  const lender = { lender: "Fictional Wholesale", reference: "RECOVERY-CUTOVER-01", status: "In underwriting" };
  await adminWrite({ type: "submission", lender: lender.lender, externalId: lender.reference, status: lender.status });
  const submissionId = (await cutoverLoan()).submissions[0].id;
  const conditionId = randomUUID();
  const description = "Review the fictional recovery income document.";
  await processorWrite({ type: "saveManualCondition", submissionId, conditionId, revision: 0,
    category: "Income", description, owner: a.staff.processor.name });
  await processorWrite({ type: "requestDocument", kind: "Pay stub", instructions: description, condition: { submissionId, conditionId } });
  const token = (await cutoverLoan(a.staff.admin)).applications[0].token;
  const initial = await borrowerAction(token, { type: "read" });
  const application = await borrowerAction(token, { type: "submit", revision: initial.revision, step: applicationSteps.length - 1,
    draft: { ...sampleApplication(initial.draft), confirmedDemo: true } });
  assert.ok(application.submittedAt, application.error);
  const replacement = await recordFictionalReplacement({ read: cutoverLoan, write: processorWrite,
    borrower: (input) => borrowerAction(token, input), submissionId, conditionId });
  const sourceInventory = { version: 1, documents: [replacement.document], lenderFiles: [{ ...lender, conditions: [replacement.condition] }] };
  assert.ok((await cutoverAction("saveCutoverFileInventory", { ...a.cutover, revision: 0, fictional: true, source: sourceInventory })).message);
  const beforeInventory = await fileInventory();
  assert.ok(beforeInventory.documents.rows.every(({ status }) => status === "Matched"));
  assert.ok(beforeInventory.lender.rows.every(({ status }) => status === "Matched"));
  const signoff = (item, revision, note) => ({ ...a.cutover, item, revision, decision: "Reconciled", note, fileFingerprint: beforeInventory[item].fingerprint });
  for (const item of ["documents", "lender"]) {
    const saved = await cutoverReview(signoff(item, 0, "Compared the accepted fictional revisions and the lender receipts."));
    assert.ok(saved.message, saved.error);
  }
  const beforeCutover = (await cutover()).evidence;
  assert.equal(beforeCutover.batch.received, 1);
  assert.equal(beforeCutover.links, 3);
  const beforeDraft = await cutoverDraft();
  assert.ok(beforeDraft.reviews.every(({ fileCurrent }) => fileCurrent === true));
  const beforeHandoff = await handoff();
  assert.match(beforeHandoff.html, /Borrower documents<\/th>\s*<td><strong>Reconciled/);
  assert.match(beforeHandoff.html, /Lender status and conditions<\/th>\s*<td><strong>Reconciled/);
  const beforeImports = (await imports()).imports;
  assert.equal(beforeImports.length, 1);
  const before = await file(a);
  assert.equal(before.documentRequests.find(({ id }) => id === insurance.id).dueOn, due);
  const beforeHistory = await history(a);
  assert.match(JSON.stringify(beforeHistory), /Document due date set/);
  const beforeQueue = await queue(a);
  assert.ok(beforeQueue.items.some(({ title }) => title === "Confirm the sample title package"));
  assert.ok(beforeQueue.items.some(({ title, dueAt }) => title === "Verify imported borrower callback" && dueAt === migrationAt));
  const beforeFunding = (await funding(a)).periods.selected;
  assert.deepEqual(beforeFunding.actual, { count: 1, volume: 310_000 });
  assert.deepEqual(beforeFunding.projected, { count: 1, volume: 340_000 });
  assert.match((await file(a, a.staff.backup)).error, /unavailable/i);
  const objectFile = ns.idFromName(a.id).toString() + ".sqlite";
  await runtime.dispose();
  runtime = undefined;

  const backupStarted = performance.now();
  const livePath = await realpath(live);
  inside(root, livePath);
  const matches = (await readdir(livePath, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name === objectFile);
  assert.equal(matches.length, 1, "Expected exactly one SQLite store for the fixture");
  const source = await realpath(join(matches[0].parentPath, objectFile));
  const objectPath = inside(livePath, source);
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, snapshot); }
  finally { db.close(); }
  checkSnapshot(snapshot, a.scenario);
  assert.throws(() => checkSnapshot(snapshot, b.scenario), /different scenario/);
  const backupMs = Math.round(performance.now() - backupStarted);

  await boot(live);
  const receipt = edit(a, title(a, before), "Post-backup signing confirmation");
  const interrupted = edit(a, before.closingItems.find(({ id }) => id === checkpointEdit.itemId), "Review the fictional wire checklist");
  const otherWrite = edit(b, title(b, await file(b)), "Other brokerage kept working");
  const revocations = [{ type: "revokeApplication", loanId: a.loan, token: links.borrower },
    { type: "revokeRealtorPortal", realtorId: links.realtor.realtorId },
    { type: "revokeJointLink", loanId: resetLoan, token: retiredCo }];
  const rejected = { ...receipt, revision: receipt.revision + 5, title: "Conflicting fixture edit" };
  const rejectedSequence = recordIntent(journal, a, rejected);
  assert.match((await request(a, "mutate", rejected)).error, /closing item changed/i);
  settleReceipt(journal, a, rejectedSequence, "rejected");
  const receiptSequence = recordIntent(journal, a, receipt);
  await write(a, receipt);
  settleReceipt(journal, a, receiptSequence, "acknowledged");
  const laterSignoff = { ...signoff("lender", 1, "Owner rechecked both fictional receipts after the snapshot."), type: "saveCutoverReview" };
  const laterSequence = recordIntent(journal, a, laterSignoff);
  assert.ok((await cutoverReview(laterSignoff)).message);
  const laterHandoff = await handoff();
  assert.notEqual(laterHandoff.reference, beforeHandoff.reference);
  settleReceipt(journal, a, laterSequence, "acknowledged", { review: await lenderReview(), reference: laterHandoff.reference });
  recordIntent(journal, a, interrupted);
  await write(a, interrupted);
  // Simulate a crash after the app commits but before the caller settles the receipt.
  journal.close();
  journal = undefined;
  await runtime.dispose();
  runtime = undefined;
  journal = openJournal();
  assert.throws(() => replayableReceipts(journal, a, checkpoint), /unresolved receipt/i);
  await boot(live);
  const [pending] = readReceipts(journal, a, checkpoint).filter(({ status }) => status === "pending");
  const observed = (await file(a)).closingItems.find(({ id }) => id === pending.input.itemId);
  assert.deepEqual(
    { title: observed.title, owner: observed.owner, dueDate: observed.dueDate, revision: observed.revision },
    { title: pending.input.title, owner: pending.input.owner, dueDate: pending.input.dueDate, revision: pending.input.revision + 1 },
  );
  settleReceipt(journal, a, pending.sequence, "reconciled");
  assert.match((await request(a, "mutate", revocations[0], a.staff.backup)).error, /access/i);
  assert.match((await request(a, "mutate", revocations[1])).error, /access/i);
  assert.equal(await directory().revocationCount(a.id), 0);
  await write(a, revocations[0], a.staff.admin);
  await write(a, revocations[2], a.staff.admin);
  await write(a, { type: "replaceJointLink", loanId: resetLoan, token: retiredCo }, a.staff.admin);
  const resetCo = (await request(a, "readLoanForWork", resetLoan)).applications[0].joint.token;
  assert.equal(await coPortal(retiredCo), 404);
  assert.equal(await coPortal(resetCo), 200);
  await write(a, { type: "createRealtorPortal", realtorId: links.realtor.realtorId }, a.staff.admin);
  const replacementRealtor = (await ns.getByName(a.id).linkFixture(resetLoan)).realtor.token;
  const resetLinks = { borrower: resetBorrower, realtor: { token: replacementRealtor } };
  assert.equal(await directory().revocationCount(a.id), 3);
  assert.deepEqual(await portals(links), [404, 404]);
  assert.deepEqual(await portals(resetLinks), [200, 200]);
  const otherSequence = recordIntent(journal, b, otherWrite);
  await write(b, otherWrite);
  settleReceipt(journal, b, otherSequence, "acknowledged");
  const removed = await directory().manage(a.staff.admin, [bootstrap], { type: "revoke", email: a.staff.backup.email });
  assert.ok(removed.message, removed.error);
  assert.equal((await file(a, a.staff.backup)).status, 401);
  assert.equal(title(a, await file(a)).title, receipt.title);
  await ns.getByName(a.id).loseFixtureFile(a.scenario, a.loan);
  assert.match((await file(a)).error, /unavailable/i);
  await write(a, { type: "loadGuidedDemo", id: randomUUID(), previousId: a.scenario }, a.staff.admin);
  assert.deepEqual(await portals(resetLinks), [404, 404]);
  assert.equal(await coPortal(resetCo), 404);
  assert.equal(await directory().revocationCount(a.id), 6);
  await runtime.dispose();
  runtime = undefined;
  journal.close();
  journal = undefined;

  const restoreStarted = performance.now();
  await cp(livePath, staged, { recursive: true, force: false, errorOnExist: true });
  const stagePath = await realpath(staged);
  inside(root, stagePath);
  const destination = await realpath(join(stagePath, objectPath));
  inside(stagePath, destination);
  for (const suffix of ["-wal", "-shm"]) await rm(destination + suffix, { force: true });
  await copyFile(snapshot, destination);
  checkSnapshot(destination, a.scenario);
  const legacyId = stageInterruptedUpgrade(destination, a.loan, insurance.id);
  await boot(staged);
  await assert.rejects(async () => { await ns.getByName(a.id).scenarioLoan(); }, /Fictional upgrade interrupted/i);
  assert.equal(title(b, await file(b)).title, otherWrite.title);
  await runtime.dispose();
  runtime = undefined;
  clearUpgradeFault(destination, a.loan, legacyId);
  await boot(staged);

  // The restored tenant holds the old links. The public API checks the current directory first.
  const restoredWorkspace = ns.getByName(a.id);
  assert.ok((await restoredWorkspace.borrower({ type: "read", token: links.borrower }, true)).application);
  assert.ok((await restoredWorkspace.realtor({ type: "read", token: links.realtor.token }, true)).value);
  assert.ok((await restoredWorkspace.borrower({ type: "read", token: resetBorrower }, true)).application);
  assert.ok((await restoredWorkspace.coBorrower({ type: "read", token: retiredCo }, true)).value);
  assert.equal(await coPortal(retiredCo), 404);
  assert.equal(await coPortal(resetCo), 404);
  assert.deepEqual(await portals(links), [404, 404]);
  assert.deepEqual(await portals(resetLinks), [404, 404]);
  assert.deepEqual(await portals(otherLinks), [200, 200]);
  for (const revocation of revocations) await write(a, revocation, a.staff.admin);
  assert.equal(await directory().revocationCount(a.id), 6);
  assert.deepEqual(await portals(links), [404, 404]);
  assert.equal((await file(a, a.staff.backup)).status, 401);
  assert.equal((await file(a, b.staff.officer)).status, 403);
  assert.match((await request(b, "readLoanForWork", a.loan)).error, /unavailable/i);
  assert.deepEqual((await file(a, a.staff.processor)).loans.map(({ id }) => id), [a.loan]);
  const restored = await file(a);
  assert.deepEqual(title(a, restored), title(a, before));
  const repairedInsurance = restored.documentRequests.find(({ kind }) => kind === "Homeowners insurance");
  assert.match(repairedInsurance.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(repairedInsurance.id, insurance.id);
  assert.equal(repairedInsurance.dueOn, due);
  assert.equal(await restoredWorkspace.fileMetadata(repairedInsurance.id), "fixture-insurance-metadata");
  assert.ok(beforeHistory.events.every(({ id }) => id), "History events need stable IDs");
  const restoredHistory = await history(a);
  assert.ok(beforeHistory.events.every(({ id }) => restoredHistory.events.some((event) => event.id === id)));
  const repairedQueue = beforeQueue.items.map((item) => item.id === insurance.id
    ? { ...item, id: repairedInsurance.id, target: `document-${repairedInsurance.id}` } : item);
  assert.deepEqual((await queue(a)).items, repairedQueue);
  assert.deepEqual((await funding(a)).periods.selected, beforeFunding);
  assert.deepEqual((await cutover()).evidence, beforeCutover);
  assert.deepEqual(await cutoverDraft(), beforeDraft);
  assert.deepEqual(await fileInventory(), beforeInventory);
  assert.equal((await handoff()).reference, beforeHandoff.reference);
  assert.equal((await cutoverLoan()).submissions[0].conditions[0].satisfiedAt, replacement.condition.evidence.clearance.at);
  assert.match((await cutoverAction("readCutoverFileInventory", a.cutover, a, a.staff.processor)).error, /unavailable/i);
  assert.ok((await cutoverAction("readCutoverFileInventory", a.cutover, b)).error);
  const staleReview = await cutoverReview({ ...laterSignoff, fileFingerprint: "0".repeat(64) });
  assert.match(staleReview.error, /comparison changed/i);
  assert.equal((await handoff()).reference, beforeHandoff.reference);
  assert.deepEqual((await imports()).imports, beforeImports);
  assert.equal((await importBatch(firstImport)).batch.nextPart, 2);
  assert.deepEqual((await imports()).imports, beforeImports);
  assert.equal((await importBatch(secondImport)).batch.nextPart, null);
  assert.equal((await cutover()).evidence.batch.received, 2);
  assert.equal((await cutover()).evidence.links, 4);
  assert.equal(title(b, await file(b)).title, otherWrite.title);
  journal = openJournal();
  const replay = replayableReceipts(journal, a, checkpoint);
  assert.equal(replay.length, 3);
  assert.equal(replay.find(({ input }) => input.type === "saveCutoverReview").proof.reference, laterHandoff.reference);
  for (const entry of replay) await replayReceipt(entry);
  const signedAfterRestore = await lenderReview();
  const handoffAfterRestore = await handoff();
  await runtime.dispose();
  runtime = undefined;
  journal.close();
  journal = undefined;
  await boot(staged);
  journal = openJournal();
  for (const entry of replayableReceipts(journal, a, checkpoint)) await replayReceipt(entry);
  const after = await file(a);
  const afterHistory = await history(a);
  for (const { input } of replay.filter(({ input }) => input.type === "saveClosingItem")) {
    const item = after.closingItems.find(({ id }) => id === input.itemId);
    assert.equal(item.revision, input.revision + 1);
    assert.equal(item.title, input.title);
    assert.equal(afterHistory.events.filter((event) => JSON.stringify(event).includes(input.title)).length, 1);
  }
  assert.deepEqual(await lenderReview(), signedAfterRestore);
  assert.equal((await handoff()).reference, handoffAfterRestore.reference);
  const clearedCondition = (await cutoverLoan()).submissions[0].conditions[0];
  await processorWrite({ type: "recordManualClearance", submissionId, conditionId, revision: clearedCondition.manual.revision,
    cleared: false, confirmation: "Fictional lender reopened the condition." });
  assert.equal((await lenderReview()).fileCurrent, false);
  assert.notEqual((await handoff()).reference, handoffAfterRestore.reference);
  await assert.rejects(() => replayReceipt(replay.find(({ input }) => input.type === "saveCutoverReview")), /evidence must match/i);
  assert.equal(title(b, await file(b)).title, otherWrite.title);
  assert.equal(afterHistory.events.some((event) => JSON.stringify(event).includes(rejected.title)), false);
  console.log(JSON.stringify({ snapshotBytes: (await stat(snapshot)).size, backupMs, restoreAndVerifyMs: Math.round(performance.now() - restoreStarted),
    restored: ["loan", "document deadline", "open work", "history", "funding totals", "processor access", "accepted revisions", "lender receipts", "cutover sign-offs", "handoff review reference"],
    preserved: ["other brokerage write", "staff revocation", "explicit revocation, link replacement, and reset retirement"],
    schemaUpgrade: "Interrupted a populated SQLite migration, verified rollback, restarted, and resumed a two-part CRM import",
    rollForward: "Restarted from disk, replayed two verified edits exactly once, re-reviewed matching lender evidence, and blocked a review after the condition reopened" }, null, 2));
} finally {
  try { await runtime?.dispose(); }
  finally {
    journal?.close();
    const target = await realpath(root);
    assert.equal(dirname(target), tempRoot, "Fixture storage must stay in the temporary directory");
    assert.ok(target.startsWith(join(tempRoot, "orbit-recovery-")));
    await rm(target, { recursive: true, force: true });
  }
}

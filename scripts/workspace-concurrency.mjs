import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { profiles, seedFictionalWorkspace } from "./workspace-baseline.mjs";

const { blankApplication } = await import("../src/lib/application-model.ts");
const { Miniflare, convertV4MiniflareOptions } = createRequire(import.meta.resolve("wrangler"))("miniflare");
const server = fileURLToPath(new URL("../dist/server/", import.meta.url));
const config = createRequire(import.meta.url)(join(server, "wrangler.json"));
const { default: actionManifest } = await import("../dist/server/__vinext_action_owner_manifest.js");
const actions = Object.fromEntries(Object.keys(actionManifest).map((reference) => [reference.split("#").at(-1), reference]));
const directoryName = "orbit-demo";
const writesOnly = process.argv.includes("--writes");
const entryBefore = process.argv.includes("--entry-before");
const pipelineOnly = process.argv.includes("--pipeline");
const pickerOnly = process.argv.includes("--loan-pickers");
const contactsOnly = process.argv.includes("--contacts");
const inboxOnly = process.argv.includes("--inbox");
const tasksOnly = process.argv.includes("--tasks");
const draftsOnly = process.argv.includes("--drafts");
const entryOnly = entryBefore || pipelineOnly || pickerOnly || contactsOnly || inboxOnly || tasksOnly || draftsOnly || process.argv.includes("--entry");
const portalTraffic = process.argv.includes("--portals");
const sustained = portalTraffic || process.argv.includes("--sustained");
const mixed = sustained || process.argv.includes("--mixed");
const bootstrap = "benchmark-bootstrap@example.test";
const dueAt = "2020-01-01T12:00:00.000Z";
const calendarWeek = "2026-11-09";
const editLoanId = "loan-000002";
const closingItemId = "fixture-closing-item";
const threadId = (loanNumber) => `00000000-0000-4000-8000-${String(loanNumber).padStart(12, "0")}`;
const tempRoot = await realpath(tmpdir());
const persistence = await mkdtemp(join(tempRoot, "orbit-concurrency-"));

// This wrapper exists only in the local Miniflare process. It seeds synthetic data
// through the test harness and delegates every HTTP request to the real Worker.
const script = `
import worker, { OrbitWorkspace } from "./index.js";
export default worker;
${seedFictionalWorkspace.toString()}
const threadId = ${threadId.toString()};
export class BenchmarkWorkspace extends OrbitWorkspace {
  counts = { session: 0, directory: 0, combined: 0, portal: 0 };
  getStaffSession(...args) { this.counts.session++; return super.getStaffSession(...args); }
  staffBrokerages(...args) { this.counts.directory++; return super.staffBrokerages(...args); }
  staffSessionAccess(...args) { this.counts.combined++; return super.staffSessionAccess(...args); }
  brokerageForPortal(...args) { this.counts.portal++; return super.brokerageForPortal(...args); }
  requestCounts() { return { ...this.counts }; }
  seedDirectory(tenants) {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      for (const { id, name, officer, backup, admin, processor } of tenants) {
        sql.exec("INSERT INTO brokerages (id, name, pilot) VALUES (?, ?, 1)", id, name);
        for (const staff of [officer, backup, admin, processor]) {
          sql.exec("INSERT INTO brokerage_members (brokerageId, email, name, role, status) VALUES (?, ?, ?, ?, 'Active')",
            id, staff.email, staff.name, staff.role);
        }
        if (${mixed}) sql.exec("INSERT INTO brokerage_access_history VALUES (?, ?, ?, 'Created pilot workspace', ?, '2026-11-08T12:00:00.000Z')",
          id, id, admin.email, name);
      }
    });
  }
  seedTenant(profile, tenant) {
    const storage = this.ctx.storage;
    const sql = storage.sql;
    seedFictionalWorkspace({ transaction: (run) => storage.transactionSync(run),
      prepare: (query) => ({ run: (...args) => sql.exec(query, ...args) }) }, profile, tenant.officer.email, tenant.backup.email);
    storage.transactionSync(() => {
      sql.exec("UPDATE contacts SET name = ? WHERE id = 'contact-000002'", tenant.marker);
      sql.exec("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, 'loan-000002', 'Verify the borrower callback', ?)", tenant.marker, ${JSON.stringify(dueAt)});
    });
  }
  seedDenseOtherOwnerTasks() {
    this.ctx.storage.sql.exec("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 50000) " +
      "INSERT INTO tasks (id, loanId, title, dueAt) " +
      "SELECT printf('heavy-task-%06d', n), printf('loan-%06d', (n % 5000) * 2 + 1), 'Fictional other-owner task', '2026-11-06T17:00:00.000Z' FROM seq");
  }
  seedTaskPages() {
    const sql = this.ctx.storage.sql;
    sql.exec("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 55) " +
      "INSERT INTO tasks (id, loanId, title, dueAt, purpose) SELECT printf('paged-task-%02d', n), 'loan-000002', " +
      "printf('Fictional service task %02d', n), '2026-11-08T17:00:00.000Z', 'Loan service' FROM seq");
    sql.exec("INSERT INTO tasks (id, loanId, title, dueAt, completedAt, purpose) SELECT 'done-' || id, loanId, title, dueAt, dueAt, purpose " +
      "FROM tasks WHERE id GLOB 'paged-task-*'");
  }
  seedDrafts() {
    const sql = this.ctx.storage.sql;
    sql.exec("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 50000) " +
      "INSERT INTO communication_drafts (id, loanId, contactId, audience, milestone, createdAt, eventKey) " +
      "SELECT printf('private-draft-%06d', n), loan.id, loan.contactId, 'Borrower', 'Application received', " +
      "'2026-11-09T15:00:00.000Z', printf('event-%06d', n) FROM seq " +
      "JOIN loans loan ON loan.id = printf('loan-%06d', (n % 5000) * 2 + 1)");
    sql.exec("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 45) " +
      "INSERT INTO communication_drafts (id, loanId, contactId, audience, milestone, createdAt, eventKey) " +
      "SELECT printf('00000000-0000-4000-9000-%012d', n), 'loan-000002', 'contact-000002', 'Borrower', 'Application received', " +
      "'2026-11-08T15:00:00.000Z', printf('event-%06d', n) FROM seq");
  }
  seedInbox(tenant) {
    const sql = this.ctx.storage.sql;
    sql.exec("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 10000) " +
      "INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt) " +
      "SELECT printf('00000000-0000-4000-9000-%012d', n), printf('fixture-inbox-%05d', n), printf('Fictional inbox lead %05d', n), '', '', " +
      "'Purchase', CASE n % 3 WHEN 0 THEN '' WHEN 1 THEN ? ELSE ? END, CASE n % 3 WHEN 0 THEN NULL WHEN 1 THEN ? ELSE ? END, " +
      "'2026-11-08T12:00:00.000Z', '2020-01-01T12:00:00.000Z' FROM seq", tenant.officer.name, tenant.backup.name, tenant.officer.email, tenant.backup.email);
  }
  revokeFixture(id, email) {
    this.ctx.storage.sql.exec("UPDATE brokerage_members SET status = 'Revoked', accessRevision = accessRevision + 1 WHERE brokerageId = ? AND email = ?", id, email);
  }
  seedSharedEditFile(tenant) {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec("INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision) VALUES ('loan-000002', ?, ?, 'In processing', '', '2026-11-08T12:00:00.000Z', 1)",
        tenant.processor.email, tenant.processor.name);
      sql.exec("INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES ('fixture-closing-item', 'loan-000002', 'Confirm signing', 'Loan officer', '2026-11-10')");
      sql.exec("INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, status, submittedAt, revision) VALUES (?, 'loan-000002', 'Pay stub', '', '2026-11-08T12:00:00.000Z', 'Received', '2026-11-08T12:00:00.000Z', 1)", tenant.documentId);
    });
  }
  seedMixedWork(tenant) {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec("UPDATE contacts SET name = ? WHERE id = 'contact-000003'", tenant.backupMarker);
      sql.exec("INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision) VALUES ('loan-000003', ?, ?, 'In processing', '', '2026-11-08T12:00:00.000Z', 1)",
        tenant.processor.email, tenant.processor.name);
      sql.exec("INSERT INTO tasks (id, loanId, title, dueAt) VALUES ('fixture-calendar-officer', 'loan-000002', 'Fictional loan review', '2026-11-09T05:00:00.000Z'), " +
        "('fixture-calendar-backup', 'loan-000003', 'Fictional borrower callback', '2026-11-09T05:00:00.000Z')");
      sql.exec("INSERT INTO loan_conversations (id, loanId, contactId, audience, ownerRole, status, unread, updatedAt) " +
        "SELECT printf('00000000-0000-4000-8000-%012d', CAST(substr(id, 6) AS INTEGER)), id, contactId, 'Borrower', 'Loan officer', 'Open', 0, '2026-11-08T11:00:00.000Z' " +
        "FROM loans WHERE id NOT IN ('loan-000002','loan-000003','loan-000007')");
      for (const [loan, role] of [[2, 'Loan officer'], [3, 'Processor'], [7, 'Loan officer']]) {
        const loanId = 'loan-' + String(loan).padStart(6, '0');
        sql.exec("INSERT INTO loan_conversations (id, loanId, contactId, audience, ownerRole, status, unread, updatedAt) " +
          "SELECT ?, id, contactId, 'Borrower', ?, 'Needs reply', 1, '2026-11-08T12:00:00.000Z' FROM loans WHERE id = ?", threadId(loan), role, loanId);
      }
      sql.exec("INSERT INTO closing_progress (loanId, fundingDate, fundingCycle) " +
        "SELECT id, '2026-11-10', 1 FROM loans WHERE stage = 'Funded'");
      sql.exec("INSERT INTO loan_financials (loanId, cycle, fundingDate, expectedCents, receiptsCents, revision) " +
        "SELECT loanId, fundingCycle, fundingDate, 720000, 600000, 1 FROM closing_progress WHERE fundingDate IS NOT NULL");
    });
  }
  seedPortals(tenant, draft, expiresAt) {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec("INSERT INTO contacts (id, name, email, phone, role) VALUES ('fixture-realtor', ?, '', '', 'Realtor'), " +
        "('other-realtor', 'Other fictional realtor', '', '', 'Realtor')", tenant.realtorName);
      sql.exec("UPDATE loans SET partnerId = CASE WHEN id = 'loan-000003' THEN 'other-realtor' ELSE 'fixture-realtor' END");
      sql.exec("UPDATE loans SET stageSince = '2026-11-09T12:00:00.000Z' WHERE id = 'loan-000002'");
      sql.exec("INSERT INTO realtor_portals (realtorId, token, expiresAt) VALUES ('fixture-realtor', ?, ?)", tenant.realtorToken, expiresAt);
      sql.exec("INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt, reviewedAt) " +
        "VALUES ('loan-000002', ?, ?, ?, '2026-11-09T12:00:00.000Z', '2026-11-09T12:00:00.000Z', '2026-11-09T12:00:00.000Z')",
        tenant.borrowerToken, expiresAt, draft);
      sql.exec("UPDATE document_requests SET status = 'Requested', submittedAt = NULL, revision = 0 WHERE id = ?", tenant.documentId);
    });
  }
}`;
const modules = [{ type: "ESModule", path: join(server, "benchmark-entry.mjs"), contents: script },
  ...(await readdir(server, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
    .map((entry) => ({ type: "ESModule", path: join(entry.parentPath, entry.name) }))];

function start() {
  return new Miniflare({ ...convertV4MiniflareOptions({
    name: "orbit-concurrency", host: "127.0.0.1",
    modules, modulesRoot: server,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    bindings: { ...config.vars, ORBIT_AUTH_MODE: "google", GOOGLE_CLIENT_ID: "local-fixture", GOOGLE_CLIENT_SECRET: "local-fixture", ORBIT_STAFF_EMAILS: bootstrap },
    serviceBindings: { ASSETS: () => new Response(null, { status: 404 }) },
    r2Buckets: { DOCUMENTS: "concurrency-fictional-documents" },
    durableObjects: { WORKSPACE: { className: "BenchmarkWorkspace", useSQLite: true } },
    resourcePersistencePath: persistence,
  }), telemetry: { enabled: false } });
}

function tenant(index) {
  const actor = (kind, role) => ({ name: `Fixture ${kind} ${index}`, email: `${kind}-${index}@example.test`, role,
    token: randomBytes(32).toString("base64url") });
  const id = randomUUID();
  const portalToken = () => `${id}.${randomBytes(32).toString("hex")}`;
  return { id, name: `Fixture brokerage ${index}`, marker: `Fixture ${index} scoped borrower`,
    backupMarker: `Fixture ${index} restricted borrower`,
    realtorName: `Fixture realtor ${index}`, realtorToken: portalToken(), borrowerToken: portalToken(),
    profile: index === 0 ? "heavy" : "small", officer: actor("officer", "LO"), backup: actor("backup", "LO"), admin: actor("admin", "Admin"),
    processor: actor("processor", "Processor"), documentId: randomUUID() };
}

function describe(samples) {
  const sorted = samples.map(({ ms }) => ms).sort((a, b) => a - b);
  const percentile = (p) => Number(sorted[Math.ceil(p * sorted.length) - 1].toFixed(1));
  return { requests: samples.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99),
    maxBytes: Math.max(...samples.map(({ bytes }) => bytes)) };
}

let mf;
try {
  mf = start();
  const tenants = Array.from({ length: 4 }, (_, index) => tenant(index));
  let ns = await mf.getDurableObjectNamespace("WORKSPACE");
  let directory = ns.getByName(directoryName);
  await directory.seedDirectory(tenants);
  const now = Date.now();
  for (const data of tenants) {
    await ns.getByName(data.id).seedTenant(profiles[data.profile], data);
    if (entryOnly || writesOnly || mixed) await ns.getByName(data.id).seedSharedEditFile(data);
    if (mixed) await ns.getByName(data.id).seedMixedWork(data);
    if (portalTraffic) {
      const draft = JSON.stringify({ ...blankApplication(), borrowerName: data.marker, email: "borrower-private@example.test" });
      await ns.getByName(data.id).seedPortals(data, draft, new Date(now + 3_600_000).toISOString());
    }
    for (const staff of [data.officer, data.backup, data.admin, data.processor]) {
      await directory.createStaffSession(createHash("sha256").update(staff.token).digest("base64url"), staff, now + 3_600_000, now);
    }
  }
  await mf.dispose();
  mf = start();
  ns = await mf.getDurableObjectNamespace("WORKSPACE");
  directory = ns.getByName(directoryName);
  const firstOfficer = tenants[0].officer;
  const restoredSession = await directory.getStaffSession(createHash("sha256").update(firstOfficer.token).digest("base64url"), Date.now());
  assert.equal(restoredSession?.email, firstOfficer.email, "Seeded session must survive the local runtime restart");
  const { origin } = await mf.ready;

  async function request(data, action, args, actor = data.officer, target = data.id, extra = {}) {
    const started = performance.now();
    const response = await mf.dispatchFetch(`${origin}/workspace?brokerage=${target}`, {
      method: "POST", headers: { Origin: origin, "Next-Action": actions[action], Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8",
        ...(actor ? { Cookie: `__Host-orbit-session=${actor.token}` } : {}), ...extra }, body: JSON.stringify(args),
    });
    const body = await response.text();
    return { status: response.status, body, ms: performance.now() - started, bytes: Buffer.byteLength(body) };
  }

  async function portalRequest(path, input, expectedStatus = 200) {
    const started = performance.now();
    const response = await mf.dispatchFetch(`${origin}/api/${path}`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const body = await response.text();
    const result = JSON.parse(body);
    assert.equal(response.status, expectedStatus, result.error ?? path);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return { result, ms: performance.now() - started, bytes: Buffer.byteLength(body) };
  }

  const names = ["readMyTasksToday", "readLoanForWork"];
  function actionResult(result) {
    assert.equal(result.status, 200, "Server action HTTP status");
    const { returnValue } = JSON.parse(result.body.split("\n").find((line) => line.startsWith("0:")).slice(2));
    assert.equal(returnValue.ok, true);
    return returnValue.data;
  }

  async function rehearseEdits(data) {
    const loanId = "loan-000002";
    const itemId = "fixture-closing-item";
    const readFile = async (actor) => actionResult(await request(data, names[1], [loanId, data.id], actor));
    const write = async (input, actor) => {
      const result = await request(data, "mutate", [{ loanId, ...input }, data.id], actor);
      return { ...result, data: actionResult(result) };
    };
    const edit = (revision, title) => ({ type: "saveClosingItem", itemId, revision, title, owner: "Loan officer", dueDate: "2026-11-11" });
    const item = (file) => file.closingItems.find(({ id }) => id === itemId);
    const successful = (result) => {
      assert.ok(!result.data.error, result.data.error);
      if (result.data.loanWork) assert.deepEqual(result.data.loanWork.loans.map(({ id }) => id), [loanId]);
      else assert.ok(result.data.state);
    };
    const timings = { officer: [], processor: [] };
    let current = item(await readFile(data.officer));
    for (let i = 0; i < 3; i++) {
      for (const [key, samples] of Object.entries(timings)) {
        const result = await write(edit(current.revision, "Updated by " + key + " " + i), data[key]);
        successful(result);
        samples.push(result);
        current = item(await readFile(data[key]));
      }
    }
    const revision = current.revision;
    const inputs = [[edit(revision, "Officer closing plan"), data.officer], [edit(revision, "Processor closing plan"), data.processor]];
    const contenders = await Promise.all(inputs.map(([input, actor]) => write(input, actor)));
    const saved = contenders.find((entry) => !entry.data.error);
    const rejected = contenders.find((entry) => entry.data.error);
    assert.ok(saved && rejected, "Exactly one concurrent edit must succeed");
    successful(saved);
    assert.match(rejected.data.error, /closing item changed/i);
    current = item(await readFile(data.officer));
    assert.equal(current.revision, revision + 1);
    const replay = await write(...inputs[contenders.indexOf(saved)]);
    successful(replay);
    assert.equal(item(await readFile(data.officer)).revision, revision + 1);
    const [independentEdit, reviewed] = await Promise.all([
      write(edit(current.revision, "Confirm signing after review"), data.officer),
      write({ type: "reviewDocument", requestId: data.documentId, revision: 1, decision: "Accepted", replacementNote: "" }, data.processor),
    ]);
    successful(independentEdit);
    successful(reviewed);
    const final = await readFile(data.officer);
    assert.equal(item(final).title, "Confirm signing after review");
    assert.equal(final.documentRequests.find(({ id }) => id === data.documentId)?.status, "Accepted");
    assert.match((await write(edit(current.revision, "Unassigned editor"), data.backup)).data.error, /access/i);
    return { profile: data.profile, closingEdits: { officer: describe(timings.officer), processor: describe(timings.processor) },
      conflictingEdit: { acceptedBytes: saved.bytes, rejectedBytes: rejected.bytes, acceptedMs: Math.round(saved.ms), rejectedMs: Math.round(rejected.ms) },
      independentEdits: { closingBytes: independentEdit.bytes, reviewBytes: reviewed.bytes, bothPreserved: true },
      retryKeptRevision: true, deniedOtherOwner: true };
  }

  async function rehearseMixedWork() {
    const [heavy, ...small] = tenants;
    const calendar = { week: calendarWeek, scope: "Mine", group: "All" };
    const search = (query) => ({ type: "search", query, filter: "All records" });
    const conversations = { type: "list", filter: "Needs reply", mine: true };
    const finance = { type: "list", from: "2026-11-01", through: "2026-11-30", view: "Funded", owner: "" };
    const workloads = [
      { name: "Today", action: names[0], roles: ["officer"], input: () => ({ horizon: 7 }), check: (data, result) => {
        assert.ok(result.items.some(({ id, name }) => id === data.marker && name === data.marker));
        assert.deepEqual(result.replies.items.map(({ id }) => id), [threadId(2)]);
        assert.ok(result.items.length <= 20 && result.items.every(({ name }) => name !== data.backupMarker));
      } },
      { name: "Calendar", action: "readCalendarWork", roles: ["officer", "backup", "processor", "admin"],
        input: (_, role) => ({ ...calendar, scope: role === "admin" ? "Team" : "Mine" }), check: (_, result, role) => {
          const fixtureItems = result.items.filter(({ id }) => id.startsWith("fixture-calendar-")).map(({ id }) => id).sort();
          const expected = { admin: ["fixture-calendar-backup", "fixture-calendar-officer"], officer: ["fixture-calendar-officer"],
            backup: ["fixture-calendar-backup"], processor: [] };
          assert.deepEqual(fixtureItems, expected[role]);
          assert.ok(result.items.length <= 20);
          if (role === "processor") assert.ok(result.items.some(({ id }) => id === closingItemId));
        } },
      { name: "Search exact", action: "searchWorkspace", roles: ["officer", "backup", "processor", "admin"],
        input: (data, role) => search(role === "backup" ? data.backupMarker : data.marker), check: (data, result, role) => {
          assert.equal(result.indexing, false);
          const expected = role === "backup" ? "loan-000003" : editLoanId;
          assert.deepEqual(result.rows.filter(({ kind }) => kind === "loan").map(({ id }) => id), [expected]);
          assert.ok(!JSON.stringify(result).includes(role === "backup" ? data.marker : data.backupMarker));
        } },
      { name: "Search broad", action: "searchWorkspace", roles: ["officer", "backup", "processor", "admin"],
        input: () => search("Fictional"), check: (_, result, role) => {
          assert.equal(result.indexing, false);
          if (role === "processor") {
            assert.deepEqual(result.rows.filter(({ kind }) => kind === "loan").map(({ id }) => id).sort(), [editLoanId, "loan-000003"]);
            assert.ok(result.rows.every(({ loanId }) => loanId === null || [editLoanId, "loan-000003"].includes(loanId)));
          } else {
            assert.equal(result.rows.length, 20);
            assert.ok(result.next);
            assert.ok(result.rows.every(({ kind, id }) => kind === "loan" && (role === "admin" || Number(id.slice(5)) % 2 === Number(role === "backup"))));
          }
        } },
      { name: "Communications", action: "readConversationWork", roles: ["officer", "backup", "processor"],
        input: () => conversations, check: (_, result, role) => {
          assert.equal(result.kind, "list");
          assert.deepEqual(result.rows.map(({ id }) => id), [threadId({ officer: 2, backup: 7, processor: 3 }[role])]);
        } },
      { name: "Financials", action: "accessBrokerageFinance", roles: ["admin"], input: () => finance, check: (data, result) => {
        const count = profiles[data.profile].loans / 5;
        assert.equal(result.loans.length, 20);
        assert.ok(result.next);
        assert.equal(result.totals.count, count);
        assert.equal(result.totals.expectedCents, count * 720_000);
        assert.equal(result.totals.receiptsCents, count * 600_000);
      } },
    ];

    const warmup = [];
    for (const data of tenants) {
      const start = performance.now();
      for (let calls = 1; calls <= 550; calls++) {
        const response = await request(data, "searchWorkspace", [search(data.marker), data.id], data.admin);
        const result = actionResult(response);
        assert.equal(result.kind, "results");
        if (!result.indexing) {
          warmup.push({ profile: data.profile, calls, elapsedMs: Math.round(performance.now() - start) });
          break;
        }
        assert.ok(calls < 550, "Search backfill exceeded the bounded fixture warmup");
      }
    }

    function checkIsolation(data, result) {
      const serialized = JSON.stringify(result);
      assert.ok(tenants.every((other) => other === data || (!serialized.includes(other.marker) && !serialized.includes(other.backupMarker))),
        "Response included another brokerage's fixture markers");
    }

    const borrower = (data, input = { type: "status" }) => portalRequest("demo-application", { ...input, token: data.borrowerToken });
    const realtor = (data, after) => portalRequest("realtor-referrals", { type: "read", after, token: data.realtorToken });
    async function borrowerStatus(data) {
      const response = await borrower(data);
      const { result } = response;
      assert.equal(result.kind, "status");
      assert.ok(result.submittedAt);
      assert.ok(!("draft" in result));
      assert.deepEqual(result.loanStatus.documents.map(({ id }) => id), [data.documentId]);
      assert.ok(["Requested", "Received"].includes(result.loanStatus.documents[0].status));
      checkIsolation(data, result);
      return response;
    }
    async function realtorStatus(data, after) {
      const response = await realtor(data, after);
      const { result } = response;
      assert.equal(result.realtorName, data.realtorName);
      assert.equal(result.referrals.length, 20);
      if (!after) assert.equal(result.referrals[0].borrowerName, data.marker);
      assert.ok(result.next);
      assert.ok(result.referrals.every((row) => Object.keys(row).sort().join(",") === "borrowerName,stage,updatedAt"));
      assert.doesNotMatch(JSON.stringify(result), /restricted borrower|borrower-private|Pay stub|Confirm signing/);
      checkIsolation(data, result);
      return response;
    }

    let closingEdits = 0;
    async function phase(name, parallel, minimumRounds, tenantAt, { withEdits = false, durationMs = 0, withPortals = false } = {}) {
      const samples = Object.fromEntries(workloads.map(({ name: label }) => [label, []]));
      const edits = [];
      const portals = { borrower: [], realtor: [], sampleAttachments: [] };
      const counts = await directory.requestCounts();
      const start = performance.now();
      let rounds = 0;
      for (; rounds < minimumRounds || performance.now() - start < durationMs; rounds++) {
        const round = rounds;
        const readers = Array.from({ length: parallel }, async (_, index) => {
          const slot = round + index;
          const work = workloads[slot % workloads.length];
          const role = work.roles[Math.floor(slot / workloads.length) % work.roles.length];
          const data = tenantAt(index, round);
          const response = await request(data, work.action, [work.input(data, role), data.id], data[role]);
          const result = actionResult(response);
          work.check(data, result, role);
          checkIsolation(data, result);
          samples[work.name].push({ ms: response.ms, bytes: response.bytes, profile: data.profile, role });
        });
        if (withEdits) readers.push((async () => {
          const revision = closingEdits + 1;
          const input = { type: "saveClosingItem", loanId: editLoanId, itemId: closingItemId, revision,
            title: `Fictional signing plan ${revision}`, owner: "Loan officer", dueDate: "2026-11-11" };
          const response = await request(heavy, "mutate", [input, heavy.id], revision % 2 ? heavy.officer : heavy.processor);
          const result = actionResult(response);
          assert.ok(!result.error, result.error);
          assert.deepEqual(result.loanWork.loans.map(({ id }) => id), [editLoanId]);
          assert.equal(result.loanWork.closingItems.find(({ id }) => id === closingItemId)?.title, input.title);
          closingEdits++;
          edits.push(response);
        })());
        if (withPortals) {
          for (const data of [heavy, heavy, small[round % small.length]]) {
            readers.push(borrowerStatus(data).then((response) => portals.borrower.push(response)),
              realtorStatus(data).then((response) => portals.realtor.push(response)));
          }
          if (round < tenants.length) readers.push((async () => {
            const data = tenants[round];
            const response = await borrower(data, { type: "attachSample", statusOnly: true, requestId: data.documentId, revision: 0 });
            assert.equal(response.result.kind, "status");
            assert.ok(!("draft" in response.result));
            const document = response.result.loanStatus.documents.find(({ id }) => id === data.documentId);
            assert.equal(document.status, "Received");
            assert.equal(document.revision, 1);
            portals.sampleAttachments.push(response);
          })());
        }
        await Promise.all(readers);
      }
      const end = await directory.requestCounts();
      const elapsed = performance.now() - start;
      const portalRequests = Object.values(portals).reduce((count, observations) => count + observations.length, 0);
      assert.equal(end.combined - counts.combined, rounds * parallel + edits.length, "One directory lookup per mixed action");
      assert.equal(end.portal - counts.portal, portalRequests, "One directory lookup per portal request");
      assert.equal(end.session, counts.session);
      assert.equal(end.directory, counts.directory);
      const smallReads = Object.fromEntries(Object.entries(samples).flatMap(([label, observations]) => {
        const light = observations.filter(({ profile }) => profile === "small");
        return light.length ? [[label, describe(light)]] : [];
      }));
      const processorBroad = samples["Search broad"].filter(({ role, profile }) => role === "processor" && profile === "heavy");
      return { name, parallelReads: parallel, rounds, elapsedMs: Math.round(elapsed), requestsPerSecond: Math.round((rounds * parallel + edits.length + portalRequests) * 1000 / elapsed),
        reads: Object.fromEntries(Object.entries(samples).map(([label, observations]) => [label, describe(observations)])), smallReads,
        ...(processorBroad.length ? { heavyProcessorBroad: describe(processorBroad) } : {}),
        ...(withPortals ? { portals: Object.fromEntries(Object.entries(portals).map(([label, observations]) => [label, describe(observations)])) } : {}),
        ...(withEdits ? { writes: describe(edits) } : {}) };
    }

    const broad = workloads.find(({ name }) => name === "Search broad");
    const processorSamples = [];
    for (let i = 0; i < 30; i++) {
      const response = await request(heavy, broad.action, [broad.input(), heavy.id], heavy.processor);
      const result = actionResult(response);
      broad.check(heavy, result, "processor");
      checkIsolation(heavy, result);
      processorSamples.push(response);
    }
    const hotTenant = (index, round) => index % 7 === 0 ? small[round % small.length] : heavy;
    const phases = [
      await phase("Serial heavy", 1, 48, () => heavy),
      await phase("Even spread", 32, 10, (index, round) => tenants[(Math.floor(index / 3) + round) % tenants.length]),
      await phase("Hot brokerage with closing edits", 32, 10, hotTenant, { withEdits: true }),
    ];
    if (sustained) phases.push(await phase(portalTraffic ? "Sustained staff and portal work" : "Sustained hot brokerage with closing edits",
      32, portalTraffic ? tenants.length : 1, hotTenant, { withEdits: true, durationMs: 60_000, withPortals: portalTraffic }));
    const saved = actionResult(await request(heavy, names[1], [editLoanId, heavy.id], heavy.processor));
    const closingItem = saved.closingItems.find(({ id }) => id === closingItemId);
    assert.equal(closingItem.revision, closingEdits + 1);
    assert.equal(closingItem.title, `Fictional signing plan ${closingEdits}`);

    let borrowerResponseBytes;
    if (portalTraffic) {
      for (const data of tenants) {
        const file = actionResult(await request(data, names[1], [editLoanId, data.id], data.processor));
        const document = file.documentRequests.find(({ id }) => id === data.documentId);
        assert.equal(document.status, "Received");
        assert.equal(document.revision, 1);
      }
      const first = await realtorStatus(heavy);
      const second = await realtorStatus(heavy, first.result.next);
      assert.ok(second.result.referrals.every(({ borrowerName }) => !first.result.referrals.some((row) => row.borrowerName === borrowerName)));
      const full = await borrower(heavy, { type: "read" });
      const compact = await borrowerStatus(heavy);
      assert.equal(full.result.draft.borrowerName, heavy.marker);
      assert.deepEqual(compact.result.loanStatus, full.result.loanStatus);
      assert.equal(compact.result.submittedAt, full.result.submittedAt);
      assert.ok(compact.bytes < full.bytes);
      borrowerResponseBytes = { full: full.bytes, compact: compact.bytes };
      await portalRequest("demo-application", { type: "attachSample", statusOnly: true, token: heavy.borrowerToken, requestId: small[0].documentId, revision: 0 }, 404);
      await portalRequest("realtor-referrals", { type: "read", token: `${small[0].id}.${heavy.realtorToken.split(".")[1]}` }, 404);
    }

    async function denied(action, input, actor, message) {
      const result = actionResult(await request(heavy, action, [input, heavy.id], actor, heavy.id, { "x-orbit-staff-email": heavy.admin.email }));
      assert.match(result.error, message);
      assert.deepEqual(Object.keys(result), ["error"]);
    }
    await denied("readCalendarWork", { ...calendar, scope: "Team" }, heavy.officer, /unavailable/i);
    await denied("accessBrokerageFinance", finance, heavy.backup, /owner/i);
    await denied("readConversationWork", { type: "thread", id: threadId(2) }, heavy.backup, /unavailable/i);
    await denied(names[0], { horizon: 7 }, heavy.processor, /unavailable/i);
    for (const work of workloads) {
      const role = work.roles[0];
      const response = await request(heavy, work.action, [work.input(heavy, role), small[0].id], heavy[role], small[0].id);
      assert.equal(response.status, 403);
      assert.ok(tenants.every(({ marker, backupMarker }) => !response.body.includes(marker) && !response.body.includes(backupMarker)));
    }
    await directory.revokeFixture(heavy.id, heavy.officer.email);
    for (const work of workloads.filter(({ roles }) => roles.includes("officer"))) {
      const response = await request(heavy, work.action, [work.input(heavy, "officer"), heavy.id], heavy.officer);
      assert.equal(response.status, 401);
      assert.ok(!response.body.includes(heavy.marker));
    }
    const unaffected = workloads[0];
    unaffected.check(small[0], actionResult(await request(small[0], unaffected.action, [unaffected.input(), small[0].id])));
    return { warmup, processorSerialBroad: describe(processorSamples), phases, ...(borrowerResponseBytes ? { borrowerResponseBytes } : {}),
      isolation: { roleAndOwnerDenials: true, wrongBrokerage: 403, revoked: 401, otherBrokerageStillAvailable: true },
      closingEditsPreserved: closingItem.revision - 1 };
  }

  if (mixed) {
    console.log(JSON.stringify(await rehearseMixedWork(), null, 2));
  } else if (entryOnly) {
    async function enter(data, staff, target = data.id, guide = "") {
      const started = performance.now();
      const response = await mf.dispatchFetch(`${origin}/workspace?brokerage=${target}${guide}`, {
        headers: { "Accept-Encoding": "identity", Cookie: `__Host-orbit-session=${staff.token}` },
      });
      const body = await response.text();
      return { body, status: response.status, bytes: Buffer.byteLength(body), ms: Math.round(performance.now() - started) };
    }
    const entries = {};
    for (const data of tenants.slice(0, 2)) {
      entries[data.profile] = {};
      for (const [role, heading] of [["officer", "Today"], ["admin", "Today"], ["processor", "Processing"]]) {
        const { body, ...entry } = await enter(data, data[role]);
        entries[data.profile][role] = entry;
        if (!entryBefore) {
          assert.equal(entry.status, 200, `${data.profile} ${role}`);
          assert.ok(body.includes(`>${heading}</h1>`), `Expected the ${heading} entry view for ${role}`);
          assert.ok(!body.includes(data.marker), "Entry embedded a borrower record");
        }
      }
    }
    if (!entryBefore) {
      const [heavy, small] = tenants;
      const queue = actionResult(await request(heavy, names[0], [{ horizon: 7 }, heavy.id]));
      assert.ok(queue.items.some(({ name }) => name === heavy.marker));
      const processing = actionResult(await request(heavy, "readProcessingWork", [{ readyOnly: false }, heavy.id], heavy.processor));
      assert.ok(processing.files.some(({ id, name }) => id === "loan-000002" && name === heavy.marker));
      for (const actor of [heavy.officer, heavy.admin, heavy.processor]) {
        const file = actionResult(await request(heavy, names[1], ["loan-000002", heavy.id], actor));
        assert.deepEqual(file.loans.map(({ id }) => id), ["loan-000002"]);
        assert.ok(file.contacts.some(({ name }) => name === heavy.marker));
      }
      const wrongBrokerage = await enter(heavy, heavy.officer, small.id);
      assert.equal(wrongBrokerage.status, 403);
      assert.ok(!wrongBrokerage.body.includes(small.marker));
      const guide = await enter(small, small.admin, small.id, "&guide=campaign");
      assert.equal(guide.status, 200);
      assert.ok(guide.body.includes(">Demo Guide</h1>"));
      const legacyTasks = await enter(small, small.processor, small.id, "&guide=campaign");
      assert.equal(legacyTasks.status, 200);
      assert.ok(legacyTasks.body.includes(">Tasks</h1>"));
    }
    let pipeline;
    if (pipelineOnly) {
      const [heavy, small] = tenants;
      const filters = { stage: "", lender: "", officer: "", partner: "", days: "", work: "" };
      const query = { view: "Board", search: "", filters };
      const adminBoard = await request(heavy, "readPipelineWork", [query, heavy.id], heavy.admin);
      const board = actionResult(adminBoard);
      assert.equal(board.metrics.total, 10_000);
      assert.equal(board.matches, 10_000);
      assert.ok(board.lanes.every(({ loans }) => loans.length <= 12));
      assert.ok(!adminBoard.body.includes("contact-000002@example.test"));
      const adminList = await request(heavy, "readPipelineWork", [{ ...query, view: "List" }, heavy.id], heavy.admin);
      const list = actionResult(adminList);
      assert.equal(list.list.loans.length, 30);
      const more = actionResult(await request(heavy, "readPipelineWork", [{ ...query, view: "List", after: list.list.next }, heavy.id], heavy.admin));
      assert.equal(new Set([...list.list.loans, ...more.list.loans].map(({ id }) => id)).size, 60);
      const officer = actionResult(await request(heavy, "readPipelineWork", [{ ...query, view: "List" }, heavy.id]));
      assert.equal(officer.metrics.total, 5_000);
      const processor = actionResult(await request(heavy, "readPipelineWork", [{ ...query, view: "List" }, heavy.id], heavy.processor));
      assert.deepEqual(processor.list.loans.map(({ id }) => id), ["loan-000002"]);
      const wrongBrokerage = await request(heavy, "readPipelineWork", [query, small.id], heavy.officer, small.id);
      assert.equal(wrongBrokerage.status, 403);
      const full = await request(heavy, "mutate", [{ type: "refreshWorkspace" }, heavy.id], heavy.admin);
      const stats = ({ status, ms, bytes }) => ({ status, ms: Math.round(ms), bytes });
      pipeline = { fullWorkspace: stats(full), board: stats(adminBoard), list: stats(adminList) };
    }
    let loanPickers;
    if (pickerOnly) {
      const [heavy, small] = tenants;
      const picker = { kind: "borrower", search: "", selectedId: "contact-100000" };
      const first = await request(heavy, "readLoanContactOptions", [picker, heavy.id], heavy.admin);
      const page = actionResult(first);
      assert.equal(page.options.length, 20);
      assert.equal(page.selected.id, "contact-100000");
      const tail = await request(heavy, "readLoanContactOptions", [{ ...picker, search: "Fictional contact 100000" }, heavy.id], heavy.admin);
      assert.deepEqual(actionResult(tail).options.map(({ id }) => id), ["contact-100000"]);
      const hidden = actionResult(await request(heavy, "readLoanContactOptions", [{ ...picker, selectedId: "contact-000001" }, heavy.id]));
      assert.equal(hidden.selected, null);
      assert.ok(!hidden.options.some(({ id }) => id === "contact-000001"));
      const denied = await request(heavy, "readLoanContactOptions", [picker, small.id], heavy.officer, small.id);
      assert.equal(denied.status, 403);
      const save = await request(heavy, "mutate", [{ type: "loan", address: "", amount: 250000, purpose: "Purchase", stage: "Lead",
        officer: heavy.officer.name, contactId: "contact-000002", borrower: "", partnerId: null, start1003: true }, heavy.id]);
      const saved = actionResult(save);
      assert.ok(saved.applicationToken, saved.error);
      assert.equal(saved.state, undefined);
      assert.deepEqual(saved.loanWork.contacts.map(({ id }) => id), ["contact-000002"]);
      const borrower = await portalRequest("demo-application", { type: "read", token: saved.applicationToken });
      assert.equal(borrower.result.draft.borrowerName, heavy.marker);
      const stats = ({ status, ms, bytes }) => ({ status, ms: Math.round(ms), bytes });
      loanPickers = { first: stats(first), tail: stats(tail), saveAndOpen: stats(save) };
    }
    let contacts;
    if (contactsOnly) {
      const [heavy, small] = tenants;
      const list = { type: "list", search: "" };
      const first = await request(heavy, "readContactsWork", [list, heavy.id], heavy.admin);
      const page = actionResult(first);
      const next = actionResult(await request(heavy, "readContactsWork", [{ ...list, after: page.next }, heavy.id], heavy.admin));
      assert.equal(page.rows.length, 30);
      assert.equal(new Set([...page.rows, ...next.rows].map(({ id }) => id)).size, 60);
      const tail = await request(heavy, "readContactsWork", [{ ...list, search: "Fictional contact 100000" }, heavy.id], heavy.admin);
      assert.deepEqual(actionResult(tail).rows.map(({ id }) => id), ["contact-100000"]);
      const open = { type: "open", id: "contact-000002" };
      const history = await request(heavy, "readContactsWork", [open, heavy.id]);
      assert.equal(actionResult(history).contact.name, heavy.marker);
      assert.deepEqual(actionResult(history).loans.map(({ id }) => id), ["loan-000002"]);
      const processor = actionResult(await request(heavy, "readContactsWork", [list, heavy.id], heavy.processor));
      assert.ok(processor.rows.some(({ id }) => id === open.id));
      assert.ok(!processor.rows.some(({ id }) => id === "contact-000001"));
      const hidden = actionResult(await request(heavy, "readContactsWork", [{ ...open, id: "contact-000001" }, heavy.id]));
      assert.ok(hidden.error);
      const denied = await request(heavy, "readContactsWork", [list, small.id], heavy.officer, small.id);
      assert.equal(denied.status, 403);
      const rows = [
        { name: "Check the end of the index", email: "contact-100000@example.test", phone: "", role: "Borrower" },
        { name: "Fictional scoped import", email: "import-check@example.test", phone: "", role: "Borrower" },
      ];
      const preview = await request(heavy, "readContactsWork", [{ type: "previewCsv", rows }, heavy.id], heavy.admin);
      assert.deepEqual(actionResult(preview).duplicates, [true, false]);
      const imported = await request(heavy, "mutate", [{ type: "importContacts", batchId: randomUUID(), rows }, heavy.id], heavy.admin);
      const receipt = actionResult(imported);
      assert.equal(receipt.contactsChanged, true);
      assert.equal(receipt.state, undefined);
      assert.match(receipt.message, /1 contacts imported · 1 possible duplicates skipped/);
      const exported = await request(heavy, "readContactsWork", [{ type: "exportCsv" }, heavy.id], heavy.admin);
      assert.equal(exported.status, 200);
      const { createFromReadableStream } = await import("react-server-dom-webpack/client.edge");
      const { returnValue } = await createFromReadableStream(new Response(exported.body).body,
        { serverConsumerManifest: { moduleMap: {}, serverModuleMap: {}, moduleLoading: null } });
      assert.equal(returnValue.ok, true);
      const { csv } = returnValue.data;
      assert.equal(csv.split("\r\n").length, 100_002);
      assert.match(csv, /import-check@example\.test/);
      assert.match(csv, /contact-100000@example\.test/);
      const stats = ({ status, ms, bytes }) => ({ status, ms: Math.round(ms), bytes });
      contacts = { first: stats(first), tail: stats(tail), history: stats(history),
        preview: stats(preview), import: stats(imported), export: stats(exported) };
    }
    let inbox;
    if (inboxOnly) {
      const [heavy, small] = tenants;
      await ns.getByName(heavy.id).seedInbox(heavy);
      const list = { type: "list", view: "All open" };
      const first = await request(heavy, "readInboxWork", [list, heavy.id]);
      const page = actionResult(first);
      const next = actionResult(await request(heavy, "readInboxWork", [{ ...list, after: page.next }, heavy.id]));
      assert.equal(page.leads.length, 25);
      assert.equal(page.overdue, 6667);
      assert.equal(new Set([...page.leads, ...next.leads].map(({ id }) => id)).size, 50);
      assert.ok(!page.leads.some(({ officerEmail }) => officerEmail === heavy.backup.email));
      const open = { type: "open", id: "00000000-0000-4000-9000-000000010000" };
      const exact = await request(heavy, "readInboxWork", [open, heavy.id]);
      assert.equal(actionResult(exact).lead.id, open.id);
      assert.ok(actionResult(await request(heavy, "readInboxWork", [open, heavy.id], heavy.backup)).error);
      assert.ok(actionResult(await request(heavy, "readInboxWork", [list, heavy.id], heavy.processor)).error);
      assert.equal((await request(heavy, "readInboxWork", [list, small.id], heavy.officer, small.id)).status, 403);
      const claim = await request(heavy, "mutate", [{ type: "assignInboxLead", leadId: "00000000-0000-4000-9000-000000000003",
        email: heavy.officer.email, previousEmail: null }, heavy.id, "inbox"]);
      const receipt = actionResult(claim);
      assert.equal(receipt.inboxChanged, true);
      assert.equal(receipt.state, undefined);
      const stats = ({ status, ms, bytes }) => ({ status, ms: Math.round(ms), bytes });
      inbox = { first: stats(first), exact: stats(exact), claim: stats(claim) };
    }
    let tasks;
    if (tasksOnly) {
      const [heavy, small] = tenants;
      const workspace = ns.getByName(heavy.id);
      await workspace.seedTaskPages();
      await workspace.seedDenseOtherOwnerTasks();
      const query = { type: "list", scope: "Mine", view: "Open", group: "Loan follow-ups" };
      const first = await request(heavy, "readTaskWork", [query, heavy.id]);
      const page = actionResult(first);
      assert.equal(page.items.length, 20);
      const more = await request(heavy, "readTaskWork", [{ ...query, checkedAt: page.checkedAt, after: page.next }, heavy.id]);
      const next = actionResult(more);
      assert.equal(new Set([...page.items, ...next.items].map(({ id }) => id)).size, 40);
      assert.ok([...page.items, ...next.items].every(({ id }) => !id.startsWith("heavy-task-")));
      assert.ok(actionResult(await request(heavy, "readTaskWork", [{ ...query, scope: "Team" }, heavy.id])).error);
      assert.equal((await request(heavy, "readTaskWork", [query, small.id], heavy.officer, small.id)).status, 403);
      const saved = await request(heavy, "mutate", [{ type: "completeTask", id: "paged-task-01", completed: true }, heavy.id, "tasks"]);
      const receipt = actionResult(saved);
      assert.equal(receipt.tasksChanged, true);
      assert.equal(receipt.state, undefined);
      const updated = actionResult(await request(heavy, "readTaskWork", [query, heavy.id]));
      assert.ok(!updated.items.some(({ id }) => id === "paged-task-01"));
      const historyQuery = { ...query, view: "Completed" };
      const history = await request(heavy, "readTaskWork", [historyQuery, heavy.id]);
      const historyPage = actionResult(history);
      const nextHistory = actionResult(await request(heavy, "readTaskWork",
        [{ ...historyQuery, checkedAt: historyPage.checkedAt, after: historyPage.next }, heavy.id]));
      assert.equal(new Set([...historyPage.items, ...nextHistory.items].map(({ id }) => id)).size, 40);
      assert.equal(historyPage.items[0].id, "paged-task-01");
      const stats = ({ status, ms, bytes }) => ({ status, ms: Math.round(ms), bytes });
      tasks = { first: stats(first), next: stats(more), complete: stats(saved), history: stats(history) };
      if (inboxOnly) {
        const playbook = await request(heavy, "readTaskWork", [{ ...query, scope: "Available", group: "Playbook tasks" }, heavy.id]);
        const work = actionResult(playbook);
        assert.equal(work.items.length, 20);
        assert.ok(work.items.every(({ kind }) => kind === "quiet-lead"));
        tasks.playbook = stats(playbook);
      }
    }
    let drafts;
    if (draftsOnly) {
      const [heavy, small] = tenants;
      await ns.getByName(heavy.id).seedDrafts();
      const query = { view: "Ready to copy" };
      const first = await request(heavy, "readDraftWork", [query, heavy.id]);
      const page = actionResult(first);
      const more = await request(heavy, "readDraftWork", [{ ...query, after: page.next }, heavy.id]);
      const next = actionResult(more);
      assert.equal(page.rows.length, 20);
      assert.equal(new Set([...page.rows, ...next.rows].map(({ id }) => id)).size, 40);
      assert.ok([...page.rows, ...next.rows].every(({ loanId }) => loanId === "loan-000002"));
      assert.equal(actionResult(await request(heavy, "readDraftWork", [query, heavy.id], heavy.processor)).rows.length, 20);
      assert.equal((await request(heavy, "readDraftWork", [query, small.id], heavy.officer, small.id)).status, 403);
      const draftId = page.rows[0].id;
      const saved = await request(heavy, "mutate", [{ type: "copyDraft", loanId: "loan-000002", contactId: "contact-000002",
        audience: "Borrower", milestone: "Application received", channel: "Email", draftId }, heavy.id]);
      const receipt = actionResult(saved);
      assert.equal(receipt.state, undefined);
      assert.ok(receipt.loanWork.communicationDrafts.find(({ id }) => id === draftId).emailCopiedAt);
      const copied = actionResult(await request(heavy, "readDraftWork", [{ view: "Copied" }, heavy.id]));
      assert.deepEqual(copied.rows.map(({ id }) => id), [draftId]);
      const stats = ({ status, ms, bytes }) => ({ status, ms: Math.round(ms), bytes });
      drafts = { first: stats(first), next: stats(more), copy: stats(saved) };
    }
    console.log(JSON.stringify({ entries, pipeline, loanPickers, contacts, inbox, tasks, drafts }, null, 2));
  } else if (writesOnly) {
    console.log(JSON.stringify({ writes: [await rehearseEdits(tenants[1]), await rehearseEdits(tenants[0])] }, null, 2));
  } else {
  async function read(data, kind) {
    const result = await request(data, names[kind], [kind === 0 ? { horizon: 7 } : "loan-000002", data.id]);
    const payload = actionResult(result);
    if (kind === 0) {
      assert.ok(payload.items.length <= 20);
      assert.ok(payload.items.some(({ name }) => name === data.marker), "Queue must include the authorized borrower");
      assert.ok(payload.items.every(({ title }) => title !== "Fictional other-owner task"), "Queue returned another officer's task");
    } else {
      assert.deepEqual(payload.loans.map(({ id }) => id), ["loan-000002"]);
      assert.ok(payload.contacts.some(({ name }) => name === data.marker), "Loan read must include the authorized borrower");
    }
    const serialized = JSON.stringify(payload);
    assert.ok(tenants.every((other) => other === data || !serialized.includes(other.marker)), "Cross-brokerage result marker");
    return { ms: result.ms, bytes: result.bytes, profile: data.profile };
  }

  const cold = {};
  for (const data of [tenants[0], tenants[1]]) {
    const result = await read(data, 0);
    cold[data.profile] = { ms: Math.round(result.ms), bytes: result.bytes };
  }
  for (const data of tenants) for (const kind of [0, 1]) await read(data, kind);

  async function phase(name, parallel, rounds, select) {
    const before = await directory.requestCounts();
    const samples = [[], []];
    const start = performance.now();
    for (let round = 0; round < rounds; round++) {
      await Promise.all(Array.from({ length: parallel }, async (_, index) => {
        const kind = (round + index) % names.length;
        samples[kind].push(await read(select(index, round), kind));
      }));
    }
    const elapsed = performance.now() - start;
    const after = await directory.requestCounts();
    const light = samples.flat().filter(({ profile }) => profile === "small");
    return { name, parallel, rounds, requestsPerSecond: Math.round(rounds * parallel * 1000 / elapsed),
      queue: describe(samples[0]), loan: describe(samples[1]),
      ...(light.length ? { smallBrokerageReads: describe(light) } : {}),
      directoryCalls: Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]])) };
  }

  const phases = [
    await phase("Serial heavy", 1, 30, () => tenants[0]),
    await phase("Even spread", 32, 10, (index, round) => tenants[(index + round) % tenants.length]),
    await phase("Hot brokerage", 32, 10, (index, round) => index % 8 === 0 ? tenants[1 + round % 3] : tenants[0]),
  ];
  await ns.getByName(tenants[0].id).seedDenseOtherOwnerTasks();
  phases.push(await phase("Heavy with 50,000 other-owner deadlines", 1, 30, () => tenants[0]));
  const [a, b] = tenants;
  const wrongBrokerage = await request(a, names[0], [{ horizon: 7 }, b.id], a.officer, b.id);
  const wrongActionScope = await request(a, names[1], ["loan-000002", b.id]);
  const wrongLoanOwner = await request(a, names[1], ["loan-000002", a.id], a.backup, a.id, { "x-orbit-staff-email": a.admin.email });
  const anonymous = await request(a, names[0], [{ horizon: 7 }, a.id], null);
  assert.equal(wrongBrokerage.status, 403);
  assert.ok(wrongActionScope.body.includes("This loan is unavailable"));
  assert.ok(wrongLoanOwner.body.includes("This loan is unavailable"));
  assert.equal(anonymous.status, 401);
  await directory.revokeFixture(a.id, a.officer.email);
  const revoked = await request(a, names[1], ["loan-000002", a.id]);
  assert.equal(revoked.status, 401);
  for (const result of [wrongBrokerage, wrongActionScope, wrongLoanOwner, anonymous, revoked]) {
    assert.ok(tenants.every(({ marker }) => !result.body.includes(marker)), "Denied request returned a borrower marker");
  }
  await read(b, 1);
  console.log(JSON.stringify({ cold, phases, isolation: { wrongBrokerage: wrongBrokerage.status, wrongActionScope: "denied",
    wrongLoanOwner: "denied", anonymous: anonymous.status, revoked: revoked.status, otherBrokerageStillAvailable: true } }, null, 2));
  }
} finally {
  try { await mf?.dispose(); }
  finally {
    const target = await realpath(persistence);
    assert.equal(dirname(target), tempRoot, "Benchmark storage must stay in the temporary directory");
    await rm(target, { recursive: true, force: true });
  }
}

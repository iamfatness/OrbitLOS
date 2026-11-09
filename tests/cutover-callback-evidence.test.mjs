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

const { initializeStore } = await import("../src/lib/store.ts");
const { readCutoverCallbackEvidence } = await import("../src/lib/cutover-callback-evidence.ts");
const { cutoverReviewInput, cutoverSourceInput } = await import("../src/lib/migration-cutover-model.ts");

const origin = "orbit-fixture";
const basis = "a".repeat(64);
const earlierBasis = "b".repeat(64);
const requestedAt = "2026-11-08T15:00:00.000Z";
const nextCallAt = "2026-11-08T16:00:00.000Z";
const dueAt = "2026-11-09T15:00:00.000Z";
const scheduledAt = "2026-11-10T15:00:00.000Z";
const owner = "officer@example.test";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction: (run) => run() };
  db.exec("PRAGMA foreign_keys = ON");
  initializeStore(db, false);
  db.prepare("INSERT INTO call_campaigns VALUES ('pilot', 'Fictional campaign', ?)").run(requestedAt);
  const read = (after, owners = new Set([owner]), source = origin) => readCutoverCallbackEvidence(db, source, basis, owners, after);
  const link = db.prepare("INSERT INTO migration_records VALUES (?, ?, ?)");
  function add(id, { source = origin, officerEmail = owner, status = "Completed", heldAt = null, history = false, badRequest = null } = {}) {
    const leadId = `lead-${id}`;
    const taskId = `task-${id}`;
    const runId = `run-${id}`;
    const requestId = `request-${id}`;
    const callAt = history ? nextCallAt : requestedAt;
    db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, heldAt)
      VALUES (?, ?, ?, ?, '', 'Purchase', 'Fictional officer', ?, ?, ?, ?)`).run(leadId, leadId, id, `${id}@example.test`, officerEmail, requestedAt, dueAt, heldAt);
    if (status === "Completed") db.prepare(`INSERT INTO lead_import_tasks (id, leadId, title, dueAt, purpose)
      VALUES (?, ?, 'Call back', ?, 'Prospecting')`).run(taskId, leadId, scheduledAt);
    db.prepare(`INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, attempts, lastOutcome, callbackTaskId)
      VALUES (?, 'pilot', ?, ?, 'Requested callback', ?)`).run(leadId, requestedAt, history ? 2 : 1, status === "Completed" ? taskId : null);
    const call = db.prepare(`INSERT INTO lead_events (id, leadId, at, actor, kind, outcome, text)
      VALUES (?, ?, ?, 'Fictional officer', 'Call', 'Requested callback', 'Borrower requested a call')`);
    const promise = db.prepare(`INSERT INTO campaign_follow_up_runs (id, leadId, campaignId, callNumber, outcome, ruleRevision, taskId, taskTitle,
      dueAt, status, reason, attemptCount, at, promiseRequestEventId, promiseDueAt, promiseAttemptEventId, promiseClosedAt)
      VALUES (?, ?, 'pilot', ?, 'Requested callback', 0, ?, 'Call back', ?, ?, '', 1, ?, ?, ?, ?, ?)`);
    call.run(requestId, leadId, callAt);
    if (history) {
      call.run(`${requestId}-first`, leadId, requestedAt);
      promise.run(`${runId}-first`, leadId, 1, taskId, dueAt, "Completed", requestedAt, `${requestId}-first`, dueAt, requestId, callAt);
    }
    promise.run(runId, leadId, history ? 2 : 1, taskId, dueAt, status, callAt, badRequest ?? requestId, dueAt, null, null);
    db.prepare(`INSERT INTO campaign_follow_up_attempts VALUES (?, 1, ?, 'Trigger', ?, '', 'Fictional officer', ?, ?)`)
      .run(runId, runId, status, callAt, Number(status === "Completed"));
    link.run(source, `Lead:${id}`, leadId);
    link.run(source, `Callback:${id}`, leadId);
  }
  return { db, add, read, link };
}

test("cutover verifies each scoped promise and keeps its promised deadline separate from the scheduled task", (t) => {
  const { db, add, read } = fixture(t);
  add("two", { history: true });
  add("failed", { status: "Failed" });
  add("held-failed", { status: "Failed", heldAt: nextCallAt });
  add("no-owner", { officerEmail: "inactive@example.test" });
  add("held", { heldAt: nextCallAt });
  add("foreign", { source: "other-source" });
  add("wrong-request", { badRequest: "request-foreign" });
  add("suppressed");
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', 'lead:lead-suppressed', NULL, ?)").run(nextCallAt);
  const result = read();
  assert.deepEqual(result.counts, { "Needs recovery": 2, "Needs owner": 1, "Missing evidence": 2, "On hold": 1, Ready: 1, Closed: 1 });
  assert.equal(result.total, 8);
  assert.deepEqual(result.items.map(({ status }) => status),
    ["Needs recovery", "Needs recovery", "Needs owner", "Missing evidence", "Missing evidence", "On hold", "Ready", "Closed"]);
  assert.deepEqual(result.items.find(({ status }) => status === "Ready"), { key: "Callback:two/run-two", leadId: "lead-two",
    name: "two", campaignName: "Fictional campaign", owner: "Fictional officer", status: "Ready",
    reason: "The promised deadline, current task, and active owner are verified.", dueAt, scheduledAt });
  assert.match(result.items.find(({ key }) => key === "Callback:held-failed/run-held-failed").reason, /Reactivate/);
  assert.match(result.items.find(({ key }) => key === "Callback:suppressed/run-suppressed").reason, /opted out/);
  assert.equal(result.items.find(({ status }) => status === "Closed").scheduledAt, null);
  assert.equal(read(undefined, new Set([owner]), "other-source").total, 1);

  db.prepare("UPDATE lead_events SET actor = 'Original officer' WHERE id = 'request-two'").run();
  assert.notEqual(read().fingerprint, result.fingerprint);
  const reassigned = read(undefined, new Set([owner, "inactive@example.test"]));
  assert.equal(reassigned.counts.Ready, 2);
  db.prepare("DELETE FROM campaign_follow_up_attempts WHERE runId = 'run-failed'").run();
  assert.match(read().items.find(({ key }) => key === "Callback:failed/run-failed").reason, /recoverable run/);
  db.prepare("UPDATE call_campaign_members SET callbackTaskId = 'task-foreign' WHERE leadId = 'lead-two'").run();
  assert.match(read().items.find(({ key }) => key === "Callback:two/run-two").reason, /does not belong/);
});

test("current exclusions and outstanding undo are deduplicated and a restored link wins", (t) => {
  const { db, add, read, link } = fixture(t);
  add("restored");
  link.run(origin, "Callback:gone", "missing-lead");
  db.prepare("INSERT INTO migration_batches VALUES (?, ?, 1, 1, 'hash', ?)").run(origin, basis, JSON.stringify({
    "Callback:skipped": "Skipped", "Callback:suppressed": "Suppressed", "Callback:undo": "Skipped", "Callback:restored": "Undone", "Lead:other": "Skipped",
  }));
  db.prepare("INSERT INTO migration_batches VALUES (?, ?, 1, 1, 'hash', ?)")
    .run(origin, earlierBasis, JSON.stringify({ "Callback:old": "Skipped" }));
  db.prepare("INSERT INTO migration_imports VALUES ('receipt', ?, ?, 'Fictional admin', 1, 1, 2)").run(origin, requestedAt);
  db.prepare("INSERT INTO migration_import_undos VALUES ('undo', 'receipt', 'hash', ?, 'Fictional admin', 2)").run(nextCallAt);
  db.prepare("INSERT INTO migration_undone_records VALUES (?, 'Callback:undo', 'undo'), (?, 'Callback:restored', 'undo')").run(origin, origin);
  const result = read();
  assert.equal(result.unrestored, 3);
  assert.equal(result.counts["Missing evidence"], 4);
  assert.deepEqual(result.items.map(({ key }) => key), ["Callback:gone", "Callback:skipped", "Callback:suppressed", "Callback:undo", "Callback:restored/run-restored"]);
  assert.match(result.items.find(({ key }) => key === "Callback:undo").reason, /undone/);
});

test("callback pages share a fingerprint and exact counts across the bounded source", (t) => {
  const { db, add, read } = fixture(t);
  for (let index = 0; index < 23; index++) add(`lead-${String(index).padStart(2, "0")}`);
  const first = read();
  assert.equal(first.items.length, 20);
  assert.equal(first.total, 23);
  assert.equal(cutoverSourceInput.safeParse({ origin, callbackAfter: first.next }).success, true);
  const second = read(first.next);
  assert.equal(second.items.length, 3);
  assert.equal(second.next, null);
  assert.deepEqual(second.counts, first.counts);
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(new Set([...first.items, ...second.items].map(({ key }) => key)).size, 23);
  db.prepare(`WITH RECURSIVE fixture(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM fixture WHERE n < 10000)
    INSERT INTO migration_records SELECT ?, 'Callback:padding-' || n, 'absent' FROM fixture`).run(origin);
  const oversized = read();
  assert.equal(oversized.oversized, true);
  assert.equal(oversized.total, 0);
  assert.deepEqual(oversized.items, []);
  assert.notEqual(oversized.fingerprint, first.fingerprint);
  const review = { origin, basis, item: "callbacks", decision: "Reconciled", note: "Verified fictional promises", revision: 0, callbackFingerprint: first.fingerprint };
  assert.equal(cutoverReviewInput.safeParse(review).success, true);
  assert.equal(cutoverReviewInput.safeParse({ ...review, loanId: "loan" }).success, false);
});

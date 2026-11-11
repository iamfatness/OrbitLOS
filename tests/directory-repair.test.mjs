import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
}});
const { captureDirectoryEvidence } = await import("../src/lib/directory-evidence.ts");
const { applyDirectoryRepair, previewDirectoryRepair } = await import("../src/lib/directory-repair.ts");
const now = "2026-11-11T15:00:00.000Z";

test("sealed directory evidence detects changed account defaults without exposing them", async t => {
  const { db, workspace, other } = fixture(t);
  const { initializeMaintenance } = await import("../src/lib/workspace-maintenance.ts");
  const { initializeRecoveryEdits } = await import("../src/lib/recovery-edits.ts");
  const { initializeRecoveryCheckpoints } = await import("../src/lib/recovery-checkpoints.ts");
  const { captureDirectoryRecoverySnapshot, directoryEvidenceHttp, directoryEvidencePrefix } = await import("../src/lib/directory-evidence.ts");
  const { directoryPauseKey } = await import("../src/lib/directory-traffic-pause.ts");
  initializeMaintenance(db);
  initializeRecoveryEdits(db, true);
  initializeRecoveryCheckpoints(db);
  const digest = value => createHash("sha256").update(value).digest("hex");
  const token = "a".repeat(64);
  const incident = { incident: "fixture", evidenceTokenSha256: digest(token) };
  const id = crypto.randomUUID();
  const key = directoryEvidencePrefix + id + ".json";
  const objects = new Map([[directoryPauseKey, JSON.stringify(incident)]]);
  const bucket = {
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : { size: Buffer.byteLength(value), version: "paused",
        json: async () => JSON.parse(value), text: async () => value, customMetadata: { sha256: digest(value) } };
    },
    async head() { return { version: "paused" }; },
    async put(key, value) { objects.set(key, value); return {}; },
  };
  const request = method => directoryEvidenceHttp(new Request("https://fixture.invalid/api/ops/directory-evidence?id="+id,
    { method, headers: { Authorization: "Bearer " + token } }), bucket, "fixture",
    async () => ({ active: 0 }), async () => captureDirectoryRecoverySnapshot(db));
  db.prepare("INSERT INTO staff_workspace_preferences VALUES (?,?)").run("owner@example.test", workspace);
  assert.equal((await request("POST")).status, 201);
  const saved = JSON.parse(objects.get(key));
  assert.equal(saved.version, 3);
  assert.deepEqual(Object.keys(saved.workspacePreferences), ["count", "digest"]);
  assert.doesNotMatch(objects.get(key), /owner@example\.test/);
  assert.equal((await (await request("GET")).json()).matches, true);

  db.prepare("UPDATE staff_workspace_preferences SET brokerageId=?").run(other);
  const changed = await (await request("GET")).json();
  assert.equal(changed.accessMatches, true);
  assert.deepEqual(changed.workspacePreferences, { status: "changed", saved: 1, current: 1 });
  assert.equal(changed.matches, false);
  assert.doesNotMatch(JSON.stringify(changed), /owner@example\.test|digest/);

  const { workspacePreferences, ...legacy } = saved;
  assert.ok(workspacePreferences);
  objects.set(key, JSON.stringify({ ...legacy, version: 2 }));
  const older = await (await request("GET")).json();
  assert.deepEqual(older.workspacePreferences, { status: "unavailable", saved: null, current: 1 });
  assert.equal(older.maintenance.status, "matched");
  assert.equal(older.matches, false);
});

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    prepare: sql => sqlite.prepare(sql),
    exec: sql => sqlite.exec(sql),
    transaction: fn => {
      sqlite.exec("BEGIN");
      try { const result = fn(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  db.exec(`CREATE TABLE brokerages (id TEXT PRIMARY KEY,pilot INTEGER);
    CREATE TABLE brokerage_members (brokerageId TEXT,email TEXT,role TEXT,status TEXT,accessRevision INTEGER,bootstrap INTEGER);
    CREATE TABLE staff_workspace_preferences (email TEXT PRIMARY KEY,brokerageId TEXT NOT NULL);
    CREATE TABLE revoked_pilot_portals (brokerageId TEXT,tokenHash TEXT,expiresAt TEXT,PRIMARY KEY(brokerageId,tokenHash));
    CREATE TABLE uwm_transaction_routes (environment TEXT,transactionId TEXT,brokerageId TEXT,operationId TEXT,PRIMARY KEY(environment,transactionId));
    CREATE TABLE uwm_loan_routes (environment TEXT,loanNumber TEXT,brokerageId TEXT,transactionId TEXT,PRIMARY KEY(environment,loanNumber));`);
  const workspace = crypto.randomUUID(), other = crypto.randomUUID(), operation = crypto.randomUUID();
  db.prepare("INSERT INTO brokerages VALUES (?,1),(?,0)").run(workspace, other);
  db.prepare("INSERT INTO brokerage_members VALUES (?,'revoked@example.test','LO','Revoked',2,0),(?,'owner@example.test','Admin','Active',1,0)").run(workspace, workspace);
  db.prepare("INSERT INTO revoked_pilot_portals VALUES (?,?,?)").run(workspace, "a".repeat(64), "2026-11-20T00:00:00.000Z");
  db.prepare("INSERT INTO uwm_transaction_routes VALUES ('stage','transaction-1',?,?)").run(workspace, operation);
  db.prepare("INSERT INTO uwm_loan_routes VALUES ('stage','loan-1',?,'transaction-1')").run(workspace);
  const evidence = { version:1, id:crypto.randomUUID(), scope:"fixture", capturedAt:now, incident:"QA", rows:captureDirectoryEvidence(db) };
  db.exec("UPDATE brokerage_members SET status='Active',accessRevision=1; DELETE FROM revoked_pilot_portals; DELETE FROM uwm_transaction_routes; DELETE FROM uwm_loan_routes");
  const intent = preview => ({ id:crypto.randomUUID(), evidenceId:evidence.id, fingerprint:preview.fingerprint,
    incident:"QA", deployment:"fixture", markerVersion:"pause-version" });
  return { db, workspace, other, operation, evidence, intent };
}

test("reconstruction restores deny records and routes with an idempotent receipt", t => {
  const { db, evidence, intent } = fixture(t);
  const reviewed = previewDirectoryRepair(db, evidence, now);
  assert.deepEqual(reviewed.changes, { staffRevocations:1, portalRevocations:1, transactionRoutes:1, loanRoutes:1 });
  const request = intent(reviewed);
  assert.deepEqual(applyDirectoryRepair(db, evidence, request, now), reviewed.changes);
  assert.deepEqual(captureDirectoryEvidence(db), evidence.rows);
  assert.deepEqual(applyDirectoryRepair(db, evidence, request, now), reviewed.changes);
  assert.equal(db.prepare("SELECT count(*) AS n FROM directory_repair_receipts").get().n,1);
});

test("stale review and lender ownership conflicts refuse all mutations", t => {
  const { db, evidence, intent, other, operation } = fixture(t);
  const request = intent(previewDirectoryRepair(db, evidence, now));
  db.prepare("INSERT INTO uwm_transaction_routes VALUES ('stage','transaction-1',?,?)").run(other, operation);
  const before = captureDirectoryEvidence(db);
  assert.equal(applyDirectoryRepair(db, evidence, request, now), null);
  const conflict = previewDirectoryRepair(db, evidence, now);
  assert(conflict.conflicts > 0);
  assert.equal(applyDirectoryRepair(db, evidence, intent(conflict), now), null);
  assert.deepEqual(captureDirectoryEvidence(db), before);
});

test("reconstruction neither grants access nor rewinds newer member revisions", t => {
  const { db, evidence, workspace } = fixture(t);
  db.exec("UPDATE brokerage_members SET accessRevision=3 WHERE email='revoked@example.test'; DELETE FROM brokerage_members WHERE email='owner@example.test'");
  db.prepare("INSERT INTO brokerage_members VALUES (?,'newer@example.test','LO','Active',1,0)").run(workspace);
  const review = previewDirectoryRepair(db, evidence, now);
  assert.equal(review.changes.staffRevocations,0);
  assert.equal(review.staffNeedsReview,2);
});

test("sealed maintenance evidence flags same-count decision changes and missing pending work", async t => {
  const { db, workspace, other } = fixture(t);
  const { initializeMaintenance } = await import("../src/lib/workspace-maintenance.ts");
  const { initializeRecoveryEdits } = await import("../src/lib/recovery-edits.ts");
  const { initializeRecoveryCheckpoints } = await import("../src/lib/recovery-checkpoints.ts");
  const { captureDirectoryRecoverySnapshot } = await import("../src/lib/directory-evidence.ts");
  const { compareDirectoryMaintenanceEvidence } = await import("../src/lib/directory-maintenance-evidence.ts");
  initializeMaintenance(db);
  initializeRecoveryEdits(db, true);
  initializeRecoveryCheckpoints(db);
  const decision = db.prepare("INSERT INTO brokerage_maintenance_decisions VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  decision.run("decision", workspace, "cycle", "reference", "fingerprint", "Verified", "private review", "Owner", "owner@example.test", now, "command");
  decision.run("other-decision", other, "cycle", "reference", "fingerprint", "Verified", "other note", "Owner", "other@example.test", now, "command");
  db.prepare("INSERT INTO brokerage_restore_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("restore", workspace, "checkpoint", "source", "cycle", "Armed", "Owner", "owner@example.test", "note", "command", now, null, "message", "private bookmark");
  db.prepare("INSERT INTO brokerage_recovery_edits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("edit", workspace, "Owner", "owner@example.test", now, "private command", "before", "record", "label", "Pending", null, null, null, null);
  db.prepare("INSERT INTO brokerage_recovery_checkpoints VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("checkpoint", workspace, "cycle", "label", "Owner", "owner@example.test", now, now, "private bookmark", "manifest", "command");
  db.exec("INSERT INTO brokerage_checkpoint_parts VALUES ('checkpoint', 0, 'loans', 'private content')");
  const saved = captureDirectoryRecoverySnapshot(db).maintenance;
  const intact = compareDirectoryMaintenanceEvidence(saved, saved);
  assert.equal(intact.status, "matched");
  assert.equal(intact.pending.length, 2);
  db.exec(`UPDATE brokerage_maintenance_decisions SET note='changed' WHERE id='decision';
    DELETE FROM brokerage_restore_jobs; UPDATE brokerage_checkpoint_parts SET content='older content'`);
  const current = captureDirectoryRecoverySnapshot(db).maintenance;
  const review = compareDirectoryMaintenanceEvidence(saved, current);
  assert.equal(review.status, "changed");
  assert.deepEqual(review.changes, [
    { brokerageId:workspace, group:"checkpointParts", saved:1, current:1, savedPending:0, currentPending:0 },
    { brokerageId:workspace, group:"decisions", saved:1, current:1, savedPending:0, currentPending:0 },
    { brokerageId:workspace, group:"restores", saved:1, current:0, savedPending:1, currentPending:0 },
  ]);
  assert.deepEqual(review.pending, [{ brokerageId:workspace, group:"edits", pending:1 }]);
  assert.deepEqual(compareDirectoryMaintenanceEvidence(undefined, current), { status:"unavailable", changes:[], pending:review.pending });
  assert.doesNotMatch(JSON.stringify({ saved, review }), /private|@example\.test|fingerprint|older content/);
});


test("recovery hold replaces stale approval, advances a warm fence, and leaves other brokerages alone", async t => {
  const { db, workspace, other, evidence } = fixture(t);
  const { initializeMaintenance, maintenanceState } = await import("../src/lib/workspace-maintenance.ts");
  const { initializeRecoveryEdits } = await import("../src/lib/recovery-edits.ts");
  const { initializeRecoveryCheckpoints } = await import("../src/lib/recovery-checkpoints.ts");
  const { captureDirectoryRecoverySnapshot } = await import("../src/lib/directory-evidence.ts");
  const { applyDirectoryRecoveryHold, directoryRecoveryHoldRecorded, previewDirectoryRecoveryHold } = await import("../src/lib/directory-recovery-hold.ts");
  initializeMaintenance(db);
  initializeRecoveryEdits(db, true);
  initializeRecoveryCheckpoints(db);
  db.prepare("UPDATE brokerages SET pilot=1 WHERE id=?").run(other);
  db.prepare("INSERT INTO brokerage_maintenance VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(workspace, "Paused", 5, "Original pause", now, "Owner", now, "Owner", "Old approval", "[true,true,true]");
  db.prepare("INSERT INTO brokerage_maintenance_history VALUES (?,?,?,?,?,?)")
    .run("lost-review", workspace, "Decision", "Owner", now, "Fictional review");
  const saved = { ...evidence, version: 2, ...captureDirectoryRecoverySnapshot(db) };
  db.exec("DELETE FROM brokerage_maintenance_history");
  assert.equal(previewDirectoryRecoveryHold(db, evidence, workspace).canHold, false);
  assert.equal(previewDirectoryRecoveryHold(db, saved, other).canHold, false);
  const preview = previewDirectoryRecoveryHold(db, saved, workspace);
  assert.equal(preview.canHold, true);
  const intent = { id:crypto.randomUUID(), evidenceId:saved.id, fingerprint:preview.fingerprint, brokerageId:workspace,
    deployment:"fixture", incident:"fixture", markerVersion:"current", reference:"INC-209" };
  assert.equal(applyDirectoryRecoveryHold(db, saved, {...intent, fingerprint:"a".repeat(64)}, 11, now), null);
  const result = applyDirectoryRecoveryHold(db, saved, intent, 11, now);
  assert.deepEqual(result, { revision:12, groups:["history"] });
  assert.deepEqual(applyDirectoryRecoveryHold(db, saved, intent, 12, now), result);
  assert.equal(maintenanceState(db, workspace).reviewedAt, null);
  assert.deepEqual(maintenanceState(db, workspace).checks, [false,false,false]);
  assert.equal(maintenanceState(db, workspace).startedAt, now);
  assert.equal(maintenanceState(db, other).mode, "Open");
  assert.equal(db.prepare("SELECT count(*) AS n FROM brokerage_maintenance_history").get().n, 1);
  db.exec("DELETE FROM directory_recovery_hold_receipts");
  assert.equal(directoryRecoveryHoldRecorded(db, intent, result), false);
});

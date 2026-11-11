import assert from "node:assert/strict";
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

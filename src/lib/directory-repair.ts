import { createHash } from "node:crypto";
import { z } from "zod";
import { directoryEvidencePrefix, readDirectoryEvidenceRows, readEvidence, type Evidence, type EvidenceRows } from "./directory-evidence";
import { readDirectoryIncident, type DirectoryWorkCounts } from "./directory-drain";
import { directoryPauseKey } from "./directory-traffic-pause";
import type { Store } from "./store";

export const directoryRepairPath = "/api/ops/directory-repair";
export const directoryRepairPrefix = "operations/directory-recovery/repair/";
const uuid = z.uuid().regex(/^[a-f0-9-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const intentSchema = z.strictObject({
  id: uuid, evidenceId: uuid, fingerprint: hash, incident: z.string().max(80),
  markerVersion: z.string().min(1).max(128), deployment: z.string().max(40),
});
export type RepairIntent = z.infer<typeof intentSchema>;
const resultSchema = z.strictObject({
  staffRevocations: z.number().int().nonnegative(), portalRevocations: z.number().int().nonnegative(),
  transactionRoutes: z.number().int().nonnegative(), loanRoutes: z.number().int().nonnegative(),
});
export type RepairResult = z.infer<typeof resultSchema>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const key = (...parts: string[]) => JSON.stringify(parts);

function planDirectoryRepair(saved: Evidence, current: EvidenceRows, brokerages: Map<string, boolean>, now: string) {
  const staff = new Map(current.staff.map(row => [key(row.brokerageId, row.memberHash), row]));
  const portals = new Map(current.portals.map(row => [key(row.brokerageId, row.tokenHash), row]));
  const transactions = new Map(current.transactions.map(row => [key(row.environment, row.transactionId), row]));
  const loans = new Map(current.loans.map(row => [key(row.environment, row.loanNumber), row]));
  let conflicts = 0;
  let staffNeedsReview = 0;
  const revocations = saved.rows.staff.filter(row => {
    const previous = staff.get(key(row.brokerageId, row.memberHash));
    if (same(previous, row)) return false;
    if (row.status === "Revoked" && previous && previous.accessRevision < row.accessRevision &&
        previous.role === row.role && previous.bootstrap === row.bootstrap) return true;
    staffNeedsReview++;
    return false;
  });
  const revokedKeys = new Set(revocations.map(row => key(row.brokerageId, row.memberHash)));
  const adminWorkspaces = new Set(current.staff.filter(row => row.role === "Admin" && row.status === "Active" &&
    !revokedKeys.has(key(row.brokerageId, row.memberHash))).map(row => row.brokerageId));
  for (const row of revocations) {
    if (row.role === "Admin" && staff.get(key(row.brokerageId, row.memberHash))?.status === "Active" &&
        !adminWorkspaces.has(row.brokerageId)) conflicts++;
  }
  const restoredPortals = saved.rows.portals.filter(row => {
    if (row.expiresAt <= now || (portals.get(key(row.brokerageId, row.tokenHash))?.expiresAt ?? "") >= row.expiresAt) return false;
    if (brokerages.get(row.brokerageId) !== true) { conflicts++; return false; }
    return true;
  });
  const restoredTransactions = saved.rows.transactions.filter(row => {
    const identity = key(row.environment, row.transactionId);
    const previous = transactions.get(identity);
    if (previous) {
      if (!same(previous, row)) conflicts++;
      return false;
    }
    if (!brokerages.has(row.brokerageId)) { conflicts++; return false; }
    transactions.set(identity, row);
    return true;
  });
  const restoredLoans = saved.rows.loans.filter(row => {
    const previous = loans.get(key(row.environment, row.loanNumber));
    if (previous) {
      if (!same(previous, row)) conflicts++;
      return false;
    }
    if (transactions.get(key(row.environment, row.transactionId))?.brokerageId !== row.brokerageId) {
      conflicts++;
      return false;
    }
    return true;
  });
  const changes: RepairResult = {
    staffRevocations: revocations.length, portalRevocations: restoredPortals.length,
    transactionRoutes: restoredTransactions.length, loanRoutes: restoredLoans.length,
  };
  const fingerprint = createHash("sha256").update(JSON.stringify([
    saved, current, [...brokerages], revocations, restoredPortals, restoredTransactions, restoredLoans, conflicts,
  ])).digest("hex");
  return { fingerprint, changes, conflicts, staffNeedsReview, revocations, restoredPortals, restoredTransactions, restoredLoans };
}

function plan(db: Store, evidence: Evidence, now: string) {
  const brokerages = new Map(db.prepare("SELECT id,pilot FROM brokerages ORDER BY id").all().map(row => [String(row.id), Boolean(row.pilot)]));
  return planDirectoryRepair(evidence, readDirectoryEvidenceRows(db), brokerages, now);
}

export function previewDirectoryRepair(db: Store, evidence: Evidence, now: string) {
  return db.transaction(() => {
    const { fingerprint, changes, conflicts, staffNeedsReview } = plan(db, evidence, now);
    return { fingerprint, changes, conflicts, staffNeedsReview };
  });
}

export function applyDirectoryRepair(db: Store, evidence: Evidence, intent: RepairIntent, now: string): RepairResult | null {
  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='directory_repair_receipts'").get()) {
      const prior = db.prepare("SELECT intent,result FROM directory_repair_receipts WHERE id=?").get(intent.id);
      if (prior) return prior.intent === JSON.stringify(intent) ? resultSchema.parse(JSON.parse(String(prior.result))) : null;
    }
    const review = plan(db, evidence, now);
    if (review.fingerprint !== intent.fingerprint || review.conflicts || !Object.values(review.changes).some(Boolean)) return null;
    const members = db.prepare("SELECT brokerageId,email FROM brokerage_members").all();
    const emails = new Map(members.map(row => [
      key(String(row.brokerageId), createHash("sha256").update(String(row.email)).digest("hex")), String(row.email),
    ]));
    const revoke = db.prepare("UPDATE brokerage_members SET status='Revoked',accessRevision=? WHERE brokerageId=? AND email=?");
    for (const row of review.revocations) {
      const email = emails.get(key(row.brokerageId, row.memberHash));
      if (!email) throw new Error("Staff evidence changed during repair.");
      revoke.run(row.accessRevision, row.brokerageId, email);
    }
    const portal = db.prepare(`INSERT INTO revoked_pilot_portals (brokerageId,tokenHash,expiresAt) VALUES (?,?,?)
      ON CONFLICT(brokerageId,tokenHash) DO UPDATE SET expiresAt=max(expiresAt,excluded.expiresAt)`);
    for (const row of review.restoredPortals) portal.run(row.brokerageId, row.tokenHash, row.expiresAt);
    const transaction = db.prepare("INSERT INTO uwm_transaction_routes (environment,transactionId,brokerageId,operationId) VALUES (?,?,?,?)");
    for (const row of review.restoredTransactions) transaction.run(row.environment, row.transactionId, row.brokerageId, row.operationId);
    const loan = db.prepare("INSERT INTO uwm_loan_routes (environment,loanNumber,brokerageId,transactionId) VALUES (?,?,?,?)");
    for (const row of review.restoredLoans) loan.run(row.environment, row.loanNumber, row.brokerageId, row.transactionId);
    db.exec("CREATE TABLE IF NOT EXISTS directory_repair_receipts (id TEXT PRIMARY KEY, intent TEXT NOT NULL, result TEXT NOT NULL)");
    db.prepare("INSERT INTO directory_repair_receipts VALUES (?,?,?)").run(intent.id, JSON.stringify(intent), JSON.stringify(review.changes));
    return review.changes;
  });
}

async function readSmall(bucket: R2Bucket, path: string) {
  const object = await bucket.get(path);
  if (!object) return null;
  if (object.size > 2048) {
    await object.body.cancel();
    throw new Error("Repair receipt exceeds its limit.");
  }
  return object.json<unknown>();
}

export async function loadRepairEvidence(bucket: R2Bucket, id: string, deployment: string) {
  const evidence = await readEvidence(bucket, `${directoryEvidencePrefix}${id}.json`);
  if (!evidence || evidence.id !== id || evidence.scope !== deployment || Date.now() - Date.parse(evidence.capturedAt) > 30 * 86400000)
    return null;
  return evidence;
}

export async function directoryRepairHttp(request: Request, bucket: R2Bucket | undefined, deployment: string,
  counts: () => Promise<DirectoryWorkCounts>, preview: (evidence: Evidence) => Promise<ReturnType<typeof previewDirectoryRepair>>,
  apply: (intent: RepairIntent) => Promise<RepairResult | null>) {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
  const problem = (status: number, error: string) => Response.json({ error }, { status, headers });
  const hidden = () => new Response(null, { status: 404, headers });
  if (!bucket || !["GET", "POST"].includes(request.method)) return hidden();
  try {
    const marker = await readDirectoryIncident(request, bucket, "repair");
    if (!marker) return hidden();
    const params = new URL(request.url).searchParams;
    const evidenceId = uuid.safeParse(params.get("id"));
    if (!evidenceId.success) return problem(400, "Supply a recovery evidence UUID.");
    const stable = async () => (await counts()).active === 0 && (await bucket.head(directoryPauseKey))?.version === marker.version;
    if (!await stable()) return problem(409, "Keep the current pause in place and wait for tracked work to drain.");
    const evidence = await loadRepairEvidence(bucket, evidenceId.data, deployment);
    if (!evidence) return problem(409, "The reviewed evidence is unavailable in this environment.");
    if (request.method === "GET") {
      const review = await preview(evidence);
      if (!await stable()) return problem(409, "The pause or active work changed during review.");
      return Response.json({ evidenceId: evidence.id, ...review }, { headers });
    }
    const intent = intentSchema.safeParse({
      id: params.get("requestId"), evidenceId: evidence.id, fingerprint: params.get("fingerprint"),
      markerVersion: marker.version, incident: marker.incident, deployment,
    });
    if (!intent.success || params.get("confirm") !== "repair") return problem(400, "Supply a reviewed fingerprint, request UUID and repair confirmation.");
    const path = directoryRepairPrefix + intent.data.id;
    const existing = await readSmall(bucket, path);
    if (existing && !same(intentSchema.parse(existing), intent.data)) return problem(409, "This request ID belongs to a different review.");
    if (!existing && !await bucket.put(path, JSON.stringify(intent.data), { onlyIf: { etagDoesNotMatch: "*" } }))
      return problem(409, "The review reservation changed. Retry with the same request ID.");
    const receipt = await readSmall(bucket, path + ".result");
    if (receipt) return Response.json({ requestId: intent.data.id, applied: resultSchema.parse(receipt), verifyComparison: true }, { headers });
    if (!await stable()) return problem(409, "The pause or active work changed before repair.");
    const result = await apply(intent.data);
    if (!result) return problem(409, "The review is stale, conflicting, or has no safe changes. Preview again.");
    await bucket.put(path + ".result", JSON.stringify(result), { onlyIf: { etagDoesNotMatch: "*" } });
    return Response.json({ requestId: intent.data.id, applied: result, verifyComparison: true }, { headers });
  } catch {
    return problem(503, "Directory repair outcome unavailable. Check the same request ID before retrying.");
  }
}

export async function readRepairIntent(bucket: R2Bucket, input: RepairIntent) {
  const intent = intentSchema.parse(input);
  const saved = intentSchema.parse(await readSmall(bucket, directoryRepairPrefix + intent.id));
  return same(intent, saved) ? saved : null;
}

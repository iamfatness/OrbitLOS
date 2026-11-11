import { createHash } from "node:crypto";
import { z } from "zod";
import { readDirectoryIncident, type DirectoryWorkCounts } from "./directory-drain";
import type { Evidence } from "./directory-evidence";
import { compareDirectoryMaintenanceEvidence, readDirectoryMaintenanceEvidence } from "./directory-maintenance-evidence";
import { loadRepairEvidence } from "./directory-repair";
import { directoryPauseKey } from "./directory-traffic-pause";
import type { Store } from "./store";
import { maintenanceState, pendingRecoveryReplay, pendingWorkspaceRestore, recordMaintenanceEvent } from "./workspace-maintenance";

export const directoryRecoveryHoldPath = "/api/ops/directory-recovery-hold";
export const directoryRecoveryHoldPrefix = "operations/directory-recovery/holds/";
const uuid = z.uuid().regex(/^[a-f0-9-]+$/);
const identity = { evidenceId: uuid, brokerageId: uuid };
const intentSchema = z.strictObject({
  ...identity, id: uuid, fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reference: z.string().regex(/^[a-zA-Z0-9_-]{4,80}$/),
  deployment: z.string().min(1).max(40), incident: z.string().min(1).max(80), markerVersion: z.string().min(1).max(128),
});
export type RecoveryHoldIntent = z.infer<typeof intentSchema>;
const resultSchema = z.strictObject({ revision: z.number().int().positive(), groups: z.array(z.string().max(32)).min(1).max(8) });
export type RecoveryHoldResult = z.infer<typeof resultSchema>;

function inspect(db: Store, evidence: Evidence, brokerageId: string) {
  const state = maintenanceState(db, brokerageId);
  const pilot = db.prepare("SELECT pilot FROM brokerages WHERE id=?").get(brokerageId)?.pilot === 1;
  const saved = evidence.version === 2 ? evidence.maintenance.filter(row => row.brokerageId === brokerageId) : undefined;
  const current = readDirectoryMaintenanceEvidence(db).filter(row => row.brokerageId === brokerageId);
  const { status, changes, pending } = compareDirectoryMaintenanceEvidence(saved, current);
  const fingerprint = createHash("sha256").update(JSON.stringify([evidence.id, brokerageId, pilot, state, saved, current])).digest("hex");
  return { fingerprint, canHold: pilot && status === "changed", mode: state.mode, status, changes, pending };
}

export function previewDirectoryRecoveryHold(db: Store, evidence: Evidence, brokerageId: string) {
  return db.transaction(() => inspect(db, evidence, brokerageId));
}

export function directoryRecoveryHoldRecorded(db: Store, intent: RecoveryHoldIntent, result: RecoveryHoldResult) {
  const state = maintenanceState(db, intent.brokerageId);
  if (state.mode !== "Paused" || state.revision < result.revision) return false;
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='directory_recovery_hold_receipts'").get()) return false;
  const prior = db.prepare("SELECT intent,result FROM directory_recovery_hold_receipts WHERE id=?").get(intent.id);
  return prior?.intent === JSON.stringify(intent) && prior.result === JSON.stringify(result);
}

export function applyDirectoryRecoveryHold(db: Store, evidence: Evidence, intent: RecoveryHoldIntent, fenceRevision: number, now: string) {
  return db.transaction(() => {
    db.exec("CREATE TABLE IF NOT EXISTS directory_recovery_hold_receipts (id TEXT PRIMARY KEY, intent TEXT NOT NULL, result TEXT NOT NULL)");
    const prior = db.prepare("SELECT result FROM directory_recovery_hold_receipts WHERE id=?").get(intent.id);
    if (prior) {
      const result = resultSchema.parse(JSON.parse(String(prior.result)));
      return directoryRecoveryHoldRecorded(db, intent, result) ? result : null;
    }
    if (evidence.id !== intent.evidenceId || evidence.scope !== intent.deployment) return null;
    const review = inspect(db, evidence, intent.brokerageId);
    if (!review.canHold || review.fingerprint !== intent.fingerprint) return null;
    const id = intent.brokerageId;
    const state = maintenanceState(db, id);
    const preserveCycle = state.mode !== "Open" || pendingRecoveryReplay(db, id) || pendingWorkspaceRestore(db, id);
    const reason = `Shared directory recovery ${intent.reference}. Reconcile the affected work and record a new reopening review.`;
    const result = { revision: Math.max(state.revision, fenceRevision) + 1, groups: review.changes.map(row => row.group) };
    recordMaintenanceEvent(db, id, {
      ...state, mode: "Paused", revision: result.revision, reason,
      startedAt: (preserveCycle ? state.startedAt : null) ?? now,
      startedBy: (preserveCycle ? state.startedBy : null) ?? "Orbit recovery",
      reviewedAt: null, reviewedBy: null, review: "", checks: [false, false, false],
    }, "Held after directory recovery", "Orbit recovery", `${reason} Review: ${result.groups.join(", ")}.`, now);
    db.prepare("INSERT INTO directory_recovery_hold_receipts VALUES (?,?,?)").run(intent.id, JSON.stringify(intent), JSON.stringify(result));
    return result;
  });
}

async function readSmall(bucket: R2Bucket, path: string) {
  const object = await bucket.get(path);
  if (!object) return null;
  if (object.size > 2048) {
    await object.body.cancel();
    throw new Error("Recovery hold receipt exceeds its limit.");
  }
  return object.json<unknown>();
}

export async function readDirectoryRecoveryHoldIntent(bucket: R2Bucket, input: RecoveryHoldIntent) {
  const intent = intentSchema.parse(input);
  const saved = intentSchema.safeParse(await readSmall(bucket, directoryRecoveryHoldPrefix + intent.id));
  return saved.success && JSON.stringify(saved.data) === JSON.stringify(intent) ? intent : null;
}

export async function directoryRecoveryHoldHttp(request: Request, bucket: R2Bucket | undefined, deployment: string,
  counts: () => Promise<DirectoryWorkCounts>,
  preview: (evidence: Evidence, brokerageId: string) => Promise<ReturnType<typeof previewDirectoryRecoveryHold>>,
  commit: (intent: RecoveryHoldIntent, receipt: RecoveryHoldResult | null) => Promise<RecoveryHoldResult | null>) {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
  const hidden = () => new Response(null, { status: 404, headers });
  const problem = (status: number, error: string) => Response.json({ error }, { status, headers });
  if (!bucket || !["GET", "POST"].includes(request.method)) return hidden();
  try {
    const marker = await readDirectoryIncident(request, bucket, "hold");
    if (!marker) return hidden();
    const params = new URL(request.url).searchParams;
    const selection = z.object(identity).safeParse({ evidenceId: params.get("id"), brokerageId: params.get("brokerage") });
    if (!selection.success) return problem(400, "Supply the recovery evidence and affected brokerage UUIDs.");
    const { evidenceId, brokerageId } = selection.data;
    const stable = async () => (await counts()).active === 0 && (await bucket.head(directoryPauseKey))?.version === marker.version;
    if (!await stable()) return problem(409, "Keep the shared pause active and wait for tracked work to drain.");
    const evidence = await loadRepairEvidence(bucket, evidenceId, deployment);
    if (!evidence) return problem(409, "The reviewed evidence is unavailable in this environment.");
    if (request.method === "GET") {
      const review = await preview(evidence, brokerageId);
      if (!await stable()) return problem(409, "The pause or active work changed during review.");
      return Response.json({ evidenceId, brokerageId, ...review }, { headers });
    }
    const intent = intentSchema.safeParse({
      ...selection.data, id: params.get("requestId"), fingerprint: params.get("fingerprint"), reference: params.get("reference"),
      deployment, incident: marker.incident, markerVersion: marker.version,
    });
    if (!intent.success || params.get("confirm") !== "hold-for-review")
      return problem(400, "Supply the reviewed fingerprint, request UUID, incident reference and hold confirmation.");
    const path = directoryRecoveryHoldPrefix + intent.data.id;
    const existing = await readSmall(bucket, path);
    if (existing && !await readDirectoryRecoveryHoldIntent(bucket, intent.data))
      return problem(409, "This request UUID belongs to another review.");
    if (!existing && !await bucket.put(path, JSON.stringify(intent.data), { onlyIf: { etagDoesNotMatch: "*" } }))
      return problem(409, "The reservation changed. Retry with the same request UUID.");
    const prior = await readSmall(bucket, path + ".result");
    const result = await commit(intent.data, prior ? resultSchema.parse(prior) : null);
    if (!result) return problem(409, "The review changed or the recorded hold is no longer active. Preview again.");
    if (!await stable()) return problem(409, "The pause or active work changed during the hold. Verify before reopening.");
    if (!prior) await bucket.put(path + ".result", JSON.stringify(result), { onlyIf: { etagDoesNotMatch: "*" } });
    return Response.json({ requestId: intent.data.id, brokerageId, disposition: "Held for brokerage review", ...result }, { headers });
  } catch {
    return problem(503, "Recovery hold outcome unavailable. Verify with the same request UUID before reopening.");
  }
}

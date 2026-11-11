import { createHash } from "node:crypto";
import { z } from "zod";
import { readDirectoryIncident, type DirectoryWorkCounts } from "./directory-drain";
import { directoryPauseKey } from "./directory-traffic-pause";
import type { Store } from "./store";

export const directoryEvidencePath = "/api/ops/directory-evidence";
const maxRows = 5000;
const maxBytes = 4 * 1024 * 1024;
const maxAge = 30 * 86400000;
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.uuid().regex(/^[a-f0-9-]+$/);
const environment = z.enum(["int", "stage", "production"]);
const scope = z.string().regex(/^[a-z0-9-]{1,40}$/);
const routeValue = z.string().min(1).max(200);
const projectedRows = z.strictObject({
  staff: z.array(z.strictObject({
    brokerageId: z.string().max(40), memberHash: hex, role: z.enum(["Admin", "LO", "Processor"]),
    status: z.enum(["Invited", "Active", "Revoked"]), accessRevision: z.number().int().nonnegative(),
    bootstrap: z.number().int().min(0).max(1),
  })).max(maxRows),
  portals: z.array(z.strictObject({
    brokerageId: z.string().max(40), tokenHash: hex, expiresAt: z.iso.datetime(),
  })).max(maxRows),
  transactions: z.array(z.strictObject({
    environment, transactionId: routeValue, brokerageId: id, operationId: id,
  })).max(maxRows),
  loans: z.array(z.strictObject({
    environment, loanNumber: routeValue, brokerageId: id, transactionId: routeValue,
  })).max(maxRows),
});
export type EvidenceRows = z.infer<typeof projectedRows>;
const evidenceSchema = z.strictObject({
  version: z.literal(1), id, scope, capturedAt: z.iso.datetime(), incident: z.string().max(80), rows: projectedRows,
});
export type Evidence = z.infer<typeof evidenceSchema>;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const directoryEvidencePrefix = "operations/directory-recovery/evidence/";

export function captureDirectoryEvidence(db: Store): EvidenceRows {
  return db.transaction(() => readDirectoryEvidenceRows(db));
}

export function readDirectoryEvidenceRows(db: Store): EvidenceRows {
    const bounded = (query: string) => db.prepare(`${query} LIMIT ?`).all(maxRows + 1);
    const staff = bounded("SELECT brokerageId,email,role,status,accessRevision,bootstrap FROM brokerage_members ORDER BY brokerageId,email")
      .map(({ email, ...row }) => ({ ...row, memberHash: digest(String(email)) }));
    return projectedRows.parse({
      staff,
      portals: bounded("SELECT brokerageId,tokenHash,expiresAt FROM revoked_pilot_portals ORDER BY brokerageId,tokenHash"),
      transactions: bounded("SELECT environment,transactionId,brokerageId,operationId FROM uwm_transaction_routes ORDER BY environment,transactionId"),
      loans: bounded("SELECT environment,loanNumber,brokerageId,transactionId FROM uwm_loan_routes ORDER BY environment,loanNumber"),
    });
}

function compareEvidence(before: EvidenceRows, current: EvidenceRows, now: string) {
  const normalized = (rows: EvidenceRows) => ({
    ...rows, portals: rows.portals.filter(row => row.expiresAt > now),
  });
  const a = normalized(before);
  const b = normalized(current);
  return (["staff", "portals", "transactions", "loans"] as const).map(group => ({
    group, saved: a[group].length, current: b[group].length,
    changed: JSON.stringify(a[group]) !== JSON.stringify(b[group]),
  }));
}

export async function readEvidence(bucket: R2Bucket, key: string) {
  const object = await bucket.get(key);
  if (!object) return null;
  if (object.size > maxBytes) {
    await object.body.cancel();
    throw new Error("Evidence exceeds the inspection limit.");
  }
  const text = await object.text();
  if (object.customMetadata?.sha256 !== digest(text)) throw new Error("Evidence checksum differs.");
  return evidenceSchema.parse(JSON.parse(text));
}

export async function directoryEvidenceHttp(request: Request, bucket: R2Bucket | undefined, deployment: string,
  counts: () => Promise<DirectoryWorkCounts>, capture: () => Promise<EvidenceRows>) {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
  const problem = (status: number, error: string) => Response.json({ error }, { status, headers });
  const hidden = () => new Response(null, { status: 404, headers });
  if (!bucket || !["GET", "POST"].includes(request.method)) return hidden();
  try {
    const marker = await readDirectoryIncident(request, bucket, "evidence");
    if (!marker) return hidden();
    const evidenceId = id.safeParse(new URL(request.url).searchParams.get("id"));
    if (!evidenceId.success) return problem(400, "Supply a recovery evidence UUID.");
    if (!scope.safeParse(deployment).success) return problem(503, "Recovery evidence scope is unavailable.");
    const key = `${directoryEvidencePrefix}${evidenceId.data}.json`;
    const stable = async () => (await counts()).active === 0 &&
      (await bucket.head(directoryPauseKey))?.version === marker.version;
    if (!await stable()) return problem(409, "Keep the current pause in place and wait for tracked work to drain.");
    const saved = await readEvidence(bucket, key);
    const usable = (item: Evidence) => item.scope === deployment && item.id === evidenceId.data &&
      Date.now() - Date.parse(item.capturedAt) <= maxAge;
    const summary = (item: Evidence) => ({
      id: item.id, capturedAt: item.capturedAt, incident: item.incident,
      counts: Object.fromEntries(Object.entries(item.rows).map(([group, rows]) => [group, rows.length])),
    });
    if (saved && !usable(saved)) return problem(409, "Evidence is outside this environment or its review window.");
    if (request.method === "GET") {
      if (!saved) return hidden();
      const current = await capture();
      if (!await stable()) return problem(409, "The pause or active work changed during the comparison.");
      const groups = compareEvidence(saved.rows, current, new Date().toISOString());
      return Response.json({ evidence: summary(saved), groups, matches: groups.every(group => !group.changed) }, { headers });
    }
    if (saved) {
      if (saved.incident !== marker.incident) return problem(409, "This evidence ID belongs to a different incident.");
      return Response.json({ evidence: summary(saved) }, { headers });
    }
    const item: Evidence = { version: 1, id: evidenceId.data, scope: deployment, incident: marker.incident,
      capturedAt: new Date().toISOString(), rows: await capture() };
    if (!await stable()) return problem(409, "The pause or active work changed during capture.");
    const body = JSON.stringify(item);
    if (Buffer.byteLength(body) > maxBytes) return problem(409, "Evidence exceeds the capture limit.");
    const object = await bucket.put(key, body, {
      onlyIf: { etagDoesNotMatch: "*" }, customMetadata: { sha256: digest(body) },
      httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    });
    if (!object) return problem(409, "Evidence already exists. Retry with the same ID to read the saved capture.");
    return Response.json({ evidence: summary(item) }, { status: 201, headers });
  } catch {
    return problem(503, "Directory evidence could not be verified.");
  }
}

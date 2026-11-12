import { createHash } from "node:crypto";
import { z } from "zod";
import { readDirectoryIncident, type DirectoryWorkCounts } from "./directory-drain";
import { directoryPauseKey } from "./directory-traffic-pause";
import type { Store } from "./store";

export const directorySignInResetPath = "/api/ops/directory-sign-in-reset";
export const directorySignInResetPrefix = "operations/directory-recovery/sign-in-reset/";
const uuid = z.uuid().regex(/^[a-f0-9-]+$/);
const intentSchema = z.strictObject({
  id: uuid, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), incident: z.string().max(80),
  markerVersion: z.string().min(1).max(128), deployment: z.string().max(40),
});
export type SignInResetIntent = z.infer<typeof intentSchema>;
const resultSchema = z.strictObject({
  sessions: z.number().int().nonnegative(), attempts: z.number().int().nonnegative(),
});
export type SignInResetResult = z.infer<typeof resultSchema>;

function inspect(db: Store) {
  // Hash bounded pages of the reviewed state. Never return session or OAuth
  // values through the operator interface or its receipts.
  const fingerprint = createHash("sha256");
  const read = (table: "staff_sessions" | "staff_google_attempts" | "staff_email_codes", order: "tokenHash" | "state" | "email") => {
    fingerprint.update(table);
    const first = db.prepare(`SELECT * FROM ${table} ORDER BY ${order} LIMIT 100`);
    const next = db.prepare(`SELECT * FROM ${table} WHERE ${order} > ? ORDER BY ${order} LIMIT 100`);
    let cursor: string | null = null;
    let count = 0;
    while (true) {
      const rows: Record<string, unknown>[] = cursor === null ? first.all() : next.all(cursor);
      for (const row of rows) fingerprint.update(JSON.stringify(row)).update("\n");
      count += rows.length;
      if (rows.length < 100) return count;
      cursor = String(rows.at(-1)![order]);
    }
  };
  const sessions = read("staff_sessions", "tokenHash");
  const attempts = read("staff_google_attempts", "state") + read("staff_email_codes", "email");
  return { sessions, attempts, fingerprint: fingerprint.digest("hex") };
}

export function previewDirectorySignInReset(db: Store) {
  return db.transaction(() => inspect(db));
}

export function commitDirectorySignInReset(db: Store, intent: SignInResetIntent): SignInResetResult | null {
  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='directory_sign_in_reset_receipts'").get()) {
      const prior = db.prepare("SELECT intent,result FROM directory_sign_in_reset_receipts WHERE id=?").get(intent.id);
      if (prior) return prior.intent === JSON.stringify(intent) ? resultSchema.parse(JSON.parse(String(prior.result))) : null;
    }
    const { fingerprint, ...result } = inspect(db);
    if (fingerprint !== intent.fingerprint) return null;
    db.exec("DELETE FROM staff_sessions; DELETE FROM staff_google_attempts; DELETE FROM staff_email_codes;");
    db.exec("CREATE TABLE IF NOT EXISTS directory_sign_in_reset_receipts (id TEXT PRIMARY KEY, intent TEXT NOT NULL, result TEXT NOT NULL)");
    db.prepare("INSERT INTO directory_sign_in_reset_receipts VALUES (?,?,?)").run(intent.id, JSON.stringify(intent), JSON.stringify(result));
    return result;
  });
}

async function readReceipt(bucket: R2Bucket, path: string) {
  const object = await bucket.get(path);
  if (!object) return null;
  if (object.size > 2048) {
    await object.body.cancel();
    throw new Error("Sign-in reset receipt exceeds its limit.");
  }
  return object.json<unknown>();
}

export async function readDirectorySignInResetIntent(bucket: R2Bucket, input: SignInResetIntent) {
  const intent = intentSchema.parse(input);
  const saved = intentSchema.safeParse(await readReceipt(bucket, directorySignInResetPrefix + intent.id));
  return saved.success && JSON.stringify(saved.data) === JSON.stringify(intent) ? intent : null;
}

export async function directorySignInResetHttp(request: Request, bucket: R2Bucket | undefined, deployment: string,
  counts: () => Promise<DirectoryWorkCounts>, preview: () => Promise<ReturnType<typeof previewDirectorySignInReset>>,
  commit: (intent: SignInResetIntent) => Promise<SignInResetResult | null>) {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
  const problem = (status: number, error: string) => Response.json({ error }, { status, headers });
  const hidden = () => new Response(null, { status: 404, headers });
  if (!bucket || !["GET", "POST"].includes(request.method)) return hidden();
  try {
    const marker = await readDirectoryIncident(request, bucket, "sign-in-reset");
    if (!marker) return hidden();
    const stable = async () => (await counts()).active === 0 && (await bucket.head(directoryPauseKey))?.version === marker.version;
    if (!await stable()) return problem(409, "Keep the current pause in place and wait for tracked work to drain.");
    if (request.method === "GET") {
      const review = await preview();
      if (!await stable()) return problem(409, "The pause or active work changed during review.");
      return Response.json(review, { headers });
    }
    const params = new URL(request.url).searchParams;
    const intent = intentSchema.safeParse({
      id: params.get("requestId"), fingerprint: params.get("fingerprint"),
      markerVersion: marker.version, incident: marker.incident, deployment,
    });
    if (!intent.success || params.get("confirm") !== "sign-out-all-staff")
      return problem(400, "Supply the reviewed fingerprint, a request UUID and sign-out confirmation.");
    const path = directorySignInResetPrefix + intent.data.id;
    const existing = await readReceipt(bucket, path);
    if (existing && !await readDirectorySignInResetIntent(bucket, intent.data)) return problem(409, "This request ID belongs to another review.");
    if (!existing && !await bucket.put(path, JSON.stringify(intent.data), { onlyIf: { etagDoesNotMatch: "*" } }))
      return problem(409, "The review reservation changed. Retry with the same request ID.");
    const result = await readReceipt(bucket, path + ".result");
    if (result) return Response.json({ requestId: intent.data.id, invalidated: resultSchema.parse(result) }, { headers });
    if (!await stable()) return problem(409, "The pause or active work changed before sign-out.");
    const applied = await commit(intent.data);
    if (!applied) return problem(409, "The reviewed sign-in state changed. Preview again.");
    await bucket.put(path + ".result", JSON.stringify(applied), { onlyIf: { etagDoesNotMatch: "*" } });
    return Response.json({ requestId: intent.data.id, invalidated: applied }, { headers });
  } catch {
    return problem(503, "Sign-in reset outcome unavailable. Check the same request ID before retrying.");
  }
}

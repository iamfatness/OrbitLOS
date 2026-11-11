import { uwmUladLoanNumber } from "./uwm-xml";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Store } from "./store";

const identifier = z.string().trim().min(1).max(200);
const environmentSchema = z.enum(["int", "stage", "production"]);
const kindSchema = z.enum(["import", "status", "conditions", "ulad"]);
export type UwmWebhookEnvironment = z.infer<typeof environmentSchema>;
export type UwmWebhookKind = z.infer<typeof kindSchema>;
const connectionSchema = z.object({ brokerageId: z.uuid(), token: z.string().min(32).max(256),
  previousToken: z.string().min(32).max(256).optional() });
const configSchema = z.object({ int: connectionSchema.optional(), stage: connectionSchema.optional(), production: connectionSchema.optional() })
  .superRefine((value, ctx) => {
    const connections = Object.values(value);
    if (new Set(connections.map((item) => item.brokerageId)).size !== connections.length) {
      ctx.addIssue({ code: "custom", message: "Each UWM environment requires a separate workspace." });
    }
    const tokens = connections.flatMap((item) => [item.token, ...(item.previousToken ? [item.previousToken] : [])]);
    if (new Set(tokens).size !== tokens.length) ctx.addIssue({ code: "custom", message: "Use distinct webhook tokens." });
  });
export function uwmWebhookConnection(config: string, environment: UwmWebhookEnvironment) {
  try { return configSchema.parse(JSON.parse(config))[environment] ?? null; } catch { return null; }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function uwmWebhookAuthorized(header: string | null, connection: z.infer<typeof connectionSchema>) {
  if (!header || header.length > 300) return false;
  const actual = Buffer.from(hash(header), "hex");
  const current = timingSafeEqual(actual, Buffer.from(hash(connection.token), "hex"));
  const previous = timingSafeEqual(actual, Buffer.from(hash(connection.previousToken ?? connection.token), "hex"));
  return current || previous;
}
const importSchema = z.object({ TransactionId: identifier, LoanNumber: identifier.nullable(), LoanStatus: identifier.nullable(),
  Message: z.string().max(16000).nullable().optional(), LogDateTime: z.string().min(1).max(100),
}).passthrough().refine((value) => value.LoanStatus !== "Completed" || value.LoanNumber !== null);
const statusSchema = z.object({ id: identifier, type: z.enum(["com.uwm.ImportantDate", "com.uwm.LoanStatus"]),
  source: z.literal("urn:uwm-com:webhooks"), data: z.object({ key: identifier, value: z.string().max(500) }).passthrough(),
}).passthrough();
const conditionSchema = z.object({ id: identifier, category: z.string().max(500), bucketKey: z.string().max(200),
  conditionDescription: z.string().max(16000), conditionSatisfactionDate: z.string().max(100).nullable(),
  loanNumber: identifier, loanStatus: identifier }).passthrough();
export type UwmWebhookEvent = { environment: UwmWebhookEnvironment; kind: UwmWebhookKind; body: string;
  digest: string; eventKey: string; transactionId: string | null; loanNumber: string | null };
export function parseUwmWebhook(environment: UwmWebhookEnvironment, kind: UwmWebhookKind, body: string): UwmWebhookEvent {
  let eventKey = hash(body), transactionId: string | null = null, loanNumber: string | null = null;
  if (kind === "ulad") {
    // Preserve the exact export; recognize only the lender identifier evidenced
    // by UWM's sample. This never applies XML fields to a borrower application.
    loanNumber = uwmUladLoanNumber(body);
  } else {
    const input: unknown = JSON.parse(body);
    if (kind === "import") {
      const value = importSchema.parse(input);
      transactionId = value.TransactionId;
      loanNumber = value.LoanNumber;
      eventKey = hash(JSON.stringify(value));
    } else if (kind === "status") {
      const value = statusSchema.parse(input);
      eventKey = value.id;
      // UWM confirmed a loan number is included (2026-11-10), but its exact
      // location/type is awaiting a sample. Preserve it in the original body.
    } else {
      const value = conditionSchema.parse(input);
      loanNumber = value.loanNumber;
      // A condition ID recurs across updates: it is NOT a delivery identifier.
      eventKey = hash(JSON.stringify(value));
    }
  }
  return { environment, kind, body, digest: hash(body), eventKey, transactionId, loanNumber };
}
export function initializeUwmWebhooks(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS uwm_webhook_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, environment TEXT NOT NULL, kind TEXT NOT NULL,
    eventKey TEXT NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL,
    transactionId TEXT, loanNumber TEXT, receivedAt TEXT NOT NULL,
    UNIQUE(environment, kind, eventKey, digest)
  );
  CREATE INDEX IF NOT EXISTS uwm_webhook_transaction ON uwm_webhook_receipts(environment, transactionId);
  CREATE INDEX IF NOT EXISTS uwm_webhook_event ON uwm_webhook_receipts(environment, kind, eventKey);`);
}
export function saveUwmWebhook(db: Store, event: UwmWebhookEvent, now = new Date().toISOString()) {
  return db.transaction(() => {
    const prior = db.prepare(`SELECT id FROM uwm_webhook_receipts WHERE environment = ? AND kind = ? AND eventKey = ? AND digest = ?`)
      .get(event.environment, event.kind, event.eventKey, event.digest);
    if (prior) return { receiptId: prior.id, duplicate: true };
    // Retain conflicting deliveries too; neither delivery silently overwrites the other.
    db.prepare(`INSERT INTO uwm_webhook_receipts(environment,kind,eventKey,digest,body,transactionId,loanNumber,receivedAt)
      VALUES(?,?,?,?,?,?,?,?)`).run(event.environment, event.kind, event.eventKey, event.digest, event.body, event.transactionId, event.loanNumber, now);
    return { receiptId: db.prepare("SELECT last_insert_rowid() AS id").get()!.id, duplicate: false };
  });
}
export function readUwmWebhookReceipts(db: Store, before: number) {
  return db.prepare(`SELECT id, environment, kind, transactionId, loanNumber, receivedAt,
    'Awaiting reconciliation' AS status FROM uwm_webhook_receipts WHERE id < ? ORDER BY id DESC LIMIT 50`).all(before);
}
export const uwmWebhookMaxBytes = 1024 * 1024;
const reply = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function uwmWebhookHttp(request: Request, config: string,
  persist: (brokerageId: string, event: UwmWebhookEvent) => Promise<unknown>, deployment = "") {
  const match = /^\/api\/webhooks\/uwm\/(int|stage|production)\/(import|status|conditions|ulad)$/.exec(new URL(request.url).pathname);
  if (!match) return reply(404, { error: "Unknown webhook" });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  const environment = environmentSchema.parse(match[1]), kind = kindSchema.parse(match[2]);
  if (deployment && ({ dev: "int", stage: "stage", production: "production" } as Record<string, string>)[deployment] !== environment) {
    return reply(404, { error: "Webhook environment does not belong to this deployment" });
  }
  const connection = uwmWebhookConnection(config, environment);
  if (!connection) return reply(503, { error: "Webhook is not configured" });
  if (!uwmWebhookAuthorized(request.headers.get("X-API-Key"), connection)) return reply(401, { error: "Unauthorized" });
  const contentType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (!(kind === "ulad" ? ["application/xml", "text/xml"].includes(contentType ?? "") : contentType === "application/json") ||
    (request.headers.has("Content-Encoding") && request.headers.get("Content-Encoding") !== "identity")) return reply(415, { error: "Unsupported content type or encoding" });
  if (Number(request.headers.get("Content-Length")) > uwmWebhookMaxBytes) return reply(413, { error: "Payload too large" });
  const reader = request.body?.getReader();
  if (!reader) return reply(400, { error: "Missing payload" });
  let body = "", size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let event: UwmWebhookEvent;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > uwmWebhookMaxBytes) { await reader.cancel(); return reply(413, { error: "Payload too large" }); }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    event = parseUwmWebhook(environment, kind, body);
  } catch { return reply(400, { error: "Invalid webhook payload" }); }
  finally { reader.releaseLock(); }
  try {
    const receipt = await persist(connection.brokerageId, event);
    return reply(200, { received: true, receipt });
  } catch { return reply(503, { error: "Receipt could not be saved; retry delivery" }); }
}

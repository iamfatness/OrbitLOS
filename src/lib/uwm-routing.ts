import { z } from "zod";
import type { Store } from "./store";
import type { UwmWebhookEvent } from "./uwm-webhooks";
const routeInput = z.strictObject({environment:z.enum(["int","stage","production"]),transactionId:z.string().min(1).max(200),brokerageId:z.uuid(),operationId:z.uuid()});
export function initializeUwmRouting(db:Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS uwm_transaction_routes(environment TEXT NOT NULL,transactionId TEXT NOT NULL,brokerageId TEXT NOT NULL,operationId TEXT NOT NULL,PRIMARY KEY(environment,transactionId));
    CREATE TABLE IF NOT EXISTS uwm_loan_routes(environment TEXT NOT NULL,loanNumber TEXT NOT NULL,brokerageId TEXT NOT NULL,transactionId TEXT NOT NULL,PRIMARY KEY(environment,loanNumber));
    CREATE INDEX IF NOT EXISTS uwm_loan_route_transaction ON uwm_loan_routes(environment,transactionId);`);
}
export function registerUwmRoute(db:Store,raw:unknown) {
  const input=routeInput.parse(raw);
  db.transaction(()=>{
    const prior=db.prepare("SELECT brokerageId,operationId FROM uwm_transaction_routes WHERE environment=? AND transactionId=?").get(input.environment,input.transactionId);
    if(prior && (prior.brokerageId!==input.brokerageId || prior.operationId!==input.operationId))throw new Error("UWM transaction is already assigned to another file.");
    db.prepare("INSERT OR IGNORE INTO uwm_transaction_routes VALUES(?,?,?,?)").run(input.environment,input.transactionId,input.brokerageId,input.operationId);
  });
}
export type UwmWebhookRoute = { brokerageId: string; operationId: string; transactionId: string };
export type UwmWebhookRouteKey = Pick<UwmWebhookEvent, "kind" | "environment" | "transactionId" | "loanNumber">;
export function uwmWebhookRouteKey({ kind, environment, transactionId, loanNumber }: UwmWebhookEvent): UwmWebhookRouteKey {
  return { kind, environment, transactionId, loanNumber };
}
export function findUwmWebhookRoute(db: Store, event: UwmWebhookRouteKey): UwmWebhookRoute | null {
  const row = event.kind === "import" && event.transactionId
    ? db.prepare("SELECT brokerageId,operationId,transactionId FROM uwm_transaction_routes WHERE environment=? AND transactionId=?")
      .get(event.environment, event.transactionId)
    : (event.kind === "conditions" || event.kind === "ulad") && event.loanNumber
      ? db.prepare(`SELECT tx.brokerageId,tx.operationId,tx.transactionId FROM uwm_loan_routes loan
          JOIN uwm_transaction_routes tx USING(environment,transactionId,brokerageId)
          WHERE loan.environment=? AND loan.loanNumber=?`).get(event.environment, event.loanNumber) : null;
  return row ? { brokerageId: String(row.brokerageId), operationId: String(row.operationId), transactionId: String(row.transactionId) } : null;
}
function reserveUwmLoanRoute(db: Store, event: UwmWebhookEvent, route: UwmWebhookRoute) {
  const current = findUwmWebhookRoute(db, event);
  if (!current || current.brokerageId !== route.brokerageId || current.operationId !== route.operationId) {
    throw new Error("UWM transaction route is unavailable.");
  }
  db.transaction(() => {
    const existing = db.prepare("SELECT brokerageId,transactionId FROM uwm_loan_routes WHERE environment=? AND loanNumber=?")
      .get(event.environment, event.loanNumber);
    if (existing?.brokerageId === route.brokerageId && existing.transactionId === route.transactionId) return;
    const priorNumber = db.prepare("SELECT 1 FROM uwm_loan_routes WHERE environment=? AND transactionId=? LIMIT 1")
      .get(event.environment, route.transactionId);
    if (existing || priorNumber) throw new Error("UWM loan number conflicts with an existing import route.");
    db.prepare("INSERT INTO uwm_loan_routes VALUES(?,?,?,?)")
      .run(event.environment, event.loanNumber, route.brokerageId, route.transactionId);
  });
}

export async function deliverUwmWebhook(db: Store, event: UwmWebhookEvent, fallback: string, delivery: {
  persist(workspace: string, event: UwmWebhookEvent): Promise<{ receiptId: number; duplicate: boolean; claimLoanNumber: boolean }>;
  verify(route: UwmWebhookRoute, event: UwmWebhookRouteKey): Promise<boolean>;
  complete(route: UwmWebhookRoute, event: UwmWebhookEvent, receiptId: number): Promise<void>;
}) {
  const route = findUwmWebhookRoute(db, event);
  const target = route && (event.kind === "import" || await delivery.verify(route, uwmWebhookRouteKey(event))) ? route.brokerageId : fallback;
  const receipt = await delivery.persist(target, event);
  if (route && receipt.claimLoanNumber && event.kind === "import" && event.loanNumber) {
    // Reserve before completing in the tenant. The reservation is only usable
    // for downstream routing once the tenant can prove the exact completion.
    reserveUwmLoanRoute(db, event, route);
    await delivery.complete(route, event, receipt.receiptId);
  }
  return receipt;
}

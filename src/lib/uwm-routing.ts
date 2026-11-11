import { z } from "zod";
import type { Store } from "./store";
import type { UwmWebhookEvent } from "./uwm-webhooks";
const routeInput = z.strictObject({environment:z.enum(["int","stage","production"]),transactionId:z.string().min(1).max(200),brokerageId:z.uuid(),operationId:z.uuid()});
export function initializeUwmRouting(db:Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS uwm_transaction_routes(environment TEXT NOT NULL,transactionId TEXT NOT NULL,brokerageId TEXT NOT NULL,operationId TEXT NOT NULL,PRIMARY KEY(environment,transactionId));
    CREATE TABLE IF NOT EXISTS uwm_loan_routes(environment TEXT NOT NULL,loanNumber TEXT NOT NULL,brokerageId TEXT NOT NULL,transactionId TEXT NOT NULL,PRIMARY KEY(environment,loanNumber));`);
}
export function registerUwmRoute(db:Store,raw:unknown) {
  const input=routeInput.parse(raw);
  db.transaction(()=>{
    const prior=db.prepare("SELECT brokerageId,operationId FROM uwm_transaction_routes WHERE environment=? AND transactionId=?").get(input.environment,input.transactionId);
    if(prior && (prior.brokerageId!==input.brokerageId || prior.operationId!==input.operationId))throw new Error("UWM transaction is already assigned to another file.");
    db.prepare("INSERT OR IGNORE INTO uwm_transaction_routes VALUES(?,?,?,?)").run(input.environment,input.transactionId,input.brokerageId,input.operationId);
  });
}
export function routedUwmWorkspace(db:Store,event:UwmWebhookEvent):string|null {
  const row=event.kind==="import" && event.transactionId
    ? db.prepare("SELECT brokerageId FROM uwm_transaction_routes WHERE environment=? AND transactionId=?").get(event.environment,event.transactionId)
    : (event.kind==="conditions" || event.kind==="ulad") && event.loanNumber
      ? db.prepare("SELECT brokerageId FROM uwm_loan_routes WHERE environment=? AND loanNumber=?").get(event.environment,event.loanNumber) : null;
  return row ? String(row.brokerageId) : null;
}
// Only an authenticated UWM completion for a registered transaction creates this mapping.
export function bindUwmLoanRoute(db:Store,event:UwmWebhookEvent,brokerageId:string) {
  if(event.kind!=="import" || !event.transactionId || !event.loanNumber || JSON.parse(event.body).LoanStatus!=="Completed")return;
  if(routedUwmWorkspace(db,event)!==brokerageId)throw new Error("UWM transaction route is unavailable.");
  db.transaction(()=>{
    const prior=db.prepare("SELECT brokerageId,transactionId FROM uwm_loan_routes WHERE environment=? AND loanNumber=?").get(event.environment,event.loanNumber);
    if(prior && (prior.brokerageId!==brokerageId || prior.transactionId!==event.transactionId))throw new Error("UWM loan is already assigned to another import.");
    db.prepare("INSERT OR IGNORE INTO uwm_loan_routes VALUES(?,?,?,?)").run(event.environment,event.loanNumber,brokerageId,event.transactionId);
  });
}


export async function deliverUwmWebhook<T>(db:Store,event:UwmWebhookEvent,fallback:string,persist:(workspace:string,event:UwmWebhookEvent)=>Promise<T>) {
  const registered=routedUwmWorkspace(db,event),target=registered ?? fallback;
  // Reserve synchronously before crossing into a tenant. Retain the route on
  // delivery failure so UWM retries can only reach the same owning workspace.
  if(registered)bindUwmLoanRoute(db,event,target);
  return await persist(target,event);
}

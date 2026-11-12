import { createHash } from "node:crypto";
import { z } from "zod";
import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import { loanAccess } from "./workspace-access";
import { UwmError } from "./uwm-live";
import { UwmRequestError } from "./uwm-public-client";

export const uwmOperationInput = z.object({ id: z.uuid(), loanId: z.uuid(), applicationRevision: z.number().int().positive(),
  environment: z.enum(["int", "stage", "production"]),
  kind: z.enum(["import", "condition-delivery", "float", "lock", "relock", "extend-lock", "cancel-lock"]),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/) });
export type UwmOperationInput = z.infer<typeof uwmOperationInput>;
export function initializeUwmOperations(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS uwm_operations (
    id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id), applicationRevision INTEGER NOT NULL,
    environment TEXT NOT NULL, kind TEXT NOT NULL, requestDigest TEXT NOT NULL, actor TEXT NOT NULL,
    state TEXT NOT NULL, transactionId TEXT, lenderLoanNumber TEXT, receiptId INTEGER,
    startedAt TEXT NOT NULL, updatedAt TEXT NOT NULL, httpStatus INTEGER,
    UNIQUE(environment,transactionId)
  );
  CREATE INDEX IF NOT EXISTS uwm_operations_file ON uwm_operations(loanId,environment,kind,state);`);
}
export const uwmRequestDigest = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");
export function prepareUwmOperation(db: Store, staff: WorkspaceStaff, raw: unknown) {
  const input = uwmOperationInput.parse(raw), now = new Date().toISOString();
  return db.transaction(() => {
    const access = loanAccess(db, staff, input.loanId);
    if (!access || (staff.brokerage.role === "Processor" && input.kind !== "condition-delivery")) throw new UwmError("This UWM action is unavailable.");
    const existing = db.prepare("SELECT * FROM uwm_operations WHERE id=?").get(input.id);
    if (existing) {
      if (existing.actor !== staff.email || Object.entries(input).some(([key, value]) => existing[key] !== value)) throw new UwmError("This operation reference belongs to a different request.");
      return existing;
    }
    const app = db.prepare("SELECT revision,reviewedAt,submittedAt,correctionNote FROM applications WHERE loanId=?").get(input.loanId);
    if (!app || app.revision !== input.applicationRevision || !app.reviewedAt || !app.submittedAt || app.correctionNote) {
      throw new UwmError("Review the current application before starting a UWM action.");
    }
    if (db.prepare(`SELECT id FROM uwm_operations WHERE loanId=? AND environment=? AND kind=?
      AND state IN ('Prepared','Dispatching','Acknowledged','Unknown')`).get(input.loanId, input.environment, input.kind)) {
      throw new UwmError("An earlier UWM action needs reconciliation before another can start.");
    }
    db.prepare(`INSERT INTO uwm_operations(id,loanId,applicationRevision,environment,kind,requestDigest,actor,state,startedAt,updatedAt)
      VALUES(?,?,?,?,?,?,?,'Prepared',?,?)`).run(input.id, input.loanId, input.applicationRevision, input.environment, input.kind, input.requestDigest, staff.email, now, now);
    return db.prepare("SELECT * FROM uwm_operations WHERE id=?").get(input.id)!;
  });
}
export function bindUwmTransaction(db: Store, operationId: string, transactionId: string) {
  const id = z.string().min(1).max(200).parse(transactionId);
  return db.transaction(() => {
    const operation = db.prepare("SELECT kind,transactionId,state FROM uwm_operations WHERE id=?").get(operationId);
    if (!operation || operation.kind !== "import" || !["Prepared", "Dispatching"].includes(String(operation.state)) ||
      (operation.transactionId && operation.transactionId !== id)) throw new UwmError("The UWM transaction cannot be reassigned.");
    db.prepare("UPDATE uwm_operations SET transactionId=?,updatedAt=? WHERE id=?").run(id, new Date().toISOString(), operationId);
  });
}
// Dispatch once. A crash leaves Dispatching, and a timeout leaves Unknown. Neither
// state is automatically retryable. Callers must validate their business contract
// and feature gate before entering this function.
export async function dispatchUwmOperation(db: Store, staff: WorkspaceStaff, input: UwmOperationInput,
  send: () => Promise<{ status: number; body: unknown }>) {
  const reserved = prepareUwmOperation(db, staff, input);
  if (reserved.state !== "Prepared") return { id: input.id, state: reserved.state };
  const current = db.prepare("SELECT revision,reviewedAt,correctionNote FROM applications WHERE loanId=?").get(input.loanId);
  if (current?.revision !== input.applicationRevision || !current.reviewedAt || current.correctionNote) {
    throw new UwmError("The reviewed application changed before dispatch.");
  }
  db.prepare("UPDATE uwm_operations SET state='Dispatching',updatedAt=? WHERE id=?").run(new Date().toISOString(), input.id);
  try {
    const response = await send();
    db.prepare("UPDATE uwm_operations SET state='Acknowledged',httpStatus=?,updatedAt=? WHERE id=? AND state='Dispatching'")
      .run(response.status, new Date().toISOString(), input.id);
  } catch (error) {
    const state = error instanceof UwmRequestError && error.outcome === "rejected" ? "Rejected" : "Unknown";
    db.prepare("UPDATE uwm_operations SET state=?,httpStatus=?,updatedAt=? WHERE id=? AND state='Dispatching'")
      .run(state, error instanceof UwmRequestError ? error.status : null, new Date().toISOString(), input.id);
  }
  return { id: input.id, state: db.prepare("SELECT state FROM uwm_operations WHERE id=?").get(input.id)!.state };
}
export type VerifiedUwmImport = {
  id: string; loanId: string; environment: string; actor: string; applicationRevision: number;
  receiptId: number; state: "Completed" | "Failed";
};

export function correlateUwmImport(db: Store, receiptId: number, onVerified?: (outcome: VerifiedUwmImport) => void) {
  return db.transaction(() => {
    const receipt = db.prepare("SELECT environment,transactionId,loanNumber,body,heldImport FROM uwm_webhook_receipts WHERE id=? AND kind='import'").get(receiptId);
    if (!receipt?.transactionId) return "Unmatched";
    if (receipt.heldImport) return "Needs review";
    const operation = db.prepare("SELECT * FROM uwm_operations WHERE environment=? AND transactionId=? AND kind='import'")
      .get(receipt.environment, receipt.transactionId);
    if (!operation) return "Unmatched";
    const payload = JSON.parse(String(receipt.body)) as { LoanStatus?: string | null };
    const state = payload.LoanStatus === "Completed" && receipt.loanNumber ? "Completed" : payload.LoanStatus === "NotCompleted" ? "Failed" : null;
    if (!state) return "Needs review";
    const notify = (originalReceiptId: number) => onVerified?.({
      id: String(operation.id), loanId: String(operation.loanId), environment: String(operation.environment),
      actor: String(operation.actor), applicationRevision: Number(operation.applicationRevision), receiptId: originalReceiptId, state,
    });
    if (["Completed", "Failed"].includes(String(operation.state))) {
      if (operation.state !== state || operation.lenderLoanNumber !== receipt.loanNumber) return "Conflicting outcome";
      if (typeof operation.receiptId === "number") notify(operation.receiptId);
      return "Duplicate outcome";
    }
    if (!["Dispatching", "Acknowledged", "Unknown"].includes(String(operation.state))) return "Needs review";
    if (state === "Completed" && db.prepare("SELECT id FROM submissions WHERE lender='UWM' AND externalId=? AND loanId<>?")
      .get(receipt.loanNumber, operation.loanId)) return "Conflicting loan";
    if (state === "Completed" && db.prepare("SELECT id FROM uwm_operations WHERE environment=? AND lenderLoanNumber=? AND loanId<>? AND state='Completed'")
      .get(receipt.environment, receipt.loanNumber, operation.loanId)) return "Conflicting loan";
    db.prepare("UPDATE uwm_operations SET state=?,lenderLoanNumber=?,receiptId=?,updatedAt=? WHERE id=?")
      .run(state, receipt.loanNumber, receiptId, new Date().toISOString(), operation.id);
    notify(receiptId);
    // Preserve the sent revision in the operation. Never overwrite a newer 1003
    // or advance the internal workflow based on an import status alone.
    return state;
  });
}

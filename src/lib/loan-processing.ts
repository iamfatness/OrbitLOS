import { createHash } from "node:crypto";
import type { z } from "zod";
import type { BrokerageMember } from "./brokerage-model";
import { availableProcessingActions, processingActivityPrefix, staleProcessingHandoff, type LoanProcessing, type ProcessingAction, type ProcessingStatus, type updateProcessingInput } from "./processing-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";
import { loanAuditSnapshot, recordLoanAudit } from "./loan-audit";
import { approvedSecondReview, handoffCheckpointError } from "./application-review-checkpoint";

export const activeProcessingLoan = "loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')";
export const processingReviewReady = "coalesce(app.correctionNote, '') = '' AND (app.submittedAt IS NULL OR app.reviewedAt IS NOT NULL)";
export function processingAcceptanceReady(requireSecondReview: boolean) {
  return requireSecondReview ? `${processingReviewReady} AND nullif(app.submittedAt, '') IS NOT NULL
    AND nullif(app.reviewedAt, '') IS NOT NULL AND ${approvedSecondReview}` : processingReviewReady;
}
export const unassignedProcessingLoan = `processing.processorEmail IS NULL AND coalesce(processing.status, 'Unassigned') = 'Unassigned'
  AND (app.reviewedAt IS NOT NULL OR loan.stage IN ('Processing', 'Underwriting', 'Clear to Close'))`;

type Result = { message: string } | { error: string };
type AssignmentResult = { message: string; processing?: LoanProcessing } | { error: string };
export type ProcessorAssignmentReceipt = { outcome: "saved" | "newer" | "missing" };
const nextStatus: Record<ProcessingAction, ProcessingStatus> = {
  "Send to processing": "Ready for processing", "Accept handoff": "In processing", "Return to LO": "Returned to LO", "Complete handoff": "Complete",
};

export function assignProcessor(db: Store, staff: WorkspaceStaff,
  input: { loanId: string; revision: number; member: BrokerageMember | null; preserveHandoff?: boolean;
    requireUnassigned?: boolean; requestId?: string }): AssignmentResult {
  if (staff.brokerage.role !== "Admin" || (input.requireUnassigned && !input.member) ||
    (input.member && (input.member.role !== "Processor" || input.member.status !== "Active"))) {
    return { error: "Select an active processor in this brokerage." };
  }
  const { loanId, member, revision, requireUnassigned, requestId } = input;
  const intentHash = requestId ? createHash("sha256").update(JSON.stringify([
    loanId, revision, member?.email ?? null, Boolean(input.preserveHandoff), Boolean(requireUnassigned),
  ])).digest("hex") : null;
  return db.transaction(() => {
    const loan = db.prepare("SELECT officerEmail FROM loans WHERE id = ?").get(loanId);
    if (!loan) return { error: "This loan no longer exists." };
    if (member?.email === loan.officerEmail) return { error: "Assign a different staff member as the shared processor." };
    const current = db.prepare("SELECT * FROM loan_processing WHERE loanId = ?").get(loanId) as unknown as LoanProcessing | undefined;
    if (requestId && intentHash) {
      const prior = db.prepare("SELECT actorEmail, intentHash, revision FROM processor_assignment_receipts WHERE id = ?").get(requestId);
      if (prior) {
        if (prior.actorEmail !== staff.email || prior.intentHash !== intentHash) return { error: "This processor save belongs to a different request." };
        if ((current?.revision ?? 0) !== prior.revision) return { error: "This change was saved. Refresh to see the newer processing update." };
        return { message: "Processor access confirmed.", ...(requireUnassigned && current ? { processing: current } : {}) };
      }
      if ((current?.revision ?? 0) !== revision) return { error: "This processor assignment changed. Refresh before saving." };
    }
    const now = new Date().toISOString();
    const recordReceipt = (savedRevision: number) => {
      if (requestId && intentHash) db.prepare("INSERT INTO processor_assignment_receipts VALUES (?,?,?,?,?,?)")
        .run(requestId, loanId, staff.email, intentHash, savedRevision, now);
    };
    if ((current?.processorEmail ?? null) === (member?.email ?? null)) {
      recordReceipt(revision);
      return { message: "Processor assignment is up to date.", ...(requireUnassigned && current ? { processing: { ...current } } : {}) };
    }
    if (requireUnassigned && ((current?.revision ?? 0) !== revision || !db.prepare(`SELECT 1 FROM loans loan
      LEFT JOIN loan_processing processing ON processing.loanId = loan.id LEFT JOIN applications app ON app.loanId = loan.id
      WHERE loan.id = ? AND ${activeProcessingLoan} AND ${unassignedProcessingLoan} AND ${processingReviewReady}`).get(loanId))) {
      return { error: "This file has changed or left the unassigned queue. Review the refreshed list." };
    }
    if ((current?.revision ?? 0) !== revision) return { error: "This processor assignment changed. Refresh before saving." };
    const before = loanAuditSnapshot(db, loanId);
    const continuing = !!member && current && (input.preserveHandoff || current.status === "Ready for processing" ||
      current.status === "In processing" || current.status === "Returned to LO");
    const processing: LoanProcessing = { loanId, processorEmail: member?.email ?? null, processorName: member?.name.slice(0, 160) ?? "",
      status: continuing ? current.status : member ? "Assigned" : "Unassigned", note: continuing ? current.note : "",
      updatedAt: continuing ? current.updatedAt : now, revision: revision + 1 };
    db.prepare(`INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision)
      VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT (loanId) DO UPDATE SET processorEmail = excluded.processorEmail,
      processorName = excluded.processorName, status = excluded.status, note = excluded.note, updatedAt = excluded.updatedAt, revision = revision + 1`)
      .run(loanId, processing.processorEmail, processing.processorName, processing.status, processing.note, processing.updatedAt);
    const message = member ? `Processing access granted to ${member.name}.` : "Shared processor access removed.";
    db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), loanId, message, now);
    const action = member ? "Assigned shared processor" : "Removed shared processor";
    accessEvent(db, staff, action, loanId, now);
    recordLoanAudit(db, loanId, staff, action, now, before);
    recordReceipt(processing.revision);
    return { message, ...(requireUnassigned ? { processing } : {}) };
  });
}

export function readProcessorAssignmentReceipt(db: Store, staff: WorkspaceStaff, loanId: string, requestId: string): ProcessorAssignmentReceipt {
  const receipt = db.prepare(`SELECT receipt.revision, coalesce(processing.revision, 0) AS currentRevision
    FROM processor_assignment_receipts receipt JOIN loans loan ON loan.id = receipt.loanId
    LEFT JOIN loan_processing processing ON processing.loanId = loan.id
    WHERE receipt.id = ? AND receipt.loanId = ? AND receipt.actorEmail = ?`).get(requestId, loanId, staff.email);
  return { outcome: !receipt ? "missing" : receipt.revision === receipt.currentRevision ? "saved" : "newer" };
}

export function updateProcessing(db: Store, staff: WorkspaceStaff | null, data: z.infer<typeof updateProcessingInput>, now: string): Result {
  const row = db.prepare(`SELECT processing.*, loan.disposition, loan.stage FROM loan_processing processing JOIN loans loan ON loan.id = processing.loanId
    WHERE processing.loanId = ? AND processing.processorEmail IS NOT NULL`).get(data.loanId) as unknown as
    (LoanProcessing & { disposition: string; stage: string }) | undefined;
  if (!row || row.revision !== data.revision) return { error: staleProcessingHandoff };
  const role = staff?.brokerage.role ?? "Admin";
  if (role === "Processor" && row.processorEmail !== staff?.email) return { error: "This handoff belongs to another processor." };
  if (row.disposition !== "Active") return { error: "Reopen the loan before changing its processing handoff." };
  if (row.stage === "Funded" || row.stage === "Closed") return { error: "Processing handoff is complete for this file." };
  if (!availableProcessingActions(row.status, role).includes(data.action)) return { error: "This handoff action is unavailable at the current step." };
  if (data.applicationRevision !== undefined &&
    (db.prepare("SELECT revision FROM applications WHERE loanId = ?").get(data.loanId)?.revision ?? null) !== data.applicationRevision) {
    return { error: staleProcessingHandoff };
  }
  if (data.action === "Send to processing" || data.action === "Accept handoff") {
    const checkpoint = handoffCheckpointError(db, data.loanId);
    if (checkpoint) return { error: checkpoint };
    if (db.prepare(`SELECT 1 FROM applications WHERE loanId = ?
      AND ((submittedAt IS NOT NULL AND reviewedAt IS NULL) OR correctionNote <> '')`).get(data.loanId)) {
      return { error: "Review the current 1003 before handing off this file." };
    }
  }
  const status = nextStatus[data.action];
  const note = data.action === "Accept handoff" && !data.note ? row.note : data.note;
  db.prepare("UPDATE loan_processing SET status = ?, note = ?, updatedAt = ?, revision = revision + 1 WHERE loanId = ?")
    .run(status, note, now, data.loanId);
  const actor = staff?.name || "Demo workspace";
  const text = `${processingActivityPrefix}${status} · ${actor}${data.note ? ` · ${data.note}` : ""}`;
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), data.loanId, text, now);
  accessEvent(db, staff, `Processing handoff · ${status}`, data.loanId, now);
  return { message: `Processing handoff · ${status}` };
}

import type { z } from "zod";
import type { BrokerageMember } from "./brokerage-model";
import { availableProcessingActions, type LoanProcessing, type ProcessingAction, type ProcessingStatus, type updateProcessingInput } from "./processing-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type Result = { message: string } | { error: string };
const nextStatus: Record<ProcessingAction, ProcessingStatus> = {
  "Send to processing": "Ready for processing", "Accept handoff": "In processing", "Return to LO": "Returned to LO", "Complete handoff": "Complete",
};

import { loanAuditSnapshot, recordLoanAudit } from "./loan-audit";

export function assignProcessor(db: Store, staff: WorkspaceStaff, input: { loanId: string; revision: number; member: BrokerageMember | null }): Result {
  if (staff.brokerage.role !== "Admin" || (input.member && (input.member.role !== "Processor" || input.member.status !== "Active"))) {
    return { error: "Select an active processor in this brokerage." };
  }
  const { loanId, member, revision } = input;
  return db.transaction(() => {
    const loan = db.prepare("SELECT officerEmail FROM loans WHERE id = ?").get(loanId);
    if (!loan) return { error: "This loan no longer exists." };
    if (member?.email === loan.officerEmail) return { error: "Assign a different staff member as the shared processor." };
    const current = db.prepare("SELECT processorEmail, revision FROM loan_processing WHERE loanId = ?").get(loanId);
    if ((current?.processorEmail ?? null) === (member?.email ?? null)) return { message: "Processor assignment is up to date." };
    if ((current?.revision ?? 0) !== revision) return { error: "This processor assignment changed. Refresh before saving." };
    const now = new Date().toISOString();
    const before = loanAuditSnapshot(db, loanId);
    db.prepare(`INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision)
      VALUES (?, ?, ?, ?, '', ?, 1) ON CONFLICT (loanId) DO UPDATE SET processorEmail = excluded.processorEmail,
      processorName = excluded.processorName, status = excluded.status, note = '', updatedAt = excluded.updatedAt, revision = revision + 1`)
      .run(loanId, member?.email ?? null, member?.name.slice(0, 160) ?? "", member ? "Assigned" : "Unassigned", now);
    const message = member ? `Processing access granted to ${member.name}.` : "Shared processor access removed.";
    db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), loanId, message, now);
    const action = member ? "Assigned shared processor" : "Removed shared processor";
    accessEvent(db, staff, action, loanId, now);
    recordLoanAudit(db, loanId, staff, action, now, before);
    return { message };
  });
}

export function updateProcessing(db: Store, staff: WorkspaceStaff | null, data: z.infer<typeof updateProcessingInput>, now: string): Result {
  const row = db.prepare("SELECT * FROM loan_processing WHERE loanId = ? AND processorEmail IS NOT NULL").get(data.loanId) as unknown as LoanProcessing | undefined;
  if (!row || row.revision !== data.revision) return { error: "The processing handoff changed. Refresh the loan before continuing." };
  const role = staff?.brokerage.role ?? "Admin";
  if (role === "Processor" && row.processorEmail !== staff?.email) return { error: "This handoff belongs to another processor." };
  if (!availableProcessingActions(row.status, role).includes(data.action)) return { error: "This handoff action is unavailable at the current step." };
  const status = nextStatus[data.action];
  db.prepare("UPDATE loan_processing SET status = ?, note = ?, updatedAt = ?, revision = revision + 1 WHERE loanId = ?")
    .run(status, data.note, now, data.loanId);
  const actor = staff?.name || "Demo workspace";
  const text = `Processing · ${status} · ${actor}${data.note ? ` · ${data.note}` : ""}`;
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), data.loanId, text, now);
  accessEvent(db, staff, `Processing handoff · ${status}`, data.loanId, now);
  return { message: `Processing handoff · ${status}` };
}

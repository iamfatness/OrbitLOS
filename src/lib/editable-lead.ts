import { isOpenOverdueCallbackPromise } from "./campaign-callback-exceptions";
import { callbackExceptionChanged, callbackExceptionUnavailable } from "./campaign-callback-exceptions-model";
import { leadTaskUnavailable, leadWorkRequest, leadWorkUnavailable, type LeadWorkRecord } from "./lead-work-model";
import { prospectingBlocked } from "./model";
import type { WorkspaceStaff } from "./staff-store";
import { leadWorkRecord, type Store } from "./store";

export function readEditableLead(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  localName?: string): LeadWorkRecord | { error: string } {
  if (!staff || staff.brokerage.role === "Processor" || staff.brokerage.id !== brokerageId) {
    return { error: leadWorkUnavailable };
  }
  const parsed = leadWorkRequest.safeParse(input);
  if (!parsed.success) return { error: leadWorkUnavailable };
  const { leadId, task, callbackPromiseId } = parsed.data;
  if (callbackPromiseId && (staff.brokerage.role !== "Admin" || !staff.brokerage.pilot)) return { error: callbackExceptionUnavailable };
  if (!task && staff.brokerage.role !== "Admin") return { error: leadWorkUnavailable };
  return db.transaction(() => {
    if (callbackPromiseId && !isOpenOverdueCallbackPromise(db, callbackPromiseId, leadId, new Date().toISOString())) {
      return { error: callbackExceptionChanged };
    }
    const teamTask = task?.kind === "lead-task" && task.team && staff.brokerage.role === "Admin";
    if (task && !db.prepare(`SELECT 1 FROM referral_leads WHERE id = ? AND resolvedAt IS NULL AND heldAt IS NULL
      AND (? = 1 OR officerEmail = ? OR (officerEmail IS NULL AND officer = ?))`).get(leadId, Number(!!teamTask), staff.email, localName ?? null)) {
      return { error: leadTaskUnavailable };
    }
    const record = leadWorkRecord(db, leadId, staff.brokerage.role === "LO" ? staff.email : undefined);
    if (!record) return { error: task ? leadTaskUnavailable : leadWorkUnavailable };
    if (task?.kind === "lead-task") {
      const current = record.lead.importedTasks.find(({ id }) => id === task.id);
      if (!current || current.completedAt || record.member?.callbackTaskId === task.id ||
        prospectingBlocked(current.purpose, record.lead.outreachSuppressed || record.member?.lastOutcome === "Opted out")) {
        return { error: leadTaskUnavailable };
      }
    } else if (task) {
      const { lead, member } = record;
      const current = task.kind === "campaign" ? member?.callbackTaskId === task.id && member.callbackDueAt &&
        (!task.expectedCallbackAt || (member.lastOutcome === "Requested callback" && member.callbackDueAt === task.expectedCallbackAt)) :
        task.id === lead.id && !lead.followUp.firstContactAt && !lead.followUp.replyReceivedAt;
      if (!current || lead.outreachSuppressed) return { error: leadTaskUnavailable };
    }
    return record;
  });
}

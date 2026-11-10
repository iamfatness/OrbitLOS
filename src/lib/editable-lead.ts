import { isOpenOverdueCallbackPromise } from "./campaign-callback-exceptions";
import { callbackExceptionChanged, callbackExceptionUnavailable } from "./campaign-callback-exceptions-model";
import { carriedCallbackSource, openCarriedCallback } from "./carried-campaign-callback";
import { isCurrentSequenceCall } from "./campaign-sequences";
import { readEditableLoan } from "./editable-loan";
import { leadTaskUnavailable, leadWorkRequest, leadWorkUnavailable, type LeadWorkRecord } from "./lead-work-model";
import type { EditableLoan } from "./loan-work-model";
import { prospectingBlocked } from "./model";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import type { WorkspaceStaff } from "./staff-store";
import { leadWorkRecord, type Store } from "./store";

export function readEditableLead(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  localName?: string): LeadWorkRecord | { loanWork: EditableLoan; callbackTaskId: string } | { error: string } {
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
      const callback = !callbackPromiseId && task.kind === "campaign" && task.expectedCallbackAt ? db.prepare(`
        SELECT loan.id AS loanId, lead.id AS leadId, loan.contactId, borrower.email, borrower.phone
        ${carriedCallbackSource} JOIN contacts borrower ON borrower.id = loan.contactId
        WHERE ${openCarriedCallback} AND lead.id = ? AND task.id = ? AND task.dueAt = ? AND loan.officerEmail = ?`)
        .get(leadId, task.id, task.expectedCallbackAt, staff.email) : undefined;
      if (callback && typeof callback.loanId === "string" && !outreachSuppressed(blockedOutreachKeys(db, [callback]), callback)) {
        const loanWork = readEditableLoan(db, callback.loanId, staff, brokerageId, localName);
        if (!("error" in loanWork)) return { loanWork, callbackTaskId: task.id };
      }
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
        task.kind === "sequence" ? isCurrentSequenceCall(db, leadId, task.id, new Date().toISOString()) :
          task.id === lead.id && !lead.followUp.firstContactAt && !lead.followUp.replyReceivedAt;
      if (!current || lead.outreachSuppressed) return { error: leadTaskUnavailable };
    }
    return record;
  });
}

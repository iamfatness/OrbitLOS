import { approvedSecondReview, currentManualExportPrepared } from "./application-review-checkpoint";
import { manualReturnFollowUpInput, manualReturnFollowUpUnavailable, manualReturnStatus, type ManualReturnAssignment,
  type ManualReturnFollowUp, type ManualReturnStatus } from "./lender-export-model";
import type { Store } from "./store";
import { defaultManualReturnHours } from "./playbook-model";
import { readPlaybook } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";

// The parent query joins the active loan and its application as loan and app.
export const pendingManualReturn = `LEFT JOIN application_handoff_events returned ON returned.activityId = (
    SELECT event.activityId FROM application_handoff_events event JOIN activity entry ON entry.id = event.activityId
    WHERE event.loanId = loan.id AND event.submissionId IS NOT NULL AND event.outcome IN ('Acknowledged', 'Returned for changes')
    ORDER BY event.applicationRevision DESC, event.lenderRevision DESC, entry.rowid DESC LIMIT 1
  ) AND returned.outcome = 'Returned for changes'
  AND NOT EXISTS (SELECT 1 FROM application_versions version WHERE version.loanId = loan.id AND version.revision = app.revision AND version.uwmReceipt IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM past_client_profiles profile WHERE profile.loanId = loan.id AND profile.closingDate IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM closing_progress closing WHERE closing.loanId = loan.id AND closing.fundingDate IS NOT NULL)
  LEFT JOIN activity returnEntry ON returnEntry.id = returned.activityId
  LEFT JOIN submissions returnFile ON returnFile.id = returned.submissionId AND returnFile.loanId = loan.id AND returnFile.syncedAt IS NULL`;

export const manualReturnDueAt = `coalesce(returned.followUpDueAt, strftime('%Y-%m-%dT%H:%M:%fZ', returnEntry.createdAt, '+${defaultManualReturnHours} hours'))`;

export const latestManualReturnFollowUp = `(SELECT json_object('at', entry.createdAt, 'actor', followUp.actor,
    'party', followUp.party, 'channel', followUp.channel, 'note', followUp.note)
  FROM manual_return_follow_ups followUp JOIN activity entry ON entry.id = followUp.activityId
  WHERE followUp.returnEventId = page.returnEventId ORDER BY followUp.rowid DESC LIMIT 1)`;

export function manualReturnPhase(requireApproval: boolean) {
  return `CASE WHEN app.submittedAt IS NULL THEN '${manualReturnStatus.borrower}'
    WHEN app.reviewedAt IS NULL THEN '${manualReturnStatus.review}'
    ${requireApproval ? `WHEN NOT ${approvedSecondReview} THEN '${manualReturnStatus.approval}'` : ""}
    WHEN ${currentManualExportPrepared}
    THEN '${manualReturnStatus.acknowledgment}' ELSE '${manualReturnStatus.export}' END`;
}

export function readManualReturnWork(db: Store, loanId: string, requireApproval: boolean): (ManualReturnAssignment & { status: ManualReturnStatus }) | undefined {
  const row = db.prepare(`SELECT returnFile.id AS submissionId, returned.activityId AS eventId, ${manualReturnPhase(requireApproval)} AS status
    FROM loans loan JOIN applications app ON app.loanId = loan.id ${pendingManualReturn}
    WHERE loan.id = ? AND loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed') AND returnFile.id IS NOT NULL`).get(loanId);
  return row ? { submissionId: String(row.submissionId), eventId: String(row.eventId), status: row.status as ManualReturnStatus } : undefined;
}

export function recordManualReturnFollowUp(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  localName?: string, now = new Date()): { followUp: ManualReturnFollowUp } | { error: string } {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role === "Processor") return { error: manualReturnFollowUpUnavailable };
  const parsed = manualReturnFollowUpInput.safeParse(input);
  if (!parsed.success) return { error: "Choose who you contacted, a channel, and enter a short outcome." };
  const { entryId, eventId, submissionId, loanId, party, channel, note } = parsed.data;
  return db.transaction(() => {
    const loan = db.prepare("SELECT officer, officerEmail FROM loans WHERE id = ?").get(loanId);
    const owns = loan && (loan.officerEmail === staff.email || (loan.officerEmail === null && localName && loan.officer === localName));
    if (!owns) return { error: manualReturnFollowUpUnavailable };
    const current = readManualReturnWork(db, loanId, readPlaybook(db).requireSecondReview);
    if (current?.eventId !== eventId || current.submissionId !== submissionId) return { error: "This lender return changed. Refresh Today before logging follow-up." };
    const existing = db.prepare(`SELECT entry.createdAt, followUp.* FROM activity entry
      LEFT JOIN manual_return_follow_ups followUp ON followUp.activityId = entry.id WHERE entry.id = ?`).get(entryId);
    if (existing) {
      if (existing.returnEventId !== eventId || existing.actorEmail !== staff.email ||
        existing.party !== party || existing.channel !== channel || existing.note !== note) {
        return { error: "Start a new follow-up entry." };
      }
      return { followUp: { at: String(existing.createdAt), actor: String(existing.actor), party, channel, note } };
    }
    const followUp = { at: now.toISOString(), actor: staff.name, party, channel, note };
    db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)")
      .run(entryId, loanId, `Lender return follow-up · ${party} · ${channel} · ${staff.name} · ${note}`, followUp.at);
    db.prepare(`INSERT INTO manual_return_follow_ups (activityId, returnEventId, actor, actorEmail, party, channel, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(entryId, eventId, staff.name, staff.email, party, channel, note);
    return { followUp };
  });
}

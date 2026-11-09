import { approvedSecondReview } from "./application-review-checkpoint";
import { manualReturnStatus, type ManualReturnStatus } from "./lender-export-model";
import type { Store } from "./store";

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

export function manualReturnPhase(requireApproval: boolean) {
  return `CASE WHEN app.submittedAt IS NULL THEN '${manualReturnStatus.borrower}'
    WHEN app.reviewedAt IS NULL THEN '${manualReturnStatus.review}'
    ${requireApproval ? `WHEN NOT ${approvedSecondReview} THEN '${manualReturnStatus.approval}'` : ""}
    WHEN EXISTS (SELECT 1 FROM application_handoff_events prepared WHERE prepared.loanId = loan.id
      AND prepared.applicationRevision = app.revision AND prepared.outcome = 'Export prepared'
      AND prepared.lenderRevision = coalesce((SELECT revision FROM application_lender_details WHERE loanId = loan.id), 0))
    THEN '${manualReturnStatus.acknowledgment}' ELSE '${manualReturnStatus.export}' END`;
}

export function readManualReturnWork(db: Store, loanId: string, requireApproval: boolean) {
  const row = db.prepare(`SELECT returnFile.id AS submissionId, ${manualReturnPhase(requireApproval)} AS status
    FROM loans loan JOIN applications app ON app.loanId = loan.id ${pendingManualReturn}
    WHERE loan.id = ? AND loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed') AND returnFile.id IS NOT NULL`).get(loanId);
  return row ? { submissionId: String(row.submissionId), status: row.status as ManualReturnStatus } : undefined;
}

import { secondReviewBlocker } from "./application-model";
import { readPlaybook } from "./playbooks";
import type { Store } from "./store";

// The calling query joins the current application as app.
export const approvedSecondReview = `EXISTS (SELECT 1 FROM loan_reviews approved WHERE approved.loanId = app.loanId
  AND approved.applicationRevision = app.revision AND approved.category = '1003 second review' AND approved.status = 'Approved')`;

export const pendingRequiredApproval = `app.submittedAt IS NOT NULL AND app.reviewedAt IS NOT NULL AND NOT ${approvedSecondReview}
  AND (coalesce(processing.status IN ('Assigned', 'Ready for processing'), 0) OR NOT EXISTS (
    SELECT 1 FROM application_versions version WHERE version.loanId = app.loanId AND version.revision = app.revision AND version.uwmReceipt IS NOT NULL))`;

export const openSecondReview = `pending.loanId = app.loanId AND pending.category = '1003 second review'
  AND pending.status IN ('Requested', 'Changes requested')`;

export function handoffCheckpointError(db: Store, loanId: string) {
  if (!readPlaybook(db).requireSecondReview) return null;
  const row = db.prepare(`SELECT app.submittedAt, app.reviewedAt, ${approvedSecondReview} AS approved
    FROM applications app WHERE app.loanId = ?`).get(loanId);
  return secondReviewBlocker(true, row ? { submittedAt: row.submittedAt as string | null,
    reviewedAt: row.reviewedAt as string | null, secondReviewApproved: Boolean(row.approved) } : undefined);
}

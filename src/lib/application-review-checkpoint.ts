import { secondReviewBlocker } from "./application-model";
import { currentManualAcknowledgmentRequired } from "./lender-export-model";
import { readPlaybook } from "./playbooks";
import type { Store } from "./store";

// The calling query joins the current application as app.
export const approvedSecondReview = `EXISTS (SELECT 1 FROM loan_reviews approved WHERE approved.loanId = app.loanId
  AND approved.applicationRevision = app.revision AND approved.category = '1003 second review' AND approved.status = 'Approved')`;

const currentManualEvent = `event.loanId = app.loanId AND event.applicationRevision = app.revision
  AND event.lenderRevision = coalesce((SELECT revision FROM application_lender_details WHERE loanId = app.loanId), 0)`;
const currentManualQuoteKey = `(SELECT (SELECT json_array(run.id, run.selectedId) FROM json_each(run.offers) offer
    WHERE json_extract(offer.value, '$.id') = run.selectedId AND json_type(offer.value, '$.manual') = 'object' LIMIT 1)
  FROM pricing_runs run
  WHERE run.loanId = app.loanId AND run.selectedId IS NOT NULL
  ORDER BY run.selectedAt DESC, run.rowid DESC LIMIT 1)`;
const matchesCurrentManualQuote = `(CASE WHEN event.quoteBasis IS NOT NULL THEN
  json_array(json_extract(event.quoteBasis, '$.runId'), json_extract(event.quoteBasis, '$.offerId')) END) IS ${currentManualQuoteKey}`;
export const currentManualLenderSubmission = `(SELECT CASE WHEN event.outcome = 'Acknowledged' THEN file.id END
  FROM application_handoff_events event JOIN activity entry ON entry.id = event.activityId
  LEFT JOIN submissions file ON file.id = event.submissionId AND file.loanId = event.loanId AND file.syncedAt IS NULL AND ${matchesCurrentManualQuote}
  WHERE ${currentManualEvent} AND event.outcome <> 'Export prepared'
  ORDER BY entry.rowid DESC LIMIT 1)`;
export const currentManualExportPrepared = `EXISTS (SELECT 1 FROM application_handoff_events event
  WHERE ${currentManualEvent} AND event.outcome = 'Export prepared' AND ${matchesCurrentManualQuote})`;
export const lastManualLenderSubmission = `(SELECT event.submissionId FROM application_handoff_events event JOIN activity ON activity.id = event.activityId
  JOIN submissions file ON file.id = event.submissionId AND file.loanId = event.loanId AND file.syncedAt IS NULL
  WHERE event.loanId = app.loanId AND event.outcome = 'Acknowledged'
  ORDER BY event.applicationRevision DESC, event.lenderRevision DESC, activity.rowid DESC LIMIT 1)`;
export const hasRecordedLenderRejection = `EXISTS (SELECT 1 FROM application_handoff_events event
  WHERE event.loanId = app.loanId AND event.outcome = 'Rejected')`;

export const pendingRequiredApproval = `app.submittedAt IS NOT NULL AND app.reviewedAt IS NOT NULL AND NOT ${approvedSecondReview}
  AND (coalesce(processing.processorEmail IS NOT NULL AND processing.status IN ('Assigned', 'Ready for processing'), 0)
    OR (${currentManualLenderSubmission} IS NULL AND NOT EXISTS (
      SELECT 1 FROM application_versions version WHERE version.loanId = app.loanId AND version.revision = app.revision AND version.uwmReceipt IS NOT NULL)))`;

export const openSecondReview = `pending.loanId = app.loanId AND pending.category = '1003 second review'
  AND pending.status IN ('Requested', 'Changes requested')`;

export function manualLenderClosingBlocker(db: Store, loanId: string) {
  const row = db.prepare(`SELECT 1 FROM applications app WHERE app.loanId = ?
    AND (${lastManualLenderSubmission} IS NOT NULL OR ${hasRecordedLenderRejection})
    AND (${currentManualLenderSubmission} IS NULL OR NOT ${currentManualExportPrepared})
    AND NOT EXISTS (SELECT 1 FROM application_versions version WHERE version.loanId = app.loanId
      AND version.revision = app.revision AND version.uwmReceipt IS NOT NULL)`).get(loanId);
  return row ? currentManualAcknowledgmentRequired : null;
}

export function handoffCheckpointError(db: Store, loanId: string) {
  if (!readPlaybook(db).requireSecondReview) return null;
  const row = db.prepare(`SELECT app.submittedAt, app.reviewedAt, ${approvedSecondReview} AS approved
    FROM applications app WHERE app.loanId = ?`).get(loanId);
  return secondReviewBlocker(true, row ? { submittedAt: row.submittedAt as string | null,
    reviewedAt: row.reviewedAt as string | null, secondReviewApproved: Boolean(row.approved) } : undefined);
}

import { repriceIncomeMessage } from "./income-review-model";
import { quoteMatchesApplication, repriceQuoteMessage, type PricingApplication } from "./pricing-model";
import type { Store } from "./store";

// The caller supplies trusted SQL expressions. The predicate checks the exact accepted revisions used in the review.
export function incomeEvidenceMatchesSql(loanId: string, evidence: string) {
  return `NOT EXISTS (SELECT 1 FROM json_each(${evidence}) linked WHERE NOT EXISTS (
    SELECT 1 FROM document_requests request WHERE request.loanId = ${loanId}
      AND request.id = json_extract(linked.value, '$.id') AND request.revision = json_extract(linked.value, '$.revision')
      AND request.recipient = json_extract(linked.value, '$.recipient') AND request.status = 'Accepted'))`;
}

export function approvedIncomeSql(loanId: string, revision: string) {
  return `SELECT income.amount FROM loan_income_worksheets income JOIN applications app ON app.loanId = income.loanId
    WHERE income.loanId = ${loanId} AND income.revision = ${revision} AND income.stage = 'Approved'
      AND income.revision = (SELECT max(latest.revision) FROM loan_income_worksheets latest WHERE latest.loanId = income.loanId)
      AND app.revision = income.applicationRevision AND app.submittedAt IS NOT NULL AND app.reviewedAt IS NOT NULL
      AND coalesce(app.correctionNote, '') = '' AND json_extract(app.draft, '$.confirmedDemo') = 1
      AND ${incomeEvidenceMatchesSql("income.loanId", "income.evidence")}`;
}

export function approvedIncomeAmount(db: Store, loanId: string, revision: number) {
  const row = db.prepare(approvedIncomeSql("?", "?")).get(loanId, revision);
  return typeof row?.amount === "number" ? row.amount : null;
}

export function pricingInputError(db: Store, loanId: string, run: { applicationRevision: unknown; incomeReviewRevision?: unknown },
  application: PricingApplication | undefined) {
  if (!quoteMatchesApplication(run.applicationRevision, application)) return repriceQuoteMessage;
  if (typeof run.incomeReviewRevision === "number" && approvedIncomeAmount(db, loanId, run.incomeReviewRevision) === null) return repriceIncomeMessage;
  return null;
}

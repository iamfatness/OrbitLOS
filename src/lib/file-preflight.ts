import { createHash } from "node:crypto";
import { currentManualLenderSubmission, handoffCheckpointError } from "./application-review-checkpoint";
import { applicationDraft, requestedLoanAmount } from "./application-model";
import { disclosurePackageStatus, disclosureTarget } from "./disclosure-model";
import { readDisclosureWork } from "./disclosures";
import { closingDisclosureReviewTarget, preflightFeeField, preflightFeesTarget, type FilePreflight, type PreflightCheck } from "./file-preflight-model";
import { manualLenderAcknowledgmentTarget } from "./lender-export-model";
import { loanAmountComparisonTarget } from "./loan-workflow";
import type { Condition } from "./model";
import { feeLabels, missingFees } from "./quote-worksheet";
import { savedPricingRun, type Store } from "./store";
import { conditionTarget, submissionTarget } from "./uwm-alert-model";

const evidenceLimit = 40;
const displayedLimit = 5;

type LenderFile = { id: string; lender: string; externalId: string; status: string; conditions: string };

export function readFilePreflight(db: Store, loanId: string): FilePreflight {
  const checks: PreflightCheck[] = [];
  const add = (id: string, label: string, detail: string, ready: boolean, target: string) => {
    checks.push({ id, label, detail, state: ready ? "Ready" : "Needs attention", target });
  };
  const app = db.prepare(`SELECT app.revision, app.submittedAt, app.reviewedAt, app.correctionNote, app.draft, loan.amount,
      app.uwmReference, version.uwmReceipt, version.uwmSentAt, ${currentManualLenderSubmission} AS manualFile
    FROM applications app JOIN loans loan ON loan.id = app.loanId
    LEFT JOIN application_versions version ON version.loanId = app.loanId AND version.revision = app.revision
    WHERE app.loanId = ?`).get(loanId);
  const applicationReady = Boolean(app?.submittedAt && app.reviewedAt && !app.correctionNote);
  add("1003", "Current 1003", applicationReady ? `Reviewed revision ${app?.revision}` :
    app?.correctionNote ? "Wait for the borrower’s corrected application." :
      app?.submittedAt ? `Review submitted revision ${app.revision}.` : "Open the borrower application and obtain a submission.",
  applicationReady, "loan-application");
  const approval = applicationReady ? handoffCheckpointError(db, loanId) : null;
  if (approval) add("second-review", "Required 1003 second review", approval, false, "loan-reviews");
  const draft = applicationReady ? applicationDraft.safeParse(JSON.parse(String(app?.draft))) : null;
  const requested = draft?.success ? requestedLoanAmount(draft.data.loanAmount) : null;
  if (requested !== null && Math.round(requested) !== app?.amount) {
    add("amount", "Loan amount", "Compare the recorded amount with the reviewed 1003 request.", false, loanAmountComparisonTarget);
  }

  const disclosure = readDisclosureWork(db, loanId);
  const pricing = savedPricingRun(db, loanId);
  const source = disclosure.source;
  const selectedSample = pricing?.mode === "mock" && typeof pricing.selectedId === "string";
  const estimate = source?.quote.estimate;
  const blanks = estimate ? missingFees(estimate.inputs.fees) : [];
  const quoteMismatch = requested !== null && source && Math.round(source.quote.loanAmount * 100) !== Math.round(requested * 100);
  if (source && estimate && !quoteMismatch) {
    add("fees", "Sample quote and fees", blanks.length ? `Enter sample amounts for ${blanks.map((field) => feeLabels[field]).join(", ")}.` :
      `${source.quote.product} at ${source.quote.rate.toFixed(3)}% · Fee worksheet revision ${source.feeRevision}`,
    !blanks.length, blanks.length ? preflightFeeField(blanks[0]) : preflightFeesTarget);
  } else {
    const detail = quoteMismatch ? "Save an offer that matches the reviewed 1003 loan amount." :
      !selectedSample ? "Save a sample quote and its fee worksheet." : disclosure.unavailable ?? "Complete the sample fee worksheet.";
    const worksheet = selectedSample && (source || disclosure.unavailable?.startsWith("Save a fee worksheet"));
    add("fees", "Sample quote and fees", detail, false, !quoteMismatch && worksheet ? preflightFeesTarget : "loan-pricing");
  }
  const item = disclosure.packages[0];
  const confirmation = disclosure.closingReviews.find(({ current }) => current);
  const packageStatus = item ? disclosurePackageStatus(item) : null;
  add("disclosures", "Sample disclosures", confirmation ? `Confirmed package v${confirmation.version} · Revision ${confirmation.revision}` :
    !item ? "Prepare and issue a sample package." :
      packageStatus === "Mock signing complete" && source && !item.reviewReason ?
        `Confirm signed package v${item.version} in Closing.` :
        `Package v${item.version} · ${item.reviewReason ?? packageStatus}.`,
  Boolean(confirmation), !confirmation && packageStatus === "Mock signing complete" && source ? closingDisclosureReviewTarget : disclosureTarget);

  const lender = applicationReady ? db.prepare(`SELECT id, lender, externalId, status, conditions FROM submissions
    WHERE loanId = ? AND ((id = ? AND syncedAt IS NULL) OR (lender = 'UWM' AND syncedAt IS NOT NULL AND externalId = ?))
    ORDER BY syncedAt IS NULL, id LIMIT 1`).get(loanId, app?.manualFile ?? null, app?.uwmReceipt ? app.uwmReference : null) as LenderFile | undefined : undefined;
  add("lender", "Lender acknowledgment", lender ? `${lender.lender} · ${lender.externalId}${lender.lender === "UWM" && app?.uwmReceipt ? ` · Receipt ${app.uwmReceipt}` : ""}` :
    "Record the current 1003’s mock UWM receipt or manual lender acknowledgment.", Boolean(lender),
  lender ? submissionTarget(lender.id) : app?.manualFile ? manualLenderAcknowledgmentTarget : "loan-application");
  const conditions = lender ? JSON.parse(lender.conditions) as Condition[] : [];
  const outstanding = conditions.filter(({ satisfiedAt }) => !satisfiedAt);
  if (lender) {
    for (const condition of outstanding.slice(0, displayedLimit)) {
      add(`condition:${condition.id}`, `${condition.category} condition`, "Open the condition and review the outstanding evidence.", false,
        conditionTarget(lender.id, condition.id));
    }
    if (outstanding.length > displayedLimit) add("other-conditions", "Other lender conditions",
      `${outstanding.length - displayedLimit} more open. See the full lender checklist.`, false, submissionTarget(lender.id));
    if (!outstanding.length) add("conditions", "Lender conditions", conditions.length ?
      `${conditions.length} cleared on this lender file.` : "No conditions recorded on this lender file.", true, submissionTarget(lender.id));
  }

  const documents = db.prepare(`SELECT id, kind, status, revision, deadlineRevision FROM document_requests
    WHERE loanId = ? AND (submissionId IS NULL OR submissionId = ?) ORDER BY id LIMIT ?`).all(loanId, lender?.id ?? null, evidenceLimit + 1);
  const openDocs = documents.filter(({ status }) => status !== "Accepted");
  for (const doc of openDocs.slice(0, displayedLimit)) {
    add(`document:${doc.id}`, String(doc.kind), String(doc.status), false, `document-${doc.id}`);
  }
  if (documents.length > evidenceLimit) {
    add("document-limit", "Document evidence", "This sample preflight supports up to 40 document requests.", false, "document-checklist");
  } else if (openDocs.length > displayedLimit) {
    add("other-documents", "Other document requests", `${openDocs.length - displayedLimit} more open. See the full checklist.`, false, "document-checklist");
  } else if (!openDocs.length && documents.length) {
    add("documents", "Document evidence", `${documents.length} accepted on this file.`, true, "document-checklist");
  }
  const key = createHash("sha256").update(JSON.stringify({
    application: app && [app.revision, app.submittedAt, app.reviewedAt, app.amount, app.uwmReceipt, app.uwmSentAt, app.manualFile],
    fees: [pricing?.id, pricing?.selectedId, source?.feeRevision],
    disclosures: item && [item.version, item.revision, confirmation?.at],
    lender: lender && [lender.id, lender.externalId, lender.status, lender.conditions],
    documents, checks,
  })).digest("hex");
  return { key, checks };
}

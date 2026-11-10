import { insertContact, insertLoan, insertSubmission, latestPricingUnsupported, savedPricingRun, type Store } from "./store";
import type { Condition, Stage, Submission } from "./model";
import { addApplicationActivity, getApplication, saveApplicationVersion } from "./applications";
import { createRealtorLenderDraft, restoreClearToCloseDrafts, supersedeClearToCloseDrafts } from "./communications";
import { recordUwmAlerts } from "./uwm-alerts";
import { handoffCheckpointError } from "./application-review-checkpoint";
import { findPricingOffer, manualQuoteRouteMessage } from "./manual-pricing-model";
import { reopenedMockUwmAtSql } from "./processing-conditions";
import { requestedLoanAmount } from "./application-model";
import { pricingInputError } from "./income-review-freshness";
import { mockUwmAmountMismatch, nonAgencyManualHandoffMessage } from "./pricing-model";
import { closeMockUwmAcceptance, pendingMockUwmAcceptance, saveMockUwmAcceptance } from "./uwm-handoff-recovery";
import { latestMockConditionUpdate, nextMockConditionUpdate, receiveMockConditionUpdate, recordMockConditionChanges } from "./uwm-condition-events";

// The shapes used by the Insights Loans query and the single-loan conditions endpoint.
interface InsightsLoan {
  LoanId: string;
  PrimaryBorrowerFirstName: string;
  PrimaryBorrowerLastName: string;
  ImportedDateTime: string;
  LoanStatusDescription: string;
}

interface UwmCondition {
  id: string;
  conditionCategory: string;
  conditionDescription: string;
  isConditionUploaded: boolean;
  conditionSatisfactionDate: string | null;
}

interface UwmConditions {
  conditionGroups: { key: string; countItems: number; uploadedConditionsCount: number; conditions: UwmCondition[] }[];
  clearedConditions: UwmCondition[];
}

export interface UwmConnector {
  listLoans(): Promise<{ data: { Loans: InsightsLoan[] } }>;
  getConditions(loanNumber: string): Promise<UwmConditions>;
}

const mockLoans = [
  { LoanId: "9000001001", PrimaryBorrowerFirstName: "Charlotte", PrimaryBorrowerLastName: "Kim", ImportedDateTime: "2026-10-30T12:00:00Z", LoanStatusDescription: "Wholesale - Approved With Conditions" },
  { LoanId: "9000001002", PrimaryBorrowerFirstName: "Amelia", PrimaryBorrowerLastName: "Davis", ImportedDateTime: "2026-10-24T12:00:00Z", LoanStatusDescription: "Wholesale - Clear To Close" },
  { LoanId: "9000001003", PrimaryBorrowerFirstName: "Benjamin", PrimaryBorrowerLastName: "Cole", ImportedDateTime: "2026-11-02T12:00:00Z", LoanStatusDescription: "Wholesale - File Imported" },
] satisfies InsightsLoan[];

function sampleCondition(loanNumber: string, index: number, category: string, description: string, cleared = false): UwmCondition {
  return {
    id: `${loanNumber}_25_${index}`, conditionCategory: category, conditionDescription: description,
    isConditionUploaded: cleared, conditionSatisfactionDate: cleared ? "2026-11-04T15:30:00Z" : null,
  };
}

const mockUpdateLoan = "9000001001";

function mockConditions(loanNumber: string, changed: boolean): UwmConditions {
  if (loanNumber === mockUpdateLoan) {
    const property = sampleCondition(loanNumber, 3, "Property", "Confirm the subject property address.", !changed);
    const outstanding = [
      sampleCondition(loanNumber, 1, "Income", "Provide the most recent 30 days of pay statements."),
      sampleCondition(loanNumber, 2, "Assets", "Provide a complete copy of the latest bank statement."),
    ];
    if (changed) outstanding.push(sampleCondition(loanNumber, 4, "Insurance", "Provide a current homeowners insurance binder."), property);
    return {
      conditionGroups: [{ key: "Underwriting", countItems: outstanding.length, uploadedConditionsCount: 0, conditions: outstanding }],
      clearedConditions: changed ? [] : [property],
    };
  }
  if (loanNumber === "9000001002") {
    return { conditionGroups: [], clearedConditions: [sampleCondition(loanNumber, 1, "Title", "Provide the preliminary title commitment.", true)] };
  }
  return { conditionGroups: [], clearedConditions: [] };
}

const initialStage: Record<string, Stage> = {
  "Wholesale - File Imported": "Application",
  "Wholesale - Setup": "Processing",
  "Wholesale - Underwriting": "Underwriting",
  "Wholesale - Approved With Conditions": "Underwriting",
  "Wholesale - Clear To Close": "Clear to Close",
  Funded: "Funded",
  "Post Closed": "Closed",
};

function normalizeConditions({ conditionGroups, clearedConditions }: UwmConditions): Condition[] {
  function normalize(item: UwmCondition, group: string | null): Condition {
    return {
      id: item.id, group, category: item.conditionCategory, description: item.conditionDescription,
      uploaded: item.isConditionUploaded, satisfiedAt: item.conditionSatisfactionDate,
    };
  }
  const conditions = [
    ...conditionGroups.flatMap((group) => group.conditions.map((item) => normalize(item, group.key))),
    ...clearedConditions.map((item) => normalize(item, null)),
  ];
  return [...new Map(conditions.map((condition) => [condition.id, condition])).values()];
}

const approvedWithConditions = "Wholesale - Approved With Conditions";

function recordUwmProgress(db: Store, next: Pick<Submission, "id" | "loanId" | "status" | "conditions">,
  previous: Pick<Submission, "status" | "conditions">, now: string, mock = true) {
  const { count, statusChangeId, reopenedId } = recordUwmAlerts(db, next, previous, now);
  if (!mock) return count;
  if (reopenedId) {
    if (next.conditions.some(({ mockReopenedAt, satisfiedAt }) => mockReopenedAt && !satisfiedAt)) {
      supersedeClearToCloseDrafts(db, next.loanId, now);
    }
    createRealtorLenderDraft(db, next.loanId, "Lender review resumed", reopenedId, now);
  } else if (statusChangeId) {
    const complete = (status: string) => status === "Conditions cleared" || status === "Wholesale - Clear To Close";
    const reviewing = (status: string) => status === approvedWithConditions || status === "Wholesale - Underwriting";
    if (complete(next.status) && next.conditions.every((item) => item.satisfiedAt) &&
      (!complete(previous.status) || previous.conditions.some((item) => !item.satisfiedAt))) {
      createRealtorLenderDraft(db, next.loanId, "Lender review complete", statusChangeId, now);
      if (previous.conditions.some(({ mockReopenedAt, satisfiedAt }) => mockReopenedAt && !satisfiedAt)) {
        restoreClearToCloseDrafts(db, next.loanId, now, statusChangeId);
      }
    } else if (reviewing(next.status) && !reviewing(previous.status)) {
      createRealtorLenderDraft(db, next.loanId, "Lender review started", statusChangeId, now);
    }
  }
  return count;
}

export function uwmSubmissionConditions(db: Store, loanId: string, submissionId: string): Condition[] | undefined {
  const submission = db.prepare("SELECT conditions FROM submissions WHERE id = ? AND loanId = ? AND lender = 'UWM' AND syncedAt IS NOT NULL")
    .get(submissionId, loanId);
  return submission && JSON.parse(String(submission.conditions));
}

export function hasReopenedMockUwmCondition(db: Store, loanId: string) {
  return Boolean(db.prepare(`SELECT ${reopenedMockUwmAtSql("?")} AS since`).get(loanId)?.since);
}

export function archiveMockDocumentDelivery(db: Store, requestId: string) {
  db.prepare(`INSERT INTO uwm_document_delivery_history (requestId, receipt, sentAt, documentRevision)
    SELECT requestId, receipt, sentAt, documentRevision FROM uwm_document_deliveries WHERE requestId = ?`).run(requestId);
  db.prepare("DELETE FROM uwm_document_deliveries WHERE requestId = ?").run(requestId);
}

export function sendMockConditionDocument(db: Store, loanId: string, requestId: string, revision: number, now: string): { receipt: string } | { error: string } {
  const request = db.prepare(`SELECT requests.kind, requests.status, requests.submissionId, requests.conditionId, requests.revision,
      deliveries.receipt, deliveries.documentRevision
    FROM document_requests requests LEFT JOIN uwm_document_deliveries deliveries ON deliveries.requestId = requests.id
    WHERE requests.id = ? AND requests.loanId = ?`).get(requestId, loanId);
  if (!request || request.status !== "Accepted" || typeof request.submissionId !== "string") {
    return { error: "Accept a document linked to a UWM condition before recording mock delivery." };
  }
  if (request.revision !== revision) return { error: "This document changed. Refresh the checklist before recording delivery." };
  if (typeof request.receipt === "string" && (request.documentRevision === null || request.documentRevision === revision)) {
    return { receipt: request.receipt };
  }
  const conditions = uwmSubmissionConditions(db, loanId, request.submissionId);
  if (!conditions?.some((condition) => condition.id === request.conditionId && !condition.satisfiedAt)) {
    return { error: "This UWM condition is no longer outstanding. Refresh the loan to see its status." };
  }
  if (typeof request.receipt === "string") archiveMockDocumentDelivery(db, requestId);
  const receipt = `DEMO-DOC-${crypto.randomUUID().toUpperCase()}`;
  db.prepare("INSERT INTO uwm_document_deliveries (requestId, receipt, sentAt, documentRevision) VALUES (?, ?, ?, ?)")
    .run(requestId, receipt, now, request.revision);
  const pdf = db.prepare("SELECT objectId FROM document_files WHERE requestId = ?").get(requestId)?.objectId;
  addApplicationActivity(db, loanId, `${pdf ? "Mock UWM delivery recorded" : "Sample sent to UWM (mock)"} · ${request.kind} · ${receipt}`, now);
  return { receipt };
}

type MockConditionTarget = {
  loanId: string; submissionId: string; conditionId: string; expectedSatisfiedAt: string; expectedReopenedAt: string | null;
};
type MockConditionContext = { previous: { status: string; conditions: Condition[] }; condition: Condition };

function currentMockCondition(db: Store, input: MockConditionTarget): MockConditionContext | { error: string } {
  const { loanId, submissionId, conditionId, expectedSatisfiedAt, expectedReopenedAt } = input;
  const file = db.prepare(`SELECT status, conditions FROM submissions
    WHERE loanId = ? AND id = ? AND lender = 'UWM' AND syncedAt IS NOT NULL`).get(loanId, submissionId);
  if (!file) return { error: "This mock UWM file is unavailable." } as const;
  const previous = { status: String(file.status), conditions: JSON.parse(String(file.conditions)) as Condition[] };
  const condition = previous.conditions.find((item) => item.id === conditionId);
  if (condition?.satisfiedAt !== expectedSatisfiedAt || (condition.mockReopenedAt ?? null) !== expectedReopenedAt) {
    return { error: "The condition changed. Refresh the file before simulating a lender update." } as const;
  }
  return { previous, condition };
}

function applyMockConditionReopening(db: Store, { loanId, submissionId, conditionId }: MockConditionTarget,
  { previous, condition }: MockConditionContext, now: string) {
  const request = db.prepare("SELECT id, status, kind FROM document_requests WHERE submissionId = ? AND conditionId = ?").get(submissionId, conditionId);
  if (typeof request?.id === "string") {
    archiveMockDocumentDelivery(db, request.id);
    const note = `Mock UWM reopened this condition. Please attach a current replacement for the ${String(request.kind).toLowerCase()}.`;
    const needsReplacement = request.status !== "Requested";
    db.prepare(`UPDATE document_requests SET status = ?, replacementNote = ?, revision = revision + 1,
      deadlineRevision = deadlineRevision + CASE WHEN ? AND dueOn IS NOT NULL THEN 1 ELSE 0 END,
      dueOn = CASE WHEN ? THEN NULL ELSE dueOn END WHERE id = ?`)
      .run(needsReplacement ? "Needs replacement" : "Requested", needsReplacement ? note : "",
        Number(needsReplacement), Number(needsReplacement), request.id);
  }
  const conditions = previous.conditions.map((item) => item.id === conditionId
    ? { ...item, uploaded: false, satisfiedAt: null, mockReopenedAt: now } : item);
  const status = previous.conditions.every((item) => item.satisfiedAt) ? approvedWithConditions : previous.status;
  db.prepare("UPDATE submissions SET status = ?, conditions = ?, syncedAt = ? WHERE id = ?")
    .run(status, JSON.stringify(conditions), now, submissionId);
  recordUwmProgress(db, { id: submissionId, loanId, status, conditions }, previous, now);
  addApplicationActivity(db, loanId, `Mock UWM reopened condition · ${condition.category} · ${condition.description}`, now);
  return { message: request ? "Mock UWM reopened the condition and updated the borrower checklist."
    : "Mock UWM reopened the condition. Request the required document from the borrower." } as const;
}

function ensureMockClearanceRecorded(db: Store, { submissionId, conditionId, expectedSatisfiedAt }: MockConditionTarget,
  condition: Condition, now: string) {
  const recorded = latestMockConditionUpdate(db, submissionId, conditionId);
  if (recorded?.state === "Cleared" && recorded.occurredAt === expectedSatisfiedAt) return recorded;
  // Older files can already be cleared when the timeline is first opened.
  const clearance = nextMockConditionUpdate(db, submissionId, condition, expectedSatisfiedAt);
  receiveMockConditionUpdate(db, submissionId, condition.category, clearance, now, () => {});
  return clearance;
}

export function reopenMockUwmCondition(db: Store, input: MockConditionTarget, now: string) {
  const context = currentMockCondition(db, input);
  if ("error" in context) return context;
  ensureMockClearanceRecorded(db, input, context.condition, now);
  const event = nextMockConditionUpdate(db, input.submissionId, { ...context.condition, satisfiedAt: null }, now);
  let message = "The mock condition update was already processed.";
  receiveMockConditionUpdate(db, input.submissionId, context.condition.category, event, now, () => {
    message = applyMockConditionReopening(db, input, context, now).message;
  });
  return { message };
}

export function replayMockUwmConditionDelivery(db: Store, input: MockConditionTarget, now: string) {
  const context = currentMockCondition(db, input);
  if ("error" in context) return context;
  const { submissionId, conditionId } = input;
  const { condition } = context;
  const clearance = ensureMockClearanceRecorded(db, input, condition, now);
  const olderOpen = {
    id: `demo-late:${clearance.id}`, conditionId, version: clearance.version - 1, state: "Open" as const,
    occurredAt: new Date(Date.parse(clearance.occurredAt) - 1000).toISOString(),
  };
  const stale = receiveMockConditionUpdate(db, submissionId, condition.category, olderOpen, now, () => {
    applyMockConditionReopening(db, input, context, now);
  });
  const duplicate = receiveMockConditionUpdate(db, submissionId, condition.category, clearance, now, () => {});
  if ((stale !== "Ignored stale" && stale !== "Duplicate") || duplicate !== "Duplicate") {
    return { error: "Mock UWM replay could not confirm the current clearance." } as const;
  }
  return { message: "Older update ignored and duplicate clearance recognized. The condition is still cleared." };
}

function mockApplicationConditions(reference: string, receivedAt: string) {
  return normalizeConditions({
    conditionGroups: [{
      key: "Underwriting", countItems: 2, uploadedConditionsCount: 0,
      conditions: [
        sampleCondition(reference, 1, "Income", "Provide the most recent 30 days of pay statements."),
        sampleCondition(reference, 2, "Assets", "Provide the most recent bank statement for funds to close."),
      ],
    }],
    clearedConditions: [{
      ...sampleCondition(reference, 3, "Application", "Confirm the application and property details.", true),
      conditionSatisfactionDate: receivedAt,
    }],
  });
}

// Called inside the workspace transaction after LO review. The mock import
// acknowledgment and its condition snapshot are recorded together.
export function submitMockApplication(db: Store, loanId: string, revision: number, now: string, quote?: { runId: string; offerId: string },
  loseAcknowledgment = false) {
  if (pendingMockUwmAcceptance(db, loanId)) {
    return { error: "Check mock UWM for the missing submission receipt before sending again." } as const;
  }
  if (loseAcknowledgment && !db.prepare("SELECT 1 FROM loans WHERE id = ? AND disposition = 'Active' AND stage NOT IN ('Funded', 'Closed')").get(loanId)) {
    return { error: "Open an active, unfunded loan to rehearse a missing UWM receipt." } as const;
  }
  const application = getApplication(db, loanId);
  const saved = savedPricingRun(db, loanId);
  const manualQuote = saved && findPricingOffer(saved.offers, saved.selectedId)?.manual;
  const manualOnly = saved?.nonAgencyProgram || (!saved && latestPricingUnsupported(db, loanId, revision));
  if (quote) {
    if (manualQuote) return { error: manualQuoteRouteMessage } as const;
    if (manualOnly) return { error: nonAgencyManualHandoffMessage } as const;
    if (saved?.mode !== "mock" || saved.id !== quote.runId || saved.selectedId !== quote.offerId || saved.applicationRevision !== revision) {
      return { error: "The saved mock quote changed. Refresh pricing and review the current quote before sending." } as const;
    }
    const freshness = pricingInputError(db, loanId, { applicationRevision: saved.applicationRevision, incomeReviewRevision: saved.incomeReviewRevision }, application);
    if (freshness) return { error: freshness } as const;
  }
  if (!application?.reviewedAt || !application.submittedAt || application.revision !== revision) {
    return { error: "Refresh and review the current submitted 1003 before sending it to mock UWM." } as const;
  }
  const existingReference = application.uwmReference;
  const reference = existingReference ?? `DEMO-${crypto.randomUUID().toUpperCase()}`;
  if (existingReference) {
    if (!db.prepare(`SELECT 1 FROM submissions WHERE loanId = ? AND lender = 'UWM' AND externalId = ?
      AND syncedAt IS NOT NULL`).get(loanId, existingReference)) {
      return { error: "The linked mock UWM file is unavailable. Refresh the lender submissions before sending this revision." } as const;
    }
    const receipt = db.prepare("SELECT uwmReceipt FROM application_versions WHERE loanId = ? AND revision = ?").get(loanId, revision)?.uwmReceipt;
    if (typeof receipt === "string") return { reference, receipt, action: "retry" } as const;
  }
  if (manualQuote) return { error: manualQuoteRouteMessage } as const;
  if (manualOnly) return { error: nonAgencyManualHandoffMessage } as const;
  const checkpoint = handoffCheckpointError(db, loanId);
  if (checkpoint) return { error: checkpoint } as const;
  if (saved?.mode === "mock" && saved.applicationRevision === revision && typeof saved.quotedAmount === "number") {
    const mismatch = mockUwmAmountMismatch(saved.quotedAmount, requestedLoanAmount(JSON.parse(application.draft).loanAmount));
    if (mismatch) return { error: mismatch } as const;
  }
  if (!existingReference && db.prepare("SELECT 1 FROM submissions WHERE loanId = ? AND lender = 'UWM'").get(loanId)) {
    return { error: "This loan already has a separate UWM submission. Use a loan without a UWM file for a first mock handoff." } as const;
  }
  const receipt = `DEMO-1003-${crypto.randomUUID().toUpperCase()}`;
  if (loseAcknowledgment) {
    saveMockUwmAcceptance(db, { loanId, revision, attemptedAt: now, reference, receipt });
    addApplicationActivity(db, loanId, `Mock UWM acknowledgment missing for 1003 revision ${revision}. Check for a receipt before sending again.`, now);
    return { action: "unknown" } as const;
  }
  recordMockApplicationReceipt(db, application, reference, receipt, now, now);
  return { reference, receipt, action: existingReference ? "revision" : "initial" } as const;
}

function recordMockApplicationReceipt(db: Store, application: NonNullable<ReturnType<typeof getApplication>>, reference: string, receipt: string,
  receivedAt: string, now: string) {
  const { loanId, revision, submittedAt } = application;
  if (!application.uwmReference && submittedAt) {
    const submission = {
      id: crypto.randomUUID(), loanId, lender: "UWM", externalId: reference,
      status: approvedWithConditions, conditions: mockApplicationConditions(reference, submittedAt), syncedAt: now,
    };
    insertSubmission(db, submission);
    recordMockConditionChanges(db, submission.id, submission.conditions, [], now);
    recordUwmAlerts(db, submission, null, now);
    createRealtorLenderDraft(db, loanId, "Lender review started", submission.id, now);
    db.prepare("UPDATE applications SET uwmReference = ? WHERE loanId = ?").run(reference, loanId);
  }

  saveApplicationVersion(db, application);
  db.prepare("UPDATE application_versions SET uwmReceipt = ?, uwmSentAt = ? WHERE loanId = ? AND revision = ?")
    .run(receipt, receivedAt, loanId, revision);
  addApplicationActivity(db, loanId, `Mock UWM received 1003 revision ${revision} · File ${reference} · Receipt ${receipt}`, now);
}

export function reconcileMockApplicationReceipt(db: Store, loanId: string, revision: number, now: string) {
  const pending = pendingMockUwmAcceptance(db, loanId);
  if (!pending) {
    const completed = db.prepare(`SELECT accepted.reference, accepted.receipt FROM mock_uwm_acceptances accepted
      JOIN application_versions version ON version.loanId = accepted.loanId AND version.revision = accepted.revision AND version.uwmReceipt = accepted.receipt
      WHERE accepted.loanId = ? AND accepted.revision = ? AND accepted.reconciledAt IS NOT NULL`).get(loanId, revision);
    if (completed) return { reference: String(completed.reference), receipt: String(completed.receipt), alreadyReconciled: true } as const;
  }
  const application = getApplication(db, loanId);
  if (!pending || pending.revision !== revision || application?.revision !== revision || !application.reviewedAt || !application.submittedAt) {
    return { error: "There is no matching pending mock UWM receipt for this 1003 revision." } as const;
  }
  const fileMismatch = application.uwmReference
    ? application.uwmReference !== pending.reference || !db.prepare(`SELECT 1 FROM submissions
      WHERE loanId = ? AND lender = 'UWM' AND externalId = ? AND syncedAt IS NOT NULL`).get(loanId, pending.reference)
    : !!db.prepare("SELECT 1 FROM submissions WHERE loanId = ? AND lender = 'UWM'").get(loanId);
  if (fileMismatch) {
    return { error: "The current UWM file does not match the pending receipt. Review the lender submission first." } as const;
  }
  recordMockApplicationReceipt(db, application, pending.reference, pending.receipt, pending.attemptedAt, now);
  closeMockUwmAcceptance(db, loanId, revision, now);
  addApplicationActivity(db, loanId, `Recovered the original mock UWM receipt for revision ${revision} without another submission.`, now);
  return { reference: pending.reference, receipt: pending.receipt } as const;
}

type UwmFile = { loan: InsightsLoan; conditions: Condition[] };
type SavedUwmSubmission = Pick<Submission, "id" | "loanId" | "status"> & { conditions: string };

function applyMockClearances(db: Store, submissionId: string, conditions: Condition[], requestIds?: readonly string[]) {
  const cleared = new Map(db.prepare(`SELECT requests.conditionId, deliveries.mockClearedAt FROM document_requests requests
    JOIN uwm_document_deliveries deliveries ON deliveries.requestId = requests.id
    WHERE requests.submissionId = ? AND requests.status = 'Accepted' AND deliveries.mockClearedAt IS NOT NULL
      AND (deliveries.documentRevision = requests.revision OR deliveries.documentRevision IS NULL)
      ${requestIds ? "AND requests.id IN (SELECT value FROM json_each(?))" : ""}`)
    .all(submissionId, ...(requestIds ? [JSON.stringify(requestIds)] : [])).map((item) => [String(item.conditionId), String(item.mockClearedAt)]));
  return conditions.map((condition) => {
    const satisfiedAt = cleared.get(condition.id);
    return satisfiedAt && !condition.satisfiedAt ? { ...condition, uploaded: true, satisfiedAt } : condition;
  });
}

function clearPendingMockDeliveries(db: Store, now: string, submissionId: string | null, requestIds?: readonly string[]) {
  db.prepare(`UPDATE uwm_document_deliveries AS delivery SET mockClearedAt = ? FROM document_requests request
    WHERE delivery.requestId = request.id AND delivery.mockClearedAt IS NULL AND request.status = 'Accepted'
      AND (delivery.documentRevision = request.revision OR delivery.documentRevision IS NULL)
      AND (? IS NULL OR request.submissionId = ?)
      ${requestIds ? "AND request.id IN (SELECT value FROM json_each(?))" : ""}`)
    .run(now, submissionId, submissionId, ...(requestIds ? [JSON.stringify(requestIds)] : []));
}

// Called inside the workspace mutation after access to the loan is checked.
export function refreshMockUwmClearance(db: Store, loanId: string, submissionId: string, now: string, requestIds?: readonly string[]) {
  const saved = uwmSubmissionConditions(db, loanId, submissionId);
  if (!saved) return { error: "This UWM submission is unavailable on this loan." } as const;
  clearPendingMockDeliveries(db, now, submissionId, requestIds);
  const conditions = applyMockClearances(db, submissionId, saved, requestIds);
  const count = saved.reduce((total, condition, index) => total + Number(!condition.satisfiedAt && !!conditions[index].satisfiedAt), 0);
  const clearedAll = count > 0 && conditions.every((condition) => condition.satisfiedAt);
  if (clearedAll) {
    const status = db.prepare("SELECT status FROM submissions WHERE id = ?").get(submissionId)?.status;
    db.prepare("UPDATE submissions SET status = ?, conditions = ?, syncedAt = ? WHERE id = ?")
      .run("Conditions cleared", JSON.stringify(conditions), now, submissionId);
    if (typeof status === "string") recordUwmProgress(db, { id: submissionId, loanId, status: "Conditions cleared", conditions }, { status, conditions: saved }, now);
  } else {
    db.prepare("UPDATE submissions SET conditions = ?, syncedAt = ? WHERE id = ?").run(JSON.stringify(conditions), now, submissionId);
  }
  const label = count === 1 ? "condition" : "conditions";
  if (count) {
    recordMockConditionChanges(db, submissionId, conditions, saved, now);
    addApplicationActivity(db, loanId, `Mock UWM cleared ${count} ${label}.`, now);
  }
  return { message: count ? `Mock UWM cleared ${count} ${label}.` : "No new mock UWM clearances for this submission.", cleared: count };
}

function saveUwmSync(db: Store, files: UwmFile[], insightsSnapshot?: string) {
  const mock = insightsSnapshot === undefined;
  const now = new Date().toISOString();
  if (mock) clearPendingMockDeliveries(db, now, null);
  let imported = 0;
  let updated = 0;
  let conditionCount = 0;
  let alerts = 0;
  const update = db.prepare("UPDATE submissions SET status = ?, conditions = ?, syncedAt = ? WHERE id = ?");
  function refresh(existing: SavedUwmSubmission, status: string, incoming: Condition[]) {
    const previousConditions = JSON.parse(existing.conditions) as Condition[];
    const reopened = new Map(previousConditions.filter((item) => item.mockReopenedAt).map((item) => [item.id, item]));
    const conditions = mock ? applyMockClearances(db, existing.id, incoming.map((item) => reopened.get(item.id) ?? item)) : incoming;
    if (mock && conditions.some((item) => item.mockReopenedAt && !item.satisfiedAt) &&
      (status === "Conditions cleared" || status === "Wholesale - Clear To Close")) status = approvedWithConditions;
    if (mock && conditions.length && conditions.every((item) => item.satisfiedAt) && (existing.status === "Conditions cleared" ||
      previousConditions.some((item) => !item.satisfiedAt))) {
      status = "Conditions cleared";
    }
    update.run(status, JSON.stringify(conditions), now, existing.id);
    if (mock) recordMockConditionChanges(db, existing.id, conditions, previousConditions, now);
    alerts += recordUwmProgress(db, { id: existing.id, loanId: existing.loanId, status, conditions },
      { status: existing.status, conditions: previousConditions }, now, mock);
    conditionCount += conditions.length;
    updated++;
  }

  const findSubmission = db.prepare("SELECT id, loanId, status, conditions FROM submissions WHERE lender = 'UWM' AND externalId = ?");
  const observe = insightsSnapshot === undefined ? undefined : db.prepare(`INSERT INTO uwm_insights_observations (submissionId, snapshotId, observedAt)
    VALUES (?, ?, ?) ON CONFLICT(submissionId) DO UPDATE SET snapshotId = excluded.snapshotId, observedAt = excluded.observedAt`);
  if (observe) {
    const priorSource = db.prepare("SELECT 1 FROM uwm_insights_observations WHERE submissionId = ?");
    for (const { loan } of files) {
      const existing = findSubmission.get(loan.LoanId);
      if (existing && !priorSource.get(existing.id)) {
        return { error: "A UWM reference is already linked without verified Insights history. Review the existing submission before syncing." } as const;
      }
    }
  }
  for (const { loan, conditions } of files) {
    const existing = findSubmission.get(loan.LoanId) as SavedUwmSubmission | undefined;
    if (existing) {
      refresh(existing, loan.LoanStatusDescription, conditions);
      if (insightsSnapshot !== undefined) observe?.run(existing.id, insightsSnapshot, now);
      continue;
    }
    const contactId = crypto.randomUUID();
    const loanId = crypto.randomUUID();
    insertContact(db, {
      id: contactId, name: `${loan.PrimaryBorrowerFirstName} ${loan.PrimaryBorrowerLastName}`,
      email: "", phone: "", role: "Borrower",
    });
    insertLoan(db, {
      id: loanId, contactId, partnerId: null, officer: "", officerEmail: null, address: "", amount: 0, purpose: "Purchase",
      stage: initialStage[loan.LoanStatusDescription] ?? "Application", stageSince: now,
    });
    const submission = {
      id: crypto.randomUUID(), loanId, lender: "UWM", externalId: loan.LoanId, status: loan.LoanStatusDescription, conditions, syncedAt: now,
    };
    insertSubmission(db, submission);
    if (insightsSnapshot !== undefined) observe?.run(submission.id, insightsSnapshot, now);
    if (mock) recordMockConditionChanges(db, submission.id, conditions, [], now);
    alerts += recordUwmAlerts(db, submission, null, now).count;
    conditionCount += conditions.length;
    imported++;
  }
  if (mock) {
    const applicationFiles = db.prepare(`
      SELECT submissions.id, submissions.loanId, submissions.status, submissions.conditions
      FROM applications JOIN submissions
      ON submissions.loanId = applications.loanId AND submissions.externalId = applications.uwmReference
      WHERE submissions.lender = 'UWM' AND submissions.syncedAt IS NOT NULL
    `).all() as unknown as SavedUwmSubmission[];
    for (const file of applicationFiles) {
      // The mock lender keeps its file snapshot while a corrected 1003 is edited or delivered.
      refresh(file, file.status, JSON.parse(file.conditions) as Condition[]);
    }
  }
  db.prepare("INSERT INTO settings VALUES ('uwmSyncedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(now);
  if (insightsSnapshot !== undefined) {
    db.prepare("INSERT INTO settings VALUES ('uwmInsightsSnapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(insightsSnapshot);
  }
  return { imported, updated, conditions: conditionCount, alerts };
}

function saveMockUwmSync(db: Store, changed: boolean) {
  return saveUwmSync(db, mockLoans.map((loan) => ({
    loan: changed && loan.LoanId === mockUpdateLoan ? { ...loan, LoanStatusDescription: "Wholesale - Underwriting" } : loan,
    conditions: normalizeConditions(mockConditions(loan.LoanId, changed)),
  })));
}

function changesApplied(db: Store) {
  return !!db.prepare("SELECT 1 FROM settings WHERE key = 'mockUwmChangesApplied'").get();
}

export function simulateMockUwmChanges(db: Store) {
  return db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM submissions WHERE lender = 'UWM' AND externalId = ? AND syncedAt IS NOT NULL").get(mockUpdateLoan)) {
      return { error: "Sync the mock UWM pipeline first to load Charlotte Kim’s baseline." } as const;
    }
    if (changesApplied(db)) return { error: "The sample UWM changes are already applied in this workspace." } as const;
    const result = saveMockUwmSync(db, true);
    db.prepare("INSERT INTO settings VALUES ('mockUwmChangesApplied', '1')").run();
    return result;
  });
}

export function syncMockUwm(db: Store) {
  return db.transaction(() => saveMockUwmSync(db, changesApplied(db)));
}

export async function syncUwm(db: Store, connector: UwmConnector) {
  const currentSnapshot = () => db.prepare("SELECT value FROM settings WHERE key = 'uwmInsightsSnapshot'").get()?.value;
  const previousSnapshot = currentSnapshot();
  const { data: { Loans } } = await connector.listLoans();
  if (!Loans.length || new Set(Loans.map(({ LoanId }) => LoanId)).size !== Loans.length) {
    return { error: "UWM Insights returned an empty or duplicate pipeline. No changes were saved." } as const;
  }
  const files: UwmFile[] = [];
  for (let index = 0; index < Loans.length; index += 4) {
    files.push(...await Promise.all(Loans.slice(index, index + 4).map(async (loan) => ({
      loan, conditions: normalizeConditions(await connector.getConditions(loan.LoanId)),
    }))));
  }
  return db.transaction(() => currentSnapshot() === previousSnapshot ? saveUwmSync(db, files, crypto.randomUUID()) :
    { error: "Another UWM Insights sync saved a newer snapshot. Refresh the pipeline before syncing again." } as const);
}

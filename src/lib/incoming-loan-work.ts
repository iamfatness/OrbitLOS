import { incomingLoanWorkProcessingStatuses, incomingLoanWorkQuery, incomingLoanWorkUnavailable, type IncomingLoanWorkItem,
  type IncomingLoanWorkPage } from "./incoming-loan-work-model";
import { activeProcessingLoan, processingAcceptanceReady } from "./loan-processing";
import { unconfirmedMockOrder } from "./credit-aus-model";
import { latestManualReturnFollowUp, manualReturnDueAt, manualReturnLender, manualReturnPhase, manualReturnTitle, manualReturnWorkId,
  pendingManualReturn } from "./manual-lender-work";
import { readPlaybook } from "./playbooks";
import { preapprovalWorkSource } from "./preapproval-work";
import { isPreapprovalWork, preapprovalWorkLabels } from "./preapproval-policy-model";
import { currentRealtorFinancingSql, readyRealtorFinancingId, realtorFinancingDates, realtorFinancingReadyCandidateSql,
  realtorFinancingSource } from "./realtor-financing";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { isDemoStaff } from "./workspace-access";
import { fictionalUwmWorkspace, type UwmEnvironment } from "./uwm-live";
import { configuredUwmImportEnvironment } from "./uwm-user-access";

const pageSize = 8;
const sparseReceivedLimit = 32;

export function readIncomingLoanWorkPage(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  localName?: string, now = new Date(), limit = pageSize, uwmEnv?: UwmEnvironment): IncomingLoanWorkPage | { error: string } {
  const parsed = incomingLoanWorkQuery.safeParse(input);
  if (!parsed.success || !staff || staff.brokerage.id !== brokerageId) return { error: incomingLoanWorkUnavailable };
  const { view, after } = parsed.data;
  const { role } = staff.brokerage;
  if (view === "today" ? role === "Processor" : role === "LO") return { error: incomingLoanWorkUnavailable };

  const owned = localName ? "(loan.officerEmail = ? OR (loan.officerEmail IS NULL AND loan.officer = ?))" : "loan.officerEmail = ?";
  const ownerArgs = [staff.email, ...(localName ? [localName] : [])];
  const processing = view === "processing";
  const requireApproval = readPlaybook(db).requireSecondReview;
  const team = processing && role === "Admin";
  // The partial Received index avoids walking an entire portfolio when little is waiting for review.
  // Fall back to owner-first when a small probe finds a larger brokerage-wide backlog.
  const receivedFirst = team || !db.prepare("SELECT 1 FROM document_requests WHERE status = 'Received' LIMIT 1 OFFSET ?")
    .get(sparseReceivedLimit);
  const from = receivedFirst ? `FROM document_requests request CROSS JOIN loans loan ON loan.id = request.loanId
    ${processing ? "CROSS JOIN loan_processing processing ON processing.loanId = loan.id" : ""}` : processing ?
    `FROM loan_processing processing CROSS JOIN loans loan ON loan.id = processing.loanId
    CROSS JOIN document_requests request ON request.loanId = loan.id` :
    "FROM loans loan CROSS JOIN document_requests request ON request.loanId = loan.id";
  const contacts = "JOIN contacts contact ON contact.id = loan.contactId";
  const assigned = `processing.processorEmail IS NOT NULL AND processing.status IN (${incomingLoanWorkProcessingStatuses.map((status) => `'${status}'`).join(", ")})`;
  const scope = processing ? `${assigned}${team ? "" : " AND processing.processorEmail = ?"}` : owned;
  const manualReturn = `(${manualReturnWorkId}) IS NOT NULL`;
  const applications = processing ? "" : `UNION ALL
    SELECT CASE WHEN ${manualReturn} THEN 'lender-return' ELSE 'application' END, coalesce(${manualReturnWorkId}, loan.id), loan.id, contact.name,
      coalesce(app.reviewedAt, app.submittedAt, returnEntry.createdAt), app.revision,
      CASE WHEN ${manualReturn} THEN ${manualReturnTitle}
        WHEN EXISTS (SELECT 1 FROM application_versions version WHERE version.loanId = app.loanId AND version.revision < app.revision)
        THEN 'Corrected 1003' ELSE 'Submitted 1003' END, NULL, 0,
      ${manualReturnLender},
      CASE WHEN ${manualReturn} THEN ${manualReturnPhase(requireApproval)} END,
      CASE WHEN ${manualReturn} THEN ${manualReturnDueAt} END,
      CASE WHEN ${manualReturn} THEN returned.activityId END, returnFile.id
    FROM loans loan CROSS JOIN applications app ON app.loanId = loan.id ${contacts} ${pendingManualReturn}
    WHERE ${activeProcessingLoan} AND ${owned} AND (${manualReturn} OR (app.submittedAt IS NOT NULL AND app.reviewedAt IS NULL))`;
  const handoffs = processing ? `FROM loan_processing processing CROSS JOIN loans loan ON loan.id = processing.loanId
    LEFT JOIN applications app ON app.loanId = loan.id ${contacts}
    WHERE ${activeProcessingLoan} AND processing.status = 'Ready for processing' AND ${scope}
      AND ${processingAcceptanceReady(requireApproval)}` :
    `FROM loans loan CROSS JOIN loan_processing processing ON processing.loanId = loan.id ${contacts}
    WHERE ${activeProcessingLoan} AND processing.status = 'Returned to LO' AND processing.processorEmail IS NOT NULL AND ${owned}`;
  const documentArgs = processing ? (team ? [] : [staff.email]) : ownerArgs;
  const leadDocuments = !processing && staff.brokerage.pilot;
  const mockUnderwriting = !processing && fictionalUwmWorkspace(staff);
  const uwmEnvironment = configuredUwmImportEnvironment(uwmEnv, staff);
  const importEnvironment = processing ? undefined : uwmEnvironment;
  const deliveryEnvironment = processing ? uwmEnvironment : undefined;
  const realtorFinancing = !processing && staff.brokerage.pilot;
  const checkedAt = now.toISOString();
  const letters = !processing ? preapprovalWorkSource(db, staff, now, requireApproval) : undefined;
  const rows = db.prepare(`WITH incoming AS (
    SELECT 'document' AS kind, request.id, loan.id AS loanId, contact.name,
      coalesce(request.submittedAt, request.requestedAt) AS receivedAt, request.revision,
      request.kind || CASE WHEN request.recipient = 'Co-borrower' THEN ' · Co-borrower' ELSE '' END AS title,
      ${team ? "processing.processorName" : "NULL"} AS assignee, request.conditionId IS NOT NULL AS linkedCondition, NULL AS note,
      NULL AS returnStatus, NULL AS returnDueAt, NULL AS returnEventId, NULL AS returnSubmissionId
    ${from} ${contacts}
    WHERE ${activeProcessingLoan} AND ${scope} AND request.status = 'Received'
    ${applications}
    UNION ALL
    SELECT 'handoff', loan.id, loan.id, contact.name, processing.updatedAt, processing.revision,
      '${processing ? "Ready to accept" : "Returned from processing"}', ${processing && !team ? "loan.officer" : "processing.processorName"}, 0,
      nullif(processing.note, ''), NULL, NULL, NULL, NULL
    ${handoffs}
    ${importEnvironment ? `UNION ALL
    SELECT 'import-rejection', rejected.id, loan.id, contact.name, receipt.receivedAt, rejected.applicationRevision,
      'UWM rejected 1003 revision ' || rejected.applicationRevision, NULL, 0, NULL, NULL, NULL, NULL, NULL
    FROM loans loan ${contacts}
    JOIN uwm_operations rejected ON rejected.loanId = loan.id AND rejected.environment = ? AND rejected.kind = 'import'
    JOIN uwm_webhook_receipts receipt ON receipt.id = rejected.receiptId AND receipt.heldImport = 0
      AND receipt.kind = 'import' AND receipt.environment = rejected.environment AND receipt.transactionId = rejected.transactionId
      AND json_extract(receipt.body,'$.LoanStatus') = 'NotCompleted'
    WHERE ${activeProcessingLoan} AND ${owned} AND rejected.state = 'Failed'
      AND rejected.id = (SELECT recent.id FROM uwm_operations recent
        WHERE recent.loanId = loan.id AND recent.environment = rejected.environment AND recent.kind = 'import'
        ORDER BY recent.startedAt DESC, recent.rowid DESC LIMIT 1)` : ""}
    ${deliveryEnvironment ? `UNION ALL
    SELECT CASE WHEN follow.requestId IS NOT NULL THEN 'document-delivery-follow-up' ELSE 'document-delivery' END,
      request.id, loan.id, contact.name, coalesce(follow.recordedAt, request.updatedAt), evidence.applicationRevision,
      (CASE request.action WHEN 'upload-document' THEN 'UWM document upload'
        WHEN 'attach-documents' THEN 'UWM condition attachment' ELSE 'UWM underwriting submission' END) ||
        CASE WHEN follow.requestId IS NOT NULL THEN ' was not applied' ELSE ' needs verification' END,
      ${team ? "processing.processorName" : "NULL"}, 0, NULL, NULL, NULL, NULL, NULL
    FROM uwm_live_requests request JOIN loans loan ON loan.id = request.loanId ${contacts}
    JOIN loan_processing processing ON processing.loanId = loan.id
    JOIN uwm_request_evidence evidence ON evidence.requestId = request.id
    LEFT JOIN uwm_document_follow_ups follow ON follow.requestId = request.id
    LEFT JOIN uwm_document_follow_up_reviews followReview ON followReview.requestId = follow.requestId
    WHERE request.environment = ? AND (request.state = 'Unknown' OR (follow.requestId IS NOT NULL AND followReview.requestId IS NULL))
      AND request.action IN ('upload-document', 'attach-documents', 'submit-documents')
      AND ${activeProcessingLoan} AND ${scope}` : ""}
    ${mockUnderwriting ? `UNION ALL
    SELECT 'underwriting', attempt.id, loan.id, contact.name, attempt.requestedAt, coalesce(attempt.applicationRevision, 0),
      CASE WHEN json_extract(attempt.result, '$.conflict.detectedAt') IS NOT NULL AND json_extract(attempt.result, '$.conflict.reviewedAt') IS NULL
        THEN 'Admin review for mock ' || CASE attempt.service WHEN 'Credit' THEN 'credit' ELSE attempt.service END
        ELSE 'Unconfirmed mock ' || CASE attempt.service WHEN 'Credit' THEN 'credit' ELSE attempt.service END || ' result' END,
      NULL, 0, NULL, NULL, NULL, NULL, NULL
    FROM loans loan CROSS JOIN mock_credit_aus_runs attempt ON attempt.loanId = loan.id ${contacts}
    WHERE ${activeProcessingLoan} AND ${owned} AND json_extract(attempt.result, '$.status') = ?` : ""}
    ${leadDocuments ? `UNION ALL
    SELECT 'lead-document', request.id, lead.id, lead.name, coalesce(request.submittedAt, request.requestedAt),
      request.revision, request.kind || ' · Lead', NULL, 0, NULL, NULL, NULL, NULL, NULL
    FROM referral_leads lead JOIN lead_document_requests request ON request.leadId = lead.id
    WHERE lead.officerEmail = ? AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND request.status = 'Received'` : ""}
  )${realtorFinancing ? `, financing AS (
    SELECT 'realtor-financing' AS kind, request.id, loan.id AS loanId, contact.name,
      (SELECT max(decidedAt) FROM realtor_financing_decisions WHERE requestId = request.id AND decision = 'Approve') AS receivedAt,
      0 AS revision, 'Realtor financing summary ready' AS title, NULL AS assignee, 0 AS linkedCondition, NULL AS note,
      NULL AS returnStatus, NULL AS returnDueAt, NULL AS returnEventId, NULL AS returnSubmissionId
    FROM loans loan CROSS JOIN realtor_financing_requests request ON request.loanId = loan.id ${contacts}
    ${realtorFinancingSource}
    WHERE loan.officerEmail = ? AND ${realtorFinancingReadyCandidateSql} AND ${currentRealtorFinancingSql}
  )` : ""}, borrower_answers AS (
    SELECT 'question', question.id, loan.id, contact.name, question.answeredAt, question.revision,
      CASE WHEN question.recipient = 'Co-borrower' THEN 'Co-borrower answer' ELSE 'Borrower answer' END,
      ${team ? "processing.processorName" : "NULL"}, 0, NULL, NULL, NULL, NULL, NULL
    FROM borrower_questions question JOIN loans loan ON loan.id = question.loanId ${contacts}
    ${processing ? "JOIN loan_processing processing ON processing.loanId = loan.id" : ""}
    WHERE ${activeProcessingLoan} AND ${scope} AND question.status = 'Answered' AND question.answeredAt IS NOT NULL
      AND ${Number(isDemoStaff(staff) || staff.brokerage.pilot === true)} = 1
  )${letters ? `, letters AS (${letters.sql})` : ""}, page AS (
    SELECT * FROM (SELECT * FROM incoming UNION ALL SELECT * FROM borrower_answers${realtorFinancing ? " UNION ALL SELECT * FROM financing" : ""}
      ${letters ? `UNION ALL SELECT kind, loanId, loanId, name, receivedAt, revision,
        '', assignee, 0, note, NULL, NULL, NULL, NULL FROM letters` : ""})
    ${after ? "WHERE (receivedAt, kind, id) < (?, ?, ?)" : ""}
    ORDER BY receivedAt DESC, kind DESC, id DESC LIMIT ?
  ) SELECT page.*, ${latestManualReturnFollowUp} AS returnFollowUp FROM page ORDER BY receivedAt DESC, kind DESC, id DESC`)
    .all(...documentArgs, ...(processing ? [] : ownerArgs), ...documentArgs, ...(importEnvironment ? [importEnvironment, ...ownerArgs] : []),
      ...(deliveryEnvironment ? [deliveryEnvironment, ...documentArgs] : []),
      ...(mockUnderwriting ? [...ownerArgs, unconfirmedMockOrder] : []),
      ...(leadDocuments ? [staff.email] : []), ...(realtorFinancing ? [staff.email, ...realtorFinancingDates(checkedAt)] : []), ...documentArgs,
      ...(letters?.args ?? []),
      ...(after ? [after.receivedAt, after.kind, after.id] : []), limit + 1) as unknown as
      (Omit<IncomingLoanWorkItem, "linkedCondition" | "returnStatus" | "returnDeadline" | "returnEventId" | "returnFollowUp"> & {
        loanId: string; linkedCondition: number; returnStatus: IncomingLoanWorkItem["returnStatus"] | null; returnDueAt: string | null;
        returnEventId: string | null; returnFollowUp: string | null; returnSubmissionId: string | null;
      })[];
  const scanned = rows.slice(0, limit);
  const valid = scanned.filter(({ kind, loanId, id }) => kind !== "realtor-financing" || readyRealtorFinancingId(db, loanId, checkedAt) === id);
  const items = valid.map(({ kind, loanId, linkedCondition, returnStatus, returnDueAt, returnEventId, returnSubmissionId, returnFollowUp, ...item }): IncomingLoanWorkItem => {
    const work = { ...item, linkedCondition: Boolean(linkedCondition) };
    if (kind === "lead-document") return { ...work, kind, leadId: loanId };
    return { ...work, ...(isPreapprovalWork(kind) ? { title: preapprovalWorkLabels[kind].title } : {}), kind, loanId, ...(returnStatus ? { returnStatus } : {}),
      ...(returnDueAt ? { returnDeadline: { dueAt: returnDueAt, overdue: returnDueAt < checkedAt } } : {}),
      ...(returnEventId ? { returnEventId, returnSubmissionId } : {}), ...(returnFollowUp ? { returnFollowUp: JSON.parse(returnFollowUp) } : {}) };
  });
  const last = scanned.at(-1);
  return { items, next: rows.length > limit && last ? { id: last.id, kind: last.kind, receivedAt: last.receivedAt } : null };
}

import { incomingLoanWorkProcessingStatuses, incomingLoanWorkQuery, incomingLoanWorkUnavailable, type IncomingLoanWorkItem,
  type IncomingLoanWorkPage } from "./incoming-loan-work-model";
import { activeProcessingLoan, processingAcceptanceReady } from "./loan-processing";
import { latestManualReturnFollowUp, manualReturnDueAt, manualReturnPhase, pendingManualReturn } from "./manual-lender-work";
import { readPlaybook } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { isDemoStaff } from "./workspace-access";

const pageSize = 8;
const sparseReceivedLimit = 32;

export function readIncomingLoanWorkPage(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  localName?: string, now = new Date()): IncomingLoanWorkPage | { error: string } {
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
  const applications = processing ? "" : `UNION ALL
    SELECT CASE WHEN returnFile.id IS NULL THEN 'application' ELSE 'lender-return' END, coalesce(returnFile.id, loan.id), loan.id, contact.name,
      coalesce(app.reviewedAt, app.submittedAt, returnEntry.createdAt), app.revision,
      CASE WHEN returnFile.id IS NOT NULL THEN 'Manual lender return'
        WHEN EXISTS (SELECT 1 FROM application_versions version WHERE version.loanId = app.loanId AND version.revision < app.revision)
        THEN 'Corrected 1003' ELSE 'Submitted 1003' END, NULL, 0,
      returnFile.lender || ' · ' || returnFile.externalId,
      CASE WHEN returnFile.id IS NOT NULL THEN ${manualReturnPhase(requireApproval)} END,
      CASE WHEN returnFile.id IS NOT NULL THEN ${manualReturnDueAt} END,
      CASE WHEN returnFile.id IS NOT NULL THEN returned.activityId END
    FROM loans loan CROSS JOIN applications app ON app.loanId = loan.id ${contacts} ${pendingManualReturn}
    WHERE ${activeProcessingLoan} AND ${owned} AND (returnFile.id IS NOT NULL OR (app.submittedAt IS NOT NULL AND app.reviewedAt IS NULL))`;
  const handoffs = processing ? `FROM loan_processing processing CROSS JOIN loans loan ON loan.id = processing.loanId
    LEFT JOIN applications app ON app.loanId = loan.id ${contacts}
    WHERE ${activeProcessingLoan} AND processing.status = 'Ready for processing' AND ${scope}
      AND ${processingAcceptanceReady(requireApproval)}` :
    `FROM loans loan CROSS JOIN loan_processing processing ON processing.loanId = loan.id ${contacts}
    WHERE ${activeProcessingLoan} AND processing.status = 'Returned to LO' AND processing.processorEmail IS NOT NULL AND ${owned}`;
  const documentArgs = processing ? (team ? [] : [staff.email]) : ownerArgs;
  const leadDocuments = !processing && staff.brokerage.pilot;
  const rows = db.prepare(`WITH incoming AS (
    SELECT 'document' AS kind, request.id, loan.id AS loanId, contact.name,
      coalesce(request.submittedAt, request.requestedAt) AS receivedAt, request.revision,
      request.kind || CASE WHEN request.recipient = 'Co-borrower' THEN ' · Co-borrower' ELSE '' END AS title,
      ${team ? "processing.processorName" : "NULL"} AS assignee, request.conditionId IS NOT NULL AS linkedCondition, NULL AS note,
      NULL AS returnStatus, NULL AS returnDueAt, NULL AS returnEventId
    ${from} ${contacts}
    WHERE ${activeProcessingLoan} AND ${scope} AND request.status = 'Received'
    ${applications}
    UNION ALL
    SELECT 'handoff', loan.id, loan.id, contact.name, processing.updatedAt, processing.revision,
      '${processing ? "Ready to accept" : "Returned from processing"}', ${processing && !team ? "loan.officer" : "processing.processorName"}, 0,
      nullif(processing.note, ''), NULL, NULL, NULL
    ${handoffs}
    ${leadDocuments ? `UNION ALL
    SELECT 'lead-document', request.id, lead.id, lead.name, coalesce(request.submittedAt, request.requestedAt),
      request.revision, request.kind || ' · Lead', NULL, 0, NULL, NULL, NULL, NULL
    FROM referral_leads lead JOIN lead_document_requests request ON request.leadId = lead.id
    WHERE lead.officerEmail = ? AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND request.status = 'Received'` : ""}
  ), borrower_answers AS (
    SELECT 'question', question.id, loan.id, contact.name, question.answeredAt, question.revision,
      CASE WHEN question.recipient = 'Co-borrower' THEN 'Co-borrower answer' ELSE 'Borrower answer' END,
      ${team ? "processing.processorName" : "NULL"}, 0, NULL, NULL, NULL, NULL
    FROM borrower_questions question JOIN loans loan ON loan.id = question.loanId ${contacts}
    ${processing ? "JOIN loan_processing processing ON processing.loanId = loan.id" : ""}
    WHERE ${activeProcessingLoan} AND ${scope} AND question.status = 'Answered' AND question.answeredAt IS NOT NULL
      AND ${Number(isDemoStaff(staff) || staff.brokerage.pilot === true)} = 1
  ), page AS (
    SELECT * FROM (SELECT * FROM incoming UNION ALL SELECT * FROM borrower_answers) ${after ? "WHERE (receivedAt, kind, id) < (?, ?, ?)" : ""}
    ORDER BY receivedAt DESC, kind DESC, id DESC LIMIT ?
  ) SELECT page.*, ${latestManualReturnFollowUp} AS returnFollowUp FROM page ORDER BY receivedAt DESC, kind DESC, id DESC`)
    .all(...documentArgs, ...(processing ? [] : ownerArgs), ...documentArgs, ...(leadDocuments ? [staff.email] : []), ...documentArgs,
      ...(after ? [after.receivedAt, after.kind, after.id] : []), pageSize + 1) as unknown as
      (Omit<IncomingLoanWorkItem, "linkedCondition" | "returnStatus" | "returnDeadline" | "returnEventId" | "returnFollowUp"> & {
        loanId: string; linkedCondition: number; returnStatus: IncomingLoanWorkItem["returnStatus"] | null; returnDueAt: string | null;
        returnEventId: string | null; returnFollowUp: string | null;
      })[];
  const checkedAt = now.toISOString();
  const items = rows.slice(0, pageSize).map(({ kind, loanId, linkedCondition, returnStatus, returnDueAt, returnEventId, returnFollowUp, ...item }): IncomingLoanWorkItem => {
    const work = { ...item, linkedCondition: Boolean(linkedCondition) };
    if (kind === "lead-document") return { ...work, kind, leadId: loanId };
    return { ...work, kind, loanId, ...(returnStatus ? { returnStatus } : {}),
      ...(returnDueAt ? { returnDeadline: { dueAt: returnDueAt, overdue: returnDueAt < checkedAt } } : {}),
      ...(returnEventId ? { returnEventId } : {}), ...(returnFollowUp ? { returnFollowUp: JSON.parse(returnFollowUp) } : {}) };
  });
  const last = items.at(-1);
  return { items, next: rows.length > pageSize && last ? { id: last.id, kind: last.kind, receivedAt: last.receivedAt } : null };
}

import { incomingLoanWorkProcessingStatuses, incomingLoanWorkQuery, incomingLoanWorkUnavailable, type IncomingLoanWorkItem,
  type IncomingLoanWorkPage } from "./incoming-loan-work-model";
import { activeProcessingLoan, processingAcceptanceReady } from "./loan-processing";
import { latestManualReturnFollowUp, manualReturnDueAt, manualReturnPhase, pendingManualReturn } from "./manual-lender-work";
import { readPlaybook } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const pageSize = 8;

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
  const from = team ? `FROM document_requests request CROSS JOIN loans loan ON loan.id = request.loanId
    JOIN loan_processing processing ON processing.loanId = loan.id` : processing ?
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
  ), page AS (
    SELECT * FROM incoming ${after ? "WHERE (receivedAt, kind, id) < (?, ?, ?)" : ""}
    ORDER BY receivedAt DESC, kind DESC, id DESC LIMIT ?
  ) SELECT page.*, ${latestManualReturnFollowUp} AS returnFollowUp FROM page ORDER BY receivedAt DESC, kind DESC, id DESC`)
    .all(...documentArgs, ...(processing ? [] : ownerArgs), ...documentArgs,
      ...(after ? [after.receivedAt, after.kind, after.id] : []), pageSize + 1) as unknown as
      (Omit<IncomingLoanWorkItem, "linkedCondition" | "returnStatus" | "returnDeadline" | "returnEventId" | "returnFollowUp"> & {
        linkedCondition: number; returnStatus: IncomingLoanWorkItem["returnStatus"] | null; returnDueAt: string | null;
        returnEventId: string | null; returnFollowUp: string | null;
      })[];
  const checkedAt = now.toISOString();
  const items = rows.slice(0, pageSize).map(({ linkedCondition, returnStatus, returnDueAt, returnEventId, returnFollowUp, ...item }): IncomingLoanWorkItem =>
    ({ ...item, linkedCondition: Boolean(linkedCondition), ...(returnStatus ? { returnStatus } : {}),
      ...(returnDueAt ? { returnDeadline: { dueAt: returnDueAt, overdue: returnDueAt < checkedAt } } : {}),
      ...(returnEventId ? { returnEventId } : {}), ...(returnFollowUp ? { returnFollowUp: JSON.parse(returnFollowUp) } : {}) }));
  const last = items.at(-1);
  return { items, next: rows.length > pageSize && last ? { id: last.id, kind: last.kind, receivedAt: last.receivedAt } : null };
}

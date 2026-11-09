import { incomingLoanWorkProcessingStatuses, incomingLoanWorkQuery, incomingLoanWorkUnavailable, type IncomingLoanWorkItem,
  type IncomingLoanWorkPage } from "./incoming-loan-work-model";
import { activeProcessingLoan, processingAcceptanceReady } from "./loan-processing";
import { readPlaybook } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const pageSize = 8;

export function readIncomingLoanWorkPage(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  localName?: string): IncomingLoanWorkPage | { error: string } {
  const parsed = incomingLoanWorkQuery.safeParse(input);
  if (!parsed.success || !staff || staff.brokerage.id !== brokerageId) return { error: incomingLoanWorkUnavailable };
  const { view, after } = parsed.data;
  const { role } = staff.brokerage;
  if (view === "today" ? role === "Processor" : role === "LO") return { error: incomingLoanWorkUnavailable };

  const owned = localName ? "(loan.officerEmail = ? OR (loan.officerEmail IS NULL AND loan.officer = ?))" : "loan.officerEmail = ?";
  const ownerArgs = [staff.email, ...(localName ? [localName] : [])];
  const processing = view === "processing";
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
    SELECT 'application', loan.id, loan.id, contact.name, app.submittedAt, app.revision,
      CASE WHEN EXISTS (SELECT 1 FROM application_versions version WHERE version.loanId = app.loanId AND version.revision < app.revision)
        THEN 'Corrected 1003' ELSE 'Submitted 1003' END, NULL, 0, NULL
    FROM loans loan CROSS JOIN applications app ON app.loanId = loan.id ${contacts}
    WHERE ${activeProcessingLoan} AND ${owned} AND app.submittedAt IS NOT NULL AND app.reviewedAt IS NULL`;
  const handoffs = processing ? `FROM loan_processing processing CROSS JOIN loans loan ON loan.id = processing.loanId
    LEFT JOIN applications app ON app.loanId = loan.id ${contacts}
    WHERE ${activeProcessingLoan} AND processing.status = 'Ready for processing' AND ${scope}
      AND ${processingAcceptanceReady(readPlaybook(db).requireSecondReview)}` :
    `FROM loans loan CROSS JOIN loan_processing processing ON processing.loanId = loan.id ${contacts}
    WHERE ${activeProcessingLoan} AND processing.status = 'Returned to LO' AND processing.processorEmail IS NOT NULL AND ${owned}`;
  const documentArgs = processing ? (team ? [] : [staff.email]) : ownerArgs;
  const rows = db.prepare(`WITH incoming AS (
    SELECT 'document' AS kind, request.id, loan.id AS loanId, contact.name,
      coalesce(request.submittedAt, request.requestedAt) AS receivedAt, request.revision, request.kind AS title,
      ${team ? "processing.processorName" : "NULL"} AS assignee, request.conditionId IS NOT NULL AS linkedCondition, NULL AS note
    ${from} ${contacts}
    WHERE ${activeProcessingLoan} AND ${scope} AND request.status = 'Received'
    ${applications}
    UNION ALL
    SELECT 'handoff', loan.id, loan.id, contact.name, processing.updatedAt, processing.revision,
      '${processing ? "Ready to accept" : "Returned from processing"}', ${processing && !team ? "loan.officer" : "processing.processorName"}, 0,
      nullif(processing.note, '')
    ${handoffs}
  ) SELECT * FROM incoming ${after ? "WHERE (receivedAt, kind, id) < (?, ?, ?)" : ""}
    ORDER BY receivedAt DESC, kind DESC, id DESC LIMIT ?`)
    .all(...documentArgs, ...(processing ? [] : ownerArgs), ...documentArgs,
      ...(after ? [after.receivedAt, after.kind, after.id] : []), pageSize + 1) as unknown as (Omit<IncomingLoanWorkItem, "linkedCondition"> & { linkedCondition: number })[];
  const items = rows.slice(0, pageSize).map((item) => ({ ...item, linkedCondition: Boolean(item.linkedCondition) }));
  const last = items.at(-1);
  return { items, next: rows.length > pageSize && last ? { id: last.id, kind: last.kind, receivedAt: last.receivedAt } : null };
}

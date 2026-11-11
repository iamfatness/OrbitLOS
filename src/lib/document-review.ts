import { addApplicationActivity } from "./applications";
import { demoBrokerageId } from "./brokerage-model";
import { batchReviewsDocuments, documentBatchChanged, documentBatchEligible, type DocumentBatchInput } from "./document-batch-model";
import { pdfColumns } from "./document-files-model";
import { primaryDocumentRecipient, type LoanDocumentRequest } from "./document-model";
import type { Condition } from "./model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { archiveMockDocumentDelivery, refreshMockUwmClearance, sendMockConditionDocument } from "./uwm";

type Review = { loanId: string; requestId: string; revision: number; decision: "Accepted" | "Needs replacement";
  replacementNote: string; dueOn?: string | null; sendToMockUwm?: boolean };

export function reviewLoanDocument(db: Store, data: Review, staff: WorkspaceStaff | null, now: string) {
  const request = db.prepare(`SELECT request.kind, request.status, request.revision, request.dueOn, request.submissionId,
    request.conditionId, request.recipient, files.objectId
    FROM document_requests request LEFT JOIN document_files files ON files.requestId = request.id
    WHERE request.id = ? AND request.loanId = ?`).get(data.requestId, data.loanId);
  const replacement = data.decision === "Needs replacement";
  const submission = replacement && request?.status === "Accepted" && request.submissionId &&
    db.prepare("SELECT conditions FROM submissions WHERE id = ? AND loanId = ?").get(request.submissionId, data.loanId);
  const replaceAccepted = submission && (JSON.parse(String(submission.conditions)) as Condition[]).some((item) => item.id === request?.conditionId && !item.satisfiedAt);
  if (!request || (request.status !== "Received" && !replaceAccepted) || request.revision !== data.revision) {
    return { error: "This document request changed. Refresh the checklist before reviewing it." } as const;
  }
  if (replacement && !data.replacementNote) return { error: "Tell the borrower what to replace." } as const;
  const nextDueOn = replacement ? data.dueOn ?? null : request.dueOn;
  db.prepare(`UPDATE document_requests SET status = ?, replacementNote = ?, revision = revision + 1,
    dueOn = ?, deadlineRevision = deadlineRevision + ? WHERE id = ?`)
    .run(data.decision, replacement ? data.replacementNote : "", nextDueOn, Number(nextDueOn !== request.dueOn), data.requestId);
  if (replaceAccepted) archiveMockDocumentDelivery(db, data.requestId);
  if (!replacement) {
    db.prepare("INSERT INTO document_acceptances (requestId, revision, actor, at) VALUES (?, ?, ?, ?)")
      .run(data.requestId, data.revision + 1, staff?.name ?? "Demo staff", now);
    db.prepare(`INSERT INTO document_accepted_files (requestId, revision, objectId, uploadedAt, uploadMode)
      SELECT requestId, ?, objectId, uploadedAt, uploadMode FROM document_files WHERE requestId = ? AND objectId IS NOT NULL`)
      .run(data.revision + 1, data.requestId);
  }
  const accepted = request.objectId ? (staff?.brokerage.id === demoBrokerageId || staff?.brokerage.pilot ? "Demo PDF accepted" : "Borrower PDF accepted") : "Sample document accepted";
  addApplicationActivity(db, data.loanId, `${replacement ? "Replacement requested" : accepted} · ${request.kind}${request.recipient !== primaryDocumentRecipient ? ` · ${request.recipient}` : ""}${replacement && nextDueOn ? ` · Due ${nextDueOn}` : ""}`, now);
  if (data.sendToMockUwm) {
    const delivery = sendMockConditionDocument(db, data.loanId, data.requestId, data.revision + 1, now);
    if ("error" in delivery) return delivery;
    return { message: "Document accepted and sent to mock UWM. Check clearance when ready." } as const;
  }
  return { message: replacement ? "Replacement requested on the borrower checklist." : "Document accepted." } as const;
}

type BatchRow = Pick<LoanDocumentRequest, "id" | "status" | "revision" | "pdfStatus" | "uwmReceipt" | "submissionId"> & {
  openMock: number; documentRevision: number | null;
};

// The workspace command owns the transaction. Returning any error rolls back the whole selection.
export function processDocumentBatch(db: Store, input: DocumentBatchInput, staff: WorkspaceStaff | null, now: string) {
  const { loanId, batchId, action, items } = input;
  const selection = JSON.stringify({ action, items: [...items].sort((a, b) => a.requestId.localeCompare(b.requestId)) });
  const prior = db.prepare("SELECT loanId, selection, message FROM loan_document_batches WHERE id = ?").get(batchId);
  if (prior) return prior.loanId === loanId && prior.selection === selection ? { message: String(prior.message) } :
    { error: "This batch selection changed. Start a new batch." };
  const ready = db.prepare(`SELECT requests.id, requests.status, requests.revision, requests.submissionId, ${pdfColumns(Date.parse(now))},
    delivery.receipt AS uwmReceipt, delivery.documentRevision,
    (open.conditionId IS NOT NULL AND file.syncedAt IS NOT NULL AND file.lender = 'UWM') AS openMock
    FROM json_each(?) selected JOIN document_requests requests ON requests.id = selected.value
    LEFT JOIN document_files files ON files.requestId = requests.id
    LEFT JOIN uwm_document_deliveries delivery ON delivery.requestId = requests.id
    LEFT JOIN submissions file ON file.id = requests.submissionId AND file.loanId = requests.loanId
    LEFT JOIN processing_open_conditions open ON open.submissionId = file.id AND open.conditionId = requests.conditionId
    WHERE requests.loanId = ?`).all(JSON.stringify(items.map(({ requestId }) => requestId)), loanId) as unknown as BatchRow[];
  const rows = new Map(ready.map((row) => [row.id, row]));
  for (const item of items) {
    const row = rows.get(item.requestId);
    if (!row || row.revision !== item.revision || !documentBatchEligible(action, row, Boolean(row.openMock)) ||
      (action === "clear" && (row.uwmReceipt !== item.receipt || (row.documentRevision !== null && row.documentRevision !== row.revision)))) {
      return { error: documentBatchChanged };
    }
  }
  if (action === "clear") {
    const selectedBySubmission = new Map<string, string[]>();
    for (const { id, submissionId } of ready) {
      if (!submissionId) return { error: documentBatchChanged };
      const selected = selectedBySubmission.get(submissionId) ?? [];
      selected.push(id);
      selectedBySubmission.set(submissionId, selected);
    }
    for (const [submissionId, requestIds] of selectedBySubmission) {
      const result = refreshMockUwmClearance(db, loanId, submissionId, now, requestIds);
      if ("error" in result) return result;
      if (result.cleared !== requestIds.length) return { error: documentBatchChanged };
    }
  } else {
    for (const item of items) {
      const result = batchReviewsDocuments(action) ? reviewLoanDocument(db, { ...item, loanId, decision: "Accepted", replacementNote: "",
        sendToMockUwm: action === "accept-and-send" }, staff, now) : sendMockConditionDocument(db, loanId, item.requestId, item.revision, now);
      if ("error" in result) return result;
    }
  }
  const label = items.length === 1 ? "document" : "documents";
  const message = action === "accept" ? `Accepted ${items.length} ${label}.` : action === "clear" ?
    `Mock UWM cleared ${items.length} selected ${items.length === 1 ? "condition" : "conditions"}.` :
    `${action === "accept-and-send" ? "Accepted and sent" : "Sent"} ${items.length} ${label} to mock UWM.`;
  db.prepare("INSERT INTO loan_document_batches (id, loanId, selection, message, processedAt) VALUES (?, ?, ?, ?, ?)")
    .run(batchId, loanId, selection, message, now);
  return { message };
}

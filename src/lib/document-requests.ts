import { addApplicationActivity } from "./applications";
import { primaryDocumentRecipient, type DocumentKind, type DocumentRecipient } from "./document-model";
import type { Store } from "./store";

export function addDocumentRequest(db: Store, loanId: string, kind: DocumentKind, instructions: string, now: string,
  source?: { submissionId: string; conditionId: string }, dueOn: string | null = null, recipient: DocumentRecipient = primaryDocumentRecipient) {
  db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, submissionId, conditionId, dueOn, recipient)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), loanId, kind, instructions, now, source?.submissionId ?? null, source?.conditionId ?? null, dueOn, recipient);
  addApplicationActivity(db, loanId, `Document requested · ${kind}${source ? " · Lender condition" : ""}${dueOn ? ` · Due ${dueOn}` : ""}${recipient !== primaryDocumentRecipient ? ` · ${recipient}` : ""}`, now);
}

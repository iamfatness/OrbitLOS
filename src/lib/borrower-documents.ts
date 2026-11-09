import { pdfColumns } from "./document-files-model";
import { primaryDocumentRecipient, type DocumentRecipient, type DocumentRequest } from "./document-model";
import type { Store } from "./store";

export function documentRecipientAvailable(db: Store, loanId: string, recipient: DocumentRecipient) {
  return recipient === primaryDocumentRecipient || !!db.prepare("SELECT 1 FROM joint_applications WHERE loanId = ?").get(loanId);
}

export function borrowerDocuments(db: Store, loanId: string, recipient: DocumentRecipient) {
  return db.prepare(`SELECT requests.id, kind, instructions, status, replacementNote, submittedAt, revision, dueOn, ${pdfColumns()}
    FROM document_requests requests LEFT JOIN document_files files ON files.requestId = requests.id
    WHERE loanId = ? AND recipient = ? ORDER BY requestedAt, requests.id`).all(loanId, recipient)
    .map((item) => ({ ...item }) as unknown as DocumentRequest);
}

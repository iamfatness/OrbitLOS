import type { BorrowerDisclosure } from "./disclosure-model";
import { needsBorrowerDocument, type DocumentRequest } from "./document-model";

export const borrowerCorrectionTarget = "borrower-correction-form";
export const borrowerDisclosureTarget = "borrower-sample-disclosure";
export const borrowerDocumentVerificationTarget = "borrower-pdf-verification";
export const borrowerDocumentTarget = (id: string) => `borrower-document-${id}`;

export type BorrowerActionItem = {
  target: string;
  kind: "Correction" | "Signature" | "Replacement" | "Retry" | "Document";
  title: string;
  button: string;
  date: string | null;
};

const priority: Record<BorrowerActionItem["kind"], number> = {
  Correction: 0, Replacement: 1, Signature: 2, Retry: 3, Document: 4,
};

export function borrowerActions({ documents = [], disclosure, correction }: {
  documents?: DocumentRequest[];
  disclosure?: BorrowerDisclosure;
  correction?: string;
}): BorrowerActionItem[] {
  if (correction) return [{ target: borrowerCorrectionTarget, kind: "Correction", title: "Update your application",
    button: "Continue corrections", date: null }];
  const actions: BorrowerActionItem[] = [];
  if (disclosure?.state === "Available" && disclosure.signer.status === "Pending") {
    actions.push({ target: borrowerDisclosureTarget, kind: "Signature", title: "Review and sign the sample disclosure",
      button: "Open sample disclosure", date: disclosure.signBy });
  }
  for (const request of documents) {
    if (!needsBorrowerDocument(request.status) || request.pdfStatus === "Processing") continue;
    const kind = request.status === "Needs replacement" ? "Replacement" : request.pdfStatus === "Retry" ? "Retry" : "Document";
    const verb = kind === "Replacement" ? "Replace" : kind === "Retry" ? "Retry" : "Attach";
    actions.push({ target: borrowerDocumentTarget(request.id), kind, title: `${verb} ${request.kind.toLowerCase()}`,
      button: `Open ${request.kind.toLowerCase()} request`, date: request.dueOn });
  }
  return actions.sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31") || priority[a.kind] - priority[b.kind]);
}

import type { BorrowerDisclosure } from "./disclosure-model";
import { needsBorrowerDocument, type DocumentRequest } from "./document-model";
import { borrowerQuestionTarget, needsBorrowerAnswer, type BorrowerQuestion } from "./borrower-question-model";
import { borrowerFinancingTarget, type BorrowerRealtorFinancingView } from "./realtor-financing-model";

export const borrowerCorrectionTarget = "borrower-correction-form";
export const borrowerDisclosureTarget = "borrower-sample-disclosure";
export const borrowerDocumentVerificationTarget = "borrower-pdf-verification";
export const borrowerDocumentTarget = (id: string) => `borrower-document-${id}`;

export type BorrowerActionItem = {
  target: string;
  kind: "Correction" | "Signature" | "Replacement" | "Retry" | "Document" | "Question" | "Permission";
  title: string;
  button: string;
  date: string | null;
};

const priority: Record<BorrowerActionItem["kind"], number> = {
  Correction: 0, Replacement: 1, Signature: 2, Retry: 3, Document: 4, Question: 5, Permission: 6,
};

export function borrowerActions({ documents = [], questions = [], disclosure, correction, realtorFinancing }: {
  documents?: DocumentRequest[];
  questions?: BorrowerQuestion[];
  disclosure?: BorrowerDisclosure;
  correction?: string;
  realtorFinancing?: BorrowerRealtorFinancingView["request"];
}, answeredFinancingId?: string): BorrowerActionItem[] {
  if (correction) return [{ target: borrowerCorrectionTarget, kind: "Correction", title: "Update your application",
    button: "Continue corrections", date: null }];
  const actions: BorrowerActionItem[] = [];
  if (realtorFinancing?.permission === "Pending" && realtorFinancing.id !== answeredFinancingId) {
    actions.push({ target: borrowerFinancingTarget, kind: "Permission", title: "Review realtor sharing permission",
      button: "Open sharing request", date: null });
  }
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
  for (const question of questions) {
    if (!needsBorrowerAnswer(question.status)) continue;
    actions.push({ target: borrowerQuestionTarget(question.id), kind: "Question", title: question.prompt,
      button: question.status === "Needs clarification" ? "Open clarification" : "Open question", date: question.dueOn });
  }
  return actions.sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31") || priority[a.kind] - priority[b.kind]);
}

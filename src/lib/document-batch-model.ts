import { z } from "zod";
import type { LoanDocumentRequest } from "./document-model";
import type { Submission } from "./model";

export const documentWorkBatchLimit = 20;
export const documentBatchActions = ["accept", "accept-and-send", "send", "clear"] as const;
export type DocumentBatchAction = (typeof documentBatchActions)[number];
export const documentBatchLabels: Record<DocumentBatchAction, string> = {
  accept: "Accept documents", "accept-and-send": "Accept and send to mock UWM",
  send: "Send or retry mock UWM delivery", clear: "Check selected mock clearances",
};
const batchItem = z.object({ requestId: z.uuid(), revision: z.number().int().nonnegative(), receipt: z.string().min(1).max(180).optional() });
export const documentBatchInput = z.object({
  type: z.literal("processDocumentBatch"), loanId: z.string().min(1).max(100), batchId: z.uuid(),
  action: z.enum(documentBatchActions), reviewed: z.boolean().optional(),
  items: z.array(batchItem).min(1).max(documentWorkBatchLimit),
}).superRefine((data, context) => {
  if (new Set(data.items.map(({ requestId }) => requestId)).size !== data.items.length) {
    context.addIssue({ code: "custom", message: "Select each document only once." });
  }
  if (data.items.some(({ receipt }) => Boolean(receipt) !== (data.action === "clear"))) {
    context.addIssue({ code: "custom", message: "Refresh the selected delivery receipts before checking clearance." });
  }
  if (batchReviewsDocuments(data.action) && !data.reviewed) {
    context.addIssue({ code: "custom", message: "Confirm you reviewed each selected document." });
  }
});
export type DocumentBatchInput = z.infer<typeof documentBatchInput>;
export const documentBatchChanged = "One or more selected documents or conditions changed. Refresh the batch before trying again.";

export function batchReviewsDocuments(action: DocumentBatchAction) {
  return action === "accept" || action === "accept-and-send";
}

export function documentBatchEligible(action: DocumentBatchAction,
  document: Pick<LoanDocumentRequest, "status" | "pdfStatus" | "uwmReceipt">, openMockCondition: boolean) {
  if (document.pdfStatus === "Processing" || document.pdfStatus === "Retry") return false;
  if (action === "accept") return document.status === "Received";
  if (!openMockCondition) return false;
  if (action === "accept-and-send") return document.status === "Received";
  return document.status === "Accepted" && Boolean(document.uwmReceipt) === (action === "clear");
}

export function batchDocumentCondition(request: LoanDocumentRequest, submissions: readonly Submission[]) {
  const submission = submissions.find((file) => file.id === request.submissionId && file.loanId === request.loanId);
  const condition = submission?.conditions.find((item) => item.id === request.conditionId);
  return { submission, condition, openMock: !!submission?.syncedAt && submission.lender.toUpperCase() === "UWM" && !!condition && !condition.satisfiedAt };
}

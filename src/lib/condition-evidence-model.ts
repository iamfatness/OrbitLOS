import { z } from "zod";
import type { DocumentKind, LoanDocumentRequest } from "./document-model";
import type { Condition } from "./model";

const revision = z.number().int().nonnegative();
export const reuseConditionEvidenceInput = z.object({ type: z.literal("reuseConditionEvidence"),
  loanId: z.string().min(1).max(100), submissionId: z.string().min(1).max(100), conditionId: z.string().min(1).max(240),
  linkId: z.uuid(), conditionKey: z.string().min(1).max(2400),
  target: z.object({ id: z.uuid(), revision }).nullable(), source: z.object({ id: z.uuid(), revision }), confirmed: z.literal(true),
});
export type ReuseConditionEvidence = z.infer<typeof reuseConditionEvidenceInput>;
export type ConditionEvidenceReceipt = { id: string; revision: number; sourceId: string; sourceRevision: number;
  kind: DocumentKind; reviewedAt: string | null; reviewedBy: string | null; linkedAt: string; linkedBy: string; pdf: boolean };
export const conditionEvidenceChanged = "The condition or its checklist changed. Refresh before linking accepted evidence.";

export function conditionEvidenceKey(condition: Condition) {
  return JSON.stringify([condition.category, condition.description, condition.group, condition.satisfiedAt,
    condition.mockReopenedAt ?? null, condition.manual?.revision ?? null]);
}

export function canReuseConditionEvidence(request: LoanDocumentRequest) {
  return request.status === "Accepted" && !!request.submittedAt && (request.pdfStatus === "Ready" || !request.pdfStatus) &&
    !request.evidenceLinks?.some(({ revision }) => revision === request.revision);
}

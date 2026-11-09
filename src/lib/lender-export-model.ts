import { z } from "zod";
import { loanReviewsTarget } from "./loan-review-model";

export const manualReturnStatus = {
  borrower: "Waiting on borrower",
  review: "Corrected 1003 ready for review",
  approval: "Awaiting second review",
  export: "Ready for revised export",
  acknowledgment: "Awaiting lender acknowledgment",
} as const;

export type ManualReturnStatus = (typeof manualReturnStatus)[keyof typeof manualReturnStatus];
export const manualLenderAcknowledgmentTarget = "manual-lender-acknowledgment";
export const manualReturnAssignment = z.object({ eventId: z.uuid(), submissionId: z.string().min(1).max(100) });
export type ManualReturnAssignment = z.infer<typeof manualReturnAssignment>;

export const manualReturnSteps = {
  [manualReturnStatus.borrower]: { action: "Open borrower corrections", target: "loan-application" },
  [manualReturnStatus.review]: { action: "Review corrected 1003", target: "loan-application" },
  [manualReturnStatus.approval]: { action: "Open second review", target: loanReviewsTarget },
  [manualReturnStatus.export]: { action: "Open revised export", target: "manual-lender-export" },
  [manualReturnStatus.acknowledgment]: { action: "Open lender acknowledgment", target: manualLenderAcknowledgmentTarget },
} satisfies Record<ManualReturnStatus, { action: string; target: string }>;

export const exportName = z.object({
  first: z.string().trim().min(1).max(160),
  middle: z.string().trim().max(160),
  last: z.string().trim().min(1).max(160),
  suffix: z.string().trim().max(20),
});
export type ExportName = z.infer<typeof exportName>;

export const exportReviewedApplication = z.object({
  type: z.literal("exportReviewedApplication"), loanId: z.string().min(1).max(100),
  revision: z.number().int().nonnegative(), lenderRevision: z.number().int().nonnegative(),
  eventId: z.uuid(), names: z.array(exportName).min(1).max(5),
});

export function suggestExportName(name: string): ExportName {
  const parts = name.trim().split(/\s+/);
  const suffix = parts.length > 2 && /^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(parts.at(-1)!) ? parts.pop()! : "";
  return {
    first: parts.shift() ?? "", last: parts.pop() ?? "", middle: parts.join(" "), suffix,
  };
}

export const mismoHandoffCoverage = {
  mapped: "Borrowers and contact information, residences, employment and income, financial accounts and debts, owned properties, basic declarations, subject property, loan terms, and originator details.",
  review: "Complete lender-specific fields and extensions, taxpayer and account identifiers, detailed demographics, military service, title and settlement details, and signatures in the lender’s workflow.",
};

import { z } from "zod";

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

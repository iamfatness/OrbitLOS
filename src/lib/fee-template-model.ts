import { z } from "zod";
import { feeAllocationIssue, feeAllocations, feeAmounts, feeKeys, feeTemplateChoice } from "./quote-worksheet";
import type { FeeTemplateOrigin } from "./quote-worksheet";

export const feeTemplatesUnavailable = "Fee templates are unavailable in this workspace.";
export const feeTemplateChanged = "The fee template changed or no longer applies. Reload the templates and review the fees.";
export const feeTemplateConfig = z.object({
  title: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(120),
  effectiveOn: z.iso.date(),
  purpose: z.enum(["Any loan purpose", "Purchase", "Refinance"]),
  zip: z.string().regex(/^(?:\d{5})?$/),
  fees: feeAmounts.refine((fees) => feeKeys.some((key) => fees[key] !== null), "Enter at least one fee estimate."),
  allocations: feeAllocations.optional(),
}).superRefine((config, context) => {
  const issue = config.purpose !== "Purchase" && Object.values(config.allocations ?? {}).some((line) => line.seller > 0)
    ? "Choose Purchase as the loan purpose to save seller-paid fees."
    : feeAllocationIssue(config, config.purpose === "Purchase");
  if (issue) context.addIssue({ code: "custom", path: ["allocations"], message: issue });
});
export type FeeTemplateConfig = z.infer<typeof feeTemplateConfig>;
export interface FeeTemplate extends FeeTemplateOrigin {
  purpose: FeeTemplateConfig["purpose"];
  archived: boolean;
}

export const feeTemplateRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manage"), search: z.string().trim().max(80).default("") }),
  z.object({ type: z.literal("forQuote"), loanId: z.string().min(1).max(100), runId: z.string().min(1).max(100) }),
  z.object({ type: z.literal("publish"), ...feeTemplateChoice.shape, revision: z.number().int().nonnegative(), config: feeTemplateConfig }),
  z.object({ type: z.literal("archive"), ...feeTemplateChoice.shape, archived: z.boolean() }),
]);

export type FeeTemplatePage = { templates: FeeTemplate[]; asOf: string; more: boolean };

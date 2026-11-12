import { z } from "zod";
import { feeAllocationIssue, feeAllocations, feeAmounts, feeKeys, feeLabels, feePercentageBases, feeTemplateChoice } from "./quote-worksheet";
import type { FeeTemplateOrigin } from "./quote-worksheet";

export const feeTemplatesUnavailable = "Fee templates are unavailable in this workspace.";
export const feeTemplateChanged = "The fee template changed or no longer applies. Reload the templates and review the fees.";
export const feeTemplateConfig = z.object({
  title: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(120),
  effectiveOn: z.iso.date(),
  purpose: z.enum(["Any loan purpose", "Purchase", "Refinance"]),
  zip: z.string().regex(/^(?:\d{5})?$/),
  fees: feeAmounts,
  rules: z.partialRecord(z.enum(feeKeys), z.object({
    basis: z.enum(feePercentageBases), basisPoints: z.number().int().min(1, "Enter a percentage of at least 0.01%.").max(10_000, "Enter a percentage of 100% or less."),
  })).optional(),
  allocations: feeAllocations.optional(),
}).superRefine((config, context) => {
  if (!feeKeys.some((key) => config.fees[key] !== null || config.rules?.[key])) {
    context.addIssue({ code: "custom", path: ["fees"], message: "Enter at least one fee estimate." });
  }
  for (const key of feeKeys) {
    const rule = config.rules?.[key];
    if (!rule) continue;
    if (config.fees[key] !== null) context.addIssue({ code: "custom", path: ["rules", key], message: `Choose one calculation for ${feeLabels[key].toLowerCase()}.` });
    if (rule.basis === "Purchase price" && config.purpose !== "Purchase") {
      context.addIssue({ code: "custom", path: ["rules", key], message: "Choose Purchase as the loan purpose for purchase price fees." });
    }
  }
  const flatAllocations = Object.fromEntries(Object.entries(config.allocations ?? {}).filter(([key]) => !config.rules?.[key as keyof typeof config.fees]));
  const issue = config.purpose !== "Purchase" && Object.values(config.allocations ?? {}).some((line) => line.seller > 0)
    ? "Choose Purchase as the loan purpose to save seller-paid fees."
    : feeAllocationIssue({ fees: config.fees, allocations: flatAllocations }, config.purpose === "Purchase");
  if (issue) context.addIssue({ code: "custom", path: ["allocations"], message: issue });
});
export type FeeTemplateConfig = z.infer<typeof feeTemplateConfig>;
export interface FeeTemplate extends FeeTemplateOrigin {
  purpose: FeeTemplateConfig["purpose"];
  archived: boolean;
  rules?: FeeTemplateConfig["rules"];
  blocked?: string;
}

export const feeTemplateRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manage"), search: z.string().trim().max(80).default("") }),
  z.object({ type: z.literal("forQuote"), loanId: z.string().min(1).max(100), runId: z.string().min(1).max(100) }),
  z.object({ type: z.literal("publish"), ...feeTemplateChoice.shape, revision: z.number().int().nonnegative(), config: feeTemplateConfig }),
  z.object({ type: z.literal("archive"), ...feeTemplateChoice.shape, archived: z.boolean() }),
]);

export type FeeTemplatePage = { templates: FeeTemplate[]; asOf: string; more: boolean };

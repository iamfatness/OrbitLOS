import { z } from "zod";

export const closingGatePhases = ["closing", "funding"] as const;
export type ClosingGatePhase = (typeof closingGatePhases)[number];
export const closingGateRules = ["1003", "conditions", "checklist"] as const;
export type ClosingGateRule = (typeof closingGateRules)[number];
export const closingGateLabels: Record<ClosingGateRule, string> = {
  "1003": "Review the current 1003", conditions: "Clear open lender conditions", checklist: "Complete the closing checklist",
};
const revision = z.number().int().nonnegative();
const reason = z.string().trim().min(8, "Enter a reason of at least 8 characters.").max(300);
const ruleList = z.array(z.enum(closingGateRules)).max(closingGateRules.length)
  .refine((rules) => new Set(rules).size === rules.length, "Choose each check once.");
export const closingGatePolicy = z.object({ closing: ruleList, funding: ruleList });
export const closingGateInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("settings") }),
  z.object({ type: z.literal("loan"), loanId: z.string().min(1).max(100) }),
  z.object({ type: z.literal("publish"), revision, rules: closingGatePolicy, reason }),
]);
export const closingGateOverride = z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), reason });
export type ClosingGateOverride = z.infer<typeof closingGateOverride>;
export type ClosingGateSettings = { kind: "settings"; revision: number; rules: z.infer<typeof closingGatePolicy>; reason: string;
  publishedAt: string | null; publishedBy: string | null };
export type ClosingGateBlocker = { rule: ClosingGateRule; id: string; parentId: string; title: string; dueOn: string | null; target: string };
export type ClosingGateCheck = { blockers: ClosingGateBlocker[]; more: boolean; key: string | null };
export type ClosingGateLoan = { kind: "loan"; revision: number; canOverride: boolean; closing: ClosingGateCheck; funding: ClosingGateCheck };
export type ClosingGateResult = ClosingGateSettings | ClosingGateLoan | { error: string };
export const closingGateUnavailable = "Closing and funding checks are unavailable in this workspace.";

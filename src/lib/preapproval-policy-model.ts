import { z } from "zod";

const loanId = z.string().min(1).max(100);
const revision = z.number().int().nonnegative();
export const preapprovalPolicyConfig = z.object({
  maxAmountCents: z.number().int().positive().max(100_000_000_000).nullable(),
  maxExpiryDays: z.number().int().min(1).max(60),
  requireApproval: z.boolean(),
});
export const defaultPreapprovalPolicy = { revision: 0, maxAmountCents: null, maxExpiryDays: 60, requireApproval: false };
export const preapprovalPolicyRequests = [
  z.object({ type: z.literal("policyRead"), search: z.string().trim().max(100).default(""),
    after: z.object({ issuedAt: z.iso.datetime(), loanId }).optional() }),
  z.object({ type: z.literal("policySave"), revision, config: preapprovalPolicyConfig }),
  z.object({ type: z.literal("reviewLetter"), loanId, version: z.number().int().positive(), revision,
    decision: z.enum(["Approved", "Changes requested"]), note: z.string().trim().max(500) }),
] as const;
export type PreapprovalPolicyRequest = z.infer<(typeof preapprovalPolicyRequests)[number]>;
export type PreapprovalPolicy = z.infer<typeof preapprovalPolicyConfig> & { revision: number };
export type PreapprovalReviewReceipt = {
  decision: "Approved" | "Changes requested"; reviewer: string; decidedAt: string; note: string; policyRevision: number;
};
export type PreapprovalReview = { revision: number; canDecide: boolean; receipt: PreapprovalReviewReceipt | null };
export type PreapprovalPendingLetter = { loanId: string; borrower: string; issuedAt: string; version: number; issuer: string;
  amountCents: number; expiresOn: string };
export type PreapprovalPolicyResult = { policy: PreapprovalPolicy; pending: PreapprovalPendingLetter[];
  after: Pick<PreapprovalPendingLetter, "loanId" | "issuedAt"> | null };
export const samplePreapprovalTarget = "sample-preapproval-letters";

import { z } from "zod";
import { portalTokenPattern } from "./brokerage-model";
import { pricingPrograms } from "./pricing-model";

const loanId = z.string().min(1).max(100);
const requestId = z.uuid();
const basis = z.string().regex(/^[a-f0-9]{64}$/);
const token = z.string().regex(portalTokenPattern);

export const realtorFinancingTerms = z.strictObject({
  program: z.enum(pricingPrograms),
  termYears: z.number().int().min(1).max(50),
  amountCents: z.number().int().positive().max(2_500_000_000),
  quoteExpiresOn: z.iso.date(),
});
export type RealtorFinancingTerms = z.infer<typeof realtorFinancingTerms>;
export const financingPermissionActions = ["Approve", "Decline", "Revoke"] as const;
export const financingParticipants = ["Borrower", "Co-borrower"] as const;
export type FinancingParticipant = (typeof financingParticipants)[number];
export type FinancingPermission = "Pending" | "Approved" | "Declined" | "Revoked";

export const staffRealtorFinancingInput = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("read"), loanId }),
  z.strictObject({ type: z.literal("request"), loanId, requestId, basis }),
  z.strictObject({ type: z.literal("publish"), loanId, requestId, basis }),
  z.strictObject({ type: z.literal("withdraw"), loanId, requestId }),
]);
export const borrowerRealtorFinancingInput = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("read"), token }),
  z.strictObject({ type: z.literal("respond"), token, requestId, operationId: z.uuid(),
    decision: z.enum(financingPermissionActions) }),
]);

export type RealtorFinancingRequest = {
  id: string; realtorName: string; terms: RealtorFinancingTerms;
  requestedAt: string; requestedBy: string;
  publishedAt: string | null; publishedBy: string | null;
  endedAt: string | null; endReason: string | null;
  permissions: Array<{ participant: FinancingParticipant; status: FinancingPermission; decidedAt: string | null }>;
};
export type StaffRealtorFinancingView = {
  preview: { realtorName: string; terms: RealtorFinancingTerms; basis: string } | null;
  blocked: string | null;
  request: RealtorFinancingRequest | null;
  current: boolean;
  message?: string;
};
export type BorrowerRealtorFinancingView = {
  request: Pick<RealtorFinancingRequest, "id" | "realtorName" | "terms" | "publishedAt"> & {
    permission: FinancingPermission;
  } | null;
};
export type SharedRealtorFinancing = RealtorFinancingTerms & { publishedAt: string };
export const realtorFinancingUnavailable = "This pilot financing summary is unavailable.";
export const realtorFinancingTarget = "realtor-financing-summary";
export const borrowerFinancingTarget = "borrower-realtor-financing";

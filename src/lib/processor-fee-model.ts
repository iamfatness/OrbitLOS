import { z } from "zod";

const loanId = z.string().min(1).max(160);
const version = z.number().int().positive();
export const processorFeeInput = [
  z.object({ type: z.literal("readFeeTerms"), loanId, before: version.optional() }),
  z.object({ type: z.literal("offerFeeTerms"), loanId, requestId: z.uuid(), expectedVersion: version.nullable(),
    assignmentRevision: version, amountCents: z.number().int().min(0).max(999_999_999),
    reference: z.string().trim().min(1).max(180) }),
  z.object({ type: z.literal("respondFeeTerms"), loanId, version, response: z.enum(["Accepted", "Declined"]) }),
] as const;

export type ProcessorFeeInput = z.infer<(typeof processorFeeInput)[number]>;
export type ProcessorFeeTerms = {
  version: number; processorName: string; amountCents: number; reference: string;
  status: "Pending" | "Accepted" | "Declined"; offeredAt: string; offeredBy: string;
  decidedAt: string | null; endedReason: "Replaced" | "Assignment ended" | null;
};
export type ProcessorFeePage = {
  kind: "processorFeeTerms"; assignment: { name: string; revision: number } | null;
  current: ProcessorFeeTerms | null; agreed: ProcessorFeeTerms | null; history: ProcessorFeeTerms[]; next: number | null;
  latestVersion: number | null; canOffer: boolean; canRespond: boolean;
};

import { z } from "zod";
import { portalTokenPattern } from "./brokerage-model";

const loanId = z.string().min(1).max(100);
const version = z.number().int().positive();
export const preapprovalScopes = ["Property search", "Subject property"] as const;
export const preapprovalAudiences = ["Borrower", "Realtor"] as const;
export type PreapprovalAudience = typeof preapprovalAudiences[number];
const audience = z.enum(preapprovalAudiences);
const grantId = z.uuid();
export const preapprovalRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), loanId, beforeVersion: version.optional() }),
  z.object({ type: z.literal("issue"), loanId, requestId: z.uuid(), previousVersion: z.number().int().nonnegative(),
    applicationRevision: z.number().int().nonnegative(), amountCents: z.number().int().positive().max(100_000_000_000),
    scope: z.enum(preapprovalScopes), expiresOn: z.iso.date(), confirmed: z.literal(true) }),
  z.object({ type: z.literal("download"), loanId, version }),
  z.object({ type: z.literal("publish"), loanId, version, audience, grantId, previousGrantId: grantId.nullable(),
    recipientStamp: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }),
  z.object({ type: z.literal("withdraw"), loanId, version, audience, grantId }),
]);
export const sharedPreapprovalRequest = z.object({ token: z.string().regex(portalTokenPattern), audience, grantId });
export type SharedPreapprovalLetter = { grantId: string; version: number; expiresOn: string };
export type PreapprovalShareState = {
  audience: PreapprovalAudience; recipient: { name: string; stamp: string } | null; grantId: string | null;
  visible: boolean; firstDownloadedAt: string | null;
};

export type PreapprovalScope = typeof preapprovalScopes[number];
export type PreapprovalLetter = {
  version: number; applicationRevision: number; issuedAt: string; expiresOn: string; issuer: string;
  amountCents: number; scope: PreapprovalScope;
  status: "Current" | "Expired" | "Superseded" | "1003 changed" | "Loan inactive";
};
export type PreapprovalPage = {
  letters: PreapprovalLetter[]; beforeVersion: number | null; latestVersion: number;
  issue: { blocked: string } | { applicationRevision: number; amountCents: number; property: string | null;
    earliestExpiry: string; latestExpiry: string; suggestedExpiry: string };
  sharing: { version: number; canPublish: boolean; audiences: PreapprovalShareState[] } | null;
};
export type PreapprovalResult = { page: PreapprovalPage; issuedVersion?: number; shareMessage?: string } | { pdf: string; filename: string } | { error: string };
export const preapprovalUnavailable = "Sample preapproval letters are unavailable for this loan.";
export const sharedPreapprovalUnavailable = "This sample letter is unavailable. Refresh the portal for any current letter.";
export const preapprovalDemoLabel = "FICTIONAL DEMO - NOT VALID FOR A REAL TRANSACTION";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function preapprovalAmount(amountCents: number) {
  return usd.format(amountCents / 100);
}

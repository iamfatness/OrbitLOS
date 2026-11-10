import { z } from "zod";

export const cutoverFileSourceMaxBytes = 64 * 1024;
export const cutoverFileDocumentLimit = 100;
export const cutoverFileLenderLimit = 20;
export const cutoverFileConditionLimit = 100;
export const cutoverHistoryLimit = 300;
export const cutoverFileComparisonUnavailable = "This file comparison is unavailable. Check that source evidence was supplied and the destination inventory fits the pilot limits.";

const revision = z.int().nonnegative();
export const cutoverDocumentEvidence = z.strictObject({
  revision, acceptedRevisions: z.array(revision).max(cutoverHistoryLimit).optional(),
}).refine(({ revision: current, acceptedRevisions }) => !acceptedRevisions ||
  (new Set(acceptedRevisions).size === acceptedRevisions.length && acceptedRevisions.every((value) => value <= current)),
"Include each accepted revision once, at or before the current revision.");
export const cutoverDeliveryReceipt = z.strictObject({
  reference: z.string().trim().min(1).max(240), documentRevision: revision.nullable(), state: z.enum(["Current", "Prior"]),
});
const clearanceEvidence = z.strictObject({
  at: z.iso.datetime({ offset: true }), reference: z.string().trim().min(1).max(160).nullable(),
});
export const cutoverConditionEvidence = z.strictObject({
  receipts: z.array(cutoverDeliveryReceipt).max(cutoverHistoryLimit).optional(), clearance: clearanceEvidence.nullable().optional(),
}).refine(({ receipts, clearance }) => (receipts !== undefined || clearance !== undefined) &&
  (!receipts || new Set(receipts.map(({ reference, documentRevision }) => JSON.stringify([reference, documentRevision]))).size === receipts.length),
"Include delivery receipts or clearance evidence, with each receipt revision listed once.");

export const cutoverFileDocument = z.strictObject({
  kind: z.string().trim().min(1).max(160), instructions: z.string().trim().max(500),
  status: z.enum(["Requested", "Received", "Accepted", "Needs replacement"]), dueOn: z.iso.date().nullable(), evidence: cutoverDocumentEvidence.optional(),
});
const lenderCondition = z.strictObject({
  category: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(500),
  status: z.enum(["Open", "Delivered", "Cleared"]), evidence: cutoverConditionEvidence.optional(),
});
export const cutoverFileLenderFields = {
  lender: z.string().trim().min(1).max(160), reference: z.string().trim().min(1).max(160), status: z.string().trim().min(1).max(160),
};
const lenderFile = z.strictObject({ ...cutoverFileLenderFields, conditions: z.array(lenderCondition).max(cutoverFileConditionLimit) });
const fundingFollowUp = z.strictObject({ dueOn: z.iso.date(), status: z.enum(["Open", "Completed"]) }).nullable();
const fundingInventory = z.strictObject({
  closingDate: z.iso.date().nullable(), fundingDate: z.iso.date().nullable(), fundedPrincipalCents: z.int().positive().nullable(),
  borrowerFollowUp: fundingFollowUp, realtorFollowUp: fundingFollowUp, borrowerCallback: fundingFollowUp,
}).superRefine((funding, context) => {
  if (funding.fundingDate !== null) {
    if (funding.closingDate === null || funding.closingDate > funding.fundingDate) {
      context.addIssue({ code: "custom", path: ["closingDate"], message: "Record an actual closing date on or before funding." });
    }
    if (funding.fundedPrincipalCents === null) {
      context.addIssue({ code: "custom", path: ["fundedPrincipalCents"], message: "Include positive funded principal in cents for recorded funding." });
    }
  } else if (funding.fundedPrincipalCents !== null || funding.borrowerFollowUp || funding.realtorFollowUp || funding.borrowerCallback) {
    context.addIssue({ code: "custom", path: ["fundingDate"], message: "Record funding before adding funded principal or post-funding follow-up." });
  }
});

export function cutoverFileText(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function cutoverFileLenderKey(lender: string, reference: string) {
  return JSON.stringify([cutoverFileText(lender), reference]);
}

export const cutoverFileSource = z.strictObject({
  version: z.literal(1), documents: z.array(cutoverFileDocument).max(cutoverFileDocumentLimit).optional(),
  lenderFiles: z.array(lenderFile).max(cutoverFileLenderLimit).optional(), funding: fundingInventory.optional(),
}).superRefine(({ documents, lenderFiles, funding }, context) => {
  if (documents === undefined && lenderFiles === undefined && funding === undefined) {
    context.addIssue({ code: "custom", message: "Supply a document, lender, or funding inventory. Use an empty array or all-null funding fields to confirm there are no records." });
  }
  const files = lenderFiles ?? [];
  if (files.reduce((sum, file) => sum + file.conditions.length, 0) > cutoverFileConditionLimit) {
    context.addIssue({ code: "custom", path: ["lenderFiles"], message: `Include up to ${cutoverFileConditionLimit} lender conditions in total.` });
  }
  if (new Set(files.map(({ lender, reference }) => cutoverFileLenderKey(lender, reference))).size !== files.length) {
    context.addIssue({ code: "custom", path: ["lenderFiles"], message: "Include each lender reference once, with all its conditions together." });
  }
  const historyCount = (documents ?? []).reduce((sum, doc) => sum + (doc.evidence?.acceptedRevisions?.length ?? 0), 0) +
    files.reduce((sum, file) => sum + file.conditions.reduce((total, item) => total + (item.evidence?.receipts?.length ?? 0), 0), 0);
  if (historyCount > cutoverHistoryLimit) {
    context.addIssue({ code: "custom", message: `Include up to ${cutoverHistoryLimit} accepted revisions and delivery receipts in total.` });
  }
}).refine((source) => new TextEncoder().encode(JSON.stringify(source)).byteLength <= cutoverFileSourceMaxBytes, "Keep the fictional inventory under 64 KiB.");

export type CutoverFileSource = z.infer<typeof cutoverFileSource>;
export type CutoverFundingInventory = z.infer<typeof fundingInventory>;
export type CutoverDocumentEvidence = z.infer<typeof cutoverDocumentEvidence>;
export type CutoverConditionEvidence = z.infer<typeof cutoverConditionEvidence>;
export type CutoverDeliveryReceipt = z.infer<typeof cutoverDeliveryReceipt>;
export const cutoverFileSourceSection = { documents: "documents", lender: "lenderFiles", funding: "funding" } as const;
export type CutoverFileItem = keyof typeof cutoverFileSourceSection;
export type CutoverFileComparison = {
  fingerprint: string;
  rows: (CutoverEvidenceDifference & { evidence?: CutoverEvidenceDifference[] })[];
};
export type CutoverEvidenceDifference = { label: string; source: string | null; destination: string | null; status: "Matched" | "Changed" | "Missing" | "Added" };

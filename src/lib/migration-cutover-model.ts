import { z } from "zod";
import { cutoverFileSource, type CutoverFileComparison, type CutoverFileSource } from "./cutover-file-model";

export const cutoverUnavailable = "This fictional migration checklist is unavailable.";
export const cutoverItems = {
  application: { label: "Application coverage", detail: "Compare the source loan list with the linked drafts. Record where you checked missing 1003 sections and additional borrowers.",
    fileDetail: "Compare this draft with its source file. Record any missing 1003 sections or additional borrowers.", target: "loan-application" },
  documents: { label: "Borrower documents", detail: "Compare document inventories and current versions. Record where the evidence is available and which requests are outstanding.",
    fileDetail: "Compare this loan’s document checklist and versions with the source inventory.", target: "document-checklist" },
  lender: { label: "Lender status and conditions", detail: "Compare lender references, status, open conditions, and delivery or clearance records. Record the source you checked.",
    fileDetail: "Compare this loan’s lender reference, status, and delivery or clearance evidence with the source.", target: "lender-submissions" },
  funding: { label: "Closing and funding history", detail: "Compare recorded closing and funding dates, funded amounts, and follow-up obligations against the source.",
    fileDetail: "Compare actual closing and funding dates, the principal used in the Funding Dashboard, and current follow-up with the source.", target: "closing-workbench" },
} as const;
export const cutoverReadinessLimit = 100;
export type CutoverDraftItem = keyof typeof cutoverItems;
export type CutoverReadinessStatus = "Ready" | "Reviewed with exclusions" | "Needs review";
export type CutoverDraftReadiness = {
  status: CutoverReadinessStatus;
  checks: { item: CutoverDraftItem; state: "Reconciled" | "Out of scope" | "Review again" | "Pending"; reason?: string }[];
};
export type CutoverReadiness = { counts: Record<CutoverReadinessStatus, number> | null; limit: number };
export const cutoverCallbackItem = "callbacks";
export const cutoverCallbackStatuses = ["Needs recovery", "Needs owner", "Missing evidence", "On hold", "Ready", "Closed"] as const;
export type CutoverCallbackStatus = (typeof cutoverCallbackStatuses)[number];
export type CutoverCallbackEvidence = {
  fingerprint: string;
  counts: Record<CutoverCallbackStatus, number>;
  total: number;
  unrestored: number;
  oversized: boolean;
  items: { key: string; leadId: string | null; name: string; campaignName: string | null; owner: string | null;
    dueAt: string | null; scheduledAt: string | null; status: CutoverCallbackStatus; reason: string }[];
  next: string | null;
};
export const cutoverDecisions = ["Pending", "Reconciled", "Out of scope"] as const;
const source = z.string().min(1).max(60);
const loanId = z.string().min(1).max(100);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const cutoverBasis = z.union([z.uuid(), fingerprint]);
const callbackKey = z.string().regex(/^Callback:[a-zA-Z0-9_.:@-]{1,100}(?:\/[a-zA-Z0-9_.:@-]{1,100})?$/);
const draftCursor = z.object({ id: loanId, createdAt: z.string().min(1).max(48) });
export type CutoverDraftCursor = z.infer<typeof draftCursor>;
export const cutoverSourceInput = z.union([source.transform((origin) => ({ origin, after: undefined, callbackAfter: undefined })),
  z.object({ origin: source, after: draftCursor.optional(), callbackAfter: callbackKey.optional() })]).optional();
export const cutoverApplicationQuery = z.object({ origin: source, basis: cutoverBasis, loanId });
export type CutoverApplicationQuery = z.infer<typeof cutoverApplicationQuery>;
export const cutoverHandoffQuery = z.strictObject({ origin: source, basis: cutoverBasis });
export type CutoverHandoffQuery = z.infer<typeof cutoverHandoffQuery>;
export type CutoverHandoff = { html: string; filename: string };
export const cutoverFileLookupQuery = cutoverHandoffQuery.extend({ reference: z.string().trim().min(1).max(100) });
export type CutoverFileLookupQuery = z.infer<typeof cutoverFileLookupQuery>;
export const cutoverFileInventoryInput = cutoverApplicationQuery.extend({
  revision: z.number().int().nonnegative(), fictional: z.literal(true), source: cutoverFileSource,
});
export type CutoverFileInventoryInput = z.infer<typeof cutoverFileInventoryInput>;
export const restoreCutoverWorkInput = cutoverApplicationQuery.extend({
  type: z.literal("restoreCutoverWork"), preview: fingerprint,
});
export type RestoreCutoverWorkInput = z.infer<typeof restoreCutoverWorkInput>;
export type CutoverOpenWork = {
  fingerprint: string;
  owner: string | null;
  processor: string | null;
  documents: number;
  conditions: number;
  review: number;
};
export type CutoverFileInventory = {
  revision: number;
  source: CutoverFileSource | null;
  documents: CutoverFileComparison | null;
  lender: CutoverFileComparison | null;
  funding: CutoverFileComparison | null;
  openWork: CutoverOpenWork | null;
};
export const cutoverReviewInput = z.object({
  origin: source, basis: cutoverBasis, loanId: loanId.optional(),
  item: z.enum([...(Object.keys(cutoverItems) as (keyof typeof cutoverItems)[]), cutoverCallbackItem]),
  decision: z.enum(cutoverDecisions), note: z.string().trim().max(500), revision: z.number().int().nonnegative(), callbackFingerprint: fingerprint.optional(),
  applicationFingerprint: fingerprint.optional(), fileFingerprint: fingerprint.optional(),
}).refine(({ decision, note }) => decision === "Pending" || note.length > 0)
  .refine(({ item, loanId }) => item !== cutoverCallbackItem || !loanId);
export type CutoverReviewInput = z.infer<typeof cutoverReviewInput>;
export type CutoverReview = Pick<CutoverReviewInput, "item" | "decision" | "note" | "revision"> & {
  updatedBy: string; updatedAt: string; callbackCurrent?: boolean; applicationCurrent?: boolean; fileCurrent?: boolean;
};
export type CutoverDraft = { id: string; name: string; address: string; purpose: string; amount: number; reviews: CutoverReview[];
  readiness: CutoverDraftReadiness };
export type CutoverFileLookup = { draft: CutoverDraft } | { error: string };
export type MigrationCutover = {
  sources: string[];
  evidence: null | {
    origin: string; basis: string; batch: null | { received: number; expected: number; skipped: number; suppressed: number };
    links: number; byType: { contacts: number; leads: number; notes: number; tasks: number; callbacks?: number };
    undone: number; draftCount: number; draftNext: CutoverDraftCursor | null;
    drafts: CutoverDraft[]; reviews: CutoverReview[];
    callbacks: CutoverCallbackEvidence;
    readiness: CutoverReadiness;
  };
};

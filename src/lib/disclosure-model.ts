import { z } from "zod";
import { portalTokenPattern } from "./brokerage-model";
import type { AllocatedFeeLine, FeeInputs, QuoteOption } from "./quote-worksheet";
import { disclosureCalendarReference, type DisclosureCalendarBasis, type DisclosureDeadline } from "./disclosure-calendar-model";
import type { DisclosureTemplateBasis, DisclosureTemplateOptions } from "./disclosure-template-model";

export const disclosureTarget = "loan-disclosures";
export const findingDisclosureTarget = (caseId: string) => `${disclosureTarget}-finding-${caseId}`;
export const disclosureReviewPrefix = "disclosure-review:";
export const disclosureSigningPrefix = "disclosure-signing:";
export const disclosureDeclinePrefix = "disclosure-decline:";
export const disclosureDeclineTaskTitle = "Follow up on declined sample disclosure";
export const sampleDisclosureDocuments = ["Sample loan terms", "Sample fee summary", "Sample borrower acknowledgment"] as const;
export const disclosureDocuments = z.array(z.enum(sampleDisclosureDocuments)).min(1, "Choose at least one sample document.").max(sampleDisclosureDocuments.length)
  .refine((items) => new Set(items).size === items.length, "Choose each sample document once.");
export const disclosureSigners = ["Borrower", "Co-borrower"] as const;
export const disclosureResponses = ["Signed", "Declined"] as const;

const loanId = z.string().min(1).max(100);
const version = z.number().int().positive();
const current = { loanId, version, revision: version };
export const disclosureTemplateChoice = z.object({ id: z.uuid(), revision: version });
export const confirmClosingDisclosure = z.object({ type: z.literal("confirmClosingDisclosure"), ...current });
export const disclosureCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prepareDisclosurePackage"), loanId, previousVersion: version.nullable(),
    applicationRevision: z.number().int().nonnegative(), runId: loanId, offerId: loanId, feeRevision: version,
    documents: disclosureDocuments, template: disclosureTemplateChoice.optional(),
    signBy: z.iso.date(), deadlineCalendar: disclosureCalendarReference.optional(),
    reviewedPackageRevision: version.optional(), revisionNote: z.string().trim().min(1).max(500).optional() }),
  z.object({ type: z.literal("issueDisclosurePackage"), ...current }),
  z.object({ type: z.literal("respondToDisclosurePackage"), ...current, signer: z.enum(disclosureSigners), response: z.enum(disclosureResponses) }),
  z.object({ type: z.literal("reviewDisclosureDecline"), ...current, note: z.string().trim().min(1).max(500) }),
]);

export type DisclosureCommand = z.infer<typeof disclosureCommand>;
export const borrowerDisclosureResponse = z.strictObject({
  type: z.literal("respondToSampleDisclosure"), token: z.string().regex(portalTokenPattern),
  version, response: z.enum(disclosureResponses), confirmedDemo: z.literal(true),
});
export type BorrowerDisclosureResponse = Omit<z.infer<typeof borrowerDisclosureResponse>, "token">;
export type DisclosureDocument = (typeof sampleDisclosureDocuments)[number];
export type DisclosureSigner = {
  role: (typeof disclosureSigners)[number]; name: string;
  status: "Pending" | (typeof disclosureResponses)[number]; actedAt: string | null; receipt: string | null;
  respondedVia?: "Staff simulation" | "Borrower portal";
};

export type DisclosureSource = { applicationRevision: number; feeRevision: number; quote: QuoteOption };
export type DisclosurePackage = DisclosureSource & {
  version: number; revision: number; documents: DisclosureDocument[]; signers: DisclosureSigner[];
  preparedAt: string; signBy: string; issuedAt: string | null; supersededAt: string | null;
  deadlineBasis: DisclosureCalendarBasis | null;
  templateBasis?: DisclosureTemplateBasis | null;
  reviewReason: string | null;
  declineFollowUp: { at: string; actor: string; note: string } | null;
  changeReview: { fromVersion: number; reason: string; at: string; actor: string; note: string } | null;
};
export type DisclosureWork = {
  source: DisclosureSource | null; unavailable: string | null; packages: DisclosurePackage[];
  closingReviews: ClosingDisclosureReview[];
  suggestedDeadline?: DisclosureDeadline;
  templateOptions?: DisclosureTemplateOptions;
  draftTargetChanged?: { version: number; signBy: string } | null;
};
export type ClosingDisclosureReview = {
  version: number; revision: number; at: string; actor: string;
  applicationRevision: number; feeRevision: number; signers: DisclosureSigner[];
  feeAllocations?: AllocatedFeeLine[];
  changeReview: DisclosurePackage["changeReview"];
  current: boolean;
};
export type BorrowerDisclosure = {
  version: number; signBy: string; issuedAt: string; documents: DisclosureDocument[];
  state: "Available" | "Awaiting revision" | "Closed";
  signer: Pick<DisclosureSigner, "status" | "actedAt" | "receipt">;
  terms: Pick<QuoteOption, "product" | "rate" | "loanAmount">;
  fees: { closingCosts: number; cashToClose: number; items: FeeInputs["fees"]; allocations?: FeeInputs["allocations"] } | null;
};

export function disclosurePackageStatus(item: DisclosurePackage) {
  if (item.supersededAt) return "Superseded";
  if (item.reviewReason) return "Review required";
  if (!item.issuedAt) return "Draft";
  if (item.signers.some(({ status }) => status === "Declined")) return "Declined";
  return item.signers.every(({ status }) => status === "Signed") ? "Mock signing complete" : "Awaiting signatures";
}

export function disclosureTask(id: string) {
  return id.startsWith(disclosureReviewPrefix) || id.startsWith(disclosureSigningPrefix) || id.startsWith(disclosureDeclinePrefix);
}

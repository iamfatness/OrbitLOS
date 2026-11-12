import { z } from "zod";
import type { ApplicationDraft } from "./application-model";
import { portalTokenPattern } from "./brokerage-model";
import type { DocumentRequest } from "./document-model";
import type { ClosingPause } from "./model";
import { borrowerDisclosureResponse, type BorrowerDisclosure } from "./disclosure-model";
import { answerBorrowerQuestion, type BorrowerQuestion } from "./borrower-question-model";
import { borrowerDetailsSchema, normalizeBorrowerDetails, sampleUrla, type BorrowerDetails, type BorrowerSection } from "./urla";
import { applicationQuestionnaireInput, type ApplicationQuestionnaire } from "./application-questionnaire-model";

const loanId = z.string().min(1).max(100);
const token = z.string().regex(portalTokenPattern);
const revision = z.number().int().nonnegative();
export const coBorrowerSections = [
  ["identity", "Personal information"], ["work", "Employment"], ["finances", "Finances"],
  ["declarations", "Declarations"], ["realEstate", "Real estate"], ["military", "Military"],
  ["demographics", "Demographics"], ["acknowledgment", "Acknowledgment"],
] as const satisfies readonly (readonly [BorrowerSection, string])[];
export const coBorrowerReviewStep = coBorrowerSections.length;
export const jointLinkUnavailable = "This co-borrower link is invalid or expired. Ask your loan officer for a new link.";
export const jointBorrowerPortionsTarget = "joint-borrower-portions";

export const jointLinkCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("enableJointApplication"), loanId, revision }),
  z.object({ type: z.literal("revokeJointLink"), loanId, token }),
  z.object({ type: z.literal("replaceJointLink"), loanId, token }),
]);

export const coBorrowerCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), token }),
  borrowerDisclosureResponse,
  answerBorrowerQuestion,
  z.object({ type: z.literal("attachSample"), token, requestId: z.uuid(), revision }),
  z.object({ type: z.enum(["save", "submit"]), token, revision, step: z.number().int().min(0).max(coBorrowerReviewStep),
    draft: borrowerDetailsSchema, confirmedDemo: z.boolean(), questionnaire: applicationQuestionnaireInput }),
]);

export interface StaffJointApplication {
  token?: string;
  expiresAt: string;
  revokedAt: string | null;
  primarySubmittedAt: string | null;
  submittedAt: string | null;
  correctionNote: string;
}

export interface CoBorrowerApplication {
  revision: number;
  step: number;
  draft: BorrowerDetails;
  updatedAt: string;
  submittedAt: string | null;
  complete: boolean;
  confirmedDemo: boolean;
  questionnaire?: ApplicationQuestionnaire;
  documents?: DocumentRequest[];
  questions?: BorrowerQuestion[];
  closingPause?: ClosingPause;
  disclosure?: BorrowerDisclosure;
  realtorFinancing?: NonNullable<import("./realtor-financing-model").BorrowerRealtorFinancingView["request"]>;
  documentUploadsMode?: "mock";
  correctionNote?: string;
}

export function primaryJointDraft(draft: ApplicationDraft): ApplicationDraft {
  return { ...draft, coBorrowerName: "", coBorrowerEmployer: "", coBorrowerIncome: "",
    urla: { ...draft.urla, credit: { fields: { type: "Joint" }, groups: {} }, additional: [] } };
}

export function coBorrowerSubmissionIssues(draft: BorrowerDetails, confirmedDemo: boolean) {
  const { issues } = normalizeBorrowerDetails(draft, false, true, true);
  if (draft.identity.fields.name?.trim().toLowerCase() !== draft.acknowledgment.fields.signature?.trim().toLowerCase()) {
    issues.push("The sample signature must match your full legal name");
  }
  if (!confirmedDemo) issues.push("Sample data confirmation");
  return issues;
}

export function sampleCoBorrower(current: BorrowerDetails) {
  const name = current.identity.fields.name || "Jordan Sample";
  const draft = sampleUrla(name, true).primary;
  draft.identity.fields = { ...draft.identity.fields, name, email: current.identity.fields.email || "joint-borrower@example.test",
    cell: current.identity.fields.cell || "248-555-0176", taxId: "000-00-2345",
    current: JSON.stringify({ street: "24 Fictional Avenue", unit: "", city: "Troy", state: "MI", zip: "48084", country: "US" }) };
  draft.joint.fields.initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 16);
  return draft;
}

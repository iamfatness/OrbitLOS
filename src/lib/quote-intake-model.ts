import { z } from "zod";
import { intakePropertyState } from "./property-state";
import { portalTokenPattern } from "./brokerage-model";
import type { BranchChoice } from "./branch-model";
import { leadContactFields } from "./lead-inbox-model";
import { quoteAcceptedAnswers, quoteIntakeQuestions, quoteOverrideFields, quoteQuestionAnswers, type QuoteAcceptedAnswer } from "./quote-intake-questions";

export const quoteContactOptions = ["Email or phone", "Email required", "Phone required"] as const;
export const quoteFieldModes = ["Hidden", "Optional", "Required"] as const;
export const quoteThemes = ["Orbit", "Navy", "Evergreen"] as const;
export const quoteTimelines = ["This month", "In 1 to 3 months", "Just exploring"] as const;
export const defaultQuoteConsent = "I give the loan team permission to follow up about this request.";
export const quoteConsentLimit = 600;
const quoteConsentText = z.string().trim().min(1, "Enter the consent wording.").max(quoteConsentLimit);
const quoteConsentFingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().nonnegative();
const campaign = z.string().min(1).max(100);
const token = z.string().regex(portalTokenPattern);
export const quoteBranchLimit = 10;
const propertyZip = z.string().trim().regex(/^\d{5}$|^$/);
export const quoteBranchZip = z.string().trim().regex(/^\d{3}(?:\d{2})?$/, "Use a three-digit ZIP prefix or a full five-digit ZIP.");
const quoteOwner = z.email().max(254).toLowerCase().nullable();
const quoteBranches = z.array(z.object({ id: z.uuid(), name: z.string().trim().min(2).max(60),
  zip: quoteBranchZip, ownerEmail: quoteOwner, branchId: z.uuid().optional() }).refine(({ branchId, ownerEmail }) => !branchId || ownerEmail === null,
  "Set the default owner for a managed branch in Team.")).max(quoteBranchLimit).superRefine((rules, ctx) => {
  if (new Set(rules.map(({ id }) => id)).size !== rules.length || new Set(rules.map(({ zip }) => zip)).size !== rules.length) {
    ctx.addIssue({ code: "custom", message: "Use each ZIP or prefix only once per intake profile." });
  }
});

export const quotePurpose = leadContactFields.purpose;
export type QuotePurpose = z.infer<typeof quotePurpose>;
export const quoteProfiles = ["General", ...quotePurpose.options] as const;
export const quoteProfile = z.enum(quoteProfiles);
export type QuoteProfile = z.infer<typeof quoteProfile>;

export const quoteIntakeConfig = z.object({
  title: z.string().trim().min(4).max(90), introduction: z.string().trim().max(240),
  consentText: quoteConsentText.optional(),
  overrideFields: quoteOverrideFields.optional(),
  theme: z.enum(quoteThemes), contact: z.enum(quoteContactOptions),
  zip: z.enum(quoteFieldModes), timing: z.enum(quoteFieldModes),
  question: z.object({ prompt: z.string().trim().min(3).max(120), required: z.boolean() }).nullable(),
  questions: quoteIntakeQuestions.default([]),
  applicationQuestions: quoteIntakeQuestions.refine((questions) => questions.every(({ prefill }) => prefill === null)).optional(),
  campaignId: campaign.nullable(), ownerEmail: quoteOwner.optional(),
  branches: quoteBranches.optional(),
}).superRefine(({ branches, zip }, ctx) => {
  if (branches?.length && zip === "Hidden") {
    ctx.addIssue({ code: "custom", message: "Show the property ZIP field to use branch defaults." });
  }
});
export type QuoteIntakeConfig = z.infer<typeof quoteIntakeConfig>;
export type QuoteFormVersion = { profile: QuoteProfile; revision: number; config: QuoteIntakeConfig };
export type PublicQuoteForm = Omit<QuoteFormVersion, "config"> & {
  config: Omit<QuoteIntakeConfig, "campaignId" | "ownerEmail" | "branches" | "overrideFields" | "applicationQuestions">;
  consentFingerprint: string;
};
export type QuoteIntakeSettings = QuoteFormVersion & {
  active: boolean; effectiveRevision: number;
  campaigns: { id: string; name: string }[];
  managedBranches: BranchChoice[];
  history: { revision: number; publishedAt: string; active: boolean; consentText: string }[];
};
export type QuoteIntakeEvidence = { profile: QuoteProfile; revision: number; answers: QuoteAcceptedAnswer[] };

export function quoteConsentWording(config: Pick<QuoteIntakeConfig, "consentText">) {
  return config.consentText ?? defaultQuoteConsent;
}

const quoteConsentReceipt = z.strictObject({
  profile: quoteProfile, formRevision: revision, wording: quoteConsentText, acceptedAt: z.iso.datetime(),
});
export type QuoteConsentReceipt = z.infer<typeof quoteConsentReceipt>;

export function storedQuoteConsent(json: unknown): QuoteConsentReceipt | null {
  if (typeof json !== "string" || !json) return null;
  try {
    const result = quoteConsentReceipt.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch { return null; }
}

const quoteRoutingReceipt = z.object({
  profile: quoteProfile, formRevision: revision, websiteRevision: revision,
  rule: z.enum(["Branch default", "Profile default", "Website default", "Shared inbox", "Call campaign"]),
  branch: z.object({ name: z.string().max(60), zip: quoteBranchZip, id: z.uuid().optional(), revision: revision.optional() }).nullable(),
  destination: z.string().min(1).max(200), note: z.string().max(250),
  campaign: z.object({ name: z.string().max(160), revision: revision.nullable() }).nullable(),
});
export type QuoteRoutingReceipt = z.infer<typeof quoteRoutingReceipt>;
export type QuoteRoutingPreview = { routingPreview: QuoteRoutingReceipt };

export function storedQuoteRouting(json: unknown): QuoteRoutingReceipt | undefined {
  if (typeof json !== "string" || !json) return;
  try {
    const result = quoteRoutingReceipt.safeParse(JSON.parse(json));
    return result.success ? result.data : undefined;
  } catch {
    return;
  }
}

export function quoteRoutingLabel(receipt: QuoteRoutingReceipt) {
  const { rule, branch, destination, campaign } = receipt;
  if (rule === destination && !branch && !campaign) return rule;
  const basis = [rule, branch && `${branch.name} (ZIP ${branch.zip})`,
    campaign && `${campaign.name}${campaign.revision === null ? "" : ` routing v${campaign.revision}`}`].filter(Boolean);
  return `${basis.join(" · ")} → ${destination}`;
}

export function quoteIntakeEvidence(profileValue: unknown, revisionValue: unknown, json: unknown): QuoteIntakeEvidence | undefined {
  if (typeof json !== "string" || json === "[]") return;
  const profile = quoteProfile.safeParse(profileValue);
  const number = revision.safeParse(revisionValue);
  if (!profile.success || !number.success) return;
  try {
    const answers = quoteAcceptedAnswers.safeParse(JSON.parse(json));
    if (answers.success && answers.data.length) {
      return { profile: profile.data, revision: number.data, answers: answers.data };
    }
  } catch {
    return;
  }
}

export const defaultQuoteIntakeConfig: QuoteIntakeConfig = {
  title: "Request a mortgage quote", introduction: "Tell the loan team how to reach you and what you’re looking for.",
  theme: "Orbit", contact: "Email or phone", zip: "Optional", timing: "Hidden", question: null, questions: [], campaignId: null,
};
export const quoteIntakeSettingsRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), profile: quoteProfile.default("General"), search: z.string().trim().max(100).default("") }),
  z.object({ type: z.literal("publish"), profile: quoteProfile.default("General"), revision, config: quoteIntakeConfig }),
  z.object({ type: z.literal("previewRoute"), profile: quoteProfile, revision, config: quoteIntakeConfig, zip: propertyZip, hasPhone: z.boolean() }),
  z.object({ type: z.literal("retire"), profile: quotePurpose, revision }),
]);

export const quoteLeadInput = z.object({
  type: z.literal("submit").optional(), token, requestId: z.uuid(), formRevision: revision.default(0), ...leadContactFields,
  propertyState: intakePropertyState, zip: propertyZip.default(""), timing: z.enum(["", ...quoteTimelines]).default(""),
  answer: z.string().trim().max(200).default(""), consent: z.literal(true), website: z.literal("").optional(),
  consentFingerprint: quoteConsentFingerprint.optional(),
  answers: quoteQuestionAnswers,
}).refine((value) => !!(value.email || value.phone));
export const quotePortalRequest = z.union([z.object({ type: z.literal("read"), token, purpose: quotePurpose.optional() }), quoteLeadInput]);
export const quoteFormUnavailable = "This quote request link is unavailable.";
export const quoteSettingsUnavailable = "Quote form settings are available to demo and pilot admins.";
export const quoteFormChanged = "The quote form changed. Review the updated questions and submit again.";

export function quoteRequestPath(token: string, purpose?: QuotePurpose) {
  return `/quote${purpose ? `?purpose=${purpose}` : ""}#${token}`;
}

export function quoteResponseIssue(config: PublicQuoteForm["config"], data: Record<"email" | "phone" | "zip" | "timing" | "answer", string>) {
  if (config.contact === "Email required" && !data.email) return "Enter your email address.";
  if (config.contact === "Phone required" && !data.phone) return "Enter your phone number.";
  if (!data.email && !data.phone) return "Enter an email address or phone number.";
  if (config.zip === "Required" && !data.zip) return "Enter the five-digit property ZIP.";
  if (config.timing === "Required" && !data.timing) return "Choose your timeline.";
  if (config.question?.required && !data.answer) return "Answer the additional intake question.";
  return null;
}

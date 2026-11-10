import { z } from "zod";
import { portalTokenPattern } from "./brokerage-model";
import { leadContactFields } from "./lead-inbox-model";
import { quoteAcceptedAnswers, quoteIntakeQuestions, quoteQuestionAnswers, type QuoteAcceptedAnswer } from "./quote-intake-questions";

export const quoteContactOptions = ["Email or phone", "Email required", "Phone required"] as const;
export const quoteFieldModes = ["Hidden", "Optional", "Required"] as const;
export const quoteThemes = ["Orbit", "Navy", "Evergreen"] as const;
export const quoteTimelines = ["This month", "In 1 to 3 months", "Just exploring"] as const;
const revision = z.number().int().nonnegative();
const campaign = z.string().min(1).max(100);
const token = z.string().regex(portalTokenPattern);

export const quotePurpose = leadContactFields.purpose;
export type QuotePurpose = z.infer<typeof quotePurpose>;
export const quoteProfiles = ["General", ...quotePurpose.options] as const;
export const quoteProfile = z.enum(quoteProfiles);
export type QuoteProfile = z.infer<typeof quoteProfile>;

export const quoteIntakeConfig = z.object({
  title: z.string().trim().min(4).max(90), introduction: z.string().trim().max(240),
  theme: z.enum(quoteThemes), contact: z.enum(quoteContactOptions),
  zip: z.enum(quoteFieldModes), timing: z.enum(quoteFieldModes),
  question: z.object({ prompt: z.string().trim().min(3).max(120), required: z.boolean() }).nullable(),
  questions: quoteIntakeQuestions.default([]),
  campaignId: campaign.nullable(), ownerEmail: z.email().max(254).toLowerCase().nullable().optional(),
});
export type QuoteIntakeConfig = z.infer<typeof quoteIntakeConfig>;
export type QuoteFormVersion = { profile: QuoteProfile; revision: number; config: QuoteIntakeConfig };
export type PublicQuoteForm = Omit<QuoteFormVersion, "config"> & { config: Omit<QuoteIntakeConfig, "campaignId" | "ownerEmail"> };
export type QuoteIntakeSettings = QuoteFormVersion & {
  active: boolean; effectiveRevision: number;
  campaigns: { id: string; name: string }[];
  history: { revision: number; publishedAt: string; active: boolean }[];
};
export type QuoteIntakeEvidence = { profile: QuoteProfile; revision: number; answers: QuoteAcceptedAnswer[] };

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
  z.object({ type: z.literal("retire"), profile: quotePurpose, revision }),
]);

export const quoteLeadInput = z.object({
  type: z.literal("submit").optional(), token, requestId: z.uuid(), formRevision: revision.default(0), ...leadContactFields,
  zip: z.string().trim().regex(/^\d{5}$|^$/).default(""), timing: z.enum(["", ...quoteTimelines]).default(""),
  answer: z.string().trim().max(200).default(""), consent: z.literal(true), website: z.literal("").optional(),
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

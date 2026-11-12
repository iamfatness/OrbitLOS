import { z } from "zod";
import { requestedLoanAmount, type ApplicationDraft } from "./application-model";

export const quoteQuestionLimit = 4;
export const quoteQuestionTypes = ["Short text", "Yes or no", "Occupancy", "Dollar amount"] as const;
export const quoteOccupancyChoices = ["Primary residence", "Second home", "Investment property"] as const;
const yesOrNo = ["Yes", "No"] as const;
const prefill = z.enum(["occupancy", "loanAmount", "estimatedValue"]);
export type QuotePrefillField = z.infer<typeof prefill>;
export const quotePrefillFields = prefill.options;
export const quoteOverrideFields = z.array(prefill).max(3).refine((fields) => new Set(fields).size === fields.length);
const overrideReason = z.string().trim().min(4).max(240);
export const quotePrefillLabels = {
  occupancy: "Intended occupancy", loanAmount: "Requested loan amount", estimatedValue: "Estimated property value",
} satisfies Record<QuotePrefillField, string>;
export const quotePrefillSelection = z.object({
  revision: z.number().int().nonnegative(),
  fields: z.array(prefill).min(1).max(3).refine((fields) => new Set(fields).size === fields.length),
  correction: z.strictObject({
    policyRevision: z.number().int().nonnegative(),
    reason: overrideReason,
    values: z.partialRecord(prefill, z.string().trim().min(1).max(24)).refine((values) => Object.keys(values).length > 0),
  }).optional(),
});
export type QuotePrefillSelection = z.infer<typeof quotePrefillSelection>;
export type QuoteApplicationPrefill = Partial<Pick<ApplicationDraft, QuotePrefillField>>;
export type QuoteOverridePolicy = { revision: number; fields: QuotePrefillField[] };

const question = z.object({
  id: z.uuid(), prompt: z.string().trim().min(3).max(120), kind: z.enum(quoteQuestionTypes), required: z.boolean(),
  when: z.object({ questionId: z.uuid(), equals: z.enum([...yesOrNo, ...quoteOccupancyChoices]) }).nullable(),
  prefill: prefill.nullable(),
});
export type QuoteIntakeQuestion = z.infer<typeof question>;

type ChoiceAnswer = NonNullable<QuoteIntakeQuestion["when"]>["equals"];

export function quoteAnswerOptions(kind: QuoteIntakeQuestion["kind"]): readonly ChoiceAnswer[] {
  return kind === "Yes or no" ? yesOrNo : kind === "Occupancy" ? quoteOccupancyChoices : [];
}

function isChoiceAnswer(options: readonly ChoiceAnswer[], value: string) {
  return options.some((option) => option === value);
}

export function quotePrefillOptions(kind: QuoteIntakeQuestion["kind"]): readonly QuotePrefillField[] {
  return kind === "Occupancy" ? ["occupancy"] : kind === "Dollar amount" ? ["loanAmount", "estimatedValue"] : [];
}

export const quoteIntakeQuestions = z.array(question).max(quoteQuestionLimit).superRefine((questions, ctx) => {
  const earlier = new Map<string, QuoteIntakeQuestion>();
  const destinations = new Set<QuotePrefillField>();
  for (const [index, item] of questions.entries()) {
    const parent = item.when && earlier.get(item.when.questionId);
    const problem = earlier.has(item.id) ? "Question IDs must be unique." :
      item.when && (!parent || !quoteAnswerOptions(parent.kind).includes(item.when.equals)) ? "Choose a valid answer from an earlier choice question." :
      item.prefill && (!quotePrefillOptions(item.kind).includes(item.prefill) || destinations.has(item.prefill)) ?
        "Use a compatible 1003 field once per profile." : null;
    if (problem) ctx.addIssue({ code: "custom", path: [index], message: problem });
    earlier.set(item.id, item);
    if (item.prefill) destinations.add(item.prefill);
  }
});

export const quoteQuestionAnswers = z.record(z.uuid(), z.string().trim().max(200))
  .refine((answers) => Object.keys(answers).length <= quoteQuestionLimit).default({});
const acceptedAnswer = question.pick({ id: true, prompt: true, prefill: true }).extend({ value: z.string().min(1).max(200) });
export const quoteAcceptedAnswers = z.array(acceptedAnswer).max(quoteQuestionLimit);
export type QuoteAcceptedAnswer = z.infer<typeof acceptedAnswer>;

export function visibleQuoteQuestions(questions: readonly QuoteIntakeQuestion[], values: Readonly<Record<string, string>>) {
  const visible = new Set<string>();
  return questions.filter(({ id, when }) => {
    if (when && (!visible.has(when.questionId) || values[when.questionId] !== when.equals)) return false;
    visible.add(id);
    return true;
  });
}

export function collectQuoteAnswers(questions: readonly QuoteIntakeQuestion[], values: Readonly<Record<string, string>>, submitting = true):
  { answers: QuoteAcceptedAnswer[] } | { error: string } {
  const answers: QuoteAcceptedAnswer[] = [];
  for (const item of visibleQuoteQuestions(questions, values)) {
    const { id, prompt, kind, prefill } = item;
    const value = values[id]?.trim() ?? "";
    if (!value) {
      if (item.required && submitting) return { error: `Answer this question before submitting. ${prompt}` };
      continue;
    }
    const options = quoteAnswerOptions(kind);
    if (options.length && !isChoiceAnswer(options, value)) return { error: `Choose an available answer. ${prompt}` };
    if (kind === "Dollar amount" && requestedLoanAmount(value) === null) {
      return { error: `Enter a positive dollar amount up to $1 billion. ${prompt}` };
    }
    answers.push({ id, prompt, value, prefill });
  }
  return { answers };
}

export function reviewedQuotePrefill(answers: readonly QuoteAcceptedAnswer[], fields: readonly QuotePrefillField[]) {
  const values: QuoteApplicationPrefill = {};
  for (const field of fields) {
    const matches = answers.filter((answer) => answer.prefill === field);
    if (matches.length !== 1) return null;
    const value = matches[0].value;
    if (field === "occupancy") {
      const occupancy = quoteOccupancyChoices.find((choice) => choice === value);
      if (!occupancy) return null;
      values.occupancy = occupancy;
    } else {
      const amount = requestedLoanAmount(value);
      if (amount === null) return null;
      values[field] = String(amount);
    }
  }
  return values;
}

export const quoteOverrideEvidence = z.strictObject({
  profile: z.enum(["General", "Purchase", "Refinance"]),
  formRevision: z.number().int().nonnegative(),
  policyRevision: z.number().int().nonnegative(),
  changedAt: z.iso.datetime(),
  changedBy: z.string().min(1),
  changedByEmail: z.email(),
  reason: overrideReason,
  changes: z.array(z.strictObject({
    field: prefill, submitted: z.string().min(1).max(200), entered: z.string().min(1).max(24),
  })).min(1).max(3),
});
export type QuoteOverrideEvidence = z.infer<typeof quoteOverrideEvidence>;

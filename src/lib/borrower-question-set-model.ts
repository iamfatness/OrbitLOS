import { z } from "zod";
import { borrowerQuestionKinds, borrowerQuestionPrompt } from "./borrower-question-model";
import { documentRecipients, type DocumentRecipient } from "./document-model";
import { shiftReportDate } from "./report-date-range";

const loanId = z.string().min(1).max(100);
const revision = z.number().int().nonnegative();
export const questionSetItemLimit = 6;
export const questionSetCategories = ["Application follow-up", "Processing", "Closing", "Other"] as const;
export const questionSetsUnavailable = "Borrower question sets are unavailable in this workspace.";
export const questionSetChanged = "The question set changed. Refresh the preview before adding questions.";
export const questionSetConfig = z.object({
  title: z.string().trim().min(3).max(80),
  category: z.enum(questionSetCategories),
  items: z.array(z.object({ prompt: borrowerQuestionPrompt, kind: z.enum(borrowerQuestionKinds),
    dueDays: z.number().int().min(0).max(90).nullable() })).min(1).max(questionSetItemLimit)
    .refine((items) => new Set(items.map(({ prompt }) => prompt.toLowerCase())).size === items.length, "Use each question once in a set."),
});
export type QuestionSetConfig = z.infer<typeof questionSetConfig>;
export type QuestionSet = QuestionSetConfig & { id: string; revision: number; archived: boolean };
export const questionSetInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("settings") }),
  z.object({ type: z.literal("preview"), loanId }),
  z.object({ type: z.literal("publish"), id: z.uuid(), revision, config: questionSetConfig }),
  z.object({ type: z.literal("archive"), id: z.uuid(), revision: revision.min(1), archived: z.boolean() }),
]);
export const applyBorrowerQuestionSetInput = z.object({
  type: z.literal("applyBorrowerQuestionSet"), loanId, batchId: z.uuid(), setId: z.uuid(), revision: revision.min(1),
  applicationRevision: revision, asOf: z.iso.date(),
  items: z.array(z.object({ position: z.number().int().min(0).max(questionSetItemLimit - 1),
    recipient: z.enum(documentRecipients), dueOn: z.iso.date().nullable() })).min(1).max(questionSetItemLimit)
    .refine((items) => new Set(items.map(({ position }) => position)).size === items.length, "Choose each question once."),
});
export type ApplyBorrowerQuestionSet = z.infer<typeof applyBorrowerQuestionSetInput>;
export type QuestionSetPreview = { kind: "preview"; sets: QuestionSet[]; asOf: string; applicationRevision: number;
  recipients: DocumentRecipient[]; remaining: number };
export type QuestionSetResult = QuestionSetPreview | { kind: "settings"; sets: QuestionSet[]; moreArchived: boolean } | { error: string };

export const questionSetDueDate = (asOf: string, days: number | null) => days === null ? null : shiftReportDate(asOf, days);

import { z } from "zod";
import { portalTokenPattern } from "./brokerage-model";
import { documentRecipients, type DocumentRecipient } from "./document-model";

export const borrowerQuestionKinds = ["Short answer", "Yes or no"] as const;
export const borrowerQuestionPrompt = z.string().trim().min(5).max(240);
export const borrowerQuestionLimit = 24;
const questionId = z.uuid();
const loanId = z.string().min(1).max(100);
const revision = z.number().int().nonnegative();
export const requestBorrowerQuestion = z.strictObject({
  type: z.literal("requestBorrowerQuestion"), questionId, loanId, recipient: z.enum(documentRecipients),
  prompt: borrowerQuestionPrompt, kind: z.enum(borrowerQuestionKinds), dueOn: z.iso.date().nullable(),
});
export const reviewBorrowerQuestion = z.strictObject({
  type: z.literal("reviewBorrowerQuestion"), questionId, loanId, revision,
  decision: z.enum(["Reviewed", "Needs clarification", "Cancelled"]), clarification: z.string().trim().max(400),
}).refine(({ decision, clarification }) => decision === "Needs clarification" ? clarification.length >= 3 : !clarification,
  "Enter a borrower-facing clarification when asking for another answer.");
export const answerBorrowerQuestion = z.strictObject({
  type: z.literal("answerBorrowerQuestion"), token: z.string().regex(portalTokenPattern), questionId, revision,
  answer: z.string().trim().min(1).max(600),
});

export type StaffQuestionCommand = z.infer<typeof requestBorrowerQuestion> | z.infer<typeof reviewBorrowerQuestion>;
export type BorrowerQuestionResponse = Omit<z.infer<typeof answerBorrowerQuestion>, "token">;
export type QuestionStatus = "Requested" | "Answered" | "Needs clarification" | "Reviewed" | "Cancelled";
export type BorrowerQuestion = {
  id: string; prompt: string; kind: (typeof borrowerQuestionKinds)[number]; status: QuestionStatus;
  dueOn: string | null; revision: number; answer: string | null; answeredAt: string | null; clarification: string;
};
export type StaffBorrowerQuestion = BorrowerQuestion & {
  loanId: string; recipient: DocumentRecipient; requestedAt: string; askedBy: string; reviewedAt: string | null;
  reviewedBy: string | null; previousAnswers: { revision: number; answer: string; at: string }[];
  setBasis?: { title: string; revision: number };
};

export const borrowerQuestionTarget = (id: string) => `borrower-question-${id}`;
export const staffQuestionTarget = (id: string) => `loan-question-${id}`;
export const needsBorrowerAnswer = (status: QuestionStatus) => status === "Requested" || status === "Needs clarification";

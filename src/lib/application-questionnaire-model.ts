import { z } from "zod";
import type { DocumentRecipient } from "./document-model";
import type { QuoteProfile } from "./quote-intake-model";
import { collectQuoteAnswers, quoteQuestionAnswers, type QuoteAcceptedAnswer, type QuoteIntakeQuestion } from "./quote-intake-questions";

export const applicationQuestionnaireInput = z.strictObject({
  formRevision: z.number().int().nonnegative(),
  answers: quoteQuestionAnswers,
}).optional();
export type ApplicationQuestionnaireInput = z.infer<typeof applicationQuestionnaireInput>;
export type ApplicationQuestionnaire = NonNullable<ApplicationQuestionnaireInput> & {
  profile: QuoteProfile;
  questions: QuoteIntakeQuestion[];
};
export type ApplicationQuestionnaireReceipt = {
  profile: QuoteProfile;
  formRevision: number;
  applicant: DocumentRecipient;
  revision: number;
  submittedAt: string;
  answers: QuoteAcceptedAnswer[];
};

export function applicationQuestionIssue(questionnaire: ApplicationQuestionnaire | undefined) {
  if (!questionnaire) return;
  const result = collectQuoteAnswers(questionnaire.questions, questionnaire.answers);
  return "error" in result ? result.error : undefined;
}

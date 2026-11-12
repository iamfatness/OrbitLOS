import { isDeepStrictEqual } from "node:util";
import { primaryDocumentRecipient, type DocumentRecipient } from "./document-model";
import { currentQuoteForm } from "./quote-intake";
import type { QuoteProfile, QuotePurpose } from "./quote-intake-model";
import { collectQuoteAnswers, quoteAcceptedAnswers, quoteIntakeQuestions, quoteQuestionAnswers, type QuoteAcceptedAnswer } from "./quote-intake-questions";
import type { ApplicationQuestionnaire, ApplicationQuestionnaireInput, ApplicationQuestionnaireReceipt } from "./application-questionnaire-model";
import type { Store } from "./store";

export function pinApplicationQuestionnaire(db: Store, loanId: string, purpose: QuotePurpose) {
  const { profile, revision, config } = currentQuoteForm(db, purpose);
  if (config.applicationQuestions?.length) {
    db.prepare("INSERT INTO application_questionnaires (loanId, profile, formRevision, questions) VALUES (?, ?, ?, ?)")
      .run(loanId, profile, revision, JSON.stringify(config.applicationQuestions));
  }
}

export function readApplicationQuestionnaire(db: Store, loanId: string, applicant: DocumentRecipient): ApplicationQuestionnaire | undefined {
  const column = applicant === primaryDocumentRecipient ? "primaryAnswers" : "coBorrowerAnswers";
  const row = db.prepare(`SELECT profile, formRevision, questions, ${column} AS answers FROM application_questionnaires WHERE loanId = ?`).get(loanId);
  if (!row) return;
  return { profile: row.profile as QuoteProfile, formRevision: Number(row.formRevision),
    questions: quoteIntakeQuestions.parse(JSON.parse(String(row.questions))), answers: quoteQuestionAnswers.parse(JSON.parse(String(row.answers))) };
}

type PreparedAnswers = { evidence: QuoteAcceptedAnswer[]; values: Record<string, string> };

export function prepareApplicationAnswers(questionnaire: ApplicationQuestionnaire | undefined, input: ApplicationQuestionnaireInput, submit: boolean):
  PreparedAnswers | { status: number; error: string } | undefined {
  if (!questionnaire && !input) return;
  if (!questionnaire || (input && input.formRevision !== questionnaire.formRevision) || (submit && !input)) {
    return { status: 409, error: "Reopen this application to review the brokerage questions before continuing." };
  }
  if (!input) return;
  if (Object.keys(input.answers).some((id) => !questionnaire.questions.some((question) => question.id === id))) {
    return { status: 409, error: "Reopen this application to review the brokerage questions before continuing." };
  }
  const result = collectQuoteAnswers(questionnaire.questions, input.answers, submit);
  if ("error" in result) return { status: 422, error: result.error };
  return { evidence: result.answers, values: Object.fromEntries(result.answers.map(({ id, value }) => [id, value])) };
}

export function sameApplicationAnswers(questionnaire: ApplicationQuestionnaire | undefined, prepared: PreparedAnswers | undefined) {
  return !prepared || isDeepStrictEqual(questionnaire?.answers, prepared.values);
}

export function saveApplicationAnswers(db: Store, loanId: string, applicant: DocumentRecipient, prepared: PreparedAnswers,
  submittedAt: string | null, revision: number) {
  const column = applicant === primaryDocumentRecipient ? "primaryAnswers" : "coBorrowerAnswers";
  db.prepare(`UPDATE application_questionnaires SET ${column} = ? WHERE loanId = ?`).run(JSON.stringify(prepared.values), loanId);
  if (submittedAt) {
    db.prepare("INSERT INTO application_questionnaire_submissions (loanId, applicant, revision, submittedAt, answers) VALUES (?, ?, ?, ?, ?)")
      .run(loanId, applicant, revision, submittedAt, JSON.stringify(prepared.evidence));
  }
}

export function submittedApplicationAnswers(db: Store, loanId: string): ApplicationQuestionnaireReceipt[] {
  return db.prepare(`SELECT form.profile, form.formRevision, item.applicant, item.revision, item.submittedAt, item.answers
    FROM application_questionnaire_submissions item JOIN application_questionnaires form ON form.loanId = item.loanId
    WHERE item.loanId = ? ORDER BY item.applicant DESC, item.revision DESC`).all(loanId)
    .map((row) => ({ profile: row.profile as QuoteProfile, formRevision: Number(row.formRevision),
      applicant: row.applicant as DocumentRecipient, revision: Number(row.revision), submittedAt: String(row.submittedAt),
      answers: quoteAcceptedAnswers.parse(JSON.parse(String(row.answers))) }));
}

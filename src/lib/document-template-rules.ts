import { applicationDraft } from "./application-model";
import { primaryDocumentRecipient, type DocumentRecipient } from "./document-model";
import type { DocumentAnswerBasis, DocumentRuleMatch, DocumentTemplateRule } from "./document-template-model";
import { quoteAcceptedAnswers, quoteIntakeQuestions } from "./quote-intake-questions";
import type { Store } from "./store";

export function reviewedDocumentFacts(db: Store, loanId: string, recipient: DocumentRecipient, includeAnswers = false) {
  const row = db.prepare(`SELECT current.revision, reviewed.draft, reviewed.submittedAt FROM applications current
    JOIN application_versions reviewed ON reviewed.loanId = current.loanId AND reviewed.revision = current.revision
    WHERE current.loanId = ? AND current.submittedAt IS NOT NULL AND current.reviewedAt IS NOT NULL
      AND current.correctionNote = '' AND reviewed.reviewedAt IS NOT NULL`).get(loanId);
  if (!row) return null;
  const parsed = applicationDraft.safeParse(JSON.parse(String(row.draft)));
  if (!parsed.success) return null;
  const { occupancy, urla } = parsed.data;
  const person = recipient === primaryDocumentRecipient ? urla.primary : urla.additional[0];
  const hasJobs = person?.work.fields.hasJobs;
  const jobs = person?.work.groups.jobs ?? [];
  const current = hasJobs === "Yes" ? jobs.filter((job) => job.status === "Current") : [];
  const incomplete = hasJobs !== "No" && (hasJobs !== "Yes" || !jobs.length || jobs.some((job) =>
    (job.status !== "Current" && job.status !== "Previous") ||
    (job.status === "Current" && job.selfEmployed !== "Yes" && job.selfEmployed !== "No")));
  const receipt = includeAnswers && db.prepare(`SELECT form.formRevision, form.questions, response.revision, response.answers
    FROM application_questionnaire_submissions response JOIN application_questionnaires form ON form.loanId = response.loanId
    WHERE response.loanId = ? AND response.applicant = ? AND response.submittedAt <= ?
    ORDER BY response.revision DESC LIMIT 1`).get(loanId, recipient, row.submittedAt);
  return { revision: Number(row.revision), occupancy,
    answers: receipt ? { formRevision: Number(receipt.formRevision), responseRevision: Number(receipt.revision),
      questions: quoteIntakeQuestions.parse(JSON.parse(String(receipt.questions))),
      values: quoteAcceptedAnswers.parse(JSON.parse(String(receipt.answers))) } : undefined,
    wage: current.some((job) => job.selfEmployed === "No") ? true : incomplete ? null : false,
    selfEmployed: current.some((job) => job.selfEmployed === "Yes") ? true : incomplete ? null : false };
}

export function documentRuleDecision(rule: DocumentTemplateRule | undefined, facts: ReturnType<typeof reviewedDocumentFacts>):
  { match: DocumentRuleMatch; basis?: DocumentAnswerBasis } {
  if (!rule) return { match: "Matches" };
  if (!facts) return { match: "Needs reviewed 1003" };
  const occupancy = rule.occupancy ? facts.occupancy ? rule.occupancy === facts.occupancy : null : true;
  const employment = rule.employment === "Current wage employment" ? facts.wage :
    rule.employment === "Current self-employment" ? facts.selfEmployed : true;
  const criterion = rule.answer;
  const receipt = facts.answers;
  const question = criterion && receipt?.questions.find(({ id }) => id === criterion.questionId);
  const answer = criterion && receipt?.values.find(({ id }) => id === criterion.questionId);
  if (occupancy === false || employment === false) return { match: "Does not match" };
  if (criterion && question && (question.kind !== "Yes or no" || question.prompt !== criterion.prompt || (answer && answer.prompt !== criterion.prompt))) {
    return { match: "Question changed" };
  }
  if (answer && answer.value !== criterion?.equals) return { match: "Does not match" };
  if (occupancy === null || employment === null || (criterion && (!question || !answer))) return { match: "Missing answer" };
  return { match: "Matches", ...(criterion && receipt ? { basis: { ...criterion, formRevision: receipt.formRevision,
    responseRevision: receipt.responseRevision } } : {}) };
}

import type { ApplicationQuestionnaire, ApplicationQuestionnaireReceipt } from "@/lib/application-questionnaire-model";
import { dateTime } from "@/lib/utils";
import { QuoteQuestionFields } from "./quote-question-fields";

export function ApplicationQuestionFields({ questionnaire, change }: {
  questionnaire: ApplicationQuestionnaire;
  change: (answers: Record<string, string>) => void;
}) {
  return <section className="urla-person" id="application-questionnaire" aria-labelledby="application-questionnaire-heading">
    <h3 id="application-questionnaire-heading" tabIndex={-1}>Questions from your loan team</h3>
    <QuoteQuestionFields questions={questionnaire.questions} answers={questionnaire.answers} change={change} showRequired />
  </section>;
}

export function ApplicationQuestionReceipts({ receipts }: { receipts: ApplicationQuestionnaireReceipt[] }) {
  return <details className="document-form quote-consent-receipt">
    <summary>Brokerage questions and answers</summary>
    <ul className="document-list">
      {receipts.map(({ profile, formRevision, applicant, revision, submittedAt, answers }) =>
        <li className="document-item" key={`${applicant}:${revision}`}>
          <strong>{applicant}</strong>
          <p className="muted">{profile} questions v{formRevision} · {dateTime(submittedAt)} ET</p>
          {answers.length ? <dl className="record-form">{answers.map(({ id, prompt, value }) => <div key={id}>
            <dt>{prompt}</dt><dd className="quote-consent-copy">{value}</dd>
          </div>)}</dl> : <p className="muted">Submitted without answers to optional questions.</p>}
        </li>)}
    </ul>
  </details>;
}

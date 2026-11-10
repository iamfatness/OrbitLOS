import { useRef } from "react";
import { borrowerQuestionKinds, needsBorrowerAnswer, staffQuestionTarget, type StaffBorrowerQuestion } from "@/lib/borrower-question-model";
import { dateLabel, easternDate } from "@/lib/client-retention";
import { documentRecipients, primaryDocumentRecipient, type DocumentRecipient } from "@/lib/document-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { LoanBorrowerQuestionSet } from "./borrower-question-sets";

export function LoanBorrowerQuestions({ loanId, brokerageId, questions, canRequest, joint, busy, save }: {
  loanId: string; brokerageId: string; questions: StaffBorrowerQuestion[]; canRequest: boolean; joint: boolean;
  busy: boolean; save: (input: unknown, after?: () => void) => Promise<void>;
}) {
  const attempt = useRef<{ id: string; payload: string } | null>(null);
  return <section className="details-section document-section" aria-labelledby="loan-questions-heading">
    <div className="section-heading"><h3 id="loan-questions-heading">Borrower questions</h3>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: "refreshBorrowerQuestions", loanId })}>Refresh questions</Button>
    </div>
    {canRequest && <LoanBorrowerQuestionSet loanId={loanId} brokerageId={brokerageId} busy={busy} save={save} />}
    {canRequest ? <details className="document-form"><summary>Ask a borrower question</summary>
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        const input = { type: "requestBorrowerQuestion", loanId, prompt: String(fields.get("prompt") ?? ""),
          kind: fields.get("kind"), dueOn: fields.get("dueOn") || null,
          recipient: (fields.get("recipient") as DocumentRecipient | null) ?? primaryDocumentRecipient };
        const payload = JSON.stringify(input);
        if (attempt.current?.payload !== payload) attempt.current = { id: crypto.randomUUID(), payload };
        void save({ ...input, questionId: attempt.current.id }, () => { form.reset(); attempt.current = null; });
      }}>
        {joint && <label className="field">Question recipient<select name="recipient" disabled={busy}>
          {documentRecipients.map((recipient) => <option key={recipient}>{recipient}</option>)}</select></label>}
        <label className="field">Question for the borrower<textarea name="prompt" rows={2} minLength={5} maxLength={240} required disabled={busy} /></label>
        <label className="field">Answer format<select name="kind" disabled={busy}>{borrowerQuestionKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label className="field">Answer due date (optional)<input type="date" name="dueOn" min={easternDate()} disabled={busy} /></label>
        <Button type="submit" size="sm" disabled={busy}>Add question to portal</Button>
      </form>
    </details> : <p className="muted">New questions are available on active loans with a submitted 1003 and a borrower link.</p>}
    {questions.length ? <ul className="document-list">{questions.map((item) => {
      const action = { type: "reviewBorrowerQuestion", loanId, questionId: item.id, revision: item.revision };
      return <li key={item.id} id={staffQuestionTarget(item.id)} tabIndex={-1} className="document-item">
        <div className="document-item-head"><strong>{item.prompt}</strong><span className="pill">{item.status}</span></div>
        <p className="muted">{item.recipient} · {item.kind} · Asked by {item.askedBy}{item.dueOn && ` · Due ${dateLabel(item.dueOn)}`}</p>
        {item.setBasis && <p className="muted">Question set · {item.setBasis.title} · v{item.setBasis.revision}</p>}
        {item.answer && <p><strong>Borrower answer</strong> · {item.answer}{item.answeredAt && ` · ${dateTime(item.answeredAt)} ET`}</p>}
        {item.clarification && <p><strong>Clarification requested</strong> · {item.clarification}</p>}
        {item.reviewedAt && <small className="muted">{item.reviewedBy} · {dateTime(item.reviewedAt)} ET</small>}
        {item.previousAnswers.length > 1 && <details className="document-form"><summary>Earlier answers</summary>
          <ul className="document-list">{item.previousAnswers.slice(1).map((answer) => <li key={answer.revision}>
            <p>{answer.answer}</p><small className="muted">{dateTime(answer.at)} ET</small>
          </li>)}</ul></details>}
        {item.status === "Answered" && <div className="record-form">
          <div><Button size="sm" disabled={busy} onClick={() => void save({ ...action, decision: "Reviewed", clarification: "" })}>Mark answer reviewed</Button></div>
          <details className="document-form" key={item.revision}><summary>Ask for clarification</summary>
            <form className="record-form" onSubmit={(event) => {
              event.preventDefault();
              const clarification = new FormData(event.currentTarget).get("clarification");
              void save({ ...action, decision: "Needs clarification", clarification });
            }}>
              <label className="field">Clarification for the borrower<textarea name="clarification" rows={2} required minLength={3} maxLength={400} disabled={busy} /></label>
              <Button size="sm" type="submit" disabled={busy}>Request clarification</Button>
            </form>
          </details>
        </div>}
        {needsBorrowerAnswer(item.status) && <Button size="sm" variant="ghost" disabled={busy}
          onClick={() => void save({ ...action, decision: "Cancelled", clarification: "" })}>Cancel question</Button>}
      </li>;
    })}</ul> : <p className="empty-inline">No borrower questions on this loan yet.</p>}
  </section>;
}

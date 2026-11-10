import { MessageSquareText } from "lucide-react";
import { borrowerQuestionTarget, needsBorrowerAnswer, type BorrowerQuestion, type BorrowerQuestionResponse } from "@/lib/borrower-question-model";
import { dateLabel } from "@/lib/client-retention";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function BorrowerQuestionCards({ questions, busy, answer }: {
  questions?: BorrowerQuestion[];
  busy: boolean;
  answer: (input: BorrowerQuestionResponse) => void;
}) {
  if (!questions?.length) return null;
  return <section className="application-panel application-receipt document-section" aria-labelledby="borrower-questions-heading">
    <h2 id="borrower-questions-heading"><MessageSquareText size={19} aria-hidden="true" /> Questions from your loan team</h2>
    <ul className="document-list">{questions.map((question) => <li key={question.id} id={borrowerQuestionTarget(question.id)}
      className="document-item" tabIndex={-1} data-borrower-action-target>
      <div className="document-item-head"><strong>{question.prompt}</strong>
        <span className="pill">{question.status === "Answered" ? "Awaiting review" : question.status}</span></div>
      {question.dueOn && needsBorrowerAnswer(question.status) && <small>Due <time dateTime={question.dueOn}>{dateLabel(question.dueOn)}</time></small>}
      {question.status === "Needs clarification" && <p><strong>From your loan team</strong> · {question.clarification}</p>}
      {question.answer && <p><strong>{question.status === "Needs clarification" ? "Previous answer" : "Your answer"}</strong> · {question.answer}
        {question.answeredAt && <> · {dateTime(question.answeredAt)} ET</>}</p>}
      {needsBorrowerAnswer(question.status) && <form className="record-form" key={question.revision} onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        answer({ type: "answerBorrowerQuestion", questionId: question.id, revision: question.revision, answer: String(fields.get("answer") ?? "") });
      }}>
        <label className="field">Your answer{question.kind === "Yes or no" ? <select name="answer" defaultValue="" required disabled={busy}>
          <option value="">Choose an answer</option><option>Yes</option><option>No</option>
        </select> : <textarea name="answer" rows={3} maxLength={600} required disabled={busy} />}</label>
        <div><Button type="submit" size="sm" disabled={busy}>Submit answer</Button></div>
      </form>}
    </li>)}</ul>
  </section>;
}

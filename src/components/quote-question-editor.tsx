import { quoteAnswerOptions, quotePrefillLabels, quotePrefillOptions, quoteQuestionLimit, quoteQuestionTypes,
  type QuoteIntakeQuestion } from "@/lib/quote-intake-questions";
import { Button } from "./ui/button";

export function QuoteQuestionEditor({ questions, change, busy }: {
  questions: QuoteIntakeQuestion[]; change: (questions: QuoteIntakeQuestion[]) => void; busy: boolean;
}) {
  function update(id: string, fields: Partial<QuoteIntakeQuestion>) {
    change(questions.map((question) => question.id === id ? { ...question, ...fields } : question));
  }
  return <details className="document-form">
    <summary>Conditional follow-up questions{questions.length > 0 && ` · ${questions.length}`}</summary>
    <p className="muted">Show a question after a specific answer to an earlier choice. Staff review any 1003 fields before copying them.</p>
    {questions.map((question, index) => {
      const { id, kind, when } = question;
      const parents = questions.slice(0, index).filter((item) => quoteAnswerOptions(item.kind).length);
      const parent = parents.find((item) => item.id === when?.questionId);
      const choices = parent ? quoteAnswerOptions(parent.kind) : [];
      const mappings = quotePrefillOptions(kind);
      const usedBy = questions.some((item) => item.when?.questionId === id);
      return <fieldset className="record-form document-item" key={id} disabled={busy}>
        <legend>Follow-up {index + 1}</legend>
        <div className="form-grid">
          <label className="field">Question<input value={question.prompt} required minLength={3} maxLength={120}
            onChange={(event) => update(id, { prompt: event.target.value })} /></label>
          <label className="field">Answer type<select value={kind} onChange={(event) => {
            const next = quoteQuestionTypes.find((item) => item === event.target.value);
            if (next) update(id, { kind: next, prefill: next === kind ? question.prefill : null });
          }}>{quoteQuestionTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field">Show this question<select value={when?.questionId ?? ""} onChange={(event) => {
            const selected = parents.find((item) => item.id === event.target.value);
            update(id, { when: selected ? { questionId: selected.id, equals: quoteAnswerOptions(selected.kind)[0] } : null });
          }}>
            <option value="">Always</option>
            {parents.map((item) => <option key={item.id} value={item.id}>{item.prompt || `Follow-up ${questions.indexOf(item) + 1}`}</option>)}
            {when && !parent && <option value={when.questionId}>Unavailable choice question</option>}
          </select></label>
          {when && <label className="field">When the answer is<select value={choices.includes(when.equals) ? when.equals : ""} required
            onChange={(event) => {
              const equals = choices.find((choice) => choice === event.target.value);
              if (equals) update(id, { when: { ...when, equals } });
            }}>
            <option value="" disabled>Choose an answer</option>
            {choices.map((value) => <option key={value}>{value}</option>)}
          </select></label>}
          {mappings.length > 0 && <label className="field">Suggest a 1003 field<select value={question.prefill ?? ""}
            onChange={(event) => update(id, { prefill: mappings.find((field) => field === event.target.value) ?? null })}>
            <option value="">Keep as an intake note</option>
            {mappings.map((field) => <option key={field} value={field}>{quotePrefillLabels[field]}</option>)}
          </select></label>}
        </div>
        <label className="demo-confirm"><input type="checkbox" checked={question.required}
          onChange={(event) => update(id, { required: event.target.checked })} />
          <span>Require an answer when shown</span></label>
        <div><Button size="sm" variant="outline" disabled={usedBy || busy}
          onClick={() => change(questions.filter((item) => item.id !== id))}>Remove follow-up {index + 1}</Button></div>
        {usedBy && <p className="muted">Change the dependent questions before removing this one.</p>}
      </fieldset>;
    })}
    <div><Button size="sm" variant="outline" disabled={busy || questions.length >= quoteQuestionLimit} onClick={() => change([
      ...questions, { id: crypto.randomUUID(), prompt: "", kind: "Yes or no", when: null, required: false, prefill: null },
    ])}>Add follow-up question</Button></div>
  </details>;
}

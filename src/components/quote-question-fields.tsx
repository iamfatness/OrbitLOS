import { quoteAnswerOptions, visibleQuoteQuestions, type QuoteIntakeQuestion } from "@/lib/quote-intake-questions";

export function QuoteQuestionFields({ questions, answers, change, busy, showRequired = false }: {
  questions: QuoteIntakeQuestion[];
  answers: Record<string, string>;
  change: (answers: Record<string, string>) => void;
  busy?: boolean;
  showRequired?: boolean;
}) {
  function answer(id: string, value: string) {
    const next = { ...answers, [id]: value };
    change(Object.fromEntries(visibleQuoteQuestions(questions, next).map((item) => [item.id, next[item.id] ?? ""])));
  }
  return <>{visibleQuoteQuestions(questions, answers).map(({ id, prompt, kind, required }, index) => {
    const options = quoteAnswerOptions(kind);
    const field = { name: `intake:${id}`, disabled: busy, required, value: answers[id] ?? "" };
    return <label key={id} className="field">{prompt || `Question ${index + 1}`}{required ? (showRequired && " (required)") : " (optional)"}
      {options.length ? <select {...field} onChange={(event) => answer(id, event.target.value)}>
        <option value="">Choose an answer</option>{options.map((option) => <option key={option}>{option}</option>)}
      </select> : <input {...field} inputMode={kind === "Dollar amount" ? "decimal" : undefined}
        maxLength={kind === "Dollar amount" ? 14 : 200} autoComplete="off" onChange={(event) => answer(id, event.target.value)} />}
    </label>;
  })}</>;
}

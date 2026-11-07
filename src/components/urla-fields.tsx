import { useId } from "react";
import { active, readAddress, type AnswerRow, type Answers, type Question, type Questionnaire } from "@/lib/urla";
import { AddressEditor } from "./application-address";
import { Button } from "./ui/button";

export type ChangeAnswers = (change: (previous: Answers) => Answers) => void;

function Questions({ definition, row, change, lookupEnabled }: {
  definition: Question[]; row: AnswerRow; change: (key: string, update: (previous: string) => string) => void; lookupEnabled?: boolean;
}) {
  return <div className="form-grid">{definition.filter((question) => active(question.when, row)).map((question) => {
    const { key, label, choices, kind, required } = question;
    const answer = row[key] ?? "";
    const write = (value: string) => change(key, () => value);
    if (kind === "address") {
      const { street, country, ...location } = readAddress(answer);
      return <div className="urla-wide" key={key}><AddressEditor label={label} value={{ street, location, country }}
        required={required} lookupEnabled={lookupEnabled} change={(update) => change(key, (previous) => {
          const { street, country, ...location } = readAddress(previous);
          const next = update({ street, location, country });
          const address = { ...next.location, street: next.street, country: next.country ?? "" };
          return Object.values(address).some(Boolean) ? JSON.stringify(address) : "";
        })} /></div>;
    }
    if (kind === "multi") {
      const selected = answer.split("|").filter(Boolean);
      return <fieldset key={key} className="urla-choices urla-wide"><legend>{label}</legend>
        <div>{choices?.map((choice) => <label key={choice}><input type="checkbox" checked={selected.includes(choice)} onChange={(event) => {
          const next = event.target.checked
            ? choice === "Prefer not to provide" ? [choice] : [...selected.filter((item) => item !== "Prefer not to provide"), choice]
            : selected.filter((item) => item !== choice);
          write(next.join("|"));
        }} /> {choice}</label>)}</div>
      </fieldset>;
    }
    return <label key={key} className="field"><span>{label}</span>
      {choices ? <select value={answer} required={required} onChange={(event) => write(event.target.value)}>
        <option value="">Choose an answer</option>
        {choices.map((choice) => <option key={choice}>{choice}</option>)}
      </select> : <input value={answer} required={required} autoComplete="off" maxLength={key === "account" ? 4 : kind === "demoTaxId" ? 11 : 200}
        type={kind === "date" ? "date" : kind === "email" ? "email" : kind === "phone" ? "tel" : "text"}
        inputMode={kind === "money" ? "decimal" : kind === "integer" || key === "account" ? "numeric" : undefined}
        placeholder={kind === "demoTaxId" ? "000-00-1234" : undefined}
        onChange={(event) => write(event.target.value)} />}
    </label>;
  })}</div>;
}

export function QuestionnaireFields({ definition, answers, change, lookupEnabled }: {
  definition: Questionnaire; answers: Answers; change: ChangeAnswers; lookupEnabled?: boolean;
}) {
  const id = useId();
  return <section className="urla-questionnaire" aria-labelledby={id}>
    <h3 id={id}>{definition.label}</h3>
    <Questions definition={definition.fields} row={answers.fields} lookupEnabled={lookupEnabled}
      change={(key, update) => change((previous) => ({ ...previous, fields: { ...previous.fields, [key]: update(previous.fields[key] ?? "") } }))} />
    {definition.groups?.filter((group) => active(group.when, answers.fields)).map((group) => {
      const rows = answers.groups[group.key] ?? [];
      const edit = (update: (previous: AnswerRow[]) => AnswerRow[]) => change((previous) => ({
        ...previous, groups: { ...previous.groups, [group.key]: update(previous.groups[group.key] ?? []) },
      }));
      return <section className="urla-repeat" key={group.key} aria-label={group.label}>
        {rows.map((row, index) => <section className="urla-repeat-item" key={index}>
          <div className="section-heading"><h4>{group.label} {index + 1}</h4>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${group.label.toLowerCase()} ${index + 1}`}
              onClick={() => edit((items) => items.filter((_, item) => item !== index))}>Remove</Button>
          </div>
          <Questions key={rows.length} definition={group.fields} row={row} lookupEnabled={lookupEnabled}
            change={(key, update) => edit((items) => items.map((item, position) => position === index ? { ...item, [key]: update(item[key] ?? "") } : item))} />
        </section>)}
        <Button type="button" size="sm" variant="outline" disabled={rows.length >= 12} onClick={() => edit((items) => [...items, {}])}>
          Add {group.label.toLowerCase()}
        </Button>
      </section>;
    })}
  </section>;
}

export function QuestionnaireAnswers({ definition, answers }: { definition: Questionnaire; answers: Answers }) {
  const display = (fields: Question[], row: AnswerRow) => fields.filter((field) => row[field.key] && active(field.when, row)).map(({ key, label, kind }) => {
    let answer = row[key];
    if (kind === "demoTaxId") answer = "Fictional identifier ending in " + answer.slice(-4);
    if (kind === "multi") answer = answer.split("|").join(", ");
    if (kind === "address") {
      const { street, unit, city, state, zip, country } = readAddress(answer);
      answer = [street, unit && "Unit " + unit, city, [state, zip].filter(Boolean).join(" "), country].filter(Boolean).join(", ");
    }
    return <div key={key}><dt>{label}</dt><dd>{answer}</dd></div>;
  });
  const fields = display(definition.fields, answers.fields);
  const groups = definition.groups?.filter((group) => active(group.when, answers.fields))
    .flatMap((group) => (answers.groups[group.key] ?? []).map((row, index) => ({
      title: `${group.label} ${index + 1}`, fields: display(group.fields, row),
    }))).filter((group) => group.fields.length) ?? [];
  if (!fields.length && !groups.length) return null;
  return <section><h4>{definition.label}</h4>
    {fields.length > 0 && <dl className="form-grid">{fields}</dl>}
    {groups.map((group) => <div className="urla-review-row" key={group.title}><h5>{group.title}</h5><dl className="form-grid">{group.fields}</dl></div>)}
  </section>;
}

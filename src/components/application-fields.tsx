import type { ApplicationDraft } from "@/lib/application-model";

type FieldName = Exclude<keyof ApplicationDraft, "confirmedDemo">;
type Entry = { name: FieldName; label: string; type?: "email" | "tel" | "date" | "number"; options?: string[] };
const yesNo = ["Yes", "No"];

const sections: { heading: string; fields: Entry[] }[] = [
  { heading: "Borrower information", fields: [
    { name: "borrowerName", label: "Borrower full name" }, { name: "email", label: "Borrower email", type: "email" },
    { name: "phone", label: "Phone", type: "tel" }, { name: "coBorrowerName", label: "Co-borrower full name (optional)" },
    { name: "currentAddress", label: "Current address" }, { name: "priorAddress", label: "Prior address (if applicable)" },
  ] },
  { heading: "Employment and income", fields: [
    { name: "employer", label: "Current employer" }, { name: "occupation", label: "Occupation" },
    { name: "employmentStart", label: "Employment start date", type: "date" },
    { name: "monthlyIncome", label: "Gross monthly income", type: "number" }, { name: "priorEmployer", label: "Prior employer (if applicable)" },
    { name: "coBorrowerEmployer", label: "Co-borrower employer (optional)" },
    { name: "coBorrowerIncome", label: "Co-borrower gross monthly income (optional)", type: "number" },
  ] },
  { heading: "Assets, debts, and real estate", fields: [
    { name: "assets", label: "Total available assets", type: "number" },
    { name: "monthlyDebts", label: "Total monthly debt payments", type: "number" },
    { name: "otherProperty", label: "Other real estate owned (optional)" },
  ] },
  { heading: "Property and loan", fields: [
    { name: "propertyAddress", label: "Subject property address" },
    { name: "estimatedValue", label: "Estimated property value", type: "number" },
    { name: "loanAmount", label: "Requested loan amount", type: "number" },
    { name: "purpose", label: "Loan purpose", options: ["Purchase", "Refinance"] },
    { name: "occupancy", label: "Intended occupancy", options: ["Primary residence", "Second home", "Investment property"] },
  ] },
  { heading: "Declarations", fields: [
    { name: "borrowedDownPayment", label: "Will you borrow funds for the down payment or closing costs?", options: yesNo },
    { name: "bankruptcy", label: "Have you declared bankruptcy within the past seven years?", options: yesNo },
  ] },
];

export function ApplicationFields({ step, draft, change }: {
  step: number; draft: ApplicationDraft; change: (name: FieldName, value: string) => void;
}) {
  const section = sections[step];
  if (!section) return null;
  return <>
    <h2>{section.heading}</h2>
    <div className="form-grid">
      {section.fields.map(({ name, label, type, options }) => (
        <label key={name} className="field">
          <span>{label}</span>
          {options ? <select value={draft[name]} onChange={(event) => change(name, event.target.value)}>
            {name !== "purpose" && <option value="">Choose an answer</option>}
            {options.map((value) => <option key={value}>{value}</option>)}
          </select> : <input type={type ?? "text"} value={draft[name]} maxLength={name === "phone" ? 40 : name === "propertyAddress" ? 240 : 160}
            {...(type === "number" ? { min: "0", max: "1000000000", step: "0.01", inputMode: "decimal" as const } : {})}
            onChange={(event) => change(name, event.target.value)} />}
        </label>
      ))}
    </div>
  </>;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function ApplicationAnswers({ draft }: { draft: ApplicationDraft }) {
  return <div className="application-answers">
    {sections.map(({ heading, fields }) => <section key={heading}>
      <h4>{heading}</h4>
      <dl className="form-grid">
        {fields.filter(({ name }) => draft[name]).map(({ name, label, type }) => (
          <div key={name}><dt>{label}</dt><dd>{type === "number" ? currency.format(Number(draft[name])) : draft[name]}</dd></div>
        ))}
      </dl>
    </section>)}
  </div>;
}

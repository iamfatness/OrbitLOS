import type { AddressDetails, AddressStreet, ApplicationDraft } from "@/lib/application-model";
import { applicationCredit, blankBorrower, borrowerDefinition, borrowerQuestions, jointQuestions, propertyQuestions, type BorrowerSection } from "@/lib/urla";
import { ApplicationAddress, type UpdateDraft } from "./application-address";
import { QuestionnaireAnswers, QuestionnaireFields, type ChangeAnswers } from "./urla-fields";
import { Button } from "./ui/button";

type BasicName = "borrowerName" | "email" | "phone" | "estimatedValue" | "loanAmount" | "purpose" | "occupancy";
type Basic = { name: BasicName; label: string; type?: "email" | "tel" | "number"; options?: string[] };
type Address = { street: AddressStreet; details: AddressDetails; label: string; required?: boolean };
const borrowerBasics: Basic[] = [
  { name: "borrowerName", label: "Borrower full legal name" }, { name: "email", label: "Borrower email", type: "email" }, { name: "phone", label: "Cell phone", type: "tel" },
];
const propertyBasics: Basic[] = [
  { name: "estimatedValue", label: "Estimated property value", type: "number" }, { name: "loanAmount", label: "Requested loan amount", type: "number" },
  { name: "purpose", label: "Loan purpose", options: ["Purchase", "Refinance", "Other"] },
  { name: "occupancy", label: "Intended occupancy", options: ["Primary residence", "Second home", "Investment property", "FHA secondary residence"] },
];
const current: Address = { street: "currentAddress", details: "currentLocation", label: "Current address", required: true };
const prior: Address = { street: "priorAddress", details: "priorLocation", label: "Previously saved former address" };
const subject: Address = { street: "propertyAddress", details: "propertyLocation", label: "Subject property address" };
const sections: (BorrowerSection | "property")[] = ["identity", "work", "finances", "property", "declarations", "realEstate", "military", "demographics", "acknowledgment"];

function Basics({ fields, draft, update }: { fields: Basic[]; draft: ApplicationDraft; update: UpdateDraft }) {
  return <div className="form-grid">{fields.map(({ name, label, type, options }) => {
    const change = (value: string) => update(() => ({ [name]: value }));
    return <label key={name} className="field"><span>{label}</span>
      {options ? <select value={draft[name]} onChange={(event) => change(event.target.value)}>
        {name !== "purpose" && <option value="">Choose an answer</option>}
        {options.map((option) => <option key={option}>{option}</option>)}
      </select> : <input value={draft[name]} autoComplete="off" type={type ?? "text"} maxLength={name === "phone" ? 40 : 160}
        {...(type === "number" ? { min: 0, max: 1_000_000_000, step: "0.01", inputMode: "decimal" as const } : {})}
        onChange={(event) => change(event.target.value)} />}
    </label>;
  })}</div>;
}

export function ApplicationFields({ step, draft, update, lookupEnabled, separateJoint }: {
  step: number; draft: ApplicationDraft; update: UpdateDraft; lookupEnabled?: boolean; separateJoint?: boolean;
}) {
  const section = sections[step];
  if (!section) return null;
  const { urla } = draft;
  const shared = { draft, update, lookupEnabled };
  const changeShared = (key: "credit" | "property"): ChangeAnswers => (change) => update((previous) => ({
    urla: { ...previous.urla, [key]: change(previous.urla[key]) },
  }));
  if (section === "property") {
    const definition = { ...propertyQuestions, fields: propertyQuestions.fields.filter((field) =>
      (field.key !== "otherPurpose" || draft.purpose === "Other") && (field.key !== "propertyPending" || draft.purpose === "Purchase")) };
    return <><h2>Property and loan</h2><Basics fields={propertyBasics} {...shared} />
      <ApplicationAddress {...subject} {...shared} required={draft.purpose !== "Purchase" || draft.urla.property.fields.propertyPending !== "Yes"} />
      <QuestionnaireFields definition={definition} answers={urla.property} change={changeShared("property")} lookupEnabled={lookupEnabled} />
    </>;
  }

  const joint = separateJoint || urla.credit.fields.type === "Joint";
  const borrowers = joint && !separateJoint ? [urla.primary, ...urla.additional] : [urla.primary];
  const editBorrower = (index: number, key: BorrowerSection | "joint"): ChangeAnswers => (change) => update((previous) => {
    if (index === 0) return { urla: { ...previous.urla, primary: { ...previous.urla.primary, [key]: change(previous.urla.primary[key]) } } };
    return { urla: { ...previous.urla, additional: previous.urla.additional.map((person, i) => i === index - 1 ? { ...person, [key]: change(person[key]) } : person) } };
  });
  return <>
    <h2>{borrowerQuestions[section].label}</h2>
    {section === "identity" && (separateJoint ? <p className="muted">Joint application · Your co-borrower enters their own answers through a separate link.</p> :
      <QuestionnaireFields definition={applicationCredit} answers={urla.credit} change={changeShared("credit")} />)}
    {section === "work" && <p className="muted">You may omit alimony, child support, or separate maintenance if you prefer to qualify without it.</p>}
    {section === "demographics" && <p className="muted">Choose all that apply or choose “Prefer not to provide.” These answers are collected for the sample application.</p>}
    {section === "acknowledgment" && <p className="muted">Review the <a className="name-link" href="https://singlefamily.fanniemae.com/media/7896/display#page=7" target="_blank" rel="noopener noreferrer">official acknowledgments</a>. The typed names below show the demo signing flow.</p>}
    {borrowers.map((borrower, index) => <section className="urla-person" key={index}>
      <div className="section-heading">
        <h3>{index === 0 ? draft.borrowerName || "Primary borrower" : borrower.identity.fields.name || `Additional borrower ${index}`}</h3>
        {section === "identity" && index > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => update((previous) => ({
          urla: { ...previous.urla, additional: previous.urla.additional.filter((_, i) => i !== index - 1) },
        }))}>Remove borrower {index}</Button>}
      </div>
      {section === "identity" && index === 0 && <>
        <Basics fields={borrowerBasics} {...shared} />
        <ApplicationAddress {...current} {...shared} />
        {(draft.priorAddress || draft.priorLocation.city) && <ApplicationAddress {...prior} {...shared} />}
      </>}
      <QuestionnaireFields key={borrowers.length} definition={borrowerDefinition(section, index === 0)} answers={borrower[section]}
        change={editBorrower(index, section)} lookupEnabled={lookupEnabled} />
      {section === "identity" && joint && <QuestionnaireFields definition={jointQuestions} answers={borrower.joint} change={editBorrower(index, "joint")} />}
    </section>)}
    {section === "identity" && joint && !separateJoint && <Button type="button" size="sm" variant="outline" disabled={urla.additional.length >= 4} onClick={() =>
      update((previous) => ({ urla: { ...previous.urla, additional: [...previous.urla.additional, blankBorrower()] } }))}>Add borrower</Button>}
    {section === "identity" && !joint && urla.additional.length > 0 && <p className="muted">Additional borrower answers are still saved. Select joint credit to include them.</p>}
  </>;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function ApplicationAnswers({ draft }: { draft: ApplicationDraft }) {
  const { urla } = draft;
  const borrowers = [urla.primary, ...urla.additional];
  const formatAddress = ({ street, details, label }: Address) => {
    const { unit, city, state, zip, country } = draft[details];
    const address = [draft[street], unit && `Unit ${unit}`, city, [state, zip].filter(Boolean).join(" "), country].filter(Boolean).join(", ");
    return address && <div key={street}><dt>{label}</dt><dd>{address}</dd></div>;
  };
  const formatBasics = (fields: Basic[]) => fields.filter(({ name }) => draft[name]).map(({ name, label, type }) =>
    <div key={name}><dt>{label}</dt><dd>{type === "number" ? currency.format(Number(draft[name])) : draft[name]}</dd></div>);
  return <div className="application-answers">
    <section><h4>Primary borrower</h4><dl className="form-grid">{formatBasics(borrowerBasics)}{formatAddress(current)}{formatAddress(prior)}</dl></section>
    <QuestionnaireAnswers definition={applicationCredit} answers={urla.credit} />
    <section><h4>Subject property</h4><dl className="form-grid">{formatAddress(subject)}{formatBasics(propertyBasics)}</dl></section>
    <QuestionnaireAnswers definition={propertyQuestions} answers={urla.property} />
    {borrowers.map((borrower, index) => <div className="urla-review-borrower" key={index}>
      <h4>{index === 0 ? draft.borrowerName || "Primary borrower" : borrower.identity.fields.name || `Additional borrower ${index}`}</h4>
      <QuestionnaireAnswers definition={jointQuestions} answers={borrower.joint} />
      {(Object.keys(borrowerQuestions) as BorrowerSection[]).map((key) =>
        <QuestionnaireAnswers key={key} definition={borrowerDefinition(key, index === 0)} answers={borrower[key]} />)}
    </div>)}
    {!urla.primary.acknowledgment.fields.signature && <section><h4>Earlier intake answers</h4>
      <dl className="form-grid">{Object.entries({
        "Co-borrower name": draft.coBorrowerName, "Co-borrower employer": draft.coBorrowerEmployer, "Co-borrower income": draft.coBorrowerIncome,
        "Employer": draft.employer, "Gross monthly income": draft.monthlyIncome, "Prior employer": draft.priorEmployer,
        "Total assets": draft.assets, "Monthly debts": draft.monthlyDebts, "Other property": draft.otherProperty,
      }).filter(([, answer]) => answer).map(([label, answer]) => <div key={label}><dt>{label}</dt><dd>{answer}</dd></div>)}</dl>
    </section>}
  </div>;
}

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { illinoisLogExceptions, illinoisLogOutcomes, illinoisLogProducts, sharedAppreciationRuleDate,
  type IllinoisLogFacts as Facts } from "@/lib/illinois-loan-log-model";
import { RecordsGroup, RegisterChoice as Choice, RegisterField as Field } from "./retention-register-fields";
import { Button } from "./ui/button";

export const optionalText = (value: string) => value.trim() ? value : undefined;
const emptyReverse: NonNullable<Facts["reverse"]> = { counseling: "Unresolved" };
const counselChoices = ["Unresolved", "Yes", "No"] as const;
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd = (cents?: number) => cents === undefined ? undefined : money.format(cents / 100);
const percent = (value?: number) => value === undefined ? undefined : `${value}%`;
const numericValue = (number: number, amount: boolean) => Number.isFinite(number) ?
  amount ? Math.round(number * 100) : number : undefined;

function NumberField({ label, value, change, amount = false, max = 100, step = "any" }: {
  label: string; value?: number; change: (value?: number) => void; amount?: boolean; max?: number; step?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const display = value === undefined ? "" : String(amount ? value / 100 : value);
  useEffect(() => {
    const field = input.current;
    if (field && numericValue(field.valueAsNumber, amount) !== value) field.value = display;
  }, [amount, display, value]);
  return <label className="field min-w-0">{label}
    <input ref={input} type="number" inputMode={step === "1" ? "numeric" : "decimal"} min={0} max={amount ? 1_000_000_000 : max}
      step={amount ? "0.01" : step} defaultValue={display} onChange={event => change(numericValue(event.currentTarget.valueAsNumber, amount))} />
  </label>;
}

function Rows<T>({ label, items, empty, change, children }: {
  label: string; items: T[]; empty: () => T; change: (items: T[]) => void;
  children: (item: T, change: (item: T) => void) => ReactNode;
}) {
  return <div className="record-form min-w-0">
    {items.map((item, index) => <fieldset key={index} className="record-form min-w-0 border-t border-[var(--line)] pt-2">
      <legend>{label} {index + 1}</legend>
      {children(item, updated => change(items.map((entry, position) => position === index ? updated : entry)))}
      <div><Button type="button" variant="outline" className="min-h-11"
        onClick={() => change(items.filter((_, position) => position !== index))}>Remove {label.toLowerCase()} {index + 1}</Button></div>
    </fieldset>)}
    {items.length < 12 && <div><Button type="button" variant="outline" className="min-h-11"
      onClick={() => change([...items, empty()])}>Add {label.toLowerCase()}</Button></div>}
  </div>;
}

export function IllinoisLoanLogFields({ facts, change }: { facts: Facts; change: (facts: Facts) => void }) {
  const { product, reverse = emptyReverse, shared = {}, closing = {} } = facts;
  const standard = product === "Brokerage or origination";
  const reverseMortgage = product === "Reverse mortgage";
  const sharedAppreciation = product === "Shared appreciation agreement";
  function set<K extends keyof Facts>(key: K, value: Facts[K]) { change({ ...facts, [key]: value }); }
  return <>
    <Choice label="Log product" value={product} options={illinoisLogProducts} change={next => change({ ...facts, product: next,
      reverse: next === "Reverse mortgage" ? reverse : undefined, shared: next === "Shared appreciation agreement" ? shared : undefined,
      highRisk: next === "Brokerage or origination" ? facts.highRisk : undefined,
      closing: next === "Reverse mortgage" ? undefined : facts.closing,
      outcome: next === "Reverse mortgage" ? "Unresolved" : facts.outcome })} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Application date" date value={facts.applicationDate ?? null} change={value => set("applicationDate", optionalText(value))} />
      <Field label="File number" limit={100} value={facts.fileNumber ?? null} change={value => set("fileNumber", optionalText(value))} />
    </div>
    <Field label="Property address" multiline limit={320} value={facts.propertyAddress ?? null} change={value => set("propertyAddress", optionalText(value))} />
    {standard && <Choice label="High-risk classification" value={facts.highRisk ?? "Unresolved"} options={["Unresolved", "Standard", "High risk"]}
      change={value => set("highRisk", value)} />}
    <Field label="Classification evidence reference" multiline limit={240} value={facts.classificationReference ?? null}
      change={value => set("classificationReference", optionalText(value))} />
    <RecordsGroup title="Borrowers and employment">
      <Rows label="Borrower" items={facts.borrowers} empty={() => ({ name: "" } as Facts["borrowers"][number])}
        change={items => set("borrowers", items)}>{(person, update) => <>
        <Field label="Borrower name" value={person.name} change={name => update({ ...person, name })} />
        {standard && <>
          <Field label="Employer" value={person.employer ?? null} change={value => update({ ...person, employer: optionalText(value) })} />
          <Field label="Employer address" multiline limit={320} value={person.employerAddress ?? null}
            change={value => update({ ...person, employerAddress: optionalText(value) })} />
        </>}
        {reverseMortgage && <NumberField label="Age" value={person.age} max={130} step="1" change={age => update({ ...person, age })} />}
      </>}</Rows>
      {standard && <Field label="Employment exception reference" multiline limit={240} value={facts.exceptions.employment ?? null}
        change={value => set("exceptions", { ...facts.exceptions, employment: optionalText(value) })} />}
    </RecordsGroup>
    <RecordsGroup title="Originators, processors and appraisers">
      <Rows label="Originator" items={facts.originators} empty={() => ({ name: "" } as Facts["originators"][number])}
        change={items => set("originators", items)}>{(person, update) => <>
        <Field label="Originator name" value={person.name} change={name => update({ ...person, name })} />
        <Field label="Originator NMLS ID" limit={15} inputMode="numeric" value={person.nmls ?? null}
          change={value => update({ ...person, nmls: optionalText(value) })} />
      </>}</Rows>
      <Rows label="Processor" items={facts.processors} empty={() => ""} change={items => set("processors", items)}>
        {(name, update) => <Field label="Processor name" value={name} change={update} />}
      </Rows>
      {!facts.processors.length && <Field label="Processor exception reference" multiline limit={240} value={facts.exceptions.processors ?? null}
        change={value => set("exceptions", { ...facts.exceptions, processors: optionalText(value) })} />}
      <Rows label="Appraiser" items={facts.appraisers} empty={() => ({ name: "" } as Facts["appraisers"][number])}
        change={items => set("appraisers", items)}>{(person, update) => <>
        <Field label="Appraiser name" value={person.name} change={name => update({ ...person, name })} />
        {!reverseMortgage && <Field label="Appraiser license number" limit={60} value={person.license ?? null}
          change={value => update({ ...person, license: optionalText(value) })} />}
      </>}</Rows>
      {!facts.appraisers.length && <Field label="Appraiser exception reference" multiline limit={240} value={facts.exceptions.appraisers ?? null}
        change={value => set("exceptions", { ...facts.exceptions, appraisers: optionalText(value) })} />}
    </RecordsGroup>
    {(standard || reverseMortgage || sharedAppreciation) && <RecordsGroup title="Loan terms">
      {!reverseMortgage && <>
        <Choice label="Purpose" value={facts.purpose ?? ""} options={["", "Purchase", "Refinance", "Other"]}
          optionLabel={value => value || "Unresolved"} change={value => change({ ...facts, purpose: value || undefined,
            sellers: value === "Refinance" ? [] : facts.sellers })} />
        {facts.purpose === "Refinance" ? <p className="muted">Seller is recorded as NA for a refinance.</p> :
          <Rows label="Seller" items={facts.sellers} empty={() => ""} change={items => set("sellers", items)}>
            {(name, update) => <Field label="Seller name" value={name} change={update} />}
          </Rows>}
        {facts.purpose === "Other" && !facts.sellers.length && <Field label="Seller exception reference" multiline limit={240}
          value={facts.exceptions.seller ?? null} change={value => set("exceptions", { ...facts.exceptions, seller: optionalText(value) })} />}
        <NumberField label="Loan amount (USD)" amount value={facts.amountCents} change={value => set("amountCents", value)} />
      </>}
      {!sharedAppreciation && <>
        <NumberField label="APR (%)" max={1000} value={facts.aprPercent} change={value => set("aprPercent", value)} />
        <Field label="Loan program" value={facts.loanProgram ?? null} change={value => set("loanProgram", optionalText(value))} />
      </>}
    </RecordsGroup>}
    {!reverseMortgage && <RecordsGroup title="Application outcome and closing">
      <Choice label="Application status" value={facts.outcome} options={illinoisLogOutcomes}
        change={outcome => change({ ...facts, outcome, closing: outcome === "Closed" ? closing : undefined })} />
      {facts.outcome === "Closed" && <>
        <Field label="Closing date" date value={closing.on ?? null} change={value => set("closing", { ...closing, on: optionalText(value) })} />
        {([["owner", "Loan owner"], ["servicer", "Loan servicer"], ["closer", "Loan closer"],
          ["closerEmployer", "Closer employer"], ["location", "Closing location"]] as const).map(([key, label]) =>
          <Field key={key} label={label} multiline={key === "location"} limit={key === "location" ? 320 : 160} value={closing[key] ?? null}
            change={value => set("closing", { ...closing, [key]: optionalText(value) })} />)}
      </>}
    </RecordsGroup>}
    {reverseMortgage && <RecordsGroup title="Reverse mortgage payments and counseling">
      {([["lumpSumCents", "Lump sum (USD)"], ["monthlyPaymentCents", "Monthly payment (USD)"], ["lineOfCreditCents", "Line of credit (USD)"],
        ["appraisedCents", "Appraised value (USD)"]] as const).map(([key, label]) =>
        <NumberField key={key} label={label} amount value={reverse[key]} change={value => set("reverse", { ...reverse, [key]: value })} />)}
      <NumberField label="Loan-to-value (%)" max={1000} value={reverse.loanToValue} change={loanToValue => set("reverse", { ...reverse, loanToValue })} />
      <Choice label="Counseling provided" value={reverse.counseling} options={counselChoices}
        change={counseling => set("reverse", { ...reverse, counseling, ...(counseling === "Yes" ? {} : { counselingAgency: undefined, hudApproved: undefined }) })} />
      {reverse.counseling === "Yes" && <>
        <Field label="Counseling agency" value={reverse.counselingAgency ?? null}
          change={value => set("reverse", { ...reverse, counselingAgency: optionalText(value) })} />
        <Choice label="HUD-approved agency" value={reverse.hudApproved ?? "Unresolved"} options={counselChoices}
          change={hudApproved => set("reverse", { ...reverse, hudApproved })} />
      </>}
    </RecordsGroup>}
    {sharedAppreciation && <RecordsGroup title="Shared appreciation valuation and counseling">
      <NumberField label="Starting value (USD)" amount value={shared.startingValueCents}
        change={startingValueCents => set("shared", { ...shared, startingValueCents })} />
      <Field label="Starting value method" multiline limit={240} value={shared.startingValueMethod ?? null}
        change={value => set("shared", { ...shared, startingValueMethod: optionalText(value) })} />
      <NumberField label="Share percentage" value={shared.sharePercent} change={sharePercent => set("shared", { ...shared, sharePercent })} />
      <Field label="Counseling date" date value={shared.counselingOn ?? null}
        change={value => set("shared", { ...shared, counselingOn: optionalText(value) })} />
      <Field label="Counseling provider" value={shared.counselingProvider ?? null}
        change={value => set("shared", { ...shared, counselingProvider: optionalText(value) })} />
      {facts.applicationDate && facts.applicationDate < sharedAppreciationRuleDate &&
        <Field label="Rule transition review reference" multiline limit={240} value={shared.transitionReference ?? null}
          change={value => set("shared", { ...shared, transitionReference: optionalText(value) })} />}
    </RecordsGroup>}
  </>;
}

export function IllinoisLoanLogFacts({ facts }: { facts: Facts }) {
  const { closing, reverse, shared } = facts;
  const terms = [
    ["Property address", facts.propertyAddress], ["Purpose", facts.purpose],
    ["Property sellers", facts.purpose === "Refinance" ? "NA" : facts.sellers.join(" · ")],
    ["Loan amount", usd(facts.amountCents)], ["APR", percent(facts.aprPercent)], ["Loan program", facts.loanProgram],
    ["Classification reference", facts.classificationReference], ["Closing date", closing?.on], ["Loan owner", closing?.owner],
    ["Loan servicer", closing?.servicer], ["Loan closer", closing?.closer], ["Closer employer", closing?.closerEmployer], ["Closing location", closing?.location],
    ["Lump sum", usd(reverse?.lumpSumCents)], ["Monthly payment", usd(reverse?.monthlyPaymentCents)], ["Line of credit", usd(reverse?.lineOfCreditCents)],
    ["Appraised value", usd(reverse?.appraisedCents)], ["Loan-to-value", percent(reverse?.loanToValue)], ["Counseling provided", reverse?.counseling],
    ["Counseling agency", reverse?.counselingAgency], ["HUD-approved agency", reverse?.hudApproved], ["Starting value", usd(shared?.startingValueCents)],
    ["Starting value method", shared?.startingValueMethod], ["Share percentage", percent(shared?.sharePercent)], ["Counseling date", shared?.counselingOn],
    ["Counseling provider", shared?.counselingProvider], ["Rule transition review", shared?.transitionReference],
  ];
  return <RecordsGroup title="Recorded fields">
    <dl className="record-form break-words">
      {facts.borrowers.map((person, index) => <div key={index}><dt>Borrower {index + 1}</dt>
        <dd>{[person.name, person.employer, person.employerAddress, person.age === undefined ? undefined : `Age ${person.age}`].filter(Boolean).join(" · ")}</dd></div>)}
      {facts.originators.map((person, index) => <div key={index}><dt>Originator {index + 1}</dt><dd>{person.name}{person.nmls && ` · NMLS ${person.nmls}`}</dd></div>)}
      {facts.processors.length > 0 && <div><dt>Processors</dt><dd>{facts.processors.join(" · ")}</dd></div>}
      {facts.appraisers.map((person, index) => <div key={index}><dt>Appraiser {index + 1}</dt><dd>{person.name}{person.license && ` · ${person.license}`}</dd></div>)}
      {terms.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      {Object.entries(facts.exceptions).map(([key, value]) => value && <div key={key}>
        <dt>{illinoisLogExceptions[key as keyof typeof illinoisLogExceptions]} exception</dt><dd>{value}</dd>
      </div>)}
    </dl>
  </RecordsGroup>;
}

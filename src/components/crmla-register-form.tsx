"use client";

import { useState } from "react";
import { crmlaRegisterFacts, type CrmlaRegisterFacts as Facts } from "@/lib/crmla-register-model";
import type { CrmlaRegisterResult } from "@/lib/crmla-register";
import { RegisterChoice as Choice } from "./retention-register-fields";
import { Button } from "./ui/button";

type Entry = Extract<CrmlaRegisterResult, { kind: "crmlaRegisterHistory" }>["versions"][number];
const outcomes = ["Unreviewed", "Pending", "Ended without closing", "Closed"] as const;
const columns = "grid min-w-0 items-end gap-3 sm:grid-cols-2";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function Field({ name, label, value, required, date, limit = 240, money }: {
  name: string; label: string; value?: string; required?: boolean; date?: boolean; limit?: number; money?: boolean;
}) {
  return <label className="field min-w-0">{label}{required && " (required)"}
    <input name={name} defaultValue={value} required={required} type={date ? "date" : "text"}
      {...(date ? { min: "1900-01-01", max: "2199-12-31" } : { maxLength: limit })}
      {...(money ? { inputMode: "decimal", pattern: "[0-9]+([.][0-9]{1,2})?", title: "Enter dollars with up to two decimal places." } : {})} />
  </label>;
}

export function CrmlaRegisterForm({ initial, busy, save, cancel }: {
  initial?: Facts; busy: boolean; save: (data: { facts: Facts; correction?: string }) => void; cancel: () => void;
}) {
  const [outcome, setOutcome] = useState<Facts["outcome"]["status"]>(initial?.outcome.status ?? "Unreviewed");
  const [applicants, setApplicants] = useState(initial?.applicants.length ?? 1);
  const [error, setError] = useState("");
  const closed = initial?.outcome.status === "Closed" ? initial.outcome : undefined;
  function submit(form: FormData) {
    const read = (key: string) => String(form.get(key) ?? "").trim() || undefined;
    const amount = read("amount");
    const [whole, fraction = ""] = (amount ?? "").split(".");
    const facts = crmlaRegisterFacts.safeParse({
      fileNumber: read("fileNumber"), applicationOn: read("applicationOn"), applicationReference: read("applicationReference"),
      applicants: Array.from({ length: applicants }, (_, index) => read("applicant-" + index)),
      propertyAddress: read("propertyAddress"), amountCents: amount ? Number(whole) * 100 + Number(fraction.padEnd(2, "0")) : undefined,
      terms: read("terms"), program: read("program"), officer: read("officer"),
      outcome: outcome === "Closed" ? { status: outcome, on: read("closedOn"), disposition: read("loanDisposition"),
        servicing: read("servicingDisposition"), reference: read("outcomeReference") } :
        outcome === "Ended without closing" ? { status: outcome, reference: read("outcomeReference") } : { status: outcome },
    });
    if (!facts.success) {
      const issue = facts.error.issues[0];
      setError(issue.code === "custom" ? issue.message : issue.path[0] === "amountCents" ? "Enter a positive loan amount in USD." :
        "Check the application and outcome dates and enter at least four characters per evidence reference.");
      return;
    }
    const correction = read("correction");
    if (initial && (!correction || correction.length < 4)) { setError("Enter at least four characters for the correction reason."); return; }
    setError("");
    save({ facts: facts.data, correction });
  }
  return <form className="record-form w-full max-w-3xl" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    {error && <p role="alert" tabIndex={-1} ref={node => node?.focus()}>{error}</p>}
    <fieldset disabled={busy} className="record-form min-w-0">
      <div className={columns}>
        <Field label="File number" name="fileNumber" value={initial?.fileNumber} limit={100} required />
        <Field label="Application received" name="applicationOn" value={initial?.applicationOn} date required />
      </div>
      <Field label="Application receipt reference" name="applicationReference" value={initial?.applicationReference} required />
      {Array.from({ length: applicants }, (_, index) => <Field key={index} label={`Borrower ${index + 1} name`}
        name={"applicant-" + index} value={initial?.applicants[index]} limit={160} required />)}
      <div className="loan-application-actions">
        <Button type="button" variant="outline" className="min-h-11" disabled={applicants >= 12} onClick={() => setApplicants(applicants + 1)}>Add borrower</Button>
        {applicants > 1 && <Button type="button" variant="outline" className="min-h-11" onClick={() => setApplicants(applicants - 1)}>Remove last borrower</Button>}
      </div>
      <Field label="Property address" name="propertyAddress" value={initial?.propertyAddress} limit={300} />
      <div className={columns}>
        <Field label="Loan amount in USD" name="amount" value={initial?.amountCents === undefined ? undefined : (initial.amountCents / 100).toFixed(2)} money limit={15} />
        <Field label="Loan officer" name="officer" value={initial?.officer} limit={160} />
        <Field label="Loan terms" name="terms" value={initial?.terms} limit={300} />
        <Field label="Loan program" name="program" value={initial?.program} limit={160} />
      </div>
      <Choice label="Application outcome" value={outcome} options={outcomes} change={setOutcome} />
      {outcome === "Closed" && <>
        <Field label="Closing date" name="closedOn" value={closed?.on} date required />
        <div className={columns}>
          <Field label="Loan disposition" name="loanDisposition" value={closed?.disposition} />
          <Field label="Servicing disposition" name="servicingDisposition" value={closed?.servicing} />
        </div>
      </>}
      {(outcome === "Closed" || outcome === "Ended without closing") && <Field label="Outcome evidence reference" name="outcomeReference"
        value={initial && "reference" in initial.outcome ? initial.outcome.reference : undefined} required />}
      {initial && <Field label="Correction reason" name="correction" required />}
      <div className="loan-application-actions">
        <Button type="submit" className="min-h-11">{busy ? "Saving…" : "Save register entry"}</Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={cancel}>Cancel</Button>
      </div>
    </fieldset>
  </form>;
}

export function CrmlaRegisterEvidence({ entry }: { entry: Entry }) {
  const { facts, review } = entry;
  const closed = facts.outcome.status === "Closed" ? facts.outcome : undefined;
  const rows = [
    ["Application received", facts.applicationOn], ["Receipt reference", facts.applicationReference],
    ["Borrowers", facts.applicants.join(" · ")], ["Property address", facts.propertyAddress],
    ["Loan amount", facts.amountCents === undefined ? undefined : money.format(facts.amountCents / 100)],
    ["Loan terms", facts.terms], ["Loan program", facts.program], ["Loan officer", facts.officer],
    ["Outcome", facts.outcome.status], ["Closed on", closed?.on], ["Loan disposition", closed?.disposition],
    ["Servicing disposition", closed?.servicing],
    ["Outcome reference", "reference" in facts.outcome ? facts.outcome.reference : undefined], ["Correction reason", entry.correction],
  ];
  return <div className="record-form min-w-0">
    <p>{entry.actor} · {new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium" }).format(new Date(entry.at))} PT</p>
    {!!review.gaps.length && <div><strong>Evidence gaps</strong><ul className="list-disc pl-5">{review.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
    <dl className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      {rows.map(([label, value]) => value && <div key={label} className="contents"><dt className="font-medium">{label}</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>)}
    </dl>
  </div>;
}

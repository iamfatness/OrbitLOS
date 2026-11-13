"use client";

import { useState } from "react";
import { floridaJournalFacts, floridaJournalOutcomes, type FloridaJournalFacts } from "@/lib/florida-journal-model";
import { RegisterChoice } from "./retention-register-fields";
import { Button } from "./ui/button";

function Field({ name, label, value, date, required, limit = 160 }: {
  name: string; label: string; value?: string; date?: boolean; required?: boolean; limit?: number;
}) {
  return <label className="field min-w-0">{label}{required && " (required)"}
    <input name={name} type={date ? "date" : "text"} defaultValue={value} required={required}
      {...(date ? { min: "1900-01-01", max: "2199-12-31" } : { maxLength: limit })} />
  </label>;
}

export function FloridaJournalForm({ initial, busy, save, cancel }: {
  initial?: FloridaJournalFacts; busy: boolean;
  save: (data: { facts: FloridaJournalFacts; correction?: string }) => void; cancel: () => void;
}) {
  const [authority, setAuthority] = useState<FloridaJournalFacts["authority"]>(initial?.authority ?? "Mortgage broker");
  const [zone, setZone] = useState<FloridaJournalFacts["zone"]>(initial?.zone ?? "America/New_York");
  const [disposition, setDisposition] = useState<FloridaJournalFacts["disposition"]>(initial?.disposition ?? "Pending");
  const [lenderStatus, setLenderStatus] = useState<FloridaJournalFacts["lender"]["status"]>(initial?.lender.status ?? "Unresolved");
  const [applicants, setApplicants] = useState(initial?.applicants.length ?? 1);
  const [error, setError] = useState("");

  function submit(form: FormData) {
    const read = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    const enteredOn = read("enteredOn");
    const dueOn = read("dueOn");
    const calendarReference = read("calendarReference");
    const initiationOn = read("initiationOn");
    const initiationReference = read("initiationReference");
    const facts = floridaJournalFacts.safeParse({
      authority, zone, disposition, enteredOn,
      office: read("office"), officeReference: read("officeReference"), transactionNumber: read("transactionNumber"),
      applicants: Array.from({ length: applicants }, (_, index) => read("applicant-" + index)).filter(Boolean),
      applicationOn: read("applicationOn"), dispositionReference: read("dispositionReference"),
      lender: lenderStatus === "Identified" ? { status: lenderStatus, name: read("lenderName") } :
        lenderStatus === "Not applicable" ? { status: lenderStatus, reference: read("lenderReference") } : { status: lenderStatus },
      calendar: dueOn || calendarReference ? { dueOn, reference: calendarReference } : undefined,
      initiation: initiationOn || initiationReference ? { on: initiationOn, reference: initiationReference } : undefined,
    });
    if (!facts.success) {
      const issue = facts.error.issues[0];
      const messages: Record<string, string> = {
        calendar: "Enter the documented deadline and its calendar reference.",
        initiation: "Enter the earlier journal date and its evidence reference.",
        officeReference: "Enter an office evidence reference of at least four characters.",
        dispositionReference: "Enter a disposition reference of at least four characters.",
        lender: "Enter the lender name or the evidence for why a lender does not apply.",
      };
      setError(issue.code === "custom" ? issue.message : messages[String(issue.path[0])] ?? "Check the required journal dates, names and references.");
      return;
    }
    const correction = read("correction");
    if (initial && (!correction || correction.length < 4)) { setError("Enter a correction reason of at least four characters."); return; }
    setError("");
    save({ facts: facts.data, correction });
  }

  return <form className="record-form w-full max-w-3xl" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    {error && <p role="alert" tabIndex={-1} ref={node => node?.focus()}>{error}</p>}
    <fieldset className="record-form min-w-0" disabled={busy}>
      <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
        <RegisterChoice label="Florida authority" value={authority} options={["Mortgage broker", "Mortgage lender"]} change={setAuthority} disabled={!!initial} />
        <RegisterChoice label="Office time zone" value={zone} options={["America/New_York", "America/Chicago"]} change={setZone} disabled={!!initial}
          optionLabel={value => value === "America/New_York" ? "Eastern" : "Central"} />
        <Field name="office" label="Principal or originating branch office" value={initial?.office} required />
        <Field name="officeReference" label="Office custody reference" value={initial?.officeReference} required limit={240} />
        <Field name="transactionNumber" label="Transaction number" value={initial?.transactionNumber} limit={100} />
        <Field name="applicationOn" label="Application date" value={initial?.applicationOn} date required />
      </div>
      {Array.from({ length: applicants }, (_, index) => <Field key={index} name={"applicant-" + index}
        label={"Applicant " + (index + 1) + " full name"} value={initial?.applicants[index]} required={index === 0} />)}
      <div className="loan-application-actions">
        <Button type="button" variant="outline" className="min-h-11" disabled={applicants >= 12} onClick={() => setApplicants(applicants + 1)}>Add applicant</Button>
        {applicants > 1 && <Button type="button" variant="outline" className="min-h-11" onClick={() => setApplicants(applicants - 1)}>Remove last applicant</Button>}
      </div>
      <div className="grid min-w-0 gap-3">
        <RegisterChoice label="Disposition" value={disposition} options={floridaJournalOutcomes} change={setDisposition} />
        <Field name="dispositionReference" label="Disposition reference" value={initial?.dispositionReference} required limit={240} />
      </div>
      <RegisterChoice label="Lender status" value={lenderStatus} options={["Unresolved", "Identified", "Not applicable"]} change={setLenderStatus} />
      {lenderStatus === "Identified" && <Field name="lenderName" label="Lender name" required value={initial?.lender.status === "Identified" ? initial.lender.name : undefined} />}
      {lenderStatus === "Not applicable" && <Field name="lenderReference" label="Lender applicability reference" required limit={240}
        value={initial?.lender.status === "Not applicable" ? initial.lender.reference : undefined} />}
      <details className="details-section">
        <summary className="min-h-11 content-center">Journal timing and earlier entry</summary>
        <div className="record-form">
          <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
            <Field name="enteredOn" label="Date transaction was entered into" value={initial?.enteredOn} date />
            <Field name="dueOn" label="Documented seventh business day" value={initial?.calendar?.dueOn} date />
          </div>
          <Field name="calendarReference" label="Business-day calendar reference" value={initial?.calendar?.reference} limit={240} />
          <Field name="initiationOn" label="Earlier journal entry date" value={initial?.initiation?.on} date />
          <Field name="initiationReference" label="Earlier journal evidence reference" value={initial?.initiation?.reference} limit={240} />
        </div>
      </details>
      {initial && <Field name="correction" label="Correction reason" required limit={240} />}
      <div className="loan-application-actions">
        <Button type="submit" className="min-h-11">{busy ? "Saving…" : "Save journal entry"}</Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={cancel}>Cancel</Button>
      </div>
    </fieldset>
  </form>;
}

"use client";

import { useState } from "react";
import { texasLogDispositions, texasLogFacts, texasLogTypes, texasLogZones, type TexasLogFacts } from "@/lib/texas-loan-log-model";
import { RegisterChoice } from "./retention-register-fields";
import { Button } from "./ui/button";


type Save = Extract<import("@/lib/texas-loan-log-model").TexasLoanLogRequest["input"], { operation: "save" }>;
const authorities = ["Mortgage company", "Mortgage banker"] as const;
const feeStages = ["invoiced", "assessed", "charged", "collected", "paid"] as const;
const cdChoices = ["Unresolved", "On CD", "Not on CD", "No closing disclosure"] as const;

function Field({ name, label, value, type = "text", required, limit = 160 }: {
  name: string; label: string; value?: string | number; type?: "text" | "date"; required?: boolean; limit?: number;
}) {
  return <label className="field">{label}{required && " (required)"}
    <input name={name} type={type} defaultValue={value} required={required} maxLength={limit} min={type === "date" ? "1900-01-01" : undefined}
      max={type === "date" ? "2199-12-31" : undefined} />
  </label>;
}

function PersonFields({ label, prefix, value, employment }: {
  label: string; prefix: string; value?: { name: string; nmls?: string; employment?: string }; employment?: boolean;
}) {
  return <div className="record-form min-w-0">
    <Field name={prefix + "-name"} label={label + " name"} value={value?.name} />
    <Field name={prefix + "-nmls"} label={label + " NMLS ID"} value={value?.nmls} limit={15} />
    {employment && <Field name={prefix + "-employment"} label={label + " employment status"} value={value?.employment} limit={100} />}
  </div>;
}

export function TexasLogForm({ initial, authority: initialAuthority, busy, save, cancel }: {
  initial?: TexasLogFacts; authority?: Save["authority"]; busy: boolean;
  save: (data: Pick<Save, "facts" | "authority" | "correction">) => void; cancel: () => void;
}) {
  const [log, setLog] = useState<TexasLogFacts["log"]>(initial?.log ?? "Origination");
  const [authority, setAuthority] = useState(initialAuthority ?? "Mortgage company");
  const [zone, setZone] = useState<TexasLogFacts["zone"]>(initial?.zone ?? "America/Chicago");
  const [disposition, setDisposition] = useState<TexasLogFacts["disposition"]>(initial?.disposition ?? "Unresolved");
  const [cd, setCd] = useState(initial?.log === texasLogTypes[1] ? initial.closingDisclosureFee : "Unresolved");
  const [applicants, setApplicants] = useState(initial?.applicants.length || 1);
  const [workers, setWorkers] = useState(initial?.log === texasLogTypes[1] ? initial.workers.length || 1 : 1);
  const [error, setError] = useState("");
  const origination = initial?.log === "Origination" ? initial : undefined;
  const processing = initial?.log === texasLogTypes[1] ? initial : undefined;

  function submit(form: FormData) {
    const read = (key: string) => String(form.get(key) ?? "").trim() || undefined;
    function party(prefix: string, employment = false) {
      const name = read(prefix + "-name"), nmls = read(prefix + "-nmls"), job = read(prefix + "-employment");
      return name || nmls || job ? { name, nmls, ...(employment ? { employment: job } : {}) } : undefined;
    }
    const property = { street: read("street"), city: read("city"), state: read("state")?.toUpperCase(), zip: read("zip") };
    const fees = Object.fromEntries(feeStages.map(stage => {
      const value = read(stage);
      return [stage, value === undefined ? undefined : /^\d+(\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : NaN];
    }));
    const common = {
      log, zone, fileNumber: read("file"), lenderFileNumber: read("lenderFile"),
      applicants: Array.from({ length: applicants }, (_, index) => ({ first: read("first-" + index), last: read("last-" + index) }))
        .filter(item => item.first || item.last),
      property: (property.street || property.city || property.zip || property.state !== "TX") ? property : undefined,
      occupancy: read("occupancy"), disposition, dispositionDetails: read("dispositionDetails"),
      closedOn: read("closedOn"), entryEventOn: read("event"), evidence: read("evidence"),
    };
    const rate = read("rate");
    const parsed = texasLogFacts.safeParse(log === "Origination" ? {
      ...common, applicationOn: read("firstOn"), interestRate: rate === undefined ? undefined : Number(rate),
      purpose: read("purpose"), product: read("product"), lien: read("lien"), initialOriginator: party("originator"),
      fundingLender: party("funding"), lenderNmlsException: read("lenderException"),
    } : {
      ...common, serviceStartedOn: read("firstOn"), clientFileNumber: read("clientFile"), client: party("client"),
      workers: Array.from({ length: workers }, (_, index) => party("worker-" + index, true)).filter(Boolean),
      fees: Object.values(fees).some(value => value !== undefined) || read("feeReference") ? { ...fees, reference: read("feeReference") } : undefined,
      closingDisclosureFee: cd, closingDisclosureReference: read("cdReference"),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const labels: Record<string, string> = { applicants: "Enter both names for each applicant you record.", property: "Complete the street, city, two-letter state and ZIP code.",
        workers: "Enter the name of each processor or underwriter you record.", interestRate: "Enter an interest rate from 0 to 100.",
        fees: "Enter fee amounts in dollars with up to two decimal places and provide a fee reference.",
        evidence: "Enter an evidence reference of at least four characters." };
      setError(issue.code === "custom" ? issue.message : labels[String(issue.path[0])] ?? "Check the recorded dates, names, identifiers and references.");
      return;
    }
    const correction = read("correction");
    if (initial && (!correction || correction.length < 4)) { setError("Enter a correction reason of at least four characters."); return; }
    setError("");
    save({ facts: parsed.data, authority, correction });
  }

  return <form className="record-form w-full max-w-3xl" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    {error && <p role="alert" tabIndex={-1} ref={node => node?.focus()}>{error}</p>}
    <fieldset className="record-form min-w-0" disabled={busy}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <RegisterChoice label="Log" value={log} options={texasLogTypes} change={setLog} disabled={!!initial}
          optionLabel={value => value === texasLogTypes[1] ? "Processing or underwriting" : value} />
        <RegisterChoice label="Texas authority" value={authority} options={authorities} change={setAuthority} disabled={!!initial} />
        <RegisterChoice label="Event time zone" value={zone} options={texasLogZones} change={setZone} disabled={!!initial}
          optionLabel={value => value === "America/Chicago" ? "Central" : "Mountain"} />
        <Field label="File number" name="file" value={initial?.fileNumber} required limit={100} />
        <Field label={log === "Origination" ? "Initial application date" : "Service start date"} name="firstOn" type="date"
          key={log} value={origination?.applicationOn ?? processing?.serviceStartedOn} />
        <Field label="Event date for this entry" name="event" type="date" value={initial?.entryEventOn} required />
      </div>
      <Field label="Evidence reference" name="evidence" value={initial?.evidence} required limit={240} />
      <details className="details-section">
        <summary className="min-h-11 content-center">Applicants and property</summary>
        <div className="record-form">
          {Array.from({ length: applicants }, (_, index) => <div key={index} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Field name={"last-" + index} label={"Applicant " + (index + 1) + " last name"} value={initial?.applicants[index]?.last} limit={100} />
            <Field name={"first-" + index} label={"Applicant " + (index + 1) + " first name"} value={initial?.applicants[index]?.first} limit={100} />
          </div>)}
          <div className="loan-application-actions">
            <Button type="button" variant="outline" className="min-h-11" disabled={applicants >= 12} onClick={() => setApplicants(applicants + 1)}>Add applicant</Button>
            {applicants > 1 && <Button type="button" variant="outline" className="min-h-11" onClick={() => setApplicants(applicants - 1)}>Remove last applicant</Button>}
          </div>
          <Field label="Property street" name="street" value={initial?.property?.street} />
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <Field label="Property city" name="city" value={initial?.property?.city} limit={100} />
            <Field label="Property state" name="state" value={initial?.property?.state ?? "TX"} limit={2} />
            <Field label="Property ZIP" name="zip" value={initial?.property?.zip} limit={10} />
          </div>
          <Field label="Intended occupancy" name="occupancy" value={initial?.occupancy} limit={120} />
        </div>
      </details>
      <details className="details-section" key={log}>
        <summary className="min-h-11 content-center">{log === "Origination" ? "Loan terms and originator" : "Client, staff and fees"}</summary>
        <div className="record-form">
          <Field label="Lender file number if different" name="lenderFile" value={initial?.lenderFileNumber} limit={100} />
          {log === "Origination" ? <>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Field label="Interest rate (%)" name="rate" value={origination?.interestRate} limit={20} />
              <Field label="Loan purpose" name="purpose" value={origination?.purpose} limit={120} />
              <Field label="Loan product" name="product" value={origination?.product} limit={120} />
              <Field label="Lien position" name="lien" value={origination?.lien} limit={120} />
            </div>
            <PersonFields label="Initial originator" prefix="originator" value={origination?.initialOriginator} />
            <PersonFields label="Initial funding lender" prefix="funding" value={origination?.fundingLender} />
            <Field label="Funding lender NMLS exception" name="lenderException" value={origination?.lenderNmlsException} limit={240} />
          </> : <>
            <Field label="Client file number if different" name="clientFile" value={processing?.clientFileNumber} limit={100} />
            <PersonFields label="Client company or banker" prefix="client" value={processing?.client} />
            {Array.from({ length: workers }, (_, index) => <PersonFields key={index} label={"Processor or underwriter " + (index + 1)}
              prefix={"worker-" + index} value={processing?.workers[index]} employment />)}
            <div className="loan-application-actions">
              <Button type="button" variant="outline" className="min-h-11" disabled={workers >= 30} onClick={() => setWorkers(workers + 1)}>Add worker</Button>
              {workers > 1 && <Button type="button" variant="outline" className="min-h-11" onClick={() => setWorkers(workers - 1)}>Remove last worker</Button>}
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {feeStages.map(stage => {
                const amount = processing?.fees?.[stage];
                return <Field key={stage} label={stage[0].toUpperCase() + stage.slice(1) + " fee (USD)"} name={stage} limit={16}
                  value={amount === undefined ? undefined : (amount / 100).toFixed(2)} />;
              })}
            </div>
            <Field label="Fee evidence reference" name="feeReference" value={processing?.fees?.reference} limit={240} />
            <RegisterChoice label="Direct fee on Closing Disclosure" value={cd} options={cdChoices} change={setCd} />
            <Field label="Closing Disclosure fee reference" name="cdReference" value={processing?.closingDisclosureReference} limit={240} />
          </>}
        </div>
      </details>
      <RegisterChoice label="Current status or disposition" value={disposition} options={texasLogDispositions} change={setDisposition} />
      {disposition === "Other" && <Field label="Disposition details" name="dispositionDetails" value={initial?.dispositionDetails} limit={200} />}
      {disposition === "Closed" && <Field label="Closing date" name="closedOn" type="date" value={initial?.closedOn} />}
      {initial && <Field label="Correction reason" name="correction" required limit={240} />}
      <div className="loan-application-actions">
        <Button type="submit" className="min-h-11">{busy ? "Saving…" : "Save Texas log entry"}</Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={cancel}>Cancel</Button>
      </div>
    </fieldset>
  </form>;
}

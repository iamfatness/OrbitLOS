"use client";

import { illinoisFileDocuments, type IllinoisRecordkeepingFacts as Facts } from "@/lib/illinois-recordkeeping-model";
import { RecordsGroup, RegisterChoice as Choice, RegisterField as Field } from "./retention-register-fields";
import { Button } from "./ui/button";

type Archive = Facts["archive"];
type Dated = { on: string; reference: string };
const emptyDate = { on: "", reference: "" };
const emptyBatch = { ...emptyDate, method: "", originals: "" };
const documentEntries = Object.entries(illinoisFileDocuments) as [keyof Facts["documents"], string][];

function Reference({ label, value, change }: { label: string; value?: string; change: (value: string) => void }) {
  return <Field label={label} value={value ?? null} change={change} multiline limit={240} />;
}

function DatedFields({ label, value, change }: { label: string; value: Dated; change: (value: Dated) => void }) {
  return <fieldset className="record-form min-w-0">
    <legend>{label}</legend>
    <Field label="Date" date value={value.on} change={on => change({ ...value, on })} />
    <Reference label="Evidence reference" value={value.reference} change={reference => change({ ...value, reference })} />
  </fieldset>;
}

function OptionalCheck({ label, value, change }: { label: string; value?: Dated; change: (value: Dated | undefined) => void }) {
  return <div className="record-form">
    <label className="flex min-h-11 items-center gap-2">
      <input type="checkbox" className="shrink-0 accent-[var(--accent)]" checked={!!value}
        onChange={event => change(event.target.checked ? emptyDate : undefined)} />
      {label}
    </label>
    {value && <DatedFields label={label} value={value} change={change} />}
  </div>;
}

function ArchiveFields({ archive, change }: { archive: Archive; change: (value: Archive) => void }) {
  const digital = "conversion" in archive ? archive : null;
  return <RecordsGroup title="Archive and paper conversion">
    <Choice label="Retention medium" value={archive.format} options={["Unresolved", "Paper", "Digital", "Paper and digital"]} change={format => {
      if (format === "Unresolved") change({ format });
      else if (format === "Paper") change({ format, location: "location" in archive ? archive.location : "" });
      else change({ ...digital, format, location: "location" in archive ? archive.location : "",
        conversion: digital?.conversion ?? { status: "Unresolved" } });
    }} />
    {"location" in archive && <Reference label="Records location" value={archive.location} change={location => change({ ...archive, location })} />}
    {digital && <>
      <OptionalCheck label="Legible hard-copy reproduction check" value={digital.reproduction}
        change={reproduction => change({ ...digital, reproduction })} />
      <OptionalCheck label="Preservation of alterations check" value={digital.changesPreserved}
        change={changesPreserved => change({ ...digital, changesPreserved })} />
      <Choice label="Paper conversion" value={digital.conversion.status} options={["Unresolved", "No paper conversion", "Paper converted"]}
        change={status => change({ ...digital, conversion: status === "No paper conversion" ? { status, reference: "" } :
          status === "Paper converted" ? { status, batches: [emptyBatch] } : { status } })} />
      {digital.conversion.status === "No paper conversion" && <Reference label="No conversion evidence reference" value={digital.conversion.reference}
        change={reference => change({ ...digital, conversion: { status: "No paper conversion", reference } })} />}
      {digital.conversion.status === "Paper converted" && (() => {
        const { batches } = digital.conversion;
        const replace = (index: number, update: Partial<typeof emptyBatch>) => change({ ...digital,
          conversion: { status: "Paper converted", batches: batches.map((batch, position) => position === index ? { ...batch, ...update } : batch) } });
        return <>
          {batches.map((batch, index) => <fieldset key={index} className="record-form min-w-0 border-t border-[var(--line)] pt-2">
            <legend>Conversion {index + 1}</legend>
            <Field label="Conversion date" value={batch.on} date change={on => replace(index, { on })} />
            <Reference label="Conversion method" value={batch.method} change={method => replace(index, { method })} />
            <Reference label="Disposition of paper originals" value={batch.originals} change={originals => replace(index, { originals })} />
            <Reference label="Conversion evidence reference" value={batch.reference} change={reference => replace(index, { reference })} />
            {batches.length > 1 && <div><Button type="button" variant="outline" className="min-h-11" onClick={() => change({ ...digital,
              conversion: { status: "Paper converted", batches: batches.filter((_, position) => position !== index) } })}>
              Remove conversion {index + 1}</Button></div>}
          </fieldset>)}
          {batches.length < 20 && <div><Button type="button" variant="outline" className="min-h-11" onClick={() => change({ ...digital,
            conversion: { status: "Paper converted", batches: [...batches, emptyBatch] } })}>Add paper conversion</Button></div>}
        </>;
      })()}
    </>}
  </RecordsGroup>;
}

export function IllinoisRecordkeepingFields({ facts, change }: { facts: Facts; change: (value: Facts) => void }) {
  const { outcome } = facts;
  return <>
    <Choice label="Illinois activity" value={facts.activity} options={["Unresolved", "Brokerage services used", "Origination only"]}
      change={activity => change({ ...facts, activity })} />
    <Reference label="Activity evidence reference" value={facts.activityReference}
      change={value => change({ ...facts, activityReference: value.trim() ? value : undefined })} />
    <Choice label="High-risk home loan classification" value={facts.risk} options={["Unresolved", "Standard", "High-risk home loan"]}
      change={risk => change({ ...facts, risk })} />
    <Reference label="Classification evidence reference" value={facts.riskReference}
      change={value => change({ ...facts, riskReference: value.trim() ? value : undefined })} />
    <Choice label="Application outcome" value={outcome.status} options={["Unresolved", "Pending", "Closed", "Terminated"]}
      change={status => change({ ...facts, outcome: status === "Closed" || status === "Terminated" ?
        { ...emptyDate, status } : { status } })} />
    {"on" in outcome && <DatedFields label={outcome.status === "Closed" ? "Closing" : "Termination"} value={outcome}
      change={dated => change({ ...facts, outcome: { ...outcome, ...dated } })} />}
    <RecordsGroup title="Application file documents">
      {documentEntries.map(([key, label]) => {
        const entry = facts.documents[key];
        return <fieldset key={key} className="record-form min-w-0">
          <legend>{label}</legend>
          <Choice label="File evidence" value={entry?.status ?? "Unresolved"} options={["Unresolved", "On file", "No document generated"]}
            change={status => change({ ...facts, documents: { ...facts.documents, [key]: status === "Unresolved" ? undefined :
              { status, reference: entry?.reference ?? "" } } })} />
          {entry && <Reference label="Document or outcome reference" value={entry.reference}
            change={reference => change({ ...facts, documents: { ...facts.documents, [key]: { ...entry, reference } } })} />}
        </fieldset>;
      })}
    </RecordsGroup>
    <ArchiveFields archive={facts.archive} change={archive => change({ ...facts, archive })} />
  </>;
}

"use client";

import type { ProgramEntity } from "@/lib/compliance-program-model";
import { cflDocuments, crmlaDocuments, type CaliforniaDfpiFacts as Facts } from "@/lib/california-dfpi-recordkeeping-model";
import { RecordsGroup, RegisterChoice as Choice, RegisterField as Field } from "./retention-register-fields";

type Dated = { on: string; reference: string };
const emptyEvent = (): Dated => ({ on: "", reference: "" });
type Document = Facts["application"];
const unreviewed = { status: "Unreviewed" } as const;
const base = { entityId: "", authorityReference: "", application: unreviewed };
export function blankDfpiFacts(authority: Facts["authority"]): Facts {
  return authority === "CFL" ? { ...base, authority, role: "Broker", custody: { method: "Unreviewed" },
    disclosure: unreviewed, securityInstrument: unreviewed, note: unreviewed, paymentRecord: unreviewed, escrow: unreviewed, insurance: unreviewed } :
    { ...base, authority, role: "Lender", commitment: unreviewed, truthInLending: unreviewed, closingStatement: unreviewed,
      noteAndDeed: unreviewed, adverseAction: unreviewed, appraisal: unreviewed, creditReport: unreviewed, balance: unreviewed };
}

function EventFields({ label, value, change, required }: {
  label: string; value?: Dated; change: (value: Dated | undefined) => void; required?: boolean;
}) {
  const update = (next: Dated) => change(required || next.on || next.reference.trim() ? next : undefined);
  return <div className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
    <Field label={label + " date"} value={value?.on ?? ""} date required={required}
      change={on => update({ on, reference: value?.reference ?? "" })} />
    <Field label={label + " reference"} value={value?.reference ?? ""} limit={240} required={required}
      change={reference => update({ on: value?.on ?? "", reference })} />
  </div>;
}

function DocumentFields({ label, value, change }: { label: string; value: Document; change: (value: Document) => void }) {
  return <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
    <Choice label={label} value={value.status} options={["Unreviewed", "On file", "Not applicable"]}
      change={status => change(status === "Unreviewed" ? { status } : { status, reference: "" })} />
    {value.status !== "Unreviewed" && <Field label={label + " reference"} value={value.reference} limit={240} required
      change={reference => change({ ...value, reference })} />}
  </div>;
}

export function CaliforniaDfpiFields({ facts, entities, change }: {
  facts: Facts; entities: ProgramEntity[]; change: (facts: Facts) => void;
}) {
  const storedEntity = facts.entityId && !entities.some(item => item.id === facts.entityId) ? facts.entityId : "";
  return <>
    <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
      <Choice label="Legal entity (required)" value={facts.entityId}
        options={["", ...entities.map(item => item.id), ...(storedEntity ? [storedEntity] : [])]}
        optionLabel={id => !id ? "Select legal entity" : entities.find(item => item.id === id)?.name ?? "Previously selected entity"}
        change={entityId => change({ ...facts, entityId })} />
      <Field label="DFPI authority reference (required)" value={facts.authorityReference} required limit={240}
        change={authorityReference => change({ ...facts, authorityReference })} />
    </div>
    {facts.authority === "CFL" ?
      <Choice label="CFL license role" value={facts.role} options={["Broker", "Lender"]} change={role => change({ ...facts, role })} /> :
      <Choice label="CRMLA license role" value={facts.role} options={["Lender", "Lender and servicer", "Servicer"]} change={role => change({ ...facts, role })} />}
    <EventFields label="Final entry" value={facts.finalEntry} change={finalEntry => change({ ...facts, finalEntry })} />
    <Field label="Retained file inventory reference" value={facts.inventory ?? ""} limit={240}
      change={inventory => change({ ...facts, inventory: inventory.trim() ? inventory : undefined })} />
    <RecordsGroup title="Loan documents">
      {facts.authority === "CFL" ? (Object.keys(cflDocuments) as (keyof typeof cflDocuments)[]).map(key =>
        <DocumentFields key={key} label={cflDocuments[key]} value={facts[key]} change={value => change({ ...facts, [key]: value })} />) :
        (Object.keys(crmlaDocuments) as (keyof typeof crmlaDocuments)[]).map(key =>
          <DocumentFields key={key} label={crmlaDocuments[key]} value={facts[key]} change={value => change({ ...facts, [key]: value })} />)}
    </RecordsGroup>
    {facts.authority === "CFL" ? <RecordsGroup title="Licensed office custody">
      <Choice label="Records custody" value={facts.custody.method}
        options={["Unreviewed", "Physical at licensed office", "Digital access from licensed office", "Other authorized custody"]}
        optionLabel={method => method === "Digital access from licensed office" ? "Digital at licensed office" : method}
        change={method => change({ ...facts, custody: method === "Unreviewed" ? { method } :
          method === "Other authorized custody" ? { method, approval: "" } : { method, office: "" } })} />
      {"office" in facts.custody && <Field label="Licensed office reference" value={facts.custody.office} required limit={240}
        change={office => change({ ...facts, custody: { method: "office" in facts.custody ? facts.custody.method : "Physical at licensed office", office,
          retrieval: "retrieval" in facts.custody ? facts.custody.retrieval : undefined } })} />}
      {facts.custody.method === "Other authorized custody" && <Field label="Custody approval reference" value={facts.custody.approval} required limit={240}
        change={approval => change({ ...facts, custody: { ...facts.custody, method: "Other authorized custody", approval } })} />}
      {facts.custody.method !== "Unreviewed" && <EventFields label="Retrieval test" value={facts.custody.retrieval}
        change={retrieval => { if (facts.custody.method !== "Unreviewed") change({ ...facts, custody: { ...facts.custody, retrieval } }); }} />}
    </RecordsGroup> : <RecordsGroup title="Loan log, balance and examination">
      <Field label="36-month loan log reference" value={facts.loanLog ?? ""} limit={240}
        change={loanLog => change({ ...facts, loanLog: loanLog.trim() ? loanLog : undefined })} />
      <Choice label="Outstanding balance" value={facts.balance.status}
        options={["Unreviewed", "Balance remains", "No balance", "Not applicable"]}
        change={status => change({ ...facts, balance: status === "Unreviewed" ? { status } : { status, reference: "" } })} />
      {facts.balance.status !== "Unreviewed" && <Field label="Balance evidence reference" value={facts.balance.reference} required limit={240}
        change={reference => { if (facts.balance.status !== "Unreviewed") change({ ...facts, balance: { ...facts.balance, reference } }); }} />}
      <EventFields label="Examination notice" value={facts.production?.notice}
        change={notice => change({ ...facts, production: notice ? { ...facts.production, notice } : undefined })} />
      {facts.production && <EventFields label="Records made available" value={facts.production.produced}
        change={produced => change({ ...facts, production: { notice: facts.production?.notice ?? emptyEvent(), produced } })} />}
    </RecordsGroup>}
  </>;
}

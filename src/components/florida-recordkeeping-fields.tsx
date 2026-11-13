"use client";

import type { ProgramEntity } from "@/lib/compliance-program-model";
import { floridaRecordGroups, type FloridaRecordkeepingFacts as Facts } from "@/lib/florida-recordkeeping-model";
import { RecordsGroup, RegisterChoice as Choice, RegisterField as Field } from "./retention-register-fields";

type Dated = { on: string; reference: string };
const emptyDate = (): Dated => ({ on: "", reference: "" });
export const floridaGroupKeys = Object.keys(floridaRecordGroups) as (keyof Facts["records"])[];
export const blankFloridaFacts = (): Facts => ({
  entityId: "", authority: "Mortgage broker", authorityReference: "", zone: "America/New_York",
  records: { loanFile: { status: "Unreviewed" }, accounts: { status: "Unreviewed" }, expenseReceipts: { status: "Unreviewed" },
    closingStatements: { status: "Unreviewed" }, other: { status: "Unreviewed" } },
  custody: { method: "Unreviewed" },
});

function EventFields({ label, value, change, required }: {
  label: string; value?: Dated; change: (value?: Dated) => void; required?: boolean;
}) {
  const update = (next: Dated) => change(required || next.on || next.reference.trim() ? next : undefined);
  return <div className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
    <Field label={label + " date"} value={value?.on ?? ""} date required={required}
      change={on => update({ on, reference: value?.reference ?? "" })} />
    <Field label={label + " reference"} value={value?.reference ?? ""} required={required} limit={240}
      change={reference => update({ on: value?.on ?? "", reference })} />
  </div>;
}

function AlternateCustodyFields({ custody, company, change }: {
  custody: Extract<Facts["custody"], { method: "OFR-authorized location" }>;
  company: boolean;
  change: (value: typeof custody) => void;
}) {
  const locationChange = custody.locationChange;
  return <>
    <Field label="OFR authorization reference" value={custody.authorization} required limit={240}
      change={authorization => change({ ...custody, authorization })} />
    <Field label="Secure storage evidence" value={custody.secureStorage ?? ""} limit={240}
      change={secureStorage => change({ ...custody, secureStorage: secureStorage || undefined })} />
    {company && <>
      <Choice label="Alternate location history" value={locationChange?.status ?? "Unreviewed"}
        options={["Unreviewed", "Original location", "Location change"]}
        change={status => change({ ...custody, locationChange: status === "Original location" ? { status, reference: "" } :
          status === "Location change" ? { status, effectiveOn: "" } : undefined })} />
      {locationChange?.status === "Original location" && <Field label="Original location evidence" value={locationChange.reference}
        limit={240} required change={reference => change({ ...custody, locationChange: { ...locationChange, reference } })} />}
      {locationChange?.status === "Location change" && <>
        <Field label="Location change effective date" value={locationChange.effectiveOn} date required
          change={effectiveOn => change({ ...custody, locationChange: { ...locationChange, effectiveOn } })} />
        <EventFields label="NMLS MU1 filing" value={locationChange.filing}
          change={filing => change({ ...custody, locationChange: { ...locationChange, filing } })} />
      </>}
    </>}
  </>;
}

export function FloridaRecordkeepingFields({ facts, entities, change }: {
  facts: Facts; entities: ProgramEntity[]; change: (facts: Facts) => void;
}) {
  const { custody, examination } = facts;
  const storedEntity = facts.entityId && !entities.some(item => item.id === facts.entityId) ? facts.entityId : "";
  return <>
    <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
      <Choice label="Legal entity (required)" value={facts.entityId}
        options={["", ...entities.map(item => item.id), ...(storedEntity ? [storedEntity] : [])]}
        optionLabel={id => !id ? "Select legal entity" : entities.find(item => item.id === id)?.name ?? "Previously selected entity"}
        change={entityId => change({ ...facts, entityId })} />
      <Choice label="Florida license or authority" value={facts.authority} options={["Mortgage broker", "Mortgage lender", "Loan originator"]}
        change={authority => change({ ...facts, authority })} />
      <Field label="Florida authority reference" value={facts.authorityReference} change={authorityReference => change({ ...facts, authorityReference })}
        required limit={240} />
      <Choice label="Records time zone" value={facts.zone} options={["America/New_York", "America/Chicago"]}
        optionLabel={zone => zone === "America/Chicago" ? "Central Time" : "Eastern Time"} change={zone => change({ ...facts, zone })} />
    </div>
    <Field label="Retained file inventory reference" value={facts.inventory ?? ""} limit={240}
      change={inventory => change({ ...facts, inventory: inventory.trim() ? inventory : undefined })} />
    <RecordsGroup title="Record entry dates">
      <p className="muted">Use the latest original entry date in each record group.</p>
      {floridaGroupKeys.map(key => {
        const record = facts.records[key];
        const label = floridaRecordGroups[key];
        const update = (value: typeof record) => change({ ...facts, records: { ...facts.records, [key]: value } });
        return <div className="record-form min-w-0 border-b border-[var(--line)] pb-3 last:border-0" key={key}>
          <Choice label={label} value={record.status} options={["Unreviewed", "On file", "Not applicable"]}
            change={status => update(status === "On file" ? { status, latestOriginalEntry: emptyDate() } :
              status === "Not applicable" ? { status, reference: "" } : { status })} />
          {record.status === "On file" && <EventFields label={label + " original entry"} value={record.latestOriginalEntry} required
            change={value => update({ ...record, latestOriginalEntry: value ?? emptyDate() })} />}
          {record.status === "Not applicable" && <Field label={label + " applicability reference"} value={record.reference} limit={240} required
            change={reference => update({ ...record, reference })} />}
        </div>;
      })}
    </RecordsGroup>
    <RecordsGroup title="Custody and retrieval">
      <Choice label="Records custody" value={custody.method} options={["Unreviewed", "Licensed principal place", "OFR-authorized location"]}
        change={method => {
          const location = "location" in custody ? custody.location : "";
          change({ ...facts, custody: method === "OFR-authorized location" ? { method, location, authorization: "" } :
            method === "Licensed principal place" ? { method, location } : { method } });
        }} />
      {custody.method !== "Unreviewed" && <>
        <Field label="Records location" value={custody.location} required limit={240}
          change={location => change({ ...facts, custody: { ...custody, location } })} />
        {custody.method === "OFR-authorized location" && <AlternateCustodyFields custody={custody}
          company={facts.authority !== "Loan originator"} change={value => change({ ...facts, custody: value })} />}
        <EventFields label="File retrieval check" value={custody.retrieval}
          change={retrieval => change({ ...facts, custody: { ...custody, retrieval } })} />
      </>}
    </RecordsGroup>
    <RecordsGroup title="OFR examination and production">
      <Choice label="OFR examination request" value={examination ? "Request received" : "No request recorded"}
        options={["No request recorded", "Request received"]}
        change={status => change({ ...facts, examination: status === "Request received" ? { notice: emptyDate(), floridaLocation: "" } : undefined })} />
      {examination && <>
        <EventFields label="OFR request" value={examination.notice} required
          change={notice => change({ ...facts, examination: { ...examination, notice: notice ?? emptyDate() } })} />
        <Field label="Florida production location" value={examination.floridaLocation} limit={240} required
          change={floridaLocation => change({ ...facts, examination: { ...examination, floridaLocation } })} />
        {custody.method === "OFR-authorized location" && <>
          <Choice label="Request format" value={examination.clock?.request ?? "Unreviewed"}
            options={["Unreviewed", "Written OFR request", "Other request"]}
            change={request => change({ ...facts, examination: { ...examination, clock: request === "Written OFR request" ? { request } :
              request === "Other request" ? { request, reference: "" } : undefined } })} />
          {examination.clock?.request === "Written OFR request" && <EventFields label="Third business day"
            value={examination.clock.deadline}
            change={deadline => change({ ...facts, examination: { ...examination, clock: { request: "Written OFR request", deadline } } })} />}
          {examination.clock?.request === "Other request" && <Field label="Request format evidence" value={examination.clock.reference}
            limit={240} required change={reference => change({ ...facts, examination: { ...examination, clock: { request: "Other request", reference } } })} />}
        </>}
        <EventFields label="Records produced" value={examination.production}
          change={production => change({ ...facts, examination: { ...examination, production } })} />
      </>}
    </RecordsGroup>
  </>;
}

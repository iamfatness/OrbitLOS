"use client";

import type { ProgramEntity } from "@/lib/compliance-program-model";
import { texasRecordGroups, type TexasRecordkeepingFacts as Facts } from "@/lib/texas-recordkeeping-model";
import { RecordsGroup, RegisterChoice as Choice, RegisterField as Field } from "./retention-register-fields";

type Dated = { on: string; reference: string };
const emptyDate = (): Dated => ({ on: "", reference: "" });
export const texasGroupKeys = Object.keys(texasRecordGroups) as (keyof Facts["records"])[];
export const blankTexasFacts = (): Facts => ({
  entityId: "", authority: "SML mortgage company", authorityReference: "",
  zone: "America/Chicago", role: "Unreviewed", records: {},
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

export function TexasRecordkeepingFields({ facts, entities, change }: {
  facts: Facts; entities: ProgramEntity[]; change: (facts: Facts) => void;
}) {
  const { archive, examination } = facts;
  const storedEntity = facts.entityId && !entities.some(item => item.id === facts.entityId) ? facts.entityId : "";
  return <>
    <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
      <Choice label="Legal entity (required)" value={facts.entityId}
        options={["", ...entities.map(item => item.id), ...(storedEntity ? [storedEntity] : [])]}
        optionLabel={id => !id ? "Select legal entity" : entities.find(item => item.id === id)?.name ?? "Previously selected entity"}
        change={entityId => change({ ...facts, entityId })} />
      <Choice label="Texas license or registration" value={facts.authority} options={["SML mortgage company", "SML mortgage banker"]}
        change={authority => change({ ...facts, authority })} />
      <Field label="Texas authority reference" value={facts.authorityReference} required limit={240}
        change={authorityReference => change({ ...facts, authorityReference })} />
      <Choice label="Records time zone" value={facts.zone} options={["America/Chicago", "America/Denver"]}
        optionLabel={zone => zone === "America/Denver" ? "Mountain Time" : "Central Time"} change={zone => change({ ...facts, zone })} />
    </div>
    <Choice label="Transaction role" value={facts.role} options={["Unreviewed", "Brokered", "Made the loan"]}
      change={role => change({ ...facts, role })} />
    <EventFields label="Initial application" value={facts.application} change={application => change({ ...facts, application })} />
    <Field label="Retained file inventory reference" value={facts.inventory ?? ""} limit={240}
      change={inventory => change({ ...facts, inventory: inventory.trim() ? inventory : undefined })} />
    <RecordsGroup title="Loan file checklist">
      {texasGroupKeys.map(key => {
        const record = facts.records[key];
        const label = texasRecordGroups[key];
        const update = (value: typeof record) => change({ ...facts, records: { ...facts.records, [key]: value } });
        return <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2" key={key}>
          <Choice label={label} value={record?.status ?? "Unreviewed"} options={["Unreviewed", "On file", "Not applicable"]}
            change={status => update(status === "Unreviewed" ? undefined : { status, reference: record?.reference ?? "" })} />
          {record && <Field label={label + " reference"} value={record.reference} required limit={240}
            change={reference => update({ ...record, reference })} />}
        </div>;
      })}
      {facts.role === "Brokered" && <EventFields label="Executed lender copies retrieved" value={facts.lenderCopies}
        change={lenderCopies => change({ ...facts, lenderCopies })} />}
    </RecordsGroup>
    <RecordsGroup title="Archive and retention basis">
      <Choice label="Records location" value={archive?.location ?? "Unreviewed"}
        options={["Unreviewed", "Main office", "NMLS MU1 designated location"]}
        change={location => change({ ...facts, archive: location === "Unreviewed" ? undefined : { ...archive, location, reference: archive?.reference ?? "" } })} />
      {archive && <>
        <Field label="Archive reference" value={archive.reference} required limit={240}
          change={reference => change({ ...facts, archive: { ...archive, reference } })} />
        <EventFields label="File retrieval check" value={archive.retrieval}
          change={retrieval => change({ ...facts, archive: { ...archive, retrieval } })} />
      </>}
      <EventFields label="Documented retention start" value={facts.retentionBasis} change={retentionBasis => change({ ...facts, retentionBasis })} />
    </RecordsGroup>
    <RecordsGroup title="SML examination and production">
      <Choice label="SML examination request" value={examination ? "Request received" : "No request recorded"}
        options={["No request recorded", "Request received"]}
        change={status => change({ ...facts, examination: status === "Request received" ? { notice: emptyDate() } : undefined })} />
      {examination && <>
        <EventFields label="SML request" value={examination.notice} required
          change={notice => change({ ...facts, examination: { ...examination, notice: notice ?? emptyDate() } })} />
        <EventFields label="Records produced" value={examination.production}
          change={production => change({ ...facts, examination: { ...examination, production } })} />
      </>}
    </RecordsGroup>
  </>;
}

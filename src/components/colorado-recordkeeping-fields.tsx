"use client";

import type { ProgramEntity } from "@/lib/compliance-program-model";
import { coloradoDocuments, type ColoradoRecordkeepingFacts as Facts } from "@/lib/colorado-recordkeeping-model";
import { RecordsGroup, RegisterChoice as Choice, RegisterField as Field } from "./retention-register-fields";

type Dated = { on: string; reference: string };
const emptyDate = (): Dated => ({ on: "", reference: "" });
const optional = (value: string) => value.trim() ? value : undefined;
export const coloradoDocumentKeys = Object.keys(coloradoDocuments) as (keyof typeof coloradoDocuments)[];
export const blankColoradoFacts = (): Facts => ({ entityId: "", scopeReference: "", documents: {} });

function Reference({ label, value, change, required }: {
  label: string; value?: string; change: (value: string) => void; required?: boolean;
}) {
  return <Field label={label} value={value ?? ""} change={change} required={required} limit={240} />;
}

function EventFields({ label, value, change, required }: {
  label: string; value?: Dated; change: (value: Dated | undefined) => void; required?: boolean;
}) {
  const update = (next: Dated) => change(required || next.on || next.reference.trim() ? next : undefined);
  return <div className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
    <Field label={label + " date"} value={value?.on ?? ""} date required={required}
      change={on => update({ on, reference: value?.reference ?? "" })} />
    <Reference label={label + " reference"} value={value?.reference} required={required}
      change={reference => update({ on: value?.on ?? "", reference })} />
  </div>;
}

function Timestamp({ label, value, change }: { label: string; value?: string; change: (value?: string) => void }) {
  return <Reference label={label} value={value} change={input => change(optional(input))} />;
}

export function ColoradoRecordkeepingFields({ facts, entities, change }: {
  facts: Facts; entities: ProgramEntity[]; change: (facts: Facts) => void;
}) {
  const { archive, investigation } = facts;
  const extension = investigation?.extension;
  const approval = extension?.approval;
  const response = investigation?.response;
  const storedEntity = facts.entityId && !entities.some(item => item.id === facts.entityId) ? facts.entityId : "";
  return <>
    <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
      <Choice label="Legal entity (required)" value={facts.entityId}
        options={["", ...entities.map(item => item.id), ...(storedEntity ? [storedEntity] : [])]}
        optionLabel={id => !id ? "Select legal entity" : entities.find(item => item.id === id)?.name ?? "Previously selected entity"}
        change={entityId => change({ ...facts, entityId })} />
      <Reference label="Colorado authority reference (required)" value={facts.scopeReference} required change={scopeReference => change({ ...facts, scopeReference })} />
    </div>
    <Reference label="Retained file inventory reference" value={facts.inventory}
      change={inventory => change({ ...facts, inventory: optional(inventory) })} />
    <EventFields label="Documented retention start" value={facts.retentionBasis} change={retentionBasis => change({ ...facts, retentionBasis })} />
    <RecordsGroup title="Loan and marketing documents">
      {coloradoDocumentKeys.map(key => {
        const item = facts.documents[key];
        const update = (value: typeof item) => change({ ...facts, documents: { ...facts.documents, [key]: value } });
        return <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2" key={key}>
          <Choice label={coloradoDocuments[key]} value={item?.status ?? "Unreviewed"} options={["Unreviewed", "On file", "Not applicable"]}
            change={status => update(status === "Unreviewed" ? undefined : { status, reference: item?.reference ?? "" })} />
          {item && <Reference label={coloradoDocuments[key] + " reference"} value={item.reference} required
            change={reference => update({ ...item, reference })} />}
        </div>;
      })}
    </RecordsGroup>
    <RecordsGroup title="Secure archive and retrieval">
      <Choice label="Archive medium" value={archive?.medium ?? "Unreviewed"} options={["Unreviewed", "Paper", "Electronic", "Paper and electronic"]}
        change={medium => change({ ...facts, archive: medium === "Unreviewed" ? undefined : { location: "", ...archive, medium } })} />
      {archive && <>
        <Reference label="Archive location (required)" value={archive.location} required change={location => change({ ...facts, archive: { ...archive, location } })} />
        <Reference label="Secure custody reference" value={archive.securityReference}
          change={value => change({ ...facts, archive: { ...archive, securityReference: optional(value) } })} />
        <EventFields label="File retrieval test" value={archive.retrieval} change={retrieval => change({ ...facts, archive: { ...archive, retrieval } })} />
      </>}
    </RecordsGroup>
    <RecordsGroup title="Board investigation and response">
      <Choice label="Board investigation" value={investigation ? "Notice received" : "No notice recorded"}
        options={["No notice recorded", "Notice received"]}
        change={status => change({ ...facts, investigation: status === "Notice received" ? { notice: emptyDate(), dueOn: "" } : undefined })} />
      {investigation && <>
        <EventFields label="Board notice" value={investigation.notice} required
          change={notice => change({ ...facts, investigation: { ...investigation, notice: notice ?? emptyDate() } })} />
        <Field label="Deadline in the Board notice" date value={investigation.dueOn} required
          change={dueOn => change({ ...facts, investigation: { ...investigation, dueOn } })} />
        <p className="muted">For exact times, include the offset as shown here: 2026-10-20T17:00:00-06:00.</p>
        <Timestamp label="Original cutoff timestamp" value={investigation.dueAt}
          change={dueAt => change({ ...facts, investigation: { ...investigation, dueAt } })} />
        <Choice label="Extension status" value={approval ? "Granted" : extension ? "Requested" : "No request recorded"}
          options={["No request recorded", "Requested", "Granted"]}
          change={status => change({ ...facts, investigation: { ...investigation, extension: status === "No request recorded" ? undefined :
            { requested: extension?.requested ?? emptyDate(), approval: status === "Granted" ? { ...emptyDate(), dueOn: "" } : undefined } } })} />
        {extension && <>
          <EventFields label="Extension request" value={extension.requested} required
            change={requested => change({ ...facts, investigation: { ...investigation, extension: { ...extension, requested: { ...extension.requested, ...(requested ?? emptyDate()) } } } })} />
          <Timestamp label="Board receipt of extension request timestamp" value={extension.requested.at}
            change={at => change({ ...facts, investigation: { ...investigation, extension: { ...extension, requested: { ...extension.requested, at } } } })} />
          {approval && <>
            <EventFields label="Board approval" value={approval} required change={value => change({ ...facts,
              investigation: { ...investigation, extension: { ...extension, approval: { ...approval, ...(value ?? emptyDate()) } } } })} />
            <Field label="Approved extended deadline" date value={approval.dueOn} required change={dueOn => change({ ...facts,
              investigation: { ...investigation, extension: { ...extension, approval: { ...approval, dueOn } } } })} />
            <Timestamp label="Approved cutoff timestamp" value={approval.dueAt} change={dueAt => change({ ...facts,
              investigation: { ...investigation, extension: { ...extension, approval: { ...approval, dueAt } } } })} />
          </>}
        </>}
        <EventFields label="Response delivery" value={response}
          change={value => change({ ...facts, investigation: { ...investigation, response: value ? { ...response, ...value } : undefined } })} />
        {response && <Timestamp label="Response submission timestamp" value={response.at}
          change={at => change({ ...facts, investigation: { ...investigation, response: { ...response, at } } })} />}
        {response && ([
          ["allegations", "Answers to complaint allegations"], ["questions", "Answers to Board notice questions"], ["documents", "Requested records produced"],
        ] as const).map(([key, label]) => <Reference key={key} label={label} value={response[key]}
          change={value => change({ ...facts, investigation: { ...investigation, response: { ...response, [key]: optional(value) } } })} />)}
      </>}
    </RecordsGroup>
  </>;
}

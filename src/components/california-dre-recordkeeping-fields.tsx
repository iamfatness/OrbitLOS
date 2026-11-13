"use client";

import type { ProgramEntity } from "@/lib/compliance-program-model";
import { californiaDreArchiveChecks, type CaliforniaDreRecordkeepingFacts as Facts } from "@/lib/california-dre-recordkeeping-model";
import { RecordsGroup, RegisterChoice as Choice, RegisterField as Field } from "./retention-register-fields";

type Dated = { on: string; reference: string };
type Check = Facts["mortgageDisclosure"];
const blankDate = (): Dated => ({ on: "", reference: "" });
const blankCheck = () => ({ status: "Unreviewed" as const });

export const blankDreFacts = (): Facts => ({
  entityId: "", authorityReference: "", outcome: { status: "Unresolved" }, mortgageDisclosure: blankCheck(),
  trustRecords: blankCheck(), electronicSignatures: blankCheck(), privateMoney: blankCheck(), archive: { format: "Unreviewed" },
});

export const dreFileChecks = {
  mortgageDisclosure: "Signed mortgage disclosure or retained alternative",
  trustRecords: "Trust records",
  electronicSignatures: "Electronic signature copies",
} as const;
export const drePrivateChecks = {
  selfDealing: "Self-dealing statement",
  investorQualifications: "Investor qualification records",
  investorSuitability: "Investor suitability records",
} as const;
export const dreArchiveCheckKeys = Object.keys(californiaDreArchiveChecks) as (keyof typeof californiaDreArchiveChecks)[];
export const dreFileCheckKeys = Object.keys(dreFileChecks) as (keyof typeof dreFileChecks)[];
export const drePrivateCheckKeys = Object.keys(drePrivateChecks) as (keyof typeof drePrivateChecks)[];

function DatedFields({ label, value, change, required }: {
  label: string; value?: Dated; change: (value: Dated | undefined) => void; required?: boolean;
}) {
  function update(next: Dated) {
    change(required || next.on || next.reference.trim() ? next : undefined);
  }
  return <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
    <Field label={label + " date"} value={value?.on ?? ""} date required={required}
      change={on => update({ on, reference: value?.reference ?? "" })} />
    <Field label={label + " reference"} value={value?.reference ?? ""} limit={240} required={required}
      change={reference => update({ on: value?.on ?? "", reference })} />
  </div>;
}

function CheckFields({ label, value, change }: { label: string; value: Check; change: (value: Check) => void }) {
  return <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
    <Choice label={label} value={value.status} options={["Unreviewed", "On file", "Not applicable"]}
      change={status => change(status === "Unreviewed" ? { status } : { status, reference: "" })} />
    {value.status !== "Unreviewed" && <Field label={label + " reference"} value={value.reference} limit={240}
      required change={reference => change({ ...value, reference })} />}
  </div>;
}

export function CaliforniaDreRecordkeepingFields({ facts, entities, change }: {
  facts: Facts; entities: ProgramEntity[]; change: (value: Facts) => void;
}) {
  const { outcome, archive, privateMoney } = facts;
  const storedEntity = facts.entityId && !entities.some(item => item.id === facts.entityId) ? facts.entityId : "";
  return <div className="record-form min-w-0">
    <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
      <Choice label="Legal entity (required)" value={facts.entityId}
        options={["", ...entities.map(item => item.id), ...(storedEntity ? [storedEntity] : [])]}
        optionLabel={id => !id ? "Select legal entity" : entities.find(item => item.id === id)?.name ?? "Previously selected entity"}
        change={entityId => change({ ...facts, entityId })} />
      <Field label="DRE authority reference (required)" value={facts.authorityReference} required limit={240}
        change={authorityReference => change({ ...facts, authorityReference })} />
    </div>
    <Choice label="Application outcome" value={outcome.status} options={["Unresolved", "Pending", "Closed", "Unconsummated"]}
      optionLabel={status => status === "Unconsummated" ? "Ended without closing" : status}
      change={status => change({ ...facts, outcome: status === "Closed" ? { status, ...blankDate() } :
        status === "Unconsummated" ? { status, application: blankDate() } : { status } })} />
    {outcome.status === "Closed" && <DatedFields label="Closing" value={outcome} required
      change={value => change({ ...facts, outcome: { status: "Closed", ...(value ?? blankDate()) } })} />}
    {outcome.status === "Unconsummated" && <>
      <DatedFields label="Mortgage application" value={outcome.application} required
        change={application => change({ ...facts, outcome: { ...outcome, application: application ?? blankDate() } })} />
      <DatedFields label="Listing, if recorded" value={outcome.listing} change={listing => change({ ...facts, outcome: { ...outcome, listing } })} />
    </>}
    <Field label="Transaction file inventory reference" value={facts.fileInventory ?? ""} limit={240}
      change={fileInventory => change({ ...facts, fileInventory: fileInventory.trim() ? fileInventory : undefined })} />
    <RecordsGroup title="Disclosure, trust and signature evidence">
      {dreFileCheckKeys.map(key => <CheckFields key={key} label={dreFileChecks[key]} value={facts[key]}
        change={value => change({ ...facts, [key]: value })} />)}
    </RecordsGroup>
    <RecordsGroup title="Archive and examination retrieval">
      <Choice label="Retention medium" value={archive.format} options={["Unreviewed", "Paper", "Electronic", "Paper and electronic"]}
        change={format => {
          if (format === "Unreviewed") change({ ...facts, archive: { format } });
          else if (format === "Paper") change({ ...facts, archive: { format, location: "location" in archive ? archive.location : "",
            inspection: "inspection" in archive ? archive.inspection : undefined } });
          else change({ ...facts, archive: { location: "", ...archive, format } });
        }} />
      {"location" in archive && <>
        <Field label="Archive location (required)" value={archive.location} required limit={240}
          change={location => change({ ...facts, archive: { ...archive, location } })} />
        <DatedFields label="Office viewing and paper-copy test" value={archive.inspection}
          change={inspection => change({ ...facts, archive: { ...archive, inspection } })} />
      </>}
      {(archive.format === "Electronic" || archive.format === "Paper and electronic") && dreArchiveCheckKeys.map(key =>
        <Field key={key} label={californiaDreArchiveChecks[key]} value={archive[key] ?? ""} multiline limit={240}
          change={value => change({ ...facts, archive: { ...archive, [key]: value.trim() ? value : undefined } })} />)}
    </RecordsGroup>
    <RecordsGroup title="Private-money and self-dealing records">
      <Choice label="Private-money scope" value={privateMoney.status} options={["Unreviewed", "Not applicable", "Applicable"]}
        change={status => change({ ...facts, privateMoney: status === "Applicable" ? { status, selfDealing: blankCheck(),
          investorQualifications: blankCheck(), investorSuitability: blankCheck() } : status === "Not applicable" ? { status, reference: "" } : { status } })} />
      {privateMoney.status === "Not applicable" && <Field label="Private-money scope reference" value={privateMoney.reference}
        limit={240} required change={reference => change({ ...facts, privateMoney: { ...privateMoney, reference } })} />}
      {privateMoney.status === "Applicable" && <>
        {drePrivateCheckKeys.map(key => <CheckFields key={key} label={drePrivateChecks[key]} value={privateMoney[key]}
          change={value => change({ ...facts, privateMoney: { ...privateMoney, [key]: value } })} />)}
        <Field label="Private-money retain-through date" value={privateMoney.retainThrough ?? ""} date
          change={value => change({ ...facts, privateMoney: { ...privateMoney, retainThrough: value || undefined } })} />
        <Field label="Four-year retention evidence" value={privateMoney.retentionEvidence ?? ""} multiline limit={240}
          change={value => change({ ...facts, privateMoney: { ...privateMoney, retentionEvidence: value.trim() ? value : undefined } })} />
      </>}
    </RecordsGroup>
  </div>;
}

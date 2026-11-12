"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { advertisingChannels, advertisingFacts, type AdvertisingFacts } from "@/lib/advertising-review-model";
import { easternDate } from "@/lib/client-retention";
import { Button } from "./ui/button";

const choices = ["Unresolved", "Yes", "No"] as const;
const stateResults = ["Supported", "Concern"] as const;
const federalResults = [...stateResults, "Outside scope"] as const;
const timeZones = { "America/Detroit": "Eastern", "America/Menominee": "Central" } as const;
const emptyOriginator: AdvertisingFacts["originators"][number] = { name: "", visibility: "Unresolved" };

function Select<T extends string>({ label, value, choices, change, labels }: {
  label: string; value: T; choices: readonly T[]; change: (value: T) => void; labels?: Partial<Record<string, string>>;
}) {
  return <label className="field">{label}
    <select value={value} onChange={event => change(event.target.value as T)}>
      {choices.map(option => <option value={option} key={option}>{labels?.[option] ?? option}</option>)}
    </select>
  </label>;
}

function Text({ label, value, change, max = 300, rows, readOnly, required, digits }: {
  label: string; value: string; change: (value: string) => void; max?: number; rows?: number;
  readOnly?: boolean; required?: boolean; digits?: boolean;
}) {
  const props = { value, maxLength: max, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    change(event.target.value), readOnly, required };
  return <label className="field">{label}
    {rows ? <textarea {...props} rows={rows} /> : <input {...props} inputMode={digits ? "numeric" : undefined} />}
  </label>;
}

function DateInput({ label, value, change, required }: {
  label: string; value: string; change: (value: string) => void; required?: boolean;
}) {
  return <label className="field">{label}<input type="date" min="1900-01-01" max="9990-12-31" value={value} required={required}
    onChange={event => change(event.target.value)} /></label>;
}

function Assessment<T extends string>({ label, value, choices, change }: {
  label: string; value?: { result: T; reference: string }; choices: readonly T[];
  change: (value: { result: T; reference: string } | undefined) => void;
}) {
  return <>
    <Select label={label} value={value?.result ?? ""} choices={["", ...choices]} labels={{ "": "Awaiting review" }}
      change={result => change(result ? { result, reference: value?.reference ?? "" } : undefined)} />
    {value && <Text label={`${label} reference`} value={value.reference} rows={2} required change={reference => change({ ...value, reference })} />}
  </>;
}

function EvidenceSection({ title, children }: { title: string; children: ReactNode }) {
  return <details className="min-w-0 border-t border-[var(--line)] py-2">
    <summary className="font-semibold">{title}</summary>
    <div className="record-form pt-2">{children}</div>
  </details>;
}

function blank(): AdvertisingFacts {
  return {
    title: "", channel: "Website", audience: "", creative: { kind: "Text", copy: "" },
    reviewedOn: easternDate(new Date()), zone: "America/Detroit", scopeReference: "",
    mortgageScope: "Unresolved", creditType: "Unresolved", specificTerms: "Unresolved",
    originatorAdvertising: "Unresolved", originators: [], archive: { applies: "Unresolved" },
  };
}

const issueLabels: Partial<Record<keyof AdvertisingFacts, string>> = {
  title: "Advertisement name", scopeReference: "Campaign scope reference", creative: "Creative copy or archive reference and SHA-256",
  reviewedOn: "Review date", originators: "Originator name, identifier and evidence", stateClaims: "Michigan claims review reference",
  stateTerms: "Michigan terms review reference", regulationZ: "Regulation Z review reference", regulationN: "Regulation N review reference",
  archive: "Archive references", distribution: "Distribution dates, order and reference", sponsoringCompanyDisplayed: "Displayed company NMLS ID",
};

export function AdvertisingReviewForm({ initial, entityName, busy, error, onSave, onCancel, onReload }: {
  initial?: AdvertisingFacts; entityName: string; busy: boolean; error: string;
  onSave: (facts: AdvertisingFacts, correction?: string) => void; onCancel: () => void; onReload?: () => void;
}) {
  const [facts, setFacts] = useState(() => initial ?? blank());
  const [correction, setCorrection] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (issues.length || error) feedback.current?.focus(); }, [issues, error]);
  function set<K extends keyof AdvertisingFacts>(key: K, value: AdvertisingFacts[K]) {
    setFacts(current => ({ ...current, [key]: value }));
  }
  const setArchive = (key: Exclude<keyof AdvertisingFacts["archive"], "applies">, value: string) => {
    setFacts(current => ({ ...current, archive: { ...current.archive, [key]: value || undefined } }));
  };
  function changeOriginator(index: number, next: AdvertisingFacts["originators"][number]) {
    set("originators", facts.originators.map((originator, position) => position === index ? next : originator));
  }
  const { creative, distribution } = facts;

  return <form className="record-form w-full max-w-2xl" noValidate onChange={() => { if (issues.length) setIssues([]); }} onSubmit={event => {
    event.preventDefault();
    if (busy) return;
    const parsed = advertisingFacts.safeParse(facts);
    const missingCorrection = !!initial && correction.trim().length < 4;
    if (!parsed.success || missingCorrection) {
      const fields = parsed.success ? [] : parsed.error.issues.map(issue => {
        const key = issue.path[0] as keyof AdvertisingFacts;
        return issue.code === "custom" && key !== "creative" && key !== "reviewedOn" ?
          issue.message : issueLabels[key] ?? "Audience";
      });
      setIssues([...new Set([...fields, ...(missingCorrection ? ["Correction reason"] : [])])]);
      return;
    }
    setIssues([]);
    onSave(parsed.data, initial ? correction.trim() : undefined);
  }}>
    <h2 ref={heading} tabIndex={-1}>{initial ? "Correct advertising evidence" : "Record an advertisement"}</h2>
    <p className="muted [overflow-wrap:anywhere]">{entityName} · Michigan</p>
    {(issues.length > 0 || error) && <div ref={feedback} role="alert" tabIndex={-1} className="record-form">
      {error && <p>{error}</p>}
      {!!issues.length && <><p>Check these fields and try again.</p><ul className="list-disc pl-5">
        {issues.map(issue => <li key={issue}>{issue}</li>)}</ul></>}
      {error.includes("record changed") && onReload && <div>
        <Button type="button" variant="outline" onClick={onReload}>Reload and discard draft</Button>
      </div>}
    </div>}
    <fieldset className="record-form min-w-0" disabled={busy}>
      <legend className="mb-2 font-semibold">Advertisement and scope</legend>
      <Text label="Advertisement name" value={facts.title} max={140} required change={value => set("title", value)} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Select label="Channel" value={facts.channel} choices={advertisingChannels} change={value => set("channel", value)} />
        <Select label="Mortgage scope" value={facts.mortgageScope} choices={["Unresolved", "First mortgage", "Secondary mortgage", "First and secondary"]}
          change={value => set("mortgageScope", value)} />
        <DateInput label="Review date" value={facts.reviewedOn} required change={value => {
          setFacts(current => ({ ...current, reviewedOn: value, distribution: current.distribution ?
            { ...current.distribution, sameDayOrder: current.distribution.firstOn === value ? current.distribution.sameDayOrder : undefined } : undefined }));
        }} />
        <Select label="Review time zone" value={facts.zone} choices={["America/Detroit", "America/Menominee"]} labels={timeZones}
          change={value => set("zone", value)} />
      </div>
      <Text label="Audience" value={facts.audience} rows={2} required change={value => set("audience", value)} />
      <Text label="Campaign scope reference" value={facts.scopeReference} rows={2} required change={value => set("scopeReference", value)} />
      {!initial && <Select label="Creative format" value={creative.kind} choices={["Text", "Archived artifact"]}
        change={kind => set("creative", kind === "Text" ? { kind, copy: "" } : { kind, reference: "", sha256: "" })} />}
      {creative.kind === "Text" ? <Text label="Exact advertising copy" value={creative.copy} rows={4} max={16000} required readOnly={!!initial}
        change={copy => set("creative", { ...creative, copy })} /> : <>
        <Text label="Archived creative reference" value={creative.reference} rows={2} required
          change={reference => set("creative", { ...creative, reference })} />
        <Text label="Archived creative SHA-256" value={creative.sha256} max={64} required readOnly={!!initial}
          change={sha256 => set("creative", { ...creative, sha256 })} />
      </>}
      <EvidenceSection title="Michigan claims and terms">
        <Assessment label="Michigan claims review" value={facts.stateClaims} choices={stateResults} change={value => set("stateClaims", value)} />
        <Select label="Advertises specific lending terms" value={facts.specificTerms} choices={choices} change={value => set("specificTerms", value)} />
        {facts.specificTerms === "Yes" && <Assessment label="Michigan terms review" value={facts.stateTerms} choices={stateResults}
          change={value => set("stateTerms", value)} />}
      </EvidenceSection>
      <EvidenceSection title="Originator identifiers">
        <Select label="Individual originator advertising" value={facts.originatorAdvertising} choices={choices}
          change={value => set("originatorAdvertising", value)} />
        {(facts.originatorAdvertising === "Yes" || facts.originators.length > 0) && <>
          {facts.originators.map((originator, index) => <fieldset key={index} className="record-form min-w-0 border-t border-[var(--line)] pt-2">
            <legend className="font-medium">Originator {index + 1}</legend>
            <Text label="Originator name" value={originator.name} max={100} required change={name => changeOriginator(index, { ...originator, name })} />
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Text label="Verified NMLS ID" value={originator.expected ?? ""} max={15} digits
                change={expected => changeOriginator(index, { ...originator, expected: expected || undefined })} />
              <Text label="Displayed NMLS ID" value={originator.displayed ?? ""} max={15} digits
                change={displayed => changeOriginator(index, { ...originator, displayed: displayed || undefined })} />
            </div>
            <Select label="Identifier visibility" value={originator.visibility} choices={["Unresolved", "Clear", "Unclear"]}
              change={visibility => changeOriginator(index, { ...originator, visibility })} />
            <Text label="Originator evidence reference" value={originator.reference ?? ""} rows={2}
              change={reference => changeOriginator(index, { ...originator, reference: reference || undefined })} />
            <div><Button variant="outline" type="button" aria-label={`Remove originator ${index + 1}`}
              onClick={() => set("originators", facts.originators.filter((_, position) => position !== index))}>Remove originator</Button></div>
          </fieldset>)}
          <div><Button type="button" variant="outline" disabled={facts.originators.length >= 20}
            onClick={() => set("originators", [...facts.originators, emptyOriginator])}>Add originator</Button></div>
          <Text label="Displayed company NMLS ID" value={facts.sponsoringCompanyDisplayed ?? ""} max={15} digits
            change={value => set("sponsoringCompanyDisplayed", value || undefined)} />
        </>}
      </EvidenceSection>
      <EvidenceSection title="Federal review and archive">
        <Select label="Credit type" value={facts.creditType} choices={["Unresolved", "Closed-end", "Open-end"]} change={value => set("creditType", value)} />
        <Assessment label="Regulation Z review" value={facts.regulationZ} choices={federalResults} change={value => set("regulationZ", value)} />
        <Assessment label="Regulation N review" value={facts.regulationN} choices={federalResults} change={value => set("regulationN", value)} />
        <Select label="Federal archive rule applies" value={facts.archive.applies} choices={choices}
          change={applies => set("archive", { ...facts.archive, applies })} />
        <Text label="Archive scope reference" value={facts.archive.scopeReference ?? ""} rows={2} change={value => setArchive("scopeReference", value)} />
        {facts.archive.applies === "Yes" && <>
          <Text label="Communications and materials reference" value={facts.archive.materials ?? ""} rows={2} change={value => setArchive("materials", value)} />
          <Text label="Available mortgage products reference" value={facts.archive.availableProducts ?? ""} rows={2} change={value => setArchive("availableProducts", value)} />
          <Text label="Additional products or services reference" value={facts.archive.additionalProducts ?? ""} rows={2} change={value => setArchive("additionalProducts", value)} />
        </>}
      </EvidenceSection>
      <EvidenceSection title="Distribution">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-4" checked={!!distribution}
            onChange={event => set("distribution", event.target.checked ? { firstOn: "", reference: "" } : undefined)} />
          Record distribution dates
        </label>
        {distribution && <>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <DateInput label="First use date" value={distribution.firstOn} required change={firstOn => set("distribution", {
              ...distribution, firstOn, sameDayOrder: firstOn === facts.reviewedOn ? distribution.sameDayOrder : undefined,
            })} />
            <DateInput label="Final use date, if ended" value={distribution.finalOn ?? ""}
              change={finalOn => set("distribution", { ...distribution, finalOn: finalOn || undefined })} />
          </div>
          {distribution.firstOn === facts.reviewedOn && <Select label="Same-day order" value={distribution.sameDayOrder ?? ""}
            choices={["", "Before review", "After review"]} labels={{ "": "Unresolved" }}
            change={sameDayOrder => set("distribution", { ...distribution, sameDayOrder: sameDayOrder || undefined })} />}
          <Text label="Distribution evidence reference" value={distribution.reference} rows={2} required
            change={reference => set("distribution", { ...distribution, reference })} />
        </>}
      </EvidenceSection>
      {initial && <Text label="Correction reason" value={correction} rows={2} required change={setCorrection} />}
    </fieldset>
    <div className="loan-application-actions">
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save advertising evidence"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>
  </form>;
}

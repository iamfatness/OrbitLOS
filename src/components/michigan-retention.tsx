"use client";

import { useEffect, useRef, useState } from "react";
import { accessLoanRetention } from "@/app/actions";
import type { MichiganBusinessRecords, MichiganRetentionResult } from "@/lib/michigan-retention";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Review = MichiganRetentionResult["versions"][number];
type Evidence = Review["evidence"];
type Category = Evidence["category"];
type Target = { kind: "loan" | "business"; id: string; label: string };
const loanCategories = ["Closed loan file", "Transferred copies", "Unsuccessful application"] as const;
const authorities = ["First mortgage", "Secondary mortgage"] as const;
const roles = ["Unresolved", "Broker only", "Lender"] as const;
const transferStatuses = ["Unknown", "No transfer", "Transferred"] as const;
const outcomes = ["Denied", "Withdrawn"] as const;
const stateSource = "https://www.michigan.gov/difs/news-and-outreach/faq/consumer-finance/mortgage-compliance2";

function SelectField<T extends string>({ label, options, value, change }: {
  label: string; options: readonly T[]; value: T; change: (value: T) => void;
}) {
  return <label className="field">{label}
    <select value={value} onChange={event => change(event.target.value as T)}>
      {options.map(option => <option key={option}>{option}</option>)}
    </select>
  </label>;
}

function DateField({ label, value, change, required = true }: {
  label: string; value: string; change: (value: string) => void; required?: boolean;
}) {
  return <label className="field">{label}
    <input type="date" min="1900-01-01" max="9990-12-31" value={value} required={required}
      onChange={event => change(event.target.value)} />
  </label>;
}

function emptyEvidence(category: Category): Evidence {
  const base = { authority: "First mortgage" as const, reference: "" };
  switch (category) {
    case "Closed loan file": return { ...base, category, closedOn: "", role: "Unresolved", transfer: { status: "Unknown" } };
    case "Transferred copies": return { ...base, category, closedOn: "", transferredOn: "" };
    case "Unsuccessful application": return { ...base, category, outcome: "Denied", retainThrough: null, counselReference: null };
    case "Other business records": return { ...base, category, createdOn: "", fiscalYearEnd: "" };
  }
}

function EvidenceFields({ draft, set }: { draft: Evidence; set: (next: Evidence) => void }) {
  switch (draft.category) {
    case "Closed loan file": return <>
      <DateField label="Closing date" value={draft.closedOn} change={closedOn => set({ ...draft, closedOn })} />
      <SelectField label="Brokerage role" options={roles} value={draft.role} change={role =>
        set({ ...draft, role, transfer: role === "Broker only" ? { status: "Unknown" } : draft.transfer })} />
      {draft.role !== "Broker only" && <SelectField label="Transfer or assignment" options={transferStatuses}
        value={draft.transfer.status} change={status => set({ ...draft, transfer: status === "Transferred" ? { status, date: "" } : { status } })} />}
      {draft.transfer.status === "Transferred" && <DateField label="Transfer or assignment date" value={draft.transfer.date}
        change={date => set({ ...draft, transfer: { status: "Transferred", date } })} />}
    </>;
    case "Transferred copies": return <>
      <DateField label="Closing date" value={draft.closedOn} change={closedOn => set({ ...draft, closedOn })} />
      <DateField label="Transfer or assignment date" value={draft.transferredOn} change={transferredOn => set({ ...draft, transferredOn })} />
    </>;
    case "Unsuccessful application": return <>
      <SelectField label="Application outcome" options={outcomes} value={draft.outcome} change={outcome => set({ ...draft, outcome })} />
      <DateField label="Counsel-reviewed retention date (optional)" value={draft.retainThrough ?? ""} required={!!draft.counselReference}
        change={retainThrough => set({ ...draft, retainThrough: retainThrough || null })} />
      <label className="field">Counsel reference (if a date is entered)
        <input minLength={4} maxLength={240} value={draft.counselReference ?? ""} required={!!draft.retainThrough}
          onChange={event => set({ ...draft, counselReference: event.target.value || null })} />
      </label>
    </>;
    case "Other business records": return <>
      <DateField label="Record creation date" value={draft.createdOn} change={createdOn => set({ ...draft, createdOn })} />
      <DateField label="Fiscal year-end for this record" value={draft.fiscalYearEnd} change={fiscalYearEnd => set({ ...draft, fiscalYearEnd })} />
    </>;
  }
}

function evidenceFacts(record: Evidence): [string, string][] {
  switch (record.category) {
    case "Closed loan file": return [
      ["Closing date", record.closedOn], ["Brokerage role", record.role],
      ...(record.role === "Broker only" ? [] : [["Transfer or assignment",
        record.transfer.status === "Transferred" ? record.transfer.date : record.transfer.status] as [string, string]]),
    ];
    case "Transferred copies": return [["Closing date", record.closedOn], ["Transfer or assignment date", record.transferredOn]];
    case "Unsuccessful application": return [
      ["Application outcome", record.outcome], ...(record.counselReference ? [["Counsel reference", record.counselReference] as [string, string]] : []),
    ];
    case "Other business records": return [["Record creation date", record.createdOn], ["Fiscal year-end", record.fiscalYearEnd]];
  }
}

function ReviewDetails({ review }: { review: Review }) {
  return <div className="record-form min-w-0 pt-2">
    <p><strong>{review.finding.date ? `Retention review date ${review.finding.date}` : "Retention date needs review"}</strong></p>
    <p>{review.finding.basis}</p>
    <p className="muted">{review.finding.authority} · {review.actor} · {dateTime(review.at)} ET</p>
    <dl className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
      {[["License scope", review.evidence.authority], ...evidenceFacts(review.evidence), ["Evidence reference", review.evidence.reference]]
        .map(([label, value]) => <div key={label} className="contents">
          <dt className="font-medium">{label}</dt><dd className="min-w-0 break-words">{value}</dd>
        </div>)}
    </dl>
  </div>;
}

function CategoryReview({ brokerageId, target, category }: { brokerageId: string; target: Target; category: Category }) {
  const [history, setHistory] = useState<MichiganRetentionResult>();
  const [draft, setDraft] = useState<Evidence>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadId, setLoadId] = useState(0);
  const latest = history?.versions[0];
  const receipt = useRef<HTMLParagraphElement>(null);
  const legend = useRef<HTMLLegendElement>(null);
  const request = useRef<{ fingerprint: string; id: string }>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const editing = !!draft;

  useEffect(() => { if (notice) receipt.current?.focus(); }, [notice]);
  useEffect(() => { if (editing) legend.current?.focus(); }, [editing]);

  useEffect(() => {
    let active = true;
    void accessLoanRetention({ type: "michiganRetentionHistory", target: { kind: target.kind, id: target.id }, category }, brokerageId)
      .then(result => {
        if (!active) return;
        if ("error" in result) setError(result.error);
        else if (result.kind === "michiganRetention") setHistory(result);
      }).catch(() => { if (active) setError("Could not load Michigan retention evidence. Reload to try again."); });
    return () => { active = false; };
  }, [brokerageId, category, target.kind, target.id, loadId]);

  function reload() {
    setError("");
    setNotice("");
    setHistory(undefined);
    setDraft(undefined);
    request.current = null;
    setLoadId(current => current + 1);
  }

  async function save() {
    if (busy || !history || !draft) return;
    const expected = latest?.version ?? 0;
    const fingerprint = JSON.stringify([expected, draft]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accessLoanRetention({ type: "saveMichiganRetentionReview",
        target: { kind: target.kind, id: target.id }, id: request.current.id, expected, evidence: draft }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "michiganRetention") {
        setHistory(result);
        setDraft(undefined);
        setNotice(`Michigan retention evidence saved. Current version ${result.versions[0].version}.`);
      }
    } catch {
      setError("Could not confirm the save. Try again with the same evidence.");
    } finally { setBusy(false); }
  }

  async function older() {
    if (busy || !history?.next) return;
    setBusy(true);
    setError("");
    try {
      const result = await accessLoanRetention({ type: "michiganRetentionHistory",
        target: { kind: target.kind, id: target.id }, category, before: history.next }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "michiganRetention") {
        setHistory({ ...result, versions: [...history.versions, ...result.versions] });
        if (!result.next) requestAnimationFrame(() => edit.current?.focus());
      }
    } catch { setError("Could not load older versions. Try again."); }
    finally { setBusy(false); }
  }

  const showReload = !draft || error.includes("review changed");
  return <div className="record-form min-w-0" aria-busy={busy}>
    {error && !draft && <p role="alert">{error}</p>}
    {notice && <p role="status" ref={receipt} tabIndex={-1}>{notice}</p>}
    {!history && !error && <p role="status">Loading Michigan retention evidence…</p>}
    {history?.held && <p><strong>Active loan hold</strong> · Keep the loan and checklist documents preserved.</p>}
    {latest ? <section className="record-form" aria-label="Current evidence">
      <h3>Current evidence · Version {latest.version}</h3>
      <ReviewDetails review={latest} />
    </section> : history && !draft && <p>No evidence recorded for this category.</p>}
    {!draft && <div className="loan-application-actions">
      {history && <Button ref={edit} type="button" disabled={busy} onClick={() => {
        setNotice("");
        setError("");
        setDraft(latest?.evidence ?? emptyEvidence(category));
      }}>{latest ? "Record correction" : "Record evidence"}</Button>}
      {showReload && <Button type="button" variant="outline" disabled={busy || (!history && !error)} onClick={reload}>Reload evidence</Button>}
    </div>}
    {draft && <form className="record-form w-full max-w-2xl" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="record-form min-w-0" disabled={busy}>
        <legend ref={legend} tabIndex={-1} className="mb-2 font-semibold">{latest ? "Correct evidence" : "Record evidence"}</legend>
        <SelectField label="Michigan license scope" options={authorities} value={draft.authority}
          change={authority => setDraft({ ...draft, authority })} />
        <EvidenceFields draft={draft} set={setDraft} />
        <label className="field">Evidence reference
          <textarea rows={2} minLength={4} maxLength={240} required value={draft.reference}
            onChange={event => setDraft({ ...draft, reference: event.target.value })} />
        </label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="loan-application-actions">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save Michigan retention evidence"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => {
          if (showReload) reload();
          else { setDraft(undefined); setError(""); }
          requestAnimationFrame(() => edit.current?.focus());
        }}>{showReload ? "Reload and discard draft" : "Cancel edit"}</Button>
      </div>
    </form>}
    {!!history && history.versions.length > 1 && <details>
      <summary>Previous versions</summary>
      <div className="record-form pt-2">
        {history.versions.slice(1).map(review => <details key={review.version} className="border-t border-[var(--line)] py-2">
          <summary>Version {review.version} · {dateTime(review.at)} ET</summary>
          <ReviewDetails review={review} />
        </details>)}
        {history.next && <div><Button type="button" variant="outline" disabled={busy} onClick={() => void older()}>Load older versions</Button></div>}
      </div>
    </details>}
  </div>;
}

export function MichiganRetention({ brokerageId, target, onBack }: { brokerageId: string; target: Target; onBack: () => void }) {
  const [category, setCategory] = useState<Category>(target.kind === "loan" ? "Closed loan file" : "Other business records");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <div className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2 ref={heading} tabIndex={-1}>Michigan retention evidence</h2>
      <Button type="button" variant="outline" onClick={onBack}>{target.kind === "loan" ? "Back to loan retention" : "Back to business records"}</Button>
    </div>
    <p className="break-words"><strong>{target.label}</strong></p>
    <p className="muted">Review applicable state and federal dates and holds before disposition. <a className="underline" href={stateSource}>Michigan DIFS guidance</a></p>
    {target.kind === "loan" && <div className="w-full max-w-2xl">
      <SelectField<Category> label="Record category" options={loanCategories} value={category} change={setCategory} />
    </div>}
    <CategoryReview key={category} brokerageId={brokerageId} target={target} category={category} />
  </div>;
}

export function MichiganBusinessRetention({ brokerageId, onBack }: { brokerageId: string; onBack: () => void }) {
  const [record, setRecord] = useState("");
  const [selected, setSelected] = useState("");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [records, setRecords] = useState<MichiganBusinessRecords>();
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (!selected) heading.current?.focus(); }, [selected]);

  useEffect(() => {
    if (selected) return;
    let active = true;
    void accessLoanRetention({ type: "michiganBusinessRecords", offset }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "michiganBusinessRecords") setRecords(result);
    }).catch(() => { if (active) setError("Could not load business records. Reload to try again."); });
    return () => { active = false; };
  }, [brokerageId, offset, reload, selected]);

  function load(next: number) {
    setRecords(undefined);
    setError("");
    setOffset(next);
    setReload(value => value + 1);
  }

  if (selected) return <MichiganRetention brokerageId={brokerageId}
    target={{ kind: "business", id: selected, label: selected }} onBack={() => {
      setSelected("");
      load(offset);
    }} />;

  return <div className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2 ref={heading} tabIndex={-1}>Michigan business records</h2>
      <Button type="button" variant="outline" onClick={onBack}>Back to loan retention</Button>
    </div>
    <form className="record-form w-full max-w-2xl" onSubmit={event => { event.preventDefault(); if (record.trim()) setSelected(record.trim()); }}>
      <label className="field">Business record name or reference
        <input required maxLength={200} value={record} onChange={event => setRecord(event.target.value)} />
      </label>
      <div><Button type="submit">Open business record</Button></div>
    </form>
    {error && <div className="record-form"><p role="alert">{error}</p>
      <div><Button type="button" variant="outline" onClick={() => load(offset)}>Reload business records</Button></div></div>}
    {!records && !error && <p role="status">Loading business records…</p>}
    {records && <section className="record-form" aria-label="Saved business records">
      <h3>Saved business records</h3>
      {records.records.length ? <ul className="loan-task-list">
        {records.records.map(name => <li key={name} className="document-item">
          <Button type="button" variant="outline" className="max-w-full whitespace-normal text-left [overflow-wrap:anywhere]"
            onClick={() => setSelected(name)}>{name}</Button>
        </li>)}
      </ul> : <p>No business records have been saved.</p>}
      {(offset > 0 || records.next !== null) && <div className="loan-application-actions">
        <Button type="button" variant="outline" disabled={!offset} onClick={() => load(Math.max(0, offset - 15))}>Previous records</Button>
        <Button type="button" variant="outline" disabled={records.next === null} onClick={() => load(records.next ?? 0)}>Next records</Button>
      </div>}
    </section>}
  </div>;
}

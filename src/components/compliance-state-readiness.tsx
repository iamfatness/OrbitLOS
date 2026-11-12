"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { stateControlStatuses, stateCounselDecisions, stateReadinessFacts } from "@/lib/compliance-state-readiness-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type Readiness = Extract<ComplianceCaseResult, { kind: "stateReadiness" }>;

export function ComplianceStateReadiness({ brokerageId, entityId, jurisdiction, scopeRevision, paused }: {
  brokerageId: string; entityId: string; jurisdiction: string; scopeRevision: number; paused: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Readiness>();
  const [sourceKey, setSourceKey] = useState("");
  const [filter, setFilter] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const retry = useRef<{ body: string; id: string } | undefined>(undefined);
  const feedback = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!open || paused) return;
    let current = true;
    void accessComplianceCases({ type: "stateReadiness", input: { operation: "read", entityId, jurisdiction, scopeRevision,
      ...(sourceKey ? { sourceKey } : {}) } }, brokerageId).then(result => {
      if (!current) return;
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "stateReadiness") throw new Error("Could not load the requirement evidence.");
      setData(result);
    }).catch(error => {
      if (current) setError(error instanceof Error && !(error instanceof TypeError) ? error.message : "Could not load the requirement evidence.");
    });
    return () => { current = false; };
  }, [brokerageId, entityId, jurisdiction, open, paused, refresh, scopeRevision, sourceKey]);
  useEffect(() => { if (error || notice) feedback.current?.focus(); }, [error, notice]);

  const items = data?.items ?? [];
  const counselOpen = (item: Readiness["items"][number]) => !item.recorded || item.recorded.facts.counsel === "Pending counsel";
  const controlOpen = (item: Readiness["items"][number]) => !item.recorded ||
    (item.recorded.facts.control === "Open" && item.recorded.facts.counsel !== "Counsel advised out of scope");
  const choices = items.filter(item => filter === "all" || (filter === "counsel" ? counselOpen(item) : controlOpen(item)));
  const selected = items.find(item => item.key === sourceKey);
  const facts = selected?.recorded?.facts;
  function select(key: string) {
    setError("");
    setNotice("");
    setSourceKey(key);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || data?.readOnly || busy || paused) return;
    const parsed = stateReadinessFacts.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(" ")); return; }
    const input = { operation: "save", entityId, jurisdiction, scopeRevision, sourceKey,
      expectedRevision: selected.recorded?.revision ?? 0, facts: parsed.data };
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accessComplianceCases({ type: "stateReadiness", input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "stateReadinessSaved") throw new Error("Save could not be confirmed. Retry the same evidence.");
      retry.current = undefined;
      setNotice(`Requirement evidence version ${result.revision} recorded.`);
      setRefresh(value => value + 1);
    } catch (error) {
      setError(error instanceof Error && !(error instanceof TypeError) ? error.message : "Save could not be confirmed. Retry the same evidence.");
    } finally { setBusy(false); }
  }

  return <details className="details-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 content-center">Requirement evidence and counsel review</summary>
    {open && <div className="record-form">
      <p className="muted">Scope version {scopeRevision}. Record references to decisions, tests and procedures. Keep privileged advice and borrower details out of notes.</p>
      {(error || notice) && <p ref={feedback} tabIndex={-1} role={error ? "alert" : "status"}>{error || notice}</p>}
      {!data && !error && <p role="status">{paused ? "Requirement evidence is unavailable while the workspace is paused." : "Loading requirement evidence…"}</p>}
      {data?.readOnly && <p role="status">This scope is historical or its basis has changed. Save a current scope to record evidence for it.</p>}
      {data && <>
        <p>{items.filter(counselOpen).length} pending counsel · {items.filter(controlOpen).length} open controls · {items.length} specific requirements</p>
        <label className="field">Review filter<select value={filter} disabled={busy} onChange={event => { setFilter(event.target.value); select(""); }}>
          <option value="all">All requirements</option><option value="counsel">Pending counsel</option><option value="control">Open controls</option>
        </select></label>
        <label className="field">Specific requirement<select value={sourceKey} disabled={busy || !choices.length} onChange={event => select(event.target.value)}>
          <option value="">Choose a requirement</option>
          {sourceKey && selected && !choices.some(item => item.key === sourceKey) && <option value={sourceKey}>{selected.title}</option>}
          {choices.map(item => <option value={item.key} key={item.key}>{item.title}</option>)}
        </select></label>
        {!choices.length && <p>No specific requirements match this filter.</p>}
      </>}
      <div className="loan-application-actions">
        <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy || paused} onClick={() => {
          setData(undefined); setError(""); setNotice(""); setRefresh(value => value + 1);
        }}>Refresh requirement evidence</Button>
        {data && <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => {
          downloadSampleFile(JSON.stringify({ entityId, jurisdiction, scopeRevision, historical: data.historical, scopeChanged: data.scopeChanged,
            licenseBasisMissing: data.licenseBasisMissing, legalApproval: data.legalApproval, requirements: items }, null, 2),
          `orbit-${jurisdiction}-scope-v${scopeRevision}-requirements.json`, "application/json");
        }}>Download requirement evidence</Button>}
      </div>
      {selected && <section className="record-form" aria-label="Selected requirement evidence">
        <h3>{selected.title}</h3>
        <p>{selected.evidenceNeeded}</p>
        {selected.counselQuestion && <p>{selected.counselQuestion}</p>}
        <p><a className="underline" href={selected.sourceUrl} target="_blank" rel="noreferrer">Authority saved with this scope</a></p>
        {data?.readOnly ? <p>{facts?.counsel ?? "Pending counsel"} · {facts?.control ?? "Open"}</p> :
          <form className="record-form" key={`${selected.key}:${selected.recorded?.revision ?? 0}`} onSubmit={save}>
            <fieldset className="record-form" disabled={busy || paused}>
              <div className="form-grid items-start">
                <label className="field">Counsel disposition<select name="counsel" defaultValue={facts?.counsel ?? "Pending counsel"}>
                  {stateCounselDecisions.map(value => <option key={value}>{value}</option>)}</select></label>
                <label className="field">Control status<select name="control" defaultValue={facts?.control ?? "Open"}>
                  {stateControlStatuses.map(value => <option key={value}>{value}</option>)}</select></label>
              </div>
              <label className="field">Counsel decision reference<textarea name="counselEvidence" rows={2} maxLength={1000} defaultValue={facts?.counselEvidence} /></label>
              <label className="field">Test or rehearsal evidence reference<textarea name="controlEvidence" rows={2} maxLength={1000} defaultValue={facts?.controlEvidence} /></label>
              <label className="field">Next action<textarea name="nextAction" rows={2} maxLength={1000} defaultValue={facts?.nextAction} /></label>
              <div><Button size="sm" type="submit" className="min-h-11">{busy ? "Recording…" : "Record requirement evidence"}</Button></div>
            </fieldset>
          </form>}
        {data?.historySourceKey === sourceKey && data.history.length > 0 && <details className="details-section">
          <summary className="min-h-11 content-center">Requirement evidence history</summary>
          <ul className="document-list">{data.history.map(entry => <li className="document-item" key={entry.revision}>
            <div className="min-w-0 break-words"><strong>Version {entry.revision} · {entry.savedAt.slice(0, 10)}</strong>
              <p>{entry.facts.counsel} · {entry.facts.control}</p>
              {entry.facts.counselEvidence && <p>Counsel evidence · {entry.facts.counselEvidence}</p>}
              {entry.facts.controlEvidence && <p>Control evidence · {entry.facts.controlEvidence}</p>}
              {entry.facts.nextAction && <p>Next action · {entry.facts.nextAction}</p>}
              <p className="muted">Recorded by {entry.actor}</p></div>
          </li>)}</ul>
          {data.moreHistory && <p>Showing the latest 20 revisions.</p>}
        </details>}
      </section>}
    </div>}
  </details>;
}

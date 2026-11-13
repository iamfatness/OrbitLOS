"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { stateControlStatuses, stateCounselDecisions, stateReadinessFacts, type StateReadinessFacts } from "@/lib/compliance-state-readiness-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type Readiness = Extract<ComplianceCaseResult, { kind: "stateReadiness" }>;
const emptyFacts: StateReadinessFacts = { counsel: "Pending counsel", control: "Open", counselEvidence: "", controlEvidence: "", nextAction: "" };
const notes = [
  ["counselEvidence", "Counsel decision reference"],
  ["controlEvidence", "Test or rehearsal evidence reference"],
  ["nextAction", "Next action"],
] as const;
const fields = [["counsel", "Counsel disposition"], ["control", "Control status"], ...notes] as const;

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
  const [readKey, setReadKey] = useState("");
  const [draft, setDraft] = useState<{ revision: number; base: StateReadinessFacts; facts: StateReadinessFacts }>();
  const requestedRead = JSON.stringify([sourceKey, refresh]);
  const reading = readKey !== requestedRead;
  const saveButton = useRef<HTMLButtonElement>(null);
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
      setReadKey(requestedRead);
    }).catch(error => {
      if (current) setError(error instanceof Error && !(error instanceof TypeError) ? error.message : "Could not load the requirement evidence.");
    });
    return () => { current = false; };
  }, [brokerageId, entityId, jurisdiction, open, paused, requestedRead, scopeRevision, sourceKey]);
  useEffect(() => { if (error || notice) feedback.current?.focus(); }, [error, notice]);

  const items = data?.items ?? [];
  const counselOpen = (item: Readiness["items"][number]) => !item.recorded || item.recorded.facts.counsel === "Pending counsel";
  const controlOpen = (item: Readiness["items"][number]) => !item.recorded ||
    (item.recorded.facts.control === "Open" && item.recorded.facts.counsel !== "Counsel advised out of scope");
  const choices = items.filter(item => filter === "all" || (filter === "counsel" ? counselOpen(item) : controlOpen(item)));
  const selected = items.find(item => item.key === sourceKey);
  const savedFacts = selected?.recorded?.facts ?? emptyFacts;
  const savedRevision = selected?.recorded?.revision ?? 0;
  const facts = draft?.facts ?? savedFacts;
  const conflicting = draft && draft.revision !== savedRevision;
  const differences = conflicting ? fields.filter(([key]) => draft.base[key] !== savedFacts[key] && facts[key] !== savedFacts[key]) : [];

  function update<K extends keyof StateReadinessFacts>(key: K, value: StateReadinessFacts[K]) {
    setDraft({ revision: draft?.revision ?? savedRevision, base: draft?.base ?? savedFacts, facts: { ...facts, [key]: value } });
  }

  function resolveConflict(keepDraft: boolean) {
    if (!draft) return;
    const merged = Object.fromEntries(fields.map(([key]) =>
      [key, facts[key] === draft.base[key] ? savedFacts[key] : facts[key]])) as StateReadinessFacts;
    setDraft(keepDraft ? { revision: savedRevision, base: savedFacts, facts: merged } : undefined);
    setError("");
    setNotice("");
    requestAnimationFrame(() => saveButton.current?.focus());
  }
  function select(key: string) {
    setError("");
    setNotice("");
    setSourceKey(key);
    setDraft(undefined);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || data?.readOnly || busy || paused || reading || conflicting) return;
    const parsed = stateReadinessFacts.safeParse(facts);
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(" ")); return; }
    const input = { operation: "save", entityId, jurisdiction, scopeRevision, sourceKey,
      expectedRevision: savedRevision, facts: parsed.data };
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
      setDraft(undefined);
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
      {data?.readOnly && <p role="status">{data.historical ? "This scope is historical." :
        data.licenseBasisMissing ? "This scope predates the saved license basis. Save a current scope to record evidence." :
          "The license, entity or research basis changed. Save a current scope to record evidence."}</p>}
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
          setError(""); setNotice(""); setRefresh(value => value + 1);
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
        {selected.recorded?.carriedFromScope && <p className="muted">
          Counsel decision carried forward from scope version {selected.recorded.carriedFromScope}. Review control evidence for this version.
        </p>}
        {data?.readOnly ? <p>{savedFacts.counsel} · {savedFacts.control}</p> :
          <form className="record-form" onSubmit={save}>
            {conflicting && <div className="document-item record-form" role="status">
              <p>A newer version was recorded. {differences.length ? `Review changes to ${differences.map(([, label]) => label.toLowerCase()).join(", ")}.` : "You can keep your edits and use the saved values for the other fields."}</p>
              <div className="loan-application-actions">
                <Button size="sm" type="button" variant="outline" className="min-h-11" disabled={busy || paused || reading} onClick={() => resolveConflict(false)}>Use saved evidence</Button>
                <Button size="sm" type="button" variant="outline" className="min-h-11" disabled={busy || paused || reading} onClick={() => resolveConflict(true)}>Keep my edits</Button>
              </div>
            </div>}
            <fieldset className="record-form" disabled={busy || paused || reading}>
              <div className="form-grid items-start">
                <label className="field">Counsel disposition<select value={facts.counsel}
                  onChange={event => update("counsel", event.target.value as StateReadinessFacts["counsel"])}>
                  {stateCounselDecisions.map(value => <option key={value}>{value}</option>)}</select></label>
                <label className="field">Control status<select value={facts.control}
                  onChange={event => update("control", event.target.value as StateReadinessFacts["control"])}>
                  {stateControlStatuses.map(value => <option key={value}>{value}</option>)}</select></label>
              </div>
              {notes.map(([key, label]) => <label className="field" key={key}>{label}
                <textarea rows={2} maxLength={1000} value={facts[key]} onChange={event => update(key, event.target.value)} />
              </label>)}
              <div><Button ref={saveButton} size="sm" type="submit" className="min-h-11" disabled={reading || !!conflicting}>
                {busy ? "Recording…" : "Record requirement evidence"}</Button></div>
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
              {entry.carriedFromScope && <p>From scope version {entry.carriedFromScope} · Evidence version {entry.carriedFromRevision}</p>}
              <p className="muted">Recorded by {entry.actor}</p></div>
          </li>)}</ul>
          {data.moreHistory && <p>Showing the latest 20 revisions.</p>}
        </details>}
      </section>}
    </div>}
  </details>;
}

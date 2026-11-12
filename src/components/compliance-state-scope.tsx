"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { stateScopeFacts } from "@/lib/compliance-state-scope-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type Scope = Extract<ComplianceCaseResult, { kind: "stateScope" }>;
type Entity = Extract<ComplianceCaseResult, { kind: "programEntities" }>["entities"][number];
const fields = [
  ["companyEvidence", "Company license or registration evidence"],
  ["officeEvidence", "Office and branch authority evidence"],
  ["originatorEvidence", "Originator licenses and sponsorship evidence"],
  ["products", "Products and activities in scope"],
  ["responsibility", "Broker and lender responsibilities"],
  ["reportingBasis", "Proposed reporting period and fiscal year-end"],
  ["counselPacketReference", "Counsel packet reference"],
] as const;

export function ComplianceStateScope({ brokerageId, jurisdiction, paused }: {
  brokerageId: string; jurisdiction: string; paused: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [entities, setEntities] = useState<readonly Entity[]>();
  const [entityId, setEntity] = useState("");
  const [version, setVersion] = useState<number>();
  const [data, setData] = useState<Scope>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const feedback = useRef<HTMLParagraphElement>(null);
  const retry = useRef<{ body: string; id: string } | null>(null);

  useEffect(() => {
    if (!open || paused) return;
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "programEntities") throw new Error("Could not load entities. Try again.");
      setEntities(result.entities);
    }).catch(() => { if (active) setError("Could not load entities. Refresh to try again."); });
    return () => { active = false; };
  }, [brokerageId, open, paused, refresh]);

  useEffect(() => {
    if (!open || paused || !entityId) return;
    let active = true;
    void accessComplianceCases({ type: "stateScope", input: { operation: "read", entityId, jurisdiction, revision: version } }, brokerageId)
      .then(result => {
        if (!active) return;
        if ("error" in result) throw new Error(result.error);
        if (result.kind !== "stateScope") throw new Error("Could not load this scope. Refresh to try again.");
        setData(result);
      }).catch(error => { if (active) setError(error instanceof Error ? error.message : "Could not load the scope."); });
    return () => { active = false; };
  }, [brokerageId, entityId, jurisdiction, open, paused, refresh, version]);

  useEffect(() => { if (error || notice) feedback.current?.focus(); }, [error, notice]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy || paused || version !== undefined) return;
    const form = new FormData(event.currentTarget);
    const parsed = stateScopeFacts.safeParse(Object.fromEntries(form.entries()));
    if (!parsed.success) {
      setError("Review the scope fields and keep each note within 1,000 characters.");
      return;
    }
    const input = { operation: "save", entityId, jurisdiction, expectedRevision: data.revision, facts: parsed.data };
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accessComplianceCases({ type: "stateScope", input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "stateScope") throw new Error("Save could not be confirmed. Retry the unchanged scope.");
      setData(result);
      retry.current = null;
      setNotice(`Scope version ${result.revision} recorded for review.`);
    } catch (error) {
      setError(error instanceof Error && !(error instanceof TypeError) ? error.message : "Save could not be confirmed. Retry the unchanged scope.");
    } finally { setBusy(false); }
  }

  const current = data && (version === undefined ? data.revision === data.latestRevision : data.revision === version) ? data : undefined;
  const basis = current?.savedBasis;
  return <details className="document-form" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Brokerage scope for counsel review</summary>
    {open && <div className="record-form">
      <p>Use evidence references and describe unresolved scope. Keep borrower data and privileged advice out of the record. Counsel approval remains pending.</p>
      <label className="field">Legal entity<select value={entityId} disabled={busy || paused} onChange={event => {
        setEntity(event.target.value); setVersion(undefined); setData(undefined); setError(""); setNotice("");
      }}><option value="">Choose a legal entity</option>{entities?.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
      {!entities && !error && <p role="status">Loading entities…</p>}
      {entities?.length === 0 && <p>Add a legal entity in Monthly review first.</p>}
      {(error || notice) && <p ref={feedback} tabIndex={-1} role={error ? "alert" : "status"}>{error || notice}</p>}
      <div><Button type="button" variant="outline" size="sm" disabled={busy || paused} onClick={() => {
        setError(""); setNotice(""); setRefresh(value => value + 1);
      }}>Refresh scope</Button></div>
      {entityId && !current && !error && <p role="status">Loading scope…</p>}
      {data && <>
        {data.history.length > 0 && <label className="field">Scope version<select value={version ?? ""} disabled={busy} onChange={event => {
          setVersion(event.target.value ? Number(event.target.value) : undefined); setError(""); setNotice("");
        }}><option value="">Latest version</option>{data.history.map(item =>
          <option key={item.revision} value={item.revision}>Version {item.revision} · {item.savedAt.slice(0, 10)}</option>)}</select></label>}
      </>}
      {current && <>
        {current.sourceChanged && <p>Research sources changed since this version was recorded.</p>}
        {current.entityChanged && <p>Entity details changed since this version was recorded.</p>}
        {basis && <div><Button type="button" size="sm" variant="outline" onClick={() => {
          downloadSampleFile(JSON.stringify({
            jurisdiction, version: current.revision, entity: JSON.parse(basis.entity), facts: current.facts,
            recorded: current.history.find(item => item.revision === current.revision),
            authorities: (JSON.parse(basis.sources) as string[]).map(source => JSON.parse(source)),
            legalApproval: current.legalApproval,
          }, null, 2), `orbit-${jurisdiction}-scope-v${current.revision}.json`, "application/json");
        }}>Download scope version</Button></div>}
        {version === undefined ? <form key={`${entityId}:${current.revision}`} onSubmit={save} className="record-form">
          <fieldset disabled={busy || paused} className="record-form">
            <div className="form-grid">
              <label className="field">Activity<select name="activity" defaultValue={current.facts?.activity ?? "Multiple or unresolved"}>
                {stateScopeFacts.shape.activity.options.map(item => <option key={item}>{item}</option>)}</select></label>
              <label className="field">Lien scope<select name="lienScope" defaultValue={current.facts?.lienScope ?? "Unresolved"}>
                {stateScopeFacts.shape.lienScope.options.map(item => <option key={item}>{item}</option>)}</select></label>
            </div>
            {fields.map(([name, label]) => <label className="field" key={name}>{label}
              <textarea name={name} maxLength={1000} rows={2} defaultValue={current.facts?.[name]} /></label>)}
            <div><Button type="submit" size="sm">{busy ? "Recording…" : "Save scope version"}</Button></div>
          </fieldset>
        </form> : <dl>
          <dt>Activity</dt><dd>{current.facts?.activity}</dd><dt>Lien scope</dt><dd>{current.facts?.lienScope}</dd>
          {fields.map(([name, label]) => <div key={name}><dt>{label}</dt><dd>{current.facts?.[name] || "Not recorded"}</dd></div>)}
        </dl>}
      </>}
    </div>}
  </details>;
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { stateScopeFacts, type StateScopeFacts } from "@/lib/compliance-state-scope-model";
import { LicenseRecordStatus } from "./license-record-status";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";
import { ComplianceStateReadiness } from "./compliance-state-readiness";

type Scope = Extract<ComplianceCaseResult, { kind: "stateScope" }>;
type Entity = Extract<ComplianceCaseResult, { kind: "programEntities" }>["entities"][number];
const fields = [
  ["companyEvidence", "Company license or registration evidence"],
  ["officeEvidence", "Office and branch authority evidence"],
  ["originatorEvidence", "Originator licenses and sponsorship evidence"],
  ["products", "Products and activities in scope"],
  ["responsibility", "Broker and lender responsibilities"],
  ["reportingBasis", "Reporting period and fiscal year-end"],
  ["counselPacketReference", "Counsel packet reference"],
] as const;
const scopeLabels = [["activity", "Activity"], ["lienScope", "Lien scope"], ...fields] as const;
const emptyFacts: StateScopeFacts = {
  activity: "Multiple or unresolved", lienScope: "Unresolved", companyEvidence: "", officeEvidence: "", originatorEvidence: "",
  products: "", responsibility: "", reportingBasis: "", counselPacketReference: "",
};

function ScopeFacts({ facts, labels = scopeLabels }: {
  facts: StateScopeFacts; labels?: ReadonlyArray<readonly [keyof StateScopeFacts, string]>;
}) {
  return <dl className="state-scope-facts">{labels.map(([name, label]) =>
    <div key={name}><dt>{label}</dt><dd>{facts[name] || "Not recorded"}</dd></div>)}</dl>;
}

export function ComplianceStateScope({ brokerageId, jurisdiction, paused }: {
  brokerageId: string; jurisdiction: string; paused: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [entities, setEntities] = useState<readonly Entity[]>();
  const [entityId, setEntity] = useState("");
  const [version, setVersion] = useState<number>();
  const [data, setData] = useState<Scope>();
  const [draft, setDraft] = useState<{ revision: number; base: StateScopeFacts; facts: StateScopeFacts }>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const feedback = useRef<HTMLParagraphElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const retry = useRef<{ body: string; id: string } | null>(null);

  useEffect(() => {
    if (!open || paused) return;
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result || result.kind !== "programEntities") throw new Error("Could not load legal entities.");
      setEntities(result.entities);
      if (result.entities.length === 1) setEntity(selected => selected || result.entities[0].id);
    }).catch(() => { if (active) setError("Could not load legal entities. Refresh scope to try again."); });
    return () => { active = false; };
  }, [brokerageId, open, paused, refresh]);

  useEffect(() => {
    if (!open || paused || !entityId) return;
    let active = true;
    void accessComplianceCases({ type: "stateScope", input: { operation: "read", entityId, jurisdiction, revision: version } }, brokerageId)
      .then(result => {
        if (!active) return;
        if ("error" in result || result.kind !== "stateScope") throw new Error("Could not load the scope.");
        setData(result);
      }).catch(() => { if (active) setError("Could not load the scope. Refresh scope to try again."); });
    return () => { active = false; };
  }, [brokerageId, entityId, jurisdiction, open, paused, refresh, version]);

  useEffect(() => { if (error || notice) feedback.current?.focus(); }, [error, notice]);

  const current = data?.entityId === entityId && (version === undefined ? data.revision === data.latestRevision : data.revision === version)
    ? data : undefined;
  const selectedEntity = entities?.find(entity => entity.id === entityId);
  const basis = current?.savedBasis;
  const savedFacts = current?.facts ?? emptyFacts;
  const facts = draft?.facts ?? savedFacts;
  const conflicting = draft && current && draft.revision !== current.revision;
  const differences = conflicting ? scopeLabels.filter(([key]) => draft.base[key] !== savedFacts[key] && facts[key] !== savedFacts[key]) : [];
  const missingEvidence = [facts.companyEvidence, facts.officeEvidence, facts.originatorEvidence].filter(value => !value.trim()).length;

  function update<K extends keyof StateScopeFacts>(key: K, value: StateScopeFacts[K]) {
    if (current) setDraft({ revision: draft?.revision ?? current.revision, base: draft?.base ?? savedFacts, facts: { ...facts, [key]: value } });
  }

  function resolveConflict(keepDraft: boolean) {
    if (!current || !draft) return;
    const merged = Object.fromEntries(scopeLabels.map(([key]) =>
      [key, facts[key] === draft.base[key] ? savedFacts[key] : facts[key]])) as StateScopeFacts;
    setDraft(keepDraft ? { revision: current.revision, base: savedFacts, facts: merged } : undefined);
    setError("");
    setNotice("");
    requestAnimationFrame(() => saveButton.current?.focus());
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || busy || paused || conflicting || version !== undefined) return;
    const parsed = stateScopeFacts.safeParse(facts);
    if (!parsed.success) {
      setError("Review the scope fields and keep each note within 1,000 characters.");
      return;
    }
    const input = { operation: "save", entityId, jurisdiction, expectedRevision: current.revision, facts: parsed.data };
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accessComplianceCases({ type: "stateScope", input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) { setError(result.error); return; }
      if (result.kind !== "stateScope") throw new Error("Save could not be confirmed.");
      setData(result);
      if (result.revision !== result.latestRevision) setVersion(result.revision);
      setDraft(undefined);
      retry.current = null;
      setNotice(`Scope version ${result.revision} saved for counsel review.`);
    } catch {
      setError("Save could not be confirmed. Retry the same scope or refresh to check the outcome.");
    } finally { setBusy(false); }
  }

  return <details className="document-form compliance-state-scope" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Brokerage scope for counsel review</summary>
    {open && <div className="record-form state-scope-body">
      <div className="loan-application-actions licensing-controls state-scope-controls">
        <label className="field">Legal entity<select value={entityId} disabled={busy || paused || !entities} onChange={event => {
          setEntity(event.target.value); setVersion(undefined); setData(undefined); setDraft(undefined); setError(""); setNotice("");
        }}><option value="">Choose a legal entity</option>{entities?.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
        <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy || paused} onClick={() => {
          setError(""); setNotice(""); setRefresh(value => value + 1);
        }}>Refresh scope</Button>
      </div>
      {selectedEntity && <p className="state-scope-entity-name">{selectedEntity.name}</p>}
      {!entities && !error && <p role="status">{paused ? "Scope is unavailable while the workspace is paused." : "Loading legal entities…"}</p>}
      {entities?.length === 0 && <p>Add a legal entity in Compliance → Licensing to record its scope.</p>}
      {(error || notice) && <p ref={feedback} tabIndex={-1} role={error ? "alert" : "status"}>{error || notice}</p>}
      {entityId && !current && !error && !paused && <p role="status">Loading scope…</p>}
      {!!data?.history.length && <label className="field">Scope version<select value={version ?? ""} disabled={busy || paused} onChange={event => {
        setVersion(event.target.value ? Number(event.target.value) : undefined); setError(""); setNotice("");
      }}><option value="">Latest version · {data.latestRevision}</option>{data.history.map(item =>
        <option key={item.revision} value={item.revision}>Version {item.revision} · {item.savedAt.slice(0, 10)}</option>)}</select></label>}
      {current && <>
        <p className="muted">{current.revision ? `Version ${current.revision} · Pending counsel review` : "No scope saved for this entity and state."}</p>
        {current.sourceChanged && <p role="status">Research sources changed since this version was recorded.</p>}
        {current.entityChanged && <p role="status">Entity details changed since this version was recorded.</p>}
        {current.licensesChanged && <p role="status">License records changed since this version was recorded.</p>}
        {basis && <div><Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => {
          downloadSampleFile(JSON.stringify({
            jurisdiction, version: current.revision, entity: JSON.parse(basis.entity), facts: current.facts,
            recorded: current.history.find(item => item.revision === current.revision),
            authorities: (JSON.parse(basis.sources) as string[]).map(source => JSON.parse(source)),
            licenses: basis.licenses === null ? null : JSON.parse(basis.licenses),
            legalApproval: current.legalApproval,
          }, null, 2), `orbit-${jurisdiction}-scope-v${current.revision}.json`, "application/json");
        }}>Download scope version</Button></div>}
        {current.revision > 0 && <ComplianceStateReadiness key={`${entityId}:${current.revision}`}
          brokerageId={brokerageId} entityId={entityId} jurisdiction={jurisdiction} scopeRevision={current.revision} paused={paused} />}
        {version === undefined ? <>
          <section className="state-scope-register record-form" aria-label="License records on file">
            <h3>License records on file</h3>
            <ul>{current.licenseSummary.map(({ holder, counts }) =>
              <li key={holder}><strong>{holder}</strong><span><LicenseRecordStatus counts={counts} /></span></li>)}</ul>
          </section>
          {conflicting && <section className="document-item record-form" aria-label="Newer version saved">
            <p role="status">Version {current.revision} was saved while you were editing. Review the saved values before continuing.</p>
            {differences.length > 0 && <ScopeFacts facts={savedFacts} labels={differences} />}
            <div className="loan-application-actions">
              <Button size="sm" variant="outline" className="min-h-11" onClick={() => resolveConflict(false)}>Use saved version</Button>
              <Button size="sm" variant="outline" className="min-h-11" onClick={() => resolveConflict(true)}>Keep my edits</Button>
            </div>
          </section>}
          <form onSubmit={save} className="record-form">
            <fieldset disabled={busy || paused} className="record-form">
              <div className="form-grid">
                <label className="field">Activity<select name="activity" value={facts.activity}
                  onChange={event => update("activity", stateScopeFacts.shape.activity.parse(event.target.value))}>
                  {stateScopeFacts.shape.activity.options.map(item => <option key={item}>{item}</option>)}</select></label>
                <label className="field">Lien scope<select name="lienScope" value={facts.lienScope}
                  onChange={event => update("lienScope", stateScopeFacts.shape.lienScope.parse(event.target.value))}>
                  {stateScopeFacts.shape.lienScope.options.map(item => <option key={item}>{item}</option>)}</select></label>
              </div>
              <p className="muted">{missingEvidence ? `${missingEvidence} of 3 license evidence references missing.` : "Company, office and originator evidence references entered."} Use evidence references. Keep borrower details and privileged advice out of the scope.</p>
              <div className="form-grid state-scope-fields">
                {fields.map(([name, label]) => <label className="field" key={name}>{label}
                  <textarea name={name} maxLength={1000} rows={2} value={facts[name]} onChange={event => update(name, event.target.value)} /></label>)}
              </div>
              <div><Button ref={saveButton} type="submit" size="sm" className="min-h-11" disabled={!!conflicting}>{busy ? "Saving…" : "Save scope version"}</Button></div>
            </fieldset>
          </form>
        </> : current.facts && <ScopeFacts facts={current.facts} />}
      </>}
    </div>}
  </details>;
}

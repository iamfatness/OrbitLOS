"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import { licenseFields, licenseHolder, licenseHolderKinds, licenseJurisdictions, licenseRenewalLookahead, licenseStatuses,
  type LicenseHolder, type LicenseRenewalTarget, type ProgramEntity, type ProgramLicense, type ProgramLicenses, type ProgramRequest } from "@/lib/compliance-program-model";
import { researchSources } from "@/lib/compliance-research-model";
import { Button } from "./ui/button";

const stateNames = new Map(researchSources.map(source => [source.jurisdiction, source.title]));
const stateName = (code: string) => code === "DC" ? "District of Columbia" : stateNames.get(code) ?? code;

export function ComplianceLicensing({ brokerageId, paused, initialTarget }: { brokerageId: string; paused: boolean; initialTarget?: LicenseRenewalTarget }) {
  const [entities, setEntities] = useState<readonly ProgramEntity[]>();
  const [entityId, setEntityId] = useState(initialTarget?.entityId ?? "");
  const target = useRef(initialTarget);
  const [loaded, setLoaded] = useState<ProgramLicenses>();
  const [filter, setFilter] = useState("");
  const [renewalOnly, setRenewalOnly] = useState(false);
  const [holderKind, setHolderKind] = useState<LicenseHolder["kind"]>("Company");
  const [editing, setEditing] = useState<ProgramLicense | "new" | "entity">();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>();
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const editor = useRef<HTMLHeadingElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<string | null>(null);
  const attempt = useRef<{ key: string; id: string }>(null);

  useEffect(() => {
    if (paused) return;
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setFeedback({ message: result.error, error: true });
      else if (result.kind === "programEntities") {
        setEntities(result.entities);
        if (result.entities.length === 1) setEntityId(current => current || result.entities[0].id);
      }
    }, () => { if (active) setFeedback({ message: "Could not load legal entities. Refresh to try again.", error: true }); });
    return () => { active = false; };
  }, [brokerageId, paused, refresh]);

  useEffect(() => {
    if (paused || !entityId) return;
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "licenses", entityId } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setFeedback({ message: result.error, error: true });
      else if (result.kind === "programLicenses") {
        setLoaded(result);
        if (target.current?.entityId === entityId) {
          const license = result.licenses.find(item => item.id === target.current?.licenseId);
          target.current = undefined;
          if (license) { setEditing(license); setHolderKind(license.holder.kind); }
          else setFeedback({ message: "This license is unavailable. Check the current register or return to renewals.", error: true });
        }
      }
    }, () => { if (active) setFeedback({ message: "Could not load the license register. Refresh to try again.", error: true }); });
    return () => { active = false; };
  }, [brokerageId, entityId, paused, refresh]);

  useEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
    else if (!editing && returnTo.current) {
      (document.getElementById(`edit-license-${returnTo.current}`) ?? add.current)?.focus();
      returnTo.current = null;
    }
  }, [editing, feedback]);

  const current = loaded?.entity.id === entityId ? loaded : undefined;
  const licenses = current?.licenses;
  const visible = licenses?.filter(item => (!filter || item.jurisdiction === filter) && (!renewalOnly || item.renewal));
  const renewals = licenses?.filter(item => item.renewal).length ?? 0;
  const selected = typeof editing === "object" ? editing : undefined;
  const selectedEntity = entities?.find(item => item.id === entityId);
  const holderChoices = current?.holderChoices.filter(choice => choice.holder.kind === holderKind) ?? [];
  const previousHolder = selected?.holder.kind === holderKind ? selected.holder : undefined;
  const previousKey = previousHolder ? JSON.stringify(previousHolder) : "";
  const unavailableHolder = !!previousKey && !holderChoices.some(choice => JSON.stringify(choice.holder) === previousKey);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy || paused) return;
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    const values = {
      jurisdiction: field("jurisdiction"), licenseType: field("licenseType"), licenseNumber: field("licenseNumber"),
      status: field("status"), effectiveOn: field("effectiveOn") || null, expiresOn: field("expiresOn") || null, evidence: field("evidence"),
    };
    const key = JSON.stringify([entityId, selected?.id, selected?.revision, [...form]]);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    const requestId = attempt.current.id;
    let input: ProgramRequest;
    if (editing === "entity") input = { operation: "createEntity", requestId, name: field("name"), nmls: field("nmls"), scopeNote: field("scopeNote") };
    else {
      const parsed = licenseFields.safeParse(values);
      if (!parsed.success) { setFeedback({ message: "Check the state, license type, number and dates.", error: true }); return; }
      const holder = licenseHolder.safeParse(holderKind === "Company" ? { kind: "Company" } : JSON.parse(field("holder") || "null"));
      if (!holder.success) { setFeedback({ message: "Choose a holder for this license.", error: true }); return; }
      input = { operation: "saveLicense", requestId, entityId, id: selected?.id ?? requestId, revision: selected?.revision ?? 0,
        ...parsed.data, holder: holder.data };
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await accessComplianceCases({ type: "program", input }, brokerageId);
      if ("error" in result) { setFeedback({ message: result.error, error: true }); return; }
      if (result.kind === "programEntities") {
        const newEntity = result.entities.find(item => !entities?.some(existing => existing.id === item.id));
        setEntities(result.entities);
        if (newEntity) setEntityId(newEntity.id);
        setFeedback({ message: "Legal entity saved." });
      } else if (result.kind === "programLicenses" && input.operation === "saveLicense") {
        setLoaded(result);
        if (filter && filter !== input.jurisdiction) setFilter(input.jurisdiction);
        if (renewalOnly && !result.licenses.find(item => item.id === input.id)?.renewal) setRenewalOnly(false);
        setFeedback({ message: "License saved." });
      } else {
        setFeedback({ message: "Could not confirm the save. Refresh the register.", error: true });
        return;
      }
      attempt.current = null;
      returnTo.current = null;
      setEditing(undefined);
    } catch { setFeedback({ message: "The response was interrupted. Try the same save again.", error: true }); }
    finally { setBusy(false); }
  }

  function choose(next: ProgramLicense | "new" | "entity") {
    setFeedback(undefined);
    setEditing(next);
    setHolderKind(typeof next === "object" ? next.holder.kind : "Company");
  }

  return <div className="integration manager-panel record-form compliance-research-panel">
    <h2>License register</h2>
    <p className="muted">Record state licenses for the company, its branches, and loan officers. Recorded status is for internal review.</p>
    {feedback && <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
    <div className="loan-application-actions licensing-controls">
      <label className="field">Legal entity<select value={entityId} disabled={busy || !!editing || paused} onChange={event => {
        target.current = undefined; setEntityId(event.target.value); setLoaded(undefined); setFilter(""); setRenewalOnly(false); setFeedback(undefined);
      }}>
        <option value="">Select a legal entity</option>
        {entities?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <Button size="sm" className="min-h-10" variant="outline" disabled={busy || paused || !!editing || !entities} onClick={() => choose("entity")}>Add legal entity</Button>
      <Button size="sm" className="min-h-10" variant="outline" disabled={busy || paused} onClick={() => {
        setEditing(undefined); setFeedback(undefined); setLoaded(undefined); setRefresh(value => value + 1);
      }}>Refresh register</Button>
    </div>
    {selectedEntity && <div className="licensing-entity">
      <strong>{selectedEntity.name}</strong>{selectedEntity.nmls && <span> · NMLS {selectedEntity.nmls}</span>}
      <p className="muted">{selectedEntity.scopeNote}</p>
    </div>}
    {editing ? <section className="record-form" aria-label="License editor">
      <h3 ref={editor} tabIndex={-1}>{editing === "entity" ? "Add legal entity" : selected ? "Edit license" : "Add license"}</h3>
      <form className="record-form" onSubmit={save}>
        <fieldset className="record-form" disabled={busy || paused}>
          {editing === "entity" ? <>
            <label className="field">Legal entity name<input name="name" required minLength={3} maxLength={160} /></label>
            <label className="field">Company NMLS ID (optional)<input name="nmls" inputMode="numeric" pattern="[0-9]*" maxLength={15} /></label>
            <label className="field">Entity scope<textarea name="scopeNote" required minLength={5} maxLength={1500} rows={2} /></label>
          </> : <>
            <div className="form-grid">
              <label className="field">License holder<select name="holderKind" value={holderKind}
                onChange={event => setHolderKind(event.target.value as LicenseHolder["kind"])}>
                {licenseHolderKinds.map(kind => <option key={kind}>{kind}</option>)}
              </select></label>
              {holderKind !== "Company" && <label className="field">{holderKind}
                <select key={holderKind} name="holder" defaultValue={previousKey} required>
                  <option value="">Choose a {holderKind.toLowerCase()}</option>
                  {unavailableHolder && <option value={previousKey}>{selected?.holderLabel} · Assignment needs review</option>}
                  {holderChoices.map(choice => {
                    const key = JSON.stringify(choice.holder);
                    return <option key={key} value={key}>{choice.label}{choice.holder.kind === "Loan officer" ? ` · ${choice.holder.id}` : ""}</option>;
                  })}
                </select>
              </label>}
              <label className="field">State<select name="jurisdiction" required defaultValue={selected?.jurisdiction ?? filter}>
                <option value="">Select a state</option>
                {licenseJurisdictions.map(code => <option key={code} value={code}>{code} · {stateName(code)}</option>)}
              </select></label>
              <label className="field">License type<input name="licenseType" required minLength={2} maxLength={120} defaultValue={selected?.licenseType} /></label>
              <label className="field">License or application number<input name="licenseNumber" required maxLength={80} defaultValue={selected?.licenseNumber} /></label>
              <label className="field">Recorded status<select name="status" defaultValue={selected?.status ?? "Pending"}>
                {licenseStatuses.map(status => <option key={status}>{status}</option>)}
              </select></label>
              <label className="field">Effective date (optional)<input type="date" name="effectiveOn" defaultValue={selected?.effectiveOn ?? ""} /></label>
              <label className="field">Expiration date (optional)<input type="date" name="expiresOn" defaultValue={selected?.expiresOn ?? ""} /></label>
            </div>
            {holderKind !== "Company" && !holderChoices.length && <p className="muted">{holderKind === "Branch" ?
              "Add an active branch in Team → Branches to assign its license." : "Add or activate an LO in Team → Staff access to assign their license."}</p>}
            <label className="field">Evidence reference (optional)<input name="evidence" maxLength={500} defaultValue={selected?.evidence} /></label>
          </>}
          <div className="loan-application-actions">
            <Button type="submit" size="sm">{busy ? "Saving…" : editing === "entity" ? "Save entity" : "Save license"}</Button>
            <Button size="sm" variant="outline" type="button" onClick={() => {
              returnTo.current = selected?.id ?? "new";
              setEditing(undefined); setFeedback(undefined);
            }}>Cancel</Button>
          </div>
        </fieldset>
      </form>
    </section> : entityId && licenses ? <>
      <div className="loan-application-actions licensing-controls">
        <label className="field">Filter by state<select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="">All states</option>
          {[...new Set(licenses.map(item => item.jurisdiction))].map(code => <option key={code} value={code}>{code} · {stateName(code)}</option>)}
        </select></label>
        <Button size="sm" className="min-h-10" variant={renewalOnly ? "default" : "outline"} aria-pressed={renewalOnly}
          onClick={() => setRenewalOnly(value => !value)}>Renewal review ({renewals})</Button>
        <Button ref={add} size="sm" className="min-h-10" disabled={paused} onClick={() => choose("new")}>Add license</Button>
      </div>
      {renewalOnly && <p className="muted">Shows past expiration dates and active licenses expiring within {licenseRenewalLookahead} days.</p>}
      {visible?.length ? <ul className="loan-task-list">{visible.map(item => <li key={item.id} className="loan-task compliance-row">
        <div className="loan-task-copy">
          <strong>{item.jurisdiction} · {item.licenseType}</strong>
          <span>{item.licenseNumber} · {item.status}</span>
          <span>{item.holder.kind === "Company" ? "Company" : `${item.holder.kind} · ${item.holderLabel}`}
            {!item.holderAvailable && " · Assignment needs review"}</span>
          {item.renewal && <span className="pill">{item.renewal}</span>}
          <span>{item.effectiveOn && `Effective ${item.effectiveOn} · `}{item.expiresOn ? `Expires ${item.expiresOn}` : "Expiration not recorded"}</span>
          {item.evidence && <span>Evidence · {item.evidence}</span>}
        </div>
        <Button id={`edit-license-${item.id}`} size="sm" variant="outline" disabled={paused}
          aria-label={`Edit ${item.jurisdiction} license ${item.licenseNumber}`} onClick={() => choose(item)}>Edit license</Button>
      </li>)}</ul> : <p>{licenses.length ? "No licenses match these filters." : "No licenses recorded for this entity. Add a license to start its state register."}</p>}
    </> : !feedback && <p role="status">{paused ? "License editing is paused." : !entities || entityId ? "Loading license register…" : "Select or add a legal entity to record its licenses."}</p>}
  </div>;
}

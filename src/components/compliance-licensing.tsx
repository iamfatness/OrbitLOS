"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import { countLicenseRecords, inLicenseRegisterScope, licenseFields, licenseHolder, licenseHolderKinds, licenseJurisdictions, licenseRenewalLookahead, licenseRenewalOwner, licenseStatuses,
  type LicenseHistory, type LicenseHolder, type LicenseRegisterScope, type LicenseRenewalOwner, type LicenseRenewalTarget, type ProgramEntity, type ProgramLicense, type ProgramLicenses, type ProgramRequest } from "@/lib/compliance-program-model";
import { propertyStateName as stateName } from "@/lib/property-state";
import { LicenseRecordStatus } from "./license-record-status";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const ownerKey = ({ email, accessRevision }: LicenseRenewalOwner) => JSON.stringify({ email, accessRevision });
const entityActivities = ["Mortgage brokerage", "Mortgage lending", "Mortgage servicing", "Brokerage and lending",
  "Brokerage and servicing", "Lending and servicing", "Brokerage, lending and servicing", "Other", "Still determining scope"];
const entityStates = [...licenseJurisdictions].sort((first, second) => stateName(first).localeCompare(stateName(second)));

function EntityScopeFields({ states, setStates }: { states: string[]; setStates: (states: string[]) => void }) {
  const statePicker = useRef<HTMLSelectElement>(null);
  return <>
    <div className="form-grid">
      <label className="field">Business activity<select name="entityActivity" defaultValue="" required>
        <option value="">Select a business activity</option>
        {entityActivities.map(activity => <option key={activity}>{activity}</option>)}
      </select></label>
      <label className="field">States in scope<select ref={statePicker} value="" onChange={event => {
        if (event.target.value) setStates([...states, event.target.value]);
      }}>
        <option value="">Add a state</option>
        {entityStates.filter(state => !states.includes(state)).map(state => <option key={state} value={state}>{stateName(state)}</option>)}
      </select></label>
    </div>
    {!!states.length && <ul aria-label="States in scope" className="loan-application-actions list-none">
      {states.map(state => <li key={state}><Button type="button" variant="outline" size="sm" className="min-h-11"
        aria-label={`Remove ${stateName(state)}`} onClick={() => {
          setStates(states.filter(item => item !== state));
          statePicker.current?.focus();
        }}>
        {stateName(state)} ×
      </Button></li>)}
    </ul>}
    <label className="field">Scope notes (optional)<textarea name="scopeNote" maxLength={700} rows={2} /></label>
  </>;
}

function RenewalHistory({ brokerageId, entityId, licenseId }: { brokerageId: string; entityId: string; licenseId: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<LicenseHistory | { error: string }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "licenseHistory", entityId, licenseId } }, brokerageId).then(value => {
      if (!active) return;
      if ("error" in value || value.kind === "licenseHistory") setResult(value);
    }, () => { if (active) setResult({ error: "Could not load the license history." }); });
    return () => { active = false; };
  }, [brokerageId, entityId, licenseId, open, retry]);
  return <details className="document-form" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 content-center">Renewal history</summary>
    {!result && <p role="status" className="muted">Loading renewal history…</p>}
    {result && ("error" in result ? <div>
      <p role="alert">{result.error}</p><Button size="sm" variant="outline" onClick={() => { setResult(undefined); setRetry(value => value + 1); }}>Retry history</Button>
    </div> : result.entries.length ? <>
      <ul className="loan-task-list">{result.entries.map(entry => <li key={entry.id} className="loan-task compliance-row">
        <div className="loan-task-copy">
          <strong>{entry.action}</strong><span>{entry.actor} · {dateTime(entry.at)} ET</span>
          <span>{entry.status}{entry.expiresOn ? ` · Expiration ${entry.expiresOn}` : ""}</span>
          {entry.renewalOwner !== undefined && <span>Renewal owner · {entry.renewalOwner ?? "Unassigned"}</span>}
          {entry.note && <span>{entry.note}</span>}
          {entry.evidence && <span>Evidence · {entry.evidence}</span>}
        </div>
      </li>)}</ul>
      {result.more && <p className="muted">Showing the 25 most recent changes.</p>}
    </> : <p className="muted">No recorded changes are available for this license.</p>)}
  </details>;
}

export function ComplianceLicensing({ brokerageId, paused, initialTarget, setupEntity, reviewScope, onLicenseSaved, returnFromRenewal }: {
  brokerageId: string; paused: boolean; initialTarget?: LicenseRenewalTarget; setupEntity?: boolean; reviewScope?: LicenseRegisterScope; onLicenseSaved?: () => void;
  returnFromRenewal?: () => void;
}) {
  const [entities, setEntities] = useState<readonly ProgramEntity[]>();
  const [entityId, setEntityId] = useState(reviewScope?.entityId ?? initialTarget?.entityId ?? "");
  const target = useRef(reviewScope?.licenseId ? { entityId: reviewScope.entityId, licenseId: reviewScope.licenseId } : initialTarget);
  const [loaded, setLoaded] = useState<ProgramLicenses>();
  const [filter, setFilter] = useState("");
  const [renewalOnly, setRenewalOnly] = useState(false);
  const [holderKind, setHolderKind] = useState<LicenseHolder["kind"]>("Company");
  const [entityScopeStates, setEntityScopeStates] = useState<string[]>([]);
  const [editing, setEditing] = useState<ProgramLicense | "new" | "entity" | undefined>(setupEntity ? "entity" : undefined);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean; reload?: boolean }>();
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const editor = useRef<HTMLHeadingElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<string | null>(null);
  const attempt = useRef<{ key: string; id: string }>(null);

  useEffect(() => {
    if (paused || reviewScope || initialTarget) return;
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
  }, [brokerageId, initialTarget, paused, refresh, reviewScope]);

  useEffect(() => {
    if (paused || !entityId) return;
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "licenses", entityId } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setFeedback({ message: result.error, error: true, reload: true });
      else if (result.kind === "programLicenses") {
        setLoaded(result);
        if (target.current?.entityId === entityId) {
          const license = result.licenses.find(item => item.id === target.current?.licenseId &&
            (!reviewScope || inLicenseRegisterScope(item, reviewScope)));
          target.current = undefined;
          if (license) { setEditing(license); setHolderKind(license.holder.kind); }
          else setFeedback({ message: reviewScope ? "This license changed or is unavailable for this review. Check the records below or return to the lead." :
            "This license is unavailable. Return to the renewal list to check what is outstanding.", error: true });
        }
      }
    }, () => { if (active) setFeedback({ message: initialTarget ? "Could not load the license. Try loading it again." :
      "Could not load the license register. Refresh to try again.", error: true, reload: true }); });
    return () => { active = false; };
  }, [brokerageId, entityId, initialTarget, paused, refresh, reviewScope]);

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
  const visible = licenses?.filter(item => reviewScope ? inLicenseRegisterScope(item, reviewScope) :
    (!filter || item.jurisdiction === filter) && (!renewalOnly || item.renewal));
  const renewals = licenses?.filter(item => item.renewal).length ?? 0;
  const currentCompanyStates = current ? [...new Set(current.licenses.filter(item =>
    item.holder.kind === "Company" && countLicenseRecords([item], current.asOf).current > 0).map(item => item.jurisdiction))] : [];
  const selected = typeof editing === "object" ? editing : undefined;
  const renewal = !!initialTarget;
  const selectedEntity = current?.entity ?? entities?.find(item => item.id === entityId);
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
    const key = JSON.stringify([entityId, selected?.id, selected?.revision, [...form], editing === "entity" ? entityScopeStates : []]);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    const requestId = attempt.current.id;
    let input: ProgramRequest;
    if (editing === "entity") {
      const activity = field("entityActivity");
      if (!entityActivities.includes(activity)) {
        setFeedback({ message: "Select the legal entity’s business activity.", error: true });
        return;
      }
      const states = entityScopeStates.map(stateName).join(", ");
      const notes = field("scopeNote").trim();
      const scopeNote = [activity, states ? `States in scope · ${states}` : "States in scope · Still determining", notes].filter(Boolean).join("\n");
      input = { operation: "createEntity", requestId, name: field("name"), nmls: field("nmls"), scopeNote };
    }
    else {
      const parsed = licenseFields.safeParse(values);
      if (!parsed.success) { setFeedback({ message: "Check the state, license type, number and dates.", error: true }); return; }
      const holder = licenseHolder.safeParse(holderKind === "Company" ? { kind: "Company" } : JSON.parse(field("holder") || "null"));
      if (!holder.success) { setFeedback({ message: "Choose a holder for this license.", error: true }); return; }
      const chosenOwner = field("renewalOwner");
      const owner = chosenOwner && chosenOwner !== "keep" ? licenseRenewalOwner.safeParse(JSON.parse(chosenOwner)) : undefined;
      if (owner && !owner.success) { setFeedback({ message: "Choose a current renewal owner.", error: true }); return; }
      input = { operation: "saveLicense", requestId, entityId, id: selected?.id ?? requestId, revision: selected?.revision ?? 0,
        ...parsed.data, holder: holder.data, renewalOwner: chosenOwner === "keep" ? undefined : owner?.data ?? null,
        renewalNote: field("renewalNote") || undefined };
    }
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await accessComplianceCases({ type: "program", input }, brokerageId);
      if ("error" in result) {
        setFeedback({ message: result.error, error: true, reload: result.error.includes("Refresh") });
        return;
      }
      if (result.kind === "programEntities") {
        const newEntity = result.entities.find(item => !entities?.some(existing => existing.id === item.id));
        setEntities(result.entities);
        if (newEntity) setEntityId(newEntity.id);
        setFeedback({ message: "Legal entity saved." });
      } else if (result.kind === "programLicenses" && input.operation === "saveLicense") {
        setLoaded(result);
        if (filter && filter !== input.jurisdiction) setFilter(input.jurisdiction);
        if (renewalOnly && !result.licenses.find(item => item.id === input.id)?.renewal) setRenewalOnly(false);
        setFeedback({ message: renewal ? "Renewal details saved." : "License saved." });
        onLicenseSaved?.();
      } else {
        setFeedback({ message: "Could not confirm the save. Refresh the register.", error: true });
        return;
      }
      attempt.current = null;
      returnTo.current = null;
      const saved = renewal && result.kind === "programLicenses" && input.operation === "saveLicense" ?
        result.licenses.find(item => item.id === input.id) : undefined;
      if (saved) setHolderKind(saved.holder.kind);
      setEditing(saved);
    } catch { setFeedback({ message: "The response was interrupted. Try the same save again.", error: true }); }
    finally { setBusy(false); }
  }

  function choose(next: ProgramLicense | "new" | "entity") {
    setFeedback(undefined);
    if (next === "entity") setEntityScopeStates([]);
    setEditing(next);
    setHolderKind(typeof next === "object" ? next.holder.kind : "Company");
  }

  function reload() {
    target.current = initialTarget;
    setEditing(undefined);
    setFeedback(undefined);
    setLoaded(undefined);
    setRefresh(value => value + 1);
  }

  const renewalDates = <>
    <label className="field">Expiration date (optional)<input type="date" name="expiresOn" defaultValue={selected?.expiresOn ?? ""} /></label>
    <label className="field">Recorded status<select name="status" defaultValue={selected?.status ?? "Pending"}>
      {licenseStatuses.map(status => <option key={status}>{status}</option>)}
    </select></label>
  </>;
  const identityFields = <>
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
    <label className="field">Effective date (optional)<input type="date" name="effectiveOn" defaultValue={selected?.effectiveOn ?? ""} /></label>
  </>;
  const holderHelp = holderKind !== "Company" && !holderChoices.length && <p className="muted">{holderKind === "Branch" ?
    "Add an active branch in Team → Branches to assign its license." : "Add or activate an LO in Team → Staff access to assign their license."}</p>;

  return <div className={reviewScope ? "record-form" : "integration manager-panel record-form compliance-research-panel"}>
    <h2>{renewal ? "License renewal" : reviewScope ? `${stateName(reviewScope.jurisdiction)} · ${reviewScope.holderName}` : "License register"}</h2>
    {!reviewScope && !renewal && <p className="muted">Record state licenses for the company, its branches, and loan officers. Recorded status is for internal review.</p>}
    {feedback && <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
    {renewal && feedback?.reload && <div className="record-form">
      {selected && <p className="muted">Reloading replaces the values in this form.</p>}
      <div><Button size="sm" className="min-h-11" variant="outline" disabled={busy || paused} onClick={reload}>Reload license</Button></div>
    </div>}
    {!renewal && <div className="loan-application-actions licensing-controls">
      {!reviewScope && <label className="field">Legal entity<select value={entityId} disabled={busy || !!editing || paused} onChange={event => {
        target.current = undefined; setEntityId(event.target.value); setLoaded(undefined); setFilter(""); setRenewalOnly(false); setFeedback(undefined);
      }}>
        <option value="">Select a legal entity</option>
        {entities?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
      {!reviewScope && <Button size="sm" className="min-h-10" variant="outline" disabled={busy || paused || !!editing || !entities} onClick={() => choose("entity")}>Add legal entity</Button>}
      <Button size="sm" className="min-h-10" variant="outline" disabled={busy || paused} onClick={reload}>Refresh register</Button>
    </div>}
    {selectedEntity && !renewal && <div className="licensing-entity">
      <strong>{selectedEntity.name}</strong>{selectedEntity.nmls && <span> · NMLS {selectedEntity.nmls}</span>}
      <p className="muted whitespace-pre-line break-words">{selectedEntity.scopeNote}</p>
    </div>}
    {editing ? <section className="record-form" aria-label={renewal ? "Renewal details" : "License editor"}>
      <h3 ref={editor} tabIndex={-1}>{renewal && selected ? `${stateName(selected.jurisdiction)} · ${selected.holderLabel}` :
        editing === "entity" ? "Add legal entity" : selected ? "Edit license" : "Add license"}</h3>
      {renewal && selected && <div className="break-words">
        <p>{selectedEntity?.name} · {selected.licenseType} · {selected.licenseNumber}</p>
        <p className="muted">{selected.renewal ?? "No renewal currently due"}{!selected.holderAvailable && " · Holder assignment needs review"}</p>
      </div>}
      <form className="record-form" key={selected?.revision} onSubmit={save}>
        <fieldset className="record-form" disabled={busy || paused}>
          {editing === "entity" ? <>
            <label className="field">Legal entity name<input name="name" required minLength={3} maxLength={160} /></label>
            <label className="field">Company NMLS ID (optional)<input name="nmls" inputMode="numeric" pattern="[0-9]*" maxLength={15} /></label>
            <EntityScopeFields states={entityScopeStates} setStates={setEntityScopeStates} />
          </> : <>
            <div className="form-grid">{!renewal && identityFields}{renewalDates}</div>
            {!renewal && holderHelp}
            <div className="form-grid items-start">
              <label className="field">Renewal owner<select name="renewalOwner"
                defaultValue={selected?.renewalOwner ? selected.renewalOwner.available ? ownerKey(selected.renewalOwner) : "keep" : ""}>
                <option value="">Unassigned</option>
                {selected?.renewalOwner && !selected.renewalOwner.available &&
                  <option value="keep">{selected.renewalOwner.name} · Owner needs review</option>}
                {current?.renewalOwners.map(owner => <option key={owner.email} value={ownerKey(owner)}>{owner.name}</option>)}
              </select></label>
              <label className="field">Evidence reference (optional){renewal ?
                <textarea name="evidence" rows={2} maxLength={500} defaultValue={selected?.evidence} aria-describedby="renewal-evidence-help" /> :
                <input name="evidence" maxLength={500} defaultValue={selected?.evidence} />}</label>
            </div>
            {renewal && <p id="renewal-evidence-help" className="muted">Record a confirmation number or where your team can find the renewal receipt.</p>}
            <label className="field">Renewal note (optional)<textarea name="renewalNote" maxLength={500} rows={2} /></label>
          </>}
          <div className="loan-application-actions">
            <Button type="submit" size="sm" className={renewal ? "min-h-11" : undefined}>{busy ? "Saving…" : renewal ? "Save renewal details" : editing === "entity" ? "Save entity" : "Save license"}</Button>
            <Button size="sm" className={renewal ? "min-h-11" : undefined} variant="outline" type="button" onClick={renewal ? returnFromRenewal : () => {
              returnTo.current = selected?.id ?? "new";
              setEditing(undefined); setFeedback(undefined);
            }}>{renewal ? "Back to renewal work" : "Cancel"}</Button>
          </div>
          {renewal && <details className="document-form" onInvalid={event => { event.currentTarget.open = true; }}>
            <summary className="min-h-11 content-center">Full license details</summary>
            <div className="form-grid">{identityFields}</div>
            {holderHelp}
          </details>}
        </fieldset>
      </form>
      {selected && <RenewalHistory key={`${selected.id}:${selected.revision}`} brokerageId={brokerageId} entityId={entityId} licenseId={selected.id} />}
    </section> : !renewal && entityId && licenses ? <>
      {!reviewScope && <><div className="loan-application-actions licensing-controls">
        <label className="field">Filter by state<select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="">All states</option>
          {licenseJurisdictions.map(code => <option key={code} value={code}>{code} · {stateName(code)}</option>)}
        </select></label>
        <Button size="sm" className="min-h-10" variant={renewalOnly ? "default" : "outline"} aria-pressed={renewalOnly}
          onClick={() => setRenewalOnly(value => !value)}>Renewal review ({renewals})</Button>
        <Button ref={add} size="sm" className="min-h-10" disabled={paused} onClick={() => choose("new")}>Add license</Button>
      </div>
      {!filter && !renewalOnly && <p className="muted">{currentCompanyStates.length
        ? `Current company records on file in ${currentCompanyStates.join(", ")}.`
        : "No current company license records on file for this entity."}</p>}
      {filter && !renewalOnly && current && <section className="work-queue license-state-result" aria-label={`${stateName(filter)} license records`}>
        <h3 className="font-semibold">{stateName(filter)} license records</h3>
        {licenseHolderKinds.map(kind => <p key={kind}><strong>{kind}</strong> · <LicenseRecordStatus counts={countLicenseRecords(
          licenses.filter(license => license.jurisdiction === filter && license.holder.kind === kind), current.asOf)} /></p>)}
      </section>}
      {renewalOnly && <p className="muted">Shows past expiration dates and active licenses expiring within {licenseRenewalLookahead} days.</p>}</>}
      {visible?.length ? <ul className="loan-task-list">{visible.map(item => <li key={item.id} className="loan-task compliance-row">
        <div className="loan-task-copy">
          <strong>{item.jurisdiction} · {item.licenseType}</strong>
          <span>{item.licenseNumber} · {item.status}</span>
          <span>{item.holder.kind === "Company" ? "Company" : `${item.holder.kind} · ${item.holderLabel}`}
            {!item.holderAvailable && " · Assignment needs review"}</span>
          {item.renewal && <span className="pill">{item.renewal}</span>}
          {(item.renewal || item.renewalOwner) && <span>Renewal owner · {item.renewalOwner?.name ?? "Unassigned"}
            {item.renewalOwner && !item.renewalOwner.available && " · Owner needs review"}</span>}
          <span>{item.effectiveOn && `Effective ${item.effectiveOn} · `}{item.expiresOn ? `Expires ${item.expiresOn}` : "Expiration not recorded"}</span>
          {item.evidence && <span>Evidence · {item.evidence}</span>}
        </div>
        <Button id={`edit-license-${item.id}`} size="sm" variant="outline" disabled={paused}
          aria-label={`Edit ${item.jurisdiction} license ${item.licenseNumber}`} onClick={() => choose(item)}>Edit license</Button>
      </li>)}</ul> : <p>{reviewScope ? "No matching license records remain for this review." : filter && !renewalOnly ? `No ${stateName(filter)} licenses recorded for this entity.` : licenses.length ? "No licenses match these filters." : "No licenses recorded for this entity. Add a license to start its state register."}</p>}
    </> : !feedback && <p role="status">{paused ? "License editing is paused." : renewal ? "Loading license…" :
      reviewScope || !entities || entityId ? "Loading license register…" : "Select or add a legal entity to record its licenses."}</p>}
  </div>;
}

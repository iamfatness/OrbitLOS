"use client";

import { useEffect, useState, type FormEvent } from "react";
import { accessCrmFields } from "@/app/actions";
import { crmFieldKinds, crmFieldRoles, crmFieldUnavailable, newCrmField, type CrmField, type CrmFieldDefinition,
  type CrmFieldEntry, type CrmFieldFilter, type CrmFieldTarget } from "@/lib/crm-field-model";
import { Button } from "./ui/button";

function useFields(brokerageId: string) {
  const [result, setResult] = useState<{ fields: CrmField[] } | { error: string }>();
  useEffect(() => {
    let current = true;
    void accessCrmFields({ type: "list" }, brokerageId).then((response) => {
      if (current) setResult("kind" in response && response.kind === "list" ? { fields: response.fields } :
        { error: "error" in response ? response.error : crmFieldUnavailable });
    }).catch(() => { if (current) setResult({ error: crmFieldUnavailable }); });
    return () => { current = false; };
  }, [brokerageId]);
  return [result, setResult] as const;
}

function FieldValueControl({ field, value, change, disabled, required = false }: {
  field: CrmField; value: string; change: (value: string) => void; disabled: boolean; required?: boolean;
}) {
  const choices = field.kind === "Choice" ? field.options : field.kind === "Yes or no" ? ["Yes", "No"] : null;
  return choices ? <select value={value} onChange={(event) => change(event.target.value)} disabled={disabled} required={required}>
    <option value="">{required ? "Choose a value" : "No value"}</option>
    {choices.map((choice) => <option key={choice}>{choice}</option>)}
  </select> : <input type={field.kind === "Date" ? "date" : "text"}
    inputMode={field.kind === "Number" ? "decimal" : undefined} maxLength={120} value={value}
    onChange={(event) => change(event.target.value)} disabled={disabled} required={required} />;
}

export function CrmFieldFilterEditor({ brokerageId, value, change, disabled, scope }: {
  brokerageId: string; value?: CrmFieldFilter; change: (value: CrmFieldFilter | undefined) => void; disabled: boolean; scope: string;
}) {
  const [result] = useFields(brokerageId);
  const fields = result && "fields" in result ? result.fields : [];
  const selected = fields.find((field) => field.id === value?.fieldId);
  if (!value && !fields.length) return result && "error" in result ? <p className="muted" role="status">{result.error}</p> : null;
  return <div className="form-grid">
    <label className="field">CRM field filter<select value={value?.fieldId ?? ""} disabled={disabled} onChange={(event) => {
      change(event.target.value ? { fieldId: event.target.value, value: "" } : undefined);
    }}>
      <option value="">All field values</option>
      {value && !selected && <option value={value.fieldId}>{result ? "Unavailable CRM field" : "Loading field…"}</option>}
      {fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
    </select><small className="muted">{scope}</small></label>
    {selected && value && <label className="field">Matches value
      <FieldValueControl field={selected} value={value.value} change={(text) => change({ ...value, value: text })} disabled={disabled} required />
    </label>}
  </div>;
}

function ValueEditor({ entry, busy, save }: {
  entry: CrmFieldEntry; busy: boolean; save: (entry: CrmFieldEntry, value: string) => Promise<string | null | undefined>;
}) {
  const [value, setValue] = useState(entry.value ?? "");
  return <form className="record-form" onSubmit={(event) => {
    event.preventDefault();
    void save(entry, value).then((stored) => { if (stored !== undefined) setValue(stored ?? ""); });
  }}>
    <label className="field">{entry.field.label}
      <FieldValueControl field={entry.field} value={value} change={setValue} disabled={busy} />
    </label>
    <div><Button size="sm" variant="outline" type="submit" disabled={busy || value === (entry.value ?? "")}>Save {entry.field.label}</Button></div>
  </form>;
}

function RecordFields({ brokerageId, target }: { brokerageId: string; target: CrmFieldTarget }) {
  const [result, setResult] = useState<{ entries: CrmFieldEntry[]; editable: boolean }>();
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const { record, recordId } = target;
  useEffect(() => {
    let current = true;
    void accessCrmFields({ type: "values", record, recordId }, brokerageId).then((response) => {
      if (!current) return;
      if ("error" in response) setNotice(response.error);
      else if (response.kind === "values") setResult(response);
    }).catch(() => { if (current) setNotice(crmFieldUnavailable); });
    return () => { current = false; };
  }, [brokerageId, record, recordId, retry]);

  async function save({ field, revision }: CrmFieldEntry, value: string) {
    setBusy(true);
    setNotice("");
    try {
      const response = await accessCrmFields({ type: "saveValue", record, recordId, fieldId: field.id, fieldRevision: field.revision,
        revision, value: value.trim() || null }, brokerageId);
      if ("error" in response) setNotice(response.error);
      else if (response.kind === "values") {
        setResult(response);
        setNotice(`${field.label} saved.`);
        return response.entries.find((entry) => entry.field.id === field.id)?.value;
      }
    } catch {
      setNotice(crmFieldUnavailable);
    } finally {
      setBusy(false);
    }
  }

  return <div className="record-form">
    {!result && !notice && <p className="muted" role="status">Loading record fields…</p>}
    {result && !result.entries.length && <p className="empty-inline">No CRM fields are available for this record.</p>}
    {result?.entries.map((entry) => result.editable ? <ValueEditor key={`${entry.field.id}:${entry.field.revision}:${entry.revision}:${retry}`}
      entry={entry} busy={busy} save={save} /> :
      <p key={entry.field.id}><strong>{entry.field.label}</strong> · {entry.value ?? "No value"}</p>)}
    {notice && <p role="status">{notice}</p>}
    {(!result || result.entries.length > 0) && <div><Button variant="ghost" size="sm" disabled={busy}
      onClick={() => { setNotice(""); setResult(undefined); setRetry((value) => value + 1); }}>Reload record fields</Button></div>}
  </div>;
}

export function CrmFieldValues({ brokerageId, target }: { brokerageId: string; target: CrmFieldTarget }) {
  const [open, setOpen] = useState(false);
  return <details className="document-form" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>CRM fields</summary>
    {open && <RecordFields key={`${brokerageId}:${target.record}:${target.recordId}`} brokerageId={brokerageId} target={target} />}
  </details>;
}

function SettingsEditor({ field, busy, save, archive, cancel }: {
  field: CrmField; busy: boolean; save: (definition: CrmFieldDefinition) => void; archive: () => void; cancel: () => void;
}) {
  const [kind, setKind] = useState(field.kind);
  const [confirmArchive, setConfirmArchive] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save({ label: String(data.get("label")), kind, options: kind === "Choice" ?
      String(data.get("options")).split(/\r?\n/).map((option) => option.trim()).filter(Boolean) : [],
    roles: crmFieldRoles.filter((role) => data.has(role)) });
  }
  return <form className="record-form document-item" onSubmit={submit}>
    <div className="form-grid">
      <label className="field">Field label<input name="label" maxLength={60} minLength={2} required defaultValue={field.label} disabled={busy} /></label>
      <label className="field">Field type<select value={kind} onChange={(event) => setKind(event.target.value as CrmField["kind"])}
        disabled={busy || field.revision > 0}>{crmFieldKinds.map((item) => <option key={item}>{item}</option>)}</select></label>
    </div>
    {kind === "Choice" && <label className="field">Choices, one per line<textarea name="options" rows={4} maxLength={620}
      defaultValue={field.options.join("\n")} disabled={busy} required /></label>}
    <fieldset className="record-form">
      <legend>Who can see this field</legend>
      <p className="muted">Admins always have access. Processors can only view shared fields on assigned borrower records.</p>
      {crmFieldRoles.map((role) => <label className="demo-confirm" key={role}>
        <input type="checkbox" name={role} defaultChecked={field.roles.includes(role)} disabled={busy} />
        {role === "LO" ? "Loan officers" : "Processors"}
      </label>)}
    </fieldset>
    <div className="loan-application-actions">
      <Button size="sm" type="submit" disabled={busy}>Save field</Button>
      <Button size="sm" variant="ghost" type="button" onClick={cancel} disabled={busy}>Cancel</Button>
      {field.revision > 0 && <Button size="sm" variant="outline" type="button" onClick={() => setConfirmArchive(true)} disabled={busy || confirmArchive}>Archive field</Button>}
    </div>
    {confirmArchive && <div className="record-form">
      <p>Existing values are retained. Reports and segments that use this field will need a new filter.</p>
      <div><Button size="sm" variant="outline" type="button" onClick={archive} disabled={busy}>Confirm archive</Button></div>
    </div>}
  </form>;
}

function FieldSettings({ brokerageId }: { brokerageId: string }) {
  const [result, setResult] = useFields(brokerageId);
  const [edit, setEdit] = useState<CrmField>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const fields = result && "fields" in result ? result.fields : [];
  async function changeField(input: { type: "saveField"; definition: CrmFieldDefinition } | { type: "archiveField" }) {
    if (!edit) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await accessCrmFields({ ...input, fieldId: edit.id, revision: edit.revision }, brokerageId);
      if ("error" in response) setNotice(response.error);
      else if (response.kind === "savedField" || response.kind === "archived") {
        const remaining = fields.filter((field) => field.id !== edit.id);
        if (response.kind === "savedField") remaining.push(response.field);
        setResult({ fields: remaining.sort((a, b) => a.label.localeCompare(b.label)) });
        setEdit(undefined);
        setNotice(response.kind === "savedField" ? "CRM field saved." : "CRM field archived.");
      }
    } catch {
      setNotice(crmFieldUnavailable);
    } finally {
      setBusy(false);
    }
  }
  return <div className="record-form">
    <p className="muted">Add brokerage fields to leads and borrower contacts. Use the saved values in segment and report filters.</p>
    {!result && <p role="status">Loading CRM field settings…</p>}
    {result && "error" in result && <p role="status">{result.error}</p>}
    {result && "fields" in result && <>
      {fields.length ? <ul className="document-list">{fields.map((field) => <li className="document-item" key={field.id}>
        <div className="document-item-head"><strong>{field.label}</strong><span className="pill">{field.kind}</span></div>
        <div><Button size="sm" variant="ghost" onClick={() => setEdit(field)} disabled={busy}>Edit {field.label}</Button></div>
      </li>)}</ul> : <p className="empty-inline">No brokerage fields have been set up yet.</p>}
      {!edit && <div><Button size="sm" variant="outline" onClick={() => setEdit({ ...newCrmField, id: crypto.randomUUID(), revision: 0 })}>Add CRM field</Button></div>}
      {edit && <SettingsEditor key={`${edit.id}:${edit.revision}`} field={edit} busy={busy} cancel={() => setEdit(undefined)}
        save={(definition) => void changeField({ type: "saveField", definition })} archive={() => void changeField({ type: "archiveField" })} />}
    </>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}

export function CrmFieldSettings({ brokerageId }: { brokerageId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="integration manager-panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Manage CRM fields</summary>
    {open && <FieldSettings key={brokerageId} brokerageId={brokerageId} />}
  </details>;
}

"use client";

import { useEffect, useState } from "react";
import { accessDisclosureTemplates } from "@/app/actions";
import { sampleDisclosureDocuments, type DisclosurePackage } from "@/lib/disclosure-model";
import { disclosureTemplatePurposes, disclosureTemplateUnavailable, type DisclosureTemplate, type DisclosureTemplateBasis,
  type DisclosureTemplateConfig, type DisclosureTemplateResult, type DisclosureTemplateOptions } from "@/lib/disclosure-template-model";
import { Button } from "./ui/button";

const templateKey = ({ id, revision }: Pick<DisclosureTemplateBasis, "id" | "revision">) => `${id}:${revision}`;
const templateScope = ({ purpose, propertyState }: DisclosureTemplateBasis) => `${purpose} · ${propertyState || "Any property state"}`;

export function DisclosurePackageDocuments({ options, current, busy }: {
  options?: DisclosureTemplateOptions; current?: DisclosurePackage; busy: boolean;
}) {
  const [selection, setSelection] = useState<string>();
  const templates = options?.templates ?? [];
  const originalKey = current?.templateBasis ? templateKey(current.templateBasis) : null;
  const suggested = templates.find((item) => current ? templateKey(item) === originalKey : item.id === options?.recommendedId);
  const selectedKey = selection ?? (suggested ? templateKey(suggested) : "");
  const selected = templates.find((item) => templateKey(item) === selectedKey);
  const stale = Boolean(selectedKey && !selected);
  return <div className="record-form">
    {(templates.length > 0 || stale) && <label className="field">Sample disclosure template
      <select name="disclosureTemplate" value={selectedKey} disabled={busy} onChange={(event) => setSelection(event.target.value)}>
        <option value="">Manual document selection</option>
        {stale && <option value={selectedKey}>Template version unavailable</option>}
        {templates.map((item) => <option value={templateKey(item)} key={item.id}>
          {item.title} · v{item.revision}{!current && item.id === options?.recommendedId ? " · Suggested" : ""}
        </option>)}
      </select>
      <small className="muted">Reviewed 1003 · {options?.purpose} · {options?.propertyState || "Property state pending"}</small>
    </label>}
    {!templates.length && options && <p className="muted">No sample template matches this file. Select the documents below.</p>}
    {templates.length > 1 && !options?.recommendedId && !current && !selectedKey &&
      <p className="muted">Multiple templates match equally. Choose a template or select documents manually.</p>}
    {originalKey && !suggested && !selectedKey && <p className="muted">The previous package keeps its original template version. Choose a current template or use manual selection.</p>}
    {stale && <p role="status">Choose a current template version or use manual document selection.</p>}
    {selected ? <div className="document-item">
      <strong>{selected.title} · Template v{selected.revision}</strong>
      <p className="muted">{templateScope(selected)}</p>
      <ul>{selected.documents.map((document) => <li key={document}>{document}<input type="hidden" name="documents" value={document} /></li>)}</ul>
    </div> : <fieldset disabled={busy}><legend>Package documents</legend>{sampleDisclosureDocuments.map((document) =>
      <label className="disclosure-document-choice" key={document}><input name="documents" type="checkbox" value={document}
        defaultChecked={!current || current.documents.includes(document)} />{document}</label>)}</fieldset>}
  </div>;
}

function TemplateEditor({ item, busy, cancel, save }: {
  item: DisclosureTemplate; busy: boolean; cancel: () => void; save: (config: DisclosureTemplateConfig) => void;
}) {
  return <form className="record-form document-item" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save({ title: String(data.get("title")), purpose: data.get("purpose") as DisclosureTemplateConfig["purpose"],
      propertyState: String(data.get("propertyState")), documents: data.getAll("documents") as DisclosureTemplateConfig["documents"] });
  }}>
    <div className="form-grid">
      <label className="field">Template title<input name="title" required minLength={2} maxLength={80} defaultValue={item.title} disabled={busy} /></label>
      <label className="field">Loan purpose<select name="purpose" defaultValue={item.purpose} disabled={busy}>
        {disclosureTemplatePurposes.map((purpose) => <option key={purpose}>{purpose}</option>)}
      </select></label>
      <label className="field">Property state<input name="propertyState" maxLength={2} placeholder="Any state" defaultValue={item.propertyState} disabled={busy} />
        <small className="muted">Enter a two-letter code or leave it blank for any state.</small>
      </label>
    </div>
    <fieldset disabled={busy}><legend>Sample documents</legend>{sampleDisclosureDocuments.map((document) =>
      <label className="disclosure-document-choice" key={document}><input name="documents" type="checkbox" value={document}
        defaultChecked={item.documents.includes(document)} />{document}</label>)}</fieldset>
    <div className="loan-application-actions">
      <Button size="sm" type="submit" disabled={busy}>Publish sample template</Button>
      <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={cancel}>Cancel</Button>
    </div>
  </form>;
}

function TemplateSettings({ brokerageId }: { brokerageId: string }) {
  const [result, setResult] = useState<DisclosureTemplateResult>();
  const [edit, setEdit] = useState<DisclosureTemplate>();
  const [archive, setArchive] = useState<DisclosureTemplate>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    void accessDisclosureTemplates({ type: "list" }, brokerageId).then((response) => {
      if (current) setResult(response);
    }).catch(() => { if (current) setResult({ error: disclosureTemplateUnavailable }); });
    return () => { current = false; };
  }, [brokerageId, retry]);

  async function update(input: object, message: string) {
    setBusy(true);
    setNotice("");
    try {
      const response = await accessDisclosureTemplates(input, brokerageId);
      if ("error" in response) setNotice(response.error);
      else {
        setResult(response);
        setEdit(undefined);
        setArchive(undefined);
        setNotice(message);
      }
    } catch {
      setNotice(disclosureTemplateUnavailable);
    } finally {
      setBusy(false);
    }
  }

  return <div className="record-form">
    <p>Reuse a sample document list for matching loans. Prepared packages keep the template version and document list used at the time.</p>
    {!result && <p role="status">Loading sample disclosure templates…</p>}
    {result && "error" in result && <p role="status">{result.error}</p>}
    {result && "templates" in result && <>
      {result.templates.length ? <ul className="document-list">{result.templates.map((item) => <li className="document-item" key={item.id}>
        <div className="document-item-head"><strong>{item.title}</strong><span className="pill">{item.archived ? "Archived" : "Active"} · v{item.revision}</span></div>
        <p className="muted">{templateScope(item)} · {item.documents.length} sample documents</p>
        <div className="loan-application-actions">
          {item.archived ? <Button size="sm" variant="outline" disabled={busy || !!edit || !!archive} onClick={() => void update({
            type: "archive", id: item.id, revision: item.revision, archived: false,
          }, "Sample template restored.")}>Restore {item.title}</Button> : <>
            <Button size="sm" variant="outline" disabled={busy || !!edit || !!archive} onClick={() => setEdit(item)}>Edit {item.title}</Button>
            <Button size="sm" variant="ghost" disabled={busy || !!edit || !!archive} onClick={() => setArchive(item)}>Archive {item.title}</Button>
          </>}
        </div>
      </li>)}</ul> : <p className="empty-inline">No sample disclosure templates yet.</p>}
      {result.moreArchived && <p className="muted">All active templates and the first archived templates are shown.</p>}
      {archive && <div className="document-item">
        <p>Archive {archive.title}? Prepared packages keep their saved template version.</p>
        <div className="loan-application-actions"><Button size="sm" variant="outline" disabled={busy}
          onClick={() => void update({ type: "archive", id: archive.id, revision: archive.revision, archived: true }, "Sample template archived.")}>
          Confirm archive
        </Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setArchive(undefined)}>Cancel</Button></div>
      </div>}
      {!edit && !archive && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => setEdit({
        id: crypto.randomUUID(), title: "", purpose: "Any loan purpose", propertyState: "", documents: [...sampleDisclosureDocuments],
        revision: 0, archived: false,
      })}>New sample template</Button></div>}
      {edit && <TemplateEditor key={templateKey(edit)} item={edit} busy={busy} cancel={() => setEdit(undefined)}
        save={(config) => void update({ type: "publish", id: edit.id, revision: edit.revision, config }, "Sample template published.")} />}
    </>}
    {notice && <p role="status">{notice}</p>}
    {(notice || result && "error" in result) && <div><Button size="sm" variant="ghost" disabled={busy} onClick={() => {
      setNotice(""); setEdit(undefined); setArchive(undefined); setResult(undefined); setRetry((value) => value + 1);
    }}>Reload sample templates</Button></div>}
  </div>;
}

export function DisclosureTemplateSettings({ brokerageId }: { brokerageId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="integration manager-panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Sample disclosure templates</summary>
    {open && <TemplateSettings key={brokerageId} brokerageId={brokerageId} />}
  </details>;
}

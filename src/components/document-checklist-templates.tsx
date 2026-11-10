"use client";

import { useEffect, useRef, useState } from "react";
import { dateLabel } from "@/lib/client-retention";
import { checklistInstructions, checklistPresetNames, checklistPresets, documentKinds, documentRecipient, documentRecipients, primaryDocumentRecipient,
  type DocumentKind, type DocumentRecipient, type LoanDocumentRequest } from "@/lib/document-model";
import { documentTemplateConfig, documentTemplateDueOn, documentTemplateEmployment, documentTemplateOccupancies, documentTemplatePurposes,
  documentTemplateRuleLabel, type DocumentTemplate, type DocumentTemplateConfig, type DocumentTemplatePage, type DocumentTemplateRule } from "@/lib/document-template-model";
import { Button } from "./ui/button";

async function loadTemplates(brokerageId: string, input: object, signal?: AbortSignal): Promise<DocumentTemplatePage> {
  const response = await fetch(`/api/document-templates?brokerage=${encodeURIComponent(brokerageId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  });
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Could not open document templates.");
  const result = await response.json() as DocumentTemplatePage | { error: string };
  if ("error" in result) throw new Error(result.error);
  if (!response.ok) throw new Error("Could not open document templates.");
  return result;
}

const emptyTemplate: DocumentTemplateConfig = { title: "", purpose: "Any loan purpose", items: [] };

export function ManageDocumentTemplates({ brokerageId }: { brokerageId: string }) {
  const [opened, setOpened] = useState(false);
  const [page, setPage] = useState<DocumentTemplatePage>();
  const [draft, setDraft] = useState<{ id: string; revision: number; config: DocumentTemplateConfig }>();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const pending = useRef(false);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    void loadTemplates(brokerageId, { type: "manage" }, controller.signal).then((result) => {
      if (!controller.signal.aborted) setPage(result);
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setFeedback({ text: failure.message, error: true });
    });
    return () => controller.abort();
  }, [brokerageId, opened]);

  function edit(template: DocumentTemplate) {
    const { id, revision, title, purpose, items } = template;
    setDraft({ id, revision, config: { title, purpose, items } });
  }

  function change(update: Partial<DocumentTemplateConfig>) {
    setDraft((value) => value && { ...value, config: { ...value.config, ...update } });
  }

  async function run(input: object, success?: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await loadTemplates(brokerageId, input);
      setPage(result);
      if (success) {
        setSearch("");
        setDraft(undefined);
        setFeedback({ text: success });
      }
    } catch (failure) {
      setFeedback({ text: failure instanceof Error ? failure.message : "Could not save the checklist.", error: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function toggleKind(kind: DocumentKind, checked: boolean) {
    if (!draft) return;
    change({ items: checked ? [...draft.config.items, { kind, instructions: checklistInstructions[kind], dueDays: null }] :
      draft.config.items.filter((item) => item.kind !== kind) });
  }

  return <section className="pipeline relationship-panel" aria-label="Document checklist templates">
    <h2>Document checklist templates</h2>
    <p className="muted">Set reusable document requests, deadlines, and optional rules based on the reviewed 1003.</p>
    <details className="loan-task-create" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
      <summary>Manage document templates</summary>
      {opened && <div className="record-form">
        {feedback && <p className="application-message" role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
        {!page && !feedback && <p role="status">Opening templates…</p>}
        <form className="loan-application-actions" onSubmit={(event) => { event.preventDefault(); void run({ type: "manage", search }); }}>
          <label className="field">Find a template<input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={80} disabled={busy} /></label>
          <Button size="sm" variant="outline" type="submit" disabled={busy || (!page && !feedback)}>Search templates</Button>
        </form>
        {page && <>
          {!page.templates.length && <p className="muted">No templates match. Create a checklist or change the search.</p>}
          {page.more && <p className="muted">Search by name to find more archived templates.</p>}
          {page.templates.length > 0 && <ul className="document-list">{page.templates.map((template) => <li key={template.id} className="document-item">
            <div className="document-item-head"><strong>{template.title}</strong><span className="pill">{template.archived ? "Archived" : `Version ${template.revision}`}</span></div>
            <p>{template.purpose} · {template.items.length} {template.items.length === 1 ? "document" : "documents"}</p>
            <div className="loan-application-actions">
              {!template.archived && <Button size="sm" variant="outline" disabled={busy} onClick={() => edit(template)}>Edit template</Button>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ type: "archive", id: template.id,
                revision: template.revision, archived: !template.archived }, template.archived ? "Template restored." : "Template archived. Existing requests retain their details.")}>
                {template.archived ? "Restore template" : "Archive template"}
              </Button>
            </div>
          </li>)}</ul>}
          {!draft && <div><Button size="sm" disabled={busy} onClick={() => {
            setFeedback(undefined);
            setDraft({ id: crypto.randomUUID(), revision: 0, config: emptyTemplate });
          }}>New checklist template</Button></div>}
        </>}
        {draft && <form className="document-item record-form" aria-label="Checklist template editor" key={draft.id} onSubmit={(event) => {
          event.preventDefault();
          const config = documentTemplateConfig.safeParse(draft.config);
          if (!config.success) { setFeedback({ text: "Enter a title and choose at least one document with a valid deadline.", error: true }); return; }
          void run({ type: "publish", ...draft, config: config.data }, "Document checklist published.");
        }}>
          <h3>{draft.revision ? `Edit template version ${draft.revision}` : "New checklist template"}</h3>
          <div className="form-grid">
            <label className="field">Template title<input value={draft.config.title} required minLength={3} maxLength={80} disabled={busy}
              onChange={(event) => change({ title: event.target.value })} /></label>
            <label className="field">Loan purpose<select value={draft.config.purpose} disabled={busy}
              onChange={(event) => change({ purpose: event.target.value as DocumentTemplateConfig["purpose"] })}>
              {documentTemplatePurposes.map((purpose) => <option key={purpose}>{purpose}</option>)}
            </select></label>
          </div>
          <p className="muted">Deadline days are calendar days from application of the template. Enter 0 for the same day or leave blank for no due date.</p>
          <p className="muted">When you set a rule, every selected criterion must match. Employment is checked for the borrower receiving the request.</p>
          {documentKinds.map((kind) => {
            const item = draft.config.items.find((entry) => entry.kind === kind);
            const editItem = (update: Partial<DocumentTemplateConfig["items"][number]>) =>
              change({ items: draft.config.items.map((entry) => entry.kind === kind ? { ...entry, ...update } : entry) });
            const editRule = (when: DocumentTemplateRule) => editItem({ when: when.occupancy || when.employment ? when : undefined });
            return <div key={kind} className="record-form">
              <label className="demo-confirm"><input type="checkbox" checked={!!item} disabled={busy}
                onChange={(event) => toggleKind(kind, event.target.checked)} /><span>Include {kind.toLowerCase()}</span></label>
              {item && <div className="form-grid">
                <label className="field">{kind} instructions<textarea value={item.instructions} rows={2} maxLength={500} disabled={busy}
                  onChange={(event) => editItem({ instructions: event.target.value })} /></label>
                <label className="field">{kind} deadline days<input type="number" min={0} max={90} step={1} value={item.dueDays ?? ""} disabled={busy}
                  onChange={(event) => editItem({ dueDays: event.target.value === "" ? null : event.target.valueAsNumber })} /></label>
                <label className="field">{kind} occupancy rule<select value={item.when?.occupancy ?? ""} disabled={busy}
                  onChange={(event) => editRule({ ...item.when, occupancy: (event.target.value || undefined) as DocumentTemplateRule["occupancy"] })}>
                  <option value="">Any occupancy</option>
                  {documentTemplateOccupancies.map((option) => <option key={option}>{option}</option>)}
                </select></label>
                <label className="field">{kind} employment rule<select value={item.when?.employment ?? ""} disabled={busy}
                  onChange={(event) => editRule({ ...item.when, employment: (event.target.value || undefined) as DocumentTemplateRule["employment"] })}>
                  <option value="">Any employment</option>
                  {documentTemplateEmployment.map((option) => <option key={option}>{option}</option>)}
                </select></label>
              </div>}
            </div>;
          })}
          <div className="loan-application-actions">
            <Button size="sm" type="submit" disabled={busy || !draft.config.items.length}>Publish checklist</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setDraft(undefined)}>Close editor</Button>
          </div>
        </form>}
      </div>}
    </details>
  </section>;
}

export function ApplyDocumentChecklist({ brokerageId, loanId, customAvailable, requests, applicationReviewRevision, officer, processor, openAssignment, joint, busy, save }: {
  brokerageId: string; loanId: string; customAvailable: boolean; requests: LoanDocumentRequest[];
  applicationReviewRevision: number | null;
  officer: string; processor?: string | null; openAssignment?: () => void; joint: boolean; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const [opened, setOpened] = useState(false);
  const [loaded, setLoaded] = useState<{ page: DocumentTemplatePage; forRevision: number | null }>();
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>(checklistPresetNames[0]);
  const [recipient, setRecipient] = useState<DocumentRecipient>(primaryDocumentRecipient);
  useEffect(() => {
    if (!opened || !customAvailable) return;
    const controller = new AbortController();
    void loadTemplates(brokerageId, { type: "loan", loanId, recipient }, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setLoaded({ page: result, forRevision: applicationReviewRevision }); setError(""); }
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [applicationReviewRevision, brokerageId, customAvailable, loanId, opened, recipient, refresh]);

  const page = loaded?.page;
  const template = customAvailable && page ? page.templates.find(({ id }) => id === selected) : undefined;
  const preset = checklistPresetNames.find((name) => name === selected);
  const rulePreview = !error && loaded?.forRevision === applicationReviewRevision && page?.preview?.recipient === recipient ? page.preview : undefined;
  const conditional = template?.items.some((item) => item.when);
  const items: DocumentTemplateConfig["items"] | undefined = template?.items ??
    (preset ? checklistPresets[preset].map((kind) => ({ kind, instructions: checklistInstructions[kind], dueDays: null })) : undefined);
  const preview = items?.map((item) => ({ ...item, existing: requests.find((request) => request.kind === item.kind && !request.conditionId && documentRecipient(request) === recipient),
    match: template && item.when ? rulePreview?.matches[template.id]?.[item.kind] ?? "Checking reviewed answers" : "Matches",
    dueOn: page ? documentTemplateDueOn(page.asOf, item.dueDays) : null }));
  const missing = preview?.filter((item) => !item.existing && item.match === "Matches").length ?? 0;
  return <details className="document-form" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>Apply a reusable document checklist</summary>
    {opened && <div className="record-form">
      <p className="muted">Preview the requests before adding them. Existing requests keep their dates and instructions.</p>
      <p className="muted">Loan officer · {officer || "Unassigned"}{processor ? ` · Processor · ${processor}` : " · No processor assigned"}</p>
      {openAssignment && <div><Button size="sm" variant="outline" onClick={openAssignment}>Review loan assignment</Button></div>}
      {joint && <label className="field">Checklist recipient<select value={recipient} disabled={busy} onChange={(event) => setRecipient(event.target.value as DocumentRecipient)}>
        {documentRecipients.map((option) => <option key={option}>{option}</option>)}
      </select></label>}
      <label className="field">Checklist<select value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
        <optgroup label="Standard checklists">{checklistPresetNames.map((name) => <option key={name}>{name}</option>)}</optgroup>
        {!!page?.templates.length && customAvailable && <optgroup label="Brokerage templates">{page.templates.map((entry) =>
          <option key={entry.id} value={entry.id}>{entry.title} · v{entry.revision}</option>)}</optgroup>}
        {!template && !preset && <option value={selected}>Unavailable template</option>}
      </select></label>
      {customAvailable && <>
        {error && <p role="alert">{error}</p>}
        {!page && !error && <p role="status">Opening brokerage templates…</p>}
        {page && !page.templates.length && <p className="muted">No brokerage templates match this loan. An admin can publish one from Team.</p>}
        <div><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setLoaded(undefined); setError(""); setRefresh((value) => value + 1); }}>
          Reload templates
        </Button></div>
      </>}
      {conditional && rulePreview?.reviewedRevision != null && <p className="muted">Rules checked against reviewed 1003 revision {rulePreview.reviewedRevision}.</p>}
      {preview && <ul className="document-list" aria-label="Checklist preview">{preview.map((item) => <li key={item.kind} className="document-item">
        <div className="document-item-head"><strong>{item.kind}</strong><span className="pill">
          {item.existing ? "Already on checklist" : item.match === "Matches" ? "Will be requested" : item.match}</span></div>
        {item.when && <p className="muted">Rule · {documentTemplateRuleLabel(item.when)}</p>}
        {!item.existing && item.match === "Matches" && <>
          {item.instructions && <p>{item.instructions}</p>}
          {item.dueOn && <p>Due <time dateTime={item.dueOn}>{dateLabel(item.dueOn)}</time></p>}
        </>}
      </li>)}</ul>}
      {preview && <div><Button size="sm" disabled={busy || !missing || (conditional && !rulePreview)} onClick={() => {
        if (template && page) void save({ type: "applyDocumentTemplate", loanId, templateId: template.id, revision: template.revision, asOf: page.asOf, recipient,
          ...(conditional ? { reviewedRevision: rulePreview?.reviewedRevision } : {}) });
        else if (preset) void save({ type: "applyDocumentPreset", loanId, preset, recipient });
      }}>Add missing requests{missing > 0 ? ` (${missing})` : ""}</Button></div>}
    </div>}
  </details>;
}

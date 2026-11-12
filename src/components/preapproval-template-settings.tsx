"use client";

import { useEffect, useRef, useState } from "react";
import { dateTime } from "@/lib/utils";
import { preapprovalTemplateConfig, type PreapprovalTemplate, type PreapprovalTemplateConfig, type PreapprovalTemplateResult } from "@/lib/preapproval-template-model";
import { preapprovalRequest } from "./preapproval-client";
import { Button } from "./ui/button";

type List = Extract<PreapprovalTemplateResult, { templates: unknown }>;
type History = Extract<PreapprovalTemplateResult, { history: unknown }>;

export function ManagePreapprovalTemplates({ brokerageId }: { brokerageId: string }) {
  const [opened, setOpened] = useState(false);
  const [list, setList] = useState<List>();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<{ id: string; revision: number; config: PreapprovalTemplateConfig }>();
  const [history, setHistory] = useState<History & { template: PreapprovalTemplate }>();
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    void preapprovalRequest(brokerageId, { type: "templateList" }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if ("templates" in result) setList(result);
      else setFeedback({ text: "error" in result ? result.error : "Could not load sample templates.", error: true });
    }).catch(() => {
      if (!controller.signal.aborted) setFeedback({ text: "Could not load sample templates.", error: true });
    });
    return () => controller.abort();
  }, [brokerageId, opened]);
  useEffect(() => { if (feedback) feedbackRef.current?.focus(); }, [feedback]);
  useEffect(() => { if (history) historyHeading.current?.focus(); }, [history]);

  async function run(input: object, success?: string, selected?: PreapprovalTemplate) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await preapprovalRequest(brokerageId, input);
      if ("error" in result) setFeedback({ text: result.error, error: true });
      else if ("templates" in result) {
        setList(result);
        if (success) {
          setDraft(undefined);
          setHistory(undefined);
          setSearch("");
          setFeedback({ text: success });
        }
      } else if (selected && "history" in result) setHistory({ ...result, template: selected });
    } catch {
      setFeedback({ text: "Could not confirm the request. Try again.", error: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <section className="pipeline relationship-panel" aria-label="Sample preapproval templates">
    <h2>Sample preapproval templates</h2>
    <details className="loan-task-create" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
      <summary>Manage sample letter templates</summary>
      {opened && <div className="record-form">
        {feedback && <p ref={feedbackRef} tabIndex={-1} className={feedback.error ? "application-message banner-error" : "application-message"}
          role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
        {!list && !feedback && <p role="status">Opening sample templates…</p>}
        <form className="loan-application-actions" onSubmit={(event) => { event.preventDefault(); void run({ type: "templateList", search }); }}>
          <label className="field">Find a sample template<input value={search} maxLength={64} disabled={busy}
            onChange={(event) => setSearch(event.target.value)} /></label>
          <Button size="sm" variant="outline" type="submit" disabled={busy}>Search templates</Button>
        </form>
        {list && <>
          {list.templates.length > 0 ? <ul className="document-list">{list.templates.map((item) => <li className="document-item" key={item.id}>
            <div className="document-item-head"><strong>{item.title}</strong><span className="pill">
              {item.archived ? "Archived" : `Version ${item.revision}`}</span></div>
            <div className="loan-application-actions">
              {!item.archived && <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                setHistory(undefined); setFeedback(undefined);
                setDraft({ id: item.id, revision: item.revision, config: { title: item.title, note: item.note } });
              }}>Edit template</Button>}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                setDraft(undefined);
                void run({ type: "templateHistory", id: item.id }, undefined, item);
              }}>Version history</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ type: "templateArchive", id: item.id,
                revision: item.revision, archived: !item.archived }, item.archived ? "Sample template restored." : "Sample template archived.")}>
                {item.archived ? "Restore template" : "Archive template"}
              </Button>
            </div>
          </li>)}</ul> : <p className="empty-inline">No brokerage sample templates match.</p>}
          {list.more && <p className="muted">Search by name to find older archived templates.</p>}
          {!draft && <div><Button size="sm" disabled={busy} onClick={() => {
            setHistory(undefined); setFeedback(undefined);
            setDraft({ id: crypto.randomUUID(), revision: 0, config: { title: "", note: "" } });
          }}>New sample template</Button></div>}
        </>}
        {draft && <form className="document-item record-form" aria-label="Sample template editor" onSubmit={(event) => {
          event.preventDefault();
          const config = preapprovalTemplateConfig.safeParse(draft.config);
          if (!config.success) { setFeedback({ text: "Enter a template name and a sample note of up to 180 characters.", error: true }); return; }
          void run({ type: "templatePublish", id: draft.id, revision: draft.revision, config: config.data }, "Sample template published.");
        }}>
          <label className="field">Template name<input autoFocus value={draft.config.title} minLength={3} maxLength={64} required disabled={busy}
            onChange={(event) => setDraft({ ...draft, config: { ...draft.config, title: event.target.value } })} /></label>
          <label className="field">Sample letter note (optional)<textarea rows={3} maxLength={180} disabled={busy} value={draft.config.note}
            onChange={(event) => setDraft({ ...draft, config: { ...draft.config, note: event.target.value } })} /></label>
          <div className="loan-application-actions">
            <Button size="sm" type="submit" disabled={busy}>Publish sample template</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setDraft(undefined)}>Close editor</Button>
          </div>
        </form>}
        {history && <section className="record-form" aria-label="Sample template version history">
          <h3 ref={historyHeading} tabIndex={-1}>{history.template.title} version history</h3>
          <ul className="document-list">{history.history.map((item) => <li className="document-item" key={item.revision}>
            <strong>Version {item.revision} · {item.title}</strong>
            <span className="muted">{item.archived ? "Archived" : "Published"} · {dateTime(item.publishedAt)} ET</span>
            {item.note && <p>{item.note}</p>}
          </li>)}</ul>
          {history.beforeRevision && <div><Button size="sm" variant="outline" disabled={busy}
            onClick={() => void run({ type: "templateHistory", id: history.template.id, beforeRevision: history.beforeRevision }, undefined, history.template)}>
            Older template versions
          </Button></div>}
        </section>}
      </div>}
    </details>
  </section>;
}

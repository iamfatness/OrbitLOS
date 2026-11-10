"use client";

import { useEffect, useRef, useState } from "react";
import { accessBorrowerQuestionSets } from "@/app/actions";
import { borrowerQuestionKinds } from "@/lib/borrower-question-model";
import { questionSetCategories, questionSetDueDate, questionSetItemLimit, questionSetsUnavailable,
  type QuestionSet, type QuestionSetConfig, type QuestionSetPreview, type QuestionSetResult } from "@/lib/borrower-question-set-model";
import type { DocumentRecipient } from "@/lib/document-model";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: () => void) => Promise<void>;
const newQuestion = { prompt: "", kind: "Short answer", dueDays: null } as const;

function useQuestionSets(brokerageId: string, loanId?: string) {
  const [result, setResult] = useState<QuestionSetResult>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    void accessBorrowerQuestionSets(loanId ? { type: "preview", loanId } : { type: "settings" }, brokerageId).then((response) => {
      if (current) setResult(response);
    }).catch(() => { if (current) setResult({ error: questionSetsUnavailable }); });
    return () => { current = false; };
  }, [brokerageId, loanId, refresh]);
  function reload() {
    setResult(undefined);
    setRefresh((value) => value + 1);
  }
  return { result, setResult, reload };
}

function SetEditor({ item, busy, cancel, save }: { item: QuestionSet; busy: boolean; cancel: () => void; save: (config: QuestionSetConfig) => void }) {
  const [items, setItems] = useState(() => item.items.map((question, key) => ({ ...question, key })));
  const nextKey = useRef(item.items.length);
  function change(key: number, update: Partial<QuestionSetConfig["items"][number]>) {
    setItems((current) => current.map((question) => question.key === key ? { ...question, ...update } : question));
  }
  return <form className="record-form document-item" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    save({ title: String(fields.get("title")), category: fields.get("category") as QuestionSetConfig["category"],
      items: items.map(({ prompt, kind, dueDays }) => ({ prompt, kind, dueDays })) });
  }}>
    <div className="form-grid">
      <label className="field">Set title<input name="title" defaultValue={item.title} minLength={3} maxLength={80} required disabled={busy} /></label>
      <label className="field">Category<select name="category" defaultValue={item.category} disabled={busy}>
        {questionSetCategories.map((category) => <option key={category}>{category}</option>)}
      </select></label>
    </div>
    {items.map((question, index) => <fieldset className="document-item" key={question.key} disabled={busy}>
      <legend>Question {index + 1}</legend>
      <label className="field">Borrower prompt<textarea rows={2} minLength={5} maxLength={240} required value={question.prompt}
        onChange={(event) => change(question.key, { prompt: event.target.value })} /></label>
      <div className="form-grid">
        <label className="field">Answer format<select value={question.kind} onChange={(event) =>
          change(question.key, { kind: event.target.value as typeof question.kind })}>
          {borrowerQuestionKinds.map((kind) => <option key={kind}>{kind}</option>)}
        </select></label>
        <label className="field">Default days to answer<input type="number" min={0} max={90} step={1} value={question.dueDays ?? ""}
          onChange={(event) => change(question.key, { dueDays: event.target.value === "" ? null : Number(event.target.value) })} />
          <small className="muted">Leave blank for no deadline.</small></label>
      </div>
      {items.length > 1 && <div><Button type="button" size="sm" variant="ghost"
        onClick={() => setItems((current) => current.filter((candidate) => candidate.key !== question.key))}>Remove question {index + 1}</Button></div>}
    </fieldset>)}
    <div className="loan-application-actions">
      <Button size="sm" type="button" variant="outline" disabled={busy || items.length >= questionSetItemLimit}
        onClick={() => { const key = nextKey.current++; setItems((current) => [...current, { ...newQuestion, key }]); }}>Add question</Button>
      <Button size="sm" type="submit" disabled={busy}>Publish question set</Button>
      <Button size="sm" type="button" variant="ghost" disabled={busy} onClick={cancel}>Cancel edit</Button>
    </div>
  </form>;
}

function QuestionSetSettings({ brokerageId }: { brokerageId: string }) {
  const { result, setResult, reload } = useQuestionSets(brokerageId);
  const [edit, setEdit] = useState<QuestionSet>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function update(input: object, message: string) {
    setBusy(true);
    setNotice("");
    try {
      const response = await accessBorrowerQuestionSets(input, brokerageId);
      if ("error" in response) setNotice(response.error);
      else if (response.kind === "settings") { setResult(response); setEdit(undefined); setNotice(message); }
    } catch {
      setNotice(questionSetsUnavailable);
    } finally {
      setBusy(false);
    }
  }
  return <div className="record-form">
    <p>Save common prompts and suggested deadlines. Staff choose the recipients and dates on each loan.</p>
    {!result && <p role="status">Loading question sets…</p>}
    {result && "error" in result && <p role="status">{result.error}</p>}
    {result && "kind" in result && result.kind === "settings" && <>
      {result.sets.length ? <ul className="document-list">{result.sets.map((item) => <li className="document-item" key={item.id}>
        <div className="document-item-head"><strong>{item.title}</strong><span className="pill">{item.archived ? "Archived" : "Active"} · v{item.revision}</span></div>
        <p className="muted">{item.category} · {item.items.length} {item.items.length === 1 ? "question" : "questions"}</p>
        <div className="loan-application-actions">
          {!item.archived && <Button size="sm" variant="outline" disabled={busy || !!edit} onClick={() => setEdit(item)}>Edit {item.title}</Button>}
          <Button size="sm" variant="ghost" disabled={busy || !!edit} onClick={() => void update({
            type: "archive", id: item.id, revision: item.revision, archived: !item.archived,
          }, item.archived ? "Question set restored." : "Question set archived.")}>{item.archived ? "Restore" : "Archive"} {item.title}</Button>
        </div>
      </li>)}</ul> : <p className="empty-inline">No reusable question sets yet.</p>}
      {result.moreArchived && <p className="muted">Showing all active sets and the first archived sets.</p>}
      {!edit && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => setEdit({
        id: crypto.randomUUID(), title: "", category: "Processing", items: [{ ...newQuestion }], archived: false, revision: 0,
      })}>New question set</Button></div>}
      {edit && <SetEditor key={`${edit.id}:${edit.revision}`} item={edit} busy={busy} cancel={() => setEdit(undefined)}
        save={(config) => void update({ type: "publish", id: edit.id, revision: edit.revision, config }, "Question set published.")} />}
    </>}
    {notice && <p role="status">{notice}</p>}
    {(notice || (result && "error" in result)) && <div><Button size="sm" variant="ghost" disabled={busy}
      onClick={() => { setEdit(undefined); setNotice(""); reload(); }}>Reload question sets</Button></div>}
  </div>;
}

export function ManageBorrowerQuestionSets({ brokerageId }: { brokerageId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="integration manager-panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Borrower question sets</summary>
    {open && <QuestionSetSettings key={brokerageId} brokerageId={brokerageId} />}
  </details>;
}

function SetRequests({ loanId, set, preview, busy, save, onSaved }: {
  loanId: string; set: QuestionSet; preview: QuestionSetPreview; busy: boolean; save: Save; onSaved: () => void;
}) {
  const [choices, setChoices] = useState(() => set.items.map((_, position) => ({
    position, included: true, recipient: preview.recipients[0],
  })));
  const attempt = useRef<{ id: string; payload: string } | null>(null);
  const count = choices.filter(({ included }) => included).length;
  function change(position: number, update: Partial<(typeof choices)[number]>) {
    setChoices((current) => current.map((choice) => choice.position === position ? { ...choice, ...update } : choice));
  }
  return <form className="record-form" onSubmit={(event) => {
    event.preventDefault();
    if (busy || !count || count > preview.remaining) return;
    const form = new FormData(event.currentTarget);
    const input = { type: "applyBorrowerQuestionSet", loanId, setId: set.id, revision: set.revision,
      asOf: preview.asOf, applicationRevision: preview.applicationRevision, items: choices.filter(({ included }) => included)
        .map(({ position, recipient }) => ({ position, recipient, dueOn: String(form.get(`dueOn-${position}`) ?? "") || null })) };
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload) attempt.current = { id: crypto.randomUUID(), payload };
    void save({ ...input, batchId: attempt.current.id }, onSaved);
  }}>
    {choices.map(({ position, included, recipient }) => <div className="document-item" key={position}>
      <label className="demo-confirm"><input type="checkbox" checked={included} disabled={busy}
        onChange={(event) => change(position, { included: event.target.checked })} />Include question {position + 1}</label>
      <p><strong>{set.items[position].prompt}</strong> · {set.items[position].kind}</p>
      <div className="form-grid">
        <label className="field">Recipient for question {position + 1}<select value={recipient} disabled={busy || !included} onChange={(event) =>
          change(position, { recipient: event.target.value as DocumentRecipient })}>
          {preview.recipients.map((option) => <option key={option}>{option}</option>)}
        </select></label>
        <label className="field">Due date for question {position + 1}<input type="date" name={`dueOn-${position}`} min={preview.asOf} max="2199-12-31"
          defaultValue={questionSetDueDate(preview.asOf, set.items[position].dueDays) ?? ""} disabled={busy || !included} /></label>
      </div>
    </div>)}
    {count > preview.remaining && <p role="status">This loan has room for {preview.remaining} more questions. Leave some out before adding the set.</p>}
    <div><Button type="submit" size="sm" disabled={busy || !count || count > preview.remaining}>Add selected questions ({count})</Button></div>
  </form>;
}

function QuestionSetPicker({ brokerageId, loanId, busy, save }: { brokerageId: string; loanId: string; busy: boolean; save: Save }) {
  const { result, reload } = useQuestionSets(brokerageId, loanId);
  const [selectedId, setSelectedId] = useState("");
  const preview = result && "kind" in result && result.kind === "preview" ? result : undefined;
  const selected = preview?.sets.find((set) => set.id === selectedId);
  return <div className="record-form">
    {!result && <p role="status">Loading question sets…</p>}
    {result && "error" in result && <p role="status">{result.error}</p>}
    {preview && (preview.sets.length ? <label className="field">Question set<select value={selected?.id ?? ""} disabled={busy}
      onChange={(event) => setSelectedId(event.target.value)}>
      <option value="">Choose a published set</option>
      {preview.sets.map((set) => <option key={set.id} value={set.id}>{set.title} · {set.category} · v{set.revision}</option>)}
    </select></label> : <p className="empty-inline">No sets are published. Ask a question individually or have an admin publish a set in Playbooks.</p>)}
    {preview && selected && <SetRequests key={`${selected.id}:${selected.revision}:${preview.applicationRevision}:${preview.asOf}`}
      loanId={loanId} set={selected} preview={preview} busy={busy} save={save} onSaved={() => { setSelectedId(""); reload(); }} />}
    {result && <div><Button size="sm" variant="ghost" disabled={busy} onClick={reload}>Refresh question sets</Button></div>}
  </div>;
}

export function LoanBorrowerQuestionSet({ brokerageId, loanId, busy, save }: { brokerageId: string; loanId: string; busy: boolean; save: Save }) {
  const [open, setOpen] = useState(false);
  return <details className="document-form" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Use a question set</summary>
    {open && <QuestionSetPicker key={`${brokerageId}:${loanId}`} brokerageId={brokerageId} loanId={loanId} busy={busy} save={save} />}
  </details>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Calculator } from "lucide-react";
import { primaryDocumentRecipient } from "@/lib/document-model";
import { incomeCompletionIssue, incomeEvidenceLimit, incomeKinds, incomeMethods, incomeSourceLimit, incomeSourceMonthly,
  incomeReviewUnavailable, maxIncomeCents, monthlyWorksheetTotal, type IncomeSource, type IncomeWorksheetPage, type ReviewedIncomeSource } from "@/lib/income-review-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (amount: number) => currency.format(amount / 100);
const newSource = (): IncomeSource => ({ id: crypto.randomUUID(), recipient: primaryDocumentRecipient, label: "", kind: "Wages",
  method: "Monthly amount", included: true, start: "", end: "", amount: null, periods: null, adjustment: 0, rationale: "", evidence: [] });

async function fetchWorksheet(brokerageId: string, input: object, signal?: AbortSignal) {
  const response = await fetch(`/api/income-worksheet?brokerage=${encodeURIComponent(brokerageId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  });
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error(incomeReviewUnavailable);
  const result = await response.json() as { page: IncomeWorksheetPage; message?: string } | { error: string };
  if ("error" in result) throw new Error(result.error);
  if (!response.ok) throw new Error(incomeReviewUnavailable);
  return result;
}

function AmountField({ label, amount, signed, change }: {
  label: string; amount: number | null; signed?: boolean; change: (amount: number | null) => void;
}) {
  const [text, setText] = useState(amount === null ? "" : String(amount / 100));
  return <label className="field">{label}<input type="number" min={signed ? -maxIncomeCents / 100 : 0} max={maxIncomeCents / 100}
    step="0.01" value={text} onChange={(event) => {
      const value = event.target.value;
      setText(value);
      change(value ? Math.round(Number(value) * 100) : null);
    }} /></label>;
}

function SourceEditor({ source, index, page, busy, change, remove }: {
  source: IncomeSource; index: number; page: IncomeWorksheetPage; busy: boolean;
  change: (update: Partial<IncomeSource>) => void; remove: () => void;
}) {
  const evidence = page.eligible.filter((item) => item.recipient === source.recipient);
  return <fieldset className="document-item record-form" disabled={busy}>
    <legend>Income source {index + 1}</legend>
    <div className="form-grid">
      <label className="field">Source name<input value={source.label} maxLength={100} placeholder="Fictional employer or business"
        onChange={(event) => change({ label: event.target.value })} /></label>
      {page.recipients.length > 1 && <label className="field">Borrower<select value={source.recipient} onChange={(event) => {
        change({ recipient: event.target.value as IncomeSource["recipient"], evidence: [] });
      }}>{page.recipients.map((recipient) => <option key={recipient}>{recipient}</option>)}</select></label>}
      <label className="field">Income type<select value={source.kind} onChange={(event) => change({ kind: event.target.value as IncomeSource["kind"] })}>
        {incomeKinds.map((kind) => <option key={kind}>{kind}</option>)}
      </select></label>
      <label className="field">Use in monthly total<select value={source.included ? "Include" : "Exclude"} onChange={(event) => change({ included: event.target.value === "Include" })}>
        <option>Include</option><option>Exclude</option>
      </select></label>
      <label className="field">Period starts<input type="date" name={`start-${source.id}`} defaultValue={source.start} max={page.asOf} /></label>
      <label className="field">Period ends<input type="date" name={`end-${source.id}`} defaultValue={source.end} max={page.asOf} /></label>
      <label className="field">Calculation<select value={source.method} onChange={(event) => change({ method: event.target.value as IncomeSource["method"], periods: null })}>
        {incomeMethods.map((method) => <option key={method}>{method}</option>)}
      </select></label>
      <AmountField label="Source amount in dollars" amount={source.amount} change={(amount) => change({ amount })} />
      {source.method !== "Monthly amount" && <label className="field">{source.method === "Total across months" ? "Months covered" : "Pay periods per year"}
        <input type="number" min={1} max={60} step={1} value={source.periods ?? ""} onChange={(event) => change({ periods: event.target.value ? Number(event.target.value) : null })} />
      </label>}
      <AmountField label="Monthly adjustment in dollars" amount={source.adjustment} signed change={(amount) => change({ adjustment: amount ?? 0 })} />
    </div>
    <label className="field">Source notes or rationale<textarea rows={2} maxLength={400} value={source.rationale}
      onChange={(event) => change({ rationale: event.target.value })} /></label>
    <div className="record-form" aria-label="Accepted income evidence">
      <strong>Accepted income evidence</strong>
      {evidence.length ? evidence.map((item) => {
        const checked = source.evidence.some(({ id }) => id === item.id);
        return <label key={item.id} className="demo-confirm"><input type="checkbox" checked={checked}
          disabled={!checked && source.evidence.length >= incomeEvidenceLimit}
          onChange={(event) => change({ evidence: event.target.checked ? [...source.evidence, { id: item.id, revision: item.revision }]
            : source.evidence.filter(({ id }) => id !== item.id) })} /> {item.label} · Document revision {item.revision}</label>;
      }) : <p className="muted">Accept a pay stub, bank statement, or tax form from this borrower’s checklist.</p>}
    </div>
    <div className="document-item-head"><strong>{source.included ? `${money(incomeSourceMonthly(source))} monthly in draft` : "Excluded from total"}</strong>
      <Button type="button" size="sm" variant="ghost" onClick={remove}>Remove source</Button>
    </div>
  </fieldset>;
}

export function IncomeWorksheet({ brokerageId, loanId, focused, onChanged, onPrice }: {
  brokerageId: string; loanId: string; focused: boolean; onChanged: () => void; onPrice?: (source: ReviewedIncomeSource) => void;
}) {
  const [opened, setOpened] = useState(focused);
  const [page, setPage] = useState<IncomeWorksheetPage>();
  const [sources, setSources] = useState<IncomeSource[]>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const pending = useRef(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    void fetchWorksheet(brokerageId, { type: "read", loanId }, controller.signal).then(({ page: value }) => {
      if (!controller.signal.aborted) setPage(value);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setFeedback({ text: error.message, error: true });
    });
    return () => controller.abort();
  }, [brokerageId, loanId, opened]);

  const record = page?.record;
  const issue = record && page && incomeCompletionIssue(record.sources, page.asOf);
  async function request(input: object, mutate = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const payload = { loanId, ...input };
      const key = JSON.stringify(payload);
      if (mutate && attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      const next = await fetchWorksheet(brokerageId, { ...payload, ...(mutate && { requestId: attempt.current?.id }) });
      setPage(next.page);
      if (next.message) setFeedback({ text: next.message });
      if (mutate) { attempt.current = null; onChanged(); }
      return true;
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : incomeReviewUnavailable, error: true });
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function edit() {
    if (!page) return;
    setFeedback(undefined);
    setSources(record?.sources.map((source) => ({ ...source, evidence: source.evidence.filter((reference) =>
      page.eligible.some((item) => item.id === reference.id && item.revision === reference.revision && item.recipient === source.recipient)) })) ?? [newSource()]);
  }
  function mutate(type: "save" | "submit" | "approve", values: object = {}) {
    if (!page || page.applicationRevision === null) return;
    return request({ type, revision: record?.revision ?? 0, applicationRevision: page.applicationRevision, ...values }, true);
  }

  return <section className="details-section" id="income-worksheet" tabIndex={-1} aria-label="Income worksheet">
    <h3><Calculator size={17} /> Income worksheet</h3>
    <details className="document-form" open={focused || undefined}>
      <summary onClick={() => setOpened(true)}>Review sample income and evidence</summary>
      <div className="record-form">
        <p className="muted">Record source periods, amounts, and accepted evidence for a fictional loan. An approved worksheet can supply the monthly income input for conventional mock pricing.</p>
        {feedback && <p className="application-message" role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
        {!page && !feedback && <p role="status">Opening income worksheet…</p>}
        {page && <>
          {page.applicationRevision === null ? <p className="muted">A submitted fictional 1003 is needed before assembling the worksheet.</p> :
            <p className="muted">1003 revision {page.applicationRevision} · {page.declared.map(({ recipient, amount }) =>
              `${recipient} reported ${amount === null ? "no amount" : `${money(amount)} monthly`}`).join(" · ")}</p>}
          {record && <div className="document-item">
            <div className="document-item-head"><strong>{money(record.amount)} monthly · Worksheet v{record.revision}</strong>
              <span className="pill">{page.stale ?? record.stage}</span></div>
            <p className="muted">1003 revision {record.applicationRevision} · {record.updatedBy} · {dateTime(record.updatedAt)} ET</p>
            {record.note && <p>{record.note}</p>}
            <ul>{record.sources.map((source) => <li key={source.id}>
              {source.label || "Unnamed source"} · {source.recipient} · {source.kind} · {source.included ? `${money(incomeSourceMonthly(source))} monthly` : "Excluded"}
              {source.start && source.end && ` · ${source.start} to ${source.end}`}
              {source.rationale && <p className="muted">{source.rationale}</p>}
              {source.evidence.map((reference) => {
                const evidence = record.evidence.find(({ id }) => id === reference.id);
                return <p className="muted" key={reference.id}>{evidence?.label ?? "Document"} · Document revision {reference.revision}</p>;
              })}
            </li>)}</ul>
          </div>}
          {page.stale && <p className="quote-disclaimer">Review the updated file and save a new version before using worksheet income in pricing.</p>}
          {sources ? <form method="post" className="record-form" aria-label="Income source editor" onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            const updated = sources.map((source) => ({ ...source, start: String(fields.get(`start-${source.id}`) ?? ""),
              end: String(fields.get(`end-${source.id}`) ?? "") }));
            void mutate("save", { sources: updated })?.then((saved) => { if (saved) setSources(undefined); });
          }}>
            {sources.map((source, index) => <SourceEditor key={source.id} source={source} index={index} page={page} busy={busy}
              change={(update) => setSources((list) => list?.map((item) => item.id === source.id ? { ...item, ...update } : item))}
              remove={() => setSources((list) => list?.filter((item) => item.id !== source.id))} />)}
            <p><strong>Draft total {money(monthlyWorksheetTotal(sources))} monthly</strong></p>
            <div className="loan-application-actions">
              <Button size="sm" variant="outline" type="button" disabled={busy || sources.length >= incomeSourceLimit}
                onClick={() => setSources([...sources, newSource()])}>Add income source</Button>
              <Button size="sm" type="submit" disabled={busy}>Save income draft</Button>
              <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => setSources(undefined)}>Cancel edit</Button>
            </div>
          </form> : <>
            <div className="loan-application-actions">
              {page.canEdit && <Button size="sm" variant="outline" type="button" disabled={busy} onClick={edit}>
                {page.stale ? "Start updated worksheet" : record ? "Edit worksheet" : "Start income worksheet"}
              </Button>}
              {page.canEdit && record?.stage === "Draft" && !page.stale &&
                <Button size="sm" type="button" disabled={busy || !!issue} onClick={() => void mutate("submit")}>Send income for review</Button>}
              {onPrice && record?.stage === "Approved" && !page.stale &&
                <Button size="sm" type="button" disabled={busy} onClick={() => onPrice(record)}>Price with reviewed income</Button>}
              <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => void request({ type: "read" })}>Refresh income worksheet</Button>
            </div>
            {record?.stage === "Draft" && !page.stale && issue && <p className="muted">{issue}</p>}
            {record?.stage === "Ready for review" && !page.stale && (page.canApprove && page.canEdit && page.reviewed ?
              <form className="record-form" aria-label="Approve income worksheet" onSubmit={(event) => {
                event.preventDefault();
                void mutate("approve", { note: new FormData(event.currentTarget).get("note") });
              }}>
                <label className="field">Review rationale<textarea name="note" maxLength={400} rows={2} required disabled={busy} /></label>
                <div><Button size="sm" type="submit" disabled={busy}>Approve sample income</Button></div>
              </form> : <p className="muted">The loan officer or an admin can approve the worksheet once the current 1003 is reviewed.</p>)}
          </>}
          {page.history.length > 0 && <details className="document-form"><summary>Previous worksheet versions</summary>
            <ul className="loan-task-list">{page.history.map((entry) => <li key={entry.revision}>
              v{entry.revision} · {entry.stage} · {money(entry.amount)} monthly · {entry.updatedBy} · {dateTime(entry.updatedAt)} ET
              {entry.note && <p className="muted">{entry.note}</p>}
            </li>)}</ul>
          </details>}
        </>}
      </div>
    </details>
  </section>;
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { saveProcessingView } from "@/app/actions";
import type { ProcessorFeeInput, ProcessorFeePage, ProcessorFeeTerms } from "@/lib/processor-fee-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function FeeVersion({ terms }: { terms: ProcessorFeeTerms }) {
  return <>
    <p><strong>{usd.format(terms.amountCents / 100)}</strong> · v{terms.version} · {terms.status}
      {terms.endedReason && ` · ${terms.endedReason}`}</p>
    <p className="break-words">{terms.processorName} · Reference {terms.reference}</p>
    <p className="muted">Recorded by {terms.offeredBy} · {dateTime(terms.offeredAt)} ET
      {terms.decidedAt && ` · Decision ${dateTime(terms.decidedAt)} ET`}</p>
  </>;
}

export function ProcessorFees({ loanId, brokerageId, assignmentRevision }: {
  loanId: string; brokerageId: string; assignmentRevision?: number;
}) {
  const [started, setStarted] = useState(false);
  const [page, setPage] = useState<ProcessorFeePage>();
  const [readError, setReadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [draft, setDraft] = useState<{ amount: string; reference: string; basis: string }>();
  const attempt = useRef<{ id: string; fields: string }>(null);
  const pending = useRef(false);
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!started) return;
    let active = true;
    const fail = "Could not open processing fee terms. Refresh to try again.";
    void saveProcessingView({ type: "readFeeTerms", loanId }, brokerageId).then(result => {
      if (!active) return;
      if ("kind" in result && result.kind === "processorFeeTerms") {
        setPage(result);
        setReadError("");
      } else {
        setPage(undefined);
        setReadError("error" in result ? result.error : fail);
      }
    }, () => { if (active) { setPage(undefined); setReadError(fail); } });
    return () => { active = false; };
  }, [started, refresh, loanId, brokerageId, assignmentRevision]);

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
  }, [feedback]);

  const basis = JSON.stringify([page?.assignment?.revision, page?.latestVersion]);
  const stale = Boolean(draft && draft.basis !== basis);

  async function change(input: ProcessorFeeInput) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await saveProcessingView(input, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (!("message" in result)) throw new Error("Could not confirm this change. Try again.");
      setFeedback({ text: result.message });
      if (input.type === "offerFeeTerms") {
        setDraft(undefined);
        attempt.current = null;
      }
      setRefresh(value => value + 1);
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Could not confirm this change. Try again.", error: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!page?.canOffer || !page.assignment || !draft || stale) return;
    const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(draft.amount.trim());
    const reference = draft.reference.trim();
    if (!match || !reference) {
      setFeedback({ text: "Enter a dollar amount with up to two decimal places and an agreement reference.", error: true });
      return;
    }
    const amountCents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
    const payload = { type: "offerFeeTerms" as const, loanId, amountCents, reference,
      expectedVersion: page.latestVersion, assignmentRevision: page.assignment.revision };
    const fields = JSON.stringify(payload);
    if (attempt.current?.fields !== fields) attempt.current = { fields, id: crypto.randomUUID() };
    void change({ ...payload, requestId: attempt.current.id });
  }

  async function loadOlder() {
    if (!page?.next || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await saveProcessingView({ type: "readFeeTerms", loanId, before: page.next }, brokerageId);
      if (!("kind" in result) || result.kind !== "processorFeeTerms") throw new Error("error" in result ? result.error : "Could not open earlier terms.");
      setPage({ ...result, history: [...page.history, ...result.history] });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Could not open earlier terms. Try again.", error: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <details className="document-form" onToggle={event => { if (event.currentTarget.open) setStarted(true); }}>
    <summary>Processing fee terms</summary>
    {started && <section className="record-form" aria-label="Processing fee terms">
      <p className="muted">Record what the brokerage and assigned processor agreed for this file.</p>
      <div><Button size="sm" variant="outline" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh fee terms</Button></div>
      {readError ? <p role="alert">{readError}</p> : !page && <p role="status">Loading fee terms…</p>}
      {feedback && <p tabIndex={-1} ref={feedbackRef} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      {page && <>
        {!page.assignment && <p>Assign a processor to record a fee offer.</p>}
        {page.assignment && !page.current && <p>No fee terms recorded for {page.assignment.name}.</p>}
        {page.agreed && page.agreed.version !== page.current?.version && <article className="document-item" aria-label="Agreed fee terms">
          <h4>Agreed fee</h4><FeeVersion terms={page.agreed} />
        </article>}
        {page.current && <article className="document-item" aria-label="Latest fee terms">
          <h4>{page.current.status === "Accepted" ? "Agreed fee" : "Latest offer"}</h4>
          <FeeVersion terms={page.current} />
          {page.canRespond && <div className="loan-application-actions">
            {(["Accepted", "Declined"] as const).map(response => <Button size="sm" key={response}
              variant={response === "Accepted" ? "default" : "outline"} disabled={busy} onClick={() => {
                if (page.current) void change({ type: "respondFeeTerms", loanId, version: page.current.version, response });
              }}>{response === "Accepted" ? "Accept fee terms" : "Decline fee terms"}</Button>)}
          </div>}
        </article>}
        {page.canOffer && <form className="record-form" onSubmit={submit} aria-label="Record fee offer">
          <label className="field">Processing fee (USD)<input inputMode="decimal" maxLength={10} required disabled={busy}
            value={draft?.amount ?? ""} onChange={event => setDraft({ amount: event.target.value, reference: draft?.reference ?? "", basis: draft?.basis ?? basis })} /></label>
          <label className="field">Agreement reference<textarea required rows={3} maxLength={180} disabled={busy}
            value={draft?.reference ?? ""} onChange={event => setDraft({ reference: event.target.value, amount: draft?.amount ?? "", basis: draft?.basis ?? basis })} /></label>
          {stale && <p role="status">The assignment or version changed. Review the current terms before using your draft.</p>}
          <div className="loan-application-actions">
            {stale && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() =>
              setDraft(value => value ? { ...value, basis } : value)}>Use draft with current terms</Button>}
            <Button type="submit" size="sm" disabled={busy || stale}>{page.latestVersion ? "Record new fee version" : "Record fee offer"}</Button>
          </div>
        </form>}
        {!!page.history.length && <details className="document-form">
          <summary>Earlier fee versions</summary>
          <ul className="document-list">{page.history.map(terms => <li key={terms.version} className="document-item"><FeeVersion terms={terms} /></li>)}</ul>
          {page.next && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void loadOlder()}>Show earlier versions</Button></div>}
        </details>}
      </>}
    </section>}
  </details>;
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { dateLabel } from "@/lib/client-retention";
import { preapprovalAmount } from "@/lib/preapproval-model";
import { preapprovalPolicyConfig, samplePreapprovalTarget, type PreapprovalPolicyResult } from "@/lib/preapproval-policy-model";
import { preapprovalRequest } from "./preapproval-client";
import { Button } from "./ui/button";

type Draft = { amount: string; days: string; requireApproval: boolean; revision: number };

export function ManagePreapprovalPolicy({ brokerageId, openLoan }: {
  brokerageId: string; openLoan: (id: string, target: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [data, setData] = useState<PreapprovalPolicyResult>();
  const [draft, setDraft] = useState<Draft>();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const pending = useRef(false);
  const appliedSearch = useRef("");
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const queueHeading = useRef<HTMLHeadingElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreEditFocus = useRef(false);

  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    void preapprovalRequest(brokerageId, { type: "policyRead", search: appliedSearch.current }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if ("policy" in result) setData(result);
      else setFeedback({ text: "error" in result ? result.error : "Could not load sample letter policy.", error: true });
    }).catch(() => {
      if (!controller.signal.aborted) setFeedback({ text: "Could not load sample letter policy. Refresh to retry.", error: true });
    });
    return () => controller.abort();
  }, [brokerageId, opened]);
  useEffect(() => { if (feedback) feedbackRef.current?.focus(); }, [feedback]);
  const editing = Boolean(draft);
  useEffect(() => {
    if (editing) amountInput.current?.focus();
    else if (restoreEditFocus.current) {
      restoreEditFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  async function run(input: object, intent: "save" | "refresh" | "filter", requestedSearch = "") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await preapprovalRequest(brokerageId, input);
      if ("error" in result) { setFeedback({ text: result.error, error: true }); return; }
      if (!("policy" in result)) { setFeedback({ text: "Could not confirm the policy. Refresh to retry.", error: true }); return; }
      setData(result);
      appliedSearch.current = requestedSearch;
      if (intent === "save") {
        setSearch("");
        setDraft(undefined);
        setFeedback({ text: "Sample letter policy saved." });
      } else if (intent === "refresh") {
        setDraft((prior) => prior && { ...prior, revision: result.policy.revision });
        setFeedback({ text: "Policy and pending reviews refreshed." });
      } else queueHeading.current?.focus();
    } catch {
      setFeedback({ text: "Could not confirm the request. Try again.", error: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const config = preapprovalPolicyConfig.safeParse({
      maxAmountCents: draft.amount ? Math.round(Number(draft.amount) * 100) : null,
      maxExpiryDays: Number(draft.days),
      requireApproval: draft.requireApproval,
    });
    if (!config.success) { setFeedback({ text: "Check the amount and expiry limits.", error: true }); return; }
    void run({ type: "policySave", revision: draft.revision, config: config.data }, "save");
  }

  return <section className="pipeline relationship-panel" aria-label="Sample preapproval policy">
    <h2>Sample preapproval policy</h2>
    <details className="loan-task-create" onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary>Issuance limits and sharing approval</summary>
      {opened && <div className="record-form">
        {!data && !feedback && <p role="status" className="muted">Loading sample letter policy…</p>}
        {feedback && <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
        {data && <div className="record-form">
          <p>{data.policy.maxAmountCents ? preapprovalAmount(data.policy.maxAmountCents) + " maximum" : "Reviewed 1003 amount"} · {data.policy.maxExpiryDays} {data.policy.maxExpiryDays === 1 ? "day" : "days"} maximum</p>
          <p className="muted">{data.policy.requireApproval ? "Independent admin approval required before portal sharing." : "Staff can share an eligible letter without a separate approval."}</p>
        </div>}
        {draft && <form className="record-form preapproval-issue preapproval-policy-editor" aria-label="Sample letter policy editor" onSubmit={save}>
          <div className="form-grid">
            <label className="field">Maximum sample amount (optional)<input ref={amountInput} type="number" min="0.01" max="1000000000" step="0.01"
              inputMode="decimal" value={draft.amount} disabled={busy} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
            <label className="field">Maximum expiry (days)<input type="number" min="1" max="60" step="1" inputMode="numeric"
              value={draft.days} disabled={busy} required onChange={(event) => setDraft({ ...draft, days: event.target.value })} /></label>
          </div>
          <label className="demo-confirm"><input type="checkbox" checked={draft.requireApproval} disabled={busy}
            onChange={(event) => setDraft({ ...draft, requireApproval: event.target.checked })} />
            <span>Require approval from a brokerage admin other than the issuer before portal sharing.</span></label>
          <div className="loan-application-actions">
            <Button size="sm" type="submit" disabled={busy}>{busy ? "Saving…" : "Save sample letter policy"}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => {
              restoreEditFocus.current = true;
              setDraft(undefined);
            }}>Cancel</Button>
          </div>
        </form>}
        <div className="loan-application-actions">
          {data && !draft && <Button ref={editButton} size="sm" disabled={busy} onClick={() => setDraft({
            amount: data.policy.maxAmountCents === null ? "" : String(data.policy.maxAmountCents / 100), days: String(data.policy.maxExpiryDays),
            requireApproval: data.policy.requireApproval, revision: data.policy.revision,
          })}>Edit policy</Button>}
          {(data || feedback) && <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void run({ type: "policyRead", search: appliedSearch.current }, "refresh", appliedSearch.current)}>Refresh policy and reviews</Button>}
        </div>
        {data?.policy.requireApproval && <section className="record-form" aria-label="Sample letters awaiting approval">
          <h3 ref={queueHeading} tabIndex={-1}>Sample letters awaiting approval</h3>
          <form className="record-form" onSubmit={(event) => { event.preventDefault(); void run({ type: "policyRead", search }, "filter", search); }}>
            <label className="field">Borrower or issuer<input type="search" maxLength={100} value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} /></label>
            <div className="loan-application-actions"><Button type="submit" size="sm" variant="outline" disabled={busy}>Find letters</Button></div>
          </form>
          {data.pending.length ? <ul className="loan-task-list">{data.pending.map((letter) => <li key={letter.loanId} className="loan-task">
            <div className="loan-task-copy"><strong>{letter.borrower}</strong>
              <span>Letter v{letter.version} · {preapprovalAmount(letter.amountCents)} · Expires {dateLabel(letter.expiresOn)}</span>
              <span>Issued by {letter.issuer}</span></div>
            <Button size="sm" variant="outline" onClick={() => openLoan(letter.loanId, samplePreapprovalTarget)}>Open letter</Button>
          </li>)}</ul> : <p className="empty-inline">No matching letters awaiting approval.</p>}
          {data.after && <div className="loan-application-actions">
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => void run({ type: "policyRead", search: appliedSearch.current, after: data.after }, "filter", appliedSearch.current)}>More letters</Button>
          </div>}
        </section>}
      </div>}
    </details>
  </section>;
}

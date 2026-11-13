"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessBrokerageFinance } from "@/app/actions";
import { financeMoney, type FinanceInput, type FinanceLoan, type SettlementFeed as Feed } from "@/lib/brokerage-finance-model";
import { dateLabel } from "@/lib/client-retention";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function SettlementFeed({ brokerageId, loan, onImported }: {
  brokerageId: string; loan: FinanceLoan; onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<Feed>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const { id: loanId, cycle, date } = loan;
  const earlierFundingDate = feed?.checkedFundingDate && feed.checkedFundingDate !== date ? feed.checkedFundingDate : null;

  useEffect(() => {
    if (!open) return;
    let current = true;
    void accessBrokerageFinance({ type: "settlementFeed", loanId, cycle }, brokerageId).then(result => {
      if (!current) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "settlementFeed") setFeed(result);
    }, () => { if (current) setError("Could not load provider deliveries. Try again."); });
    return () => { current = false; };
  }, [open, loanId, cycle, date, brokerageId, refresh]);

  async function save(input: FinanceInput) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await accessBrokerageFinance(input, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "settlementFeed") {
        setFeed(result);
        setMessage(input.type === "pullSettlementFeed" ? "Provider deliveries checked." :
          input.type === "matchSettlementFeed" ? "Wire matched to this funding cycle." : "Review recorded.");
        if (input.type === "pullSettlementFeed" || input.type === "matchSettlementFeed") onImported();
      }
    } catch {
      setError("Could not confirm the result. Retry to check the saved deliveries.");
    } finally {
      pending.current = false;
      setBusy(false);
      requestAnimationFrame(() => feedback.current?.focus());
    }
  }

  function review(event: FormEvent<HTMLFormElement>, evidenceId: string) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const note = String(new FormData(event.currentTarget).get("note") ?? "");
    void save(submitter?.getAttribute("value") === "match"
      ? { type: "matchSettlementFeed", loanId, cycle, fundingDate: date, evidenceId, note }
      : { type: "reviewSettlementFeed", loanId, cycle, evidenceId, note });
  }

  return <details className="document-form" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 content-center">Simulated settlement provider</summary>
    {open && <div className="record-form">
      <div ref={feedback} tabIndex={-1}>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
      {!feed && !error && <p role="status">Loading provider deliveries…</p>}
      {!feed && error && <div><Button size="sm" variant="outline" className="min-h-11"
        onClick={() => { setError(""); setRefresh(value => value + 1); }}>Retry loading deliveries</Button></div>}
      {feed && <>
        {earlierFundingDate && <p className="application-message" role="status">
          Provider deliveries were checked for {dateLabel(earlierFundingDate)}. The recorded funding date is now {dateLabel(date)}.
          Compare the saved deliveries before reviewing the corrected settlement.
        </p>}
        {!loan.reversedAt && !earlierFundingDate && <div><Button size="sm" className="min-h-11" disabled={busy}
          onClick={() => void save({ type: "pullSettlementFeed", loanId, cycle, fundingDate: loan.date })}>
          {busy ? "Checking…" : feed.rows.length ? "Check provider again" : "Pull sample evidence"}</Button></div>}
        {feed.rows.length === 0 ? <p className="muted">No deliveries recorded for this cycle.</p> :
          <ul className="document-list">{feed.rows.map((row, index) => <li className="document-item break-words" key={`${row.evidenceId}:${index}`}>
            <div className="document-item-head"><strong>{row.kind} · {financeMoney(row.amountCents)}</strong><span className="pill">{row.status}</span></div>
            <p>{row.detail}</p>
            <p className="muted">Funding reference {row.fundingReference} · Evidence {row.evidenceId}</p>
            {row.reviewedAt && <p>{row.reviewNote} · {row.reviewedBy} · {dateTime(row.reviewedAt)} ET</p>}
            {row.status === "Needs review" && !loan.reversedAt && !earlierFundingDate && <form className="record-form" onSubmit={event => review(event, row.evidenceId)}>
              {row.canMatch && <p>Confirm the wire belongs to cycle {cycle}, funded {dateLabel(date)}, before adding {financeMoney(row.amountCents)} to received proceeds.</p>}
              <label className="field">Review note (required)<textarea name="note" rows={2} minLength={5} maxLength={280} required disabled={busy} /></label>
              <div className="loan-application-actions">
                <Button size="sm" type="submit" variant="outline" className="min-h-11" disabled={busy}>Keep out of this cycle</Button>
                {row.canMatch && <Button size="sm" type="submit" value="match" className="min-h-11" disabled={busy}>Match wire to this cycle</Button>}
              </div>
            </form>}
          </li>)}</ul>}
      </>}
    </div>}
  </details>;
}

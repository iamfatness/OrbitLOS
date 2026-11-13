"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessBrokerageFinance } from "@/app/actions";
import { financeMoney, type FinanceInput, type FinanceLoan, type SettlementDestination, type SettlementFeed as Feed } from "@/lib/brokerage-finance-model";
import { dateLabel } from "@/lib/client-retention";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function SettlementFeed({ brokerageId, loan, onImported, openCycle }: {
  brokerageId: string; loan: FinanceLoan; onImported: () => void; openCycle: (id: string, cycle: number) => void;
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
          input.type === "matchSettlementFeed" ? input.destination ? "Wire matched to the selected funding cycle." : "Wire matched to this funding cycle." : "Review recorded.");
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
            {row.destination && <div><Button size="sm" variant="outline" className="min-h-11"
              onClick={() => openCycle(row.destination!.id, row.destination!.cycle)}>Open {row.destination.borrower} · cycle {row.destination.cycle}</Button></div>}
            {row.status === "Needs review" && !loan.reversedAt && !earlierFundingDate &&
              <DeliveryReview brokerageId={brokerageId} loan={loan} row={row} busy={busy} save={save} />}
          </li>)}</ul>}
      </>}
    </div>}
  </details>;
}

function DeliveryReview({ brokerageId, loan, row, busy, save }: {
  brokerageId: string; loan: FinanceLoan; row: Feed["rows"][number]; busy: boolean; save: (input: FinanceInput) => void;
}) {
  const [results, setResults] = useState<{ rows: SettlementDestination[]; more: boolean }>();
  const [destination, setDestination] = useState<SettlementDestination>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const target = { loanId: loan.id, cycle: loan.cycle, evidenceId: row.evidenceId };
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = String(new FormData(event.currentTarget).get("search") ?? "");
    setSearching(true);
    setError("");
    setDestination(undefined);
    setResults(undefined);
    try {
      const result = await accessBrokerageFinance({ type: "findSettlementDestination", loanId: loan.id, cycle: loan.cycle, search: term }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "settlementDestinations") setResults(result);
    } catch {
      setError("Could not find funding cycles. Try the search again.");
    } finally {
      setSearching(false);
    }
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    const note = String(new FormData(event.currentTarget).get("note") ?? "");
    if (action === "route" && !destination) return;
    save(action === "match" || action === "route"
        ? { type: "matchSettlementFeed", ...target, fundingDate: loan.date, note,
        ...(action === "route" ? { destination } : {}) }
      : { type: "reviewSettlementFeed", ...target, note });
  }
  return <>
    {row.canMatch && <details className="document-form">
      <summary className="min-h-11 content-center">Find a different funding cycle</summary>
      <form className="record-form" onSubmit={search}>
        <label className="field">Borrower name or loan ID<input name="search" required minLength={2} maxLength={160} /></label>
        <div><Button size="sm" type="submit" variant="outline" className="min-h-11" disabled={searching || busy}>Search funded loans</Button></div>
      </form>
      {searching && <p role="status">Searching funded loans…</p>}
      {error && <p role="alert">{error}</p>}
      {results && (results.rows.length ? <label className="field">Destination funding cycle
        <select value={destination?.id ?? ""} onChange={event => setDestination(results.rows.find(candidate => candidate.id === event.target.value))}>
          <option value="">Choose a funding cycle</option>
          {results.rows.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.borrower} · Cycle {candidate.cycle} · {dateLabel(candidate.date)} · {candidate.id}</option>)}
        </select>
        {results.more && <span>Showing 10 matches. Refine the search or enter the exact loan ID.</span>}
      </label> : <p role="status">No other funded loans match that search.</p>)}
    </details>}
    <form className="record-form" onSubmit={review}>
      {row.canMatch && <p>{destination
        ? `Add ${financeMoney(row.amountCents)} to ${destination.borrower} · cycle ${destination.cycle}, funded ${dateLabel(destination.date)}.`
        : `Confirm the wire belongs to cycle ${loan.cycle}, funded ${dateLabel(loan.date)}, before adding ${financeMoney(row.amountCents)} to received proceeds.`}</p>}
      <label className="field">Review note (required)<textarea name="note" rows={2} minLength={5} maxLength={280} required disabled={busy} /></label>
      <div className="loan-application-actions">
        <Button size="sm" type="submit" variant="outline" className="min-h-11" disabled={busy}>Keep out of this cycle</Button>
        {row.canMatch && <Button size="sm" type="submit" value={destination ? "route" : "match"} className="min-h-11" disabled={busy}>
          {destination ? "Match wire to selected cycle" : "Match wire to this cycle"}
        </Button>}
      </div>
    </form>
  </>;
}

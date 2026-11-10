"use client";

import { useState, type FormEvent } from "react";
import { financeInputCents, financeMoney, inputDollars, type SettlementChange, type SettlementEntry,
  type SettlementWork } from "@/lib/brokerage-finance-model";
import { dateLabel } from "@/lib/client-retention";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Save = (change: SettlementChange, after?: () => void) => void;
const limit = 5_000_000_000;
const labels = {
  settlementAdvice: "Purchase advice", settlementReceipt: "Sample receipt",
  settlementReverse: "Receipt reversal", settlementReview: "Settlement review",
} as const;

function SettlementHistoryItem({ entry, today, active, busy, save }: {
  entry: SettlementEntry; today: string; active: boolean; busy: boolean; save: Save;
}) {
  const { input } = entry;
  const receipt = input.type === "settlementReceipt" ? input : null;
  return <li className="document-item">
    <div className="document-item-head"><strong>{labels[input.type]}{"reference" in input && ` · ${input.reference}`}</strong>
      {entry.amountCents !== null && <span className="pill">{input.type === "settlementReview" ? "Difference " : ""}{financeMoney(entry.amountCents)}</span>}</div>
    <p className="muted">{entry.actorName} · {dateTime(entry.at)} ET{"occurredOn" in input && ` · Evidence dated ${dateLabel(input.occurredOn)}`}</p>
    {input.type === "settlementAdvice" && <p>Gross {financeMoney(input.grossCents)} · Fees {financeMoney(input.feesCents)} · Adjustment {financeMoney(input.adjustmentCents)}</p>}
    {input.note && <p>{input.note}</p>}
    {entry.reversed && <span className="pill">Reversed</span>}
    {active && receipt && !entry.reversed && <details className="document-form"><summary>Reverse sample receipt</summary>
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        save({ type: "settlementReverse", originalId: entry.id, occurredOn: String(fields.get("date")), note: String(fields.get("note")) });
      }}>
        <label className="field">Sample reversal date<input name="date" type="date" min={receipt.occurredOn} max={today} defaultValue={today} required /></label>
        <label className="field">Sample reversal reason<textarea name="note" rows={2} maxLength={280} required /></label>
        <div><Button type="submit" size="sm" variant="outline" disabled={busy}>Record sample reversal</Button></div>
      </form>
    </details>}
  </li>;
}

export function SettlementReconciliation({ work, today, active, busy, save, currentPage, onPage }: {
  work: SettlementWork; today: string; active: boolean; busy: boolean; save: Save; currentPage: boolean; onPage: (before?: number) => void;
}) {
  const [error, setError] = useState("");
  const { advice } = work;
  function recordAdvice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const gross = financeInputCents(fields.get("gross"), limit);
    const fees = financeInputCents(fields.get("fees"), limit);
    const adjustment = financeInputCents(fields.get("adjustment"), limit, true);
    if (!gross || fees === undefined || adjustment === undefined) { setError("Enter a positive gross amount and use up to two decimal places."); return; }
    setError("");
    save({ type: "settlementAdvice", grossCents: gross, feesCents: fees ?? 0, adjustmentCents: adjustment ?? 0,
      occurredOn: String(fields.get("date")), reference: String(fields.get("reference")), note: String(fields.get("note")) });
  }
  function recordReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const amountCents = financeInputCents(fields.get("amount"), limit);
    if (!amountCents) { setError("Enter a positive receipt amount with up to two decimal places."); return; }
    setError("");
    save({ type: "settlementReceipt", amountCents, occurredOn: String(fields.get("date")),
      reference: String(fields.get("reference")), note: String(fields.get("note")) }, () => form.reset());
  }
  return <section className="document-item record-form" aria-label="Sample settlement reconciliation">
    <div className="document-item-head"><h4>Sample settlement reconciliation</h4><span className="pill">{active ? work.status : `Archived · ${work.status}`}</span></div>
    <p className="muted">Compare fictional purchase advice with recorded receipts for this funding cycle. These amounts are separate from brokerage compensation.</p>
    <dl className="metrics finance-metrics">
      <div><dt>Expected net proceeds</dt><dd>{financeMoney(work.expectedCents)}</dd></div>
      <div><dt>Recorded settlement receipts</dt><dd>{financeMoney(work.receivedCents)}</dd></div>
      <div><dt>Expected less recorded</dt><dd>{financeMoney(work.differenceCents)}</dd></div>
    </dl>
    {advice && <p>Advice {advice.reference} · {dateLabel(advice.occurredOn)} · Gross {financeMoney(advice.grossCents)} · Fees {financeMoney(advice.feesCents)} · Adjustment {financeMoney(advice.adjustmentCents)}</p>}
    {error && <p role="alert">{error}</p>}
    {active && <>
      <details className="document-form"><summary>{advice ? "Record corrected purchase advice" : "Record sample purchase advice"}</summary>
        <form className="record-form" onSubmit={recordAdvice} key={advice?.entryId ?? "initial"}>
          <div className="form-grid">
            <label className="field">Advice reference<input name="reference" defaultValue={advice?.reference} maxLength={120} required /></label>
            <label className="field">Advice date<input name="date" type="date" defaultValue={advice?.occurredOn ?? today} max={today} required /></label>
            <label className="field">Gross proceeds (USD)<input name="gross" inputMode="decimal" maxLength={15} defaultValue={inputDollars(advice?.grossCents ?? null)} required /></label>
            <label className="field">Fees (USD)<input name="fees" inputMode="decimal" maxLength={15} defaultValue={inputDollars(advice?.feesCents ?? null)} /></label>
            <label className="field">Adjustment (USD)<input name="adjustment" inputMode="decimal" maxLength={15} defaultValue={inputDollars(advice?.adjustmentCents ?? null)} /></label>
          </div>
          <label className="field">{advice ? "Reason for corrected advice" : "Advice note (optional)"}<textarea name="note" rows={2} maxLength={280} required={Boolean(advice)} /></label>
          <div><Button type="submit" size="sm" disabled={busy}>Save sample purchase advice</Button></div>
        </form>
      </details>
      <details className="document-form"><summary>Record sample settlement receipt</summary>
        <form className="record-form" onSubmit={recordReceipt}>
          <div className="form-grid">
            <label className="field">Settlement receipt reference<input name="reference" maxLength={120} required /></label>
            <label className="field">Settlement receipt date<input name="date" type="date" defaultValue={today} max={today} required /></label>
            <label className="field">Settlement receipt amount (USD)<input name="amount" inputMode="decimal" maxLength={15} required /></label>
          </div>
          <label className="field">Receipt note (optional)<textarea name="note" rows={2} maxLength={280} /></label>
          <div><Button type="submit" size="sm" disabled={busy}>Save sample settlement receipt</Button></div>
        </form>
      </details>
      {advice && work.receiptCount > 0 && !work.reviewed && <details className="document-form"><summary>Review sample settlement</summary>
        <form className="record-form" onSubmit={(event) => {
          event.preventDefault();
          save({ type: "settlementReview", note: String(new FormData(event.currentTarget).get("note")) });
        }}>
          <p>{work.differenceCents ? "Record why you reviewed the difference. The amount stays visible." : "Expected and recorded proceeds match."}</p>
          <label className="field">Settlement review note<textarea name="note" rows={2} maxLength={280} required={Boolean(work.differenceCents)} /></label>
          <div><Button type="submit" size="sm" disabled={busy}>{work.differenceCents ? "Record difference review" : "Confirm sample settlement match"}</Button></div>
        </form>
      </details>}
    </>}
    {work.entries.length > 0 && <details className="document-form" open={!currentPage}><summary>Settlement evidence history</summary>
      <ul className="document-list">{work.entries.map((entry) => <SettlementHistoryItem key={entry.id} entry={entry} today={today} active={active} busy={busy} save={save} />)}</ul>
      <div className="loan-application-actions">
        {!currentPage && <Button size="sm" variant="outline" onClick={() => onPage()}>Latest settlement entries</Button>}
        {work.before && <Button size="sm" variant="outline" onClick={() => onPage(work.before ?? undefined)}>Older settlement entries</Button>}
      </div>
    </details>}
  </section>;
}

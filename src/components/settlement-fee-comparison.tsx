"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { financeInputCents, financeMoney, inputDollars, type SettlementFeeChange } from "@/lib/brokerage-finance-model";
import { dateLabel } from "@/lib/client-retention";
import { feeKeys, feeLabels } from "@/lib/quote-worksheet";
import { compareSettlementFees, settlementFeeAmounts, type SettlementFeeAmounts, type SettlementFeeBaseline,
  type SettlementFeeStatement, type SettlementFeeWork } from "@/lib/settlement-fee-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Save = (change: SettlementFeeChange) => void;
type Draft = Record<keyof SettlementFeeAmounts, { gross: string; borrower: string; payee: string }>;

function fieldsFrom(lines?: SettlementFeeAmounts): Draft {
  return Object.fromEntries(feeKeys.map((key) => [key, {
    gross: inputDollars(lines?.[key].gross ?? null), borrower: inputDollars(lines?.[key].borrower ?? null), payee: lines?.[key].payee ?? "",
  }])) as Draft;
}

function FeeComparisonRows({ baseline, statement }: { baseline: SettlementFeeBaseline; statement: SettlementFeeStatement }) {
  const rows = compareSettlementFees(baseline, statement).filter(({ expected, actual }) => expected.gross !== null || actual.gross !== null)
    .sort((a, b) => Number(b.different) - Number(a.different) || Number(b.missing) - Number(a.missing));
  const difference = (amount: number) => `${amount > 0 ? "+" : ""}${financeMoney(amount)}`;
  return <ul className="document-list" aria-label="Itemized settlement fee comparison">{rows.map((row) => <li className="document-item" key={row.key}>
    <div className="document-item-head"><strong>{feeLabels[row.key]}</strong>
      <span className="pill">{row.different ? "Difference" : row.missing ? "Missing figure" : "Match"}</span></div>
    <p>Confirmed {financeMoney(row.expected.gross)} gross · {financeMoney(row.expected.borrower)} borrower{row.expected.payee && ` · Paid to ${row.expected.payee}`}</p>
    <p>Statement {financeMoney(row.actual.gross)} gross · {financeMoney(row.actual.borrower)} borrower{row.actual.payee && ` · Paid to ${row.actual.payee}`}</p>
    {row.different && <p className="muted">{[
      row.grossDifference ? `Gross ${difference(row.grossDifference)}` : "",
      row.borrowerDifference ? `Borrower ${difference(row.borrowerDifference)}` : "",
      row.payeeChanged ? "Payee changed" : "",
    ].filter(Boolean).join(" · ")}</p>}
    {row.missing && <p className="muted">A confirmed or statement figure is missing.</p>}
  </li>)}</ul>;
}

function FeeStatementForm({ baseline, statement, today, busy, save }: {
  baseline: SettlementFeeBaseline; statement: SettlementFeeStatement | null; today: string; busy: boolean; save: Save;
}) {
  const [fields, setFields] = useState(() => fieldsFrom(statement?.lines));
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const lines = Object.fromEntries(feeKeys.map((key) => {
      const field = fields[key];
      return [key, { gross: financeInputCents(field.gross, 2_500_000_000),
        borrower: financeInputCents(field.borrower, 2_500_000_000), payee: field.payee }];
    }));
    const parsed = settlementFeeAmounts.safeParse(lines);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const key = issue.path[0] as keyof typeof feeLabels | undefined;
      setError(`${key && feeLabels[key] ? `${feeLabels[key]} · ` : ""}${issue.code === "custom" ? issue.message : "Use sample amounts with up to two decimal places."}`);
      return;
    }
    setError("");
    save({ type: "settlementFeeStatement", baseline: { version: baseline.version, revision: baseline.revision }, lines: parsed.data,
      occurredOn: String(values.get("occurredOn")), reference: String(values.get("reference")), note: String(values.get("note")) });
  }
  return <details className="document-form"><summary>{statement ? "Record corrected fee statement" : "Record sample fee statement"}</summary>
    <form className="record-form" onSubmit={submit}>
      <div className="form-grid">
        <label className="field">Fee statement reference<input name="reference" required maxLength={120} defaultValue={statement?.reference} /></label>
        <label className="field">Fee statement date<input name="occurredOn" type="date" max={today} required defaultValue={statement?.occurredOn ?? today} /></label>
      </div>
      <p className="muted">Enter the gross amount and borrower share for each fee in the sample statement. Use zero for a confirmed zero and leave unknown figures blank.</p>
      <div><Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => { setFields(fieldsFrom(baseline.lines)); setError(""); }}>
        Use confirmed fee figures
      </Button></div>
      {feeKeys.map((key) => <fieldset className="document-item record-form" key={key}>
        <legend>{feeLabels[key]}</legend>
        <p className="muted">Confirmed {financeMoney(baseline.lines[key].gross)} gross · {financeMoney(baseline.lines[key].borrower)} borrower
          {baseline.lines[key].payee && ` · Paid to ${baseline.lines[key].payee}`}</p>
        <div className="form-grid">{(["gross", "borrower", "payee"] as const).map((field) => <label className="field" key={field}>
          {feeLabels[key]} {field === "gross" ? "gross (USD)" : field === "borrower" ? "borrower share (USD)" : "payee"}
          <input inputMode={field === "payee" ? undefined : "decimal"} maxLength={field === "payee" ? 80 : 15} disabled={busy}
            value={fields[key][field]} onChange={(event) => {
              const value = event.target.value;
              setFields((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
            }} />
        </label>)}</div>
      </fieldset>)}
      <label className="field">{statement ? "Reason for corrected fee statement" : "Fee statement note (optional)"}
        <textarea name="note" rows={2} maxLength={280} required={Boolean(statement)} /></label>
      {error && <p role="alert">{error}</p>}
      <div><Button size="sm" type="submit" disabled={busy}>Save sample fee statement</Button></div>
    </form>
  </details>;
}

export function SettlementFeeComparison({ work, today, active, busy, focus, save, currentPage, onPage }: {
  work: SettlementFeeWork; today: string; active: boolean; busy: boolean; focus?: boolean; save: Save;
  currentPage: boolean; onPage: (before?: number) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus) panel.current?.focus();
  }, [focus]);
  const { baseline, statement } = work;
  return <section className="document-item record-form" aria-label="Sample settlement fee comparison" ref={panel} tabIndex={-1}>
    <div className="document-item-head"><h4>Sample settlement fee comparison</h4><span className="pill">{active ? work.status : `Archived · ${work.status}`}</span></div>
    <p className="muted">Compare the confirmed disclosure’s itemized fees with a fictional settlement statement. Purchase advice and wire receipts are reviewed separately.</p>
    {!baseline ? <p className="empty-inline">{active ? "Confirm a signed sample disclosure with fees in Closing before funding." : "No sample fee statement was recorded for this cycle."}</p> : <>
      <p>Disclosure v{baseline.version} · Fee worksheet v{baseline.feeRevision} · Confirmed by {baseline.confirmedBy} · {dateTime(baseline.confirmedAt)} ET</p>
      {statement && <>
        <p>Fee statement {statement.reference} · {dateLabel(statement.occurredOn)}</p>
        <FeeComparisonRows baseline={baseline} statement={statement} />
      </>}
      {active && <FeeStatementForm key={work.revision} baseline={baseline} statement={statement} today={today} busy={busy} save={save} />}
      {active && work.status === "Fee difference to review" && <details className="document-form" open={focus || undefined}><summary>Review settlement fee differences</summary>
        <form className="record-form" onSubmit={(event) => {
          event.preventDefault();
          save({ type: "settlementFeeReview", note: String(new FormData(event.currentTarget).get("note")) });
        }}>
          <label className="field">Fee difference review note<textarea name="note" required rows={2} maxLength={280} /></label>
          <div><Button size="sm" type="submit" disabled={busy}>Record fee difference review</Button></div>
        </form>
      </details>}
      {!!work.entries.length && <details className="document-form" open={!currentPage || undefined}><summary>Fee statement and review history</summary>
        <ul className="document-list">{work.entries.map((entry) => <li className="document-item" key={entry.revision}>
          <strong>{entry.kind === "Review" ? "Fee difference review" : "Fee statement"} · {entry.statement.reference}</strong>
          <p className="muted">{entry.actor} · {dateTime(entry.at)} ET · Funding date {dateLabel(entry.fundingDate)}</p>
          <p>{entry.differenceCount} different · {entry.missingCount} with missing figures</p>
          {entry.note && <p>{entry.note}</p>}
          {entry.kind === "Statement" && <details className="document-form"><summary>View recorded fee figures</summary>
            <FeeComparisonRows baseline={baseline} statement={entry.statement} /></details>}
        </li>)}</ul>
        <div className="loan-application-actions">
          {!currentPage && <Button size="sm" variant="outline" onClick={() => onPage()}>Latest fee history</Button>}
          {work.before && <Button size="sm" variant="outline" onClick={() => onPage(work.before ?? undefined)}>Older fee history</Button>}
        </div>
      </details>}
    </>}
  </section>;
}

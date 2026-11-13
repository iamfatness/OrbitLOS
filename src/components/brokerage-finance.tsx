"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessBrokerageFinance } from "@/app/actions";
import { financeInputCents as cents, financeMoney, inputDollars, type FinanceEntry, type FinanceInput, type FinanceListQuery, type FinanceLoan,
  type FinanceMutation, type FinanceResult, type SettlementChange, type SettlementFeeChange, type SettlementQueueQuery } from "@/lib/brokerage-finance-model";
import { dateLabel } from "@/lib/client-retention";
import type { Loan, Workspace } from "@/lib/model";
import { currentReportMonth } from "@/lib/report-date-range";
import { dateTime } from "@/lib/utils";
import { downloadSampleFile } from "./sample-download";
import { SettlementExceptionQueue } from "./settlement-exception-queue";
import { SettlementReconciliation } from "./settlement-reconciliation";
import { SettlementFeeComparison } from "./settlement-fee-comparison";
import { SettlementEvidenceImport } from "./settlement-evidence-import";
import { SettlementFeed } from "./settlement-feed";
import { Button } from "./ui/button";

type List = Extract<FinanceResult, { kind: "list" }>;
type Detail = Extract<FinanceResult, { kind: "detail" }>;
type Change<Action = FinanceMutation> = Action extends FinanceMutation ? Omit<Action, "loanId" | "cycle" | "fundingDate" | "revision" | "entryId"> : never;
type Save = (change: Change, after?: () => void) => void;

function LoanAmounts({ loan }: { loan: FinanceLoan }) {
  return <dl className="metrics finance-metrics">
    <div><dt>Expected compensation</dt><dd>{financeMoney(loan.expectedCents)}</dd></div>
    <div><dt>Recorded receipts</dt><dd>{financeMoney(loan.receiptsCents)}</dd></div>
    <div><dt>Expected less receipts</dt><dd>{financeMoney(loan.remainingCents)}</dd></div>
    <div><dt>Commission obligation</dt><dd>{financeMoney(loan.commissionCents)}</dd></div>
    <div><dt>Posted direct expenses</dt><dd>{financeMoney(loan.expensesCents)}</dd></div>
    <div><dt>Estimated loan margin</dt><dd>{financeMoney(loan.marginCents)}</dd></div>
  </dl>;
}

function FinanceForms({ loan, today, busy, save }: { loan: FinanceLoan; today: string; busy: boolean; save: Save }) {
  const [error, setError] = useState("");
  function estimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const expectedCents = cents(data.get("expected"));
    const commissionCents = cents(data.get("commission"));
    if (expectedCents === undefined || commissionCents === undefined) { setError("Enter amounts with up to two decimal places."); return; }
    setError("");
    save({ type: "estimate", expectedCents, commissionCents, expenseReviewed: data.has("expenseReviewed") });
  }
  function post(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const amountCents = cents(data.get("amount"));
    if (!amountCents) { setError("Enter a positive amount with up to two decimal places."); return; }
    setError("");
    save({ type: "post", kind: data.get("kind") === "Expense" ? "Expense" : "Receipt", amountCents, occurredOn: String(data.get("date")),
      reference: String(data.get("reference")), note: String(data.get("note")) }, () => { form.reset(); form.closest("details")?.removeAttribute("open"); });
  }
  return <>
    {error && <p role="alert">{error}</p>}
    <details className="document-form"><summary>Edit compensation estimate</summary>
      <form className="record-form" onSubmit={estimate}>
        <div className="form-grid">
          <label className="field">Expected compensation (USD)<input name="expected" inputMode="decimal" maxLength={15} defaultValue={inputDollars(loan.expectedCents)} /></label>
          <label className="field">Commission obligation (USD)<input name="commission" inputMode="decimal" maxLength={15} defaultValue={inputDollars(loan.commissionCents)} /></label>
        </div>
        <p className="muted">Leave unknown amounts blank. Enter zero when you have confirmed there is no commission obligation.</p>
        <label className="demo-confirm"><input name="expenseReviewed" type="checkbox" defaultChecked={loan.expenseReviewed} /> Direct expense review complete</label>
        <div><Button size="sm" type="submit" disabled={busy}>Save estimate</Button></div>
      </form>
    </details>
    <details className="document-form"><summary>Post receipt or expense</summary>
      <form className="record-form" onSubmit={post}>
        <div className="form-grid">
          <label className="field">Entry type<select name="kind"><option>Receipt</option><option>Expense</option></select></label>
          <label className="field">Amount (USD)<input name="amount" inputMode="decimal" maxLength={15} required /></label>
          <label className="field">Posted date<input name="date" type="date" defaultValue={today} max={today} required /></label>
          <label className="field">Reference<input name="reference" maxLength={120} required placeholder="e.g. Sample statement 01" /></label>
        </div>
        <label className="field">Entry note (optional)<textarea name="note" rows={2} maxLength={280} /></label>
        <div><Button size="sm" type="submit" disabled={busy}>Post ledger entry</Button></div>
      </form>
    </details>
  </>;
}

function LedgerEntry({ entry, today, active, busy, save }: { entry: FinanceEntry; today: string; active: boolean; busy: boolean; save: Save }) {
  return <li className="document-item">
    <div className="document-item-head"><strong>{entry.kind}{entry.reference && ` · ${entry.reference}`}</strong>
      {entry.amountCents !== null && <span className="pill">{financeMoney(entry.amountCents)}</span>}</div>
    <p className="muted">Posted {dateLabel(entry.occurredOn)} · {entry.actorName} · Entered {dateTime(entry.at)} ET</p>
    {entry.note && <p>{entry.note}</p>}
    {entry.reversedBy && <span className="pill">Reversed</span>}
    {active && !entry.reversedBy && (entry.kind === "Receipt" || entry.kind === "Expense") && <details className="document-form">
      <summary>Reverse entry</summary>
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        save({ type: "reverse", originalId: entry.id, occurredOn: String(data.get("date")), note: String(data.get("reason")) }, () => form.reset());
      }}>
        <label className="field">Reversal date<input name="date" type="date" defaultValue={today} min={entry.occurredOn} max={today} required /></label>
        <label className="field">Reason for reversal<textarea name="reason" rows={2} maxLength={280} required /></label>
        <div><Button size="sm" type="submit" variant="outline" disabled={busy}>Post reversal</Button></div>
      </form>
    </details>}
  </li>;
}

export function BrokerageFinance({ brokerageId, loans, fundingVersion, openFunding }: {
  brokerageId: string; loans: Loan[]; fundingVersion: Workspace["closingProgress"]; openFunding: (id: string) => void;
}) {
  const [query, setQuery] = useState<FinanceListQuery>(() => ({ type: "list", ...currentReportMonth(), view: "Funded", owner: "" }));
  const [showExceptions, setShowExceptions] = useState(false);
  const [exceptionView, setExceptionView] = useState<SettlementQueueQuery["view"]>("Differences");
  const [returnTo, setReturnTo] = useState<{ loanId: string; cycle: number }>();
  const [selection, setSelection] = useState<{ loanId: string; cycle: number; before?: number; settlementBefore?: number; feeBefore?: number; focusFees?: true }>();
  const [version, setVersion] = useState(0);
  const [list, setList] = useState<{ query: FinanceListQuery; data: List | { error: string } }>();
  const [detail, setDetail] = useState<{ selection: typeof selection; data: Detail | { error: string } }>();
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const attempt = useRef<{ key: string; id: string }>(null);
  useEffect(() => {
    let current = true;
    const failure = { error: "Could not load brokerage financials. Refresh to try again." };
    if (selection) void accessBrokerageFinance({ type: "detail", ...selection }, brokerageId).then((data) => {
      if (current) setDetail({ selection, data: "error" in data || data.kind === "detail" ? data : failure });
    }, () => { if (current) setDetail({ selection, data: failure }); });
    else if (!showExceptions) void accessBrokerageFinance(query, brokerageId).then((data) => {
      if (current) setList({ query, data: "error" in data || data.kind === "list" ? data : failure });
    }, () => { if (current) setList({ query, data: failure }); });
    return () => { current = false; };
  }, [brokerageId, fundingVersion, query, selection, showExceptions, version]);

  async function act(input: FinanceInput, after?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await accessBrokerageFinance(input, brokerageId);
      if ("error" in result) setFeedback({ text: result.error, error: true });
      else if (result.kind === "export") {
        downloadSampleFile(result.csv, `orbit-financials-${query.view.toLowerCase()}-${query.from}-${query.through}.csv`, "text/csv");
        setFeedback({ text: `Exported ${result.count} financial records.` });
      } else if (result.kind === "saved") {
        attempt.current = null;
        setFeedback({ text: result.message });
        after?.();
        setSelection((current) => current && { loanId: current.loanId, cycle: current.cycle, focusFees: current.focusFees });
      }
    } catch { setFeedback({ text: "Could not confirm this action. Refresh or try again.", error: true }); }
    finally { pending.current = false; setBusy(false); setVersion((current) => current + 1); }
  }

  const showingQueue = showExceptions && !selection;
  const data = selection ? detail?.selection === selection ? detail?.data : undefined : !showingQueue && list?.query === query ? list.data : undefined;
  const owners = [...new Map(loans.filter(({ officer }) => officer).map((loan) => [loan.officerEmail ? `email:${loan.officerEmail}` : `name:${loan.officer}`, loan.officer])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const save = (change: Change | SettlementChange | SettlementFeeChange, after?: () => void) => {
    if (!data || "error" in data || data.kind !== "detail" || pending.current) return;
    const { id: loanId, cycle, date: fundingDate } = data.loan;
    const feeChange = change.type === "settlementFeeStatement" || change.type === "settlementFeeReview";
    if (feeChange && !data.settlementFees) return;
    const revision = feeChange ? data.settlementFees?.revision ?? 0 : change.type.startsWith("settlement") ? data.settlement.revision : data.loan.revision;
    const fields = { ...change, loanId, cycle, fundingDate, revision };
    const key = JSON.stringify(fields);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    void act({ ...fields, entryId: attempt.current.id }, after);
  };
  return <section className="integration record-form manager-panel" aria-label="Brokerage financials">
    <div className="section-heading"><h2>Brokerage financials</h2><span className="pill">Owner only · Fictional pilot</span></div>
    {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {!selection && <div className="loan-application-actions" role="group" aria-label="Financial views">
      <Button size="sm" variant={showExceptions ? "outline" : "default"} aria-pressed={!showExceptions}
        onClick={() => { setShowExceptions(false); setFeedback(undefined); }}>Funded and reversed</Button>
      <Button size="sm" variant={showExceptions ? "default" : "outline"} aria-pressed={showExceptions}
        onClick={() => { setShowExceptions(true); setFeedback(undefined); }}>Settlement exceptions</Button>
    </div>}
    {selection ? <div className="loan-application-actions"><Button size="sm" variant="outline" disabled={busy} onClick={() => {
      setReturnTo(showExceptions ? selection : undefined); setSelection(undefined); setFeedback(undefined);
    }}>{showExceptions ? "Back to settlement exceptions" : "Back to financials"}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setVersion((value) => value + 1)}>Refresh ledger</Button></div>
      : showingQueue ? <SettlementExceptionQueue brokerageId={brokerageId} fundingVersion={fundingVersion} view={exceptionView} selectView={setExceptionView} returnTo={returnTo}
        open={(loanId, cycle, focusFees) => { setFeedback(undefined); setSelection({ loanId, cycle, focusFees }); }} /> : <>
      <form className="record-form" key={`${query.from}:${query.through}:${query.view}:${query.owner}`} onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        setFeedback(undefined);
        setQuery({ type: "list", from: String(fields.get("from")), through: String(fields.get("through")),
          view: fields.get("view") === "Reversed" ? "Reversed" : "Funded", owner: String(fields.get("owner")) });
      }}>
        <div className="form-grid">
          <label className="field">Funding from<input name="from" type="date" defaultValue={query.from} required /></label>
          <label className="field">Funding through<input name="through" type="date" defaultValue={query.through} required /></label>
          <label className="field">Funding status<select name="view" defaultValue={query.view}><option>Funded</option><option>Reversed</option></select></label>
          <label className="field">Loan officer<select name="owner" defaultValue={query.owner}><option value="">All officers</option>
            {owners.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
        </div>
        <div className="loan-application-actions"><Button size="sm" type="submit" variant="outline" disabled={busy}>Apply filters</Button>
          <Button size="sm" type="button" variant="ghost" disabled={busy || !data || "error" in data} onClick={() => void act({ ...query, type: "export" })}>Export financial summary CSV</Button></div>
      </form>
    </>}
    {!showingQueue && !data && <p role="status" className="muted">Loading financial records…</p>}
    {data && "error" in data && <p role="alert">{data.error}</p>}
    {data && "kind" in data && data.kind === "list" && <>
      <dl className="metrics finance-metrics">
        <div><dt>Known expected compensation</dt><dd>{financeMoney(data.totals.expectedCount ? data.totals.expectedCents : null)}</dd><dd className="metric-context">{data.totals.expectedCount} of {data.totals.count} files</dd></div>
        <div><dt>Recorded receipts</dt><dd>{financeMoney(data.totals.receiptsCents)}</dd></div>
        <div><dt>Posted direct expenses</dt><dd>{financeMoney(data.totals.expensesCents)}</dd></div>
        <div><dt>Estimated loan margin</dt><dd>{financeMoney(data.totals.marginCount ? data.totals.marginCents : null)}</dd><dd className="metric-context">{data.totals.marginCount} of {data.totals.count} files complete</dd></div>
      </dl>
      <details className="document-form"><summary>How estimated margin is calculated</summary>
        <p className="muted">Expected compensation minus commission and reviewed direct expenses. Totals use funding dates and USD.</p>
      </details>
      {data.loans.length ? <ul className="document-list">{data.loans.map((loan) => <li className="document-item" key={`${loan.id}:${loan.cycle}`}>
        <div className="document-item-head"><strong>{loan.borrower}</strong><Button size="sm" variant="outline" disabled={busy}
          aria-label={`Open financials for ${loan.borrower}`} onClick={() => { setFeedback(undefined); setSelection({ loanId: loan.id, cycle: loan.cycle }); }}>Open financials</Button></div>
        <p className="muted">Funded {dateLabel(loan.date)} · {loan.officer || "Unassigned"}{loan.reversedAt && ` · Reversed ${dateTime(loan.reversedAt)} ET`}</p>
        <p>Expected {financeMoney(loan.expectedCents)} · Received {financeMoney(loan.receiptsCents)} · Margin {financeMoney(loan.marginCents)}</p>
        {loan.settlementStatus && <span className="pill">Settlement · {loan.settlementStatus}</span>}
      </li>)}</ul> : <p className="empty-inline">No {query.view.toLowerCase()} financial records match these dates and officer.</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" disabled={busy} onClick={() => setQuery({ ...query, after: undefined })}>First page</Button>}
        {data.next && <Button size="sm" variant="outline" disabled={busy} onClick={() => setQuery({ ...query, after: data.next ?? undefined })}>Next page</Button>}
      </div>
    </>}
    {data && "kind" in data && data.kind === "detail" && <section className="record-form" aria-label="Loan financial ledger">
      <div className="section-heading"><h3>{data.loan.borrower}</h3>{!data.loan.reversedAt && <Button size="sm" variant="outline" disabled={busy} onClick={() => openFunding(data.loan.id)}>Open funding record</Button>}</div>
      <p className="muted">Funded {dateLabel(data.loan.date)} · Cycle {data.loan.cycle}{data.loan.reversedAt && ` · Reversed ${dateTime(data.loan.reversedAt)} ET · Archived ledger`}</p>
      <SettlementReconciliation work={data.settlement} today={data.today} active={!data.loan.reversedAt} busy={busy} save={save}
        importEvidence={<>
          <SettlementFeed key={`${data.loan.id}:${data.loan.cycle}`} brokerageId={brokerageId} loan={data.loan} onImported={() => setVersion(value => value + 1)} />
          {!data.loan.reversedAt && <SettlementEvidenceImport brokerageId={brokerageId} loan={data.loan} busy={busy}
            onSaved={(message) => { setFeedback({ text: message }); setVersion(value => value + 1); }} />}
        </>}
        currentPage={!selection?.settlementBefore} onPage={(settlementBefore) => setSelection((current) => current && { ...current, settlementBefore })} />
      {data.settlementFees && <SettlementFeeComparison work={data.settlementFees} today={data.today} active={!data.loan.reversedAt} busy={busy}
        focus={selection?.focusFees} save={save} currentPage={!selection?.feeBefore}
        onPage={(feeBefore) => setSelection((current) => current && { ...current, feeBefore })} />}
      <LoanAmounts loan={data.loan} />
      <p className="muted">{data.loan.expenseReviewed ? "Direct expenses reviewed." : "Direct expense review is incomplete."} Estimated margin covers this loan’s direct costs.</p>
      {!data.loan.reversedAt && <FinanceForms key={`${data.loan.id}:${data.loan.cycle}:${data.loan.revision}`} loan={data.loan} today={data.today} busy={busy} save={save} />}
      <h4>Ledger history</h4>
      {data.entries.length ? <ul className="document-list">{data.entries.map((entry) => <LedgerEntry key={entry.id} entry={entry} today={data.today}
        active={!data.loan.reversedAt} busy={busy} save={save} />)}</ul> : <p className="empty-inline">No financial entries have been posted for this funding cycle.</p>}
      <div className="loan-application-actions">
        {selection?.before && <Button size="sm" variant="outline" disabled={busy} onClick={() => setSelection({ ...selection, before: undefined })}>Latest entries</Button>}
        {data.before && selection && <Button size="sm" variant="outline" disabled={busy} onClick={() => setSelection({ ...selection, before: data.before ?? undefined })}>Older entries</Button>}
      </div>
    </section>}
  </section>;
}

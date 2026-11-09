"use client";

import { useEffect, useRef, useState } from "react";
import { readFundingDashboard, requestFundingRecord } from "@/app/actions";
import { currentFundingMonth, fundingDashboardQuery, fundingMetrics, fundingPeriods, targetMonth, type FundingDashboardData,
  type FundingDashboardQuery, type FundingLoanDetail, type FundingMetric, type FundingRecordInput } from "@/lib/funding-dashboard-model";
import { reportOwner } from "@/lib/manager-report-model";
import type { Loan } from "@/lib/model";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";

const labels: Record<FundingMetric, string> = { projected: "Projected funding", actual: "Actual funding" };
const periodLabels = { selected: "Selected period", previous: "Previous period" };
const principal = (amount: number) => amount ? money(amount) : "$0";

function FundingLoanDetails({ id, brokerageId, version, openWorkbench }: {
  id: string; brokerageId: string; version: object; openWorkbench?: () => void;
}) {
  const [detail, setDetail] = useState<{ version: object; result: FundingLoanDetail | { error: string } }>();
  useEffect(() => {
    let active = true;
    const update = (result: FundingLoanDetail | { error: string }) => { if (active) setDetail({ version, result }); };
    void requestFundingRecord({ type: "loan", id }, brokerageId).then((result) => update("loan" in result ? result.loan :
      { error: "error" in result ? result.error : "This loan is unavailable." }), () => update({ error: "Could not load this loan." }));
    return () => { active = false; };
  }, [brokerageId, id, version]);
  const loan = detail?.version === version ? detail.result : undefined;
  if (!loan) return <p className="muted" role="status">Loading loan details…</p>;
  if ("error" in loan) return <p role="alert">{loan.error}</p>;
  return <section className="document-item record-form" aria-label="Funding loan details">
    <div className="section-heading"><h4>{loan.name}</h4><span className="pill">{loan.stage}</span></div>
    <p>{[loan.address, loan.officer || "Unassigned", principal(loan.amount)].filter(Boolean).join(" · ")}</p>
    <dl className="application-answers">
      <div><dt>Target closing</dt><dd>{loan.targetDate || "Unscheduled"}</dd></div>
      <div><dt>Actual closing</dt><dd>{loan.closingDate || "Pending"}</dd></div>
      <div><dt>Actual funding</dt><dd>{loan.fundingDate || "Pending"}</dd></div>
      <div><dt>Disclosure status</dt><dd>{loan.disclosureStatus || "Not started"}</dd></div>
      <div><dt>Open closing checklist items</dt><dd>{loan.outstanding}</dd></div>
    </dl>
    {openWorkbench && <div><Button size="sm" variant="outline" onClick={openWorkbench}>Open closing workbench</Button></div>}
  </section>;
}

export function FundingDashboard({ brokerageId, loans, version, openLoan }: {
  brokerageId: string; loans: Loan[]; version: object; openLoan: (id: string) => void;
}) {
  const [query, setQuery] = useState<FundingDashboardQuery>(() => ({ ...currentFundingMonth(), owner: "", metric: "actual", period: "selected" }));
  const [filterError, setFilterError] = useState("");
  const [viewId, setViewId] = useState("");
  const [loanId, setLoanId] = useState("");
  const [saving, setSaving] = useState(false);
  const [settingFeedback, setSettingFeedback] = useState<{ text: string; error: boolean }>();
  const viewAttempt = useRef<{ key: string; id: string } | null>(null);
  const [data, setData] = useState<{ query: FundingDashboardQuery; version: object; result: FundingDashboardData | { error: string } }>();
  const current = data?.query === query && data.version === version ? data.result : undefined;
  const report = current && !("error" in current) ? current : undefined;
  const summary = data && data.version === version && !("error" in data.result) && data.query.from === query.from &&
    data.query.through === query.through && data.query.owner === query.owner ? data.result : report;
  const month = targetMonth(query);
  const officers = new Map(loans.map((loan) => [reportOwner(loan), loan.officer || "Unassigned"]));
  if (query.owner && !officers.has(query.owner)) officers.set(query.owner, "Previous selection");

  useEffect(() => {
    let active = true;
    const update = (result: FundingDashboardData | { error: string }) => { if (active) setData({ query, version, result }); };
    void readFundingDashboard(query, brokerageId).then(update, () => update({ error: "Could not load the funding dashboard. Try again." }));
    return () => { active = false; };
  }, [brokerageId, query, version]);

  async function saveSetting(input: Exclude<FundingRecordInput, { type: "loan" }>, after?: () => void) {
    if (saving) return;
    setSaving(true);
    setSettingFeedback(undefined);
    try {
      const result = await requestFundingRecord(input, brokerageId);
      if (!("message" in result)) {
        setSettingFeedback({ error: true, text: "error" in result ? result.error : "Could not save funding settings." });
        return;
      }
      after?.();
      setSettingFeedback({ error: false, text: result.message });
      setQuery((currentQuery) => ({ ...currentQuery, after: undefined }));
    } catch {
      setSettingFeedback({ error: true, text: "Could not save funding settings. Try again." });
    } finally { setSaving(false); }
  }

  function changeQuery(next: FundingDashboardQuery, selectedView = "") {
    setViewId(selectedView);
    setLoanId("");
    setFilterError("");
    setQuery(next);
  }

  return <section className="integration record-form manager-panel" aria-label="Funding dashboard">
    <div className="section-heading"><h2>Brokerage funding</h2>{summary && <span className="pill">Checked {dateTime(summary.checkedAt)} ET</span>}</div>
    <details className="document-form">
      <summary>How funding is counted</summary>
      <p className="muted">Projections use target closing dates for active loans. Actuals use recorded funding dates. Volume is loan principal and follows the current owner. Prior projections use today’s pipeline.</p>
    </details>
    <form className="record-form" key={`${query.from}:${query.through}:${query.owner}`} onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const next = fundingDashboardQuery.safeParse({ ...query, from: fields.get("from"), through: fields.get("through"), owner: fields.get("owner"),
        period: "selected", after: undefined });
      if (!next.success) { setFilterError("Choose a start and end date in order, up to 366 days."); return; }
      changeQuery(next.data);
    }}>
      <div className="form-grid">
        <label className="field">From<input name="from" type="date" min="1900-01-01" required defaultValue={query.from} /></label>
        <label className="field">Through<input name="through" type="date" min="1900-01-01" required defaultValue={query.through} /></label>
        <label className="field">Officer<select name="owner" defaultValue={query.owner}>
          <option value="">All officers</option>
          {[...officers].sort((a, b) => a[1].localeCompare(b[1])).map(([key, name]) => <option key={key} value={key}>
            {name}{key.startsWith("email:") ? ` · ${key.slice(6)}` : ""}
          </option>)}
        </select></label>
      </div>
      {filterError && <p role="alert">{filterError}</p>}
      <div className="loan-application-actions">
        <Button size="sm" type="submit" disabled={!current || saving}>Apply filters</Button>
        <Button size="sm" type="button" variant="outline" disabled={!current} onClick={() => setQuery({ ...query, after: undefined })}>Refresh funding</Button>
      </div>
    </form>
    {summary && <section className="record-form" aria-label="Saved funding views">
      <div className="form-grid">
        <label className="field">Saved funding view<select value={viewId} disabled={saving} onChange={(event) => {
          const view = summary.views.find(({ id }) => id === event.target.value);
          if (view) changeQuery(view.filters, view.id);
          else setViewId("");
        }}><option value="">Choose a saved view</option>{summary.views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
        <form className="task-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const name = String(new FormData(form).get("name") ?? "").trim();
          const key = JSON.stringify({ name, from: query.from, through: query.through, owner: query.owner, metric: query.metric, period: query.period });
          if (viewAttempt.current?.key !== key) viewAttempt.current = { key, id: crypto.randomUUID() };
          const { id } = viewAttempt.current;
          void saveSetting({ type: "saveView", id, name, filters: query }, () => { setViewId(id); form.reset(); viewAttempt.current = null; });
        }}><label className="field">New funding view name<input name="name" required maxLength={80} /></label>
          <Button size="sm" type="submit" disabled={!report || saving}>Save funding view</Button>
        </form>
      </div>
      {summary.views.some(({ id }) => id === viewId) && <div><Button size="sm" variant="outline" disabled={saving}
        onClick={() => void saveSetting({ type: "removeView", id: viewId }, () => setViewId(""))}>Remove saved funding view</Button></div>}
    </section>}
    {settingFeedback && <p role={settingFeedback.error ? "alert" : "status"}>{settingFeedback.text}</p>}
    {summary && fundingPeriods.map((period) => {
        const range = summary.periods[period];
        return <section key={period} className="record-form" aria-label={periodLabels[period]}>
          <div className="section-heading"><h3>{periodLabels[period]}</h3><span className="muted">{range.from} to {range.through}</span></div>
          <div className="campaign-metrics">{fundingMetrics.map((metric) => <button key={metric} type="button"
            aria-pressed={query.period === period && query.metric === metric} onClick={() => changeQuery({ ...query, period, metric, after: undefined })}>
            <span>{labels[metric]}</span><strong>{principal(range[metric].volume)}</strong>
            <span>{range[metric].count} {range[metric].count === 1 ? "loan" : "loans"} · View records</span>
          </button>)}</div>
        </section>;
      })}
    {summary && (month ? <section className="record-form" aria-label="Monthly production target">
      <div className="section-heading"><h3>Monthly production target</h3><span className="pill">{month}</span></div>
      {summary.target ? <p>Recorded {summary.periods.selected.actual.count} of {summary.target.count} funded loans and {principal(summary.periods.selected.actual.volume)} of {principal(summary.target.volume)} in principal.</p> :
        <p className="muted">Set the brokerage’s funded loan count and principal targets for this month.</p>}
      <form key={`${month}:${summary.target?.revision ?? 0}`} className="task-form" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void saveSetting({ type: "saveTarget", month, revision: summary.target?.revision ?? 0,
          count: Number(fields.get("count")), volume: Number(fields.get("volume")) });
      }}>
        <label className="field">Funded loan count target<input name="count" type="number" min={1} max={1000000} required defaultValue={summary.target?.count} /></label>
        <label className="field">Funded principal target ($)<input name="volume" type="number" min={1} max={1000000000000} required defaultValue={summary.target?.volume} /></label>
        <Button size="sm" type="submit" disabled={!report || saving}>Save production target</Button>
      </form>
    </section> : <p className="muted">Choose a full calendar month and all officers to see the brokerage production target.</p>)}
    {!current && <p role="status" className="muted">Loading funding records…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {report && <section className="work-queue" aria-label="Funding records">
        <div className="section-heading"><h3>{labels[query.metric]} · {periodLabels[query.period]}</h3>
          <span className="pill">{report.periods[query.period][query.metric].count} matching</span></div>
        {report.loans.length ? <ul className="loan-task-list">{report.loans.map((loan) => <li className="record-form" key={loan.id}>
          <div className="loan-task">
            <div className="loan-task-copy"><strong>{loan.name}</strong><span>{loan.officer || "Unassigned"} · {loan.stage}</span>
              <span>{query.metric === "actual" ? "Funded" : "Target closing"} {loan.date} · {principal(loan.amount)}</span></div>
            <Button size="sm" variant="outline" aria-expanded={loanId === loan.id}
              onClick={() => setLoanId(loanId === loan.id ? "" : loan.id)}>{loanId === loan.id ? "Close loan details" : "Open loan"}</Button>
          </div>
          {loanId === loan.id && <FundingLoanDetails id={loan.id} brokerageId={brokerageId} version={version}
            openWorkbench={() => openLoan(loan.id)} />}
        </li>)}</ul> : <p className="empty-inline">No records on this page. Adjust the date or officer filter to see other loans.</p>}
        <div className="loan-application-actions">
          {query.after && <Button size="sm" variant="outline" onClick={() => changeQuery({ ...query, after: undefined }, viewId)}>First page</Button>}
          {report.next && <Button size="sm" variant="outline" onClick={() => changeQuery({ ...query, after: report.next ?? undefined }, viewId)}>Next page</Button>}
        </div>
      </section>}
  </section>;
}

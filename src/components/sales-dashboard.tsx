"use client";

import { useEffect, useRef, useState } from "react";
import { readSalesReport } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { salesChannels, salesDashboardFilters, salesMetricLabels, salesMetrics, salesPeriods, salesWindows,
  type SalesDashboardResult, type SalesDrilldown, type SalesFilters, type SalesQuery, type SalesRecord, type SalesTotals } from "@/lib/sales-dashboard-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { SalesDashboardSettings } from "./sales-dashboard-settings";

export type SalesSelection = { filters: SalesFilters; drilldown?: SalesDrilldown & { name: string } };

function Counts({ name, id, totals, active, select, fixed }: {
  name: string; id: string | null; totals: Record<SalesDrilldown["period"], SalesTotals>;
  active: SalesSelection["drilldown"]; select: (value: SalesSelection["drilldown"]) => void;
  fixed: boolean;
}) {
  const metrics = fixed ? [...salesMetrics, "maturing"] as const : salesMetrics;
  return <dl className="sales-metrics">{metrics.map((metric) => {
    const label = fixed && metric === "leads" ? "Mature leads" : salesMetricLabels[metric];
    return <div key={metric}>
      <dt>{label}</dt>
      <dd>{salesPeriods.map((period) => <Button key={period} size="sm" variant={period === "selected" ? "outline" : "ghost"}
        aria-label={`${totals[period][metric]} ${label} · ${name} · ${period === "selected" ? "Selected" : "Previous"} period`}
        aria-pressed={active?.groupId === id && active?.metric === metric && active?.period === period}
        onClick={() => select({ metric, period, groupId: id, name })}>
        {totals[period][metric]}{period === "previous" && " prior"}
      </Button>)}</dd>
    </div>;
  })}</dl>;
}

export function SalesDashboard({ brokerageId, version, selection, setSelection, openLead, openLoan }: {
  brokerageId: string; version: object; selection: SalesSelection; setSelection: (value: SalesSelection) => void;
  openLead: (row: SalesRecord, channel: SalesFilters["channel"]) => void; openLoan: (id: string, target?: string) => void;
}) {
  const { filters, drilldown } = selection;
  const [filterError, setFilterError] = useState("");
  const [afterGroup, setAfterGroup] = useState<Extract<SalesQuery, { kind: "summary" }>["afterGroup"]>();
  const [after, setAfter] = useState<Extract<SalesQuery, { kind: "records" }>["after"]>();
  const [refresh, setRefresh] = useState(0);
  const recordsPanel = useRef<HTMLElement>(null);
  const focusRecords = useRef(false);
  const [summaryData, setSummaryData] = useState<{ filters: SalesFilters; version: object; afterGroup: typeof afterGroup; refresh: number; result: SalesDashboardResult }>();
  const [recordData, setRecordData] = useState<{ filters: SalesFilters; drilldown: typeof drilldown; version: object; after: typeof after; refresh: number; result: SalesDashboardResult }>();
  const overview = summaryData?.filters === filters && summaryData.version === version && summaryData.refresh === refresh ? summaryData.result : undefined;
  const summary = overview && "kind" in overview && overview.kind === "summary" ? overview : undefined;
  const savedSettings = summaryData?.filters === filters && "kind" in summaryData.result && summaryData.result.kind === "summary" ? summaryData.result : undefined;
  const current = recordData?.filters === filters && recordData.drilldown === drilldown && recordData.version === version &&
    recordData.after === after && recordData.refresh === refresh ? recordData.result : undefined;
  const records = current && "kind" in current && current.kind === "records" ? current : undefined;
  const owners = summary?.owners ?? [];

  useEffect(() => {
    if (!drilldown || !summary || !focusRecords.current) return;
    focusRecords.current = false;
    recordsPanel.current?.focus({ preventScroll: true });
    recordsPanel.current?.scrollIntoView({ block: "start" });
  }, [drilldown, summary]);

  useEffect(() => {
    let active = true;
    const update = (result: SalesDashboardResult) => { if (active) setSummaryData({ filters, version, afterGroup, refresh, result }); };
    void readSalesReport({ kind: "summary", ...filters, afterGroup }, brokerageId)
      .then(update, () => update({ error: "Could not load sales conversion. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, filters, version, afterGroup, refresh]);

  useEffect(() => {
    if (!drilldown) return;
    let active = true;
    const update = (result: SalesDashboardResult) => { if (active) setRecordData({ filters, drilldown, version, after, refresh, result }); };
    void readSalesReport({ kind: "records", ...filters, ...drilldown, after }, brokerageId)
      .then(update, () => update({ error: "Could not load the contributing records. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, filters, drilldown, version, after, refresh]);

  function apply(next: unknown) {
    const parsed = salesDashboardFilters.safeParse(next);
    if (!parsed.success) { setFilterError("Choose an inclusive date range of up to 366 days and a follow-up window."); return; }
    setFilterError("");
    setAfterGroup(undefined);
    setAfter(undefined);
    setSelection({ filters: parsed.data });
  }

  function select(value: SalesSelection["drilldown"]) {
    focusRecords.current = !!value;
    setAfter(undefined);
    setSelection({ filters, drilldown: value });
  }

  const intake = filters.channel === "Lead sources";
  const campaign = filters.channel === "Campaigns";
  const title = intake ? "All intake sources" : campaign ? "All campaigns" : "All realtor referrals";
  return <section className="integration record-form manager-panel" aria-label="Sales conversion dashboard">
    <div className="section-heading"><h2>Sales and relationships</h2>
      {summary && <span className="pill">Checked {dateTime(summary.checkedAt)} ET</span>}</div>
    <p className="muted">Compare leads by intake, campaign enrollment, or realtor referral date in Eastern time. Funding uses recorded dates, and a repeat 1003 is a separate application linked to that funded loan.</p>
    <div className="loan-application-actions" role="group" aria-label="Sales source">
      {salesChannels.map((channel) => <Button size="sm" key={channel} variant={filters.channel === channel ? "default" : "outline"}
        aria-pressed={filters.channel === channel} onClick={() => apply({ ...filters, channel })}>{channel}</Button>)}
    </div>
    <form className="record-form" key={`${filters.from}:${filters.through}:${filters.owner}:${filters.windowDays}`} onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      apply({ channel: filters.channel, from: String(values.get("from")), through: String(values.get("through")),
        owner: String(values.get("owner")), windowDays: Number(values.get("windowDays")) });
    }}>
      <div className="form-grid">
        <label className="field">Cohort start<input name="from" type="date" required defaultValue={filters.from} /></label>
        <label className="field">Cohort end<input name="through" type="date" required defaultValue={filters.through} /></label>
        <label className="field">Current owner<select name="owner" defaultValue={filters.owner}>
          <option value="">All owners</option>
          {filters.owner && !owners.some((owner) => owner.id === filters.owner) && <option value={filters.owner}>Selected owner</option>}
          {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
        </select></label>
        <label className="field">Follow-up window<select name="windowDays" defaultValue={filters.windowDays}>
          {salesWindows.map((days) => <option key={days} value={days}>{days ? `First ${days} days` : "All recorded outcomes"}</option>)}
        </select></label>
      </div>
      <div className="loan-application-actions">
        <Button size="sm" type="submit">Apply cohort filters</Button>
        <Button size="sm" variant="outline" onClick={() => setRefresh((last) => last + 1)}>Refresh sales conversion</Button>
      </div>
    </form>
    {filterError && <p role="alert">{filterError}</p>}
    {savedSettings && <SalesDashboardSettings brokerageId={brokerageId} filters={filters} summary={savedSettings} ready={!!summary}
      apply={apply} refresh={() => setRefresh((last) => last + 1)} />}
    {!overview && <p role="status" className="muted">Loading sales conversion…</p>}
    {overview && "error" in overview && <p role="alert">{overview.error}</p>}
    {summary && <>
      <section className="work-queue" aria-label="Cohort totals">
        <h3>{title}</h3>
        <p className="muted">{dateLabel(summary.periods.selected.from)} to {dateLabel(summary.periods.selected.through)} · Prior period {dateLabel(summary.periods.previous.from)} to {dateLabel(summary.periods.previous.through)}</p>
        <Counts name={title} id={null} totals={summary.periods} active={drilldown} select={select} fixed={!!filters.windowDays} />
        <p className="muted">{filters.windowDays ?
          `First ${filters.windowDays} Eastern calendar days, including the entry day. Leads still maturing are listed separately from conversion. Timed outreach requires a recorded timestamp.` :
          "Outcomes are counted through the latest check. Earlier cohorts have had longer to convert."}</p>
        <p className="muted">{intake ? "Intake counts each lead once, including direct files created without a separate lead record. Campaign import counts leads first imported into a call campaign. Later enrollment keeps the original source." :
          "Review campaigns and realtor referrals separately because a lead can be in both."}</p>
        <p className="muted">{campaign ? "Outreach means a manually logged campaign call outcome." : "Outreach means a manually logged contact outcome on the lead or loan."} Mock sends and draft previews do not count.</p>
      </section>
      {drilldown && <section className="work-queue" aria-label="Sales contributing records" ref={recordsPanel} tabIndex={-1}>
        <div className="section-heading"><h3>{filters.windowDays && drilldown.metric === "leads" ? "Mature leads" : salesMetricLabels[drilldown.metric]} · {drilldown.name}</h3>
          <Button size="sm" variant="ghost" onClick={() => select(undefined)}>Close records</Button></div>
        <p className="muted">{drilldown.period === "selected" ? "Selected" : "Prior"} cohort · {dateLabel(summary.periods[drilldown.period].from)} to {dateLabel(summary.periods[drilldown.period].through)}</p>
        {!current && <p role="status" className="muted">Loading records…</p>}
        {current && "error" in current && <p role="alert">{current.error}</p>}
        {records && (records.records.length ? <ul className="loan-task-list">{records.records.map((row) => <li key={row.id} className="document-item record-form">
          <div className="document-item-head"><strong>{row.name}</strong><span className="pill">{row.groupName}</span></div>
          <p className="muted">{row.officer || "Unassigned"} · {intake ? "Intake" : campaign ? "Enrolled" : "Referred"} {dateTime(row.at)} ET</p>
          <p className="muted">{drilldown.metric === "maturing" && row.maturesAt ? `Enters the conversion totals ${dateTime(row.maturesAt)} ET` :
            [row.outreach && "Outreach logged", row.submittedAt && `1003 submitted ${dateTime(row.submittedAt)} ET`,
            row.fundingDate && `Funded ${dateLabel(row.fundingDate)}`, row.repeatLoanId && "Repeat 1003 started"].filter(Boolean).join(" · ") || "Lead received"}</p>
          <div className="loan-application-actions">
            {row.repeatLoanId && <Button size="sm" variant="outline" onClick={() => openLoan(row.repeatLoanId!, "loan-application")}>Open repeat 1003</Button>}
            {row.loanId ? <Button size="sm" variant="outline" onClick={() => openLoan(row.loanId!, drilldown.metric === "funded" ? "closing-workbench" :
              drilldown.metric === "submitted" ? "loan-application" : undefined)}>Open loan</Button> :
              row.openLead ? <Button size="sm" variant="outline" onClick={() => openLead(row, filters.channel)}>Open lead</Button> : <span className="muted">Lead archived</span>}
          </div>
        </li>)}</ul> : <p className="empty-inline">No records reached this outcome in the cohort.</p>)}
        <div className="loan-application-actions">
          {after && <Button size="sm" variant="outline" onClick={() => setAfter(undefined)}>First records page</Button>}
          {records?.next && <Button size="sm" variant="outline" onClick={() => setAfter(records.next ?? undefined)}>Next records page</Button>}
        </div>
      </section>}
      <section className="record-form" aria-label="Conversion by source">
        <h3>Conversion by {intake ? "intake source" : campaign ? "campaign" : "realtor"}</h3>
        {summaryData?.afterGroup !== afterGroup ? <p role="status" className="muted">Loading sources…</p> : summary.groups.length ?
          <ul className="loan-task-list">{summary.groups.map((group) => <li key={group.id} className="document-item record-form">
            <strong>{group.name}</strong><Counts name={group.name} id={group.id} totals={group} active={drilldown} select={select} fixed={!!filters.windowDays} />
          </li>)}</ul> : <p className="empty-inline">No leads in either cohort. Change the dates or owner to see more sources.</p>}
        <div className="loan-application-actions">
          {afterGroup && <Button size="sm" variant="outline" onClick={() => setAfterGroup(undefined)}>First sources page</Button>}
          {summary.next && summaryData?.afterGroup === afterGroup &&
            <Button size="sm" variant="outline" onClick={() => setAfterGroup(summary.next ?? undefined)}>Next sources page</Button>}
        </div>
      </section>
    </>}
  </section>;
}

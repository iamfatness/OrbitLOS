"use client";

import { useEffect, useRef, useState } from "react";
import { readOwnerReport, readSalesReport, saveOwnerReportView } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { ownerScorecardFilters, ownerWorkLabels, type OwnerScorecardFilters, type OwnerScorecardResult,
  type OwnerScorecardSetting, type OwnerDestination, type OwnerWorkCursor, type OwnerWorkMetric } from "@/lib/owner-scorecard-model";
import { currentReportMonth } from "@/lib/report-date-range";
import { salesMetricLabels, type SalesGroup, type SalesRecord, type SalesRecords, type SalesTotals } from "@/lib/sales-dashboard-model";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";

const salesMetrics = ["leads", "submitted", "funded"] as const;
type CampaignSelection = { kind: "campaign"; groupId: string | null; name: string; metric: (typeof salesMetrics)[number] };
type Selection = CampaignSelection | { kind: "work"; metric: OwnerWorkMetric };
type Drilldown = SalesRecords | Extract<OwnerScorecardResult, { kind: "work" }> | { error: string };
const viewError = { error: "Could not save this scorecard view. Try again." };

export function OwnerScorecard({ brokerageId, version, filters, setFilters, openWork, openCampaignRecord }: {
  brokerageId: string; version: object; filters: OwnerScorecardFilters; setFilters: (filters: OwnerScorecardFilters) => void;
  openWork: (destination: OwnerDestination, id: string) => void;
  openCampaignRecord: (row: SalesRecord, metric: CampaignSelection["metric"]) => void;
}) {
  const [selection, setSelection] = useState<Selection>();
  const [afterGroup, setAfterGroup] = useState<Pick<SalesGroup, "id" | "name">>();
  const [after, setAfter] = useState<OwnerWorkCursor>();
  const [refresh, setRefresh] = useState(0);
  const [filterError, setFilterError] = useState("");
  const [viewId, setViewId] = useState("");
  const [viewFeedback, setViewFeedback] = useState<{ error: boolean; text: string }>();
  const [saving, setSaving] = useState(false);
  const viewAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const drillHeading = useRef<HTMLElement>(null);
  const [overview, setOverview] = useState<{ filters: OwnerScorecardFilters; version: object; refresh: number; afterGroup: typeof afterGroup; result: OwnerScorecardResult }>();
  const [detail, setDetail] = useState<{ filters: OwnerScorecardFilters; version: object; refresh: number; selection: Selection; after: typeof after; result: Drilldown }>();

  const current = overview?.filters === filters && overview.version === version && overview.refresh === refresh &&
    overview.afterGroup === afterGroup ? overview.result : undefined;
  const summary = current && "kind" in current && current.kind === "summary" ? current : undefined;
  const filterOptions = overview && "kind" in overview.result && overview.result.kind === "summary" ? overview.result : undefined;
  const activeView = filterOptions?.views.find((view) => view.id === viewId);
  const drill = detail?.filters === filters && detail.version === version && detail.refresh === refresh &&
    detail.selection === selection && detail.after === after ? detail.result : undefined;

  useEffect(() => {
    let active = true;
    const update = (result: OwnerScorecardResult) => { if (active) setOverview({ filters, version, refresh, afterGroup, result }); };
    void readOwnerReport({ kind: "summary", ...filters, afterGroup }, brokerageId)
      .then(update, () => update({ error: "Could not load the scorecard. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, filters, version, refresh, afterGroup]);

  useEffect(() => {
    if (!selection) return;
    let active = true;
    const update = (result: Drilldown) => { if (active) setDetail({ filters, version, refresh, selection, after, result }); };
    const request = selection.kind === "campaign" ?
      readSalesReport({ ...filters, kind: "records", channel: "Campaigns", windowDays: 0, period: "selected", metric: selection.metric,
        groupId: selection.groupId, after }, brokerageId) :
      readOwnerReport({ ...filters, kind: "work", metric: selection.metric, after }, brokerageId);
    void request.then((result) => {
      if ("error" in result || result.kind !== "summary") update(result);
      else update({ error: "The scorecard could not open these records." });
    }, () => update({ error: "Could not load these records. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, filters, version, refresh, selection, after]);

  useEffect(() => {
    if (selection) drillHeading.current?.focus();
  }, [selection]);

  function apply(input: unknown) {
    const parsed = ownerScorecardFilters.safeParse(input);
    if (!parsed.success) {
      setFilterError("Choose a start and end date within a 366-day range.");
      return;
    }
    setFilterError("");
    setSelection(undefined);
    setAfterGroup(undefined);
    setAfter(undefined);
    setFilters(parsed.data);
  }

  function select(next: Selection) {
    setAfter(undefined);
    setSelection(next);
  }

  async function saveView(input: OwnerScorecardSetting) {
    if (saving) return;
    setSaving(true);
    setViewFeedback(undefined);
    try {
      const result = await saveOwnerReportView(input, brokerageId).catch(() => viewError);
      if ("error" in result) {
        setViewFeedback({ error: true, text: result.error });
        return;
      }
      viewAttempt.current = null;
      setViewId(input.type === "saveView" ? input.id : "");
      setViewFeedback({ error: false, text: result.message });
      setRefresh((value) => value + 1);
    } finally {
      setSaving(false);
    }
  }

  function campaignCounts(name: string, groupId: string | null, totals: SalesTotals) {
    return <dl className="sales-metrics">{salesMetrics.map((metric) => <div key={metric}>
      <dt>{metric === "leads" ? "Campaign leads" : salesMetricLabels[metric]}</dt>
      <dd><Button size="sm" variant="outline" aria-pressed={selection?.kind === "campaign" && selection.groupId === groupId && selection.metric === metric}
        aria-label={`${totals[metric]} ${metric === "leads" ? "campaign leads" : salesMetricLabels[metric]} · ${name}`}
        onClick={() => select({ kind: "campaign", name, groupId, metric })}>{totals[metric]}</Button></dd>
    </div>)}</dl>;
  }

  const detailTitle = selection && (selection.kind === "campaign" ?
    `${salesMetricLabels[selection.metric]} · ${selection.name}` : ownerWorkLabels[selection.metric]);
  const next = drill && "kind" in drill ? drill.next : undefined;

  return <section className="integration record-form manager-panel owner-scorecard" aria-label="Brokerage Owner Scorecard">
    <div className="section-heading"><div><p className="eyebrow">Brokerage reports</p><h2>Brokerage Owner Scorecard</h2></div>
      {summary && <span className="pill">Checked {dateTime(summary.checkedAt)} ET</span>}</div>
    <p className="muted">See how campaigns convert, what needs attention now, and what is on track to fund.</p>
    <form key={`${filters.from}:${filters.through}:${filters.owner}`} className="record-form" onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      apply({ from: values.get("from"), through: values.get("through"), owner: values.get("owner") });
    }}>
      <div className="form-grid owner-scorecard-filters">
        <label className="field">Period starts<input name="from" type="date" required defaultValue={filters.from} /></label>
        <label className="field">Period ends<input name="through" type="date" required defaultValue={filters.through} /></label>
        <label className="field">Current owner<select name="owner" defaultValue={filters.owner}>
          <option value="">All owners</option>
          {filters.owner && !filterOptions?.owners.some((owner) => owner.id === filters.owner) && <option value={filters.owner}>Selected owner</option>}
          {filterOptions?.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
        </select></label>
      </div>
      <div className="loan-application-actions">
        <Button size="sm" type="submit">Apply scorecard filters</Button>
        <Button size="sm" variant="outline" onClick={() => apply({ ...currentReportMonth(), owner: filters.owner })}>This month</Button>
        <Button size="sm" variant="ghost" onClick={() => setRefresh((value) => value + 1)}>Refresh scorecard</Button>
      </div>
    </form>
    {filterError && <p role="alert">{filterError}</p>}
    {filterOptions && <details className="document-form"><summary>Saved scorecard views</summary>
      <div className="record-form">
        <p className="muted">Save the applied dates and owner for brokerage admins.</p>
        <label className="field">Saved scorecard view<select value={viewId} onChange={(event) => setViewId(event.target.value)}>
          <option value="">Choose a view</option>
          {filterOptions.views.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <div className="loan-application-actions">
          <Button size="sm" variant="outline" disabled={!activeView || saving} onClick={() => activeView && apply(activeView.filters)}>Use view</Button>
          <Button size="sm" variant="ghost" disabled={!activeView || saving} onClick={() => activeView && void saveView({ type: "removeView", id: activeView.id })}>Remove view</Button>
        </div>
        <form className="record-form" onSubmit={(event) => {
          event.preventDefault();
          const name = String(new FormData(event.currentTarget).get("name")).trim();
          const fingerprint = JSON.stringify({ name, filters });
          if (viewAttempt.current?.fingerprint !== fingerprint) viewAttempt.current = { fingerprint, id: crypto.randomUUID() };
          void saveView({ type: "saveView", id: viewAttempt.current.id, name, filters });
        }}>
          <label className="field">New view name<input name="name" required maxLength={80} placeholder="e.g. November production" /></label>
          <Button size="sm" type="submit" disabled={saving || !summary}>Save scorecard view</Button>
        </form>
        {viewFeedback && <p role={viewFeedback.error ? "alert" : "status"}>{viewFeedback.text}</p>}
      </div>
    </details>}
    {!current && <p role="status">Loading scorecard…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {summary && <div className="owner-scorecard-grid">
      <section className="work-queue record-form" aria-label="Campaign conversion">
        <div><p className="eyebrow">01 · Growth</p><h3>Campaign conversion</h3></div>
        {campaignCounts("All campaigns", null, summary.sales.periods.selected)}
        <p className="muted">Leads enrolled in the period, with recorded outcomes through the latest check.</p>
      </section>
      <section className="work-queue record-form" aria-label="Needs attention">
        <div><p className="eyebrow">02 · Operations</p><h3>Needs attention</h3></div>
        <dl className="sales-metrics">{(["followUps", "conditions"] as const).map((metric) => <div key={metric}>
          <dt>{ownerWorkLabels[metric]}</dt><dd><Button size="sm" variant="outline" aria-label={`${summary.counts[metric]} ${ownerWorkLabels[metric]}`}
            aria-pressed={selection?.kind === "work" && selection.metric === metric} onClick={() => select({ kind: "work", metric })}>{summary.counts[metric]}</Button></dd>
        </div>)}</dl>
        <p className="muted">Current actionable follow-ups and active files with lender conditions. The owner filter applies.</p>
      </section>
      <section className="work-queue record-form" aria-label="Funding outlook">
        <div><p className="eyebrow">03 · Production</p><h3>Funding outlook</h3></div>
        <dl className="sales-metrics">{(["projected", "actual"] as const).map((metric) => <div key={metric}>
          <dt>{ownerWorkLabels[metric]}</dt><dd><Button size="sm" variant="outline"
            aria-label={`${summary.funding[metric].count} loans · ${ownerWorkLabels[metric]}`}
            aria-pressed={selection?.kind === "work" && selection.metric === metric}
            onClick={() => select({ kind: "work", metric })}>
            {summary.funding[metric].count} · {summary.funding[metric].volume ? money(summary.funding[metric].volume) : "$0"}</Button></dd>
        </div>)}</dl>
        <p className="muted">Projection uses scheduled closing dates. Recorded funding uses actual funding dates.</p>
      </section>
    </div>}
    {selection && <section className="work-queue record-form" aria-label="Scorecard records" ref={drillHeading} tabIndex={-1}>
      <div className="section-heading"><h3>{detailTitle}</h3><Button size="sm" variant="ghost" onClick={() => setSelection(undefined)}>Close records</Button></div>
      {!drill && <p role="status">Loading records…</p>}
      {drill && "error" in drill && <p role="alert">{drill.error}</p>}
      {drill && "kind" in drill && <ul className="loan-task-list">
        {drill.kind === "records" && selection.kind === "campaign" && drill.records.map((row) => <li className="loan-task" key={row.id}>
          <div className="loan-task-copy"><strong>{row.name}</strong><span>{row.groupName} · {row.officer || "Unassigned"}{row.fundingDate && ` · Funded ${dateLabel(row.fundingDate)}`}</span></div>
          <Button size="sm" variant="outline" onClick={() => openCampaignRecord(row, selection.metric)}>{row.loanId ? "Open loan" : "Open lead"}</Button>
        </li>)}
        {drill.kind === "work" && drill.rows.map((row) => <li className="loan-task" key={row.id}>
          <div className="loan-task-copy"><strong>{row.name}</strong><span>{row.title} · {row.owner}
            {row.conditionCount !== undefined && ` · ${row.conditionCount} open`}{row.amount !== undefined && ` · ${money(row.amount)}`}
            {` · ${row.at.length === 10 ? dateLabel(row.at) : dateTime(row.at) + " ET"}`}</span></div>
          <Button size="sm" variant="outline" onClick={() => openWork(row.destination, row.id)}>
            {selection.metric === "conditions" ? "Open condition" : selection.metric === "followUps" ? "Open follow-up" : "Open loan"}</Button>
        </li>)}
        {(drill.kind === "work" ? !drill.rows.length : !drill.records.length) && <li className="empty-inline">No records match this selection.</li>}
      </ul>}
      <div className="loan-application-actions">
        {after && <Button size="sm" variant="ghost" onClick={() => setAfter(undefined)}>First records</Button>}
        {next && <Button size="sm" variant="outline" onClick={() => setAfter(next)}>Next records</Button>}
      </div>
    </section>}
    {summary && <section className="work-queue record-form" aria-label="By campaign"><h3>By campaign</h3>
      {!summary.sales.groups.some((group) => group.selected.leads > 0) && <p className="empty-inline">No campaign enrollments on this page for these dates and owner.</p>}
      {summary.sales.groups.filter((group) => group.selected.leads > 0).map((group) => <section key={group.id} className="record-form">
        <h4>{group.name}</h4>{campaignCounts(group.name, group.id, group.selected)}
      </section>)}
      <div className="loan-application-actions">
        {afterGroup && <Button size="sm" variant="ghost" onClick={() => setAfterGroup(undefined)}>First campaigns</Button>}
        {summary.sales.next && <Button size="sm" variant="outline" onClick={() => setAfterGroup(summary.sales.next ?? undefined)}>Next campaigns</Button>}
      </div>
    </section>}
  </section>;
}

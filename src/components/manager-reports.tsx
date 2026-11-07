"use client";

import { useState } from "react";
import { leadSources } from "@/lib/model";
import { defaultReportFilters, reportFilters, reportOwner, reportRows, type ManagerReports as ReportData,
  type ReportFilters } from "@/lib/manager-report-model";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";
import type { WorkspaceMutationSuccess } from "@/lib/commands";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
const metrics = [
  ["leads", "Leads"], ["responded", "First outreach logged"], ["overdue", "First contact overdue"],
  ["submitted", "1003s submitted"], ["converted", "Leads funded"], ["projected", "Projected funding"], ["funded", "Actual funding"],
] as const;
type Metric = (typeof metrics)[number][0];
const totalAmount = (rows: ReturnType<typeof reportRows>[Metric]) => rows.reduce((sum, row) => sum + row.amount, 0);
const percent = (count: number, total: number) => total ? `${Math.round(count / total * 100)}%` : "—";

export function ManagerReports({ data, now, busy, save, openLoan, openLead }: {
  data: ReportData; now: number; busy: boolean; save: Save; openLoan: (id: string) => void; openLead: (id: string) => void;
}) {
  const [filters, setFilters] = useState<ReportFilters>(defaultReportFilters);
  const [metric, setMetric] = useState<Metric>("leads");
  const [viewId, setViewId] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const availableOwners = new Map(data.records.map((row) => [reportOwner(row), row.officer || "Unassigned"]));
  if (filters.owner && !availableOwners.has(filters.owner)) availableOwners.set(filters.owner, "Saved officer");
  const valid = reportFilters.safeParse(filters);
  const rows = reportRows(data.records, filters, now);
  const drill = rows[metric].filter((row) => !group || group === JSON.stringify([reportOwner(row), row.source]));
  const conversionGroups = new Map<string, typeof rows.leads>();
  for (const row of rows.leads) {
    const key = JSON.stringify([reportOwner(row), row.source]);
    const existing = conversionGroups.get(key);
    if (existing) existing.push(row);
    else conversionGroups.set(key, [row]);
  }
  const changed = (next: Partial<ReportFilters>) => {
    setFilters({ ...filters, ...next });
    setViewId("");
    setGroup("");
  };

  return <section className="integration record-form manager-panel" aria-label="Manager reporting">
    <div className="form-grid">
      <label className="field">From<input type="date" value={filters.from} onChange={(event) => changed({ from: event.target.value })} /></label>
      <label className="field">Through<input type="date" value={filters.through} onChange={(event) => changed({ through: event.target.value })} /></label>
      <label className="field">Officer<select value={filters.owner} onChange={(event) => changed({ owner: event.target.value })}>
        <option value="">All officers</option>
        {[...availableOwners].map(([key, label]) => <option key={key} value={key}>{label}{key.startsWith("email:") ? ` · ${key.slice(6)}` : ""}</option>)}
      </select></label>
      <label className="field">Lead source<select value={filters.source} onChange={(event) => changed({ source: event.target.value as ReportFilters["source"] })}>
        <option value="">All sources</option>{leadSources.map((source) => <option key={source}>{source}</option>)}
      </select></label>
    </div>
    {!valid.success && <p role="alert">Choose an end date on or after the start date.</p>}
    <div className="form-grid">
      <label className="field">Saved brokerage views<select value={viewId} onChange={(event) => {
        const view = data.views.find((item) => item.id === event.target.value);
        setViewId(view?.id ?? "");
        setFilters(view?.filters ?? defaultReportFilters);
        setGroup("");
      }}><option value="">Choose a view</option>{data.views.map((view) => <option value={view.id} key={view.id}>{view.name}</option>)}</select></label>
      <form className="task-form" onSubmit={(event) => {
        event.preventDefault();
        if (!valid.success || !name.trim()) return;
        const id = crypto.randomUUID();
        void save({ type: "saveReportView", id, name, filters }, () => { setViewId(id); setName(""); });
      }}><label className="field">New view name<input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <Button size="sm" type="submit" disabled={busy || !valid.success || !name.trim()}>Save view</Button>
      </form>
    </div>
    {viewId && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => {
      if (window.confirm("Remove this saved view from the brokerage?")) void save({ type: "deleteReportView", id: viewId }, () => setViewId(""));
    }}>Remove saved view</Button></div>}
    <p className="muted">Lead response and conversion use the lead creation date and current owner. Projected funding uses the target closing date on active unfunded loans. Actual funding uses the recorded funding date.</p>
    {valid.success && <>
      <div className="loan-application-actions">
        {metrics.map(([key, label]) => <Button key={key} variant={metric === key && !group ? "default" : "outline"} size="sm"
          onClick={() => { setMetric(key); setGroup(""); }}>
          {label} · {rows[key].length}{(key === "projected" || key === "funded") && ` · ${money(totalAmount(rows[key]))}`}
        </Button>)}
      </div>
      <div className="table-scroll"><table className="data-table"><caption>Response and conversion by officer and source</caption>
        <thead><tr><th>Officer</th><th>Lead source</th><th>Leads</th><th>First outreach</th><th>Average response</th><th>Submitted 1003</th><th>Funded</th></tr></thead>
        <tbody>{[...conversionGroups].map(([key, items]) => {
          const first = items[0];
          const response = items.filter((row) => rows.responded.includes(row));
          const minutes = response.reduce((sum, row) => sum + (Date.parse(row.firstContactAt!) - Date.parse(row.createdAt!)) / 60_000, 0);
          const cell = (kind: Metric, rate = false) => {
            const count = items.filter((row) => rows[kind].includes(row)).length;
            return <Button variant="ghost" size="sm" onClick={() => { setMetric(kind); setGroup(key); }}>
              {count}{rate && ` · ${percent(count, items.length)}`}
            </Button>;
          };
          return <tr key={key}><td>{first.officer || "Unassigned"}</td><td>{first.source}</td><td>{cell("leads")}</td>
            <td>{cell("responded", true)}</td><td>{response.length ? `${Math.round(minutes / response.length)} min` : "—"}</td>
            <td>{cell("submitted", true)}</td><td>{cell("converted", true)}</td></tr>;
        })}</tbody>
      </table></div>
      <div className="work-queue">
        <h3>{metrics.find(([key]) => key === metric)?.[1]} · {drill.length} records{group ? " in selected group" : ""}</h3>
        {!drill.length ? <p className="muted">No records match this view.</p> : <ul className="loan-task-list">{drill.map((row) => <li className="loan-task" key={row.id}>
          <div className="loan-task-copy"><strong>{row.name}</strong><span>{row.officer || "Unassigned"} · {row.source}</span>
            <span>{metric === "funded" || metric === "converted" ? `Funded ${row.fundingDate} · ${money(row.amount)}` :
              metric === "projected" ? `Target ${row.targetDate} · ${money(row.amount)}` :
              metric === "submitted" ? `Submitted ${dateTime(row.submittedAt!)}` :
              metric === "responded" ? `Outreach ${dateTime(row.firstContactAt!)}` : metric === "overdue" ? `Due ${dateTime(row.dueAt!)}` :
              row.resolvedAt && !row.loanId ? "Dismissed" : `Created ${dateTime(row.createdAt!)}`}</span></div>
          {row.loanId ? <Button size="sm" variant="outline" onClick={() => openLoan(row.loanId!)}>Open loan</Button> :
            row.leadId && !row.resolvedAt && <Button size="sm" variant="outline" onClick={() => openLead(row.leadId!)}>Open lead</Button>}
        </li>)}</ul>}
      </div>
    </>}
  </section>;
}

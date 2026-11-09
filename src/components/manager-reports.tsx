"use client";

import { useState } from "react";
import { leadSources, type ContactActivity } from "@/lib/model";
import { defaultReportFilters, reportDateInRange, reportFilters, reportOwner, reportRows, type ManagerReports as ReportData,
  type ReportFilters, type ReturningClientMetric, type ReturningClientReportRow } from "@/lib/manager-report-model";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import type { CallCampaign } from "@/lib/call-campaign-model";
import type { CrmSegment } from "@/lib/crm-segment-model";
import type { BrokerageMember } from "@/lib/brokerage-model";
import { BorrowerCallbackReschedule, ContactFollowUpAssignment, ContactFollowUpCompletion } from "./contact-crm";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
const metrics = [
  ["leads", "Leads"], ["responded", "First outreach logged"], ["overdue", "First contact overdue"],
  ["submitted", "1003s submitted"], ["converted", "Leads funded"], ["projected", "Projected funding"], ["funded", "Actual funding"],
] as const;
type Metric = (typeof metrics)[number][0];
const totalAmount = (rows: ReturnType<typeof reportRows>[Metric]) => rows.reduce((sum, row) => sum + row.amount, 0);
const percent = (count: number, total: number) => total ? `${Math.round(count / total * 100)}%` : "—";

const returningMetrics = [
  ["check-ins", "Completed check-ins"], ["callbacks", "Open callbacks"], ["applications", "Returning-client 1003s"],
] as const;

export function ReturningClientReports({ rows, contactActivity, members, ownerError, busy, save, refresh, openApplication, openContact }: {
  rows: ReturningClientReportRow[]; busy: boolean; refresh: () => void;
  contactActivity: ContactActivity[]; members?: BrokerageMember[]; ownerError: string; save: Save;
  openApplication: (loanId: string) => void; openContact: (contactId: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [selected, select] = useState<{ metric: ReturningClientMetric; owner?: string }>({ metric: "check-ins" });
  const valid = !from || !through || from <= through;
  const filtered = valid ? rows.filter((row) => reportDateInRange(row.at, from, through)) : [];
  const groups = new Map<string, ReturningClientReportRow[]>();
  for (const row of filtered) {
    const key = reportOwner(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const owners = [...groups].sort(([, a], [, b]) => a[0].officer.localeCompare(b[0].officer));
  const active = selected.owner ? groups.get(selected.owner) ?? [] : filtered;
  const drill = active.filter((row) => row.metric === selected.metric)
    .sort((a, b) => selected.metric === "callbacks" ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at));
  const callbacks = new Map(contactActivity.filter((item) => item.postFundingCheckIn && item.dueAt && !item.completedAt &&
    item.outcome === "Requested callback").map((item) => [item.id, item]));
  const selectedLabel = returningMetrics.find(([key]) => key === selected.metric)?.[1];
  const count = (records: ReturningClientReportRow[], metric: ReturningClientMetric) => records.filter((row) => row.metric === metric).length;

  return <section className="integration record-form manager-panel" aria-label="Returning-client reporting">
    <div className="section-heading"><h2>Returning-client activity</h2>
      <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>Refresh report</Button></div>
    <div className="form-grid">
      <label className="field">From<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); select({ metric: selected.metric }); }} /></label>
      <label className="field">Through<input type="date" value={through} onChange={(event) => { setThrough(event.target.value); select({ metric: selected.metric }); }} /></label>
    </div>
    <details className="document-form"><summary>How returning-client activity is counted</summary>
      <p className="muted">Check-ins use the completion date and funded loan owner. Callbacks use the due date and assignee, excluding blocked prospecting. Repeat 1003s use the new lead’s creation date and owner.</p>
    </details>
    {!valid ? <p role="alert">Choose an end date on or after the start date.</p> : <>
      <div className="loan-application-actions" role="group" aria-label="Returning-client totals">
        {returningMetrics.map(([key, label]) => <Button key={key} size="sm"
          variant={selected.metric === key && !selected.owner ? "default" : "outline"} aria-pressed={selected.metric === key && !selected.owner}
          onClick={() => select({ metric: key })}>{label} · {count(filtered, key)}</Button>)}
      </div>
      {owners.length ? <div className="table-scroll"><table className="data-table">
        <caption>Returning-client activity by officer</caption>
        <thead><tr><th>Officer</th>{returningMetrics.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
        <tbody>{owners.map(([key, group]) => {
          const officer = group[0].officer || "Unassigned";
          return <tr key={key}><th scope="row">{officer}{group[0].officerEmail && <small>{group[0].officerEmail}</small>}</th>
            {returningMetrics.map(([metric, label]) => <td key={metric}><Button variant="ghost" size="sm"
              aria-pressed={selected.metric === metric && selected.owner === key}
              aria-label={`${label} for ${officer} · ${count(group, metric)}`}
              onClick={() => select({ metric, owner: key })}>{count(group, metric)}</Button></td>)}</tr>;
        })}</tbody>
      </table></div> : <p className="muted">No returning-client activity in this date range.</p>}
      <section className="work-queue" aria-label="Returning-client report details">
        <h3>{selectedLabel} · {drill.length} {drill.length === 1 ? "record" : "records"}{selected.owner && active.length > 0 && ` · ${active[0].officer || "Unassigned"}`}</h3>
        {selected.metric === "callbacks" && drill.length > 0 && ownerError && <p role="alert">{ownerError}</p>}
        {drill.length ? <ul className="loan-task-list">{drill.map((row) => {
          const callback = row.metric === "callbacks" ? callbacks.get(row.id) : undefined;
          return <li className="loan-task" key={row.id}>
            <div className="loan-task-copy"><strong>{row.name}</strong><span>{row.officer || "Unassigned"} · {row.detail}</span>
              <span>{row.metric === "callbacks" ? "Due" : row.metric === "applications" ? "Lead created" : "Completed"} {dateTime(row.at)} ET</span>
              {callback && <ContactFollowUpCompletion item={callback} busy={busy} save={save} />}
              {callback && <BorrowerCallbackReschedule item={callback} busy={busy} save={save} />}
              {callback && members && <ContactFollowUpAssignment item={callback} members={members} busy={busy}
                save={(input) => save(input, ({ state }) => {
                  const updated = state.managerReports?.returningClients.find((item) => item.metric === "callbacks" && item.id === row.id);
                  if (updated) select((current) => current.metric === "callbacks" && current.owner === reportOwner(row)
                    ? { metric: "callbacks", owner: reportOwner(updated) } : current);
                })} />}
            </div>
            {row.metric === "applications" && row.loanId
              ? <Button variant="outline" size="sm" onClick={() => openApplication(row.loanId!)}>Open 1003</Button>
              : <Button variant="outline" size="sm" onClick={() => openContact(row.contactId)}>Open borrower history</Button>}
          </li>;
        })}</ul> : <p className="muted">No records match this selection.</p>}
      </section>
    </>}
  </section>;
}

export function ManagerReports({ data, campaigns, segments, now, busy, save, openLoan, openLead }: {
  data: ReportData; campaigns: CallCampaign[]; segments: CrmSegment[]; now: number; busy: boolean; save: Save; openLoan: (id: string) => void; openLead: (id: string) => void;
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
      <label className="field">Call campaign<select value={filters.campaign} onChange={(event) => changed({ campaign: event.target.value })}>
        <option value="">All campaigns and other leads</option>
        {campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}
        {filters.campaign && !campaigns.some((campaign) => campaign.id === filters.campaign) && <option value={filters.campaign}>Campaign removed</option>}
      </select></label>
      <label className="field">CRM segment<select value={filters.segment} onChange={(event) => changed({ segment: event.target.value })}>
        <option value="">All segments and other leads</option>
        {segments.map((segment) => <option value={segment.id} key={segment.id}>{segment.name}</option>)}
        {filters.segment && !segments.some((segment) => segment.id === filters.segment) && <option value={filters.segment}>Segment unavailable</option>}
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
    <details className="document-form"><summary>How these totals are calculated</summary>
      <p className="muted">Lead response and conversion use the lead creation date and current owner. Projected funding uses the target closing date on active unfunded loans. Actual funding uses the recorded funding date.</p>
    </details>
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
          <div className="loan-task-copy"><strong>{row.name}</strong><span>{[row.officer || "Unassigned", row.source, row.campaignName, row.segmentName].filter(Boolean).join(" · ")}</span>
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

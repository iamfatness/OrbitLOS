"use client";

import { useEffect, useState } from "react";
import { readCampaignCallbackPerformance } from "@/app/actions";
import { callbackPerformanceStatuses, type CallbackPerformancePage, type CallbackPerformanceQuery } from "@/lib/campaign-callback-performance-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function CampaignCallbackPerformance({ brokerageId, campaignId, version }: {
  brokerageId: string; campaignId: string; version: object;
}) {
  const [query, setQuery] = useState<CallbackPerformanceQuery>({ campaignId });
  const [data, setData] = useState<{ query: CallbackPerformanceQuery; version: object; result: CallbackPerformancePage | { error: string } }>();

  useEffect(() => {
    let active = true;
    const update = (result: CallbackPerformancePage | { error: string }) => {
      if (active) setData({ query, version, result });
    };
    void readCampaignCallbackPerformance(query, brokerageId).then(update, () => update({ error: "Could not load callback performance. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, query, version]);

  const current = data?.query === query && data.version === version ? data.result : undefined;
  const page = current && !("error" in current) ? current : undefined;
  const firstPage = () => setQuery({ campaignId, status: query.status });

  return <section className="work-queue" aria-label="Campaign callback performance">
    <div><h3>Promised callbacks</h3>
      <p className="muted">Requests logged since tracking began, within the last 30 days for this campaign. A logged call counts as an attempt, including voicemail or no answer.</p>
      <p className="muted">A callback moved before its deadline uses the revised time. A later change preserves the missed deadline.</p>
    </div>
    <div className="loan-application-actions">
      <label className="field">Callback outcome
        <select value={query.status ?? ""} onChange={(event) => {
          const status = callbackPerformanceStatuses.find((entry) => entry === event.target.value);
          setQuery({ campaignId, status });
        }}>
          <option value="">All outcomes</option>
          {callbackPerformanceStatuses.map((status) => <option key={status} value={status}>{status}{page ? ` (${page.counts[status]})` : ""}</option>)}
        </select>
      </label>
      <Button variant="outline" size="sm" onClick={firstPage}>Refresh callback report</Button>
    </div>
    {!current && <p className="muted" role="status">Loading callback performance…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {page && <>
      <div className="loan-application-actions" aria-label="Callback totals">
        <span className="pill">{page.counts["On time"]} on time</span>
        <span className="pill">{page.counts.Late} late</span>
        <span className="pill">{page.counts.Overdue} overdue</span>
      </div>
      {page.items.length ? <ul className="document-list">{page.items.map((row) => <li className="document-item" key={row.id}>
        <div className="document-item-head"><strong>{row.name}</strong><span className={row.status === "Overdue" || row.status === "Late" ? "open-chip" : "pill"}>{row.status}</span></div>
        <p className="muted">{row.continuedOnLoan ? "Continued on loan · Current LO" : "Current lead owner"} · {row.owner}</p>
        <p>Measured deadline · <time dateTime={row.dueAt}>{dateTime(row.dueAt, "medium")} ET</time></p>
        {row.scheduledAt && <p className="muted">Scheduled callback · <time dateTime={row.scheduledAt}>{dateTime(row.scheduledAt, "medium")} ET</time></p>}
        {row.originalDueAt !== row.dueAt && <p className="muted">Originally due · {dateTime(row.originalDueAt, "medium")} ET</p>}
        {row.closedAt && <p className="muted">{row.status === "Closed without attempt" ? "Closed" : "Attempted"} · {dateTime(row.closedAt, "medium")} ET{row.closeReason && ` · ${row.closeReason}`}</p>}
        {(row.request || row.attempt) && <details className="document-form">
          <summary>View call history</summary>
          {row.request && <p><strong>Request · {row.request.actor} · {dateTime(row.request.at, "medium")} ET</strong><br />{row.request.text}</p>}
          {row.attempt && <p><strong>Attempt · {row.attempt.actor} · {dateTime(row.attempt.at, "medium")} ET</strong><br />{row.attempt.text}</p>}
        </details>}
      </li>)}</ul> : <p className="empty-inline">No promised callbacks match this view.</p>}
      {(query.after || page.next) && <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={firstPage}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: page.next ?? undefined })}>Next page</Button>}
      </div>}
    </>}
  </section>;
}

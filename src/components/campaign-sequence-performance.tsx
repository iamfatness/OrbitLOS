"use client";

import { useEffect, useState } from "react";
import { readCampaignSequencePerformance } from "@/app/actions";
import type { CampaignManagerRecord } from "@/lib/campaign-manager-model";
import { sequencePerformanceMetrics, type SequenceDrilldown, type SequencePerformanceMetric,
  type SequencePerformancePage, type SequencePerformanceQuery } from "@/lib/campaign-sequence-performance-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const labels: Record<SequencePerformanceMetric, string> = { touches: "Touches", replies: "Replies", stalled: "Stalled" };
type Result = SequencePerformancePage | { error: string };

function focusDrilldown(section: HTMLElement | null) {
  section?.focus();
}

export function CampaignSequencePerformance({ brokerageId, campaignId, workspaceVersion, openRecord }: {
  brokerageId: string; campaignId: string; workspaceVersion: object; openRecord: (record: CampaignManagerRecord) => void;
}) {
  const [query, setQuery] = useState<SequencePerformanceQuery>({ campaignId });
  const [data, setData] = useState<{ query: SequencePerformanceQuery; workspaceVersion: object; result: Result }>();
  useEffect(() => {
    let active = true;
    const update = (result: Result) => { if (active) setData({ query, workspaceVersion, result }); };
    void readCampaignSequencePerformance(query, brokerageId).then(update,
      () => update({ error: "Could not load sequence performance. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, query, workspaceVersion]);

  const current = data?.workspaceVersion === workspaceVersion ? data : undefined;
  const previous = current && !("error" in current.result) ? current.result : undefined;
  const summary = query.version === undefined || query.version === previous?.version ? previous : undefined;
  const result = current?.query === query ? current.result : undefined;
  const detail = result && !("error" in result) ? result : undefined;
  const selection = query.drilldown;
  const selectedVersion = query.version ?? summary?.version;
  const select = (drilldown: SequenceDrilldown) => setQuery({ campaignId, version: selectedVersion ?? undefined, drilldown });
  const detailTitle = selection?.metric === "unattributed" ? "Unattributed replies" :
    selection ? `Step ${selection.position + 1} · ${labels[selection.metric]}` : "";

  return <section className="document-section" aria-label="Campaign sequence performance">
    <p className="muted">Each lead’s first logged reply is credited to its latest tracked sequence touch. Stalled means the current active step is past due. Email and text touches are simulated.</p>
    <div className="loan-application-actions">
      {!!previous?.versions.length && <label className="field">Sequence version
        <select value={selectedVersion ?? ""} onChange={(event) => setQuery({ campaignId, version: Number(event.target.value) })}>
          {previous.versions.map(({ kind, version, enrolled }) => <option key={version} value={version}>{kind} v{version} · {enrolled} enrolled</option>)}
        </select>
      </label>}
      <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, page: 1 })}>Refresh sequence report</Button>
    </div>
    {!result && <p className="muted" role="status">Loading sequence performance…</p>}
    {result && "error" in result && <p role="alert">{result.error}</p>}
    {summary?.version === null && <p className="empty-inline">This campaign has no sequence enrollments yet.</p>}
    {!!summary?.steps.length && <>
      <ul className="document-list" aria-label="Sequence steps">
        {summary.steps.map((step, position) => <li key={position} className="document-item">
          <div className="document-item-head"><strong>Step {position + 1} · {step.title}</strong><span className="pill">{step.channel}</span></div>
          <div className="loan-application-actions" role="group" aria-label={`Step ${position + 1} performance`}>
            {sequencePerformanceMetrics.map((metric) => <Button key={metric} size="sm" variant="outline"
              disabled={step[metric] === 0} aria-pressed={selection?.metric === metric && selection.position === position}
              onClick={() => select({ metric, position })}>{labels[metric]} · {step[metric]}</Button>)}
          </div>
        </li>)}
      </ul>
      <div className="loan-application-actions">
        <Button size="sm" variant="outline" disabled={summary.unattributed === 0} aria-pressed={selection?.metric === "unattributed"}
          onClick={() => select({ metric: "unattributed" })}>Unattributed replies · {summary.unattributed}</Button>
        <span className="muted">Replies without an earlier tracked touch, including older activity.</span>
      </div>
    </>}
    {detail && selection && <section className="document-section" aria-label={detailTitle} tabIndex={-1} ref={focusDrilldown}>
      <h4>{detailTitle}</h4>
      {detail.items.length ? <ul className="document-list">{detail.items.map((record) => <li className="document-item" key={record.leadId}>
        <div className="document-item-head"><strong>{record.name}</strong><span className="pill">{record.owner}</span></div>
        {record.when && <p className="muted">{selection.metric === "stalled" ? "Due" : "Reply logged"} · <time dateTime={record.when}>{dateTime(record.when)} ET</time></p>}
        <div><Button size="sm" variant="outline" aria-label={`Open ${record.name}`} onClick={() => openRecord(record)}>
          {record.loanId ? "Open loan" : record.archived ? "Open archived lead" : "Open lead"}
        </Button></div>
      </li>)}</ul> : <p className="empty-inline">No leads match this count now.</p>}
      {detail.pages > 1 && <div className="loan-application-actions">
        <Button size="sm" variant="outline" disabled={detail.page === 1} onClick={() => setQuery({ ...query, page: detail.page - 1 })}>Previous page</Button>
        <span className="muted">Page {detail.page} of {detail.pages}</span>
        <Button size="sm" variant="outline" disabled={detail.page === detail.pages} onClick={() => setQuery({ ...query, page: detail.page + 1 })}>Next page</Button>
      </div>}
    </section>}
  </section>;
}

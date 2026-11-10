"use client";

import { useEffect, useState } from "react";
import { readCampaignManager } from "@/app/actions";
import { campaignManagerViews, type CampaignManagerPage, type CampaignManagerRecord, type CampaignManagerView } from "@/lib/campaign-manager-model";
import { dateTime } from "@/lib/utils";
import { CampaignSequenceToggle } from "./campaign-sequence";
import { CampaignSequencePerformance } from "./campaign-sequence-performance";
import { Button } from "./ui/button";

const labels: Record<CampaignManagerView, string> = {
  overdue: "Overdue follow-ups", paused: "Paused sequences", replies: "Replies", conversions: "Conversions", optOuts: "Opt-outs",
};
const empty: Record<CampaignManagerView, string> = {
  overdue: "No overdue sequence steps, callbacks, or retries in this campaign.",
  paused: "No sequences are paused in this campaign.",
  replies: "No replies have been logged on leads in this campaign.",
  conversions: "No leads in this campaign have started a 1003.",
  optOuts: "No leads in this campaign have opted out.",
};
type Selection = { view: CampaignManagerView; page: number };
type Result = CampaignManagerPage | { error: string };

export function CampaignManager({ brokerageId, campaignId, campaignName, version, busy, save, openRecord }: {
  brokerageId: string; campaignId: string; campaignName: string; version: object; openRecord: (row: CampaignManagerRecord) => void;
  busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const [selection, setSelection] = useState<Selection>({ view: "overdue", page: 1 });
  const [sequenceReportOpen, setSequenceReportOpen] = useState(false);
  const [data, setData] = useState<{ selection: Selection; version: object; result: Result }>();
  useEffect(() => {
    let active = true;
    const update = (result: Result) => { if (active) setData({ selection, version, result }); };
    void readCampaignManager({ campaignId, ...selection }, brokerageId).then(update,
      () => update({ error: "Could not load the campaign manager report. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, campaignId, selection, version]);

  const current = data?.version === version ? data : undefined;
  const totals = current && !("error" in current.result) ? current.result.counts : undefined;
  const result = current?.selection === selection ? current.result : undefined;
  const page = result && !("error" in result) ? result : undefined;

  return <section className="work-queue" aria-label="Campaign manager report">
    <div>
      <h3>Manager view · {campaignName}</h3>
      <p className="muted">Counts cover the entire campaign and include shared leads. Each count lists unique leads. A conversion means a 1003 was started.</p>
    </div>
    <div className="loan-application-actions" role="group" aria-label="Campaign outcome counts">
      {campaignManagerViews.map((view) => <Button key={view} variant={selection.view === view ? "default" : "outline"} size="sm"
        aria-pressed={selection.view === view} onClick={() => setSelection({ view, page: 1 })}>
        {labels[view]}{totals ? ` · ${totals[view]}` : ""}
      </Button>)}
      <Button variant="outline" size="sm" onClick={() => setSelection({ view: selection.view, page: 1 })}>Refresh manager view</Button>
    </div>
    <details className="document-form" onToggle={(event) => setSequenceReportOpen(event.currentTarget.open)}>
      <summary>Sequence performance</summary>
      {sequenceReportOpen && <CampaignSequencePerformance brokerageId={brokerageId} campaignId={campaignId} workspaceVersion={version} openRecord={openRecord} />}
    </details>
    {!result && <p className="muted" role="status">Loading campaign outcomes…</p>}
    {result && "error" in result && <p role="alert">{result.error}</p>}
    {page && <>
      {page.items.length ? <ul className="document-list" aria-label={labels[selection.view]}>{page.items.map((row) =>
        <li className="document-item" key={row.leadId}>
          <div className="document-item-head"><strong>{row.name}</strong><span className="pill">{row.owner}</span></div>
          {selection.view === "overdue" && <ul>{row.overdue.map((work) => <li key={work.title}>
            {work.title} · <time dateTime={work.dueAt}>{dateTime(work.dueAt, "medium")} ET</time>
          </li>)}</ul>}
          {row.sequence?.paused && <p className="muted">
            {row.sequence.kind} · Paused at step {row.sequence.position + 1} · {row.sequence.title} · Scheduled for {dateTime(row.sequence.dueAt)} ET.
            {row.sequence.held && " Reactivate this lead to resume its sequence."}
          </p>}
          <div className="loan-application-actions"><Button size="sm" variant="outline" aria-label={`Open ${row.name}`} onClick={() => openRecord(row)}>
            {row.loanId ? "Open loan" : row.archived ? "Open archived lead" : "Open lead"}
          </Button>
            {row.sequence && !row.sequence.held && <CampaignSequenceToggle campaignId={campaignId} leadId={row.leadId}
              revision={row.sequence.revision} paused={row.sequence.paused} busy={busy} save={save} />}
          </div>
        </li>)}</ul> : <p className="empty-inline" role="status">{empty[selection.view]}</p>}
      {page.pages > 1 && <div className="loan-application-actions">
        <Button size="sm" variant="outline" disabled={page.page === 1}
          onClick={() => setSelection({ view: selection.view, page: page.page - 1 })}>Previous page</Button>
        <span className="muted">Page {page.page} of {page.pages}</span>
        <Button size="sm" variant="outline" disabled={page.page === page.pages}
          onClick={() => setSelection({ view: selection.view, page: page.page + 1 })}>Next page</Button>
      </div>}
    </>}
  </section>;
}

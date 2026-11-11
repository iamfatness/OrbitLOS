"use client";

import { useEffect, useRef, useState } from "react";
import { readCampaignManager, readLeadForWork } from "@/app/actions";
import { campaignManagerViews, type CampaignManagerPage, type CampaignManagerRecord, type CampaignManagerView } from "@/lib/campaign-manager-model";
import { dateTime } from "@/lib/utils";
import { CampaignSequenceToggle } from "./campaign-sequence";
import { CampaignSequencePerformance } from "./campaign-sequence-performance";
import { CampaignAssignments } from "./campaign-assignments";
import { assignableCampaignLead } from "@/lib/call-campaign-model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
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

export function CampaignManager({ brokerageId, campaignId, campaignName, version, busy, save, openRecord, staff }: {
  brokerageId: string; campaignId: string; campaignName: string; version: object; openRecord: (row: CampaignManagerRecord) => void;
  busy: boolean; staff: WorkspaceStaff | null; save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
}) {
  const [assigning, setAssigning] = useState<string>();
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const notice = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (assignmentNotice) notice.current?.focus(); }, [assignmentNotice]);
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
      <h3 ref={heading} tabIndex={-1} className="crm-preview-summary">Manager view · {campaignName}</h3>
      <p className="muted">Counts cover the entire campaign and include shared leads. Each count lists unique leads. A conversion means a 1003 was started.</p>
    </div>
    {assignmentNotice && <p ref={notice} tabIndex={-1} className="crm-preview-summary" role="status">{assignmentNotice}</p>}
    <div className="loan-application-actions" role="group" aria-label="Campaign outcome counts">
      {campaignManagerViews.map((view) => <Button key={view} variant={selection.view === view ? "default" : "outline"} size="sm"
        aria-pressed={selection.view === view} onClick={() => { setAssigning(undefined); setAssignmentNotice(""); setSelection({ view, page: 1 }); }}>
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
            {!row.loanId && !row.archived && (selection.view === "overdue" || selection.view === "paused") &&
              <Button size="sm" variant="outline" disabled={busy} aria-expanded={assigning === row.leadId}
                aria-label={`Assign owner for ${row.name}`} onClick={() => {
                  setAssignmentNotice(""); setAssigning(assigning === row.leadId ? undefined : row.leadId);
                }}>Assign owner</Button>}
            {row.sequence && !row.sequence.held && <CampaignSequenceToggle campaignId={campaignId} leadId={row.leadId}
              revision={row.sequence.revision} paused={row.sequence.paused} busy={busy} save={save} />}
          </div>
          {assigning === row.leadId && <ManagerAssignment key={row.leadId} brokerageId={brokerageId} campaignId={campaignId}
            leadId={row.leadId} staff={staff} version={version} busy={busy} save={save} done={() => {
              setAssigning(undefined); setAssignmentNotice(`Assignment saved for ${row.name}. Deadlines and callbacks stay with the lead.`);
            }} close={() => { setAssigning(undefined); requestAnimationFrame(() => heading.current?.focus()); }} />}
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

function ManagerAssignment({ brokerageId, campaignId, leadId, staff, version, busy, save, done, close }: {
  brokerageId: string; campaignId: string; leadId: string; staff: WorkspaceStaff | null; version: object; busy: boolean;
  save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>; done: () => void; close: () => void;
}) {
  const [data, setData] = useState<{ version: object; result: Awaited<ReturnType<typeof readLeadForWork>> }>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void readLeadForWork({ leadId }, brokerageId).then((result) => {
      if (active) { setData({ version, result }); setFailed(false); }
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [brokerageId, leadId, version, retry]);
  const result = data?.version === version ? data.result : undefined;
  const lead = result && "lead" in result && result.campaign?.id === campaignId && assignableCampaignLead(result.lead) ? result.lead : undefined;
  return <div className="record-form">
    {!result && !failed && <p role="status">Loading current assignment�</p>}
    {failed && <p role="alert">Could not load the current assignment. Try again.</p>}
    {result && !lead && <p role="alert">{"error" in result ? result.error : "This lead is no longer eligible for campaign assignment. Refresh the manager view."}</p>}
    {lead && <CampaignAssignments campaignId={campaignId} leads={[lead]} staff={staff} busy={busy} direct
      save={(input) => save(input, done)} />}
    <div className="loan-application-actions">
      {(failed || (result && !lead)) && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setFailed(false); setData(undefined); setRetry((value) => value + 1); }}>Retry assignment</Button>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={close}>Close assignment</Button>
    </div>
  </div>;
}

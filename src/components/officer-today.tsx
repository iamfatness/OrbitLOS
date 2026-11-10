"use client";

import { useEffect, useState } from "react";
import { readConversationWork, readMyTasksToday } from "@/app/actions";
import type { ConversationResult } from "@/lib/conversation-model";
import { observeTabReturn, observeVisibleChecks } from "@/lib/tab-return";
import { dateLabel, easternDate } from "@/lib/client-retention";
import type { RetentionOpportunity } from "@/lib/officer-dashboard-model";
import { queueActionLabel, type OfficerQueueItem, type OfficerQueuePage, type OfficerQueueQuery } from "@/lib/officer-queue-model";
import { dateTime } from "@/lib/utils";
import type { IncomingLoanWorkItem } from "@/lib/incoming-loan-work-model";
import { IncomingLoanWorkQueue } from "./incoming-loan-work-queue";
import { ConversationReplies } from "./conversation-replies";
import { OfficerOpportunities, OfficerProduction, StalledLoans } from "./officer-dashboard";
import { Button } from "./ui/button";

const todayViews = ["My Tasks", "Stalled loans", "My production", "Past-client opportunities"] as const;

export function OfficerToday({ brokerageId, version, busy, reviewingLoan, openIncomingLoanWork, openWork, save, openReply, openTasks, openStalled, refreshStalled, openFunding, openOpportunity, openPastClients }: {
  brokerageId: string; version: object; busy: boolean; openWork: (item: OfficerQueueItem) => void; openTasks: () => void;
  save: (input: unknown) => Promise<void>;
  reviewingLoan: boolean; openIncomingLoanWork: (item: IncomingLoanWorkItem) => void;
  openReply: (id: string) => void; openFunding: (id: string) => void; openOpportunity: (item: RetentionOpportunity) => void;
  openPastClients: () => void; openStalled: (id: string) => void; refreshStalled: () => void;
}) {
  const [view, setView] = useState<(typeof todayViews)[number]>("My Tasks");
  const [query, setQuery] = useState<OfficerQueueQuery>({ horizon: 1 });
  const [deadlineRefresh, setDeadlineRefresh] = useState(0);
  const [data, setData] = useState<{ version: object; query: OfficerQueueQuery; result: OfficerQueuePage | { error: string } }>();
  const [replyData, setReplyData] = useState<{ brokerageId: string; version: object; query: OfficerQueueQuery;
    result: Extract<ConversationResult, { kind: "replies" } | { error: string }> }>();
  useEffect(() => {
    if (view !== "My Tasks") return;
    let active = true;
    const update = (result: OfficerQueuePage | { error: string }) => { if (active) setData({ version, query, result }); };
    void readMyTasksToday(query, brokerageId).then(update, () => update({ error: "Could not load My Tasks today. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, deadlineRefresh, query, version, view]);
  const watchReplies = view === "My Tasks" && !query.replyAfter && !busy && !reviewingLoan;
  useEffect(() => {
    if (!watchReplies) return;
    let active = true;
    let reading = false;
    async function checkReplies(isCurrent: () => boolean) {
      if (reading) return;
      reading = true;
      try {
        const result = await readConversationWork({ type: "myReplies" }, brokerageId);
        if (active && isCurrent() && ("error" in result || result.kind === "replies")) setReplyData({ brokerageId, version, query, result });
      } catch {
        // Keep the last reply page during temporary network failures.
      } finally { reading = false; }
    }
    const stopReturn = observeTabReturn(document, window, (isCurrent) => void checkReplies(isCurrent));
    const stopChecks = observeVisibleChecks(document, window, checkReplies);
    return () => { active = false; stopReturn(); stopChecks(); };
  }, [brokerageId, query, version, watchReplies]);

  const current = data?.version === version && data.query === query ? data.result : undefined;
  const page = current && !("error" in current) ? current : undefined;
  const replyResult = replyData?.brokerageId === brokerageId && replyData.version === version && replyData.query === query ? replyData.result : undefined;
  const replies = replyResult ? "error" in replyResult ? undefined : replyResult.page : page?.replies;
  const replyCheckedAt = replyResult && "checkedAt" in replyResult ? replyResult.checkedAt : page?.checkedAt;
  const today = replyCheckedAt ? easternDate(new Date(replyCheckedAt)) : "";
  const tasks = <section className="integration record-form manager-panel" aria-label="My Tasks today">
    <div className="section-heading"><h2>My Tasks today</h2>{page && <span className="pill">Checked {dateTime(page.checkedAt)} ET</span>}</div>
    <p className="muted">Open replies, first contacts, callbacks, lead and loan deadlines, and files returned by processing or a lender.</p>
    <IncomingLoanWorkQueue brokerageId={brokerageId} view="today" paused={busy || reviewingLoan} version={version} open={openIncomingLoanWork}
      onLeadDocumentChange={() => setDeadlineRefresh((count) => count + 1)} />
    {replyResult && "error" in replyResult && <p role="alert">{replyResult.error}</p>}
    {replies && <ConversationReplies page={replies} today={today} after={query.replyAfter} open={openReply}
      onPage={(replyAfter) => setQuery((last) => ({ ...last, replyAfter }))} />}
    <div className="loan-application-actions" role="group" aria-label="Work queue period">
      <Button size="sm" variant={query.horizon === 1 ? "default" : "outline"} aria-pressed={query.horizon === 1}
        onClick={() => setQuery((last) => ({ ...last, horizon: 1, after: undefined }))}>Due today</Button>
      <Button size="sm" variant={query.horizon === 7 ? "default" : "outline"} aria-pressed={query.horizon === 7}
        onClick={() => setQuery((last) => ({ ...last, horizon: 7, after: undefined }))}>Next 7 days</Button>
      <Button size="sm" variant="outline" onClick={() => setQuery({ horizon: query.horizon })}>Refresh My Tasks</Button>
      <Button size="sm" variant="ghost" onClick={openTasks}>Open full task queue</Button>
    </div>
    {!current && <p className="muted" role="status">Loading your due work…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {page && <>
      <div className="section-heading"><h3>Work through {dateLabel(page.through)}</h3><span className="pill">{page.items.length} on this page</span></div>
      {page.items.length ? <ul className="loan-task-list">{page.items.map((item) => {
        const deadline = item.handoffDueAt ?? item.dueAt;
        const step = item.sequence;
        const due = deadline <= page.checkedAt && !step?.waitUntil;
        return <li className={step ? "loan-task sequence-task" : "loan-task"} key={`${item.kind}:${item.id}`}>
          <div className="loan-task-copy"><strong>{item.title}</strong><span>{item.name}</span>
            {step && <span>Step {step.position + 1} · {step.channel}</span>}
            {step?.waitUntil ? <span>Outside preferred hours · Available {dateTime(step.waitUntil)} ET</span> :
              <span>{item.overdue ? "Overdue" : "Due"} · {deadline.length === 10 ? dateLabel(deadline) : `${dateTime(deadline)} ET`}</span>}</div>
          {step && step.channel !== "Call" ? <details className="document-form">
            <summary>Preview mock {step.channel.toLowerCase()}</summary>
            {step.recipient ? <><p className="muted">To {step.recipient}</p><p className="relationship-note">{step.body}</p></> :
              <p className="muted">This lead has no valid recipient for this step.</p>}
            <Button size="sm" variant="outline" disabled={busy || !due} onClick={async () => {
              await save({ type: "recordSequenceMock", leadId: item.recordId, version: step.version, position: step.position, recipient: step.recipient });
              setDeadlineRefresh((count) => count + 1);
            }}>{step.recipient ? `Record mock ${step.channel.toLowerCase()}` : "Skip unavailable recipient"}</Button>
          </details> : <Button size="sm" variant="outline" disabled={!!step && (busy || !due)} onClick={() => openWork(item)}>{queueActionLabel(item)}</Button>}
        </li>;
      })}</ul> : <p className="empty-inline">{page.next ? "No actionable items on this page. More work may be available on the next page." :
        query.after ? "No more actionable items in this window." : query.horizon === 1 ? "No work due today. Choose Next 7 days to see upcoming first contacts and follow-ups." :
          "You have no overdue or upcoming work in this window."}</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={() => setQuery((last) => ({ ...last, after: undefined }))}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: page.next ?? undefined })}>Next page</Button>}
      </div>
    </>}
  </section>;
  return <div className="relationship-stack">
    <div className="loan-application-actions" role="group" aria-label="Today views">{todayViews.map((label) =>
      <Button size="sm" key={label} variant={view === label ? "default" : "outline"} aria-pressed={view === label} onClick={() => setView(label)}>{label}</Button>,
    )}</div>
    {view === "My Tasks" && tasks}
    {view === "Stalled loans" && <StalledLoans brokerageId={brokerageId} version={version} busy={busy} openLoan={openStalled} onRefresh={refreshStalled} />}
    {view === "My production" && <OfficerProduction brokerageId={brokerageId} version={version} busy={busy} openLoan={openFunding} />}
    {view === "Past-client opportunities" && <OfficerOpportunities brokerageId={brokerageId} version={version} busy={busy} openTask={openOpportunity} openPastClients={openPastClients} />}
  </div>;
}

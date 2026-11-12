"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { readIncomingLoanWork } from "@/app/actions";
import type { IncomingLoanWorkItem, IncomingLoanWorkPage, IncomingLoanWorkQuery } from "@/lib/incoming-loan-work-model";
import { observeTabReturn, observeVisibleChecks } from "@/lib/tab-return";
import { dateTime } from "@/lib/utils";
import { manualReturnSteps } from "@/lib/lender-export-model";
import { Button } from "./ui/button";
import { LenderReturnFollowUp, lenderReturnFollowUpLabel } from "./lender-return-follow-up";

type ReviewResult = IncomingLoanWorkPage | { error: string };

export function IncomingLoanWorkQueue({ brokerageId, view, paused, version, open, onLeadDocumentChange }: {
  brokerageId: string; view: IncomingLoanWorkQuery["view"]; paused: boolean; version: object; open: (item: IncomingLoanWorkItem) => void;
  onLeadDocumentChange?: () => void;
}) {
  const [after, setAfter] = useState<IncomingLoanWorkQuery["after"]>();
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ brokerageId: string; view: IncomingLoanWorkQuery["view"]; after: IncomingLoanWorkQuery["after"]; result: ReviewResult }>();
  const leadDocuments = useRef<{ brokerageId: string; ids: string } | undefined>(undefined);
  const notifyLeadDocumentChange = useEffectEvent(() => onLeadDocumentChange?.());
  useEffect(() => {
    if (paused) return;
    let active = true;
    let reading = false;
    async function refresh(isCurrent: () => boolean, initial = false) {
      if (reading) return;
      reading = true;
      try {
        const result = await readIncomingLoanWork({ view, after }, brokerageId);
        if (!active || !isCurrent()) return;
        if (view === "today" && !after && !("error" in result)) {
          const ids = result.items.filter(({ kind }) => kind === "lead-document").map(({ id }) => id).sort().join(",");
          const previous = leadDocuments.current;
          leadDocuments.current = { brokerageId, ids };
          if (previous?.brokerageId === brokerageId && previous.ids !== ids) notifyLeadDocumentChange();
        }
        setData({ brokerageId, view, after, result });
      } catch {
        if (initial && active) setData({ brokerageId, view, after, result: { error: "Could not check incoming loan work." } });
      } finally { reading = false; }
    }
    void refresh(() => true, true);
    const stopReturn = observeTabReturn(document, window, (isCurrent) => void refresh(isCurrent));
    const stopChecks = !after ? observeVisibleChecks(document, window, refresh) : undefined;
    return () => { active = false; stopReturn(); stopChecks?.(); };
  }, [after, attempt, brokerageId, paused, version, view]);

  const result = data?.brokerageId === brokerageId && data.view === view && data.after === after ? data.result : undefined;
  const page = result && !("error" in result) ? result : undefined;
  return <section className="record-form" aria-label="Incoming loan work">
    <div className="section-heading"><h3 id={`incoming-${view}-heading`} tabIndex={-1}>Incoming loan work</h3>{page && <div className="loan-application-actions">
      {page.items.length > 0 && <span className="pill">{page.items.length} on this page</span>}
      <Button size="sm" variant="outline" disabled={paused} onClick={() => setAttempt((current) => current + 1)}>Refresh incoming work</Button>
    </div>}</div>
    {!result && <p className="muted" role="status">Checking for incoming work…</p>}
    {result && "error" in result && <div className="loan-application-actions"><p role="alert">{result.error}</p>
      <Button size="sm" variant="outline" disabled={paused} onClick={() => setAttempt((current) => current + 1)}>Retry</Button></div>}
    {page && (page.items.length ? <ul className="loan-task-list">{page.items.map((item) => {
      const action = item.returnStatus ? manualReturnSteps[item.returnStatus].action :
        item.kind === "application" ? "Review 1003" : item.kind === "document" ? "Review document" :
        item.kind === "lead-document" ? "Review lead document" : item.kind === "question" ? "Review borrower answer" :
          item.kind === "underwriting" ? "Open order" : item.kind === "realtor-financing" ? "Open financing summary" : "Open handoff";
      return <li className={item.returnEventId ? "loan-task lender-return-task" :
        item.kind === "realtor-financing" ? "loan-task realtor-financing-task" : "loan-task"} key={`${item.kind}:${item.id}:${item.returnEventId ?? ""}`}>
      <div className="loan-task-copy"><strong>{item.name} · {item.title}</strong>
        <span>{item.returnStatus ? `${item.returnStatus} · ` : item.kind === "application" ? "Submitted " :
          item.kind === "underwriting" ? "Ordered " : item.kind === "realtor-financing" ? "Permissions complete " : "Received "}{dateTime(item.receivedAt)} ET{item.linkedCondition && " · Lender condition"}{item.assignee && ` · ${item.assignee}`}</span>
        {item.returnDeadline && <span className={item.returnDeadline.overdue ? "open-chip" : "muted"}>
          {item.returnDeadline.overdue ? "Return overdue since" : "Follow up by"} {dateTime(item.returnDeadline.dueAt)} ET
        </span>}
        {item.note && <span>{item.note}</span>}
        {item.returnFollowUp ? <><span>{lenderReturnFollowUpLabel(item.returnFollowUp)}</span><span>{item.returnFollowUp.note}</span></> :
          item.returnEventId && <span className="muted">No follow-up logged yet.</span>}</div>
      <Button size="sm" variant="outline" disabled={paused} aria-label={item.kind === "underwriting" ?
        `Open order for ${item.name}, ${item.title.toLowerCase()}` :
        `${item.kind === "document" ? `Review ${item.title.toLowerCase()}` : action} for ${item.name}`}
        onClick={() => open(item)}>{action}</Button>
      {item.kind !== "lead-document" && item.returnEventId && <div className="lender-return-follow-up">
        <LenderReturnFollowUp brokerageId={brokerageId} loanId={item.loanId} name={item.name}
          lenderReturn={{ eventId: item.returnEventId, submissionId: item.returnSubmissionId === undefined ? item.id : item.returnSubmissionId }}
          latest={item.returnFollowUp} paused={paused}
          onSaved={() => setAttempt((current) => current + 1)} />
      </div>}
    </li>;})}</ul> : <p className="empty-inline">{page.next ? "No items on this page need attention. Check older incoming work." :
      after ? "No more incoming items need attention." : view === "today" ?
      "New 1003s, received documents, borrower answers, unconfirmed orders, and lender or processor returns appear here." :
      "Received documents, borrower answers, and ready handoffs on assigned files appear here."}</p>)}
    {(after || page?.next) && <div className="loan-application-actions">
      {after && <Button size="sm" variant="outline" disabled={paused} onClick={() => setAfter(undefined)}>Newest incoming work</Button>}
      {page?.next && <Button size="sm" variant="outline" disabled={paused} onClick={() => setAfter(page.next ?? undefined)}>Older incoming work</Button>}
    </div>}
  </section>;
}

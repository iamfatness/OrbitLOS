"use client";

import { useEffect, useState } from "react";
import { readIncomingLoanWork } from "@/app/actions";
import type { IncomingLoanWorkItem, IncomingLoanWorkPage, IncomingLoanWorkQuery } from "@/lib/incoming-loan-work-model";
import { observeTabReturn, observeVisibleChecks } from "@/lib/tab-return";
import { dateTime } from "@/lib/utils";
import { manualReturnSteps } from "@/lib/lender-export-model";
import { Button } from "./ui/button";

type ReviewResult = IncomingLoanWorkPage | { error: string };

export function IncomingLoanWorkQueue({ brokerageId, view, paused, version, open }: {
  brokerageId: string; view: IncomingLoanWorkQuery["view"]; paused: boolean; version: object; open: (item: IncomingLoanWorkItem) => void;
}) {
  const [after, setAfter] = useState<IncomingLoanWorkQuery["after"]>();
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ brokerageId: string; view: IncomingLoanWorkQuery["view"]; after: IncomingLoanWorkQuery["after"]; result: ReviewResult }>();
  useEffect(() => {
    if (paused) return;
    let active = true;
    let reading = false;
    async function refresh(isCurrent: () => boolean, initial = false) {
      if (reading) return;
      reading = true;
      try {
        const result = await readIncomingLoanWork({ view, after }, brokerageId);
        if (active && isCurrent()) setData({ brokerageId, view, after, result });
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
    <div className="section-heading"><h3>Incoming loan work</h3>{page && page.items.length > 0 && <span className="pill">{page.items.length} on this page</span>}</div>
    {!result && <p className="muted" role="status">Checking for incoming work…</p>}
    {result && "error" in result && <div className="loan-application-actions"><p role="alert">{result.error}</p>
      <Button size="sm" variant="outline" disabled={paused} onClick={() => setAttempt((current) => current + 1)}>Retry</Button></div>}
    {page && (page.items.length ? <ul className="loan-task-list">{page.items.map((item) => {
      const action = item.returnStatus ? manualReturnSteps[item.returnStatus].action :
        item.kind === "application" ? "Review 1003" : item.kind === "document" ? "Review document" : "Open handoff";
      return <li className="loan-task" key={`${item.kind}:${item.id}`}>
      <div className="loan-task-copy"><strong>{item.name} · {item.title}</strong>
        <span>{item.returnStatus ? `${item.returnStatus} · ` : item.kind === "application" ? "Submitted " : "Received "}{dateTime(item.receivedAt)} ET{item.linkedCondition && " · Lender condition"}{item.assignee && ` · ${item.assignee}`}</span>
        {item.note && <span>{item.note}</span>}</div>
      <Button size="sm" variant="outline" disabled={paused} aria-label={`${item.kind === "document" ? `Review ${item.title.toLowerCase()}` : action} for ${item.name}`}
        onClick={() => open(item)}>{action}</Button>
    </li>;})}</ul> : <p className="empty-inline">{after ? "No more incoming items need attention." : view === "today" ?
      "New 1003s, received documents, and lender or processor returns appear here." : "Received documents and ready handoffs on assigned files appear here."}</p>)}
    {(after || page?.next) && <div className="loan-application-actions">
      {after && <Button size="sm" variant="outline" disabled={paused} onClick={() => setAfter(undefined)}>Newest incoming work</Button>}
      {page?.next && <Button size="sm" variant="outline" disabled={paused} onClick={() => setAfter(page.next ?? undefined)}>Older incoming work</Button>}
    </div>}
  </section>;
}

"use client";

import { useEffect, useState } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { observeTabReturn } from "@/lib/tab-return";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Daily = Extract<ComplianceCaseResult, { kind: "daily" }>;
type Cursor = NonNullable<Daily["next"]>;

export function ComplianceDailyWork({ brokerageId, view = "mine", paused, version, open }: {
  brokerageId: string; view?: "mine" | "review"; paused: boolean; version: object; open: (loanId: string, caseId: string) => void;
}) {
  const [query, setQuery] = useState<{ after?: Cursor }>({});
  const [loaded, setLoaded] = useState<{ brokerageId: string; view: string; query: typeof query; result: Daily | { error: string } }>();
  useEffect(() => {
    if (paused) return;
    let active = true;
    let reading = false;
    async function read(isCurrent: () => boolean) {
      if (reading) return;
      reading = true;
      try {
        const result = await accessComplianceCases({ type: "daily", view, after: query.after }, brokerageId);
        if (active && isCurrent() && ("error" in result || result.kind === "daily")) setLoaded({ brokerageId, view, query, result });
      } catch {
        if (active && isCurrent()) setLoaded({ brokerageId, view, query, result: { error: "Could not load compliance work. Try refreshing." } });
      } finally { reading = false; }
    }
    void read(() => true);
    const stopReturn = observeTabReturn(document, window, (isCurrent) => void read(isCurrent));
    return () => { active = false; stopReturn(); };
  }, [brokerageId, paused, query, version, view]);

  const data = loaded?.brokerageId === brokerageId && loaded.view === view && loaded.query === query ? loaded.result : undefined;
  const page = data && "kind" in data ? data : undefined;
  const label = view === "review" ? "Compliance reviews" : "Compliance follow-ups";
  const action = view === "review" ? "Open for review" : "Open compliance finding";
  return <section className="document-item record-form compliance-work" aria-label={label}>
    <div className="section-heading"><h3>{label}</h3>{page && <span className="pill">
      {page.counts.cases} {page.counts.cases === 1 ? "finding" : "findings"} · {page.counts.files} {page.counts.files === 1 ? "file" : "files"}
    </span>}</div>
    <p className="muted">Fictional file findings · Deadline undetermined</p>
    {!data && <p role="status">Checking for compliance work…</p>}
    {data && "error" in data && <p role="alert">{data.error}</p>}
    {page && (page.items.length ? <ul className="loan-task-list">{page.items.map((item) => <li className="loan-task compliance-row" key={item.id}>
      <div className="loan-task-copy"><strong>{item.borrower} · {item.title}</strong>
        <span>{item.status} · Opened {dateTime(item.openedAt)} ET</span>
        <span>{item.ownerState === "Assigned" ? "Owner" : item.ownerState}{item.ownerName && ` · ${item.ownerName}`}</span>
      </div>
      <Button size="sm" variant="outline" disabled={paused || !item.loanId} aria-label={`${action} for ${item.borrower}`}
        onClick={() => { if (item.loanId) open(item.loanId, item.id); }}>{action}</Button>
    </li>)}</ul> : <p className="empty-inline">{view === "review" ? "No fictional file findings are awaiting review." :
      "No assigned compliance findings need your follow-up."}</p>)}
    <div className="loan-application-actions">
      <Button size="sm" variant="outline" disabled={paused} onClick={() => setQuery({})}>
        {query.after ? "First compliance page" : "Refresh compliance work"}</Button>
      {page?.next && <Button size="sm" variant="outline" disabled={paused} onClick={() => setQuery({ after: page.next ?? undefined })}>
        More compliance work</Button>}
    </div>
  </section>;
}

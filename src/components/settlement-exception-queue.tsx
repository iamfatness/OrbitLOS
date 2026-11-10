"use client";

import { useEffect, useState } from "react";
import { accessBrokerageFinance } from "@/app/actions";
import { financeMoney, settlementQueueViews, type SettlementQueuePage, type SettlementQueueQuery } from "@/lib/brokerage-finance-model";
import { dateLabel } from "@/lib/client-retention";
import type { Workspace } from "@/lib/model";
import { Button } from "./ui/button";

const emptyText = {
  Differences: "No active settlement differences need review.",
  "Matches to confirm": "No matching settlement totals need confirmation.",
  "Missing evidence": "No started settlements are waiting for purchase advice or a receipt.",
  "Reviewed differences": "No active settlements have a reviewed difference.",
  "Fee differences": "No sample fee differences need review.",
  "Reviewed fee differences": "No active fee comparisons have a reviewed difference.",
} satisfies Record<SettlementQueueQuery["view"], string>;

export function SettlementExceptionQueue({ brokerageId, fundingVersion, view, selectView, open }: {
  brokerageId: string; fundingVersion: Workspace["closingProgress"]; view: SettlementQueueQuery["view"];
  selectView: (view: SettlementQueueQuery["view"]) => void; open: (loanId: string, cycle: number, focusFees?: true) => void;
}) {
  const [after, setAfter] = useState<SettlementQueueQuery["after"]>();
  const [version, setVersion] = useState(0);
  const [response, setResponse] = useState<{
    brokerageId: string; view: typeof view; after: typeof after; version: number;
    fundingVersion: typeof fundingVersion; data: SettlementQueuePage | { error: string };
  }>();
  useEffect(() => {
    let current = true;
    const request = { brokerageId, view, after, version, fundingVersion };
    const failure = { error: "Could not load settlement exceptions. Refresh to try again." };
    void accessBrokerageFinance({ type: "settlementQueue", view, after }, brokerageId).then((data) => {
      if (current) setResponse({ ...request, data: "error" in data || data.kind === "settlementQueue" ? data : failure });
    }, () => { if (current) setResponse({ ...request, data: failure }); });
    return () => { current = false; };
  }, [brokerageId, view, after, version, fundingVersion]);
  const data = response?.brokerageId === brokerageId && response.view === view && response.after === after
    && response.version === version && response.fundingVersion === fundingVersion ? response.data : undefined;
  const counts = response?.brokerageId === brokerageId && !("error" in response.data) ? response.data.counts : undefined;

  return <section className="record-form" aria-label="Settlement exception queue">
    <div className="section-heading"><h3>Settlement exception queue</h3>
      <Button size="sm" variant="ghost" onClick={() => { setAfter(undefined); setVersion((value) => value + 1); }}>Refresh settlement exceptions</Button>
    </div>
    <p className="muted">Open the funding cycle behind a proceeds or itemized fee difference and record the review.</p>
    <div className="loan-application-actions" role="group" aria-label="Settlement exception filters">
      {settlementQueueViews.map((option) => <Button key={option} size="sm" variant={option === view ? "default" : "outline"}
        aria-pressed={option === view} onClick={() => { setAfter(undefined); selectView(option); }}>
        {option}{counts ? ` (${counts[option]})` : ""}
      </Button>)}
    </div>
    {!data ? <p className="muted" role="status">Loading settlement exceptions…</p> : "error" in data ? <p role="alert">{data.error}</p> : <>
      {data.rows.length ? <ul className="document-list">{data.rows.map((row) => <li className="document-item" key={`${row.id}:${row.cycle}`}>
        <div className="document-item-head"><strong>{row.borrower}</strong>
          <Button size="sm" variant="outline" aria-label={`Open ${row.feeComparison ? "fee comparison" : "settlement cycle"} for ${row.borrower}`}
            onClick={() => open(row.id, row.cycle, row.feeComparison ? true : undefined)}>{row.feeComparison ? "Open fee comparison" : "Open settlement cycle"}</Button>
        </div>
        <p className="muted">Funded {dateLabel(row.date)} · Cycle {row.cycle} · {row.officer || "Unassigned"}</p>
        {row.feeComparison ? <p>{row.feeComparison.differenceCount} fee {row.feeComparison.differenceCount === 1 ? "difference" : "differences"}
          {row.feeComparison.missingCount > 0 && ` · ${row.feeComparison.missingCount} with missing figures`}</p> :
          <p>Expected {financeMoney(row.expectedCents)} · Received {financeMoney(row.receivedCents)} · Difference {financeMoney(row.differenceCents)}</p>}
        <span className="pill">{row.status}</span>
      </li>)}</ul> : <p className="empty-inline">{after ? "No more settlement cycles on this page." : emptyText[view]}</p>}
      <div className="loan-application-actions">
        {after && <Button size="sm" variant="outline" onClick={() => setAfter(undefined)}>First page</Button>}
        {data.next && <Button size="sm" variant="outline" onClick={() => setAfter(data.next ?? undefined)}>Next page</Button>}
      </div>
    </>}
  </section>;
}

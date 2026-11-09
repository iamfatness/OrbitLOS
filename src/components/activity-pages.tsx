"use client";

import { useEffect, useState, type ReactNode } from "react";
import { readHistoryPage } from "@/app/actions";
import type { HistoryEvent, HistoryPage, HistoryRequest } from "@/lib/record-history";
import { Button } from "./ui/button";

export function ActivityPages({ record, id, brokerageId, version, render }: {
  record: HistoryRequest["record"]; id: string; brokerageId: string; version: object; render: (events: HistoryEvent[]) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ version: object; attempt: number; result: HistoryPage | { error: string } }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  useEffect(() => {
    let active = true;
    const update = (result: HistoryPage | { error: string }) => { if (active) setData({ version, attempt, result }); };
    void readHistoryPage({ record, id }, brokerageId).then(update, () => update({ error: "Could not load activity history. Try again." }));
    return () => { active = false; };
  }, [record, id, brokerageId, version, attempt]);

  const current = data?.version === version && data.attempt === attempt ? data : undefined;
  if (!current) return <p className="muted" role="status">Loading activity history…</p>;
  const { result } = current;
  if ("error" in result) return <div className="record-form"><p role="alert">{result.error}</p>
    <div><Button size="sm" variant="outline" onClick={() => setAttempt(attempt + 1)}>Retry history</Button></div>
  </div>;

  async function loadMore(page: HistoryPage) {
    if (!page.next || loadingMore) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const next = await readHistoryPage({ record, id, before: page.next }, brokerageId);
      setData((latest) => latest === current ? { version, attempt, result: "error" in next ? next :
        { events: [...page.events, ...next.events], next: next.next } } : latest);
    } catch {
      setMoreError("Could not load the older events. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  return <div className="record-form">
    {render(result.events)}
    {moreError && <p role="alert">{moreError}</p>}
    {result.next && <div><Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore(result)}>
      {loadingMore ? "Loading older activity…" : "Load older activity"}
    </Button></div>}
  </div>;
}

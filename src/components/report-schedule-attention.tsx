"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarClock } from "lucide-react";
import { dateLabel, easternDate, easternDayStart } from "@/lib/client-retention";
import { shiftReportDate } from "@/lib/report-date-range";
import type { ReportScheduleAttention } from "@/lib/report-schedule-model";
import { observeTabReturn } from "@/lib/tab-return";
import { Button } from "./ui/button";

const previewLimit = 4;

export function ReportScheduleAttentionPanel({ brokerageId, busy, open, returning }: {
  brokerageId: string; busy: boolean; open: (reportId?: string) => void; returning?: { reportId?: string };
}) {
  const [data, setData] = useState<ReportScheduleAttention>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [expanded, setExpanded] = useState<boolean>();
  const heading = useRef<HTMLHeadingElement>(null);
  const restored = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const endpoint = `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}&view=report-schedules&attention=1`;
    let reading = false;
    async function refresh(isCurrent: () => boolean) {
      if (reading) return;
      reading = true;
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const value = await response.json().catch(() => null) as ReportScheduleAttention | null;
        if (!response.ok || value?.kind !== "attention") throw new Error();
        if (!controller.signal.aborted && isCurrent()) { setData(value); setError(false); }
      } catch {
        if (!controller.signal.aborted && isCurrent()) setError(true);
      } finally {
        if (!controller.signal.aborted && isCurrent()) setLoading(false);
        reading = false;
      }
    }

    void refresh(() => true);
    const stop = observeTabReturn(document, window, (isCurrent) => void refresh(isCurrent));
    const nextMidnight = Date.parse(easternDayStart(shiftReportDate(easternDate(), 1)));
    const timer = setTimeout(() => setGeneration(value => value + 1), Math.max(1000, nextMidnight - Date.now() + 50));
    return () => { stop(); clearTimeout(timer); controller.abort(); };
  }, [brokerageId, generation]);

  useEffect(() => {
    if (!returning || restored.current || (!data && !error)) return;
    restored.current = true;
    const action = returning.reportId && document.getElementById(`brokerage-report-${returning.reportId}`);
    if (action) action.focus();
    else heading.current?.focus();
  }, [data, error, returning]);

  const revealReturn = !!data && data.items.findIndex(item => item.reportId === returning?.reportId) >= previewLimit;
  const showAll = expanded ?? revealReturn;
  const items = showAll ? data?.items : data?.items.slice(0, previewLimit);
  return <section className="integration record-form" aria-labelledby="brokerage-report-schedule-heading">
    <div className="section-heading">
      <h2 id="brokerage-report-schedule-heading" tabIndex={-1} ref={heading}><CalendarClock size={19} aria-hidden="true" /> Report schedules</h2>
      <Button type="button" size="sm" variant="outline" disabled={loading || busy} onClick={() => {
        setLoading(true);
        setError(false);
        setGeneration(value => value + 1);
      }}>Refresh schedules</Button>
    </div>
    {loading && !data && <p role="status" className="muted">Checking report schedules…</p>}
    {error && <p role="alert" className="muted">{data ? "Could not refresh report schedules. Showing the last check." : "Could not load report schedules. Refresh to try again."}</p>}
    {data && (data.items.length ? <>
      <p className="muted">{data.due} due · {data.blocked} blocked</p>
      <ul className="document-list" aria-label="Report schedules that need attention">
        {items?.map(item => <li className="document-item" key={item.reportId}>
          <div className="document-item-head"><strong>{item.reportName}</strong><span className="pill">{item.status}</span></div>
          <p className="muted">Scheduled for {dateLabel(item.nextOn)} ET</p>
          <div className="loan-application-actions"><Button type="button" size="sm" variant="outline" disabled={busy}
            id={`brokerage-report-${item.reportId}`} aria-label={`Open schedule for ${item.reportName}`}
            onClick={() => open(item.reportId)}>Open schedule<ArrowRight aria-hidden="true" /></Button></div>
        </li>)}
      </ul>
    </> : <p className="empty-inline" role="status">No report schedules need attention.</p>)}
    <div className="loan-application-actions">
      {!!data && data.items.length > previewLimit && <Button type="button" size="sm" variant="outline"
        aria-expanded={showAll} onClick={() => setExpanded(!showAll)}>{showAll ? "Show fewer schedules" : "Show all schedules needing attention"}</Button>}
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => open()}>Manage report schedules<ArrowRight aria-hidden="true" /></Button>
    </div>
  </section>;
}

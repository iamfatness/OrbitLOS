"use client";

import { useEffect, useState } from "react";
import { readMyCampaignCallbacks } from "@/app/actions";
import type { CampaignCallbackItem, CampaignCallbackPage, CampaignCallbackQuery } from "@/lib/officer-queue-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const views = ["Due", "Upcoming"] as const;

export function PersonalCampaignCallbacks({ brokerageId, version, busy, openCallback }: {
  brokerageId: string; version: object; busy: boolean; openCallback: (item: CampaignCallbackItem) => void;
}) {
  const [query, setQuery] = useState<CampaignCallbackQuery>({ view: "Due" });
  const [data, setData] = useState<{ brokerageId: string; query: CampaignCallbackQuery; result: CampaignCallbackPage | { error: string } }>();

  useEffect(() => {
    let active = true;
    let request = 0;
    function load() {
      const id = ++request;
      const update = (result: CampaignCallbackPage | { error: string }) => {
        if (active && id === request) setData({ brokerageId, query, result });
      };
      void readMyCampaignCallbacks(query, brokerageId).then(update, () => update({ error: "Could not load callbacks. Try refreshing." }));
    }
    function refreshVisible() {
      if (document.visibilityState === "visible") load();
    }
    load();
    const timer = query.after ? undefined : window.setInterval(refreshVisible, 30_000);
    if (!query.after) document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [brokerageId, query, version]);

  const current = data?.brokerageId === brokerageId && data.query === query ? data.result : undefined;
  const page = current && !("error" in current) ? current : undefined;
  const firstPage = () => setQuery({ view: query.view });

  return <section className="record-form" aria-label="My campaign callbacks">
    <p className="muted">Your callbacks and retries across campaigns, including promises carried onto loans.</p>
    <div className="loan-application-actions" role="group" aria-label="Callback timing">
      {views.map((view) => <Button key={view} size="sm" variant={query.view === view ? "default" : "outline"}
        aria-pressed={query.view === view} onClick={() => setQuery({ view })}>{view}</Button>)}
      <Button size="sm" variant="outline" onClick={firstPage}>Refresh callbacks</Button>
    </div>
    {!current && <p className="muted" role="status">Loading your callbacks…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {page && <>
      {page.items.length ? <ul className="document-list">{page.items.map((item) => <li key={item.taskId} className="document-item">
        <div className="document-item-head"><strong>{item.name}</strong><span className={query.view === "Due" ? "open-chip" : "pill"}>
          {item.requested ? "Callback" : "Retry"} {query.view === "Due" ? "due" : "scheduled"}
        </span></div>
        <p className="muted">{item.campaignName}{item.loanId && " · Continued on loan"} · <time dateTime={item.dueAt}>{dateTime(item.dueAt)} ET</time></p>
        <div><Button size="sm" variant="outline" disabled={busy} onClick={() => openCallback(item)}>
          {item.loanId ? "Open loan callback" : "Open callback"}
        </Button></div>
      </li>)}</ul> : <p className="empty-inline">{page.next ? "No actionable callbacks on this page. Check the next page." :
        query.after ? "No more callbacks on this page." : query.view === "Due" ? "No callbacks or retries are due for you." :
          "You have no upcoming callbacks or retries."}</p>}
      {!page.items.length && !page.next && !query.after && query.view === "Due" &&
        <div><Button size="sm" variant="outline" onClick={() => setQuery({ view: "Upcoming" })}>View upcoming callbacks</Button></div>}
      {(query.after || page.next) && <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={firstPage}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setQuery({ view: query.view, after: page.next ?? undefined })}>Next page</Button>}
      </div>}
    </>}
  </section>;
}

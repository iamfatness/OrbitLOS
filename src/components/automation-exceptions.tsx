"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Radio } from "lucide-react";
import type { DeliveryException, DeliveryExceptionPage, DeliveryExceptionQuery } from "@/lib/automation-exception-model";
import { automationEventLabels, type AutomationEventDetail, type AutomationPayload } from "@/lib/automation-event-model";
import { observeTabReturn } from "@/lib/tab-return";
import { dateTime } from "@/lib/utils";
import { DeliveryDetails } from "./automation-deliveries";
import { Button } from "./ui/button";

type Props = {
  brokerageId: string;
  fictional: boolean;
  attentionCount?: number;
  openRecord: (resource: AutomationPayload["resource"]) => void;
  onChanged: () => void;
};

export function DeliveryExceptions(props: Props) {
  const [open, setOpen] = useState(false);
  const count = props.attentionCount;
  return <details className="uwm-deliveries automation-deliveries delivery-exception-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>
      <Radio size={19} aria-hidden="true" />
      <span><strong>Delivery exceptions</strong><small>Simulated CRM deliveries</small></span>
      {!!count && <span className="pill">{count >= 100 ? "100+" : count} {count === 1 ? "needs attention" : "need attention"}</span>}
      <ChevronDown className="uwm-disclosure-icon" size={17} aria-hidden="true" />
    </summary>
    {open && <DeliveryExceptionList {...props} />}
  </details>;
}

function DeliveryExceptionList({ brokerageId, fictional, attentionCount, openRecord, onChanged }: Props) {
  const [query, setQuery] = useState<DeliveryExceptionQuery>({ view: "attention" });
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<{ query: DeliveryExceptionQuery; data: DeliveryExceptionPage | { error: string } }>();
  const [selected, setSelected] = useState<DeliveryException>();
  const filter = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const data = result?.query === query ? result.data : undefined;
  const base = `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}`;
  const busy = !data;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ queue: query.view });
    if (query.after) {
      params.set("sequence", String(query.after.sequence));
      params.set("destinationId", query.after.destinationId);
    }
    let reading = false;
    async function read(isCurrent: () => boolean) {
      if (reading) return;
      reading = true;
      try {
        const response = await fetch(`${base}&view=automation-exceptions&${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const data: DeliveryExceptionPage = await response.json();
        if (!controller.signal.aborted && isCurrent()) setResult({ query, data });
      } catch {
        if (!controller.signal.aborted && isCurrent()) {
          setResult({ query, data: { error: "Could not load delivery exceptions. Refresh to try again." } });
        }
      } finally { reading = false; }
    }
    void read(() => true);
    const stop = query.after ? undefined : observeTabReturn(document, window, isCurrent => void read(isCurrent));
    return () => { stop?.(); controller.abort(); };
  }, [base, query, generation, attentionCount]);

  function close() {
    setSelected(undefined);
    if (trigger.current?.isConnected) trigger.current.focus();
    else filter.current?.focus();
  }

  function refresh() {
    setGeneration(value => value + 1);
    onChanged();
  }

  function saved(detail: AutomationEventDetail) {
    if (detail.review || detail.event.status === "Simulated" || (query.view === "waiting" && detail.event.attemptCount === 2)) {
      setResult(previous => {
        if (!previous || "error" in previous.data) return previous;
        const items = previous.data.items.filter(item => item.eventId !== detail.event.payload.eventId || item.destinationId !== detail.destination?.id);
        return { ...previous, data: { ...previous.data, items } };
      });
    }
    refresh();
  }

  return <div className="uwm-delivery-body record-form">
    <div className="automation-delivery-filters delivery-exception-filters">
      <label className="field">Delivery status<select value={query.view} ref={filter} onChange={event => {
        setSelected(undefined);
        setQuery({ view: event.target.value === "waiting" ? "waiting" : "attention" });
      }}>
        <option value="attention">Needs attention</option>
        <option value="waiting">Scheduled or paused</option>
      </select></label>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={refresh}>Refresh deliveries</Button>
    </div>
    {busy && <p className="muted" role="status">Loading delivery exceptions…</p>}
    {data && "error" in data && <p className="application-message banner-error" role="alert">{data.error}</p>}
    {selected && <DeliveryDetails key={`${selected.destinationId}:${selected.eventId}`} id={selected.eventId}
      endpoint={`${base}&view=automation-events&destinationId=${encodeURIComponent(selected.destinationId)}`}
      fictional={fictional} openRecord={openRecord} onSaved={saved} onClose={close} returnLabel="Back to delivery exceptions" />}
    {data && !("error" in data) && <>
      {data.items.length ? <ul className="document-list" aria-label="Simulated delivery exceptions">
        {data.items.map(item => <li className="document-item" key={`${item.destinationId}:${item.eventId}`}>
          <div className="document-item-head">
            <strong>{automationEventLabels[item.eventType]}</strong><span className="pill">{item.status}</span>
          </div>
          <p>{item.destinationName}</p>
          <p className="muted">Failed {dateTime(item.failedAt)} · {item.eventId.slice(0, 8)}</p>
          {item.status === "Retry scheduled" && item.retryAt && <p className="muted">Retry available {dateTime(item.retryAt)}</p>}
          <div className="loan-application-actions"><Button type="button" size="sm" variant="outline"
            aria-expanded={selected?.destinationId === item.destinationId && selected?.eventId === item.eventId}
            onClick={event => {
              trigger.current = event.currentTarget;
              if (selected?.destinationId === item.destinationId && selected.eventId === item.eventId) {
                document.getElementById("automation-event-heading")?.focus();
              } else setSelected(item);
            }}>Open delivery</Button></div>
        </li>)}
      </ul> : <p className="empty-inline" role="status">{query.after ? "No more deliveries on this page." :
        query.view === "attention" ? "No simulated deliveries need attention." : "No retries are scheduled or paused."}</p>}
      <div className="loan-application-actions">
        {query.after && <Button type="button" size="sm" variant="outline" onClick={() => { setSelected(undefined); setQuery({ view: query.view }); }}>First page</Button>}
        {data.next && <Button type="button" size="sm" variant="outline" onClick={() => { setSelected(undefined); setQuery({ view: query.view, after: data.next ?? undefined }); }}>Next page</Button>}
      </div>
    </>}
  </div>;
}

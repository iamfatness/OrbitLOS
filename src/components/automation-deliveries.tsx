"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Radio } from "lucide-react";
import { automationEventLabels, automationStatuses, type AutomationEvent, type AutomationEventDetail, type AutomationEventPage,
  type AutomationEventType, type AutomationPayload, type AutomationStatus } from "@/lib/automation-event-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

async function deliveryRequest(endpoint: string, options?: RequestInit): Promise<AutomationEventPage | AutomationEventDetail> {
  const response = await fetch(endpoint, { cache: "no-store", ...options });
  const result = await response.json().catch(() => null) as AutomationEventPage | AutomationEventDetail | { error: string } | null;
  if (!response.ok || !result || !("kind" in result)) {
    throw new Error(result && "error" in result ? result.error : "Could not confirm the request. Refresh and try again.");
  }
  return result;
}

type QueueProps = { brokerageId: string; fictional: boolean; openRecord: (resource: AutomationPayload["resource"]) => void };

export function AutomationDeliveries(props: QueueProps) {
  const [opened, setOpened] = useState(false);
  return <details className="uwm-deliveries automation-deliveries" onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>
      <Radio size={19} aria-hidden="true" />
      <span><strong>CRM automation deliveries</strong><small>Simulation only</small></span>
      <ChevronDown className="uwm-disclosure-icon" size={17} aria-hidden="true" />
    </summary>
    {opened && <AutomationQueue {...props} />}
  </details>;
}

function AutomationQueue({ brokerageId, fictional, openRecord }: QueueProps) {
  const endpoint = `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}&view=automation-events`;
  const [status, setStatus] = useState<AutomationStatus | "">("");
  const [eventType, setEventType] = useState<AutomationEventType | "">("");
  const [page, setPage] = useState<AutomationEventPage>();
  const [read, setRead] = useState({ generation: 0, before: null as number | null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>();
  const statusFilter = useRef<HTMLSelectElement>(null);
  const openedBy = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const filters = new URLSearchParams();
    if (status) filters.set("status", status);
    if (eventType) filters.set("eventType", eventType);
    if (read.before) filters.set("before", String(read.before));
    deliveryRequest(`${endpoint}&${filters}`, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted || result.kind !== "events") return;
      setPage(previous => read.before && previous ? { ...result, events: [...previous.events, ...result.events] } : result);
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, eventType, status, read]);

  function refresh(before: number | null = null) {
    setError("");
    setLoading(true);
    setRead(previous => ({ before, generation: previous.generation + 1 }));
  }

  return <div className="uwm-delivery-body record-form">
    <p className="muted">Review the event payload and rehearse a delivery. Simulations stay in Orbit.</p>
    {selected && <DeliveryDetails key={selected} endpoint={endpoint} id={selected} fictional={fictional}
      openRecord={openRecord} onSaved={() => refresh()} onClose={() => {
        setSelected(undefined);
        if (openedBy.current?.isConnected) openedBy.current.focus();
        else statusFilter.current?.focus();
      }} />}
    <div className="automation-delivery-filters">
      <label className="field">Event type<select value={eventType} onChange={event => {
        setPage(undefined);
        setEventType(event.target.value as AutomationEventType | "");
        refresh();
      }}>
        <option value="">All event types</option>
        {Object.entries(automationEventLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select></label>
      <label className="field">Delivery status<select ref={statusFilter} value={status} onChange={event => {
        setPage(undefined);
        setStatus(event.target.value as AutomationStatus | "");
        refresh();
      }}>
        <option value="">All statuses</option>
        {automationStatuses.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => refresh()}>Refresh queue</Button>
    </div>
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {loading && <p className="muted" role="status">Loading automation events…</p>}
    {!loading && !error && page?.events.length === 0 && <p className="muted">
      {status || eventType ? "No events match these filters." : "New leads, submitted 1003s, and recorded funding will appear here."}
    </p>}
    {!!page?.events.length && <ul className="document-list" aria-label="Automation events">
      {page.events.map(({ payload, status }) => <li className="document-item" key={payload.eventId}>
        <div className="document-item-head"><strong>{automationEventLabels[payload.eventType]}</strong><span className="pill">{status}</span></div>
        <p className="muted">{payload.source} · {dateTime(payload.occurredAt)}</p>
        <div className="loan-application-actions"><Button type="button" size="sm" variant="outline" aria-expanded={selected === payload.eventId}
          onClick={event => {
            openedBy.current = event.currentTarget;
            if (selected === payload.eventId) document.getElementById("automation-event-heading")?.focus();
            else setSelected(payload.eventId);
          }}>Open event</Button></div>
      </li>)}
    </ul>}
    {page?.next !== null && page?.next !== undefined && <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => refresh(page.next)}>Load older events</Button>
    </div>}
  </div>;
}

function DeliveryDetails({ endpoint, id, fictional, openRecord, onSaved, onClose }: {
  endpoint: string; id: string; fictional: boolean; openRecord: QueueProps["openRecord"]; onSaved: () => void; onClose: () => void;
}) {
  const [detail, setDetail] = useState<AutomationEventDetail>();
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const pending = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    deliveryRequest(`${endpoint}&id=${encodeURIComponent(id)}`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted && result.kind === "event") setDetail(result);
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, id, loadVersion]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => { if (notice) receipt.current?.focus(); }, [notice]);

  async function attempt(item: AutomationEvent, simulateFailure: boolean) {
    if (saving || loading) return;
    const key = JSON.stringify([item.attemptCount, simulateFailure]);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await deliveryRequest(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "attempt", id, operationId: pending.current.id, attempt: item.attemptCount, simulateFailure }),
      });
      if (result.kind !== "event") throw new Error("Refresh the event to check the saved attempt.");
      pending.current = null;
      setDetail(result);
      setNotice(result.event.status === "Failed" ? "Simulated failure recorded. You can retry this event." : "Simulation succeeded.");
      onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Refresh the event to check the saved attempt."); }
    finally { setSaving(false); }
  }

  const item = detail?.event;
  return <section className="document-item record-form" aria-labelledby="automation-event-heading">
    <div className="document-item-head">
      <h3 id="automation-event-heading" ref={heading} tabIndex={-1}>{item ? automationEventLabels[item.payload.eventType] : "Event details"}</h3>
      {item && <span className="pill">{item.status}</span>}
    </div>
    {loading && <p className="muted" role="status">Loading event…</p>}
    {error && <p ref={alert} tabIndex={-1} role="alert" className="application-message banner-error">{error}</p>}
    {notice && <p ref={receipt} tabIndex={-1} role="status" className="application-message">{notice}</p>}
    {item && <>
      <p className="muted">{item.payload.source} · {dateTime(item.payload.occurredAt)}</p>
      <details className="automation-payload">
        <summary>Delivery payload</summary>
        <pre aria-label="Delivery payload JSON">{JSON.stringify(item.payload, null, 2)}</pre>
      </details>
      {!!detail.attempts.length && <div className="record-form">
        <h4>Attempt history</h4>
        <ol className="automation-attempts">{detail.attempts.map(attempt => <li key={attempt.operationId}>
          <strong>Attempt {attempt.number} · {attempt.outcome === "Failed" ? "Simulated failure" : "Simulation succeeded"}</strong>
          <span className="muted">{dateTime(attempt.at)} · {attempt.actor}</span>
        </li>)}</ol>
      </div>}
    </>}
    <div className="loan-application-actions">
      {item && item.status !== "Simulated" && <Button type="button" size="sm" disabled={saving || loading} onClick={() => void attempt(item, false)}>
        {saving ? "Recording…" : item.status === "Failed" ? "Retry simulation" : "Simulate delivery"}
      </Button>}
      {fictional && item?.status === "Queued" && <Button type="button" size="sm" variant="outline" disabled={saving || loading}
        onClick={() => void attempt(item, true)}>Simulate failure</Button>}
      {item && <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => openRecord(item.payload.resource)}>
        {item.payload.resource.kind === "lead" ? "Open lead" : "Open loan"}
      </Button>}
      <Button type="button" size="sm" variant="outline" disabled={saving || loading} onClick={() => {
        setError("");
        setNotice("");
        setLoading(true);
        setLoadVersion(value => value + 1);
      }}>Refresh event</Button>
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onClose}>Back to events</Button>
    </div>
  </section>;
}

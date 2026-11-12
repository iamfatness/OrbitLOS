"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { automationEventLabels, automationRetryDelays, type AutomationDestination, type AutomationRetryDelay, type AutomationDestinationPage, type AutomationEventType } from "@/lib/automation-event-model";
import { Button } from "./ui/button";

async function destinationRequest(endpoint: string, action?: object) {
  const response = await fetch(endpoint, { cache: "no-store", ...(action ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
  } : {}) });
  const result = await response.json().catch(() => null) as AutomationDestinationPage | { kind: "destination"; destination: AutomationDestination } | { error: string } | null;
  if (!response.ok || !result || !("kind" in result)) {
    throw new Error(result && "error" in result ? result.error : "Could not confirm the destination request. Try again.");
  }
  return result;
}

export function AutomationDestinations({ brokerageId, openDeliveries }: {
  brokerageId: string; openDeliveries: (destination: AutomationDestination) => void;
}) {
  const endpoint = `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}&view=automation-destinations`;
  const [page, setPage] = useState<AutomationDestinationPage>();
  const [loading, setLoading] = useState(true);
  const [read, setRead] = useState({ before: null as number | null, generation: 0 });
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AutomationDestination | "new">();
  const [editVisit, setEditVisit] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const openedBy = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let current = true;
    destinationRequest(`${endpoint}${read.before ? `&before=${read.before}` : ""}`).then(result => {
      if (!current || result.kind !== "destinations") return;
      setPage(previous => read.before && previous ? { ...result, destinations: [...previous.destinations, ...result.destinations] } : result);
    }).catch((failure: Error) => { if (current) setError(failure.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [endpoint, read]);

  function refresh(before: number | null = null) {
    setLoading(true);
    setError("");
    setRead(previous => ({ before, generation: previous.generation + 1 }));
  }

  return <section className="record-form" aria-labelledby="automation-destinations-heading">
    <div className="document-item-head">
      <h3 id="automation-destinations-heading" tabIndex={-1} ref={heading}>Simulated destinations</h3>
      <div className="loan-application-actions">
        <Button type="button" size="sm" onClick={event => { openedBy.current = event.currentTarget; setEditVisit(value => value + 1); setSelected("new"); }}>Add destination</Button>
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => refresh()}>Refresh destinations</Button>
      </div>
    </div>
    <p className="muted">Choose which new events each destination receives. All deliveries are simulated in Orbit.</p>
    {selected && <DestinationEditor key={editVisit} endpoint={endpoint}
      initial={selected === "new" ? undefined : selected} onSaved={value => { setSelected(value); refresh(); }}
      onClose={() => {
        setSelected(undefined);
        if (openedBy.current?.isConnected) openedBy.current.focus();
        else heading.current?.focus();
      }} />}
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {loading && <p className="muted" role="status">Loading destinations…</p>}
    {!loading && !error && page?.destinations.length === 0 && <p className="muted">Add a destination to rehearse a separate delivery queue.</p>}
    {!!page?.destinations.length && <ul className="document-list" aria-label="Automation destinations">
      {page.destinations.map(destination => <li key={destination.id} className="document-item">
        <div className="document-item-head"><strong>{destination.name}</strong><span className="pill">{destination.state}</span></div>
        <p className="muted">{destination.eventTypes.map(type => automationEventLabels[type]).join(" · ")}</p>
        <div className="loan-application-actions">
          <Button type="button" size="sm" variant="outline" onClick={() => openDeliveries(destination)}>View deliveries</Button>
          {destination.state !== "Disconnected" && <Button type="button" size="sm" variant="outline"
            aria-expanded={typeof selected === "object" && selected.id === destination.id}
            onClick={event => { openedBy.current = event.currentTarget; setEditVisit(value => value + 1); setSelected(destination); }}>Manage destination</Button>}
        </div>
      </li>)}
    </ul>}
    {page?.next != null && <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => refresh(page.next)}>Load older destinations</Button>
    </div>}
  </section>;
}

function DestinationEditor({ endpoint, initial, onSaved, onClose }: {
  endpoint: string; initial?: AutomationDestination; onSaved: (destination: AutomationDestination) => void; onClose: () => void;
}) {
  const [destination, setDestination] = useState(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [eventTypes, setEventTypes] = useState<AutomationEventType[]>(initial?.eventTypes ?? []);
  const [retryDelay, setRetryDelay] = useState<AutomationRetryDelay>(initial?.retryDelayMinutes ?? 0);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const disconnect = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (notice || error) feedback.current?.focus(); }, [error, notice]);
  useEffect(() => { if (confirming) confirm.current?.focus(); }, [confirming]);

  async function change(action: object) {
    if (saving) return;
    const key = JSON.stringify(action);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    const operationId = attempt.current.id;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await destinationRequest(endpoint, destination ?
        { id: destination.id, revision: destination.revision, operationId, ...action } : { id: operationId, ...action });
      if (result.kind !== "destination") throw new Error("Refresh destinations to check the saved settings.");
      attempt.current = null;
      const saved = result.destination;
      setDestination(saved);
      if (!("type" in action && action.type === "setDestinationState")) {
        setName(saved.name);
        setEventTypes(saved.eventTypes);
        setRetryDelay(saved.retryDelayMinutes ?? 0);
      }
      setConfirming(false);
      setNotice(saved.state === "Disconnected" ? "Destination disconnected. Delivery history is still available." :
        saved.state === "Paused" ? "Destination paused. Matching events continue to queue." : "Destination saved.");
      onSaved(saved);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save destination settings."); }
    finally { setSaving(false); }
  }

  async function refreshVersion() {
    if (!destination || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await destinationRequest(`${endpoint}&id=${encodeURIComponent(destination.id)}`);
      if (result.kind !== "destination") throw new Error("Refresh the destination list to check the current version.");
      setDestination(result.destination);
      onSaved(result.destination);
      setNotice(result.destination.state === "Disconnected" ? "This destination is disconnected." :
        `Version ${result.destination.revision} is saved as ${result.destination.name} with ${result.destination.eventTypes.map(type => automationEventLabels[type]).join(", ")}. Your draft is still here.`);
      setConfirming(false);
      attempt.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not refresh the saved settings."); }
    finally { setSaving(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eventTypes.length) { setNotice(""); setError("Choose at least one event type."); return; }
    void change({ type: destination ? "editDestination" : "createDestination", name: name.trim(), eventTypes, retryDelayMinutes: retryDelay });
  }

  return <section className="document-item record-form" aria-labelledby="automation-destination-editor">
    <div className="document-item-head">
      <h3 id="automation-destination-editor" ref={heading} tabIndex={-1}>{destination?.name ?? "Add a simulated destination"}</h3>
      {destination && <span className="pill">{destination.state} · Version {destination.revision}</span>}
    </div>
    {(error || notice) && <p ref={feedback} tabIndex={-1} role={error ? "alert" : "status"}
      className={`application-message${error ? " banner-error" : ""}`}>{error || notice}</p>}
    {error && destination && <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void refreshVersion()}>Refresh saved settings</Button>
    </div>}
    {destination?.state !== "Disconnected" && <>
      <form className="record-form" aria-label="Destination settings" onSubmit={save}>
        <label className="field automation-destination-name">Destination name<input value={name} maxLength={80} required disabled={saving}
          onChange={event => setName(event.target.value)} /></label>
        <fieldset className="automation-subscriptions" disabled={saving}>
          <legend>Event subscriptions</legend>
          {Object.entries(automationEventLabels).map(([value, label]) => {
            const type = value as AutomationEventType;
            return <label className="automation-subscription" key={type}>
              <input type="checkbox" checked={eventTypes.includes(type)}
                onChange={event => setEventTypes(previous => event.target.checked ? [...previous, type] : previous.filter(item => item !== type))} />
              <span>{label}</span>
            </label>;
          })}
        </fieldset>
        <label className="field automation-destination-name">Retry delay<select value={retryDelay} disabled={saving}
          onChange={event => setRetryDelay(Number(event.target.value) as AutomationRetryDelay)}>
          {automationRetryDelays.map(minutes => <option key={minutes} value={minutes}>
            {minutes ? `After ${minutes} minutes` : "Immediately"}
          </option>)}
        </select></label>
        <p className="muted">New events use these settings. After a failure, each delivery has one retry.</p>
        <div className="loan-application-actions">
          <Button type="submit" size="sm" disabled={saving || confirming}>{saving ? "Saving…" : destination ? "Save settings" : "Create destination"}</Button>
        </div>
      </form>
      {destination && (confirming ? <div className="record-form">
        <p>Disconnect this destination? Its delivery history stays available. It stops accepting new events and queued simulations.</p>
        <div className="loan-application-actions">
          <Button ref={confirm} type="button" size="sm" variant="danger" disabled={saving}
            onClick={() => void change({ type: "setDestinationState", state: "Disconnected" })}>Confirm disconnect</Button>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => {
            setConfirming(false);
            requestAnimationFrame(() => disconnect.current?.focus());
          }}>Cancel disconnect</Button>
        </div>
      </div> : <div className="loan-application-actions">
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() =>
          void change({ type: "setDestinationState", state: destination.state === "Active" ? "Paused" : "Active" })}>
          {destination.state === "Active" ? "Pause destination" : "Resume destination"}
        </Button>
        <Button ref={disconnect} type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setConfirming(true)}>Disconnect destination</Button>
      </div>)}
    </>}
    <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onClose}>Back to destinations</Button>
    </div>
  </section>;
}

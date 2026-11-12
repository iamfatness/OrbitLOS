"use client";

import { useEffect, useRef, useState } from "react";
import { automationBatchLimit, type AutomationBatchHistory, type AutomationBatchPreview, type AutomationBatchReceipt, type AutomationBatchStatus } from "@/lib/automation-batch-model";
import { automationEventLabels, type AutomationDestination } from "@/lib/automation-event-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type BatchResponse = AutomationBatchHistory | AutomationBatchPreview | AutomationBatchReceipt;

async function request(endpoint: string, signal?: AbortSignal, action?: object): Promise<BatchResponse> {
  const response = await fetch(endpoint, { cache: "no-store", signal, ...(action ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
  } : {}) });
  const result = await response.json().catch(() => null) as BatchResponse | { error: string } | null;
  if (!response.ok || !result || !("kind" in result)) {
    throw new Error(result && "error" in result ? result.error : "Could not confirm the batch. Try again or check batch history.");
  }
  return result;
}

type Props = { brokerageId: string; destination: AutomationDestination; fictional: boolean;
  onRun: () => void; openEvent: (id: string, button: HTMLButtonElement) => void };

export function AutomationBatches(props: Props) {
  const [open, setOpen] = useState(false);
  return <details className="automation-batch-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Batch simulations</summary>
    {open && <BatchPanel {...props} />}
  </details>;
}

function BatchPanel({ brokerageId, destination, fictional, onRun, openEvent }: Props) {
  const endpoint = `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}&view=automation-batches&destinationId=${encodeURIComponent(destination.id)}`;
  const [preview, setPreview] = useState<AutomationBatchPreview>();
  const [receipt, setReceipt] = useState<AutomationBatchReceipt>();
  const [history, setHistory] = useState<AutomationBatchHistory>();
  const [read, setRead] = useState({ before: null as number | null, generation: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failEventId, setFailEventId] = useState("");
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const receiptOpener = useRef<HTMLButtonElement>(null);
  const historyRefresh = useRef<HTMLButtonElement>(null);
  const active = destination.state === "Active";

  useEffect(() => {
    const controller = new AbortController();
    request(endpoint + (read.before ? `&before=${read.before}` : ""), controller.signal).then(result => {
      if (controller.signal.aborted || result.kind !== "history") return;
      setHistory(previous => read.before && previous ? { ...result, batches: [...previous.batches, ...result.batches] } : result);
    }).catch((failure: Error) => { if (!controller.signal.aborted) setHistoryError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, read]);
  useEffect(() => { if (preview || receipt) heading.current?.focus(); }, [preview, receipt]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);

  function refresh(before: number | null = null) {
    setLoading(true);
    setHistoryError("");
    setRead(previous => ({ before, generation: previous.generation + 1 }));
  }

  async function inspect(status: AutomationBatchStatus) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const result = await request(`${endpoint}&status=${status}`);
      if (result.kind !== "preview") throw new Error("Could not load the batch preview.");
      setPreview(result);
      setReceipt(undefined);
      setFailEventId("");
      attempt.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load the batch preview."); }
    finally { setBusy(false); }
  }

  async function run() {
    if (!preview || !active || busy) return;
    const key = JSON.stringify([preview.fingerprint, failEventId]);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await request(endpoint, undefined, { type: "run", destinationId: destination.id, status: preview.status,
        fingerprint: preview.fingerprint, batchId: attempt.current.id, ...(failEventId ? { failEventId } : {}) });
      if (result.kind !== "receipt") throw new Error("Check batch history for the saved receipt.");
      receiptOpener.current = null;
      setReceipt(result);
      setPreview(undefined);
      attempt.current = null;
      refresh();
      onRun();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not confirm this batch."); }
    finally { setBusy(false); }
  }

  async function showReceipt(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await request(`${endpoint}&batchId=${encodeURIComponent(id)}`);
      if (result.kind !== "receipt") throw new Error("Could not load the batch receipt.");
      setReceipt(result);
      setPreview(undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load the batch receipt."); }
    finally { setBusy(false); }
  }

  return <div className="record-form">
    {active ? <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void inspect("Queued")}>Preview queued batch</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void inspect("Failed")}>Preview failed batch</Button>
    </div> : <p className="muted">Batch history is available for this {destination.state.toLowerCase()} destination.</p>}
    {error && <p className="application-message banner-error" ref={alert} tabIndex={-1} role="alert">{error}</p>}
    {busy && <p className="muted" role="status">Checking batch…</p>}
    {preview && <section className="document-item record-form" aria-labelledby="automation-batch-preview">
      <h4 ref={heading} id="automation-batch-preview" tabIndex={-1}>{preview.status === "Queued" ? "Queued batch preview" : "Failed batch preview"}</h4>
      {preview.items.length ? <>
        <p className="muted">{preview.items.length} {preview.items.length === 1 ? "event" : "events"} · Oldest first{preview.more ? ` · More than ${automationBatchLimit} waiting` : ""}</p>
        <ul className="automation-attempts">
          {preview.items.map(item => <li key={item.eventId}><strong>{automationEventLabels[item.eventType]}</strong>
            <span className="muted">{dateTime(item.occurredAt)} · {item.eventId.slice(0, 8)}</span></li>)}
        </ul>
        {fictional && preview.status === "Queued" && <label className="field automation-batch-failure">Rehearse a failure<select value={failEventId}
          disabled={busy} onChange={event => setFailEventId(event.target.value)}>
          <option value="">Simulate success for every event</option>
          {preview.items.map(item => <option key={item.eventId} value={item.eventId}>{automationEventLabels[item.eventType]} · {item.eventId.slice(0, 8)}</option>)}
        </select></label>}
        <div className="loan-application-actions">
          <Button type="button" size="sm" disabled={busy || !active} onClick={() => void run()}>
            {preview.status === "Queued" ? "Run simulated batch" : "Retry failed batch"}
          </Button>
        </div>
      </> : <p className="muted">No {preview.status.toLowerCase()} events are waiting.</p>}
    </section>}
    {receipt && <section className="document-item record-form" aria-labelledby="automation-batch-receipt">
      <h4 ref={heading} id="automation-batch-receipt" tabIndex={-1}>Batch receipt</h4>
      <p>{receipt.items.filter(item => item.attempt.outcome === "Simulated").length} succeeded · {receipt.items.filter(item => item.attempt.outcome === "Failed").length} failed</p>
      <p className="muted">{receipt.destinationName} · Version {receipt.destinationRevision} · {dateTime(receipt.at)} · {receipt.actor}</p>
      <ul className="document-list">
        {receipt.items.map(item => <li className="document-item" key={item.eventId}>
          <div className="document-item-head"><strong>{automationEventLabels[item.eventType]}</strong><span className="pill">{item.attempt.outcome}</span></div>
          <p className="muted">Attempt {item.attempt.number} · Subscription version {item.subscriptionRevision} · {item.eventId.slice(0, 8)}</p>
          <div className="loan-application-actions"><Button type="button" size="sm" variant="outline" onClick={event =>
            openEvent(item.eventId, event.currentTarget)}>Open event</Button></div>
        </li>)}
      </ul>
      <div className="loan-application-actions"><Button type="button" size="sm" variant="outline" onClick={() => {
        setReceipt(undefined);
        if (receiptOpener.current?.isConnected) receiptOpener.current.focus();
        else historyRefresh.current?.focus();
      }}>Back to batch history</Button></div>
    </section>}
    <div className="document-item-head">
      <h4>Batch history</h4>
      <Button ref={historyRefresh} type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => refresh()}>Refresh batch history</Button>
    </div>
    {historyError && <p className="application-message banner-error" role="alert">{historyError}</p>}
    {loading && <p className="muted" role="status">Loading batch history…</p>}
    {!loading && !historyError && history?.batches.length === 0 && <p className="muted">Run a batch to save a delivery receipt.</p>}
    {!!history?.batches.length && <ul className="document-list" aria-label="Automation batch history">
      {history.batches.map(batch => <li className="document-item" key={batch.id}>
        <div className="document-item-head"><strong>{batch.status === "Queued" ? "Queued batch" : "Failed batch retry"}</strong>
          <span className="pill">{batch.succeeded} succeeded · {batch.failed} failed</span></div>
        <p className="muted">{dateTime(batch.at)} · {batch.actor}</p>
        <div className="loan-application-actions"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={event => {
          receiptOpener.current = event.currentTarget;
          void showReceipt(batch.id);
        }}>Open receipt</Button></div>
      </li>)}
    </ul>}
    {history?.next != null && <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => refresh(history.next)}>Load older batches</Button>
    </div>}
  </div>;
}

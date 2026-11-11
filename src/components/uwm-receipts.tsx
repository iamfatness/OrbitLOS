"use client";
import { useEffect, useState } from "react";
import { ChevronDown, Radio, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

type Receipt = { id: number; environment: string; kind: string; transactionId: string | null; loanNumber: string | null; receivedAt: string; status: string };
export function UwmReceipts({ brokerageId }: { brokerageId: string }) {
  const [rows, setRows] = useState<Receipt[]>([]), [before, setBefore] = useState<number | null>(null);
  const [revision, setRevision] = useState(0), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/uwm-webhook-receipts?brokerage=${encodeURIComponent(brokerageId)}${before ? `&before=${before}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json() as { receipts: Receipt[] };
        setRows(result.receipts);
      }).catch(() => { if (!controller.signal.aborted) setError("UWM receipts could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [brokerageId, before, revision]);
  const labels: Record<string, string> = { import: "Loan import", status: "Loan status", conditions: "Condition update", ulad: "Loan file export" };
  return <details className="uwm-deliveries" aria-label="UWM webhook receipts">
    <summary><Radio size={19} aria-hidden="true" /><span><strong>Delivery activity</strong><small>Webhook receipts · administrator tools</small></span>
      <span className="uwm-delivery-count">{loading ? "Loading…" : error ? "Unavailable" : before ? "Older receipts" : `${rows.length}${rows.length === 50 ? "+" : ""} recent`}</span><ChevronDown className="uwm-disclosure-icon" size={17} aria-hidden="true" /></summary>
    <div className="uwm-delivery-body"><p className="uwm-section-description">Messages received from UWM. A delivery confirms receipt, not a change to a loan or rate lock.</p>
      {error && <p className="uwm-feedback is-error" role="alert">{error}</p>}
      {loading ? <p className="uwm-loading" role="status">Loading delivery activity…</p> : !rows.length ? <div className="uwm-empty"><Radio size={22} aria-hidden="true" /><strong>No deliveries yet</strong><p>Incoming messages will appear here after UWM registers this workspace.</p></div> : <ul className="uwm-receipt-list">
        {rows.map(row => <li key={row.id}><div className="uwm-receipt-main"><strong>{labels[row.kind] ?? row.kind}</strong><span className="uwm-status">{row.status}</span></div>
          <div className="uwm-receipt-meta"><time dateTime={row.receivedAt}>{new Date(row.receivedAt).toLocaleString()}</time><span>{row.environment === "production" ? "Production" : "Test"}</span><span>Receipt {row.id}</span></div>
          <p className="uwm-receipt-reference">{row.loanNumber ? `UWM loan ${row.loanNumber}` : row.transactionId ? `Transaction ${row.transactionId}` : "Waiting for loan matching"}</p></li>)}
      </ul>}
      <div className="uwm-account-actions"><Button variant="outline" size="sm" disabled={loading} onClick={() => { setLoading(true); setError(""); setBefore(null); setRevision(value => value + 1); }}><RefreshCw size={14} aria-hidden="true" />Refresh activity</Button>
        {rows.length === 50 && <Button variant="outline" size="sm" disabled={loading} onClick={() => { setLoading(true); setError(""); setBefore(rows[rows.length - 1].id); }}>Older receipts</Button>}</div>
    </div>
  </details>;
}

"use client";
import { useEffect, useState } from "react";
import { ChevronDown, Radio, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

type Receipt = { id: number; environment: string; kind: string; transactionId: string | null; loanNumber: string | null; receivedAt: string; status: string; canMatch: boolean };
export function UwmReceipts({ brokerageId }: { brokerageId: string }) {
  const [rows, setRows] = useState<Receipt[]>([]), [before, setBefore] = useState<number | null>(null);
  const [revision, setRevision] = useState(0), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string; error: boolean } | null>(null);
  const endpoint = `/api/uwm-webhook-receipts?brokerage=${encodeURIComponent(brokerageId)}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${endpoint}${before ? `&before=${before}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json() as { receipts: Receipt[] };
        setRows(result.receipts);
      }).catch(() => { if (!controller.signal.aborted) setError("UWM receipts could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, before, revision]);
  async function match(row: Receipt, button: HTMLButtonElement) {
    if (matching !== null) return;
    setMatching(row.id);
    setNotice(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId: row.id }) });
      const result = await response.json().catch(() => ({})) as { status?: string; error?: string };
      if (!response.ok || result.status !== "Matched") throw new Error(result.error || "The receipt could not be matched. Try again.");
      button.closest("li")?.querySelector<HTMLElement>(".uwm-status")?.focus();
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: "Matched", canMatch: false } : item));
      setNotice({ id: row.id, text: "Receipt saved in the verified workspace’s delivery activity.", error: false });
    } catch (failure) {
      setNotice({ id: row.id, text: failure instanceof Error ? failure.message : "The receipt could not be matched. Try again.", error: true });
    } finally { setMatching(null); }
  }
  const labels: Record<string, string> = { import: "Loan import", status: "Loan status", conditions: "Condition update", ulad: "Loan file export" };
  return <details className="uwm-deliveries" aria-label="UWM webhook receipts">
    <summary><Radio size={19} aria-hidden="true" /><span><strong>Delivery activity</strong><small>Webhook receipts · administrator tools</small></span>
      <span className="uwm-delivery-count">{loading ? "Loading…" : error ? "Unavailable" : before ? "Older receipts" : `${rows.length}${rows.length === 50 ? "+" : ""} recent`}</span><ChevronDown className="uwm-disclosure-icon" size={17} aria-hidden="true" /></summary>
    <div className="uwm-delivery-body"><p className="uwm-section-description">Messages received from UWM. Matching saves a copy of the receipt in the verified workspace’s delivery activity.</p>
      {error && <p className="uwm-feedback is-error" role="alert">{error}</p>}
      {loading ? <p className="uwm-loading" role="status">Loading delivery activity…</p> : !rows.length ? <div className="uwm-empty"><Radio size={22} aria-hidden="true" /><strong>No deliveries yet</strong><p>Incoming messages will appear here after UWM registers this workspace.</p></div> : <ul className="uwm-receipt-list">
        {rows.map(row => <li key={row.id}><div className="uwm-receipt-main"><strong>{labels[row.kind] ?? row.kind}</strong><span className="uwm-status" tabIndex={-1}>{row.status}</span></div>
          <div className="uwm-receipt-meta"><time dateTime={row.receivedAt}>{new Date(row.receivedAt).toLocaleString()}</time><span>{row.environment === "production" ? "Production" : "Test"}</span><span>Receipt {row.id}</span></div>
          <div className="uwm-receipt-action-row">
            <p className="uwm-receipt-reference">{row.loanNumber ? `UWM loan ${row.loanNumber}` : row.transactionId ? `Transaction ${row.transactionId}` : "Waiting for loan matching"}</p>
            {row.canMatch && <Button variant="outline" size="sm" aria-label={`Match to verified loan, receipt ${row.id}`}
              aria-disabled={matching !== null} onClick={(event) => void match(row, event.currentTarget)}>
              {matching === row.id ? "Matching…" : "Match to verified loan"}
            </Button>}
          </div>
          {notice?.id === row.id && <p className={`uwm-feedback${notice.error ? " is-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
        </li>)}
      </ul>}
      <div className="uwm-account-actions"><Button variant="outline" size="sm" disabled={loading || matching !== null} onClick={() => { setLoading(true); setError(""); setNotice(null); setBefore(null); setRevision(value => value + 1); }}><RefreshCw size={14} aria-hidden="true" />Refresh activity</Button>
        {rows.length === 50 && <Button variant="outline" size="sm" disabled={loading || matching !== null} onClick={() => { setLoading(true); setError(""); setNotice(null); setBefore(rows[rows.length - 1].id); }}>Older receipts</Button>}</div>
    </div>
  </details>;
}

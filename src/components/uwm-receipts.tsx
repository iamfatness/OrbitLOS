"use client";
import { useEffect, useState } from "react";
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
  return <section className="document-form" aria-label="UWM webhook receipts">
    <h3>UWM webhook receipts</h3>
    <p>These receipts confirm delivery to Orbit. They do not by themselves confirm a loan update, condition clearance or rate lock.</p>
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Loading receipts…</p> : !rows.length ? <p>No receipts on this page.</p> : <ul>
      {rows.map((row) => <li key={row.id}>{row.environment.toUpperCase()} · {row.kind} · {row.loanNumber ? `UWM loan ${row.loanNumber}` : row.transactionId ? `Transaction ${row.transactionId}` : "Loan matching pending"}
        <br /><span className="muted">{new Date(row.receivedAt).toLocaleString()} · {row.status} · Receipt {row.id}</span></li>)}
    </ul>}
    <div className="loan-application-actions">
      <Button variant="outline" disabled={loading} onClick={() => { setLoading(true); setError(""); setBefore(null); setRevision((value) => value + 1); }}>Refresh latest</Button>
      {rows.length === 50 && <Button variant="outline" disabled={loading} onClick={() => { setLoading(true); setError(""); setBefore(rows[rows.length - 1].id); }}>Older receipts</Button>}
    </div>
  </section>;
}

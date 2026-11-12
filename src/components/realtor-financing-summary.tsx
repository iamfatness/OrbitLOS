"use client";

import { useEffect, useRef, useState } from "react";
import { borrowerFinancingTarget, realtorFinancingTarget, type BorrowerRealtorFinancingView, type RealtorFinancingTerms,
  type StaffRealtorFinancingView } from "@/lib/realtor-financing-model";
import { dateLabel } from "@/lib/client-retention";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function FinancingTerms({ terms }: { terms: RealtorFinancingTerms }) {
  return <dl className="realtor-financing-terms">
    <div><dt>Loan program</dt><dd>{terms.program}</dd></div>
    <div><dt>Loan term</dt><dd>{terms.termYears} years</dd></div>
    <div><dt>Sample loan amount</dt><dd>{dollars.format(terms.amountCents / 100)}</dd></div>
    <div><dt>Available through</dt><dd>{dateLabel(terms.quoteExpiresOn)} ET</dd></div>
  </dl>;
}

async function updateFinancing<T extends object>(endpoint: string, input: Record<string, unknown>, signal?: AbortSignal, portal = false): Promise<T> {
  const response = await fetch(endpoint, { method: "POST", credentials: portal ? "omit" : "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
    .catch(() => { throw new Error("Orbit could not confirm the change. Try again."); });
  const result = await response.json().catch(() => null) as T | { error: string } | null;
  if (!response.ok || !result || "error" in result) {
    throw new Error(result && "error" in result ? String(result.error) : "Orbit could not load this summary. Try again.");
  }
  return result;
}

export function StaffRealtorFinancing({ loanId, brokerageId, onChanged }: { loanId: string; brokerageId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return <details id={realtorFinancingTarget} className="details-section realtor-financing-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Realtor financing summary</summary>
    {open && <StaffFinancingDetails loanId={loanId} brokerageId={brokerageId} onChanged={onChanged} />}
  </details>;
}

function StaffFinancingDetails({ loanId, brokerageId, onChanged }: { loanId: string; brokerageId: string; onChanged: () => void }) {
  const endpoint = `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}&view=realtor-financing`;
  const [view, setView] = useState<StaffRealtorFinancingView>();
  const [load, setLoad] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const pending = useRef<{ basis: string; id: string } | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const withdrawButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    updateFinancing<StaffRealtorFinancingView>(endpoint, { type: "read", loanId }, controller.signal).then(value => {
      if (!controller.signal.aborted) { setView(value); setError(""); }
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [endpoint, loanId, load]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => { if (view?.message) status.current?.focus(); }, [view]);

  async function save(type: "request" | "publish" | "withdraw") {
    if (!view || busy) return;
    const basis = view.preview?.basis;
    let requestId = view.request?.id;
    if (type === "request" && basis) {
      if (pending.current?.basis !== basis) pending.current = { basis, id: crypto.randomUUID() };
      requestId = pending.current.id;
    }
    if (!requestId || (type !== "withdraw" && !basis)) return;
    setBusy(true);
    setError("");
    try {
      setView(await updateFinancing<StaffRealtorFinancingView>(endpoint,
        { type, loanId, requestId, ...(type === "withdraw" ? {} : { basis }) }));
      pending.current = null;
      setConfirmWithdraw(false);
      onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Try saving again."); }
    finally { setBusy(false); }
  }

  const request = view?.request;
  const canPublish = view?.current && request?.permissions.every(party => party.status === "Approved") && !request.publishedAt;
  return <div className="record-form realtor-financing-content">
    {error && <p ref={alert} tabIndex={-1} className="application-message banner-error" role="alert">{error}</p>}
    {!view && !error && <p className="muted" role="status">Loading financing summary…</p>}
    {view?.message && <p ref={status} tabIndex={-1} className="application-message" role="status">{view.message}</p>}
    {view?.blocked && <p className="muted">{view.blocked}</p>}
    {view?.preview && <>
      <p><strong>Realtor</strong> {view.preview.realtorName} <span className="pill">Fictional estimate</span></p>
      <FinancingTerms terms={view.preview.terms} />
    </>}
    {request && <div className="record-form">
      <p className="muted">{view?.current && request.publishedAt ? `Published ${dateTime(request.publishedAt)} ET` :
        view?.current ? `Permission requested ${dateTime(request.requestedAt)} ET` : request.endReason ?? "Previous request is no longer current."}</p>
      <ul className="realtor-financing-permissions" aria-label="Borrower permissions">
        {request.permissions.map(party => <li key={party.participant}>
          <strong>{party.participant}</strong> <span className="pill">{party.status}</span>
          {party.decidedAt && <small className="muted">{dateTime(party.decidedAt)} ET</small>}
        </li>)}
      </ul>
    </div>}
    {confirmWithdraw && <p>Remove this summary from the realtor portal and close the permission request?</p>}
    <div className="loan-application-actions">
      {view?.preview && !view.current && <Button size="sm" className="min-h-11" disabled={busy}
        onClick={() => void save("request")}>Request borrower permission</Button>}
      {canPublish && <Button size="sm" className="min-h-11" disabled={busy}
        onClick={() => void save("publish")}>Publish to realtor portal</Button>}
      {view?.current && !confirmWithdraw && <Button ref={withdrawButton} size="sm" className="min-h-11" variant="outline"
        disabled={busy} onClick={() => setConfirmWithdraw(true)}>Withdraw request</Button>}
      {confirmWithdraw && <>
        <Button size="sm" autoFocus className="min-h-11" disabled={busy} onClick={() => void save("withdraw")}>Confirm withdrawal</Button>
        <Button size="sm" className="min-h-11" variant="outline" disabled={busy} onClick={() => {
          setConfirmWithdraw(false);
          requestAnimationFrame(() => withdrawButton.current?.focus());
        }}>Keep request</Button>
      </>}
      {!confirmWithdraw && <Button size="sm" className="min-h-11" variant="outline" disabled={busy}
        onClick={() => setLoad(value => value + 1)}>Refresh sharing status</Button>}
    </div>
  </div>;
}

export function BorrowerFinancingPermission({ token, initial, onAnswered }: {
  token: string; initial: NonNullable<BorrowerRealtorFinancingView["request"]>; onAnswered: (requestId: string) => void;
}) {
  const [decision, setDecision] = useState<BorrowerRealtorFinancingView["request"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const attempt = useRef<{ decision: string; id: string } | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice) feedback.current?.focus(); }, [notice]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  const request = decision === null ? null : decision?.permission === "Approved" && initial.permission === "Pending"
    ? { ...initial, permission: "Approved" as const } : initial;

  async function respond(decision: "Approve" | "Decline" | "Revoke") {
    if (!request || busy) return;
    if (attempt.current?.decision !== decision) attempt.current = { decision, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await updateFinancing<BorrowerRealtorFinancingView>("/api/realtor-financing-permission",
        { token, type: "respond", requestId: request.id, decision, operationId: attempt.current.id }, undefined, true);
      setDecision(value.request);
      attempt.current = null;
      onAnswered(request.id);
      setNotice(decision === "Approve" ? "Permission recorded." :
        decision === "Decline" ? "You declined to share this summary." : "Your permission was withdrawn.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Try saving your decision again."); }
    finally { setBusy(false); }
  }

  return <section id={borrowerFinancingTarget} tabIndex={-1} data-borrower-action-target
    className="application-panel application-receipt document-section" aria-labelledby="borrower-realtor-financing-heading">
    <h2 id="borrower-realtor-financing-heading">Realtor sharing permission</h2>
    {notice && <p ref={feedback} tabIndex={-1} className="application-message" role="status">{notice}</p>}
    {error && <p ref={alert} tabIndex={-1} className="application-message banner-error" role="alert">{error}</p>}
    {request && <>
      <p>Your loan officer is asking to share this sample summary with <strong>{request.realtorName}</strong>.</p>
      <FinancingTerms terms={request.terms} />
      {request.permission === "Pending" ? <div className="loan-application-actions">
        <Button size="sm" className="min-h-11" disabled={busy} onClick={() => void respond("Approve")}>Allow sharing</Button>
        <Button size="sm" className="min-h-11" variant="outline" disabled={busy} onClick={() => void respond("Decline")}>Decline</Button>
      </div> : <div className="record-form">
        <p className="muted">{request.publishedAt ? "The summary is available to your realtor." :
          "You’ve given permission. Your loan officer can publish after everyone on the loan approves."}</p>
        <div><Button size="sm" className="min-h-11" variant="outline" disabled={busy}
          onClick={() => void respond("Revoke")}>Withdraw permission</Button></div>
      </div>}
    </>}
  </section>;
}

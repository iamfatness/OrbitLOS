"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { RealtorReferralCursor, RealtorReferrals } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { portalTokenPattern } from "@/lib/brokerage-model";
import { OrbitRings, PortalHeader } from "./orbit-brand";
import { SharedPreapprovalDownload } from "./shared-preapproval";
import { OptionalPropertyState } from "./property-state-field";
import { FinancingTerms } from "./realtor-financing-summary";

class ReferralRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function requestReferrals(token: string, signal: AbortSignal, submission?: Record<string, unknown>) {
  if (!portalTokenPattern.test(token)) throw new Error("Open the complete referral link from your loan officer.");
  const response = await fetch("/api/realtor-referrals", { method: "POST", credentials: "omit", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...submission }) });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string } | null;
    throw new ReferralRequestError(failure?.error ?? "Could not load your referrals. Try again.", response.status);
  }
  return await response.json() as RealtorReferrals;
}

function ReferralForm({ token, initiallyOpen, onSubmitted }: { token: string; initiallyOpen: boolean; onSubmitted: (view: RealtorReferrals) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const active = useRef<AbortController | null>(null);
  const attempt = useRef<{ id: string; fields: string } | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const referral = { name: String(fields.get("name") ?? "").trim(), email: String(fields.get("email") ?? "").trim(),
      phone: String(fields.get("phone") ?? "").trim(), purpose: fields.get("purpose"),
      propertyState: fields.get("propertyState"), consent: fields.has("consent") };
    setError("");
    if (!referral.email && !referral.phone) {
      setError("Enter an email address or phone number.");
      return;
    }
    const signature = JSON.stringify(referral);
    if (attempt.current?.fields !== signature) attempt.current = { id: crypto.randomUUID(), fields: signature };
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const result = await requestReferrals(token, controller.signal, { type: "submit", requestId: attempt.current.id, ...referral });
      if (controller.signal.aborted || window.location.hash.slice(1) !== token) return;
      attempt.current = null;
      form.reset();
      if (disclosure.current) disclosure.current.open = false;
      onSubmitted(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not submit your referral.");
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <details className="pipeline referral-intake" ref={disclosure} open={initiallyOpen}>
    <summary>Submit a referral</summary>
    <p className="muted">Use fictional details. Include an email or phone number for follow-up.</p>
    <form className="referral-intake-form" onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <label className="field">Prospect name<input name="name" autoComplete="off" maxLength={160} required disabled={busy} /></label>
        <label className="field">Loan purpose<select name="purpose" disabled={busy}><option>Purchase</option><option>Refinance</option></select></label>
        <label className="field">Prospect email<input name="email" type="email" autoComplete="off" maxLength={160} disabled={busy} /></label>
        <label className="field">Prospect phone<input name="phone" type="tel" autoComplete="off" maxLength={40} disabled={busy} /></label>
        <OptionalPropertyState disabled={busy} />
      </div>
      <label className="demo-confirm"><input type="checkbox" name="consent" required disabled={busy} /> I have permission to share these details with the loan team.</label>
      <div><Button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit referral"}</Button></div>
    </form>
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
  </details>;
}

export function RealtorReferralPortal() {
  const [portal, setPortal] = useState<{ token: string; view: RealtorReferrals; after?: RealtorReferralCursor;
    previous: (RealtorReferralCursor | undefined)[] } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);
  const pending = useRef<AbortController | null>(null);
  const referralsHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback((after?: RealtorReferralCursor, previous: (RealtorReferralCursor | undefined)[] = []) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const { signal } = controller;
    const token = window.location.hash.slice(1);
    void requestReferrals(token, signal, { type: "read", after }).then((view) => {
      if (!signal.aborted && window.location.hash.slice(1) === token) setPortal({ token, view, after, previous });
    }).catch((failure: unknown) => {
      if (!signal.aborted && window.location.hash.slice(1) === token) {
        if (failure instanceof ReferralRequestError && [400, 401, 403, 404, 410].includes(failure.status)) setPortal(null);
        else setPortal(current => current && current.view.referrals.some(referral => referral.financing)
          ? { ...current, view: { ...current.view, referrals: current.view.referrals.map(referral => ({ ...referral, financing: undefined })) } }
          : current);
        setError(failure instanceof Error ? failure.message : "Could not load your referrals.");
      }
    }).finally(() => {
      if (pending.current === controller) pending.current = null;
      if (!signal.aborted) setBusy(false);
    });
  }, []);

  useEffect(() => {
    function switchLink() {
      setPortal(null);
      setError("");
      setNotice("");
      setBusy(true);
      load();
    }
    load();
    window.addEventListener("hashchange", switchLink);
    return () => {
      pending.current?.abort();
      window.removeEventListener("hashchange", switchLink);
    };
  }, [load]);

  const hasFinancing = portal?.view.referrals.some(referral => referral.financing);
  const after = portal?.after, previous = portal?.previous;
  useEffect(() => {
    if (!hasFinancing) return;
    const recheck = () => { if (!pending.current && !document.hidden) load(after, previous); };
    window.addEventListener("focus", recheck);
    const interval = window.setInterval(recheck, 30_000);
    return () => { window.removeEventListener("focus", recheck); window.clearInterval(interval); };
  }, [after, previous, hasFinancing, load]);

  function showPage(after?: RealtorReferralCursor, previous: (RealtorReferralCursor | undefined)[] = []) {
    setBusy(true);
    setError("");
    setNotice("");
    load(after, previous);
  }

  return <><PortalHeader label="Referral updates" /><main className="referral-portal">
    <div className="page-heading application-intro"><OrbitRings /><div>
      <h1>Your referrals</h1>{portal && <p>{portal.view.realtorName}</p>}
    </div><Button variant="outline" disabled={busy} onClick={() => showPage(portal?.after, portal?.previous)}>
      {busy ? "Refreshing…" : "Refresh referrals"}
    </Button></div>
    {error && <p className="application-message banner-error" role="alert">{error}{portal && " Showing the last loaded referrals. Refresh to try again."}</p>}
    {notice && <p className="application-message" role="status">{notice}</p>}
    {!portal && !error && <p role="status">Loading your referrals…</p>}
    {portal && <div className="relationship-stack">
      <ReferralForm key={portal.token} token={portal.token} initiallyOpen={!portal.view.referrals.length} onSubmitted={(view) => {
        pending.current?.abort();
        setBusy(false);
        setError("");
        setNotice("Referral received. Your loan team will follow up.");
        setPortal({ token: portal.token, view, previous: [] });
        requestAnimationFrame(() => referralsHeading.current?.focus());
      }} />
      <section className="pipeline referral-updates" aria-label="Your referred loans" aria-busy={busy}>
      <div className="section-heading"><h2 ref={referralsHeading} tabIndex={-1}>Referral updates</h2></div>
      {portal.view.referrals.length ? <div className="table-scroll"><table className="data-table referral-table">
        <thead><tr><th>Borrower</th><th>Milestone</th><th>Milestone updated</th></tr></thead>
        <tbody>{portal.view.referrals.map((loan, index) => <tr key={index}><td>{loan.borrowerName}
          {loan.financing && <details className="realtor-financing-disclosure realtor-referral-financing">
            <summary>Sample financing summary</summary>
            <FinancingTerms terms={loan.financing} />
          </details>}
          {loan.preapproval && <SharedPreapprovalDownload key={loan.preapproval.grantId} letter={loan.preapproval} token={portal.token}
            audience="Realtor" name={loan.borrowerName} />}</td><td>{loan.closingPause?.label ?? loan.stage}</td>
          <td><span className="referral-date-label">Updated </span>{dateTime(loan.closingPause?.since ?? loan.updatedAt)} ET</td></tr>)}</tbody>
      </table></div> : <p className="empty-inline no-matches">No referrals yet. Submit your first referral above to track its progress here.</p>}
      {(portal.previous.length > 0 || portal.view.next) && <div className="toolbar" aria-label="Referral pages">
        <Button variant="outline" disabled={busy || !portal.previous.length}
          onClick={() => showPage(portal.previous.at(-1), portal.previous.slice(0, -1))}>Newer referrals</Button>
        <Button variant="outline" disabled={busy || !portal.view.next}
          onClick={() => showPage(portal.view.next ?? undefined, [...portal.previous, portal.after])}>Older referrals</Button>
        <span className="muted" role="status">Page {portal.previous.length + 1}</span>
      </div>}
      </section>
    </div>}
    <p className="muted referral-portal-help">Keep this link private. Ask your loan officer for a new link when it expires.</p>
  </main></>;
}

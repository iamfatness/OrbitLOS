"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { RealtorReferrals } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { portalTokenPattern } from "@/lib/brokerage-model";
import { OrbitRings, PortalHeader } from "./orbit-brand";

async function requestReferrals(token: string, signal: AbortSignal, submission?: Record<string, unknown>) {
  if (!portalTokenPattern.test(token)) throw new Error("Open the complete referral link from your loan officer.");
  const response = await fetch("/api/realtor-referrals", { method: "POST", credentials: "omit", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...submission }) });
  if (!response.ok) {
    const failure = await response.json() as { error?: string };
    throw new Error(failure.error ?? "Could not load your referrals.");
  }
  return await response.json() as RealtorReferrals;
}

function ReferralForm({ token, onSubmitted }: { token: string; onSubmitted: (view: RealtorReferrals) => void }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const attempt = useRef<{ id: string; fields: string } | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const referral = { name: String(fields.get("name") ?? "").trim(), email: String(fields.get("email") ?? "").trim(),
      phone: String(fields.get("phone") ?? "").trim(), purpose: fields.get("purpose"), consent: fields.has("consent") };
    setMessage("");
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
      onSubmitted(result);
      setMessage("Referral received. Your loan team can follow up from Orbit.");
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not submit your referral.");
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="pipeline relationship-panel" aria-labelledby="submit-referral-heading">
    <h2 id="submit-referral-heading">Submit a referral</h2>
    <p className="muted">Use fictional contact details for this demo. Enter an email address or phone number so the loan officer can follow up.</p>
    <form className="referral-intake-form" onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <label className="field">Prospect name<input name="name" autoComplete="off" maxLength={160} required disabled={busy} /></label>
        <label className="field">Loan purpose<select name="purpose" disabled={busy}><option>Purchase</option><option>Refinance</option></select></label>
        <label className="field">Prospect email<input name="email" type="email" autoComplete="off" maxLength={160} disabled={busy} /></label>
        <label className="field">Prospect phone<input name="phone" type="tel" autoComplete="off" maxLength={40} disabled={busy} /></label>
      </div>
      <label className="demo-confirm"><input type="checkbox" name="consent" required disabled={busy} /> I have permission to share these details with the loan team.</label>
      <div><Button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit referral"}</Button></div>
    </form>
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {message && <p className="application-message" role="status">{message}</p>}
  </section>;
}

export function RealtorReferralPortal() {
  const [portal, setPortal] = useState<{ token: string; view: RealtorReferrals } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const pending = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const { signal } = controller;
    const token = window.location.hash.slice(1);
    void requestReferrals(token, signal).then((view) => {
      if (!signal.aborted) setPortal({ token, view });
    }).catch((failure: unknown) => {
      if (!signal.aborted) {
        setPortal(null);
        setError(failure instanceof Error ? failure.message : "Could not load your referrals.");
      }
    }).finally(() => {
      if (!signal.aborted) setBusy(false);
    });
  }, []);

  useEffect(() => {
    function switchLink() {
      setPortal(null);
      setError("");
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

  return <><PortalHeader label="Referral updates" /><main className="referral-portal">
    <div className="page-heading application-intro"><OrbitRings /><div><p className="eyebrow">REALTOR WORKSPACE</p>
      <h1>Your referrals</h1><p>{portal ? `Loan milestones for ${portal.view.realtorName}.` : "Open your referral link to see updates from your loan team."}</p>
    </div><Button variant="outline" disabled={busy} onClick={() => { setBusy(true); setError(""); load(); }}>
      {busy ? "Refreshing…" : "Refresh referrals"}
    </Button></div>
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {!portal && !error && <p role="status">Loading your referrals…</p>}
    {portal && <div className="relationship-stack">
      <ReferralForm key={portal.token} token={portal.token} onSubmitted={(view) => {
        pending.current?.abort();
        setBusy(false);
        setPortal({ token: portal.token, view });
      }} />
      <section className="pipeline" aria-label="Your referred loans">
      {portal.view.referrals.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Borrower</th><th>Milestone</th><th>Milestone updated</th></tr></thead>
        <tbody>{portal.view.referrals.map((loan, index) => <tr key={index}><td>{loan.borrowerName}</td><td>{loan.stage}</td><td>{dateTime(loan.updatedAt)} ET</td></tr>)}</tbody>
      </table></div> : <p className="empty-inline no-matches">Submit a referral above. The loan team can follow up and share pipeline milestones here.</p>}
      </section>
    </div>}
    <p className="muted referral-portal-help">Keep this link private. Ask your loan officer for a new link when it expires.</p>
  </main></>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Orbit } from "lucide-react";
import type { RealtorReferrals } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

async function requestReferrals(signal?: AbortSignal) {
  const token = window.location.hash.slice(1);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Open the complete referral link from your loan officer.");
  const response = await fetch("/api/realtor-referrals", { method: "POST", credentials: "omit", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
  if (!response.ok) {
    const failure = await response.json() as { error?: string };
    throw new Error(failure.error ?? "Could not load your referrals.");
  }
  return await response.json() as RealtorReferrals;
}

export function RealtorReferralPortal() {
  const [view, setView] = useState<RealtorReferrals | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const pending = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const { signal } = controller;
    void requestReferrals(signal).then((result) => {
      if (!signal?.aborted) setView(result);
    }).catch((failure: unknown) => {
      if (!signal?.aborted) {
        setView(null);
        setError(failure instanceof Error ? failure.message : "Could not load your referrals.");
      }
    }).finally(() => {
      if (!signal?.aborted) setBusy(false);
    });
  }, []);

  useEffect(() => {
    function switchLink() {
      setView(null);
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

  return <main className="referral-portal">
    <header className="application-top"><div className="brand"><span className="brand-icon"><Orbit size={22} aria-hidden="true" /></span>OrbitLOS</div>
      <span className="pill">Referral updates</span></header>
    <div className="page-heading"><div><p className="eyebrow">REALTOR WORKSPACE</p>
      <h1>Your referrals</h1><p>{view ? `Loan milestones for ${view.realtorName}.` : "Open your referral link to see updates from your loan team."}</p>
    </div><Button variant="outline" disabled={busy} onClick={() => { setBusy(true); setError(""); load(); }}>
      {busy ? "Refreshing…" : "Refresh referrals"}
    </Button></div>
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {!view && !error && <p role="status">Loading your referrals…</p>}
    {view && <section className="pipeline" aria-label="Your referred loans">
      {view.referrals.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Borrower</th><th>Milestone</th><th>Milestone updated</th></tr></thead>
        <tbody>{view.referrals.map((loan, index) => <tr key={index}><td>{loan.borrowerName}</td><td>{loan.stage}</td><td>{dateTime(loan.updatedAt)} ET</td></tr>)}</tbody>
      </table></div> : <p className="empty-inline no-matches">Your loan team will link your referrals as they arrive.</p>}
    </section>}
    <p className="muted referral-portal-help">Keep this link private. Ask your loan officer for a new link when it expires.</p>
  </main>;
}

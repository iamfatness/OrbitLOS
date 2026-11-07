"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Orbit } from "lucide-react";
import { portalTokenPattern } from "@/lib/brokerage-model";
import { Button } from "./ui/button";

export function QuoteRequestForm() {
  const [token, setToken] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);
  const request = useRef<AbortController | null>(null);
  const attempt = useRef<{ id: string; fields: string } | null>(null);
  useEffect(() => {
    const readLink = () => {
      request.current?.abort();
      request.current = null;
      attempt.current = null;
      setToken(window.location.hash.slice(1));
      setReceived(false);
      setError("");
      setBusy(false);
    };
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => { request.current?.abort(); window.removeEventListener("hashchange", readLink); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || request.current) return;
    const fields = new FormData(event.currentTarget);
    const payload = { token, name: fields.get("name"), email: fields.get("email"), phone: fields.get("phone"), zip: fields.get("zip"),
      purpose: fields.get("purpose"), consent: fields.has("consent"), website: fields.get("website") };
    if (!String(payload.email).trim() && !String(payload.phone).trim()) {
      setError("Enter an email address or phone number.");
      return;
    }
    const signature = JSON.stringify(payload);
    if (attempt.current?.fields !== signature) attempt.current = { id: crypto.randomUUID(), fields: signature };
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/quote-requests", { method: "POST", credentials: "omit", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: attempt.current.id }) });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error || "Orbit could not receive the request.");
      }
      if (!controller.signal.aborted) setReceived(true);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Try again in a moment.");
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }

  return <main className="application-shell">
    <header className="application-top">
      <div className="brand"><span className="brand-icon"><Orbit size={22} aria-hidden="true" /></span><span>OrbitLOS</span></div>
      <span className="pill">Fictional pilot</span>
    </header>
    <div className="application-intro">
      <p className="eyebrow">QUOTE REQUEST</p>
      <h1>Request a mortgage quote</h1>
      <p>Tell the loan team how to reach you and what you’re looking for.</p>
    </div>
    <aside className="application-warning">Fictional pilot. Use sample contact details.</aside>
    <section className="pipeline relationship-panel" aria-label="Quote request">
      {received ? <p role="status">Quote request received. It’s in the brokerage’s lead inbox.</p> : token && portalTokenPattern.test(token) ?
        <form className="record-form" onSubmit={(event) => void submit(event)}>
          <div className="form-grid">
            <label className="field">Full name<input name="name" required maxLength={160} autoComplete="off" /></label>
            <label className="field">Loan purpose<select name="purpose"><option>Purchase</option><option>Refinance</option></select></label>
            <label className="field">Email<input name="email" type="email" maxLength={160} autoComplete="off" /></label>
            <label className="field">Phone<input name="phone" type="tel" maxLength={40} autoComplete="off" /></label>
            <label className="field">Property ZIP (optional)<input name="zip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} /></label>
          </div>
          <input name="website" type="hidden" value="" readOnly />
          <p className="muted">Enter an email address or phone number.</p>
          <label className="demo-confirm"><input type="checkbox" name="consent" required /> I give the loan team permission to follow up about this request.</label>
          <div><Button disabled={busy} type="submit">{busy ? "Submitting…" : "Request a quote"}</Button></div>
        </form> : <p>{token === undefined ? "Opening quote request…" : "Open the complete quote-request link from your brokerage."}</p>}
      {error && <p className="application-message banner-error" role="alert">{error}</p>}
    </section>
  </main>;
}

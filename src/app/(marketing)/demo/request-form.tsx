"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export function DemoForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const sending = useRef(false);
  const confirmation = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (reference) confirmation.current?.focus(); }, [reference]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/demo-request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(fields)),
      });
      const raw: unknown = await response.json();
      const result = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      if (!response.ok || result.sent !== true || typeof result.reference !== "string") {
        setError(typeof result.error === "string" ? result.error : "We couldn’t send the request. Try again or email demo@orbitlos.com.");
      } else setReference(result.reference);
    } catch { setError("We couldn’t connect. Your entries are still here—try again or email demo@orbitlos.com."); }
    finally { sending.current = false; setBusy(false); }
  }

  if (reference) return <div className="marketing-request-card marketing-confirmation">
    <CheckCircle2 size={36} aria-hidden="true" />
    <h2 ref={confirmation} tabIndex={-1}>Request sent.</h2>
    <p>We’ll email you to arrange your demo.</p>
    <p className="marketing-request-note">Need to add something? Email <a href="mailto:demo@orbitlos.com">demo@orbitlos.com</a>.</p>
    <p className="marketing-request-reference">Request reference: {reference}</p>
    <a className="marketing-text-link" href="/product">Explore Orbit <ArrowRight size={16} aria-hidden="true" /></a>
  </div>;

  return <form className="marketing-request-card marketing-request-form" onSubmit={submit} aria-label="Request an OrbitLOS demo" aria-busy={busy}>
    <h2>Request a demo</h2><p>Required unless marked optional.</p>
    <label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={100} /></label>
    <label>Work email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
    <label>Brokerage<input name="brokerage" autoComplete="organization" required minLength={2} maxLength={160} /></label>
    <label>Team size<select name="teamSize" required defaultValue=""><option value="" disabled>Select your team size</option>{["Just me", "2–5", "6–20", "21–50", "51+"].map(size => <option key={size}>{size}</option>)}</select></label>
    <label>What would you like to explore? <span className="marketing-optional">(optional)</span><textarea name="interests" rows={3} maxLength={1200} placeholder="Lead follow-up, processing, reporting…" /></label>
    <div hidden aria-hidden="true"><label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    <p className="marketing-form-disclosure">OrbitLOS uses these details to respond to your request. Share business needs only; keep borrower details in your secure loan system.</p>
    {error && <p className="marketing-form-error" role="alert">{error}</p>}
    <button className="marketing-button" type="submit" disabled={busy}>{busy ? "Sending your request…" : "Send demo request"}<ArrowRight size={17} aria-hidden="true" /></button>
    <p className="marketing-form-disclosure">You can also <a href="mailto:demo@orbitlos.com">email demo@orbitlos.com</a>.</p>
    <noscript>Please enable JavaScript to use this form, or email demo@orbitlos.com.</noscript>
  </form>;
}

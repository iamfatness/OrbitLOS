"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { portalTokenPattern } from "@/lib/brokerage-model";
import { defaultQuoteIntakeConfig, quoteFormChanged, quotePurpose, quoteResponseIssue, quoteTimelines,
  type PublicQuoteForm, type QuotePurpose } from "@/lib/quote-intake-model";
import { Button } from "./ui/button";
import { OrbitRings, PortalHeader } from "./orbit-brand";

export function QuoteIntakeHeading({ config, preview }: { config: PublicQuoteForm["config"]; preview?: boolean }) {
  return <div className="application-intro">
    <OrbitRings /><p className="eyebrow">QUOTE REQUEST</p>
    {preview ? <h3>{config.title}</h3> : <h1>{config.title}</h1>}{config.introduction && <p>{config.introduction}</p>}
  </div>;
}

export function QuoteIntakeFields({ config, purpose, changePurpose, busy = false, preview = false, revision }: {
  config: PublicQuoteForm["config"]; purpose: QuotePurpose; changePurpose?: (purpose: QuotePurpose) => void;
  busy?: boolean; preview?: boolean; revision?: number;
}) {
  const detailsKey = `${purpose}:${revision ?? 0}`;
  return <>
    <div className="form-grid">
      <label className="field">Full name<input name="name" required maxLength={160} autoComplete="off" disabled={busy} /></label>
      <label className="field">Loan purpose<select name="purpose" value={purpose} disabled={busy || preview}
        onChange={(event) => { const value = quotePurpose.safeParse(event.target.value); if (value.success) changePurpose?.(value.data); }}>
        {quotePurpose.options.map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <label className="field">{config.contact === "Email required" ? "Email (required)" : "Email"}<input name="email" type="email" maxLength={160} autoComplete="off" required={config.contact === "Email required"} disabled={busy} /></label>
      <label className="field">{config.contact === "Phone required" ? "Phone (required)" : "Phone"}<input name="phone" type="tel" maxLength={40} autoComplete="off" required={config.contact === "Phone required"} disabled={busy} /></label>
      {config.zip !== "Hidden" && <label className="field" key={`zip:${detailsKey}`}>{config.zip === "Optional" ? "Property ZIP (optional)" : "Property ZIP"}
        <input name="zip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required={config.zip === "Required"} disabled={busy} /></label>}
      {config.timing !== "Hidden" && <label className="field" key={`timing:${detailsKey}`}>{config.timing === "Optional" ? "When are you hoping to move forward? (optional)" : "When are you hoping to move forward?"}
        <select name="timing" required={config.timing === "Required"} defaultValue="" disabled={busy}>
          <option value="">Choose a timeline</option>{quoteTimelines.map((timing) => <option key={timing}>{timing}</option>)}
        </select></label>}
    </div>
    {config.question && <label className="field" key={`question:${detailsKey}:${config.question.prompt}`}>{config.question.prompt}{!config.question.required && " (optional)"}
      <input name="answer" type="text" maxLength={200} required={config.question.required} autoComplete="off" disabled={busy} /></label>}
    {config.contact === "Email or phone" && <p className="muted">Enter an email address or phone number.</p>}
    <input name="website" type="hidden" value="" readOnly />
    <label className="demo-confirm" key={`consent:${detailsKey}`}><input type="checkbox" name="consent" required disabled={busy} />
      <span>I give the loan team permission to follow up about this request.</span></label>
    <div><Button className="quote-intake-submit" disabled={busy || preview} type={preview ? "button" : "submit"}>
      {busy ? "Submitting…" : "Request a quote"}
    </Button></div>
  </>;
}

async function quoteRequest<T>(data: object, signal: AbortSignal) {
  const response = await fetch("/api/quote-requests", { method: "POST", credentials: "omit", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Orbit could not open the quote request. Try again in a moment.");
  if (!response.ok) {
    const failure = await response.json() as { error?: string };
    throw new Error(failure.error ?? "Orbit could not receive the request.");
  }
  return response.json() as Promise<T>;
}

function PublishedQuoteRequest({ token, initialPurpose }: { token: string; initialPurpose: QuotePurpose }) {
  const [purpose, setPurpose] = useState(initialPurpose);
  const [lastForm, setForm] = useState<{ purpose: QuotePurpose; value: PublicQuoteForm }>();
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);
  const request = useRef<AbortController>(null);
  const attempt = useRef<{ id: string; fields: string }>(null);
  const form = lastForm?.purpose === purpose ? lastForm.value : undefined;
  useEffect(() => {
    const controller = new AbortController();
    void quoteRequest<PublicQuoteForm>({ type: "read", token, purpose }, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setForm({ purpose, value }); })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not open the quote form.");
      });
    return () => controller.abort();
  }, [token, purpose, reload]);
  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || request.current) return;
    const fields = new FormData(event.currentTarget);
    const text = (name: string) => String(fields.get(name) ?? "").trim();
    const payload = { token, formRevision: form.revision, name: text("name"), email: text("email"), phone: text("phone"),
      zip: text("zip"), timing: text("timing"), answer: text("answer"), purpose,
      consent: fields.has("consent"), website: text("website") };
    const problem = quoteResponseIssue(form.config, payload);
    if (problem) { setError(problem); return; }
    const signature = JSON.stringify(payload);
    if (attempt.current?.fields !== signature) attempt.current = { id: crypto.randomUUID(), fields: signature };
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setBusy(true);
    try {
      await quoteRequest<{ received: true }>({ ...payload, requestId: attempt.current.id }, controller.signal);
      if (!controller.signal.aborted) setReceived(true);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : "Try again in a moment.";
      if (message === quoteFormChanged) {
        try {
          const value = await quoteRequest<PublicQuoteForm>({ type: "read", token, purpose }, controller.signal);
          if (!controller.signal.aborted) setForm({ purpose, value });
        } catch { /* Keep the message and let the user refresh the link. */ }
      }
      if (!controller.signal.aborted) setError(message);
    } finally {
      if (request.current === controller) { request.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  }

  const config = lastForm?.value.config ?? defaultQuoteIntakeConfig;
  return <main className="application-shell quote-intake" data-theme={config.theme}>
    <QuoteIntakeHeading config={config} />
    <aside className="application-warning">Fictional pilot. Use sample contact details.</aside>
    <section className="pipeline relationship-panel" aria-label="Quote request">
      {received ? <p role="status">Quote request received. It’s in the brokerage’s lead inbox.</p> : <>
        {!form && !error && <p role="status">Opening {purpose.toLowerCase()} questions…</p>}
        {lastForm && <form className="record-form" onSubmit={(event) => void submit(event)}>
          <QuoteIntakeFields config={config} purpose={purpose} busy={busy || !form} revision={lastForm.value.revision} changePurpose={(next) => {
            setError("");
            setPurpose(next);
          }} />
        </form>}
        {!form && error && <Button size="sm" variant="outline" onClick={() => { setError(""); setReload((value) => value + 1); }}>Reload quote form</Button>}
      </>}
      {error && <p className="application-message banner-error" role="alert">{error}</p>}
    </section>
  </main>;
}

export function QuoteRequestForm() {
  const [link, setLink] = useState<{ token: string; purpose: QuotePurpose }>();
  useEffect(() => {
    const readLink = () => {
      const purpose = quotePurpose.safeParse(new URLSearchParams(window.location.search).get("purpose"));
      setLink({ token: window.location.hash.slice(1), purpose: purpose.success ? purpose.data : "Purchase" });
    };
    readLink();
    window.addEventListener("hashchange", readLink);
    window.addEventListener("popstate", readLink);
    return () => {
      window.removeEventListener("hashchange", readLink);
      window.removeEventListener("popstate", readLink);
    };
  }, []);
  return <><PortalHeader label="Fictional pilot" />{link && portalTokenPattern.test(link.token) ?
    <PublishedQuoteRequest key={`${link.token}:${link.purpose}`} token={link.token} initialPurpose={link.purpose} /> :
    <main className="application-shell"><QuoteIntakeHeading config={defaultQuoteIntakeConfig} />
      <p>{link === undefined ? "Opening quote request…" : "Open the complete quote-request link from your brokerage."}</p></main>}</>;
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { quoteContactOptions, quoteFieldModes, quoteIntakeConfig, quoteThemes,
  type QuoteIntakeConfig, type QuoteIntakeSettings } from "@/lib/quote-intake-model";
import { QuoteIntakeFields, QuoteIntakeHeading } from "./quote-request";
import { Button } from "./ui/button";

async function settingsRequest(endpoint: string, data: object, signal?: AbortSignal) {
  const response = await fetch(endpoint, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Could not load quote form settings.");
  const value = await response.json() as QuoteIntakeSettings | { error: string };
  if ("error" in value || !response.ok) throw new Error("error" in value ? value.error : "Could not load quote form settings.");
  return value;
}

export function QuoteIntakeEditor({ brokerageId }: { brokerageId: string }) {
  const [started, setStarted] = useState(false);
  const [published, setPublished] = useState<QuoteIntakeSettings>();
  const [draft, setDraft] = useState<QuoteIntakeConfig>();
  const [campaigns, setCampaigns] = useState<QuoteIntakeSettings["campaigns"]>([]);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const active = useRef(false);
  const endpoint = `/api/quote-intake-settings?brokerage=${encodeURIComponent(brokerageId)}`;
  useEffect(() => {
    if (!started) return;
    const controller = new AbortController();
    void settingsRequest(endpoint, { type: "read" }, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setPublished(value);
      setDraft(value.config);
      setCampaigns(value.campaigns);
      setMessage(undefined);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setMessage({ text: error instanceof Error ? error.message : "Could not load settings.", error: true });
    });
    return () => controller.abort();
  }, [endpoint, started, reload]);

  function change(update: Partial<QuoteIntakeConfig>) {
    setDraft((current) => current && { ...current, ...update });
    setMessage(undefined);
  }
  async function run(action: "search" | "publish", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!draft || !published || active.current) return;
    const config = quoteIntakeConfig.safeParse(draft);
    if (action === "publish" && !config.success) {
      setMessage({ text: config.error.issues[0].message, error: true });
      return;
    }
    active.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const data = action === "search" ? { type: "read", search } : { type: "publish", revision: published.revision, config: draft };
      const result = await settingsRequest(endpoint, data);
      if (action === "search") {
        const selected = campaigns.find(({ id }) => id === draft.campaignId);
        setCampaigns(selected && !result.campaigns.some(({ id }) => id === selected.id) ? [selected, ...result.campaigns] : result.campaigns);
      } else {
        setPublished(result);
        setDraft(result.config);
        setCampaigns(result.campaigns);
        setSearch("");
        setMessage({ text: `Quote form version ${result.revision} published. The current public link opens this version.` });
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not save the quote form.", error: true });
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(published?.config);
  return <details className="loan-task-create" onToggle={(event) => {
    if (event.currentTarget.open) setStarted(true);
  }}>
    <summary>Configure borrower quote form</summary>
    {started && <section className="record-form" aria-label="Quote intake settings">
      {message && <p className="application-message" role={message.error ? "alert" : "status"}>{message.text}</p>}
      {!draft && !message && <p role="status">Opening quote form settings…</p>}
      {draft && published && <>
        <p className="muted">Published version {published.revision}. The public link uses published settings.</p>
        <form className="record-form" onSubmit={(event) => void run("publish", event)}>
          <div className="form-grid">
            <label className="field">Form title<input value={draft.title} required minLength={4} maxLength={90}
              onChange={(event) => change({ title: event.target.value })} disabled={busy} /></label>
            <label className="field">Form theme<select value={draft.theme} onChange={(event) => change({ theme: event.target.value as QuoteIntakeConfig["theme"] })} disabled={busy}>
              {quoteThemes.map((theme) => <option key={theme}>{theme}</option>)}
            </select></label>
          </div>
          <label className="field">Introduction<textarea rows={2} maxLength={240} value={draft.introduction}
            onChange={(event) => change({ introduction: event.target.value })} disabled={busy} /></label>
          <div className="form-grid">
            <label className="field">Contact requirement<select value={draft.contact} onChange={(event) => change({ contact: event.target.value as QuoteIntakeConfig["contact"] })} disabled={busy}>
              {quoteContactOptions.map((mode) => <option key={mode}>{mode}</option>)}
            </select></label>
            <label className="field">Property ZIP field<select value={draft.zip} onChange={(event) => change({ zip: event.target.value as QuoteIntakeConfig["zip"] })} disabled={busy}>
              {quoteFieldModes.map((mode) => <option key={mode}>{mode}</option>)}
            </select></label>
            <label className="field">Timeline field<select value={draft.timing} onChange={(event) => change({ timing: event.target.value as QuoteIntakeConfig["timing"] })} disabled={busy}>
              {quoteFieldModes.map((mode) => <option key={mode}>{mode}</option>)}
            </select></label>
            <label className="field">Additional short question<input maxLength={120} value={draft.question?.prompt ?? ""}
              placeholder="Optional, e.g. What would you like us to know?"
              onChange={(event) => change({ question: event.target.value ? { prompt: event.target.value, required: draft.question?.required ?? false } : null })} disabled={busy} /></label>
          </div>
          <label className="demo-confirm"><input type="checkbox" checked={draft.question?.required ?? false} disabled={busy || !draft.question}
            onChange={(event) => draft.question && change({ question: { ...draft.question, required: event.target.checked } })} />
            <span>Require an answer to the additional question.</span></label>
          <div className="form-grid">
            <label className="field">Call campaign for eligible requests<select value={draft.campaignId ?? ""}
              onChange={(event) => change({ campaignId: event.target.value || null })} disabled={busy}>
              <option value="">Use website inbox routing</option>
              {campaigns.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              {draft.campaignId && !campaigns.some(({ id }) => id === draft.campaignId) && <option value={draft.campaignId}>Unavailable campaign</option>}
            </select></label>
            <label className="field">Search campaigns<input value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void run("search"); } }} disabled={busy} /></label>
          </div>
          <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void run("search")}>Find campaigns</Button></div>
          <p className="muted">Eligible phone leads use the campaign’s routing rules. Email-only and opted-out requests use website inbox routing.</p>
          <div className="loan-application-actions">
            <Button size="sm" type="submit" disabled={busy || !dirty}>Publish quote form</Button>
            <Button size="sm" variant="outline" aria-expanded={preview} onClick={() => setPreview((value) => !value)}>{preview ? "Hide borrower preview" : "Preview borrower form"}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setMessage(undefined); setPublished(undefined); setDraft(undefined); setReload((value) => value + 1); }}>
              Reload published form
            </Button>
          </div>
        </form>
        {preview && <section className="record-form document-item quote-intake" data-theme={draft.theme} aria-label="Borrower quote form preview">
          <p className="muted">Borrower preview · Draft settings</p>
          <QuoteIntakeHeading config={draft} preview />
          <QuoteIntakeFields config={draft} preview />
        </section>}
      </>}
      {!draft && message && <div><Button size="sm" variant="outline" onClick={() => { setMessage(undefined); setReload((value) => value + 1); }}>Retry settings</Button></div>}
    </section>}
  </details>;
}

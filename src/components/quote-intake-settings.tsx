"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { quoteConsentLimit, quoteConsentWording, quoteContactOptions, quoteFieldModes, quoteIntakeConfig, quoteProfiles, quoteRequestPath, quoteThemes,
  type QuoteIntakeConfig, type QuoteIntakeSettings, type QuoteProfile, type QuoteRoutingPreview } from "@/lib/quote-intake-model";
import type { BrokerageMember } from "@/lib/brokerage-model";
import { quotePrefillFields, quotePrefillLabels } from "@/lib/quote-intake-questions";
import { dateTime } from "@/lib/utils";
import { QuoteIntakeFields, QuoteIntakeHeading } from "./quote-request";
import { QuoteBranchRouting } from "./quote-branch-routing";
import { QuoteQuestionEditor } from "./quote-question-editor";
import { Button } from "./ui/button";

async function settingsRequest<Result extends object = QuoteIntakeSettings>(endpoint: string, data: object, signal?: AbortSignal) {
  const response = await fetch(endpoint, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Could not load quote form settings.");
  const value = await response.json() as Result | { error: string };
  if ("error" in value || !response.ok) throw new Error("error" in value ? value.error : "Could not load quote form settings.");
  return value;
}

export function QuoteIntakeEditor({ brokerageId, members, quoteToken }: {
  brokerageId: string; members: BrokerageMember[]; quoteToken: string | null;
}) {
  const [started, setStarted] = useState(false);
  const [profile, setProfile] = useState<QuoteProfile>("General");
  const [published, setPublished] = useState<QuoteIntakeSettings>();
  const [draft, setDraft] = useState<QuoteIntakeConfig>();
  const [campaigns, setCampaigns] = useState<QuoteIntakeSettings["campaigns"]>([]);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const active = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const endpoint = `/api/quote-intake-settings?brokerage=${encodeURIComponent(brokerageId)}`;
  useEffect(() => {
    if (!started) return;
    const controller = new AbortController();
    void settingsRequest(endpoint, { type: "read", profile }, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setPublished(value);
      setDraft(value.config);
      setCampaigns(value.campaigns);
      setMessage(undefined);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setMessage({ text: error instanceof Error ? error.message : "Could not load settings.", error: true });
    });
    return () => controller.abort();
  }, [endpoint, started, reload, profile]);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);

  function change(update: Partial<QuoteIntakeConfig>) {
    setDraft((current) => current && { ...current, ...update });
    setMessage(undefined);
  }
  async function run(action: "search" | "publish" | "retire", event?: FormEvent<HTMLFormElement>) {
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
      const data = action === "search" ? { type: "read", profile, search } :
        { type: action, profile, revision: published.revision, ...(action === "publish" ? { config: draft } : {}) };
      const result = await settingsRequest(endpoint, data);
      if (action === "search") {
        const selected = campaigns.find(({ id }) => id === draft.campaignId);
        setCampaigns(selected && !result.campaigns.some(({ id }) => id === selected.id) ? [selected, ...result.campaigns] : result.campaigns);
      } else {
        setPublished(result);
        setDraft(result.config);
        setCampaigns(result.campaigns);
        setSearch("");
        const label = profile === "General" ? "Quote form" : `${profile} profile`;
        setMessage({ text: action === "retire" ? `${label} now uses General version ${result.effectiveRevision}.` :
          `${label} version ${result.revision} published. Existing links use the published settings.` });
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not save the quote form.", error: true });
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(published?.config);
  const path = quoteToken ? quoteRequestPath(quoteToken, profile === "General" ? undefined : profile) : "";
  const profileOwners = members.filter(({ status, role }) => status === "Active" && role !== "Processor");
  function chooseProfile(next: QuoteProfile) {
    setDraft(undefined);
    setPublished(undefined);
    setSearch("");
    setPreview(false);
    setMessage(undefined);
    setProfile(next);
  }
  return <details className="loan-task-create" onToggle={(event) => {
    if (event.currentTarget.open) setStarted(true);
  }}>
    <summary>Configure borrower quote form</summary>
    {started && <section className="record-form" aria-label="Quote intake settings">
      <div className="loan-application-actions" role="group" aria-label="Intake profiles">
        {quoteProfiles.map((item) => <Button size="sm" key={item} variant={profile === item ? "default" : "outline"}
          aria-pressed={profile === item} disabled={busy || dirty} onClick={() => { if (item !== profile) chooseProfile(item); }}>{item}</Button>)}
      </div>
      {dirty && <p className="muted">Publish or reload your edits before switching profiles.</p>}
      {!draft && message && <p ref={feedback} tabIndex={-1} className="application-message banner-error" role="alert">{message.text}</p>}
      {!draft && !message && <p role="status">Opening quote form settings…</p>}
      {draft && published && <>
        <p className="muted">{published.active ? `Published version ${published.revision}. The public link uses published settings.` :
          `${profile} uses General version ${published.effectiveRevision} until you publish a separate profile.`}</p>
        {path && profile !== "General" && <div className="loan-application-actions">
          <Button size="sm" variant="outline" asChild><a href={path} target="_blank" rel="noopener noreferrer">Open public {profile.toLowerCase()} form</a></Button>
          <Button size="sm" variant="outline" onClick={async () => {
            try {
              await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
              setMessage({ text: `${profile} form link copied.` });
            } catch { setMessage({ text: "Open the form and copy its address from the browser.", error: true }); }
          }}>Copy {profile.toLowerCase()} link</Button>
        </div>}
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
          <QuoteQuestionEditor questions={draft.questions} change={(questions) => change({ questions })} busy={busy} />
          <fieldset className="record-form intake-correction" disabled={busy}>
            <legend>Corrections when creating the 1003</legend>
            <p className="muted">Allow staff to correct these fields before creating a draft. Orbit keeps the submitted answers and the reason for each correction.</p>
            <div className="intake-correction-options">
              {quotePrefillFields.map((field) => <label className="demo-confirm" key={field}>
                <input type="checkbox" checked={draft.overrideFields?.includes(field) ?? false}
                  onChange={(event) => change({ overrideFields: quotePrefillFields.filter((item) =>
                    item === field ? event.target.checked : draft.overrideFields?.includes(item)) })} />
                <span>{quotePrefillLabels[field]}</span>
              </label>)}
            </div>
          </fieldset>
          <label className="field">Consent wording
            <textarea rows={4} required maxLength={quoteConsentLimit} value={quoteConsentWording(draft)}
              onChange={(event) => change({ consentText: event.target.value })} disabled={busy} />
            <span className="muted quote-consent-hint">Applicants see this beside the permission checkbox. Orbit saves the accepted wording with each request.</span>
          </label>
          <div className="form-grid">
            <label className="field">Call campaign for eligible requests<select value={draft.campaignId ?? ""}
              onChange={(event) => change({ campaignId: event.target.value || null })} disabled={busy}>
              <option value="">Skip campaign enrollment</option>
              {campaigns.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              {draft.campaignId && !campaigns.some(({ id }) => id === draft.campaignId) && <option value={draft.campaignId}>Unavailable campaign</option>}
            </select></label>
            <label className="field">Direct routing or campaign fallback<select
              value={draft.ownerEmail === null ? "shared" : draft.ownerEmail ?? ""}
              onChange={(event) => change({ ownerEmail: event.target.value === "shared" ? null : event.target.value || undefined })} disabled={busy}>
              <option value="">Use website routing default</option><option value="shared">Shared inbox</option>
              {profileOwners.map(({ name, email }) => <option key={email} value={email}>{name} · {email}</option>)}
              {draft.ownerEmail && !profileOwners.some(({ email }) => email === draft.ownerEmail) &&
                <option value={draft.ownerEmail}>Unavailable owner</option>}
            </select></label>
            <label className="field">Search campaigns<input value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void run("search"); } }} disabled={busy} /></label>
          </div>
          <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void run("search")}>Find campaigns</Button></div>
          <p className="muted">Eligible phone leads follow the selected campaign’s routing rules. Branch defaults apply to other requests before direct routing.</p>
          <QuoteBranchRouting key={profile} draft={draft} officers={profileOwners} managedBranches={published.managedBranches} change={change} busy={busy} preview={async (zip, hasPhone) => {
            const result = await settingsRequest<QuoteRoutingPreview>(endpoint, {
              type: "previewRoute", profile, revision: published.revision, config: draft, zip, hasPhone,
            });
            return result.routingPreview;
          }} />
          <div className="loan-application-actions">
            <Button size="sm" type="submit" disabled={busy || (!dirty && published.active)}>{profile === "General" ? "Publish quote form" : `Publish ${profile.toLowerCase()} profile`}</Button>
            <Button size="sm" variant="outline" aria-expanded={preview} onClick={() => setPreview((value) => !value)}>{preview ? "Hide borrower preview" : "Preview borrower form"}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setMessage(undefined); setPublished(undefined); setDraft(undefined); setReload((value) => value + 1); }}>
              Reload published form
            </Button>
            {profile !== "General" && published.active && <Button size="sm" variant="outline" disabled={busy || dirty}
              onClick={() => void run("retire")}>Use General form again</Button>}
          </div>
          {message && <p ref={feedback} tabIndex={-1} className={`application-message${message.error ? " banner-error" : ""}`}
            role={message.error ? "alert" : "status"}>{message.text}</p>}
        </form>
        {preview && <section className="record-form document-item quote-intake" data-theme={draft.theme} aria-label="Borrower quote form preview">
          <p className="muted">Borrower preview · Draft settings</p>
          <QuoteIntakeHeading config={draft} preview />
          <QuoteIntakeFields config={draft} preview purpose={profile === "Refinance" ? profile : "Purchase"} />
        </section>}
        {!!published.history.length && <details className="document-form">
          <summary>Profile publication history</summary>
          <ul className="document-list">{published.history.map(({ revision, publishedAt, active, consentText }) => <li key={revision}>
            Version {revision} · {active ? "Published" : "Returned to General"} · {dateTime(publishedAt)} ET
            {active && <p className="quote-consent-copy">{consentText}</p>}
          </li>)}</ul>
        </details>}
      </>}
      {!draft && message && <div><Button size="sm" variant="outline" onClick={() => { setMessage(undefined); setReload((value) => value + 1); }}>Retry settings</Button></div>}
    </section>}
  </details>;
}

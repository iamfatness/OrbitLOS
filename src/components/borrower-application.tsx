"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Save } from "lucide-react";
import { applicationIssues, applicationSteps, sampleApplication, type BorrowerApplication, type BorrowerStatusRefresh } from "@/lib/application-model";
import type { DocumentRequest } from "@/lib/document-model";
import { portalTokenPattern } from "@/lib/brokerage-model";
import { announceBorrowerChange, observeBorrowerChange } from "@/lib/borrower-change-signal";
import { observeHandoffChecks } from "@/lib/tab-return";
import { primaryJointDraft } from "@/lib/joint-application-model";
import type { BorrowerPortalPreferences } from "@/lib/borrower-channel-model";
import type { BorrowerDisclosureResponse } from "@/lib/disclosure-model";
import type { BorrowerQuestionResponse } from "@/lib/borrower-question-model";
import { borrowerActions, borrowerCorrectionTarget } from "@/lib/borrower-action-model";
import { borrowerWeekendHours, sameBorrowerHours, type BorrowerHours } from "@/lib/borrower-hours";
import { ApplicationAnswers, ApplicationFields } from "./application-fields";
import type { UpdateDraft } from "./application-address";
import { Button } from "./ui/button";
import { BorrowerStatus } from "./borrower-status";
import { BorrowerActionCenter } from "./borrower-action-center";
import { BorrowerChannelOptions } from "./borrower-channel-preferences";
import { OrbitRings, PortalHeader } from "./orbit-brand";

type SubmittedView = Exclude<BorrowerStatusRefresh, { kind: "resume" }>;
type ApplicationView = BorrowerApplication | SubmittedView;
type BorrowerAction = { type: "save" | "submit"; step: number; revision: number; draft: BorrowerApplication["draft"] }
  | { type: "status" }
  | BorrowerDisclosureResponse
  | BorrowerQuestionResponse
  | { type: "attachSample"; requestId: string; revision: number; statusOnly: true };

function applicationView(application: BorrowerApplication): ApplicationView {
  const { submittedAt, loanStatus, documentUploadsMode } = application;
  if (submittedAt && loanStatus) return { kind: "status", submittedAt, loanStatus, documentUploadsMode };
  if (submittedAt && application.separateJoint) return { kind: "joint-waiting", submittedAt, documentUploadsMode };
  return application;
}

function sampleAnswers(application: BorrowerApplication) {
  const sample = sampleApplication(application.draft);
  if (!application.separateJoint) return sample;
  const joint = primaryJointDraft(sample);
  joint.urla.primary.joint.fields.initials = joint.borrowerName.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 16);
  return joint;
}

async function requestApplication<Result = BorrowerApplication>(token: string, input: object, signal: AbortSignal) {
  if (!portalTokenPattern.test(token)) throw new Error("Open the complete application link from your loan officer.");
  const response = await fetch("/api/demo-application", {
    method: "POST", credentials: "omit", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, token }),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = result && typeof result === "object" && "error" in result ? result.error : null;
    throw new Error(typeof error === "string" ? error : "Orbit could not save the application. Try again.");
  }
  return result as Result;
}

function PortalContactPreferences({ token }: { token: string }) {
  const [saved, setSaved] = useState<BorrowerPortalPreferences>();
  const [draft, setDraft] = useState(0);
  const [hours, setHours] = useState<BorrowerHours | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const savedHours = saved?.hours ?? null;
  const changed = !!saved && (draft !== saved.blocked || !sameBorrowerHours(hours, savedHours));
  const weekend = hours && borrowerWeekendHours(hours);
  const invalidHours = hours && weekend && [hours, weekend].some(({ start, end }) => !start || !end || start >= end);

  async function update(save: boolean) {
    if (pending.current || (save && (!saved || saved.optedOut || !changed || invalidHours))) return;
    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const input = save && saved ? { type: "saveContactPreferences", expected: saved.blocked, blocked: draft,
        hours: { expected: savedHours, value: hours } } : { type: "contactPreferences" };
      const preferences = await requestApplication<BorrowerPortalPreferences>(token, input, signal);
      if (signal.aborted) return;
      setSaved(preferences);
      setDraft(preferences.blocked);
      setHours(preferences.hours ?? null);
      if (save) {
        setNotice("Contact preferences saved.");
        void announceBorrowerChange(token);
      }
    } catch (failure) {
      if (!signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load or save contact preferences. Try again.");
    } finally {
      pending.current = null;
      if (!signal.aborted) setBusy(false);
    }
  }

  return <details className="application-panel application-receipt document-form borrower-preferences-panel" onToggle={(event) => {
    if (event.currentTarget.open && !saved && !error) void update(false);
  }}>
    <summary>Contact preferences</summary>
    <form className="record-form" onSubmit={(event) => { event.preventDefault(); void update(true); }}>
      <p>Choose how your loan team can reach you for follow-up. Email and text are simulated in this demo.</p>
      {busy && !saved && <p role="status">Loading contact preferences…</p>}
      {error && <p role="alert" className="banner-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {saved && <>
        {saved.optedOut && <p>An outreach opt-out is active. Ask your loan team if you need to change it.</p>}
        <BorrowerChannelOptions blocked={draft} optedOut={saved.optedOut} busy={busy} onChange={setDraft} />
        <fieldset className="borrower-hours-options" disabled={busy || saved.optedOut}>
          <legend>Preferred contact hours</legend>
          <label className="demo-confirm"><input type="checkbox" checked={!!hours} onChange={(event) => setHours(event.target.checked ?
            (savedHours ?? { start: "09:00", end: "17:00", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }) : null)} />
            Set preferred contact hours</label>
          {hours && weekend && <>
            <label className="field">Time zone<select value={hours.timeZone} onChange={(event) => setHours({ ...hours, timeZone: event.target.value })}>
              {[...new Set(["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "UTC",
                hours.timeZone, ...Intl.supportedValuesOf("timeZone")])].map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
            </select></label>
            <div className="form-grid">
              <label className="field">Weekday start time<input type="time" value={hours.start} required onChange={(event) => setHours({ ...hours, weekend, start: event.target.value })} /></label>
              <label className="field">Weekday end time<input type="time" value={hours.end} required onChange={(event) => setHours({ ...hours, weekend, end: event.target.value })} /></label>
              <label className="field">Weekend start time<input type="time" value={weekend.start} required onChange={(event) => setHours({ ...hours, weekend: { ...weekend, start: event.target.value } })} /></label>
              <label className="field">Weekend end time<input type="time" value={weekend.end} required onChange={(event) => setHours({ ...hours, weekend: { ...weekend, end: event.target.value } })} /></label>
            </div>
          </>}
          <p className="muted">{invalidHours ? "Each end time must be later than its start time." :
            "Weekday hours apply Monday through Friday. Weekend hours apply Saturday and Sunday. Sequences use your selected time zone."}</p>
        </fieldset>
      </>}
      <div className="loan-application-actions">
        {saved && !saved.optedOut && <Button size="sm" type="submit" disabled={busy || !changed || !!invalidHours}>Save contact preferences</Button>}
        {error && <Button size="sm" variant="outline" onClick={() => void update(false)} disabled={busy}>Refresh preferences</Button>}
      </div>
    </form>
  </details>;
}

export function BorrowerApplicationForm() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    function syncLink() { setToken(window.location.hash.slice(1)); }
    syncLink();
    window.addEventListener("hashchange", syncLink);
    return () => window.removeEventListener("hashchange", syncLink);
  }, []);
  return <BorrowerApplication key={token} token={token} />;
}

function BorrowerApplication({ token }: { token: string | null }) {
  const [view, setView] = useState<ApplicationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  const statusRead = useRef<AbortController | null>(null);
  const queuedStatusRead = useRef<(() => void) | null>(null);
  const application = view && !("kind" in view) ? view : null;
  const submitted = !!view && "kind" in view;
  const jointWaiting = submitted && view.kind === "joint-waiting";
  const mockHandoff = view?.documentUploadsMode === "mock";

  useEffect(() => {
    if (token === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    const isCurrent = () => !signal.aborted && window.location.hash.slice(1) === token;
    requestApplication(token, { type: "read" }, signal).then((next) => {
      if (isCurrent()) setView(applicationView(next));
    }).catch((failure: unknown) => {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : "Could not open the application.");
    });
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, [token]);

  useEffect(() => {
    if (!token || !submitted) return;
    let active = true;
    async function refreshStatus(isCurrent: () => boolean, periodic = false) {
      const canRefresh = () => active && isCurrent() && window.location.hash.slice(1) === token;
      if (!token || !canRefresh() || (periodic && (pending.current || statusRead.current))) return;
      if (pending.current) {
        queuedStatusRead.current = () => void refreshStatus(isCurrent);
        return;
      }
      statusRead.current?.abort();
      const controller = new AbortController();
      statusRead.current = controller;
      try {
        const status = await requestApplication<BorrowerStatusRefresh>(token, { type: "status" }, controller.signal);
        if (controller.signal.aborted || !canRefresh()) return;
        const next = status.kind === "resume" ? applicationView(await requestApplication(token, { type: "read" }, controller.signal)) : status;
        if (!controller.signal.aborted && canRefresh()) setView((current) => current && "kind" in current ? next : current);
      } catch {
        // Keep the current checklist usable if a background read fails.
      } finally {
        if (statusRead.current === controller) statusRead.current = null;
      }
    }
    const stopChanges = observeBorrowerChange(token, "checklist-changed", () => void refreshStatus(() => active));
    const stopDisclosures = observeBorrowerChange(token, "disclosure-changed", () => void refreshStatus(() => active));
    const stopChecks = observeHandoffChecks(document, window, refreshStatus, mockHandoff);
    return () => {
      active = false;
      statusRead.current?.abort();
      queuedStatusRead.current = null;
      stopChanges();
      stopDisclosures();
      stopChecks();
    };
  }, [mockHandoff, submitted, token]);

  async function perform(input: BorrowerAction, onSuccess: (next: ApplicationView) => void) {
    if (!token || pending.current) return;
    statusRead.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const { signal } = controller;
    const isCurrent = () => !signal.aborted && window.location.hash.slice(1) === token;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let next: ApplicationView;
      if (input.type === "status" || input.type === "attachSample" || input.type === "respondToSampleDisclosure" || input.type === "answerBorrowerQuestion") {
        const status = await requestApplication<BorrowerStatusRefresh>(token, input, signal);
        if (!isCurrent()) return;
        if (status.kind === "resume") {
          const draft = await requestApplication(token, { type: "read" }, signal);
          if (isCurrent()) setView(applicationView(draft));
          return;
        }
        next = status;
      } else {
        next = applicationView(await requestApplication(token, input, signal));
      }
      if (!isCurrent()) return;
      setView(next);
      if (input.type === "submit" || input.type === "attachSample" || input.type === "respondToSampleDisclosure" ||
        input.type === "answerBorrowerQuestion") void announceBorrowerChange(token);
      onSuccess(next);
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : "Could not save the application. Try again.");
    } finally {
      pending.current = null;
      if (!signal.aborted) setBusy(false);
      const refresh = queuedStatusRead.current;
      queuedStatusRead.current = null;
      if (!signal.aborted) refresh?.();
    }
  }

  function save(type: "save" | "submit", step: number, advance = false) {
    if (!application) return;
    void perform({ type, step, revision: application.revision, draft: application.draft }, (next) => {
      if (advance || next.submittedAt) window.scrollTo(0, 0);
      else setNotice("Draft saved. Reopen this same link to resume.");
    });
  }

  function attach(request: DocumentRequest) {
    void perform({ type: "attachSample", requestId: request.id, revision: request.revision, statusOnly: true }, () => {
      setNotice(`Sample attached for ${request.kind.toLowerCase()}.`);
    });
  }

  const step = application?.step ?? 0;
  const reviewing = step === applicationSteps.length - 1;
  const update: UpdateDraft = (changes) => {
    if (pending.current) return;
    setView((current) => current && !("kind" in current) ? { ...current, draft: { ...current.draft, ...changes(current.draft) } } : current);
    setNotice("");
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewing) {
      void save("save", step + 1, true);
      return;
    }
    if (!application) return;
    const missing = applicationIssues(application.draft, application.separateJoint);
    if (missing.length) {
      setError(`Complete these items before submitting: ${missing.join("; ")}.`);
      return;
    }
    void save("submit", step);
  }

  return <><PortalHeader label="Demo only" /><main className="application-shell borrower-portal">
    <div className="application-intro">
      <OrbitRings />
      <h1>{jointWaiting ? "Your portion is submitted" : view?.submittedAt ? "Your loan status" : "Mortgage application"}</h1>
      {!view?.submittedAt && <p>Save your progress and return with this link.</p>}
    </div>
    {!jointWaiting && <aside className="application-warning">{view?.submittedAt ? (view.documentUploadsMode === "mock" ? "Use sample files. Verification and scanning are simulated." : view.documentUploadsMode === "live" ? "Use fictional PDFs when testing uploads." : "Use the built-in sample documents.") : "Fictional information only. Use a test tax ID such as 000-00-1234. Leave real tax IDs, account numbers, and documents out of the demo."}</aside>}
    {application?.correctionNote && <BorrowerActionCenter actions={borrowerActions({ correction: application.correctionNote })}
      correction={application.correctionNote} />}
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {notice && <p className="application-message" role="status">{notice}</p>}
    {!view && !error && <p role="status" className="application-message">Opening your application…</p>}
    {view && token && <PortalContactPreferences token={token} />}
    {jointWaiting ? <section className="pipeline relationship-panel" aria-label="Joint application progress">
      <h2>Waiting for the co-borrower</h2>
      <p>Your loan officer can review the joint application after both portions are submitted. Return with this link to check progress.</p>
      <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void perform({ type: "status" }, () => setNotice("Joint application progress refreshed."))}>Refresh joint status</Button></div>
    </section> : view?.submittedAt && "loanStatus" in view ? token && view.loanStatus && <BorrowerStatus token={token} status={view.loanStatus} submittedAt={view.submittedAt}
      busy={busy} attach={attach} uploadsMode={view.documentUploadsMode} refresh={() => void perform({ type: "status" }, () => setNotice("Loan status refreshed."))}
      answerQuestion={(input) => void perform(input, () => setNotice("Your answer was sent to the loan team."))}
      respondToDisclosure={(input) => void perform(input, () => setNotice("Your sample disclosure response was recorded."))} />
      : application && <section className="application-panel application-editor" aria-label="1003 application"
        id={borrowerCorrectionTarget} tabIndex={-1} data-borrower-action-target>
      <div className="application-steps">
        <p className="eyebrow">Application sections</p>
        <ol className="application-progress" aria-label="Application sections" role="list">
          {applicationSteps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}>
            <button type="button" disabled={busy} onClick={() => { if (index !== step) save("save", index, true); }}>
              <span aria-hidden="true">{index + 1}</span>{label}
            </button>
          </li>)}
        </ol>
      </div>
      <label className="application-section-picker field">
        <span>Application section · {step + 1} of {applicationSteps.length}</span>
        <select value={step} disabled={busy} onChange={(event) => save("save", Number(event.target.value), true)}>
          {applicationSteps.map((label, index) => <option key={label} value={index}>{index + 1}. {label}</option>)}
        </select>
      </label>
      <form className="application-form" onSubmit={submit} noValidate>
        <fieldset disabled={busy} className="application-step">
          <div className="application-step-meta"><small>Step {step + 1} of {applicationSteps.length}</small>
            {step === 0 && <Button variant="outline" size="sm" onClick={() => {
              setView({ ...application, draft: sampleAnswers(application) });
              setNotice("Sample answers loaded. Save or continue to keep them.");
              setError("");
            }}>Load sample answers</Button>}
            {step === 0 && !application.correctionNote && <Button variant="outline" size="sm" onClick={() => {
              setView({ ...application, step: applicationSteps.length - 1, draft: sampleAnswers(application) });
              setNotice("Sample answers loaded. Confirm the fictional information to submit.");
              setError("");
              window.scrollTo(0, 0);
            }}>Load sample and review</Button>}
          </div>
          {reviewing ? <>
            <h2>Review your application</h2>
            <ApplicationAnswers draft={application.draft} />
            <label className="demo-confirm"><input type="checkbox" checked={application.draft.confirmedDemo}
              onChange={(event) => { const confirmedDemo = event.target.checked; update(() => ({ confirmedDemo })); }} /> I’m submitting fictional information for the Orbit demo.</label>
          </> : <ApplicationFields step={step} draft={application.draft} update={update} lookupEnabled={application.addressLookupEnabled} separateJoint={application.separateJoint} />}
        </fieldset>
        <div className="application-actions">
          {step > 0 && <Button variant="ghost" disabled={busy} onClick={() => {
            setView({ ...application, step: step - 1 });
            setError("");
            window.scrollTo(0, 0);
          }}><ArrowLeft /> Back</Button>}
          <div className="spacer" />
          <Button variant="outline" disabled={busy} onClick={() => void save("save", step)}><Save /> Save draft</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : reviewing ? <>{application.separateJoint ? "Submit my portion" : "Submit demo application"} <Check /></> : <>Continue <ArrowRight /></>}</Button>
        </div>
      </form>
      <p className="application-attribution">ZIP suggestions use <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a> data.</p>
    </section>}
  </main></>;
}

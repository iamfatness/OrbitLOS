"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Orbit as OrbitIcon, Save } from "lucide-react";
import { applicationIssues, applicationSteps, sampleApplication, type BorrowerApplication } from "@/lib/application-model";
import type { DocumentRequest } from "@/lib/document-model";
import { portalTokenPattern } from "@/lib/brokerage-model";
import { ApplicationAnswers, ApplicationFields } from "./application-fields";
import type { UpdateDraft } from "./application-address";
import { Button } from "./ui/button";
import { BorrowerStatus } from "./borrower-status";

async function requestApplication(token: string, input: object, signal?: AbortSignal) {
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
  return result as BorrowerApplication;
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
  const [application, setApplication] = useState<BorrowerApplication | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);

  useEffect(() => {
    if (token === null) return;
    const controller = new AbortController();
    requestApplication(token, { type: "read" }, controller.signal).then((next) => {
      if (!controller.signal.aborted) setApplication(next);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not open the application.");
    });
    return () => controller.abort();
  }, [token]);

  async function perform(input: object, onSuccess: (next: BorrowerApplication) => void) {
    if (!token || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await requestApplication(token, input);
      if (window.location.hash.slice(1) !== token) return;
      setApplication(next);
      onSuccess(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save the application. Try again.");
    } finally {
      pending.current = false;
      setBusy(false);
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
    void perform({ type: "attachSample", requestId: request.id, revision: request.revision }, () => {
      setNotice(`Sample attached for ${request.kind.toLowerCase()}.`);
    });
  }

  const step = application?.step ?? 0;
  const reviewing = step === applicationSteps.length - 1;
  const update: UpdateDraft = (changes) => {
    if (pending.current) return;
    setApplication((current) => current && ({ ...current, draft: { ...current.draft, ...changes(current.draft) } }));
    setNotice("");
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewing) {
      void save("save", step + 1, true);
      return;
    }
    if (!application) return;
    const missing = applicationIssues(application.draft);
    if (missing.length) {
      setError(`Complete these items before submitting: ${missing.join("; ")}.`);
      return;
    }
    void save("submit", step);
  }

  return <main className="application-shell">
    <header className="application-top"><div className="brand"><span className="brand-icon"><OrbitIcon size={22} aria-hidden="true" /></span><span>OrbitLOS</span></div><span className="pill">Demo only</span></header>
    <div className="application-intro">
      <p className="eyebrow">BORROWER WORKSPACE</p>
      <h1>{application?.submittedAt ? "Your loan status" : "Mortgage application"}</h1>
      <p>{application?.submittedAt ? "See where your loan stands and what your loan team needs from you." : "Walk through a sample 1003 and send it to your loan officer for review."}</p>
    </div>
    <aside className="application-warning">{application?.submittedAt ? (application.documentUploadsMode === "mock" ? "Demo verification and scanning use built-in fictional files." : application.documentUploadsEnabled ? "Use fictional PDFs when testing the document checklist." : "This checklist uses built-in fictional sample documents.") : "Use fictional information. Enter only a test tax ID in the format 000-00-1234. Keep real Social Security numbers, account numbers, and documents out of the demo."}</aside>
    {application?.correctionNote && <aside className="application-warning"><strong>Corrections requested</strong><p>{application.correctionNote}</p>
      <p>Your previous answers are filled in. Make the requested changes, then submit the 1003 again to return to your loan status and checklist.</p></aside>}
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {notice && <p className="application-message" role="status">{notice}</p>}
    {!application && !error && <p role="status" className="application-message">Opening your application…</p>}
    {application?.submittedAt ? token && application.loanStatus && <BorrowerStatus token={token} status={application.loanStatus} submittedAt={application.submittedAt}
      busy={busy} attach={attach} uploadsMode={application.documentUploadsMode} refresh={() => void perform({ type: "read" }, () => setNotice("Loan status refreshed."))} />
      : application && <section className="application-panel">
      <ol className="application-progress" aria-label="Application progress">
        {applicationSteps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} data-complete={index < step}>
          <button type="button" disabled={busy} onClick={() => { if (index !== step) void save("save", index, true); }}>
            <span>{index + 1}</span>{label}
          </button>
        </li>)}
      </ol>
      <form className="application-form" onSubmit={submit} noValidate>
        <fieldset disabled={busy} className="application-step">
          <div className="application-step-meta"><small>Step {step + 1} of {applicationSteps.length}</small>
            {step === 0 && <Button variant="outline" size="sm" onClick={() => {
              setApplication({ ...application, draft: sampleApplication(application.draft) });
              setNotice("Sample answers loaded. Save or continue to keep them.");
              setError("");
            }}>Load sample answers</Button>}
            {step === 0 && !application.correctionNote && <Button variant="outline" size="sm" onClick={() => {
              setApplication({ ...application, step: applicationSteps.length - 1, draft: sampleApplication(application.draft) });
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
          </> : <ApplicationFields step={step} draft={application.draft} update={update} lookupEnabled={application.addressLookupEnabled} />}
        </fieldset>
        <div className="application-actions">
          {step > 0 && <Button variant="ghost" disabled={busy} onClick={() => {
            setApplication({ ...application, step: step - 1 });
            setError("");
            window.scrollTo(0, 0);
          }}><ArrowLeft /> Back</Button>}
          <div className="spacer" />
          <Button variant="outline" disabled={busy} onClick={() => void save("save", step)}><Save /> Save draft</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : reviewing ? "Submit demo application" : <>Continue <ArrowRight /></>}</Button>
        </div>
      </form>
      <p className="application-attribution">ZIP suggestions use <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a> data.</p>
    </section>}
  </main>;
}

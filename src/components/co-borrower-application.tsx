"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Save } from "lucide-react";
import { portalTokenPattern } from "@/lib/brokerage-model";
import { coBorrowerReviewStep, coBorrowerSections, coBorrowerSubmissionIssues, sampleCoBorrower, type CoBorrowerApplication } from "@/lib/joint-application-model";
import { observeVisibleChecks } from "@/lib/tab-return";
import { borrowerDefinition, jointQuestions, type BorrowerDetails } from "@/lib/urla";
import { OrbitRings, PortalHeader } from "./orbit-brand";
import { QuestionnaireAnswers, QuestionnaireFields, type ChangeAnswers } from "./urla-fields";
import { Button } from "./ui/button";

async function requestCoBorrower(token: string, input: object, signal: AbortSignal): Promise<CoBorrowerApplication> {
  if (!portalTokenPattern.test(token)) throw new Error("Open the complete co-borrower link from your loan officer.");
  const response = await fetch("/api/joint-application", { method: "POST", credentials: "omit", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, token }) });
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Orbit could not open your portion. Try again.");
  const result = await response.json() as CoBorrowerApplication | { error: string };
  if ("error" in result) throw new Error(result.error);
  if (!response.ok) throw new Error("Orbit could not open your portion. Try again.");
  return result;
}

export function CoBorrowerApplicationForm() {
  const [token, setToken] = useState<string>();
  useEffect(() => {
    function readLink() { setToken(window.location.hash.slice(1)); }
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  return <CoBorrowerForm key={token} token={token} />;
}

const labels = [...coBorrowerSections.map(([, label]) => label), "Review"];

function CoBorrowerForm({ token }: { token?: string }) {
  const [view, setView] = useState<CoBorrowerApplication>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const submitted = Boolean(view?.submittedAt);
  const awaitingOtherPortion = submitted && !view?.complete;

  useEffect(() => {
    if (token === undefined) return;
    const controller = new AbortController();
    void requestCoBorrower(token, { type: "read" }, controller.signal).then((next) => {
      if (!controller.signal.aborted) setView(next);
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [token]);

  useEffect(() => {
    if (!token || !submitted) return;
    const controller = new AbortController();
    const stop = observeVisibleChecks(document, window, async (isCurrent) => {
      if (pending.current || controller.signal.aborted) return;
      try {
        const next = await requestCoBorrower(token, { type: "read" }, controller.signal);
        if (isCurrent() && !controller.signal.aborted && !pending.current) {
          setView((current) => current?.submittedAt ? next : current);
        }
      } catch { /* A manual refresh shows any link error. */ }
    });
    return () => { stop(); controller.abort(); };
  }, [submitted, token]);

  async function perform(input: object, success: string, move = false) {
    if (!token || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await requestCoBorrower(token, input, controller.signal);
      if (!controller.signal.aborted && window.location.hash.slice(1) === token) {
        setView(next);
        setNotice(success);
        if (move) window.scrollTo(0, 0);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Orbit could not save your portion.");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function save(type: "save" | "submit", step: number, move = false) {
    if (!view || submitted) return;
    void perform({ type, step, revision: view.revision, draft: view.draft, confirmedDemo: view.confirmedDemo },
      type === "submit" ? "Your portion was submitted." : "Draft saved. Reopen this link to resume.", move);
  }
  function edit(section: keyof BorrowerDetails): ChangeAnswers {
    return (change) => {
      setView((current) => current && { ...current, draft: { ...current.draft, [section]: change(current.draft[section]) } });
      setNotice("");
    };
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view) return;
    if (view.step !== coBorrowerReviewStep) return save("save", view.step + 1, true);
    const issues = coBorrowerSubmissionIssues(view.draft, view.confirmedDemo);
    if (issues.length) { setError(`Complete these items before submitting: ${issues.join("; ")}.`); return; }
    save("submit", view.step, true);
  }

  const step = view?.step ?? 0;
  const reviewing = step === coBorrowerReviewStep;
  const section = coBorrowerSections[step]?.[0];
  return <><PortalHeader label="Fictional pilot" /><main className="application-shell borrower-portal">
    <div className="application-intro"><OrbitRings />
      <h1>{submitted ? "Your portion is submitted" : "Co-borrower application"}</h1>
      <p>{submitted ? "Return with this link to check the joint application’s progress." : "Enter your own information and return with this link to resume."}</p>
    </div>
    {!submitted && <aside className="application-warning">Use fictional answers and a sample tax ID such as 000-00-2345.</aside>}
    {view?.correctionNote && !submitted && <aside className="application-warning"><strong>Corrections requested for your portion</strong><p>{view.correctionNote}</p></aside>}
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {notice && <p className="application-message" role="status">{notice}</p>}
    {!view && !error && <p role="status">Opening your portion…</p>}
    {submitted ? <section className="pipeline relationship-panel" aria-label="Joint application progress">
      <h2>{awaitingOtherPortion ? "Waiting for the primary borrower" : "Joint application ready for review"}</h2>
      <p>{awaitingOtherPortion ? "Your loan officer receives the joint 1003 once both portions are submitted." : "Your loan officer can review both portions on the loan."}</p>
      <div><Button variant="outline" size="sm" disabled={busy} onClick={() => void perform({ type: "read" }, "Joint application progress refreshed.")}>Refresh joint status</Button></div>
    </section> : view && <section className="application-panel" aria-label="Co-borrower portion">
      <form className="application-form" onSubmit={submit} noValidate>
        <fieldset disabled={busy} className="application-step">
          <label className="field">Your application section · {step + 1} of {labels.length}
            <select value={step} onChange={(event) => save("save", Number(event.target.value), true)}>
              {labels.map((label, index) => <option key={label} value={index}>{index + 1}. {label}</option>)}
            </select>
          </label>
          {step === 0 && !view.correctionNote && <div><Button variant="outline" size="sm" onClick={() => {
            setView({ ...view, draft: sampleCoBorrower(view.draft), step: coBorrowerReviewStep, confirmedDemo: false });
            setNotice("Sample answers loaded. Confirm your portion to submit.");
            setError("");
            window.scrollTo(0, 0);
          }}>Load sample and review my portion</Button></div>}
          {reviewing ? <>
            <h2>Review your portion</h2>
            <QuestionnaireAnswers definition={jointQuestions} answers={view.draft.joint} />
            {coBorrowerSections.map(([key]) => <QuestionnaireAnswers key={key} definition={borrowerDefinition(key, false)} answers={view.draft[key]} />)}
            <label className="demo-confirm"><input type="checkbox" checked={view.confirmedDemo}
              onChange={(event) => setView({ ...view, confirmedDemo: event.target.checked })} /> I’m submitting fictional information for the Orbit demo.</label>
          </> : section && <>
            <QuestionnaireFields definition={borrowerDefinition(section, false)} answers={view.draft[section]} change={edit(section)} />
            {section === "identity" && <QuestionnaireFields definition={jointQuestions} answers={view.draft.joint} change={edit("joint")} />}
          </>}
        </fieldset>
        <div className="application-actions">
          {step > 0 && <Button variant="ghost" disabled={busy} onClick={() => save("save", step - 1, true)}><ArrowLeft /> Back</Button>}
          <div className="spacer" />
          <Button variant="outline" disabled={busy} onClick={() => save("save", step)}><Save /> Save draft</Button>
          <Button type="submit" disabled={busy}>{reviewing ? <>Submit my portion <Check /></> : <>Continue <ArrowRight /></>}</Button>
        </div>
      </form>
    </section>}
  </main></>;
}

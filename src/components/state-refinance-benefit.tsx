"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { nebraskaBenefitForm, refinanceBenefitAuthority, refinanceBenefitFacts, reviewRefinanceBenefit,
  type RefinanceBenefitFacts, type RefinanceBenefitState } from "@/lib/state-refinance-benefit-model";
import { Button } from "./ui/button";

type Result = Extract<ComplianceCaseResult, { kind: "stateRefinanceBenefit" }>;
type DatedEvidence = { on: string; reference: string };
const fields = {
  MN: [{ key: "applicationCircumstances", label: "Circumstances at application" }, { key: "signed", label: "Borrower signed the evidence" }],
  NE: [{ key: "delivered", label: "Worksheet provided to borrower" }, { key: "acknowledged", label: "Borrower acknowledged receipt" }],
} as const;
const closingField = { key: "closed", label: "Actual closing" } as const;
const stateNames = { MN: "Minnesota", NE: "Nebraska" };
type EventKey = typeof fields[RefinanceBenefitState][number]["key"] | "closed";
const dated = (facts: RefinanceBenefitFacts | undefined, key: EventKey) =>
  (facts as Partial<Record<EventKey, DatedEvidence>> | undefined)?.[key];

function EvidenceSummary({ facts }: { facts: RefinanceBenefitFacts }) {
  const gaps = reviewRefinanceBenefit(facts);
  return <div className="record-form">
    <p className="break-words">{facts.outcome} · {facts.scopeReference}</p>
    {facts.rationale && <p className="break-words">{facts.rationale}</p>}
    {facts.comparisonReference && <p className="break-words">Terms and costs · {facts.comparisonReference}</p>}
    {facts.state === "NE" && facts.worksheetVersion && <p className="break-words">Worksheet version · {facts.worksheetVersion}</p>}
    <dl>{[...fields[facts.state], closingField].map(({ key, label }) => {
      const event = dated(facts, key);
      return event && <div key={key}><dt>{label}</dt><dd className="break-words">{event.on} · {event.reference}</dd></div>;
    })}</dl>
    {gaps.length > 0 && <div><strong>Open evidence</strong><ul>{gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
  </div>;
}

export function StateRefinanceBenefit({ state, brokerageId, loanId, readOnly }: {
  state: RefinanceBenefitState; brokerageId: string; loanId: string; readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Result>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: true }>();
  const retry = useRef<{ body: string; id: string } | undefined>(undefined);
  const feedback = useRef<HTMLParagraphElement>(null);
  const latest = data?.history[0];
  const facts = latest?.facts;
  const authority = refinanceBenefitAuthority[state];
  const eventFields = [...fields[state], closingField];

  useEffect(() => {
    if (!open) return;
    let active = true;
    void accessComplianceCases({ type: "stateRefinanceBenefit", input: { operation: "read", state, loanId } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "stateRefinanceBenefit") throw new Error("Could not load refinance benefit evidence. Reload to try again.");
      setData(current => current && current.revision > result.revision ? current : result);
    }).catch(error => {
      if (active) setMessage({ text: error instanceof Error && !(error instanceof TypeError) ? error.message :
        "Could not load refinance benefit evidence. Reload to try again.", error: true });
    });
    return () => { active = false; };
  }, [brokerageId, loanId, open, refresh, state]);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || readOnly || busy) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    const dates = Object.fromEntries(eventFields.map(({ key }) => {
      const on = value(`${key}Date`);
      const reference = value(`${key}Reference`);
      return [key, on || reference ? { on, reference } : undefined];
    }));
    const parsed = refinanceBenefitFacts.safeParse({ state, ...dates,
      applicability: value("applicability"), scopeReference: value("scopeReference"), comparisonReference: value("comparisonReference"),
      outcome: value("outcome"), rationale: value("rationale"),
      ...(state === "NE" ? { zone: value("zone"), worksheetVersion: value("worksheetVersion") } : {}),
    });
    if (!parsed.success) {
      setMessage({ text: "Enter the scope reference and both a date and a reference for each event you record.", error: true });
      return;
    }
    const input = { operation: "save", loanId, expectedRevision: data.revision, facts: parsed.data, correction: value("correction") };
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await accessComplianceCases({ type: "stateRefinanceBenefit", input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "stateRefinanceBenefit") throw new Error("Save could not be confirmed. Retry the same evidence.");
      setData(result);
      retry.current = undefined;
      setMessage({ text: `Refinance benefit evidence version ${result.revision} saved.` });
    } catch (error) {
      setMessage({ text: error instanceof Error && !(error instanceof TypeError) ? error.message :
        "Save could not be confirmed. Retry the same evidence.", error: true });
    } finally { setBusy(false); }
  }

  return <details className="details-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 content-center">{stateNames[state]} refinance benefit evidence</summary>
    {open && <div className="record-form">
      <p><a className="underline" href={authority.url} target="_blank" rel="noreferrer">{authority.label}</a>
        {state === "NE" && <> · <a className="underline" href={nebraskaBenefitForm} target="_blank" rel="noreferrer">Nebraska disclosure form</a></>}</p>
      <p className="muted">Use references to the reviewed terms, costs and borrower records. Counsel reviews applicability and the recorded outcome.</p>
      <div><Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => {
        setMessage(undefined); setRefresh(value => value + 1);
      }}>Reload saved evidence</Button></div>
      {message && <p ref={feedback} tabIndex={-1} role={message.error ? "alert" : "status"}>{message.text}</p>}
      {!data && !message && <p role="status">Loading refinance benefit evidence…</p>}
      {data && (facts ? <EvidenceSummary facts={facts} /> : <p>No refinance benefit evidence recorded.</p>)}
      {data && !readOnly && <details className="details-section">
        <summary className="min-h-11 content-center">{latest ? "Record a benefit evidence correction" : "Record refinance benefit evidence"}</summary>
        <form className="record-form" onSubmit={save} key={data.revision}>
          <fieldset className="record-form" disabled={busy}>
            <label className="field">Coverage for this review<select name="applicability" defaultValue={facts?.applicability ?? "Unresolved"}>
              <option>Unresolved</option><option>Covered for internal review</option>
            </select></label>
            <label className="field">Scope reference<input name="scopeReference" defaultValue={facts?.scopeReference} maxLength={180} required /></label>
            <label className="field">Terms and costs comparison reference<input name="comparisonReference" defaultValue={facts?.comparisonReference} maxLength={180} /></label>
            <label className="field">Reviewed outcome<select name="outcome" defaultValue={facts?.outcome ?? "Unresolved"}>
              <option>Unresolved</option><option>Benefit documented</option><option>No benefit identified</option>
            </select></label>
            <label className="field">Rationale<textarea name="rationale" rows={2} defaultValue={facts?.rationale} maxLength={1000} /></label>
            {state === "NE" && <>
              <label className="field">Review time zone<select name="zone" defaultValue={facts?.state === "NE" ? facts.zone : "America/Chicago"}>
                <option value="America/Chicago">Central</option><option value="America/Denver">Mountain</option>
              </select></label>
              <label className="field">Worksheet version<input name="worksheetVersion" maxLength={180}
                defaultValue={facts?.state === "NE" ? facts.worksheetVersion : undefined} /></label>
            </>}
            {eventFields.map(({ key, label }) => {
              const saved = dated(facts, key);
              return <fieldset className="record-form" key={key}><legend>{label}</legend>
                <label className="field">Date<input type="date" name={`${key}Date`} defaultValue={saved?.on} /></label>
                <label className="field">Evidence reference<input name={`${key}Reference`} maxLength={180} defaultValue={saved?.reference} /></label>
              </fieldset>;
            })}
            {latest && <label className="field">Correction reference<input name="correction" maxLength={180} required /></label>}
            <div><Button type="submit" size="sm" className="min-h-11">{busy ? "Saving…" : "Save refinance benefit evidence"}</Button></div>
          </fieldset>
        </form>
      </details>}
      {data && data.history.length > 1 && <details className="details-section">
        <summary className="min-h-11 content-center">Refinance benefit history</summary>
        {data.history.slice(1).map(entry => <details className="details-section" key={entry.revision}>
          <summary className="min-h-11 content-center">Version {entry.revision} · {entry.at.slice(0, 10)}</summary>
          <p>{entry.actor}{entry.correction && ` · ${entry.correction}`}</p>
          <EvidenceSummary facts={entry.facts} />
        </details>)}
        {data.moreHistory && <p>Showing the latest 20 versions.</p>}
      </details>}
    </div>}
  </details>;
}

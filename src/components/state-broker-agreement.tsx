"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { brokerAgreementFacts, brokerAgreementSources, reviewBrokerAgreement, type BrokerAgreementFacts } from "@/lib/state-broker-agreement-model";
import { Button } from "./ui/button";

type State = BrokerAgreementFacts["state"];
type Result = Extract<ComplianceCaseResult, { kind: "stateBrokerAgreement" }>;
type EventName = "signed" | "deliveredCopy" | "exclusiveDisclosure" | "applicationSigned" | "consideration" |
  "disclosureDelivered" | "explanation" | "acknowledgment";
const names = { IN: "Indiana", IL: "Illinois", WI: "Wisconsin" };
const events: Record<State, readonly { key: EventName; label: string }[]> = {
  IN: [{ key: "signed", label: "Agreement signing completed" }, { key: "deliveredCopy", label: "Signed copy provided to each party" },
    { key: "exclusiveDisclosure", label: "Exclusive lender disclosure provided" }],
  IL: [{ key: "signed", label: "Agreement signing completed" }, { key: "applicationSigned", label: "Completed application signed" },
    { key: "consideration", label: "Consideration given" }, { key: "deliveredCopy", label: "Executed copy provided to customer" }],
  WI: [{ key: "signed", label: "Agreement signing completed" }, { key: "disclosureDelivered", label: "Consumer disclosure provided" },
    { key: "explanation", label: "Disclosure explained" }, { key: "acknowledgment", label: "Applicant signed or initialed the disclosure" }],
};

function agreementEvent(facts: BrokerAgreementFacts | undefined, key: EventName) {
  return (facts as Partial<Record<EventName, { on: string; time?: string; reference: string }>> | undefined)?.[key];
}

function AgreementSummary({ facts }: { facts: BrokerAgreementFacts }) {
  const review = reviewBrokerAgreement(facts);
  return <div className="record-form">
    <p>{facts.applicability} · {facts.scopeReference}</p>
    {facts.agreementVersion && <p>Agreement version · {facts.agreementVersion}</p>}
    {facts.state === "IN" && <p>Exclusive lender arrangement · {facts.exclusiveLender}</p>}
    {facts.state === "IL" && facts.incorporatedDisclosureVersion && <p>Incorporated disclosure · {facts.incorporatedDisclosureVersion}</p>}
    {facts.state === "WI" && <p>Agreement form · {facts.form}{facts.disclosureVersion && ` · Consumer disclosure ${facts.disclosureVersion}`}</p>}
    <dl>{events[facts.state].map(({ key, label }) => {
      const entry = agreementEvent(facts, key);
      return entry && <div key={key}><dt>{label}</dt><dd className="break-words">{entry.on}{entry.time && ` ${entry.time}`} · {entry.reference}</dd></div>;
    })}</dl>
    <ul>{review.timing.map(({ label, result }) => <li key={label}>{label} · {result}</li>)}</ul>
    {review.gaps.length > 0 && <ul>{review.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
  </div>;
}

export function StateBrokerAgreement({ state, loanId, brokerageId, readOnly }: {
  state: State; loanId: string; brokerageId: string; readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Result>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: true }>();
  const feedback = useRef<HTMLParagraphElement>(null);
  const retry = useRef<{ body: string; id: string } | undefined>(undefined);
  const source = brokerAgreementSources[state];
  const latest = data?.history[0];
  const facts = latest?.facts;

  useEffect(() => {
    if (!open) return;
    let active = true;
    void accessComplianceCases({ type: "stateBrokerAgreement", input: { operation: "read", loanId, state } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "stateBrokerAgreement") throw new Error("Agreement evidence could not be loaded.");
      setData(current => current && current.revision > result.revision ? current : result);
    }).catch(error => {
      if (active) setMessage({ error: true, text: error instanceof Error && !(error instanceof TypeError)
        ? error.message : "Agreement evidence could not be loaded. Reload to try again." });
    });
    return () => { active = false; };
  }, [brokerageId, loanId, open, refresh, state]);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy || readOnly) return;
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim() || undefined;
    const dateFields = Object.fromEntries(events[state].map(({ key }) => {
      const on = value(`${key}Date`);
      const time = value(`${key}Time`);
      const reference = value(`${key}Reference`);
      return [key, on || time || reference ? { on, time, reference } : undefined];
    }));
    const parsed = brokerAgreementFacts.safeParse({ state, ...dateFields,
      zone: value("zone") ?? "America/Chicago", applicability: value("applicability"), scopeReference: value("scopeReference"),
      agreementVersion: value("agreementVersion"),
      ...(state === "IN" ? { exclusiveLender: value("exclusiveLender") } : state === "IL"
        ? { incorporatedDisclosureVersion: value("incorporatedDisclosureVersion") }
        : { form: value("form"), disclosureVersion: value("disclosureVersion") }),
    });
    if (!parsed.success) {
      setMessage({ error: true, text: "Enter the scope reference and a date and evidence reference for each event you record." });
      return;
    }
    const input = { operation: "save", loanId, expectedRevision: data.revision, facts: parsed.data, correction: value("correction") };
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await accessComplianceCases({ type: "stateBrokerAgreement", input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "stateBrokerAgreement") throw new Error("Save could not be confirmed. Retry the same evidence.");
      retry.current = undefined;
      setData(result);
      setMessage({ text: `Agreement evidence version ${result.revision} saved.` });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error && !(error instanceof TypeError)
        ? error.message : "Save could not be confirmed. Retry the same evidence." });
    } finally { setBusy(false); }
  }

  return <details className="details-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 content-center">{names[state]} brokerage agreement evidence</summary>
    {open && <div className="record-form">
      <p><a className="underline" href={source.href} target="_blank" rel="noreferrer">{source.label}</a></p>
      {state === "WI" && <p><a className="underline" href="https://dfi.wi.gov/Pages/FinancialServices/MortgageBanking/Forms.aspx" target="_blank" rel="noreferrer">Wisconsin DFI forms</a></p>}
      <p className="muted">Use evidence references for one agreement and one review time zone. Counsel reviews coverage and the recorded chronology.</p>
      <div><Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => {
        setMessage(undefined); setRefresh(value => value + 1);
      }}>Reload saved evidence</Button></div>
      {message && <p ref={feedback} role={message.error ? "alert" : "status"} tabIndex={-1}>{message.text}</p>}
      {!data && !message && <p role="status">Loading agreement evidence…</p>}
      {data && (facts ? <AgreementSummary facts={facts} /> : <p>No agreement evidence recorded.</p>)}
      {data && !readOnly && <details className="details-section">
        <summary className="min-h-11 content-center">{latest ? "Record an evidence correction" : "Record agreement evidence"}</summary>
        <form className="record-form" key={data.revision} onSubmit={save}>
          <fieldset className="record-form" disabled={busy}>
            <label className="field">Coverage for this review<select name="applicability" defaultValue={facts?.applicability ?? "Unresolved"}>
              <option>Unresolved</option><option>Covered for internal review</option>
            </select></label>
            <label className="field">Scope reference<input name="scopeReference" defaultValue={facts?.scopeReference} maxLength={180} required /></label>
            {state === "IN" && <label className="field">Review time zone<select name="zone" defaultValue={facts?.zone ?? "America/Indiana/Indianapolis"}>
              <option value="America/Indiana/Indianapolis">Eastern</option><option value="America/Chicago">Central</option>
            </select></label>}
            <label className="field">Signed agreement version<input name="agreementVersion" defaultValue={facts?.agreementVersion} maxLength={180} /></label>
            {state === "IN" && <label className="field">Exclusive lender arrangement<select name="exclusiveLender"
              defaultValue={facts?.state === "IN" ? facts.exclusiveLender : "Unresolved"}>
              <option>Unresolved</option><option>Applies</option><option>Does not apply</option>
            </select></label>}
            {state === "IL" && <label className="field">Incorporated brokerage disclosure version<input name="incorporatedDisclosureVersion"
              defaultValue={facts?.state === "IL" ? facts.incorporatedDisclosureVersion : undefined} maxLength={180} /></label>}
            {state === "WI" && <>
              <label className="field">Agreement form<select name="form" defaultValue={facts?.state === "WI" ? facts.form : "Unresolved"}>
                <option>Unresolved</option><option>MB302TRID</option><option>MB302</option><option>MB303</option><option>Other for counsel review</option>
              </select></label>
              <label className="field">Consumer disclosure version<input name="disclosureVersion"
                defaultValue={facts?.state === "WI" ? facts.disclosureVersion : undefined} maxLength={180} /></label>
            </>}
            {events[state].map(({ key, label }) => {
              const saved = agreementEvent(facts, key);
              return <fieldset key={key} className="record-form">
                <legend>{label}</legend>
                <div className="form-grid">
                  <label className="field">Date<input type="date" name={`${key}Date`} defaultValue={saved?.on} /></label>
                  <label className="field">Time if documented<input type="time" name={`${key}Time`} defaultValue={saved?.time} /></label>
                </div>
                <label className="field">Evidence reference<input name={`${key}Reference`} defaultValue={saved?.reference} maxLength={180} /></label>
              </fieldset>;
            })}
            {latest && <label className="field">Correction reference<input name="correction" maxLength={180} required /></label>}
            <div><Button type="submit" size="sm" className="min-h-11">{busy ? "Saving…" : "Save agreement evidence"}</Button></div>
          </fieldset>
        </form>
      </details>}
      {data && data.history.length > 1 && <details className="details-section">
        <summary className="min-h-11 content-center">Agreement evidence history</summary>
        {data.history.slice(1).map(entry => <details className="details-section" key={entry.revision}>
          <summary className="min-h-11 content-center">Version {entry.revision} · {entry.at.slice(0, 10)}</summary>
          <p>{entry.actor}{entry.correction && ` · ${entry.correction}`}</p>
          <AgreementSummary facts={entry.facts} />
        </details>)}
        {data.moreHistory && <p>Showing the latest 20 versions.</p>}
      </details>}
    </div>}
  </details>;
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { michiganLoanPracticesFacts, reviewMichiganLoanPractices,
  type MichiganLoanPracticesFacts as Facts } from "@/lib/michigan-loan-practices-model";
import { Button } from "./ui/button";

type Result = Extract<ComplianceCaseResult, { kind: "michiganLoanPractices" }>;
type FormReader = (form: FormData, name: string) => string | undefined;
const value: FormReader = (form, name) => String(form.get(name) ?? "").trim() || undefined;
const yesNo = ["Unknown", "Yes", "No"] as const;
const outcomes = ["Unresolved", "No concern recorded", "Concern recorded"] as const;
const inventory = ["Unresolved", "No charges identified", "Listed charges reviewed"] as const;
const scope = ["Unresolved", "In scope for pilot review", "Outside scope for pilot review"] as const;
const amountReview = ["Unknown", "No third party", "Reconciled", "Discrepancy"] as const;
const integrity = [
  ["representations", "Qualification and property value representations"],
  ["applicationChanges", "Changes to application information"],
  ["signedNote", "Terms present at note signing"],
] as const;
const appraisal = [
  ["appraisalPayment", "Appraisal payment conditions"],
  ["appraisalInfluence", "Appraisal independence"],
] as const;
const requirementTitles: Record<string, string> = {
  "REQ-MI-LOAN-CMPA-SERVICE": "Service fees and third-party amounts",
  "REQ-MI-LOAN-CMPA-INTEGRITY": "Application and signed-note integrity",
  "REQ-MI-LOAN-CMPA-APPRAISAL": "Appraisal independence",
  "REQ-MI-LOAN-CMPA-PREMIUM": "Financed single-premium credit coverage",
  "REQ-MI-LOAN-CMPA-TERM": "Short-term payment schedule",
};
const assessmentGroups = [
  [requirementTitles["REQ-MI-LOAN-CMPA-INTEGRITY"], integrity],
  [requirementTitles["REQ-MI-LOAN-CMPA-APPRAISAL"], appraisal],
] as const;

function Choice({ label, name, options, selected }: { label: string; name: string; options: readonly string[]; selected?: string }) {
  return <label className="field min-w-0">{label}
    <select name={name} defaultValue={selected ?? options[0]}>
      {options.map(option => <option key={option}>{option}</option>)}
    </select>
  </label>;
}

function Reference({ label, name, saved, required }: { label: string; name: string; saved?: string; required?: boolean }) {
  return <label className="field min-w-0">{label}
    <input name={name} maxLength={180} defaultValue={saved} required={required} />
  </label>;
}

function ReviewSummary({ facts, review }: { facts: Facts; review: ReturnType<typeof reviewMichiganLoanPractices> }) {
  return <div className="record-form">
    <p className="break-words">{facts.reviewedOn} · {review.scope} · {review.scopeReference}</p>
    {review.reviews.map(({ requirement, findings }) => <div key={requirement}
      className="grid min-w-0 gap-1 border-t border-[var(--line)] py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-3">
      <strong>{requirementTitles[requirement]}</strong>
      {findings.length > 0
        ? <ul className="list-disc pl-5">{findings.map(item => <li className="break-words" key={item.message}>
          {item.status} · {item.message}</li>)}</ul>
        : <p className="muted">No gap or concern recorded</p>}
    </div>)}
    <details className="details-section">
      <summary className="min-h-11 content-center">Recorded facts and references</summary>
      <dl className="record-form">
        <div><dt>Charge inventory</dt><dd className="break-words">{facts.serviceInventory}
          {facts.serviceInventoryReference && ` · ${facts.serviceInventoryReference}`}</dd></div>
        {facts.services.map(row => <div key={row.key}><dt>Charge {row.key}</dt><dd className="break-words">
          {row.reference} · Fee charged {row.feeCharged.toLowerCase()} · Provided {row.provided.toLowerCase()} · {row.thirdPartyAmount}
        </dd></div>)}
        {[...integrity, ...appraisal].map(([key, label]) => facts[key] && <div key={key}>
          <dt>{label}</dt><dd className="break-words">{facts[key].result} · {facts[key].reference}</dd></div>)}
        {facts.premium && <div><dt>Financed single-premium credit coverage</dt>
          <dd className="break-words">{facts.premium.financedSinglePremiumCreditCoverage} · {facts.premium.reference}</dd></div>}
        {facts.term && <div><dt>Term and schedule</dt><dd className="break-words">
          {facts.term.startsOn} to {facts.term.maturesOn} · {facts.term.reference}
          <br />Regular payments fully amortize · {facts.term.regularPaymentsAmortize}
          <br />Bridge for the intended principal dwelling · {facts.term.bridgeForPrincipalDwelling}
        </dd></div>}
      </dl>
    </details>
  </div>;
}

function PracticesForm({ facts, busy, onSave }: { facts?: Facts; busy: boolean; onSave: (form: FormData, rows: number[]) => void }) {
  const [rows, setRows] = useState(() => (facts?.services ?? []).map((_, index) => index));
  const nextRow = useRef(rows.length);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(new FormData(event.currentTarget), rows);
  }
  return <form className="record-form min-w-0" onSubmit={submit}>
    <fieldset className="record-form min-w-0" disabled={busy}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field min-w-0">Review date<input name="reviewedOn" type="date" defaultValue={facts?.reviewedOn} required /></label>
        <label className="field min-w-0">Review time zone<select name="zone" defaultValue={facts?.zone ?? "America/Detroit"}>
          <option value="America/Detroit">Eastern</option><option value="America/Menominee">Central</option>
        </select></label>
      </div>
      <Choice label="Pilot review scope" name="scope" options={scope} selected={facts?.scope} />
      <Reference label="Scope evidence reference" name="scopeReference" saved={facts?.scopeReference} required />
      <details className="details-section">
        <summary className="min-h-11 content-center">{requirementTitles["REQ-MI-LOAN-CMPA-SERVICE"]}</summary>
        <div className="record-form">
          <Choice label="Charge inventory" name="serviceInventory" options={inventory} selected={facts?.serviceInventory} />
          <Reference label="Charge inventory evidence reference" name="serviceInventoryReference" saved={facts?.serviceInventoryReference} />
          {rows.map((row, index) => {
            const prior = facts?.services[row];
            return <fieldset className="record-form min-w-0" key={row}>
              <legend>Charge {index + 1}</legend>
              <label className="field min-w-0">Charge key<input name={`serviceKey${row}`} maxLength={40} defaultValue={prior?.key} /></label>
              <Reference label="Charge evidence reference" name={`serviceReference${row}`} saved={prior?.reference} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice label="Fee charged" name={`feeCharged${row}`} options={yesNo} selected={prior?.feeCharged} />
                <Choice label="Product or service provided" name={`provided${row}`} options={yesNo} selected={prior?.provided} />
              </div>
              <Choice label="Third-party amount" name={`thirdPartyAmount${row}`} options={amountReview} selected={prior?.thirdPartyAmount} />
              <div><Button type="button" variant="outline" size="sm" className="min-h-11"
                onClick={() => setRows(current => current.filter(id => id !== row))}>Remove charge {index + 1}</Button></div>
            </fieldset>;
          })}
          <div><Button type="button" variant="outline" size="sm" className="min-h-11" disabled={rows.length >= 40} onClick={() => {
            const id = nextRow.current++;
            setRows(current => [...current, id]);
          }}>Add charge</Button></div>
        </div>
      </details>
      {assessmentGroups.map(([title, fields]) =>
        <details className="details-section" key={title}>
          <summary className="min-h-11 content-center">{title}</summary>
          <div className="record-form">
            {fields.map(([key, label]) => <fieldset className="record-form min-w-0" key={key}>
              <legend>{label}</legend>
              <Choice label={`${label} outcome`} name={key} options={outcomes} selected={facts?.[key]?.result} />
              <Reference label={`${label} evidence reference`} name={`${key}Reference`} saved={facts?.[key]?.reference} />
            </fieldset>)}
          </div>
        </details>)}
      <details className="details-section">
        <summary className="min-h-11 content-center">{requirementTitles["REQ-MI-LOAN-CMPA-PREMIUM"]}</summary>
        <div className="record-form">
          <Choice label="Finances single-premium credit life, disability or unemployment coverage"
            name="premium" options={yesNo} selected={facts?.premium?.financedSinglePremiumCreditCoverage} />
          <Reference label="Credit coverage evidence reference" name="premiumReference" saved={facts?.premium?.reference} />
        </div>
      </details>
      <details className="details-section">
        <summary className="min-h-11 content-center">{requirementTitles["REQ-MI-LOAN-CMPA-TERM"]}</summary>
        <div className="record-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field min-w-0">Term start<input type="date" name="startsOn" defaultValue={facts?.term?.startsOn} /></label>
            <label className="field min-w-0">Maturity<input type="date" name="maturesOn" defaultValue={facts?.term?.maturesOn} /></label>
          </div>
          <Reference label="Note or payment schedule reference" name="termReference" saved={facts?.term?.reference} />
          <Choice label="Regular periodic payments fully amortize the principal" name="amortizes" options={yesNo}
            selected={facts?.term?.regularPaymentsAmortize} />
          <Choice label="Bridge for acquisition or construction of the intended principal dwelling" name="bridge"
            options={yesNo} selected={facts?.term?.bridgeForPrincipalDwelling} />
        </div>
      </details>
      {facts && <Reference label="Correction evidence reference" name="correction" required />}
      <div><Button type="submit" size="sm" className="min-h-11">{busy ? "Saving…" : "Save Michigan loan practices evidence"}</Button></div>
    </fieldset>
  </form>;
}

function collectFacts(form: FormData, rows: number[]) {
  const field = (name: string) => value(form, name);
  const assessments = Object.fromEntries([...integrity, ...appraisal].map(([key]) => {
    const result = field(key);
    const reference = field(`${key}Reference`);
    return [key, reference || result !== "Unresolved" ? { result, reference } : undefined];
  }));
  const startsOn = field("startsOn");
  const maturesOn = field("maturesOn");
  const termReference = field("termReference");
  const regularPaymentsAmortize = field("amortizes");
  const bridgeForPrincipalDwelling = field("bridge");
  const premium = field("premium");
  const premiumReference = field("premiumReference");
  return michiganLoanPracticesFacts.safeParse({
    state: "MI", zone: field("zone"), reviewedOn: field("reviewedOn"), scope: field("scope"),
    scopeReference: field("scopeReference"), serviceInventory: field("serviceInventory"),
    serviceInventoryReference: field("serviceInventoryReference"),
    services: rows.map(row => ({ key: field(`serviceKey${row}`), reference: field(`serviceReference${row}`),
      feeCharged: field(`feeCharged${row}`), provided: field(`provided${row}`), thirdPartyAmount: field(`thirdPartyAmount${row}`) })),
    ...assessments,
    premium: premiumReference || premium !== "Unknown" ? { reference: premiumReference, financedSinglePremiumCreditCoverage: premium } : undefined,
    term: startsOn || maturesOn || termReference || regularPaymentsAmortize !== "Unknown" || bridgeForPrincipalDwelling !== "Unknown"
      ? { startsOn, maturesOn, reference: termReference, regularPaymentsAmortize, bridgeForPrincipalDwelling } : undefined,
  });
}

export function MichiganLoanPractices({ brokerageId, loanId, readOnly }: { brokerageId: string; loanId: string; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Result>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: true }>();
  const retry = useRef<{ body: string; id: string } | undefined>(undefined);
  const feedback = useRef<HTMLParagraphElement>(null);
  const latest = data?.history[0];
  useEffect(() => {
    if (!open) return;
    let active = true;
    void accessComplianceCases({ type: "michiganLoanPractices", input: { operation: "read", state: "MI", loanId } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "michiganLoanPractices") throw new Error("Could not load Michigan loan practices evidence.");
      setData(current => current && current.revision > result.revision ? current : result);
    }).catch(error => {
      if (active) setMessage({ text: error instanceof Error && !(error instanceof TypeError) ? error.message :
        "Could not load Michigan loan practices evidence. Reload to try again.", error: true });
    });
    return () => { active = false; };
  }, [brokerageId, loanId, open, refresh]);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);

  async function save(form: FormData, rows: number[]) {
    if (!data || readOnly || busy) return;
    const parsed = collectFacts(form, rows);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const section = String(issue?.path[0] ?? "");
      const title = [...integrity, ...appraisal].find(([key]) => key === section)?.[1];
      const message = section === "term" ? "Enter the term start, a later maturity and a schedule reference." :
        section === "services" ? "Give each charge a distinct key of up to 40 letters, digits, hyphens or underscores and an evidence reference." :
        section === "serviceInventory" ? "Reconcile the charge inventory with the listed charges." :
        section === "premium" ? "Enter the credit coverage evidence reference." :
        title ? `Enter the evidence reference for ${title.toLowerCase()}.` : "Check the review date and scope reference.";
      setMessage({ text: message, error: true });
      return;
    }
    const input = { operation: "save", loanId, expectedRevision: data.revision, facts: parsed.data, correction: value(form, "correction") };
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await accessComplianceCases({ type: "michiganLoanPractices", input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "michiganLoanPractices") throw new Error("Save could not be confirmed. Retry the same evidence.");
      setData(result);
      retry.current = undefined;
      setMessage({ text: `Michigan loan practices evidence version ${result.revision} saved.` });
    } catch (error) {
      setMessage({ text: error instanceof Error && !(error instanceof TypeError) ? error.message :
        "Save could not be confirmed. Retry the same evidence.", error: true });
    } finally { setBusy(false); }
  }

  return <details className="details-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 content-center">Michigan loan practices evidence</summary>
    {(open || data) && <div className="record-form min-w-0">
      <p className="muted">Record findings and references for the pilot review. Counsel reviews coverage and responsibility.</p>
      <p><a className="underline" href="https://www.legislature.mi.gov/documents/mcl/pdf/mcl-Act-660-of-2002.pdf"
        target="_blank" rel="noreferrer">Michigan Consumer Mortgage Protection Act §§4–5</a></p>
      <div><Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => {
        setMessage(undefined);
        setRefresh(current => current + 1);
      }}>Reload saved evidence</Button></div>
      {message && <p ref={feedback} tabIndex={-1} role={message.error ? "alert" : "status"}>{message.text}</p>}
      {!data && !message && <p role="status">Loading Michigan loan practices evidence…</p>}
      {data && (latest && data.review ? <ReviewSummary facts={latest.facts} review={data.review} /> : <p>No Michigan loan practices evidence recorded.</p>)}
      {data && !readOnly && <details className="details-section">
        <summary className="min-h-11 content-center">{latest ? "Record a Michigan loan practices correction" : "Record Michigan loan practices evidence"}</summary>
        <PracticesForm key={data.revision} facts={latest?.facts} busy={busy} onSave={(form, rows) => void save(form, rows)} />
      </details>}
      {data && data.history.length > 1 && <details className="details-section">
        <summary className="min-h-11 content-center">Michigan loan practices history</summary>
        {data.history.slice(1).map(entry => <details className="details-section" key={entry.revision}>
          <summary className="min-h-11 content-center">Version {entry.revision} · {entry.at.slice(0, 10)}</summary>
          <p className="break-words">{entry.actor}{entry.correction && ` · ${entry.correction}`}</p>
          <ReviewSummary facts={entry.facts} review={reviewMichiganLoanPractices(entry.facts)} />
        </details>)}
        {data.moreHistory && <p>Showing the latest 20 versions.</p>}
      </details>}
    </div>}
  </details>;
}

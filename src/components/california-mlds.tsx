"use client";

import { useEffect, useRef, useState } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { californiaMldsFacts, californiaMldsSources, reviewCaliforniaMlds, type CaliforniaMldsFacts } from "@/lib/california-mlds-model";
import { Button } from "./ui/button";

type Result = Extract<ComplianceCaseResult, { kind: "californiaMlds" }>;
type Evidence = NonNullable<CaliforniaMldsFacts["application"]>;
const [, dreSchema, federalSchema] = californiaMldsFacts.shape.route.options;
const dreFields = [["productAndFormReference", "Product and approved form review"],
  ["contentReviewReference", "Terms, fees, compensation and identifiers review"]] as const;
const federalFields = [["eligibilityReference", "Counsel's substitute eligibility reference"],
  ["federalPackageReference", "Federal disclosure package reference"],
  ["californiaContentReference", "California content review"],
  ["balloonReviewReference", "Balloon payment disclosure review"]] as const;

function Reference({ name, label, value, required }: { name: string; label: string; value?: string; required?: boolean }) {
  return <label className="field">{label}{required && " (required)"}<input name={name} defaultValue={value} maxLength={180} required={required} /></label>;
}

function Choice({ name, label, options, value, change }: {
  name: string; label: string; options: readonly string[]; value?: string; change?: (value: string) => void;
}) {
  return <label className="field">{label}<select name={name} value={change ? value : undefined}
    defaultValue={change ? undefined : value} onChange={change && (event => change(event.target.value))}>
    {options.map(option => <option key={option}>{option}</option>)}
  </select></label>;
}

function EventFields({ name, label, value, dateOnly }: { name: string; label: string; value?: Evidence; dateOnly?: boolean }) {
  return <details className="details-section">
    <summary className="min-h-11 content-center">{label}</summary>
    <div className="record-form">
      <div className="grid items-end gap-[10px] sm:grid-cols-2">
        <label className="field">Date<input type="date" name={name + "-date"} min="2015-10-03" max="2099-12-31" defaultValue={value?.on} /></label>
        {!dateOnly && <label className="field">Pacific time if documented<input type="time" name={name + "-time"} defaultValue={value?.time} /></label>}
      </div>
      <Reference name={name + "-ref"} label={dateOnly ? "Calendar reference" : "Evidence reference"} value={value?.reference} />
    </div>
  </details>;
}

function Editor({ facts, disabled, saving, save }: {
  facts?: CaliforniaMldsFacts; disabled: boolean; saving: boolean; save: (form: FormData) => void;
}) {
  const [scope, setScope] = useState<string>(facts?.scope ?? "Unresolved");
  const [route, setRoute] = useState<string>(facts?.route.kind ?? "Unresolved");
  const [note, setNote] = useState<string>(facts?.noteStatus ?? "Unresolved");
  const [borrowers, setBorrowers] = useState<string>(facts?.borrowerScope ?? "Unresolved");
  const dre = facts?.route.kind === "DRE statement" ? facts.route : undefined;
  const federal = facts?.route.kind === "Federal substitute" ? facts.route : undefined;
  const [federalForm, setFederalForm] = useState<string>(federal?.form ?? "Loan Estimate");
  const outside = scope === "Outside DRE broker negotiation";
  const additional = borrowers === "Two borrowers" || (borrowers === "Unresolved" && facts?.borrowers.length === 2);
  return <form className="record-form" onSubmit={event => { event.preventDefault(); save(new FormData(event.currentTarget)); }}>
    <fieldset className="record-form min-w-0" disabled={disabled}>
      <Choice name="scope" label="DRE applicability" options={californiaMldsFacts.shape.scope.options} value={scope} change={setScope} />
      <Reference name="scopeReference" label="Authority and scope reference" value={facts?.scopeReference} required />
      <fieldset className={outside ? undefined : "record-form min-w-0"} hidden={outside} disabled={outside}>
        <EventFields name="application" label="Completed written application" value={facts?.application} />
        <EventFields name="deadline" label="Documented third business day" value={facts?.thirdBusinessDay} dateOnly />
        <Choice name="noteStatus" label="Obligation on the note" options={californiaMldsFacts.shape.noteStatus.options} value={note} change={setNote} />
        <Reference name="noteStatusReference" label="Note status reference" value={facts?.noteStatusReference} />
        <fieldset hidden={note !== "Obligated"} disabled={note !== "Obligated"}>
          <EventFields name="note" label="Actual note obligation" value={facts?.noteObligation} />
        </fieldset>
        <Choice name="route" label="Disclosure route" options={["Unresolved", "DRE statement", "Federal substitute"]} value={route} change={setRoute} />
        <fieldset className={route === "DRE statement" ? "record-form min-w-0" : undefined} hidden={route !== "DRE statement"} disabled={route !== "DRE statement"}>
          <Choice name="dre-form" label="DRE form" options={dreSchema.shape.form.options} value={dre?.form} />
          <Reference name="dre-version" label="DRE form version" value={dre?.formVersion} />
          {dreFields.map(([key, label]) => <Reference key={key} name={key} label={label} value={dre?.[key]} />)}
          <EventFields name="broker" label="Broker or authorized licensee signature" value={dre?.brokerSignature} />
        </fieldset>
        <fieldset className={route === "Federal substitute" ? "record-form min-w-0" : undefined} hidden={route !== "Federal substitute"} disabled={route !== "Federal substitute"}>
          <Choice name="federal-form" label="Federal form" options={federalSchema.shape.form.options} value={federalForm} change={setFederalForm} />
          <Reference name="federal-version" label="Federal form version" value={federal?.formVersion} />
          <Choice name="federal-scope" label="Federally regulated residential loan" options={federalSchema.shape.federallyRegulatedResidential.options} value={federal?.federallyRegulatedResidential} />
          <div className="grid items-end gap-[10px] sm:grid-cols-2">
            <Choice name="lien" label="Lien position" options={federalSchema.shape.lien.options} value={federal?.lien} />
            <label className="field">Principal amount (USD)<input name="principal" inputMode="decimal"
              defaultValue={federal?.principalCents ? (federal.principalCents / 100).toFixed(2) : undefined} /></label>
          </div>
          {federalFields.map(([key, label]) => <Reference key={key} name={key} label={label} value={federal?.[key]} />)}
        </fieldset>
        <Reference name="translation" label="Negotiated language and translation review" value={facts?.translationReviewReference} />
        <Reference name="archive" label="Retained disclosure file reference" value={facts?.retainedFileReference} />
        <Choice name="borrowerScope" label="Borrowers to review" options={californiaMldsFacts.shape.borrowerScope.options} value={borrowers} change={setBorrowers} />
        {additional && <input type="hidden" name="additional" value="yes" />}
        {(["Primary borrower", "Additional borrower"] as const).map((name, index) => {
          const prefix = index ? "additional" : "primary";
          const matchesSavedRoute = route === facts?.route.kind && (!federal || federalForm === federal.form);
          const saved = matchesSavedRoute ? facts?.borrowers.find(item => item.borrower === name) : undefined;
          const hidden = index === 1 && !additional;
          const supplement = route === "Federal substitute" && federalForm === "Loan Estimate";
          return <fieldset key={`${name}:${route}:${route === "Federal substitute" ? federalForm : ""}`} className={hidden ? undefined : "record-form min-w-0"} hidden={hidden} disabled={hidden}>
            <legend className="font-semibold">{name}</legend>
            <EventFields name={prefix + "-delivery"} label="Disclosure delivery" value={saved?.delivery} />
            <EventFields name={prefix + "-signed"} label={route === "Federal substitute" ? "Written acknowledgment" : "Borrower signature"} value={saved?.signed} />
            <fieldset hidden={route !== "DRE statement"} disabled={route !== "DRE statement"}>
              <EventFields name={prefix + "-copy"} label="Executed copy delivery" value={saved?.executedCopy} />
            </fieldset>
            <fieldset hidden={!supplement} disabled={!supplement}>
              <EventFields name={prefix + "-supplement"} label="California supplement delivery" value={saved?.californiaSupplement} />
            </fieldset>
          </fieldset>;
        })}
      </fieldset>
      {facts && <Reference name="correction" label="Correction reference" required />}
      <div><Button type="submit" className="min-h-11">{saving ? "Saving…" : "Save California disclosure evidence"}</Button></div>
    </fieldset>
  </form>;
}

function EventLine({ label, value }: { label: string; value?: Evidence }) {
  return value && <p className="break-words"><strong>{label}</strong> · {value.on}{value.time && ` ${value.time}`} · {value.reference}</p>;
}

function Summary({ facts, review }: { facts: CaliforniaMldsFacts; review: Result["review"] }) {
  const { route } = facts;
  return <div className="record-form">
    <p className="break-words"><strong>{facts.scope}</strong> · {facts.scopeReference}</p>
    {facts.scope === "DRE broker negotiation" && <>
      <EventLine label="Completed written application" value={facts.application} />
      <EventLine label="Documented third business day" value={facts.thirdBusinessDay} />
      <EventLine label="Actual note obligation" value={facts.noteObligation} />
      {facts.noteStatusReference && <p className="break-words">{facts.noteStatus} · {facts.noteStatusReference}</p>}
      <p className="break-words"><strong>{route.kind}</strong>{route.kind !== "Unresolved" && ` · ${route.form} · ${route.formVersion}`}</p>
      {route.kind === "DRE statement" && <>
        <EventLine label="Broker or authorized licensee signature" value={route.brokerSignature} />
        {dreFields.map(([key, label]) => route[key] && <p className="break-words" key={key}>{label} · {route[key]}</p>)}
      </>}
      {route.kind === "Federal substitute" && <>
        <p>{route.lien} lien{route.principalCents && ` · ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(route.principalCents / 100)}`}</p>
        <p>Federally regulated residential loan · {route.federallyRegulatedResidential}</p>
        {federalFields.map(([key, label]) => route[key] && <p className="break-words" key={key}>{label} · {route[key]}</p>)}
      </>}
      {facts.translationReviewReference && <p className="break-words">Language and translation · {facts.translationReviewReference}</p>}
      {facts.retainedFileReference && <p className="break-words">Retained file · {facts.retainedFileReference}</p>}
    </>}
    {!!review?.findings.length && <ul className="list-disc pl-5">{review.findings.map(text => <li key={text}>{text}</li>)}</ul>}
    {review?.borrowers.map(result => {
      const borrower = facts.borrowers.find(item => item.borrower === result.borrower);
      return <details className="details-section" key={result.borrower}>
        <summary className="min-h-11 content-center">{result.borrower} · {result.findings.length ? "Needs review" : "Evidence recorded"}</summary>
        <div className="record-form">
          <EventLine label="Disclosure delivery" value={borrower?.delivery} />
          <EventLine label={route.kind === "Federal substitute" ? "Written acknowledgment" : "Borrower signature"} value={borrower?.signed} />
          <EventLine label="Executed copy delivery" value={borrower?.executedCopy} />
          <EventLine label="California supplement delivery" value={borrower?.californiaSupplement} />
          {facts.noteObligation && <p>Delivery relative to note obligation · {result.noteOrder}</p>}
          {!!result.findings.length && <ul className="list-disc pl-5">{result.findings.map(text => <li key={text}>{text}</li>)}</ul>}
        </div>
      </details>;
    })}
  </div>;
}

export function CaliforniaMlds({ loanId, brokerageId, readOnly }: { loanId: string; brokerageId: string; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Result>();
  const [refresh, setRefresh] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; stale?: boolean }>();
  const retry = useRef<{ body: string; id: string }>(undefined);
  const feedback = useRef<HTMLParagraphElement>(null);
  const latest = data?.history[0];

  useEffect(() => {
    if (!open) return;
    let active = true;
    void accessComplianceCases({ type: "californiaMlds", input: { operation: "read", loanId, state: "CA" } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result || result.kind !== "californiaMlds") throw new Error();
      setData(current => current && current.revision > result.revision ? current : result);
      if (refresh) setMessage({ text: "Saved California disclosure evidence reloaded." });
    }).catch(() => {
      if (active) setMessage({ error: true, stale: true, text: "California evidence could not be loaded. Reload to try again." });
    }).finally(() => { if (active) setReloading(false); });
    return () => { active = false; };
  }, [brokerageId, loanId, open, refresh]);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);

  async function save(form: FormData) {
    if (!data || saving || reloading || readOnly || message?.stale) return;
    const read = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    const event = (name: string) => {
      const on = read(name + "-date"), time = read(name + "-time"), reference = read(name + "-ref");
      return on || time || reference ? { on, time, reference } : undefined;
    };
    const kind = read("route") ?? "Unresolved";
    const principal = read("principal");
    let route: unknown = { kind };
    if (kind === "DRE statement") route = { kind, form: read("dre-form"), formVersion: read("dre-version"),
      ...Object.fromEntries(dreFields.map(([key]) => [key, read(key)])), brokerSignature: event("broker") };
    if (kind === "Federal substitute") route = { kind, form: read("federal-form"), formVersion: read("federal-version"),
      federallyRegulatedResidential: read("federal-scope"), lien: read("lien"),
      principalCents: principal ? (/^\d{1,10}(\.\d{1,2})?$/.test(principal) ? Math.round(Number(principal) * 100) : NaN) : undefined,
      ...Object.fromEntries(federalFields.map(([key]) => [key, read(key)])) };
    const borrowers = (form.has("additional") ? ["primary", "additional"] : ["primary"]).map(prefix => ({
      borrower: prefix === "primary" ? "Primary borrower" : "Additional borrower",
      delivery: event(prefix + "-delivery"), signed: event(prefix + "-signed"),
      executedCopy: event(prefix + "-copy"), californiaSupplement: event(prefix + "-supplement"),
    }));
    const deadline = event("deadline");
    const scope = read("scope");
    const parsed = californiaMldsFacts.safeParse({ state: "CA", scope, scopeReference: read("scopeReference"),
      application: event("application"), thirdBusinessDay: deadline && { on: deadline.on, reference: deadline.reference },
      noteStatus: read("noteStatus") ?? "Unresolved", noteObligation: event("note"), noteStatusReference: read("noteStatusReference"),
      borrowerScope: read("borrowerScope") ?? "Unresolved", route, borrowers: scope === "Outside DRE broker negotiation" ? [] : borrowers,
      translationReviewReference: read("translation"), retainedFileReference: read("archive") });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setMessage({ error: true, text: issue.code === "custom" ? issue.message : issue.path.includes("principalCents")
        ? "Enter principal in dollars and cents, for example 125000.00." : "Enter a date and reference for each event and a version for the selected form." });
      return;
    }
    const input = { operation: "save", loanId, expectedRevision: data.revision, facts: parsed.data, correction: read("correction") };
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setSaving(true);
    setMessage(undefined);
    try {
      const result = await accessComplianceCases({ type: "californiaMlds", input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) {
        setMessage({ error: true, stale: result.error.includes("evidence changed"), text: result.error });
        return;
      }
      if (result.kind !== "californiaMlds") throw new Error();
      retry.current = undefined;
      setData(result);
      setMessage({ text: `California disclosure evidence version ${result.revision} saved.` });
    } catch {
      setMessage({ error: true, text: "Save could not be confirmed. Retry with the same evidence." });
    } finally { setSaving(false); }
  }

  return <details className="details-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 content-center">California mortgage disclosure evidence</summary>
    {open && <div className="record-form min-w-0">
      <p><a className="underline" href={californiaMldsSources.statute} target="_blank" rel="noreferrer">Cal. Bus. &amp; Prof. Code §10240</a>
        {" · "}<a className="underline" href={californiaMldsSources.forms} target="_blank" rel="noreferrer">DRE forms</a></p>
      <p className="muted">Record the calendar and evidence reviewed for this file. Use Pacific time for all recorded times.</p>
      <div><Button type="button" variant="outline" className="min-h-11" disabled={saving || reloading} onClick={() => {
        setMessage(undefined);
        setReloading(true);
        setRefresh(value => value + 1);
      }}>{reloading ? "Reloading…" : "Reload saved California evidence"}</Button></div>
      {message && <p ref={feedback} role={message.error ? "alert" : "status"} tabIndex={-1}>{message.text}</p>}
      {!data && !message && <p role="status">Loading California disclosure evidence…</p>}
      {data && !latest && <p>No California disclosure evidence recorded.</p>}
      {latest && <Summary facts={latest.facts} review={data.review} />}
      {data && !readOnly && <details className="details-section">
        <summary className="min-h-11 content-center">{latest ? "Record a California evidence correction" : "Record California disclosure evidence"}</summary>
        <Editor key={data.revision} facts={latest?.facts} disabled={saving || reloading || Boolean(message?.stale)} saving={saving} save={save} />
      </details>}
      {data && data.history.length > 1 && <details className="details-section">
        <summary className="min-h-11 content-center">Earlier California evidence</summary>
        {data.history.slice(1).map(version => <details className="details-section" key={version.revision}>
          <summary className="min-h-11 content-center">Version {version.revision} · {version.at.slice(0, 10)}</summary>
          <p className="break-words">{version.actor}{version.correction && ` · ${version.correction}`}</p>
          <Summary facts={version.facts} review={reviewCaliforniaMlds(version.facts, new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
          }).format(new Date(version.at)))} />
        </details>)}
        {data.moreHistory && <p>Showing the latest 20 versions.</p>}
      </details>}
    </div>}
  </details>;
}

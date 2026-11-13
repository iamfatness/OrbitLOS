"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import { newYorkEmploymentEvidence } from "@/lib/new-york-employment-model";
import type { ObligationRequest } from "@/lib/compliance-obligations-model";
import { Button } from "./ui/button";

const finding = z.object({ asOf: z.iso.date(), dueOn: z.iso.date(), filingStatus: z.string(),
  entityNoticesMissing: z.number(), individualNoticesMissing: z.number(), verifyNoticeTiming: z.boolean(), verifyNoActivity: z.boolean() });
const version = z.object({ version: z.number(), evidence: newYorkEmploymentEvidence, finding, actor: z.string(), correction: z.string().nullable() });
const history = z.object({ kind: z.literal("newYorkEmploymentHistory"), nominalDueOn: z.iso.date(), scopeChanged: z.boolean(),
  versions: z.array(version), currentFinding: finding.nullable(), next: z.number().nullable() });
type History = z.infer<typeof history>;
type Version = z.infer<typeof version>;
type Target = { brokerageId: string; entityId: string; obligationId: string; period: string };
const resultError = z.object({ error: z.string() });
const saved = z.object({ kind: z.literal("newYorkEmploymentSaved"), version: z.number() });

async function employmentAction(input: ObligationRequest, brokerageId: string) {
  const response = await accessComplianceCases({ type: "obligations", input }, brokerageId);
  if ("error" in response) throw new Error(response.error);
  if (response.kind !== "obligations") throw new Error("Could not read the employment evidence response.");
  const error = resultError.safeParse(response.result);
  if (error.success) throw new Error(error.data.error);
  return response.result;
}

function Field({ name, label, value, date }: { name: string; label: string; value?: string; date?: boolean }) {
  return <label className="field min-w-0">{label}<input name={name} type={date ? "date" : "text"} required
    defaultValue={value} minLength={date ? undefined : 4} maxLength={date ? undefined : 240} /></label>;
}

function EventFields({ prefix, label, value }: {
  prefix: string; label: string; value?: { on: string; reference: string };
}) {
  return <div className="form-grid">
    <Field name={prefix + "On"} label={label + " date"} value={value?.on} date />
    <Field name={prefix + "Reference"} label={label + " reference"} value={value?.reference} />
  </div>;
}

function OptionalEvent({ prefix, label, value }: Parameters<typeof EventFields>[0]) {
  const [open, setOpen] = useState(Boolean(value));
  return <>
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name={prefix} checked={open}
      onChange={event => setOpen(event.target.checked)} />Record {label.toLowerCase()}</label>
    {open && <EventFields prefix={prefix} label={label} value={value} />}
  </>;
}

function EmploymentForm({ latest, busy, conflict, submit, cancel }: {
  latest?: Version; busy: boolean; conflict: boolean; submit: (form: FormData) => void; cancel: () => void;
}) {
  const evidence = latest?.evidence;
  const [rows, setRows] = useState<{ key: number; entry?: Version["evidence"]["separations"][number] }[]>(() => (evidence?.separations ?? []).map((entry, index) => ({ key: index, entry })));
  const next = useRef(rows.length);
  const addButton = useRef<HTMLButtonElement>(null);
  return <form className="record-form" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    <fieldset disabled={busy} className="record-form min-w-0">
      <label className="field">Quarter activity<select name="activity" defaultValue={evidence?.activity ?? "Needs review"}>
        {newYorkEmploymentEvidence.shape.activity.options.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <div className="form-grid">
        <Field name="roster" label="Roster reconciliation reference" value={evidence?.rosterReference} />
        <Field name="temporary" label="Temporary Authority review reference" value={evidence?.temporaryAuthorityReference} />
      </div>
      <h4 className="font-semibold">Departures and prompt notices</h4>
      {rows.map(({ key, entry }, index) => <fieldset className="record-form min-w-0 rounded-lg border p-3" key={key}>
        <legend>Departure {index + 1}</legend>
        <input type="hidden" name="row" value={key} />
        <div className="form-grid">
          <label className="field">Individual NMLS ID<input id={"ny-employment-id-" + key} name={key + "id"} required
            inputMode="numeric" pattern="[1-9][0-9]{0,11}" defaultValue={entry?.originatorNmls} /></label>
          <label className="field">Departure type<select name={key + "kind"} defaultValue={entry?.kind}>
            <option>Termination</option><option>Resignation</option><option>Dismissal for cause</option>
          </select></label>
        </div>
        <EventFields prefix={key + "event"} label="Departure" value={entry?.event} />
        <OptionalEvent prefix={key + "entity"} label="Brokerage notice" value={entry?.entityNotice} />
        <OptionalEvent prefix={key + "individual"} label="Individual notice" value={entry?.individualNotice} />
        <div><Button type="button" className="min-h-11" variant="outline" aria-label={"Remove departure " + (index + 1)}
          onClick={() => { setRows(items => items.filter(item => item.key !== key)); requestAnimationFrame(() => addButton.current?.focus()); }}>
          Remove departure</Button></div>
      </fieldset>)}
      <div><Button ref={addButton} type="button" variant="outline" className="min-h-11" disabled={rows.length >= 100}
        onClick={() => {
          const key = next.current++;
          setRows(items => [...items, { key, entry: undefined }]);
          requestAnimationFrame(() => document.getElementById("ny-employment-id-" + key)?.focus());
        }}>Add departure</Button></div>
      <h4 className="font-semibold">Quarterly filing</h4>
      <OptionalEvent prefix="report" label="Notarized report" value={evidence?.notarizedReport} />
      <OptionalEvent prefix="mail" label="Mailing" value={evidence?.mailed} />
      {latest && <Field name="correction" label="Reason for update" />}
      <div className="loan-application-actions">
        <Button type="submit" className="min-h-11" disabled={conflict}>{busy ? "Saving…" : "Save employment evidence"}</Button>
        <Button type="button" className="min-h-11" variant="outline" onClick={cancel}>Cancel</Button>
      </div>
    </fieldset>
  </form>;
}

function EmploymentSummary({ entry, review = entry.finding }: { entry: Version; review?: z.infer<typeof finding> }) {
  const { evidence } = entry;
  const dated = (event?: { on: string; reference: string }) => event ? event.on + " · " + event.reference : "No evidence recorded";
  const rows = [
    ["Quarter activity", evidence.activity],
    ["Roster reconciliation", evidence.rosterReference],
    ["Temporary Authority review", evidence.temporaryAuthorityReference],
    ["Notarized report", dated(evidence.notarizedReport)],
    ["Mailing", dated(evidence.mailed)],
    ["Recorded by", entry.actor],
    ["Reason for update", entry.correction],
  ];
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p><strong>{review.filingStatus}</strong> · Version {entry.version} · Reviewed <time dateTime={review.asOf}>{review.asOf}</time></p>
    <dl className="form-grid">{rows.filter(([, value]) => value).map(([label, value]) =>
      <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl>
    {review.verifyNoActivity && <p>Confirm DFS filing instructions for a quarter with no reportable activity.</p>}
    {evidence.separations.length > 0 && <>
      <h4 className="font-semibold">Departures and prompt notices</h4>
      <p>{review.entityNoticesMissing} missing brokerage notices · {review.individualNoticesMissing} missing individual notices</p>
      {review.verifyNoticeTiming && <p>Review prompt-notice timing using the recorded dates.</p>}
      <ul className="document-list">{evidence.separations.map((item, index) =>
        <li className="document-item" key={index}><div>
          <strong>{item.kind} · NMLS {item.originatorNmls}</strong>
          <p>{dated(item.event)}</p>
          <p>Brokerage notice · {dated(item.entityNotice)}</p>
          <p>Individual notice · {dated(item.individualNotice)}</p>
        </div></li>)}</ul>
    </>}
  </div>;
}

export function NewYorkEmploymentEvidence({ brokerageId, entityId, obligationId, period, onBack }: Target & { onBack: () => void }) {
  const [data, setData] = useState<History>();
  const [load, setLoad] = useState(0);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [conflict, setConflict] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const message = useRef<HTMLParagraphElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const retry = useRef<{ signature: string; requestId: string }>(null);
  const latest = data?.versions[0];

  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => { if (feedback) message.current?.focus(); }, [feedback]);
  useEffect(() => { if (edit) editHeading.current?.focus(); }, [edit]);
  useEffect(() => {
    let active = true;
    void employmentAction({ operation: "newYorkEmploymentHistory", entityId, id: obligationId, period }, brokerageId)
      .then(result => { if (active) setData(history.parse(result)); })
      .catch(error => { if (active) setFeedback({ text: error instanceof Error ? error.message : "Could not load employment evidence.", error: true }); });
    return () => { active = false; };
  }, [brokerageId, entityId, obligationId, period, load]);

  function reload() {
    setData(undefined);
    setFeedback(undefined);
    setEdit(false);
    setConflict(false);
    setLoad(value => value + 1);
  }

  async function loadEarlier() {
    if (!data?.next) return;
    setBusy(true);
    try {
      const older = history.parse(await employmentAction({ operation: "newYorkEmploymentHistory", entityId, id: obligationId, period, before: data.next }, brokerageId));
      setData({ ...data, versions: [...data.versions, ...older.versions], next: older.next });
      setFeedback({ text: "Earlier employment evidence loaded." });
    } catch { setFeedback({ text: "Could not load earlier employment evidence. Try again.", error: true }); }
    finally { setBusy(false); }
  }

  async function submit(form: FormData) {
    if (busy || conflict) return;
    const get = (key: string) => String(form.get(key) ?? "").trim();
    const dated = (prefix: string) => ({ on: get(prefix + "On"), reference: get(prefix + "Reference") });
    const optional = (prefix: string) => form.has(prefix) ? dated(prefix) : undefined;
    const evidence = newYorkEmploymentEvidence.safeParse({
      rosterReference: get("roster"), temporaryAuthorityReference: get("temporary"), activity: get("activity"),
      separations: form.getAll("row").map(key => ({ originatorNmls: get(key + "id"), kind: get(key + "kind"),
        event: dated(key + "event"), entityNotice: optional(key + "entity"), individualNotice: optional(key + "individual") })),
      notarizedReport: optional("report"), mailed: optional("mail"),
    });
    if (!evidence.success) {
      const issue = evidence.error.issues[0];
      setFeedback({ text: issue?.code === "custom" ? issue.message : "Check the dates and evidence references.", error: true });
      return;
    }
    const correction = get("correction");
    if (latest && correction.length < 5) { setFeedback({ text: "Enter at least five characters for the reason for update.", error: true }); return; }
    const input = { operation: "saveNewYorkEmployment" as const, entityId, id: obligationId, period, expected: latest?.version ?? 0,
      evidence: evidence.data, correction: correction || undefined };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() };
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = saved.parse(await employmentAction({ ...input, requestId: retry.current.requestId }, brokerageId));
      retry.current = null;
      reload();
      setFeedback({ text: "Employment evidence saved. Version " + result.version + "." });
    } catch (error) {
      if (error instanceof Error && /obligation changed/i.test(error.message)) {
        setConflict(true);
        setFeedback({ text: error.message, error: true });
      } else {
        const message = error instanceof Error && /already occurred|reporting quarter|quarter end/i.test(error.message) ? error.message :
          "Could not confirm the save. Retry with the same evidence.";
        setFeedback({ text: message, error: true });
      }
    } finally { setBusy(false); }
  }

  return <section className="record-form compliance-pilot-form" aria-label="New York employment evidence">
    <div className="section-heading"><h2 className="text-lg font-semibold" ref={title} tabIndex={-1}>New York employment evidence</h2>
      <Button className="min-h-11" variant="outline" disabled={busy || edit} onClick={onBack}>Back to obligation</Button></div>
    <p>Quarter starting {period}{data && <> · Nominal filing date <time className="whitespace-nowrap" dateTime={data.nominalDueOn}>{data.nominalDueOn}</time></>}</p>
    {data?.scopeChanged && <p role="status">The saved scope or source changed. Verify the reporting basis before relying on the nominal date.</p>}
    {feedback && <p ref={message} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {!data ? (feedback?.error ? <div><Button variant="outline" onClick={reload}>Reload employment evidence</Button></div> :
      <p role="status">Loading employment evidence…</p>) : edit ? <>
      <h3 ref={editHeading} tabIndex={-1}>{latest ? "Update employment evidence" : "Record employment evidence"}</h3>
      <EmploymentForm latest={latest} busy={busy} conflict={conflict} submit={form => void submit(form)} cancel={() => {
        setEdit(false); setFeedback(undefined); setConflict(false); requestAnimationFrame(() => editButton.current?.focus());
      }} />
      {conflict && <div><Button className="min-h-11" variant="outline" onClick={reload}>Reload evidence and discard draft</Button></div>}
    </> : <>
      {latest ? <EmploymentSummary entry={latest} review={data.currentFinding ?? latest.finding} /> :
        <p>No employment evidence recorded.</p>}
      <div><Button ref={editButton} className="min-h-11" onClick={() => { setFeedback(undefined); setEdit(true); }}>
        {latest ? "Update employment evidence" : "Record employment evidence"}</Button></div>
      {data.versions.slice(1).map(entry => <details key={entry.version}><summary className="min-h-11 cursor-pointer">
        Version {entry.version} · {entry.finding.filingStatus}</summary><EmploymentSummary entry={entry} /></details>)}
      {data.next && <div><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => void loadEarlier()}>Load earlier versions</Button></div>}
    </>}
  </section>;
}

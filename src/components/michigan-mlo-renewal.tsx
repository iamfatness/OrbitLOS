"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import type { ObligationRequest } from "@/lib/compliance-obligations-model";
import { michiganMloRenewalEvidence, michiganOriginatorId } from "@/lib/michigan-mlo-renewal-model";
import { Button } from "./ui/button";

const finding = z.object({
  asOf: z.iso.date(), educationStatus: z.string(), requestStatus: z.string(), feeRecorded: z.boolean(),
  bondRecorded: z.boolean(), regulatorStatus: z.string(),
});
const version = z.object({
  version: z.number(), evidence: michiganMloRenewalEvidence, finding, actor: z.string(), at: z.string(), correction: z.string().nullable(),
});
const history = z.object({
  kind: z.literal("michiganMloRenewalHistory"), nominalDueOn: z.iso.date(), scopeChanged: z.boolean(),
  versions: z.array(version), currentFinding: finding.nullable(), next: z.number().nullable(),
});
const saved = z.object({ kind: z.literal("michiganMloRenewalSaved"), version: z.number() });
const regulatorStatuses = ["Pending", "Renewed", "Expired", "Denied", "Other"];
type Entry = z.infer<typeof version>;
type Target = { brokerageId: string; entityId: string; obligationId: string; period: string };

async function renewalAction(brokerageId: string, input: ObligationRequest) {
  const response = await accessComplianceCases({ type: "obligations", input }, brokerageId);
  if ("error" in response) throw new Error(response.error);
  if (response.kind !== "obligations") throw new Error("Could not read renewal evidence.");
  const error = z.object({ error: z.string() }).safeParse(response.result);
  if (error.success) throw new Error(error.data.error);
  return response.result;
}

function DateReference({ name, dateLabel, referenceLabel, value }: {
  name: string; dateLabel: string; referenceLabel: string; value?: { on: string; reference: string };
}) {
  return <div className="form-grid">
    <label className="field">{dateLabel}<input name={name + "On"} type="date" required defaultValue={value?.on} /></label>
    <label className="field">{referenceLabel}<input name={name + "Reference"} required minLength={4} maxLength={240} defaultValue={value?.reference} /></label>
  </div>;
}

function RenewalForm({ latest, busy, conflict, onSave, onCancel }: {
  latest?: Entry; busy: boolean; conflict: boolean; onSave: (form: FormData) => void; onCancel: () => void;
}) {
  const evidence = latest?.evidence;
  const [education, setEducation] = useState(evidence?.education?.route ?? "");
  const [request, setRequest] = useState(Boolean(evidence?.request));
  const [status, setStatus] = useState(evidence?.regulatorStatus?.status ?? "");
  return <form className="record-form" onSubmit={event => { event.preventDefault(); onSave(new FormData(event.currentTarget)); }}>
    <fieldset disabled={busy} className="record-form">
      <label className="field">Education evidence<select value={education} onChange={event => setEducation(event.target.value)}>
        <option value="">No education evidence</option>
        <option>Continuing education</option><option>First-year exception</option>
      </select></label>
      {education && <DateReference key={education} name="education"
        dateLabel={education === "Continuing education" ? "Continuing education completion date" : "Prelicensure education completion date"}
        referenceLabel="Education evidence reference" value={evidence?.education?.route === education ? evidence.education : undefined} />}
      {education === "First-year exception" && <DateReference name="issued" dateLabel="Initial Michigan license date"
        referenceLabel="Initial license evidence reference" value={evidence?.education?.route === education ? evidence.education.issued : undefined} />}
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={request}
        onChange={event => setRequest(event.target.checked)} />Record NMLS renewal request</label>
      {request && <DateReference name="request" dateLabel="NMLS request date" referenceLabel="NMLS request receipt reference" value={evidence?.request} />}
      {education === "Continuing education" && request && <div className="field">
        <label htmlFor="mi-mlo-sequence">Same-day sequence evidence (optional)</label>
        <input id="mi-mlo-sequence" name="sequence" minLength={4} maxLength={240} aria-describedby="mi-mlo-sequence-help"
          defaultValue={evidence?.education?.route === education ? evidence.education.sameDaySequenceReference : undefined} />
        <span className="muted" id="mi-mlo-sequence-help">For matching dates, cite evidence that education was completed before the request.</span>
      </div>}
      <div className="form-grid">
        <label className="field">Fee payment evidence (optional)<input name="fee" minLength={4} maxLength={240} defaultValue={evidence?.feeReference} /></label>
        <label className="field">Bond evidence (optional)<input name="bond" minLength={4} maxLength={240} defaultValue={evidence?.bondReference} /></label>
      </div>
      <label className="field">Recorded regulator status<select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">No regulator status recorded</option>{regulatorStatuses.map(item => <option key={item}>{item}</option>)}
      </select></label>
      {status && <DateReference name="status" dateLabel="Status verification date" referenceLabel="Regulator status evidence reference" value={evidence?.regulatorStatus} />}
      {latest && <label className="field">Reason for update<input name="correction" required minLength={5} maxLength={1500} /></label>}
      <input type="hidden" name="educationRoute" value={education} />
      <input type="hidden" name="regulatorStatus" value={status} />
      <div className="loan-application-actions">
        <Button className="min-h-11" type="submit" disabled={conflict}>{busy ? "Saving…" : "Save renewal evidence"}</Button>
        <Button className="min-h-11" type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </fieldset>
  </form>;
}

function parseEvidence(form: FormData) {
  const get = (key: string) => String(form.get(key) ?? "").trim();
  const dated = (key: string) => ({ on: get(key + "On"), reference: get(key + "Reference") });
  const route = get("educationRoute");
  const status = get("regulatorStatus");
  return michiganMloRenewalEvidence.safeParse({
    education: route ? { route, ...dated("education"), ...(route === "First-year exception" ?
      { issued: dated("issued") } : { sameDaySequenceReference: get("sequence") || undefined }) } : undefined,
    request: form.has("requestOn") ? dated("request") : undefined,
    feeReference: get("fee") || undefined, bondReference: get("bond") || undefined,
    regulatorStatus: status ? { status, ...dated("status") } : undefined,
  });
}

function RenewalSummary({ entry, current }: { entry: Entry; current?: z.infer<typeof finding> | null }) {
  const review = current ?? entry.finding;
  const { education, request, regulatorStatus, feeReference, bondReference } = entry.evidence;
  const dated = (value?: { on: string; reference: string }) => value ? [value.on, value.reference] : [];
  const rows = [
    ["Education", review.educationStatus, ...dated(education), education?.route === "Continuing education" ? education.sameDaySequenceReference : undefined],
    ["Initial Michigan license", ...dated(education?.route === "First-year exception" ? education.issued : undefined)],
    ["NMLS request", review.requestStatus, ...dated(request)],
    ["Fee payment", feeReference ?? "No evidence recorded"],
    ["Bond", bondReference ?? "No evidence recorded"],
    ["Regulator status", review.regulatorStatus, ...dated(regulatorStatus)],
    ["Recorded by", entry.actor, entry.at.slice(0, 10)],
    ["Reason for update", entry.correction],
  ];
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p>Version {entry.version} · Reviewed <time dateTime={review.asOf}>{review.asOf}</time></p>
    <dl className="form-grid">{rows.map(([label, ...values]) => values.some(Boolean) &&
      <div key={label}><dt className="font-semibold">{label}</dt><dd>{values.filter(Boolean).join(" · ")}</dd></div>)}</dl>
  </div>;
}

function OriginatorEvidence({ brokerageId, entityId, obligationId, period, originatorNmls, onChange, edit, setEdit }: Target & {
  originatorNmls: string; onChange: () => void; edit: boolean; setEdit: (value: boolean) => void;
}) {
  const [data, setData] = useState<z.infer<typeof history>>();
  const [load, setLoad] = useState(0);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const heading = useRef<HTMLHeadingElement>(null);
  const message = useRef<HTMLParagraphElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const retry = useRef<{ signature: string; id: string }>(null);
  const latest = data?.versions[0];

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (feedback) message.current?.focus(); }, [feedback]);
  useEffect(() => { if (edit) editHeading.current?.focus(); }, [edit]);
  useEffect(() => {
    let active = true;
    void renewalAction(brokerageId, { operation: "michiganMloRenewalHistory", entityId, id: obligationId, period, originatorNmls })
      .then(result => { if (active) setData(history.parse(result)); })
      .catch(() => { if (active) setFeedback({ text: "Could not load renewal evidence. Try again.", error: true }); });
    return () => { active = false; };
  }, [brokerageId, entityId, obligationId, period, originatorNmls, load]);

  function reload() {
    setData(undefined);
    setConflict(false);
    setEdit(false);
    setLoad(value => value + 1);
  }

  async function loadEarlier() {
    if (!data?.next) return;
    setBusy(true);
    try {
      const older = history.parse(await renewalAction(brokerageId, { operation: "michiganMloRenewalHistory",
        entityId, id: obligationId, period, originatorNmls, before: data.next }));
      setData({ ...data, versions: [...data.versions, ...older.versions], next: older.next });
      setFeedback({ text: "Earlier renewal evidence loaded." });
    } catch {
      setFeedback({ text: "Could not load earlier versions. Try again.", error: true });
    } finally { setBusy(false); }
  }

  async function submit(form: FormData) {
    if (busy || conflict) return;
    const evidence = parseEvidence(form);
    if (!evidence.success) {
      setFeedback({ text: evidence.error.issues[0]?.message ?? "Check the dates and evidence references.", error: true });
      return;
    }
    const input = { operation: "saveMichiganMloRenewal" as const, entityId, id: obligationId, period, originatorNmls,
      expected: latest?.version ?? 0, evidence: evidence.data, correction: String(form.get("correction") ?? "").trim() || undefined };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = saved.parse(await renewalAction(brokerageId, { ...input, requestId: retry.current.id }));
      retry.current = null;
      reload();
      setFeedback({ text: "Renewal evidence saved. Version " + result.version + "." });
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (/obligation changed/i.test(text)) setConflict(true);
      setFeedback({ text: /obligation changed|already occurred|renewal year|cannot precede|reason for updating/.test(text.toLowerCase()) ? text :
        "Could not confirm the save. Retry with the same evidence.", error: true });
    } finally { setBusy(false); }
  }

  return <>
    <div className="section-heading"><h3 ref={heading} tabIndex={-1}>Individual NMLS ID {originatorNmls}</h3>
      <Button className="min-h-11" variant="outline" disabled={busy || edit} onClick={onChange}>Change originator</Button></div>
    {data && <p>Nominal renewal date <time dateTime={data.nominalDueOn}>{data.nominalDueOn}</time></p>}
    {data?.scopeChanged && <p role="status">The saved Michigan scope or source changed. Review applicability and the current deadline.</p>}
    {feedback && <p ref={message} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {!data ? (feedback?.error ? <div><Button variant="outline" onClick={() => { setFeedback(undefined); reload(); }}>Reload renewal evidence</Button></div> :
      <p role="status">Loading renewal evidence…</p>) : edit ? <>
      <h4 ref={editHeading} tabIndex={-1}>{latest ? "Update renewal evidence" : "Record renewal evidence"}</h4>
      <RenewalForm latest={latest} busy={busy} conflict={conflict} onSave={form => void submit(form)} onCancel={() => {
        setEdit(false); setConflict(false); setFeedback(undefined); requestAnimationFrame(() => editButton.current?.focus());
      }} />
      {conflict && <div><Button className="min-h-11" variant="outline" onClick={() => { setFeedback(undefined); reload(); }}>
        Reload evidence and discard draft</Button></div>}
    </> : <>
      {latest ? <RenewalSummary entry={latest} current={data.currentFinding} /> : <p>No renewal evidence recorded for this originator.</p>}
      <div><Button ref={editButton} className="min-h-11" onClick={() => { setFeedback(undefined); setEdit(true); }}>
        {latest ? "Update renewal evidence" : "Record renewal evidence"}</Button></div>
      {data.versions.slice(1).map(entry => <details key={entry.version}>
        <summary className="min-h-11 cursor-pointer">Version {entry.version} · {entry.finding.regulatorStatus}</summary>
        <RenewalSummary entry={entry} />
      </details>)}
      {data.next && <div><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => void loadEarlier()}>
        Load earlier versions</Button></div>}
    </>}
  </>;
}

export function MichiganMloRenewal({ entityName, onBack, ...target }: Target & { entityName: string; onBack: () => void }) {
  const [originator, setOriginator] = useState("");
  const [edit, setEdit] = useState(false);
  const [inputError, setInputError] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { title.current?.focus(); }, []);

  function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = michiganOriginatorId.safeParse(new FormData(event.currentTarget).get("originator"));
    if (parsed.success) { setOriginator(parsed.data); setInputError(""); }
    else { setInputError("Enter the individual NMLS ID using digits."); input.current?.focus(); }
  }

  return <section className="record-form compliance-pilot-form" aria-label="Michigan renewal evidence">
    <div className="section-heading"><h2 className="text-lg font-semibold" ref={title} tabIndex={-1}>Michigan renewal evidence</h2>
      <Button className="min-h-11" variant="outline" disabled={edit} onClick={onBack}>Back to obligation</Button></div>
    <p className="[overflow-wrap:anywhere]">{entityName} · {target.period.slice(0, 4)} renewal year</p>
    {originator ? <OriginatorEvidence key={originator} {...target} originatorNmls={originator} edit={edit} setEdit={setEdit} onChange={() => {
      setOriginator(""); requestAnimationFrame(() => input.current?.focus());
    }} /> : <form className="record-form" onSubmit={open}>
      <label className="field">Individual NMLS ID<input ref={input} name="originator" required inputMode="numeric" maxLength={12}
        aria-invalid={Boolean(inputError)} aria-describedby={inputError ? "mi-mlo-id-error" : undefined} /></label>
      {inputError && <p id="mi-mlo-id-error" role="alert">{inputError}</p>}
      <div><Button className="min-h-11" type="submit">Open renewal evidence</Button></div>
    </form>}
  </section>;
}

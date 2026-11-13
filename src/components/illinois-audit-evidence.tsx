"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import { illinoisAuditEvidence } from "@/lib/illinois-audit-evidence-model";
import type { ObligationRequest } from "@/lib/compliance-obligations-model";
import { Button } from "./ui/button";

const finding = z.object({ asOf: z.iso.date(), requestDueOn: z.iso.date(), dueOn: z.iso.date(),
  requestStatus: z.string(), filingStatus: z.string(), extensionStatus: z.string() });
const version = z.object({ version: z.number(), evidence: illinoisAuditEvidence, finding, actor: z.string(), correction: z.string().nullable() });
const history = z.object({ kind: z.literal("illinoisAuditHistory"), nominalDueOn: z.iso.date(),
  versions: z.array(version), currentFinding: finding.nullable(), next: z.number().nullable() });
type History = z.infer<typeof history>;
type Version = z.infer<typeof version>;
type Target = { brokerageId: string; entityId: string; obligationId: string; period: string };
const resultError = z.object({ error: z.string() });
const saved = z.object({ kind: z.literal("illinoisAuditSaved"), version: z.number() });

async function auditAction(input: ObligationRequest, brokerageId: string) {
  const response = await accessComplianceCases({ type: "obligations", input }, brokerageId);
  if ("error" in response) throw new Error(response.error);
  if (response.kind !== "obligations") throw new Error("Could not read the audit evidence response.");
  const error = resultError.safeParse(response.result);
  if (error.success) throw new Error(error.data.error);
  return response.result;
}

function Field({ name, label, value, date }: { name: string; label: string; value?: string; date?: boolean }) {
  return <label className="field min-w-0">{label}<input name={name} type={date ? "date" : "text"} required
    defaultValue={value} minLength={date ? undefined : 4} maxLength={date ? undefined : 240} /></label>;
}

function AuditForm({ latest, nominal, busy, submit }: { latest?: Version; nominal: string; busy: boolean; submit: (form: FormData) => void }) {
  const facts = latest?.evidence;
  const [extension, setExtension] = useState(Boolean(facts?.extension));
  const [decision, setDecision] = useState(facts?.extension?.decision?.result ?? "");
  const [filing, setFiling] = useState(Boolean(facts?.filing));
  return <form className="record-form" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    <fieldset className="record-form min-w-0" disabled={busy}>
      <div className="form-grid">
        <Field name="originalOn" label="Reviewed original audit deadline" date value={facts?.originalDeadline.on ?? nominal} />
        <Field name="originalReference" label="Deadline evidence" value={facts?.originalDeadline.reference} />
      </div>
      <label className="flex min-h-11 items-center gap-2"><input name="extension" type="checkbox" checked={extension}
        onChange={event => setExtension(event.target.checked)} /> Record written extension request</label>
      {extension && <div className="form-grid">
        <Field name="requestOn" label="Date request was provided" date value={facts?.extension?.request.on} />
        <Field name="requestReference" label="Written request and delivery evidence" value={facts?.extension?.request.reference} />
        <label className="field min-w-0">Grounds for extension<textarea name="grounds" required rows={2} minLength={4} maxLength={240}
          defaultValue={facts?.extension?.grounds} /></label>
        <label className="field">Regulator decision<select name="decision" value={decision}
          onChange={event => setDecision(event.target.value === "Granted" ? "Granted" : event.target.value === "Denied" ? "Denied" : "")}>
          <option value="">Pending decision</option><option>Denied</option><option>Granted</option></select></label>
        {decision && <>
          <Field name="decisionOn" label="Decision date" date value={facts?.extension?.decision?.on} />
          <Field name="decisionReference" label="Written decision evidence" value={facts?.extension?.decision?.reference} />
          {decision === "Granted" && <Field name="dueOn" label="Deadline in written approval" date
            value={facts?.extension?.decision?.result === "Granted" ? facts.extension.decision.dueOn : undefined} />}
        </>}
      </div>}
      <label className="flex min-h-11 items-center gap-2"><input name="filing" type="checkbox" checked={filing}
        onChange={event => setFiling(event.target.checked)} /> Record audit filing</label>
      {filing && <div className="form-grid">
        <Field name="filingOn" label="Filing date" date value={facts?.filing?.on} />
        <Field name="filingReference" label="Filing receipt reference" value={facts?.filing?.reference} />
      </div>}
      {latest && <Field name="correction" label="Reason for update" />}
      <div><Button className="min-h-11" type="submit">{busy ? "Saving…" : "Save audit evidence"}</Button></div>
    </fieldset>
  </form>;
}

function AuditSummary({ entry, review = entry.finding }: { entry: Version; review?: Version["finding"] }) {
  const { evidence } = entry;
  const lines = [
    ["Original deadline", evidence.originalDeadline.on, evidence.originalDeadline.reference],
    ["Extension request deadline", review.requestDueOn, review.requestStatus],
    ["Effective filing deadline", review.dueOn, review.filingStatus],
    ["Request evidence", evidence.extension?.request.on, evidence.extension?.request.reference],
    ["Grounds", evidence.extension?.grounds],
    ["Regulator decision", review.extensionStatus, evidence.extension?.decision?.on, evidence.extension?.decision?.reference],
    ["Filing receipt", evidence.filing?.on, evidence.filing?.reference],
    ["Reason for update", entry.correction],
  ];
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p>Version {entry.version} · Reviewed <time className="whitespace-nowrap" dateTime={review.asOf}>{review.asOf}</time></p>
    <dl className="form-grid">{lines.filter(([, value]) => value).map(([label, ...values]) =>
      <div key={label}><dt className="font-semibold">{label}</dt><dd>{values.filter(Boolean).join(" · ")}</dd></div>)}</dl>
  </div>;
}

export function IllinoisAuditEvidence({ brokerageId, entityId, obligationId, period, onBack }: Target & { onBack: () => void }) {
  const [data, setData] = useState<History>();
  const [load, setLoad] = useState(0);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [conflict, setConflict] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const message = useRef<HTMLParagraphElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const retry = useRef<{ signature: string; requestId: string }>(null);
  const latest = data?.versions[0];

  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => { if (feedback) message.current?.focus(); }, [feedback]);
  useEffect(() => { if (edit) editHeading.current?.focus(); }, [edit]);
  useEffect(() => {
    let active = true;
    void auditAction({ operation: "illinoisAuditHistory", entityId, id: obligationId, period }, brokerageId)
      .then(result => { if (active) setData(history.parse(result)); })
      .catch(error => { if (active) setFeedback({ text: error instanceof Error ? error.message : "Could not load audit evidence.", error: true }); });
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
      const older = history.parse(await auditAction({ operation: "illinoisAuditHistory", entityId, id: obligationId, period, before: data.next }, brokerageId));
      setData({ ...data, versions: [...data.versions, ...older.versions], next: older.next });
      setFeedback({ text: "Earlier audit evidence loaded." });
    } catch { setFeedback({ text: "Could not load earlier audit evidence. Try again.", error: true }); }
    finally { setBusy(false); }
  }

  async function submit(form: FormData) {
    if (busy || conflict) return;
    const get = (key: string) => String(form.get(key) ?? "").trim();
    const decision = get("decision");
    const evidence = illinoisAuditEvidence.safeParse({
      originalDeadline: { on: get("originalOn"), reference: get("originalReference") },
      extension: form.has("extension") ? { request: { on: get("requestOn"), reference: get("requestReference") }, grounds: get("grounds"),
        decision: decision ? { result: decision, on: get("decisionOn"), reference: get("decisionReference"),
          ...(decision === "Granted" ? { dueOn: get("dueOn") } : {}) } : undefined } : undefined,
      filing: form.has("filing") ? { on: get("filingOn"), reference: get("filingReference") } : undefined,
    });
    if (!evidence.success) {
      const issue = evidence.error.issues[0];
      setFeedback({ text: issue?.code === "custom" ? issue.message : "Check the dates and evidence references.", error: true });
      return;
    }
    const correction = get("correction");
    if (latest && correction.length < 5) { setFeedback({ text: "Enter at least five characters for the reason for update.", error: true }); return; }
    const input = { operation: "saveIllinoisAudit" as const, entityId, id: obligationId, period, expected: latest?.version ?? 0,
      evidence: evidence.data, correction: correction || undefined };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() };
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = saved.parse(await auditAction({ ...input, requestId: retry.current.requestId }, brokerageId));
      retry.current = null;
      reload();
      setFeedback({ text: "Audit evidence saved. Version " + result.version + "." });
    } catch (error) {
      if (error instanceof Error && /obligation changed/i.test(error.message)) {
        setConflict(true);
        setFeedback({ text: error.message, error: true });
      } else {
        const message = error instanceof Error && /already occurred|fiscal year end/i.test(error.message) ? error.message :
          "Could not confirm the save. Retry with the same evidence.";
        setFeedback({ text: message, error: true });
      }
    } finally { setBusy(false); }
  }

  return <section className="record-form compliance-pilot-form" aria-label="Illinois audit evidence">
    <div className="section-heading"><h2 className="text-lg font-semibold" ref={title} tabIndex={-1}>Illinois audit evidence</h2>
      <Button className="min-h-11" variant="outline" disabled={busy} onClick={onBack}>Back to obligation</Button></div>
    <p>Fiscal period starting {period}{data && <> · Nominal filing date <time className="whitespace-nowrap" dateTime={data.nominalDueOn}>{data.nominalDueOn}</time></>}</p>
    {feedback && <p ref={message} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {!data ? (feedback?.error ? <div><Button variant="outline" onClick={reload}>Reload audit evidence</Button></div> :
      <p role="status">Loading audit evidence…</p>) : edit ? <>
      <h3 ref={editHeading} tabIndex={-1}>{latest ? "Update audit evidence" : "Record audit evidence"}</h3>
      <AuditForm latest={latest} nominal={data.nominalDueOn} busy={busy} submit={form => void submit(form)} />
      {conflict && <div><Button className="min-h-11" variant="outline" onClick={reload}>Reload evidence and discard draft</Button></div>}
    </> : <>
      {latest ? <AuditSummary entry={latest} review={data.currentFinding ?? latest.finding} /> :
        <p>No audit evidence recorded.</p>}
      <div><Button className="min-h-11" onClick={() => { setFeedback(undefined); setEdit(true); }}>
        {latest ? "Update audit evidence" : "Record audit evidence"}</Button></div>
      {data.versions.slice(1).map(entry => <details key={entry.version}><summary className="min-h-11 cursor-pointer">
        Version {entry.version} · {entry.finding.filingStatus}</summary><AuditSummary entry={entry} /></details>)}
      {data.next && <div><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => void loadEarlier()}>Load earlier versions</Button></div>}
    </>}
  </section>;
}

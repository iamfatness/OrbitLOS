"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import { coloradoCompanyRenewalEvidence, coloradoRenewalReportingPeriods } from "@/lib/colorado-company-renewal-model";
import type { ObligationRequest } from "@/lib/compliance-obligations-model";
import { Button } from "./ui/button";

const finding = z.object({ asOf: z.iso.date(), rows: z.array(z.object({
  component: z.string(), period: z.string(), through: z.iso.date(), nominalDueOn: z.iso.date().nullable(), timing: z.string(),
})), classificationNeedsReview: z.boolean(), renewalStatus: z.string(), requestRecorded: z.boolean() });
const version = z.object({ version: z.number(), evidence: coloradoCompanyRenewalEvidence, finding, actor: z.string(), correction: z.string().nullable() });
const history = z.object({ kind: z.literal("coloradoCompanyRenewalHistory"), nominalDueOn: z.iso.date(), scopeChanged: z.boolean(),
  versions: z.array(version), currentFinding: finding.nullable(), next: z.number().nullable() });
type History = z.infer<typeof history>;
type Version = z.infer<typeof version>;
type Target = { brokerageId: string; entityId: string; obligationId: string; period: string };
const resultError = z.object({ error: z.string() });
const saved = z.object({ kind: z.literal("coloradoCompanyRenewalSaved"), version: z.number() });

async function renewalAction(input: ObligationRequest, brokerageId: string) {
  const response = await accessComplianceCases({ type: "obligations", input }, brokerageId);
  if ("error" in response) throw new Error(response.error);
  if (response.kind !== "obligations") throw new Error("Could not read the renewal evidence response.");
  const error = resultError.safeParse(response.result);
  if (error.success) throw new Error(error.data.error);
  return response.result;
}

function Field({ name, label, value, date, optional }: { name: string; label: string; value?: string; date?: boolean; optional?: boolean }) {
  return <label className="field min-w-0">{label}<input name={name} type={date ? "date" : "text"} required={!optional}
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

const classifications = coloradoCompanyRenewalEvidence.shape.classification.options;
const regulatorStatuses = ["Pending", "Renewed", "Expired", "Denied", "Other"];

function ReceiptFields({ row, initial }: {
  row: ReturnType<typeof coloradoRenewalReportingPeriods>[number];
  initial?: Version["evidence"]["receipts"][number]["disposition"];
}) {
  const prefix = row.component + ":" + row.period;
  const [status, setStatus] = useState(initial?.status ?? "");
  return <fieldset className="record-form min-w-0 rounded-lg border p-3">
    <legend>{row.component} · {row.period}</legend>
    <input type="hidden" name="receiptKey" value={prefix} />
    <label className="field">Filing evidence<select name={prefix + "status"} value={status} onChange={event => setStatus(event.target.value as typeof status)}>
      <option value="">Awaiting evidence</option><option>Filed</option><option>Not applicable</option>
    </select></label>
    {status === "Filed" && <EventFields prefix={prefix} label="Filing receipt" value={initial?.status === "Filed" ? initial.receipt : undefined} />}
    {status === "Not applicable" && <Field name={prefix + "Reference"} label="Exclusion reference" value={initial?.status === "Not applicable" ? initial.reference : undefined} />}
  </fieldset>;
}

function RenewalForm({ latest, year, busy, conflict, submit, cancel }: {
  latest?: Version; year: number; busy: boolean; conflict: boolean; submit: (form: FormData) => void; cancel: () => void;
}) {
  const evidence = latest?.evidence;
  const [classification, setClassification] = useState(evidence?.classification ?? "Needs review");
  const [requested, setRequested] = useState(Boolean(evidence?.renewalRequest));
  const [status, setStatus] = useState(evidence?.regulatorStatus?.status ?? "");
  const rows = coloradoRenewalReportingPeriods(year, classification);
  return <form className="record-form" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    <fieldset disabled={busy} className="record-form min-w-0">
      <label className="field">Reporting classification<select name="classification" value={classification}
        onChange={event => setClassification(event.target.value as typeof classification)}>
        {classifications.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <div className="form-grid">
        <Field name="classificationReference" label="Classification evidence reference" value={evidence?.classificationReference} />
        <Field name="filingInventoryReference" label="NMLS filing inventory reference" value={evidence?.filingInventoryReference} />
      </div>
      {classification === "Broker only" && <label className="field">Prior fiscal year end (optional)
        <input name="priorFiscalYearEnd" type="date" defaultValue={evidence?.priorFiscalYearEnd} /></label>}
      <h4 className="font-semibold">Reporting periods</h4>
      {rows.map(row => <ReceiptFields key={row.component + ":" + row.period} row={row}
        initial={evidence?.receipts.find(item => item.component === row.component && item.period === row.period)?.disposition} />)}
      <h4 className="font-semibold">Renewal and regulator status</h4>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="renewal" checked={requested}
        onChange={event => setRequested(event.target.checked)} />Record renewal request</label>
      {requested && <EventFields prefix="renewal" label="Renewal request" value={evidence?.renewalRequest} />}
      <label className="field">Recorded regulator status<select name="regulatorStatus" value={status} onChange={event => setStatus(event.target.value as typeof status)}>
        <option value="">No regulator status recorded</option>{regulatorStatuses.map(value => <option key={value}>{value}</option>)}
      </select></label>
      {status && <EventFields prefix="status" label="Regulator status" value={evidence?.regulatorStatus} />}
      {latest && <Field name="correction" label="Reason for update" />}
      <div className="loan-application-actions">
        <Button type="submit" className="min-h-11" disabled={conflict}>{busy ? "Saving…" : "Save renewal evidence"}</Button>
        <Button type="button" className="min-h-11" variant="outline" onClick={cancel}>Cancel</Button>
      </div>
    </fieldset>
  </form>;
}

function RenewalSummary({ entry, review = entry.finding }: { entry: Version; review?: z.infer<typeof finding> }) {
  const { evidence } = entry;
  const dated = (event?: { on: string; reference: string }) => event ? event.on + " · " + event.reference : "No evidence recorded";
  const summary = [
    ["Reporting classification", evidence.classification + " · " + evidence.classificationReference],
    ["NMLS filing inventory", evidence.filingInventoryReference],
    ["Prior fiscal year end", evidence.priorFiscalYearEnd],
    ["Renewal request", dated(evidence.renewalRequest)],
    ["Regulator status", evidence.regulatorStatus ? review.renewalStatus + " · " + dated(evidence.regulatorStatus) : review.renewalStatus],
    ["Recorded by", entry.actor], ["Reason for update", entry.correction],
  ];
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p>Version {entry.version} · Reviewed <time dateTime={review.asOf}>{review.asOf}</time></p>
    <dl className="form-grid">{summary.filter(([, value]) => value).map(([label, value]) =>
      <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl>
    {review.classificationNeedsReview && <p>Verify Financial Condition requirements for the company’s reporting classification.</p>}
    <h4 className="font-semibold">Reporting periods</h4>
    <ul className="document-list">{review.rows.map(row => {
      const receipt = evidence.receipts.find(item => item.component === row.component && item.period === row.period)?.disposition;
      return <li className="document-item" key={row.component + ":" + row.period}><div>
        <strong>{row.component} · {row.period}</strong>
        <p>{row.timing}{row.nominalDueOn && <> · Nominal date {row.nominalDueOn}</>}</p>
        {receipt && <p>{receipt.status === "Filed" ? dated(receipt.receipt) : receipt.reference}</p>}
      </div></li>;
    })}</ul>
  </div>;
}

export function ColoradoCompanyRenewal({ brokerageId, entityId, obligationId, period, onBack }: Target & { onBack: () => void }) {
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
    void renewalAction({ operation: "coloradoCompanyRenewalHistory", entityId, id: obligationId, period }, brokerageId)
      .then(result => { if (active) setData(history.parse(result)); })
      .catch(error => { if (active) setFeedback({ text: error instanceof Error ? error.message : "Could not load renewal evidence.", error: true }); });
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
      const older = history.parse(await renewalAction({ operation: "coloradoCompanyRenewalHistory", entityId, id: obligationId, period, before: data.next }, brokerageId));
      setData({ ...data, versions: [...data.versions, ...older.versions], next: older.next });
      setFeedback({ text: "Earlier renewal evidence loaded." });
    } catch { setFeedback({ text: "Could not load earlier renewal evidence. Try again.", error: true }); }
    finally { setBusy(false); }
  }

  async function submit(form: FormData) {
    if (busy || conflict) return;
    const get = (key: string) => String(form.get(key) ?? "").trim();
    const dated = (prefix: string) => ({ on: get(prefix + "On"), reference: get(prefix + "Reference") });
    const regulatorStatus = get("regulatorStatus");
    const receipts = form.getAll("receiptKey").flatMap(key => {
      const prefix = String(key);
      const [component, period] = prefix.split(":");
      const status = get(prefix + "status");
      return status ? [{ component, period, disposition: status === "Filed" ?
        { status, receipt: dated(prefix) } : { status, reference: get(prefix + "Reference") } }] : [];
    });
    const evidence = coloradoCompanyRenewalEvidence.safeParse({
      classification: get("classification"), classificationReference: get("classificationReference"),
      filingInventoryReference: get("filingInventoryReference"), priorFiscalYearEnd: get("priorFiscalYearEnd") || undefined, receipts,
      renewalRequest: form.has("renewal") ? dated("renewal") : undefined,
      regulatorStatus: regulatorStatus ? { status: regulatorStatus, ...dated("status") } : undefined,
    });
    if (!evidence.success) {
      const issue = evidence.error.issues[0];
      setFeedback({ text: issue?.code === "custom" ? issue.message : "Check the dates and evidence references.", error: true });
      return;
    }
    const correction = get("correction");
    if (latest && correction.length < 5) { setFeedback({ text: "Enter at least five characters for the reason for update.", error: true }); return; }
    const input = { operation: "saveColoradoCompanyRenewal" as const, entityId, id: obligationId, period, expected: latest?.version ?? 0,
      evidence: evidence.data, correction: correction || undefined };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() };
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = saved.parse(await renewalAction({ ...input, requestId: retry.current.requestId }, brokerageId));
      retry.current = null;
      reload();
      setFeedback({ text: "Renewal evidence saved. Version " + result.version + "." });
    } catch (error) {
      if (error instanceof Error && /obligation changed/i.test(error.message)) {
        setConflict(true);
        setFeedback({ text: error.message, error: true });
      } else {
        const message = error instanceof Error && /filing component|filing receipt|dates and order/i.test(error.message) ? error.message :
          "Could not confirm the save. Retry with the same evidence.";
        setFeedback({ text: message, error: true });
      }
    } finally { setBusy(false); }
  }

  return <section className="record-form compliance-pilot-form" aria-label="Colorado company renewal evidence">
    <div className="section-heading"><h2 className="text-lg font-semibold" ref={title} tabIndex={-1}>Colorado company renewal evidence</h2>
      <Button className="min-h-11" variant="outline" disabled={busy || edit} onClick={onBack}>Back to obligation</Button></div>
    <p>Renewal year {period.slice(0, 4)}{data && <> · Nominal filing date <time className="whitespace-nowrap" dateTime={data.nominalDueOn}>{data.nominalDueOn}</time></>}</p>
    {data?.scopeChanged && <p role="status">The saved scope or source changed. Verify the renewal basis before relying on the nominal date.</p>}
    {feedback && <p ref={message} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {!data ? (feedback?.error ? <div><Button variant="outline" onClick={reload}>Reload renewal evidence</Button></div> :
      <p role="status">Loading renewal evidence…</p>) : edit ? <>
      <h3 ref={editHeading} tabIndex={-1}>{latest ? "Update renewal evidence" : "Record renewal evidence"}</h3>
      <RenewalForm latest={latest} year={Number(period.slice(0, 4))} busy={busy} conflict={conflict} submit={form => void submit(form)} cancel={() => {
        setEdit(false); setFeedback(undefined); setConflict(false); requestAnimationFrame(() => editButton.current?.focus());
      }} />
      {conflict && <div><Button className="min-h-11" variant="outline" onClick={reload}>Reload evidence and discard draft</Button></div>}
    </> : <>
      {latest ? <RenewalSummary entry={latest} review={data.currentFinding ?? latest.finding} /> :
        <p>No renewal evidence recorded.</p>}
      <div><Button ref={editButton} disabled={busy} className="min-h-11" onClick={() => { setFeedback(undefined); setEdit(true); }}>
        {latest ? "Update renewal evidence" : "Record renewal evidence"}</Button>
      </div>
      {data.versions.slice(1).map(entry => <details key={entry.version}><summary className="min-h-11 cursor-pointer">
        Version {entry.version} · {entry.finding.renewalStatus}</summary><RenewalSummary entry={entry} /></details>)}
      {data.next && <div><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => void loadEarlier()}>Load earlier versions</Button></div>}
    </>}
  </section>;
}

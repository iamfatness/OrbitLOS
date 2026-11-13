"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import type { ObligationRequest } from "@/lib/compliance-obligations-model";
import { newYorkVoorEvidence } from "@/lib/new-york-voor-model";
import { Button } from "./ui/button";

const finding = z.object({ asOf: z.iso.date(), dueOn: z.iso.date().nullable(), initialTiming: z.string(), gaps: z.array(z.string()) });
const version = z.object({ version: z.number(), evidence: newYorkVoorEvidence, finding, actor: z.string(), correction: z.string().nullable() });
const history = z.object({ kind: z.literal("newYorkVoorHistory"), reportYear: z.number(), authority: z.string(), scopeChanged: z.boolean(),
  nominalDueOn: z.iso.date().nullable(), versions: z.array(version), currentFinding: finding.nullable(), next: z.number().nullable() });
const saved = z.object({ kind: z.literal("newYorkVoorSaved"), version: z.number() });
type History = z.infer<typeof history>;
type Version = z.infer<typeof version>;
type Target = { brokerageId: string; entityId: string; obligationId: string; period: string };

async function filingAction(input: ObligationRequest, brokerageId: string) {
  const response = await accessComplianceCases({ type: "obligations", input }, brokerageId);
  if ("error" in response) throw new Error(response.error);
  if (response.kind !== "obligations") throw new Error("Could not read the filing evidence response.");
  const error = z.object({ error: z.string() }).safeParse(response.result);
  if (error.success) throw new Error(error.data.error);
  return response.result;
}

function Field({ name, label, value, type = "text", optional = false }: {
  name: string; label: string; value?: string; type?: "text" | "date" | "url"; optional?: boolean;
}) {
  return <label className="field min-w-0">{label}<input name={name} type={type} required={!optional} defaultValue={value}
    minLength={type === "text" ? 5 : undefined} maxLength={type === "url" ? 2000 : type === "text" ? 1500 : undefined} /></label>;
}
function Select({ name, label, value, options }: { name: string; label: string; value?: string; options: readonly string[] }) {
  return <label className="field min-w-0">{label}<select name={name} required defaultValue={value ?? ""}>
    <option value="" disabled>Select an option</option>{options.map(item => <option key={item}>{item}</option>)}
  </select></label>;
}
function EvidenceGroup({ name, label, recorded, children }: {
  name: string; label: string; recorded: boolean; children: ReactNode;
}) {
  const [enabled, setEnabled] = useState(recorded);
  return <div className="record-form">
    <label className="flex min-h-11 items-center gap-2"><input name={name} type="checkbox" checked={enabled}
      onChange={event => setEnabled(event.target.checked)} /> {label}</label>
    <fieldset className={enabled ? "form-grid min-w-0" : "hidden"} disabled={!enabled}>{children}</fieldset>
  </div>;
}
const routes = ["DFS Portal", "Mail"] as const;

function FilingForm({ latest, nominal, busy, conflict, submit, cancel }: {
  latest?: Version; nominal: string | null; busy: boolean; conflict: boolean; submit: (form: FormData) => void; cancel: () => void;
}) {
  const facts = latest?.evidence;
  return <form className="record-form" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    <fieldset className="record-form min-w-0" disabled={busy}>
      <EvidenceGroup name="instructions" label="Record reviewed filing instructions" recorded={Boolean(facts?.reviewedInstructions)}>
        <Field name="deadline" label="Reviewed filing deadline" type="date" value={facts?.reviewedInstructions?.deadline ?? nominal ?? undefined} />
        <Field name="source" label="Report-year instructions URL" type="url" value={facts?.reviewedInstructions?.url} />
        <Field name="instructionsReference" label="Instructions review reference" value={facts?.reviewedInstructions?.reference} />
      </EvidenceGroup>
      <EvidenceGroup name="reconciliation" label="Record activity reconciliation" recorded={Boolean(facts?.reconciliation)}>
        <Select name="activity" label="Report activity" value={facts?.reconciliation?.activity} options={["Reported activity", "No New York applications or closings"]} />
        <Field name="reconciliationReference" label="Reconciliation reference" value={facts?.reconciliation?.reference} />
      </EvidenceGroup>
      <EvidenceGroup name="attestation" label="Record signer attestation" recorded={Boolean(facts?.attestation)}>
        <Select name="capacity" label="Signer capacity" value={facts?.attestation?.capacity} options={["Owner", "Authorized principal officer"]} />
        <Field name="attestationOn" label="Attestation date" type="date" value={facts?.attestation?.on} />
        <Field name="attestationReference" label="Signed attestation reference" value={facts?.attestation?.reference} />
        <Field name="authorityReference" label="Signer authority reference" value={facts?.attestation?.authorityReference} />
        <Field name="dfsRole" label="DFS Application Owner reference (portal)" optional value={facts?.attestation?.dfsApplicationOwnerReference} />
        <Field name="notarization" label="Notarized affidavit reference (mail)" optional value={facts?.attestation?.notarizationReference} />
      </EvidenceGroup>
      <EvidenceGroup name="original" label="Record initial submission" recorded={Boolean(facts?.original)}>
        <Select name="route" label="Initial filing route" value={facts?.original?.route} options={routes} />
        <Field name="originalOn" label="Portal submission or mail postmark date" type="date" value={facts?.original?.on} />
        <Field name="originalReference" label="DFS receipt or dated postmark reference" value={facts?.original?.reference} />
      </EvidenceGroup>
      <EvidenceGroup name="amendment" label="Record amended submission" recorded={Boolean(facts?.amendment)}>
        <Select name="amendmentRoute" label="Amended filing route" value={facts?.amendment?.route} options={routes} />
        <Field name="amendmentOn" label="Amended submission or postmark date" type="date" value={facts?.amendment?.on} />
        <Field name="amendmentReference" label="Amendment receipt reference" value={facts?.amendment?.reference} />
        <Field name="amendmentReason" label="Reason for amendment" value={facts?.amendment?.reason} />
        <Field name="amendmentAttestation" label="Amended report attestation reference" optional value={facts?.amendment?.attestationReference} />
      </EvidenceGroup>
      {latest && <Field name="correction" label="Reason for update" />}
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" type="submit" disabled={conflict}>{busy ? "Saving…" : "Save filing evidence"}</Button>
        <Button className="min-h-11" variant="outline" type="button" onClick={cancel}>Cancel</Button>
      </div>
    </fieldset>
  </form>;
}

function FilingSummary({ entry, review = entry.finding }: { entry: Version; review?: Version["finding"] }) {
  const { evidence } = entry;
  const lines = [
    ["Filing deadline", review.dueOn ?? "Needs review", evidence.reviewedInstructions ? "Reviewed" : review.dueOn ? "Nominal" : null],
    ["Initial filing timing", review.initialTiming],
    ["Instructions review", evidence.reviewedInstructions?.reference, evidence.reviewedInstructions?.url],
    ["Activity reconciliation", evidence.reconciliation?.activity, evidence.reconciliation?.reference],
    ["Signer attestation", evidence.attestation?.capacity, evidence.attestation?.on, evidence.attestation?.reference],
    ["Signer authority", evidence.attestation?.authorityReference],
    ["DFS Application Owner", evidence.attestation?.dfsApplicationOwnerReference],
    ["Notarized affidavit", evidence.attestation?.notarizationReference],
    ["Initial submission", evidence.original?.route, evidence.original?.on, evidence.original?.reference],
    ["Amended submission", evidence.amendment?.route, evidence.amendment?.on, evidence.amendment?.reference, evidence.amendment?.reason],
    ["Amended attestation", evidence.amendment?.attestationReference],
    ["Recorded by", entry.actor],
    ["Reason for update", entry.correction],
  ];
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p>Version {entry.version} · Reviewed <time dateTime={review.asOf}>{review.asOf}</time></p>
    {review.gaps.length > 0 && <div><h3 className="font-semibold">Evidence gaps</h3>
      <ul className="list-disc pl-5">{review.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
    <dl className="form-grid">{lines.filter(([, value]) => value).map(([label, ...values]) =>
      <div key={label}><dt className="font-semibold">{label}</dt><dd>{values.filter(Boolean).join(" · ")}</dd></div>)}</dl>
  </div>;
}

export function NewYorkVoorEvidence({ brokerageId, entityId, obligationId, period, onBack }: Target & { onBack: () => void }) {
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
    void filingAction({ operation: "newYorkVoorHistory", entityId, id: obligationId, period }, brokerageId)
      .then(result => { if (active) setData(history.parse(result)); })
      .catch(() => { if (active) setFeedback({ text: "Could not load filing evidence. Try again.", error: true }); });
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
      const older = history.parse(await filingAction({ operation: "newYorkVoorHistory", entityId, id: obligationId, period, before: data.next }, brokerageId));
      setData({ ...data, versions: [...data.versions, ...older.versions], next: older.next });
      setFeedback({ text: "Earlier filing evidence loaded." });
    } catch { setFeedback({ text: "Could not load earlier versions. Try again.", error: true }); }
    finally { setBusy(false); }
  }

  async function submit(form: FormData) {
    if (busy || conflict) return;
    const get = (key: string) => String(form.get(key) ?? "").trim();
    const evidence = newYorkVoorEvidence.safeParse({
      reviewedInstructions: form.has("instructions") ? { deadline: get("deadline"), url: get("source"), reference: get("instructionsReference") } : undefined,
      reconciliation: form.has("reconciliation") ? { activity: get("activity"), reference: get("reconciliationReference") } : undefined,
      attestation: form.has("attestation") ? { on: get("attestationOn"), reference: get("attestationReference"), capacity: get("capacity"),
        authorityReference: get("authorityReference"), dfsApplicationOwnerReference: get("dfsRole") || undefined,
        notarizationReference: get("notarization") || undefined } : undefined,
      original: form.has("original") ? { on: get("originalOn"), route: get("route"), reference: get("originalReference") } : undefined,
      amendment: form.has("amendment") ? { on: get("amendmentOn"), route: get("amendmentRoute"), reference: get("amendmentReference"),
        reason: get("amendmentReason"), attestationReference: get("amendmentAttestation") || undefined } : undefined,
    });
    if (!evidence.success) {
      const issue = evidence.error.issues[0];
      setFeedback({ text: issue?.code === "custom" ? issue.message : "Check the dates and evidence references.", error: true });
      return;
    }
    const correction = get("correction");
    if (latest && correction.length < 5) { setFeedback({ text: "Enter at least five characters for the reason for update.", error: true }); return; }
    const input = { operation: "saveNewYorkVoor" as const, entityId, id: obligationId, period, expected: latest?.version ?? 0,
      evidence: evidence.data, correction: correction || undefined };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() };
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = saved.parse(await filingAction({ ...input, requestId: retry.current.requestId }, brokerageId));
      retry.current = null;
      reload();
      setFeedback({ text: "Filing evidence saved. Version " + result.version + "." });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      if (/obligation changed/i.test(detail)) {
        setConflict(true);
        setFeedback({ text: detail, error: true });
      } else {
        setFeedback({ text: /^Check the report-year deadline/.test(detail) ? detail : "Could not confirm the save. Retry with the same evidence.", error: true });
      }
    } finally { setBusy(false); }
  }

  return <section className="record-form compliance-pilot-form" aria-label="New York Volume of Operations Report">
    <div className="section-heading"><h2 className="text-lg font-semibold" ref={title} tabIndex={-1}>New York Volume of Operations Report</h2>
      <Button className="min-h-11" variant="outline" disabled={busy} onClick={onBack}>Back to obligation</Button></div>
    <p>Report year {data?.reportYear ?? period.slice(0, 4)}{data && <> · {data.authority}</>}</p>
    {data?.scopeChanged && <p role="status">The linked brokerage scope or source has changed. Review the current scope before relying on this record.</p>}
    {feedback && <p ref={message} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {!data ? (feedback?.error ? <div><Button className="min-h-11" variant="outline" onClick={reload}>Reload filing evidence</Button></div> :
      <p role="status">Loading filing evidence…</p>) : edit ? <>
      <h3 ref={editHeading} tabIndex={-1}>{latest ? "Update filing evidence" : "Record filing evidence"}</h3>
      <FilingForm latest={latest} nominal={data.nominalDueOn} busy={busy} conflict={conflict} submit={form => void submit(form)}
        cancel={() => { setFeedback(undefined); setEdit(false); requestAnimationFrame(() => editButton.current?.focus()); }} />
      {conflict && <div><Button className="min-h-11" variant="outline" onClick={reload}>Reload evidence and discard draft</Button></div>}
    </> : <>
      {latest ? <FilingSummary entry={latest} review={data.currentFinding ?? latest.finding} /> : <>
        <p>{data.nominalDueOn ? "Nominal filing date " + data.nominalDueOn : "Filing date needs review."}</p>
        <p>No filing evidence recorded.</p>
      </>}
      <div><Button ref={editButton} className="min-h-11" onClick={() => { setFeedback(undefined); setEdit(true); }}>
        {latest ? "Update filing evidence" : "Record filing evidence"}</Button></div>
      {data.versions.slice(1).map(entry => <details key={entry.version}><summary className="min-h-11 cursor-pointer">
        Version {entry.version} · {entry.finding.initialTiming}</summary><FilingSummary entry={entry} /></details>)}
      {data.next && <div><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => void loadEarlier()}>Load earlier versions</Button></div>}
    </>}
  </section>;
}

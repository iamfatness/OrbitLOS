"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import type { ObligationRequest } from "@/lib/compliance-obligations-model";
import { michiganFilingAmendments, michiganFilingEvidence, michiganStatementFormats } from "@/lib/michigan-filing-evidence-model";
import { Button } from "./ui/button";

const finding = z.object({ asOf: z.iso.date(), dueOn: z.iso.date().nullable(), summary: z.string(), gaps: z.array(z.string()),
  reviewedScope: z.object({ revision: z.number() }).optional() });
const version = z.object({ version: z.number(), evidence: michiganFilingEvidence, finding, actor: z.string(), correction: z.string().nullable() });
const history = z.object({ kind: z.literal("michiganFilingHistory"), component: z.string(), sourceTitle: z.string(), bounds: z.object({ from: z.iso.date(), through: z.iso.date() }), scopeChanged: z.boolean(),
  nominalDueOn: z.iso.date().nullable(), versions: z.array(version), currentFinding: finding.nullable(), next: z.number().nullable(),
  reviewableScopeRevision: z.number().optional() });
const saved = z.object({ kind: z.literal("michiganFilingSaved"), version: z.number() });
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

function Field({ name, label, value, type = "text", id }: {
  name: string; label: string; value?: string; type?: "text" | "date"; id?: string;
}) {
  return <label className="field min-w-0">{label}<input id={id} name={name} type={type} required defaultValue={value}
    minLength={type === "text" ? 5 : undefined} maxLength={type === "text" ? 1500 : undefined} /></label>;
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
function FilingForm({ latest, component, nominal, statePortal, reviewableScopeRevision, busy, conflict, submit, cancel }: {
  latest?: Version; component: string; nominal: string | null; statePortal?: boolean; busy: boolean; conflict: boolean;
  reviewableScopeRevision?: number;
  submit: (form: FormData) => void; cancel: () => void;
}) {
  const facts = latest?.evidence;
  const initialAmendments = facts ? michiganFilingAmendments(facts) : [];
  const [amendmentKeys, setAmendmentKeys] = useState(() => initialAmendments.map((_, index) => index));
  const nextAmendment = useRef(initialAmendments.length);
  const addAmendment = useRef<HTMLButtonElement>(null);
  return <form className="record-form" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    <fieldset className="record-form min-w-0" disabled={busy}>
      {component === "Fiscal-year financial statement" && <EvidenceGroup name="michiganStatement" label="Record annual financial statement" recorded={Boolean(facts?.michiganStatement)}>
        <Select name="miStatementFormat" label="Financial statement format" options={michiganStatementFormats} value={facts?.michiganStatement?.format} />
        <Field name="miStatementReference" label="Filed financial statement reference" value={facts?.michiganStatement?.reference} />
      </EvidenceGroup>}
      <EvidenceGroup name="deadline" label="Record reviewed deadline" recorded={Boolean(facts?.deadline)}>
        <Field name="dueOn" label="Reviewed filing deadline" type="date" value={facts?.deadline?.on ?? nominal ?? undefined} />
        <Field name="deadlineReference" label="Deadline evidence reference" value={facts?.deadline?.reference} />
      </EvidenceGroup>
      {component === "Texas OCCC annual report" && <EvidenceGroup name="texasOcccReport" label="Record OCCC report and certification" recorded={Boolean(facts?.texasOcccReport)}>
        <label className="field min-w-0">OCCC license identifier<input name="occcLicenseIdentifier" required maxLength={100} defaultValue={facts?.texasOcccReport?.licenseIdentifier} /></label>
        <Field name="occcReportReference" label="Saved report reference" value={facts?.texasOcccReport?.reportReference} />
        <Field name="occcCertificationReference" label="Certification evidence reference" value={facts?.texasOcccReport?.certificationReference} />
      </EvidenceGroup>}
      <EvidenceGroup name="reconciliation" label="Record filing reconciliation" recorded={Boolean(facts?.reconciliation)}>
        {component === "Residential Mortgage Loan Activity" &&
          <Select name="activity" label="Report activity" value={facts?.reconciliation?.activity}
            options={["Activity recorded", "No reportable activity"]} />}
        <Field name="reconciliationReference" label="Reconciliation reference" value={facts?.reconciliation?.reference} />
      </EvidenceGroup>
      <EvidenceGroup name="submission" label="Record original submission" recorded={Boolean(facts?.submission)}>
        <Field name="submissionOn" label="Original submission date" type="date" value={facts?.submission?.on} />
        <Field name="submissionReference" label={statePortal ? "Original state filing confirmation reference" : component.startsWith("HMDA") ? "Original HMDA confirmation reference" : "Original NMLS receipt reference"} value={facts?.submission?.reference} />
      </EvidenceGroup>
      {amendmentKeys.map((key, index) => {
        const prefix = "mi-filing-amendment-" + key;
        const prior = initialAmendments[key];
        return <fieldset key={key} className="record-form min-w-0">
          <legend className="font-semibold">Amendment {index + 1}</legend>
          <input type="hidden" name="amendmentKey" value={key} />
          <div className="form-grid">
            <Field id={prefix + "-on"} name={prefix + "-on"} label="Amendment submission date" type="date" value={prior?.on} />
            <Field name={prefix + "-reference"} label="Amendment receipt reference" value={prior?.reference} />
            <Field name={prefix + "-reason"} label="Reason for amendment" value={prior?.reason} />
          </div>
          <div><Button className="min-h-11" variant="outline" onClick={() => {
            setAmendmentKeys(keys => keys.filter(item => item !== key));
            requestAnimationFrame(() => addAmendment.current?.focus());
          }}>Remove amendment {index + 1}</Button></div>
        </fieldset>;
      })}
      {amendmentKeys.length < 30 && <div><Button ref={addAmendment} className="min-h-11" variant="outline" onClick={() => {
        const key = nextAmendment.current++;
        setAmendmentKeys(keys => [...keys, key]);
        requestAnimationFrame(() => document.getElementById("mi-filing-amendment-" + key + "-on")?.focus());
      }}>Add amendment</Button></div>}
      {reviewableScopeRevision && <label className="flex min-h-11 items-center gap-2">
        <input name="recheckScope" type="checkbox" />I checked the filing deadline against state scope version {reviewableScopeRevision}.
      </label>}
      {(latest || reviewableScopeRevision) && <Field name="correction" label="Reason for update" />}
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
    ["Filing deadline", review.dueOn ?? "Needs review", review.dueOn ? evidence.deadline ? "Reviewed" : "Nominal" : null],
    ["Previously recorded deadline", !review.dueOn ? evidence.deadline?.on : undefined],
    ["Original filing timing", review.summary],
    ["Deadline evidence", evidence.deadline?.reference],
    ["Report activity", evidence.reconciliation?.activity],
    ["OCCC license identifier", evidence.texasOcccReport?.licenseIdentifier],
    ["Saved report", evidence.texasOcccReport?.reportReference],
    ["Certification evidence", evidence.texasOcccReport?.certificationReference],
    ["Financial statement format", evidence.michiganStatement?.format, evidence.michiganStatement?.reference],
    ["Reconciliation evidence", evidence.reconciliation?.reference],
    ["Original submission", evidence.submission?.on, evidence.submission?.reference],
    ["Recorded by", entry.actor],
    ["Scope reviewed", entry.finding.reviewedScope?.revision ? "Version " + entry.finding.reviewedScope.revision : undefined],
    ["Reason for update", entry.correction],
  ];
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p>Version {entry.version} · Reviewed <time dateTime={review.asOf}>{review.asOf}</time></p>
    {review.gaps.length > 0 && <div><h3 className="font-semibold">Evidence gaps</h3>
      <ul className="list-disc pl-5">{review.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
    <dl className="form-grid">{lines.filter(([, value]) => value).map(([label, ...values]) =>
      <div key={label}><dt className="font-semibold">{label}</dt><dd>{values.filter(Boolean).join(" · ")}</dd></div>)}</dl>
    {michiganFilingAmendments(evidence).length > 0 && <div>
      <h3 className="font-semibold">Amended submissions</h3>
      <ol className="list-decimal pl-5">{michiganFilingAmendments(evidence).map((item, index) =>
        <li key={index}>{item.on} · {item.reference} · {item.reason}</li>)}</ol>
    </div>}
  </div>;
}

export function NmlsFilingEvidence({ brokerageId, entityId, obligationId, period, hmda, statePortal, onBack, backLabel = "Back to obligation" }:
  Target & { onBack: () => void; backLabel?: string; hmda?: boolean; statePortal?: boolean }) {
  const heading = statePortal ? "State filing evidence" : hmda ? "HMDA filing evidence" : "NMLS filing evidence";
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
    void filingAction({ operation: "michiganFilingHistory", entityId, id: obligationId, period }, brokerageId)
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
      const older = history.parse(await filingAction({ operation: "michiganFilingHistory", entityId, id: obligationId, period, before: data.next }, brokerageId));
      setData({ ...data, versions: [...data.versions, ...older.versions], next: older.next });
      setFeedback({ text: "Earlier filing evidence loaded." });
    } catch { setFeedback({ text: "Could not load earlier versions. Try again.", error: true }); }
    finally { setBusy(false); }
  }

  async function submit(form: FormData) {
    if (busy || conflict) return;
    const get = (key: string) => String(form.get(key) ?? "").trim();
    const amendments = form.getAll("amendmentKey").map(key => {
      const prefix = "mi-filing-amendment-" + key;
      return { on: get(prefix + "-on"), reference: get(prefix + "-reference"), reason: get(prefix + "-reason") };
    });
    const evidence = michiganFilingEvidence.safeParse({
      texasOcccReport: form.has("texasOcccReport") ? {
        licenseIdentifier: get("occcLicenseIdentifier"),
        reportReference: get("occcReportReference"),
        certificationReference: get("occcCertificationReference"),
      } : undefined,
      michiganStatement: form.has("michiganStatement") ? { format: get("miStatementFormat"), reference: get("miStatementReference") } : undefined,
      deadline: form.has("deadline") ? { on: get("dueOn"), reference: get("deadlineReference") } : undefined,
      reconciliation: form.has("reconciliation") ? { activity: get("activity") || undefined, reference: get("reconciliationReference") } : undefined,
      submission: form.has("submission") ? { on: get("submissionOn"), reference: get("submissionReference") } : undefined,
      amendments: amendments.length ? amendments : undefined,
    });
    if (!evidence.success) {
      const issue = evidence.error.issues[0];
      setFeedback({ text: issue?.code === "custom" ? issue.message : "Check the dates and evidence references.", error: true });
      return;
    }
    const correction = get("correction");
    if (latest && correction.length < 5) { setFeedback({ text: "Enter at least five characters for the reason for update.", error: true }); return; }
    const input = { operation: "saveMichiganFiling" as const, entityId, id: obligationId, period, expected: latest?.version ?? 0,
      evidence: evidence.data, correction: correction || undefined,
      reviewedScopeRevision: form.has("recheckScope") ? data?.reviewableScopeRevision : undefined };
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
        setFeedback({ text: /^(Check the deadline|Record the activity determination|Record each amendment receipt|Record a reviewed deadline)/.test(detail)
          ? detail : "Could not confirm the save. Retry with the same evidence.", error: true });
      }
    } finally { setBusy(false); }
  }

  return <section className="record-form compliance-pilot-form" aria-label={heading}>
    <div className="section-heading"><h2 className="text-lg font-semibold" ref={title} tabIndex={-1}>{heading}</h2>
      <Button className="min-h-11" variant="outline" disabled={busy} onClick={onBack}>{backLabel}</Button></div>
    <p>{data ? <>{data.component} · {data.bounds.from} through {data.bounds.through}</> : period}</p>
    {data && data.sourceTitle !== data.component && <p>{data.sourceTitle}</p>}
    {data?.scopeChanged && <p role="status">The linked brokerage scope or source has changed. Review the current scope before relying on this record.</p>}
    {feedback && <p ref={message} tabIndex={-1} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {!data ? (feedback?.error ? <div><Button className="min-h-11" variant="outline" onClick={reload}>Reload filing evidence</Button></div> :
      <p role="status">Loading filing evidence…</p>) : edit ? <>
      <h3 ref={editHeading} tabIndex={-1}>{latest ? "Update filing evidence" : "Record filing evidence"}</h3>
      <FilingForm latest={latest} component={data.component} nominal={data.nominalDueOn} statePortal={statePortal} reviewableScopeRevision={data.reviewableScopeRevision}
        busy={busy} conflict={conflict} submit={form => void submit(form)}
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
        Version {entry.version} · {entry.finding.summary}</summary><FilingSummary entry={entry} /></details>)}
      {data.next && <div><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => void loadEarlier()}>Load earlier versions</Button></div>}
    </>}
  </section>;
}

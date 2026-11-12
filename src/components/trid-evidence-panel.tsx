"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { tridElements, tridEvent, type TridEvent } from "@/lib/trid-model";
import { Button } from "./ui/button";

type Result = Extract<ComplianceCaseResult, { kind: "trid" }>["result"];
type Evidence = Exclude<Result, { error: string }>;
const actions = {
  scope: "Record scope and calendar", element: "Record application element", sent: "Record disclosure send",
  received: "Record disclosure receipt", closing: "Record planned consummation", void: "Withdraw incorrect evidence",
} as const;
const dates = (value: string) => value.split(/[\s,]+/).filter(Boolean);

function describe(event: TridEvent) {
  switch (event.type) {
    case "scope": return `Scope and calendar for ${event.creditor}`;
    case "element": return `${tridElements[event.element]} received ${event.on}`;
    case "sent": return `${event.document} · ${event.version} · Sent ${event.on} by ${event.sender} via ${event.method}`;
    case "received": return `${event.document} · ${event.version} · Received ${event.on}`;
    case "closing": return `Planned consummation ${event.on}`;
    case "void": return `Withdrew entry ${event.sequence}`;
  }
}

export function TridEvidencePanel({ loanId, brokerageId, readOnly }: {
  loanId: string; brokerageId: string; readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Evidence>();
  const [action, setAction] = useState<keyof typeof actions>("scope");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: true }>();
  const [formRevision, setFormRevision] = useState(0);
  const feedback = useRef<HTMLParagraphElement>(null);
  const retry = useRef<{ event: string; id: string; revision: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void accessComplianceCases({ type: "trid", input: { operation: "read", loanId } }, brokerageId).then(response => {
      if (!active) return;
      if ("error" in response) throw new Error(response.error);
      if (response.kind !== "trid") throw new Error("TRID evidence could not be loaded.");
      if ("error" in response.result) throw new Error(response.result.error);
      setData(response.result);
    }).catch(error => {
      if (active) setMessage({ text: error instanceof Error ? error.message : "Refresh to load TRID evidence.", error: true });
    });
    return () => { active = false; };
  }, [open, refresh, loanId, brokerageId]);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);

  async function record(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || busy || readOnly) return;
    const form = new FormData(e.currentTarget);
    const get = (field: string) => String(form.get(field) ?? "");
    const reference = get("reference");
    const artifact = { document: get("document"), version: get("version") };
    const on = get("on");
    let input: unknown;
    switch (action) {
      case "scope":
        input = { type: action, coveredScenario: form.has("coveredScenario"), reference, creditor: get("creditor"), leSender: get("leSender"), zone: get("zone"),
          calendarFrom: get("calendarFrom"), calendarThrough: get("calendarThrough"),
          openWeekdays: form.getAll("openWeekdays").map(Number), closures: dates(get("closures")), extraOpen: dates(get("extraOpen")) };
        break;
      case "element": input = { type: action, reference, on, element: get("element") }; break;
      case "sent":
        input = { type: action, reference, on, ...artifact, method: get("method"), sender: get("sender"),
          consentReference: get("consentReference").trim() || undefined };
        break;
      case "received": input = { type: action, reference, on, ...artifact }; break;
      case "closing": input = { type: action, reference, on }; break;
      case "void": input = { type: action, reference, sequence: Number(get("sequence")) }; break;
    }
    const parsed = tridEvent.safeParse(input);
    if (!parsed.success) {
      setMessage({ text: parsed.error.issues.map(issue => issue.path[0] === "openWeekdays"
        ? "Select the applicable office’s open weekdays." : issue.message).join(" "), error: true });
      return;
    }
    const event = JSON.stringify(parsed.data);
    if (retry.current?.event !== event || retry.current.revision !== data.revision) {
      retry.current = { event, id: crypto.randomUUID(), revision: data.revision };
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await accessComplianceCases({ type: "trid", input: { operation: "record", loanId,
        requestId: retry.current.id, expectedRevision: retry.current.revision, event: parsed.data } }, brokerageId);
      if ("error" in result) throw new Error(result.error);
      if (result.kind !== "trid") throw new Error("Save could not be confirmed. Retry the same evidence.");
      if ("error" in result.result) throw new Error(result.result.error);
      setData(result.result);
      setFormRevision(revision => revision + 1);
      retry.current = null;
      setMessage({ text: "Evidence recorded." });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Save could not be confirmed. Retry the same evidence.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const timing = data?.timing;
  const withdrawn = new Set(data?.entries.flatMap(({ event }) => event.type === "void" ? [event.sequence] : []));
  return <details className="details-section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>TRID application and delivery evidence</summary>
    {open && <div className="record-form">
      <p className="muted">Michigan pilot timing review for a covered consumer closed-end mortgage with one required disclosure recipient and no timing exception. Record source references without SSNs or other borrower values.</p>
      {message && <p ref={feedback} tabIndex={-1} role={message.error ? "alert" : "status"}>{message.text}</p>}
      <div><Button size="sm" variant="outline" disabled={busy} onClick={() => { setMessage(undefined); setRefresh(value => value + 1); }}>Refresh evidence</Button></div>
      {!timing && !message && <p role="status">Loading TRID evidence…</p>}
      {data && timing && <>
        <dl>
          <dt>Six elements received</dt><dd>{timing.applicationOn ?? "Waiting for receipt dates"}</dd>
          <dt>Initial Loan Estimate send</dt><dd>{timing.leStatus}{timing.leDue && ` · Due ${timing.leDue}`}</dd>
          <dt>Loan Estimate waiting period</dt><dd>{timing.leWait}{timing.leEarliest && ` · Earliest ${timing.leEarliest}`}</dd>
          <dt>Initial Closing Disclosure receipt</dt><dd>{timing.cdReceiptBasis}{timing.cdReceipt && ` · ${timing.cdReceipt}`}</dd>
          <dt>Closing Disclosure waiting period</dt><dd>{timing.cdWait}{timing.cdEarliest && ` · Earliest ${timing.cdEarliest}`}</dd>
          <dt>Planned consummation</dt><dd>{timing.closingOn ?? "Missing date"}</dd>
        </dl>
        <ul aria-label="Application receipt evidence">
          {Object.entries(tridElements).map(([key, label]) => {
            const receipt = data.entries.filter(entry => !withdrawn.has(entry.sequence))
              .map(entry => entry.event).filter(event => event.type === "element").find(event => event.element === key);
            return <li key={key}>{label} · {receipt?.on ?? "Receipt date missing"}</li>;
          })}
        </ul>
        {!readOnly && <>
          <label className="field">Evidence to record<select disabled={busy} value={action} onChange={e => setAction(e.target.value as keyof typeof actions)}>
            {Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <form key={`${action}:${formRevision}`} onSubmit={record} className="record-form">
            <fieldset disabled={busy} className="record-form">
              {action === "scope" && <>
                <label><input type="checkbox" name="coveredScenario" required /> This file matches the pilot scenario above.</label>
                <label className="field">Creditor<input name="creditor" required maxLength={180} defaultValue={timing.scope?.creditor} /></label>
                <div className="form-grid">
                  <label className="field">Responsible Loan Estimate sender<select name="leSender" defaultValue={timing.scope?.leSender}><option>Creditor</option><option>Broker</option></select></label>
                  <label className="field">Time zone for recorded dates<select name="zone" defaultValue={timing.scope?.zone}><option value="America/Detroit">Michigan Eastern</option><option value="America/Menominee">Michigan Central</option></select></label>
                  <label className="field">Office calendar begins<input name="calendarFrom" type="date" required defaultValue={timing.scope?.calendarFrom} /></label>
                  <label className="field">Office calendar ends<input name="calendarThrough" type="date" required defaultValue={timing.scope?.calendarThrough} /></label>
                </div>
                <fieldset className="record-form"><legend>Sender’s office open for substantially all business functions</legend>
                  <div className="loan-application-actions">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) =>
                    <label key={day}><input name="openWeekdays" value={index} type="checkbox" defaultChecked={timing.scope?.openWeekdays.includes(index)} /> {day}</label>)}</div>
                </fieldset>
                <label className="field">Closure exceptions (YYYY-MM-DD, one per line)<textarea name="closures" defaultValue={timing.scope?.closures.join("\n")} /></label>
                <label className="field">Extra open dates (YYYY-MM-DD, one per line)<textarea name="extraOpen" defaultValue={timing.scope?.extraOpen.join("\n")} /></label>
              </>}
              {action === "element" && <label className="field">Application element<select name="element">
                {Object.entries(tridElements).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select></label>}
              {(action === "sent" || action === "received") && <>
                <label className="field">Disclosure<select name="document">{["Initial LE", "Revised LE", "Initial CD", "Corrected CD"].map(kind => <option key={kind}>{kind}</option>)}</select></label>
                <label className="field">Exact disclosure version reference<input name="version" required maxLength={180} /></label>
              </>}
              {action === "sent" && <>
                <label className="field">Delivery method<select name="method"><option>In person</option><option>Mail</option><option>Electronic</option></select></label>
                <label className="field">Sender<select name="sender"><option>Creditor</option><option>Broker</option><option>Settlement agent</option></select></label>
                <label className="field">Consent evidence reference (required for electronic delivery)<input name="consentReference" maxLength={180} /></label>
              </>}
              {action === "void" ? <label className="field">Entry to withdraw<select name="sequence" required><option value="">Choose an entry</option>
                {data.entries.filter(entry => entry.event.type !== "void" && !withdrawn.has(entry.sequence)).map(entry =>
                  <option value={entry.sequence} key={entry.sequence}>{entry.sequence}. {describe(entry.event)}</option>)}
              </select></label> : action !== "scope" && <label className="field">{action === "closing" ? "Planned consummation date" : action === "sent" ? "Send date" : "Receipt date"}<input name="on" type="date" required /></label>}
              <label className="field">{action === "scope" ? "Scope and office calendar evidence reference" : action === "void" ? "Correction reason or evidence reference" : "Evidence reference"}<input name="reference" required maxLength={180} /></label>
              <div><Button type="submit" size="sm">{busy ? "Recording…" : actions[action]}</Button></div>
            </fieldset>
          </form>
        </>}
        <details><summary>Evidence history ({data.entries.length})</summary>
          {data.entries.length === 0 && <p>No evidence recorded.</p>}
          <ol className="document-list">{data.entries.map(entry => <li key={entry.sequence} className="document-item">
            <div><strong>{entry.sequence}. {describe(entry.event)}</strong><p>{entry.event.reference} · {entry.actor} · {entry.at}</p>
              {withdrawn.has(entry.sequence) && <p>Withdrawn by a later entry</p>}</div>
          </li>)}</ol>
        </details>
      </>}
    </div>}
  </details>;
}

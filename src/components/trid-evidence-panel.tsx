"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import { correctedCdReasons, isLoanEstimateReceipt, tridElements, tridEvent, type TridEvent } from "@/lib/trid-model";
import { Button } from "./ui/button";
import { MichiganChargeEvidence, MichiganChargeFields, MichiganChargeReviews } from "./michigan-charge-review";
import { parseTridDollars, readFeeSnapshotLines, TridClosingReviews, TridClosingSourceField, TridEstimateRevisionFields, TridEstimateRevisionReviews, TridFeeComparison, TridFeeSnapshotFields } from "./trid-fee-comparison";

type Result = Extract<ComplianceCaseResult, { kind: "trid" }>["result"];
type Evidence = Exclude<Result, { error: string }>;
const actions = {
  scope: "Record scope and calendar", element: "Record application element", sent: "Record disclosure send",
  received: "Record disclosure receipt", intent: "Record intent to proceed", fee: "Record fee activity",
  closing: "Record planned consummation", void: "Withdraw incorrect evidence",
  feeSnapshot: "Record disclosure fee snapshot",
  estimateRevision: "Record revised estimate review",
  consummated: "Record actual consummation",
  feeCure: "Record refund and cure evidence",
  correctedCdReview: "Record corrected disclosure review",
  miChargeReview: "Record Michigan charge review",
} as const;
const dates = (value: string) => value.split(/[\s,]+/).filter(Boolean);
const recordedWhen = (event: { on: string; localTime?: string }) => event.localTime ? `${event.on} ${event.localTime}` : event.on;

function describe(event: TridEvent) {
  switch (event.type) {
    case "scope": return `Scope and calendar for ${event.creditor}`;
    case "element": return `${tridElements[event.element]} received ${event.on}`;
    case "sent": return `${event.document} · ${event.version} · Sent ${event.on} by ${event.sender} via ${event.method}`;
    case "received": return `${event.document} · ${event.version} · Received ${recordedWhen(event)}`;
    case "intent": return `Intent to proceed · Receipt ${event.receiptSequence} · ${recordedWhen(event)}`;
    case "fee": return `${event.name} · ${event.activity} · ${recordedWhen(event)}${event.intentSequence ? ` · Intent ${event.intentSequence}` : ""}`;
    case "closing": return `Planned consummation ${event.on}`;
    case "void": return `Withdrew entry ${event.sequence}`;
    case "feeSnapshot": return `Fee snapshot for disclosure entry ${event.evidenceSequence}`;
    case "estimateRevision": return `${event.reason} · Revised estimate snapshot ${event.revisedSequence}`;
    case "consummated": return `Actual consummation ${event.on}`;
    case "feeCure": return `Refund evidence dated ${event.on} · Closing snapshot ${event.closingSequence}`;
    case "correctedCdReview": return `${event.reason} · Corrected disclosure entry ${event.sendSequence}`;
    case "miChargeReview": return `Michigan charge · ${event.name} · ${event.key}`;
  }
}

export function TridEvidencePanel({ loanId, brokerageId, readOnly }: {
  loanId: string; brokerageId: string; readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Evidence>();
  const [action, setAction] = useState<keyof typeof actions>("scope");
  const [linkedSequence, setLinkedSequence] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const [message, setMessage] = useState<{ text: string; error?: true }>();
  const [formRevision, setFormRevision] = useState(0);
  const feedback = useRef<HTMLDivElement>(null);
  const retry = useRef<{ event: string; id: string; revision: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void accessComplianceCases({ type: "trid", input: { operation: "read", loanId } }, brokerageId).then(response => {
      if (!active) return;
      if ("error" in response) throw new Error(response.error);
      if (response.kind !== "trid") throw new Error("TRID evidence could not be loaded.");
      if ("error" in response.result) throw new Error(response.result.error);
      const next = response.result;
      setData(current => current && current.revision > next.revision ? current : next);
      setReadError("");
    }).catch(error => {
      if (active) setReadError(error instanceof Error && !(error instanceof TypeError) ? error.message : "Could not load the evidence. Refresh to try again.");
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
    const localTime = get("localTime") || undefined;
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
      case "received": input = { type: action, reference, on, localTime, ...artifact }; break;
      case "intent": input = { type: action, reference, on, localTime, receiptSequence: Number(get("receiptSequence")) }; break;
      case "fee": input = { type: action, reference, on, localTime,
        intentSequence: get("intentSequence") ? Number(get("intentSequence")) : undefined,
        name: get("feeName"), category: get("feeCategory"), activity: get("feeActivity") }; break;
      case "miChargeReview":
        input = { type: action, reference, key: get("chargeKey"), name: get("chargeName"),
          applicability: get("chargeApplicability"), category: get("chargeCategory"), chargedCents: parseTridDollars(get("charged")),
          paidCents: get("paid") ? parseTridDollars(get("paid")) : undefined,
          collections: get("collections") ? Number(get("collections")) : undefined,
          expenseCents: get("expense") ? parseTridDollars(get("expense")) : undefined,
          expenseReference: get("expenseReference").trim() || undefined,
          termsReference: get("termsReference").trim() || undefined, originalExpiry: get("originalExpiry") || undefined,
          extension: get("extension") || undefined, extendedExpiry: get("extendedExpiry") || undefined,
          extensionReference: get("extensionReference").trim() || undefined };
        break;
      case "closing": input = { type: action, reference, on }; break;
      case "feeSnapshot": input = { type: action, reference, evidenceSequence: Number(get("evidenceSequence")),
        complete: form.has("feeComplete"), lines: readFeeSnapshotLines(form) }; break;
      case "estimateRevision": input = { type: action, reference, on, reason: get("revisionReason"),
        originalSequence: Number(get("originalSequence")), revisedSequence: Number(get("revisedSequence")),
        chargeKeys: form.getAll("chargeKeys").map(String),
        reviewReference: get("reviewReference").trim() || undefined }; break;
      case "consummated": input = { type: action, reference, on }; break;
      case "feeCure": input = { type: action, reference, on, refundCents: parseTridDollars(get("refundAmount")),
        consummationSequence: Number(get("consummationSequence")), estimateSequence: Number(get("estimateSequence")),
        closingSequence: Number(get("closingSequence")), correctedSendSequence: get("correctedSendSequence") ? Number(get("correctedSendSequence")) : undefined }; break;
      case "correctedCdReview": input = { type: action, reference, sendSequence: Number(get("correctedSendSequence")),
        reason: get("correctedReason") }; break;
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
      setLinkedSequence("");
      retry.current = null;
      setMessage({ text: "Evidence recorded." });
    } catch (error) {
      setMessage({ text: error instanceof Error && !(error instanceof TypeError) ? error.message : "Save could not be confirmed. Retry the same evidence.", error: true });
    } finally {
      setBusy(false);
    }
  }

  const timing = data?.timing;
  const withdrawn = new Set(data?.entries.flatMap(({ event }) => event.type === "void" ? [event.sequence] : []));
  const active = data?.entries.filter(({ event, sequence }) => event.type !== "void" && !withdrawn.has(sequence)) ?? [];
  const actual = active.find(entry => entry.event.type === "consummated");
  const correctedSends = active.flatMap(entry => entry.event.type === "sent" && entry.event.document === "Corrected CD"
    ? [{ sequence: entry.sequence, version: entry.event.version, on: entry.event.on }] : []);
  const entriesByNumber = new Map(active.map(({ sequence, event }) => [sequence, event]));
  const receiptDates = new Map(active.flatMap(({ event }) => event.type === "element" ? [[event.element, event.on] as const] : []));
  const estimateReceipts = active.filter(({ event }) => isLoanEstimateReceipt(event));
  const intents = active.filter(({ event }) => event.type === "intent");
  const selectedLink = entriesByNumber.get(Number(linkedSequence));
  const linkWithdrawn = Boolean(linkedSequence && !selectedLink);
  const selectedReceipt = selectedLink?.type === "intent" ? entriesByNumber.get(selectedLink.receiptSequence) : selectedLink;
  const linkedEstimate = selectedReceipt && isLoanEstimateReceipt(selectedReceipt)
    ? `${selectedReceipt.document} · ${selectedReceipt.version} · Received ${recordedWhen(selectedReceipt)}`
    : selectedLink?.type === "intent" ? "The linked Loan Estimate receipt needs review." : "";
  return <details className="details-section trid-evidence" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>TRID application and delivery evidence</summary>
    {open && <div className="record-form compliance-pilot-form">
      <p className="muted">Internal Michigan pilot. Timing checks use staff-entered evidence for a covered consumer mortgage with one required disclosure recipient and no timing exception.</p>
      <div><Button size="sm" variant="outline" disabled={busy} onClick={() => { setReadError(""); setMessage(undefined); setRefresh(value => value + 1); }}>Refresh evidence</Button></div>
      {readError && <p role="alert" className="application-message banner-error">{readError}</p>}
      {!timing && !readError && <p role="status">Loading TRID evidence…</p>}
      {data && timing && <>
        <h3>Application and disclosure timing</h3>
        <dl className="trid-timing">
          <div><dt>Application receipt date</dt><dd>{timing.applicationOn ?? `${receiptDates.size} of 6 elements recorded`}</dd></div>
          <div><dt>Planned consummation</dt><dd>{timing.closingOn ?? "Missing date"}</dd></div>
          <div><dt>Initial Loan Estimate send</dt><dd>{timing.leStatus}{timing.leDue && ` · Due ${timing.leDue}`}</dd></div>
          <div><dt>Loan Estimate waiting period</dt><dd>{timing.leWait}{timing.leEarliest && ` · Earliest ${timing.leEarliest}`}</dd></div>
          <div><dt>Initial Closing Disclosure receipt</dt><dd>{timing.cdReceiptBasis}{timing.cdReceipt && ` · ${timing.cdReceipt}`}</dd></div>
          <div><dt>Closing Disclosure waiting period</dt><dd>{timing.cdWait}{timing.initialCdEarliest && ` · Initial earliest ${timing.initialCdEarliest}`}</dd></div>
        </dl>
        <details className="details-section">
          <summary>Application receipts ({receiptDates.size} of 6)</summary>
          <dl className="trid-timing" aria-label="Application receipt evidence">
            {Object.entries(tridElements).map(([key, label]) => <div key={key}><dt>{label}</dt>
              <dd>{receiptDates.get(key as keyof typeof tridElements) ?? "Receipt date missing"}</dd></div>)}
          </dl>
        </details>
        <details className="details-section">
          <summary>Intent and fee timing ({timing.feeEvidence.length})</summary>
          <p className="muted">Compare the recorded order of events. Credit report fee exceptions need a separate review.</p>
          {!timing.feeEvidence.length && <p>No intent or fee activity recorded.</p>}
          <ul className="document-list">
            {timing.feeEvidence.map(({ sequence, status }) => {
              const event = entriesByNumber.get(sequence);
              return event && <li className="document-item" key={sequence}><strong>{sequence}. {describe(event)}</strong><p>{status}</p></li>;
            })}
          </ul>
        </details>
        <TridFeeComparison active={active} />
        <MichiganChargeReviews active={active} reviews={data.michiganCharges} />
        <TridEstimateRevisionReviews active={active} reviews={data.estimateRevisions} />
        <TridClosingReviews cures={data.feeCures} corrections={data.correctedCds} actualOn={actual?.event.type === "consummated" ? actual.event.on : undefined} />
        {readOnly ? <p className="muted">Evidence is read-only for this view.</p> : <section className="record-form" aria-label="Record evidence">
          <h3>Record evidence</h3>
          <p className="muted">Use source references. Leave out SSNs and other borrower values.</p>
          <label className="field">Evidence to record<select disabled={busy} value={action}
            onChange={e => { setAction(e.target.value as keyof typeof actions); setLinkedSequence(""); setMessage(undefined); }}>
            {Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          {message && <div ref={feedback} tabIndex={-1} className={message.error ? "application-message banner-error" : "application-message"}
            role={message.error ? "alert" : "status"}>{message.text}</div>}
          <form key={`${action}:${formRevision}`} onSubmit={record} className="record-form">
            <fieldset disabled={busy} className="record-form">
              {action === "feeSnapshot" && <TridFeeSnapshotFields active={active} />}
              {action === "miChargeReview" && <MichiganChargeFields />}
              {action === "feeCure" && <>
                <label className="field">Actual consummation<select name="consummationSequence" required>
                  <option value="">Choose recorded consummation</option>
                  {actual?.event.type === "consummated" && <option value={actual.sequence}>{actual.event.on}</option>}
                </select></label>
                <div className="form-grid">
                  {(["estimateSequence", "closingSequence"] as const).map(name =>
                    <TridClosingSourceField key={name} name={name}
                      label={name === "estimateSequence" ? "Original estimate snapshot" : "Closing disclosure snapshot"}
                      choices={data.feeReview.snapshots.filter(item => name === "estimateSequence" ? item.document === "Initial LE" : item.document.endsWith("CD"))
                        .map(item => ({ sequence: item.sequence, version: item.version, on: item.sentOn }))} />)}
                </div>
                <label className="field">Documented refund amount (USD)<input name="refundAmount" inputMode="decimal" required pattern="[0-9]+([.][0-9]{1,2})?" /></label>
              </>}
              {(action === "feeCure" || action === "correctedCdReview") && <TridClosingSourceField
                name="correctedSendSequence" label={action === "feeCure" ? "Corrected disclosure send (if available)" : "Corrected disclosure send"}
                choices={correctedSends} optional={action === "feeCure"} />}
              {action === "correctedCdReview" && <label className="field">Reviewed correction reason<select name="correctedReason" required>
                <option value="">Choose a reason</option>
                {correctedCdReasons.map(reason => <option key={reason}>{reason}</option>)}
              </select></label>}
              {action === "estimateRevision" && <TridEstimateRevisionFields active={active} snapshots={data.feeReview.snapshots} />}
              {action === "scope" && <>
                <label className="compliance-choice"><input type="checkbox" name="coveredScenario" required /> This file matches the pilot scenario above.</label>
                <label className="field">Creditor<input name="creditor" required maxLength={180} defaultValue={timing.scope?.creditor} /></label>
                <div className="form-grid">
                  <label className="field">Responsible Loan Estimate sender<select name="leSender" defaultValue={timing.scope?.leSender}><option>Creditor</option><option>Broker</option></select></label>
                  <label className="field">Time zone for recorded dates<select name="zone" defaultValue={timing.scope?.zone}><option value="America/Detroit">Michigan Eastern</option><option value="America/Menominee">Michigan Central</option></select></label>
                  <label className="field">Office calendar begins<input name="calendarFrom" type="date" required defaultValue={timing.scope?.calendarFrom} /></label>
                  <label className="field">Office calendar ends<input name="calendarThrough" type="date" required defaultValue={timing.scope?.calendarThrough} /></label>
                </div>
                <fieldset className="record-form"><legend>Sender’s office open for substantially all business functions</legend>
                  <div className="loan-application-actions">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) =>
                    <label className="compliance-choice" key={day}><input name="openWeekdays" value={index} type="checkbox" defaultChecked={timing.scope?.openWeekdays.includes(index)} /> {day}</label>)}</div>
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
              {action === "intent" && <>
                <label className="field">Loan Estimate receipt<select name="receiptSequence" required value={linkedSequence} onChange={e => setLinkedSequence(e.target.value)}>
                  <option value="">Choose a receipt</option>
                  {linkWithdrawn && <option value={linkedSequence}>#{linkedSequence} · Receipt withdrawn</option>}
                  {estimateReceipts.map(({ sequence, event }) => isLoanEstimateReceipt(event) &&
                    <option key={sequence} value={sequence}>#{sequence} · {event.document} · {event.on}</option>)}
                </select></label>
                {linkedEstimate && <p className="muted">{linkedEstimate}</p>}
                {!estimateReceipts.length && <p className="muted">Record the Loan Estimate receipt first.</p>}
              </>}
              {action === "fee" && <>
                <label className="field">Fee name<input name="feeName" required maxLength={180} /></label>
                <div className="form-grid">
                  <label className="field">Fee category<select name="feeCategory"><option>Other</option><option>Credit report</option></select></label>
                  <label className="field">Activity<select name="feeActivity"><option>Fee imposed</option><option>Payment method required</option></select></label>
                </div>
                <label className="field">Linked intent to proceed<select name="intentSequence" value={linkedSequence} onChange={e => setLinkedSequence(e.target.value)}>
                  <option value="">Leave unlinked for review</option>
                  {linkWithdrawn && <option value={linkedSequence}>#{linkedSequence} · Intent withdrawn</option>}
                  {intents.map(({ sequence, event }) => event.type === "intent" &&
                    <option key={sequence} value={sequence}>#{sequence} · {recordedWhen(event)}</option>)}
                </select></label>
                {linkedEstimate && <p className="muted">{linkedEstimate}</p>}
                <p className="muted">Use the first time the fee or payment method was required. Record references only. Leave payment details out.</p>
              </>}
              {action === "void" ? <label className="field">Entry to withdraw<select name="sequence" required><option value="">Choose an entry</option>
                {data.entries.filter(entry => entry.event.type !== "void" && !withdrawn.has(entry.sequence)).map(entry =>
                  <option value={entry.sequence} key={entry.sequence}>{entry.sequence}. {describe(entry.event)}</option>)}
              </select></label> : action !== "scope" && action !== "feeSnapshot" && action !== "correctedCdReview" && action !== "miChargeReview" && <label className="field">{action === "closing" ? "Planned consummation date"
                : action === "sent" ? "Send date" : action === "intent" ? "Intent date" : action === "fee" ? "Activity date"
                : action === "estimateRevision" ? "Date sufficient information was received" : action === "consummated" ? "Actual consummation date"
                : action === "feeCure" ? "Refund date" : "Receipt date"}<input name="on" type="date" required /></label>}
              {(action === "received" || action === "intent" || action === "fee") &&
                <label className="field">Local time (optional)<input name="localTime" type="time" />
                  <span className="muted">Enter the time in the recorded review time zone when it helps establish same-day order.</span>
                </label>}
              <label className="field">{action === "scope" ? "Scope and office calendar evidence reference" : action === "void" ? "Correction reason or evidence reference" : "Evidence reference"}<input name="reference" required maxLength={180} /></label>
              <div><Button type="submit" size="sm">{busy ? "Recording…" : actions[action]}</Button></div>
            </fieldset>
          </form>
        </section>}
        <details className="details-section"><summary>Evidence history ({data.entries.length})</summary>
          {data.entries.length === 0 && <p>No evidence recorded.</p>}
          <ol className="document-list">{data.entries.map(entry => <li key={entry.sequence} className="document-item">
            <div><strong>{entry.sequence}. {describe(entry.event)}</strong><p>{entry.event.reference} · {entry.actor} · {entry.at}</p>
              {entry.event.type === "miChargeReview" && <MichiganChargeEvidence event={entry.event} />}
              {withdrawn.has(entry.sequence) && <p>Withdrawn by a later entry</p>}</div>
          </li>)}</ol>
        </details>
      </>}
    </div>}
  </details>;
}

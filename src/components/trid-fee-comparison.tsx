"use client";

import { useEffect, useRef, useState } from "react";
import { feeReviewBuckets } from "@/lib/trid-fee-comparison";
import { estimateRevisionBasis, reviewDisclosureFees, type reviewEstimateRevisions } from "@/lib/trid-fee-evidence";
import { estimateRevisionReasons, type TridEntry } from "@/lib/trid-model";
import { Button } from "./ui/button";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents: number | null) => cents === null ? "Missing" : dollars.format(cents / 100);

export function TridEstimateRevisionReviews({ active, reviews }: {
  active: TridEntry[];
  reviews: ReturnType<typeof reviewEstimateRevisions>;
}) {
  return <details className="details-section">
    <summary>Revised estimate reviews ({reviews.length})</summary>
    <div className="record-form">
      <p className="muted">Review the reason, dates and affected charges. The original fee comparison remains available.</p>
      {!reviews.length && <p>No revised estimate reviews recorded.</p>}
      {reviews.map(review => {
        const entry = active.find(item => item.sequence === review.sequence);
        if (entry?.event.type !== "estimateRevision") return null;
        const event = entry.event;
        const basis = estimateRevisionBasis(active, event);
        return <article className="document-item" key={review.sequence}>
          <strong>{event.reason}</strong>
          <p>Original snapshot #{event.originalSequence} · Revised snapshot #{event.revisedSequence}</p>
          {basis && <p>{basis.original.send.version} → {basis.revised.send.version}</p>}
          {review.issues.length > 1 ? <ul className="list-disc pl-5">{review.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
            : <p>{review.status}</p>}
          <p>Information received {event.on} · Send due {review.dueOn ?? "Unresolved"} · Actual receipt {review.receivedOn ?? "Missing"}</p>
          <p>Source {event.reference}{event.reviewReference && ` · Review ${event.reviewReference}`}</p>
          {basis && <ul className="document-list">{event.chargeKeys.map(key => {
            const original = basis.original.snapshot.lines.find(line => line.key === key);
            const revised = basis.revised.snapshot.lines.find(line => line.key === key)!;
            return <li className="document-item" key={key}><div><strong>{revised.label}</strong>
              <p>Original {money(original?.borrowerCents ?? null)} · Proposed {money(revised.borrowerCents)}</p></div></li>;
          })}</ul>}
          {!basis && <p>Affected charge keys: {event.chargeKeys.join(", ")}</p>}
        </article>;
      })}
    </div>
  </details>;
}

export function TridEstimateRevisionFields({ active, snapshots }: {
  active: TridEntry[];
  snapshots: ReturnType<typeof reviewDisclosureFees>["snapshots"];
}) {
  const [original, setOriginal] = useState("");
  const [revised, setRevised] = useState("");
  const [affected, setAffected] = useState<string[]>([]);
  const originalSnapshot = snapshots.find(item => item.document === "Initial LE" && String(item.sequence) === original);
  const revisedSnapshot = snapshots.find(item => item.document === "Revised LE" && String(item.sequence) === revised);
  const source = active.find(item => String(item.sequence) === revised)?.event;
  const charges = revisedSnapshot && source?.type === "feeSnapshot" ? source.lines : [];
  return <>
    <div className="form-grid">
      {([
        { name: "originalSequence", label: "Original estimate snapshot", document: "Initial LE", value: original, snapshot: originalSnapshot, change: setOriginal },
        { name: "revisedSequence", label: "Revised estimate snapshot", document: "Revised LE", value: revised, snapshot: revisedSnapshot,
          change: (value: string) => { setRevised(value); setAffected([]); } },
      ] as const).map(field => <div className="record-form" key={field.name}>
        <label className="field">{field.label}<select name={field.name} required value={field.value} onChange={e => field.change(e.target.value)}>
          <option value="">Choose a snapshot</option>
          {field.value && !field.snapshot && <option value={field.value}>Selected snapshot unavailable</option>}
          {snapshots.filter(item => item.document === field.document).map(item =>
            <option value={item.sequence} key={item.sequence}>#{item.sequence} · {item.sentOn}</option>)}
        </select></label>
        {field.snapshot && <p className="muted">Version {field.snapshot.version}</p>}
      </div>)}
    </div>
    <label className="field">Reason for the revision<select name="revisionReason">
      {estimateRevisionReasons.map(reason => <option key={reason}>{reason}</option>)}
    </select></label>
    <fieldset className="record-form">
      <legend>Affected charges</legend>
      {charges.map(charge => <label className="compliance-choice" key={charge.key}>
        <input type="checkbox" name="chargeKeys" value={charge.key} checked={affected.includes(charge.key)}
          onChange={e => {
            const checked = e.target.checked;
            setAffected(keys => checked ? [...keys, charge.key] : keys.filter(key => key !== charge.key));
          }} />
        <span className="min-w-0 break-words">{charge.label} · {money(charge.borrowerCents)} · {charge.key}</span>
      </label>)}
      {!charges.length && <p className="muted">{revisedSnapshot ? "This snapshot has no itemized charges." : "Select an active revised snapshot to choose its charges."}</p>}
      {!revisedSnapshot && affected.map(key => <input key={key} type="hidden" name="chargeKeys" value={key} />)}
    </fieldset>
    <label className="field">Review evidence reference (if available)<input name="reviewReference" maxLength={180} /></label>
  </>;
}

export function TridFeeSnapshotFields({ active }: { active: TridEntry[] }) {
  const [keys, setKeys] = useState([0]);
  const [selected, setSelected] = useState("");
  const next = useRef(1);
  const moveFocus = useRef<number | "add" | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const sends = active.flatMap(({ sequence, event }) => event.type === "sent" ? [{ sequence, event }] : []);
  const source = sends.find(({ sequence }) => String(sequence) === selected)?.event;
  const closing = source?.document.endsWith("CD");
  useEffect(() => {
    const target = moveFocus.current;
    if (target === null) return;
    (target === "add" ? addButton.current : inputs.current.get(target))?.focus();
    moveFocus.current = null;
  }, [keys]);
  return <>
    <label className="field">Disclosure version<select name="evidenceSequence" required value={selected} onChange={e => setSelected(e.target.value)}>
      <option value="">Choose a recorded send</option>
      {selected && !source && <option value={selected}>Selected send unavailable</option>}
      {sends.map(({ sequence, event }) => <option key={sequence} value={sequence}>
        #{sequence} · {event.document} · {event.on}
      </option>)}
    </select></label>
    {source && <p className="muted">Version {source.version}</p>}
    <p className="muted">Use the same charge key across versions. Enter borrower-paid amounts and select the reviewed classification.</p>
    {keys.map((key, index) => <fieldset key={key} className="record-form">
      <legend>Charge {index + 1}</legend>
      <div className="form-grid">
        <label className="field">Charge key<input name="feeLineKey" required maxLength={80} ref={element => {
          if (element) inputs.current.set(key, element);
          else inputs.current.delete(key);
        }} /></label>
        <label className="field">Label<input name="feeLineLabel" required maxLength={160} /></label>
        <label className="field">Borrower amount (USD)<input name="feeLineAmount" inputMode="decimal" required pattern="[0-9]+([.][0-9]{1,2})?" /></label>
        <label className="field">Classification<select name="feeLineBucket" defaultValue="Unclassified">
          {feeReviewBuckets.map(bucket => <option key={bucket}>{bucket}</option>)}
        </select></label>
      </div>
      {closing && <label className="compliance-choice"><input name={`feeNotObtained_${index}`} type="checkbox" /> Service not obtained</label>}
      <div><Button variant="outline" type="button" size="sm" onClick={() => {
        moveFocus.current = keys[index + 1] ?? keys[index - 1] ?? "add";
        setKeys(rows => rows.filter(row => row !== key));
      }}>Remove charge {index + 1}</Button></div>
    </fieldset>)}
    <div><Button ref={addButton} type="button" variant="outline" size="sm" disabled={keys.length >= 150} onClick={() => {
      const key = next.current++;
      moveFocus.current = key;
      setKeys(rows => [...rows, key]);
    }}>Add charge</Button></div>
    <label className="compliance-choice"><input name="feeComplete" type="checkbox" /> All relevant charges are included</label>
  </>;
}

export function readFeeSnapshotLines(form: FormData) {
  const labels = form.getAll("feeLineLabel");
  const amounts = form.getAll("feeLineAmount");
  const buckets = form.getAll("feeLineBucket");
  return form.getAll("feeLineKey").map((key, index) => {
    const amount = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amounts[index]));
    const borrowerCents = amount ? Number(amount[1]) * 100 + Number((amount[2] ?? "").padEnd(2, "0")) : NaN;
    return { key, label: labels[index], bucket: buckets[index], borrowerCents,
      ...(form.has(`feeNotObtained_${index}`) ? { notObtained: true } : {}) };
  });
}

export function TridFeeComparison({ active }: { active: TridEntry[] }) {
  const [estimate, setEstimate] = useState("");
  const [closing, setClosing] = useState("");
  const basis = estimate && closing ? { estimateSequence: Number(estimate), closingSequence: Number(closing) } : undefined;
  const { snapshots, comparison, unavailable } = reviewDisclosureFees(active, basis);
  const estimates = snapshots.filter(item => item.document === "Initial LE");
  const closings = snapshots.filter(item => item.document.endsWith("CD"));
  const selectedEstimate = estimates.find(item => String(item.sequence) === estimate);
  const selectedClosing = closings.find(item => String(item.sequence) === closing);
  const option = (item: typeof snapshots[number]) => <option key={item.sequence} value={item.sequence}>
    #{item.sequence} · {item.document} · {item.complete ? "Complete" : "Partial"}
  </option>;
  return <details className="details-section">
    <summary>Disclosure fee comparison</summary>
    <div className="record-form">
      <p className="muted">Compare staff-entered charges against the original Loan Estimate. Revised estimate eligibility, credits and cures require separate review.</p>
      <div className="form-grid">
        <label className="field">Original estimate<select value={estimate} onChange={event => setEstimate(event.target.value)}>
          <option value="">Choose an original estimate</option>
          {estimate && !selectedEstimate && <option value={estimate}>Unavailable snapshot</option>}
          {estimates.map(option)}
        </select></label>
        <label className="field">Closing Disclosure<select value={closing} onChange={event => setClosing(event.target.value)}>
          <option value="">Choose a Closing Disclosure</option>
          {closing && !selectedClosing && <option value={closing}>Unavailable snapshot</option>}
          {closings.map(option)}
        </select></label>
      </div>
      {(selectedEstimate || selectedClosing) && <dl className="trid-timing">
        {selectedEstimate && <div><dt>Original estimate version</dt><dd>{selectedEstimate.version} · {selectedEstimate.sentOn}</dd></div>}
        {selectedClosing && <div><dt>Closing Disclosure version</dt><dd>{selectedClosing.version} · {selectedClosing.sentOn}</dd></div>}
      </dl>}
      {unavailable && <p role="status">The selected versions cannot be compared. Review their dates or select active snapshots.</p>}
      {!basis && <p>Choose both fee snapshots to compare them.</p>}
      {comparison && <>
        <dl className="trid-timing">
          <div><dt>Recorded individual increases</dt><dd>{money(comparison.individualExcessCents)}</dd></div>
          <div><dt>10% aggregate excess</dt><dd>{comparison.aggregateExcessCents === null ? "Needs complete evidence" : money(comparison.aggregateExcessCents)}</dd></div>
          <div><dt>Potential excess</dt><dd>{comparison.potentialExcessCents === null ? "Needs review" : money(comparison.potentialExcessCents)}</dd></div>
        </dl>
        <ul className="document-list">
          {comparison.rows.map(row => <li className="document-item" key={row.key}><div>
            <strong>{row.label}</strong>
            <p>{row.classificationConflict ? "Review conflicting classifications" : row.needsClosingEvidence
              ? "Review whether the service was obtained" : row.notObtained ? "Service not obtained" : row.bucket}</p>
            <p>Estimate {money(row.estimatedCents)} · Closing {money(row.chargedCents)} · Change {money(row.differenceCents)}</p>
          </div></li>)}
        </ul>
      </>}
    </div>
  </details>;
}

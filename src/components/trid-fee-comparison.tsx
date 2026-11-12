"use client";

import { useState } from "react";
import { feeReviewBuckets } from "@/lib/trid-fee-comparison";
import { reviewDisclosureFees } from "@/lib/trid-fee-evidence";
import type { TridEntry } from "@/lib/trid-model";
import { Button } from "./ui/button";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents: number | null) => cents === null ? "Missing" : dollars.format(cents / 100);

export function TridFeeSnapshotFields({ active }: { active: TridEntry[] }) {
  const [keys, setKeys] = useState([0]);
  const [next, setNext] = useState(1);
  const sends = active.filter(({ event }) => event.type === "sent");
  return <>
    <label className="field">Disclosure version<select name="evidenceSequence" required>
      <option value="">Choose a recorded send</option>
      {sends.map(({ sequence, event }) => event.type === "sent" && <option key={sequence} value={sequence}>
        {sequence}. {event.document} · {event.version}
      </option>)}
    </select></label>
    <p className="muted">Use the same charge key across versions. Enter borrower-paid amounts and select the reviewed classification.</p>
    {keys.map((key, index) => <fieldset key={key} className="record-form">
      <legend>Charge {index + 1}</legend>
      <div className="form-grid">
        <label className="field">Charge key<input name="feeLineKey" required maxLength={80} /></label>
        <label className="field">Label<input name="feeLineLabel" required maxLength={160} /></label>
        <label className="field">Borrower amount (USD)<input name="feeLineAmount" inputMode="decimal" required pattern="[0-9]+([.][0-9]{1,2})?" /></label>
        <label className="field">Classification<select name="feeLineBucket" defaultValue="Unclassified">
          {feeReviewBuckets.map(bucket => <option key={bucket}>{bucket}</option>)}
        </select></label>
      </div>
      <div><Button variant="outline" type="button" size="sm" onClick={() => setKeys(rows => rows.filter(row => row !== key))}>Remove charge {index + 1}</Button></div>
    </fieldset>)}
    <div><Button type="button" variant="outline" size="sm" disabled={keys.length >= 150} onClick={() => {
      setKeys(rows => [...rows, next]);
      setNext(value => value + 1);
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
    return { key, label: labels[index], bucket: buckets[index], borrowerCents };
  });
}

export function TridFeeComparison({ active }: { active: TridEntry[] }) {
  const [estimate, setEstimate] = useState("");
  const [closing, setClosing] = useState("");
  const basis = estimate && closing ? { estimateSequence: Number(estimate), closingSequence: Number(closing) } : undefined;
  const { snapshots, comparison, unavailable } = reviewDisclosureFees(active, basis);
  const estimates = snapshots.filter(item => item.document === "Initial LE");
  const closings = snapshots.filter(item => item.document.endsWith("CD"));
  const option = (item: typeof snapshots[number]) => <option key={item.sequence} value={item.sequence}>
    {item.document} · {item.version} · {item.complete ? "Complete" : "Partial"}
  </option>;
  return <details className="details-section">
    <summary>Disclosure fee comparison</summary>
    <div className="record-form">
      <p className="muted">Compare staff-entered charges against the original Loan Estimate. Revised estimate eligibility, credits and cures require separate review.</p>
      <div className="form-grid">
        <label className="field">Original estimate<select value={estimate} onChange={event => setEstimate(event.target.value)}>
          <option value="">Choose an original estimate</option>
          {estimate && !estimates.some(item => String(item.sequence) === estimate) && <option value={estimate}>Unavailable snapshot</option>}
          {estimates.map(option)}
        </select></label>
        <label className="field">Closing Disclosure<select value={closing} onChange={event => setClosing(event.target.value)}>
          <option value="">Choose a Closing Disclosure</option>
          {closing && !closings.some(item => String(item.sequence) === closing) && <option value={closing}>Unavailable snapshot</option>}
          {closings.map(option)}
        </select></label>
      </div>
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
            <p>{row.classificationConflict ? "Review conflicting classifications" : row.bucket}</p>
            <p>Estimate {money(row.estimatedCents)} · Closing {money(row.chargedCents)} · Change {money(row.differenceCents)}</p>
          </div></li>)}
        </ul>
      </>}
    </div>
  </details>;
}

"use client";

import { useState } from "react";
import { michiganChargeAuthority, michiganChargeCategories, michiganGuaranteeExtensions, type reviewMichiganCharges } from "@/lib/michigan-charge-review";
import type { TridEntry } from "@/lib/trid-model";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function MichiganChargeFields() {
  const [category, setCategory] = useState<string>("");
  const [extension, setExtension] = useState<string>("Unresolved");
  return <>
    <p id="mi-charge-scope-help">Record one charge from the assessment and payment records. Confirm who assessed or accepted it, and reuse the charge key for corrections.</p>
    <div className="form-grid items-start">
      <label className="field">Charge name<input name="chargeName" maxLength={180} required /></label>
      <label className="field">Charge key<input name="chargeKey" maxLength={80} required /></label>
      <label className="field">Michigan scope<select name="chargeApplicability" aria-describedby="mi-charge-scope-help">
        <option>Unresolved</option><option value="First mortgage by this licensee or registrant">Covered first mortgage</option>
      </select></label>
      <label className="field">Charge type<select name="chargeCategory" value={category} required onChange={e => {
        setCategory(e.target.value); setExtension("Unresolved");
      }}>
        <option value="">Choose a charge type</option>
        {michiganChargeCategories.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label className="field">Amount charged (USD)<input name="charged" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required /></label>
      <label className="field">Total paid before refunds (USD)<input name="paid" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" /></label>
      <label className="field">Number of collections<input name="collections" type="number" min={0} max={1000} /></label>
      {category === "Actual expense" && <>
        <label className="field">Documented actual expense (USD)<input name="expense" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" /></label>
        <label className="field">Actual expense evidence reference<input name="expenseReference" maxLength={180} /></label>
      </>}
      {category === "Rate guarantee" && <>
        <label className="field">Written guarantee terms reference<input name="termsReference" maxLength={180} /></label>
        <label className="field">Original expiration<input name="originalExpiry" type="date" /></label>
        <label className="field">Guarantee extension<select name="extension" value={extension} onChange={e => setExtension(e.target.value)}>
          {michiganGuaranteeExtensions.map(item => <option key={item}>{item}</option>)}
        </select></label>
        {extension === "Extended" && <>
          <label className="field">Extended expiration<input name="extendedExpiry" type="date" /></label>
          <label className="field">Written extension agreed to by all parties<textarea name="extensionReference" rows={2} maxLength={180} /></label>
        </>}
      </>}
    </div>
    <p className="muted">Leave unknown figures or references blank so they stay open for review. Enter zero for confirmed no payments or collections.</p>
  </>;
}

export function MichiganChargeReviews({ active, reviews }: {
  active: readonly TridEntry[];
  reviews: ReturnType<typeof reviewMichiganCharges>;
}) {
  const bySequence = new Map(active.map(({ sequence, event }) => [sequence, event]));
  return <details className="details-section">
    <summary className="min-h-11 content-center">Michigan charge review ({reviews.length})</summary>
    <p>Review recorded charges and guarantee evidence under Michigan’s first-mortgage law. <a className="underline" href={michiganChargeAuthority} target="_blank" rel="noreferrer">MCL 445.1673</a></p>
    {reviews.length === 0 ? <p>No Michigan charge evidence recorded.</p> : <ul className="document-list">
      {reviews.map(({ sequence, issues }) => {
        const event = bySequence.get(sequence);
        if (event?.type !== "miChargeReview") return null;
        return <li className="document-item" key={sequence}>
          <div className="min-w-0 break-words">
            <strong>{event.name}</strong>
            <MichiganChargeEvidence event={event} />
            {issues.length ? <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> :
              <p>Recorded evidence passed these checks. Applicability and reasonableness still require review.</p>}
            <p className="muted">Entry {sequence} · {event.reference}</p>
          </div>
        </li>;
      })}
    </ul>}
  </details>;
}

export function MichiganChargeEvidence({ event }: { event: Extract<TridEntry["event"], { type: "miChargeReview" }> }) {
  return <>
    <p>{event.category} · {money.format(event.chargedCents / 100)} charged</p>
    {event.paidCents !== undefined && <p>{money.format(event.paidCents / 100)} paid before refunds
      {event.collections !== undefined && ` · ${event.collections} collections`}</p>}
    {event.category === "Actual expense" && event.expenseCents !== undefined && <p>Actual expense {money.format(event.expenseCents / 100)}
      {event.expenseReference && ` · ${event.expenseReference}`}</p>}
    {event.category === "Rate guarantee" && <>
      {event.originalExpiry && <p>Original expiration {event.originalExpiry}</p>}
      {event.termsReference && <p>Written terms · {event.termsReference}</p>}
      {event.extension && <p>{event.extension === "Unresolved" ? "Extension unresolved" : event.extension}
        {event.extendedExpiry && ` · Through ${event.extendedExpiry}`}
        {event.extensionReference && ` · ${event.extensionReference}`}</p>}
    </>}
  </>;
}

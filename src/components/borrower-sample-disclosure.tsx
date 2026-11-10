"use client";

import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { dateLabel } from "@/lib/client-retention";
import type { BorrowerDisclosure, BorrowerDisclosureResponse } from "@/lib/disclosure-model";
import { feeKeys, feeLabels, sampleFeeLabel } from "@/lib/quote-worksheet";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";
import { borrowerDisclosureTarget } from "@/lib/borrower-action-model";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function BorrowerSampleDisclosure({ item, busy, respond }: {
  item: BorrowerDisclosure; busy: boolean; respond: (input: BorrowerDisclosureResponse) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const { signer, state, terms, fees, version } = item;
  const actionable = signer.status === "Pending" && state === "Available";
  return <section className="application-panel application-receipt document-section" aria-label="Sample disclosure package"
    id={borrowerDisclosureTarget} tabIndex={-1} data-borrower-action-target>
    <div className="document-item-head">
      <h2><FileCheck2 size={19} /> Sample disclosure package</h2>
      <span className="pill">Mock signing · v{version}</span>
    </div>
    <p className="muted">Signing target {dateLabel(item.signBy)} · Issued {dateTime(item.issuedAt)} ET</p>
    {state === "Awaiting revision" && <p role="status">Your loan team is preparing a revised sample package.</p>}
    {state === "Closed" && signer.status === "Pending" && <p>This package is closed.</p>}
    {signer.status !== "Pending" && <div className="borrower-next">
      <strong>{signer.status === "Signed" ? "Your mock signature was recorded" : "Your mock decline was recorded"}</strong>
      {signer.actedAt && <p>{dateTime(signer.actedAt)} ET · {signer.receipt}</p>}
    </div>}
    <details className="document-form">
      <summary>Review the sample documents</summary>
      <div className="record-form">
        <ul>{item.documents.map((document) => <li key={document}>{document}</li>)}</ul>
        {item.documents.includes("Sample loan terms") && <p>{terms.product} · {terms.rate.toFixed(3)}% · {money(terms.loanAmount)}</p>}
        {fees && <>
          <p>Estimated closing costs {dollars.format(fees.closingCosts / 100)} · Estimated cash to close {dollars.format(fees.cashToClose / 100)}</p>
          <ul>{feeKeys.map((key) => <li key={key}>{feeLabels[key]} · {sampleFeeLabel({ fees: fees.items, allocations: fees.allocations }, key)}</li>)}</ul>
        </>}
      </div>
    </details>
    {actionable && <div className="record-form">
      <label className="demo-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
        I reviewed this fictional package and understand my response is simulated.</label>
      <div className="loan-application-actions">
        <Button size="sm" disabled={busy || !confirmed} onClick={() => respond({ type: "respondToSampleDisclosure", version, response: "Signed", confirmedDemo: true })}>Record mock signature</Button>
        <Button size="sm" variant="outline" disabled={busy || !confirmed} onClick={() => respond({ type: "respondToSampleDisclosure", version, response: "Declined", confirmedDemo: true })}>Record mock decline</Button>
      </div>
    </div>}
  </section>;
}

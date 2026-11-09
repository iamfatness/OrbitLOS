"use client";

import { useState } from "react";
import type { PricingOffer, PricingRun } from "@/lib/pricing-model";
import { blankFees, estimateFees, feeKeys, feeLabels, type FeeInputs, type FeeWorksheet, type QuoteOption, type QuotePresentation } from "@/lib/quote-worksheet";
import { Button } from "./ui/button";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatFee = (value: number) => usd.format(value / 100);
const toCents = (value: string) => Math.round(Number(value) * 100);
const amountText = (value: number | null) => value === null ? "" : String(value / 100);
const additionalFields = {
  purchasePrice: "Purchase price", payoffs: "Estimated refinance payoffs", deposit: "Deposit already paid",
  sellerCredits: "Seller credits", otherCredits: "Other credits",
} as const;

function cashLabel(option: Pick<QuoteOption, "estimate" | "purpose">) {
  if ((option.estimate?.cashToClose ?? 0) >= 0) return "Estimated cash to close";
  return option.purpose === "Refinance" ? "Estimated cash to borrower" : "Estimated excess credits";
}

export function FeeWorksheetEditor({ run, offer, saved, busy, save }: {
  run: PricingRun; offer: PricingOffer; saved?: FeeWorksheet; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const purchase = run.scenario.purpose === "Purchase";
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const fees = saved?.inputs.fees ?? blankFees();
    return {
      ...Object.fromEntries(feeKeys.map((key) => [key, amountText(fees[key])])),
      purchasePrice: amountText(saved?.inputs.purchasePrice ?? (run.scenario.purchasePrice === null ? null : Math.round(run.scenario.purchasePrice * 100))),
      payoffs: amountText(saved?.inputs.payoffs ?? null), deposit: amountText(saved?.inputs.deposit ?? 0),
      sellerCredits: amountText(saved?.inputs.sellerCredits ?? 0), otherCredits: amountText(saved?.inputs.otherCredits ?? 0),
    };
  });
  const fees = blankFees();
  for (const key of feeKeys) fees[key] = toCents(fields[key]);
  const inputs: FeeInputs = {
    fees, purchasePrice: purchase && fields.purchasePrice ? toCents(fields.purchasePrice) : null,
    payoffs: !purchase && fields.payoffs ? toCents(fields.payoffs) : null,
    deposit: purchase ? toCents(fields.deposit) : 0, sellerCredits: purchase ? toCents(fields.sellerCredits) : 0, otherCredits: toCents(fields.otherCredits),
  };
  const estimate = estimateFees(run.scenario, offer, inputs);
  const valid = Object.values(fields).every((value) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 25_000_000));
  const label = `${offer.product} at ${offer.rate.toFixed(3)}%`;
  function field(name: string, caption: string, required = false) {
    return <label className="field" key={name}>{caption}<input type="number" min={0} max={25_000_000} step="0.01"
      name={name} required={required} value={fields[name]} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} /></label>;
  }
  function loadSample() {
    setFields({ ...fields, origination: "995", appraisal: "650", creditReport: "85", settlement: "1400", government: "250",
      prepaid: "825", escrow: "1100", other: "0",
      purchasePrice: fields.purchasePrice || String(run.scenario.purchasePrice ?? run.scenario.propertyValue),
      payoffs: fields.payoffs || String(Math.max(0, run.scenario.loanAmount - 10_000)) });
  }

  return <details className="document-form">
    <summary>Fee worksheet · {label}</summary>
    <p className="muted">Enter sample amounts in dollars. Points and lender credits come from this pricing option.</p>
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      if (estimate && valid) void save({ type: "saveFeeWorksheet", loanId: run.loanId, runId: run.id, offerId: offer.id,
        feeRevision: saved?.revision ?? 0, worksheet: inputs });
    }}>
      <div className="form-grid">
        {purchase ? field("purchasePrice", additionalFields.purchasePrice, true) : field("payoffs", additionalFields.payoffs, true)}
        {feeKeys.map((key) => field(key, feeLabels[key]))}
        {purchase && field("deposit", additionalFields.deposit)}
        {purchase && field("sellerCredits", additionalFields.sellerCredits)}
        {field("otherCredits", additionalFields.otherCredits)}
      </div>
      {valid && estimate && <p>Estimated closing costs {formatFee(estimate.closingCosts)} · {cashLabel({ estimate, purpose: run.scenario.purpose })} {formatFee(Math.abs(estimate.cashToClose))}</p>}
      {valid && !estimate && <p className="muted">{purchase ? "Enter a purchase price at or above the loan amount." : "Enter estimated payoffs, including zero if applicable."}</p>}
      <div className="loan-application-actions">
        <Button size="sm" variant="outline" type="button" onClick={loadSample} disabled={busy}>Load sample fees</Button>
        <Button size="sm" type="submit" disabled={busy || !estimate || !valid}>Save fee worksheet</Button>
      </div>
    </form>
  </details>;
}

function ItemizedFees({ option }: { option: QuoteOption }) {
  const estimate = option.estimate;
  if (!estimate) return <p className="muted">A fee worksheet hasn’t been prepared for this option.</p>;
  const input = estimate.inputs;
  return <dl className="quote-terms">
    <div><dt>{option.purpose === "Purchase" ? "Purchase price" : "Estimated refinance payoffs"}</dt><dd>{formatFee(input.purchasePrice ?? input.payoffs ?? 0)}</dd></div>
    {feeKeys.filter((key) => input.fees[key] > 0).map((key) => <div key={key}><dt>{feeLabels[key]}</dt><dd>{formatFee(input.fees[key])}</dd></div>)}
    {estimate.points > 0 && <div><dt>Discount points</dt><dd>{formatFee(estimate.points)}</dd></div>}
    {estimate.lenderCredit > 0 && <div><dt>Lender credit</dt><dd>{formatFee(-estimate.lenderCredit)}</dd></div>}
    <div><dt>Estimated closing costs</dt><dd>{formatFee(estimate.closingCosts)}</dd></div>
    {estimate.downPayment !== null && <div><dt>Down payment</dt><dd>{formatFee(estimate.downPayment)}</dd></div>}
    {input.deposit > 0 && <div><dt>Deposit already paid</dt><dd>{formatFee(-input.deposit)}</dd></div>}
    {input.sellerCredits > 0 && <div><dt>Seller credits</dt><dd>{formatFee(-input.sellerCredits)}</dd></div>}
    {input.otherCredits > 0 && <div><dt>Other credits</dt><dd>{formatFee(-input.otherCredits)}</dd></div>}
    <div><dt>{cashLabel(option)}</dt><dd>{formatFee(Math.abs(estimate.cashToClose))}</dd></div>
  </dl>;
}

export function SampleQuotePresentation({ quote }: { quote: QuotePresentation }) {
  const options = [quote.primary, ...quote.alternatives];
  const comparisons = [
    { label: "Loan amount", display: (option: QuoteOption) => usd.format(option.loanAmount) },
    { label: "Term", display: (option: QuoteOption) => `${option.years} years` },
    { label: "Interest rate", display: (option: QuoteOption) => `${option.rate.toFixed(3)}%` },
    { label: "Monthly principal and interest", display: (option: QuoteOption) => usd.format(option.principalAndInterest) },
    { label: "Estimated closing costs", display: (option: QuoteOption) => option.estimate ? formatFee(option.estimate.closingCosts) : "Worksheet pending" },
    { label: "Estimated cash at closing", display: (option: QuoteOption) => option.estimate
      ? `${formatFee(Math.abs(option.estimate.cashToClose))} · ${cashLabel(option)}` : "Worksheet pending" },
  ];
  return <div className="document-section">
    <p className="eyebrow">Fictional sample pricing · For discussion</p>
    {options.length === 1 ? <dl className="quote-terms">{comparisons.slice(0, 4).map((item) =>
      <div key={item.label}><dt>{item.label}</dt><dd>{item.display(quote.primary)}</dd></div>)}</dl> :
      <>
        <p className="quote-comparison-hint muted">Scroll across to compare all options.</p>
        <div className="table-scroll quote-comparison-scroll" role="region" aria-label="Sample quote options" tabIndex={0}><table className="data-table">
        <caption className="sr-only">Side-by-side sample quote comparison</caption>
        <thead><tr><th scope="col">Terms</th>{options.map((option, index) =>
          <th scope="col" key={index}>{index === 0 ? "Selected" : `Alternative ${index}`}<small>{option.product}</small></th>)}</tr></thead>
        <tbody>{comparisons.map((item) => <tr key={item.label}><th scope="row">{item.label}</th>
          {options.map((option, index) => <td key={index}>{item.display(option)}</td>)}</tr>)}</tbody>
        </table></div>
      </>}
    {options.map((option, index) => <details className="document-form" key={index} open={options.length === 1}>
      <summary>Itemized fees · {option.product} at {option.rate.toFixed(3)}%</summary>
      <ItemizedFees option={option} />
    </details>)}
    <p className="muted">Monthly principal and interest excludes taxes, insurance, association dues, and other monthly costs.</p>
  </div>;
}

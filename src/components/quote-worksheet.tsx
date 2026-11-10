"use client";

import { useState } from "react";
import { preflightFeeField, preflightFeesTarget } from "@/lib/file-preflight-model";
import type { PricingOffer, PricingRun } from "@/lib/pricing-model";
import { compareQuoteCosts } from "@/lib/quote-cost-comparison";
import { allocatedFeeLine, blankFees, estimateFees, feeAllocationIssue, feeAllocationLabel, feeAllocations, feeContributionKeys,
  feeContributionLabels, feeKeys, feeLabels, missingFees,
  type FeeInputs, type FeeKey, type FeeTemplateOrigin, type FeeWorksheet, type QuoteOption, type QuotePresentation } from "@/lib/quote-worksheet";
import { FeeTemplatePicker } from "./fee-templates";
import { Button } from "./ui/button";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatFee = (value: number) => usd.format(value / 100);
const toCents = (value: string) => Math.round(Number(value) * 100);
const amountText = (value: number | null) => value === null ? "" : String(value / 100);
const additionalFields = {
  purchasePrice: "Purchase price", payoffs: "Estimated refinance payoffs", deposit: "Deposit already paid",
  sellerCredits: "Additional seller credits", otherCredits: "Additional other credits",
} as const;
const emptyAllocation = { payee: "", seller: "", lender: "", other: "" };
type AllocationDraft = Partial<Record<FeeKey, typeof emptyAllocation>>;

function cashLabel(option: Pick<QuoteOption, "estimate" | "purpose">) {
  if ((option.estimate?.cashToClose ?? 0) >= 0) return "Estimated cash to close";
  return option.purpose === "Refinance" ? "Estimated cash to borrower" : "Estimated excess credits";
}

function FeeSource({ origin, fees }: { origin: FeeTemplateOrigin; fees: FeeInputs["fees"] }) {
  const overrides = feeKeys.filter((key) => fees[key] !== origin.fees[key]);
  return <div className="document-item">
    <p><strong>{origin.title} · Version {origin.revision}</strong></p>
    <p className="muted">{origin.source} · Effective {origin.effectiveOn} · {origin.zip || "Any ZIP"}</p>
    {overrides.length > 0 && <p className="muted">Edited for this quote · {overrides.map((key) => feeLabels[key]).join(", ")}</p>}
  </div>;
}

export function FeeWorksheetEditor({ run, offer, saved, busy, save, brokerageId, current, focused, stageBlocked }: {
  run: PricingRun; offer: PricingOffer; saved?: FeeWorksheet; busy: boolean; save: (input: unknown) => Promise<void>;
  brokerageId: string; current: boolean; focused?: string; stageBlocked: boolean;
}) {
  const purchase = run.scenario.purpose === "Purchase";
  const canEdit = current && !stageBlocked;
  const [origin, setOrigin] = useState<FeeTemplateOrigin | undefined>(saved?.origin);
  const [allocations, setAllocations] = useState<AllocationDraft>(() => Object.fromEntries(
    Object.entries(saved?.inputs.allocations ?? {}).map(([key, split]) => [key, {
      payee: split.payee, seller: split.seller ? amountText(split.seller) : "", lender: split.lender ? amountText(split.lender) : "",
      other: split.other ? amountText(split.other) : "",
    }]),
  ));
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
  for (const key of feeKeys) fees[key] = fields[key] === "" ? null : toCents(fields[key]);
  const splits = Object.fromEntries(feeKeys.flatMap((key) => {
    const draft = allocations[key];
    return draft ? [[key, { payee: draft.payee.trim(), seller: toCents(draft.seller),
      lender: toCents(draft.lender), other: toCents(draft.other) }]] : [];
  }));
  const checkedSplits = feeAllocations.safeParse(splits);
  const inputs: FeeInputs = {
    fees, purchasePrice: purchase && fields.purchasePrice ? toCents(fields.purchasePrice) : null,
    payoffs: !purchase && fields.payoffs ? toCents(fields.payoffs) : null,
    deposit: purchase ? toCents(fields.deposit) : 0, sellerCredits: purchase ? toCents(fields.sellerCredits) : 0, otherCredits: toCents(fields.otherCredits),
    ...(checkedSplits.success ? { allocations: checkedSplits.data } : {}),
  };
  const allocationIssue = checkedSplits.success ? feeAllocationIssue(inputs, purchase) : checkedSplits.error.issues[0]?.message ?? "Check the fee contributions.";
  const estimate = allocationIssue ? null : estimateFees(run.scenario, offer, inputs);
  const missing = missingFees(fees);
  const valid = Object.values(fields).every((value) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 25_000_000));
  const label = `${offer.product} at ${offer.rate.toFixed(3)}%`;
  const editableFeeKeys = feeKeys.filter((key) => (fees[key] ?? 0) > 0 || allocations[key]);
  function changeAllocation(key: FeeKey, field: keyof typeof emptyAllocation, value: string) {
    setAllocations((current) => ({ ...current, [key]: { ...(current[key] ?? emptyAllocation), [field]: value } }));
  }
  function field(name: string, caption: string, required = false) {
    return <label className="field" key={name}>{caption}<input type="number" min={0} max={25_000_000} step="0.01" id={focused === preflightFeeField(name) ? focused : undefined}
      name={name} required={required} disabled={!canEdit || busy} value={fields[name]} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} /></label>;
  }
  function loadSample() {
    setOrigin(undefined);
    setFields({ ...fields, origination: "995", appraisal: "650", creditReport: "85", settlement: "1400", government: "250",
      prepaid: "825", escrow: "1100", other: "0",
      purchasePrice: fields.purchasePrice || String(run.scenario.purchasePrice ?? run.scenario.propertyValue),
      payoffs: fields.payoffs || String(Math.max(0, run.scenario.loanAmount - 10_000)) });
  }

  return <details className="document-form" id={focused ? preflightFeesTarget : undefined} open={focused ? true : undefined}>
    <summary>Fee worksheet · {label}</summary>
    <p className="muted">Enter sample amounts in dollars. Leave unknown fees blank. Points and lender credits come from this pricing option.</p>
    {!current && <p className="muted">Reprice the current 1003 before editing this worksheet.</p>}
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      if (estimate && valid && canEdit) void save({ type: "saveAllocatedFeeWorksheet", loanId: run.loanId, runId: run.id, offerId: offer.id,
        feeRevision: saved?.revision ?? 0, worksheet: inputs, template: origin ? { id: origin.id, revision: origin.revision } : null });
    }}>
      {canEdit && <FeeTemplatePicker brokerageId={brokerageId} loanId={run.loanId} runId={run.id} disabled={busy} onLoad={(template) => {
        setOrigin(template);
        setFields((last) => ({ ...last, ...Object.fromEntries(feeKeys.map((key) => [key, amountText(template.fees[key])])) }));
      }} />}
      {origin && <FeeSource origin={origin} fees={fees} />}
      <div className="form-grid">
        {purchase ? field("purchasePrice", additionalFields.purchasePrice, true) : field("payoffs", additionalFields.payoffs, true)}
        {feeKeys.map((key) => field(key, feeLabels[key]))}
        {purchase && field("deposit", additionalFields.deposit)}
        {purchase && field("sellerCredits", additionalFields.sellerCredits)}
        {field("otherCredits", additionalFields.otherCredits)}
      </div>
      {editableFeeKeys.length > 0 && <details className="document-form">
        <summary>Payer and payee details</summary>
        <p className="muted">Use fictional company names. Enter amounts each party pays directly. The borrower pays the remaining share. Record general credits in the credit fields above.</p>
        {editableFeeKeys.map((key) => {
          const draft = allocations[key] ?? emptyAllocation;
          const line = allocatedFeeLine(inputs, key);
          return <details className="document-form" key={key}>
            <summary>{feeLabels[key]} payment details{line && (line.payee || line.seller || line.lender || line.other) ? " · Allocated" : ""}</summary>
            <div className="form-grid">
              <label className="field">{feeLabels[key]} payee
                <input maxLength={80} value={draft.payee} disabled={!canEdit || busy} onChange={(event) => changeAllocation(key, "payee", event.target.value)} />
              </label>
              {feeContributionKeys.filter((party) => purchase || party !== "seller").map((party) => <label className="field" key={party}>
                {feeLabels[key]} {feeContributionLabels[party].toLowerCase()} amount
                <input type="number" min={0} max={25_000_000} step="0.01" value={draft[party]} disabled={!canEdit || busy}
                  onChange={(event) => changeAllocation(key, party, event.target.value)} />
              </label>)}
            </div>
            <p>Borrower share {line && line.borrower >= 0 ? formatFee(line.borrower) : allocations[key] ? "Check the allocation" : formatFee(fees[key] ?? 0)}</p>
            {allocations[key] && <Button size="sm" variant="outline" type="button" disabled={!canEdit || busy}
              onClick={() => setAllocations((last) => {
                const next = { ...last };
                delete next[key];
                return next;
              })}>Clear {feeLabels[key].toLowerCase()} allocation</Button>}
          </details>;
        })}
      </details>}
      {allocationIssue && <p role="alert">{allocationIssue}</p>}
      {valid && estimate && <p>Estimated closing costs {formatFee(estimate.closingCosts)} · {cashLabel({ estimate, purpose: run.scenario.purpose })} {formatFee(Math.abs(estimate.cashToClose))}
        {missing.length > 0 && " · Known fees only"}</p>}
      {valid && !estimate && !allocationIssue && <p className="muted">{purchase ? "Enter a purchase price at or above the loan amount." : "Enter estimated payoffs, including zero if applicable."}</p>}
      <div className="loan-application-actions">
        <Button size="sm" variant="outline" type="button" onClick={loadSample} disabled={busy || !canEdit}>Load sample fees</Button>
        <Button size="sm" type="submit" disabled={busy || !canEdit || !estimate || !valid}>Save fee worksheet</Button>
      </div>
    </form>
  </details>;
}

function ItemizedFees({ option }: { option: QuoteOption }) {
  const estimate = option.estimate;
  if (!estimate) return <p className="muted">A fee worksheet hasn’t been prepared for this option.</p>;
  const input = estimate.inputs;
  const missing = missingFees(input.fees);
  return <>
    {option.feeOrigin && <FeeSource origin={option.feeOrigin} fees={input.fees} />}
    {missing.length > 0 && <p className="muted">Totals include known fees only. Still unknown · {missing.map((key) => feeLabels[key]).join(", ")}.</p>}
    <dl className="quote-terms">
    <div><dt>{option.purpose === "Purchase" ? "Purchase price" : "Estimated refinance payoffs"}</dt><dd>{formatFee(input.purchasePrice ?? input.payoffs ?? 0)}</dd></div>
    {feeKeys.map((key) => {
      const amount = input.fees[key];
      const allocation = allocatedFeeLine(input, key);
      return amount !== null && amount > 0 ? <div key={key}><dt>{feeLabels[key]}</dt><dd>{formatFee(amount)}
        {allocation && <span className="quote-fee-allocation">{feeAllocationLabel(allocation)}</span>}</dd></div> : null;
    })}
    {estimate.points > 0 && <div><dt>Discount points</dt><dd>{formatFee(estimate.points)}</dd></div>}
    {estimate.lenderCredit > 0 && <div><dt>Lender credit</dt><dd>{formatFee(-estimate.lenderCredit)}</dd></div>}
    <div><dt>Estimated closing costs</dt><dd>{formatFee(estimate.closingCosts)}</dd></div>
    {estimate.downPayment !== null && <div><dt>Down payment</dt><dd>{formatFee(estimate.downPayment)}</dd></div>}
    {input.deposit > 0 && <div><dt>Deposit already paid</dt><dd>{formatFee(-input.deposit)}</dd></div>}
    {input.sellerCredits > 0 && <div><dt>{additionalFields.sellerCredits}</dt><dd>{formatFee(-input.sellerCredits)}</dd></div>}
    {input.otherCredits > 0 && <div><dt>{additionalFields.otherCredits}</dt><dd>{formatFee(-input.otherCredits)}</dd></div>}
    <div><dt>{cashLabel(option)}</dt><dd>{formatFee(Math.abs(estimate.cashToClose))}</dd></div>
  </dl></>;
}

export function SampleQuotePresentation({ quote }: { quote: QuotePresentation }) {
  const options = [quote.primary, ...quote.alternatives];
  const costs = options.length > 1 ? compareQuoteCosts(quote) : [];
  const partial = (option: QuoteOption) => option.estimate && missingFees(option.estimate.inputs.fees).length ? " · Known fees only" : "";
  const comparisons = [
    { label: "Loan amount", display: (option: QuoteOption) => usd.format(option.loanAmount) },
    { label: "Term", display: (option: QuoteOption) => `${option.years} years` },
    { label: "Interest rate", display: (option: QuoteOption) => `${option.rate.toFixed(3)}%` },
    { label: "Monthly principal and interest", display: (option: QuoteOption) => usd.format(option.principalAndInterest) },
    { label: "Estimated closing costs", display: (option: QuoteOption) => option.estimate ? formatFee(option.estimate.closingCosts) + partial(option) : "Worksheet pending" },
    { label: "Estimated cash at closing", display: (option: QuoteOption) => option.estimate
      ? `${formatFee(Math.abs(option.estimate.cashToClose))} · ${cashLabel(option)}${partial(option)}` : "Worksheet pending" },
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
        <section className="quote-cost-comparison" aria-label="Five-year cost comparison">
          <h4>Five-year cost comparison</h4>
          <div className="quote-cost-options">
            {costs.map((cost, index) => {
              const option = options[index];
              return <article className="document-item quote-cost-option" key={index}>
                <p className="eyebrow">{index === 0 ? "Selected" : `Alternative ${index}`}</p>
                <p><strong>{option.product} · {option.rate.toFixed(3)}%</strong></p>
                <dl className="quote-cost-metrics">
                  {option.estimate && <div><dt>{cashLabel(option)}{partial(option)}</dt><dd>{formatFee(Math.abs(option.estimate.cashToClose))}</dd></div>}
                  {cost.cost !== undefined && <div><dt>Upfront loan costs</dt><dd>{formatFee(cost.cost)}</dd></div>}
                  {cost.interest !== undefined && <div><dt>Interest in five years</dt><dd>{formatFee(cost.interest)}</dd></div>}
                  {cost.principalPaid !== undefined && <div><dt>Principal paid in five years</dt><dd>{formatFee(cost.principalPaid)}</dd></div>}
                  <div className="quote-cost-total"><dt>Estimated five-year borrowing cost</dt>
                    <dd>{cost.borrowingCost === undefined ? "Unavailable" : formatFee(cost.borrowingCost)}</dd></div>
                </dl>
                {cost.reason && <p className="muted">{cost.reason}</p>}
                {cost.breakEven && <p className="quote-break-even"><strong>Break-even vs. selected</strong><span>{cost.breakEven}</span></p>}
              </article>;
            })}
          </div>
          <p className="muted">Sample borrowing cost includes interest, points, and the borrower’s share of itemized fees after lender credits. It excludes principal, escrow, prepaids, additional seller and other credits, mortgage insurance, and ongoing property costs.</p>
          <p className="muted">Break-even is the first month when the higher-upfront offer’s cumulative cost reaches or falls below the other offer’s and stays at or below it through payoff.</p>
        </section>
      </>}
    {options.map((option, index) => <details className="document-form" key={index} open={options.length === 1}>
      <summary>Itemized fees · {option.product} at {option.rate.toFixed(3)}%</summary>
      <ItemizedFees option={option} />
    </details>)}
    <p className="muted">Monthly principal and interest excludes taxes, insurance, association dues, and other monthly costs.</p>
  </div>;
}

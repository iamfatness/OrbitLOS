import type { DisclosureSource } from "./disclosure-model";
import { feeKeys, feeLabels, sampleFeeLabel } from "./quote-worksheet";

export type DisclosureTermChange = { key: string; label: string; before: string; after: string };

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const cents = (value: number | null | undefined) => value == null ? "Not entered" : currency.format(value / 100);

function disclosureTerms({ applicationRevision, feeRevision, quote }: DisclosureSource) {
  const { estimate } = quote;
  const input = estimate?.inputs;
  return [
    ["application", "Reviewed 1003 revision", String(applicationRevision)],
    ["worksheet", "Fee worksheet revision", String(feeRevision)],
    ["purpose", "Loan purpose", quote.purpose],
    ["product", "Loan product", quote.product],
    ["term", "Loan term", `${quote.years} years`],
    ["rate", "Rate", `${quote.rate.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 20 })}%`],
    ["amount", "Loan amount", currency.format(quote.loanAmount)],
    ["principalAndInterest", "Monthly principal and interest", currency.format(quote.principalAndInterest)],
    ["purchasePrice", "Purchase price", cents(input?.purchasePrice)],
    ["payoffs", "Mortgage payoffs", cents(input?.payoffs)],
    ["deposit", "Deposit", cents(input?.deposit)],
    ["sellerCredits", "Seller credits", cents(input?.sellerCredits)],
    ["otherCredits", "Other credits", cents(input?.otherCredits)],
    ...feeKeys.map(key => [`fee:${key}`, feeLabels[key], sampleFeeLabel(input, key)] as const),
    ["points", "Points", cents(estimate?.points)],
    ["lenderCredit", "Lender credit", cents(estimate?.lenderCredit)],
    ["closingCosts", "Estimated closing costs", cents(estimate?.closingCosts)],
    ["cashToClose", "Estimated cash to close", cents(estimate?.cashToClose)],
  ] as const;
}

export function compareDisclosureTerms(previous: DisclosureSource, replacement: DisclosureSource): DisclosureTermChange[] {
  const before = new Map(disclosureTerms(previous).map(([key, , value]) => [key, value]));
  return disclosureTerms(replacement).flatMap(([key, label, after]) => {
    const value = before.get(key);
    return value !== undefined && value !== after ? [{ key, label, before: value, after }] : [];
  });
}

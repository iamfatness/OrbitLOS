import { z } from "zod";
import type { PricingOffer, PricingRun, PricingScenario } from "./pricing-model";
import { offerDisplayName } from "./manual-pricing-model";
import { propertyStateName } from "./property-state";

export const feeLabels = {
  origination: "Origination fee", appraisal: "Appraisal", creditReport: "Credit report", settlement: "Title and settlement",
  government: "Recording and transfer fees", prepaid: "Prepaid items", escrow: "Initial escrow", other: "Other closing costs",
} as const;
export type FeeKey = keyof typeof feeLabels;
export const feeKeys = Object.keys(feeLabels) as FeeKey[];
export const feePercentageBases = ["Loan amount", "Purchase price"] as const;
export type FeePercentageBasis = (typeof feePercentageBases)[number];
export type FeeCalculation = { basis: FeePercentageBasis; basisPoints: number; baseCents: number; amountCents: number };
export const feeCents = z.number().int().min(0).max(2_500_000_000);
export const feeAmounts = z.record(z.enum(feeKeys), feeCents.nullable());
export const feeContributionKeys = ["seller", "lender", "other"] as const;
export const feeContributionLabels = { seller: "Seller", lender: "Lender", other: "Other party" } as const;
const feeAllocation = z.strictObject({
  payee: z.string().trim().max(80).regex(/^[^\r\n]*$/, "Enter the sample payee on one line."),
  seller: feeCents, lender: feeCents, other: feeCents,
});
export const feeAllocations = z.partialRecord(z.enum(feeKeys), feeAllocation);
export type FeeAllocation = z.infer<typeof feeAllocation>;
type FeeAllocationInputs = { fees: z.infer<typeof feeAmounts>; allocations?: z.infer<typeof feeAllocations> };
const coveredAmount = (allocation: FeeAllocation) => allocation.seller + allocation.lender + allocation.other;
const hasFeeAllocation = (allocation: FeeAllocation) => Boolean(allocation.payee || coveredAmount(allocation));

export function feeAllocationIssue({ fees, allocations }: FeeAllocationInputs, purchase: boolean) {
  for (const key of feeKeys) {
    const allocation = allocations?.[key];
    if (!allocation || !hasFeeAllocation(allocation)) continue;
    const amount = fees[key];
    if (amount === null || amount <= 0) return `Enter a positive ${feeLabels[key].toLowerCase()} before allocating it.`;
    if (coveredAmount(allocation) > amount) return `Payer contributions exceed the ${feeLabels[key].toLowerCase()} amount.`;
    if (!purchase && allocation.seller > 0) return "Remove seller-paid fees from this refinance worksheet.";
  }
  return null;
}

const cents = feeCents;
const worksheet = z.object({
  fees: feeAmounts, purchasePrice: cents.nullable(), payoffs: cents.nullable(), deposit: cents, sellerCredits: cents, otherCredits: cents,
  allocations: feeAllocations.optional(),
}).superRefine((input, context) => {
  const issue = feeAllocationIssue(input, input.purchasePrice !== null);
  if (issue) context.addIssue({ code: "custom", path: ["allocations"], message: issue });
})
  .transform(({ allocations, ...input }) => {
    const entries = feeKeys.flatMap((key) => {
      const allocation = allocations?.[key];
      return allocation && hasFeeAllocation(allocation) ? [[key, allocation] as const] : [];
    });
    return { ...input, ...(entries.length ? { allocations: Object.fromEntries(entries) as z.infer<typeof feeAllocations> } : {}) };
  });
const id = z.string().min(1).max(100);
export const feeTemplateChoice = z.object({ id: z.uuid(), revision: z.number().int().positive() });
export const quoteSelection = z.object({ runId: id, offerId: id, feeRevision: z.number().int().nonnegative() });
export const saveFeeWorksheetInput = z.object({
  type: z.literal("saveFeeWorksheet"), loanId: id, ...quoteSelection.shape, worksheet, template: feeTemplateChoice.nullable().optional(),
});
export const saveAllocatedFeeWorksheetInput = saveFeeWorksheetInput.extend({ type: z.literal("saveAllocatedFeeWorksheet") });
export type SaveFeeWorksheet = z.infer<typeof saveFeeWorksheetInput> | z.infer<typeof saveAllocatedFeeWorksheetInput>;
export type FeeInputs = z.infer<typeof worksheet>;
export interface FeeTemplateOrigin extends z.infer<typeof feeTemplateChoice> {
  title: string;
  source: string;
  effectiveOn: string;
  zip: string;
  state?: string;
  property?: FeePropertyLocation;
  fees: FeeInputs["fees"];
  allocations?: FeeInputs["allocations"];
  calculations?: Partial<Record<FeeKey, FeeCalculation>>;
}

export type FeePropertyLocation = { zip: string; state?: string };

export function feeLocationLabel({ state, zip }: Pick<FeeTemplateOrigin, "state" | "zip">) {
  return [state ? propertyStateName(state) : "Any state", zip ? `ZIP ${zip}` : "Any ZIP"].join(" · ");
}

export function feeBasisIssue(origin: FeeTemplateOrigin | undefined, purchasePrice: number | null) {
  const purchaseFee = Object.values(origin?.calculations ?? {}).find((fee) => fee.basis === "Purchase price");
  return purchaseFee && purchaseFee.baseCents !== purchasePrice
    ? "Match the purchase price used to calculate these fees or reprice with the new purchase price."
    : null;
}
export interface FeeWorksheet {
  loanId: string;
  runId: string;
  offerId: string;
  revision: number;
  inputs: FeeInputs;
  origin?: FeeTemplateOrigin;
}
export interface FeeEstimate {
  inputs: FeeInputs;
  points: number;
  lenderCredit: number;
  closingCosts: number;
  downPayment: number | null;
  cashToClose: number;
}
export interface QuoteOption {
  runId: string;
  offerId: string;
  product: string;
  rate: number;
  years: number;
  principalAndInterest: number;
  loanAmount: number;
  purpose: PricingScenario["purpose"];
  estimate: FeeEstimate | null;
  feeOrigin?: FeeTemplateOrigin;
}
export interface QuotePresentation {
  primary: QuoteOption;
  alternatives: QuoteOption[];
}

export function blankFees(): FeeInputs["fees"] {
  return { origination: null, appraisal: null, creditReport: null, settlement: null, government: null, prepaid: null, escrow: null, other: null };
}

export function missingFees(fees: FeeInputs["fees"]) {
  return feeKeys.filter((key) => fees[key] === null);
}

export function borrowerFee(input: FeeAllocationInputs, key: FeeKey) {
  const fee = input.fees[key];
  const allocation = input.allocations?.[key];
  return fee == null ? null : fee - (allocation ? coveredAmount(allocation) : 0);
}

export type AllocatedFeeLine = FeeAllocation & { key: FeeKey; amount: number; borrower: number };
export function allocatedFeeLine(input: FeeAllocationInputs | undefined, key: FeeKey): AllocatedFeeLine | null {
  const allocation = input?.allocations?.[key];
  const amount = input?.fees[key];
  if (!input || !allocation || amount == null) return null;
  return { key, amount, ...allocation, borrower: borrowerFee(input, key) ?? 0 };
}

export function allocatedFeeLines(input: FeeAllocationInputs | undefined) {
  return feeKeys.flatMap((key) => {
    const line = allocatedFeeLine(input, key);
    return line ? [line] : [];
  });
}

const feeCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function feeCalculationLabel(calculation: FeeCalculation) {
  return `${calculation.basisPoints / 100}% × ${feeCurrency.format(calculation.baseCents / 100)} ${calculation.basis.toLowerCase()} = ${feeCurrency.format(calculation.amountCents / 100)}`;
}

export function feeAllocationLabel(line: AllocatedFeeLine) {
  const payers = [["Borrower", line.borrower] as const, ...feeContributionKeys.map((key) => [feeContributionLabels[key], line[key]] as const)];
  const amounts = payers.filter(([, amount]) => amount > 0).map(([payer, amount]) => `${payer} ${feeCurrency.format(amount / 100)}`);
  return [...amounts, ...(line.payee ? [`Paid to ${line.payee}`] : [])].join(" · ");
}

export function sampleFeeLabel(input: FeeAllocationInputs | undefined, key: FeeKey) {
  const amount = input?.fees[key];
  if (amount == null) return "Not entered";
  const allocation = allocatedFeeLine(input, key);
  return feeCurrency.format(amount / 100) + (allocation ? ` · ${feeAllocationLabel(allocation)}` : "");
}

export function estimateFees(scenario: PricingScenario, offer: PricingOffer, input: FeeInputs): FeeEstimate | null {
  if (offer.manual && offer.pricingAmount === null) return null;
  const principal = Math.round(scenario.loanAmount * 100);
  const purchase = scenario.purpose === "Purchase";
  const { purchasePrice, payoffs } = input;
  if (purchase ? purchasePrice === null || purchasePrice < principal : payoffs === null) return null;
  if (purchase && payoffs !== null || !purchase && (purchasePrice !== null || input.deposit !== 0 || input.sellerCredits !== 0) ||
    feeAllocationIssue(input, purchase)) return null;
  const adjustment = Math.round((offer.pricingAmount ?? 0) * 100);
  const points = Math.max(0, adjustment);
  const lenderCredit = Math.max(0, -adjustment);
  const closingCosts = feeKeys.reduce((total, key) => total + (borrowerFee(input, key) ?? 0), 0) + points - lenderCredit;
  const downPayment = purchase && purchasePrice !== null ? purchasePrice - principal : null;
  const cashToClose = (downPayment ?? (payoffs ?? 0) - principal) + closingCosts - input.deposit - input.sellerCredits - input.otherCredits;
  return { inputs: input, points, lenderCredit, closingCosts, downPayment, cashToClose };
}

export function quoteOption(run: Pick<PricingRun, "id" | "scenario">, offer: PricingOffer, worksheet?: FeeWorksheet): QuoteOption {
  return {
    runId: run.id, offerId: offer.id, product: offerDisplayName(offer), rate: offer.rate, years: offer.years, principalAndInterest: offer.principalAndInterest,
    loanAmount: run.scenario.loanAmount, purpose: run.scenario.purpose,
    estimate: worksheet ? estimateFees(run.scenario, offer, worksheet.inputs) : null,
    ...(worksheet?.origin ? { feeOrigin: worksheet.origin } : {}),
  };
}

export function borrowerQuotePresentation(presentation: QuotePresentation | null | undefined) {
  if (!presentation) return null;
  function publicOption(option: QuoteOption) {
    const publicFields = { ...option };
    delete publicFields.feeOrigin;
    return publicFields;
  }
  return { primary: publicOption(presentation.primary), alternatives: presentation.alternatives.map(publicOption) };
}

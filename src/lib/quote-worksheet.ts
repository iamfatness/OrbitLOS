import { z } from "zod";
import type { PricingOffer, PricingRun, PricingScenario } from "./pricing-model";

export const feeLabels = {
  origination: "Origination fee", appraisal: "Appraisal", creditReport: "Credit report", settlement: "Title and settlement",
  government: "Recording and transfer fees", prepaid: "Prepaid items", escrow: "Initial escrow", other: "Other closing costs",
} as const;
export type FeeKey = keyof typeof feeLabels;
export const feeKeys = Object.keys(feeLabels) as FeeKey[];
const cents = z.number().int().min(0).max(2_500_000_000);
const worksheet = z.object({
  fees: z.record(z.enum(feeKeys), cents), purchasePrice: cents.nullable(), payoffs: cents.nullable(), deposit: cents, sellerCredits: cents, otherCredits: cents,
});
const id = z.string().min(1).max(100);
export const quoteSelection = z.object({ runId: id, offerId: id, feeRevision: z.number().int().nonnegative() });
export const saveFeeWorksheetInput = z.object({
  type: z.literal("saveFeeWorksheet"), loanId: id, ...quoteSelection.shape, worksheet,
});
export type FeeInputs = z.infer<typeof worksheet>;
export interface FeeWorksheet {
  loanId: string;
  runId: string;
  offerId: string;
  revision: number;
  inputs: FeeInputs;
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
}
export interface QuotePresentation {
  primary: QuoteOption;
  alternatives: QuoteOption[];
}

export function blankFees(): FeeInputs["fees"] {
  return { origination: 0, appraisal: 0, creditReport: 0, settlement: 0, government: 0, prepaid: 0, escrow: 0, other: 0 };
}

export function estimateFees(scenario: PricingScenario, offer: PricingOffer, input: FeeInputs): FeeEstimate | null {
  const principal = Math.round(scenario.loanAmount * 100);
  const purchase = scenario.purpose === "Purchase";
  const { purchasePrice, payoffs } = input;
  if (purchase ? purchasePrice === null || purchasePrice < principal : payoffs === null) return null;
  if (purchase && payoffs !== null || !purchase && (purchasePrice !== null || input.deposit !== 0 || input.sellerCredits !== 0)) return null;
  const adjustment = Math.round((offer.pricingAmount ?? 0) * 100);
  const points = Math.max(0, adjustment);
  const lenderCredit = Math.max(0, -adjustment);
  const closingCosts = feeKeys.reduce((total, key) => total + input.fees[key], 0) + points - lenderCredit;
  const downPayment = purchase && purchasePrice !== null ? purchasePrice - principal : null;
  const cashToClose = (downPayment ?? (payoffs ?? 0) - principal) + closingCosts - input.deposit - input.sellerCredits - input.otherCredits;
  return { inputs: input, points, lenderCredit, closingCosts, downPayment, cashToClose };
}

export function quoteOption(run: Pick<PricingRun, "id" | "scenario">, offer: PricingOffer, worksheet?: FeeWorksheet): QuoteOption {
  return {
    runId: run.id, offerId: offer.id, product: offer.product, rate: offer.rate, years: offer.years, principalAndInterest: offer.principalAndInterest,
    loanAmount: run.scenario.loanAmount, purpose: run.scenario.purpose,
    estimate: worksheet ? estimateFees(run.scenario, offer, worksheet.inputs) : null,
  };
}

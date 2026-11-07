import { z } from "zod";

const amount = z.number().positive().max(25_000_000);

export const pricingScenario = z.object({
  purpose: z.enum(["Purchase", "Refinance"]),
  loanAmount: amount,
  propertyValue: amount,
  purchasePrice: amount.nullable(),
  zip: z.string().regex(/^\d{5}$/, "Enter a five-digit ZIP code."),
  creditScore: z.number().int().min(300).max(850),
  monthlyIncome: z.number().positive().max(10_000_000),
  occupancy: z.enum(["Primary residence", "Second home", "Investment property"]),
  propertyType: z.enum(["Single family", "Attached condominium"]),
  firstTimeBuyer: z.boolean(),
}).superRefine((scenario, context) => {
  const basis = scenario.purpose === "Purchase" && scenario.purchasePrice
    ? Math.min(scenario.propertyValue, scenario.purchasePrice)
    : scenario.propertyValue;
  if (scenario.loanAmount > basis) context.addIssue({ code: "custom", message: "Loan amount must be at or below the property value used for pricing." });
});

export type PricingScenario = z.infer<typeof pricingScenario>;

export interface PricingOffer {
  id: string;
  product: string;
  years: number;
  rate: number;
  apr: number | null;
  principalAndInterest: number;
  pricingPercent: number | null;
  pricingAmount: number | null;
  pricingLabel: string;
}

export interface PricingResult {
  provider: string;
  mode: "mock" | "stage";
  reference: string | null;
  offers: PricingOffer[];
  notices: string[];
}

export interface PricingRun extends PricingResult {
  id: string;
  loanId: string;
  scenario: PricingScenario;
  quotedAt: string;
  selectedId: string | null;
  selectedAt: string | null;
}

export interface BorrowerQuote {
  product: string;
  rate: number;
  principalAndInterest: number;
  quotedAt: string;
  publishedAt: string;
}

export interface PublishedQuote extends BorrowerQuote {
  loanId: string;
  runId: string;
  offerId: string;
}

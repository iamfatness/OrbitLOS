import { z } from "zod";

const amount = z.number().min(1).max(25_000_000);
const monthlyExpense = z.number().nonnegative().max(10_000_000);
const nonAgencyFields = {
  monthlyTaxes: monthlyExpense, monthlyInsurance: monthlyExpense, monthlyHoa: monthlyExpense,
  reservesMonths: z.number().int().min(0).max(120),
  refinanceType: z.enum(["Rate and term", "Cash out"]).nullable(),
};
const statementSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Personal") }),
  z.object({ type: z.literal("Business"), expensePercent: z.number().min(0).max(99.99),
    ownershipPercent: z.number().min(0.01).max(100) }),
]);
const nonAgencyScenario = z.discriminatedUnion("program", [
  z.object({ ...nonAgencyFields, program: z.literal("DSCR"), monthlyRent: z.number().min(0.01).max(10_000_000) }),
  z.object({ ...nonAgencyFields, program: z.literal("Bank statement"), source: statementSource,
    statementMonths: z.literal([12, 24]), averageMonthlyDeposits: z.number().min(0.01).max(10_000_000),
    monthlyDebts: monthlyExpense, selfEmployed: z.literal(true) }),
]);
export const pricingPrograms = ["Conventional", "DSCR", "Bank statement"] as const;
export type PricingProgram = (typeof pricingPrograms)[number];

export const pricingScenario = z.object({
  purpose: z.enum(["Purchase", "Refinance"]),
  loanAmount: amount,
  propertyValue: amount,
  purchasePrice: amount.nullable(),
  zip: z.string().regex(/^\d{5}$/, "Enter a five-digit ZIP code."),
  creditScore: z.number().int().min(300).max(850),
  monthlyIncome: z.number().positive().max(10_000_000).optional(),
  occupancy: z.enum(["Primary residence", "Second home", "Investment property"]),
  propertyType: z.enum(["Single family", "Attached condominium"]),
  firstTimeBuyer: z.boolean(),
  nonAgency: nonAgencyScenario.optional(),
}).superRefine((scenario, context) => {
  const basis = scenario.purpose === "Purchase" && scenario.purchasePrice
    ? Math.min(scenario.propertyValue, scenario.purchasePrice)
    : scenario.propertyValue;
  if (scenario.loanAmount > basis) context.addIssue({ code: "custom", message: "Loan amount must be at or below the property value used for pricing." });
  if (!scenario.nonAgency && !scenario.monthlyIncome) context.addIssue({ code: "custom", path: ["monthlyIncome"], message: "Enter gross monthly income for conventional pricing." });
  if (scenario.nonAgency?.program === "DSCR" && scenario.occupancy !== "Investment property") {
    context.addIssue({ code: "custom", path: ["occupancy"], message: "Choose investment property for a DSCR scenario." });
  }
  if (scenario.nonAgency && (scenario.purpose === "Refinance") !== (scenario.nonAgency.refinanceType !== null)) {
    context.addIssue({ code: "custom", path: ["nonAgency", "refinanceType"], message: "Choose a refinance type for a refinance scenario." });
  }
});

export type PricingScenario = z.infer<typeof pricingScenario>;

export function sampleNonAgencyMetrics(scenario: NonNullable<PricingScenario["nonAgency"]>, principalAndInterest: number) {
  const housing = principalAndInterest + scenario.monthlyTaxes + scenario.monthlyInsurance + scenario.monthlyHoa;
  if (scenario.program === "DSCR") return { program: scenario.program, housing, dscr: scenario.monthlyRent / housing } as const;
  const source = scenario.source;
  const income = source.type === "Business"
    ? scenario.averageMonthlyDeposits * (1 - source.expensePercent / 100) * source.ownershipPercent / 100
    : scenario.averageMonthlyDeposits;
  return { program: scenario.program, housing, income, dti: (housing + scenario.monthlyDebts) / income } as const;
}

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
  applicationRevision: number | null;
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
export interface SharedQuoteEvent extends PublishedQuote {
  endedAt: string;
  outcome: "Replaced" | "Removed";
}

export const mockLockPeriods = [15, 30, 45] as const;
export type MockLockPeriod = (typeof mockLockPeriods)[number];
export const mockLockExtensionPeriods = [7, 15] as const;
export type MockLockExtensionPeriod = (typeof mockLockExtensionPeriods)[number];
export const mockLockNoticeDays = 7;

export interface MockUwmRate {
  loanId: string;
  submissionId: string;
  loanNumber: string;
  runId: string;
  offerId: string;
  product: string;
  rate: number;
  quotedAt: string;
  floatReference: string;
  floatedAt: string;
  lockReference: string | null;
  lockedAt: string | null;
  lockDays: MockLockPeriod | null;
  lockExpiresAt: string | null;
  lockExtensionReference: string | null;
  lockExtensionDays: MockLockExtensionPeriod | null;
  lockCancellationReference: string | null;
  lockCancelledAt: string | null;
}

export function mockRateStatus(rate: MockUwmRate, now: string) {
  if (rate.lockCancelledAt) return "Mock lock cancelled";
  if (!rate.lockExpiresAt) return "Floating";
  return rate.lockExpiresAt > now ? "Mock locked" : "Mock lock expired";
}

export function lockExpiringSoon(rate: MockUwmRate, now: string) {
  return rate.lockExpiresAt !== null && mockRateStatus(rate, now) === "Mock locked" &&
    Date.parse(rate.lockExpiresAt) - Date.parse(now) <= mockLockNoticeDays * 86_400_000;
}

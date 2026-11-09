import { z } from "zod";
import type { PricingOffer, PricingRun } from "./pricing-model";
import { missingFees, quoteSelection, type FeeInputs } from "./quote-worksheet";

export const scenarioGoals = ["Lower monthly payment", "Less cash upfront", "Lower borrowing cost"] as const;
const money = z.number().int().min(0).max(2_500_000_000);
const quoteSource = quoteSelection.pick({ runId: true, offerId: true });
export type ScenarioQuoteSource = z.infer<typeof quoteSource>;
export const loanScenarioOption = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(60), program: z.string().trim().min(1).max(60),
  loanAmount: money.min(100000), rate: z.number().min(0).max(25), years: z.number().int().min(5).max(40),
  pointsPercent: z.number().min(0).max(10), lenderCredit: money, fees: money, prepaids: money, escrow: money,
  monthlyTaxes: money, monthlyInsurance: money, monthlyHoa: money, monthlyMi: money, miMonths: z.number().int().min(0).max(480),
  quoteSource: quoteSource.optional(),
}).superRefine((option, ctx) => {
  if (option.monthlyMi > 0 && option.miMonths === 0) ctx.addIssue({ code: "custom", path: ["miMonths"], message: "Enter the expected months of mortgage insurance." });
  const costs = option.fees + option.prepaids + option.escrow + Math.round(option.loanAmount * option.pointsPercent / 100);
  if (option.lenderCredit > costs) ctx.addIssue({ code: "custom", path: ["lenderCredit"], message: "Lender credit exceeds estimated closing costs." });
});
export const scenarioPlanSchema = z.object({
  purpose: z.enum(["Purchase", "Refinance"]), propertyValue: money.positive(), payoffs: money, deposit: money,
  sellerCredit: money, holdingMonths: z.number().int().min(1).max(480), goal: z.enum(scenarioGoals),
  monthlyBudget: money.nullable(), cashBudget: money.nullable(), options: z.array(loanScenarioOption).min(1).max(4),
  recommendedId: z.uuid().nullable(), recommendation: z.string().trim().max(1200),
}).superRefine((plan, ctx) => {
  if (new Set(plan.options.map(option => option.id)).size !== plan.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Each option needs a distinct identifier." });
  if (plan.recommendedId && (!plan.options.some(option => option.id === plan.recommendedId) || !plan.recommendation))
    ctx.addIssue({ code: "custom", path: ["recommendation"], message: "Choose an option and explain how it fits the borrower." });
  if (plan.purpose === "Refinance" && (plan.deposit || plan.sellerCredit)) ctx.addIssue({ code: "custom", path: ["deposit"], message: "Use zero deposit and seller credits for a refinance." });
  plan.options.forEach((option, index) => {
    if (plan.purpose === "Purchase" && option.loanAmount > plan.propertyValue) ctx.addIssue({ code: "custom", path: ["options", index, "loanAmount"], message: "Loan amount exceeds the purchase price." });
    const costs = option.fees + option.prepaids + option.escrow + Math.round(option.loanAmount * option.pointsPercent / 100);
    if (plan.sellerCredit + option.lenderCredit > costs) ctx.addIssue({ code: "custom", path: ["sellerCredit"], message: "Combined credits exceed closing costs for an option." });
  });
});
export type LoanScenarioOption = z.infer<typeof loanScenarioOption>;
export type ScenarioPlan = z.infer<typeof scenarioPlanSchema>;
const loanId = z.string().min(1).max(100);
export const scenarioRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), loanId }),
  z.object({ type: z.literal("save"), loanId, revision: z.number().int().nonnegative(), applicationRevision: z.number().int().nonnegative().nullable(), plan: scenarioPlanSchema }),
]);
export type ScenarioRecord = { plan: ScenarioPlan; revision: number; updatedAt: string; updatedBy: string; applicationRevision: number | null };
export type ScenarioResponse = { record: ScenarioRecord | null; currentApplicationRevision: number | null; canEdit: boolean };

// Amounts are integer cents; interest and scheduled payments round to cents each month.
export function scenarioSchedule(option: LoanScenarioOption) {
  const months = option.years * 12, rate = option.rate / 1200;
  const payment = Math.round(rate === 0 ? option.loanAmount / months : option.loanAmount * rate / -Math.expm1(-months * Math.log1p(rate)));
  let balance = option.loanAmount, interest = 0, mi = 0;
  const rows = [{ balance, interest, mi, cost: option.fees + Math.round(option.loanAmount * option.pointsPercent / 100) - option.lenderCredit }];
  for (let month = 1; month <= months; month++) {
    const charge = Math.round(balance * rate);
    const paid = month === months ? balance + charge : Math.min(payment, balance + charge);
    interest += charge;
    if (balance > 0 && month <= option.miMonths) mi += option.monthlyMi;
    balance = Math.max(0, balance + charge - paid);
    rows.push({ balance, interest, mi, cost: rows[0].cost + interest + mi });
  }
  return { payment, rows };
}

export function compareLoanScenarios(plan: ScenarioPlan) {
  const schedules = plan.options.map(scenarioSchedule);
  const baseline = schedules[0];
  return plan.options.map((option, index) => {
    const schedule = schedules[index];
    const horizon = schedule.rows[Math.min(plan.holdingMonths, option.years * 12)];
    const points = Math.round(option.loanAmount * option.pointsPercent / 100);
    const closingCosts = option.fees + points + option.prepaids + option.escrow - option.lenderCredit - plan.sellerCredit;
    const cashToClose = (plan.purpose === "Purchase" ? plan.propertyValue - option.loanAmount - plan.deposit : plan.payoffs - option.loanAmount) + closingCosts;
    const monthly = schedule.payment + option.monthlyTaxes + option.monthlyInsurance + option.monthlyHoa + option.monthlyMi;
    let breakEvenMonths: number | null = null;
    if (index > 0 && option.loanAmount === plan.options[0].loanAmount && schedule.rows[0].cost > baseline.rows[0].cost) {
      const length = Math.max(schedule.rows.length, baseline.rows.length);
      let lastMoreExpensive = 0;
      for (let month = 1; month < length; month++) {
        if (schedule.rows[Math.min(month, schedule.rows.length - 1)].cost > baseline.rows[Math.min(month, baseline.rows.length - 1)].cost) lastMoreExpensive = month;
      }
      if (lastMoreExpensive < length - 1) breakEvenMonths = lastMoreExpensive + 1;
    }
    return { id: option.id, principalAndInterest: schedule.payment, monthly, points, closingCosts, cashToClose,
      interest: horizon.interest, mortgageInsurance: horizon.mi, borrowingCost: horizon.cost,
      principalPaid: option.loanAmount - horizon.balance, balance: horizon.balance,
      ltv: option.loanAmount / plan.propertyValue * 100, breakEvenMonths,
      withinBudget: (plan.monthlyBudget === null || monthly <= plan.monthlyBudget) && (plan.cashBudget === null || cashToClose <= plan.cashBudget),
    };
  });
}

export function blankScenarioOption(amount: number, name = "Option 1"): LoanScenarioOption {
  return { id: crypto.randomUUID(), name, program: "Conventional fixed", loanAmount: Math.max(100000, Math.round(amount)), rate: 0, years: 30,
    pointsPercent: 0, lenderCredit: 0, fees: 0, prepaids: 0, escrow: 0, monthlyTaxes: 0, monthlyInsurance: 0, monthlyHoa: 0, monthlyMi: 0, miMonths: 0 };
}

export function scenarioPricingTerms(run: Pick<PricingRun, "scenario">, offer: PricingOffer) {
  const loanAmount = Math.round(run.scenario.loanAmount * 100);
  const adjustment = Math.round((offer.pricingAmount ?? 0) * 100);
  return { loanAmount, rate: offer.rate, years: offer.years,
    pointsPercent: Math.max(0, adjustment) / loanAmount * 100, lenderCredit: Math.max(0, -adjustment) };
}

export function pricingScenarioOption(run: PricingRun, offer: PricingOffer, worksheet: FeeInputs | undefined, name: string,
  baseline?: LoanScenarioOption): LoanScenarioOption {
  const terms = scenarioPricingTerms(run, offer);
  const fees = worksheet?.fees && !missingFees(worksheet.fees).length ? worksheet.fees : undefined;
  const expenses = run.scenario.nonAgency;
  return { ...blankScenarioOption(terms.loanAmount, name), ...terms, program: offer.product.slice(0, 60),
    fees: fees ? (fees.origination ?? 0) + (fees.appraisal ?? 0) + (fees.creditReport ?? 0) + (fees.settlement ?? 0) + (fees.government ?? 0) + (fees.other ?? 0) : baseline?.fees ?? 0,
    prepaids: fees?.prepaid ?? baseline?.prepaids ?? 0, escrow: fees?.escrow ?? baseline?.escrow ?? 0,
    monthlyTaxes: expenses ? Math.round(expenses.monthlyTaxes * 100) : baseline?.monthlyTaxes ?? 0,
    monthlyInsurance: expenses ? Math.round(expenses.monthlyInsurance * 100) : baseline?.monthlyInsurance ?? 0,
    monthlyHoa: expenses ? Math.round(expenses.monthlyHoa * 100) : baseline?.monthlyHoa ?? 0,
    monthlyMi: baseline?.monthlyMi ?? 0, miMonths: baseline?.miMonths ?? 0,
    quoteSource: { runId: run.id, offerId: offer.id } };
}

export function sampleScenarioPlan(amount: number, purpose: ScenarioPlan["purpose"]): ScenarioPlan {
  const base = { ...blankScenarioOption(amount, "Balanced"), rate: 6.5, fees: 450000, prepaids: 100000, escrow: 150000, monthlyTaxes: 45000, monthlyInsurance: 12500 };
  return { purpose, propertyValue: Math.round(base.loanAmount / 0.8), payoffs: purpose === "Refinance" ? base.loanAmount : 0,
    deposit: 0, sellerCredit: 0, holdingMonths: 60, goal: "Lower borrowing cost", monthlyBudget: null, cashBudget: null,
    options: [base, { ...base, id: crypto.randomUUID(), name: "Lower rate", rate: 6.125, pointsPercent: 1 },
      { ...base, id: crypto.randomUUID(), name: "Less cash upfront", rate: 6.875, lenderCredit: 300000 }],
    recommendedId: null, recommendation: "" };
}

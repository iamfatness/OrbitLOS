import { fixedLoanSchedule, sustainedCostBreakEven } from "./loan-amortization";
import type { QuoteOption, QuotePresentation } from "./quote-worksheet";

const includedFees = ["origination", "appraisal", "creditReport", "settlement", "government", "other"] as const;
export const quoteComparisonMonths = 60;

function upfrontCost(option: QuoteOption) {
  const estimate = option.estimate;
  if (!estimate) return { reason: "Fee worksheet pending." };
  let cost = estimate.points - estimate.lenderCredit;
  for (const key of includedFees) {
    const fee = estimate.inputs.fees[key];
    if (fee == null) return { reason: "Complete the included fees to estimate cost." };
    cost += fee;
  }
  if (cost < 0) return { reason: "The lender credit exceeds the included fees." };
  return { cost };
}

function calculate(option: QuoteOption) {
  const { product, rate, years } = option;
  const loanAmount = Math.round(option.loanAmount * 100);
  const { cost, reason } = upfrontCost(option);
  if (!/\bfixed$/i.test(product) || !Number.isInteger(years) || years < 1 || years > 40 ||
    !Number.isFinite(rate) || rate < 0 || rate > 25 || !Number.isSafeInteger(loanAmount) || loanAmount <= 0) {
    return { reason: "A fixed-rate payment schedule is unavailable." };
  }
  const { payment, rows } = fixedLoanSchedule({ loanAmount, rate, years, upfrontCost: cost ?? 0 });
  if (payment !== Math.round(option.principalAndInterest * 100)) {
    return { reason: "The saved payment does not match a fixed-rate schedule." };
  }
  const horizon = rows[Math.min(quoteComparisonMonths, rows.length - 1)];
  return { reason, cost, rows, interest: horizon.interest, principalPaid: loanAmount - horizon.balance,
    borrowingCost: cost === undefined ? undefined : horizon.cost };
}

function breakEven(primary: QuoteOption, alternative: QuoteOption, base: ReturnType<typeof calculate>, next: ReturnType<typeof calculate>) {
  if (Math.round(primary.loanAmount * 100) !== Math.round(alternative.loanAmount * 100)) return "Different loan amounts";
  if (primary.purpose !== alternative.purpose) return "Different loan purposes";
  if (!base.rows || !next.rows || base.cost === undefined || next.cost === undefined) return "Cost estimates needed for both offers";
  if (primary.estimate?.inputs.purchasePrice !== alternative.estimate?.inputs.purchasePrice) return "Different purchase prices";
  if (primary.estimate?.inputs.payoffs !== alternative.estimate?.inputs.payoffs) return "Different refinance payoffs";
  if (base.cost === next.cost) return "Same upfront cost";
  const selectedCostsMore = base.cost > next.cost;
  const month = selectedCostsMore ? sustainedCostBreakEven(base.rows, next.rows) : sustainedCostBreakEven(next.rows, base.rows);
  if (month === null) return "No sustained break-even";
  return `${selectedCostsMore ? "Selected offer" : "This offer"} breaks even in month ${month}${month > quoteComparisonMonths ? " · after five years" : ""}`;
}

export function compareQuoteCosts({ primary, alternatives }: QuotePresentation) {
  const base = calculate(primary);
  return [primary, ...alternatives].map((option, index) => {
    const model = index === 0 ? base : calculate(option);
    const { cost, reason, interest, principalPaid, borrowingCost } = model;
    return { cost, reason, interest, principalPaid, borrowingCost,
      breakEven: index === 0 ? null : breakEven(primary, option, base, model) };
  });
}

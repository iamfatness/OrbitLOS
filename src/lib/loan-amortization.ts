type FixedLoanTerms = {
  loanAmount: number;
  rate: number;
  years: number;
  upfrontCost: number;
  monthlyMi?: number;
  miMonths?: number;
};

// Amounts are integer cents; interest and scheduled payments round each month.
export function fixedLoanSchedule({ loanAmount, rate, years, upfrontCost, monthlyMi = 0, miMonths = 0 }: FixedLoanTerms) {
  const months = years * 12;
  const monthlyRate = rate / 1200;
  const payment = Math.round(monthlyRate === 0 ? loanAmount / months
    : loanAmount * monthlyRate / -Math.expm1(-months * Math.log1p(monthlyRate)));
  let balance = loanAmount;
  let interest = 0;
  let mi = 0;
  const rows = [{ balance, interest, mi, cost: upfrontCost }];
  for (let month = 1; month <= months; month++) {
    const charge = Math.round(balance * monthlyRate);
    const paid = month === months ? balance + charge : Math.min(payment, balance + charge);
    interest += charge;
    if (balance > 0 && month <= miMonths) mi += monthlyMi;
    balance = Math.max(0, balance + charge - paid);
    rows.push({ balance, interest, mi, cost: upfrontCost + interest + mi });
  }
  return { payment, rows };
}

export function sustainedCostBreakEven(higherUpfront: { cost: number }[], lowerUpfront: { cost: number }[]) {
  const lastMonth = Math.max(higherUpfront.length, lowerUpfront.length) - 1;
  for (let month = lastMonth; month >= 0; month--) {
    const higher = higherUpfront[Math.min(month, higherUpfront.length - 1)].cost;
    const lower = lowerUpfront[Math.min(month, lowerUpfront.length - 1)].cost;
    if (higher > lower) return month < lastMonth ? month + 1 : null;
  }
  return null;
}

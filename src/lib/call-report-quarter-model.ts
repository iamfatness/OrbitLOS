export type Quarter = { year: number; quarter: number };
export type CarryoverEntry = { loanId: string; state: string; amount: number };
export type CarryoverTotals = { count: number; amount: number };
export type CarryoverDifference = {
  loanId: string;
  before: CarryoverEntry | null;
  current: CarryoverEntry | null;
  reasons: ("Added to opening" | "Missing from opening" | "State changed" | "Amount changed")[];
};
export type QuarterReviewSummary = {
  version: number;
  recordedAt: string;
  recordedBy: string;
  count: number;
  changeCount: number | null;
  priorVersion: number | null;
  closed: boolean;
};
export type QuarterReviewComparison = {
  key: string;
  prior: QuarterReviewSummary | null;
  opening: CarryoverTotals;
  previousEnding: CarryoverTotals | null;
  states: { state: string; previous: CarryoverTotals | null; opening: CarryoverTotals }[];
  differences: (CarryoverDifference & { borrower: string | null })[];
  changeCount: number | null;
  next: number | null;
  needsNote: boolean;
  count: number;
};
export type QuarterReviewPage = {
  kind: "quarterReview";
  period: Quarter;
  priorPeriod: Quarter;
  closed: boolean;
  history: QuarterReviewSummary[];
  latestCurrent: boolean;
  comparison: QuarterReviewComparison | null;
  unavailable: string | null;
};

export function priorQuarter({ year, quarter }: Quarter): Quarter {
  return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
}

export function quarterName({ year, quarter }: Quarter) {
  return `${year} Q${quarter}`;
}

import { z } from "zod";
import { reportMonthDates, validReportRange, type ReportDateRange } from "./report-date-range";
export { currentReportMonth as currentFundingMonth, priorReportPeriod as priorFundingPeriod } from "./report-date-range";

const date = z.iso.date();
export const fundingDashboardUnavailable = "This brokerage funding dashboard is unavailable.";
export const fundingMetrics = ["projected", "actual"] as const;
export const fundingPeriods = ["selected", "previous"] as const;
const recordId = z.string().min(1).max(160);
export const fundingCursor = z.object({ date, id: recordId });
export const fundingTargetLimits = { count: 1_000_000, volume: 1_000_000_000_000 };
export const fundingTargetFields = {
  month: z.string().regex(/^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/), revision: z.number().int().nonnegative(),
  count: z.number().int().min(1).max(fundingTargetLimits.count), volume: z.number().int().min(1).max(fundingTargetLimits.volume),
};

const filterFields = {
  from: date, through: date, owner: z.string().max(306).regex(/^(?:|email:.+|name:.*)$/),
  metric: z.enum(fundingMetrics), period: z.enum(fundingPeriods),
};
export const fundingViewFilters = z.object(filterFields).refine(validReportRange);
export const fundingDashboardQuery = z.object({ ...filterFields, after: fundingCursor.optional() }).refine(validReportRange);

export const fundingRecordRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("loan"), id: recordId }),
  z.object({ type: z.literal("saveView"), id: z.uuid(), name: z.string().trim().min(1).max(80), filters: fundingViewFilters }),
  z.object({ type: z.literal("removeView"), id: z.uuid() }),
  z.object({ type: z.literal("saveTarget"), ...fundingTargetFields }),
]);

export type FundingDashboardQuery = z.infer<typeof fundingDashboardQuery>;
export type FundingRecordInput = z.infer<typeof fundingRecordRequest>;
export type FundingCursor = z.infer<typeof fundingCursor>;
export type FundingMetric = FundingDashboardQuery["metric"];
export type FundingPeriod = FundingDashboardQuery["period"];
type DateRange = ReportDateRange;
export type FundingTotals = { count: number; volume: number };
export type FundingLoan = FundingCursor & { name: string; officer: string; stage: string; amount: number };
export type FundingLoanDetail = Omit<FundingLoan, "date"> & { address: string; targetDate: string | null; closingDate: string | null;
  fundingDate: string | null; disclosureStatus: string | null; outstanding: number };
export type SavedFundingView = { id: string; name: string; filters: z.infer<typeof fundingViewFilters> };
export type FundingTarget = FundingTotals & { month: string; revision: number };
export type FundingDashboardData = {
  checkedAt: string;
  periods: Record<FundingPeriod, DateRange & Record<FundingMetric, FundingTotals>>;
  loans: FundingLoan[];
  next: FundingCursor | null;
  views: SavedFundingView[];
  target: FundingTarget | null;
};

export function targetMonth({ from, through, owner }: DateRange & { owner: string }) {
  const month = from.slice(0, 7);
  const range = reportMonthDates(month);
  return !owner && range.from === from && range.through === through ? month : null;
}

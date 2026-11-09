import { z } from "zod";
import { validReportRange, type ReportDateRange } from "./report-date-range";

export const salesDashboardUnavailable = "This sales dashboard is unavailable.";
export const salesMetrics = ["leads", "outreach", "submitted", "funded", "repeat"] as const;
const salesDrillMetrics = [...salesMetrics, "maturing"] as const;
export const salesMetricLabels = {
  leads: "Leads", outreach: "Outreach logged", submitted: "1003s submitted", funded: "Funded", repeat: "Repeat 1003s started", maturing: "Still maturing",
} satisfies Record<(typeof salesDrillMetrics)[number], string>;
export const salesPeriods = ["selected", "previous"] as const;
export const salesChannels = ["Campaigns", "Realtors", "Lead sources"] as const;
export const salesWindows = [0, 7, 30, 90] as const;
const windowDays = z.literal(salesWindows);
const id = z.string().min(1).max(160);
const groupCursor = z.object({ id, name: z.string().max(240) });
const recordCursor = z.object({ id, at: z.iso.datetime() });
const filters = {
  from: z.iso.date(), through: z.iso.date(), channel: z.enum(salesChannels),
  owner: z.string().max(306).regex(/^(?:|email:.+|name:.*)$/),
  windowDays: windowDays.default(0),
};
const drilldown = {
  period: z.enum(salesPeriods), metric: z.enum(salesDrillMetrics), groupId: id.nullable(),
};
const validSalesRange = (range: ReportDateRange & { windowDays: number }) =>
  validReportRange(range) && range.through <= (range.windowDays ? "9999-10-02" : "9999-12-30");
export const salesDashboardFilters = z.object(filters).refine(validSalesRange);
export const salesDashboardQuery = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summary"), ...filters, afterGroup: groupCursor.optional() }),
  z.object({ kind: z.literal("records"), ...filters, ...drilldown, after: recordCursor.optional() }),
]).refine(validSalesRange);

export const salesSettingRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("saveView"), id: z.uuid(), name: z.string().trim().min(1).max(80), filters: salesDashboardFilters }),
  z.object({ type: z.literal("removeView"), id: z.uuid() }),
  z.object({ type: z.literal("saveTarget"), channel: z.enum(salesChannels), windowDays, revision: z.number().int().nonnegative(),
    submitted: z.number().int().min(1).max(100), funded: z.number().int().min(1).max(100) }),
]);
export type SalesFilters = z.infer<typeof salesDashboardFilters>;
export type SalesSetting = z.infer<typeof salesSettingRequest>;
export type SalesTarget = Pick<Extract<SalesSetting, { type: "saveTarget" }>, "submitted" | "funded" | "revision">;
export type SavedSalesView = { id: string; name: string; filters: SalesFilters };
export type SalesQuery = z.infer<typeof salesDashboardQuery>;
export type SalesDrilldown = z.infer<z.ZodObject<typeof drilldown>>;
export type SalesMetric = (typeof salesDrillMetrics)[number];
export type SalesTotals = Record<SalesMetric, number>;
export type SalesPeriod = (typeof salesPeriods)[number];
export type SalesGroup = z.infer<typeof groupCursor> & Record<SalesPeriod, SalesTotals>;
export type SalesRecord = z.infer<typeof recordCursor> & {
  name: string; groupId: string; groupName: string; officer: string; loanId: string | null; openLead: number;
  maturesAt: string | null;
  outreach: number; submittedAt: string | null; fundingDate: string | null; repeatLoanId: string | null;
};
export type SalesSummary = {
  kind: "summary"; checkedAt: string; periods: Record<SalesPeriod, ReportDateRange & SalesTotals>;
  groups: SalesGroup[]; next: z.infer<typeof groupCursor> | null;
  owners: { id: string; name: string }[];
  views: SavedSalesView[];
  target: SalesTarget | null;
};
export type SalesRecords = { kind: "records"; records: SalesRecord[]; next: z.infer<typeof recordCursor> | null };
export type SalesDashboardResult = SalesSummary | SalesRecords | { error: string };

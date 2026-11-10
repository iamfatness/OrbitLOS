import { z } from "zod";
import { validReportRange } from "./report-date-range";
import type { FundingTotals } from "./funding-dashboard-model";
import type { SalesSummary } from "./sales-dashboard-model";

export const ownerScorecardUnavailable = "The owner scorecard is available to brokerage admins.";
export const ownerWorkLabels = {
  followUps: "Overdue follow-ups", conditions: "Loans with open conditions", projected: "Projected funding", actual: "Recorded funding",
} as const;

const fields = {
  from: z.iso.date(), through: z.iso.date(), owner: z.string().max(306).regex(/^(?:|email:.+|name:.*)$/),
};
const valid = (filters: { from: string; through: string }) => validReportRange(filters) && filters.through <= "9999-12-30";
export const ownerScorecardFilters = z.object(fields).refine(valid);
const key = z.string().min(1).max(300);
export const ownerScorecardQuery = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summary"), ...fields, afterGroup: z.object({ id: key, name: z.string().max(240) }).optional() }),
  z.object({ kind: z.literal("work"), ...fields, metric: z.enum(["followUps", "conditions", "projected", "actual"]),
    after: z.object({ at: z.union([z.iso.date(), z.iso.datetime()]), id: key }).optional() }),
]).refine(valid);

export const ownerScorecardSetting = z.discriminatedUnion("type", [
  z.object({ type: z.literal("saveView"), id: z.uuid(), name: z.string().trim().min(1).max(80), filters: ownerScorecardFilters }),
  z.object({ type: z.literal("removeView"), id: z.uuid() }),
]);
export type OwnerScorecardFilters = z.infer<typeof ownerScorecardFilters>;
export type OwnerScorecardQuery = z.infer<typeof ownerScorecardQuery>;
export type OwnerScorecardSetting = z.infer<typeof ownerScorecardSetting>;
export type OwnerWorkMetric = keyof typeof ownerWorkLabels;
export type OwnerWorkCursor = NonNullable<Extract<OwnerScorecardQuery, { kind: "work" }>["after"]>;
export type OwnerDestination =
  | { kind: "loan"; loanId: string; target: string }
  | { kind: "lead"; leadId: string; task: "lead" | "campaign" | "lead-task" | "sequence" }
  | { kind: "contact"; contactId: string };
export type OwnerWorkRow = OwnerWorkCursor & {
  name: string; owner: string; title: string; destination: OwnerDestination;
  amount?: number; conditionCount?: number;
};
export type OwnerScorecardSummary = {
  kind: "summary"; checkedAt: string; sales: Pick<SalesSummary, "groups" | "next" | "periods">;
  counts: Record<"followUps" | "conditions", number>;
  funding: Record<"projected" | "actual", FundingTotals>;
  owners: { id: string; name: string }[];
  views: { id: string; name: string; filters: OwnerScorecardFilters }[];
};
export type OwnerScorecardResult = OwnerScorecardSummary |
  { kind: "work"; rows: OwnerWorkRow[]; next: OwnerWorkCursor | null } | { error: string };

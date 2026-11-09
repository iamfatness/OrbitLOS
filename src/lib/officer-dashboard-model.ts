import { z } from "zod";
import { fundingCursor, fundingTargetFields, type FundingCursor, type FundingLoan, type FundingTarget, type FundingTotals } from "./funding-dashboard-model";
import { stages, type Stage } from "./model";

export const officerDashboardUnavailable = "This personal dashboard is unavailable.";
export const brokerageStalledUnavailable = "This brokerage workload report is unavailable.";
const opportunityCursor = z.object({ dueAt: z.iso.datetime(), id: z.string().min(1).max(200) });
const stalledCursor = z.object({ enteredAt: z.number().min(0).max(5_373_484.5), id: z.string().min(1).max(100) });
export const stalledLoanStages = stages.filter((stage) => stage !== "Funded" && stage !== "Closed");
const stalledFilters = { stage: z.enum(stalledLoanStages).optional(), after: stalledCursor.optional() };
export const officerDashboardRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("production") }),
  z.object({ type: z.literal("fundedLoans"), month: fundingTargetFields.month, after: fundingCursor.optional() }),
  z.object({ type: z.literal("opportunities"), after: opportunityCursor.optional() }),
  z.object({ type: z.literal("stalledLoans"), ...stalledFilters }),
  z.object({ type: z.literal("brokerageStalledLoans"), owner: z.union([z.literal(""), z.literal("unassigned"), z.email().max(254)]), ...stalledFilters }),
  z.object({ type: z.literal("saveTarget"), ...fundingTargetFields }),
]);

export type OfficerDashboardRequest = z.infer<typeof officerDashboardRequest>;
export type RetentionCursor = z.infer<typeof opportunityCursor>;
export type StalledLoanQuery = Extract<OfficerDashboardRequest, { type: "stalledLoans" | "brokerageStalledLoans" }>;
export type StalledLoanPage = { kind: "stalledLoans"; checkedAt: string; next: z.infer<typeof stalledCursor> | null;
  items: { id: string; name: string; stage: Stage; days: number; action: string; blocker: string | null; dueAt: string | null; owner?: string }[] };
export type BrokerageStalledPage = Omit<StalledLoanPage, "kind"> & { kind: "brokerageStalledLoans";
  stages: { stage: (typeof stalledLoanStages)[number]; active: number; stalled: number }[];
  owners: { email: string; name: string; stalled: number }[];
};
export const stalledLoanUnavailable = "This loan is no longer in your stalled queue. Refresh stalled loans.";
export type RetentionOpportunity = RetentionCursor & { loanId: string; name: string } & (
  { kind: "Rate target met"; context: string; checkedAt: string | null } |
  { kind: "Closing anniversary"; closingDate: string }
);
type ProductionPeriod = FundingTotals & { month: string };
export type OfficerDashboardResult =
  | { kind: "production"; checkedAt: string; current: ProductionPeriod; previous: ProductionPeriod; target: FundingTarget | null }
  | { kind: "fundedLoans"; loans: FundingLoan[]; next: FundingCursor | null }
  | { kind: "opportunities"; checkedAt: string; items: RetentionOpportunity[]; next: RetentionCursor | null }
  | StalledLoanPage
  | BrokerageStalledPage
  | { kind: "saved"; target: FundingTarget; message: string }
  | { error: string };

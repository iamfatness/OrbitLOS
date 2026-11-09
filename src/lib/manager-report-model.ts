import { z } from "zod";
import { easternDate } from "./client-retention";
import { leadSources } from "./model";

export const reportFilters = z.object({
  from: z.union([z.iso.date(), z.literal("")]),
  through: z.union([z.iso.date(), z.literal("")]),
  owner: z.string().max(300),
  source: z.enum(["", ...leadSources]),
  campaign: z.union([z.uuid(), z.literal("")]).default(""),
  segment: z.union([z.uuid(), z.literal("")]).default(""),
}).refine((value) => !value.from || !value.through || value.from <= value.through, "Choose an end date on or after the start date.");

export type ReportFilters = z.infer<typeof reportFilters>;
export const defaultReportFilters: ReportFilters = { from: "", through: "", owner: "", source: "", campaign: "", segment: "" };

export const saveReportView = z.object({
  type: z.literal("saveReportView"), id: z.uuid(), name: z.string().trim().min(1).max(80), filters: reportFilters,
});
export const deleteReportView = z.object({ type: z.literal("deleteReportView"), id: z.uuid() });

export interface ManagerRecord {
  id: string;
  leadId: string | null;
  loanId: string | null;
  name: string;
  officer: string;
  officerEmail: string | null;
  source: (typeof leadSources)[number];
  campaignId: string | null;
  campaignName: string | null;
  segmentId: string | null;
  segmentName: string | null;
  createdAt: string | null;
  firstContactAt: string | null;
  replyReceivedAt: string | null;
  dueAt: string | null;
  submittedAt: string | null;
  resolvedAt: string | null;
  amount: number;
  targetDate: string | null;
  fundingDate: string | null;
  active: number;
  outreachSuppressed: boolean;
}

export interface ManagerReports {
  records: ManagerRecord[];
  views: { id: string; name: string; filters: ReportFilters }[];
  returningClients: ReturningClientReportRow[];
}

export type ReturningClientMetric = "check-ins" | "callbacks" | "applications";
export interface ReturningClientReportRow {
  id: string;
  metric: ReturningClientMetric;
  name: string;
  contactId: string;
  loanId: string | null;
  officer: string;
  officerEmail: string | null;
  at: string;
  detail: string;
}

export const reportOwner = (record: Pick<ManagerRecord, "officerEmail" | "officer">) =>
  record.officerEmail ? `email:${record.officerEmail}` : `name:${record.officer}`;

export function reportDateInRange(date: string | null, from: string, through: string) {
  const day = date && (date.length === 10 ? date : easternDate(new Date(date)));
  return !!day && (!from || day >= from) && (!through || day <= through);
}

export function reportRows(records: ManagerRecord[], filters: ReportFilters, now: number) {
  const selected = records.filter((item) => (!filters.owner || reportOwner(item) === filters.owner)
    && (!filters.source || item.source === filters.source)
    && (!filters.campaign || item.campaignId === filters.campaign)
    && (!filters.segment || item.segmentId === filters.segment));
  const inRange = (date: string | null) => reportDateInRange(date, filters.from, filters.through);
  const leads = selected.filter((item) => inRange(item.createdAt));
  const responded = leads.filter((item) => item.firstContactAt && Date.parse(item.firstContactAt) >= Date.parse(item.createdAt!));
  return {
    leads, responded,
    overdue: leads.filter((item) => !item.outreachSuppressed && !item.firstContactAt && !item.replyReceivedAt && item.active && item.dueAt && Date.parse(item.dueAt) < now),
    submitted: leads.filter((item) => item.submittedAt),
    converted: leads.filter((item) => item.fundingDate),
    projected: selected.filter((item) => !item.fundingDate && item.active && inRange(item.targetDate)),
    funded: selected.filter((item) => inRange(item.fundingDate)),
  };
}

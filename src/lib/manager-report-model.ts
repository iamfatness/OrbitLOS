import { z } from "zod";
import { easternDate } from "./client-retention";
import { leadSources } from "./model";

export const reportFilters = z.object({
  from: z.union([z.iso.date(), z.literal("")]),
  through: z.union([z.iso.date(), z.literal("")]),
  owner: z.string().max(300),
  source: z.enum(["", ...leadSources]),
}).refine((value) => !value.from || !value.through || value.from <= value.through, "Choose an end date on or after the start date.");

export type ReportFilters = z.infer<typeof reportFilters>;
export const defaultReportFilters: ReportFilters = { from: "", through: "", owner: "", source: "" };

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
  createdAt: string | null;
  firstContactAt: string | null;
  dueAt: string | null;
  submittedAt: string | null;
  resolvedAt: string | null;
  amount: number;
  targetDate: string | null;
  fundingDate: string | null;
  active: number;
}

export interface ManagerReports {
  records: ManagerRecord[];
  views: { id: string; name: string; filters: ReportFilters }[];
}

export const reportOwner = (record: ManagerRecord) => record.officerEmail ? `email:${record.officerEmail}` : `name:${record.officer}`;

export function reportRows(records: ManagerRecord[], filters: ReportFilters, now: number) {
  const selected = records.filter((item) => (!filters.owner || reportOwner(item) === filters.owner)
    && (!filters.source || item.source === filters.source));
  const inRange = (date: string | null) => {
    const day = date && (date.length === 10 ? date : easternDate(new Date(date)));
    return !!day && (!filters.from || day >= filters.from) && (!filters.through || day <= filters.through);
  };
  const leads = selected.filter((item) => inRange(item.createdAt));
  const responded = leads.filter((item) => item.firstContactAt && Date.parse(item.firstContactAt) >= Date.parse(item.createdAt!));
  return {
    leads, responded,
    overdue: leads.filter((item) => !item.firstContactAt && item.active && item.dueAt && Date.parse(item.dueAt) < now),
    submitted: leads.filter((item) => item.submittedAt),
    converted: leads.filter((item) => item.fundingDate),
    projected: selected.filter((item) => !item.fundingDate && item.active && inRange(item.targetDate)),
    funded: selected.filter((item) => inRange(item.fundingDate)),
  };
}

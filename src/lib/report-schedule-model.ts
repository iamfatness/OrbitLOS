import { z } from "zod";
import type { CustomReportCounts, CustomReportMetric } from "./custom-report-model";

export const reportScheduleCadences = ["Weekly", "Monthly"] as const;
export type ReportScheduleCadence = (typeof reportScheduleCadences)[number];
const id = z.uuid();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveRevision = revision.positive();
const date = z.iso.date().refine(day => day >= "2000-01-01" && day <= "2099-12-31");
const recipients = z.array(z.email().max(254).transform(value => value.toLowerCase())).min(1).max(5)
  .refine(values => new Set(values).size === values.length);
const reference = { reportId: id, revision: positiveRevision, scheduledOn: date };
export const reportScheduleQuery = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), archiveBefore: positiveRevision.optional() }).strict(),
  z.object({ type: z.literal("attention") }).strict(),
  z.object({ type: z.literal("history"), reportId: id, before: positiveRevision.optional() }).strict(),
  z.object({ type: z.literal("preview"), ...reference }).strict(),
  z.object({ type: z.literal("save"), reportId: id, reportRevision: positiveRevision, revision, operationId: id,
    cadence: z.enum(reportScheduleCadences), startsOn: date, recipients }).strict(),
  z.object({ type: z.literal("setPaused"), reportId: id, revision: positiveRevision, operationId: id, paused: z.boolean() }).strict(),
  z.object({ type: z.literal("run"), ...reference, operationId: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

export type ReportScheduleRecipient = { email: string; name: string };
export type ReportSchedule = {
  reportId: string;
  reportName: string;
  reportRevision: number;
  currentReportRevision: number;
  revision: number;
  cadence: ReportScheduleCadence;
  startsOn: string;
  nextOn: string;
  paused: boolean;
  recipients: ReportScheduleRecipient[];
  state: "Active" | "Paused" | "Report changed" | "Report archived" | "Recipients changed" | "Report filter unavailable";
};

type Summary = {
  reportId: string;
  reportName: string;
  reportRevision: number;
  scheduleRevision: number;
  scheduledOn: string;
  recipients: ReportScheduleRecipient[];
  from: string;
  through: string;
  metrics: CustomReportMetric[];
  totals: CustomReportCounts;
};

export type ReportSchedulePreview = Summary & { kind: "preview"; fingerprint: string };
export type ReportScheduleReceipt = Summary & { kind: "receipt"; id: string; recordedAt: string; actor: string; nextOn: string };
export type ReportScheduleList = { kind: "list"; today: string; schedules: ReportSchedule[]; recipients: ReportScheduleRecipient[]; nextArchive: number | null };
export type ReportScheduleAttention = {
  kind: "attention";
  due: number;
  blocked: number;
  items: { reportId: string; reportName: string; nextOn: string; status: "Due today" | "Overdue" |
    "Report changed" | "Recipients changed" | "Report filter unavailable" }[];
};
export type ReportScheduleResult = ReportScheduleList | ReportScheduleAttention | { kind: "saved"; schedule: ReportSchedule } |
  { kind: "history"; receipts: ReportScheduleReceipt[]; next: number | null } |
  ReportSchedulePreview | ReportScheduleReceipt | { error: string };

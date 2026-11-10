import { z } from "zod";
import { crmFieldFilter, type CrmFieldRecord } from "./crm-field-model";
import { easternDate } from "./client-retention";
import { leadSources } from "./model";
import { reportMonthDates, shiftReportDate, validReportRange } from "./report-date-range";

export const customReportUnavailable = "This custom report is unavailable in your workspace.";
export const customReportLimit = 30;
export const customReportExportLimit = 2_000;
export const customReportTypes = ["Intake cohort", "Loan production"] as const;
export const customReportFieldRecords = {
  "Intake cohort": ["lead"], "Loan production": ["contact", "loan"],
} as const satisfies Record<(typeof customReportTypes)[number], readonly CrmFieldRecord[]>;
export const customReportGroups = ["None", "Lead source", "Campaign", "Loan officer", "Purpose", "Current stage"] as const;
export const customReportColumns = ["Lead source", "Loan officer", "Purpose", "Current status", "Loan amount"] as const;
export const customReportRoles = ["LO", "Processor"] as const;
export const customReportMetricLabels = {
  inquiries: "Inquiries received", converted: "Inquiries with a submitted 1003", cohortFunded: "Inquiries with a funded loan",
  files: "Files created", applications: "First 1003 submissions", funding: "Recorded fundings",
} as const;
const metrics = ["inquiries", "converted", "cohortFunded", "files", "applications", "funding"] as const;
export const customReportChoices = {
  "Intake cohort": { metrics: ["inquiries", "converted", "cohortFunded"], groups: ["None", "Lead source", "Campaign", "Loan officer", "Purpose"] },
  "Loan production": { metrics: ["files", "applications", "funding"], groups: ["None", "Lead source", "Loan officer", "Purpose", "Current stage"] },
} as const satisfies Record<(typeof customReportTypes)[number], { metrics: readonly (typeof metrics)[number][]; groups: readonly (typeof customReportGroups)[number][] }>;
export const customReportPeriods = ["This month", "Last 30 days", "Fixed dates"] as const;
const fixedDates = z.object({ kind: z.literal("Fixed dates"), from: z.iso.date(), through: z.iso.date() })
  .refine((range) => validReportRange(range) && range.through <= "9999-12-30", "Choose a valid range of up to 366 days.");
const period = z.union([z.object({ kind: z.enum(["This month", "Last 30 days"]) }), fixedDates]);
const role = z.enum(customReportRoles);
export const customReportDefinition = z.object({
  name: z.string().trim().min(1).max(80), dataset: z.enum(customReportTypes), period, groupBy: z.enum(customReportGroups),
  metrics: z.array(z.enum(metrics)).min(1).max(3), columns: z.array(z.enum(customReportColumns)).max(customReportColumns.length),
  source: z.enum(["", ...leadSources]), purpose: z.enum(["", "Purchase", "Refinance"]), roles: z.array(role).max(2),
  customFilter: crmFieldFilter.optional(),
}).superRefine((report, ctx) => {
  const choices = customReportChoices[report.dataset];
  if (!choices.groups.some((group) => group === report.groupBy) || report.metrics.some((metric) => !choices.metrics.some((item) => item === metric))) {
    ctx.addIssue({ code: "custom", message: "Choose metrics and a grouping for this report type." });
  }
  if (new Set(report.metrics).size !== report.metrics.length || new Set(report.columns).size !== report.columns.length ||
      new Set(report.roles).size !== report.roles.length) ctx.addIssue({ code: "custom", message: "Choose each option only once." });
  if (report.dataset === "Intake cohort" && report.roles.includes("Processor")) {
    ctx.addIssue({ code: "custom", message: "Share loan production reports with processors." });
  }
});

const recordId = z.string().min(1).max(160);
const groupKey = z.string().min(1).max(320);
const version = z.number().int().positive();
const cursorDate = z.union([z.iso.date(), z.iso.datetime()]);
const reference = { id: z.uuid(), revision: version };
export const customReportInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("save"), id: z.uuid(), revision: z.number().int().nonnegative(), definition: customReportDefinition }),
  z.object({ type: z.literal("archive"), ...reference }),
  z.object({ type: z.literal("run"), ...reference, after: z.object({ key: groupKey, name: z.string().min(1).max(240) }).optional() }),
  z.object({ type: z.literal("records"), ...reference, metric: z.enum(metrics), group: groupKey.optional(),
    after: z.object({ at: cursorDate, id: recordId }).optional() }),
  z.object({ type: z.literal("export"), ...reference, metric: z.enum(metrics).optional(), group: groupKey.optional(),
    from: z.iso.date(), through: z.iso.date() }),
]);
export type CustomReportInput = z.infer<typeof customReportInput>;
export type CustomReportDefinition = z.infer<typeof customReportDefinition>;
export type CustomReport = CustomReportDefinition & { id: string; revision: number };
export type CustomReportMetric = CustomReportDefinition["metrics"][number];
export type CustomReportCounts = Partial<Record<CustomReportMetric, number>>;
export type CustomReportGroup = { key: string; name: string; counts: CustomReportCounts };
export type CustomReportRecord = {
  id: string; at: string; name: string; destination: { kind: "lead" | "loan"; id: string };
  values: Partial<Record<(typeof customReportColumns)[number], string | number | null>>;
};
export type CustomReportRun = {
  kind: "run"; from: string; through: string; totals: CustomReportCounts; groups: CustomReportGroup[];
  next: { key: string; name: string } | null;
};
export type CustomReportRecords = { kind: "records"; rows: CustomReportRecord[]; next: { id: string; at: string } | null };
export type CustomReportResult = { kind: "list"; reports: CustomReport[] } | { kind: "saved"; report: CustomReport } |
  { kind: "archived" } | { kind: "export"; csv: string; filename: string; count: number } |
  CustomReportRun | CustomReportRecords | { error: string };

export function customReportRange(value: CustomReportDefinition["period"], now: Date) {
  if (value.kind === "Fixed dates") return { from: value.from, through: value.through };
  const today = easternDate(now);
  return value.kind === "This month" ? reportMonthDates(today.slice(0, 7)) : { from: shiftReportDate(today, -29), through: today };
}

export const defaultCustomReport: CustomReportDefinition = {
  name: "", dataset: "Intake cohort", period: { kind: "This month" }, groupBy: "Lead source",
  metrics: ["inquiries", "converted", "cohortFunded"], columns: ["Loan officer", "Purpose", "Current status"], source: "", purpose: "", roles: [],
};

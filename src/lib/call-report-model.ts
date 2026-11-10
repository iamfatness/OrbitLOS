import { z } from "zod";
import { easternDate } from "./client-retention";

export const reportOutcomes = ["Approved but not accepted", "Denied", "Withdrawn", "Closed for incompleteness", "Closed and funded"] as const;
export const reportStates = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI".split(" ");
export const exclusionReasons = ["Duplicate file", "Outside reporting scope", "Fictional or training file", "Other reviewed reason"] as const;
const day = z.union([z.iso.date(), z.literal("")]);
const amount = z.number().int().min(0).max(1_000_000_000).nullable();
export const callReportFacts = z.object({
  eligibility: z.enum(["Review", "Include", "Exclude"]),
  exclusionReason: z.enum(["", ...exclusionReasons]),
  state: z.union([z.literal(""), z.enum(reportStates)]),
  originator: z.string().trim().regex(/^\d{0,15}$/, "Enter a numeric NMLS ID."),
  receivedDate: day,
  receivedAmount: amount,
  outcome: z.enum(["", ...reportOutcomes]),
  outcomeDate: day,
  outcomeAmount: amount,
}).superRefine((facts, ctx) => {
  if ((facts.eligibility === "Exclude") !== Boolean(facts.exclusionReason)) {
    ctx.addIssue({ code: "custom", path: ["exclusionReason"], message: "Choose a reason for an excluded record." });
  }
  if (facts.outcomeDate && facts.receivedDate && facts.outcomeDate < facts.receivedDate) {
    ctx.addIssue({ code: "custom", path: ["outcomeDate"], message: "The outcome date must be on or after the application date." });
  }
  if (!facts.outcome && (facts.outcomeDate || facts.outcomeAmount !== null)) {
    ctx.addIssue({ code: "custom", path: ["outcome"], message: "Choose an outcome before recording its date or amount." });
  }
});
export type CallReportFacts = z.infer<typeof callReportFacts>;
export const emptyCallReportFacts: CallReportFacts = {
  eligibility: "Review", exclusionReason: "", state: "", originator: "", receivedDate: "", receivedAmount: null, outcome: "", outcomeDate: "", outcomeAmount: null,
};
export const saveCallReport = z.object({
  type: z.literal("saveCallReport"), loanId: z.string().min(1).max(100), revision: z.number().int().nonnegative(), facts: callReportFacts,
});

export interface CallReportFile {
  loanId: string;
  stage: string;
  disposition: string;
  facts: CallReportFacts;
  revision: number;
  suggested: { receivedDate: string; receivedAmount: number | null; state: string; fundingDate: string; currentAmount: number };
}
export const callReportGroups = ["Beginning pipeline", "Applications received", ...reportOutcomes, "Ending pipeline", "Needs review", "Excluded"] as const;
type CallReportGroup = (typeof callReportGroups)[number];
export interface CallReportRow {
  file: CallReportFile;
  groups: CallReportGroup[];
  issues: string[];
}

export function quarterRange(year: number, quarter: number) {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  return { from: day(new Date(Date.UTC(year, (quarter - 1) * 3, 1))), through: day(new Date(Date.UTC(year, quarter * 3, 0))) };
}

export function callReportActivity(file: CallReportFile) {
  const { facts, suggested } = file;
  const received = facts.receivedDate || suggested.receivedDate;
  const outcomeDate = facts.outcomeDate || suggested.fundingDate;
  const candidate = Boolean(received || outcomeDate || file.revision || !["Lead", "Pre-qual"].includes(file.stage) || file.disposition === "Withdrawn");
  return { received, outcomeDate, candidate };
}

export function callReportIssues(file: CallReportFile) {
  const { facts, suggested } = file;
  const issues: string[] = [];
  if (facts.eligibility === "Exclude") return issues;
  if (facts.eligibility === "Review") issues.push("Confirm reporting eligibility");
  if (!facts.state) issues.push("Confirm property state");
  if (!facts.originator) issues.push("Enter originator NMLS ID");
  if (!facts.receivedDate) issues.push("Confirm application received date");
  if (facts.receivedAmount === null) issues.push("Confirm application amount");
  if (facts.outcome && !facts.outcomeDate) issues.push("Enter outcome date");
  if (facts.outcome && facts.outcomeAmount === null) issues.push("Confirm outcome amount");
  if (!facts.outcome && (suggested.fundingDate || ["Funded", "Closed"].includes(file.stage) || ["Withdrawn", "Lost"].includes(file.disposition))) {
    issues.push("Confirm the reporting outcome");
  }
  if (facts.outcome === "Closed and funded" && (!suggested.fundingDate || facts.outcomeDate !== suggested.fundingDate)) {
    issues.push("Reconcile the reporting outcome with the recorded funding date");
  } else if (suggested.fundingDate && facts.outcome && facts.outcome !== "Closed and funded") {
    issues.push("Reconcile this outcome with the recorded funding");
  }
  return issues;
}

export function quarterlyCallReport(files: CallReportFile[], range: ReturnType<typeof quarterRange>): CallReportRow[] {
  const inRange = (value: string) => value >= range.from && value <= range.through;
  return files.flatMap((file) => {
    const { facts } = file;
    const { received, outcomeDate, candidate } = callReportActivity(file);
    if (!candidate || (!inRange(received) && !inRange(outcomeDate) && !inRange(file.suggested.fundingDate) &&
      (received > range.through || Boolean(outcomeDate && outcomeDate < range.from)))) return [];
    const groups: CallReportGroup[] = [];
    const issues = callReportIssues(file);
    if (facts.eligibility === "Exclude") return [{ file, groups: ["Excluded"], issues }];
    if (issues.length) groups.push("Needs review");
    else {
      if (received < range.from) groups.push("Beginning pipeline");
      if (inRange(received)) groups.push("Applications received");
      if (facts.outcome && inRange(facts.outcomeDate)) groups.push(facts.outcome);
      if (received <= range.through && (!facts.outcomeDate || facts.outcomeDate > range.through)) groups.push("Ending pipeline");
    }
    return groups.length ? [{ file, groups, issues }] : [];
  });
}

export function callReportAmount(row: CallReportRow, group: CallReportGroup) {
  return reportOutcomes.some((outcome) => outcome === group) ? row.file.facts.outcomeAmount ?? 0 : row.file.facts.receivedAmount ?? 0;
}

export const applicationDay = (value: string | null) => value ? easternDate(new Date(value)) : "";

export function callReportCsvCell(value: string | number | null) {
  const string = String(value ?? "");
  return `"${(typeof value === "string" && /^[\s]*[=+\-@]/.test(string) ? "'" + string : string).replaceAll('"', '""')}"`;
}

export function callReportCsv(rows: CallReportRow[], from: string, through: string) {
  const header = ["Quarter start", "Quarter end", "Loan ID", "State", "Originator NMLS ID", "Review groups", "Received date",
    "Received amount", "Outcome", "Outcome date", "Outcome amount", "Exclusion reason", "Review issues"];
  return [header.join(","), ...rows.map(({ file, groups, issues }) => {
    const { facts } = file;
    return [from, through, file.loanId, facts.state, facts.originator, groups.join(" | "), facts.receivedDate, facts.receivedAmount,
      facts.outcome, facts.outcomeDate, facts.outcomeAmount, facts.exclusionReason, issues.join(" | ")].map(callReportCsvCell).join(",");
  })].join("\r\n");
}

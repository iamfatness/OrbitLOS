import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

export const newYorkApplicationLogSource = "https://govt.westlaw.com/nycrr/Document/I4e77f867cd1711dda432a117e6e0f345?transitionType=Default";
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "2199-12-31");
const text = (max: number) => z.string().trim().min(1).max(max);
const reference = text(240).min(4);
const uuid = z.uuid();
const person = z.strictObject({ name: text(160), address: text(300) });
const party = person.extend({ description: text(160) });
const cents = z.int().positive().max(10_000_000_000);
const accounting = z.strictObject({ status: z.literal("Accounting record"), reference });

const preclosingFees = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("Unreviewed") }),
  z.strictObject({ status: z.literal("None"), reference }),
  accounting,
  z.strictObject({ status: z.literal("Recorded"), items: z.array(z.strictObject({
    amountCents: cents, paidOn: date, purpose: text(160),
    direction: z.enum(["Collected", "Distributed"]), counterparty: party,
  })).min(1).max(100) }),
]);
const brokerageFees = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("Unreviewed") }),
  z.strictObject({ status: z.literal("None"), reference }),
  accounting,
  z.strictObject({ status: z.literal("Recorded"), items: z.array(z.strictObject({
    amountCents: cents, source: text(160), sourceType: z.enum(["Applicant", "Lender", "Broker", "Other"]),
  })).min(1).max(100) }),
]);

const rejectedFile = z.strictObject({
  inventory: reference.optional(),
  location: reference.optional(),
  retrieval: z.strictObject({ on: date, reference }).optional(),
  retentionBasis: z.strictObject({ on: date, reference }).optional(),
});
const branchReport = z.strictObject({
  activityOn: date, activityReference: reference,
  deadline: z.strictObject({ on: date, reference }).optional(),
  delivery: z.strictObject({ at: z.iso.datetime({ offset: true }).refine(at => Number.isFinite(Date.parse(at))), reference }).optional(),
});
const branchReporting = z.discriminatedUnion("office", [
  z.strictObject({ office: z.literal("Principal office"), reference }),
  z.strictObject({ office: z.literal("Branch office"), reports: z.array(branchReport).max(100) }),
]);
const nyDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
  minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function easternParts(at: string) {
  const parts = Object.fromEntries(nyDateTime.formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return { on: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}
function afterNoon(at: string, dueOn: string) {
  const { on, time } = easternParts(at);
  if (on !== dueOn) return on > dueOn;
  return time > "12:00:00" || (time === "12:00:00" && /\.[0-9]*[1-9][0-9]*(?:Z|[+-])/u.test(at));
}

export const newYorkApplicationFacts = z.strictObject({
  fileNumber: text(100), office: text(160), applicationOn: date,
  applicants: z.array(person).min(1).max(12), propertyAddress: text(300),
  source: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("Unreviewed") }),
    z.strictObject({ status: z.literal("Direct"), description: text(160) }),
    z.strictObject({ status: z.literal("Referral"), referrer: party }),
    accounting,
  ]),
  disposition: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("Pending") }),
    z.strictObject({ status: z.literal("Final"), outcome: z.enum(["Closed", "Denied", "Withdrawn", "Other"]),
      on: date, reference }),
  ]),
  placement: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("Unreviewed") }),
    z.strictObject({ status: z.literal("Placed"), entity: text(160) }),
    z.strictObject({ status: z.literal("Not placed"), reference }),
    accounting,
  ]),
  preclosingFees, brokerageFees,
  branchReporting: branchReporting.optional(),
  rejectedFile: rejectedFile.optional(),
  earlierLog: z.strictObject({ on: date, reference }).optional(),
}).superRefine((facts, ctx) => {
  if (facts.branchReporting?.office === "Branch office") {
    const dates = new Set<string>();
    facts.branchReporting.reports.forEach((report, index) => {
      const path = ["branchReporting", "reports", index];
      if (dates.has(report.activityOn))
        ctx.addIssue({ code: "custom", path, message: "Use one daily branch report per activity date." });
      dates.add(report.activityOn);
      if (report.activityOn < facts.applicationOn)
        ctx.addIssue({ code: "custom", path, message: "Branch activity cannot precede application receipt." });
      if (report.deadline && report.deadline.on < shiftReportDate(report.activityOn, 5))
        ctx.addIssue({ code: "custom", path, message: "The fifth business day must be at least five calendar days after the activity." });
      if (report.delivery && Number.isFinite(Date.parse(report.delivery.at)) && easternParts(report.delivery.at).on < report.activityOn)
        ctx.addIssue({ code: "custom", path, message: "Principal-office receipt cannot precede branch activity." });
    });
  }
  if (facts.rejectedFile) {
    const { disposition } = facts;
    if (disposition.status !== "Final" || disposition.outcome !== "Denied")
      ctx.addIssue({ code: "custom", path: ["rejectedFile"], message: "Rejected-file evidence belongs with a denied application." });
    else if ([facts.rejectedFile.retrieval?.on, facts.rejectedFile.retentionBasis?.on].some(on => on && on < disposition.on))
      ctx.addIssue({ code: "custom", path: ["rejectedFile"], message: "The rejected-file retrieval and reviewed retention start cannot precede the denial." });
  }
  if (facts.earlierLog && facts.earlierLog.on < facts.applicationOn)
    ctx.addIssue({ code: "custom", path: ["earlierLog"], message: "The earlier log entry cannot precede application receipt." });
  if (facts.disposition.status === "Final" && facts.disposition.on < facts.applicationOn)
    ctx.addIssue({ code: "custom", path: ["disposition"], message: "The disposition cannot precede application receipt." });
  if (facts.disposition.status === "Final" && facts.disposition.outcome === "Closed" && facts.placement.status === "Not placed")
    ctx.addIssue({ code: "custom", path: ["placement"], message: "Identify where the closed loan was placed or reference the accounting record." });
});
export type NewYorkApplicationFacts = z.infer<typeof newYorkApplicationFacts>;

export function reviewNewYorkApplication(facts: NewYorkApplicationFacts, firstSavedOn: string, reviewedAt?: string) {
  const gaps: string[] = [];
  if (facts.source.status === "Unreviewed") gaps.push("Application source");
  if (facts.placement.status === "Unreviewed") gaps.push("Placement or basis");
  if (facts.preclosingFees.status === "Unreviewed") gaps.push("Preclosing fee reconciliation");
  if (facts.brokerageFees.status === "Unreviewed") gaps.push("Brokerage compensation by source");
  const firstLoggedOn = facts.earlierLog?.on ?? firstSavedOn;
  const loggedAfterReceipt = firstLoggedOn > facts.applicationOn;
  if (loggedAfterReceipt) gaps.push("First documented log entry follows receipt date");
  if (firstLoggedOn < facts.applicationOn) gaps.push("Recorded application date follows the first Orbit save");
  const reporting = facts.branchReporting;
  if (!reporting) gaps.push("Confirm whether the originating office was a branch.");
  if (reporting?.office === "Branch office" && !reporting.reports.some(report => report.activityOn === facts.applicationOn))
    gaps.push("Document the branch report for the application receipt date.");
  const branchReports = reporting?.office === "Branch office" ? reporting.reports.map(report => {
    const dueOn = report.deadline?.on ?? null;
    const comparedAt = report.delivery?.at ?? reviewedAt;
    const missed = !!comparedAt && !!dueOn && afterNoon(comparedAt, dueOn);
    const status = !dueOn ? "Verify calendar" : report.delivery ? missed ? "Late" : "On time" :
      missed ? "Overdue" : "Awaiting receipt";
    if (status !== "On time") gaps.push(`Branch activity ${report.activityOn} · ${status}`);
    return { ...report, status, dueOn };
  }) : [];
  const denied = facts.disposition.status === "Final" && facts.disposition.outcome === "Denied";
  const rejected = facts.rejectedFile;
  let rejectedFileReviewOn: string | null = null;
  if (denied) {
    if (!rejected?.inventory) gaps.push("Document the rejected application file inventory.");
    if (!rejected?.location || !rejected.retrieval) gaps.push("Document the rejected file location and retrieval check.");
    if (!rejected?.retentionBasis) gaps.push("Document the reviewed retention start for the rejected file.");
    else {
      const on = rejected.retentionBasis.on;
      const anniversary = date.safeParse(String(Number(on.slice(0, 4)) + 3) + on.slice(4));
      if (anniversary.success) rejectedFileReviewOn = anniversary.data;
      else gaps.push("Confirm the three-year anniversary for the rejected file.");
    }
  }
  return { gaps, firstLoggedOn, loggedAfterReceipt, branchReports, rejectedFileReviewOn };
}

export const newYorkApplicationLogRequest = z.strictObject({
  type: z.literal("newYorkApplicationLog"), entityId: uuid,
  input: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("list"), from: date, through: date, search: z.string().trim().max(120), offset: z.int().min(0).max(10000) }),
    z.strictObject({ operation: z.literal("history"), entryId: uuid, before: z.int().positive().optional() }),
    z.strictObject({ operation: z.literal("save"), entryId: uuid, requestId: uuid, expected: z.int().nonnegative(),
      facts: newYorkApplicationFacts, correction: reference.optional() }),
    z.strictObject({ operation: z.literal("void"), entryId: uuid, requestId: uuid, expected: z.int().positive(), correction: reference }),
    z.strictObject({ operation: z.literal("export"), from: date, through: date }),
  ]),
});
export type NewYorkApplicationLogRequest = z.infer<typeof newYorkApplicationLogRequest>;

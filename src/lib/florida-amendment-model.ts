import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

const date = z.iso.date().refine(on => on >= "2010-10-01" && on <= "2199-12-31");
const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: date, reference });
const reviewedCalendar = z.strictObject({ through: date, holidays: z.array(date).max(31), reference });
export const floridaAmendmentFacts = z.strictObject({
  authority: z.enum(["Mortgage broker", "Mortgage lender"]),
  licenseReference: reference,
  zone: z.enum(["America/New_York", "America/Chicago"]),
  effective: event,
  change: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("Principal loan originator"), designationReference: reference, eligibilityReference: reference.optional() }),
    z.strictObject({ kind: z.literal("Application information") }),
    z.strictObject({ kind: z.literal("Bankruptcy"), calendar: reviewedCalendar.optional() }),
    z.strictObject({ kind: z.literal("Control person"), timing: z.discriminatedUnion("route", [
      z.strictObject({ route: z.literal("Advance filing") }),
      z.strictObject({ route: z.literal("First notice"), firstNotice: event,
        calendar: reviewedCalendar.optional() }),
    ]) }),
  ]),
  filed: event.optional(),
  status: event.extend({ outcome: z.enum(["Pending", "Acknowledged", "Deficiency", "Other"]) }).optional(),
});
export type FloridaAmendmentFacts = z.infer<typeof floridaAmendmentFacts>;

export const floridaAmendmentRequest = z.strictObject({
  type: z.literal("floridaAmendment"),
  entityId: z.uuid(),
  input: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("list"), offset: z.int().min(0).max(10000).default(0) }),
    z.strictObject({ operation: z.literal("history"), noticeId: z.uuid(), before: z.int().positive().optional() }),
    z.strictObject({ operation: z.literal("save"), noticeId: z.uuid(), requestId: z.uuid(), expected: z.int().nonnegative(),
      facts: floridaAmendmentFacts, correction: reference.optional() }),
  ]),
});
export type FloridaAmendmentRequest = z.infer<typeof floridaAmendmentRequest>;

export function reviewFloridaAmendment(facts: FloridaAmendmentFacts, asOf: string) {
  const { change, effective, filed, status } = facts;
  const timing = change.kind === "Control person" ? change.timing : undefined;
  const notice = timing?.route === "First notice" ? timing.firstNotice : undefined;
  const bankruptcy = change.kind === "Bankruptcy";
  const lender = facts.authority === "Mortgage lender";
  const authority = bankruptcy ? (lender ? "Fla. Stat. §494.0067(6)" : "Fla. Stat. §494.004(1)(c)") :
    lender ? "Fla. Stat. §494.0067(3)–(4)" : "Fla. Stat. §494.004(1)";
  const source = bankruptcy ? "https://www.flsenate.gov/Laws/Statutes/2026/" + (lender ? "494.0067" : "494.004") :
    "https://flrules.org/gateway/ruleno.asp?id=69V-40.099";
  const basis = { asOf, authority, rule: bankruptcy ? authority : "Fla. Admin. Code R. 69V-40.099", source,
    designationReview: change.kind === "Principal loan originator" && !change.eligibilityReference,
    regulatorStatus: status?.outcome ?? "No regulator status recorded" };
  if ([filed?.on, status?.on, notice?.on, bankruptcy ? effective.on : undefined].some(on => on && on > asOf) ||
    (filed && status && status.on < filed.on) || (filed && notice && filed.on < notice.on) ||
    (bankruptcy && ((filed && filed.on < effective.on) || (status && status.on < effective.on))))
    return { ...basis, dueOn: null, timingStatus: "Verify event dates" };
  let dueOn: string | null = shiftReportDate(effective.on, timing ? -30 : 30);
  if (timing?.route === "First notice")
    dueOn = businessDeadline(timing.firstNotice.on, 2, timing.calendar);
  if (change.kind === "Bankruptcy" && lender)
    dueOn = businessDeadline(effective.on, 30, change.calendar);
  if (!dueOn) return { ...basis, dueOn: null, timingStatus: "Verify business-day calendar" };
  const timingStatus = filed ? (filed.on <= dueOn ? "Filed by nominal date" : "Filed after nominal date") :
    asOf > dueOn ? "Nominal date passed without filing evidence" : asOf === dueOn ? "Nominal date today" : "Pending filing evidence";
  return { ...basis, dueOn, timingStatus };
}


function businessDeadline(triggerOn: string, days: number, calendar?: z.infer<typeof reviewedCalendar>) {
  if (!calendar || calendar.holidays.some(on => on <= triggerOn || on > calendar.through)) return null;
  const holidays = new Set(calendar.holidays);
  let remaining = days;
  for (let on = shiftReportDate(triggerOn, 1); on <= calendar.through; on = shiftReportDate(on, 1)) {
    const weekday = new Date(on).getUTCDay();
    if (weekday === 0 || weekday === 6 || holidays.has(on)) continue;
    if (--remaining === 0) return on;
  }
  return null;
}

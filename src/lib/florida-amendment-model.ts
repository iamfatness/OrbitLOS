import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

const date = z.iso.date().refine(on => on >= "2010-10-01" && on <= "2199-12-31");
const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: date, reference });
export const floridaAmendmentFacts = z.strictObject({
  authority: z.enum(["Mortgage broker", "Mortgage lender"]),
  licenseReference: reference,
  zone: z.enum(["America/New_York", "America/Chicago"]),
  effective: event,
  change: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("Principal loan originator"), designationReference: reference, eligibilityReference: reference.optional() }),
    z.strictObject({ kind: z.literal("Application information") }),
    z.strictObject({ kind: z.literal("Control person"), timing: z.discriminatedUnion("route", [
      z.strictObject({ route: z.literal("Advance filing") }),
      z.strictObject({ route: z.literal("First notice"), firstNotice: event,
        calendar: z.strictObject({ through: date, holidays: z.array(date).max(31), reference }).optional() }),
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
  const authority = facts.authority === "Mortgage broker" ? "Fla. Stat. §494.004(1)" : "Fla. Stat. §494.0067(3)–(4)";
  const basis = { asOf, authority, rule: "Fla. Admin. Code R. 69V-40.099",
    source: "https://flrules.org/gateway/ruleno.asp?id=69V-40.099",
    designationReview: change.kind === "Principal loan originator" && !change.eligibilityReference,
    regulatorStatus: status?.outcome ?? "No regulator status recorded" };
  if ([filed?.on, status?.on, notice?.on].some(on => on && on > asOf) || (filed && status && status.on < filed.on) ||
    (filed && notice && filed.on < notice.on))
    return { ...basis, dueOn: null, timingStatus: "Verify event dates" };
  let dueOn = shiftReportDate(effective.on, timing ? -30 : 30);
  if (timing?.route === "First notice") {
    const { calendar, firstNotice } = timing;
    const through = calendar?.through;
    if (calendar?.holidays.some(on => on <= firstNotice.on || on > calendar.through))
      return { ...basis, dueOn: null, timingStatus: "Verify business-day calendar" };
    const holidays = new Set(calendar?.holidays);
    let counted = 0;
    dueOn = "";
    for (let on = shiftReportDate(firstNotice.on, 1); through && on <= through; on = shiftReportDate(on, 1)) {
      const weekday = new Date(on).getUTCDay();
      if (weekday === 0 || weekday === 6 || holidays.has(on)) continue;
      counted++;
      if (counted === 2) { dueOn = on; break; }
    }
    if (!dueOn) return { ...basis, dueOn: null, timingStatus: "Verify business-day calendar" };
  }
  const timingStatus = filed ? (filed.on <= dueOn ? "Filed by nominal date" : "Filed after nominal date") :
    asOf > dueOn ? "Nominal date passed without filing evidence" : asOf === dueOn ? "Nominal date today" : "Pending filing evidence";
  return { ...basis, dueOn, timingStatus };
}

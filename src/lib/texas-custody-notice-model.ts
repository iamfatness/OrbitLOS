import { z } from "zod";
import { shiftReportDate } from "./report-date-range";
import { texasRecordkeepingSources } from "./texas-recordkeeping-model";

const date = z.iso.date().refine(on => on >= "1900-01-01" && on <= "2199-12-31");
const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: date, reference });
const currentRuleFrom = "2024-11-23";

export const texasCustodyNoticeFacts = z.strictObject({
  kind: z.enum(["Cessation", "Transfer received"]),
  zone: z.enum(["America/Chicago", "America/Denver"]),
  authority: z.enum(["SML mortgage company", "SML mortgage banker"]),
  authorityReference: reference,
  trigger: event,
  custodyReference: reference,
  delivered: z.strictObject({ on: date, writtenNotice: reference, deliveryEvidence: reference }).optional(),
  calendar: z.strictObject({ from: date, through: date, holidays: z.array(date).max(31), reference }).optional(),
}).superRefine(({ trigger, delivered, calendar }, ctx) => {
  if (delivered && delivered.on < trigger.on)
    ctx.addIssue({ code: "custom", path: ["delivered", "on"], message: "Delivery cannot precede the notice trigger." });
  if (calendar && (calendar.from > calendar.through || calendar.holidays.some(on => on < calendar.from || on > calendar.through)))
    ctx.addIssue({ code: "custom", path: ["calendar"], message: "Record holidays within the reviewed calendar range." });
});
export type TexasCustodyNoticeFacts = z.infer<typeof texasCustodyNoticeFacts>;

export const texasCustodyNoticeRequest = z.strictObject({
  type: z.literal("texasCustodyNotice"),
  entityId: z.uuid(),
  input: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("list"), offset: z.int().min(0).max(10000) }),
    z.strictObject({ operation: z.literal("history"), noticeId: z.uuid(), before: z.int().positive().optional() }),
    z.strictObject({ operation: z.literal("save"), noticeId: z.uuid(), requestId: z.uuid(), expected: z.int().nonnegative(),
      facts: texasCustodyNoticeFacts, correction: reference.optional() }),
  ]),
});
export type TexasCustodyNoticeRequest = z.infer<typeof texasCustodyNoticeRequest>;

export function reviewTexasCustodyNotice(facts: TexasCustodyNoticeFacts, asOf: string) {
  const source = texasRecordkeepingSources.rules;
  const authority = facts.authority === "SML mortgage company" ? "7 TAC §§56.204(b)(4), 56.5" : "7 TAC §§57.204(b)(4), 57.5";
  const basis = { authority, source, asOf };
  if (facts.trigger.on > asOf || (facts.delivered && facts.delivered.on > asOf))
    return { ...basis, status: "Verify event dates", nominalDueOn: null, dueOn: null } as const;
  if (facts.trigger.on < currentRuleFrom)
    return { ...basis, status: "Historical rule review", nominalDueOn: null, dueOn: null } as const;

  const nominalDueOn = shiftReportDate(facts.trigger.on, 10);
  const { calendar } = facts;
  if (!calendar || nominalDueOn < calendar.from)
    return { ...basis, status: "Verify calendar", nominalDueOn, dueOn: null } as const;

  const holidays = new Set(calendar.holidays);
  for (let day = nominalDueOn; day <= calendar.through; day = shiftReportDate(day, 1)) {
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6 || holidays.has(day)) continue;
    const status = facts.delivered ? (facts.delivered.on > day ? "Delivered late" : "Delivered on time")
      : asOf > day ? "Past due" : asOf === day ? "Due today" : "Pending delivery";
    return { ...basis, status, nominalDueOn, dueOn: day };
  }
  return { ...basis, status: "Verify calendar", nominalDueOn, dueOn: null } as const;
}

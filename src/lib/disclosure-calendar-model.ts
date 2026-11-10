import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

export const disclosureCalendarUnavailable = "Disclosure deadline calendar settings are available to fictional workspace admins.";
export const disclosureHolidayLimit = 40;
const supportedDate = z.iso.date().refine((day) => day >= "1900-01-01" && day <= "9999-09-30", "Choose a supported calendar date.");
const version = z.number().int().nonnegative();
const holiday = z.object({ on: supportedDate, label: z.string().trim().min(1).max(70) });
export const disclosureCalendarRules = z.object({
  saturday: z.boolean(), sunday: z.boolean(), signingDays: z.number().int().min(1).max(10),
  holidays: z.array(holiday).max(disclosureHolidayLimit),
}).superRefine(({ holidays }, ctx) => {
  if (new Set(holidays.map(({ on }) => on)).size !== holidays.length) {
    ctx.addIssue({ code: "custom", message: "Enter each holiday date only once.", path: ["holidays"] });
  }
});
export type DisclosureCalendarRules = z.infer<typeof disclosureCalendarRules>;
export const defaultDisclosureCalendar: DisclosureCalendarRules = { saturday: false, sunday: false, signingDays: 2, holidays: [] };
export const disclosureCalendarReference = z.object({ version, anchorOn: supportedDate });
export type DisclosureCalendarReference = z.infer<typeof disclosureCalendarReference>;
const calendarBasis = disclosureCalendarReference.extend({
  days: z.number().int().min(1).max(10),
  skipped: z.array(z.object({ on: z.iso.date(), label: z.string().max(70) })).max(80),
});
export type DisclosureCalendarBasis = z.infer<typeof calendarBasis>;
export type DisclosureDeadline = DisclosureCalendarBasis & { signBy: string };

export function storedDisclosureCalendarBasis(json: string | null | undefined): DisclosureCalendarBasis | null {
  if (!json) return null;
  try {
    const value = calendarBasis.safeParse(JSON.parse(json));
    return value.success ? value.data : null;
  } catch {
    return null;
  }
}

export function disclosureSigningDeadline(rules: DisclosureCalendarRules, reference: DisclosureCalendarReference): DisclosureDeadline {
  const holidays = new Map(rules.holidays.map(({ on, label }) => [on, label]));
  const skipped: DisclosureCalendarBasis["skipped"] = [];
  let signBy = reference.anchorOn;
  let remaining = rules.signingDays;
  while (remaining > 0) {
    signBy = shiftReportDate(signBy, 1);
    const weekday = new Date(signBy).getUTCDay();
    const closed = holidays.get(signBy) ?? (weekday === 6 && !rules.saturday ? "Saturday closed" :
      weekday === 0 && !rules.sunday ? "Sunday closed" : null);
    if (closed) skipped.push({ on: signBy, label: closed });
    else remaining -= 1;
  }
  return { ...reference, days: rules.signingDays, signBy, skipped };
}

const cursor = z.object({ signBy: z.iso.date(), loanId: z.string().min(1).max(100) });
export const disclosureCalendarInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read") }),
  z.object({ type: z.literal("preview"), version, rules: disclosureCalendarRules, anchorOn: supportedDate, after: cursor.optional() }),
  z.object({ type: z.literal("publish"), version, rules: disclosureCalendarRules, note: z.string().trim().min(1).max(300) }),
]);
export type DisclosureCalendarInput = z.infer<typeof disclosureCalendarInput>;
export type DisclosureCalendarVersion = {
  version: number; rules: DisclosureCalendarRules; publishedAt: string | null; publishedBy: string | null; note: string;
};
export type DisclosureCalendarImpact = {
  loanId: string; borrower: string; version: number; state: "Draft" | "Issued";
  from: string; to: string; calendarVersion: number;
};
export type DisclosureCalendarPreview = {
  kind: "preview"; before: DisclosureDeadline; after: DisclosureDeadline; checked: number;
  affected: DisclosureCalendarImpact[]; next: z.infer<typeof cursor> | null;
};
export type DisclosureCalendarResult = { kind: "settings"; current: DisclosureCalendarVersion; history: DisclosureCalendarVersion[] } |
  DisclosureCalendarPreview | { error: string };

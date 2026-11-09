import { z } from "zod";
import { easternDayStart } from "./client-retention";
import { conversationOwners } from "./conversation-model";
import { shiftReportDate } from "./report-date-range";

export const appointmentsUnavailable = "These appointments are unavailable on this loan.";
export const appointmentTarget = (id: string) => `loan-appointment-${id}`;
export const appointmentTargetPrefix = appointmentTarget("");
const loanId = z.string().min(1).max(100);
const localStart = z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/).refine((value) => {
  const date = value.slice(0, 10);
  return date >= "1900-01-01" && date <= "9998-12-31" && z.iso.date().safeParse(date).success;
});
export const appointmentInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), loanId, focusId: z.uuid().optional() }),
  z.object({ type: z.literal("save"), loanId, id: z.uuid(), revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(100), localStart, durationMinutes: z.number().int().min(5).max(480), ownerRole: z.enum(conversationOwners) }),
  z.object({ type: z.literal("cancel"), loanId, id: z.uuid(), revision: z.number().int().positive() }),
]);

export type AppointmentInput = z.infer<typeof appointmentInput>;
export type Appointment = Pick<Extract<AppointmentInput, { type: "save" }>, "id" | "title" | "durationMinutes" | "ownerRole" | "revision"> & {
  startsAt: string; cancelledAt: string | null;
};
export type AppointmentPage = {
  items: Appointment[]; hasMore: boolean; checkedAt: string; canSchedule: boolean;
  owners: { role: Appointment["ownerRole"]; name: string }[]; message?: string;
};

const easternClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function appointmentLocalTime(instant: string) {
  const fields = Object.fromEntries(easternClock.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

export function appointmentInstant(local: string) {
  const date = local.slice(0, 10);
  // The two midnights can have different offsets on an Eastern clock-change day.
  const offsets = new Set([date, shiftReportDate(date, 1)].map((day) => Date.parse(easternDayStart(day)) - Date.parse(day)));
  const matches = [...offsets].map((offset) => new Date(Date.parse(`${local}:00Z`) + offset).toISOString())
    .filter((instant) => appointmentLocalTime(instant) === local);
  return matches.length === 1 ? matches[0] : null;
}

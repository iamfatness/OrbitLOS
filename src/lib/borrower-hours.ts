import { z } from "zod";

const minute = 60_000;
const day = 86_400_000;
const localTime = z.iso.time({ precision: -1 });
const windowFields = { start: localTime, end: localTime };
const ordered = ({ start, end }: { start: string; end: string }) => start < end;
const contactWindow = z.strictObject(windowFields).refine(ordered, "The end time must be later than the start time.");

export const borrowerHoursInput = z.strictObject({
  ...windowFields,
  weekend: contactWindow.optional(),
  timeZone: z.string().max(64).regex(/^(?:UTC|[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/).refine((timeZone) => {
    try { new Intl.DateTimeFormat("en", { timeZone }); return true; }
    catch { return false; }
  }),
}).refine(ordered, "The end time must be later than the start time.");

export type BorrowerHours = z.infer<typeof borrowerHoursInput>;

export function borrowerWeekendHours({ start, end, weekend }: BorrowerHours) {
  return weekend ?? { start, end };
}

export function sameBorrowerHours(a: BorrowerHours | null, b: BorrowerHours | null) {
  if (!a || !b) return a === b;
  const aWeekend = borrowerWeekendHours(a);
  const bWeekend = borrowerWeekendHours(b);
  return a.start === b.start && a.end === b.end && a.timeZone === b.timeZone &&
    aWeekend.start === bWeekend.start && aWeekend.end === bWeekend.end;
}

function clockMinutes(clock: string) {
  const [hour, minutes] = clock.split(":").map(Number);
  return hour * 60 + minutes;
}

function boundsOnLocalDate(date: number, hours: BorrowerHours) {
  const weekday = new Date(date).getUTCDay();
  const window = weekday === 0 || weekday === 6 ? borrowerWeekendHours(hours) : hours;
  return { opening: date + clockMinutes(window.start) * minute, closing: date + clockMinutes(window.end) * minute };
}

// Treat the local calendar as a UTC clock while locating actual instants in the selected zone.
function wallClock(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en", { timeZone, calendar: "iso8601", numberingSystem: "latn",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  return (at: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(at).map(({ type, value }) => [type, Number(value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  };
}

export function nextBorrowerContactTime(at: string, hours: BorrowerHours | null | undefined): string {
  if (!hours) return at;
  const instant = Date.parse(at);
  const wall = wallClock(hours.timeZone);
  const local = wall(instant);
  const localDay = Math.floor(local / day) * day;
  const today = boundsOnLocalDate(localDay, hours);
  if (local >= today.opening && local < today.closing) return at;

  const offset = (time: number) => wall(time) - time;
  for (let date = localDay; date <= localDay + 3 * day; date += day) {
    const { opening, closing } = boundsOnLocalDate(date, hours);
    let before = opening - 2 * day;
    let after = opening + 2 * day;
    const oldOffset = offset(before);
    const newOffset = offset(after);
    const candidates = [opening - oldOffset];
    if (oldOffset !== newOffset) {
      candidates.push(opening - newOffset);
      // Both copies of a repeated time can be valid. For a skipped time, the offset
      // change itself can be the first allowed minute if it lands inside the window.
      while (after - before > minute) {
        const middle = Math.floor((before + after) / (2 * minute)) * minute;
        if (offset(middle) === oldOffset) before = middle;
        else after = middle;
      }
      candidates.push(after);
    }
    const next = candidates.sort((a, b) => a - b).find((candidate) => {
      if (candidate < instant) return false;
      const localCandidate = wall(candidate);
      return localCandidate >= opening && localCandidate < closing;
    });
    if (next !== undefined) return new Date(next).toISOString();
  }
  throw new Error("No preferred contact window found.");
}

export function scheduledBorrowerContactTime(dueAt: string, now: string, hours: BorrowerHours | null | undefined) {
  return hours ? nextBorrowerContactTime(dueAt < now ? now : dueAt, hours) : dueAt;
}

export function borrowerHoursLabel(hours: BorrowerHours) {
  const weekday = `${hours.start}–${hours.end}`;
  const weekend = borrowerWeekendHours(hours);
  const weekendLabel = `${weekend.start}–${weekend.end}`;
  const schedule = weekday === weekendLabel ? weekday : `Weekdays ${weekday} · Weekends ${weekendLabel}`;
  return `${schedule} (${hours.timeZone.replaceAll("_", " ")})`;
}

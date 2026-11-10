import { z } from "zod";

const minute = 60_000;
const day = 86_400_000;
const localTime = z.iso.time({ precision: -1 });

export const borrowerHoursInput = z.strictObject({
  start: localTime,
  end: localTime,
  timeZone: z.string().max(64).regex(/^(?:UTC|[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/).refine((timeZone) => {
    try { new Intl.DateTimeFormat("en", { timeZone }); return true; }
    catch { return false; }
  }),
}).refine(({ start, end }) => start < end, "The end time must be later than the start time.");

export type BorrowerHours = z.infer<typeof borrowerHoursInput>;

export function sameBorrowerHours(a: BorrowerHours | null, b: BorrowerHours | null) {
  return a?.start === b?.start && a?.end === b?.end && a?.timeZone === b?.timeZone;
}

function clockMinutes(clock: string) {
  const [hour, minutes] = clock.split(":").map(Number);
  return hour * 60 + minutes;
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
  const start = clockMinutes(hours.start) * minute;
  const end = clockMinutes(hours.end) * minute;
  if (local >= localDay + start && local < localDay + end) return at;

  const offset = (time: number) => wall(time) - time;
  for (let date = localDay; date <= localDay + 3 * day; date += day) {
    const opening = date + start;
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
      return localCandidate >= opening && localCandidate < date + end;
    });
    if (next !== undefined) return new Date(next).toISOString();
  }
  throw new Error("No preferred contact window found.");
}

export function scheduledBorrowerContactTime(dueAt: string, now: string, hours: BorrowerHours | null | undefined) {
  return hours ? nextBorrowerContactTime(dueAt < now ? now : dueAt, hours) : dueAt;
}

export function borrowerHoursLabel(hours: BorrowerHours) {
  return `${hours.start}–${hours.end} (${hours.timeZone.replaceAll("_", " ")})`;
}

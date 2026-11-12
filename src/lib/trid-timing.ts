import { shiftReportDate } from "./report-date-range";
import { tridElements, type TridEntry, type TridEvent } from "./trid-model";

const weekday = (date: string) => new Date(date).getUTCDay();
type Scope = Extract<TridEvent, { type: "scope" }>;
type Sent = Extract<TridEvent, { type: "sent" }>;
export function tridLocalDate(now: string, zone: Scope["zone"]) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export function preciseBusinessDay(date: string) {
  const monthDay = date.slice(5);
  if (weekday(date) === 0 || ["01-01", "06-19", "07-04", "11-11", "12-25"].includes(monthDay)) return false;
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (weekday(date) === 1 && (
    ([1, 2].includes(month) && day >= 15 && day <= 21) ||
    (month === 5 && day >= 25) || (month === 9 && day <= 7) ||
    (month === 10 && day >= 8 && day <= 14)
  )) return false;
  return !(month === 11 && weekday(date) === 4 && day >= 22 && day <= 28);
}

function after(start: string, count: number, isBusinessDay: (date: string) => boolean, through?: string) {
  let date = start;
  for (let days = 0; days < 60; days++) {
    date = shiftReportDate(date, 1);
    if (through && date > through) return null;
    if (isBusinessDay(date) && --count === 0) return date;
  }
  return null;
}

export function activeTridEntries(entries: TridEntry[]) {
  const voided = new Set(entries.flatMap(({ event }) => event.type === "void" ? [event.sequence] : []));
  return entries.filter(({ sequence, event }) => event.type !== "void" && !voided.has(sequence));
}

export function tridTiming(entries: TridEntry[], now: string) {
  const events = activeTridEntries(entries).map(({ event }) => event);
  const scope = events.findLast(event => event.type === "scope");
  const elementEvents = events.filter(event => event.type === "element");
  const dates = Object.keys(tridElements).map(key => elementEvents.find(event => event.element === key)?.on);
  const applicationOn = dates.every(Boolean) ? dates.sort().at(-1) ?? null : null;
  const le = events.find(event => event.type === "sent" && event.document === "Initial LE") as Sent | undefined;
  const cd = events.find(event => event.type === "sent" && event.document === "Initial CD") as Sent | undefined;
  const closingOn = events.findLast(event => event.type === "closing")?.on ?? null;
  const today = tridLocalDate(now, scope?.zone ?? "America/Detroit");
  const leDue = scope && applicationOn && applicationOn >= scope.calendarFrom
    ? after(applicationOn, 3, day => !scope.closures.includes(day) &&
      (scope.extraOpen.includes(day) || scope.openWeekdays.includes(weekday(day))), scope.calendarThrough)
    : null;
  const leStatus = !scope || !applicationOn || !leDue ? "Needs scope, application or office calendar evidence"
    : le && le.sender !== scope.leSender ? "Review sender responsibility"
    : le && le.on < applicationOn ? "Review delivery before recorded application"
    : le ? (le.on <= leDue ? "Within send deadline" : "Past send deadline")
    : today > leDue ? "Overdue without send evidence" : "Awaiting send evidence";
  const leEarliest = le && applicationOn && le.on >= applicationOn && scope?.leSender === le.sender
    ? after(le.on, 7, preciseBusinessDay) : null;
  const receipts = events.filter(event => event.type === "received");
  const actualReceipt = cd && receipts.find(event => event.document === cd.document && event.version === cd.version)?.on;
  const presumedReceipt = cd?.method === "Mail" ? after(cd.on, 3, preciseBusinessDay) : null;
  const cdReceipt = actualReceipt ?? presumedReceipt;
  const cdEarliest = cdReceipt ? after(cdReceipt, 3, preciseBusinessDay) : null;
  const correctedCd = events.some(event => event.type === "sent" && event.document === "Corrected CD");
  const wait = (earliest: string | null) => earliest && closingOn
    ? (closingOn >= earliest ? "Scheduled date meets interval" : "Scheduled date falls short") : "Needs delivery or closing evidence";
  return { scope, applicationOn, leDue, leStatus, leEarliest, closingOn, leWait: wait(leEarliest),
    cdReceipt, cdReceiptBasis: actualReceipt ? "Recorded receipt" : presumedReceipt ? "Presumed mail receipt" : "Missing receipt",
    cdEarliest: correctedCd || !scope ? null : cdEarliest,
    cdWait: correctedCd ? "Review corrected CD and whether the waiting period restarts" : !scope ? "Needs scope evidence" : wait(cdEarliest) };
}

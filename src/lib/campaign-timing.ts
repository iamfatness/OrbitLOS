import { easternDate, easternDayStart } from "./client-retention";

export function campaignWeekdayAt(now: string, weekdays: number, time: string) {
  const due = new Date(`${easternDate(new Date(now))}T00:00:00.000Z`);
  while (weekdays > 0) {
    due.setUTCDate(due.getUTCDate() + 1);
    if (due.getUTCDay() !== 0 && due.getUTCDay() !== 6) weekdays--;
  }
  const [hour, minute] = time.split(":").map(Number);
  const midnight = Date.parse(easternDayStart(due.toISOString().slice(0, 10)));
  return new Date(midnight + (hour * 60 + minute) * 60_000).toISOString();
}

type DatedEvidence = { on: string; localTime?: string };
export function compareEvidence(first: DatedEvidence, second: DatedEvidence) {
  if (first.on !== second.on) return first.on < second.on ? "after" : "before";
  if (!first.localTime || !second.localTime || first.localTime === second.localTime) return "unclear";
  // In Michigan, the first Sunday in November repeats the hour after 01:00.
  const month = first.on.slice(5, 7);
  const day = Number(first.on.slice(8));
  const sunday = new Date(first.on).getUTCDay() === 0;
  const repeatedHour = sunday && month === "11" && day <= 7 &&
    first.localTime.startsWith("01:") && second.localTime.startsWith("01:");
  const missingHour = sunday && month === "03" && day >= 8 && day <= 14 &&
    (first.localTime.startsWith("02:") || second.localTime.startsWith("02:"));
  return repeatedHour || missingHour ? "unclear" : first.localTime < second.localTime ? "after" : "before";
}

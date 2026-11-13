type Evidence = { on: string; time?: string };

function clockChange({ on, time }: Evidence) {
  if (!time || new Date(on).getUTCDay() !== 0) return;
  const month = on.slice(5, 7);
  const day = Number(on.slice(8));
  // The Central, Mountain and Indiana Eastern zones used by these pilots observe these local changes.
  if (month === "03" && day >= 8 && day <= 14 && time.startsWith("02:")) return "Skipped";
  if (month === "11" && day <= 7 && time.startsWith("01:")) return "Repeated";
}

export function compareLocalEvidenceOrder(event: Evidence | undefined, baseline: Evidence | undefined) {
  if (!event || !baseline) return "Evidence missing";
  const eventClock = clockChange(event);
  const baselineClock = clockChange(baseline);
  if (eventClock === "Skipped" || baselineClock === "Skipped") return "Skipped local hour, order unresolved";
  if (event.on !== baseline.on) return event.on < baseline.on ? "Before" : "After";
  if (!event.time || !baseline.time) return "Same date, order unresolved";
  if (eventClock === "Repeated" && baselineClock === "Repeated") return "Repeated local hour, order unresolved";
  if (event.time === baseline.time) return "Same recorded minute";
  return event.time < baseline.time ? "Before" : "After";
}

import { easternDate } from "./client-retention";

const dayMs = 86_400_000;
export type ReportDateRange = { from: string; through: string };

export function validReportRange({ from, through }: ReportDateRange) {
  return from >= "1900-01-01" && from <= through && Date.parse(through) - Date.parse(from) < 366 * dayMs;
}

export function shiftReportDate(date: string, days: number) {
  return new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
}

export function reportMonthDates(month: string): ReportDateRange {
  const [year, monthNumber] = month.split("-").map(Number);
  return { from: `${month}-01`, through: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10) };
}

export function currentReportMonth(now = new Date()): ReportDateRange {
  return reportMonthDates(easternDate(now).slice(0, 7));
}

export function priorReportPeriod({ from, through }: ReportDateRange): ReportDateRange {
  const days = (Date.parse(through) - Date.parse(from)) / dayMs + 1;
  return { from: shiftReportDate(from, -days), through: shiftReportDate(from, -1) };
}

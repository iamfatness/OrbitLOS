import type { SqlValue, Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import { fundingDashboardQuery, fundingDashboardUnavailable, fundingRecordRequest, fundingViewFilters, priorFundingPeriod, targetMonth,
  type FundingCursor, type FundingDashboardData, type FundingLoan, type FundingLoanDetail, type FundingMetric, type FundingTarget, type FundingTotals } from "./funding-dashboard-model";
import { accessEvent } from "./workspace-access";
import { changeDashboardView, readDashboardViews } from "./dashboard-views";
import type { ReportDateRange } from "./report-date-range";

const pageSize = 30;
const sources = {
  projected: { table: "closing_plans", date: "targetDate", eligible: `AND loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')
    AND NOT EXISTS (SELECT 1 FROM closing_progress funded WHERE funded.loanId = loan.id AND funded.fundingDate IS NOT NULL)` },
  actual: { table: "closing_progress", date: "fundingDate", eligible: "" },
} as const;

function fundingCohort(kind: FundingMetric, range: ReportDateRange, owner: string, localName?: string) {
  const legacyName = owner.startsWith("email:") ? localName : undefined;
  const ownerFilter = owner.startsWith("email:") ? (legacyName ?
    "AND (loan.officerEmail = ? OR (loan.officerEmail IS NULL AND loan.officer = ?))" : "AND loan.officerEmail = ?") :
    owner.startsWith("name:") ? "AND loan.officerEmail IS NULL AND loan.officer = ?" : "";
  const { table, date, eligible } = sources[kind];
  return { date: `entry.${date}`, from: `FROM ${table} entry JOIN loans loan ON loan.id = entry.loanId`,
    where: `WHERE entry.${date} BETWEEN ? AND ? ${eligible} ${ownerFilter}`,
    params: [range.from, range.through, ...(ownerFilter ? [owner.slice(owner.indexOf(":") + 1)] : []), ...(legacyName ? [legacyName] : [])] };
}

export function fundingTotals(db: Store, metric: FundingMetric, range: ReportDateRange, owner: string, localName?: string): FundingTotals {
  const query = fundingCohort(metric, range, owner, localName);
  const row = db.prepare(`SELECT count(*) AS count, coalesce(sum(loan.amount), 0) AS volume ${query.from} ${query.where}`).get(...query.params);
  return { count: Number(row?.count ?? 0), volume: Number(row?.volume ?? 0) };
}

export function fundingLoanPage(db: Store, metric: FundingMetric, range: ReportDateRange, owner: string, after?: FundingCursor, localName?: string) {
  const query = fundingCohort(metric, range, owner, localName);
  const cursor = after ? `AND (${query.date}, entry.loanId) < (?, ?)` : "";
  const args: SqlValue[] = [...query.params, ...(after ? [after.date, after.id] : []), pageSize + 1];
  const rows = db.prepare(`SELECT entry.loanId AS id, ${query.date} AS date, contact.name, loan.officer, loan.stage, loan.amount
    ${query.from} JOIN contacts contact ON contact.id = loan.contactId ${query.where} ${cursor}
    ORDER BY ${query.date} DESC, entry.loanId DESC LIMIT ?`).all(...args) as unknown as FundingLoan[];
  const loans = rows.slice(0, pageSize).map((loan) => ({ ...loan }));
  const last = loans.at(-1);
  return { loans, next: rows.length > pageSize && last ? { date: last.date, id: last.id } : null };
}

export function readFundingDashboard(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string): FundingDashboardData | { error: string } {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.id !== brokerageId) return { error: fundingDashboardUnavailable };
  const parsed = fundingDashboardQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose valid dashboard filters and a date range of up to 366 days." };
  const { from, through, owner, metric, period, after } = parsed.data;
  const selected = { from, through };
  const previous = priorFundingPeriod(selected);
  const summarize = (range: ReportDateRange) => ({ ...range, projected: fundingTotals(db, "projected", range, owner), actual: fundingTotals(db, "actual", range, owner) });
  const views = readDashboardViews(db, "Funding", fundingViewFilters);
  const month = targetMonth(parsed.data);
  const target = month && db.prepare("SELECT month, loanCount AS count, volume, revision FROM funding_monthly_targets WHERE month = ?").get(month);
  return { checkedAt: new Date().toISOString(), periods: { selected: summarize(selected), previous: summarize(previous) },
    ...fundingLoanPage(db, metric, period === "selected" ? selected : previous, owner, after), views,
    target: target ? { ...target } as FundingTarget : null };
}

export function fundingRecordAction(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string):
  { loan: FundingLoanDetail } | { message: string } | { error: string } {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.id !== brokerageId) return { error: fundingDashboardUnavailable };
  const parsed = fundingRecordRequest.safeParse(input);
  if (!parsed.success) return { error: "Check the funding dashboard form and try again." };
  const data = parsed.data;
  if (data.type === "loan") {
    const loan = db.prepare(`SELECT loan.id, contact.name, loan.officer, loan.stage, loan.amount, loan.address, plan.targetDate,
      profile.closingDate, progress.fundingDate, progress.disclosureStatus,
      (SELECT count(*) FROM closing_items WHERE loanId = loan.id AND completedAt IS NULL) AS outstanding
      FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
      LEFT JOIN closing_plans plan ON plan.loanId = loan.id LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id
      LEFT JOIN closing_progress progress ON progress.loanId = loan.id WHERE loan.id = ?`).get(data.id);
    return loan ? { loan: { ...loan } as FundingLoanDetail } : { error: "This loan is unavailable." };
  }

  const now = new Date().toISOString();
  return db.transaction(() => {
    if (data.type !== "saveTarget") return changeDashboardView(db, staff, "Funding", data, now);
    const existing = db.prepare("SELECT loanCount, volume, revision FROM funding_monthly_targets WHERE month = ?").get(data.month);
    if (existing?.loanCount === data.count && existing.volume === data.volume) return { message: "Production target saved." };
    if ((existing?.revision ?? 0) !== data.revision) return { error: "This production target changed. Refresh funding before saving." };
    db.prepare(`INSERT INTO funding_monthly_targets (month, loanCount, volume, revision) VALUES (?, ?, ?, ?)
      ON CONFLICT(month) DO UPDATE SET loanCount = excluded.loanCount, volume = excluded.volume, revision = excluded.revision`)
      .run(data.month, data.count, data.volume, data.revision + 1);
    accessEvent(db, staff, "Saved monthly production target", data.month, now);
    return { message: "Production target saved." };
  });
}

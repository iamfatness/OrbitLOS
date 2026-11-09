import { easternDate, easternDayStart, rateFollowUpContext } from "./client-retention";
import { fundingLoanPage, fundingTotals } from "./funding-dashboard";
import { brokerageStalledUnavailable, officerDashboardRequest, officerDashboardUnavailable, type OfficerDashboardResult, type RetentionCursor, type RetentionOpportunity } from "./officer-dashboard-model";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { reportMonthDates, shiftReportDate } from "./report-date-range";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";
import { stalledLoanPage } from "./officer-stalled";

const opportunityPageSize = 6;
const opportunityScanSize = 30;
type OpportunityRow = RetentionCursor & {
  loanId: string; name: string; email: string; phone: string; contactId: string;
  closingDate: string | null; watchEnabled: number; currentRate: number | null; targetRate: number | null;
  observedRate: number | null; checkedAt: string | null;
};

function opportunities(db: Store, email: string, today: string, now: Date, after?: RetentionCursor, localName?: string): OfficerDashboardResult {
  const rows = db.prepare(`SELECT task.id, task.dueAt, loan.id AS loanId, contact.name, contact.email, contact.phone, contact.id AS contactId,
      profile.closingDate, profile.watchEnabled, profile.currentRate, profile.targetRate, profile.observedRate, profile.checkedAt
    FROM loans loan JOIN tasks task ON task.loanId = loan.id JOIN contacts contact ON contact.id = loan.contactId
    JOIN past_client_profiles profile ON profile.loanId = loan.id
    WHERE ${localName ? "(loan.officerEmail = ? OR (loan.officerEmail IS NULL AND loan.officer = ?))" : "loan.officerEmail = ?"}
      AND loan.disposition = 'Active' AND loan.stage IN ('Funded', 'Closed') AND task.completedAt IS NULL
      AND (task.id GLOB 'rate-watch:*' OR task.id GLOB 'closing-anniversary:*') AND task.dueAt < ?
      AND ((task.id GLOB 'rate-watch:*' AND profile.watchEnabled = 1 AND profile.observedRate <= profile.targetRate)
        OR (task.id GLOB 'closing-anniversary:*' AND profile.closingDate IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM tasks earlier WHERE earlier.loanId = loan.id AND earlier.completedAt IS NULL
          AND earlier.id GLOB 'closing-anniversary:*' AND (earlier.dueAt, earlier.id) < (task.dueAt, task.id))))
      ${after ? "AND (task.dueAt, task.id) > (?, ?)" : ""} ORDER BY task.dueAt, task.id LIMIT ?`)
    .all(email, ...(localName ? [localName] : []), easternDayStart(shiftReportDate(today, 31)),
      ...(after ? [after.dueAt, after.id] : []), opportunityScanSize + 1) as unknown as OpportunityRow[];
  const candidates = rows.slice(0, opportunityScanSize);
  const suppression = blockedOutreachKeys(db, candidates);
  const items: RetentionOpportunity[] = [];
  let consumed = 0;
  for (const row of candidates) {
    consumed++;
    if (outreachSuppressed(suppression, row)) continue;
    const { id, dueAt, loanId, name, closingDate, checkedAt } = row;
    if (id.startsWith("rate-watch:")) {
      const context = rateFollowUpContext({ ...row, watchEnabled: Boolean(row.watchEnabled) });
      if (context) items.push({ id, dueAt, loanId, name, kind: "Rate target met", context, checkedAt });
    } else if (closingDate) items.push({ id, dueAt, loanId, name, kind: "Closing anniversary", closingDate });
    if (items.length === opportunityPageSize) break;
  }
  const last = rows[consumed - 1];
  return { kind: "opportunities", checkedAt: now.toISOString(), items,
    next: last && consumed < rows.length ? { id: last.id, dueAt: last.dueAt } : null };
}

export function officerDashboardWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date(), localName?: string): OfficerDashboardResult {
  if (!staff || staff.brokerage.id !== brokerageId || (staff.brokerage.role !== "LO" && staff.brokerage.role !== "Admin")) {
    return { error: officerDashboardUnavailable };
  }
  const parsed = officerDashboardRequest.safeParse(input);
  if (!parsed.success) return { error: "Check the personal dashboard form and try again." };
  const data = parsed.data;
  const today = easternDate(now);
  const month = today.slice(0, 7);
  const owner = `email:${staff.email}`;
  const target = () => {
    const row = db.prepare("SELECT month, loanCount AS count, volume, revision FROM officer_monthly_targets WHERE officerEmail = ? AND month = ?")
      .get(staff.email, month);
    return row ? { month, count: Number(row.count), volume: Number(row.volume), revision: Number(row.revision) } : null;
  };
  switch (data.type) {
    case "production": {
      const previous = shiftReportDate(`${month}-01`, -1).slice(0, 7);
      const totals = (period: string) => ({ month: period, ...fundingTotals(db, "actual", reportMonthDates(period), owner, localName) });
      return { kind: "production", checkedAt: now.toISOString(), current: totals(month), previous: totals(previous), target: target() };
    }
    case "fundedLoans":
      if (data.month > month) return { error: "Choose a completed or current funding month." };
      return { kind: "fundedLoans", ...fundingLoanPage(db, "actual", reportMonthDates(data.month), owner, data.after, localName) };
    case "opportunities":
      return opportunities(db, staff.email, today, now, data.after, localName);
    case "stalledLoans":
      return stalledLoanPage(db, staff, data, now, localName);
    case "brokerageStalledLoans":
      return staff.brokerage.role === "Admin" ? stalledLoanPage(db, staff, data, now) : { error: brokerageStalledUnavailable };
    case "saveTarget":
      if (data.month !== month) return { error: "The production month changed. Refresh Today before saving." };
      return db.transaction(() => {
        const current = target();
        const message = "Personal production targets saved.";
        if (current?.count === data.count && current.volume === data.volume) return { kind: "saved", target: current, message };
        if ((current?.revision ?? 0) !== data.revision) return { error: "Your production targets changed. Refresh Today before saving." };
        const updated = { month, count: data.count, volume: data.volume, revision: data.revision + 1 };
        db.prepare(`INSERT INTO officer_monthly_targets (officerEmail, month, loanCount, volume, revision) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(officerEmail, month) DO UPDATE SET loanCount = excluded.loanCount, volume = excluded.volume, revision = excluded.revision`)
          .run(staff.email, month, updated.count, updated.volume, updated.revision);
        accessEvent(db, staff, "Saved personal production targets", month, now.toISOString());
        return { kind: "saved", target: updated, message };
      });
  }
}

import type { StaffIdentity } from "./staff-store";
import type { Store, SqlValue } from "./store";
import type { CallReportFacts } from "./call-report-model";

export interface LoanAuditChange {
  field: string;
  before: SqlValue;
  after: SqlValue;
}
export interface LoanAuditEvent {
  id: string;
  loanId: string;
  actor: string;
  action: string;
  occurredAt: string;
  changes: LoanAuditChange[];
}

export function loanAuditSnapshot(db: Store, loanId: string) {
  const row = db.prepare(`SELECT loan.officerEmail, loan.officer, loan.amount, loan.stage, loan.purpose, loan.disposition, loan.leadSource, realtor.name AS realtorName,
    plan.targetDate, client.closingDate, closing.fundingDate, closing.disclosureStatus, closing.disclosureDate,
    processing.processorEmail, processing.status AS processingStatus, app.submittedAt, app.reviewedAt, prep.facts
    FROM loans loan
    LEFT JOIN contacts realtor ON realtor.id = loan.partnerId
    LEFT JOIN closing_plans plan ON plan.loanId = loan.id
    LEFT JOIN past_client_profiles client ON client.loanId = loan.id
    LEFT JOIN closing_progress closing ON closing.loanId = loan.id
    LEFT JOIN loan_processing processing ON processing.loanId = loan.id
    LEFT JOIN applications app ON app.loanId = loan.id
    LEFT JOIN call_report_facts prep ON prep.loanId = loan.id
    WHERE loan.id = ?`).get(loanId);
  if (!row) return null;
  const facts = row.facts ? JSON.parse(String(row.facts)) as CallReportFacts : undefined;
  return {
    "Owner": row.officerEmail ?? (row.officer || null), "Processor": row.processorEmail, "Processing handoff": row.processingStatus,
    "Loan amount": row.amount, "Pipeline stage": row.stage, "Purpose": row.purpose, "Loan status": row.disposition,
    "Lead source": row.leadSource, "Realtor partner": row.realtorName, "Target closing": row.targetDate, "Actual closing": row.closingDate,
    "Funding date": row.fundingDate, "Disclosure status": row.disclosureStatus, "Disclosure date": row.disclosureDate,
    "1003 submitted": row.submittedAt, "1003 reviewed": row.reviewedAt,
    "Reporting eligibility": facts?.eligibility ?? null, "Reporting exclusion": facts?.exclusionReason || null, "Reporting state": facts?.state || null,
    "Reporting originator ID": facts?.originator || null, "Reporting received date": facts?.receivedDate || null,
    "Reporting received amount": facts?.receivedAmount ?? null, "Reporting outcome": facts?.outcome || null,
    "Reporting outcome date": facts?.outcomeDate || null, "Reporting outcome amount": facts?.outcomeAmount ?? null,
  } satisfies Record<string, SqlValue>;
}

export function recordLoanAudit(db: Store, loanId: string, actor: StaffIdentity | "Borrower" | null, action: string,
  occurredAt: string, before: ReturnType<typeof loanAuditSnapshot>) {
  const after = loanAuditSnapshot(db, loanId);
  if (!after) return;
  const changes = Object.entries(after).flatMap(([field, value]) => {
    const previous = before?.[field as keyof typeof before] ?? null;
    return previous === value ? [] : [{ field, before: previous, after: value }];
  });
  if (changes.length) addLoanAuditEntry(db, loanId, actor, action, occurredAt, changes);
}

export function addLoanAuditEntry(db: Store, loanId: string, actor: StaffIdentity | "Borrower" | null, action: string,
  occurredAt: string, changes: LoanAuditChange[]) {
  db.prepare("INSERT INTO loan_audit (id, loanId, actor, action, occurredAt, changes) VALUES (?, ?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), loanId, typeof actor === "string" ? actor : actor?.email ?? "Demo workspace", action, occurredAt, JSON.stringify(changes));
}

export function loanAuditHistory(db: Store, loanId: string): LoanAuditEvent[] {
  return db.prepare("SELECT id, loanId, actor, action, occurredAt, changes FROM loan_audit WHERE loanId = ? ORDER BY occurredAt DESC, rowid DESC LIMIT 100")
    .all(loanId)
    .map((row) => ({ id: String(row.id), loanId: String(row.loanId), actor: String(row.actor),
      action: String(row.action), occurredAt: String(row.occurredAt), changes: JSON.parse(String(row.changes)) }));
}

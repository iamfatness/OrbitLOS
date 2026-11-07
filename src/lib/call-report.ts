import type { Store } from "./store";
import { applicationDay, emptyCallReportFacts, type CallReportFacts, type CallReportFile } from "./call-report-model";

export function callReportFiles(db: Store): CallReportFile[] {
  return db.prepare(`SELECT loan.id, loan.stage, loan.disposition, loan.amount, prep.facts, prep.revision, progress.fundingDate,
    coalesce(first.submittedAt, app.submittedAt) AS submittedAt,
    json_extract(coalesce(first.draft, CASE WHEN app.submittedAt IS NOT NULL THEN app.draft END), '$.propertyLocation.state') AS propertyState,
    json_extract(coalesce(first.draft, CASE WHEN app.submittedAt IS NOT NULL THEN app.draft END), '$.loanAmount') AS applicationAmount
    FROM loans loan LEFT JOIN call_report_facts prep ON prep.loanId = loan.id
    LEFT JOIN closing_progress progress ON progress.loanId = loan.id
    LEFT JOIN applications app ON app.loanId = loan.id
    LEFT JOIN application_versions first ON first.loanId = loan.id AND first.revision =
      (SELECT min(revision) FROM application_versions WHERE loanId = loan.id)
    ORDER BY loan.id`).all().map((row) => {
    const amount = Number(row.applicationAmount);
    return {
      loanId: String(row.id), stage: String(row.stage), disposition: String(row.disposition),
      facts: row.facts ? JSON.parse(String(row.facts)) as CallReportFacts : emptyCallReportFacts,
      revision: Number(row.revision ?? 0),
      suggested: {
        state: String(row.propertyState ?? ""),
        receivedDate: applicationDay(row.submittedAt as string | null),
        receivedAmount: amount > 0 ? Math.round(amount) : null,
        fundingDate: String(row.fundingDate ?? ""), currentAmount: Number(row.amount),
      },
    };
  });
}

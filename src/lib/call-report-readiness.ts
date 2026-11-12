import { callReportActivity, callReportCsv, callReportIssues, quarterlyCallReport, quarterRange, type CallReportRow } from "./call-report-model";
import { reportingReadinessInput, reportingReadinessUnavailable, type ReportingBlocker, type ReportingReadiness } from "./call-report-readiness-model";
import { callReportFiles } from "./call-report";
import { easternDate } from "./client-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";
import { initializeQuarterReviews, quarterReviewWork } from "./call-report-quarter";
import { fv7WorkpaperWork, initializeFv7Workpapers } from "./mcr-fv7-workpaper-store";

const pageSize = 20;
const indexBatch = 160;
const exportLimit = 1000;

export function initializeCallReportReadiness(db: Store) {
  initializeQuarterReviews(db);
  initializeFv7Workpapers(db);
  db.exec(`CREATE TABLE IF NOT EXISTS call_report_readiness (
    loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE, received TEXT NOT NULL, outcomeOn TEXT NOT NULL,
    sortOn TEXT NOT NULL, firstApplication TEXT NOT NULL, fundingDate TEXT NOT NULL, revision INTEGER NOT NULL, issues TEXT NOT NULL, issueCount INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS call_report_blockers_by_day ON call_report_readiness(sortOn, loanId) WHERE issueCount > 0;
  CREATE TABLE IF NOT EXISTS call_report_readiness_dirty (loanId TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS call_report_readiness_backfill (id INTEGER PRIMARY KEY CHECK(id = 1), afterId TEXT NOT NULL, complete INTEGER NOT NULL);
  INSERT OR IGNORE INTO call_report_readiness_backfill VALUES (1, '', 0);`);
  const sources = [
    { table: "loans", id: "id", fields: ["stage", "disposition"] },
    { table: "call_report_facts", id: "loanId", fields: ["facts", "revision"] },
    { table: "closing_progress", id: "loanId", fields: ["fundingDate"] },
    { table: "applications", id: "loanId", fields: ["submittedAt", "draft"] },
    { table: "application_versions", id: "loanId", fields: ["submittedAt", "draft", "revision"] },
  ];
  for (const { table, id, fields } of sources) {
    const mark = (row: string) => `INSERT INTO call_report_readiness_dirty SELECT ${row}.${id}
      WHERE NOT EXISTS (SELECT 1 FROM call_report_readiness_dirty WHERE loanId = ${row}.${id});`;
    db.exec(`CREATE TRIGGER IF NOT EXISTS reporting_${table}_insert AFTER INSERT ON ${table} BEGIN ${mark("NEW")} END;
      CREATE TRIGGER IF NOT EXISTS reporting_${table}_delete AFTER DELETE ON ${table} BEGIN ${mark("OLD")} END;
      CREATE TRIGGER IF NOT EXISTS reporting_${table}_update AFTER UPDATE OF ${fields.join(", ")} ON ${table}
      WHEN ${fields.map((field) => `OLD.${field} IS NOT NEW.${field}`).join(" OR ")} BEGIN ${mark("NEW")} END;`);
  }
}

function indexingPending(db: Store) {
  return !!db.prepare(`SELECT 1 FROM call_report_readiness_backfill WHERE complete = 0
    UNION ALL SELECT 1 FROM call_report_readiness_dirty LIMIT 1`).get();
}

function refreshCallReportReadiness(db: Store) {
  if (!indexingPending(db)) return false;
  return db.transaction(() => {
    const dirty = db.prepare("SELECT loanId AS id FROM call_report_readiness_dirty ORDER BY loanId LIMIT ?").all(indexBatch);
    const checkpoint = db.prepare("SELECT afterId FROM call_report_readiness_backfill WHERE id = 1 AND complete = 0").get();
    const historical = checkpoint ? db.prepare("SELECT id FROM loans WHERE id > ? ORDER BY id LIMIT ?").all(checkpoint.afterId, indexBatch) : [];
    const ids = [...new Set([...dirty, ...historical].map(({ id }) => String(id)))];
    if (ids.length) {
      const serialized = JSON.stringify(ids);
      db.prepare("DELETE FROM call_report_readiness WHERE loanId IN (SELECT value FROM json_each(?))").run(serialized);
      const insert = db.prepare(`INSERT INTO call_report_readiness (loanId, received, outcomeOn, sortOn, firstApplication, fundingDate, revision, issues, issueCount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const file of callReportFiles(db, ids)) {
        const { received, outcomeDate, candidate } = callReportActivity(file);
        if (!candidate) continue;
        const issues = callReportIssues(file);
        insert.run(file.loanId, received, outcomeDate, received || outcomeDate, file.suggested.receivedDate,
          file.suggested.fundingDate, file.revision, JSON.stringify(issues), issues.length);
      }
      db.prepare("DELETE FROM call_report_readiness_dirty WHERE loanId IN (SELECT value FROM json_each(?))").run(serialized);
    }
    if (checkpoint) db.prepare("UPDATE call_report_readiness_backfill SET afterId = ?, complete = ? WHERE id = 1")
      .run(historical.at(-1)?.id ?? checkpoint.afterId, Number(historical.length < indexBatch));
    return indexingPending(db);
  });
}

// Keep this date predicate aligned with the shared quarterly report membership rules.
const inQuarter = `(report.received BETWEEN ? AND ? OR report.outcomeOn BETWEEN ? AND ? OR report.fundingDate BETWEEN ? AND ? OR
  (report.received <= ? AND (report.outcomeOn = '' OR report.outcomeOn >= ?)))`;
const quarterRows = `FROM call_report_readiness report WHERE ${inQuarter}
  AND NOT EXISTS (SELECT 1 FROM call_report_readiness_dirty dirty WHERE dirty.loanId = report.loanId)`;

function checkedQuarterRows(db: Store, range: ReturnType<typeof quarterRange>, dates: string[], indexing: boolean): { rows: CallReportRow[] } | { error: string } {
  if (indexing || indexingPending(db)) return { error: "Reporting records are still being checked. Refresh readiness before exporting." };
  if (db.prepare(`SELECT 1 ${quarterRows} AND report.issueCount > 0 LIMIT 1`).get(...dates)) {
    return { error: "Resolve the quarter’s reporting exceptions before exporting the reconciled CSV." };
  }
  const ids = db.prepare(`SELECT report.loanId ${quarterRows} ORDER BY report.loanId LIMIT ?`).all(...dates, exportLimit + 1);
  if (ids.length > exportLimit) return { error: "The quarter exceeds the pilot limit of 1,000 report candidates." };
  const rows = quarterlyCallReport(callReportFiles(db, ids.map(({ loanId }) => String(loanId))), range);
  if (rows.some(({ issues }) => issues.length)) return { error: "The report changed. Refresh readiness before exporting." };
  return { rows };
}

export function reportingReadinessWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()): ReportingReadiness {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin") return { error: reportingReadinessUnavailable };
  const parsed = reportingReadinessInput.safeParse(input);
  const today = easternDate(now);
  if (!parsed.success || parsed.data.year > Number(today.slice(0, 4))) return { error: "Choose a valid reporting year and quarter." };
  const data = parsed.data;
  const range = quarterRange(data.year, data.quarter);
  const { from, through } = range;
  const dates = [from, through, from, through, from, through, through, from];
  if (data.type === "fv7Template" || data.type === "fv7Preview" || data.type === "fv7Save" ||
    data.type === "fv7History" || data.type === "fv7Read") {
    return fv7WorkpaperWork(db, data, staff, now.toISOString());
  }
  const indexing = data.type !== "downloadQuarterReview" && refreshCallReportReadiness(db);
  const checked = () => checkedQuarterRows(db, range, dates, indexing);
  if (data.type !== "list" && data.type !== "export") {
    return quarterReviewWork(db, data, staff, range, today, now.toISOString(), checked);
  }

  if (data.type === "export") return db.transaction(() => {
    const result = checked();
    if ("error" in result) return result;
    const { rows } = result;
    if (!rows.length) return { error: "There are no report records for this quarter." };
    accessEvent(db, staff, "Exported reconciled call report prep", `${data.year} Q${data.quarter} · ${rows.length} records`, now.toISOString());
    return { kind: "export", count: rows.length, csv: callReportCsv(rows, from, through) };
  });

  const blockers = Number(db.prepare(`SELECT count(*) AS count ${quarterRows} AND report.issueCount > 0`).get(...dates)?.count ?? 0);
  const rows = db.prepare(`SELECT report.loanId AS id, report.sortOn, borrower.name AS borrower, loan.officer,
    report.revision, report.firstApplication, report.fundingDate, report.issues
    FROM call_report_readiness report JOIN loans loan ON loan.id = report.loanId JOIN contacts borrower ON borrower.id = loan.contactId
    WHERE report.issueCount > 0 AND ${inQuarter}
      AND NOT EXISTS (SELECT 1 FROM call_report_readiness_dirty dirty WHERE dirty.loanId = report.loanId)
    ${data.after ? "AND (report.sortOn, report.loanId) > (?, ?)" : ""} ORDER BY report.sortOn, report.loanId LIMIT ?`)
    .all(...dates, ...(data.after ? [data.after.sortOn, data.after.id] : []), pageSize + 1) as unknown as (Omit<ReportingBlocker, "issues"> & { issues: string })[];
  const items = rows.slice(0, pageSize).map((row) => ({ ...row, issues: JSON.parse(row.issues) as string[] }));
  const last = items.at(-1);
  return { kind: "list", from, through, indexing, blockers, items, next: rows.length > pageSize && last ? { id: last.id, sortOn: last.sortOn } : null };
}

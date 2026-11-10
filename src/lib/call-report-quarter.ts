import { createHash } from "node:crypto";
import { callReportCsv, callReportCsvCell, type CallReportRow, type quarterRange } from "./call-report-model";
import { priorQuarter, quarterName, type CarryoverDifference, type CarryoverEntry, type CarryoverTotals, type Quarter,
  type QuarterReviewPage, type QuarterReviewSummary } from "./call-report-quarter-model";
import type { ReportingReadiness, ReportingReadinessInput } from "./call-report-readiness-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const differencePageSize = 20;
const historySize = 6;
type QuarterRequest = Extract<ReportingReadinessInput, { type: "quarterReview" | "saveQuarterReview" | "downloadQuarterReview" }>;
type ReadyRows = { rows: CallReportRow[] } | { error: string };
type Range = ReturnType<typeof quarterRange>;
type StoredReview = Omit<QuarterReviewSummary, "closed"> & { closed: number; evidenceKey: string };

export function initializeQuarterReviews(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS call_report_quarter_reviews (
    year INTEGER NOT NULL, quarter INTEGER NOT NULL, version INTEGER NOT NULL,
    evidenceKey TEXT NOT NULL, recordedAt TEXT NOT NULL, recordedBy TEXT NOT NULL, recordedByEmail TEXT NOT NULL,
    closed INTEGER NOT NULL, count INTEGER NOT NULL, changeCount INTEGER, priorVersion INTEGER,
    note TEXT NOT NULL, ending TEXT NOT NULL, csv TEXT NOT NULL, requestId TEXT NOT NULL UNIQUE,
    PRIMARY KEY (year, quarter, version)
  );`);
}

const summaryColumns = "version, recordedAt, recordedBy, count, changeCount, priorVersion, closed, evidenceKey";
function summary({ version, recordedAt, recordedBy, count, changeCount, priorVersion, closed }: StoredReview): QuarterReviewSummary {
  return { version, recordedAt, recordedBy, count, changeCount, priorVersion, closed: Boolean(closed) };
}

function carryover(rows: CallReportRow[], group: "Beginning pipeline" | "Ending pipeline"): CarryoverEntry[] {
  return rows.filter((row) => row.groups.includes(group)).map(({ file }) => ({
    loanId: file.loanId, state: file.facts.state, amount: file.facts.receivedAmount ?? 0,
  }));
}

function totals(rows: CarryoverEntry[]): CarryoverTotals {
  return { count: rows.length, amount: rows.reduce((total, row) => total + row.amount, 0) };
}

function compareOpening(previous: CarryoverEntry[] | null, opening: CarryoverEntry[]) {
  const previousByLoan = new Map(previous?.map((entry) => [entry.loanId, entry]));
  const openingByLoan = new Map(opening.map((entry) => [entry.loanId, entry]));
  const differences: CarryoverDifference[] = [];
  if (previous) {
    for (const loanId of new Set([...previousByLoan.keys(), ...openingByLoan.keys()])) {
      const before = previousByLoan.get(loanId) ?? null;
      const current = openingByLoan.get(loanId) ?? null;
      const reasons: CarryoverDifference["reasons"] = [];
      if (!before) reasons.push("Added to opening");
      else if (!current) reasons.push("Missing from opening");
      else {
        if (before.state !== current.state) reasons.push("State changed");
        if (before.amount !== current.amount) reasons.push("Amount changed");
      }
      if (reasons.length) differences.push({ loanId, before, current, reasons });
    }
  }
  const states = [...new Set([...(previous ?? []), ...opening].map(({ state }) => state))].sort().map((state) => ({
    state, previous: previous ? totals(previous.filter((item) => item.state === state)) : null,
    opening: totals(opening.filter((item) => item.state === state)),
  }));
  return {
    differences, states, opening: totals(opening), previousEnding: previous ? totals(previous) : null,
    changeCount: previous ? differences.length : null,
  };
}

function captureReview(db: Store, period: Quarter, closed: boolean, range: Range, rows: CallReportRow[]) {
  const earlier = priorQuarter(period);
  const stored = db.prepare(`SELECT ${summaryColumns}, ending FROM call_report_quarter_reviews
    WHERE year = ? AND quarter = ? ORDER BY version DESC LIMIT 1`).get(earlier.year, earlier.quarter) as
    (StoredReview & { ending: string }) | undefined;
  const prior = stored ? summary(stored) : null;
  const report = compareOpening(stored ? JSON.parse(stored.ending) as CarryoverEntry[] : null, carryover(rows, "Beginning pipeline"));
  const key = createHash("sha256").update(JSON.stringify([closed, prior?.version, callReportCsv(rows, range.from, range.through),
    rows.map(({ file }) => [file.loanId, file.revision])])).digest("hex");
  return { ...report, key, prior, needsNote: !prior?.closed || report.differences.length > 0,
    count: rows.length, ending: carryover(rows, "Ending pipeline") };
}

type Capture = ReturnType<typeof captureReview>;
const columns = {
  type: "Record type", period: "Reporting quarter", version: "Review version", at: "Recorded at UTC", reviewer: "Recorded by", status: "Quarter status",
  basis: "Prior-quarter basis", note: "Internal review note", loan: "Loan ID", state: "State", priorState: "Prior state", originator: "Originator NMLS ID",
  revision: "Facts revision", groups: "Review groups", received: "Received date", amount: "Received amount", outcome: "Outcome", outcomeOn: "Outcome date",
  outcomeAmount: "Outcome amount", exclusion: "Exclusion reason", priorCount: "Prior ending count", openingCount: "Current opening count",
  priorAmount: "Prior ending amount", openingAmount: "Current opening amount", delta: "Opening amount difference", differences: "Carryover differences",
};
type CsvRow = Partial<Record<keyof typeof columns, string | number | null>>;
function reviewCsv(period: Quarter, review: QuarterReviewSummary, capture: Capture, rows: CallReportRow[], note: string) {
  const recorded = { period: quarterName(period), version: review.version };
  const compare = (prior: CarryoverTotals | null, opening: CarryoverTotals): CsvRow => ({
    priorCount: prior?.count ?? null, openingCount: opening.count, priorAmount: prior?.amount ?? null, openingAmount: opening.amount,
    delta: prior ? opening.amount - prior.amount : null,
  });
  const basis = capture.prior ? `${quarterName(priorQuarter(period))} v${capture.prior.version}${capture.prior.closed ? "" : " · captured before quarter end"}` :
    "No saved prior-quarter baseline";
  const data: CsvRow[] = [
    { type: "Internal review", at: review.recordedAt, reviewer: review.recordedBy, status: review.closed ? "Quarter ended" : "Quarter in progress",
      basis, note, differences: review.changeCount, ...compare(capture.previousEnding, capture.opening) },
    ...capture.states.map(({ state, previous, opening }) => ({ type: "State comparison", state, ...compare(previous, opening) })),
    ...capture.differences.map(({ loanId, before, current, reasons }) => ({
      type: "Carryover difference", loan: loanId, priorState: before?.state, state: current?.state, priorAmount: before?.amount ?? null,
      openingAmount: current?.amount ?? null, delta: (current?.amount ?? 0) - (before?.amount ?? 0), differences: reasons.join(" | "),
    })),
    ...rows.map(({ file, groups }) => ({ type: "Loan activity", loan: file.loanId, state: file.facts.state, originator: file.facts.originator,
      revision: file.revision, groups: groups.join(" | "), received: file.facts.receivedDate, amount: file.facts.receivedAmount,
      outcome: file.facts.outcome, outcomeOn: file.facts.outcomeDate, outcomeAmount: file.facts.outcomeAmount, exclusion: file.facts.exclusionReason })),
  ];
  const keys = Object.keys(columns) as (keyof typeof columns)[];
  return [Object.values(columns).map(callReportCsvCell).join(","), ...data.map((item) => {
    const row = { ...recorded, ...item };
    return keys.map((key) => callReportCsvCell(row[key] ?? null)).join(",");
  })].join("\r\n");
}

export function quarterReviewWork(db: Store, input: QuarterRequest, staff: WorkspaceStaff, range: Range, today: string, now: string,
  readRows: () => ReadyRows): ReportingReadiness {
  const { year, quarter } = input;
  const period = { year, quarter };
  return db.transaction(() => {
    if (input.type === "downloadQuarterReview") {
      const row = db.prepare("SELECT csv FROM call_report_quarter_reviews WHERE year = ? AND quarter = ? AND version = ?").get(year, quarter, input.version);
      if (!row) return { error: "This review version is unavailable for the selected quarter." };
      accessEvent(db, staff, "Downloaded call report review", `${quarterName(period)} v${input.version}`, now);
      return { kind: "quarterReviewDownload", version: input.version, csv: String(row.csv) };
    }
    if (range.from > today) return { error: "Choose the current quarter or an earlier quarter." };
    if (input.type === "saveQuarterReview") {
      const prior = db.prepare(`SELECT ${summaryColumns}, recordedByEmail, note FROM call_report_quarter_reviews
        WHERE year = ? AND quarter = ? AND requestId = ?`).get(year, quarter, input.requestId) as
        (StoredReview & { recordedByEmail: string; note: string }) | undefined;
      if (prior) {
        if (prior.recordedByEmail !== staff.email || prior.evidenceKey !== input.evidenceKey || prior.note !== input.note) {
          return { error: "This save was already used. Refresh the review before continuing." };
        }
        return { kind: "quarterReviewSaved", review: summary(prior) };
      }
      if (db.prepare("SELECT 1 FROM call_report_quarter_reviews WHERE requestId = ?").get(input.requestId)) {
        return { error: "This save was already used. Refresh the review before continuing." };
      }
    }
    const history = db.prepare(`SELECT ${summaryColumns} FROM call_report_quarter_reviews WHERE year = ? AND quarter = ?
      ORDER BY version DESC LIMIT ?`).all(year, quarter, input.type === "quarterReview" ? historySize : 1) as unknown as StoredReview[];
    const [latest] = history;
    const closed = today > range.through;
    const result = readRows();
    if (input.type === "quarterReview") {
      const page: QuarterReviewPage = { kind: "quarterReview", period, priorPeriod: priorQuarter(period), closed,
        history: history.map(summary), latestCurrent: false, comparison: null, unavailable: "error" in result ? result.error : null };
      if ("error" in result) return page;
      const { key, prior, opening, previousEnding, states, changeCount, needsNote, count, differences } = captureReview(db, period, closed, range, result.rows);
      const offset = input.offset >= differences.length ? 0 : input.offset;
      const pageRows = differences.slice(offset, offset + differencePageSize);
      const borrowers = new Map(pageRows.length ? db.prepare(`SELECT loan.id, contact.name FROM loans loan
        JOIN contacts contact ON contact.id = loan.contactId WHERE loan.id IN (SELECT value FROM json_each(?))`)
        .all(JSON.stringify(pageRows.map(({ loanId }) => loanId))).map(({ id, name }) => [String(id), String(name)]) : []);
      return { ...page, latestCurrent: latest?.evidenceKey === key, comparison: { key, prior, opening, previousEnding, states, changeCount, needsNote, count,
        differences: pageRows.map((item) => ({ ...item, borrower: borrowers.get(item.loanId) ?? null })),
        next: offset + differencePageSize < differences.length ? offset + differencePageSize : null } };
    }
    if ("error" in result) return result;
    const capture = captureReview(db, period, closed, range, result.rows);
    if (capture.key !== input.evidenceKey || (latest?.version ?? null) !== input.previousVersion) {
      return { error: "The quarter or its baseline changed. Refresh the review before saving." };
    }
    if (latest?.evidenceKey === capture.key) return { kind: "quarterReviewSaved", review: summary(latest) };
    if (capture.needsNote && !input.note) return { error: "Record a review note for differences or an incomplete prior-quarter baseline." };
    const review: QuarterReviewSummary = { version: (latest?.version ?? 0) + 1, recordedAt: now, recordedBy: staff.name, count: capture.count,
      changeCount: capture.changeCount, priorVersion: capture.prior?.version ?? null, closed };
    const csv = reviewCsv(period, review, capture, result.rows, input.note);
    db.prepare(`INSERT INTO call_report_quarter_reviews (year, quarter, version, evidenceKey, recordedAt, recordedBy, recordedByEmail,
      closed, count, changeCount, priorVersion, note, ending, csv, requestId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(year, quarter, review.version, capture.key, now, staff.name, staff.email, Number(closed), review.count, review.changeCount,
        review.priorVersion, input.note, JSON.stringify(capture.ending), csv, input.requestId);
    accessEvent(db, staff, "Saved call report review", `${quarterName(period)} v${review.version}`, now);
    return { kind: "quarterReviewSaved", review };
  });
}

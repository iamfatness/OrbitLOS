import { illinoisEvidenceDates, illinoisRecordsSources, reviewIllinoisRecordkeeping,
  type IllinoisRecordkeepingFacts, type IllinoisRecordkeepingRequest } from "./illinois-recordkeeping-model";
import { michiganLoanState } from "./michigan-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type Loan = Parameters<typeof reviewIllinoisRecordkeeping>[1] & { propertyState: string | null; reportState: string | null };
type Finding = ReturnType<typeof reviewIllinoisRecordkeeping>;
export type IllinoisDispositionEvidence = {
  version: number | null; activity: IllinoisRecordkeepingFacts["activity"] | null; activityReference: string | null;
  risk: IllinoisRecordkeepingFacts["risk"] | null; riskReference: string | null;
  outcome: IllinoisRecordkeepingFacts["outcome"] | null; archiveFormat: IllinoisRecordkeepingFacts["archive"]["format"] | null;
  propertyState: string | null; reportState: string | null; recordedClosingOn: string | null;
  recordedFundingOn: string | null; recordedDispositionOn: string | null;
  stateMonths: number | null; stateReviewDate: string | null; gap: string | null; source: string;
  findings: Finding["findings"];
};
type Version = { loanId: string; version: number; facts: IllinoisRecordkeepingFacts; finding: Finding; at: string;
  actor: string; correction: string | null };
export type IllinoisRecordkeepingResult = { kind: "illinoisRecordkeeping"; versions: Version[]; next: number | null;
  targetChanged: boolean; currentFinding: Finding | null; message?: string } | { error: string };

export function initializeIllinoisRecordkeeping(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS illinois_recordkeeping_reviews (
    brokerageId TEXT NOT NULL, loanId TEXT NOT NULL, version INTEGER NOT NULL, requestId TEXT NOT NULL,
    facts TEXT NOT NULL, finding TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL,
    actorRevision INTEGER NOT NULL, correction TEXT,
    PRIMARY KEY(brokerageId,loanId,version), UNIQUE(brokerageId,requestId)
  );`);
}

function readVersion(row: Record<string, unknown>): Version {
  return { loanId: String(row.loanId), version: Number(row.version), facts: JSON.parse(String(row.facts)),
    finding: JSON.parse(String(row.finding)), at: String(row.at), actor: String(row.actor), correction: row.correction as string | null };
}

export function readIllinoisRecordkeepingExport(db: Store, brokerageId: string, loanId: string | null, limit: number) {
  return db.prepare(`SELECT loanId,version,facts,finding,at,actor,correction FROM illinois_recordkeeping_reviews
    WHERE brokerageId=? AND (? IS NULL OR loanId=?) ORDER BY rowid DESC LIMIT ?`)
    .all(brokerageId, loanId, loanId, limit).map(readVersion);
}

function reviewFile(facts: IllinoisRecordkeepingFacts, loan: Loan) {
  const result = reviewIllinoisRecordkeeping(facts, loan);
  if (loan.propertyState === "IL" && (!loan.reportState || loan.reportState === "IL")) return result;
  return { ...result, stateReviewDate: null, findings: [
    { key: "state", message: "Reconcile the property and reporting state for this Illinois review.", source: illinoisRecordsSources.file },
    ...result.findings,
  ] };
}

export function illinoisRetentionLocalDate(now: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(now));
}

export function illinoisDispositionEvidence(db: Store, brokerageId: string, loan: Loan & { id: string }): IllinoisDispositionEvidence | null {
  const row = db.prepare(`SELECT version,facts FROM illinois_recordkeeping_reviews
    WHERE brokerageId=? AND loanId=? ORDER BY version DESC LIMIT 1`).get(brokerageId, loan.id);
  if (loan.propertyState !== "IL" && loan.reportState !== "IL" && !row) return null;
  const facts = row ? JSON.parse(String(row.facts)) as IllinoisRecordkeepingFacts : null;
  const finding = facts ? reviewFile(facts, loan) : null;
  return {
    version: row ? Number(row.version) : null, activity: facts?.activity ?? null, activityReference: facts?.activityReference ?? null,
    risk: facts?.risk ?? null, riskReference: facts?.riskReference ?? null,
    outcome: facts?.outcome ?? null, archiveFormat: facts?.archive.format ?? null,
    propertyState: loan.propertyState, reportState: loan.reportState,
    recordedClosingOn: loan.closingDate, recordedFundingOn: loan.fundingDate, recordedDispositionOn: loan.dispositionDate,
    stateMonths: finding?.stateMonths ?? null, stateReviewDate: finding?.stateReviewDate ?? null,
    source: finding?.stateSource ?? illinoisRecordsSources.retention, findings: finding?.findings ?? [],
    gap: finding ? finding.findings[0]?.message ?? (finding.stateReviewDate ? null : "Record a reconciled Illinois closing or termination date.") :
      "Record Illinois borrower-file evidence for this loan.",
  };
}

// The enclosing loan retention transaction authorizes current pilot owners.
export function illinoisRecordkeepingWork(db: Store, command: IllinoisRecordkeepingRequest, staff: WorkspaceStaff, now: string): IllinoisRecordkeepingResult {
  const { loanId } = command;
  const scope = [staff.brokerage.id, loanId];
  const loan = db.prepare(`SELECT l.stage,l.disposition,l.dispositionDate,f.fundingDate,p.closingDate,
    nullif(${michiganLoanState("a.draft")},'') AS propertyState,
    nullif(upper(trim(json_extract(prep.facts,'$.state'))),'') AS reportState
    FROM loans l LEFT JOIN applications a ON a.loanId=l.id LEFT JOIN closing_progress f ON f.loanId=l.id
    LEFT JOIN past_client_profiles p ON p.loanId=l.id LEFT JOIN call_report_facts prep ON prep.loanId=l.id
    WHERE l.id=?`).get(loanId) as Loan | undefined;
  const head = Number(db.prepare("SELECT max(version) AS version FROM illinois_recordkeeping_reviews WHERE brokerageId=? AND loanId=?")
    .get(...scope)?.version ?? 0);
  const eligible = loan && (loan.propertyState === "IL" || loan.reportState === "IL");
  const unavailable = { error: "Choose a recorded Illinois loan." };
  const pageSize = 20;
  function history(before: number | null, message?: string): IllinoisRecordkeepingResult {
    const rows = db.prepare(`SELECT loanId,version,facts,finding,at,actor,correction FROM illinois_recordkeeping_reviews
      WHERE brokerageId=? AND loanId=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`)
      .all(...scope, before, before, pageSize + 1);
    const versions = rows.slice(0, pageSize).map(readVersion);
    return { kind: "illinoisRecordkeeping", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null,
      targetChanged: !eligible, currentFinding: before === null && versions[0] && loan ? reviewFile(versions[0].facts, loan) : null, message };
  }
  if (command.type === "illinoisRecordkeepingHistory")
    return eligible || head ? history(command.before ?? null) : unavailable;

  const { expected, requestId, facts, correction } = command;
  const factsJson = JSON.stringify(facts);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const conflict = { error: "Illinois recordkeeping evidence changed. Reload the latest version before saving." };
  const saved = "Illinois recordkeeping evidence recorded.";
  const prior = db.prepare("SELECT * FROM illinois_recordkeeping_reviews WHERE brokerageId=? AND requestId=?").get(scope[0], requestId);
  if (prior) {
    if (prior.loanId !== loanId || prior.version !== expected + 1 || prior.facts !== factsJson ||
      prior.correction !== (correction ?? null) || prior.actorEmail !== staff.email || prior.actorRevision !== actorRevision) return conflict;
    return history(null, saved);
  }
  if (!eligible) return unavailable;
  if (head !== expected) return conflict;
  if (head && !correction) return { error: "Record the reason for this evidence correction." };
  const today = illinoisRetentionLocalDate(now);
  if (illinoisEvidenceDates(facts).some(on => on && on > today)) return { error: "Record only events that have occurred." };
  db.prepare(`INSERT INTO illinois_recordkeeping_reviews
    (brokerageId,loanId,version,requestId,facts,finding,at,actor,actorEmail,actorRevision,correction)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...scope, expected + 1, requestId, factsJson, JSON.stringify(reviewFile(facts, loan)),
      now, staff.name, staff.email, actorRevision, correction ?? null);
  accessEvent(db, staff, "Recorded Illinois recordkeeping evidence", loanId, now);
  return history(null, saved);
}

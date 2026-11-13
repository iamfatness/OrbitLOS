import { californiaDreEvidenceDates, californiaDreRecordsSources, reviewCaliforniaDreRecordkeeping,
  type CaliforniaDreRecordkeepingFacts, type CaliforniaDreRecordkeepingRequest } from "./california-dre-recordkeeping-model";
import { michiganLoanState } from "./michigan-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type Loan = Parameters<typeof reviewCaliforniaDreRecordkeeping>[1] & { propertyState: string | null; reportState: string | null };
type Finding = ReturnType<typeof reviewCaliforniaDreRecordkeeping>;
type Version = { loanId: string; version: number; facts: CaliforniaDreRecordkeepingFacts; finding: Finding;
  entity: { name: string; nmls: string }; at: string; actor: string; correction: string | null };
export type CaliforniaDreRecordkeepingResult = { kind: "californiaDreRecordkeeping"; versions: Version[]; next: number | null;
  targetChanged: boolean; currentFinding: Finding | null; message?: string } | { error: string };

export function initializeCaliforniaDreRecordkeeping(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS california_dre_recordkeeping_reviews (
    brokerageId TEXT NOT NULL, loanId TEXT NOT NULL, version INTEGER NOT NULL, requestId TEXT NOT NULL,
    facts TEXT NOT NULL, finding TEXT NOT NULL, entity TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL,
    actorRevision INTEGER NOT NULL, correction TEXT,
    PRIMARY KEY(brokerageId,loanId,version), UNIQUE(brokerageId,requestId)
  );`);
}

function readVersion(row: Record<string, unknown>): Version {
  return { loanId: String(row.loanId), version: Number(row.version), facts: JSON.parse(String(row.facts)),
    finding: JSON.parse(String(row.finding)), entity: JSON.parse(String(row.entity)), at: String(row.at), actor: String(row.actor), correction: row.correction as string | null };
}

export function readCaliforniaDreRecordkeepingExport(db: Store, brokerageId: string, loanId: string | null, limit: number) {
  return db.prepare(`SELECT loanId,version,facts,finding,entity,at,actor,correction FROM california_dre_recordkeeping_reviews
    WHERE brokerageId=? AND (? IS NULL OR loanId=?) ORDER BY rowid DESC LIMIT ?`)
    .all(brokerageId, loanId, loanId, limit).map(readVersion);
}

function reviewFile(facts: CaliforniaDreRecordkeepingFacts, loan: Loan) {
  const result = reviewCaliforniaDreRecordkeeping(facts, loan);
  if (loan.propertyState === "CA" && (!loan.reportState || loan.reportState === "CA")) return result;
  return { ...result, stateReviewDate: null, basis: null, findings: [
    { key: "state", message: "Reconcile the property and reporting state for this California DRE review.", source: californiaDreRecordsSources.statute },
    ...result.findings,
  ] };
}

export function californiaDreRetentionLocalDate(now: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(now));
}

export function californiaDreDispositionEvidence(db: Store, brokerageId: string, loan: Loan & { id: string }) {
  const row = db.prepare(`SELECT version,facts,entity FROM california_dre_recordkeeping_reviews
    WHERE brokerageId=? AND loanId=? ORDER BY version DESC LIMIT 1`).get(brokerageId, loan.id);
  if (!row && loan.propertyState !== "CA" && loan.reportState !== "CA") return null;
  const facts = row ? JSON.parse(String(row.facts)) as CaliforniaDreRecordkeepingFacts : null;
  const finding = facts ? reviewFile(facts, loan) : null;
  const baseDate = finding?.stateReviewDate ?? null;
  const privateDate = finding?.privateRetainThrough ?? null;
  return {
    version: row ? Number(row.version) : null,
    entity: row ? JSON.parse(String(row.entity)) as Version["entity"] : null,
    propertyState: loan.propertyState, reportState: loan.reportState,
    authorityReference: facts?.authorityReference ?? null,
    basis: finding?.basis ?? null, privateRetainThrough: privateDate,
    stateReviewDate: baseDate && privateDate && privateDate > baseDate ? privateDate : baseDate,
    source: finding?.basis?.source ?? californiaDreRecordsSources.statute,
    findings: finding?.findings ?? [],
    gap: finding ? finding.findings[0]?.message ??
      (finding.needsPrivateDate && !privateDate ? "Record the applicable private-money retain-through date." : null) :
      "Confirm the California license authority and record the applicable retention evidence.",
  };
}

export type CaliforniaDreDispositionEvidence = NonNullable<ReturnType<typeof californiaDreDispositionEvidence>>;

// The enclosing loan retention transaction authorizes current pilot owners.
export function californiaDreRecordkeepingWork(db: Store, command: CaliforniaDreRecordkeepingRequest, staff: WorkspaceStaff, now: string): CaliforniaDreRecordkeepingResult {
  const { loanId } = command;
  const scope = [staff.brokerage.id, loanId];
  const loan = db.prepare(`SELECT l.stage,l.disposition,l.dispositionDate,f.fundingDate,p.closingDate,
    nullif(${michiganLoanState("a.draft")},'') AS propertyState,
    nullif(upper(trim(json_extract(prep.facts,'$.state'))),'') AS reportState
    FROM loans l LEFT JOIN applications a ON a.loanId=l.id LEFT JOIN closing_progress f ON f.loanId=l.id
    LEFT JOIN past_client_profiles p ON p.loanId=l.id LEFT JOIN call_report_facts prep ON prep.loanId=l.id
    WHERE l.id=?`).get(loanId) as Loan | undefined;
  const head = Number(db.prepare("SELECT max(version) AS version FROM california_dre_recordkeeping_reviews WHERE brokerageId=? AND loanId=?")
    .get(...scope)?.version ?? 0);
  const eligible = loan && (loan.propertyState === "CA" || loan.reportState === "CA");
  const unavailable = { error: "Choose a recorded California loan." };
  const pageSize = 20;
  function history(before: number | null, message?: string): CaliforniaDreRecordkeepingResult {
    const rows = db.prepare(`SELECT loanId,version,facts,finding,entity,at,actor,correction FROM california_dre_recordkeeping_reviews
      WHERE brokerageId=? AND loanId=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`)
      .all(...scope, before, before, pageSize + 1);
    const versions = rows.slice(0, pageSize).map(readVersion);
    return { kind: "californiaDreRecordkeeping", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null,
      targetChanged: !eligible, currentFinding: before === null && versions[0] && loan ? reviewFile(versions[0].facts, loan) : null, message };
  }
  if (command.type === "californiaDreRecordkeepingHistory")
    return eligible || head ? history(command.before ?? null) : unavailable;

  const { expected, requestId, facts, correction } = command;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?")
    .get(scope[0], facts.entityId) as { name: string; nmls: string } | undefined;
  const factsJson = JSON.stringify(facts);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const conflict = { error: "California DRE recordkeeping evidence changed. Reload the latest version before saving." };
  const saved = "California DRE recordkeeping evidence recorded.";
  const prior = db.prepare("SELECT * FROM california_dre_recordkeeping_reviews WHERE brokerageId=? AND requestId=?").get(scope[0], requestId);
  if (prior) {
    if (prior.loanId !== loanId || prior.version !== expected + 1 || prior.facts !== factsJson ||
      prior.correction !== (correction ?? null) || prior.actorEmail !== staff.email || prior.actorRevision !== actorRevision) return conflict;
    return history(null, saved);
  }
  if (!eligible) return unavailable;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (head !== expected) return conflict;
  if (head && !correction) return { error: "Record the reason for this evidence correction." };
  const today = californiaDreRetentionLocalDate(now);
  if (californiaDreEvidenceDates(facts).some(on => on && on > today)) return { error: "Record only events that have occurred." };
  db.prepare(`INSERT INTO california_dre_recordkeeping_reviews
    (brokerageId,loanId,version,requestId,facts,finding,entity,at,actor,actorEmail,actorRevision,correction)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...scope, expected + 1, requestId, factsJson, JSON.stringify(reviewFile(facts, loan)), JSON.stringify(entity),
      now, staff.name, staff.email, actorRevision, correction ?? null);
  accessEvent(db, staff, "Recorded California DRE recordkeeping evidence", loanId, now);
  return history(null, saved);
}

import { floridaRecordkeepingDates, floridaRecordkeepingSource, reviewFloridaRecordkeeping,
  type FloridaRecordkeepingFacts, type FloridaRecordkeepingRequest } from "./florida-recordkeeping-model";
import { michiganLoanState } from "./michigan-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type Loan = { propertyState: string | null; reportState: string | null; closed: boolean };
type Finding = ReturnType<typeof reviewFloridaRecordkeeping>;
type Version = { loanId: string; version: number; facts: FloridaRecordkeepingFacts; finding: Finding;
  entity: { name: string; nmls: string }; at: string; actor: string; correction: string | null };
export type FloridaRecordkeepingResult = { kind: "floridaRecordkeeping"; versions: Version[]; next: number | null;
  targetChanged: boolean; currentFinding: Finding | null; message?: string } | { error: string };

export function initializeFloridaRecordkeeping(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS florida_recordkeeping_reviews (
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

export function readFloridaRecordkeepingExport(db: Store, brokerageId: string, loanId: string | null, limit: number) {
  return db.prepare(`SELECT loanId,version,facts,finding,entity,at,actor,correction FROM florida_recordkeeping_reviews
    WHERE brokerageId=? AND (? IS NULL OR loanId=?) ORDER BY rowid DESC LIMIT ?`)
    .all(brokerageId, loanId, loanId, limit).map(readVersion);
}

function reviewFile(facts: FloridaRecordkeepingFacts, loan: Loan, now: string) {
  const result = reviewFloridaRecordkeeping(facts, loan, floridaRetentionLocalDate(now, facts.zone));
  if (loan.propertyState === "FL" && (!loan.reportState || loan.reportState === "FL")) return result;
  return { ...result, stateReviewDate: null, findings: [
    { key: "state", message: "Reconcile the property and reporting state for this Florida review.",
      source: floridaRecordkeepingSource },
    ...result.findings,
  ] };
}

export function floridaRetentionLocalDate(now: string, zone: FloridaRecordkeepingFacts["zone"]) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(now));
}

export function floridaDispositionEvidence(db: Store, brokerageId: string, loan: Loan & { id: string }, now: string) {
  const row = db.prepare(`SELECT version,facts,entity FROM florida_recordkeeping_reviews
    WHERE brokerageId=? AND loanId=? ORDER BY version DESC LIMIT 1`).get(brokerageId, loan.id);
  if (!row && loan.propertyState !== "FL" && loan.reportState !== "FL") return null;
  const facts = row ? JSON.parse(String(row.facts)) as FloridaRecordkeepingFacts : null;
  const review = facts ? reviewFile(facts, loan, now) : null;
  return {
    version: row ? Number(row.version) : null,
    entity: row ? JSON.parse(String(row.entity)) as Version["entity"] : null,
    propertyState: loan.propertyState, reportState: loan.reportState,
    facts, stateReviewDate: review?.stateReviewDate ?? null,
    gap: !review ? "Record Florida borrower-file evidence for this loan." : review.findings.find(item => item.key !== "lateAmendment" && item.key !== "lateProduction")?.message ?? null,
    amendmentDueOn: review?.amendmentDueOn ?? null, productionDueOn: review?.productionDueOn ?? null,
    findings: review?.findings ?? [], source: floridaRecordkeepingSource,
  };
}

export type FloridaDispositionEvidence = NonNullable<ReturnType<typeof floridaDispositionEvidence>>;

// The enclosing loan retention transaction authorizes current pilot owners.
export function floridaRecordkeepingWork(db: Store, command: FloridaRecordkeepingRequest, staff: WorkspaceStaff, now: string): FloridaRecordkeepingResult {
  const { loanId } = command;
  const scope = [staff.brokerage.id, loanId];
  const loan = db.prepare(`SELECT nullif(${michiganLoanState("a.draft")},'') AS propertyState,
    nullif(upper(trim(json_extract(prep.facts,'$.state'))),'') AS reportState,
    (l.stage IN ('Closed','Funded') OR EXISTS(SELECT 1 FROM closing_progress cp WHERE cp.loanId=l.id AND cp.fundingDate IS NOT NULL)
      OR EXISTS(SELECT 1 FROM past_client_profiles pc WHERE pc.loanId=l.id AND pc.closingDate IS NOT NULL)) AS closed
    FROM loans l LEFT JOIN applications a ON a.loanId=l.id LEFT JOIN call_report_facts prep ON prep.loanId=l.id
    WHERE l.id=?`).get(loanId) as Loan | undefined;
  const head = Number(db.prepare("SELECT max(version) AS version FROM florida_recordkeeping_reviews WHERE brokerageId=? AND loanId=?")
    .get(...scope)?.version ?? 0);
  const eligible = loan && (loan.propertyState === "FL" || loan.reportState === "FL");
  const unavailable = { error: "Choose a recorded Florida loan." };
  const pageSize = 20;
  function history(before: number | null, message?: string): FloridaRecordkeepingResult {
    const rows = db.prepare(`SELECT loanId,version,facts,finding,entity,at,actor,correction FROM florida_recordkeeping_reviews
      WHERE brokerageId=? AND loanId=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`)
      .all(...scope, before, before, pageSize + 1);
    const versions = rows.slice(0, pageSize).map(readVersion);
    return { kind: "floridaRecordkeeping", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null,
      targetChanged: !eligible, currentFinding: before === null && versions[0] && loan ? reviewFile(versions[0].facts, loan, now) : null, message };
  }
  if (command.type === "floridaRecordkeepingHistory")
    return eligible || head ? history(command.before ?? null) : unavailable;

  const { expected, requestId, facts, correction } = command;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?")
    .get(scope[0], facts.entityId) as { name: string; nmls: string } | undefined;
  const factsJson = JSON.stringify(facts);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const conflict = { error: "Florida recordkeeping evidence changed. Reload the latest version before saving." };
  const saved = "Florida recordkeeping evidence recorded.";
  const prior = db.prepare("SELECT * FROM florida_recordkeeping_reviews WHERE brokerageId=? AND requestId=?").get(scope[0], requestId);
  if (prior) {
    if (prior.loanId !== loanId || prior.version !== expected + 1 || prior.facts !== factsJson ||
      prior.correction !== (correction ?? null) || prior.actorEmail !== staff.email || prior.actorRevision !== actorRevision) return conflict;
    return history(null, saved);
  }
  if (!eligible) return unavailable;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (head !== expected) return conflict;
  if (head && !correction) return { error: "Record the reason for this evidence correction." };
  const today = floridaRetentionLocalDate(now, facts.zone);
  if (floridaRecordkeepingDates(facts).some(on => on && on > today))
    return { error: "Record only events that have occurred." };
  db.prepare(`INSERT INTO florida_recordkeeping_reviews
    (brokerageId,loanId,version,requestId,facts,finding,entity,at,actor,actorEmail,actorRevision,correction)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...scope, expected + 1, requestId, factsJson, JSON.stringify(reviewFile(facts, loan, now)), JSON.stringify(entity),
      now, staff.name, staff.email, actorRevision, correction ?? null);
  accessEvent(db, staff, "Recorded Florida recordkeeping evidence", loanId, now);
  return history(null, saved);
}

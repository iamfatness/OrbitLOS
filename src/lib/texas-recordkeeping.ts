import { texasRecordkeepingDates, texasRecordkeepingSources, reviewTexasRecordkeeping,
  type TexasRecordkeepingFacts, type TexasRecordkeepingRequest } from "./texas-recordkeeping-model";
import { michiganLoanState } from "./michigan-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type Loan = { propertyState: string | null; reportState: string | null; closed: boolean; closingOn: string | null; dispositionOn: string | null };
type Finding = ReturnType<typeof reviewTexasRecordkeeping>;
type Version = { loanId: string; version: number; facts: TexasRecordkeepingFacts; finding: Finding;
  entity: { name: string; nmls: string }; at: string; actor: string; correction: string | null };
export type TexasRecordkeepingResult = { kind: "texasRecordkeeping"; versions: Version[]; next: number | null;
  targetChanged: boolean; currentFinding: Finding | null; message?: string } | { error: string };

export function initializeTexasRecordkeeping(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS texas_recordkeeping_reviews (
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

export function readTexasRecordkeepingExport(db: Store, brokerageId: string, loanId: string | null, limit: number) {
  return db.prepare(`SELECT loanId,version,facts,finding,entity,at,actor,correction FROM texas_recordkeeping_reviews
    WHERE brokerageId=? AND (? IS NULL OR loanId=?) ORDER BY rowid DESC LIMIT ?`)
    .all(brokerageId, loanId, loanId, limit).map(readVersion);
}

function reviewFile(facts: TexasRecordkeepingFacts, loan: Loan) {
  const result = reviewTexasRecordkeeping(facts, loan);
  if (loan.propertyState === "TX" && (!loan.reportState || loan.reportState === "TX")) return result;
  return { ...result, stateReviewDate: null, findings: [
    { key: "state", message: "Reconcile the property and reporting state for this Texas review.",
      source: texasRecordkeepingSources.rules },
    ...result.findings,
  ] };
}

function texasRetentionLocalDate(now: string, zone: TexasRecordkeepingFacts["zone"]) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(now));
}

// The enclosing loan retention transaction authorizes current pilot owners.
export function texasRecordkeepingWork(db: Store, command: TexasRecordkeepingRequest, staff: WorkspaceStaff, now: string): TexasRecordkeepingResult {
  const { loanId } = command;
  const scope = [staff.brokerage.id, loanId];
  const loan = db.prepare(`SELECT nullif(${michiganLoanState("a.draft")},'') AS propertyState,
    nullif(upper(trim(json_extract(prep.facts,'$.state'))),'') AS reportState,
    (l.stage IN ('Closed','Funded') OR EXISTS(SELECT 1 FROM closing_progress cp WHERE cp.loanId=l.id AND cp.fundingDate IS NOT NULL)
      OR EXISTS(SELECT 1 FROM past_client_profiles pc WHERE pc.loanId=l.id AND pc.closingDate IS NOT NULL)) AS closed,
    (SELECT nullif(closingDate,'') FROM past_client_profiles pc WHERE pc.loanId=l.id) AS closingOn,
    CASE WHEN l.disposition IN ('Withdrawn','Lost') THEN nullif(l.dispositionDate,'') END AS dispositionOn
    FROM loans l LEFT JOIN applications a ON a.loanId=l.id LEFT JOIN call_report_facts prep ON prep.loanId=l.id
    WHERE l.id=?`).get(loanId) as Loan | undefined;
  const head = Number(db.prepare("SELECT max(version) AS version FROM texas_recordkeeping_reviews WHERE brokerageId=? AND loanId=?")
    .get(...scope)?.version ?? 0);
  const eligible = loan && (loan.propertyState === "TX" || loan.reportState === "TX");
  const unavailable = { error: "Choose a recorded Texas loan." };
  const pageSize = 20;
  function history(before: number | null, message?: string): TexasRecordkeepingResult {
    const rows = db.prepare(`SELECT loanId,version,facts,finding,entity,at,actor,correction FROM texas_recordkeeping_reviews
      WHERE brokerageId=? AND loanId=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`)
      .all(...scope, before, before, pageSize + 1);
    const versions = rows.slice(0, pageSize).map(readVersion);
    return { kind: "texasRecordkeeping", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null,
      targetChanged: !eligible, currentFinding: before === null && versions[0] && loan ? reviewFile(versions[0].facts, loan) : null, message };
  }
  if (command.type === "texasRecordkeepingHistory")
    return eligible || head ? history(command.before ?? null) : unavailable;

  const { expected, requestId, facts, correction } = command;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?")
    .get(scope[0], facts.entityId) as { name: string; nmls: string } | undefined;
  const factsJson = JSON.stringify(facts);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const conflict = { error: "Texas recordkeeping evidence changed. Reload the latest version before saving." };
  const saved = "Texas recordkeeping evidence recorded.";
  const prior = db.prepare("SELECT * FROM texas_recordkeeping_reviews WHERE brokerageId=? AND requestId=?").get(scope[0], requestId);
  if (prior) {
    if (prior.loanId !== loanId || prior.version !== expected + 1 || prior.facts !== factsJson ||
      prior.correction !== (correction ?? null) || prior.actorEmail !== staff.email || prior.actorRevision !== actorRevision) return conflict;
    return history(null, saved);
  }
  if (!eligible) return unavailable;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (head !== expected) return conflict;
  if (head && !correction) return { error: "Record the reason for this evidence correction." };
  const today = texasRetentionLocalDate(now, facts.zone);
  if (texasRecordkeepingDates(facts).some(on => on && on > today))
    return { error: "Record only events that have occurred." };
  db.prepare(`INSERT INTO texas_recordkeeping_reviews
    (brokerageId,loanId,version,requestId,facts,finding,entity,at,actor,actorEmail,actorRevision,correction)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...scope, expected + 1, requestId, factsJson, JSON.stringify(reviewFile(facts, loan)), JSON.stringify(entity),
      now, staff.name, staff.email, actorRevision, correction ?? null);
  accessEvent(db, staff, "Recorded Texas recordkeeping evidence", loanId, now);
  return history(null, saved);
}

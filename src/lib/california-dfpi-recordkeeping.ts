import { californiaDfpiDates, californiaDfpiSources, reviewCaliforniaDfpi,
  type CaliforniaDfpiFacts, type CaliforniaDfpiRequest } from "./california-dfpi-recordkeeping-model";
import { californiaDreRetentionLocalDate } from "./california-dre-recordkeeping";
import { michiganLoanState } from "./michigan-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type Loan = { propertyState: string | null; reportState: string | null };
type Finding = ReturnType<typeof reviewCaliforniaDfpi>;
type Version = { loanId: string; version: number; facts: CaliforniaDfpiFacts; finding: Finding;
  entity: { name: string; nmls: string }; at: string; actor: string; correction: string | null };
export type CaliforniaDfpiResult = { kind: "californiaDfpi"; versions: Version[]; next: number | null;
  targetChanged: boolean; currentFinding: Finding | null; message?: string } | { error: string };

export function initializeCaliforniaDfpi(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS california_dfpi_recordkeeping_reviews (
    brokerageId TEXT NOT NULL, loanId TEXT NOT NULL, authority TEXT NOT NULL, version INTEGER NOT NULL, requestId TEXT NOT NULL,
    facts TEXT NOT NULL, finding TEXT NOT NULL, entity TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL,
    actorRevision INTEGER NOT NULL, correction TEXT,
    PRIMARY KEY(brokerageId,loanId,authority,version), UNIQUE(brokerageId,requestId)
  );`);
}

function readVersion(row: Record<string, unknown>): Version {
  return { loanId: String(row.loanId), version: Number(row.version), facts: JSON.parse(String(row.facts)),
    finding: JSON.parse(String(row.finding)), entity: JSON.parse(String(row.entity)), at: String(row.at), actor: String(row.actor), correction: row.correction as string | null };
}

export function readCaliforniaDfpiExport(db: Store, brokerageId: string, loanId: string | null, limit: number) {
  return db.prepare(`SELECT loanId,version,facts,finding,entity,at,actor,correction FROM california_dfpi_recordkeeping_reviews
    WHERE brokerageId=? AND (? IS NULL OR loanId=?) ORDER BY rowid DESC LIMIT ?`)
    .all(brokerageId, loanId, loanId, limit).map(readVersion);
}

function reviewFile(facts: CaliforniaDfpiFacts, loan: Loan, today: string) {
  const result = reviewCaliforniaDfpi(facts, today);
  if (loan.propertyState === "CA" && (!loan.reportState || loan.reportState === "CA")) return result;
  return { ...result, stateReviewDate: null, findings: [
    { key: "state", message: "Reconcile the property and reporting state for this California DFPI review.",
      source: facts.authority === "CFL" ? californiaDfpiSources.cfl : californiaDfpiSources.crmla },
    ...result.findings,
  ] };
}

export function californiaDfpiDispositionEvidence(db: Store, brokerageId: string, loan: Loan & { id: string }, today: string) {
  const latest = db.prepare(`SELECT version,facts,entity FROM california_dfpi_recordkeeping_reviews
    WHERE brokerageId=? AND loanId=? AND authority=? ORDER BY version DESC LIMIT 1`);
  return (["CFL", "CRMLA"] as const).flatMap(authority => {
    const row = latest.get(brokerageId, loan.id, authority);
    if (!row) return [];
    const facts = JSON.parse(String(row.facts)) as CaliforniaDfpiFacts;
    const finding = reviewFile(facts, loan, today);
    const source = authority === "CFL" ? californiaDfpiSources.cfl : californiaDfpiSources.crmla;
    return [{
      authority, version: Number(row.version), entity: JSON.parse(String(row.entity)) as Version["entity"],
      authorityReference: facts.authorityReference, finalEntry: facts.finalEntry ?? null, source,
      stateReviewDate: finding.stateReviewDate,
      gap: finding.findings.find(item => item.key !== "production")?.message ??
        (facts.authority === "CRMLA" && facts.production && !facts.production.produced ? "Document examination access for the open CRMLA notice." : null),
      findings: finding.findings.filter(item => item.key !== "production"),
      production: facts.authority === "CRMLA" ? facts.production ?? null : null,
    }];
  });
}

export type CaliforniaDfpiDispositionEvidence = ReturnType<typeof californiaDfpiDispositionEvidence>[number];

// The enclosing loan retention transaction authorizes current pilot owners.
export function californiaDfpiWork(db: Store, command: CaliforniaDfpiRequest, staff: WorkspaceStaff, now: string): CaliforniaDfpiResult {
  const { loanId } = command;
  const authority = command.type === "californiaDfpiHistory" ? command.authority : command.facts.authority;
  const scope = [staff.brokerage.id, loanId, authority];
  const loan = db.prepare(`SELECT nullif(${michiganLoanState("a.draft")},'') AS propertyState,
    nullif(upper(trim(json_extract(prep.facts,'$.state'))),'') AS reportState
    FROM loans l LEFT JOIN applications a ON a.loanId=l.id LEFT JOIN call_report_facts prep ON prep.loanId=l.id
    WHERE l.id=?`).get(loanId) as Loan | undefined;
  const today = californiaDreRetentionLocalDate(now);
  const head = Number(db.prepare("SELECT max(version) AS version FROM california_dfpi_recordkeeping_reviews WHERE brokerageId=? AND loanId=? AND authority=?")
    .get(...scope)?.version ?? 0);
  const eligible = loan && (loan.propertyState === "CA" || loan.reportState === "CA");
  const unavailable = { error: "Choose a recorded California loan." };
  const pageSize = 20;
  function history(before: number | null, message?: string): CaliforniaDfpiResult {
    const rows = db.prepare(`SELECT loanId,version,facts,finding,entity,at,actor,correction FROM california_dfpi_recordkeeping_reviews
      WHERE brokerageId=? AND loanId=? AND authority=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`)
      .all(...scope, before, before, pageSize + 1);
    const versions = rows.slice(0, pageSize).map(readVersion);
    return { kind: "californiaDfpi", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null,
      targetChanged: !eligible, currentFinding: before === null && versions[0] && loan ? reviewFile(versions[0].facts, loan, today) : null, message };
  }
  if (command.type === "californiaDfpiHistory")
    return eligible || head ? history(command.before ?? null) : unavailable;

  const { expected, requestId, facts, correction } = command;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?")
    .get(scope[0], facts.entityId) as { name: string; nmls: string } | undefined;
  const factsJson = JSON.stringify(facts);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const conflict = { error: "California DFPI recordkeeping evidence changed. Reload the latest version before saving." };
  const saved = "California DFPI recordkeeping evidence recorded.";
  const prior = db.prepare("SELECT * FROM california_dfpi_recordkeeping_reviews WHERE brokerageId=? AND requestId=?").get(scope[0], requestId);
  if (prior) {
    if (prior.loanId !== loanId || prior.version !== expected + 1 || prior.facts !== factsJson ||
      prior.correction !== (correction ?? null) || prior.actorEmail !== staff.email || prior.actorRevision !== actorRevision) return conflict;
    return history(null, saved);
  }
  if (!eligible) return unavailable;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (head !== expected) return conflict;
  if (head && !correction) return { error: "Record the reason for this evidence correction." };
  if (californiaDfpiDates(facts).some(on => on && on > today)) return { error: "Record only events that have occurred." };
  if (facts.authority === "CRMLA" && facts.production?.produced && facts.production.produced.on < facts.production.notice.on)
    return { error: "The production date cannot precede the notice." };
  db.prepare(`INSERT INTO california_dfpi_recordkeeping_reviews
    (brokerageId,loanId,authority,version,requestId,facts,finding,entity,at,actor,actorEmail,actorRevision,correction)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...scope, expected + 1, requestId, factsJson, JSON.stringify(reviewFile(facts, loan, today)), JSON.stringify(entity),
      now, staff.name, staff.email, actorRevision, correction ?? null);
  accessEvent(db, staff, "Recorded California DFPI recordkeeping evidence", loanId, now);
  return history(null, saved);
}

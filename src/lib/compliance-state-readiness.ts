import { complianceStateScopeWork } from "./compliance-state-scope";
import type { VersionedBrokerageMember } from "./brokerage-model";
import type { StateReadinessFacts, StateReadinessRequest } from "./compliance-state-readiness-model";
import type { ResearchSource } from "./compliance-research-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

export function initializeStateReadiness(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_state_readiness_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, jurisdiction TEXT NOT NULL, scopeRevision INTEGER NOT NULL,
    sourceKey TEXT NOT NULL, revision INTEGER NOT NULL, facts TEXT NOT NULL, actor TEXT NOT NULL,
    actorRevision INTEGER NOT NULL, savedAt TEXT NOT NULL, requestId TEXT NOT NULL, request TEXT NOT NULL,
    PRIMARY KEY(brokerageId, entityId, jurisdiction, scopeRevision, sourceKey, revision),
    UNIQUE(brokerageId, requestId),
    FOREIGN KEY(brokerageId, entityId, jurisdiction, scopeRevision)
      REFERENCES compliance_state_scope_versions(brokerageId, entityId, jurisdiction, revision));`);
}

const unavailable = { error: "Choose a saved brokerage scope and one of its specific requirements." };
const changed = { error: "The requirement review changed. Refresh before saving." };
type EvidenceRow = { sourceKey: string; revision: number; facts: string; actor: string; savedAt: string };
function evidence(row: EvidenceRow) {
  return { revision: Number(row.revision), facts: JSON.parse(row.facts) as StateReadinessFacts, actor: row.actor, savedAt: row.savedAt };
}

/** Runs in the authenticated compliance transaction. An entry records the admin's external evidence reference. */
export function complianceStateReadinessWork(db: Store, data: StateReadinessRequest, staff: WorkspaceStaff,
  roster: readonly VersionedBrokerageMember[], now: string) {
  if (staff.brokerage.role !== "Admin") return unavailable;
  const tenant = staff.brokerage.id;
  const { entityId, jurisdiction, scopeRevision, sourceKey } = data;
  const scope = complianceStateScopeWork(db, { operation: "read", entityId, jurisdiction, revision: scopeRevision }, staff, roster, now);
  if ("error" in scope || !scope.savedBasis) return unavailable;
  const historical = scope.latestRevision !== scopeRevision;
  const scopeChanged = scope.sourceChanged || scope.entityChanged || scope.licensesChanged;
  const licenseBasisMissing = scope.savedBasis.licenses === null;
  const readOnly = historical || scopeChanged || licenseBasisMissing;
  const authorities = (JSON.parse(scope.savedBasis.sources) as string[]).map(snapshot => JSON.parse(snapshot) as ResearchSource)
    .filter(item => item.key.startsWith(`REQ-${jurisdiction}-`));
  if (sourceKey && !authorities.some(item => item.key === sourceKey)) return unavailable;
  const args = [tenant, entityId, jurisdiction, scopeRevision] as const;
  const latest = (key: string) => db.prepare(`SELECT sourceKey,revision,facts,actor,savedAt FROM compliance_state_readiness_versions
    WHERE brokerageId=? AND entityId=? AND jurisdiction=? AND scopeRevision=? AND sourceKey=? ORDER BY revision DESC LIMIT 1`)
    .get(...args, key) as EvidenceRow | undefined;
  if (data.operation === "read") {
    const rows = db.prepare(`SELECT v.sourceKey,v.revision,v.facts,v.actor,v.savedAt FROM compliance_state_readiness_versions v
      WHERE v.brokerageId=? AND v.entityId=? AND v.jurisdiction=? AND v.scopeRevision=? AND v.revision=(
        SELECT max(n.revision) FROM compliance_state_readiness_versions n WHERE n.brokerageId=v.brokerageId AND n.entityId=v.entityId
          AND n.jurisdiction=v.jurisdiction AND n.scopeRevision=v.scopeRevision AND n.sourceKey=v.sourceKey)`)
      .all(...args) as EvidenceRow[];
    const byKey = new Map(rows.map(row => [row.sourceKey, evidence(row)]));
    const items = authorities.map(({ key, title, sourceUrl, counselQuestion, evidence: evidenceNeeded }) =>
      ({ key, title, sourceUrl, counselQuestion, evidenceNeeded, recorded: byKey.get(key) ?? null }));
    const history = sourceKey ? (db.prepare(`SELECT sourceKey,revision,facts,actor,savedAt FROM compliance_state_readiness_versions
      WHERE brokerageId=? AND entityId=? AND jurisdiction=? AND scopeRevision=? AND sourceKey=? ORDER BY revision DESC LIMIT 21`)
      .all(...args, sourceKey) as EvidenceRow[]) : [];
    return { kind: "stateReadiness" as const, entityId, jurisdiction, scopeRevision, readOnly, historical, scopeChanged, licenseBasisMissing,
      items, historySourceKey: sourceKey ?? null, history: history.slice(0, 20).map(evidence),
      moreHistory: history.length > 20, legalApproval: false as const };
  }
  const request = JSON.stringify(data);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const replay = db.prepare("SELECT actor,actorRevision,request,revision FROM compliance_state_readiness_versions WHERE brokerageId=? AND requestId=?")
    .get(tenant, data.requestId);
  if (replay) return replay.actor === staff.email && replay.actorRevision === actorRevision && replay.request === request
    ? { kind: "stateReadinessSaved" as const, revision: Number(replay.revision) } : changed;
  if (readOnly) return { error: "Save a current brokerage scope before recording requirement evidence." };
  if ((latest(data.sourceKey)?.revision ?? 0) !== data.expectedRevision) return changed;
  const revision = data.expectedRevision + 1;
  db.prepare(`INSERT INTO compliance_state_readiness_versions
    (brokerageId,entityId,jurisdiction,scopeRevision,sourceKey,revision,facts,actor,actorRevision,savedAt,requestId,request)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...args, data.sourceKey, revision, JSON.stringify(data.facts), staff.email, actorRevision, now, data.requestId, request);
  return { kind: "stateReadinessSaved" as const, revision };
}

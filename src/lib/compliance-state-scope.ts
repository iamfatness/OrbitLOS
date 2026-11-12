import { createHash } from "node:crypto";
import { stateRequirementSources, stateRolloutSources, sourceSnapshot } from "./compliance-research-model";
import type { StateScopeFacts, StateScopeRequest } from "./compliance-state-scope-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

export function initializeStateScope(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_state_scope_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, jurisdiction TEXT NOT NULL, revision INTEGER NOT NULL,
    facts TEXT NOT NULL, entitySnapshot TEXT NOT NULL, sourceSnapshots TEXT NOT NULL, sourceHash TEXT NOT NULL,
    actor TEXT NOT NULL, actorRevision INTEGER NOT NULL, savedAt TEXT NOT NULL, requestId TEXT NOT NULL, request TEXT NOT NULL,
    PRIMARY KEY(brokerageId, entityId, jurisdiction, revision), UNIQUE(brokerageId, requestId),
    FOREIGN KEY(brokerageId, entityId) REFERENCES compliance_program_entities(brokerageId, id));`);
}

const unavailable = { error: "Choose a legal entity and one of the 50 rollout states." };
const changed = { error: "This state scope changed. Refresh and review before saving." };

export function complianceStateScopeWork(db: Store, input: StateScopeRequest, staff: WorkspaceStaff, now: string) {
  if (staff.brokerage.role !== "Admin") return unavailable;
  const tenant = staff.brokerage.id;
  const { entityId, jurisdiction } = input;
  const sources = stateRolloutSources.filter(source => source.jurisdiction === jurisdiction);
  if (!sources.length) return unavailable;
  const entity = db.prepare(`SELECT id,name,nmls,scopeNote FROM compliance_program_entities
    WHERE brokerageId=? AND id=?`).get(tenant, entityId);
  if (!entity) return unavailable;
  const sourceSnapshots = JSON.stringify([...sources, ...stateRequirementSources.map(item => item.source)
    .filter(source => source.jurisdiction === jurisdiction)].map(sourceSnapshot));
  const sourceHash = createHash("sha256").update(sourceSnapshots).digest("hex");
  const entitySnapshot = JSON.stringify(entity);
  const latest = () => db.prepare(`SELECT revision,facts,entitySnapshot,sourceSnapshots,sourceHash,actor,savedAt
    FROM compliance_state_scope_versions WHERE brokerageId=? AND entityId=? AND jurisdiction=? ORDER BY revision DESC LIMIT 1`)
    .get(tenant, entityId, jurisdiction);
  const read = (version?: number) => {
    const head = latest();
    const row = version === undefined ? head : db.prepare(`SELECT revision,facts,entitySnapshot,sourceSnapshots,sourceHash,actor,savedAt
      FROM compliance_state_scope_versions WHERE brokerageId=? AND entityId=? AND jurisdiction=? AND revision=?`)
      .get(tenant, entityId, jurisdiction, version);
    if (version !== undefined && !row) return unavailable;
    const history = db.prepare(`SELECT revision,actor,savedAt FROM compliance_state_scope_versions
      WHERE brokerageId=? AND entityId=? AND jurisdiction=? ORDER BY revision DESC LIMIT 21`).all(tenant, entityId, jurisdiction);
    return {
      kind: "stateScope" as const, entityId, jurisdiction, revision: Number(row?.revision ?? 0),
      latestRevision: Number(head?.revision ?? 0),
      facts: row ? JSON.parse(String(row.facts)) as StateScopeFacts : null,
      savedBasis: row ? { entity: String(row.entitySnapshot), sources: String(row.sourceSnapshots) } : null,
      sourceChanged: Boolean(row && row.sourceHash !== sourceHash),
      entityChanged: Boolean(row && row.entitySnapshot !== entitySnapshot),
      history: history.slice(0, 20).map(item => ({ revision: Number(item.revision), actor: String(item.actor), savedAt: String(item.savedAt) })),
      moreHistory: history.length > 20,
      legalApproval: false as const,
    };
  };
  if (input.operation === "read") return read(input.revision);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const request = JSON.stringify(input);
  const replay = db.prepare("SELECT actor,actorRevision,request FROM compliance_state_scope_versions WHERE brokerageId=? AND requestId=?")
    .get(tenant, input.requestId);
  if (replay) return replay.actor === staff.email && replay.actorRevision === actorRevision && replay.request === request ? read() : changed;
  if (Number(latest()?.revision ?? 0) !== input.expectedRevision) return changed;
  if (input.expectedRevision >= 100) return { error: "This scope reached its version limit." };
  db.prepare("INSERT INTO compliance_state_scope_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(tenant, entityId, jurisdiction,
    input.expectedRevision + 1, JSON.stringify(input.facts), entitySnapshot, sourceSnapshots, sourceHash,
    staff.email, actorRevision, now, input.requestId, request);
  return read();
}

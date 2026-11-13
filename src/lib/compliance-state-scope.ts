import { sameStateScopeFacts, stateScopeBasisChanges, stateScopeLicenseSnapshot, stateScopeSourceBasis } from "./compliance-state-basis";
import type { StateReadinessFacts } from "./compliance-state-readiness-model";
import type { StateScopeFacts, StateScopeRequest } from "./compliance-state-scope-model";
import { complianceProgramWork } from "./compliance-program";
import { countLicenseRecords, licenseHolderKinds } from "./compliance-program-model";
import type { VersionedBrokerageMember } from "./brokerage-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

export function initializeStateScope(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_state_scope_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, jurisdiction TEXT NOT NULL, revision INTEGER NOT NULL,
    facts TEXT NOT NULL, entitySnapshot TEXT NOT NULL, sourceSnapshots TEXT NOT NULL, sourceHash TEXT NOT NULL,
    actor TEXT NOT NULL, actorRevision INTEGER NOT NULL, savedAt TEXT NOT NULL, requestId TEXT NOT NULL, request TEXT NOT NULL,
    licenseSnapshots TEXT,
    PRIMARY KEY(brokerageId, entityId, jurisdiction, revision), UNIQUE(brokerageId, requestId),
    FOREIGN KEY(brokerageId, entityId) REFERENCES compliance_program_entities(brokerageId, id));`);
  if (!db.prepare("PRAGMA table_info(compliance_state_scope_versions)").all().some(column => column.name === "licenseSnapshots")) {
    db.exec("ALTER TABLE compliance_state_scope_versions ADD COLUMN licenseSnapshots TEXT");
  }
}

const unavailable = { error: "Choose a legal entity and one of the 50 rollout states." };
const changed = { error: "This state scope changed. Refresh and review before saving." };

export function complianceStateScopeWork(db: Store, input: StateScopeRequest, staff: WorkspaceStaff, roster: readonly VersionedBrokerageMember[], now: string) {
  if (staff.brokerage.role !== "Admin") return unavailable;
  const tenant = staff.brokerage.id;
  const { entityId, jurisdiction } = input;
  const sourceBasis = stateScopeSourceBasis(jurisdiction);
  if (!sourceBasis) return unavailable;
  const entity = db.prepare(`SELECT id,name,nmls,scopeNote FROM compliance_program_entities
    WHERE brokerageId=? AND id=?`).get(tenant, entityId);
  if (!entity) return unavailable;
  const { sourceSnapshots, sourceHash } = sourceBasis;
  const entitySnapshot = JSON.stringify(entity);
  const register = complianceProgramWork(db, { operation: "licenses", entityId }, staff, roster, now);
  if ("error" in register || register.kind !== "programLicenses") return unavailable;
  const licenses = register.licenses.filter(record => record.jurisdiction === jurisdiction);
  const licenseSnapshots = stateScopeLicenseSnapshot(licenses);
  const licenseSummary = licenseHolderKinds.map(holder => ({
    holder, counts: countLicenseRecords(licenses.filter(record => record.holder.kind === holder), register.asOf),
  }));
  const latest = () => db.prepare(`SELECT revision,facts,entitySnapshot,sourceSnapshots,sourceHash,licenseSnapshots,actor,savedAt
    FROM compliance_state_scope_versions WHERE brokerageId=? AND entityId=? AND jurisdiction=? ORDER BY revision DESC LIMIT 1`)
    .get(tenant, entityId, jurisdiction);
  const read = (version?: number) => {
    const head = latest();
    const row = version === undefined ? head : db.prepare(`SELECT revision,facts,entitySnapshot,sourceSnapshots,sourceHash,licenseSnapshots,actor,savedAt
      FROM compliance_state_scope_versions WHERE brokerageId=? AND entityId=? AND jurisdiction=? AND revision=?`)
      .get(tenant, entityId, jurisdiction, version);
    if (version !== undefined && !row) return unavailable;
    const history = db.prepare(`SELECT revision,actor,savedAt FROM compliance_state_scope_versions
      WHERE brokerageId=? AND entityId=? AND jurisdiction=? ORDER BY revision DESC`).all(tenant, entityId, jurisdiction);
    return {
      kind: "stateScope" as const, entityId, jurisdiction, revision: Number(row?.revision ?? 0),
      latestRevision: Number(head?.revision ?? 0),
      facts: row ? JSON.parse(String(row.facts)) as StateScopeFacts : null,
      savedBasis: row ? { entity: String(row.entitySnapshot), sources: String(row.sourceSnapshots),
        licenses: typeof row.licenseSnapshots === "string" ? row.licenseSnapshots : null } : null,
      licenseSummary,
      ...(row ? stateScopeBasisChanges(row, { sourceHash, entitySnapshot, licenseSnapshots }) :
        { sourceChanged: false, entityChanged: false, licensesChanged: false, licenseBasisMissing: false }),
      history: history.map(item => ({ revision: Number(item.revision), actor: String(item.actor), savedAt: String(item.savedAt) })),
      legalApproval: false as const,
    };
  };
  if (input.operation === "read") return read(input.revision);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const request = JSON.stringify(input);
  const replay = db.prepare("SELECT actor,actorRevision,request,revision FROM compliance_state_scope_versions WHERE brokerageId=? AND requestId=?")
    .get(tenant, input.requestId);
  if (replay) return replay.actor === staff.email && replay.actorRevision === actorRevision && replay.request === request ? read(Number(replay.revision)) : changed;
  const previous = latest();
  if (Number(previous?.revision ?? 0) !== input.expectedRevision) return changed;
  if (input.expectedRevision >= 100) return { error: "This scope reached its version limit." };
  const revision = input.expectedRevision + 1;
  const facts = JSON.stringify(input.facts);
  db.prepare(`INSERT INTO compliance_state_scope_versions
    (brokerageId,entityId,jurisdiction,revision,facts,entitySnapshot,sourceSnapshots,sourceHash,actor,actorRevision,savedAt,requestId,request,licenseSnapshots)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(tenant, entityId, jurisdiction,
    revision, facts, entitySnapshot, sourceSnapshots, sourceHash,
    staff.email, actorRevision, now, input.requestId, request, licenseSnapshots);
  if (previous && previous.sourceSnapshots !== sourceSnapshots &&
    sameStateScopeFacts(previous, { facts, entitySnapshot, licenseSnapshots })) {
    const oldSources = new Set(JSON.parse(String(previous.sourceSnapshots)) as string[]);
    const retained = new Set((JSON.parse(sourceSnapshots) as string[]).filter(source => oldSources.has(source))
      .map(source => (JSON.parse(source) as { key: string }).key));
    const decisions = db.prepare(`SELECT v.* FROM compliance_state_readiness_versions v
      WHERE v.brokerageId=? AND v.entityId=? AND v.jurisdiction=? AND v.scopeRevision=?
        AND v.revision=(SELECT max(n.revision) FROM compliance_state_readiness_versions n
          WHERE n.brokerageId=v.brokerageId AND n.entityId=v.entityId AND n.jurisdiction=v.jurisdiction
            AND n.scopeRevision=v.scopeRevision AND n.sourceKey=v.sourceKey)`).all(tenant, entityId, jurisdiction, input.expectedRevision);
    const insert = db.prepare(`INSERT INTO compliance_state_readiness_versions
      (brokerageId,entityId,jurisdiction,scopeRevision,sourceKey,revision,facts,actor,actorRevision,savedAt,requestId,request)
      VALUES (?,?,?,?,?,1,?,?,?,?,?,?)`);
    for (const decision of decisions) {
      if (!retained.has(String(decision.sourceKey))) continue;
      const { counsel, counselEvidence } = JSON.parse(String(decision.facts)) as StateReadinessFacts;
      if (counsel === "Pending counsel") continue;
      const carried: StateReadinessFacts = { counsel, counselEvidence, control: "Open", controlEvidence: "", nextAction: "" };
      insert.run(tenant, entityId, jurisdiction, revision, decision.sourceKey, JSON.stringify(carried),
        decision.actor, decision.actorRevision, decision.savedAt, crypto.randomUUID(),
        JSON.stringify({ carriedFromScope: input.expectedRevision, carriedFromRevision: decision.revision }));
    }
  }
  return read();
}

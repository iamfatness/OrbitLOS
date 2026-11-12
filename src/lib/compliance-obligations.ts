import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import type { VersionedBrokerageMember } from "./brokerage-model";
import { obligationRequest, obligationPeriod, obligationPlanningNotice, type ObligationDraft, type ObligationRequest } from "./compliance-obligations-model";

export function initializeComplianceObligations(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_obligation_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
    draft TEXT NOT NULL, ownerRevision INTEGER NOT NULL, reviewer TEXT NOT NULL, reviewedAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,entityId,id,revision),
    FOREIGN KEY(brokerageId,entityId) REFERENCES compliance_program_entities(brokerageId,id));
  CREATE TABLE IF NOT EXISTS compliance_obligation_occurrences (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, obligationId TEXT NOT NULL, period TEXT NOT NULL,
    version INTEGER NOT NULL, status TEXT NOT NULL, internalTarget TEXT NOT NULL, snapshot TEXT NOT NULL,
    createdBy TEXT NOT NULL, createdAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,entityId,obligationId,period));
  CREATE TABLE IF NOT EXISTS compliance_obligation_events (
    brokerageId TEXT NOT NULL, requestId TEXT NOT NULL, entityId TEXT NOT NULL, actor TEXT NOT NULL,
    at TEXT NOT NULL, request TEXT NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY(brokerageId,requestId));`);
}

/** Call ONLY inside the existing authenticated transaction, after current roster lookup.
 * Audit exceptions must propagate to its rollback handler. No scheduler or external effects. */
export function complianceObligationsWork(db: Store, input: ObligationRequest, staff: WorkspaceStaff,
  roster: readonly VersionedBrokerageMember[], now: string) {
  const unavailable = { error: "This internal obligation registry is unavailable." };
  const changed = { error: "This obligation changed. Refresh and review before continuing." };
  const tenant = staff.brokerage.id;
  const active = (email: string) => roster.find(m => m.email === email && m.status === "Active" && m.role === "Admin");
  const actor = active(staff.email);
  if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin" || !actor || (actor.accessRevision ?? 0) !== staff.brokerage.accessRevision) return unavailable;
  const parsed = obligationRequest.safeParse(input);
  if (!parsed.success) return unavailable;
  const data = parsed.data;
  if (!db.prepare("SELECT 1 FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(tenant, data.entityId)) return unavailable;
  if (data.operation === "list") {
    const rows = db.prepare(`SELECT v.* FROM compliance_obligation_versions v WHERE brokerageId=? AND entityId=?
      AND revision=(SELECT max(n.revision) FROM compliance_obligation_versions n WHERE n.brokerageId=v.brokerageId AND n.entityId=v.entityId AND n.id=v.id)
      ORDER BY id LIMIT 51 OFFSET ?`).all(tenant, data.entityId, data.offset);
    return { kind: "obligationRegistry", notice: obligationPlanningNotice, more: rows.length > 50, offset: data.offset,
      items: rows.slice(0, 50).map(row => {
        const draft = JSON.parse(String(row.draft)) as ObligationDraft;
        const owner = active(draft.ownerEmail);
        return { id: row.id, revision: row.revision, draft, reviewer: row.reviewer, reviewedAt: row.reviewedAt,
          ownerAvailable: Boolean(owner && (owner.accessRevision ?? 0) === row.ownerRevision) };
      }) };
  }
  const replay = db.prepare("SELECT actor,request,result FROM compliance_obligation_events WHERE brokerageId=? AND requestId=?").get(tenant, data.requestId);
  if (replay) return replay.actor === staff.email && replay.request === JSON.stringify(data) ? JSON.parse(String(replay.result)) : changed;
  const latest = db.prepare("SELECT * FROM compliance_obligation_versions WHERE brokerageId=? AND entityId=? AND id=? ORDER BY revision DESC LIMIT 1")
    .get(tenant, data.entityId, data.id);
  if ((latest?.revision ?? 0) !== data.expectedRevision) return changed;
  const record = (result: Record<string, unknown>) => {
    db.prepare("INSERT INTO compliance_obligation_events VALUES (?,?,?,?,?,?,?)")
      .run(tenant, data.requestId, data.entityId, staff.email, now, JSON.stringify(data), JSON.stringify(result));
    return result;
  };
  if (data.operation === "save") {
    const owner = active(data.draft.ownerEmail);
    if (!owner) return { error: "Choose an active admin owner." };
    if (!latest && Number(db.prepare("SELECT count(DISTINCT id) n FROM compliance_obligation_versions WHERE brokerageId=? AND entityId=?").get(tenant, data.entityId)!.n) >= 200)
      return { error: "This internal pilot supports 200 obligations per entity." };
    if (data.expectedRevision >= 1000) return { error: "This obligation has reached the pilot version limit." };
    const revision = data.expectedRevision + 1;
    db.prepare("INSERT INTO compliance_obligation_versions VALUES (?,?,?,?,?,?,?,?)").run(tenant, data.entityId, data.id, revision,
      JSON.stringify(data.draft), owner.accessRevision ?? 0, staff.email, now);
    return record({ kind: "obligationSaved", id: data.id, revision, notice: obligationPlanningNotice });
  }
  if (!latest) return unavailable;
  const draft = JSON.parse(String(latest.draft)) as ObligationDraft;
  const owner = active(draft.ownerEmail);
  if (!owner || (owner.accessRevision ?? 0) !== latest.ownerRevision) return { error: "Review the unavailable owner and save a new version before generation." };
  const period = obligationPeriod(data.period, draft.cadence, draft.internalTargetDay);
  if (!period) return { error: "Choose the first month of the internal cadence period." };
  if (period.through < draft.effectiveFrom || (draft.effectiveThrough && period.from > draft.effectiveThrough))
    return { error: "This internal period falls outside the version's effective dates." };
  const existing = db.prepare("SELECT * FROM compliance_obligation_occurrences WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?")
    .get(tenant, data.entityId, data.id, data.period);
  if (existing) return record({ kind: "obligationOccurrence", occurrence: existing, reused: true, notice: obligationPlanningNotice });
  const partial = draft.effectiveFrom > period.from || Boolean(draft.effectiveThrough && draft.effectiveThrough < period.through);
  const status = draft.applicability === "Needs review" || partial ? "Applicability review gap" :
    draft.applicability === "Not applicable" ? "Internal exclusion review recorded" : "Internal preparation planned";
  const snapshot = JSON.stringify({ draft, revision: latest.revision, reviewer: latest.reviewer, reviewedAt: latest.reviewedAt,
    ownerRevision: latest.ownerRevision, period, partialEffectivePeriod: partial, notice: obligationPlanningNotice });
  db.prepare("INSERT INTO compliance_obligation_occurrences VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(tenant, data.entityId, data.id, data.period, Number(latest.revision), status, period.internalTarget, snapshot, staff.email, now);
  return record({ kind: "obligationOccurrence", occurrence: { brokerageId: tenant, entityId: data.entityId, obligationId: data.id,
    period: data.period, version: latest.revision, status, internalTarget: period.internalTarget, snapshot, createdBy: staff.email, createdAt: now },
    reused: false, notice: obligationPlanningNotice });
}

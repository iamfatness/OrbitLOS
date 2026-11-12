import type { Store } from "./store";
import { complianceProgramWork } from "./compliance-program";
import { stateScopeLicenseSnapshot } from "./compliance-state-scope";
import type { WorkspaceStaff } from "./staff-store";
import type { VersionedBrokerageMember } from "./brokerage-model";
import { obligationRequest, obligationPeriod, obligationPlanningNotice, type ObligationDraft, type ObligationRequest,
  type ObligationStateSource } from "./compliance-obligations-model";
import { sourceSnapshot, stateRequirementSources } from "./compliance-research-model";

type StateBasis = ObligationStateSource & { snapshot: string };
type StoredDraft = ObligationDraft & { stateBasis?: StateBasis };
const reportingRequirements = stateRequirementSources.filter(item => item.areaKey.endsWith("-REPORTING"));
const describeStateBasis = ({ jurisdiction, revision, sourceKey, title, authority, sourceUrl }: StateBasis): ObligationStateSource =>
  ({ jurisdiction, revision, sourceKey, title, authority, sourceUrl });

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
    PRIMARY KEY(brokerageId,requestId));
  CREATE TABLE IF NOT EXISTS compliance_obligation_work (
    brokerageId TEXT NOT NULL,entityId TEXT NOT NULL,obligationId TEXT NOT NULL,period TEXT NOT NULL,
    workId TEXT NOT NULL,month TEXT NOT NULL,createdAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,entityId,obligationId,period));`);
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
  const entity = db.prepare("SELECT id,name,nmls,scopeNote FROM compliance_program_entities WHERE brokerageId=? AND id=?")
    .get(tenant, data.entityId);
  if (!entity) return unavailable;
  const stateSources = () => {
    const versions = db.prepare(`SELECT s.jurisdiction,s.revision,s.entitySnapshot,s.sourceSnapshots,s.licenseSnapshots FROM compliance_state_scope_versions s
      WHERE s.brokerageId=? AND s.entityId=? AND s.revision=(
        SELECT max(n.revision) FROM compliance_state_scope_versions n
        WHERE n.brokerageId=s.brokerageId AND n.entityId=s.entityId AND n.jurisdiction=s.jurisdiction)
      ORDER BY s.jurisdiction`).all(tenant, data.entityId);
    if (!versions.length) return [];
    const register = complianceProgramWork(db, { operation: "licenses", entityId: data.entityId }, staff, roster, now);
    if ("error" in register || register.kind !== "programLicenses") return [];
    const entitySnapshot = JSON.stringify(entity);
    const licensesByState = Map.groupBy(register.licenses, license => license.jurisdiction);
    return versions.flatMap(version => {
      if (version.entitySnapshot !== entitySnapshot ||
        version.licenseSnapshots !== stateScopeLicenseSnapshot(licensesByState.get(String(version.jurisdiction)) ?? [])) return [];
      const savedSources = new Set(JSON.parse(String(version.sourceSnapshots)) as string[]);
      return reportingRequirements.flatMap(({ source }) => {
        if (source.jurisdiction !== version.jurisdiction) return [];
        const snapshot = sourceSnapshot(source);
        if (!savedSources.has(snapshot)) return [];
        return [{ jurisdiction: source.jurisdiction, revision: Number(version.revision), sourceKey: source.key,
          title: source.title, authority: source.relatedSources?.[0]?.label ?? source.title, sourceUrl: source.sourceUrl, snapshot }];
      });
    });
  };
  if (data.operation === "stateSources")
    return { kind: "obligationStateSources", items: stateSources().map(describeStateBasis) };
  const matchesStateBasis = (current: StateBasis, saved: StateBasis) => current.sourceKey === saved.sourceKey &&
    current.revision === saved.revision && current.jurisdiction === saved.jurisdiction && current.snapshot === saved.snapshot;
  if (data.operation === "occurrences") {
    const rows = db.prepare(`SELECT obligationId,period,version,status,internalTarget,snapshot,createdBy,createdAt
      FROM compliance_obligation_occurrences WHERE brokerageId=? AND entityId=? AND obligationId=? ORDER BY period DESC LIMIT 51 OFFSET ?`)
      .all(tenant, data.entityId, data.id, data.offset);
    return { kind: "obligationOccurrences", items: rows.slice(0, 50).map(row => {
      const { stateBasis, stateBasisChanged } = JSON.parse(String(row.snapshot)) as { stateBasis?: StateBasis; stateBasisChanged?: boolean };
      return { ...row, ...(stateBasis ? { stateBasis: describeStateBasis(stateBasis), stateBasisChanged } : {}) };
    }), more: rows.length > 50, notice: obligationPlanningNotice };
  }
  if (data.operation === "list") {
    const rows = db.prepare(`SELECT v.* FROM compliance_obligation_versions v WHERE brokerageId=? AND entityId=?
      AND revision=(SELECT max(n.revision) FROM compliance_obligation_versions n WHERE n.brokerageId=v.brokerageId AND n.entityId=v.entityId AND n.id=v.id)
      ORDER BY id LIMIT 51 OFFSET ?`).all(tenant, data.entityId, data.offset);
    let currentSources: StateBasis[] | undefined;
    return { kind: "obligationRegistry", notice: obligationPlanningNotice, more: rows.length > 50, offset: data.offset,
      items: rows.slice(0, 50).map(row => {
        const { stateBasis, ...draft } = JSON.parse(String(row.draft)) as StoredDraft;
        const owner = active(draft.ownerEmail);
        return { id: row.id, revision: row.revision, draft, reviewer: row.reviewer, reviewedAt: row.reviewedAt,
          ...(stateBasis ? { stateBasis: describeStateBasis(stateBasis),
            stateBasisChanged: !(currentSources ??= stateSources()).some(source => matchesStateBasis(source, stateBasis)) } : {}),
          ownerAvailable: Boolean(owner && (owner.accessRevision ?? 0) === row.ownerRevision) };
      }) };
  }
  const replay = db.prepare("SELECT actor,request,result FROM compliance_obligation_events WHERE brokerageId=? AND requestId=?").get(tenant, data.requestId);
  if (replay) return replay.actor === staff.email && replay.request === JSON.stringify(data) ? JSON.parse(String(replay.result)) : changed;
  if (data.operation === "planWork") {
    const occurrence = db.prepare("SELECT * FROM compliance_obligation_occurrences WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?")
      .get(tenant,data.entityId,data.id,data.period);
    if (!occurrence) return unavailable;
    const linked = db.prepare("SELECT workId,month FROM compliance_obligation_work WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?")
      .get(tenant,data.entityId,data.id,data.period);
    const snapshot = JSON.parse(String(occurrence.snapshot)) as {draft:ObligationDraft;stateBasis?:StateBasis;ownerRevision:number;revision:number};
    const owner = active(snapshot.draft.ownerEmail);
    if (!linked && (!owner || (owner.accessRevision ?? 0) !== snapshot.ownerRevision))
      return {error:"The period's original owner is unavailable. Review the period and assign manual monthly work to a current admin."};
    const month = String(occurrence.internalTarget).slice(0,7);
    let workId = linked ? String(linked.workId) : "";
    if (!linked) {
      const requestId = crypto.randomUUID();
      const stateNote = snapshot.stateBasis ? ` State scope version ${snapshot.stateBasis.revision}, ${snapshot.stateBasis.sourceKey}.` : "";
      const result = complianceProgramWork(db,{operation:"schedule",requestId,entityId:data.entityId,month,
        title:snapshot.draft.title,category:"Management review",ownerEmail:snapshot.draft.ownerEmail,
        internalTarget:String(occurrence.internalTarget),instructions:
          `Period ${data.period}; obligation version ${snapshot.revision}. ${String(occurrence.status)}. Review applicability, evidence and next steps.${stateNote} Source: ${snapshot.draft.sourceUrl}`.slice(0,1500)},staff,roster,now);
      if ("error" in result) return result;
      workId=String(db.prepare("SELECT id FROM compliance_program_events WHERE brokerageId=? AND requestId=?").get(tenant,requestId)!.id);
      db.prepare("INSERT INTO compliance_obligation_work VALUES (?,?,?,?,?,?,?)").run(tenant,data.entityId,data.id,data.period,workId,month,now);
    }
    const result={kind:"obligationWorkPlanned",workId,month:linked?String(linked.month):month,reused:Boolean(linked),notice:obligationPlanningNotice};
    db.prepare("INSERT INTO compliance_obligation_events VALUES (?,?,?,?,?,?,?)").run(tenant,data.requestId,data.entityId,staff.email,now,JSON.stringify(data),JSON.stringify(result));
    return result;
  }
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
    const existingBasis = latest ? (JSON.parse(String(latest.draft)) as StoredDraft).stateBasis : undefined;
    const reference = data.stateReference;
    const stateBasis = reference ? stateSources().find(source => source.jurisdiction === reference.jurisdiction &&
      source.revision === reference.revision && source.sourceKey === reference.sourceKey) : existingBasis;
    if (reference && !stateBasis) return { error: "The state reporting source changed. Refresh sources or save a current state scope." };
    const draft = stateBasis ? { ...data.draft, sourceUrl: stateBasis.sourceUrl, authority: stateBasis.authority, stateBasis } : data.draft;
    const revision = data.expectedRevision + 1;
    db.prepare("INSERT INTO compliance_obligation_versions VALUES (?,?,?,?,?,?,?,?)").run(tenant, data.entityId, data.id, revision,
      JSON.stringify(draft), owner.accessRevision ?? 0, staff.email, now);
    return record({ kind: "obligationSaved", id: data.id, revision, notice: obligationPlanningNotice });
  }
  if (!latest) return unavailable;
  const { stateBasis, ...draft } = JSON.parse(String(latest.draft)) as StoredDraft;
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
  const stateBasisChanged = Boolean(stateBasis && !stateSources().some(source => matchesStateBasis(source, stateBasis)));
  const status = draft.applicability === "Needs review" || partial || stateBasisChanged ? "Applicability review gap" :
    draft.applicability === "Not applicable" ? "Internal exclusion review recorded" : "Internal preparation planned";
  const snapshot = JSON.stringify({ draft, revision: latest.revision, reviewer: latest.reviewer, reviewedAt: latest.reviewedAt,
    ownerRevision: latest.ownerRevision, period, partialEffectivePeriod: partial,
    ...(stateBasis ? { stateBasis, stateBasisChanged } : {}), notice: obligationPlanningNotice });
  db.prepare("INSERT INTO compliance_obligation_occurrences VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(tenant, data.entityId, data.id, data.period, Number(latest.revision), status, period.internalTarget, snapshot, staff.email, now);
  return record({ kind: "obligationOccurrence", occurrence: { brokerageId: tenant, entityId: data.entityId, obligationId: data.id,
    period: data.period, version: latest.revision, status, internalTarget: period.internalTarget, snapshot, createdBy: staff.email, createdAt: now },
    reused: false, notice: obligationPlanningNotice });
}

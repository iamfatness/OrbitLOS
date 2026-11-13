import { easternDate } from "./client-retention";
import type { Store } from "./store";
import { complianceProgramWork } from "./compliance-program";
import { stateScopeLicenseSnapshot } from "./compliance-state-basis";
import type { WorkspaceStaff } from "./staff-store";
import { workspaceFeatures, type VersionedBrokerageMember } from "./brokerage-model";
import { isObligationStateSource, obligationReportingBasis, filingArchiveRow, filingReceiptFields, obligationRequest, obligationPeriod, obligationPlanningNotice, type ObligationDraft, type ObligationRequest,
  type ObligationStateSource } from "./compliance-obligations-model";
import { sourceSnapshot, stateRequirementSources } from "./compliance-research-model";

type StateBasis = ObligationStateSource & { snapshot: string };
type StoredDraft = ObligationDraft & { stateBasis?: StateBasis };
const obligationSources = stateRequirementSources.filter(item => isObligationStateSource(item.source.key));
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
    PRIMARY KEY(brokerageId,entityId,obligationId,period));
  CREATE TABLE IF NOT EXISTS compliance_filing_receipts (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, obligationId TEXT NOT NULL, period TEXT NOT NULL, version INTEGER NOT NULL,
    evidence TEXT NOT NULL, recordedBy TEXT NOT NULL, recordedAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,entityId,obligationId,period,version),
    FOREIGN KEY(brokerageId,entityId,obligationId,period)
      REFERENCES compliance_obligation_occurrences(brokerageId,entityId,obligationId,period));
  CREATE TABLE IF NOT EXISTS compliance_filing_receipt_references (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, obligationId TEXT NOT NULL, period TEXT NOT NULL, version INTEGER NOT NULL,
    location TEXT NOT NULL, recordedBy TEXT NOT NULL, recordedAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,entityId,obligationId,period,version),
    FOREIGN KEY(brokerageId,entityId,obligationId,period,version)
      REFERENCES compliance_filing_receipts(brokerageId,entityId,obligationId,period,version));
  CREATE INDEX IF NOT EXISTS compliance_obligation_month_work ON compliance_obligation_work(brokerageId,entityId,month);`);
}

/** Call ONLY inside the existing authenticated transaction, after current roster lookup.
 * Audit exceptions must propagate to its rollback handler. No scheduler or external effects. */
export function complianceObligationsWork(db: Store, input: ObligationRequest, staff: WorkspaceStaff,
  roster: readonly VersionedBrokerageMember[], now: string) {
  const unavailable = { error: "This internal obligation registry is unavailable." };
  const changed = { error: "This obligation changed. Refresh and review before continuing." };
  const tenant = staff.brokerage.id;
  const owners = roster.filter(member => member.status === "Active" && member.role === "Admin");
  const active = (email: string) => owners.find(member => member.email === email);
  const actor = active(staff.email);
  if (!workspaceFeatures(staff.brokerage).compliance || staff.brokerage.role !== "Admin" || !actor ||
      (actor.accessRevision ?? 0) !== (staff.brokerage.accessRevision ?? 0)) return unavailable;
  const parsed = obligationRequest.safeParse(input);
  if (!parsed.success) return unavailable;
  const data = parsed.data;
  if (data.operation === "filingArchive") {
    const { filters, offset } = data;
    const match = "m.brokerageId=o.brokerageId AND m.entityId=o.entityId AND m.obligationId=o.obligationId AND m.period=o.period";
    const matchingVersion = filters.confirmation ? `(SELECT max(m.version) FROM compliance_filing_receipts m
      WHERE ${match} AND instr(lower(json_extract(m.evidence,'$.confirmation')),lower(?))>0)` : "r.version";
    const rows = db.prepare(`SELECT o.entityId,e.name AS entityName,o.obligationId,o.period,o.version AS obligationVersion,o.status AS periodStatus,o.snapshot,
      r.version,r.evidence,matched.version AS matchedVersion,matched.evidence AS matchedEvidence,a.version IS NOT NULL AS referenceAdded
      FROM compliance_obligation_occurrences o
      JOIN compliance_program_entities e ON e.brokerageId=o.brokerageId AND e.id=o.entityId
      JOIN compliance_filing_receipts r ON r.brokerageId=o.brokerageId AND r.entityId=o.entityId AND r.obligationId=o.obligationId AND r.period=o.period
        AND r.version=(SELECT max(m.version) FROM compliance_filing_receipts m WHERE ${match})
      JOIN compliance_filing_receipts matched ON matched.brokerageId=o.brokerageId AND matched.entityId=o.entityId
        AND matched.obligationId=o.obligationId AND matched.period=o.period AND matched.version=${matchingVersion}
      LEFT JOIN compliance_filing_receipt_references a ON a.brokerageId=matched.brokerageId AND a.entityId=matched.entityId
        AND a.obligationId=matched.obligationId AND a.period=matched.period AND a.version=matched.version
      WHERE o.brokerageId=? AND o.period BETWEEN ? AND ? ${filters.entityId ? "AND o.entityId=?" : ""}
      ORDER BY o.period DESC,e.name,o.entityId,o.obligationId LIMIT 26 OFFSET ?`).all(
        ...(filters.confirmation ? [filters.confirmation] : []), tenant,
        `${filters.year || "2000"}-01`, `${filters.year || "2099"}-12`,
        ...(filters.entityId ? [filters.entityId] : []), offset);
    const entities = db.prepare("SELECT id,name FROM compliance_program_entities WHERE brokerageId=? ORDER BY name,id LIMIT 50").all(tenant);
    return { kind: "filingArchive", entities, more: rows.length > 25, items: rows.slice(0, 25).map(row => {
      const { draft } = JSON.parse(String(row.snapshot)) as { draft: ObligationDraft };
      const [year, month] = String(row.period).split("-");
      const matched = filingReceiptFields.parse(JSON.parse(String(row.matchedEvidence)));
      return filingArchiveRow.parse({
        ...filingReceiptFields.parse(JSON.parse(String(row.evidence))),
        entityId: row.entityId, entityName: row.entityName, obligationId: row.obligationId, period: row.period,
        title: draft.title, version: row.version, matchedVersion: row.matchedVersion,
        matched: { status: matched.status, confirmation: matched.confirmation, confirmedOn: matched.confirmedOn,
          hasReceiptReference: !!matched.documentReference || !!row.referenceAdded },
        basis: { obligationId: row.obligationId, period: row.period, version: row.obligationVersion, status: row.periodStatus,
          sourceUrl: draft.sourceUrl, authority: draft.authority, report: { year, quarter: Math.ceil(Number(month) / 3) } },
      });
    }) };
  }
  const entity = db.prepare("SELECT id,name,nmls,scopeNote FROM compliance_program_entities WHERE brokerageId=? AND id=?")
    .get(tenant, data.entityId);
  if (!entity) return unavailable;
  if (data.operation === "filingReceipts" || data.operation === "recordFilingReceipt" || data.operation === "addFilingReceiptReference") {
    const keys = [tenant, data.entityId, data.id, data.period] as const;
    const period = db.prepare(`SELECT snapshot FROM compliance_obligation_occurrences
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...keys);
    if (!period || (JSON.parse(String(period.snapshot)) as { draft: ObligationDraft }).draft.preparation !== "Mortgage Call Report") return unavailable;
    const today = easternDate(new Date(now));
    const read = () => ({
      kind: "filingReceipts" as const, today,
      items: db.prepare(`SELECT r.version,r.evidence,r.recordedBy,r.recordedAt,a.location,a.recordedBy AS addedBy,a.recordedAt AS addedAt
        FROM compliance_filing_receipts r LEFT JOIN compliance_filing_receipt_references a ON a.brokerageId=r.brokerageId
          AND a.entityId=r.entityId AND a.obligationId=r.obligationId AND a.period=r.period AND a.version=r.version
        WHERE r.brokerageId=? AND r.entityId=? AND r.obligationId=? AND r.period=? ORDER BY r.version DESC`).all(...keys)
        .map(({ evidence, location, addedBy, addedAt, ...entry }) => ({
          ...filingReceiptFields.parse(JSON.parse(String(evidence))), ...entry,
          ...(location ? { addedReceiptReference: { location, recordedBy: addedBy, recordedAt: addedAt } } : {}),
        })),
    });
    if (data.operation === "filingReceipts") return read();
    const request = JSON.stringify(data);
    const replay = db.prepare("SELECT actor,request FROM compliance_obligation_events WHERE brokerageId=? AND requestId=?")
      .get(tenant, data.requestId);
    if (replay) return replay.actor === staff.email && replay.request === request ? read() : changed;
    if (data.operation === "addFilingReceiptReference") {
      const original = db.prepare(`SELECT evidence FROM compliance_filing_receipts
        WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? AND version=?`).get(...keys, data.version);
      if (!original) return { error: "That filing confirmation is unavailable. Refresh filing history." };
      const recorded = filingReceiptFields.parse(JSON.parse(String(original.evidence)));
      const saved = db.prepare(`SELECT 1 FROM compliance_filing_receipt_references
        WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? AND version=?`).get(...keys, data.version);
      if (recorded.documentReference || saved) return { error: "The filing record changed. Refresh its history to see the saved receipt location." };
      db.prepare("INSERT INTO compliance_filing_receipt_references VALUES (?,?,?,?,?,?,?,?)")
        .run(...keys, data.version, data.location, staff.email, now);
      db.prepare("INSERT INTO compliance_obligation_events VALUES (?,?,?,?,?,?,?)")
        .run(tenant, data.requestId, data.entityId, staff.email, now, request, JSON.stringify({ kind: "filingReceiptReferenceAdded", version: data.version }));
      return read();
    }
    const { status, confirmation, confirmedOn, documentReference, note } = data;
    if (confirmedOn > today) return { error: "Enter the date on the confirmation. It must be today or earlier." };
    const latest = Number(db.prepare(`SELECT max(version) AS version FROM compliance_filing_receipts
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...keys)?.version ?? 0);
    if (latest !== data.expectedVersion) return { error: "The filing record changed. Refresh its history before saving your entry." };
    if (latest && note.length < 5) return { error: "Describe why you are adding a new filing receipt version." };
    if (latest >= 50) return { error: "This period has reached its 50-entry filing history limit." };
    const evidence = JSON.stringify({ status, confirmation, confirmedOn, documentReference, note });
    const version = latest + 1;
    db.prepare("INSERT INTO compliance_filing_receipts VALUES (?,?,?,?,?,?,?,?)").run(...keys, version, evidence, staff.email, now);
    db.prepare("INSERT INTO compliance_obligation_events VALUES (?,?,?,?,?,?,?)")
      .run(tenant, data.requestId, data.entityId, staff.email, now, request, JSON.stringify({ kind: "filingReceiptRecorded", version }));
    return read();
  }
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
      return obligationSources.flatMap(({ source }) => {
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
    const rows = db.prepare(`SELECT o.obligationId,o.period,o.version,o.status,o.internalTarget,o.snapshot,o.createdBy,o.createdAt,w.workId,w.month,
      (SELECT json_extract(r.evidence,'$.status') FROM compliance_filing_receipts r
        WHERE r.brokerageId=o.brokerageId AND r.entityId=o.entityId AND r.obligationId=o.obligationId AND r.period=o.period
        ORDER BY r.version DESC LIMIT 1) AS filingStatus
      FROM compliance_obligation_occurrences o LEFT JOIN compliance_obligation_work w
        ON w.brokerageId=o.brokerageId AND w.entityId=o.entityId AND w.obligationId=o.obligationId AND w.period=o.period
      WHERE o.brokerageId=? AND o.entityId=? AND o.obligationId=? ORDER BY o.period DESC LIMIT 51 OFFSET ?`)
      .all(tenant, data.entityId, data.id, data.offset);
    return { kind: "obligationOccurrences", items: rows.slice(0, 50).map(({ workId, month, ...row }) => {
      const { stateBasis, stateBasisChanged, draft, period, reportingBasis } = JSON.parse(String(row.snapshot)) as {
        stateBasis?: StateBasis; stateBasisChanged?: boolean; draft: ObligationDraft; period: { from: string; through: string }; reportingBasis?: ReturnType<typeof obligationReportingBasis>;
      };
      return { ...row, reportingBasis, ownerEmail: draft.ownerEmail, from: period.from, through: period.through,
        filingStatus: row.filingStatus ?? (draft.preparation ? "No confirmation recorded" : undefined), review: typeof workId === "string" && typeof month === "string" ? { entityId: data.entityId, month, itemId: workId } : undefined,
        ...(stateBasis ? { stateBasis: describeStateBasis(stateBasis), stateBasisChanged } : {}) };
    }), more: rows.length > 50, notice: obligationPlanningNotice };
  }
  if (data.operation === "list") {
    const rows = db.prepare(`SELECT v.* FROM compliance_obligation_versions v WHERE brokerageId=? AND entityId=?
      AND revision=(SELECT max(n.revision) FROM compliance_obligation_versions n WHERE n.brokerageId=v.brokerageId AND n.entityId=v.entityId AND n.id=v.id)
      ORDER BY id LIMIT 51 OFFSET ?`).all(tenant, data.entityId, data.offset);
    let currentSources: StateBasis[] | undefined;
    return { kind: "obligationRegistry", notice: obligationPlanningNotice, more: rows.length > 50, offset: data.offset,
      owners: owners.map(({ email, name }) => ({ email, name })),
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
    const snapshot = JSON.parse(String(occurrence.snapshot)) as {draft:ObligationDraft;stateBasis?:StateBasis;ownerRevision:number;revision:number;
      reportingBasis?: ReturnType<typeof obligationReportingBasis> };
    const owner = active(snapshot.draft.ownerEmail);
    if (!linked && (!owner || (owner.accessRevision ?? 0) !== snapshot.ownerRevision))
      return {error:"The period's original owner is unavailable. Review the period and assign manual monthly work to a current admin."};
    const month = String(occurrence.internalTarget).slice(0,7);
    let workId = linked ? String(linked.workId) : "";
    if (!linked) {
      const requestId = crypto.randomUUID();
      const stateNote = snapshot.stateBasis ? ` State scope version ${snapshot.stateBasis.revision}, ${snapshot.stateBasis.sourceKey}.` : "";
      const reporting = snapshot.reportingBasis;
      const routeNote = reporting ? ` Filing route: ${reporting.route}.${reporting.nominalDueOn ? ` Nominal date: ${reporting.nominalDueOn}.` : ""} ${reporting.review}` : "";
      const result = complianceProgramWork(db,{operation:"schedule",requestId,entityId:data.entityId,month,
        title:snapshot.draft.title,category:"Management review",ownerEmail:snapshot.draft.ownerEmail,
        internalTarget:String(occurrence.internalTarget),instructions:
          `Period ${data.period}; obligation version ${snapshot.revision}. ${String(occurrence.status)}. Review applicability, evidence and next steps.${stateNote}${routeNote} Source: ${snapshot.draft.sourceUrl}`.slice(0,1500)},staff,roster,now);
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
      return { error: "This workspace supports 200 obligations per entity." };
    if (data.expectedRevision >= 1000) return { error: "This obligation has reached the version limit." };
    const existingBasis = latest ? (JSON.parse(String(latest.draft)) as StoredDraft).stateBasis : undefined;
    const reference = data.stateReference;
    const stateBasis = reference ? stateSources().find(source => source.jurisdiction === reference.jurisdiction &&
      source.revision === reference.revision && source.sourceKey === reference.sourceKey) : existingBasis;
    if (reference && !stateBasis) return { error: "The state obligation source changed. Refresh sources or save a current state scope." };
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
  const period = obligationPeriod(data.period, draft.cadence, draft.internalTargetDay, draft.annualStartMonth);
  if (!period) return { error: "Choose the first month of the internal cadence period." };
  if (period.through < draft.effectiveFrom || (draft.effectiveThrough && period.from > draft.effectiveThrough))
    return { error: "This internal period falls outside the version's effective dates." };
  const existing = db.prepare("SELECT * FROM compliance_obligation_occurrences WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?")
    .get(tenant, data.entityId, data.id, data.period);
  if (existing) return record({ kind: "obligationOccurrence", occurrence: existing, reused: true, notice: obligationPlanningNotice });
  const partial = draft.effectiveFrom > period.from || Boolean(draft.effectiveThrough && draft.effectiveThrough < period.through);
  const stateBasisChanged = Boolean(stateBasis && !stateSources().some(source => matchesStateBasis(source, stateBasis)));
  const reportingBasis = obligationReportingBasis(stateBasis?.sourceKey, draft.cadence, draft.annualStartMonth, period);
  const lateTarget = Boolean(reportingBasis?.nominalDueOn && period.internalTarget > reportingBasis.nominalDueOn);
  if (reportingBasis && lateTarget) reportingBasis.review += " The internal target falls after the nominal filing date. Review the target.";
  const status = draft.applicability === "Needs review" || partial || stateBasisChanged ||
    (reportingBasis && (!reportingBasis.nominalDueOn || lateTarget) && draft.applicability !== "Not applicable") ? "Applicability review gap" :
    draft.applicability === "Not applicable" ? "Internal exclusion review recorded" : "Internal preparation planned";
  const snapshot = JSON.stringify({ draft, revision: latest.revision, reviewer: latest.reviewer, reviewedAt: latest.reviewedAt,
    ownerRevision: latest.ownerRevision, period, partialEffectivePeriod: partial,
    ...(stateBasis ? { stateBasis, stateBasisChanged } : {}), ...(reportingBasis ? { reportingBasis } : {}), notice: obligationPlanningNotice });
  db.prepare("INSERT INTO compliance_obligation_occurrences VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(tenant, data.entityId, data.id, data.period, Number(latest.revision), status, period.internalTarget, snapshot, staff.email, now);
  return record({ kind: "obligationOccurrence", occurrence: { brokerageId: tenant, entityId: data.entityId, obligationId: data.id,
    period: data.period, version: latest.revision, status, internalTarget: period.internalTarget, snapshot, createdBy: staff.email, createdAt: now },
    reused: false, notice: obligationPlanningNotice });
}

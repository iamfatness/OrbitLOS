import { easternDate } from "./client-retention";
import type { Store } from "./store";
import { complianceProgramWork } from "./compliance-program";
import { financialConditionCadenceReview, financialConditionScopeMatches, sameStateScopeFacts, stateScopeLicenseSnapshot, usesFinancialConditionScope } from "./compliance-state-basis";
import type { WorkspaceStaff } from "./staff-store";
import { workspaceFeatures, type VersionedBrokerageMember } from "./brokerage-model";
import { isObligationStateSource, obligationReportingBasis, filingArchiveRow, filingReceiptFields, obligationRequest, obligationPeriod, obligationPlanningNotice, type ObligationDraft, type ObligationRequest,
  supportsFilingReceipts, type ObligationStateSource } from "./compliance-obligations-model";
import { sourceSnapshot, stateRequirementSources } from "./compliance-research-model";
import { prepareNewYorkEmploymentWorkpaper, reviewNewYorkEmployment, type NewYorkEmploymentEvidence } from "./new-york-employment-model";
import { isNewYorkVoorSource, reviewNewYorkVoor, type NewYorkVoorEvidence } from "./new-york-voor-model";
import { coloradoRenewalReportingPeriods, reviewColoradoCompanyRenewal, type ColoradoCompanyRenewalEvidence } from "./colorado-company-renewal-model";
import { reviewIllinoisAuditEvidence, type IllinoisAuditEvidence } from "./illinois-audit-evidence-model";

import { reviewMichiganMloRenewal, type MichiganMloRenewalEvidence } from "./michigan-mlo-renewal-model";
import { michiganFilingAmendments, nmlsFilingComponent, nmlsFilingDate, reviewNmlsFiling, type MichiganFilingEvidence } from "./michigan-filing-evidence-model";

type StateBasis = ObligationStateSource & { snapshot: string };
type StoredDraft = ObligationDraft & { stateBasis?: StateBasis };
const obligationSources = stateRequirementSources.filter(item => isObligationStateSource(item.source.key));
const describeStateBasis = ({ jurisdiction, revision, sourceKey, title, authority, sourceUrl }: StateBasis): ObligationStateSource =>
  ({ jurisdiction, revision, sourceKey, title, authority, sourceUrl });
type OccurrenceSnapshot = {
  draft: ObligationDraft;
  period: NonNullable<ReturnType<typeof obligationPeriod>>;
  stateBasis?: StateBasis;
  reportingBasis?: ReturnType<typeof obligationReportingBasis>;
};
function hasNewYorkVoorEvidence(snapshot: Pick<OccurrenceSnapshot, "stateBasis" | "draft">) {
  return isNewYorkVoorSource(snapshot.stateBasis?.sourceKey) && snapshot.draft.cadence === "Annual" &&
    (snapshot.draft.annualStartMonth ?? 1) === 1 && snapshot.draft.applicability !== "Not applicable";
}

const illinoisDate = (now: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));

export function initializeComplianceObligations(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS michigan_filing_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, obligationId TEXT NOT NULL, period TEXT NOT NULL, version INTEGER NOT NULL,
    evidence TEXT NOT NULL, finding TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, correction TEXT,
    PRIMARY KEY(brokerageId,entityId,obligationId,period,version));`);
  db.exec(`CREATE TABLE IF NOT EXISTS new_york_voor_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, obligationId TEXT NOT NULL, period TEXT NOT NULL, version INTEGER NOT NULL,
    evidence TEXT NOT NULL, finding TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, correction TEXT,
    PRIMARY KEY(brokerageId,entityId,obligationId,period,version));`);
  db.exec(`CREATE TABLE IF NOT EXISTS michigan_mlo_renewal_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, obligationId TEXT NOT NULL, period TEXT NOT NULL,
    originatorNmls TEXT NOT NULL, version INTEGER NOT NULL, evidence TEXT NOT NULL, finding TEXT NOT NULL,
    actor TEXT NOT NULL, at TEXT NOT NULL, correction TEXT,
    PRIMARY KEY(brokerageId,entityId,obligationId,period,originatorNmls,version));`);
  db.exec(`CREATE TABLE IF NOT EXISTS new_york_employment_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, obligationId TEXT NOT NULL, period TEXT NOT NULL, version INTEGER NOT NULL,
    evidence TEXT NOT NULL, finding TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, correction TEXT,
    PRIMARY KEY(brokerageId,entityId,obligationId,period,version));`);
  db.exec(`CREATE TABLE IF NOT EXISTS colorado_company_renewal_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, obligationId TEXT NOT NULL, period TEXT NOT NULL, version INTEGER NOT NULL,
    evidence TEXT NOT NULL, finding TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, correction TEXT,
    PRIMARY KEY(brokerageId,entityId,obligationId,period,version));`);
  db.exec(`CREATE TABLE IF NOT EXISTS illinois_audit_evidence_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, obligationId TEXT NOT NULL, period TEXT NOT NULL, version INTEGER NOT NULL,
    evidence TEXT NOT NULL, finding TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, correction TEXT,
    PRIMARY KEY(brokerageId,entityId,obligationId,period,version));`);
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
  const active = (email: string) => roster.find(m => m.email === email && m.status === "Active" && m.role === "Admin");
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
          sourceUrl: draft.sourceUrl, authority: draft.authority,
          report: draft.preparation === "Mortgage Call Report" ? { year, quarter: Math.ceil(Number(month) / 3) } : undefined },
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
    if (!period || !supportsFilingReceipts(JSON.parse(String(period.snapshot)) as Parameters<typeof supportsFilingReceipts>[0])) return unavailable;
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
  let currentSources: StateBasis[] | undefined;
  const scopeHistory = new Map<string, Record<string, unknown>[]>();
  const currentStateBasis = (saved: StateBasis) => {
    const current = (currentSources ??= stateSources()).find(source => source.sourceKey === saved.sourceKey &&
      source.jurisdiction === saved.jurisdiction && source.snapshot === saved.snapshot);
    if (!current || current.revision < saved.revision) return false;
    if (current.revision === saved.revision) return true;
    let versions = scopeHistory.get(saved.jurisdiction);
    if (!versions) {
      versions = db.prepare(`SELECT revision,facts,entitySnapshot,licenseSnapshots,sourceSnapshots FROM compliance_state_scope_versions
        WHERE brokerageId=? AND entityId=? AND jurisdiction=? ORDER BY revision`).all(tenant, data.entityId, saved.jurisdiction);
      scopeHistory.set(saved.jurisdiction, versions);
    }
    const chain = versions.filter(row => Number(row.revision) >= saved.revision && Number(row.revision) <= current.revision);
    return chain.length === current.revision - saved.revision + 1 && chain.every((row, index) =>
      Number(row.revision) === saved.revision + index && sameStateScopeFacts(chain[0], row) &&
      (index === 0 || row.sourceSnapshots !== chain[index - 1].sourceSnapshots) &&
      (JSON.parse(String(row.sourceSnapshots)) as string[]).includes(saved.snapshot));
  };
  if (data.operation === "michiganFilingHistory" || data.operation === "saveMichiganFiling") {
    const target = [tenant, data.entityId, data.id, data.period] as const;
    const occurrence = db.prepare(`SELECT snapshot FROM compliance_obligation_occurrences
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...target);
    const snapshot = occurrence ? JSON.parse(String(occurrence.snapshot)) as OccurrenceSnapshot : null;
    const basis = snapshot?.stateBasis;
    if (!snapshot || !basis || snapshot.draft.applicability === "Not applicable") return unavailable;
    const component = nmlsFilingComponent(basis.sourceKey, snapshot.draft, snapshot.period.from);
    if (!component) return unavailable;
    const scopeMatches = financialConditionScopeMatches(db, tenant, data.entityId, basis, snapshot.draft.cadence);
    const scopeChanged = !scopeMatches || !currentStateBasis(basis);
    const nominalDueOn = scopeChanged ? null : snapshot.reportingBasis?.nominalDueOn ?? null;
    const asOf = nmlsFilingDate(now);
    if (data.operation === "michiganFilingHistory") {
      const before = data.before ?? null;
      const rows = db.prepare(`SELECT version,evidence,finding,actor,at,correction FROM michigan_filing_versions
        WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT 21`)
        .all(...target, before, before);
      const versions = rows.slice(0, 20).map(row => ({ ...row, evidence: JSON.parse(String(row.evidence)) as MichiganFilingEvidence,
        finding: JSON.parse(String(row.finding)) as ReturnType<typeof reviewNmlsFiling> }));
      return { kind: "michiganFilingHistory", component, sourceTitle: basis.title, nominalDueOn, scopeChanged, bounds: snapshot.period, versions,
        currentFinding: before === null && versions[0] ? reviewNmlsFiling(versions[0].evidence, nominalDueOn, asOf, component, snapshot.period.through, scopeChanged) : null,
        next: rows.length > 20 ? rows[19].version : null };
    }
    const request = JSON.stringify(data);
    const replay = db.prepare("SELECT actor,request,result FROM compliance_obligation_events WHERE brokerageId=? AND requestId=?").get(tenant, data.requestId);
    if (replay) return replay.actor === staff.email && replay.request === request ? JSON.parse(String(replay.result)) : changed;
    const current = db.prepare(`SELECT MAX(version) version FROM michigan_filing_versions
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...target);
    if (Number(current?.version ?? 0) !== data.expected) return changed;
    if (data.expected && !data.correction) return { error: "Record a reason for updating the filing evidence." };
    const { evidence } = data;
    const { deadline, reconciliation, submission } = evidence;
    const amendments = michiganFilingAmendments(evidence);
    if (reconciliation?.activity && component !== "Residential Mortgage Loan Activity")
      return { error: "Record the activity determination on the Residential Mortgage Loan Activity period." };
    if ((deadline && deadline.on <= snapshot.period.through) ||
      [submission?.on, ...amendments.map(item => item.on)].some(on => on && (on <= snapshot.period.through || on > asOf)) ||
      amendments.some((item, index) => !submission || item.on < (amendments[index - 1]?.on ?? submission.on)))
      return { error: "Check the deadline and the dates and order of the filing receipts." };
    if (new Set(amendments.map(item => JSON.stringify([item.on, item.reference.toLowerCase()]))).size !== amendments.length)
      return { error: "Record each amendment receipt once." };
    const version = data.expected + 1;
    const finding = reviewNmlsFiling(evidence, nominalDueOn, asOf, component, snapshot.period.through, scopeChanged);
    db.prepare("INSERT INTO michigan_filing_versions VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(...target, version, JSON.stringify(evidence), JSON.stringify(finding), staff.email, now, data.correction ?? null);
    const result = { kind: "michiganFilingSaved", version, finding, scopeChanged };
    db.prepare("INSERT INTO compliance_obligation_events VALUES (?,?,?,?,?,?,?)")
      .run(tenant, data.requestId, data.entityId, staff.email, now, request, JSON.stringify(result));
    return result;
  }
  if (data.operation === "newYorkVoorHistory" || data.operation === "saveNewYorkVoor") {
    const target = [tenant, data.entityId, data.id, data.period] as const;
    const occurrence = db.prepare(`SELECT snapshot FROM compliance_obligation_occurrences
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...target);
    const snapshot = occurrence ? JSON.parse(String(occurrence.snapshot)) as OccurrenceSnapshot : null;
    const basis = snapshot?.stateBasis;
    if (!snapshot || !basis || !hasNewYorkVoorEvidence(snapshot)) return unavailable;
    const nominalDueOn = snapshot.reportingBasis?.nominalDueOn ?? null;
    const reportYear = Number(snapshot.period.from.slice(0, 4));
    const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const scopeChanged = !currentStateBasis(basis);
    if (data.operation === "newYorkVoorHistory") {
      const before = data.before ?? null;
      const rows = db.prepare(`SELECT version,evidence,finding,actor,at,correction FROM new_york_voor_versions
        WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT 21`)
        .all(...target, before, before);
      const versions = rows.slice(0, 20).map(row => ({ ...row, evidence: JSON.parse(String(row.evidence)) as NewYorkVoorEvidence,
        finding: JSON.parse(String(row.finding)) as ReturnType<typeof reviewNewYorkVoor> }));
      return { kind: "newYorkVoorHistory", nominalDueOn, scopeChanged, reportYear, authority: basis.title, versions,
        currentFinding: before === null && versions[0] ? reviewNewYorkVoor(versions[0].evidence, nominalDueOn, asOf) : null,
        next: rows.length > 20 ? rows[19].version : null };
    }
    const request = JSON.stringify(data);
    const replay = db.prepare("SELECT actor,request,result FROM compliance_obligation_events WHERE brokerageId=? AND requestId=?").get(tenant, data.requestId);
    if (replay) return replay.actor === staff.email && replay.request === request ? JSON.parse(String(replay.result)) : changed;
    const current = db.prepare(`SELECT MAX(version) version FROM new_york_voor_versions
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...target);
    if (Number(current?.version ?? 0) !== data.expected) return changed;
    if (data.expected && !data.correction) return { error: "Record a reason for updating the filing evidence." };
    const { evidence } = data;
    const { reviewedInstructions, attestation, original, amendment } = evidence;
    if ((reviewedInstructions && reviewedInstructions.deadline <= snapshot.period.through) ||
      [attestation?.on, original?.on, amendment?.on].some(on => on && (on <= snapshot.period.through || on > asOf)) ||
      (attestation && original && attestation.on > original.on) ||
      (amendment && (!original || amendment.on < original.on)))
      return { error: "Check the report-year deadline and the dates and order of the attestation and submissions." };
    const version = data.expected + 1;
    const finding = reviewNewYorkVoor(evidence, nominalDueOn, asOf);
    db.prepare("INSERT INTO new_york_voor_versions VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(...target, version, JSON.stringify(evidence), JSON.stringify(finding), staff.email, now, data.correction ?? null);
    const result = { kind: "newYorkVoorSaved", version, finding, scopeChanged };
    db.prepare("INSERT INTO compliance_obligation_events VALUES (?,?,?,?,?,?,?)")
      .run(tenant, data.requestId, data.entityId, staff.email, now, request, JSON.stringify(result));
    return result;
  }
  if (data.operation === "michiganMloRenewalHistory" || data.operation === "saveMichiganMloRenewal") {
    const periodKey = [tenant, data.entityId, data.id, data.period] as const;
    const target = [...periodKey, data.originatorNmls] as const;
    const occurrence = db.prepare(`SELECT snapshot FROM compliance_obligation_occurrences
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...periodKey);
    const snapshot = occurrence ? JSON.parse(String(occurrence.snapshot)) as OccurrenceSnapshot : null;
    const dueOn = snapshot?.reportingBasis?.nominalDueOn;
    const basis = snapshot?.stateBasis;
    if (!snapshot || basis?.sourceKey !== "REQ-MI-LICENSING-MLO-RENEW" || !dueOn ||
      snapshot.draft.applicability === "Not applicable") return unavailable;
    const { from } = snapshot.period;
    const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const scopeChanged = !currentStateBasis(basis);
    if (data.operation === "michiganMloRenewalHistory") {
      const before = data.before ?? null;
      const rows = db.prepare(`SELECT version,evidence,finding,actor,at,correction FROM michigan_mlo_renewal_versions
        WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? AND originatorNmls=?
        AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT 21`).all(...target, before, before);
      const versions = rows.slice(0, 20).map(row => ({ ...row,
        evidence: JSON.parse(String(row.evidence)) as MichiganMloRenewalEvidence,
        finding: JSON.parse(String(row.finding)) as ReturnType<typeof reviewMichiganMloRenewal> }));
      return { kind: "michiganMloRenewalHistory", nominalDueOn: dueOn, scopeChanged, versions,
        currentFinding: before === null && versions[0] ? reviewMichiganMloRenewal(versions[0].evidence, from, dueOn, asOf) : null,
        next: rows.length > 20 ? rows[19].version : null };
    }
    const request = JSON.stringify(data);
    const replay = db.prepare("SELECT actor,request,result FROM compliance_obligation_events WHERE brokerageId=? AND requestId=?")
      .get(tenant, data.requestId);
    if (replay) return replay.actor === staff.email && replay.request === request ? JSON.parse(String(replay.result)) : changed;
    const current = db.prepare(`SELECT MAX(version) version FROM michigan_mlo_renewal_versions
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? AND originatorNmls=?`).get(...target);
    if (Number(current?.version ?? 0) !== data.expected) return changed;
    if (data.expected && !data.correction) return { error: "Record a reason for updating the renewal evidence." };
    const { education, request: submitted, regulatorStatus } = data.evidence;
    const events = [education?.on, education?.route === "First-year exception" ? education.issued.on : undefined,
      submitted?.on, regulatorStatus?.on];
    if (events.some(on => on && on > asOf)) return { error: "Record renewal events that have already occurred." };
    if ((submitted && submitted.on < from) || (regulatorStatus && regulatorStatus.on < from))
      return { error: "The renewal request and regulator status check must fall within or after the renewal year." };
    if (submitted && regulatorStatus?.status === "Renewed" && regulatorStatus.on < submitted.on)
      return { error: "The recorded renewal confirmation cannot precede the request." };
    const version = data.expected + 1;
    const finding = reviewMichiganMloRenewal(data.evidence, from, dueOn, asOf);
    db.prepare("INSERT INTO michigan_mlo_renewal_versions VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(...target, version, JSON.stringify(data.evidence), JSON.stringify(finding), staff.email, now, data.correction ?? null);
    const result = { kind: "michiganMloRenewalSaved", version, finding, scopeChanged };
    db.prepare("INSERT INTO compliance_obligation_events VALUES (?,?,?,?,?,?,?)")
      .run(tenant, data.requestId, data.entityId, staff.email, now, request, JSON.stringify(result));
    return result;
  }
  if (data.operation === "newYorkEmploymentHistory" || data.operation === "newYorkEmploymentWorkpaper" || data.operation === "saveNewYorkEmployment") {
    const target = [tenant, data.entityId, data.id, data.period] as const;
    const occurrence = db.prepare(`SELECT snapshot FROM compliance_obligation_occurrences
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...target);
    const snapshot = occurrence ? JSON.parse(String(occurrence.snapshot)) as OccurrenceSnapshot : null;
    const dueOn = snapshot?.reportingBasis?.nominalDueOn;
    if (snapshot?.stateBasis?.sourceKey !== "REQ-NY-REPORTING-QRES" || !dueOn || snapshot.draft.applicability === "Not applicable") return unavailable;
    const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const scopeChanged = !currentStateBasis(snapshot.stateBasis);
    if (data.operation === "newYorkEmploymentWorkpaper") {
      const row = db.prepare(`SELECT evidence,finding,actor,at,correction FROM new_york_employment_versions
        WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? AND version=?`).get(...target, data.version);
      if (!row) return unavailable;
      const evidence = JSON.parse(String(row.evidence)) as NewYorkEmploymentEvidence;
      const workpaper = prepareNewYorkEmploymentWorkpaper(evidence, snapshot.period);
      const gaps = [...workpaper.gaps];
      const scope = db.prepare(`SELECT entitySnapshot FROM compliance_state_scope_versions
        WHERE brokerageId=? AND entityId=? AND jurisdiction=? AND revision=?`)
        .get(tenant, data.entityId, snapshot.stateBasis.jurisdiction, snapshot.stateBasis.revision);
      const recordedEntity = scope ? JSON.parse(String(scope.entitySnapshot)) as { id: string; name: string; nmls: string } : null;
      if (!recordedEntity?.name || !recordedEntity.nmls) gaps.push("Verify the originating entity's legal name and NMLS ID.");
      if (scopeChanged) gaps.push("Review the changed source or entity scope.");
      const { activity, rosterReference, temporaryAuthorityReference, separations, notarizedReport, mailed } = evidence;
      const filingEvidence = { activity, rosterReference, temporaryAuthorityReference, separations,
        ...(notarizedReport ? { notarizedReport } : {}), ...(mailed ? { mailed } : {}) };
      return {
        kind: "newYorkEmploymentWorkpaper",
        version: data.version,
        entity: recordedEntity && { id: recordedEntity.id, name: recordedEntity.name, nmls: recordedEntity.nmls },
        obligation: { id: data.id, scopeRevision: snapshot.stateBasis.revision, sourceKey: snapshot.stateBasis.sourceKey },
        recorded: { actor: String(row.actor), at: String(row.at), correction: row.correction === null ? null : String(row.correction) },
        dueOn, ...workpaper, gaps, filingEvidence,
        recordedFinding: JSON.parse(String(row.finding)) as ReturnType<typeof reviewNewYorkEmployment>,
        source: snapshot.stateBasis.sourceUrl,
      };
    }
    if (data.operation === "newYorkEmploymentHistory") {
      const before = data.before ?? null;
      const rows = db.prepare(`SELECT version,evidence,finding,actor,at,correction FROM new_york_employment_versions
        WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT 21`)
        .all(...target, before, before);
      const versions = rows.slice(0, 20).map(row => ({ ...row, evidence: JSON.parse(String(row.evidence)) as NewYorkEmploymentEvidence,
        finding: JSON.parse(String(row.finding)) as ReturnType<typeof reviewNewYorkEmployment> }));
      return { kind: "newYorkEmploymentHistory", nominalDueOn: dueOn, scopeChanged, versions,
        currentFinding: before === null && versions[0] ? reviewNewYorkEmployment(versions[0].evidence, dueOn, asOf) : null,
        next: rows.length > 20 ? rows[19].version : null };
    }
    const request = JSON.stringify(data);
    const replay = db.prepare("SELECT actor,request,result FROM compliance_obligation_events WHERE brokerageId=? AND requestId=?").get(tenant, data.requestId);
    if (replay) return replay.actor === staff.email && replay.request === request ? JSON.parse(String(replay.result)) : changed;
    const current = db.prepare(`SELECT MAX(version) version FROM new_york_employment_versions
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...target);
    if (Number(current?.version ?? 0) !== data.expected) return changed;
    if (data.expected && !data.correction) return { error: "Record a reason for updating the employment report evidence." };
    const { evidence } = data;
    const { from, through } = snapshot.period;
    if (evidence.separations.some(item => item.event.on < from || item.event.on > through))
      return { error: "Record separations from the selected reporting quarter." };
    const rowDates = evidence.workpaperRows?.flatMap(row => [row.hiredOn, row.departedOn]) ?? [];
    if (rowDates.some(on => on && (on < from || on > through)))
      return { error: "Record hire and departure dates from the selected reporting quarter." };
    const rowKeys = evidence.workpaperRows?.map(row => JSON.stringify([row.originatorNmls, row.hiredOn, row.departedOn])) ?? [];
    if (new Set(rowKeys).size !== rowKeys.length)
      return { error: "Reconcile duplicate employment workpaper rows." };
    const events = [...rowDates, evidence.notarizedReport?.on, evidence.mailed?.on,
      ...evidence.separations.flatMap(item => [item.event.on, item.entityNotice?.on, item.individualNotice?.on])];
    if (events.some(on => on && on > asOf)) return { error: "Record events that have already occurred." };
    if (evidence.notarizedReport && evidence.notarizedReport.on < through)
      return { error: "Record the completed report on or after the quarter end." };
    const version = data.expected + 1;
    const finding = reviewNewYorkEmployment(evidence, dueOn, asOf);
    db.prepare("INSERT INTO new_york_employment_versions VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(...target, version, JSON.stringify(evidence), JSON.stringify(finding), staff.email, now, data.correction ?? null);
    const result = { kind: "newYorkEmploymentSaved", version, finding, scopeChanged };
    db.prepare("INSERT INTO compliance_obligation_events VALUES (?,?,?,?,?,?,?)")
      .run(tenant, data.requestId, data.entityId, staff.email, now, request, JSON.stringify(result));
    return result;
  }
  if (data.operation === "coloradoCompanyRenewalHistory" || data.operation === "saveColoradoCompanyRenewal") {
    const target = [tenant, data.entityId, data.id, data.period] as const;
    const occurrence = db.prepare(`SELECT snapshot FROM compliance_obligation_occurrences
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...target);
    const snapshot = occurrence ? JSON.parse(String(occurrence.snapshot)) as OccurrenceSnapshot : null;
    const basis = snapshot?.stateBasis;
    const nominalDueOn = snapshot?.reportingBasis?.nominalDueOn;
    const year = Number(data.period.slice(0, 4));
    if (!snapshot || basis?.sourceKey !== "REQ-CO-LICENSING-CO-RENEW" || !nominalDueOn || year < 2026 ||
      snapshot.draft.applicability === "Not applicable") return unavailable;
    const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const scopeChanged = !currentStateBasis(basis);
    if (data.operation === "coloradoCompanyRenewalHistory") {
      const before = data.before ?? null;
      const rows = db.prepare(`SELECT version,evidence,finding,actor,at,correction FROM colorado_company_renewal_versions
        WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT 21`)
        .all(...target, before, before);
      const versions = rows.slice(0, 20).map(row => ({ ...row, evidence: JSON.parse(String(row.evidence)) as ColoradoCompanyRenewalEvidence,
        finding: JSON.parse(String(row.finding)) as ReturnType<typeof reviewColoradoCompanyRenewal> }));
      return { kind: "coloradoCompanyRenewalHistory", nominalDueOn, scopeChanged, versions,
        currentFinding: before === null && versions[0] ? reviewColoradoCompanyRenewal(versions[0].evidence, year, asOf) : null,
        next: rows.length > 20 ? rows[19].version : null };
    }
    const request = JSON.stringify(data);
    const replay = db.prepare("SELECT actor,request,result FROM compliance_obligation_events WHERE brokerageId=? AND requestId=?").get(tenant, data.requestId);
    if (replay) return replay.actor === staff.email && replay.request === request ? JSON.parse(String(replay.result)) : changed;
    const current = db.prepare(`SELECT MAX(version) version FROM colorado_company_renewal_versions
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...target);
    if (Number(current?.version ?? 0) !== data.expected) return changed;
    if (data.expected && !data.correction) return { error: "Record a reason for updating the renewal evidence." };
    const { evidence } = data;
    const periods = coloradoRenewalReportingPeriods(year, evidence.classification);
    for (const row of evidence.receipts) {
      const period = periods.find(item => item.component === row.component && item.period === row.period);
      if (!period) return { error: "Match the filing component and period to the selected reporting classification." };
      const reportEnd = row.component === "Financial Condition" && evidence.classification === "Broker only" ? evidence.priorFiscalYearEnd : period.through;
      if (row.disposition.status === "Filed" && ((reportEnd && row.disposition.receipt.on < reportEnd) || row.disposition.receipt.on > asOf))
        return { error: "Record a filing receipt dated on or after period end and on or before today." };
    }
    if (evidence.olderDeficiencies?.some(({ identified, clearance }) =>
      identified.on > asOf || (clearance && (clearance.on < identified.on || clearance.on > asOf))))
      return { error: "Check the dates and order of older filing deficiencies and clearance evidence." };
    const { renewalRequest, regulatorStatus } = evidence;
    if ([renewalRequest?.on, regulatorStatus?.on].some(on => on && (on < snapshot.period.from || on > asOf)) ||
      (renewalRequest && regulatorStatus?.status === "Renewed" && regulatorStatus.on < renewalRequest.on))
      return { error: "Check the dates and order of the renewal request and regulator status." };
    const version = data.expected + 1;
    const finding = reviewColoradoCompanyRenewal(evidence, year, asOf);
    db.prepare("INSERT INTO colorado_company_renewal_versions VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(...target, version, JSON.stringify(evidence), JSON.stringify(finding), staff.email, now, data.correction ?? null);
    const result = { kind: "coloradoCompanyRenewalSaved", version, finding, scopeChanged };
    db.prepare("INSERT INTO compliance_obligation_events VALUES (?,?,?,?,?,?,?)")
      .run(tenant, data.requestId, data.entityId, staff.email, now, request, JSON.stringify(result));
    return result;
  }
  if (data.operation === "illinoisAuditHistory" || data.operation === "saveIllinoisAudit") {
    const target = [tenant, data.entityId, data.id, data.period] as const;
    const occurrence = db.prepare(`SELECT snapshot FROM compliance_obligation_occurrences
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...target);
    const snapshot = occurrence ? JSON.parse(String(occurrence.snapshot)) as OccurrenceSnapshot : null;
    if (snapshot?.stateBasis?.sourceKey !== "REQ-IL-REPORTING-ANNUAL-AUDIT" ||
      !snapshot.reportingBasis?.nominalDueOn || snapshot.draft.applicability === "Not applicable") return unavailable;
    const asOf = illinoisDate(now);
    if (data.operation === "illinoisAuditHistory") {
      const before = data.before ?? null;
      const rows = db.prepare(`SELECT version,evidence,finding,actor,at,correction FROM illinois_audit_evidence_versions
        WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT 21`)
        .all(...target, before, before);
      const versions = rows.slice(0, 20).map(row => ({ ...row, evidence: JSON.parse(String(row.evidence)) as IllinoisAuditEvidence,
        finding: JSON.parse(String(row.finding)) as ReturnType<typeof reviewIllinoisAuditEvidence> }));
      return { kind: "illinoisAuditHistory", nominalDueOn: snapshot.reportingBasis.nominalDueOn, versions,
        currentFinding: before === null && versions[0] ? reviewIllinoisAuditEvidence(versions[0].evidence, asOf) : null,
        next: rows.length > 20 ? rows[19].version : null };
    }
    const request = JSON.stringify(data);
    const replay = db.prepare("SELECT actor,request,result FROM compliance_obligation_events WHERE brokerageId=? AND requestId=?")
      .get(tenant, data.requestId);
    if (replay) return replay.actor === staff.email && replay.request === request ? JSON.parse(String(replay.result)) : changed;
    const current = db.prepare(`SELECT MAX(version) version FROM illinois_audit_evidence_versions
      WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=?`).get(...target);
    if (Number(current?.version ?? 0) !== data.expected) return changed;
    if (data.expected && !data.correction) return { error: "Record a reason for updating the audit evidence." };
    const { evidence } = data;
    const events = [evidence.extension?.request.on, evidence.extension?.decision?.on, evidence.filing?.on];
    if (events.some(on => on && on > asOf)) return { error: "Record audit events that have already occurred." };
    if (evidence.originalDeadline.on < snapshot.period.through || (evidence.filing && evidence.filing.on < snapshot.period.through))
      return { error: "The audit deadline and filing must fall on or after the fiscal year end." };
    const version = data.expected + 1;
    const finding = reviewIllinoisAuditEvidence(evidence, asOf);
    db.prepare("INSERT INTO illinois_audit_evidence_versions VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(...target, version, JSON.stringify(evidence), JSON.stringify(finding), staff.email, now, data.correction ?? null);
    const result = { kind: "illinoisAuditSaved", version, finding };
    db.prepare("INSERT INTO compliance_obligation_events VALUES (?,?,?,?,?,?,?)")
      .run(tenant, data.requestId, data.entityId, staff.email, now, request, JSON.stringify(result));
    return result;
  }
  if (data.operation === "occurrences") {
    const asOf = illinoisDate(now);
    const rows = db.prepare(`SELECT o.obligationId,o.period,o.version,o.status,o.internalTarget,o.snapshot,o.createdBy,o.createdAt,w.workId,w.month,
      (SELECT json_extract(r.evidence,'$.status') FROM compliance_filing_receipts r
        WHERE r.brokerageId=o.brokerageId AND r.entityId=o.entityId AND r.obligationId=o.obligationId AND r.period=o.period
        ORDER BY r.version DESC LIMIT 1) AS filingStatus,
      (SELECT a.evidence FROM illinois_audit_evidence_versions a
        WHERE a.brokerageId=o.brokerageId AND a.entityId=o.entityId AND a.obligationId=o.obligationId AND a.period=o.period
        ORDER BY a.version DESC LIMIT 1) AS auditEvidence
      FROM compliance_obligation_occurrences o LEFT JOIN compliance_obligation_work w
        ON w.brokerageId=o.brokerageId AND w.entityId=o.entityId AND w.obligationId=o.obligationId AND w.period=o.period
      WHERE o.brokerageId=? AND o.entityId=? AND o.obligationId=? ORDER BY o.period DESC LIMIT 51 OFFSET ?`)
      .all(tenant, data.entityId, data.id, data.offset);
    return { kind: "obligationOccurrences", items: rows.slice(0, 50).map(({ workId, month, auditEvidence, ...row }) => {
      const { stateBasis, stateBasisChanged, draft, period, reportingBasis } = JSON.parse(String(row.snapshot)) as {
        stateBasis?: StateBasis; stateBasisChanged?: boolean; draft: ObligationDraft; period: { from: string; through: string }; reportingBasis?: ReturnType<typeof obligationReportingBasis>;
      };
      const illinoisAudit = stateBasis?.sourceKey === "REQ-IL-REPORTING-ANNUAL-AUDIT" &&
        Boolean(reportingBasis?.nominalDueOn) && draft.applicability !== "Not applicable";
      const audit = illinoisAudit && typeof auditEvidence === "string"
        ? reviewIllinoisAuditEvidence(JSON.parse(auditEvidence) as IllinoisAuditEvidence, asOf) : undefined;
      const cadenceConflict = reportingBasis && stateBasis && draft.applicability !== "Not applicable" &&
        !financialConditionScopeMatches(db, tenant, data.entityId, stateBasis, draft.cadence);
      const nmlsFiling = draft.applicability !== "Not applicable" && Boolean(nmlsFilingComponent(stateBasis?.sourceKey ?? "", draft, period.from));
      const priorFilingBasis = Boolean(nmlsFiling && stateBasis && !currentStateBasis(stateBasis));
      return { ...row, ...((cadenceConflict || priorFilingBasis) && { status: "Applicability review gap" }), priorFilingBasis,
        reportingBasis: cadenceConflict ? { ...reportingBasis, nominalDueOn: null, review: financialConditionCadenceReview } : reportingBasis,
        illinoisAudit, newYorkVoor: hasNewYorkVoorEvidence({ draft, stateBasis }),
        nmlsFiling,
        coloradoCompanyRenewal: stateBasis?.sourceKey === "REQ-CO-LICENSING-CO-RENEW" &&
          Boolean(reportingBasis?.nominalDueOn) && draft.applicability !== "Not applicable",
        newYorkEmployment: stateBasis?.sourceKey === "REQ-NY-REPORTING-QRES" &&
          Boolean(reportingBasis?.nominalDueOn) && draft.applicability !== "Not applicable",
        michiganMloRenewal: stateBasis?.sourceKey === "REQ-MI-LICENSING-MLO-RENEW" &&
          Boolean(reportingBasis?.nominalDueOn) && draft.applicability !== "Not applicable",
        audit: audit && {
        dueOn: audit.dueOn, extensionStatus: audit.extensionStatus, filingStatus: audit.filingStatus,
      }, ownerEmail: draft.ownerEmail, from: period.from, through: period.through,
        filingStatus: row.filingStatus ?? (draft.preparation ? "No confirmation recorded" : undefined), review: typeof workId === "string" && typeof month === "string" ? { entityId: data.entityId, month, itemId: workId } : undefined,
        ...(stateBasis ? { stateBasis: describeStateBasis(stateBasis), stateBasisChanged } : {}) };
    }), more: rows.length > 50, notice: obligationPlanningNotice };
  }
  if (data.operation === "list") {
    const rows = db.prepare(`SELECT v.* FROM compliance_obligation_versions v WHERE brokerageId=? AND entityId=?
      AND revision=(SELECT max(n.revision) FROM compliance_obligation_versions n WHERE n.brokerageId=v.brokerageId AND n.entityId=v.entityId AND n.id=v.id)
      ORDER BY id LIMIT 51 OFFSET ?`).all(tenant, data.entityId, data.offset);
    return { kind: "obligationRegistry", notice: obligationPlanningNotice, more: rows.length > 50, offset: data.offset,
      owners: roster.filter(member => member.status === "Active" && member.role === "Admin")
        .map(({ email, name }) => ({ email, name: name || email })),
      items: rows.slice(0, 50).map(row => {
        const { stateBasis, ...draft } = JSON.parse(String(row.draft)) as StoredDraft;
        const owner = active(draft.ownerEmail);
        return { id: row.id, revision: row.revision, draft, reviewer: row.reviewer, reviewedAt: row.reviewedAt,
          ...(stateBasis ? { stateBasis: describeStateBasis(stateBasis),
            stateBasisChanged: !currentStateBasis(stateBasis) } : {}),
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
      const cadenceConflict = reporting && snapshot.stateBasis && snapshot.draft.applicability !== "Not applicable" &&
        !financialConditionScopeMatches(db, tenant, data.entityId, snapshot.stateBasis, snapshot.draft.cadence);
      const routeNote = reporting ? ` Filing route: ${reporting.route}.${reporting.nominalDueOn && !cadenceConflict ? ` Nominal date: ${reporting.nominalDueOn}.` : ""} ${cadenceConflict ? financialConditionCadenceReview : reporting.review}` : "";
      const status = cadenceConflict ? "Applicability review gap" : String(occurrence.status);
      const result = complianceProgramWork(db,{operation:"schedule",requestId,entityId:data.entityId,month,
        title:snapshot.draft.title,
        category:/^REQ-[A-Z]{2}-LICENSING-.+-(?:RENEW|RNW)$/.test(snapshot.stateBasis?.sourceKey ?? "") ? "License review" : "Management review",
        ownerEmail:snapshot.draft.ownerEmail,
        internalTarget:String(occurrence.internalTarget),instructions:
          `Period ${data.period}; obligation version ${snapshot.revision}. ${status}. Review applicability, evidence and next steps.${stateNote}${routeNote} Source: ${snapshot.draft.sourceUrl}`.slice(0,1500)},staff,roster,now);
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
  const stateBasisChanged = Boolean(stateBasis && !currentStateBasis(stateBasis));
  const reportingBasis = obligationReportingBasis(stateBasis?.sourceKey, draft.cadence, draft.annualStartMonth, period);
  const cadenceConflict = reportingBasis && stateBasis && draft.applicability !== "Not applicable" &&
    !financialConditionScopeMatches(db, tenant, data.entityId, stateBasis, draft.cadence);
  if (reportingBasis && cadenceConflict) {
    reportingBasis.nominalDueOn = null;
    reportingBasis.review = financialConditionCadenceReview;
  } else if (reportingBasis && stateBasisChanged && stateBasis && usesFinancialConditionScope(stateBasis.sourceKey)) {
    reportingBasis.nominalDueOn = null;
  }
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

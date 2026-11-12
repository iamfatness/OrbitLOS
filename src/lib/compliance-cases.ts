import { programRequest } from "./compliance-program-model";
import { tridRequest } from "./trid-model";
import { tridEvidenceWork } from "./trid-evidence";
import { brokerAgreementRequest } from "./state-broker-agreement-model";
import { stateBrokerAgreementWork } from "./state-broker-agreement";
import { refinanceBenefitRequest } from "./state-refinance-benefit-model";
import { stateRefinanceBenefitWork } from "./state-refinance-benefit";
import { obligationRequest } from "./compliance-obligations-model";
import { complianceObligationsWork } from "./compliance-obligations";
import { learningRequest } from "./compliance-learning-model";
import { complianceLearningWork } from "./compliance-learning";
import { complianceProgramWork } from "./compliance-program";
import { stateScopeRequest } from "./compliance-state-scope-model";
import { complianceStateScopeWork } from "./compliance-state-scope";
import { stateReadinessRequest } from "./compliance-state-readiness-model";
import { complianceStateReadinessWork } from "./compliance-state-readiness";
import { z } from "zod";
import { researchRequest } from "./compliance-research-model";
import { complianceResearchWork } from "./compliance-research";
import type { VersionedBrokerageMember } from "./brokerage-model";
import { complianceAttention, complianceCaseKinds as kinds, complianceCaseStatuses as statuses, complianceWorkUnavailable,
  sampleReviewDecisions, type ComplianceAttention } from "./compliance-case-model";
import { initializeComplianceInventory } from "./compliance-case-store";
import { advanceInventory, currentPackage, inventoryAdvance, inventoryRead, readInventory, samplePackage, sampleWorkbenchReview } from "./compliance-inventory";
import { advanceLeadBackfill, initializeComplianceLeadBackfill, leadBackfillAdvance, leadBackfillRead, readLeadBackfill } from "./compliance-lead-backfill";
import { evaluateSampleReceipt, lastSampleReceiptEvaluation, sampleReceiptBasis, sampleReceiptEvaluation, sampleReceiptFingerprint } from "./sample-receipt-check";
import { workspaceFeatures } from "./brokerage-model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { loanAccess } from "./workspace-access";

const id = z.string().min(1).max(100);
const revision = z.number().int().positive();
const change = { caseId: z.uuid(), expectedRevision: revision, requestId: z.uuid() };
const decisionFields = {
  decision: z.enum(sampleReviewDecisions), packageRevision: revision, submissionRevision: revision,
  reason: z.string().trim().min(1).max(1000),
};
const cursor = z.object({ id: z.uuid(), openedAt: z.iso.datetime(), cohort: z.string().max(800), snapshot: z.number().int().nonnegative() });
const dailyCursor = z.strictObject({ id: z.uuid(), openedAt: z.iso.datetime(), snapshot: z.string().max(500) });
const request = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("stateScope"), input: stateScopeRequest }),
  z.strictObject({ type: z.literal("stateReadiness"), input: stateReadinessRequest }),
  z.strictObject({ type: z.literal("trid"), input: tridRequest }),
  z.strictObject({ type: z.literal("stateBrokerAgreement"), input: brokerAgreementRequest }),
  z.strictObject({ type: z.literal("stateRefinanceBenefit"), input: refinanceBenefitRequest }),
  z.strictObject({ type: z.literal("obligations"), input: obligationRequest }),
  z.strictObject({ type: z.literal("learning"), input: learningRequest }),
  z.strictObject({ type: z.literal("program"), input: programRequest }),
  z.strictObject({ type: z.literal("research"), input: researchRequest }),
  z.strictObject({ type: z.literal("list"), loanId: id.optional(), kind: z.enum(kinds).optional(), status: z.enum(statuses).optional(),
    attention: z.enum(complianceAttention).optional(), after: cursor.optional() }),
  z.strictObject({ type: z.literal("overview") }),
  z.strictObject({ type: z.literal("daily"), view: z.enum(["mine", "review"]), after: dailyCursor.optional() }),
  z.strictObject({ type: z.literal("read"), caseId: z.uuid(), loanId: id.optional() }),
  z.strictObject({ type: z.literal("openFixture"), loanId: id, packageVersion: revision }),
  z.strictObject({ type: z.literal("assign"), ...change, ownerEmail: z.email() }),
  z.strictObject({ type: z.literal("updateStatus"), ...change, status: z.enum(statuses) }),
  z.strictObject({ type: z.literal("submitForReview"), ...change, packageRevision: revision, note: z.string().trim().min(1).max(1000) }),
  z.strictObject({ type: z.literal("decideReview"), ...change, ...decisionFields }),
  z.strictObject({ type: z.literal("recordEvidenceNote"), ...change, packageRevision: revision,
    source: z.string().trim().min(1).max(120), note: z.string().trim().min(1).max(1000) }),
  z.strictObject({ type: z.literal("recordSampleReview"), ...change, packageRevision: revision }),
  z.strictObject({ type: z.literal("evaluateSampleReceipt"), ...change, packageRevision: revision, fingerprint: sampleReceiptFingerprint }),
  inventoryRead,
  inventoryAdvance,
  leadBackfillRead,
  leadBackfillAdvance,
]);

type ComplianceRequest = z.infer<typeof request>;
type Member = VersionedBrokerageMember;
type Case = {
  id: string; kind: (typeof kinds)[number]; title: string; status: (typeof statuses)[number];
  loanId: string | null; packageVersion: number | null; parentCaseId: string | null;
  ownerEmail: string; ownerAccessRevision: number; revision: number; openedAt: string; updatedAt: string;
};
type CaseEvent = { revision: number; actor: string; at: string; action: string; payload: string };

const columns = `id, kind, title, status, loanId, packageVersion, parentCaseId,
  ownerEmail, ownerAccessRevision, revision, openedAt, updatedAt`;
const pageSize = 20;
const unavailable = { error: complianceWorkUnavailable };
const changed = { error: "This compliance case changed. Reopen it before saving." };
const coverage = { state: "Not evaluated", evaluatedFiles: 0, eligibleFiles: null, mode: "Fictional fixture", approval: "None" } as const;
const submissionPayload = z.object({ request: z.object({ note: z.string(), packageRevision: revision }) });
const evidencePayload = z.object({ request: z.object({ source: z.string(), note: z.string(), packageRevision: revision }) });
const decisionPayload = z.object({ request: z.object(decisionFields) });
const evaluationPayload = z.object({ sampleEvaluation: sampleReceiptEvaluation });

function currentMember(roster: readonly Member[], email: string) {
  return roster.find((member) => member.email === email && member.status === "Active");
}

function mayOwn(db: Store, staff: WorkspaceStaff, member: Member, loanId: string | null) {
  return member.role === "Admin" || Boolean(loanId && loanAccess(db, { ...staff, email: member.email,
    brokerage: { ...staff.brokerage, role: member.role } }, loanId));
}

const activeMembers = `active AS (
  SELECT value ->> 'email' AS email, value ->> 'role' AS role, value ->> 'rev' AS rev, key AS priority FROM json_each(?)
)`;
const validOwner = `owner.role = 'Admin' OR (owner.role = 'LO' AND loan.officerEmail = owner.email)
  OR (owner.role = 'Processor' AND processing.processorEmail = owner.email)`;
const activeOwner = `LEFT JOIN active owner ON owner.email = finding.ownerEmail AND owner.rev = finding.ownerAccessRevision`;
const processingJoin = `LEFT JOIN loan_processing processing ON processing.loanId = finding.loanId`;

function rosterInput(roster: readonly Member[]) {
  return JSON.stringify(roster.filter(({ status }) => status === "Active")
    .map(({ email, role, accessRevision }) => ({ email, role, rev: accessRevision ?? 0 })));
}

function fileFindings(roster: readonly Member[], brokerageId: string) {
  return {
    sql: `WITH ${activeMembers}, findings AS (
      SELECT finding.*, finding.rowid AS sequence, contact.name AS borrower,
        CASE WHEN ${validOwner} THEN 0 ELSE 1 END AS needsOwner,
        CASE WHEN ${validOwner} THEN owner.email
          ELSE (SELECT email FROM active WHERE role = 'Admin' AND email <> finding.ownerEmail ORDER BY priority LIMIT 1)
        END AS assignedTo
      FROM compliance_cases finding
      JOIN loans loan ON loan.id = finding.loanId JOIN contacts contact ON contact.id = loan.contactId
      ${processingJoin}
      ${activeOwner}
      WHERE finding.brokerageId = ? AND finding.confidentiality = 'General' AND finding.kind = 'Operational finding'
    )`,
    args: [rosterInput(roster), brokerageId],
  };
}

const attentionFilter: Record<ComplianceAttention, string> = {
  review: "status = 'Awaiting review'",
  evidence: "status = 'Awaiting evidence'",
  ownership: "needsOwner = 1",
};

function ownerFileFindings(db: Store, staff: WorkspaceStaff, roster: readonly Member[]) {
  const scope = fileFindings(roster, staff.brokerage.id);
  const rows = db.prepare(`${scope.sql} SELECT id,loanId,borrower,title,status,ownerEmail,needsOwner,count(*) OVER () AS total
    FROM findings ORDER BY needsOwner DESC,openedAt,id LIMIT 8`).all(...scope.args);
  return {
    total: Number(rows[0]?.total ?? 0),
    items: rows.map(row => ({
      id: String(row.id), loanId: String(row.loanId), borrower: String(row.borrower), title: String(row.title), status: String(row.status),
      ownerName: Number(row.needsOwner) ? null : currentMember(roster, String(row.ownerEmail))?.name ?? null,
    })),
  };
}

function overview(db: Store, staff: WorkspaceStaff, roster: readonly Member[], now: string) {
  if (staff.brokerage.role !== "Admin") return unavailable;
  const scope = fileFindings(roster, staff.brokerage.id);
  const counts = db.prepare(`${scope.sql} SELECT count(*) AS cases, count(DISTINCT loanId) AS files,
    ${complianceAttention.map((key) => `count(CASE WHEN ${attentionFilter[key]} THEN 1 END) AS ${key}Cases,
      count(DISTINCT CASE WHEN ${attentionFilter[key]} THEN loanId END) AS ${key}Files`).join(", ")}
    FROM findings`).get(...scope.args)!;
  const inventoryExists = db.prepare("SELECT 1 FROM settings WHERE key = 'complianceInventorySchema:1'").get();
  const inventory = inventoryExists ? readInventory(db, staff.brokerage.id, { type: "inventory" }) : null;
  const fileTotal = Number(db.prepare("SELECT count(*) AS total FROM loans").get()?.total);
  return { kind: "overview", coverage, checkedAt: now, fileTotal,
    findings: { cases: Number(counts.cases), files: Number(counts.files) },
    attention: complianceAttention.map((key) => ({ key, cases: Number(counts[`${key}Cases`]), files: Number(counts[`${key}Files`]) })),
    inventory: inventory && "kind" in inventory ? { state: inventory.state, scanned: inventory.scanned, asOf: inventory.asOf } :
      { state: "Not started", scanned: null, asOf: null },
  } as const;
}

function projection(db: Store, staff: WorkspaceStaff, roster: readonly Member[], item: Case) {
  const { ownerAccessRevision, ownerEmail, parentCaseId, ...row } = item;
  const owner = currentMember(roster, ownerEmail);
  const stillAssigned = owner && (owner.accessRevision ?? 0) === ownerAccessRevision && mayOwn(db, staff, owner, item.loanId);
  const backup = roster.find((member) => member.status === "Active" && member.role === "Admin" && member.email !== ownerEmail);
  const accountable = stillAssigned ? owner : backup;
  return { ...row, ownerEmail: accountable?.email ?? null, ownerName: accountable?.name ?? null,
    ownerState: stillAssigned ? "Assigned" : backup ? "Backup review" : "Needs assignment",
    parentCaseId: staff.brokerage.role === "Admin" && parentCaseId && findCase(db, staff.brokerage.id, parentCaseId) ? parentCaseId : null,
    source: "Fictional fixture", applicability: "Unknown", coverage: "Not approved", evaluation: "Not evaluated" } as const;
}

function findCase(db: Store, brokerageId: string, caseId: string) {
  return db.prepare(`SELECT ${columns} FROM compliance_cases WHERE brokerageId = ? AND id = ? AND confidentiality = 'General'`)
    .get(brokerageId, caseId) as Case | undefined;
}

function currentReviewSubmission(db: Store, brokerageId: string, item: Case, packageRevision: SqlValue) {
  if (item.status !== "Awaiting review") return undefined;
  return db.prepare(`SELECT revision, actor, at, json_extract(payload, '$.request.note') AS note FROM compliance_case_events
    WHERE brokerageId = ? AND caseId = ? AND action = 'submitForReview' AND json_extract(payload, '$.request.packageRevision') = ?
      AND revision > coalesce((SELECT max(revision) FROM compliance_case_events
        WHERE brokerageId = ? AND caseId = ? AND (action = 'decideReview'
          OR (action = 'updateStatus' AND json_extract(payload, '$.request.status') <> 'Awaiting review'))), 0)
    ORDER BY revision DESC LIMIT 1`).get(brokerageId, item.id, packageRevision, brokerageId, item.id);
}

function lastReviewDecision(db: Store, brokerageId: string, item: Case) {
  const row = db.prepare(`SELECT revision, actor, at, payload FROM compliance_case_events
    WHERE brokerageId = ? AND caseId = ? AND action = 'decideReview' ORDER BY revision DESC LIMIT 1`).get(brokerageId, item.id);
  if (typeof row?.payload !== "string") return null;
  const parsed = decisionPayload.safeParse(JSON.parse(row.payload));
  return parsed.success ? { ...parsed.data.request, revision: Number(row.revision), actor: String(row.actor), at: String(row.at) } : null;
}

function detail(db: Store, staff: WorkspaceStaff, roster: readonly Member[], item: Case) {
  const history = db.prepare(`SELECT revision, actor, at, action, payload FROM compliance_case_events
    WHERE brokerageId = ? AND caseId = ? ORDER BY revision DESC LIMIT 51`).all(staff.brokerage.id, item.id) as unknown as CaseEvent[];
  const packageRow = item.loanId ? currentPackage(db, item.loanId) : undefined;
  const packageState = !item.loanId ? null : !packageRow ? "Unavailable" :
    packageRow.version !== item.packageVersion || packageRow.supersededAt ? "Superseded" :
      packageRow.reviewReason ? "Needs review" : samplePackage(db, item.loanId) ? "Current" : "Outside sample scope";
  const currentPackageRevision = packageState === "Current" && typeof packageRow?.revision === "number" ? packageRow.revision : null;
  const currentCheck = item.loanId && item.packageVersion && currentPackageRevision !== null ?
    evaluateSampleReceipt(sampleReceiptBasis(db, { brokerageId: staff.brokerage.id, caseId: item.id, loanId: item.loanId },
      item.packageVersion, currentPackageRevision)) : null;
  const sampleReviewRevision = currentCheck?.basis.workbenchReview ? currentPackageRevision : null;
  const sampleReview = currentCheck?.outcome === "Sample evidence matches" ? currentCheck.basis.caseEvidence : null;
  const savedCheck = item.loanId ? lastSampleReceiptEvaluation(db, staff.brokerage.id, item.id) : null;
  const projected = projection(db, staff, roster, item);
  const admin = staff.brokerage.role === "Admin";
  const canUpdateStatus = admin || (projected.ownerState === "Assigned" && projected.ownerEmail === staff.email);
  const submitted = packageState === "Current" && packageRow ? currentReviewSubmission(db, staff.brokerage.id, item, packageRow.revision) : undefined;
  const decision = item.loanId ? lastReviewDecision(db, staff.brokerage.id, item) : null;
  return { kind: "detail", item: projected, packageState, coverage, sampleReviewRevision,
    canUpdateStatus: canUpdateStatus && !submitted,
    submitPackageRevision: canUpdateStatus && !submitted ? currentPackageRevision : null,
    evidencePackageRevision: canUpdateStatus ? currentPackageRevision : null,
    reviewSubmission: submitted ? { revision: Number(submitted.revision), packageRevision: currentPackageRevision,
      actor: String(submitted.actor), at: String(submitted.at), note: String(submitted.note) } : null,
    canDecideReview: admin && Boolean(submitted),
    reviewDecision: decision && decision.packageRevision === currentPackageRevision ? decision : null,
    sampleReceiptCheck: item.loanId ? {
      ready: currentCheck && canUpdateStatus ? { packageRevision: currentCheck.basis.packageRevision, fingerprint: currentCheck.fingerprint } : null,
      latest: savedCheck ? { ...savedCheck, current: savedCheck.fingerprint === currentCheck?.fingerprint } : null,
    } : null,
    assignableOwners: admin ? roster.filter((member) => member.status === "Active" && mayOwn(db, staff, member, item.loanId))
      .map(({ email, name }) => ({ email, name })) : [],
    sampleReview: sampleReview ? { actor: sampleReview.recordedBy, at: sampleReview.recordedAt,
      packageRevision: currentPackageRevision, mode: "Sample workbench review" } : null,
    history: history.slice(0, 50).map((event) => {
      const payload: unknown = JSON.parse(event.payload);
      const submission = event.action === "submitForReview" ? submissionPayload.safeParse(payload) : undefined;
      const evidence = event.action === "recordEvidenceNote" ? evidencePayload.safeParse(payload) : undefined;
      const decision = event.action === "decideReview" ? decisionPayload.safeParse(payload) : undefined;
      const evaluation = event.action === "evaluateSampleReceipt" ? evaluationPayload.safeParse(payload) : undefined;
      return { ...event, payload, reviewNote: submission?.success ? submission.data.request.note : null,
        reviewPackageRevision: submission?.success ? submission.data.request.packageRevision : null,
        evidenceNote: evidence?.success ? evidence.data.request : null,
        reviewDecision: decision?.success ? decision.data.request : null,
        sampleEvaluation: evaluation?.success ? evaluation.data.sampleEvaluation : null };
    }),
    moreHistory: history.length > 50 } as const;
}

function daily(db: Store, staff: WorkspaceStaff, roster: readonly Member[], data: Extract<ComplianceRequest, { type: "daily" }>) {
  const { view, after } = data;
  if (view === "review" && staff.brokerage.role !== "Admin") return unavailable;
  const findings = fileFindings(roster, staff.brokerage.id);
  const scope = `${findings.sql}, work AS (SELECT * FROM findings WHERE
    ${view === "review" ? attentionFilter.review : "status <> 'Awaiting review' AND assignedTo = ?"})`;
  const args = [...findings.args, ...(view === "mine" ? [staff.email] : [])];
  const counts = db.prepare(`${scope} SELECT count(*) AS cases, count(DISTINCT loanId) AS files,
    total(revision) AS revisions, total(sequence) AS sequences, max(updatedAt) AS newest FROM work`).get(...args)!;
  const snapshot = JSON.stringify([view, staff.brokerage.id, staff.email, staff.brokerage.role, staff.brokerage.accessRevision ?? 0,
    counts.cases, counts.files, counts.revisions, counts.sequences, counts.newest]);
  if (after && (after.snapshot !== snapshot ||
    !db.prepare(`${scope} SELECT 1 FROM work WHERE id = ? AND openedAt = ?`).get(...args, after.id, after.openedAt))) {
    return { error: "This compliance work changed. Reload the first page." };
  }
  const rows = db.prepare(`${scope} SELECT ${columns}, borrower FROM work
    ${after ? "WHERE (openedAt < ? OR (openedAt = ? AND id > ?))" : ""} ORDER BY openedAt DESC, id LIMIT ?`)
    .all(...args, ...(after ? [after.openedAt, after.openedAt, after.id] : []), pageSize + 1) as unknown as (Case & { borrower: string })[];
  const items = rows.slice(0, pageSize).map(({ borrower, ...item }) => ({ ...projection(db, staff, roster, item), borrower }));
  const last = items.at(-1);
  return { kind: "daily", counts: { cases: Number(counts.cases), files: Number(counts.files) }, items,
    next: last && rows.length > pageSize ? { id: last.id, openedAt: last.openedAt, snapshot } : null } as const;
}

function list(db: Store, staff: WorkspaceStaff, roster: readonly Member[], data: Extract<ComplianceRequest, { type: "list" }>) {
  const { loanId, kind, status, attention, after } = data;
  if (staff.brokerage.role !== "Admin" && (!loanId || !loanAccess(db, staff, loanId))) return unavailable;
  if (attention && (staff.brokerage.role !== "Admin" || loanId || kind || status)) return unavailable;
  const findings = attention ? fileFindings(roster, staff.brokerage.id) : undefined;
  const cte = findings?.sql ?? "";
  const source = findings ? "findings" : "compliance_cases";
  const scope = findings && attention ? attentionFilter[attention] :
    `brokerageId = ? AND confidentiality = 'General' ${loanId ? "AND loanId = ?" : ""} ${kind ? "AND kind = ?" : ""} ${status ? "AND status = ?" : ""}`;
  const args: SqlValue[] = findings?.args ?? [staff.brokerage.id, ...(loanId ? [loanId] : []), ...(kind ? [kind] : []), ...(status ? [status] : [])];
  const position = findings ? "sequence" : "rowid";
  const count = db.prepare(`${cte} SELECT count(*) AS cases, count(DISTINCT loanId) AS files, coalesce(sum(revision), 0) AS version,
    total(${position}) AS positionSum, total(${position} * ${position}) AS positionSquares FROM ${source} WHERE ${scope}`).get(...args)!;
  const snapshot = Number(count.version);
  const cohort = JSON.stringify([staff.brokerage.id, staff.email, staff.brokerage.role, staff.brokerage.accessRevision ?? 0, loanId, kind,
    status, attention, count.cases, count.positionSum, count.positionSquares]);
  if (after && (after.cohort !== cohort || after.snapshot !== snapshot ||
    !db.prepare(`${cte} SELECT 1 FROM ${source} WHERE ${scope} AND id = ? AND openedAt = ?`).get(...args, after.id, after.openedAt))) {
    return { error: "This queue changed. Reload the first page." };
  }
  const rows = db.prepare(`${cte} SELECT ${columns}, ${findings ? "borrower" :
    "(SELECT contact.name FROM loans loan JOIN contacts contact ON contact.id = loan.contactId WHERE loan.id = compliance_cases.loanId) AS borrower"}
    FROM ${source} WHERE ${scope}
    ${after ? "AND (openedAt < ? OR (openedAt = ? AND id > ?))" : ""} ORDER BY openedAt DESC, id LIMIT ?`)
    .all(...args, ...(after ? [after.openedAt, after.openedAt, after.id] : []), pageSize + 1) as unknown as (Case & { borrower: string | null })[];
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return { kind: "list", coverage, counts: { cases: Number(count.cases), files: Number(count.files) },
    samplePackageVersion: loanId && staff.brokerage.role === "Admin" ? samplePackage(db, loanId)?.version ?? null : null,
    items: page.map(({ borrower, ...item }) => ({ ...projection(db, staff, roster, item), borrower })),
    next: last && rows.length > pageSize ? { id: last.id, openedAt: last.openedAt, cohort, snapshot } : null } as const;
}

function addEvent(db: Store, staff: WorkspaceStaff, caseId: string, version: number, now: string, action: string, payload: object, requestId: string | null) {
  db.prepare(`INSERT INTO compliance_case_events (brokerageId, caseId, revision, requestId, actor, at, action, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(staff.brokerage.id, caseId, version, requestId, staff.email, now, action, JSON.stringify(payload));
}

function openFixture(db: Store, staff: WorkspaceStaff, roster: readonly Member[], data: Extract<ComplianceRequest, { type: "openFixture" }>, now: string) {
  if (staff.brokerage.role !== "Admin") return unavailable;
  const { loanId, packageVersion } = data;
  const packageRow = samplePackage(db, loanId);
  if (!packageRow || packageRow.version !== packageVersion) {
    return { error: "Open a current sample disclosure package for a fictional Michigan conventional purchase." };
  }
  const admin = currentMember(roster, staff.email)!;
  const officer = typeof packageRow.officerEmail === "string" ? currentMember(roster, packageRow.officerEmail) : undefined;
  const owner = officer && mayOwn(db, staff, officer, loanId) ? officer : admin;

  function addCase(caseKey: string, kind: Case["kind"], title: string, member: Member, parentCaseId: string | null, fileId: string | null = null) {
    const current = db.prepare("SELECT id FROM compliance_cases WHERE brokerageId = ? AND caseKey = ? AND confidentiality = 'General'")
      .get(staff.brokerage.id, caseKey);
    if (current) return String(current.id);
    const caseId = crypto.randomUUID();
    db.prepare(`INSERT INTO compliance_cases (brokerageId, id, caseKey, kind, confidentiality, title, status,
      loanId, packageVersion, parentCaseId, ownerEmail, ownerAccessRevision, revision, openedAt, updatedAt)
      VALUES (?, ?, ?, ?, 'General', ?, 'Open', ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(staff.brokerage.id, caseId, caseKey, kind, title, fileId, fileId ? packageVersion : null, parentCaseId, member.email, member.accessRevision ?? 0, now, now);
    addEvent(db, staff, caseId, 1, now, "Opened fictional case", { ownerEmail: member.email, packageRevision: fileId ? packageRow?.revision : null }, null);
    return caseId;
  }

  const requirement = addCase("fixture:mi-disclosure-applicability", "Requirement review", "Michigan disclosure applicability needs review", admin, null);
  const gap = addCase("fixture:disclosure-delivery-evidence", "Control gap", "Disclosure delivery evidence is unverified", admin, requirement);
  const finding = addCase(JSON.stringify(["fixture:sample-receipt", loanId, packageVersion]), "Operational finding",
    `Receipt evidence needs review for sample package v${packageVersion}`, owner, gap, loanId);
  return detail(db, staff, roster, findCase(db, staff.brokerage.id, finding)!);
}

export function complianceCaseWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  roster: readonly Member[], now = new Date().toISOString()) {
  if (!staff || staff.brokerage.id !== brokerageId || !workspaceFeatures(staff.brokerage).compliance) return unavailable;
  // The caller supplies the directory's current, authenticated roster for this brokerage.
  const actor = currentMember(roster, staff.email);
  if (!actor || actor.role !== staff.brokerage.role || (actor.accessRevision ?? 0) !== (staff.brokerage.accessRevision ?? 0)) return unavailable;
  const parsed = request.safeParse(input);
  if (!parsed.success) return unavailable;
  const data = parsed.data;
  if (!staff.brokerage.pilot && (staff.brokerage.role !== "Admin" ||
      (data.type !== "research" && data.type !== "program" && data.type !== "stateScope" && data.type !== "stateReadiness"))) return unavailable;
  return db.transaction(() => {
    if (data.type === "stateScope") return complianceStateScopeWork(db, data.input, staff, roster, now);
    if (data.type === "stateReadiness") return complianceStateReadinessWork(db, data.input, staff, roster, now);
    if (data.type === "trid") return { kind: "trid" as const, result: tridEvidenceWork(db, data.input, staff, now) };
    if (data.type === "stateBrokerAgreement") return stateBrokerAgreementWork(db, data.input, staff, now);
    if (data.type === "stateRefinanceBenefit") return stateRefinanceBenefitWork(db, data.input, staff, now);
    if (data.type === "obligations") return { kind: "obligations" as const, result: complianceObligationsWork(db, data.input, staff, roster, now) as unknown };
    if (data.type === "learning") return { kind: "learning" as const, result: complianceLearningWork(db, data.input, staff, roster, now) as unknown };
    if (data.type === "program") {
      const result = complianceProgramWork(db, data.input, staff, roster, now);
      return "kind" in result && result.kind === "ownerHome" ? {
        ...result, fileFindings: staff.brokerage.pilot ? ownerFileFindings(db, staff, roster) : undefined,
      } : result;
    }
    if (data.type === "research") return complianceResearchWork(db, data.input, staff, roster, now);
    if (data.type === "inventory" || data.type === "advanceInventory") {
      if (staff.brokerage.role !== "Admin") return unavailable;
      initializeComplianceInventory(db);
      return data.type === "inventory" ? readInventory(db, brokerageId, data) : advanceInventory(db, brokerageId, data.revision, now);
    }
    if (data.type === "leadBackfill" || data.type === "advanceLeadBackfill") {
      if (staff.brokerage.role !== "Admin") return unavailable;
      initializeComplianceLeadBackfill(db);
      return data.type === "leadBackfill" ? readLeadBackfill(db, brokerageId, data) : advanceLeadBackfill(db, brokerageId, data.revision, now);
    }
    if (data.type === "list") return list(db, staff, roster, data);
    if (data.type === "overview") return overview(db, staff, roster, now);
    if (data.type === "daily") return daily(db, staff, roster, data);
    if (data.type === "openFixture") return openFixture(db, staff, roster, data, now);
    const item = findCase(db, brokerageId, data.caseId);
    const isAdmin = staff.brokerage.role === "Admin";
    if (!item || (!isAdmin && (!item.loanId || !loanAccess(db, staff, item.loanId)))) return unavailable;
    if (data.type === "read") return data.loanId && data.loanId !== item.loanId ? unavailable : detail(db, staff, roster, item);
    const owner = currentMember(roster, item.ownerEmail);
    const owns = owner?.email === actor.email && (owner.accessRevision ?? 0) === item.ownerAccessRevision;
    if (!isAdmin && ((data.type !== "updateStatus" && data.type !== "submitForReview" && data.type !== "recordEvidenceNote" &&
      data.type !== "evaluateSampleReceipt") || !owns)) return unavailable;
    const replay = db.prepare(`SELECT actor, json_extract(payload, '$.request') AS request FROM compliance_case_events
      WHERE brokerageId = ? AND caseId = ? AND requestId = ?`)
      .get(brokerageId, item.id, data.requestId);
    if (replay) return replay.actor === staff.email && replay.request === JSON.stringify(data) ? detail(db, staff, roster, item) : changed;
    if (item.revision !== data.expectedRevision) return changed;

    let nextOwner = item.ownerEmail;
    let nextOwnerRevision = item.ownerAccessRevision;
    let nextStatus = item.status;
    let sampleEvidence: { mode: "Sample workbench review"; packageVersion: number; reviewedAt: string; reviewer: string } | undefined;
    let sampleEvaluation: ReturnType<typeof evaluateSampleReceipt> | undefined;
    if (data.type === "assign") {
      const member = currentMember(roster, data.ownerEmail);
      if (!member || !mayOwn(db, staff, member, item.loanId)) return { error: "Choose an active staff member with access to this work." };
      nextOwner = member.email;
      nextOwnerRevision = member.accessRevision ?? 0;
    } else if (data.type === "updateStatus") {
      if (item.loanId && item.status === "Awaiting review") {
        const pkg = samplePackage(db, item.loanId);
        if (pkg && pkg.version === item.packageVersion && currentReviewSubmission(db, brokerageId, item, pkg.revision)) {
          return { error: "Record a sample review decision to move this finding out of review." };
        }
      }
      nextStatus = data.status;
    } else {
      const packageRow = item.loanId && samplePackage(db, item.loanId);
      if (!item.loanId || !item.packageVersion || !packageRow || packageRow.version !== item.packageVersion ||
        packageRow.revision !== data.packageRevision) {
        if (data.type !== "recordSampleReview") return { error: "The sample package changed. Open the current package before recording work." };
        return { error: "Review the current sample package in the disclosure workbench first." };
      }
      if (data.type === "submitForReview") {
        if (currentReviewSubmission(db, brokerageId, item, data.packageRevision)) return changed;
        nextStatus = "Awaiting review";
      } else if (data.type === "decideReview") {
        const submission = currentReviewSubmission(db, brokerageId, item, data.packageRevision);
        if (submission?.revision !== data.submissionRevision) return { error: "Open the current review request before recording a decision." };
        nextStatus = data.decision === "Return for evidence" ? "Awaiting evidence" : "In progress";
      } else if (data.type === "evaluateSampleReceipt") {
        sampleEvaluation = evaluateSampleReceipt(sampleReceiptBasis(db, { brokerageId, caseId: item.id, loanId: item.loanId },
          item.packageVersion, data.packageRevision));
        if (sampleEvaluation.fingerprint !== data.fingerprint) return { error: "The sample evidence changed. Reload the case and run the check again." };
        const previous = lastSampleReceiptEvaluation(db, brokerageId, item.id);
        if (previous?.fingerprint === sampleEvaluation.fingerprint) return detail(db, staff, roster, item);
      } else if (data.type === "recordSampleReview") {
        const review = sampleWorkbenchReview(db, item.loanId, item.packageVersion, data.packageRevision);
        if (!review) return { error: "Review the current sample package in the disclosure workbench first." };
        sampleEvidence = { mode: "Sample workbench review", packageVersion: item.packageVersion,
          reviewedAt: String(review.reviewedAt), reviewer: String(review.actor) };
      }
    }
    db.prepare(`UPDATE compliance_cases SET ownerEmail = ?, ownerAccessRevision = ?, status = ?, revision = revision + 1, updatedAt = ?
      WHERE brokerageId = ? AND id = ? AND revision = ?`).run(nextOwner, nextOwnerRevision, nextStatus, now, brokerageId, item.id, item.revision);
    addEvent(db, staff, item.id, item.revision + 1, now, data.type, { request: data, sampleEvidence, sampleEvaluation }, data.requestId);
    return detail(db, staff, roster, { ...item, ownerEmail: nextOwner, ownerAccessRevision: nextOwnerRevision,
      status: nextStatus, revision: item.revision + 1, updatedAt: now });
  });
}

export type ComplianceCaseResult = ReturnType<typeof complianceCaseWork>;

import { z } from "zod";
import type { VersionedBrokerageMember } from "./brokerage-model";
import { complianceCaseKinds as kinds, complianceCaseStatuses as statuses, complianceWorkUnavailable } from "./compliance-case-model";
import { initializeComplianceInventory } from "./compliance-case-store";
import { advanceInventory, currentPackage, inventoryAdvance, inventoryRead, readInventory, samplePackage, sampleWorkbenchReview } from "./compliance-inventory";
import { advanceLeadBackfill, initializeComplianceLeadBackfill, leadBackfillAdvance, leadBackfillRead, readLeadBackfill } from "./compliance-lead-backfill";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { loanAccess } from "./workspace-access";

const id = z.string().min(1).max(100);
const revision = z.number().int().positive();
const change = { caseId: z.uuid(), expectedRevision: revision, requestId: z.uuid() };
const cursor = z.object({ id: z.uuid(), openedAt: z.iso.datetime(), cohort: z.string().max(800), snapshot: z.number().int().nonnegative() });
const request = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("list"), loanId: id.optional(), kind: z.enum(kinds).optional(), status: z.enum(statuses).optional(), after: cursor.optional() }),
  z.strictObject({ type: z.literal("read"), caseId: z.uuid(), loanId: id.optional() }),
  z.strictObject({ type: z.literal("openFixture"), loanId: id, packageVersion: revision }),
  z.strictObject({ type: z.literal("assign"), ...change, ownerEmail: z.email() }),
  z.strictObject({ type: z.literal("updateStatus"), ...change, status: z.enum(statuses) }),
  z.strictObject({ type: z.literal("recordSampleReview"), ...change, packageRevision: revision }),
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

function currentMember(roster: readonly Member[], email: string) {
  return roster.find((member) => member.email === email && member.status === "Active");
}

function mayOwn(db: Store, staff: WorkspaceStaff, member: Member, loanId: string | null) {
  return member.role === "Admin" || Boolean(loanId && loanAccess(db, { ...staff, email: member.email,
    brokerage: { ...staff.brokerage, role: member.role } }, loanId));
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

function detail(db: Store, staff: WorkspaceStaff, roster: readonly Member[], item: Case) {
  const history = db.prepare(`SELECT revision, actor, at, action, payload FROM compliance_case_events
    WHERE brokerageId = ? AND caseId = ? ORDER BY revision DESC LIMIT 51`).all(staff.brokerage.id, item.id) as unknown as CaseEvent[];
  const packageRow = item.loanId ? currentPackage(db, item.loanId) : undefined;
  const packageState = !item.loanId ? null : !packageRow ? "Unavailable" :
    packageRow.version !== item.packageVersion || packageRow.supersededAt ? "Superseded" : packageRow.reviewReason ? "Needs review" : "Current";
  const sampleReviewRevision = item.loanId && item.packageVersion && packageRow && packageState === "Current" &&
    sampleWorkbenchReview(db, item.loanId, item.packageVersion, packageRow.revision) ? Number(packageRow.revision) : null;
  const sampleReview = packageRow && packageState === "Current" ? db.prepare(`SELECT actor, at FROM compliance_case_events
    WHERE brokerageId = ? AND caseId = ? AND action = 'recordSampleReview' AND json_extract(payload, '$.request.packageRevision') = ?
    ORDER BY revision DESC LIMIT 1`).get(staff.brokerage.id, item.id, packageRow.revision) : undefined;
  const projected = projection(db, staff, roster, item);
  const admin = staff.brokerage.role === "Admin";
  return { kind: "detail", item: projected, packageState, coverage, sampleReviewRevision,
    canUpdateStatus: admin || (projected.ownerState === "Assigned" && projected.ownerEmail === staff.email),
    assignableOwners: admin ? roster.filter((member) => member.status === "Active" && mayOwn(db, staff, member, item.loanId))
      .map(({ email, name }) => ({ email, name })) : [],
    sampleReview: sampleReview ? { actor: String(sampleReview.actor), at: String(sampleReview.at), packageRevision: Number(packageRow?.revision), mode: "Sample workbench review" } : null,
    history: history.slice(0, 50).map((event) => ({ ...event, payload: JSON.parse(event.payload) as unknown })),
    moreHistory: history.length > 50 } as const;
}

function list(db: Store, staff: WorkspaceStaff, roster: readonly Member[], data: Extract<ComplianceRequest, { type: "list" }>) {
  const { loanId, kind, status, after } = data;
  if (staff.brokerage.role !== "Admin" && (!loanId || !loanAccess(db, staff, loanId))) return unavailable;
  const cohort = JSON.stringify([staff.brokerage.id, staff.email, staff.brokerage.role, staff.brokerage.accessRevision ?? 0, loanId, kind, status]);
  const scope = `brokerageId = ? AND confidentiality = 'General' ${loanId ? "AND loanId = ?" : ""}`;
  const scopeArgs = loanId ? [staff.brokerage.id, loanId] : [staff.brokerage.id];
  // Case rows are never deleted here, so every change in the visible cohort advances its snapshot.
  const snapshot = Number(db.prepare(`SELECT coalesce(sum(revision), 0) AS version FROM compliance_cases WHERE ${scope}`)
    .get(...scopeArgs)?.version);
  const filters = `${scope} ${kind ? "AND kind = ?" : ""} ${status ? "AND status = ?" : ""}`;
  const args: SqlValue[] = [...scopeArgs, ...(kind ? [kind] : []), ...(status ? [status] : [])];
  if (after && (after.cohort !== cohort || after.snapshot !== snapshot ||
    !db.prepare(`SELECT 1 FROM compliance_cases WHERE ${filters} AND id = ? AND openedAt = ?`).get(...args, after.id, after.openedAt))) {
    return { error: "This queue changed. Reload the first page." };
  }
  const count = db.prepare(`SELECT count(*) AS cases, count(DISTINCT loanId) AS files FROM compliance_cases WHERE ${filters}`).get(...args);
  const rows = db.prepare(`SELECT ${columns} FROM compliance_cases WHERE ${filters}
    ${after ? "AND (openedAt < ? OR (openedAt = ? AND id > ?))" : ""} ORDER BY openedAt DESC, id LIMIT ?`)
    .all(...args, ...(after ? [after.openedAt, after.openedAt, after.id] : []), pageSize + 1) as unknown as Case[];
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return { kind: "list", coverage, counts: { cases: Number(count?.cases), files: Number(count?.files) },
    samplePackageVersion: loanId && staff.brokerage.role === "Admin" ? samplePackage(db, loanId)?.version ?? null : null,
    items: page.map((item) => projection(db, staff, roster, item)),
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
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.pilot !== true) return unavailable;
  // The caller supplies the directory's current, authenticated roster for this brokerage.
  const actor = currentMember(roster, staff.email);
  if (!actor || actor.role !== staff.brokerage.role || (actor.accessRevision ?? 0) !== (staff.brokerage.accessRevision ?? 0)) return unavailable;
  const parsed = request.safeParse(input);
  if (!parsed.success) return unavailable;
  const data = parsed.data;
  return db.transaction(() => {
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
    if (data.type === "openFixture") return openFixture(db, staff, roster, data, now);
    const item = findCase(db, brokerageId, data.caseId);
    const isAdmin = staff.brokerage.role === "Admin";
    if (!item || (!isAdmin && (!item.loanId || !loanAccess(db, staff, item.loanId)))) return unavailable;
    if (data.type === "read") return data.loanId && data.loanId !== item.loanId ? unavailable : detail(db, staff, roster, item);
    const owner = currentMember(roster, item.ownerEmail);
    const owns = owner?.email === actor.email && (owner.accessRevision ?? 0) === item.ownerAccessRevision;
    if (!isAdmin && (data.type !== "updateStatus" || !owns)) return unavailable;
    const replay = db.prepare(`SELECT actor, json_extract(payload, '$.request') AS request FROM compliance_case_events
      WHERE brokerageId = ? AND caseId = ? AND requestId = ?`)
      .get(brokerageId, item.id, data.requestId);
    if (replay) return replay.actor === staff.email && replay.request === JSON.stringify(data) ? detail(db, staff, roster, item) : changed;
    if (item.revision !== data.expectedRevision) return changed;

    let nextOwner = item.ownerEmail;
    let nextOwnerRevision = item.ownerAccessRevision;
    let nextStatus = item.status;
    let sampleEvidence: { mode: "Sample workbench review"; packageVersion: number; reviewedAt: string; reviewer: string } | undefined;
    if (data.type === "assign") {
      const member = currentMember(roster, data.ownerEmail);
      if (!member || !mayOwn(db, staff, member, item.loanId)) return { error: "Choose an active staff member with access to this work." };
      nextOwner = member.email;
      nextOwnerRevision = member.accessRevision ?? 0;
    } else if (data.type === "updateStatus") {
      nextStatus = data.status;
    } else {
      const packageRow = item.loanId && currentPackage(db, item.loanId);
      if (!item.loanId || !item.packageVersion || !packageRow || packageRow.supersededAt || packageRow.reviewReason || packageRow.version !== item.packageVersion ||
        packageRow.revision !== data.packageRevision) {
        return { error: "Review the current sample package in the disclosure workbench first." };
      }
      const review = sampleWorkbenchReview(db, item.loanId, item.packageVersion, data.packageRevision);
      if (!review) return { error: "Review the current sample package in the disclosure workbench first." };
      sampleEvidence = { mode: "Sample workbench review", packageVersion: item.packageVersion,
        reviewedAt: String(review.reviewedAt), reviewer: String(review.actor) };
    }
    db.prepare(`UPDATE compliance_cases SET ownerEmail = ?, ownerAccessRevision = ?, status = ?, revision = revision + 1, updatedAt = ?
      WHERE brokerageId = ? AND id = ? AND revision = ?`).run(nextOwner, nextOwnerRevision, nextStatus, now, brokerageId, item.id, item.revision);
    addEvent(db, staff, item.id, item.revision + 1, now, data.type, { request: data, sampleEvidence }, data.requestId);
    return detail(db, staff, roster, { ...item, ownerEmail: nextOwner, ownerAccessRevision: nextOwnerRevision,
      status: nextStatus, revision: item.revision + 1, updatedAt: now });
  });
}

export type ComplianceCaseResult = ReturnType<typeof complianceCaseWork>;

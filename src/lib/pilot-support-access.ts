import type { PilotFeedback, VersionedBrokerageMember } from "./brokerage-model";
import type { PilotSupportAccessInput, PilotSupportAccessResult, PilotSupportGrantStatus } from "./pilot-support-access-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

type GrantRow = {
  id: string; requestId: string; reviewer: string; reviewerRevision: number;
  approver: string; approverRevision: number; hours: number; approvedAt: string; expiresAt: string;
  revokedAt: string | null; revokedBy: string | null;
};
type SharedRequest = Pick<PilotFeedback, "step" | "status" | "priority" | "createdAt"> & { updatedAt: string };
const accessDenied = { error: "This support summary is unavailable. Ask a pilot admin for access.", status: 404 } as const;
const adminDenied = { error: "Only a pilot admin can approve or revoke support access.", status: 403 } as const;

export function pilotSupportAccess(db: Store, staff: WorkspaceStaff, input: PilotSupportAccessInput,
  active: VersionedBrokerageMember[], now = new Date()): PilotSupportAccessResult {
  const roster = new Map(active.filter(member => member.status === "Active").map(member => [member.email, member]));
  const actor = roster.get(staff.email);
  if (!staff.brokerage.pilot || !actor || actor.role !== staff.brokerage.role || actor.accessRevision !== staff.brokerage.accessRevision) {
    return { error: "Refresh Team to check your pilot access.", status: 403 };
  }
  const checkedAt = now.toISOString();
  function status(grant: GrantRow): PilotSupportGrantStatus {
    if (grant.revokedAt) return "Revoked";
    if (grant.expiresAt <= checkedAt) return "Expired";
    const reviewer = roster.get(grant.reviewer), approver = roster.get(grant.approver);
    if (!reviewer || reviewer.accessRevision !== grant.reviewerRevision ||
      !approver || approver.role !== "Admin" || approver.accessRevision !== grant.approverRevision) return "Staff access changed";
    return "Active";
  }
  const getGrant = (id: string) => db.prepare("SELECT * FROM pilot_support_grants WHERE id = ?").get(id) as GrantRow | undefined;
  const getSummary = (id: string) => db.prepare(`SELECT step, status, priority, createdAt, coalesce(updatedAt, createdAt) AS updatedAt
    FROM pilot_feedback WHERE id = ?`).get(id) as SharedRequest | undefined;

  if (input.type === "mine") {
    const rows = db.prepare(`SELECT grant.*, feedback.step FROM pilot_support_grants grant JOIN pilot_feedback feedback ON feedback.id = grant.requestId
      WHERE grant.reviewer = ? AND grant.revokedAt IS NULL AND grant.expiresAt > ?
      ORDER BY grant.expiresAt, grant.id`).all(staff.email, checkedAt) as (GrantRow & { step: PilotFeedback["step"] })[];
    return { kind: "mine", offers: rows.filter(row => status(row) === "Active").map(({ id, step, expiresAt }) => ({ id, step, expiresAt })) };
  }
  if (input.type === "open") {
    return db.transaction(() => {
      const grant = getGrant(input.grantId);
      if (!grant || grant.reviewer !== staff.email || status(grant) !== "Active") return accessDenied;
      const request = getSummary(grant.requestId);
      if (!request) return accessDenied;
      const receipt = db.prepare("SELECT grantId, openedAt FROM pilot_support_grant_reads WHERE id = ?").get(input.openId);
      if (receipt && receipt.grantId !== grant.id) return accessDenied;
      if (!receipt) db.prepare("INSERT INTO pilot_support_grant_reads (id, grantId, openedAt) VALUES (?, ?, ?)")
        .run(input.openId, grant.id, checkedAt);
      return { kind: "summary", summary: { ...request, expiresAt: grant.expiresAt,
        openedAt: String(receipt?.openedAt ?? checkedAt), receiptId: input.openId } };
    });
  }
  if (actor.role !== "Admin") return adminDenied;
  if (!getSummary(input.requestId)) return accessDenied;
  if (input.type === "manage") {
    const rows = db.prepare(`SELECT grant.*, count(receipt.id) AS openCount, max(receipt.openedAt) AS lastOpenedAt
      FROM pilot_support_grants grant LEFT JOIN pilot_support_grant_reads receipt ON receipt.grantId = grant.id
      WHERE grant.requestId = ? GROUP BY grant.id ORDER BY grant.approvedAt DESC, grant.id DESC`).all(input.requestId) as
      (GrantRow & { openCount: number; lastOpenedAt: string | null })[];
    return { kind: "manage", grants: rows.map(row => ({
      id: row.id, reviewer: row.reviewer, approver: row.approver, approvedAt: row.approvedAt, expiresAt: row.expiresAt,
      revokedAt: row.revokedAt, revokedBy: row.revokedBy, status: status(row), openCount: row.openCount, lastOpenedAt: row.lastOpenedAt,
    })) };
  }
  return db.transaction(() => {
    const grant = getGrant(input.grantId);
    if (input.type === "revoke") {
      if (!grant || grant.requestId !== input.requestId) return accessDenied;
      if (!grant.revokedAt) db.prepare("UPDATE pilot_support_grants SET revokedAt = ?, revokedBy = ? WHERE id = ?")
        .run(checkedAt, staff.email, grant.id);
      return { kind: "saved", message: "Support access revoked." };
    }
    if (grant) {
      if (grant.requestId === input.requestId && grant.reviewer === input.reviewer && grant.reviewerRevision === input.reviewerRevision &&
        grant.hours === input.hours && grant.approver === staff.email && grant.approverRevision === actor.accessRevision) {
        return { kind: "saved", message: "Support access approval recorded." };
      }
      return { error: "Start a new approval for this request.", status: 409 };
    }
    const reviewer = roster.get(input.reviewer);
    if (!reviewer || reviewer.email === staff.email || reviewer.role === "Admin" || reviewer.accessRevision !== input.reviewerRevision) {
      return { error: "Staff access changed. Refresh Team and choose an active LO or processor.", status: 409 };
    }
    const current = db.prepare(`SELECT * FROM pilot_support_grants
      WHERE requestId = ? AND reviewer = ? AND revokedAt IS NULL AND expiresAt > ?`).all(input.requestId, reviewer.email, checkedAt) as GrantRow[];
    if (current.some(row => status(row) === "Active")) {
      return { error: "This reviewer already has access. Revoke the current grant before replacing it.", status: 409 };
    }
    db.prepare(`INSERT INTO pilot_support_grants
      (id, requestId, reviewer, reviewerRevision, approver, approverRevision, hours, approvedAt, expiresAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.grantId, input.requestId, reviewer.email, input.reviewerRevision,
      staff.email, actor.accessRevision ?? 0, input.hours, checkedAt, new Date(now.getTime() + input.hours * 3_600_000).toISOString());
    return { kind: "saved", message: "Support access approval recorded." };
  });
}

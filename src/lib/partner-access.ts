import { createHash } from "node:crypto";
import { partnerAccessQuery, partnerPermissions, type PartnerCheck, type PartnerCheckResult, type PartnerGrant, type PartnerGrantDetail,
  type PartnerGrantPage, type PartnerGrantState, type PartnerPermission } from "./partner-access-model";
import type { VersionedBrokerageMember } from "./brokerage-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type GrantRow = Omit<PartnerGrant, "scopes" | "state"> & {
  sequence: number; scopes: string; approvedEmail: string; approvedAccessRevision: number;
  approveFingerprint: string; revokeOperationId: string | null; revokedEmail: string | null;
};
type CheckRow = PartnerCheck & { sequence: number; grantId: string; clientId: string; actorEmail: string; grantRevision: number };
type Result = PartnerGrantPage | PartnerGrantDetail | PartnerCheckResult | { error: string };

function currentAdmin(members: VersionedBrokerageMember[], email: string, accessRevision?: number) {
  return accessRevision !== undefined && members.some(member =>
    member.email === email && member.status === "Active" && member.role === "Admin" && member.accessRevision === accessRevision);
}

function grantState(row: GrantRow, members: VersionedBrokerageMember[], at: string): PartnerGrantState {
  if (row.revokedAt) return "Revoked";
  if (Date.parse(row.expiresAt) <= Date.parse(at)) return "Expired";
  return currentAdmin(members, row.approvedEmail, row.approvedAccessRevision) ? "Active" : "Approval changed";
}

function project(row: GrantRow, members: VersionedBrokerageMember[], at: string): PartnerGrant {
  const { id, clientId, name, approvedBy, approvedAt, expiresAt, revokedBy, revokedAt, revision } = row;
  return { id, clientId, name, approvedBy, approvedAt, expiresAt, revokedBy, revokedAt, revision,
    state: grantState(row, members, at), scopes: JSON.parse(row.scopes) as PartnerPermission[] };
}

function grantDetail(db: Store, row: GrantRow, members: VersionedBrokerageMember[], at: string, before?: number): PartnerGrantDetail {
  const rows = db.prepare(`SELECT sequence, id, scope, decision, at, actor FROM partner_sandbox_checks WHERE grantId = ?
    ${before ? "AND sequence < ?" : ""} ORDER BY sequence DESC LIMIT 21`).all(row.id, ...(before ? [before] : [])) as unknown as (PartnerCheck & { sequence: number })[];
  return { kind: "grant", grant: project(row, members, at), checks: rows.slice(0, 20).map(({ id, scope, decision, at, actor }) =>
    ({ id, scope, decision, at, actor })), next: rows.length > 20 ? rows[19].sequence : null };
}

export function partnerAccessWork(db: Store, staff: WorkspaceStaff, input: unknown, members: VersionedBrokerageMember[],
  at = new Date().toISOString()): Result {
  if (!currentAdmin(members, staff.email, staff.brokerage.accessRevision) || staff.brokerage.role !== "Admin") {
    return { error: "Refresh your brokerage access before managing partner permissions." };
  }
  const parsed = partnerAccessQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid partner permission action." };
  const query = parsed.data;
  if (query.type === "list") {
    const rows = db.prepare(`SELECT * FROM partner_sandbox_grants ${query.before ? "WHERE sequence < ?" : ""}
      ORDER BY sequence DESC LIMIT 21`).all(...(query.before ? [query.before] : [])) as unknown as GrantRow[];
    return { kind: "grants", grants: rows.slice(0, 20).map(row => project(row, members, at)), next: rows.length > 20 ? rows[19].sequence : null };
  }
  const read = () => db.prepare("SELECT * FROM partner_sandbox_grants WHERE id = ?").get(query.id) as unknown as GrantRow | undefined;
  if (query.type === "detail") {
    const row = read();
    return row ? grantDetail(db, row, members, at, query.before) : { error: "This grant is unavailable in this brokerage." };
  }
  return db.transaction(() => {
    const row = read();
    if (query.type === "approve") {
      const scopes = JSON.stringify([...query.scopes].sort());
      const fingerprint = createHash("sha256").update(JSON.stringify([query.name, scopes, query.expiresAt])).digest("hex");
      if (row) return row.approvedEmail === staff.email && row.approveFingerprint === fingerprint
        ? grantDetail(db, row, members, at) : { error: "This grant identifier is already in use." };
      if (Date.parse(query.expiresAt) <= Date.parse(at)) return { error: "Choose an expiration in the future." };
      db.prepare(`INSERT INTO partner_sandbox_grants
        (id, clientId, name, scopes, approvedEmail, approvedBy, approvedAccessRevision, approvedAt, expiresAt, approveFingerprint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(query.id, crypto.randomUUID(), query.name, scopes, staff.email,
        staff.name, staff.brokerage.accessRevision ?? null, at, query.expiresAt, fingerprint);
      accessEvent(db, staff, "Approved sandbox partner permissions", query.id, at);
      const saved = read();
      if (!saved) throw new Error("Could not read the approved grant.");
      return grantDetail(db, saved, members, at);
    }
    if (!row) return { error: "This grant is unavailable in this brokerage." };
    if (query.type === "revoke") {
      if (row.revokeOperationId === query.operationId && row.revokedEmail === staff.email) return grantDetail(db, row, members, at);
      if (row.revision !== query.revision) return { error: "This grant changed. Refresh it before revoking." };
      if (db.prepare("SELECT 1 FROM partner_sandbox_grants WHERE revokeOperationId = ?").get(query.operationId)) {
        return { error: "This revocation identifier is already in use." };
      }
      db.prepare(`UPDATE partner_sandbox_grants SET revision = 2, revokedEmail = ?, revokedBy = ?, revokedAt = ?, revokeOperationId = ?
        WHERE id = ?`).run(staff.email, staff.name, at, query.operationId, row.id);
      accessEvent(db, staff, "Revoked sandbox partner permissions", row.id, at);
      return grantDetail(db, { ...row, revision: 2, revokedBy: staff.name, revokedAt: at }, members, at);
    }

    const grant = project(row, members, at);
    const decision: PartnerCheck["decision"] = query.clientId !== grant.clientId ? "Client mismatch" : grant.state !== "Active" ?
      grant.state : grant.scopes.includes(query.scope) ? "Allowed" : "Scope missing";
    const prior = db.prepare("SELECT * FROM partner_sandbox_checks WHERE id = ?").get(query.operationId) as unknown as CheckRow | undefined;
    if (prior && (prior.grantId !== row.id || prior.clientId !== query.clientId || prior.scope !== query.scope || prior.actorEmail !== staff.email ||
        prior.decision !== decision || prior.grantRevision !== row.revision)) {
      return { error: "The permission decision changed. Start a new sandbox check." };
    }
    const check: PartnerCheck = { id: query.operationId, scope: query.scope, decision, at: prior?.at ?? at, actor: prior?.actor ?? staff.name };
    if (!prior) db.prepare(`INSERT INTO partner_sandbox_checks (id, grantId, clientId, grantRevision, scope, decision, at, actorEmail, actor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(check.id, row.id, query.clientId, row.revision, check.scope, check.decision, check.at, staff.email, staff.name);
    return { kind: "check", grant, check, ...(decision === "Allowed" ? { sample: partnerPermissions[query.scope].sample } : {}) };
  });
}

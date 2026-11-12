import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { partnerAccessQuery, partnerPermissions, type PartnerCheck, type PartnerCheckResult, type PartnerGrant, type PartnerGrantDetail,
  type PartnerGrantPage, type PartnerGrantState, type PartnerPermission, type PartnerCredentialIssue, type PartnerEventCredential, type PartnerEventReceipt } from "./partner-access-model";
import type { VersionedBrokerageMember } from "./brokerage-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";
import { sandboxEventPage } from "./sandbox-event-feed";

type GrantRow = Omit<PartnerGrant, "scopes" | "state"> & {
  sequence: number; scopes: string; approvedEmail: string; approvedAccessRevision: number;
  approveFingerprint: string; revokeOperationId: string | null; revokedEmail: string | null;
};
type CheckRow = PartnerCheck & { sequence: number; grantId: string; clientId: string; actorEmail: string; grantRevision: number };
type CredentialRow = PartnerEventCredential & { secretHash: string; maintenanceRevision: number };
type Result = PartnerGrantPage | PartnerGrantDetail | PartnerCheckResult | PartnerCredentialIssue | { error: string };
type EventCredentialInput = { grantId: string; secretHash: string };
type Approval = { email: string; accessRevision: number };
export type SandboxEventResult = { status: 401 } | { status: 403; receiptId?: string } | { status: 429 } |
  { status: 400 | 200; page: ReturnType<typeof sandboxEventPage>; receiptId: string };

function eventCredential(db: Store, id: string) {
  return db.prepare("SELECT id, issuedAt, secretHash, maintenanceRevision FROM partner_event_credentials WHERE grantId = ?")
    .get(id) as CredentialRow | undefined;
}

function partnerGrant(db: Store, id: string) {
  return db.prepare("SELECT * FROM partner_sandbox_grants WHERE id = ?").get(id) as unknown as GrantRow | undefined;
}

export function sandboxEventAuthority(db: Store, input: EventCredentialInput) {
  const credential = eventCredential(db, input.grantId);
  if (!credential || !/^[a-f0-9]{64}$/.test(input.secretHash) ||
      !timingSafeEqual(Buffer.from(credential.secretHash, "hex"), Buffer.from(input.secretHash, "hex"))) return null;
  const row = partnerGrant(db, input.grantId);
  return row && { credential, row, approval: { email: row.approvedEmail, accessRevision: row.approvedAccessRevision } };
}

export function serveSandboxEvents(db: Store, input: EventCredentialInput, params: string,
  reviewed: { credentialId: string; approval: Approval; accessCurrent: boolean; maintenanceRevision: number | null },
  at = new Date().toISOString()): SandboxEventResult {
  return db.transaction(() => {
    const authority = sandboxEventAuthority(db, input);
    if (!authority || authority.credential.id !== reviewed.credentialId) return { status: 401 };
    const { credential, row, approval } = authority;
    const rateWindow = new Date(Date.parse(at) - 60_000).toISOString();
    const recent = db.prepare(`SELECT at FROM partner_event_receipts WHERE grantId = ? ORDER BY sequence DESC LIMIT 1 OFFSET 29`).get(row.id);
    if (recent && String(recent.at) > rateWindow) return { status: 429 };

    let denial: string | null = null;
    if (row.revokedAt) denial = "Revoked";
    else if (Date.parse(row.expiresAt) <= Date.parse(at)) denial = "Expired";
    else if (!reviewed.accessCurrent || approval.email !== reviewed.approval.email ||
      approval.accessRevision !== reviewed.approval.accessRevision) denial = "Approval changed";
    else if (credential.maintenanceRevision !== reviewed.maintenanceRevision) denial = "Workspace revision changed";
    else if (!(JSON.parse(row.scopes) as PartnerPermission[]).includes("events.read")) denial = "Scope missing";

    const page = denial ? null : sandboxEventPage(new URLSearchParams(params));
    const receiptId = crypto.randomUUID();
    const decision = denial ?? (page && "error" in page ? page.error : "Allowed");
    db.prepare(`INSERT INTO partner_event_receipts (id, grantId, clientId, credentialId, at, decision, eventCount)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(receiptId, row.id, row.clientId, credential.id, at, decision, page && "events" in page ? page.events.length : 0);
    db.prepare(`DELETE FROM partner_event_receipts WHERE grantId = ? AND sequence < (
      SELECT sequence FROM partner_event_receipts WHERE grantId = ? ORDER BY sequence DESC LIMIT 1 OFFSET 99
    )`).run(row.id, row.id);

    return page ? { status: "error" in page ? 400 : 200, page, receiptId } : { status: 403, receiptId };
  });
}

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
  const credential = eventCredential(db, row.id);
  const eventReceipts = db.prepare(`SELECT id, clientId, credentialId, at, decision, eventCount FROM partner_event_receipts
    WHERE grantId = ? ORDER BY sequence DESC LIMIT 20`).all(row.id) as unknown as PartnerEventReceipt[];
  return { kind: "grant", grant: project(row, members, at), eventCredential: credential ? { id: credential.id, issuedAt: credential.issuedAt } : null,
    eventReceipts, checks: rows.slice(0, 20).map(({ id, scope, decision, at, actor }) =>
    ({ id, scope, decision, at, actor })), next: rows.length > 20 ? rows[19].sequence : null };
}

export function partnerAccessWork(db: Store, staff: WorkspaceStaff, input: unknown, members: VersionedBrokerageMember[],
  at = new Date().toISOString(), maintenanceRevision: number | null = null): Result {
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
  const read = () => partnerGrant(db, query.id);
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
    if (query.type === "issueEventCredential") {
      if (!staff.brokerage.pilot || maintenanceRevision === null) return { error: "Issue event credentials in an open fictional pilot workspace." };
      const grant = project(row, members, at);
      if (grant.state !== "Active" || !grant.scopes.includes("events.read")) return { error: "An active CRM events grant is required." };
      const existing = eventCredential(db, row.id);
      if (existing?.id === query.operationId) return { error: "The credential was issued. If you lost the value, refresh and replace it." };
      if ((existing?.id ?? null) !== query.previous) return { error: "The credential changed. Refresh the grant before replacing it." };
      if (db.prepare("SELECT 1 FROM partner_event_credentials WHERE id = ?").get(query.operationId)) return { error: "Start a new credential request." };
      const secret = randomBytes(32).toString("base64url");
      db.prepare(`INSERT INTO partner_event_credentials (grantId, id, secretHash, issuedAt, issuedBy, maintenanceRevision)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(grantId) DO UPDATE SET
        id = excluded.id, secretHash = excluded.secretHash, issuedAt = excluded.issuedAt,
        issuedBy = excluded.issuedBy, maintenanceRevision = excluded.maintenanceRevision`).run(
        row.id, query.operationId, createHash("sha256").update(secret).digest("hex"), at, staff.email, maintenanceRevision);
      accessEvent(db, staff, existing ? "Replaced sandbox event credential" : "Issued sandbox event credential", row.id, at);
      return { kind: "eventCredential", credential: { id: query.operationId, issuedAt: at },
        bearer: `orbit_sandbox.${staff.brokerage.id}.${row.id}.${secret}` };
    }
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

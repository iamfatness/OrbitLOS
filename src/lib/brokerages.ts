import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { brokerageIdPattern, brokerageRoles, demoBrokerageId, pilotSeatFull, workspaceCanBeDefault, workspaceFeatures, type AccessEvent, type Brokerage, type BrokerageMember, type PilotSeatCapacity, type VersionedBrokerageMember } from "./brokerage-model";
import type { DepartureMember, DepartureRoster } from "./offboarding-model";
import { readStaffSession, type StaffEmailProof, type StaffIdentity } from "./staff-store";
import type { Store } from "./store";
import { manualReturnAssignment } from "./lender-export-model";

export function initializeBrokerages(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS brokerages (id TEXT PRIMARY KEY, name TEXT NOT NULL, pilot INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS brokerage_members (
      brokerageId TEXT NOT NULL REFERENCES brokerages(id), email TEXT NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Admin', 'LO', 'Processor')), status TEXT NOT NULL CHECK (status IN ('Invited', 'Active', 'Revoked')),
      bootstrap INTEGER NOT NULL DEFAULT 0, accessRevision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (brokerageId, email)
    );
    CREATE INDEX IF NOT EXISTS brokerage_members_by_email ON brokerage_members(email, status);
    CREATE TABLE IF NOT EXISTS pilot_staff_seat_limits (
      brokerageId TEXT PRIMARY KEY REFERENCES brokerages(id), seatLimit INTEGER CHECK (seatLimit IS NULL OR seatLimit > 0),
      revision INTEGER NOT NULL, operationId TEXT NOT NULL, actorEmail TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pilot_staff_invitation_receipts (
      operationId TEXT PRIMARY KEY, brokerageId TEXT NOT NULL REFERENCES brokerages(id),
      email TEXT NOT NULL, role TEXT NOT NULL, accessRevision INTEGER NOT NULL, actorEmail TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_email_codes (
      email TEXT PRIMARY KEY, brokerageId TEXT NOT NULL, accessRevision INTEGER NOT NULL,
      browserHash TEXT NOT NULL, codeHash TEXT NOT NULL, expiresAt INTEGER NOT NULL,
      nextSendAt INTEGER NOT NULL, attempts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS staff_email_codes_expiry ON staff_email_codes(expiresAt);
    CREATE TABLE IF NOT EXISTS staff_workspace_preferences (
      email TEXT PRIMARY KEY, brokerageId TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS brokerage_workspace_settings (
      brokerageId TEXT PRIMARY KEY REFERENCES brokerages(id), uwm INTEGER, compliance INTEGER,
      revision INTEGER NOT NULL DEFAULT 0, releaseEndsAt TEXT
    );
    CREATE TABLE IF NOT EXISTS staff_hidden_workspaces (
      email TEXT NOT NULL, brokerageId TEXT NOT NULL REFERENCES brokerages(id),
      PRIMARY KEY (email, brokerageId)
    );
    CREATE TABLE IF NOT EXISTS brokerage_access_history (
      id TEXT PRIMARY KEY, brokerageId TEXT NOT NULL REFERENCES brokerages(id), actor TEXT NOT NULL,
      action TEXT NOT NULL, subject TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS brokerage_pilot_creator ON brokerage_access_history(brokerageId, actor) WHERE action = 'Created pilot workspace';
    CREATE TABLE IF NOT EXISTS revoked_pilot_portals (
      brokerageId TEXT NOT NULL REFERENCES brokerages(id), tokenHash TEXT NOT NULL, expiresAt TEXT NOT NULL,
      PRIMARY KEY (brokerageId, tokenHash)
    );
    CREATE INDEX IF NOT EXISTS revoked_pilot_portals_by_expiry ON revoked_pilot_portals(expiresAt);
    INSERT OR IGNORE INTO brokerages (id, name) VALUES ('orbit-demo', 'Orbit demo');`);
  if (!db.prepare("PRAGMA table_info(brokerages)").all().some((column) => column.name === "pilot")) {
    db.exec("ALTER TABLE brokerages ADD COLUMN pilot INTEGER NOT NULL DEFAULT 0");
  }
  const membersSchema = db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'brokerage_members'").get();
  if (!String(membersSchema?.sql).includes("'Processor'")) {
    db.transaction(() => db.exec(`
      CREATE TABLE brokerage_members_next (
        brokerageId TEXT NOT NULL REFERENCES brokerages(id), email TEXT NOT NULL, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('Admin', 'LO', 'Processor')),
        status TEXT NOT NULL CHECK (status IN ('Invited', 'Active', 'Revoked')),
        bootstrap INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (brokerageId, email)
      );
      INSERT INTO brokerage_members_next SELECT brokerageId,email,name,role,status,bootstrap FROM brokerage_members;
      DROP TABLE brokerage_members;
      ALTER TABLE brokerage_members_next RENAME TO brokerage_members;
      CREATE INDEX brokerage_members_by_email ON brokerage_members(email, status);
    `));
  }
  if (!db.prepare("PRAGMA table_info(brokerage_members)").all().some((column) => column.name === "accessRevision")) {
    db.exec("ALTER TABLE brokerage_members ADD COLUMN accessRevision INTEGER NOT NULL DEFAULT 0");
  }
}

export function bootstrapDemoMembers(db: Store, emails: string[]) {
  if (!emails.length) return;
  const missing = db.prepare(`SELECT value AS email FROM json_each(?) allowed WHERE NOT EXISTS (
    SELECT 1 FROM brokerage_members member WHERE member.brokerageId = ? AND member.email = allowed.value
  )`).all(JSON.stringify(emails), demoBrokerageId);
  if (!missing.length) return;
  const insert = db.prepare(`INSERT OR IGNORE INTO brokerage_members (brokerageId,email,name,role,status,bootstrap)
    VALUES (?, ?, ?, 'Admin', 'Active', 1)`);
  for (const { email } of missing) insert.run(demoBrokerageId, email, email);
}

export function activeBrokerages(db: Store, email: string, bootstrapEmails: string[]): Brokerage[] {
  return db.prepare(`SELECT b.id, b.name, b.pilot, m.role, m.bootstrap, m.accessRevision, s.uwm, s.compliance, s.revision, s.releaseEndsAt, h.email AS hidden,
    b.pilot AND m.role = 'Admin' AND EXISTS (SELECT 1 FROM brokerage_access_history creation
      WHERE creation.brokerageId = b.id AND creation.actor = m.email AND creation.action = 'Created pilot workspace') AS financeAccess
    FROM brokerage_members m JOIN brokerages b ON b.id = m.brokerageId
    LEFT JOIN brokerage_workspace_settings s ON s.brokerageId = b.id
    LEFT JOIN staff_hidden_workspaces h ON h.brokerageId = b.id AND h.email = m.email
    WHERE m.email = ? AND m.status = 'Active' ORDER BY b.id <> ?, b.name, b.id`).all(email, demoBrokerageId)
    .filter((row) => !row.bootstrap || bootstrapEmails.includes(email))
    .map((row) => ({ id: String(row.id), name: String(row.name), role: row.role as Brokerage["role"], pilot: Boolean(row.pilot), accessRevision: Number(row.accessRevision),
      ...(row.financeAccess ? { financeAccess: true } : {}),
      ...(row.revision ? { features: { uwm: Boolean(row.uwm), compliance: Boolean(row.compliance), revision: Number(row.revision) } } : {}),
      ...(row.hidden ? { hidden: true } : {}),
      ...(typeof row.releaseEndsAt === "string" ? { releaseEndsAt: row.releaseEndsAt } : {}) }));
}

export function readStaffAccess(db: Store, tokenHash: string, now: number, bootstrapEmails: string[]) {
  return db.transaction(() => {
    const session = readStaffSession(db, tokenHash, now);
    if (!session) return null;
    const { identity, method } = session;
    bootstrapDemoMembers(db, bootstrapEmails);
    const preference = db.prepare("SELECT brokerageId FROM staff_workspace_preferences WHERE email = ?").get(identity.email);
    return { identity, brokerages: activeBrokerages(db, identity.email, method === "google" ? bootstrapEmails : []),
      preferredWorkspace: typeof preference?.brokerageId === "string" ? preference.brokerageId : null };
  });
}

export function rememberWorkspace(db: Store, tokenHash: string, now: number, bootstrapEmails: string[],
  brokerageId: string, replace: boolean) {
  return db.transaction(() => {
    const session = readStaffSession(db, tokenHash, now);
    if (!session || !activeBrokerages(db, session.identity.email, session.method === "google" ? bootstrapEmails : []).some((item) => item.id === brokerageId && workspaceCanBeDefault(item))) return false;
    const { identity } = session;
    db.prepare(`INSERT INTO staff_workspace_preferences (email, brokerageId) VALUES (?, ?)
      ON CONFLICT(email) DO UPDATE SET brokerageId = excluded.brokerageId WHERE ?`)
      .run(identity.email, brokerageId, Number(replace));
    return true;
  });
}

export function reserveStaffEmailCode(db: Store, { email, brokerageId, browserHash, codeHash, now }: StaffEmailProof) {
  return db.transaction(() => {
    db.prepare("DELETE FROM staff_email_codes WHERE expiresAt <= ?").run(now);
    const membership = db.prepare(`SELECT brokerageId, accessRevision FROM brokerage_members
      WHERE email = ? AND bootstrap = 0 AND status IN ('Invited', 'Active') AND (? IS NULL OR brokerageId = ?)
      ORDER BY status <> 'Active', brokerageId LIMIT 1`).get(email, brokerageId, brokerageId);
    if (!membership) return false;
    const result = db.prepare(`INSERT INTO staff_email_codes VALUES (?, ?, ?, ?, ?, ?, ?, 5)
      ON CONFLICT(email) DO UPDATE SET brokerageId = excluded.brokerageId, accessRevision = excluded.accessRevision,
        browserHash = excluded.browserHash, codeHash = excluded.codeHash, expiresAt = excluded.expiresAt,
        nextSendAt = excluded.nextSendAt, attempts = excluded.attempts WHERE staff_email_codes.nextSendAt <= ? RETURNING email`)
      .get(email, membership.brokerageId, membership.accessRevision, browserHash, codeHash, now + 10 * 60_000, now + 60_000, now);
    return !!result;
  });
}

export function consumeStaffEmailCode(db: Store, { email, brokerageId, browserHash, codeHash, now }: StaffEmailProof) {
  return db.transaction(() => {
    const challenge = db.prepare(`SELECT brokerageId, accessRevision, codeHash FROM staff_email_codes
      WHERE email = ? AND browserHash = ? AND expiresAt > ? AND attempts > 0 AND (? IS NULL OR brokerageId = ?)`)
      .get(email, browserHash, now, brokerageId, brokerageId);
    if (!challenge) return null;
    const expected = Buffer.from(String(challenge.codeHash));
    const actual = Buffer.from(codeHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      db.prepare("UPDATE staff_email_codes SET attempts = attempts - 1 WHERE email = ?").run(email);
      return null;
    }
    db.prepare("UPDATE staff_email_codes SET attempts = 0, codeHash = '' WHERE email = ?").run(email);
    const id = String(challenge.brokerageId);
    const member = db.prepare(`SELECT name, status FROM brokerage_members WHERE brokerageId = ? AND email = ? AND bootstrap = 0
      AND status IN ('Invited', 'Active') AND accessRevision = ?`).get(id, email, challenge.accessRevision);
    if (!member) return null;
    if (member.status === "Invited") {
      db.prepare("UPDATE brokerage_members SET status = 'Active', accessRevision = accessRevision + 1 WHERE brokerageId = ? AND email = ?").run(id, email);
      history(db, id, email, "Accepted invitation", email, new Date(now).toISOString());
    }
    return { brokerageId: id, identity: { email, name: String(member.name) } };
  });
}

export function activateBrokerages(db: Store, staff: StaffIdentity, bootstrapEmails: string[]) {
  return db.transaction(() => {
    bootstrapDemoMembers(db, bootstrapEmails);
    const invitations = db.prepare("SELECT brokerageId FROM brokerage_members WHERE email = ? AND status = 'Invited'").all(staff.email);
    const now = new Date().toISOString();
    for (const invitation of invitations) history(db, String(invitation.brokerageId), staff.email, "Accepted invitation", staff.email, now);
    db.prepare(`UPDATE brokerage_members SET name = ?, status = 'Active', accessRevision = accessRevision + (status = 'Invited')
      WHERE email = ? AND status IN ('Invited','Active')`).run(staff.name, staff.email);
    return activeBrokerages(db, staff.email, bootstrapEmails);
  });
}

export function history(db: Store, id: string, actor: string, action: string, subject: string, now: string) {
  db.prepare("INSERT INTO brokerage_access_history VALUES (?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), id, actor, action, subject, now);
}

export function brokerageMembers(db: Store, id: string, bootstrapEmails: string[]): VersionedBrokerageMember[] {
  return db.prepare("SELECT email,name,role,status,bootstrap,accessRevision FROM brokerage_members WHERE brokerageId = ? ORDER BY email").all(id).map((row) => ({
    email: String(row.email), name: String(row.name), role: row.role as BrokerageMember["role"],
    status: row.bootstrap && !bootstrapEmails.includes(String(row.email)) ? "Revoked" : row.status as BrokerageMember["status"],
    accessRevision: Number(row.accessRevision),
  }));
}

export function selectedActiveMembers(db: Store, id: string, emails: string[], bootstrapEmails: string[], includeAdmins = false): VersionedBrokerageMember[] {
  return db.prepare(`SELECT email, name, role, bootstrap, accessRevision FROM brokerage_members WHERE brokerageId = ? AND status = 'Active'
    AND (email IN (SELECT value FROM json_each(?)) OR (? = 1 AND role = 'Admin'))
    ORDER BY email NOT IN (SELECT value FROM json_each(?)), name COLLATE NOCASE, email LIMIT 32`)
    .all(id, JSON.stringify(emails), Number(includeAdmins), JSON.stringify(emails))
    .filter((row) => !row.bootstrap || bootstrapEmails.includes(String(row.email)))
    .map((row) => ({ email: String(row.email), name: String(row.name), role: row.role as BrokerageMember["role"], status: "Active",
      accessRevision: Number(row.accessRevision) }));
}

export function pilotSeatCapacity(db: Store, id: string, members: BrokerageMember[]): PilotSeatCapacity {
  const policy = db.prepare("SELECT seatLimit, revision FROM pilot_staff_seat_limits WHERE brokerageId = ?").get(id);
  const active = members.filter(member => member.status === "Active").length;
  const reserved = members.filter(member => member.status === "Invited").length;
  const limit = typeof policy?.seatLimit === "number" ? policy.seatLimit : null;
  return { limit, revision: Number(policy?.revision ?? 0), active, reserved,
    remaining: limit === null ? null : Math.max(0, limit - active - reserved) };
}

export function brokerageHistory(db: Store, id: string): AccessEvent[] {
  return db.prepare("SELECT id,actor,action,subject,createdAt FROM brokerage_access_history WHERE brokerageId = ? ORDER BY createdAt DESC LIMIT 100")
    .all(id).map((row) => ({ ...row }) as unknown as AccessEvent);
}

export function departureRoster(db: Store, staff: StaffIdentity, id: string, bootstrapEmails: string[], subject: string,
  replacement?: string | null): DepartureRoster | null {
  if (!activeBrokerages(db, staff.email, bootstrapEmails).some((item) => item.id === id && item.role === "Admin")) return null;
  function member(email: string): DepartureMember | null {
    const row = db.prepare(`SELECT email, name, role, status, bootstrap, accessRevision, EXISTS (
      SELECT 1 FROM brokerage_access_history WHERE brokerageId = ? AND actor = ? AND action = 'Created pilot workspace'
    ) AS ownsFinancials FROM brokerage_members WHERE brokerageId = ? AND email = ?`).get(id, email, id, email);
    if (!row || row.status === "Invited" || (row.bootstrap && !bootstrapEmails.includes(email))) return null;
    return { email, name: String(row.name), role: row.role as DepartureMember["role"], status: row.status as DepartureMember["status"],
      accessRevision: Number(row.accessRevision), ownsFinancials: Boolean(row.ownsFinancials) };
  }
  const current = member(subject);
  if (!current) return null;
  const destination = replacement && replacement !== subject ? member(replacement) : null;
  const anotherAdmin = current.role !== "Admin" || !!db.prepare(`SELECT 1 FROM brokerage_members WHERE brokerageId = ? AND email <> ?
    AND role = 'Admin' AND status = 'Active' AND (bootstrap = 0 OR email IN (SELECT value FROM json_each(?))) LIMIT 1`)
    .get(id, subject, JSON.stringify(bootstrapEmails));
  return { member: current, replacement: destination?.status === "Active" ? destination : null, canRevoke: current.status === "Active" && anotherAdmin };
}

export const staffEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
const email = staffEmail;
export const brokerageAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), name: z.string().trim().min(2).max(80), id: z.uuid(), pilot: z.boolean().default(false),
    purpose: z.enum(["release", "guided"]).optional() }),
  z.object({ type: z.literal("setWorkspaceFeatures"), uwm: z.boolean(), compliance: z.boolean(), revision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("setWorkspaceListVisibility"), ids: z.array(z.string().regex(brokerageIdPattern)).min(1).max(100), hidden: z.boolean() }),
  z.object({ type: z.literal("closeReleaseWorkspace") }),
  z.object({ type: z.literal("invite"), email, role: z.enum(brokerageRoles), operationId: z.uuid().optional() }),
  z.object({ type: z.literal("cancelInvitation"), email, expectedAccessRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("setPilotSeatLimit"), limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    revision: z.number().int().nonnegative(), operationId: z.uuid() }),
  z.object({ type: z.literal("role"), email, role: z.enum(brokerageRoles) }),
  z.object({ type: z.literal("revoke"), email, expectedAccessRevision: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("assign"), email, loanId: z.string().min(1).max(100), previousEmail: email.nullable(),
    manualReturn: manualReturnAssignment.optional() }),
  z.object({ type: z.literal("assignProcessor"), email: email.nullable(), loanId: z.string().min(1).max(100), revision: z.number().int().nonnegative(),
    requireUnassigned: z.boolean().optional(), requestId: z.uuid().optional() }),
]);

export function changeBrokerage(db: Store, id: string, staff: StaffIdentity, bootstrapEmails: string[], input: unknown) {
  const parsed = brokerageAction.safeParse(input);
  if (!parsed.success) return { error: "Check the brokerage settings and try again." };
  const data = parsed.data;
  return db.transaction(() => {
    const workspaces = activeBrokerages(db, staff.email, bootstrapEmails);
    const access = workspaces.find((brokerage) => brokerage.id === id);
    if (data.type === "setWorkspaceListVisibility") {
      const preferred = db.prepare("SELECT brokerageId FROM staff_workspace_preferences WHERE email = ?").get(staff.email);
      if (!access || data.ids.some((target) => !workspaces.some((item) => item.id === target && item.pilot &&
          (data.hidden ? target !== id && target !== preferred?.brokerageId : item.hidden)))) {
        return { error: "Choose another fictional workspace. Your current and default workspaces stay visible." };
      }
      const change = data.hidden
        ? db.prepare("INSERT OR IGNORE INTO staff_hidden_workspaces (email, brokerageId) VALUES (?, ?)")
        : db.prepare("DELETE FROM staff_hidden_workspaces WHERE email = ? AND brokerageId = ?");
      for (const target of new Set(data.ids)) change.run(staff.email, target);
      return { message: data.hidden ? "Moved to Hidden workspaces." : "Returned to your workspace list." };
    }
    if (access?.role !== "Admin") return { error: "Only a brokerage admin can manage access and loan assignments." };
    const now = new Date().toISOString();
    if (data.type === "setWorkspaceFeatures") {
      const previous = workspaceFeatures(access);
      if (previous.uwm === data.uwm && previous.compliance === data.compliance) return { message: "Workspace features saved." };
      if (data.revision !== previous.revision) return { error: "Workspace features changed. Review the current settings before saving.", status: 409 };
      db.prepare(`INSERT INTO brokerage_workspace_settings (brokerageId, uwm, compliance, revision) VALUES (?, ?, ?, ?)
        ON CONFLICT(brokerageId) DO UPDATE SET uwm=excluded.uwm, compliance=excluded.compliance, revision=excluded.revision`)
        .run(id, Number(data.uwm), Number(data.compliance), previous.revision + 1);
      history(db, id, staff.email, "Updated workspace features", `UWM ${data.uwm ? "on" : "off"} · Compliance ${data.compliance ? "on" : "off"}`, now);
      return { message: "Workspace features saved." };
    }
    if (data.type === "closeReleaseWorkspace") {
      if (!access.releaseEndsAt) return { error: "Only a release test can be closed here." };
      if (access.releaseEndsAt > now) {
        db.prepare("UPDATE brokerage_workspace_settings SET releaseEndsAt = ? WHERE brokerageId = ?").run(now, id);
        history(db, id, staff.email, "Closed release test", access.name, now);
      }
      return { message: "Release test closed." };
    }
    if (data.type === "create") {
      if (data.purpose && !data.pilot) return { error: "Release tests and guided demos use fictional data." };
      if (data.purpose === "guided") {
        const existingDemo = db.prepare(`SELECT a.brokerageId FROM brokerage_access_history a
          WHERE a.actor = ? AND a.action = 'Created pilot workspace' AND a.subject = 'OrbitLOS Guided Demo'
          ORDER BY a.createdAt DESC, a.brokerageId DESC`).all(staff.email)
          .find((row) => workspaces.some(item => item.id === row.brokerageId && item.role === "Admin" && item.pilot && workspaceCanBeDefault(item)));
        if (existingDemo) return { created: String(existingDemo.brokerageId) };
        if (data.name !== "OrbitLOS Guided Demo") return { error: "Choose the guided demo workspace." };
      }
      const existing = db.prepare("SELECT name, pilot FROM brokerages WHERE id = ?").get(data.id);
      if (existing) {
        const owner = workspaces.find((brokerage) => brokerage.id === data.id);
        return owner?.role === "Admin" && owner.name === data.name && Boolean(existing.pilot) === data.pilot && Boolean(owner.releaseEndsAt) === (data.purpose === "release")
          ? { created: data.id } : { error: "This workspace could not be created. Try again." };
      }
      db.prepare("INSERT INTO brokerages (id, name, pilot) VALUES (?, ?, ?)").run(data.id, data.name, Number(data.pilot));
      db.prepare("INSERT INTO brokerage_members (brokerageId,email,name,role,status) VALUES (?, ?, ?, 'Admin', 'Active')")
        .run(data.id, staff.email, staff.name);
      if (data.purpose === "release") {
        const expires = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString();
        db.prepare("INSERT INTO brokerage_workspace_settings (brokerageId, releaseEndsAt) VALUES (?, ?)").run(data.id, expires);
        history(db, data.id, staff.email, "Created release test", data.name, now);
      }
      history(db, data.id, staff.email, data.pilot ? "Created pilot workspace" : "Created workspace", data.name, now);
      return { created: data.id };
    }
    const members = brokerageMembers(db, id, bootstrapEmails);
    if (data.type === "setPilotSeatLimit") {
      if (!access.pilot) return { error: "Pilot seat limits are available in fictional pilot workspaces." };
      const existing = db.prepare("SELECT seatLimit, revision, operationId, actorEmail FROM pilot_staff_seat_limits WHERE brokerageId = ?").get(id);
      const capacity = pilotSeatCapacity(db, id, members);
      const message = data.limit === null ? "Pilot seat limit removed." : "Pilot seat limit saved.";
      if (existing?.operationId === data.operationId && existing.actorEmail === staff.email && existing.seatLimit === data.limit &&
          existing.revision === data.revision + 1) return { message };
      if (existing?.operationId === data.operationId || capacity.revision !== data.revision) {
        return { error: "The pilot seat limit changed. Refresh staff access before saving.", status: 409 };
      }
      if (data.limit !== null && data.limit < capacity.active + capacity.reserved) {
        return { error: `Set the limit to at least ${capacity.active + capacity.reserved} seats for active staff and pending invitations.`, status: 409 };
      }
      if (capacity.limit === data.limit) return { message };
      db.prepare(`INSERT INTO pilot_staff_seat_limits (brokerageId, seatLimit, revision, operationId, actorEmail) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(brokerageId) DO UPDATE SET seatLimit=excluded.seatLimit, revision=excluded.revision,
          operationId=excluded.operationId, actorEmail=excluded.actorEmail`).run(id, data.limit, data.revision + 1, data.operationId, staff.email);
      history(db, id, staff.email, data.limit === null ? "Removed pilot seat limit" : "Set pilot seat limit", data.limit === null ? "No limit" : String(data.limit), now);
      return { message };
    }
    const member = members.find((entry) => entry.email === data.email);
    if (data.type === "assign") {
      if (member?.status !== "Active" || member.role === "Processor") return { error: "Select an active loan officer or admin in this brokerage." };
      return { assignment: { loanId: data.loanId, previousEmail: data.previousEmail, member,
        ...(data.manualReturn ? { manualReturn: data.manualReturn } : {}) } };
    }
    if (data.type === "assignProcessor") {
      if ((data.requireUnassigned && !data.email) || (data.email && (member?.status !== "Active" || member.role !== "Processor"))) {
        return { error: "Select an active processor in this brokerage." };
      }
      return { processorAssignment: { loanId: data.loanId, revision: data.revision, member: member ?? null,
        requireUnassigned: data.requireUnassigned, requestId: data.requestId } };
    }
    if (data.type === "invite") {
      const message = "Invitation saved. Share the Orbit sign-in link with this staff member.";
      const operationId = access.pilot ? data.operationId : undefined;
      if (operationId) {
        const prior = db.prepare("SELECT * FROM pilot_staff_invitation_receipts WHERE operationId = ?").get(operationId);
        if (prior) {
          return prior.brokerageId === id && prior.email === data.email && prior.role === data.role && prior.actorEmail === staff.email &&
            member?.status === "Invited" && member.accessRevision === prior.accessRevision
            ? { message } : { error: "This invitation changed. Refresh staff access before starting a new invitation.", status: 409 };
        }
      }
      if (member && member.status !== "Revoked") return { error: "This staff member already has an invitation or access." };
      if (access.pilot && pilotSeatCapacity(db, id, members).remaining === 0) return { error: pilotSeatFull, status: 409 };
      const saved = db.prepare(`INSERT INTO brokerage_members (brokerageId,email,name,role,status) VALUES (?, ?, ?, ?, 'Invited')
        ON CONFLICT (brokerageId,email) DO UPDATE SET role = excluded.role, status = 'Invited', bootstrap = 0, accessRevision = accessRevision + 1
        RETURNING accessRevision`).get(id, data.email, data.email, data.role);
      if (!saved) throw new Error("The invitation could not be saved.");
      if (operationId) db.prepare(`INSERT INTO pilot_staff_invitation_receipts (operationId, brokerageId, email, role, accessRevision, actorEmail)
        VALUES (?, ?, ?, ?, ?, ?)`).run(operationId, id, data.email, data.role, saved.accessRevision, staff.email);
      history(db, id, staff.email, `Invited as ${data.role}`, data.email, now);
      return { message };
    }
    if (data.type === "cancelInvitation") {
      if (member?.status === "Revoked" && member.accessRevision === data.expectedAccessRevision + 1) return { message: "Invitation canceled." };
      if (member?.status !== "Invited" || member.accessRevision !== data.expectedAccessRevision) {
        return { error: "This invitation changed. Refresh staff access before canceling it.", status: 409 };
      }
      db.prepare("UPDATE brokerage_members SET status = 'Revoked', accessRevision = accessRevision + 1 WHERE brokerageId = ? AND email = ?").run(id, data.email);
      history(db, id, staff.email, "Canceled invitation", data.email, now);
      return { message: "Invitation canceled." };
    }
    if (data.type === "revoke" && data.expectedAccessRevision !== undefined) {
      const current = db.prepare("SELECT status, accessRevision FROM brokerage_members WHERE brokerageId = ? AND email = ?").get(id, data.email);
      if (current?.status === "Revoked" && current.accessRevision === data.expectedAccessRevision + 1) return { message: "Staff access revoked." };
      if (current?.status !== "Active" || current.accessRevision !== data.expectedAccessRevision) {
        return { error: "This staff member’s access changed. Refresh the offboarding preview." };
      }
    }
    if (!member || member.status === "Revoked") return { error: "This staff member has no active invitation or access." };
    const removesAdmin = data.type === "revoke" || data.role !== "Admin";
    if (removesAdmin && member.role === "Admin" && member.status === "Active" &&
      members.filter((entry) => entry.role === "Admin" && entry.status === "Active").length === 1) {
      return { error: "Keep at least one active admin in this brokerage." };
    }
    if (data.type === "revoke") {
      db.prepare("UPDATE brokerage_members SET status = 'Revoked', accessRevision = accessRevision + 1 WHERE brokerageId = ? AND email = ?").run(id, data.email);
      history(db, id, staff.email, "Revoked staff access", data.email, now);
      return { message: "Staff access revoked." };
    }
    if (member.role !== data.role) {
      db.prepare("UPDATE brokerage_members SET role = ?, accessRevision = accessRevision + 1 WHERE brokerageId = ? AND email = ?").run(data.role, id, data.email);
      history(db, id, staff.email, `Changed role to ${data.role}`, data.email, now);
    }
    return { message: "Staff role saved." };
  });
}

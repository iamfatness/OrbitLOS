import { z } from "zod";
import { brokerageRoles, demoBrokerageId, type AccessEvent, type Brokerage, type BrokerageMember, type VersionedBrokerageMember } from "./brokerage-model";
import type { DepartureMember, DepartureRoster } from "./offboarding-model";
import { readStaffSession, type StaffIdentity } from "./staff-store";
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
  return db.prepare(`SELECT b.id, b.name, b.pilot, m.role, m.bootstrap, m.accessRevision,
    b.pilot AND m.role = 'Admin' AND EXISTS (SELECT 1 FROM brokerage_access_history creation
      WHERE creation.brokerageId = b.id AND creation.actor = m.email AND creation.action = 'Created pilot workspace') AS financeAccess
    FROM brokerage_members m JOIN brokerages b ON b.id = m.brokerageId
    WHERE m.email = ? AND m.status = 'Active' ORDER BY b.id <> ?, b.name, b.id`).all(email, demoBrokerageId)
    .filter((row) => !row.bootstrap || bootstrapEmails.includes(email))
    .map((row) => ({ id: String(row.id), name: String(row.name), role: row.role as Brokerage["role"], pilot: Boolean(row.pilot), accessRevision: Number(row.accessRevision),
      ...(row.financeAccess ? { financeAccess: true } : {}) }));
}

export function readStaffAccess(db: Store, tokenHash: string, now: number, bootstrapEmails: string[]) {
  return db.transaction(() => {
    const identity = readStaffSession(db, tokenHash, now);
    if (!identity) return null;
    bootstrapDemoMembers(db, bootstrapEmails);
    return { identity, brokerages: activeBrokerages(db, identity.email, bootstrapEmails) };
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

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const brokerageAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), name: z.string().trim().min(2).max(80), id: z.uuid(), pilot: z.boolean().default(false) }),
  z.object({ type: z.literal("invite"), email, role: z.enum(brokerageRoles) }),
  z.object({ type: z.literal("role"), email, role: z.enum(brokerageRoles) }),
  z.object({ type: z.literal("revoke"), email, expectedAccessRevision: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("assign"), email, loanId: z.string().min(1).max(100), previousEmail: email.nullable(),
    manualReturn: manualReturnAssignment.optional() }),
  z.object({ type: z.literal("assignProcessor"), email: email.nullable(), loanId: z.string().min(1).max(100), revision: z.number().int().nonnegative(),
    requireUnassigned: z.boolean().optional() }),
]);

export function changeBrokerage(db: Store, id: string, staff: StaffIdentity, bootstrapEmails: string[], input: unknown) {
  const parsed = brokerageAction.safeParse(input);
  if (!parsed.success) return { error: "Check the brokerage settings and try again." };
  const data = parsed.data;
  return db.transaction(() => {
    const role = activeBrokerages(db, staff.email, bootstrapEmails).find((brokerage) => brokerage.id === id)?.role;
    if (role !== "Admin") return { error: "Only a brokerage admin can manage access and loan assignments." };
    const now = new Date().toISOString();
    if (data.type === "create") {
      const existing = db.prepare("SELECT name, pilot FROM brokerages WHERE id = ?").get(data.id);
      if (existing) {
        const owner = activeBrokerages(db, staff.email, bootstrapEmails).find((brokerage) => brokerage.id === data.id);
        return owner?.role === "Admin" && owner.name === data.name && Boolean(existing.pilot) === data.pilot
          ? { created: data.id } : { error: "This workspace could not be created. Try again." };
      }
      db.prepare("INSERT INTO brokerages (id, name, pilot) VALUES (?, ?, ?)").run(data.id, data.name, Number(data.pilot));
      db.prepare("INSERT INTO brokerage_members (brokerageId,email,name,role,status) VALUES (?, ?, ?, 'Admin', 'Active')")
        .run(data.id, staff.email, staff.name);
      history(db, data.id, staff.email, data.pilot ? "Created pilot workspace" : "Created workspace", data.name, now);
      return { created: data.id };
    }
    const members = brokerageMembers(db, id, bootstrapEmails);
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
      return { processorAssignment: { loanId: data.loanId, revision: data.revision, member: member ?? null, requireUnassigned: data.requireUnassigned } };
    }
    if (data.type === "invite") {
      if (member && member.status !== "Revoked") return { error: "This staff member already has an invitation or access." };
      db.prepare(`INSERT INTO brokerage_members (brokerageId,email,name,role,status) VALUES (?, ?, ?, ?, 'Invited')
        ON CONFLICT (brokerageId,email) DO UPDATE SET role = excluded.role, status = 'Invited', bootstrap = 0, accessRevision = accessRevision + 1`).run(id, data.email, data.email, data.role);
      history(db, id, staff.email, `Invited as ${data.role}`, data.email, now);
      return { message: "Invitation saved. Share the Orbit sign-in link with this staff member." };
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

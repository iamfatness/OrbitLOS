import { createHash } from "node:crypto";
import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import type { VersionedBrokerageMember } from "./brokerage-model";
import { programRequest, type ProgramRequest, type ProgramEntity, type ProgramItem, type ProgramMonth } from "./compliance-program-model";

const unavailable = { error: "This compliance program is unavailable." };
const changed = { error: "This program changed. Refresh and review before saving." };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function initializeComplianceProgram(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_program_entities (
    brokerageId TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, nmls TEXT NOT NULL, scopeNote TEXT NOT NULL, createdAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,id));
  CREATE TABLE IF NOT EXISTS compliance_program_items (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, month TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL,
    category TEXT NOT NULL, status TEXT NOT NULL, ownerEmail TEXT NOT NULL, ownerRevision INTEGER NOT NULL,
    internalTarget TEXT NOT NULL, instructions TEXT NOT NULL, evidence TEXT NOT NULL, revision INTEGER NOT NULL, updatedAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,id), FOREIGN KEY(brokerageId,entityId) REFERENCES compliance_program_entities(brokerageId,id));
  CREATE INDEX IF NOT EXISTS compliance_program_period ON compliance_program_items(brokerageId,entityId,month,internalTarget,id);
  CREATE TABLE IF NOT EXISTS compliance_program_events (
    brokerageId TEXT NOT NULL, requestId TEXT NOT NULL, entityId TEXT NOT NULL, month TEXT NOT NULL, id TEXT NOT NULL,
    actor TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL, request TEXT NOT NULL,
    PRIMARY KEY(brokerageId,requestId));
  CREATE INDEX IF NOT EXISTS compliance_program_history ON compliance_program_events(brokerageId,entityId,month,at);
  CREATE TABLE IF NOT EXISTS compliance_program_reviews (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, month TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    actor TEXT NOT NULL, at TEXT NOT NULL, note TEXT NOT NULL, snapshot TEXT NOT NULL,
    PRIMARY KEY(brokerageId,id), FOREIGN KEY(brokerageId,entityId) REFERENCES compliance_program_entities(brokerageId,id));`);
}
function entities(db: Store, tenant: string) {
  return { kind: "programEntities", entities: db.prepare("SELECT id,name,nmls,scopeNote,createdAt FROM compliance_program_entities WHERE brokerageId=? ORDER BY name,id LIMIT 51")
    .all(tenant).map(row => ({ ...row } as ProgramEntity)) } as const;
}
function month(db: Store, staff: WorkspaceStaff, entity: ProgramEntity, period: string, roster: readonly VersionedBrokerageMember[], now: string): ProgramMonth {
  const rows = db.prepare("SELECT * FROM compliance_program_items WHERE brokerageId=? AND entityId=? AND month=? ORDER BY internalTarget,id LIMIT 201")
    .all(staff.brokerage.id, entity.id, period);
  const owners = roster.filter(m => m.status === "Active" && m.role === "Admin");
  const items = rows.map(row => ({ ...row, ownerAvailable: owners.some(m => m.email === row.ownerEmail && (m.accessRevision ?? 0) === row.ownerRevision),
    overdue: row.status !== "Completed" && String(row.internalTarget) < now.slice(0, 10) } as ProgramItem));
  const counts = { total: items.length, open: items.filter(i => i.status !== "Completed").length,
    overdue: items.filter(i => i.overdue).length, unavailableOwners: items.filter(i => !i.ownerAvailable).length };
  const fingerprint = hash([entity, period, rows, owners.map(m => [m.email, m.accessRevision ?? 0]).sort(), now.slice(0, 10)]);
  const reviews = db.prepare("SELECT id,actor,at,note,snapshot,fingerprint FROM compliance_program_reviews WHERE brokerageId=? AND entityId=? AND month=? ORDER BY at DESC,rowid DESC LIMIT 20")
    .all(staff.brokerage.id, entity.id, period).map(row => ({ id: String(row.id), actor: String(row.actor), at: String(row.at), note: String(row.note),
      snapshot: String(row.snapshot), current: row.fingerprint === fingerprint }));
  const events = db.prepare("SELECT id,actor,at,action,note FROM compliance_program_events WHERE brokerageId=? AND entityId=? AND month=? ORDER BY at DESC,rowid DESC LIMIT 51")
    .all(staff.brokerage.id, entity.id, period);
  return { kind: "programMonth", entity, month: period, items, fingerprint, counts, reviews,
    history: events.slice(0, 50).map(row => ({ id: String(row.id), actor: String(row.actor), at: String(row.at), action: String(row.action), note: String(row.note) })),
    moreHistory: events.length > 50, owners: owners.map(({ email, name }) => ({ email, name })), coverage: "Regulatory applicability not evaluated" };
}
/** Runs within the authenticated compliance-case transaction. No external effects. */
export function complianceProgramWork(db: Store, input: ProgramRequest, staff: WorkspaceStaff, roster: readonly VersionedBrokerageMember[], now: string) {
  if (staff.brokerage.role !== "Admin") return unavailable;
  const parsed = programRequest.safeParse(input);
  if (!parsed.success) return unavailable;
  const data = parsed.data, tenant = staff.brokerage.id;
  if (data.operation === "entities") return entities(db, tenant);
  const replay = "requestId" in data ? db.prepare("SELECT * FROM compliance_program_events WHERE brokerageId=? AND requestId=?").get(tenant, data.requestId) : undefined;
  if (replay && (replay.actor !== staff.email || replay.request !== JSON.stringify(data))) return changed;
  function event(entityId: string, period: string, id: string, action: string, note: string) {
    if (!("requestId" in data)) throw new Error("A change requires a request ID");
    db.prepare("INSERT INTO compliance_program_events VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(tenant, data.requestId, entityId, period, id, staff.email, now, action, note, JSON.stringify(data));
  }
  if (data.operation === "createEntity") {
    if (!replay) {
      if (Number(db.prepare("SELECT count(*) n FROM compliance_program_entities WHERE brokerageId=?").get(tenant)!.n) >= 50)
        return { error: "This pilot supports up to 50 entity profiles." };
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,?,?,?)").run(tenant, id, data.name, data.nmls, data.scopeNote, now);
      event(id, "", id, "Created entity profile", data.scopeNote);
    }
    return entities(db, tenant);
  }
  const row = db.prepare("SELECT id,name,nmls,scopeNote,createdAt FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(tenant, data.entityId);
  if (!row) return unavailable;
  const entity = { ...row } as ProgramEntity;
  const read = () => month(db, staff, entity, data.month, roster, now);
  if (data.operation === "month" || replay) return read();
  if (data.operation === "reviewMonth") {
    const current = read();
    if (current.fingerprint !== data.fingerprint) return changed;
    if (!current.items.length) return { error: "Add review work before recording a monthly review." };
    const id = crypto.randomUUID();
    // A monthly review records remaining gaps. It never completes outstanding work.
    db.prepare("INSERT INTO compliance_program_reviews VALUES (?,?,?,?,?,?,?,?,?)").run(tenant, entity.id, data.month, id,
      current.fingerprint, staff.email, now, data.note, JSON.stringify({ entity, month: data.month, items: current.items, counts: current.counts, coverage: current.coverage }));
    event(entity.id, data.month, id, "Recorded monthly review", data.note);
    return read();
  }
  const owner = roster.find(m => m.status === "Active" && m.role === "Admin" && m.email === data.ownerEmail);
  if (!owner) return { error: "Choose an active admin to own this work." };
  if (data.operation === "schedule") {
    if (Number(db.prepare("SELECT count(*) n FROM compliance_program_items WHERE brokerageId=? AND entityId=? AND month=?").get(tenant, entity.id, data.month)!.n) >= 200)
      return { error: "This pilot supports 200 work items per entity and month. No items have been omitted." };
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO compliance_program_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(tenant, entity.id, data.month, id, data.title,
      data.category, "Planned", owner.email, owner.accessRevision ?? 0, data.internalTarget, data.instructions, "", 1, now);
    event(entity.id, data.month, id, "Scheduled internal review", data.instructions);
    return read();
  }
  const item = db.prepare("SELECT * FROM compliance_program_items WHERE brokerageId=? AND entityId=? AND month=? AND id=?")
    .get(tenant, entity.id, data.month, data.id);
  if (!item) return unavailable;
  if (item.revision !== data.expectedRevision) return changed;
  if (data.status === "Completed" && (item.status !== "Awaiting review" || data.evidence.length < 5))
    return { error: "Submit the work for review and record an evidence reference before completing it." };
  db.prepare("UPDATE compliance_program_items SET status=?,ownerEmail=?,ownerRevision=?,internalTarget=?,evidence=?,revision=revision+1,updatedAt=? WHERE brokerageId=? AND id=?")
    .run(data.status, owner.email, owner.accessRevision ?? 0, data.internalTarget, data.evidence, now, tenant, data.id);
  event(entity.id, data.month, data.id, data.status === "Completed" ? "Reviewed internal work" : "Updated internal work", data.note);
  return read();
}

import { createHash } from "node:crypto";
import { readBranches } from "./branches";
import { branchStaffCurrent } from "./branch-model";
import { storedQuoteRouting } from "./quote-intake-model";
import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import { workspaceFeatures, type VersionedBrokerageMember } from "./brokerage-model";
import { countLicenseRecords, licenseFields, licenseHolder, licenseRenewalLookahead, programRequest, type LicenseHolder, type LicenseHolderChoice, type LicenseRenewalCursor, type LicenseRenewalOwner, type LicenseRenewalAssignment, type LicenseRenewalQueue, type LicenseHistory, type LicenseStateCheck, type LicenseFields, type ProgramLicense, type ProgramLicenses, type ProgramRequest, type ProgramEntity, type ProgramItem, type ProgramMonth } from "./compliance-program-model";

const unavailable = { error: "This compliance program is unavailable." };
const changed = { error: "This program changed. Refresh and review before saving." };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function initializeComplianceProgram(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_program_entities (
    brokerageId TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, nmls TEXT NOT NULL, scopeNote TEXT NOT NULL, createdAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,id));
  CREATE TABLE IF NOT EXISTS compliance_program_licenses (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, id TEXT NOT NULL, jurisdiction TEXT NOT NULL,
    licenseType TEXT NOT NULL, licenseNumber TEXT NOT NULL, status TEXT NOT NULL, effectiveOn TEXT, expiresOn TEXT,
    evidence TEXT NOT NULL, revision INTEGER NOT NULL, updatedAt TEXT NOT NULL, holder TEXT, renewalOwner TEXT,
    PRIMARY KEY(brokerageId,entityId,id), FOREIGN KEY(brokerageId,entityId) REFERENCES compliance_program_entities(brokerageId,id));
  CREATE UNIQUE INDEX IF NOT EXISTS compliance_program_license_number ON compliance_program_licenses(
    brokerageId,entityId,jurisdiction,licenseType COLLATE NOCASE,licenseNumber COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS compliance_program_license_state ON compliance_program_licenses(brokerageId,jurisdiction,entityId);
  CREATE INDEX IF NOT EXISTS compliance_program_license_renewals ON compliance_program_licenses(brokerageId,expiresOn,entityId,id)
    WHERE expiresOn IS NOT NULL AND status IN ('Active','Expired');
  CREATE TABLE IF NOT EXISTS compliance_program_items (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, month TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL,
    category TEXT NOT NULL, status TEXT NOT NULL, ownerEmail TEXT NOT NULL, ownerRevision INTEGER NOT NULL,
    internalTarget TEXT NOT NULL, instructions TEXT NOT NULL, evidence TEXT NOT NULL, revision INTEGER NOT NULL, updatedAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,id), FOREIGN KEY(brokerageId,entityId) REFERENCES compliance_program_entities(brokerageId,id));
  CREATE INDEX IF NOT EXISTS compliance_program_period ON compliance_program_items(brokerageId,entityId,month,internalTarget,id);
  CREATE TABLE IF NOT EXISTS compliance_program_events (
    brokerageId TEXT NOT NULL, requestId TEXT NOT NULL, entityId TEXT NOT NULL, month TEXT NOT NULL, id TEXT NOT NULL,
    actor TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL, request TEXT NOT NULL, details TEXT,
    PRIMARY KEY(brokerageId,requestId));
  CREATE INDEX IF NOT EXISTS compliance_program_license_history ON compliance_program_events(brokerageId,entityId,id,at)
    WHERE month='' AND action IN ('Recorded license','Updated license record');
  CREATE INDEX IF NOT EXISTS compliance_program_history ON compliance_program_events(brokerageId,entityId,month,at);
  CREATE TABLE IF NOT EXISTS compliance_program_reviews (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, month TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    actor TEXT NOT NULL, at TEXT NOT NULL, note TEXT NOT NULL, snapshot TEXT NOT NULL,
    PRIMARY KEY(brokerageId,id), FOREIGN KEY(brokerageId,entityId) REFERENCES compliance_program_entities(brokerageId,id));`);
  const licenseColumns = db.prepare("PRAGMA table_info(compliance_program_licenses)").all();
  if (!licenseColumns.some(column => column.name === "holder")) db.exec("ALTER TABLE compliance_program_licenses ADD COLUMN holder TEXT");
  if (!licenseColumns.some(column => column.name === "renewalOwner")) db.exec("ALTER TABLE compliance_program_licenses ADD COLUMN renewalOwner TEXT");
  if (!db.prepare("PRAGMA table_info(compliance_program_events)").all().some(column => column.name === "details")) {
    db.exec("ALTER TABLE compliance_program_events ADD COLUMN details TEXT");
  }
}
type OwnerChoice = LicenseRenewalOwner & { name: string };
function renewalOwnerRecord(raw: unknown, owners: ReadonlyMap<string, OwnerChoice>): LicenseRenewalAssignment | null {
  if (typeof raw !== "string") return null;
  const saved = JSON.parse(raw) as OwnerChoice;
  const current = owners.get(saved.email);
  const available = current?.accessRevision === saved.accessRevision;
  return { ...saved, name: available ? current!.name : saved.name, available };
}
function licenseHolderRecord(raw: unknown): { holder: LicenseHolder; label: string } {
  if (!raw) return { holder: { kind: "Company" }, label: "Company" };
  const { holder, label } = JSON.parse(String(raw)) as { holder: unknown; label: string };
  return { holder: licenseHolder.parse(holder), label };
}
function renewalWindow(now: string) {
  const today = now.slice(0, 10);
  return { today, renewalThrough: new Date(Date.parse(today) + licenseRenewalLookahead * 86400000).toISOString().slice(0, 10) };
}

function licenseRenewalFilter(tenant: string, now: string, owner?: LicenseRenewalOwner) {
  const { today, renewalThrough } = renewalWindow(now);
  const where = `l.brokerageId=? AND l.expiresOn IS NOT NULL AND l.status IN ('Active','Expired')
    AND l.expiresOn<=? AND (l.status='Active' OR l.expiresOn<?)${owner ?
      " AND json_extract(l.renewalOwner,'$.email')=? AND json_extract(l.renewalOwner,'$.accessRevision')=?" : ""}`;
  return { where, args: [tenant, renewalThrough, today, ...(owner ? [owner.email, owner.accessRevision] : [])], today };
}

export function countMyLicenseRenewals(db: Store, staff: WorkspaceStaff, now: string, limit: number) {
  if (staff.brokerage.role !== "Admin" || !workspaceFeatures(staff.brokerage).compliance) return 0;
  const { where, args } = licenseRenewalFilter(staff.brokerage.id, now, { email: staff.email, accessRevision: staff.brokerage.accessRevision ?? 0 });
  return Number(db.prepare(`SELECT count(*) AS total FROM (SELECT 1 FROM compliance_program_licenses l WHERE ${where} LIMIT ?)`)
    .get(...args, limit)?.total);
}

function licenseRenewals(db: Store, tenant: string, now: string, owners: ReadonlyMap<string, OwnerChoice>, after?: LicenseRenewalCursor,
  owner?: LicenseRenewalOwner): LicenseRenewalQueue {
  const { where, args, today } = licenseRenewalFilter(tenant, now, owner);
  const total = Number(db.prepare(`SELECT count(*) AS total FROM compliance_program_licenses l WHERE ${where}`).get(...args)?.total);
  const limit = 8;
  const rows = db.prepare(`SELECT l.id,l.entityId,l.jurisdiction,l.licenseType,l.licenseNumber,l.expiresOn,l.holder,l.renewalOwner,e.name
    FROM compliance_program_licenses l JOIN compliance_program_entities e ON e.brokerageId=l.brokerageId AND e.id=l.entityId
    WHERE ${where}${after ? " AND (l.expiresOn,l.entityId,l.id) > (?,?,?)" : ""}
    ORDER BY l.expiresOn,l.entityId,l.id LIMIT ?`).all(...args,
      ...(after ? [after.expiresOn, after.entityId, after.licenseId] : []), limit + 1);
  const items = rows.slice(0, limit).map(row => {
    const holder = licenseHolderRecord(row.holder);
    const expiresOn = String(row.expiresOn);
    return { licenseId: String(row.id), entityId: String(row.entityId), entityName: String(row.name), jurisdiction: String(row.jurisdiction),
      licenseType: String(row.licenseType), licenseNumber: String(row.licenseNumber), expiresOn,
      holderLabel: holder.holder.kind === "Company" ? "Company" : `${holder.holder.kind} · ${holder.label}`,
      renewalOwner: renewalOwnerRecord(row.renewalOwner, owners),
      renewal: expiresOn < today ? "Past expiration" as const : "Expires soon" as const };
  });
  const last = items.at(-1);
  return { kind: "licenseRenewals", total, items, next: rows.length > limit && last ?
    { expiresOn: last.expiresOn, entityId: last.entityId, licenseId: last.licenseId } : null };
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
function checkLicenseState(db: Store, tenant: string, data: Extract<ProgramRequest, { operation: "licenseStateCheck" }>,
  roster: readonly VersionedBrokerageMember[], asOf: string): LicenseStateCheck | typeof unavailable {
  const selection = data.assignment;
  const lead = selection && db.prepare(`SELECT receipt.routingReceipt FROM referral_leads lead
    LEFT JOIN quote_intake_receipts receipt ON receipt.leadId=lead.id
    WHERE lead.id=? AND lead.resolvedAt IS NULL`).get(selection.leadId);
  if (selection && !lead) return unavailable;

  const intakeBranch = storedQuoteRouting(lead?.routingReceipt)?.branch;
  const officer = selection?.officerEmail ? roster.find(member =>
    member.email === selection.officerEmail && member.status === "Active" && member.role !== "Processor") : undefined;
  const branches = selection ? readBranches(db).flatMap(branch => {
    const atIntake = branch.id === intakeBranch?.id;
    const officerAssigned = officer ? branch.staff.some(assignment => assignment.email === officer.email && branchStaffCurrent(assignment, officer)) : undefined;
    return atIntake || (branch.active && officerAssigned) ?
      [{ id: branch.id, name: branch.name, active: branch.active, atIntake, officerAssigned }] : [];
  }) : [];
  const records = db.prepare(`SELECT entityId,status,effectiveOn,expiresOn,holder FROM compliance_program_licenses
    WHERE brokerageId=? AND jurisdiction=? AND (holder IS NULL OR json_extract(holder,'$.holder.kind')='Company'
      OR (json_extract(holder,'$.holder.kind')='Branch' AND json_extract(holder,'$.holder.id') IN (SELECT value FROM json_each(?)))
      OR (json_extract(holder,'$.holder.kind')='Loan officer' AND json_extract(holder,'$.holder.id')=?))`)
    .all(tenant, data.jurisdiction, JSON.stringify(branches.map(branch => branch.id)), officer?.email ?? null) as
      (Pick<LicenseFields, "status" | "effectiveOn" | "expiresOn"> & { entityId: string; holder: string | null })[];
  const byEntity = Map.groupBy(records.map(({ holder, ...record }) => ({ ...record, holder: licenseHolderRecord(holder).holder })), record => record.entityId);
  return { kind: "licenseStateCheck", jurisdiction: data.jurisdiction, asOf,
    ...(selection ? { assignment: {
      officer: selection.officerEmail ? { name: officer?.name ?? null } : null,
      intakeBranchWithoutLink: intakeBranch && !branches.some(branch => branch.atIntake) ? intakeBranch.name : undefined,
      branches,
    } } : {}),
    entities: entities(db, tenant).entities.map(({ id, name }) => {
      const licenses = byEntity.get(id) ?? [];
      const company = countLicenseRecords(licenses.filter(record => record.holder.kind === "Company"), asOf);
      return { id, name, company,
        ...(officer ? { officer: countLicenseRecords(licenses.flatMap(record => record.holder.kind === "Loan officer" ?
          [{ ...record, holderAvailable: record.holder.accessRevision === (officer.accessRevision ?? 0) }] : []), asOf) } : {}),
        ...(branches.length ? { branches: branches.map(branch => ({ id: branch.id, counts: countLicenseRecords(
          licenses.filter(record => record.holder.kind === "Branch" && record.holder.id === branch.id)
            .map(record => ({ ...record, holderAvailable: branch.active })), asOf) })) } : {}),
      };
    }),
  };
}

/** Runs within the authenticated compliance-case transaction. No external effects. */
export function complianceProgramWork(db: Store, input: ProgramRequest, staff: WorkspaceStaff, roster: readonly VersionedBrokerageMember[], now: string) {
  if (staff.brokerage.role !== "Admin") return unavailable;
  const parsed = programRequest.safeParse(input);
  if (!parsed.success) return unavailable;
  const data = parsed.data, tenant = staff.brokerage.id;
  if (data.operation === "entities") return entities(db, tenant);
  if (data.operation === "licenseStateCheck") return checkLicenseState(db, tenant, data, roster, now.slice(0, 10));
  const owners = new Map(roster.filter(member => member.status === "Active" && member.role === "Admin").map(member => [member.email,
    { email: member.email, accessRevision: member.accessRevision ?? 0, name: member.name }]));
  if (data.operation === "licenseRenewals") {
    const owner = data.scope === "mine" ? { email: staff.email, accessRevision: staff.brokerage.accessRevision ?? 0 } : undefined;
    return licenseRenewals(db, tenant, now, owners, data.after, owner);
  }
  const replay = "requestId" in data ? db.prepare("SELECT * FROM compliance_program_events WHERE brokerageId=? AND requestId=?").get(tenant, data.requestId) : undefined;
  if (replay && (replay.actor !== staff.email || replay.request !== JSON.stringify(data))) return changed;
  function event(entityId: string, period: string, id: string, action: string, note: string, details?: object) {
    if (!("requestId" in data)) throw new Error("A change requires a request ID");
    db.prepare(`INSERT INTO compliance_program_events
      (brokerageId,requestId,entityId,month,id,actor,at,action,note,request,details) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(tenant, data.requestId, entityId, period, id, staff.email, now, action, note, JSON.stringify(data), details ? JSON.stringify(details) : null);
  }
  if (data.operation === "createEntity") {
    if (!replay) {
      if (Number(db.prepare("SELECT count(*) n FROM compliance_program_entities WHERE brokerageId=?").get(tenant)!.n) >= 50)
        return { error: "This workspace supports up to 50 entity profiles." };
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,?,?,?)").run(tenant, id, data.name, data.nmls, data.scopeNote, now);
      event(id, "", id, "Created entity profile", data.scopeNote);
    }
    return entities(db, tenant);
  }
  const row = db.prepare("SELECT id,name,nmls,scopeNote,createdAt FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(tenant, data.entityId);
  if (!row) return unavailable;
  const entity = { ...row } as ProgramEntity;
  if (data.operation === "licenseHistory") {
    if (!db.prepare("SELECT 1 FROM compliance_program_licenses WHERE brokerageId=? AND entityId=? AND id=?").get(tenant, entity.id, data.licenseId)) return unavailable;
    const rows = db.prepare(`SELECT requestId,actor,at,action,request,details FROM compliance_program_events
      WHERE brokerageId=? AND entityId=? AND id=? AND month='' AND action IN ('Recorded license','Updated license record')
      ORDER BY at DESC,rowid DESC LIMIT 26`).all(tenant, entity.id, data.licenseId);
    const history: LicenseHistory = { kind: "licenseHistory", entries: rows.slice(0, 25).map(row => {
      const request = JSON.parse(String(row.request)) as Extract<ProgramRequest, { operation: "saveLicense" }>;
      const details = typeof row.details === "string" ? JSON.parse(row.details) as { renewalOwner: string | null } : undefined;
      return { id: String(row.requestId), actor: String(row.actor), at: String(row.at), action: String(row.action), note: request.renewalNote ?? "",
        evidence: request.evidence, expiresOn: request.expiresOn, status: request.status, renewalOwner: details?.renewalOwner };
    }), more: rows.length > 25 };
    return history;
  }
  if (data.operation === "licenses" || data.operation === "saveLicense") {
    const holderChoices: LicenseHolderChoice[] = [
      ...readBranches(db).filter(branch => branch.active).map(branch => ({
        holder: { kind: "Branch" as const, id: branch.id }, label: branch.name,
      })),
      ...roster.filter(member => member.status === "Active" && member.role !== "Processor").map(member => ({
        holder: { kind: "Loan officer" as const, id: member.email, accessRevision: member.accessRevision ?? 0 },
        label: member.name,
      })),
    ];
    const choices = new Map(holderChoices.map(choice => [JSON.stringify(choice.holder), choice.label]));
    const { today, renewalThrough } = renewalWindow(now);
    const list = (): ProgramLicenses => ({ kind: "programLicenses", entity, asOf: today, holderChoices, renewalOwners: [...owners.values()], licenses: db.prepare(`SELECT id,jurisdiction,
      licenseType,licenseNumber,status,effectiveOn,expiresOn,evidence,revision,updatedAt,holder,renewalOwner FROM compliance_program_licenses
      WHERE brokerageId=? AND entityId=? ORDER BY jurisdiction,licenseType,licenseNumber`).all(tenant, entity.id).map(row => {
      const { holder: rawHolder, renewalOwner: rawOwner, ...record } = row;
      const saved = licenseHolderRecord(rawHolder);
      const label = choices.get(JSON.stringify(saved.holder));
      const holderAvailable = saved.holder.kind === "Company" || label !== undefined;
      const expiresOn = typeof record.expiresOn === "string" ? record.expiresOn : null;
      const renewal = expiresOn && (record.status === "Active" || record.status === "Expired") ?
        expiresOn < today ? "Past expiration" : record.status === "Active" && expiresOn <= renewalThrough ? "Expires soon" : null : null;
      return { ...record, holder: saved.holder, holderLabel: label ?? saved.label, holderAvailable, renewalOwner: renewalOwnerRecord(rawOwner, owners), renewal } as ProgramLicense;
    }) });
    if (data.operation === "licenses" || replay) return list();
    const current = db.prepare("SELECT revision,holder,renewalOwner FROM compliance_program_licenses WHERE brokerageId=? AND entityId=? AND id=?")
      .get(tenant, entity.id, data.id);
    if ((current?.revision ?? 0) !== data.revision) return { error: "This license changed. Refresh before saving your edit." };
    if (data.effectiveOn && data.expiresOn && data.expiresOn < data.effectiveOn) return { error: "Enter an expiration date on or after the effective date." };
    const duplicate = db.prepare(`SELECT 1 FROM compliance_program_licenses WHERE brokerageId=? AND entityId=? AND jurisdiction=?
      AND licenseType=? COLLATE NOCASE AND licenseNumber=? COLLATE NOCASE AND id<>?`)
      .get(tenant, entity.id, data.jurisdiction, data.licenseType, data.licenseNumber, data.id);
    if (duplicate) return { error: "This license is already recorded for the entity and state." };
    if (!current && Number(db.prepare("SELECT count(*) AS n FROM compliance_program_licenses WHERE brokerageId=? AND entityId=?").get(tenant, entity.id)!.n) >= 500) {
      return { error: "This entity has reached 500 license records." };
    }
    const previous = licenseHolderRecord(current?.holder);
    const next = data.holder ?? previous.holder;
    const holderKey = JSON.stringify(next);
    const holderLabel = next.kind === "Company" ? "Company" : choices.get(holderKey);
    if (!holderLabel && (!current || holderKey !== JSON.stringify(previous.holder))) {
      return { error: "The selected branch or loan officer is no longer available. Refresh the register and choose a current holder." };
    }
    const savedOwner = renewalOwnerRecord(current?.renewalOwner, owners);
    const requestedOwner = data.renewalOwner;
    const currentOwner = requestedOwner && owners.get(requestedOwner.email);
    if (requestedOwner && currentOwner?.accessRevision !== requestedOwner.accessRevision) {
      return { error: "The selected renewal owner no longer has current admin access. Refresh the register and choose an active admin." };
    }
    const nextOwner = requestedOwner === undefined ? savedOwner : currentOwner || null;
    const fields = licenseFields.parse(data);
    db.prepare(`INSERT INTO compliance_program_licenses
      (brokerageId,entityId,id,jurisdiction,licenseType,licenseNumber,status,effectiveOn,expiresOn,evidence,revision,updatedAt,holder,renewalOwner)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(brokerageId,entityId,id) DO UPDATE SET jurisdiction=excluded.jurisdiction,licenseType=excluded.licenseType,
      licenseNumber=excluded.licenseNumber,status=excluded.status,effectiveOn=excluded.effectiveOn,expiresOn=excluded.expiresOn,
      evidence=excluded.evidence,revision=excluded.revision,updatedAt=excluded.updatedAt,holder=excluded.holder,renewalOwner=excluded.renewalOwner`)
      .run(tenant, entity.id, data.id, fields.jurisdiction, fields.licenseType, fields.licenseNumber, fields.status,
        fields.effectiveOn, fields.expiresOn, fields.evidence, data.revision + 1, now, JSON.stringify({ holder: next, label: holderLabel ?? previous.label }), nextOwner ? JSON.stringify(nextOwner) : null);
    event(entity.id, "", data.id, current ? "Updated license record" : "Recorded license", data.renewalNote ?? fields.evidence,
      { renewalOwner: nextOwner?.name ?? null });
    return list();
  }
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

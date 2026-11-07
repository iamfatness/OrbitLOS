import { createHash } from "node:crypto";
import type { Store } from "./store";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Contact } from "./model";
import { contactDuplicate } from "./contact-csv";
import { accessEvent } from "./workspace-access";
import { firstContactDue, leadRouting } from "./lead-inbox";
import { migrationKey, migrationTypes, type MigrationInput, type MigrationReport } from "./pipeline-migration-model";

const toInstant = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00-05:00` : value).toISOString();
const isPlanned = (id: string) => id.startsWith("planned:");
type Result = MigrationReport["rows"][number];

export function migratePipeline(db: Store, input: MigrationInput, staff: WorkspaceStaff, members: StaffIdentity[], now: string) {
  const ordered = [...input.rows].sort((a, b) => migrationTypes.indexOf(a.type) - migrationTypes.indexOf(b.type));
  const keys = ordered.map(migrationKey);
  if (new Set(keys).size !== keys.length) return { error: "Each record type and external ID must appear only once in a file." };
  const targets = new Map(db.prepare("SELECT recordKey, targetId FROM migration_records WHERE origin = ?").all(input.origin)
    .map((row) => [String(row.recordKey), String(row.targetId)]));
  const contacts = db.prepare("SELECT id, name, email, phone, role FROM contacts ORDER BY id").all() as unknown as Contact[];
  const openLeads = new Set(db.prepare("SELECT id FROM referral_leads WHERE resolvedAt IS NULL OR loanId IS NOT NULL").all().map((row) => String(row.id)));
  const owners = new Map(members.map((member) => [member.email, member.name]));
  const plan = new Map<string, Result>();

  for (const row of ordered) {
    const key = migrationKey(row);
    const label = "name" in row ? row.name : row.text;
    const result: Result = { key, label, status: "Create", detail: "", targetId: `planned:${key}` };
    plan.set(key, result);
    const known = targets.get(key);
    const decision = input.decisions[key];
    const review = (detail: string) => Object.assign(result, { status: "Review", detail, targetId: undefined });
    if (known) {
      Object.assign(result, { status: "Previously imported", detail: "Source ID already reconciled.", targetId: known });
      continue;
    }
    if (decision === "skip") {
      Object.assign(result, { status: "Skipped", detail: "Excluded by reviewer.", targetId: undefined });
      continue;
    }
    if (row.type === "Contact") {
      const candidates = contacts.filter((contact) => contactDuplicate(row, [contact]));
      if (candidates.length) {
        const match = candidates.find((contact) => contact.id === decision);
        if (match) Object.assign(result, { status: "Reuse contact", detail: match.name, targetId: match.id });
        else {
          review("Choose a contact to reuse or skip this row.");
          result.matches = candidates.map((item) => ({ id: item.id, label: `${item.name}${item.email ? ` · ${item.email}` : ""}` }));
        }
      } else if (decision) review("The selected contact no longer matches.");
      else contacts.push({ ...row, id: result.targetId! });
    } else if (row.type === "Lead") {
      const contactId = row.parentId && (plan.get(`Contact:${row.parentId}`)?.targetId ?? targets.get(`Contact:${row.parentId}`));
      if (row.ownerEmail && !owners.has(row.ownerEmail)) review("Use the email of an active LO or admin in this brokerage, or leave it blank for the shared inbox.");
      else if (row.parentId && (!contactId || !contacts.some((item) => item.id === contactId && item.role !== "Realtor"))) {
        review("Map this lead to an available borrower contact from the same source.");
      } else if (!contactId && contacts.some((contact) => contactDuplicate({ ...row, role: "Borrower" }, [contact]))) {
        review("Add the matching borrower as a Contact row and reference its external ID.");
      } else if (row.dueAt && toInstant(row.dueAt) < toInstant(row.createdAt)) review("First contact cannot be due before lead creation.");
      else {
        openLeads.add(result.targetId!);
        result.detail = row.ownerEmail ? `Owner ${owners.get(row.ownerEmail)}` : "Shared inbox";
      }
    } else {
      const parent = `Lead:${row.parentId}`;
      const leadId = plan.get(parent)?.targetId ?? targets.get(parent);
      if (!leadId || !openLeads.has(leadId)) review("Reference an open or converted lead from the same source.");
    }
  }
  const rows = keys.map((key) => plan.get(key)!);
  const fingerprint = createHash("sha256").update(JSON.stringify({ origin: input.origin, input: ordered, rows })).digest("hex");
  if (!input.preview) return { migration: { rows, fingerprint }, message: "Migration preview is ready." };
  if (input.preview !== fingerprint) return { error: "The preview changed. Review the latest results before importing." };
  if (rows.some((row) => row.status === "Review")) return { error: "Resolve or skip every flagged record before importing." };

  for (const row of ordered) {
    const key = migrationKey(row);
    const result = plan.get(key)!;
    if (result.status !== "Create" && result.status !== "Reuse contact") continue;
    const id = result.status === "Create" ? crypto.randomUUID() :
      isPlanned(result.targetId!) ? targets.get(result.targetId!.slice("planned:".length))! : result.targetId!;
    if (result.status === "Create") {
      if (row.type === "Contact") {
        db.prepare("INSERT INTO contacts (id, name, email, phone, role, addedBy) VALUES (?, ?, ?, ?, ?, ?)")
          .run(id, row.name, row.email, row.phone, row.role, staff.email);
      } else if (row.type === "Lead") {
        const created = toInstant(row.createdAt);
        db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt,
          dueAt, zip, importSource, importedContactId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, id, row.name, row.email, row.phone, row.purpose, owners.get(row.ownerEmail) ?? "", row.ownerEmail || null,
            created, row.dueAt ? toInstant(row.dueAt) : firstContactDue(created, leadRouting(db)), row.zip, row.source,
            targets.get(`Contact:${row.parentId}`) ?? null);
      } else {
        const leadId = targets.get(`Lead:${row.parentId}`)!;
        const loanId = db.prepare("SELECT loanId FROM referral_leads WHERE id = ?").get(leadId)?.loanId ?? null;
        if (row.type === "Note") {
          if (loanId) db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)")
            .run(id, loanId, row.text, toInstant(row.createdAt));
          else db.prepare("INSERT INTO lead_events (id, leadId, at, actor, kind, text) VALUES (?, ?, ?, ?, 'Note', ?)")
            .run(id, leadId, toInstant(row.createdAt), "CRM import", row.text);
        } else {
          const task = [id, loanId ?? leadId, row.text, toInstant(row.dueAt), row.completedAt ? toInstant(row.completedAt) : null] as const;
          if (loanId) db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, completedAt) VALUES (?, ?, ?, ?, ?)").run(...task);
          else db.prepare("INSERT INTO lead_import_tasks (id, leadId, title, dueAt, completedAt) VALUES (?, ?, ?, ?, ?)").run(...task);
        }
      }
    }
    db.prepare("INSERT INTO migration_records (origin, recordKey, targetId) VALUES (?, ?, ?)").run(input.origin, key, id);
    targets.set(key, id);
    result.targetId = id;
  }
  const count = (status: Result["status"]) => rows.filter((row) => row.status === status).length;
  if (count("Create") || count("Reuse contact")) accessEvent(db, staff, "Imported fictional CRM records", input.origin, now);
  return { migration: { rows, fingerprint }, message: `${count("Create")} created · ${count("Reuse contact")} reused · ${count("Previously imported")} previously imported · ${count("Skipped")} skipped` };
}

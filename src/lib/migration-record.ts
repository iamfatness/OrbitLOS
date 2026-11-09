import { migrationRecordInput, migrationRecordUnavailable, type MigrationDestination, type MigrationRecord } from "./migration-record-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { searchTaskTarget } from "./workspace-search-model";

function leadDestination(db: Store, id: string): MigrationDestination | undefined {
  const row = db.prepare("SELECT resolvedAt, loanId, archiveToken IS NOT NULL AS archived FROM referral_leads WHERE id = ?").get(id);
  if (!row) return;
  if (typeof row.loanId === "string") return { kind: "loan", id: row.loanId, target: "loan-application" };
  if (!row.resolvedAt) return { kind: "lead", id };
  if (row.archived) return { kind: "archivedLead", id };
}

export function readMigrationRecord(db: Store, input: unknown, staff: WorkspaceStaff): MigrationRecord | { error: string } {
  const parsed = migrationRecordInput.safeParse(input);
  const unavailable = { error: migrationRecordUnavailable };
  if (!parsed.success || staff.brokerage.role !== "Admin" || !staff.brokerage.pilot) return unavailable;
  const data = parsed.data;
  const type = data.key.split(":", 1)[0];
  const current = db.prepare("SELECT targetId FROM migration_records WHERE origin = ? AND recordKey = ?").get(data.origin, data.key)?.targetId;
  if (typeof current !== "string") return unavailable;
  const expected = data.type === "result" ? data.targetId : db.prepare(`SELECT row.targetId
    FROM migration_import_rows row JOIN migration_imports receipt ON receipt.id = row.importId
    WHERE row.importId = ? AND receipt.origin = ? AND row.recordKey = ? AND NOT EXISTS (
      SELECT 1 FROM migration_import_undos undo JOIN migration_undone_records removed ON removed.undoId = undo.id
      WHERE undo.importId = row.importId AND removed.recordKey = row.recordKey
    )`).get(data.receiptId, data.origin, data.key)?.targetId;
  if (typeof expected !== "string") return unavailable;
  if (current !== expected && (type !== "Contact" ||
    db.prepare("SELECT canonicalId FROM contact_merges WHERE sourceId = ?").get(expected)?.canonicalId !== current)) return unavailable;

  if (type === "Contact") return db.prepare("SELECT 1 FROM contacts WHERE id = ?").get(current) ?
    { destination: { kind: "contact", id: current } } : unavailable;
  if (type === "Lead" || type === "Callback") {
    const destination = leadDestination(db, current);
    return destination ? { destination } : unavailable;
  }
  if (type === "Note") {
    const loan = db.prepare("SELECT loanId, text, createdAt FROM activity WHERE id = ?").get(current);
    if (loan) return { destination: { kind: "loan", id: String(loan.loanId), target: "loan-activity" },
      evidence: { title: "Imported loan activity", text: String(loan.text), at: String(loan.createdAt) } };
    const note = db.prepare("SELECT leadId, text, at FROM lead_events WHERE id = ?").get(current);
    const destination = note && leadDestination(db, String(note.leadId));
    return destination && note ? { destination, evidence: { title: "Imported lead activity", text: String(note.text), at: String(note.at) } } : unavailable;
  }
  const contactTask = db.prepare("SELECT 1 FROM contact_activity WHERE id = ? AND dueAt IS NOT NULL").get(current);
  if (contactTask) return { destination: { kind: "contactTask", id: current } };
  const loanTask = db.prepare("SELECT loanId, title, dueAt, completedAt FROM tasks WHERE id = ?").get(current);
  const leadTask = loanTask ? undefined : db.prepare("SELECT leadId, title, dueAt, completedAt FROM lead_import_tasks WHERE id = ?").get(current);
  const task = loanTask ?? leadTask;
  const destination = loanTask ? { kind: "loan" as const, id: String(loanTask.loanId), target: searchTaskTarget(current) } :
    leadTask && leadDestination(db, String(leadTask.leadId));
  return task && destination ? { destination, evidence: { title: String(task.title), dueAt: String(task.dueAt),
    completedAt: typeof task.completedAt === "string" ? task.completedAt : undefined } } : unavailable;
}

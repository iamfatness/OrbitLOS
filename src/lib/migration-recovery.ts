import { createHash } from "node:crypto";
import { migrationRecoveryInput } from "./pipeline-migration-model";
import type { MigrationImportReceipt, MigrationInput, MigrationRecoveryReview, MigrationReport, MigrationRow, UndoMigrationInput } from "./pipeline-migration-model";
import { outreachSuppressed, outreachSuppressionKeys } from "./outreach-preferences";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent } from "./workspace-access";

const tables = ["call_campaign_members", "activity", "tasks", "contact_activity", "lead_events", "lead_import_tasks", "referral_leads", "contacts"] as const;
type Table = (typeof tables)[number];
type ImportedRow = { recordKey: string; label: string; outcome: string; targetId: string | null; storage: string | null; baseline: string | null;
  undoneAt: string | null; undoneBy: string | null };
type ReviewRow = NonNullable<MigrationRecoveryReview["preview"]>["rows"][number];
const receiptQuery = `SELECT receipt.*, (SELECT count(*) FROM migration_import_rows
  WHERE importId = receipt.id AND outcome IN ('Corrected', 'Corrected using contact')) AS correctedCount
  FROM migration_imports receipt`;

function storageFor(db: Store, row: MigrationRow, id: string): Table {
  if (row.type === "Contact") return "contacts";
  if (row.type === "Lead") return "referral_leads";
  if (row.type === "Callback") return "call_campaign_members";
  if (row.type === "Note") return db.prepare("SELECT 1 FROM lead_events WHERE id = ?").get(id) ? "lead_events" : "activity";
  if (row.parentType === "Contact") return "contact_activity";
  return db.prepare("SELECT 1 FROM lead_import_tasks WHERE id = ?").get(id) ? "lead_import_tasks" : "tasks";
}

const primaryKey = (table: Table) => table === "call_campaign_members" ? "leadId" : "id";

function callbackSnapshot(db: Store, leadId: string, member: Record<string, SqlValue>) {
  const runs = db.prepare("SELECT * FROM campaign_follow_up_runs WHERE leadId = ? ORDER BY callNumber, id").all(leadId);
  const attempts = db.prepare(`SELECT attempt.* FROM campaign_follow_up_attempts attempt JOIN campaign_follow_up_runs run ON run.id = attempt.runId
    WHERE run.leadId = ? ORDER BY run.callNumber, attempt.attempt`).all(leadId);
  const assignments = db.prepare("SELECT * FROM campaign_assignment_history WHERE leadId = ? ORDER BY id").all(leadId);
  const task = db.prepare("SELECT * FROM lead_import_tasks WHERE leadId = ? AND id = ?").get(leadId, member.callbackTaskId ?? null);
  const events = db.prepare(`SELECT event.* FROM lead_events event WHERE event.leadId = ? AND event.id IN (
    SELECT promiseRequestEventId FROM campaign_follow_up_runs WHERE leadId = ?
    UNION SELECT promiseAttemptEventId FROM campaign_follow_up_runs WHERE leadId = ?
  ) ORDER BY event.id`).all(leadId, leadId, leadId);
  return [runs, attempts, assignments, task, events];
}

function recordSnapshot(db: Store, table: Table, id: string) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE ${primaryKey(table)} = ?`).get(id);
  const followUp = table === "referral_leads" ? db.prepare("SELECT * FROM lead_follow_up WHERE leadId = ?").get(id) :
    table === "call_campaign_members" && row ? callbackSnapshot(db, id, row) : undefined;
  const baseline = row ? createHash("sha256").update(JSON.stringify([row, followUp])).digest("hex") : null;
  return { row, baseline };
}

export function recordMigrationReceipt(db: Store, source: Pick<MigrationInput, "origin" | "batch">, input: MigrationRow[],
  results: MigrationReport["rows"], staff: WorkspaceStaff, now: string) {
  if (!results.some(({ status }) => status === "Create" || status === "Reuse contact")) return;
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO migration_imports (id, origin, importedAt, importedBy, part, partCount, recordCount) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, source.origin, now, staff.name, source.batch?.part ?? null, source.batch?.partCount ?? null, results.length);
  const insert = db.prepare(`INSERT INTO migration_import_rows (importId, recordKey, label, outcome, targetId, storage, baseline)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const [index, result] of results.entries()) {
    const targetId = result.targetId ?? null;
    const storage = result.status === "Create" && targetId ? storageFor(db, input[index], targetId) : null;
    const baseline = storage && targetId ? recordSnapshot(db, storage, targetId).baseline : null;
    const outcome = result.correction && result.status === "Create" ? "Corrected" :
      result.correction && result.status === "Reuse contact" ? "Corrected using contact" : result.status;
    insert.run(id, result.key, result.label.slice(0, 160), outcome, targetId, storage, baseline);
  }
}

export function reviewMigrationRecovery(db: Store, staff: WorkspaceStaff, input: unknown) {
  if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin") return { error: "Only a fictional pilot admin can review CRM import recovery." };
  const parsed = migrationRecoveryInput.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid CRM import receipt." };
  return db.transaction(() => reviewSnapshot(db, parsed.data));
}

function reviewSnapshot(db: Store, importId?: string): MigrationRecoveryReview | { error: string } {
  const imports = db.prepare(`${receiptQuery} ORDER BY importedAt DESC, id DESC LIMIT 20`).all() as unknown as MigrationImportReceipt[];
  if (!importId) return { imports };
  const receipt = importReceipt(db, importId);
  if (!receipt) return { error: "This CRM import receipt is unavailable in this brokerage." };
  return { imports, preview: buildRecoveryPlan(db, receipt).preview };
}

function importReceipt(db: Store, importId: string) {
  return db.prepare(`${receiptQuery} WHERE receipt.id = ?`).get(importId) as MigrationImportReceipt | undefined;
}

function buildRecoveryPlan(db: Store, receipt: MigrationImportReceipt) {
  const imported = db.prepare(`SELECT r.*, u.undoneAt, u.undoneBy FROM migration_import_rows r
    LEFT JOIN migration_import_undos u ON u.importId = r.importId AND EXISTS (
      SELECT 1 FROM migration_undone_records removed WHERE removed.undoId = u.id AND removed.recordKey = r.recordKey
    )
    WHERE r.importId = ? ORDER BY r.recordKey`).all(receipt.id) as unknown as ImportedRow[];
  const suppression = outreachSuppressionKeys(db);
  const eligible = new Set<string>();
  const removals: { key: string; table: Table; id: string }[] = [];
  const results = new Map<string, ReviewRow>();
  // Review the campaign membership before its callback evidence, then other children before parents.
  const priority = (storage: string | null) => tables.findIndex((table) => table === storage);

  for (const item of [...imported].sort((a, b) => priority(a.storage) - priority(b.storage))) {
    const { recordKey: key, label, outcome, targetId: id, undoneAt, undoneBy } = item;
    const correction = outcome === "Corrected" || outcome === "Corrected using contact";
    const keep = (reason: string, result: ReviewRow["result"] = "Keep") => results.set(key, { key, label, result, reason, correction });
    if (undoneAt && undoneBy) {
      results.set(key, { key, label, result: "Removed", reason: "Removed by a confirmed undo.", correction, removal: { at: undoneAt, by: undoneBy } });
      continue;
    }
    if (outcome === "Reuse contact" || outcome === "Corrected using contact" || outcome === "Previously imported") {
      keep(outcome === "Previously imported" ? "Reconciled in an earlier import." : "Reused a contact that already existed.");
      continue;
    }
    if (outcome !== "Create" && outcome !== "Corrected") {
      keep(outcome === "Suppressed" ? "Outreach rules blocked this row." : outcome === "Undone"
        ? "An earlier undo removed this source record." : "The reviewer skipped this row.", "No change");
      continue;
    }
    const table = tables.find((entry) => entry === item.storage);
    if (!table || !id || !item.baseline) {
      keep("The original record state is unavailable.");
      continue;
    }
    const { row, baseline } = recordSnapshot(db, table, id);
    if (!row) {
      if (table === "contacts" && db.prepare("SELECT 1 FROM contact_merges WHERE sourceId = ?").get(id)) {
        keep("This contact was merged into another record.");
        continue;
      }
      const leadHistoryMoved = (table === "lead_events" && db.prepare("SELECT 1 FROM activity WHERE id = ?").get(id)) ||
        (table === "lead_import_tasks" && db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(id));
      if (leadHistoryMoved) keep("This record now belongs to a loan file.");
      else keep("This record is already absent.", "No change");
      continue;
    }
    if (table === "contacts" && db.prepare("SELECT 1 FROM contact_merges WHERE canonicalId = ?").get(id)) {
      keep("This contact preserves the links from a merged record.");
      continue;
    }
    const source = db.prepare("SELECT targetId FROM migration_records WHERE origin = ? AND recordKey = ?").get(receipt.origin, key);
    // An Orbit Callback and its Lead intentionally share the destination lead ID.
    const externalId = key.slice(key.indexOf(":") + 1);
    const relatedKey = table === "call_campaign_members" ? `Lead:${externalId}` : table === "referral_leads" ? `Callback:${externalId}` : null;
    if (source?.targetId !== id || db.prepare(`SELECT 1 FROM migration_records WHERE targetId = ? AND (origin <> ? OR recordKey <> ?)
      AND (origin <> ? OR recordKey IS NOT ?) LIMIT 1`).get(id, receipt.origin, key, receipt.origin, relatedKey)) {
      keep("The source link changed or another import uses this record.");
      continue;
    }
    if (table === "activity" || table === "tasks" || (table === "referral_leads" && row.loanId)) {
      keep("This record belongs to a loan file.");
      continue;
    }
    if ((table === "contacts" && row.role !== "Realtor" && outreachSuppressed(suppression, { ...row, contactId: id })) ||
      (table === "referral_leads" && outreachSuppressed(suppression, { ...row, leadId: id, contactId: row.importedContactId }))) {
      keep("This record carries an outreach opt-out.");
      continue;
    }
    if (item.baseline !== baseline || db.prepare("SELECT 1 FROM workspace_access_history WHERE subject = ? AND createdAt >= ? LIMIT 1")
      .get(id, receipt.importedAt)) {
      keep("Staff changed or worked this record after import.");
      continue;
    }
    if (row.completedAt || (table === "referral_leads" && row.resolvedAt)) {
      keep("This record contains completed or archived work.");
      continue;
    }
    if (hasProtectedLinks(db, table, id, row, eligible, suppression, receipt.importedAt)) {
      keep("Linked to activity or another record outside this recovery set.");
      continue;
    }
    eligible.add(`${table}:${id}`);
    removals.push({ key, table, id });
    keep("Created by this import and unchanged, with no protected links.", "Candidate");
  }
  const rows = imported.map(({ recordKey }) => results.get(recordKey)!);
  const fingerprint = createHash("sha256").update(JSON.stringify({ importId: receipt.id, rows, removals })).digest("hex");
  const visibleRows = rows.map((row, index) => ({
    ...row, canOpen: Boolean(imported[index].targetId && (row.result === "Candidate" || row.result === "Keep")),
  }));
  return { preview: { receipt, rows: visibleRows, fingerprint }, removals };
}

// The workspace command holds the same SQLite transaction for the recheck and the undo.
export function undoMigration(db: Store, staff: WorkspaceStaff | null, input: UndoMigrationInput, now: string) {
  if (!staff?.brokerage.pilot || staff.brokerage.role !== "Admin") return { error: "Only a fictional pilot admin can undo a CRM import." };
  const receipt = importReceipt(db, input.importId);
  if (!receipt) return { error: "This CRM import receipt is unavailable in this brokerage." };
  const previous = db.prepare("SELECT rowCount FROM migration_import_undos WHERE importId = ? AND fingerprint = ?").get(receipt.id, input.fingerprint);
  if (previous) return { message: `Undo already recorded for ${previous.rowCount} CRM records.` };

  const { preview, removals } = buildRecoveryPlan(db, receipt);
  if (preview.fingerprint !== input.fingerprint) return { error: "The recovery preview changed. Refresh it and review the records before undoing." };
  if (!removals.length) return { error: "This import has no eligible records to undo." };
  const undoId = crypto.randomUUID();
  db.prepare("INSERT INTO migration_import_undos (id, importId, fingerprint, undoneAt, undoneBy, rowCount) VALUES (?, ?, ?, ?, ?, ?)")
    .run(undoId, receipt.id, input.fingerprint, now, staff.email, removals.length);
  const unlink = db.prepare("DELETE FROM migration_records WHERE origin = ? AND recordKey = ? AND targetId = ? RETURNING targetId");
  const tombstone = db.prepare("INSERT INTO migration_undone_records (origin, recordKey, undoId) VALUES (?, ?, ?)");
  for (const { key, table, id } of removals) {
    const column = primaryKey(table);
    const deleted = db.prepare(`DELETE FROM ${table} WHERE ${column} = ? RETURNING ${column}`).get(id);
    if (!deleted || !unlink.get(receipt.origin, key, id)) throw new Error("The CRM undo did not remove its expected record and source link.");
    tombstone.run(receipt.origin, key, undoId);
  }
  accessEvent(db, staff, "Undid CRM import records", receipt.id, now);
  return { message: `Removed ${removals.length} CRM ${removals.length === 1 ? "record" : "records"}. Undo recorded on the import receipt.` };
}

function hasProtectedLinks(db: Store, table: Table, id: string, row: Record<string, SqlValue>, eligible: Set<string>,
  suppression: Set<string>, importedAt: string) {
  if (table === "contacts") {
    const usage = db.prepare(`SELECT 1 FROM loans WHERE contactId = ? OR partnerId = ?
      UNION ALL SELECT 1 FROM communication_drafts WHERE contactId = ?
      UNION ALL SELECT 1 FROM realtor_portals WHERE realtorId = ?
      UNION ALL SELECT 1 FROM pilot_scenario WHERE realtorId = ?
      UNION ALL SELECT 1 FROM pilot_sample_contacts WHERE contactId = ?
      UNION ALL SELECT 1 FROM crm_contact_field_values WHERE recordId = ? LIMIT 1`).get(id, id, id, id, id, id, id);
    if (usage) return true;
    const links = db.prepare(`SELECT 'referral_leads:' || id AS linked FROM referral_leads WHERE importedContactId = ? OR realtorId = ?
      UNION ALL SELECT 'contact_activity:' || id FROM contact_activity WHERE contactId = ? LIMIT 101`).all(id, id, id);
    return links.some(({ linked }) => !eligible.has(String(linked)));
  }
  if (table === "referral_leads") {
    if (db.prepare("SELECT 1 FROM crm_lead_field_values WHERE recordId = ?").get(id)) return true;
    if (!eligible.has(`call_campaign_members:${id}`) && db.prepare("SELECT 1 FROM call_campaign_members WHERE leadId = ?").get(id)) return true;
    const links = db.prepare(`SELECT 'lead_events:' || id AS linked FROM lead_events WHERE leadId = ?
      UNION ALL SELECT 'lead_import_tasks:' || id FROM lead_import_tasks WHERE leadId = ? LIMIT 101`).all(id, id);
    return links.some(({ linked }) => !eligible.has(String(linked)));
  }
  if (table === "lead_import_tasks" || table === "lead_events" || table === "call_campaign_members") {
    const leadId = table === "call_campaign_members" ? id : row.leadId;
    const lead = db.prepare("SELECT email, phone, importedContactId AS contactId, loanId, resolvedAt FROM referral_leads WHERE id = ?").get(leadId);
    if (!lead || lead.loanId || lead.resolvedAt || outreachSuppressed(suppression, { ...lead, leadId }) ||
      db.prepare(`SELECT 1 FROM lead_events event WHERE event.leadId = ? AND event.at >= ?
        AND NOT EXISTS (SELECT 1 FROM migration_import_rows imported WHERE imported.targetId = event.id AND imported.storage = 'lead_events') LIMIT 1`)
        .get(leadId, importedAt)) return true;
    if (table === "lead_import_tasks" && db.prepare("SELECT leadId FROM call_campaign_members WHERE callbackTaskId = ?").all(id)
      .some(({ leadId }) => !eligible.has(`call_campaign_members:${leadId}`))) return true;
    if (table === "call_campaign_members" || eligible.has(`call_campaign_members:${leadId}`)) return false;
    if (table === "lead_import_tasks") {
      return !!db.prepare("SELECT 1 FROM campaign_follow_up_runs WHERE leadId = ? AND taskId = ? AND promiseRequestEventId IS NOT NULL LIMIT 1")
        .get(leadId, id);
    }
    return !!db.prepare(`SELECT 1 FROM campaign_follow_up_runs WHERE leadId = ? AND promiseRequestEventId IS NOT NULL
      AND (promiseRequestEventId = ? OR promiseAttemptEventId = ?) LIMIT 1`).get(leadId, id, id);
  }
  return table === "contact_activity" && !!db.prepare(`SELECT 1 FROM contact_follow_up_completions WHERE activityId = ?
    UNION ALL SELECT 1 FROM contact_callback_reschedules WHERE activityId = ? LIMIT 1`).get(id, id);
}

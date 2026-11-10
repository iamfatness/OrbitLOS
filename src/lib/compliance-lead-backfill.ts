import { z } from "zod";
import type { MigrationDestination } from "./migration-record-model";
import type { Store } from "./store";
import { searchTaskTarget } from "./workspace-search-model";

const kinds = ["Lead record", "Lead activity", "Existing task"] as const;
const position = z.string().min(1).max(200);
const revision = z.number().int().nonnegative();
const cursor = z.strictObject({ kind: z.enum(kinds), id: position, revision, unknownOnly: z.boolean() });
export const leadBackfillRead = z.strictObject({ type: z.literal("leadBackfill"), unknownOnly: z.boolean().optional(), after: cursor.optional() });
export const leadBackfillAdvance = z.strictObject({ type: z.literal("advanceLeadBackfill"), revision });

type Kind = (typeof kinds)[number];
type Run = { generation: string; revision: number; phase: number; lastId: string; scanned: number; unknown: number; stale: number; asOf: string };
type SourceRow = { id: string; leadId: string; at: string | null; event: string; source: string };
type Entry = { id: string; leadId: string; loanId: string | null; name: string; kind: Kind; event: string;
  source: string; sourceRef: string | null; occurredAt: string | null; recordedDate: string | null; destination: MigrationDestination | null };
type EntryRow = Omit<Entry, "destination"> & { leadState: "Active" | "Archived" | "Closed" };
type View = { kind: "leadBackfill"; state: "Not started" | "Stale" | "Scanning" | "Complete"; revision: number;
  scanned: number | null; unknown: number | null; asOf: string | null; entries: Entry[]; next: z.infer<typeof cursor> | null };

const pageSize = 25;
const phases: { kind: Kind; migrationPrefix: string; query: string }[] = [
  { kind: "Lead record", migrationPrefix: "Lead:*", query: `SELECT id, id AS leadId, createdAt AS at, 'Lead record created' AS event,
    CASE WHEN importSource = 'Website quote request' THEN 'Website quote form' WHEN realtorId IS NOT NULL THEN 'Realtor referral'
      ELSE 'Orbit lead record' END AS source FROM referral_leads WHERE id > ? ORDER BY id LIMIT ?` },
  { kind: "Lead activity", migrationPrefix: "Note:*", query: `SELECT id, leadId, at, kind AS event, 'Orbit lead history' AS source
    FROM lead_events WHERE id > ? ORDER BY id LIMIT ?` },
  { kind: "Existing task", migrationPrefix: "Task:*", query: `SELECT id, leadId, at,
    CASE WHEN at IS NULL THEN 'Task recorded' ELSE 'Task completed' END AS event, 'Orbit lead task' AS source
    FROM (SELECT original.id, original.leadId,
      CASE WHEN carried.id IS NULL THEN original.completedAt ELSE carried.completedAt END AS at
      FROM lead_import_tasks original JOIN referral_leads lead ON lead.id = original.leadId
      LEFT JOIN tasks carried ON carried.id = original.id AND carried.loanId = lead.loanId
      WHERE original.id > ? ORDER BY original.id LIMIT ?)` },
  { kind: "Lead activity", migrationPrefix: "Note:*", query: `SELECT event.id, lead.id AS leadId, event.createdAt AS at,
    coalesce(event.kind, 'Note') AS event, 'CRM import' AS source FROM activity event JOIN referral_leads lead ON lead.loanId = event.loanId
    WHERE event.id > ? AND EXISTS (SELECT 1 FROM migration_records WHERE targetId = event.id AND recordKey GLOB 'Note:*')
    AND NOT EXISTS (SELECT 1 FROM lead_events WHERE id = event.id) ORDER BY event.id LIMIT ?` },
  { kind: "Existing task", migrationPrefix: "Task:*", query: `SELECT task.id, lead.id AS leadId, task.completedAt AS at,
    CASE WHEN task.completedAt IS NULL THEN 'Task recorded' ELSE 'Task completed' END AS event, 'CRM import' AS source
    FROM tasks task JOIN referral_leads lead ON lead.loanId = task.loanId
    WHERE task.id > ? AND EXISTS (SELECT 1 FROM migration_records WHERE targetId = task.id AND recordKey GLOB 'Task:*')
    AND NOT EXISTS (SELECT 1 FROM lead_import_tasks WHERE id = task.id) ORDER BY task.id LIMIT ?` },
];

export function initializeComplianceLeadBackfill(db: Store) {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'complianceLeadBackfillSchema:1'").get()) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_lead_backfill (
      brokerageId TEXT PRIMARY KEY, generation TEXT NOT NULL, revision INTEGER NOT NULL,
      phase INTEGER NOT NULL, lastId TEXT NOT NULL, scanned INTEGER NOT NULL, unknown INTEGER NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0, asOf TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS compliance_lead_backfill_entries (
      brokerageId TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, generation TEXT NOT NULL,
      leadId TEXT NOT NULL REFERENCES referral_leads(id) ON DELETE CASCADE,
      event TEXT NOT NULL, source TEXT NOT NULL, sourceRef TEXT, occurredAt TEXT, recordedDate TEXT,
      PRIMARY KEY (brokerageId, kind, id)
    );
    CREATE INDEX IF NOT EXISTS compliance_lead_backfill_page ON compliance_lead_backfill_entries(brokerageId, generation, kind, id);
    CREATE INDEX IF NOT EXISTS compliance_lead_backfill_unknown ON compliance_lead_backfill_entries(brokerageId, generation, kind, id)
      WHERE occurredAt IS NULL;
    CREATE INDEX IF NOT EXISTS compliance_lead_backfill_source_lead ON compliance_lead_backfill_entries(leadId);
  `);
  // Each source edit and its invalidation commit together, including edits behind the scan cursor.
  const tables = {
    referral_leads: "createdAt, importSource, realtorId, loanId",
    lead_events: "leadId, at, kind",
    lead_import_tasks: "leadId, completedAt",
    activity: "loanId, createdAt, kind",
    tasks: "loanId, completedAt",
    migration_records: "origin, recordKey, targetId",
  };
  const linked = (row: "NEW" | "OLD") => `EXISTS (SELECT 1 FROM referral_leads WHERE loanId = ${row}.loanId)`;
  const imported = (row: "NEW" | "OLD") => `(${row}.recordKey GLOB 'Lead:*' OR ${row}.recordKey GLOB 'Note:*' OR ${row}.recordKey GLOB 'Task:*')`;
  for (const [table, fields] of Object.entries(tables)) {
    for (const operation of ["INSERT", "UPDATE", "DELETE"] as const) {
      const event = operation === "UPDATE" ? `UPDATE OF ${fields}` : operation;
      const condition = table === "activity" || table === "tasks" ? linked : table === "migration_records" ? imported : null;
      const versions = operation === "INSERT" ? ["NEW"] as const : operation === "DELETE" ? ["OLD"] as const : ["NEW", "OLD"] as const;
      db.exec(`CREATE TRIGGER IF NOT EXISTS compliance_lead_backfill_${table}_${operation} AFTER ${event} ON ${table}
        ${condition ? `WHEN ${versions.map(condition).join(" OR ")}` : ""}
        BEGIN UPDATE compliance_lead_backfill SET stale = 1, revision = revision + 1 WHERE stale = 0; END;`);
    }
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('complianceLeadBackfillSchema:1', '1')").run();
}

function readRun(db: Store, brokerageId: string) {
  return db.prepare("SELECT * FROM compliance_lead_backfill WHERE brokerageId = ?").get(brokerageId) as Run | undefined;
}

const exactTimestamp = z.iso.datetime({ offset: true });
const dateOnly = z.iso.date();

function sourceDate(value: string | null, migrated: boolean) {
  if (!value) return { at: null, date: null };
  if (dateOnly.safeParse(value).success) return { at: null, date: value };
  if (!exactTimestamp.safeParse(value).success) return { at: null, date: null };
  // Legacy migration stored date-only values at 17:00 UTC. A real event at the same instant is indistinguishable.
  if (migrated && /T17:00:00\.000Z$/.test(value)) return { at: null, date: value.slice(0, 10) };
  return { at: value, date: null };
}

export function readLeadBackfill(db: Store, brokerageId: string, data: z.infer<typeof leadBackfillRead>): View | { error: string } {
  const run = readRun(db, brokerageId);
  const unknownOnly = data.unknownOnly ?? false;
  if (data.after && (!run || run.stale || data.after.revision !== run.revision || data.after.unknownOnly !== unknownOnly)) {
    return { error: "Lead history changed. Open the first page again." };
  }
  const entries = run && !run.stale ? db.prepare(`SELECT entry.id, entry.leadId, lead.loanId, lead.name, entry.kind, entry.event,
    CASE WHEN lead.archiveToken IS NOT NULL THEN 'Archived' WHEN lead.resolvedAt IS NOT NULL THEN 'Closed' ELSE 'Active' END AS leadState,
    entry.source, entry.sourceRef, entry.occurredAt, entry.recordedDate FROM compliance_lead_backfill_entries entry
    JOIN referral_leads lead ON lead.id = entry.leadId WHERE entry.brokerageId = ? AND entry.generation = ?
    ${unknownOnly ? "AND entry.occurredAt IS NULL" : ""} AND (entry.kind, entry.id) > (?, ?)
    ORDER BY entry.kind, entry.id LIMIT ?`).all(brokerageId, run.generation, data.after?.kind ?? "", data.after?.id ?? "", pageSize + 1) as EntryRow[] : [];
  const last = entries[pageSize - 1];
  return { kind: "leadBackfill", state: !run ? "Not started" : run.stale ? "Stale" : run.phase === phases.length ? "Complete" : "Scanning",
    revision: run?.revision ?? 0, scanned: run && !run.stale ? run.scanned : null, unknown: run && !run.stale ? run.unknown : null,
    asOf: run?.asOf ?? null, entries: entries.slice(0, pageSize).map(({ leadState, ...entry }): Entry => ({
      ...entry,
      destination: entry.loanId ? { kind: "loan", id: entry.loanId, target: entry.kind === "Existing task" ? searchTaskTarget(entry.id) : "loan-activity" } :
        leadState === "Closed" ? null : { kind: leadState === "Archived" ? "archivedLead" : "lead", id: entry.leadId },
    })), next: run && entries.length > pageSize
      ? { kind: last.kind, id: last.id, revision: run.revision, unknownOnly } : null };
}

export function advanceLeadBackfill(db: Store, brokerageId: string, revision: number, now: string) {
  const prior = readRun(db, brokerageId);
  const view = () => readLeadBackfill(db, brokerageId, { type: "leadBackfill" });
  if ((prior?.revision ?? 0) !== revision || (prior?.phase === phases.length && !prior.stale)) return view();
  const active = prior?.stale ? undefined : prior;
  const generation = active?.generation ?? crypto.randomUUID();
  let phase = active?.phase ?? 0;
  let lastId = active?.lastId ?? "";
  let count = 0;
  let unknown = active?.unknown ?? 0;
  const migration = db.prepare(`SELECT origin, recordKey FROM migration_records WHERE targetId = ? AND recordKey GLOB ?
    ORDER BY origin, recordKey LIMIT 1`);
  const record = db.prepare(`INSERT INTO compliance_lead_backfill_entries
    (brokerageId, kind, id, generation, leadId, event, source, sourceRef, occurredAt, recordedDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (brokerageId, kind, id) DO UPDATE SET generation = excluded.generation, leadId = excluded.leadId,
    event = excluded.event, source = excluded.source, sourceRef = excluded.sourceRef,
    occurredAt = excluded.occurredAt, recordedDate = excluded.recordedDate`);
  while (phase < phases.length) {
    const { kind, migrationPrefix, query } = phases[phase];
    const remaining = pageSize - count;
    const rows = db.prepare(query).all(lastId, remaining + 1) as SourceRow[];
    for (const row of rows.slice(0, remaining)) {
      const imported = migration.get(row.id, migrationPrefix);
      const { at, date } = sourceDate(row.at, Boolean(imported));
      record.run(brokerageId, kind, row.id, generation, row.leadId, row.event,
        imported ? "CRM import" : row.source, imported ? `${imported.origin} · ${imported.recordKey}` : null, at, date);
      lastId = row.id;
      count++;
      if (!at) unknown++;
    }
    if (rows.length > remaining) break;
    phase++;
    lastId = "";
  }
  db.prepare(`INSERT INTO compliance_lead_backfill (brokerageId, generation, revision, phase, lastId, scanned, unknown, asOf)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (brokerageId) DO UPDATE SET generation = excluded.generation,
    revision = excluded.revision, phase = excluded.phase, lastId = excluded.lastId, scanned = excluded.scanned,
    unknown = excluded.unknown, stale = 0, asOf = excluded.asOf`)
    .run(brokerageId, generation, revision + 1, phase, lastId, (active?.scanned ?? 0) + count, unknown, now);
  return view();
}

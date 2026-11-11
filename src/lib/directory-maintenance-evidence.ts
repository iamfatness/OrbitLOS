import { createHash } from "node:crypto";
import { z } from "zod";
import { checkpointCanonical } from "./recovery-checkpoint-canonical";
import type { Store } from "./store";

const sources = [
  { group: "maintenance", table: "brokerage_maintenance", pending: "mode != 'Open'" },
  { group: "history", table: "brokerage_maintenance_history", pending: "0" },
  { group: "decisions", table: "brokerage_maintenance_decisions", pending: "0" },
  { group: "edits", table: "brokerage_recovery_edits", pending: "state = 'Pending'" },
  { group: "replays", table: "brokerage_recovery_replays", pending: "state = 'Pending'" },
  { group: "checkpoints", table: "brokerage_recovery_checkpoints", pending: "0" },
  { group: "checkpointParts", table: "brokerage_checkpoint_parts", pending: "0" },
  { group: "restores", table: "brokerage_restore_jobs", pending: "state != 'Restored'" },
] as const;

const groupNames = sources.map(({ group }) => group);
const maxRows = 5000;
const pageSize = 4;
const maxBytes = 32 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const count = z.number().int().min(0).max(maxRows);

export const maintenanceEvidenceRows = z.array(z.strictObject({
  brokerageId: z.uuid(),
  group: z.enum(groupNames),
  rows: count,
  pending: count,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
})).max(sources.length * maxRows);

type MaintenanceEvidence = z.infer<typeof maintenanceEvidenceRows>;

export function readDirectoryMaintenanceEvidence(db: Store): MaintenanceEvidence {
  const result: MaintenanceEvidence = [];
  let bytes = 0;
  for (const source of sources) {
    const parts = source.group === "checkpointParts";
    const brokerage = parts ? "parent.brokerageId" : "entry.brokerageId";
    const join = parts ? "LEFT JOIN brokerage_recovery_checkpoints parent ON parent.id = entry.checkpointId" : "";
    const page = db.prepare(`SELECT entry.rowid AS cursor, ${brokerage} AS workspace, (${source.pending}) AS pending, entry.*
      FROM ${source.table} entry ${join} WHERE entry.rowid > ? ORDER BY entry.rowid LIMIT ?`);
    const workspaces = new Map<string, { pending: number; digests: string[] }>();
    let cursor = 0;
    let rows = 0;
    for (;;) {
      const batch = page.all(cursor, pageSize);
      for (const { cursor: rowId, workspace, pending, ...record } of batch) {
        if (typeof workspace !== "string" || ++rows > maxRows) throw new Error("Maintenance evidence exceeds the inspection scope.");
        const encoded = checkpointCanonical(record);
        bytes += Buffer.byteLength(encoded);
        if (bytes > maxBytes) throw new Error("Maintenance evidence exceeds the inspection limit.");
        const summary = workspaces.get(workspace) ?? { pending: 0, digests: [] };
        summary.pending += Number(pending);
        summary.digests.push(hash(encoded));
        workspaces.set(workspace, summary);
        cursor = Number(rowId);
      }
      if (batch.length < pageSize) break;
    }
    for (const [brokerageId, { pending, digests }] of [...workspaces].sort(([a], [b]) => a.localeCompare(b))) {
      result.push({ brokerageId, group: source.group, rows: digests.length, pending, digest: hash(digests.sort().join("")) });
    }
  }
  return maintenanceEvidenceRows.parse(result);
}

export function compareDirectoryMaintenanceEvidence(saved: MaintenanceEvidence | undefined, current: MaintenanceEvidence) {
  const key = (row: MaintenanceEvidence[number]) => `${row.brokerageId}/${row.group}`;
  const previous = new Map(saved?.map(row => [key(row), row]));
  const restored = new Map(current.map(row => [key(row), row]));
  const changes = [...new Set([...previous.keys(), ...restored.keys()])].sort().flatMap(entry => {
    const before = previous.get(entry);
    const after = restored.get(entry);
    const row = before ?? after;
    if (!row || before?.digest === after?.digest) return [];
    return [{ brokerageId: row.brokerageId, group: row.group, saved: before?.rows ?? 0, current: after?.rows ?? 0,
      savedPending: before?.pending ?? 0, currentPending: after?.pending ?? 0 }];
  });
  return {
    status: saved === undefined ? "unavailable" : changes.length ? "changed" : "matched",
    changes: saved === undefined ? [] : changes,
    pending: current.filter(row => row.pending > 0).map(({ brokerageId, group, pending }) => ({ brokerageId, group, pending })),
  };
}

import { z } from "zod";
import { inventoryBuckets, type InventoryBucket } from "./compliance-case-model";
import type { SqlValue, Store } from "./store";

const revision = z.number().int().nonnegative();
export const inventoryRead = z.strictObject({ type: z.literal("inventory"), bucket: z.enum(inventoryBuckets).optional(),
  after: z.object({ loanId: z.string().min(1).max(100), revision, bucket: z.enum(inventoryBuckets) }).optional() });
export const inventoryAdvance = z.strictObject({ type: z.literal("advanceInventory"), revision });

const batchSize = 25;
type Inventory = { generation: string; revision: number; lastLoanId: string; scanned: number; counts: string; complete: number; stale: number; asOf: string };
type BucketCounts = Partial<Record<InventoryBucket, number>>;
type InventoryView = { kind: "inventory"; state: "Not started" | "Stale" | "Complete" | "Scanning";
  revision: number; scanned: number | null; asOf: string | null; counts: { bucket: InventoryBucket; count: number }[];
  files: { loanId: string; name: string }[]; next: z.infer<typeof inventoryRead>["after"] | null };

function currentInventory(db: Store, brokerageId: string) {
  return db.prepare("SELECT * FROM compliance_inventory WHERE brokerageId = ?").get(brokerageId) as Inventory | undefined;
}

export function currentPackage(db: Store, loanId: string) {
  return db.prepare(`SELECT version, revision, supersededAt, runId, reviewReason FROM disclosure_packages WHERE loanId = ? ORDER BY version DESC LIMIT 1`).get(loanId);
}

export function samplePackage(db: Store, loanId: string) {
  const loan = db.prepare(`SELECT loan.officerEmail FROM loans loan JOIN applications app ON app.loanId = loan.id
    WHERE loan.id = ? AND loan.purpose = 'Purchase' AND (CASE WHEN json_valid(app.draft) THEN json_extract(app.draft, '$.propertyLocation.state') END) = 'MI'`).get(loanId);
  const packageRow = currentPackage(db, loanId);
  if (!loan || !packageRow || packageRow.supersededAt || packageRow.reviewReason || !db.prepare(`SELECT 1 FROM pricing_runs WHERE id = ? AND loanId = ? AND mode = 'mock'
      AND json_extract(scenario, '$.purpose') = 'Purchase' AND json_type(scenario, '$.nonAgency') IS NULL`).get(packageRow.runId, loanId)) return null;
  return { version: Number(packageRow.version), revision: Number(packageRow.revision), officerEmail: loan.officerEmail };
}

export function sampleWorkbenchReview(db: Store, loanId: string, version: number, revision: SqlValue) {
  return db.prepare(`SELECT reviewedAt, actor FROM closing_disclosure_reviews WHERE loanId = ? AND version = ? AND revision = ?`)
    .get(loanId, version, revision);
}

export function readInventory(db: Store, brokerageId: string, data: z.infer<typeof inventoryRead>): InventoryView | { error: string } {
  const run = currentInventory(db, brokerageId);
  const { bucket, after } = data;
  const state = !run ? "Not started" : run.stale ? "Stale" : run.complete ? "Complete" : "Scanning";
  if (after && (!run || run.stale || bucket !== after.bucket || after.revision !== run.revision)) {
    return { error: "The inventory changed. Open the first page again." };
  }
  const counts = run && !run.stale ? JSON.parse(run.counts) as BucketCounts : {};
  const files = run && !run.stale && bucket ? db.prepare(`SELECT file.loanId, contact.name FROM compliance_inventory_files file
    JOIN loans loan ON loan.id = file.loanId JOIN contacts contact ON contact.id = loan.contactId
    WHERE file.brokerageId = ? AND file.generation = ? AND file.bucket = ? AND file.loanId > ?
    ORDER BY file.loanId LIMIT ?`).all(brokerageId, run.generation, bucket, after?.loanId ?? "", batchSize + 1) : [];
  const next = files.length > batchSize && run && bucket ? { loanId: String(files[batchSize - 1].loanId), revision: run.revision, bucket } : null;
  return { kind: "inventory", state, revision: run?.revision ?? 0, scanned: run && !run.stale ? run.scanned : null, asOf: run?.asOf ?? null,
    counts: inventoryBuckets.map((label) => ({ bucket: label, count: counts[label] ?? 0 })),
    files: files.slice(0, batchSize).map((file) => ({ loanId: String(file.loanId), name: String(file.name) })), next };
}

export function advanceInventory(db: Store, brokerageId: string, revision: number, now: string) {
  const prior = currentInventory(db, brokerageId);
  if ((prior?.revision ?? 0) !== revision || (prior?.complete && !prior.stale)) return readInventory(db, brokerageId, { type: "inventory" });
  const continuing = prior && !prior.stale;
  const generation = continuing ? prior.generation : crypto.randomUUID();
  const after = continuing ? prior.lastLoanId : "";
  const counts: BucketCounts = continuing ? JSON.parse(prior.counts) as BucketCounts : {};
  const loans = db.prepare(`SELECT loan.id, loan.purpose, CASE WHEN json_valid(app.draft) THEN json_extract(app.draft, '$.propertyLocation.state') END AS state
    FROM loans loan LEFT JOIN applications app ON app.loanId = loan.id WHERE loan.id > ? ORDER BY loan.id LIMIT ?`).all(after, batchSize + 1);
  const record = db.prepare(`INSERT INTO compliance_inventory_files (brokerageId, loanId, generation, bucket) VALUES (?, ?, ?, ?)
    ON CONFLICT (brokerageId, loanId) DO UPDATE SET generation = excluded.generation, bucket = excluded.bucket`);
  const batch = loans.slice(0, batchSize);
  for (const loan of batch) {
    const loanId = String(loan.id);
    const state = typeof loan.state === "string" ? loan.state.trim() : "";
    const pkg = loan.purpose === "Purchase" && state === "MI" ? samplePackage(db, loanId) : null;
    const bucket: InventoryBucket = loan.purpose !== "Purchase" || (state && state !== "MI") ? "Outside sample scope" :
      !state ? "Scope unknown" : !pkg ? "Sample package needed" :
        sampleWorkbenchReview(db, loanId, pkg.version, pkg.revision) ? "Sample review available" : "Sample review needed";
    record.run(brokerageId, loanId, generation, bucket);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  db.prepare(`INSERT INTO compliance_inventory (brokerageId, generation, revision, lastLoanId, scanned, counts, complete, asOf)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (brokerageId) DO UPDATE SET generation = excluded.generation,
    revision = excluded.revision, lastLoanId = excluded.lastLoanId, scanned = excluded.scanned, counts = excluded.counts,
    complete = excluded.complete, stale = 0, asOf = excluded.asOf`)
    .run(brokerageId, generation, revision + 1, String(batch.at(-1)?.id ?? after), (continuing ? prior.scanned : 0) + batch.length,
      JSON.stringify(counts), loans.length <= batchSize ? 1 : 0, now);
  return readInventory(db, brokerageId, { type: "inventory" });
}

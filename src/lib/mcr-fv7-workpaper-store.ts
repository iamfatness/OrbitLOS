import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { quarterName } from "./call-report-quarter-model";
import { fv7EvidenceFileLimit, type Fv7SavedWorkpaper, type Fv7Workpaper,
  type ReportingReadiness, type ReportingReadinessInput } from "./call-report-readiness-model";
import { buildFv7QuarterWorkpaper, fv7EvidenceTemplate } from "./mcr-fv7-quarter-evidence";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type Input = Extract<ReportingReadinessInput, { type: "fv7Template" | "fv7Preview" | "fv7Save" | "fv7History" | "fv7Read" }>;
type Stored = Omit<Fv7SavedWorkpaper, "reconciled"> & { reconciled: number };
const columns = "sequence, version, entityReference, reconciled, recordedAt, recordedBy";
const pageSize = 10;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const summary = (row: Stored): Fv7SavedWorkpaper => ({ sequence: row.sequence, version: row.version,
  entityReference: row.entityReference, reconciled: Boolean(row.reconciled), recordedAt: row.recordedAt, recordedBy: row.recordedBy });

export function initializeFv7Workpapers(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS mcr_fv7_workpapers (
    year INTEGER NOT NULL, quarter INTEGER NOT NULL, sequence INTEGER NOT NULL, version INTEGER NOT NULL,
    evidence TEXT NOT NULL, evidenceHash TEXT NOT NULL, result TEXT NOT NULL, checked TEXT NOT NULL,
    entityReference TEXT NOT NULL, reconciled INTEGER NOT NULL, recordedAt TEXT NOT NULL, recordedBy TEXT NOT NULL,
    PRIMARY KEY (year, quarter, sequence), UNIQUE (year, quarter, version, evidenceHash, checked),
    FOREIGN KEY (year, quarter, version) REFERENCES call_report_quarter_reviews(year, quarter, version)
  );`);
}

export function fv7WorkpaperWork(db: Store, input: Input, staff: WorkspaceStaff, now: string): ReportingReadiness {
  const { year, quarter } = input;
  if (!staff.brokerage.pilot || year !== 2026) return { error: "Choose a saved 2026 quarter in a fictional pilot workspace." };
  return db.transaction(() => {
    if (input.type === "fv7History") {
      const rows = db.prepare(`SELECT ${columns} FROM mcr_fv7_workpapers
        WHERE year = ? AND quarter = ? ${input.before === undefined ? "" : "AND sequence < ?"}
        ORDER BY sequence DESC LIMIT ?`).all(year, quarter,
        ...(input.before === undefined ? [] : [input.before]), pageSize + 1) as unknown as Stored[];
      const items = rows.slice(0, pageSize).map(summary);
      return { kind: "fv7History", items, next: rows.length > pageSize ? items.at(-1)?.sequence ?? null : null };
    }
    if (input.type === "fv7Read") {
      const row = db.prepare(`SELECT ${columns}, evidence, evidenceHash, result, checked FROM mcr_fv7_workpapers
        WHERE year = ? AND quarter = ? AND sequence = ?`).get(year, quarter, input.sequence) as
        (Stored & { evidence: string; evidenceHash: string; result: string; checked: string }) | undefined;
      if (!row) return { error: "That workpaper is unavailable for the selected quarter." };
      if (sha256(row.evidence) !== row.evidenceHash || sha256(row.evidenceHash + ":" + row.result) !== row.checked) {
        return { error: "The saved workpaper did not pass its integrity check." };
      }
      return { kind: "fv7Read", saved: summary(row), workpaper: JSON.parse(row.result) as Fv7Workpaper, evidence: row.evidence };
    }
    const { version } = input;
    const row = db.prepare("SELECT csv, closed FROM call_report_quarter_reviews WHERE year = ? AND quarter = ? AND version = ?")
      .get(year, quarter, version);
    if (!row?.closed) return { error: "Choose a saved review captured after this quarter ended." };
    const csv = String(row.csv);
    if (Buffer.byteLength(csv) > fv7EvidenceFileLimit) return { error: "This saved review exceeds the pilot workpaper size limit." };
    if (input.type === "fv7Template") {
      try {
        return { kind: "fv7Template", version, json: JSON.stringify(fv7EvidenceTemplate(csv, year, quarter, version), null, 2) };
      } catch {
        return { error: "This saved review could not be used to create an evidence template." };
      }
    }
    if (Buffer.byteLength(input.evidence) > fv7EvidenceFileLimit) return { error: "Choose an evidence file under 1 MB." };
    const evidenceHash = sha256(input.evidence);
    if (input.type === "fv7Save") {
      const existing = db.prepare(`SELECT ${columns} FROM mcr_fv7_workpapers
        WHERE year = ? AND quarter = ? AND version = ? AND evidenceHash = ? AND checked = ?`)
        .get(year, quarter, version, evidenceHash, input.checked) as Stored | undefined;
      if (existing) return { kind: "fv7Saved", saved: summary(existing) };
    }
    let evidence: unknown;
    try {
      evidence = JSON.parse(input.evidence);
    } catch {
      return { error: "The evidence file is not valid JSON. Correct it or download a fresh template." };
    }
    let workpaper: Fv7Workpaper;
    try {
      workpaper = buildFv7QuarterWorkpaper(csv, evidence);
    } catch (error) {
      if (error instanceof ZodError) {
        return { error: `Review the evidence field ${error.issues[0]?.path.join(".") || "at the root"} and try again.` };
      }
      return { error: error instanceof Error ? error.message : "Could not reconcile the saved review." };
    }
    const result = JSON.stringify(workpaper);
    const checked = sha256(evidenceHash + ":" + result);
    if (input.type === "fv7Preview") return { kind: "fv7Preview", workpaper, checked };
    if (checked !== input.checked) return { error: "The workpaper differs from the checked result. Check the evidence again before saving." };
    if (Buffer.byteLength(result) > 6_000_000) return { error: "This result exceeds the pilot workpaper storage limit." };
    const sequence = Number(db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM mcr_fv7_workpapers WHERE year = ? AND quarter = ?")
      .get(year, quarter)?.next ?? 1);
    const saved = { sequence, version, entityReference: workpaper.evidence.entityReference,
      reconciled: workpaper.reconciled, recordedAt: now, recordedBy: staff.name };
    db.prepare(`INSERT INTO mcr_fv7_workpapers
      (year, quarter, sequence, version, evidence, evidenceHash, result, checked, entityReference, reconciled, recordedAt, recordedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(year, quarter, sequence, version, input.evidence, evidenceHash, result, checked,
        saved.entityReference, Number(saved.reconciled), now, staff.name);
    accessEvent(db, staff, "Saved FV7 internal workpaper", `${quarterName(input)} review v${version} · workpaper #${sequence}`, now);
    return { kind: "fv7Saved", saved };
  });
}

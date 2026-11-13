import { easternDate } from "./client-retention";
import { newYorkApplicationLogSource } from "./new-york-application-log-model";
import { reviewNewYorkExamRecord, type NewYorkExamRecordFacts, type NewYorkExamRecordsRequest } from "./new-york-exam-records-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type Entity = { name: string; nmls: string };
type Stored = { recordId: string; version: number; facts: string; finding: string; entity: string;
  at: string; actor: string; correction: string | null };
const pageSize = 20;
const exportLimit = 3000;
const stale = { error: "This New York examination record changed. Reload before recording another version." };
const key = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();

export function initializeNewYorkExamRecords(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS new_york_exam_records (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, recordId TEXT NOT NULL, version INTEGER NOT NULL,
    category TEXT NOT NULL, fileKey TEXT NOT NULL, eventOn TEXT NOT NULL, facts TEXT NOT NULL, finding TEXT NOT NULL,
    entity TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL, actorRevision INTEGER NOT NULL,
    requestId TEXT NOT NULL, request TEXT NOT NULL, correction TEXT,
    PRIMARY KEY(brokerageId,entityId,recordId,version), UNIQUE(brokerageId,requestId)
  );
  CREATE INDEX IF NOT EXISTS new_york_exam_records_listing ON new_york_exam_records(brokerageId,entityId,category,eventOn,recordId);`);
}

const latest = `NOT EXISTS (SELECT 1 FROM new_york_exam_records newer
  WHERE newer.brokerageId=r.brokerageId AND newer.entityId=r.entityId AND newer.recordId=r.recordId AND newer.version>r.version)`;

function entry({ recordId, version, facts, finding, entity, at, actor, correction }: Stored) {
  return { recordId, version, facts: JSON.parse(facts) as NewYorkExamRecordFacts,
    finding: JSON.parse(finding) as ReturnType<typeof reviewNewYorkExamRecord>, entity: JSON.parse(entity) as Entity, at, actor, correction };
}
type Entry = ReturnType<typeof entry>;
export type NewYorkExamRecordsResult =
  | { kind: "newYorkExamRecordsList"; records: Entry[]; next: number | null }
  | { kind: "newYorkExamRecordsHistory"; versions: Entry[]; next: number | null }
  | { kind: "newYorkExamRecordsExport"; count: number; json: string }
  | { error: string };

export function newYorkExamRecordsWork(db: Store, { entityId, input }: NewYorkExamRecordsRequest, staff: WorkspaceStaff, now: string): NewYorkExamRecordsResult {
  const scope = [staff.brokerage.id, entityId] as const;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(...scope) as Entity | undefined;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  const today = easternDate(new Date(now));
  if (input.operation === "list") {
    const rows = db.prepare(`SELECT r.* FROM new_york_exam_records r WHERE r.brokerageId=? AND r.entityId=?
      AND r.category=? AND instr(r.fileKey,?)>0 AND ${latest} ORDER BY r.eventOn DESC,r.recordId LIMIT ? OFFSET ?`)
      .all(...scope, input.category, key(input.search), pageSize + 1, input.offset) as Stored[];
    return { kind: "newYorkExamRecordsList", records: rows.slice(0, pageSize).map(entry), next: rows.length > pageSize ? input.offset + pageSize : null };
  }
  if (input.operation === "export") {
    if (input.from > input.through || input.through > today) return { error: "Choose an ordered date range through today." };
    const rows = db.prepare(`WITH selected AS (
      SELECT DISTINCT recordId FROM new_york_exam_records WHERE brokerageId=? AND entityId=? AND category=? AND eventOn BETWEEN ? AND ?
    ) SELECT r.* FROM new_york_exam_records r JOIN selected s ON r.recordId=s.recordId
    WHERE r.brokerageId=? AND r.entityId=? ORDER BY r.recordId,r.version DESC LIMIT ?`)
      .all(...scope, input.category, input.from, input.through, ...scope, exportLimit + 1) as Stored[];
    if (rows.length > exportLimit) return { error: "This export exceeds 3,000 record versions. Narrow the date range." };
    accessEvent(db, staff, "Exported New York examination records", entityId, now);
    return { kind: "newYorkExamRecordsExport", count: new Set(rows.map(row => row.recordId)).size, json: JSON.stringify({
      format: 1, entityId, entity, category: input.category, from: input.from, through: input.through, preparedAt: now,
      source: newYorkApplicationLogSource, versions: rows.map(entry),
    }, null, 2) };
  }

  const target = [...scope, input.recordId] as const;
  const history = (before: number | null): NewYorkExamRecordsResult => {
    const rows = db.prepare(`SELECT * FROM new_york_exam_records WHERE brokerageId=? AND entityId=? AND recordId=?
      AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`).all(...target, before, before, pageSize + 1) as Stored[];
    const versions = rows.slice(0, pageSize).map(entry);
    return { kind: "newYorkExamRecordsHistory", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null };
  };
  if (input.operation === "history") return history(input.before ?? null);
  const { facts, expected, correction, requestId } = input;
  const request = JSON.stringify(input);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const prior = db.prepare("SELECT entityId,request,actorEmail,actorRevision FROM new_york_exam_records WHERE brokerageId=? AND requestId=?")
    .get(scope[0], requestId);
  if (prior) return prior.entityId === entityId && prior.request === request && prior.actorEmail === staff.email &&
    prior.actorRevision === actorRevision ? history(null) : stale;
  const current = db.prepare("SELECT version,category FROM new_york_exam_records WHERE brokerageId=? AND entityId=? AND recordId=? ORDER BY version DESC LIMIT 1")
    .get(...target);
  if ((current?.version ?? 0) !== expected) return stale;
  if (current && current.category !== facts.category) return { error: "Use the matching New York examination register for this record." };
  if (current && !correction) return { error: "Enter a reason for changing this examination record." };
  const dates = [facts.on, facts.retrieval?.on, facts.retentionBasis?.on, ...(facts.category === "Written consumer complaint" ? facts.actions.map(item => item.on) : [])];
  if (dates.some(on => on && on > today)) return { error: "Record examination events that have already occurred." };
  const fileKey = key(facts.fileNumber);
  if (db.prepare(`SELECT 1 FROM new_york_exam_records r WHERE r.brokerageId=? AND r.entityId=? AND r.recordId<>?
    AND r.category=? AND r.fileKey=? AND ${latest}`).get(...target, facts.category, fileKey))
    return { error: "This register already contains the file number." };
  db.prepare(`INSERT INTO new_york_exam_records (brokerageId,entityId,recordId,version,category,fileKey,eventOn,facts,finding,
    entity,at,actor,actorEmail,actorRevision,requestId,request,correction) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...target, expected + 1, facts.category, fileKey, facts.on, JSON.stringify(facts), JSON.stringify(reviewNewYorkExamRecord(facts)),
      JSON.stringify(entity), now, staff.name, staff.email, actorRevision, requestId, request, correction ?? null);
  accessEvent(db, staff, "Recorded New York examination evidence", input.recordId, now);
  return history(null);
}

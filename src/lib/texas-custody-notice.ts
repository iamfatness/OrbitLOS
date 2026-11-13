import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { reviewTexasCustodyNotice, type TexasCustodyNoticeFacts, type TexasCustodyNoticeRequest } from "./texas-custody-notice-model";
import { accessEvent } from "./workspace-access";

type Entity = { name: string; nmls: string };
type Row = { noticeId: string; version: number; facts: string; finding: string; entity: string; at: string; actor: string; correction: string | null };
const pageSize = 20;
const stale = { error: "This Texas custody notice changed. Reload before recording another version." };

export function initializeTexasCustodyNotices(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS texas_custody_notices (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, noticeId TEXT NOT NULL, version INTEGER NOT NULL,
    triggerOn TEXT NOT NULL, facts TEXT NOT NULL, finding TEXT NOT NULL, entity TEXT NOT NULL, at TEXT NOT NULL,
    actor TEXT NOT NULL, actorEmail TEXT NOT NULL, actorRevision INTEGER NOT NULL,
    requestId TEXT NOT NULL, request TEXT NOT NULL, correction TEXT,
    PRIMARY KEY (brokerageId,entityId,noticeId,version), UNIQUE (brokerageId,requestId)
  );
  CREATE INDEX IF NOT EXISTS texas_custody_notices_listing ON texas_custody_notices(brokerageId,entityId,triggerOn,noticeId);`);
}

function localDate(at: string, timeZone: TexasCustodyNoticeFacts["zone"]) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

function entry({ noticeId, version, facts, finding, entity, at, actor, correction }: Row) {
  return { noticeId, version, facts: JSON.parse(facts) as TexasCustodyNoticeFacts,
    finding: JSON.parse(finding) as ReturnType<typeof reviewTexasCustodyNotice>,
    entity: JSON.parse(entity) as Entity, at, actor, correction };
}
type Entry = ReturnType<typeof entry>;
export type TexasCustodyNoticeResult =
  | { kind: "texasCustodyNoticeList"; items: (Entry & { currentFinding: Entry["finding"] })[]; next: number | null }
  | { kind: "texasCustodyNoticeHistory"; versions: Entry[]; next: number | null }
  | { error: string };

export function texasCustodyNoticeWork(db: Store, { entityId, input }: TexasCustodyNoticeRequest, staff: WorkspaceStaff, now: string): TexasCustodyNoticeResult {
  const scope = [staff.brokerage.id, entityId] as const;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(...scope) as Entity | undefined;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (input.operation === "list") {
    const rows = db.prepare(`SELECT r.* FROM texas_custody_notices r WHERE r.brokerageId=? AND r.entityId=?
      AND NOT EXISTS (SELECT 1 FROM texas_custody_notices n WHERE n.brokerageId=r.brokerageId AND n.entityId=r.entityId
      AND n.noticeId=r.noticeId AND n.version>r.version) ORDER BY r.triggerOn DESC,r.noticeId LIMIT ? OFFSET ?`)
      .all(...scope, pageSize + 1, input.offset) as Row[];
    const items = rows.slice(0, pageSize).map(entry).map(item => ({
      ...item, currentFinding: reviewTexasCustodyNotice(item.facts, localDate(now, item.facts.zone)),
    }));
    return { kind: "texasCustodyNoticeList", items, next: rows.length > pageSize ? input.offset + pageSize : null };
  }

  const target = [...scope, input.noticeId] as const;
  const history = (before: number | null): TexasCustodyNoticeResult => {
    const rows = db.prepare(`SELECT * FROM texas_custody_notices WHERE brokerageId=? AND entityId=? AND noticeId=?
      AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`).all(...target, before, before, pageSize + 1) as Row[];
    const versions = rows.slice(0, pageSize).map(entry);
    return { kind: "texasCustodyNoticeHistory", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null };
  };
  if (input.operation === "history") return history(input.before ?? null);

  const { facts, expected, correction, requestId } = input;
  const request = JSON.stringify(input);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const prior = db.prepare("SELECT entityId,request,actorEmail,actorRevision FROM texas_custody_notices WHERE brokerageId=? AND requestId=?")
    .get(scope[0], requestId);
  if (prior) return prior.entityId === entityId && prior.request === request && prior.actorEmail === staff.email &&
    prior.actorRevision === actorRevision ? history(null) : stale;
  const current = db.prepare("SELECT version,facts FROM texas_custody_notices WHERE brokerageId=? AND entityId=? AND noticeId=? ORDER BY version DESC LIMIT 1")
    .get(...target) as Pick<Row, "version" | "facts"> | undefined;
  if ((current?.version ?? 0) !== expected) return stale;
  if (current && (JSON.parse(current.facts) as TexasCustodyNoticeFacts).kind !== facts.kind)
    return { error: "Create a separate notice for the other trigger." };
  if (current && !correction) return { error: "Enter a reason for changing this notice." };
  const finding = reviewTexasCustodyNotice(facts, localDate(now, facts.zone));
  if (finding.status === "Verify event dates") return { error: "Record notice events that have already occurred." };

  db.prepare(`INSERT INTO texas_custody_notices (brokerageId,entityId,noticeId,version,triggerOn,facts,finding,entity,at,
    actor,actorEmail,actorRevision,requestId,request,correction) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...target, expected + 1, facts.trigger.on, JSON.stringify(facts), JSON.stringify(finding),
      JSON.stringify(entity), now, staff.name, staff.email, actorRevision, requestId, request, correction ?? null);
  accessEvent(db, staff, "Recorded Texas custody notice evidence", input.noticeId, now);
  return history(null);
}

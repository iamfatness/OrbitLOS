import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { reviewFloridaAmendment, type FloridaAmendmentFacts, type FloridaAmendmentRequest } from "./florida-amendment-model";
import { accessEvent } from "./workspace-access";

type Entity = { name: string; nmls: string };
type Row = { noticeId: string; version: number; facts: string; finding: string; entity: string; at: string; actor: string; correction: string | null };
const pageSize = 20;
const stale = { error: "This Florida amendment changed. Reload before recording another version." };

export function initializeFloridaAmendments(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS florida_amendment_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, noticeId TEXT NOT NULL, version INTEGER NOT NULL,
    triggerOn TEXT NOT NULL, facts TEXT NOT NULL, finding TEXT NOT NULL, entity TEXT NOT NULL, at TEXT NOT NULL,
    actor TEXT NOT NULL, actorEmail TEXT NOT NULL, actorRevision INTEGER NOT NULL,
    requestId TEXT NOT NULL, request TEXT NOT NULL, correction TEXT,
    PRIMARY KEY (brokerageId,entityId,noticeId,version), UNIQUE (brokerageId,requestId)
  );
  CREATE INDEX IF NOT EXISTS florida_amendment_versions_listing ON florida_amendment_versions(brokerageId,entityId,triggerOn,noticeId);`);
}

function localDate(at: string, timeZone: FloridaAmendmentFacts["zone"]) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

function entry({ noticeId, version, facts, finding, entity, at, actor, correction }: Row) {
  return { noticeId, version, facts: JSON.parse(facts) as FloridaAmendmentFacts,
    finding: JSON.parse(finding) as ReturnType<typeof reviewFloridaAmendment>,
    entity: JSON.parse(entity) as Entity, at, actor, correction };
}
type Entry = ReturnType<typeof entry>;
export type FloridaAmendmentResult =
  | { kind: "floridaAmendmentList"; items: (Entry & { currentFinding: Entry["finding"] })[]; next: number | null }
  | { kind: "floridaAmendmentHistory"; versions: Entry[]; next: number | null }
  | { error: string };

export function floridaAmendmentWork(db: Store, { entityId, input }: FloridaAmendmentRequest, staff: WorkspaceStaff, now: string): FloridaAmendmentResult {
  if (staff.brokerage.role !== "Admin") return { error: "Florida amendment evidence is available to pilot admins." };
  const scope = [staff.brokerage.id, entityId] as const;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(...scope) as Entity | undefined;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (input.operation === "list") {
    const rows = db.prepare(`SELECT r.* FROM florida_amendment_versions r WHERE r.brokerageId=? AND r.entityId=?
      AND NOT EXISTS (SELECT 1 FROM florida_amendment_versions n WHERE n.brokerageId=r.brokerageId AND n.entityId=r.entityId
      AND n.noticeId=r.noticeId AND n.version>r.version) ORDER BY r.triggerOn DESC,r.noticeId LIMIT ? OFFSET ?`)
      .all(...scope, pageSize + 1, input.offset) as Row[];
    const items = rows.slice(0, pageSize).map(entry).map(item => ({
      ...item, currentFinding: reviewFloridaAmendment(item.facts, localDate(now, item.facts.zone)),
    }));
    return { kind: "floridaAmendmentList", items, next: rows.length > pageSize ? input.offset + pageSize : null };
  }

  const target = [...scope, input.noticeId] as const;
  const history = (before: number | null): FloridaAmendmentResult => {
    const rows = db.prepare(`SELECT * FROM florida_amendment_versions WHERE brokerageId=? AND entityId=? AND noticeId=?
      AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`).all(...target, before, before, pageSize + 1) as Row[];
    const versions = rows.slice(0, pageSize).map(entry);
    return { kind: "floridaAmendmentHistory", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null };
  };
  if (input.operation === "history") return history(input.before ?? null);

  const { facts, expected, correction, requestId } = input;
  const request = JSON.stringify(input);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const prior = db.prepare("SELECT entityId,request,actorEmail,actorRevision FROM florida_amendment_versions WHERE brokerageId=? AND requestId=?")
    .get(scope[0], requestId);
  if (prior) return prior.entityId === entityId && prior.request === request && prior.actorEmail === staff.email &&
    prior.actorRevision === actorRevision ? history(null) : stale;
  const current = db.prepare("SELECT version,facts FROM florida_amendment_versions WHERE brokerageId=? AND entityId=? AND noticeId=? ORDER BY version DESC LIMIT 1")
    .get(...target) as Pick<Row, "version" | "facts"> | undefined;
  if ((current?.version ?? 0) !== expected) return stale;
  if (current && (JSON.parse(current.facts) as FloridaAmendmentFacts).change.kind !== facts.change.kind)
    return { error: "Create a separate notice for the other trigger." };
  if (current && !correction) return { error: "Enter a reason for changing this notice." };
  const finding = reviewFloridaAmendment(facts, localDate(now, facts.zone));
  if (finding.timingStatus === "Verify event dates") return { error: "Check the order and dates of the filing, first notice and regulator status." };

  db.prepare(`INSERT INTO florida_amendment_versions (brokerageId,entityId,noticeId,version,triggerOn,facts,finding,entity,at,
    actor,actorEmail,actorRevision,requestId,request,correction) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...target, expected + 1, facts.effective.on, JSON.stringify(facts), JSON.stringify(finding),
      JSON.stringify(entity), now, staff.name, staff.email, actorRevision, requestId, request, correction ?? null);
  accessEvent(db, staff, "Recorded Florida license amendment evidence", input.noticeId, now);
  return history(null);
}

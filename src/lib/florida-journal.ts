import { floridaJournalSources, reviewFloridaJournal, type FloridaJournalFacts, type FloridaJournalRequest } from "./florida-journal-model";
import { loanRegisterWorkbook, type RegisterCell } from "./ohio-loan-register-spreadsheet";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const pageSize = 20;
const exportLimit = 3000;
const stale = { error: "This Florida journal entry changed. Reload before recording another version." };
type Entity = { name: string; nmls: string };
type Stored = { entryId: string; version: number; facts: string; originalAt: string; at: string; actor: string;
  entity: string; correction: string | null; voided: number };

export function initializeFloridaJournal(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS florida_journal_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, entryId TEXT NOT NULL, version INTEGER NOT NULL,
    requestId TEXT NOT NULL, applicationOn TEXT NOT NULL, transactionKey TEXT, searchText TEXT NOT NULL,
    facts TEXT NOT NULL, entity TEXT NOT NULL, originalAt TEXT NOT NULL, at TEXT NOT NULL, correction TEXT,
    actor TEXT NOT NULL, actorEmail TEXT NOT NULL, actorRevision INTEGER NOT NULL, request TEXT NOT NULL, voided INTEGER NOT NULL,
    PRIMARY KEY(brokerageId,entityId,entryId,version), UNIQUE(brokerageId,requestId)
  );
  CREATE INDEX IF NOT EXISTS florida_journal_period ON florida_journal_versions(brokerageId,entityId,applicationOn,entryId);
  CREATE INDEX IF NOT EXISTS florida_journal_transaction ON florida_journal_versions(brokerageId,entityId,transactionKey);`);
}

const latest = `NOT EXISTS (SELECT 1 FROM florida_journal_versions newer
  WHERE newer.brokerageId=v.brokerageId AND newer.entityId=v.entityId AND newer.entryId=v.entryId AND newer.version>v.version)`;
const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
const format = (timeZone: FloridaJournalFacts["zone"]) => new Intl.DateTimeFormat("en-CA", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
});
const formats = { "America/New_York": format("America/New_York"), "America/Chicago": format("America/Chicago") };
const localDate = (at: string, zone: FloridaJournalFacts["zone"]) => formats[zone].format(new Date(at));

function entry(row: Stored) {
  const facts = JSON.parse(row.facts) as FloridaJournalFacts;
  return { entryId: row.entryId, version: row.version, facts, review: reviewFloridaJournal(facts, localDate(row.originalAt, facts.zone)),
    entity: JSON.parse(row.entity) as Entity, at: row.at, actor: row.actor, correction: row.correction, voided: Boolean(row.voided) };
}

type Entry = ReturnType<typeof entry>;
export type FloridaJournalResult =
  | { kind: "floridaJournalList"; items: Entry[]; next: number | null }
  | { kind: "floridaJournalHistory"; versions: Entry[]; next: number | null }
  | { kind: "floridaJournalExport"; xlsx: string; entries: number; gaps: number; late: number }
  | { error: string };

function workbookSheet(name: string, headers: string[], rows: RegisterCell[][]) {
  return { name, rows: [headers, ...rows], widths: headers.map(label => Math.min(45, Math.max(18, label.length + 2))), filter: true };
}

function exportJournal(rows: Entry[], history: Entry[], entity: Entity, from: string, through: string, now: string): FloridaJournalResult {
  const journal = rows.map(({ facts }) => [facts.transactionNumber ?? "", facts.applicants.join("\n"), facts.applicationOn,
    facts.disposition, facts.lender.status === "Identified" ? facts.lender.name : "", facts.office, facts.authority]);
  const audit = history.map(({ entryId, facts, review, version, at, actor, correction, voided }) => [
    entryId, facts.transactionNumber ?? "", facts.applicationOn, version, facts.disposition, facts.office, facts.officeReference,
    facts.dispositionReference, facts.lender.status, facts.lender.status === "Not applicable" ? facts.lender.reference : "",
    facts.enteredOn ?? "", facts.calendar?.dueOn ?? "", facts.calendar?.reference ?? "", review.firstOn,
    facts.initiation?.reference ?? "", voided ? "Voided" : review.status, review.retainThrough ?? "",
    review.gaps.join("; "), at, actor, correction ?? "",
  ]);
  const scope = [
    ["Legal entity", entity.name], ["NMLS", entity.nmls], ["Application dates from", from], ["Application dates through", through],
    ["Prepared at", now], ["Reconciliation", "Review office custody, pending outcomes, open evidence and any transactions maintained outside Orbit."],
    ["Form", floridaJournalSources.form], ["Journal rule", floridaJournalSources.rule], ["Retention statute", floridaJournalSources.records],
  ];
  const file = loanRegisterWorkbook([
    workbookSheet("Transaction journal", ["Transaction number", "Applicant names", "Application date", "Disposition", "Lender name", "Office", "Authority"], journal),
    workbookSheet("Timing and evidence", ["Entry ID", "Transaction number", "Application date", "Version", "Disposition", "Office",
      "Office evidence", "Disposition evidence", "Lender status", "Lender exception evidence", "Transaction entered",
      "Documented seventh business day", "Calendar evidence", "Journal initiated", "Earlier entry evidence", "Timing",
      "Retention review date", "Evidence gaps", "Saved at", "Actor", "Correction"], audit),
    { name: "Export scope", rows: scope, widths: [28, 100], filter: false },
  ]);
  return { kind: "floridaJournalExport", xlsx: Buffer.from(file).toString("base64"), entries: rows.length,
    gaps: rows.filter(row => row.review.gaps.length).length, late: rows.filter(row => row.review.status === "Late").length };
}

export function floridaJournalWork(db: Store, { entityId, input }: FloridaJournalRequest, staff: WorkspaceStaff, now: string): FloridaJournalResult {
  const scope = [staff.brokerage.id, entityId] as const;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(...scope) as Entity | undefined;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (input.operation === "list" || input.operation === "export") {
    if (input.from > input.through || input.through > localDate(now, "America/New_York"))
      return { error: "Choose an ordered application date range through today." };
    const listing = input.operation === "list";
    const limit = listing ? pageSize : exportLimit;
    const offset = listing ? input.offset : 0;
    const rows = db.prepare(`SELECT v.* FROM florida_journal_versions v WHERE v.brokerageId=? AND v.entityId=?
      AND ${latest} AND v.applicationOn BETWEEN ? AND ? AND instr(v.searchText,?)>0 AND (?=0 OR v.voided=0)
      ORDER BY v.applicationOn,v.entryId LIMIT ? OFFSET ?`)
      .all(...scope, input.from, input.through, listing ? normalize(input.search) : "", Number(!listing), limit + 1, offset) as Stored[];
    if (listing)
      return { kind: "floridaJournalList", items: rows.slice(0, limit).map(entry), next: rows.length > limit ? offset + limit : null };
    if (rows.length > limit) return { error: "This export exceeds 3,000 entries. Narrow the application date range." };
    const historyLimit = 12000;
    const versions = db.prepare(`WITH selected AS (SELECT v.entryId FROM florida_journal_versions v
      WHERE v.brokerageId=? AND v.entityId=? AND ${latest} AND v.applicationOn BETWEEN ? AND ?)
      SELECT a.* FROM florida_journal_versions a JOIN selected ON selected.entryId=a.entryId
      WHERE a.brokerageId=? AND a.entityId=? ORDER BY a.entryId,a.version LIMIT ?`)
      .all(...scope, input.from, input.through, ...scope, historyLimit + 1) as Stored[];
    if (versions.length > historyLimit) return { error: "This export exceeds 12,000 evidence versions. Narrow the application date range." };
    accessEvent(db, staff, "Exported Florida transaction journal", entityId, now);
    return exportJournal(rows.map(entry), versions.map(entry), entity, input.from, input.through, now);
  }

  const target = [...scope, input.entryId] as const;
  function history(before?: number): FloridaJournalResult {
    const rows = db.prepare(`SELECT * FROM florida_journal_versions WHERE brokerageId=? AND entityId=? AND entryId=?
      AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`).all(...target, before ?? null, before ?? null, pageSize + 1) as Stored[];
    const versions = rows.slice(0, pageSize).map(entry);
    return { kind: "floridaJournalHistory", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null };
  }
  if (input.operation === "history") return history(input.before);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const request = JSON.stringify(input);
  const prior = db.prepare("SELECT entityId,request,actorEmail,actorRevision FROM florida_journal_versions WHERE brokerageId=? AND requestId=?")
    .get(scope[0], input.requestId);
  if (prior) return prior.entityId === entityId && prior.request === request && prior.actorEmail === staff.email &&
    prior.actorRevision === actorRevision ? history() : stale;
  const current = db.prepare(`SELECT * FROM florida_journal_versions WHERE brokerageId=? AND entityId=? AND entryId=?
    ORDER BY version DESC LIMIT 1`).get(...target) as Stored | undefined;
  if ((current?.version ?? 0) !== input.expected) return stale;
  if (current?.voided) return { error: "This entry was voided. Record a new entry if needed." };
  if (current && !input.correction) return { error: "Enter a reason for changing this Florida journal entry." };
  const saved = current ? JSON.parse(current.facts) as FloridaJournalFacts : undefined;
  const facts = input.operation === "save" ? input.facts : saved;
  if (!facts) return stale;
  if (saved && (facts.zone !== saved.zone || facts.authority !== saved.authority))
    return { error: "Void this entry and record a new one to change authority or time zone." };
  const originalAt = current?.originalAt ?? now;
  const firstSavedOn = localDate(originalAt, facts.zone);
  const today = localDate(now, facts.zone);
  if ([facts.applicationOn, facts.enteredOn].some(on => on && on > today))
    return { error: "Record journal events that have already occurred." };
  if (facts.initiation && facts.initiation.on > firstSavedOn)
    return { error: "The documented earlier journal entry cannot follow the first Orbit save." };
  const voided = input.operation === "void";
  const transactionKey = facts.transactionNumber ? normalize(facts.transactionNumber) : null;
  if (!voided && transactionKey && db.prepare(`SELECT 1 FROM florida_journal_versions v WHERE v.brokerageId=? AND v.entityId=?
    AND v.entryId<>? AND v.transactionKey=? AND v.voided=0 AND ${latest}`).get(...target, transactionKey))
    return { error: "An active entry already uses this Florida transaction number." };
  const searchText = normalize([facts.transactionNumber, ...facts.applicants, facts.office].join(" "));
  db.prepare(`INSERT INTO florida_journal_versions (brokerageId,entityId,entryId,version,requestId,applicationOn,transactionKey,searchText,
    facts,entity,originalAt,at,correction,actor,actorEmail,actorRevision,request,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...target, input.expected + 1, input.requestId, facts.applicationOn, transactionKey, searchText, JSON.stringify(facts),
      JSON.stringify(entity), originalAt, now, input.correction ?? null, staff.name, staff.email, actorRevision, request, Number(voided));
  accessEvent(db, staff, voided ? "Voided Florida transaction journal evidence" : "Recorded Florida transaction journal evidence", input.entryId, now);
  return history();
}

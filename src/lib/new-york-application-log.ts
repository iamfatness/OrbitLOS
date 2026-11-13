import { newYorkApplicationLogSource, reviewNewYorkApplication, type NewYorkApplicationFacts, type NewYorkApplicationLogRequest } from "./new-york-application-log-model";
import { loanRegisterWorkbook, type RegisterCell } from "./ohio-loan-register-spreadsheet";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const pageSize = 20;
const exportLimit = 3000;
const stale = { error: "This New York application log entry changed. Reload before recording another version." };
type Entity = { name: string; nmls: string };
type Stored = { entryId: string; version: number; facts: string; originalAt: string; at: string; actor: string;
  entity: string; correction: string | null; voided: number };

export function initializeNewYorkApplicationLog(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS new_york_application_log_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, entryId TEXT NOT NULL, version INTEGER NOT NULL,
    requestId TEXT NOT NULL, applicationOn TEXT NOT NULL, fileKey TEXT NOT NULL, searchText TEXT NOT NULL,
    facts TEXT NOT NULL, entity TEXT NOT NULL, originalAt TEXT NOT NULL, at TEXT NOT NULL, correction TEXT,
    actor TEXT NOT NULL, actorEmail TEXT NOT NULL, actorRevision INTEGER NOT NULL, request TEXT NOT NULL, voided INTEGER NOT NULL,
    PRIMARY KEY(brokerageId,entityId,entryId,version), UNIQUE(brokerageId,requestId)
  );
  CREATE INDEX IF NOT EXISTS new_york_application_log_period ON new_york_application_log_versions(brokerageId,entityId,applicationOn,entryId);
  CREATE INDEX IF NOT EXISTS new_york_application_log_file ON new_york_application_log_versions(brokerageId,entityId,fileKey);`);
}

const latest = `NOT EXISTS (SELECT 1 FROM new_york_application_log_versions newer
  WHERE newer.brokerageId=v.brokerageId AND newer.entityId=v.entityId AND newer.entryId=v.entryId AND newer.version>v.version)`;
const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
const format = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const localDate = (at: string) => format.format(new Date(at));

function entry(row: Stored) {
  const facts = JSON.parse(row.facts) as NewYorkApplicationFacts;
  return { entryId: row.entryId, version: row.version, facts, review: reviewNewYorkApplication(facts, localDate(row.originalAt)),
    entity: JSON.parse(row.entity) as Entity, at: row.at, actor: row.actor, correction: row.correction, voided: Boolean(row.voided) };
}

type Entry = ReturnType<typeof entry>;
export type NewYorkApplicationLogResult =
  | { kind: "newYorkApplicationLogList"; items: Entry[]; next: number | null }
  | { kind: "newYorkApplicationLogHistory"; versions: Entry[]; next: number | null }
  | { kind: "newYorkApplicationLogExport"; xlsx: string; entries: number; gaps: number; loggedAfterReceipt: number }
  | { error: string };

function workbookSheet(name: string, headers: string[], rows: RegisterCell[][]) {
  return { name, rows: [headers, ...rows], widths: headers.map(label => Math.min(45, Math.max(18, label.length + 2))), filter: true };
}

function exportLog(rows: Entry[], history: Entry[], entity: Entity, from: string, through: string, now: string): NewYorkApplicationLogResult {
  const applications = rows.map(({ facts, review }) => [
    facts.fileNumber, facts.office, facts.applicationOn, facts.applicants.map(applicant => applicant.name).join("\n"),
    facts.applicants.map(applicant => applicant.address).join("\n"), facts.propertyAddress, facts.source.status,
    facts.source.status === "Direct" ? facts.source.description : facts.source.status === "Referral" ? facts.source.referrer.name : "",
    facts.source.status === "Referral" ? facts.source.referrer.address : "",
    facts.source.status === "Referral" ? facts.source.referrer.description : "",
    facts.disposition.status === "Final" ? facts.disposition.outcome : "Pending",
    facts.disposition.status === "Final" ? facts.disposition.on : "",
    facts.disposition.status === "Final" ? facts.disposition.reference : "",
    facts.placement.status === "Placed" ? facts.placement.entity : "", review.firstLoggedOn,
  ]);
  const preclosing = rows.flatMap(({ facts }) => facts.preclosingFees.status === "Recorded" ?
    facts.preclosingFees.items.map(fee => [facts.fileNumber, fee.amountCents / 100, fee.paidOn, fee.purpose,
      fee.direction, fee.counterparty.name, fee.counterparty.address, fee.counterparty.description]) : []);
  const compensation = rows.flatMap(({ facts }) => facts.brokerageFees.status === "Recorded" ?
    facts.brokerageFees.items.map(fee => [facts.fileNumber, fee.amountCents / 100, fee.sourceType, fee.source]) : []);
  const evidence = history.map(({ entryId, facts, review, version, at, actor, correction, voided }) => [
    entryId, facts.fileNumber, version, facts.office, facts.applicationOn, facts.source.status,
    "reference" in facts.source ? facts.source.reference : "", facts.placement.status,
    "reference" in facts.placement ? facts.placement.reference : "", facts.preclosingFees.status,
    "reference" in facts.preclosingFees ? facts.preclosingFees.reference : "", facts.brokerageFees.status,
    "reference" in facts.brokerageFees ? facts.brokerageFees.reference : "", review.firstLoggedOn,
    facts.earlierLog?.reference ?? "", review.gaps.join("; "), voided ? "Voided" : "Recorded", at, actor, correction ?? "",
  ]);
  const denied = rows.flatMap(({ facts }) => facts.disposition.status === "Final" && facts.disposition.outcome === "Denied" ?
    [[facts.fileNumber, facts.office, facts.applicationOn, facts.disposition.on, facts.disposition.reference]] : []);
  const scope = [
    ["Legal entity", entity.name], ["NMLS", entity.nmls], ["Received from", from], ["Received through", through],
    ["Prepared at", now], ["Reconciliation", "Confirm all office activity, open items and external records before examination use."],
    ["Retention", "Review the state three-year minimum and longer applicable requirements. No deletion date is calculated."],
    ["Rule", newYorkApplicationLogSource],
  ];
  const file = loanRegisterWorkbook([
    workbookSheet("Application log", ["File number", "Office", "Received", "Applicants", "Applicant addresses", "Property address",
      "Source type", "Source", "Referrer address", "Referrer description", "Disposition", "Disposition date", "Disposition evidence",
      "Placement entity", "First documented entry"], applications),
    workbookSheet("Preclosing fees", ["File number", "Amount USD", "Date paid", "Purpose", "Direction", "Counterparty", "Address", "Description"], preclosing),
    workbookSheet("Brokerage compensation", ["File number", "Amount USD", "Source type", "Source"], compensation),
    workbookSheet("Rejected files", ["File number", "Office", "Received", "Denied on", "File reference"], denied),
    workbookSheet("Evidence history", ["Entry ID", "File number", "Version", "Office", "Received", "Source status", "Source record",
      "Placement status", "Placement evidence", "Preclosing fees", "Preclosing fee evidence", "Brokerage fees", "Brokerage fee evidence",
      "First documented entry", "Earlier log evidence", "Evidence gaps", "Entry status", "Saved at", "Actor", "Correction"], evidence),
    { name: "Export scope", rows: scope, widths: [28, 100], filter: false },
  ]);
  return { kind: "newYorkApplicationLogExport", xlsx: Buffer.from(file).toString("base64"), entries: rows.length,
    gaps: rows.filter(row => row.review.gaps.length).length, loggedAfterReceipt: rows.filter(row => row.review.loggedAfterReceipt).length };
}

export function newYorkApplicationLogWork(db: Store, { entityId, input }: NewYorkApplicationLogRequest, staff: WorkspaceStaff, now: string): NewYorkApplicationLogResult {
  const scope = [staff.brokerage.id, entityId] as const;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(...scope) as Entity | undefined;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (input.operation === "list" || input.operation === "export") {
    if (input.from > input.through || input.through > localDate(now))
      return { error: "Choose an ordered application date range through today." };
    const listing = input.operation === "list";
    const limit = listing ? pageSize : exportLimit;
    const offset = listing ? input.offset : 0;
    const rows = db.prepare(`SELECT v.* FROM new_york_application_log_versions v WHERE v.brokerageId=? AND v.entityId=?
      AND ${latest} AND v.applicationOn BETWEEN ? AND ? AND instr(v.searchText,?)>0 AND (?=0 OR v.voided=0)
      ORDER BY v.applicationOn,v.entryId LIMIT ? OFFSET ?`)
      .all(...scope, input.from, input.through, listing ? normalize(input.search) : "", Number(!listing), limit + 1, offset) as Stored[];
    if (listing)
      return { kind: "newYorkApplicationLogList", items: rows.slice(0, limit).map(entry), next: rows.length > limit ? offset + limit : null };
    if (rows.length > limit) return { error: "This export exceeds 3,000 entries. Narrow the application date range." };
    const historyLimit = 12000;
    const versions = db.prepare(`WITH selected AS (SELECT DISTINCT v.entryId FROM new_york_application_log_versions v
      WHERE v.brokerageId=? AND v.entityId=? AND v.applicationOn BETWEEN ? AND ?)
      SELECT a.* FROM new_york_application_log_versions a JOIN selected ON selected.entryId=a.entryId
      WHERE a.brokerageId=? AND a.entityId=? ORDER BY a.entryId,a.version LIMIT ?`)
      .all(...scope, input.from, input.through, ...scope, historyLimit + 1) as Stored[];
    if (versions.length > historyLimit) return { error: "This export exceeds 12,000 evidence versions. Narrow the application date range." };
    const entries = rows.map(entry);
    const feeCount = entries.reduce((total, { facts }) => total +
      (facts.preclosingFees.status === "Recorded" ? facts.preclosingFees.items.length : 0) +
      (facts.brokerageFees.status === "Recorded" ? facts.brokerageFees.items.length : 0), 0);
    if (feeCount > 12000) return { error: "This export exceeds 12,000 fee records. Narrow the application date range." };
    accessEvent(db, staff, "Exported New York application log", entityId, now);
    return exportLog(entries, versions.map(entry), entity, input.from, input.through, now);
  }

  const target = [...scope, input.entryId] as const;
  function history(before?: number): NewYorkApplicationLogResult {
    const rows = db.prepare(`SELECT * FROM new_york_application_log_versions WHERE brokerageId=? AND entityId=? AND entryId=?
      AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`).all(...target, before ?? null, before ?? null, pageSize + 1) as Stored[];
    const versions = rows.slice(0, pageSize).map(entry);
    return { kind: "newYorkApplicationLogHistory", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null };
  }
  if (input.operation === "history") return history(input.before);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const request = JSON.stringify(input);
  const prior = db.prepare("SELECT entityId,request,actorEmail,actorRevision FROM new_york_application_log_versions WHERE brokerageId=? AND requestId=?")
    .get(scope[0], input.requestId);
  if (prior) return prior.entityId === entityId && prior.request === request && prior.actorEmail === staff.email &&
    prior.actorRevision === actorRevision ? history() : stale;
  const current = db.prepare(`SELECT * FROM new_york_application_log_versions WHERE brokerageId=? AND entityId=? AND entryId=?
    ORDER BY version DESC LIMIT 1`).get(...target) as Stored | undefined;
  if ((current?.version ?? 0) !== input.expected) return stale;
  if (current?.voided) return { error: "This entry was voided. Record a new entry if needed." };
  if (current && !input.correction) return { error: "Enter a reason for changing this New York application log entry." };
  const saved = current ? JSON.parse(current.facts) as NewYorkApplicationFacts : undefined;
  const facts = input.operation === "save" ? input.facts : saved;
  if (!facts) return stale;
  const originalAt = current?.originalAt ?? now;
  const firstSavedOn = localDate(originalAt);
  const today = localDate(now);
  const dispositionOn = facts.disposition.status === "Final" ? facts.disposition.on : undefined;
  const feeDates = facts.preclosingFees.status === "Recorded" ? facts.preclosingFees.items.map(fee => fee.paidOn) : [];
  if ([facts.applicationOn, dispositionOn, ...feeDates].some(on => on && on > today))
    return { error: "Record application and payment events that have already occurred." };
  if (facts.earlierLog && facts.earlierLog.on > firstSavedOn)
    return { error: "The documented earlier log entry cannot follow the first Orbit save." };
  const voided = input.operation === "void";
  const fileKey = normalize(facts.fileNumber);
  if (!voided && db.prepare(`SELECT 1 FROM new_york_application_log_versions v WHERE v.brokerageId=? AND v.entityId=?
    AND v.entryId<>? AND v.fileKey=? AND v.voided=0 AND ${latest}`).get(...target, fileKey))
    return { error: "An active entry already uses this New York application file number." };
  const searchText = normalize([facts.fileNumber, ...facts.applicants.map(applicant => applicant.name), facts.office].join(" "));
  db.prepare(`INSERT INTO new_york_application_log_versions (brokerageId,entityId,entryId,version,requestId,applicationOn,fileKey,searchText,
    facts,entity,originalAt,at,correction,actor,actorEmail,actorRevision,request,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...target, input.expected + 1, input.requestId, facts.applicationOn, fileKey, searchText, JSON.stringify(facts),
      JSON.stringify(entity), originalAt, now, input.correction ?? null, staff.name, staff.email, actorRevision, request, Number(voided));
  accessEvent(db, staff, voided ? "Voided New York application log evidence" : "Recorded New York application log evidence", input.entryId, now);
  return history();
}

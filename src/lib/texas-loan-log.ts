import { loanRegisterWorkbook, type RegisterCell } from "./ohio-loan-register-spreadsheet";
import { texasLogGaps, texasLogSources, texasLogStart, texasLogTiming, type TexasLoanLogRequest, type TexasLogFacts } from "./texas-loan-log-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const pageSize = 20;
const exportLimit = 3000;
const stale = { error: "This Texas log entry changed. Reload before recording another version." };
type Entity = { name: string; nmls: string };
type Authority = Extract<TexasLoanLogRequest["input"], { operation: "save" }>["authority"];
type Stored = {
  entryId: string; version: number; authority: Authority; facts: string; originalAt: string; at: string;
  actor: string; actorEmail: string; actorRevision: number; request: string; correction: string | null;
  entity: string; voided: number;
};

export function initializeTexasLoanLog(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS texas_loan_log_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, entryId TEXT NOT NULL, version INTEGER NOT NULL,
    requestId TEXT NOT NULL, authority TEXT NOT NULL, log TEXT NOT NULL, fileKey TEXT NOT NULL, searchText TEXT NOT NULL,
    firstOn TEXT, facts TEXT NOT NULL, correction TEXT, entity TEXT NOT NULL, originalAt TEXT NOT NULL, at TEXT NOT NULL,
    actor TEXT NOT NULL, actorEmail TEXT NOT NULL, actorRevision INTEGER NOT NULL, request TEXT NOT NULL, voided INTEGER NOT NULL,
    PRIMARY KEY(brokerageId,entityId,entryId,version), UNIQUE(brokerageId,requestId)
  );
  CREATE INDEX IF NOT EXISTS texas_loan_log_period ON texas_loan_log_versions(brokerageId,entityId,firstOn,entryId);
  CREATE INDEX IF NOT EXISTS texas_loan_log_file ON texas_loan_log_versions(brokerageId,entityId,log,fileKey);`);
}

const latest = `NOT EXISTS (SELECT 1 FROM texas_loan_log_versions newer
  WHERE newer.brokerageId=v.brokerageId AND newer.entityId=v.entityId AND newer.entryId=v.entryId AND newer.version>v.version)`;
const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
const timeZoneFormat = (timeZone: TexasLogFacts["zone"]) => new Intl.DateTimeFormat("en-CA", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
});
const logDateFormats = { "America/Chicago": timeZoneFormat("America/Chicago"), "America/Denver": timeZoneFormat("America/Denver") };
const localDate = (at: string, zone: TexasLogFacts["zone"]) => logDateFormats[zone].format(new Date(at));

function entry(row: Stored) {
  const facts = JSON.parse(row.facts) as TexasLogFacts;
  const timing = texasLogTiming(facts, localDate(row.at, facts.zone), localDate(row.originalAt, facts.zone));
  return {
    entryId: row.entryId, version: row.version, authority: row.authority, facts, timing, gaps: texasLogGaps(facts),
    at: row.at, actor: row.actor, correction: row.correction, voided: Boolean(row.voided), entity: JSON.parse(row.entity) as Entity,
  };
}

type Entry = ReturnType<typeof entry>;
export type TexasLoanLogResult =
  | { kind: "texasLogList"; items: Entry[]; next: number | null }
  | { kind: "texasLogHistory"; versions: Entry[]; next: number | null }
  | { kind: "texasLogExport"; xlsx: string; origination: number; processing: number; incomplete: number; late: number }
  | { error: string };

const commonHeaders = ["Authority", "Applicant names", "File number", "Lender file number", "Street", "City", "State", "ZIP", "Occupancy", "Disposition", "Disposition details", "Closing date"];
const originationHeaders = ["Initial application date", "Interest rate (%)", "Purpose", "Product", "Initial funding lender", "Funding lender NMLS", "Lender ID exception", "Initial originator", "Originator NMLS", "Lien position"];
const processingHeaders = ["Service start", "Client file number", "Client", "Client NMLS", "Workers and NMLS and employment",
  "Invoiced USD", "Assessed USD", "Charged USD", "Collected USD", "Paid USD", "Fee evidence", "Direct fee on CD", "CD evidence"];

function commonCells({ facts, authority }: Entry): RegisterCell[] {
  const { applicants, fileNumber, lenderFileNumber, property, occupancy, disposition, dispositionDetails, closedOn } = facts;
  return [authority, applicants.map(person => person.last + ", " + person.first).join("\n"), fileNumber,
    lenderFileNumber ?? "", property?.street ?? "", property?.city ?? "", property?.state ?? "", property?.zip ?? "",
    occupancy ?? "", disposition, dispositionDetails ?? "", closedOn ?? ""];
}

function originationCells(row: Entry): RegisterCell[] {
  const { facts } = row;
  if (facts.log !== "Origination") return [];
  return [...commonCells(row), facts.applicationOn ?? "", facts.interestRate ?? "", facts.purpose ?? "", facts.product ?? "",
    facts.fundingLender?.name ?? "", facts.fundingLender?.nmls ?? "", facts.lenderNmlsException ?? "",
    facts.initialOriginator?.name ?? "", facts.initialOriginator?.nmls ?? "", facts.lien ?? ""];
}

function processingCells(row: Entry): RegisterCell[] {
  const { facts } = row;
  if (facts.log === "Origination") return [];
  const usd = (value?: number) => value === undefined ? "" : value / 100;
  return [...commonCells(row), facts.serviceStartedOn ?? "", facts.clientFileNumber ?? "", facts.client?.name ?? "", facts.client?.nmls ?? "",
    facts.workers.map(worker => [worker.name, worker.nmls, worker.employment].join(" / ")).join("\n"),
    usd(facts.fees?.invoiced), usd(facts.fees?.assessed), usd(facts.fees?.charged), usd(facts.fees?.collected), usd(facts.fees?.paid),
    facts.fees?.reference ?? "", facts.closingDisclosureFee, facts.closingDisclosureReference ?? ""];
}

function workbookSheet(name: string, headers: string[], rows: RegisterCell[][]) {
  return { name, rows: [headers, ...rows], widths: headers.map(label => Math.min(45, Math.max(18, label.length + 2))), filter: true };
}

function exportLog(rows: Entry[], history: Entry[], entity: Entity, from: string, through: string, now: string): TexasLoanLogResult {
  const origination = rows.filter(row => row.facts.log === "Origination");
  const processing = rows.filter(row => row.facts.log !== "Origination");
  const incomplete = rows.filter(row => row.gaps.length);
  const late = new Set(history.filter(row => !row.voided && (row.timing.late || row.timing.initialLate)).map(row => row.entryId));
  const audits = history.map(({ facts, timing, gaps, version, at, correction, voided }) => [
    facts.log, facts.fileNumber, version, facts.entryEventOn, timing.due, at,
    voided ? "Voided" : timing.late ? "Late" : "On time", timing.initialDue ?? "", timing.initialLate === null ? "Unknown" : timing.initialLate ? "Late" : "On time",
    gaps.join("; "), facts.evidence, correction ?? "",
  ]);
  const scope = [
    ["Legal entity", entity.name], ["Company NMLS", entity.nmls], ["From", from], ["Through", through], ["Prepared at", now],
    ["Scope", "Origination uses application dates. Processing uses recorded service start. Undated records remain included."],
    ["Reconcile", "Match the exported entries and evidence to all applicable loans and the examination request, including activity outside Orbit."],
    ["Origination guidance", texasLogSources.origination], ["Processing guidance", texasLogSources.processing],
  ];
  const file = loanRegisterWorkbook([
    workbookSheet("Mortgage transaction log", [...commonHeaders, ...originationHeaders], origination.map(originationCells)),
    workbookSheet("Processing and underwriting", [...commonHeaders, ...processingHeaders], processing.map(processingCells)),
    workbookSheet("Timing and evidence", ["Log", "File number", "Version", "Event date", "Due", "Saved at", "Timing",
      "Initial due", "Initial timing", "Evidence gaps", "Evidence", "Correction"], audits),
    { name: "Export scope", rows: scope, widths: [28, 100], filter: false },
  ]);
  return { kind: "texasLogExport", xlsx: Buffer.from(file).toString("base64"), origination: origination.length,
    processing: processing.length, incomplete: incomplete.length, late: late.size };
}

export function texasLoanLogWork(db: Store, { entityId, input }: TexasLoanLogRequest, staff: WorkspaceStaff, now: string): TexasLoanLogResult {
  const tenant = staff.brokerage.id;
  const scope = [tenant, entityId] as const;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(...scope) as Entity | undefined;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (input.operation === "list" || input.operation === "export") {
    if (input.from > input.through || input.through > localDate(now, "America/Chicago"))
      return { error: "Choose an ordered examination period through today." };
    const filter = input.operation === "list" ? input.log : "All";
    const search = input.operation === "list" ? normalize(input.search) : "";
    const limit = input.operation === "list" ? pageSize : exportLimit;
    const offset = input.operation === "list" ? input.offset : 0;
    const rows = db.prepare(`SELECT v.* FROM texas_loan_log_versions v WHERE v.brokerageId=? AND v.entityId=?
      AND ${latest} AND (v.firstOn BETWEEN ? AND ? OR v.firstOn IS NULL) AND (?='All' OR v.log=?)
      AND instr(v.searchText,?)>0 AND (?=0 OR v.voided=0)
      ORDER BY v.firstOn IS NULL,v.firstOn,v.entryId LIMIT ? OFFSET ?`).all(
      ...scope, input.from, input.through, filter, filter, search, Number(input.operation === "export"), limit + 1, offset,
    ) as Stored[];
    if (input.operation === "list")
      return { kind: "texasLogList", items: rows.slice(0, limit).map(entry), next: rows.length > limit ? offset + limit : null };
    if (rows.length > limit) return { error: "The export exceeds 3,000 entries. Narrow the examination period." };
    const historyLimit = 12000;
    const history = db.prepare(`WITH selected AS (SELECT v.entryId FROM texas_loan_log_versions v
      WHERE v.brokerageId=? AND v.entityId=? AND ${latest} AND (v.firstOn BETWEEN ? AND ? OR v.firstOn IS NULL))
      SELECT a.* FROM texas_loan_log_versions a JOIN selected ON selected.entryId=a.entryId
      WHERE a.brokerageId=? AND a.entityId=? ORDER BY a.entryId,a.version LIMIT ?`)
      .all(...scope, input.from, input.through, ...scope, historyLimit + 1) as Stored[];
    if (history.length > historyLimit) return { error: "The export exceeds 12,000 evidence versions. Narrow the examination period." };
    accessEvent(db, staff, "Exported Texas examination logs", entityId, now);
    return exportLog(rows.map(entry), history.map(entry), entity, input.from, input.through, now);
  }
  const target = [...scope, input.entryId] as const;
  function history(before?: number): TexasLoanLogResult {
    const rows = db.prepare(`SELECT * FROM texas_loan_log_versions WHERE brokerageId=? AND entityId=? AND entryId=?
      AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`).all(...target, before ?? null, before ?? null, pageSize + 1) as Stored[];
    const versions = rows.slice(0, pageSize).map(entry);
    return { kind: "texasLogHistory", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null };
  }
  if (input.operation === "history") return history(input.before);
  const request = JSON.stringify(input);
  const accessRevision = staff.brokerage.accessRevision ?? 0;
  const prior = db.prepare("SELECT entityId,request,actorEmail,actorRevision FROM texas_loan_log_versions WHERE brokerageId=? AND requestId=?")
    .get(tenant, input.requestId);
  if (prior) return prior.entityId === entityId && prior.request === request && prior.actorEmail === staff.email &&
    prior.actorRevision === accessRevision ? history() : stale;
  const current = db.prepare(`SELECT * FROM texas_loan_log_versions WHERE brokerageId=? AND entityId=? AND entryId=?
    ORDER BY version DESC LIMIT 1`).get(...target) as Stored | undefined;
  if ((current?.version ?? 0) !== input.expected) return stale;
  if (current?.voided) return { error: "This entry was voided. Record a new entry if needed." };
  if (current && !input.correction) return { error: "Enter a reason for changing this Texas log entry." };
  const voided = input.operation === "void";
  const facts = input.operation === "save" ? input.facts : current && JSON.parse(current.facts) as TexasLogFacts;
  const authority = input.operation === "save" ? input.authority : current?.authority;
  if (!facts || !authority) return stale;
  const saved = current ? JSON.parse(current.facts) as TexasLogFacts : undefined;
  if (saved && (saved.log !== facts.log || current?.authority !== authority || saved.zone !== facts.zone))
    return { error: "Void this entry and record a new one to change the log, authority or time zone." };
  const first = texasLogStart(facts);
  const today = localDate(now, facts.zone);
  if ([first, facts.entryEventOn, facts.closedOn].some(on => on && on > today))
    return { error: "Record Texas log events that have already occurred." };
  const fileKey = normalize(facts.fileNumber);
  if (!voided && db.prepare(`SELECT 1 FROM texas_loan_log_versions v WHERE v.brokerageId=? AND v.entityId=?
    AND v.entryId<>? AND v.log=? AND v.fileKey=? AND v.voided=0 AND ${latest}`).get(...target, facts.log, fileKey))
    return { error: "An active entry already uses this file number in the selected Texas log." };
  const searchText = normalize([facts.fileNumber, facts.lenderFileNumber, ...facts.applicants.map(person => person.last + ", " + person.first)].join(" "));
  db.prepare(`INSERT INTO texas_loan_log_versions (brokerageId,entityId,entryId,version,requestId,authority,log,fileKey,searchText,firstOn,
    facts,correction,entity,originalAt,at,actor,actorEmail,actorRevision,request,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...target, input.expected + 1, input.requestId, authority, facts.log, fileKey, searchText, first ?? null, JSON.stringify(facts),
      input.correction ?? null, JSON.stringify(entity), current?.originalAt ?? now, now, staff.name, staff.email, accessRevision, request, Number(voided));
  accessEvent(db, staff, voided ? "Voided Texas examination log evidence" : "Recorded Texas examination log evidence", input.entryId, now);
  return history();
}

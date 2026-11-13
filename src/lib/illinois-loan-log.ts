import { illinoisLogGaps, type IllinoisLoanLogRequest, type IllinoisLogFacts, type IllinoisLogStatus } from "./illinois-loan-log-model";
import { illinoisLoanLogWorkbook } from "./illinois-loan-log-spreadsheet";
import { illinoisRetentionLocalDate } from "./illinois-recordkeeping";
import { michiganLoanState } from "./michigan-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const pageSize = 20;
const exportLimit = 4000;
const stale = { error: "This Illinois loan log entry changed. Reload before saving." };
type Entity = { name: string; nmls: string };
type Entry = { entryId: string; loanId: string | null; version: number; status: IllinoisLogStatus; facts: IllinoisLogFacts;
  evidence: string; correction: string | null; actor: string; at: string; entity: Entity; reviewIssue: string | null };
type Candidate = { loanId: string; borrower: string; stage: string; disposition: string; propertyState: string | null;
  reportState: string | null; reportedApplicationDate: string | null; draftEntryId: string | null; draftInAnotherEntity: boolean };
export type IllinoisLoanLogResult =
  | { kind: "illinoisLogList"; items: Entry[]; next: number | null }
  | { kind: "illinoisLogCandidates"; items: Candidate[]; next: number | null }
  | { kind: "illinoisLogHistory"; versions: Entry[]; next: number | null; message?: string }
  | { kind: "illinoisLogExport"; xlsx: string; reviewedApplications: number; highRiskApplications: number;
      incomplete: number; unmatchedCandidates: number; highRiskFrom: string }
  | { error: string };

export function initializeIllinoisLoanLog(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS illinois_loan_log_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, entryId TEXT NOT NULL, version INTEGER NOT NULL,
    requestId TEXT NOT NULL, loanId TEXT, status TEXT NOT NULL, facts TEXT NOT NULL, fileKey TEXT,
    borrowerSearch TEXT NOT NULL, applicationDate TEXT, product TEXT NOT NULL, risk TEXT,
    evidence TEXT NOT NULL, correction TEXT, entity TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL,
    actorEmail TEXT NOT NULL, actorRevision INTEGER NOT NULL, request TEXT NOT NULL,
    PRIMARY KEY(brokerageId,entityId,entryId,version), UNIQUE(brokerageId,requestId)
  );
  CREATE INDEX IF NOT EXISTS illinois_log_link ON illinois_loan_log_versions(brokerageId,loanId) WHERE loanId IS NOT NULL;
  CREATE INDEX IF NOT EXISTS illinois_log_period ON illinois_loan_log_versions(brokerageId,entityId,applicationDate,entryId);`);
}

const latest = `NOT EXISTS (SELECT 1 FROM illinois_loan_log_versions newer WHERE newer.brokerageId=v.brokerageId
  AND newer.entityId=v.entityId AND newer.entryId=v.entryId AND newer.version>v.version)`;
const propertyState = `nullif(${michiganLoanState("a.draft")},'')`;
const reportState = "nullif(upper(trim(json_extract(prep.facts,'$.state'))),'')";
const loanJoins = "LEFT JOIN applications a ON a.loanId=l.id LEFT JOIN call_report_facts prep ON prep.loanId=l.id";
const candidateSource = `FROM loans l JOIN contacts c ON c.id=l.contactId ${loanJoins}
  WHERE (${propertyState}='IL' OR ${reportState}='IL')`;
const unmatched = `AND NOT EXISTS (SELECT 1 FROM illinois_loan_log_versions v
  WHERE v.brokerageId=? AND v.loanId=l.id AND v.status='Reviewed' AND ${latest})`;
const borrowerFile = `LEFT JOIN illinois_recordkeeping_reviews records ON records.brokerageId=? AND records.loanId=l.id
  AND records.version=(SELECT max(version) FROM illinois_recordkeeping_reviews
    WHERE brokerageId=records.brokerageId AND loanId=records.loanId)`;
const linkFields = `${propertyState} AS propertyState,${reportState} AS reportState,
  CASE WHEN nullif(json_extract(records.facts,'$.riskReference'),'') IS NOT NULL THEN json_extract(records.facts,'$.risk') END AS fileRisk`;
const logSource = `FROM illinois_loan_log_versions v LEFT JOIN loans l ON l.id=v.loanId ${loanJoins} ${borrowerFile}
  WHERE v.brokerageId=? AND v.entityId=? AND ${latest}`;
const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();

function linkIssue(loanId: string | null, facts: IllinoisLogFacts, { propertyState, reportState, fileRisk }: Record<string, unknown>) {
  if (!loanId) return facts.fileNumber ? null : "Record a stable file number for the outside application.";
  if (propertyState !== "IL" && reportState !== "IL") return "The linked loan lacks a recorded Illinois property or report state.";
  if (propertyState && reportState && propertyState !== reportState) return "Reconcile the linked property and reporting states.";
  const risk = facts.highRisk === "High risk" ? "High-risk home loan" : facts.highRisk;
  if (facts.product === "Brokerage or origination" && risk && risk !== "Unresolved" && fileRisk && fileRisk !== "Unresolved" && risk !== fileRisk)
    return "Reconcile the high-risk classification with the current Illinois borrower-file evidence.";
  if (facts.product !== "Unresolved" && facts.product !== "Brokerage or origination" && fileRisk === "High-risk home loan")
    return "Reconcile the product with the high-risk Illinois borrower-file classification.";
  return null;
}

function readEntry(row: Record<string, unknown>, reviewLink = false): Entry {
  const facts = JSON.parse(String(row.facts)) as IllinoisLogFacts;
  const loanId = row.loanId as string | null;
  return { entryId: String(row.entryId), loanId, version: Number(row.version), status: row.status as IllinoisLogStatus,
    facts, evidence: String(row.evidence), correction: row.correction as string | null, at: String(row.at), actor: String(row.actor),
    entity: JSON.parse(String(row.entity)), reviewIssue: reviewLink ? linkIssue(loanId, facts, row) : null };
}

function highRiskStart(through: string) {
  const [year, month, day] = through.split("-").map(Number);
  const targetYear = year - 5;
  const targetDay = Math.min(day, new Date(Date.UTC(targetYear, month, 0)).getUTCDate());
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

function exportLog(db: Store, scope: [string, string], entity: Entity, from: string, through: string, staff: WorkspaceStaff, now: string): IllinoisLoanLogResult {
  const [tenant, entityId] = scope;
  const highRiskFrom = highRiskStart(through);
  const rows = db.prepare(`SELECT v.*,${linkFields} ${logSource} AND v.status<>'Withdrawn'
    AND (v.applicationDate IS NULL OR v.applicationDate BETWEEN ? AND ? OR
      (v.applicationDate BETWEEN ? AND ? AND (v.product='Unresolved' OR
        (v.product='Brokerage or origination' AND (coalesce(v.risk,'Unresolved')<>'Standard' OR
          json_extract(records.facts,'$.risk')='High-risk home loan')))))
    ORDER BY v.applicationDate IS NULL,v.applicationDate,v.entryId LIMIT ?`)
    .all(tenant, ...scope, from, through, highRiskFrom, through, exportLimit + 1);
  if (rows.length > exportLimit) return { error: "This export exceeds 4,000 applications across the selected period and high-risk window. Reconcile incomplete records or choose a narrower examination period." };
  const entries = rows.map(row => readEntry(row, true));
  const reviewed: Entry[] = [];
  const highRisk: Entry[] = [];
  const incomplete: Entry[] = [];
  for (const row of entries) {
    const { applicationDate, product, highRisk: risk } = row.facts;
    if (row.status !== "Reviewed" || row.reviewIssue || !applicationDate || illinoisLogGaps(row.facts).length) {
      incomplete.push(row);
      continue;
    }
    if (applicationDate >= from) reviewed.push(row);
    if (product === "Brokerage or origination" && risk === "High risk" && applicationDate >= highRiskFrom) highRisk.push(row);
  }
  const unmatchedCandidates = Number(db.prepare(`SELECT count(*) AS n ${candidateSource} ${unmatched}`).get(tenant)?.n ?? 0);
  const workbook = illinoisLoanLogWorkbook({ reviewed, highRisk, incomplete, entity, from, through, highRiskFrom, at: now, unmatchedCandidates });
  accessEvent(db, staff, "Prepared Illinois loan log spreadsheet", entityId, now);
  return { kind: "illinoisLogExport", xlsx: Buffer.from(workbook).toString("base64"), reviewedApplications: reviewed.length,
    highRiskApplications: highRisk.length, incomplete: incomplete.length, unmatchedCandidates, highRiskFrom };
}

// Loan retention verifies pilot owner access and runs this service in the workspace transaction.
export function illinoisLoanLogWork(db: Store, { entityId, input }: IllinoisLoanLogRequest, staff: WorkspaceStaff, now: string): IllinoisLoanLogResult {
  const tenant = staff.brokerage.id;
  const scope: [string, string] = [tenant, entityId];
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(...scope) as Entity | undefined;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (input.operation === "candidates") {
    const rows = db.prepare(`SELECT l.id AS loanId,c.name AS borrower,l.stage,l.disposition,${propertyState} AS propertyState,
      ${reportState} AS reportState,nullif(json_extract(prep.facts,'$.receivedDate'),'') AS reportedApplicationDate,
      (SELECT v.entryId FROM illinois_loan_log_versions v WHERE v.brokerageId=? AND v.entityId=? AND v.loanId=l.id
        AND v.status='Draft' AND ${latest}) AS draftEntryId,
      EXISTS (SELECT 1 FROM illinois_loan_log_versions v WHERE v.brokerageId=? AND v.entityId<>? AND v.loanId=l.id
        AND v.status='Draft' AND ${latest}) AS draftInAnotherEntity
      ${candidateSource} ${unmatched} AND instr(lower(c.name),lower(?))>0
      ORDER BY c.name COLLATE NOCASE,l.id LIMIT ? OFFSET ?`)
      .all(...scope, ...scope, tenant, input.search, pageSize + 1, input.offset) as
      (Omit<Candidate, "draftInAnotherEntity"> & { draftInAnotherEntity: number })[];
    return { kind: "illinoisLogCandidates", items: rows.slice(0, pageSize).map(row => ({ ...row, draftInAnotherEntity: Boolean(row.draftInAnotherEntity) })),
      next: rows.length > pageSize ? input.offset + pageSize : null };
  }
  const today = illinoisRetentionLocalDate(now);
  if (input.operation === "list" || input.operation === "export") {
    if (input.from > input.through || input.through > today) return { error: "Choose an ordered application date range through today." };
    if (input.operation === "export") return exportLog(db, scope, entity, input.from, input.through, staff, now);
    const search = normalize(input.search);
    const rows = db.prepare(`SELECT v.*,${linkFields} ${logSource}
      AND (v.applicationDate BETWEEN ? AND ? OR v.applicationDate IS NULL)
      AND (?='All' OR v.status=?) AND (?='All' OR v.product=?)
      AND (instr(v.borrowerSearch,?)>0 OR instr(coalesce(v.fileKey,''),?)>0)
      ORDER BY v.applicationDate IS NULL,v.applicationDate,v.entryId LIMIT ? OFFSET ?`)
      .all(tenant, ...scope, input.from, input.through, input.status, input.status, input.product, input.product, search, search,
        pageSize + 1, input.offset);
    return { kind: "illinoisLogList", items: rows.slice(0, pageSize).map(row => readEntry(row, true)),
      next: rows.length > pageSize ? input.offset + pageSize : null };
  }
  const target = [...scope, input.entryId];
  function history(before: number | null, message?: string): IllinoisLoanLogResult {
    const rows = db.prepare(`SELECT * FROM illinois_loan_log_versions WHERE brokerageId=? AND entityId=? AND entryId=?
      AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`).all(...target, before, before, pageSize + 1);
    const versions = rows.slice(0, pageSize).map(row => readEntry(row));
    const current = before === null ? versions[0] : undefined;
    if (current) current.reviewIssue = currentLinkIssue(db, tenant, current.loanId, current.facts);
    return { kind: "illinoisLogHistory", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null, message };
  }
  if (input.operation === "history") return history(input.before ?? null);
  const request = JSON.stringify(input);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const prior = db.prepare("SELECT * FROM illinois_loan_log_versions WHERE brokerageId=? AND requestId=?").get(tenant, input.requestId);
  const saved = "Illinois loan log entry recorded.";
  if (prior) {
    if (prior.entityId !== entityId || prior.request !== request || prior.actorEmail !== staff.email || prior.actorRevision !== actorRevision) return stale;
    return history(null, saved);
  }
  const current = db.prepare(`SELECT * FROM illinois_loan_log_versions WHERE brokerageId=? AND entityId=? AND entryId=?
    ORDER BY version DESC LIMIT 1`).get(...target);
  if ((current?.version ?? 0) !== input.expected) return stale;
  if (current && !input.correction) return { error: "Record why this loan log entry is changing." };
  if (current?.loanId && current.loanId !== input.loanId)
    return { error: "Withdraw this entry and record a separate entry to change its linked loan." };
  const { facts } = input;
  const factsJson = JSON.stringify(facts);
  if (input.status === "Withdrawn" && (!current || current.facts !== factsJson || current.loanId !== input.loanId))
    return { error: "Withdraw an existing entry with its last recorded facts." };
  if ([facts.applicationDate, facts.closing?.on, facts.shared?.counselingOn].some(on => on && on > today))
    return { error: "Loan log evidence dates must already have occurred." };
  const link = currentLinkIssue(db, tenant, input.loanId, facts);
  if (input.status !== "Withdrawn" && input.loanId && link?.startsWith("The linked loan lacks")) return { error: link };
  if (input.status === "Reviewed") {
    if (link) return { error: link };
    const gaps = illinoisLogGaps(facts);
    if (gaps.length) return { error: `Complete the loan log before marking reviewed. Missing ${gaps.join(", ")}.` };
  }
  const fileKey = facts.fileNumber ? normalize(facts.fileNumber) : null;
  if (input.status !== "Withdrawn" && db.prepare(`SELECT 1 FROM illinois_loan_log_versions v
    WHERE v.brokerageId=? AND (v.entityId<>? OR v.entryId<>?) AND v.status<>'Withdrawn' AND ${latest}
    AND (v.loanId=? OR (v.entityId=? AND v.fileKey=?)) LIMIT 1`).get(tenant, entityId, input.entryId, input.loanId, entityId, fileKey))
    return { error: "An active Illinois loan log entry already matches this loan or file number." };
  db.prepare(`INSERT INTO illinois_loan_log_versions (brokerageId,entityId,entryId,version,requestId,loanId,status,facts,fileKey,borrowerSearch,
    applicationDate,product,risk,evidence,correction,entity,at,actor,actorEmail,actorRevision,request) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...target, input.expected + 1, input.requestId, input.loanId, input.status, factsJson, fileKey,
      facts.borrowers.map(person => normalize(person.name)).join("\n"), facts.applicationDate ?? null, facts.product, facts.highRisk ?? null,
      input.evidence, input.correction ?? null, JSON.stringify(entity), now, staff.name, staff.email, actorRevision, request);
  accessEvent(db, staff, "Recorded Illinois loan log evidence", input.entryId, now);
  return history(null, saved);
}

function currentLinkIssue(db: Store, tenant: string, loanId: string | null, facts: IllinoisLogFacts) {
  const linked = loanId ? db.prepare(`SELECT ${linkFields} FROM loans l ${loanJoins} ${borrowerFile} WHERE l.id=?`).get(tenant, loanId) : null;
  return linkIssue(loanId, facts, linked ?? {});
}

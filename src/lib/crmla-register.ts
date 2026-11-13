import { crmlaRegisterFrom, crmlaRegisterSource, reviewCrmlaRegister, type CrmlaRegisterFacts, type CrmlaRegisterRequest } from "./crmla-register-model";
import { loanRegisterWorkbook, type RegisterCell } from "./ohio-loan-register-spreadsheet";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const pageSize = 20;
const exportLimit = 3000;
const stale = { error: "This CRMLA application register entry changed. Reload before recording another version." };
type Entity = { name: string; nmls: string };
type Stored = { entryId: string; version: number; facts: string; at: string; actor: string;
  entity: string; correction: string | null; voided: number };

export function initializeCrmlaRegister(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS crmla_register_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, entryId TEXT NOT NULL, version INTEGER NOT NULL,
    requestId TEXT NOT NULL, applicationOn TEXT NOT NULL, fileKey TEXT NOT NULL, searchText TEXT NOT NULL,
    facts TEXT NOT NULL, entity TEXT NOT NULL, at TEXT NOT NULL, correction TEXT,
    actor TEXT NOT NULL, actorEmail TEXT NOT NULL, actorRevision INTEGER NOT NULL, request TEXT NOT NULL, voided INTEGER NOT NULL,
    PRIMARY KEY(brokerageId,entityId,entryId,version), UNIQUE(brokerageId,requestId)
  );
  CREATE INDEX IF NOT EXISTS crmla_register_period ON crmla_register_versions(brokerageId,entityId,applicationOn,entryId);
  CREATE INDEX IF NOT EXISTS crmla_register_file ON crmla_register_versions(brokerageId,entityId,fileKey);`);
}

const latest = `NOT EXISTS (SELECT 1 FROM crmla_register_versions newer
  WHERE newer.brokerageId=v.brokerageId AND newer.entityId=v.entityId AND newer.entryId=v.entryId AND newer.version>v.version)`;
const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
const format = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
});
const localDate = (at: string) => format.format(new Date(at));

function entry(row: Stored) {
  const facts = JSON.parse(row.facts) as CrmlaRegisterFacts;
  return { entryId: row.entryId, version: row.version, facts, review: reviewCrmlaRegister(facts),
    entity: JSON.parse(row.entity) as Entity, at: row.at, actor: row.actor, correction: row.correction, voided: Boolean(row.voided) };
}

type Entry = ReturnType<typeof entry>;
export type CrmlaRegisterResult =
  | { kind: "crmlaRegisterList"; items: Entry[]; next: number | null }
  | { kind: "crmlaRegisterHistory"; versions: Entry[]; next: number | null }
  | { kind: "crmlaRegisterExport"; xlsx: string; entries: number; gaps: number; from: string; through: string }
  | { error: string };

function workbookSheet(name: string, headers: string[], rows: RegisterCell[][]) {
  return { name, rows: [headers, ...rows], widths: headers.map(label => Math.min(45, Math.max(18, label.length + 2))), filter: true };
}

function exportLog(rows: Entry[], history: Entry[], entity: Entity, from: string, through: string, now: string): CrmlaRegisterResult {
  const cells = ({ facts }: Entry): RegisterCell[] => [
    facts.fileNumber, facts.applicationOn, facts.applicants.join("\n"), facts.propertyAddress ?? "",
    facts.amountCents === undefined ? "" : facts.amountCents / 100, facts.terms ?? "", facts.program ?? "",
    facts.officer ?? "", facts.outcome.status,
    facts.outcome.status === "Closed" ? facts.outcome.on : "",
    facts.outcome.status === "Closed" ? facts.outcome.disposition ?? "" : "",
    facts.outcome.status === "Closed" ? facts.outcome.servicing ?? "" : "",
  ];
  const headers = ["File number", "Application received", "Borrowers", "Property address", "Loan amount USD", "Terms", "Loan program",
    "Loan officer", "Outcome", "Closed on", "Loan disposition", "Servicing disposition"];
  const evidence = history.map(item => [
    ...cells(item), item.version, item.facts.applicationReference, "reference" in item.facts.outcome ? item.facts.outcome.reference : "",
    item.voided ? "Voided" : "Recorded", item.review.gaps.join("; "), item.at, item.actor, item.correction ?? "",
  ]);
  const scope = [
    ["Legal entity", entity.name], ["NMLS", entity.nmls], ["Received from", from], ["Received through", through],
    ["Prepared at", now], ["Evidence version", "Latest recorded evidence as of preparation. The date range selects applications by receipt."],
    ["Entries with gaps", rows.filter(row => row.review.gaps.length).length],
    ["Reconciliation", "Confirm all covered applications and any externally maintained records before examination."],
    ["Rule", crmlaRegisterSource],
  ];
  const file = loanRegisterWorkbook([
    workbookSheet("Application register", headers, rows.map(cells)),
    workbookSheet("Evidence history", [...headers, "Version", "Application evidence", "Outcome evidence", "Record status", "Gaps", "Saved at", "Actor", "Correction"], evidence),
    { name: "Export scope", rows: scope, widths: [28, 100], filter: false },
  ]);
  return { kind: "crmlaRegisterExport", xlsx: Buffer.from(file).toString("base64"), entries: rows.length,
    gaps: rows.filter(row => row.review.gaps.length).length, from, through };
}

export function crmlaRegisterWork(db: Store, { entityId, input }: CrmlaRegisterRequest, staff: WorkspaceStaff, now: string): CrmlaRegisterResult {
  const scope = [staff.brokerage.id, entityId] as const;
  const entity = db.prepare("SELECT name,nmls FROM compliance_program_entities WHERE brokerageId=? AND id=?").get(...scope) as Entity | undefined;
  if (!entity) return { error: "Choose a recorded brokerage legal entity." };
  if (input.operation === "list" || input.operation === "export") {
    const from = input.operation === "list" ? input.from : crmlaRegisterFrom(input.through);
    if (from > input.through || input.through > localDate(now))
      return { error: "Choose an ordered application date range through today." };
    const listing = input.operation === "list";
    const limit = listing ? pageSize : exportLimit;
    const offset = listing ? input.offset : 0;
    const rows = db.prepare(`SELECT v.* FROM crmla_register_versions v WHERE v.brokerageId=? AND v.entityId=?
      AND ${latest} AND v.applicationOn BETWEEN ? AND ? AND instr(v.searchText,?)>0 AND (?=0 OR v.voided=0)
      ORDER BY v.applicationOn,v.entryId LIMIT ? OFFSET ?`)
      .all(...scope, from, input.through, listing ? normalize(input.search) : "", Number(!listing), limit + 1, offset) as Stored[];
    if (listing)
      return { kind: "crmlaRegisterList", items: rows.slice(0, limit).map(entry), next: rows.length > limit ? offset + limit : null };
    if (rows.length > limit) return { error: "This export exceeds 3,000 entries. Use an external examination report for the full period." };
    const historyLimit = 12000;
    const versions = db.prepare(`WITH selected AS (SELECT DISTINCT v.entryId FROM crmla_register_versions v
      WHERE v.brokerageId=? AND v.entityId=? AND v.applicationOn BETWEEN ? AND ?)
      SELECT a.* FROM crmla_register_versions a JOIN selected ON selected.entryId=a.entryId
      WHERE a.brokerageId=? AND a.entityId=? ORDER BY a.entryId,a.version LIMIT ?`)
      .all(...scope, from, input.through, ...scope, historyLimit + 1) as Stored[];
    if (versions.length > historyLimit) return { error: "This export exceeds 12,000 evidence versions. Use an external examination report for the full period." };
    const entries = rows.map(entry);
    accessEvent(db, staff, "Exported CRMLA application register", entityId, now);
    return exportLog(entries, versions.map(entry), entity, from, input.through, now);
  }

  const target = [...scope, input.entryId] as const;
  function history(before?: number): CrmlaRegisterResult {
    const rows = db.prepare(`SELECT * FROM crmla_register_versions WHERE brokerageId=? AND entityId=? AND entryId=?
      AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`).all(...target, before ?? null, before ?? null, pageSize + 1) as Stored[];
    const versions = rows.slice(0, pageSize).map(entry);
    return { kind: "crmlaRegisterHistory", versions, next: rows.length > pageSize ? versions[pageSize - 1].version : null };
  }
  if (input.operation === "history") return history(input.before);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const request = JSON.stringify(input);
  const prior = db.prepare("SELECT entityId,request,actorEmail,actorRevision FROM crmla_register_versions WHERE brokerageId=? AND requestId=?")
    .get(scope[0], input.requestId);
  if (prior) return prior.entityId === entityId && prior.request === request && prior.actorEmail === staff.email &&
    prior.actorRevision === actorRevision ? history() : stale;
  const current = db.prepare(`SELECT * FROM crmla_register_versions WHERE brokerageId=? AND entityId=? AND entryId=?
    ORDER BY version DESC LIMIT 1`).get(...target) as Stored | undefined;
  if ((current?.version ?? 0) !== input.expected) return stale;
  if (current?.voided) return { error: "This entry was voided. Record a new entry if needed." };
  if (current && !input.correction) return { error: "Enter a reason for changing this CRMLA application register entry." };
  const saved = current ? JSON.parse(current.facts) as CrmlaRegisterFacts : undefined;
  const facts = input.operation === "save" ? input.facts : saved;
  if (!facts) return stale;
  const today = localDate(now);
  if (facts.applicationOn > today || (facts.outcome.status === "Closed" && facts.outcome.on > today))
    return { error: "Record application and closing events that have already occurred." };
  const voided = input.operation === "void";
  const fileKey = normalize(facts.fileNumber);
  if (!voided && db.prepare(`SELECT 1 FROM crmla_register_versions v WHERE v.brokerageId=? AND v.entityId=?
    AND v.entryId<>? AND v.fileKey=? AND v.voided=0 AND ${latest}`).get(...target, fileKey))
    return { error: "An active entry already uses this CRMLA application file number." };
  const searchText = normalize([facts.fileNumber, ...facts.applicants, facts.officer, facts.propertyAddress].join(" "));
  db.prepare(`INSERT INTO crmla_register_versions (brokerageId,entityId,entryId,version,requestId,applicationOn,fileKey,searchText,
    facts,entity,at,correction,actor,actorEmail,actorRevision,request,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...target, input.expected + 1, input.requestId, facts.applicationOn, fileKey, searchText, JSON.stringify(facts),
      JSON.stringify(entity), now, input.correction ?? null, staff.name, staff.email, actorRevision, request, Number(voided));
  accessEvent(db, staff, voided ? "Voided CRMLA application register evidence" : "Recorded CRMLA application register evidence", input.entryId, now);
  return history();
}

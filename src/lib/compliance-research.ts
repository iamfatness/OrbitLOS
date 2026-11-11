import { createHash } from "node:crypto";
import { researchRequest, researchSources, sourceSnapshot, type ResearchRequest } from "./compliance-research-model";
import { complianceWorkUnavailable, type complianceCaseStatuses } from "./compliance-case-model";
import type { VersionedBrokerageMember } from "./brokerage-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store, SqlValue } from "./store";

const unavailable = { error: complianceWorkUnavailable };
const changed = { error: "This research work changed. Refresh before saving." };
const coverage = { legalApproval: false, runtimeEnforcement: false, evaluatedFiles: null } as const;
type Row = { id: string; title: string; kind: "Requirement review" | "Control gap"; status: (typeof complianceCaseStatuses)[number];
  ownerEmail: string; ownerAccessRevision: number; revision: number; updatedAt: string;
  sourceKey: string; jurisdiction: string; sourceSnapshot: string; nextAction: string; followUpOn: string | null };
const columns = "c.id, c.title, c.kind, c.status, c.ownerEmail, c.ownerAccessRevision, c.revision, c.updatedAt, r.sourceKey, r.jurisdiction, r.sourceSnapshot, r.nextAction, r.followUpOn";
const source = "compliance_cases c JOIN compliance_research_work r ON r.brokerageId = c.brokerageId AND r.caseId = c.id";
const scope = "c.brokerageId = ? AND c.confidentiality = 'General' AND c.loanId IS NULL";

function read(db: Store, brokerageId: string, id: string) {
  const row = db.prepare(`SELECT ${columns} FROM ${source} WHERE ${scope} AND c.id = ?`).get(brokerageId, id);
  return row ? { ...row } as Row : undefined;
}
function project(row: Row, roster: readonly VersionedBrokerageMember[], today: string) {
  const owner = roster.find((member) => member.email === row.ownerEmail && member.status === "Active" && member.role === "Admin" &&
    (member.accessRevision ?? 0) === row.ownerAccessRevision);
  const currentSource = researchSources.find((entry) => entry.key === row.sourceKey);
  return { ...row, ownerName: owner?.name ?? null, ownerAvailable: Boolean(owner), overdue: Boolean(row.followUpOn && row.followUpOn < today),
    sourceChanged: !currentSource || sourceSnapshot(currentSource) !== row.sourceSnapshot };
}
function detail(db: Store, staff: WorkspaceStaff, roster: readonly VersionedBrokerageMember[], row: Row, now: string) {
  const history = db.prepare(`SELECT revision, actor, at, action, payload FROM compliance_case_events
    WHERE brokerageId = ? AND caseId = ? ORDER BY revision DESC LIMIT 51`).all(staff.brokerage.id, row.id);
  return { kind: "researchDetail", coverage, item: project(row, roster, now.slice(0, 10)),
    owners: roster.filter((member) => member.status === "Active" && member.role === "Admin").map(({ email, name }) => ({ email, name })),
    history: history.slice(0, 50).map((entry) => ({ revision: Number(entry.revision), actor: String(entry.actor), at: String(entry.at),
      action: String(entry.action), note: String((JSON.parse(String(entry.payload)) as { request?: { note?: string } }).request?.note ?? "") })),
    moreHistory: history.length > 50 } as const;
}
function event(db: Store, staff: WorkspaceStaff, row: Pick<Row, "id" | "revision">, now: string, action: string, request: object, requestId: string | null) {
  db.prepare(`INSERT INTO compliance_case_events (brokerageId, caseId, revision, requestId, actor, at, action, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(staff.brokerage.id, row.id, row.revision, requestId, staff.email, now, action, JSON.stringify({ request }));
}

/** Called inside complianceCaseWork's transaction after authenticated roster verification. */
export function complianceResearchWork(db: Store, input: ResearchRequest, staff: WorkspaceStaff, roster: readonly VersionedBrokerageMember[], now: string) {
  if (staff.brokerage.role !== "Admin") return unavailable;
  const parsed = researchRequest.safeParse(input);
  if (!parsed.success) return unavailable;
  const data = parsed.data;
  if (data.operation === "list") {
    const { filters, after } = data;
    if (filters.jurisdiction && !researchSources.some((entry) => entry.jurisdiction === filters.jurisdiction)) return unavailable;
    const active = roster.filter((member) => member.status === "Active" && member.role === "Admin")
      .map(({ email, accessRevision }) => ({ email, rev: accessRevision ?? 0 })).sort((a, b) => a.email.localeCompare(b.email));
    const ownerValid = `EXISTS (SELECT 1 FROM json_each(?) member WHERE member.value ->> 'email' = c.ownerEmail AND member.value ->> 'rev' = c.ownerAccessRevision)`;
    const where = `${scope}${filters.jurisdiction ? " AND r.jurisdiction = ?" : ""}${filters.status ? " AND c.status = ?" : ""}` +
      (filters.ownership === "mine" ? ` AND c.ownerEmail = ? AND ${ownerValid}` : filters.ownership === "unavailable" ? ` AND NOT ${ownerValid}` : "");
    const args: SqlValue[] = [staff.brokerage.id, ...(filters.jurisdiction ? [filters.jurisdiction] : []), ...(filters.status ? [filters.status] : []),
      ...(filters.ownership === "mine" ? [staff.email, JSON.stringify(active)] : filters.ownership === "unavailable" ? [JSON.stringify(active)] : [])];
    const count = db.prepare(`SELECT count(*) AS total, coalesce(sum(c.revision), 0) AS versions,
      count(CASE WHEN r.followUpOn < ? THEN 1 END) AS overdue FROM ${source} WHERE ${where}`).get(now.slice(0, 10), ...args)!;
    // The cohort also changes when directory access changes, including an owner's revoke/reinvite.
    const snapshot = JSON.stringify([staff.brokerage.id, staff.email, filters, count.total, count.versions,
      createHash("sha256").update(JSON.stringify(active)).digest("hex"), now.slice(0, 10)]);
    if (after && (after.snapshot !== snapshot || !db.prepare(`SELECT 1 FROM ${source} WHERE ${where} AND c.id = ?`).get(...args, after.id))) {
      return { error: "This research queue changed. Refresh the first page." };
    }
    const rows = db.prepare(`SELECT ${columns} FROM ${source} WHERE ${where}${after ? " AND c.id > ?" : ""} ORDER BY c.id LIMIT 21`)
      .all(...args, ...(after ? [after.id] : [])).map((row) => project({ ...row } as Row, roster, now.slice(0, 10)));
    const page = rows.slice(0, 20);
    return { kind: "researchList", coverage, counts: { total: Number(count.total), overdue: Number(count.overdue) }, checkedAt: now,
      items: page, next: rows.length > 20 ? { id: page.at(-1)!.id, snapshot } : null } as const;
  }
  if (data.operation === "open") {
    const entry = researchSources.find((item) => item.key === data.sourceKey);
    if (!entry) return unavailable;
    const key = `research:${data.kind}:${entry.key}`;
    const previous = db.prepare("SELECT id FROM compliance_cases WHERE brokerageId = ? AND caseKey = ?").get(staff.brokerage.id, key);
    if (previous) {
      const existing = read(db, staff.brokerage.id, String(previous.id));
      return existing ? detail(db, staff, roster, existing, now) : unavailable;
    }
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO compliance_cases (brokerageId, id, caseKey, kind, confidentiality, title, status,
      ownerEmail, ownerAccessRevision, revision, openedAt, updatedAt) VALUES (?, ?, ?, ?, 'General', ?, 'Open', ?, ?, 1, ?, ?)`)
      .run(staff.brokerage.id, id, key, data.kind, `${entry.title} · ${data.kind.toLowerCase()}`, staff.email, staff.brokerage.accessRevision ?? 0, now, now);
    db.prepare(`INSERT INTO compliance_research_work (brokerageId, caseId, sourceKey, jurisdiction, sourceSnapshot, nextAction)
      VALUES (?, ?, ?, ?, ?, ?)`).run(staff.brokerage.id, id, entry.key, entry.jurisdiction, sourceSnapshot(entry),
        data.kind === "Requirement review" ? "Confirm applicability and current authority with the compliance reviewer." : "Document the missing control, accountable owner and validation evidence.");
    event(db, staff, { id, revision: 1 }, now, "Opened research work", data, null);
    return detail(db, staff, roster, read(db, staff.brokerage.id, id)!, now);
  }
  const row = read(db, staff.brokerage.id, data.caseId);
  if (!row) return unavailable;
  if (data.operation === "read") return detail(db, staff, roster, row, now);
  const replay = db.prepare(`SELECT actor, payload FROM compliance_case_events WHERE brokerageId = ? AND caseId = ? AND requestId = ?`)
    .get(staff.brokerage.id, row.id, data.requestId);
  if (replay) return replay.actor === staff.email && replay.payload === JSON.stringify({ request: data }) ? detail(db, staff, roster, row, now) : changed;
  if (row.revision !== data.expectedRevision) return changed;
  const owner = roster.find((member) => member.email === data.ownerEmail && member.status === "Active" && member.role === "Admin");
  if (!owner) return { error: "Choose an active brokerage admin to own this research work." };
  db.prepare(`UPDATE compliance_cases SET ownerEmail = ?, ownerAccessRevision = ?, status = ?, revision = revision + 1, updatedAt = ?
    WHERE brokerageId = ? AND id = ? AND revision = ?`).run(owner.email, owner.accessRevision ?? 0, data.status, now, staff.brokerage.id, row.id, row.revision);
  db.prepare("UPDATE compliance_research_work SET nextAction = ?, followUpOn = ? WHERE brokerageId = ? AND caseId = ?")
    .run(data.nextAction, data.followUpOn, staff.brokerage.id, row.id);
  event(db, staff, { id: row.id, revision: row.revision + 1 }, now, "Updated research work", data, data.requestId);
  return detail(db, staff, roster, read(db, staff.brokerage.id, row.id)!, now);
}

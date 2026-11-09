import { readContactDirectory } from "./contact-directory";
import { leadRouting } from "./lead-inbox";
import { realtorWorkInput, realtorWorkUnavailable, type ConversionCounts, type RealtorFilters, type RealtorProfile, type RealtorRecord,
  type RealtorWorkQuery, type RealtorWorkResult } from "./realtor-work-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const pageSize = 20;
const emptyCounts: ConversionCounts = { referrals: 0, submitted: 0, funded: 0 };
const loanAt = "coalesce(loan.createdAt, loan.stageSince)";
const loanStatus = "CASE WHEN loan.disposition = 'Active' THEN loan.stage ELSE loan.disposition END";
const leadStatus = "CASE WHEN lead.resolvedAt IS NOT NULL THEN 'Closed without a linked loan' WHEN lead.heldAt IS NOT NULL THEN 'On hold' ELSE 'Awaiting conversion' END";
const submittedAt = "coalesce((SELECT submittedAt FROM application_versions WHERE loanId = loan.id ORDER BY revision DESC LIMIT 1), app.submittedAt)";

function conversion(ids: string[], filters: RealtorFilters) {
  const idsJson = JSON.stringify(ids);
  const direct = ids.includes("");
  const candidates = direct ? "SELECT id FROM loans WHERE partnerId IS NULL" : `
    SELECT id FROM loans WHERE partnerId IN (SELECT value FROM partners)
    UNION SELECT loanId FROM referral_leads WHERE realtorId IN (SELECT value FROM partners) AND loanId IS NOT NULL`;
  const sql = `WITH partners AS (SELECT value FROM json_each(?)), candidates AS (${candidates}),
    entries AS (
      SELECT loan.id, 'loan' AS kind, borrower.name, ${loanStatus} AS status, ${loanAt} AS at, loan.officer,
        loan.leadSource AS source, ${submittedAt} AS submittedAt, closing.fundingDate AS fundedOn, 0 AS archived,
        coalesce((SELECT realtorId FROM referral_leads WHERE loanId = loan.id ORDER BY createdAt, id LIMIT 1), loan.partnerId, '') AS partnerId
      FROM candidates JOIN loans loan ON loan.id = candidates.id
      JOIN contacts borrower ON borrower.id = loan.contactId
      LEFT JOIN applications app ON app.loanId = loan.id LEFT JOIN closing_progress closing ON closing.loanId = loan.id
      WHERE (? = '' OR coalesce(nullif(loan.officerEmail, ''), loan.officer) = ?) AND (? = '' OR loan.leadSource = ?)
      ${direct ? "" : `UNION ALL
      SELECT lead.id, 'lead', lead.name, ${leadStatus}, lead.createdAt, lead.officer, 'Realtor referral', NULL, NULL, lead.archiveToken IS NOT NULL, lead.realtorId
      FROM referral_leads lead WHERE lead.realtorId IN (SELECT value FROM partners) AND lead.loanId IS NULL
        AND (? = '' OR coalesce(nullif(lead.officerEmail, ''), lead.officer) = ?) AND ? IN ('', 'Realtor referral')`}
    ), records AS (
      SELECT * FROM entries WHERE partnerId IN (SELECT value FROM partners)
        AND (? = '' OR substr(at, 1, 10) >= ?) AND (? = '' OR substr(at, 1, 10) <= ?)
    )`;
  return { sql, params: [idsJson, filters.officer, filters.officer, filters.source, filters.source,
    ...(direct ? [] : [filters.officer, filters.officer, filters.source]), filters.from, filters.from, filters.through, filters.through] };
}

function conversionCounts(db: Store, ids: string[], filters: RealtorFilters) {
  const { sql, params } = conversion(ids, filters);
  const rows = db.prepare(`${sql}
    SELECT partnerId, count(*) AS referrals, count(nullif(submittedAt, '')) AS submitted, count(nullif(fundedOn, '')) AS funded
    FROM records GROUP BY partnerId`).all(...params);
  return new Map(rows.map(({ partnerId, ...counts }) => [String(partnerId), counts as ConversionCounts]));
}

function profile(db: Store, contact: RealtorProfile["contact"]): RealtorProfile {
  const row = db.prepare("SELECT realtorId, token, expiresAt, officerEmail, revision FROM realtor_portals WHERE realtorId = ?").get(contact.id);
  const { realtorRoute, realtorOwner } = leadRouting(db);
  const loanTotals = db.prepare(`SELECT count(*) AS linked, count(CASE WHEN stage IN ('Funded', 'Closed') THEN 1 END) AS closed
    FROM loans WHERE partnerId = ?`).get(contact.id);
  const open = db.prepare("SELECT count(*) AS open FROM referral_leads WHERE realtorId = ? AND resolvedAt IS NULL AND loanId IS NULL").get(contact.id);
  const portal = row ? { realtorId: contact.id, token: String(row.token), expiresAt: String(row.expiresAt),
    officerEmail: row.officerEmail as string | null, revision: Number(row.revision) } : null;
  return { kind: "profile", contact, portal, checkedAt: new Date().toISOString(),
    routing: { realtorRoute, realtorOwner }, linked: Number(loanTotals?.linked), closed: Number(loanTotals?.closed), open: Number(open?.open) };
}

function readRecords(db: Store, partnerName: string, { partnerId, view, filters, after }: Extract<RealtorWorkQuery, { type: "records" }>): RealtorWorkResult {
  const query = view === "linked" ? {
    sql: `WITH records AS (SELECT loan.id, 'loan' AS kind, borrower.name, ${loanStatus} AS status, loan.stageSince AS at, loan.officer,
      loan.leadSource AS source, ${submittedAt} AS submittedAt, closing.fundingDate AS fundedOn, 0 AS archived
      FROM loans loan JOIN contacts borrower ON borrower.id = loan.contactId
      LEFT JOIN applications app ON app.loanId = loan.id LEFT JOIN closing_progress closing ON closing.loanId = loan.id
      WHERE loan.partnerId = ?)`,
    params: [partnerId],
  } : view === "open" ? {
    sql: `WITH records AS (SELECT lead.id, 'lead' AS kind, lead.name, ${leadStatus} AS status, lead.createdAt AS at,
      lead.officer, 'Realtor referral' AS source, NULL AS submittedAt, NULL AS fundedOn, 0 AS archived
      FROM referral_leads lead WHERE lead.realtorId = ? AND lead.resolvedAt IS NULL AND lead.loanId IS NULL)`,
    params: [partnerId],
  } : conversion([partnerId], filters);
  const where = view === "submitted" ? "nullif(submittedAt, '') IS NOT NULL" : view === "funded" ? "nullif(fundedOn, '') IS NOT NULL" : "1";
  const total = after ? undefined : Number(db.prepare(`${query.sql} SELECT count(*) AS total FROM records WHERE ${where}`).get(...query.params)?.total);
  const rows = db.prepare(`${query.sql}, page AS (
    SELECT id, kind, name, status, at, officer, source, submittedAt, fundedOn, archived FROM records WHERE ${where}
    ${after ? "AND (at < ? OR (at = ? AND (id, kind) > (?, ?)))" : ""} ORDER BY at DESC, id, kind LIMIT ?
  ) SELECT page.* ${view === "linked" ? `,
    (SELECT count(*) FROM tasks WHERE loanId = page.id AND completedAt IS NULL) AS openTasks,
    (SELECT createdAt FROM activity WHERE loanId = page.id ORDER BY createdAt DESC, id DESC LIMIT 1) AS lastActivityAt` : ""}
    FROM page ORDER BY at DESC, id, kind`).all(...query.params, ...(after ? [after.at, after.at, after.id, after.kind] : []), pageSize + 1);
  const page = rows.slice(0, pageSize).map((row) => ({ ...row, archived: Boolean(row.archived) }) as RealtorRecord);
  const last = page.at(-1);
  return { kind: "records", partnerName, total, rows: page,
    next: rows.length > pageSize && last ? { id: last.id, at: last.at, kind: last.kind } : null };
}

export function readRealtorWork(db: Store, input: unknown, staff: WorkspaceStaff | null): RealtorWorkResult {
  const parsed = realtorWorkInput.safeParse(input);
  if (!parsed.success || (staff && staff.brokerage.role !== "Admin")) return { error: realtorWorkUnavailable };
  const data = parsed.data;
  if (data.type === "directory") {
    const page = readContactDirectory(db, { type: "list", role: "Realtor", search: data.search, after: data.after }, staff);
    if (!("kind" in page) || page.kind !== "list") return { error: realtorWorkUnavailable };
    const counts = page.rows.length ? conversionCounts(db, page.rows.map(({ id }) => id), data.filters) : new Map<string, ConversionCounts>();
    const showDirect = !data.search && !data.after;
    const officers = data.after ? undefined : db.prepare(`
      SELECT key, max(name) AS name FROM (
        SELECT coalesce(nullif(officerEmail, ''), officer) AS key, officer AS name FROM loans
        UNION SELECT coalesce(nullif(officerEmail, ''), officer), officer FROM referral_leads WHERE realtorId IS NOT NULL AND loanId IS NULL
      ) WHERE key <> '' GROUP BY key ORDER BY name COLLATE NOCASE, key`).all().map(({ key, name }) => ({ key: String(key), name: String(name) }));
    return { kind: "directory", partners: page.rows.map(({ id, name }) => ({ id, name, counts: counts.get(id) ?? emptyCounts })),
      direct: showDirect ? { id: "", name: "No realtor attributed", counts: conversionCounts(db, [""], data.filters).get("") ?? emptyCounts } : undefined,
      next: page.next, officers };
  }
  const row = data.partnerId ? db.prepare("SELECT id, name, role, email, phone FROM contacts WHERE id = ? AND role = 'Realtor'").get(data.partnerId) : null;
  if (!row && (data.partnerId || data.type === "profile" || data.view === "linked" || data.view === "open")) return { error: "This realtor is unavailable." };
  if (data.type === "profile" && row) return profile(db, { ...row } as RealtorProfile["contact"]);
  return data.type === "records" ? readRecords(db, String(row?.name ?? "No realtor attributed"), data) : { error: realtorWorkUnavailable };
}

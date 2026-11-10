import { easternDate, nextAnniversary } from "./client-retention";
import { loanOutreachSuppressed } from "./outreach-preferences";
import { pastClientInput, pastClientsUnavailable, type PastClientPage, type PastClientRow, type ReturningClientOption } from "./past-client-queue-model";
import { fundingTaskId } from "./playbook-model";
import { recordedFundingCheckIn } from "./playbooks";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { loanAccess } from "./workspace-access";

const reached = "(profile.watchEnabled = 1 AND profile.observedRate IS NOT NULL AND profile.targetRate IS NOT NULL AND profile.observedRate <= profile.targetRate)";

export function returningClientSource(db: Store, loanId: string) {
  return db.prepare(`SELECT loan.contactId, loan.officer, loan.officerEmail, loan.address, closing.fundingDate, repeat.loanId AS repeatId,
    EXISTS (SELECT 1 FROM referral_leads lead WHERE lead.pastClientLoanId = loan.id AND lead.resolvedAt IS NULL) AS hasCampaignLead
    FROM loans loan LEFT JOIN closing_progress closing ON closing.loanId = loan.id
    JOIN contacts borrower ON borrower.id = loan.contactId
    LEFT JOIN returning_client_loans repeat ON repeat.fundedLoanId = loan.id
    WHERE loan.id = ? AND loan.disposition = 'Active' AND borrower.role <> 'Realtor'
    AND (closing.fundingDate IS NOT NULL OR (closing.loanId IS NULL AND loan.stage IN ('Funded', 'Closed')))`).get(loanId);
}

export function activeRateWatchTask(db: Store, loanId: string) {
  const taskId = `rate-watch:${loanId}`;
  return db.prepare(`SELECT 1 FROM past_client_profiles profile JOIN tasks task ON task.loanId = profile.loanId
    JOIN loans loan ON loan.id = profile.loanId
    WHERE profile.loanId = ? AND task.id = ? AND task.completedAt IS NULL
    AND loan.stage IN ('Funded', 'Closed') AND ${reached}`).get(loanId, taskId) &&
    !loanOutreachSuppressed(db, loanId) ? taskId : undefined;
}

export function returningClientOption(db: Store, loanId: string, staff: WorkspaceStaff | null): ReturningClientOption {
  if (staff?.brokerage.role === "Processor") return { kind: "unavailable" };
  const source = returningClientSource(db, loanId);
  if (!source) return { kind: "unavailable" };
  if (typeof source.repeatId === "string") return !staff || loanAccess(db, staff, source.repeatId) ?
    { kind: "open", loanId: source.repeatId } : { kind: "restricted" };
  if (source.hasCampaignLead) return { kind: "campaign" };
  if (source.fundingDate && (db.prepare("SELECT 1 FROM tasks WHERE id = ? AND loanId = ? AND completedAt IS NULL")
    .get(fundingTaskId(loanId, "borrower"), loanId) || recordedFundingCheckIn(db, loanId))) return { kind: "start" };
  return activeRateWatchTask(db, loanId) ? { kind: "start", fromRateWatch: true } : { kind: "unavailable" };
}

const pageSize = 20;
const closingDate = "coalesce(profile.closingDate, '') <> ''";
const year = "max(CAST(substr(profile.closingDate, 1, 4) AS INTEGER) + 1, CAST(substr(clock.today, 1, 4) AS INTEGER))";
function anniversary(yearSql: string) {
  return `printf('%04d-%s-%02d', ${yearSql}, substr(profile.closingDate, 6, 2),
    min(CAST(substr(profile.closingDate, 9, 2) AS INTEGER),
      CAST(strftime('%d', date(printf('%04d-%s-01', ${yearSql}, substr(profile.closingDate, 6, 2)), '+1 month', '-1 day')) AS INTEGER)))`;
}

export function readPastClientQueue(db: Store, input: unknown, staff: WorkspaceStaff | null, today = easternDate()): PastClientPage | { error: string } {
  const parsed = pastClientInput.safeParse(input);
  if (!parsed.success) return { error: pastClientsUnavailable };
  const { view, query, after } = parsed.data;
  const role = staff?.brokerage.role ?? "Admin";
  const from = role === "Processor" ? "loan_processing processing CROSS JOIN loans loan ON loan.id = processing.loanId" : "loans loan";
  const owner = role === "Processor" ? "processing.processorEmail = ?" : role === "LO" ? "loan.officerEmail = ?" : "1";
  const actor = staff && role !== "Admin" ? [staff.email] : [];
  const scope = `${owner} AND loan.stage IN ('Funded', 'Closed')`;
  const profiles = "LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id";
  const counts = after ? undefined : db.prepare(`SELECT count(*) AS clients, count(CASE WHEN ${closingDate} THEN 1 END) AS withDate,
    count(CASE WHEN profile.watchEnabled = 1 THEN 1 END) AS watched, count(CASE WHEN ${reached} THEN 1 END) AS reached
    FROM ${from} ${profiles} WHERE ${scope}`).get(...actor) as PastClientPage["totals"];
  const anniversaries = view === "Anniversaries";
  const rank = anniversaries ? `CASE WHEN ${anniversary(year)} < clock.today THEN ${anniversary(`(${year} + 1)`)} ELSE ${anniversary(year)} END`
    : view === "Rate watchlist" ? `CASE WHEN ${reached} THEN '0' ELSE '1' END` : "''";
  const viewFilter = anniversaries ? closingDate : view === "Rate watchlist" ? "profile.watchEnabled = 1" : "1";
  const needle = query.toLowerCase();
  const filter = needle ? `AND (instr(lower(borrower.name), ?) OR instr(lower(loan.address), ?) OR instr(lower(loan.officer), ?)
    OR borrower.name GLOB '*[^ -~]*' OR loan.address GLOB '*[^ -~]*' OR loan.officer GLOB '*[^ -~]*')` : "";
  type Row = Omit<PastClientRow, "profile" | "reached" | "anniversary" | "repeat"> &
    Omit<PastClientRow["profile"], "watchEnabled"> & { watchEnabled: number | null; reached: number | null; rank: string; stageSince: string };
  const rows: Row[] = [];
  let cursor = after;
  // SQLite lower() handles ASCII. Retain other spellings for the same Unicode match as the UI.
  const limit = needle ? 100 : pageSize + 1;
  while (rows.length <= pageSize) {
    const batch = db.prepare(`WITH candidates AS (
      SELECT loan.id, loan.stage, loan.address, loan.officer, loan.stageSince, borrower.id AS contactId, borrower.name AS borrower,
        profile.closingDate, profile.currentRate, profile.targetRate, profile.observedRate, profile.checkedAt, profile.watchEnabled,
        ${reached} AS reached, ${rank} AS rank
      FROM ${from} ${profiles} LEFT JOIN contacts borrower ON borrower.id = loan.contactId
      ${anniversaries ? "CROSS JOIN (SELECT ? AS today) clock" : ""}
      WHERE ${scope} AND ${viewFilter} ${filter})
      SELECT * FROM candidates ${cursor ? "WHERE (rank > ? OR (rank = ? AND (stageSince < ? OR (stageSince = ? AND id > ?))))" : ""}
      ORDER BY rank, stageSince DESC, id LIMIT ?`).all(...(anniversaries ? [today] : []), ...actor, ...(needle ? [needle, needle, needle] : []),
        ...(cursor ? [cursor.rank, cursor.rank, cursor.stageSince, cursor.stageSince, cursor.id] : []), limit) as unknown as Row[];
    rows.push(...batch.filter((row) => !needle || [row.borrower, row.address, row.officer].some((value) => value?.toLowerCase().includes(needle))));
    if (batch.length < limit) break;
    cursor = batch.at(-1);
  }
  const last = rows[pageSize - 1];
  return {
    totals: counts ? { ...counts } : undefined,
    rows: rows.slice(0, pageSize).map(({ id, stage, address, officer, contactId, borrower, reached, watchEnabled, closingDate, currentRate, targetRate, observedRate, checkedAt }) => ({
      id, stage, address, officer, contactId, borrower, reached: Boolean(reached), repeat: returningClientOption(db, id, staff).kind,
      anniversary: closingDate ? nextAnniversary(closingDate, today) : "",
      profile: { watchEnabled: Boolean(watchEnabled), closingDate, currentRate, targetRate, observedRate, checkedAt },
    })),
    next: rows.length > pageSize && last ? { rank: last.rank, stageSince: last.stageSince, id: last.id } : null,
  };
}

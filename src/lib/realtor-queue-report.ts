import { updateInboxLead } from "./lead-inbox";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { realtorQueueReportInput, realtorQueueReportUnavailable, type AssignWaitingRealtorInput, type RealtorQueueReport } from "./realtor-queue-report-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent } from "./workspace-access";

const pageSize = 20;
const sharedAt = "coalesce(lead.realtorSharedSince, lead.createdAt)";
const waitingFilter = "lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND lead.officerEmail IS NULL AND lead.realtorId IS NOT NULL";
const waitSeconds = (start: string, end: string) => Math.max(0, Math.floor(Date.parse(end) / 1000) - Math.floor(Date.parse(start) / 1000));
type Raw = Record<string, SqlValue>;

export function assignWaitingRealtor(db: Store, staff: WorkspaceStaff, brokerageId: string, input: AssignWaitingRealtorInput,
  recipient: StaffIdentity | null, now = new Date()) {
  if (staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin") return { error: realtorQueueReportUnavailable };
  if (recipient?.email !== input.officerEmail) return { error: "Choose an active loan officer or admin in this brokerage." };
  return db.transaction(() => {
    const waiting = db.prepare(`SELECT 1 FROM referral_leads lead JOIN contacts realtor ON realtor.id = lead.realtorId AND realtor.role = 'Realtor'
      WHERE lead.id = ? AND ${waitingFilter} AND ${sharedAt} = ?`).get(input.leadId, input.waitingSince);
    if (!waiting) return { error: "This referral has changed or left the queue. Review the refreshed waiting list." };
    const at = now.toISOString();
    const result = updateInboxLead(db, staff, { type: "assignInboxLead", leadId: input.leadId, email: recipient.email, previousEmail: null }, [recipient], at);
    if ("error" in result) return result;
    accessEvent(db, staff, "Assigned waiting realtor referral", input.leadId, at);
    return { message: `Referral assigned to ${recipient.name}. Its first-contact deadline is unchanged.` };
  });
}

export function readRealtorQueueReport(db: Store, staff: WorkspaceStaff | null, brokerageId: string, input: unknown,
  now = new Date()): RealtorQueueReport | { error: string } {
  if (staff?.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin") return { error: realtorQueueReportUnavailable };
  const parsed = realtorQueueReportInput.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid referral queue view and date range." };
  const { days, view, after } = parsed.data;
  const checkedAt = now.toISOString();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const waiting = db.prepare(`SELECT count(*) AS total, min(${sharedAt}) AS oldest FROM referral_leads lead
    JOIN contacts realtor ON realtor.id = lead.realtorId AND realtor.role = 'Realtor' WHERE ${waitingFilter}`).get();
  const history = db.prepare(`SELECT count(*) AS total, sum(estimated = 0) AS measured,
    avg(CASE WHEN estimated = 0 THEN max(0, unixepoch(claimedAt) - unixepoch(sharedSince)) END) AS average
    FROM realtor_referral_claims WHERE claimedAt >= ? AND claimedAt <= ?`).get(since, checkedAt);
  const names = "lead.id AS leadId, lead.name, realtor.name AS realtor, lead.loanId, lead.resolvedAt, lead.dueAt";
  const joined = "JOIN contacts realtor ON realtor.id = lead.realtorId";
  let rows: Raw[];
  let suppression: ReturnType<typeof blockedOutreachKeys> | undefined;
  if (view === "Waiting") {
    rows = db.prepare(`SELECT ${names}, lead.id, ${sharedAt} AS at, lead.realtorSharedSince IS NULL AS estimated,
      lead.email, lead.phone, lead.importedContactId AS contactId, follow.firstContactAt, follow.replyReceivedAt, campaign.lastOutcome
      FROM referral_leads lead ${joined} AND realtor.role = 'Realtor'
      LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
      LEFT JOIN call_campaign_members campaign ON campaign.leadId = lead.id
      WHERE ${waitingFilter} ${after ? `AND (${sharedAt}, lead.id) > (?, ?)` : ""}
      ORDER BY ${sharedAt}, lead.id LIMIT ?`).all(...(after ? [after.at, after.id] : []), pageSize + 1);
    suppression = blockedOutreachKeys(db, rows.slice(0, pageSize));
  } else {
    rows = db.prepare(`SELECT ${names}, claim.id, claim.claimedAt AS at, claim.sharedSince, claim.estimated, claim.officerName
      FROM realtor_referral_claims claim JOIN referral_leads lead ON lead.id = claim.leadId ${joined}
      WHERE claim.claimedAt >= ? AND claim.claimedAt <= ? ${after ? "AND (claim.claimedAt, claim.id) < (?, ?)" : ""}
      ORDER BY claim.claimedAt DESC, claim.id DESC LIMIT ?`).all(since, checkedAt, ...(after ? [after.at, after.id] : []), pageSize + 1);
  }
  const items = rows.slice(0, pageSize).map((row) => {
    const at = String(row.at);
    let contactStatus = null;
    if (suppression) {
      const blocked = row.lastOutcome === "Opted out" || outreachSuppressed(suppression, row);
      contactStatus = blocked ? "Outreach opted out" : row.replyReceivedAt ? "Reply received" : row.firstContactAt ? "First contact logged" :
        String(row.dueAt) <= checkedAt ? "First contact overdue" : "First contact due";
    }
    return {
      id: String(row.id), at, leadId: String(row.leadId), name: String(row.name), realtor: String(row.realtor),
      loanId: row.loanId as string | null, closed: Boolean(row.resolvedAt), officer: typeof row.officerName === "string" ? row.officerName : null,
      seconds: row.sharedSince ? waitSeconds(String(row.sharedSince), at) : waitSeconds(at, checkedAt),
      estimated: Boolean(row.estimated), dueAt: String(row.dueAt), contactStatus,
    };
  });
  const last = items.at(-1);
  return { checkedAt, waiting: Number(waiting?.total ?? 0),
    oldestWaitSeconds: typeof waiting?.oldest === "string" ? waitSeconds(waiting.oldest, checkedAt) : null,
    claims: Number(history?.total ?? 0), measuredClaims: Number(history?.measured ?? 0),
    averageWaitSeconds: typeof history?.average === "number" ? history.average : null, items,
    next: rows.length > pageSize && last ? { at: last.at, id: last.id } : null };
}

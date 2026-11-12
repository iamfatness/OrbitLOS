import { leadRouting } from "./lead-inbox";
import { leadAttentionView, leadInboxRequest, leadInboxUnavailable, type InboxLeadSummary, type LeadInboxPage } from "./lead-inbox-model";
import { leadWorkUnavailable, type LeadWorkRecord } from "./lead-work-model";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { canClaimSharedRealtor } from "./realtor-claim-model";
import { readRealtorClaimPolicy } from "./realtor-claim-queue";
import type { WorkspaceStaff } from "./staff-store";
import { leadWorkRecord, type SqlValue, type Store } from "./store";

type LeadCursor = NonNullable<LeadInboxPage["next"]>;
type LeadRow = Omit<InboxLeadSummary, "outreachSuppressed" | "followUp"> & InboxLeadSummary["followUp"] & {
  email: string; phone: string; contactId: string | null; campaignOptedOut: number;
};
const pageSize = 25;
const scanSize = 100;
const firstContactWhere = `lead.heldAt IS NULL AND follow.firstContactAt IS NULL AND follow.replyReceivedAt IS NULL
  AND coalesce(member.lastOutcome, '') <> 'Opted out'`;
const overdueWhere = `${firstContactWhere} AND julianday(lead.dueAt) <= julianday(?)`;
const tables = `FROM referral_leads lead LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
  LEFT JOIN call_campaign_members member ON member.leadId = lead.id`;

export function inboxLeadScope(staff: WorkspaceStaff | null) {
  const email = staff?.brokerage.role === "LO" ? staff.email : undefined;
  return { where: email ? "lead.resolvedAt IS NULL AND (lead.officerEmail = ? OR (lead.officerEmail IS NULL AND lead.realtorId IS NULL))" :
    "lead.resolvedAt IS NULL", args: email ? [email] : [] };
}

function readInboxBatch(db: Store, where: string, args: SqlValue[], after: LeadCursor | undefined, limit: number) {
  return db.prepare(`SELECT lead.id, lead.name, lead.officer, lead.officerEmail, lead.purpose, lead.zip, lead.propertyState, lead.dueAt, lead.heldAt, lead.revisitDate,
    contact.name AS realtorName, coalesce(lead.importSource, CASE WHEN lead.realtorId IS NULL THEN 'Website quote request' ELSE 'Realtor referral' END) AS source,
    lead.email, lead.phone, lead.importedContactId AS contactId, coalesce(member.lastOutcome = 'Opted out', 0) AS campaignOptedOut,
    follow.firstContactAt, follow.replyReceivedAt
    ${tables} LEFT JOIN contacts contact ON contact.id = lead.realtorId
    WHERE ${where} ${after ? "AND (lead.dueAt, lead.id) > (?, ?)" : ""}
    ORDER BY lead.dueAt, lead.id LIMIT ?`).all(...args, ...(after ? [after.dueAt, after.id] : []), limit) as unknown as LeadRow[];
}

function summaries(db: Store, rows: LeadRow[]): InboxLeadSummary[] {
  const suppression = blockedOutreachKeys(db, rows.map((row) => ({ ...row, leadId: row.id })));
  return rows.map(({ email, phone, contactId, campaignOptedOut, firstContactAt, replyReceivedAt, ...lead }) => ({
    ...lead, followUp: { firstContactAt, replyReceivedAt },
    outreachSuppressed: Boolean(campaignOptedOut) || outreachSuppressed(suppression, { email, phone, contactId, leadId: lead.id }),
  }));
}

function countEligibleLeads(db: Store, where: string, args: SqlValue[], limit = -1) {
  if (!db.prepare("SELECT 1 FROM outreach_opt_outs LIMIT 1").get()) {
    const query = limit < 0 ? `SELECT count(*) AS total ${tables} WHERE ${where}` :
      `SELECT count(*) AS total FROM (SELECT 1 ${tables} WHERE ${where} LIMIT ?)`;
    return Number(db.prepare(query).get(...args, ...(limit < 0 ? [] : [limit]))?.total);
  }
  let count = 0;
  let after: LeadCursor | undefined;
  do {
    const batch = readInboxBatch(db, where, args, after, scanSize);
    count += summaries(db, batch).filter((lead) => !lead.outreachSuppressed).length;
    after = batch.length === scanSize ? batch.at(-1) : undefined;
  } while (after && (limit < 0 || count < limit));
  return limit < 0 ? count : Math.min(count, limit);
}

function firstContactScope(staff: WorkspaceStaff | null) {
  return staff?.brokerage.role === "LO" ? { where: `${firstContactWhere} AND lead.officerEmail = ?`, args: [staff.email] } :
    { where: firstContactWhere, args: [] };
}

export function countLeadAttention(db: Store, staff: WorkspaceStaff, limit: number) {
  const scope = firstContactScope(staff);
  return countEligibleLeads(db, `lead.resolvedAt IS NULL AND ${scope.where}`, scope.args, limit);
}

export function readLeadInbox(db: Store, input: unknown, staff: WorkspaceStaff | null, now = new Date()):
  LeadInboxPage | ({ kind: "open" } & LeadWorkRecord) | { error: string } {
  const parsed = leadInboxRequest.safeParse(input);
  if (!parsed.success || staff?.brokerage.role === "Processor") return { error: leadInboxUnavailable };
  const scope = inboxLeadScope(staff);
  if (parsed.data.type === "open") {
    const { id } = parsed.data;
    const allowed = db.prepare(`SELECT 1 FROM referral_leads lead WHERE ${scope.where} AND lead.id = ?`).get(...scope.args, id);
    const record = allowed && leadWorkRecord(db, id, staff?.brokerage.role === "LO" ? staff.email : undefined);
    return record ? { kind: "open", ...record } : { error: leadWorkUnavailable };
  }

  const { view, after } = parsed.data;
  const clock = now.toISOString();
  const admin = !staff || staff.brokerage.role === "Admin";
  const policy = readRealtorClaimPolicy(db);
  const metadata = { overdue: after ? null : countEligibleLeads(db, `${scope.where} AND ${overdueWhere}`, [...scope.args, clock]),
    routing: admin ? leadRouting(db) : null, claimPolicy: staff && admin ? policy : undefined, canClaimRealtor: canClaimSharedRealtor(staff, policy) };
  if (view === "Archived" || view === "Shared realtor referrals") return { kind: "list", leads: [], next: null, ...metadata };
  const attention = firstContactScope(staff);
  const extra = {
    "All open": "1", Mine: "lead.officerEmail = ?", Unassigned: "lead.officerEmail IS NULL",
    [leadAttentionView]: attention.where,
    "First contact overdue": overdueWhere, "Mock step due": `lead.heldAt IS NULL AND member.leadId IS NULL
      AND follow.status = 'Active' AND julianday(follow.nextAt) <= julianday(?)`,
    "On hold": "lead.heldAt IS NOT NULL", "Opted out": "1",
  }[view];
  const where = `${scope.where} AND (${extra})`;
  const args = [...scope.args, ...(view === leadAttentionView ? attention.args : view === "Mine" ? [staff?.email ?? null] :
    view === "First contact overdue" || view === "Mock step due" ? [clock] : [])];
  const filter = view === "Opted out" ? true : view === leadAttentionView || view === "First contact overdue" || view === "Mock step due" ? false : null;
  const leads: InboxLeadSummary[] = [];
  let cursor = after;
  const limit = filter === null ? pageSize + 1 : scanSize;
  do {
    const batch = readInboxBatch(db, where, args, cursor, limit);
    for (const lead of summaries(db, batch)) {
      if (filter === null || filter === lead.outreachSuppressed) leads.push(lead);
      if (leads.length > pageSize) break;
    }
    cursor = batch.length === limit ? batch.at(-1) : undefined;
  } while (cursor && leads.length <= pageSize);
  const last = leads[pageSize - 1];
  return { kind: "list", leads: leads.slice(0, pageSize), next: leads.length > pageSize ? { id: last.id, dueAt: last.dueAt } : null, ...metadata };
}

import { easternDate } from "./client-retention";
import { mockCampaignFollowUpPrefix } from "./call-campaign-model";
import { stopAutomaticCampaignRetriesForReply } from "./campaign-follow-up-runs";
import { conversationInput, conversationQuery, conversationsUnavailable,
  type ConversationCallback, type ConversationChange, type ConversationCursor, type ConversationDetail, type ConversationEvent, type ConversationQuery, type ConversationReplyPage, type ConversationResult,
  type ConversationRow, type ConversationSubject } from "./conversation-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { accessEvent } from "./workspace-access";

const pageSize = 20;
export const currentConversationContact = "thread.contactId = CASE thread.audience WHEN 'Borrower' THEN loan.contactId ELSE loan.partnerId END";
const ownerEmail = "CASE thread.ownerRole WHEN 'Processor' THEN processing.processorEmail ELSE loan.officerEmail END";
const ownerName = "CASE thread.ownerRole WHEN 'Processor' THEN processing.processorName ELSE loan.officer END";
const loanAccessJoins = "JOIN contacts borrower ON borrower.id = loan.contactId LEFT JOIN loan_processing processing ON processing.loanId = loan.id";
const loanScope = (staff: WorkspaceStaff) => staff.brokerage.role === "Admin" ? { sql: "", params: [] } :
  { sql: `AND ${staff.brokerage.role === "Processor" ? "processing.processorEmail" : "loan.officerEmail"} = ?`, params: [staff.email] };
export function relationshipConversationAccess(role: WorkspaceStaff["brokerage"]["role"], owner: string, actor: string) {
  return role === "Admin" ? "1" : role === "LO" ? `${owner} = ${actor}` : "0";
}
const relationshipScope = (staff: WorkspaceStaff, owner: string) => ({
  sql: `AND ${relationshipConversationAccess(staff.brokerage.role, owner, "?")}`,
  params: staff.brokerage.role === "LO" ? [staff.email] : [],
});
const leadScope = (staff: WorkspaceStaff) => relationshipScope(staff, "lead.officerEmail");
const threadSource = `FROM loan_conversations thread JOIN loans loan ON loan.id = thread.loanId ${loanAccessJoins}
  JOIN contacts recipient ON recipient.id = thread.contactId WHERE ${currentConversationContact}`;
const leadSource = "FROM lead_conversations thread JOIN referral_leads lead ON lead.id = thread.leadId WHERE lead.resolvedAt IS NULL";
const contactSource = "FROM contact_conversations thread JOIN contacts recipient ON recipient.id = thread.contactId WHERE 1";
const contactScope = (staff: WorkspaceStaff) => relationshipScope(staff, "thread.ownerEmail");
const contactAudience = "CASE recipient.role WHEN 'Realtor' THEN 'Realtor' ELSE 'Borrower' END";
const missedCallColumn = (events: string) => `CASE WHEN thread.status = 'Needs reply' THEN (
  SELECT event.channel = 'Call' AND event.origin = 'Simulated' FROM ${events} event
  WHERE event.conversationId = thread.id AND event.kind = 'Inbound' ORDER BY event.at DESC, event.id DESC LIMIT 1
) END AS pendingMissedCall`;
const sharedColumns = "thread.id, thread.status, thread.unread, thread.dueOn, thread.updatedAt, thread.revision";
const threadColumns = `${sharedColumns}, ${missedCallColumn("conversation_events")}, thread.loanId, thread.contactId, thread.audience, thread.ownerRole, NULL AS leadId, thread.sourceLeadId,
  recipient.name, borrower.name AS loanName, recipient.email, recipient.phone, recipient.id AS outreachContactId,
  (thread.sourceLeadId IS NOT NULL AND loan.disposition <> 'Active') AS onHold, 0 AS campaignOptedOut,
  CASE thread.ownerRole WHEN 'Processor' THEN coalesce(nullif(processing.processorName, ''), 'Unassigned processor')
    ELSE coalesce(nullif(loan.officer, ''), 'Unassigned loan officer') END AS owner`;
const leadColumns = `${sharedColumns}, ${missedCallColumn("lead_conversation_events")}, NULL AS loanId, NULL AS contactId, 'Borrower' AS audience, 'Loan officer' AS ownerRole,
  lead.id AS leadId, NULL AS sourceLeadId, lead.name, lead.name AS loanName, lead.email, lead.phone, lead.importedContactId AS outreachContactId,
  lead.heldAt IS NOT NULL AS onHold, EXISTS(SELECT 1 FROM call_campaign_members member WHERE member.leadId = lead.id AND member.lastOutcome = 'Opted out') AS campaignOptedOut,
  coalesce(nullif(lead.officer, ''), 'Unassigned loan officer') AS owner`;
const contactColumns = `${sharedColumns}, ${missedCallColumn("contact_conversation_events")}, NULL AS loanId, recipient.id AS contactId, ${contactAudience} AS audience, 'Loan officer' AS ownerRole,
  NULL AS leadId, NULL AS sourceLeadId, recipient.name, recipient.name AS loanName, recipient.email, recipient.phone,
  recipient.id AS outreachContactId, 0 AS onHold, 0 AS campaignOptedOut, thread.ownerName AS owner`;

const loanStorage = { table: "loan_conversations", events: "conversation_events" };
const leadStorage = { table: "lead_conversations", events: "lead_conversation_events" };
const contactStorage = { table: "contact_conversations", events: "contact_conversation_events" };
const storage = (row: ThreadRow) => row.loanId ? loanStorage : row.leadId ? leadStorage : contactStorage;

type ThreadRow = Omit<ConversationRow, "unread" | "outreachBlocked" | "held"> & {
  unread: number; onHold: number; campaignOptedOut: number; sourceLeadId: string | null; outreachContactId: string | null;
  pendingMissedCall: number | null; email: string; phone: string;
};
type Thread = ThreadRow & {
  unread: number; ownerEmail: string | null; officerEmail: string | null; processorEmail: string | null; officer: string; processorName: string | null;
};

function getLoanThread(db: Store, staff: WorkspaceStaff, clause: string, args: SqlValue[]) {
  const scope = loanScope(staff);
  return db.prepare(`SELECT ${threadColumns}, ${ownerEmail} AS ownerEmail, loan.officerEmail, loan.officer, processing.processorEmail, processing.processorName
    ${threadSource} ${scope.sql} AND ${clause}`).get(...scope.params, ...args) as unknown as Thread | undefined;
}

function getLeadThread(db: Store, staff: WorkspaceStaff, clause: string, args: SqlValue[]) {
  const scope = leadScope(staff);
  return db.prepare(`SELECT ${leadColumns}, lead.officerEmail AS ownerEmail, lead.officerEmail, lead.officer,
    NULL AS processorEmail, NULL AS processorName ${leadSource} ${scope.sql} AND ${clause}`).get(...scope.params, ...args) as unknown as Thread | undefined;
}

function getContactThread(db: Store, staff: WorkspaceStaff, clause: string, args: SqlValue[]) {
  const scope = contactScope(staff);
  return db.prepare(`SELECT ${contactColumns}, thread.ownerEmail, NULL AS officerEmail, '' AS officer,
    NULL AS processorEmail, NULL AS processorName ${contactSource} ${scope.sql} AND ${clause}`)
    .get(...scope.params, ...args) as unknown as Thread | undefined;
}

function getThread(db: Store, staff: WorkspaceStaff, id: string) {
  return getLoanThread(db, staff, "thread.id = ?", [id]) ?? getLeadThread(db, staff, "thread.id = ?", [id]) ??
    getContactThread(db, staff, "thread.id = ?", [id]);
}

function getContactParticipant(db: Store, staff: WorkspaceStaff, contactId: string) {
  const role = staff.brokerage.role;
  if (role === "Processor") return null;
  return db.prepare(`SELECT recipient.name, ${contactAudience} AS audience FROM contacts recipient WHERE recipient.id = ?
    ${role === "LO" ? `AND (recipient.addedBy = ? OR EXISTS (SELECT 1 FROM loans loan WHERE loan.officerEmail = ?
      AND (loan.contactId = recipient.id OR loan.partnerId = recipient.id)))
      AND NOT EXISTS (SELECT 1 FROM contact_conversations thread WHERE thread.contactId = recipient.id)` : ""}`)
    .get(contactId, ...(role === "LO" ? [staff.email, staff.email] : [])) as { name: string; audience: ConversationRow["audience"] } | undefined;
}

function getLeadParticipant(db: Store, staff: WorkspaceStaff, leadId: string) {
  const scope = leadScope(staff);
  return db.prepare(`SELECT lead.name, lead.officer FROM referral_leads lead WHERE lead.id = ? AND lead.resolvedAt IS NULL ${scope.sql}`)
    .get(leadId, ...scope.params);
}

function convertedLeadConversation(db: Store, staff: WorkspaceStaff, leadId: string) {
  const scope = loanScope(staff);
  const loan = db.prepare(`SELECT loan.id, loan.contactId, loan.disposition, loan.officer, borrower.name, lead.heldAt, lead.archiveToken,
    EXISTS(SELECT 1 FROM applications WHERE loanId = loan.id) AS hasApplication
    FROM referral_leads lead JOIN loans loan ON loan.id = lead.loanId ${loanAccessJoins}
    WHERE lead.id = ? AND lead.resolvedAt IS NOT NULL ${scope.sql}`).get(leadId, ...scope.params);
  if (typeof loan?.id !== "string" || typeof loan.contactId !== "string") return;
  const thread = getLoanThread(db, staff, "thread.loanId = ? AND thread.audience = 'Borrower' AND thread.contactId = ?", [loan.id, loan.contactId]);
  if (thread?.sourceLeadId === leadId) return { thread };
  // A converted loan always has a 1003. With an application in place, loan edits cannot replace its borrower.
  if (staff.brokerage.role === "Processor" || loan.disposition !== "Active" || !loan.hasApplication ||
    loan.heldAt || loan.archiveToken || thread?.sourceLeadId ||
    db.prepare("SELECT 1 FROM loan_conversations WHERE sourceLeadId = ?").get(leadId)) return;
  const subject: ConversationSubject = { loanId: loan.id, contactId: loan.contactId, audience: "Borrower" };
  return { subject, name: String(loan.name), owner: String(loan.officer || "Unassigned") };
}

// Conversion owns the transaction. Keep the thread ID, event IDs, due date and read state.
export function carryLeadConversation(db: Store, leadId: string, loanId: string, contactId: string, at: string) {
  const saved = db.prepare(`INSERT INTO loan_conversations (id, loanId, contactId, audience, ownerRole, status, unread, dueOn, updatedAt, revision, sourceLeadId)
    SELECT id, ?, ?, 'Borrower', 'Loan officer', status, unread, dueOn, ?, revision + 1, leadId FROM lead_conversations WHERE leadId = ? RETURNING id`)
    .get(loanId, contactId, at, leadId);
  if (!saved) return;
  db.prepare("INSERT INTO conversation_events SELECT * FROM lead_conversation_events WHERE conversationId = ?").run(saved.id);
  db.prepare("UPDATE inbound_replies SET conversationId = ?, leadConversationId = NULL WHERE leadConversationId = ?").run(saved.id, saved.id);
  db.prepare("DELETE FROM lead_conversations WHERE id = ?").run(saved.id);
}

function getParticipant(db: Store, staff: WorkspaceStaff, subject: ConversationSubject) {
  const scope = loanScope(staff);
  return db.prepare(`SELECT recipient.name, borrower.name AS loanName, loan.officer, loan.officerEmail, processing.processorEmail, processing.processorName
    FROM loans loan ${loanAccessJoins} JOIN contacts recipient ON recipient.id = CASE ? WHEN 'Borrower' THEN loan.contactId ELSE loan.partnerId END
    WHERE loan.id = ? AND recipient.id = ? ${scope.sql}`).get(subject.audience, subject.loanId, subject.contactId, ...scope.params);
}

function ensureConversation(db: Store, staff: WorkspaceStaff, subject: ConversationSubject, at: string, sourceLeadId: string | null = null) {
  const person = getParticipant(db, staff, subject);
  if (!person) return null;
  const { loanId, audience, contactId } = subject;
  const existing = db.prepare("SELECT id, sourceLeadId FROM loan_conversations WHERE loanId = ? AND audience = ? AND contactId = ?").get(loanId, audience, contactId);
  if (typeof existing?.id === "string") {
    if (sourceLeadId && existing.sourceLeadId === null) {
      db.prepare("UPDATE loan_conversations SET sourceLeadId = ?, revision = revision + 1 WHERE id = ? AND sourceLeadId IS NULL")
        .run(sourceLeadId, existing.id);
    }
    return existing.id;
  }
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO loan_conversations (id, loanId, audience, contactId, ownerRole, updatedAt, sourceLeadId) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, loanId, audience, contactId, person.processorEmail && !person.officerEmail ? "Processor" : "Loan officer", at, sourceLeadId);
  return id;
}

function ensureLeadConversation(db: Store, staff: WorkspaceStaff, leadId: string, at: string) {
  if (!getLeadParticipant(db, staff, leadId)) return null;
  const existing = db.prepare("SELECT id FROM lead_conversations WHERE leadId = ?").get(leadId)?.id;
  if (typeof existing === "string") return existing;
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO lead_conversations (id, leadId, updatedAt) VALUES (?, ?, ?)").run(id, leadId, at);
  return id;
}

function ensureContactConversation(db: Store, staff: WorkspaceStaff, contactId: string, at: string) {
  const existing = getContactThread(db, staff, "thread.contactId = ?", [contactId]);
  if (existing) return existing.id;
  if (!getContactParticipant(db, staff, contactId)) return null;
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO contact_conversations (id, contactId, ownerEmail, ownerName, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run(id, contactId, staff.email, staff.name, at);
  return id;
}

// Inbound review owns the transaction that links the receipt and appends this entry.
export function appendReviewedReply(db: Store, staff: WorkspaceStaff, subject: ConversationSubject | { leadId: string } | { contactId: string },
  reply: { id: string; channel: NonNullable<ConversationEvent["channel"]>; text: string; at: string }, now: string) {
  const leadId = "leadId" in subject ? subject.leadId : null;
  const id = "leadId" in subject ? ensureLeadConversation(db, staff, subject.leadId, now) :
    "loanId" in subject ? ensureConversation(db, staff, subject, now) : ensureContactConversation(db, staff, subject.contactId, now);
  if (!id) return null;
  const { table, events } = "loanId" in subject ? loanStorage : leadId ? leadStorage : contactStorage;
  const historyLeadId = "loanId" in subject ? db.prepare("SELECT sourceLeadId FROM loan_conversations WHERE id = ?").get(id)?.sourceLeadId : leadId;
  const newerDecision = db.prepare(`SELECT 1 FROM ${events} WHERE conversationId = ? AND at >= ?
    AND (kind IN ('Inbound', 'Outbound') OR (kind = 'State' AND json_extract(request, '$.type') = 'resolve')) LIMIT 1`).get(id, reply.at) ||
    (historyLeadId && db.prepare("SELECT 1 FROM lead_events WHERE leadId = ? AND at >= ? AND kind IN ('Call','Email','Text') LIMIT 1").get(historyLeadId, reply.at));
  if (newerDecision) {
    db.prepare(`UPDATE ${table} SET updatedAt = ?, revision = revision + 1 WHERE id = ?`).run(now, id);
  } else {
    db.prepare(`UPDATE ${table} SET status = 'Needs reply', unread = 1,
      dueOn = CASE WHEN updatedAt >= ? THEN dueOn ELSE NULL END, updatedAt = ?, revision = revision + 1 WHERE id = ?`)
      .run(reply.at, now, id);
  }
  db.prepare(`INSERT INTO ${events} (id, conversationId, kind, channel, origin, text, actor, actorEmail, at, request)
    VALUES (?, ?, 'Inbound', ?, 'Simulated', ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), id, reply.channel, reply.text, staff.name, staff.email, reply.at, JSON.stringify({ type: "reviewedReply", receiptId: reply.id }));
  if (leadId && reply.channel !== "Call") stopLeadOutreachForReply(db, leadId, reply.at, now);
  return id;
}

function stopLeadOutreachForReply(db: Store, leadId: string, receivedAt: string, now: string) {
  db.prepare(`INSERT INTO lead_follow_up (leadId, status, revision, replyReceivedAt) VALUES (?, 'Stopped', 1, ?)
    ON CONFLICT(leadId) DO UPDATE SET replyReceivedAt = excluded.replyReceivedAt,
    status = CASE WHEN status = 'Completed' THEN status ELSE 'Stopped' END, nextAt = NULL, pausedAt = NULL, revision = revision + 1
    WHERE lead_follow_up.replyReceivedAt IS NULL OR lead_follow_up.replyReceivedAt > excluded.replyReceivedAt`).run(leadId, receivedAt);
  stopAutomaticCampaignRetriesForReply(db, leadId, now);
}

function identity(row: ThreadRow) {
  return { leadId: row.leadId ?? row.sourceLeadId, contactId: row.outreachContactId, email: row.email, phone: row.phone };
}

const prospecting = (row: ThreadRow) => row.leadId || row.sourceLeadId || (storage(row) === contactStorage && row.audience === "Borrower");

function publicRow(row: ThreadRow, blocked: Set<string>, campaignCallback?: ConversationCallback): ConversationRow {
  const { id, loanId, leadId, contactId, audience, name, loanName, ownerRole, owner, status, unread, dueOn, updatedAt, revision } = row;
  return { id, loanId, leadId, contactId, audience, name, loanName, ownerRole, owner, status, unread: Boolean(unread), dueOn, updatedAt, revision,
    held: Boolean(row.onHold), outreachBlocked: Boolean(row.campaignOptedOut || (prospecting(row) && outreachSuppressed(blocked, identity(row)))),
    ...(row.pendingMissedCall ? { missedCall: true as const } : {}),
    ...(campaignCallback ? { campaignCallback } : {}) };
}

function campaignCallbacks(db: Store, threads: ThreadRow[]) {
  const origins = threads.flatMap(({ id, leadId, sourceLeadId, loanId }) => leadId || (sourceLeadId && loanId) ?
    [{ id, leadId: leadId ?? sourceLeadId, loanId }] : []);
  const rows = origins.length ? db.prepare(`WITH matched AS (
    SELECT json_extract(selected.value, '$.id') AS id, member.leadId,
      json_extract(selected.value, '$.loanId') AS loanId, member.callbackTaskId
    FROM json_each(?) selected JOIN call_campaign_members member ON member.leadId = json_extract(selected.value, '$.leadId')
    WHERE member.lastOutcome = 'Requested callback'
  ) SELECT matched.id, matched.leadId, NULL AS loanId, task.id AS taskId, task.dueAt
    FROM matched JOIN lead_import_tasks task ON task.id = matched.callbackTaskId AND task.leadId = matched.leadId
    WHERE matched.loanId IS NULL AND task.completedAt IS NULL
    UNION ALL
    SELECT matched.id, NULL, matched.loanId, task.id, task.dueAt
    FROM matched JOIN referral_leads lead ON lead.id = matched.leadId AND lead.loanId = matched.loanId
    JOIN tasks task ON task.id = matched.callbackTaskId AND task.loanId = matched.loanId
    WHERE task.completedAt IS NULL`)
    .all(JSON.stringify(origins)) as unknown as { id: string; leadId: string; loanId: string | null; taskId: string; dueAt: string }[] : [];
  return new Map<string, ConversationCallback>(rows.map(({ id, leadId, loanId, taskId, dueAt }) =>
    [id, loanId ? { loanId, taskId, dueAt } : { leadId, taskId, dueAt }]));
}

function detail(db: Store, row: Thread, staff: WorkspaceStaff): ConversationDetail {
  const { ownerEmail, officerEmail, processorEmail, officer, processorName, ...thread } = row;
  const ownerOptions: ConversationDetail["ownerOptions"] = [];
  if (officerEmail) ownerOptions.push({ role: "Loan officer", name: officer || "Assigned loan officer" });
  if (processorEmail) ownerOptions.push({ role: "Processor", name: processorName || "Assigned processor" });
  const admin = staff.brokerage.role === "Admin";
  const blocked = prospecting(thread) ? blockedOutreachKeys(db, [identity(thread)]) : new Set<string>();
  const campaignCallback = staff.brokerage.role !== "Processor" ? campaignCallbacks(db, [thread]).get(thread.id) : undefined;
  return { ...publicRow(thread, blocked, campaignCallback), canManage: admin || ownerEmail === staff.email, ownerOptions,
    ...(campaignCallback ? { canOpenCampaignCallback: officerEmail === staff.email } : {}),
    ...(admin && storage(thread) === contactStorage && ownerEmail ? { contactOwnerEmail: ownerEmail } : {}) };
}

const filters = {
  Active: "thread.status <> 'Closed'",
  Unread: "thread.unread = 1",
  "Needs reply": "thread.status = 'Needs reply'",
  "Waiting on contact": "thread.status = 'Waiting on contact'",
  "Follow-up due": "thread.status <> 'Closed' AND thread.dueOn IS NOT NULL AND thread.dueOn <= ?",
  Closed: "thread.status = 'Closed'",
} as const;

function list(db: Store, staff: WorkspaceStaff, query: Extract<ConversationQuery, { type: "list" }>, now: Date,
  { limit = pageSize, localName, processing = false, callbacks = false }:
    { limit?: number; localName?: string; processing?: boolean; callbacks?: boolean } = {}) {
  const { filter, mine, after } = query;
  const due = filter === "Follow-up due";
  const scanSize = due ? limit * 3 : limit;
  const order = due ? "thread.dueOn, thread.id" : "thread.updatedAt DESC, thread.id DESC";
  const cursor = due ? "(thread.dueOn, thread.id) > (?, ?)" : "(thread.updatedAt, thread.id) < (?, ?)";
  const args = [...(due ? [easternDate(now)] : []), ...(mine ? [staff.email, ...(localName ? [localName] : [])] : []),
    ...(after ? [due ? after.at.slice(0, 10) : after.at, after.id] : []), scanSize + 1];
  function select(columns: string, source: string, scope: ReturnType<typeof loanScope>, email: string, name: string) {
    const owner = localName ? `((${email}) = ? OR ((${email}) IS NULL AND (${name}) = ?))` : `(${email}) = ?`;
    return db.prepare(`SELECT ${columns} ${source} ${scope.sql} AND ${filters[filter]}
      ${mine ? `AND ${owner}` : ""} ${after ? `AND ${cursor}` : ""} ORDER BY ${order} LIMIT ?`)
      .all(...scope.params, ...args) as unknown as ThreadRow[];
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const loanSource = processing ? `${threadSource} AND thread.ownerRole = 'Processor'` : threadSource;
  const rows = select(threadColumns, loanSource, loanScope(staff), ownerEmail, ownerName);
  if (!processing) {
    rows.push(...select(leadColumns, leadSource, leadScope(staff), "lead.officerEmail", "lead.officer"),
      ...select(contactColumns, contactSource, contactScope(staff), "thread.ownerEmail", "thread.ownerName"));
    rows.sort((a, b) => due ? compare(a.dueOn!, b.dueOn!) || compare(a.id, b.id) : compare(b.updatedAt, a.updatedAt) || compare(b.id, a.id));
  }
  const scan = rows.slice(0, scanSize);
  const blocked = blockedOutreachKeys(db, scan.filter(prospecting).map(identity));
  const promises = callbacks ? campaignCallbacks(db, scan) : undefined;
  const page: ConversationRow[] = [];
  let consumed = 0;
  for (const row of scan) {
    consumed++;
    const item = publicRow(row, blocked, promises?.get(row.id));
    if (due && (item.outreachBlocked || item.held)) continue;
    page.push(item);
    if (page.length === limit) break;
  }
  const last = scan[consumed - 1];
  return { kind: "list" as const, checkedAt: now.toISOString(), rows: page,
    next: rows.length > consumed && last ? { id: last.id, at: due ? `${last.dueOn}T00:00:00.000Z` : last.updatedAt } : null };
}

export function readOwnedConversationReplies(db: Store, staff: WorkspaceStaff, after: ConversationCursor | undefined, now: Date, localName?: string,
  limit?: number): ConversationReplyPage {
  const { rows, next } = list(db, staff, { type: "list", filter: "Needs reply", mine: true, after }, now,
    { limit: limit ?? 5, localName, callbacks: limit === undefined });
  return { items: rows, next };
}

export function readProcessingConversationReplies(db: Store, staff: WorkspaceStaff, after: ConversationCursor | undefined, now: Date): ConversationReplyPage {
  const { rows, next } = list(db, staff, { type: "list", filter: "Needs reply", mine: false, after }, now, { limit: 5, processing: true });
  return { items: rows, next };
}

export function readConversations(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date(), localName?: string): ConversationResult {
  if (!staff || staff.brokerage.id !== brokerageId) return { error: conversationsUnavailable };
  const parsed = conversationQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid conversation or queue filter." };
  const query = parsed.data;
  if (query.type === "list") return list(db, staff, query, now);
  if (query.type === "myReplies") return staff.brokerage.role === "Processor" ? { error: conversationsUnavailable } :
    { kind: "replies", checkedAt: now.toISOString(), page: readOwnedConversationReplies(db, staff, undefined, now, localName) };
  const converted = query.type === "lead" ? convertedLeadConversation(db, staff, query.leadId) : undefined;
  const row = query.type === "thread" ? getThread(db, staff, query.id) :
    query.type === "lead" ? getLeadThread(db, staff, "thread.leadId = ?", [query.leadId]) ?? converted?.thread :
    query.type === "contact" ? getContactThread(db, staff, "thread.contactId = ?", [query.contactId]) :
      getLoanThread(db, staff, "thread.loanId = ? AND thread.audience = ? AND thread.contactId = ?", [query.loanId, query.audience, query.contactId]);
  if (!row) {
    if (query.type === "thread") return { error: conversationsUnavailable };
    if (query.type === "lead") {
      const lead = getLeadParticipant(db, staff, query.leadId);
      if (converted?.subject) return { kind: "new", subject: { leadId: query.leadId }, name: converted.name,
        loanName: converted.name, owner: converted.owner, convertedLoan: true };
      return lead ? { kind: "new", subject: { leadId: query.leadId }, name: String(lead.name), loanName: String(lead.name),
        owner: String(lead.officer || "Unassigned") } : { error: conversationsUnavailable };
    }
    if (query.type === "contact") {
      const contact = getContactParticipant(db, staff, query.contactId);
      return contact ? { kind: "new", subject: { contactId: query.contactId, audience: contact.audience }, name: contact.name,
        loanName: contact.name, owner: staff.name } : { error: conversationsUnavailable };
    }
    const person = getParticipant(db, staff, query);
    if (!person) return { error: conversationsUnavailable };
    const { loanId, audience, contactId } = query;
    return { kind: "new", subject: { loanId, audience, contactId }, name: String(person.name), loanName: String(person.loanName),
      owner: String(person.officer || person.processorName || "Unassigned") };
  }
  const after = query.type === "thread" ? query.after : undefined;
  const leadId = row.leadId ?? row.sourceLeadId;
  const { events: eventsTable } = storage(row);
  const rows = db.prepare(`SELECT * FROM (SELECT id, kind, channel, origin, text, actor, at FROM ${eventsTable} WHERE conversationId = ?
    ${leadId ? `UNION ALL SELECT id, CASE WHEN outcome = 'Reply received' THEN 'Inbound' ELSE 'Outbound' END AS kind,
      CASE WHEN kind = 'Campaign' THEN CASE WHEN text LIKE '${mockCampaignFollowUpPrefix} · Email%' THEN 'Email' ELSE 'Text' END ELSE kind END AS channel,
      CASE WHEN kind = 'Campaign' THEN 'Simulated' ELSE 'Lead log' END AS origin, text, actor, at
      FROM lead_events WHERE leadId = ? AND (kind IN ('Call','Email','Text') OR
        (kind = 'Campaign' AND text LIKE '${mockCampaignFollowUpPrefix} · %'))` : ""})
    ${after ? "WHERE (at, id) < (?, ?)" : ""} ORDER BY at DESC, id DESC LIMIT ?`)
    .all(row.id, ...(leadId ? [leadId] : []), ...(after ? [after.at, after.id] : []), pageSize + 1) as unknown as ConversationEvent[];
  const events = rows.slice(0, pageSize).map((event) => ({ ...event }));
  const last = events.at(-1);
  return { kind: "thread", thread: detail(db, row, staff), events, next: rows.length > pageSize && last ? { id: last.id, at: last.at } : null };
}

export function changeConversation(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date(),
  replacement?: StaffIdentity | null): ConversationChange {
  if (!staff || staff.brokerage.id !== brokerageId) return { error: conversationsUnavailable };
  const parsed = conversationInput.safeParse(input);
  if (!parsed.success) return { error: "Check the conversation details and try again." };
  const data = parsed.data;
  const at = now.toISOString();
  return db.transaction(() => {
    function openedConversation(id: string | null, message: string): ConversationChange {
      if (!id) return { error: conversationsUnavailable };
      const opened = readConversations(db, { type: "thread", id }, staff, brokerageId, now);
      return "kind" in opened && opened.kind === "thread" ? { id, message, opened } : { error: conversationsUnavailable };
    }
    if (data.type === "start") {
      return openedConversation(ensureConversation(db, staff, data, at), "Conversation opened.");
    }
    if (data.type === "startLead") {
      const id = ensureLeadConversation(db, staff, data.leadId, at);
      if (id) return openedConversation(id, "Lead conversation opened.");
      const converted = convertedLeadConversation(db, staff, data.leadId);
      const carriedId = converted?.thread?.id ?? (converted?.subject ? ensureConversation(db, staff, converted.subject, at, data.leadId) : null);
      return openedConversation(carriedId, "Borrower conversation opened on the loan.");
    }
    if (data.type === "startContact") {
      return openedConversation(ensureContactConversation(db, staff, data.contactId, at), "Contact conversation opened.");
    }
    const row = getThread(db, staff, data.id);
    if (!row) return { error: conversationsUnavailable };
    const request = JSON.stringify(data);
    const prior = db.prepare(`SELECT conversationId, actorEmail, request FROM conversation_events WHERE id = ?
      UNION ALL SELECT conversationId, actorEmail, request FROM lead_conversation_events WHERE id = ?
      UNION ALL SELECT conversationId, actorEmail, request FROM contact_conversation_events WHERE id = ?`)
      .get(data.eventId, data.eventId, data.eventId);
    const replyLeadId = data.type === "message" && data.direction === "Inbound" ? row.leadId : null;
    const success = { id: data.id, message: replyLeadId ? "Reply logged. Automatic outreach is stopped for this lead." : "Conversation updated." };
    if (prior) return prior.conversationId === row.id && prior.actorEmail === staff.email && prior.request === request ? success :
      { error: "This action ID has already been used. Refresh the conversation." };
    const { canManage, ownerOptions, outreachBlocked, held } = detail(db, row, staff);
    if (!canManage) return { error: "Only the conversation owner or a brokerage admin can update this conversation." };
    if (row.revision !== data.revision) return { error: "This conversation changed. Refresh before saving." };
    let { status, unread, dueOn, ownerRole } = row;
    let kind: ConversationEvent["kind"] = "State";
    let channel: ConversationEvent["channel"] = null;
    let origin: ConversationEvent["origin"] = "Internal";
    let text: string;
    switch (data.type) {
      case "message":
      case "sampleReply":
        if (data.type === "message" && data.direction === "Outbound") {
          if (outreachBlocked || held) return { error: "Outreach is unavailable for this conversation." };
          if (row.leadId) return { error: "Log outbound activity from the linked lead or its call campaign." };
        }
        kind = data.type === "message" ? data.direction : "Inbound";
        channel = data.type === "message" ? data.channel : "Email";
        origin = data.type === "message" ? "Manual log" : "Simulated";
        text = data.type === "message" ? data.text : row.leadId ? "Thanks for reaching out. When can we talk about my options?" :
          "Thanks for the update. What should I do next?";
        status = kind === "Inbound" ? "Needs reply" : "Waiting on contact";
        unread = Number(kind === "Inbound");
        dueOn = null;
        break;
      case "note":
        kind = "Note";
        text = data.text;
        break;
      case "read":
        unread = 0;
        text = "Marked as read.";
        break;
      case "followUp":
        if (status === "Closed") return { error: "Reopen the conversation before scheduling follow-up." };
        if (data.dueOn && (outreachBlocked || held)) return { error: "Follow-up is unavailable while outreach is blocked or the record is on hold." };
        if (data.dueOn && data.dueOn < easternDate(now)) return { error: "Choose today or a future follow-up date." };
        dueOn = data.dueOn;
        text = dueOn ? `Follow-up scheduled for ${dueOn}.` : "Follow-up cleared.";
        break;
      case "assign": {
        if (!row.loanId) return { error: "This conversation is assigned outside the loan workflow." };
        const owner = ownerOptions.find(({ role }) => role === data.ownerRole);
        if (!owner) return { error: "That role has no staff member assigned to this loan." };
        ownerRole = owner.role;
        text = `Handed to ${owner.name}.`;
        break;
      }
      case "assignContact":
        if (storage(row) !== contactStorage || staff.brokerage.role !== "Admin" || replacement?.email !== data.email) {
          return { error: "A brokerage admin can assign a contact conversation to an active loan officer or admin." };
        }
        db.prepare("UPDATE contact_conversations SET ownerEmail = ?, ownerName = ? WHERE id = ?").run(replacement.email, replacement.name, row.id);
        if (row.ownerEmail !== replacement.email) {
          accessEvent(db, staff, "Reassigned contact conversation", `${row.id} · ${row.ownerEmail} → ${replacement.email}`, at);
        }
        text = `Assigned to ${replacement.name}.`;
        break;
      case "resolve":
        status = data.closed ? "Closed" : "Open";
        dueOn = null;
        unread = 0;
        text = data.closed ? "Conversation closed." : "Conversation reopened.";
        break;
    }
    const { table, events: eventsTable } = storage(row);
    db.prepare(`UPDATE ${table} SET status = ?, unread = ?, dueOn = ?, ${row.loanId ? "ownerRole = ?," : ""} updatedAt = ?, revision = revision + 1
      WHERE id = ?`).run(status, unread, dueOn, ...(row.loanId ? [ownerRole] : []), at, row.id);
    db.prepare(`INSERT INTO ${eventsTable} (id, conversationId, kind, channel, origin, text, actor, actorEmail, at, request) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(data.eventId, row.id, kind, channel, origin, text, staff.name, staff.email, at, request);
    if (replyLeadId) stopLeadOutreachForReply(db, replyLeadId, at, at);
    return success;
  });
}

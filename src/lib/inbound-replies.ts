import { z } from "zod";
import { appendReviewedReply, currentConversationContact } from "./conversations";
import { inboundReplyInput, inboundReplyQuery, inboundReplyUnavailable,
  type InboundMatch, type InboundReplyChange, type InboundReplyInput, type InboundReplyQuery, type InboundReplyResult, type InboundReplyRow } from "./inbound-replies-model";
import { outreachIdentityKeys, pendingReplyMatches, prepareLeadReplyMatches } from "./outreach-preferences";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const pageSize = 20;
const permitted = (staff: WorkspaceStaff | null, brokerageId: string): staff is WorkspaceStaff =>
  staff?.brokerage.id === brokerageId && staff.brokerage.role === "Admin" && staff.brokerage.pilot === true;
const receiptColumns = "id, channel, sourceId, senderKey, at, status, replayCount, revision";
type Receipt = Omit<InboundReplyRow, "sender"> & { senderKey: string };
type SavedReply = Receipt & { text: string; conversationId: string | null; leadConversationId: string | null; contactConversationId: string | null };
type MatchRow = { kind: InboundMatch["kind"]; recordId: string; contactId: string; audience: Extract<InboundMatch, { kind: "loan" }>["audience"];
  name: string; borrower: string; stage: string; purpose: string; address: string; createdAt: string; owner: string; source: string };

function display({ senderKey, ...receipt }: Receipt): InboundReplyRow {
  return { ...receipt, sender: senderKey.slice(senderKey.indexOf(":") + 1) };
}

function currentMatchPage(db: Store, key: string, after: Extract<InboundReplyQuery, { type: "reply" }>["after"]) {
  if (!db.transaction(() => prepareLeadReplyMatches(db))) return { matches: [], next: null, indexing: true };
  const pending = pendingReplyMatches(db, key);
  const cursor = after ? "leadId" in after ? ["lead", after.leadId, ""] :
    "loanId" in after ? ["loan", after.loanId, after.audience] : ["contact", after.contactId, ""] : [];
  const rows = db.prepare(`WITH matched AS (
    SELECT contactId FROM contact_outreach_keys WHERE identityKey = ?
    UNION SELECT contactId FROM realtor_reply_keys WHERE identityKey = ?
    UNION SELECT value FROM json_each(?)
  ), loansForSender AS (
    SELECT loan.id AS loanId, matched.contactId, 'Borrower' AS audience FROM matched JOIN loans loan ON loan.contactId = matched.contactId
    UNION ALL
    SELECT loan.id, matched.contactId, 'Realtor' FROM matched JOIN loans loan ON loan.partnerId = matched.contactId
  ), leadsForSender AS (
    SELECT leadId FROM lead_reply_keys WHERE identityKey = ?
    UNION SELECT lead.id FROM matched JOIN contacts contact ON contact.id = matched.contactId AND contact.role <> 'Realtor'
    JOIN referral_leads lead ON lead.importedContactId = matched.contactId WHERE lead.resolvedAt IS NULL
  ), candidates AS (
    SELECT 'lead' AS kind, lead.id AS recordId, '' AS audience, NULL AS contactId, lead.name, NULL AS borrower,
      CASE WHEN lead.heldAt IS NULL THEN 'Open' ELSE 'On hold' END AS stage, lead.purpose, NULL AS address, lead.createdAt,
      coalesce(nullif(lead.officer, ''), 'Shared inbox') AS owner,
      coalesce(lead.importSource, CASE WHEN lead.realtorId IS NULL THEN 'Website quote request' ELSE 'Realtor referral' END) AS source
    FROM leadsForSender match JOIN referral_leads lead ON lead.id = match.leadId WHERE lead.resolvedAt IS NULL
    UNION ALL
    SELECT 'loan', loan.id, match.audience, match.contactId, contact.name, borrower.name, loan.stage, loan.purpose, loan.address,
      coalesce(loan.createdAt, loan.stageSince), NULL, NULL
    FROM loansForSender match JOIN loans loan ON loan.id = match.loanId
    JOIN contacts contact ON contact.id = match.contactId JOIN contacts borrower ON borrower.id = loan.contactId
    UNION ALL
    SELECT 'contact', contact.id, '', contact.id, contact.name, NULL, contact.role, NULL, NULL, NULL, thread.ownerName, NULL
    FROM matched JOIN contacts contact ON contact.id = matched.contactId LEFT JOIN contact_conversations thread ON thread.contactId = contact.id
  ) SELECT * FROM candidates ${after ? "WHERE (kind, recordId, audience) > (?, ?, ?)" : ""} ORDER BY kind, recordId, audience LIMIT ?`)
    .all(key, key, JSON.stringify(pending), key, ...cursor, pageSize + 1) as unknown as MatchRow[];
  const matches: InboundMatch[] = rows.slice(0, pageSize).map(({ kind, recordId, name, stage, purpose, createdAt, ...row }) => {
    if (kind === "contact") return { kind, contactId: recordId, name, role: stage, owner: row.owner };
    if (kind === "lead") return { kind, leadId: recordId, name, stage, purpose, createdAt, owner: row.owner, source: row.source };
    return { kind, loanId: recordId, name, stage, purpose, createdAt, contactId: row.contactId, audience: row.audience, borrower: row.borrower, address: row.address };
  });
  const last = matches.at(-1);
  const next = rows.length > pageSize && last ? last.kind === "contact" ? { contactId: last.contactId } :
    last.kind === "lead" ? { leadId: last.leadId } : { loanId: last.loanId, audience: last.audience } : null;
  return { matches, next };
}

export function readInboundReplies(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string): InboundReplyResult {
  if (!permitted(staff, brokerageId)) return { error: inboundReplyUnavailable };
  const parsed = inboundReplyQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid reply or review filter." };
  const query = parsed.data;
  if (query.type === "list") {
    const { after } = query;
    const rows = db.prepare(`SELECT ${receiptColumns} FROM inbound_replies WHERE status = ?
      ${after ? "AND (at, id) < (?, ?)" : ""} ORDER BY at DESC, id DESC LIMIT ?`)
      .all(query.status, ...(after ? [after.at, after.id] : []), pageSize + 1) as unknown as Receipt[];
    const page = rows.slice(0, pageSize).map(display);
    const last = page.at(-1);
    return { kind: "list", rows: page, next: rows.length > pageSize && last ? { at: last.at, id: last.id } : null };
  }
  const saved = db.prepare("SELECT * FROM inbound_replies WHERE id = ?").get(query.id) as unknown as SavedReply | undefined;
  if (!saved) return { error: "This simulated reply is unavailable." };
  const conversationId = saved.conversationId && db.prepare(`SELECT thread.id FROM loan_conversations thread
    JOIN loans loan ON loan.id = thread.loanId WHERE thread.id = ? AND ${currentConversationContact}`).get(saved.conversationId)?.id;
  const leadConversationId = saved.leadConversationId && db.prepare(`SELECT thread.id FROM lead_conversations thread
    JOIN referral_leads lead ON lead.id = thread.leadId WHERE thread.id = ? AND lead.resolvedAt IS NULL`).get(saved.leadConversationId)?.id;
  const { text, id, channel, sourceId, senderKey, at, status, replayCount, revision } = saved;
  return { kind: "reply", reply: { ...display({ id, channel, sourceId, senderKey, at, status, replayCount, revision }), text,
    conversationId: typeof conversationId === "string" ? conversationId :
      typeof leadConversationId === "string" ? leadConversationId : saved.contactConversationId },
    ...(status === "Pending" ? currentMatchPage(db, saved.senderKey, query.after) : { matches: [], next: null }) };
}

function simulate(db: Store, event: Extract<InboundReplyInput, { type: "simulate" }>, now: string): InboundReplyChange {
  const { channel, sourceId, sender } = event;
  const label = channel === "Call" ? "missed call" : "reply";
  const text = channel === "Call" ? "Incoming call went unanswered." : event.text;
  if (!text) return { error: "Enter the fictional reply." };
  const [senderKey] = outreachIdentityKeys(channel === "Email" ? { email: sender } : { phone: sender });
  if (!senderKey || (channel === "Email" && !z.email().safeParse(sender).success)) {
    return { error: channel === "Email" ? "Enter a valid fictional email address." : "Enter a fictional phone number with 10 to 15 digits." };
  }
  const previous = db.prepare("SELECT id, senderKey, text FROM inbound_replies WHERE channel = ? AND sourceId = ?").get(channel, sourceId);
  if (typeof previous?.id === "string") {
    if (previous.senderKey !== senderKey || previous.text !== text) return { error: "This source ID already belongs to a different inbound event." };
    db.prepare("UPDATE inbound_replies SET replayCount = replayCount + 1 WHERE id = ?").run(previous.id);
    return { id: previous.id, message: `Duplicate replay recorded. The original ${label} was kept.` };
  }
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO inbound_replies (id, channel, sourceId, senderKey, text, at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, channel, sourceId, senderKey, text, now);
  return { id, message: `Simulated ${label} queued for review.` };
}

function leadMatchesSender(db: Store, leadId: string, key: string) {
  const lead = db.prepare(`SELECT lead.email, lead.phone, contact.email AS linkedEmail, contact.phone AS linkedPhone FROM referral_leads lead
    LEFT JOIN contacts contact ON contact.id = lead.importedContactId AND contact.role <> 'Realtor'
    WHERE lead.id = ? AND lead.resolvedAt IS NULL`).get(leadId);
  return lead && (outreachIdentityKeys(lead).includes(key) || outreachIdentityKeys({ email: lead.linkedEmail, phone: lead.linkedPhone }).includes(key));
}

function alreadyLinkedLead(db: Store, reply: SavedReply, leadId: string) {
  if (reply.leadConversationId && db.prepare(`SELECT 1 FROM lead_conversations thread JOIN referral_leads lead ON lead.id = thread.leadId
    WHERE thread.id = ? AND lead.id = ? AND lead.resolvedAt IS NULL`).get(reply.leadConversationId, leadId)) return reply.leadConversationId;
  if (reply.conversationId && db.prepare(`SELECT 1 FROM loan_conversations thread JOIN loans loan ON loan.id = thread.loanId
    WHERE thread.id = ? AND thread.sourceLeadId = ? AND ${currentConversationContact}`).get(reply.conversationId, leadId)) return reply.conversationId;
  return null;
}

export function changeInboundReply(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()): InboundReplyChange {
  if (!permitted(staff, brokerageId)) return { error: inboundReplyUnavailable };
  const parsed = inboundReplyInput.safeParse(input);
  if (!parsed.success) return { error: "Check the inbound event and try again." };
  const action = parsed.data;
  const at = now.toISOString();
  return db.transaction(() => {
    if (action.type === "simulate") return simulate(db, action, at);
    const reply = db.prepare("SELECT * FROM inbound_replies WHERE id = ?").get(action.id) as unknown as SavedReply | undefined;
    if (!reply) return { error: "This simulated reply is unavailable." };
    const label = reply.channel === "Call" ? "Missed call" : "Reply";
    const linked = (conversationId: string) => ({ id: reply.id, conversationId, message: `${label} linked to the conversation.` });
    if (action.type === "dismiss" && reply.status === "Dismissed") return { id: reply.id, message: `${label} dismissed.` };
    if (action.type === "attach" && reply.status === "Linked" && reply.conversationId && db.prepare(`SELECT 1 FROM loan_conversations thread
      JOIN loans loan ON loan.id = thread.loanId WHERE thread.id = ? AND thread.loanId = ? AND thread.audience = ? AND thread.contactId = ?
      AND ${currentConversationContact}`).get(reply.conversationId, action.loanId, action.audience, action.contactId)) return linked(reply.conversationId);
    if (action.type === "attachLead" && reply.status === "Linked") {
      const existing = alreadyLinkedLead(db, reply, action.leadId);
      if (existing) return linked(existing);
    }
    if (action.type === "attachContact" && reply.status === "Linked" && reply.contactConversationId &&
      db.prepare("SELECT 1 FROM contact_conversations WHERE id = ? AND contactId = ?")
        .get(reply.contactConversationId, action.contactId)) return linked(reply.contactConversationId);
    if (reply.status !== "Pending" || reply.revision !== action.revision) return { error: "This inbound event changed. Refresh it before continuing." };
    if (action.type === "dismiss") {
      db.prepare("UPDATE inbound_replies SET status = 'Dismissed', resolvedAt = ?, resolvedBy = ?, revision = revision + 1 WHERE id = ?")
        .run(at, staff.email, reply.id);
      return { id: reply.id, message: `${label} dismissed.` };
    }
    if (action.type === "attachLead") {
      if (!leadMatchesSender(db, action.leadId, reply.senderKey)) return { error: "The sender no longer matches that open lead. Refresh the candidates." };
      const conversationId = appendReviewedReply(db, staff, action, reply, at);
      if (!conversationId) return { error: "That lead is unavailable." };
      db.prepare("UPDATE inbound_replies SET status = 'Linked', leadConversationId = ?, resolvedAt = ?, resolvedBy = ?, revision = revision + 1 WHERE id = ?")
        .run(conversationId, at, staff.email, reply.id);
      return linked(conversationId);
    }
    if (action.type === "attachContact") {
      const contact = db.prepare("SELECT email, phone FROM contacts WHERE id = ?").get(action.contactId);
      if (!contact || !outreachIdentityKeys(contact).includes(reply.senderKey)) {
        return { error: "The sender no longer matches that contact. Refresh the candidates." };
      }
      const conversationId = appendReviewedReply(db, staff, action, reply, at);
      if (!conversationId) return { error: "That contact is unavailable." };
      db.prepare("UPDATE inbound_replies SET status = 'Linked', contactConversationId = ?, resolvedAt = ?, resolvedBy = ?, revision = revision + 1 WHERE id = ?")
        .run(conversationId, at, staff.email, reply.id);
      return linked(conversationId);
    }
    const contact = db.prepare(`SELECT contact.email, contact.phone FROM loans loan
      JOIN contacts contact ON contact.id = CASE ? WHEN 'Borrower' THEN loan.contactId ELSE loan.partnerId END
      WHERE loan.id = ? AND contact.id = ?`).get(action.audience, action.loanId, action.contactId);
    if (!contact || !outreachIdentityKeys(contact).includes(reply.senderKey)) {
      return { error: "The sender no longer matches that loan participant. Refresh the candidates." };
    }
    const conversationId = appendReviewedReply(db, staff, action, reply, at);
    if (!conversationId) return { error: "That loan participant is unavailable." };
    db.prepare("UPDATE inbound_replies SET status = 'Linked', conversationId = ?, resolvedAt = ?, resolvedBy = ?, revision = revision + 1 WHERE id = ?")
      .run(conversationId, at, staff.email, reply.id);
    return linked(conversationId);
  });
}

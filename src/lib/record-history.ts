import { z } from "zod";
import type { ConversationEvent } from "./conversation-model";
import { currentConversationContact, relationshipConversationAccess } from "./conversations";
import type { Activity, ContactActivity } from "./model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { loanAccess } from "./workspace-access";

const source = z.enum(["loan", "contact", "lead", "reschedule", "conversation"]);
const cursor = z.object({ createdAt: z.string().min(1).max(64), source, id: z.string().min(1).max(160) });
const request = z.object({ record: z.enum(["loan", "contact"]), id: z.string().min(1).max(100), before: cursor.optional() });
export type HistoryCursor = z.infer<typeof cursor>;
export type HistoryRequest = z.infer<typeof request>;
export type HistoryEvent = Pick<Activity, "id" | "createdAt" | "kind" | "text" | "outcome"> & {
  source: HistoryCursor["source"];
  targetId: string | null;
  author: string | null;
  dueAt: string | null;
  previousDueAt: string | null;
  completedAt: string | null;
  purpose: ContactActivity["purpose"] | null;
  followUpOwner: string | null;
  latestCompletion: ContactActivity["latestCompletion"];
  conversationType: "Lead" | "Loan" | "Contact" | null;
  direction: Extract<ConversationEvent["kind"], "Inbound" | "Outbound"> | null;
  origin: ConversationEvent["origin"] | null;
};
export type HistoryPage = { events: HistoryEvent[]; next: HistoryCursor | null };
const pageSize = 30;

export const contactCompletionSql = `(SELECT json_object('at', completedAt, 'actor', actor, 'outcome', outcome, 'note', note)
  FROM contact_follow_up_completions WHERE activityId = activity.id ORDER BY revision DESC LIMIT 1)`;

export function readRecordHistory(db: Store, staff: WorkspaceStaff | null, input: unknown): HistoryPage | { error: string } {
  const parsed = request.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid record and history page." };
  const { record, id, before } = parsed.data;
  const unavailable = { error: "This activity history is unavailable." };
  const email = staff?.email ?? null;
  const role = staff?.brokerage.role ?? "Admin";
  const args: SqlValue[] = [];
  const emptyFollowUp = "NULL AS dueAt, NULL AS previousDueAt, NULL AS completedAt, NULL AS purpose, NULL AS followUpOwner, NULL AS completion";
  const emptyConversation = "NULL AS conversationType, NULL AS direction, NULL AS origin";
  const loanEvents = `SELECT event.id, event.createdAt, 'loan' AS source, event.loanId AS targetId,
    event.kind, event.outcome, event.text, NULL AS author, ${emptyFollowUp}, ${emptyConversation} FROM activity event`;
  const conversationEvents = (type: NonNullable<HistoryEvent["conversationType"]>, from: string, scope: string) => `
    SELECT event.id, event.at AS createdAt, 'conversation' AS source, thread.id AS targetId,
      event.channel AS kind, NULL AS outcome, event.text, event.actor AS author, ${emptyFollowUp},
      '${type}' AS conversationType, event.kind AS direction, event.origin
    FROM ${from} WHERE ${scope} AND event.kind IN ('Inbound', 'Outbound') AND event.channel IS NOT NULL`;
  let query: string;
  let withSources = "";
  if (record === "loan") {
    if (staff ? !loanAccess(db, staff, id) : !db.prepare("SELECT 1 FROM loans WHERE id = ?").get(id)) return unavailable;
    query = `${loanEvents} WHERE event.loanId = ?`;
    args.push(id);
  } else {
    const contact = db.prepare("SELECT addedBy FROM contacts WHERE id = ?").get(id);
    if (!contact) return unavailable;
    const linkedLoans = `SELECT loan.id FROM loans loan WHERE (loan.contactId = ? OR loan.partnerId = ?)
      AND (? = 'Admin' OR (? = 'LO' AND loan.officerEmail = ?) OR (? = 'Processor' AND EXISTS (
        SELECT 1 FROM loan_processing processing WHERE processing.loanId = loan.id AND processing.processorEmail = ?)))`;
    const linkArgs = [id, id, role, role, email, role, email];
    const fullContact = role === "Admin" || (role === "LO" && contact.addedBy === email) ||
      !!db.prepare(`${linkedLoans} LIMIT 1`).get(...linkArgs);
    const assigned = role === "LO" && !!db.prepare(`SELECT 1 FROM contact_activity
      WHERE contactId = ? AND dueAt IS NOT NULL AND followUpOwnerEmail = ? LIMIT 1`).get(id, email);
    if (!fullContact && !assigned) return unavailable;

    const sources: string[] = [];
    const correspondence: string[] = [];
    const correspondenceArgs: SqlValue[] = [];
    if (role !== "Processor") {
      const contactJoins = `FROM contact_activity activity
        LEFT JOIN funding_check_ins checkIn ON checkIn.activityId = activity.id
        LEFT JOIN loans funded ON funded.id = checkIn.loanId AND funded.contactId = activity.contactId`;
      const visible = `WHERE activity.contactId = ? AND (? = 'Admin' OR
        (? = 1 AND (activity.officerEmail = ? OR funded.officerEmail = ?)) OR (activity.dueAt IS NOT NULL AND activity.followUpOwnerEmail = ?))`;
      const visibleArgs = [id, role, Number(fullContact), email, email, email];
      sources.push(`SELECT activity.id, activity.createdAt, 'contact' AS source, NULL AS targetId, activity.kind, activity.outcome,
        activity.text, activity.officer AS author, activity.dueAt, NULL AS previousDueAt, activity.completedAt, activity.purpose, activity.followUpOwner,
        CASE WHEN activity.dueAt IS NOT NULL THEN ${contactCompletionSql} END AS completion, ${emptyConversation}
        ${contactJoins} ${visible}`);
      sources.push(`SELECT change.activityId || ':' || change.revision AS id, change.changedAt AS createdAt, 'reschedule' AS source,
        NULL AS targetId, 'Note' AS kind, NULL AS outcome, change.reason AS text, change.actor AS author,
        change.dueAt, change.previousDueAt, NULL AS completedAt, NULL AS purpose, NULL AS followUpOwner, NULL AS completion, ${emptyConversation}
        ${contactJoins} JOIN contact_callback_reschedules change ON change.activityId = activity.id ${visible}`);
      args.push(...visibleArgs, ...visibleArgs);
    }
    if (fullContact) {
      sources.push(`${loanEvents} WHERE event.loanId IN (${linkedLoans}) AND event.kind <> 'Note'`);
      args.push(...linkArgs);
      correspondence.push(conversationEvents("Loan", `loan_conversations thread JOIN loans loan ON loan.id = thread.loanId
        JOIN conversation_events event ON event.conversationId = thread.id`,
      `thread.contactId = ? AND ${currentConversationContact} AND thread.loanId IN (${linkedLoans})`));
      correspondenceArgs.push(id, ...linkArgs);
      if (role !== "Processor") {
        sources.push(`SELECT event.id, event.at AS createdAt, 'lead' AS source, lead.id AS targetId, event.kind, event.outcome,
          event.text, NULL AS author, ${emptyFollowUp}, ${emptyConversation} FROM referral_leads lead JOIN lead_events event ON event.leadId = lead.id
          WHERE lead.importedContactId = ? AND lead.resolvedAt IS NULL AND event.kind <> 'Note'
            AND (? = 'Admin' OR lead.officerEmail = ? OR (lead.officerEmail IS NULL AND lead.realtorId IS NULL))`);
        args.push(id, role, email);
        const actorArgs = role === "LO" ? [email] : [];
        correspondence.push(conversationEvents("Lead", `referral_leads lead JOIN lead_conversations thread ON thread.leadId = lead.id
          JOIN lead_conversation_events event ON event.conversationId = thread.id`,
        `lead.importedContactId = ? AND lead.resolvedAt IS NULL AND ${relationshipConversationAccess(role, "lead.officerEmail", "?")}`));
        correspondenceArgs.push(id, ...actorArgs);
        correspondence.push(conversationEvents("Contact", "contact_conversations thread JOIN contact_conversation_events event ON event.conversationId = thread.id",
          `thread.contactId = ? AND ${relationshipConversationAccess(role, "thread.ownerEmail", "?")}`));
        correspondenceArgs.push(id, ...actorArgs);
      }
    }
    query = sources.join(" UNION ALL ");
    if (correspondence.length) {
      // Durable Object SQLite caps the terms in each compound SELECT.
      withSources = `WITH activity_rows AS (${query}), conversation_rows AS (${correspondence.join(" UNION ALL ")})`;
      query = "SELECT * FROM activity_rows UNION ALL SELECT * FROM conversation_rows";
      args.push(...correspondenceArgs);
    }
  }

  if (before) args.push(before.createdAt, before.source, before.id);
  const rows = db.prepare(`${withSources} SELECT * FROM (${query}) ${before ? "WHERE (createdAt, source, id) < (?, ?, ?)" : ""}
    ORDER BY createdAt DESC, source DESC, id DESC LIMIT ${pageSize + 1}`).all(...args) as unknown as
    (Omit<HistoryEvent, "latestCompletion"> & { completion: string | null })[];
  const events = rows.slice(0, pageSize).map(({ completion, ...item }) => ({ ...item, latestCompletion: completion ? JSON.parse(completion) : null }));
  const last = events.at(-1);
  return { events, next: rows.length > pageSize && last ? { id: last.id, source: last.source, createdAt: last.createdAt } : null };
}

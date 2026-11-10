import { z } from "zod";
import { conversationAudiences, type ConversationSubject } from "./conversation-model";

export const inboundReplyUnavailable = "Inbound review is unavailable in this workspace.";
export const inboundReplyStatuses = ["Pending", "Linked", "Dismissed"] as const;
export const inboundReplyChannels = ["Email", "Text", "Call"] as const;
export const inboundReplyLabel = (channel: (typeof inboundReplyChannels)[number]) => channel === "Call" ? "Missed call" : `${channel} reply`;
const id = z.string().min(1).max(160);
const receiptId = z.uuid();
const cursor = z.object({ at: z.iso.datetime(), id: receiptId });
const matchCursor = z.union([z.object({ loanId: id, audience: z.enum(conversationAudiences) }), z.object({ leadId: id }), z.object({ contactId: id })]);
const revision = z.number().int().positive();
export const inboundReplyQuery = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), status: z.enum(inboundReplyStatuses), after: cursor.optional() }),
  z.object({ type: z.literal("reply"), id: receiptId, after: matchCursor.optional() }),
]);
export const inboundReplyInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("simulate"), channel: z.enum(inboundReplyChannels),
    sourceId: z.string().trim().min(1).max(100).regex(/^[\w.:-]+$/),
    sender: z.string().trim().min(1).max(254), text: z.string().trim().min(1).max(1200).optional() }),
  z.object({ type: z.literal("attach"), id: receiptId, revision, loanId: id, contactId: id, audience: z.enum(conversationAudiences) }),
  z.object({ type: z.literal("attachLead"), id: receiptId, revision, leadId: id }),
  z.object({ type: z.literal("attachContact"), id: receiptId, revision, contactId: id }),
  z.object({ type: z.literal("dismiss"), id: receiptId, revision }),
]);
export type InboundReplyInput = z.infer<typeof inboundReplyInput>;
export type InboundReplyQuery = z.infer<typeof inboundReplyQuery>;
export type InboundReplyRow = z.infer<typeof cursor> & {
  channel: (typeof inboundReplyChannels)[number]; sourceId: string; sender: string;
  status: (typeof inboundReplyStatuses)[number]; replayCount: number; revision: number;
};
export type InboundMatch = (ConversationSubject & { kind: "loan"; borrower: string; address: string } |
  { kind: "lead"; leadId: string; owner: string; source: string }) & { name: string; stage: string; purpose: string; createdAt: string } |
  { kind: "contact"; contactId: string; name: string; role: string; owner: string | null };
export type InboundReplyResult =
  | { kind: "list"; rows: InboundReplyRow[]; next: z.infer<typeof cursor> | null }
  | { kind: "reply"; reply: InboundReplyRow & { text: string; conversationId: string | null };
    matches: InboundMatch[]; next: z.infer<typeof matchCursor> | null; indexing?: boolean }
  | { error: string };
export type InboundReplyChange = { id: string; message: string; conversationId?: string } | { error: string };

import { z } from "zod";

export const conversationsUnavailable = "This conversation is unavailable in your workspace.";
export const conversationAudiences = ["Borrower", "Realtor"] as const;
export const conversationOwners = ["Loan officer", "Processor"] as const;
export const conversationChannels = ["Call", "Email", "Text"] as const;
export const conversationStates = ["Open", "Needs reply", "Waiting on contact", "Closed"] as const;
export const conversationFilters = ["Active", "Unread", "Needs reply", "Waiting on contact", "Follow-up due", "Closed"] as const;
const id = z.string().min(1).max(160);
export const conversationCursor = z.object({ at: z.iso.datetime(), id: z.uuid() });
const subject = z.object({ loanId: id, audience: z.enum(conversationAudiences), contactId: id });
const conversationListFields = { filter: z.enum(conversationFilters), mine: z.boolean() };
export const conversationQuery = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), ...conversationListFields, after: conversationCursor.optional() }),
  z.object({ type: z.literal("myReplies") }),
  z.object({ type: z.literal("thread"), id: z.uuid(), after: conversationCursor.optional() }),
  z.object({ type: z.literal("loan"), ...subject.shape }),
  z.object({ type: z.literal("lead"), leadId: id }),
  z.object({ type: z.literal("contact"), contactId: id }),
]);
const conversationStarts = [
  z.object({ type: z.literal("start"), ...subject.shape }),
  z.object({ type: z.literal("startLead"), leadId: id }),
  z.object({ type: z.literal("startContact"), contactId: id }),
] as const;
export const conversationStartRequest = z.object({
  start: z.discriminatedUnion("type", conversationStarts), queue: z.object(conversationListFields),
});
const action = { id: z.uuid(), eventId: z.uuid(), revision: z.number().int().positive() };
export const conversationInput = z.discriminatedUnion("type", [
  ...conversationStarts,
  z.object({ type: z.literal("message"), ...action, direction: z.enum(["Inbound", "Outbound"]),
    channel: z.enum(conversationChannels), text: z.string().trim().min(1).max(1200) }),
  z.object({ type: z.literal("sampleReply"), ...action }),
  z.object({ type: z.literal("note"), ...action, text: z.string().trim().min(1).max(1200) }),
  z.object({ type: z.literal("read"), ...action }),
  z.object({ type: z.literal("followUp"), ...action, dueOn: z.iso.date().nullable() }),
  z.object({ type: z.literal("assign"), ...action, ownerRole: z.enum(conversationOwners) }),
  z.object({ type: z.literal("assignContact"), ...action, email: z.email().trim().toLowerCase() }),
  z.object({ type: z.literal("resolve"), ...action, closed: z.boolean() }),
]);

export type ConversationSubject = z.infer<typeof subject>;
type ContactSubject = { contactId: string };
export type ConversationFocus = ConversationSubject | { id: string } | { leadId: string } | ContactSubject;
export type ConversationQuery = z.infer<typeof conversationQuery>;
export type ConversationInput = z.infer<typeof conversationInput>;
export type ConversationCursor = z.infer<typeof conversationCursor>;
export type ConversationCallback = { taskId: string; dueAt: string } & ({ leadId: string } | { loanId: string });
export type ConversationRow = {
  loanId: string | null; leadId: string | null; contactId: string | null; audience: ConversationSubject["audience"];
  outreachBlocked: boolean; held: boolean;
  id: string; name: string; loanName: string; ownerRole: (typeof conversationOwners)[number]; owner: string;
  status: (typeof conversationStates)[number]; unread: boolean; dueOn: string | null; updatedAt: string; revision: number;
  campaignCallback?: ConversationCallback;
  missedCall?: true;
};
export type ConversationReplyPage = { items: ConversationRow[]; next: ConversationCursor | null };
export type ConversationEvent = ConversationCursor & {
  kind: "Inbound" | "Outbound" | "Note" | "State";
  channel: (typeof conversationChannels)[number] | null;
  origin: "Manual log" | "Simulated" | "Internal" | "Lead log"; text: string; actor: string;
};
export type ConversationDetail = ConversationRow & {
  canManage: boolean; canOpenCampaignCallback?: boolean; ownerOptions: { role: ConversationRow["ownerRole"]; name: string }[]; contactOwnerEmail?: string;
};
export type ConversationResult =
  | { kind: "list"; checkedAt: string; rows: ConversationRow[]; next: ConversationCursor | null }
  | { kind: "replies"; checkedAt: string; page: ConversationReplyPage }
  | { kind: "thread"; thread: ConversationDetail; events: ConversationEvent[]; next: ConversationCursor | null }
  | { kind: "new"; subject: ConversationSubject | { leadId: string } | (ContactSubject & { audience: ConversationSubject["audience"] });
    name: string; loanName: string; owner: string; convertedLoan?: true }
  | { error: string };
type OpenedConversation = Extract<ConversationResult, { kind: "thread" }>;
export type ConversationChange = { id: string; message: string; opened?: OpenedConversation } | { error: string };
export type ConversationStartResponse = { id: string; message: string; opened: OpenedConversation;
  queue?: Extract<ConversationResult, { kind: "list" }> } | { error: string };

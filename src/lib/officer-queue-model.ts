import { z } from "zod";
import { conversationCursor, type ConversationReplyPage } from "./conversation-model";
import { fundingCheckInTarget } from "./loan-workflow";
import { disclosureTarget } from "./disclosure-model";
import { mockUwmReceiptTaskPrefix } from "./uwm-handoff-recovery";
import type { Contact, ContactActivity } from "./model";
import type { DueSequenceStep } from "./campaign-sequence-model";

export const officerQueueUnavailable = "This personal work queue is unavailable.";
export const campaignCallbacksUnavailable = "This personal campaign callback queue is unavailable.";
export const officerQueueKinds = ["lead", "lead-task", "campaign", "contact", "conversation", "loan", "closing", "checklist", "lock", "document",
  "appointment", "review", "handoff", "uwm-alert", "document-review", "lead-hold", "loan-hold", "quiet-lead",
  "application-review", "playbook-handoff", "funding", "lead-document", "lead-document-review", "sequence"] as const;
const queueDate = z.union([z.iso.date(), z.iso.datetime()]);
export const officerQueueCursor = z.object({ kind: z.enum(officerQueueKinds), dueAt: queueDate, id: z.string().min(1).max(200) });
const cursor = officerQueueCursor;
export const officerQueueQuery = z.object({ horizon: z.union([z.literal(1), z.literal(7)]), after: cursor.optional(), replyAfter: conversationCursor.optional() });
const campaignCallbackCursor = z.object({ dueAt: z.iso.datetime({ precision: 3 }), id: z.string().min(1).max(200) });
export const campaignCallbackQuery = z.object({ view: z.enum(["Due", "Upcoming"]), after: campaignCallbackCursor.optional() });
export type CampaignCallbackQuery = z.infer<typeof campaignCallbackQuery>;
export type CampaignCallbackItem = { leadId: string; loanId?: string; taskId: string; dueAt: string; campaignName: string; name: string; requested: boolean };
export type CampaignCallbackPage = {
  checkedAt: string;
  items: CampaignCallbackItem[];
  next: z.infer<typeof campaignCallbackCursor> | null;
};
export const calendarUnavailable = "This workspace calendar is unavailable.";
export const calendarGroups = {
  All: ["lead", "lead-task", "campaign", "contact", "conversation", "loan", "closing", "checklist", "lock", "document", "lead-document", "appointment", "review"],
  Outreach: ["lead", "lead-task", "campaign", "contact"],
  Conversations: ["conversation"],
  Appointments: ["appointment"],
  Documents: ["document", "lead-document"],
  Reviews: ["review"],
  Closings: ["closing", "checklist"],
  "Rate locks": ["lock"],
  "Loan tasks": ["loan"],
} satisfies Record<string, readonly (typeof officerQueueKinds)[number][]>;
export const calendarGroupNames = Object.keys(calendarGroups) as (keyof typeof calendarGroups)[];
const calendarDate = z.iso.date().refine((value) => value >= "1900-01-01" && value <= "9998-12-31");
export const calendarQuery = z.object({
  week: calendarDate, day: calendarDate.optional(), scope: z.enum(["Mine", "Team"]),
  group: z.enum(calendarGroupNames), after: cursor.optional(),
});

export type OfficerQueueQuery = z.infer<typeof officerQueueQuery>;
export type OfficerQueueItem = z.infer<typeof cursor> & {
  recordId: string; name: string; title: string; overdue: boolean; campaignId?: string; target?: string; handoffDueAt?: string;
  completedAt?: string; blocked?: boolean; reason?: string;
  sequence?: DueSequenceStep;
};
type DeadlinePage = { checkedAt: string; through: string; items: OfficerQueueItem[]; next: z.infer<typeof cursor> | null };
export type OfficerQueuePage = DeadlinePage & { replies: ConversationReplyPage };
export type CalendarQuery = z.infer<typeof calendarQuery>;
export type CalendarItem = OfficerQueueItem & { owner: string };
export type CalendarPage = Omit<DeadlinePage, "items"> & { items: CalendarItem[] };

export const workspaceTasksUnavailable = "Could not load the active task queue.";
export const workspaceTaskViews = ["Open", "Due in 24 hours", "Overdue", "Completed"] as const;
export const workspaceTaskScope = z.enum(["Mine", "Available", "Team"]);
export const workspaceTaskGroups = {
  "All work": officerQueueKinds,
  "Leads and callbacks": ["lead", "lead-task", "campaign", "contact", "quiet-lead"],
  "Loan follow-ups": ["loan", "review", "handoff", "application-review", "playbook-handoff", "funding"],
  "Playbook tasks": ["quiet-lead", "application-review", "playbook-handoff", "funding"],
  Holds: ["lead-hold", "loan-hold"],
  Documents: ["document", "document-review", "lead-document", "lead-document-review"],
  "Lender updates": ["uwm-alert", "lock"],
  Closing: ["closing", "checklist"],
  Conversations: ["conversation"],
} satisfies Record<string, readonly (typeof officerQueueKinds)[number][]>;
export const workspaceTaskGroupNames = Object.keys(workspaceTaskGroups) as (keyof typeof workspaceTaskGroups)[];
export const workspaceTaskList = z.object({
  type: z.literal("list"), view: z.enum(workspaceTaskViews), scope: workspaceTaskScope,
  group: z.enum(workspaceTaskGroupNames).default("All work"),
  after: officerQueueCursor.optional(), checkedAt: z.iso.datetime().optional(),
});
export const workspaceTasksInput = z.discriminatedUnion("type", [
  workspaceTaskList,
  z.object({ type: z.literal("contact"), id: z.string().min(1).max(200) }),
]);
export type WorkspaceTaskList = z.infer<typeof workspaceTaskList>;
export type WorkspaceTaskPage = Omit<CalendarPage, "through"> & { kind: "list" };
export type ContactTaskWork = {
  kind: "contact"; item: ContactActivity; contact: Pick<Contact, "id" | "name" | "role">; blocked: boolean;
};

export function queueActionLabel(item: OfficerQueueItem) {
  switch (item.kind) {
    case "handoff": return item.handoffDueAt ? "Open returned handoff" : "Open processing handoff";
    case "review": return "Open review";
    case "application-review": return "Review 1003";
    case "playbook-handoff": return "Open processing handoff";
    case "appointment": return "Open appointment";
    case "document":
    case "document-review": return "Open document request";
    case "lead-document":
    case "lead-document-review": return "Open lead document request";
    case "uwm-alert": return "Open lender update";
    case "contact": return "Open follow-up";
    case "lead-task": return "Open lead task";
    case "sequence": return "Log sequence call";
    case "conversation": return "Open conversation";
    case "lead":
    case "lead-hold":
    case "quiet-lead":
    case "campaign": return item.campaignId ? "Open campaign" : "Open lead";
    case "lock": return "Open pricing";
    case "funding": return item.target === fundingCheckInTarget ? "Record check-in" : item.completedAt ? "Open loan" : "Preview draft";
    case "loan": return item.target === fundingCheckInTarget ? "Record check-in" :
      item.target === disclosureTarget ? "Open disclosures" :
        item.id.startsWith(mockUwmReceiptTaskPrefix) ? "Open UWM receipt review" : "Open loan task";
    case "loan-hold": return "Open loan hold";
    default: return "Open closing";
  }
}

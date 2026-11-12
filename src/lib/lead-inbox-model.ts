import { z } from "zod";
import { intakePropertyState } from "./property-state";
import { referralPhone } from "./referral-matches";
import type { InboxLead } from "./model";
import type { EditableLoan } from "./loan-work-model";
import type { CampaignQueueSnapshot } from "./lead-work-model";
import type { RealtorClaimPolicy } from "./realtor-claim-model";
import { quotePrefillSelection } from "./quote-intake-questions";

export type InboxLeadSummary = Pick<InboxLead, "id" | "name" | "realtorName" | "source" | "purpose" | "zip" | "propertyState" |
  "officer" | "officerEmail" | "dueAt" | "heldAt" | "revisitDate" | "outreachSuppressed"> & {
  followUp: Pick<InboxLead["followUp"], "firstContactAt" | "replyReceivedAt">;
};
export function firstContactOverdue(lead: Pick<InboxLeadSummary, "heldAt" | "outreachSuppressed" | "followUp" | "dueAt">, now: number) {
  return !lead.heldAt && !lead.outreachSuppressed && !lead.followUp.firstContactAt && !lead.followUp.replyReceivedAt && Date.parse(lead.dueAt) <= now;
}

export const leadAttentionView = "Needs first contact";
export const leadInboxViews = ["All open", "Mine", "Unassigned", "Shared realtor referrals", leadAttentionView, "First contact overdue", "Mock step due",
  "On hold", "Opted out", "Archived"] as const;
export type LeadInboxView = (typeof leadInboxViews)[number];
const inboxCursor = z.object({ dueAt: z.string().max(80), id: z.string().min(1).max(100) });
export const leadInboxRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), view: z.enum(leadInboxViews), after: inboxCursor.optional() }),
  z.object({ type: z.literal("open"), id: z.string().min(1).max(100) }),
]);
export const leadInboxUnavailable = "Could not load Lead Inbox. Try again.";
export type LeadInboxPage = {
  kind: "list";
  leads: InboxLeadSummary[];
  next: z.infer<typeof inboxCursor> | null;
  overdue: number | null;
  routing: LeadRouting | null;
  claimPolicy?: RealtorClaimPolicy;
  canClaimRealtor: boolean;
};
export type ConvertedLead = { id: string; resolvedAt: string; campaignId: string | null };
export type LeadInboxMutation = {
  inboxChanged: true;
  message: string;
  referralLoanId?: string;
  restoredLeadId?: string;
  inboxLoan?: EditableLoan;
  convertedLead?: ConvertedLead;
  convertedCampaign?: CampaignQueueSnapshot;
};

export const convertReferralInput = z.object({
  type: z.literal("convertReferral"), referralId: z.uuid(), contactId: z.string().min(1).max(100).nullable(),
  allowDuplicate: z.boolean().default(false), intakeReview: quotePrefillSelection.optional(),
});

const ownerEmail = z.email().max(254);
export const saveLeadRoutingInput = z.object({
  type: z.literal("saveLeadRouting"), revision: z.number().int().nonnegative(),
  websiteOwner: ownerEmail.nullable(), realtorRoute: z.enum(["Link owner", "Shared inbox", "Assigned officer"]),
  realtorOwner: ownerEmail.nullable(), firstContactHours: z.number().int().min(1).max(72),
  secondAfterHours: z.number().int().min(1).max(168), finalAfterHours: z.number().int().min(1).max(336),
  quoteForm: z.enum(["Keep", "Enable or replace", "Disable"]),
});

export const correctLeadPropertyStateInput = z.strictObject({
  type: z.literal("correctLeadPropertyState"), leadId: z.uuid(), revision: z.int().nonnegative(),
  propertyState: intakePropertyState.unwrap(), reason: z.string().trim().min(4).max(240),
});

export const assignInboxLeadInput = z.object({
  type: z.literal("assignInboxLead"), leadId: z.uuid(), email: ownerEmail.nullable(), previousEmail: ownerEmail.nullable(),
  callbackPromiseId: z.uuid().optional(), documentRecovery: z.literal(true).optional(),
});

const leadRevision = { leadId: z.uuid(), revision: z.number().int().nonnegative() };
export const leadHoldInput = z.discriminatedUnion("action", [
  z.object({ type: z.literal("leadHold"), ...leadRevision, action: z.literal("Hold"),
    reason: z.string().trim().min(1).max(160), revisitDate: z.iso.date().nullable() }),
  z.object({ type: z.literal("leadHold"), ...leadRevision, action: z.literal("Reactivate") }),
]);
export const outreachChannels = ["Call", "Email", "Text"] as const;
export const leadOutcomes = ["Connected", "Left message", "Sent update", "No response", "Requested callback", "Reply received"] as const;
export const leadSequenceActions = ["Start", "Pause", "Resume", "Stop", "Mock send"] as const;
export const leadSequenceInput = z.object({ type: z.literal("leadSequence"), ...leadRevision, action: z.enum(leadSequenceActions) });
export const leadContactInput = z.object({
  type: z.literal("leadContact"), ...leadRevision, channel: z.enum(outreachChannels), outcome: z.enum(leadOutcomes), note: z.string().trim().max(500),
});
export const leadOptOutInput = z.object({ type: z.literal("leadOptOut"), leadId: z.uuid() });
export const restoreLeadInput = z.object({
  type: z.literal("restoreLead"), leadId: z.uuid(), archiveToken: z.uuid(),
});

const archiveCursor = z.object({ archivedAt: z.iso.datetime(), id: z.uuid() });
export const leadArchiveRequest = z.object({ query: z.string().trim().max(160), before: archiveCursor.optional(), leadId: z.uuid().optional() });
export interface ArchivedLead {
  id: string;
  archiveToken: string;
  archivedAt: string;
  name: string;
  officer: string;
  source: InboxLead["source"];
  realtorName: string | null;
}
export interface LeadArchivePage {
  leads: ArchivedLead[];
  next: z.infer<typeof archiveCursor> | null;
}

export const leadSequenceSteps = [
  { title: "Introduction", body: "Thanks for reaching out about a mortgage. When is a good time to talk through your plans?" },
  { title: "Check in", body: "I wanted to check in and see if you have any questions about your mortgage options." },
  { title: "Final check-in", body: "If you’d like to pick up the conversation later, I’m here to help." },
] as const;

export interface LeadRouting {
  revision: number;
  websiteOwner: string | null;
  realtorRoute: "Link owner" | "Shared inbox" | "Assigned officer";
  realtorOwner: string | null;
  firstContactHours: number;
  secondAfterHours: number;
  finalAfterHours: number;
  quoteToken: string | null;
}

export interface LeadEvent {
  id: string;
  at: string;
  actor: string;
  kind: "Note" | "Campaign" | (typeof outreachChannels)[number];
  outcome: (typeof leadOutcomes)[number] | "Opted out" | null;
  text: string;
}

export interface LeadFollowUp {
  status: "Not started" | "Active" | "Paused" | "Stopped" | "Completed";
  revision: number;
  nextStep: number;
  nextAt: string | null;
  pausedAt: string | null;
  firstContactAt: string | null;
  replyReceivedAt: string | null;
  events: LeadEvent[];
}

export const leadContactFields = {
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(160).refine((value) => !value || z.email().safeParse(value).success),
  phone: z.string().trim().max(40).refine((value) => !value || /^[+\d().\s-]+$/.test(value) && /^\d{10,15}$/.test(referralPhone(value))),
  purpose: z.enum(["Purchase", "Refinance"]),
};

export const defaultLeadRouting: LeadRouting = {
  revision: 0, websiteOwner: null, realtorRoute: "Link owner", realtorOwner: null,
  firstContactHours: 24, secondAfterHours: 48, finalAfterHours: 72, quoteToken: null,
};

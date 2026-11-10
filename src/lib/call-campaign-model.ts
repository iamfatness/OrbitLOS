import { z } from "zod";
import { readCsv } from "./contact-csv";
import { leadContactFields, type LeadEvent } from "./lead-inbox-model";
import type { CampaignSequenceConfig } from "./campaign-sequence-model";
import type { MigrationRow } from "./pipeline-migration-model";
import type { DraftChannel, InboxLead, Loan, Workspace } from "./model";
import { referralPhone } from "./referral-matches";
import { dateTime } from "./utils";

export const callOutcomes = ["Connected", "Left message", "No response", "Requested callback", "Opted out"] as const;
export type CallOutcome = (typeof callOutcomes)[number];
export function unansweredCampaignCall(outcome: CallOutcome) {
  return outcome === "Left message" || outcome === "No response";
}

export function campaignCallNote(event: LeadEvent, campaignName: string) {
  const heading = `${event.outcome} · Call campaign · ${campaignName}`;
  if (event.text === heading || event.text === event.outcome) return "";
  const prefix = `${heading} · `;
  return event.text.startsWith(prefix) ? event.text.slice(prefix.length) : event.text;
}

export type CampaignLenderPath = "uwm" | "manual";

export const campaignManualHandoff = {
  lender: "Fictional demo lender",
  referencePrefix: "REHEARSAL-",
  acknowledgmentNote: "Simulated response from the fictional campaign lender.",
};

export function campaignManualLender(loanId: string) {
  return { lender: campaignManualHandoff.lender, externalId: `${campaignManualHandoff.referencePrefix}${loanId}`, status: "Acknowledged · demo" };
}

export const createCallCampaignInput = z.object({
  type: z.literal("createCallCampaign"), id: z.uuid(), name: z.string().trim().min(1).max(80),
});
export const loadCampaignRehearsalInput = z.object({
  type: z.literal("loadCampaignRehearsal"), id: z.uuid(), buyerEmail: z.email().max(254).optional(),
});
export const addCampaignLeadInput = z.object({
  type: z.literal("addCampaignLead"), campaignId: z.uuid(), leadId: z.uuid(),
});
export const campaignAssignmentLimit = 100;
export const campaignRoutingOfficerLimit = 30;
export const localCampaignOfficers = [
  { email: "local-demo@example.test", name: "Alex Morgan" },
  { email: "jamie-demo@example.test", name: "Jamie Chen" },
];
const officerEmail = z.email().max(254);
const campaignRoutingOfficer = z.object({ email: officerEmail, limit: z.number().int().min(1).max(100) });
export const saveCampaignRoutingInput = z.object({
  type: z.literal("saveCampaignRouting"), campaignId: z.uuid(), revision: z.number().int().nonnegative(),
  enabled: z.boolean(), officers: z.array(campaignRoutingOfficer).max(campaignRoutingOfficerLimit),
}).refine(({ enabled, officers }) => (!enabled || officers.length > 0) &&
  new Set(officers.map(({ email }) => email)).size === officers.length, "Choose at least one active officer for round-robin routing.");
export const routeCampaignQueueInput = z.object({
  type: z.literal("routeCampaignQueue"), campaignId: z.uuid(),
});
export type CampaignRouting = Pick<z.infer<typeof saveCampaignRoutingInput>, "revision" | "enabled" | "officers">;
export const assignCampaignLeadsInput = z.object({
  type: z.literal("assignCampaignLeads"), campaignId: z.uuid(), email: officerEmail,
  leads: z.array(z.object({ id: z.uuid(), previousEmail: officerEmail.nullable() })).min(1).max(campaignAssignmentLimit),
}).refine(({ leads }) => new Set(leads.map(({ id }) => id)).size === leads.length, "Select each lead once.");

export function assignableCampaignLead(lead: { phone: string; outreachSuppressed?: boolean; heldAt?: string | null }) {
  return !lead.heldAt && !lead.outreachSuppressed && !!lead.phone && leadContactFields.phone.safeParse(lead.phone).success;
}
export const saveCampaignRulesInput = z.object({
  type: z.literal("saveCampaignRules"), campaignId: z.uuid(), revision: z.number().int().nonnegative(),
  voicemailDays: z.number().int().min(0).max(10), noResponseDays: z.number().int().min(0).max(10),
  maxAttempts: z.number().int().min(1).max(10),
  retryTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Choose a valid Eastern retry time.").optional(),
});
export type CampaignRules = Pick<z.infer<typeof saveCampaignRulesInput>, "revision" | "voicemailDays" | "noResponseDays" | "maxAttempts"> & { retryTime: string };
export const defaultCampaignRules: CampaignRules = { revision: 0, voicemailDays: 1, noResponseDays: 2, maxAttempts: 3, retryTime: "10:00" };
export const pauseCampaignRetriesInput = z.object({ type: z.literal("pauseCampaignRetries"), campaignId: z.uuid(),
  revision: z.number().int().nonnegative(), paused: z.boolean() });
export const recordCampaignCallInput = z.object({
  type: z.literal("recordCampaignCall"), campaignId: z.uuid(), leadId: z.uuid(), revision: z.number().int().nonnegative(),
  outcome: z.enum(callOutcomes), note: z.string().trim().max(400), callbackAt: z.iso.datetime().nullable(), simulateFollowUpFailure: z.boolean().optional(),
}).refine((value) => (value.outcome === "Requested callback") === Boolean(value.callbackAt), "Choose a callback time when the lead requests a callback.");

export const rescheduleCampaignCallbackInput = z.object({
  type: z.literal("rescheduleCampaignCallback"), campaignId: z.uuid(), leadId: z.uuid(), revision: z.number().int().nonnegative(),
  callbackAt: z.iso.datetime(), reason: z.string().trim().min(1).max(400),
});

export const mockCampaignFollowUpPrefix = "Mock campaign follow-up recorded";
export const recordCampaignFollowUpInput = z.object({
  type: z.literal("recordCampaignFollowUp"), campaignId: z.uuid(), leadId: z.uuid(), callEventId: z.uuid(), eventId: z.uuid(),
  revision: z.number().int().nonnegative(), channel: z.enum(["Email", "Text"]), recipient: z.string().trim().min(1).max(254),
  callbackAt: z.iso.datetime().nullable(), subject: z.string().trim().max(120).regex(/^[^\r\n]*$/), body: z.string().trim().min(1).max(1200),
}).refine(({ channel, subject }) => channel === "Email" ? !!subject : !subject, "Use a subject for email drafts only.");

type FollowUpOutcome = Exclude<CallOutcome, "Opted out">;

export function campaignFollowUpAllowed(outcome: unknown, callbackAt: string | null, now: number): outcome is FollowUpOutcome {
  return outcome === "Connected" || outcome === "Left message" || outcome === "No response" ||
    (outcome === "Requested callback" && !!callbackAt && Date.parse(callbackAt) > now);
}

export function campaignFollowUpSource(lead: InboxLead, member: CallCampaignMember, now: number) {
  if (!lead.officerEmail || lead.heldAt || lead.outreachSuppressed || member.outreachSuppressed || member.resolvedAt || member.loanId || !member.attempts) return;
  const call = lead.followUp.events.find(({ kind }) => kind === "Call");
  const callbackAt = member.lastOutcome === "Requested callback" ? member.callbackDueAt : null;
  if (!call || call.outcome !== member.lastOutcome || !campaignFollowUpAllowed(call.outcome, callbackAt, now) ||
    (lead.followUp.replyReceivedAt && lead.followUp.replyReceivedAt >= call.at) ||
    (!campaignFollowUpRecipient("Email", lead) && !campaignFollowUpRecipient("Text", lead))) return;
  return { callEventId: call.id, outcome: call.outcome, callbackAt };
}

export function campaignFollowUpRecipient(channel: DraftChannel, { email, phone }: { email: string; phone: string }) {
  const address = channel === "Email" ? email.trim() : phone.trim();
  const field = channel === "Email" ? leadContactFields.email : leadContactFields.phone;
  return address && field.safeParse(address).success ? address : "";
}

export function renderCampaignFollowUp(outcome: FollowUpOutcome, channel: DraftChannel, name: string, officer: string, callbackAt: string | null) {
  const subject = outcome === "Requested callback" ? "Confirming our callback" : "Following up on your mortgage inquiry";
  const message = outcome === "Requested callback" && callbackAt ? `Thanks for speaking with me. I’ll call you on ${dateTime(callbackAt)} Eastern. Let me know if your availability changes.` :
    outcome === "Connected" ? "Thanks for talking with me about your mortgage plans. Let me know if you have questions or would like to go over the next step." :
      outcome === "Left message" ? "I left you a voicemail about your mortgage inquiry. When would be a good time to connect?" :
        "I tried to reach you about your mortgage inquiry. Let me know when you’d like to talk.";
  const signature = officer || "Your loan team";
  return channel === "Email" ? { subject, body: `Hi ${name},\n\n${message}\n\nThanks,\n${signature}` } :
    { subject: "", body: `Hi ${name}, ${message} — ${signature}` };
}

export interface CallCampaign extends CampaignRules {
  id: string;
  name: string;
  createdAt: string;
  automaticPaused: boolean;
  routing?: CampaignRouting;
  newLeadSequence?: CampaignSequenceConfig;
}

export interface CallCampaignMember {
  campaignId: string;
  leadId: string;
  segmentId: string | null;
  segmentName: string | null;
  name: string;
  resolvedAt: string | null;
  loanId: string | null;
  attempts: number;
  lastOutcome: CallOutcome | null;
  reachedAt: string | null;
  retryExhaustedAt: string | null;
  callbackTaskId: string | null;
  callbackDueAt: string | null;
  callbackPromise?: { requestEventId: string; originalDueAt: string; dueAt: string };
  followUpRunStatus: "Failed" | "Paused" | null;
  followUpRun?: { id: string; dueAt: string };
  outreachSuppressed: boolean;
}

export type CampaignQueueFile = Pick<Loan, "id" | "officer" | "amount" | "stage"> & {
  submittedAt: string | null;
  fundingDate: string | null;
};

export const refreshCampaignQueueInput = z.object({
  type: z.literal("refreshCampaignQueue"),
  campaignId: z.uuid(),
});

export const openCampaignsInput = z.object({
  type: z.literal("openCampaigns"),
  campaignId: z.uuid().optional(),
  loadIntake: z.boolean().default(false),
});

export type CampaignLeadOption = Pick<InboxLead, "id" | "name" | "phone">;

type CampaignQueueRecord = {
  member: Pick<CallCampaignMember, "leadId" | "resolvedAt" | "outreachSuppressed" | "callbackDueAt" | "attempts" | "lastOutcome" | "followUpRunStatus">;
  lead?: Pick<InboxLead, "officerEmail" | "heldAt" | "outreachSuppressed"> & { followUp: Pick<InboxLead["followUp"], "replyReceivedAt"> };
  optedOut: boolean;
};

export function campaignCallQueues<T extends CampaignQueueRecord>(records: T[], now: number) {
  const scheduled: { record: T; due: number }[] = [];
  const firstCalls: T[] = [];
  for (const record of records) {
    const { member, lead, optedOut } = record;
    if (!lead?.officerEmail || member.resolvedAt || lead.heldAt || optedOut || member.lastOutcome === "Opted out" || member.outreachSuppressed || lead.outreachSuppressed) continue;
    const replied = Boolean(lead.followUp.replyReceivedAt);
    if (member.callbackDueAt) {
      const due = Date.parse(member.callbackDueAt);
      if (Number.isFinite(due) && (!replied || member.lastOutcome === "Requested callback")) scheduled.push({ record, due });
    } else if (!replied && member.attempts === 0 && !member.followUpRunStatus) {
      firstCalls.push(record);
    }
  }
  scheduled.sort((a, b) => a.due - b.due || a.record.member.leadId.localeCompare(b.record.member.leadId));
  const dueCallbacks: T[] = [];
  const upcomingCallbacks: T[] = [];
  for (const { record, due } of scheduled) {
    (due <= now ? dueCallbacks : upcomingCallbacks).push(record);
  }
  return { dueCallbacks, upcomingCallbacks, firstCalls };
}

export function nextCampaignCallId({ callCampaignMembers, inboxLeads }: Pick<Workspace, "callCampaignMembers" | "inboxLeads">,
  { campaignId, segmentId, officerEmail, now, completedLeadId }: {
    campaignId: string; segmentId: string; officerEmail?: string; now: number; completedLeadId?: string;
  }) {
  const leads = new Map(inboxLeads.filter((lead) => !officerEmail || lead.officerEmail === officerEmail).map((lead) => [lead.id, lead]));
  const candidates = callCampaignMembers.flatMap((member) => {
    if (member.campaignId !== campaignId || member.loanId || member.leadId === completedLeadId || (segmentId && member.segmentId !== segmentId)) return [];
    const lead = leads.get(member.leadId);
    return lead ? [{ member, lead, optedOut: member.outreachSuppressed }] : [];
  });
  const { dueCallbacks, firstCalls } = campaignCallQueues(candidates, now);
  firstCalls.sort((a, b) => a.lead.dueAt.localeCompare(b.lead.dueAt) || a.lead.id.localeCompare(b.lead.id));
  return (dueCallbacks[0] ?? firstCalls[0])?.member.leadId;
}

export const campaignOrigin = (id: string) => `call-${id}`;
export const rehearsalBuyerKey = "Lead:rehearsal-buyer";
export const rehearsalReserveKey = "Lead:rehearsal-reserve";
export interface CampaignRehearsal {
  campaignId: string;
  leadId: string | null;
  importedCount: number;
  buyerEmail?: string;
  checkInActivityId?: string;
}
export const campaignRehearsalCsv = [
  "id,name,phone,email,purpose,zip",
  "rehearsal-buyer,Jordan Campaign Buyer,2485550196,jordan-campaign-rehearsal@example.test,Purchase,48304",
  "rehearsal-reserve,Casey Campaign Reserve,2485550197,casey-campaign-rehearsal@example.test,Purchase,48084",
].join("\r\n");

export const campaignLeadExample = [
  "name,phone,email,purpose",
  "Morgan Sample,2485550112,morgan-campaign@example.test,Purchase",
  "Taylor Sample,2485550113,taylor-campaign@example.test,Refinance",
  "Avery Sample,2485550114,avery-campaign@example.test,Purchase",
].join("\r\n");

const importFields = z.object({ ...leadContactFields, phone: leadContactFields.phone.min(1),
  externalId: z.string().regex(/^[a-zA-Z0-9_.:@-]{1,100}$/), zip: z.string().regex(/^(?:\d{5})?$/),
});

export function parseCampaignLeadCsv(input: string, createdAt: string): Extract<MigrationRow, { type: "Lead" }>[] {
  const [header, ...rows] = readCsv(input);
  const fields = header?.map((value) => value.toLowerCase().replace(/[\s_-]/g, "")) ?? [];
  const nameIndex = fields.findIndex((value) => value === "name" || value === "fullname");
  const phoneIndex = fields.findIndex((value) => value === "phone" || value === "phonenumber");
  if (nameIndex < 0 || phoneIndex < 0) throw new Error("Include name and phone column headers.");
  if (rows.length < 1 || rows.length > 100) throw new Error("Include 1 to 100 leads per CSV.");
  return rows.map((row, index) => {
    const cell = (column: string) => row[fields.indexOf(column)] ?? "";
    const rawPurpose = cell("purpose").toLowerCase();
    const phone = row[phoneIndex] ?? "";
    const parsed = importFields.safeParse({
      name: row[nameIndex] ?? "", phone, email: cell("email"), zip: cell("zip"),
      purpose: rawPurpose === "refinance" ? "Refinance" : !rawPurpose || rawPurpose === "purchase" ? "Purchase" : rawPurpose,
      externalId: cell("id") || cell("externalid") || referralPhone(phone),
    });
    if (!parsed.success || row.length > fields.length) throw new Error(`Check the name, phone, email, purpose, ZIP, and optional ID on lead row ${index + 1}.`);
    return { ...parsed.data, type: "Lead", parentId: "", ownerEmail: "", source: "Imported CRM", createdAt, dueAt: "" };
  });
}

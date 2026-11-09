import { z } from "zod";
import { readCsv } from "./contact-csv";
import { leadContactFields } from "./lead-inbox-model";
import type { MigrationRow } from "./pipeline-migration-model";
import type { InboxLead, Loan } from "./model";
import { referralPhone } from "./referral-matches";

export const callOutcomes = ["Connected", "Left message", "No response", "Requested callback", "Opted out"] as const;
export type CallOutcome = (typeof callOutcomes)[number];
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

export interface CallCampaign extends CampaignRules {
  id: string;
  name: string;
  createdAt: string;
  automaticPaused: boolean;
  routing?: CampaignRouting;
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
  callbackTaskId: string | null;
  callbackDueAt: string | null;
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

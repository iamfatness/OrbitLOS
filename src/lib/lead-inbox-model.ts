import { z } from "zod";
import { portalTokenPattern } from "./brokerage-model";
import { referralPhone } from "./referral-matches";

const ownerEmail = z.email().max(254);
export const saveLeadRoutingInput = z.object({
  type: z.literal("saveLeadRouting"), revision: z.number().int().nonnegative(),
  websiteOwner: ownerEmail.nullable(), realtorRoute: z.enum(["Link owner", "Shared inbox", "Assigned officer"]),
  realtorOwner: ownerEmail.nullable(), firstContactHours: z.number().int().min(1).max(72),
  secondAfterHours: z.number().int().min(1).max(168), finalAfterHours: z.number().int().min(1).max(336),
  quoteForm: z.enum(["Keep", "Enable or replace", "Disable"]),
});

export const assignInboxLeadInput = z.object({
  type: z.literal("assignInboxLead"), leadId: z.uuid(), email: ownerEmail.nullable(), previousEmail: ownerEmail.nullable(),
});

const leadRevision = { leadId: z.uuid(), revision: z.number().int().nonnegative() };
export const outreachChannels = ["Call", "Email", "Text"] as const;
export const leadOutcomes = ["Connected", "Left message", "Sent update", "No response", "Requested callback", "Reply received"] as const;
export const leadSequenceActions = ["Start", "Pause", "Resume", "Stop", "Mock send"] as const;
export const leadSequenceInput = z.object({ type: z.literal("leadSequence"), ...leadRevision, action: z.enum(leadSequenceActions) });
export const leadContactInput = z.object({
  type: z.literal("leadContact"), ...leadRevision, channel: z.enum(outreachChannels), outcome: z.enum(leadOutcomes), note: z.string().trim().max(500),
});

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
  kind: "Note" | (typeof outreachChannels)[number];
  outcome: (typeof leadOutcomes)[number] | null;
  text: string;
}

export interface LeadFollowUp {
  status: "Not started" | "Active" | "Paused" | "Stopped" | "Completed";
  revision: number;
  nextStep: number;
  nextAt: string | null;
  pausedAt: string | null;
  firstContactAt: string | null;
  events: LeadEvent[];
}

export const leadContactFields = {
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(160).refine((value) => !value || z.email().safeParse(value).success),
  phone: z.string().trim().max(40).refine((value) => !value || /^[+\d().\s-]+$/.test(value) && /^\d{10,15}$/.test(referralPhone(value))),
  purpose: z.enum(["Purchase", "Refinance"]),
};

export const quoteLeadInput = z.object({
  token: z.string().regex(portalTokenPattern), requestId: z.uuid(), ...leadContactFields,
  zip: z.string().trim().regex(/^\d{5}$|^$/), consent: z.literal(true), website: z.literal("").optional(),
}).refine((value) => !!(value.email || value.phone));

export const defaultLeadRouting: LeadRouting = {
  revision: 0, websiteOwner: null, realtorRoute: "Link owner", realtorOwner: null,
  firstContactHours: 24, secondAfterHours: 48, finalAfterHours: 72, quoteToken: null,
};

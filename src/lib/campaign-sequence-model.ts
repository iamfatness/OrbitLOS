import { z } from "zod";

export const sequenceChannels = ["Call", "Email", "Text"] as const;
export const campaignSequenceKinds = ["New Lead", "Cold Lead Reactivation", "Past Client Outreach"] as const;
export type CampaignSequenceKind = (typeof campaignSequenceKinds)[number];
export const sequenceStep = z.object({
  channel: z.enum(sequenceChannels),
  title: z.string().trim().min(1).max(100),
  delay: z.number().int().min(0).max(30),
  body: z.string().trim().max(1000),
}).refine((step) => step.channel === "Call" || !!step.body, { message: "Enter a draft for each email and text step." });
export type CampaignSequenceStep = z.infer<typeof sequenceStep>;
export const sequenceSteps = z.array(sequenceStep).min(1).max(6);
export const defaultNewLeadSteps: CampaignSequenceStep[] = [
  { channel: "Call", title: "Call the new lead", delay: 0, body: "" },
  { channel: "Text", title: "Check in by text", delay: 1, body: "Thanks for reaching out about a mortgage. When is a good time to talk?" },
  { channel: "Email", title: "Follow up on your mortgage inquiry", delay: 2, body: "Let me know if you have questions or would like to talk through your options." },
];
export const defaultCampaignSequenceSteps: Record<CampaignSequenceKind, CampaignSequenceStep[]> = {
  "New Lead": defaultNewLeadSteps,
  "Cold Lead Reactivation": [
    { channel: "Email", title: "Still considering your mortgage options?", delay: 0,
      body: "I’m checking in on our earlier mortgage conversation. If your plans are still on the table, I’m happy to pick up where we left off." },
    { channel: "Call", title: "Call to reconnect", delay: 2, body: "" },
    { channel: "Text", title: "Send a brief reactivation check-in", delay: 3,
      body: "Checking in to see whether your mortgage plans have changed. Let me know if a quick conversation would help." },
  ],
  "Past Client Outreach": [
    { channel: "Call", title: "Check in with the past client", delay: 0, body: "" },
    { channel: "Email", title: "A mortgage check-in", delay: 2,
      body: "I hope things are going well. I’m available if you have questions about your mortgage or would like to talk through future plans." },
    { channel: "Text", title: "Offer a follow-up conversation", delay: 3,
      body: "Let me know if you’d like to set aside a few minutes for a mortgage check-in." },
  ],
};

const version = z.number().int().positive();
export const saveCampaignSequenceInput = z.object({
  type: z.literal("saveCampaignSequence"), campaignId: z.uuid(),
  kind: z.enum(campaignSequenceKinds).default("New Lead"),
  expectedVersion: version.nullable(), expectedTemplateVersion: version.nullable(), steps: sequenceSteps.nullable(),
});
export const recordSequenceMockInput = z.object({
  type: z.literal("recordSequenceMock"), leadId: z.uuid(), version, position: z.number().int().min(0).max(5),
  recipient: z.string().max(320).nullable(),
});
export const changeCampaignSequenceInput = z.object({
  type: z.literal("changeCampaignSequence"), campaignId: z.uuid(), leadId: z.uuid(),
  action: z.enum(["Pause", "Resume"]), revision: z.number().int().nonnegative(),
});

export type CampaignSequenceVersion = { kind: CampaignSequenceKind; version: number; steps: CampaignSequenceStep[] };
export type CampaignSequenceConfig = {
  attachedVersion: number | null;
  attachedKind: CampaignSequenceKind | null;
  latest: Partial<Record<CampaignSequenceKind, CampaignSequenceVersion>>;
};
export type CampaignSequenceProgress = { position: number; title: string; dueAt: string; paused: boolean; channel?: CampaignSequenceStep["channel"] };
export type DueSequenceStep = CampaignSequenceStep & { version: number; position: number; recipient: string | null; waitUntil?: string };

export function sequenceWorkLabel(sequence: CampaignSequenceProgress, now: number, availableAt?: string | null) {
  if (sequence.paused) return "Sequence paused";
  const channel = sequence.channel ?? "Sequence";
  const scheduled = Math.max(Date.parse(sequence.dueAt), availableAt ? Date.parse(availableAt) : 0);
  return `${channel} step ${scheduled > now ? "scheduled" : "due"}`;
}

export function sequenceTaskId(leadId: string, version: number, position: number) {
  return `${leadId}:${version}:${position}`;
}

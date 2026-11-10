import { z } from "zod";

export const sequenceChannels = ["Call", "Email", "Text"] as const;
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

const version = z.number().int().positive();
export const saveCampaignSequenceInput = z.object({
  type: z.literal("saveCampaignSequence"), campaignId: z.uuid(),
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

export type CampaignSequenceConfig = {
  attachedVersion: number | null;
  latest: { version: number; steps: CampaignSequenceStep[] } | null;
};
export type CampaignSequenceProgress = { position: number; title: string; dueAt: string; paused: boolean };
export type DueSequenceStep = CampaignSequenceStep & { version: number; position: number; recipient: string | null };

export function sequenceTaskId(leadId: string, version: number, position: number) {
  return `${leadId}:${version}:${position}`;
}

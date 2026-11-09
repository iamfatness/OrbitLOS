import { z } from "zod";

export const segmentKinds = ["Quiet leads", "Past clients at rate target"] as const;
export const segmentEnrollmentLimit = 100;

export const saveCrmSegmentInput = z.object({
  type: z.literal("saveCrmSegment"), id: z.uuid(), revision: z.number().int().min(0),
  name: z.string().trim().min(1).max(80), kind: z.enum(segmentKinds), quietDays: z.number().int().min(1).max(90),
});
export const enrollCrmSegmentInput = z.object({
  type: z.literal("enrollCrmSegment"), segmentId: z.uuid(), campaignId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export type CrmSegment = Omit<z.infer<typeof saveCrmSegmentInput>, "type">;
export interface SegmentPreview {
  fingerprint: string;
  eligible: number;
  excluded: number;
  rows: {
    id: string;
    name: string;
    owner: string;
    status: "Eligible" | "Opted out" | "Already enrolled" | "Missing valid phone" | "Existing lead" | "Duplicate" | "Follow-up paused" | "Follow-up stopped" | "Lead on hold" | "Reply received";
    detail: string;
  }[];
}

export const pilotSegmentLeadPrefix = (scenarioId: string) => `segment-return:${scenarioId}:`;

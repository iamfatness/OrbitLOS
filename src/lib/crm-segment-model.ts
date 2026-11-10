import { z } from "zod";
import { crmFieldFilter } from "./crm-field-model";
import type { CampaignSequenceKind } from "./campaign-sequence-model";

export const segmentKinds = ["Quiet leads", "Past clients at rate target", "Past clients"] as const;
export const segmentEnrollmentLimit = 100;

export const saveCrmSegmentInput = z.object({
  type: z.literal("saveCrmSegment"), id: z.uuid(), revision: z.number().int().min(0),
  name: z.string().trim().min(1).max(80), kind: z.enum(segmentKinds), quietDays: z.number().int().min(1).max(90),
  customFilter: crmFieldFilter.optional(),
});
export const enrollCrmSegmentInput = z.object({
  type: z.literal("enrollCrmSegment"), segmentId: z.uuid(), campaignId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  selectedIds: z.array(z.string().min(1).max(200)).min(1).max(segmentEnrollmentLimit).optional(),
  previewPage: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
}).refine(({ fingerprint, selectedIds }) => Boolean(fingerprint) === Boolean(selectedIds),
  "Preview the segment and select at least one eligible borrower to enroll.")
  .refine(({ selectedIds }) => !selectedIds || new Set(selectedIds).size === selectedIds.length, "Select each borrower once.");

export type CrmSegment = Omit<z.infer<typeof saveCrmSegmentInput>, "type">;
export function sequenceKindForSegment(kind: CrmSegment["kind"]): CampaignSequenceKind {
  return kind === "Quiet leads" ? "Cold Lead Reactivation" : "Past Client Outreach";
}
export interface SegmentPreview {
  fingerprint: string;
  sequence?: { kind: CampaignSequenceKind; version: number };
  eligible: number;
  excluded: number;
  page: number;
  pages: number;
  rows: {
    id: string;
    name: string;
    owner: string;
    status: "Eligible" | "Opted out" | "Already enrolled" | "Missing valid phone" | "Existing lead" | "Duplicate" | "Follow-up paused" | "Follow-up stopped" | "Lead on hold" | "Reply received";
    detail: string;
  }[];
}

export const pilotSegmentLeadPrefix = (scenarioId: string) => `segment-return:${scenarioId}:`;

import { z } from "zod";
import type { CampaignManagerRecord } from "./campaign-manager-model";
import type { CampaignSequenceStep } from "./campaign-sequence-model";

export const sequencePerformanceMetrics = ["touches", "replies", "stalled"] as const;
const drilldown = z.discriminatedUnion("metric", [
  z.object({ metric: z.enum(sequencePerformanceMetrics), position: z.number().int().min(0).max(5) }),
  z.object({ metric: z.literal("unattributed") }),
]);
export const sequencePerformanceQuery = z.object({
  campaignId: z.string().min(1).max(200),
  version: z.number().int().positive().optional(),
  drilldown: drilldown.optional(),
  page: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
});
export type SequencePerformanceQuery = z.input<typeof sequencePerformanceQuery>;
export type SequenceDrilldown = z.infer<typeof drilldown>;
export type SequencePerformanceMetric = (typeof sequencePerformanceMetrics)[number];
export type SequencePerformancePage = {
  versions: { version: number; enrolled: number }[];
  version: number | null;
  steps: (Pick<CampaignSequenceStep, "title" | "channel"> & Record<SequencePerformanceMetric, number>)[];
  unattributed: number;
  items: (CampaignManagerRecord & { when: string | null })[];
  page: number;
  pages: number;
};

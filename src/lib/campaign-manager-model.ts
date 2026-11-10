import { z } from "zod";
import type { CampaignSequenceKind, CampaignSequenceProgress } from "./campaign-sequence-model";

export const campaignManagerUnavailable = "Campaign manager reporting is available to pilot brokerage admins.";
export const campaignManagerViews = ["overdue", "paused", "replies", "conversions", "optOuts"] as const;
export type CampaignManagerView = (typeof campaignManagerViews)[number];
export const campaignManagerQuery = z.object({
  campaignId: z.string().min(1).max(200),
  view: z.enum(campaignManagerViews).default("overdue"),
  page: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
});

export type CampaignManagerRecord = {
  leadId: string;
  name: string;
  owner: string;
  loanId: string | null;
  archived: boolean;
};
export type CampaignManagerRow = CampaignManagerRecord & {
  overdue: { title: string; dueAt: string }[];
  sequence?: CampaignSequenceProgress & { kind: CampaignSequenceKind; revision: number; held: boolean };
};

export type CampaignManagerPage = {
  counts: Record<CampaignManagerView, number>;
  items: CampaignManagerRow[];
  page: number;
  pages: number;
};

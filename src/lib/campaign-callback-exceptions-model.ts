import { z } from "zod";

export const callbackExceptionUnavailable = "Campaign callback exceptions are available to pilot brokerage admins.";
export const callbackExceptionChanged = "This callback promise changed or is no longer overdue. Refresh callback exceptions before trying again.";
const id = z.string().min(1).max(200);
const cursor = z.object({ dueAt: z.iso.datetime({ precision: 3 }), id });
export const callbackExceptionQuery = z.object({
  campaignId: id.optional(), ownerEmail: z.email().max(254).nullable().optional(), after: cursor.optional(),
});

export type CampaignCallbackExceptionQuery = z.infer<typeof callbackExceptionQuery>;
export type CampaignCallbackException = {
  id: string; leadId: string; campaignId: string; campaignName: string; name: string; owner: string; ownerEmail: string | null;
  dueAt: string; scheduledAt: string | null; needsRecovery: boolean; request: { at: string; actor: string; text: string } | null;
  loanTask?: { loanId: string; taskId: string; dueAt: string };
};
export type CampaignCallbackExceptionPage = { items: CampaignCallbackException[]; next: z.infer<typeof cursor> | null };

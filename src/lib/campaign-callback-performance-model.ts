import { z } from "zod";

export const callbackPerformanceUnavailable = "Campaign callback performance is available to pilot brokerage admins.";
export const callbackPerformanceStatuses = ["On time", "Late", "Closed without attempt", "On hold", "Overdue", "Upcoming"] as const;
const id = z.string().min(1).max(200);
export const carriedCallbackOutcomes = ["Connected", "Left message", "No response"] as const;
export const carriedCallbackInput = z.object({
  type: z.literal("recordCarriedCampaignCallback"), loanId: id, taskId: id,
  dueAt: z.iso.datetime({ precision: 3 }), eventId: z.uuid(),
  outcome: z.enum(carriedCallbackOutcomes), note: z.string().trim().max(500),
});
export type CarriedCallbackInput = z.infer<typeof carriedCallbackInput>;
export const rescheduleCarriedCallbackInput = carriedCallbackInput.pick({ loanId: true, taskId: true, dueAt: true, eventId: true }).extend({
  type: z.literal("rescheduleCarriedCampaignCallback"), revision: z.number().int().nonnegative(),
  callbackAt: z.iso.datetime({ precision: 3 }), reason: z.string().trim().min(1).max(400),
});
export type RescheduleCarriedCallbackInput = z.infer<typeof rescheduleCarriedCallbackInput>;
const cursor = z.object({ at: z.iso.datetime({ precision: 3 }), id });
export const callbackPerformanceQuery = z.object({
  campaignId: id, status: z.enum(callbackPerformanceStatuses).optional(), after: cursor.optional(),
});

export type CallbackPerformanceQuery = z.infer<typeof callbackPerformanceQuery>;
export type CallbackPerformanceStatus = (typeof callbackPerformanceStatuses)[number];
type CallbackEvidence = { id: string; at: string; actor: string; text: string };
export type CallbackPerformancePage = {
  counts: Record<CallbackPerformanceStatus, number>;
  items: { id: string; name: string; owner: string; originalDueAt: string; dueAt: string; closedAt: string | null; closeReason: string | null;
    continuedOnLoan?: boolean; scheduledAt?: string; status: CallbackPerformanceStatus; request: CallbackEvidence | null; attempt: CallbackEvidence | null }[];
  next: z.infer<typeof cursor> | null;
};

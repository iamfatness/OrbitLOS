import { z } from "zod";
import { conversationCursor, type ConversationReplyPage } from "./conversation-model";
import type { LoanProcessing } from "./processing-model";

export const processorQueueUnavailable = "This processing queue is unavailable.";
export const processingExceptions = ["Unassigned", "Stalled handoffs", "Aging conditions"] as const;
export const conditionAgingDays = 7;
const cursor = z.object({ updatedAt: z.iso.datetime(), id: z.string().min(1).max(160), conditionId: z.string().min(1).max(512).optional() });
export const closingWorkloadWindows = ["Past target", "Next 7 days", "Later", "No target", "Closing recorded"] as const;
const workloadCursor = z.object({ date: z.iso.date(), id: z.string().min(1).max(160) });
const workloadFilters = {
  processor: z.union([z.literal(""), z.literal("unassigned"), z.email().max(254)]),
  window: z.enum(closingWorkloadWindows).optional(),
};
const queueFilters = { readyOnly: z.boolean(), exception: z.enum(processingExceptions).optional() };
export const processingViewFilters = z.object({ ...queueFilters, workload: z.object(workloadFilters).optional() })
  .refine(({ readyOnly, exception, workload }) => !(readyOnly && exception) && (!workload || (!readyOnly && !exception)));
export const processorQueueQuery = z.object({
  ...queueFilters, after: cursor.optional(), replyAfter: conversationCursor.optional(),
  workload: z.object({ ...workloadFilters, after: workloadCursor.optional() }).optional(),
}).refine(({ exception, after }) => !after || Boolean(after.conditionId) === (exception === "Aging conditions"))
  .refine(({ readyOnly, exception, replyAfter }) => !replyAfter || (!readyOnly && !exception))
  .refine(({ workload, readyOnly, exception, after, replyAfter }) => !workload || (!readyOnly && !exception && !after && !replyAfter));
export type ProcessorQueueQuery = z.infer<typeof processorQueueQuery>;
export const processingViewChange = z.discriminatedUnion("type", [
  z.object({ type: z.literal("saveView"), id: z.uuid(), name: z.string().trim().min(1).max(80), filters: processingViewFilters }),
  z.object({ type: z.literal("removeView"), id: z.uuid() }),
]);
export type ProcessingViewChange = z.infer<typeof processingViewChange>;
export type SavedProcessingView = { id: string; name: string; filters: z.infer<typeof processingViewFilters> };
export type ClosingWorkloadWindow = (typeof closingWorkloadWindows)[number];
export type ProcessingWorkload = {
  through: string;
  processors: { email: string; name: string; files: number }[];
  windows: { window: ClosingWorkloadWindow; files: number }[];
  next: z.infer<typeof workloadCursor> | null;
};
export type ProcessorQueueFile = z.infer<typeof cursor> & {
  name: string; officer: string; processorName: string; status: LoanProcessing["status"];
  targetDate: string | null; closingDate: string | null;
  assignmentRevision?: number;
  handoffDueAt?: string;
  condition: { count: number; title: string; target: string; action: string; openedAt?: string; lender?: string } | null;
  closing: { count: number; dueDate: string; target?: string } | null;
};
export type ProcessorQueuePage = { checkedAt: string; files: ProcessorQueueFile[]; next: z.infer<typeof cursor> | null; views: SavedProcessingView[];
  handoffHours?: number; replies?: ConversationReplyPage; workload?: ProcessingWorkload };

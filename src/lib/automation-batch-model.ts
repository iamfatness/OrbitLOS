import { z } from "zod";
import type { AutomationAttempt, AutomationEventType } from "./automation-event-model";

export const automationBatchLimit = 10;
const status = z.enum(["Queued", "Failed"]);
const destinationId = z.uuid();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const automationBatchQuery = z.discriminatedUnion("type", [
  z.object({ type: z.literal("preview"), destinationId, status }).strict(),
  z.object({ type: z.literal("run"), destinationId, status, batchId: z.uuid(), fingerprint, failEventId: z.uuid().optional() }).strict(),
  z.object({ type: z.literal("history"), destinationId, before: z.number().int().positive().optional() }).strict(),
  z.object({ type: z.literal("receipt"), destinationId, batchId: z.uuid() }).strict(),
]);
export type AutomationBatchStatus = z.infer<typeof status>;
export type AutomationBatchItem = { eventId: string; eventType: AutomationEventType; occurredAt: string; subscriptionRevision: number; attemptCount: number };
export type AutomationBatchPreview = { kind: "preview"; status: AutomationBatchStatus; items: AutomationBatchItem[]; more: boolean; fingerprint: string };
export type AutomationBatchReceipt = { kind: "receipt"; id: string; at: string; actor: string; status: AutomationBatchStatus;
  destinationName: string; destinationRevision: number; items: (AutomationBatchItem & { attempt: AutomationAttempt })[] };
export type AutomationBatchSummary = Omit<AutomationBatchReceipt, "kind" | "items"> & { succeeded: number; failed: number };
export type AutomationBatchHistory = { kind: "history"; batches: AutomationBatchSummary[]; next: number | null };

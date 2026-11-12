import { z } from "zod";

export const automationEventLabels = {
  "lead.created": "Lead created",
  "application.submitted": "1003 submitted",
  "loan.funded": "Loan funded",
  "loan.funding_updated": "Funding date updated",
  "loan.funding_reversed": "Funding reversed",
} as const;
export const automationStatuses = ["Queued", "Failed", "Simulated"] as const;
export const automationOrigins = ["Direct entry", "Website quote request", "Realtor referral", "Campaign CSV", "Borrower portal", "Funding record"] as const;
export type AutomationEventType = keyof typeof automationEventLabels;
export type AutomationOrigin = (typeof automationOrigins)[number];
export type AutomationStatus = (typeof automationStatuses)[number];
export type AutomationPayload = {
  schemaVersion: 1;
  eventId: string;
  eventType: AutomationEventType;
  occurredAt: string;
  source: AutomationOrigin;
  resource: { kind: "lead" | "loan"; id: string; revision: number };
};
export type AutomationEvent = { payload: AutomationPayload; status: AutomationStatus; attemptCount: number };
export type AutomationAttempt = { number: number; operationId: string; outcome: Exclude<AutomationStatus, "Queued">; at: string; actor: string };
export type AutomationEventDetail = { kind: "event"; event: AutomationEvent; attempts: AutomationAttempt[] };
export type AutomationEventPage = { kind: "events"; events: AutomationEvent[]; next: number | null };
export const automationEventQuery = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), status: z.enum(automationStatuses).optional(), eventType: z.enum(Object.keys(automationEventLabels) as AutomationEventType[]).optional(),
    before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
  z.object({ type: z.literal("detail"), id: z.uuid() }).strict(),
  z.object({ type: z.literal("attempt"), id: z.uuid(), operationId: z.uuid(), attempt: z.number().int().min(0).max(2), simulateFailure: z.boolean() }).strict(),
]);

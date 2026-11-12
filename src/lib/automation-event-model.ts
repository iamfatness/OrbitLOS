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
export const automationRetryDelays = [0, 5, 30] as const;
export type AutomationRetryDelay = (typeof automationRetryDelays)[number];
export const automationHistoryDays = 30;
export const automationDestinationStates = ["Active", "Paused", "Disconnected"] as const;
export type AutomationDestination = { id: string; name: string; eventTypes: AutomationEventType[];
  state: (typeof automationDestinationStates)[number]; revision: number; retryDelayMinutes?: AutomationRetryDelay };
export type AutomationDestinationPage = { kind: "destinations"; destinations: AutomationDestination[]; next: number | null };
export type AutomationEvent = { payload: AutomationPayload; status: AutomationStatus; attemptCount: number; subscriptionRevision?: number; retryAt?: string; archived?: boolean };
export type AutomationAttempt = { number: number; operationId: string; outcome: Exclude<AutomationStatus, "Queued">; at: string; actor: string };
export type AutomationEventDetail = { kind: "event"; event: AutomationEvent; attempts: AutomationAttempt[]; destination?: AutomationDestination; subscription?: AutomationDestination; review?: { actor: string; at: string } };
export type AutomationEventPage = { kind: "events"; events: AutomationEvent[]; next: number | null; destination?: AutomationDestination };
const eventType = z.enum(Object.keys(automationEventLabels) as AutomationEventType[]);
const before = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional();
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const destinationId = z.uuid().optional();
const subscription = {
  name: z.string().trim().min(1).max(80),
  retryDelayMinutes: z.literal(automationRetryDelays).optional(),
  eventTypes: z.array(eventType).min(1).max(Object.keys(automationEventLabels).length)
    .refine(values => new Set(values).size === values.length),
};
const destinationEdit = { id: z.uuid(), operationId: z.uuid(), revision };
export const automationDestinationQuery = z.discriminatedUnion("type", [
  z.object({ type: z.literal("destinations"), before }).strict(),
  z.object({ type: z.literal("destination"), id: z.uuid() }).strict(),
  z.object({ type: z.literal("createDestination"), id: z.uuid(), ...subscription }).strict(),
  z.object({ type: z.literal("editDestination"), ...destinationEdit, ...subscription }).strict(),
  z.object({ type: z.literal("setDestinationState"), ...destinationEdit, state: z.enum(automationDestinationStates) }).strict(),
]);
export const automationEventQuery = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), status: z.enum(automationStatuses).optional(), eventType: eventType.optional(), before, destinationId,
    history: z.enum(["current", "archived"]).optional() }).strict(),
  z.object({ type: z.literal("detail"), id: z.uuid(), destinationId }).strict(),
  z.object({ type: z.literal("acknowledge"), id: z.uuid(), destinationId: z.uuid() }).strict(),
  z.object({ type: z.literal("attempt"), id: z.uuid(), operationId: z.uuid(), attempt: z.number().int().min(0).max(2),
    simulateFailure: z.boolean(), destinationId, destinationRevision: revision.optional() }).strict(),
]);

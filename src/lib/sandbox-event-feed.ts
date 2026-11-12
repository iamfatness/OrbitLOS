import { z } from "zod";
import type { AutomationPayload } from "./automation-event-model";

const eventPageQuery = z.object({
  after: z.uuid().optional(),
  limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/).transform(Number).optional(),
}).strict();

const leadId = "540d565b-1033-4f08-84a9-5e2b06b17e21";
const loanId = "04b56530-a46c-4613-bf2e-0cccac47aa49";
const fictionalEvents: ReadonlyArray<AutomationPayload> = [
  { schemaVersion: 1, eventId: "077b3037-b2fd-4c6a-9505-77295c93c022", eventType: "lead.created",
    occurredAt: "2026-10-05T14:00:00.000Z", source: "Realtor referral", resource: { kind: "lead", id: leadId, revision: 1 } },
  { schemaVersion: 1, eventId: "0583f294-ab39-4589-a56c-1c91ba2ade9c", eventType: "application.submitted",
    occurredAt: "2026-10-06T18:00:00.000Z", source: "Borrower portal", resource: { kind: "loan", id: loanId, revision: 1 } },
  { schemaVersion: 1, eventId: "941c9d0e-a75d-4c7d-b9ca-601ae913c1a6", eventType: "loan.funded",
    occurredAt: "2026-10-30T15:00:00.000Z", source: "Funding record", resource: { kind: "loan", id: loanId, revision: 1 } },
  { schemaVersion: 1, eventId: "2e1aa489-46b7-4298-acb7-ff0bc50e91eb", eventType: "loan.funding_updated",
    occurredAt: "2026-11-02T14:00:00.000Z", source: "Funding record", resource: { kind: "loan", id: loanId, revision: 2 } },
  { schemaVersion: 1, eventId: "b0b3d482-8d7a-4c2c-8d31-3fc4a2063880", eventType: "loan.funding_reversed",
    occurredAt: "2026-11-03T14:00:00.000Z", source: "Funding record", resource: { kind: "loan", id: loanId, revision: 3 } },
];

type SandboxEventPage = {
  mode: "sandbox";
  events: AutomationPayload[];
  nextCursor: string | null;
  hasMore: boolean;
};

export function sandboxEventPage(params: URLSearchParams): SandboxEventPage | { error: "invalid_query" | "invalid_cursor" } {
  if (params.size !== new Set(params.keys()).size) return { error: "invalid_query" };
  const parsed = eventPageQuery.safeParse(Object.fromEntries(params));
  if (!parsed.success) return { error: "invalid_query" };
  const { after, limit = 20 } = parsed.data;
  const previous = after ? fictionalEvents.findIndex(event => event.eventId === after) : -1;
  if (after && previous === -1) return { error: "invalid_cursor" };

  const start = previous + 1;
  const events = structuredClone(fictionalEvents.slice(start, start + limit));
  return {
    mode: "sandbox",
    events,
    nextCursor: events.at(-1)?.eventId ?? after ?? null,
    hasMore: start + events.length < fictionalEvents.length,
  };
}

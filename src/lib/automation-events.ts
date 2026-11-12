import { demoBrokerageId } from "./brokerage-model";
import { automationEventQuery, type AutomationAttempt, type AutomationEvent, type AutomationEventDetail, type AutomationEventPage,
  type AutomationEventType, type AutomationOrigin, type AutomationPayload, type AutomationStatus } from "./automation-event-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

type Source = { eventType: AutomationEventType; kind: "lead" | "loan"; id: string; revision: number; origin: AutomationOrigin };
type Row = { sequence: number; id: string; schemaVersion: 1; eventType: AutomationEventType; resourceKind: Source["kind"]; resourceId: string;
  revision: number; origin: AutomationOrigin; occurredAt: string; status: AutomationStatus; attemptCount: number };
type DeliveryResult = AutomationEventPage | AutomationEventDetail | { error: string };

export function queueAutomationEvent(db: Store, source: Source, at: string) {
  db.prepare(`INSERT INTO automation_events (id, schemaVersion, eventType, resourceKind, resourceId, revision, origin, occurredAt)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?) ON CONFLICT(eventType, resourceKind, resourceId, revision) DO NOTHING`)
    .run(crypto.randomUUID(), source.eventType, source.kind, source.id, source.revision, source.origin, at);
}

function event(row: Row): AutomationEvent {
  const payload: AutomationPayload = {
    schemaVersion: row.schemaVersion, eventId: row.id, eventType: row.eventType, occurredAt: row.occurredAt,
    source: row.origin, resource: { kind: row.resourceKind, id: row.resourceId, revision: row.revision },
  };
  return { payload, status: row.status, attemptCount: row.attemptCount };
}

function detail(db: Store, row: Row): AutomationEventDetail {
  const attempts = db.prepare(`SELECT attempt AS number, operationId, outcome, at, actor
    FROM automation_event_attempts WHERE eventId = ? ORDER BY attempt DESC`).all(row.id) as unknown as AutomationAttempt[];
  return { kind: "event", event: event(row), attempts };
}

export function automationEventWork(db: Store, staff: WorkspaceStaff, input: unknown, now = new Date().toISOString()): DeliveryResult {
  if (staff.brokerage.role !== "Admin") return { error: "Only a brokerage admin can review automation deliveries." };
  const parsed = automationEventQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid automation delivery view." };
  const query = parsed.data;
  if (query.type === "list") {
    const { status, eventType, before } = query;
    const limit = 20;
    const rows = db.prepare(`SELECT * FROM automation_events WHERE 1 = 1
      ${status ? "AND status = ?" : ""} ${eventType ? "AND eventType = ?" : ""} ${before ? "AND sequence < ?" : ""}
      ORDER BY sequence DESC LIMIT ?`).all(...(status ? [status] : []), ...(eventType ? [eventType] : []), ...(before ? [before] : []), limit + 1) as unknown as Row[];
    return { kind: "events", events: rows.slice(0, limit).map(event), next: rows.length > limit ? rows[limit - 1].sequence : null };
  }

  const read = () => db.prepare("SELECT * FROM automation_events WHERE id = ?").get(query.id) as unknown as Row | undefined;
  if (query.type === "detail") {
    const row = read();
    return row ? detail(db, row) : { error: "This event is unavailable in this brokerage." };
  }

  return db.transaction(() => {
    const row = read();
    if (!row) return { error: "This event is unavailable in this brokerage." };
    const existing = db.prepare("SELECT eventId, attempt, outcome, actorEmail FROM automation_event_attempts WHERE operationId = ?").get(query.operationId);
    const outcome = query.simulateFailure ? "Failed" : "Simulated";
    if (existing) {
      return existing.eventId === row.id && existing.attempt === query.attempt + 1 && existing.outcome === outcome && existing.actorEmail === staff.email
        ? detail(db, row) : { error: "This delivery attempt identifier is already in use." };
    }
    if (row.attemptCount !== query.attempt) return { error: "This event changed. Refresh it before trying again." };
    if (row.status === "Simulated") return { error: "This event already has a successful simulation." };
    if (query.simulateFailure && (row.status !== "Queued" || (!staff.brokerage.pilot && staff.brokerage.id !== demoBrokerageId))) {
      return { error: "Failure rehearsal is available for queued events in fictional workspaces." };
    }
    const attempt = row.attemptCount + 1;
    db.prepare(`INSERT INTO automation_event_attempts (eventId, attempt, operationId, outcome, actorEmail, actor, at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(row.id, attempt, query.operationId, outcome, staff.email, staff.name, now);
    db.prepare("UPDATE automation_events SET status = ?, attemptCount = ? WHERE id = ?").run(outcome, attempt, row.id);
    return detail(db, { ...row, status: outcome, attemptCount: attempt });
  });
}

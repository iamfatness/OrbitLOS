import { automationDestination } from "./automation-destinations";
import { demoBrokerageId } from "./brokerage-model";
import { automationEventQuery, type AutomationAttempt, type AutomationDestination, type AutomationEvent, type AutomationEventDetail, type AutomationEventPage,
  type AutomationEventType, type AutomationOrigin, type AutomationPayload, type AutomationStatus } from "./automation-event-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

type Source = { eventType: AutomationEventType; kind: "lead" | "loan"; id: string; revision: number; origin: AutomationOrigin };
type Row = { sequence: number; id: string; schemaVersion: 1; eventType: AutomationEventType; resourceKind: Source["kind"]; resourceId: string;
  revision: number; origin: AutomationOrigin; occurredAt: string; status: AutomationStatus; attemptCount: number; subscriptionRevision?: number };
type DeliveryResult = AutomationEventPage | AutomationEventDetail | { error: string };

export function queueAutomationEvent(db: Store, source: Source, at: string) {
  const inserted = db.prepare(`INSERT INTO automation_events (id, schemaVersion, eventType, resourceKind, resourceId, revision, origin, occurredAt)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?) ON CONFLICT(eventType, resourceKind, resourceId, revision) DO NOTHING RETURNING sequence`)
    .get(crypto.randomUUID(), source.eventType, source.kind, source.id, source.revision, source.origin, at);
  if (!inserted) return;
  db.prepare(`INSERT INTO automation_destination_events (destinationId, eventSequence, eventType, subscriptionRevision)
    SELECT destination.id, ?, ?, destination.revision FROM automation_destinations destination
    WHERE destination.state IN ('Active', 'Paused') AND EXISTS (SELECT 1 FROM json_each(destination.eventTypes) WHERE value = ?)`)
    .run(inserted.sequence, source.eventType, source.eventType);
}

function event(row: Row): AutomationEvent {
  const payload: AutomationPayload = {
    schemaVersion: row.schemaVersion, eventId: row.id, eventType: row.eventType, occurredAt: row.occurredAt,
    source: row.origin, resource: { kind: row.resourceKind, id: row.resourceId, revision: row.revision },
  };
  return { payload, status: row.status, attemptCount: row.attemptCount, subscriptionRevision: row.subscriptionRevision };
}

function detail(db: Store, row: Row, destination?: AutomationDestination): AutomationEventDetail {
  const attempts = (destination ? db.prepare(`SELECT attempt AS number, operationId, outcome, at, actor
    FROM automation_destination_attempts WHERE destinationId = ? AND eventSequence = ? ORDER BY attempt DESC`).all(destination.id, row.sequence)
    : db.prepare(`SELECT attempt AS number, operationId, outcome, at, actor
    FROM automation_event_attempts WHERE eventId = ? ORDER BY attempt DESC`).all(row.id)) as unknown as AutomationAttempt[];
  const route = destination && row.subscriptionRevision !== undefined && db.prepare("SELECT snapshot FROM automation_destination_history WHERE destinationId = ? AND revision = ?")
    .get(destination.id, row.subscriptionRevision)?.snapshot;
  const subscription = typeof route === "string" ? JSON.parse(route) as AutomationDestination : undefined;
  return { kind: "event", event: event(row), attempts, destination, subscription };
}

export function automationEventWork(db: Store, staff: WorkspaceStaff, input: unknown, now = new Date().toISOString()): DeliveryResult {
  if (staff.brokerage.role !== "Admin") return { error: "Only a brokerage admin can review automation deliveries." };
  const parsed = automationEventQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid automation delivery view." };
  const query = parsed.data;
  const destination = query.destinationId ? automationDestination(db, query.destinationId) : undefined;
  if (query.destinationId && !destination) return { error: "This destination is unavailable in this brokerage." };

  const scope = destination ? [destination.id] : [];
  const from = destination ? `SELECT e.sequence, e.id, e.schemaVersion, e.eventType, e.resourceKind, e.resourceId, e.revision, e.origin, e.occurredAt,
    d.status, d.attemptCount, d.subscriptionRevision FROM automation_destination_events d
    JOIN automation_events e ON e.sequence = d.eventSequence WHERE d.destinationId = ?` : "SELECT e.* FROM automation_events e WHERE 1 = 1";
  if (query.type === "list") {
    const { status, eventType, before } = query;
    const limit = 20;
    const filterAlias = destination ? "d" : "e";
    const cursor = destination ? "d.eventSequence" : "e.sequence";
    const rows = db.prepare(`${from} ${status ? `AND ${filterAlias}.status = ?` : ""} ${eventType ? `AND ${filterAlias}.eventType = ?` : ""}
      ${before ? `AND ${cursor} < ?` : ""} ORDER BY ${cursor} DESC LIMIT ?`)
      .all(...scope, ...(status ? [status] : []), ...(eventType ? [eventType] : []), ...(before ? [before] : []), limit + 1) as unknown as Row[];
    return { kind: "events", events: rows.slice(0, limit).map(event), next: rows.length > limit ? rows[limit - 1].sequence : null, destination };
  }

  const read = () => db.prepare(`${from} AND e.id = ?`).get(...scope, query.id) as unknown as Row | undefined;
  if (query.type === "detail") {
    const row = read();
    return row ? detail(db, row, destination) : { error: "This event is unavailable in this delivery queue." };
  }

  return db.transaction(() => {
    const row = read();
    if (!row) return { error: "This event is unavailable in this delivery queue." };
    const existing = destination ? db.prepare(`SELECT eventSequence, destinationId, attempt, outcome, actorEmail
      FROM automation_destination_attempts WHERE operationId = ?`).get(query.operationId)
      : db.prepare("SELECT eventId, attempt, outcome, actorEmail FROM automation_event_attempts WHERE operationId = ?").get(query.operationId);
    const outcome = query.simulateFailure ? "Failed" : "Simulated";
    if (existing) {
      const sameEvent = destination ? existing.eventSequence === row.sequence && existing.destinationId === destination.id : existing.eventId === row.id;
      return sameEvent && existing.attempt === query.attempt + 1 && existing.outcome === outcome && existing.actorEmail === staff.email
        ? detail(db, row, destination) : { error: "This delivery attempt identifier is already in use." };
    }
    if (destination?.state === "Disconnected") return { error: "This destination is disconnected. Its delivery history is read-only." };
    if (destination?.state === "Paused") return { error: "Resume this destination before simulating a delivery." };
    if (destination?.revision !== query.destinationRevision) return { error: "This destination changed. Refresh the event before trying again." };
    if (row.attemptCount !== query.attempt) return { error: "This event changed. Refresh it before trying again." };
    if (row.status === "Simulated") return { error: "This event already has a successful simulation." };
    if (query.simulateFailure && (row.status !== "Queued" || (!staff.brokerage.pilot && staff.brokerage.id !== demoBrokerageId))) {
      return { error: "Failure rehearsal is available for queued events in fictional workspaces." };
    }
    const attempt = row.attemptCount + 1;
    if (destination) {
      db.prepare(`INSERT INTO automation_destination_attempts (destinationId, eventSequence, attempt, operationId, outcome, actorEmail, actor, at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(destination.id, row.sequence, attempt, query.operationId, outcome, staff.email, staff.name, now);
      db.prepare(`UPDATE automation_destination_events SET status = ?, attemptCount = ? WHERE destinationId = ? AND eventSequence = ?`)
        .run(outcome, attempt, destination.id, row.sequence);
    } else {
      db.prepare(`INSERT INTO automation_event_attempts (eventId, attempt, operationId, outcome, actorEmail, actor, at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(row.id, attempt, query.operationId, outcome, staff.email, staff.name, now);
      db.prepare("UPDATE automation_events SET status = ?, attemptCount = ? WHERE id = ?").run(outcome, attempt, row.id);
    }
    return detail(db, { ...row, status: outcome, attemptCount: attempt }, destination);
  });
}

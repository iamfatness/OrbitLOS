import { createHash } from "node:crypto";
import { automationBatchLimit, automationBatchQuery, type AutomationBatchHistory, type AutomationBatchItem,
  type AutomationBatchPreview, type AutomationBatchReceipt, type AutomationBatchStatus } from "./automation-batch-model";
import { automationDestination } from "./automation-destinations";
import type { AutomationDestination } from "./automation-event-model";
import { writeDestinationAttempt } from "./automation-events";
import { demoBrokerageId } from "./brokerage-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

type Row = AutomationBatchItem & { eventSequence: number };
type BatchResult = AutomationBatchHistory | AutomationBatchPreview | AutomationBatchReceipt | { error: string };

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stale = "The queue changed. Preview the current batch before running it.";
const readOnly = "Resume this destination before running a batch.";

function preview(db: Store, destination: AutomationDestination, status: AutomationBatchStatus) {
  const pending = db.prepare(`SELECT e.id AS eventId, d.eventType, e.occurredAt, d.subscriptionRevision, d.attemptCount, d.eventSequence
    FROM automation_destination_events d JOIN automation_events e ON e.sequence = d.eventSequence
    WHERE d.destinationId = ? AND d.status = ? ORDER BY d.eventSequence LIMIT ?`).all(destination.id, status, automationBatchLimit + 1) as unknown as Row[];
  const rows = pending.slice(0, automationBatchLimit);
  const items = rows.map(({ eventId, eventType, occurredAt, subscriptionRevision, attemptCount }) =>
    ({ eventId, eventType, occurredAt, subscriptionRevision, attemptCount }));
  return { rows, items, more: pending.length > automationBatchLimit, fingerprint: digest([destination.id, destination.revision, status, items]) };
}

export function automationBatchWork(db: Store, staff: WorkspaceStaff, input: unknown, now = new Date().toISOString()): BatchResult {
  if (staff.brokerage.role !== "Admin") return { error: "Only a brokerage admin can manage delivery batches." };
  const parsed = automationBatchQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid batch action." };
  const query = parsed.data;
  const destination = automationDestination(db, query.destinationId);
  if (!destination) return { error: "This destination is unavailable in this brokerage." };

  if (query.type === "history") {
    const { before } = query;
    const limit = 10;
    const rows = db.prepare(`SELECT sequence, id, at, actor, status, destinationName, destinationRevision, succeeded, failed
      FROM automation_batches WHERE destinationId = ? ${before ? "AND sequence < ?" : ""}
      ORDER BY sequence DESC LIMIT ?`).all(destination.id, ...(before ? [before] : []), limit + 1) as unknown as
      (AutomationBatchHistory["batches"][number] & { sequence: number })[];
    return { kind: "history", batches: rows.slice(0, limit).map(({ id, at, actor, status, destinationName, destinationRevision, succeeded, failed }) =>
      ({ id, at, actor, status, destinationName, destinationRevision, succeeded, failed })), next: rows.length > limit ? rows[limit - 1].sequence : null };
  }
  if (query.type === "receipt") {
    const saved = db.prepare("SELECT receipt FROM automation_batches WHERE destinationId = ? AND id = ?").get(destination.id, query.batchId);
    return typeof saved?.receipt === "string" ? JSON.parse(saved.receipt) as AutomationBatchReceipt : { error: "This batch receipt is unavailable." };
  }
  if (query.type === "preview") {
    if (destination.state !== "Active") return { error: readOnly };
    const { items, more, fingerprint } = preview(db, destination, query.status);
    return { kind: "preview", status: query.status, items, more, fingerprint };
  }

  return db.transaction(() => {
    const request = digest(query);
    const prior = db.prepare("SELECT destinationId, actorEmail, request, receipt FROM automation_batches WHERE id = ?").get(query.batchId);
    if (prior) {
      return prior.destinationId === destination.id && prior.actorEmail === staff.email && prior.request === request && typeof prior.receipt === "string"
        ? JSON.parse(prior.receipt) as AutomationBatchReceipt : { error: "This batch identifier is already in use." };
    }
    if (destination.state !== "Active") return { error: readOnly };
    const checked = preview(db, destination, query.status);
    if (checked.fingerprint !== query.fingerprint || !checked.rows.length) return { error: stale };
    if (query.failEventId && (query.status !== "Queued" || !checked.items.some(item => item.eventId === query.failEventId) ||
        (!staff.brokerage.pilot && staff.brokerage.id !== demoBrokerageId))) {
      return { error: "Choose a queued event from this batch in a fictional workspace to rehearse a failure." };
    }
    const receipt: AutomationBatchReceipt = { kind: "receipt", id: query.batchId, at: now, actor: staff.name,
      status: query.status, destinationName: destination.name, destinationRevision: destination.revision,
      items: checked.rows.map(({ eventSequence }, index) => {
        const item = checked.items[index];
        const attempt = writeDestinationAttempt(db, destination.id, eventSequence, item.attemptCount + 1, crypto.randomUUID(),
          item.eventId === query.failEventId ? "Failed" : "Simulated", staff, now);
        return { ...item, attempt };
      }) };
    const failed = receipt.items.filter(item => item.attempt.outcome === "Failed").length;
    db.prepare(`INSERT INTO automation_batches
      (id, destinationId, destinationName, destinationRevision, actorEmail, actor, status, at, request, receipt, succeeded, failed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(receipt.id, destination.id, destination.name, destination.revision,
      staff.email, staff.name, receipt.status, now, request, JSON.stringify(receipt), receipt.items.length - failed, failed);
    return receipt;
  });
}

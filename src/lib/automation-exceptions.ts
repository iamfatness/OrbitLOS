import { automationDeliveryJoins, automationHistoryCutoff, automationRetryAt } from "./automation-delivery-policy";
import { deliveryExceptionQuery, type DeliveryException, type DeliveryExceptionPage } from "./automation-exception-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const deliverySource = `FROM automation_destinations target
  JOIN automation_destination_events d ON d.destinationId = target.id
  ${automationDeliveryJoins}`;
const failed = "target.state IN ('Active', 'Paused') AND d.status = 'Failed'";
const ready = `d.attemptCount = 1 AND target.state = 'Active' AND (${automationRetryAt} IS NULL OR ${automationRetryAt} <= ?)`;
const exhausted = `d.attemptCount = 2 AND a.at > ? AND NOT EXISTS (
  SELECT 1 FROM automation_delivery_reviews review WHERE review.destinationId = d.destinationId AND review.eventSequence = d.eventSequence)`;
const waiting = `d.attemptCount = 1 AND (target.state = 'Paused' OR ${automationRetryAt} > ?)`;
const attention = `(${ready}) OR (${exhausted})`;
const unavailable = "Delivery exceptions are unavailable.";

function canRead(staff: WorkspaceStaff | null, brokerageId: string) {
  return staff?.brokerage.role === "Admin" && staff.brokerage.id === brokerageId;
}

export function countDeliveryExceptions(db: Store, staff: WorkspaceStaff, brokerageId: string, now: string, cap: number) {
  if (!canRead(staff, brokerageId)) return undefined;
  const row = db.prepare(`SELECT count(*) AS total FROM (SELECT 1 ${deliverySource} WHERE ${failed} AND (${attention}) LIMIT ?)`)
    .get(now, automationHistoryCutoff(now), cap);
  return Number(row?.total ?? 0);
}

export function readDeliveryExceptions(db: Store, input: unknown, staff: WorkspaceStaff, brokerageId: string,
  now = new Date().toISOString()): DeliveryExceptionPage | { error: string } {
  if (!canRead(staff, brokerageId)) return { error: unavailable };
  const parsed = deliveryExceptionQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid delivery exception view." };
  const { view, after } = parsed.data;
  const limit = 15;
  const rows = db.prepare(`SELECT d.eventSequence AS sequence, e.id AS eventId, d.destinationId, target.name AS destinationName,
    d.eventType, a.at AS failedAt, ${automationRetryAt} AS retryAt,
    CASE WHEN d.attemptCount = 2 THEN 'Retry exhausted' WHEN target.state = 'Paused' THEN 'Destination paused'
      WHEN ${automationRetryAt} > ? THEN 'Retry scheduled' ELSE 'Retry ready' END AS status
    ${deliverySource} JOIN automation_events e ON e.sequence = d.eventSequence
    WHERE ${failed} AND (${view === "waiting" ? waiting : attention})
    ${after ? "AND (d.eventSequence < ? OR (d.eventSequence = ? AND d.destinationId > ?))" : ""}
    ORDER BY d.eventSequence DESC, d.destinationId LIMIT ?`)
    .all(now, now, ...(view === "attention" ? [automationHistoryCutoff(now)] : []),
      ...(after ? [after.sequence, after.sequence, after.destinationId] : []), limit + 1) as unknown as (DeliveryException & { sequence: number })[];
  const last = rows[limit - 1];
  return { items: rows.slice(0, limit).map(({ eventId, destinationId, destinationName, eventType, failedAt, retryAt, status }) =>
      ({ eventId, destinationId, destinationName, eventType, failedAt, retryAt, status })),
    next: rows.length > limit ? { sequence: last.sequence, destinationId: last.destinationId } : null };
}

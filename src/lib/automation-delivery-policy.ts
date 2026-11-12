import { automationHistoryDays } from "./automation-event-model";

// The destination subscription and most recent attempt are both indexed by delivery.
export const automationDeliveryJoins = `
  JOIN automation_destination_history h ON h.destinationId = d.destinationId AND h.revision = d.subscriptionRevision
  LEFT JOIN automation_destination_attempts a ON a.destinationId = d.destinationId
    AND a.eventSequence = d.eventSequence AND a.attempt = d.attemptCount`;

export const automationRetryAt = `CASE WHEN d.status = 'Failed' AND d.attemptCount = 1
  AND json_extract(h.snapshot, '$.retryDelayMinutes') > 0
  THEN strftime('%Y-%m-%dT%H:%M:%fZ', a.at, '+' || json_extract(h.snapshot, '$.retryDelayMinutes') || ' minutes') END`;

export const automationClosedAt = `CASE WHEN d.status = 'Simulated' OR d.attemptCount = 2 THEN a.at END`;

export function automationHistoryCutoff(now: string) {
  return new Date(Date.parse(now) - automationHistoryDays * 86_400_000).toISOString();
}

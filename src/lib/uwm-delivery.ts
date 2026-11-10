import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { uwmDeliveryInput, uwmDeliveryUnavailable, type UwmDeliveryEvent, type UwmDeliveryPage } from "./uwm-delivery-model";
import { loanAccess } from "./workspace-access";

const pageSize = 20;

export function readUwmDelivery(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string): UwmDeliveryPage | { error: string } {
  const parsed = uwmDeliveryInput.safeParse(input);
  if (!parsed.success || !staff || staff.brokerage.id !== brokerageId || !loanAccess(db, staff, parsed.data.loanId)) {
    return { error: uwmDeliveryUnavailable };
  }
  const { loanId, submissionId, before } = parsed.data;
  const file = db.prepare("SELECT externalId FROM submissions WHERE id = ? AND loanId = ? AND lender = 'UWM' AND syncedAt IS NOT NULL")
    .get(submissionId, loanId);
  if (!file) return { error: uwmDeliveryUnavailable };

  const rows = db.prepare(`WITH
    file_context AS (SELECT ? AS id, ? AS loanId, ? AS reference),
    app_events AS (
      SELECT '1003:' || version.revision AS id, coalesce(accepted.reconciledAt, version.uwmSentAt) AS receivedAt,
        CASE WHEN accepted.reconciledAt IS NULL THEN '1003 acknowledged' ELSE 'Original 1003 receipt recovered' END AS title,
        'Submitted 1003 revision ' || version.revision AS detail, version.uwmReceipt AS receipt, NULL AS conditionId,
        version.uwmSentAt AS occurredAt
      FROM file_context file JOIN applications app ON app.loanId = file.loanId AND app.uwmReference = file.reference
      JOIN application_versions version ON version.loanId = app.loanId
      LEFT JOIN mock_uwm_acceptances accepted ON accepted.loanId = version.loanId AND accepted.revision = version.revision
        AND accepted.receipt = version.uwmReceipt
      WHERE version.uwmReceipt IS NOT NULL AND version.uwmSentAt IS NOT NULL
      UNION ALL
      SELECT 'attempt:' || accepted.revision, accepted.attemptedAt, '1003 acknowledgment missing',
        'Submitted 1003 revision ' || accepted.revision || ' · receipt lookup required', NULL, NULL, NULL
      FROM file_context file JOIN mock_uwm_acceptances accepted ON accepted.loanId = file.loanId AND accepted.reference = file.reference
    ),
    document_events AS (
      SELECT 'document:' || delivery.receipt AS id, delivery.sentAt AS receivedAt,
        'Condition document acknowledged' AS title, request.kind || ' · document revision ' || coalesce(delivery.documentRevision, 'unrecorded') AS detail,
        delivery.receipt, request.conditionId, NULL AS occurredAt
      FROM file_context file JOIN document_requests request ON request.submissionId = file.id
      JOIN uwm_document_deliveries delivery ON delivery.requestId = request.id
      UNION ALL
      SELECT 'document:' || delivery.receipt, delivery.sentAt, 'Prior condition document acknowledged',
        request.kind || ' · document revision ' || coalesce(delivery.documentRevision, 'unrecorded'), delivery.receipt, request.conditionId, NULL
      FROM file_context file JOIN document_requests request ON request.submissionId = file.id
      JOIN uwm_document_delivery_history delivery ON delivery.requestId = request.id
      UNION ALL
      SELECT 'failure:' || failed.requestId || ':' || failed.revision, failed.failedAt, 'Condition document delivery failed',
        request.kind || ' · document revision ' || failed.revision, NULL, request.conditionId, NULL
      FROM file_context file JOIN document_requests request ON request.submissionId = file.id
      JOIN mock_delivery_failures failed ON failed.requestId = request.id
    ),
    condition_events AS (
      SELECT 'condition:' || event.id AS id, event.receivedAt,
        CASE WHEN event.outcome = 'Ignored stale' THEN 'Older condition update ignored'
          WHEN event.state = 'Cleared' THEN 'Condition cleared'
          WHEN event.version > 1 THEN 'Condition reopened' ELSE 'Condition open' END AS title,
        event.category || ' · version ' || event.version || ' · ' || event.state ||
          CASE WHEN event.outcome = 'Ignored stale' THEN ' · newer condition state kept' ELSE '' END AS detail,
        NULL AS receipt, event.conditionId, event.occurredAt
      FROM file_context file JOIN mock_uwm_condition_events event ON event.submissionId = file.id
      UNION ALL
      SELECT 'duplicate:' || event.id, event.lastDuplicateAt, 'Duplicate condition update recognized',
        event.category || ' · version ' || event.version || ' · ' || event.state || ' · ' || event.duplicates ||
          CASE WHEN event.duplicates = 1 THEN ' repeat delivery' ELSE ' repeat deliveries' END,
        NULL, event.conditionId, event.occurredAt
      FROM file_context file JOIN mock_uwm_condition_events event ON event.submissionId = file.id WHERE event.lastDuplicateAt IS NOT NULL
      UNION ALL
      SELECT 'status:' || alert.id, alert.detectedAt, 'Lender status changed', alert.message, NULL, NULL, NULL
      FROM file_context file JOIN uwm_alerts alert ON alert.submissionId = file.id WHERE alert.kind = 'Status changed'
    )
    SELECT * FROM (SELECT * FROM app_events UNION ALL SELECT * FROM document_events UNION ALL SELECT * FROM condition_events)
    ${before ? "WHERE (receivedAt, id) < (?, ?)" : ""} ORDER BY receivedAt DESC, id DESC LIMIT ?`)
    .all(submissionId, loanId, file.externalId, ...(before ? [before.receivedAt, before.id] : []), pageSize + 1) as unknown as UwmDeliveryEvent[];
  const events = rows.slice(0, pageSize);
  const last = events.at(-1);
  return { events, next: last && rows.length > pageSize ? { id: last.id, receivedAt: last.receivedAt } : null };
}

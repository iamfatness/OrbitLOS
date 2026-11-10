import { addApplicationActivity } from "./applications";
import { conditionEvidenceChanged, conditionEvidenceKey, type ReuseConditionEvidence } from "./condition-evidence-model";
import type { Condition } from "./model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const linkedMessage = "Accepted evidence linked to the condition. Record lender delivery when ready.";

// The caller has checked loan access and owns the workspace write transaction.
export function reuseConditionEvidence(db: Store, input: ReuseConditionEvidence, staff: WorkspaceStaff | null, now: string) {
  const { loanId, submissionId, conditionId, linkId, conditionKey, target, source } = input;
  const selection = JSON.stringify({ submissionId, conditionId, conditionKey, target, source });
  const prior = db.prepare(`SELECT request.loanId, evidence.selection FROM condition_document_sources evidence
    JOIN document_requests request ON request.id = evidence.requestId WHERE evidence.id = ?`).get(linkId);
  if (prior) return prior.loanId === loanId && prior.selection === selection ? { message: linkedMessage } : { error: "Start a new evidence link for this selection." };
  const submission = db.prepare("SELECT lender, conditions, syncedAt FROM submissions WHERE id = ? AND loanId = ?").get(submissionId, loanId);
  const condition = submission && (JSON.parse(String(submission.conditions)) as Condition[]).find((item) => item.id === conditionId);
  if (!condition || condition.satisfiedAt || (submission.syncedAt ? String(submission.lender).toUpperCase() !== "UWM" : !condition.manual) ||
    conditionEvidenceKey(condition) !== conditionKey) return { error: conditionEvidenceChanged };
  const pending = db.prepare(`SELECT request.id, request.kind, request.status, request.submittedAt, request.recipient, request.revision,
    files.objectId, files.pendingId FROM document_requests request LEFT JOIN document_files files ON files.requestId = request.id
    WHERE request.loanId = ? AND request.submissionId = ? AND request.conditionId = ?`).get(loanId, submissionId, conditionId);
  if ((pending?.id ?? null) !== (target?.id ?? null) || (pending?.revision ?? null) !== (target?.revision ?? null) ||
    (pending && (pending.status !== "Requested" || pending.submittedAt || pending.objectId || pending.pendingId))) return { error: conditionEvidenceChanged };
  const accepted = db.prepare(`SELECT request.kind, request.recipient, request.submittedAt, files.objectId, files.uploadedAt, files.uploadMode,
    approval.actor AS reviewedBy, approval.at AS reviewedAt
    FROM document_requests request LEFT JOIN document_files files ON files.requestId = request.id
    LEFT JOIN document_acceptances approval ON approval.requestId = request.id AND approval.revision = request.revision
    WHERE request.id = ? AND request.loanId = ? AND request.revision = ? AND request.status = 'Accepted' AND request.submittedAt IS NOT NULL
      AND files.pendingId IS NULL AND coalesce(files.failed, 0) = 0
      AND (files.objectId IS NULL OR files.uploadedAt IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM condition_document_sources reuse WHERE reuse.requestId = request.id AND reuse.revision = request.revision)
      AND NOT EXISTS (SELECT 1 FROM document_file_cleanup cleanup WHERE cleanup.objectId = files.objectId)`)
    .get(source.id, loanId, source.revision);
  if (!accepted || (pending && (accepted.kind !== pending.kind || accepted.recipient !== pending.recipient))) {
    return { error: "Choose the current accepted revision from the same loan and match the checklist’s document type and borrower." };
  }
  const requestId = target?.id ?? linkId;
  const revision = (target?.revision ?? 0) + 1;
  if (target) {
    db.prepare("UPDATE document_requests SET status = 'Accepted', submittedAt = ?, revision = ? WHERE id = ?")
      .run(accepted.submittedAt, revision, requestId);
  } else {
    db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, status, submittedAt, revision, recipient, submissionId, conditionId)
      VALUES (?, ?, ?, 'Accepted document linked by your loan team.', ?, 'Accepted', ?, ?, ?, ?, ?)`)
      .run(requestId, loanId, accepted.kind, now, accepted.submittedAt, revision, accepted.recipient, submissionId, conditionId);
  }
  db.prepare(`INSERT INTO condition_document_sources (id, requestId, revision, sourceId, sourceRevision, kind, reviewedAt, reviewedBy, linkedAt, linkedBy, objectId, selection)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(linkId, requestId, revision, source.id, source.revision, accepted.kind, accepted.reviewedAt, accepted.reviewedBy,
      now, staff?.name ?? "Demo staff", accepted.objectId, selection);
  if (accepted.objectId) {
    db.prepare(`INSERT INTO document_files (requestId, objectId, uploadedAt, attemptedAt, uploadMode) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(requestId) DO UPDATE SET objectId = excluded.objectId, uploadedAt = excluded.uploadedAt, uploadMode = excluded.uploadMode, failed = 0`)
      .run(requestId, accepted.objectId, accepted.uploadedAt, Date.parse(now), accepted.uploadMode);
  }
  addApplicationActivity(db, loanId, `Reused accepted evidence · ${accepted.kind} revision ${source.revision} · ${submission.lender} · ${condition.category}`, now);
  accessEvent(db, staff, "Linked accepted evidence to condition", linkId, now);
  return { message: linkedMessage };
}

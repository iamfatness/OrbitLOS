import { easternDate, easternDayStart } from "./client-retention";
import { recoveryBatchLimit, playbookRunsUnavailable, type DocumentRecoveryCandidate, type DocumentRecoveryResult,
  type DocumentReminderRun, type DocumentReminderSchedule, type PlaybookRunQuery, type PlaybookRunResult } from "./playbook-run-model";
import { readPlaybook } from "./playbooks";
import { shiftReportDate } from "./report-date-range";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const batchSize = 20;
const firstCheckDelay = 5_000;
const continuationDelay = 60_000;
const blockedPreviewLimit = 5;
const outstanding = `document.status IN ('Requested', 'Needs replacement')`;
const activeFile = `loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')`;
const openLink = `application.submittedAt IS NOT NULL AND CASE WHEN document.recipient = 'Co-borrower'
  THEN CASE WHEN joint.submittedAt IS NOT NULL AND joint.revokedAt IS NULL THEN joint.expiresAt END
  ELSE CASE WHEN application.revokedAt IS NULL THEN application.expiresAt END END > ?`;
const recipientName = `CASE WHEN document.recipient = 'Co-borrower'
  THEN coalesce(nullif(json_extract(joint.draft, '$.identity.fields.name'), ''), 'Co-borrower') ELSE contact.name END`;
const idleUpload = `NOT EXISTS (SELECT 1 FROM document_files file WHERE file.requestId = document.id AND file.pendingUntil > ?)`;
const obsolete = `(document.revision <> run.documentRevision OR document.deadlineRevision <> run.deadlineRevision
  OR document.dueOn IS NOT run.dueOn OR NOT (${outstanding}) OR loan.stage IN ('Funded', 'Closed') OR loan.disposition IN ('Withdrawn', 'Lost'))`;
const changed = "The document, deadline, or loan changed. This reminder is no longer current.";
const status = `CASE WHEN run.status = 'Failed' AND ${obsolete} THEN 'Superseded' ELSE run.status END`;
const eligibleOn = "coalesce(run.eligibleOn, run.dueOn)";
const blocked = `CASE WHEN NOT (${activeFile}) THEN 'Resume the loan before retrying this reminder.'
  WHEN NOT coalesce((${openLink}), 0) THEN 'The borrower needs a current submitted application and an active link.'
  WHEN NOT (${idleUpload}) THEN 'The borrower has a PDF upload in progress.'
  WHEN ${eligibleOn} > ? THEN 'This reminder is not eligible yet.' END`;
const joins = `FROM document_reminder_runs run JOIN document_requests document ON document.id = run.requestId
  JOIN loans loan ON loan.id = document.loanId JOIN contacts contact ON contact.id = loan.contactId
  LEFT JOIN applications application ON application.loanId = loan.id
  LEFT JOIN joint_applications joint ON joint.loanId = loan.id`;

type ReminderAttempt = { id: string; attemptCount: number };
function recordMockAttempt(db: Store, run: ReminderAttempt, mode: "Trigger" | "Retry", operationId: string, actor: string, at: string, interrupted: boolean) {
  const state = interrupted ? "Failed" : "Completed";
  const receipt = interrupted ? null : `MOCK-DOC-${crypto.randomUUID()}`;
  const reason = interrupted ? "The fictional reminder was interrupted before a mock receipt was recorded." : "Mock reminder recorded.";
  const attempt = run.attemptCount + 1;
  db.prepare(`INSERT INTO document_reminder_attempts (runId, attempt, operationId, mode, status, reason, actor, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(run.id, attempt, operationId, mode, state, reason, actor, at);
  db.prepare("UPDATE document_reminder_runs SET status = ?, reason = ?, receipt = ?, attemptCount = ? WHERE id = ?")
    .run(state, reason, receipt, attempt, run.id);
  return state;
}

function checkResult(processed: number, interrupted: number, more: boolean): PlaybookRunResult {
  const completed = processed - interrupted;
  const summary = processed ? `${completed} mock ${completed === 1 ? "reminder" : "reminders"} recorded${interrupted ? ` · ${interrupted} interrupted` : ""}.` : "No new document reminders are due.";
  return { kind: "document-check", processed, interrupted, more, message: `${summary}${more ? " Run another batch to check more due reminders." : ""}` };
}

function processReminderBatch(db: Store, now: Date, operationId: string, actor: string, simulate = false) {
  const at = now.toISOString();
  const { documentReminderOffsetDays: offsetDays } = readPlaybook(db);
  const dueThrough = shiftReportDate(easternDate(now), -offsetDays);
  const due = db.prepare(`SELECT document.id, document.revision, document.deadlineRevision, document.dueOn
      FROM document_requests document CROSS JOIN loans loan ON loan.id = document.loanId
      CROSS JOIN applications application ON application.loanId = loan.id
      LEFT JOIN joint_applications joint ON joint.loanId = loan.id
      WHERE ${outstanding} AND document.dueOn IS NOT NULL AND document.dueOn <= ? AND ${activeFile}
        AND ${openLink} AND ${idleUpload} AND NOT EXISTS (SELECT 1 FROM document_reminder_runs existing
          WHERE existing.requestId = document.id AND existing.documentRevision = document.revision AND existing.deadlineRevision = document.deadlineRevision)
      ORDER BY document.dueOn, document.id LIMIT ?`).all(dueThrough, at, now.getTime(), batchSize + 1);
  const batch = due.slice(0, batchSize);
  for (const [index, document] of batch.entries()) {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO document_reminder_runs (id, requestId, documentRevision, deadlineRevision, dueOn, eligibleOn, timingOffsetDays, status, reason, attemptCount, at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Failed', '', 0, ?)`)
      .run(id, document.id, document.revision, document.deadlineRevision, document.dueOn, shiftReportDate(String(document.dueOn), offsetDays), offsetDays, at);
    recordMockAttempt(db, { id, attemptCount: 0 }, "Trigger", operationId, actor, at, simulate && index === 0);
  }
  return { processed: batch.length, interrupted: Number(simulate && batch.length > 0), more: due.length > batchSize };
}

export function checkDocumentReminders(db: Store, input: Extract<PlaybookRunQuery, { type: "checkDocuments" }>, staff: WorkspaceStaff, now: Date) {
  const { operationId, simulate } = input;
  return db.transaction(() => {
    const prior = db.prepare("SELECT actorEmail, simulated, processed, interrupted, more FROM document_reminder_checks WHERE operationId = ?").get(operationId);
    if (prior) return prior.actorEmail === staff.email && prior.simulated === Number(simulate) ?
      checkResult(Number(prior.processed), Number(prior.interrupted), Boolean(prior.more)) : { error: "This reminder check identifier is already in use." };
    const { processed, interrupted, more } = processReminderBatch(db, now, operationId, staff.name, simulate);
    db.prepare("INSERT INTO document_reminder_checks VALUES (?, ?, ?, ?, ?, ?)")
      .run(operationId, staff.email, Number(simulate), processed, interrupted, Number(more));
    return checkResult(processed, interrupted, more);
  });
}

export function readDocumentReminderSchedule(db: Store, available: boolean): DocumentReminderSchedule {
  const row = available ? db.prepare("SELECT revision, nextAt, lastCheckedAt, lastProcessed FROM document_reminder_schedule WHERE id = 1").get() : undefined;
  const nextAt = typeof row?.nextAt === "number" ? new Date(row.nextAt).toISOString() : null;
  return { kind: "document-schedule", available, enabled: nextAt !== null, revision: Number(row?.revision ?? 0), nextAt,
    lastCheckedAt: typeof row?.lastCheckedAt === "string" ? row.lastCheckedAt : null,
    lastProcessed: typeof row?.lastProcessed === "number" ? row.lastProcessed : null };
}

export function setDocumentReminderSchedule(db: Store, input: Extract<PlaybookRunQuery, { type: "setDocumentSchedule" }>, staff: WorkspaceStaff, now: Date) {
  return db.transaction(() => {
    const current = readDocumentReminderSchedule(db, true);
    if (input.revision !== current.revision) {
      return input.revision === current.revision - 1 && input.enabled === current.enabled ? current :
        { error: "The reminder schedule changed. Review the current setting and try again." };
    }
    if (input.enabled === current.enabled) return current;
    const nextAt = input.enabled ? now.getTime() + firstCheckDelay : null;
    db.prepare(`INSERT INTO document_reminder_schedule (id, revision, nextAt) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, nextAt = excluded.nextAt`).run(current.revision + 1, nextAt);
    accessEvent(db, staff, input.enabled ? "Enabled scheduled mock reminders" : "Paused scheduled mock reminders", "Document reminders", now.toISOString());
    return readDocumentReminderSchedule(db, true);
  });
}

export function nextDocumentReminderCheck(db: Store) {
  const nextAt = db.prepare("SELECT nextAt FROM document_reminder_schedule WHERE id = 1").get()?.nextAt;
  return typeof nextAt === "number" ? nextAt : null;
}

export function runScheduledDocumentReminders(db: Store, now = new Date()) {
  db.transaction(() => {
    const scheduledAt = nextDocumentReminderCheck(db);
    if (scheduledAt === null || scheduledAt > now.getTime()) return;
    const { processed, more } = processReminderBatch(db, now, `scheduled:${scheduledAt}`, "Scheduled mock check");
    const nextAt = more ? now.getTime() + continuationDelay : Date.parse(easternDayStart(shiftReportDate(easternDate(now), 1)));
    db.prepare("UPDATE document_reminder_schedule SET nextAt = ?, lastCheckedAt = ?, lastProcessed = ? WHERE id = 1")
      .run(nextAt, now.toISOString(), processed);
  });
}

export function documentReminderPage(db: Store, query: Extract<PlaybookRunQuery, { type: "list" }>, now: Date, limit: number): DocumentReminderRun[] {
  if (query.filter === "Paused") return [];
  const filter = query.filter === "All runs" ? "" : `AND ${status} = ?`;
  const { after } = query;
  const rows = db.prepare(`SELECT 'document' AS source, run.id, run.requestId, loan.id AS loanId, document.kind AS documentKind,
    ${recipientName} AS borrower, ${status} AS status,
    CASE WHEN run.status = 'Failed' AND ${obsolete} THEN ? ELSE run.reason END AS reason,
    run.dueOn, ${eligibleOn} AS eligibleOn, run.timingOffsetDays, run.documentRevision, run.deadlineRevision, run.receipt, run.at, run.attemptCount,
    CASE WHEN run.status = 'Failed' AND NOT ${obsolete} THEN ${blocked} END AS blockedReason ${joins}
    WHERE 1 = 1 ${filter} ${after ? "AND (run.at, run.id) < (?, ?)" : ""}
    ORDER BY run.at DESC, run.id DESC LIMIT ?`)
    .all(changed, now.toISOString(), now.getTime(), easternDate(now), ...(filter ? [query.filter] : []), ...(after ? [after.at, after.id] : []), limit) as unknown as DocumentReminderRun[];
  return rows.map((row) => ({ ...row, canRetry: row.status === "Failed" && !row.blockedReason }));
}

type DocumentRetryResult = Extract<PlaybookRunResult, { kind: "retry" }> | { error: string };

export function retryDocumentReminder(db: Store, input: Extract<PlaybookRunQuery, { type: "retry" }>, staff: WorkspaceStaff, now: Date): DocumentRetryResult {
  const at = now.toISOString();
  const run = db.prepare(`SELECT run.id, run.status, run.attemptCount, ${obsolete} AS obsolete, ${blocked} AS blockedReason
    ${joins} WHERE run.id = ?`).get(at, now.getTime(), easternDate(now), input.id);
  if (!run) return { error: playbookRunsUnavailable };
  const completed = { kind: "retry", status: "Completed", message: "Mock document reminder recorded." } as const;
  const superseded = { kind: "retry", status: "Superseded", message: changed } as const;
  const prior = db.prepare("SELECT attempt, mode FROM document_reminder_attempts WHERE runId = ? AND operationId = ?").get(input.id, input.operationId);
  if (prior) return prior.mode === "Retry" && prior.attempt === input.attempt + 1 ? completed : { error: "This retry identifier is already in use." };
  if (run.status === "Superseded") return superseded;
  if (run.status === "Completed") return { error: "This reminder already has a mock receipt." };
  if (run.status !== "Failed") return { error: "Only an interrupted document reminder can be retried." };
  if (run.attemptCount !== input.attempt) return { error: "This run changed. Refresh the automation history before retrying." };
  if (run.obsolete) {
    db.prepare("UPDATE document_reminder_runs SET status = 'Superseded', reason = ? WHERE id = ?").run(changed, input.id);
    return superseded;
  }
  if (typeof run.blockedReason === "string") return { error: run.blockedReason };
  recordMockAttempt(db, { id: input.id, attemptCount: input.attempt }, "Retry", input.operationId, staff.name, at, false);
  return completed;
}

export function previewDocumentRecovery(db: Store, now: Date): PlaybookRunResult {
  function candidates(ready: boolean, limit: number) {
    return db.prepare(`WITH candidates AS (
        SELECT run.id, run.attemptCount AS attempt, loan.id AS loanId, run.requestId, ${recipientName} AS borrower,
          document.kind AS documentKind, run.dueOn, ${eligibleOn} AS eligibleOn, run.at, ${blocked} AS blockedReason ${joins}
        WHERE run.status = 'Failed' AND NOT ${obsolete}
      ) SELECT id, attempt, loanId, requestId, borrower, documentKind, dueOn, eligibleOn, blockedReason FROM candidates
      WHERE blockedReason IS ${ready ? "" : "NOT "}NULL ORDER BY dueOn, at, id LIMIT ?`)
      .all(now.toISOString(), now.getTime(), easternDate(now), limit + 1) as unknown as DocumentRecoveryCandidate[];
  }
  const ready = candidates(true, recoveryBatchLimit);
  const blockedRows = candidates(false, blockedPreviewLimit);
  return { kind: "document-recovery-preview", ready: ready.slice(0, recoveryBatchLimit), blocked: blockedRows.slice(0, blockedPreviewLimit),
    moreReady: ready.length > recoveryBatchLimit, moreBlocked: blockedRows.length > blockedPreviewLimit };
}

export function recoverDocumentReminders(db: Store, input: Extract<PlaybookRunQuery, { type: "recoverDocuments" }>, staff: WorkspaceStaff, now: Date) {
  const { items, operationId } = input;
  const selection = JSON.stringify(items);
  return db.transaction(() => {
    const prior = db.prepare("SELECT actorEmail, selection, result FROM document_reminder_recoveries WHERE operationId = ?").get(operationId);
    if (prior) return prior.actorEmail === staff.email && prior.selection === selection ? JSON.parse(String(prior.result)) as DocumentRecoveryResult :
      { error: "This recovery identifier is already in use." };

    const rows: DocumentRecoveryResult["rows"] = items.map(({ id, attempt }) => {
      const result = retryDocumentReminder(db, { type: "retry", source: "document", id, attempt, operationId: `batch:${operationId}` }, staff, now);
      if ("error" in result) return { id, status: "Skipped", reason: result.error };
      return { id, status: result.status === "Completed" ? "Recovered" : "Skipped", reason: result.message };
    });
    const recovered = rows.filter(({ status }) => status === "Recovered").length;
    const result: DocumentRecoveryResult = { kind: "document-recovery", rows, recovered, skipped: rows.length - recovered };
    db.prepare("INSERT INTO document_reminder_recoveries VALUES (?, ?, ?, ?)").run(operationId, staff.email, selection, JSON.stringify(result));
    return result;
  });
}

import { createHash } from "node:crypto";
import { cutoverCallbackStatuses, type CutoverCallbackEvidence, type CutoverCallbackStatus } from "./migration-cutover-model";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import type { Store } from "./store";

const evidenceLimit = 10_000;
const pageSize = 20;
const callbackPrefix = "recordKey >= 'Callback:' AND recordKey < 'Callback;'";
type EvidenceItem = CutoverCallbackEvidence["items"][number];
type CallbackLink = {
  recordKey: string; targetId: string | null; exclusion: number | null; leadId: string | null; name: string | null;
  heldAt: string | null; resolvedAt: string | null; officerEmail: string | null; officer: string | null;
  email: string | null; phone: string | null; contactId: string | null;
  campaignId: string | null; campaignName: string | null; lastOutcome: string | null; attempts: number | null;
  callbackTaskId: string | null; currentTaskId: string | null; currentTaskDueAt: string | null; currentTaskCompletedAt: string | null;
};
type TrackedPromise = {
  recordKey: string; id: string; campaignId: string; callNumber: number; outcome: string; status: string; attemptCount: number;
  originalDueAt: string | null; dueAt: string | null; requestedAt: string; closedAt: string | null; closeReason: string | null;
  requestEventId: string | null; attemptEventId: string | null; exactRequestId: string | null; exactAttemptId: string | null;
  requestActor: string | null; attemptActor: string | null; taskId: string; exactTaskId: string | null;
  lastSchedulingAttempt: number | null; lastSchedulingStatus: string | null;
};

function readLinks(db: Store, origin: string, basis: string) {
  const limit = evidenceLimit + 1;
  return db.prepare(`WITH linked AS (
    SELECT recordKey, targetId, NULL AS exclusion FROM migration_records WHERE origin = ? AND ${callbackPrefix}
    ORDER BY recordKey LIMIT ?
  ), excluded AS (
    SELECT entry.key AS recordKey, NULL AS targetId,
      max(CASE entry.value WHEN 'Undone' THEN 3 WHEN 'Suppressed' THEN 2 ELSE 1 END) AS exclusion
    FROM migration_batches batch JOIN json_each(batch.excluded) entry
    WHERE batch.origin = ? AND batch.snapshot = ? AND entry.key GLOB 'Callback:*'
      AND entry.value IN ('Skipped', 'Suppressed', 'Undone')
      AND NOT EXISTS (SELECT 1 FROM migration_records current WHERE current.origin = batch.origin AND current.recordKey = entry.key)
    GROUP BY entry.key ORDER BY entry.key LIMIT ?
  ), undone AS (
    SELECT DISTINCT recordKey, NULL AS targetId, 3 AS exclusion FROM migration_undone_records removed
    WHERE origin = ? AND ${callbackPrefix}
      AND NOT EXISTS (SELECT 1 FROM migration_records current WHERE current.origin = removed.origin AND current.recordKey = removed.recordKey)
    ORDER BY recordKey LIMIT ?
  ), sourceKeys AS (
    SELECT recordKey, max(targetId) AS targetId, max(exclusion) AS exclusion FROM (
      SELECT * FROM linked UNION ALL SELECT * FROM excluded UNION ALL SELECT * FROM undone
    ) GROUP BY recordKey ORDER BY recordKey LIMIT ?
  ) SELECT sourceKeys.*, lead.id AS leadId, lead.name, lead.heldAt, lead.resolvedAt, lead.officerEmail, lead.officer,
    lead.email, lead.phone, lead.importedContactId AS contactId,
    member.campaignId, campaign.name AS campaignName, member.lastOutcome, member.attempts, member.callbackTaskId,
    task.id AS currentTaskId, task.dueAt AS currentTaskDueAt, task.completedAt AS currentTaskCompletedAt
  FROM sourceKeys LEFT JOIN migration_records leadLink ON leadLink.origin = ? AND leadLink.recordKey = 'Lead:' || substr(sourceKeys.recordKey, 10)
    AND (sourceKeys.targetId IS NULL OR sourceKeys.targetId = leadLink.targetId)
  LEFT JOIN referral_leads lead ON lead.id = leadLink.targetId
  LEFT JOIN call_campaign_members member ON member.leadId = lead.id AND member.leadId = sourceKeys.targetId
  LEFT JOIN call_campaigns campaign ON campaign.id = member.campaignId
  LEFT JOIN lead_import_tasks task ON task.id = member.callbackTaskId AND task.leadId = lead.id AND task.purpose = 'Prospecting'
  ORDER BY sourceKeys.recordKey`).all(origin, limit, origin, basis, limit, origin, limit, limit, origin) as unknown as CallbackLink[];
}

function readPromises(db: Store, origin: string, limit: number) {
  return db.prepare(`SELECT callback.recordKey, run.id, run.campaignId, run.callNumber, run.outcome, run.status, run.attemptCount,
    run.dueAt AS originalDueAt, run.promiseDueAt AS dueAt, run.at AS requestedAt, run.promiseClosedAt AS closedAt,
    run.promiseCloseReason AS closeReason, run.promiseRequestEventId AS requestEventId, run.promiseAttemptEventId AS attemptEventId,
    request.id AS exactRequestId, attempt.id AS exactAttemptId, request.actor AS requestActor, attempt.actor AS attemptActor,
    run.taskId, task.id AS exactTaskId, scheduling.attempt AS lastSchedulingAttempt, scheduling.status AS lastSchedulingStatus
  FROM migration_records callback JOIN migration_records leadLink ON leadLink.origin = callback.origin
    AND leadLink.recordKey = 'Lead:' || substr(callback.recordKey, 10) AND leadLink.targetId = callback.targetId
  JOIN campaign_follow_up_runs run ON run.leadId = callback.targetId
  LEFT JOIN lead_events request ON request.id = run.promiseRequestEventId AND request.leadId = run.leadId
    AND request.kind = 'Call' AND request.outcome = 'Requested callback' AND request.at = run.at
    AND length(trim(request.actor)) > 0 AND length(trim(request.text)) > 0
  LEFT JOIN lead_events attempt ON attempt.id = run.promiseAttemptEventId AND attempt.leadId = run.leadId
    AND attempt.kind = 'Call' AND attempt.at = run.promiseClosedAt AND length(trim(attempt.actor)) > 0 AND length(trim(attempt.text)) > 0
  LEFT JOIN lead_import_tasks task ON task.id = run.taskId AND task.leadId = run.leadId AND task.purpose = 'Prospecting'
  LEFT JOIN campaign_follow_up_attempts scheduling ON scheduling.runId = run.id AND scheduling.attempt = run.attemptCount
  WHERE callback.origin = ? AND callback.recordKey >= 'Callback:' AND callback.recordKey < 'Callback;'
    AND (run.promiseRequestEventId IS NOT NULL OR run.promiseDueAt IS NOT NULL OR run.promiseAttemptEventId IS NOT NULL
      OR run.promiseClosedAt IS NOT NULL OR run.promiseCloseReason IS NOT NULL)
  ORDER BY callback.recordKey, run.callNumber, run.id LIMIT ?`).all(origin, limit) as unknown as TrackedPromise[];
}

function validTime(at: string | null): at is string {
  return Boolean(at && Number.isFinite(Date.parse(at)));
}

function promiseResult(link: CallbackLink, promise: TrackedPromise, openCount: number, activeOwner: boolean,
  suppressed: boolean): Pick<EvidenceItem, "status" | "reason"> {
  const missing = (reason: string) => ({ status: "Missing evidence" as const, reason });
  if (promise.campaignId !== link.campaignId || promise.outcome !== "Requested callback" || promise.callNumber > (link.attempts ?? 0)) {
    return missing("The tracked promise does not match this campaign enrollment.");
  }
  if (!promise.exactRequestId || (promise.attemptEventId && (!promise.exactAttemptId || promise.attemptEventId === promise.requestEventId))) {
    return missing("The exact request or callback attempt is missing from this lead’s call notes.");
  }
  const requestedAt = Date.parse(promise.requestedAt);
  if (!Number.isFinite(requestedAt) || !validTime(promise.originalDueAt) || !validTime(promise.dueAt) ||
    Date.parse(promise.originalDueAt) <= requestedAt || Date.parse(promise.dueAt) <= requestedAt) {
    return missing("The original or current promised deadline is missing or invalid.");
  }
  if (promise.status === "Completed" && !promise.exactTaskId) return missing("The campaign task is missing from this lead.");
  if (promise.closedAt) {
    if (!validTime(promise.closedAt) || Date.parse(promise.closedAt) < requestedAt ||
      Boolean(promise.attemptEventId) === Boolean(promise.closeReason) || promise.status === "Failed" || promise.status === "Paused") {
      return missing("The promise lacks a consistent closing record.");
    }
    return { status: "Closed", reason: promise.attemptEventId ? "The exact callback attempt is recorded." : promise.closeReason! };
  }
  if (promise.attemptEventId || promise.closeReason || link.resolvedAt || openCount !== 1 ||
    link.attempts !== promise.callNumber || link.lastOutcome !== "Requested callback") {
    return missing("The open promise does not match the lead’s current campaign call.");
  }
  if (suppressed) return missing("This borrower opted out. Reconcile the open promise with the outreach restriction.");
  if (link.callbackTaskId && (!link.currentTaskId || !validTime(link.currentTaskDueAt))) {
    return missing("The current campaign task does not belong to this lead or lacks a deadline.");
  }
  const recoverable = promise.status === "Failed" || promise.status === "Paused";
  const scheduled = promise.status === "Completed" && promise.taskId === link.currentTaskId && !link.currentTaskCompletedAt &&
    validTime(link.currentTaskDueAt) && Date.parse(link.currentTaskDueAt) >= Date.parse(promise.dueAt);
  if ((!recoverable && !scheduled) || (recoverable && (!promise.lastSchedulingAttempt || promise.lastSchedulingStatus !== promise.status))) {
    return missing("The open promise lacks its scheduled task or a recoverable run.");
  }
  if (link.heldAt && recoverable) return { status: "Needs recovery", reason: "Reactivate this lead before recovering its interrupted campaign task." };
  if (!activeOwner) return { status: "Needs owner", reason: "Assign this callback to an active loan officer or admin." };
  if (link.heldAt) return { status: "On hold", reason: "Reactivate this lead before working its callback." };
  if (recoverable) return { status: "Needs recovery", reason: "Recover the interrupted campaign task from Playbooks." };
  return { status: "Ready", reason: "The promised deadline, current task, and active owner are verified." };
}

export function readCutoverCallbackEvidence(db: Store, origin: string, basis: string, activeOwners: ReadonlySet<string>, after?: string): CutoverCallbackEvidence {
  const hash = createHash("sha256").update(JSON.stringify([origin, basis]));
  const counts = Object.fromEntries(cutoverCallbackStatuses.map((status) => [status, 0])) as CutoverCallbackEvidence["counts"];
  const oversized = (): CutoverCallbackEvidence => ({ fingerprint: hash.update("oversized").digest("hex"), counts, total: 0, unrestored: 0,
    oversized: true, items: [], next: null });
  const links = readLinks(db, origin, basis);
  if (links.length > evidenceLimit) return oversized();
  const promises = links.some(({ targetId }) => targetId) ? readPromises(db, origin, evidenceLimit - links.length + 1) : [];
  if (links.length + promises.length > evidenceLimit) return oversized();
  const byKey = new Map<string, TrackedPromise[]>();
  for (const promise of promises) {
    const list = byKey.get(promise.recordKey) ?? [];
    list.push(promise);
    byKey.set(promise.recordKey, list);
  }
  const outreachCandidates = links.filter(({ recordKey, leadId, resolvedAt }) => leadId && !resolvedAt &&
    byKey.get(recordKey)?.some(({ closedAt, attemptEventId }) => !closedAt && !attemptEventId));
  const blocked = blockedOutreachKeys(db, outreachCandidates);
  const items: EvidenceItem[] = [];
  let unrestored = 0;
  for (const link of links) {
    const { email, phone, contactId, ...evidence } = link;
    const { recordKey, targetId, leadId, campaignName, officer, officerEmail, exclusion } = evidence;
    const records = byKey.get(recordKey) ?? [];
    const activeOwner = Boolean(officerEmail && activeOwners.has(officerEmail.toLowerCase()));
    const suppressed = outreachSuppressed(blocked, { leadId, email, phone, contactId });
    hash.update(JSON.stringify([evidence, activeOwner, suppressed, records]));
    const base = { leadId, name: link.name ?? "Callback history", campaignName, owner: officerEmail ? officer || officerEmail : null };
    const missing = (reason: string) => items.push({ ...base, key: recordKey, dueAt: null, scheduledAt: null, status: "Missing evidence", reason });
    if (!targetId) {
      unrestored++;
      missing(exclusion === 3 ? "This callback import was undone." : exclusion === 2 ? "This callback was suppressed during import." : "This callback was skipped during import.");
      continue;
    }
    if (!leadId || !campaignName || !records.length) {
      missing(!leadId ? "The source callback no longer links to its imported lead." : !campaignName ?
        "The imported campaign enrollment is missing." : "The imported callback promises are missing.");
      continue;
    }
    if (link.lastOutcome === "Requested callback" && !records.some(({ callNumber }) => callNumber === link.attempts)) {
      missing("The current requested callback promise is missing.");
    }
    const openCount = records.filter(({ closedAt, attemptEventId }) => !closedAt && !attemptEventId).length;
    for (const promise of records) {
      const result = promiseResult(link, promise, openCount, activeOwner, suppressed);
      const scheduledAt = !promise.closedAt && promise.taskId === link.currentTaskId && !link.currentTaskCompletedAt && validTime(link.currentTaskDueAt)
        ? link.currentTaskDueAt : null;
      items.push({ ...base, ...result, key: `${recordKey}/${promise.id}`, dueAt: validTime(promise.dueAt) ? promise.dueAt : null, scheduledAt });
    }
  }
  for (const { status } of items) counts[status]++;
  const rank = (status: CutoverCallbackStatus) => status === "Ready" || status === "Closed" ? 2 : status === "On hold" ? 1 : 0;
  items.sort((left, right) => rank(left.status) - rank(right.status) || (left.key < right.key ? -1 : Number(left.key > right.key)));
  const start = after ? items.findIndex(({ key }) => key === after) + 1 : 0;
  const page = items.slice(start, start + pageSize);
  const next = start + pageSize < items.length ? page.at(-1)!.key : null;
  return { fingerprint: hash.digest("hex"), counts, total: items.length, unrestored, oversized: false, items: page, next };
}

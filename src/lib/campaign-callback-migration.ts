import { createHash } from "node:crypto";
import { beginCampaignAssignment } from "./campaign-response";
import type { MigrationRow } from "./pipeline-migration-model";
import type { Store } from "./store";

type CallbackRow = Extract<MigrationRow, { type: "Callback" }>;
type Dependencies = { target: (key: string) => string | undefined; row: (key: string) => MigrationRow | undefined };

function instant(value: string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

function importedCampaignId(origin: string, sourceId: string) {
  const digest = createHash("sha256").update(JSON.stringify([origin, sourceId])).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function reviewCallbackImport(db: Store, row: CallbackRow, leadId: string, dependencies: Dependencies, suppressed: boolean) {
  const history = row.callbackHistory;
  const lead = db.prepare("SELECT resolvedAt FROM referral_leads WHERE id = ?").get(leadId);
  if (lead?.resolvedAt) return "Keep the lead open in CRM before restoring its campaign callbacks.";
  if (db.prepare("SELECT 1 FROM call_campaign_members WHERE leadId = ?").get(leadId)) {
    return "This lead already has campaign history. Review its existing enrollment before importing callbacks.";
  }
  const active = history.promises.find((promise) => !promise.closedAt);
  if (active && suppressed) return "The linked lead is opted out. Review the open callback promise before restoring it.";
  if (active?.status === "Superseded" || (active?.status === "Completed" && (active.taskId !== history.currentTaskId ||
    !history.currentTaskDueAt || history.currentTaskCompletedAt || Date.parse(history.currentTaskDueAt) < Date.parse(active.dueAt)))) {
    return "The open callback promise needs its matching scheduled task or a recoverable run.";
  }

  function matchingEvent(sourceId: string, at: string, requested: boolean) {
    const key = `Note:${sourceId}`;
    const target = dependencies.target(key);
    if (!target) return false;
    if (target.startsWith("planned:")) {
      const source = dependencies.row(key);
      return source?.type === "Note" && source.parentId === row.parentId && source.leadEventKind === "Call" &&
        instant(source.createdAt) === instant(at) && (!requested || source.leadOutcome === "Requested callback");
    }
    const event = db.prepare("SELECT at, outcome FROM lead_events WHERE id = ? AND leadId = ? AND kind = 'Call'").get(target, leadId);
    return event?.at === instant(at) && (!requested || event.outcome === "Requested callback");
  }

  for (const promise of history.promises) {
    if (!matchingEvent(promise.requestEventId, promise.requestedAt, true) ||
      (promise.attemptEventId && (!promise.closedAt || !matchingEvent(promise.attemptEventId, promise.closedAt, false)))) {
      return "Import the exact call notes for this lead before restoring its callback promises.";
    }
  }

  if (history.currentTaskId) {
    const key = `Task:${history.currentTaskId}`;
    const target = dependencies.target(key);
    const source = dependencies.row(key);
    const task = target?.startsWith("planned:") ?
      source?.type === "Task" && source.parentType !== "Contact" && source.parentId === row.parentId ?
        { dueAt: instant(source.dueAt), completedAt: instant(source.completedAt), purpose: source.taskPurpose } : undefined :
      target ? db.prepare("SELECT dueAt, completedAt, purpose FROM lead_import_tasks WHERE id = ? AND leadId = ?").get(target, leadId) : undefined;
    if (!task || task.dueAt !== instant(history.currentTaskDueAt) || task.completedAt !== instant(history.currentTaskCompletedAt) ||
      task.purpose !== "Prospecting") {
      return "Import the matching campaign task before restoring this callback. Review any deadline changes in the destination.";
    }
  }
  return null;
}

export function restoreCallbackImport(db: Store, origin: string, row: CallbackRow, leadId: string, targets: Map<string, string>, now: string, suppressed: boolean) {
  const history = row.callbackHistory;
  const campaignId = importedCampaignId(origin, history.campaignId);
  if (!db.prepare("SELECT 1 FROM call_campaigns WHERE id = ?").get(campaignId)) {
    const exists = db.prepare("SELECT 1 FROM call_campaigns WHERE name = ?");
    let name = history.campaignName;
    for (let collision = 0; exists.get(name); collision++) {
      const suffix = ` · imported ${campaignId.slice(0, 8)}${collision ? `-${collision + 1}` : ""}`;
      name = `${history.campaignName.slice(0, 80 - suffix.length)}${suffix}`;
    }
    db.prepare("INSERT INTO call_campaigns (id, name, createdAt) VALUES (?, ?, ?)").run(campaignId, name, now);
  }
  const currentTaskId = history.currentTaskId ? targets.get(`Task:${history.currentTaskId}`) ?? null : null;
  db.prepare(`INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, attempts, lastOutcome, reachedAt, firstCallAt, callbackTaskId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(leadId, campaignId, instant(history.joinedAt), history.attempts, history.lastOutcome, instant(history.reachedAt), instant(history.firstCallAt), currentTaskId);
  if (!suppressed) beginCampaignAssignment(db, leadId, now);
  const insert = db.prepare(`INSERT INTO campaign_follow_up_runs (id, leadId, campaignId, callNumber, outcome, ruleRevision, delayDays,
    taskId, taskTitle, dueAt, status, reason, at, promiseRequestEventId, promiseDueAt, promiseAttemptEventId, promiseClosedAt, promiseCloseReason, attemptCount)
    VALUES (?, ?, ?, ?, 'Requested callback', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertAttempt = db.prepare(`INSERT INTO campaign_follow_up_attempts (runId, attempt, operationId, mode, status, reason, actor, at, taskChanges)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const promise of history.promises) {
    const taskId = targets.get(`Task:${promise.taskId}`) ?? importedCampaignId(origin, `${row.parentId}:task:${promise.taskId}`);
    const runId = crypto.randomUUID();
    insert.run(runId, leadId, campaignId, promise.callNumber, promise.ruleRevision, taskId, promise.taskTitle,
      instant(promise.originalDueAt), promise.status, promise.reason, instant(promise.requestedAt), targets.get(`Note:${promise.requestEventId}`)!,
      instant(promise.dueAt), promise.attemptEventId ? targets.get(`Note:${promise.attemptEventId}`)! : null, instant(promise.closedAt),
      promise.closeReason, promise.schedulingAttempts.length);
    for (const attempt of promise.schedulingAttempts) {
      insertAttempt.run(runId, attempt.attempt, attempt.operationId, attempt.mode, attempt.status, attempt.reason, attempt.actor,
        instant(attempt.at), attempt.taskChanges);
    }
  }
}

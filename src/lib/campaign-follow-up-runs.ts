import { advanceLeadRevision, leadEvent } from "./lead-inbox";
import { stopCampaignSequence } from "./campaign-sequences";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { playbookRunsUnavailable, recoveryBatchLimit, type CampaignPlaybookRun, type CampaignRecoveryCandidate, type CampaignRecoveryResult,
  type PlaybookAttempt, type PlaybookRunQuery, type PlaybookRunResult } from "./playbook-run-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { dateTime } from "./utils";

const blocked = `CASE WHEN lead.resolvedAt IS NOT NULL OR member.attempts <> run.callNumber OR member.lastOutcome IS NOT run.outcome THEN 'The triggering call is no longer current.'
  WHEN lead.heldAt IS NOT NULL THEN 'Reactivate the lead before recovering this follow-up.'
  WHEN run.delayDays IS NOT NULL AND rules.automaticPaused = 1 THEN 'Resume new automatic retries in the campaign rules first.' END`;
const campaignJoins = `FROM campaign_follow_up_runs run JOIN call_campaign_members member ON member.leadId = run.leadId AND member.campaignId = run.campaignId
  JOIN referral_leads lead ON lead.id = run.leadId JOIN call_campaigns campaign ON campaign.id = run.campaignId
  LEFT JOIN call_campaign_rules rules ON rules.campaignId = run.campaignId`;
const leadRevisionJoin = "LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id";
const unassignedReason = "Assign the lead before recovering this follow-up.";
const leadRevision = "coalesce(follow.revision, 0)";
type Trigger = { leadId: string; campaignId: string; callNumber: number; outcome: string; ruleRevision: number; delayDays: number | null;
  taskId: string; taskTitle: string; dueAt: string; at: string; promiseRequestEventId?: string | null };
type CurrentRun = Trigger & { id: string; status: CampaignPlaybookRun["status"]; reason: string; attemptCount: number; blockedReason: string | null;
  resolvedAt: string | null; attempts: number; lastOutcome: string | null; email: string; phone: string; contactId: string | null;
  leadRevision: number; ownerEmail: string | null };
type CampaignRecoveryQuery = Extract<PlaybookRunQuery, { type: "recoverCampaignFollowUps" }>;
type RetryResult = Extract<PlaybookRunResult, { kind: "retry" }> | { error: string };

export function supersedeCampaignFollowUp(db: Store, leadId: string, reason: string) {
  db.prepare("UPDATE campaign_follow_up_runs SET status = 'Superseded', reason = ? WHERE leadId = ? AND status IN ('Failed', 'Paused')")
    .run(reason, leadId);
}

export function stopAutomaticCampaignRetriesForReply(db: Store, leadId: string, at: string) {
  stopCampaignSequence(db, leadId, "Reply received");
  db.prepare(`UPDATE lead_import_tasks SET completedAt = ? WHERE leadId = ? AND completedAt IS NULL AND id = (
    SELECT callbackTaskId FROM call_campaign_members WHERE leadId = ? AND lastOutcome IN ('Left message', 'No response')
  )`).run(at, leadId, leadId);
  db.prepare(`UPDATE campaign_follow_up_runs SET status = 'Superseded', reason = 'Borrower reply logged.'
    WHERE leadId = ? AND delayDays IS NOT NULL AND status IN ('Failed', 'Paused')`).run(leadId);
}

function attemptCampaignTask(db: Store, run: Trigger & { id: string; attemptCount: number }, mode: "Trigger" | "Retry", operationId: string,
  actor: string, at: string, interruption?: "pause" | "simulate"): PlaybookAttempt["status"] {
  let status: PlaybookAttempt["status"] = interruption === "pause" ? "Paused" : "Failed";
  let reason = interruption === "pause" ? "New automatic retries were paused when the call was logged." : "Fictional pilot interrupted the task write.";
  if (!interruption) {
    try {
      db.prepare(`INSERT INTO lead_import_tasks (id, leadId, title, dueAt, purpose) VALUES (?, ?, ?, ?, 'Prospecting')
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, dueAt = excluded.dueAt, completedAt = NULL`)
        .run(run.taskId, run.leadId, run.taskTitle, run.dueAt);
      status = "Completed";
      reason = "Campaign follow-up scheduled.";
    } catch {
      reason = "Orbit could not write the campaign follow-up task. Recover this run from Playbooks.";
    }
  }
  const attempt = run.attemptCount + 1;
  db.prepare(`INSERT INTO campaign_follow_up_attempts (runId, attempt, operationId, mode, status, reason, actor, at, taskChanges)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.id, attempt, operationId, mode, status, reason, actor, at, Number(status === "Completed"));
  db.prepare("UPDATE campaign_follow_up_runs SET status = ?, reason = ?, attemptCount = ? WHERE id = ?").run(status, reason, attempt, run.id);
  return status;
}

export function startCampaignFollowUp(db: Store, trigger: Trigger, actor: string, paused: boolean, simulate: boolean) {
  const id = crypto.randomUUID();
  const requestEventId = trigger.promiseRequestEventId ?? null;
  db.prepare(`INSERT INTO campaign_follow_up_runs (id, leadId, campaignId, callNumber, outcome, ruleRevision, delayDays, taskId, taskTitle, dueAt,
    status, reason, at, promiseRequestEventId, promiseDueAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Failed', '', ?, ?, ?)`)
    .run(id, trigger.leadId, trigger.campaignId, trigger.callNumber, trigger.outcome, trigger.ruleRevision, trigger.delayDays,
      trigger.taskId, trigger.taskTitle, trigger.dueAt, trigger.at, requestEventId, requestEventId ? trigger.dueAt : null);
  return attemptCampaignTask(db, { ...trigger, id, attemptCount: 0 }, "Trigger", id, actor, trigger.at, paused ? "pause" : simulate ? "simulate" : undefined);
}

export function campaignFollowUpPage(db: Store, query: Extract<PlaybookRunQuery, { type: "list" }>, limit: number) {
  const { filter, after } = query;
  const rows = db.prepare(`SELECT 'campaign' AS source, run.id, run.leadId, run.campaignId, campaign.name AS campaignName, lead.name AS borrower,
    run.status, run.reason, run.at, run.attemptCount, run.ruleRevision, run.delayDays, run.dueAt, run.outcome, run.callNumber,
    CASE WHEN run.status IN ('Failed', 'Paused') THEN ${blocked} END AS blockedReason ${campaignJoins}
    WHERE 1 = 1 ${filter !== "All runs" ? "AND run.status = ?" : ""} ${after ? "AND (run.at, run.id) < (?, ?)" : ""}
    ORDER BY run.at DESC, run.id DESC LIMIT ?`).all(...(filter === "All runs" ? [] : [filter]), ...(after ? [after.at, after.id] : []), limit) as unknown as CampaignPlaybookRun[];
  return rows.map((row) => ({ ...row, canRetry: (row.status === "Failed" || row.status === "Paused") && !row.blockedReason }));
}

function retryResult(status: CurrentRun["status"]): RetryResult {
  const message = { Completed: "Campaign follow-up is scheduled.", Failed: "The campaign follow-up still needs attention. The attempt was recorded.",
    Paused: "The automatic follow-up is paused.", Superseded: "This follow-up was retired because the lead or call changed." }[status];
  return { kind: "retry", status, message };
}

export function retryCampaignFollowUp(db: Store, data: Extract<PlaybookRunQuery, { type: "retry" }>, actor: string, at: string,
  reviewed?: CampaignRecoveryQuery["items"][number]): RetryResult {
  const run = db.prepare(`SELECT run.*, lead.resolvedAt, lead.email, lead.phone, lead.importedContactId AS contactId,
    lead.officerEmail AS ownerEmail, ${leadRevision} AS leadRevision, member.attempts, member.lastOutcome, ${blocked} AS blockedReason
    ${campaignJoins} ${leadRevisionJoin} WHERE run.id = ?`).get(data.id) as unknown as CurrentRun | undefined;
  if (!run) return { error: playbookRunsUnavailable };
  const prior = db.prepare("SELECT attempt, mode FROM campaign_follow_up_attempts WHERE runId = ? AND operationId = ?").get(data.id, data.operationId);
  if (prior) return prior.mode === "Retry" && prior.attempt === data.attempt + 1 ? retryResult(run.status) : { error: "This retry identifier is already in use." };
  if (reviewed && run.status === "Superseded") return { error: run.reason };
  if (reviewed && run.status === "Completed") return { error: "This follow-up is already scheduled." };
  if (run.status !== "Failed" && run.status !== "Paused") return { error: "Only a pending campaign follow-up can be recovered." };
  if (data.attempt !== run.attemptCount) return { error: "This run changed. Refresh the automation history before retrying." };
  if (run.resolvedAt || run.attempts !== run.callNumber || run.lastOutcome !== run.outcome || outreachSuppressed(blockedOutreachKeys(db, [run]), run)) {
    supersedeCampaignFollowUp(db, run.leadId, "The lead is closed, opted out, or has a newer call.");
    return retryResult("Superseded");
  }
  if (run.blockedReason) return { error: run.blockedReason };
  if (reviewed && !run.ownerEmail) return { error: unassignedReason };
  if (reviewed && (run.ownerEmail !== reviewed.ownerEmail || run.leadRevision !== reviewed.leadRevision)) {
    return { error: "The lead or its assignment changed. Review the current lead before retrying." };
  }
  const status = attemptCampaignTask(db, run, "Retry", data.operationId, actor, at);
  if (status === "Completed") {
    db.prepare("UPDATE call_campaign_members SET callbackTaskId = ? WHERE leadId = ?").run(run.taskId, run.leadId);
    advanceLeadRevision(db, run.leadId);
    leadEvent(db, run.leadId, actor, at, `Campaign follow-up recovered · Due ${dateTime(run.dueAt)} ET.`, "Campaign");
  }
  return retryResult(status);
}

export function previewCampaignRecovery(db: Store, runId?: string): PlaybookRunResult {
  const blockedLimit = 5;
  function candidates(ready: boolean, limit: number) {
    return db.prepare(`WITH candidates AS (
      SELECT run.id, run.attemptCount AS attempt, run.leadId, run.campaignId, campaign.name AS campaignName, lead.name AS borrower,
        CASE WHEN lead.officerEmail IS NOT NULL THEN coalesce(nullif(lead.officer, ''), lead.officerEmail) END AS owner,
        lead.officerEmail AS ownerEmail, ${leadRevision} AS leadRevision, run.status, run.outcome, run.delayDays, run.dueAt, run.at,
        coalesce(${blocked}, CASE WHEN lead.officerEmail IS NULL THEN '${unassignedReason}' END) AS blockedReason
      ${campaignJoins} ${leadRevisionJoin} WHERE run.status IN ('Failed', 'Paused') ${runId ? "AND run.id = ?" : ""}
    ) SELECT id, attempt, leadId, campaignId, campaignName, borrower, owner, ownerEmail, leadRevision, status, outcome, delayDays, dueAt, blockedReason
    FROM candidates WHERE blockedReason IS ${ready ? "" : "NOT "}NULL ORDER BY dueAt, at, id LIMIT ?`)
      .all(...(runId ? [runId] : []), limit + 1) as unknown as CampaignRecoveryCandidate[];
  }
  const ready = candidates(true, recoveryBatchLimit);
  const blockedRows = candidates(false, blockedLimit);
  if (runId && !ready.length && !blockedRows.length) return { error: "This campaign follow-up no longer needs recovery." };
  return { kind: "campaign-recovery-preview", ready: ready.slice(0, recoveryBatchLimit), blocked: blockedRows.slice(0, blockedLimit),
    moreReady: ready.length > recoveryBatchLimit, moreBlocked: blockedRows.length > blockedLimit };
}

export function recoverCampaignFollowUps(db: Store, input: CampaignRecoveryQuery, staff: WorkspaceStaff, at: string) {
  const { items, operationId } = input;
  const selection = JSON.stringify(items);
  return db.transaction(() => {
    const prior = db.prepare("SELECT actorEmail, selection, result FROM campaign_follow_up_recoveries WHERE operationId = ?").get(operationId);
    if (prior) return prior.actorEmail === staff.email && prior.selection === selection ? JSON.parse(String(prior.result)) as CampaignRecoveryResult :
      { error: "This recovery identifier is already in use." };

    const rows: CampaignRecoveryResult["rows"] = items.map((item) => {
      const { id, attempt } = item;
      const result = retryCampaignFollowUp(db, { type: "retry", source: "campaign", id, attempt, operationId: `batch:${operationId}` }, staff.name, at, item);
      if ("error" in result) return { id, status: "Skipped", reason: result.error };
      const status = result.status === "Completed" ? "Recovered" : result.status === "Failed" ? "Failed" : "Skipped";
      return { id, status, reason: result.message };
    });
    const recovered = rows.filter(({ status }) => status === "Recovered").length;
    const failed = rows.filter(({ status }) => status === "Failed").length;
    const result: CampaignRecoveryResult = { kind: "campaign-recovery", rows, recovered, failed, skipped: rows.length - recovered - failed };
    db.prepare("INSERT INTO campaign_follow_up_recoveries VALUES (?, ?, ?, ?)").run(operationId, staff.email, selection, JSON.stringify(result));
    return result;
  });
}

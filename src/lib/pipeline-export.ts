import { createHash } from "node:crypto";
import { callbackMigrationPromiseLimit, callbackMigrationSchedulingAttemptLimit, migrationBatchRowLimit, migrationChannelFields, migrationCsv, migrationFileByteLimit,
  migrationRow, type MigrationRow } from "./pipeline-migration-model";
import { outreachSuppressed, outreachSuppressionKeys } from "./outreach-preferences";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";

const recordLimit = 1000;
const exportByteLimit = 2_000_000;
const followUpEventLimit = 10_000;

function byActivity(rows: Record<string, SqlValue>[]) {
  const events = new Map<SqlValue, Record<string, SqlValue>[]>();
  for (const { activityId, ...event } of rows) {
    const list = events.get(activityId);
    if (list) list.push(event);
    else events.set(activityId, [event]);
  }
  return events;
}

export function exportPilotPipeline(db: Store, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin" || !staff.brokerage.pilot) {
    return { error: "Only a fictional pilot admin can export the CRM snapshot." };
  }
  return db.transaction(() => readSnapshot(db, `orbit-${staff.brokerage.id}`));
}

function readSnapshot(db: Store, origin: string) {
  const limit = recordLimit + 1;
  const suppression = outreachSuppressionKeys(db);
  const contacts = db.prepare(`SELECT contact.id AS externalId, contact.name, contact.email, contact.phone, contact.role, channels.blocked
    FROM contacts contact LEFT JOIN borrower_contact_channels channels ON channels.contactId = contact.id
    ORDER BY contact.id LIMIT ?`).all(limit);
  const leads = db.prepare(`SELECT lead.id AS externalId, lead.name, lead.email, lead.phone, lead.purpose, lead.zip, lead.propertyState, lead.createdAt, lead.dueAt,
    coalesce(lead.officerEmail, '') AS ownerEmail, coalesce(lead.importedContactId, '') AS parentId, lead.realtorId,
    coalesce(lead.importSource, CASE WHEN lead.realtorId IS NULL THEN 'Website quote request' ELSE 'Realtor referral' END) AS source,
    lead.heldAt, lead.holdReason, lead.revisitDate, follow.firstContactAt, member.lastOutcome, channels.blocked
    FROM referral_leads lead LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    LEFT JOIN borrower_lead_channels channels ON channels.leadId = lead.id
    LEFT JOIN call_campaign_members member ON member.leadId = lead.id WHERE lead.resolvedAt IS NULL ORDER BY lead.id LIMIT ?`).all(limit);
  const notes = db.prepare(`SELECT event.id AS externalId, event.leadId AS parentId, event.at AS createdAt, event.text,
    event.kind AS leadEventKind, event.outcome AS leadOutcome, event.actor AS leadEventActor FROM lead_events event
    JOIN referral_leads lead ON lead.id = event.leadId WHERE lead.resolvedAt IS NULL ORDER BY event.id LIMIT ?`).all(limit);
  const leadTasks = db.prepare(`SELECT task.id AS externalId, task.leadId AS parentId, task.title AS text, task.dueAt,
    coalesce(task.completedAt, '') AS completedAt, task.purpose AS taskPurpose FROM lead_import_tasks task
    JOIN referral_leads lead ON lead.id = task.leadId WHERE lead.resolvedAt IS NULL ORDER BY task.id LIMIT ?`).all(limit);
  const contactTasks = db.prepare(`SELECT activity.id AS externalId, activity.contactId AS parentId, activity.text, activity.createdAt, activity.dueAt,
    coalesce(activity.completedAt, '') AS completedAt, coalesce(activity.followUpOwnerEmail, '') AS ownerEmail, activity.purpose AS taskPurpose,
    activity.kind AS activityKind, activity.outcome AS activityOutcome, activity.revision, activity.officer AS loggedBy,
    EXISTS (SELECT 1 FROM funding_check_ins checkIn WHERE checkIn.activityId = activity.id) AS postFundingCheckIn
    FROM contact_activity activity WHERE activity.dueAt IS NOT NULL ORDER BY activity.id LIMIT ?`).all(limit);
  const callbacks = db.prepare(`SELECT lead.id AS externalId, member.campaignId, campaign.name AS campaignName, member.joinedAt,
    member.attempts, member.lastOutcome, member.reachedAt, member.firstCallAt, member.callbackTaskId AS currentTaskId,
    task.dueAt AS currentTaskDueAt, task.completedAt AS currentTaskCompletedAt
    FROM referral_leads lead JOIN call_campaign_members member ON member.leadId = lead.id
    JOIN call_campaigns campaign ON campaign.id = member.campaignId
    LEFT JOIN lead_import_tasks task ON task.id = member.callbackTaskId AND task.leadId = lead.id
    WHERE lead.resolvedAt IS NULL AND EXISTS (SELECT 1 FROM campaign_follow_up_runs run
      WHERE run.leadId = lead.id AND run.promiseRequestEventId IS NOT NULL)
    ORDER BY lead.id LIMIT ?`).all(limit);
  const total = contacts.length + leads.length + notes.length + leadTasks.length + contactTasks.length + callbacks.length;
  if (!total) return { error: "This pilot has no CRM records to export." };
  if (total > recordLimit) return { error: `This snapshot exceeds the pilot export limit of ${recordLimit.toLocaleString("en-US")} records.` };
  const completions = db.prepare(`SELECT event.activityId, event.revision, event.completedAt, event.actor, event.actorEmail, event.outcome, event.note
    FROM contact_follow_up_completions event JOIN contact_activity activity ON activity.id = event.activityId
    WHERE activity.dueAt IS NOT NULL ORDER BY event.activityId, event.revision LIMIT ?`).all(followUpEventLimit + 1);
  const reschedules = db.prepare(`SELECT event.activityId, event.revision, event.changedAt, event.actor, event.actorEmail, event.previousDueAt, event.dueAt, event.reason
    FROM contact_callback_reschedules event JOIN contact_activity activity ON activity.id = event.activityId
    WHERE activity.dueAt IS NOT NULL ORDER BY event.activityId, event.revision LIMIT ?`).all(followUpEventLimit + 1);
  const remainingHistory = followUpEventLimit - completions.length - reschedules.length;
  if (remainingHistory < 0) return { error: "This snapshot exceeds the pilot follow-up history limit." };
  const promises = db.prepare(`SELECT run.leadId, run.campaignId AS promiseCampaignId, run.id, run.callNumber, run.taskId, run.taskTitle,
    run.dueAt AS originalDueAt, run.promiseDueAt AS dueAt, run.at AS requestedAt, run.promiseRequestEventId AS requestEventId,
    run.promiseAttemptEventId AS attemptEventId, run.promiseClosedAt AS closedAt, run.promiseCloseReason AS closeReason,
    run.status, run.reason, run.ruleRevision, run.attemptCount, request.id AS exactRequestId, attempt.id AS exactAttemptId
    FROM campaign_follow_up_runs run JOIN referral_leads lead ON lead.id = run.leadId
    LEFT JOIN lead_events request ON request.id = run.promiseRequestEventId AND request.leadId = run.leadId
      AND request.kind = 'Call' AND request.outcome = 'Requested callback' AND request.at = run.at AND length(trim(request.actor)) > 0
    LEFT JOIN lead_events attempt ON attempt.id = run.promiseAttemptEventId AND attempt.leadId = run.leadId
      AND attempt.kind = 'Call' AND attempt.at = run.promiseClosedAt AND length(trim(attempt.actor)) > 0
    WHERE lead.resolvedAt IS NULL AND run.promiseRequestEventId IS NOT NULL
    ORDER BY run.leadId, run.callNumber, run.id LIMIT ?`).all(remainingHistory + 1);
  if (promises.length > remainingHistory) return { error: "This snapshot exceeds the pilot campaign callback history limit." };
  const schedulingAttemptLimit = remainingHistory - promises.length;
  const schedulingAttempts = promises.length ? db.prepare(`SELECT history.runId, history.attempt, history.operationId, history.mode,
    history.status, history.reason, history.actor, history.at, history.taskChanges
    FROM campaign_follow_up_attempts history JOIN campaign_follow_up_runs run ON run.id = history.runId
    JOIN referral_leads lead ON lead.id = run.leadId
    WHERE lead.resolvedAt IS NULL AND run.promiseRequestEventId IS NOT NULL
    ORDER BY history.runId, history.attempt LIMIT ?`).all(schedulingAttemptLimit + 1) : [];
  if (schedulingAttempts.length > schedulingAttemptLimit) return { error: "This snapshot exceeds the pilot campaign callback history limit." };
  const attemptsByRun = new Map<SqlValue, Record<string, SqlValue>[]>();
  for (const { runId, ...attempt } of schedulingAttempts) {
    const list = attemptsByRun.get(runId) ?? [];
    if (list.length === callbackMigrationSchedulingAttemptLimit) return { error: "A callback exceeds the pilot scheduling attempt limit." };
    list.push(attempt);
    attemptsByRun.set(runId, list);
  }
  const callbackByLead = new Map(callbacks.map((row) => [row.externalId, row]));
  const promisesByLead = new Map<SqlValue, unknown[]>();
  for (const { leadId, promiseCampaignId, exactRequestId, exactAttemptId, attemptCount, ...promise } of promises) {
    if (callbackByLead.get(leadId)?.campaignId !== promiseCampaignId || !exactRequestId || (promise.attemptEventId && !exactAttemptId)) {
      return { error: "A campaign callback is missing its original campaign or call evidence. The snapshot cannot preserve its history." };
    }
    const attempts = attemptsByRun.get(promise.id);
    if (!attempts || attempts.length !== attemptCount) return { error: "A campaign callback is missing its original scheduling attempts." };
    const list = promisesByLead.get(leadId) ?? [];
    if (list.length === callbackMigrationPromiseLimit) return { error: "A lead exceeds the pilot campaign callback history limit." };
    list.push({ ...promise, schedulingAttempts: attempts });
    promisesByLead.set(leadId, list);
  }
  const completionsByTask = byActivity(completions);
  const reschedulesByTask = byActivity(reschedules);
  const candidates = [
    ...contacts.map(({ blocked, ...row }) => ({ ...row, ...migrationChannelFields(row.role === "Realtor" ? 0 : Number(blocked)), type: "Contact", optedOut: row.role !== "Realtor" &&
      outreachSuppressed(suppression, { ...row, contactId: row.externalId }) ? "Yes" : "" })),
    ...leads.map(({ blocked, ...row }) => ({ ...row, ...migrationChannelFields(Number(blocked)), type: "Lead", realtorId: row.realtorId ?? undefined, firstContactAt: row.firstContactAt ?? undefined,
      heldAt: row.heldAt ?? undefined, holdReason: row.holdReason ?? undefined, revisitDate: row.revisitDate ?? undefined,
      optedOut: row.lastOutcome === "Opted out" || outreachSuppressed(suppression, { ...row, leadId: row.externalId, contactId: row.parentId }) ? "Yes" : "" })),
    ...notes.map((row) => ({ ...row, type: "Note", leadOutcome: row.leadOutcome ?? undefined, leadEventActor: row.leadEventActor || undefined })),
    ...leadTasks.map((row) => ({ ...row, type: "Task", parentType: "Lead" })),
    ...contactTasks.map(({ revision, loggedBy, postFundingCheckIn, ...row }) => {
      const completions = completionsByTask.get(row.externalId) ?? [];
      const reschedules = reschedulesByTask.get(row.externalId) ?? [];
      const followUpHistory = postFundingCheckIn || completions.length || reschedules.length
        ? { version: 1, revision, loggedBy, postFundingCheckIn: Boolean(postFundingCheckIn), completions, reschedules } : undefined;
      return { ...row, type: "Task", parentType: "Contact", activityOutcome: row.activityOutcome ?? undefined, followUpHistory };
    }),
    ...callbacks.map(({ externalId, ...history }) => ({ type: "Callback", externalId, parentId: externalId,
      text: "Campaign callback history", callbackHistory: { version: 1, ...history, promises: promisesByLead.get(externalId) } })),
  ];
  const rows: MigrationRow[] = [];
  for (const candidate of candidates) {
    const parsed = migrationRow.safeParse(candidate);
    if (!parsed.success) return { error: `A ${candidate.type.toLowerCase()} record has a field the migration format cannot import. Check ${parsed.error.issues[0]?.path.join(".")}.` };
    rows.push(parsed.data);
  }
  const encoder = new TextEncoder();
  const size = (csv: string) => encoder.encode(csv).byteLength;
  // Budget for the longest metadata before the final part count is known.
  const placeholder = { origin, snapshot: "0".repeat(64), part: recordLimit, partCount: recordLimit };
  const chunks: MigrationRow[][] = [];
  for (let start = 0; start < rows.length;) {
    let end = Math.min(start + migrationBatchRowLimit, rows.length);
    let chunk = rows.slice(start, end);
    while (size(migrationCsv(chunk, origin, placeholder)) > migrationFileByteLimit) {
      if (chunk.length === 1) return { error: "A CRM record exceeds the pilot import file size limit." };
      end = start + Math.floor(chunk.length / 2);
      chunk = rows.slice(start, end);
    }
    chunks.push(chunk);
    start = end;
  }
  const snapshot = createHash("sha256").update(JSON.stringify({ origin, chunks })).digest("hex");
  const batches = chunks.map((chunk, index) => ({
    part: index + 1, count: chunk.length,
    csv: migrationCsv(chunk, origin, { origin, snapshot, part: index + 1, partCount: chunks.length }),
  }));
  if (batches.reduce((bytes, batch) => bytes + size(batch.csv), 0) > exportByteLimit) {
    return { error: "This snapshot exceeds the pilot export size limit of 2 MB." };
  }
  return { batches, origin, snapshot, total };
}

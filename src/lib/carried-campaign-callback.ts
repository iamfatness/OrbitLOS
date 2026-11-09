import type { CarriedCallbackInput, RescheduleCarriedCallbackInput } from "./campaign-callback-performance-model";
import { advanceLeadRevision } from "./lead-inbox";
import { loanOutreachSuppressed } from "./outreach-preferences";
import type { Store } from "./store";
import { dateTime } from "./utils";

type CarriedCallback = {
  runId: string; leadId: string; taskId: string; dueAt: string; completedAt: string | null;
  attemptEventId: string | null; disposition: string; revision: number;
};

export const carriedCallbackSource = `FROM referral_leads lead JOIN loans loan ON loan.id = lead.loanId
    JOIN call_campaign_members member ON member.leadId = lead.id
    JOIN campaign_follow_up_runs run ON run.leadId = lead.id AND run.campaignId = member.campaignId
      AND run.callNumber = member.attempts AND run.taskId = member.callbackTaskId
    JOIN tasks task ON task.id = run.taskId AND task.loanId = loan.id`;
export const carriedCallbackPromise = `lead.resolvedAt IS NOT NULL AND member.lastOutcome = 'Requested callback'
    AND run.promiseRequestEventId IS NOT NULL`;
export const openCarriedCallback = `${carriedCallbackPromise} AND run.promiseAttemptEventId IS NULL
    AND run.promiseCloseReason = '1003 started' AND task.completedAt IS NULL AND loan.disposition = 'Active'`;

export function carriedCallbacks(db: Store, loanId?: string, taskId?: string) {
  return db.prepare(`SELECT run.id AS runId, lead.id AS leadId, task.id AS taskId, task.dueAt, task.completedAt,
    run.promiseAttemptEventId AS attemptEventId, loan.disposition, coalesce(follow.revision, 0) AS revision
    ${carriedCallbackSource} LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    WHERE ${carriedCallbackPromise}
      AND (run.promiseCloseReason = '1003 started' OR run.promiseAttemptEventId IS NOT NULL)
      ${loanId ? "AND loan.id = ?" : ""} ${taskId ? "AND task.id = ?" : ""}`)
    .all(...(loanId ? [loanId] : []), ...(taskId ? [taskId] : [])) as unknown as CarriedCallback[];
}

function callbackEventExists(db: Store, eventId: string) {
  return db.prepare("SELECT 1 FROM lead_events WHERE id = ? UNION ALL SELECT 1 FROM activity WHERE id = ?").get(eventId, eventId);
}

function writeCallbackEvent(db: Store, { loanId, leadId, eventId, text, actor, now, kind, outcome }: {
  loanId: string; leadId: string; eventId: string; text: string; actor: string; now: string; kind: "Call" | "Note"; outcome: string | null;
}) {
  db.prepare("INSERT INTO lead_events (id, leadId, at, actor, kind, outcome, text) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(eventId, leadId, now, actor, kind, outcome, text);
  db.prepare("INSERT INTO activity (id, loanId, createdAt, kind, outcome, text) VALUES (?, ?, ?, ?, ?, ?)")
    .run(eventId, loanId, now, kind, outcome, `${text} · ${actor}`);
}

// The workspace command runs this write in its existing transaction.
export function recordCarriedCallback(db: Store, input: CarriedCallbackInput, actor: string, now: string) {
  const { loanId, taskId, dueAt, eventId, outcome, note } = input;
  const [callback] = carriedCallbacks(db, loanId, taskId);
  const unavailable = { error: "This campaign callback changed. Refresh the loan and check the task." };
  if (!callback || callback.dueAt !== dueAt) return unavailable;
  const text = ["Campaign callback", outcome, note].filter(Boolean).join(" · ");
  const message = "Callback logged on the loan and in campaign reporting.";
  if (callback.attemptEventId === eventId) {
    const event = db.prepare("SELECT 1 FROM lead_events WHERE id = ? AND leadId = ? AND actor = ? AND kind = 'Call' AND outcome = ? AND text = ?")
      .get(eventId, callback.leadId, actor, outcome, text);
    return event ? { message } : { error: "This callback outcome was already saved with different details." };
  }
  if (callback.completedAt || callback.attemptEventId) return unavailable;
  if (callback.disposition !== "Active") return { error: "Reopen the loan before logging this callback." };
  if (loanOutreachSuppressed(db, loanId)) return { error: "This borrower opted out of brokerage outreach." };
  if (callbackEventExists(db, eventId)) {
    return { error: "This callback outcome identifier is already in use." };
  }
  writeCallbackEvent(db, { loanId, leadId: callback.leadId, eventId, text, actor, now, kind: "Call", outcome });
  db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ? AND loanId = ?").run(now, taskId, loanId);
  db.prepare("UPDATE campaign_follow_up_runs SET promiseAttemptEventId = ?, promiseClosedAt = ?, promiseCloseReason = NULL WHERE id = ?")
    .run(eventId, now, callback.runId);
  return { message };
}

export function rescheduleCarriedCallback(db: Store, input: RescheduleCarriedCallbackInput, actor: string, now: string) {
  const { loanId, taskId, dueAt, callbackAt, revision, eventId, reason } = input;
  const [callback] = carriedCallbacks(db, loanId, taskId);
  const unavailable = { error: "This campaign callback changed. Refresh the loan before rescheduling." };
  if (!callback || callback.completedAt || callback.attemptEventId) return unavailable;
  const when = `${dateTime(callbackAt, "medium")} ET`;
  const text = `Callback moved from ${dateTime(dueAt, "medium")} ET to ${when} · ${reason}`;
  const message = `Callback rescheduled for ${when}.`;
  if (callback.dueAt === callbackAt && callback.revision === revision + 1 &&
    db.prepare("SELECT 1 FROM lead_events WHERE id = ? AND leadId = ? AND actor = ? AND kind = 'Note' AND text = ?")
      .get(eventId, callback.leadId, actor, text)) return { message };
  if (callback.dueAt !== dueAt || callback.revision !== revision) return unavailable;
  if (callback.disposition !== "Active") return { error: "Reopen the loan before rescheduling this callback." };
  if (loanOutreachSuppressed(db, loanId)) return { error: "This borrower opted out of brokerage outreach." };
  if (callbackAt <= now) return { error: "Choose a callback time in the future." };
  if (callbackAt === dueAt) return { error: "Choose a different callback time." };
  if (callbackEventExists(db, eventId)) return { error: "This callback update identifier is already in use." };
  db.prepare("UPDATE tasks SET dueAt = ? WHERE id = ? AND loanId = ?").run(callbackAt, taskId, loanId);
  db.prepare("UPDATE campaign_follow_up_runs SET promiseDueAt = ? WHERE id = ? AND coalesce(promiseDueAt, dueAt) > ?")
    .run(callbackAt, callback.runId, now);
  advanceLeadRevision(db, callback.leadId);
  writeCallbackEvent(db, { loanId, leadId: callback.leadId, eventId, text, actor, now, kind: "Note", outcome: null });
  return { message };
}

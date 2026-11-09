import { callbackPerformanceQuery, callbackPerformanceStatuses, callbackPerformanceUnavailable,
  type CallbackPerformancePage, type CallbackPerformanceStatus } from "./campaign-callback-performance-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const pageSize = 20;
const cohortMilliseconds = 30 * 86_400_000;
const effectiveDueAt = "coalesce(run.promiseDueAt, run.dueAt)";
const attemptedAt = "coalesce(run.promiseClosedAt, attempt.at)";
const pendingOnLoan = "(carried.id IS NOT NULL AND carried.completedAt IS NULL AND loan.disposition IN ('Active', 'On hold'))";
const performanceStatus = `CASE
  WHEN run.promiseAttemptEventId IS NOT NULL AND ${attemptedAt} IS NOT NULL
    THEN CASE WHEN ${attemptedAt} <= ${effectiveDueAt} THEN 'On time' ELSE 'Late' END
  WHEN run.promiseClosedAt IS NOT NULL AND NOT ${pendingOnLoan} THEN 'Closed without attempt'
  WHEN ${pendingOnLoan} AND loan.disposition = 'On hold' THEN 'On hold'
  WHEN lead.resolvedAt IS NULL AND lead.heldAt IS NOT NULL THEN 'On hold'
  WHEN ${effectiveDueAt} <= ? THEN 'Overdue'
  ELSE 'Upcoming' END`;
const cohort = `FROM campaign_follow_up_runs run
  JOIN referral_leads lead ON lead.id = run.leadId
  LEFT JOIN lead_events attempt ON attempt.id = run.promiseAttemptEventId AND attempt.leadId = run.leadId AND attempt.kind = 'Call'
  LEFT JOIN call_campaign_members member ON member.leadId = run.leadId AND member.campaignId = run.campaignId
    AND member.attempts = run.callNumber AND member.callbackTaskId = run.taskId AND member.lastOutcome = 'Requested callback'
  LEFT JOIN tasks carried ON member.leadId IS NOT NULL AND carried.id = run.taskId AND carried.loanId = lead.loanId
    AND (run.promiseCloseReason = '1003 started' OR attempt.id IS NOT NULL)
  LEFT JOIN loans loan ON loan.id = carried.loanId
  WHERE run.campaignId = ? AND run.promiseRequestEventId IS NOT NULL AND run.at >= ? AND run.at <= ?`;

type Item = CallbackPerformancePage["items"][number];
type Event = NonNullable<Item["request"]>;
type Row = Omit<Item, "request" | "attempt"> & { at: string } &
  Record<"requestId" | "requestAt" | "requestActor" | "requestText" | "attemptId" | "attemptAt" | "attemptActor" | "attemptText", string | null>;

function evidence(id: string | null, at: string | null, actor: string | null, text: string | null): Event | null {
  return id && at ? { id, at, actor: actor ?? "", text: text ?? "" } : null;
}

export function readCampaignCallbackPerformance(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date()): CallbackPerformancePage | { error: string } {
  if (staff?.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin" || staff.brokerage.pilot !== true) {
    return { error: callbackPerformanceUnavailable };
  }
  const parsed = callbackPerformanceQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid campaign callback performance view and page." };
  const { campaignId, status, after } = parsed.data;
  const checkedAt = now.toISOString();
  const since = new Date(now.getTime() - cohortMilliseconds).toISOString();
  const bindings = [checkedAt, campaignId, since, checkedAt];
  const counts = Object.fromEntries(callbackPerformanceStatuses.map((state) => [state, 0])) as CallbackPerformancePage["counts"];
  const totals = db.prepare(`SELECT ${performanceStatus} AS performanceStatus, count(*) AS total ${cohort} GROUP BY performanceStatus`)
    .all(...bindings) as unknown as { performanceStatus: CallbackPerformanceStatus; total: number }[];
  for (const { performanceStatus: state, total } of totals) counts[state] = total;

  // The page cursor narrows the indexed cohort. Fetch request evidence only
  // after selecting the page so a wide result never returns all event text.
  const rows = db.prepare(`WITH classified AS (
    SELECT run.id, run.at, run.leadId, run.promiseRequestEventId, lead.name, carried.id IS NOT NULL AS continuedOnLoan,
      CASE WHEN loan.id IS NOT NULL THEN coalesce(nullif(loan.officer, ''), loan.officerEmail, 'Unassigned')
        WHEN lead.officerEmail IS NULL THEN 'Shared inbox' ELSE coalesce(nullif(lead.officer, ''), lead.officerEmail) END AS owner,
      run.dueAt AS originalDueAt, ${effectiveDueAt} AS dueAt, carried.dueAt AS scheduledAt,
      CASE WHEN ${pendingOnLoan} AND attempt.id IS NULL THEN NULL
        WHEN attempt.id IS NULL THEN coalesce(carried.completedAt, run.promiseClosedAt) ELSE ${attemptedAt} END AS closedAt,
      CASE WHEN ${pendingOnLoan} THEN NULL
        WHEN carried.completedAt IS NOT NULL AND attempt.id IS NULL THEN 'Loan task completed without a call outcome'
        ELSE run.promiseCloseReason END AS closeReason,
      ${performanceStatus} AS performanceStatus,
      attempt.id AS attemptId, attempt.at AS attemptAt, attempt.actor AS attemptActor, attempt.text AS attemptText
    ${cohort} ${after ? "AND (run.at, run.id) < (?, ?)" : ""}
  ), page AS MATERIALIZED (
    SELECT * FROM classified ${status ? "WHERE performanceStatus = ?" : ""} ORDER BY at DESC, id DESC LIMIT ?
  )
  SELECT page.*, page.performanceStatus AS status, request.id AS requestId, request.at AS requestAt, request.actor AS requestActor, request.text AS requestText
  FROM page LEFT JOIN lead_events request ON request.id = page.promiseRequestEventId AND request.leadId = page.leadId
    AND request.kind = 'Call' AND request.outcome = 'Requested callback'
  ORDER BY page.at DESC, page.id DESC`)
    .all(...bindings, ...(after ? [after.at, after.id] : []), ...(status ? [status] : []), pageSize + 1) as unknown as Row[];
  const items = rows.slice(0, pageSize).map(({ id, name, owner, originalDueAt, dueAt, closedAt, closeReason, continuedOnLoan, scheduledAt, status: state,
    requestId, requestAt, requestActor, requestText, attemptId, attemptAt, attemptActor, attemptText }) => ({
    id, name, owner, originalDueAt, dueAt, closedAt, closeReason, status: state, ...(continuedOnLoan ? { continuedOnLoan: true } : {}),
    ...(scheduledAt && scheduledAt !== dueAt ? { scheduledAt } : {}),
    request: evidence(requestId, requestAt, requestActor, requestText), attempt: evidence(attemptId, attemptAt, attemptActor, attemptText),
  }));
  const last = rows.length > pageSize ? rows[pageSize - 1] : null;
  return { counts, items, next: last ? { at: last.at, id: last.id } : null };
}

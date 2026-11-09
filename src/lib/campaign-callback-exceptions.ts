import { callbackExceptionQuery, callbackExceptionUnavailable,
  type CampaignCallbackException, type CampaignCallbackExceptionPage } from "./campaign-callback-exceptions-model";
import { carriedCallbackSource, openCarriedCallback } from "./carried-campaign-callback";
import { blockedOutreachKeys, openCallbackPromise, outreachSuppressed } from "./outreach-preferences";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const pageSize = 20;
const scanSize = 60;
const promiseSource = `FROM campaign_follow_up_runs run
  JOIN call_campaign_members member ON member.leadId = run.leadId AND member.campaignId = run.campaignId
  JOIN referral_leads lead ON lead.id = run.leadId`;
const overduePromise = `${openCallbackPromise} AND run.promiseDueAt <= ? AND run.outcome = 'Requested callback'
  AND member.attempts = run.callNumber AND member.lastOutcome = run.outcome
  AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL`;
const leadIdentity = "lead.id AS leadId, lead.email, lead.phone, lead.importedContactId AS contactId";
type Candidate = Omit<CampaignCallbackException, "request" | "needsRecovery" | "loanTask"> & {
  needsRecovery: number; requestAt: string | null; requestActor: string | null; requestText: string | null;
  email: string; phone: string; contactId: string | null;
  loanId: string | null; taskId: string | null;
};

export function isOpenOverdueCallbackPromise(db: Store, promiseId: string, leadId: string, nowISO: string) {
  const row = db.prepare(`SELECT ${leadIdentity} ${promiseSource} WHERE ${overduePromise} AND run.id = ? AND lead.id = ?`)
    .get(nowISO, promiseId, leadId);
  return !!row && !outreachSuppressed(blockedOutreachKeys(db, [row]), row);
}

export function readCampaignCallbackExceptions(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date()): CampaignCallbackExceptionPage | { error: string } {
  if (staff?.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin" || staff.brokerage.pilot !== true) {
    return { error: callbackExceptionUnavailable };
  }
  const parsed = callbackExceptionQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid campaign callback exception filter and page." };
  const { campaignId, ownerEmail, after } = parsed.data;
  const candidates = db.prepare(`WITH promises AS (
    SELECT run.id, ${leadIdentity}, run.campaignId, lead.name, lead.officer, lead.officerEmail AS ownerEmail,
      run.promiseDueAt AS dueAt, task.dueAt AS scheduledAt, run.status IN ('Failed', 'Paused') AS needsRecovery,
      run.promiseRequestEventId, NULL AS loanId, NULL AS taskId
    ${promiseSource}
    LEFT JOIN lead_import_tasks task ON task.id = run.taskId AND task.id = member.callbackTaskId AND task.leadId = lead.id AND task.completedAt IS NULL
    WHERE ${overduePromise}
    UNION ALL
    SELECT run.id, lead.id AS leadId, borrower.email, borrower.phone, loan.contactId, run.campaignId, borrower.name,
      loan.officer, loan.officerEmail, run.promiseDueAt, task.dueAt, 0, run.promiseRequestEventId, loan.id, task.id
    ${carriedCallbackSource} JOIN contacts borrower ON borrower.id = loan.contactId
    WHERE ${openCarriedCallback} AND run.promiseDueAt <= ?
  ), selected AS MATERIALIZED (
    SELECT * FROM promises
    WHERE 1 = 1 ${campaignId ? "AND campaignId = ?" : ""}
      ${ownerEmail === null ? "AND ownerEmail IS NULL" : ownerEmail ? "AND ownerEmail = ?" : ""}
      ${after ? "AND (dueAt, id) > (?, ?)" : ""}
    ORDER BY dueAt, id LIMIT ?
  )
  SELECT selected.*, campaign.name AS campaignName,
      CASE WHEN selected.ownerEmail IS NULL THEN CASE WHEN loanId IS NULL THEN 'Shared inbox' ELSE 'Unassigned' END
        ELSE coalesce(nullif(selected.officer, ''), selected.ownerEmail) END AS owner,
      request.at AS requestAt, request.actor AS requestActor, request.text AS requestText
    FROM selected JOIN call_campaigns campaign ON campaign.id = selected.campaignId
    LEFT JOIN lead_events request ON request.id = selected.promiseRequestEventId AND request.leadId = selected.leadId
      AND request.kind = 'Call' AND request.outcome = 'Requested callback'
    ORDER BY selected.dueAt, selected.id`)
    .all(now.toISOString(), now.toISOString(), ...(campaignId ? [campaignId] : []), ...(ownerEmail ? [ownerEmail] : []),
      ...(after ? [after.dueAt, after.id] : []), scanSize + 1) as unknown as Candidate[];
  const scan = candidates.slice(0, scanSize);
  const suppressed = blockedOutreachKeys(db, scan);
  const items: CampaignCallbackException[] = [];
  let consumed = 0;
  for (const row of scan) {
    consumed++;
    if (outreachSuppressed(suppressed, row)) continue;
    const { id, leadId, campaignId, campaignName, name, owner, ownerEmail, dueAt, scheduledAt, needsRecovery, requestAt, requestActor, requestText,
      loanId, taskId } = row;
    const request = requestAt ? { at: requestAt, actor: requestActor ?? "", text: requestText ?? "" } : null;
    items.push({ id, leadId, campaignId, campaignName, name, owner, ownerEmail, dueAt, scheduledAt, needsRecovery: Boolean(needsRecovery), request,
      ...(loanId && taskId && scheduledAt ? { loanTask: { loanId, taskId, dueAt: scheduledAt } } : {}) });
    if (items.length === pageSize) break;
  }
  const last = candidates[consumed - 1];
  return { items, next: last && consumed < candidates.length ? { dueAt: last.dueAt, id: last.id } : null };
}

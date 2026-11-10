import { leadBorrowerHoursSql, leadChannelBlocksSql, storedBorrowerHours } from "./borrower-channels";
import { borrowerChannelBits } from "./borrower-channel-model";
import { nextBorrowerContactTime } from "./borrower-hours";
import { easternDate } from "./client-retention";
import { carriedCallbackSource, openCarriedCallback } from "./carried-campaign-callback";
import { campaignCallbackSource, openCampaignCallback } from "./officer-queue";
import { changeDashboardView, readDashboardViews } from "./dashboard-views";
import { fundingLoanPage, fundingTotals } from "./funding-dashboard";
import { outreachSuppressed, outreachSuppressionKeys } from "./outreach-preferences";
import { ownerScorecardFilters, ownerScorecardQuery, ownerScorecardSetting, ownerScorecardUnavailable,
  type OwnerScorecardResult, type OwnerWorkCursor, type OwnerWorkRow } from "./owner-scorecard-model";
import { readSalesDashboard } from "./sales-dashboard";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { conditionTarget } from "./uwm-alert-model";
import { searchTaskTarget } from "./workspace-search-model";

const pageSize = 20;
const ownerKey = (name: string, email: string) =>
  `CASE WHEN ${email} IS NOT NULL THEN 'email:' || ${email} ELSE 'name:' || coalesce(${name}, '') END`;
const ownerLabel = (name: string) => `coalesce(nullif(${name}, ''), 'Unassigned')`;
const currentLoan = "loan.disposition = 'Active' AND loan.stage NOT IN ('Closed', 'Funded')";
const loanOwner = ownerKey("loan.officer", "loan.officerEmail");
const leadOwner = ownerKey("lead.officer", "lead.officerEmail");
const contactOwner = ownerKey("task.followUpOwner", "task.followUpOwnerEmail");
const exactOwner = (owner: string) => owner ? "AND ownerId = ?" : "";

type FollowUp = {
  id: string; at: string; name: string; title: string; owner: string; kind: "loan" | "contact" | "lead" | "lead-task" | "campaign" | "sequence";
  leadId: string | null; loanId: string | null; contactId: string | null; email: string | null; phone: string | null; hours: string | null;
  purpose: string | null;
};

function overdueFollowUps(db: Store, owner: string, checkedAt: string, today: string) {
  const step = "json_extract(template.steps, '$[' || run.position || ']')";
  const channel = `CASE json_extract(${step}, '$.channel') WHEN 'Call' THEN ${borrowerChannelBits.Call}
    WHEN 'Email' THEN ${borrowerChannelBits.Email} WHEN 'Text' THEN ${borrowerChannelBits.Text} END`;
  const leadColumns = `lead.name, ${ownerLabel("lead.officer")} AS owner, ${leadOwner} AS ownerId,
    lead.id AS leadId, NULL AS loanId, lead.importedContactId AS contactId, lead.email, lead.phone`;
  const leadOpen = "lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND member.lastOutcome IS NOT 'Opted out'";
  const leadJoins = `FROM referral_leads lead LEFT JOIN call_campaign_members member ON member.leadId = lead.id
    LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id`;
  const activeSequence = `run.dueAt IS NOT NULL AND run.outcome IS NULL AND follow.replyReceivedAt IS NULL
    AND json_extract(${step}, '$.title') IS NOT NULL AND (${leadChannelBlocksSql} & (${channel})) = 0`;
  const columns = "(id, at, title, kind, name, owner, ownerId, leadId, loanId, contactId, email, phone, hours, purpose)";
  const candidates = db.prepare(`WITH loanAndContactWork ${columns} AS (
    SELECT task.id, task.dueAt AS at, task.title, 'loan' AS kind, borrower.name, ${ownerLabel("loan.officer")} AS owner,
      ${loanOwner} AS ownerId, lead.id AS leadId, loan.id AS loanId, loan.contactId, borrower.email, borrower.phone, NULL AS hours,
      'Prospecting' AS purpose
    ${carriedCallbackSource} JOIN contacts borrower ON borrower.id = loan.contactId
    WHERE ${openCarriedCallback} AND (coalesce((SELECT blocked FROM borrower_contact_channels WHERE contactId = loan.contactId), 0) & ${borrowerChannelBits.Call}) = 0
    UNION ALL
    SELECT task.id, task.dueAt, task.title, 'loan', borrower.name, ${ownerLabel("loan.officer")}, ${loanOwner},
      NULL, loan.id, loan.contactId, NULL, NULL, NULL, NULL
    FROM tasks task JOIN loans loan ON loan.id = task.loanId JOIN contacts borrower ON borrower.id = loan.contactId
    WHERE loan.disposition = 'Active' AND task.completedAt IS NULL AND task.id GLOB 'application-follow-up:*'
    UNION ALL
    SELECT task.id, task.dueAt, CASE task.outcome WHEN 'Requested callback' THEN 'Borrower callback' ELSE 'Contact follow-up' END,
      'contact', contact.name, ${ownerLabel("task.followUpOwner")}, ${contactOwner}, NULL, NULL, contact.id, contact.email, contact.phone, NULL, task.purpose
    FROM contact_activity task JOIN contacts contact ON contact.id = task.contactId
    WHERE task.completedAt IS NULL AND task.dueAt IS NOT NULL
  ), leadWork ${columns} AS (
    SELECT task.id, task.dueAt, task.title, 'campaign', ${leadColumns}, NULL, 'Prospecting'
    ${campaignCallbackSource()} WHERE ${openCampaignCallback} AND (${leadChannelBlocksSql} & ${borrowerChannelBits.Call}) = 0
    UNION ALL
    SELECT task.id, task.dueAt, task.title, 'lead-task', ${leadColumns}, NULL, task.purpose
    ${leadJoins} JOIN lead_import_tasks task ON task.leadId = lead.id
    WHERE lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND task.completedAt IS NULL AND member.callbackTaskId IS NOT task.id
      AND (task.purpose IS NOT 'Prospecting' OR member.lastOutcome IS NOT 'Opted out')
    UNION ALL
    SELECT lead.id, lead.dueAt, 'First contact', 'lead', ${leadColumns}, NULL, 'Prospecting'
    ${leadJoins} WHERE ${leadOpen} AND follow.firstContactAt IS NULL AND follow.replyReceivedAt IS NULL
      AND (member.leadId IS NULL OR (${leadChannelBlocksSql} & ${borrowerChannelBits.Call}) = 0)
      AND NOT EXISTS (SELECT 1 FROM lead_import_tasks task WHERE task.leadId = lead.id AND task.completedAt IS NULL)
      AND NOT EXISTS (SELECT 1 FROM campaign_sequence_enrollments run JOIN campaign_sequence_versions template ON template.version = run.version
        WHERE run.leadId = lead.id AND ${activeSequence})
    UNION ALL
    SELECT run.leadId || ':' || run.version || ':' || run.position, run.dueAt,
      template.kind || ' · ' || json_extract(${step}, '$.title'), 'sequence', ${leadColumns}, ${leadBorrowerHoursSql}, 'Prospecting'
    ${leadJoins} JOIN campaign_sequence_enrollments run ON run.leadId = lead.id
    JOIN campaign_sequence_versions template ON template.version = run.version
    WHERE ${leadOpen} AND member.leadId IS NOT NULL AND ${activeSequence}
  ), due AS (
    SELECT * FROM loanAndContactWork UNION ALL SELECT * FROM leadWork
  ) SELECT id, at, title, kind, name, owner, leadId, loanId, contactId, email, phone, hours, purpose
    FROM due WHERE at < ? AND at <> ? ${exactOwner(owner)} ORDER BY at, id, kind`)
    .all(checkedAt, today, ...(owner ? [owner] : [])) as unknown as FollowUp[];
  const suppressed = candidates.some(({ purpose }) => purpose === "Prospecting") ? outreachSuppressionKeys(db) : new Set<string>();
  return candidates.filter((row) =>
    (row.purpose !== "Prospecting" || !outreachSuppressed(suppressed, row)) &&
    (!row.hours || nextBorrowerContactTime(checkedAt, storedBorrowerHours(row.hours)) <= checkedAt));
}

function conditionCohort(owner: string) {
  return `FROM processing_open_conditions item JOIN submissions file ON file.id = item.submissionId
    JOIN loans loan ON loan.id = file.loanId JOIN contacts contact ON contact.id = loan.contactId
    WHERE ${currentLoan} ${owner ? `AND (${loanOwner}) = ?` : ""}`;
}

function countConditionFiles(db: Store, owner: string) {
  const count = db.prepare(`SELECT count(DISTINCT loan.id) AS count ${conditionCohort(owner)}`).get(...(owner ? [owner] : []));
  return Number(count?.count ?? 0);
}

function conditionFiles(db: Store, owner: string, after?: OwnerWorkCursor) {
  const opened = "coalesce(item.reopenedAt, item.openedAt, file.syncedAt, loan.stageSince)";
  return db.prepare(`WITH ranked AS (
    SELECT loan.id, contact.name, ${ownerLabel("loan.officer")} AS owner, item.title, item.submissionId, item.conditionId,
      ${opened} AS at,
      count(*) OVER (PARTITION BY loan.id) AS conditionCount,
      row_number() OVER (PARTITION BY loan.id ORDER BY item.reopenedAt IS NULL,
        ${opened}, item.submissionId, item.conditionId) AS rank
    ${conditionCohort(owner)}
  ) SELECT * FROM ranked WHERE rank = 1 ${after ? "AND (at, id) > (?, ?)" : ""} ORDER BY at, id LIMIT ?`)
    .all(...(owner ? [owner] : []), ...(after ? [after.at, after.id] : []), pageSize + 1) as unknown as (OwnerWorkCursor & {
      name: string; owner: string; title: string; submissionId: string; conditionId: string; conditionCount: number;
    })[];
}

function page(rows: OwnerWorkRow[]): OwnerScorecardResult {
  const last = rows[pageSize - 1];
  return { kind: "work", rows: rows.slice(0, pageSize), next: rows.length > pageSize ? { at: last.at, id: last.id } : null };
}

export function readOwnerScorecard(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()): OwnerScorecardResult {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.id !== brokerageId) return { error: ownerScorecardUnavailable };
  const parsed = ownerScorecardQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose valid scorecard filters and an inclusive date range of up to 366 days." };
  const query = parsed.data;
  const { owner } = query;
  const checkedAt = now.toISOString();
  const today = easternDate(now);
  if (query.kind === "summary") {
    const sales = readSalesDashboard(db, { ...query, channel: "Campaigns", windowDays: 0 }, staff, brokerageId, now);
    if (!("kind" in sales) || sales.kind !== "summary") return { error: "Campaign conversion is unavailable." };
    const owners = db.prepare(`SELECT id, max(name) AS name FROM (
      SELECT ${loanOwner} AS id, ${ownerLabel("loan.officer")} AS name FROM loans loan
      UNION ALL SELECT ${leadOwner}, ${ownerLabel("lead.officer")} FROM referral_leads lead
      UNION ALL SELECT ${contactOwner}, ${ownerLabel("task.followUpOwner")} FROM contact_activity task WHERE task.dueAt IS NOT NULL
    ) GROUP BY id ORDER BY name COLLATE NOCASE, id LIMIT 100`).all()
      .map((row) => ({ id: String(row.id), name: String(row.name) }));
    return { kind: "summary", checkedAt, sales: { groups: sales.groups, next: sales.next, periods: sales.periods }, owners,
      counts: { followUps: overdueFollowUps(db, owner, checkedAt, today).length, conditions: countConditionFiles(db, owner) },
      funding: { projected: fundingTotals(db, "projected", query, owner), actual: fundingTotals(db, "actual", query, owner) },
      views: readDashboardViews(db, "Owner scorecard", ownerScorecardFilters) };
  }
  const { metric, after } = query;
  if (metric === "followUps") return page(overdueFollowUps(db, owner, checkedAt, today)
    .filter((row) => !after || row.at > after.at || (row.at === after.at && row.id > after.id))
    .slice(0, pageSize + 1).map(({ id, at, title, name, owner, kind, loanId, leadId, contactId }) => ({
      id, at, title, name, owner, destination: kind === "loan" ? { kind, loanId: loanId!, target: searchTaskTarget(id) } :
        kind === "contact" ? { kind, contactId: contactId! } : { kind: "lead", leadId: leadId!, task: kind },
    })));
  if (metric === "conditions") {
    const rows = conditionFiles(db, owner, after);
    return page(rows.map(({ id, at, name, title, owner, submissionId, conditionId, conditionCount }) => ({
      id, at, name, title, owner, conditionCount, destination: { kind: "loan", loanId: id, target: conditionTarget(submissionId, conditionId) },
    })));
  }
  const result = fundingLoanPage(db, metric, query, owner, after && { date: after.at, id: after.id });
  return { kind: "work", rows: result.loans.map(({ date, id, name, officer, stage, amount }) => ({
    id, at: date, name, owner: officer || "Unassigned", title: stage, amount,
    destination: { kind: "loan", loanId: id, target: metric === "actual" ? "loan-funding" : "closing-workbench" },
  })), next: result.next && { at: result.next.date, id: result.next.id } };
}

export function changeOwnerScorecardSettings(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string): { error: string } | { message: string } {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.id !== brokerageId) return { error: ownerScorecardUnavailable };
  const parsed = ownerScorecardSetting.safeParse(input);
  if (!parsed.success) return { error: "Check the scorecard view name and filters." };
  return db.transaction(() => changeDashboardView(db, staff, "Owner scorecard", parsed.data, new Date().toISOString()));
}

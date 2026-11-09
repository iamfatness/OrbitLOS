import type { Store } from "./store";
import { reportFilters, type ManagerRecord, type ManagerReports, type ReturningClientReportRow } from "./manager-report-model";
import { outreachSuppressed } from "./outreach-preferences";
import { fundingTaskId, reversedFundingTaskPrefix } from "./playbook-model";

function returningClientReport(db: Store, suppression: Set<string>): ReturningClientReportRow[] {
  const activities = db.prepare(`SELECT activity.id, contact.name, activity.contactId, loan.id AS loanId,
      coalesce(loan.officer, activity.officer) AS officer, CASE WHEN loan.id IS NULL THEN activity.officerEmail ELSE loan.officerEmail END AS officerEmail,
      activity.createdAt, activity.outcome, activity.kind, activity.dueAt, activity.completedAt,
      activity.followUpOwner, activity.followUpOwnerEmail, activity.purpose, contact.email, contact.phone
    FROM funding_check_ins checkIn JOIN contact_activity activity ON activity.id = checkIn.activityId
    JOIN contacts contact ON contact.id = activity.contactId LEFT JOIN loans loan ON loan.id = checkIn.loanId`)
    .all() as unknown as (Pick<ReturningClientReportRow, "id" | "name" | "contactId" | "loanId" | "officer" | "officerEmail"> & {
      createdAt: string; outcome: string | null; kind: string; dueAt: string | null; completedAt: string | null;
      followUpOwner: string | null; followUpOwnerEmail: string | null; purpose: string; email: string; phone: string;
    })[];
  const results: ReturningClientReportRow[] = [];
  for (const row of activities) {
    const { id, name, contactId, loanId, officer, officerEmail } = row;
    results.push({ id, name, contactId, loanId, officer, officerEmail, metric: "check-ins",
      at: row.createdAt, detail: [row.kind, row.outcome].filter(Boolean).join(" · ") });
    const blocked = row.purpose === "Prospecting" && outreachSuppressed(suppression, { contactId, email: row.email, phone: row.phone });
    if (row.outcome === "Requested callback" && row.dueAt && !row.completedAt && !blocked) {
      results.push({ id, name, contactId, loanId, officer: row.followUpOwner ?? "", officerEmail: row.followUpOwnerEmail,
        metric: "callbacks", at: row.dueAt, detail: row.purpose });
    }
  }
  const borrowerTask = fundingTaskId("", "borrower");
  const retiredSuffix = `:${borrowerTask}`;
  const legacy = db.prepare(`SELECT task.id, 'check-ins' AS metric, contact.name, loan.contactId, loan.id AS loanId,
      loan.officer, loan.officerEmail, task.completedAt AS at, 'Marked complete' AS detail
    FROM tasks task JOIN loans loan ON loan.id = task.loanId JOIN contacts contact ON contact.id = loan.contactId
    WHERE task.completedAt IS NOT NULL AND (task.id = ? || loan.id OR
      (instr(task.id, ?) = 1 AND substr(task.id, -length(? || loan.id)) = ? || loan.id))
      AND NOT EXISTS (SELECT 1 FROM funding_check_ins checkIn JOIN contact_activity activity ON activity.id = checkIn.activityId
        WHERE checkIn.loanId = loan.id AND activity.createdAt = task.completedAt)`)
    .all(borrowerTask, reversedFundingTaskPrefix, retiredSuffix, retiredSuffix) as unknown as ReturningClientReportRow[];
  const applications = db.prepare(`SELECT loan.id, 'applications' AS metric, contact.name, loan.contactId, loan.id AS loanId,
      loan.officer, loan.officerEmail, loan.purpose, repeat.fundedLoanId AS sourceLoanId, coalesce(loan.createdAt, loan.stageSince) AS at,
      CASE WHEN closing.fundingDate IS NOT NULL THEN 'Funded' WHEN application.correctionNote <> '' THEN 'Corrections requested'
        WHEN application.reviewedAt IS NOT NULL THEN 'Reviewed' WHEN application.submittedAt IS NOT NULL THEN 'Submitted' ELSE 'Draft' END AS detail
    FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
    JOIN applications application ON application.loanId = loan.id LEFT JOIN closing_progress closing ON closing.loanId = loan.id
    LEFT JOIN returning_client_loans repeat ON repeat.loanId = loan.id
    WHERE loan.leadSource = 'Returning client' OR repeat.loanId IS NOT NULL`)
    .all() as unknown as ReturningClientReportRow[];
  return [...results, ...legacy, ...applications];
}

export function managerReportRecords(db: Store, suppression: Set<string>, leadIds?: string[]): ManagerRecord[] {
  if (leadIds?.length === 0) return [];
  const records = db.prepare(`
    WITH files AS (
      SELECT loan.id, contact.name, loan.officer, loan.officerEmail, loan.leadSource AS source,
        loan.createdAt, loan.amount, plan.targetDate, progress.fundingDate, loan.contactId, contact.email, contact.phone,
        loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed') AS active,
        coalesce((SELECT min(submittedAt) FROM application_versions WHERE loanId = loan.id), app.submittedAt) AS submittedAt,
        (SELECT min(createdAt) FROM activity WHERE loanId = loan.id AND outcome IS NOT NULL) AS firstContactAt,
        firstContact.dueAt
      FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
      LEFT JOIN closing_plans plan ON plan.loanId = loan.id
      LEFT JOIN closing_progress progress ON progress.loanId = loan.id
      LEFT JOIN applications app ON app.loanId = loan.id
      LEFT JOIN tasks firstContact ON firstContact.id = 'first-contact:' || loan.id
      ${leadIds ? "WHERE loan.id IN (SELECT loanId FROM referral_leads WHERE id IN (SELECT value FROM json_each(?)))" : ""}
    )
    SELECT lead.id, lead.id AS leadId, file.id AS loanId, lead.name,
      coalesce(file.officer, lead.officer) AS officer,
      CASE WHEN file.id IS NULL THEN lead.officerEmail ELSE file.officerEmail END AS officerEmail,
      coalesce(lead.importSource, CASE WHEN lead.realtorId IS NULL THEN 'Website quote request' ELSE 'Realtor referral' END) AS source,
      campaign.id AS campaignId, campaign.name AS campaignName, segment.id AS segmentId, segment.name AS segmentName,
      lead.createdAt, coalesce(follow.firstContactAt, file.firstContactAt) AS firstContactAt, follow.replyReceivedAt, lead.dueAt,
      file.submittedAt, lead.resolvedAt, coalesce(file.amount, 0) AS amount, file.targetDate, file.fundingDate,
      coalesce(file.active, lead.resolvedAt IS NULL AND lead.heldAt IS NULL) AS active,
      coalesce(file.contactId, lead.importedContactId) AS contactId, lead.email, lead.phone
    FROM referral_leads lead LEFT JOIN files file ON file.id = lead.loanId
    LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    LEFT JOIN call_campaign_members member ON member.leadId = lead.id
    LEFT JOIN call_campaigns campaign ON campaign.id = member.campaignId
    LEFT JOIN crm_segments segment ON segment.id = member.segmentId
    ${leadIds ? "WHERE lead.id IN (SELECT value FROM json_each(?))" : `UNION ALL
    SELECT file.id, NULL, file.id, file.name, file.officer, file.officerEmail, file.source, NULL, NULL, NULL, NULL,
      file.createdAt, file.firstContactAt, NULL, file.dueAt, file.submittedAt, NULL, file.amount, file.targetDate, file.fundingDate, file.active,
      file.contactId, file.email, file.phone
    FROM files file WHERE NOT EXISTS (SELECT 1 FROM referral_leads WHERE loanId = file.id)`}
    ORDER BY ${leadIds ? "lead.createdAt DESC, lead.id" : "createdAt DESC, id"}
  `).all(...(leadIds ? [JSON.stringify(leadIds), JSON.stringify(leadIds)] : [])) as unknown as
    (Omit<ManagerRecord, "outreachSuppressed"> & { contactId: string | null; email: string; phone: string })[];
  return records.map(({ contactId, email, phone, ...item }) => ({ ...item,
    outreachSuppressed: outreachSuppressed(suppression, { leadId: item.leadId, contactId, email, phone }) }));
}

export function managerReports(db: Store, suppression: Set<string>): ManagerReports {
  const views = db.prepare("SELECT * FROM manager_report_views ORDER BY name COLLATE NOCASE, id").all()
    .map((row) => ({ id: String(row.id), name: String(row.name), filters: reportFilters.parse(JSON.parse(String(row.filters))) }));
  return { records: managerReportRecords(db, suppression), views, returningClients: returningClientReport(db, suppression) };
}

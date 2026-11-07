import type { Store } from "./store";
import type { ManagerRecord, ManagerReports } from "./manager-report-model";

export function managerReports(db: Store): ManagerReports {
  const records = db.prepare(`
    WITH files AS (
      SELECT loan.id, contact.name, loan.officer, loan.officerEmail, loan.leadSource AS source,
        loan.createdAt, loan.amount, plan.targetDate, progress.fundingDate,
        loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed') AS active,
        coalesce((SELECT min(submittedAt) FROM application_versions WHERE loanId = loan.id), app.submittedAt) AS submittedAt,
        (SELECT min(createdAt) FROM activity WHERE loanId = loan.id AND outcome IS NOT NULL) AS firstContactAt,
        firstContact.dueAt
      FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
      LEFT JOIN closing_plans plan ON plan.loanId = loan.id
      LEFT JOIN closing_progress progress ON progress.loanId = loan.id
      LEFT JOIN applications app ON app.loanId = loan.id
      LEFT JOIN tasks firstContact ON firstContact.id = 'first-contact:' || loan.id
    )
    SELECT lead.id, lead.id AS leadId, file.id AS loanId, lead.name,
      coalesce(file.officer, lead.officer) AS officer,
      CASE WHEN file.id IS NULL THEN lead.officerEmail ELSE file.officerEmail END AS officerEmail,
      coalesce(lead.importSource, CASE WHEN lead.realtorId IS NULL THEN 'Website quote request' ELSE 'Realtor referral' END) AS source,
      lead.createdAt, coalesce(follow.firstContactAt, file.firstContactAt) AS firstContactAt, lead.dueAt,
      file.submittedAt, lead.resolvedAt, coalesce(file.amount, 0) AS amount, file.targetDate, file.fundingDate,
      coalesce(file.active, lead.resolvedAt IS NULL) AS active
    FROM referral_leads lead LEFT JOIN files file ON file.id = lead.loanId
    LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    UNION ALL
    SELECT file.id, NULL, file.id, file.name, file.officer, file.officerEmail, file.source,
      file.createdAt, file.firstContactAt, file.dueAt, file.submittedAt, NULL, file.amount, file.targetDate, file.fundingDate, file.active
    FROM files file WHERE NOT EXISTS (SELECT 1 FROM referral_leads WHERE loanId = file.id)
    ORDER BY createdAt DESC, id
  `).all() as unknown as ManagerRecord[];
  const views = db.prepare("SELECT * FROM manager_report_views ORDER BY name COLLATE NOCASE, id").all()
    .map((row) => ({ id: String(row.id), name: String(row.name), filters: JSON.parse(String(row.filters)) }));
  return { records, views };
}

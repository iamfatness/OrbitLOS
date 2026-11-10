import { campaignManagerQuery, campaignManagerUnavailable, type CampaignManagerPage, type CampaignManagerRow } from "./campaign-manager-model";
import { outreachSuppressed, outreachSuppressionKeys } from "./outreach-preferences";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const pageSize = 20;
type Candidate = Omit<CampaignManagerRow, "owner" | "overdue" | "archived"> & {
  officer: string;
  officerEmail: string | null;
  email: string;
  phone: string;
  contactId: string | null;
  resolvedAt: string | null;
  archiveToken: string | null;
  heldAt: string | null;
  replyReceivedAt: string | null;
  replied: number;
  optedOut: number;
  sequenceDueAt: string | null;
  sequenceTitle: string | null;
  callbackDueAt: string | null;
  requestedCallback: number;
};

export function readCampaignManager(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date()): CampaignManagerPage | { error: string } {
  if (staff?.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin" || staff.brokerage.pilot !== true) {
    return { error: campaignManagerUnavailable };
  }
  const parsed = campaignManagerQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid campaign report and page." };
  const { campaignId, view, page: requestedPage } = parsed.data;
  if (!db.prepare("SELECT 1 FROM call_campaigns WHERE id = ?").get(campaignId)) return { error: "This campaign is unavailable." };

  const checkedAt = now.toISOString();
  // One narrow scan of the selected campaign. The opt-out lookup follows the same contact aliases as Today.
  const candidates = db.prepare(`SELECT lead.id AS leadId, lead.name, lead.email, lead.phone,
    coalesce(loan.contactId, lead.importedContactId) AS contactId, loan.id AS loanId,
    coalesce(loan.officer, lead.officer) AS officer,
    CASE WHEN loan.id IS NULL THEN lead.officerEmail ELSE loan.officerEmail END AS officerEmail,
    lead.resolvedAt, lead.archiveToken, lead.heldAt, follow.replyReceivedAt,
    (follow.replyReceivedAt IS NOT NULL OR EXISTS (SELECT 1 FROM lead_events event
      WHERE event.leadId = lead.id AND event.outcome = 'Reply received' AND event.at >= member.joinedAt)) AS replied,
    (member.lastOutcome IS 'Opted out' OR sequence.outcome IS 'Opted out') AS optedOut,
    sequence.dueAt AS sequenceDueAt, json_extract(template.steps, '$[' || sequence.position || '].title') AS sequenceTitle,
    callback.dueAt AS callbackDueAt, (member.lastOutcome IS 'Requested callback') AS requestedCallback
    FROM call_campaign_members member
    JOIN referral_leads lead ON lead.id = member.leadId
    LEFT JOIN loans loan ON loan.id = lead.loanId
    LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    LEFT JOIN campaign_sequence_enrollments sequence ON sequence.leadId = lead.id
    LEFT JOIN campaign_sequence_versions template ON template.version = sequence.version
    LEFT JOIN lead_import_tasks callback ON callback.id = member.callbackTaskId AND callback.leadId = lead.id
      AND callback.completedAt IS NULL AND callback.dueAt < ?
    WHERE member.campaignId = ?`).all(checkedAt, campaignId) as unknown as Candidate[];
  const suppression = outreachSuppressionKeys(db);
  const counts = { overdue: 0, replies: 0, conversions: 0, optOuts: 0 };
  const matching: CampaignManagerRow[] = [];
  for (const row of candidates) {
    const optedOut = Boolean(row.optedOut) || outreachSuppressed(suppression, row);
    const overdue: CampaignManagerRow["overdue"] = [];
    if (!row.loanId && !row.resolvedAt && !row.heldAt && !optedOut) {
      if (!row.replyReceivedAt && row.sequenceDueAt && row.sequenceDueAt < checkedAt && row.sequenceTitle) {
        overdue.push({ title: `New Lead · ${row.sequenceTitle}`, dueAt: row.sequenceDueAt });
      }
      if (row.callbackDueAt && (!row.replyReceivedAt || row.requestedCallback)) {
        overdue.push({ title: row.requestedCallback ? "Campaign callback" : "Campaign call retry", dueAt: row.callbackDueAt });
      }
      overdue.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    }
    const includes = { overdue: overdue.length > 0, replies: Boolean(row.replied), conversions: Boolean(row.loanId), optOuts: optedOut };
    counts.overdue += Number(includes.overdue);
    counts.replies += Number(includes.replies);
    counts.conversions += Number(includes.conversions);
    counts.optOuts += Number(includes.optOuts);
    if (includes[view]) {
      matching.push({ leadId: row.leadId, name: row.name, loanId: row.loanId, archived: Boolean(row.archiveToken),
        owner: row.officerEmail ? row.officer || row.officerEmail : row.loanId ? "Unassigned" : "Shared inbox", overdue });
    }
  }
  matching.sort((a, b) => (view === "overdue" ? a.overdue[0].dueAt.localeCompare(b.overdue[0].dueAt) : 0) ||
    a.name.localeCompare(b.name) || a.leadId.localeCompare(b.leadId));
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(requestedPage, pages);
  return { counts, items: matching.slice((page - 1) * pageSize, page * pageSize), page, pages };
}

import { campaignManagerUnavailable } from "./campaign-manager-model";
import { sequenceSteps, type CampaignSequenceKind } from "./campaign-sequence-model";
import { sequencePerformanceQuery, type SequencePerformancePage } from "./campaign-sequence-performance-model";
import { outreachSuppressed, outreachSuppressionKeys } from "./outreach-preferences";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const pageSize = 20;
type Candidate = {
  leadId: string; name: string; officer: string; officerEmail: string | null;
  loanId: string | null; archiveToken: string | null; email: string; phone: string; contactId: string | null;
  resolvedAt: string | null; heldAt: string | null; optedOut: number;
  position: number; dueAt: string | null; outcome: string | null;
  replyAt: string | null; replyPosition: number | null; touchedSteps: number;
};

export function readCampaignSequencePerformance(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date()): SequencePerformancePage | { error: string } {
  if (staff?.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin" || staff.brokerage.pilot !== true) {
    return { error: campaignManagerUnavailable };
  }
  const parsed = sequencePerformanceQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid sequence report and page." };
  const { campaignId, drilldown, page: requestedPage } = parsed.data;
  if (!db.prepare("SELECT 1 FROM call_campaigns WHERE id = ?").get(campaignId)) return { error: "This campaign is unavailable." };
  const versions = db.prepare(`SELECT template.kind, run.version, count(*) AS enrolled FROM call_campaign_members member
    JOIN campaign_sequence_enrollments run ON run.leadId = member.leadId
    JOIN campaign_sequence_versions template ON template.version = run.version
    WHERE member.campaignId = ? GROUP BY run.version ORDER BY run.version DESC`).all(campaignId)
    .map(({ kind, version, enrolled }) => ({ kind: kind as CampaignSequenceKind, version: Number(version), enrolled: Number(enrolled) }));
  const version = parsed.data.version ?? versions[0]?.version ?? null;
  if (version === null) return { versions, version, steps: [], unattributed: 0, items: [], page: 1, pages: 1 };
  const template = versions.some((item) => item.version === version) &&
    db.prepare("SELECT steps FROM campaign_sequence_versions WHERE version = ?").get(version);
  if (!template) return { error: "This sequence version is unavailable for the selected campaign." };
  const steps = sequenceSteps.parse(JSON.parse(String(template.steps))).map(({ title, channel }) => ({
    title, channel, touches: 0, replies: 0, stalled: 0,
  }));
  if (drilldown && "position" in drilldown && !steps[drilldown.position]) return { error: "This sequence step is unavailable." };

  const checkedAt = now.toISOString();
  // A six-bit mask keeps the read to one result row per lead. The last tracked touch before the first reply gets credit.
  const candidates = db.prepare(`WITH cohort AS (
    SELECT lead.id AS leadId, lead.name, lead.email, lead.phone, coalesce(loan.contactId, lead.importedContactId) AS contactId,
      loan.id AS loanId, coalesce(loan.officer, lead.officer) AS officer,
      CASE WHEN loan.id IS NULL THEN lead.officerEmail ELSE loan.officerEmail END AS officerEmail,
      lead.archiveToken, lead.resolvedAt, lead.heldAt, (member.lastOutcome IS 'Opted out') AS optedOut,
      run.position, run.dueAt, run.outcome,
      coalesce(follow.replyReceivedAt, (SELECT min(event.at) FROM lead_events event WHERE event.leadId = lead.id
        AND event.outcome = 'Reply received' AND event.at >= member.joinedAt)) AS replyAt
    FROM call_campaign_members member JOIN campaign_sequence_enrollments run ON run.leadId = member.leadId
    JOIN referral_leads lead ON lead.id = member.leadId LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    LEFT JOIN loans loan ON loan.id = lead.loanId WHERE member.campaignId = ? AND run.version = ?
  ) SELECT cohort.*,
    coalesce((SELECT sum(1 << touch.position) FROM campaign_sequence_touches touch WHERE touch.leadId = cohort.leadId), 0) AS touchedSteps,
    (SELECT max(touch.position) FROM campaign_sequence_touches touch WHERE touch.leadId = cohort.leadId AND touch.at <= cohort.replyAt) AS replyPosition
    FROM cohort`).all(campaignId, version) as unknown as Candidate[];
  const suppression = outreachSuppressionKeys(db);
  const matching: SequencePerformancePage["items"] = [];
  let unattributed = 0;
  for (const row of candidates) {
    for (const [position, step] of steps.entries()) step.touches += Number(Boolean(row.touchedSteps & (1 << position)));
    const replyPosition = row.replyAt && row.replyPosition !== null && steps[row.replyPosition] ? row.replyPosition : null;
    if (row.replyAt) {
      if (replyPosition === null) unattributed++;
      else steps[replyPosition].replies++;
    }
    const stalled = Boolean(steps[row.position] && row.dueAt && row.dueAt < checkedAt && row.outcome === null &&
      !row.replyAt && !row.loanId && !row.resolvedAt && !row.heldAt && !row.optedOut && !outreachSuppressed(suppression, row));
    if (stalled) steps[row.position].stalled++;
    if (!drilldown) continue;

    let matches: boolean;
    switch (drilldown.metric) {
      case "unattributed": matches = Boolean(row.replyAt) && replyPosition === null; break;
      case "touches": matches = Boolean(row.touchedSteps & (1 << drilldown.position)); break;
      case "replies": matches = replyPosition === drilldown.position; break;
      case "stalled": matches = stalled && row.position === drilldown.position; break;
    }
    if (matches) matching.push({
      leadId: row.leadId, name: row.name, loanId: row.loanId, archived: Boolean(row.archiveToken),
      owner: row.officerEmail ? row.officer || row.officerEmail : row.loanId ? "Unassigned" : "Shared inbox",
      when: drilldown.metric === "stalled" ? row.dueAt : drilldown.metric === "touches" ? null : row.replyAt,
    });
  }
  matching.sort((a, b) => (drilldown?.metric === "stalled" && a.when && b.when ? a.when.localeCompare(b.when) : 0) ||
    a.name.localeCompare(b.name) || a.leadId.localeCompare(b.leadId));
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(requestedPage, pages);
  return { versions, version, steps, unattributed, items: matching.slice((page - 1) * pageSize, page * pageSize), page, pages };
}

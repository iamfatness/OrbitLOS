import type { CampaignAssignment, CampaignResponseRecord } from "./campaign-response-model";
import type { Store } from "./store";

export function closeCampaignAssignment(db: Store, leadId: string, now: string) {
  db.prepare("UPDATE campaign_assignment_history SET endedAt = ? WHERE leadId = ? AND endedAt IS NULL").run(now, leadId);
}

export function beginCampaignAssignment(db: Store, leadId: string, now: string) {
  closeCampaignAssignment(db, leadId, now);
  db.prepare(`INSERT INTO campaign_assignment_history (leadId, officerEmail, officer, assignedAt)
    SELECT lead.id, lead.officerEmail, lead.officer, ? FROM referral_leads lead
    JOIN call_campaign_members member ON member.leadId = lead.id WHERE lead.id = ?`).run(now, leadId);
}

export function recordCampaignFirstOutreach(db: Store, leadId: string, now: string) {
  db.prepare(`UPDATE campaign_assignment_history SET firstOutreachAt = ?
    WHERE leadId = ? AND endedAt IS NULL AND firstOutreachAt IS NULL`).run(now, leadId);
}

type AssignmentSpan = CampaignAssignment & { endedAt: string | null; firstOutreachAt: string | null };
type ResponseRow = Pick<CampaignResponseRecord, "leadId" | "campaignId" | "name" | "loanId" | "dueAt"> &
  { resolvedAt: string | null; firstContactAt: string | null; replyReceivedAt: string | null };
const assignment = ({ email, officer, assignedAt }: AssignmentSpan): CampaignAssignment => ({
  email, officer: email ? officer : "Shared inbox", assignedAt,
});

export function campaignResponses(db: Store, leadIds?: string | string[]): CampaignResponseRecord[] {
  if (Array.isArray(leadIds) && !leadIds.length) return [];
  const condition = typeof leadIds === "string" ? "= ?" : leadIds ? "IN (SELECT value FROM json_each(?))" : "";
  const bindings = leadIds ? [typeof leadIds === "string" ? leadIds : JSON.stringify(leadIds)] : [];
  const byLead = new Map<string, AssignmentSpan[]>();
  const history = db.prepare(`SELECT leadId, officerEmail AS email, officer, assignedAt, endedAt, firstOutreachAt
    FROM campaign_assignment_history ${condition ? `WHERE leadId ${condition}` : ""} ORDER BY id`)
    .all(...bindings) as unknown as (AssignmentSpan & { leadId: string })[];
  for (const span of history) {
    const spans = byLead.get(span.leadId) ?? [];
    if (!byLead.has(span.leadId)) byLead.set(span.leadId, spans);
    spans.push(span);
  }
  const rows = db.prepare(`SELECT lead.id AS leadId, member.campaignId, lead.name, lead.loanId, lead.dueAt, lead.resolvedAt, follow.firstContactAt, follow.replyReceivedAt
    FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id ${condition ? `WHERE lead.id ${condition}` : ""}
    ORDER BY lead.dueAt, lead.id`).all(...bindings) as unknown as ResponseRow[];
  return rows.map(({ resolvedAt, firstContactAt, ...row }) => {
    const spans = byLead.get(row.leadId) ?? [];
    const trackedAt = spans[0]?.assignedAt ?? null;
    const last = spans.at(-1);
    const closedAt = last?.endedAt ?? resolvedAt;
    const deadline = (!closedAt || row.dueAt < closedAt) && spans.findLast((span) =>
      span.assignedAt <= row.dueAt && (!span.endedAt || row.dueAt < span.endedAt));
    const outreach = spans.find((span) => span.firstOutreachAt);
    return {
      ...row, trackedAt, closedAt,
      contactedBeforeTracking: Boolean(trackedAt && firstContactAt && firstContactAt <= trackedAt && !outreach),
      currentAssignment: last && !closedAt ? assignment(last) : null,
      deadlineAssignment: deadline ? assignment(deadline) : null,
      firstOutreach: outreach?.firstOutreachAt ? { at: outreach.firstOutreachAt, assignment: assignment(outreach) } : null,
    };
  });
}

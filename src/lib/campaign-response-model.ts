export interface CampaignAssignment {
  email: string | null;
  officer: string;
  assignedAt: string;
}

export interface CampaignResponseRecord {
  leadId: string;
  campaignId: string;
  name: string;
  loanId: string | null;
  dueAt: string;
  trackedAt: string | null;
  closedAt: string | null;
  contactedBeforeTracking: boolean;
  currentAssignment: CampaignAssignment | null;
  deadlineAssignment: CampaignAssignment | null;
  firstOutreach: { at: string; assignment: CampaignAssignment } | null;
  replyReceivedAt: string | null;
}

export function campaignResponseStatus(record: CampaignResponseRecord, now: number) {
  if (!record.trackedAt) return "Ownership untracked";
  if (record.contactedBeforeTracking) return "Contacted before tracking";
  if (!record.deadlineAssignment && record.dueAt < record.trackedAt) return "Deadline before tracking";
  if (record.firstOutreach?.at && record.firstOutreach.at <= record.dueAt) return "On time";
  if (record.replyReceivedAt && record.replyReceivedAt <= record.dueAt) return "Reply received before deadline";
  if (record.closedAt && record.closedAt <= record.dueAt) return "Closed before deadline";
  if (record.deadlineAssignment && Date.parse(record.dueAt) < now) return "Missed deadline";
  return "Awaiting first outreach";
}

export function assignmentResponseMinutes(record: CampaignResponseRecord) {
  const first = record.firstOutreach;
  if (!first?.assignment.email) return null;
  return (Date.parse(first.at) - Date.parse(first.assignment.assignedAt)) / 60_000;
}

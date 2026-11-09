import { z } from "zod";
import type { CallCampaign, CallCampaignMember, CampaignLeadOption, CampaignQueueFile, CampaignRehearsal } from "./call-campaign-model";
import type { CampaignResponseRecord } from "./campaign-response-model";
import type { CrmSegment } from "./crm-segment-model";
import type { ConvertedLead } from "./lead-inbox-model";
import { applyLoanMutation, campaignFileForLoan, type EditableLoan } from "./loan-work-model";
import type { ManagerRecord } from "./manager-report-model";
import type { InboxLead, ReferralReview, UnlinkedReferral, Workspace } from "./model";
import type { MigrationReport } from "./pipeline-migration-model";

export const leadWorkUnavailable = "This lead is no longer open in your workspace.";
export const leadTaskUnavailable = "This lead is no longer in your work queue. Refresh the queue.";
const workId = z.string().min(1).max(100);
export const leadWorkRequest = z.object({
  leadId: workId,
  callbackPromiseId: z.uuid().optional(),
  task: z.object({ kind: z.enum(["lead", "campaign", "lead-task"]), id: z.string().min(1).max(200), team: z.literal(true).optional(),
    expectedCallbackAt: z.iso.datetime().optional() }).optional(),
});
export type LeadWorkRequest = z.infer<typeof leadWorkRequest>;

export type LeadWorkRecord = {
  lead: InboxLead;
  campaign: CallCampaign | null;
  member: CallCampaignMember | null;
};

export type LeadMutationResult = {
  leadWork: LeadWorkRecord;
  message: string;
  manager?: { campaignResponse: CampaignResponseRecord | null; unlinkedReferral: UnlinkedReferral | null };
};

export type CampaignWorkPatch = {
  inboxLeads: InboxLead[];
  callCampaignMembers: CallCampaignMember[];
  campaignResponses: CampaignResponseRecord[];
  unlinkedReferrals: UnlinkedReferral[];
  managerRecords: ManagerRecord[];
  campaignRehearsal: CampaignRehearsal | null;
};

export type CampaignMutationResult = {
  campaignWork: CampaignWorkPatch | null;
  message: string;
  migration?: MigrationReport;
};

export type CampaignQueueSnapshot = {
  campaignId: string;
  campaign: CallCampaign | null;
  inboxLeads: InboxLead[];
  members: CallCampaignMember[];
  responses: CampaignResponseRecord[];
  files: CampaignQueueFile[];
  rehearsal: CampaignRehearsal | null;
};

export type CampaignQueueResult = { campaignQueue: CampaignQueueSnapshot; message: string };

export type CampaignNavigation = {
  campaigns: CallCampaign[];
  queue: CampaignQueueSnapshot | null;
  intake?: { segments: CrmSegment[]; availableLeads: CampaignLeadOption[] };
};

export type CampaignNavigationResult = { campaignNavigation: CampaignNavigation; message: string };

function upsert<T>(items: T[], changed: T[], key: (item: T) => string) {
  if (!changed.length) return items;
  const byId = new Map(items.map((item) => [key(item), item]));
  for (const item of changed) byId.set(key(item), item);
  return [...byId.values()];
}

const byId = ({ id }: { id: string }) => id;
const byLeadId = ({ leadId }: { leadId: string }) => leadId;
const byDeadline = (a: { id: string; dueAt: string }, b: { id: string; dueAt: string }) =>
  a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id);

export function applyCampaignNavigation(state: Workspace, { campaigns, queue, intake }: CampaignNavigation): Workspace {
  const visible = new Set(campaigns.map(byId));
  const gone = state.callCampaignMembers.filter(({ campaignId }) => !visible.has(campaignId));
  const leadIds = new Set(gone.map(byLeadId));
  const fileIds = new Set(gone.map(({ loanId }) => loanId));
  const next: Workspace = { ...state,
    callCampaigns: campaigns,
    callCampaignMembers: state.callCampaignMembers.filter(({ campaignId }) => visible.has(campaignId)),
    inboxLeads: state.inboxLeads.filter(({ id }) => !leadIds.has(id)),
    referralLeads: state.referralLeads.filter(({ id }) => !leadIds.has(id)),
    campaignResponses: state.campaignResponses.filter(({ campaignId }) => visible.has(campaignId)),
    ...(state.campaignQueueFiles ? { campaignQueueFiles: state.campaignQueueFiles.filter(({ id }) => !fileIds.has(id)) } : {}),
    campaignRehearsal: state.campaignRehearsal && visible.has(state.campaignRehearsal.campaignId) ? state.campaignRehearsal : null,
    ...(intake ? { crmSegments: intake.segments, campaignLeadOptions: intake.availableLeads } : {}),
  };
  return queue ? applyCampaignQueue(next, queue) : next;
}

export function applyCampaignQueue(state: Workspace, queue: CampaignQueueSnapshot): Workspace {
  const { campaignId, campaign, members, inboxLeads, responses, files, rehearsal } = queue;
  const previous = state.callCampaignMembers.filter((member) => member.campaignId === campaignId);
  const leadIds = new Set([...previous, ...members].map(byLeadId));
  const fileIds = new Set(previous.map(({ loanId }) => loanId));
  const otherLeads = <T extends { id: string }>(rows: T[]) => rows.filter(({ id }) => !leadIds.has(id));
  const referrals = inboxLeads.flatMap((lead) => {
    const referral = referralReview(lead);
    return referral ? [referral] : [];
  });
  return { ...state,
    callCampaigns: replace(state.callCampaigns, campaign, ({ id }) => id === campaignId),
    callCampaignMembers: [...state.callCampaignMembers.filter((member) => member.campaignId !== campaignId), ...members],
    inboxLeads: [...otherLeads(state.inboxLeads), ...inboxLeads].sort(byDeadline),
    referralLeads: [...otherLeads(state.referralLeads), ...referrals].sort(byDeadline),
    campaignResponses: [...state.campaignResponses.filter((item) => item.campaignId !== campaignId), ...responses],
    campaignQueueFiles: upsert((state.campaignQueueFiles ?? []).filter(({ id }) => !fileIds.has(id)), files, byId),
    campaignRehearsal: state.campaignRehearsal?.campaignId === campaignId ? rehearsal : rehearsal ?? state.campaignRehearsal,
  };
}

export function applyLeadConversion(state: Workspace, lead: ConvertedLead, work: EditableLoan, queue?: CampaignQueueSnapshot): Workspace {
  const next = queue ? applyCampaignQueue(state, queue) : state;
  const matchesMember = (member: CallCampaignMember) => member.leadId === lead.id && member.campaignId === lead.campaignId;
  const member = next.callCampaignMembers.find(matchesMember) ?? state.callCampaignMembers.find(matchesMember);
  return applyLoanMutation({
    ...next,
    inboxLeads: next.inboxLeads.filter(({ id }) => id !== lead.id),
    referralLeads: next.referralLeads.filter(({ id }) => id !== lead.id),
    unlinkedReferrals: next.unlinkedReferrals.filter(({ id }) => id !== lead.id),
    ...(member ? {
      callCampaignMembers: replace(next.callCampaignMembers, { ...member, loanId: work.loanId, resolvedAt: lead.resolvedAt }, matchesMember),
      campaignQueueFiles: upsert(next.campaignQueueFiles ?? [], [campaignFileForLoan(work)], byId),
    } : {}),
  }, work);
}

export function applyCampaignMutation(state: Workspace, patch: CampaignWorkPatch): Workspace {
  const { inboxLeads, callCampaignMembers, campaignResponses, unlinkedReferrals, managerRecords, campaignRehearsal } = patch;
  const leads = upsert(state.inboxLeads, inboxLeads, byId);
  const referrals = upsert(state.referralLeads, inboxLeads.flatMap((lead) => {
    const referral = referralReview(lead);
    return referral ? [referral] : [];
  }), byId);
  return { ...state, campaignRehearsal,
    inboxLeads: leads === state.inboxLeads ? leads : leads.sort(byDeadline),
    referralLeads: referrals === state.referralLeads ? referrals : referrals.sort(byDeadline),
    callCampaignMembers: upsert(state.callCampaignMembers, callCampaignMembers, byLeadId),
    campaignResponses: upsert(state.campaignResponses, campaignResponses, byLeadId),
    unlinkedReferrals: upsert(state.unlinkedReferrals, unlinkedReferrals, byId),
    managerReports: state.managerReports && { ...state.managerReports,
      records: upsert(state.managerReports.records, managerRecords, byId),
    },
  };
}

function replace<T>(items: T[], value: T | null, matches: (item: T) => boolean): T[] {
  if (!value) return items.filter((item) => !matches(item));
  if (!items.some(matches)) return [value, ...items];
  return items.map((item) => matches(item) ? value : item);
}

function referralReview(lead: InboxLead): ReferralReview | null {
  const { id, realtorId, realtorName, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, matches, restrictedMatch } = lead;
  return realtorId && realtorName !== null ?
    { id, realtorId, realtorName, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, matches, restrictedMatch } : null;
}

export function applyLeadWork(state: Workspace, { lead, campaign, member }: LeadWorkRecord): Workspace {
  const matchesLead = ({ id }: { id: string }) => id === lead.id;
  return { ...state,
    inboxLeads: replace(state.inboxLeads, lead, matchesLead),
    referralLeads: replace(state.referralLeads, referralReview(lead), matchesLead),
    callCampaignMembers: replace(state.callCampaignMembers, member, (item) => item.leadId === lead.id),
    callCampaigns: campaign ? replace(state.callCampaigns, campaign, ({ id }) => id === campaign.id) : state.callCampaigns,
  };
}

export function applyLeadMutation(state: Workspace, { leadWork, manager }: LeadMutationResult): Workspace {
  const next = applyLeadWork(state, leadWork);
  if (!manager) return next;
  const { id, officer, officerEmail, followUp, outreachSuppressed } = leadWork.lead;
  return { ...next,
    campaignResponses: replace(state.campaignResponses, manager.campaignResponse, (item) => item.leadId === id),
    unlinkedReferrals: replace(state.unlinkedReferrals, manager.unlinkedReferral, (item) => item.id === id),
    managerReports: state.managerReports && { ...state.managerReports,
      records: state.managerReports.records.map((item) => item.leadId === id && !item.loanId ? {
        ...item, officer, officerEmail, firstContactAt: followUp.firstContactAt, replyReceivedAt: followUp.replyReceivedAt, outreachSuppressed,
      } : item),
    },
  };
}

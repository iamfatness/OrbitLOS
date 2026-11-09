import type { BrokerageMember } from "./brokerage-model";
import { z } from "zod";
import { leadSources, type InboxLead } from "./model";
import { campaignFollowUpWork, contactFollowUpExceptions, ownerRecoveryWork, type CampaignFollowUpWork, type ContactFollowUpWork,
  type OwnerRecoveryWork, type PlaybookFacts, type PlaybookSettings, type PlaybookWork } from "./playbook-model";

export const managerExceptionTypes = ["All exceptions", "Campaign recovery", "Overdue", "Unassigned", "Owner unavailable", "Stalled handoffs"] as const;
export type ManagerExceptionFilters = {
  type: (typeof managerExceptionTypes)[number]; source: InboxLead["source"] | ""; campaign: string;
};
export const defaultManagerExceptionFilters: ManagerExceptionFilters = { type: "All exceptions", source: "", campaign: "" };
type CampaignRecoveryWork = Omit<CampaignFollowUpWork, "kind"> & { kind: "campaign-recovery" };
export type ExceptionWork = PlaybookWork | OwnerRecoveryWork | ContactFollowUpWork | CampaignFollowUpWork | CampaignRecoveryWork;

export function managerExceptions(state: PlaybookFacts, work: PlaybookWork[], members: BrokerageMember[] | null,
  signedIn: boolean, now: number, filters: ManagerExceptionFilters) {
  const officers = members?.filter((member) => member.role !== "Processor") ?? [];
  const processors = members?.filter((member) => member.role === "Processor") ?? [];
  const primaryOwnerWork = new Set(work.filter((item) => item.kind === "review" || item.kind === "prepare" || item.kind === "funding").map((item) => item.recordId));
  const processorWork = new Set(work.filter((item) => item.kind === "accept").map((item) => item.recordId));
  const leads = new Map(state.inboxLeads.map((lead) => [lead.id, lead]));
  const campaigns = new Map(state.callCampaigns.map((campaign) => [campaign.id, campaign]));
  const campaignRecovery = signedIn ? state.callCampaignMembers.flatMap((member): CampaignRecoveryWork[] => {
    const lead = leads.get(member.leadId);
    const campaign = campaigns.get(member.campaignId);
    const run = member.followUpRun;
    if (!lead || !campaign || !run || !member.followUpRunStatus || member.resolvedAt || lead.outreachSuppressed || member.outreachSuppressed) return [];
    const requested = member.lastOutcome === "Requested callback";
    const reason = lead.heldAt ? "The lead is on hold. Reactivate it before restoring the follow-up." :
      !requested && campaign.automaticPaused ? "Automatic retries are paused. Resume them before restoring this retry." :
      requested ? "Restore the borrower-requested callback at its original time." : "Restore the call retry at its original time.";
    return [{ id: run.id, recordId: lead.id, kind: "campaign-recovery", campaignId: campaign.id, name: lead.name,
      title: member.followUpRunStatus === "Paused" ? "Paused campaign retry" : "Interrupted campaign follow-up",
      owner: lead.officer, ownerEmail: lead.officerEmail, dueAt: run.dueAt, reason }];
  }) : [];
  const campaignWork = [...campaignFollowUpWork(state), ...campaignRecovery];
  const campaignDeadlines = new Map(campaignWork.map((item) => [item.recordId, item.dueAt]));
  const recovery = members ? ownerRecoveryWork(state, members).filter((item) =>
    !(item.kind === "lead-owner" && campaignDeadlines.get(item.recordId) === item.dueAt) &&
    !(item.kind === "loan-owner" && primaryOwnerWork.has(item.recordId)) &&
    !(item.kind === "processor-owner" && processorWork.has(item.recordId))) : [];
  const recoveryLeads = new Set(recovery.filter((item) => item.kind === "lead-owner").map((item) => item.recordId));
  const queue: ExceptionWork[] = [...work.filter((item) => item.kind !== "lead" || !recoveryLeads.has(item.recordId)), ...recovery,
    ...campaignWork, ...contactFollowUpExceptions(state, members ? officers : null, now)];
  return queue.flatMap((item) => {
    const needsRecovery = item.kind === "campaign-recovery";
    const overdue = !!item.dueAt && Date.parse(item.dueAt) <= now;
    const unassigned = item.kind === "assign" || (signedIn ? !item.ownerEmail : !item.owner);
    const unavailable = item.kind !== "assign" && !!members && !!item.ownerEmail &&
      !(item.kind === "accept" || item.kind === "processor-owner" ? processors : officers).some((member) => member.email === item.ownerEmail);
    const stalled = overdue && (item.kind === "assign" || item.kind === "prepare" || item.kind === "accept");
    if (!(needsRecovery || overdue || unassigned || unavailable)) return [];
    if (filters.type === "Campaign recovery" && !needsRecovery || filters.type === "Overdue" && !overdue || filters.type === "Unassigned" && !unassigned ||
      filters.type === "Owner unavailable" && !unavailable || filters.type === "Stalled handoffs" && !stalled) return [];

    const lead = item.kind === "lead" || item.kind === "lead-owner" || item.kind === "campaign-follow-up" || needsRecovery ? leads.get(item.recordId) : undefined;
    const campaign = lead?.campaignId ? campaigns.get(lead.campaignId) : undefined;
    if (filters.source && lead?.source !== filters.source) return [];
    if (filters.campaign === "none" && (!lead || campaign)) return [];
    if (filters.campaign && filters.campaign !== "none" && campaign?.id !== filters.campaign) return [];
    return [{ item, overdue, unassigned, unavailable, stalled, intake: lead && { source: lead.source, campaign: campaign && { id: campaign.id, name: campaign.name } } }];
  }).sort((a, b) => (a.item.dueAt ?? "9999").localeCompare(b.item.dueAt ?? "9999"));
}

const managerExceptionCursor = z.object({ dueAt: z.string().max(80), id: z.string().min(1).max(240) });
export const managerExceptionInput = z.discriminatedUnion("view", [
  z.object({ view: z.literal("settings") }),
  z.object({ view: z.literal("owners"), filters: z.object({ type: z.enum(managerExceptionTypes),
    source: z.union([z.enum(leadSources), z.literal("")]), campaign: z.string().max(100) }), after: managerExceptionCursor.optional() }),
]);
export type ManagerExceptionQuery = z.infer<typeof managerExceptionInput>;
export type ManagerExceptionRow = ReturnType<typeof managerExceptions>[number] & { otherOwner: string | null; processingRevision: number };
export type ManagerExceptionPage = { kind: "owners"; rows: ManagerExceptionRow[]; next: z.infer<typeof managerExceptionCursor> | null };
export type ManagerExceptionSettings = { kind: "settings"; policy: PlaybookSettings; members: BrokerageMember[] | null;
  campaigns: Pick<PlaybookFacts["callCampaigns"][number], "id" | "name">[] };
export type ManagerExceptionResult = ManagerExceptionPage | ManagerExceptionSettings | { error: string };
export type PlaybookSettingsMutation = { playbookSettings: PlaybookSettings; message: string };
export const managerExceptionsUnavailable = "Could not load manager exceptions. Try again.";

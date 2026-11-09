import { z } from "zod";
import type { BrokerageMember } from "./brokerage-model";
import { prospectingBlocked, type ContactActivity, type Workspace } from "./model";
import { secondReviewBlocker } from "./application-model";

export const documentReminderTimingLimit = 14;
export const secondReviewDueDaysLimit = 14;
export const defaultManualReturnHours = 24;
export const manualReturnHoursLimit = 168;

export const savePlaybookInput = z.object({
  type: z.literal("savePlaybook"), revision: z.number().int().nonnegative(),
  quietHours: z.number().int().min(1).max(336), reviewHours: z.number().int().min(1).max(168),
  handoffHours: z.number().int().min(1).max(168), fundingDays: z.number().int().min(0).max(90),
  manualReturnHours: z.number().int().min(1).max(manualReturnHoursLimit).optional(),
  documentReminderOffsetDays: z.number().int().min(-documentReminderTimingLimit).max(documentReminderTimingLimit).optional(),
  backupEmail: z.email().max(254).nullable(),
  secondReview: z.object({ reviewerEmail: z.email().max(254), dueDays: z.number().int().min(0).max(secondReviewDueDaysLimit) }).nullable().optional(),
  requireSecondReview: z.boolean().optional(),
});

export type PlaybookSettings = Omit<z.infer<typeof savePlaybookInput>, "type" | "documentReminderOffsetDays" | "secondReview" | "requireSecondReview" | "manualReturnHours"> & {
  documentReminderOffsetDays: number; secondReview: Exclude<z.infer<typeof savePlaybookInput>["secondReview"], undefined>; requireSecondReview: boolean;
  manualReturnHours: number;
};
export const defaultPlaybook: PlaybookSettings = { revision: 0, quietHours: 48, reviewHours: 24, handoffHours: 24, fundingDays: 7,
  documentReminderOffsetDays: 0, backupEmail: null, secondReview: null, requireSecondReview: false, manualReturnHours: defaultManualReturnHours };
export const afterHours = (value: string, hours: number) => new Date(Date.parse(value) + hours * 3_600_000).toISOString();

export function documentReminderTimingLabel(offsetDays: number) {
  if (!offsetDays) return "On the borrower due date";
  const days = Math.abs(offsetDays);
  return `${days} ${days === 1 ? "day" : "days"} ${offsetDays < 0 ? "before" : "after"} the borrower due date`;
}

export const fundingTaskPrefix = "post-funding:";
export const reversedFundingTaskPrefix = "reversed-funding:";
export const fundingMilestones = { Borrower: "Post-funding check-in", Realtor: "Realtor thank-you" } as const;
export const fundingTaskId = (loanId: string, audience: "borrower" | "realtor") => `${fundingTaskPrefix}${audience}:${loanId}`;
export function fundingTaskAudience(id: string) {
  if (id.startsWith(`${fundingTaskPrefix}borrower:`)) return "Borrower";
  if (id.startsWith(`${fundingTaskPrefix}realtor:`)) return "Realtor";
  return null;
}

export interface PlaybookWork {
  id: string;
  recordId: string;
  kind: "lead" | "review" | "assign" | "prepare" | "accept" | "funding";
  title: string;
  name: string;
  owner: string;
  ownerEmail: string | null;
  dueAt: string;
  reason: string;
}

export type OwnerRecoveryWork = Omit<PlaybookWork, "kind" | "dueAt" | "ownerEmail"> & {
  dueAt: string | null;
  ownerEmail: string;
} & ({ kind: "lead-owner" } | { kind: "loan-owner" } |
  { kind: "processor-owner"; revision: number });

export type FollowUpExceptionActivity = Pick<ContactActivity, "id" | "contactId" | "kind" | "purpose" | "outcome" |
  "postFundingCheckIn" | "dueAt" | "completedAt" | "revision" | "followUpOwner" | "followUpOwnerEmail">;
export type ContactFollowUpWork = Omit<PlaybookWork, "kind"> & { kind: "contact-follow-up"; activity: FollowUpExceptionActivity };
export type CampaignFollowUpWork = Omit<PlaybookWork, "kind"> & { kind: "campaign-follow-up"; campaignId: string };

type Lead = Workspace["inboxLeads"][number];
type Member = Workspace["callCampaignMembers"][number];
type Application = Workspace["applications"][number];
export type PlaybookFacts = Pick<Workspace, "playbook"> & {
  inboxLeads: (Pick<Lead, "id" | "name" | "officer" | "officerEmail" | "dueAt" | "heldAt" | "revisitDate" | "outreachSuppressed" | "campaignId" | "source"> & {
    documentOwnership?: { awaitingBorrower: number; readyForReview: number; dueOn: string | null };
    importedTasks: Pick<Lead["importedTasks"][number], "dueAt" | "purpose" | "completedAt">[];
    followUp: Pick<Lead["followUp"], "firstContactAt" | "replyReceivedAt" | "status"> & ({
      events: Pick<Lead["followUp"]["events"][number], "at" | "outcome">[];
    } | { latestOutreach: string | null; contacted: boolean });
  })[];
  callCampaignMembers: Pick<Member, "campaignId" | "leadId" | "resolvedAt" | "lastOutcome" | "outreachSuppressed" |
    "callbackTaskId" | "callbackDueAt" | "followUpRunStatus" | "followUpRun">[];
  callCampaigns: Pick<Workspace["callCampaigns"][number], "id" | "name" | "automaticPaused">[];
  loans: Pick<Workspace["loans"][number], "id" | "contactId" | "stage" | "disposition" | "officer" | "officerEmail" | "revisitDate">[];
  loanProcessing: Pick<Workspace["loanProcessing"][number], "loanId" | "processorEmail" | "processorName" | "status" | "updatedAt" | "revision">[];
  applications: (Pick<Application, "loanId" | "submittedAt" | "reviewedAt" | "secondReviewApproved" | "correctionNote"> & { previousAnswers: unknown })[];
  contacts: Pick<Workspace["contacts"][number], "id" | "name" | "outreachSuppressed">[];
  contactActivity: FollowUpExceptionActivity[];
  tasks: Pick<Workspace["tasks"][number], "id" | "loanId" | "title" | "dueAt" | "completedAt" | "purpose">[];
};

export function campaignFollowUpWork(state: PlaybookFacts): CampaignFollowUpWork[] {
  const leads = new Map(state.inboxLeads.map((lead) => [lead.id, lead]));
  const campaigns = new Map(state.callCampaigns.map((campaign) => [campaign.id, campaign.name]));
  return state.callCampaignMembers.flatMap((member) => {
    const lead = leads.get(member.leadId);
    const campaign = campaigns.get(member.campaignId);
    if (!lead || !campaign || member.resolvedAt || lead.heldAt || lead.outreachSuppressed || member.outreachSuppressed ||
      !member.callbackTaskId || !member.callbackDueAt) return [];
    const requested = member.lastOutcome === "Requested callback";
    return [{ id: member.callbackTaskId, recordId: lead.id, kind: "campaign-follow-up", campaignId: member.campaignId,
      title: requested ? "Campaign callback" : "Campaign call retry", name: lead.name, owner: lead.officer, ownerEmail: lead.officerEmail,
      dueAt: member.callbackDueAt, reason: `${requested ? "Borrower requested a callback" : "Automatic retry after an unanswered call"} · ${campaign}` }];
  });
}

export function contactFollowUpExceptions(state: PlaybookFacts, officers: BrokerageMember[] | null, now: number): ContactFollowUpWork[] {
  const eligibleOwners = officers && new Set(officers.map((member) => member.email));
  const contacts = new Map(state.contacts.map((item) => [item.id, item]));
  const work: ContactFollowUpWork[] = [];
  for (const item of state.contactActivity) {
    const contact = contacts.get(item.contactId);
    if (!contact || !item.dueAt || item.completedAt || prospectingBlocked(item.purpose, contact.outreachSuppressed)) continue;
    const callback = item.postFundingCheckIn && item.outcome === "Requested callback";
    const unavailable = eligibleOwners && item.followUpOwnerEmail && !eligibleOwners.has(item.followUpOwnerEmail);
    if (!unavailable && !(callback && Date.parse(item.dueAt) <= now)) continue;
    work.push({ id: item.id, recordId: item.contactId, kind: "contact-follow-up", activity: item, name: contact.name,
      title: callback ? "Post-funding callback" : "Recover contact follow-up", owner: item.followUpOwner ?? "",
      ownerEmail: item.followUpOwnerEmail, dueAt: item.dueAt,
      reason: callback ? `Borrower requested a callback at their post-funding check-in · ${item.purpose}` : `${item.kind} follow-up · ${item.purpose}` });
  }
  return work;
}

export function ownerRecoveryWork(state: PlaybookFacts, members: BrokerageMember[]): OwnerRecoveryWork[] {
  const active = new Map(members.filter((member) => member.status === "Active").map((member) => [member.email, member.role]));
  const canOwnLoan = (email: string) => active.get(email) === "LO" || active.get(email) === "Admin";
  const contacts = new Map(state.contacts.map((item) => [item.id, item]));
  const work: OwnerRecoveryWork[] = [];
  for (const lead of state.inboxLeads) {
    if (!lead.officerEmail || canOwnLoan(lead.officerEmail)) continue;
    const deadlines = lead.importedTasks.filter((item) => !item.completedAt && !prospectingBlocked(item.purpose, lead.outreachSuppressed))
      .map((item) => item.dueAt);
    if (!lead.outreachSuppressed && !lead.followUp.firstContactAt && !lead.followUp.replyReceivedAt) deadlines.push(lead.dueAt);
    const dueAt = lead.heldAt ? lead.revisitDate && `${lead.revisitDate}T17:00:00.000Z` : deadlines.sort()[0] ?? null;
    work.push({ id: `lead-owner:${lead.id}`, recordId: lead.id, kind: "lead-owner", title: "Recover lead ownership", name: lead.name,
      owner: lead.officer, ownerEmail: lead.officerEmail, dueAt,
      reason: lead.heldAt ? "Reassign this lead and its revisit reminder." : "Reassign this lead and any open lead tasks or campaign follow-up." });
  }
  const processing = new Map(state.loanProcessing.map((item) => [item.loanId, item]));
  const loanDeadlines = new Map<string, string>();
  const activeLoans = state.loans.filter((loan) => (loan.disposition === "Active" || loan.disposition === "On hold") &&
    loan.stage !== "Funded" && loan.stage !== "Closed");
  const borrowers = new Map(activeLoans.map((loan) => [loan.id, contacts.get(loan.contactId)]));
  for (const task of state.tasks) {
    if (!borrowers.has(task.loanId) || task.completedAt || prospectingBlocked(task.purpose, borrowers.get(task.loanId)?.outreachSuppressed)) continue;
    const prior = loanDeadlines.get(task.loanId);
    if (!prior || task.dueAt < prior) loanDeadlines.set(task.loanId, task.dueAt);
  }
  for (const loan of activeLoans) {
    const name = borrowers.get(loan.id)?.name ?? "Borrower";
    if (loan.officerEmail && !canOwnLoan(loan.officerEmail)) {
      const dueAt = loan.disposition === "On hold" ? (loan.revisitDate ? `${loan.revisitDate}T17:00:00.000Z` : null) : loanDeadlines.get(loan.id) ?? null;
      work.push({ id: `loan-owner:${loan.id}`, recordId: loan.id, kind: "loan-owner", title: "Recover loan ownership", name,
        owner: loan.officer, ownerEmail: loan.officerEmail, dueAt,
        reason: `${loan.disposition === "On hold" ? loan.disposition : loan.stage} · Open tasks follow the new loan officer.` });
    }
    const handoff = processing.get(loan.id);
    if (!handoff?.processorEmail || active.get(handoff.processorEmail) === "Processor" ||
      handoff.status === "Unassigned" || handoff.status === "Complete") continue;
    work.push({ id: `processor-owner:${loan.id}`, recordId: loan.id, kind: "processor-owner", title: "Recover processing assignment", name,
      owner: handoff.processorName, ownerEmail: handoff.processorEmail, revision: handoff.revision,
      dueAt: loan.disposition === "Active" && handoff.status === "Ready for processing" ? afterHours(handoff.updatedAt, state.playbook.handoffHours) : null,
      reason: `${handoff.status} · The replacement processor can open the existing handoff.` });
  }
  return work;
}

export function playbookWork(state: PlaybookFacts): PlaybookWork[] {
  const policy = state.playbook;
  const work: PlaybookWork[] = [];
  const scheduledCallbacks = new Set(state.callCampaignMembers.filter((member) => member.callbackDueAt || member.followUpRunStatus).map((member) => member.leadId));
  for (const lead of state.inboxLeads) {
    const followUp = lead.followUp;
    const contacted = "events" in followUp ? followUp.events.some((event) => event.outcome === "Connected" || event.outcome === "Reply received") :
      followUp.contacted;
    if (lead.heldAt || lead.outreachSuppressed || followUp.replyReceivedAt || scheduledCallbacks.has(lead.id) || followUp.status === "Paused" || followUp.status === "Stopped" ||
      contacted) continue;
    const outreach = ("events" in followUp ? followUp.events.find((event) => event.outcome)?.at : followUp.latestOutreach) ?? followUp.firstContactAt;
    const dueAt = outreach ? afterHours(outreach, policy.quietHours) : lead.dueAt;
    work.push({ id: `quiet-lead:${lead.id}`, recordId: lead.id, kind: "lead", title: "Escalate quiet lead",
      name: lead.name, owner: lead.officer, ownerEmail: lead.officerEmail, dueAt,
      reason: outreach ? "No reply logged after the last outreach" : "First contact has not been logged" });
  }
  const applications = new Map(state.applications.map((item) => [item.loanId, item]));
  const processing = new Map(state.loanProcessing.map((item) => [item.loanId, item]));
  const contacts = new Map(state.contacts.map((item) => [item.id, item]));
  const loans = new Map(state.loans.map((item) => [item.id, item]));
  for (const loan of state.loans) {
    if (loan.disposition && loan.disposition !== "Active") continue;
    const application = applications.get(loan.id);
    const handoff = processing.get(loan.id);
    const base = { recordId: loan.id, name: contacts.get(loan.contactId)?.name ?? "Borrower", owner: loan.officer, ownerEmail: loan.officerEmail };
    if (application?.submittedAt && !application.reviewedAt) {
      const corrected = !!application.previousAnswers;
      work.push({ ...base, id: `review-1003:${loan.id}`, kind: "review", title: corrected ? "Review corrected 1003" : "Review submitted 1003",
        dueAt: afterHours(application.submittedAt, policy.reviewHours),
        reason: corrected ? "Borrower resubmitted the application with corrections" : "Borrower submitted the current application" });
      continue;
    }
    if (loan.stage === "Funded" || loan.stage === "Closed") continue;
    const awaitingApproval = secondReviewBlocker(policy.requireSecondReview, application);
    if (awaitingApproval && (handoff?.status === "Ready for processing" || handoff?.status === "Assigned")) continue;
    if (!application?.correctionNote && handoff?.status === "Ready for processing" && handoff.processorEmail) {
      work.push({ ...base, id: `accept-handoff:${loan.id}`, kind: "accept", title: "Accept processing handoff",
        owner: handoff.processorName, ownerEmail: handoff.processorEmail, dueAt: afterHours(handoff.updatedAt, policy.handoffHours),
        reason: "File sent to processing and awaiting acceptance" });
    } else if (application?.reviewedAt && (!handoff?.processorEmail || handoff.status === "Assigned" || handoff.status === "Returned to LO")) {
      const assigned = Boolean(handoff?.processorEmail);
      const returned = handoff?.status === "Returned to LO";
      work.push({ ...base, id: `prepare-handoff:${loan.id}`, kind: assigned ? "prepare" : "assign",
        title: returned ? "Review returned processing handoff" : assigned ? "Prepare processing handoff" : "Assign a processor",
        dueAt: afterHours(returned ? handoff.updatedAt : application.reviewedAt, policy.handoffHours),
        reason: returned ? "Processor returned the file" : assigned ? "Reviewed 1003 is ready for handoff" : "Reviewed 1003 has no shared processor" });
    }
  }
  for (const task of state.tasks) {
    if (task.completedAt || !fundingTaskAudience(task.id)) continue;
    const loan = loans.get(task.loanId);
    if (!loan || loan.disposition !== "Active") continue;
    work.push({ id: task.id, recordId: loan.id, kind: "funding", title: task.title,
      name: contacts.get(loan.contactId)?.name ?? "Borrower", owner: loan.officer, ownerEmail: loan.officerEmail,
      dueAt: task.dueAt, reason: "Actual funding recorded" });
  }
  return work.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

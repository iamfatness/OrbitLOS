import { z } from "zod";
import type { Workspace } from "./model";

export const savePlaybookInput = z.object({
  type: z.literal("savePlaybook"), revision: z.number().int().nonnegative(),
  quietHours: z.number().int().min(1).max(336), reviewHours: z.number().int().min(1).max(168),
  handoffHours: z.number().int().min(1).max(168), fundingDays: z.number().int().min(0).max(90),
  backupEmail: z.email().max(254).nullable(),
});

export type PlaybookSettings = Omit<z.infer<typeof savePlaybookInput>, "type">;
export const defaultPlaybook: PlaybookSettings = { revision: 0, quietHours: 48, reviewHours: 24, handoffHours: 24, fundingDays: 7, backupEmail: null };
export const afterHours = (value: string, hours: number) => new Date(Date.parse(value) + hours * 3_600_000).toISOString();

export const fundingTaskPrefix = "post-funding:";
export const fundingMilestones = { Borrower: "Post-funding check-in", Realtor: "Realtor thank-you" } as const;
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

export function playbookWork(state: Workspace): PlaybookWork[] {
  const policy = state.playbook;
  const work: PlaybookWork[] = [];
  for (const lead of state.inboxLeads) {
    const followUp = lead.followUp;
    if (followUp.status === "Paused" || followUp.status === "Stopped" ||
      followUp.events.some((event) => event.outcome === "Connected" || event.outcome === "Reply received")) continue;
    const outreach = followUp.events.find((event) => event.outcome)?.at ?? followUp.firstContactAt;
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
    if (loan.disposition !== "Active" || loan.stage === "Funded" || loan.stage === "Closed") continue;
    const application = applications.get(loan.id);
    const handoff = processing.get(loan.id);
    const base = { recordId: loan.id, name: contacts.get(loan.contactId)?.name ?? "Borrower", owner: loan.officer, ownerEmail: loan.officerEmail };
    if (application?.submittedAt && !application.reviewedAt) {
      work.push({ ...base, id: `review-1003:${loan.id}`, kind: "review", title: "Review submitted 1003",
        dueAt: afterHours(application.submittedAt, policy.reviewHours), reason: "Borrower submitted the current application" });
    } else if (!application?.correctionNote && handoff?.status === "Ready for processing" && handoff.processorEmail) {
      work.push({ ...base, id: `accept-handoff:${loan.id}`, kind: "accept", title: "Accept processing handoff",
        owner: handoff.processorName, ownerEmail: handoff.processorEmail, dueAt: afterHours(handoff.updatedAt, policy.handoffHours),
        reason: "File sent to processing and awaiting acceptance" });
    } else if (application?.reviewedAt && (!handoff?.processorEmail || handoff.status === "Assigned" || handoff.status === "Returned to LO")) {
      const assigned = Boolean(handoff?.processorEmail);
      work.push({ ...base, id: `prepare-handoff:${loan.id}`, kind: assigned ? "prepare" : "assign",
        title: assigned ? "Prepare processing handoff" : "Assign a processor",
        dueAt: afterHours(handoff?.status === "Returned to LO" ? handoff.updatedAt : application.reviewedAt, policy.handoffHours),
        reason: handoff?.status === "Returned to LO" ? "Processor returned the file" : assigned ? "Reviewed 1003 is ready for handoff" : "Reviewed 1003 has no shared processor" });
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

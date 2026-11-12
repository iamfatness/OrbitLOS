import type { z } from "zod";
import { borrowerChannelBits, borrowerChannelBlocked } from "./borrower-channel-model";
import { leadBorrowerHoursSql, leadChannelBlocksSql, storedBorrowerHours } from "./borrower-channels";
import { nextBorrowerContactTime, scheduledBorrowerContactTime } from "./borrower-hours";
import { demoBrokerageId, portalToken, type BrokerageMember } from "./brokerage-model";
import { isOpenOverdueCallbackPromise } from "./campaign-callback-exceptions";
import { callbackExceptionChanged, callbackExceptionUnavailable } from "./campaign-callback-exceptions-model";
import { defaultLeadRouting, leadArchiveRequest, leadSequenceSteps, type ArchivedLead, type LeadArchivePage,
  type LeadEvent, type LeadFollowUp, type LeadRouting, type restoreLeadInput,
  type assignInboxLeadInput, type correctLeadPropertyStateInput, type leadContactInput, type leadHoldInput, type leadOptOutInput, type leadSequenceInput, type saveLeadRoutingInput } from "./lead-inbox-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { blockedOutreachKeys, optOutLead, outreachSuppressed, outreachSuppressionKeys } from "./outreach-preferences";
import { accessEvent } from "./workspace-access";
import { beginCampaignAssignment, recordCampaignFirstOutreach } from "./campaign-response";
import { easternDate } from "./client-retention";
import { canClaimSharedRealtor, sharedRealtorQueueUnavailable } from "./realtor-claim-model";
import { readRealtorClaimPolicy } from "./realtor-claim-queue";
import { campaignSequenceCallWait } from "./campaign-sequences";
import { dateTime } from "./utils";

const hour = 3_600_000;
const after = (at: string, hours: number) => new Date(Date.parse(at) + hours * hour).toISOString();
type InboxAction = z.infer<typeof assignInboxLeadInput | typeof correctLeadPropertyStateInput | typeof leadSequenceInput | typeof leadOptOutInput | typeof leadHoldInput> |
  (Omit<z.infer<typeof leadContactInput>, "outcome"> & { outcome: NonNullable<LeadEvent["outcome"]> });
type Outcome = { message: string } | { error: string };
type LeadOwner = StaffIdentity & Partial<Pick<BrokerageMember, "role" | "status">>;

export function readLeadArchive(db: Store, staff: WorkspaceStaff | null, input: unknown): LeadArchivePage | { error: string } {
  if (staff?.brokerage.role === "Processor") return { error: "The lead archive is unavailable." };
  const parsed = leadArchiveRequest.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid lead archive search." };
  const { query, before, leadId } = parsed.data;
  const owner = staff?.brokerage.role === "LO" ? staff.email : null;
  const pageSize = 25;
  const rows = db.prepare(`SELECT lead.id, lead.name, lead.officer, lead.archiveToken, lead.resolvedAt AS archivedAt, contact.name AS realtorName,
      coalesce(lead.importSource, CASE WHEN lead.realtorId IS NULL THEN 'Website quote request' ELSE 'Realtor referral' END) AS source
    FROM referral_leads lead LEFT JOIN contacts contact ON contact.id = lead.realtorId
    WHERE lead.archiveToken IS NOT NULL AND lead.resolvedAt IS NOT NULL AND lead.loanId IS NULL
      AND (? IS NULL OR lead.officerEmail = ?)
      AND (? IS NULL OR (lead.resolvedAt, lead.id) < (?, ?))
      ${leadId ? "AND lead.id = ?" : ""}
      AND (instr(lower(lead.name), lower(?)) > 0 OR instr(lower(lead.email), lower(?)) > 0)
    ORDER BY lead.resolvedAt DESC, lead.id DESC LIMIT ?`)
    .all(owner, owner, before?.archivedAt ?? null, before?.archivedAt ?? null, before?.id ?? null,
      ...(leadId ? [leadId] : []), query, query, pageSize + 1) as unknown as ArchivedLead[];
  const leads = rows.slice(0, pageSize);
  const last = leads.at(-1);
  return { leads, next: last && rows.length > pageSize ? { archivedAt: last.archivedAt, id: last.id } : null };
}

export function leadRouting(db: Store): LeadRouting {
  const saved = db.prepare("SELECT value FROM settings WHERE key = 'leadRouting'").get();
  return saved ? JSON.parse(String(saved.value)) as LeadRouting : defaultLeadRouting;
}

export function writeLeadRouting(db: Store, routing: LeadRouting) {
  db.prepare(`INSERT INTO settings (key, value) VALUES ('leadRouting', ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run(JSON.stringify({ ...routing, revision: routing.revision + 1 }));
}

export function changeLeadRouting(db: Store, staff: WorkspaceStaff | null, data: z.infer<typeof saveLeadRoutingInput>, members: StaffIdentity[]): Outcome {
  if (staff && staff.brokerage.role !== "Admin") return { error: "Only a brokerage admin can change lead routing." };
  const current = leadRouting(db);
  if (current.revision !== data.revision) return { error: "Routing changed. Refresh the inbox before saving." };
  const realtorOwner = data.realtorRoute === "Assigned officer" ? data.realtorOwner : null;
  if ((data.realtorRoute === "Assigned officer" && !realtorOwner) ||
      [data.websiteOwner, realtorOwner].some((email) => email && !members.some((member) => member.email === email))) {
    return { error: "Select an active loan officer or admin in this brokerage." };
  }
  const id = staff?.brokerage.id ?? demoBrokerageId;
  if (data.quoteForm === "Enable or replace" && id !== demoBrokerageId && !staff?.brokerage.pilot) {
    return { error: "The fictional quote form is available in pilot workspaces." };
  }
  const quoteToken = data.quoteForm === "Keep" ? current.quoteToken : data.quoteForm === "Disable" ? null : portalToken(id);
  const next: LeadRouting = {
    revision: current.revision, websiteOwner: data.websiteOwner, realtorRoute: data.realtorRoute, realtorOwner,
    firstContactHours: data.firstContactHours, secondAfterHours: data.secondAfterHours, finalAfterHours: data.finalAfterHours, quoteToken,
  };
  writeLeadRouting(db, next);
  return { message: "Lead routing and follow-up timing saved." };
}

type FollowUpRow = Omit<LeadFollowUp, "events">;
function followUpRow(db: Store, leadId: string): FollowUpRow {
  const row = db.prepare("SELECT status, revision, nextStep, nextAt, pausedAt, firstContactAt, replyReceivedAt FROM lead_follow_up WHERE leadId = ?").get(leadId);
  return row ? row as unknown as FollowUpRow :
    { status: "Not started", revision: 0, nextStep: 0, nextAt: null, pausedAt: null, firstContactAt: null, replyReceivedAt: null };
}

export function advanceLeadRevision(db: Store, leadId: string) {
  db.prepare(`INSERT INTO lead_follow_up (leadId, revision) VALUES (?, 1)
    ON CONFLICT (leadId) DO UPDATE SET revision = revision + 1`).run(leadId);
}

export function reconcileInboxSequence(db: Store, leadId: string, now: string) {
  const row = db.prepare(`SELECT follow.nextStep, follow.nextAt, follow.baseNextAt, ${leadBorrowerHoursSql} AS hours,
    (${leadChannelBlocksSql} & ${borrowerChannelBits.Email}) AS blocked
    FROM lead_follow_up follow JOIN referral_leads lead ON lead.id = follow.leadId
    WHERE lead.id = ? AND lead.resolvedAt IS NULL AND follow.status = 'Active' AND follow.replyReceivedAt IS NULL
      AND follow.nextAt IS NOT NULL`).get(leadId);
  if (!row) return 0;
  if (!row.blocked) {
    const base = String(row.baseNextAt ?? row.nextAt);
    const next = scheduledBorrowerContactTime(base, now, storedBorrowerHours(row.hours));
    if (next !== row.nextAt) db.prepare("UPDATE lead_follow_up SET nextAt = ?, baseNextAt = ?, revision = revision + 1 WHERE leadId = ?")
      .run(next, next === base ? null : base, leadId);
    return 0;
  }
  db.prepare(`UPDATE lead_follow_up SET status = 'Completed', nextStep = ?, nextAt = NULL, baseNextAt = NULL, pausedAt = NULL, revision = revision + 1
    WHERE leadId = ?`).run(leadSequenceSteps.length, leadId);
  leadEvent(db, leadId, "Orbit", now, "Skipped the remaining mock email steps because the borrower blocks email.");
  return leadSequenceSteps.length - Number(row.nextStep);
}

export function archiveLead(db: Store, staff: WorkspaceStaff | null, leadId: string, revision: number, now: string): Outcome {
  const lead = db.prepare("SELECT officerEmail, resolvedAt, loanId FROM referral_leads WHERE id = ?").get(leadId);
  if (!lead || lead.resolvedAt || lead.loanId || staff?.brokerage.role === "Processor" ||
    (staff?.brokerage.role === "LO" && lead.officerEmail !== staff.email)) return { error: "This lead is unavailable." };
  const followUp = followUpRow(db, leadId);
  if (followUp.revision !== revision) return { error: "This lead changed. Refresh the inbox before archiving." };
  db.prepare("UPDATE referral_leads SET resolvedAt = ?, archiveToken = ? WHERE id = ?").run(now, crypto.randomUUID(), leadId);
  if (followUp.status === "Active" || followUp.status === "Paused") stopLeadFollowUp(db, leadId);
  else advanceLeadRevision(db, leadId);
  leadEvent(db, leadId, staff?.name || "Demo workspace", now, "Archived lead.");
  accessEvent(db, staff, "Archived lead", leadId, now);
  return { message: "Lead archived. You can restore it from the Lead Inbox." };
}

export function restoreArchivedLead(db: Store, staff: WorkspaceStaff | null, data: z.infer<typeof restoreLeadInput>, now: string, toShared = false): Outcome {
  const { leadId, archiveToken } = data;
  const lead = db.prepare(`SELECT officerEmail, email, phone, importedContactId AS contactId, pastClientLoanId
    FROM referral_leads WHERE id = ? AND archiveToken = ? AND resolvedAt IS NOT NULL AND loanId IS NULL`).get(leadId, archiveToken);
  if (!lead || staff?.brokerage.role === "Processor" || (staff?.brokerage.role === "LO" && lead.officerEmail !== staff.email)) {
    return { error: "This archived lead is unavailable. Refresh the archive before continuing." };
  }
  if (typeof lead.pastClientLoanId === "string" && db.prepare(`SELECT 1 FROM referral_leads WHERE pastClientLoanId = ? AND resolvedAt IS NULL
    UNION ALL SELECT 1 FROM returning_client_loans WHERE fundedLoanId = ? LIMIT 1`).get(lead.pastClientLoanId, lead.pastClientLoanId)) {
    return { error: "This borrower already has a campaign lead or a repeat 1003 for the original loan." };
  }
  db.prepare(`UPDATE referral_leads SET resolvedAt = NULL, archiveToken = NULL, realtorSharedSince =
    CASE WHEN officerEmail IS NULL AND realtorId IS NOT NULL THEN ? ELSE realtorSharedSince END WHERE id = ?`).run(now, leadId);
  advanceLeadRevision(db, leadId);
  const member = db.prepare("SELECT lastOutcome FROM call_campaign_members WHERE leadId = ?").get(leadId);
  if (toShared) saveLeadAssignment(db, leadId, undefined, now, staff?.name || "Demo workspace", true);
  else if (member && member.lastOutcome !== "Opted out" && !outreachSuppressed(outreachSuppressionKeys(db), { ...lead, leadId })) {
    beginCampaignAssignment(db, leadId, now);
  }
  leadEvent(db, leadId, staff?.name || "Demo workspace", now, "Restored lead from archive.");
  accessEvent(db, staff, "Restored archived lead", leadId, now);
  return { message: toShared ? "Lead restored to the shared queue because its previous owner is at campaign capacity." : "Lead restored to the inbox." };
}

export function leadFollowUp(db: Store, leadId: string): LeadFollowUp {
  return { ...followUpRow(db, leadId), events: db.prepare("SELECT id, at, actor, kind, outcome, text FROM lead_events WHERE leadId = ? ORDER BY at DESC, rowid DESC")
    .all(leadId).map((row) => ({ ...row }) as unknown as LeadEvent) };
}

export function leadEvent(db: Store, leadId: string, actor: string, at: string, text: string, kind: LeadEvent["kind"] = "Note",
  outcome: LeadEvent["outcome"] = null, id = crypto.randomUUID()) {
  db.prepare("INSERT INTO lead_events (id, leadId, actor, at, kind, outcome, text) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, leadId, actor, at, kind, outcome, text);
  return id;
}

export function firstContactDue(now: string, routing: LeadRouting) {
  return after(now, routing.firstContactHours);
}

export function startLeadFollowUp(db: Store, id: string, now: string, identity?: { email: string; phone: string }) {
  const suppressed = identity && outreachSuppressed(outreachSuppressionKeys(db), identity);
  db.prepare("INSERT INTO lead_follow_up (leadId, status, nextAt) VALUES (?, ?, ?)")
    .run(id, suppressed ? "Stopped" : "Active", suppressed ? null : now);
}

export function stopLeadFollowUp(db: Store, leadId: string) {
  db.prepare("UPDATE lead_follow_up SET status = 'Stopped', nextAt = NULL, pausedAt = NULL, revision = revision + 1 WHERE leadId = ? AND status IN ('Active','Paused')")
    .run(leadId);
}

export function carryLeadHistory(db: Store, leadId: string, loanId: string) {
  db.prepare(`INSERT INTO activity (id, loanId, text, createdAt, kind, outcome)
    SELECT id, ?, text || ' · ' || actor, at, kind, outcome FROM lead_events WHERE leadId = ?`).run(loanId, leadId);
  db.prepare(`INSERT INTO tasks (id, loanId, title, dueAt, completedAt, purpose)
    SELECT id, ?, title, dueAt, completedAt, purpose FROM lead_import_tasks WHERE leadId = ?`).run(loanId, leadId);
  stopLeadFollowUp(db, leadId);
  const followUp = followUpRow(db, leadId);
  return followUp.firstContactAt ?? followUp.replyReceivedAt;
}

export function setImportedLeadTaskStatus(db: Store, { leadId, taskId, completed }: { leadId: string; taskId: string; completed: boolean },
  now: string, ownerEmail?: string): Outcome {
  const lead = db.prepare(`SELECT lead.officerEmail, lead.resolvedAt, lead.heldAt, lead.email, lead.phone, lead.importedContactId AS contactId,
    task.purpose, task.completedAt FROM referral_leads lead JOIN lead_import_tasks task ON task.leadId = lead.id
    WHERE lead.id = ? AND task.id = ?`).get(leadId, taskId);
  if (!lead || lead.resolvedAt || (ownerEmail !== undefined && lead.officerEmail !== ownerEmail)) return { error: "This lead task is unavailable." };
  if (lead.heldAt) return { error: "Reactivate this lead before working its tasks." };
  if (db.prepare("SELECT 1 FROM call_campaign_members WHERE leadId = ? AND callbackTaskId = ?").get(leadId, taskId)) {
    return { error: "Work this follow-up from the call campaign." };
  }
  if (Boolean(lead.completedAt) !== completed) {
    if (lead.purpose === "Prospecting" && outreachSuppressed(outreachSuppressionKeys(db), { ...lead, leadId })) {
      return { error: "This borrower opted out of brokerage outreach." };
    }
    db.prepare("UPDATE lead_import_tasks SET completedAt = ? WHERE id = ? AND leadId = ?").run(completed ? now : null, taskId, leadId);
  }
  return { message: completed ? "Lead task completed." : "Lead task reopened." };
}

export function claimSharedRealtor(db: Store, staff: WorkspaceStaff | null, leadId: string, now: string): Outcome {
  if (!staff || !canClaimSharedRealtor(staff, readRealtorClaimPolicy(db))) return { error: sharedRealtorQueueUnavailable };
  const lead = db.prepare(`SELECT lead.officerEmail, lead.heldAt, lead.email, lead.phone, lead.importedContactId AS contactId,
    coalesce(lead.realtorSharedSince, lead.createdAt) AS sharedSince, lead.realtorSharedSince IS NULL AS estimated, campaign.lastOutcome
    FROM referral_leads lead JOIN contacts contact ON contact.id = lead.realtorId AND contact.role = 'Realtor'
    LEFT JOIN call_campaign_members campaign ON campaign.leadId = lead.id WHERE lead.id = ? AND lead.resolvedAt IS NULL`).get(leadId);
  if (lead?.officerEmail === staff.email) return { message: "Realtor referral is already assigned to you." };
  const identity = { ...lead, leadId };
  if (!lead || lead.officerEmail !== null || lead.heldAt || lead.lastOutcome === "Opted out" ||
      outreachSuppressed(blockedOutreachKeys(db, [identity]), identity)) {
    return { error: "This referral is no longer available to claim. Refresh the shared queue." };
  }
  const result = updateInboxLead(db, staff, { type: "assignInboxLead", leadId, email: staff.email, previousEmail: null }, [], now,
    { verifiedRealtorClaim: true });
  if ("error" in result) return result;
  db.prepare(`INSERT INTO realtor_referral_claims (id, leadId, officerEmail, officerName, sharedSince, claimedAt, estimated)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), leadId, staff.email, staff.name.slice(0, 160), lead.sharedSince, now, lead.estimated);
  accessEvent(db, staff, "Claimed shared realtor referral", leadId, now);
  return { message: "Realtor referral claimed. The original first-contact deadline follows the lead." };
}

function saveLeadAssignment(db: Store, leadId: string, owner: StaffIdentity | undefined, now: string, actor: string, campaign: boolean) {
  const email = owner?.email ?? null;
  db.prepare(`UPDATE referral_leads SET officer = ?, officerEmail = ?, realtorSharedSince =
    CASE WHEN realtorId IS NOT NULL AND ? IS NULL THEN ? ELSE realtorSharedSince END WHERE id = ?`)
    .run(owner?.name.slice(0, 160) ?? "", email, email, now, leadId);
  if (campaign) beginCampaignAssignment(db, leadId, now);
  leadEvent(db, leadId, actor, now, owner ? `Assigned to ${owner.name}.` : "Returned to the shared inbox.");
}

export function assignRoutedCampaignLead(db: Store, staff: WorkspaceStaff | null, campaignId: string, leadId: string, owner: StaffIdentity, now: string) {
  // The router selects the active recipient and checks outreach eligibility in this same transaction.
  const lead = db.prepare(`SELECT 1 FROM referral_leads lead JOIN call_campaign_members member ON member.leadId = lead.id
    WHERE member.campaignId = ? AND lead.id = ? AND lead.officerEmail IS NULL AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL`)
    .get(campaignId, leadId);
  if (!lead) return false;
  saveLeadAssignment(db, leadId, owner, now, staff?.name || "Demo workspace", true);
  return true;
}

export function updateInboxLead(db: Store, staff: WorkspaceStaff | null, data: InboxAction, members: LeadOwner[], now: string,
  { campaignCall = false, coveredOwnerEmail, verifiedRealtorClaim = false, shareOnReactivation = false }:
    { campaignCall?: boolean; coveredOwnerEmail?: string; verifiedRealtorClaim?: boolean; shareOnReactivation?: boolean } = {}):
  (Outcome & { eventId?: string }) | { error: string; claimConflict: true } {
  const callbackPromiseId = data.type === "assignInboxLead" ? data.callbackPromiseId : undefined;
  const documentRecovery = data.type === "assignInboxLead" && data.documentRecovery;
  if (documentRecovery && (staff?.brokerage.role !== "Admin" || !staff.brokerage.pilot || callbackPromiseId)) {
    return { error: "Lead document recovery is unavailable." };
  }
  if (callbackPromiseId) {
    if (staff?.brokerage.role !== "Admin" || !staff.brokerage.pilot) {
      return { error: callbackExceptionUnavailable };
    }
    if (!isOpenOverdueCallbackPromise(db, callbackPromiseId, data.leadId, now)) return { error: callbackExceptionChanged };
  }
  const lead = db.prepare(`SELECT officerEmail, realtorId, resolvedAt, heldAt, email, phone, propertyState, importedContactId AS contactId,
    ${leadChannelBlocksSql} AS blocked, ${leadBorrowerHoursSql} AS hours FROM referral_leads lead WHERE id = ?`).get(data.leadId);
  if (!lead || lead.resolvedAt || staff?.brokerage.role === "Processor") return { error: "This lead is no longer available." };
  const isOfficer = staff?.brokerage.role === "LO";
  const selfClaim = data.type === "assignInboxLead" && data.previousEmail === null && data.email === staff?.email;
  const claimConflict = { error: "This lead already has an owner.", claimConflict: true as const };
  const mayClaim = isOfficer && (lead.realtorId === null || verifiedRealtorClaim) && lead.officerEmail === null &&
    data.type === "assignInboxLead" && data.email === staff.email;
  const mayCover = campaignCall && data.type === "leadContact" && Boolean(coveredOwnerEmail) && lead.officerEmail === coveredOwnerEmail;
  if (isOfficer && lead.officerEmail !== staff.email && !mayClaim && !mayCover) {
    return lead.officerEmail && selfClaim ? claimConflict : { error: "This lead is outside your assigned work." };
  }
  const actor = staff?.name || "Demo workspace";
  if (data.type === "correctLeadPropertyState") {
    if (lead.propertyState === data.propertyState) return { message: "Property state is already up to date." };
    if (followUpRow(db, data.leadId).revision !== data.revision) {
      return { error: "This lead changed. Refresh the inbox and review its current property state before saving." };
    }
    db.prepare("UPDATE referral_leads SET propertyState = ? WHERE id = ?").run(data.propertyState, data.leadId);
    advanceLeadRevision(db, data.leadId);
    leadEvent(db, data.leadId, actor, now, `Property state changed from ${lead.propertyState || "Unknown"} to ${data.propertyState || "Unknown"} · ${data.reason}`);
    accessEvent(db, staff, "Corrected lead property state", data.leadId, now);
    return { message: "Property state saved." };
  }
  const campaign = db.prepare("SELECT lastOutcome FROM call_campaign_members WHERE leadId = ?").get(data.leadId);
  const identity = { ...lead, leadId: data.leadId };
  const suppressed = () => campaign?.lastOutcome === "Opted out" || outreachSuppressed(blockedOutreachKeys(db, [identity]), identity);
  if (data.type === "assignInboxLead") {
    if (isOfficer && data.email !== staff.email) return { error: "A brokerage admin can reassign this lead." };
    const activeOfficer = (member: LeadOwner) => member.status === "Active" && (member.role === "LO" || member.role === "Admin");
    const owner = isOfficer ? staff : members.find((member) => member.email === data.email &&
      ((!callbackPromiseId && !documentRecovery) || activeOfficer(member)));
    if ((data.email || callbackPromiseId || documentRecovery) && !owner) return { error: "Select an active loan officer or admin in this brokerage." };
    if (documentRecovery && (lead.heldAt || (lead.officerEmail !== data.email && members.some((member) =>
      member.email === lead.officerEmail && activeOfficer(member))) ||
      !db.prepare("SELECT 1 FROM lead_document_requests WHERE leadId = ? AND status <> 'Accepted'").get(data.leadId))) {
      return { error: "This lead document exception changed. Refresh the manager queue before assigning." };
    }
    if (lead.officerEmail === data.email) return { message: "Lead assignment is up to date." };
    if (lead.officerEmail !== data.previousEmail) {
      return selfClaim ? claimConflict : { error: "The owner changed. Refresh the inbox before assigning." };
    }
    const campaignEligible = Boolean(campaign) && !suppressed();
    if (mayClaim && campaign && (lead.heldAt || !campaignEligible)) {
      return { error: "This campaign lead is no longer available to claim. Refresh the queue." };
    }
    saveLeadAssignment(db, data.leadId, owner, now, actor, campaignEligible);
    if (documentRecovery) accessEvent(db, staff, "Recovered lead document ownership", data.leadId, now);
    return { message: "Lead assignment saved." };
  }

  if (data.type === "leadOptOut") {
    if (!suppressed()) {
      optOutLead(db, data.leadId, now);
      leadEvent(db, data.leadId, actor, now, "Recorded brokerage outreach opt-out.");
      accessEvent(db, staff, "Recorded brokerage outreach opt-out", data.leadId, now);
    }
    return { message: "Borrower opted out of brokerage outreach." };
  }
  if (data.type === "leadHold") {
    if (followUpRow(db, data.leadId).revision !== data.revision) return { error: "This lead changed. Refresh the inbox before continuing." };
    const hold = data.action === "Hold";
    if (Boolean(lead.heldAt) === hold) return { message: hold ? "Lead is already on hold." : "Lead is already active." };
    if (hold && data.revisitDate && data.revisitDate < easternDate(new Date(now))) return { error: "Choose today or a future date to revisit the lead." };
    db.prepare(`UPDATE referral_leads SET heldAt = ?, holdReason = ?, revisitDate = ?, realtorSharedSince =
      CASE WHEN ? = 0 AND realtorId IS NOT NULL AND officerEmail IS NULL THEN ? ELSE realtorSharedSince END WHERE id = ?`)
      .run(hold ? now : null, hold ? data.reason : null, hold ? data.revisitDate : null, Number(hold), now, data.leadId);
    advanceLeadRevision(db, data.leadId);
    if (!hold && shareOnReactivation) saveLeadAssignment(db, data.leadId, undefined, now, actor, true);
    const message = hold ? "Lead put on hold." : "Lead reactivated.";
    leadEvent(db, data.leadId, actor, now, hold ? `Lead put on hold · ${data.reason}${data.revisitDate ? ` · Revisit ${data.revisitDate}` : ""}` : message);
    accessEvent(db, staff, hold ? "Put lead on hold" : "Reactivated lead", data.leadId, now);
    return { message: !hold && shareOnReactivation ? "Lead reactivated in the shared queue because its previous owner is at campaign capacity." : message };
  }
  if (lead.heldAt) return { error: "Reactivate this lead before recording outreach." };
  if (suppressed()) {
    return { error: "This borrower opted out of brokerage outreach." };
  }
  if (campaign && !campaignCall) return { error: "Record outreach from the lead’s call campaign." };
  if (campaignCall && staff && !lead.officerEmail) return { error: "Assign this campaign lead before logging a call." };

  const row = followUpRow(db, data.leadId);
  if (row.revision !== data.revision) return { error: "This lead changed. Refresh the inbox before continuing." };
  const stop = () => { row.status = "Stopped"; row.nextAt = null; row.pausedAt = null; };
  let event: string;
  if (data.type === "leadContact") {
    if (data.outcome !== "Reply received" && data.outcome !== "Opted out" && borrowerChannelBlocked(Number(lead.blocked), data.channel)) {
      return { error: `The borrower blocks ${data.channel.toLowerCase()} outreach.` };
    }
    if (campaignCall && lead.hours && data.outcome !== "Opted out") {
      const wait = campaignSequenceCallWait(db, data.leadId, now);
      if (wait) return { error: wait };
    }
    if (!row.firstContactAt && campaign && campaignCall) recordCampaignFirstOutreach(db, data.leadId, now);
    row.firstContactAt ??= now;
    if (row.status !== "Completed" && (data.outcome === "Connected" || data.outcome === "Reply received" || data.outcome === "Opted out")) stop();
    event = data.note ? `${data.outcome} · ${data.note}` : data.outcome;
  } else {
    switch (data.action) {
      case "Start":
        if (row.status !== "Not started") return { error: "This sequence has already started." };
        row.status = "Active";
        row.nextAt = now;
        event = "Started the mock lead follow-up sequence.";
        break;
      case "Pause":
        if (row.status !== "Active") return { error: "Only an active sequence can be paused." };
        row.status = "Paused";
        row.pausedAt = now;
        event = "Paused the mock sequence.";
        break;
      case "Resume": {
        if (row.status !== "Paused" || !row.pausedAt || !row.nextAt) return { error: "Only a paused sequence can be resumed." };
        const base = db.prepare("SELECT baseNextAt FROM lead_follow_up WHERE leadId = ?").get(data.leadId)?.baseNextAt;
        row.nextAt = new Date(Date.parse(now) + Math.max(0, Date.parse(String(base ?? row.nextAt)) - Date.parse(row.pausedAt))).toISOString();
        row.pausedAt = null;
        row.status = "Active";
        event = "Resumed the mock sequence.";
        break;
      }
      case "Stop":
        if (row.status !== "Active" && row.status !== "Paused") return { error: "This sequence has no scheduled steps." };
        stop();
        event = "Stopped the mock sequence.";
        break;
      case "Mock send": {
        if (borrowerChannelBlocked(Number(lead.blocked), "Email")) return { error: "The borrower blocks email outreach." };
        const step = leadSequenceSteps[row.nextStep];
        if (row.status !== "Active" || !row.nextAt || row.nextAt > now || !step) return { error: "This mock step is not due." };
        const available = nextBorrowerContactTime(now, storedBorrowerHours(lead.hours));
        if (available > now) return { error: `The borrower’s next preferred contact window starts ${dateTime(available)} ET.` };
        event = `Mock delivery recorded · ${step.title}`;
        row.nextStep++;
        const timing = leadRouting(db);
        row.status = row.nextStep === leadSequenceSteps.length ? "Completed" : "Active";
        row.nextAt = row.status === "Completed" ? null : after(now, row.nextStep === 1 ? timing.secondAfterHours : timing.finalAfterHours);
        break;
      }
    }
  }
  if (data.type === "leadSequence" && row.status === "Active" && borrowerChannelBlocked(Number(lead.blocked), "Email")) {
    row.status = "Completed";
    row.nextStep = leadSequenceSteps.length;
    row.nextAt = null;
    event = "Skipped the remaining mock email steps because the borrower blocks email.";
  }
  db.prepare(`INSERT INTO lead_follow_up (leadId, status, revision, nextStep, nextAt, pausedAt, firstContactAt) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (leadId) DO UPDATE SET status = excluded.status, revision = excluded.revision, nextStep = excluded.nextStep,
    nextAt = excluded.nextAt, pausedAt = excluded.pausedAt, firstContactAt = excluded.firstContactAt,
    baseNextAt = CASE WHEN excluded.nextAt IS NOT NULL AND NOT ? THEN lead_follow_up.baseNextAt END`)
    .run(data.leadId, row.status, row.revision + 1, row.nextStep, row.nextAt, row.pausedAt, row.firstContactAt,
      Number(data.type === "leadSequence" && data.action !== "Pause"));
  if (data.type === "leadSequence" && row.status === "Active" && lead.hours) reconcileInboxSequence(db, data.leadId, now);
  const eventId = leadEvent(db, data.leadId, actor, now, event, data.type === "leadContact" ? data.channel : "Note",
    data.type === "leadContact" ? data.outcome : null);
  return { message: event, eventId };
}

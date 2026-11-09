import type { z } from "zod";
import { assignableCampaignLead, campaignFollowUpAllowed, campaignFollowUpRecipient, defaultCampaignRules, localCampaignOfficers, mockCampaignFollowUpPrefix, unansweredCampaignCall,
  type assignCampaignLeadsInput, type createCallCampaignInput, type pauseCampaignRetriesInput, type recordCampaignCallInput, type recordCampaignFollowUpInput, type rescheduleCampaignCallbackInput,
  type saveCampaignRulesInput } from "./call-campaign-model";
import { easternDate, easternDayStart } from "./client-retention";
import { advanceLeadRevision, leadEvent, updateInboxLead } from "./lead-inbox";
import { leadContactFields } from "./lead-inbox-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";
import { dateTime } from "./utils";
import { blockedOutreachKeys, closeCampaignCallbackPromise, openCallbackPromise, optOutLead, outreachSuppressed, outreachSuppressionKeys } from "./outreach-preferences";
import { beginCampaignAssignment, closeCampaignAssignment } from "./campaign-response";
import { startCampaignFollowUp, supersedeCampaignFollowUp } from "./campaign-follow-up-runs";

export function mayManageCampaigns(staff: WorkspaceStaff | null) {
  return !staff || (staff.brokerage.pilot && staff.brokerage.role === "Admin");
}

export function createCallCampaign(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof createCallCampaignInput>, now: string) {
  const current = db.prepare("SELECT id, name FROM call_campaigns WHERE id = ? OR name = ? COLLATE NOCASE").all(input.id, input.name);
  if (current.length) return current.length === 1 && current[0].id === input.id && current[0].name === input.name
    ? { message: "Campaign is ready." } : { error: "Use a different campaign name." };
  db.prepare("INSERT INTO call_campaigns (id, name, createdAt) VALUES (?, ?, ?)").run(input.id, input.name, now);
  accessEvent(db, staff, "Created call campaign", input.id, now);
  return { message: "Campaign is ready." };
}

export function linkCampaignLead(db: Store, campaignId: string, leadId: string, now: string) {
  const lead = db.prepare("SELECT email, phone, importedContactId AS contactId, resolvedAt, heldAt FROM referral_leads WHERE id = ?").get(leadId);
  const campaign = db.prepare("SELECT 1 FROM call_campaigns WHERE id = ?").get(campaignId);
  if (!campaign || !lead?.phone || lead.resolvedAt || !leadContactFields.phone.safeParse(lead.phone).success) return { error: "Choose an open lead with a valid phone number and an available campaign." };
  if (lead.heldAt) return { error: "Reactivate this lead before adding it to a campaign." };
  if (outreachSuppressed(outreachSuppressionKeys(db), lead)) return { error: "This borrower opted out of brokerage outreach." };
  const linked = db.prepare("SELECT campaignId FROM call_campaign_members WHERE leadId = ?").get(leadId);
  if (linked && linked.campaignId !== campaignId) return { error: "This lead already belongs to a call campaign." };
  if (!linked) {
    db.prepare("INSERT INTO call_campaign_members (leadId, campaignId, joinedAt) VALUES (?, ?, ?)").run(leadId, campaignId, now);
    beginCampaignAssignment(db, leadId, now);
  }
  return { message: "Lead added to the call campaign.", added: !linked };
}

export function saveCampaignRules(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof saveCampaignRulesInput>, now: string) {
  const current = db.prepare(`SELECT coalesce(rules.revision, 0) AS revision, rules.retryTime
    FROM call_campaigns campaign LEFT JOIN call_campaign_rules rules ON rules.campaignId = campaign.id WHERE campaign.id = ?`).get(input.campaignId);
  if (!current) return { error: "This call campaign is unavailable." };
  if (current.revision !== input.revision) return { error: "Campaign rules changed. Refresh before saving." };
  db.prepare(`INSERT INTO call_campaign_rules (campaignId, revision, voicemailDays, noResponseDays, maxAttempts, retryTime)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(campaignId) DO UPDATE SET revision = excluded.revision,
    voicemailDays = excluded.voicemailDays, noResponseDays = excluded.noResponseDays, maxAttempts = excluded.maxAttempts, retryTime = excluded.retryTime`)
    .run(input.campaignId, input.revision + 1, input.voicemailDays, input.noResponseDays, input.maxAttempts,
      input.retryTime ?? current.retryTime ?? defaultCampaignRules.retryTime);
  accessEvent(db, staff, "Updated call campaign rules", input.campaignId, now);
  return { message: "Campaign rules saved. They apply to the next call outcome." };
}

export function pauseCampaignRetries(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof pauseCampaignRetriesInput>, now: string) {
  const current = db.prepare(`SELECT coalesce(rules.revision, 0) AS revision, coalesce(rules.automaticPaused, 0) AS paused
    FROM call_campaigns campaign LEFT JOIN call_campaign_rules rules ON rules.campaignId = campaign.id WHERE campaign.id = ?`).get(input.campaignId);
  if (!current) return { error: "This call campaign is unavailable." };
  const message = input.paused ? "New automatic retries paused. Requested callbacks stay active." : "New automatic retries resumed. Release held follow-ups from Playbooks.";
  if (Boolean(current.paused) === input.paused) return { message };
  if (current.revision !== input.revision) return { error: "Campaign rules changed. Refresh before saving." };
  const { voicemailDays, noResponseDays, maxAttempts } = defaultCampaignRules;
  db.prepare(`INSERT INTO call_campaign_rules (campaignId, revision, voicemailDays, noResponseDays, maxAttempts, automaticPaused)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(campaignId) DO UPDATE SET revision = excluded.revision, automaticPaused = excluded.automaticPaused`)
    .run(input.campaignId, input.revision + 1, voicemailDays, noResponseDays, maxAttempts, Number(input.paused));
  accessEvent(db, staff, input.paused ? "Paused new campaign retries" : "Resumed new campaign retries", input.campaignId, now);
  return { message };
}

export function assignCampaignLeads(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof assignCampaignLeadsInput>, members: StaffIdentity[], now: string) {
  const roster = staff ? members : localCampaignOfficers;
  const officer = roster.find((member) => member.email === input.email);
  if (!officer) return { error: "Select an active loan officer or admin in this brokerage." };
  const openMember = db.prepare(`SELECT lead.officerEmail, lead.email, lead.phone, lead.importedContactId AS contactId, member.lastOutcome
    FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    WHERE member.campaignId = ? AND lead.id = ? AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL`);
  const selectedLeads = input.leads.map((selected) => ({ selected, lead: openMember.get(input.campaignId, selected.id) }));
  const suppression = blockedOutreachKeys(db, selectedLeads.flatMap(({ selected, lead }) => lead ? [{ ...lead, leadId: selected.id }] : []));
  const updates: typeof input.leads = [];
  for (const { selected, lead } of selectedLeads) {
    if (!lead || lead.lastOutcome === "Opted out" || !assignableCampaignLead({
      phone: String(lead.phone), outreachSuppressed: outreachSuppressed(suppression, { ...lead, leadId: selected.id }),
    })) return { error: "A selected lead is no longer eligible. Refresh the campaign and review your selection." };
    if (lead.officerEmail === input.email) continue;
    if (lead.officerEmail !== selected.previousEmail) return { error: "A lead’s owner changed. Refresh the campaign and review your selection." };
    updates.push(selected);
  }
  for (const lead of updates) {
    const result = updateInboxLead(db, staff, { type: "assignInboxLead", leadId: lead.id, email: input.email, previousEmail: lead.previousEmail }, roster, now);
    if ("error" in result) return result;
  }
  if (!updates.length) return { message: "The selected leads are already assigned to this officer." };
  accessEvent(db, staff, "Assigned campaign leads", `${input.campaignId} · ${updates.length} · ${officer.email}`, now);
  return { message: `${updates.length} ${updates.length === 1 ? "lead" : "leads"} assigned to ${officer.name}.` };
}

function retryDueAt(now: string, weekdays: number, time: string) {
  const due = new Date(`${easternDate(new Date(now))}T00:00:00.000Z`);
  while (weekdays > 0) {
    due.setUTCDate(due.getUTCDate() + 1);
    if (due.getUTCDay() !== 0 && due.getUTCDay() !== 6) weekdays--;
  }
  const [hour, minute] = time.split(":").map(Number);
  const midnight = Date.parse(easternDayStart(due.toISOString().slice(0, 10)));
  return new Date(midnight + (hour * 60 + minute) * 60_000).toISOString();
}

function completeCampaignTask(db: Store, taskId: string, now: string) {
  db.prepare("UPDATE lead_import_tasks SET completedAt = ? WHERE id = ? AND completedAt IS NULL").run(now, taskId);
}

export function stopCampaignFollowUp(db: Store, staff: WorkspaceStaff | null, leadId: string, now: string, reason: "lead archived" | "1003 started",
  preserveRequestedCallback = false) {
  const member = db.prepare("SELECT callbackTaskId, lastOutcome FROM call_campaign_members WHERE leadId = ?").get(leadId);
  if (!member) return;
  closeCampaignAssignment(db, leadId, now);
  if (typeof member.callbackTaskId === "string" && (!preserveRequestedCallback || member.lastOutcome !== "Requested callback")) {
    completeCampaignTask(db, member.callbackTaskId, now);
  }
  supersedeCampaignFollowUp(db, leadId, `Campaign outreach ended · ${reason}.`);
  closeCampaignCallbackPromise(db, leadId, now, reason === "lead archived" ? "Lead archived" : reason);
  leadEvent(db, leadId, staff?.name || "Demo workspace", now, `Campaign outreach ended · ${reason}.`, "Campaign");
}

export function recordCampaignCall(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof recordCampaignCallInput>, now: string, coveredOwnerEmail?: string) {
  if (input.simulateFollowUpFailure && staff && !mayManageCampaigns(staff)) return { error: "A fictional pilot admin can rehearse a follow-up failure." };
  const member = db.prepare(`SELECT campaign.name, member.callbackTaskId, member.attempts, member.reachedAt, member.retryExhaustedAt,
    rules.voicemailDays, rules.noResponseDays, rules.maxAttempts,
    rules.revision, rules.automaticPaused, rules.retryTime, follow.replyReceivedAt,
    task.id IS NOT NULL AND task.completedAt IS NULL AS pendingTask
    FROM call_campaign_members member JOIN call_campaigns campaign ON campaign.id = member.campaignId
    LEFT JOIN call_campaign_rules rules ON rules.campaignId = campaign.id
    LEFT JOIN lead_follow_up follow ON follow.leadId = member.leadId
    LEFT JOIN lead_import_tasks task ON task.id = member.callbackTaskId WHERE member.campaignId = ? AND member.leadId = ?`)
    .get(input.campaignId, input.leadId);
  if (!member) return { error: "This lead is no longer in the selected campaign." };
  if (input.callbackAt && Date.parse(input.callbackAt) <= Date.parse(now)) return { error: "Choose a callback time in the future." };
  const result = updateInboxLead(db, staff, { type: "leadContact", leadId: input.leadId, revision: input.revision,
    channel: "Call", outcome: input.outcome, note: [`Call campaign · ${member.name}`, input.note].filter(Boolean).join(" · ") }, [], now,
  { campaignCall: true, coveredOwnerEmail });
  if ("error" in result) return result;
  if (!result.eventId) throw new Error("Campaign call did not create a lead event.");
  db.prepare(`UPDATE campaign_follow_up_runs SET promiseAttemptEventId = ?, promiseClosedAt = ?
    WHERE leadId = ? AND campaignId = ? AND callNumber = ? AND ${openCallbackPromise}`)
    .run(result.eventId, now, input.leadId, input.campaignId, member.attempts);

  let callbackTaskId = typeof member.callbackTaskId === "string" ? member.callbackTaskId : null;
  const retryDays = input.outcome === "Left message" ? Number(member.voicemailDays ?? defaultCampaignRules.voicemailDays) :
    input.outcome === "No response" ? Number(member.noResponseDays ?? defaultCampaignRules.noResponseDays) : 0;
  const callNumber = Number(member.attempts) + 1;
  const attemptLimitReached = callNumber >= Number(member.maxAttempts ?? defaultCampaignRules.maxAttempts);
  const wouldRetry = retryDays > 0 && !attemptLimitReached;
  const retryTime = typeof member.retryTime === "string" ? member.retryTime : defaultCampaignRules.retryTime;
  const dueAt = input.callbackAt ? new Date(input.callbackAt).toISOString() : wouldRetry && !member.replyReceivedAt ? retryDueAt(now, retryDays, retryTime) : null;
  const title = input.callbackAt ? `Call back · ${member.name}` : `Retry call · ${member.name}`;
  const actor = staff?.name || "Demo workspace";
  supersedeCampaignFollowUp(db, input.leadId, input.outcome === "Opted out" ? "Borrower opted out of outreach." : "A newer campaign call replaced this follow-up.");
  let followUp = "";
  if (dueAt) {
    const taskId = callbackTaskId ?? crypto.randomUUID();
    const status = startCampaignFollowUp(db, { leadId: input.leadId, campaignId: input.campaignId, callNumber, outcome: input.outcome,
      ruleRevision: Number(member.revision ?? 0), delayDays: input.callbackAt ? null : retryDays, taskId, taskTitle: title, dueAt, at: now,
      promiseRequestEventId: input.outcome === "Requested callback" ? result.eventId : null },
    actor, !input.callbackAt && Boolean(member.automaticPaused), Boolean(input.simulateFollowUpFailure));
    if (status === "Completed") {
      callbackTaskId = taskId;
      followUp = `${input.callbackAt ? "Callback" : "Retry call"} scheduled for ${dateTime(dueAt)} ET.`;
    } else {
      if (callbackTaskId) completeCampaignTask(db, callbackTaskId, now);
      followUp = status === "Paused" ? "Call logged. The automatic retry is paused in Playbooks." : "Call logged. An admin can recover the follow-up in Playbooks.";
    }
  } else if (callbackTaskId) {
    completeCampaignTask(db, callbackTaskId, now);
    if (member.pendingTask) followUp = "Scheduled campaign follow-up ended.";
  }
  if (input.outcome === "Opted out") followUp = "Campaign outreach ended · lead opted out.";
  if (input.outcome === "Connected" && member.pendingTask) followUp = "Scheduled campaign follow-up ended · lead connected.";
  if (retryDays && attemptLimitReached) followUp = "Automatic retries ended · attempt limit reached.";
  if (wouldRetry && member.replyReceivedAt) followUp = "Call logged. Automatic retries are off because a reply was already logged.";
  if (followUp) leadEvent(db, input.leadId, actor, now, followUp, "Campaign");
  const reachedAt = input.outcome === "Connected" || input.outcome === "Requested callback" || input.outcome === "Opted out" ? now : null;
  const exhaustedAt = !dueAt && !member.reachedAt && !member.replyReceivedAt && unansweredCampaignCall(input.outcome)
    ? member.retryExhaustedAt ?? (retryDays && attemptLimitReached ? now : null) : null;
  db.prepare(`UPDATE call_campaign_members SET attempts = attempts + 1, lastOutcome = ?, callbackTaskId = ?,
    reachedAt = coalesce(reachedAt, ?), firstCallAt = coalesce(firstCallAt, ?), retryExhaustedAt = ? WHERE leadId = ?`)
    .run(input.outcome, callbackTaskId, reachedAt, now, exhaustedAt, input.leadId);
  if (input.outcome === "Opted out") {
    optOutLead(db, input.leadId, now);
    accessEvent(db, staff, "Recorded brokerage outreach opt-out", input.leadId, now);
  }
  return { message: followUp || "Campaign call outcome saved.", releasedCampaignSlot: !!exhaustedAt && !member.retryExhaustedAt };
}

export function rescheduleCampaignCallback(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof rescheduleCampaignCallbackInput>, now: string) {
  const { leadId } = input;
  const callback = db.prepare(`SELECT task.id, task.dueAt, lead.officerEmail, lead.heldAt, lead.email, lead.phone,
    lead.importedContactId AS contactId, follow.revision
    FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    JOIN lead_import_tasks task ON task.id = member.callbackTaskId AND task.leadId = lead.id
    JOIN lead_follow_up follow ON follow.leadId = lead.id
    WHERE member.campaignId = ? AND lead.id = ? AND lead.resolvedAt IS NULL
      AND member.lastOutcome = 'Requested callback' AND task.completedAt IS NULL`).get(input.campaignId, leadId);
  if (!callback || staff?.brokerage.role === "Processor" || (staff?.brokerage.role === "LO" && callback.officerEmail !== staff.email)) {
    return { error: "This campaign callback is unavailable." };
  }
  if (staff && !callback.officerEmail) return { error: "Assign this campaign lead before rescheduling its callback." };
  if (callback.heldAt) return { error: "Reactivate this lead before rescheduling its callback." };
  const identity = { ...callback, leadId };
  if (outreachSuppressed(blockedOutreachKeys(db, [identity]), identity)) return { error: "This borrower opted out of brokerage outreach." };
  if (callback.revision !== input.revision) return { error: "This callback changed. Refresh the campaign queue before rescheduling." };
  const dueAt = new Date(input.callbackAt).toISOString();
  if (dueAt <= now) return { error: "Choose a callback time in the future." };
  if (dueAt === callback.dueAt) return { error: "Choose a different callback time." };
  db.prepare("UPDATE lead_import_tasks SET dueAt = ? WHERE id = ?").run(dueAt, callback.id);
  db.prepare(`UPDATE campaign_follow_up_runs SET promiseDueAt = ? WHERE leadId = ? AND campaignId = ? AND taskId = ?
    AND promiseDueAt > ? AND ${openCallbackPromise}`).run(dueAt, leadId, input.campaignId, callback.id, now);
  advanceLeadRevision(db, leadId);
  const when = `${dateTime(dueAt)} ET`;
  leadEvent(db, leadId, staff?.name || "Demo workspace", now,
    `Callback moved from ${dateTime(String(callback.dueAt))} ET to ${when} · ${input.reason}`, "Campaign");
  return { message: `Callback rescheduled for ${when}.` };
}

export function recordCampaignFollowUp(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof recordCampaignFollowUpInput>, now: string) {
  if (staff && (!staff.brokerage.pilot || staff.brokerage.role === "Processor")) return { error: "Mock campaign follow-up is available in a fictional pilot." };
  const lead = db.prepare(`SELECT lead.officerEmail, lead.heldAt, lead.email, lead.phone, lead.importedContactId AS contactId, member.lastOutcome,
    coalesce(follow.revision, 0) AS revision, follow.replyReceivedAt, call.id AS callEventId, call.at AS callAt, call.outcome AS callOutcome,
    CASE WHEN member.lastOutcome = 'Requested callback' AND task.completedAt IS NULL THEN task.dueAt END AS callbackAt
    FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    LEFT JOIN lead_import_tasks task ON task.id = member.callbackTaskId AND task.leadId = lead.id
    LEFT JOIN lead_events call ON call.id = (SELECT event.id FROM lead_events event
      WHERE event.leadId = lead.id AND event.kind = 'Call' ORDER BY event.at DESC, event.rowid DESC LIMIT 1)
    WHERE member.campaignId = ? AND lead.id = ? AND lead.resolvedAt IS NULL AND lead.loanId IS NULL AND member.attempts > 0`).get(input.campaignId, input.leadId);
  if (!lead?.officerEmail || (staff?.brokerage.role === "LO" && lead.officerEmail !== staff.email)) {
    return { error: "This campaign lead is unavailable for follow-up." };
  }
  const identity = { ...lead, leadId: input.leadId };
  if (lead.lastOutcome === "Opted out" || outreachSuppressed(blockedOutreachKeys(db, [identity]), identity)) {
    return { error: "This borrower opted out of brokerage outreach." };
  }
  if (lead.heldAt) return { error: "Reactivate this lead before recording follow-up." };
  const changed = { error: "The call, recipient, or callback changed. Refresh the campaign and reopen the draft." };
  const callbackAt = typeof lead.callbackAt === "string" ? lead.callbackAt : null;
  const recipient = campaignFollowUpRecipient(input.channel, { email: String(lead.email ?? ""), phone: String(lead.phone ?? "") });
  if (lead.callEventId !== input.callEventId || lead.callOutcome !== lead.lastOutcome || callbackAt !== input.callbackAt || recipient !== input.recipient) {
    return changed;
  }
  const actor = staff?.name || "Demo workspace";
  const text = `${mockCampaignFollowUpPrefix} · ${input.channel}\nTo: ${input.recipient}\n${input.subject ? `Subject: ${input.subject}\n` : ""}\n${input.body}`;
  const message = `Mock ${input.channel.toLowerCase()} recorded in the lead conversation.`;
  const prior = db.prepare("SELECT leadId, actor, kind, text FROM lead_events WHERE id = ?").get(input.eventId);
  if (prior) return prior.leadId === input.leadId && prior.actor === actor && prior.kind === "Campaign" && prior.text === text ?
    { message } : { error: "This follow-up action was already used. Reopen the draft." };
  if (lead.revision !== input.revision ||
    (typeof lead.replyReceivedAt === "string" && typeof lead.callAt === "string" && lead.replyReceivedAt >= lead.callAt) ||
    !campaignFollowUpAllowed(lead.lastOutcome, callbackAt, Date.parse(now))) {
    return changed;
  }
  leadEvent(db, input.leadId, actor, now, text, "Campaign", null, input.eventId);
  advanceLeadRevision(db, input.leadId);
  db.prepare(`INSERT INTO lead_conversations (id, leadId, updatedAt) VALUES (?, ?, ?)
    ON CONFLICT (leadId) DO UPDATE SET updatedAt = excluded.updatedAt, revision = lead_conversations.revision + 1`)
    .run(crypto.randomUUID(), input.leadId, now);
  return { message };
}

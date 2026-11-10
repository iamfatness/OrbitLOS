import type { z } from "zod";
import { campaignFollowUpRecipient, mockCampaignFollowUpPrefix } from "./call-campaign-model";
import { sequenceSteps, sequenceTaskId, type CampaignSequenceConfig, type changeCampaignSequenceInput,
  type recordSequenceMockInput, type saveCampaignSequenceInput } from "./campaign-sequence-model";
import { campaignWeekdayAt } from "./campaign-timing";
import { advanceLeadRevision, leadEvent } from "./lead-inbox";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const unavailable = "This follow-up step changed or is no longer assigned to you. Refresh Today.";
const sequenceDue = (now: string, delay: number) => delay === 0 ? now : campaignWeekdayAt(now, delay, "09:00");

export function campaignSequenceConfig(db: Store, campaignId: string): CampaignSequenceConfig {
  const latest = db.prepare("SELECT version, steps FROM campaign_sequence_versions ORDER BY version DESC LIMIT 1").get();
  const attachment = db.prepare("SELECT version FROM campaign_sequence_attachments WHERE campaignId = ?").get(campaignId);
  return { attachedVersion: attachment ? Number(attachment.version) : null,
    latest: latest ? { version: Number(latest.version), steps: sequenceSteps.parse(JSON.parse(String(latest.steps))) } : null };
}

export function saveCampaignSequence(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof saveCampaignSequenceInput>, now: string) {
  if (!db.prepare("SELECT 1 FROM call_campaigns WHERE id = ?").get(input.campaignId)) return { error: "This campaign is unavailable." };
  const current = campaignSequenceConfig(db, input.campaignId);
  if (current.attachedVersion !== input.expectedVersion || (current.latest?.version ?? null) !== input.expectedTemplateVersion) {
    return { error: "The New Lead sequence changed. Refresh the campaign and reopen its settings." };
  }
  if (!input.steps) {
    db.prepare("DELETE FROM campaign_sequence_attachments WHERE campaignId = ?").run(input.campaignId);
    if (current.attachedVersion !== null) accessEvent(db, staff, "Detached New Lead sequence", input.campaignId, now);
    return { message: "Sequence detached for future CSV imports. Existing enrollments keep their steps." };
  }
  const steps = JSON.stringify(input.steps);
  let version = current.latest?.version ?? 0;
  if (!current.latest || steps !== JSON.stringify(current.latest.steps)) {
    version++;
    db.prepare("INSERT INTO campaign_sequence_versions (version, steps) VALUES (?, ?)").run(version, steps);
  }
  db.prepare(`INSERT INTO campaign_sequence_attachments (campaignId, version) VALUES (?, ?)
    ON CONFLICT(campaignId) DO UPDATE SET version = excluded.version`).run(input.campaignId, version);
  if (version !== current.attachedVersion) accessEvent(db, staff, "Attached New Lead sequence", input.campaignId, now);
  return { message: `New Lead sequence v${version} attached for new CSV leads.` };
}

export function enrollCsvCampaignSequence(db: Store, campaignId: string, leadId: string, now: string) {
  const template = db.prepare(`SELECT template.version, template.steps FROM campaign_sequence_attachments attachment
    JOIN campaign_sequence_versions template ON template.version = attachment.version WHERE attachment.campaignId = ?`).get(campaignId);
  if (!template) return;
  const steps = sequenceSteps.parse(JSON.parse(String(template.steps)));
  db.prepare(`INSERT INTO campaign_sequence_enrollments (leadId, version, dueAt) VALUES (?, ?, ?)
    ON CONFLICT(leadId) DO NOTHING`).run(leadId, template.version, sequenceDue(now, steps[0].delay));
}

export function stopCampaignSequence(db: Store, leadId: string, reason: string) {
  db.prepare("UPDATE campaign_sequence_enrollments SET dueAt = NULL, outcome = ? WHERE leadId = ? AND dueAt IS NOT NULL").run(reason, leadId);
}

export function changeCampaignSequence(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof changeCampaignSequenceInput>, now: string) {
  const changed = "This lead’s sequence changed. Refresh the campaign before trying again.";
  const run = db.prepare(`SELECT sequence.position, sequence.outcome, lead.email, lead.phone, lead.importedContactId AS contactId,
    coalesce(follow.revision, 0) AS revision FROM campaign_sequence_enrollments sequence
    JOIN call_campaign_members member ON member.leadId = sequence.leadId
    JOIN referral_leads lead ON lead.id = sequence.leadId LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    WHERE member.campaignId = ? AND lead.id = ? AND sequence.dueAt IS NOT NULL
      AND lead.resolvedAt IS NULL AND lead.loanId IS NULL AND lead.heldAt IS NULL AND follow.replyReceivedAt IS NULL
      AND member.lastOutcome IS NOT 'Opted out'`).get(input.campaignId, input.leadId);
  const pause = input.action === "Pause";
  const identity = { ...run, leadId: input.leadId };
  if (!run || run.revision !== input.revision || run.outcome !== (pause ? null : "Paused") ||
    outreachSuppressed(blockedOutreachKeys(db, [identity]), identity)) return { error: changed };
  db.prepare("UPDATE campaign_sequence_enrollments SET outcome = ? WHERE leadId = ?").run(pause ? "Paused" : null, input.leadId);
  advanceLeadRevision(db, input.leadId);
  const action = pause ? "Paused New Lead sequence" : "Resumed New Lead sequence";
  leadEvent(db, input.leadId, staff?.name ?? "Demo workspace", now, `${action} at step ${Number(run.position) + 1}.`, "Campaign");
  accessEvent(db, staff, action, input.leadId, now);
  return { message: pause ? "Sequence paused. The current step and schedule are saved." : "Sequence resumed from the saved step." };
}

function currentStep(db: Store, leadId: string, now: string) {
  const run = db.prepare(`SELECT run.version, run.position, template.steps, lead.officerEmail, lead.email, lead.phone,
    lead.importedContactId AS contactId FROM campaign_sequence_enrollments run
    JOIN campaign_sequence_versions template ON template.version = run.version JOIN referral_leads lead ON lead.id = run.leadId
    LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    WHERE run.leadId = ? AND run.dueAt <= ? AND run.outcome IS NULL
      AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND follow.replyReceivedAt IS NULL`).get(leadId, now);
  if (!run) return null;
  const position = Number(run.position);
  const steps = sequenceSteps.parse(JSON.parse(String(run.steps)));
  return { version: Number(run.version), position, step: steps[position], next: steps[position + 1],
    officerEmail: run.officerEmail, email: String(run.email ?? ""), phone: String(run.phone ?? ""), contactId: run.contactId };
}

function advance(db: Store, leadId: string, run: NonNullable<ReturnType<typeof currentStep>>, now: string) {
  db.prepare("UPDATE campaign_sequence_enrollments SET position = ?, dueAt = ?, outcome = ? WHERE leadId = ?")
    .run(run.position + 1, run.next ? sequenceDue(now, run.next.delay) : null, run.next ? null : "Completed", leadId);
}

export function isCurrentSequenceCall(db: Store, leadId: string, taskId: string, now: string) {
  const run = currentStep(db, leadId, now);
  return run?.step.channel === "Call" && sequenceTaskId(leadId, run.version, run.position) === taskId;
}

function recordSequenceTouch(db: Store, leadId: string, position: number, now: string) {
  db.prepare("INSERT INTO campaign_sequence_touches (leadId, position, at) VALUES (?, ?, ?)").run(leadId, position, now);
}

export function recordSequenceCall(db: Store, leadId: string, now: string, optedOut: boolean) {
  const run = currentStep(db, leadId, now);
  if (run?.step.channel !== "Call") return;
  recordSequenceTouch(db, leadId, run.position, now);
  if (!optedOut) advance(db, leadId, run, now);
}

export function recordSequenceMock(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof recordSequenceMockInput>, now: string) {
  if (staff && (!staff.brokerage.pilot || staff.brokerage.role === "Processor")) return { error: unavailable };
  const run = currentStep(db, input.leadId, now);
  if (!run || (staff && run.officerEmail !== staff.email) || run.version !== input.version || run.position !== input.position || run.step.channel === "Call") {
    return { error: unavailable };
  }
  const identity = { leadId: input.leadId, email: run.email, phone: run.phone, contactId: run.contactId };
  if (outreachSuppressed(blockedOutreachKeys(db, [identity]), identity)) return { error: unavailable };
  const { channel, title, body } = run.step;
  const recipient = campaignFollowUpRecipient(channel, identity) || null;
  if (recipient !== input.recipient) return { error: unavailable };
  const actor = staff?.name ?? "Demo workspace";
  const event = recipient ? `${mockCampaignFollowUpPrefix} · ${channel}\nTo: ${recipient}\n${channel === "Email" ? `Subject: ${title}\n` : ""}${body}` :
    `New Lead sequence · Skipped ${channel.toLowerCase()} step because the lead has no valid recipient.`;
  leadEvent(db, input.leadId, actor, now, event, "Campaign");
  if (recipient) {
    db.prepare(`INSERT INTO lead_conversations (id, leadId, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT (leadId) DO UPDATE SET updatedAt = excluded.updatedAt, revision = lead_conversations.revision + 1`)
      .run(crypto.randomUUID(), input.leadId, now);
    recordSequenceTouch(db, input.leadId, run.position, now);
  }
  advanceLeadRevision(db, input.leadId);
  advance(db, input.leadId, run, now);
  return { message: recipient ? `Mock ${channel.toLowerCase()} recorded in the lead conversation.` : "Step skipped. The sequence has advanced." };
}

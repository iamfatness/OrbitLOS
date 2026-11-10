import { createHash } from "node:crypto";
import type { z } from "zod";
import { linkCampaignLead } from "./call-campaigns";
import { distributeCampaignLeads, readCampaignRouting } from "./campaign-routing";
import { attachedCampaignSequence, enrollCampaignSequence } from "./campaign-sequences";
import { rateTargetReached } from "./client-retention";
import { crmFieldFilter } from "./crm-field-model";
import { crmFieldValueTable, resolveCrmFieldFilter } from "./crm-fields";
import { crmSegmentFieldRecord, pilotSegmentLeadPrefix, segmentEnrollmentLimit, sequenceKindForSegment, type CrmSegment, type SegmentPreview,
  type enrollCrmSegmentInput, type saveCrmSegmentInput } from "./crm-segment-model";
import { firstContactDue, leadEvent, leadRouting } from "./lead-inbox";
import { leadContactFields } from "./lead-inbox-model";
import { outreachIdentityKeys, outreachSuppressed, outreachSuppressionKeys } from "./outreach-preferences";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type Lead = { id: string; name: string; email: string; phone: string; contactId: string | null; officer: string; officerEmail: string | null;
  campaignId: string | null; status: string | null; lastOutreach: string; replied: number; replyReceivedAt: string | null; heldAt: string | null };
type PastClient = { id: string; name: string; email: string; phone: string; contactId: string; scenarioId: string | null;
  observedRate: number | null; targetRate: number | null; watchEnabled: number };
type PreviewRow = SegmentPreview["rows"][number];
type SegmentMutation = { message: string; preview?: SegmentPreview; leadIds?: string[] } | { error: string };
const filterUnavailable = { error: "The segment’s CRM field is unavailable. Update its filter before continuing." };

export function saveCrmSegment(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof saveCrmSegmentInput>, now: string): SegmentMutation {
  const resolved = input.customFilter ? resolveCrmFieldFilter(db, input.customFilter, [crmSegmentFieldRecord(input.kind)]) : null;
  if (input.customFilter && !resolved) return filterUnavailable;
  const customFilter = resolved ? JSON.stringify({ fieldId: resolved.field.id, value: resolved.value }) : null;
  const current = db.prepare("SELECT revision, name, kind, quietDays, customFilter FROM crm_segments WHERE id = ?").get(input.id);
  if (current?.name === input.name && current.kind === input.kind && current.quietDays === input.quietDays && current.customFilter === customFilter) {
    return { message: "CRM segment is saved." };
  }
  if (Number(current?.revision ?? 0) !== input.revision || (!current && input.revision !== 0)) {
    return { error: "This segment changed. Refresh it before saving." };
  }
  if (db.prepare("SELECT 1 FROM crm_segments WHERE name = ? COLLATE NOCASE AND id <> ?").get(input.name, input.id)) {
    return { error: "Use a different segment name." };
  }
  db.prepare(`INSERT INTO crm_segments (id, name, kind, quietDays, revision, customFilter) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, quietDays = excluded.quietDays,
      revision = excluded.revision, customFilter = excluded.customFilter`)
    .run(input.id, input.name, input.kind, input.quietDays, input.revision + 1, customFilter);
  accessEvent(db, staff, current ? "Updated CRM segment" : "Saved CRM segment", input.id, now);
  return { message: "CRM segment is saved." };
}

function matchingLeads(db: Store) {
  return db.prepare(`SELECT lead.id, lead.name, lead.email, lead.phone, lead.importedContactId AS contactId, lead.officer, lead.officerEmail,
    member.campaignId, follow.status, follow.replyReceivedAt, lead.heldAt, coalesce((SELECT max(at) FROM lead_events WHERE leadId = lead.id AND outcome <> 'Opted out'),
      lead.createdAt) AS lastOutreach,
    EXISTS (SELECT 1 FROM lead_events WHERE leadId = lead.id AND outcome IN ('Connected', 'Reply received', 'Requested callback')) AS replied
    FROM referral_leads lead LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    LEFT JOIN call_campaign_members member ON member.leadId = lead.id
    WHERE lead.resolvedAt IS NULL ORDER BY lastOutreach, lead.id`).all() as unknown as Lead[];
}

function pastClients(db: Store, atRateTarget: boolean) {
  const files = db.prepare(`SELECT loan.id, contact.id AS contactId, contact.name, contact.email, contact.phone, profile.observedRate,
    profile.targetRate, profile.watchEnabled,
    (SELECT id FROM pilot_scenario WHERE EXISTS (SELECT 1 FROM pilot_sample_contacts WHERE contactId = contact.id)) AS scenarioId
    FROM loans loan LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id JOIN contacts contact ON contact.id = loan.contactId
    WHERE loan.stage IN ('Funded', 'Closed') AND contact.role <> 'Realtor'
      AND ${atRateTarget ? "profile.loanId IS NOT NULL" : "loan.disposition = 'Active'"}
    ORDER BY coalesce(profile.closingDate, substr(loan.stageSince, 1, 10)) DESC, loan.stageSince DESC, loan.id`).all() as unknown as PastClient[];
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.contactId)) return false;
    seen.add(file.contactId);
    return !atRateTarget || rateTargetReached({ ...file, watchEnabled: Boolean(file.watchEnabled) });
  });
}

export function enrollCrmSegment(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof enrollCrmSegmentInput>, now: string, members: StaffIdentity[]): SegmentMutation {
  const segment = db.prepare("SELECT * FROM crm_segments WHERE id = ?").get(input.segmentId) as
    (Omit<CrmSegment, "customFilter"> & { customFilter: string | null }) | undefined;
  if (!segment || !db.prepare("SELECT 1 FROM call_campaigns WHERE id = ?").get(input.campaignId)) {
    return { error: "Choose an available saved segment and call campaign." };
  }
  const record = crmSegmentFieldRecord(segment.kind);
  const fieldFilter = segment.customFilter === null ? null :
    resolveCrmFieldFilter(db, crmFieldFilter.parse(JSON.parse(segment.customFilter)), [record]);
  if (segment.customFilter !== null && !fieldFilter) return filterUnavailable;
  const valueTable = crmFieldValueTable[record];
  const matches = fieldFilter ? new Set(db.prepare(`SELECT recordId FROM ${valueTable} WHERE fieldId = ? AND value = ?`)
    .all(fieldFilter.field.id, fieldFilter.value).map(({ recordId }) => recordId)) : null;
  const attachment = attachedCampaignSequence(db, input.campaignId);
  const kind = sequenceKindForSegment(segment.kind);
  if (attachment && attachment.kind !== "New Lead" && attachment.kind !== kind) {
    return { error: `Choose a campaign with the ${kind} sequence for this audience, or detach the current sequence.` };
  }
  const sequence = attachment?.kind === kind ? attachment : null;
  const leads = matchingLeads(db);
  const routing = readCampaignRouting(db, input.campaignId);
  const suppression = outreachSuppressionKeys(db);
  const openKeys = new Set(leads.flatMap(outreachIdentityKeys));
  const enrolledKeys = new Set(leads.filter((lead) => lead.campaignId).flatMap(outreachIdentityKeys));
  const cutoff = Date.parse(now) - segment.quietDays * 86_400_000;
  const candidates = segment.kind === "Quiet leads"
    ? leads.filter((lead) => !lead.replied && Date.parse(lead.lastOutreach) <= cutoff)
    : pastClients(db, segment.kind === "Past clients at rate target");
  const seen = new Set<string>();
  const plan = candidates.filter((candidate) => !matches || matches.has("lastOutreach" in candidate ? candidate.id : candidate.contactId)).map((candidate) => {
    const keys = outreachIdentityKeys(candidate);
    const lead = "lastOutreach" in candidate ? candidate : null;
    let status: PreviewRow["status"] = "Eligible";
    if (outreachSuppressed(suppression, { ...candidate, leadId: lead?.id })) status = "Opted out";
    else if (lead?.heldAt) status = "Lead on hold";
    else if (lead?.replyReceivedAt) status = "Reply received";
    else if (keys.some((key) => enrolledKeys.has(key))) status = "Already enrolled";
    else if (!candidate.phone || !leadContactFields.phone.safeParse(candidate.phone).success) status = "Missing valid phone";
    else if (!lead && keys.some((key) => openKeys.has(key))) status = "Existing lead";
    else if (lead?.status === "Paused") status = "Follow-up paused";
    else if (lead?.status === "Stopped") status = "Follow-up stopped";
    else if (keys.some((key) => seen.has(key))) status = "Duplicate";
    if (status === "Eligible") for (const key of keys) seen.add(key);
    const detail = "lastOutreach" in candidate ? candidate.replyReceivedAt ? "Incoming reply logged in the lead conversation" : `No reply for at least ${segment.quietDays} days` :
      segment.kind === "Past clients at rate target" ? `Observed ${candidate.observedRate?.toFixed(3)}% · Target ${candidate.targetRate?.toFixed(3)}%` : "Funded or closed borrower";
    const row: PreviewRow = { id: candidate.id, name: candidate.name,
      owner: lead?.officer || (routing?.enabled ? "Round robin when capacity is available" : "Shared inbox"), status, detail };
    return { candidate, row };
  });
  const eligible = plan.filter(({ row }) => row.status === "Eligible");
  const excluded = plan.filter(({ row }) => row.status !== "Eligible");
  const { customFilter, ...baseSegment } = segment;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    segment: fieldFilter ? { ...baseSegment, customFilter, fieldRevision: fieldFilter.field.revision } : baseSegment,
    campaign: input.campaignId, routingRevision: routing?.revision,
    sequenceVersion: sequence?.version, plan })).digest("hex");
  if (!input.fingerprint) {
    const pages = Math.max(1, Math.ceil(eligible.length / segmentEnrollmentLimit));
    const page = Math.min(input.previewPage ?? 1, pages);
    const shown = eligible.slice((page - 1) * segmentEnrollmentLimit, page * segmentEnrollmentLimit);
    const preview: SegmentPreview = { fingerprint, eligible: eligible.length, excluded: excluded.length, page, pages,
      ...(sequence ? { sequence: { kind: sequence.kind, version: sequence.version } } : {}),
      rows: [...shown, ...(page === 1 ? excluded.slice(0, segmentEnrollmentLimit) : [])].map(({ row }) => row) };
    return { preview, message: "Segment preview is ready." };
  }
  if (input.fingerprint !== fingerprint) return { error: "The segment results changed. Preview them again before enrolling." };
  const selected = new Set(input.selectedIds);
  const batch = eligible.filter(({ row }) => selected.has(row.id));
  if (!batch.length || batch.length !== selected.size) {
    return { error: "Select eligible borrowers from this segment preview before enrolling." };
  }

  const dueAt = firstContactDue(now, leadRouting(db));
  const leadIds: string[] = [];
  const recordSegment = db.prepare("UPDATE call_campaign_members SET segmentId = ? WHERE leadId = ?");
  for (const { candidate, row } of batch) {
    let leadId = candidate.id;
    if (!("lastOutreach" in candidate)) {
      leadId = crypto.randomUUID();
      const requestId = candidate.scenarioId ? `${pilotSegmentLeadPrefix(candidate.scenarioId)}${leadId}` : leadId;
      db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, createdAt, dueAt, importSource, importedContactId)
        VALUES (?, ?, ?, ?, ?, 'Refinance', '', ?, ?, 'Returning client', ?)`)
        .run(leadId, requestId, candidate.name, candidate.email, candidate.phone, now, dueAt, candidate.contactId);
    }
    const linked = linkCampaignLead(db, input.campaignId, leadId, now);
    if ("error" in linked || !linked.added) return { error: "A borrower is no longer eligible. Preview the segment again." };
    recordSegment.run(segment.id, leadId);
    if (sequence) enrollCampaignSequence(db, leadId, sequence, now);
    leadIds.push(leadId);
    leadEvent(db, leadId, staff?.name ?? "Demo workspace", now, `Enrolled from ${segment.name} · ${row.detail}.`, "Campaign");
  }
  accessEvent(db, staff, "Enrolled CRM segment in call campaign", `${segment.id} · ${input.campaignId} · ${batch.length}`, now);
  const { assigned } = distributeCampaignLeads(db, staff, input.campaignId, staff ? members : undefined, now, leadIds);
  return { leadIds, message: `${batch.length} ${batch.length === 1 ? "borrower enrolled" : "borrowers enrolled"} from ${segment.name}.${assigned ? ` ${assigned} routed.` : ""}` };
}

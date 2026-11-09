import { assignableCampaignLead, campaignAssignmentLimit, localCampaignOfficers,
  type CampaignRouting, type saveCampaignRoutingInput } from "./call-campaign-model";
import { assignRoutedCampaignLead } from "./lead-inbox";
import { blockedOutreachKeys, outreachSuppressed, outreachSuppressionKeys, prospectiveOptOutKeys, type OutreachOptOutTarget } from "./outreach-preferences";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";
import type { z } from "zod";

export type CampaignRefillRoster = { campaignId: string; revision: number; members: StaffIdentity[] };
type CampaignOptOutPlan = { campaignId: string; revision: number; officers: string[] };
export type CampaignOptOutRoster = { plans: CampaignOptOutPlan[]; members: StaffIdentity[] };
type CampaignLoad = Map<string, number>;
type CampaignRelease = { ownerEmail: string } | { previous: CampaignLoad; suppression: Set<string> };

export function readCampaignRouting(db: Store, campaignId: string): (CampaignRouting & { cursor: string | null }) | undefined {
  const row = db.prepare("SELECT enabled, officers, revision, cursor FROM campaign_routing WHERE campaignId = ?").get(campaignId);
  if (row) return { enabled: Boolean(row.enabled), officers: JSON.parse(String(row.officers)), revision: Number(row.revision),
    cursor: typeof row.cursor === "string" ? row.cursor : null };
}

export function saveCampaignRouting(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof saveCampaignRoutingInput>, members: StaffIdentity[], now: string) {
  if (!db.prepare("SELECT 1 FROM call_campaigns WHERE id = ?").get(input.campaignId)) return { error: "This campaign is no longer available." };
  const prior = readCampaignRouting(db, input.campaignId);
  if ((prior?.revision ?? 0) !== input.revision) return { error: "Routing changed. Refresh the campaign before saving." };
  const roster = staff ? members : localCampaignOfficers;
  if (input.officers.some(({ email }) => !roster.some((member) => member.email === email))) {
    return { error: "Choose active loan officers or admins in this brokerage." };
  }
  db.prepare(`INSERT INTO campaign_routing (campaignId, enabled, officers, revision) VALUES (?, ?, ?, ?)
    ON CONFLICT(campaignId) DO UPDATE SET enabled = excluded.enabled, officers = excluded.officers, revision = excluded.revision`)
    .run(input.campaignId, Number(input.enabled), JSON.stringify(input.officers), input.revision + 1);
  accessEvent(db, staff, "Updated campaign routing", input.campaignId, now);
  return { message: "Campaign routing saved." };
}

export function campaignReleaseRouting(db: Store, staff: WorkspaceStaff | null, leadId: string) {
  if (staff && (!staff.brokerage.pilot || staff.brokerage.role === "Processor")) return;
  const lead = db.prepare(`SELECT member.campaignId, lead.id AS leadId, lead.officerEmail, lead.email, lead.phone, lead.importedContactId AS contactId
    FROM referral_leads lead JOIN call_campaign_members member ON member.leadId = lead.id
    JOIN campaign_routing routing ON routing.campaignId = member.campaignId AND routing.enabled = 1
    WHERE lead.id = ? AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND lead.officerEmail IS NOT NULL
      AND coalesce(member.lastOutcome, '') <> 'Opted out' AND EXISTS (
        SELECT 1 FROM call_campaign_members waiting JOIN referral_leads shared ON shared.id = waiting.leadId
        WHERE waiting.campaignId = member.campaignId AND shared.officerEmail IS NULL AND shared.resolvedAt IS NULL AND shared.heldAt IS NULL
          AND coalesce(waiting.lastOutcome, '') <> 'Opted out'
      )`).get(leadId);
  if (!lead || typeof lead.campaignId !== "string" || typeof lead.officerEmail !== "string" ||
    (staff?.brokerage.role === "LO" && lead.officerEmail !== staff.email)) return;
  const routing = readCampaignRouting(db, lead.campaignId);
  if (!routing?.officers.some(({ email }) => email === lead.officerEmail) || !assignableCampaignLead({
    phone: String(lead.phone ?? ""), outreachSuppressed: outreachSuppressed(blockedOutreachKeys(db, [lead]), lead),
  })) return;
  return { campaignId: lead.campaignId, ownerEmail: lead.officerEmail, revision: routing.revision, officers: routing.officers.map(({ email }) => email) };
}

function campaignRoutingLeads(db: Store, campaignId: string, suppression = outreachSuppressionKeys(db)) {
  return db.prepare(`SELECT lead.id, lead.officerEmail, lead.email, lead.phone, lead.importedContactId AS contactId
    FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    WHERE member.campaignId = ? AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND coalesce(member.lastOutcome, '') <> 'Opted out'
    ORDER BY member.joinedAt, lead.createdAt, lead.id`).all(campaignId)
    .filter((lead) => assignableCampaignLead({ phone: String(lead.phone ?? ""), outreachSuppressed: outreachSuppressed(suppression, { ...lead, leadId: lead.id }) }));
}

function campaignLoad(leads: ReturnType<typeof campaignRoutingLeads>) {
  const counts: CampaignLoad = new Map();
  for (const { officerEmail } of leads) {
    if (typeof officerEmail === "string") counts.set(officerEmail, (counts.get(officerEmail) ?? 0) + 1);
  }
  return counts;
}

function releasedCampaignSlots(officers: CampaignRouting["officers"], previous: CampaignLoad, current: CampaignLoad) {
  return officers.reduce((slots, { email, limit }) => {
    const before = Math.max(0, limit - (previous.get(email) ?? 0));
    const after = Math.max(0, limit - (current.get(email) ?? 0));
    return slots + Math.max(0, after - before);
  }, 0);
}

export function campaignOptOutPlans(db: Store, target: OutreachOptOutTarget): CampaignOptOutPlan[] {
  const projected = prospectiveOptOutKeys(db, target);
  if (!projected.size) return [];
  const current = outreachSuppressionKeys(db);
  const candidates = db.prepare(`SELECT member.campaignId, lead.id AS leadId, lead.email, lead.phone, lead.importedContactId AS contactId
    FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    JOIN campaign_routing routing ON routing.campaignId = member.campaignId AND routing.enabled = 1
    WHERE lead.officerEmail IS NOT NULL AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND coalesce(member.lastOutcome, '') <> 'Opted out'`).all();
  const affected = new Set(candidates.filter((lead) => outreachSuppressed(projected, lead) && assignableCampaignLead({
    phone: String(lead.phone ?? ""), outreachSuppressed: outreachSuppressed(current, lead),
  })).map(({ campaignId }) => String(campaignId)));
  return [...affected].flatMap((campaignId) => {
    const routing = readCampaignRouting(db, campaignId);
    if (!routing?.enabled) return [];
    const before = campaignRoutingLeads(db, campaignId, current);
    const after = before.filter((lead) => !outreachSuppressed(projected, { ...lead, leadId: lead.id }));
    if (!after.some(({ officerEmail }) => !officerEmail) || !releasedCampaignSlots(routing.officers, campaignLoad(before), campaignLoad(after))) return [];
    return [{ campaignId, revision: routing.revision, officers: routing.officers.map(({ email }) => email) }];
  });
}

export function captureCampaignOptOutCapacity(db: Store, staff: WorkspaceStaff | null, roster?: CampaignOptOutRoster, target?: OutreachOptOutTarget) {
  const plans = staff ? roster?.plans ?? [] : target ? campaignOptOutPlans(db, target) : [];
  if (!plans.length) return [];
  const suppression = outreachSuppressionKeys(db);
  return plans.flatMap(({ campaignId, revision }) => {
    const routing = readCampaignRouting(db, campaignId);
    return routing?.enabled && routing.revision === revision
      ? [{ campaignId, load: campaignLoad(campaignRoutingLeads(db, campaignId, suppression)) }]
      : [];
  });
}

export function refillCampaignsAfterOptOut(db: Store, staff: WorkspaceStaff | null, previous: ReturnType<typeof captureCampaignOptOutCapacity>,
  now: string, roster?: CampaignOptOutRoster) {
  if (!previous.length) return 0;
  const suppression = outreachSuppressionKeys(db);
  let assigned = 0;
  for (const { campaignId, load } of previous) {
    assigned += distributeCampaignLeads(db, staff, campaignId, roster?.members ?? [], now, undefined, { previous: load, suppression }).assigned;
  }
  return assigned;
}

export function campaignRefillNotice(assigned: number) {
  if (assigned === 1) return " A shared lead was routed to an open campaign slot.";
  return assigned ? ` ${assigned} shared leads were routed to open campaign slots.` : "";
}

export function returnCampaignLeadToShared(db: Store, staff: WorkspaceStaff | null, leadId: string, from: "hold" | "archive") {
  if (staff && (!staff.brokerage.pilot || staff.brokerage.role === "Processor")) return false;
  const lead = db.prepare(`SELECT member.campaignId, lead.id AS leadId, lead.officerEmail, lead.email, lead.phone, lead.importedContactId AS contactId,
    lead.heldAt, lead.resolvedAt, lead.archiveToken FROM referral_leads lead JOIN call_campaign_members member ON member.leadId = lead.id
    JOIN campaign_routing routing ON routing.campaignId = member.campaignId AND routing.enabled = 1
    WHERE lead.id = ? AND lead.loanId IS NULL AND lead.officerEmail IS NOT NULL AND coalesce(member.lastOutcome, '') <> 'Opted out'`).get(leadId);
  if (!lead || typeof lead.campaignId !== "string" || typeof lead.officerEmail !== "string" ||
    (staff?.brokerage.role === "LO" && lead.officerEmail !== staff.email)) return false;
  const returning = from === "hold" ? lead.heldAt && !lead.resolvedAt : lead.archiveToken && lead.resolvedAt && !lead.heldAt;
  if (!returning) return false;
  const owner = readCampaignRouting(db, lead.campaignId)?.officers.find(({ email }) => email === lead.officerEmail);
  return !!owner && assignableCampaignLead({ phone: String(lead.phone ?? ""), outreachSuppressed: outreachSuppressed(blockedOutreachKeys(db, [lead]), lead) }) &&
    campaignRoutingLeads(db, lead.campaignId).filter(({ officerEmail }) => officerEmail === owner.email).length >= owner.limit;
}

export function distributeCampaignLeads(db: Store, staff: WorkspaceStaff | null, campaignId: string, members: StaffIdentity[], now: string,
  newLeadIds?: string[], release?: CampaignRelease) {
  const routing = readCampaignRouting(db, campaignId);
  if (!routing?.enabled || newLeadIds?.length === 0) return { assigned: 0, remaining: 0 };
  const roster = staff ? members : localCampaignOfficers;
  const officers = routing.officers.flatMap((rule) => {
    const owner = roster.find(({ email }) => email === rule.email);
    return owner ? [{ ...rule, owner }] : [];
  });
  const leads = campaignRoutingLeads(db, campaignId, release && "previous" in release ? release.suppression : undefined);
  const unassigned = leads.filter((lead) => !lead.officerEmail);
  const byId = new Map(unassigned.map((lead) => [String(lead.id), lead]));
  const queue = newLeadIds ? newLeadIds.flatMap((id) => {
    const lead = byId.get(id);
    return lead ? [lead] : [];
  }) : unassigned;
  const counts = campaignLoad(leads);
  let assignmentLimit = campaignAssignmentLimit;
  if (release && "ownerEmail" in release) {
    assignmentLimit = officers.some(({ email, limit }) => email === release.ownerEmail && (counts.get(email) ?? 0) < limit) ? 1 : 0;
  }
  if (release && "previous" in release) {
    assignmentLimit = Math.min(campaignAssignmentLimit, releasedCampaignSlots(officers, release.previous, counts));
  }
  let cursor = routing.cursor;
  let assigned = 0;
  for (const lead of queue.slice(0, assignmentLimit)) {
    const start = officers.findIndex(({ email }) => email === cursor) + 1;
    const officer = [...officers.slice(start), ...officers.slice(0, start)].find(({ email, limit }) => (counts.get(email) ?? 0) < limit);
    if (!officer) break;
    if (!assignRoutedCampaignLead(db, staff, campaignId, String(lead.id), officer.owner, now)) throw new Error("The campaign lead is no longer shared.");
    cursor = officer.email;
    counts.set(cursor, (counts.get(cursor) ?? 0) + 1);
    assigned++;
  }
  if (assigned) {
    db.prepare("UPDATE campaign_routing SET cursor = ? WHERE campaignId = ?").run(cursor, campaignId);
    accessEvent(db, staff, "Routed campaign leads", `${campaignId} · ${assigned}`, now);
  }
  return { assigned, remaining: queue.length - assigned };
}

import { readCampaignRouting, saveCampaignRouting } from "./campaign-routing";
import { createCallCampaign, mayManageCampaigns } from "./call-campaigns";
import { campaignManualLender, campaignOrigin, localCampaignOfficers, rehearsalBuyerKey, rehearsalReserveKey, type CampaignRehearsal } from "./call-campaign-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import { insertSubmission, savedPricingRun, type Store } from "./store";
import type { BrokerageMember } from "./brokerage-model";
import { recordedFundingCheckIn } from "./playbooks";
import { hasPreparedLenderExport } from "./lender-export";

export type CampaignRehearsalMember = StaffIdentity & Partial<Pick<BrokerageMember, "role" | "status">> & { accessRevision?: number };

const setting = "campaignRehearsal";
const buyerSetting = "campaignRehearsalBuyer";
const ready = { message: "Campaign rehearsal is ready. Import the fictional CSV to begin." };

export function loadCampaignRehearsal(db: Store, staff: WorkspaceStaff | null, id: string, members: CampaignRehearsalMember[], now: string, buyerEmail?: string) {
  if (!mayManageCampaigns(staff)) return { error: "Only a fictional pilot admin can set up this campaign rehearsal." };
  const existing = readCampaignRehearsal(db);
  if (existing && (existing.campaignId !== id || existing.buyerEmail === buyerEmail)) return ready;
  if (existing?.leadId) return { error: "Use campaign assignments once the walkthrough buyer has been imported." };
  const buyer = buyerEmail ? members.find(({ email, role }) => email === buyerEmail && role === "LO") : undefined;
  if (buyerEmail && (!staff || !buyer || buyer.email === staff.email)) return { error: "Select an active loan officer in this pilot workspace." };
  if (!existing) {
    const created = createCallCampaign(db, staff, { type: "createCallCampaign", id, name: `CSV to repeat loan · ${id.slice(0, 8)}` }, now);
    if ("error" in created) return created;
  }
  const roster = staff ? buyer ? [buyer, staff] : [staff, ...members.filter(({ email }) => email !== staff.email).slice(0, 1)] : localCampaignOfficers;
  const routing = saveCampaignRouting(db, staff, {
    type: "saveCampaignRouting", campaignId: id, revision: readCampaignRouting(db, id)?.revision ?? 0, enabled: true,
    officers: roster.map(({ email }) => ({ email, limit: 1 })),
  }, roster, now);
  if ("error" in routing) return routing;
  const write = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  write.run(setting, id);
  if (buyerEmail) write.run(buyerSetting, buyerEmail);
  else db.prepare("DELETE FROM settings WHERE key = ?").run(buyerSetting);
  return ready;
}

export function campaignRehearsalBuyer(db: Store, campaignId: string) {
  const row = db.prepare(`SELECT buyer.value AS email FROM settings buyer
    JOIN settings rehearsal ON rehearsal.key = ? AND rehearsal.value = ? WHERE buyer.key = ?`).get(setting, campaignId, buyerSetting);
  return typeof row?.email === "string" ? row.email : undefined;
}

export function readCampaignRehearsal(db: Store): CampaignRehearsal | null {
  const campaign = db.prepare("SELECT campaign.id FROM settings JOIN call_campaigns campaign ON campaign.id = settings.value WHERE settings.key = ?").get(setting);
  if (!campaign) return null;
  const campaignId = String(campaign.id);
  const imported = db.prepare(`SELECT record.recordKey, member.leadId, lead.loanId FROM migration_records record
    JOIN call_campaign_members member ON member.leadId = record.targetId AND member.campaignId = ?
    JOIN referral_leads lead ON lead.id = member.leadId
    WHERE record.origin = ? AND record.recordKey IN (?, ?)`)
    .all(campaignId, campaignOrigin(campaignId), rehearsalBuyerKey, rehearsalReserveKey);
  const buyer = imported.find(({ recordKey }) => recordKey === rehearsalBuyerKey);
  const buyerEmail = campaignRehearsalBuyer(db, campaignId);
  const checkInActivityId = typeof buyer?.loanId === "string" ? recordedFundingCheckIn(db, buyer.loanId) : undefined;
  return { campaignId, leadId: buyer ? String(buyer.leadId) : null, importedCount: imported.length,
    ...(buyerEmail ? { buyerEmail } : {}), ...(checkInActivityId ? { checkInActivityId } : {}) };
}

export function linkCampaignSampleRealtor(db: Store, input: { loanId: string; scenarioId: string }, staff: WorkspaceStaff | null, now: string) {
  if (!mayManageCampaigns(staff)) return { error: "Only a fictional pilot admin can link the sample realtor." };
  const rehearsal = readCampaignRehearsal(db);
  const loan = db.prepare(`SELECT loan.partnerId, loan.stage, loan.disposition FROM referral_leads lead
    JOIN loans loan ON loan.id = lead.loanId WHERE lead.id = ? AND loan.id = ?`).get(rehearsal?.leadId ?? "", input.loanId);
  const partner = db.prepare(`SELECT contact.id FROM pilot_scenario scenario
    JOIN contacts contact ON contact.id = scenario.realtorId AND contact.role = 'Realtor'
    JOIN realtor_portals portal ON portal.realtorId = contact.id AND portal.expiresAt > ?
    WHERE scenario.singleton = 1 AND scenario.id = ?`).get(now, input.scenarioId);
  if (!loan || !partner) return { error: "Refresh the walkthrough and choose the current campaign loan and sample realtor." };
  const success = { message: "Sample realtor linked. The realtor view will show this loan’s milestones." };
  if (loan.partnerId === partner.id) return success;
  if (loan.partnerId) return { error: "This loan already has a realtor partner. Review it from the loan record." };
  if (loan.disposition !== "Active" || ["Funded", "Closed"].includes(String(loan.stage)) ||
    db.prepare("SELECT 1 FROM submissions WHERE loanId = ?").get(input.loanId)) {
    return { error: "Link the sample realtor before sending the active campaign loan to a lender." };
  }
  db.prepare("UPDATE loans SET partnerId = ? WHERE id = ?").run(partner.id, input.loanId);
  return success;
}

// Called inside the workspace mutation so the file and its acknowledgment are saved together.
export function ensureCampaignManualFile(db: Store, input: { loanId: string; revision: number; lenderRevision: number }, staff: WorkspaceStaff | null) {
  const rehearsal = readCampaignRehearsal(db);
  if ((staff && !staff.brokerage.pilot) || !rehearsal?.leadId ||
    !db.prepare("SELECT 1 FROM referral_leads WHERE id = ? AND loanId = ?").get(rehearsal.leadId, input.loanId)) {
    return { error: "The simulated acknowledgment is available for the fictional campaign loan." };
  }
  if (!hasPreparedLenderExport(db, input)) return { error: "Prepare the MISMO export for the current reviewed 1003 before recording acknowledgment." };
  const quote = savedPricingRun(db, input.loanId);
  if (quote?.mode !== "mock" || quote.applicationRevision !== input.revision) {
    return { error: "Save a mock quote for the current 1003 before recording the simulated acknowledgment." };
  }
  const entry = campaignManualLender(input.loanId);
  const existing = db.prepare("SELECT loanId, syncedAt FROM submissions WHERE lender = ? AND externalId = ?").get(entry.lender, entry.externalId);
  if (existing && (existing.loanId !== input.loanId || existing.syncedAt)) {
    return { error: "The fictional lender reference is already in use." };
  }
  if (!existing) insertSubmission(db, { ...entry, id: crypto.randomUUID(), loanId: input.loanId, conditions: [], syncedAt: null });
  return { entry };
}

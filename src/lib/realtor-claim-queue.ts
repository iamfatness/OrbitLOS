import type { z } from "zod";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { canClaimSharedRealtor, sharedRealtorQueueInput, sharedRealtorQueueUnavailable,
  type RealtorClaimPolicy, type saveRealtorClaimPolicyInput, type SharedRealtorQueue } from "./realtor-claim-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const key = "realtorClaimPolicy";

export function readRealtorClaimPolicy(db: Store): RealtorClaimPolicy {
  const saved = db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value;
  return typeof saved === "string" ? JSON.parse(saved) as RealtorClaimPolicy : { revision: 0, officers: [] };
}

export function saveRealtorClaimPolicy(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof saveRealtorClaimPolicyInput>,
  members: (StaffIdentity & { role?: string; accessRevision?: number })[], now: string) {
  if (staff?.brokerage.role !== "Admin") return { error: "Only a brokerage admin can choose who can claim shared realtor referrals." };
  const current = readRealtorClaimPolicy(db);
  if (current.revision !== input.revision) return { error: "Claim eligibility changed. Refresh the inbox before saving." };
  const officers: RealtorClaimPolicy["officers"] = [];
  for (const email of input.officers) {
    const member = members.find((candidate) => candidate.email === email && candidate.role === "LO");
    if (member?.accessRevision === undefined) return { error: "Choose active loan officers in this brokerage." };
    officers.push({ email, accessRevision: member.accessRevision });
  }
  const next: RealtorClaimPolicy = { revision: current.revision + 1, officers };
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    .run(key, JSON.stringify(next));
  accessEvent(db, staff, "Updated shared realtor claim eligibility", staff.brokerage.id, now);
  return { message: "Shared realtor claim eligibility saved." };
}

export function readSharedRealtorQueue(db: Store, staff: WorkspaceStaff | null, brokerageId: string, input: unknown): SharedRealtorQueue | { error: string } {
  if (staff?.brokerage.id !== brokerageId || !canClaimSharedRealtor(staff, readRealtorClaimPolicy(db))) return { error: sharedRealtorQueueUnavailable };
  const parsed = sharedRealtorQueueInput.safeParse(input);
  if (!parsed.success) return { error: "Refresh the shared realtor referral queue before continuing." };
  const after = parsed.data.after;
  const rows = db.prepare(`SELECT lead.id, lead.dueAt, lead.purpose, contact.name AS realtor, lead.email, lead.phone, lead.importedContactId AS contactId,
      follow.firstContactAt IS NOT NULL AS firstContactLogged
    FROM referral_leads lead JOIN contacts contact ON contact.id = lead.realtorId AND contact.role = 'Realtor'
    LEFT JOIN call_campaign_members campaign ON campaign.leadId = lead.id
    LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id
    WHERE lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND lead.officerEmail IS NULL AND lead.realtorId IS NOT NULL
      AND coalesce(campaign.lastOutcome, '') <> 'Opted out' ${after ? "AND (lead.dueAt, lead.id) > (?, ?)" : ""}
    ORDER BY lead.dueAt, lead.id LIMIT 61`).all(...(after ? [after.dueAt, after.id] : []));
  const suppression = blockedOutreachKeys(db, rows.slice(0, 60).map((row) => ({ ...row, leadId: row.id })));
  const leads: SharedRealtorQueue["leads"] = [];
  let scanned = 0;
  for (const row of rows.slice(0, 60)) {
    scanned++;
    if (outreachSuppressed(suppression, { ...row, leadId: row.id })) continue;
    leads.push({ id: String(row.id), dueAt: String(row.dueAt), purpose: String(row.purpose), realtor: String(row.realtor),
      firstContactLogged: Boolean(row.firstContactLogged) });
    if (leads.length === 20) break;
  }
  const last = rows[scanned - 1];
  return { leads, next: last && scanned < rows.length ? { id: String(last.id), dueAt: String(last.dueAt) } : null };
}

import type { z } from "zod";
import type { saveBorrowerChannelsInput } from "./borrower-channel-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import type { BorrowerHours } from "./borrower-hours";

export const leadChannelBlocksSql = `(coalesce((SELECT blocked FROM borrower_lead_channels WHERE leadId = lead.id), 0) |
  coalesce((SELECT blocked FROM borrower_contact_channels WHERE contactId = lead.importedContactId), 0))`;
export const leadBorrowerHoursSql = `(SELECT hours FROM borrower_contact_hours WHERE contactId = lead.importedContactId)`;

export function initializeBorrowerChannels(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS borrower_contact_channels (
    contactId TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
    blocked INTEGER NOT NULL CHECK (blocked BETWEEN 0 AND 7)
  );
  CREATE TABLE IF NOT EXISTS borrower_lead_channels (
    leadId TEXT PRIMARY KEY REFERENCES referral_leads(id) ON DELETE CASCADE,
    blocked INTEGER NOT NULL CHECK (blocked BETWEEN 0 AND 7)
  );
  CREATE TABLE IF NOT EXISTS borrower_contact_hours (
    contactId TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
    hours TEXT NOT NULL
  );`);
  if (!db.prepare("PRAGMA table_info(campaign_sequence_enrollments)").all().some(({ name }) => name === "baseDueAt")) {
    db.exec("ALTER TABLE campaign_sequence_enrollments ADD COLUMN baseDueAt TEXT");
  }
  if (!db.prepare("PRAGMA table_info(lead_follow_up)").all().some(({ name }) => name === "baseNextAt")) {
    db.exec("ALTER TABLE lead_follow_up ADD COLUMN baseNextAt TEXT");
  }
}

export function storedBorrowerHours(value: unknown): BorrowerHours | null {
  return typeof value === "string" ? JSON.parse(value) as BorrowerHours : null;
}

export function readBorrowerHours(db: Store, contactId: string) {
  return storedBorrowerHours(db.prepare("SELECT hours FROM borrower_contact_hours WHERE contactId = ?").get(contactId)?.hours);
}

export function setBorrowerHours(db: Store, contactId: string, hours: BorrowerHours | null) {
  if (hours) db.prepare(`INSERT INTO borrower_contact_hours (contactId, hours) VALUES (?, ?)
    ON CONFLICT (contactId) DO UPDATE SET hours = excluded.hours`).run(contactId, JSON.stringify(hours));
  else db.prepare("DELETE FROM borrower_contact_hours WHERE contactId = ?").run(contactId);
}

export function readContactChannelBlocks(db: Store, contactId: string) {
  return Number(db.prepare("SELECT blocked FROM borrower_contact_channels WHERE contactId = ?").get(contactId)?.blocked ?? 0);
}

export type ChannelTarget = { kind: "contact" | "lead"; id: string };

export function storedChannelBlocks(db: Store, { kind, id }: ChannelTarget) {
  return kind === "contact" ? readContactChannelBlocks(db, id) :
    Number(db.prepare("SELECT blocked FROM borrower_lead_channels WHERE leadId = ?").get(id)?.blocked ?? 0);
}

export function effectiveChannelBlocks(db: Store, target: ChannelTarget) {
  return target.kind === "lead" ? Number(db.prepare(`SELECT ${leadChannelBlocksSql} AS blocked FROM referral_leads lead WHERE id = ?`).get(target.id)?.blocked ?? 0)
    : readContactChannelBlocks(db, target.id);
}

export function currentChannelTarget(db: Store, kind: ChannelTarget["kind"], id: string): ChannelTarget | undefined {
  if (kind === "lead") {
    const lead = db.prepare(`SELECT lead.loanId, loan.contactId FROM referral_leads lead
      LEFT JOIN loans loan ON loan.id = lead.loanId WHERE lead.id = ?`).get(id);
    if (!lead) return;
    if (!lead.loanId) return { kind, id };
    if (typeof lead.contactId !== "string") return;
    id = lead.contactId;
  }
  return db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role <> 'Realtor'").get(id) ? { kind: "contact", id } : undefined;
}

export function setContactChannelBlocks(db: Store, contactId: string, blocked: number) {
  if (blocked) db.prepare(`INSERT INTO borrower_contact_channels (contactId, blocked) VALUES (?, ?)
    ON CONFLICT (contactId) DO UPDATE SET blocked = excluded.blocked`).run(contactId, blocked);
  else db.prepare("DELETE FROM borrower_contact_channels WHERE contactId = ?").run(contactId);
}

export function linkedChannelLeadIds(db: Store, contactId: string) {
  return db.prepare("SELECT id FROM referral_leads WHERE importedContactId = ? AND resolvedAt IS NULL")
    .all(contactId).map(({ id }) => String(id));
}

export function saveBorrowerChannels(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof saveBorrowerChannelsInput>) {
  const { target, recordId, expected, blocked } = input;
  const unavailable = { error: "This borrower record is unavailable." };
  if (staff?.brokerage.role === "Processor") return unavailable;
  let contactId: string | null = null;
  let current: number;
  if (target === "lead") {
    const lead = db.prepare(`SELECT lead.importedContactId, lead.officerEmail, ${leadChannelBlocksSql} AS blocked
      FROM referral_leads lead WHERE lead.id = ? AND lead.resolvedAt IS NULL`).get(recordId);
    if (!lead || (staff?.brokerage.role === "LO" && lead.officerEmail !== staff.email)) return unavailable;
    contactId = typeof lead.importedContactId === "string" ? lead.importedContactId : null;
    current = Number(lead.blocked);
  } else {
    if (!db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role <> 'Realtor'").get(recordId)) return unavailable;
    contactId = recordId;
    current = readContactChannelBlocks(db, recordId);
  }
  if (current !== expected) return { error: "Contact preferences changed. Refresh the borrower record before saving." };
  if (current === blocked) return { contactId, leadIds: [], changed: false };
  if (contactId) {
    setContactChannelBlocks(db, contactId, blocked);
    if (target === "lead") db.prepare("DELETE FROM borrower_lead_channels WHERE leadId = ?").run(recordId);
  } else if (blocked) {
    db.prepare(`INSERT INTO borrower_lead_channels (leadId, blocked) VALUES (?, ?)
      ON CONFLICT (leadId) DO UPDATE SET blocked = excluded.blocked`).run(recordId, blocked);
  } else db.prepare("DELETE FROM borrower_lead_channels WHERE leadId = ?").run(recordId);
  return { contactId, leadIds: contactId ? linkedChannelLeadIds(db, contactId) : [recordId], changed: true };
}

export function carryLeadChannelBlocks(db: Store, leadId: string, contactId: string) {
  const lead = db.prepare(`SELECT ${leadChannelBlocksSql} AS blocked FROM referral_leads lead WHERE lead.id = ?`).get(leadId);
  const current = readContactChannelBlocks(db, contactId);
  const merged = current | Number(lead?.blocked ?? 0);
  if (merged === current) return false;
  setContactChannelBlocks(db, contactId, merged);
  return true;
}

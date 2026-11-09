import { referralPhone } from "./referral-matches";
import type { Store } from "./store";
import { closeCampaignAssignment } from "./campaign-response";

type Identity = { leadId?: unknown; contactId?: unknown; email?: unknown; phone?: unknown };
export type OutreachOptOutTarget = { kind: "lead" | "contact"; id: string };

export function outreachIdentityKeys(identity: Identity) {
  const email = typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
  const phone = typeof identity.phone === "string" ? referralPhone(identity.phone) : "";
  return [identity.leadId && `lead:${identity.leadId}`, identity.contactId && `contact:${identity.contactId}`, email && `email:${email}`,
    /^\d{10,15}$/.test(phone) && `phone:${phone}`].filter((key): key is string => typeof key === "string" && !!key);
}

export function outreachSuppressed(suppressed: Set<string>, identity: Identity) {
  return outreachIdentityKeys(identity).some((key) => suppressed.has(key));
}

export function initializeContactOutreachIndex(db: Store) {
  upgradeContactKeyTrigger(db, "contact_outreach");
  db.exec(`CREATE TABLE IF NOT EXISTS contact_outreach_keys (
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, identityKey TEXT NOT NULL, PRIMARY KEY(contactId, identityKey)
  );
  CREATE INDEX IF NOT EXISTS contacts_by_outreach_key ON contact_outreach_keys(identityKey, contactId);
  CREATE TABLE IF NOT EXISTS contact_outreach_pending (contactId TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE);
  CREATE TRIGGER IF NOT EXISTS contact_outreach_insert AFTER INSERT ON contacts WHEN NEW.role <> 'Realtor' BEGIN
    INSERT OR IGNORE INTO contact_outreach_pending VALUES (NEW.id);
  END;
  CREATE TRIGGER IF NOT EXISTS contact_outreach_update AFTER UPDATE OF email, phone, role ON contacts
    WHEN OLD.email IS NOT NEW.email OR OLD.phone IS NOT NEW.phone OR OLD.role IS NOT NEW.role BEGIN
    DELETE FROM contact_outreach_keys WHERE contactId = NEW.id;
    DELETE FROM contact_outreach_pending WHERE contactId = NEW.id;
    INSERT OR IGNORE INTO contact_outreach_pending SELECT NEW.id WHERE NEW.role <> 'Realtor';
  END;`);
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'contactOutreachIndexV1'").get()) {
    db.exec(`INSERT OR IGNORE INTO contact_outreach_pending SELECT id FROM contacts WHERE role <> 'Realtor';
      INSERT INTO settings VALUES ('contactOutreachIndexV1', '1');`);
  }
  indexPendingContactOutreach(db);
}

export function indexPendingContactOutreach(db: Store) {
  indexPendingContactKeys(db, "contact_outreach");
}

export function indexPendingRealtorReplies(db: Store) {
  indexPendingContactKeys(db, "realtor_reply");
}

function indexPendingContactKeys(db: Store, index: "contact_outreach" | "realtor_reply") {
  const rows = db.prepare(`SELECT contact.id AS contactId, contact.email, contact.phone FROM ${index}_pending pending
    JOIN contacts contact ON contact.id = pending.contactId ORDER BY pending.contactId LIMIT 500`).all();
  if (!rows.length) return;
  const insert = db.prepare(`INSERT OR IGNORE INTO ${index}_keys VALUES (?, ?)`);
  const remove = db.prepare(`DELETE FROM ${index}_pending WHERE contactId = ?`);
  for (const row of rows) {
    for (const key of outreachIdentityKeys(row)) insert.run(row.contactId, key);
    remove.run(row.contactId);
  }
}

export function initializeRealtorReplyIndex(db: Store) {
  upgradeContactKeyTrigger(db, "realtor_reply");
  db.exec(`CREATE TABLE IF NOT EXISTS realtor_reply_keys (
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, identityKey TEXT NOT NULL, PRIMARY KEY(contactId, identityKey)
  );
  CREATE INDEX IF NOT EXISTS realtors_by_reply_key ON realtor_reply_keys(identityKey, contactId);
  CREATE TABLE IF NOT EXISTS realtor_reply_pending (contactId TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE);
  CREATE TRIGGER IF NOT EXISTS realtor_reply_insert AFTER INSERT ON contacts WHEN NEW.role = 'Realtor' BEGIN
    INSERT OR IGNORE INTO realtor_reply_pending VALUES (NEW.id);
  END;
  CREATE TRIGGER IF NOT EXISTS realtor_reply_update AFTER UPDATE OF email, phone, role ON contacts
    WHEN OLD.email IS NOT NEW.email OR OLD.phone IS NOT NEW.phone OR OLD.role IS NOT NEW.role BEGIN
    DELETE FROM realtor_reply_keys WHERE contactId = NEW.id;
    DELETE FROM realtor_reply_pending WHERE contactId = NEW.id;
    INSERT OR IGNORE INTO realtor_reply_pending SELECT NEW.id WHERE NEW.role = 'Realtor';
  END;`);
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'realtorReplyIndexV1'").get()) {
    db.exec(`INSERT OR IGNORE INTO realtor_reply_pending SELECT id FROM contacts WHERE role = 'Realtor';
      INSERT INTO settings VALUES ('realtorReplyIndexV1', '1');`);
  }
}

function upgradeContactKeyTrigger(db: Store, index: "contact_outreach" | "realtor_reply") {
  const marker = `${index}_distinct_updates_v1`;
  if (db.prepare("SELECT 1 FROM settings WHERE key = ?").get(marker)) return;
  db.exec(`DROP TRIGGER IF EXISTS ${index}_update;`);
  db.prepare("INSERT INTO settings VALUES (?, '1')").run(marker);
}

export function pendingReplyMatches(db: Store, key: string) {
  indexPendingContactOutreach(db);
  indexPendingRealtorReplies(db);
  return db.prepare(`WITH pending AS (
    SELECT contactId FROM contact_outreach_pending UNION ALL SELECT contactId FROM realtor_reply_pending
  ) SELECT contact.id, contact.email, contact.phone FROM pending
    JOIN contacts contact ON contact.id = pending.contactId`).all()
    .filter((contact) => outreachIdentityKeys(contact).includes(key)).map((contact) => String(contact.id));
}

export function initializeLeadReplyIndex(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS lead_reply_keys (
    leadId TEXT NOT NULL REFERENCES referral_leads(id) ON DELETE CASCADE, identityKey TEXT NOT NULL, PRIMARY KEY (leadId, identityKey)
  );
  CREATE INDEX IF NOT EXISTS leads_by_reply_key ON lead_reply_keys(identityKey, leadId);
  CREATE INDEX IF NOT EXISTS leads_by_reply_contact ON referral_leads(importedContactId, id)
    WHERE importedContactId IS NOT NULL AND resolvedAt IS NULL;
  CREATE TABLE IF NOT EXISTS lead_reply_pending (leadId TEXT PRIMARY KEY REFERENCES referral_leads(id) ON DELETE CASCADE);
  CREATE TRIGGER IF NOT EXISTS lead_reply_insert AFTER INSERT ON referral_leads WHEN NEW.resolvedAt IS NULL BEGIN
    INSERT OR IGNORE INTO lead_reply_pending VALUES (NEW.id);
  END;
  CREATE TRIGGER IF NOT EXISTS lead_reply_update AFTER UPDATE OF email, phone, resolvedAt ON referral_leads BEGIN
    DELETE FROM lead_reply_keys WHERE leadId = NEW.id;
    DELETE FROM lead_reply_pending WHERE leadId = NEW.id;
    INSERT OR IGNORE INTO lead_reply_pending SELECT NEW.id WHERE NEW.resolvedAt IS NULL;
  END;`);
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'leadReplyIndexV1'").get()) {
    db.exec(`INSERT OR IGNORE INTO lead_reply_pending SELECT id FROM referral_leads WHERE resolvedAt IS NULL;
      INSERT INTO settings VALUES ('leadReplyIndexV1', '1');`);
  }
}

// Finish a bounded batch before suggesting matches so an unindexed lead cannot hide an ambiguity.
export function prepareLeadReplyMatches(db: Store) {
  const rows = db.prepare(`SELECT lead.id, lead.email, lead.phone FROM lead_reply_pending pending
    JOIN referral_leads lead ON lead.id = pending.leadId ORDER BY pending.leadId LIMIT 501`).all();
  if (!rows.length) return true;
  const insert = db.prepare("INSERT OR IGNORE INTO lead_reply_keys VALUES (?, ?)");
  const remove = db.prepare("DELETE FROM lead_reply_pending WHERE leadId = ?");
  for (const row of rows.slice(0, 500)) {
    for (const key of outreachIdentityKeys(row)) insert.run(row.id, key);
    remove.run(row.id);
  }
  return rows.length <= 500;
}

function pendingAliases(db: Store, direct: Set<string>) {
  // Contacts still in the migration queue use the original normalizer until their index entries exist.
  return db.prepare(`SELECT contact.id AS contactId, contact.email, contact.phone FROM contact_outreach_pending pending
    JOIN contacts contact ON contact.id = pending.contactId`).all().filter((contact) => outreachSuppressed(direct, contact));
}

function matchingBorrowerContacts(db: Store, keys: Set<string>) {
  if (!keys.size) return [];
  const indexed = db.prepare(`SELECT DISTINCT contact.id AS contactId, contact.email, contact.phone
    FROM json_each(?) AS candidate JOIN contact_outreach_keys matched ON matched.identityKey = candidate.value
    JOIN contacts contact ON contact.id = matched.contactId WHERE contact.role <> 'Realtor'`).all(JSON.stringify([...keys]));
  return [...indexed, ...pendingAliases(db, keys)];
}

export function prospectiveOptOutKeys(db: Store, target: OutreachOptOutTarget) {
  const identity = target.kind === "lead"
    ? db.prepare("SELECT id AS leadId, email, phone, importedContactId AS contactId FROM referral_leads WHERE id = ?").get(target.id)
    : db.prepare("SELECT id AS contactId, email, phone FROM contacts WHERE id = ? AND role <> 'Realtor'").get(target.id);
  if (!identity) return new Set<string>();
  if (target.kind === "lead" && outreachSuppressed(blockedOutreachKeys(db, [identity]), identity)) return new Set<string>();
  indexPendingContactOutreach(db);
  const direct = new Set(outreachIdentityKeys(identity));
  if (target.kind === "lead") {
    for (const contact of matchingBorrowerContacts(db, direct)) for (const key of outreachIdentityKeys(contact)) direct.add(key);
  }
  return new Set([...direct, ...matchingBorrowerContacts(db, direct).flatMap(outreachIdentityKeys)]);
}

function directSuppression(db: Store) {
  return new Set(db.prepare("SELECT DISTINCT identityKey FROM outreach_opt_outs").all().map((row) => String(row.identityKey)));
}

export function outreachSuppressionKeys(db: Store) {
  indexPendingContactOutreach(db);
  const direct = directSuppression(db);
  if (!direct.size) return direct;
  const blocked = new Set(direct);
  // Start with the opt-outs instead of scanning every contact key to find matching aliases.
  const aliases = db.prepare(`SELECT DISTINCT alias.identityKey FROM outreach_opt_outs opt
    CROSS JOIN contact_outreach_keys matched ON matched.identityKey = opt.identityKey
    CROSS JOIN contact_outreach_keys alias ON alias.contactId = matched.contactId`).all();
  for (const row of aliases) blocked.add(String(row.identityKey));
  for (const alias of pendingAliases(db, direct)) for (const key of outreachIdentityKeys(alias)) blocked.add(key);
  return blocked;
}

export function blockedOutreachKeys(db: Store, identities: Identity[]) {
  const keys = new Set(identities.flatMap(outreachIdentityKeys));
  if (!keys.size || !db.prepare("SELECT 1 FROM outreach_opt_outs LIMIT 1").get()) return new Set<string>();
  indexPendingContactOutreach(db);
  const rows = db.prepare(`SELECT candidate.value AS identityKey FROM json_each(?) candidate
    WHERE EXISTS (SELECT 1 FROM outreach_opt_outs opt WHERE opt.identityKey = candidate.value)
    OR EXISTS (SELECT 1 FROM contact_outreach_keys alias JOIN contact_outreach_keys matched ON matched.contactId = alias.contactId
      JOIN outreach_opt_outs opt ON opt.identityKey = matched.identityKey WHERE alias.identityKey = candidate.value)`).all(JSON.stringify([...keys]));
  const blocked = new Set(rows.map((row) => String(row.identityKey)));
  if (db.prepare("SELECT 1 FROM contact_outreach_pending LIMIT 1").get()) {
    for (const alias of pendingAliases(db, directSuppression(db))) {
      for (const key of outreachIdentityKeys(alias)) if (keys.has(key)) blocked.add(key);
    }
  }
  return blocked;
}

export function loanOutreachSuppressed(db: Store, loanId: string) {
  const borrower = db.prepare(`SELECT loan.contactId, contact.email, contact.phone FROM loans loan
    JOIN contacts contact ON contact.id = loan.contactId WHERE loan.id = ?`).get(loanId);
  return !!borrower && outreachSuppressed(blockedOutreachKeys(db, [borrower]), borrower);
}

export const openCallbackPromise = "promiseRequestEventId IS NOT NULL AND promiseAttemptEventId IS NULL AND promiseClosedAt IS NULL";

export function closeCampaignCallbackPromise(db: Store, leadId: string, at: string, reason: "Lead archived" | "1003 started" | "Borrower opted out") {
  db.prepare(`UPDATE campaign_follow_up_runs SET promiseClosedAt = ?, promiseCloseReason = ? WHERE leadId = ? AND ${openCallbackPromise}`)
    .run(at, reason, leadId);
}

export function closeSuppressedOutreach(db: Store, now: string) {
  const suppressed = outreachSuppressionKeys(db);
  if (!suppressed.size) return;
  const stopSequence = db.prepare(`UPDATE lead_follow_up SET status = 'Stopped', nextAt = NULL, pausedAt = NULL, revision = revision + 1
    WHERE leadId = ? AND status IN ('Active', 'Paused')`);
  const closeTask = db.prepare(`UPDATE lead_import_tasks SET completedAt = ? WHERE completedAt IS NULL
    AND id = (SELECT callbackTaskId FROM call_campaign_members WHERE leadId = ?)`);
  const retireFollowUp = db.prepare(`UPDATE campaign_follow_up_runs SET status = 'Superseded', reason = 'Borrower opted out of outreach.'
    WHERE leadId = ? AND status IN ('Failed', 'Paused')`);
  for (const lead of db.prepare("SELECT id, email, phone, importedContactId AS contactId FROM referral_leads WHERE resolvedAt IS NULL").all()) {
    if (!outreachSuppressed(suppressed, { ...lead, leadId: lead.id })) continue;
    stopSequence.run(lead.id);
    closeTask.run(now, lead.id);
    retireFollowUp.run(lead.id);
    closeCampaignCallbackPromise(db, String(lead.id), now, "Borrower opted out");
    closeCampaignAssignment(db, String(lead.id), now);
  }
  const closeFirstContact = db.prepare("UPDATE tasks SET completedAt = ? WHERE id = 'first-contact:' || ? AND completedAt IS NULL");
  for (const loan of db.prepare("SELECT loan.id, loan.contactId, contact.email, contact.phone FROM loans loan JOIN contacts contact ON contact.id = loan.contactId").all()) {
    if (outreachSuppressed(suppressed, loan)) closeFirstContact.run(now, loan.id);
  }
}

function writeOptOut(db: Store, source: string, identity: Identity, scenarioId: unknown, now: string) {
  const insert = db.prepare("INSERT OR IGNORE INTO outreach_opt_outs (source, identityKey, scenarioId, recordedAt) VALUES (?, ?, ?, ?)");
  for (const key of outreachIdentityKeys(identity)) insert.run(source, key, typeof scenarioId === "string" ? scenarioId : null, now);
}

// Keep the original opt-out source when an existing preference gains a contact ID or a new address.
export function retainContactOptOut(db: Store, contactId: string, linkedLead?: Identity) {
  const contact = db.prepare("SELECT id AS contactId, email, phone FROM contacts WHERE id = ? AND role <> 'Realtor'").get(contactId);
  if (!contact) return;
  const identifiers = [...new Set([...outreachIdentityKeys(contact), ...outreachIdentityKeys(linkedLead ?? {})])];
  const matches = db.prepare(`SELECT DISTINCT source, scenarioId, recordedAt FROM outreach_opt_outs
    WHERE identityKey IN (${identifiers.map(() => "?").join(", ")})`).all(...identifiers);
  for (const source of matches) {
    writeOptOut(db, String(source.source), contact, source.scenarioId, String(source.recordedAt));
  }
}

export function optOutLead(db: Store, leadId: string, now: string) {
  const lead = db.prepare(`SELECT lead.email, lead.phone, lead.importedContactId AS contactId, scenario.id AS scenarioId
    FROM referral_leads lead LEFT JOIN pilot_scenario scenario ON scenario.realtorId = lead.realtorId
      OR instr(lead.requestId, 'segment-return:' || scenario.id || ':') = 1 WHERE lead.id = ?`).get(leadId);
  if (!lead) return;
  saveLeadIdentities(db, leadId, lead, lead.scenarioId, now);
  closeSuppressedOutreach(db, now);
}

function saveLeadIdentities(db: Store, leadId: string, lead: Identity, scenarioId: unknown, now: string) {
  const source = `lead:${leadId}`;
  writeOptOut(db, source, { ...lead, leadId }, scenarioId, now);
  const original = new Set(outreachIdentityKeys(lead));
  indexPendingContactOutreach(db);
  for (const contact of matchingBorrowerContacts(db, original)) writeOptOut(db, source, contact, scenarioId, now);
}

export function optOutContact(db: Store, contactId: string, now: string) {
  const contact = db.prepare(`SELECT contact.id AS contactId, contact.email, contact.phone,
    (SELECT id FROM pilot_scenario WHERE EXISTS (SELECT 1 FROM pilot_sample_contacts WHERE contactId = contact.id)) AS scenarioId
    FROM contacts contact WHERE contact.id = ? AND contact.role <> 'Realtor'`).get(contactId);
  if (!contact) return false;
  writeOptOut(db, `contact:${contactId}`, contact, contact.scenarioId, now);
  closeSuppressedOutreach(db, now);
  return true;
}

export function migrateCampaignOptOuts(db: Store) {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'migratedOutreachOptOuts'").get()) return;
  for (const lead of db.prepare(`SELECT lead.id, lead.email, lead.phone, lead.importedContactId AS contactId, scenario.id AS scenarioId,
      coalesce((SELECT max(at) FROM lead_events WHERE leadId = lead.id AND outcome = 'Opted out'), member.joinedAt) AS at
    FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
    LEFT JOIN pilot_scenario scenario ON scenario.realtorId = lead.realtorId WHERE member.lastOutcome = 'Opted out'`).all()) {
    saveLeadIdentities(db, String(lead.id), lead, lead.scenarioId, String(lead.at));
  }
  closeSuppressedOutreach(db, new Date().toISOString());
  db.prepare("INSERT INTO settings VALUES ('migratedOutreachOptOuts', '1')").run();
}

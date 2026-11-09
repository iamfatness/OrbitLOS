import type { z } from "zod";
import type { ContactMergeCursor, ContactMergeResult, DuplicateGroups, DuplicateHistory, DuplicateMembers, DuplicateScan, contactMergeInput } from "./contact-merge-model";
import type { Contact } from "./model";
import { indexPendingContactOutreach, indexPendingRealtorReplies } from "./outreach-preferences";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const indexes = ["contact_outreach_keys", "realtor_reply_keys"] as const;
const migration = "contactDuplicateGroupsV1";
const pageSize = 12;
const migrationSize = 200;
const newRevision = "lower(hex(randomblob(16)))";
const hasPair = (key: string) => `EXISTS (
  SELECT contactId FROM contact_outreach_keys WHERE identityKey = ${key}
  UNION ALL SELECT contactId FROM realtor_reply_keys WHERE identityKey = ${key}
  LIMIT 1 OFFSET 1
)`;
const addGroup = (key: string) => `INSERT OR IGNORE INTO contact_duplicate_groups (identityKey, revision)
  SELECT ${key}, ${newRevision} WHERE ${hasPair(key)}`;
const invalidateReview = (where: string) => `
  UPDATE contact_duplicate_reviews SET reopenedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE operationId IN (SELECT reviewId FROM contact_duplicate_groups WHERE ${where} AND reviewId IS NOT NULL);
  UPDATE contact_duplicate_groups SET revision = ${newRevision}, reviewId = NULL WHERE ${where};`;

export function initializeContactDuplicateQueue(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS contact_duplicate_groups (
    identityKey TEXT PRIMARY KEY, revision TEXT NOT NULL DEFAULT 'legacy', reviewId TEXT
  );
  CREATE TABLE IF NOT EXISTS contact_duplicate_reviews (
    operationId TEXT PRIMARY KEY, identityKey TEXT NOT NULL, revision TEXT NOT NULL, actor TEXT NOT NULL,
    at TEXT NOT NULL, reason TEXT NOT NULL, names TEXT NOT NULL, more INTEGER NOT NULL,
    reopenedAt TEXT, reopenedBy TEXT
  );
  CREATE INDEX IF NOT EXISTS duplicate_reviews_by_date ON contact_duplicate_reviews(at DESC, operationId DESC);`);
  if (!db.prepare("PRAGMA table_info(contact_duplicate_groups)").all().some(({ name }) => name === "revision")) {
    db.exec(`ALTER TABLE contact_duplicate_groups ADD COLUMN revision TEXT NOT NULL DEFAULT 'legacy';
      ALTER TABLE contact_duplicate_groups ADD COLUMN reviewId TEXT;
      ${indexes.map((index) => `DROP TRIGGER IF EXISTS ${index}_duplicate_insert;
        DROP TRIGGER IF EXISTS ${index}_duplicate_delete;`).join("\n")}`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS duplicate_groups_open ON contact_duplicate_groups(identityKey) WHERE reviewId IS NULL;
    CREATE TRIGGER IF NOT EXISTS contact_duplicate_name_change AFTER UPDATE OF name ON contacts
    WHEN OLD.name IS NOT NEW.name BEGIN
      ${invalidateReview(`identityKey IN (${indexes.map((index) => `SELECT identityKey FROM ${index}
        WHERE contactId = NEW.id AND identityKey >= 'email:'`).join(" UNION ALL ")})`)}
    END;`);
  for (const index of indexes) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${index}_duplicate_insert AFTER INSERT ON ${index}
      WHEN NEW.identityKey >= 'email:' BEGIN
        ${addGroup("NEW.identityKey")};
        ${invalidateReview("identityKey = NEW.identityKey")}
      END;
      CREATE TRIGGER IF NOT EXISTS ${index}_duplicate_delete AFTER DELETE ON ${index}
      WHEN OLD.identityKey >= 'email:' BEGIN
        ${invalidateReview("identityKey = OLD.identityKey")}
        DELETE FROM contact_duplicate_groups WHERE identityKey = OLD.identityKey AND NOT ${hasPair("OLD.identityKey")};
      END;`);
  }
}

function prepareGroups(db: Store) {
  indexPendingContactOutreach(db);
  indexPendingRealtorReplies(db);
  const checkpoint = String(db.prepare("SELECT value FROM settings WHERE key = ?").get(migration)?.value ?? "");
  if (checkpoint !== "done") {
    // Walk existing indexed keys a page at a time. The triggers handle new and changed keys on either side of this cursor.
    const batches = indexes.map((index) => `SELECT identityKey FROM (
      SELECT DISTINCT identityKey FROM ${index} WHERE identityKey >= 'email:' AND identityKey > ?
      ORDER BY identityKey LIMIT ${migrationSize + 1})`);
    const keys = db.prepare(`${batches.join(" UNION ")} ORDER BY identityKey LIMIT ${migrationSize + 1}`).all(checkpoint, checkpoint);
    const insert = db.prepare(`WITH candidate(key) AS (VALUES (?)) ${addGroup("(SELECT key FROM candidate)")}`);
    for (const { identityKey } of keys.slice(0, migrationSize)) insert.run(identityKey);
    const next = keys.length > migrationSize ? keys[migrationSize - 1].identityKey : "done";
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(migration, next);
    if (next !== "done") return false;
  }
  return !db.prepare("SELECT 1 FROM contact_outreach_pending UNION ALL SELECT 1 FROM realtor_reply_pending LIMIT 1").get();
}

function groupContacts(db: Store, key: string, after: string, limit: number): Contact[] {
  const batches = indexes.map((index) => `SELECT contactId FROM (
    SELECT contactId FROM ${index} WHERE identityKey = ? AND contactId > ? ORDER BY contactId LIMIT ?)`);
  const contacts = db.prepare(`WITH matched AS (${batches.join(" UNION ALL ")} ORDER BY contactId LIMIT ?)
    SELECT contact.id, name, email, phone, role, addedBy FROM matched JOIN contacts contact ON contact.id = matched.contactId
    ORDER BY contact.id`).all(key, after, limit, key, after, limit, limit) as unknown as Contact[];
  return contacts.map((contact) => ({ ...contact }));
}

export function readDuplicateGroups(db: Store, after = ""): DuplicateGroups | DuplicateScan {
  if (!prepareGroups(db)) return { kind: "duplicateScan" };
  const keys = db.prepare(`SELECT identityKey FROM contact_duplicate_groups WHERE reviewId IS NULL AND identityKey > ?
    ORDER BY identityKey LIMIT ?`)
    .all(after, pageSize + 1).map(({ identityKey }) => String(identityKey));
  const rows = keys.slice(0, pageSize).map((key) => {
    const contacts = groupContacts(db, key, "", 3);
    return { key, names: contacts.slice(0, 2).map(({ name }) => name), more: contacts.length > 2 };
  });
  return { kind: "duplicateGroups", rows, next: keys.length > pageSize ? keys[pageSize - 1] : null };
}

export function readDuplicateMembers(db: Store, key: string, after = ""): DuplicateMembers | DuplicateScan {
  if (!prepareGroups(db)) return { kind: "duplicateScan" };
  const group = db.prepare("SELECT revision, reviewId FROM contact_duplicate_groups WHERE identityKey = ?").get(key);
  const contacts = groupContacts(db, key, after, pageSize + 1);
  return { kind: "duplicateMembers", contacts: contacts.slice(0, pageSize), revision: group ? String(group.revision) : null,
    reviewed: Boolean(group?.reviewId),
    next: contacts.length > pageSize ? contacts[pageSize - 1].id : null };
}

export function readDuplicateHistory(db: Store, after?: ContactMergeCursor): DuplicateHistory | DuplicateScan {
  if (!prepareGroups(db)) return { kind: "duplicateScan" };
  const rows = db.prepare(`SELECT operationId AS reviewId, identityKey AS key, actor, at, reason, names, more, reopenedAt, reopenedBy
    FROM contact_duplicate_reviews ${after ? "WHERE (at, operationId) < (?, ?)" : ""}
    ORDER BY at DESC, operationId DESC LIMIT ?`).all(...(after ? [after.at, after.mergeId] : []), pageSize + 1);
  const page = rows.slice(0, pageSize).map((row) => ({ ...row, names: JSON.parse(String(row.names)) as string[],
    more: Boolean(row.more) })) as unknown as DuplicateHistory["rows"];
  const last = page.at(-1);
  return { kind: "duplicateHistory", rows: page,
    next: rows.length > pageSize && last ? { at: last.at, mergeId: last.reviewId } : null };
}

type Decision = Extract<z.infer<typeof contactMergeInput>, { type: "keepDuplicatesSeparate" | "reopenDuplicates" }>;

export function writeDuplicateDecision(db: Store, request: Decision, staff: WorkspaceStaff, now: string): ContactMergeResult {
  if (request.type === "reopenDuplicates") {
    const receipt = db.prepare("SELECT reopenedAt, reopenedBy FROM contact_duplicate_reviews WHERE operationId = ?").get(request.reviewId);
    if (!receipt || (receipt.reopenedAt && receipt.reopenedBy !== staff.email)) return { error: "This match already returned to review. Refresh the queue." };
    if (!receipt.reopenedAt) {
      db.prepare("UPDATE contact_duplicate_reviews SET reopenedAt = ?, reopenedBy = ? WHERE operationId = ?")
        .run(now, staff.email, request.reviewId);
      db.prepare(`UPDATE contact_duplicate_groups SET reviewId = NULL, revision = ${newRevision} WHERE reviewId = ?`).run(request.reviewId);
      accessEvent(db, staff, "Reopened duplicate review", request.reviewId, now);
    }
    return { kind: "duplicateReopened" };
  }

  const { key, revision, reason, operationId } = request;
  const prior = db.prepare("SELECT identityKey, revision, actor, reason FROM contact_duplicate_reviews WHERE operationId = ?").get(operationId);
  if (prior) return prior.identityKey === key && prior.revision === revision && prior.actor === staff.email && prior.reason === reason ?
    { kind: "duplicateReviewed" } : { error: "This duplicate review request was already used." };
  if (!prepareGroups(db)) return { error: "More contacts are being indexed. Refresh matches before recording a decision." };
  const group = db.prepare("SELECT revision, reviewId FROM contact_duplicate_groups WHERE identityKey = ?").get(key);
  if (!group || group.revision !== revision || group.reviewId) return { error: "This match changed. Refresh matches and review the current records." };
  const contacts = groupContacts(db, key, "", 4);
  db.prepare(`INSERT INTO contact_duplicate_reviews (operationId, identityKey, revision, actor, at, reason, names, more)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(operationId, key, revision, staff.email, now, reason,
    JSON.stringify(contacts.slice(0, 3).map(({ name }) => name)), contacts.length > 3 ? 1 : 0);
  db.prepare("UPDATE contact_duplicate_groups SET reviewId = ? WHERE identityKey = ?").run(operationId, key);
  accessEvent(db, staff, "Kept duplicate contacts separate", operationId, now);
  return { kind: "duplicateReviewed" };
}

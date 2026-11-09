import type { Store } from "./store";

const phoneDigits = (field: string) => ["+", "(", ")", "-", " ", "."].reduce((value, character) => `replace(${value}, '${character}', '')`, field);
const words = (...fields: string[]) => fields.map((field) => `coalesce(${field}, '')`).join(" || ' ' || ");
const searchableContact = (row: string) => {
  const digits = phoneDigits(`${row}.phone`);
  return words(`${row}.name`, `${row}.email`, `${row}.phone`, digits,
    `CASE WHEN length(${digits}) = 11 AND substr(${digits}, 1, 1) = '1' THEN substr(${digits}, 2) END`);
};
const personName = (field: string) => `(SELECT name FROM contacts WHERE id = ${field})`;
const sources = {
  contact: { table: "contacts", columns: ["name", "email", "phone", "role"], body: `${searchableContact("source")} || ' ' || source.role` },
  loan: { table: "loans", columns: ["contactId", "address", "purpose"],
    body: words(personName("source.contactId"), "source.address", "source.purpose", "source.id") },
  lead: { table: "referral_leads", columns: ["name", "email", "phone", "purpose", "zip"], body: words(searchableContact("source"), "source.purpose", "source.zip") },
  submission: { table: "submissions", columns: ["lender", "externalId"], body: words("source.lender", "source.externalId") },
  task: { table: "tasks", columns: ["title"], body: "source.title" },
  document: { table: "document_requests", columns: ["kind", "status"], body: words("source.kind", "source.status") },
  conversation: { table: "loan_conversations", columns: ["contactId", "audience", "status"],
    body: words(personName("source.contactId"), "source.audience", "source.status") },
  leadConversation: { table: "lead_conversations", columns: ["leadId", "status"],
    body: words("(SELECT name || ' ' || purpose FROM referral_leads WHERE id = source.leadId)", "source.status") },
  contactConversation: { table: "contact_conversations", columns: ["contactId", "status"],
    body: words("(SELECT name || ' ' || role FROM contacts WHERE id = source.contactId)", "source.status") },
} as const;
type Source = keyof typeof sources;
const sourceKinds = Object.keys(sources) as Source[];
const dirtyBatch = 250;
const historyBatch = 200;

function initializeSearchIndex(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_search_catalog (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, recordId TEXT NOT NULL, UNIQUE(kind, recordId)
  );
  CREATE TABLE IF NOT EXISTS workspace_search_dirty (kind TEXT NOT NULL, recordId TEXT NOT NULL, PRIMARY KEY(kind, recordId));
  CREATE TABLE IF NOT EXISTS workspace_search_backfill (kind TEXT PRIMARY KEY, afterId TEXT NOT NULL DEFAULT '', complete INTEGER NOT NULL DEFAULT 0);
  CREATE VIRTUAL TABLE IF NOT EXISTS workspace_search_fts USING fts5(kind, body, tokenize='unicode61 remove_diacritics 2', prefix='2 3');
  CREATE TRIGGER IF NOT EXISTS workspace_search_contact_links AFTER UPDATE OF name ON contacts WHEN OLD.name IS NOT NEW.name BEGIN
    INSERT OR IGNORE INTO workspace_search_dirty SELECT 'loan', id FROM loans WHERE contactId = NEW.id;
    INSERT OR IGNORE INTO workspace_search_dirty SELECT 'conversation', id FROM loan_conversations WHERE contactId = NEW.id;
  END;
  CREATE TRIGGER IF NOT EXISTS workspace_search_lead_conversation_links AFTER UPDATE OF name, purpose ON referral_leads
  WHEN OLD.name IS NOT NEW.name OR OLD.purpose IS NOT NEW.purpose BEGIN
    INSERT OR IGNORE INTO workspace_search_dirty SELECT 'leadConversation', id FROM lead_conversations WHERE leadId = NEW.id;
  END;
  CREATE TRIGGER IF NOT EXISTS workspace_search_contact_conversation_links AFTER UPDATE OF name, role ON contacts
  WHEN OLD.name IS NOT NEW.name OR OLD.role IS NOT NEW.role BEGIN
    INSERT OR IGNORE INTO workspace_search_dirty SELECT 'contactConversation', id FROM contact_conversations WHERE contactId = NEW.id;
  END;`);
  for (const kind of sourceKinds) {
    const { table, columns } = sources[kind];
    const mark = (row: string) => `INSERT OR IGNORE INTO workspace_search_dirty VALUES ('${kind}', ${row}.id);`;
    db.exec(`CREATE TRIGGER IF NOT EXISTS workspace_search_${kind}_insert AFTER INSERT ON ${table} BEGIN ${mark("NEW")} END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_${kind}_delete AFTER DELETE ON ${table} BEGIN ${mark("OLD")} END;
      CREATE TRIGGER IF NOT EXISTS workspace_search_${kind}_update AFTER UPDATE OF ${columns.join(", ")} ON ${table}
      WHEN ${columns.map((column) => `OLD.${column} IS NOT NEW.${column}`).join(" OR ")} BEGIN ${mark("NEW")} END;
      INSERT OR IGNORE INTO workspace_search_backfill (kind) VALUES ('${kind}');`);
  }
}

function indexRows(db: Store, kind: Source, recordIds: string[], dirty: boolean) {
  if (!recordIds.length) return;
  const { table, body } = sources[kind];
  const ids = JSON.stringify(recordIds);
  const selected = "kind = ? AND recordId IN (SELECT value FROM json_each(?))";
  if (dirty) {
    db.prepare(`DELETE FROM workspace_search_fts WHERE rowid IN (SELECT id FROM workspace_search_catalog WHERE ${selected})`).run(kind, ids);
    db.prepare(`DELETE FROM workspace_search_catalog WHERE ${selected}`).run(kind, ids);
  }
  db.prepare(`INSERT INTO workspace_search_catalog (kind, recordId)
    SELECT ?, source.id FROM json_each(?) requested JOIN ${table} source ON source.id = requested.value`).run(kind, ids);
  db.prepare(`INSERT INTO workspace_search_fts (rowid, kind, body)
    SELECT catalog.id, catalog.kind, ${body} FROM workspace_search_catalog catalog
    JOIN ${table} source ON source.id = catalog.recordId WHERE catalog.${selected}`).run(kind, ids);
  if (dirty) db.prepare(`DELETE FROM workspace_search_dirty WHERE ${selected}`).run(kind, ids);
}

export function refreshSearchIndex(db: Store) {
  const schema = new Set(db.prepare(`SELECT name FROM sqlite_schema WHERE name IN
    ('workspace_search_fts', 'workspace_search_contact_followups', 'workspace_search_contact_conversation_links')`)
    .all().map((row) => row.name));
  const initialized = schema.has("workspace_search_fts") && schema.has("workspace_search_contact_conversation_links");
  const accessReady = schema.has("workspace_search_contact_followups");
  if (initialized && accessReady && !searchIndexPending(db)) return false;
  return db.transaction(() => {
    if (!initialized) initializeSearchIndex(db);
    if (!accessReady) db.exec(`CREATE INDEX IF NOT EXISTS workspace_search_loans_by_contact_owner ON loans(contactId, officerEmail);
      CREATE INDEX IF NOT EXISTS workspace_search_loans_by_partner_owner ON loans(partnerId, officerEmail) WHERE partnerId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS workspace_search_contact_followups ON contact_activity(contactId, followUpOwnerEmail) WHERE dueAt IS NOT NULL;`);
    const dirty = db.prepare("SELECT kind, recordId FROM workspace_search_dirty ORDER BY kind, recordId LIMIT ?").all(dirtyBatch);
    for (const kind of sourceKinds) indexRows(db, kind, dirty.filter((row) => row.kind === kind).map((row) => String(row.recordId)), true);

    for (const kind of sourceKinds) {
      const checkpoint = db.prepare("SELECT afterId FROM workspace_search_backfill WHERE kind = ? AND complete = 0").get(kind);
      if (!checkpoint) continue;
      const { table } = sources[kind];
      const rows = db.prepare(`SELECT source.id,
        EXISTS(SELECT 1 FROM workspace_search_catalog entry WHERE entry.kind = ? AND entry.recordId = source.id) AS indexed,
        EXISTS(SELECT 1 FROM workspace_search_dirty dirty WHERE dirty.kind = ? AND dirty.recordId = source.id) AS dirty
        FROM ${table} source WHERE source.id > ? ORDER BY source.id LIMIT ?`).all(kind, kind, checkpoint.afterId, historyBatch);
      indexRows(db, kind, rows.filter((row) => !row.indexed && !row.dirty).map((row) => String(row.id)), false);
      db.prepare("UPDATE workspace_search_backfill SET afterId = ?, complete = ? WHERE kind = ?")
        .run(rows.at(-1)?.id ?? checkpoint.afterId, Number(rows.length < historyBatch), kind);
    }
    return searchIndexPending(db);
  });
}

function searchIndexPending(db: Store) {
  return !!db.prepare(`SELECT 1 FROM workspace_search_backfill WHERE complete = 0
    UNION ALL SELECT 1 FROM workspace_search_dirty LIMIT 1`).get();
}

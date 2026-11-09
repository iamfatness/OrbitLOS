import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
      return next(`${specifier}.ts`, context);
    }
  },
});

const { executeCommand } = await import("../src/lib/commands.ts");
const { initializeStore } = await import("../src/lib/store.ts");
const { readLeadArchive } = await import("../src/lib/lead-inbox.ts");

test("archive restoration preserves identity and opt-out, and stale actions cannot reverse newer work", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    exec: (query) => sqlite.exec(query),
    prepare: (query) => sqlite.prepare(query),
    transaction(run) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = run();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  initializeStore(db, false);
  const brokerage = { id: crypto.randomUUID(), role: "LO", pilot: true, name: "Fictional team" };
  const officer = { name: "Demo Officer", email: "officer@example.test", brokerage };
  const other = { ...officer, email: "other@example.test" };
  const leadId = crypto.randomUUID();
  const legacyId = crypto.randomUUID();
  const deletedConversionId = crypto.randomUUID();
  const at = "2026-11-08T17:00:00.000Z";
  const insert = db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer,
    officerEmail, createdAt, dueAt, resolvedAt) VALUES (?, ?, ?, ?, ?, 'Purchase', ?, ?, ?, ?, ?)`);
  insert.run(leadId, leadId, "Active fictional lead", "active@example.test", "2485550100", officer.name, officer.email, at, at, null);
  insert.run(legacyId, legacyId, "Legacy dismissed", "legacy@example.test", "2485550101", officer.name, officer.email, at, at, at);
  insert.run(deletedConversionId, deletedConversionId, "Previously converted", "converted@example.test", "2485550102", officer.name, officer.email, at, at, at);
  const audit = db.prepare("INSERT INTO workspace_access_history VALUES (?, ?, ?, ?, ?)");
  audit.run(crypto.randomUUID(), officer.email, "Dismissed quote request", legacyId, at);
  audit.run(crypto.randomUUID(), officer.email, "Converted quote request", deletedConversionId, at);
  db.exec("DROP INDEX leads_by_archive_time; ALTER TABLE referral_leads DROP COLUMN archiveToken");
  initializeStore(db, false);
  assert.deepEqual(readLeadArchive(db, officer, { query: "" }).leads.map(({ id }) => id), [legacyId]);
  const log = await executeCommand(db, { type: "leadContact", leadId, revision: 0, channel: "Call",
    outcome: "Left message", note: "Original conversation" }, officer);
  assert.ok(log.state, log.error);
  assert.ok((await executeCommand(db, { type: "leadOptOut", leadId }, officer)).state);
  const archive = { type: "dismissReferral", referralId: leadId, revision: log.state.inboxLeads[0].followUp.revision };
  const archived = await executeCommand(db, archive, officer);
  assert.ok(archived.state, archived.error);
  assert.equal(archived.state.inboxLeads.length, 0);
  assert.equal(readLeadArchive(db, other, { query: "" }).leads.length, 0);
  const [record] = readLeadArchive(db, officer, { query: "active@example.test" }).leads;
  assert.equal(record.id, leadId);
  const restore = { type: "restoreLead", leadId, archiveToken: record.archiveToken };
  assert.ok((await executeCommand(db, restore, other)).error);
  const restored = await executeCommand(db, restore, officer);
  assert.ok(restored.state, restored.error);
  const [lead] = restored.state.inboxLeads;
  assert.equal(lead.officerEmail, officer.email);
  assert.equal(lead.source, "Website quote request");
  assert.equal(lead.dueAt, at);
  assert.equal(lead.outreachSuppressed, true);
  assert.ok(lead.followUp.events.some(({ text }) => text.includes("Original conversation")));
  assert.ok((await executeCommand(db, archive, officer)).error);
  assert.ok((await executeCommand(db, { ...archive, revision: lead.followUp.revision }, officer)).state);
  assert.ok((await executeCommand(db, restore, officer)).error);
});

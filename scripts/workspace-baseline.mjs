import { gzipSync } from "node:zlib";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

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

const { initializeStore, readWorkspace } = await import("../src/lib/store.ts");
const { scopeWorkspace } = await import("../src/lib/workspace-access.ts");

export const profiles = {
  small: { contacts: 5_000, loans: 500, history: 10_000 },
  heavy: { contacts: 100_000, loans: 10_000, history: 250_000 },
};

export function sqliteStore(sqlite) {
  return {
    exec: (query) => sqlite.exec(query),
    prepare: (query) => sqlite.prepare(query),
    transaction(run) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const value = run();
        sqlite.exec("COMMIT");
        return value;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export function seedFictionalWorkspace(db, profile, officerEmail, backupEmail) {
  const sequence = `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)`;
  db.transaction(() => {
    db.prepare(`${sequence} INSERT INTO contacts (id, name, email, phone, role, addedBy)
      SELECT printf('contact-%06d', n), printf('Fictional contact %06d', n), printf('contact-%06d@example.test', n), '',
        'Borrower', CASE WHEN n % 2 = 0 THEN ? ELSE ? END FROM seq`).run(profile.contacts, officerEmail, backupEmail);
    db.prepare(`${sequence} INSERT INTO loans (id, contactId, officer, officerEmail, address, amount, purpose, stage, stageSince, createdAt, leadSource)
      SELECT printf('loan-%06d', n), printf('contact-%06d', n), CASE WHEN n % 2 = 0 THEN 'Sample officer' ELSE 'Sample backup' END,
        CASE WHEN n % 2 = 0 THEN ? ELSE ? END, printf('%d Fictional Way', n), 230000 + (n % 100) * 1000,
        CASE WHEN n % 5 = 0 THEN 'Refinance' ELSE 'Purchase' END,
        CASE n % 5 WHEN 0 THEN 'Funded' WHEN 1 THEN 'Closed' WHEN 2 THEN 'Lead' WHEN 3 THEN 'Processing' ELSE 'Application' END,
        '2026-11-01T12:00:00.000Z', '2026-10-01T12:00:00.000Z', 'Direct' FROM seq`).run(profile.loans, officerEmail, backupEmail);
    db.prepare(`${sequence} INSERT INTO activity (id, loanId, kind, outcome, text, createdAt)
      SELECT printf('loan-event-%06d', n), printf('loan-%06d', (n - 1) % ? + 1), CASE WHEN n % 3 = 0 THEN 'Note' ELSE 'Call' END,
        CASE WHEN n % 3 = 0 THEN NULL ELSE 'Connected' END,
        printf('Fictional loan interaction %06d. Discussed timing, documents, and the next action for the borrower.', n),
        strftime('%Y-%m-%dT%H:%M:%fZ', '2026-10-02', '+' || n || ' seconds') FROM seq`).run(profile.history * 0.6, profile.loans);
    db.prepare(`${sequence} INSERT INTO contact_activity (id, contactId, officer, officerEmail, kind, outcome, text, createdAt,
      dueAt, followUpOwner, followUpOwnerEmail)
      SELECT printf('contact-event-%06d', n), printf('contact-%06d', (n - 1) % ? + 1),
        CASE WHEN n % 2 = 0 THEN 'Sample officer' ELSE 'Sample backup' END, CASE WHEN n % 2 = 0 THEN ? ELSE ? END,
        'Call', 'Connected', printf('Fictional contact interaction %06d. Discussed a planned move and future contact preferences.', n),
        strftime('%Y-%m-%dT%H:%M:%fZ', '2026-10-03', '+' || n || ' seconds'), CASE WHEN n % 101 = 0 THEN '2026-11-09T12:00:00.000Z' END,
        CASE WHEN n % 101 = 0 THEN CASE WHEN n % 2 = 0 THEN 'Sample officer' ELSE 'Sample backup' END END,
        CASE WHEN n % 101 = 0 THEN CASE WHEN n % 2 = 0 THEN ? ELSE ? END END FROM seq`)
      .run(profile.history * 0.4, profile.contacts, officerEmail, backupEmail, officerEmail, backupEmail);
    db.prepare(`${sequence} INSERT INTO tasks (id, loanId, title, dueAt, completedAt)
      SELECT printf('task-%06d', n), printf('loan-%06d', n), 'Follow up with borrower', '2026-11-09T12:00:00.000Z',
        CASE WHEN n % 3 = 0 THEN '2026-11-08T12:00:00.000Z' END FROM seq`).run(profile.loans / 5);
  });
}

function measure(profile, role, samples) {
  const sqlite = new DatabaseSync(":memory:");
  const db = sqliteStore(sqlite);
  try {
    initializeStore(db, false);
    const staff = { name: "Sample officer", email: "officer@example.test", brokerage: { id: "fixture", name: "Fictional brokerage", role, pilot: true } };
    seedFictionalWorkspace(db, profile, staff.email, "backup@example.test");
    const rounds = [];
    let state;
    let payload;
    for (let sample = 0; sample < samples; sample++) {
      const start = performance.now();
      const fullState = readWorkspace(db, role === "Admin");
      const read = performance.now();
      state = scopeWorkspace(fullState, staff);
      const scoped = performance.now();
      payload = JSON.stringify(state);
      const end = performance.now();
      rounds.push({ readMs: Math.round(read - start), scopeMs: Math.round(scoped - read), serializeMs: Math.round(end - scoped), totalMs: Math.round(end - start) });
    }
    const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
    const totals = rounds.map((round) => round.totalMs).sort((a, b) => a - b);
    return {
      role, profile, samples, rounds, medianMs: totals[Math.ceil(samples / 2) - 1],
      payloadBytes: Buffer.byteLength(payload), gzipBytes: gzipSync(payload).length,
      loanActivitySummaryBytes: bytes(state.loans.map(({ lastActivityAt, lastOutreachAt }) => ({ lastActivityAt, lastOutreachAt }))),
      contactFollowUpBytes: bytes(state.contactActivity),
      visibleContacts: state.contacts.length, visibleLoans: state.loans.length,
      visibleContactFollowUps: state.contactActivity.length,
    };
  } finally {
    sqlite.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , profile = "small", role = "Admin", count = "1"] = process.argv;
  const samples = Number(count);
  if (!Object.hasOwn(profiles, profile) || !["Admin", "LO"].includes(role) || !Number.isInteger(samples) || samples < 1 || samples > 20) {
    throw new Error("Usage: node scripts/workspace-baseline.mjs small|heavy Admin|LO [samples from 1 to 20]");
  }
  console.log(JSON.stringify(measure(profiles[profile], role, samples), null, 2));
}

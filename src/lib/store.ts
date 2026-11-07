import type { Activity, CommunicationDraft, Contact, Loan, LoanTask, Submission, Workspace } from "./model";
import { demoRecords } from "./seed";
import { staffApplications } from "./applications";
import { createApplicationFollowUps } from "./tasks";
import type { PricingRun } from "./pricing-model";

export type SqlValue = string | number | null;

export interface Store {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...args: SqlValue[]): Record<string, SqlValue> | undefined;
    all(...args: SqlValue[]): Record<string, SqlValue>[];
    run(...args: SqlValue[]): void;
  };
  transaction<T>(run: () => T): T;
}

export function initializeStore(db: Store) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, role TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY, contactId TEXT NOT NULL REFERENCES contacts(id),
      partnerId TEXT REFERENCES contacts(id), officer TEXT NOT NULL, address TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount >= 0), purpose TEXT NOT NULL,
      stage TEXT NOT NULL, stageSince TEXT NOT NULL, officerEmail TEXT
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      lender TEXT COLLATE NOCASE NOT NULL, externalId TEXT NOT NULL, status TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '[]', syncedAt TEXT,
      UNIQUE(lender, externalId)
    );
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      text TEXT NOT NULL, createdAt TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'Note'
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS applications (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE, expiresAt TEXT NOT NULL, draft TEXT NOT NULL,
      step INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL, submittedAt TEXT, reviewedAt TEXT, uwmReference TEXT
    );
    CREATE TABLE IF NOT EXISTS application_address_quota (
      loanId TEXT PRIMARY KEY REFERENCES applications(loanId) ON DELETE CASCADE,
      window INTEGER NOT NULL, requests INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS application_lender_details (
      loanId TEXT PRIMARY KEY REFERENCES applications(loanId) ON DELETE CASCADE,
      details TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      title TEXT NOT NULL, dueAt TEXT NOT NULL, completedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS communication_drafts (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      audience TEXT NOT NULL, milestone TEXT NOT NULL, createdAt TEXT NOT NULL,
      emailCopiedAt TEXT, textCopiedAt TEXT,
      UNIQUE (loanId, contactId, audience, milestone)
    );
    CREATE TABLE IF NOT EXISTS pricing_runs (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, mode TEXT NOT NULL, reference TEXT, scenario TEXT NOT NULL,
      offers TEXT NOT NULL, notices TEXT NOT NULL, quotedAt TEXT NOT NULL, selectedId TEXT, selectedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS pricing_by_loan ON pricing_runs(loanId, quotedAt);
    CREATE TABLE IF NOT EXISTS staff_google_attempts (
      state TEXT PRIMARY KEY, browserHash TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expiresAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_sessions (
      tokenHash TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, expiresAt INTEGER NOT NULL
    );
  `);
  db.transaction(() => {
    if (!db.prepare("PRAGMA table_info(activity)").all().some((column) => column.name === "kind")) {
      db.exec("ALTER TABLE activity ADD COLUMN kind TEXT NOT NULL DEFAULT 'Note'");
    }
    if (!db.prepare("PRAGMA table_info(loans)").all().some((column) => column.name === "officerEmail")) {
      db.exec("ALTER TABLE loans ADD COLUMN officerEmail TEXT");
    }
    createApplicationFollowUps(db);
    if (db.prepare("SELECT 1 FROM settings WHERE key = 'seeded'").get()) return;
    const demo = demoRecords();
    for (const contact of demo.contacts) insertContact(db, contact);
    for (const loan of demo.loans) insertLoan(db, loan);
    for (const submission of demo.submissions) insertSubmission(db, submission);
    db.exec("INSERT INTO settings VALUES ('seeded', '1')");
  });
}

export function insertContact(db: Store, contact: Contact) {
  db.prepare("INSERT INTO contacts (id, name, email, phone, role) VALUES (?, ?, ?, ?, ?)")
    .run(contact.id, contact.name, contact.email, contact.phone, contact.role);
}

export function insertLoan(db: Store, loan: Loan) {
  db.prepare("INSERT INTO loans (id, contactId, partnerId, officer, address, amount, purpose, stage, stageSince, officerEmail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(loan.id, loan.contactId, loan.partnerId, loan.officer, loan.address, loan.amount, loan.purpose, loan.stage, loan.stageSince, loan.officerEmail);
}

export function insertSubmission(db: Store, submission: Submission) {
  db.prepare("INSERT INTO submissions (id, loanId, lender, externalId, status, conditions, syncedAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(submission.id, submission.loanId, submission.lender, submission.externalId, submission.status, JSON.stringify(submission.conditions), submission.syncedAt);
}

function rows<T>(db: Store, query: string) {
  // Both stores are owned by the schema above. Copy rows into plain objects for React and Workers RPC.
  return db.prepare(query).all().map((row) => ({ ...row }) as T);
}

export function workspace(db: Store): Workspace {
  return {
    contacts: rows<Contact>(db, "SELECT * FROM contacts ORDER BY name COLLATE NOCASE"),
    loans: rows<Loan>(db, "SELECT * FROM loans ORDER BY stageSince DESC, id"),
    submissions: rows<Omit<Submission, "conditions"> & { conditions: string }>(db, "SELECT * FROM submissions ORDER BY lender, id")
      .map((row) => ({ ...row, conditions: JSON.parse(row.conditions) })),
    activity: rows<Activity>(db, "SELECT * FROM activity ORDER BY createdAt DESC, id"),
    tasks: rows<LoanTask>(db, "SELECT * FROM tasks ORDER BY completedAt IS NOT NULL, dueAt, id"),
    communicationDrafts: rows<CommunicationDraft>(db, "SELECT * FROM communication_drafts ORDER BY createdAt DESC, rowid DESC"),
    applications: staffApplications(db),
    pricingRuns: rows<Omit<PricingRun, "scenario" | "offers" | "notices"> & { scenario: string; offers: string; notices: string }>(db, `
      SELECT run.* FROM pricing_runs run
      WHERE run.id = (SELECT latest.id FROM pricing_runs latest WHERE latest.loanId = run.loanId ORDER BY latest.quotedAt DESC, latest.rowid DESC LIMIT 1)
         OR run.id = (SELECT chosen.id FROM pricing_runs chosen WHERE chosen.loanId = run.loanId AND chosen.selectedId IS NOT NULL ORDER BY chosen.selectedAt DESC, chosen.rowid DESC LIMIT 1)
      ORDER BY run.quotedAt DESC, run.rowid DESC
    `).map((run) => ({ ...run, scenario: JSON.parse(run.scenario), offers: JSON.parse(run.offers), notices: JSON.parse(run.notices) })),
    uwmSyncedAt: (db.prepare("SELECT value FROM settings WHERE key = 'uwmSyncedAt'").get()?.value as string | undefined) ?? null,
  };
}

import type { Activity, Contact, Loan, Submission, Workspace } from "./model";
import { demoRecords } from "./seed";

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
      stage TEXT NOT NULL, stageSince TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      lender TEXT COLLATE NOCASE NOT NULL, externalId TEXT NOT NULL, status TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '[]', syncedAt TEXT,
      UNIQUE(lender, externalId)
    );
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      text TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.transaction(() => {
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
  db.prepare("INSERT INTO loans (id, contactId, partnerId, officer, address, amount, purpose, stage, stageSince) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(loan.id, loan.contactId, loan.partnerId, loan.officer, loan.address, loan.amount, loan.purpose, loan.stage, loan.stageSince);
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
    uwmSyncedAt: (db.prepare("SELECT value FROM settings WHERE key = 'uwmSyncedAt'").get()?.value as string | undefined) ?? null,
  };
}

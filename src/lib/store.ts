import type { Activity, ClosingItem, ClosingPlan, CommunicationDraft, Contact, Loan, LoanTask, PastClientProfile, ReferralLead, RealtorPortal, Submission, Workspace } from "./model";
import { demoRecords } from "./seed";
import { staffApplications } from "./applications";
import { createApplicationFollowUps } from "./tasks";
import type { MockUwmRate, PricingRun, PublishedQuote } from "./pricing-model";
import type { LoanDocumentRequest } from "./document-model";
import { pdfColumns } from "./document-files-model";
import { synchronizeRetentionTasks } from "./client-retention";
import { referralMatches } from "./referral-matches";

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

const documentRequestColumns = `
  id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, instructions TEXT NOT NULL, requestedAt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Received', 'Accepted', 'Needs replacement')),
  replacementNote TEXT NOT NULL DEFAULT '', submittedAt TEXT, revision INTEGER NOT NULL DEFAULT 0,
  submissionId TEXT REFERENCES submissions(id) ON DELETE CASCADE, conditionId TEXT,
  CHECK ((submissionId IS NULL) = (conditionId IS NULL)),
  UNIQUE (submissionId, conditionId)
`;

export function initializeStore(db: Store, seedDemo = true) {
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
    CREATE TABLE IF NOT EXISTS workspace_access_history (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL, createdAt TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS document_requests (${documentRequestColumns});
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
    CREATE TABLE IF NOT EXISTS past_client_profiles (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
      closingDate TEXT, currentRate REAL, targetRate REAL, observedRate REAL, checkedAt TEXT,
      watchEnabled INTEGER NOT NULL DEFAULT 0, rateTriggered INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS closing_plans (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE, targetDate TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS closing_items (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      title TEXT NOT NULL, owner TEXT NOT NULL, dueDate TEXT NOT NULL, completedAt TEXT, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS closing_items_by_loan ON closing_items(loanId, dueDate);
    CREATE TABLE IF NOT EXISTS realtor_portals (
      realtorId TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE, expiresAt TEXT NOT NULL, officerEmail TEXT, officer TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS referral_leads (
      id TEXT PRIMARY KEY, requestId TEXT NOT NULL, realtorId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, purpose TEXT NOT NULL,
      officer TEXT NOT NULL, officerEmail TEXT, createdAt TEXT NOT NULL, dueAt TEXT NOT NULL,
      resolvedAt TEXT, loanId TEXT UNIQUE REFERENCES loans(id) ON DELETE SET NULL, UNIQUE (realtorId, requestId)
    );
    CREATE INDEX IF NOT EXISTS referral_leads_by_realtor ON referral_leads(realtorId, createdAt);
    CREATE TABLE IF NOT EXISTS pricing_runs (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, mode TEXT NOT NULL, reference TEXT, scenario TEXT NOT NULL,
      offers TEXT NOT NULL, notices TEXT NOT NULL, quotedAt TEXT NOT NULL, selectedId TEXT, selectedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS pricing_by_loan ON pricing_runs(loanId, quotedAt);
    CREATE TABLE IF NOT EXISTS published_quotes (
      loanId TEXT PRIMARY KEY REFERENCES applications(loanId) ON DELETE CASCADE,
      runId TEXT NOT NULL, offerId TEXT NOT NULL, product TEXT NOT NULL,
      rate REAL NOT NULL, principalAndInterest REAL NOT NULL, quotedAt TEXT NOT NULL, publishedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mock_uwm_rates (
      loanId TEXT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE,
      submissionId TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      loanNumber TEXT NOT NULL, runId TEXT NOT NULL, offerId TEXT NOT NULL,
      product TEXT NOT NULL, rate REAL NOT NULL, quotedAt TEXT NOT NULL,
      floatReference TEXT NOT NULL UNIQUE, floatedAt TEXT NOT NULL,
      lockReference TEXT UNIQUE, lockedAt TEXT, lockDays INTEGER, lockExpiresAt TEXT
    );
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
    const portalColumns = db.prepare("PRAGMA table_info(realtor_portals)").all();
    if (!portalColumns.some((column) => column.name === "officerEmail")) {
      db.exec("ALTER TABLE realtor_portals ADD COLUMN officerEmail TEXT; ALTER TABLE realtor_portals ADD COLUMN officer TEXT NOT NULL DEFAULT '';");
    }
    if (!db.prepare("PRAGMA table_info(applications)").all().some((column) => column.name === "revokedAt")) {
      db.exec("ALTER TABLE applications ADD COLUMN revokedAt TEXT");
    }
    if (!db.prepare("PRAGMA table_info(document_requests)").all().some((column) => column.name === "conditionId")) {
      // Preserve the original checklist while allowing each condition its own request.
      const columns = "id, loanId, kind, instructions, requestedAt, status, replacementNote, submittedAt, revision";
      db.exec(`
        CREATE TABLE document_requests_next (${documentRequestColumns});
        INSERT INTO document_requests_next (${columns}) SELECT ${columns} FROM document_requests;
        DROP TABLE document_requests;
        ALTER TABLE document_requests_next RENAME TO document_requests;
      `);
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS manual_document_by_loan_kind ON document_requests(loanId, kind) WHERE conditionId IS NULL");
    db.exec("CREATE INDEX IF NOT EXISTS document_requests_by_loan ON document_requests(loanId, requestedAt, id)");
    db.exec(`CREATE TABLE IF NOT EXISTS uwm_document_deliveries (
      requestId TEXT PRIMARY KEY REFERENCES document_requests(id) ON DELETE CASCADE,
      receipt TEXT NOT NULL UNIQUE, sentAt TEXT NOT NULL, mockClearedAt TEXT
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS borrower_upload_access (
      loanId TEXT PRIMARY KEY REFERENCES applications(loanId) ON DELETE CASCADE,
      tokenHash TEXT NOT NULL, email TEXT NOT NULL, codeHash TEXT, codeUntil INTEGER NOT NULL,
      sendWindow INTEGER NOT NULL, sendCount INTEGER NOT NULL, sentAt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      sessionHash TEXT, sessionUntil INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS document_files (
      requestId TEXT PRIMARY KEY REFERENCES document_requests(id) ON DELETE CASCADE,
      objectId TEXT, uploadedAt TEXT, pendingId TEXT, pendingUntil INTEGER, attemptedAt INTEGER NOT NULL, failed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS document_file_cleanup (objectId TEXT PRIMARY KEY);
    CREATE TRIGGER IF NOT EXISTS document_files_deleted AFTER DELETE ON document_files BEGIN
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.objectId WHERE OLD.objectId IS NOT NULL;
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.pendingId WHERE OLD.pendingId IS NOT NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS document_files_replaced AFTER UPDATE ON document_files BEGIN
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.objectId WHERE OLD.objectId IS NOT NULL AND OLD.objectId IS NOT NEW.objectId;
      INSERT OR IGNORE INTO document_file_cleanup SELECT OLD.pendingId WHERE OLD.pendingId IS NOT NULL
        AND OLD.pendingId IS NOT NEW.pendingId AND OLD.pendingId IS NOT NEW.objectId;
    END;`);
    const rateColumns = new Set(db.prepare("PRAGMA table_info(mock_uwm_rates)").all().map((column) => column.name));
    for (const [column, type] of Object.entries({
      lockExtensionReference: "TEXT", lockExtensionDays: "INTEGER", lockCancellationReference: "TEXT", lockCancelledAt: "TEXT",
    })) {
      if (!rateColumns.has(column)) db.exec(`ALTER TABLE mock_uwm_rates ADD COLUMN ${column} ${type}`);
    }
    createApplicationFollowUps(db);
    if (!seedDemo || db.prepare("SELECT 1 FROM settings WHERE key = 'seeded'").get()) return;
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

export function savedPricingRun(db: Store, loanId: string) {
  return db.prepare(`SELECT id, offers, selectedId, mode, quotedAt FROM pricing_runs
    WHERE loanId = ? AND selectedId IS NOT NULL ORDER BY selectedAt DESC, rowid DESC LIMIT 1`).get(loanId);
}

function rows<T>(db: Store, query: string) {
  // Both stores are owned by the schema above. Copy rows into plain objects for React and Workers RPC.
  return db.prepare(query).all().map((row) => ({ ...row }) as T);
}

export function workspace(db: Store): Workspace {
  const contacts = rows<Contact>(db, "SELECT * FROM contacts ORDER BY name COLLATE NOCASE");
  const referralLeads = rows<ReferralLead>(db, `SELECT lead.id, lead.realtorId, contacts.name AS realtorName,
      lead.name, lead.email, lead.phone, lead.purpose, lead.officer, lead.officerEmail, lead.createdAt, lead.dueAt
    FROM referral_leads lead JOIN contacts ON contacts.id = lead.realtorId
    WHERE lead.resolvedAt IS NULL ORDER BY lead.dueAt, lead.id`)
    .map((lead) => ({ ...lead, matches: referralMatches(lead, contacts), restrictedMatch: false }));
  return {
    contacts,
    loans: rows<Loan>(db, "SELECT * FROM loans ORDER BY stageSince DESC, id"),
    submissions: rows<Omit<Submission, "conditions"> & { conditions: string }>(db, "SELECT * FROM submissions ORDER BY lender, id")
      .map((row) => ({ ...row, conditions: JSON.parse(row.conditions) })),
    activity: rows<Activity>(db, "SELECT * FROM activity ORDER BY createdAt DESC, id"),
    tasks: rows<LoanTask>(db, "SELECT * FROM tasks ORDER BY completedAt IS NOT NULL, dueAt, id"),
    communicationDrafts: rows<CommunicationDraft>(db, "SELECT * FROM communication_drafts ORDER BY createdAt DESC, rowid DESC"),
    pastClients: rows<Omit<PastClientProfile, "watchEnabled"> & { watchEnabled: number }>(db, "SELECT loanId, closingDate, currentRate, targetRate, observedRate, checkedAt, watchEnabled, note, revision FROM past_client_profiles")
      .map((profile) => ({ ...profile, watchEnabled: Boolean(profile.watchEnabled) })),
    closingPlans: rows<ClosingPlan>(db, "SELECT loanId, targetDate FROM closing_plans"),
    closingItems: rows<ClosingItem>(db, "SELECT * FROM closing_items ORDER BY completedAt IS NOT NULL, dueDate, id"),
    realtorPortals: rows<RealtorPortal>(db, "SELECT realtorId, token, expiresAt, officerEmail FROM realtor_portals"),
    referralLeads,
    applications: staffApplications(db),
    documentRequests: rows<LoanDocumentRequest>(db, `SELECT requests.*, deliveries.receipt AS uwmReceipt, deliveries.sentAt AS uwmSentAt, ${pdfColumns()}
      FROM document_requests requests LEFT JOIN uwm_document_deliveries deliveries ON deliveries.requestId = requests.id
      LEFT JOIN document_files files ON files.requestId = requests.id
      ORDER BY requests.requestedAt, requests.id`),
    pricingRuns: rows<Omit<PricingRun, "scenario" | "offers" | "notices"> & { scenario: string; offers: string; notices: string }>(db, `
      SELECT run.* FROM pricing_runs run
      WHERE run.id = (SELECT latest.id FROM pricing_runs latest WHERE latest.loanId = run.loanId ORDER BY latest.quotedAt DESC, latest.rowid DESC LIMIT 1)
         OR run.id = (SELECT chosen.id FROM pricing_runs chosen WHERE chosen.loanId = run.loanId AND chosen.selectedId IS NOT NULL ORDER BY chosen.selectedAt DESC, chosen.rowid DESC LIMIT 1)
      ORDER BY run.quotedAt DESC, run.rowid DESC
    `).map((run) => ({ ...run, scenario: JSON.parse(run.scenario), offers: JSON.parse(run.offers), notices: JSON.parse(run.notices) })),
    publishedQuotes: rows<PublishedQuote>(db, "SELECT * FROM published_quotes"),
    mockUwmRates: rows<MockUwmRate>(db, "SELECT * FROM mock_uwm_rates"),
    uwmSyncedAt: (db.prepare("SELECT value FROM settings WHERE key = 'uwmSyncedAt'").get()?.value as string | undefined) ?? null,
  };
}

export function readWorkspace(db: Store) {
  return db.transaction(() => {
    synchronizeRetentionTasks(db);
    return workspace(db);
  });
}

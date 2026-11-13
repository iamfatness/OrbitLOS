import { initializeComplianceProgram } from "./compliance-program";
import { initializeStateScope } from "./compliance-state-scope";
import { initializeStateReadiness } from "./compliance-state-readiness";
import { initializeScopeReviews } from "./compliance-scope-review";
import { initializeComplianceObligations } from "./compliance-obligations";
import { initializeComplianceLearning } from "./compliance-learning";
import type { Store } from "./store";
import { initializeTridEvidence } from "./trid-evidence";
import { initializeStateBrokerAgreement } from "./state-broker-agreement";
import { initializeStateRefinanceBenefit } from "./state-refinance-benefit";
import { initializeKansasNotice } from "./kansas-consumer-notice";
import { initializeMichiganLoanPractices } from "./michigan-loan-practices";
import { initializeCaliforniaMlds } from "./california-mlds";
import { initializeAdvertisingReview } from "./advertising-review";

export function initializeComplianceCases(db: Store) {
  initializeTridEvidence(db);
  initializeStateBrokerAgreement(db);
  initializeStateRefinanceBenefit(db);
  initializeKansasNotice(db);
  initializeMichiganLoanPractices(db);
  initializeCaliforniaMlds(db);
  initializeComplianceProgram(db);
  initializeAdvertisingReview(db);
  initializeStateScope(db);
  initializeStateReadiness(db);
  initializeScopeReviews(db);
  initializeComplianceObligations(db);
  initializeComplianceLearning(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_cases (
      brokerageId TEXT NOT NULL, id TEXT NOT NULL, caseKey TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('Requirement review', 'Control gap', 'Operational finding')),
      confidentiality TEXT NOT NULL CHECK (confidentiality IN ('General', 'Restricted')),
      title TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('Open', 'In progress', 'Awaiting evidence', 'Awaiting review')),
      loanId TEXT, packageVersion INTEGER, parentCaseId TEXT,
      ownerEmail TEXT NOT NULL, ownerAccessRevision INTEGER NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0), openedAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      PRIMARY KEY (brokerageId, id), UNIQUE (brokerageId, caseKey),
      FOREIGN KEY (brokerageId, parentCaseId) REFERENCES compliance_cases(brokerageId, id),
      CHECK ((kind = 'Operational finding' AND loanId IS NOT NULL AND packageVersion IS NOT NULL AND packageVersion > 0 AND parentCaseId IS NOT NULL)
        OR (kind <> 'Operational finding' AND loanId IS NULL AND packageVersion IS NULL))
    );
    CREATE INDEX IF NOT EXISTS compliance_cases_queue ON compliance_cases(brokerageId, confidentiality, openedAt DESC, id);
    CREATE INDEX IF NOT EXISTS compliance_cases_file ON compliance_cases(brokerageId, confidentiality, loanId, openedAt DESC, id);
    CREATE TABLE IF NOT EXISTS compliance_case_events (
      brokerageId TEXT NOT NULL, caseId TEXT NOT NULL, revision INTEGER NOT NULL,
      requestId TEXT, actor TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY (brokerageId, caseId, revision), UNIQUE (brokerageId, caseId, requestId),
      FOREIGN KEY (brokerageId, caseId) REFERENCES compliance_cases(brokerageId, id)
    );
    CREATE TABLE IF NOT EXISTS compliance_research_work (
      brokerageId TEXT NOT NULL, caseId TEXT NOT NULL, sourceKey TEXT NOT NULL, jurisdiction TEXT NOT NULL,
      sourceSnapshot TEXT NOT NULL, nextAction TEXT NOT NULL, followUpOn TEXT, evidenceReference TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (brokerageId, caseId),
      FOREIGN KEY (brokerageId, caseId) REFERENCES compliance_cases(brokerageId, id)
    );
    CREATE INDEX IF NOT EXISTS compliance_research_jurisdiction ON compliance_research_work(brokerageId, jurisdiction, caseId);
  `);
  if (!db.prepare("PRAGMA table_info(compliance_research_work)").all().some(({ name }) => name === "evidenceReference")) {
    db.exec("ALTER TABLE compliance_research_work ADD COLUMN evidenceReference TEXT NOT NULL DEFAULT ''");
  }
}

export function initializeComplianceInventory(db: Store) {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'complianceInventorySchema:1'").get()) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_inventory (
      brokerageId TEXT PRIMARY KEY, generation TEXT NOT NULL, revision INTEGER NOT NULL,
      lastLoanId TEXT NOT NULL, scanned INTEGER NOT NULL, counts TEXT NOT NULL, complete INTEGER NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0, asOf TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS compliance_inventory_files (
      brokerageId TEXT NOT NULL, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      generation TEXT NOT NULL, bucket TEXT NOT NULL, PRIMARY KEY (brokerageId, loanId)
    );
    CREATE INDEX IF NOT EXISTS compliance_inventory_by_bucket ON compliance_inventory_files(brokerageId, generation, bucket, loanId);
    CREATE INDEX IF NOT EXISTS disclosure_packages_by_pricing_run ON disclosure_packages(runId);
  `);
  // A current scan is invalidated in the same transaction as a relevant source edit.
  const inputs = {
    loans: ["INSERT", "DELETE", "UPDATE OF purpose"],
    applications: ["INSERT", "DELETE", "UPDATE OF draft"],
    disclosure_packages: ["INSERT", "DELETE", "UPDATE OF revision, supersededAt, reviewReason, runId"],
    closing_disclosure_reviews: ["INSERT", "DELETE", "UPDATE"],
    pricing_runs: ["INSERT", "DELETE", "UPDATE OF mode, scenario"],
  };
  for (const [table, events] of Object.entries(inputs)) {
    for (const event of events) {
      const operation = event.split(" ")[0].toLowerCase();
      const state = (row: "OLD" | "NEW") => `(CASE WHEN json_valid(${row}.draft) THEN json_extract(${row}.draft, '$.propertyLocation.state') END)`;
      const relevant = table === "applications" && operation === "update" ? ` WHEN ${state("OLD")} IS NOT ${state("NEW")}` :
        table === "loans" && operation === "update" ? " WHEN OLD.purpose IS NOT NEW.purpose" :
          table === "pricing_runs" ? ` WHEN EXISTS (SELECT 1 FROM disclosure_packages WHERE runId = ${operation === "delete" ? "OLD" : "NEW"}.id)` : "";
      db.exec(`CREATE TRIGGER IF NOT EXISTS compliance_inventory_${table}_${operation} AFTER ${event} ON ${table}${relevant}
        BEGIN UPDATE compliance_inventory SET stale = 1, revision = revision + 1 WHERE stale = 0; END;`);
    }
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('complianceInventorySchema:1', '1')").run();
}

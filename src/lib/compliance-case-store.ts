import type { Store } from "./store";

export function initializeComplianceCases(db: Store) {
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
  `);
}

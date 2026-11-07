import { insertContact, insertLoan, insertSubmission, type Store } from "./store";
import type { Condition, Stage } from "./model";
import { addApplicationActivity, getApplication } from "./applications";

// The shapes used by the Insights Loans query and the single-loan conditions endpoint.
interface InsightsLoan {
  LoanId: string;
  PrimaryBorrowerFirstName: string;
  PrimaryBorrowerLastName: string;
  ImportedDateTime: string;
  LoanStatusDescription: string;
}

interface UwmCondition {
  id: string;
  conditionCategory: string;
  conditionDescription: string;
  isConditionUploaded: boolean;
  conditionSatisfactionDate: string | null;
}

interface UwmConditions {
  conditionGroups: { key: string; countItems: number; uploadedConditionsCount: number; conditions: UwmCondition[] }[];
  clearedConditions: UwmCondition[];
}

interface UwmConnector {
  listLoans(): Promise<{ data: { Loans: InsightsLoan[] } }>;
  getConditions(loanNumber: string): Promise<UwmConditions>;
}

const mockLoans = [
  { LoanId: "9000001001", PrimaryBorrowerFirstName: "Charlotte", PrimaryBorrowerLastName: "Kim", ImportedDateTime: "2026-10-30T12:00:00Z", LoanStatusDescription: "Wholesale - Approved With Conditions" },
  { LoanId: "9000001002", PrimaryBorrowerFirstName: "Amelia", PrimaryBorrowerLastName: "Davis", ImportedDateTime: "2026-10-24T12:00:00Z", LoanStatusDescription: "Wholesale - Clear To Close" },
  { LoanId: "9000001003", PrimaryBorrowerFirstName: "Benjamin", PrimaryBorrowerLastName: "Cole", ImportedDateTime: "2026-11-02T12:00:00Z", LoanStatusDescription: "Wholesale - File Imported" },
] satisfies InsightsLoan[];

function sampleCondition(loanNumber: string, index: number, category: string, description: string, cleared = false): UwmCondition {
  return {
    id: `${loanNumber}_25_${index}`, conditionCategory: category, conditionDescription: description,
    isConditionUploaded: cleared, conditionSatisfactionDate: cleared ? "2026-11-04T15:30:00Z" : null,
  };
}

const mockUwm: UwmConnector = {
  async listLoans() {
    return { data: { Loans: mockLoans } };
  },
  async getConditions(loanNumber) {
    if (loanNumber === "9000001001") {
      return {
        conditionGroups: [{
          key: "Underwriting", countItems: 2, uploadedConditionsCount: 0,
          conditions: [
            sampleCondition(loanNumber, 1, "Income", "Provide the most recent 30 days of pay statements."),
            sampleCondition(loanNumber, 2, "Assets", "Provide a complete copy of the latest bank statement."),
          ],
        }],
        clearedConditions: [sampleCondition(loanNumber, 3, "Property", "Confirm the subject property address.", true)],
      };
    }
    if (loanNumber === "9000001002") {
      return { conditionGroups: [], clearedConditions: [sampleCondition(loanNumber, 1, "Title", "Provide the preliminary title commitment.", true)] };
    }
    return { conditionGroups: [], clearedConditions: [] };
  },
};

const initialStage: Record<string, Stage> = {
  "Wholesale - File Imported": "Application",
  "Wholesale - Setup": "Processing",
  "Wholesale - Underwriting": "Underwriting",
  "Wholesale - Approved With Conditions": "Underwriting",
  "Wholesale - Clear To Close": "Clear to Close",
  Funded: "Funded",
  "Post Closed": "Closed",
};

function normalizeConditions({ conditionGroups, clearedConditions }: UwmConditions): Condition[] {
  function normalize(item: UwmCondition, group: string | null): Condition {
    return {
      id: item.id, group, category: item.conditionCategory, description: item.conditionDescription,
      uploaded: item.isConditionUploaded, satisfiedAt: item.conditionSatisfactionDate,
    };
  }
  return [
    ...conditionGroups.flatMap((group) => group.conditions.map((item) => normalize(item, group.key))),
    ...clearedConditions.map((item) => normalize(item, null)),
  ];
}

const approvedWithConditions = "Wholesale - Approved With Conditions";

function mockApplicationConditions(reference: string, receivedAt: string) {
  return normalizeConditions({
    conditionGroups: [{
      key: "Underwriting", countItems: 2, uploadedConditionsCount: 0,
      conditions: [
        sampleCondition(reference, 1, "Income", "Provide the most recent 30 days of pay statements."),
        sampleCondition(reference, 2, "Assets", "Provide the most recent bank statement for funds to close."),
      ],
    }],
    clearedConditions: [{
      ...sampleCondition(reference, 3, "Application", "Confirm the application and property details.", true),
      conditionSatisfactionDate: receivedAt,
    }],
  });
}

// Called inside the workspace transaction after LO review. The mock import
// acknowledgment and its condition snapshot are recorded together.
export function submitMockApplication(db: Store, loanId: string, now: string) {
  const application = getApplication(db, loanId);
  if (!application?.reviewedAt || !application.submittedAt) return { error: "Review the submitted application before sending it to UWM." };
  if (application.uwmReference) return { reference: application.uwmReference };
  if (db.prepare("SELECT 1 FROM submissions WHERE loanId = ? AND lender = 'UWM'").get(loanId)) {
    return { error: "This loan already has a UWM submission. Start with a loan that has no UWM reference for this demo." };
  }

  const reference = `DEMO-${crypto.randomUUID().toUpperCase()}`;
  insertSubmission(db, {
    id: crypto.randomUUID(), loanId, lender: "UWM", externalId: reference,
    status: approvedWithConditions, conditions: mockApplicationConditions(reference, application.submittedAt), syncedAt: now,
  });
  db.prepare("UPDATE applications SET uwmReference = ? WHERE loanId = ?").run(reference, loanId);
  addApplicationActivity(db, loanId, `Mock UWM import confirmed. Reference ${reference}.`, now);
  return { reference };
}

export async function syncUwm(db: Store, connector: UwmConnector = mockUwm) {
  const { data: { Loans } } = await connector.listLoans();
  const files = await Promise.all(Loans.map(async (loan) => ({
    loan, conditions: normalizeConditions(await connector.getConditions(loan.LoanId)),
  })));
  return db.transaction(() => {
    const now = new Date().toISOString();
    let imported = 0;
    let updated = 0;
    let conditionCount = 0;
    const update = db.prepare("UPDATE submissions SET status = ?, conditions = ?, syncedAt = ? WHERE id = ?");
    for (const { loan, conditions } of files) {
      conditionCount += conditions.length;
      const existing = db.prepare("SELECT id FROM submissions WHERE lender = 'UWM' AND externalId = ?").get(loan.LoanId);
      if (existing) {
        update.run(loan.LoanStatusDescription, JSON.stringify(conditions), now, existing.id);
        updated++;
        continue;
      }
      const contactId = crypto.randomUUID();
      const loanId = crypto.randomUUID();
      insertContact(db, {
        id: contactId, name: `${loan.PrimaryBorrowerFirstName} ${loan.PrimaryBorrowerLastName}`,
        email: "", phone: "", role: "Borrower",
      });
      insertLoan(db, {
        id: loanId, contactId, partnerId: null, officer: "", officerEmail: null, address: "", amount: 0, purpose: "Purchase",
        stage: initialStage[loan.LoanStatusDescription] ?? "Application", stageSince: now,
      });
      insertSubmission(db, {
        id: crypto.randomUUID(), loanId, lender: "UWM", externalId: loan.LoanId, status: loan.LoanStatusDescription,
        conditions, syncedAt: now,
      });
      imported++;
    }
    const applicationFiles = db.prepare(`
      SELECT submissions.id, submissions.externalId, applications.submittedAt
      FROM applications JOIN submissions
      ON submissions.loanId = applications.loanId AND submissions.externalId = applications.uwmReference
      WHERE submissions.lender = 'UWM' AND applications.submittedAt IS NOT NULL
    `).all();
    for (const file of applicationFiles) {
      const conditions = mockApplicationConditions(String(file.externalId), String(file.submittedAt));
      update.run(approvedWithConditions, JSON.stringify(conditions), now, file.id);
      updated++;
      conditionCount += conditions.length;
    }
    db.prepare("INSERT INTO settings VALUES ('uwmSyncedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(now);
    return { imported, updated, conditions: conditionCount };
  });
}

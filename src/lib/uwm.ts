import { insertContact, insertLoan, insertSubmission, type Store } from "./store";
import type { Condition, Stage, Submission } from "./model";
import { addApplicationActivity, getApplication } from "./applications";
import { createRealtorLenderDraft } from "./communications";
import { recordUwmAlerts } from "./uwm-alerts";

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

const mockUpdateLoan = "9000001001";

function mockConditions(loanNumber: string, changed: boolean): UwmConditions {
  if (loanNumber === mockUpdateLoan) {
    const property = sampleCondition(loanNumber, 3, "Property", "Confirm the subject property address.", !changed);
    const outstanding = [
      sampleCondition(loanNumber, 1, "Income", "Provide the most recent 30 days of pay statements."),
      sampleCondition(loanNumber, 2, "Assets", "Provide a complete copy of the latest bank statement."),
    ];
    if (changed) outstanding.push(sampleCondition(loanNumber, 4, "Insurance", "Provide a current homeowners insurance binder."), property);
    return {
      conditionGroups: [{ key: "Underwriting", countItems: outstanding.length, uploadedConditionsCount: 0, conditions: outstanding }],
      clearedConditions: changed ? [] : [property],
    };
  }
  if (loanNumber === "9000001002") {
    return { conditionGroups: [], clearedConditions: [sampleCondition(loanNumber, 1, "Title", "Provide the preliminary title commitment.", true)] };
  }
  return { conditionGroups: [], clearedConditions: [] };
}

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
  const conditions = [
    ...conditionGroups.flatMap((group) => group.conditions.map((item) => normalize(item, group.key))),
    ...clearedConditions.map((item) => normalize(item, null)),
  ];
  return [...new Map(conditions.map((condition) => [condition.id, condition])).values()];
}

const approvedWithConditions = "Wholesale - Approved With Conditions";

export function uwmSubmissionConditions(db: Store, loanId: string, submissionId: string): Condition[] | undefined {
  const submission = db.prepare("SELECT conditions FROM submissions WHERE id = ? AND loanId = ? AND lender = 'UWM' AND syncedAt IS NOT NULL")
    .get(submissionId, loanId);
  return submission && JSON.parse(String(submission.conditions));
}

export function sendMockConditionDocument(db: Store, loanId: string, requestId: string, now: string): { receipt: string } | { error: string } {
  const request = db.prepare(`SELECT requests.kind, requests.status, requests.submissionId, requests.conditionId, requests.revision, deliveries.receipt
    FROM document_requests requests LEFT JOIN uwm_document_deliveries deliveries ON deliveries.requestId = requests.id
    WHERE requests.id = ? AND requests.loanId = ?`).get(requestId, loanId);
  if (!request || request.status !== "Accepted" || typeof request.submissionId !== "string") {
    return { error: "Accept a document linked to a UWM condition before recording mock delivery." };
  }
  if (typeof request.receipt === "string") return { receipt: request.receipt };
  const conditions = uwmSubmissionConditions(db, loanId, request.submissionId);
  if (!conditions?.some((condition) => condition.id === request.conditionId && !condition.satisfiedAt)) {
    return { error: "This UWM condition is no longer outstanding. Refresh the loan to see its status." };
  }
  const receipt = `DEMO-DOC-${crypto.randomUUID().toUpperCase()}`;
  db.prepare("INSERT INTO uwm_document_deliveries (requestId, receipt, sentAt, documentRevision) VALUES (?, ?, ?, ?)")
    .run(requestId, receipt, now, request.revision);
  const pdf = db.prepare("SELECT objectId FROM document_files WHERE requestId = ?").get(requestId)?.objectId;
  addApplicationActivity(db, loanId, `${pdf ? "Mock UWM delivery recorded" : "Sample sent to UWM (mock)"} · ${request.kind} · ${receipt}`, now);
  return { receipt };
}

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
  const submission = {
    id: crypto.randomUUID(), loanId, lender: "UWM", externalId: reference,
    status: approvedWithConditions, conditions: mockApplicationConditions(reference, application.submittedAt), syncedAt: now,
  };
  insertSubmission(db, submission);
  recordUwmAlerts(db, submission, null, now);
  createRealtorLenderDraft(db, loanId, "Lender review started", now);
  db.prepare("UPDATE applications SET uwmReference = ? WHERE loanId = ?").run(reference, loanId);
  addApplicationActivity(db, loanId, `Mock UWM import confirmed. Reference ${reference}.`, now);
  return { reference };
}

type UwmFile = { loan: InsightsLoan; conditions: Condition[] };
type SavedUwmSubmission = Pick<Submission, "id" | "loanId" | "status"> & { conditions: string };

function applyMockClearances(db: Store, submissionId: string, conditions: Condition[]) {
  const cleared = new Map(db.prepare(`SELECT requests.conditionId, deliveries.mockClearedAt FROM document_requests requests
    JOIN uwm_document_deliveries deliveries ON deliveries.requestId = requests.id
    WHERE requests.submissionId = ? AND deliveries.mockClearedAt IS NOT NULL`)
    .all(submissionId).map((item) => [String(item.conditionId), String(item.mockClearedAt)]));
  return conditions.map((condition) => {
    const satisfiedAt = cleared.get(condition.id);
    return satisfiedAt && !condition.satisfiedAt ? { ...condition, uploaded: true, satisfiedAt } : condition;
  });
}

// Called inside the workspace mutation after access to the loan is checked.
export function refreshMockUwmClearance(db: Store, loanId: string, submissionId: string, now: string) {
  const saved = uwmSubmissionConditions(db, loanId, submissionId);
  if (!saved) return { error: "This UWM submission is unavailable on this loan." } as const;
  db.prepare(`UPDATE uwm_document_deliveries SET mockClearedAt = ? WHERE mockClearedAt IS NULL
    AND requestId IN (SELECT id FROM document_requests WHERE submissionId = ? AND loanId = ?)`).run(now, submissionId, loanId);
  const conditions = applyMockClearances(db, submissionId, saved);
  const count = saved.reduce((total, condition, index) => total + Number(!condition.satisfiedAt && !!conditions[index].satisfiedAt), 0);
  const clearedAll = count > 0 && conditions.every((condition) => condition.satisfiedAt);
  if (clearedAll) {
    const status = db.prepare("SELECT status FROM submissions WHERE id = ?").get(submissionId)?.status;
    if (typeof status === "string") recordUwmAlerts(db, { id: submissionId, loanId, status: "Conditions cleared", conditions }, { status, conditions: saved }, now);
    db.prepare("UPDATE submissions SET status = ?, conditions = ?, syncedAt = ? WHERE id = ?")
      .run("Conditions cleared", JSON.stringify(conditions), now, submissionId);
    createRealtorLenderDraft(db, loanId, "Lender review complete", now);
  } else {
    db.prepare("UPDATE submissions SET conditions = ?, syncedAt = ? WHERE id = ?").run(JSON.stringify(conditions), now, submissionId);
  }
  const label = count === 1 ? "condition" : "conditions";
  if (count) addApplicationActivity(db, loanId, `Mock UWM cleared ${count} ${label}.`, now);
  return { message: count ? `Mock UWM cleared ${count} ${label}.` : "No new mock UWM clearances for this submission." };
}

function saveUwmSync(db: Store, files: UwmFile[], mock: boolean) {
  const now = new Date().toISOString();
  if (mock) db.prepare("UPDATE uwm_document_deliveries SET mockClearedAt = ? WHERE mockClearedAt IS NULL").run(now);
  let imported = 0;
  let updated = 0;
  let conditionCount = 0;
  let alerts = 0;
  const update = db.prepare("UPDATE submissions SET status = ?, conditions = ?, syncedAt = ? WHERE id = ?");
  function refresh(existing: SavedUwmSubmission, status: string, incoming: Condition[]) {
    const conditions = mock ? applyMockClearances(db, existing.id, incoming) : incoming;
    const previousConditions = JSON.parse(existing.conditions) as Condition[];
    if (mock && conditions.length && conditions.every((item) => item.satisfiedAt) && (existing.status === "Conditions cleared" ||
      previousConditions.some((item) => !item.satisfiedAt))) {
      status = "Conditions cleared";
      createRealtorLenderDraft(db, existing.loanId, "Lender review complete", now);
    } else if (mock && existing.status !== status) {
      if (status === approvedWithConditions || status === "Wholesale - Underwriting") {
        createRealtorLenderDraft(db, existing.loanId, "Lender review started", now);
      } else if (status === "Wholesale - Clear To Close" && conditions.every((item) => item.satisfiedAt)) {
        createRealtorLenderDraft(db, existing.loanId, "Lender review complete", now);
      }
    }
    alerts += recordUwmAlerts(db, { id: existing.id, loanId: existing.loanId, status, conditions },
      { status: existing.status, conditions: JSON.parse(existing.conditions) }, now);
    update.run(status, JSON.stringify(conditions), now, existing.id);
    conditionCount += conditions.length;
    updated++;
  }

  const findSubmission = db.prepare("SELECT id, loanId, status, conditions FROM submissions WHERE lender = 'UWM' AND externalId = ?");
  for (const { loan, conditions } of files) {
    const existing = findSubmission.get(loan.LoanId) as SavedUwmSubmission | undefined;
    if (existing) {
      refresh(existing, loan.LoanStatusDescription, conditions);
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
    const submission = {
      id: crypto.randomUUID(), loanId, lender: "UWM", externalId: loan.LoanId, status: loan.LoanStatusDescription, conditions, syncedAt: now,
    };
    insertSubmission(db, submission);
    alerts += recordUwmAlerts(db, submission, null, now);
    conditionCount += conditions.length;
    imported++;
  }
  if (mock) {
    const applicationFiles = db.prepare(`
      SELECT submissions.id, submissions.loanId, submissions.status, submissions.conditions, submissions.externalId, applications.submittedAt
      FROM applications JOIN submissions
      ON submissions.loanId = applications.loanId AND submissions.externalId = applications.uwmReference
      WHERE submissions.lender = 'UWM' AND applications.submittedAt IS NOT NULL
    `).all();
    for (const file of applicationFiles) {
      const conditions = mockApplicationConditions(String(file.externalId), String(file.submittedAt));
      refresh(file as SavedUwmSubmission, approvedWithConditions, conditions);
    }
  }
  db.prepare("INSERT INTO settings VALUES ('uwmSyncedAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(now);
  return { imported, updated, conditions: conditionCount, alerts };
}

function saveMockUwmSync(db: Store, changed: boolean) {
  return saveUwmSync(db, mockLoans.map((loan) => ({
    loan: changed && loan.LoanId === mockUpdateLoan ? { ...loan, LoanStatusDescription: "Wholesale - Underwriting" } : loan,
    conditions: normalizeConditions(mockConditions(loan.LoanId, changed)),
  })), true);
}

function changesApplied(db: Store) {
  return !!db.prepare("SELECT 1 FROM settings WHERE key = 'mockUwmChangesApplied'").get();
}

export function simulateMockUwmChanges(db: Store) {
  return db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM submissions WHERE lender = 'UWM' AND externalId = ? AND syncedAt IS NOT NULL").get(mockUpdateLoan)) {
      return { error: "Sync the mock UWM pipeline first to load Charlotte Kim’s baseline." } as const;
    }
    if (changesApplied(db)) return { error: "The sample UWM changes are already applied in this workspace." } as const;
    const result = saveMockUwmSync(db, true);
    db.prepare("INSERT INTO settings VALUES ('mockUwmChangesApplied', '1')").run();
    return result;
  });
}

export async function syncUwm(db: Store, connector?: UwmConnector) {
  if (!connector) return db.transaction(() => saveMockUwmSync(db, changesApplied(db)));
  const { data: { Loans } } = await connector.listLoans();
  const files = await Promise.all(Loans.map(async (loan) => ({
    loan, conditions: normalizeConditions(await connector.getConditions(loan.LoanId)),
  })));
  return db.transaction(() => saveUwmSync(db, files, false));
}

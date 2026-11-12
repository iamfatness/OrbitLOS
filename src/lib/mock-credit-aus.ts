import { z } from "zod";
import { applicationDraft } from "./application-model";
import { addApplicationActivity } from "./applications";
import { demoBrokerageId } from "./brokerage-model";
import { ausMethods, creditApplicantCount, creditAusServices, creditCoversApplication, mockAusScenarios, mockCreditScenarios, mockRunMatchesApplication, unconfirmedMockOrder, type MockCreditAuthorization, type MockCreditAusResult, type MockCreditAusRun, type MockUnderwritingConflict } from "./credit-aus-model";
import { classifyUnderwritingLookup, type UnderwritingLookup, type UnderwritingOrderIdentity } from "./underwriting-lookup";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";

const loanId = z.string().min(1).max(100);
const revision = z.number().int().nonnegative();
const attempt = { attemptId: z.uuid(), previousId: z.uuid().nullable() };
const fields = { loanId, ...attempt, applicationRevision: revision.nullable().optional() };
const ausScenario = z.enum(mockAusScenarios.map(([value]) => value));
export const mockCreditInput = z.object({
  ...fields, type: z.literal("runMockCredit"), authorized: z.literal(true),
  borrowers: z.enum(["primary", "all"]).optional(),
  scenario: z.enum(mockCreditScenarios.map(([value]) => value)),
});
export const mockAusInput = z.object({
  ...fields, type: z.literal("runMockAus"), method: z.enum(ausMethods), creditId: z.uuid(),
  scenario: ausScenario,
});
const pairedOrder = z.object({ ...attempt, scenario: ausScenario });
export const mockPairedAusInput = z.object({
  type: z.literal("runMockPairedAus"), loanId, batchId: z.uuid(), creditId: z.uuid(), applicationRevision: revision,
  orders: z.object({ DU: pairedOrder, LPA: pairedOrder }),
}).refine(({ orders }) => orders.DU.attemptId !== orders.LPA.attemptId, "Each service needs a separate order.");
export const mockRetryInput = z.object({
  ...fields, type: z.literal("retryMockCreditAus"), service: z.enum(creditAusServices), previousId: z.uuid(),
});
export const mockReconcileInput = z.object({
  loanId, type: z.literal("reconcileMockCreditAus"), attemptId: z.uuid(),
});
export const mockConflictReviewInput = z.object({
  loanId, type: z.literal("reviewMockUnderwritingConflict"), attemptId: z.uuid(),
  detectedAt: z.iso.datetime(), reference: z.string().min(1).max(100),
});
type SingleOrderInput = z.infer<typeof mockCreditInput | typeof mockAusInput | typeof mockRetryInput>;
type PairedOrderInput = z.infer<typeof mockPairedAusInput>;
type MockInput = SingleOrderInput | PairedOrderInput | z.infer<typeof mockReconcileInput | typeof mockConflictReviewInput>;

type RunRow = Record<string, SqlValue>;
type MockLookup = "rejected" | "inconclusive-first" | "conflict-first";
type StoredResult = MockCreditAusResult & {
  borrowerCount?: number; reconciledAt?: string; lastCheckedAt?: string; mockLookup?: MockLookup; conflict?: MockUnderwritingConflict;
};

function readRun(row: RunRow): MockCreditAusRun {
  const { borrowerCount, reconciledAt, lastCheckedAt, conflict, ...result } = JSON.parse(String(row.result)) as StoredResult;
  delete result.mockLookup;
  return {
    id: String(row.id), loanId: String(row.loanId), service: row.service as MockCreditAusRun["service"],
    reference: String(row.reference), creditId: row.creditId as string | null, retryOf: row.retryOf as string | null,
    requestedBy: String(row.requestedBy), requestedAt: String(row.requestedAt), result,
    applicationRevision: typeof row.applicationRevision === "number" ? row.applicationRevision : null,
    ...(typeof row.authorization === "string" ? { authorization: JSON.parse(row.authorization) as MockCreditAuthorization } : {}),
    ...(typeof row.batchId === "string" ? { batchId: row.batchId } : {}),
    ...(borrowerCount !== undefined ? { borrowerCount } : {}),
    ...(reconciledAt !== undefined ? { reconciledAt } : {}),
    ...(lastCheckedAt !== undefined ? { lastCheckedAt } : {}),
    ...(conflict ? { conflict } : {}),
  };
}

export function mockCreditAusRuns(db: Store, loanId?: string) {
  return db.prepare(`SELECT * FROM mock_credit_aus_runs ${loanId ? "WHERE loanId = ?" : ""} ORDER BY rowid DESC`)
    .all(...(loanId ? [loanId] : [])).map(readRun);
}

function latestRun(db: Store, loanId: string, service: MockCreditAusRun["service"]) {
  const row = db.prepare("SELECT * FROM mock_credit_aus_runs WHERE loanId = ? AND service = ? ORDER BY rowid DESC LIMIT 1").get(loanId, service);
  return row ? readRun(row) : null;
}

const findings = {
  DU: {
    eligible: ["The sample loan meets the mock DU eligibility checks.", "Review the sample income and asset documentation before lender submission."],
    review: ["The mock DU review flagged a gap in the sample borrower’s employment history.", "Verify employment dates and review any corrections before running DU again."],
  },
  LPA: {
    eligible: ["The sample loan meets the mock LPA eligibility checks.", "Review the sample funds needed for closing and the source of those funds."],
    review: ["The mock LPA review flagged a large deposit in the sample assets.", "Review the deposit and verify the available funds before running LPA again."],
  },
};

type MockScenario = typeof mockCreditScenarios[number][0] | typeof mockAusScenarios[number][0];

function mockResult(service: MockCreditAusRun["service"], scenario: MockScenario): StoredResult {
  if (scenario === "uncertain") return { status: unconfirmedMockOrder };
  if (scenario === "uncertain-rejected") return { status: unconfirmedMockOrder, mockLookup: "rejected" };
  if (scenario === "uncertain-unavailable") return { status: unconfirmedMockOrder, mockLookup: "inconclusive-first" };
  if (scenario === "uncertain-conflict") return { status: unconfirmedMockOrder, mockLookup: "conflict-first" };
  if (scenario === "failure") return { status: "Failed", reason: `The mock ${service === "Credit" ? "credit provider" : service + " service"} confirmed that no order was placed. You can retry.` };
  if (service === "Credit") return { status: "Report ready", score: 742 };
  const review = scenario === "review";
  return { status: "Findings ready", recommendation: review ? "Review required" : "Eligible sample", findings: findings[service][review ? "review" : "eligible"] };
}

type Attempt = {
  id: string; loanId: string; service: MockCreditAusRun["service"]; result: StoredResult;
  creditId: string | null; retryOf?: string; batchId?: string; applicationRevision: number | null;
  authorization?: MockCreditAuthorization; requestKey: string; borrowerCount: number;
};

function recordAttempt(db: Store, order: Attempt, staff: StaffIdentity | null, now: string) {
  const { id, loanId, service, result, creditId, retryOf, batchId, applicationRevision, authorization, requestKey, borrowerCount } = order;
  const reference = `MOCK-${service.toUpperCase()}-${id.toUpperCase()}`;
  db.prepare(`INSERT INTO mock_credit_aus_runs
    (id, loanId, service, reference, creditId, retryOf, requestedBy, requestedAt, result, applicationRevision, authorization, batchId, requestKey)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, loanId, service, reference, creditId, retryOf ?? null, staff?.name.slice(0, 160) || "Demo loan officer", now,
      JSON.stringify({ ...result, borrowerCount }), applicationRevision, authorization ? JSON.stringify(authorization) : null, batchId ?? null, requestKey);
  const label = service === "Credit" ? "credit" : service;
  const action = retryOf ? `Retried mock ${label}` : `Ran mock ${label}${service === "Credit" ? " with demo authorization" : ""}`;
  addApplicationActivity(db, loanId, `${action} · ${result.status} · ${reference}${batchId ? ` · Paired run ${batchId}` : ""}`, now);
}

function applicationEvidence(db: Store, loanId: string) {
  const row = db.prepare("SELECT revision, draft FROM applications WHERE loanId = ? AND submittedAt IS NOT NULL").get(loanId);
  const draft = row ? applicationDraft.parse(JSON.parse(String(row.draft))) : null;
  return {
    revision: typeof row?.revision === "number" ? row.revision : null,
    borrowerCount: creditApplicantCount(draft),
  };
}

const changedApplication = "The submitted 1003 changed. Refresh Credit & AUS and start a new request.";
const changedOrder = "A newer request is on this loan. Refresh Credit & AUS and try again.";
const reusedAttempt = "Refresh the workbench before placing a new request.";
const pendingOrder = "Check the original mock result before placing another request for this service.";

function runPairedAus(db: Store, input: PairedOrderInput, staff: StaffIdentity | null, now: string) {
  const { loanId, applicationRevision, creditId, batchId, orders } = input;
  const requestKey = JSON.stringify([loanId, applicationRevision, creditId, ...ausMethods.map((method) => {
    const { attemptId, previousId, scenario } = orders[method];
    return [method, attemptId, previousId, scenario];
  })]);
  const prior = db.prepare("SELECT requestKey FROM mock_credit_aus_runs WHERE batchId = ? AND retryOf IS NULL").all(batchId);
  if (prior.length) return prior.length === 2 && prior.every((row) => row.requestKey === requestKey)
    ? { message: "This paired mock request is already on the loan." } : { error: reusedAttempt };
  const evidence = applicationEvidence(db, loanId);
  if (evidence.revision !== applicationRevision) return { error: changedApplication };
  const credit = latestRun(db, loanId, "Credit");
  if (!credit || credit.id !== creditId || !creditCoversApplication(credit, applicationRevision, evidence.borrowerCount)) {
    return { error: "Run authorized mock credit for the current submitted 1003 before running both services." };
  }
  for (const method of ausMethods) {
    const previous = latestRun(db, loanId, method);
    if (previous?.result.status === unconfirmedMockOrder) return { error: pendingOrder };
    if ((previous?.id ?? null) !== orders[method].previousId) return { error: changedOrder };
    if (db.prepare("SELECT 1 FROM mock_credit_aus_runs WHERE id = ?").get(orders[method].attemptId)) return { error: reusedAttempt };
  }
  const results = ausMethods.map((service) => {
    const { attemptId, scenario } = orders[service];
    const result = mockResult(service, scenario);
    recordAttempt(db, { id: attemptId, loanId, service, result, creditId, applicationRevision, batchId, requestKey,
      borrowerCount: evidence.borrowerCount }, staff, now);
    return `${service} ${result.status.toLowerCase()}`;
  });
  return { message: `Mock ${results.join(" · ")}. Review each service in Credit & AUS.` };
}

function simulateLookup(stored: StoredResult, identity: UnderwritingOrderIdentity, reference: string): UnderwritingLookup {
  if (stored.mockLookup === "inconclusive-first" && !stored.lastCheckedAt) return { outcome: "inconclusive" };
  if (stored.mockLookup === "conflict-first" && !stored.conflict) {
    return { outcome: "accepted", identity, reference: `MOCK-UNMATCHED-${identity.orderId.toUpperCase()}` };
  }
  return { outcome: stored.mockLookup === "rejected" ? "rejected" : "accepted", identity, reference };
}

const conflictPending = "A brokerage admin must review the conflicting mock response before checking this order again.";

function reconcileOrder(db: Store, input: z.infer<typeof mockReconcileInput | typeof mockConflictReviewInput>, staff: WorkspaceStaff | null, now: string) {
  if (input.type === "reviewMockUnderwritingConflict" && staff && staff.brokerage.role !== "Admin") {
    return { error: "Only a brokerage admin can review a conflicting mock response." };
  }
  const row = db.prepare("SELECT * FROM mock_credit_aus_runs WHERE loanId = ? AND id = ?").get(input.loanId, input.attemptId);
  if (!row) return { error: "The original mock request is unavailable." };
  const stored = JSON.parse(String(row.result)) as StoredResult;
  const write = (result: StoredResult) => db.prepare("UPDATE mock_credit_aus_runs SET result = ? WHERE id = ? AND loanId = ?")
    .run(JSON.stringify(result), input.attemptId, input.loanId);
  const audit = (text: string) => addApplicationActivity(db, input.loanId, `${text} · ${row.reference} · ${staff?.name ?? "Demo loan officer"}`, now);
  if (input.type === "reviewMockUnderwritingConflict") {
    const conflict = stored.conflict;
    if (!conflict || conflict.reference !== input.reference || conflict.detectedAt !== input.detectedAt) {
      return { error: "The conflicting response changed. Open the current exception to review it." };
    }
    if (conflict.reviewedAt) return { message: "This mismatched response is already dismissed." };
    if (stored.status !== unconfirmedMockOrder) return { error: "This order no longer needs a conflict review." };
    write({ ...stored, conflict: { ...conflict, reviewedAt: now, reviewedBy: staff?.name ?? "Demo admin" } });
    audit("Dismissed mismatched mock underwriting response");
    return { message: "Mismatched response dismissed. The original order still needs confirmation." };
  }
  if (stored.reconciledAt) return { message: "The original mock result is already confirmed." };
  if (stored.status !== unconfirmedMockOrder) return { error: "Only a request awaiting confirmation can be checked." };
  if (stored.conflict && !stored.conflict.reviewedAt) return { error: conflictPending };
  const service = row.service as MockCreditAusRun["service"];
  const identity = { brokerageId: staff?.brokerage.id ?? demoBrokerageId, loanId: input.loanId, orderId: input.attemptId,
    service, applicationRevision: typeof row.applicationRevision === "number" ? row.applicationRevision : null,
    borrowerCount: stored.borrowerCount ?? 1 };
  const reference = String(row.reference);
  const check = classifyUnderwritingLookup(identity, simulateLookup(stored, identity, reference), reference);
  if (check.outcome === "conflict") {
    write({ ...stored, conflict: { reference: check.reference, detectedAt: now } });
    audit("Flagged mismatched mock underwriting response");
    return { message: "Mock response did not match this order. Sent to brokerage admin review." };
  }
  if (check.outcome === "inconclusive") {
    write({ ...stored, lastCheckedAt: now });
    audit(`Checked unconfirmed mock ${service} result · ${unconfirmedMockOrder}`);
    return { message: "The mock lookup was inconclusive. The original order is still pending." };
  }
  const rejected = check.outcome === "rejected";
  const result = mockResult(service, rejected ? "failure" : "eligible");
  write({ ...result, borrowerCount: stored.borrowerCount, reconciledAt: now, conflict: stored.conflict });
  audit(`Confirmed original mock ${service} result · ${result.status}`);
  if (rejected) return { message: "Mock provider confirmed no order was placed. You can retry." };
  return { message: "Original mock result confirmed." };
}

// Called inside the workspace mutation so all orders and their activity entries commit together.
export function runMockCreditAus(db: Store, input: MockInput, staff: WorkspaceStaff | null, now: string) {
  if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(input.loanId)) return { error: "This loan no longer exists." };
  if (input.type === "reconcileMockCreditAus" || input.type === "reviewMockUnderwritingConflict") return reconcileOrder(db, input, staff, now);
  if (input.type === "runMockPairedAus") return runPairedAus(db, input, staff, now);
  const { loanId, attemptId, previousId } = input;
  const service = input.type === "runMockCredit" ? "Credit" : input.type === "runMockAus" ? input.method : input.service;
  const requestKey = JSON.stringify(input);
  const repeated = db.prepare("SELECT loanId, service, requestKey, batchId, retryOf FROM mock_credit_aus_runs WHERE id = ?").get(attemptId);
  if (repeated) return repeated.loanId === loanId && repeated.service === service && (!repeated.batchId || !!repeated.retryOf) &&
    (repeated.requestKey === null || repeated.requestKey === requestKey) ? { message: "This mock request is already on the loan." } : { error: reusedAttempt };
  const evidence = applicationEvidence(db, loanId);
  const applicationRevision = evidence.revision;
  if (input.applicationRevision !== undefined && input.applicationRevision !== applicationRevision) return { error: changedApplication };
  const previous = latestRun(db, loanId, service);
  if (previous?.result.status === unconfirmedMockOrder) return { error: pendingOrder };
  if ((previous?.id ?? null) !== previousId) return { error: changedOrder };

  const retry = input.type === "retryMockCreditAus";
  if (retry && previous?.result.status !== "Failed") return { error: "Select the latest failed request to retry." };
  if (retry && previous && !mockRunMatchesApplication(previous, applicationRevision)) return { error: changedApplication };
  const credit = service === "Credit" ? null : latestRun(db, loanId, "Credit");
  const creditId = input.type === "runMockAus" ? input.creditId : previous?.creditId ?? null;
  if (service !== "Credit" && applicationRevision === null) return { error: "Submit the 1003 before ordering mock AUS." };
  if (service !== "Credit" && (!credit || credit.id !== creditId || !creditCoversApplication(credit, applicationRevision, evidence.borrowerCount))) {
    return { error: "Run authorized mock credit for all borrowers on the current 1003 before ordering AUS." };
  }
  if (input.type === "runMockCredit" && input.borrowers === "all" && (applicationRevision === null || evidence.borrowerCount < 2)) {
    return { error: "Submit a joint 1003 before ordering mock credit for all borrowers." };
  }
  const borrowerCount = input.type === "runMockCredit" ? (input.borrowers === "all" ? evidence.borrowerCount : 1)
    : service === "Credit" ? previous?.borrowerCount ?? 1 : evidence.borrowerCount;

  const result = mockResult(service, retry ? "eligible" : input.scenario);
  const authorization = input.type === "runMockCredit" ? { reference: `MOCK-AUTH-${attemptId.toUpperCase()}`,
    recordedBy: staff?.email || "Demo loan officer", recordedAt: now } : retry ? previous?.authorization : undefined;
  recordAttempt(db, { id: attemptId, loanId, service, result, creditId, applicationRevision, authorization, requestKey, borrowerCount,
    ...(retry ? { retryOf: input.previousId, batchId: previous?.batchId } : {}) }, staff, now);
  if (result.status === unconfirmedMockOrder) return { message: "Mock response missing. Check the original result in Credit & AUS." };
  return { message: result.status === "Failed" ? "Mock request failed. Retry from Credit & AUS." : `Mock ${service === "Credit" ? "credit report" : service + " findings"} ready for review.` };
}

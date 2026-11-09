import { z } from "zod";
import { addApplicationActivity } from "./applications";
import { ausMethods, creditAusServices, mockRunMatchesApplication, type MockCreditAuthorization, type MockCreditAusResult, type MockCreditAusRun } from "./credit-aus-model";
import type { StaffIdentity } from "./staff-store";
import type { SqlValue, Store } from "./store";

const loanId = z.string().min(1).max(100);
const revision = z.number().int().nonnegative();
const attempt = { attemptId: z.uuid(), previousId: z.uuid().nullable() };
const fields = { loanId, ...attempt, applicationRevision: revision.nullable().optional() };
const ausScenario = z.enum(["eligible", "review", "failure"]);
export const mockCreditInput = z.object({
  ...fields, type: z.literal("runMockCredit"), authorized: z.literal(true),
  scenario: z.enum(["ready", "failure"]),
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
type SingleOrderInput = z.infer<typeof mockCreditInput | typeof mockAusInput | typeof mockRetryInput>;
type PairedOrderInput = z.infer<typeof mockPairedAusInput>;
type MockInput = SingleOrderInput | PairedOrderInput;

type RunRow = Record<string, SqlValue>;

function readRun(row: RunRow): MockCreditAusRun {
  return {
    id: String(row.id), loanId: String(row.loanId), service: row.service as MockCreditAusRun["service"],
    reference: String(row.reference), creditId: row.creditId as string | null, retryOf: row.retryOf as string | null,
    requestedBy: String(row.requestedBy), requestedAt: String(row.requestedAt), result: JSON.parse(String(row.result)),
    applicationRevision: typeof row.applicationRevision === "number" ? row.applicationRevision : null,
    ...(typeof row.authorization === "string" ? { authorization: JSON.parse(row.authorization) as MockCreditAuthorization } : {}),
    ...(typeof row.batchId === "string" ? { batchId: row.batchId } : {}),
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

function mockResult(service: MockCreditAusRun["service"], scenario: "ready" | "eligible" | "review" | "failure"): MockCreditAusResult {
  if (scenario === "failure") return { status: "Failed", reason: `The mock ${service === "Credit" ? "credit provider" : service + " service"} timed out. Retry the request.` };
  if (service === "Credit") return { status: "Report ready", score: 742 };
  const review = scenario === "review";
  return { status: "Findings ready", recommendation: review ? "Review required" : "Eligible sample", findings: findings[service][review ? "review" : "eligible"] };
}

type Attempt = {
  id: string; loanId: string; service: MockCreditAusRun["service"]; result: MockCreditAusResult;
  creditId: string | null; retryOf?: string; batchId?: string; applicationRevision: number | null;
  authorization?: MockCreditAuthorization; requestKey: string;
};

function recordAttempt(db: Store, order: Attempt, staff: StaffIdentity | null, now: string) {
  const { id, loanId, service, result, creditId, retryOf, batchId, applicationRevision, authorization, requestKey } = order;
  const reference = `MOCK-${service.toUpperCase()}-${id.toUpperCase()}`;
  db.prepare(`INSERT INTO mock_credit_aus_runs
    (id, loanId, service, reference, creditId, retryOf, requestedBy, requestedAt, result, applicationRevision, authorization, batchId, requestKey)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, loanId, service, reference, creditId, retryOf ?? null, staff?.name.slice(0, 160) || "Demo loan officer", now,
      JSON.stringify(result), applicationRevision, authorization ? JSON.stringify(authorization) : null, batchId ?? null, requestKey);
  const label = service === "Credit" ? "credit" : service;
  const action = retryOf ? `Retried mock ${label}` : `Ran mock ${label}${service === "Credit" ? " with demo authorization" : ""}`;
  addApplicationActivity(db, loanId, `${action} · ${result.status} · ${reference}${batchId ? ` · Paired run ${batchId}` : ""}`, now);
}

function submittedRevision(db: Store, loanId: string) {
  const row = db.prepare("SELECT revision FROM applications WHERE loanId = ? AND submittedAt IS NOT NULL").get(loanId);
  return typeof row?.revision === "number" ? row.revision : null;
}

const changedApplication = "The submitted 1003 changed. Refresh Credit & AUS and start a new request.";
const changedOrder = "A newer request is on this loan. Refresh Credit & AUS and try again.";
const reusedAttempt = "Refresh the workbench before placing a new request.";

function runPairedAus(db: Store, input: PairedOrderInput, staff: StaffIdentity | null, now: string) {
  const { loanId, applicationRevision, creditId, batchId, orders } = input;
  const requestKey = JSON.stringify([loanId, applicationRevision, creditId, ...ausMethods.map((method) => {
    const { attemptId, previousId, scenario } = orders[method];
    return [method, attemptId, previousId, scenario];
  })]);
  const prior = db.prepare("SELECT requestKey FROM mock_credit_aus_runs WHERE batchId = ? AND retryOf IS NULL").all(batchId);
  if (prior.length) return prior.length === 2 && prior.every((row) => row.requestKey === requestKey)
    ? { message: "This paired mock request is already on the loan." } : { error: reusedAttempt };
  if (submittedRevision(db, loanId) !== applicationRevision) return { error: changedApplication };
  const credit = latestRun(db, loanId, "Credit");
  if (credit?.result.status !== "Report ready" || credit.id !== creditId || !credit.authorization || !mockRunMatchesApplication(credit, applicationRevision)) {
    return { error: "Run authorized mock credit for the current submitted 1003 before running both services." };
  }
  for (const method of ausMethods) {
    if ((latestRun(db, loanId, method)?.id ?? null) !== orders[method].previousId) return { error: changedOrder };
    if (db.prepare("SELECT 1 FROM mock_credit_aus_runs WHERE id = ?").get(orders[method].attemptId)) return { error: reusedAttempt };
  }
  const results = ausMethods.map((service) => {
    const { attemptId, scenario } = orders[service];
    const result = mockResult(service, scenario);
    recordAttempt(db, { id: attemptId, loanId, service, result, creditId, applicationRevision, batchId, requestKey }, staff, now);
    return `${service} ${result.status === "Failed" ? "failed" : "findings ready"}`;
  });
  return { message: `Mock ${results.join(" · ")}. Review each service in Credit & AUS.` };
}

// Called inside the workspace mutation so all orders and their activity entries commit together.
export function runMockCreditAus(db: Store, input: MockInput, staff: StaffIdentity | null, now: string) {
  if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(input.loanId)) return { error: "This loan no longer exists." };
  if (input.type === "runMockPairedAus") return runPairedAus(db, input, staff, now);
  const { loanId, attemptId, previousId } = input;
  const service = input.type === "runMockCredit" ? "Credit" : input.type === "runMockAus" ? input.method : input.service;
  const requestKey = JSON.stringify(input);
  const repeated = db.prepare("SELECT loanId, service, requestKey, batchId, retryOf FROM mock_credit_aus_runs WHERE id = ?").get(attemptId);
  if (repeated) return repeated.loanId === loanId && repeated.service === service && (!repeated.batchId || !!repeated.retryOf) &&
    (repeated.requestKey === null || repeated.requestKey === requestKey) ? { message: "This mock request is already on the loan." } : { error: reusedAttempt };
  const applicationRevision = submittedRevision(db, loanId);
  if (input.applicationRevision !== undefined && input.applicationRevision !== applicationRevision) return { error: changedApplication };
  const previous = latestRun(db, loanId, service);
  if ((previous?.id ?? null) !== previousId) return { error: changedOrder };

  const retry = input.type === "retryMockCreditAus";
  if (retry && previous?.result.status !== "Failed") return { error: "Select the latest failed request to retry." };
  if (retry && previous && !mockRunMatchesApplication(previous, applicationRevision)) return { error: changedApplication };
  const credit = service === "Credit" ? null : latestRun(db, loanId, "Credit");
  const creditId = input.type === "runMockAus" ? input.creditId : previous?.creditId ?? null;
  if (service !== "Credit" && (credit?.result.status !== "Report ready" || credit.id !== creditId || !mockRunMatchesApplication(credit, applicationRevision))) {
    return { error: "Run mock AUS using the current mock credit report." };
  }

  const result = mockResult(service, retry ? "eligible" : input.scenario);
  const authorization = input.type === "runMockCredit" ? { reference: `MOCK-AUTH-${attemptId.toUpperCase()}`,
    recordedBy: staff?.email || "Demo loan officer", recordedAt: now } : retry ? previous?.authorization : undefined;
  recordAttempt(db, { id: attemptId, loanId, service, result, creditId, applicationRevision, authorization, requestKey,
    ...(retry ? { retryOf: input.previousId, batchId: previous?.batchId } : {}) }, staff, now);
  return { message: result.status === "Failed" ? "Mock request failed. Retry from Credit & AUS." : `Mock ${service === "Credit" ? "credit report" : service + " findings"} ready for review.` };
}

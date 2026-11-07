import { z } from "zod";
import { addApplicationActivity } from "./applications";
import { ausMethods, creditAusServices, type MockCreditAusResult, type MockCreditAusRun } from "./credit-aus-model";
import type { StaffIdentity } from "./staff-store";
import type { SqlValue, Store } from "./store";

const fields = { loanId: z.string().min(1).max(100), attemptId: z.uuid(), previousId: z.uuid().nullable() };
export const mockCreditInput = z.object({
  ...fields, type: z.literal("runMockCredit"), authorized: z.literal(true),
  scenario: z.enum(["ready", "failure"]),
});
export const mockAusInput = z.object({
  ...fields, type: z.literal("runMockAus"), method: z.enum(ausMethods), creditId: z.uuid(),
  scenario: z.enum(["eligible", "review", "failure"]),
});
export const mockRetryInput = z.object({
  ...fields, type: z.literal("retryMockCreditAus"), service: z.enum(creditAusServices), previousId: z.uuid(),
});
type MockInput = z.infer<typeof mockCreditInput | typeof mockAusInput | typeof mockRetryInput>;

type RunRow = Record<string, SqlValue>;

function readRun(row: RunRow): MockCreditAusRun {
  return {
    id: String(row.id), loanId: String(row.loanId), service: row.service as MockCreditAusRun["service"],
    reference: String(row.reference), creditId: row.creditId as string | null, retryOf: row.retryOf as string | null,
    requestedBy: String(row.requestedBy), requestedAt: String(row.requestedAt), result: JSON.parse(String(row.result)),
  };
}

export function mockCreditAusRuns(db: Store) {
  return db.prepare("SELECT * FROM mock_credit_aus_runs ORDER BY rowid DESC").all().map(readRun);
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

// Called inside the workspace mutation so the attempt and activity entry commit together.
export function runMockCreditAus(db: Store, input: MockInput, staff: StaffIdentity | null, now: string) {
  const { loanId, attemptId, previousId } = input;
  if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(loanId)) return { error: "This loan no longer exists." };
  const service = input.type === "runMockCredit" ? "Credit" : input.type === "runMockAus" ? input.method : input.service;
  const repeated = db.prepare("SELECT loanId, service FROM mock_credit_aus_runs WHERE id = ?").get(attemptId);
  if (repeated) return repeated.loanId === loanId && repeated.service === service ? { message: "This mock request is already on the loan." }
    : { error: "Refresh the workbench before placing a new request." };
  const previous = latestRun(db, loanId, service);
  if ((previous?.id ?? null) !== previousId) return { error: "A newer request is on this loan. Refresh Credit & AUS and try again." };

  const retry = input.type === "retryMockCreditAus";
  if (retry && previous?.result.status !== "Failed") return { error: "Select the latest failed request to retry." };
  const credit = service === "Credit" ? null : latestRun(db, loanId, "Credit");
  const creditId = input.type === "runMockAus" ? input.creditId : previous?.creditId ?? null;
  if (service !== "Credit" && (credit?.result.status !== "Report ready" || credit.id !== creditId)) {
    return { error: "Run mock AUS using the current mock credit report." };
  }

  const result = mockResult(service, retry ? "eligible" : input.scenario);
  const reference = `MOCK-${service.toUpperCase()}-${attemptId.toUpperCase()}`;
  db.prepare(`INSERT INTO mock_credit_aus_runs
    (id, loanId, service, reference, creditId, retryOf, requestedBy, requestedAt, result)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(attemptId, loanId, service, reference, creditId, retry ? previousId : null, staff?.name.slice(0, 160) || "Demo loan officer", now, JSON.stringify(result));
  const label = service === "Credit" ? "credit" : service;
  const action = retry ? `Retried mock ${label}` : `Ran mock ${label}${service === "Credit" ? " with demo authorization" : ""}`;
  addApplicationActivity(db, loanId, `${action} · ${result.status} · ${reference}`, now);
  return { message: result.status === "Failed" ? "Mock request failed. Retry from Credit & AUS." : `Mock ${service === "Credit" ? "credit report" : service + " findings"} ready for review.` };
}

export const creditAusServices = ["Credit", "DU", "LPA"] as const;
export type CreditAusService = (typeof creditAusServices)[number];
export const ausMethods = ["DU", "LPA"] as const;
export type AusMethod = (typeof ausMethods)[number];
export const unconfirmedMockOrder = "Awaiting confirmation";
const missingResponseScenarios = [
  ["uncertain", "Missing response · Accepted"],
  ["uncertain-rejected", "Missing response · Rejected"],
  ["uncertain-unavailable", "Missing response · Inconclusive first"],
] as const;
export const mockCreditScenarios = [
  ["ready", "Report ready"], ["failure", "Confirmed failure"], ...missingResponseScenarios,
] as const;
export const mockAusScenarios = [
  ["eligible", "Eligible sample"], ["review", "Review required"], ["failure", "Confirmed failure"], ...missingResponseScenarios,
] as const;
export const creditAusAttemptTargetPrefix = "credit-aus-order-";

export function creditAusAttemptTarget(id: string) {
  return `${creditAusAttemptTargetPrefix}${id}`;
}

export interface MockCreditAuthorization {
  reference: string;
  recordedBy: string;
  recordedAt: string;
}

export type MockCreditAusResult =
  | { status: "Report ready"; score: number }
  | { status: "Findings ready"; recommendation: "Eligible sample" | "Review required"; findings: string[] }
  | { status: typeof unconfirmedMockOrder }
  | { status: "Failed"; reason: string };

export interface MockCreditAusRun {
  id: string;
  loanId: string;
  service: CreditAusService;
  reference: string;
  creditId: string | null;
  retryOf: string | null;
  requestedBy: string;
  requestedAt: string;
  applicationRevision?: number | null;
  authorization?: MockCreditAuthorization;
  batchId?: string;
  borrowerCount?: number;
  reconciledAt?: string;
  lastCheckedAt?: string;
  result: MockCreditAusResult;
}

export function submittedApplicationRevision(application?: { submittedAt: string | null; revision: number }) {
  return application?.submittedAt ? application.revision : null;
}

export function mockRunMatchesApplication(run: MockCreditAusRun, revision: number | null) {
  return (run.applicationRevision ?? null) === revision;
}

export function creditCoversApplication(run: MockCreditAusRun, revision: number | null, borrowerCount: number) {
  return run.result.status === "Report ready" && !!run.authorization &&
    mockRunMatchesApplication(run, revision) && (run.borrowerCount ?? 1) === borrowerCount;
}

export function creditApplicantCount(draft?: { urla: { additional: readonly unknown[] } } | null) {
  return 1 + (draft?.urla.additional.length ?? 0);
}

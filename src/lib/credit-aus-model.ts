export const creditAusServices = ["Credit", "DU", "LPA"] as const;
export type CreditAusService = (typeof creditAusServices)[number];
export const ausMethods = ["DU", "LPA"] as const;
export type AusMethod = (typeof ausMethods)[number];
export const mockAusScenarios = [
  ["eligible", "Eligible sample"], ["review", "Review required"], ["failure", "Temporary failure"],
] as const;

export interface MockCreditAuthorization {
  reference: string;
  recordedBy: string;
  recordedAt: string;
}

export type MockCreditAusResult =
  | { status: "Report ready"; score: number }
  | { status: "Findings ready"; recommendation: "Eligible sample" | "Review required"; findings: string[] }
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
  result: MockCreditAusResult;
}

export function submittedApplicationRevision(application?: { submittedAt: string | null; revision: number }) {
  return application?.submittedAt ? application.revision : null;
}

export function mockRunMatchesApplication(run: MockCreditAusRun, revision: number | null) {
  return (run.applicationRevision ?? null) === revision;
}

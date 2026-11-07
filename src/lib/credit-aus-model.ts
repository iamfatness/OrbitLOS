export const creditAusServices = ["Credit", "DU", "LPA"] as const;
export type CreditAusService = (typeof creditAusServices)[number];
export const ausMethods = ["DU", "LPA"] as const;
export type AusMethod = (typeof ausMethods)[number];

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
  result: MockCreditAusResult;
}

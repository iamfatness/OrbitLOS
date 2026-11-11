import type { MaintenanceState } from "./workspace-maintenance-model";

export const supportSampleLimit = 200;
export const supportWorkPageSize = 12;
export const supportWorkGroups = ["handoffs", "requests", "operations"] as const;
export type SupportWorkGroup = (typeof supportWorkGroups)[number];
export const supportWorkTitles: Record<SupportWorkGroup, string> = {
  handoffs: "Processing handoffs", requests: "Lender requests", operations: "Lender operations",
};
export function supportWorkGroup(value: unknown): SupportWorkGroup | undefined {
  return supportWorkGroups.find(group => group === value);
}
export function supportWorkOffset(value: unknown) {
  const offset = Number(value ?? 0);
  return Number.isSafeInteger(offset) && offset >= 0 && offset < supportSampleLimit && offset % supportWorkPageSize === 0 ? offset : 0;
}
export const supportWorkPaused = "Loan records are available after the workspace reopens.";
export const supportWorkChanged = "The report changed. Refresh it before opening the work behind these counts.";
export const supportUnavailable = "Support report is unavailable. Refresh maintenance status and try again.";
export const supportChanged = "The workspace changed since this preview. Refresh the report before downloading.";

type Sample = { sampled: number; limited: boolean };
export type SupportRequestCounts = Sample & { awaitingOutcome: number; needsReconciliation: number; unsuccessful: number };
export type SupportRecoveryState = Pick<MaintenanceState, "mode" | "revision"> & {
  pendingRestore: boolean; pendingReplay: boolean; pendingEditReceipt: boolean;
};
export type PilotSupportSnapshot = {
  recovery: SupportRecoveryState;
  processing: Sample & { awaitingAcceptance: number; returnedToOfficer: number; unassigned: number };
  lenderRequests: SupportRequestCounts;
  lenderOperations: SupportRequestCounts;
};
export type PilotSupportPreview = { checkedAt: string; fingerprint: string; snapshot: PilotSupportSnapshot };
export type SupportWorkPage = {
  group: SupportWorkGroup; offset: number; total: number; next: number | null;
  items: Array<{ id: string; loanId: string; name: string; status: string; at: string }>;
};

export function supportReportUrl(brokerageId: string, group: SupportWorkGroup, offset: number) {
  return `/workspace-maintenance?${new URLSearchParams({ brokerage: brokerageId, supportWork: group, offset: String(offset) })}#pilot-support-report`;
}

export function supportLoanUrl(brokerageId: string, loanId: string, group: SupportWorkGroup, offset: number) {
  return `/workspace?${new URLSearchParams({ brokerage: brokerageId, supportLoan: loanId, supportWork: group, offset: String(offset) })}`;
}

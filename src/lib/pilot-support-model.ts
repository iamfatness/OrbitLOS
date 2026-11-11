import type { MaintenanceState } from "./workspace-maintenance-model";

export const supportSampleLimit = 200;
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

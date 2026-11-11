import type { Store } from "./store";
import { activeProcessingLoan } from "./loan-processing";
import { maintenanceState, pendingRecoveryReplay, pendingWorkspaceRestore } from "./workspace-maintenance";
import { supportSampleLimit, type PilotSupportSnapshot, type SupportRecoveryState, type SupportRequestCounts } from "./pilot-support-model";

export function readSupportRecovery(db: Store, brokerageId: string): SupportRecoveryState {
  const { mode, revision } = maintenanceState(db, brokerageId);
  return {
    mode, revision,
    pendingRestore: pendingWorkspaceRestore(db, brokerageId),
    pendingReplay: pendingRecoveryReplay(db, brokerageId),
    pendingEditReceipt: !!db.prepare(`SELECT 1 FROM brokerage_recovery_edits
      WHERE brokerageId = ? AND state = 'Pending' LIMIT 1`).get(brokerageId),
  };
}

function requestCounts(rows: Record<string, unknown>[], source: "request" | "operation"): SupportRequestCounts {
  const counts = { sampled: Math.min(rows.length, supportSampleLimit), limited: rows.length > supportSampleLimit,
    awaitingOutcome: 0, needsReconciliation: 0, unsuccessful: 0 };
  for (const { state, action } of rows.slice(0, supportSampleLimit)) {
    if (action === "reconcile-request") continue;
    if (state === "Dispatching" || (source === "operation" && (state === "Prepared" || state === "Acknowledged"))) counts.awaitingOutcome++;
    if (state === "Unknown") counts.needsReconciliation++;
    if (state === "Failed" || state === "Rejected") counts.unsuccessful++;
  }
  return counts;
}

export function readPilotSupport(db: Store, recovery: SupportRecoveryState): PilotSupportSnapshot {
  // Select only fields that can be counted. Names, record keys, and request bodies never enter the report.
  const recent = supportSampleLimit + 1;
  const handoffs = db.prepare(`SELECT processing.status, processing.processorEmail IS NOT NULL AS assigned,
    (${activeProcessingLoan}) AS active FROM
    (SELECT loanId, status, processorEmail, updatedAt FROM loan_processing ORDER BY updatedAt DESC, loanId DESC LIMIT ?) processing
    JOIN loans loan ON loan.id = processing.loanId ORDER BY processing.updatedAt DESC, processing.loanId DESC`).all(recent);
  const processing = { sampled: Math.min(handoffs.length, supportSampleLimit), limited: handoffs.length > supportSampleLimit,
    awaitingAcceptance: 0, returnedToOfficer: 0, unassigned: 0 };
  for (const row of handoffs.slice(0, supportSampleLimit)) {
    if (!row.active) continue;
    if (!row.assigned) processing.unassigned++;
    else if (row.status === "Ready for processing") processing.awaitingAcceptance++;
    else if (row.status === "Returned to LO") processing.returnedToOfficer++;
  }
  return {
    recovery, processing,
    lenderRequests: requestCounts(db.prepare("SELECT state, action FROM uwm_live_requests ORDER BY rowid DESC LIMIT ?").all(recent), "request"),
    lenderOperations: requestCounts(db.prepare("SELECT state FROM uwm_operations ORDER BY rowid DESC LIMIT ?").all(recent), "operation"),
  };
}

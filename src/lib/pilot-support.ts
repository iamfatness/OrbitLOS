import type { Store } from "./store";
import { activeProcessingLoan } from "./loan-processing";
import { maintenanceState, pendingRecoveryReplay, pendingWorkspaceRestore } from "./workspace-maintenance";
import { supportSampleLimit, supportWorkPageSize, type PilotSupportSnapshot, type SupportRecoveryState, type SupportRequestCounts,
  type SupportWorkGroup, type SupportWorkPage } from "./pilot-support-model";

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

const handoffLabels = {
  awaitingAcceptance: "Waiting for acceptance", returnedToOfficer: "Returned to loan officer", unassigned: "Missing processor assignment",
};
const requestLabels = {
  awaitingOutcome: "Awaiting outcome", needsReconciliation: "Needs reconciliation", unsuccessful: "Failed or rejected",
};

function handoffCategory(row: Record<string, unknown>): keyof typeof handoffLabels | undefined {
  if (!row.active) return;
  if (!row.assigned) return "unassigned";
  if (row.status === "Ready for processing") return "awaitingAcceptance";
  if (row.status === "Returned to LO") return "returnedToOfficer";
}

function requestCategory({ state, action }: Record<string, unknown>, source: "requests" | "operations"): keyof typeof requestLabels | undefined {
  if (action === "reconcile-request") return;
  if (state === "Dispatching" || (source === "operations" && (state === "Prepared" || state === "Acknowledged"))) return "awaitingOutcome";
  if (state === "Unknown") return "needsReconciliation";
  if (state === "Failed" || state === "Rejected") return "unsuccessful";
}

const handoffRows = `FROM
  (SELECT loanId, status, processorEmail, updatedAt FROM loan_processing ORDER BY updatedAt DESC, loanId DESC LIMIT ?) processing
  JOIN loans loan ON loan.id = processing.loanId`;
const handoffOrder = "ORDER BY processing.updatedAt DESC, processing.loanId DESC";
const handoffFields = `processing.status, processing.processorEmail IS NOT NULL AS assigned, (${activeProcessingLoan}) AS active`;
const requestSources = { requests: "uwm_live_requests", operations: "uwm_operations" } as const;

function requestCounts(rows: Record<string, unknown>[], source: "requests" | "operations"): SupportRequestCounts {
  const counts = { sampled: Math.min(rows.length, supportSampleLimit), limited: rows.length > supportSampleLimit,
    awaitingOutcome: 0, needsReconciliation: 0, unsuccessful: 0 };
  for (const row of rows.slice(0, supportSampleLimit)) {
    const category = requestCategory(row, source);
    if (category) counts[category]++;
  }
  return counts;
}

export function readPilotSupport(db: Store, recovery: SupportRecoveryState): PilotSupportSnapshot {
  // Select only fields that can be counted. Names, record keys, and request bodies never enter the report.
  const recent = supportSampleLimit + 1;
  const handoffs = db.prepare(`SELECT ${handoffFields} ${handoffRows} ${handoffOrder}`).all(recent);
  const processing = { sampled: Math.min(handoffs.length, supportSampleLimit), limited: handoffs.length > supportSampleLimit,
    awaitingAcceptance: 0, returnedToOfficer: 0, unassigned: 0 };
  for (const row of handoffs.slice(0, supportSampleLimit)) {
    const category = handoffCategory(row);
    if (category) processing[category]++;
  }
  return {
    recovery, processing,
    lenderRequests: requestCounts(db.prepare("SELECT state, action FROM uwm_live_requests ORDER BY rowid DESC LIMIT ?").all(recent), "requests"),
    lenderOperations: requestCounts(db.prepare("SELECT state FROM uwm_operations ORDER BY rowid DESC LIMIT ?").all(recent), "operations"),
  };
}

export function readPilotSupportWork(db: Store, group: SupportWorkGroup, offset: number): SupportWorkPage {
  const rows = group === "handoffs" ? db.prepare(`SELECT ${handoffFields}, loan.id, loan.id AS loanId, processing.updatedAt AS at, contact.name
    ${handoffRows} JOIN contacts contact ON contact.id = loan.contactId ${handoffOrder}`).all(supportSampleLimit) :
    db.prepare(`SELECT request.id, request.loanId, request.state, request.action, request.updatedAt AS at, contact.name
      FROM (SELECT rowid AS sequence, id, loanId, state, ${group === "requests" ? "action" : "kind AS action"}, updatedAt
        FROM ${requestSources[group]} ORDER BY rowid DESC LIMIT ?) request
      JOIN loans loan ON loan.id = request.loanId JOIN contacts contact ON contact.id = loan.contactId
      ORDER BY request.sequence DESC`).all(supportSampleLimit);
  const matches = rows.flatMap(row => {
    const handoff = group === "handoffs" ? handoffCategory(row) : undefined;
    const request = group === "handoffs" ? undefined : requestCategory(row, group);
    if (!handoff && !request) return [];
    const status = handoff ? handoffLabels[handoff] : `${requestLabels[request!]} · ${String(row.action).replaceAll("-", " ")}`;
    return [{ id: String(row.id), loanId: String(row.loanId), name: String(row.name), status, at: String(row.at) }];
  });
  const start = Math.min(offset, Math.max(0, Math.floor((matches.length - 1) / supportWorkPageSize) * supportWorkPageSize));
  const end = start + supportWorkPageSize;
  return { group, offset: start, total: matches.length, next: end < matches.length ? end : null, items: matches.slice(start, end) };
}

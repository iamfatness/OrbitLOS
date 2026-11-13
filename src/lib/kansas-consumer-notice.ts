import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { initializeStateLoanEvidence, stateLoanEvidenceWork } from "./state-loan-evidence";
import { kansasNoticeDates, reviewKansasNotice, type KansasNoticeRequest } from "./kansas-consumer-notice-model";

const table = "compliance_kansas_notice_versions";
export function initializeKansasNotice(db: Store) {
  initializeStateLoanEvidence(db, table);
}

export function kansasNoticeWork(db: Store, input: KansasNoticeRequest, staff: WorkspaceStaff, now: string) {
  return stateLoanEvidenceWork(db, input, staff, now, {
    table, kind: "kansasNotice", name: "Kansas notice",
    unavailable: "Kansas notice evidence is available on accessible Kansas pilot applications.",
    dates: kansasNoticeDates, zone: facts => facts.zone, review: reviewKansasNotice,
  });
}

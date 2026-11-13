import { californiaMldsDates, reviewCaliforniaMlds, type CaliforniaMldsRequest } from "./california-mlds-model";
import { initializeStateLoanEvidence, stateLoanEvidenceWork } from "./state-loan-evidence";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const table = "compliance_california_mlds_versions";
const zone = "America/Los_Angeles";

export function initializeCaliforniaMlds(db: Store) {
  initializeStateLoanEvidence(db, table);
}

export function californiaMldsWork(db: Store, input: CaliforniaMldsRequest, staff: WorkspaceStaff, now: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(now));
  return stateLoanEvidenceWork(db, input, staff, now, {
    table, kind: "californiaMlds", name: "California mortgage disclosure",
    unavailable: "California mortgage disclosure evidence is available on accessible California pilot applications.",
    dates: californiaMldsDates, zone: () => zone, review: facts => reviewCaliforniaMlds(facts, today),
  });
}

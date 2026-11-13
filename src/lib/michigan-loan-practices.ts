import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { initializeStateLoanEvidence, stateLoanEvidenceWork } from "./state-loan-evidence";
import { reviewMichiganLoanPractices, type MichiganLoanPracticesRequest } from "./michigan-loan-practices-model";

const table = "compliance_michigan_loan_practices_versions";
export function initializeMichiganLoanPractices(db: Store) {
  initializeStateLoanEvidence(db, table);
}

export function michiganLoanPracticesWork(db: Store, input: MichiganLoanPracticesRequest, staff: WorkspaceStaff, now: string) {
  return stateLoanEvidenceWork(db, input, staff, now, {
    table, kind: "michiganLoanPractices", name: "Michigan loan practices",
    unavailable: "Michigan loan practices evidence is available on accessible Michigan pilot applications.",
    dates: facts => [facts.reviewedOn], zone: facts => facts.zone, review: reviewMichiganLoanPractices,
  });
}

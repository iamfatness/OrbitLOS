import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { initializeStateLoanEvidence, stateLoanEvidenceWork } from "./state-loan-evidence";
import { refinanceBenefitDates, reviewRefinanceBenefit, type RefinanceBenefitRequest } from "./state-refinance-benefit-model";

const table = "compliance_refinance_benefit_versions";
export function initializeStateRefinanceBenefit(db: Store) {
  initializeStateLoanEvidence(db, table);
}

export function stateRefinanceBenefitWork(db: Store, input: RefinanceBenefitRequest, staff: WorkspaceStaff, now: string) {
  return stateLoanEvidenceWork(db, input, staff, now, {
    table, kind: "stateRefinanceBenefit", name: "Refinance benefit", purpose: "Refinance",
    unavailable: "Refinance benefit evidence is available on accessible Minnesota and Nebraska pilot refinances.",
    dates: refinanceBenefitDates, zone: facts => facts.state === "MN" ? "America/Chicago" : facts.zone,
    review: reviewRefinanceBenefit,
  });
}

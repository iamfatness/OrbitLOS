import { brokerAgreementEvents, reviewBrokerAgreement, type BrokerAgreementRequest } from "./state-broker-agreement-model";
import { initializeStateLoanEvidence, stateLoanEvidenceWork } from "./state-loan-evidence";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const table = "compliance_broker_agreement_versions";
export function initializeStateBrokerAgreement(db: Store) {
  initializeStateLoanEvidence(db, table);
}

export function stateBrokerAgreementWork(db: Store, input: BrokerAgreementRequest, staff: WorkspaceStaff, now: string) {
  return stateLoanEvidenceWork(db, input, staff, now, {
    table, kind: "stateBrokerAgreement", name: "Agreement",
    unavailable: "Brokerage agreement evidence is available on accessible Indiana, Illinois and Wisconsin pilot applications.",
    dates: facts => brokerAgreementEvents(facts).map(event => event?.on), zone: facts => facts.zone, review: reviewBrokerAgreement,
  });
}

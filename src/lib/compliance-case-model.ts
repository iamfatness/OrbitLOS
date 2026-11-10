export const complianceCaseKinds = ["Requirement review", "Control gap", "Operational finding"] as const;
export const complianceCaseStatuses = ["Open", "In progress", "Awaiting evidence", "Awaiting review"] as const;
export const complianceWorkUnavailable = "This compliance work is unavailable.";
export const complianceTarget = "loan-compliance";
export const complianceCaseTarget = (caseId: string) => `${complianceTarget}-${caseId}`;

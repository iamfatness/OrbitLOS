export const complianceCaseKinds = ["Requirement review", "Control gap", "Operational finding"] as const;
export const complianceCaseStatuses = ["Open", "In progress", "Awaiting evidence", "Awaiting review"] as const;
export const complianceWorkUnavailable = "This compliance work is unavailable.";
export const complianceTarget = "loan-compliance";
export const complianceCaseTarget = (caseId: string) => `${complianceTarget}-${caseId}`;

export const inventoryBuckets = ["Scope unknown", "Outside sample scope", "Sample package needed", "Sample review needed", "Sample review available"] as const;
export type InventoryBucket = (typeof inventoryBuckets)[number];

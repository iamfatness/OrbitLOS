import { z } from "zod";

import type { ObligationReviewBasis } from "./compliance-obligations-model";
import type { StateScopeFacts } from "./compliance-state-scope-model";
import { propertyStateCodes } from "./property-state";

export const licenseJurisdictions = propertyStateCodes;
const licenseJurisdiction = z.string().refine(state => licenseJurisdictions.includes(state));
export const licenseStatuses = ["Active", "Pending", "Expired", "Inactive", "Surrendered"] as const;
export const licenseFields = z.object({
  jurisdiction: licenseJurisdiction,
  licenseType: z.string().trim().min(2).max(120),
  licenseNumber: z.string().trim().min(1).max(80),
  status: z.enum(licenseStatuses),
  effectiveOn: z.iso.date().nullable(),
  expiresOn: z.iso.date().nullable(),
  evidence: z.string().trim().max(500),
});
export type LicenseFields = z.infer<typeof licenseFields>;
export const licenseHolderKinds = ["Company", "Branch", "Loan officer"] as const;
export const licenseHolder = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("Company") }),
  z.strictObject({ kind: z.literal("Branch"), id: z.uuid() }),
  z.strictObject({ kind: z.literal("Loan officer"), id: z.email().toLowerCase().max(254), accessRevision: z.int().nonnegative() }),
]);
export type LicenseHolder = z.infer<typeof licenseHolder>;
export type LicenseHolderChoice = { holder: Exclude<LicenseHolder, { kind: "Company" }>; label: string };
export const licenseRenewalLookahead = 30;
const licenseRenewalCursor = z.strictObject({ expiresOn: z.iso.date(), entityId: z.uuid(), licenseId: z.uuid() });
export type LicenseRenewalCursor = z.infer<typeof licenseRenewalCursor>;
export type LicenseRenewalTarget = Pick<LicenseRenewalCursor, "entityId" | "licenseId">;
export const licenseRenewalOwner = z.strictObject({ email: z.email().toLowerCase().max(254), accessRevision: z.int().nonnegative() });
export type LicenseRenewalOwner = z.infer<typeof licenseRenewalOwner>;
export type LicenseRenewalAssignment = LicenseRenewalOwner & { name: string; available: boolean };
export type LicenseRenewalItem = LicenseRenewalCursor & {
  entityName: string; jurisdiction: string; licenseType: string; licenseNumber: string;
  holderLabel: string; renewalOwner: LicenseRenewalAssignment | null; renewal: "Past expiration" | "Expires soon";
};
export type LicenseCoverageSummary = { currentCompanyStates: string[]; entityCount: number; entitiesWithoutCurrentCompanyRecords: number };
export type LicenseRenewalQueue = { kind: "licenseRenewals"; total: number; items: LicenseRenewalItem[]; next: LicenseRenewalCursor | null;
  coverage?: LicenseCoverageSummary };
export type ProgramLicense = LicenseFields & { id: string; revision: number; updatedAt: string; holder: LicenseHolder;
  holderLabel: string; holderAvailable: boolean; renewalOwner: LicenseRenewalAssignment | null; renewal: "Past expiration" | "Expires soon" | null };
export type LicenseRecordCounts = { current: number; expired: number; review: number };
export function countLicenseRecords(records: readonly (Pick<LicenseFields, "status" | "effectiveOn" | "expiresOn"> &
  { holderAvailable?: boolean })[], asOf: string): LicenseRecordCounts {
  const counts = { current: 0, expired: 0, review: 0 };
  for (const record of records) {
    if (record.status === "Expired" || (record.status === "Active" && record.expiresOn && record.expiresOn < asOf)) counts.expired++;
    else if (record.status === "Active" && record.holderAvailable !== false && (!record.effectiveOn || record.effectiveOn <= asOf)) counts.current++;
    else counts.review++;
  }
  return counts;
}
export type LicenseRegisterScope = {
  entityId: string; jurisdiction: string; holder: { kind: "Company" } | { kind: "Branch" | "Loan officer"; id: string };
  holderName: string; licenseId?: string;
};
export function inLicenseRegisterScope(license: ProgramLicense, scope: LicenseRegisterScope) {
  return license.jurisdiction === scope.jurisdiction && license.holder.kind === scope.holder.kind &&
    (!("id" in scope.holder) || ("id" in license.holder && license.holder.id === scope.holder.id));
}
export type LicenseStateCheck = { kind: "licenseStateCheck"; jurisdiction: string; asOf: string;
  assignment?: {
    officer: { name: string | null } | null;
    intakeBranchWithoutLink?: string;
    branches: { id: string; name: string; active: boolean; atIntake: boolean; officerAssigned?: boolean }[];
  };
  entities: { id: string; name: string; company: LicenseRecordCounts; officer?: LicenseRecordCounts;
    branches?: { id: string; counts: LicenseRecordCounts }[];
    singleRecords?: { company?: string; officer?: string; branches: Record<string, string> } }[] };

export type ProgramLicenses = { kind: "programLicenses"; entity: ProgramEntity; asOf: string; licenses: ProgramLicense[];
  holderChoices: LicenseHolderChoice[]; renewalOwners: (LicenseRenewalOwner & { name: string })[] };
export type LicenseHistory = { kind: "licenseHistory"; entries: { id: string; actor: string; at: string; action: string;
  note: string; evidence: string; expiresOn: string | null; status: string; renewalOwner: string | null | undefined }[]; more: boolean };
export const programCategories = ["Reporting preparation", "Training review", "Policy review", "Quality control", "License review", "Management review"] as const;
export const programStatuses = ["Planned", "In progress", "Awaiting evidence", "Awaiting review", "Completed"] as const;
export type StateReviewBasis = { jurisdiction: string; revision: number; entityName: string; facts: StateScopeFacts;
  source: { key: string; title: string; sourceUrl: string } | null };
export const programMonth = z.string().regex(/^(20\d{2})-(0[1-9]|1[0-2])$/);
const title = z.string().trim().min(3).max(160);
const note = z.string().trim().min(5).max(1500);
const change = { requestId: z.uuid() };
const scope = { entityId: z.uuid(), month: programMonth };
export const programRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("entities") }),
  z.strictObject({ operation: z.literal("ownerHome"), branchId: z.uuid().optional(), stateOffset: z.int().min(0).max(2500).optional() }),
  z.strictObject({ operation: z.literal("createEntity"), ...change, name: title, nmls: z.string().regex(/^\d{0,15}$/), scopeNote: note }),
  z.strictObject({ operation: z.literal("licenseRenewals"), scope: z.enum(["mine", "brokerage"]).optional(), after: licenseRenewalCursor.optional() }),
  z.strictObject({ operation: z.literal("licenseHistory"), entityId: z.uuid(), licenseId: z.uuid() }),
  z.strictObject({ operation: z.literal("licenses"), entityId: z.uuid() }),
  z.strictObject({ operation: z.literal("licenseStateCheck"), jurisdiction: licenseJurisdiction,
    assignment: z.strictObject({ leadId: z.uuid(), officerEmail: z.email().toLowerCase().max(254).nullable() }).optional() }),
  z.strictObject({ operation: z.literal("saveLicense"), ...change, entityId: z.uuid(), id: z.uuid(), revision: z.number().int().nonnegative(), ...licenseFields.shape, holder: licenseHolder.optional(),
    renewalOwner: licenseRenewalOwner.nullable().optional(), renewalNote: z.string().trim().max(500).optional() }),
  z.strictObject({ operation: z.literal("month"), ...scope }),
  z.strictObject({ operation: z.literal("schedule"), ...scope, ...change, title, category: z.enum(programCategories), ownerEmail: z.email(),
    internalTarget: z.iso.date(), instructions: note }),
  z.strictObject({ operation: z.literal("update"), ...scope, ...change, id: z.uuid(), expectedRevision: z.number().int().positive(),
    status: z.enum(programStatuses), ownerEmail: z.email(), internalTarget: z.iso.date(), note, evidence: z.string().trim().max(1500) }),
  z.strictObject({ operation: z.literal("reviewMonth"), ...scope, ...change, fingerprint: z.string().length(64), note }),
]);
export type ProgramRequest = z.infer<typeof programRequest>;
export type ProgramEntity = { id: string; name: string; nmls: string; scopeNote: string; createdAt: string };
export type ProgramItem = { id: string; title: string; category: typeof programCategories[number]; status: typeof programStatuses[number];
  ownerEmail: string; ownerRevision: number; internalTarget: string; instructions: string; evidence: string; revision: number;
  updatedAt: string; ownerAvailable: boolean; overdue: boolean; obligation?: ObligationReviewBasis; stateReview?: StateReviewBasis };
export type ProgramMonth = { kind: "programMonth"; entity: ProgramEntity; month: string; items: ProgramItem[]; fingerprint: string;
  owners: { email: string; name: string }[]; counts: { total: number; open: number; overdue: number; unavailableOwners: number };
  reviews: { id: string; actor: string; at: string; note: string; current: boolean; snapshot: string }[];
  history: { id: string; actor: string; at: string; action: string; note: string }[]; moreHistory: boolean;
  coverage: "Regulatory applicability not evaluated" };

export type StateScopeTarget = { entityId: string; jurisdiction: string };
export const stateScopePageSize = 5;
export type StateScopeSummary = StateScopeTarget & {
  entityName: string; revision: number;
  changes: ("Company details changed" | "License records changed" | "Research sources changed" | "License records were not captured")[];
};

export type ComplianceOwnerHomeData = {
  kind: "ownerHome"; branchId?: string; asOf: string; through: string;
  branches: { id: string; name: string; licenseCount: number; active: boolean }[];
  entityCount: number; companyLicenseCount: number; savedStateCount: number;
  stateScopes: { total: number; needsRecheck: number; items: StateScopeSummary[] };
  renewals: { total: number; items: (LicenseRenewalItem & { branchId: string | null })[] };
  reviews: { total: number; items: {
    id: string; entityId: string; entityName: string; month: string; title: string; internalTarget: string;
    status: ProgramItem["status"]; ownerName: string | null;
  }[] };
};

export type ProgramReviewTarget = { entityId: string; month: string; itemId: string };

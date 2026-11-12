import { z } from "zod";

export const licenseJurisdictions = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
export const licenseStatuses = ["Active", "Pending", "Expired", "Inactive", "Surrendered"] as const;
export const licenseFields = z.object({
  jurisdiction: z.string().refine(state => licenseJurisdictions.includes(state)),
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
export type ProgramLicense = LicenseFields & { id: string; revision: number; updatedAt: string; holder: LicenseHolder;
  holderLabel: string; holderAvailable: boolean; renewal: "Past expiration" | "Expires soon" | null };
export type ProgramLicenses = { kind: "programLicenses"; entity: ProgramEntity; licenses: ProgramLicense[]; holderChoices: LicenseHolderChoice[] };
export const programCategories = ["Reporting preparation", "Training review", "Policy review", "Quality control", "License review", "Management review"] as const;
export const programStatuses = ["Planned", "In progress", "Awaiting evidence", "Awaiting review", "Completed"] as const;
export const programMonth = z.string().regex(/^(20\d{2})-(0[1-9]|1[0-2])$/);
const title = z.string().trim().min(3).max(160);
const note = z.string().trim().min(5).max(1500);
const change = { requestId: z.uuid() };
const scope = { entityId: z.uuid(), month: programMonth };
export const programRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("entities") }),
  z.strictObject({ operation: z.literal("createEntity"), ...change, name: title, nmls: z.string().regex(/^\d{0,15}$/), scopeNote: note }),
  z.strictObject({ operation: z.literal("licenses"), entityId: z.uuid() }),
  z.strictObject({ operation: z.literal("saveLicense"), ...change, entityId: z.uuid(), id: z.uuid(), revision: z.number().int().nonnegative(), ...licenseFields.shape, holder: licenseHolder.optional() }),
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
  updatedAt: string; ownerAvailable: boolean; overdue: boolean };
export type ProgramMonth = { kind: "programMonth"; entity: ProgramEntity; month: string; items: ProgramItem[]; fingerprint: string;
  owners: { email: string; name: string }[]; counts: { total: number; open: number; overdue: number; unavailableOwners: number };
  reviews: { id: string; actor: string; at: string; note: string; current: boolean; snapshot: string }[];
  history: { id: string; actor: string; at: string; action: string; note: string }[]; moreHistory: boolean;
  coverage: "Regulatory applicability not evaluated" };

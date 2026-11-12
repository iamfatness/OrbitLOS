import { z } from "zod";
import type { BorrowerPortalPreferences } from "./borrower-channel-model";
import type { BorrowerLoanStatus } from "./document-model";
import type { DocumentUploadMode } from "./document-files-model";
import { blankBorrower, blankUrla, normalizeUrla, sampleUrla, urlaDetailsSchema, type LenderDetails } from "./urla";
import type { StaffJointApplication } from "./joint-application-model";

const shortText = z.string().trim().max(160);
const dollars = z.string().trim().regex(/^\d{0,10}(?:\.\d{1,2})?$/).refine((value) => Number(value) <= 1_000_000_000);

export function requestedLoanAmount(value: unknown) {
  const parsed = dollars.safeParse(value);
  const amount = parsed.success ? Number(parsed.data) : 0;
  return amount > 0 ? amount : null;
}
const yesNo = z.enum(["", "Yes", "No"]);
const addressLocation = z.object({
  unit: z.string().trim().max(30), city: z.string().trim().max(100),
  state: z.string().trim().max(100), zip: z.string().trim().max(20),
  country: z.string().trim().max(100).optional(),
});

export type AddressLocation = z.infer<typeof addressLocation>;
export type AddressStreet = "currentAddress" | "priorAddress" | "propertyAddress";
export type AddressDetails = "currentLocation" | "priorLocation" | "propertyLocation";
export const usZip = /^\d{5}(?:-\d{4})?$/;
const usStates = new Set("AL AK AS AZ AR CA CO CT DE DC FL GA GU HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MP MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA VI WA WV WI WY AA AE AP FM MH PW".split(" "));
export const isUsStateCode = (value: string) => usStates.has(value.trim().toUpperCase());
const blankLocation = (): AddressLocation => ({ unit: "", city: "", state: "", zip: "" });

export function splitLegacyAddress(value: string): { street: string; location: AddressLocation } {
  const match = /^(?:(.+),\s*)?([^,]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i.exec(value.trim());
  if (!match || !isUsStateCode(match[3]) || match[2].trim().length > 100) {
    return { street: value, location: blankLocation() };
  }
  return {
    street: match[1]?.trim() ?? "",
    location: { unit: "", city: match[2].trim(), state: match[3].toUpperCase(), zip: match[4] ?? "" },
  };
}

export function reusablePropertyAddress(address: string) {
  const value = address.trim();
  return value.length <= 240 && splitLegacyAddress(value).street ? value : undefined;
}

const storedApplicationDraft = z.object({
  borrowerName: shortText, email: shortText, phone: z.string().trim().max(40),
  currentAddress: shortText, priorAddress: shortText, coBorrowerName: shortText,
  employer: shortText, occupation: shortText, employmentStart: z.string().max(10), monthlyIncome: dollars,
  priorEmployer: shortText, coBorrowerEmployer: shortText, coBorrowerIncome: dollars,
  assets: dollars, monthlyDebts: dollars, otherProperty: shortText,
  propertyAddress: z.string().trim().max(240), estimatedValue: dollars, loanAmount: dollars,
  purpose: z.enum(["Purchase", "Refinance", "Other"]), occupancy: z.enum(["", "Primary residence", "Second home", "Investment property", "FHA secondary residence"]),
  borrowedDownPayment: yesNo, bankruptcy: yesNo,
  confirmedDemo: z.boolean(),
  currentLocation: addressLocation.optional(), priorLocation: addressLocation.optional(), propertyLocation: addressLocation.optional(),
  urla: urlaDetailsSchema.optional(),
});

export const applicationDraft = storedApplicationDraft.transform((draft) => {
  const current = draft.currentLocation ? { street: draft.currentAddress, location: draft.currentLocation } : splitLegacyAddress(draft.currentAddress);
  const prior = draft.priorLocation ? { street: draft.priorAddress, location: draft.priorLocation } : splitLegacyAddress(draft.priorAddress);
  const property = draft.propertyLocation ? { street: draft.propertyAddress, location: draft.propertyLocation } : splitLegacyAddress(draft.propertyAddress);
  const urla = draft.urla ?? blankUrla();
  if (!draft.urla) {
    urla.primary.declarations.fields = { borrowed: draft.borrowedDownPayment, bankruptcy: draft.bankruptcy };
    if (draft.employer) {
      urla.primary.work.fields.hasJobs = "Yes";
      urla.primary.work.groups.jobs = [{ status: "Current", employer: draft.employer, position: draft.occupation, start: draft.employmentStart, base: draft.monthlyIncome }];
    }
    if (draft.coBorrowerName) {
      urla.credit.fields.type = "Joint";
      const additional = blankBorrower();
      additional.identity.fields.name = draft.coBorrowerName;
      if (draft.coBorrowerEmployer) {
        additional.work.fields.hasJobs = "Yes";
        additional.work.groups.jobs = [{ status: "Current", employer: draft.coBorrowerEmployer, base: draft.coBorrowerIncome }];
      }
      urla.additional.push(additional);
    }
  }
  return {
    ...draft,
    urla,
    currentAddress: current.street, currentLocation: current.location,
    priorAddress: prior.street, priorLocation: prior.location,
    propertyAddress: property.street, propertyLocation: property.location,
  };
});

export type ApplicationDraft = z.infer<typeof applicationDraft>;
export function changedApplicationSections(previous: ApplicationDraft, current: ApplicationDraft) {
  const sections = (draft: ApplicationDraft) => {
    const borrowers = [draft.urla.primary, ...draft.urla.additional];
    return {
      Borrowers: [draft.borrowerName, draft.email, draft.phone, draft.currentAddress, draft.currentLocation, draft.priorAddress, draft.priorLocation,
        draft.urla.credit, borrowers.map((person) => [person.identity, person.joint])],
      Employment: borrowers.map((person) => person.work),
      Finances: borrowers.map((person) => person.finances),
      Property: [draft.urla.property, draft.propertyAddress, draft.propertyLocation, draft.estimatedValue, draft.loanAmount, draft.purpose, draft.occupancy],
      Declarations: borrowers.map((person) => person.declarations),
      "Real estate": borrowers.map((person) => person.realEstate),
      Military: borrowers.map((person) => person.military),
      Demographics: borrowers.map((person) => person.demographics),
      Acknowledgment: borrowers.map((person) => person.acknowledgment),
    };
  };
  const before = sections(previous);
  const after = sections(current);
  return (Object.keys(after) as (keyof typeof after)[]).filter((section) => JSON.stringify(before[section]) !== JSON.stringify(after[section]));
}
export const applicationSteps = ["Borrowers", "Employment", "Finances", "Property", "Declarations", "Real estate", "Military", "Demographics", "Acknowledgment", "Review"] as const;

export function blankApplication(): ApplicationDraft {
  return {
    borrowerName: "", email: "", phone: "", currentAddress: "", priorAddress: "", coBorrowerName: "",
    employer: "", occupation: "", employmentStart: "", monthlyIncome: "", priorEmployer: "",
    coBorrowerEmployer: "", coBorrowerIncome: "", assets: "", monthlyDebts: "", otherProperty: "",
    propertyAddress: "", estimatedValue: "", loanAmount: "", purpose: "Purchase", occupancy: "",
    borrowedDownPayment: "", bankruptcy: "", confirmedDemo: false,
    currentLocation: blankLocation(), priorLocation: blankLocation(), propertyLocation: blankLocation(),
    urla: blankUrla(),
  };
}

export const sampleAddresses = [
  { street: "100 Sample Avenue", location: { unit: "2", city: "Troy", state: "MI", zip: "48084" } },
  { street: "22 Example Lane", location: { unit: "", city: "Novi", state: "MI", zip: "48375" } },
  { street: "400 Demo Way", location: { unit: "", city: "Royal Oak", state: "MI", zip: "48067" } },
] satisfies { street: string; location: AddressLocation }[];

export function sampleApplication(current: ApplicationDraft): ApplicationDraft {
  const [home, , exampleProperty] = sampleAddresses;
  const location = current.propertyLocation;
  const hasPropertyDetails = current.propertyAddress || location.city || location.state || location.zip || location.unit;
  const property = hasPropertyDetails ? { street: current.propertyAddress || exampleProperty.street, location } : exampleProperty;
  const name = current.borrowerName || "Riley Sample";
  return {
    ...blankApplication(),
    borrowerName: name, email: current.email || "riley@example.test", phone: current.phone || "248-555-0142",
    currentAddress: home.street, currentLocation: home.location,
    employer: "Sample Design Studio", occupation: "Designer", employmentStart: "2022-04-01", monthlyIncome: "7500",
    priorEmployer: "Example Creative", coBorrowerEmployer: "Demo Services", coBorrowerIncome: "4000",
    assets: "67000", monthlyDebts: "490", otherProperty: "None",
    propertyAddress: property.street, propertyLocation: property.location,
    estimatedValue: String(Math.max(450000, Math.min(1_000_000_000, Math.ceil(Number(current.loanAmount) * 1.25)))),
    loanAmount: current.loanAmount || "360000", purpose: current.purpose, occupancy: "Primary residence",
    borrowedDownPayment: "No", bankruptcy: "No", urla: sampleUrla(name, current.purpose === "Purchase"),
  };
}

function completeAddress(street: string, { city, state, zip, country }: AddressLocation, usOnly = false) {
  const domestic = usOnly || !country || /^(US|USA|United States)$/i.test(country.trim());
  return !!street.trim() && !!city.trim() && (!domestic || (isUsStateCode(state) && usZip.test(zip.trim())));
}

export function applicationIssues(draft: ApplicationDraft, separateJoint = false) {
  const missing: string[] = [];
  if (!draft.borrowerName || !z.email().safeParse(draft.email).success) {
    missing.push("Borrower name and valid email");
  }
  if (!completeAddress(draft.currentAddress, draft.currentLocation)) missing.push("Current street address, city, state, and ZIP code");
  if ((draft.priorAddress || Object.values(draft.priorLocation).some(Boolean)) && !completeAddress(draft.priorAddress, draft.priorLocation)) {
    missing.push("Prior street address, city, state, and ZIP code");
  }
  const pendingProperty = draft.purpose === "Purchase" && draft.urla.property.fields.propertyPending === "Yes";
  if (!pendingProperty && !completeAddress(draft.propertyAddress, draft.propertyLocation, true)) missing.push("Subject property street address, city, state, and ZIP code");
  if (draft.purpose === "Other" && !draft.urla.property.fields.otherPurpose) missing.push("Describe the other loan purpose");
  if (Number(draft.estimatedValue) <= 0 || Number(draft.loanAmount) <= 0 || !draft.occupancy) {
    missing.push("Property value, loan amount, and occupancy");
  }
  const joint = draft.urla.credit.fields.type === "Joint";
  if (!joint && draft.urla.additional.length) missing.push("Select joint credit for an application with additional borrowers");
  for (const [name, signer] of [[draft.borrowerName, draft.urla.primary], ...draft.urla.additional.map((item) => [item.identity.fields.name, item] as const)] as const) {
    if ((name ?? "").trim().toLowerCase() !== signer.acknowledgment.fields.signature?.trim().toLowerCase()) missing.push("Each sample signature must match the borrower’s full name");
  }
  missing.push(...normalizeUrla(draft.urla, true, completeAddress(draft.priorAddress, draft.priorLocation), separateJoint).issues);
  if (!draft.confirmedDemo) missing.push("Sample data confirmation");
  return missing;
}

export interface BorrowerApplication {
  questionnaire?: import("./application-questionnaire-model").ApplicationQuestionnaire;
  separateJoint?: boolean;
  correctionNote?: string;
  draft: ApplicationDraft;
  step: number;
  revision: number;
  updatedAt: string;
  submittedAt: string | null;
  loanStatus: BorrowerLoanStatus | null;
  addressLookupEnabled?: boolean;
  documentUploadsEnabled?: boolean;
  documentUploadsMode?: DocumentUploadMode;
}

export type BorrowerStatusRefresh = (
  | { kind: "status"; submittedAt: string; loanStatus: BorrowerLoanStatus }
  | { kind: "joint-waiting"; submittedAt: string }
  | { kind: "resume" }
) & { documentUploadsMode?: DocumentUploadMode };

export const manualHandoffOutcomes = ["Prepared", "Delivered manually", "Acknowledged", "Returned for changes"] as const;

export function manualHandoffNeedsApproval(outcome: unknown) {
  return outcome === "Delivered manually" || outcome === "Acknowledged";
}

export interface StaffApplication {
  joint?: StaffJointApplication;
  revision: number;
  correctionNote: string;
  versions: {
    revision: number;
    submittedAt: string;
    reviewedAt: string | null;
    uwmReceipt: { reference: string; sentAt: string } | null;
  }[];
  previousAnswers: ApplicationDraft | null;
  loanId: string;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  secondReviewApproved?: boolean;
  uwmReference: string | null;
  uwmPendingReceipt?: import("./uwm-handoff-recovery").MockUwmPendingReceipt;
  draft: ApplicationDraft | null;
  draftHasPropertyStreet?: boolean;
  lender: { details: LenderDetails; revision: number } | null;
  manualHandoff?: { exportPrepared: boolean; exportProfiles?: import("./lender-export-model").LenderExportProfile[];
    preparedExports?: import("./lender-export-model").PreparedLenderExport[];
    preparedQuotes?: import("./manual-pricing-model").PreparedManualQuote[]; acknowledgedQuote?: import("./manual-pricing-model").ManualQuoteBasis;
    acknowledgmentOutdated?: true; outcome: (typeof manualHandoffOutcomes)[number] | null; submissionId?: string };
  currentManualExportPrepared?: boolean;
  lastExportProfile?: import("./lender-export-model").LenderExportProfile;
  lastManualSubmissionId?: string;
  manualLenderRejected?: true;
}

export function submittedRequestedLoanAmount(application?: Pick<StaffApplication, "submittedAt" | "correctionNote" | "draft">) {
  return application?.submittedAt && !application.correctionNote ? requestedLoanAmount(application.draft?.loanAmount) : null;
}

export function secondReviewBlocker(required: boolean, application?: Pick<StaffApplication, "submittedAt" | "reviewedAt" | "secondReviewApproved">) {
  if (!required) return null;
  if (!application?.submittedAt) return "Submit the current 1003 before the required second review.";
  if (!application.reviewedAt) return "Complete the first review of the current 1003.";
  return application.secondReviewApproved ? null : "The current 1003 needs an approved second review before handoff.";
}

export type BorrowerResult = { application: BorrowerApplication } | { statusView: BorrowerStatusRefresh } |
  { preferences: BorrowerPortalPreferences } | { status: number; error: string };

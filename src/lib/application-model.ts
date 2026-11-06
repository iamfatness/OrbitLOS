import { z } from "zod";

const shortText = z.string().trim().max(160);
const dollars = z.string().trim().regex(/^\d{0,10}(?:\.\d{1,2})?$/).refine((value) => Number(value) <= 1_000_000_000);
const yesNo = z.enum(["", "Yes", "No"]);

export const applicationDraft = z.object({
  borrowerName: shortText, email: shortText, phone: z.string().trim().max(40),
  currentAddress: shortText, priorAddress: shortText, coBorrowerName: shortText,
  employer: shortText, occupation: shortText, employmentStart: z.string().max(10), monthlyIncome: dollars,
  priorEmployer: shortText, coBorrowerEmployer: shortText, coBorrowerIncome: dollars,
  assets: dollars, monthlyDebts: dollars, otherProperty: shortText,
  propertyAddress: z.string().trim().max(240), estimatedValue: dollars, loanAmount: dollars,
  purpose: z.enum(["Purchase", "Refinance"]), occupancy: z.enum(["", "Primary residence", "Second home", "Investment property"]),
  borrowedDownPayment: yesNo, bankruptcy: yesNo,
  confirmedDemo: z.boolean(),
});

export type ApplicationDraft = z.infer<typeof applicationDraft>;
export const applicationSteps = ["Borrowers", "Employment", "Finances", "Property", "Declarations", "Review"] as const;

export function blankApplication(): ApplicationDraft {
  return {
    borrowerName: "", email: "", phone: "", currentAddress: "", priorAddress: "", coBorrowerName: "",
    employer: "", occupation: "", employmentStart: "", monthlyIncome: "", priorEmployer: "",
    coBorrowerEmployer: "", coBorrowerIncome: "", assets: "", monthlyDebts: "", otherProperty: "",
    propertyAddress: "", estimatedValue: "", loanAmount: "", purpose: "Purchase", occupancy: "",
    borrowedDownPayment: "", bankruptcy: "", confirmedDemo: false,
  };
}

export function sampleApplication(current: ApplicationDraft): ApplicationDraft {
  return {
    ...blankApplication(),
    borrowerName: current.borrowerName || "Riley Sample", email: "riley@example.test", phone: "248-555-0142",
    currentAddress: "100 Sample Avenue, Troy, MI", priorAddress: "22 Example Lane, Novi, MI", coBorrowerName: "Morgan Sample",
    employer: "Sample Design Studio", occupation: "Designer", employmentStart: "2022-04-01", monthlyIncome: "7500",
    priorEmployer: "Example Creative", coBorrowerEmployer: "Demo Services", coBorrowerIncome: "4000",
    assets: "67000", monthlyDebts: "490", otherProperty: "None",
    propertyAddress: current.propertyAddress || "400 Demo Way, Royal Oak, MI",
    estimatedValue: String(Math.max(450000, Math.min(1_000_000_000, Math.ceil(Number(current.loanAmount) * 1.25)))),
    loanAmount: current.loanAmount || "360000", purpose: current.purpose, occupancy: "Primary residence",
    borrowedDownPayment: "No", bankruptcy: "No",
  };
}

export function applicationIssues(draft: ApplicationDraft) {
  const missing: string[] = [];
  if (!draft.borrowerName || !z.email().safeParse(draft.email).success || !draft.currentAddress) {
    missing.push("Borrower name, valid email, and current address");
  }
  if (!draft.employer || Number(draft.monthlyIncome) <= 0) missing.push("Employer and gross monthly income");
  if (!draft.propertyAddress || Number(draft.estimatedValue) <= 0 || Number(draft.loanAmount) <= 0 || !draft.occupancy) {
    missing.push("Property address, value, loan amount, and occupancy");
  }
  if (!draft.borrowedDownPayment || !draft.bankruptcy) missing.push("Both declarations");
  if (!draft.confirmedDemo) missing.push("Sample data confirmation");
  return missing;
}

export interface BorrowerApplication {
  draft: ApplicationDraft;
  step: number;
  revision: number;
  updatedAt: string;
  submittedAt: string | null;
}

export interface StaffApplication {
  loanId: string;
  token: string;
  expiresAt: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  uwmReference: string | null;
  draft: ApplicationDraft | null;
}

export type BorrowerResult = { application: BorrowerApplication } | { status: number; error: string };

import type { StaffApplication } from "./application-model";
import type { PricingRun } from "./pricing-model";

export const stages = [
  "Lead", "Pre-qual", "Application", "Processing", "Underwriting", "Clear to Close", "Funded", "Closed",
] as const;

export type Stage = (typeof stages)[number];
export type ContactRole = "Borrower" | "Co-borrower" | "Realtor";
export type Purpose = "Purchase" | "Refinance";

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: ContactRole;
}

export interface Loan {
  id: string;
  contactId: string;
  partnerId: string | null;
  officer: string;
  address: string;
  amount: number;
  purpose: Purpose;
  stage: Stage;
  stageSince: string;
}

export interface Condition {
  id: string;
  category: string;
  group: string | null;
  description: string;
  uploaded: boolean;
  satisfiedAt: string | null;
}

export interface Submission {
  id: string;
  loanId: string;
  lender: string;
  externalId: string;
  status: string;
  conditions: Condition[];
  syncedAt: string | null;
}

export interface Activity {
  id: string;
  loanId: string;
  text: string;
  createdAt: string;
  kind: ActivityKind;
}

export const activityKinds = ["Note", "Call", "Email", "Text"] as const;
export type ActivityKind = (typeof activityKinds)[number];

export interface LoanTask {
  id: string;
  loanId: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
}

export interface Workspace {
  contacts: Contact[];
  loans: Loan[];
  submissions: Submission[];
  activity: Activity[];
  tasks: LoanTask[];
  applications: StaffApplication[];
  pricingRuns: PricingRun[];
  uwmSyncedAt: string | null;
}

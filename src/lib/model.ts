import type { StaffApplication } from "./application-model";

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
}

export interface Workspace {
  contacts: Contact[];
  loans: Loan[];
  submissions: Submission[];
  activity: Activity[];
  applications: StaffApplication[];
  uwmSyncedAt: string | null;
}

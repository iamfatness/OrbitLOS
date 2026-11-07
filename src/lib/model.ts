import type { StaffApplication } from "./application-model";
import type { LoanDocumentRequest } from "./document-model";
import type { MockUwmRate, PricingRun, PublishedQuote } from "./pricing-model";
import type { MockCreditAusRun } from "./credit-aus-model";

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
  officerEmail: string | null;
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

export type DraftAudience = "Borrower" | "Realtor";
export type DraftMilestone = Stage | "Application received" | "Closing complete";
export type DraftChannel = "Email" | "Text";

export interface CommunicationDraft {
  id: string;
  loanId: string;
  contactId: string;
  audience: DraftAudience;
  milestone: DraftMilestone;
  createdAt: string;
  emailCopiedAt: string | null;
  textCopiedAt: string | null;
}

export interface PastClientProfile {
  loanId: string;
  closingDate: string | null;
  currentRate: number | null;
  targetRate: number | null;
  observedRate: number | null;
  checkedAt: string | null;
  watchEnabled: boolean;
  note: string;
  revision: number;
}

export interface ClosingPlan {
  loanId: string;
  targetDate: string;
}

export interface ClosingItem {
  id: string;
  loanId: string;
  title: string;
  owner: string;
  dueDate: string;
  completedAt: string | null;
  revision: number;
}

export interface RealtorPortal {
  realtorId: string;
  token: string;
  expiresAt: string;
  officerEmail: string | null;
}

export interface RealtorReferrals {
  realtorName: string;
  referrals: { borrowerName: string; stage: Stage | "Referral received"; updatedAt: string }[];
}

export interface ReferralLead {
  id: string;
  realtorId: string;
  realtorName: string;
  name: string;
  email: string;
  phone: string;
  purpose: Purpose;
  officer: string;
  officerEmail: string | null;
  createdAt: string;
  dueAt: string;
}

export interface ReferralReview extends ReferralLead {
  matches: { id: string; name: string; reason: string }[];
  restrictedMatch: boolean;
}

export interface Workspace {
  contacts: Contact[];
  loans: Loan[];
  submissions: Submission[];
  activity: Activity[];
  tasks: LoanTask[];
  communicationDrafts: CommunicationDraft[];
  pastClients: PastClientProfile[];
  closingPlans: ClosingPlan[];
  closingItems: ClosingItem[];
  realtorPortals: RealtorPortal[];
  referralLeads: ReferralReview[];
  applications: StaffApplication[];
  documentRequests: LoanDocumentRequest[];
  pricingRuns: PricingRun[];
  publishedQuotes: PublishedQuote[];
  mockUwmRates: MockUwmRate[];
  mockCreditAusRuns: MockCreditAusRun[];
  uwmSyncedAt: string | null;
}

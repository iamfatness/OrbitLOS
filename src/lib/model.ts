import type { StaffApplication } from "./application-model";
import type { LoanDocumentRequest } from "./document-model";
import type { MockUwmRate, PricingRun, PublishedQuote, SharedQuoteEvent } from "./pricing-model";
import type { MockCreditAusRun } from "./credit-aus-model";
import type { UwmAlert } from "./uwm-alert-model";
import type { LeadFollowUp, LeadRouting } from "./lead-inbox-model";

export const stages = [
  "Lead", "Pre-qual", "Application", "Processing", "Underwriting", "Clear to Close", "Funded", "Closed",
] as const;

export type Stage = (typeof stages)[number];
export const dispositions = ["Active", "On hold", "Withdrawn", "Lost"] as const;
export type Disposition = (typeof dispositions)[number];
export type ContactRole = "Borrower" | "Co-borrower" | "Realtor";
export type Purpose = "Purchase" | "Refinance";
export const leadSources = ["Direct", "Realtor referral", "Returning client", "Website quote request", "Other"] as const;

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: ContactRole;
  addedBy?: string | null;
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
  disposition?: Disposition;
  dispositionReason?: string;
  revisitDate?: string | null;
  dispositionRevision?: number;
  leadSource?: (typeof leadSources)[number];
  referralSourcePartnerId?: string | null;
  createdAt?: string | null;
}

export interface Condition {
  id: string;
  category: string;
  group: string | null;
  description: string;
  uploaded: boolean;
  satisfiedAt: string | null;
  manual?: {
    owner: string;
    revision: number;
    deliveries: { documentRevision: number; reference: string; at: string }[];
    confirmedDelivery: string | null;
  };
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
  outcome?: string | null;
}

export const activityKinds = ["Note", "Call", "Email", "Text"] as const;
export const contactOutcomes = ["Connected", "Left message", "Sent update", "No response", "Requested callback"] as const;
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
export const draftMilestones = [...stages, "Application received", "Closing complete"] as const;
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
export interface BrokerageTemplate {
  audience: DraftAudience;
  milestone: DraftMilestone;
  body: string;
  revision: number;
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
export const disclosureStatuses = ["Not started", "Prepared", "Delivered manually", "Signed"] as const;
export interface ClosingProgress {
  loanId: string;
  fundingDate: string | null;
  disclosureStatus: (typeof disclosureStatuses)[number];
  disclosureDate: string | null;
  revision: number;
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

export interface InboxLead extends Omit<ReferralLead, "realtorId" | "realtorName"> {
  realtorId: string | null;
  realtorName: string | null;
  zip: string;
  followUp: LeadFollowUp;
  matches: ReferralReview["matches"];
  restrictedMatch: boolean;
}

export interface ReferralReview extends ReferralLead {
  matches: { id: string; name: string; reason: string }[];
  restrictedMatch: boolean;
}

export interface UnlinkedReferral {
  id: string;
  realtorId: string;
  name: string;
  createdAt: string;
  resolvedAt: string | null;
  officer: string;
  officerEmail: string | null;
}

export interface Workspace {
  contacts: Contact[];
  loans: Loan[];
  submissions: Submission[];
  activity: Activity[];
  tasks: LoanTask[];
  communicationDrafts: CommunicationDraft[];
  brokerageTemplates: BrokerageTemplate[];
  pastClients: PastClientProfile[];
  closingPlans: ClosingPlan[];
  closingItems: ClosingItem[];
  closingProgress: ClosingProgress[];
  realtorPortals: RealtorPortal[];
  referralLeads: ReferralReview[];
  inboxLeads: InboxLead[];
  leadRouting: LeadRouting | null;
  unlinkedReferrals: UnlinkedReferral[];
  applications: StaffApplication[];
  documentRequests: LoanDocumentRequest[];
  pricingRuns: PricingRun[];
  publishedQuotes: PublishedQuote[];
  sharedQuoteHistory: SharedQuoteEvent[];
  mockUwmRates: MockUwmRate[];
  mockCreditAusRuns: MockCreditAusRun[];
  uwmAlerts: UwmAlert[];
  mockUwmChangesApplied: boolean;
  uwmSyncedAt: string | null;
}

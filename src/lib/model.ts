import type { StaffApplication } from "./application-model";
import type { LoanDocumentRequest } from "./document-model";
import type { MockUwmRate, PricingRun, PublishedQuote, SharedQuoteEvent } from "./pricing-model";
import type { MockCreditAusRun } from "./credit-aus-model";
import type { UwmAlert } from "./uwm-alert-model";
import type { LeadFollowUp, LeadRouting } from "./lead-inbox-model";
import type { RealtorClaimPolicy } from "./realtor-claim-model";
import type { LoanProcessing } from "./processing-model";
import type { FeeWorksheet } from "./quote-worksheet";
import type { SharedPreapprovalLetter } from "./preapproval-model";
import type { BorrowerHours } from "./borrower-hours";

export const stages = [
  "Lead", "Pre-qual", "Application", "Processing", "Underwriting", "Clear to Close", "Funded", "Closed",
] as const;

export type Stage = (typeof stages)[number];
export const dispositions = ["Active", "On hold", "Withdrawn", "Lost"] as const;
export type Disposition = (typeof dispositions)[number];
export type ContactRole = "Borrower" | "Co-borrower" | "Realtor";
export type Purpose = "Purchase" | "Refinance";
export const leadSources = ["Direct", "Realtor referral", "Returning client", "Website quote request", "Imported CRM", "Other"] as const;

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: ContactRole;
  addedBy?: string | null;
  outreachSuppressed?: boolean;
  outreachChannelBlocks?: number;
  outreachHours?: BorrowerHours;
}

export interface Loan {
  lastActivityAt?: string | null;
  lastOutreachAt?: string | null;
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
  callCampaignName?: string | null;
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
  mockReopenedAt?: string;
  manual?: {
    owner: string;
    revision: number;
    openedAt?: string;
    reopenedAt?: string;
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
  kind: ActivityKind | "Campaign";
  outcome?: string | null;
}

export const activityKinds = ["Note", "Call", "Email", "Text"] as const;
export const contactOutcomes = ["Connected", "Left message", "Sent update", "No response", "Requested callback"] as const;
export const followUpOutcomes = ["Resolved", ...contactOutcomes, "No further follow-up needed"] as const;
export type ActivityKind = (typeof activityKinds)[number];

export const followUpPurposes = ["Loan service", "Prospecting"] as const;
export type FollowUpPurpose = (typeof followUpPurposes)[number];

export function prospectingBlocked(purpose: FollowUpPurpose, outreachSuppressed?: boolean) {
  return purpose === "Prospecting" && !!outreachSuppressed;
}

export interface ContactActivity {
  id: string;
  contactId: string;
  officer: string;
  officerEmail: string | null;
  followUpOwner: string | null;
  followUpOwnerEmail: string | null;
  kind: ActivityKind;
  outcome: (typeof contactOutcomes)[number] | null;
  text: string;
  createdAt: string;
  dueAt: string | null;
  completedAt: string | null;
  latestCompletion: {
    at: string;
    actor: string;
    outcome: (typeof followUpOutcomes)[number] | null;
    note: string;
  } | null;
  purpose: FollowUpPurpose;
  postFundingCheckIn?: boolean;
  revision: number;
}

export interface LoanTask {
  id: string;
  loanId: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
  purpose: FollowUpPurpose;
  campaignCallback?: "Pending" | "Recorded";
  campaignCallbackRevision?: number;
}

export type DraftAudience = "Borrower" | "Realtor";
export const draftMilestones = [...stages, "Application received", "Closing complete", "Lender review started", "Lender review resumed",
  "Lender review complete", "Post-funding check-in", "Realtor thank-you"] as const;
export type DraftMilestone = (typeof draftMilestones)[number];
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
  supersededAt: string | null;
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
  preFundingStage: Stage | null;
  preFundingStageSince: string | null;
  disclosureStatus: (typeof disclosureStatuses)[number];
  disclosureDate: string | null;
  revision: number;
}

export function fundingReversalStage(stage: Stage, preFundingStage: Stage | null) {
  return stage === "Funded" || stage === "Closed" ? preFundingStage ?? "Clear to Close" : stage;
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
  revision: number;
  realtorId: string;
  token: string;
  expiresAt: string;
  officerEmail: string | null;
}

export type ClosingPause = { label: "Closing on hold" | "Funding on hold"; since: string };

export interface RealtorReferrals {
  realtorName: string;
  referrals: { borrowerName: string; stage: Stage | "Referral received"; updatedAt: string; closingPause?: ClosingPause; preapproval?: SharedPreapprovalLetter }[];
  next: RealtorReferralCursor | null;
}

export type RealtorReferralCursor = { at: string; id: string; source: "loan" | "referral" };

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
  importedContactId: string | null;
  campaignId: string | null;
  campaignTaskId: string | null;
  campaignOptedOut: boolean;
  outreachSuppressed: boolean;
  outreachChannelBlocks?: number;
  outreachHours?: BorrowerHours;
  heldAt: string | null;
  holdReason: string | null;
  revisitDate: string | null;
  source: (typeof leadSources)[number];
  importedTasks: ImportedLeadTask[];
  followUp: LeadFollowUp;
  matches: ReferralReview["matches"];
  restrictedMatch: boolean;
}

export interface ImportedLeadTask {
  id: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
  purpose: FollowUpPurpose;
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
  followUpContacts: Contact[];
  loans: Loan[];
  submissions: Submission[];
  contactActivity: ContactActivity[];
  tasks: LoanTask[];
  communicationDrafts: CommunicationDraft[];
  brokerageTemplates: BrokerageTemplate[];
  pastClients: PastClientProfile[];
  closingPlans: ClosingPlan[];
  closingItems: ClosingItem[];
  closingProgress: ClosingProgress[];
  returningClientLoans: { fundedLoanId: string; loanId: string }[];
  loanProcessing: LoanProcessing[];
  processingActivity?: Pick<Activity, "id" | "text" | "createdAt">[];
  realtorPortals: RealtorPortal[];
  referralLeads: ReferralReview[];
  inboxLeads: InboxLead[];
  leadRouting: LeadRouting | null;
  realtorClaimPolicy?: RealtorClaimPolicy;
  sharedRealtorClaimEnabled?: boolean;
  callCampaigns: import("./call-campaign-model").CallCampaign[];
  crmSegments: import("./crm-segment-model").CrmSegment[];
  campaignResponses: import("./campaign-response-model").CampaignResponseRecord[];
  callCampaignMembers: import("./call-campaign-model").CallCampaignMember[];
  campaignQueueFiles?: import("./call-campaign-model").CampaignQueueFile[];
  campaignLeadOptions?: import("./call-campaign-model").CampaignLeadOption[];
  playbook: import("./playbook-model").PlaybookSettings;
  demoGuide: import("./brokerage-model").DemoGuideState | null;
  campaignRehearsal: import("./call-campaign-model").CampaignRehearsal | null;
  managerReports: import("./manager-report-model").ManagerReports | null;
  callReportFiles: import("./call-report-model").CallReportFile[] | null;
  mismoLoans: string[];
  unlinkedReferrals: UnlinkedReferral[];
  applications: StaffApplication[];
  documentRequests: LoanDocumentRequest[];
  pricingRuns: PricingRun[];
  feeWorksheets: FeeWorksheet[];
  publishedQuotes: PublishedQuote[];
  sharedQuoteHistory: SharedQuoteEvent[];
  mockUwmRates: MockUwmRate[];
  mockCreditAusRuns: MockCreditAusRun[];
  uwmAlerts: UwmAlert[];
  mockUwmChangesApplied: boolean;
  uwmSyncedAt: string | null;
}

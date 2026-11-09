import { z } from "zod";
import { campaignWorkPatch, insertContact, insertLoan, insertSubmission, leadContactCandidates, leadWorkRecord, loanWorkRecords,
  readCampaignNavigation, readCampaignQueue, readWorkspace, savedPricingRun, workspace, type SqlValue, type Store } from "./store";
import { activityKinds, contactOutcomes, disclosureStatuses, dispositions, draftMilestones, followUpOutcomes, followUpPurposes,
  fundingReversalStage, leadSources, stages, type ActivityKind, type Condition, type Contact, type ContactActivity,
  type FollowUpPurpose, type Loan, type Purpose, type UnlinkedReferral, type Workspace } from "./model";
import { campaignResponses } from "./campaign-response";
import { carriedCallbackInput, rescheduleCarriedCallbackInput } from "./campaign-callback-performance-model";
import { carriedCallbacks, recordCarriedCallback, rescheduleCarriedCallback } from "./carried-campaign-callback";
import { leadWorkUnavailable, type CampaignMutationResult, type CampaignNavigationResult, type CampaignQueueResult, type LeadMutationResult } from "./lead-work-model";
import { readEditableLoan } from "./editable-loan";
import type { LoanMutationResult } from "./loan-work-model";
import { archiveMockDocumentDelivery, hasReopenedMockUwmCondition, refreshMockUwmClearance, reopenMockUwmCondition, sendMockConditionDocument,
  simulateMockUwmChanges, submitMockApplication, syncUwm, uwmSubmissionConditions } from "./uwm";
import { addApplicationActivity, getApplication, saveApplicationVersion, startApplication } from "./applications";
import { manualHandoffNeedsApproval, manualHandoffOutcomes, requestedLoanAmount, reusablePropertyAddress } from "./application-model";
import { handoffCheckpointError } from "./application-review-checkpoint";
import { mockLockExtensionPeriods, mockLockPeriods, pricingScenario, type PricingOffer } from "./pricing-model";
import { approvedIncomeAmount, pricingInputError } from "./income-review-freshness";
import { repriceIncomeMessage } from "./income-review-model";
import { cancelMockLock, extendMockLock, floatMockRate, lockMockRate } from "./uwm-rate-locks";
import { PricingError, pricingProvider } from "./pricing-provider";
import { cleanAnswers, lenderDetailsSchema, lenderQuestions, lenderSupplement } from "./urla";
import { createFundingDrafts, createMilestoneDrafts, recordDraftCopy, supersedeFundingDrafts } from "./communications";
import { draftChannels } from "./communication-templates";
import type { TemplateMutationResult } from "./communication-draft-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import { accessEvent, isDemoStaff, loanAccess, scopeWorkspace } from "./workspace-access";
import { demoBrokerageId, portalToken, portalTokenPattern, type VersionedBrokerageMember } from "./brokerage-model";
import { saveRealtorLinkOwner } from "./realtor-portal";
import type { RealtorMutationResult } from "./realtor-work-model";
import type { PlaybookSettingsMutation } from "./manager-exception-model";
import { clearPendingAnniversaries, easternDate, pastClientLoan, retentionInput, synchronizeRetentionTasks } from "./client-retention";
import { activeRateWatchTask, returningClientSource } from "./past-client-queue";
import { checklistInstructions, checklistPresetNames, checklistPresets, conditionDocumentBatchLimit, documentKinds,
  documentRecipients, primaryDocumentRecipient, suggestedConditionDocument, type DocumentKind, type DocumentRecipient } from "./document-model";
import { documentRecipientAvailable } from "./borrower-documents";
import { referralMatches } from "./referral-matches";
import { mockAusInput, mockCreditInput, mockPairedAusInput, mockRetryInput, runMockCreditAus } from "./mock-credit-aus";
import { loadProtectedPilotScenario, trackPilotBorrower, type ProtectPilotLinks } from "./pilot";
import { contactCsvDuplicateKeys, contactCsvKeys, contactImportRows } from "./contact-csv";
import { matchingContactCsvKeys } from "./contact-directory";
import { contactUnavailable, type ContactMutationResult } from "./contact-directory-model";
import { assignInboxLeadInput, convertReferralInput, leadContactInput, leadHoldInput, leadOptOutInput, leadSequenceInput, restoreLeadInput,
  saveLeadRoutingInput, type LeadInboxMutation } from "./lead-inbox-model";
import { inboxLeadScope } from "./lead-inbox-query";
import { claimSharedRealtorInput, saveRealtorClaimPolicyInput } from "./realtor-claim-model";
import { saveRealtorClaimPolicy } from "./realtor-claim-queue";
import { archiveLead, carryLeadHistory, changeLeadRouting, claimSharedRealtor, restoreArchivedLead, setImportedLeadTaskStatus, updateInboxLead } from "./lead-inbox";
import { carryLeadDocuments } from "./lead-documents";
import { carryLeadConversation } from "./conversations";
import { updateProcessingInput } from "./processing-model";
import { updateProcessing } from "./loan-processing";
import { quoteSelection, saveFeeWorksheetInput, type QuoteOption } from "./quote-worksheet";
import { archiveSharedQuote, quoteSnapshot, saveFeeWorksheet } from "./quote-worksheet-store";

import { migrationInput, undoMigrationInput, type MigrationReport } from "./pipeline-migration-model";
import { migratePipeline } from "./pipeline-migration";
import { undoMigration } from "./migration-recovery";
import type { MigrationMutationResult } from "./migration-record-model";
import { addCampaignLeadInput, assignCampaignLeadsInput, createCallCampaignInput, loadCampaignRehearsalInput, openCampaignsInput, pauseCampaignRetriesInput, recordCampaignCallInput, recordCampaignFollowUpInput, refreshCampaignQueueInput, routeCampaignQueueInput,
  campaignManualHandoff, rescheduleCampaignCallbackInput, saveCampaignRoutingInput, saveCampaignRulesInput, unansweredCampaignCall } from "./call-campaign-model";
import { assignCampaignLeads, createCallCampaign, linkCampaignLead, mayManageCampaigns, pauseCampaignRetries, recordCampaignCall, recordCampaignFollowUp, rescheduleCampaignCallback,
  saveCampaignRules, stopCampaignFollowUp } from "./call-campaigns";
import { enrollCrmSegmentInput, saveCrmSegmentInput, type SegmentPreview } from "./crm-segment-model";
import { enrollCrmSegment, saveCrmSegment } from "./crm-segments";
import { campaignRefillNotice, campaignReleaseRouting, captureCampaignOptOutCapacity, distributeCampaignLeads, readCampaignRouting,
  refillCampaignsAfterOptOut, refillReleasedCampaignSlot, returnCampaignLeadToShared, saveCampaignRouting, type CampaignOptOutRoster, type CampaignRefillRoster } from "./campaign-routing";
import { ensureCampaignManualFile, linkCampaignSampleRealtor, loadCampaignRehearsal, type CampaignRehearsalMember } from "./campaign-rehearsal";
import { blockedOutreachKeys, closeSuppressedOutreach, loanOutreachSuppressed, optOutContact, outreachSuppressed, outreachSuppressionKeys, retainContactOptOut,
  type OutreachOptOutTarget } from "./outreach-preferences";
import { deleteReportView, saveReportView } from "./manager-report-model";
import { exportMismo, importMismo } from "./mismo-rehearsal-model";
import { createMismoRehearsal, exportMismoRehearsal } from "./mismo-rehearsal";

import { saveCallReport } from "./call-report-model";
import { loanAuditHistory, loanAuditSnapshot, recordLoanAudit, type LoanAuditEvent } from "./loan-audit";

import { exportReviewedApplication } from "./lender-export-model";
import { hasPreparedLenderExport, prepareLenderExport, recordManualLenderReturn } from "./lender-export";
import { fundingCheckInActivityTitle, fundingTaskId, reversedFundingTaskPrefix, savePlaybookInput } from "./playbook-model";
import { readPlaybook, recordedFundingCheckIn, retireFundingFollowUps, writePlaybook } from "./playbooks";
import { startFundingPlaybook, supersedeFundingPlaybook } from "./playbook-runs";
import { archiveFundingFinancials } from "./brokerage-finance";
import { completeContactFollowUp, setClosingChecklistStatus, setClosingTarget, setDocumentDeadline } from "./deadline-actions";
import { applyDocumentTemplateInput } from "./document-template-model";
import { applyDocumentTemplate } from "./document-templates";
import { changeJointApplicationLink, jointApplication, reopenJointBorrower } from "./joint-application";
import { jointLinkCommand } from "./joint-application-model";
import { closingReviewReady, mockClearanceClosingStages, reopenedMockClosingMessage } from "./loan-workflow";
import { routeSecondApplicationReview } from "./loan-reviews";

const label = z.string().trim().min(1, "Fill in the required fields.").max(160);
const id = z.string().min(1).max(100);
export const reviewApplicationInput = z.object({ type: z.literal("reviewApplication"), loanId: id, revision: z.number().int().nonnegative().optional() });
const dismissReferralInput = z.object({ type: z.literal("dismissReferral"), referralId: z.uuid(), revision: z.number().int().nonnegative() });

export function campaignRefillTarget(input: unknown) {
  if (!input || typeof input !== "object" || !("type" in input)) return;
  if (input.type === "convertReferral" || input.type === "dismissReferral") {
    const parsed = (input.type === "convertReferral" ? convertReferralInput : dismissReferralInput).safeParse(input);
    if (parsed.data) return { leadId: parsed.data.referralId };
  }
  if (input.type === "leadHold" && "action" in input && input.action === "Hold") {
    const { data } = leadHoldInput.safeParse(input);
    if (data) return { leadId: data.leadId };
  }
  if (input.type === "recordCampaignCall") {
    const { data } = recordCampaignCallInput.safeParse(input);
    if (data && unansweredCampaignCall(data.outcome)) return { leadId: data.leadId, retryOutcome: data.outcome };
  }
}

function campaignOptOutTarget(input: unknown): OutreachOptOutTarget | undefined {
  if (!input || typeof input !== "object" || !("type" in input)) return;
  if (input.type === "optOutContact" && "contactId" in input && typeof input.contactId === "string") return { kind: "contact", id: input.contactId };
  if ((input.type === "leadOptOut" || (input.type === "recordCampaignCall" && "outcome" in input && input.outcome === "Opted out")) &&
    "leadId" in input && typeof input.leadId === "string") return { kind: "lead", id: input.leadId };
}
const documentDueOn = z.iso.date().refine((value) => value >= "1900-01-01" && value <= "9998-12-31").nullable();
export const assignContactFollowUpInput = z.object({ type: z.literal("assignContactFollowUp"), contactId: id,
  eventId: z.uuid(), revision: z.number().int().nonnegative(), email: z.email().max(254) });
const lockChange = { loanId: id, lockReference: id, expectedExpiresAt: z.iso.datetime() };
const contactFields = {
  name: label,
  email: z.union([z.email(), z.literal("")]),
  phone: z.string().trim().max(40),
  role: z.enum(["Borrower", "Co-borrower", "Realtor"]),
};
const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("contact"), id: id.optional(), ...contactFields }),
  z.object({ type: z.literal("deleteContact"), id }),
  z.object({ type: z.literal("optOutContact"), contactId: id }),
  z.object({ type: z.literal("logContactActivity"), contactId: id, eventId: z.uuid(), kind: z.enum(activityKinds),
    text: z.string().trim().min(1, "Write an activity summary first.").max(2000), outcome: z.enum(contactOutcomes).nullable(),
    followUp: z.iso.date().nullable(), purpose: z.enum(followUpPurposes).default("Prospecting") }),
  z.object({ type: z.literal("completeContactFollowUp"), contactId: id, eventId: z.uuid(), revision: z.number().int().nonnegative(), completed: z.boolean(),
    resolution: z.object({ outcome: z.enum(followUpOutcomes), note: z.string().trim().max(500) }).optional(),
  }).refine((data) => data.completed || !data.resolution, "Record the outcome when completing the follow-up."),
  assignContactFollowUpInput,
  z.object({ type: z.literal("rescheduleBorrowerCallback"), contactId: id, eventId: z.uuid(), revision: z.number().int().nonnegative(),
    date: z.iso.date(), reason: z.string().trim().min(1, "Enter a reason for rescheduling.").max(500) }),
  z.object({ type: z.literal("importContacts"), batchId: z.uuid(), rows: contactImportRows }),
  z.object({
    type: z.literal("loan"), id: id.optional(), contactId: z.union([id, z.literal("")]),
    borrower: z.string().trim().max(160), partnerId: id.nullable(),
    borrowerEmail: z.union([z.email().max(160), z.literal("")]).optional(), borrowerPhone: z.string().trim().max(40).optional(),
    start1003: z.boolean().optional(),
    officer: z.string().trim().max(160), assignToSelf: z.boolean().optional(), address: z.string().trim().max(240),
    amount: z.number().int().min(0).max(1_000_000_000),
    purpose: z.enum(["Purchase", "Refinance"]), stage: z.enum(stages),
    leadSource: z.enum(leadSources).optional(),
  }),
  z.object({ type: z.literal("deleteLoan"), id }),
  z.object({ type: z.literal("move"), id, stage: z.enum(stages) }),
  z.object({ type: z.literal("markClearToClose"), loanId: id }),
  z.object({ type: z.literal("loanDisposition"), loanId: id, disposition: z.enum(dispositions),
    reason: z.string().trim().max(500), revisitDate: z.iso.date().nullable(), revision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("copyDraft"), loanId: id, contactId: id, audience: z.enum(["Borrower", "Realtor"]),
    milestone: z.enum(draftMilestones), channel: z.enum(draftChannels), draftId: z.uuid().optional() }),
  retentionInput,
  z.object({ type: z.literal("saveClosingTarget"), loanId: id, targetDate: z.iso.date().nullable(), previous: z.iso.date().nullable() }),
  z.object({ type: z.literal("saveClosingItem"), loanId: id, itemId: id, revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(120), owner: z.string().trim().min(1).max(120), dueDate: z.iso.date() }),
  z.object({ type: z.literal("completeClosingItem"), loanId: id, itemId: id, revision: z.number().int().positive(), completed: z.boolean() }),
  z.object({ type: z.literal("recordClosing"), loanId: id, revision: z.number().int().nonnegative(), closingDate: z.iso.date() }),
  z.object({ type: z.literal("recordFunding"), loanId: id, revision: z.number().int().nonnegative(), fundingDate: z.iso.date(), simulateFollowUpFailure: z.boolean().optional() }),
  z.object({ type: z.literal("recordFundingCheckIn"), loanId: id, eventId: z.uuid(), fundingRevision: z.number().int().nonnegative(),
    kind: z.enum(["Call", "Email", "Text"]), outcome: z.enum(contactOutcomes), note: z.string().trim().max(500),
    followUp: z.iso.date().nullable(), purpose: z.enum(followUpPurposes).default("Loan service"),
  }).refine((data) => data.outcome !== "Requested callback" || data.followUp, "Choose a follow-up date for the requested callback."),
  z.object({ type: z.literal("startReturningClient1003"), loanId: id, purpose: z.enum(["Purchase", "Refinance"]),
    fromRateWatch: z.literal(true).optional(), confirmedPropertyAddress: z.string().trim().min(1).max(240).optional() }),
  z.object({ type: z.literal("reverseFunding"), loanId: id, revision: z.number().int().positive(),
    fundingDate: z.iso.date(), reason: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal("saveDisclosureStatus"), loanId: id, revision: z.number().int().nonnegative(),
    status: z.enum(disclosureStatuses), date: z.iso.date().nullable() }),
  z.object({ type: z.literal("prepareClosingHandoff"), loanId: id, dueDate: z.iso.date() }),
  z.object({ type: z.literal("createRealtorPortal"), realtorId: id, officerEmail: z.email().nullable().optional() }),
  z.object({ type: z.literal("saveRealtorLinkOwner"), realtorId: id, officerEmail: z.email().nullable(),
    token: z.string().regex(portalTokenPattern), revision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("revokeRealtorPortal"), realtorId: id }),
  convertReferralInput,
  dismissReferralInput,
  restoreLeadInput,
  saveLeadRoutingInput,
  saveRealtorClaimPolicyInput,
  claimSharedRealtorInput,
  savePlaybookInput,
  migrationInput,
  undoMigrationInput,
  createCallCampaignInput,
  loadCampaignRehearsalInput,
  z.object({ type: z.literal("linkCampaignSampleRealtor"), loanId: id, scenarioId: z.uuid() }),
  saveCrmSegmentInput,
  enrollCrmSegmentInput,
  addCampaignLeadInput,
  assignCampaignLeadsInput,
  saveCampaignRoutingInput,
  routeCampaignQueueInput,
  saveCampaignRulesInput,
  pauseCampaignRetriesInput,
  recordCampaignCallInput,
  recordCampaignFollowUpInput,
  rescheduleCampaignCallbackInput,
  saveReportView,
  saveCallReport,
  z.object({ type: z.literal("loadLoanAudit"), loanId: id }),
  deleteReportView,
  importMismo,
  exportMismo,
  exportReviewedApplication,
  z.object({ type: z.literal("completeLeadTask"), leadId: z.uuid(), taskId: z.uuid(), completed: z.boolean() }),
  assignInboxLeadInput,
  leadContactInput,
  leadOptOutInput,
  leadHoldInput,
  leadSequenceInput,
  z.object({ type: z.literal("note"), loanId: id, kind: z.enum(activityKinds).default("Note"), text: z.string().trim().min(1, "Write an activity summary first.").max(2000),
    eventId: z.uuid().optional(), outcome: z.enum(contactOutcomes).optional(), followUp: z.iso.date().optional(), purpose: z.enum(followUpPurposes).default("Loan service") }),
  z.object({ type: z.literal("saveBrokerageTemplate"), audience: z.enum(["Borrower", "Realtor"]), milestone: z.enum(draftMilestones),
    body: z.string().trim().max(800), revision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("submission"), id: id.optional(), loanId: id, lender: label, externalId: label, status: label }),
  z.object({ type: z.literal("saveManualCondition"), loanId: id, submissionId: id, conditionId: z.uuid(),
    revision: z.number().int().nonnegative(), category: label, owner: label, description: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal("recordManualDelivery"), loanId: id, submissionId: id, conditionId: z.uuid(),
    revision: z.number().int().positive(), documentRevision: z.number().int().nonnegative(), reference: label }),
  z.object({ type: z.literal("recordManualClearance"), loanId: id, submissionId: id, conditionId: z.uuid(),
    revision: z.number().int().positive(), cleared: z.boolean(), confirmation: label }),
  z.object({ type: z.literal("deleteSubmission"), id }),
  z.object({ type: z.literal("sync") }),
  z.object({ type: z.literal("simulateUwmChanges") }),
  z.object({ type: z.literal("reviewUwmAlert"), loanId: id, alertId: z.uuid() }),
  z.object({ type: z.literal("startApplication"), loanId: id }),
  jointLinkCommand,
  z.object({ type: z.literal("revokeApplication"), loanId: id, token: z.string().regex(portalTokenPattern) }),
  z.object({ type: z.literal("refreshApplication"), loanId: id }),
  z.object({ type: z.literal("requestDocument"), loanId: id, kind: z.enum(documentKinds), instructions: z.string().trim().max(500),
    condition: z.object({ submissionId: id, conditionId: z.string().min(1).max(240) }).optional(), dueOn: documentDueOn.optional(),
    recipient: z.enum(documentRecipients).default(primaryDocumentRecipient) }),
  z.object({ type: z.literal("setDocumentDeadline"), loanId: id, requestId: z.uuid(), revision: z.number().int().nonnegative(),
    deadlineRevision: z.number().int().nonnegative(), dueOn: documentDueOn }),
  z.object({ type: z.literal("requestSuggestedUwmDocuments"), loanId: id, submissionId: id,
    conditionIds: z.array(z.string().min(1).max(240)).min(2).max(conditionDocumentBatchLimit) }),
  z.object({ type: z.literal("reviewDocument"), loanId: id, requestId: z.uuid(), revision: z.number().int().nonnegative(),
    decision: z.enum(["Accepted", "Needs replacement"]), replacementNote: z.string().trim().max(500), sendToMockUwm: z.boolean().optional(),
    dueOn: documentDueOn.optional() }),
  z.object({ type: z.literal("applyDocumentPreset"), loanId: id, preset: z.enum(checklistPresetNames),
    recipient: z.enum(documentRecipients).default(primaryDocumentRecipient) }),
  applyDocumentTemplateInput,
  z.object({ type: z.literal("recordManualHandoff"), loanId: id, eventId: z.uuid(), revision: z.number().int().nonnegative(),
    lenderRevision: z.number().int().nonnegative().optional(), outcome: z.enum(manualHandoffOutcomes), note: z.string().trim().max(500),
    lenderFile: z.object({ lender: label, externalId: label }).optional() }),
  z.object({ type: z.literal("acknowledgeCampaignLenderExport"), loanId: id, eventId: z.uuid(), revision: z.number().int().nonnegative(),
    lenderRevision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("sendConditionDocument"), loanId: id, requestId: z.uuid(), revision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("simulateDeliveryFailure"), loanId: id, requestId: z.uuid(), revision: z.number().int().nonnegative() }),
  z.object({ type: z.literal("refreshMockUwmClearance"), loanId: id, submissionId: id }),
  z.object({ type: z.literal("reopenMockUwmCondition"), loanId: id, submissionId: id, conditionId: id,
    expectedSatisfiedAt: z.iso.datetime({ offset: true }), expectedReopenedAt: z.iso.datetime().nullable() }),
  z.object({ type: z.literal("refreshWorkspace") }),
  refreshCampaignQueueInput,
  openCampaignsInput,
  z.object({ type: z.literal("loadGuidedDemo"), id: z.uuid(), previousId: z.uuid().nullable() }),
  z.object({ type: z.literal("completeTask"), id, completed: z.boolean() }),
  carriedCallbackInput,
  rescheduleCarriedCallbackInput,
  z.object({ type: z.literal("createTask"), loanId: id, title: z.string().trim().min(1, "Enter a task title.").max(120),
    days: z.union([z.literal(1), z.literal(3), z.literal(7)]), purpose: z.enum(followUpPurposes).default("Loan service") }),
  z.object({ type: z.literal("runPricing"), loanId: id, scenario: pricingScenario, applicationRevision: z.number().int().nonnegative().nullable(),
    incomeReviewRevision: z.number().int().positive().optional() }),
  mockCreditInput,
  mockAusInput,
  mockPairedAusInput,
  mockRetryInput,
  z.object({ type: z.literal("selectOffer"), loanId: id, runId: id, offerId: id }),
  z.object({ type: z.literal("floatMockRate"), loanId: id, submissionId: id, runId: id, offerId: id, previousFloatReference: id.nullable() }),
  z.object({ type: z.literal("lockMockRate"), loanId: id, floatReference: id, days: z.literal(mockLockPeriods) }),
  z.object({ type: z.literal("extendMockLock"), ...lockChange, days: z.literal(mockLockExtensionPeriods) }),
  z.object({ type: z.literal("cancelMockLock"), ...lockChange }),
  saveFeeWorksheetInput,
  z.object({ type: z.literal("publishQuote"), loanId: id, runId: id, offerId: id, feeRevision: z.number().int().nonnegative().default(0),
    alternatives: z.array(quoteSelection).max(2).default([]) }),
  z.object({ type: z.literal("withdrawQuote"), loanId: id, publishedAt: z.iso.datetime() }),
  reviewApplicationInput,
  z.object({ type: z.literal("useReviewedLoanAmount"), loanId: id, revision: z.number().int().nonnegative(),
    previousAmount: z.number().int().min(0).max(1_000_000_000) }),
  z.object({ type: z.literal("requestApplicationCorrection"), loanId: id, revision: z.number().int().nonnegative(),
    note: z.string().trim().min(1).max(500),
    recipient: z.enum(["Primary borrower", "Co-borrower"]).default("Primary borrower"),
    lenderReturn: z.object({ eventId: z.uuid(), submissionId: id, lenderRevision: z.number().int().nonnegative() }).optional() }),
  z.object({ type: z.literal("saveLenderDetails"), loanId: id, revision: z.number().int().nonnegative(), details: lenderDetailsSchema }),
  z.object({ type: z.literal("sendApplication"), loanId: id, revision: z.number().int().nonnegative(),
    quote: z.object({ runId: id, offerId: id }).optional() }),
  updateProcessingInput,
]);

class WorkspaceError extends Error {}
class LeadClaimConflict extends WorkspaceError {}
class ReopenedMockClosingConflict extends WorkspaceError {
  readonly loanId: string;

  constructor(loanId: string) {
    super(reopenedMockClosingMessage);
    this.loanId = loanId;
  }
}

function addDocumentRequest(db: Store, loanId: string, kind: DocumentKind, instructions: string, now: string,
  source?: { submissionId: string; conditionId: string }, dueOn: string | null = null, recipient: DocumentRecipient = primaryDocumentRecipient) {
  db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, submissionId, conditionId, dueOn, recipient)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), loanId, kind, instructions, now, source?.submissionId ?? null, source?.conditionId ?? null, dueOn, recipient);
  addApplicationActivity(db, loanId, `Document requested · ${kind}${source ? " · Lender condition" : ""}${dueOn ? ` · Due ${dueOn}` : ""}${recipient !== primaryDocumentRecipient ? ` · ${recipient}` : ""}`, now);
}

function addContactActivity(db: Store, input: {
  eventId: string; contactId: string; kind: ActivityKind; outcome: ContactActivity["outcome"];
  text: string; dueAt: string | null; purpose: FollowUpPurpose;
}, actor: StaffIdentity | null, now: string, owner: { name: string; email: string | null } | null = actor) {
  const name = actor?.name || "Alex Morgan";
  db.prepare(`INSERT INTO contact_activity (id, contactId, officer, officerEmail, kind, outcome, text, createdAt, dueAt, purpose, followUpOwner, followUpOwnerEmail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.eventId, input.contactId, name, actor?.email ?? null, input.kind,
      input.outcome, input.text, now, input.dueAt, input.purpose, input.dueAt ? owner?.name || name : null, input.dueAt ? owner?.email ?? null : null);
}

function authorizeLoanOfficer(db: Store, data: z.infer<typeof command>, staff: WorkspaceStaff | null) {
  if (data.type === "saveRealtorLinkOwner" && staff?.brokerage.role !== "Admin") {
    throw new WorkspaceError("Only a brokerage admin can change referral link routing.");
  }
  if (data.type === "assignContactFollowUp" && staff?.brokerage.role !== "Admin") {
    throw new WorkspaceError("Only a brokerage admin can reassign contact follow-ups.");
  }
  if (!staff || staff.brokerage.role === "Admin") return;
  const denied = () => { throw new WorkspaceError("You don’t have access to this workspace action or loan."); };
  const access = (loanId: unknown) => typeof loanId === "string" ? loanAccess(db, staff, loanId) : null;
  const owns = (loanId: unknown) => access(loanId) === "owner";
  if (data.type === "contact" || data.type === "deleteContact" || data.type === "deleteLoan" || data.type === "sync" || data.type === "simulateUwmChanges" || data.type === "saveBrokerageTemplate" ||
    data.type === "createRealtorPortal" || data.type === "revokeRealtorPortal") denied();
  if (staff.brokerage.role === "Processor") {
    const permitted = ["refreshWorkspace", "refreshApplication", "loadLoanAudit", "exportReviewedApplication", "reviewApplication", "requestApplicationCorrection",
      "saveLenderDetails", "requestDocument", "setDocumentDeadline", "requestSuggestedUwmDocuments", "applyDocumentPreset", "applyDocumentTemplate", "reviewDocument", "sendConditionDocument", "simulateDeliveryFailure",
      "refreshMockUwmClearance", "reviewUwmAlert", "createTask", "completeTask", "note", "copyDraft",
      "recordManualHandoff", "submission", "saveClosingTarget", "saveClosingItem", "completeClosingItem", "recordClosing",
      "recordFunding", "saveDisclosureStatus", "prepareClosingHandoff", "saveManualCondition", "recordManualDelivery", "recordManualClearance", "updateProcessing"];
    if (!permitted.includes(data.type)) denied();
  }
  if ("loanId" in data && !access(data.loanId)) denied();
  if ((data.type === "createTask" || data.type === "reviewUwmAlert" || data.type === "recordCarriedCampaignCallback" ||
    data.type === "rescheduleCarriedCampaignCallback") && !owns(data.loanId)) denied();
  if (data.type === "move" && !owns(data.id)) denied();
  if (data.type === "completeTask" && !owns(db.prepare("SELECT loanId FROM tasks WHERE id = ?").get(data.id)?.loanId)) denied();
  if (data.type === "deleteSubmission" && !owns(db.prepare("SELECT loanId FROM submissions WHERE id = ?").get(data.id)?.loanId)) denied();
  if (data.type === "submission" && data.id && db.prepare("SELECT loanId FROM submissions WHERE id = ?").get(data.id)?.loanId !== data.loanId) denied();
  if (data.type === "loan" || data.type === "optOutContact" || data.type === "logContactActivity") {
    if (data.type === "loan" && data.id && !owns(data.id)) denied();
    for (const contactId of data.type === "loan" ? [data.contactId, data.partnerId] : [data.contactId]) {
      if (contactId && !db.prepare("SELECT 1 FROM loans WHERE officerEmail = ? AND (contactId = ? OR partnerId = ?)").get(staff.email, contactId, contactId) &&
        !db.prepare("SELECT 1 FROM contacts WHERE id = ? AND addedBy = ?").get(contactId, staff.email)) denied();
    }
  }
}

export function staffCampaignOptOutTarget(db: Store, staff: WorkspaceStaff, input: unknown) {
  const target = campaignOptOutTarget(input);
  if (!staff.brokerage.pilot || staff.brokerage.role === "Processor" || !target) return;
  const parsed = command.safeParse(input);
  if (!parsed.success) return;
  const { data } = parsed;
  try { authorizeLoanOfficer(db, data, staff); }
  catch (error) { if (error instanceof WorkspaceError) return; throw error; }
  if (data.type === "optOutContact") return db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role <> 'Realtor'").get(data.contactId) ? target : undefined;
  const owner = staff.brokerage.role === "LO" ? staff.email : null;
  if (data.type === "recordCampaignCall") {
    const current = db.prepare(`SELECT 1 FROM call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId
      LEFT JOIN lead_follow_up follow ON follow.leadId = lead.id WHERE member.campaignId = ? AND lead.id = ?
      AND lead.resolvedAt IS NULL AND lead.heldAt IS NULL AND lead.officerEmail IS NOT NULL AND (? IS NULL OR lead.officerEmail = ?)
      AND coalesce(follow.revision, 0) = ? AND coalesce(member.lastOutcome, '') <> 'Opted out'`)
      .get(data.campaignId, data.leadId, owner, owner, data.revision);
    return current ? target : undefined;
  }
  if (data.type !== "leadOptOut") return;
  return db.prepare("SELECT 1 FROM referral_leads WHERE id = ? AND resolvedAt IS NULL AND (? IS NULL OR officerEmail = ?)")
    .get(data.leadId, owner, owner) ? target : undefined;
}

const pilotLoanActions: Partial<Record<z.infer<typeof command>["type"], string>> = {
  reviewApplication: "Reviewed 1003", selectOffer: "Saved quote", publishQuote: "Shared sample quote",
  requestDocument: "Requested document", requestSuggestedUwmDocuments: "Requested suggested condition documents", reviewDocument: "Reviewed document",
  sendConditionDocument: "Recorded mock UWM delivery", refreshMockUwmClearance: "Checked mock UWM clearance",
};

const loanAuditActions = {
  loan: "Edited loan", move: "Moved pipeline stage", markClearToClose: "Confirmed Clear to Close", loanDisposition: "Changed loan status",
  saveClosingTarget: "Updated closing target", recordClosing: "Recorded closing", recordFunding: "Recorded funding", reverseFunding: "Reversed funding",
  saveDisclosureStatus: "Updated disclosures", saveRetention: "Updated closing details",
  reviewApplication: "Reviewed 1003", requestApplicationCorrection: "Requested 1003 correction",
  useReviewedLoanAmount: "Matched recorded amount to reviewed 1003",
  updateProcessing: "Updated processing handoff", saveCallReport: "Updated call report facts",
  linkCampaignSampleRealtor: "Linked sample realtor",
} as const;

export interface WorkspaceMutationSuccess {
  state: Workspace;
  message: string;
  referralLoanId?: string;
  restoredLeadId?: string;
  applicationLoanId?: string;
  applicationToken?: string;
  migration?: MigrationReport;
  segmentPreview?: SegmentPreview;
  mismoXml?: string;
  mismoDuplicateLoanId?: string;
  loanAudit?: LoanAuditEvent[];
}
export type WorkspaceMutationScope = "inbox" | "tasks" | "realtors" | "migration";
type TaskMutationResult = { tasksChanged: true; message: string };
const taskCommands = new Set(["completeTask", "reviewUwmAlert", "assignContactFollowUp", "rescheduleBorrowerCallback", "completeContactFollowUp"]);

const inboxCommands = new Set(["assignInboxLead", "claimSharedRealtor", "completeLeadTask", "leadContact", "leadSequence", "leadHold",
  "dismissReferral", "restoreLead", "convertReferral", "leadOptOut", "saveLeadRouting", "saveRealtorClaimPolicy"]);

function scopedLeadId(data: z.infer<typeof command>) {
  switch (data.type) {
    case "assignInboxLead":
    case "claimSharedRealtor":
    case "rescheduleCampaignCallback":
    case "recordCampaignFollowUp":
    case "completeLeadTask":
      return data.leadId;
    case "assignCampaignLeads":
      return data.leads.length === 1 ? data.leads[0].id : undefined;
    case "recordCampaignCall":
      // Opting out also stops outreach on other records that match the borrower.
      return data.outcome === "Opted out" ? undefined : data.leadId;
  }
}

function scopedLoanId(data: z.infer<typeof command>) {
  switch (data.type) {
    case "move":
      return data.id;
    case "recordManualHandoff":
      return data.lenderFile ? data.loanId : undefined;
    case "requestApplicationCorrection":
      return data.lenderReturn ? data.loanId : undefined;
    case "markClearToClose":
    case "useReviewedLoanAmount":
    case "saveClosingTarget":
    case "saveClosingItem":
    case "completeClosingItem":
    case "prepareClosingHandoff":
    case "requestDocument":
    case "enableJointApplication":
    case "revokeJointLink":
    case "replaceJointLink":
    case "setDocumentDeadline":
    case "updateProcessing":
    case "requestSuggestedUwmDocuments":
    case "reviewDocument":
    case "runMockCredit":
    case "runMockAus":
    case "runMockPairedAus":
    case "retryMockCreditAus":
    case "saveFeeWorksheet":
    case "applyDocumentPreset":
    case "applyDocumentTemplate":
    case "sendConditionDocument":
    case "simulateDeliveryFailure":
    case "refreshMockUwmClearance":
    case "reopenMockUwmCondition":
    case "copyDraft":
    case "saveRetention":
    case "recordCarriedCampaignCallback":
    case "rescheduleCarriedCampaignCallback":
      return data.loanId;
  }
}

export async function executeCommand(db: Store, input: unknown, staff: WorkspaceStaff | null = null, referralOwner?: StaffIdentity,
  leadMembers: CampaignRehearsalMember[] = [], { scopedLeadUpdates = false, scopedLoanUpdates = false, scopedContactUpdates = false,
    scopedInboxUpdates = false, scopedTaskUpdates = false, scopedTemplateUpdates = false, scopedRealtorUpdates = false, scopedMigrationUpdates = false,
    protectPilotLinks, reviewRouting, campaignRefillRoster, campaignOptOutRoster }:
  { scopedLeadUpdates?: boolean; scopedLoanUpdates?: boolean; scopedContactUpdates?: boolean; scopedInboxUpdates?: boolean; scopedTaskUpdates?: boolean;
    scopedTemplateUpdates?: boolean; scopedRealtorUpdates?: boolean; scopedMigrationUpdates?: boolean; protectPilotLinks?: ProtectPilotLinks;
    reviewRouting?: { reviewerEmail: string; reviewer: VersionedBrokerageMember | null }; campaignRefillRoster?: CampaignRefillRoster; campaignOptOutRoster?: CampaignOptOutRoster } = {}):
  Promise<WorkspaceMutationSuccess | LeadMutationResult | CampaignMutationResult | CampaignNavigationResult | CampaignQueueResult | LoanMutationResult |
    ContactMutationResult | LeadInboxMutation | TaskMutationResult | TemplateMutationResult | RealtorMutationResult | PlaybookSettingsMutation |
    MigrationMutationResult | { error: string; claimConflict?: true; closingHoldWork?: LoanMutationResult["loanWork"] }> {
  const parsed = command.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the form and try again." };
  const data = parsed.data;
  try {
    authorizeLoanOfficer(db, data, staff);
    if (data.type === "openCampaigns") {
      const campaignNavigation = db.transaction(() => readCampaignNavigation(db, data.campaignId, staff, data.loadIntake));
      return { campaignNavigation, message: "Campaigns are up to date." };
    }
    if (data.type === "refreshCampaignQueue") {
      const campaignQueue = db.transaction(() => readCampaignQueue(db, data.campaignId, staff));
      return { campaignQueue, message: campaignQueue.campaign ? "Campaign queue refreshed." : "This campaign is no longer in your queue." };
    }
    if (protectPilotLinks && (data.type === "revokeApplication" || data.type === "revokeJointLink" ||
      data.type === "revokeRealtorPortal" || data.type === "createRealtorPortal")) {
      if (data.type === "createRealtorPortal" &&
        (!db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role = 'Realtor'").get(data.realtorId) ||
          (data.officerEmail && (referralOwner ?? staff)?.email !== data.officerEmail))) {
        throw new WorkspaceError("Choose a realtor contact and an active staff member in this brokerage.");
      }
      const link = data.type === "revokeApplication" || data.type === "revokeJointLink"
        ? db.prepare(`SELECT token, expiresAt FROM ${data.type === "revokeJointLink" ? "joint_applications" : "applications"}
          WHERE loanId = ? AND token = ?`).get(data.loanId, data.token)
        : db.prepare("SELECT token, expiresAt FROM realtor_portals WHERE realtorId = ?").get(data.realtorId);
      if (typeof link?.token === "string" && typeof link.expiresAt === "string") {
        const protectedLink = await protectPilotLinks([{ token: link.token, expiresAt: link.expiresAt }]);
        if (!protectedLink) throw new WorkspaceError("Orbit could not protect the link change. Try again.");
        authorizeLoanOfficer(db, data, staff);
        if (data.type === "revokeRealtorPortal" || data.type === "createRealtorPortal") {
          const current = db.prepare("SELECT token FROM realtor_portals WHERE realtorId = ?").get(data.realtorId);
          if (current && current.token !== link.token) throw new WorkspaceError("The realtor link changed. Refresh before continuing.");
        }
      }
    }
    if (data.type === "loadGuidedDemo") {
      if (staff && (!staff.brokerage.pilot || staff.brokerage.role !== "Admin")) throw new WorkspaceError("An admin can load the demo in a fictional pilot workspace.");
      const owner = staff ?? { name: "Alex Morgan", email: "local-demo@example.test" };
      const result = await loadProtectedPilotScenario(db, staff, { ...data, type: "loadPilotScenario", officerEmail: owner.email }, owner, protectPilotLinks);
      if ("error" in result) throw new WorkspaceError(result.error);
      return { state: scopeWorkspace(readWorkspace(db, staff?.brokerage.role === "Admin"), staff), message: result.message };
    }
    if (data.type === "sync" || data.type === "simulateUwmChanges") {
      const result = data.type === "sync" ? await syncUwm(db) : simulateMockUwmChanges(db);
      if ("error" in result) throw new WorkspaceError(result.error);
      return { state: scopeWorkspace(readWorkspace(db, staff?.brokerage.role === "Admin"), staff),
        message: `UWM sync complete · ${result.imported} imported · ${result.updated} refreshed · ${result.conditions} conditions · ${result.alerts} new alerts` };
    }
    if (data.type === "runPricing") {
      if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
      const currentRevision = () => getApplication(db, data.loanId)?.revision ?? null;
      const checkReviewedIncome = () => {
        if (data.incomeReviewRevision === undefined) return;
        if (!staff?.brokerage.pilot || data.scenario.nonAgency) throw new WorkspaceError("Reviewed worksheet income is available for conventional mock pricing.");
        const amount = approvedIncomeAmount(db, data.loanId, data.incomeReviewRevision);
        if (amount === null || data.scenario.monthlyIncome !== amount / 100) throw new WorkspaceError(repriceIncomeMessage);
      };
      if (currentRevision() !== data.applicationRevision) throw new WorkspaceError("The 1003 changed. Reload its inputs before running pricing.");
      checkReviewedIncome();
      const result = await pricingProvider(data.incomeReviewRevision === undefined && isDemoStaff(staff) ? process.env : {}).quote(data.scenario);
      return db.transaction(() => {
        authorizeLoanOfficer(db, data, staff);
        if (currentRevision() !== data.applicationRevision) throw new WorkspaceError("The 1003 changed while pricing. Reload its inputs and try again.");
        checkReviewedIncome();
        db.prepare(`INSERT INTO pricing_runs
          (id, loanId, provider, mode, reference, scenario, offers, notices, quotedAt, applicationRevision, incomeReviewRevision)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(crypto.randomUUID(), data.loanId, result.provider, result.mode, result.reference,
            JSON.stringify(data.scenario), JSON.stringify(result.offers), JSON.stringify(result.notices), new Date().toISOString(),
            data.applicationRevision, data.incomeReviewRevision ?? null);
        if (staff?.brokerage.pilot) accessEvent(db, staff, "Ran sample pricing", data.loanId, new Date().toISOString());
        return { state: scopeWorkspace(workspace(db, staff?.brokerage.role === "Admin"), staff), message: `${result.offers.length} pricing options returned.` };
      });
    }
    const now = new Date().toISOString();
    return db.transaction(() => {
      let message = data.type.startsWith("delete") ? "Removed successfully." : "Saved successfully.";
      let referralLoanId: string | undefined;
      let applicationLoanId: string | undefined;
      let editedLoanId: string | undefined;
      let savedContactId: string | undefined;
      let migration: MigrationReport | undefined;
      let segmentPreview: SegmentPreview | undefined;
      let mismoXml: string | undefined;
      let mismoDuplicateLoanId: string | undefined;
      let loanAudit: LoanAuditEvent[] | undefined;
      let releasedCampaignSlot = data.type !== "recordCampaignCall";
      const releaseTarget = !staff || campaignRefillRoster ? campaignRefillTarget(data) : undefined;
      const refill = releaseTarget ? campaignReleaseRouting(db, staff, releaseTarget) : undefined;
      const optOutTarget = campaignOptOutTarget(data);
      const optOutCapacity = optOutTarget ? captureCampaignOptOutCapacity(db, staff, campaignOptOutRoster, optOutTarget) : [];
      const auditAction = loanAuditActions[data.type as keyof typeof loanAuditActions];
      const auditLoanId = auditAction && ("loanId" in data ? data.loanId : data.type === "loan" || data.type === "move" ? data.id : undefined);
      const auditBefore = auditLoanId ? loanAuditSnapshot(db, auditLoanId) : null;
      switch (data.type) {
        case "savePlaybook": {
          if (staff && staff.brokerage.role !== "Admin") throw new WorkspaceError("Only a brokerage admin can edit playbooks.");
          if (data.backupEmail && !leadMembers.some((member) => member.email === data.backupEmail)) throw new WorkspaceError("Select an active loan officer or admin as the backup.");
          const policy = readPlaybook(db);
          if (data.revision !== policy.revision) throw new WorkspaceError("The playbook changed. Refresh before saving.");
          const secondReview = data.secondReview === undefined ? policy.secondReview : data.secondReview;
          const requireSecondReview = data.requireSecondReview ?? policy.requireSecondReview;
          const routingChanged = secondReview?.reviewerEmail !== policy.secondReview?.reviewerEmail || secondReview?.dueDays !== policy.secondReview?.dueDays;
          if (!staff && (routingChanged || requireSecondReview !== policy.requireSecondReview)) {
            throw new WorkspaceError("Sign in as a brokerage admin to change second-review rules.");
          }
          if (secondReview && routingChanged &&
            !leadMembers.some((member) => member.email === secondReview.reviewerEmail && member.role === "Admin" && member.status === "Active")) {
            throw new WorkspaceError("Select an active brokerage admin for the second review.");
          }
          writePlaybook(db, { revision: data.revision, quietHours: data.quietHours, reviewHours: data.reviewHours,
            handoffHours: data.handoffHours, fundingDays: data.fundingDays, backupEmail: data.backupEmail, secondReview, requireSecondReview,
            documentReminderOffsetDays: data.documentReminderOffsetDays ?? policy.documentReminderOffsetDays,
            manualReturnHours: data.manualReturnHours ?? policy.manualReturnHours });
          accessEvent(db, staff, "Updated brokerage playbook", "playbook", now);
          message = "Brokerage playbook saved.";
          if (scopedTaskUpdates) return { playbookSettings: readPlaybook(db), message };
          break;
        }
        case "migratePipeline": {
          if (data.campaignId && !mayManageCampaigns(staff)) throw new WorkspaceError("Only a pilot admin can import campaign leads.");
          if (!data.campaignId && (!staff?.brokerage.pilot || staff.brokerage.role !== "Admin")) throw new WorkspaceError("Only a pilot admin can migrate fictional CRM records.");
          const result = migratePipeline(db, data, staff, leadMembers, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          migration = result.migration;
          if (scopedLeadUpdates && data.campaignId) {
            const leadIds = migration.rows.flatMap((row) => row.targetId &&
              (row.status === "Create" || row.status === "Previously imported") ? [row.targetId] : []);
            return { message, migration, campaignWork: data.preview ?
              campaignWorkPatch(db, data.campaignId, leadIds, staff?.brokerage.role === "Admin") : null };
          }
          if (scopedMigrationUpdates && !data.campaignId) return { message, migration, migrationChanged: Boolean(data.preview) };
          break;
        }
        case "undoMigration": {
          const result = undoMigration(db, staff, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          if (scopedMigrationUpdates) return { message, migrationChanged: true };
          break;
        }
        case "assignCampaignLeads": {
          if (!mayManageCampaigns(staff)) throw new WorkspaceError("Only a pilot admin can assign campaign leads in bulk.");
          const result = assignCampaignLeads(db, staff, data, leadMembers, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          if (scopedLeadUpdates && data.leads.length > 1) {
            return { message, campaignWork: campaignWorkPatch(db, data.campaignId, data.leads.map(({ id }) => id), staff?.brokerage.role === "Admin") };
          }
          break;
        }
        case "loadCampaignRehearsal": {
          const result = loadCampaignRehearsal(db, staff, data.id, leadMembers, now, data.buyerEmail);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "linkCampaignSampleRealtor": {
          const result = linkCampaignSampleRealtor(db, data, staff, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "saveCampaignRouting":
        case "routeCampaignQueue": {
          if (!mayManageCampaigns(staff)) throw new WorkspaceError("Only a pilot admin can manage campaign routing.");
          if (data.type === "saveCampaignRouting") {
            const result = saveCampaignRouting(db, staff, data, leadMembers, now);
            if ("error" in result) throw new WorkspaceError(result.error);
            message = result.message;
          } else {
            if (!readCampaignRouting(db, data.campaignId)?.enabled) throw new WorkspaceError("Enable round-robin routing first.");
            const result = distributeCampaignLeads(db, staff, data.campaignId, staff ? leadMembers : undefined, now);
            message = `${result.assigned} routed · ${result.remaining} eligible ${result.remaining === 1 ? "lead remains" : "leads remain"} in the shared inbox.`;
          }
          break;
        }
        case "saveCampaignRules":
        case "pauseCampaignRetries": {
          if (!mayManageCampaigns(staff)) throw new WorkspaceError("Only a pilot admin can edit campaign rules.");
          const result = data.type === "saveCampaignRules" ? saveCampaignRules(db, staff, data, now) : pauseCampaignRetries(db, staff, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "saveCrmSegment":
        case "enrollCrmSegment": {
          if (!mayManageCampaigns(staff)) throw new WorkspaceError("Only a pilot admin can manage CRM segments.");
          const result = data.type === "saveCrmSegment" ? saveCrmSegment(db, staff, data, now) : enrollCrmSegment(db, staff, data, now, leadMembers);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          segmentPreview = result.preview;
          break;
        }
        case "createCallCampaign":
        case "addCampaignLead":
        case "recordCampaignCall": {
          if (data.type !== "recordCampaignCall" && !mayManageCampaigns(staff)) throw new WorkspaceError("Only a pilot admin can manage call campaigns.");
          const result = data.type === "createCallCampaign" ? createCallCampaign(db, staff, data, now) :
            data.type === "addCampaignLead" ? linkCampaignLead(db, data.campaignId, data.leadId, now) : recordCampaignCall(db, staff, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          if ("releasedCampaignSlot" in result) releasedCampaignSlot = result.releasedCampaignSlot;
          if ("added" in result && result.added && data.type === "addCampaignLead") {
            accessEvent(db, staff, "Added lead to call campaign", data.leadId, now);
            const { assigned } = distributeCampaignLeads(db, staff, data.campaignId, staff ? leadMembers : undefined, now, [data.leadId]);
            if (assigned) message = "Lead added and routed to the next available officer.";
          }
          if (scopedLeadUpdates && data.type === "addCampaignLead") {
            return { message, campaignWork: campaignWorkPatch(db, data.campaignId, [data.leadId], staff?.brokerage.role === "Admin") };
          }
          break;
        }
        case "rescheduleCampaignCallback": {
          const result = rescheduleCampaignCallback(db, staff, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "recordCampaignFollowUp": {
          const result = recordCampaignFollowUp(db, staff, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "loadLoanAudit": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          loanAudit = loanAuditHistory(db, data.loanId);
          message = "Loan audit history loaded.";
          break;
        }
        case "saveCallReport": {
          if (staff?.brokerage.role !== "Admin") throw new WorkspaceError("Only brokerage admins can confirm call report facts.");
          if (!auditBefore) throw new WorkspaceError("This loan no longer exists.");
          const today = easternDate(new Date(now));
          if (data.facts.receivedDate > today || data.facts.outcomeDate > today) throw new WorkspaceError("Enter dates on or before today.");
          const stored = db.prepare("SELECT facts, revision FROM call_report_facts WHERE loanId = ?").get(data.loanId);
          const facts = JSON.stringify(data.facts);
          if (stored?.facts === facts) break;
          if (Number(stored?.revision ?? 0) !== data.revision) throw new WorkspaceError("Call report facts changed. Reopen the loan before saving.");
          db.prepare(`INSERT INTO call_report_facts (loanId, facts, revision) VALUES (?, ?, 1)
            ON CONFLICT (loanId) DO UPDATE SET facts = excluded.facts, revision = revision + 1`).run(data.loanId, facts);
          message = "Call report facts saved.";
          break;
        }
        case "saveReportView":
        case "deleteReportView": {
          if (!staff || staff.brokerage.role !== "Admin") throw new WorkspaceError("Only brokerage admins can save manager report views.");
          if (data.type === "saveReportView") {
            if (Number(db.prepare("SELECT count(*) AS count FROM manager_report_views").get()?.count) >= 30 &&
              !db.prepare("SELECT 1 FROM manager_report_views WHERE id = ?").get(data.id)) throw new WorkspaceError("Remove a saved view before adding another.");
            db.prepare("INSERT INTO manager_report_views (id, name, filters) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING")
              .run(data.id, data.name, JSON.stringify(data.filters));
            message = "Manager report view saved for this brokerage.";
          } else {
            db.prepare("DELETE FROM manager_report_views WHERE id = ?").run(data.id);
            message = "Manager report view removed.";
          }
          break;
        }
        case "importMismo": {
          if (!staff?.brokerage.pilot || staff.brokerage.role !== "Admin") throw new WorkspaceError("Only a pilot admin can import a synthetic loan file.");
          const result = createMismoRehearsal(db, staff, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          applicationLoanId = result.loanId;
          mismoDuplicateLoanId = result.duplicateLoanId;
          message = mismoDuplicateLoanId ? "An imported 1003 already matches this borrower and mapping." : "Fictional 1003 draft created from the reviewed mapping.";
          if (scopedMigrationUpdates) return { message, migrationChanged: Boolean(applicationLoanId), applicationLoanId, mismoDuplicateLoanId };
          break;
        }
        case "exportReviewedApplication": {
          if (!staff) throw new WorkspaceError("Sign in to download an application.");
          const result = prepareLenderExport(db, data, staff, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          mismoXml = result.xml;
          message = "MISMO 3.4 XML prepared for manual handoff.";
          break;
        }
        case "exportMismo": {
          if (!staff?.brokerage.pilot) throw new WorkspaceError("Synthetic loan files are available in pilot workspaces.");
          const xml = exportMismoRehearsal(db, staff, data.loanId);
          if (!xml) throw new WorkspaceError("This synthetic loan file is unavailable.");
          mismoXml = xml;
          message = "Synthetic XML ready to download.";
          break;
        }
        case "completeLeadTask": {
          const result = setImportedLeadTaskStatus(db, data, now, staff?.brokerage.role === "LO" ? staff.email : undefined);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "reviewUwmAlert": {
          const alert = db.prepare("SELECT reviewedAt FROM uwm_alerts WHERE id = ? AND loanId = ?").get(data.alertId, data.loanId);
          if (!alert) throw new WorkspaceError("This alert is unavailable on the loan.");
          if (!alert.reviewedAt) db.prepare("UPDATE uwm_alerts SET reviewedAt = ? WHERE id = ?").run(now, data.alertId);
          message = "UWM alert marked reviewed.";
          break;
        }
        case "runMockCredit":
        case "runMockAus":
        case "runMockPairedAus":
        case "retryMockCreditAus": {
          const result = runMockCreditAus(db, data, staff, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "saveRetention": {
          const loan = db.prepare("SELECT stage FROM loans WHERE id = ?").get(data.loanId);
          if (!loan || !pastClientLoan({ stage: loan.stage as Loan["stage"] })) throw new WorkspaceError("Choose a funded or closed loan for past-client follow-up.");
          if (data.closingDate && data.closingDate > easternDate()) throw new WorkspaceError("Enter the actual closing date on or before today.");
          const previous = db.prepare("SELECT revision, closingDate, observedRate, checkedAt FROM past_client_profiles WHERE loanId = ?").get(data.loanId);
          if (Number(previous?.revision ?? 0) !== data.revision) throw new WorkspaceError("Past-client details changed. Refresh before saving.");
          if (previous?.closingDate !== (data.closingDate || null)) {
            clearPendingAnniversaries(db, data.loanId);
          }
          const observedRate = data.observedRate ? Number(data.observedRate) : null;
          const checkedAt = observedRate === null ? null : observedRate === previous?.observedRate ? previous.checkedAt : now;
          db.prepare(`INSERT INTO past_client_profiles
            (loanId, closingDate, currentRate, targetRate, observedRate, checkedAt, watchEnabled, note, revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(loanId) DO UPDATE SET closingDate = excluded.closingDate, currentRate = excluded.currentRate,
              targetRate = excluded.targetRate, observedRate = excluded.observedRate, checkedAt = excluded.checkedAt,
              watchEnabled = excluded.watchEnabled, note = excluded.note, revision = excluded.revision`)
            .run(data.loanId, data.closingDate || null, data.currentRate ? Number(data.currentRate) : null,
              data.targetRate ? Number(data.targetRate) : null, observedRate,
              checkedAt, data.watchEnabled ? 1 : 0, data.note, data.revision + 1);
          addApplicationActivity(db, data.loanId, "Past-client follow-up details updated.", now);
          message = "Past-client details and reminders saved.";
          break;
        }
        case "saveClosingTarget": {
          const result = setClosingTarget(db, data.loanId, data.previous, data.targetDate, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "saveClosingItem": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          const item = db.prepare("SELECT loanId, revision, title, owner, dueDate FROM closing_items WHERE id = ?").get(data.itemId);
          if (!item && !z.uuid().safeParse(data.itemId).success) throw new WorkspaceError("This closing item no longer exists.");
          if (item && item.loanId !== data.loanId) throw new WorkspaceError("This closing item is unavailable on the loan.");
          if (!item || item.title !== data.title || item.owner !== data.owner || item.dueDate !== data.dueDate) {
            if (Number(item?.revision ?? 0) !== data.revision) throw new WorkspaceError("This closing item changed. Refresh the loan before saving.");
            db.prepare(`INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET title = excluded.title, owner = excluded.owner, dueDate = excluded.dueDate, revision = revision + 1`)
              .run(data.itemId, data.loanId, data.title, data.owner, data.dueDate);
            addApplicationActivity(db, data.loanId, `${item ? "Updated closing item" : "Added closing item"} · ${data.title}`, now);
          }
          message = "Closing checklist item saved.";
          break;
        }
        case "completeClosingItem": {
          const result = setClosingChecklistStatus(db, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "recordClosing": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          if (data.closingDate > easternDate(new Date(now))) throw new WorkspaceError("Enter the actual closing date on or before today.");
          const funding = db.prepare("SELECT fundingDate FROM closing_progress WHERE loanId = ?").get(data.loanId)?.fundingDate;
          if (typeof funding === "string" && data.closingDate > funding) throw new WorkspaceError("The closing date cannot be after the recorded funding date.");
          const profile = db.prepare("SELECT closingDate, revision FROM past_client_profiles WHERE loanId = ?").get(data.loanId);
          if (!profile?.closingDate && hasReopenedMockUwmCondition(db, data.loanId)) {
            throw new ReopenedMockClosingConflict(data.loanId);
          }
          if (profile?.closingDate !== data.closingDate) {
            if (Number(profile?.revision ?? 0) !== data.revision) throw new WorkspaceError("The closing date changed. Refresh the loan before recording it.");
            clearPendingAnniversaries(db, data.loanId);
            db.prepare(`INSERT INTO past_client_profiles (loanId, closingDate, revision) VALUES (?, ?, 1)
              ON CONFLICT(loanId) DO UPDATE SET closingDate = excluded.closingDate, revision = revision + 1`).run(data.loanId, data.closingDate);
            addApplicationActivity(db, data.loanId, `Closing recorded · ${data.closingDate}`, now);
          }
          createMilestoneDrafts(db, data.loanId, "Closing complete", now);
          message = "Closing recorded. Milestone drafts are ready to preview.";
          break;
        }
        case "recordFunding": {
          if (data.simulateFollowUpFailure && staff && (staff.brokerage.role !== "Admin" || !staff.brokerage.pilot)) {
            throw new WorkspaceError("A fictional pilot admin can rehearse a follow-up failure.");
          }
          const loan = db.prepare("SELECT stage, stageSince, disposition FROM loans WHERE id = ?").get(data.loanId);
          const closing = db.prepare("SELECT closingDate FROM past_client_profiles WHERE loanId = ?").get(data.loanId)?.closingDate;
          if (!loan || loan.disposition !== "Active" || typeof closing !== "string" || data.fundingDate < closing || data.fundingDate > easternDate(new Date(now))) {
            throw new WorkspaceError("Record actual closing first. Funding must fall between closing and today on an active file.");
          }
          const previous = db.prepare("SELECT fundingDate, revision FROM closing_progress WHERE loanId = ?").get(data.loanId);
          if (!previous?.fundingDate && hasReopenedMockUwmCondition(db, data.loanId)) {
            throw new ReopenedMockClosingConflict(data.loanId);
          }
          const dateChanged = previous?.fundingDate !== data.fundingDate;
          const revision = Number(previous?.revision ?? 0);
          if (dateChanged) {
            if (revision !== data.revision) throw new WorkspaceError("Funding status changed. Refresh the loan first.");
            const entersFunded = loan.stage !== "Funded" && loan.stage !== "Closed";
            db.prepare(`INSERT INTO closing_progress (loanId, fundingDate, preFundingStage, preFundingStageSince, revision)
              VALUES (?, ?, ?, ?, 1) ON CONFLICT(loanId) DO UPDATE SET fundingDate = excluded.fundingDate, revision = revision + 1,
              preFundingStage = CASE WHEN closing_progress.fundingDate IS NULL THEN excluded.preFundingStage ELSE closing_progress.preFundingStage END,
              preFundingStageSince = CASE WHEN closing_progress.fundingDate IS NULL THEN excluded.preFundingStageSince ELSE closing_progress.preFundingStageSince END`)
              .run(data.loanId, data.fundingDate, entersFunded ? loan.stage : null, entersFunded ? loan.stageSince : null);
            if (entersFunded) db.prepare("UPDATE loans SET stage = 'Funded', stageSince = ? WHERE id = ?").run(now, data.loanId);
            addApplicationActivity(db, data.loanId, `Funding recorded · ${data.fundingDate}`, now);
            accessEvent(db, staff, "Recorded loan funding", data.loanId, now);
          }
          createFundingDrafts(db, data.loanId, now, revision + Number(dateChanged));
          const followUp = startFundingPlaybook(db, { loanId: data.loanId, fundingDate: data.fundingDate, fundingRevision: revision + Number(dateChanged),
            dateChanged, at: now, actor: staff?.name ?? "Demo workspace", simulate: dateChanged && Boolean(data.simulateFollowUpFailure) });
          message = followUp === "Completed" ? "Funding recorded. Milestone drafts and past-client follow-up are ready." :
            "Funding recorded and milestone drafts are ready. An admin can retry the follow-up in Playbooks.";
          break;
        }
        case "recordFundingCheckIn": {
          const dueAt = data.followUp ? `${data.followUp}T17:00:00.000Z` : null;
          const text = data.note ? `${fundingCheckInActivityTitle} · ${data.note}` : fundingCheckInActivityTitle;
          const prior = db.prepare(`SELECT activity.officerEmail, activity.kind, activity.outcome, activity.text,
            coalesce((SELECT previousDueAt FROM contact_callback_reschedules WHERE activityId = activity.id ORDER BY revision LIMIT 1), activity.dueAt) AS dueAt,
            activity.purpose, checkIn.loanId, checkIn.fundingRevision FROM contact_activity activity
            LEFT JOIN funding_check_ins checkIn ON checkIn.activityId = activity.id WHERE activity.id = ?`).get(data.eventId);
          message = dueAt ? "Check-in recorded and the next follow-up is in Tasks." : "Check-in recorded in the borrower’s history.";
          if (prior) {
            if (prior.loanId !== data.loanId || prior.fundingRevision !== data.fundingRevision || prior.officerEmail !== (staff?.email ?? null) ||
              prior.kind !== data.kind || prior.outcome !== data.outcome || prior.text !== text || prior.dueAt !== dueAt || prior.purpose !== data.purpose) {
              throw new WorkspaceError("Start a new check-in entry.");
            }
            break;
          }
          const funded = db.prepare(`SELECT loan.contactId, loan.officer, loan.officerEmail, closing.revision
            FROM loans loan JOIN closing_progress closing ON closing.loanId = loan.id
            WHERE loan.id = ? AND loan.disposition = 'Active' AND closing.fundingDate IS NOT NULL`).get(data.loanId);
          const taskId = fundingTaskId(data.loanId, "borrower");
          if (!funded || funded.revision !== data.fundingRevision || !db.prepare("SELECT 1 FROM tasks WHERE id = ? AND loanId = ? AND completedAt IS NULL")
            .get(taskId, data.loanId)) {
            throw new WorkspaceError("This check-in changed. Refresh the post-funding tasks and open it again.");
          }
          if (data.followUp && data.followUp < easternDate(new Date(now))) throw new WorkspaceError("Choose today or a future date for follow-up.");
          if (data.purpose === "Prospecting" && loanOutreachSuppressed(db, data.loanId)) {
            throw new WorkspaceError("This borrower opted out of brokerage outreach.");
          }
          const owner = typeof funded.officerEmail === "string" || !staff
            ? { name: String(funded.officer), email: funded.officerEmail as string | null } : staff;
          addContactActivity(db, { ...data, contactId: String(funded.contactId), text, dueAt }, staff, now, owner);
          db.prepare("INSERT INTO funding_check_ins (activityId, loanId, fundingRevision) VALUES (?, ?, ?)")
            .run(data.eventId, data.loanId, data.fundingRevision);
          db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ?").run(now, taskId);
          addApplicationActivity(db, data.loanId, "Recorded the post-funding borrower check-in.", now);
          break;
        }
        case "startReturningClient1003": {
          const funded = returningClientSource(db, data.loanId);
          if (!funded) throw new WorkspaceError(data.fromRateWatch ? "This past-client loan is unavailable. Refresh the follow-up before starting a 1003." :
            "This loan no longer has active funding. Refresh the post-funding tasks.");
          const existing = funded.repeatId;
          if (typeof existing === "string") {
            if (staff && !loanAccess(db, staff, existing)) throw new WorkspaceError("Ask a brokerage admin to review access to the linked returning-client application.");
            applicationLoanId = existing;
            message = "Opened the existing returning-client 1003.";
            break;
          }
          const rateTaskId = data.fromRateWatch ? activeRateWatchTask(db, data.loanId) : undefined;
          if (data.fromRateWatch && (!rateTaskId || data.purpose !== "Refinance")) {
            throw new WorkspaceError("The rate-watch follow-up changed. Refresh the loan before starting its refinance 1003.");
          }
          if (!data.fromRateWatch && (!funded.fundingDate || (!db.prepare("SELECT 1 FROM tasks WHERE id = ? AND loanId = ? AND completedAt IS NULL")
            .get(fundingTaskId(data.loanId, "borrower"), data.loanId) && !recordedFundingCheckIn(db, data.loanId)))) {
            throw new WorkspaceError("Open the borrower’s post-funding check-in before starting its returning-client 1003.");
          }
          const propertyAddress = data.confirmedPropertyAddress;
          if (propertyAddress && data.purpose !== "Refinance") {
            throw new WorkspaceError("Choose Refinance to reuse the original property address.");
          }
          if (propertyAddress && propertyAddress !== reusablePropertyAddress(String(funded.address))) {
            throw new WorkspaceError("The original property address changed. Reopen the refinance setup and confirm the current address.");
          }
          const loanId = crypto.randomUUID();
          insertLoan(db, {
            id: loanId, contactId: String(funded.contactId), partnerId: null, officer: String(funded.officer),
            officerEmail: funded.officerEmail as string | null, address: "", amount: 0, purpose: data.purpose,
            stage: "Lead", stageSince: now, leadSource: "Returning client",
          });
          if (!startApplication(db, loanId, now, staff?.brokerage.id, { propertyAddress })) {
            throw new WorkspaceError("Orbit could not start the returning-client 1003.");
          }
          db.prepare("INSERT INTO returning_client_loans (fundedLoanId, loanId) VALUES (?, ?)").run(data.loanId, loanId);
          if (rateTaskId) db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ?").run(now, rateTaskId);
          recordLoanAudit(db, loanId, staff, "Created returning-client loan", now, null);
          addApplicationActivity(db, data.loanId, rateTaskId ? "Started a refinance 1003 from the rate-watch follow-up." :
            "Started a returning-client 1003 from the borrower check-in.", now);
          accessEvent(db, staff, "Started returning-client 1003", loanId, now);
          applicationLoanId = loanId;
          message = "Returning-client lead saved and 1003 started.";
          break;
        }
        case "reverseFunding": {
          if (staff && staff.brokerage.role !== "Admin") throw new WorkspaceError("Only a brokerage admin can reverse funding.");
          const previous = db.prepare(`SELECT progress.fundingDate, progress.revision, progress.preFundingStage, progress.preFundingStageSince, loan.stage
            FROM closing_progress progress JOIN loans loan ON loan.id = progress.loanId WHERE progress.loanId = ?`).get(data.loanId);
          if (!previous || previous.fundingDate !== data.fundingDate || previous.revision !== data.revision) {
            throw new WorkspaceError("Funding status changed. Refresh the loan before reversing it.");
          }
          const stage = fundingReversalStage(previous.stage as Loan["stage"], previous.preFundingStage as Loan["stage"] | null);
          if (stage !== previous.stage) {
            db.prepare("UPDATE loans SET stage = ?, stageSince = ? WHERE id = ?")
              .run(stage, stage === previous.preFundingStage ? previous.preFundingStageSince ?? now : now, data.loanId);
          }
          archiveFundingFinancials(db, data.loanId, data.fundingDate, now);
          db.prepare(`UPDATE closing_progress SET fundingDate = NULL, preFundingStage = NULL, preFundingStageSince = NULL,
            revision = revision + 1, fundingCycle = fundingCycle + 1 WHERE loanId = ?`).run(data.loanId);
          db.prepare(`UPDATE call_report_facts SET facts = json_set(facts, '$.outcome', '', '$.outcomeDate', '', '$.outcomeAmount', NULL),
            revision = revision + 1 WHERE loanId = ? AND json_extract(facts, '$.outcome') = 'Closed and funded'`).run(data.loanId);
          retireFundingFollowUps(db, data.loanId, data.revision + 1);
          supersedeFundingPlaybook(db, data.loanId, "Funding reversed");
          supersedeFundingDrafts(db, data.loanId, now);
          addApplicationActivity(db, data.loanId, `Funding reversed · ${data.fundingDate} · ${data.reason}`, now);
          accessEvent(db, staff, "Reversed loan funding", data.loanId, now);
          message = `Funding reversed. The file is at ${stage}.`;
          break;
        }
        case "saveDisclosureStatus": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          if (data.status !== "Not started" && (!data.date || data.date > easternDate(new Date(now)))) throw new WorkspaceError("Enter the date this step was completed.");
          const date = data.status === "Not started" ? null : data.date;
          const previous = db.prepare("SELECT disclosureStatus, disclosureDate, revision FROM closing_progress WHERE loanId = ?").get(data.loanId);
          if ((previous?.disclosureStatus ?? "Not started") !== data.status || (previous?.disclosureDate ?? null) !== date) {
            if (Number(previous?.revision ?? 0) !== data.revision) throw new WorkspaceError("Disclosure status changed. Refresh the loan first.");
            db.prepare(`INSERT INTO closing_progress (loanId, disclosureStatus, disclosureDate, revision) VALUES (?, ?, ?, 1)
              ON CONFLICT(loanId) DO UPDATE SET disclosureStatus = excluded.disclosureStatus, disclosureDate = excluded.disclosureDate, revision = revision + 1`)
              .run(data.loanId, data.status, date);
            addApplicationActivity(db, data.loanId, `Manual disclosure status · ${data.status}${date ? ` · ${date}` : ""}`, now);
          }
          message = "Manual disclosure status saved.";
          break;
        }
        case "prepareClosingHandoff": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          const steps = [
            ["lo", "Review borrower and lender handoff", "Loan officer"],
            ["processor", "Confirm conditions and closing package", "Processor"],
            ["funding", "Confirm funding and prepare follow-up", "Loan officer"],
          ];
          let added = 0;
          for (const [key, title, owner] of steps) {
            const itemId = `closing-handoff:${data.loanId}:${key}`;
            if (db.prepare("SELECT 1 FROM closing_items WHERE id = ?").get(itemId)) continue;
            db.prepare("INSERT INTO closing_items (id, loanId, title, owner, dueDate) VALUES (?, ?, ?, ?, ?)").run(itemId, data.loanId, title, owner, data.dueDate);
            added++;
          }
          if (added) addApplicationActivity(db, data.loanId, "Prepared closing handoff checklist.", now);
          message = added ? "Closing handoff checklist added." : "Closing handoff checklist is already in place.";
          break;
        }
        case "createRealtorPortal": {
          if (!db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role = 'Realtor'").get(data.realtorId)) throw new WorkspaceError("Choose a realtor contact.");
          const owner = data.officerEmail === null ? null : referralOwner ?? staff;
          if (data.officerEmail && owner?.email !== data.officerEmail) throw new WorkspaceError("Select an active staff member in this brokerage.");
          const token = portalToken(staff?.brokerage.id);
          const expiresAt = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
          db.prepare(`INSERT INTO realtor_portals (realtorId, token, expiresAt, officer, officerEmail) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(realtorId) DO UPDATE SET token = excluded.token, expiresAt = excluded.expiresAt,
              officer = excluded.officer, officerEmail = excluded.officerEmail, revision = realtor_portals.revision + 1`)
            .run(data.realtorId, token, expiresAt, owner?.name.slice(0, 160) || (data.officerEmail === null ? "" : "Alex Morgan"), owner?.email ?? null);
          accessEvent(db, staff, "Issued realtor link", data.realtorId, now);
          message = "Realtor referral link is ready. It expires in seven days.";
          break;
        }
        case "saveRealtorLinkOwner": {
          const owner = data.officerEmail === null ? null : referralOwner ?? staff;
          if (data.officerEmail && owner?.email !== data.officerEmail) throw new WorkspaceError("Select an active loan officer or admin in this brokerage.");
          if (!staff) throw new WorkspaceError("Only a brokerage admin can change referral link routing.");
          const result = saveRealtorLinkOwner(db, data, owner, staff, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "revokeRealtorPortal": {
          if (db.prepare("SELECT 1 FROM realtor_portals WHERE realtorId = ?").get(data.realtorId)) accessEvent(db, staff, "Revoked realtor link", data.realtorId, now);
          db.prepare("DELETE FROM realtor_portals WHERE realtorId = ?").run(data.realtorId);
          message = "Realtor referral link revoked.";
          break;
        }
        case "saveLeadRouting": {
          const result = changeLeadRouting(db, staff, data, leadMembers);
          if ("error" in result) throw new WorkspaceError(result.error);
          accessEvent(db, staff, "Updated lead routing", staff?.brokerage.id ?? demoBrokerageId, now);
          message = result.message;
          break;
        }
        case "saveRealtorClaimPolicy":
        case "claimSharedRealtor": {
          const result = data.type === "saveRealtorClaimPolicy" ? saveRealtorClaimPolicy(db, staff, data, leadMembers, now) :
            claimSharedRealtor(db, staff, data.leadId, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "assignInboxLead":
        case "leadOptOut":
        case "leadHold":
        case "leadSequence":
        case "leadContact": {
          const shareOnReactivation = data.type === "leadHold" && data.action === "Reactivate" && returnCampaignLeadToShared(db, staff, data.leadId, "hold");
          const result = updateInboxLead(db, staff, data, leadMembers, now, { shareOnReactivation });
          if ("claimConflict" in result) throw new LeadClaimConflict(result.error);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "dismissReferral": {
          const result = archiveLead(db, staff, data.referralId, data.revision, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          stopCampaignFollowUp(db, staff, data.referralId, now, "lead archived");
          message = result.message;
          break;
        }
        case "restoreLead": {
          const toShared = returnCampaignLeadToShared(db, staff, data.leadId, "archive");
          const result = restoreArchivedLead(db, staff, data, now, toShared);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "convertReferral": {
          const lead = db.prepare("SELECT * FROM referral_leads WHERE id = ?").get(data.referralId);
          const limited = staff?.brokerage.role === "LO";
          if (!lead || (limited && lead.officerEmail !== staff.email)) throw new WorkspaceError("This lead is unavailable.");
          const realtorId = typeof lead.realtorId === "string" ? lead.realtorId : null;
          const source = lead.importSource as Loan["leadSource"] ?? (realtorId ? "Realtor referral" : "Website quote request");
          const imported = typeof lead.importSource === "string";
          if (lead.resolvedAt) {
            const owner = db.prepare("SELECT officerEmail FROM loans WHERE id = ?").get(lead.loanId);
            if (!owner || (limited && owner.officerEmail !== staff.email)) throw new WorkspaceError("This referral has already been closed.");
            referralLoanId = String(lead.loanId);
            message = "The referral’s 1003 is already on the loan.";
            break;
          }
          if (lead.heldAt) throw new WorkspaceError("Reactivate this lead before creating its loan.");
          const email = String(lead.email);
          const phone = String(lead.phone);
          const matches = referralMatches({ email, phone }, leadContactCandidates(db, { email, phone }));
          const canUse = (id: string) => !limited || !!db.prepare("SELECT 1 FROM loans WHERE contactId = ? AND officerEmail = ?").get(id, staff.email) ||
            !!db.prepare("SELECT 1 FROM contacts WHERE id = ? AND addedBy = ?").get(id, staff.email);
          const borrower = db.prepare("SELECT id, name, email, phone, role FROM contacts WHERE id = ? AND role <> 'Realtor'");
          const findBorrower = (id: SqlValue) => id ? borrower.get(id) as unknown as Contact | undefined : undefined;
          const reviewedContact = findBorrower(lead.importedContactId);
          let contact = reviewedContact ?? findBorrower(data.contactId);
          if (!reviewedContact && data.contactId && (!contact || !canUse(data.contactId) || !matches.some((match) => match.id === data.contactId))) {
            throw new WorkspaceError("That contact match is unavailable. Refresh tasks and review the referral again.");
          }
          if (!contact) {
            if (matches.some((match) => !canUse(match.id))) throw new WorkspaceError("A possible match is outside your assigned loans. Ask a brokerage admin to review this referral.");
            if (matches.length && !data.allowDuplicate) throw new WorkspaceError("A possible contact match exists. Refresh tasks and choose how to handle it.");
            contact = { id: crypto.randomUUID(), name: String(lead.name), email, phone, role: "Borrower" };
            insertContact(db, contact);
            if ((!staff || staff.brokerage.pilot) && realtorId) trackPilotBorrower(db, realtorId, contact.id);
          }
          const loanId = crypto.randomUUID();
          const assignedEmail = typeof lead.officerEmail === "string" ? lead.officerEmail : staff?.email ?? null;
          insertLoan(db, { id: loanId, contactId: contact.id, partnerId: realtorId, officer: String(lead.officer || staff?.name || "Alex Morgan").slice(0, 160),
            officerEmail: assignedEmail, address: "", amount: 0, purpose: lead.purpose as Purpose,
            stage: "Lead", stageSince: now, createdAt: String(lead.createdAt), leadSource: source });
          const carriedDocuments = carryLeadDocuments(db, data.referralId, loanId, now);
          if (carriedDocuments === null) throw new WorkspaceError("A sample PDF is still processing. Wait for the upload to finish before converting the lead.");
          stopCampaignFollowUp(db, staff, data.referralId, now, "1003 started", true);
          const firstContactAt = carryLeadHistory(db, data.referralId, loanId);
          carryLeadConversation(db, data.referralId, loanId, contact.id, now);
          const leadIdentity = { leadId: data.referralId, email, phone, contactId: lead.importedContactId };
          const suppression = outreachSuppressionKeys(db);
          if (outreachSuppressed(suppression, leadIdentity) || outreachSuppressed(suppression, { contactId: contact.id })) {
            retainContactOptOut(db, contact.id, leadIdentity);
            closeSuppressedOutreach(db, now);
          } else {
            db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, completedAt, purpose) VALUES (?, ?, 'Make first contact', ?, ?, 'Prospecting')")
              .run(`first-contact:${loanId}`, loanId, lead.dueAt, firstContactAt);
          }
          if (!startApplication(db, loanId, now, staff?.brokerage.id, { email, phone, propertyZip: String(lead.zip ?? "") })) {
            throw new WorkspaceError("Orbit could not create the borrower link.");
          }
          db.prepare("UPDATE referral_leads SET resolvedAt = ?, loanId = ? WHERE id = ?").run(now, loanId, data.referralId);
          recordLoanAudit(db, loanId, staff, "Converted lead to loan", now, null);
          addApplicationActivity(db, loanId, `Converted ${source.toLowerCase()} to a loan with a prefilled 1003.`, now);
          accessEvent(db, staff, imported ? "Converted imported lead" : realtorId ? "Converted referral" : "Converted quote request", data.referralId, now);
          referralLoanId = loanId;
          message = "Lead converted. The prefilled 1003 is ready.";
          if (carriedDocuments) message += ` Moved ${carriedDocuments} sample document ${carriedDocuments === 1 ? "request" : "requests"} to the loan.`;
          break;
        }
        case "startApplication": {
          const before = getApplication(db, data.loanId);
          if (!startApplication(db, data.loanId, now, staff?.brokerage.id)) throw new WorkspaceError("This loan no longer exists.");
          if (!before || before.revokedAt || before.expiresAt <= now) accessEvent(db, staff, before ? "Replaced borrower link" : "Issued borrower link", data.loanId, now);
          message = "Demo application link is ready.";
          break;
        }
        case "revokeApplication": {
          const application = getApplication(db, data.loanId);
          if (!application || application.token !== data.token) throw new WorkspaceError("The borrower link changed. Refresh before revoking it.");
          if (!application.revokedAt) {
            db.prepare("UPDATE applications SET revokedAt = ? WHERE loanId = ?").run(now, data.loanId);
            accessEvent(db, staff, "Revoked borrower link", data.loanId, now);
          }
          message = "Borrower link revoked.";
          break;
        }
        case "enableJointApplication":
        case "revokeJointLink":
        case "replaceJointLink": {
          const result = changeJointApplicationLink(db, staff, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "refreshApplication":
          message = "Application and checklist refreshed.";
          break;
        case "requestDocument": {
          const source = data.condition;
          if (!documentRecipientAvailable(db, data.loanId, data.recipient)) throw new WorkspaceError("Set up a separate co-borrower link before assigning documents to them.");
          if (source) {
            const manual = db.prepare("SELECT conditions FROM submissions WHERE id = ? AND loanId = ? AND syncedAt IS NULL")
              .get(source.submissionId, data.loanId);
            const conditions = manual ? (JSON.parse(String(manual.conditions)) as Condition[]).filter((item) => item.manual)
              : uwmSubmissionConditions(db, data.loanId, source.submissionId);
            if (!conditions) throw new WorkspaceError("This lender submission is unavailable on this loan.");
            if (db.prepare("SELECT 1 FROM document_requests WHERE submissionId = ? AND conditionId = ?").get(source.submissionId, source.conditionId)) {
              message = "This condition already has a checklist request.";
              break;
            }
            if (!conditions.some((item) => item.id === source.conditionId && !item.satisfiedAt)) {
              throw new WorkspaceError("This condition is no longer outstanding. Refresh the loan to see its status.");
            }
            if (!data.instructions) throw new WorkspaceError("Enter instructions for the borrower.");
          } else {
            if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
            if (db.prepare("SELECT 1 FROM document_requests WHERE loanId = ? AND kind = ? AND recipient = ? AND conditionId IS NULL")
              .get(data.loanId, data.kind, data.recipient)) {
              throw new WorkspaceError("This document is already on that borrower’s checklist. Refresh the loan to see its status.");
            }
          }
          addDocumentRequest(db, data.loanId, data.kind, data.instructions, now, source, data.dueOn, data.recipient);
          message = source ? "Condition linked to the borrower checklist." : "Document added to the borrower checklist.";
          break;
        }
        case "setDocumentDeadline": {
          const result = setDocumentDeadline(db, data, staff, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "requestSuggestedUwmDocuments": {
          const conditions = uwmSubmissionConditions(db, data.loanId, data.submissionId);
          if (!conditions) throw new WorkspaceError("This mock UWM submission is unavailable on this loan.");
          const existing = new Set(db.prepare("SELECT conditionId FROM document_requests WHERE loanId = ? AND submissionId = ?")
            .all(data.loanId, data.submissionId).map((row) => row.conditionId));
          let added = 0;
          for (const conditionId of new Set(data.conditionIds)) {
            if (existing.has(conditionId)) continue;
            const condition = conditions.find((item) => item.id === conditionId && !item.satisfiedAt);
            const suggested = condition && suggestedConditionDocument(condition);
            if (!suggested) throw new WorkspaceError("The suggested requests changed. Refresh the loan to review the outstanding conditions.");
            addDocumentRequest(db, data.loanId, suggested.kind, suggested.instructions, now, { submissionId: data.submissionId, conditionId });
            added++;
          }
          message = added ? `Added ${added} suggested document ${added === 1 ? "request" : "requests"} to the borrower checklist.`
            : "These conditions already have checklist requests.";
          break;
        }
        case "reviewDocument": {
          const request = db.prepare("SELECT kind, status, revision, dueOn, submissionId, conditionId, recipient FROM document_requests WHERE id = ? AND loanId = ?")
            .get(data.requestId, data.loanId);
          const submission = request?.submissionId && db.prepare("SELECT conditions FROM submissions WHERE id = ? AND loanId = ?").get(request.submissionId, data.loanId);
          const open = submission && (JSON.parse(String(submission.conditions)) as Condition[]).some((item) => item.id === request?.conditionId && !item.satisfiedAt);
          const replaceAccepted = request?.status === "Accepted" && data.decision === "Needs replacement" && open;
          if (!request || (request.status !== "Received" && !replaceAccepted) || request.revision !== data.revision) {
            throw new WorkspaceError("This document request changed. Refresh the checklist before reviewing it.");
          }
          if (data.decision === "Needs replacement" && !data.replacementNote) throw new WorkspaceError("Tell the borrower what to replace.");
          const replacement = data.decision === "Needs replacement";
          const nextDueOn = replacement ? data.dueOn ?? null : request.dueOn;
          db.prepare(`UPDATE document_requests SET status = ?, replacementNote = ?, revision = revision + 1,
            dueOn = ?, deadlineRevision = deadlineRevision + ? WHERE id = ?`)
            .run(data.decision, replacement ? data.replacementNote : "", nextDueOn, Number(nextDueOn !== request.dueOn), data.requestId);
          if (replaceAccepted) archiveMockDocumentDelivery(db, data.requestId);
          const pdf = db.prepare("SELECT objectId FROM document_files WHERE requestId = ?").get(data.requestId)?.objectId;
          const accepted = pdf ? (staff?.brokerage.id === demoBrokerageId || staff?.brokerage.pilot ? "Demo PDF accepted" : "Borrower PDF accepted") : "Sample document accepted";
          addApplicationActivity(db, data.loanId, `${replacement ? "Replacement requested" : accepted} · ${request.kind}${request.recipient !== primaryDocumentRecipient ? ` · ${request.recipient}` : ""}${replacement && nextDueOn ? ` · Due ${nextDueOn}` : ""}`, now);
          message = data.decision === "Accepted" ? "Document accepted." : "Replacement requested on the borrower checklist.";
          if (data.sendToMockUwm) {
            const delivery = sendMockConditionDocument(db, data.loanId, data.requestId, data.revision + 1, now);
            if ("error" in delivery) throw new WorkspaceError(delivery.error);
            message = "Document accepted and sent to mock UWM. Check clearance when ready.";
          }
          break;
        }
        case "applyDocumentPreset": {
          if (!db.prepare("SELECT 1 FROM loans WHERE id = ?").get(data.loanId)) throw new WorkspaceError("This loan no longer exists.");
          if (!documentRecipientAvailable(db, data.loanId, data.recipient)) throw new WorkspaceError("Set up a separate co-borrower link before assigning documents to them.");
          let added = 0;
          for (const kind of checklistPresets[data.preset]) {
            if (db.prepare("SELECT 1 FROM document_requests WHERE loanId = ? AND kind = ? AND recipient = ? AND conditionId IS NULL")
              .get(data.loanId, kind, data.recipient)) continue;
            db.prepare("INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, recipient) VALUES (?, ?, ?, ?, ?, ?)")
              .run(crypto.randomUUID(), data.loanId, kind, checklistInstructions[kind], now, data.recipient);
            added++;
          }
          if (added) addApplicationActivity(db, data.loanId, `Applied ${data.preset.toLowerCase()} checklist · ${added} added · ${data.recipient}`, now);
          message = added ? `Added ${added} document requests.` : "This checklist is already in place.";
          break;
        }
        case "applyDocumentTemplate": {
          const result = applyDocumentTemplate(db, data, staff, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "recordManualHandoff":
        case "acknowledgeCampaignLenderExport": {
          const application = getApplication(db, data.loanId);
          if (!application?.submittedAt || !application.reviewedAt || application.revision !== data.revision) {
            throw new WorkspaceError("Review the current submitted application before recording a handoff.");
          }
          const lender = db.prepare("SELECT revision FROM application_lender_details WHERE loanId = ?").get(data.loanId);
          const lenderRevision = Number(lender?.revision ?? 0);
          if (data.lenderRevision !== undefined && data.lenderRevision !== lenderRevision) {
            throw new WorkspaceError("Lender details changed. Refresh the loan before recording a handoff.");
          }
          const simulated = data.type === "acknowledgeCampaignLenderExport";
          const outcome = simulated ? "Acknowledged" : data.outcome;
          const note = simulated ? campaignManualHandoff.acknowledgmentNote : data.note;
          const file = simulated ? undefined : data.lenderFile;
          const detail = `Manual handoff · ${outcome} · Application revision ${data.revision}${file ? ` · ${file.lender} · ${file.externalId}` : ""}${note ? ` · ${note}` : ""}`;
          const previous = db.prepare("SELECT loanId, text FROM activity WHERE id = ?").get(data.eventId);
          if (previous) {
            const recorded = db.prepare("SELECT lenderRevision, submissionId FROM application_handoff_events WHERE activityId = ?").get(data.eventId);
            if (previous.loanId !== data.loanId || previous.text !== detail || (simulated && !recorded) ||
              (recorded && recorded.lenderRevision !== lenderRevision) || (file && !recorded?.submissionId)) {
              throw new WorkspaceError("Start a new handoff entry.");
            }
          }
          if (!previous && manualHandoffNeedsApproval(outcome)) {
            const blocker = handoffCheckpointError(db, data.loanId);
            if (blocker) throw new WorkspaceError(blocker);
          }
          let alreadyRecorded = !!previous;
          let submissionId: string | null = null;
          if (simulated) {
            if (application.uwmReference || application.correctionNote) throw new WorkspaceError("Open the current manual MISMO handoff before recording acknowledgment.");
            const result = ensureCampaignManualFile(db, data, staff);
            if ("error" in result) throw new WorkspaceError(result.error);
            submissionId = result.submissionId;
            const latest = db.prepare(`SELECT activity.text FROM application_handoff_events event JOIN activity ON activity.id = event.activityId
              WHERE event.loanId = ? AND event.applicationRevision = ? AND event.lenderRevision = ? AND event.outcome <> 'Export prepared'
              ORDER BY activity.rowid DESC LIMIT 1`).get(data.loanId, data.revision, lenderRevision);
            alreadyRecorded ||= latest?.text === detail;
          }
          if (!alreadyRecorded) {
            if (file) {
              if (outcome !== "Acknowledged" || data.lenderRevision === undefined ||
                !hasPreparedLenderExport(db, { ...data, lenderRevision })) {
                throw new WorkspaceError("Prepare the MISMO export for the current reviewed 1003 before linking a lender acknowledgment.");
              }
              const existing = db.prepare("SELECT id, loanId, syncedAt FROM submissions WHERE lender = ? AND externalId = ?")
                .get(file.lender, file.externalId);
              if (existing && (existing.loanId !== data.loanId || existing.syncedAt !== null)) {
                throw new WorkspaceError("That reference already belongs to a different or synced lender file.");
              }
              submissionId = existing ? String(existing.id) : crypto.randomUUID();
              if (!existing) insertSubmission(db, { ...file, id: submissionId, loanId: data.loanId, status: "Acknowledged", conditions: [], syncedAt: null });
              else db.prepare("UPDATE submissions SET status = 'Acknowledged' WHERE id = ? AND status = 'Returned for changes'").run(submissionId);
            }
            db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(data.eventId, data.loanId, detail, now);
            if (data.lenderRevision !== undefined) db.prepare(`INSERT INTO application_handoff_events
              (activityId, loanId, applicationRevision, lenderRevision, outcome, submissionId) VALUES (?, ?, ?, ?, ?, ?)`)
              .run(data.eventId, data.loanId, data.revision, lenderRevision, outcome, submissionId);
            accessEvent(db, staff, simulated ? "Recorded simulated lender acknowledgment" : `Manual handoff · ${outcome}`, data.loanId, now);
          }
          message = simulated ? "Simulated acknowledgment recorded. The fictional lender checklist is ready." :
            file ? "Lender acknowledgment recorded. Open the linked condition checklist." : "Manual handoff recorded on the loan.";
          break;
        }
        case "sendConditionDocument": {
          const result = sendMockConditionDocument(db, data.loanId, data.requestId, data.revision, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = `Mock UWM document receipt · ${result.receipt}`;
          break;
        }
        case "simulateDeliveryFailure": {
          const request = db.prepare("SELECT * FROM document_requests WHERE id = ? AND loanId = ?").get(data.requestId, data.loanId);
          const conditions = typeof request?.submissionId === "string" ? uwmSubmissionConditions(db, data.loanId, request.submissionId) : undefined;
          if (!request || request.revision !== data.revision || request.status !== "Accepted" ||
            !conditions?.some((item) => item.id === request.conditionId && !item.satisfiedAt) ||
            db.prepare("SELECT 1 FROM uwm_document_deliveries WHERE requestId = ?").get(data.requestId)) {
            throw new WorkspaceError("Select an accepted document with an outstanding mock UWM delivery.");
          }
          if (!db.prepare("SELECT 1 FROM mock_delivery_failures WHERE requestId = ? AND revision = ?").get(data.requestId, data.revision)) {
            db.prepare("INSERT INTO mock_delivery_failures VALUES (?, ?, ?)").run(data.requestId, data.revision, now);
            addApplicationActivity(db, data.loanId, `Mock UWM delivery failed · ${request.kind} · revision ${data.revision}`, now);
          }
          message = "Mock delivery failed. Retry from the document checklist.";
          break;
        }
        case "refreshMockUwmClearance": {
          const result = refreshMockUwmClearance(db, data.loanId, data.submissionId, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "reopenMockUwmCondition": {
          if (!isDemoStaff(staff) && !staff?.brokerage.pilot) throw new WorkspaceError("Condition simulation is available in fictional demo workspaces.");
          const result = reopenMockUwmCondition(db, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          accessEvent(db, staff, "Simulated mock UWM condition reopening", data.loanId, now);
          message = result.message;
          break;
        }
        case "updateProcessing": {
          const result = updateProcessing(db, staff, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "refreshWorkspace":
          message = "Workspace refreshed.";
          break;
        case "recordCarriedCampaignCallback": {
          const result = recordCarriedCallback(db, data, staff?.name || "Demo workspace", now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "rescheduleCarriedCampaignCallback": {
          const result = rescheduleCarriedCallback(db, data, staff?.name || "Demo workspace", now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "completeTask": {
          const task = db.prepare("SELECT loanId, title, completedAt, purpose FROM tasks WHERE id = ?").get(data.id);
          if (!task) throw new WorkspaceError("This task no longer exists.");
          if (data.id.startsWith(reversedFundingTaskPrefix)) throw new WorkspaceError("This completed task belongs to a reversed funding entry.");
          message = data.completed ? "Task completed." : "Task reopened.";
          if (data.completed !== Boolean(task.completedAt)) {
            if (!data.completed && carriedCallbacks(db, String(task.loanId), data.id).some((callback) => callback.attemptEventId)) {
              throw new WorkspaceError("The callback already has a recorded outcome.");
            }
            if (task.purpose === "Prospecting" && loanOutreachSuppressed(db, String(task.loanId))) {
              throw new WorkspaceError("This borrower opted out of brokerage outreach.");
            }
            db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ?").run(data.completed ? now : null, data.id);
            addApplicationActivity(db, String(task.loanId), `${data.completed ? "Completed task" : "Reopened task"} · ${task.title}`, now);
          }
          break;
        }
        case "createTask":
          if (data.purpose === "Prospecting" && loanOutreachSuppressed(db, data.loanId)) throw new WorkspaceError("This borrower opted out of brokerage outreach.");
          db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES (?, ?, ?, ?, ?)")
            .run(crypto.randomUUID(), data.loanId, data.title, new Date(Date.parse(now) + data.days * 86_400_000).toISOString(), data.purpose);
          message = "Follow-up task added.";
          break;
        case "selectOffer": {
          const run = db.prepare("SELECT offers, selectedId, mode, applicationRevision, incomeReviewRevision FROM pricing_runs WHERE id = ? AND loanId = ?").get(data.runId, data.loanId);
          const offer = run && (JSON.parse(String(run.offers)) as PricingOffer[]).find((item) => item.id === data.offerId);
          if (!run || !offer) throw new WorkspaceError("That pricing option is unavailable. Refresh the loan and try again.");
          const freshness = pricingInputError(db, data.loanId, { applicationRevision: run.applicationRevision, incomeReviewRevision: run.incomeReviewRevision }, getApplication(db, data.loanId));
          if (freshness) throw new WorkspaceError(freshness);
          const lastSaved = savedPricingRun(db, data.loanId);
          if (lastSaved?.id !== data.runId || lastSaved.selectedId !== offer.id) {
            db.prepare("UPDATE pricing_runs SET selectedId = ?, selectedAt = ? WHERE id = ?").run(offer.id, now, data.runId);
            addApplicationActivity(db, data.loanId, `Saved ${run.mode === "mock" ? "sample" : "stage"} quote · ${offer.product} at ${offer.rate.toFixed(3)}%`, now);
          }
          message = "Quote saved on the loan.";
          break;
        }
        case "floatMockRate":
        case "lockMockRate": {
          const result = data.type === "floatMockRate" ? floatMockRate(db, data, now) : lockMockRate(db, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "extendMockLock":
        case "cancelMockLock": {
          const result = data.type === "extendMockLock" ? extendMockLock(db, data, now) : cancelMockLock(db, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "saveFeeWorksheet": {
          const result = saveFeeWorksheet(db, data, now);
          if ("error" in result) throw new WorkspaceError(result.error);
          message = result.message;
          break;
        }
        case "publishQuote": {
          const application = getApplication(db, data.loanId);
          if (!application?.submittedAt) throw new WorkspaceError("The borrower must submit their 1003 before you can share a quote.");
          const run = savedPricingRun(db, data.loanId);
          if (run?.id !== data.runId || run.selectedId !== data.offerId || run.mode !== "mock") {
            throw new WorkspaceError("Select the current saved sample quote before sharing it.");
          }
          const offer = (JSON.parse(String(run.offers)) as PricingOffer[]).find((item) => item.id === data.offerId);
          if (!offer) throw new WorkspaceError("This sample quote is unavailable.");
          const choices = [data, ...data.alternatives];
          if (new Set(choices.map((choice) => JSON.stringify([choice.runId, choice.offerId]))).size !== choices.length) {
            throw new WorkspaceError("Choose distinct pricing options for the comparison.");
          }
          const options: QuoteOption[] = choices.map((choice) => {
            const result = quoteSnapshot(db, data.loanId, choice, application);
            if ("error" in result) throw new WorkspaceError(result.error);
            return result.option;
          });
          const [primary, ...alternatives] = options;
          if (alternatives.some((option) => option.purpose !== primary.purpose)) throw new WorkspaceError("Compare quotes for the same loan purpose.");
          const presentation = JSON.stringify({ primary, alternatives });
          const previous = db.prepare("SELECT runId, offerId, presentation FROM published_quotes WHERE loanId = ?").get(data.loanId);
          if (previous?.runId !== data.runId || previous.offerId !== data.offerId || previous.presentation !== presentation) {
            archiveSharedQuote(db, data.loanId, now, "Replaced");
            db.prepare(`INSERT INTO published_quotes (loanId, runId, offerId, product, rate, principalAndInterest, quotedAt, publishedAt, presentation)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(loanId) DO UPDATE SET runId = excluded.runId, offerId = excluded.offerId,
              product = excluded.product, rate = excluded.rate, principalAndInterest = excluded.principalAndInterest,
              quotedAt = excluded.quotedAt, publishedAt = excluded.publishedAt, presentation = excluded.presentation`)
              .run(data.loanId, data.runId, offer.id, offer.product, offer.rate, offer.principalAndInterest, run.quotedAt, now, presentation);
            addApplicationActivity(db, data.loanId, "Sample quote published to borrower status.", now);
          }
          message = "Sample quote published to borrower status.";
          break;
        }
        case "withdrawQuote": {
          const previous = db.prepare("SELECT publishedAt FROM published_quotes WHERE loanId = ?").get(data.loanId);
          if (previous && previous.publishedAt !== data.publishedAt) throw new WorkspaceError("The shared quote changed. Refresh before removing it.");
          if (previous) {
            archiveSharedQuote(db, data.loanId, now, "Removed");
            db.prepare("DELETE FROM published_quotes WHERE loanId = ?").run(data.loanId);
            addApplicationActivity(db, data.loanId, "Sample quote removed from borrower status.", now);
          }
          message = "Sample quote removed from borrower status.";
          break;
        }
        case "useReviewedLoanAmount": {
          const application = getApplication(db, data.loanId);
          if (!application?.submittedAt || !application.reviewedAt || application.correctionNote || application.revision !== data.revision) {
            throw new WorkspaceError("Refresh the loan and review the current 1003 before using its requested amount.");
          }
          const loan = db.prepare(`SELECT loan.amount FROM loans loan
            LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id
            LEFT JOIN closing_progress closing ON closing.loanId = loan.id
            WHERE loan.id = ? AND loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')
              AND profile.closingDate IS NULL AND closing.fundingDate IS NULL`).get(data.loanId);
          if (!loan) throw new WorkspaceError("Only an active loan before closing can use the reviewed 1003 amount.");
          const requested = requestedLoanAmount(JSON.parse(application.draft).loanAmount);
          const amount = requested === null ? 0 : Math.round(requested);
          if (!amount) throw new WorkspaceError("The current 1003 needs a valid requested loan amount.");
          if (loan.amount !== amount) {
            if (loan.amount !== data.previousAmount) throw new WorkspaceError("The recorded loan amount changed. Refresh the loan before updating it.");
            db.prepare("UPDATE loans SET amount = ? WHERE id = ?").run(amount, data.loanId);
            addApplicationActivity(db, data.loanId, `Matched recorded amount to reviewed 1003 · Revision ${data.revision}`, now);
          }
          message = "Recorded loan amount matches the reviewed 1003 in whole dollars.";
          break;
        }
        case "reviewApplication": {
          const application = getApplication(db, data.loanId);
          if (!application?.submittedAt) throw new WorkspaceError("The borrower must submit the application before review.");
          if (data.revision !== undefined && application.revision !== data.revision) throw new WorkspaceError("Refresh to review the latest application.");
          message = "Application marked reviewed.";
          if (!application.reviewedAt) {
            db.prepare("UPDATE applications SET reviewedAt = ? WHERE loanId = ?").run(now, data.loanId);
            saveApplicationVersion(db, { ...application, reviewedAt: now });
            db.prepare("UPDATE tasks SET completedAt = ? WHERE id IN (?, ?) AND completedAt IS NULL")
              .run(now, `application-follow-up:${data.loanId}`, `application-correction:${data.loanId}:${application.revision}`);
            addApplicationActivity(db, data.loanId, staff?.brokerage.role === "Processor" ? "Processor reviewed the demo 1003."
              : "Loan officer reviewed the demo 1003.", now);
            if (staff) {
              const settings = readPlaybook(db);
              if (settings.secondReview && reviewRouting && reviewRouting.reviewerEmail !== settings.secondReview.reviewerEmail) {
                throw new WorkspaceError("Second-review routing changed. Refresh and mark reviewed again.");
              }
              const route = routeSecondApplicationReview(db, staff, { loanId: data.loanId, applicationRevision: application.revision,
                settings, reviewer: reviewRouting?.reviewer ?? null, at: now });
              if (route === "routed") message = "Application marked reviewed. The second review was assigned.";
              if (route === "blocked") {
                addApplicationActivity(db, data.loanId, "Second 1003 review needs a reviewer assignment.", now);
                message = "Application marked reviewed. Assign a second reviewer in Team reviews.";
              }
            }
          }
          break;
        }
        case "requestApplicationCorrection": {
          const coBorrower = data.recipient === "Co-borrower";
          const joint = jointApplication(db, data.loanId);
          if (coBorrower && (!joint?.submittedAt || !joint.primarySubmittedAt || data.lenderReturn)) {
            throw new WorkspaceError("Choose a submitted co-borrower portion on the current joint 1003.");
          }
          if (data.lenderReturn) {
            const result = recordManualLenderReturn(db, { ...data, lenderReturn: data.lenderReturn }, now);
            if ("error" in result) throw new WorkspaceError(result.error);
            if (result.alreadyRecorded) {
              message = "Lender return already recorded.";
              break;
            }
            accessEvent(db, staff, "Recorded manual lender return", data.loanId, now);
          }
          const application = getApplication(db, data.loanId);
          if (!application?.submittedAt || application.revision !== data.revision) throw new WorkspaceError("Refresh the submitted application before requesting corrections.");
          saveApplicationVersion(db, application);
          if (joint) reopenJointBorrower(db, data.loanId, data.recipient, data.note, now);
          db.prepare(`UPDATE applications SET correctionNote = ?, submittedAt = NULL, reviewedAt = NULL,
            revision = revision + 1, step = ?, updatedAt = ? WHERE loanId = ?`)
            .run(coBorrower ? "Co-borrower corrections requested." : data.note, coBorrower ? application.step : 0, now, data.loanId);
          db.prepare(`UPDATE tasks SET completedAt = ? WHERE loanId = ? AND completedAt IS NULL
            AND (id = ? OR instr(id, ?) = 1)`).run(now, data.loanId, "application-follow-up:" + data.loanId, "application-correction:" + data.loanId + ":");
          addApplicationActivity(db, data.loanId, coBorrower ? "Loan officer requested co-borrower corrections." : "Loan officer requested 1003 corrections.", now);
          message = data.lenderReturn ? "Lender return recorded. The borrower can reopen the same link to correct the 1003." :
            coBorrower ? "The co-borrower can reopen their link to correct and resubmit their portion." :
              "The borrower can reopen the same link to correct and resubmit the 1003.";
          break;
        }
        case "saveLenderDetails": {
          const application = getApplication(db, data.loanId);
          if (!application) throw new WorkspaceError("Start an application before saving lender details.");
          const existing = db.prepare("SELECT revision FROM application_lender_details WHERE loanId = ?").get(data.loanId);
          if (Number(existing?.revision ?? 0) !== data.revision) throw new WorkspaceError("Lender details changed. Refresh the application before saving.");
          const originator = cleanAnswers(lenderQuestions, data.details.originator);
          const supplement = cleanAnswers(lenderSupplement, data.details.supplement);
          db.prepare(`INSERT INTO application_lender_details (loanId, details, revision) VALUES (?, ?, ?)
            ON CONFLICT(loanId) DO UPDATE SET details = excluded.details, revision = excluded.revision`)
            .run(data.loanId, JSON.stringify({ originator: originator.answers, supplement: supplement.answers }), data.revision + 1);
          message = "Lender details saved.";
          break;
        }
        case "sendApplication": {
          const result = submitMockApplication(db, data.loanId, data.revision, now, data.quote);
          if ("error" in result) throw new WorkspaceError(result.error);
          if (result.action !== "retry") {
            accessEvent(db, staff, result.action === "initial" ? "Submitted to mock UWM" : "Sent updated 1003 to mock UWM", data.loanId, now);
          }
          message = `Mock UWM received 1003 revision ${data.revision} · ${result.reference}`;
          break;
        }
        case "optOutContact": {
          if (!optOutContact(db, data.contactId, now)) throw new WorkspaceError("Choose an available borrower contact.");
          accessEvent(db, staff, "Recorded brokerage outreach opt-out", data.contactId, now);
          message = "Borrower opted out of brokerage outreach.";
          break;
        }
        case "logContactActivity":
        case "assignContactFollowUp":
        case "rescheduleBorrowerCallback":
        case "completeContactFollowUp": {
          const prior = db.prepare("SELECT * FROM contact_activity WHERE id = ?").get(data.eventId);
          const author = staff?.email ?? null;
          if ((data.type === "completeContactFollowUp" || data.type === "rescheduleBorrowerCallback") && staff?.brokerage.role === "LO" &&
            (prior?.followUpOwnerEmail !== author || prior.contactId !== data.contactId)) throw new WorkspaceError("This follow-up is unavailable.");
          const contact = db.prepare("SELECT id AS contactId, role, email, phone FROM contacts WHERE id = ?").get(data.contactId);
          if (!contact) throw new WorkspaceError("This contact is unavailable.");
          const suppressed = contact.role !== "Realtor" && outreachSuppressed(outreachSuppressionKeys(db), contact);
          if (data.type === "logContactActivity") {
            const dueAt = data.followUp ? `${data.followUp}T17:00:00.000Z` : null;
            if (prior) {
              if (prior.contactId !== data.contactId || prior.officerEmail !== author || prior.kind !== data.kind ||
                prior.text !== data.text || prior.outcome !== data.outcome || prior.dueAt !== dueAt || prior.purpose !== data.purpose) {
                throw new WorkspaceError("Start a new activity entry.");
              }
            } else {
              if (data.kind === "Note" && (data.outcome || dueAt)) throw new WorkspaceError("Choose call, email, or text to record an outcome or follow-up.");
              if (data.kind !== "Note" && !data.outcome) throw new WorkspaceError("Choose an outreach outcome.");
              if (suppressed && data.kind !== "Note" && data.purpose === "Prospecting") throw new WorkspaceError("This borrower opted out of brokerage outreach.");
              if (data.followUp && data.followUp < easternDate(new Date(now))) throw new WorkspaceError("Choose today or a future date for follow-up.");
              addContactActivity(db, { ...data, dueAt }, staff, now);
            }
            message = data.followUp ? `${data.kind} logged and follow-up added to My Tasks.` : `${data.kind} logged on the contact.`;
          } else if (data.type === "assignContactFollowUp") {
            const member = leadMembers.find((person) => person.email === data.email);
            if (!member) throw new WorkspaceError("Select an active loan officer or admin in this brokerage.");
            if (!prior?.dueAt || prior.contactId !== data.contactId || prior.completedAt) throw new WorkspaceError("Select an open contact follow-up.");
            if (suppressed && prior.purpose === "Prospecting") throw new WorkspaceError("This borrower opted out of brokerage outreach.");
            const name = member.name || member.email;
            if (prior.followUpOwnerEmail !== member.email) {
              if (prior.revision !== data.revision) throw new WorkspaceError("The follow-up changed. Refresh before reassigning it.");
              db.prepare("UPDATE contact_activity SET followUpOwner = ?, followUpOwnerEmail = ?, revision = revision + 1 WHERE id = ?")
                .run(name.slice(0, 160), member.email, data.eventId);
              accessEvent(db, staff, "Reassigned contact follow-up", `${data.eventId} · ${prior.followUpOwnerEmail ?? "Local demo"} → ${member.email}`, now);
            }
            message = `Contact follow-up assigned to ${name}.`;
          } else if (data.type === "rescheduleBorrowerCallback") {
            if (typeof prior?.dueAt !== "string" || prior.contactId !== data.contactId || prior.completedAt ||
              prior.outcome !== "Requested callback" || !db.prepare("SELECT 1 FROM funding_check_ins WHERE activityId = ?").get(data.eventId)) {
              throw new WorkspaceError("Select an open post-funding callback.");
            }
            if (suppressed && prior.purpose === "Prospecting") throw new WorkspaceError("This borrower opted out of brokerage outreach.");
            const dueAt = `${data.date}T17:00:00.000Z`;
            message = "Borrower callback rescheduled.";
            if (prior.revision === data.revision + 1 && prior.dueAt === dueAt) {
              const change = db.prepare("SELECT actorEmail, reason FROM contact_callback_reschedules WHERE activityId = ? AND revision = ?")
                .get(data.eventId, prior.revision);
              if (change && change.actorEmail === author && change.reason === data.reason) break;
            }
            if (prior.revision !== data.revision) throw new WorkspaceError("The callback changed. Refresh before rescheduling it.");
            if (dueAt === prior.dueAt) throw new WorkspaceError("Choose a different callback date.");
            if (dueAt <= now) throw new WorkspaceError("Choose a future callback deadline.");
            db.prepare("UPDATE contact_activity SET dueAt = ?, revision = revision + 1 WHERE id = ?").run(dueAt, data.eventId);
            db.prepare(`INSERT INTO contact_callback_reschedules (activityId, revision, changedAt, actor, actorEmail, previousDueAt, dueAt, reason)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(data.eventId, data.revision + 1, now, staff?.name || "Alex Morgan", author, prior.dueAt, dueAt, data.reason);
          } else {
            const result = completeContactFollowUp(db, data, staff, prior, suppressed, now);
            if ("error" in result) throw new WorkspaceError(result.error);
            message = result.message;
          }
          break;
        }
        case "contact": {
          savedContactId = data.id ?? crypto.randomUUID();
          if (data.id) {
            if (!db.prepare("SELECT 1 FROM contacts WHERE id = ?").get(data.id)) throw new WorkspaceError(contactUnavailable);
            const linkedAs = db.prepare("SELECT contactId, partnerId FROM loans WHERE contactId = ? OR partnerId = ?").all(data.id, data.id);
            if (linkedAs.some((row) => data.role === "Realtor" ? row.contactId === data.id : row.partnerId === data.id) ||
              (data.role !== "Realtor" && db.prepare("SELECT 1 FROM referral_leads WHERE realtorId = ? AND (resolvedAt IS NULL OR archiveToken IS NOT NULL)").get(data.id))) {
              throw new WorkspaceError("This contact’s role is used by a linked loan or referral.");
            }
            retainContactOptOut(db, data.id);
            db.prepare("UPDATE contacts SET name = ?, email = ?, phone = ?, role = ? WHERE id = ?")
              .run(data.name, data.email, data.phone, data.role, data.id);
            retainContactOptOut(db, data.id);
          } else {
            insertContact(db, { ...data, id: savedContactId });
          }
          closeSuppressedOutreach(db, now);
          break;
        }
        case "importContacts": {
          const batch = `contact-import:${staff?.email ?? "local"}:${data.batchId}`;
          const prior = db.prepare("SELECT value FROM settings WHERE key = ?").get(batch);
          if (prior) {
            message = String(prior.value);
            break;
          }
          const matches = matchingContactCsvKeys(db, data.rows, null);
          let imported = 0;
          for (const row of data.rows) {
            if (!row.separate && contactCsvDuplicateKeys(row).some((key) => matches.has(key))) continue;
            const contact = { ...row, id: crypto.randomUUID(), addedBy: staff?.email };
            insertContact(db, contact);
            for (const key of Object.values(contactCsvKeys(contact))) if (key) matches.add(key);
            imported++;
          }
          if (imported) closeSuppressedOutreach(db, now);
          accessEvent(db, staff, "Imported contacts", `${imported} added · ${data.rows.length - imported} possible duplicates skipped`, now);
          message = `${imported} contacts imported · ${data.rows.length - imported} possible duplicates skipped.`;
          db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(batch, message);
          break;
        }
        case "deleteContact":
          if (db.prepare("SELECT 1 FROM contact_merges WHERE canonicalId = ? LIMIT 1").get(data.id)) {
            throw new WorkspaceError("This primary contact holds the history of a merged record.");
          }
          if (db.prepare("SELECT 1 FROM referral_leads WHERE realtorId = ? AND (resolvedAt IS NULL OR archiveToken IS NOT NULL)").get(data.id)) {
            throw new WorkspaceError("This realtor has open or archived referrals.");
          }
          if (db.prepare("SELECT 1 FROM loans WHERE contactId = ? OR partnerId = ?").get(data.id, data.id)) {
            throw new WorkspaceError("This contact is linked to a loan. Update the loan before deleting the contact.");
          }
          db.prepare("DELETE FROM contacts WHERE id = ?").run(data.id);
          break;
        case "loan": {
          const current = data.id ? db.prepare("SELECT contactId, stage, stageSince, officer, officerEmail, disposition FROM loans WHERE id = ?").get(data.id) : undefined;
          if (data.id && !current) throw new WorkspaceError("This loan no longer exists.");
          if (current && current.stage !== data.stage && current.disposition !== "Active") throw new WorkspaceError("Reopen the loan before changing its stage.");
          if (data.id && data.start1003) throw new WorkspaceError("Start the 1003 from the loan’s application panel.");
          if (data.id && current?.contactId !== data.contactId && getApplication(db, data.id)) {
            throw new WorkspaceError("This loan’s 1003 link belongs to its current borrower. Create a separate loan for another borrower.");
          }
          if (data.partnerId && !db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role = 'Realtor'").get(data.partnerId)) {
            throw new WorkspaceError("Select an existing realtor.");
          }
          let contactId = data.contactId;
          if (contactId) {
            if (!db.prepare("SELECT 1 FROM contacts WHERE id = ? AND role <> 'Realtor'").get(contactId)) {
              throw new WorkspaceError("Select an existing borrower.");
            }
          } else {
            if (!data.borrower) throw new WorkspaceError("Enter a borrower name or select an existing contact.");
            contactId = crypto.randomUUID();
            insertContact(db, { id: contactId, name: data.borrower, email: data.borrowerEmail ?? "", phone: data.borrowerPhone ?? "", role: "Borrower" });
          }
          if (data.assignToSelf && !staff) throw new WorkspaceError("Sign in to assign this loan to your account.");
          const managed = !isDemoStaff(staff) || staff?.brokerage.role === "LO";
          const owner = (managed ? !current : data.assignToSelf) ? staff : null;
          const officer = owner?.name.slice(0, 160) ?? (managed && current ? String(current.officer) : data.officer);
          const unlinkSelf = data.assignToSelf === false && staff?.email === current?.officerEmail;
          const keepOwner = !unlinkSelf && data.officer === current?.officer && typeof current.officerEmail === "string";
          const officerEmail = owner?.email ?? (managed && current ? current.officerEmail as string | null : keepOwner ? String(current.officerEmail) : null);
          const stageSince = current?.stage === data.stage ? String(current.stageSince) : now;
          const loanId = data.id ?? crypto.randomUUID();
          editedLoanId = loanId;
          if (data.id) {
            db.prepare(`UPDATE loans SET contactId = ?, partnerId = ?, officer = ?, officerEmail = ?, address = ?, amount = ?,
              purpose = ?, stage = ?, stageSince = ?, leadSource = coalesce(?, leadSource) WHERE id = ?`)
              .run(contactId, data.partnerId, officer, officerEmail, data.address, data.amount, data.purpose, data.stage, stageSince, data.leadSource ?? null, loanId);
            if ((current?.officerEmail ?? null) !== officerEmail) accessEvent(db, staff, "Changed loan owner", `${loanId} · ${officerEmail ?? "Unassigned"}`, now);
          } else {
            insertLoan(db, { ...data, id: loanId, officer, officerEmail, contactId, stageSince });
            recordLoanAudit(db, loanId, staff, "Created loan", now, null);
          }
          if (current?.stage !== data.stage && (current || data.stage !== "Lead")) {
            createMilestoneDrafts(db, loanId, data.stage, now);
            if (current) addApplicationActivity(db, loanId, `Moved from ${current.stage} to ${data.stage}.`, now);
          }
          if (!current && staff?.brokerage.pilot) accessEvent(db, staff, "Created lead", loanId, now);
          if (!current && data.stage === "Lead") {
            const identity = { ...db.prepare("SELECT email, phone FROM contacts WHERE id = ?").get(contactId), contactId };
            if (!outreachSuppressed(blockedOutreachKeys(db, [identity]), identity)) {
              db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES (?, ?, 'Make first contact', ?, 'Prospecting')")
                .run(`first-contact:${loanId}`, loanId, new Date(Date.parse(now) + 86_400_000).toISOString());
            }
          }
          if (data.start1003) {
            if (!startApplication(db, loanId, now, staff?.brokerage.id)) {
              throw new WorkspaceError("Orbit could not start the 1003 for this lead.");
            }
            accessEvent(db, staff, "Issued borrower link", loanId, now);
            applicationLoanId = loanId;
            message = "Lead saved and 1003 started.";
          }
          break;
        }
        case "deleteLoan":
          if (db.prepare("SELECT 1 FROM loan_financials WHERE loanId = ? LIMIT 1").get(data.id)) {
            throw new WorkspaceError("This loan has retained records and cannot be deleted.");
          }
          if (db.prepare("SELECT 1 FROM call_report_facts WHERE loanId = ? AND json_extract(facts, '$.eligibility') = 'Include'").get(data.id)) {
            throw new WorkspaceError("This loan is included in call report prep. Review its reporting eligibility before deleting it.");
          }
          db.prepare("DELETE FROM loans WHERE id = ?").run(data.id);
          break;
        case "move":
        case "markClearToClose": {
          const loanId = data.type === "move" ? data.id : data.loanId;
          const stage = data.type === "move" ? data.stage : "Clear to Close";
          const file = data.type === "markClearToClose" ? loanWorkRecords(db, false, loanId) : null;
          const loan = file ? file.loans[0] : db.prepare("SELECT stage, disposition FROM loans WHERE id = ?").get(loanId);
          if (!loan) throw new WorkspaceError("This loan no longer exists.");
          if ((data.type === "markClearToClose" || loan.stage !== stage) && mockClearanceClosingStages.some((item) => item === stage) &&
            hasReopenedMockUwmCondition(db, loanId)) throw new ReopenedMockClosingConflict(loanId);
          if (file) {
            if (!closingReviewReady(file.loans[0], file)) {
              throw new WorkspaceError("This file is no longer ready for Clear to Close. Refresh the loan and check the current 1003, conditions, documents, and handoff.");
            }
            message = "Loan marked Clear to Close.";
          }
          if (loan.stage !== stage) {
            if (loan.disposition !== "Active") throw new WorkspaceError("Reopen the loan before changing its stage.");
            db.prepare("UPDATE loans SET stage = ?, stageSince = ? WHERE id = ?").run(stage, now, loanId);
            createMilestoneDrafts(db, loanId, stage, now);
            addApplicationActivity(db, loanId, `Moved from ${loan.stage} to ${stage}.`, now);
          }
          break;
        }
        case "loanDisposition": {
          const loan = db.prepare("SELECT stage, disposition, dispositionReason, revisitDate, dispositionRevision FROM loans WHERE id = ?").get(data.loanId);
          if (!loan || loan.dispositionRevision !== data.revision) throw new WorkspaceError("Refresh the loan before changing its status.");
          if (loan.stage === "Closed" || loan.stage === "Funded") throw new WorkspaceError("The loan has reached a closing outcome.");
          const reason = data.disposition === "Active" ? "" : data.reason;
          const revisit = data.disposition === "On hold" ? data.revisitDate : null;
          if (data.disposition !== "Active" && !reason) throw new WorkspaceError("Enter a reason for changing the loan status.");
          if (loan.disposition === data.disposition && loan.dispositionReason === reason && loan.revisitDate === revisit) break;
          db.prepare(`UPDATE loans SET disposition = ?, dispositionReason = ?, revisitDate = ?,
            dispositionRevision = dispositionRevision + 1 WHERE id = ?`).run(data.disposition, reason, revisit, data.loanId);
          if (data.disposition === "Active" && (loan.stage === "Lead" || loan.stage === "Pre-qual") && getApplication(db, data.loanId)?.submittedAt) {
            db.prepare("UPDATE loans SET stage = 'Application', stageSince = ? WHERE id = ?").run(now, data.loanId);
          }
          message = data.disposition === "Active" ? "Loan reopened. Open work has returned to the queue." : `Loan marked ${data.disposition.toLowerCase()}.`;
          addApplicationActivity(db, data.loanId, reason ? `${message} ${reason}` : message, now);
          accessEvent(db, staff, `Loan status set to ${data.disposition}`, data.loanId, now);
          break;
        }
        case "copyDraft":
          if (!recordDraftCopy(db, data, now)) throw new WorkspaceError("This draft or recipient has changed. Refresh the loan before copying again.");
          message = "Draft copy recorded.";
          break;
        case "note": {
          if (data.kind === "Note" && (data.outcome || data.followUp)) throw new WorkspaceError("Choose call, email, or text to record an outcome or follow-up.");
          const dueAt = data.followUp ? `${data.followUp}T17:00:00.000Z` : null;
          const eventId = data.eventId ?? crypto.randomUUID();
          const taskId = `outreach:${eventId}`;
          const previous = db.prepare("SELECT loanId, text, kind, outcome FROM activity WHERE id = ?").get(eventId);
          if (previous) {
            const task = db.prepare("SELECT dueAt, purpose FROM tasks WHERE id = ?").get(taskId);
            if (previous.loanId !== data.loanId || previous.text !== data.text || previous.kind !== data.kind || previous.outcome !== (data.outcome ?? null) ||
              (task?.dueAt ?? null) !== dueAt || (task && task.purpose !== data.purpose)) throw new WorkspaceError("Start a new activity entry.");
          } else {
            if (data.followUp && data.followUp < easternDate(new Date(now))) throw new WorkspaceError("Choose today or a future date for follow-up.");
            if (dueAt && data.purpose === "Prospecting" && loanOutreachSuppressed(db, data.loanId)) throw new WorkspaceError("This borrower opted out of brokerage outreach.");
            db.prepare("INSERT INTO activity (id, loanId, text, createdAt, kind, outcome) VALUES (?, ?, ?, ?, ?, ?)")
              .run(eventId, data.loanId, data.text, now, data.kind, data.outcome ?? null);
            if (data.outcome) db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ? AND completedAt IS NULL")
              .run(now, `first-contact:${data.loanId}`);
            if (dueAt) db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES (?, ?, ?, ?, ?)")
              .run(taskId, data.loanId, `Follow up after ${data.kind.toLowerCase()}`, dueAt, data.purpose);
          }
          message = `${data.kind} logged.`;
          break;
        }
        case "saveBrokerageTemplate": {
          const current = db.prepare("SELECT body, revision FROM brokerage_templates WHERE audience = ? AND milestone = ?").get(data.audience, data.milestone);
          if ((current?.body ?? "") !== data.body) {
            if (Number(current?.revision ?? 0) !== data.revision) throw new WorkspaceError("This template changed. Refresh it before saving.");
            db.prepare(`INSERT INTO brokerage_templates (audience, milestone, body, revision) VALUES (?, ?, ?, 1)
              ON CONFLICT(audience, milestone) DO UPDATE SET body = excluded.body, revision = revision + 1`).run(data.audience, data.milestone, data.body);
            accessEvent(db, staff, "Updated brokerage message template", `${data.audience} · ${data.milestone}`, now);
          }
          message = data.body ? "Brokerage template saved." : "Default template restored.";
          if (scopedTemplateUpdates) {
            const revision = Number(current?.revision ?? 0) + Number((current?.body ?? "") !== data.body);
            return { template: { audience: data.audience, milestone: data.milestone, body: data.body, revision }, message };
          }
          break;
        }
        case "submission": {
          const lender = data.lender.toUpperCase() === "UWM" ? "UWM" : data.lender;
          if (data.id && db.prepare("SELECT 1 FROM submissions WHERE id = ? AND syncedAt IS NOT NULL").get(data.id)) {
            throw new WorkspaceError("Synced submissions are managed by the lender connection.");
          }
          if (db.prepare("SELECT 1 FROM submissions WHERE lender = ? AND externalId = ? AND id <> ?").get(lender, data.externalId, data.id ?? "")) {
            throw new WorkspaceError("That lender reference is already linked to a loan.");
          }
          if (data.id) {
            db.prepare("UPDATE submissions SET lender = ?, externalId = ?, status = ? WHERE id = ? AND loanId = ?")
              .run(lender, data.externalId, data.status, data.id, data.loanId);
          } else {
            insertSubmission(db, { ...data, id: crypto.randomUUID(), lender, conditions: [], syncedAt: null });
          }
          break;
        }
        case "deleteSubmission":
          db.prepare("DELETE FROM submissions WHERE id = ? AND syncedAt IS NULL").run(data.id);
          break;
        case "saveManualCondition":
        case "recordManualDelivery":
        case "recordManualClearance": {
          const submission = db.prepare("SELECT lender, conditions FROM submissions WHERE id = ? AND loanId = ? AND syncedAt IS NULL")
            .get(data.submissionId, data.loanId);
          if (!submission) throw new WorkspaceError("Select a manual lender submission on this loan.");
          const conditions = JSON.parse(String(submission.conditions)) as Condition[];
          const prior = conditions.find((item) => item.id === data.conditionId);
          if ((prior?.manual?.revision ?? 0) !== data.revision) throw new WorkspaceError("This condition changed. Refresh the loan before saving.");
          const entry: Condition = prior ?? { id: data.conditionId, category: "", description: "", group: null, uploaded: false, satisfiedAt: null };
          const manual = entry.manual ?? { owner: "", revision: 0, deliveries: [], confirmedDelivery: null, openedAt: now };
          if (data.type === "saveManualCondition") {
            if (entry.category === data.category && entry.description === data.description && manual.owner === data.owner) break;
            entry.category = data.category;
            entry.description = data.description;
            manual.owner = data.owner;
            message = "Manual lender condition saved.";
          } else if (data.type === "recordManualDelivery") {
            const request = db.prepare(`SELECT status, revision FROM document_requests
              WHERE submissionId = ? AND conditionId = ? AND loanId = ?`).get(data.submissionId, entry.id, data.loanId);
            if (entry.satisfiedAt || request?.status !== "Accepted" || request.revision !== data.documentRevision) {
              throw new WorkspaceError("Accept the current document for the outstanding condition before recording delivery.");
            }
            if (manual.deliveries.some((delivery) => delivery.documentRevision === data.documentRevision && delivery.reference === data.reference)) break;
            manual.deliveries.push({ documentRevision: data.documentRevision, reference: data.reference, at: now });
            entry.uploaded = true;
            message = `Manual delivery recorded · document revision ${data.documentRevision}`;
          } else {
            if (Boolean(entry.satisfiedAt) === data.cleared) break;
            entry.satisfiedAt = data.cleared ? now : null;
            manual.confirmedDelivery = data.cleared ? data.confirmation : null;
            if (!data.cleared) {
              entry.uploaded = false;
              manual.openedAt = now;
              manual.reopenedAt = now;
            }
            message = `Condition ${data.cleared ? "cleared by lender" : "reopened"} · ${data.confirmation}`;
          }
          entry.manual = { ...manual, revision: manual.revision + 1 };
          if (!prior) conditions.push(entry);
          db.prepare("UPDATE submissions SET conditions = ? WHERE id = ?").run(JSON.stringify(conditions), data.submissionId);
          addApplicationActivity(db, data.loanId, `${submission.lender} · ${entry.category} · ${message}`, now);
          break;
        }
      }
      if (refill && releasedCampaignSlot) {
        const assigned = refillReleasedCampaignSlot(db, staff, refill, now, campaignRefillRoster);
        message += campaignRefillNotice(assigned);
        if (assigned && scopedLeadUpdates && data.type === "recordCampaignCall") {
          return { campaignQueue: readCampaignQueue(db, data.campaignId, staff), message };
        }
      }
      message += campaignRefillNotice(refillCampaignsAfterOptOut(db, staff, optOutCapacity, now, campaignOptOutRoster));
      const leadId = scopedLeadUpdates ? scopedLeadId(data) : undefined;
      if (scopedInboxUpdates && inboxCommands.has(data.type) && (!referralLoanId || staff)) {
        if (!leadId) synchronizeRetentionTasks(db);
        let restoredLeadId: string | undefined;
        if (data.type === "restoreLead") {
          const scope = inboxLeadScope(staff);
          if (db.prepare(`SELECT 1 FROM referral_leads lead WHERE ${scope.where} AND lead.id = ?`).get(...scope.args, data.leadId)) {
            restoredLeadId = data.leadId;
          }
        }
        const inboxLoan = referralLoanId && staff ? readEditableLoan(db, referralLoanId, staff, staff.brokerage.id) : undefined;
        if (inboxLoan && "error" in inboxLoan) throw new WorkspaceError(inboxLoan.error);
        const converted = inboxLoan && data.type === "convertReferral" ? db.prepare(`
          SELECT lead.id, lead.resolvedAt, member.campaignId FROM referral_leads lead
          LEFT JOIN call_campaign_members member ON member.leadId = lead.id WHERE lead.id = ? AND lead.loanId = ?`)
          .get(data.referralId, inboxLoan.loanId) : undefined;
        const convertedLead = converted && typeof converted.id === "string" && typeof converted.resolvedAt === "string" ?
          { id: converted.id, resolvedAt: converted.resolvedAt, campaignId: typeof converted.campaignId === "string" ? converted.campaignId : null } : undefined;
        const convertedCampaign = convertedLead?.campaignId ? readCampaignQueue(db, convertedLead.campaignId, staff) : undefined;
        return { inboxChanged: true as const, message, referralLoanId, restoredLeadId, inboxLoan, convertedLead, convertedCampaign };
      }
      if (leadId) {
        const officerEmail = staff?.brokerage.role === "LO" ? staff.email : undefined;
        const leadWork = leadWorkRecord(db, leadId, officerEmail);
        if (!leadWork || (officerEmail && leadWork.lead.officerEmail !== officerEmail)) throw new WorkspaceError(leadWorkUnavailable);
        const manager = officerEmail ? undefined : {
          campaignResponse: leadWork.member ? campaignResponses(db, leadId)[0] ?? null : null,
          unlinkedReferral: (db.prepare(`SELECT id, realtorId, name, createdAt, resolvedAt, officer, officerEmail
            FROM referral_leads WHERE id = ? AND loanId IS NULL AND realtorId IS NOT NULL`).get(leadId) as unknown as UnlinkedReferral | undefined) ?? null,
        };
        return { leadWork, manager, message };
      }
      if (auditLoanId && auditBefore) recordLoanAudit(db, auditLoanId, staff, auditAction, now, auditBefore);
      const action = pilotLoanActions[data.type];
      if (staff?.brokerage.pilot && action && "loanId" in data) accessEvent(db, staff, action, data.loanId, now);
      if (scopedRealtorUpdates && (data.type === "createRealtorPortal" || data.type === "saveRealtorLinkOwner" || data.type === "revokeRealtorPortal")) {
        return { realtorChanged: true as const, message };
      }
      const repeatLoanId = data.type === "startReturningClient1003" ? applicationLoanId : undefined;
      const loanId = scopedLoanUpdates ? editedLoanId ?? repeatLoanId ?? scopedLoanId(data) : undefined;
      if (loanId && staff) {
        if (editedLoanId || data.type === "saveRetention") synchronizeRetentionTasks(db, new Date(now), { loanId });
        const loanWork = readEditableLoan(db, loanId, staff, staff.brokerage.id);
        if ("error" in loanWork) throw new WorkspaceError(loanWork.error);
        return { loanWork, message, ...(repeatLoanId ? { applicationLoanId: repeatLoanId } : {}), ...(editedLoanId ? { loanFormSaved: true as const,
          applicationToken: applicationLoanId ? loanWork.applications.find((app) => app.loanId === applicationLoanId)?.token : undefined } : {}) };
      }
      synchronizeRetentionTasks(db);
      if (scopedTaskUpdates && taskCommands.has(data.type)) return { tasksChanged: true as const, message };
      if (scopedContactUpdates && (data.type === "contact" || data.type === "deleteContact" || data.type === "importContacts")) {
        return { contactsChanged: true as const, contactId: data.type === "deleteContact" ? data.id : savedContactId, message };
      }
      return { state: scopeWorkspace(workspace(db, staff?.brokerage.role === "Admin"), staff), message, referralLoanId,
        applicationLoanId, migration, segmentPreview, mismoXml, mismoDuplicateLoanId, loanAudit };
    });
  } catch (error) {
    if (error instanceof LeadClaimConflict) return { error: error.message, claimConflict: true };
    if (error instanceof ReopenedMockClosingConflict && staff && scopedLoanUpdates) {
      const closingHoldWork = readEditableLoan(db, error.loanId, staff, staff.brokerage.id);
      if (!("error" in closingHoldWork)) return { error: error.message, closingHoldWork };
    }
    if (error instanceof WorkspaceError || error instanceof PricingError) return { error: error.message };
    if (data.type === "runPricing") return { error: "Pricing could not be completed. Try again." };
    console.error("Orbit mutation failed", error);
    return { error: "Orbit could not save the change. Please try again." };
  }
}

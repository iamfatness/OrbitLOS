import { env } from "cloudflare:workers";
import type { WorkspaceStaff } from "./staff-store";
import type { WorkspaceMutationScope } from "./commands";
import { demoBrokerageId, portalBrokerage } from "./brokerage-model";
import { jointLinkUnavailable } from "./joint-application-model";
import { googleSettings } from "./staff-auth";
import { fundingDashboardUnavailable } from "./funding-dashboard-model";
import { calendarUnavailable, campaignCallbacksUnavailable, officerQueueUnavailable } from "./officer-queue-model";
import { callbackPerformanceUnavailable } from "./campaign-callback-performance-model";
import { campaignManagerUnavailable } from "./campaign-manager-model";
import { callbackExceptionUnavailable } from "./campaign-callback-exceptions-model";
import { officerDashboardUnavailable } from "./officer-dashboard-model";
import { processorQueueUnavailable } from "./processor-queue-model";
import { salesDashboardUnavailable } from "./sales-dashboard-model";
import { conversationsUnavailable } from "./conversation-model";
import { inboundReplyUnavailable } from "./inbound-replies-model";
import { appointmentsUnavailable } from "./appointment-model";
import { coverageUnavailable } from "./coverage-model";
import { searchUnavailable } from "./workspace-search-model";
import { reviewsUnavailable } from "./loan-review-model";
import { playbookRunsUnavailable } from "./playbook-run-model";
import { canManageFinance, financeUnavailable } from "./brokerage-finance-model";
import { fileExceptionsUnavailable } from "./file-exception-model";
import { managerExceptionsUnavailable } from "./manager-exception-model";
import { reportingReadinessUnavailable } from "./call-report-readiness-model";
import { sharedRealtorQueueUnavailable } from "./realtor-claim-model";
import { contactMergeUnavailable } from "./contact-merge-model";
import { leadWorkUnavailable } from "./lead-work-model";
import { incomingLoanWorkUnavailable } from "./incoming-loan-work-model";
import { manualReturnFollowUpUnavailable } from "./lender-export-model";
import { preapprovalUnavailable, sharedPreapprovalUnavailable } from "./preapproval-model";
import { lenderPackageUnavailable, type SharedLenderPackageInput } from "./lender-handoff-share-model";
import { quoteSettingsUnavailable } from "./quote-intake-model";
import { incomeReviewUnavailable } from "./income-review-model";
import { leadDocumentsUnavailable } from "./lead-document-model";
export { currentStaff } from "./current-staff";

function staffWorkspace(staff: WorkspaceStaff | null) {
  if (!staff && googleSettings(env)) throw new Error("Workspace access denied.");
  return env.WORKSPACE.getByName(staff?.brokerage.id ?? demoBrokerageId);
}

export async function workOnContactMerge(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin") return { error: contactMergeUnavailable };
  return staffWorkspace(staff).contactMerge(input, staff);
}

export async function loadWorkspace(staff: WorkspaceStaff | null, deferred = false) {
  return staffWorkspace(staff).read(staff, deferred);
}

export async function loadPipeline(input: unknown, staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).pipeline(input, staff);
}

export async function loadLoanContactPicker(input: unknown, staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).loanContactPicker(input, staff);
}

export async function loadContactDirectory(input: unknown, staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).contactDirectory(input, staff);
}

export async function loadLeadInbox(input: unknown, staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).leadInbox(input, staff);
}

export async function updateWorkspace(input: unknown, staff: WorkspaceStaff | null, scope?: WorkspaceMutationScope) {
  return staffWorkspace(staff).write(input, staff, scope);
}

export async function loadWorkspaceTasks(input: unknown, staff: WorkspaceStaff) {
  return staffWorkspace(staff).workspaceTasks(input, staff);
}

export async function loadDraftQueue(input: unknown, staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).draftQueue(input, staff);
}

export async function loadPastClientQueue(input: unknown, staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).pastClientQueue(input, staff);
}

export async function loadRealtorWork(input: unknown, staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).realtorWork(input, staff);
}

export async function loadRecordHistory(input: unknown, staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).history(input, staff);
}

export async function loadLeadArchive(input: unknown, staff: WorkspaceStaff | null) {
  return staffWorkspace(staff).leadArchive(input, staff);
}

export async function loadSharedRealtorQueue(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff) return { error: sharedRealtorQueueUnavailable };
  return staffWorkspace(staff).sharedRealtorQueue(input, staff);
}

export async function loadRealtorQueueReport(input: unknown, staff: WorkspaceStaff) {
  return staffWorkspace(staff).realtorQueueReport(input, staff);
}

export async function updateRealtorQueueAssignment(input: unknown, staff: WorkspaceStaff) {
  return staffWorkspace(staff).realtorQueueAssignment(input, staff);
}

export async function loadFundingDashboard(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin") return { error: fundingDashboardUnavailable };
  return staffWorkspace(staff).fundingDashboard(input, staff);
}

export async function loadOfficerQueue(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff || staff.brokerage.role === "Processor") return { error: officerQueueUnavailable };
  return staffWorkspace(staff).officerQueue(input, staff);
}

export async function loadCampaignCallbacks(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff || staff.brokerage.role === "Processor") return { error: campaignCallbacksUnavailable };
  return staffWorkspace(staff).campaignCallbacks(input, staff);
}

export async function loadCampaignCallbackPerformance(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.pilot !== true) return { error: callbackPerformanceUnavailable };
  return staffWorkspace(staff).campaignCallbackPerformance(input, staff);
}

export async function loadCampaignManager(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.pilot !== true) return { error: campaignManagerUnavailable };
  return staffWorkspace(staff).campaignManager(input, staff);
}

export async function loadCampaignCallbackExceptions(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.pilot !== true) return { error: callbackExceptionUnavailable };
  return staffWorkspace(staff).campaignCallbackExceptions(input, staff);
}

export async function workOnOfficerDashboard(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff || staff.brokerage.role === "Processor") return { error: officerDashboardUnavailable };
  return staffWorkspace(staff).officerDashboard(input, staff);
}

export async function loadWorkspaceCalendar(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff) return { error: calendarUnavailable };
  return staffWorkspace(staff).workspaceCalendar(input, staff);
}

export async function updateAppointments(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff) return { error: appointmentsUnavailable };
  return staffWorkspace(staff).appointmentWork(input, staff);
}

export async function updateStaffCoverage(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff) return { error: coverageUnavailable };
  return staffWorkspace(staff).staffCoverage(input, staff);
}

export async function loadWorkspaceSearch(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff) return { error: searchUnavailable };
  return staffWorkspace(staff).workspaceSearch(input, staff);
}

export async function updateLoanReview(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff) return { error: reviewsUnavailable };
  return staffWorkspace(staff).staffLoanReview(input, staff);
}

export async function workOnPlaybookRun(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin") return { error: playbookRunsUnavailable };
  return staffWorkspace(staff).staffPlaybookRun(input, staff);
}

export async function workOnBrokerageFinance(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff || !canManageFinance(staff)) return { error: financeUnavailable };
  return staffWorkspace(staff).staffBrokerageFinance(input, staff);
}

export async function loadFileExceptions(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin") return { error: fileExceptionsUnavailable };
  return staffWorkspace(staff).staffFileExceptions(input, staff);
}

export async function loadManagerExceptionWork(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin") return { error: managerExceptionsUnavailable };
  return staffWorkspace(staff).staffManagerExceptions(input, staff);
}

export async function loadReportingReadiness(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin") return { error: reportingReadinessUnavailable };
  return staffWorkspace(staff).staffReportingReadiness(input, staff);
}

export async function loadProcessorQueue(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff || staff.brokerage.role === "LO") return { error: processorQueueUnavailable };
  return staffWorkspace(staff).processorQueue(input, staff);
}

export async function updateProcessingView(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff || staff.brokerage.role === "LO") return { error: processorQueueUnavailable };
  return staffWorkspace(staff).processingView(input, staff);
}

export async function loadEditableLoan(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff) return { error: "This loan is unavailable in your workspace." };
  return staffWorkspace(staff).editableLoan(input, staff);
}

export async function loadLoanHandoff(loanId: string, knownVersion: string, staff: WorkspaceStaff) {
  return staffWorkspace(staff).loanHandoff(loanId, knownVersion, staff);
}

export async function loadIncomingLoanWork(input: unknown, staff: WorkspaceStaff | null) {
  return staff ? staffWorkspace(staff).incomingLoanWork(input, staff) : { error: incomingLoanWorkUnavailable };
}

export async function saveManualReturnFollowUp(input: unknown, staff: WorkspaceStaff | null) {
  return staff ? staffWorkspace(staff).manualReturnFollowUp(input, staff) : { error: manualReturnFollowUpUnavailable };
}

export async function loadLoanScenarios(input: unknown, staff: WorkspaceStaff | null) {
  return staff ? staffWorkspace(staff).loanScenarios(staff, input) : { error: "Sign in to view loan scenarios." };
}

export async function workOnIncomeWorksheet(input: unknown, staff: WorkspaceStaff | null) {
  return staff ? staffWorkspace(staff).incomeWorksheet(staff, input) : { error: incomeReviewUnavailable };
}

export async function workOnLeadDocuments(input: unknown, staff: WorkspaceStaff | null) {
  return staff ? staffWorkspace(staff).leadDocuments(staff, input) : { error: leadDocumentsUnavailable };
}

export async function loadPreapprovalLetters(input: unknown, staff: WorkspaceStaff | null) {
  return staff ? staffWorkspace(staff).preapprovalLetters(staff, input) : { error: preapprovalUnavailable };
}

export async function loadEditableLead(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff || staff.brokerage.role === "Processor") return { error: leadWorkUnavailable };
  return staffWorkspace(staff).editableLead(input, staff);
}

export async function loadSalesDashboard(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin") return { error: salesDashboardUnavailable };
  return staffWorkspace(staff).salesDashboard(input, staff);
}

export async function updateSalesSettings(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin") return { error: salesDashboardUnavailable };
  return staffWorkspace(staff).salesSettings(input, staff);
}

export async function loadConversations(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff) return { error: conversationsUnavailable };
  return staffWorkspace(staff).conversations(input, staff);
}

export async function updateConversation(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff) return { error: conversationsUnavailable };
  return staffWorkspace(staff).changeConversation(input, staff);
}

export async function loadInboundReplies(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin" || !staff.brokerage.pilot) return { error: inboundReplyUnavailable };
  return staffWorkspace(staff).inboundReplies(input, staff);
}

export async function updateInboundReply(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin" || !staff.brokerage.pilot) return { error: inboundReplyUnavailable };
  return staffWorkspace(staff).changeInboundReply(input, staff);
}

export async function updateFundingRecord(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin") return { error: fundingDashboardUnavailable };
  return staffWorkspace(staff).fundingRecord(input, staff);
}

export async function loadPipelineExport(staff: WorkspaceStaff) {
  return staffWorkspace(staff).pipelineExport(staff);
}

export async function loadMigrationRecovery(staff: WorkspaceStaff, importId: unknown) {
  return staffWorkspace(staff).migrationRecovery(staff, importId);
}

export async function loadMigrationRecord(staff: WorkspaceStaff, input: unknown) {
  return staffWorkspace(staff).migrationRecord(staff, input);
}

export async function loadMigrationCutover(staff: WorkspaceStaff, origin: unknown) {
  return staffWorkspace(staff).migrationCutover(staff, origin);
}

export async function loadCutoverHandoff(staff: WorkspaceStaff, query: unknown) {
  return staffWorkspace(staff).cutoverHandoff(staff, query);
}

export async function loadCutoverFileLookup(staff: WorkspaceStaff, query: unknown) {
  return staffWorkspace(staff).cutoverFileLookup(staff, query);
}

export async function loadCutoverApplicationComparison(staff: WorkspaceStaff, query: unknown) {
  return staffWorkspace(staff).cutoverApplicationComparison(staff, query);
}

export async function loadCutoverFileInventory(staff: WorkspaceStaff, query: unknown) {
  return staffWorkspace(staff).cutoverFileInventory(staff, query);
}

export async function updateCutoverFileInventory(staff: WorkspaceStaff, input: unknown) {
  return staffWorkspace(staff).recordCutoverFileInventory(staff, input);
}

export async function updateMigrationCutover(staff: WorkspaceStaff, input: unknown) {
  return staffWorkspace(staff).recordCutoverReview(staff, input);
}

async function linkedWorkspace(input: unknown, pilotOnly = false) {
  const token = input && typeof input === "object" && "token" in input ? input.token : input;
  const id = portalBrokerage(token);
  if (!id) return null;
  if (id !== demoBrokerageId) {
    const link = await env.WORKSPACE.getByName(demoBrokerageId).brokerageForPortal(token);
    if (!link || (pilotOnly && !link.pilot)) return null;
  }
  return env.WORKSPACE.getByName(id);
}
export async function updateBorrowerApplication(input: unknown) {
  return (await linkedWorkspace(input))?.borrower(input) ?? { status: 404, error: "This application link is invalid or expired." };
}
export async function updateCoBorrowerApplication(input: unknown) {
  return (await linkedWorkspace(input, true))?.coBorrower(input) ?? { status: 404, error: jointLinkUnavailable };
}
export async function reserveBorrowerAddressLookup(token: string) {
  return (await linkedWorkspace(token))?.reserveAddressLookup(token) ?? 404;
}

export async function loadRealtorReferrals(input: unknown) {
  return (await linkedWorkspace(input))?.realtor(input) ?? { status: 404, error: "This referral link is invalid or expired." };
}

export async function loadSharedPreapproval(input: unknown) {
  return (await linkedWorkspace(input))?.sharedPreapproval(input) ?? { status: 404, error: sharedPreapprovalUnavailable };
}

export async function workOnLenderPackages(input: unknown, staff: WorkspaceStaff | null) {
  return staff ? staffWorkspace(staff).lenderPackages(staff, input) : { error: lenderPackageUnavailable };
}

export async function loadSharedLenderPackage(input: SharedLenderPackageInput) {
  return (await linkedWorkspace(input, true))?.sharedLenderPackage(input) ?? { status: 404, error: lenderPackageUnavailable };
}

export async function submitQuoteRequest(input: unknown) {
  const workspace = await linkedWorkspace(input);
  return workspace?.quoteLead(input, [...(googleSettings(env)?.allowedEmails ?? [])]) ?? { status: 404, error: "This quote request link is unavailable." };
}

export async function loadQuoteIntakeSettings(input: unknown, staff: WorkspaceStaff | null) {
  return staff ? staffWorkspace(staff).quoteIntakeSettings(staff, input) : { error: quoteSettingsUnavailable };
}

export async function workOnDocumentTemplates(input: unknown, staff: WorkspaceStaff | null) {
  return staff ? staffWorkspace(staff).documentTemplates(staff, input) : { error: "Document templates are unavailable in this workspace." };
}

export async function workOnFeeTemplates(input: unknown, staff: WorkspaceStaff | null) {
  return staff ? staffWorkspace(staff).feeTemplates(staff, input) : { error: "Fee templates are unavailable in this workspace." };
}

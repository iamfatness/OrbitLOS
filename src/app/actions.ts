"use server";

import { currentStaff, loadCampaignCallbackExceptions, loadCampaignCallbackPerformance, loadCampaignCallbacks, loadCampaignManager, loadCampaignSequencePerformance, loadConversations, loadCutoverApplicationComparison, loadCutoverFileInventory, loadCutoverFileLookup, loadCutoverHandoff, loadEditableLead, loadEditableLoan, loadFileExceptions, loadFundingDashboard, loadInboundReplies, loadLeadArchive, loadMigrationCutover, loadMigrationRecovery, loadOfficerQueue, loadPipelineExport, loadProcessorQueue, loadRecordHistory, loadSalesDashboard, loadWorkspaceCalendar, loadWorkspaceSearch,
  loadContactDirectory, loadDraftQueue, loadLeadInbox, loadLoanContactPicker, loadPipeline, loadRealtorQueueReport, loadReportingReadiness, loadSharedRealtorQueue, loadWorkspaceTasks, updateAppointments, updateConversation, updateCutoverFileInventory, updateFundingRecord, updateInboundReply, updateLoanReview, updateMigrationCutover, updateProcessingView, updateRealtorQueueAssignment, updateSalesSettings, updateStaffCoverage, updateWorkspace,
  loadUwmDelivery, workOnBrokerageFinance, workOnContactMerge, workOnOfficerDashboard, workOnPlaybookRun } from "@/lib/workspace-service";
import { uwmDeliveryUnavailable } from "@/lib/uwm-delivery-model";
import { demoBrokerageId } from "@/lib/brokerage-model";
import { fundingDashboardUnavailable } from "@/lib/funding-dashboard-model";
import { calendarUnavailable, campaignCallbacksUnavailable, officerQueueUnavailable, workspaceTasksUnavailable } from "@/lib/officer-queue-model";
import type { WorkspaceMutationScope } from "@/lib/commands";
import { callbackPerformanceUnavailable } from "@/lib/campaign-callback-performance-model";
import { campaignManagerUnavailable } from "@/lib/campaign-manager-model";
import { callbackExceptionUnavailable } from "@/lib/campaign-callback-exceptions-model";
import { officerDashboardUnavailable } from "@/lib/officer-dashboard-model";
import { processorQueueUnavailable } from "@/lib/processor-queue-model";
import { salesDashboardUnavailable } from "@/lib/sales-dashboard-model";
import { ownerScorecardUnavailable } from "@/lib/owner-scorecard-model";
import { loadOwnerScorecard, updateOwnerScorecard, workOnCustomReport } from "@/lib/workspace-service";
import { customReportUnavailable } from "@/lib/custom-report-model";
import { conversationsUnavailable } from "@/lib/conversation-model";
import { inboundReplyUnavailable } from "@/lib/inbound-replies-model";
import { appointmentsUnavailable } from "@/lib/appointment-model";
import { coverageUnavailable } from "@/lib/coverage-model";
import { searchUnavailable } from "@/lib/workspace-search-model";
import { reviewsUnavailable } from "@/lib/loan-review-model";
import { playbookRunsUnavailable } from "@/lib/playbook-run-model";
import { financeUnavailable } from "@/lib/brokerage-finance-model";
import { fileExceptionsUnavailable } from "@/lib/file-exception-model";
import { reportingReadinessUnavailable } from "@/lib/call-report-readiness-model";
import { sharedRealtorQueueUnavailable } from "@/lib/realtor-claim-model";
import { realtorQueueReportUnavailable } from "@/lib/realtor-queue-report-model";
import { cutoverUnavailable, type CutoverApplicationQuery, type CutoverFileInventoryInput, type CutoverFileLookup, type CutoverFileLookupQuery,
  type CutoverHandoffQuery } from "@/lib/migration-cutover-model";
import { contactMergeUnavailable } from "@/lib/contact-merge-model";
import { leadWorkUnavailable, type LeadWorkRequest } from "@/lib/lead-work-model";
import { pipelineUnavailable } from "@/lib/pipeline-model";
import { loanContactPickerUnavailable } from "@/lib/loan-contact-picker-model";
import { contactsUnavailable } from "@/lib/contact-directory-model";
import { draftQueueUnavailable } from "@/lib/communication-draft-model";
import { pastClientsUnavailable } from "@/lib/past-client-queue-model";
import { loadPastClientQueue, loadRealtorWork } from "@/lib/workspace-service";
import { realtorWorkUnavailable } from "@/lib/realtor-work-model";
import { loadManagerExceptionWork } from "@/lib/workspace-service";
import { managerExceptionsUnavailable } from "@/lib/manager-exception-model";
import { loadMigrationRecord } from "@/lib/workspace-service";
import { loadIncomingLoanWork, loadLoanHandoff, saveManualReturnFollowUp } from "@/lib/workspace-service";
import { incomingLoanWorkUnavailable } from "@/lib/incoming-loan-work-model";
import { manualReturnFollowUpUnavailable } from "@/lib/lender-export-model";
import { migrationRecordUnavailable } from "@/lib/migration-record-model";
import { leadInboxUnavailable } from "@/lib/lead-inbox-model";

export async function readInboxWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: leadInboxUnavailable };
  return loadLeadInbox(input, staff);
}

export async function readContactsWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: contactsUnavailable };
  return loadContactDirectory(input, staff);
}

export async function readLoanContactOptions(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: loanContactPickerUnavailable };
  return loadLoanContactPicker(input, staff);
}

export async function readPipelineWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: pipelineUnavailable };
  return loadPipeline(input, staff);
}

export async function reviewContactMerge(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: contactMergeUnavailable };
  return workOnContactMerge(input, staff);
}

export async function mutate(input: unknown, expectedBrokerage: string, scope?: WorkspaceMutationScope) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: "The workspace changed. Reload before saving." };
  return updateWorkspace(input, staff, scope);
}

export async function readTaskWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if (!staff || staff.brokerage.id !== expectedBrokerage) return { error: workspaceTasksUnavailable };
  return loadWorkspaceTasks(input, staff);
}

export async function readDraftWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: draftQueueUnavailable };
  return loadDraftQueue(input, staff);
}

export async function readPastClientWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: pastClientsUnavailable };
  return loadPastClientQueue(input, staff);
}

export async function readRealtorWorkspace(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: realtorWorkUnavailable };
  return loadRealtorWork(input, staff);
}

export async function readManagerExceptions(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: managerExceptionsUnavailable };
  return loadManagerExceptionWork(input, staff);
}

export async function readHistoryPage(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: "The workspace changed. Reload to view activity history." };
  return loadRecordHistory(input, staff);
}

export async function readMockUwmDelivery(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: uwmDeliveryUnavailable };
  return loadUwmDelivery(input, staff);
}

export async function readArchivePage(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: "The workspace changed. Reload to view the lead archive." };
  return loadLeadArchive(input, staff);
}

export async function readSharedRealtorPage(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if (!staff || staff.brokerage.id !== expectedBrokerage) return { error: sharedRealtorQueueUnavailable };
  return loadSharedRealtorQueue(input, staff);
}

export async function readManagerRealtorQueue(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if (staff?.brokerage.id !== expectedBrokerage || staff.brokerage.role !== "Admin") return { error: realtorQueueReportUnavailable };
  return loadRealtorQueueReport(input, staff);
}

export async function assignManagerRealtorReferral(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if (staff?.brokerage.id !== expectedBrokerage || staff.brokerage.role !== "Admin") return { error: realtorQueueReportUnavailable };
  return updateRealtorQueueAssignment(input, staff);
}

export async function readFundingDashboard(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: fundingDashboardUnavailable };
  return loadFundingDashboard(input, staff);
}

export async function readMyTasksToday(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: officerQueueUnavailable };
  return loadOfficerQueue(input, staff);
}

export async function readMyCampaignCallbacks(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if (!staff || staff.brokerage.id !== expectedBrokerage) return { error: campaignCallbacksUnavailable };
  return loadCampaignCallbacks(input, staff);
}

export async function readCampaignCallbackPerformance(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: callbackPerformanceUnavailable };
  return loadCampaignCallbackPerformance(input, staff);
}

export async function readCampaignManager(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: campaignManagerUnavailable };
  return loadCampaignManager(input, staff);
}

export async function readCampaignSequencePerformance(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: campaignManagerUnavailable };
  return loadCampaignSequencePerformance(input, staff);
}

export async function readCampaignCallbackExceptions(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if (staff?.brokerage.id !== expectedBrokerage || staff.brokerage.role !== "Admin" || staff.brokerage.pilot !== true) {
    return { error: callbackExceptionUnavailable };
  }
  return loadCampaignCallbackExceptions(input, staff);
}

export async function requestOfficerDashboard(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: officerDashboardUnavailable };
  return workOnOfficerDashboard(input, staff);
}

export async function readCalendarWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: calendarUnavailable };
  return loadWorkspaceCalendar(input, staff);
}

export async function searchWorkspace(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: searchUnavailable };
  return loadWorkspaceSearch(input, staff);
}

export async function workOnLoanReview(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: reviewsUnavailable };
  return updateLoanReview(input, staff);
}

export async function accessPlaybookRuns(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: playbookRunsUnavailable };
  return workOnPlaybookRun(input, staff);
}

export async function accessBrokerageFinance(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: financeUnavailable };
  return workOnBrokerageFinance(input, staff);
}

export async function readManagerFileExceptions(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: fileExceptionsUnavailable };
  return loadFileExceptions(input, staff);
}

export async function accessReportingReadiness(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: reportingReadinessUnavailable };
  return loadReportingReadiness(input, staff);
}

export async function saveAppointmentWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: appointmentsUnavailable };
  return updateAppointments(input, staff);
}

export async function workOnStaffCoverage(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: coverageUnavailable };
  return updateStaffCoverage(input, staff);
}

export async function readProcessingWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: processorQueueUnavailable };
  return loadProcessorQueue(input, staff);
}

export async function saveProcessingView(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: processorQueueUnavailable };
  return updateProcessingView(input, staff);
}

export async function readLoanForWork(loanId: string, expectedBrokerage: string, context?: "stalled" | "brokerage-stalled") {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: "This loan is unavailable in your workspace." };
  return loadEditableLoan(context === "brokerage-stalled" ? { stalledLoanId: loanId, scope: "brokerage" } :
    context === "stalled" ? { stalledLoanId: loanId } : loanId, staff);
}

export async function checkLoanHandoff(loanId: string, expectedBrokerage: string, knownVersion: string) {
  const staff = await currentStaff();
  if (!staff || staff.brokerage.id !== expectedBrokerage) return { error: "This loan is unavailable in your workspace." };
  return loadLoanHandoff(loanId, knownVersion, staff);
}

export async function readIncomingLoanWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: incomingLoanWorkUnavailable };
  return loadIncomingLoanWork(input, staff);
}

export async function logLenderReturnFollowUp(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: manualReturnFollowUpUnavailable };
  return saveManualReturnFollowUp(input, staff);
}

export async function readLeadForWork(input: LeadWorkRequest, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: leadWorkUnavailable };
  return loadEditableLead(input, staff);
}

export async function readSalesReport(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: salesDashboardUnavailable };
  return loadSalesDashboard(input, staff);
}

export async function readOwnerReport(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: ownerScorecardUnavailable };
  return loadOwnerScorecard(input, staff);
}

export async function saveOwnerReportView(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: ownerScorecardUnavailable };
  return updateOwnerScorecard(input, staff);
}

export async function accessCustomReport(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: customReportUnavailable };
  return workOnCustomReport(input, staff);
}

export async function saveSalesSetting(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: salesDashboardUnavailable };
  return updateSalesSettings(input, staff);
}

export async function readConversationWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: conversationsUnavailable };
  return loadConversations(input, staff);
}

export async function saveConversationWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: conversationsUnavailable };
  return updateConversation(input, staff);
}

export async function readInboundReplyWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: inboundReplyUnavailable };
  return loadInboundReplies(input, staff);
}

export async function saveInboundReplyWork(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: inboundReplyUnavailable };
  return updateInboundReply(input, staff);
}

export async function requestFundingRecord(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: fundingDashboardUnavailable };
  return updateFundingRecord(input, staff);
}

export async function readPipelineExport(expectedBrokerage: string) {
  const staff = await currentStaff();
  if (!staff || staff.brokerage.id !== expectedBrokerage || staff.brokerage.role !== "Admin" || !staff.brokerage.pilot) {
    return { error: "This pilot CRM export is unavailable." };
  }
  return loadPipelineExport(staff);
}

export async function readMigrationRecovery(expectedBrokerage: string, importId?: string) {
  const staff = await currentStaff();
  if (!staff || staff.brokerage.id !== expectedBrokerage || staff.brokerage.role !== "Admin" || !staff.brokerage.pilot) {
    return { error: "CRM import recovery is unavailable." };
  }
  return loadMigrationRecovery(staff, importId);
}

async function cutoverAdmin(expectedBrokerage: string) {
  const staff = await currentStaff();
  return staff?.brokerage.id === expectedBrokerage && staff.brokerage.role === "Admin" && staff.brokerage.pilot ? staff : null;
}

export async function openMigrationRecord(input: unknown, expectedBrokerage: string) {
  const staff = await cutoverAdmin(expectedBrokerage);
  return staff ? loadMigrationRecord(staff, input) : { error: migrationRecordUnavailable };
}

export async function readCutoverChecklist(expectedBrokerage: string, query?: unknown) {
  const staff = await cutoverAdmin(expectedBrokerage);
  return staff ? loadMigrationCutover(staff, query) : { error: cutoverUnavailable };
}

export async function downloadCutoverHandoff(expectedBrokerage: string, query: CutoverHandoffQuery) {
  const staff = await cutoverAdmin(expectedBrokerage);
  return staff ? loadCutoverHandoff(staff, query) : { error: cutoverUnavailable };
}

export async function findCutoverFile(expectedBrokerage: string, query: CutoverFileLookupQuery): Promise<CutoverFileLookup> {
  const staff = await cutoverAdmin(expectedBrokerage);
  return staff ? loadCutoverFileLookup(staff, query) : { error: cutoverUnavailable };
}

export async function readCutoverApplicationComparison(expectedBrokerage: string, query: CutoverApplicationQuery) {
  const staff = await cutoverAdmin(expectedBrokerage);
  return staff ? loadCutoverApplicationComparison(staff, query) : { error: cutoverUnavailable };
}

export async function readCutoverFileInventory(expectedBrokerage: string, query: CutoverApplicationQuery) {
  const staff = await cutoverAdmin(expectedBrokerage);
  return staff ? loadCutoverFileInventory(staff, query) : { error: cutoverUnavailable };
}

export async function saveCutoverFileInventory(expectedBrokerage: string, input: CutoverFileInventoryInput) {
  const staff = await cutoverAdmin(expectedBrokerage);
  return staff ? updateCutoverFileInventory(staff, input) : { error: cutoverUnavailable };
}

export async function saveCutoverReview(expectedBrokerage: string, input: unknown) {
  const staff = await cutoverAdmin(expectedBrokerage);
  return staff ? updateMigrationCutover(staff, input) : { error: cutoverUnavailable };
}

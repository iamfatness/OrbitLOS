import { mkdirSync } from "node:fs";
import { checkUwmPublicConnection, uwmConnectionSettings } from "./uwm-live";

export async function loadUwmConnection(staff: WorkspaceStaff | null) { return uwmConnectionSettings(process.env, staff); }
export async function verifyUwmConnection(staff: WorkspaceStaff | null) { return checkUwmPublicConnection(process.env, staff); }
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeCommand } from "./commands";
import { confirmClosingDisclosure, disclosureCommand } from "./disclosure-model";
import { prepareClosingPacketInput } from "./closing-packet-model";
import { readClosingPacket } from "./closing-packets";
import { contactMergeWork } from "./contact-merge";
import { borrowerCommandResult, coBorrowerCommandResult } from "./applications";
import { reserveAddressLookup } from "./places";
import type { WorkspaceStaff } from "./staff-store";
import { demoBrokerageId, portalBrokerage } from "./brokerage-model";
import { localCampaignOfficers } from "./call-campaign-model";
import { scopeWorkspace } from "./workspace-access";
import { realtorReferrals } from "./realtor-portal";
import { initializeStore, readStaffWorkspaceEntry, readWorkspace, type SqlValue, type Store } from "./store";
import { readPipeline } from "./pipeline";
import { readLoanContactPicker } from "./loan-contact-picker";
import { readContactDirectory } from "./contact-directory";
import { readDraftQueue } from "./communication-draft-query";
import { readPastClientQueue } from "./past-client-queue";
import { readRealtorWork } from "./realtor-work";
import { readLeadInbox } from "./lead-inbox-query";
import { readLeadArchive } from "./lead-inbox";
import { receiveQuoteLead, workOnQuoteSettings } from "./quote-intake";
import { documentTemplateWork } from "./document-templates";
import { feeTemplateWork } from "./fee-templates";
import { incomeWorksheetWork } from "./income-review";
import { leadDocumentWork } from "./lead-documents";
import { lenderPackageAccess, lenderShareWork } from "./lender-handoff-share";
import type { SharedLenderPackageInput } from "./lender-handoff-share-model";
import { readSharedRealtorQueue } from "./realtor-claim-queue";
import { assignWaitingRealtor, readRealtorQueueReport } from "./realtor-queue-report";
import { assignWaitingRealtorInput } from "./realtor-queue-report-model";
import { readRecordHistory } from "./record-history";
import { readUwmDelivery } from "./uwm-delivery";
import { exportPilotPipeline } from "./pipeline-export";
import { reviewMigrationRecovery } from "./migration-recovery";
import { exportCutoverHandoff, lookupCutoverFile, readCutoverApplicationComparison, readCutoverFileInventory, readMigrationCutover,
  saveCutoverFileInventory, saveMigrationCutover } from "./migration-cutover";
import { fundingRecordAction, readFundingDashboard } from "./funding-dashboard";
import { readCampaignCallbacks, readOfficerQueue, readWorkspaceCalendar, readWorkspaceTasks } from "./officer-queue";
import { readActionCounts } from "./workspace-action-counts";
import type { WorkspaceMutationScope } from "./commands";
import { campaignCallbacksUnavailable } from "./officer-queue-model";
import { readCampaignCallbackPerformance } from "./campaign-callback-performance";
import { readCampaignManager } from "./campaign-manager";
import { readCampaignSequencePerformance } from "./campaign-sequence-performance";
import { callbackPerformanceUnavailable } from "./campaign-callback-performance-model";
import { readCampaignCallbackExceptions } from "./campaign-callback-exceptions";
import { callbackExceptionUnavailable } from "./campaign-callback-exceptions-model";
import { officerDashboardWork } from "./officer-dashboard";
import { changeProcessingView, readProcessorQueue } from "./processor-queue";
import { readEditableLoan, readLoanHandoff } from "./editable-loan";
import { readIncomingLoanWorkPage } from "./incoming-loan-work";
import { recordManualReturnFollowUp } from "./manual-lender-work";
import { loanScenarioWork } from "./loan-scenarios";
import { workOnPreapprovalLetters } from "./preapproval-letters";
import { sharedPreapprovalDownload } from "./preapproval-sharing";
import { sharedPreapprovalRequest, sharedPreapprovalUnavailable } from "./preapproval-model";
import { readEditableLead } from "./editable-lead";
import { changeSalesSettings, readSalesDashboard } from "./sales-dashboard";
import { changeOwnerScorecardSettings, readOwnerScorecard } from "./owner-scorecard";
import { customReportWork } from "./custom-reports";
import { crmFieldWork } from "./crm-fields";
import { disclosureCalendarWork } from "./disclosure-calendar";
import { disclosureTemplateWork } from "./disclosure-templates";
import { complianceWorkUnavailable } from "./compliance-case-model";
import type { ComplianceCaseResult } from "./compliance-cases";
import { borrowerQuestionSetWork } from "./borrower-question-sets";
import { loanStageEditWork } from "./loan-stage-edits";
import { closingGateWork } from "./closing-gates";
import { changeConversation, readConversations } from "./conversations";
import { changeInboundReply, readInboundReplies } from "./inbound-replies";
import { workOnAppointment } from "./appointments";
import { coverageWork } from "./coverage";
import { coverageInput, type CoverageResult } from "./coverage-model";
import { readWorkspaceSearch } from "./workspace-search";
import { loanReviewWork } from "./loan-reviews";
import { reviewInput, type ReviewResult } from "./loan-review-model";
import { playbookRunWork } from "./playbook-runs";
import { brokerageFinanceWork } from "./brokerage-finance";
import { nameFileExceptions, readFileExceptions } from "./file-exceptions";
import { readManagerExceptionWork } from "./manager-exceptions";
import { readMigrationRecord } from "./migration-record";
import { reportingReadinessWork } from "./call-report-readiness";
import type { VersionedBrokerageMember } from "./brokerage-model";

let connection: Store | undefined;

export async function currentStaff(): Promise<WorkspaceStaff | null> {
  return null;
}

function database(): Store {
  if (connection) return connection;
  const path = resolve(/* turbopackIgnore: true */ process.env.ORBIT_DB_PATH || ".orbit/orbit.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  const store: Store = {
    exec(sql) {
      sqlite.exec(sql);
    },
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        get: (...args) => {
          const row = statement.get(...args);
          return row ? { ...row } as Record<string, SqlValue> : undefined;
        },
        all: (...args) => statement.all(...args).map((row) => ({ ...row }) as Record<string, SqlValue>),
        run: (...args) => { statement.run(...args); },
      };
    },
    transaction(run) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = run();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  try {
    sqlite.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    initializeStore(store);
  } catch (error) {
    sqlite.close();
    throw error;
  }
  connection = store;
  return store;
}

export function loadWorkspace(staff: WorkspaceStaff | null = null, deferred = false) {
  if (deferred && staff) return readStaffWorkspaceEntry(database(), staff);
  return scopeWorkspace(readWorkspace(database(), staff?.brokerage.role === "Admin"), staff);
}

export async function loadPipeline(input: unknown, staff: WorkspaceStaff | null) {
  const db = database();
  return db.transaction(() => readPipeline(db, input, staff));
}

export async function loadLoanContactPicker(input: unknown, staff: WorkspaceStaff | null) {
  const db = database();
  return db.transaction(() => readLoanContactPicker(db, input, staff));
}

export async function loadContactDirectory(input: unknown, staff: WorkspaceStaff | null) {
  const db = database();
  return db.transaction(() => readContactDirectory(db, input, staff));
}

export async function loadLeadInbox(input: unknown, staff: WorkspaceStaff | null) {
  const db = database();
  return db.transaction(() => readLeadInbox(db, input, staff));
}

export async function updateWorkspace(input: unknown, staff: WorkspaceStaff | null, scope?: WorkspaceMutationScope) {
  if (!staff && process.env.NODE_ENV === "development" && input && typeof input === "object" && "type" in input && input.type === "saveCallReport") {
    return executeCommand(database(), input, localAdmin);
  }
  if (!staff && process.env.NODE_ENV === "development" && process.env.ORBIT_LOCAL_REHEARSAL === "1" &&
    input && typeof input === "object" && "type" in input && input.type === "exportReviewedApplication") {
    return executeCommand(database(), input, {
      ...localCampaignOfficers[0],
      brokerage: { id: demoBrokerageId, name: "Local rehearsal", role: "Admin", pilot: true },
    });
  }
  const localScopedLoan = !staff && process.env.NODE_ENV === "development" && input && typeof input === "object" && "type" in input &&
    (input.type === "runPricing" && "incomeReviewRevision" in input || input.type === "saveFeeWorksheet" || input.type === "saveAllocatedFeeWorksheet" ||
      input.type === "saveLenderDetails" || input.type === "requestApplicationCorrection" || input.type === "selectOffer" ||
      input.type === "simulateMissingUwmReceipt" || input.type === "reconcileMockUwmReceipt" ||
      input.type === "requestBorrowerQuestion" || input.type === "applyBorrowerQuestionSet" || input.type === "reviewBorrowerQuestion" || input.type === "refreshBorrowerQuestions" ||
      input.type === "createServiceOrder" || input.type === "updateServiceOrder" || input.type === "setClosingServiceEvidence" ||
      input.type === "prepareClosingHandoff" || input.type === "saveClosingTarget" || input.type === "saveClosingItem" || input.type === "completeClosingItem" ||
      confirmClosingDisclosure.safeParse(input).success || disclosureCommand.safeParse(input).success || prepareClosingPacketInput.safeParse(input).success);
  const actor = localScopedLoan ? localPilotAdmin : staff;
  return executeCommand(database(), input, actor, undefined, [], { scopedLeadUpdates: true, scopedLoanUpdates: true,
    scopedContactUpdates: true, scopedInboxUpdates: scope === "inbox", scopedTaskUpdates: scope === "tasks", scopedTemplateUpdates: true,
    scopedRealtorUpdates: scope === "realtors", scopedMigrationUpdates: scope === "migration" });
}

export async function loadWorkspaceTasks(input: unknown, staff: WorkspaceStaff) {
  const db = database();
  return db.transaction(() => readWorkspaceTasks(db, input, staff, demoBrokerageId));
}

export async function loadDraftQueue(input: unknown, staff: WorkspaceStaff | null) {
  const db = database();
  return db.transaction(() => readDraftQueue(db, input, staff));
}

export async function loadPastClientQueue(input: unknown, staff: WorkspaceStaff | null) {
  const db = database();
  return db.transaction(() => readPastClientQueue(db, input, staff));
}

export async function loadRealtorWork(input: unknown, staff: WorkspaceStaff | null) {
  const db = database();
  return db.transaction(() => readRealtorWork(db, input, staff));
}

export async function loadRecordHistory(input: unknown, staff: WorkspaceStaff | null) {
  return readRecordHistory(database(), staff, input);
}

export async function loadUwmDelivery(input: unknown, staff: WorkspaceStaff | null) {
  return readUwmDelivery(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localPilotAdmin : null), demoBrokerageId);
}

export async function loadLeadArchive(input: unknown, staff: WorkspaceStaff | null) {
  return readLeadArchive(database(), staff, input);
}

export async function loadSharedRealtorQueue(input: unknown, staff: WorkspaceStaff | null) {
  return readSharedRealtorQueue(database(), staff, demoBrokerageId, input);
}

export async function loadRealtorQueueReport(input: unknown, staff: WorkspaceStaff) {
  return readRealtorQueueReport(database(), staff, demoBrokerageId, input);
}

export async function updateRealtorQueueAssignment(input: unknown, staff: WorkspaceStaff) {
  const parsed = assignWaitingRealtorInput.safeParse(input);
  if (!parsed.success) return { error: "Choose a waiting referral and an active officer." };
  return assignWaitingRealtor(database(), staff, demoBrokerageId, parsed.data, parsed.data.officerEmail === staff.email ? staff : null);
}

const localAdmin: WorkspaceStaff = { ...localCampaignOfficers[0], brokerage: { id: demoBrokerageId, name: "Local demo", role: "Admin" } };
const localPilotAdmin: WorkspaceStaff = { ...localAdmin, brokerage: { ...localAdmin.brokerage, pilot: true } };

export async function workOnContactMerge(input: unknown, staff: WorkspaceStaff | null) {
  return contactMergeWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null), demoBrokerageId);
}

export async function loadReportingReadiness(input: unknown, staff: WorkspaceStaff | null) {
  return reportingReadinessWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null), demoBrokerageId);
}
const localReviewMembers: VersionedBrokerageMember[] = [
  { name: localAdmin.name, email: localAdmin.email, role: "Admin", status: "Active" },
  { ...localCampaignOfficers[1], role: "LO", status: "Active" },
  { name: "Fictional Processor", email: "processor@example.test", role: "Processor", status: "Active" },
];

export async function loadFileExceptions(input: unknown, staff: WorkspaceStaff | null) {
  const page = readFileExceptions(database(), input, staff ?? localAdmin, demoBrokerageId);
  return "error" in page ? page : nameFileExceptions(page, localReviewMembers);
}

export async function loadManagerExceptionWork(input: unknown, staff: WorkspaceStaff | null) {
  const db = database();
  return db.transaction(() => readManagerExceptionWork(db, input, staff, staff ? localReviewMembers : null));
}

export async function workOnBrokerageFinance(input: unknown, staff: WorkspaceStaff | null) {
  const localOwner = process.env.NODE_ENV === "development" ? { ...localPilotAdmin,
    brokerage: { ...localPilotAdmin.brokerage, financeAccess: true } } : null;
  return brokerageFinanceWork(database(), input, staff ?? localOwner, demoBrokerageId);
}

export async function workOnPlaybookRun(input: unknown, staff: WorkspaceStaff | null) {
  return playbookRunWork(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function loadFundingDashboard(input: unknown, staff: WorkspaceStaff | null) {
  return readFundingDashboard(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function loadOfficerQueue(input: unknown, staff: WorkspaceStaff | null) {
  return readOfficerQueue(database(), input, staff ?? localAdmin, demoBrokerageId, new Date(), staff ? undefined : localAdmin.name);
}

export async function loadActionCounts(staff: WorkspaceStaff | null) {
  const db = database();
  return db.transaction(() => readActionCounts(db, staff ?? localAdmin, demoBrokerageId, new Date(), staff ? undefined : localAdmin.name));
}

export async function loadCampaignCallbacks(input: unknown, staff: WorkspaceStaff | null) {
  if (!staff || staff.brokerage.role === "Processor") return { error: campaignCallbacksUnavailable };
  return readCampaignCallbacks(database(), input, staff, demoBrokerageId);
}

export async function loadCampaignCallbackPerformance(input: unknown, staff: WorkspaceStaff | null) {
  const viewer = staff ?? (process.env.NODE_ENV === "development" ? localPilotAdmin : null);
  if (viewer?.brokerage.role !== "Admin" || viewer.brokerage.pilot !== true) return { error: callbackPerformanceUnavailable };
  return readCampaignCallbackPerformance(database(), input, viewer, demoBrokerageId);
}

export async function loadCampaignManager(input: unknown, staff: WorkspaceStaff | null) {
  const viewer = staff ?? (process.env.NODE_ENV === "development" ? localPilotAdmin : null);
  return readCampaignManager(database(), input, viewer, demoBrokerageId);
}

export async function loadCampaignSequencePerformance(input: unknown, staff: WorkspaceStaff | null) {
  const viewer = staff ?? (process.env.NODE_ENV === "development" ? localPilotAdmin : null);
  return readCampaignSequencePerformance(database(), input, viewer, demoBrokerageId);
}

export async function loadCampaignCallbackExceptions(input: unknown, staff: WorkspaceStaff | null) {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.pilot !== true) return { error: callbackExceptionUnavailable };
  return readCampaignCallbackExceptions(database(), input, staff, demoBrokerageId);
}

export async function workOnOfficerDashboard(input: unknown, staff: WorkspaceStaff | null) {
  const local = !staff && process.env.NODE_ENV === "development" ? localAdmin : null;
  return officerDashboardWork(database(), input, staff ?? local, demoBrokerageId, new Date(), local?.name);
}

export async function loadWorkspaceCalendar(input: unknown, staff: WorkspaceStaff | null) {
  return readWorkspaceCalendar(database(), input, staff ?? localAdmin, demoBrokerageId, new Date(), staff ? undefined : localAdmin.name);
}

export async function updateAppointments(input: unknown, staff: WorkspaceStaff | null) {
  return workOnAppointment(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function updateStaffCoverage(input: unknown, staff: WorkspaceStaff | null): Promise<CoverageResult> {
  const parsed = coverageInput.safeParse(input);
  if (!parsed.success) return { error: "Check the coverage dates or work details and try again." };
  const roster = localCampaignOfficers.map((person, index) => ({ ...person, role: index === 0 ? "Admin" as const : "LO" as const, status: "Active" as const }));
  return coverageWork(database(), parsed.data, staff ?? localAdmin, demoBrokerageId, roster);
}

export async function loadWorkspaceSearch(input: unknown, staff: WorkspaceStaff | null) {
  return readWorkspaceSearch(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function updateLoanReview(input: unknown, staff: WorkspaceStaff | null): Promise<ReviewResult> {
  const parsed = reviewInput.safeParse(input);
  if (!parsed.success) return { error: "Check the reviewer, dates, and note before continuing." };
  return loanReviewWork(database(), parsed.data, staff ?? localAdmin, demoBrokerageId, localReviewMembers);
}

export async function loadProcessorQueue(input: unknown, staff: WorkspaceStaff | null) {
  return readProcessorQueue(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function updateProcessingView(input: unknown, staff: WorkspaceStaff | null) {
  return changeProcessingView(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function loadEditableLoan(input: unknown, staff: WorkspaceStaff | null) {
  return readEditableLoan(database(), input, staff ?? localAdmin, demoBrokerageId, staff ? undefined : localAdmin.name);
}

export async function loadClosingPacket(input: unknown, staff: WorkspaceStaff | null) {
  const viewer = staff ?? (process.env.NODE_ENV === "development" ? localPilotAdmin : null);
  return readClosingPacket(database(), input, viewer, demoBrokerageId);
}

export async function loadLoanHandoff(loanId: string, knownVersion: string, staff: WorkspaceStaff) {
  return readLoanHandoff(database(), loanId, knownVersion, staff, demoBrokerageId);
}

export async function loadIncomingLoanWork(input: unknown, staff: WorkspaceStaff | null) {
  return readIncomingLoanWorkPage(database(), input, staff ?? localAdmin, demoBrokerageId, staff ? undefined : localAdmin.name);
}

export async function saveManualReturnFollowUp(input: unknown, staff: WorkspaceStaff | null) {
  const local = !staff && process.env.NODE_ENV === "development" ? localAdmin : null;
  return recordManualReturnFollowUp(database(), input, staff ?? local, demoBrokerageId, local?.name);
}

export async function loadLoanScenarios(input: unknown, staff: WorkspaceStaff | null) {
  const actor = staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null);
  return actor ? loanScenarioWork(database(), input, actor, demoBrokerageId) : { error: "Sign in to view loan scenarios." };
}

export async function workOnIncomeWorksheet(input: unknown, staff: WorkspaceStaff | null) {
  return incomeWorksheetWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localPilotAdmin : null), demoBrokerageId);
}

export async function workOnLeadDocuments(input: unknown, staff: WorkspaceStaff | null) {
  return leadDocumentWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localPilotAdmin : null), demoBrokerageId, false);
}

export async function loadPreapprovalLetters(input: unknown, staff: WorkspaceStaff | null) {
  const actor = staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null);
  return workOnPreapprovalLetters(database(), input, actor, demoBrokerageId);
}

export async function loadEditableLead(input: unknown, staff: WorkspaceStaff | null) {
  return readEditableLead(database(), input, staff ?? localAdmin, demoBrokerageId, staff ? undefined : localAdmin.name);
}

export async function loadSalesDashboard(input: unknown, staff: WorkspaceStaff | null) {
  return readSalesDashboard(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function loadOwnerScorecard(input: unknown, staff: WorkspaceStaff | null) {
  return readOwnerScorecard(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function updateOwnerScorecard(input: unknown, staff: WorkspaceStaff | null) {
  return changeOwnerScorecardSettings(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function workOnCustomReport(input: unknown, staff: WorkspaceStaff | null) {
  return customReportWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null), demoBrokerageId);
}

export async function workOnCrmFields(input: unknown, staff: WorkspaceStaff | null) {
  return crmFieldWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null), demoBrokerageId);
}

export async function workOnDisclosureCalendar(input: unknown, staff: WorkspaceStaff | null) {
  return disclosureCalendarWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null), demoBrokerageId);
}

export async function workOnDisclosureTemplates(input: unknown, staff: WorkspaceStaff | null) {
  return disclosureTemplateWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null), demoBrokerageId);
}

export const workOnComplianceCases: (input: unknown, staff: WorkspaceStaff) => Promise<ComplianceCaseResult> =
  async () => ({ error: complianceWorkUnavailable });

export async function workOnBorrowerQuestionSets(input: unknown, staff: WorkspaceStaff | null) {
  return borrowerQuestionSetWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null), demoBrokerageId);
}

export async function workOnLoanStageEdits(input: unknown, staff: WorkspaceStaff | null) {
  return loanStageEditWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null), demoBrokerageId);
}

export async function workOnClosingGates(input: unknown, staff: WorkspaceStaff | null) {
  return closingGateWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null), demoBrokerageId);
}

export async function updateSalesSettings(input: unknown, staff: WorkspaceStaff | null) {
  return changeSalesSettings(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function loadConversations(input: unknown, staff: WorkspaceStaff | null) {
  return readConversations(database(), input, staff ?? localAdmin, demoBrokerageId, new Date(), staff ? undefined : localAdmin.name);
}

export async function updateConversation(input: unknown, staff: WorkspaceStaff | null) {
  return changeConversation(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function loadInboundReplies(input: unknown, staff: WorkspaceStaff | null) {
  return readInboundReplies(database(), input, staff ?? localPilotAdmin, demoBrokerageId);
}

export async function updateInboundReply(input: unknown, staff: WorkspaceStaff | null) {
  return changeInboundReply(database(), input, staff ?? localPilotAdmin, demoBrokerageId);
}

export async function updateFundingRecord(input: unknown, staff: WorkspaceStaff | null) {
  return fundingRecordAction(database(), input, staff ?? localAdmin, demoBrokerageId);
}

export async function loadPipelineExport(staff: WorkspaceStaff) {
  return exportPilotPipeline(database(), staff);
}

export async function loadMigrationRecovery(staff: WorkspaceStaff, importId: unknown) {
  return reviewMigrationRecovery(database(), staff, importId);
}

export async function loadMigrationRecord(staff: WorkspaceStaff, input: unknown) {
  const db = database();
  return db.transaction(() => readMigrationRecord(db, input, staff));
}

export async function loadMigrationCutover(staff: WorkspaceStaff, origin: unknown) {
  return readMigrationCutover(database(), staff, demoBrokerageId, origin, new Set([...localCampaignOfficers.map(({ email }) => email), staff.email]));
}

export async function loadCutoverHandoff(staff: WorkspaceStaff, query: unknown) {
  return exportCutoverHandoff(database(), staff, demoBrokerageId, query, new Set([...localCampaignOfficers.map(({ email }) => email), staff.email]));
}

export async function loadCutoverFileLookup(staff: WorkspaceStaff, query: unknown) {
  return lookupCutoverFile(database(), staff, demoBrokerageId, query);
}

export async function loadCutoverApplicationComparison(staff: WorkspaceStaff, query: unknown) {
  return readCutoverApplicationComparison(database(), staff, demoBrokerageId, query);
}

export async function loadCutoverFileInventory(staff: WorkspaceStaff, query: unknown) {
  return readCutoverFileInventory(database(), staff, demoBrokerageId, query);
}

export async function updateCutoverFileInventory(staff: WorkspaceStaff, input: unknown) {
  return saveCutoverFileInventory(database(), staff, demoBrokerageId, input);
}

export async function updateMigrationCutover(staff: WorkspaceStaff, input: unknown) {
  return saveMigrationCutover(database(), staff, demoBrokerageId, input, undefined, new Set([...localCampaignOfficers.map(({ email }) => email), staff.email]));
}

export async function updateBorrowerApplication(input: unknown) {
  return borrowerCommandResult(database(), input);
}

export function reserveBorrowerAddressLookup(token: string) {
  return reserveAddressLookup(database(), token);
}

export async function updateCoBorrowerApplication(input: unknown) {
  return coBorrowerCommandResult(database(), input);
}

export async function loadRealtorReferrals(input: unknown) {
  return realtorReferrals(database(), input);
}

export async function loadSharedPreapproval(input: unknown) {
  const parsed = sharedPreapprovalRequest.safeParse(input);
  if (!parsed.success || portalBrokerage(parsed.data.token) !== demoBrokerageId) return { status: 404, error: sharedPreapprovalUnavailable };
  return sharedPreapprovalDownload(database(), parsed.data);
}

export async function submitQuoteRequest(input: unknown) {
  return receiveQuoteLead(database(), input, undefined, [...localCampaignOfficers]);
}

export async function loadQuoteIntakeSettings(input: unknown, staff: WorkspaceStaff | null) {
  const actor = staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null);
  return workOnQuoteSettings(database(), input, actor, demoBrokerageId, undefined, [...localCampaignOfficers]);
}

export async function workOnDocumentTemplates(input: unknown, staff: WorkspaceStaff | null) {
  const actor = staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null);
  return documentTemplateWork(database(), input, actor, demoBrokerageId);
}

export async function workOnFeeTemplates(input: unknown, staff: WorkspaceStaff | null) {
  const actor = staff ?? (process.env.NODE_ENV === "development" ? localAdmin : null);
  return feeTemplateWork(database(), input, actor, demoBrokerageId);
}

export async function workOnLenderPackages(input: unknown, staff: WorkspaceStaff | null) {
  return lenderShareWork(database(), input, staff ?? (process.env.NODE_ENV === "development" ? localPilotAdmin : null), demoBrokerageId);
}

export async function loadSharedLenderPackage(input: SharedLenderPackageInput) {
  return lenderPackageAccess(database(), input);
}

import { auditRetentionExport, retentionExportLoanId, retentionExportPath, retentionExportResponse, reviewRetentionExport } from "./lib/loan-retention-export";
import { loanRetentionUnavailable, loanRetentionWork } from "./lib/loan-retention";
import { applyDirectoryRecoveryHold, directoryRecoveryHoldHttp, directoryRecoveryHoldPath, directoryRecoveryHoldRecorded, previewDirectoryRecoveryHold, readDirectoryRecoveryHoldIntent, type RecoveryHoldIntent, type RecoveryHoldResult } from "./lib/directory-recovery-hold";
import { commitDirectorySignInReset, directorySignInResetHttp, directorySignInResetPath, previewDirectorySignInReset, readDirectorySignInResetIntent, type SignInResetIntent } from "./lib/directory-sign-in-reset";
import { applyDirectoryRepair, directoryRepairHttp, directoryRepairPath, loadRepairEvidence, previewDirectoryRepair, readRepairIntent, type RepairIntent } from "./lib/directory-repair";
import { captureDirectoryRecoverySnapshot, directoryEvidenceHttp, directoryEvidencePath, type Evidence } from "./lib/directory-evidence";
import { directoryDrainObject, directoryDrainPath, directoryDrainStatus, startDirectoryWork, trackDirectoryResponse, type DirectoryWorkKind } from "./lib/directory-drain";
import { directoryPauseKey, directoryPauseResponse, directoryPauseRetrySeconds, directoryTrafficPaused } from "./lib/directory-traffic-pause";
import {restorePreviewInput,restoreStartInput} from "./lib/workspace-restore-model";
import {restoreSourceMatches,restoreStateHash,restoreAccess,restoreCheckpoint,previewRestore,priorRestore,reserveRestore,readRestoreJob,authorizedRestore,recordRestoreOutcome,processorRestoreBlockers} from "./lib/workspace-restore";
import {captureCheckpointFiles,verifyCheckpointFiles} from "./lib/recovery-checkpoint-files";
import {checkpointCreate,checkpointCompare} from "./lib/recovery-checkpoint-model";
import {captureCheckpointManifest} from "./lib/recovery-checkpoint-manifest";
import {initializeRecoveryCheckpoints,checkpointAccess,checkpointList,priorCheckpoint,saveCheckpoint,compareCheckpoint} from "./lib/recovery-checkpoints";
import { initializeUwmRouting, registerUwmRoute, findUwmWebhookRoute, deliverUwmWebhook, uwmWebhookRouteKey,
  type UwmWebhookRoute, type UwmWebhookRouteKey } from "./lib/uwm-routing";
import {applyRecoveryReplay,recoveryReplay,reserveRecoveryReplay,finishRecoveryReplay,type ReplayReservation} from "./lib/recovery-replay";
import {recoveryReplayInput} from "./lib/recovery-edit-model";
import {readRecoveryEdit} from "./lib/recovery-edits";
import {pendingRecoveryReplay,pendingWorkspaceRestore} from "./lib/workspace-maintenance";
import {initializeRecoveryEdits,recoveryIntentForCommand,beginRecoveryEdit,finishRecoveryEdit,readRecoveryProof,recoveryEditRows,inspectRecoveryEdit} from "./lib/recovery-edits";
import {recoveryEditPage,recoveryEditReview,type RecoveryEdit,type RecoveryEditInspection} from "./lib/recovery-edit-model";
import { inspectMaintenanceStore } from "./lib/maintenance-inspection";
import { maintenanceInspectionInput, maintenanceDecisionInput } from "./lib/maintenance-inspection-model";
import { initializeMaintenance, maintenanceAdmin, maintenanceState, maintenanceView, changeMaintenance, markMaintenanceDrained, maintenanceDecisions, priorMaintenanceDecision, recordMaintenanceDecision, recordRecoveryEditReview } from "./lib/workspace-maintenance";
import { maintenanceMessage, maintenanceInput, type MaintenanceView } from "./lib/workspace-maintenance-model";
import { WorkspaceMaintenanceGate, guardWorkspaceMethods } from "./lib/workspace-maintenance-gate";
import { workspaceMaintenancePage } from "./lib/staff-auth";

const maintenanceGates = new WeakMap<object, WorkspaceMaintenanceGate>();
import { initializeUwmWorkflows, reconcileUwmImportReceipt, runUwmWorkflow, readUwmFile, uwmImportCallbackAllowed, uwmLoanRouteVerified } from "./lib/uwm-workflows";
import { UwmError } from "./lib/uwm-live";
import { connectUwmUser, disconnectUwmUser, initializeUwmUserAccess, uwmUserStatus } from "./lib/uwm-user-access";
import { initializeUwmOperations } from "./lib/uwm-operations";
import { uwmPublicClient } from "./lib/uwm-public-client";
import { initializeUwmWebhooks, parseUwmWebhook, readUwmWebhookReceipts, saveUwmWebhook, uwmWebhookConnection, uwmWebhookHttp, type UwmWebhookEvent } from "./lib/uwm-webhooks";
import { DurableObject } from "cloudflare:workers";
import { demoRequest } from "./lib/demo-request";
import { createHash, timingSafeEqual } from "node:crypto";
import app from "vinext/server/app-router-entry";
import { assignContactFollowUpInput, campaignRefillTarget, executeCommand, reviewApplicationInput, staffCampaignOptOutTarget } from "./lib/commands";
import { readPlaybook } from "./lib/playbooks";
import { borrowerCommandResult, coBorrowerCommandResult } from "./lib/applications";
import { jointLinkUnavailable } from "./lib/joint-application-model";
import { borrowerHttp, borrowerJson, documentUploadMode } from "./lib/borrower-http";
import { initializeStore, readStaffWorkspaceEntry, readWorkspace, type SqlValue, type Store } from "./lib/store";
import { readPipeline } from "./lib/pipeline";
import { pipelineUnavailable } from "./lib/pipeline-model";
import { readLoanContactPicker } from "./lib/loan-contact-picker";
import { readContactDirectory } from "./lib/contact-directory";
import { readDraftQueue } from "./lib/communication-draft-query";
import { draftQueueUnavailable } from "./lib/communication-draft-model";
import { readPastClientQueue } from "./lib/past-client-queue";
import { pastClientsUnavailable } from "./lib/past-client-queue-model";
import { readRealtorWork } from "./lib/realtor-work";
import { realtorWorkUnavailable } from "./lib/realtor-work-model";
import { readLeadInbox } from "./lib/lead-inbox-query";
import { leadInboxUnavailable } from "./lib/lead-inbox-model";
import { contactsUnavailable } from "./lib/contact-directory-model";
import { loanContactPickerUnavailable } from "./lib/loan-contact-picker-model";
import { closedReleaseWorkspacePage, googleSettings, handleStaffAuth, rememberedStaffWorkspace, runtimeSetting, staffLoginUrl, staffSessionHash, staffWorkspaceCookie, workspaceAccessDenied, type StaffEmailAuth } from "./lib/staff-auth";
import { staffAuthStore, type StaffAuthStore, type StaffIdentity, type WorkspaceStaff } from "./lib/staff-store";
import { defaultWorkspace, brokerageIdPattern, brokerageUrl, demoBrokerageId, portalBrokerage, staffSignInRequired, releaseWorkspaceClosed, workspaceCanBeDefault, workspaceFeatures, workspaceGuide, type BrokerageMember, type VersionedBrokerageMember } from "./lib/brokerage-model";
import { activateBrokerages, activeBrokerages, bootstrapDemoMembers, brokerageHistory, brokerageMembers, changeBrokerage, consumeStaffEmailCode, departureRoster, history as recordBrokerageHistory, initializeBrokerages, pilotSeatCapacity, readStaffAccess, rememberWorkspace, reserveStaffEmailCode, selectedActiveMembers } from "./lib/brokerages";
import { readPilotSupport, readPilotSupportWork, readSupportRecovery } from "./lib/pilot-support";
import { pilotSupportAccess } from "./lib/pilot-support-access";
import { pilotSupportAccessInput, type PilotSupportAccessInput, type PilotSupportAccessResult } from "./lib/pilot-support-access-model";
import { supportChanged, supportUnavailable, supportWorkChanged, supportWorkGroup, supportWorkOffset, supportWorkPaused,
  type SupportRecoveryState, type SupportWorkGroup } from "./lib/pilot-support-model";
import { accessEvent, assignLoan, scopeWorkspace, workspaceAccessHistory } from "./lib/workspace-access";
import { placesHttp, reserveAddressLookup } from "./lib/places";
import { realtorHttp, realtorReferrals } from "./lib/realtor-portal";
import { beginDocumentUpload, documentCleanupBatch, downloadableDocument, failDocumentUpload, finishDocumentUpload,
  issueDocumentCode, nextDocumentCleanup, recordDocumentDownload, verifyDocumentCode, type UploadAccess } from "./lib/document-files";
import { fileProblem, leadDocumentPortalHttp, privatePdf, uploadBorrowerPdf, uploadSettings, verifyBorrowerEmail, type DocumentEnvironment } from "./lib/document-file-http";
import { documentKey, type DocumentUploadMode } from "./lib/document-files-model";
import { z } from "zod";
import { loadProtectedPilotScenario, pilotFeedbackInput, pilotReview, pilotScenarioInput, pilotTriageInput, readPilotSupportRequests, recordPilotMeasurement, savePilotFeedback, triagePilotFeedback, type PilotPortalLink } from "./lib/pilot";
import { explorationInput, loadExplorationExamples } from "./lib/pilot-exploration";
import { loanScenarioWork } from "./lib/loan-scenarios";
import { incomeWorksheetWork } from "./lib/income-review";
import { workOnPreapprovalLetters } from "./lib/preapproval-letters";
import { readClosingPacket } from "./lib/closing-packets";
import { sharedPreapprovalDownload } from "./lib/preapproval-sharing";
import { sharedPreapprovalUnavailable } from "./lib/preapproval-model";
import { borrowerRealtorFinancing, workOnRealtorFinancing } from "./lib/realtor-financing";
import { realtorFinancingUnavailable } from "./lib/realtor-financing-model";
import { confirmLenderPackagePdf, lenderPackageAccess, lenderShareWork } from "./lib/lender-handoff-share";
import { sharedLenderPackageHttp } from "./lib/lender-handoff-share-http";
import type { PackageDownloadInput, SharedLenderPackageInput } from "./lib/lender-handoff-share-model";
import { beginLeadSample, convertedLeadLinkHashes, downloadableLeadDocument, failLeadSample, finishLeadSample,
  leadDocumentWork, readLeadDocumentPortal, recordLeadDocumentDownload } from "./lib/lead-documents";
import type { LeadSampleUpload } from "./lib/lead-document-model";
import { migrationInput } from "./lib/pipeline-migration-model";
import { addCampaignLeadInput, assignCampaignLeadsInput, campaignRoutingOfficerLimit, loadCampaignRehearsalInput, routeCampaignQueueInput, saveCampaignRoutingInput } from "./lib/call-campaign-model";
import { campaignOptOutPlans, campaignReleaseRouting, type CampaignOptOutRoster, type CampaignRefillRoster } from "./lib/campaign-routing";
import { enrollCrmSegmentInput } from "./lib/crm-segment-model";
import { assignInboxLeadInput, saveLeadRoutingInput } from "./lib/lead-inbox-model";
import { leadRouting, readLeadArchive } from "./lib/lead-inbox";
import { quoteIntakeSettingsRequest, quoteLeadInput } from "./lib/quote-intake-model";
import { quoteConfiguredOwners, quoteIntakeRouting, quoteRoutingForForm, receiveQuoteLead, workOnQuoteSettings } from "./lib/quote-intake";
import { branchesUnavailable } from "./lib/branch-model";
import { canManageBranches, readBranches, updateBranch } from "./lib/branches";
import { readStaffFirstDay, setFirstDayStep, updateStaffFirstDay } from "./lib/staff-first-day";
import { automationEventWork } from "./lib/automation-events";
import { readDeliveryExceptions } from "./lib/automation-exceptions";
import { deliveryExceptionQuery } from "./lib/automation-exception-model";
import { automationBatchWork } from "./lib/automation-batches";
import { partnerAccessWork, sandboxEventAuthority, serveSandboxEvents, type SandboxEventResult } from "./lib/partner-access";
import { sandboxEventsHttp } from "./lib/sandbox-events-http";
import { partnerAccessQuery } from "./lib/partner-access-model";
import { automationBatchQuery } from "./lib/automation-batch-model";
import { automationDestinationWork } from "./lib/automation-destinations";
import { automationDestinationQuery, automationEventQuery } from "./lib/automation-event-model";
import { documentTemplateWork } from "./lib/document-templates";
import { feeTemplateWork } from "./lib/fee-templates";
import { saveRealtorClaimPolicyInput } from "./lib/realtor-claim-model";
import { readSharedRealtorQueue } from "./lib/realtor-claim-queue";
import { assignWaitingRealtor, readRealtorQueueReport } from "./lib/realtor-queue-report";
import { assignWaitingRealtorInput, realtorQueueReportUnavailable } from "./lib/realtor-queue-report-model";
import { assignProcessor, readProcessorAssignmentReceipt } from "./lib/loan-processing";
import { loanAssignmentUnavailable, readLoanAssignments } from "./lib/loan-assignments";
import { savePlaybookInput } from "./lib/playbook-model";
import { readRecordHistory } from "./lib/record-history";
import { readUwmDelivery } from "./lib/uwm-delivery";
import { exportPilotPipeline } from "./lib/pipeline-export";
import { reviewMigrationRecovery } from "./lib/migration-recovery";
import { exportCutoverHandoff, exportCutoverInventory, lookupCutoverFile, readCutoverApplicationComparison, readCutoverFileInventory, readMigrationCutover,
  saveCutoverFileInventory, saveMigrationCutover } from "./lib/migration-cutover";
import type { CutoverApplicationComparison } from "./lib/cutover-application-model";
import { cutoverCallbackItem, cutoverReviewInput, cutoverUnavailable, type CutoverFileInventory, type CutoverFileLookup, type CutoverHandoff,
  type MigrationCutover } from "./lib/migration-cutover-model";
import { fundingRecordAction, readFundingDashboard } from "./lib/funding-dashboard";
import { readCampaignCallbacks, readOfficerQueue, readWorkspaceCalendar, readWorkspaceTasks } from "./lib/officer-queue";
import { readActionCounts } from "./lib/workspace-action-counts";
import type { WorkspaceMutationScope } from "./lib/commands";
import { readCampaignCallbackPerformance } from "./lib/campaign-callback-performance";
import { readCampaignManager } from "./lib/campaign-manager";
import { readCampaignSequencePerformance } from "./lib/campaign-sequence-performance";
import { readCampaignCallbackExceptions } from "./lib/campaign-callback-exceptions";
import { officerDashboardWork } from "./lib/officer-dashboard";
import { workOnAppointment } from "./lib/appointments";
import { changeProcessingView, readProcessorQueue } from "./lib/processor-queue";
import { readEditableLoan, readLoanHandoff } from "./lib/editable-loan";
import { readIncomingLoanWorkPage } from "./lib/incoming-loan-work";
import { recordManualReturnFollowUp } from "./lib/manual-lender-work";
import { readEditableLead } from "./lib/editable-lead";
import { changeSalesSettings, readSalesDashboard } from "./lib/sales-dashboard";
import { changeOwnerScorecardSettings, readOwnerScorecard } from "./lib/owner-scorecard";
import { customReportWork } from "./lib/custom-reports";
import { reportScheduleWork } from "./lib/report-schedules";
import { reportScheduleQuery } from "./lib/report-schedule-model";
import { crmFieldWork } from "./lib/crm-fields";
import { disclosureCalendarWork } from "./lib/disclosure-calendar";
import { disclosureTemplateWork } from "./lib/disclosure-templates";
import { complianceCaseWork } from "./lib/compliance-cases";
import { complianceWorkUnavailable } from "./lib/compliance-case-model";
import { borrowerQuestionSetWork } from "./lib/borrower-question-sets";
import { loanStageEditWork } from "./lib/loan-stage-edits";
import { closingGateWork, currentClosingGatePolicy } from "./lib/closing-gates";
import { closingGateInput } from "./lib/closing-gate-model";
import { changeConversation, readConversations } from "./lib/conversations";
import { contactMergeWork } from "./lib/contact-merge";
import { conversationInput } from "./lib/conversation-model";
import { changeInboundReply, readInboundReplies } from "./lib/inbound-replies";
import { coverageParticipants, coverageWork, coveredCampaignRouting } from "./lib/coverage";
import { coverageInput, coverageUnavailable, type CoverageResult } from "./lib/coverage-model";
import { readWorkspaceSearch } from "./lib/workspace-search";
import { loanReviewWork, reviewParticipants, routeChangedClosingReview } from "./lib/loan-reviews";
import { playbookRunWork } from "./lib/playbook-runs";
import { nextDocumentReminderCheck, runScheduledDocumentReminders } from "./lib/document-reminder-runs";
import { brokerageFinanceWork } from "./lib/brokerage-finance";
import { closingReviewEmails, fileExceptionOwners, nameFileExceptions, readFileExceptions, type ClosingReviewerAccess } from "./lib/file-exceptions";
import { managerExceptionInput, managerExceptionsUnavailable, type ManagerExceptionResult } from "./lib/manager-exception-model";
import { readManagerExceptionWork } from "./lib/manager-exceptions";
import { readMigrationRecord } from "./lib/migration-record";
import { migrationRecordUnavailable } from "./lib/migration-record-model";
import { closingPackageException, fileExceptionQuery, fileExceptionsUnavailable, type FileExceptionPage } from "./lib/file-exception-model";
import { reportingReadinessWork } from "./lib/call-report-readiness";
import { reviewInput, reviewsUnavailable, type ReviewResult } from "./lib/loan-review-model";
import { departureWork, hasDepartureWork } from "./lib/offboarding";
import { offboardingInput, offboardingUnavailable, type DeparturePage, type DepartureRoster, type OffboardingInput } from "./lib/offboarding-model";

export class OrbitWorkspace extends DurableObject<Cloudflare.Env> implements StaffAuthStore {
  readonly #store: Store;
  readonly #auth: StaffAuthStore;
  readonly #id: string;
  readonly #documents?: R2Bucket;
  #initialized = false;
  #checkpointReading = false;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    const storage = ctx.storage;
    const sql = storage.sql;
    this.#store = {
      exec: (query) => { sql.exec(query).toArray(); },
      prepare(query) {
        return {
          get: (...args) => sql.exec<Record<string, SqlValue>>(query, ...args).toArray()[0],
          all: (...args) => sql.exec<Record<string, SqlValue>>(query, ...args).toArray(),
          run: (...args) => { sql.exec(query, ...args).toArray(); },
        };
      },
      transaction: (run) => storage.transactionSync(run),
    };
    if (!ctx.id.name || (ctx.id.name !== directoryDrainObject && !brokerageIdPattern.test(ctx.id.name))) throw new Error("Invalid Orbit workspace name.");
    this.#id = ctx.id.name;
    this.#documents = (env as Cloudflare.Env & DocumentEnvironment).DOCUMENTS;
    this.#auth = staffAuthStore(this.#store);
    if (this.#id === directoryDrainObject) {
      sql.exec("CREATE TABLE IF NOT EXISTS directory_work_tickets (id TEXT PRIMARY KEY, kind TEXT NOT NULL, startedAt INTEGER NOT NULL)");
      return;
    }
    if (this.#id === demoBrokerageId) this.#initializeWorkspace();
    else {
      maintenanceGates.set(this,new WorkspaceMaintenanceGate());
      ctx.blockConcurrencyWhile(async () => {
        const state = await env.WORKSPACE.getByName(demoBrokerageId).maintenanceStateFor(this.#id);
        if (state.mode === "Open") this.#initializeWorkspace();
        maintenanceGates.get(this)!.apply(state.revision,state.mode !== "Open");
      });
    }
  }

  async beginDirectoryWork(id: string, kind: DirectoryWorkKind) {
    if (this.#id !== directoryDrainObject) throw new Error("Directory drain coordinator unavailable.");
    if (!/^[a-f0-9-]{36}$/.test(id) || (kind !== "http" && kind !== "alarm")) return false;
    // Record the ticket first. A request racing a pause either appears in the
    // count or sees the marker before it can enter the protected handler.
    this.#store.prepare("INSERT INTO directory_work_tickets VALUES (?,?,?)").run(id, kind, Date.now());
    if (!await directoryTrafficPaused(this.#documents)) return true;
    this.endDirectoryWork(id);
    return false;
  }

  endDirectoryWork(id: string) {
    if (this.#id !== directoryDrainObject) throw new Error("Directory drain coordinator unavailable.");
    this.#store.prepare("DELETE FROM directory_work_tickets WHERE id=?").run(id);
  }

  directoryWorkCounts() {
    if (this.#id !== directoryDrainObject) throw new Error("Directory drain coordinator unavailable.");
    const row = this.#store.prepare(`SELECT COUNT(*) AS active, SUM(kind='http') AS http,
      SUM(kind='alarm') AS alarms, MIN(startedAt) AS oldestAt FROM directory_work_tickets`).get();
    return { active: Number(row?.active ?? 0), http: Number(row?.http ?? 0),
      alarms: Number(row?.alarms ?? 0), oldestAt: row?.oldestAt == null ? null : Number(row.oldestAt) };
  }

  async inspectDirectoryEvidence() {
    if (this.#id !== demoBrokerageId || !await directoryTrafficPaused(this.#documents)) {
      throw new Error("Directory evidence requires an active pause.");
    }
    return captureDirectoryRecoverySnapshot(this.#store);
  }

  async reviewDirectoryRepair(evidence: Evidence) {
    if (this.#id !== demoBrokerageId || !await this.#documents?.head(directoryPauseKey)) {
      throw new Error("Directory repair requires an active pause.");
    }
    return previewDirectoryRepair(this.#store, evidence, new Date().toISOString());
  }

  async commitDirectoryRepair(input: RepairIntent) {
    if (this.#id !== demoBrokerageId || !this.#documents) throw new Error("Directory repair is unavailable.");
    const intent = await readRepairIntent(this.#documents, input);
    const deployment = runtimeSetting(this.env, "ORBIT_DEPLOYMENT") || "fixture";
    if (!intent || intent.deployment !== deployment) return null;
    const evidence = await loadRepairEvidence(this.#documents, intent.evidenceId, deployment);
    if (!evidence) return null;
    const counts = await this.env.WORKSPACE.getByName(directoryDrainObject).directoryWorkCounts();
    if (counts.active || (await this.#documents.head(directoryPauseKey))?.version !== intent.markerVersion) return null;
    return applyDirectoryRepair(this.#store, evidence, intent, new Date().toISOString());
  }

  async reviewDirectoryRecoveryHold(evidence: Evidence, brokerageId: string) {
    if (this.#id !== demoBrokerageId || !await this.#documents?.head(directoryPauseKey))
      throw new Error("Directory recovery hold requires an active pause.");
    return previewDirectoryRecoveryHold(this.#store, evidence, brokerageId);
  }

  async commitDirectoryRecoveryHold(input: RecoveryHoldIntent, prior: RecoveryHoldResult | null) {
    const bucket = this.#documents;
    if (this.#id !== demoBrokerageId || !bucket) return null;
    const intent = await readDirectoryRecoveryHoldIntent(bucket, input);
    const deployment = runtimeSetting(this.env, "ORBIT_DEPLOYMENT") || "fixture";
    if (!intent || intent.deployment !== deployment) return null;
    const evidence = await loadRepairEvidence(bucket, intent.evidenceId, deployment);
    if (!evidence) return null;
    const stable = async () => !(await this.env.WORKSPACE.getByName(directoryDrainObject).directoryWorkCounts()).active &&
      (await bucket.head(directoryPauseKey))?.version === intent.markerVersion;
    if (!await stable()) return null;
    if (prior && !directoryRecoveryHoldRecorded(this.#store, intent, prior)) return null;
    if (!prior && this.#store.prepare("SELECT pilot FROM brokerages WHERE id=?").get(intent.brokerageId)?.pilot !== 1) return null;
    const workspace = this.env.WORKSPACE.getByName(intent.brokerageId);
    const fence = await workspace.maintenanceFence();
    if (fence.active || !await stable()) return null;
    const result = prior ?? applyDirectoryRecoveryHold(this.#store, evidence, intent, fence.revision, new Date().toISOString());
    if (!result) return null;
    const verified = await workspace.maintenanceFence();
    if (!verified.closed || verified.active || verified.revision < result.revision ||
        !directoryRecoveryHoldRecorded(this.#store, intent, result)) return null;
    return result;
  }

  async reviewDirectorySignInReset() {
    if (this.#id !== demoBrokerageId || !await this.#documents?.head(directoryPauseKey))
      throw new Error("Directory sign-in reset requires an active pause.");
    return previewDirectorySignInReset(this.#store);
  }

  async applyDirectorySignInReset(input: SignInResetIntent) {
    if (this.#id !== demoBrokerageId || !this.#documents) throw new Error("Directory sign-in reset is unavailable.");
    const intent = await readDirectorySignInResetIntent(this.#documents, input);
    if (!intent || intent.deployment !== (runtimeSetting(this.env, "ORBIT_DEPLOYMENT") || "fixture")) return null;
    const counts = await this.env.WORKSPACE.getByName(directoryDrainObject).directoryWorkCounts();
    if (counts.active || (await this.#documents.head(directoryPauseKey))?.version !== intent.markerVersion) return null;
    return commitDirectorySignInReset(this.#store, intent);
  }

  #initializeWorkspace() {
    if (this.#initialized) return;
    initializeStore(this.#store, this.#id === demoBrokerageId);
    initializeUwmUserAccess(this.#store);
    initializeUwmOperations(this.#store);
    initializeUwmWorkflows(this.#store);
    initializeUwmWebhooks(this.#store);
    if (this.#id === demoBrokerageId) {
      initializeBrokerages(this.#store);
      initializeMaintenance(this.#store); initializeRecoveryCheckpoints(this.#store);
      initializeUwmRouting(this.#store);
    }
    initializeRecoveryEdits(this.#store,this.#id===demoBrokerageId);
    this.#initialized = true;
  }

  maintenanceStateFor(id: string) {
    if (this.#id !== demoBrokerageId || !brokerageIdPattern.test(id)) throw new Error("Maintenance status unavailable.");
    return maintenanceState(this.#store,id);
  }
  async maintenanceFence() {
    if (this.#id === demoBrokerageId) throw new Error("Shared directory cannot enter maintenance.");
    const state = await this.env.WORKSPACE.getByName(demoBrokerageId).maintenanceStateFor(this.#id);
    const gate = maintenanceGates.get(this)!;
    if (state.mode === "Open" && state.revision >= gate.revision) this.#initializeWorkspace();
    const reopening=gate.closed && state.mode === "Open" && state.revision >= gate.revision;
    gate.apply(state.revision,state.mode !== "Open");
    if (reopening) await this.#scheduleCleanup();
    return {active:gate.active,closed:gate.closed,revision:gate.revision};
  }
  mayPrepareMaintenanceReopen(staff: WorkspaceStaff, revision: number) {
    if (this.#id !== demoBrokerageId) return false;
    const emails=[...(googleSettings(this.env)?.allowedEmails??[])];
    const state=maintenanceState(this.#store,staff.brokerage.id);
    return maintenanceAdmin(this.#store,staff,emails) && state.mode==="Paused" && state.revision===revision &&
      !!state.reviewedAt && state.checks.every(Boolean) && !pendingRecoveryReplay(this.#store,staff.brokerage.id) && !pendingWorkspaceRestore(this.#store,staff.brokerage.id);
  }
  async prepareMaintenanceReopen(staff: WorkspaceStaff, revision: number) {
    if (staff.brokerage.id !== this.#id || this.#id === demoBrokerageId ||
      !await this.env.WORKSPACE.getByName(demoBrokerageId).mayPrepareMaintenanceReopen(staff,revision)) throw new Error("Reopening review unavailable.");
    const gate=maintenanceGates.get(this)!;
    if (!gate.closed || gate.active) throw new Error("Wait for active workspace requests to finish.");
    if(this.#checkpointReading)throw new Error("Checkpoint inspection is running. Wait for it to finish before reopening.");
    this.#initializeWorkspace();
  }
  mayInspectMaintenance(staff: WorkspaceStaff, revision: number) {
    if(this.#id !== demoBrokerageId)return false;
    const state=maintenanceState(this.#store,staff.brokerage.id);
    return maintenanceAdmin(this.#store,staff,[...(googleSettings(this.env)?.allowedEmails??[])]) &&
      state.mode === "Paused" && state.revision === revision;
  }
  pilotSupportRecovery(staff: WorkspaceStaff, audit?: { reference: string; recovery: SupportRecoveryState }) {
    if (this.#id !== demoBrokerageId ||
      !maintenanceAdmin(this.#store, staff, [...(googleSettings(this.env)?.allowedEmails ?? [])])) return null;
    const id = staff.brokerage.id;
    const recovery = readSupportRecovery(this.#store, id);
    if (audit) {
      if (!z.uuid().safeParse(audit.reference).success) return null;
      if (JSON.stringify(recovery) === JSON.stringify(audit.recovery)) {
        recordBrokerageHistory(this.#store, id, staff.email, "Generated redacted support report", audit.reference, new Date().toISOString());
      }
    }
    return recovery;
  }

  async pilotSupportSnapshot(staff: WorkspaceStaff) {
    if (!this.#accepts(staff) || this.#id === demoBrokerageId || staff.brokerage.role !== "Admin" || !staff.brokerage.pilot) return null;
    const directory = this.env.WORKSPACE.getByName(demoBrokerageId);
    const recovery = await directory.pilotSupportRecovery(staff);
    return recovery ? readPilotSupport(this.#store, recovery) : null;
  }

  async pilotSupportWork(staff: WorkspaceStaff, group: SupportWorkGroup, offset: number, fingerprint: string) {
    if (!this.#accepts(staff) || this.#id === demoBrokerageId || staff.brokerage.role !== "Admin" || !staff.brokerage.pilot) return null;
    const recovery = await this.env.WORKSPACE.getByName(demoBrokerageId).pilotSupportRecovery(staff);
    if (!recovery) return null;
    if (recovery.mode !== "Open") return { error: supportWorkPaused };
    const snapshot = readPilotSupport(this.#store, recovery);
    if (createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") !== fingerprint) return { error: supportWorkChanged };
    return readPilotSupportWork(this.#store, group, offset);
  }
  mayCaptureCheckpoint(staff:WorkspaceStaff,revision:number) {
    if(this.#id!==demoBrokerageId)return false;
    try{checkpointAccess(this.#store,staff,[...(googleSettings(this.env)?.allowedEmails??[])],revision);return true;}catch{return false;}
  }
  async captureWorkspaceCheckpoint(staff:WorkspaceStaff,revision:number,bookmark:boolean) {
    if(this.#id===demoBrokerageId || staff.brokerage.id!==this.#id)throw new Error("Checkpoint workspace mismatch.");
    const directory=this.env.WORKSPACE.getByName(demoBrokerageId),gate=maintenanceGates.get(this)!;
    if(!await directory.mayCaptureCheckpoint(staff,revision)||!gate.closed||gate.active)throw new Error("Wait for paused workspace activity to finish.");
    if(this.#checkpointReading)throw new Error("Another checkpoint inspection is running. Try again after it finishes.");
    this.#checkpointReading=true;
    try {
    const captured=await this.#capturePausedCheckpoint(bookmark);
    if(!await directory.mayCaptureCheckpoint(staff,revision)||!gate.closed||gate.active)throw new Error("Workspace changed during capture. Refresh its status.");
    return captured;
    }finally{this.#checkpointReading=false;}
  }
  async #capturePausedCheckpoint(bookmark:boolean) {
    const kv=await this.ctx.storage.list({limit:101}),alarm=await this.ctx.storage.getAlarm();
    const manifest=captureCheckpointManifest((query,...values)=>this.ctx.storage.sql.exec(query,...values).toArray(),kv,alarm);
    if(bookmark)manifest.files=await captureCheckpointFiles(this.#store,async id=>{
      if(!this.#documents)throw new Error("Document storage is unavailable.");
      return this.#documents.get(documentKey(this.#id,id));
    });
    manifest.activeLoanHolds = Number(this.#store.prepare("SELECT count(*) AS n FROM loan_retention_holds WHERE releasedAt IS NULL").get()?.n ?? 0);
    const at=new Date().toISOString(),point=bookmark?await this.ctx.storage.getCurrentBookmark():"";
    if(await this.ctx.storage.getAlarm()!==alarm)throw new Error("Scheduled work changed during capture. Capture the checkpoint again.");
    return {manifest,bookmark:point,at};
  }
  authorizedWorkspaceRestore(staff:WorkspaceStaff,id:string) {
    if(this.#id!==demoBrokerageId)throw new Error("Recovery directory unavailable.");
    return authorizedRestore(this.#store,staff,[...(googleSettings(this.env)?.allowedEmails??[])],id);
  }
  saveWorkspaceRestoreOutcome(staff:WorkspaceStaff,id:string,outcome:"Armed"|"Restored"|"Needs review",message:string,undoBookmark?:string) {
    if(this.#id!==demoBrokerageId)throw new Error("Recovery directory unavailable.");
    return recordRestoreOutcome(this.#store,staff,[...(googleSettings(this.env)?.allowedEmails??[])],id,outcome,message,undoBookmark);
  }
  async applyWorkspaceRestore(staff:WorkspaceStaff,id:string) {
    const gate=maintenanceGates.get(this);
    if(this.#id!==staff.brokerage.id||!gate?.closed||gate.active||this.#checkpointReading)throw new Error("Wait for paused workspace inspection to finish.");
    this.#checkpointReading=true;
    try {
      const directory=this.env.WORKSPACE.getByName(demoBrokerageId),reservation=await directory.authorizedWorkspaceRestore(staff,id);
      if(reservation.job.state==="Restored")return reservation.job;
      if(reservation.job.state==="Needs review")throw new Error("The restore outcome requires operator investigation. The workspace remains paused.");
      const processorBlockers = processorRestoreBlockers(reservation.target.manifest, reservation.source.manifest);
      if (processorBlockers.length) {
        return await directory.saveWorkspaceRestoreOutcome(staff, id, "Needs review", processorBlockers.join(" "));
      }
      const current=await this.#capturePausedCheckpoint(true);
      const get=async (objectId:string)=>{
        if(!this.#documents)throw new Error("Document storage is unavailable.");
        return this.#documents.get(documentKey(this.#id,objectId));
      };
      await verifyCheckpointFiles(reservation.target.manifest.files,get);
      await directory.authorizedWorkspaceRestore(staff,id);
      if(restoreStateHash(current.manifest)===restoreStateHash(reservation.target.manifest))
        return await directory.saveWorkspaceRestoreOutcome(staff,id,"Restored","Workspace database and checkpoint document bytes verified. Complete a new reopening review.");
      if(!restoreSourceMatches(reservation.source.manifest,current.manifest))
        return await directory.saveWorkspaceRestoreOutcome(staff,id,"Needs review","Current storage matches neither the checkpoint nor the saved before-restore state. Keep the workspace paused for investigation.");
      const undo=await this.ctx.storage.onNextSessionRestoreBookmark(reservation.target.bookmark);
      // Always terminate this session after arming, even if the directory reply is lost.
      // The source checkpoint and pending job were durable before arming.
      try {await directory.saveWorkspaceRestoreOutcome(staff,id,"Armed","Restore armed. Check the outcome after the workspace restarts.",undo);}
      finally {this.ctx.abort("Workspace restore armed; awaiting verified outcome");}
    }finally{this.#checkpointReading=false;}
  }
  async workspaceRestore(staff:WorkspaceStaff,raw:unknown) {
    if(this.#id!==demoBrokerageId)throw new Error("Recovery directory unavailable.");
    const emails=[...(googleSettings(this.env)?.allowedEmails??[])];
    const state=restoreAccess(this.#store,staff,emails);
    const action=z.object({action:z.enum(["status","preview","start","resume"])}).parse(raw).action;
    if(action==="status"){
      const job=readRestoreJob(this.#store,staff.brokerage.id);
      return {job:job?.cycle===state.startedAt?job:null,view:maintenanceView(this.#store,staff.brokerage.id,0)};
    }
    if(action==="preview"||action==="start") {
      const input=restorePreviewInput.parse(raw);
      if(action==="start"){
        const prior=priorRestore(this.#store,staff,emails,raw);
        if(prior)return {job:prior,view:maintenanceView(this.#store,staff.brokerage.id,0)};
      }
      checkpointAccess(this.#store,staff,emails,input.revision);
      const current=await this.env.WORKSPACE.getByName(staff.brokerage.id).captureWorkspaceCheckpoint(staff,input.revision,true);
      const preview=previewRestore(this.#store,staff,emails,input.checkpointId,input.revision,current.manifest);
      try {
        await verifyCheckpointFiles(restoreCheckpoint(this.#store,staff.brokerage.id,input.checkpointId).manifest.files,async id=>{
          if(!this.#documents)throw new Error("Document storage is unavailable.");
          return this.#documents.get(documentKey(staff.brokerage.id,id));
        });
      }catch(error){preview.blockers.push(error instanceof Error?error.message:"Document evidence unavailable.");}
      checkpointAccess(this.#store,staff,emails,input.revision);
      if(action==="preview")return {preview};
      if(preview.blockers.length)throw new Error(preview.blockers.join(" "));
      const job=reserveRestore(this.#store,staff,emails,restoreStartInput.parse(raw),current);
      // First persist and return the reservation. The separate resume action can
      // lose its reply during abort without losing the source or job identity.
      return {job,view:maintenanceView(this.#store,staff.brokerage.id,0)};
    }
    const {id}=z.object({id:z.uuid()}).parse(raw);
    const job=await this.env.WORKSPACE.getByName(staff.brokerage.id).applyWorkspaceRestore(staff,id);
    return {job,view:maintenanceView(this.#store,staff.brokerage.id,0)};
  }
  async workspaceCheckpoints(staff:WorkspaceStaff,raw:unknown) {
    if(this.#id!==demoBrokerageId)throw new Error("Checkpoint directory unavailable.");
    const emails=[...(googleSettings(this.env)?.allowedEmails??[])];
    const action=z.object({action:z.enum(["list","create","compare"])}).parse(raw).action;
    if(action==="list"){
      const {revision}=z.object({revision:z.number().int().nonnegative()}).parse(raw);
      return {items:checkpointList(this.#store,staff,emails,revision)};
    }
    checkpointAccess(this.#store,staff,emails);
    if(action==="create"){
      const input=checkpointCreate.parse(raw),prior=priorCheckpoint(this.#store,staff,input);
      if(prior)return {checkpoint:prior,view:maintenanceView(this.#store,staff.brokerage.id,0)};
      checkpointAccess(this.#store,staff,emails,input.revision);
      const captured=await this.env.WORKSPACE.getByName(staff.brokerage.id).captureWorkspaceCheckpoint(staff,input.revision,true);
      const checkpoint=saveCheckpoint(this.#store,staff,emails,input,captured);
      return {checkpoint,view:maintenanceView(this.#store,staff.brokerage.id,0)};
    }
    const input=checkpointCompare.parse(raw);
    checkpointAccess(this.#store,staff,emails,input.revision);
    const current=await this.env.WORKSPACE.getByName(staff.brokerage.id).captureWorkspaceCheckpoint(staff,input.revision,false);
    return {comparison:compareCheckpoint(this.#store,staff,emails,input.id,input.revision,current.manifest,undefined,input.offset)};
  }
  async inspectWorkspaceMaintenance(staff: WorkspaceStaff, raw: unknown) {
    const parsed=maintenanceInspectionInput.safeParse(raw);
    if(!parsed.success || staff.brokerage.id !== this.#id || this.#id === demoBrokerageId) return {error:"Workspace inspection unavailable."};
    const directory=this.env.WORKSPACE.getByName(demoBrokerageId), input=parsed.data;
    if(!await directory.mayInspectMaintenance(staff,input.revision))return {error:"Pause this workspace and refresh its status before inspecting it."};
    const gate=maintenanceGates.get(this)!;
    if(!gate.closed || gate.active)return {error:"Wait for active workspace work to finish before inspecting it."};
    let report;
    try {
      report=await inspectMaintenanceStore(this.#store,input,async objectId=>{
        if(!this.#documents)throw new Error("Document storage unavailable.");
        return this.#documents.head(documentKey(this.#id,objectId));
      });
    } catch {
      return {error:"Inspection could not be completed. Refresh the maintenance status and inspect the first page again."};
    }
    // A review/reopen or access change during R2 reads invalidates the response.
    if(!gate.closed || gate.active || !await directory.mayInspectMaintenance(staff,input.revision))
      return {error:"Workspace status or access changed during inspection. Refresh before continuing."};
    const decisions=await directory.readMaintenanceDecisions(staff,input.revision,[...report.documents.items,...report.requests.items].map(item=>item.reference));
    if("error" in decisions)return decisions;
    if(!gate.closed || gate.active)return {error:"Workspace activity changed during inspection. Refresh its status."};
    for(const item of [...report.documents.items,...report.requests.items])item.decisions=decisions.items.filter(decision=>decision.reference===item.reference);
    return {inspection:report};
  }
  readMaintenanceDecisions(staff:WorkspaceStaff,revision:number,references:string[]) {
    if(!this.mayInspectMaintenance(staff,revision) || !z.array(z.string().max(200)).max(50).safeParse(references).success)
      return {error:"Inspection decisions are unavailable. Refresh the maintenance status."};
    return {items:maintenanceDecisions(this.#store,staff.brokerage.id,maintenanceState(this.#store,staff.brokerage.id).startedAt!,references)};
  }
  async saveMaintenanceDecision(staff:WorkspaceStaff,raw:unknown) {
    if(this.#id!==demoBrokerageId)return {error:"Inspection decisions are unavailable."};
    const emails=[...(googleSettings(this.env)?.allowedEmails??[])],parsed=maintenanceDecisionInput.safeParse(raw);
    if(!parsed.success || !maintenanceAdmin(this.#store,staff,emails) || maintenanceState(this.#store,staff.brokerage.id).mode!=="Paused")
      return {error:"A current pilot admin and paused workspace are required."};
    const input=parsed.data,prior=priorMaintenanceDecision(this.#store,staff,input);
    if(prior)return "error" in prior?prior:{...prior,view:maintenanceView(this.#store,staff.brokerage.id,0)};
    const result=await this.env.WORKSPACE.getByName(staff.brokerage.id).inspectWorkspaceMaintenance(staff,input);
    if("error" in result)return result;
    const item=[...result.inspection.documents.items,...result.inspection.requests.items].find(item=>item.reference===input.reference);
    if(!item)return {error:"This record is no longer on the inspected page. Refresh the inspection."};
    const saved=recordMaintenanceDecision(this.#store,staff,emails,input,item.fingerprint);
    return "error" in saved?saved:{...saved,view:maintenanceView(this.#store,staff.brokerage.id,0)};
  }
  async manageWorkspaceMaintenance(staff: WorkspaceStaff,input?: unknown): Promise<MaintenanceView | {error:string}> {
    if (this.#id !== demoBrokerageId) return {error:"Maintenance controls unavailable."};
    const emails=[...(googleSettings(this.env)?.allowedEmails??[])];
    if (!maintenanceAdmin(this.#store,staff,emails)) return {error:"Only an active pilot workspace admin can manage maintenance."};
    const id=staff.brokerage.id,workspace=this.env.WORKSPACE.getByName(id);
    if (input !== undefined) {
      const parsed=maintenanceInput.safeParse(input);
      if (!parsed.success) return {error:"Complete the maintenance fields and required checks."};
      if (parsed.data.type==="reopen") {
        if (!this.mayPrepareMaintenanceReopen(staff,parsed.data.revision)) return {error:"Complete the current reopening review, then refresh the status before reopening."};
        await workspace.prepareMaintenanceReopen(staff,parsed.data.revision);
      }
      const changed=changeMaintenance(this.#store,staff,emails,parsed.data);
      if (changed.error)return {error:changed.error};
    }
    const fence=await workspace.maintenanceFence();
    if (fence.closed && !fence.active) markMaintenanceDrained(this.#store,id,fence.revision);
    // Revalidate membership after the cross-object call before returning notes.
    if (!maintenanceAdmin(this.#store,staff,emails)) return {error:"Maintenance access changed. Sign in again."};
    return maintenanceView(this.#store,id,fence.active);
  }

  #accepts(staff: WorkspaceStaff | null) {
    return staff ? staff.brokerage.id === this.#id : this.#id === demoBrokerageId;
  }

  #uwmEnvironment() {
    return Object.fromEntries(["UWM_BROKERAGE_ID", "UWM_USER_CLIENT_ID", "UWM_USER_CLIENT_SECRET", "UWM_USER_ENVIRONMENT",
      "ORBIT_DEPLOYMENT", "UWM_TOKEN_ENCRYPTION_KEY", "UWM_STORAGE_ORIGIN", "UWM_DOCUMENT_STORAGE_ORIGIN"]
      .map(key => [key, runtimeSetting(this.env, key)]));
  }

  async uwmFile(staff: WorkspaceStaff, input: unknown, reading: boolean) {
    if (!this.#accepts(staff)) return { error: "UWM file unavailable." };
    try {
      return reading ? await readUwmFile(this.#store, this.#uwmEnvironment(), staff, input)
        : await runUwmWorkflow(this.#store, this.#uwmEnvironment(), staff, input, undefined, async (operationId,transactionId)=>{
          const operation=this.#store.prepare("SELECT environment FROM uwm_operations WHERE id=? AND transactionId=? AND actor=?").get(operationId,transactionId,staff.email);
          if(!operation)throw new UwmError("The UWM import route could not be verified.");
          await this.env.WORKSPACE.getByName(demoBrokerageId).registerUwmTransactionRoute(staff,operationId,transactionId,String(operation.environment));
        });
    } catch (error) {
      return { error: error instanceof UwmError ? error.message : "Check the UWM request fields and try again." };
    }
  }

  async uwmAccount(staff: WorkspaceStaff, input: { action: "status" | "connect" | "disconnect" | "verify"; credentials?: unknown }) {
    if (!this.#accepts(staff)) return { error: "UWM account unavailable." };
    const env = Object.fromEntries(["UWM_BROKERAGE_ID", "UWM_USER_CLIENT_ID", "UWM_USER_CLIENT_SECRET", "UWM_USER_ENVIRONMENT",
      "ORBIT_DEPLOYMENT", "UWM_TOKEN_ENCRYPTION_KEY"].map((key) => [key, runtimeSetting(this.env, key)]));
    try {
      if (input.action === "disconnect") return disconnectUwmUser(this.#store, staff);
      if (input.action === "connect") return await connectUwmUser(this.#store, env, staff, input.credentials);
      if (input.action === "verify") {
        const associations = await uwmPublicClient(this.#store, env, staff).brokerAssociations();
        return { associations: associations.body, message: `UWM verified ${associations.body.branches.length} available branches. Choose the branch and loan officer when preparing a file.` };
      }
      return uwmUserStatus(this.#store, env, staff);
    } catch (error) { return { error: input.action === "verify" && error instanceof UwmError ? error.message
      : "UWM sign-in failed. Verify your UWM credentials, environment and broker access, then try again." }; }
  }

  registerUwmTransactionRoute(staff: WorkspaceStaff,operationId:string,transactionId:string,environment:string) {
    if(this.#id!==demoBrokerageId)throw new Error("UWM route directory unavailable.");
    const active=activeBrokerages(this.#store,staff.email,[...(googleSettings(this.env)?.allowedEmails??[])])
      .find(item=>item.id===staff.brokerage.id && !item.pilot && item.role!=="Processor");
    if(!active || active.id===demoBrokerageId || environment!==runtimeSetting(this.env,"UWM_USER_ENVIRONMENT"))throw new Error("UWM route access unavailable.");
    registerUwmRoute(this.#store,{environment,operationId,transactionId,brokerageId:active.id});
  }

  uwmWebhookRoute(event: UwmWebhookRouteKey) {
    if(this.#id!==demoBrokerageId)throw new Error("UWM route directory unavailable.");
    return findUwmWebhookRoute(this.#store, event);
  }

  async routeUwmWebhook(event:UwmWebhookEvent) {
    if(this.#id!==demoBrokerageId)throw new Error("UWM route directory unavailable.");
    const connection=uwmWebhookConnection(runtimeSetting(this.env,"UWM_WEBHOOK_CONFIG"),event.environment);
    if(!connection)throw new Error("UWM webhook environment unavailable.");
    const receipt = await deliverUwmWebhook(this.#store, event, connection.brokerageId, {
      persist: (target, event) => this.env.WORKSPACE.getByName(target).receiveUwmWebhook(event),
      verify: (route, event) => this.env.WORKSPACE.getByName(route.brokerageId).verifyUwmLoanRoute(route, event),
      complete: (route, event, receiptId) => this.env.WORKSPACE.getByName(route.brokerageId).completeUwmImportReceipt(event, receiptId),
    });
    return {receiptId:receipt.receiptId,duplicate:receipt.duplicate};
  }

  verifyUwmLoanRoute(route: UwmWebhookRoute, event: UwmWebhookRouteKey) {
    return route.brokerageId === this.#id && uwmLoanRouteVerified(this.#store, route, event);
  }

  async receiveUwmWebhook(event: UwmWebhookEvent) {
    const connection = uwmWebhookConnection(runtimeSetting(this.env, "UWM_WEBHOOK_CONFIG"), event.environment);
    const directory = this.env.WORKSPACE.getByName(demoBrokerageId);
    const route = await directory.uwmWebhookRoute(uwmWebhookRouteKey(event));
    const target = route && (event.kind === "import" || this.verifyUwmLoanRoute(route, event));
    if (!connection || (target ? route.brokerageId : connection.brokerageId) !== this.#id) throw new Error("Webhook workspace mismatch");
    const details = await directory.brokerageDetails(this.#id);
    if (!details || details.pilot) throw new Error("Webhook brokerage unavailable");
    const parsed = parseUwmWebhook(event.environment, event.kind, event.body);
    const allowed = parsed.kind === "import" && route?.brokerageId === this.#id && uwmImportCallbackAllowed(this.#store, route, parsed);
    const receipt = saveUwmWebhook(this.#store, parsed, new Date().toISOString(), parsed.kind === "import" && !allowed);
    const claimLoanNumber = allowed && !receipt.heldImport && Boolean(parsed.loanNumber) && JSON.parse(parsed.body).LoanStatus === "Completed";
    if (allowed && !receipt.heldImport && !claimLoanNumber) reconcileUwmImportReceipt(this.#store, receipt.receiptId);
    return { ...receipt, claimLoanNumber };
  }

  async completeUwmImportReceipt(event: UwmWebhookEvent, receiptId: number) {
    if (event.kind !== "import" || !event.loanNumber) throw new Error("UWM completion receipt unavailable.");
    const directory = this.env.WORKSPACE.getByName(demoBrokerageId);
    const route = await directory.uwmWebhookRoute({ ...uwmWebhookRouteKey(event), kind: "conditions" });
    const saved = this.#store.prepare(`SELECT 1 FROM uwm_webhook_receipts WHERE id=? AND kind='import'
      AND environment=? AND transactionId=? AND loanNumber=? AND digest=? AND heldImport=0`)
      .get(receiptId, event.environment, event.transactionId, event.loanNumber, event.digest);
    if (!route || route.brokerageId !== this.#id || route.transactionId !== event.transactionId ||
      !saved || !uwmImportCallbackAllowed(this.#store, route, event)) throw new Error("UWM completion route unavailable.");
    reconcileUwmImportReceipt(this.#store, receiptId);
    if (!this.verifyUwmLoanRoute(route, event)) throw new Error("UWM completion could not be verified.");
  }

  uwmWebhookReceipts(staff: WorkspaceStaff, before: number, receiptId?: number) {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") throw new Error("Webhook receipts unavailable");
    if (receiptId !== undefined) {
      const receipt = this.#store.prepare("SELECT * FROM uwm_webhook_receipts WHERE id = ?").get(receiptId);
      return receipt ?? null;
    }
    const config = runtimeSetting(this.env, "UWM_WEBHOOK_CONFIG");
    return readUwmWebhookReceipts(this.#store, before).map((row) => {
      const environment = z.enum(["int", "stage", "production"]).safeParse(row.environment);
      const eligible = Boolean(row.loanNumber) && ["conditions", "ulad"].includes(String(row.kind)) &&
        environment.success && uwmWebhookConnection(config, environment.data)?.brokerageId === this.#id;
      return { ...row, canMatch: eligible && row.status !== "Matched", canCheck: eligible && row.status === "Matched" };
    });
  }

  uwmReceiptMatchRoute(staff: WorkspaceStaff, event: UwmWebhookRouteKey) {
    if (this.#id !== demoBrokerageId || !["conditions", "ulad"].includes(event.kind) ||
      uwmWebhookConnection(runtimeSetting(this.env, "UWM_WEBHOOK_CONFIG"), event.environment)?.brokerageId !== staff.brokerage.id) return null;
    const route = findUwmWebhookRoute(this.#store, event);
    if (!route) return null;
    const admins = activeBrokerages(this.#store, staff.email, [...(googleSettings(this.env)?.allowedEmails ?? [])])
      .filter(({ pilot, role }) => !pilot && role === "Admin").map(({ id }) => id);
    return admins.includes(staff.brokerage.id) && admins.includes(route.brokerageId) ? route : null;
  }

  async storeMatchedUwmReceipt(staff: WorkspaceStaff, event: UwmWebhookEvent, expectedOperation: string) {
    const parsed = parseUwmWebhook(event.environment, event.kind, event.body);
    const directory = this.env.WORKSPACE.getByName(demoBrokerageId);
    const route = await directory.uwmReceiptMatchRoute(staff, uwmWebhookRouteKey(parsed));
    if (route?.brokerageId !== this.#id || route.operationId !== expectedOperation ||
      !uwmLoanRouteVerified(this.#store, route, parsed)) return null;
    return saveUwmWebhook(this.#store, parsed).receiptId;
  }

  async matchUwmReceipt(staff: WorkspaceStaff, receiptId: number) {
    const unavailable = { error: "Matching requires a verified lender loan and admin access to its workspace." };
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") return unavailable;
    const row = this.#store.prepare("SELECT environment,kind,body FROM uwm_webhook_receipts WHERE id=? AND kind IN ('conditions','ulad')").get(receiptId);
    const environment = z.enum(["int", "stage", "production"]).safeParse(row?.environment);
    if (!row || !environment.success) return unavailable;
    const event = parseUwmWebhook(environment.data, row.kind === "ulad" ? "ulad" : "conditions", String(row.body));
    const directory = this.env.WORKSPACE.getByName(demoBrokerageId);
    const route = await directory.uwmReceiptMatchRoute(staff, uwmWebhookRouteKey(event));
    if (!route) return unavailable;
    const target = this.env.WORKSPACE.getByName(route.brokerageId);
    if (!await target.verifyUwmLoanRoute(route, uwmWebhookRouteKey(event))) return unavailable;
    const reserved = this.#store.transaction(() => {
      this.#store.prepare("INSERT OR IGNORE INTO uwm_receipt_matches (receiptId,destination,operationId) VALUES (?,?,?)")
        .run(receiptId, route.brokerageId, route.operationId);
      return this.#store.prepare("SELECT destination,operationId FROM uwm_receipt_matches WHERE receiptId=?").get(receiptId)!;
    });
    if (reserved.destination !== route.brokerageId || reserved.operationId !== route.operationId) {
      return { error: "The verified route changed after matching began. Review the original receipt." };
    }
    // The inbox marker and loan copy live in different databases. A restore
    // can remove the loan copy while the inbox still has the match marker.
    const matched = await target.storeMatchedUwmReceipt(staff, event, route.operationId);
    if (matched === null) return unavailable;
    this.#store.transaction(() => {
      const previous = this.#store.prepare("SELECT destinationReceiptId FROM uwm_receipt_matches WHERE receiptId=?").get(receiptId);
      if (!previous) throw new Error("The match reservation could not be confirmed.");
      if (previous.destinationReceiptId === matched) return;
      const now = new Date().toISOString();
      this.#store.prepare(`UPDATE uwm_receipt_matches SET destinationReceiptId=?, completedAt=COALESCE(completedAt,?) WHERE receiptId=?`)
        .run(matched, now, receiptId);
      accessEvent(this.#store, staff, previous.destinationReceiptId === null ? "Matched UWM receipt" : "Reconciled UWM receipt copy",
        `Receipt ${receiptId} → receipt ${matched}`, now);
    });
    return { status: "Matched" as const };
  }


  read(staff: WorkspaceStaff | null, deferred = false) {
    if (!this.#accepts(staff)) throw new Error("Workspace access denied.");
    if (deferred && staff) return readStaffWorkspaceEntry(this.#store, staff);
    return scopeWorkspace(readWorkspace(this.#store, staff?.brokerage.role === "Admin"), staff);
  }

  pipeline(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: pipelineUnavailable };
    return this.#store.transaction(() => readPipeline(this.#store, input, staff));
  }

  loanContactPicker(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: loanContactPickerUnavailable };
    return this.#store.transaction(() => readLoanContactPicker(this.#store, input, staff));
  }

  contactDirectory(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: contactsUnavailable };
    return this.#store.transaction(() => readContactDirectory(this.#store, input, staff));
  }

  leadInbox(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: leadInboxUnavailable };
    return this.#store.transaction(() => readLeadInbox(this.#store, input, staff));
  }

  history(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: "This activity history is unavailable." };
    return readRecordHistory(this.#store, staff, input);
  }

  uwmDelivery(input: unknown, staff: WorkspaceStaff) {
    return readUwmDelivery(this.#store, input, staff, this.#id);
  }

  leadArchive(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: "The lead archive is unavailable." };
    return readLeadArchive(this.#store, staff, input);
  }

  sharedRealtorQueue(input: unknown, staff: WorkspaceStaff | null) {
    return readSharedRealtorQueue(this.#store, staff, this.#id, input);
  }

  realtorQueueReport(input: unknown, staff: WorkspaceStaff) {
    return readRealtorQueueReport(this.#store, staff, this.#id, input);
  }

  async realtorQueueAssignment(input: unknown, staff: WorkspaceStaff) {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") return { error: realtorQueueReportUnavailable };
    const parsed = assignWaitingRealtorInput.safeParse(input);
    if (!parsed.success) return { error: "Choose a waiting referral and an active officer." };
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    const recipient = await this.#resolveLeadOwner(parsed.data.officerEmail, emails, staff.email);
    return assignWaitingRealtor(this.#store, staff, this.#id, parsed.data, recipient);
  }

  fundingDashboard(input: unknown, staff: WorkspaceStaff) {
    return readFundingDashboard(this.#store, input, staff, this.#id);
  }

  officerQueue(input: unknown, staff: WorkspaceStaff) {
    return readOfficerQueue(this.#store, input, staff, this.#id);
  }

  async actionCounts(staff: WorkspaceStaff): Promise<ReturnType<typeof readActionCounts>> {
    const access = await this.#closingReviewerAccess(staff);
    return this.#store.transaction(() => readActionCounts(this.#store, staff, this.#id, undefined, undefined, access ?? undefined, this.#uwmEnvironment()));
  }

  workspaceTasks(input: unknown, staff: WorkspaceStaff) {
    return this.#store.transaction(() => readWorkspaceTasks(this.#store, input, staff, this.#id));
  }

  draftQueue(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: draftQueueUnavailable };
    return this.#store.transaction(() => readDraftQueue(this.#store, input, staff));
  }

  pastClientQueue(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: pastClientsUnavailable };
    return this.#store.transaction(() => readPastClientQueue(this.#store, input, staff));
  }

  realtorWork(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: realtorWorkUnavailable };
    return this.#store.transaction(() => readRealtorWork(this.#store, input, staff));
  }

  campaignCallbacks(input: unknown, staff: WorkspaceStaff) {
    return readCampaignCallbacks(this.#store, input, staff, this.#id);
  }

  campaignCallbackPerformance(input: unknown, staff: WorkspaceStaff) {
    return readCampaignCallbackPerformance(this.#store, input, staff, this.#id);
  }

  campaignManager(input: unknown, staff: WorkspaceStaff) {
    return readCampaignManager(this.#store, input, staff, this.#id);
  }

  campaignSequencePerformance(input: unknown, staff: WorkspaceStaff) {
    return readCampaignSequencePerformance(this.#store, input, staff, this.#id);
  }

  campaignCallbackExceptions(input: unknown, staff: WorkspaceStaff) {
    return readCampaignCallbackExceptions(this.#store, input, staff, this.#id);
  }

  officerDashboard(input: unknown, staff: WorkspaceStaff) {
    return officerDashboardWork(this.#store, input, staff, this.#id);
  }

  workspaceCalendar(input: unknown, staff: WorkspaceStaff) {
    return readWorkspaceCalendar(this.#store, input, staff, this.#id);
  }

  workspaceSearch(input: unknown, staff: WorkspaceStaff) {
    return readWorkspaceSearch(this.#store, input, staff, this.#id);
  }

  async staffPlaybookRun(input: unknown, staff: WorkspaceStaff) {
    const result = playbookRunWork(this.#store, input, staff, this.#id, new Date(), true);
    if ("kind" in result && result.kind === "document-schedule" && result.available) {
      const changed = Boolean(input && typeof input === "object" && "type" in input && input.type === "setDocumentSchedule");
      if (result.enabled || changed) await this.#armWorkspaceAlarm(changed);
    }
    return result;
  }

  staffBrokerageFinance(input: unknown, staff: WorkspaceStaff) {
    return brokerageFinanceWork(this.#store, input, staff, this.#id);
  }

  staffReportingReadiness(input: unknown, staff: WorkspaceStaff) {
    return reportingReadinessWork(this.#store, input, staff, this.#id);
  }

  staffDeparture(input: Exclude<OffboardingInput, { type: "offboardingRevoke" }>, roster: DepartureRoster, staff: WorkspaceStaff) {
    return departureWork(this.#store, input, roster, staff, this.#id);
  }

  staffDepartureWorkRemaining(email: string, staff: WorkspaceStaff) {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") throw new Error(offboardingUnavailable);
    return hasDepartureWork(this.#store, email);
  }

  async #closingReviewerAccess(staff: WorkspaceStaff): Promise<ClosingReviewerAccess | null> {
    const checkedEmails = closingReviewEmails(this.#store, staff, this.#id);
    if (!checkedEmails.length) return { checkedEmails, members: [] };
    const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    const members: VersionedBrokerageMember[] = [];
    for (let start = 0; start < checkedEmails.length; start += 20) {
      const batch = await directory.fileExceptionRoster(staff, emails, checkedEmails.slice(start, start + 20));
      if (!batch) return null;
      members.push(...batch);
    }
    return { checkedEmails, members };
  }

  async staffFileExceptions(input: unknown, staff: WorkspaceStaff): Promise<FileExceptionPage | { error: string }> {
    const query = fileExceptionQuery.safeParse(input);
    const needsAccess = query.success && (query.data.filter === "All file exceptions" || query.data.filter === closingPackageException);
    const access = needsAccess ? await this.#closingReviewerAccess(staff) : undefined;
    if (needsAccess && !access) return { error: fileExceptionsUnavailable };
    const page = readFileExceptions(this.#store, input, staff, this.#id, undefined, access ?? undefined, this.#uwmEnvironment());
    if ("error" in page) return page;
    const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    const roster = await directory.fileExceptionRoster(staff, emails, fileExceptionOwners(page));
    return roster ? nameFileExceptions(page, roster) : { error: fileExceptionsUnavailable };
  }

  async staffManagerExceptions(input: unknown, staff: WorkspaceStaff): Promise<ManagerExceptionResult> {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") return { error: managerExceptionsUnavailable };
    const query = managerExceptionInput.safeParse(input);
    if (!query.success) return { error: managerExceptionsUnavailable };
    const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
    const members = await directory.teamMembers(staff, [...(googleSettings(this.env)?.allowedEmails ?? [])]);
    return members ? this.#store.transaction(() => readManagerExceptionWork(this.#store, query.data, staff, members)) :
      { error: managerExceptionsUnavailable };
  }

  async staffLoanReview(input: unknown, staff: WorkspaceStaff): Promise<ReviewResult> {
    if (!this.#accepts(staff)) return { error: reviewsUnavailable };
    const parsed = reviewInput.safeParse(input);
    if (!parsed.success) return { error: "Check the reviewer, dates, and note before continuing." };
    const action = parsed.data;
    if (action.type === "queue" || action.type === "preflight") return loanReviewWork(this.#store, action, staff, this.#id, []);
    const selected = action.type === "inbox" || action.type === "readNotice" ? [staff.email] : reviewParticipants(this.#store, action, staff);
    if (!selected) return { error: reviewsUnavailable };
    if ((action.type === "comment" && !action.mentionEmail) || action.type === "escalate") {
      return loanReviewWork(this.#store, action, staff, this.#id, []);
    }
    const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    const roster = await directory.loanReviewRoster(staff, emails, selected, action.type === "loan" || action.type === "detail");
    return roster ? loanReviewWork(this.#store, action, staff, this.#id, roster) : { error: reviewsUnavailable };
  }

  appointmentWork(input: unknown, staff: WorkspaceStaff) {
    return workOnAppointment(this.#store, input, staff, this.#id);
  }

  async staffCoverage(input: unknown, staff: WorkspaceStaff): Promise<CoverageResult> {
    if (!this.#accepts(staff)) return { error: coverageUnavailable };
    const parsed = coverageInput.safeParse(input);
    if (!parsed.success) return { error: "Check the coverage dates or work details and try again." };
    const lookup = coverageParticipants(this.#store, parsed.data, staff);
    if (!lookup) return { error: coverageUnavailable };
    const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    const selected = lookup === "team" ? null : lookup;
    let roster = await directory.coverageRoster(staff, emails, selected);
    if (!roster) return { error: coverageUnavailable };
    const { optOut, release } = coveredCampaignRouting(this.#store, parsed.data, staff, roster);
    const optOutPlans = optOut ? campaignOptOutPlans(this.#store, optOut) : [];
    const optOutRoster = optOutPlans.length ? await this.#campaignOptOutRoster(staff, optOutPlans) : undefined;
    let refillRoster: CampaignRefillRoster | undefined;
    if (release) {
      try {
        const members = await directory.campaignRoutingRoster(staff, emails, release.officers);
        if (!members) return { error: coverageUnavailable };
        refillRoster = { campaignId: release.campaignId, revision: release.revision, members };
      } catch {
        // Staff can still log the result and route the remaining queue after recovery.
      }
    }
    if (optOutPlans.length || release) {
      roster = await directory.coverageRoster(staff, emails, selected);
      if (!roster) return { error: coverageUnavailable };
    }
    return coverageWork(this.#store, parsed.data, staff, this.#id, roster, undefined, optOutRoster, refillRoster);
  }

  processorQueue(input: unknown, staff: WorkspaceStaff) {
    return readProcessorQueue(this.#store, input, staff, this.#id);
  }

  processingView(input: unknown, staff: WorkspaceStaff) {
    return changeProcessingView(this.#store, input, staff, this.#id);
  }

  editableLoan(input: unknown, staff: WorkspaceStaff) {
    return readEditableLoan(this.#store, input, staff, this.#id);
  }

  closingPacket(input: unknown, staff: WorkspaceStaff) {
    return readClosingPacket(this.#store, input, staff, this.#id);
  }

  loanHandoff(loanId: string, knownVersion: string, staff: WorkspaceStaff) {
    return readLoanHandoff(this.#store, loanId, knownVersion, staff, this.#id);
  }

  incomingLoanWork(input: unknown, staff: WorkspaceStaff) {
    return readIncomingLoanWorkPage(this.#store, input, staff, this.#id, undefined, undefined, undefined, this.#uwmEnvironment());
  }

  manualReturnFollowUp(input: unknown, staff: WorkspaceStaff) {
    return recordManualReturnFollowUp(this.#store, input, staff, this.#id);
  }

  editableLead(input: unknown, staff: WorkspaceStaff) {
    return readEditableLead(this.#store, input, staff, this.#id);
  }

  salesDashboard(input: unknown, staff: WorkspaceStaff) {
    return readSalesDashboard(this.#store, input, staff, this.#id);
  }

  ownerScorecard(input: unknown, staff: WorkspaceStaff) {
    return readOwnerScorecard(this.#store, input, staff, this.#id);
  }

  ownerScorecardSettings(input: unknown, staff: WorkspaceStaff) {
    return changeOwnerScorecardSettings(this.#store, input, staff, this.#id);
  }

  async reportSchedules(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") return { error: "Report schedules are unavailable." } as const;
    const directory = this.env.WORKSPACE.getByName(demoBrokerageId);
    const roster = await directory.teamMembers(staff, [...(googleSettings(this.env)?.allowedEmails ?? [])]);
    return roster ? reportScheduleWork(this.#store, input, staff, this.#id, roster) : { error: "Report schedules are unavailable." } as const;
  }

  customReport(input: unknown, staff: WorkspaceStaff) {
    return customReportWork(this.#store, input, staff, this.#id);
  }

  crmFields(input: unknown, staff: WorkspaceStaff) {
    return crmFieldWork(this.#store, input, staff, this.#id);
  }

  disclosureCalendar(input: unknown, staff: WorkspaceStaff) {
    return disclosureCalendarWork(this.#store, input, staff, this.#id);
  }

  disclosureTemplates(input: unknown, staff: WorkspaceStaff) {
    return disclosureTemplateWork(this.#store, input, staff, this.#id);
  }

  async complianceCases(input: unknown, staff: WorkspaceStaff) {
    if (!this.#accepts(staff) || !workspaceFeatures(staff.brokerage).compliance) return { error: complianceWorkUnavailable };
    const directory = this.env.WORKSPACE.getByName(demoBrokerageId);
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    try {
      const roster = await directory.complianceRoster(staff, emails, true);
      return roster ? complianceCaseWork(this.#store, input, staff, this.#id, roster) : { error: complianceWorkUnavailable };
    } catch {
      return { error: complianceWorkUnavailable };
    }
  }

  async loanRetention(input: unknown, staff: WorkspaceStaff) {
    if (!this.#accepts(staff) || !staff.brokerage.pilot || !workspaceFeatures(staff.brokerage).compliance || staff.brokerage.role !== "Admin")
      return { error: loanRetentionUnavailable };
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    const roster = await this.env.WORKSPACE.getByName(demoBrokerageId).complianceRoster(staff, emails);
    if (!roster) return { error: loanRetentionUnavailable };
    const result = loanRetentionWork(this.#store, input, staff, this.#id);
    if ("kind" in result && result.kind === "saved") await this.#scheduleCleanup();
    return result;
  }

  retentionExport(staff: WorkspaceStaff, loanId: string) {
    return reviewRetentionExport(this.#store,staff,this.#id,loanId);
  }

  confirmRetentionExport(staff: WorkspaceStaff, loanId: string, fingerprint: string) {
    return auditRetentionExport(this.#store,staff,this.#id,loanId,fingerprint);
  }

  borrowerQuestionSets(input: unknown, staff: WorkspaceStaff) {
    return borrowerQuestionSetWork(this.#store, input, staff, this.#id);
  }

  loanStageEdits(input: unknown, staff: WorkspaceStaff) {
    return loanStageEditWork(this.#store, input, staff, this.#id);
  }

  async closingGates(input: unknown, staff: WorkspaceStaff): Promise<ReturnType<typeof closingGateWork>> {
    const parsed = closingGateInput.safeParse(input);
    if (parsed.success && parsed.data.type !== "loan" && staff.brokerage.role === "Admin" && this.#accepts(staff) &&
        (staff.brokerage.pilot || this.#id === demoBrokerageId)) {
      const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
      const roster = await directory.loanReviewRoster(staff, [...(googleSettings(this.env)?.allowedEmails ?? [])], [], true);
      if (!roster) return { error: "Could not verify the brokerage roster. Reload the policy." };
      return closingGateWork(this.#store, input, staff, this.#id, undefined, roster);
    }
    return closingGateWork(this.#store, input, staff, this.#id);
  }

  salesSettings(input: unknown, staff: WorkspaceStaff) {
    return changeSalesSettings(this.#store, input, staff, this.#id);
  }

  conversations(input: unknown, staff: WorkspaceStaff) {
    return readConversations(this.#store, input, staff, this.#id);
  }

  contactMerge(input: unknown, staff: WorkspaceStaff) {
    return contactMergeWork(this.#store, input, staff, this.#id);
  }

  async changeConversation(input: unknown, staff: WorkspaceStaff) {
    const parsed = conversationInput.safeParse(input);
    if (parsed.success && parsed.data.type === "assignContact" && staff.brokerage.id === this.#id && staff.brokerage.role === "Admin") {
      const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
      const replacement = await this.#resolveLeadOwner(parsed.data.email, emails, staff.email);
      return changeConversation(this.#store, input, staff, this.#id, new Date(), replacement);
    }
    return changeConversation(this.#store, input, staff, this.#id);
  }

  inboundReplies(input: unknown, staff: WorkspaceStaff) {
    return readInboundReplies(this.#store, input, staff, this.#id);
  }

  changeInboundReply(input: unknown, staff: WorkspaceStaff) {
    return changeInboundReply(this.#store, input, staff, this.#id);
  }

  fundingRecord(input: unknown, staff: WorkspaceStaff) {
    return fundingRecordAction(this.#store, input, staff, this.#id);
  }

  pipelineExport(staff: WorkspaceStaff) {
    if (!this.#accepts(staff)) return { error: "This pilot CRM export is unavailable." };
    return exportPilotPipeline(this.#store, staff);
  }

  migrationRecovery(staff: WorkspaceStaff, importId: unknown) {
    if (!this.#accepts(staff)) return { error: "This CRM import receipt is unavailable in this brokerage." };
    return reviewMigrationRecovery(this.#store, staff, importId);
  }

  migrationRecord(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: migrationRecordUnavailable };
    return this.#store.transaction(() => readMigrationRecord(this.#store, input, staff));
  }

  async #cutoverOwners(staff: WorkspaceStaff): Promise<ReadonlySet<string> | null> {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin" || !staff.brokerage.pilot) return null;
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
    const members: BrokerageMember[] | null = await directory.teamMembers(staff, emails);
    return members && new Set(members.filter(({ role, status }) => status === "Active" && role !== "Processor").map(({ email }) => email));
  }

  async migrationCutover(staff: WorkspaceStaff, origin: unknown): Promise<MigrationCutover | { error: string }> {
    const owners = await this.#cutoverOwners(staff);
    return owners ? readMigrationCutover(this.#store, staff, this.#id, origin, owners) : { error: cutoverUnavailable };
  }

  async cutoverHandoff(staff: WorkspaceStaff, query: unknown): Promise<CutoverHandoff | { error: string }> {
    const owners = await this.#cutoverOwners(staff);
    return owners ? exportCutoverHandoff(this.#store, staff, this.#id, query, owners) : { error: cutoverUnavailable };
  }

  cutoverFileLookup(staff: WorkspaceStaff, query: unknown): CutoverFileLookup {
    return lookupCutoverFile(this.#store, staff, this.#id, query);
  }

  cutoverApplicationComparison(staff: WorkspaceStaff, query: unknown): CutoverApplicationComparison | { error: string } {
    return readCutoverApplicationComparison(this.#store, staff, this.#id, query);
  }

  cutoverFileInventory(staff: WorkspaceStaff, query: unknown): CutoverFileInventory | { error: string } {
    return readCutoverFileInventory(this.#store, staff, this.#id, query);
  }

  async exportCutoverInventory(staff: WorkspaceStaff, loanId: unknown) {
    const owners = await this.#cutoverOwners(staff);
    return owners ? exportCutoverInventory(this.#store, staff, this.#id, loanId) : { error: cutoverUnavailable };
  }

  recordCutoverFileInventory(staff: WorkspaceStaff, input: unknown): { message: string } | { error: string } {
    return saveCutoverFileInventory(this.#store, staff, this.#id, input);
  }

  async recordCutoverReview(staff: WorkspaceStaff, input: unknown): Promise<{ message: string } | { error: string }> {
    const parsed = cutoverReviewInput.safeParse(input);
    if (!parsed.success || parsed.data.item !== cutoverCallbackItem) {
      return saveMigrationCutover(this.#store, staff, this.#id, input);
    }
    const owners = await this.#cutoverOwners(staff);
    return owners ? saveMigrationCutover(this.#store, staff, this.#id, input, undefined, owners) : { error: cutoverUnavailable };
  }

  beginWorkspaceRecoveryEdit(staff:WorkspaceStaff,input:unknown):RecoveryEdit {
    if(this.#id!==demoBrokerageId)throw new Error("Recovery directory unavailable.");
    return beginRecoveryEdit(this.#store,staff,[...(googleSettings(this.env)?.allowedEmails??[])],input);
  }
  finishWorkspaceRecoveryEdit(staff:WorkspaceStaff,id:string,proof:unknown,rejected:boolean) {
    if(this.#id!==demoBrokerageId)throw new Error("Recovery directory unavailable.");
    return finishRecoveryEdit(this.#store,staff,[...(googleSettings(this.env)?.allowedEmails??[])],id,proof,rejected);
  }
  readWorkspaceRecoveryEdits(staff:WorkspaceStaff,raw:unknown) {
    const input=recoveryEditPage.parse(raw);
    if(!this.mayInspectMaintenance(staff,input.revision))throw new Error("Pause the workspace and refresh before inspecting edits.");
    const page=recoveryEditRows(this.#store,staff.brokerage.id,input.offset,input.pendingOnly),cycle=maintenanceState(this.#store,staff.brokerage.id).startedAt!;
    const pending=this.#store.prepare(`SELECT r.editId,e.recordName,e.label FROM brokerage_recovery_replays r
      JOIN brokerage_recovery_edits e ON e.id=r.editId AND e.brokerageId=r.brokerageId WHERE r.brokerageId=? AND r.state='Pending' LIMIT 1`).get(staff.brokerage.id);
    return {...page,pendingReplay:pending?{editId:String(pending.editId),recordName:String(pending.recordName),label:String(pending.label)}:null,
      items:page.items.map(edit=>({...edit,replay:recoveryReplay(this.#store,staff.brokerage.id,cycle,edit.id)}))};
  }
  async confirmWorkspaceRecoveryEdit(staff:WorkspaceStaff,raw:unknown):Promise<MaintenanceView> {
    const input=recoveryEditReview.parse(raw);
    if(this.#id!==demoBrokerageId || !this.mayInspectMaintenance(staff,input.revision))throw new Error("Pause the workspace and refresh its status before reviewing an edit.");
    const report=await this.env.WORKSPACE.getByName(staff.brokerage.id).inspectWorkspaceRecoveryEdits(staff,input);
    const observed=report.items.find(item=>item.id===input.id);
    if(!observed)throw new Error("This edit moved to another page. Refresh the inspection.");
    return recordRecoveryEditReview(this.#store,staff,[...(googleSettings(this.env)?.allowedEmails??[])],input,observed);
  }
  async inspectWorkspaceRecoveryEdits(staff:WorkspaceStaff,raw:unknown):Promise<RecoveryEditInspection> {
    const input=recoveryEditPage.parse(raw),gate=maintenanceGates.get(this);
    if(this.#id!==staff.brokerage.id || !gate?.closed || gate.active)throw new Error("Wait for the workspace to pause before inspecting edits.");
    const directory=this.env.WORKSPACE.getByName(demoBrokerageId);
    const page=await directory.readWorkspaceRecoveryEdits(staff,input);
    const report={...page,revision:input.revision,items:page.items.map(edit=>({...inspectRecoveryEdit(this.#store,edit),replay:edit.replay,canReplay:!edit.replay&&inspectRecoveryEdit(this.#store,edit).canReplay}))};
    if(!gate.closed || gate.active || !await directory.mayInspectMaintenance(staff,input.revision))throw new Error("Maintenance changed. Refresh the edit inspection.");
    return report;
  }

  authorizedRecoveryReplay(staff:WorkspaceStaff,editId:string):ReplayReservation {
    if(this.#id!==demoBrokerageId)throw new Error("Recovery directory unavailable.");
    const state=maintenanceState(this.#store,staff.brokerage.id);
    if(!this.mayInspectMaintenance(staff,state.revision))throw new Error("A current pilot admin and paused workspace are required.");
    const replay=recoveryReplay(this.#store,staff.brokerage.id,state.startedAt!,editId),edit=readRecoveryEdit(this.#store,staff.brokerage.id,editId);
    if(!replay||!edit)throw new Error("Recovery receipt unavailable.");
    return {replay,edit};
  }
  async recoverWorkspaceEdit(staff:WorkspaceStaff,raw:unknown):Promise<{view:MaintenanceView;message:string}> {
    if(this.#id!==demoBrokerageId)throw new Error("Recovery directory unavailable.");
    const input=recoveryReplayInput.parse(raw),emails=[...(googleSettings(this.env)?.allowedEmails??[])];
    if(!("resume" in input)){
      if(!this.mayInspectMaintenance(staff,input.revision))throw new Error("Pause the workspace and refresh before recovering an edit.");
      const report=await this.env.WORKSPACE.getByName(staff.brokerage.id).inspectWorkspaceRecoveryEdits(staff,input);
      const observed=report.items.find(item=>item.id===input.id);
      if(!observed)throw new Error("Refresh the inspection to find this edit.");
      reserveRecoveryReplay(this.#store,staff,emails,input,observed);
    }
    const reservation=this.authorizedRecoveryReplay(staff,input.id);
    if(reservation.replay.state!=="Pending")return {view:maintenanceView(this.#store,staff.brokerage.id,0),message:reservation.replay.result??"Recovery outcome already recorded."};
    // The durable pending reservation prevents review/reopen across interruption.
    const result=await this.env.WORKSPACE.getByName(staff.brokerage.id).applyWorkspaceRecoveryReplay(staff,input.id);
    return {view:finishRecoveryReplay(this.#store,staff,emails,reservation,result),message:result.message};
  }
  async applyWorkspaceRecoveryReplay(staff:WorkspaceStaff,editId:string) {
    const gate=maintenanceGates.get(this);
    if(this.#id!==staff.brokerage.id||!gate?.closed||gate.active)throw new Error("Wait for the workspace to pause before recovering edits.");
    const reservation=await this.env.WORKSPACE.getByName(demoBrokerageId).authorizedRecoveryReplay(staff,editId);
    if(this.#checkpointReading||!gate.closed||gate.active||reservation.replay.state!=="Pending")throw new Error("Recovery is no longer pending in a paused workspace.");
    return applyRecoveryReplay(this.#store,staff,reservation);
  }

  async write(input: unknown, staff: WorkspaceStaff | null, scope?: WorkspaceMutationScope) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." };
    let referralOwner: StaffIdentity | undefined;
    let leadMembers: BrokerageMember[] = [];
    let campaignRefillRoster: CampaignRefillRoster | undefined;
    let reviewRouting: { reviewerEmail: string; reviewer: VersionedBrokerageMember | null } | undefined;
    const firstReview = staff && input && typeof input === "object" && "type" in input && input.type === "reviewApplication" ?
      reviewApplicationInput.safeParse(input) : null;
    if (staff && firstReview?.success) {
      const current = this.#store.prepare(`SELECT revision FROM applications
        WHERE loanId = ? AND submittedAt IS NOT NULL AND reviewedAt IS NULL`).get(firstReview.data.loanId);
      const rule = readPlaybook(this.#store).secondReview;
      if (rule && current) {
        input = { ...firstReview.data, revision: firstReview.data.revision ?? Number(current.revision) };
        const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
        const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
        const roster = await directory.loanReviewRoster(staff, emails, [rule.reviewerEmail], false);
        if (!roster) return { error: reviewsUnavailable };
        reviewRouting = { reviewerEmail: rule.reviewerEmail, reviewer: roster.find((member) => member.email === rule.reviewerEmail) ?? null };
      }
    }
    if (staff?.brokerage.role === "Admin" && input && typeof input === "object" && "type" in input &&
      (input.type === "createRealtorPortal" || input.type === "saveRealtorLinkOwner") && "officerEmail" in input && typeof input.officerEmail === "string" &&
      input.officerEmail !== staff.email) {
      const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
      const member = await this.#resolveLeadOwner(input.officerEmail, emails, staff.email);
      if (!member) return { error: "Select an active loan officer or admin in this brokerage." };
      referralOwner = member;
    }
    if (staff?.brokerage.role === "Admin" && (saveLeadRoutingInput.safeParse(input).success || saveRealtorClaimPolicyInput.safeParse(input).success ||
      assignInboxLeadInput.safeParse(input).success ||
      assignContactFollowUpInput.safeParse(input).success ||
      savePlaybookInput.safeParse(input).success || (staff.brokerage.pilot && [migrationInput, assignCampaignLeadsInput, addCampaignLeadInput,
        enrollCrmSegmentInput, loadCampaignRehearsalInput, routeCampaignQueueInput, saveCampaignRoutingInput].some((schema) => schema.safeParse(input).success)))) {
      const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
      const team = this.#id === demoBrokerageId ? this.team(staff, emails)
        : await this.env.WORKSPACE.getByName(demoBrokerageId).team(staff, emails);
      leadMembers = team.members.filter((member) => member.status === "Active" && member.role !== "Processor");
    }
    const releaseTarget = staff?.brokerage.pilot ? campaignRefillTarget(input) : undefined;
    if (staff && releaseTarget) {
      const refill = campaignReleaseRouting(this.#store, staff, releaseTarget);
      if (refill) {
        const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
        const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
        try {
          const members = await directory.campaignRoutingRoster(staff, emails, refill.officers);
          if (!members) return { error: "Workspace access denied." };
          campaignRefillRoster = { campaignId: refill.campaignId, revision: refill.revision, members };
        } catch {
          // A directory lookup failure leaves the shared queue available for manual routing.
        }
      }
    }
    const optOutTarget = staff ? staffCampaignOptOutTarget(this.#store, staff, input) : undefined;
    const optOutPlans = optOutTarget ? campaignOptOutPlans(this.#store, optOutTarget) : [];
    const campaignOptOutRoster = staff && optOutPlans.length ? await this.#campaignOptOutRoster(staff, optOutPlans) : undefined;
    let recoveryEdit:RecoveryEdit|undefined;
    const intent=staff?recoveryIntentForCommand(this.#store,staff,input):null;
    if(staff&&intent) {
      try {recoveryEdit=await this.env.WORKSPACE.getByName(demoBrokerageId).beginWorkspaceRecoveryEdit(staff,intent);}
      catch {return {error:"The recovery receipt could not be prepared. Try saving the change again."};}
    }
    const closingReviewer = await this.#reviewerForSampleSignature(input, "respondToDisclosurePackage", !!staff && (staff.brokerage.pilot || this.#id === demoBrokerageId));
    const result = await executeCommand(this.#store, input, staff, referralOwner, leadMembers,
      { scopedLeadUpdates: true, scopedLoanUpdates: true, scopedContactUpdates: true, scopedInboxUpdates: scope === "inbox", scopedTaskUpdates: scope === "tasks",
        scopedTemplateUpdates: true, scopedRealtorUpdates: scope === "realtors", scopedMigrationUpdates: scope === "migration",
        reviewRouting, closingReviewer, campaignRefillRoster, campaignOptOutRoster, recoveryEdit,
        uwmEnvironment: Object.fromEntries(["UWM_BROKERAGE_ID", "UWM_INSIGHTS_CLIENT_ID", "UWM_INSIGHTS_CLIENT_SECRET",
          "UWM_CLIENT_ID", "UWM_CLIENT_SECRET", "UWM_ENVIRONMENT", "ORBIT_PRICING_MODE", "UWM_EQ_CLIENT_ID",
          "UWM_EQ_CLIENT_SECRET", "UWM_EQ_BROKER_ALIAS", "UWM_EQ_LO_EMAIL"].map((key) => [key, runtimeSetting(this.env, key)])),
        protectPilotLinks: staff?.brokerage.pilot ? this.#protectPilotLinks : undefined });
    if(staff&&recoveryEdit) {
      try {await this.env.WORKSPACE.getByName(demoBrokerageId).finishWorkspaceRecoveryEdit(staff,recoveryEdit.id,
        readRecoveryProof(this.#store,recoveryEdit.id),"error" in result);}
      catch {if("message" in result)result.message+=" Recovery receipt confirmation is pending; an admin can inspect it during maintenance.";}
    }
    if ("state" in result && input && typeof input === "object" && "type" in input && (input.type === "deleteLoan" || input.type === "loadGuidedDemo")) await this.#scheduleCleanup();
    if (staff?.brokerage.pilot && "referralLoanId" in result && result.referralLoanId && input && typeof input === "object" &&
      "type" in input && input.type === "convertReferral" && "referralId" in input && typeof input.referralId === "string") {
      const links = convertedLeadLinkHashes(this.#store, input.referralId, result.referralLoanId);
      if (links.length) {
        const protectedLinks = await this.#protectPilotLinks(links).catch(() => false);
        if (!protectedLinks) console.warn("Orbit could not retain a converted lead link retirement in the directory.");
      }
      await this.#scheduleCleanup();
    }
    return result;
  }

  async #permitsUpload(mode: DocumentUploadMode) {
    const flag = runtimeSetting(this.env, "ORBIT_DOCUMENT_UPLOADS").trim();
    const details = this.#id === demoBrokerageId ? { pilot: false }
      : await this.env.WORKSPACE.getByName(demoBrokerageId).brokerageDetails(this.#id);
    return !!details && documentUploadMode(flag === "mock" ? "mock" : flag === "enabled" ? "live" : undefined, this.#id, details.pilot) === mode;
  }
  async issueUploadCode(token: string, secret: string, mode: DocumentUploadMode) {
    if (!await this.#permitsUpload(mode)) return { status: 503, error: "PDF uploads are unavailable." };
    return issueDocumentCode(this.#store, token, secret, mode);
  }
  async verifyUploadCode(token: string, code: string, secret: string, mode: DocumentUploadMode) {
    if (!await this.#permitsUpload(mode)) return { status: 503, error: "PDF uploads are unavailable." };
    return verifyDocumentCode(this.#store, token, code, secret, mode);
  }
  async beginUpload(input: UploadAccess) {
    if (!await this.#permitsUpload(input.mode)) return { status: 503, error: "PDF uploads are unavailable." };
    const result = beginDocumentUpload(this.#store, input);
    if ("objectId" in result) await this.#scheduleCleanup();
    return result;
  }
  async finishUpload(input: UploadAccess, objectId: string) {
    if (!await this.#permitsUpload(input.mode)) return { status: 503, error: "PDF uploads are unavailable." };
    const result = finishDocumentUpload(this.#store, input, objectId);
    await this.#scheduleCleanup();
    return result;
  }
  async failUpload(requestId: string, objectId: string) {
    failDocumentUpload(this.#store, requestId, objectId);
    await this.#scheduleCleanup();
  }
  downloadDocument(staff: WorkspaceStaff, requestId: string, evidenceId?: string, acceptedRevision?: number) {
    return this.#accepts(staff) ? downloadableDocument(this.#store, staff, requestId, evidenceId, acceptedRevision) ??
      (evidenceId || acceptedRevision !== undefined ? null : downloadableLeadDocument(this.#store, staff, requestId)) : null;
  }
  auditDocumentDownload(staff: WorkspaceStaff, requestId: string, objectId: string, evidenceId?: string, acceptedRevision?: number) {
    return this.#accepts(staff) && (recordDocumentDownload(this.#store, staff, requestId, objectId, evidenceId, acceptedRevision) ||
      (!evidenceId && acceptedRevision === undefined && recordLeadDocumentDownload(this.#store, staff, requestId, objectId)));
  }

  leadDocuments(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    const uploadsEnabled = !!this.#documents && runtimeSetting(this.env, "ORBIT_DOCUMENT_UPLOADS").trim() === "mock";
    return leadDocumentWork(this.#store, input, staff, this.#id, uploadsEnabled, this.#protectPilotLinks);
  }

  leadDocumentPortal(input: Pick<LeadSampleUpload, "token" | "code">) {
    return readLeadDocumentPortal(this.#store, input);
  }

  async beginLeadSample(input: LeadSampleUpload) {
    if (!await this.#permitsUpload("mock")) return { status: 503, error: "Sample PDF uploads are unavailable." };
    const result = beginLeadSample(this.#store, input);
    if ("objectId" in result) await this.#scheduleCleanup();
    return result;
  }

  async finishLeadSample(input: LeadSampleUpload, objectId: string) {
    const result = finishLeadSample(this.#store, input, objectId);
    await this.#scheduleCleanup();
    return result;
  }

  async failLeadSample(requestId: string, objectId: string) {
    failLeadSample(this.#store, requestId, objectId);
    await this.#scheduleCleanup();
  }
  async #scheduleCleanup() {
    if (!this.#documents) return;
    try { await this.#armWorkspaceAlarm(); } catch { console.warn("Orbit could not schedule document cleanup."); }
  }

  async #armWorkspaceAlarm(cancelIfIdle = false) {
    const storage = this.ctx.storage;
    const current = await storage.getAlarm();
    const cleanup = this.#documents ? nextDocumentCleanup(this.#store) : null;
    const reminder = nextDocumentReminderCheck(this.#store);
    const next = cleanup === null ? reminder : reminder === null ? cleanup : Math.min(cleanup, reminder);
    if (next === null) {
      if (cancelIfIdle && current !== null) await storage.deleteAlarm();
    } else if (current === null || current > next) {
      await storage.setAlarm(Math.max(Date.now(), next));
    }
  }

  async alarm() {
    if (this.#id === directoryDrainObject) return;
    if (runtimeSetting(this.env, "ORBIT_DRAIN_ROLLOUT") === "prepare") {
      if (await directoryTrafficPaused(this.#documents)) {
        await this.ctx.storage.setAlarm(Date.now() + directoryPauseRetrySeconds * 1000);
      } else await this.#runWorkspaceAlarm();
      return;
    }
    const end = await startDirectoryWork(this.env.WORKSPACE, "alarm");
    if (!end) {
      await this.ctx.storage.setAlarm(Date.now() + directoryPauseRetrySeconds * 1000);
      return;
    }
    try {
      await this.#runWorkspaceAlarm();
    } finally {
      await end();
    }
  }

  async #runWorkspaceAlarm() {
    runScheduledDocumentReminders(this.#store);
    if (this.#documents) {
      const objects = documentCleanupBatch(this.#store);
      try {
        if (objects.length) {
          await this.#documents.delete(objects.map((id) => documentKey(this.#id, id)));
          this.#store.transaction(() => {
            for (const id of objects) this.#store.prepare("DELETE FROM document_file_cleanup WHERE objectId = ?").run(id);
          });
        }
      } catch { console.warn("Orbit will retry private document cleanup."); }
    }
    await this.#armWorkspaceAlarm();
  }

  activateStaff(staff: StaffIdentity, emails: string[]) { return activateBrokerages(this.#store, staff, emails); }
  reserveStaffEmail(...args: Parameters<StaffEmailAuth["reserve"]>) { return reserveStaffEmailCode(this.#store, ...args); }
  consumeStaffEmail(...args: Parameters<StaffEmailAuth["consume"]>) { return consumeStaffEmailCode(this.#store, ...args); }
  staffSessionAccess(tokenHash: string, now: number, emails: string[]) {
    if (this.#id !== demoBrokerageId) return null;
    const access=readStaffAccess(this.#store,tokenHash,now,emails);
    return access ? {...access,brokerages:access.brokerages.map(brokerage=>({...brokerage,
      maintenance:maintenanceState(this.#store,brokerage.id).mode !== "Open"}))} : null;
  }
  rememberStaffWorkspace(tokenHash: string, now: number, emails: string[], brokerageId: string, replace: boolean) {
    return this.#id === demoBrokerageId && rememberWorkspace(this.#store, tokenHash, now, emails, brokerageId, replace);
  }
  staffBrokerages(email: string, emails: string[]) {
    return this.#store.transaction(() => {
      bootstrapDemoMembers(this.#store, emails);
      return activeBrokerages(this.#store, email, emails);
    });
  }
  staffInvitedTo(id: string, email: string) {
    return this.#id === demoBrokerageId && !!this.#store.prepare("SELECT 1 FROM brokerage_members WHERE brokerageId = ? AND email = ? AND status = 'Invited'").get(id, email);
  }
  brokerageDetails(id: string) {
    if (this.#id !== demoBrokerageId) return null;
    const row = this.#store.prepare(`SELECT b.pilot FROM brokerages b LEFT JOIN brokerage_workspace_settings s ON b.id = s.brokerageId
      WHERE b.id = ? AND (s.releaseEndsAt IS NULL OR s.releaseEndsAt > ?)`).get(id, new Date().toISOString());
    return row ? { pilot: Boolean(row.pilot), maintenance: maintenanceState(this.#store,id).mode !== "Open" } : null;
  }
  brokerageForPortal(token: unknown) {
    if (this.#id !== demoBrokerageId || typeof token !== "string") return null;
    const id = portalBrokerage(token);
    if (!id) return null;
    const now = new Date().toISOString();
    const row = this.#store.prepare(`SELECT b.pilot FROM brokerages b LEFT JOIN brokerage_workspace_settings s ON b.id = s.brokerageId
      WHERE b.id = ? AND (s.releaseEndsAt IS NULL OR s.releaseEndsAt > ?) AND NOT EXISTS (
      SELECT 1 FROM revoked_pilot_portals WHERE brokerageId = b.id AND tokenHash = ? AND expiresAt > ?
    )`).get(id, now, portalHash(token), now);
    return row ? { pilot: Boolean(row.pilot), maintenance: maintenanceState(this.#store,id).mode !== "Open" } : null;
  }
  #protectPilotLinks = (links: PilotPortalLink[]) => {
    if (this.#id === demoBrokerageId || links.some((link) => "token" in link && portalBrokerage(link.token) !== this.#id)) return Promise.resolve(false);
    return this.env.WORKSPACE.getByName(demoBrokerageId).retainPilotPortalRevocations(this.#id,
      links.map((link) => ({ tokenHash: "token" in link ? portalHash(link.token) : link.tokenHash, expiresAt: link.expiresAt })));
  };
  retainPilotPortalRevocations(id: string, links: { tokenHash: string; expiresAt: string }[]) {
    if (!this.brokerageDetails(id)?.pilot || links.length > 100 ||
      links.some(({ tokenHash, expiresAt }) => !/^[a-f0-9]{64}$/.test(tokenHash) || !Number.isFinite(Date.parse(expiresAt)))) return false;
    const now = new Date().toISOString();
    return this.#store.transaction(() => {
      this.#store.prepare(`DELETE FROM revoked_pilot_portals WHERE rowid IN (
        SELECT rowid FROM revoked_pilot_portals WHERE expiresAt <= ? ORDER BY expiresAt LIMIT 20)`).run(now);
      const remember = this.#store.prepare(`INSERT INTO revoked_pilot_portals VALUES (?, ?, ?)
        ON CONFLICT(brokerageId, tokenHash) DO UPDATE SET expiresAt = max(expiresAt, excluded.expiresAt)`);
      for (const { tokenHash, expiresAt } of links) if (expiresAt > now) remember.run(id, tokenHash, expiresAt);
      return true;
    });
  }
  leadOwner(id: string, email: string, emails: string[], adminEmail?: string): StaffIdentity | null {
    if (this.#id !== demoBrokerageId) return null;
    if (adminEmail && !activeBrokerages(this.#store, adminEmail, emails).some((item) => item.id === id && item.role === "Admin")) return null;
    const [member] = selectedActiveMembers(this.#store, id, [email], emails);
    return member && member.role !== "Processor" ? { email: member.email, name: member.name } : null;
  }
  quoteIntakeRoster(id: string, selected: string[], bootstrapEmails: string[], adminEmail?: string): VersionedBrokerageMember[] {
    if (this.#id !== demoBrokerageId || selected.length > campaignRoutingOfficerLimit + 2) return [];
    if (adminEmail && !activeBrokerages(this.#store, adminEmail, bootstrapEmails).some((item) => item.id === id && item.role === "Admin")) return [];
    return selectedActiveMembers(this.#store, id, selected, bootstrapEmails).filter(({ role }) => role !== "Processor");
  }
  teamMembers(staff: WorkspaceStaff, emails: string[]) {
    if (!activeBrokerages(this.#store, staff.email, emails).some((entry) => entry.id === staff.brokerage.id && entry.role === "Admin")) return null;
    return brokerageMembers(this.#store, staff.brokerage.id, emails);
  }
  team(staff: WorkspaceStaff, emails: string[]) {
    const members = this.teamMembers(staff, emails);
    const id = staff.brokerage.id;
    return members ? { members, history: brokerageHistory(this.#store, id),
      ...(staff.brokerage.pilot && this.brokerageDetails(id)?.pilot ? { seatCapacity: pilotSeatCapacity(this.#store, id, members) } : {}),
    } : { members: [], history: [] };
  }
  complianceRoster(staff: WorkspaceStaff, emails: string[], forCompliance = false): VersionedBrokerageMember[] | null {
    if (this.#id !== demoBrokerageId) return null;
    const active = activeBrokerages(this.#store, staff.email, emails).find(({ id }) => id === staff.brokerage.id);
    return active && (forCompliance ? workspaceFeatures(active).compliance &&
      workspaceFeatures(active).revision === workspaceFeatures(staff.brokerage).revision : active.pilot) &&
      active.role === staff.brokerage.role && active.accessRevision === staff.brokerage.accessRevision
      ? brokerageMembers(this.#store, active.id, emails).filter(({ status }) => status === "Active") : null;
  }
  coverageRoster(staff: WorkspaceStaff, bootstrapEmails: string[], selected: string[] | null): VersionedBrokerageMember[] | null {
    if (this.#id !== demoBrokerageId) return null;
    const active = activeBrokerages(this.#store, staff.email, bootstrapEmails).find(({ id }) => id === staff.brokerage.id);
    if (!active || active.role !== staff.brokerage.role) return null;
    if (!selected) return active.role === "Admin" ? brokerageMembers(this.#store, active.id, bootstrapEmails) : null;
    if (selected.length > 2 || (selected.length && active.role !== "Admin" && !selected.includes(staff.email))) return null;
    return selected.length ? selectedActiveMembers(this.#store, active.id, selected, bootstrapEmails) : [];
  }
  loanReviewRoster(staff: WorkspaceStaff, bootstrapEmails: string[], selected: string[], includeAdmins: boolean): VersionedBrokerageMember[] | null {
    if (this.#id !== demoBrokerageId || selected.length > 5) return null;
    const membership = activeBrokerages(this.#store, staff.email, bootstrapEmails).find(({ id }) => id === staff.brokerage.id);
    return membership?.role === staff.brokerage.role ? selectedActiveMembers(this.#store, membership.id, selected, bootstrapEmails, includeAdmins) : null;
  }
  sampleClosingReviewer(id: string, email: string, bootstrapEmails: string[]): VersionedBrokerageMember | null {
    if (this.#id !== demoBrokerageId) return null;
    return selectedActiveMembers(this.#store, id, [email], bootstrapEmails).find(member => member.role === "Admin") ?? null;
  }
  campaignRoutingRoster(staff: WorkspaceStaff, bootstrapEmails: string[], selected: string[]): StaffIdentity[] | null {
    if (this.#id !== demoBrokerageId || selected.length > campaignRoutingOfficerLimit) return null;
    const membership = activeBrokerages(this.#store, staff.email, bootstrapEmails).find(({ id }) => id === staff.brokerage.id);
    if (!membership?.pilot || membership.role !== staff.brokerage.role || membership.role === "Processor") return null;
    return selectedActiveMembers(this.#store, membership.id, selected, bootstrapEmails)
      .filter(({ role }) => role !== "Processor").map(({ email, name }) => ({ email, name }));
  }
  async #campaignOptOutRoster(staff: WorkspaceStaff, plans: CampaignOptOutRoster["plans"]): Promise<CampaignOptOutRoster | undefined> {
    const selected = [...new Set(plans.flatMap(({ officers }) => officers))];
    const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    try {
      const members: StaffIdentity[] = [];
      for (let start = 0; start < selected.length; start += campaignRoutingOfficerLimit) {
        const batch = await directory.campaignRoutingRoster(staff, emails, selected.slice(start, start + campaignRoutingOfficerLimit));
        if (!batch) return;
        members.push(...batch);
      }
      return { plans, members };
    } catch {
      // Outreach preferences can still be saved if routing data is unavailable.
    }
  }
  fileExceptionRoster(staff: WorkspaceStaff, bootstrapEmails: string[], selected: string[]): VersionedBrokerageMember[] | null {
    if (this.#id !== demoBrokerageId || selected.length > 20) return null;
    const membership = activeBrokerages(this.#store, staff.email, bootstrapEmails).find(({ id }) => id === staff.brokerage.id);
    return membership?.role === "Admin" ? selectedActiveMembers(this.#store, membership.id, selected, bootstrapEmails) : null;
  }
  staffDepartureRoster(staff: WorkspaceStaff, emails: string[], subject: string, replacement?: string | null) {
    return this.#id === demoBrokerageId ? departureRoster(this.#store, staff, staff.brokerage.id, emails, subject, replacement) : null;
  }
  manage(staff: WorkspaceStaff, emails: string[], input: unknown) { return changeBrokerage(this.#store, staff.brokerage.id, staff, emails, input); }
  branches(staff: WorkspaceStaff) {
    return canManageBranches(staff, this.#id) ? { branches: readBranches(this.#store) } : { error: branchesUnavailable };
  }
  saveBranch(staff: WorkspaceStaff, input: unknown, roster: VersionedBrokerageMember[]) {
    return updateBranch(this.#store, input, staff, this.#id, roster);
  }
  audit(staff: WorkspaceStaff) {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") return [];
    const history = workspaceAccessHistory(this.#store);
    if (!staff.brokerage.pilot || !history.length) return history;
    const names = new Map(this.#store.prepare(`SELECT loan.id, contact.name FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
      WHERE loan.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(history.map(({ subject }) => subject)))
      .map(({ id, name }) => [String(id), String(name)]));
    return history.map((event) => ({ ...event, loanName: names.get(event.subject) }));
  }

  loanAssignments(input: unknown, staff: WorkspaceStaff) {
    if (!this.#accepts(staff)) return { error: loanAssignmentUnavailable };
    return this.#store.transaction(() => readLoanAssignments(this.#store, input, staff, this.#id));
  }
  reassign(staff: WorkspaceStaff, target: Parameters<typeof assignLoan>[2]) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." };
    return assignLoan(this.#store, staff, target);
  }
  shareProcessing(staff: WorkspaceStaff, target: Parameters<typeof assignProcessor>[2]) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return assignProcessor(this.#store, staff, target);
  }
  processorAssignmentReceipt(staff: WorkspaceStaff, loanId: string, requestId: string) {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") return null;
    return readProcessorAssignmentReceipt(this.#store, staff, loanId, requestId);
  }

  pilotReview(staff: WorkspaceStaff) {
    return this.#accepts(staff) && staff.brokerage.pilot && staff.brokerage.role === "Admin" ? pilotReview(this.#store) : {};
  }
  async loadPilot(staff: WorkspaceStaff, input: unknown, owner: StaffIdentity) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    const result = await loadProtectedPilotScenario(this.#store, staff, input, owner, this.#protectPilotLinks);
    if ("message" in result) await this.#scheduleCleanup();
    return result;
  }
  loadExploration(staff: WorkspaceStaff, input: unknown, members: Parameters<typeof loadExplorationExamples>[3]) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return loadExplorationExamples(this.#store, staff, input, members);
  }
  loanScenarios(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return loanScenarioWork(this.#store, input, staff, this.#id);
  }
  incomeWorksheet(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return incomeWorksheetWork(this.#store, input, staff, this.#id);
  }
  preapprovalLetters(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return workOnPreapprovalLetters(this.#store, input, staff, this.#id);
  }
  sharedPreapproval(input: unknown) {
    return sharedPreapprovalDownload(this.#store, input);
  }
  staffRealtorFinancing(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: realtorFinancingUnavailable, status: 404 };
    return workOnRealtorFinancing(this.#store, input, staff, this.#id);
  }
  borrowerRealtorFinancing(input: unknown) {
    return borrowerRealtorFinancing(this.#store, input);
  }

  lenderPackages(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return lenderShareWork(this.#store, input, staff, this.#id, this.#protectPilotLinks);
  }

  sharedLenderPackage(input: SharedLenderPackageInput) {
    return lenderPackageAccess(this.#store, input);
  }

  confirmLenderPackagePdf(input: PackageDownloadInput, objectId: string) {
    return confirmLenderPackagePdf(this.#store, input, objectId);
  }
  partnerEventApproval(id: string, email: string, revision: number, bootstrapEmails: string[]) {
    if (!this.brokerageDetails(id)?.pilot) return { accessCurrent: false, maintenanceRevision: null };
    const state = maintenanceState(this.#store, id);
    const [member] = selectedActiveMembers(this.#store, id, [email], bootstrapEmails);
    return { accessCurrent: member?.role === "Admin" && member.accessRevision === revision,
      maintenanceRevision: state.mode === "Open" ? state.revision : null };
  }

  async partnerEventPage(key: { brokerage: string; grantId: string; secretHash: string }, params: string): Promise<SandboxEventResult> {
    if (this.#id !== key.brokerage || this.#id === demoBrokerageId) return { status: 401 };
    const authority = sandboxEventAuthority(this.#store, key);
    if (!authority) return { status: 401 };
    const directory = this.env.WORKSPACE.getByName(demoBrokerageId);
    const { email, accessRevision } = authority.approval;
    const state = await directory.partnerEventApproval(this.#id, email, accessRevision, [...(googleSettings(this.env)?.allowedEmails ?? [])]);
    return serveSandboxEvents(this.#store, key, params, { ...state, approval: authority.approval, credentialId: authority.credential.id });
  }

  async partnerAccess(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") return { error: "Workspace access denied." };
    const directory = this.env.WORKSPACE.getByName(demoBrokerageId);
    const query = partnerAccessQuery.safeParse(input);
    if (!query.success) return { error: "Choose a valid partner permission action." };
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    const state = query.data.type === "issueEventCredential" && staff.brokerage.pilot ?
      await directory.maintenanceStateFor(this.#id) : null;
    const members = await directory.teamMembers(staff, emails);
    return members ? partnerAccessWork(this.#store, staff, query.data, members, new Date().toISOString(),
      state?.mode === "Open" ? state.revision : null) : { error: "Refresh your brokerage access before managing partner permissions." };
  }

  automationBatches(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." };
    return automationBatchWork(this.#store, staff, input);
  }

  automationDestinations(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." };
    return automationDestinationWork(this.#store, staff, input);
  }

  automationExceptions(staff: WorkspaceStaff, input: unknown) {
    return readDeliveryExceptions(this.#store, input, staff, this.#id);
  }

  automationEvents(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." };
    return automationEventWork(this.#store, staff, input);
  }

  staffFirstDay(staff: WorkspaceStaff, update?: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." };
    return update === undefined ? readStaffFirstDay(this.#store, staff) : updateStaffFirstDay(this.#store, staff, update);
  }

  pilotFeedback(staff: WorkspaceStaff, input: unknown, active: { email: string; name: string; role: string }[] = []) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    if (input && typeof input === "object" && "type" in input && input.type === "readPilotSupportRequests") {
      return readPilotSupportRequests(this.#store, staff, input, active);
    }
    const admin = active.find(member => member.role === "Admin" && member.email === staff.email) ??
      active.find(member => member.role === "Admin");
    return savePilotFeedback(this.#store, staff, input, admin?.email ?? null);
  }
  pilotSupportAccess(staff: WorkspaceStaff, input: PilotSupportAccessInput, active: VersionedBrokerageMember[]): PilotSupportAccessResult {
    if (!this.#accepts(staff)) return { error: "Workspace access denied.", status: 403 };
    return pilotSupportAccess(this.#store, staff, input, active);
  }
  pilotTriage(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return triagePilotFeedback(this.#store, staff, input);
  }
  pilotMeasurement(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return recordPilotMeasurement(this.#store, staff, input);
  }
  async #reviewerForSampleSignature(input: unknown, type: string, fictional: boolean): Promise<VersionedBrokerageMember | null> {
    if (!fictional || !input || typeof input !== "object" || !("type" in input) || input.type !== type ||
      !("response" in input) || input.response !== "Signed") return null;
    const reviewer = currentClosingGatePolicy(this.#store).rules.changedPackageReviewer;
    if (!reviewer) return null;
    const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
    try { return await directory.sampleClosingReviewer(this.#id, reviewer, [...(googleSettings(this.env)?.allowedEmails ?? [])]); }
    catch { return null; }
  }
  async borrower(input: unknown, pilot = false) {
    const fictional = pilot || this.#id === demoBrokerageId;
    const reviewer = await this.#reviewerForSampleSignature(input, "respondToSampleDisclosure", fictional);
    return borrowerCommandResult(this.#store, input,
      fictional || runtimeSetting(this.env, "ORBIT_DOCUMENT_UPLOADS") !== "enabled", pilot, fictional,
      (loanId, at) => routeChangedClosingReview(this.#store, loanId, this.#id, reviewer, at));
  }
  async coBorrower(input: unknown, pilot = this.#id !== demoBrokerageId) {
    const fictional = pilot || this.#id === demoBrokerageId;
    const reviewer = await this.#reviewerForSampleSignature(input, "respondToSampleDisclosure", fictional);
    return coBorrowerCommandResult(this.#store, input, pilot, undefined, fictional,
      (loanId, at) => routeChangedClosingReview(this.#store, loanId, this.#id, reviewer, at));
  }
  async #resolveLeadOwner(email: string | null, emails: string[], adminEmail?: string) {
    if (!email) return null;
    return this.#id === demoBrokerageId ? this.leadOwner(this.#id, email, emails, adminEmail)
      : await this.env.WORKSPACE.getByName(demoBrokerageId).leadOwner(this.#id, email, emails, adminEmail);
  }
  async realtor(input: unknown, pilot = false, emails: string[] = []) {
    if (!input || typeof input !== "object" || !("type" in input) || input.type !== "submit") {
      return realtorReferrals(this.#store, input, undefined, pilot);
    }
    const routing = leadRouting(this.#store);
    let target = routing.realtorRoute === "Assigned officer" ? routing.realtorOwner : null;
    let linkRevision: number | undefined;
    if (routing.realtorRoute === "Link owner") {
      if (!googleSettings(this.env) || !("token" in input) || typeof input.token !== "string") return realtorReferrals(this.#store, input, undefined, pilot);
      const portal = this.#store.prepare("SELECT officerEmail, revision FROM realtor_portals WHERE token = ?").get(input.token);
      target = typeof portal?.officerEmail === "string" ? portal.officerEmail : null;
      linkRevision = typeof portal?.revision === "number" ? portal.revision : undefined;
    }
    const owner = await this.#resolveLeadOwner(target, emails);
    return realtorReferrals(this.#store, input, undefined, pilot, { revision: routing.revision, linkRevision, owner });
  }
  async quoteLead(input: unknown, emails: string[]) {
    const parsed = quoteLeadInput.safeParse(input);
    if (!parsed.success) return receiveQuoteLead(this.#store, input);
    const snapshot = quoteIntakeRouting(this.#store, parsed.data.purpose, parsed.data.zip);
    let members: VersionedBrokerageMember[] = [];
    if (snapshot.routing.quoteToken === parsed.data.token && snapshot.form.revision === parsed.data.formRevision) {
      const campaign = parsed.data.phone && snapshot.campaign?.enabled ? snapshot.campaign.officers.map(({ email }) => email) : [];
      const selected = [...new Set([snapshot.ownerEmail, snapshot.branch?.ownerEmail, ...campaign])]
        .filter((email): email is string => typeof email === "string");
      if (selected.length) {
        const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
        try { members = await directory.quoteIntakeRoster(this.#id, selected, emails); }
        catch { /* Directory unavailability leaves the lead in the shared queue. */ }
      }
    }
    return receiveQuoteLead(this.#store, input, snapshot, members);
  }
  async quoteIntakeSettings(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") return { error: "Workspace access denied." } as const;
    const parsed = quoteIntakeSettingsRequest.safeParse(input);
    let members: VersionedBrokerageMember[] = [];
    let previewBranchRevision: number | null | undefined;
    if (parsed.success && (parsed.data.type === "publish" || parsed.data.type === "previewRoute")) {
      const { data } = parsed;
      const preview = data.type === "previewRoute" ? quoteRoutingForForm(this.#store, data, data.zip) : undefined;
      if (preview) previewBranchRevision = preview.managedBranch?.revision ?? null;
      const selected = preview ? [...new Set([preview.ownerEmail, preview.branch?.ownerEmail])]
        .filter((email): email is string => typeof email === "string") : quoteConfiguredOwners(data.config);
      if (selected.length) {
        const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
        const directory = this.#id === demoBrokerageId ? this : this.env.WORKSPACE.getByName(demoBrokerageId);
        members = await directory.quoteIntakeRoster(this.#id, selected, emails, staff.email);
      }
    }
    return workOnQuoteSettings(this.#store, input, staff, this.#id, undefined, members, previewBranchRevision);
  }

  documentTemplates(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return documentTemplateWork(this.#store, input, staff, this.#id);
  }

  feeTemplates(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return feeTemplateWork(this.#store, input, staff, this.#id);
  }

  reserveAddressLookup(token: string) {
    return reserveAddressLookup(this.#store, token);
  }

  startGoogle(...args: Parameters<StaffAuthStore["startGoogle"]>) { return this.#auth.startGoogle(...args); }
  consumeGoogle(...args: Parameters<StaffAuthStore["consumeGoogle"]>) { return this.#auth.consumeGoogle(...args); }
  createStaffSession(...args: Parameters<StaffAuthStore["createStaffSession"]>) { return this.#auth.createStaffSession(...args); }
  getStaffSession(...args: Parameters<StaffAuthStore["getStaffSession"]>) { return this.#auth.getStaffSession(...args); }
  removeStaffSession(...args: Parameters<StaffAuthStore["removeStaffSession"]>) { return this.#auth.removeStaffSession(...args); }
}

const portalHash = (token: string) => createHash("sha256").update(token).digest("hex");

async function authorized(header: string | null, password: string) {
  if (!header || !header.startsWith("Basic ") || header.length > 200) return false;
  const encoder = new TextEncoder();
  const expected = `Basic ${btoa(`orbit:${password}`)}`;
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(header)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash));
}

guardWorkspaceMethods(OrbitWorkspace.prototype, instance => maintenanceGates.get(instance) ?? null,
  new Set(["authorizedWorkspaceRestore","saveWorkspaceRestoreOutcome","applyWorkspaceRestore","workspaceRestore","mayCaptureCheckpoint","captureWorkspaceCheckpoint","workspaceCheckpoints","maintenanceStateFor","maintenanceFence","mayPrepareMaintenanceReopen","prepareMaintenanceReopen","manageWorkspaceMaintenance","mayInspectMaintenance","inspectWorkspaceMaintenance","readMaintenanceDecisions","saveMaintenanceDecision","readWorkspaceRecoveryEdits","inspectWorkspaceRecoveryEdits","confirmWorkspaceRecoveryEdit","authorizedRecoveryReplay","recoverWorkspaceEdit","applyWorkspaceRecoveryReplay","pilotSupportSnapshot"]));

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.hostname === "orbitlos.com" && url.protocol !== "https:") {
      url.protocol = "https:";
      return Response.redirect(url, 308);
    }
    const reading = request.method === "GET" || request.method === "HEAD";
    const marketingPage = /^\/(?:product\/?|integrations\/?|demo\/?|address-lookup\/?)?$/.test(url.pathname);
    if (reading && (/^\/marketing\/(?:pipeline|playbooks|borrower-application|quote-comparison|conditions|social-preview)\.png$/.test(url.pathname) ||
      url.pathname === "/fonts/InterVariable.woff2" || url.pathname === "/fonts/OFL-Inter.txt")) {
      return env.ASSETS.fetch(request);
    }
    const publicIcon = url.pathname === "/icon.svg";
    // Public documents render independently of the workspace and sign-in.
    // Forward only the URL and method so routing and action headers cannot
    // change the destination of a public request.
    if (reading && (marketingPage || publicIcon || url.pathname === "/api/zip-city-state")) {
      return app.fetch(new Request(url, { method: request.method }), env, context);
    }
    // Build assets are shared by the public site and the workspace.
    // The build also applies its prefix to the public font URL in CSS.
    if (reading && /^\/_orbit-assets\/[a-f0-9]{12}\/_next\/static\/fonts\/InterVariable\.woff2$/.test(url.pathname)) {
      return env.ASSETS.fetch(new Request(new URL("/fonts/InterVariable.woff2", url), request));
    }
    if (reading && /^(?:\/_orbit-assets\/[a-f0-9]{12})?\/_next\/static\/(?:chunks\/[\w-]+\.js|css\/[\w-]+\.css)$/.test(url.pathname)) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status < 400) return asset;
      const failure = new Response(asset.body, asset);
      failure.headers.set("Cache-Control", "no-store");
      return failure;
    }
    const preparingDrain = runtimeSetting(env, "ORBIT_DRAIN_ROLLOUT") === "prepare";
    if (url.pathname === directorySignInResetPath) {
      if (preparingDrain) return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
      return directorySignInResetHttp(request, env.DOCUMENTS, runtimeSetting(env, "ORBIT_DEPLOYMENT") || "fixture",
        () => env.WORKSPACE.getByName(directoryDrainObject).directoryWorkCounts(),
        () => env.WORKSPACE.getByName(demoBrokerageId).reviewDirectorySignInReset(),
        intent => env.WORKSPACE.getByName(demoBrokerageId).applyDirectorySignInReset(intent));
    }
    if (url.pathname === directoryRepairPath) {
      if (preparingDrain) return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
      return directoryRepairHttp(request, env.DOCUMENTS, runtimeSetting(env, "ORBIT_DEPLOYMENT") || "fixture",
        () => env.WORKSPACE.getByName(directoryDrainObject).directoryWorkCounts(),
        evidence => env.WORKSPACE.getByName(demoBrokerageId).reviewDirectoryRepair(evidence),
        intent => env.WORKSPACE.getByName(demoBrokerageId).commitDirectoryRepair(intent));
    }
    if (url.pathname === directoryRecoveryHoldPath) {
      if (preparingDrain) return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
      return directoryRecoveryHoldHttp(request, env.DOCUMENTS, runtimeSetting(env, "ORBIT_DEPLOYMENT") || "fixture",
        () => env.WORKSPACE.getByName(directoryDrainObject).directoryWorkCounts(),
        (evidence, brokerageId) => env.WORKSPACE.getByName(demoBrokerageId).reviewDirectoryRecoveryHold(evidence, brokerageId),
        (intent, prior) => env.WORKSPACE.getByName(demoBrokerageId).commitDirectoryRecoveryHold(intent, prior));
    }
    if (url.pathname === directoryEvidencePath) {
      if (preparingDrain) return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
      return directoryEvidenceHttp(request, env.DOCUMENTS, runtimeSetting(env, "ORBIT_DEPLOYMENT") || "fixture",
        () => env.WORKSPACE.getByName(directoryDrainObject).directoryWorkCounts(),
        () => env.WORKSPACE.getByName(demoBrokerageId).inspectDirectoryEvidence());
    }
    if (url.pathname === directoryDrainPath) {
      if (preparingDrain) return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
      return directoryDrainStatus(request, env.DOCUMENTS,
        () => env.WORKSPACE.getByName(directoryDrainObject).directoryWorkCounts());
    }
    if (preparingDrain) {
      return await directoryTrafficPaused(env.DOCUMENTS)
        ? directoryPauseResponse(request) : handleWorkspaceTraffic(request, env, context, url, reading);
    }
    const end = await startDirectoryWork(env.WORKSPACE, "http");
    if (!end) return directoryPauseResponse(request);
    return trackDirectoryResponse(context, end, tracked => handleWorkspaceTraffic(request, env, tracked, url, reading));
  },
} satisfies ExportedHandler<Cloudflare.Env>;

async function handleWorkspaceTraffic(request: Request, env: Cloudflare.Env, context: ExecutionContext, url: URL, reading: boolean) {
    const filesEnv = env as Cloudflare.Env & DocumentEnvironment;
    if (url.pathname.startsWith("/api/webhooks/uwm/")) {
      return uwmWebhookHttp(request, runtimeSetting(env, "UWM_WEBHOOK_CONFIG"),
        (_brokerageId, event) => env.WORKSPACE.getByName(demoBrokerageId).routeUwmWebhook(event), runtimeSetting(env, "ORBIT_DEPLOYMENT"));
    }
    if (url.pathname === "/api/demo-request") return demoRequest(request, env);
    const google = googleSettings(env);
    const demoPassword = runtimeSetting(env, "DEMO_PASSWORD");
    if (!google && !demoPassword) {
      return new Response("Orbit demo is being configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const directory = env.WORKSPACE.getByName(demoBrokerageId);
    const bootstrapEmails = [...(google?.allowedEmails ?? [])];
    if (url.pathname === "/api/sandbox/v1/events") return sandboxEventsHttp(request, url, async (key, params) => {
      const workspace = google && await directory.brokerageDetails(key.brokerage);
      if (!workspace || !workspace.pilot) return { status: 401 };
      if (workspace.maintenance) return { status: 403 };
      return env.WORKSPACE.getByName(key.brokerage).partnerEventPage(key, params);
    });
    async function linkedWorkspace(input: unknown) {
      const token = input && typeof input === "object" && "token" in input ? input.token : input;
      const id = portalBrokerage(token);
      if (!id) return null;
      const details = id === demoBrokerageId ? { pilot: false } : await directory.brokerageForPortal(token);
      if (details && "maintenance" in details && details.maintenance) throw new Error(maintenanceMessage);
      return details ? { id, pilot: details.pilot, store: env.WORKSPACE.getByName(id) } : null;
    }
    const uploads = google ? uploadSettings(filesEnv, url) : null;
    async function uploadWorkspace(token: string) {
      const link = await linkedWorkspace(token);
      return link && documentUploadMode(uploads?.mode, link.id, link.pilot) ? link : null;
    }
    if (request.method === "POST" && url.pathname === "/api/borrower-documents/verify") {
      return verifyBorrowerEmail(request, uploads, async (token) => (await uploadWorkspace(token))?.store ?? null);
    }
    if (request.method === "POST" && url.pathname === "/api/borrower-documents/upload") {
      try { return await uploadBorrowerPdf(request, uploads, uploadWorkspace); }
      catch { return fileProblem(503, "Orbit could not process this PDF. Try again shortly."); }
    }
    if (request.method === "POST" && url.pathname === "/api/shared-lead-documents") {
      return leadDocumentPortalHttp(request, uploads, async (token) => {
        const link = await linkedWorkspace(token);
        if (!link?.pilot) return null;
        return { id: link.id, store: {
          read: (input) => link.store.leadDocumentPortal(input),
          beginUpload: (input) => link.store.beginLeadSample(input),
          finishUpload: (input, objectId) => link.store.finishLeadSample(input, objectId),
          failUpload: (requestId, objectId) => link.store.failLeadSample(requestId, objectId),
        } };
      });
    }
    const placesKey = runtimeSetting(env, "GOOGLE_PLACES_API_KEY").trim();
    // This endpoint can reach only the token-scoped borrower command.
    if (request.method === "POST" && url.pathname === "/api/demo-application") {
      return borrowerHttp(request, async (input) => {
        const link = await linkedWorkspace(input);
        if (!link) return { status: 404, error: "This application link is invalid or expired." };
        const result = await link.store.borrower(input, link.pilot);
        return { ...result, uploadsMode: documentUploadMode(uploads?.mode, link.id, link.pilot) };
      }, Boolean(placesKey));
    }
    if (request.method === "POST" && url.pathname === "/api/joint-application") {
      return borrowerJson(request, async (input) => {
        const link = await linkedWorkspace(input);
        if (!link || (!link.pilot && link.id !== demoBrokerageId)) return { status: 404, error: jointLinkUnavailable };
        const result = await link.store.coBorrower(input, link.pilot);
        return "value" in result && documentUploadMode(uploads?.mode, link.id, link.pilot) === "mock"
          ? { value: { ...result.value, documentUploadsMode: "mock" as const } } : result;
      }, 262_144);
    }
    if (request.method === "POST" && url.pathname === "/api/demo-address") {
      return placesHttp(request, placesKey, async (token) => (await linkedWorkspace(token))?.store.reserveAddressLookup(token) ?? 404);
    }
    if (request.method === "POST" && url.pathname === "/api/realtor-referrals") {
      return realtorHttp(request, async (input) => {
        const link = await linkedWorkspace(input);
        return link ? link.store.realtor(input, link.pilot, bootstrapEmails) : { status: 404, error: "This referral link is invalid or expired." };
      });
    }
    if (request.method === "POST" && url.pathname === "/api/shared-preapproval") {
      return borrowerJson(request, async (input) => {
        const link = await linkedWorkspace(input);
        return link && (link.pilot || link.id === demoBrokerageId) ? link.store.sharedPreapproval(input) :
          { status: 404, error: sharedPreapprovalUnavailable };
      }, 1024);
    }
    if (request.method === "POST" && url.pathname === "/api/realtor-financing-permission") {
      return borrowerJson(request, async input => {
        const link = await linkedWorkspace(input);
        return link?.pilot ? link.store.borrowerRealtorFinancing(input) : { status: 404, error: realtorFinancingUnavailable };
      }, 1024);
    }
    if (request.method === "POST" && url.pathname === "/api/quote-requests") {
      return borrowerJson(request, async (input) => {
        const link = await linkedWorkspace(input);
        return link && (link.pilot || link.id === demoBrokerageId) ? link.store.quoteLead(input, bootstrapEmails)
          : { status: 404, error: "This quote request link is unavailable." };
      }, 4096);
    }
    if (request.method === "POST" && url.pathname === "/api/shared-lender-package") {
      return sharedLenderPackageHttp(request, async (token) => {
        const link = await linkedWorkspace(token);
        if (!link?.pilot) return null;
        return {
          id: link.id, read: (input) => link.store.sharedLenderPackage(input),
          confirmPdf: (input, objectId) => link.store.confirmLenderPackagePdf(input, objectId),
        };
      }, filesEnv.DOCUMENTS);
    }
    const tokenPage = reading && ["/apply", "/co-borrower", "/referrals", "/quote", "/lender-package", "/lead-documents"].includes(url.pathname);
    if (google && ["/login", "/auth/google", "/auth/google/callback", "/auth/email/request", "/auth/email/verify", "/auth/logout"].includes(url.pathname)) {
      const emailAuth: StaffEmailAuth | undefined = env.STAFF_EMAIL && env.DEMO_RATE_LIMIT ? {
        reserve: (...args) => directory.reserveStaffEmail(...args),
        consume: (...args) => directory.consumeStaffEmail(...args),
        allowRequest: async () => (await env.DEMO_RATE_LIMIT.limit({ key: `staff-email:${request.headers.get("CF-Connecting-IP") ?? "local"}` })).success,
        send: (email, code) => context.waitUntil(env.STAFF_EMAIL.send({
          to: email, from: { email: "login@orbitlos.com", name: "OrbitLOS" }, subject: "Your OrbitLOS sign-in code",
          text: `Your OrbitLOS sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn’t request this code, you can ignore this email.`,
        }).catch(() => console.error("OrbitLOS staff sign-in email delivery failed"))),
      } : undefined;
      return handleStaffAuth(request, url, google, directory, (staff) => directory.activateStaff(staff, bootstrapEmails), emailAuth);
    }
    let staff: WorkspaceStaff | null = null;
    let brokerages: WorkspaceStaff["brokerage"][] = [];
    let workspacePreference: string | null = null;
    if (!tokenPage) {
      if (google) {
        const requested = url.searchParams.get("brokerage");
        const openingWorkspace = reading && url.pathname === "/workspace";
        const workspaceTarget = openingWorkspace && requested && brokerageIdPattern.test(requested) ? requested : null;
        const guide = openingWorkspace ? workspaceGuide(url.searchParams.get("guide")) : null;
        const dailyEntry = openingWorkspace && !guide;
        const fetchMode = request.headers.get("Sec-Fetch-Mode");
        const workspaceNavigation = dailyEntry && request.method === "GET" &&
          (fetchMode === "navigate" || (fetchMode === null && request.headers.get("Accept")?.includes("text/html"))) &&
          !request.headers.has("RSC") && !request.headers.has("Next-Router-Prefetch") &&
          !(request.headers.get("Sec-Purpose") ?? "").includes("prefetch");
        const chooseWorkspace = workspaceNavigation && request.headers.get("Sec-Fetch-Site") !== "cross-site" &&
          (fetchMode === null || request.headers.get("Sec-Fetch-User") === "?1");
        const login = () => new Response(null, { status: 303, headers: { Location: staffLoginUrl(workspaceTarget, undefined, guide), "Cache-Control": "no-store" } });
        try {
          const tokenHash = await staffSessionHash(request, google);
          const access = tokenHash ? await directory.staffSessionAccess(tokenHash, Date.now(), bootstrapEmails) : null;
          if (access && tokenHash) {
            const { identity, preferredWorkspace } = access;
            brokerages = access.brokerages;
            workspacePreference = preferredWorkspace;
            const available = url.searchParams.get("available") === "1";
            const savedChoice = dailyEntry && requested === null
              ? preferredWorkspace ?? await rememberedStaffWorkspace(request, identity.email) : null;
            const remembered = available || brokerages.some((item) => item.id === savedChoice && !workspaceCanBeDefault(item)) ? null : savedChoice;
            const choice = requested ?? remembered;
            const brokerage = choice !== null ? brokerages.find((entry) => entry.id === choice && !releaseWorkspaceClosed(entry)) :
              dailyEntry ? defaultWorkspace(brokerages, runtimeSetting(env, "UWM_BROKERAGE_ID")) :
                brokerages.find((entry) => workspaceCanBeDefault(entry) && !entry.maintenance) ?? defaultWorkspace(brokerages);
            if (choice !== null && !brokerage && (brokerages.length || openingWorkspace)) {
              if (workspaceTarget && await directory.staffInvitedTo(workspaceTarget, identity.email)) return login();
              if (openingWorkspace && brokerages.some(item => item.id === choice && releaseWorkspaceClosed(item))) {
                return closedReleaseWorkspacePage();
              }
              if (openingWorkspace) return workspaceAccessDenied(workspaceTarget, guide, Boolean(remembered));
              return new Response("You don’t have access to this brokerage.", { status: 403, headers: { "Cache-Control": "no-store" } });
            }
            if (brokerage) staff = { ...identity, brokerage };
            if (staff && requested === null && openingWorkspace && (dailyEntry || staff.brokerage.id !== demoBrokerageId)) {
              const recoverWorkspace = chooseWorkspace && available && savedChoice !== null &&
                !brokerages.some(({ id }) => id === savedChoice);
              const establishWorkspace = !available && !preferredWorkspace && (remembered ? chooseWorkspace : workspaceNavigation);
              if (recoverWorkspace || establishWorkspace) {
                const saved = await directory.rememberStaffWorkspace(tokenHash, Date.now(), bootstrapEmails, staff.brokerage.id, available);
                if (!saved) return login();
                if (establishWorkspace) {
                  // A concurrent switch can win the insert. Open the saved choice in that case.
                  const current = await directory.staffSessionAccess(tokenHash, Date.now(), bootstrapEmails);
                  if (!current) return login();
                  const selected = current.brokerages.find(({ id }) => id === current.preferredWorkspace);
                  if (!selected) return workspaceAccessDenied(null, guide, true);
                  staff.brokerage = selected;
                }
              }
              const headers = new Headers({ Location: brokerageUrl(staff.brokerage.id, guide), "Cache-Control": "no-store" });
              if (recoverWorkspace || establishWorkspace || (chooseWorkspace && !available)) {
                headers.set("Set-Cookie", await staffWorkspaceCookie(staff.email, staff.brokerage.id));
              }
              return new Response(null, { status: 303, headers });
            }
            const makeDefault = url.searchParams.get("default") === "1";
            const switchFromTeam = url.searchParams.get("switch") === "1";
            if (staff && workspaceTarget && chooseWorkspace && (makeDefault || switchFromTeam)) {
              const headers = new Headers({ Location: brokerageUrl(staff.brokerage.id), "Cache-Control": "no-store" });
              // Older open Team pages may still use switch=1 for a visit to a sample workspace.
              if (workspaceCanBeDefault(staff.brokerage) && (makeDefault || (!staff.brokerage.pilot && staff.brokerage.id !== demoBrokerageId))) {
                const saved = await directory.rememberStaffWorkspace(tokenHash, Date.now(), bootstrapEmails, staff.brokerage.id, true);
                if (!saved) return login();
                headers.set("Set-Cookie", await staffWorkspaceCookie(staff.email, staff.brokerage.id));
              }
              return new Response(null, { status: 303, headers });
            }
          }
        }
        catch (error) {
          const reason = error instanceof Error ? error.message.replace(/[^\s]+@[^\s]+|[\w-]{24,}/g, "[redacted]").slice(0, 300) : "Unknown error";
          console.error("Orbit staff session lookup failed", reason);
          return new Response("Orbit sign-in is temporarily unavailable.", { status: 503, headers: { "Cache-Control": "no-store" } });
        }
        if (!staff) {
          if (reading) return login();
          return new Response(staffSignInRequired, { status: 401, headers: { "Cache-Control": "no-store" } });
        }
      } else if (!(await authorized(request.headers.get("Authorization"), demoPassword))) {
        return new Response("Enter the Orbit demo username and password.", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="Orbit Demo", charset="UTF-8"', "Cache-Control": "no-store" },
        });
      } else if (url.searchParams.has("brokerage") && url.searchParams.get("brokerage") !== demoBrokerageId) {
        return new Response("Google staff sign-in is required for this brokerage.", { status: 403, headers: { "Cache-Control": "no-store" } });
      }
    }
    if (!reading && request.headers.get("Origin") !== url.origin) {
      return new Response("This action must come from Orbit.", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/api/workspace-maintenance") {
      const headers={"Cache-Control":"private, no-store"};
      if (!staff) return Response.json({error:"Sign in to your brokerage first."},{status:403,headers});
      const identity=staff;
      if (url.searchParams.get("support") === "1") {
        const denied = () => Response.json({ error: "Only an active pilot admin can read this support report." }, { status: 403, headers });
        if (url.searchParams.get("brokerage") !== identity.brokerage.id || !identity.brokerage.pilot || identity.brokerage.role !== "Admin") return denied();
        if (url.searchParams.has("work")) {
          if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
          const group = supportWorkGroup(url.searchParams.get("work"));
          const fingerprint = z.string().regex(/^[a-f0-9]{64}$/).safeParse(url.searchParams.get("fingerprint"));
          if (!group || !fingerprint.success) return Response.json({ error: "Preview the report to open its work." }, { status: 400, headers });
          if (identity.brokerage.maintenance) return Response.json({ error: supportWorkPaused }, { status: 409, headers });
          try {
            const work = await env.WORKSPACE.getByName(identity.brokerage.id).pilotSupportWork(identity, group,
              supportWorkOffset(url.searchParams.get("offset")), fingerprint.data);
            return work ? Response.json(work, { status: "error" in work ? 409 : 200, headers }) : denied();
          } catch (failure) {
            return failure instanceof Error && failure.message.includes(maintenanceMessage)
              ? Response.json({ error: supportWorkPaused }, { status: 409, headers })
              : Response.json({ error: supportUnavailable }, { status: 503, headers });
          }
        }
        const capture = async (expected?: string) => {
          try {
            const snapshot = await env.WORKSPACE.getByName(identity.brokerage.id).pilotSupportSnapshot(identity);
            if (!snapshot) return denied();
            const fingerprint = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
            const checkedAt = new Date().toISOString();
            if (expected === undefined) return Response.json({ checkedAt, fingerprint, snapshot }, { headers });
            if (expected !== fingerprint) return Response.json({ error: supportChanged }, { status: 409, headers });
            const reference = crypto.randomUUID();
            const recovery = await directory.pilotSupportRecovery(identity, { reference, recovery: snapshot.recovery });
            if (!recovery) return denied();
            if (JSON.stringify(recovery) !== JSON.stringify(snapshot.recovery)) return Response.json({ error: supportChanged }, { status: 409, headers });
            return Response.json({ schemaVersion: 1, reference, checkedAt, snapshot }, {
              headers: { ...headers, "Content-Disposition": 'attachment; filename="orbit-pilot-support.json"' },
            });
          } catch {
            return Response.json({ error: supportUnavailable }, { status: 503, headers });
          }
        };
        if (request.method === "GET") return capture();
        if (request.method === "POST") return borrowerJson(request, async raw => {
          const parsed = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(raw);
          return parsed.success ? capture(parsed.data.fingerprint) : { status: 400, error: "Preview the report before downloading." };
        }, 1024);
        return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
      }
      if(request.method==="POST"&&url.searchParams.get("restore")==="1")return borrowerJson(request,async input=>{
        try{return {value:await directory.workspaceRestore(identity,input)};}
        catch(error){return {status:409,error:error instanceof Error?error.message:"Restore outcome unavailable. Check the saved request before retrying."};}
      },4096);
      if(request.method==="POST"&&url.searchParams.get("checkpoints")==="1")return borrowerJson(request,async input=>{
        try{return {value:await directory.workspaceCheckpoints(identity,input)};}
        catch(error){return {status:409,error:error instanceof Error?error.message:"Checkpoint review unavailable. Refresh workspace status."};}
      },4096);
      if(request.method==="GET"&&url.searchParams.get("edits")==="1") {
        const parsed=recoveryEditPage.safeParse({revision:Number(url.searchParams.get("revision")??-1),offset:Number(url.searchParams.get("offset")??0),
          pendingOnly:url.searchParams.get("pending") === "1"});
        if(!parsed.success)return Response.json({error:"Invalid edit inspection page."},{status:400,headers});
        try {return Response.json({inspection:await env.WORKSPACE.getByName(identity.brokerage.id).inspectWorkspaceRecoveryEdits(identity,parsed.data)},{headers});}
        catch{return Response.json({error:"Edit inspection unavailable. Pause the workspace and refresh its status."},{status:409,headers});}
      }
      if (request.method === "GET" && url.searchParams.get("inspect") === "1") {
        const parsed=maintenanceInspectionInput.safeParse({revision:Number(url.searchParams.get("revision") ?? -1),
          documents:Number(url.searchParams.get("documents") ?? 0), requests:Number(url.searchParams.get("requests") ?? 0)});
        if(!parsed.success)return Response.json({error:"Invalid inspection page."},{status:400,headers});
        if(!await directory.mayInspectMaintenance(identity,parsed.data.revision))
          return Response.json({error:"Inspection requires a current pilot admin and a paused workspace."},{status:403,headers});
        const value=await env.WORKSPACE.getByName(identity.brokerage.id).inspectWorkspaceMaintenance(identity,parsed.data);
        return Response.json(value,{status:"error" in value?409:200,headers});
      }
      if (request.method === "GET") {
        const value=await directory.manageWorkspaceMaintenance(identity);
        return Response.json(value,{status:"error" in value?403:200,headers});
      }
      if(request.method==="POST"&&url.searchParams.get("replay")==="1")return borrowerJson(request,async input=>{
        try{return {value:await directory.recoverWorkspaceEdit(identity,input)};}
        catch(error){return {status:409,error:error instanceof Error?error.message:"Recovery outcome unavailable. Refresh status and inspect pending recovery."};}
      },4096);
      if(request.method==="POST"&&url.searchParams.get("edits")==="1")return borrowerJson(request,async input=>{
        try{return {value:{view:await directory.confirmWorkspaceRecoveryEdit(identity,input)}};}
        catch(error){return {status:409,error:error instanceof Error?error.message:"Edit review failed. Refresh its inspection."};}
      },4096);
      if (request.method === "POST" && url.searchParams.get("decision") === "1") return borrowerJson(request,async input=>{
        const value=await directory.saveMaintenanceDecision(identity,input);
        return "error" in value?{status:409,error:value.error ?? "The maintenance decision could not be saved."}:{value};
      },4096);
      if (request.method === "POST") return borrowerJson(request,async input=>{
        const value=await directory.manageWorkspaceMaintenance(identity,input);
        return "error" in value ? {status:409,error:value.error} : {value};
      },4096);
      return new Response(null,{status:405,headers:{...headers,Allow:"GET, POST"}});
    }
    if (staff && url.pathname !== "/workspace-maintenance" && staff.brokerage.maintenance) {
      const alternate = defaultWorkspace(brokerages.filter((entry) => !entry.maintenance),
        runtimeSetting(env, "UWM_BROKERAGE_ID"));
      return reading && url.pathname === "/workspace" ? workspaceMaintenancePage(staff.brokerage, alternate?.id) :
        Response.json({error:maintenanceMessage},{status:503,headers:{"Cache-Control":"private, no-store","Retry-After":"60"}});
    }
    if (["/api/uwm-file", "/api/uwm-file/read"].includes(url.pathname)) {
      const headers = { "Cache-Control": "private, no-store" };
      if (!staff) return Response.json({ error: "Sign in to your brokerage first." }, { status: 403, headers });
      const workspace = env.WORKSPACE.getByName(staff.brokerage.id), identity = staff;
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
      return borrowerJson(request, async input => {
        const result = await workspace.uwmFile(identity, input, url.pathname.endsWith("/read"));
        return Response.json(result, { status: "error" in result ? 409 : 200, headers });
      }, url.pathname.endsWith("/read") ? 65536 : 9 * 1024 * 1024);
    }
    if (url.pathname === "/api/uwm-account") {
      const headers = { "Cache-Control": "private, no-store" };
      if (!staff) return Response.json({ error: "Sign in to your brokerage first." }, { status: 403, headers });
      const workspace = env.WORKSPACE.getByName(staff.brokerage.id);
      if (request.method === "GET") return Response.json(await workspace.uwmAccount(staff, { action: "status" }), { headers });
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
      const reader = request.body?.getReader();
      if (!reader) return Response.json({ error: "Missing request" }, { status: 400, headers });
      let body = "", bytes = 0;
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 4096) { await reader.cancel(); return Response.json({ error: "Request too large" }, { status: 413, headers }); }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
        const input = z.discriminatedUnion("action", [z.object({ action: z.literal("disconnect") }), z.object({ action: z.literal("verify") }),
          z.object({ action: z.literal("connect"), credentials: z.object({ username: z.string().max(254), password: z.string().max(1024) }) })]).parse(JSON.parse(body));
        const result = await workspace.uwmAccount(staff, input);
        return Response.json(result, { status: "error" in result ? 400 : 200, headers });
      } catch { return Response.json({ error: "UWM account request could not be completed." }, { status: 400, headers }); }
      finally { reader.releaseLock(); }
    }
    if (url.pathname === "/api/uwm-webhook-receipts") {
      const headers = { "Cache-Control": "private, no-store" };
      if (!staff || staff.brokerage.role !== "Admin") return Response.json({ error: "Admin access required" }, { status: 403, headers });
      const workspace = env.WORKSPACE.getByName(staff.brokerage.id);
      if (request.method === "POST" && url.searchParams.get("brokerage") === staff.brokerage.id) {
        const identity = staff;
        return borrowerJson(request, async (input) => {
          const parsed = z.strictObject({ receiptId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).safeParse(input);
          if (!parsed.success) return Response.json({ error: "Select an existing UWM receipt." }, { status: 400, headers });
          try {
            const result = await workspace.matchUwmReceipt(identity, parsed.data.receiptId);
            return Response.json(result, { status: "error" in result ? 409 : 200, headers });
          } catch {
            return Response.json({ error: "Orbit couldn’t confirm the match. Try this receipt again." }, { status: 503, headers });
          }
        }, 1024);
      }
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
      const before = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).safeParse(url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER);
      const receiptId = url.searchParams.has("receipt") ? z.coerce.number().int().positive().safeParse(url.searchParams.get("receipt")) : null;
      if (!before.success || (receiptId && !receiptId.success)) return Response.json({ error: "Invalid receipt cursor" }, { status: 400, headers });
      try {
        const receipts = await workspace.uwmWebhookReceipts(staff, before.data, receiptId?.data);
        return Response.json({ receipts }, { headers });
      } catch { return Response.json({ error: "Receipts unavailable" }, { status: 503, headers }); }
    }
    if (url.pathname === retentionExportPath) {
      const loan = retentionExportLoanId.safeParse(url.searchParams.get("loan"));
      if (request.method !== "POST") return new Response(null,{status:405,headers:{Allow:"POST","Cache-Control":"private, no-store"}});
      if (!staff?.brokerage.pilot || staff.brokerage.role !== "Admin" || !loan.success ||
        url.searchParams.get("brokerage") !== staff.brokerage.id) return fileProblem(404,"This retention export is unavailable.");
      const identity = staff;
      const workspace = env.WORKSPACE.getByName(identity.brokerage.id);
      try {
        const reviewed = await workspace.retentionExport(identity,loan.data);
        return await retentionExportResponse(filesEnv.DOCUMENTS,identity.brokerage.id,reviewed,async fingerprint => {
          const token = google && await staffSessionHash(request,google);
          const current = token && await directory.staffSessionAccess(token,Date.now(),bootstrapEmails);
          const access = current && current.identity.email === identity.email && current.brokerages.find(item=>item.id===identity.brokerage.id);
          return !!access && !access.maintenance && await workspace.confirmRetentionExport({...identity,brokerage:access},loan.data,fingerprint);
        });
      } catch {
        return fileProblem(503,"Orbit could not prepare this retention export. Try again shortly.");
      }
    }
    if (request.method === "GET" && url.pathname === "/api/documents/download") {
      const requestId = z.uuid().safeParse(url.searchParams.get("request"));
      const evidence = z.uuid().optional().safeParse(url.searchParams.get("evidence") ?? undefined);
      const revision = z.coerce.number().int().positive().optional().safeParse(url.searchParams.get("revision") ?? undefined);
      if (!staff || !filesEnv.DOCUMENTS || !requestId.success || !evidence.success || !revision.success ||
        (evidence.data && revision.data !== undefined)) return fileProblem(404, "This PDF is unavailable.");
      const workspace = env.WORKSPACE.getByName(staff.brokerage.id);
      try {
        const document = await workspace.downloadDocument(staff, requestId.data, evidence.data, revision.data);
        if (!document) return fileProblem(404, "This PDF is unavailable.");
        const object = await filesEnv.DOCUMENTS.get(documentKey(staff.brokerage.id, document.objectId));
        if (!object) return fileProblem(404, "This PDF is unavailable.");
        const access = (await directory.staffBrokerages(staff.email, bootstrapEmails)).find((item) => item.id === staff?.brokerage.id);
        if (!access || !await workspace.auditDocumentDownload({ ...staff, brokerage: access }, requestId.data, document.objectId, evidence.data, revision.data)) {
          await object.body.cancel();
          return fileProblem(404, "This PDF is unavailable.");
        }
        return privatePdf(object, staff.brokerage.id === demoBrokerageId || Boolean(staff.brokerage.pilot));
      } catch { return fileProblem(503, "Orbit could not retrieve this PDF. Try again shortly."); }
    }
    if (url.pathname === "/api/brokerages") {
      const headers = { "Cache-Control": "private, no-store" };
      if (!staff) return Response.json({ error: "Google staff sign-in is required." }, { status: 403, headers });
      const workspace = env.WORKSPACE.getByName(staff.brokerage.id);
      const view = url.searchParams.get("view");
      if (view === "realtor-financing") {
        if (!staff.brokerage.pilot || url.searchParams.get("brokerage") !== staff.brokerage.id) {
          return Response.json({ error: realtorFinancingUnavailable }, { status: 404, headers });
        }
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
        const identity = staff;
        return borrowerJson(request, input => workspace.staffRealtorFinancing(identity, input), 1536);
      }
      if (view === "pilot-support-access") {
        if (!staff.brokerage.pilot || url.searchParams.get("brokerage") !== staff.brokerage.id) {
          return Response.json({ error: "Open support access from your pilot workspace." }, { status: 403, headers });
        }
        const identity = staff;
        const run = async (input: unknown, write: boolean) => {
          const parsed = pilotSupportAccessInput.safeParse(input);
          if (!parsed.success || write === (parsed.data.type === "manage" || parsed.data.type === "mine")) {
            return Response.json({ error: "Choose a valid support access action." }, { status: 400, headers });
          }
          const active = await directory.complianceRoster(identity, bootstrapEmails);
          if (!active) return Response.json({ error: "Refresh Team to check your pilot access." }, { status: 403, headers });
          const result = await workspace.pilotSupportAccess(identity, parsed.data, active);
          return Response.json(result, { status: "error" in result ? result.status : 200, headers });
        };
        if (request.method === "GET") {
          const requestId = url.searchParams.get("requestId");
          return run(requestId === null ? { type: "mine" } : { type: "manage", requestId }, false);
        }
        if (request.method === "POST") return borrowerJson(request, input => run(input, true), 1536);
        return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
      }
      if (view === "partner-permissions") {
        if (staff.brokerage.role !== "Admin" || url.searchParams.get("brokerage") !== staff.brokerage.id) {
          return Response.json({ error: "Open partner permissions as an admin in this brokerage." }, { status: 403, headers });
        }
        if (request.method === "GET") {
          const id = url.searchParams.get("id"), cursor = url.searchParams.get("before");
          const before = cursor === null ? undefined : Number(cursor);
          const query = partnerAccessQuery.safeParse(id === null ? { type: "list", before } : { type: "detail", id, before });
          if (!query.success) return Response.json({ error: "Choose a valid grant view." }, { status: 400, headers });
          const result = await workspace.partnerAccess(staff, query.data);
          return Response.json(result, { status: "error" in result ? 404 : 200, headers });
        }
        if (request.method === "POST") return borrowerJson(request, async input => {
          const query = partnerAccessQuery.safeParse(input);
          if (!query.success || query.data.type === "list" || query.data.type === "detail") {
            return { status: 400, error: "Choose valid partner permission settings." };
          }
          const result = await workspace.partnerAccess(staff, query.data);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }, 2048);
        return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
      }
      if (view === "automation-batches") {
        if (staff.brokerage.role !== "Admin" || url.searchParams.get("brokerage") !== staff.brokerage.id) {
          return Response.json({ error: "Open automation batches as an admin in this brokerage." }, { status: 403, headers });
        }
        if (request.method === "GET") {
          const destinationId = url.searchParams.get("destinationId"), batchId = url.searchParams.get("batchId");
          const status = url.searchParams.get("status"), before = url.searchParams.get("before");
          const query = automationBatchQuery.safeParse(batchId !== null ? { type: "receipt", destinationId, batchId } :
            status !== null ? { type: "preview", destinationId, status } :
            { type: "history", destinationId, before: before === null ? undefined : Number(before) });
          if (!query.success) return Response.json({ error: "Choose a valid batch view." }, { status: 400, headers });
          const result = await workspace.automationBatches(staff, query.data);
          return Response.json(result, { status: "error" in result ? (query.data.type === "preview" ? 409 : 404) : 200, headers });
        }
        if (request.method === "POST") return borrowerJson(request, async input => {
          const query = automationBatchQuery.safeParse(input);
          if (!query.success || query.data.type !== "run") return { status: 400, error: "Choose a valid batch to run." };
          const result = await workspace.automationBatches(staff, query.data);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }, 1024);
        return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
      }
      if (view === "report-schedules") {
        if (staff.brokerage.role !== "Admin" || url.searchParams.get("brokerage") !== staff.brokerage.id) {
          return Response.json({ error: "Open report schedules as an admin in this brokerage." }, { status: 403, headers });
        }
        if (request.method === "GET") {
          const reportId = url.searchParams.get("reportId"), cursor = url.searchParams.get("before");
          const result = await workspace.reportSchedules(staff, url.searchParams.get("attention") === "1" ? { type: "attention" } :
            reportId ? { type: "history", reportId, before: cursor === null ? undefined : Number(cursor) } :
              { type: "list", archiveBefore: cursor === null ? undefined : Number(cursor) });
          return Response.json(result, { status: "error" in result ? 400 : 200, headers });
        }
        if (request.method === "POST") return borrowerJson(request, async input => {
          const parsed = reportScheduleQuery.safeParse(input);
          if (!parsed.success || parsed.data.type === "list" || parsed.data.type === "history" || parsed.data.type === "attention") {
            return { status: 400, error: "Check the report schedule settings." };
          }
          const result = await workspace.reportSchedules(staff, parsed.data);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }, 4096);
        return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
      }
      if (view === "automation-exceptions") {
        if (staff.brokerage.role !== "Admin" || url.searchParams.get("brokerage") !== staff.brokerage.id) {
          return Response.json({ error: "Open delivery exceptions as an admin in this brokerage." }, { status: 403, headers });
        }
        if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
        const sequence = url.searchParams.get("sequence");
        const destinationId = url.searchParams.get("destinationId");
        const query = deliveryExceptionQuery.safeParse({ view: url.searchParams.get("queue") ?? "attention",
          after: sequence === null && destinationId === null ? undefined : { sequence: Number(sequence), destinationId } });
        if (!query.success) return Response.json({ error: "Choose a valid delivery exception view." }, { status: 400, headers });
        const result = await workspace.automationExceptions(staff, query.data);
        return Response.json(result, { status: "error" in result ? 403 : 200, headers });
      }
      if (view === "automation-events" || view === "automation-destinations") {
        if (staff.brokerage.role !== "Admin" || url.searchParams.get("brokerage") !== staff.brokerage.id) {
          return Response.json({ error: "Open automation deliveries as an admin in this brokerage." }, { status: 403, headers });
        }
        if (view === "automation-destinations") {
          if (request.method === "GET") {
            const cursor = url.searchParams.get("before");
            const id = url.searchParams.get("id");
            const parsed = automationDestinationQuery.safeParse(id === null
              ? { type: "destinations", before: cursor === null ? undefined : Number(cursor) } : { type: "destination", id });
            if (!parsed.success) return Response.json({ error: "Refresh the destination list." }, { status: 400, headers });
            const result = await workspace.automationDestinations(staff, parsed.data);
            return Response.json(result, { status: "error" in result ? 404 : 200, headers });
          }
          if (request.method === "POST") return borrowerJson(request, async input => {
            const parsed = automationDestinationQuery.safeParse(input);
            if (!parsed.success || parsed.data.type === "destinations" || parsed.data.type === "destination") {
              return { status: 400, error: "Choose valid destination settings." };
            }
            const result = await workspace.automationDestinations(staff, parsed.data);
            return "error" in result ? { status: 409, error: result.error } : { value: result };
          }, 2048);
          return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
        }
        if (request.method === "GET") {
          const id = url.searchParams.get("id");
          const cursor = url.searchParams.get("before");
          const destinationId = url.searchParams.get("destinationId") ?? undefined;
          const parsed = automationEventQuery.safeParse(id === null ? {
            type: "list", status: url.searchParams.get("status") ?? undefined, eventType: url.searchParams.get("eventType") ?? undefined,
            before: cursor === null ? undefined : Number(cursor), destinationId, history: url.searchParams.get("history") ?? undefined,
          } : { type: "detail", id, destinationId });
          if (!parsed.success) return Response.json({ error: "Choose a valid event or queue filter." }, { status: 400, headers });
          const result = await workspace.automationEvents(staff, parsed.data);
          return Response.json(result, { status: "error" in result ? 404 : 200, headers });
        }
        if (request.method === "POST") return borrowerJson(request, async input => {
          const parsed = automationEventQuery.safeParse(input);
          if (!parsed.success || (parsed.data.type !== "attempt" && parsed.data.type !== "acknowledge")) {
            return { status: 400, error: "Choose a valid simulation or review action." };
          }
          const result = await workspace.automationEvents(staff, parsed.data);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }, 1024);
        return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
      }
      if (view === "staff-first-day") {
        if (url.searchParams.get("brokerage") !== staff.brokerage.id) {
          return Response.json({ error: "Open the checklist from your brokerage." }, { status: 403, headers });
        }
        if (request.method === "GET") {
          const result = await workspace.staffFirstDay(staff);
          return Response.json(result, { status: "error" in result ? 403 : 200, headers });
        }
        if (request.method === "POST") return borrowerJson(request, async input => {
          const parsed = setFirstDayStep.safeParse(input);
          if (!parsed.success) return { status: 400, error: "Choose a valid checklist step." };
          const result = await workspace.staffFirstDay(staff, parsed.data);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }, 1024);
        return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, POST" } });
      }
      if (request.method === "GET") {
        if (view === "pilot-support-requests") {
          if (!staff.brokerage.pilot || url.searchParams.get("brokerage") !== staff.brokerage.id) {
            return Response.json({ error: "Support requests are available in your pilot workspace." }, { status: 403, headers });
          }
          const active = await directory.complianceRoster(staff, bootstrapEmails);
          if (!active) return Response.json({ error: "Refresh Team to check your pilot access." }, { status: 403, headers });
          const result = await workspace.pilotFeedback(staff, {
            type: "readPilotSupportRequests", id: url.searchParams.get("id") ?? undefined, status: url.searchParams.get("status") ?? undefined,
            after: url.searchParams.has("afterId") || url.searchParams.has("afterCreatedAt") ?
              { id: url.searchParams.get("afterId"), createdAt: url.searchParams.get("afterCreatedAt") } : undefined,
          }, active);
          return Response.json(result, { status: "kind" in result ? 200 : 400, headers });
        }
        if (view === "processor-assignment-receipt") {
          if (url.searchParams.get("brokerage") !== staff.brokerage.id || staff.brokerage.role !== "Admin") {
            return Response.json({ error: loanAssignmentUnavailable }, { status: 403, headers });
          }
          const loanId = z.string().min(1).max(100).safeParse(url.searchParams.get("loanId"));
          const requestId = z.uuid().safeParse(url.searchParams.get("requestId"));
          if (!loanId.success || !requestId.success) return Response.json({ error: loanAssignmentUnavailable }, { status: 400, headers });
          const receipt = await workspace.processorAssignmentReceipt(staff, loanId.data, requestId.data);
          return receipt ? Response.json(receipt, { headers }) : Response.json({ error: loanAssignmentUnavailable }, { status: 403, headers });
        }
        if (view === "branches") {
          if (url.searchParams.get("brokerage") !== staff.brokerage.id) return Response.json({ error: branchesUnavailable }, { status: 403, headers });
          const result = await workspace.branches(staff);
          return Response.json(result, { status: "error" in result ? 403 : 200, headers });
        }
        if (view === "assignment-loans" || view === "loan-assignment") {
          if (staff.brokerage.role !== "Admin") return Response.json({ error: loanAssignmentUnavailable }, { status: 403, headers });
          const after = url.searchParams.has("afterId") || url.searchParams.has("afterStageSince") ?
            { id: url.searchParams.get("afterId"), stageSince: url.searchParams.get("afterStageSince") } : undefined;
          const input = view === "assignment-loans" ? { type: "list", search: url.searchParams.get("search") ?? "", after } :
            { type: "open", loanId: url.searchParams.get("loanId") };
          const result = await workspace.loanAssignments(input, staff);
          if ("error" in result) return Response.json(result, { status: 404, headers });
          if (result.kind === "list") return Response.json(result, { headers });
          const members = await directory.teamMembers(staff, bootstrapEmails);
          return members ? Response.json({ ...result, members: members.filter(({ status }) => status === "Active") }, { headers }) :
            Response.json({ error: loanAssignmentUnavailable }, { status: 403, headers });
        }
        if (view === "processors") {
          const members = await directory.teamMembers(staff, bootstrapEmails);
          return members ? Response.json({ members: members.filter((member) => member.role === "Processor" && member.status === "Active") }, { headers }) :
            Response.json({ error: "Only a brokerage admin can view the processor roster." }, { status: 403, headers });
        }
        const [team, localHistory, pilot] = await Promise.all([directory.team(staff, bootstrapEmails), workspace.audit(staff), workspace.pilotReview(staff)]);
        const history = [...team.history, ...localHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
        return Response.json({ ...team, brokerages, preferredWorkspace: workspacePreference, history, ...pilot }, { headers });
      }
      if (request.method === "POST") return borrowerJson<{ message?: string; created?: string } | DeparturePage>(request, async (input) => {
        if (input && typeof input === "object" && "type" in input && (input.type === "saveBranch" || input.type === "setBranchActive")) {
          if (url.searchParams.get("brokerage") !== staff.brokerage.id || !canManageBranches(staff, staff.brokerage.id)) {
            return { status: 403, error: branchesUnavailable };
          }
          const roster = await directory.teamMembers(staff, bootstrapEmails);
          if (!roster) return { status: 403, error: branchesUnavailable };
          const result = await workspace.saveBranch(staff, input, roster);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }
        if (input && typeof input === "object" && "type" in input && typeof input.type === "string" && input.type.startsWith("offboarding")) {
          if (staff.brokerage.role !== "Admin") return { status: 403, error: offboardingUnavailable };
          const parsed = offboardingInput.safeParse(input);
          if (!parsed.success) return { status: 400, error: "Refresh the offboarding preview and try again." };
          const action = parsed.data;
          const roster = await directory.staffDepartureRoster(staff, bootstrapEmails, action.email,
            action.type === "offboardingTransfer" ? action.replacement : undefined);
          if (!roster) return { status: 403, error: "This staff member is unavailable in your brokerage." };
          if (action.type !== "offboardingRevoke") {
            const result = await workspace.staffDeparture(action, roster, staff);
            return "error" in result ? { status: 409, error: result.error } : { value: result };
          }
          const alreadyRevoked = roster.member.status === "Revoked" && roster.member.accessRevision === action.memberRevision + 1;
          if (!alreadyRevoked) {
            if (roster.member.accessRevision !== action.memberRevision) return { status: 409, error: "Staff access changed. Refresh the offboarding preview." };
            if (!roster.canRevoke) return { status: 409, error: "Keep at least one active admin in this brokerage." };
            if (!action.immediate && await workspace.staffDepartureWorkRemaining(action.email, staff)) {
              return { status: 409, error: "Open work or intake routes still need a handoff. Refresh the offboarding preview." };
            }
            const result = await directory.manage(staff, bootstrapEmails, { type: "revoke", email: action.email, expectedAccessRevision: action.memberRevision });
            if (result.error) return { status: 409, error: result.error };
          }
          try {
            const remaining = await workspace.staffDepartureWorkRemaining(action.email, staff);
            return { value: { message: remaining ? "Access revoked. Use the recovery list to hand off remaining work." : "Access revoked. No open work remains." } };
          } catch {
            return { value: { message: "Access revoked. Refresh the recovery list to check for remaining work." } };
          }
        }
        if (input && typeof input === "object" && "type" in input && input.type === "pilotFeedback") {
          if (!staff.brokerage.pilot || !pilotFeedbackInput.safeParse(input).success) return { status: 400, error: "Choose a pilot step and enter feedback up to 1,000 characters." };
          const active = await directory.complianceRoster(staff, bootstrapEmails);
          if (!active) return { status: 403, error: "Refresh Team to check your pilot access." };
          const result = await workspace.pilotFeedback(staff, input, active);
          if ("error" in result) return { status: 409, error: result.error };
          return "message" in result ? { value: result } : { status: 400, error: "Choose a valid support request." };
        }
        if (input && typeof input === "object" && "type" in input && input.type === "triagePilotFeedback") {
          if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin") return { status: 403, error: "Only a pilot admin can update feedback." };
          const parsed = pilotTriageInput.safeParse(input);
          if (!parsed.success) return { status: 400, error: "Check the feedback status and retest result." };
          if (parsed.data.owner) {
            const team = await directory.team(staff, bootstrapEmails);
            if (!team.members.some((member) => member.status === "Active" && member.email === parsed.data.owner)) {
              return { status: 409, error: "Select an active staff member in this pilot workspace." };
            }
          }
          const result = await workspace.pilotTriage(staff, parsed.data);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }
        if (input && typeof input === "object" && "type" in input &&
          (input.type === "recordPilotMeasurement" || input.type === "recordPilotBenchmarkRun")) {
          if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin") return { status: 403, error: "Only a pilot admin can record measurements." };
          const result = await workspace.pilotMeasurement(staff, input);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }
        if (input && typeof input === "object" && "type" in input && input.type === "loadPilotScenario") {
          if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin") return { status: 403, error: "Only a pilot admin can load or reset the scenario." };
          const parsed = pilotScenarioInput.safeParse(input);
          if (!parsed.success) return { status: 400, error: "Refresh Team and select an active staff member." };
          const team = await directory.team(staff, bootstrapEmails);
          const owner = team.members.find((member) => member.status === "Active" && member.role !== "Processor" && member.email === parsed.data.officerEmail);
          if (!owner) return { status: 409, error: "Select an active staff member in this pilot workspace." };
          const result = await workspace.loadPilot(staff, parsed.data, owner);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }
        if (input && typeof input === "object" && "type" in input && input.type === "loadPilotExploration") {
          if ((!staff.brokerage.pilot && staff.brokerage.id !== demoBrokerageId) || staff.brokerage.role !== "Admin") return { status: 403, error: "Only an admin in a demo or pilot workspace can add demo examples." };
          const parsed = explorationInput.safeParse(input);
          if (!parsed.success) return { status: 400, error: "Choose an active loan officer and an optional processor." };
          const team = await directory.team(staff, bootstrapEmails);
          const result = await workspace.loadExploration(staff, parsed.data, team.members);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }
        if (input && typeof input === "object" && "type" in input &&
            (input.type === "setPilotSeatLimit" || input.type === "cancelInvitation" || input.type === "setWorkspaceFeatures" ||
              input.type === "setWorkspaceListVisibility" || input.type === "closeReleaseWorkspace") &&
            url.searchParams.get("brokerage") !== staff.brokerage.id) {
          return { status: 403, error: "Open Team in the brokerage you want to manage." };
        }
        const result = await directory.manage(staff, bootstrapEmails, input);
        if (result.error) return { status: result.status ?? 403, error: result.error };
        if (result.assignment) {
          const assigned = await workspace.reassign(staff, result.assignment);
          return assigned.error ? { status: 409, error: assigned.error } : { value: { message: assigned.message } };
        }
        if (result.processorAssignment) {
          const assigned = await workspace.shareProcessing(staff, result.processorAssignment);
          return "error" in assigned ? { status: 409, error: assigned.error } : { value: assigned };
        }
        return { value: { message: result.message, created: result.created } };
      }, 8192);
      return new Response("Method not allowed.", { status: 405, headers });
    }
    const appHeaders = new Headers(request.headers);
    appHeaders.delete("x-orbit-staff-email");
    appHeaders.delete("x-orbit-staff-name");
    appHeaders.delete("x-orbit-brokerage");
    if (staff) {
      appHeaders.set("x-orbit-staff-email", encodeURIComponent(staff.email));
      appHeaders.set("x-orbit-staff-name", encodeURIComponent(staff.name.toWellFormed()));
      appHeaders.set("x-orbit-brokerage", encodeURIComponent(JSON.stringify(staff.brokerage)));
    }
    const response = url.pathname.startsWith("/_next/static/")
      ? await env.ASSETS.fetch(request)
      : await app.fetch(tokenPage ? new Request(url, { method: request.method }) : new Request(request, { headers: appHeaders }), env, context);
    const result = new Response(response.body, response);
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("X-Robots-Tag", "noindex");
    if (tokenPage) result.headers.set("Referrer-Policy", "no-referrer");
    return result;
}

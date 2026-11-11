import { initializeMaintenance, maintenanceAdmin, maintenanceState, maintenanceView, changeMaintenance, markMaintenanceDrained } from "./lib/workspace-maintenance";
import { maintenanceMessage, maintenanceInput, type MaintenanceView } from "./lib/workspace-maintenance-model";
import { WorkspaceMaintenanceGate, guardWorkspaceMethods } from "./lib/workspace-maintenance-gate";
import { workspaceMaintenancePage } from "./lib/staff-auth";

const maintenanceGates = new WeakMap<object, WorkspaceMaintenanceGate>();
import { initializeUwmWorkflows, runUwmWorkflow, readUwmFile } from "./lib/uwm-workflows";
import { UwmError } from "./lib/uwm-live";
import { connectUwmUser, disconnectUwmUser, initializeUwmUserAccess, uwmUserStatus } from "./lib/uwm-user-access";
import { correlateUwmImport, initializeUwmOperations } from "./lib/uwm-operations";
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
import { googleSettings, handleStaffAuth, runtimeSetting, staffLoginUrl, staffSessionHash, workspaceAccessDenied } from "./lib/staff-auth";
import { staffAuthStore, type StaffAuthStore, type StaffIdentity, type WorkspaceStaff } from "./lib/staff-store";
import { brokerageIdPattern, brokerageUrl, demoBrokerageId, portalBrokerage, staffSignInRequired, workspaceGuide, type BrokerageMember, type VersionedBrokerageMember } from "./lib/brokerage-model";
import { activateBrokerages, activeBrokerages, bootstrapDemoMembers, brokerageHistory, brokerageMembers, changeBrokerage, departureRoster, initializeBrokerages, readStaffAccess, selectedActiveMembers } from "./lib/brokerages";
import { assignLoan, scopeWorkspace, workspaceAccessHistory } from "./lib/workspace-access";
import { placesHttp, reserveAddressLookup } from "./lib/places";
import { realtorHttp, realtorReferrals } from "./lib/realtor-portal";
import { beginDocumentUpload, documentCleanupBatch, downloadableDocument, failDocumentUpload, finishDocumentUpload,
  issueDocumentCode, nextDocumentCleanup, recordDocumentDownload, verifyDocumentCode, type UploadAccess } from "./lib/document-files";
import { fileProblem, leadDocumentPortalHttp, privatePdf, uploadBorrowerPdf, uploadSettings, verifyBorrowerEmail, type DocumentEnvironment } from "./lib/document-file-http";
import { documentKey, type DocumentUploadMode } from "./lib/document-files-model";
import { z } from "zod";
import { loadProtectedPilotScenario, pilotFeedbackInput, pilotReview, pilotScenarioInput, pilotTriageInput, recordPilotMeasurement, savePilotFeedback, triagePilotFeedback, type PilotPortalLink } from "./lib/pilot";
import { explorationInput, loadExplorationExamples } from "./lib/pilot-exploration";
import { loanScenarioWork } from "./lib/loan-scenarios";
import { incomeWorksheetWork } from "./lib/income-review";
import { workOnPreapprovalLetters } from "./lib/preapproval-letters";
import { readClosingPacket } from "./lib/closing-packets";
import { sharedPreapprovalDownload } from "./lib/preapproval-sharing";
import { sharedPreapprovalUnavailable } from "./lib/preapproval-model";
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
import { documentTemplateWork } from "./lib/document-templates";
import { feeTemplateWork } from "./lib/fee-templates";
import { saveRealtorClaimPolicyInput } from "./lib/realtor-claim-model";
import { readSharedRealtorQueue } from "./lib/realtor-claim-queue";
import { assignWaitingRealtor, readRealtorQueueReport } from "./lib/realtor-queue-report";
import { assignWaitingRealtorInput, realtorQueueReportUnavailable } from "./lib/realtor-queue-report-model";
import { assignProcessor } from "./lib/loan-processing";
import { loanAssignmentUnavailable, readLoanAssignments } from "./lib/loan-assignments";
import { savePlaybookInput } from "./lib/playbook-model";
import { readRecordHistory } from "./lib/record-history";
import { readUwmDelivery } from "./lib/uwm-delivery";
import { exportPilotPipeline } from "./lib/pipeline-export";
import { reviewMigrationRecovery } from "./lib/migration-recovery";
import { exportCutoverHandoff, lookupCutoverFile, readCutoverApplicationComparison, readCutoverFileInventory, readMigrationCutover,
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
import { crmFieldWork } from "./lib/crm-fields";
import { disclosureCalendarWork } from "./lib/disclosure-calendar";
import { disclosureTemplateWork } from "./lib/disclosure-templates";
import { complianceCaseWork } from "./lib/compliance-cases";
import { complianceWorkUnavailable } from "./lib/compliance-case-model";
import { borrowerQuestionSetWork } from "./lib/borrower-question-sets";
import { loanStageEditWork } from "./lib/loan-stage-edits";
import { closingGateWork } from "./lib/closing-gates";
import { changeConversation, readConversations } from "./lib/conversations";
import { contactMergeWork } from "./lib/contact-merge";
import { conversationInput } from "./lib/conversation-model";
import { changeInboundReply, readInboundReplies } from "./lib/inbound-replies";
import { coverageParticipants, coverageWork, coveredCampaignRouting } from "./lib/coverage";
import { coverageInput, coverageUnavailable, type CoverageResult } from "./lib/coverage-model";
import { readWorkspaceSearch } from "./lib/workspace-search";
import { loanReviewWork, reviewParticipants } from "./lib/loan-reviews";
import { playbookRunWork } from "./lib/playbook-runs";
import { nextDocumentReminderCheck, runScheduledDocumentReminders } from "./lib/document-reminder-runs";
import { brokerageFinanceWork } from "./lib/brokerage-finance";
import { fileExceptionOwners, nameFileExceptions, readFileExceptions } from "./lib/file-exceptions";
import { managerExceptionInput, managerExceptionsUnavailable, type ManagerExceptionResult } from "./lib/manager-exception-model";
import { readManagerExceptionWork } from "./lib/manager-exceptions";
import { readMigrationRecord } from "./lib/migration-record";
import { migrationRecordUnavailable } from "./lib/migration-record-model";
import { fileExceptionsUnavailable, type FileExceptionPage } from "./lib/file-exception-model";
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
    if (!ctx.id.name || !brokerageIdPattern.test(ctx.id.name)) throw new Error("Invalid Orbit workspace name.");
    this.#id = ctx.id.name;
    this.#documents = (env as Cloudflare.Env & DocumentEnvironment).DOCUMENTS;
    this.#auth = staffAuthStore(this.#store);
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

  #initializeWorkspace() {
    if (this.#initialized) return;
    initializeStore(this.#store, this.#id === demoBrokerageId);
    initializeUwmUserAccess(this.#store);
    initializeUwmOperations(this.#store);
    initializeUwmWorkflows(this.#store);
    initializeUwmWebhooks(this.#store);
    if (this.#id === demoBrokerageId) {
      initializeBrokerages(this.#store);
      initializeMaintenance(this.#store);
    }
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
      !!state.reviewedAt && state.checks.every(Boolean);
  }
  async prepareMaintenanceReopen(staff: WorkspaceStaff, revision: number) {
    if (staff.brokerage.id !== this.#id || this.#id === demoBrokerageId ||
      !await this.env.WORKSPACE.getByName(demoBrokerageId).mayPrepareMaintenanceReopen(staff,revision)) throw new Error("Reopening review unavailable.");
    const gate=maintenanceGates.get(this)!;
    if (!gate.closed || gate.active) throw new Error("Wait for active workspace requests to finish.");
    this.#initializeWorkspace();
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
        : await runUwmWorkflow(this.#store, this.#uwmEnvironment(), staff, input);
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

  async receiveUwmWebhook(event: UwmWebhookEvent) {
    const connection = uwmWebhookConnection(runtimeSetting(this.env, "UWM_WEBHOOK_CONFIG"), event.environment);
    if (!connection || connection.brokerageId !== this.#id) throw new Error("Webhook workspace mismatch");
    const details = await this.env.WORKSPACE.getByName(demoBrokerageId).brokerageDetails(this.#id);
    if (!details || details.pilot) throw new Error("Webhook brokerage unavailable");
    const receipt = saveUwmWebhook(this.#store, parseUwmWebhook(event.environment, event.kind, event.body));
    if (event.kind === "import") correlateUwmImport(this.#store, Number(receipt.receiptId));
    return receipt;
  }

  uwmWebhookReceipts(staff: WorkspaceStaff, before: number, receiptId?: number) {
    if (!this.#accepts(staff) || staff.brokerage.role !== "Admin") throw new Error("Webhook receipts unavailable");
    if (receiptId !== undefined) {
      const receipt = this.#store.prepare("SELECT * FROM uwm_webhook_receipts WHERE id = ?").get(receiptId);
      return receipt ?? null;
    }
    return readUwmWebhookReceipts(this.#store, before);
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

  actionCounts(staff: WorkspaceStaff) {
    return this.#store.transaction(() => readActionCounts(this.#store, staff, this.#id));
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

  async staffFileExceptions(input: unknown, staff: WorkspaceStaff): Promise<FileExceptionPage | { error: string }> {
    const page = readFileExceptions(this.#store, input, staff, this.#id);
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
    return readIncomingLoanWorkPage(this.#store, input, staff, this.#id);
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
    if (!this.#accepts(staff) || !staff.brokerage.pilot) return { error: complianceWorkUnavailable };
    const directory = this.env.WORKSPACE.getByName(demoBrokerageId);
    const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
    try {
      const roster = await directory.complianceRoster(staff, emails);
      return roster ? complianceCaseWork(this.#store, input, staff, this.#id, roster) : { error: complianceWorkUnavailable };
    } catch {
      return { error: complianceWorkUnavailable };
    }
  }

  borrowerQuestionSets(input: unknown, staff: WorkspaceStaff) {
    return borrowerQuestionSetWork(this.#store, input, staff, this.#id);
  }

  loanStageEdits(input: unknown, staff: WorkspaceStaff) {
    return loanStageEditWork(this.#store, input, staff, this.#id);
  }

  closingGates(input: unknown, staff: WorkspaceStaff) {
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
    const result = await executeCommand(this.#store, input, staff, referralOwner, leadMembers,
      { scopedLeadUpdates: true, scopedLoanUpdates: true, scopedContactUpdates: true, scopedInboxUpdates: scope === "inbox", scopedTaskUpdates: scope === "tasks",
        scopedTemplateUpdates: true, scopedRealtorUpdates: scope === "realtors", scopedMigrationUpdates: scope === "migration",
        reviewRouting, campaignRefillRoster, campaignOptOutRoster,
        uwmEnvironment: Object.fromEntries(["UWM_BROKERAGE_ID", "UWM_INSIGHTS_CLIENT_ID", "UWM_INSIGHTS_CLIENT_SECRET",
          "UWM_CLIENT_ID", "UWM_CLIENT_SECRET", "UWM_ENVIRONMENT", "ORBIT_PRICING_MODE", "UWM_EQ_CLIENT_ID",
          "UWM_EQ_CLIENT_SECRET", "UWM_EQ_BROKER_ALIAS", "UWM_EQ_LO_EMAIL"].map((key) => [key, runtimeSetting(this.env, key)])),
        protectPilotLinks: staff?.brokerage.pilot ? this.#protectPilotLinks : undefined });
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
  staffSessionAccess(tokenHash: string, now: number, emails: string[]) {
    if (this.#id !== demoBrokerageId) return null;
    const access=readStaffAccess(this.#store,tokenHash,now,emails);
    return access ? {...access,brokerages:access.brokerages.map(brokerage=>({...brokerage,
      maintenance:maintenanceState(this.#store,brokerage.id).mode !== "Open"}))} : null;
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
    const row = this.#store.prepare("SELECT pilot FROM brokerages WHERE id = ?").get(id);
    return row ? { pilot: Boolean(row.pilot), maintenance: maintenanceState(this.#store,id).mode !== "Open" } : null;
  }
  brokerageForPortal(token: unknown) {
    if (this.#id !== demoBrokerageId || typeof token !== "string") return null;
    const id = portalBrokerage(token);
    if (!id) return null;
    const row = this.#store.prepare(`SELECT pilot FROM brokerages WHERE id = ? AND NOT EXISTS (
      SELECT 1 FROM revoked_pilot_portals WHERE brokerageId = brokerages.id AND tokenHash = ? AND expiresAt > ?
    )`).get(id, portalHash(token), new Date().toISOString());
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
    return members ? { members, history: brokerageHistory(this.#store, staff.brokerage.id) } : { members: [], history: [] };
  }
  complianceRoster(staff: WorkspaceStaff, emails: string[]): VersionedBrokerageMember[] | null {
    if (this.#id !== demoBrokerageId) return null;
    const active = activeBrokerages(this.#store, staff.email, emails).find(({ id }) => id === staff.brokerage.id);
    return active?.pilot && active.role === staff.brokerage.role && active.accessRevision === staff.brokerage.accessRevision
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
  pilotFeedback(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return savePilotFeedback(this.#store, staff, input);
  }
  pilotTriage(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return triagePilotFeedback(this.#store, staff, input);
  }
  pilotMeasurement(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return recordPilotMeasurement(this.#store, staff, input);
  }
  borrower(input: unknown, pilot = false) {
    const fictional = pilot || this.#id === demoBrokerageId;
    return borrowerCommandResult(this.#store, input,
      fictional || runtimeSetting(this.env, "ORBIT_DOCUMENT_UPLOADS") !== "enabled", pilot, fictional);
  }
  coBorrower(input: unknown, pilot = this.#id !== demoBrokerageId) {
    return coBorrowerCommandResult(this.#store, input, pilot, undefined, pilot || this.#id === demoBrokerageId);
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
  new Set(["maintenanceStateFor","maintenanceFence","mayPrepareMaintenanceReopen","prepareMaintenanceReopen","manageWorkspaceMaintenance"]));

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.hostname === "orbitlos.com" && url.protocol !== "https:") {
      url.protocol = "https:";
      return Response.redirect(url, 308);
    }
    const reading = request.method === "GET" || request.method === "HEAD";
    if (url.pathname.startsWith("/api/webhooks/uwm/")) {
      return uwmWebhookHttp(request, runtimeSetting(env, "UWM_WEBHOOK_CONFIG"),
        (brokerageId, event) => env.WORKSPACE.getByName(brokerageId).receiveUwmWebhook(event), runtimeSetting(env, "ORBIT_DEPLOYMENT"));
    }
    if (url.pathname === "/api/demo-request") return demoRequest(request, env);
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
    const google = googleSettings(env);
    const demoPassword = runtimeSetting(env, "DEMO_PASSWORD");
    if (!google && !demoPassword) {
      return new Response("Orbit demo is being configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const directory = env.WORKSPACE.getByName(demoBrokerageId);
    const bootstrapEmails = [...(google?.allowedEmails ?? [])];
    async function linkedWorkspace(input: unknown) {
      const token = input && typeof input === "object" && "token" in input ? input.token : input;
      const id = portalBrokerage(token);
      if (!id) return null;
      const details = id === demoBrokerageId ? { pilot: false } : await directory.brokerageForPortal(token);
      if (details && "maintenance" in details && details.maintenance) throw new Error(maintenanceMessage);
      return details ? { id, pilot: details.pilot, store: env.WORKSPACE.getByName(id) } : null;
    }
    const filesEnv = env as Cloudflare.Env & DocumentEnvironment;
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
    if (google && ["/login", "/auth/google", "/auth/google/callback", "/auth/logout"].includes(url.pathname)) {
      return handleStaffAuth(request, url, google, directory, (staff) => directory.activateStaff(staff, bootstrapEmails));
    }
    let staff: WorkspaceStaff | null = null;
    let brokerages: WorkspaceStaff["brokerage"][] = [];
    if (!tokenPage) {
      if (google) {
        const requested = url.searchParams.get("brokerage");
        const openingWorkspace = reading && url.pathname === "/workspace";
        const workspaceTarget = openingWorkspace && requested && brokerageIdPattern.test(requested) ? requested : null;
        const guide = openingWorkspace ? workspaceGuide(url.searchParams.get("guide")) : null;
        const login = () => new Response(null, { status: 303, headers: { Location: staffLoginUrl(workspaceTarget, undefined, guide), "Cache-Control": "no-store" } });
        try {
          const tokenHash = await staffSessionHash(request, google);
          const access = tokenHash && await directory.staffSessionAccess(tokenHash, Date.now(), bootstrapEmails);
          if (access) {
            const { identity } = access;
            brokerages = access.brokerages;
            const brokerage = requested === null ? brokerages.find(entry=>!entry.maintenance) ?? brokerages[0] : brokerages.find((entry) => entry.id === requested);
            if (requested !== null && !brokerage && (brokerages.length || openingWorkspace)) {
              if (workspaceTarget && await directory.staffInvitedTo(workspaceTarget, identity.email)) return login();
              if (openingWorkspace) return workspaceAccessDenied(workspaceTarget, guide);
              return new Response("You don’t have access to this brokerage.", { status: 403, headers: { "Cache-Control": "no-store" } });
            }
            if (brokerage) staff = { ...identity, brokerage };
            if (staff && requested === null && staff.brokerage.id !== demoBrokerageId && openingWorkspace) {
              return new Response(null, { status: 303, headers: { Location: brokerageUrl(staff.brokerage.id, guide), "Cache-Control": "no-store" } });
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
      if (request.method === "GET") {
        const value=await directory.manageWorkspaceMaintenance(identity);
        return Response.json(value,{status:"error" in value?403:200,headers});
      }
      if (request.method === "POST") return borrowerJson(request,async input=>{
        const value=await directory.manageWorkspaceMaintenance(identity,input);
        return "error" in value ? {status:409,error:value.error} : {value};
      },4096);
      return new Response(null,{status:405,headers:{...headers,Allow:"GET, POST"}});
    }
    if (staff && url.pathname !== "/workspace-maintenance" && staff.brokerage.maintenance) {
      return reading && url.pathname === "/workspace" ? workspaceMaintenancePage(staff.brokerage) :
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
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
      const before = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).safeParse(url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER);
      const receiptId = url.searchParams.has("receipt") ? z.coerce.number().int().positive().safeParse(url.searchParams.get("receipt")) : null;
      if (!before.success || (receiptId && !receiptId.success)) return Response.json({ error: "Invalid receipt cursor" }, { status: 400, headers });
      try {
        const receipts = await env.WORKSPACE.getByName(staff.brokerage.id).uwmWebhookReceipts(staff, before.data, receiptId?.data);
        return Response.json({ receipts }, { headers });
      } catch { return Response.json({ error: "Receipts unavailable" }, { status: 503, headers }); }
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
      if (request.method === "GET") {
        const view = url.searchParams.get("view");
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
        return Response.json({ brokerages, members: team.members, history, ...pilot }, { headers });
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
          const result = await workspace.pilotFeedback(staff, input);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
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
        if (input && typeof input === "object" && "type" in input && input.type === "recordPilotMeasurement") {
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
        const result = await directory.manage(staff, bootstrapEmails, input);
        if (result.error) return { status: 403, error: result.error };
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
  },
} satisfies ExportedHandler<Cloudflare.Env>;

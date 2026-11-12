"use client";
import { UwmAccount } from "./uwm-account";
import { UwmReceipts } from "./uwm-receipts";
import { AutomationDeliveries } from "./automation-deliveries";
import { DeliveryExceptions } from "./automation-exceptions";
import { PartnerPermissions } from "./partner-permissions";
import { UwmConnection, type UwmConnectionStatus } from "./uwm-connection";

import { Activity, lazy, Suspense, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import {
  ArrowDownUp, ArrowRight, Bell, CircleCheck, List, LogOut, MapPin, Menu, Orbit as OrbitIcon, Plus, RefreshCw, Search, SlidersHorizontal, X,
} from "lucide-react";
import { checkLoanHandoff, mutate, readContactsWork, readLeadForWork, readLoanForWork, searchWorkspace } from "@/app/actions";
import { prospectingBlocked, stages, type Contact, type Loan, type LoanTask, type Stage, type Submission, type Workspace } from "@/lib/model";
import { compactMoney, dateTime, initials, money, requestedMoney, stageDays } from "@/lib/utils";
import type { Modal } from "./record-dialog";
import { Button } from "./ui/button";
import { LoanTaskRow } from "./loan-task";
import { BorrowerCallbackReschedule, ContactFollowUpAssignment, ContactFollowUpCheckIn, ContactFollowUpCompletion, ContactFollowUpResult, ContactImport } from "./contact-crm";
import { ContactsDirectory } from "./contacts-directory";
import { CrmFieldSettings } from "./crm-fields";
import { contactUnavailable } from "@/lib/contact-directory-model";
import { useLeadOwners } from "./use-lead-owners";
import { fundingCheckInTarget, loanAmountComparisonTarget, loanNextAction, loanTaskTarget, matchesWorkFilter, pausedLoan,
  reopenedMockClosingMessage, workFilters, type WorkFilter } from "@/lib/loan-workflow";
import { emptyPipelineFilters, type PipelineFilters, type PipelineLoan, type PipelineQuery } from "@/lib/pipeline-model";
import { usePipeline } from "./use-pipeline";
import { LoanWorkQueue } from "./loan-work-queue";
import { PagedTaskQueue } from "./paged-task-queue";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { pastClientLoan, rateFollowUpContext } from "@/lib/client-retention";
import { workspaceFeatures, demoBrokerageId, staffSignInRequired } from "@/lib/brokerage-model";
import { CallReportWorkbench } from "./call-report";
import { callReportFactsTarget, currentReportingPeriod } from "@/lib/call-report-readiness-model";
import { ManagerReports, ReturningClientReports } from "./manager-reports";
import { FundingDashboard } from "./funding-dashboard";
import { BrokerageFinance } from "./brokerage-finance";
import { canManageFinance } from "@/lib/brokerage-finance-model";
import { SalesDashboard, type SalesSelection } from "./sales-dashboard";
import { OwnerScorecard } from "./owner-scorecard";
import type { OwnerScorecardFilters } from "@/lib/owner-scorecard-model";
import { currentReportMonth } from "@/lib/report-date-range";
import { OfficerToday } from "./officer-today";
import { currentCalendarWeek, WorkspaceCalendar } from "./workspace-calendar";
import { DisclosureCalendar } from "./disclosure-calendar";
import { ComplianceWorkspace } from "./compliance-workspace";
import { ComplianceDailyWork } from "./compliance-daily-work";
import { complianceCaseTarget, complianceTarget } from "@/lib/compliance-case-model";
import { LoanStageEditSettings } from "./loan-stage-edits";
import { ManageClosingGates } from "./closing-gates";
import { DisclosureTemplateSettings } from "./disclosure-templates";
import { ManageBorrowerQuestionSets } from "./borrower-question-sets";
import { StaffCoverage } from "./staff-coverage";
import { LoanReviewQueue } from "./loan-reviews";
import { ReviewInboxPanel, useReviewInbox } from "./review-inbox";
import { useActionCounts } from "./use-action-counts";
import { reviewTarget } from "@/lib/loan-review-model";
import { WorkspaceSearch, type SearchSelection } from "./workspace-search";
import { searchRecordUnavailable, searchTaskTarget, type SearchContact, type SearchRecord } from "@/lib/workspace-search-model";
import { creditAusAttemptTarget, creditAusAttemptTargetPrefix, unconfirmedMockOrder } from "@/lib/credit-aus-model";
import { ProcessorQueue } from "./processor-queue";
import type { CalendarQuery, OfficerQueueItem } from "@/lib/officer-queue-model";
import { stalledLoanUnavailable } from "@/lib/officer-dashboard-model";
import { StalledLoans } from "./officer-dashboard";
import { MigrationWorkspace } from "./migration-workspace";
import { BrokerageTeam, type TeamPanel } from "./brokerage-team";
import { StaffFirstDay } from "./staff-first-day";
import type { FirstDayStepId } from "@/lib/staff-first-day-model";
import { LicenseRenewalAttention, type LicenseRenewalVisit } from "./license-renewal-attention";
import { BrokerageOverview, brokerageReports, type BrokerageQueue, type BrokerageReport } from "./brokerage-overview";
import { CommunicationQueue } from "./loan-communications";
import { ConversationQueue } from "./conversation-queue";
import { InboundReplyQueue } from "./inbound-reply-queue";
import type { ConversationCallback, ConversationFocus } from "@/lib/conversation-model";
import { RealtorCrm } from "./realtor-crm";
import { PastClients } from "./past-client-crm";
import { ReferralQueue } from "./referral-queue";
import { LeadInbox } from "./lead-inbox";
import { RealtorQueueReport } from "./realtor-queue-report";
import { firstContactOverdue, leadAttentionView } from "@/lib/lead-inbox-model";
import { DemoGuide, type GuideTrack } from "./demo-guide";
import { UwmAlertQueue } from "./uwm-alert-queue";
import { workspaceIcons } from "./workspace-icons";
import { BrokeragePlaybooks, type ManagerExceptionView } from "./brokerage-playbooks";
import { FileExceptions } from "./file-exceptions";
import type { FileException } from "@/lib/file-exception-model";
import { CallCampaigns } from "./call-campaigns";
import { localCampaignOfficers } from "@/lib/call-campaign-model";
import { fundingMilestones, fundingTaskAudience, playbookWork, reversedFundingTaskPrefix, type PlaybookWork } from "@/lib/playbook-model";
import { defaultManagerExceptionFilters } from "@/lib/manager-exception-model";
import type { MigrationDestination } from "@/lib/migration-record-model";
import { applyCampaignMutation, applyCampaignNavigation, applyCampaignQueue, applyLeadConversion, applyLeadMutation, applyLeadWork, type LeadWorkRequest } from "@/lib/lead-work-model";
import type { WorkspaceMutationScope, WorkspaceMutationSuccess } from "@/lib/commands";
import type { LeadInboxMutation } from "@/lib/lead-inbox-model";
import type { QuotePrefillSelection } from "@/lib/quote-intake-questions";
import { applyLoanMutation, loanWorkUnavailable, type EditableLoan } from "@/lib/loan-work-model";
import { announceBorrowerChange, borrowerChecklistTokens, borrowerDisclosureTokens } from "@/lib/borrower-change-signal";
import { conditionTarget, submissionTarget, type UwmAlert } from "@/lib/uwm-alert-model";
import { incomingLoanWorkProcessingStatuses, type IncomingLoanWorkItem, type IncomingLoanWorkQuery } from "@/lib/incoming-loan-work-model";
import { realtorFinancingTarget } from "@/lib/realtor-financing-model";
import { isPreapprovalWork, samplePreapprovalTarget } from "@/lib/preapproval-policy-model";
import { leadDocumentsUnavailable, type LeadDocumentLocation } from "@/lib/lead-document-model";
import { manualReturnSteps } from "@/lib/lender-export-model";
import { secondReviewBlocker } from "@/lib/application-model";
import { disclosureTarget, disclosureTask } from "@/lib/disclosure-model";
import { isSharedQuoteReview, sharedQuoteReviewTarget } from "@/lib/shared-quote-model";
import { mockUwmReceiptTaskPrefix } from "@/lib/uwm-handoff-recovery";
import { staffQuestionTarget } from "@/lib/borrower-question-model";
import { staleProcessingHandoff } from "@/lib/processing-model";
import { supportReportUrl, type SupportWorkGroup } from "@/lib/pilot-support-model";

const RecordDialog = lazy(async () => ({ default: (await import("./record-dialog")).RecordDialog }));
const CustomReports = lazy(async () => ({ default: (await import("./custom-reports")).CustomReports }));

type Section = "Brokerage" | "First-day checklist" | "Demo Guide" | "Today" | "Calendar" | "Coverage" | "Reviews" | "Review Inbox" | "Search" | "Pipeline" | "Processing" | "Exceptions" | "Lead Inbox" | "Contacts" | "Realtors" | "Past Clients" | "Tasks" | "Communications" | "Integrations" | "Team" | "Reports" | "Migration" | "Playbooks" | "Call Campaigns" | "Compliance";
const scopedSections = new Set<Section>(["Today", "Calendar", "Coverage", "Reviews", "Review Inbox", "Search", "Processing", "Call Campaigns",
  "Pipeline", "Contacts", "Lead Inbox", "Tasks", "Communications", "Past Clients", "Realtors", "Playbooks", "Team", "Migration", "Exceptions", "Compliance", "Brokerage", "First-day checklist"]);
const reportTabs = ["Owner scorecard", "Funding dashboard", "Pipeline workload", "Sales conversion", "Referral queue", "Financials", "Production", "Returning clients", "Call report", "Custom reports"] as const;
const [localOfficer] = localCampaignOfficers;
const demoOfficer = localOfficer.name;
const taskViews = ["Open", "Due in 24 hours", "Overdue", "Completed", "All"] as const;
type TaskView = (typeof taskViews)[number];
const navigation = [
  { title: "Loan operations", items: [
    { label: "Brokerage", icon: workspaceIcons.brokerage },
    { label: "Today", icon: workspaceIcons.today },
    { label: "Calendar", icon: workspaceIcons.calendar },
    { label: "Coverage", icon: workspaceIcons.coverage },
    { label: "Pipeline", icon: workspaceIcons.pipeline },
    { label: "Processing", icon: workspaceIcons.processing },
    { label: "Exceptions", icon: workspaceIcons.exceptions },
    { label: "Reviews", icon: workspaceIcons.reviews },
    { label: "Lead Inbox", icon: workspaceIcons.intake },
    { label: "Call Campaigns", icon: workspaceIcons.calls },
    { label: "Tasks", icon: workspaceIcons.tasks },
  ] },
  { title: "Relationships", items: [
    { label: "Contacts", icon: workspaceIcons.contacts },
    { label: "Realtors", icon: workspaceIcons.realtors },
    { label: "Past Clients", icon: workspaceIcons.pastClients },
    { label: "Communications", icon: workspaceIcons.communications },
  ] },
  { title: "Workspace", items: [
    { label: "Demo Guide", icon: workspaceIcons.demo },
    { label: "Reports", icon: workspaceIcons.reports },
    { label: "Playbooks", icon: workspaceIcons.playbooks },
    { label: "Compliance", icon: workspaceIcons.compliance },
    { label: "Integrations", icon: workspaceIcons.integrations },
    { label: "Migration", icon: workspaceIcons.migration },
    { label: "Team", icon: workspaceIcons.team },
  ] },
] as const;
const brokerageQueueSections: Record<BrokerageQueue, Section> = { exceptions: "Exceptions", leads: "Lead Inbox", processing: "Processing" };

const stageColors = ["lavender", "blue", "peach", "gold", "rose", "mint", "green", "slate"];
const taskOwner = (item: Pick<Loan, "officer" | "officerEmail">) => item.officerEmail ? `account:${item.officerEmail}` : `name:${item.officer}`;

function LoanCard({ loan, onOpen, onDrag, onDragEnd }: {
  loan: PipelineLoan; onOpen: () => void;
  onDrag: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd: () => void;
}) {
  const { name, lenders, openConditions: count, action } = loan;
  return (
    <button className="loan-card" data-loan-record={loan.id} onClick={onOpen} draggable={!pausedLoan(loan)} onDragStart={onDrag} onDragEnd={onDragEnd}>
      <span className="loan-person"><span className={`avatar avatar-${stages.indexOf(loan.stage) % 4}`}>{initials(name)}</span><strong>{name}</strong></span>
      <span className="loan-address"><MapPin size={13} /> <span>{loan.address || "Property pending"}</span></span>
      <span className="loan-value">{money(loan.amount)} <small>{loan.requestedAmount ? "Recorded" : loan.purpose}</small></span>
      {loan.requestedAmount && <span className="loan-address">1003 request {requestedMoney(loan.requestedAmount)}</span>}
      <span className="loan-card-next"><small>Next action</small><strong>{action.title}</strong></span>
      {(action.dueAt || action.blocker) && <span className="loan-address"><span>{action.blocker}{action.blocker && action.dueAt ? " · " : ""}{action.dueAt && dateTime(action.dueAt)}</span></span>}
      <span className="loan-card-footer">
        <span className="loan-card-owner">{loan.officer || "Unassigned"}</span>
        {lenders.length > 0 && <span className="lender-chip">{lenders[0]}{lenders.length > 1 && ` +${lenders.length - 1}`}</span>}
        {count > 0 ? <span className="open-chip">{count} open</span> : <span suppressHydrationWarning>{stageDays(loan.stageSince)}d</span>}
      </span>
    </button>
  );
}

const subscribeToControlsReady = () => () => {};

export function Orbit({ initial, staff, initialGuide, initialSupport, deferredWorkspace, uwmConnection }: {
  initial: Workspace; staff: WorkspaceStaff | null; initialGuide?: GuideTrack; deferredWorkspace: boolean; uwmConnection: UwmConnectionStatus;
  initialSupport?: { loanId: string; group: SupportWorkGroup; offset: number };
}) {
  const { uwm: uwmEnabled, compliance: complianceEnabled } = workspaceFeatures(staff?.brokerage);
  const pilotCompliance = !!staff?.brokerage.pilot && complianceEnabled;
  const processor = staff?.brokerage.role === "Processor";
  const canOpenToday = !processor && (Boolean(staff) || process.env.NODE_ENV === "development");
  const canOpenCalendar = Boolean(staff) || process.env.NODE_ENV === "development";
  const canOpenProcessing = processor || staff?.brokerage.role === "Admin" || (!staff && process.env.NODE_ENV === "development");
  const processorTaskEntry = processor && initialGuide === "campaign";
  const controlsReady = useSyncExternalStore(subscribeToControlsReady, () => true, () => false);
  const [state, setState] = useState(initial);
  const supportReturn = initialSupport && staff ? supportReportUrl(staff.brokerage.id, initialSupport.group, initialSupport.offset) : undefined;
  const supportOpened = useRef(false);
  const [workspaceStatus, setWorkspaceStatus] = useState<"cold" | "loading" | "failed" | "ready">(deferredWorkspace ? "cold" : "ready");
  const [reviewVersion, setReviewVersion] = useState(0);
  const queueVersion = useMemo(() => ({ state, reviewVersion }), [state, reviewVersion]);
  const { counts: actionCounts, unavailable: countsUnavailable, refresh: refreshCounts } = useActionCounts(staff?.brokerage.id ?? demoBrokerageId, staff?.email,
    controlsReady && (canOpenToday || canOpenProcessing), queueVersion);
  const [attentionVisit, setAttentionVisit] = useState<{ section: Section; visit: number }>();
  const [searchSelection, setSearchSelection] = useState<SearchSelection>({ query: "", filter: "All records" });
  const [searchContact, setSearchContact] = useState<SearchContact>();
  const [contactToolsOpen, setContactToolsOpen] = useState(false);
  const [calendar, setCalendar] = useState<CalendarQuery>(() => ({ week: currentCalendarWeek(), scope: "Mine", group: "All" }));
  const [renewalVisit, setRenewalVisit] = useState<LicenseRenewalVisit & { origin: "Brokerage" | "Today" }>();
  const [renewalReturn, setRenewalReturn] = useState<LicenseRenewalVisit & { origin: "Brokerage" | "Today" }>();
  const [reportScheduleTarget, setReportScheduleTarget] = useState<{ reportId?: string }>();
  const [reportScheduleReturn, setReportScheduleReturn] = useState<{ reportId?: string }>();
  const [reportTab, setReportTab] = useState<(typeof reportTabs)[number]>(staff && staff.brokerage.role !== "Admin" ? "Custom reports" : "Owner scorecard");
  const [teamPanel, setTeamPanel] = useState<TeamPanel>("Staff access");
  const [firstDayReturn, setFirstDayReturn] = useState<FirstDayStepId | "pilot-tools">();
  const [firstDayDestination, setFirstDayDestination] = useState<FirstDayStepId | "pilot-tools">();
  const [openLeadRouting, setOpenLeadRouting] = useState(false);
  const [scorecardFilters, setScorecardFilters] = useState<OwnerScorecardFilters>(() => ({ ...currentReportMonth(), owner: "" }));
  const [reportingPeriod, setReportingPeriod] = useState(currentReportingPeriod);
  const [managerExceptionView, setManagerExceptionView] = useState<ManagerExceptionView>("files");
  const [managerExceptionFilters, setManagerExceptionFilters] = useState(defaultManagerExceptionFilters);
  const [salesSelection, setSalesSelection] = useState<SalesSelection>(() => ({ filters: { ...currentReportMonth(), channel: "Campaigns", owner: "", windowDays: 0 } }));
  const [section, setSection] = useState<Section>(processorTaskEntry ? "Tasks" : initialGuide && !processor ? "Demo Guide" :
    processor ? "Processing" : staff?.brokerage.role === "Admin" ? "Brokerage" : staff ? "Today" : "Pipeline");
  const sectionHeading = useRef<HTMLHeadingElement>(null);
  const focusSection = useRef(false);
  useEffect(() => {
    if (!focusSection.current) return;
    sectionHeading.current?.focus({ preventScroll: true });
    sectionHeading.current?.scrollIntoView({ block: "start" });
    focusSection.current = false;
  }, [section]);
  const reviewInbox = useReviewInbox(staff?.brokerage.id ?? demoBrokerageId, canOpenCalendar, section === "Review Inbox", reviewVersion);
  const [guideTrack, setGuideTrack] = useState<GuideTrack>(initialGuide ?? "referral");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [view, setView] = useState<"Board" | "List">("Board");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(emptyPipelineFilters);
  const pipelineQuery = useMemo<PipelineQuery>(() => ({ view, search: query.trim().slice(0, 200), filters }), [view, query, filters]);
  const pipeline = usePipeline(staff?.brokerage.id ?? demoBrokerageId, section === "Pipeline", pipelineQuery, state);
  const [modal, setModal] = useState<Modal | null>(null);
  const recordTrigger = useRef<HTMLElement>(null);
  const exceptionTrigger = useRef<HTMLButtonElement>(null);
  const [detailedTasks, setDetailedTasks] = useState(processorTaskEntry);
  const [focusContactTask, setFocusContactTask] = useState<string>();
  const pagedTasks = !!staff && !detailedTasks;
  const showDetailedTaskLists = section === "Tasks" && !pagedTasks;
  const scopedReport = section === "Reports" && (reportTab === "Custom reports" ||
    brokerageReports.some((tab) => tab !== "Funding dashboard" && tab === reportTab));
  const waitingForWorkspace = workspaceStatus !== "ready" && ((!scopedSections.has(section) && !scopedReport) || (section === "Tasks" && !pagedTasks) ||
    modal?.kind === "contactDuplicates");
  const [loanWork, setLoanWork] = useState<EditableLoan>();
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const saveError = error === staffSignInRequired && staff ? <>
    Your Orbit session ended. <a className="name-link" href={`/login?brokerage=${encodeURIComponent(staff.brokerage.id)}`}>Sign in again</a> to return to this workspace.
  </> : error;
  const [notice, setNotice] = useState("");
  const [dropStage, setDropStage] = useState<Stage | null>(null);
  const [taskView, setTaskView] = useState<TaskView>("Open");
  const [taskOfficer, setTaskOfficer] = useState(processorTaskEntry ? "mine" : "");
  const [guideCallbackId, setGuideCallbackId] = useState<string>();
  const [conversationFocus, setConversationFocus] = useState<ConversationFocus | null>(null);
  const [conversationOrigin, setConversationOrigin] = useState<"Today" | "Call Campaigns">();
  const conversationReturn = useRef<{ trigger: HTMLElement | null; key: string; x: number; y: number } | undefined>(undefined);
  const [communicationView, setCommunicationView] = useState<"Conversations" | "Inbound review">("Conversations");
  const [focusLeadId, setFocusLeadId] = useState<string>();
  const [focusArchivedLeadId, setFocusArchivedLeadId] = useState<string>();
  const [focusLeadTaskId, setFocusLeadTaskId] = useState<string>();
  const [focusLeadDocumentId, setFocusLeadDocumentId] = useState<string>();
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [taskFocus, setTaskFocus] = useState<WorkFilter | "">("");
  const pending = useRef(false);
  const deferredCampaignLoad = useRef<{ id?: string; loadIntake: boolean }>(undefined);
  const loanReadVersion = useRef(0);
  const loanRefreshInFlight = useRef<number | null>(null);
  const openingRecord = useRef(false);
  const dragged = useRef<{ id: string; stage: Stage } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const mobileMenu = useRef<HTMLButtonElement>(null);
  const admin = !staff || staff.brokerage.role === "Admin";
  const canReviewReplies = admin && (staff ? staff.brokerage.pilot === true : process.env.NODE_ENV === "development");
  const canReport = staff?.brokerage.role === "Admin";
  const staffHome = processor ? "Processing" : admin ? "Brokerage" : "Today";
  const sectionTitle = section === "Brokerage" ? "Brokerage overview" : section === "Pipeline" ? "Loan pipeline" : section;
  const canOpenManagerReports = canReport || (!staff && process.env.NODE_ENV === "development");
  const canOpenReports = canOpenManagerReports || !!staff;
  const canOpenFinance = canManageFinance(staff) || (!staff && process.env.NODE_ENV === "development");
  const canMigrate = canReport && staff.brokerage.pilot;
  const managesFollowUps = showDetailedTaskLists || (section === "Reports" && (reportTab === "Returning clients" || reportTab === "Referral queue"));
  const { members: followUpOwners, error: followUpOwnerError } = useLeadOwners(managesFollowUps && canReport ? staff.brokerage.id : null);
  useEffect(() => {
    if (section === "Tasks" && guideCallbackId) document.getElementById(`contact-follow-up-${guideCallbackId}`)?.focus();
  }, [section, guideCallbackId, state.contactActivity]);

  const contactsById = new Map(state.contacts.map((contact) => [contact.id, contact]));
  const taskLoans = new Map(state.loans.map((loan) => [loan.id, loan]));
  const returningByFundedLoan = new Map(state.returningClientLoans.map(({ fundedLoanId, loanId }) => [fundedLoanId, loanId]));
  const fundedLoans = new Set(state.closingProgress.filter((item) => item.fundingDate).map((item) => item.loanId));
  const loanTaskBlocked = (task: LoanTask) => {
    const loan = taskLoans.get(task.loanId);
    return prospectingBlocked(task.purpose, loan && contactsById.get(loan.contactId)?.outreachSuppressed);
  };
  const borrowers = (loan: Loan) => contactsById.get(loan.contactId)?.name ?? "Unknown borrower";
  const [taskNow, setTaskNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setTaskNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const nextActions = new Map(state.loans.map((loan) => [loan.id, loanNextAction(loan, state, staff?.brokerage.role)] as const));
  const workMatches = (loan: Loan, filter: WorkFilter | "") => matchesWorkFilter(loan, nextActions.get(loan.id)?.dueAt ?? null, filter, taskNow, Boolean(staff)) ||
    (filter === "Overdue" && !pausedLoan(loan) && state.tasks.some((task) => task.loanId === loan.id && !task.completedAt && !loanTaskBlocked(task) && Date.parse(task.dueAt) < taskNow));
  const filterCount = Object.values(filters).filter(Boolean).length;
  const uwmCount = state.submissions.filter((item) => item.lender === "UWM").length;
  const playbook = playbookWork(state);
  const escalatedLeads = new Set(playbook.filter((item) => item.kind === "lead" && Date.parse(item.dueAt) <= taskNow).map((item) => item.recordId));
  const applicationReviews = new Set(playbook.filter((item) => item.kind === "review").map((item) => item.recordId));
  const coveredHandoffs = new Set(playbook.filter((item) => item.kind === "accept" || item.kind === "prepare").map((item) => item.recordId));
  const correctionLoans = new Set(state.applications.filter((item) => item.correctionNote).map((item) => item.loanId));
  const isApplicationReviewTask = (id: string) => id.startsWith("application-follow-up:") || id.startsWith("application-correction:");
  const isPlaybookTask = (task: Workspace["tasks"][number]) => !task.completedAt && (fundingTaskAudience(task.id) ||
    (isApplicationReviewTask(task.id) && applicationReviews.has(task.loanId)));
  const activePlaybook = playbook.filter((item) => (admin || (processor ? item.kind === "review" || (item.kind === "accept" && item.ownerEmail === staff?.email) :
    item.kind !== "accept" && (item.ownerEmail === staff?.email || (item.kind === "lead" && !item.ownerEmail)))) &&
    (item.kind !== "lead" || escalatedLeads.has(item.recordId)));
  const pendingContact = state.inboxLeads.filter((lead) => !lead.heldAt && !lead.outreachSuppressed &&
    !lead.followUp.firstContactAt && !lead.followUp.replyReceivedAt && !escalatedLeads.has(lead.id));
  const assignedProcessing = new Set(state.loanProcessing.filter((item) => item.processorEmail === staff?.email).map((item) => item.loanId));
  const activeLoanWork = (loanId: string) => {
    const loan = taskLoans.get(loanId);
    return loan && !pausedLoan(loan);
  };
  const holdsToRevisit = processor ? [] : state.loans.filter((loan) => loan.disposition === "On hold" && loan.revisitDate);
  const actionableProcessing = state.loanProcessing.filter((item) => activeLoanWork(item.loanId) && !coveredHandoffs.has(item.loanId) &&
    !applicationReviews.has(item.loanId) && !(item.status === "Ready for processing" && correctionLoans.has(item.loanId))).filter((item) => admin
    ? item.status === "Ready for processing" || item.status === "In processing" || item.status === "Returned to LO"
    : processor ? assignedProcessing.has(item.loanId) && (item.status === "Ready for processing" || item.status === "In processing") : item.status === "Returned to LO");
  const assignedContacts = new Map(state.followUpContacts.map((contact) => [contact.id, contact]));
  const contactFollowUps = state.contactActivity.flatMap((item) => {
    const contact = contactsById.get(item.contactId) ?? assignedContacts.get(item.contactId);
    if (!contact || !item.dueAt || (!admin && item.followUpOwnerEmail !== staff?.email)) return [];
    const owner = { id: item.id, officer: item.followUpOwner ?? "", officerEmail: item.followUpOwnerEmail };
    return [{ item, contact, owner, dueAt: item.dueAt, blocked: prospectingBlocked(item.purpose, contact.outreachSuppressed) }];
  }).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const openTasks = state.tasks.filter((task) => !task.completedAt && !loanTaskBlocked(task) && !isPlaybookTask(task) && activeLoanWork(task.loanId)).length + pendingContact.length + activePlaybook.length
    + contactFollowUps.filter(({ item, blocked }) => !item.completedAt && !blocked).length
    + state.inboxLeads.reduce((total, lead) => total + (lead.heldAt ? Number(!!lead.revisitDate && (admin || lead.officerEmail === staff?.email))
      : lead.importedTasks.filter((task) => !task.completedAt && !prospectingBlocked(task.purpose, lead.outreachSuppressed)).length), 0)
    + (uwmEnabled ? state.uwmAlerts.filter((alert) => !alert.reviewedAt && activeLoanWork(alert.loanId)).length : 0) + actionableProcessing.length + holdsToRevisit.length;
  const officers = new Map([...state.loans, ...state.inboxLeads, ...contactFollowUps.map(({ owner }) => owner)].filter((loan) => loan.officer).map((loan) => [
    taskOwner(loan), loan.officerEmail ? `${loan.officer} (${loan.officerEmail})` : loan.officer,
  ]));
  const matchesTaskOwner = (item: Pick<Loan, "officer" | "officerEmail">) => {
    if (!taskOfficer) return true;
    if (taskOfficer !== "mine") return taskOwner(item) === taskOfficer;
    if (staff) return item.officerEmail === staff.email;
    return item.officerEmail === localOfficer.email || (!item.officerEmail && item.officer === demoOfficer);
  };
  const taskScope = (item: Pick<Loan, "id" | "officer" | "officerEmail">) =>
    (taskOfficer === "mine" && processor && assignedProcessing.has(item.id)) || matchesTaskOwner(item);
  const visibleProcessing = showDetailedTaskLists && (taskView === "Open" || taskView === "All") ? actionableProcessing.flatMap((item) => {
    const loan = taskLoans.get(item.loanId);
    return loan && taskScope(loan) && (!taskFocus || workMatches(loan, taskFocus)) ? [{ item, loan }] : [];
  }) : [];
  const focusedLoans = (showDetailedTaskLists ? taskFocus ? state.loans : holdsToRevisit : []).filter((loan) => {
    if (!taskScope(loan)) return false;
    if (taskFocus) return workMatches(loan, taskFocus);
    const dueAt = nextActions.get(loan.id)?.dueAt;
    return !!dueAt && dueInView(dueAt);
  });
  function dueInView(dueAt: string) {
    const due = Date.parse(dueAt);
    if (taskView === "Overdue") return due < taskNow;
    if (taskView === "Due in 24 hours") return due >= taskNow && due <= taskNow + 86_400_000;
    return true;
  }
  const visibleContactFollowUps = taskFocus || !showDetailedTaskLists ? [] : contactFollowUps.filter(({ item, owner, dueAt, blocked }) => taskScope(owner) &&
    (taskView === "All" || (taskView === "Completed" ? !!item.completedAt : !item.completedAt && !blocked && dueInView(dueAt))));
  const visiblePlaybook = taskView === "Completed" || !showDetailedTaskLists ? [] : activePlaybook.filter((item) => {
    const loan = item.kind !== "lead" ? taskLoans.get(item.recordId) : undefined;
    const matchesOwner = item.kind === "review" && loan ? taskScope(loan) : matchesTaskOwner({ officer: item.owner, officerEmail: item.ownerEmail });
    return (matchesOwner || (taskOfficer === "mine" && admin && !item.owner)) &&
      (!taskFocus || !loan || workMatches(loan, taskFocus)) && dueInView(item.dueAt);
  });
  const visibleReferrals = showDetailedTaskLists ? state.referralLeads.filter((lead) => {
    const brokerageQueue = !lead.officerEmail && (!staff || staff.brokerage.role === "Admin");
    return taskView !== "Completed" && pendingContact.some((item) => item.id === lead.id) &&
      (taskScope(lead) || (taskOfficer === "mine" && brokerageQueue)) && dueInView(lead.dueAt);
  }) : [];
  const incomingLeadTasks = taskView === "Completed" || !showDetailedTaskLists ? [] : state.inboxLeads.flatMap((lead) => {
    const shared = !lead.officerEmail && admin && taskOfficer === "mine";
    if (!taskScope(lead) && !shared) return [];
    if (lead.heldAt) {
      const dueAt = lead.revisitDate && `${lead.revisitDate}T17:00:00.000Z`;
      return dueAt && dueInView(dueAt) && (admin || lead.officerEmail === staff?.email)
        ? [{ lead, title: "Review lead on hold", dueAt }] : [];
    }
    if (lead.outreachSuppressed || escalatedLeads.has(lead.id)) return [];
    const due = firstContactOverdue(lead, taskNow);
    if (!lead.followUp.firstContactAt && !lead.followUp.replyReceivedAt && (due || !lead.realtorId) && dueInView(lead.dueAt)) {
      return [{ lead, title: due ? "First contact overdue" : "Contact new lead", dueAt: lead.dueAt }];
    }
    const nextAt = lead.followUp.nextAt;
    return !lead.campaignId && lead.followUp.status === "Active" && nextAt && Date.parse(nextAt) <= taskNow && dueInView(nextAt)
      ? [{ lead, title: "Mock follow-up step due", dueAt: nextAt }] : [];
  });
  const importedLeadTasks = showDetailedTaskLists ? state.inboxLeads.flatMap((lead) => {
    const shared = !lead.officerEmail && admin && taskOfficer === "mine";
    if (!taskScope(lead) && !shared) return [];
    return lead.importedTasks.map((task) => ({ lead, task, blocked: prospectingBlocked(task.purpose, lead.outreachSuppressed) }))
      .filter(({ task, blocked }) => taskView === "All" || (taskView === "Completed" ? task.completedAt : !lead.heldAt && !task.completedAt && !blocked && dueInView(task.dueAt)));
  }) : [];
  const campaignByCallback = new Map(state.callCampaignMembers.flatMap((member) =>
    member.callbackTaskId ? [[member.callbackTaskId, member.campaignId] as const] : []));
  const showUwmAlerts = uwmEnabled && showDetailedTaskLists && (taskView === "Open" || taskView === "Completed" || taskView === "All");
  const visibleUwmAlerts = showUwmAlerts ? state.uwmAlerts.flatMap((alert) => {
    const loan = taskLoans.get(alert.loanId);
    const matchesView = taskView === "All" || (taskView === "Completed" ? !!alert.reviewedAt : !alert.reviewedAt && activeLoanWork(alert.loanId));
    return loan && taskScope(loan) && matchesView && (!taskFocus || workMatches(loan, taskFocus)) ? [{ loan, alert }] : [];
  }) : [];
  const visibleTasks = showDetailedTaskLists ? state.tasks.filter((task) => {
    if (isPlaybookTask(task)) return false;
    const loan = taskLoans.get(task.loanId);
    if (!loan || !taskScope(loan) || (taskFocus && !workMatches(loan, taskFocus))) return false;
    if (taskView === "All") return true;
    if (taskView === "Completed") return !!task.completedAt;
    if (task.completedAt || loanTaskBlocked(task) || pausedLoan(loan)) return false;
    return dueInView(task.dueAt);
  }) : [];

  async function save(input: unknown, after?: (result: WorkspaceMutationSuccess) => void, announce = true, scope?: WorkspaceMutationScope) {
    if (pending.current) return;
    const writeVersion = ++loanReadVersion.current;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let result: Awaited<ReturnType<typeof mutate>>;
      if (staff && input && typeof input === "object" && "type" in input && input.type === "convertReferral") {
        const response = await fetch(`/api/lead-conversion?brokerage=${encodeURIComponent(staff.brokerage.id)}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
        });
        if (response.status === 401) throw new Error(staffSignInRequired);
        result = await response.json() as LeadInboxMutation | { error: string };
      } else result = await mutate(input, staff?.brokerage.id ?? demoBrokerageId, scope);
      if ("error" in result) {
        setError(result.error);
        if ((result.error === reopenedMockClosingMessage || result.error === staleProcessingHandoff) &&
          modal?.kind === "details" && writeVersion === loanReadVersion.current) {
          const currentLoan = await readLoanForWork(modal.loanId, staff?.brokerage.id ?? demoBrokerageId).catch(() => null);
          if (currentLoan && !("error" in currentLoan) && writeVersion === loanReadVersion.current) {
            setLoanWork(currentLoan);
            setState((current) => applyLoanMutation(current, currentLoan));
          }
        }
        if ("claimConflict" in result && result.claimConflict) {
          if (section === "Lead Inbox") setState((current) => ({ ...current }));
          if (section === "Call Campaigns" && selectedCampaignId) {
            const refreshed = await mutate({ type: "openCampaigns", campaignId: selectedCampaignId, loadIntake: false },
              staff?.brokerage.id ?? demoBrokerageId).catch(() => null);
            if (refreshed && "campaignNavigation" in refreshed) {
              setState((current) => applyCampaignNavigation(current, refreshed.campaignNavigation));
              setSelectedCampaignId((current) => current === selectedCampaignId ? refreshed.campaignNavigation.queue?.campaignId ?? "" : current);
            } else setError(`${result.error} Use Refresh queue to check for other leads.`);
          }
        }
        return;
      }
      if ("campaignNavigation" in result) {
        setState((current) => applyCampaignNavigation(current, result.campaignNavigation));
        setSelectedCampaignId(result.campaignNavigation.queue?.campaignId ?? "");
        return;
      }
      if ("campaignQueue" in result) {
        setState((current) => applyCampaignQueue(current, result.campaignQueue));
        if (announce) setNotice(result.message);
        after?.({ state: applyCampaignQueue(state, result.campaignQueue), message: result.message });
        return;
      }
      if ("campaignWork" in result) {
        const { campaignWork, segments } = result;
        const apply = (current: Workspace) => {
          const next = campaignWork ? applyCampaignMutation(current, campaignWork) : current;
          return segments ? { ...next, crmSegments: segments } : next;
        };
        if (campaignWork || segments) setState(apply);
        if (announce) setNotice(result.message);
        after?.({ state: apply(state), message: result.message, migration: result.migration, segmentPreview: result.segmentPreview });
        return;
      }
      if ("contactsChanged" in result && result.borrowerChannels) {
        const { contactId, blocked } = result.borrowerChannels;
        const updateContact = <T extends Contact>(contact: T) => contact.id === contactId ? { ...contact, outreachChannelBlocks: blocked } : contact;
        const apply = (current: Workspace) => ({ ...current, contacts: current.contacts.map(updateContact) });
        setState(apply);
        setLoanWork((current) => current && { ...current, contacts: current.contacts.map(updateContact) });
        setSearchContact((current) => current?.contact.id === contactId ?
          { ...current, contact: { ...current.contact, outreachChannelBlocks: blocked } } : current);
        if (announce) setNotice(result.message);
        after?.({ state: apply(state), message: result.message });
        return;
      }
      if ("contactsChanged" in result || "tasksChanged" in result) {
        setState((current) => ({ ...current }));
        setWorkspaceStatus("cold");
        setLoanWork(undefined);
        setSearchContact(undefined);
        if (announce) setNotice(result.message);
        after?.({ state, message: result.message });
        return;
      }
      if ("inboxChanged" in result) {
        const { inboxLoan, referralLoanId, restoredLeadId, convertedLead, convertedCampaign, message } = result;
        const apply = (current: Workspace) => {
          if (convertedLead && inboxLoan) return applyLeadConversion(current, convertedLead, inboxLoan, convertedCampaign);
          const refreshed = convertedCampaign ? applyCampaignQueue(current, convertedCampaign) : current;
          return inboxLoan ? applyLoanMutation(refreshed, inboxLoan) : { ...refreshed };
        };
        setState(apply);
        setWorkspaceStatus("cold");
        setLoanWork(inboxLoan);
        setSearchContact(undefined);
        if (announce) setNotice(message);
        after?.({ state: apply(state), message, referralLoanId, restoredLeadId });
        return;
      }
      if ("realtorChanged" in result) {
        setState((current) => ({ ...current }));
        setWorkspaceStatus("cold");
        if (announce) setNotice(result.message);
        after?.({ state, message: result.message });
        return;
      }
      if ("migrationChanged" in result) {
        if (result.migrationChanged) invalidateWorkspace();
        if (announce) setNotice(result.message);
        after?.({ state, message: result.message, migration: result.migration,
          applicationLoanId: result.applicationLoanId, mismoDuplicateLoanId: result.mismoDuplicateLoanId });
        return;
      }
      if ("playbookSettings" in result) {
        setState((current) => ({ ...current, playbook: result.playbookSettings }));
        setLoanWork((current) => current && { ...current, playbook: result.playbookSettings });
        if (announce) setNotice(result.message);
        after?.({ state: { ...state, playbook: result.playbookSettings }, message: result.message });
        return;
      }
      if ("template" in result) {
        const { template, message } = result;
        const update = (templates: Workspace["brokerageTemplates"]) => [...templates.filter((item) =>
          item.audience !== template.audience || item.milestone !== template.milestone), template];
        const apply = (current: Workspace) => ({ ...current, brokerageTemplates: update(current.brokerageTemplates) });
        setState(apply);
        setLoanWork((current) => current && { ...current, brokerageTemplates: update(current.brokerageTemplates) });
        if (announce) setNotice(message);
        after?.({ state: apply(state), message });
        return;
      }
      if (!("leadWork" in result)) {
        const updated = "loanWork" in result ? result.loanWork : result.state;
        for (const token of borrowerChecklistTokens(input, updated.applications, updated.documentRequests, updated.borrowerQuestions)) {
          void announceBorrowerChange(token, "checklist-changed");
        }
        for (const token of borrowerDisclosureTokens(input, updated.applications)) {
          void announceBorrowerChange(token, "disclosure-changed");
        }
      }
      if ("leadWork" in result) {
        setState((current) => applyLeadMutation(current, result));
        if (announce) setNotice(result.message);
        after?.({ state: applyLeadMutation(state, result), message: result.message });
        return;
      }
      if ("loanWork" in result) {
        setState((current) => applyLoanMutation(current, result.loanWork));
        setLoanWork(result.loanWork);
        if (result.loanFormSaved || result.applicationLoanId) setWorkspaceStatus("cold");
        if (announce) setNotice(result.message);
        after?.({ state: applyLoanMutation(state, result.loanWork), message: result.message,
          applicationToken: result.applicationToken, applicationLoanId: result.applicationLoanId });
        return;
      }
      setState(result.state);
      setWorkspaceStatus("ready");
      setLoanWork(undefined);
      setSearchContact(undefined);
      if (announce) setNotice(result.message);
      after?.(result);
    } catch (failure) {
      setError(staff && failure instanceof Error && failure.message === staffSignInRequired
        ? staffSignInRequired : "Could not reach Orbit. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function convertLead(id: string, contactId: string | null, allowDuplicate: boolean, scope?: "inbox", after?: () => void, intakeReview?: QuotePrefillSelection) {
    void save({ type: "convertReferral", referralId: id, contactId, allowDuplicate, intakeReview }, ({ referralLoanId }) => {
      if (referralLoanId) {
        after?.();
        setModal({ kind: "details", loanId: referralLoanId, target: "loan-application" });
      }
    }, true, scope);
  }

  async function sync() {
    if (pending.current) return;
    setSyncing(true);
    try {
      await save({ type: "sync" });
    } finally {
      setSyncing(false);
    }
  }

  function loadCampaigns(id?: string, loadIntake = false) {
    if (pending.current) {
      deferredCampaignLoad.current = { id, loadIntake };
      return;
    }
    void save({ type: "openCampaigns", campaignId: id || undefined, loadIntake }, undefined, false);
  }

  async function loadFullWorkspace() {
    if (pending.current) return;
    setWorkspaceStatus("loading");
    await save({ type: "refreshWorkspace" }, undefined, false);
    setWorkspaceStatus((current) => current === "loading" ? "failed" : current);
  }

  const loadWorkspaceOnDemand = useEffectEvent(() => { void loadFullWorkspace(); });
  useEffect(() => {
    if (waitingForWorkspace && !busy && workspaceStatus === "cold") loadWorkspaceOnDemand();
  }, [waitingForWorkspace, busy, workspaceStatus]);

  const resumeCampaignLoad = useEffectEvent(() => {
    const request = deferredCampaignLoad.current;
    if (!request || pending.current) return;
    deferredCampaignLoad.current = undefined;
    loadCampaigns(request.id, request.loadIntake);
  });
  useEffect(() => {
    if (section === "Call Campaigns" && !busy) resumeCampaignLoad();
  }, [busy, section]);

  function selectCampaign(id: string, alreadyLoaded = false) {
    if (alreadyLoaded) setSelectedCampaignId(id);
    else loadCampaigns(id);
  }

  function navigate(next: Section, refresh = true, campaignId?: string, attention = false, preserveConversationOrigin = false) {
    if (!preserveConversationOrigin) { setConversationOrigin(undefined); conversationReturn.current = undefined; }
    openingRecord.current = false;
    recordTrigger.current = null;
    if (next !== "Call Campaigns") deferredCampaignLoad.current = undefined;
    setSection(next);
    setRenewalVisit(undefined);
    setRenewalReturn(undefined);
    setReportScheduleTarget(undefined);
    setReportScheduleReturn(undefined);
    setFirstDayDestination(undefined);
    setFirstDayReturn(undefined);
    if (!preserveConversationOrigin) setAttentionVisit((last) => attention ? { section: next, visit: (last?.visit ?? 0) + 1 } : undefined);
    if (next !== "Contacts") setContactToolsOpen(false);
    setGuideCallbackId(undefined);
    setFocusContactTask(undefined);
    if (mobileNavOpen) {
      setMobileNavOpen(false);
      mobileMenu.current?.focus();
    }
    setFocusLeadId(undefined);
    setFocusArchivedLeadId(undefined);
    setFocusLeadTaskId(undefined);
    setFocusLeadDocumentId(undefined);
    setOpenLeadRouting(false);
    setQuery("");
    setError("");
    if (workspaceStatus === "failed") setWorkspaceStatus("cold");
    if (next === "Call Campaigns") {
      if (campaignId) setSelectedCampaignId(campaignId);
      if (refresh) loadCampaigns(campaignId ?? selectedCampaignId, true);
    } else if (workspaceStatus === "ready" && refresh && ((next === "Tasks" && !pagedTasks) ||
      (next === "Reports" && canReport && reportTab !== "Owner scorecard" && reportTab !== "Funding dashboard" &&
        reportTab !== "Pipeline workload" && reportTab !== "Sales conversion" && reportTab !== "Referral queue" && reportTab !== "Custom reports"))) {
      void save({ type: "refreshWorkspace" }, undefined, false);
    }
  }

  function openBrokerageView(next: Section, attention = false) {
    focusSection.current = true;
    navigate(next, false, undefined, attention);
  }

  function openFirstDayStep(step: FirstDayStepId | "pilot-tools") {
    switch (step) {
      case "staff-access":
      case "loan-defaults":
      case "pilot-tools":
        setTeamPanel(step === "staff-access" ? "Staff access" : step === "loan-defaults" ? "Loan settings" : "Pilot tools");
        openBrokerageView("Team");
        break;
      case "branches":
        setTeamPanel("Branches");
        openBrokerageView("Team");
        break;
      case "licensing":
        if (complianceEnabled) openBrokerageView("Compliance");
        else {
          setTeamPanel("Workspaces");
          openBrokerageView("Team");
        }
        break;
      case "lead-routing":
      case "lead-inbox":
        openBrokerageView("Lead Inbox");
        setOpenLeadRouting(step === "lead-routing");
        break;
      case "assign-processing":
      case "accept-handoff":
      case "assigned-files":
        openBrokerageView("Processing");
        break;
      case "today":
        openBrokerageView("Today");
        break;
      case "processing-tasks":
        openBrokerageView("Tasks");
        break;
      case "loan-pipeline":
        openBrokerageView("Pipeline");
        break;
    }
    setFirstDayDestination(step);
  }

  function openFirstDayChecklist() {
    if (!firstDayDestination) {
      openBrokerageView("First-day checklist");
      return;
    }
    navigate("First-day checklist", false);
    setFirstDayReturn(firstDayDestination);
  }

  function openBrokerageReport(report: BrokerageReport) {
    setReportTab(report);
    openBrokerageView("Reports");
  }

  function openLicenseRenewal(visit: LicenseRenewalVisit, origin: "Brokerage" | "Today" = "Brokerage") {
    openBrokerageView("Compliance");
    setRenewalVisit({ ...visit, origin });
  }

  function returnToLicenseRenewals() {
    const visit = renewalVisit;
    openBrokerageView(visit?.origin ?? "Brokerage");
    setRenewalReturn(visit);
  }

  function openReportSchedule(reportId?: string) {
    navigate("Reports", false);
    setReportTab("Custom reports");
    setReportScheduleTarget({ reportId });
  }

  function returnToReportScheduleQueue() {
    const target = reportScheduleTarget;
    navigate("Brokerage", false);
    setReportScheduleReturn(target);
  }

  function show(next: Modal) {
    if (!modal && !recordTrigger.current && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      recordTrigger.current = document.activeElement;
    }
    loanReadVersion.current += 1;
    openingRecord.current = false;
    setSearchContact(undefined);
    setError("");
    setModal(next.kind === "details" && next.target === fundingCheckInTarget ? {
      kind: "fundingCheckIn", loanId: next.loanId, campaignLender: next.campaignLender,
      returnToLoan: modal?.kind === "details" && modal.loanId === next.loanId,
    } : next.kind === "details" && next.target === sharedQuoteReviewTarget && !processor ? {
      kind: "pricing", loanId: next.loanId, campaignLender: next.campaignLender, reviewSharedQuote: true,
    } : next);
  }

  async function openContactRecord(id: string, edit = false, relationshipKind?: "contact" | "partner") {
    if (pending.current) return;
    pending.current = true;
    openingRecord.current = true;
    setBusy(true);
    setError("");
    try {
      const brokerageId = staff?.brokerage.id ?? demoBrokerageId;
      const result = relationshipKind ? await searchWorkspace({ type: "open", id, kind: relationshipKind }, brokerageId) :
        await readContactsWork({ type: "open", id }, brokerageId);
      if (!openingRecord.current) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "contact") {
        if (edit && result.contact.id !== id) { setError(contactUnavailable); return; }
        show({ kind: edit ? "contact" : "contactHistory", contactId: result.contact.id });
        setSearchContact(result);
      }
    } catch {
      if (openingRecord.current) setError(contactUnavailable);
    } finally {
      openingRecord.current = false;
      pending.current = false;
      setBusy(false);
    }
  }

  async function openQueueLoan(next: Extract<Modal, { kind: "details" | "pricing" | "communication" | "retention" | "returningClient" }>,
    expected?: { kind: "task" | "document" | "retention" | "alert"; id: string } | { kind: "stalled" | "brokerage-stalled" } |
      { kind: "promised-callback"; id: string; dueAt: string; source?: "personal" | "manager" } |
      { kind: "guide-conditions"; submissionId: string; conditionId?: string } |
      { kind: "file-exception"; item: FileException } |
      { kind: "manual-return-work"; submissionId: string | null; eventId?: string; personal: boolean } |
      { kind: "incoming-loan-work"; item: IncomingLoanWorkItem; view: IncomingLoanWorkQuery["view"] }) {
    if (pending.current) return;
    if (!modal) {
      const focused = document.activeElement;
      recordTrigger.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    }
    loanReadVersion.current += 1;
    pending.current = true;
    openingRecord.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const context = expected?.kind === "stalled" || expected?.kind === "brokerage-stalled" ? expected.kind : undefined;
      const result = await readLoanForWork(next.loanId, staff?.brokerage.id ?? demoBrokerageId, context);
      if (!openingRecord.current) return;
      if ("error" in result) { setError(result.error ?? "Could not open the loan. Please try again."); return; }
      if (next.kind === "retention" && (processor || !pastClientLoan(result.loans[0]))) {
        setError("Past-client follow-up is unavailable on this loan.");
        return;
      }
      if (next.kind === "returningClient") {
        const option = result.repeatOption;
        if (option.kind === "campaign") {
          setError("This borrower already has a campaign lead. Work it from Lead Inbox or Call Campaigns.");
          return;
        }
        if (option.kind === "restricted" || option.kind === "unavailable") {
          setError(option.kind === "restricted" ? "Ask a brokerage admin to review access to the linked returning-client application." :
            "This returning-client application is unavailable. Refresh Past Clients.");
          return;
        }
        if (option.kind === "open") {
          const repeat = await readLoanForWork(option.loanId, staff?.brokerage.id ?? demoBrokerageId);
          if (!openingRecord.current) return;
          if ("error" in repeat) { setError(repeat.error ?? "Could not open the repeat 1003. Please try again."); return; }
          setLoanWork(repeat);
          show({ kind: "details", loanId: option.loanId, target: "loan-application" });
          return;
        }
        if (next.fromRateWatch && (!result.tasks.some((task) => task.id === `rate-watch:${next.loanId}` && !task.completedAt) ||
          !rateFollowUpContext(result.pastClients[0]) || result.contacts.some((contact) => contact.id === result.loans[0].contactId && contact.outreachSuppressed))) {
          setError("This rate-watch follow-up changed. Refresh the loan before starting its refinance 1003.");
          return;
        }
        setLoanWork(result);
        show(option.fromRateWatch ? { ...next, fromRateWatch: true } : next);
        return;
      }
      if (next.kind === "communication" && !result.communicationDrafts.some((draft) => draft.id === next.draftId && draft.audience === next.audience &&
        draft.contactId === (next.audience === "Borrower" ? result.loans[0]?.contactId : result.loans[0]?.partnerId))) {
        setError("This draft or its recipient changed. Refresh drafts before opening it.");
        return;
      }
      if (expected?.kind === "manual-return-work") {
        const work = result.manualReturn;
        const ownsQueue = !staff || (expected.personal ? result.loans[0].officerEmail === staff.email : admin);
        if (!ownsQueue || work?.submissionId !== expected.submissionId || (expected.eventId && work.eventId !== expected.eventId)) {
          setReviewVersion((version) => version + 1);
          setError("This lender return changed. Check the refreshed queue.");
          return;
        }
        setLoanWork(result);
        show({ kind: "details", loanId: next.loanId, target: manualReturnSteps[work.status].target });
        return;
      }
      if (expected?.kind === "incoming-loan-work") {
        const { item, view } = expected;
        const loan = result.loans[0];
        const letter = isPreapprovalWork(item.kind) ? result.preapprovalWork : undefined;
        const assigned = result.loanProcessing[0];
        const inQueue = view === "today" ? !!letter || !staff || loan.officerEmail === staff.email :
          !!assigned?.processorEmail && incomingLoanWorkProcessingStatuses.some((status) => status === assigned.status) &&
          (!processor || assigned.processorEmail === staff?.email);
        const application = result.applications[0];
        const readyToAccept = !application?.correctionNote && (!application?.submittedAt || !!application.reviewedAt) &&
          !secondReviewBlocker(result.playbook.requireSecondReview, application);
        const current = item.kind === "application" ? application?.loanId === item.id && application.revision === item.revision &&
          application.submittedAt && !application.reviewedAt : item.kind === "document" ?
          result.documentRequests.some((request) => request.id === item.id && request.revision === item.revision && request.status === "Received") :
          item.kind === "question" ? result.borrowerQuestions?.some((question) =>
            question.id === item.id && question.revision === item.revision && question.status === "Answered") :
          item.kind === "underwriting" ? view === "today" && result.mockCreditAusRuns.some((run) =>
            run.id === item.id && (run.applicationRevision ?? 0) === item.revision && run.result.status === unconfirmedMockOrder) :
          item.kind === "realtor-financing" ? view === "today" && result.realtorFinancingReadyId === item.id :
          isPreapprovalWork(item.kind) ? view === "today" && letter?.kind === item.kind &&
            letter.revision === item.revision && letter.receivedAt === item.receivedAt :
          assigned?.loanId === item.id && assigned.revision === item.revision && !!assigned.processorEmail &&
          (view === "today" ? assigned.status === "Returned to LO" : assigned.status === "Ready for processing" && readyToAccept);
        if (!inQueue || !current || loan.disposition !== "Active" || loan.stage === "Funded" || loan.stage === "Closed") {
          setReviewVersion((version) => version + 1);
          setError("This item changed. Check the updated incoming work list.");
          return;
        }
      }
      if (expected?.kind === "file-exception") {
        const { item } = expected;
        const loan = result.loans[0];
        const application = result.applications[0];
        const underwriting = item.kind === "Underwriting conflicts";
        const current = underwriting ? result.mockCreditAusRuns.some((run) =>
          run.id === item.id && run.result.status === unconfirmedMockOrder && run.conflict?.detectedAt === item.sortOn && !run.conflict.reviewedAt) :
          item.kind === "Unassigned handoffs" ?
          application?.submittedAt && application.reviewedAt && !application.correctionNote && !result.loanProcessing[0]?.processorEmail :
          item.kind === "Disclosure reviews" ? result.tasks.some(({ id, completedAt }) => id === item.id && !completedAt) :
            result.submissions.some(({ id, conditions }) => id === item.parentId &&
              conditions.some((condition: Submission["conditions"][number]) => condition.id === item.id && !condition.satisfiedAt));
        if (!canReport || !current || (!underwriting && (loan.disposition !== "Active" || loan.stage === "Funded" || loan.stage === "Closed"))) {
          setReviewVersion((version) => version + 1);
          setError("This exception changed. Check the refreshed queue.");
          return;
        }
      }
      if (expected && "id" in expected &&
        !(expected.kind === "document" ? result.documentRequests : expected.kind === "alert" ? result.uwmAlerts : result.tasks).some(({ id }) => id === expected.id)) {
        setError(expected.kind === "retention" ? "This follow-up is no longer available. Refresh your opportunities." : searchRecordUnavailable);
        return;
      }
      if (expected?.kind === "promised-callback") {
        const loan = result.loans[0];
        const task = result.tasks.find(({ id }) => id === expected.id);
        const contact = result.contacts.find(({ id }) => id === loan.contactId);
        if (!task || task.completedAt || task.dueAt !== expected.dueAt || loan.disposition !== "Active" ||
          (staff && loan.officerEmail !== staff.email && !(expected.source === "manager" && admin)) ||
          (expected.source && task.campaignCallback !== "Pending") || prospectingBlocked(task.purpose, contact?.outreachSuppressed)) {
          const view = expected.source === "manager" ? "Overdue callbacks" : expected.source === "personal" ? "My campaign callbacks" : "the conversation";
          setError(`This promised callback changed. Refresh ${view} to see the current task.`);
          return;
        }
      }
      if (expected?.kind === "retention") {
        const loan = result.loans[0];
        const task = result.tasks.find(({ id }) => id === expected.id);
        if (!loan || !pastClientLoan(loan) || loan.disposition !== "Active" || (staff && loan.officerEmail !== staff.email) || task?.completedAt ||
          result.contacts.some((contact) => contact.id === loan.contactId && contact.outreachSuppressed)) {
          setError("This follow-up is no longer available. Refresh your opportunities.");
          return;
        }
      }
      setLoanWork(result);
      if (expected?.kind === "guide-conditions" || result.playbook.requireSecondReview || state.playbook.requireSecondReview ||
        state.campaignQueueFiles?.some(({ id }) => id === next.loanId)) {
        setState((current) => applyLoanMutation(current, result));
      }
      if (expected?.kind === "guide-conditions") {
        const submission: Submission | undefined = result.submissions.find(({ id }) => id === expected.submissionId);
        if (!submission) {
          setError("This lender checklist changed. Choose the current step in the demo guide.");
          return;
        }
        const condition = submission.conditions.find(({ id }) => id === expected.conditionId);
        show({ kind: "details", loanId: next.loanId,
          target: condition ? conditionTarget(submission.id, condition.id) : submissionTarget(submission.id) });
        return;
      }
      const fundingId = expected?.kind === "task" && next.kind === "details" && next.target === "loan-communications" ? expected.id : undefined;
      const fundingAudience = fundingId ? fundingTaskAudience(fundingId) : null;
      const fundingTask = fundingAudience && result.tasks.some((task) => task.id === fundingId && !task.completedAt);
      if (fundingAudience && fundingTask) {
        const loan = result.loans[0];
        const recipient = fundingAudience === "Borrower" ? loan?.contactId : loan?.partnerId;
        const draft = result.communicationDrafts.find((item) => !item.supersededAt && item.audience === fundingAudience &&
          item.contactId === recipient && item.milestone === fundingMilestones[fundingAudience]);
        if (draft) {
          show({ kind: "communication", loanId: next.loanId, audience: fundingAudience, draftId: draft.id });
          return;
        }
      }
      const alert = expected?.kind === "alert" ? result.uwmAlerts.find(({ id }) => id === expected.id) : undefined;
      const submission: Submission | undefined = alert && result.submissions.find(({ id }) => id === alert.submissionId);
      const condition = submission?.conditions.find(({ id }) => id === alert?.conditionId);
      const target = alert ? submission ? condition ? conditionTarget(submission.id, condition.id) : submissionTarget(submission.id) :
        "lender-submissions" : result.workTarget;
      show(next.kind === "details" && target && next.target !== sharedQuoteReviewTarget ? { ...next, target } : next);
    } catch (failure) {
      if (openingRecord.current) setError(staff && failure instanceof Error && failure.message === staffSignInRequired
        ? staffSignInRequired : "Could not open the loan. Please try again.");
    } finally {
      if (!modal && openingRecord.current) recordTrigger.current = null;
      openingRecord.current = false;
      pending.current = false;
      setBusy(false);
    }
  }

  const openSupportLoan = useEffectEvent((loanId: string, group: SupportWorkGroup) => {
    void openQueueLoan({ kind: "details", loanId, target: group === "handoffs" ? "processing-handoff" : "lender-submissions" });
  });
  useEffect(() => {
    if (!initialSupport || supportOpened.current) return;
    supportOpened.current = true;
    openSupportLoan(initialSupport.loanId, initialSupport.group);
  }, [initialSupport]);

  async function refreshLoanOnReturn(loanId: string, canApply: () => boolean, periodic: boolean) {
    if (!staff || pending.current || (periodic && loanRefreshInFlight.current !== null)) return;
    const version = ++loanReadVersion.current;
    loanRefreshInFlight.current = version;
    try {
      const knownVersion = periodic && loanWork?.loanId === loanId ? loanWork.handoffVersion : undefined;
      const result = knownVersion ? await checkLoanHandoff(loanId, staff.brokerage.id, knownVersion) : await readLoanForWork(loanId, staff.brokerage.id);
      if (version !== loanReadVersion.current || pending.current || "unchanged" in result || !canApply()) return;
      if ("error" in result) {
        if (result.error === loanWorkUnavailable) {
          close();
          setError(result.error);
          setReviewVersion((value) => value + 1);
        }
        return;
      }
      setLoanWork(result);
      setState((current) => applyLoanMutation(current, result));
    } catch {
      // The explicit refresh remains available if the background read fails.
    } finally {
      if (loanRefreshInFlight.current === version) loanRefreshInFlight.current = null;
    }
  }

  function showGuideTasks(loanId?: string, callbackId?: string, refresh = true, allOfficers = false) {
    if (staff && callbackId) {
      setDetailedTasks(false);
      navigate("Tasks", false);
      setFocusContactTask(callbackId);
      return;
    }
    const loan = loanId && taskLoans.get(loanId);
    const callback = callbackId && state.contactActivity.find((item) => item.id === callbackId);
    const owner = callback ? { officer: callback.followUpOwner ?? "", officerEmail: callback.followUpOwnerEmail } : loan;
    setTaskView("Open");
    setDetailedTasks(true);
    setTaskFocus("");
    const otherOwner = owner && canReport && owner.officerEmail !== staff.email;
    setTaskOfficer(allOfficers || (!staff && callback) ? "" : otherOwner ? (owner.officer || owner.officerEmail ? taskOwner(owner) : "") : "mine");
    navigate("Tasks", refresh);
    setGuideCallbackId(callbackId);
  }

  function openLeadWork(leadId: string, campaignId?: string | null, refresh = true) {
    navigate(campaignId ? "Call Campaigns" : "Lead Inbox", refresh, campaignId ?? undefined);
    setFocusLeadId(leadId);
  }

  function openMigrationDestination(destination: MigrationDestination) {
    switch (destination.kind) {
      case "loan": return void openQueueLoan({ kind: "details", loanId: destination.id, target: destination.target });
      case "lead": return void openScopedLead({ leadId: destination.id });
      case "archivedLead":
        navigate("Lead Inbox", false);
        setFocusArchivedLeadId(destination.id);
        return;
      case "contact": return void openContactRecord(destination.id);
      case "contactTask": return showGuideTasks(undefined, destination.id, false, true);
    }
  }

  async function openScopedLead(input: LeadWorkRequest, preferInbox = false) {
    if (pending.current) return;
    pending.current = true;
    openingRecord.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setFocusLeadId(undefined);
    try {
      const result = await readLeadForWork(input, staff?.brokerage.id ?? demoBrokerageId);
      if (!openingRecord.current) return;
      if ("error" in result) { setError(result.error); return; }
      if ("loanWork" in result) {
        setLoanWork(result.loanWork);
        setState((current) => applyLoanMutation(current, result.loanWork));
        show({ kind: "details", loanId: result.loanWork.loanId, target: searchTaskTarget(result.callbackTaskId) });
        return;
      }
      setState((current) => applyLeadWork(current, result));
      const campaignId = preferInbox ? undefined : result.campaign?.id;
      openLeadWork(result.lead.id, campaignId, Boolean(campaignId));
      if (input.task?.kind === "lead-task") setFocusLeadTaskId(input.task.id);
    } catch (failure) {
      if (openingRecord.current) setError(staff && failure instanceof Error && failure.message === staffSignInRequired
        ? staffSignInRequired : "Could not open the lead. Please try again.");
    } finally {
      openingRecord.current = false;
      pending.current = false;
      setBusy(false);
    }
  }

  function openConversation(focus: ConversationFocus) {
    const origin = section === "Today" || section === "Call Campaigns" ? section : undefined;
    conversationReturn.current = origin ? {
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      key: "leadId" in focus ? `lead:${focus.leadId}` : "id" in focus ? `thread:${focus.id}` : "",
      x: window.scrollX, y: window.scrollY,
    } : undefined;
    navigate("Communications", false, undefined, false, Boolean(origin));
    setConversationOrigin(origin);
    setCommunicationView("Conversations");
    setConversationFocus(focus);
  }

  async function returnFromConversation() {
    if (!conversationOrigin || pending.current) return;
    const target = conversationReturn.current;
    if (conversationOrigin === "Call Campaigns") {
      await save({ type: "openCampaigns", campaignId: selectedCampaignId || undefined, loadIntake: true }, undefined, false);
      if (conversationReturn.current !== target) return;
    }
    setSection(conversationOrigin);
    setConversationOrigin(undefined);
    setConversationFocus(null);
    setReviewVersion((value) => value + 1);
    requestAnimationFrame(() => {
      const trigger = target?.key ? document.querySelector<HTMLElement>(`[data-conversation-origin="${CSS.escape(target.key)}"]`) : target?.trigger;
      if (target && trigger?.isConnected && trigger.getClientRects().length) {
        trigger.focus({ preventScroll: true });
        window.scrollTo(target.x, target.y);
      } else {
        sectionHeading.current?.focus({ preventScroll: true });
        sectionHeading.current?.scrollIntoView({ block: "start" });
      }
    });
  }

  function openConversationCallback(callback: ConversationCallback) {
    const { taskId, dueAt } = callback;
    if ("leadId" in callback) return void openScopedLead({ leadId: callback.leadId, task: { kind: "campaign", id: taskId, expectedCallbackAt: dueAt } });
    void openQueueLoan({ kind: "details", loanId: callback.loanId, target: searchTaskTarget(taskId) }, { kind: "promised-callback", id: taskId, dueAt });
  }

  function openTodayWork(item: OfficerQueueItem) {
    if (item.kind === "lead" || item.kind === "campaign" || item.kind === "sequence") {
      return void openScopedLead({ leadId: item.recordId, task: { kind: item.kind, id: item.id } });
    }
    openDeadlineWork(item);
  }

  function openIncomingLoanWork(item: IncomingLoanWorkItem, view: IncomingLoanWorkQuery["view"]) {
    if (item.kind === "lead-document") return void openLeadDocumentWork(item.leadId, item.id);
    if (item.kind === "lender-return") return void openQueueLoan({ kind: "details", loanId: item.loanId },
      { kind: "manual-return-work", submissionId: item.returnSubmissionId === undefined ? item.id : item.returnSubmissionId,
        eventId: item.returnEventId, personal: true });
    const target = item.kind === "application" ? "loan-application" : item.kind === "document" ? `document-${item.id}` :
      item.kind === "question" ? staffQuestionTarget(item.id) : item.kind === "underwriting" ? creditAusAttemptTarget(item.id) :
      item.kind === "realtor-financing" ? realtorFinancingTarget : isPreapprovalWork(item.kind) ? samplePreapprovalTarget : "processing-handoff";
    void openQueueLoan({ kind: "details", loanId: item.loanId, target }, { kind: "incoming-loan-work", item, view });
  }

  function openComplianceFinding(loanId: string, caseId: string) {
    void openQueueLoan({ kind: "details", loanId, target: complianceCaseTarget(caseId) });
  }

  async function openLeadDocumentWork(leadId: string, requestId: string) {
    if (pending.current) return;
    pending.current = true;
    openingRecord.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    let location: LeadDocumentLocation | undefined;
    try {
      const brokerageId = staff?.brokerage.id ?? demoBrokerageId;
      const response = await fetch(`/api/lead-documents?brokerage=${encodeURIComponent(brokerageId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "locate", leadId, requestId }),
      });
      const result = await response.json() as { location: LeadDocumentLocation } | { error: string };
      if (!openingRecord.current) return;
      if ("error" in result) { setError(result.error); return; }
      if (!response.ok) throw new Error(leadDocumentsUnavailable);
      location = result.location;
    } catch {
      if (openingRecord.current) setError("Could not open this document request. Refresh My Tasks and try again.");
    } finally {
      openingRecord.current = false;
      pending.current = false;
      setBusy(false);
    }
    if (location?.kind === "loan") {
      void openQueueLoan({ kind: "details", loanId: location.recordId, target: `document-${requestId}` }, { kind: "document", id: requestId });
    } else if (location?.kind === "lead") {
      openLeadWork(location.recordId, undefined, false);
      setFocusLeadDocumentId(requestId);
    }
  }

  function openDeadlineWork(item: OfficerQueueItem) {
    if (item.kind === "lead-document" || item.kind === "lead-document-review") {
      return void openLeadDocumentWork(item.recordId, item.id);
    }
    if (item.kind === "conversation") {
      openConversation({ id: item.recordId });
      return;
    }
    if (item.kind === "lead-task") {
      return void openScopedLead({ leadId: item.recordId, task: {
        kind: "lead-task", id: item.id, team: section === "Calendar" && calendar.scope === "Team" ? true : undefined,
      } });
    }
    if (item.kind === "lead" || item.kind === "campaign") {
      return openLeadWork(item.recordId, item.campaignId, !state.inboxLeads.some((lead) => lead.id === item.recordId));
    } else if (item.kind === "contact") {
      return showGuideTasks(undefined, item.id, !state.contactActivity.some((activity) => activity.id === item.id), section === "Calendar");
    } else {
      return void openQueueLoan(item.kind === "lock" ? { kind: "pricing", loanId: item.recordId } : { kind: "details", loanId: item.recordId, target: item.target });
    }
  }

  function openActiveTask(item: OfficerQueueItem) {
    if (item.kind === "lead-hold" || item.kind === "quiet-lead") {
      openLeadWork(item.recordId, item.campaignId);
      return;
    }
    if (item.kind === "lead-task") {
      openLeadWork(item.recordId);
      setFocusLeadTaskId(item.id);
      return;
    }
    if (item.kind === "uwm-alert" || item.kind === "document" || item.kind === "document-review" || item.kind === "loan" || item.kind === "funding") {
      const kind = item.kind === "uwm-alert" ? "alert" : item.kind === "loan" || item.kind === "funding" ? "task" : "document";
      void openQueueLoan({ kind: "details", loanId: item.recordId, target: item.target }, { kind, id: item.id });
      return;
    }
    openDeadlineWork(item);
  }

  function openReturningClient(fundedLoanId: string) {
    void openQueueLoan({ kind: "returningClient", loanId: fundedLoanId });
  }

  async function openSearchResult(record: SearchRecord) {
    const { kind, id, loanId } = record;
    if (kind === "conversation") {
      openConversation({ id });
      return;
    }
    if (kind === "loan" || kind === "task" || kind === "document") {
      if (!loanId) { setError(searchRecordUnavailable); return; }
      const target = kind === "task" ? searchTaskTarget(id) : kind === "document" ? `document-${id}` : undefined;
      await openQueueLoan({ kind: "details", loanId, target }, kind === "loan" ? undefined : { kind, id });
      return;
    }
    if (pending.current) return;
    pending.current = true;
    openingRecord.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await searchWorkspace({ type: "open", kind, id }, staff?.brokerage.id ?? demoBrokerageId);
      if (!openingRecord.current) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "contact") { show({ kind: "contactHistory", contactId: result.contact.id }); setSearchContact(result); }
      else if (result.kind === "lead") {
        setState((current) => applyLeadWork(current, result));
        openLeadWork(result.lead.id, undefined, false);
      }
    } catch {
      if (openingRecord.current) setError("Could not open this search result. Try again.");
    } finally {
      openingRecord.current = false;
      pending.current = false;
      setBusy(false);
    }
  }

  function openPlaybook(item: PlaybookWork) {
    if (item.kind === "lead") {
      void openScopedLead({ leadId: item.recordId });
      return;
    }
    void openQueueLoan({ kind: "details", loanId: item.recordId,
      target: item.kind === "review" ? "loan-application" : item.kind === "funding" ? "loan-communications" : "processing-handoff" },
    item.kind === "funding" ? { kind: "task", id: item.id } : undefined);
  }

  function openFileException(item: FileException, trigger?: HTMLButtonElement) {
    if (pending.current) return;
    exceptionTrigger.current = trigger ?? null;
    void openQueueLoan({ kind: "details", loanId: item.loanId, target: item.target },
      item.kind === "Missing evidence" ? { kind: "document", id: item.id } :
        item.kind === "Manual lender returns" ? { kind: "manual-return-work",
          submissionId: item.returnSubmissionId === undefined ? item.id : item.returnSubmissionId, eventId: item.returnEventId, personal: false } :
          staff && (item.kind === "Unassigned handoffs" || item.kind === "Disclosure reviews" || item.kind === "Reopened conditions" ||
            item.kind === "Underwriting conflicts") ?
            { kind: "file-exception", item } : undefined);
  }

  function openUwmAlert(alert: UwmAlert) {
    const submission = state.submissions.find((item) => item.id === alert.submissionId);
    const condition = submission?.conditions.find((item) => item.id === alert.conditionId);
    let target = "lender-submissions";
    if (submission) target = condition ? conditionTarget(submission.id, condition.id) : submissionTarget(submission.id);
    show({ kind: "details", loanId: alert.loanId, target });
  }

  function invalidateWorkspace() {
    setState((current) => ({ ...current }));
    setWorkspaceStatus("cold");
  }

  function close() {
    if (supportReturn && modal?.kind === "details" && modal.loanId === initialSupport?.loanId) {
      window.location.assign(supportReturn);
      return;
    }
    loanReadVersion.current += 1;
    openingRecord.current = false;
    setError("");
    setLoanWork(undefined);
    setSearchContact(undefined);
    setModal(null);
    const trigger = exceptionTrigger.current;
    const original = recordTrigger.current;
    const currentOrder = modal?.kind === "details" && modal.target?.startsWith(creditAusAttemptTargetPrefix) ?
      loanWork?.mockCreditAusRuns.find((run) => creditAusAttemptTarget(run.id) === modal.target) : undefined;
    const resolvedOrder = currentOrder && currentOrder.result.status !== unconfirmedMockOrder;
    const incomingReturn = section === "Today" && modal?.kind === "details" &&
      (modal.target === realtorFinancingTarget || modal.target === samplePreapprovalTarget);
    if (incomingReturn && modal?.kind === "details" && modal.target === samplePreapprovalTarget) refreshCounts();
    const pipelineLoan = section === "Pipeline" && modal && "loanId" in modal ? modal.loanId : undefined;
    exceptionTrigger.current = null;
    recordTrigger.current = null;
    if (trigger || original || pipelineLoan || incomingReturn) requestAnimationFrame(() => {
      const replacement = pipelineLoan && document.querySelector<HTMLElement>(`[data-loan-record="${CSS.escape(pipelineLoan)}"]`);
      const target = incomingReturn ? document.getElementById("incoming-today-heading") ?? sectionHeading.current : trigger && section === "Exceptions" ?
        (trigger.isConnected && !currentOrder?.conflict?.reviewedAt ? trigger : document.getElementById("owner-exception-filter")) :
        (original?.isConnected && !resolvedOrder ? original : replacement || sectionHeading.current);
      target?.focus({ preventScroll: true });
    });
  }

  function drop(event: DragEvent, stage: Stage) {
    if (!dragged.current) return;
    event.preventDefault();
    const loan = dragged.current;
    dragged.current = null;
    setDropStage(null);
    if (loan.stage !== stage) void save({ type: "move", id: loan.id, stage });
  }

  function openPipelineLoan(loanId: string, target?: string) {
    const next = { kind: "details" as const, loanId, target };
    if (staff || !state.loans.some(({ id }) => id === loanId)) void openQueueLoan(next);
    else show(next);
  }

  function syncButton() {
    if (!admin || !uwmEnabled || uwmConnection.pipeline === "Insights credentials required") return null;
    return <Button variant="outline" onClick={() => void sync()} disabled={busy}><RefreshCw className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync UWM"}</Button>;
  }

  return (
    <div className="shell">
      <aside className="sidebar" onKeyDown={(event) => {
        if (event.key === "Escape" && mobileNavOpen) {
          event.preventDefault();
          setMobileNavOpen(false);
          mobileMenu.current?.focus();
        }
      }}>
        <button type="button" className="brand w-fit rounded-lg hover:text-[var(--orbit-lilac)]" aria-label={canReport ? "OrbitLOS home, brokerage overview" : "OrbitLOS home, back to Pipeline"} disabled={!controlsReady}
          onClick={() => navigate(canReport ? "Brokerage" : "Pipeline")}>
          <span className="brand-icon"><OrbitIcon size={22} aria-hidden="true" /></span><span>OrbitLOS</span>
        </button>
        <Button className="mobile-nav-toggle" ref={mobileMenu} variant="outline" size="sm" type="button" disabled={!controlsReady}
          aria-expanded={mobileNavOpen} aria-controls="workspace-navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
          {mobileNavOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />} Menu
          {!!(actionCounts?.today || actionCounts?.leads || actionCounts?.processing || (canReport && actionCounts?.exceptions)) && !mobileNavOpen && <span className="nav-attention-dot" aria-label="Actions waiting" />}
        </Button>
        <nav id="workspace-navigation" aria-label="Workspace navigation" data-expanded={mobileNavOpen}>
          {navigation.map(({ title, items }) => (
            <div className="nav-group" key={title}>
              <p className="workspace-label">{title}</p>
              {items.filter(({ label }) => (label !== "Brokerage" || canReport) && (label !== "Today" || canOpenToday) && ((label !== "Calendar" && label !== "Coverage" && label !== "Reviews") || canOpenCalendar) && (label !== "Processing" || canOpenProcessing) && (label !== "Exceptions" || canReport) && (label !== "Team" || staff) && (label !== "Reports" || canOpenReports) && (label !== "Migration" || canMigrate) && (label !== "Compliance" || (admin && complianceEnabled)) && (admin || (label !== "Realtors" && label !== "Playbooks")) && (!processor || (label !== "Lead Inbox" && label !== "Demo Guide" && label !== "Call Campaigns"))).map(({ label, icon: Icon }) => {
                const attention = label === "Today" ? actionCounts?.today : label === "Lead Inbox" ? actionCounts?.leads :
                  label === "Exceptions" ? actionCounts?.exceptions : label === "Processing" ? actionCounts?.processing : undefined;
                const count = attention ? (attention > 99 ? "99+" : String(attention)) : null;
                const reason = label === "Today" ? (attention === 1 ? "action due or ready" : "actions due or ready") :
                  label === "Exceptions" ? (attention === 1 ? "open exception" : "open exceptions") :
                    label === "Processing" ? (attention === 1 ? "incoming item" : "incoming items") :
                    (attention === 1 ? "lead needs first contact" : "leads need first contact");
                return <button key={label} className={section === label ? "nav-item selected" : "nav-item"} aria-current={section === label ? "page" : undefined}
                  aria-label={count ? `${label}, ${count} ${reason}` : undefined}
                  disabled={!controlsReady} onClick={() => {
                    if (label === "Team") setTeamPanel("Staff access");
                    navigate(label, true, undefined, Boolean(attention) && label !== "Exceptions");
                  }}>
                  <Icon size={20} aria-hidden="true" /><span>{label}</span>
                  {count && <small className="nav-count" aria-hidden="true">{count}</small>}
                  {label === "Tasks" && workspaceStatus === "ready" && openTasks > 0 && <small className="nav-count" aria-label={`${openTasks} open`}>{openTasks}</small>}
                </button>;
              })}
            </div>
          ))}
          {staff && <p className="mobile-workspace-label">{staff.brokerage.name} · {staff.brokerage.role}</p>}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-label"><span /> {staff?.brokerage.name ?? "Demo workspace"} · {staff?.brokerage.role ?? "Local demo"}</div>
          <div className="profile"><span className="avatar">{staff ? initials(staff.name) : "AM"}</span><div>
            <strong>{staff?.name || demoOfficer}</strong><small>{staff?.email || "Loan officer"}</small>
          </div></div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span><span className="muted">Workspace</span><span className="slash">/</span><strong>{section}</strong></span>
          <div className="topbar-actions">
            {canOpenCalendar && <Button className="workspace-search-trigger" type="button" size="sm" variant="ghost" data-tooltip="Search workspace"
              aria-label="Search workspace" aria-current={section === "Search" ? "page" : undefined} disabled={!controlsReady}
              onClick={() => navigate("Search", false)}><Search aria-hidden="true" /><span>Search</span></Button>}
            {canOpenCalendar && <Button type="button" size="sm" variant="ghost" className="review-inbox-trigger" data-tooltip="Review inbox"
              aria-label={reviewInbox.unread ? `Review inbox, ${reviewInbox.unread} unread` : "Review inbox"}
              aria-current={section === "Review Inbox" ? "page" : undefined} disabled={!controlsReady} onClick={() => navigate("Review Inbox", false)}>
              <Bell aria-hidden="true" />{reviewInbox.unread && <span aria-hidden="true">{reviewInbox.unread}</span>}
            </Button>}
            {uwmEnabled && <button className="connection-chip" disabled={!controlsReady} onClick={() => navigate("Integrations")}><span /> {uwmConnection.pricing === "UWM stage API" ? "UWM stage" : "UWM"}</button>}
            {staff && <form method="post" action="/auth/logout"><Button type="submit" size="sm" variant="ghost"><LogOut /> Sign out</Button></form>}
          </div>
        </header>
        <div className="content">
          {supportReturn && <p><a className="name-link" href={supportReturn}>Back to support report</a></p>}
          {staff?.brokerage.pilot && <p className="application-message">Fictional pilot · Use sample borrowers and documents.</p>}
          {!waitingForWorkspace && section === "Pipeline" ? <section className="pipeline-hero" aria-labelledby="pipeline-title">
            <div className="page-heading">
              <div>
                <h1 id="pipeline-title" ref={sectionHeading} tabIndex={-1}>Loan pipeline</h1>
              </div>
              <div className="heading-actions pipeline-actions">
                {!processor && <Button onClick={() => show({ kind: "loan" })}><Plus /> New Lead</Button>}
                {syncButton()}
                {firstDayDestination && <Button type="button" variant="outline" onClick={openFirstDayChecklist}>Back to checklist</Button>}
                {!processor && <Button className="pipeline-demo" variant="ghost" disabled={!controlsReady} onClick={() => navigate("Demo Guide")}><workspaceIcons.demo aria-hidden="true" /> Guided demo</Button>}
              </div>
            </div>
            <dl className="metrics">
              <div><dt>Active loans</dt><dd>{pipeline.page?.metrics.active ?? "—"}</dd><dd className="metric-context">{pipeline.page ? `${pipeline.page.metrics.total} total in pipeline` : "Total in pipeline"}</dd></div>
              <div><dt>Active loan volume</dt><dd>{pipeline.page ? compactMoney(pipeline.page.metrics.volume) : "—"}</dd><dd className="metric-context">Across active stages</dd></div>
              <div><dt>Open lender conditions</dt><dd data-outstanding={(pipeline.page?.metrics.openConditions ?? 0) > 0}>{pipeline.page?.metrics.openConditions ?? "—"}</dd><dd className="metric-context">Across linked lender files</dd></div>
            </dl>
          </section> : <div className="page-heading">
            <div><h1 ref={sectionHeading} tabIndex={-1}>{sectionTitle}</h1>
              {(section === "Brokerage" || section === "Team") && staff && <p className="muted">{staff.brokerage.name}</p>}
            </div>
            {section === "Demo Guide" && !controlsReady && <p className="muted" role="status">Getting the walkthrough ready…</p>}
            {!waitingForWorkspace && <div className="heading-actions">
              {staff && section === "First-day checklist" && <Button type="button" variant="outline"
                onClick={() => openBrokerageView(staffHome)}>Back to {staffHome}</Button>}
              {staff && (firstDayDestination || section === staffHome || section === "Team") && <Button type="button"
                variant={firstDayDestination ? "outline" : "ghost"} disabled={!controlsReady}
                onClick={openFirstDayChecklist}>{firstDayDestination ? "Back to checklist" : "First-day checklist"}</Button>}
              {section === "Brokerage" && canReport && <>
                <Button disabled={busy || !controlsReady} onClick={() => show({ kind: "loan" })}><Plus /> New Lead</Button>
                <Button variant="outline" disabled={busy || !controlsReady} onClick={() => openBrokerageView("Today")}>My work today</Button>
              </>}
              {section === "Contacts" && admin && <Button onClick={() => show({ kind: "contact" })}><Plus /> New contact</Button>}
              {section === "Tasks" && staff && <Button variant="outline" disabled={busy}
                onClick={() => { setDetailedTasks(pagedTasks); setFocusContactTask(undefined); }}>
                {pagedTasks ? "Detailed queues" : "Paged task queue"}
              </Button>}
              {section === "Tasks" && !pagedTasks && <Button variant="outline" disabled={busy} onClick={() => void save({ type: "refreshWorkspace" })}><RefreshCw /> Refresh tasks</Button>}
            </div>}
          </div>}

          {(notice || (error && (!modal || waitingForWorkspace))) && (
            <div className={error && (!modal || waitingForWorkspace) ? "banner banner-error" : "banner"} role={error && (!modal || waitingForWorkspace) ? "alert" : "status"}>
              <span>{error && (!modal || waitingForWorkspace) ? saveError : notice}</span>
              <Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={() => { setError(""); setNotice(""); }}><X /></Button>
            </div>
          )}

          {waitingForWorkspace ? <section className="integration record-form" aria-label="Workspace data" aria-busy={workspaceStatus !== "failed"}>
            {workspaceStatus === "failed" ? <div>
              <p>Workspace data couldn’t be loaded.</p>
              <Button variant="outline" disabled={busy} onClick={() => void loadFullWorkspace()}>Retry loading workspace</Button>
            </div> : <p role="status">Loading workspace data…</p>}
            {modal && <div><Button variant="ghost" onClick={close}>Cancel</Button></div>}
          </section> : <>
          {section === "Pipeline" && <section className="pipeline pipeline-board" data-view={view} aria-label="Pipeline views">
              <div className="pipeline-heading"><h2>Pipeline overview {pipeline.page && <span>{pipeline.page.matches}</span>}</h2>
                {view === "Board" && <Button variant="ghost" size="sm" className="board-next" onClick={() => board.current?.scrollBy({
                  left: 490, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                })}>More stages <ArrowRight /></Button>}
              </div>
              <div className="toolbar">
                <label className="search"><Search size={17} /><input aria-label="Search loans" placeholder="Search loans…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
                <Button variant="outline" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal /> Filters{filterCount ? ` (${filterCount})` : ""}</Button>
                <div className="spacer" />
                <div className="view-toggle" aria-label="Pipeline view">
                  <button aria-pressed={view === "Board"} onClick={() => setView("Board")}><workspaceIcons.pipeline size={16} aria-hidden="true" /> Board</button>
                  <button aria-pressed={view === "List"} onClick={() => setView("List")}><List size={16} /> List</button>
                </div>
                <Button variant="ghost" size="sm" disabled={busy || pipeline.loadingMore} onClick={pipeline.refresh}><RefreshCw /> Refresh pipeline</Button>
                {view === "Board" && <select className="pipeline-stage-picker" aria-label="Show stage" value={filters.stage} onChange={(event) => setFilters({ ...filters, stage: event.target.value as PipelineFilters["stage"] })}>
                  <option value="">All stages</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}
                </select>}
              </div>
              {filtersOpen && <div className="filter-row">
                <select className="pipeline-stage-filter" aria-label="Filter by stage" value={filters.stage} onChange={(event) => setFilters({ ...filters, stage: event.target.value as PipelineFilters["stage"] })}><option value="">All stages</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select>
                <select aria-label="Filter by lender" value={filters.lender} onChange={(event) => setFilters({ ...filters, lender: event.target.value })}><option value="">All lenders</option>{pipeline.options?.lenders.map((lender) => <option key={lender}>{lender}</option>)}</select>
                <select aria-label="Filter by officer" value={filters.officer} onChange={(event) => setFilters({ ...filters, officer: event.target.value })}><option value="">All officers</option>{pipeline.options?.officers.map((officer) => <option key={officer}>{officer}</option>)}</select>
                <select aria-label="Filter by realtor" value={filters.partner} onChange={(event) => setFilters({ ...filters, partner: event.target.value })}><option value="">All realtors</option>{pipeline.options?.partners.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select>
                <select aria-label="Filter by days in stage" value={filters.days} onChange={(event) => setFilters({ ...filters, days: event.target.value as PipelineFilters["days"] })}><option value="">Any stage age</option><option value="3">3+ days</option><option value="7">7+ days</option><option value="14">14+ days</option></select>
                <select aria-label="Filter by work status" value={filters.work} onChange={(event) => setFilters({ ...filters, work: event.target.value as WorkFilter | "" })}><option value="">Any work status</option>{workFilters.map((item) => <option key={item}>{item}</option>)}</select>
                <Button variant="ghost" size="sm" onClick={() => setFilters(emptyPipelineFilters)}>Clear filters</Button>
              </div>}
              {pipeline.error && <p className="empty-inline no-matches" role="alert">{pipeline.error}</p>}
              {!pipeline.page && !pipeline.error && <p className="empty-inline no-matches" role="status">Loading pipeline…</p>}
              {pipeline.page?.matches === 0 && <p className="empty-inline no-matches">No loans match this view.</p>}
              {pipeline.page && (view === "Board" ? (
                <div className="board" ref={board} tabIndex={0} aria-label="Loan stages">
                  {pipeline.page.lanes.map(({ stage, loans, count, volume, next }) => {
                    const color = stageColors[stages.indexOf(stage)];
                    return <section key={stage} className={dropStage === stage ? "lane drag-over" : "lane"} data-tone={color}
                      onDragOver={(event) => { if (dragged.current && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropStage(stage); } }}
                      onDrop={(event) => drop(event, stage)}>
                      <div className="lane-title"><span className={`stage-dot ${color}`} /><h3>{stage}</h3><span className="lane-count">{count}</span>{!processor && <Button variant="ghost" size="icon" aria-label={`Add lead to ${stage}`} onClick={() => show({ kind: "loan", stage })}><Plus /></Button>}</div>
                      <p className="lane-volume">{compactMoney(volume)}</p>
                      {loans.map((loan) => <LoanCard key={loan.id} loan={loan}
                        onOpen={() => openPipelineLoan(loan.id)}
                        onDrag={(event) => { if (busy || processor) { event.preventDefault(); return; } dragged.current = loan; event.dataTransfer.setData("text/plain", loan.id); event.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { dragged.current = null; setDropStage(null); }} />)}
                      {loans.length === 0 && <p className="lane-empty">No loans in this stage</p>}
                      {next && <Button variant="outline" size="sm" disabled={pipeline.loadingMore || busy} aria-label={`Load more ${stage} loans`}
                        onClick={() => void pipeline.loadMore(next, stage)}>Load more · {loans.length} of {count}</Button>}
                    </section>;
                  })}
                </div>
              ) : pipeline.page.list.loans.length > 0 && <div className="table-scroll"><table className="data-table pipeline-list"><thead><tr><th>Borrower</th><th className="pipeline-list-extra">Stage</th><th className="numeric">Recorded amount</th><th className="pipeline-list-extra">Officer</th><th className="pipeline-list-extra">Lender</th><th className="pipeline-list-extra numeric">Stage age</th><th>Next action</th></tr></thead><tbody>
                {pipeline.page.list.loans.map((loan) => <tr key={loan.id}><td><button className="name-link" data-loan-record={loan.id} onClick={() => openPipelineLoan(loan.id)}>{loan.name}</button><small>{loan.address}</small><small className="pipeline-mobile-stage">{loan.stage}{pausedLoan(loan) && ` · ${loan.disposition}`}</small></td>
                  <td className="pipeline-list-extra"><span className={`stage-dot ${stageColors[stages.indexOf(loan.stage)]}`} /> {loan.stage}{pausedLoan(loan) && <small>{loan.disposition}</small>}</td>
                  <td className="numeric">{money(loan.amount)}{loan.requestedAmount && <small><button className="name-link" type="button"
                    onClick={() => openPipelineLoan(loan.id, loanAmountComparisonTarget)}>1003 request {requestedMoney(loan.requestedAmount)}</button></small>}</td>
                  <td className="pipeline-list-extra">{loan.officer || "Unassigned"}</td><td className="pipeline-list-extra">{loan.lenders.join(", ") || "—"}</td><td className="pipeline-list-extra numeric" suppressHydrationWarning>{stageDays(loan.stageSince)} days</td>
                  <td><button className="name-link" onClick={() => openPipelineLoan(loan.id, loan.action.target)}>{loan.action.title}</button>
                    <small>{loan.action.blocker}</small>
                    {loan.action.dueAt && <small>Due {dateTime(loan.action.dueAt)} ET</small>}</td></tr>)}
              </tbody></table></div>)}
              {view === "List" && pipeline.page?.list.next && <div className="loan-application-actions p-3"><Button variant="outline" size="sm"
                disabled={pipeline.loadingMore || busy} onClick={() => void pipeline.loadMore(pipeline.page!.list.next!)}>Load more loans · {pipeline.page.list.loans.length} of {pipeline.page.matches}</Button></div>}
            </section>
          }

          {section === "Lead Inbox" && <LeadInbox key={attentionVisit?.section === "Lead Inbox" ? attentionVisit.visit : 0}
            openRouting={openLeadRouting}
            initialView={attentionVisit?.section === "Lead Inbox" ? leadAttentionView : undefined} version={state} staff={staff} now={taskNow} busy={busy}
            focusLeadId={focusLeadId} focusTaskId={focusLeadTaskId} focusDocumentId={focusLeadDocumentId} focusArchivedLeadId={focusArchivedLeadId}
            save={(input, after) => save(input, after, true, "inbox")}
            convert={(id, contactId, allowDuplicate, after, intakeReview) => convertLead(id, contactId, allowDuplicate, "inbox", after, intakeReview)}
            openCampaign={(campaignId, leadId) => openLeadWork(leadId, campaignId)} openConversation={(leadId) => openConversation({ leadId })} />}
          {(section === "Call Campaigns" || conversationOrigin === "Call Campaigns") && !processor && <Activity mode={section === "Call Campaigns" ? "visible" : "hidden"}><CallCampaigns state={state} staff={staff} selectedId={selectedCampaignId} select={selectCampaign}
            focusLeadId={focusLeadId} focusTaskId={focusLeadTaskId} now={taskNow} busy={busy} save={save} openLead={(id) => { navigate("Lead Inbox"); setFocusLeadId(id); }}
            openManagerRecord={({ leadId, loanId, archived }) => {
              if (loanId) void openQueueLoan({ kind: "details", loanId });
              else if (archived) { navigate("Lead Inbox", false); setFocusArchivedLeadId(leadId); }
              else void openScopedLead({ leadId }, true);
            }}
            openCallback={({ leadId, loanId, taskId, dueAt, requested }) => loanId ?
              void openQueueLoan({ kind: "details", loanId, target: searchTaskTarget(taskId) },
                { kind: "promised-callback", id: taskId, dueAt, source: "personal" }) :
              void openScopedLead({ leadId, task: { kind: "campaign", id: taskId, ...(requested ? { expectedCallbackAt: dueAt } : {}) } })}
            openLoan={(loanId) => staff || !state.loans.some(({ id }) => id === loanId) ?
              void openQueueLoan({ kind: "details", loanId }) : show({ kind: "details", loanId })}
            openConversation={(leadId) => openConversation({ leadId })} openToday={() => openBrokerageView("Today")}
            convert={(id, after) => convertLead(id, null, false, undefined, after)} /></Activity>}

          {section === "Contacts" && <>
            <ContactsDirectory brokerageId={staff?.brokerage.id ?? demoBrokerageId} version={state} admin={admin} busy={busy}
              openContact={(id, edit) => void openContactRecord(id, edit)} tools={<>
              {admin && <>
                <Button size="sm" variant="outline" onClick={() => show({ kind: "contactDuplicateQueue" })}>Possible duplicates</Button>
                <Button size="sm" variant="outline" onClick={() => show({ kind: "contactMergeHistory" })}>Merge history</Button>
              </>}
              {!processor && <Button size="sm" variant="outline" aria-expanded={contactToolsOpen}
                onClick={() => setContactToolsOpen(!contactToolsOpen)}>Import or export contacts</Button>}
            </>} />
            {!processor && contactToolsOpen && <ContactImport brokerageId={staff?.brokerage.id ?? demoBrokerageId} busy={busy} save={save} />}
            {admin && <CrmFieldSettings brokerageId={staff?.brokerage.id ?? demoBrokerageId} />}
          </>}

          {section === "Brokerage" && canReport && <BrokerageOverview brokerageId={staff.brokerage.id} counts={actionCounts} unavailable={countsUnavailable} busy={busy || !controlsReady}
            pilot={Boolean(staff.brokerage.pilot)} refresh={refreshCounts}
            openQueue={(queue) => openBrokerageView(brokerageQueueSections[queue], queue !== "exceptions")} openReport={openBrokerageReport}
            openTeam={(panel) => { setTeamPanel(panel); openBrokerageView("Team"); }}
            openCompliance={complianceEnabled ? () => openBrokerageView("Compliance") : undefined}
            openRenewal={complianceEnabled ? openLicenseRenewal : undefined} renewalReturn={renewalReturn?.origin === "Brokerage" ? renewalReturn : undefined} openSchedule={openReportSchedule} scheduleReturn={reportScheduleReturn} />}
          {(section === "Today" || conversationOrigin === "Today") && canOpenToday && <Activity mode={section === "Today" ? "visible" : "hidden"}><OfficerToday key={attentionVisit?.section === "Today" ? attentionVisit.visit : 0}
            brokerageId={staff?.brokerage.id ?? demoBrokerageId}
            complianceWork={pilotCompliance && staff && <ComplianceDailyWork brokerageId={staff.brokerage.id}
              version={queueVersion} paused={!!modal || busy} open={openComplianceFinding} />}
            renewalWork={staff && admin && complianceEnabled && <LicenseRenewalAttention key={staff.brokerage.id} brokerageId={staff.brokerage.id}
              busy={!!modal || busy} mine open={visit => openLicenseRenewal(visit, "Today")}
              returning={renewalReturn?.origin === "Today" ? renewalReturn : undefined} />}
            reviewingLoan={!!modal} openIncomingLoanWork={(item) => openIncomingLoanWork(item, "today")}
            refreshCounts={refreshCounts}
            version={queueVersion} busy={busy} openWork={openTodayWork} save={save} openReply={(id) => openConversation({ id })} openTasks={() => navigate("Tasks")}
            openFunding={(loanId) => void openQueueLoan({ kind: "details", loanId, target: "loan-funding" })}
            openStalled={(loanId) => void openQueueLoan({ kind: "details", loanId }, { kind: "stalled" })}
            refreshStalled={() => setError((current) => current === stalledLoanUnavailable ? "" : current)}
            openOpportunity={(item) => void openQueueLoan({ kind: "details", loanId: item.loanId, target: searchTaskTarget(item.id) }, { kind: "retention", id: item.id })}
            openPastClients={() => navigate("Past Clients")} /></Activity>}
          {section === "Calendar" && canOpenCalendar && <div className="record-form">
            {admin && (!staff || staff.brokerage.pilot || staff.brokerage.id === demoBrokerageId) &&
              <DisclosureCalendar brokerageId={staff?.brokerage.id ?? demoBrokerageId}
                openLoan={(loanId) => void openQueueLoan({ kind: "details", loanId, target: disclosureTarget })} />}
            <WorkspaceCalendar brokerageId={staff?.brokerage.id ?? demoBrokerageId}
              canSeeTeam={admin} processor={processor} query={calendar} onChange={setCalendar} version={queueVersion} openWork={openDeadlineWork} />
          </div>}
          {section === "Coverage" && canOpenCalendar && <StaffCoverage brokerageId={staff?.brokerage.id ?? demoBrokerageId}
            staffEmail={staff?.email ?? localOfficer.email} admin={admin} onWorkSaved={() => setCalendar((current) => ({ ...current, after: undefined }))} />}
          {section === "Search" && canOpenCalendar && <WorkspaceSearch brokerageId={staff?.brokerage.id ?? demoBrokerageId} processor={processor}
            selection={searchSelection} onSearch={setSearchSelection} version={state} busy={busy} open={(record) => void openSearchResult(record)} />}
          {section === "Reviews" && canOpenCalendar && <LoanReviewQueue brokerageId={staff?.brokerage.id ?? demoBrokerageId} team={admin}
            version={reviewVersion} busy={busy} open={(row) => void openQueueLoan({ kind: "details", loanId: row.loanId, target: reviewTarget(row.id) })} />}
          {section === "Compliance" && admin && staff && complianceEnabled && <ComplianceWorkspace key={staff.brokerage.id} licenseTarget={renewalVisit?.target}
            returnToRenewals={renewalVisit ? returnToLicenseRenewals : undefined} onLicenseSaved={refreshCounts}
            openLicensing={firstDayDestination === "licensing"}
            brokerageId={staff.brokerage.id} pilot={staff.brokerage.pilot === true} paused={!!modal || busy}
            openHistoryRecord={openMigrationDestination}
            openLoan={(loanId, caseId) => void openQueueLoan({ kind: "details", loanId, target: caseId ? complianceCaseTarget(caseId) : complianceTarget })} />}
          {section === "Review Inbox" && canOpenCalendar && <ReviewInboxPanel inbox={reviewInbox} brokerageId={staff?.brokerage.id ?? demoBrokerageId}
            busy={busy} open={(loanId, reviewId) => void openQueueLoan({ kind: "details", loanId, target: reviewTarget(reviewId) })} />}
          {section === "Processing" && canOpenProcessing && <ProcessorQueue key={attentionVisit?.section === "Processing" ? attentionVisit.visit : 0}
            brokerageId={staff?.brokerage.id ?? demoBrokerageId} team={!processor} initialReadyOnly={firstDayDestination === "accept-handoff"}
            complianceWork={pilotCompliance && staff && processor && <ComplianceDailyWork brokerageId={staff.brokerage.id}
              version={queueVersion} paused={!!modal || busy} open={openComplianceFinding} />}
            mockServices={!staff || staff.brokerage.id === demoBrokerageId || !!staff.brokerage.pilot}
            reviewingLoan={!!modal || busy} openIncomingLoanWork={(item) => openIncomingLoanWork(item, "processing")}
            version={state} openTasks={() => navigate("Tasks")} openReply={(id) => openConversation({ id })}
            openLoan={(loanId, target) => void openQueueLoan({ kind: "details", loanId, target })}
            onAssignment={canReport ? invalidateWorkspace : undefined}
            openAssignment={canReport ? (loanId) => show({ kind: "assignment", loanId }) : undefined} />}
          {section === "Tasks" && staff && pagedTasks && <PagedTaskQueue staff={staff} version={queueVersion} busy={busy}
            complianceWork={pilotCompliance && <ComplianceDailyWork brokerageId={staff.brokerage.id}
              version={queueVersion} paused={!!modal || busy} open={openComplianceFinding} />}
            focusContact={focusContactTask} openWork={openActiveTask} openHistory={(id, realtor) => void openContactRecord(id, false, realtor ? "partner" : "contact")}
            save={(input, after) => save(input, after, true, "tasks")} />}

          {showDetailedTaskLists && <section className="pipeline" aria-label="Tasks">
            <div className="pipeline-heading"><div><h2>Follow-up queue <span>{visibleTasks.length + visibleReferrals.length + visibleUwmAlerts.length + incomingLeadTasks.length + importedLeadTasks.length + visibleProcessing.length + visiblePlaybook.length + visibleContactFollowUps.length + (taskView === "Completed" ? 0 : focusedLoans.length)} shown</span></h2><p>Review leads, lender updates, and loan and contact follow-ups.</p></div></div>
            <div className="filter-row">
              <Button size="sm" variant={taskOfficer === "mine" ? "default" : "outline"} aria-pressed={taskOfficer === "mine"}
                onClick={() => setTaskOfficer(taskOfficer === "mine" ? "" : "mine")}>My Tasks</Button>
              <select aria-label="Task status" value={taskView} onChange={(event) => setTaskView(event.target.value as TaskView)}>{taskViews.map((item) => <option key={item}>{item}</option>)}</select>
              <select aria-label="Loan work status" value={taskFocus} onChange={(event) => setTaskFocus(event.target.value as WorkFilter | "")}><option value="">Any loan work status</option>{workFilters.map((item) => <option key={item}>{item}</option>)}</select>
              <select aria-label="Task owner" value={taskOfficer} onChange={(event) => setTaskOfficer(event.target.value)}>
                <option value="">All officers</option><option value="mine">My Tasks</option>
                {[...officers].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
            {showUwmAlerts && <UwmAlertQueue items={visibleUwmAlerts} borrower={borrowers} open={openUwmAlert} busy={busy}
              review={(alert) => void save({ type: "reviewUwmAlert", loanId: alert.loanId, alertId: alert.id })} />}
            {visiblePlaybook.length > 0 && <section className="work-queue" aria-label="Playbook tasks">
              <div className="section-heading"><h3>Playbook tasks</h3><span className="pill">{visiblePlaybook.length} open</span></div>
              <ul className="loan-task-list">{visiblePlaybook.map((item) => {
                const repeatId = returningByFundedLoan.get(item.recordId);
                const borrowerCheckIn = item.kind === "funding" && fundingTaskAudience(item.id) === "Borrower" && fundedLoans.has(item.recordId) && !processor;
                return <li className="loan-task" key={item.id}>
                  <div className="loan-task-copy"><strong>{item.title}</strong><span>{item.name} · {item.owner || "Unassigned"}</span>
                    <span>{item.reason} · Due {dateTime(item.dueAt)} ET</span></div>
                  <div className="loan-application-actions"><Button size="sm" variant="outline" onClick={() => openPlaybook(item)}>{item.kind === "funding" ? "Preview draft" : "Open work"}</Button>
                    {borrowerCheckIn && <Button size="sm" variant="outline" disabled={busy} onClick={() => openReturningClient(item.recordId)}>
                      {repeatId ? "Open returning-client 1003" : "Start returning-client 1003"}</Button>}
                    {borrowerCheckIn ? <Button size="sm" disabled={busy} onClick={() => show({ kind: "fundingCheckIn", loanId: item.recordId })}>Record check-in</Button> :
                      item.kind === "funding" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: "completeTask", id: item.id, completed: true })}>Mark complete</Button>}</div>
                </li>;
              })}</ul>
            </section>}
            {visibleProcessing.length > 0 && <section className="work-queue" aria-label="Processing handoffs">
              <div className="section-heading"><h3>Processing handoffs</h3><span className="pill">{visibleProcessing.length} open</span></div>
              <ul className="loan-task-list">{visibleProcessing.map(({ item, loan }) => <li className="loan-task" key={loan.id}>
                <div className="loan-task-copy"><strong>{item.status}</strong><span>{borrowers(loan)} · {item.processorName}</span></div>
                <Button size="sm" variant="outline" onClick={() => show({ kind: "details", loanId: loan.id, target: "processing-handoff" })}>Open handoff</Button>
              </li>)}</ul>
            </section>}
            {incomingLeadTasks.length > 0 && <div className="work-queue" aria-label="Lead follow-ups">
              <div className="section-heading"><h3>Lead follow-ups</h3><span className="pill">{incomingLeadTasks.length} open</span></div>
              <ul className="loan-task-list">{incomingLeadTasks.map(({ lead, title, dueAt }) => <li className="loan-task" key={lead.id}>
                <div className="loan-task-copy"><strong>{title}</strong><span>{lead.name} · {lead.officer || "Shared inbox"}</span>
                  <span>{lead.heldAt ? `Revisit ${lead.revisitDate} · ${lead.holdReason}` : `${dateTime(dueAt)} ET`}</span></div>
                <Button size="sm" variant="outline" onClick={() => openLeadWork(lead.id, lead.heldAt ? null : lead.campaignId)}>
                  {lead.campaignId && !lead.heldAt ? "Open campaign" : "Open lead"}</Button>
              </li>)}</ul>
            </div>}
            {importedLeadTasks.length > 0 && <section className="work-queue" aria-label="Lead tasks">
              <div className="section-heading"><h3>Lead tasks</h3><span className="pill">{importedLeadTasks.length} shown</span></div>
              <ul className="loan-task-list">{importedLeadTasks.map(({ lead, task, blocked }) => <li className="loan-task" key={task.id}>
                <div className="loan-task-copy"><strong>{task.title}</strong><span>{lead.name} · {lead.officer || "Shared inbox"}</span>
                  <span>{task.purpose} · {task.completedAt ? "Completed" : "Due"} {dateTime(task.completedAt ?? task.dueAt)} ET</span>
                  {lead.heldAt && !task.completedAt && <span className="pill">Lead on hold</span>}
                  {blocked && <span className="pill">Blocked by outreach opt-out</span>}</div>
                <Button size="sm" variant="outline" onClick={() => openLeadWork(lead.id, lead.heldAt ? null : campaignByCallback.get(task.id))}>
                  {campaignByCallback.has(task.id) && !lead.heldAt ? "Open campaign" : "Open lead"}
                </Button>
              </li>)}</ul>
            </section>}
            {visibleContactFollowUps.length > 0 && <section className="work-queue" aria-label="Contact follow-ups">
              <div className="section-heading"><h3>Contact follow-ups</h3><span className="pill">{visibleContactFollowUps.length} shown</span></div>
              {canReport && followUpOwnerError && <p role="alert">{followUpOwnerError}</p>}
              <ul className="loan-task-list">{visibleContactFollowUps.map(({ item, contact, owner, dueAt, blocked }) => <LoanTaskRow key={item.id}
                id={`contact-follow-up-${item.id}`}
                task={{ title: item.postFundingCheckIn ? "Post-funding follow-up" : `Follow up after ${item.kind.toLowerCase()}`,
                  dueAt, completedAt: item.completedAt, purpose: item.purpose }}
                officer={owner.officer} borrower={contact.name} busy={busy} blocked={blocked} context={item.outcome ?? undefined}
                openLoan={() => show({ kind: "contactHistory", contactId: contact.id })}
                onChange={item.completedAt ? () => void save({ type: "completeContactFollowUp", contactId: contact.id, eventId: item.id,
                  revision: item.revision, completed: false }) : undefined}>
                <ContactFollowUpCheckIn item={item} />
                <ContactFollowUpResult completion={item.latestCompletion} current={!!item.completedAt} />
                {!item.completedAt && !blocked && <ContactFollowUpCompletion item={item} busy={busy} save={save} />}
                {!blocked && <BorrowerCallbackReschedule item={item} busy={busy} save={save} />}
                {canReport && followUpOwners && !item.completedAt && !blocked && <ContactFollowUpAssignment item={item} members={followUpOwners} busy={busy} save={save} />}
              </LoanTaskRow>)}</ul>
            </section>}
            {taskView !== "Completed" && <ReferralQueue leads={visibleReferrals} now={taskNow} busy={busy}
              refresh={() => void save({ type: "refreshWorkspace" }, undefined, false)}
              convert={(lead, contactId, allowDuplicate) => convertLead(lead.id, contactId, allowDuplicate)}
              dismiss={(lead) => {
                const record = state.inboxLeads.find((item) => item.id === lead.id);
                if (record) void save({ type: "dismissReferral", referralId: lead.id, revision: record.followUp.revision });
              }} />}
            {taskView !== "Completed" && (focusedLoans.length > 0 || taskFocus) && <div className="work-queue">
              <div className="section-heading"><h3>{taskFocus || "Holds to revisit"}</h3><span className="pill">{focusedLoans.length} loans</span></div>
              {focusedLoans.length ? <ul className="loan-task-list">{focusedLoans.map((loan) => {
                const action = nextActions.get(loan.id)!;
                return <li className="loan-task" key={loan.id}><div className="loan-task-copy"><strong>{action.title}</strong>
                  <span>{borrowers(loan)} · {loan.officer || "Unassigned"} · {loan.disposition || loan.stage}</span>
                  <span>{action.blocker}{action.dueAt && ` · Due ${dateTime(action.dueAt)} ET`}</span></div>
                  <Button size="sm" variant="outline" onClick={() => show({ kind: "details", loanId: loan.id, target: action.target })}>Open next action</Button></li>;
              })}</ul> : <p className="empty-inline">No loans match this work status.</p>}
            </div>}
            {(taskView === "Open" || taskView === "All") && <LoanWorkQueue loans={state.loans.filter((loan) => taskScope(loan) && workMatches(loan, taskFocus))} state={state} borrower={borrowers}
              open={(loanId, target) => show({ kind: target === "uwm-rate-lock" ? "pricing" : "details", loanId, target })} />}
            {visibleTasks.length ? <ul className="task-queue">
              {visibleTasks.map((task) => {
                const loan = taskLoans.get(task.loanId);
                if (!loan) return null;
                return <LoanTaskRow key={task.id} task={task} officer={loan.officer} borrower={borrowers(loan)} busy={busy}
                  blocked={loanTaskBlocked(task)}
                  context={task.id.startsWith("rate-watch:") ? rateFollowUpContext(state.pastClients.find((profile) => profile.loanId === loan.id)) : undefined}
                  openLoan={() => disclosureTask(task.id) || isSharedQuoteReview(task.id) ?
                    void openQueueLoan({ kind: "details", loanId: loan.id, target: loanTaskTarget(task.id, processor) }) :
                    show({ kind: "details", loanId: loan.id, target: loanTaskTarget(task.id, processor || Boolean(task.completedAt)) })}
                  onChange={disclosureTask(task.id) || isSharedQuoteReview(task.id) || task.id.startsWith(mockUwmReceiptTaskPrefix) || task.id.startsWith(reversedFundingTaskPrefix) ||
                    (task.completedAt && isApplicationReviewTask(task.id)) ? undefined :
                    () => void save({ type: "completeTask", id: task.id, completed: !task.completedAt })} />;
              })}
            </ul> : <p className="empty-inline no-matches">{visibleReferrals.length || visibleUwmAlerts.length || incomingLeadTasks.length || importedLeadTasks.length || visibleProcessing.length || visiblePlaybook.length || visibleContactFollowUps.length || (taskView !== "Completed" && focusedLoans.length)
              ? "No other loan tasks match this view." : state.tasks.length || contactFollowUps.length ? "No tasks match this view."
              : "Add a follow-up from a contact or loan, or submit a 1003 to create a review task."}</p>}
          </section>}

          {section === "Communications" && <div className="record-form">
            {conversationOrigin && <div><Button variant="outline" disabled={busy} onClick={() => void returnFromConversation()}>Return to {conversationOrigin}</Button></div>}
            {canReviewReplies && <div className="view-toggle" role="group" aria-label="Communications view">
              <button type="button" aria-pressed={communicationView === "Conversations"} onClick={() => setCommunicationView("Conversations")}>Conversations</button>
              <button type="button" aria-pressed={communicationView === "Inbound review"} onClick={() => setCommunicationView("Inbound review")}>Inbound review</button>
            </div>}
            {canReviewReplies && communicationView === "Inbound review" ? <InboundReplyQueue brokerageId={staff?.brokerage.id ?? demoBrokerageId}
              openConversation={(id) => { setConversationFocus({ id }); setCommunicationView("Conversations"); }} /> :
              <><ConversationQueue brokerageId={staff?.brokerage.id ?? demoBrokerageId} signedIn={Boolean(staff)} team={admin}
                version={state} focus={conversationFocus} setFocus={setConversationFocus} openPipeline={() => navigate("Pipeline")}
                openCallback={openConversationCallback}
                openLead={(leadId) => openLeadWork(leadId)} openInbox={!processor ? () => navigate("Lead Inbox") : undefined}
                openContacts={!processor ? () => navigate("Contacts") : undefined}
                openLoan={(loanId) => void openQueueLoan({ kind: "details", loanId, target: "loan-communications" })} />
                <CommunicationQueue brokerageId={staff?.brokerage.id ?? demoBrokerageId} version={state} busy={busy} save={save}
                  preview={(loanId, audience, draftId) => {
                    const next = { kind: "communication", loanId, audience, draftId } as const;
                    if (staff) void openQueueLoan(next);
                    else show(next);
                  }} /></>}
          </div>}

          {section === "Realtors" && admin && <RealtorCrm version={state} staff={staff} busy={busy}
            save={(input) => save(input, undefined, true, "realtors")}
            openLoan={(loanId, target) => void openQueueLoan({ kind: "details", loanId, target })}
            openLead={(leadId) => void openScopedLead({ leadId })}
            openArchived={(leadId) => { navigate("Lead Inbox", false); setFocusArchivedLeadId(leadId); }}
            editRealtor={(contactId) => void openContactRecord(contactId, true, "partner")}
            openContact={(contactId) => void openContactRecord(contactId, false, "partner")} />}

          {section === "Past Clients" && <PastClients brokerageId={staff?.brokerage.id ?? demoBrokerageId} version={state} busy={busy}
            openLoan={(loanId) => void openQueueLoan({ kind: "details", loanId })}
            editRetention={processor ? undefined : (loanId) => void openQueueLoan({ kind: "retention", loanId })}
            openContact={(contactId) => void openContactRecord(contactId)}
            openRepeat={processor ? undefined : openReturningClient} />}

          {section === "Reports" && canOpenReports && <div className="record-form">
            <div className="loan-application-actions" aria-label="Report view">
              {reportTabs.filter((tab) => tab === "Custom reports" || (canOpenManagerReports && (tab === "Financials" ? canOpenFinance : tab === "Referral queue" ? canReport :
                tab === "Owner scorecard" || tab === "Pipeline workload" || state.managerReports ||
                tab === "Funding dashboard" || tab === "Sales conversion" || tab === "Call report"))).map((tab) => <Button size="sm" key={tab} aria-pressed={reportTab === tab}
                variant={reportTab === tab ? "default" : "outline"} onClick={() => setReportTab(tab)}>{tab}</Button>)}
            </div>
            {!canOpenManagerReports || reportTab === "Custom reports" ? <Suspense fallback={<p role="status">Opening custom reports…</p>}>
              <CustomReports key={reportScheduleTarget ? reportScheduleTarget.reportId ?? "report-schedules" : "custom-reports"}
                brokerageId={staff?.brokerage.id ?? demoBrokerageId} role={staff?.brokerage.role ?? "Admin"} scheduling={Boolean(staff)}
                scheduleTarget={reportScheduleTarget} onScheduleBack={returnToReportScheduleQueue} openRecord={({ destination }, metric) => {
                  if (destination.kind === "lead") return void openScopedLead({ leadId: destination.id }, true);
                  const target = processor ? undefined : metric === "funding" || metric === "cohortFunded" ? "loan-funding" :
                    metric === "applications" || metric === "converted" ? "loan-application" : undefined;
                  void openQueueLoan({ kind: "details", loanId: destination.id, target });
                }} />
            </Suspense> : reportTab === "Owner scorecard" ? <OwnerScorecard brokerageId={staff?.brokerage.id ?? demoBrokerageId}
              version={state} filters={scorecardFilters} setFilters={setScorecardFilters}
              openCampaignRecord={(row, metric) => row.loanId ?
                void openQueueLoan({ kind: "details", loanId: row.loanId, target: metric === "funded" ? "loan-funding" : "loan-application" }) :
                void openScopedLead({ leadId: row.id })}
              openWork={(destination, id) => {
                if (destination.kind === "contact") return showGuideTasks(undefined, id, false, true);
                if (destination.kind === "lead") return void openScopedLead({ leadId: destination.leadId,
                  task: destination.task === "lead-task" ? { kind: destination.task, id, team: true } : undefined });
                void openQueueLoan({ kind: "details", loanId: destination.loanId, target: destination.target });
              }} /> :
              reportTab === "Financials" && canOpenFinance ? <BrokerageFinance brokerageId={staff?.brokerage.id ?? demoBrokerageId}
              loans={state.loans} fundingVersion={state.closingProgress} openFunding={(loanId) => void openQueueLoan({ kind: "details", loanId, target: "loan-funding" })} /> :
              reportTab === "Pipeline workload" ? <StalledLoans team brokerageId={staff?.brokerage.id ?? demoBrokerageId} version={state} busy={busy}
                openLoan={(loanId) => void openQueueLoan({ kind: "details", loanId }, { kind: "brokerage-stalled" })}
                onRefresh={() => setError((current) => current === stalledLoanUnavailable ? "" : current)} /> :
              reportTab === "Sales conversion" ? <SalesDashboard brokerageId={staff?.brokerage.id ?? demoBrokerageId}
              version={state} selection={salesSelection} setSelection={setSalesSelection}
              openLead={(row, channel) => channel === "Lead sources" ? void openScopedLead({ leadId: row.id }) :
                openLeadWork(row.id, channel === "Campaigns" ? row.groupId : null)}
              openLoan={(loanId, target) => void openQueueLoan({ kind: "details", loanId, target })} /> :
              reportTab === "Referral queue" && staff ? <RealtorQueueReport brokerageId={staff.brokerage.id} version={state}
                members={followUpOwners} memberError={followUpOwnerError}
                openLead={(leadId) => openLeadWork(leadId)} openLoan={(loanId) => void openQueueLoan({ kind: "details", loanId })} /> :
              reportTab === "Call report" ? <CallReportWorkbench state={state} brokerageId={staff?.brokerage.id ?? demoBrokerageId}
                period={reportingPeriod} setPeriod={setReportingPeriod}
                openReadiness={() => { setManagerExceptionView("reporting"); navigate("Playbooks", false); }}
                openLoan={(loanId) => void openQueueLoan({ kind: "details", loanId, target: callReportFactsTarget })} /> :
              reportTab === "Funding dashboard" || !state.managerReports ? <FundingDashboard brokerageId={staff?.brokerage.id ?? demoBrokerageId}
              loans={state.loans} version={state.closingProgress} openLoan={(loanId) => void openQueueLoan({ kind: "details", loanId, target: "closing-workbench" })} /> :
              reportTab === "Returning clients" ? <ReturningClientReports rows={state.managerReports.returningClients} busy={busy} save={save}
                contactActivity={state.contactActivity} members={followUpOwners} ownerError={followUpOwnerError}
                refresh={() => void save({ type: "refreshWorkspace" })}
                openApplication={(loanId, funded) => void openQueueLoan({ kind: "details", loanId, target: funded ? "loan-funding" : "loan-application" })}
                openOriginalLoan={(loanId) => void openQueueLoan({ kind: "details", loanId })}
                openContact={(contactId) => show({ kind: "contactHistory", contactId })} /> :
              <ManagerReports data={state.managerReports} campaigns={state.callCampaigns} segments={state.crmSegments} busy={busy} now={taskNow} save={save}
                openLoan={(loanId) => show({ kind: "details", loanId })}
                openLead={(leadId) => { navigate("Lead Inbox"); setFocusLeadId(leadId); }} />}
          </div>}

          {section === "Migration" && canMigrate && <MigrationWorkspace busy={busy}
            save={(input, after, announce) => save(input, after, announce, "migration")} brokerageId={staff.brokerage.id} version={state}
            openRecord={openMigrationDestination}
            openLinkedLoan={(loanId, target) => void openQueueLoan({ kind: "details", loanId, target })} />}
          {section === "Exceptions" && canReport && <>
            <DeliveryExceptions key={staff.brokerage.id} brokerageId={staff.brokerage.id} attentionCount={actionCounts?.deliveryExceptions}
              fictional={Boolean(staff.brokerage.pilot) || staff.brokerage.id === demoBrokerageId} onChanged={refreshCounts}
              openRecord={resource => resource.kind === "lead" ? openLeadWork(resource.id) :
                void openQueueLoan({ kind: "details", loanId: resource.id })} />
            <FileExceptions brokerageId={staff.brokerage.id} version={queueVersion} busy={busy}
              standalone open={openFileException} assign={(loanId, manualReturn) => show({ kind: "assignment", loanId, manualReturn })} />
          </>}
          {section === "Playbooks" && admin && <LoanStageEditSettings brokerageId={staff?.brokerage.id ?? demoBrokerageId} />}
          {section === "Playbooks" && admin && <ManageClosingGates brokerageId={staff?.brokerage.id ?? demoBrokerageId} />}
          {section === "Playbooks" && admin && (!staff || staff.brokerage.pilot || staff.brokerage.id === demoBrokerageId) &&
            <DisclosureTemplateSettings brokerageId={staff?.brokerage.id ?? demoBrokerageId} />}
          {section === "Playbooks" && admin && (!staff || staff.brokerage.pilot || staff.brokerage.id === demoBrokerageId) &&
            <ManageBorrowerQuestionSets brokerageId={staff?.brokerage.id ?? demoBrokerageId} />}
          {section === "Playbooks" && admin && <BrokeragePlaybooks staff={staff} busy={busy}
            complianceReviews={pilotCompliance && staff && <ComplianceDailyWork brokerageId={staff.brokerage.id} view="review"
              version={queueVersion} paused={!!modal || busy} open={openComplianceFinding} />}
            save={(input, after) => save(input, after, true,
              input && typeof input === "object" && "type" in input && input.type === "assignInboxLead" ? "inbox" : "tasks")}
            refresh={async () => invalidateWorkspace()} open={openPlaybook}
            openLead={(leadId, preferInbox) => void openScopedLead({ leadId }, preferInbox)} openCampaignRun={openLeadWork}
            openContactFollowUp={(contactId, activityId) => {
              if (staff) showGuideTasks(undefined, activityId, false, true);
              else void openContactRecord(contactId);
            }}
            openCallbackPromise={({ leadId, id, loanTask }) => loanTask ?
              void openQueueLoan({ kind: "details", loanId: loanTask.loanId, target: searchTaskTarget(loanTask.taskId) },
                { kind: "promised-callback", id: loanTask.taskId, dueAt: loanTask.dueAt, source: "manager" }) :
              void openScopedLead({ leadId, callbackPromiseId: id })}
            fileVersion={queueVersion} openFile={(item) => openFileException(item)}
            view={managerExceptionView} setView={setManagerExceptionView} filters={managerExceptionFilters} setFilters={setManagerExceptionFilters}
            reporting={{ period: reportingPeriod, setPeriod: setReportingPeriod,
              openLoan: (loanId) => void openQueueLoan({ kind: "details", loanId, target: callReportFactsTarget }),
              openReport: () => { setReportTab("Call report"); navigate("Reports", false); } }}
            openFunding={(loanId) => void openQueueLoan({ kind: "details", loanId, target: "loan-funding" })}
            openDocument={(loanId, requestId) => void openQueueLoan({ kind: "details", loanId, target: `document-${requestId}` }, { kind: "document", id: requestId })}
            openLoan={(loanId, processing) => void openQueueLoan({ kind: "details", loanId, target: processing ? "processing-handoff" : undefined })}
            openAssignment={canReport ? (loanId, manualReturn) => show({ kind: "assignment", loanId, manualReturn }) : undefined} />}

          {section === "First-day checklist" && staff && <StaffFirstDay key={staff.brokerage.id} brokerageId={staff.brokerage.id}
            role={staff.brokerage.role} pilot={Boolean(staff.brokerage.pilot)} complianceEnabled={complianceEnabled}
            openStep={openFirstDayStep} returning={firstDayReturn}
            openPractice={() => openFirstDayStep("pilot-tools")} />}

          {section === "Team" && staff && <BrokerageTeam staff={staff} uwmConnection={uwmConnection} version={state} panel={teamPanel} setPanel={setTeamPanel} refresh={async () => invalidateWorkspace()}
            openRouting={() => { openBrokerageView("Lead Inbox"); setOpenLeadRouting(true); }}
            openLoan={(loanId, target) => void openQueueLoan({ kind: "details", loanId, target })}
            openDepartureWork={(item) => {
              if (item.kind === "Lead") return openLeadWork(item.recordId, item.campaignId);
              if (item.kind === "Contact follow-up") return showGuideTasks(undefined, item.id, false, true);
              if (item.kind === "Contact conversation") return openConversation({ id: item.recordId });
              const target = item.kind === "Reviewer" || item.kind === "Review requester" ? reviewTarget(item.id) : undefined;
              void openQueueLoan({ kind: "details", loanId: item.recordId, target });
            }} />}

          {section === "Demo Guide" && !processor && <fieldset className="record-form guide-controls" aria-label="Walkthrough controls" disabled={!controlsReady}>
            <div className="view-toggle" role="group" aria-label="Walkthrough path">
              <button type="button" aria-pressed={guideTrack === "referral"} onClick={() => setGuideTrack("referral")}>Realtor referral</button>
              <button type="button" aria-pressed={guideTrack === "campaign"} onClick={() => setGuideTrack("campaign")}>CSV to repeat loan</button>
            </div>
            <DemoGuide track={guideTrack} state={state} staff={staff} busy={busy} save={save}
            open={(loanId, target, campaignLender) => show({ kind: "details", loanId, target, campaignLender })}
            openConditions={(loanId, submissionId, conditionId) => void openQueueLoan({ kind: "details", loanId },
              { kind: "guide-conditions", submissionId, conditionId })}
            openPricing={(loanId, campaignLender) => show({ kind: "pricing", loanId, campaignLender })}
            openLead={(id) => { navigate("Lead Inbox"); setFocusLeadId(id); }}
            convert={(id) => convertLead(id, null, false)}
            previewRealtor={(loanId, draftId) => show({ kind: "communication", loanId, audience: "Realtor", draftId })}
            openCampaign={(id, leadId) => { navigate("Call Campaigns", true, id); setFocusLeadId(leadId); }}
            openContact={(id) => show({ kind: "contactHistory", contactId: id })}
            openProcessorAssignment={(loanId) => show({ kind: "assignment", loanId })}
            recordCheckIn={(loanId) => show({ kind: "fundingCheckIn", loanId })}
            startRepeat={(loanId) => show({ kind: "returningClient", loanId })}
            openScorecard={() => { setScorecardFilters({ ...currentReportMonth(), owner: "" }); setReportTab("Owner scorecard"); navigate("Reports", false); }}
            showTasks={showGuideTasks} />
          </fieldset>}

          {section === "Integrations" && <section className="uwm-integration-page">
            {!uwmEnabled && <div className="document-item"><h2>UWM is off for this workspace</h2>
              <p className="muted">{admin ? "Manage this setting in Team → Workspaces." : "Your workspace admin manages this setting."}</p>
              {admin && <Button size="sm" variant="outline" onClick={() => { setTeamPanel("Workspaces"); navigate("Team"); }}>Workspace settings</Button>}
            </div>}
            {uwmEnabled && <><header className="uwm-provider-heading"><span className="uwm-provider-mark" aria-hidden="true">UWM</span><div><span className="uwm-eyebrow">Lender connection</span><h2>United Wholesale Mortgage</h2><p>Connect your account and manage your lender services.</p></div></header>
            <div className="uwm-integration-grid">
            {staff && <UwmAccount key={staff.brokerage.id} brokerageId={staff.brokerage.id} />}
            <div className="uwm-service-card"><UwmConnection overview connection={uwmConnection} brokerageId={staff?.brokerage.id} admin={admin} />
            <div className="integration-stats"><span><CircleCheck size={17} /> {uwmCount} linked loans</span><span><ArrowDownUp size={17} /> {state.uwmSyncedAt ? `Last sync ${dateTime(state.uwmSyncedAt)} ET` : "Waiting for first sync"}</span></div>
            <div className="loan-application-actions">{syncButton()}
              {admin && uwmConnection.pipeline === "Sample pipeline" && <Button variant="outline" disabled={busy || !state.uwmSyncedAt || state.mockUwmChangesApplied}
                onClick={() => void save({ type: "simulateUwmChanges" })}>Simulate UWM changes</Button>}
            </div>
            {admin && uwmConnection.pipeline === "Sample pipeline" && <p className="muted">{state.mockUwmChangesApplied
              ? "Sample lender changes applied. Review Charlotte Kim’s alerts under Tasks. My Tasks shows alerts for your assigned loans."
              : "After the first sync, simulate three lender changes on Charlotte Kim’s loan. Assign her loan to yourself to see the alerts in My Tasks."}</p>}
            </div></div></>}
            {staff?.brokerage.role === "Admin" && <>
              <UwmReceipts key={`receipts:${staff.brokerage.id}`} brokerageId={staff.brokerage.id} />
              <AutomationDeliveries key={staff.brokerage.id} brokerageId={staff.brokerage.id} onChanged={refreshCounts}
                fictional={Boolean(staff.brokerage.pilot) || staff.brokerage.id === demoBrokerageId}
                openRecord={resource => resource.kind === "lead" ? openLeadWork(resource.id) :
                  void openQueueLoan({ kind: "details", loanId: resource.id })} />
              <PartnerPermissions key={`partner:${staff.brokerage.id}`} brokerageId={staff.brokerage.id} pilot={staff.brokerage.pilot === true} />
            </>}
          </section>}
          </>}
        </div>
      </main>
      {modal && (!waitingForWorkspace || modal.kind === "assignment") && <Suspense fallback={<p className="muted" role="status">Opening record…</p>}>
        <RecordDialog modal={modal} state={loanWork && "loanId" in modal && modal.loanId === loanWork.loanId ? {
        ...state, ...loanWork,
        loans: [...loanWork.loans, ...state.loans.filter((loan) => loan.id !== loanWork.loanId)],
        contacts: [...loanWork.contacts, ...state.contacts.filter((contact) => !loanWork.contacts.some((item) => item.id === contact.id))],
      } : state} staff={staff} busy={busy} error={saveError} save={save} show={show} close={close}
        returnToSupport={Boolean(supportReturn && modal.kind === "details" && modal.loanId === initialSupport?.loanId)}
        refreshLoan={modal.kind === "details" && staff ? () => void openQueueLoan(modal) : undefined}
        refreshLoanOnReturn={staff ? refreshLoanOnReturn : undefined}
        searchContact={searchContact} openContact={(id) => void openContactRecord(id)}
        repeatOption={loanWork && "loanId" in modal && modal.loanId === loanWork.loanId ? loanWork.repeatOption : undefined}
        openRateWatchRefinance={(loanId) => void openQueueLoan({ kind: "returningClient", loanId, fromRateWatch: true })}
        openContactLoan={(loanId, target, manualReturn) => void openQueueLoan({ kind: "details", loanId, target },
          manualReturn ? { kind: "manual-return-work", ...manualReturn, personal: false } : undefined)}
        assignmentChanged={invalidateWorkspace}
        assignmentVersion={state}
        separateSamplePricing={uwmConnection.pricing !== "Sample pricing"}
        appointmentChanged={() => setCalendar((current) => ({ ...current, after: undefined }))}
        reviewChanged={() => {
          setReviewVersion((version) => version + 1);
          if (modal.kind === "details" && (loanWork?.playbook.requireSecondReview || state.playbook.requireSecondReview)) void openQueueLoan(modal);
        }}
        openConversation={(subject) => { close(); openConversation(subject); }}
        openContactConversation={(contactId) => { close(); openConversation({ contactId }); }}
        openConversationThread={(id) => { close(); openConversation({ id }); }}
        openLead={(id) => { close(); navigate("Lead Inbox"); setFocusLeadId(id); }} />
      </Suspense>}
    </div>
  );
}

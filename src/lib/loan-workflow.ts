import { needsBorrowerDocument } from "./document-model";
import { conditionTarget } from "./uwm-alert-model";
import { prospectingBlocked, type Loan, type Workspace } from "./model";
import { afterHours, fundingTaskAudience, fundingTaskId } from "./playbook-model";
import type { BrokerageRole } from "./brokerage-model";
import { secondReviewBlocker } from "./application-model";
import { loanReviewsTarget } from "./loan-review-model";
import { disclosureTarget, disclosureTask } from "./disclosure-model";
import { mockUwmReceiptTaskPrefix } from "./uwm-handoff-recovery";
import { isSharedQuoteReview, sharedQuoteReviewTarget } from "./shared-quote-model";

export const workFilters = ["Overdue", "Stalled", "Unassigned", "Paused or ended"] as const;
export type WorkFilter = (typeof workFilters)[number];
const day = 86_400_000;
export const stalledLoanDays = 7;
export const stalledLoanCutoff = (now: number) => now - stalledLoanDays * day;

type LoanActionRecord = Pick<Loan, "id" | "stage" | "contactId" | "officer" | "disposition" | "dispositionReason" | "revisitDate">;
export type LoanNextActionState = {
  applications: (Pick<Workspace["applications"][number], "loanId" | "submittedAt" | "reviewedAt" | "secondReviewApproved" | "revision" | "uwmReference" | "uwmPendingReceipt" | "correctionNote" | "manualHandoff" | "lastManualSubmissionId" | "joint"> & {
    versions: Pick<Workspace["applications"][number]["versions"][number], "revision" | "uwmReceipt">[];
  })[];
  contacts: Pick<Workspace["contacts"][number], "id" | "outreachSuppressed">[];
  tasks: Pick<Workspace["tasks"][number], "id" | "loanId" | "title" | "dueAt" | "completedAt" | "purpose">[];
  documentRequests: Pick<Workspace["documentRequests"][number], "id" | "loanId" | "status" | "kind" | "conditionId" | "submissionId" | "uwmReceipt">[];
  submissions: Pick<Workspace["submissions"][number], "id" | "loanId" | "lender" | "externalId" | "status" | "syncedAt" | "conditions">[];
  closingPlans: Workspace["closingPlans"];
  pastClients: Pick<Workspace["pastClients"][number], "loanId" | "closingDate">[];
  closingProgress: Pick<Workspace["closingProgress"][number], "loanId" | "fundingDate">[];
  loanProcessing: Pick<Workspace["loanProcessing"][number], "loanId" | "processorEmail" | "processorName" | "status" | "updatedAt">[];
  playbook: Pick<Workspace["playbook"], "reviewHours" | "handoffHours"> & Partial<Pick<Workspace["playbook"], "requireSecondReview">>;
};
type LoanNextAction = { title: string; target: string; dueAt: string | null; blocker: string | null; taskId?: string };

export const closingChecklistTarget = (id: string) => `closing-checklist-${id}`;
export const closingChecklistListTarget = "closing-checklist-items";
export const fundingCheckInTarget = "funding-check-in";
export const closingWorkbenchTarget = "closing-workbench";
export const loanAmountComparisonTarget = "loan-amount-comparison";
export const reopenedMockClosingMessage = "Clear the reopened mock UWM condition before advancing closing or funding.";
export const mockClearanceClosingStages = ["Clear to Close", "Funded", "Closed"] as const;

export function reopenedMockClosingCondition(loanId: string,
  submissions: Pick<Workspace["submissions"][number], "id" | "loanId" | "lender" | "syncedAt" | "conditions">[]) {
  for (const file of submissions) {
    if (file.loanId !== loanId || file.lender !== "UWM" || !file.syncedAt) continue;
    const condition = file.conditions.find(({ mockReopenedAt, satisfiedAt }) => mockReopenedAt && !satisfiedAt);
    if (condition) return { category: condition.category, target: conditionTarget(file.id, condition.id) };
  }
  return null;
}

export function pausedLoan(loan: Pick<Loan, "disposition">) {
  return !!loan.disposition && loan.disposition !== "Active";
}

export function isStalledLoan(loan: Pick<Loan, "disposition" | "stage" | "stageSince">, now: number) {
  return !pausedLoan(loan) && loan.stage !== "Funded" && loan.stage !== "Closed" && Date.parse(loan.stageSince) <= stalledLoanCutoff(now);
}

export function loanTaskTarget(id: string, readOnly = false) {
  if (disclosureTask(id)) return disclosureTarget;
  if (isSharedQuoteReview(id)) return sharedQuoteReviewTarget;
  if (id.startsWith("first-contact:") || id.startsWith("outreach:")) return "loan-activity";
  if (id.startsWith("application-") || id.startsWith(mockUwmReceiptTaskPrefix)) return "loan-application";
  if (id.startsWith("rate-watch:") || id.startsWith("closing-anniversary:")) return "loan-retention";
  const audience = fundingTaskAudience(id);
  if (audience) return audience === "Borrower" && !readOnly ? fundingCheckInTarget : "loan-communications";
  return "loan-tasks";
}

export function canRecordFundingCheckIn(loan: Pick<Loan, "id" | "disposition">, state: Pick<LoanNextActionState, "closingProgress" | "tasks">,
  role?: BrokerageRole) {
  return role !== "Processor" && !pausedLoan(loan) && state.closingProgress.some((item) => item.loanId === loan.id && item.fundingDate) &&
    state.tasks.some((item) => item.loanId === loan.id && item.id === fundingTaskId(loan.id, "borrower") && !item.completedAt);
}

export function closingReviewReady(loan: Pick<Loan, "id" | "stage" | "disposition">,
  state: Pick<LoanNextActionState, "applications" | "documentRequests" | "submissions" | "loanProcessing" | "pastClients" | "closingProgress">) {
  if (pausedLoan(loan) || loan.stage === "Funded" || loan.stage === "Closed" ||
    state.pastClients.some((item) => item.loanId === loan.id && item.closingDate) ||
    state.closingProgress.some((item) => item.loanId === loan.id && item.fundingDate) ||
    state.loanProcessing.some((item) => item.loanId === loan.id && item.processorEmail && item.status !== "Complete")) return false;
  const application = state.applications.find((item) => item.loanId === loan.id);
  if (!application?.submittedAt || !application.reviewedAt || application.correctionNote || application.uwmPendingReceipt) return false;
  const submissions = state.submissions.filter((item) => item.loanId === loan.id);
  if (submissions.some((item) => item.conditions.some(({ satisfiedAt }) => !satisfiedAt)) ||
    state.documentRequests.some((item) => item.loanId === loan.id && item.status !== "Accepted")) return false;
  if (!application.uwmReference) {
    return Boolean(application.manualHandoff?.exportPrepared && application.manualHandoff.outcome === "Acknowledged" &&
      submissions.some((item) => item.id === application.manualHandoff?.submissionId && item.syncedAt === null &&
        item.conditions.length && item.conditions.every(({ manual }) => manual?.confirmedDelivery)));
  }
  return application.uwmReference.startsWith("DEMO-") &&
    application.versions.some(({ revision, uwmReceipt }) => revision === application.revision && uwmReceipt) &&
    submissions.some((item) => item.lender === "UWM" && item.externalId === application.uwmReference && item.syncedAt &&
      item.conditions.length && (item.status === "Conditions cleared" || item.status === "Wholesale - Clear To Close"));
}

export function loanNextAction(loan: LoanActionRecord, state: LoanNextActionState, role?: BrokerageRole): LoanNextAction {
  if (pausedLoan(loan)) return {
    title: loan.disposition === "On hold" ? "Review hold" : "Review disposition",
    target: "loan-workflow",
    dueAt: loan.revisitDate ? `${loan.revisitDate}T17:00:00.000Z` : null,
    blocker: loan.dispositionReason || loan.disposition || null,
  };
  const application = state.applications.find((item) => item.loanId === loan.id);
  const optedOut = state.contacts.find((contact) => contact.id === loan.contactId)?.outreachSuppressed;
  const documents = state.documentRequests.filter((item) => item.loanId === loan.id);
  const received = documents.find((item) => item.status === "Received");
  const outstanding = documents.find((item) => needsBorrowerDocument(item.status));
  const closing = state.closingPlans.find((item) => item.loanId === loan.id);
  const actualClosing = state.pastClients.find((item) => item.loanId === loan.id)?.closingDate;
  const funding = state.closingProgress.find((item) => item.loanId === loan.id)?.fundingDate;
  const borrowerCheckIn = fundingTaskId(loan.id, "borrower");
  const task = state.tasks.find((item) => item.loanId === loan.id && !item.completedAt && !prospectingBlocked(item.purpose, optedOut) &&
    (item.id !== borrowerCheckIn || (funding && role !== "Processor")));
  const pastClient = loan.stage === "Funded" || loan.stage === "Closed";
  const processing = state.loanProcessing.find((item) => item.loanId === loan.id && item.processorEmail);
  if (application?.joint && !application.submittedAt && !pastClient) return {
    title: application.correctionNote ? "Follow up on joint 1003 correction" : "Follow up on joint 1003",
    target: "loan-application", dueAt: null, blocker: application.joint.primarySubmittedAt ? "Waiting on co-borrower" :
      application.joint.submittedAt ? "Waiting on primary borrower" : "Waiting on both borrowers",
  };
  if (application?.correctionNote && !pastClient) return {
    title: "Follow up on corrected 1003", target: "loan-application", dueAt: null, blocker: "Waiting on borrower",
  };
  if (application?.submittedAt && !application.reviewedAt) return {
    title: "Review submitted 1003", target: "loan-application", dueAt: afterHours(application.submittedAt, state.playbook.reviewHours), blocker: null,
  };
  if (!pastClient && application?.uwmPendingReceipt) return {
    title: role === "Processor" ? "Await mock UWM receipt review" : "Check mock UWM submission receipt",
    target: "loan-application", dueAt: application.uwmPendingReceipt.attemptedAt,
    blocker: role === "Processor" ? loan.officer : "Lender response pending",
  };
  const currentReceipt = application?.versions.some((version) => version.revision === application.revision && version.uwmReceipt);
  const manualReceipt = application?.manualHandoff?.outcome === "Acknowledged" && state.submissions.find((item) =>
    item.id === application.manualHandoff?.submissionId && item.loanId === loan.id && item.syncedAt === null);
  const processingPending = processing?.status === "Assigned" || processing?.status === "Ready for processing";
  const checkpoint = secondReviewBlocker(Boolean(state.playbook.requireSecondReview), application);
  if (!pastClient && application?.reviewedAt && checkpoint && (processingPending || (!currentReceipt && !manualReceipt))) return {
    title: "Complete required second review", target: loanReviewsTarget, dueAt: null, blocker: "Current 1003 approval required",
  };
  if (!pastClient && application?.reviewedAt && application.uwmReference && !currentReceipt) return {
    title: role === "Processor" ? "Await updated 1003 handoff" : "Send current 1003 to mock UWM",
    target: "loan-application", dueAt: null, blocker: role === "Processor" ? loan.officer : null,
  };
  if (processing && application?.reviewedAt && !pastClient && !actualClosing) {
    const dueAt = afterHours(processing.status === "Assigned" ? application.reviewedAt : processing.updatedAt, state.playbook.handoffHours);
    if (processing.status === "Ready for processing") return {
      title: role === "Processor" ? "Accept processing handoff" : "Await processor acceptance", target: "processing-handoff", dueAt,
      blocker: role === "Processor" ? null : processing.processorName,
    };
    if (processing.status === "Assigned") return {
      title: role === "Processor" ? "Await loan officer handoff" : "Send to processing", target: "processing-handoff", dueAt,
      blocker: role === "Processor" ? loan.officer : null,
    };
    if (processing.status === "Returned to LO") return {
      title: role === "Processor" ? "Await loan officer review" : "Review returned handoff", target: "processing-handoff", dueAt,
      blocker: role === "Processor" ? loan.officer : null,
    };
  }
  if (received) return { title: `Review ${received.kind}`, target: `document-${received.id}`, dueAt: null, blocker: null };
  if (!pastClient && !actualClosing && application?.reviewedAt && !application.uwmReference &&
    application.lastManualSubmissionId && !application.manualHandoff?.submissionId) {
    return { title: "Prepare revised manual handoff", target: "manual-lender-export", dueAt: null, blocker: null };
  }
  const outstandingCondition = state.submissions.filter((item) => item.loanId === loan.id &&
    (item.lender === "UWM" && item.syncedAt || manualReceipt && item.id === manualReceipt.id))
    .flatMap((item) => item.conditions.filter((condition) => !condition.satisfiedAt).map((condition) => ({
      condition, target: conditionTarget(item.id, condition.id),
      request: documents.find((request) => request.submissionId === item.id && request.conditionId === condition.id),
    })));
  const actionable = outstandingCondition.find(({ request }) => request?.status === "Accepted")
    ?? outstandingCondition.find(({ request }) => !request);
  if (actionable) return {
    title: actionable.condition.manual || !actionable.request ? `Work ${actionable.condition.category.toLowerCase()} condition` :
      actionable.request.uwmReceipt ? "Check mock UWM clearance" : "Send accepted document",
    target: actionable.target, dueAt: null, blocker: actionable.request ? null : actionable.condition.manual ? "Open lender condition" : "Open UWM condition",
  };
  const waitingCondition = outstandingCondition.find(({ request }) => request && needsBorrowerDocument(request.status));
  if (waitingCondition?.request) return {
    title: `Follow up on ${waitingCondition.request.kind}`, target: waitingCondition.target, dueAt: null,
    blocker: application?.submittedAt ? "Waiting on borrower" : "Waiting for the 1003",
  };
  if (!funding && actualClosing && loan.stage !== "Closed") return {
    title: "Record funding", target: "loan-funding", dueAt: null, blocker: null,
  };
  if (role !== "Processor" && loan.stage !== "Clear to Close" && closingReviewReady(loan, state)) return {
    title: "Review closing readiness", target: closingWorkbenchTarget, dueAt: closing ? `${closing.targetDate}T21:00:00.000Z` : null, blocker: null,
  };
  if (!pastClient && (loan.stage === "Clear to Close" || closing)) return {
    title: "Review closing checklist", target: closingWorkbenchTarget, dueAt: closing ? `${closing.targetDate}T21:00:00.000Z` : null, blocker: null,
  };
  if (task) return { title: task.title, target: loanTaskTarget(task.id), dueAt: task.dueAt, blocker: null, taskId: task.id };
  if (outstanding) return {
    title: `Follow up on ${outstanding.kind}`, target: `document-${outstanding.id}`, dueAt: null,
    blocker: application?.submittedAt ? "Waiting on borrower" : "Waiting for the 1003",
  };
  if (pastClient) return {
    title: "Review past-client follow-up", target: "loan-retention", dueAt: null, blocker: null,
  };
  if (role === "Processor" && processing?.status === "In processing") return {
    title: "Review processing handoff", target: "processing-handoff", dueAt: null, blocker: null,
  };
  if (!application?.submittedAt) return {
    title: application ? "Follow up on 1003" : "Start the 1003", target: "loan-application", dueAt: null,
    blocker: application ? "Waiting on borrower" : null,
  };
  return { title: "Review lender next steps", target: "lender-submissions", dueAt: null, blocker: null };
}

export function matchesWorkFilter(loan: Loan, dueAt: string | null, filter: WorkFilter | "", now: number, signedIn: boolean) {
  if (filter === "Paused or ended") return pausedLoan(loan);
  if (filter === "Overdue") return !!dueAt && Date.parse(dueAt) < now;
  if (filter === "Unassigned") return signedIn ? !loan.officerEmail : !loan.officer;
  if (filter === "Stalled") return isStalledLoan(loan, now);
  return true;
}

import { needsBorrowerDocument } from "./document-model";
import { conditionTarget } from "./uwm-alert-model";
import type { Loan, Workspace } from "./model";

export const workFilters = ["Overdue", "Stalled", "Unassigned", "Paused or ended"] as const;
export type WorkFilter = (typeof workFilters)[number];
const day = 86_400_000;

export function pausedLoan(loan: Loan) {
  return !!loan.disposition && loan.disposition !== "Active";
}

export function loanTaskTarget(id: string) {
  if (id.startsWith("first-contact:") || id.startsWith("outreach:")) return "loan-activity";
  if (id.startsWith("application-")) return "loan-application";
  if (id.startsWith("rate-watch:") || id.startsWith("closing-anniversary:")) return "loan-retention";
  return "loan-tasks";
}

export function loanNextAction(loan: Loan, state: Workspace) {
  if (pausedLoan(loan)) return {
    title: loan.disposition === "On hold" ? "Review hold" : "Review disposition",
    target: "loan-workflow",
    dueAt: loan.revisitDate ? `${loan.revisitDate}T17:00:00.000Z` : null,
    blocker: loan.dispositionReason || loan.disposition,
  };
  const application = state.applications.find((item) => item.loanId === loan.id);
  const task = state.tasks.find((item) => item.loanId === loan.id && !item.completedAt);
  const documents = state.documentRequests.filter((item) => item.loanId === loan.id);
  const received = documents.find((item) => item.status === "Received");
  const outstanding = documents.find((item) => needsBorrowerDocument(item.status));
  const closing = state.closingPlans.find((item) => item.loanId === loan.id);
  if (application?.submittedAt && !application.reviewedAt) return {
    title: "Review submitted 1003", target: "loan-application", dueAt: new Date(Date.parse(application.submittedAt) + day).toISOString(), blocker: null,
  };
  if (received) return { title: `Review ${received.kind}`, target: `document-${received.id}`, dueAt: null, blocker: null };
  const outstandingCondition = state.submissions.filter((item) => item.loanId === loan.id && item.lender === "UWM" && item.syncedAt)
    .flatMap((item) => item.conditions.filter((condition) => !condition.satisfiedAt).map((condition) => ({
      condition, target: conditionTarget(item.id, condition.id),
      request: documents.find((request) => request.submissionId === item.id && request.conditionId === condition.id),
    })));
  const actionable = outstandingCondition.find(({ request }) => request?.status === "Accepted")
    ?? outstandingCondition.find(({ request }) => !request);
  if (actionable) return {
    title: actionable.request?.uwmReceipt ? "Check mock UWM clearance" : actionable.request ? "Send accepted document" : `Work ${actionable.condition.category.toLowerCase()} condition`,
    target: actionable.target, dueAt: null, blocker: actionable.request ? null : "Open UWM condition",
  };
  const waitingCondition = outstandingCondition.find(({ request }) => request && needsBorrowerDocument(request.status));
  if (waitingCondition?.request) return {
    title: `Follow up on ${waitingCondition.request.kind}`, target: waitingCondition.target, dueAt: null,
    blocker: application?.submittedAt ? "Waiting on borrower" : "Waiting for the 1003",
  };
  const pastClient = loan.stage === "Funded" || loan.stage === "Closed";
  if (!pastClient && (loan.stage === "Clear to Close" || closing)) return {
    title: "Review closing checklist", target: "closing-workbench", dueAt: closing ? `${closing.targetDate}T21:00:00.000Z` : null, blocker: null,
  };
  if (task) return { title: task.title, target: loanTaskTarget(task.id), dueAt: task.dueAt, blocker: null };
  if (outstanding) return {
    title: `Follow up on ${outstanding.kind}`, target: `document-${outstanding.id}`, dueAt: null,
    blocker: application?.submittedAt ? "Waiting on borrower" : "Waiting for the 1003",
  };
  if (pastClient) return {
    title: "Review past-client follow-up", target: "loan-retention", dueAt: null, blocker: null,
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
  if (filter === "Stalled") return !pausedLoan(loan) && loan.stage !== "Funded" && loan.stage !== "Closed" && now - Date.parse(loan.stageSince) >= 7 * day;
  return true;
}

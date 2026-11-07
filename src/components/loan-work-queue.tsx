import type { Loan, Workspace } from "@/lib/model";
import { dateLabel, easternDate, pastClientLoan } from "@/lib/client-retention";
import { needsBorrowerDocument } from "@/lib/document-model";
import { lockExpiringSoon, mockLockNoticeDays } from "@/lib/pricing-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function LoanWorkQueue({ loans, state, borrower, open }: {
  loans: Loan[]; state: Workspace; borrower: (loan: Loan) => string; open: (loanId: string, target: string) => void;
}) {
  const assigned = new Map(loans.map((loan) => [loan.id, loan]));
  const submitted = new Set(state.applications.filter((application) => application.submittedAt).map((application) => application.loanId));
  const applications = state.applications.flatMap((application) => {
    const loan = assigned.get(application.loanId);
    return loan && application.submittedAt && !application.reviewedAt ? [{
      loan, target: "loan-application", title: "Review submitted 1003", status: "Ready for review", since: application.submittedAt,
    }] : [];
  });
  const documents = state.documentRequests.flatMap((request) => {
    const loan = assigned.get(request.loanId);
    return loan && request.status !== "Accepted" ? [{
      loan, target: `document-${request.id}`, title: request.status === "Needs replacement" ? `${request.kind} replacement` : request.kind,
      status: !needsBorrowerDocument(request.status) ? "Ready for review" : submitted.has(loan.id) ? "Waiting on borrower" : "Waiting for 1003",
      since: request.status === "Received" ? request.submittedAt ?? request.requestedAt : request.requestedAt,
    }] : [];
  });
  const clock = new Date();
  const now = clock.toISOString();
  const today = easternDate(clock);
  const nextWeek = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const closed = new Set(state.pastClients.filter((profile) => profile.closingDate).map((profile) => profile.loanId));
  const outstandingClosingItems = new Map<string, number>();
  for (const item of state.closingItems) {
    if (!item.completedAt) outstandingClosingItems.set(item.loanId, (outstandingClosingItems.get(item.loanId) ?? 0) + 1);
  }
  const closings = state.closingPlans.flatMap((plan) => {
    const loan = assigned.get(plan.loanId);
    const outstanding = outstandingClosingItems.get(plan.loanId);
    return loan && !pastClientLoan(loan) && !closed.has(loan.id) && outstanding && plan.targetDate <= nextWeek ? [{
      loan, target: "closing-workbench", title: plan.targetDate < today ? "Target closing date passed" : "Closing soon",
      status: `${outstanding} outstanding`, since: plan.targetDate,
    }] : [];
  }).sort((a, b) => a.since.localeCompare(b.since));
  const locks = state.mockUwmRates.flatMap((rate) => {
    const loan = assigned.get(rate.loanId);
    return loan && rate.lockExpiresAt && lockExpiringSoon(rate, now) ? [{
      loan, target: "uwm-rate-lock", title: "UWM lock expiring", status: "Expires", since: rate.lockExpiresAt,
    }] : [];
  }).sort((a, b) => a.since.localeCompare(b.since));
  const followUps = [...applications, ...documents].sort((a, b) => a.status.localeCompare(b.status) || a.since.localeCompare(b.since));
  const items = [...closings, ...locks, ...followUps];

  return <div className="work-queue">
    <div className="section-heading"><h3>Loan work queue</h3><span className="pill">{items.length} open</span></div>
    <p className="muted work-queue-note">Flags loans with open checklist items and a target closing date within seven days or already past. Also shows mock locks expiring in the next {mockLockNoticeDays} days.</p>
    {items.length ? <ul className="loan-task-list">{items.map((item) => <li className="loan-task" key={`${item.loan.id}:${item.target}`}>
      <div className="loan-task-copy"><strong>{item.title}</strong><span>{borrower(item.loan)} · {item.loan.officer || "Unassigned"}</span>
        <span className="muted">{item.status} · {item.target === "closing-workbench" ? `Target closing ${dateLabel(item.since)}` : `${dateTime(item.since)} ET`}</span></div>
      <Button variant="outline" size="sm" onClick={() => open(item.loan.id, item.target)}>Open item</Button>
    </li>)}</ul> : <p className="empty-inline">No loan work items in this view.</p>}
  </div>;
}

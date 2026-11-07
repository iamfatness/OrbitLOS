import type { Loan, Workspace } from "@/lib/model";
import { needsBorrowerDocument } from "@/lib/document-model";
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
  const items = [...applications, ...documents].sort((a, b) => a.status.localeCompare(b.status) || a.since.localeCompare(b.since));

  return <div className="work-queue">
    <div className="section-heading"><h3>Loan work queue</h3><span className="pill">{items.length} open</span></div>
    {items.length ? <ul className="loan-task-list">{items.map((item) => <li className="loan-task" key={`${item.loan.id}:${item.target}`}>
      <div className="loan-task-copy"><strong>{item.title}</strong><span>{borrower(item.loan)} · {item.loan.officer || "Unassigned"}</span>
        <span className="muted">{item.status} · {dateTime(item.since)} ET</span></div>
      <Button variant="outline" size="sm" onClick={() => open(item.loan.id, item.target)}>Open item</Button>
    </li>)}</ul> : <p className="empty-inline">No applications or documents need attention in this view.</p>}
  </div>;
}

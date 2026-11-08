"use client";

import { availableProcessingActions, type LoanProcessing } from "@/lib/processing-model";
import type { Loan } from "@/lib/model";
import type { StaffApplication } from "@/lib/application-model";
import type { LoanDocumentRequest } from "@/lib/document-model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function ProcessingHandoff({ loan, assignment, application, documents, staff, busy, save, open }: {
  loan: Loan; assignment?: LoanProcessing; application?: StaffApplication; documents: LoanDocumentRequest[];
  staff: WorkspaceStaff | null; busy: boolean; save: (input: unknown) => void; open: (target: string) => void;
}) {
  const role = staff?.brokerage.role ?? "Admin";
  const actions = assignment ? availableProcessingActions(assignment.status, role) : [];
  const needsReview = !!application?.correctionNote || (!!application?.submittedAt && !application.reviewedAt);
  return <section className="details-section" id="processing-handoff" tabIndex={-1} aria-label="Processing handoff">
    <div className="section-heading"><h3>Processing handoff</h3><span className="pill">{assignment?.status ?? "Unassigned"}</span></div>
    <p>Loan owner {loan.officer || "Unassigned"} · Processor {assignment?.processorName || "Unassigned"}</p>
    {(application?.submittedAt || needsReview || assignment?.processorEmail) && <div className="loan-application-box">
      <strong>File checklist</strong>
      <Button size="sm" variant="outline" onClick={() => open("loan-application")}>
        {application?.reviewedAt ? `1003 reviewed · Revision ${application.revision}` : needsReview ? "1003 needs review or correction" : "No submitted 1003"}
      </Button>
      {documents.length ? <ul className="loan-task-list">{documents.map((document) => <li key={document.id}>
        <button className="name-link" onClick={() => open(`document-${document.id}`)}>{document.kind} · {document.status}</button>
      </li>)}</ul> : <p className="muted">No document requests on this file.</p>}
    </div>}
    {assignment?.processorEmail ? <>
      <p className="muted">Updated {dateTime(assignment.updatedAt)} ET</p>
      {assignment.note && <p>{assignment.note}</p>}
      {actions.length > 0 && <form className="record-form" key={assignment.revision} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        const action = data.get("action") ?? actions[0];
        save({ type: "updateProcessing", loanId: loan.id, revision: assignment.revision, action, note: data.get("note") });
      }}>
        <label className="field">Handoff note<textarea name="note" rows={2} maxLength={500} /></label>
        <div className="loan-application-actions">{actions.map((action) => <Button key={action} size="sm" type="submit" name="action" value={action}
          disabled={busy || (needsReview && (action === "Send to processing" || action === "Accept handoff"))}>{action}</Button>)}</div>
      </form>}
    </> : <p className="muted">A brokerage admin can add a processor from Team. The current loan owner keeps access.</p>}
  </section>;
}

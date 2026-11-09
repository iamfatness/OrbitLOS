"use client";

import { availableProcessingActions, processingActivityPrefix, type LoanProcessing, type ProcessingAction } from "@/lib/processing-model";
import type { Loan, Workspace } from "@/lib/model";
import { secondReviewBlocker, type StaffApplication } from "@/lib/application-model";
import type { LoanDocumentRequest } from "@/lib/document-model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { pausedLoan } from "@/lib/loan-workflow";
import { Button } from "./ui/button";

export function SecondReviewCheckpoint({ blocker, revision, busy, openReviews }: {
  blocker: string | null; revision?: number; busy: boolean; openReviews?: () => void;
}) {
  return <section className="loan-application-box" aria-label="1003 handoff checkpoint">
    <p>{blocker ?? `Second review approved · 1003 revision ${revision}`}</p>
    {openReviews && <div><Button size="sm" variant="outline" disabled={busy} onClick={openReviews}>Open team reviews</Button></div>}
  </section>;
}

export function ProcessingHandoff({ loan, assignment, application, documents, history, requireSecondReview, staff, busy, save, open, openReviews, openAssignment }: {
  loan: Loan; assignment?: LoanProcessing; application?: StaffApplication; documents: LoanDocumentRequest[]; history?: Workspace["processingActivity"];
  requireSecondReview: boolean; staff: WorkspaceStaff | null; busy: boolean;
  save: (input: unknown) => void; open: (target: string) => void; openReviews?: () => void; openAssignment?: () => void;
}) {
  const role = staff?.brokerage.role ?? "Admin";
  const paused = pausedLoan(loan);
  const actions = assignment && !paused ? availableProcessingActions(assignment.status, role) : [];
  const needsReview = !!application?.correctionNote || (!!application?.submittedAt && !application.reviewedAt);
  const blocker = secondReviewBlocker(requireSecondReview, application);
  const blocked = (action: ProcessingAction) => Boolean(needsReview || blocker) && (action === "Send to processing" || action === "Accept handoff");
  return <section className="details-section" id="processing-handoff" tabIndex={-1} aria-label="Processing handoff">
    <div className="section-heading"><h3>Processing handoff</h3><span className="pill">{assignment?.status ?? "Unassigned"}</span></div>
    <p>Loan owner {loan.officer || "Unassigned"} · Processor {assignment?.processorName || "Unassigned"}</p>
    {openAssignment && <div><Button size="sm" variant="outline" disabled={busy} onClick={openAssignment}>Manage assignment</Button></div>}
    {requireSecondReview && <SecondReviewCheckpoint blocker={blocker} revision={application?.revision} busy={busy} openReviews={openReviews} />}
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
      {paused && <p className="muted">The processing handoff resumes when the loan is reopened.</p>}
      <p className="muted">Updated {dateTime(assignment.updatedAt)} ET</p>
      {assignment.note && <p>{assignment.note}</p>}
      {actions.length > 0 && <form className="record-form" key={assignment.revision} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        const action = actions.find((item) => item === data.get("action")) ?? actions.find((item) => !blocked(item));
        if (!action || busy || blocked(action)) return;
        save({ type: "updateProcessing", loanId: loan.id, revision: assignment.revision, action, note: data.get("note") });
      }}>
        <label className="field">Handoff note<textarea name="note" rows={2} maxLength={500} /></label>
        <div className="loan-application-actions">{actions.map((action) => <Button key={action} size="sm" type="submit" name="action" value={action}
          disabled={busy || blocked(action)}>{action}</Button>)}</div>
      </form>}
    </> : !openAssignment && <p className="muted">A brokerage admin can add a processor. The current loan owner keeps access.</p>}
    {history && history.length > 0 && <details className="document-form" key={assignment?.revision}
      open={assignment?.status === "In processing" || assignment?.status === "Complete"}>
      <summary>Recent handoff history</summary>
      <ul className="document-list">{history.map((event) => <li key={event.id}>
        <p>{event.text.slice(processingActivityPrefix.length)}</p>
        <small className="muted">{dateTime(event.createdAt)} ET</small>
      </li>)}</ul>
    </details>}
  </section>;
}

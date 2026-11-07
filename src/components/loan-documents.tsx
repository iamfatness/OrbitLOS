"use client";

import { FileCheck2, Plus, RefreshCw } from "lucide-react";
import { documentKinds, needsBorrowerDocument, type LoanDocumentRequest } from "@/lib/document-model";
import { dateTime } from "@/lib/utils";
import { DocumentStatusPill, SampleDocument } from "./sample-document";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: () => void) => Promise<void>;

export function LoanDocuments({ loanId, requests, applicationStarted, busy, save }: {
  loanId: string; requests: LoanDocumentRequest[]; applicationStarted: boolean; busy: boolean; save: Save;
}) {
  const waiting = requests.filter((item) => needsBorrowerDocument(item.status)).length;
  const received = requests.filter((item) => item.status === "Received").length;
  const available = documentKinds.filter((kind) => !requests.some((request) => request.kind === kind));

  return <section className="details-section document-section" aria-label="Document checklist">
    <div className="section-heading"><h3><FileCheck2 size={17} /> Document checklist</h3>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: "refreshApplication", loanId })}><RefreshCw /> Refresh checklist</Button>
    </div>
    {requests.length > 0 && <p className="document-counts">{waiting} waiting on borrower · {received} ready for review · {requests.length - waiting - received} accepted</p>}
    <p className="muted">{applicationStarted ? "The checklist appears in the borrower’s link after they submit the 1003." : "Start a 1003 on this loan to give the borrower access to the checklist after submission."} Use fictional instructions and sample documents.</p>
    {available.length > 0 && <details className="document-form">
      <summary><Plus size={15} /> Request document</summary>
      <form onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        void save({ type: "requestDocument", loanId, kind: data.get("kind"), instructions: data.get("instructions") }, () => {
          form.reset();
          form.closest("details")?.removeAttribute("open");
        });
      }}>
        <label>Document type<select name="kind" required>{available.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label>Instructions for borrower (optional)<textarea name="instructions" rows={2} maxLength={500} /></label>
        <Button size="sm" type="submit" disabled={busy}>Add to checklist</Button>
      </form>
    </details>}
    {requests.length ? <ul className="document-list">{requests.map((request) =>
      <li className="document-item" key={`${request.id}:${request.revision}`}>
        <div className="document-item-head"><strong>{request.kind}</strong><DocumentStatusPill status={request.status} /></div>
        {request.instructions && <p>{request.instructions}</p>}
        {request.replacementNote && <p><strong>Replacement instructions</strong> · {request.replacementNote}</p>}
        <small className="muted">Requested {dateTime(request.requestedAt)} ET{request.submittedAt && ` · Last sample received ${dateTime(request.submittedAt)} ET`}</small>
        {request.submittedAt && <SampleDocument kind={request.kind} />}
        {request.status === "Received" && <div className="document-review">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
            type: "reviewDocument", loanId, requestId: request.id, revision: request.revision, decision: "Accepted", replacementNote: "",
          })}>Accept sample</Button>
          <details className="document-form">
            <summary>Request replacement</summary>
            <form onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void save({ type: "reviewDocument", loanId, requestId: request.id, revision: request.revision,
                decision: "Needs replacement", replacementNote: data.get("replacementNote") });
            }}>
              <label>Message to borrower<textarea name="replacementNote" required rows={2} maxLength={500} /></label>
              <Button type="submit" size="sm" variant="outline" disabled={busy}>Add replacement request</Button>
            </form>
          </details>
        </div>}
      </li>
    )}</ul> : <p className="empty-inline">No documents requested yet.</p>}
  </section>;
}

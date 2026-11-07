"use client";

import { FileCheck2, Mail, Plus, RefreshCw, Send } from "lucide-react";
import { documentKinds, needsBorrowerDocument, type DocumentKind, type LoanDocumentRequest } from "@/lib/document-model";
import type { Condition } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { DocumentStatusPill, SampleDocument } from "./sample-document";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: () => void) => Promise<void>;

export function DocumentRequestForm({ loanId, kinds = documentKinds, source, busy, save }: {
  loanId: string; kinds?: readonly DocumentKind[]; source?: { submissionId: string; condition: Condition }; busy: boolean; save: Save;
}) {
  const suggestedKind = source?.condition.category === "Income" ? "Pay stub" : source?.condition.category === "Assets" ? "Bank statement" : "";
  return <details className="document-form">
    <summary><Plus size={15} /> {source ? "Request borrower document" : "Request document"}</summary>
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      void save({ type: "requestDocument", loanId, kind: data.get("kind"), instructions: data.get("instructions"),
        condition: source && { submissionId: source.submissionId, conditionId: source.condition.id },
      }, () => {
        form.reset();
        form.closest("details")?.removeAttribute("open");
      });
    }}>
      <label>Document type<select name="kind" defaultValue={source ? suggestedKind : kinds[0]} required>
        {source && <option value="" disabled>Choose a document type</option>}
        {kinds.map((kind) => <option key={kind}>{kind}</option>)}
      </select></label>
      <label>{source ? "Instructions shown to borrower" : "Instructions for borrower (optional)"}
        <textarea name="instructions" rows={2} maxLength={500} required={Boolean(source)} defaultValue={source?.condition.description.slice(0, 500)} />
      </label>
      <Button size="sm" type="submit" disabled={busy}>Add to checklist</Button>
    </form>
  </details>;
}

export function LoanDocuments({ loanId, brokerageId, requests, openConditionRequests, applicationStarted, applicationSubmitted, busy, save, followUp }: {
  loanId: string; brokerageId: string; requests: LoanDocumentRequest[]; openConditionRequests: Set<string>;
  applicationStarted: boolean; applicationSubmitted: boolean; busy: boolean; save: Save; followUp: () => void;
}) {
  const waiting = requests.filter((item) => needsBorrowerDocument(item.status)).length;
  const received = requests.filter((item) => item.status === "Received").length;
  const available = documentKinds.filter((kind) => !requests.some((request) => request.kind === kind && !request.conditionId));

  return <section className="details-section document-section" aria-label="Document checklist">
    <div className="section-heading"><h3><FileCheck2 size={17} /> Document checklist</h3>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: "refreshApplication", loanId })}><RefreshCw /> Refresh checklist</Button>
    </div>
    {requests.length > 0 && <p className="document-counts">{waiting} waiting on borrower · {received} ready for review · {requests.length - waiting - received} accepted</p>}
    {waiting > 0 && applicationSubmitted && <div><Button size="sm" variant="outline" onClick={followUp}><Mail /> Preview document follow-up</Button></div>}
    <p className="muted">{applicationStarted ? "The checklist appears in the borrower’s link after they submit the 1003." : "Start a 1003 on this loan to give the borrower access to the checklist after submission."} Use fictional files in the demo.</p>
    {available.length > 0 && <DocumentRequestForm loanId={loanId} kinds={available} busy={busy} save={save} />}
    {requests.length ? <ul className="document-list">{requests.map((request) =>
      <li className="document-item" key={`${request.id}:${request.revision}`} id={`document-${request.id}`} tabIndex={-1}>
        <div className="document-item-head"><strong>{request.kind}</strong><DocumentStatusPill status={request.status} /></div>
        {request.conditionId && <small className="muted">Linked UWM condition</small>}
        {request.instructions && <p>{request.instructions}</p>}
        {request.replacementNote && <p><strong>Replacement instructions</strong> · {request.replacementNote}</p>}
        <small className="muted">Requested {dateTime(request.requestedAt)} ET{request.submittedAt && ` · Last ${request.pdfUploadedAt ? "PDF" : "sample"} received ${dateTime(request.submittedAt)} ET`}</small>
        {request.pdfStatus === "Processing" && <p className="muted">Borrower PDF is processing.</p>}
        {request.pdfUploadedAt ? <div><Button size="sm" variant="outline" asChild>
          <a href={`/api/documents/download?brokerage=${brokerageId}&request=${request.id}`}>Download {request.status === "Needs replacement" ? "previous " : ""}PDF</a>
        </Button></div> : request.submittedAt && <SampleDocument kind={request.kind} />}
        {request.uwmReceipt && request.uwmSentAt && <p className="muted"><strong>Sent to UWM · Mock</strong><br />
          {dateTime(request.uwmSentAt)} ET · Receipt {request.uwmReceipt}</p>}
        {request.status === "Accepted" && !request.uwmReceipt && openConditionRequests.has(request.id) &&
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "sendConditionDocument", loanId, requestId: request.id })}>
            <Send /> {request.pdfUploadedAt ? "Record delivery to UWM (mock)" : "Send sample to UWM (mock)"}
          </Button>}
        {request.status === "Received" && <div className="document-review">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
            type: "reviewDocument", loanId, requestId: request.id, revision: request.revision, decision: "Accepted", replacementNote: "",
          })}>{request.pdfUploadedAt ? "Accept PDF" : "Accept sample"}</Button>
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

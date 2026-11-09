"use client";

import { FileCheck2, Mail, Plus, RefreshCw, Send } from "lucide-react";
import { documentKinds, needsBorrowerDocument, suggestedConditionDocument, type DocumentKind, type LoanDocumentRequest } from "@/lib/document-model";
import type { Condition } from "@/lib/model";
import { demoBrokerageId } from "@/lib/brokerage-model";
import { dateLabel } from "@/lib/client-retention";
import { dateTime } from "@/lib/utils";
import { DocumentStatusPill, SampleDocument } from "./sample-document";
import { Button } from "./ui/button";
import { ApplyDocumentChecklist, ManageDocumentTemplates } from "./document-checklist-templates";

type Save = (input: unknown, after?: () => void) => Promise<void>;

export function DocumentRequestForm({ loanId, kinds = documentKinds, source, busy, save, quick = false }: {
  loanId: string; kinds?: readonly DocumentKind[]; source?: { submissionId: string; condition: Condition }; busy: boolean; save: Save; quick?: boolean;
}) {
  const suggested = source && suggestedConditionDocument(source.condition);
  if (quick && source && suggested) return <div className="loan-application-actions">
    <Button size="sm" type="button" disabled={busy} onClick={() => void save({ type: "requestDocument", loanId,
      ...suggested,
      condition: { submissionId: source.submissionId, conditionId: source.condition.id },
    })}><Plus /> Request {suggested.kind.toLowerCase()}</Button>
    <RequestForm loanId={loanId} kinds={kinds} source={source} busy={busy} save={save} suggestedKind={suggested.kind} />
  </div>;
  return <RequestForm loanId={loanId} kinds={kinds} source={source} busy={busy} save={save} suggestedKind={suggested?.kind} />;
}

function RequestForm({ loanId, kinds, source, busy, save, suggestedKind }: {
  loanId: string; kinds: readonly DocumentKind[]; source?: { submissionId: string; condition: Condition }; busy: boolean;
  save: Save; suggestedKind?: DocumentKind;
}) {
  return <details className="document-form">
    <summary><Plus size={15} /> {suggestedKind ? "Customize request" : source ? "Request borrower document" : "Request document"}</summary>
    <form onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      void save({ type: "requestDocument", loanId, kind: data.get("kind"), instructions: data.get("instructions"), dueOn: data.get("dueOn") || null,
        condition: source && { submissionId: source.submissionId, conditionId: source.condition.id },
      }, () => {
        form.reset();
        form.closest("details")?.removeAttribute("open");
      });
    }}>
      <label>Document type<select name="kind" defaultValue={source ? suggestedKind ?? "" : kinds[0]} required>
        {source && <option value="" disabled>Choose a document type</option>}
        {kinds.map((kind) => <option key={kind}>{kind}</option>)}
      </select></label>
      <label>{source ? "Instructions shown to borrower" : "Instructions for borrower (optional)"}
        <textarea name="instructions" rows={2} maxLength={500} required={Boolean(source)} defaultValue={source?.condition.description.slice(0, 500)} />
      </label>
      <label>Borrower due date (optional)<input name="dueOn" type="date" /></label>
      <Button size="sm" type="submit" disabled={busy}>Add to checklist</Button>
    </form>
  </details>;
}

export function LoanDocuments({ loanId, brokerageId, pilot, requests, inlineRequests, openConditionRequests, replaceableRequests,
  applicationStarted, applicationSubmitted, customTemplates, officer, processor, openAssignment, localTemplateEditor, busy, save, followUp }: {
  loanId: string; brokerageId: string; requests: LoanDocumentRequest[]; inlineRequests: Set<string>; openConditionRequests: Set<string>;
  pilot?: boolean;
  replaceableRequests: Set<string>;
  customTemplates: boolean; officer: string; processor?: string | null; openAssignment?: () => void; localTemplateEditor?: boolean;
  applicationStarted: boolean; applicationSubmitted: boolean; busy: boolean; save: Save; followUp: () => void;
}) {
  const standalone = requests.filter((item) => !inlineRequests.has(item.id));
  const waiting = requests.filter((item) => needsBorrowerDocument(item.status)).length;
  const received = requests.filter((item) => item.status === "Received").length;
  const available = documentKinds.filter((kind) => !requests.some((request) => request.kind === kind && !request.conditionId));

  return <section className="details-section document-section" id="document-checklist" tabIndex={-1} aria-label="Document checklist">
    <div className="section-heading"><h3><FileCheck2 size={17} /> Document checklist</h3>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: "refreshApplication", loanId })}><RefreshCw /> Refresh checklist</Button>
    </div>
    {requests.length > 0 && <p className="document-counts">{waiting} waiting on borrower · {received} ready for review · {requests.length - waiting - received} accepted</p>}
    {waiting > 0 && applicationSubmitted && <div><Button size="sm" variant="outline" onClick={followUp}><Mail /> Preview document follow-up</Button></div>}
    {!applicationSubmitted && <p className="muted">{applicationStarted ? "Available to the borrower after 1003 submission." : "Start a 1003 to share the checklist."}</p>}
    {available.length > 0 && <DocumentRequestForm loanId={loanId} kinds={available} busy={busy} save={save} />}
    <ApplyDocumentChecklist key={loanId} loanId={loanId} brokerageId={brokerageId} customAvailable={customTemplates} requests={requests}
      officer={officer} processor={processor} openAssignment={openAssignment} busy={busy} save={save} />
    {localTemplateEditor && <ManageDocumentTemplates brokerageId={brokerageId} />}
    {standalone.length ? <ul className="document-list">{standalone.map((request) => <li key={request.id}>
      <LoanDocumentCard key={request.revision} request={request} brokerageId={brokerageId} pilot={pilot} busy={busy} save={save}
        openCondition={openConditionRequests.has(request.id)} replaceable={replaceableRequests.has(request.id)} />
    </li>)}</ul> : <p className="empty-inline">No standalone document requests. Linked requests appear with their conditions.</p>}
  </section>;
}

export function LoanDocumentCard({ request, brokerageId, pilot, openCondition, replaceable, busy, save, compact = false }: {
  request: LoanDocumentRequest; brokerageId: string; pilot?: boolean; openCondition: boolean; replaceable: boolean;
  busy: boolean; save: Save; compact?: boolean;
}) {
  const loanId = request.loanId;
  const pdfLabel = brokerageId === demoBrokerageId || pilot ? "demo PDF" : "PDF";
  return <div className="document-item" id={`document-${request.id}`} tabIndex={-1}>
        <div className="document-item-head"><strong>{request.kind}</strong><DocumentStatusPill status={request.status} /></div>
        {request.conditionId && !compact && <small className="muted">Linked lender condition</small>}
        {request.templateTitle && <small className="muted">{request.templateTitle} · Version {request.templateRevision}</small>}
        {request.instructions && !compact && <p>{request.instructions}</p>}
        {request.replacementNote && <p><strong>Replacement instructions</strong> · {request.replacementNote}</p>}
        {needsBorrowerDocument(request.status) && <>
          {request.dueOn && <p><strong>Due <time dateTime={request.dueOn}>{dateLabel(request.dueOn)}</time></strong></p>}
          <details className="document-form" key={request.deadlineRevision}>
            <summary>{request.dueOn ? "Edit due date" : "Set due date"}</summary>
            <form onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const dueOn = new FormData(form).get("dueOn") || null;
              void save({ type: "setDocumentDeadline", loanId, requestId: request.id, revision: request.revision,
                deadlineRevision: request.deadlineRevision, dueOn }, () => form.closest("details")?.removeAttribute("open"));
            }}>
              <label>Borrower due date<input name="dueOn" type="date" defaultValue={request.dueOn ?? ""} /></label>
              <p className="muted">Leave the date blank to clear it.</p>
              <Button size="sm" type="submit" disabled={busy}>Save due date</Button>
            </form>
          </details>
        </>}
        <small className="muted">Requested {dateTime(request.requestedAt)} ET{request.submittedAt && ` · Last ${request.pdfUploadedAt ? pdfLabel : "sample"} received ${dateTime(request.submittedAt)} ET`}</small>
        {request.pdfStatus === "Processing" && <p className="muted">Borrower PDF is processing.</p>}
        {request.pdfUploadedAt ? <div><Button size="sm" variant="outline" asChild>
          <a href={`/api/documents/download?brokerage=${brokerageId}&request=${request.id}`}>Download {request.status === "Needs replacement" ? "previous " : ""}{pdfLabel}</a>
        </Button></div> : request.submittedAt && <SampleDocument kind={request.kind} />}
        {request.uwmReceipt && request.uwmSentAt && <p className="muted"><strong>Sent to UWM · Mock</strong><br />
          {dateTime(request.uwmSentAt)} ET · Receipt {request.uwmReceipt}</p>}
        {request.previousUwmDeliveries.length > 0 && <details className="document-form"><summary>Previous mock deliveries</summary>
          <ul>{request.previousUwmDeliveries.map((entry) => <li key={entry.receipt}>
            {entry.receipt} · {dateTime(entry.sentAt)} ET{entry.documentRevision !== null && ` · Revision ${entry.documentRevision}`}
          </li>)}</ul>
        </details>}
        {request.uwmReceipt && request.submissionId && openCondition &&
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "refreshMockUwmClearance", loanId, submissionId: request.submissionId })}>
            <RefreshCw /> Check UWM clearance (mock)
          </Button>}
        {request.status === "Accepted" && !request.uwmReceipt && openCondition && <div className="loan-application-actions">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
            type: "sendConditionDocument", loanId, requestId: request.id, revision: request.revision,
          })}>
            <Send /> {request.uwmDeliveryFailedAt ? "Retry delivery to UWM (mock)" : request.pdfUploadedAt ? "Record delivery to UWM (mock)" : "Send sample to UWM (mock)"}
          </Button>
          {request.uwmDeliveryFailedAt ? <span className="muted">Mock delivery failed · {dateTime(request.uwmDeliveryFailedAt)} ET</span> :
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({
              type: "simulateDeliveryFailure", loanId, requestId: request.id, revision: request.revision,
            })}>Simulate delivery failure</Button>}
        </div>}
        {(request.status === "Received" || (request.status === "Accepted" && replaceable)) && <div className="document-review">
          {request.status === "Received" && <Button size="sm" variant={compact && openCondition ? "default" : "outline"} disabled={busy} onClick={() => void save({
            type: "reviewDocument", loanId, requestId: request.id, revision: request.revision, decision: "Accepted", replacementNote: "",
            sendToMockUwm: compact && openCondition,
          })}>{compact && openCondition ? "Accept & send to UWM (mock)" : request.pdfUploadedAt ? `Accept ${pdfLabel}` : "Accept sample"}</Button>}
          {request.status === "Received" && compact && openCondition && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({
            type: "reviewDocument", loanId, requestId: request.id, revision: request.revision, decision: "Accepted", replacementNote: "",
          })}>Accept only</Button>}
          <details className="document-form">
            <summary>Request replacement</summary>
            <form onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void save({ type: "reviewDocument", loanId, requestId: request.id, revision: request.revision,
                decision: "Needs replacement", replacementNote: data.get("replacementNote"), dueOn: data.get("dueOn") || null });
            }}>
              <label>Message to borrower<textarea name="replacementNote" required rows={2} maxLength={500} /></label>
              <label>Replacement due date (optional)<input name="dueOn" type="date" /></label>
              <Button type="submit" size="sm" variant="outline" disabled={busy}>Add replacement request</Button>
            </form>
          </details>
        </div>}
      </div>;
}

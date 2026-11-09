"use client";

import { useRef } from "react";
import type { Condition, Submission } from "@/lib/model";
import { documentRecipient, type DocumentRecipient, type LoanDocumentRequest } from "@/lib/document-model";
import { dateTime } from "@/lib/utils";
import { conditionTarget } from "@/lib/uwm-alert-model";
import { DocumentRequestForm, LoanDocumentCard } from "./loan-documents";
import { Button } from "./ui/button";
import { ConditionResponse } from "./condition-response";

type Save = (input: unknown, after?: () => void) => Promise<void>;

function ConditionEditor({ submission, item, busy, save }: { submission: Submission; item?: Condition; busy: boolean; save: Save }) {
  const attempt = useRef<string | null>(null);
  return <details className="document-form"><summary>{item ? "Edit condition and owner" : "Add lender condition"}</summary>
    <form key={item?.manual?.revision} onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      void save({ type: "saveManualCondition", loanId: submission.loanId, submissionId: submission.id,
        conditionId: item?.id ?? (attempt.current ??= crypto.randomUUID()), revision: item?.manual?.revision ?? 0,
        category: fields.get("category"), description: fields.get("description"), owner: fields.get("owner"),
      }, () => { attempt.current = null; if (!item) form.reset(); form.closest("details")?.removeAttribute("open"); });
    }}>
      <label>Category<input name="category" required maxLength={160} defaultValue={item?.category} /></label>
      <label>Next owner<input name="owner" required maxLength={160} defaultValue={item?.manual?.owner} placeholder="Loan officer, processor, or lender" /></label>
      <label>Lender request<textarea name="description" required maxLength={500} rows={2} defaultValue={item?.description} /></label>
      <Button size="sm" type="submit" disabled={busy}>Save lender condition</Button>
    </form>
  </details>;
}

export function ManualConditions({ submission, requests, checklistLinks, joint, brokerageId, pilot, busy, save }: {
  submission: Submission; requests: LoanDocumentRequest[]; checklistLinks: Partial<Record<DocumentRecipient, string>>;
  joint: boolean; brokerageId: string; pilot?: boolean; busy: boolean; save: Save;
}) {
  return <div className="document-section">
    <ConditionEditor submission={submission} busy={busy} save={save} />
    {submission.conditions.map((item) => {
      const manual = item.manual;
      if (!manual) return null;
      const request = requests.find((entry) => entry.submissionId === submission.id && entry.conditionId === item.id);
      const borrowerUrl = request && checklistLinks[documentRecipient(request)];
      const ids = { loanId: submission.loanId, submissionId: submission.id, conditionId: item.id, revision: manual.revision };
      return <section className="document-item" key={item.id} id={conditionTarget(submission.id, item.id)} tabIndex={-1}>
        <div className="document-item-head"><strong>{item.category}</strong><span className="pill">{item.satisfiedAt ? "Cleared" : "Outstanding"}</span></div>
        <p>{item.description}</p><small>Next owner · {manual.owner}</small>
        {request ? <>
          {!item.satisfiedAt && (request.status === "Requested" || request.status === "Needs replacement") && <div className="loan-application-actions">
            {borrowerUrl && <Button size="sm" variant="outline" asChild><a href={borrowerUrl} target="_blank" rel="noopener noreferrer">Open {joint ? documentRecipient(request).toLowerCase() : "borrower"} checklist</a></Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: "refreshApplication", loanId: submission.loanId })}>Refresh condition</Button>
          </div>}
          <LoanDocumentCard key={request.revision} request={request} brokerageId={brokerageId} pilot={pilot}
            openCondition={false} replaceable={!item.satisfiedAt} busy={busy} save={save} compact showRecipient={joint} />
        </> :
          !item.satisfiedAt && <DocumentRequestForm loanId={submission.loanId} source={{ submissionId: submission.id, condition: item }} busy={busy} save={save} quick joint={joint} />}
        {manual.deliveries.length > 0 && <ul>{manual.deliveries.map((delivery) => <li key={delivery.at + delivery.reference}>
          Delivered revision {delivery.documentRevision} · {delivery.reference} · {dateTime(delivery.at)} ET
        </li>)}</ul>}
        {item.satisfiedAt && <p>Lender confirmation · {manual.confirmedDelivery} · {dateTime(item.satisfiedAt)} ET</p>}
        {!item.satisfiedAt && <ConditionResponse condition={item} request={request} lender={submission.lender} />}
        <ConditionEditor submission={submission} item={item} busy={busy} save={save} />
        {!item.satisfiedAt && request?.status === "Accepted" && <details className="document-form"><summary>Record manual delivery</summary>
          <form onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void save({ type: "recordManualDelivery", ...ids, documentRevision: request.revision,
              reference: new FormData(form).get("reference") }, () => form.reset());
          }}>
            <label>Delivery reference<input name="reference" required maxLength={160} /></label>
            <Button size="sm" type="submit" disabled={busy}>Record delivery</Button>
          </form>
        </details>}
        <details className="document-form"><summary>{item.satisfiedAt ? "Reopen condition" : "Record lender clearance"}</summary>
          <form onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void save({ type: "recordManualClearance", ...ids, cleared: !item.satisfiedAt,
              confirmation: new FormData(form).get("confirmation") }, () => { form.reset(); form.closest("details")?.removeAttribute("open"); });
          }}>
            <label>{item.satisfiedAt ? "Reopen reason" : "Lender confirmation reference"}<input name="confirmation" required maxLength={160} /></label>
            <Button size="sm" type="submit" disabled={busy}>{item.satisfiedAt ? "Reopen" : "Record clearance"}</Button>
          </form>
        </details>
      </section>;
    })}
  </div>;
}

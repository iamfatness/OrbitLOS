"use client";

import { useRef, useState } from "react";
import { FileCheck2, RefreshCw } from "lucide-react";
import { dateLabel } from "@/lib/client-retention";
import { batchDocumentCondition, batchReviewsDocuments, documentBatchActions, documentBatchEligible, documentBatchLabels,
  documentWorkBatchLimit, type DocumentBatchAction } from "@/lib/document-batch-model";
import { documentRecipient, type LoanDocumentRequest } from "@/lib/document-model";
import type { Submission } from "@/lib/model";
import { conditionTarget } from "@/lib/uwm-alert-model";
import { SampleDocument } from "./sample-document";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: () => void) => Promise<void>;

export function DocumentBatch({ loanId, requests, submissions, brokerageId, busy, save, open }: {
  loanId: string; requests: LoanDocumentRequest[]; submissions: Submission[]; brokerageId: string; busy: boolean; save: Save;
  open: (target: string) => void;
}) {
  const [action, setAction] = useState<DocumentBatchAction>();
  const rows = requests.map((request) => ({ request, ...batchDocumentCondition(request, submissions) }));
  const choices = documentBatchActions.map((key) => ({ key, items: rows.filter(({ request, openMock }) => documentBatchEligible(key, request, openMock)) }));
  const choice = choices.find(({ key }) => key === action) ?? choices.find(({ items }) => items.length);
  if (!choice) return null;
  return <details className="document-form" aria-label="Document batch actions">
    <summary><FileCheck2 size={16} /> Work documents in bulk</summary>
    <div className="record-form">
      <p className="muted">Review evidence and select the exact documents to update. Mock delivery and clearance are separate actions.</p>
      <div className="loan-application-actions" role="group" aria-label="Choose a document batch action">
        {choices.map(({ key, items }) => <Button key={key} type="button" size="sm" variant={key === choice.key ? "default" : "outline"}
          disabled={busy} aria-pressed={key === choice.key} onClick={() => setAction(key)}>{documentBatchLabels[key]} ({items.length})</Button>)}
      </div>
      <DocumentBatchSelection key={`${loanId}:${choice.key}`} loanId={loanId} brokerageId={brokerageId} action={choice.key}
        rows={choice.items} busy={busy} save={save} open={open} />
    </div>
  </details>;
}

function selectionKey(request: LoanDocumentRequest) {
  return `${request.id}:${request.revision}:${request.uwmReceipt ?? ""}`;
}

function DocumentBatchSelection({ loanId, brokerageId, action, rows, busy, save, open }: {
  loanId: string; brokerageId: string; action: DocumentBatchAction;
  rows: ({ request: LoanDocumentRequest } & ReturnType<typeof batchDocumentCondition>)[];
  busy: boolean; save: Save; open: (target: string) => void;
}) {
  const [selection, setSelection] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [page, setPage] = useState(0);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const selected = rows.filter(({ request }) => selection.includes(selectionKey(request)));
  const staleSelection = selection.length !== selected.length;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / documentWorkBatchLimit) - 1));
  const visible = rows.slice(currentPage * documentWorkBatchLimit, (currentPage + 1) * documentWorkBatchLimit);
  const visibleKeys = [...new Set([...selection, ...visible.map(({ request }) => selectionKey(request))])];
  const review = batchReviewsDocuments(action);
  function reset() { setSelection([]); setReviewed(false); attempt.current = null; }
  function update(next: string[]) { setSelection(next); setReviewed(false); }

  return <div className="record-form">
    {!rows.length && <p className="empty-inline">No documents are ready for this action.</p>}
    <div className="loan-application-actions">
      <span className="pill">{selected.length} selected · Up to {documentWorkBatchLimit}</span>
      {visibleKeys.length > selection.length && visibleKeys.length <= documentWorkBatchLimit && <Button type="button" size="sm" variant="outline"
        disabled={busy || staleSelection} onClick={() => update(visibleKeys)}>Select visible documents</Button>}
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save({ type: "refreshApplication", loanId })}>
        <RefreshCw /> Refresh document batch</Button>
      {!!selection.length && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={reset}>Clear selection</Button>}
    </div>
    {staleSelection && <p role="status">A selected document changed. Clear the selection and review the current rows.</p>}
    {!!visible.length && <ul className="document-list">{visible.map(({ request, submission, condition }) => {
      const key = selectionKey(request);
      const checked = selection.includes(key);
      const recipient = documentRecipient(request);
      const item = `${request.kind} for ${recipient.toLowerCase()}${condition ? ` · ${condition.category}` : ""}`;
      const target = submission && condition ? conditionTarget(submission.id, condition.id) : `document-${request.id}`;
      return <li key={request.id} className="document-item">
        <label className="demo-confirm"><input type="checkbox" checked={checked} disabled={busy || (!checked && selection.length >= documentWorkBatchLimit)}
          aria-label={`Select ${item}`} onChange={(event) => update(event.target.checked ? [...selection, key] : selection.filter((value) => value !== key))} />
          <strong>{request.kind}</strong> · {recipient}</label>
        <p className="muted">{condition ? `${submission?.lender} · ${condition.category}` : "Standalone document"}
          {request.dueOn && ` · Due ${dateLabel(request.dueOn)}`}{request.uwmDeliveryFailedAt && !request.uwmReceipt && " · Mock retry available"}</p>
        <div className="loan-application-actions">
          <Button type="button" size="sm" variant="outline" onClick={() => open(target)}>Open {condition ? "condition" : "document"}</Button>
          {request.pdfUploadedAt && <Button size="sm" variant="ghost" asChild><a href={`/api/documents/download?brokerage=${brokerageId}&request=${request.id}`}>Download PDF</a></Button>}
        </div>
        {review && !request.pdfUploadedAt && request.submittedAt && <SampleDocument kind={request.kind} />}
      </li>;
    })}</ul>}
    {rows.length > documentWorkBatchLimit && <div className="loan-application-actions">
      <Button type="button" size="sm" variant="outline" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous documents</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || (currentPage + 1) * documentWorkBatchLimit >= rows.length}
        onClick={() => setPage(currentPage + 1)}>Next documents</Button>
    </div>}
    {review && !!selected.length && <label className="demo-confirm"><input type="checkbox" checked={reviewed} disabled={busy}
      onChange={(event) => setReviewed(event.target.checked)} /> I reviewed every selected document.</label>}
    {!!selected.length && <div><Button type="button" size="sm" disabled={busy || staleSelection || (review && !reviewed)} onClick={() => {
      const input = { type: "processDocumentBatch", loanId, action, reviewed, items: selected.map(({ request }) => ({
        requestId: request.id, revision: request.revision, ...(action === "clear" ? { receipt: request.uwmReceipt } : {}),
      })) };
      const key = JSON.stringify(input);
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      void save({ ...input, batchId: attempt.current.id }, reset);
    }}>{documentBatchLabels[action]} · {selected.length} selected</Button></div>}
  </div>;
}

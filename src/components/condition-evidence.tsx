"use client";

import { useRef, useState } from "react";
import { canReuseConditionEvidence, conditionEvidenceKey } from "@/lib/condition-evidence-model";
import { documentRecipient, suggestedConditionDocument, type LoanDocumentRequest } from "@/lib/document-model";
import type { Condition, Submission } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { SampleDocument } from "./sample-document";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: () => void) => Promise<void>;

export function ConditionEvidencePicker({ submission, condition, requests, target, brokerageId, busy, save }: {
  submission: Submission; condition: Condition; requests: LoanDocumentRequest[]; target?: LoanDocumentRequest;
  brokerageId: string; busy: boolean; save: Save;
}) {
  const [choice, setChoice] = useState("");
  const attempt = useRef<{ key: string; id: string } | null>(null);
  if (condition.satisfiedAt || (target && (target.status !== "Requested" || target.submittedAt || target.pdfUploadedAt || target.pdfStatus === "Processing"))) return null;
  const suggested = suggestedConditionDocument(condition)?.kind;
  const available = requests.filter((request) => request.loanId === submission.loanId && canReuseConditionEvidence(request) &&
    (!target || (request.kind === target.kind && documentRecipient(request) === documentRecipient(target))))
    .sort((a, b) => Number(b.kind === suggested) - Number(a.kind === suggested) || (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  if (!available.length) return null;
  const selected = available.find((item) => `${item.id}:${item.revision}` === choice);
  return <details className="document-form">
    <summary>Use accepted evidence</summary>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!selected || !new FormData(event.currentTarget).has("confirmed")) return;
      const input = { type: "reuseConditionEvidence", loanId: submission.loanId, submissionId: submission.id, conditionId: condition.id,
        conditionKey: conditionEvidenceKey(condition), target: target ? { id: target.id, revision: target.revision } : null,
        source: { id: selected.id, revision: selected.revision }, confirmed: true };
      const key = JSON.stringify(input);
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      void save({ ...input, linkId: attempt.current.id }, () => { attempt.current = null; setChoice(""); });
    }}>
      <label className="field">Accepted document<select value={selected ? choice : ""} required disabled={busy} onChange={(event) => setChoice(event.target.value)}>
        <option value="">Choose evidence on this loan</option>
        {available.map((item) => <option key={item.id} value={`${item.id}:${item.revision}`}>
          {item.kind} · {documentRecipient(item)} · Revision {item.revision} · {item.submittedAt && dateTime(item.submittedAt)} ET
        </option>)}
      </select></label>
      {selected && <div className="record-form" key={`${selected.id}:${selected.revision}`}>
        <p className="muted">The condition will keep this revision and its borrower. Delivery is a separate step.</p>
        {selected.pdfUploadedAt ? <div><Button size="sm" variant="outline" asChild>
          <a href={`/api/documents/download?brokerage=${brokerageId}&request=${selected.id}`}>Download accepted PDF</a>
        </Button></div> : <SampleDocument kind={selected.kind} />}
        <label className="disclosure-document-choice"><input type="checkbox" name="confirmed" required disabled={busy} />
          I checked that this accepted evidence answers the condition.</label>
      </div>}
      <Button size="sm" type="submit" disabled={busy || !selected}>Link accepted evidence</Button>
    </form>
  </details>;
}

export function ConditionEvidenceHistory({ request, brokerageId }: { request: LoanDocumentRequest; brokerageId: string }) {
  const links = request.evidenceLinks;
  if (!links?.length) return null;
  const current = links.some((item) => item.revision === request.revision);
  return <details className="document-form" open={current || undefined}>
    <summary>{current ? "Linked accepted evidence" : "Previously linked evidence"}</summary>
    <ul className="document-list">{[...links].sort((a, b) => b.revision - a.revision).map((item) => <li key={item.id}>
      <p><strong>{item.kind} · Source revision {item.sourceRevision}</strong> · Condition document revision {item.revision}</p>
      <p className="muted">{item.reviewedBy && item.reviewedAt ? `Accepted by ${item.reviewedBy} · ${dateTime(item.reviewedAt)} ET` : "Previously accepted"}</p>
      <p className="muted">Linked by {item.linkedBy} · {dateTime(item.linkedAt)} ET</p>
      {item.pdf ? <Button size="sm" variant="outline" asChild>
        <a href={`/api/documents/download?brokerage=${brokerageId}&request=${request.id}&evidence=${item.id}`}>Download linked revision</a>
      </Button> : <SampleDocument kind={item.kind} />}
    </li>)}</ul>
  </details>;
}

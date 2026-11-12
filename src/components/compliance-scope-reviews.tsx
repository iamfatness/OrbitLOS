"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import type { ProgramReviewTarget } from "@/lib/compliance-program-model";
import { Button } from "./ui/button";

type ReviewPage = Extract<ComplianceCaseResult, { kind: "scopeReviews" }>;
const reviewerKey = (reviewer: ReviewPage["reviewers"][number]) => `${reviewer.email}:${reviewer.revision}`;
export function ComplianceScopeReviews({ brokerageId, entityId, jurisdiction, scopeRevision, active, paused, openReview }: {
  brokerageId: string; entityId: string; jurisdiction: string; scopeRevision: number; active: boolean; paused: boolean;
  openReview: (target: ProgramReviewTarget, origin: string) => void;
}) {
  const [data, setData] = useState<ReviewPage>();
  const [offset, setOffset] = useState(0);
  const [version, refresh] = useState(0);
  const [readError, setReadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceKey, setSource] = useState("");
  const [reviewerSelection, setReviewer] = useState<string>();
  const [internalTarget, setTarget] = useState("");
  const [question, setQuestion] = useState("");
  const feedback = useRef<HTMLParagraphElement>(null);
  const editor = useRef<HTMLDetailsElement>(null);
  const retry = useRef<{ body: string; id: string }>(undefined);

  useEffect(() => {
    if (!active || paused) return;
    let current = true;
    void accessComplianceCases({ type: "scopeReview", input: { operation: "read", entityId, jurisdiction, scopeRevision, offset } }, brokerageId)
      .then(result => {
        if (!current) return;
        if ("error" in result || result.kind !== "scopeReviews") throw new Error("Could not load state review questions.");
        setData(result);
        setReadError("");
      }).catch(() => { if (current) setReadError("Could not load state review questions."); });
    return () => { current = false; };
  }, [active, paused, brokerageId, entityId, jurisdiction, scopeRevision, version, offset]);
  useEffect(() => { if (saveError || notice) feedback.current?.focus(); }, [saveError, notice]);

  const source = data?.sources.find(item => item.key === sourceKey);
  const selectedReviewer = reviewerSelection === undefined ? data?.reviewers.find(item => item.isCurrentUser) :
    data?.reviewers.find(item => reviewerKey(item) === reviewerSelection);

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reviewer = selectedReviewer;
    if (!reviewer || busy || paused || !data?.canAssign) return;
    const input = { operation: "assign", entityId, jurisdiction, scopeRevision, sourceKey: sourceKey || undefined, reviewerEmail: reviewer.email,
      reviewerRevision: reviewer.revision, internalTarget, question: question.trim() };
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setBusy(true);
    setSaveError("");
    setNotice("");
    try {
      const result = await accessComplianceCases({ type: "scopeReview", input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) setSaveError(result.error);
      else if (result.kind === "scopeReviewAssigned") {
        retry.current = undefined;
        setQuestion("");
        setSource("");
        setReviewer(undefined);
        setTarget("");
        if (editor.current) editor.current.open = false;
        setNotice(reviewer.isCurrentUser ? "Question saved. You own the follow-up." : `Question saved. ${reviewer.name} owns the follow-up.`);
        setOffset(0);
        refresh(value => value + 1);
      } else setSaveError("Save could not be confirmed. Retry the same question.");
    } catch { setSaveError("Save could not be confirmed. Retry the same question."); }
    finally { setBusy(false); }
  }
  return <section className="record-form" aria-label="State review questions">
    <h3>State review questions</h3>
    {(!data || readError) && <p role={readError ? "alert" : "status"}>{readError ||
      (paused ? "Review questions are unavailable while this workspace is paused." : "Loading review questions…")}</p>}
    {readError && <div><Button type="button" size="sm" variant="outline" className="min-h-11" disabled={paused}
      onClick={() => { setReadError(""); refresh(value => value + 1); }}>Retry review questions</Button></div>}
    {(saveError || notice) && <p ref={feedback} tabIndex={-1} role={saveError ? "alert" : "status"}>{saveError || notice}</p>}
    {data && <>
      {data.items.length > 0 && <ul className="document-list">{data.items.map(item => <li className="document-item" key={item.target.itemId}>
        <div className="min-w-0 break-words">
          <strong>{item.question}</strong>
          <p>{item.status} · {item.reviewer ?? "Follow-up owner needs reassignment"} · Internal follow-up {item.internalTarget}</p>
          {item.latestNote && <p><strong>Decision or next action</strong> · {item.latestNote}</p>}
          {item.evidence && <p><strong>Evidence reference</strong> · {item.evidence}</p>}
        </div>
        <Button type="button" size="sm" variant="outline" className="min-h-11" id={`state-review-${item.target.itemId}`}
          aria-label={`Open review: ${item.question}`} onClick={() => openReview(item.target, `state-review-${item.target.itemId}`)}>Open review</Button>
      </li>)}</ul>}
      {(offset > 0 || data.next !== null) && <div className="loan-application-actions">
        {offset > 0 && <Button type="button" size="sm" variant="outline" onClick={() => setOffset(Math.max(0, offset - 10))}>Previous questions</Button>}
        {data.next !== null && <Button type="button" size="sm" variant="outline" onClick={() => setOffset(data.next ?? 0)}>More questions</Button>}
      </div>}
      {data.canAssign ? <details ref={editor} className="details-section">
        <summary className="min-h-11 content-center">Add a question for review</summary>
        <form className="record-form" onSubmit={assign}>
          <fieldset className="record-form" disabled={paused || busy}>
            <label className="field">Question<textarea rows={3} required minLength={5} maxLength={1000} value={question}
              onChange={event => setQuestion(event.target.value)} /></label>
            <div className="form-grid items-start">
              <div className="min-w-0">
                <label className="field">Who will follow up?<select required value={selectedReviewer ? reviewerKey(selectedReviewer) : ""} onChange={event => setReviewer(event.target.value)}>
                  <option value="">Choose a brokerage admin</option>{data.reviewers.map(item =>
                    <option key={reviewerKey(item)} value={reviewerKey(item)}>{item.isCurrentUser ? "Me" : `${item.name} · ${item.email}`}</option>)}
                </select></label>
                {selectedReviewer && !selectedReviewer.isCurrentUser && <p className="muted break-words">{selectedReviewer.name} · {selectedReviewer.email}</p>}
              </div>
              <label className="field">Internal follow-up date<input type="date" required min="2000-01-01" max="2099-12-31"
                value={internalTarget} onChange={event => setTarget(event.target.value)} /></label>
            </div>
            <p className="muted">The question appears in Monthly review with the saved company and state details. Record the answer there, including advice received outside Orbit.</p>
            {data.sources.length > 0 && <details className="details-section">
              <summary className="min-h-11 content-center">Add a source (optional)</summary>
              <label className="field">Supporting source<select value={sourceKey} onChange={event => setSource(event.target.value)}>
                <option value="">No source selected</option>{data.sources.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}
              </select></label>
              {source && <p><a className="name-link break-words" href={source.sourceUrl} target="_blank" rel="noreferrer">{source.title}</a></p>}
            </details>}
            <div><Button type="submit" size="sm" className="min-h-11">{busy ? "Saving…" : "Save question"}</Button></div>
          </fieldset>
        </form>
      </details> : <p className="muted">To add a question, save a current version of these state details.</p>}
    </>}
  </section>;
}

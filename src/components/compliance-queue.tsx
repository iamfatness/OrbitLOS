"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import { complianceAttentionLabels, complianceCaseKinds, complianceCaseStatuses, complianceCaseTarget, complianceTarget,
  sampleReviewDecisions, type ComplianceAttention } from "@/lib/compliance-case-model";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import type { SampleReceiptEvaluation } from "@/lib/sample-receipt-check";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Queue = Extract<ComplianceCaseResult, { kind: "list" }>;
type Query = { type: "list"; loanId?: string; kind?: Queue["items"][number]["kind"]; status?: Queue["items"][number]["status"];
  attention?: ComplianceAttention; after?: NonNullable<Queue["next"]> };

function ReceiptEvidence({ evidence }: { evidence: SampleReceiptEvaluation["basis"] }) {
  return <details className="document-form compliance-inventory">
    <summary>Evidence used</summary>
    <ul className="loan-task-list">
      <li className="loan-task compliance-row"><div className="loan-task-copy">
        <strong>Disclosure workbench review</strong>
        <span>{evidence.workbenchReview ?
          `${evidence.workbenchReview.reviewer} · ${dateTime(evidence.workbenchReview.reviewedAt)} ET` : "Missing for this package revision"}</span>
      </div></li>
      <li className="loan-task compliance-row"><div className="loan-task-copy">
        <strong>Review recorded on this finding</strong>
        {evidence.caseEvidence ? <>
          <span>{evidence.caseEvidence.recordedBy} · {dateTime(evidence.caseEvidence.recordedAt)} ET · Case revision {evidence.caseEvidence.revision}</span>
          <span>Source review by {evidence.caseEvidence.reviewer} · {dateTime(evidence.caseEvidence.reviewedAt)} ET</span>
        </> : <span>Missing for this package revision</span>}
      </div></li>
    </ul>
  </details>;
}

export function ComplianceQueue({ brokerageId, admin, loanId, initialCaseId, initialAttention, paused, openLoan, openDisclosures, returnToEvidence }: {
  brokerageId: string; admin: boolean; loanId?: string; initialCaseId?: string;
  initialAttention?: ComplianceAttention; paused?: boolean;
  openLoan?: (loanId: string, caseId?: string) => void; openDisclosures?: (caseId?: string) => void;
  returnToEvidence?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState<Query>({ type: "list", loanId, attention: initialAttention });
  const [caseId, setCaseId] = useState(initialCaseId);
  const [version, refresh] = useState(0);
  const [response, setResponse] = useState<{ query: Query; caseId?: string; version: number; data: ComplianceCaseResult }>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const attempt = useRef<{ key: string; requestId: string }>(null);
  const focus = useRef<string>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const evidenceAction = useRef<HTMLButtonElement>(null);
  const returning = useRef(returnToEvidence);
  useEffect(() => {
    if (paused) return;
    let current = true;
    const update = (data: ComplianceCaseResult) => { if (current) setResponse({ query, caseId, version, data }); };
    void accessComplianceCases(caseId ? { type: "read", caseId, loanId } : query, brokerageId).then(update, () => update({ error: "Could not load compliance work. Try again." }));
    return () => { current = false; };
  }, [brokerageId, query, caseId, loanId, paused, version]);
  const data = response?.query === query && response.caseId === caseId && response.version === version ? response.data : undefined;
  const list = data && "kind" in data && data.kind === "list" ? data : undefined;
  const detail = data && "kind" in data && data.kind === "detail" ? data : undefined;
  const loaded = Boolean(data);
  useEffect(() => {
    if (loaded && returning.current) {
      (evidenceAction.current ?? heading.current)?.focus();
      returning.current = false;
    }
    if (!loaded || focus.current === undefined) return;
    const target = focus.current ? document.getElementById(`${id}-${focus.current}`) : null;
    (target ?? heading.current)?.focus();
    if (caseId) heading.current?.scrollIntoView({ block: "start" });
    focus.current = undefined;
  }, [caseId, id, loaded]);

  function open(next?: string) {
    focus.current = next ? "" : caseId ?? "";
    setMessage(undefined);
    setCaseId(next);
  }

  async function save(input: Record<string, unknown>, success: string) {
    if (pending) return;
    setPending(true);
    setMessage(undefined);
    try {
      const command = detail ? { caseId: detail.item.id, expectedRevision: detail.item.revision, ...input } : input;
      const key = JSON.stringify(command);
      if (attempt.current?.key !== key) attempt.current = { key, requestId: crypto.randomUUID() };
      const result = await accessComplianceCases(detail ? { ...command, requestId: attempt.current.requestId } : command, brokerageId);
      if ("error" in result) { setMessage({ text: result.error, error: true }); return; }
      if (result.kind !== "detail") return;
      attempt.current = null;
      if (result.item.id === caseId) setResponse({ query, caseId, version, data: result });
      else open(result.item.id);
      setMessage({ text: success });
    } catch { setMessage({ text: "Could not save compliance work. Try again.", error: true }); }
    finally { setPending(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>, type: "updateStatus" | "assign", field: "status" | "ownerEmail", success: string) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get(field);
    if (value) void save({ type, [field]: value }, success);
  }

  const title = detail?.item.title ?? (loanId ? "File compliance" : "Compliance work queue");
  const currentLoanId = detail?.item.loanId;
  const receiptCheck = detail?.sampleReceiptCheck;
  const savedCheck = receiptCheck?.latest;
  const readyCheck = receiptCheck?.ready;
  const evidenceForReview = detail?.reviewSubmission && detail.history.find((entry) =>
    entry.evidenceNote?.packageRevision === detail.reviewSubmission?.packageRevision && entry.evidenceNote);
  const Heading = loanId || detail ? "h3" : "h2";
  return <section id={loanId ? initialCaseId ? complianceCaseTarget(initialCaseId) : complianceTarget : undefined} tabIndex={loanId ? -1 : undefined}
    className={`${loanId ? "details-section" : "integration manager-panel"} compliance-work record-form`} aria-labelledby={`${id}-heading`}>
    <div className="section-heading"><Heading id={`${id}-heading`} ref={heading} tabIndex={-1}>{title}</Heading>
      {caseId ? <Button size="sm" variant="outline" disabled={pending} onClick={() => open()}>Back to cases</Button> :
        <Button size="sm" variant="outline" disabled={pending} onClick={() => { setQuery({ ...query, after: undefined }); setMessage(undefined); }}>Refresh cases</Button>}</div>
    {loanId && <div className="document-item compliance-coverage"><strong>Coverage not evaluated</strong><p>Fictional cases and sample evidence only.</p></div>}
    {!data && <p role="status" className="muted">Loading compliance work…</p>}
    {data && "error" in data && <div className="loan-application-actions"><p role="alert">{data.error}</p>
      <Button size="sm" variant="outline" onClick={() => { setQuery({ ...query, after: undefined }); refresh((value) => value + 1); }}>Reload</Button></div>}
    {!loanId && !caseId && query.attention && <div className="loan-application-actions">
      <strong>{complianceAttentionLabels[query.attention]}</strong>
      <Button size="sm" variant="outline" onClick={() => setQuery({ type: "list" })}>Show all cases</Button>
    </div>}
    {!loanId && !caseId && !query.attention && <div className="calendar-filters">
        <label className="field">Case type<select value={query.kind ?? ""} onChange={(event) => setQuery({ ...query, kind: (event.target.value || undefined) as Query["kind"], after: undefined })}>
          <option value="">All case types</option>{complianceCaseKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label className="field">Workflow status<select value={query.status ?? ""} onChange={(event) => setQuery({ ...query, status: (event.target.value || undefined) as Query["status"], after: undefined })}>
          <option value="">All statuses</option>{complianceCaseStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
    </div>}
    {list && <>
      <p role="status" className="muted">{list.counts.cases} {list.counts.cases === 1 ? "case" : "cases"} · {list.counts.files} {list.counts.files === 1 ? "affected file" : "affected files"}</p>
      {list.items.length ? <ul className="loan-task-list">{list.items.map((item) => {
        const fileId = !loanId && openLoan ? item.loanId : null;
        const label = !loanId && item.borrower ? `${item.borrower} · ${item.title}` : item.title;
        return <li className="loan-task compliance-row" key={item.id}>
          <div className="loan-task-copy"><strong>{label}</strong><span>{item.kind} · {item.status}</span>
            <span>{item.ownerState === "Assigned" ? "Owner" : item.ownerState}{item.ownerName && ` · ${item.ownerName}`}</span></div>
          <Button id={`${id}-${item.id}`} size="sm" variant="outline" disabled={pending || paused} aria-label={`Open case ${label}`}
            onClick={() => fileId && openLoan ? openLoan(fileId, item.id) : open(item.id)}>{fileId ? "Open file finding" : "Open case"}</Button>
        </li>;
      })}</ul> : <p className="muted">{query.kind || query.status || query.attention ? "No cases match these filters." : loanId ? "No sample findings on this file." : "No sample cases yet. Open a fictional loan’s Compliance section to start."}</p>}
      {loanId && admin && <div className="loan-application-actions">
        {list.samplePackageVersion && !list.items.some((item) => item.packageVersion === list.samplePackageVersion) ?
          <Button size="sm" disabled={pending} onClick={() => void save({ type: "openFixture", loanId, packageVersion: list.samplePackageVersion }, "Sample cases opened.")}>Open sample finding</Button> :
          !list.samplePackageVersion && openDisclosures && <Button size="sm" variant="outline" onClick={() => openDisclosures()}>Open sample disclosures</Button>}
      </div>}
      {(query.after || list.next) && <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: undefined })}>First page</Button>}
        {list.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: list.next ?? undefined })}>Next page</Button>}
      </div>}
    </>}
    {detail && <>
      <p><strong>{detail.item.kind}</strong> · {detail.item.status}</p>
      <p className="muted">{detail.item.ownerState === "Assigned" ? "Owner" : detail.item.ownerState}{detail.item.ownerName && ` · ${detail.item.ownerName}`} · Deadline undetermined</p>
      {detail.item.loanId && <div className="document-item record-form"><strong>Sample package v{detail.item.packageVersion} · {detail.packageState}</strong>
        <p>{detail.sampleReview ? `Sample workbench review recorded for revision ${detail.sampleReview.packageRevision}.` :
          detail.packageState === "Superseded" ? "This finding belongs to an earlier package. Its evidence and decisions remain in Case history." :
            detail.packageState === "Unavailable" ? "No disclosure package is available for this finding." :
            detail.packageState !== "Current" ? "Review the latest package and its status in Disclosures." :
            detail.sampleReviewRevision ? "The current sample workbench review is available to record here." : "Current sample workbench review is missing."}</p>
        {detail.latestPackageVersion !== null && detail.latestPackageVersion !== detail.item.packageVersion &&
          <p className="muted">Latest sample package v{detail.latestPackageVersion}</p>}
        <div className="loan-application-actions">
          {openLoan && currentLoanId && <Button size="sm" onClick={() => openLoan(currentLoanId, detail.item.id)}>Open file finding</Button>}
          {openDisclosures && <Button ref={evidenceAction} size="sm" className="min-h-11"
            variant={detail.packageState === "Superseded" ? "default" : "outline"} disabled={pending}
            onClick={() => openDisclosures(detail.item.id)}>{detail.latestPackageVersion === null ?
              "Open sample disclosures" : "Open current evidence"}</Button>}
          {admin && detail.sampleReviewRevision && !detail.sampleReview && <Button size="sm" disabled={pending}
            onClick={() => void save({ type: "recordSampleReview", packageRevision: detail.sampleReviewRevision }, "Sample workbench review recorded.")}>Record sample review</Button>}
        </div>
      </div>}
      {receiptCheck && (readyCheck || savedCheck) && <section className="document-item record-form" aria-label="Sample receipt evidence check">
        <div className="section-heading">
          <strong>Sample receipt evidence check</strong>
          {readyCheck && <Button size="sm" variant="outline" disabled={pending}
            onClick={() => void save({ type: "evaluateSampleReceipt", ...readyCheck }, "Sample evidence check complete.")}>Run sample check</Button>}
        </div>
        {savedCheck ? <>
          <p><strong>{savedCheck.outcome}</strong>{!savedCheck.current && " · Inputs changed since this check"}</p>
          <p className="muted">Check v{savedCheck.version} · Sample package v{savedCheck.basis.packageVersion}, revision {savedCheck.basis.packageRevision}
            {" · "}{dateTime(savedCheck.at)} ET</p>
          <ReceiptEvidence evidence={savedCheck.basis} />
        </> : <p className="muted">Compare the sample disclosure review with the evidence recorded on this finding.</p>}
      </section>}
      {detail.reviewSubmission && <div className="document-item record-form">
        <strong>Submitted for review</strong>
        <p>{detail.reviewSubmission.note}</p>
        <p className="muted">{detail.reviewSubmission.actor} · {dateTime(detail.reviewSubmission.at)} ET
          {typeof detail.reviewSubmission.packageRevision === "number" && ` · Package revision ${detail.reviewSubmission.packageRevision}`}</p>
        {evidenceForReview?.evidenceNote && <div className="loan-task-copy">
          <strong>Latest sample evidence note</strong>
          <span>{evidenceForReview.evidenceNote.note}</span>
          <span>{evidenceForReview.evidenceNote.source} · {dateTime(evidenceForReview.at)} ET</span>
        </div>}
      </div>}
      {detail.canDecideReview && detail.reviewSubmission && <form className="document-item record-form"
        key={`decision-${detail.reviewSubmission.revision}`} onSubmit={(event) => {
          event.preventDefault();
          const submission = detail.reviewSubmission;
          if (!submission) return;
          const values = new FormData(event.currentTarget);
          const decision = values.get("decision");
          const reason = values.get("reason");
          if (decision && typeof reason === "string" && reason.trim()) void save({
            type: "decideReview", decision, reason, packageRevision: submission.packageRevision, submissionRevision: submission.revision,
          }, decision === "Return for evidence" ? "Finding returned for evidence." : "Sample review accepted.");
        }}>
        <label className="field">Sample review decision<select name="decision" required defaultValue="" disabled={pending}>
          <option value="">Choose a decision</option>{sampleReviewDecisions.map((decision) => <option key={decision}>{decision}</option>)}
        </select></label>
        <label className="field">Reason for decision<textarea name="reason" required maxLength={1000} rows={3} disabled={pending} /></label>
        <div><Button size="sm" type="submit" disabled={pending}>Record decision</Button></div>
      </form>}
      {detail.reviewDecision && <div className="document-item record-form">
        <strong>{detail.reviewSubmission ? "Previous decision · " : ""}{detail.reviewDecision.decision === "Return for evidence" ?
          "Returned for evidence" : "Sample review accepted"}</strong>
        <p>{detail.reviewDecision.reason}</p>
        <p className="muted">{detail.reviewDecision.actor} · {dateTime(detail.reviewDecision.at)} ET · Package revision {detail.reviewDecision.packageRevision}</p>
      </div>}
      {typeof detail.submitPackageRevision === "number" && <form className="document-item record-form" key={`submit-${detail.item.id}`} onSubmit={(event) => {
        event.preventDefault();
        const note = new FormData(event.currentTarget).get("note");
        if (typeof note === "string" && note.trim()) void save({
          type: "submitForReview", note, packageRevision: detail.submitPackageRevision,
        }, "Fictional finding submitted for review.");
      }}>
        <label className="field">What should the reviewer check?
          <textarea name="note" required maxLength={1000} rows={3} disabled={pending} />
        </label>
        <div><Button size="sm" variant="outline" type="submit" disabled={pending}>Submit for review</Button></div>
      </form>}
      {typeof detail.evidencePackageRevision === "number" && <details className="document-form compliance-inventory">
        <summary>Add sample evidence note</summary>
        <form className="document-item record-form" key={`evidence-${detail.item.id}-${detail.item.revision}`} onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const source = values.get("source");
          const note = values.get("note");
          if (typeof source === "string" && source.trim() && typeof note === "string" && note.trim()) void save({
            type: "recordEvidenceNote", source, note, packageRevision: detail.evidencePackageRevision,
          }, "Sample evidence note saved in case history.");
        }}>
          <p className="muted">Records a staff observation in case history for the current sample package.</p>
          <label className="field">Sample source<input name="source" required maxLength={120} disabled={pending} /></label>
          <label className="field">What did you observe?<textarea name="note" required maxLength={1000} rows={3} disabled={pending} /></label>
          <div><Button size="sm" variant="outline" type="submit" disabled={pending}>Save evidence note</Button></div>
        </form>
      </details>}
      {detail.canUpdateStatus && <form className="calendar-filters" key={`status-${detail.item.id}`}
        onSubmit={(event) => submit(event, "updateStatus", "status", "Workflow status saved.")}>
        <label className="field">Workflow status<select name="status" key={detail.item.status} defaultValue={detail.item.status} disabled={pending}>{complianceCaseStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <Button size="sm" variant="outline" type="submit" disabled={pending}>Save status</Button>
      </form>}
      {detail.assignableOwners.length > 0 && <form className="calendar-filters" key={`owner-${detail.item.id}`}
        onSubmit={(event) => submit(event, "assign", "ownerEmail", "Case owner saved.")}>
        <label className="field">Case owner<select name="ownerEmail" required disabled={pending} defaultValue={detail.item.ownerState === "Assigned" ? detail.item.ownerEmail ?? "" : ""}>
          <option value="">Choose active staff</option>{detail.assignableOwners.map(({ email, name }) => <option value={email} key={email}>{name || email}</option>)}</select></label>
        <Button size="sm" variant="outline" type="submit" disabled={pending}>Save owner</Button>
      </form>}
      {!loanId && detail.item.parentCaseId && <Button size="sm" variant="outline" disabled={pending} onClick={() => open(detail.item.parentCaseId ?? undefined)}>Open related case</Button>}
      <details className="document-form"><summary>Case history</summary><ul className="loan-task-list">{detail.history.map((event) => <li key={event.revision} className="loan-task compliance-row">
        <div className="loan-task-copy"><strong>{({ recordSampleReview: "Recorded sample workbench review", recordEvidenceNote: "Recorded sample evidence note",
          submitForReview: "Submitted for review", decideReview: "Recorded sample review decision", evaluateSampleReceipt: "Ran sample receipt evidence check",
          assign: "Changed case owner", updateStatus: "Changed workflow status" })[event.action] ?? event.action}</strong>
          <span>{event.actor} · {dateTime(event.at)} ET · Revision {event.revision}</span>
          {event.reviewNote && <><span>Package revision {event.reviewPackageRevision}</span><span>{event.reviewNote}</span></>}
          {event.evidenceNote && <><span>{event.evidenceNote.source} · Package revision {event.evidenceNote.packageRevision}</span>
            <span>{event.evidenceNote.note}</span></>}
          {event.reviewDecision && <><span>{event.reviewDecision.decision} · Package revision {event.reviewDecision.packageRevision} · Request revision {event.reviewDecision.submissionRevision}</span>
            <span>{event.reviewDecision.reason}</span></>}
          {event.sampleEvaluation && <>
            <span>{event.sampleEvaluation.outcome} · Check v{event.sampleEvaluation.version} · Sample package v{event.sampleEvaluation.basis.packageVersion}, revision {event.sampleEvaluation.basis.packageRevision}</span>
            <ReceiptEvidence evidence={event.sampleEvaluation.basis} />
          </>}
        </div></li>)}</ul>{detail.moreHistory && <p className="muted">Showing the most recent 50 changes.</p>}</details>
    </>}
    {message && <p role={message.error ? "alert" : "status"}>{message.text}</p>}
    {message?.error && detail && <Button size="sm" variant="outline" disabled={pending} onClick={() => { setMessage(undefined); refresh((value) => value + 1); }}>Reload case</Button>}
  </section>;
}

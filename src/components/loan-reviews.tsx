"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { workOnLoanReview } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { closingPackageReviewCategory, disclosureTarget, requestClosingPackageReviewTarget } from "@/lib/disclosure-model";
import { loanReviewsTarget, reviewCategories, reviewFilters, reviewTarget, reviewViews, type ReviewMutation, type ReviewQueueQuery,
  type ReviewResult, type ReviewSummary } from "@/lib/loan-review-model";
import { dateTime } from "@/lib/utils";
import { closingDisclosureReviewTarget, filePreflightCategory, filePreflightTarget, preflightBlocked } from "@/lib/file-preflight-model";
import { SavedDisclosureTermChanges } from "./disclosure-term-changes";
import { PreflightChecks } from "./file-preflight";
import { Button } from "./ui/button";

type LoanPage = Extract<ReviewResult, { kind: "loan" }>;
type DetailPage = Extract<ReviewResult, { kind: "detail" }>;
type QueuePage = Extract<ReviewResult, { kind: "queue" }>;
type Save = (input: ReviewMutation, after?: () => void) => Promise<void>;

function ReviewList({ rows, busy, open, queue }: { rows: ReviewSummary[]; busy: boolean; open: (row: ReviewSummary) => void; queue?: boolean }) {
  return <ul className="loan-task-list">{rows.map((row) => <li className="loan-task" key={row.id}>
    <div className="loan-task-copy"><strong>{row.title}</strong><span>{row.borrower} · {row.category}</span>
      <span>{row.reviewerName} reviewing for {row.requesterName} · Due {dateLabel(row.dueOn)}</span>
      <div className="loan-application-actions"><span className="pill">{row.status}</span>{row.overdue && <span className="pill">Overdue</span>}
        {row.escalatedAt && <span className="pill">Escalated</span>}</div>
    </div>
    <Button size="sm" variant="outline" disabled={busy} data-review-queue-action={queue ? row.id : undefined}
      aria-label={`Open review ${row.title}`} onClick={() => open(row)}>Open review</Button>
  </li>)}</ul>;
}

export function LoanReviewQueue({ brokerageId, team, version, busy, open, returningReview, onReviewReturn }: {
  brokerageId: string; team: boolean; version: number; busy: boolean; open: (row: ReviewSummary) => void;
  returningReview?: string; onReviewReturn: () => void;
}) {
  const queue = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState<ReviewQueueQuery>({ type: "queue", view: "Assigned to me", filter: "Open" });
  const [result, setResult] = useState<{ query: ReviewQueueQuery; version: number; data: QueuePage | { error: string } }>();
  useEffect(() => {
    let active = true;
    const error = { error: "Could not load internal reviews. Try refreshing." };
    void workOnLoanReview(query, brokerageId).then((response) => {
      if (active) setResult({ query, version, data: "error" in response || response.kind === "queue" ? response : error });
    }, () => { if (active) setResult({ query, version, data: error }); });
    return () => { active = false; };
  }, [brokerageId, query, version]);
  const data = result?.query === query && result.version === version ? result.data : undefined;
  const page = data && !("error" in data) ? data : undefined;
  useEffect(() => {
    if (!returningReview || !data || busy) return;
    const action = queue.current?.querySelector<HTMLElement>(`[data-review-queue-action="${CSS.escape(returningReview)}"]`);
    (action ?? heading.current)?.focus({ preventScroll: true });
    onReviewReturn();
  }, [returningReview, data, busy, onReviewReturn]);
  return <section ref={queue} className="integration record-form manager-panel" aria-label="Internal review queue">
    <div className="section-heading"><h2 ref={heading} tabIndex={-1}>Internal review queue</h2><Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: undefined })}><RefreshCw /> Refresh reviews</Button></div>
    <div className="calendar-filters">
      <label className="field">Review ownership<select value={query.view} onChange={(event) => setQuery({ ...query, view: event.target.value as ReviewQueueQuery["view"], after: undefined })}>
        {reviewViews.filter((view) => team || view !== "Brokerage").map((view) => <option key={view}>{view}</option>)}
      </select></label>
      <label className="field">Review status<select value={query.filter} onChange={(event) => setQuery({ ...query, filter: event.target.value as ReviewQueueQuery["filter"], after: undefined })}>
        {reviewFilters.map((filter) => <option key={filter}>{filter}</option>)}
      </select></label>
    </div>
    {!data && <p className="muted" role="status">Loading internal reviews…</p>}
    {data && "error" in data && <p role="alert">{data.error}</p>}
    {page && <>
      {page.reviews.length ? <ReviewList rows={page.reviews} busy={busy} open={open} queue /> : <p className="empty-inline">No reviews match this view. Request a review from a loan’s Team reviews section.</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: undefined })}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: page.next ?? undefined })}>Next page</Button>}
      </div>
    </>}
  </section>;
}

function CreateReview({ loanId, page, busy, save, requestPreflight, requestClosing, openEvidence }: {
  loanId: string; page: LoanPage; busy: boolean; save: Save; requestPreflight?: boolean; requestClosing?: boolean;
  openEvidence: (target: string) => void;
}) {
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const category = useRef<HTMLSelectElement>(null);
  const reviewer = useRef<HTMLSelectElement>(null);
  const { routingBlock } = page;
  const canRequest = page.options.length > 0;
  const preflight = requestPreflight && page.preflightKey ? filePreflightCategory : undefined;
  const closing = requestClosing ? page.closingPackage : undefined;
  const secondReview = page.canReview1003 ? routingBlock : undefined;
  const capturedDueOn = secondReview?.dueOn;
  const dueOn = capturedDueOn === null ? "" : capturedDueOn && capturedDueOn > page.today ? capturedDueOn : page.today;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const reviewCategory = data.get("category") as ReviewSummary["category"];
    const fields = { title: String(data.get("title")), category: reviewCategory,
      reviewerEmail: String(data.get("reviewerEmail")), dueOn: String(data.get("dueOn")), note: String(data.get("note")),
      ...(reviewCategory === filePreflightCategory ? { preflightKey: page.preflightKey } : {}),
      ...(reviewCategory === closingPackageReviewCategory ? { closingPackage: closing } : {}) };
    const key = JSON.stringify(fields);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    void save({ type: "create", loanId, id: attempt.current.id, ...fields }, () => {
      attempt.current = null;
      form.reset();
      form.closest("details")?.removeAttribute("open");
    });
  }
  if (requestClosing && !closing) return <div className="record-form" id={requestClosingPackageReviewTarget} tabIndex={-1}>
    <p role="status">Assignment needs a current signed replacement and an eligible teammate. Check the package and existing reviews.</p>
    <div><Button size="sm" variant="outline" onClick={() => openEvidence(closingDisclosureReviewTarget)}>Back to closing package</Button></div>
  </div>;
  return <>
    {!requestClosing && routingBlock && <aside className="document-item" aria-label="1003 second review needs assignment">
      <strong>1003 second review needs assignment</strong>
      <p>{routingBlock.reason}</p>
      <p className="muted">{routingBlock.dueOn ? `Target due date ${dateLabel(routingBlock.dueOn)}.` : "Choose a due date when you assign the second reviewer."}</p>
      {canRequest && secondReview ? <Button size="sm" variant="outline" disabled={busy} onClick={() => {
        if (details.current) details.current.open = true;
        if (category.current) category.current.value = "1003 second review";
        reviewer.current?.focus();
      }}>Assign second reviewer</Button> : <p className="muted">An eligible teammate and a reviewed 1003 are required for manual assignment.</p>}
    </aside>}
    {canRequest ? <details className="document-form" ref={details} open={preflight || closing ? true : undefined}>
      <summary id={closing ? requestClosingPackageReviewTarget : undefined}>{closing ? `Assign closing reviewer · Package v${closing.version}` : "Request internal review"}</summary>
      <form onSubmit={submit}>
        {closing ? <>
          <input name="title" type="hidden" value="Review sample closing package" />
          <input name="category" type="hidden" value={closingPackageReviewCategory} />
        </> : <><label>Review title<input name="title" required maxLength={120} defaultValue={preflight ?? (secondReview ? "1003 second review" : undefined)}
          placeholder="e.g. Check the application before handoff" /></label>
        <label>Review type<select name="category" ref={category} defaultValue={preflight ?? (secondReview ? "1003 second review" : undefined)}>{reviewCategories.filter((category) => category !== closingPackageReviewCategory).map((category) => <option key={category}
          disabled={(category === "1003 second review" && !page.canReview1003) || (category === filePreflightCategory && !page.preflightKey)}>{category}</option>)}</select></label>
        </>}
        <div className={closing ? "grid w-full grid-cols-1 gap-2 min-[521px]:grid-cols-2" : "contents"}>
          <label className={closing ? "field" : undefined}>Assigned reviewer<select name="reviewerEmail" defaultValue="" ref={reviewer} required
            className={closing ? "min-h-11" : undefined}><option value="">Choose a teammate</option>
            {page.options.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.role}</option>)}
          </select></label>
          <label className={closing ? "field" : undefined}>Review due date<input type="date" name="dueOn" defaultValue={closing ? page.today : dueOn}
            className={closing ? "min-h-11" : undefined} min={page.today} required /></label>
        </div>
        <label>Internal request note<textarea name="note" rows={2} required maxLength={800} /></label>
        <div className="loan-application-actions">
          <Button type="submit" size="sm" className={closing ? "min-h-11" : undefined} disabled={busy}>
            {closing ? (busy ? "Assigning…" : "Assign review") : "Send internal review request"}</Button>
          {closing && <Button size="sm" variant="outline" className="min-h-11" disabled={busy}
            onClick={() => openEvidence(closingDisclosureReviewTarget)}>Back to closing package</Button>}
        </div>
      </form>
    </details> : !routingBlock && <p className="empty-inline">Request a review on an active file with an eligible teammate.</p>}
  </>;
}

const actionNames = { comment: "Add comment", approve: "Approve review", changes: "Request changes", reassign: "Reassign reviewer",
  resubmit: "Resubmit review", escalate: "Escalate to manager", cancel: "Cancel review" } as const;
type Action = keyof typeof actionNames;

function ReviewActions({ page, busy, save }: { page: DetailPage; busy: boolean; save: Save }) {
  const { review, today } = page;
  const isClosing = review.category === closingPackageReviewCategory;
  const [action, setAction] = useState<Action>(isClosing && review.status === "Requested" && !review.reviewerAvailable &&
    !review.evidenceChanged && review.canManage && review.options.length > 0 ? "reassign" : "comment");
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const available: Action[] = ["comment"];
  if (review.canDecide) {
    if (!review.preflight || !preflightBlocked(review.preflight)) available.push("approve");
    available.push("changes");
  }
  if (review.canManage) {
    if (review.options.length) available.push("reassign");
    if (isClosing ? review.resubmitClosingPackage : review.status === "Changes requested" || review.evidenceChanged) available.push("resubmit");
    if (!review.escalatedAt) available.push("escalate");
    available.push("cancel");
  }
  const selected = available.includes(action) ? action : "comment";
  const dated = selected === "reassign" || selected === "resubmit";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const note = String(data.get("note"));
    const dueOn = String(data.get("dueOn") ?? "");
    const reviewerEmail = String(data.get("reviewerEmail") ?? "");
    const mentionEmail = String(data.get("mentionEmail") ?? "") || undefined;
    const key = JSON.stringify([selected, review.id, review.revision, note, dueOn, reviewerEmail, mentionEmail, review.resubmitClosingPackage]);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    const base = { id: review.id, loanId: review.loanId, eventId: attempt.current.id, note };
    const edit = { ...base, revision: review.revision };
    let change: ReviewMutation;
    switch (selected) {
      case "comment": change = { ...base, type: "comment", mentionEmail }; break;
      case "approve":
      case "changes": change = { ...edit, type: "decide", decision: selected === "approve" ? "Approved" : "Changes requested" }; break;
      case "reassign": change = { ...edit, type: "reassign", reviewerEmail, dueOn }; break;
      case "resubmit": change = { ...edit, type: "resubmit", dueOn, preflightKey: review.preflight?.key, closingPackage: review.resubmitClosingPackage }; break;
      case "escalate": change = { ...edit, type: "escalate" }; break;
      case "cancel": change = { ...edit, type: "cancel" }; break;
    }
    void save(change, () => { attempt.current = null; form.reset(); setAction("comment"); });
  }
  return <form className="record-form" onSubmit={submit}>
    <label className="field">Review action<select value={selected} onChange={(event) => setAction(event.target.value as Action)}>
      {available.map((type) => <option key={type} value={type}>{actionNames[type]}</option>)}
    </select></label>
    {selected === "reassign" && <label className="field">New reviewer<select name="reviewerEmail" required
      defaultValue={review.options.some((member) => member.email === review.reviewerEmail) ? review.reviewerEmail : ""}>
      <option value="">Choose a teammate</option>{review.options.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.role}</option>)}
    </select></label>}
    {dated && <label className="field">New review due date<input name="dueOn" type="date" min={today} defaultValue={review.dueOn < today ? today : review.dueOn} required /></label>}
    {selected === "comment" && review.mentionOptions.length > 0 && <label className="field">Mention teammate<select name="mentionEmail" defaultValue="">
      <option value="">No mention</option>{review.mentionOptions.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.role}</option>)}
    </select></label>}
    {selected === "resubmit" && review.resubmitClosingPackage && <p>Send signed package v{review.resubmitClosingPackage.version} to {review.reviewerName}.</p>}
    <label className="field">{isClosing && selected === "changes" ? "Reason for returning the package" : "Internal note"}
      <textarea name="note" rows={2} maxLength={800} required /></label>
    <div><Button type="submit" size="sm" className={isClosing ? "min-h-11" : undefined} disabled={busy}>
      {isClosing && busy ? "Saving…" : isClosing && selected === "changes" ? "Return for corrections" : actionNames[selected]}</Button></div>
  </form>;
}

export function LoanReviews({ brokerageId, loanId, focusId, onChanged, openEvidence, requestPreflight, requestClosing }: {
  brokerageId: string; loanId: string; focusId?: string; onChanged: () => void; openEvidence: (target: string) => void; requestPreflight?: boolean;
  requestClosing?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>();
  const [version, setVersion] = useState(0);
  const [before, setBefore] = useState<number>();
  const [list, setList] = useState<{ version: number; data: LoanPage | { error: string } }>();
  const [detail, setDetail] = useState<{ id: string; version: number; before?: number; data: DetailPage | { error: string } }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const activeId = selected === undefined ? focusId : selected;

  useEffect(() => {
    let active = true;
    const update = (data: LoanPage | { error: string }) => { if (active) setList({ version, data }); };
    const failure = { error: "Could not load reviews for this loan." };
    void workOnLoanReview({ type: "loan", loanId, focusId, ...(requestPreflight ? { preparePreflight: true } : {}),
      ...(requestClosing ? { prepareClosing: true } : {}) }, brokerageId).then((result) =>
      update("error" in result || result.kind === "loan" ? result : failure), () => update(failure));
    return () => { active = false; };
  }, [brokerageId, loanId, focusId, requestPreflight, requestClosing, version]);

  useEffect(() => {
    if (!activeId) return;
    let active = true;
    const update = (data: DetailPage | { error: string }) => { if (active) setDetail({ id: activeId, version, before, data }); };
    const failure = { error: "Could not open this internal review." };
    void workOnLoanReview({ type: "detail", loanId, id: activeId, before }, brokerageId).then((result) =>
      update("error" in result || result.kind === "detail" ? result : failure), () => update(failure));
    return () => { active = false; };
  }, [activeId, before, brokerageId, loanId, version]);

  const rows = list?.version === version ? list.data : undefined;
  const activeDetail = detail?.id === activeId && detail?.version === version && detail.before === before ? detail.data : undefined;
  const page = activeDetail && !("error" in activeDetail) ? activeDetail : undefined;
  useEffect(() => {
    if (!page || before) return;
    const section = document.getElementById(reviewTarget(page.review.id));
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: "start" });
  }, [page, before]);

  async function save(input: ReviewMutation, after?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await workOnLoanReview(input, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "saved") {
        setSelected(result.id); setBefore(undefined); setVersion((value) => value + 1);
        setMessage(result.message); onChanged(); after?.();
      }
    } catch { setError("Could not save this internal review. Try again."); }
    finally { pending.current = false; setBusy(false); }
  }

  const closing = page?.review.closingPackage;
  const returning = page?.review.category === closingPackageReviewCategory && page.review.status === "Changes requested";
  const needsReplacement = page?.review.category === closingPackageReviewCategory &&
    (returning || (page.review.status === "Requested" && page.review.evidenceChanged)) && !page.review.resubmitClosingPackage;
  const returnReason = returning ? page.history.find((event) => event.action === "Changes requested")?.note : undefined;
  const evidence = page && ({ "1003 second review": ["Open 1003", "loan-application"], "Document checklist": ["Open document checklist", "document-checklist"],
    "Closing readiness": ["Open closing workbench", "closing-workbench"], "General file review": null,
    [filePreflightCategory]: ["Open file preflight", filePreflightTarget],
    [closingPackageReviewCategory]: needsReplacement ? ["Open disclosures to prepare a replacement", disclosureTarget] : ["Open current closing package", closingDisclosureReviewTarget] })[page.review.category];
  return <section className="details-section document-section" id={loanReviewsTarget} tabIndex={-1} aria-label="Team reviews">
    <div className="section-heading"><h3><ClipboardCheck size={17} /> Team reviews</h3>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setVersion((value) => value + 1); setError(""); }}><RefreshCw /> Refresh team reviews</Button>
    </div>
    <p className="muted">Request an internal second look and record the reviewer’s decision on this file.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!rows && <p role="status" className="muted">Loading team reviews…</p>}
    {rows && "error" in rows && <p role="alert">{rows.error}</p>}
    {rows && !("error" in rows) && <>
      <CreateReview loanId={loanId} page={rows} busy={busy} save={save} requestPreflight={requestPreflight} requestClosing={requestClosing && !activeId} openEvidence={openEvidence} />
      {rows.reviews.length ? <ReviewList rows={rows.reviews} busy={busy} open={(row) => { setSelected(row.id); setBefore(undefined); setError(""); }} /> :
        <p className="empty-inline">No internal reviews on this loan.</p>}
      {rows.hasMore && <p className="muted">Open Reviews in the workspace to see more requests.</p>}
    </>}
    {activeId && !activeDetail && <p role="status" className="muted">Opening review…</p>}
    {activeDetail && "error" in activeDetail && <p role="alert">{activeDetail.error}</p>}
    {page && <section className="document-item" id={reviewTarget(page.review.id)} tabIndex={-1} aria-label="Review detail">
      <div className="section-heading"><h4>{page.review.title}</h4><Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Close review detail</Button></div>
      <p>{page.review.category} · {page.review.status} · Due {dateLabel(page.review.dueOn)}</p>
      <p className="muted">Assigned to {page.review.reviewerName} · Requested by {page.review.requesterName}</p>
      {page.review.escalatedAt && <p>Escalated for manager attention.</p>}
      {page.review.applicationRevision !== null && <p>Submitted 1003 revision {page.review.applicationRevision}</p>}
      {closing && <div className="record-form">
        <p><strong>Package v{closing.version}</strong> · 1003 revision {closing.applicationRevision} · Fee worksheet revision {closing.feeRevision}</p>
        <SavedDisclosureTermChanges changes={closing.changeReview?.changes} legacyChanges={closing.legacyChanges} />
      </div>}
      {returnReason && <p><strong>Correction requested</strong> · {returnReason}</p>}
      {page.review.evidenceChanged && <p>{closing ? (needsReplacement
        ? "Prepare, issue and sign a replacement before resubmitting this review." : "This review refers to an earlier package version.")
        : page.review.preflight ? "The file evidence has changed since this review." : "The submitted 1003 version has changed since this review."}</p>}
      {!page.review.reviewerAvailable && (page.review.status === "Requested" || page.review.status === "Changes requested") &&
        <p>{closing && page.review.canManage && !page.review.options.length ?
          "No eligible reviewer is available. Give another teammate access to this loan, then reopen the review." :
          "The reviewer needs to be reassigned."}</p>}
      {evidence && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => openEvidence(evidence[1])}>{evidence[0]}</Button></div>}
      {page.review.preflight && <details className="document-form" open>
        <summary>Current preflight checks</summary>
        <PreflightChecks preflight={page.review.preflight} open={openEvidence} />
      </details>}
      <ReviewActions key={`${page.review.id}:${page.review.revision}`} page={page} busy={busy} save={save} />
      <h4>Internal decision history</h4>
      <ul className="document-list">{page.history.map((event) => <li key={event.sequence} className="document-item">
        <strong>{event.action} · {event.actorName}</strong><p className="muted">{dateTime(event.at)} ET
          {event.closingPackage && ` · Package v${event.closingPackage.version}`}{event.context && ` · ${event.context}`}</p><p>{event.note}</p>
        {event.preflight && <details className="document-form"><summary>Evidence at this decision</summary><PreflightChecks preflight={event.preflight} /></details>}
      </li>)}</ul>
      <div className="loan-application-actions">
        {before && <Button size="sm" variant="outline" onClick={() => setBefore(undefined)}>Latest decisions</Button>}
        {page.before && <Button size="sm" variant="outline" onClick={() => setBefore(page.before ?? undefined)}>Older decisions</Button>}
      </div>
    </section>}
  </section>;
}

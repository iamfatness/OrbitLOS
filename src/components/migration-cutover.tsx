"use client";

import { useEffect, useRef, useState } from "react";
import { downloadCutoverHandoff, findCutoverFile, readCutoverApplicationComparison, readCutoverChecklist, readCutoverFileInventory, saveCutoverFileInventory, saveCutoverReview } from "@/app/actions";
import type { CutoverApplicationComparison } from "@/lib/cutover-application-model";
import { cutoverFileSourceSection, type CutoverFileSource } from "@/lib/cutover-file-model";
import { cutoverCallbackItem, cutoverDecisions, cutoverItems, type CutoverCallbackEvidence, type CutoverDraft, type CutoverDraftCursor, type CutoverFileInventory, type CutoverFileLookup, type CutoverReview, type MigrationCutover } from "@/lib/migration-cutover-model";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";
import { ApplicationCutoverComparison } from "./cutover-application-comparison";
import { CutoverOpenWorkPreview, FileInventoryComparison, FileInventoryUpload } from "./cutover-file-inventory";
import { CutoverDraftChecks, CutoverReadinessOverview, CutoverReferenceLookup } from "./cutover-readiness";
import { downloadSampleFile } from "./sample-download";
import { MigrationRecordLink } from "./migration-record-link";
import type { MigrationDestination } from "@/lib/migration-record-model";
import type { WorkspaceMutationSuccess } from "@/lib/commands";

type CutoverResult = MigrationCutover | { error: string };
type Item = CutoverReview["item"];
type FileItem = keyof typeof cutoverItems;
type ReferenceRequest = { reference: string };
const reviewItems = Object.entries(cutoverItems) as [FileItem, (typeof cutoverItems)[FileItem]][];

function recordCounts(byType: NonNullable<MigrationCutover["evidence"]>["byType"]) {
  return Object.entries(byType).map(([type, count]) => `${count} ${count === 1 ? type.slice(0, -1) : type}`).join(" · ");
}

function reviewCount(reviews: CutoverReview[]) {
  return `${reviews.filter(({ decision, item, applicationCurrent, fileCurrent }) => item !== cutoverCallbackItem &&
    decision !== "Pending" && applicationCurrent !== false && fileCurrent !== false).length} / ${reviewItems.length} reviewed`;
}

function CutoverReviewList({ reviews, basis, disabled, record, openEvidence, applicationReady, fileInventory }: {
  reviews: CutoverReview[]; basis: string; disabled: boolean; record: (item: Item, revision: number, fields: FormData) => void;
  openEvidence?: (target: string) => void; applicationReady?: boolean; fileInventory?: CutoverFileInventory;
}) {
  return <ul className="document-list">{reviewItems.map(([item, { label, detail, fileDetail, target }]) => {
    const review = reviews.find((entry) => entry.item === item);
    const fileItem = item === "application" ? undefined : item;
    const fileComparison = fileItem && fileInventory ? fileInventory[fileItem] : null;
    const requiresComparison = !!openEvidence && (item === "application" || !!fileItem);
    const ready = item === "application" ? applicationReady : !!fileComparison && fileComparison.rows.every(({ status }) => status !== "Missing");
    const needsReview = requiresComparison && review?.decision === "Reconciled" && (review.applicationCurrent === false || review.fileCurrent === false);
    const decision = needsReview ? "Pending" : review?.decision ?? "Pending";
    return <li className="document-item record-form" key={item}>
      <div className="document-item-head"><strong>{label}</strong><span className={needsReview ? "open-chip" : "pill"}>{needsReview ? "Review again" : decision}</span></div>
      <p className="muted">{openEvidence ? fileDetail : detail}</p>
      {needsReview && <p role="status">Review the current comparison before reconciling this draft again.</p>}
      {review && <div><p>{review.note}</p><small>{needsReview ? "Previously recorded" : "Recorded"} by {review.updatedBy} · {dateTime(review.updatedAt)} ET</small></div>}
      {openEvidence && <div><Button size="sm" variant="outline" disabled={disabled} onClick={() => openEvidence(target)}>
        Open {label.toLowerCase()}
      </Button></div>}
      {openEvidence && fileItem && fileInventory && <FileInventoryComparison comparison={fileComparison} category={label} item={fileItem}
        supplied={fileInventory.source?.[cutoverFileSourceSection[fileItem]] !== undefined} />}
      {openEvidence && item === "funding" && fileComparison?.rows.some(({ status }) => status === "Missing") &&
        <p className="muted">If funding is recorded and its follow-up is missing, check Automation run history in Playbooks.</p>}
      <details className="document-form" key={`${basis}:${review?.revision ?? 0}:${needsReview}`}>
        <summary>Review {label.toLowerCase()}</summary>
        <form className="record-form" onSubmit={(event) => {
          event.preventDefault();
          record(item, review?.revision ?? 0, new FormData(event.currentTarget));
        }}>
          <label className="field">Decision<select name="decision" defaultValue={decision} disabled={disabled}>
            {cutoverDecisions.map((choice) => <option key={choice}
              disabled={choice === "Reconciled" && requiresComparison && !ready}>{choice}</option>)}</select></label>
          <label className="field">Evidence note<textarea name="note" rows={2} maxLength={500} defaultValue={review?.note ?? ""} disabled={disabled} /></label>
          <div><Button size="sm" type="submit" disabled={disabled}>Save review</Button></div>
        </form>
      </details>
    </li>;
  })}</ul>;
}

function CallbackSignoff({ callbacks, review, complete, disabled, after, page, brokerageId, origin, openRecord, record, expanded, setExpanded }: {
  callbacks: CutoverCallbackEvidence; review?: CutoverReview; complete: boolean; disabled: boolean; after?: string;
  page: (after?: string) => void; brokerageId: string; origin: string; openRecord: (destination: MigrationDestination) => void;
  record: (revision: number, fields: FormData) => void;
  expanded: boolean; setExpanded: (open: boolean) => void;
}) {
  const { counts, unrestored, oversized } = callbacks;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const blockers = counts["Needs owner"] + counts["Needs recovery"] + counts["Missing evidence"] + unrestored;
  const canReconcile = complete && total > 0 && !blockers && !oversized;
  const needsReview = review?.decision === "Reconciled" && review.callbackCurrent === false;
  const decision = needsReview ? "Pending" : review?.decision ?? "Pending";
  return <section className="document-item record-form" aria-label="Callback cutover sign-off">
    <div className="document-item-head"><h3>Callback cutover sign-off</h3><span className={needsReview ? "open-chip" : "pill"}>{needsReview ? "Review again" : decision}</span></div>
    <p className="muted">Confirm that restored promises have call evidence and that open callbacks have a current task and an active owner. Held and closed promises appear separately.</p>
    {total > 0 && <div className="loan-application-actions" aria-label="Callback readiness counts">
      {Object.entries(counts).map(([status, count]) => <span className="pill" key={status}>{count} {status.toLowerCase()}</span>)}
      {unrestored > 0 && <span className="open-chip">{unrestored} callback {unrestored === 1 ? "record" : "records"} awaiting restoration</span>}
    </div>}
    {total === 0 && !unrestored && !oversized && <p className="empty-inline">This source has no restored callback promises.</p>}
    {total === 0 && unrestored > 0 && <p role="status">{unrestored} callback {unrestored === 1 ? "record needs" : "records need"} restoration.</p>}
    {oversized && <p role="status">This source exceeds the callback review limit. Review a smaller source before reconciling.</p>}
    {blockers > 0 && <p role="status">Resolve callback blockers before marking this check reconciled.</p>}
    {needsReview && <p role="status">Callback evidence changed after the last sign-off. Review it again.</p>}
    {callbacks.items.length > 0 && <details className="document-form" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>View callback evidence</summary>
      <ul className="document-list">{callbacks.items.map((item) => <li key={item.key} className="document-item">
        <div className="document-item-head"><strong>{item.name}</strong><span className="pill">{item.status}</span></div>
        <p className="muted">{[item.campaignName, item.owner].filter(Boolean).join(" · ")}</p>
        <p>{item.reason}</p>
        {item.dueAt && <p className="muted">Promised deadline · {dateTime(item.dueAt, "medium")} ET</p>}
        {item.scheduledAt && item.scheduledAt !== item.dueAt && <p className="muted">Current callback time · {dateTime(item.scheduledAt)} ET</p>}
        {item.leadId && <MigrationRecordLink key={`${origin}:${item.leadId}`} brokerageId={brokerageId}
          query={{ type: "result", origin, key: item.key.split("/", 1)[0].replace(/^Callback:/, "Lead:"), targetId: item.leadId }}
          busy={disabled} open={openRecord} label="Open linked record" />}
      </li>)}</ul>
    </details>}
    {(after || callbacks.next) && <div className="loan-application-actions">
      {after && <Button size="sm" variant="outline" disabled={disabled} onClick={() => page()}>First callbacks</Button>}
      {callbacks.next && <Button size="sm" variant="outline" disabled={disabled} onClick={() => page(callbacks.next ?? undefined)}>Next callbacks</Button>}
    </div>}
    {review && <div><p>{review.note}</p><small>{needsReview ? "Previously recorded" : "Recorded"} by {review.updatedBy} · {dateTime(review.updatedAt)} ET</small></div>}
    <details className="document-form" key={`${callbacks.fingerprint}:${review?.revision ?? 0}`}>
      <summary>Review callback cutover</summary>
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        record(review?.revision ?? 0, new FormData(event.currentTarget));
      }}>
        <label className="field">Callback decision<select name="decision" defaultValue={canReconcile ? decision : decision === "Reconciled" ? "Pending" : decision} disabled={disabled}>
          {cutoverDecisions.map((choice) => <option key={choice} disabled={choice === "Reconciled" && !canReconcile}>{choice}</option>)}</select></label>
        <label className="field">Callback evidence note<textarea name="note" rows={2} maxLength={500} defaultValue={review?.note ?? ""} disabled={disabled} /></label>
        <div><Button size="sm" type="submit" disabled={disabled}>Save callback review</Button></div>
      </form>
    </details>
  </section>;
}

export function MigrationCutoverChecklist({ brokerageId, version, busy, openLoan, openRecord, save, initialOrigin }: {
  brokerageId: string; version: object; busy: boolean; openLoan: (id: string, target: string) => void;
  openRecord: (destination: MigrationDestination) => void;
  save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void, announce?: boolean) => Promise<void>;
  initialOrigin?: string;
}) {
  const [request, setRequest] = useState<{ origin?: string; after?: CutoverDraftCursor; callbackAfter?: string }>({ origin: initialOrigin });
  const [result, setResult] = useState<{ request: object; version: object; data: CutoverResult }>();
  const [notice, setNotice] = useState<{ message: string } | { error: string }>();
  const [workReceipt, setWorkReceipt] = useState<{ loanId: string; message: string; target: string }>();
  const receiptRef = useRef<HTMLParagraphElement>(null);
  const focusedReceipt = useRef<typeof workReceipt>(undefined);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const draftDisclosure = useRef<HTMLElement>(null);
  const referenceHeading = useRef<HTMLHeadingElement>(null);
  const lastFocused = useRef<ReferenceRequest | undefined>(undefined);
  const [callbacksOpen, setCallbacksOpen] = useState(false);
  const [selectedLoanId, setSelectedLoanId] = useState<string>();
  const [referenceRequest, setReferenceRequest] = useState<ReferenceRequest>();
  const [referenceResult, setReferenceResult] = useState<{ request: object; version: object; lookup: ReferenceRequest; data: CutoverFileLookup }>();
  const [comparison, setComparison] = useState<{ request: object; version: object; lookup?: ReferenceRequest; loanId: string; data: CutoverApplicationComparison | { error: string } }>();
  const [fileInventory, setFileInventory] = useState<{ request: object; version: object; lookup?: ReferenceRequest; loanId: string; data: CutoverFileInventory | { error: string } }>();
  useEffect(() => {
    let active = true;
    const update = (data: CutoverResult) => { if (active) setResult({ request, version, data }); };
    void readCutoverChecklist(brokerageId, request.origin ? request : undefined).then(update, () => update({ error: "Could not load the checklist. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, request, version]);
  const data = result?.request === request && result.version === version ? result.data : undefined;
  const current = data && !("error" in data) ? data : undefined;
  const evidence = current?.evidence;
  const origin = evidence?.origin;
  const basis = evidence?.basis;
  useEffect(() => {
    if (!origin || !basis || !referenceRequest) return;
    let active = true;
    const update = (data: CutoverFileLookup) => { if (active) setReferenceResult({ request, version, lookup: referenceRequest, data }); };
    void findCutoverFile(brokerageId, { origin, basis, reference: referenceRequest.reference }).then(update,
      () => update({ error: "Could not check that file reference. Try again." }));
    return () => { active = false; };
  }, [basis, brokerageId, origin, referenceRequest, request, version]);
  const lookup = referenceResult?.request === request && referenceResult.version === version && referenceResult.lookup === referenceRequest ? referenceResult.data : undefined;
  const locatedDraft = lookup && "draft" in lookup ? lookup.draft : undefined;
  useEffect(() => {
    if (locatedDraft && referenceRequest && lastFocused.current !== referenceRequest) {
      lastFocused.current = referenceRequest;
      referenceHeading.current?.focus({ preventScroll: true });
      referenceHeading.current?.scrollIntoView({ block: "start" });
    }
  }, [locatedDraft, referenceRequest]);
  const selectedLoan = referenceRequest ? locatedDraft : evidence?.drafts.find(({ id }) => id === selectedLoanId);
  const comparisonLoanId = selectedLoan?.id;
  useEffect(() => {
    if (!origin || !basis || !comparisonLoanId) return;
    let active = true;
    const update = (data: CutoverApplicationComparison | { error: string }) => {
      if (active) setComparison({ request, version, lookup: referenceRequest, loanId: comparisonLoanId, data });
    };
    void readCutoverApplicationComparison(brokerageId, { origin, basis, loanId: comparisonLoanId }).then(update,
      () => update({ error: "Could not load the source comparison. Try refreshing." }));
    const updateInventory = (data: CutoverFileInventory | { error: string }) => {
      if (active) setFileInventory({ request, version, lookup: referenceRequest, loanId: comparisonLoanId, data });
    };
    void readCutoverFileInventory(brokerageId, { origin, basis, loanId: comparisonLoanId }).then(updateInventory,
      () => updateInventory({ error: "Could not load the source inventory. Try refreshing." }));
    return () => { active = false; };
  }, [basis, brokerageId, comparisonLoanId, origin, referenceRequest, request, version]);
  const compared = comparison?.request === request && comparison.version === version && comparison.lookup === referenceRequest && comparison.loanId === comparisonLoanId ? comparison.data : undefined;
  const validComparison = compared && !("error" in compared) ? compared : undefined;
  const inventory = fileInventory?.request === request && fileInventory.version === version && fileInventory.lookup === referenceRequest && fileInventory.loanId === comparisonLoanId ? fileInventory.data : undefined;
  const validInventory = inventory && !("error" in inventory) ? inventory : undefined;
  const applicationReady = !!validComparison && !validComparison.missingExtraBorrowers &&
    validComparison.rows.every(({ status }) => status !== "Missing in draft");
  const disabled = saving || downloading || busy;

  useEffect(() => {
    if (!validInventory?.openWork || !workReceipt || focusedReceipt.current === workReceipt || !receiptRef.current) return;
    focusedReceipt.current = workReceipt;
    receiptRef.current.focus({ preventScroll: true });
    receiptRef.current.scrollIntoView({ block: "nearest" });
  }, [validInventory, workReceipt]);

  function pageDrafts(after?: CutoverDraftCursor) {
    if (!evidence) return;
    setSelectedLoanId(undefined);
    setRequest({ ...request, origin: evidence.origin, after });
  }

  async function record(item: Item, revision: number, fields: FormData, loanId?: string) {
    if (!evidence || disabled) return;
    const decision = fields.get("decision");
    const note = String(fields.get("note") ?? "").trim();
    if (decision !== "Pending" && !note) {
      setNotice({ error: "Add an evidence note before marking this check reviewed." });
      return;
    }
    setSaving(true);
    setNotice(undefined);
    try {
      const reply = await saveCutoverReview(brokerageId, { origin: evidence.origin, basis: evidence.basis, loanId, item, decision, note, revision,
        callbackFingerprint: item === cutoverCallbackItem ? evidence.callbacks.fingerprint : undefined,
        applicationFingerprint: loanId && item === "application" ? validComparison?.fingerprint : undefined,
        fileFingerprint: loanId && item !== "application" && item !== cutoverCallbackItem ? validInventory?.[item]?.fingerprint : undefined });
      setNotice("error" in reply ? { error: reply.error ?? "Could not save the review." } : { message: reply.message });
      setRequest({ ...request, origin: evidence.origin });
    } catch {
      setNotice({ error: "Could not confirm the review. Refresh the checklist before trying again." });
    } finally { setSaving(false); }
  }

  async function saveInventory(source: CutoverFileSource, revision: number, loanId: string) {
    if (!evidence || disabled) return;
    setSaving(true);
    setNotice(undefined);
    setWorkReceipt(undefined);
    try {
      const reply = await saveCutoverFileInventory(brokerageId, { origin: evidence.origin, basis: evidence.basis, loanId, source, revision, fictional: true });
      setNotice("error" in reply ? { error: reply.error ?? "Could not save the source inventory." } : { message: reply.message });
      if (!("error" in reply)) setRequest({ ...request, origin: evidence.origin });
    } catch {
      setNotice({ error: "Could not confirm the inventory save. Refresh the checklist before trying again." });
    } finally { setSaving(false); }
  }

  async function downloadHandoff() {
    if (!evidence?.readiness.counts || disabled) return;
    setDownloading(true);
    setNotice(undefined);
    try {
      const reply = await downloadCutoverHandoff(brokerageId, { origin: evidence.origin, basis: evidence.basis });
      if ("error" in reply) {
        setNotice({ error: reply.error ?? "Could not prepare the cutover handoff report." });
        return;
      }
      downloadSampleFile(reply.html, reply.filename, "text/html;charset=utf-8");
      setNotice({ message: "Cutover handoff report prepared." });
    } catch {
      setNotice({ error: "Could not prepare the cutover handoff report. Try again." });
    } finally { setDownloading(false); }
  }

  function showLinkedFiles() {
    setReferenceRequest(undefined);
    setDraftsOpen(true);
    draftDisclosure.current?.focus();
  }

  function fileCard(draft: CutoverDraft, fileBasis: string, focused = false) {
    const expanded = focused || selectedLoan?.id === draft.id;
    const receipt = workReceipt?.loanId === draft.id ? workReceipt : undefined;
    return <li className="document-item" key={draft.id}>
      <div className="document-item-head">
        {focused ? <h4 ref={referenceHeading} tabIndex={-1} className="scroll-mt-16 font-semibold">{draft.name}</h4> : <strong>{draft.name}</strong>}
        <span className={draft.readiness.status === "Needs review" ? "open-chip" : "pill"}>{draft.readiness.status}</span>
      </div>
      <p>{[draft.purpose, money(draft.amount), draft.address, `Ref ${draft.id.slice(-8)}`, reviewCount(draft.reviews)].filter(Boolean).join(" · ")}</p>
      <CutoverDraftChecks draft={draft} expanded={focused || undefined} />
      <div className="loan-application-actions">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => openLoan(draft.id, cutoverItems.application.target)}>Open linked 1003</Button>
        {!focused && <Button size="sm" variant={expanded ? "default" : "outline"} aria-expanded={expanded}
          disabled={disabled} onClick={() => setSelectedLoanId(expanded ? undefined : draft.id)}>Review file evidence</Button>}
      </div>
      {expanded && <section className="record-form" aria-label={`File evidence for ${draft.name}`}>
        <ApplicationCutoverComparison comparison={compared} />
        <FileInventoryUpload inventory={inventory} disabled={disabled} save={(source, revision) => void saveInventory(source, revision, draft.id)} />
        {validInventory?.openWork && <CutoverOpenWorkPreview work={validInventory.openWork} disabled={disabled} receipt={receipt?.message} receiptRef={receiptRef}
          openAssignment={() => openLoan(draft.id, "processing-handoff")}
          openRestoredWork={() => { if (receipt) openLoan(draft.id, receipt.target); }}
          restore={() => {
            const work = validInventory.openWork;
            if (!origin || !basis || !work || disabled) return;
            setNotice(undefined);
            setWorkReceipt(undefined);
            void save({ type: "restoreCutoverWork", origin, basis, loanId: draft.id, preview: work.fingerprint },
              ({ message }) => setWorkReceipt({ loanId: draft.id, message, target: work.conditions ? cutoverItems.lender.target : cutoverItems.documents.target }), false);
          }} />}
        <CutoverReviewList reviews={draft.reviews} basis={fileBasis} disabled={disabled} applicationReady={applicationReady} fileInventory={validInventory}
          record={(item, revision, fields) => void record(item, revision, fields, draft.id)} openEvidence={(target) => openLoan(draft.id, target)} />
      </section>}
    </li>;
  }

  return <section className="integration record-form manager-panel" aria-label="Migration cutover checklist">
    <div className="section-heading"><h2>Migration cutover checklist</h2>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => { setNotice(undefined); setRequest({ ...request }); }}>Refresh cutover checklist</Button></div>
    <p className="muted">Review source receipts and linked fictional 1003 drafts. Record separate checks for information that still needs reconciliation.</p>
    {!data && <p role="status">Loading migration evidence…</p>}
    {data && "error" in data && <p role="alert">{data.error}</p>}
    {notice && ("error" in notice ? <p role="alert">{notice.error}</p> : <p role="status">{notice.message}</p>)}
    {current && !evidence && <p className="empty-inline">Import a fictional CRM batch below to start a cutover checklist.</p>}
    {evidence && <>
      <label className="field">Migration source<select value={evidence.origin} disabled={disabled} onChange={(event) => {
        setNotice(undefined);
        setSelectedLoanId(undefined);
        setReferenceRequest(undefined);
        setCallbacksOpen(false);
        setRequest({ origin: event.target.value });
      }}>{current.sources.map((origin) => <option key={origin}>{origin}</option>)}</select></label>
      <p className="muted">{evidence.batch ? `Most recently committed numbered export · ${evidence.basis.slice(0, 8)}` :
        `Most recent unnumbered import receipt · ${evidence.basis.slice(0, 8)}`}</p>
      <div className="details-grid">
        <div><span>Numbered batches received</span><strong>{evidence.batch ? `${evidence.batch.received} / ${evidence.batch.expected}` : "—"}</strong>
          {evidence.batch && <small>{evidence.batch.skipped} skipped · {evidence.batch.suppressed} suppressed at import</small>}</div>
        <div><span>CRM source links</span><strong>{evidence.links}</strong>
          <small className="block">{recordCounts(evidence.byType)}</small>
          <small className="block">{evidence.undone} undo {evidence.undone === 1 ? "row" : "rows"} awaiting reimport</small></div>
        <div><span>Linked 1003 drafts</span><strong>{evidence.draftCount}</strong><small>Across imports from this source</small></div>
      </div>
      {evidence.batch && evidence.batch.received < evidence.batch.expected && <p role="status">Import the remaining numbered batches before reconciling the source.</p>}
      <section className="record-form" aria-label="Cutover readiness">
        <CutoverReadinessOverview evidence={evidence} disabled={disabled} downloading={downloading} downloadHandoff={() => void downloadHandoff()}
          showDrafts={showLinkedFiles} />
        <CutoverReferenceLookup key={evidence.origin} disabled={disabled} reference={referenceRequest?.reference} loading={!!referenceRequest && !lookup}
          error={lookup && "error" in lookup ? lookup.error : undefined} clear={showLinkedFiles} find={(reference) => {
            setNotice(undefined);
            setSelectedLoanId(undefined);
            if (request.origin !== evidence.origin) setRequest({ ...request, origin: evidence.origin });
            setReferenceRequest({ reference });
          }} />
        {locatedDraft && <section aria-label="Located cutover file">
          <ul className="document-list">{fileCard(locatedDraft, evidence.basis, true)}</ul>
        </section>}
        {!referenceRequest && (evidence.draftCount > 0 || request.after) && <details className="document-form" open={draftsOpen} onToggle={(event) => setDraftsOpen(event.currentTarget.open)}>
          <summary ref={draftDisclosure}>Linked 1003 drafts</summary>
          <ul className="document-list">{evidence.drafts.map((draft) => fileCard(draft, evidence.basis))}</ul>
          <div className="loan-application-actions">
            {request.after && <Button size="sm" variant="outline" disabled={disabled} onClick={() => pageDrafts()}>First linked drafts</Button>}
            {evidence.draftNext && <Button size="sm" variant="outline" disabled={disabled} onClick={() => pageDrafts(evidence.draftNext ?? undefined)}>Next linked drafts</Button>}
          </div>
        </details>}
      </section>
      <CallbackSignoff callbacks={evidence.callbacks} review={evidence.reviews.find(({ item }) => item === cutoverCallbackItem)}
        complete={!!evidence.batch && evidence.batch.expected > 0 && evidence.batch.received === evidence.batch.expected} disabled={disabled} after={request.callbackAfter}
        page={(callbackAfter) => setRequest({ ...request, origin: evidence.origin, callbackAfter })}
        brokerageId={brokerageId} origin={evidence.origin} openRecord={openRecord}
        record={(revision, fields) => void record(cutoverCallbackItem, revision, fields)} expanded={callbacksOpen} setExpanded={setCallbacksOpen} />
      <div className="section-heading"><h3>Source reconciliation</h3><span className="pill">{reviewCount(evidence.reviews)}</span></div>
      <p className="muted">These notes record your review of the fictional cutover. Use sample references and keep borrower details out of notes.</p>
      <CutoverReviewList reviews={evidence.reviews} basis={evidence.basis} disabled={disabled} record={(item, revision, fields) => void record(item, revision, fields)} />
    </>}
  </section>;
}

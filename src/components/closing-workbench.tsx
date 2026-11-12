"use client";

import { useRef, useState, type FormEvent } from "react";
import { CalendarCheck, CheckCircle2, Plus, RotateCcw } from "lucide-react";
import { dateLabel, easternDate } from "@/lib/client-retention";
import type { ClosingGatePhase } from "@/lib/closing-gate-model";
import type { ClosingPacketWork } from "@/lib/closing-packet-model";
import { closingServiceEvidenceLimit, type ClosingServiceEvidence } from "@/lib/closing-service-evidence-model";
import { disclosurePackageStatus, disclosureTarget, type ClosingDisclosureReview, type DisclosureWork } from "@/lib/disclosure-model";
import { closingDisclosureReviewTarget } from "@/lib/file-preflight-model";
import { closingChecklistListTarget, closingChecklistTarget, closingWorkbenchTarget, pausedLoan, reopenedMockClosingMessage } from "@/lib/loan-workflow";
import { currentManualAcknowledgmentRequired } from "@/lib/lender-export-model";
import { serviceOrderSlug, serviceOrderTarget, type ServiceOrder } from "@/lib/service-order-model";
import { serviceOrderPdf } from "@/lib/service-order-pdf";
import { disclosureStatuses, fundingReversalStage, type ClosingItem, type DraftAudience, type Loan, type Workspace } from "@/lib/model";
import { feeAllocationLabel, feeLabels } from "@/lib/quote-worksheet";
import { dateTime } from "@/lib/utils";
import { ClosingGateEvidence, useLoanClosingGates } from "./closing-gates";
import { SavedDisclosureTermChanges } from "./disclosure-term-changes";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: () => void) => Promise<void>;

function ClosingPacketExports({ loanId, brokerageId, packets, disclosures, busy, save }: {
  loanId: string; brokerageId: string; packets?: ClosingPacketWork; disclosures?: DisclosureWork; busy: boolean; save: Save;
}) {
  const [downloading, setDownloading] = useState<number>();
  const [downloadError, setDownloadError] = useState("");
  if (!packets || (!packets.canPrepare && !packets.packets.length)) return null;
  const confirmation = disclosures?.closingReviews.find(({ current }) => current);
  const [latest, ...prior] = packets.packets;
  async function downloadVersion(version: number) {
    setDownloading(version);
    setDownloadError("");
    try {
      const query = new URLSearchParams({ brokerage: brokerageId, loanId, version: String(version) });
      const result = await fetch(`/api/closing-packet?${query}`);
      if (!result.ok || !result.headers.get("Content-Type")?.startsWith("application/pdf")) {
        setDownloadError("Could not download this sample packet. Refresh the loan and try again.");
        return;
      }
      downloadSampleFile(await result.blob(), `orbit-sample-closing-packet-v${version}.pdf`);
    } catch {
      setDownloadError("Could not download this sample packet. Try again.");
    } finally {
      setDownloading(undefined);
    }
  }
  const download = (packet: NonNullable<typeof latest>) => <div>
    <p>Packet v{packet.version} · Disclosure v{packet.disclosureVersion} · {packet.current ? "Current snapshot" : "Prior snapshot"}</p>
    <p className="muted">Prepared by {packet.preparedBy} · {dateTime(packet.preparedAt)} ET</p>
    <Button size="sm" variant="outline" className="min-h-11" disabled={downloading !== undefined} onClick={() => void downloadVersion(packet.version)}>
      {downloading === packet.version ? "Downloading…" : `Download sample closing packet v${packet.version}`}
    </Button>
  </div>;
  return <section className="document-item" aria-label="Sample closing packets">
    <div className="document-item-head"><strong>Sample closing packet</strong><span className="pill">Internal PDF</span></div>
    <p className="muted">Save the confirmed mock receipts, critical dates, and closing checklist as a versioned staff copy.</p>
    {latest && !packets.canPrepare && <p role="status">Confirm the current signed package in this loan before preparing a new closing packet. Prior downloads remain available.</p>}
    {downloadError && <p role="alert">{downloadError}</p>}
    {confirmation && !latest?.current && <div><Button size="sm" disabled={busy} onClick={() => void save({
      type: "prepareClosingPacket", loanId, previousVersion: latest?.version ?? null,
      disclosureVersion: confirmation.version, disclosureRevision: confirmation.revision,
    })}>{latest ? "Prepare updated sample closing packet" : "Prepare sample closing packet"}</Button></div>}
    {latest && download(latest)}
    {prior.length > 0 && <details className="document-form">
      <summary>Earlier sample closing packets</summary>
      {prior.map((packet) => <div key={packet.version}>{download(packet)}</div>)}
    </details>}
  </section>;
}

function ClosingDisclosureEvidence({ loan, work, busy, save, open }: {
  loan: Loan; work?: DisclosureWork; busy: boolean; save: Save; open: (target: string) => void;
}) {
  const item = work?.packages[0];
  if (!work || !item) return null;
  const { revisionReason, closingReviews } = work;
  const status = disclosurePackageStatus(item);
  const review = closingReviews.find((entry) => entry.current);
  const past = closingReviews.filter((entry) => !entry.current);
  const active = (!loan.disposition || loan.disposition === "Active") && loan.stage !== "Funded" && loan.stage !== "Closed";
  const signerRows = (signers: ClosingDisclosureReview["signers"]) => <ul>
    {signers.map(({ role, status, receipt }) => <li key={role}>{role} · {status}{receipt && ` · ${receipt}`}</li>)}
  </ul>;
  const reviewSummary = (entry: ClosingDisclosureReview) => <>
    <p>1003 revision {entry.applicationRevision} · Fee worksheet revision {entry.feeRevision}</p>
    <p>Confirmed by {entry.actor} · {dateTime(entry.at)} ET</p>
    {signerRows(entry.signers)}
    {!!entry.feeAllocations?.length && <ul aria-label="Sample fee allocations">
      {entry.feeAllocations.map((line) => <li key={line.key}>{feeLabels[line.key]} · {feeAllocationLabel(line)}</li>)}
    </ul>}
    {entry.changeReview && <>
      <p>Change review by {entry.changeReview.actor} · {entry.changeReview.reason} · {entry.changeReview.note}</p>
      <SavedDisclosureTermChanges changes={entry.changeReview.changes} legacyChanges={entry.legacyChanges} />
    </>}
  </>;
  return <section className="document-item" id={closingDisclosureReviewTarget} tabIndex={-1} aria-label="Sample disclosures for closing">
    <div className="document-item-head"><strong>Sample disclosures for closing</strong><span className="pill">Mock evidence</span></div>
    <p>Package v{item.version} · {review ? "Confirmed for closing handoff" : revisionReason ? "Review required" : status}</p>
    {review ? reviewSummary(review) : <>
      {past.length > 0 && <div className="work-queue">
        <strong>Closing review reopened</strong>
        <p>{revisionReason ?? (status === "Mock signing complete" ? "Confirm the signed replacement package for closing." :
          status === "Draft" ? "Issue the replacement sample package and collect the mock signatures." :
            status === "Declined" ? "Follow up on the declined sample package." : "Collect the remaining mock signatures.")}</p>
        <p className="muted">Prior confirmation · Package v{past[0].version} · {past[0].actor}</p>
      </div>}
      <p>1003 revision {item.applicationRevision} · Fee worksheet revision {item.feeRevision}</p>
      {signerRows(item.signers)}
      {item.changeReview && <div className="record-form">
        <p><strong>Changes recorded for package v{item.version}</strong></p>
        <SavedDisclosureTermChanges changes={item.changeReview.changes} legacyChanges={item.legacyChanges} />
      </div>}
      {active && status === "Mock signing complete" && !revisionReason && <div>
        <Button size="sm" className="min-h-11" disabled={busy} onClick={() => void save({ type: "confirmClosingDisclosure", loanId: loan.id,
          version: item.version, revision: item.revision })}>Confirm sample package for closing</Button>
      </div>}
    </>}
    <div><Button size="sm" variant="outline" className="min-h-11" onClick={() => open(disclosureTarget)}>Open disclosure package</Button></div>
    {past.length > 0 && <details className="document-form">
      <summary>Previous closing disclosure reviews</summary>
      {past.map((entry) => <div key={`${entry.version}:${entry.revision}`}>
        <strong>Package v{entry.version} · Prior evidence</strong>
        {reviewSummary(entry)}
      </div>)}
    </details>}
  </section>;
}

function ClosingItemForm({ loan, item, targetDate, busy, save }: {
  loan: Loan; item?: ClosingItem; targetDate?: string; busy: boolean; save: Save;
}) {
  const pendingId = useRef<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const itemId = item?.id ?? (pendingId.current ??= crypto.randomUUID());
    void save({ type: "saveClosingItem", loanId: loan.id, itemId, revision: item?.revision ?? 0,
      title: data.get("title"), owner: data.get("owner"), dueDate: data.get("dueDate"),
    }, () => {
      pendingId.current = null;
      form.reset();
      form.closest("details")?.removeAttribute("open");
    });
  }

  return <details className="document-form">
    <summary>{item ? "Edit item" : <><Plus size={15} /> Add closing item</>}</summary>
    <form onSubmit={submit}>
      <label className="field">Checklist item<input name="title" required maxLength={120} defaultValue={item?.title} placeholder="e.g. Confirm signing appointment" /></label>
      <label className="field">Owner<input name="owner" required maxLength={120} defaultValue={item?.owner ?? loan.officer} /></label>
      <label className="field">Due date<input name="dueDate" type="date" required defaultValue={item?.dueDate ?? targetDate} /></label>
      <Button type="submit" size="sm" disabled={busy}>{item ? "Save changes" : "Add to closing checklist"}</Button>
    </form>
  </details>;
}

function ClosingServiceLinks({ item, links, orders, editable, busy, save, open }: {
  item: ClosingItem; links: ClosingServiceEvidence[]; orders: ServiceOrder[]; editable: boolean; busy: boolean;
  save: Save; open: (target: string) => void;
}) {
  const choices = orders.flatMap((order) => order.status !== "Completed" ? [] : order.returns.filter((receipt) =>
    receipt.review?.decision === "Accepted" && !links.some((link) => link.reference === receipt.reference))
    .map((receipt) => ({ order, receipt })));
  const canLink = editable && links.length < closingServiceEvidenceLimit && choices.length > 0;
  if (!links.length && !canLink) return null;
  function change(orderId: string, reference: string, linked: boolean) {
    void save({ type: "setClosingServiceEvidence", loanId: item.loanId, itemId: item.id, itemRevision: item.revision, orderId, reference, linked });
  }
  return <div className="document-section">
    {links.length > 0 && <ul className="document-list" aria-label="Linked sample service evidence">{links.map((link) =>
      <li className="document-item" key={link.reference}>
        <strong>{link.kind}{link.recipient && ` · ${link.recipient}`} · Accepted sample return</strong>
        <p className="muted">{link.reference}</p>
        <p className="muted">Accepted by {link.acceptedBy} · {dateTime(link.acceptedAt)} ET</p>
        <p className="muted">Linked by {link.linkedBy} · {dateTime(link.linkedAt)} ET</p>
        <div className="loan-application-actions">
          <Button size="sm" variant="outline" onClick={() => downloadSampleFile(serviceOrderPdf(link.kind, link, link.recipient),
            `orbit-sample-${serviceOrderSlug(link.kind)}-${link.reference.slice(-15).toLowerCase()}.pdf`, "application/pdf")}>Download linked PDF</Button>
          <Button size="sm" variant="outline" onClick={() => open(serviceOrderTarget(link.orderId))}>Open service order</Button>
          {editable && <Button size="sm" variant="ghost" disabled={busy} onClick={() => change(link.orderId, link.reference, false)}>Unlink evidence</Button>}
        </div>
      </li>)}</ul>}
    {canLink && <details className="document-form">
      <summary>Link accepted service evidence</summary>
      <form onSubmit={(event) => {
        event.preventDefault();
        const reference = new FormData(event.currentTarget).get("reference");
        const choice = choices.find(({ receipt }) => receipt.reference === reference);
        if (choice) change(choice.order.id, choice.receipt.reference, true);
      }}>
        <label className="field">Accepted sample return<select name="reference" required defaultValue="" disabled={busy}>
          <option value="" disabled>Choose a sample return</option>
          {choices.map(({ order, receipt }) => <option key={receipt.reference} value={receipt.reference}>
            {order.kind}{order.recipient && ` · ${order.recipient}`} · {dateTime(receipt.returnedAt)} ET · {receipt.reference.slice(-15)}
          </option>)}
        </select></label>
        <div><Button size="sm" type="submit" disabled={busy}>Link sample return</Button></div>
      </form>
    </details>}
  </div>;
}

export function ClosingWorkbench({ loan, state, busy, save, preview, canReverseFunding, canRehearseFailure, canMarkClearToClose, manualClearance, borrowerCheckIn,
  advanceDemoToFunding, reopenedCondition, openCondition, brokerageId, manualHandoff }: {
  loan: Loan; state: Workspace; busy: boolean; save: Save; preview: (audience: DraftAudience, draftId: string) => void;
  brokerageId: string;
  canReverseFunding: boolean; canRehearseFailure: boolean; canMarkClearToClose: boolean;
  manualClearance: boolean;
  borrowerCheckIn?: { dueAt: string; open: () => void };
  advanceDemoToFunding?: () => void;
  reopenedCondition: { category: string; target: string } | null;
  manualHandoff: { title: string; target: string } | null;
  openCondition: (target: string) => void;
}) {
  const actualInput = useRef<HTMLInputElement>(null);
  const fundingInput = useRef<HTMLInputElement>(null);
  const target = state.closingPlans.find((plan) => plan.loanId === loan.id)?.targetDate;
  const profile = state.pastClients.find((item) => item.loanId === loan.id);
  const actual = profile?.closingDate;
  const progress = state.closingProgress.find((item) => item.loanId === loan.id);
  const items = state.closingItems.filter((item) => item.loanId === loan.id);
  const orders = (state.serviceOrders ?? []).filter((item) => item.loanId === loan.id);
  const editServiceEvidence = state.closingServiceEvidence !== undefined && !pausedLoan(loan) &&
    loan.stage !== "Funded" && loan.stage !== "Closed";
  const drafts = state.communicationDrafts.filter((draft) => draft.loanId === loan.id && draft.milestone === "Closing complete");
  const borrowerDraft = drafts.find((draft) => draft.audience === "Borrower" && draft.contactId === loan.contactId);
  const realtorDraft = drafts.find((draft) => draft.audience === "Realtor" && draft.contactId === loan.partnerId);
  const today = easternDate();
  const outstanding = items.filter((item) => !item.completedAt).length;
  const gates = useLoanClosingGates(brokerageId, loan.id, state);
  const [overrides, setOverrides] = useState<Partial<Record<ClosingGatePhase, { key: string; reason: string }>>>({});
  const closingCheck = !actual ? gates.work?.closing : undefined;
  const fundingCheck = actual && !progress?.fundingDate ? gates.work?.funding : undefined;
  const closingReason = overrideFor("closing");
  const fundingReason = overrideFor("funding");
  const closingBlocked = !actual && (Boolean(reopenedCondition || manualHandoff) || (!!closingCheck?.blockers.length && !closingReason));
  const fundingBlocked = !progress?.fundingDate && (Boolean(reopenedCondition || manualHandoff) || (!!fundingCheck?.blockers.length && !fundingReason));

  function overrideFor(phase: ClosingGatePhase) {
    const draft = overrides[phase];
    if (!reopenedCondition && !manualHandoff && gates.work?.canOverride && draft && draft.key === gates.work[phase].key && draft.reason.trim().length >= 8) return draft;
  }

  function overrideField(phase: ClosingGatePhase) {
    const key = gates.work?.[phase].key;
    if (!key || !gates.work?.canOverride || reopenedCondition || manualHandoff) return null;
    const draft = overrides[phase];
    return <details className="document-form" key={key}>
      <summary>Admin override for {phase}</summary>
      <p className="muted">Orbit records the reason and current evidence in the loan audit when you save.</p>
      <label className="field">Reason for {phase} override<textarea rows={2} minLength={8} maxLength={300}
        disabled={busy} value={draft?.key === key ? draft.reason : ""}
        onChange={(event) => { const reason = event.currentTarget.value; setOverrides((current) => ({ ...current, [phase]: { key, reason } })); }} /></label>
    </details>;
  }

  function fillToday(input: HTMLInputElement | null) {
    if (!input) return;
    input.value = today;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  return <section className="details-section document-section" aria-label="Closing workbench" id={closingWorkbenchTarget} tabIndex={-1}>
    <div className="section-heading"><h3><CalendarCheck size={17} /> Closing workbench</h3>{actual && <span className="pill">Closing recorded</span>}</div>
    {reopenedCondition && <div className="work-queue">
      <strong>Reopened {reopenedCondition.category.toLowerCase()} condition</strong>
      <p>{reopenedMockClosingMessage}</p>
      <div><Button size="sm" variant="outline" onClick={() => openCondition(reopenedCondition.target)}>Open reopened condition</Button></div>
    </div>}
    {manualHandoff && !progress?.fundingDate && <div className="work-queue" aria-label="Current lender handoff required">
      <strong>Current lender handoff required</strong>
      <p>{currentManualAcknowledgmentRequired}</p>
      <div><Button size="sm" variant="outline" onClick={() => openCondition(manualHandoff.target)}>{manualHandoff.title}</Button></div>
    </div>}
    {closingCheck && <ClosingGateEvidence phase="closing" check={closingCheck} open={openCondition} />}
    {fundingCheck && <ClosingGateEvidence phase="funding" check={fundingCheck} open={openCondition} />}
    {(gates.error || !!gates.work?.revision) && <div className="loan-application-actions">
      {gates.error && <p role="status">{gates.error}</p>}
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={gates.reload}>Refresh required checks</Button>
    </div>}
    {canMarkClearToClose && <div className="work-queue">
      <p className="muted">{manualClearance ? "Manual lender clearance recorded." : "Mock UWM conditions cleared."}{loan.partnerId && " Confirming updates the realtor milestone."}</p>
      <div><Button size="sm" disabled={busy} onClick={() => void save({ type: "markClearToClose", loanId: loan.id })}>Mark Clear to Close</Button></div>
    </div>}
    <div className="closing-dates">
      <form key={target ?? "no-target"} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save({ type: "saveClosingTarget", loanId: loan.id, targetDate: data.get("targetDate") || null, previous: target ?? null });
      }}>
        <label className="field">Target closing date<input type="date" name="targetDate" defaultValue={target} /></label>
        <Button size="sm" type="submit" variant="outline" disabled={busy}>Save target date</Button>
      </form>
      <form id="loan-closing-date" tabIndex={-1} key={actual ?? "no-actual"} onSubmit={(event) => {
        event.preventDefault();
        if (closingBlocked) return;
        const data = new FormData(event.currentTarget);
        void save({ type: "recordClosing", loanId: loan.id, closingDate: data.get("closingDate"), revision: profile?.revision ?? 0,
          gateOverride: closingReason },
          actual ? undefined : advanceDemoToFunding);
      }}>
        {!actual && overrideField("closing")}
        <label className="field">Actual closing date<input ref={actualInput} type="date" name="closingDate" required max={today}
          defaultValue={actual ?? undefined} disabled={closingBlocked} /></label>
        <div className="loan-application-actions">
          {advanceDemoToFunding && !actual && <Button size="sm" type="button" variant="ghost" disabled={busy || closingBlocked}
            onClick={() => fillToday(actualInput.current)}>Use today for closing</Button>}
          <Button size="sm" type="submit" variant="outline" disabled={busy || closingBlocked}>{actual ? "Save closing date" : "Record closing"}</Button>
        </div>
      </form>
      {actual && <form id="loan-funding" tabIndex={-1} key={progress?.revision ?? 0} onSubmit={(event) => {
        event.preventDefault();
        if (fundingBlocked) return;
        const data = new FormData(event.currentTarget);
        void save({ type: "recordFunding", loanId: loan.id, fundingDate: data.get("fundingDate"), revision: progress?.revision ?? 0,
          simulateFollowUpFailure: data.has("simulateFollowUpFailure"), gateOverride: fundingReason });
      }}>
        {!progress?.fundingDate && overrideField("funding")}
        <label className="field">Funding date<input ref={fundingInput} name="fundingDate" type="date" required min={actual} max={today}
          defaultValue={progress?.fundingDate ?? ""} disabled={fundingBlocked} /></label>
        <div className="loan-application-actions">
          {advanceDemoToFunding && !progress?.fundingDate && <Button size="sm" type="button" variant="ghost" disabled={busy || fundingBlocked}
            onClick={() => fillToday(fundingInput.current)}>Use today for funding</Button>}
          <Button size="sm" type="submit" variant="outline" disabled={busy || fundingBlocked}>{progress?.fundingDate ? "Save funding date" : "Record funding"}</Button>
        </div>
        {canRehearseFailure && <details className="document-form"><summary>Rehearse follow-up recovery</summary>
          <label><input type="checkbox" name="simulateFollowUpFailure" /> Simulate a follow-up failure for this funding change</label>
        </details>}
      </form>}
    </div>
    {borrowerCheckIn && <div className="document-item" role="group" aria-label="Post-funding borrower check-in">
      <div className="document-item-head"><strong>Borrower check-in</strong><span className="pill">Post-funding follow-up</span></div>
      <p className="muted">{loan.officer || "Unassigned"} · Due {dateTime(borrowerCheckIn.dueAt)} ET</p>
      <p className="muted">The loan owner can also find this in Tasks under Playbook tasks.</p>
      <div><Button size="sm" disabled={busy} onClick={borrowerCheckIn.open}>Record borrower check-in</Button></div>
    </div>}
    {canReverseFunding && progress?.fundingDate && <details className="document-form" key={progress.revision}>
      <summary>Reverse funding recorded in error</summary>
      <p className="muted">Remove the funding entry dated {dateLabel(progress.fundingDate)} and return the file to {fundingReversalStage(loan.stage, progress.preFundingStage)}.
        Closing and disclosure records remain available. Pending post-funding follow-ups are removed.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        void save({ type: "reverseFunding", loanId: loan.id, fundingDate: progress.fundingDate, revision: progress.revision,
          reason: new FormData(event.currentTarget).get("reason") });
      }}>
        <label className="field">Reason for reversing funding<textarea name="reason" rows={2} maxLength={500} required /></label>
        <Button size="sm" type="submit" variant="outline" disabled={busy}>Reverse funding</Button>
      </form>
    </details>}
    <ClosingDisclosureEvidence loan={loan} work={state.disclosureWork} busy={busy} save={save} open={openCondition} />
    <ClosingPacketExports loanId={loan.id} brokerageId={brokerageId} packets={state.closingPacketWork} disclosures={state.disclosureWork} busy={busy} save={save} />
    <details className="document-form"><summary>Track disclosure and signature status</summary>
      <form key={progress?.revision ?? 0} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save({ type: "saveDisclosureStatus", loanId: loan.id, status: data.get("status"), date: data.get("date") || null, revision: progress?.revision ?? 0 });
      }}>
        <label className="field">Manual disclosure status<select name="status" defaultValue={progress?.disclosureStatus}>
          {disclosureStatuses.map((value) => <option key={value}>{value}</option>)}
        </select></label>
        <label className="field">Date completed<input name="date" type="date" max={today} defaultValue={progress?.disclosureDate ?? ""} /></label>
        <Button size="sm" type="submit" variant="outline" disabled={busy}>Save disclosure status</Button>
      </form>
      {progress?.disclosureDate && <p>{progress.disclosureStatus} · {dateLabel(progress.disclosureDate)}</p>}
    </details>
    {actual && <div className="loan-application-actions">
      {borrowerDraft && <Button size="sm" variant="outline" onClick={() => preview("Borrower", borrowerDraft.id)}>Preview borrower closing update</Button>}
      {realtorDraft && <Button size="sm" variant="outline" onClick={() => preview("Realtor", realtorDraft.id)}>Preview realtor closing update</Button>}
    </div>}
    <div className="section-heading" id={closingChecklistListTarget} tabIndex={-1}><h4>Closing checklist</h4><span className="pill">{outstanding} outstanding</span></div>
    <details className="document-form"><summary>Prepare LO and processor handoff</summary>
      <p className="muted">Set the checklist date. A brokerage admin can assign the file to its next owner from Team.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        void save({ type: "prepareClosingHandoff", loanId: loan.id, dueDate: new FormData(event.currentTarget).get("date") });
      }}>
        <label className="field">Handoff checklist due date<input name="date" type="date" required defaultValue={target ?? today} /></label>
        <Button size="sm" type="submit" variant="outline" disabled={busy}>Add handoff checklist</Button>
      </form>
    </details>
    <ClosingItemForm loan={loan} targetDate={target} busy={busy} save={save} />
    {items.length ? <ul className="document-list">{items.map((item) => <li className="document-item" id={closingChecklistTarget(item.id)} tabIndex={-1} key={`${item.id}:${item.revision}`}>
      <div className="document-item-head"><strong>{item.title}</strong><span className="pill">{item.completedAt ? "Complete" : item.dueDate < today ? "Overdue" : "Open"}</span></div>
      <p className="muted">{item.owner} · Due {dateLabel(item.dueDate)}</p>
      <div className="loan-application-actions">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "completeClosingItem", loanId: loan.id, itemId: item.id,
          revision: item.revision, completed: !item.completedAt,
        })}>{item.completedAt ? <><RotateCcw /> Reopen</> : <><CheckCircle2 /> Mark complete</>}</Button>
        <ClosingItemForm loan={loan} item={item} busy={busy} save={save} />
      </div>
      <ClosingServiceLinks item={item} orders={orders} links={(state.closingServiceEvidence ?? []).filter((link) => link.itemId === item.id)}
        editable={editServiceEvidence} busy={busy} save={save} open={openCondition} />
    </li>)}</ul> : <p className="empty-inline">Add the items your team needs to finish before closing.</p>}
  </section>;
}

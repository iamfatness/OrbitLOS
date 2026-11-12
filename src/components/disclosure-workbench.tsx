"use client";

import { ClipboardList } from "lucide-react";
import { useState } from "react";
import { dateLabel, easternDate } from "@/lib/client-retention";
import type { DisclosureDeadline } from "@/lib/disclosure-calendar-model";
import { disclosurePackageStatus, disclosureResponses, disclosureTarget,
  type DisclosurePackage } from "@/lib/disclosure-model";
import { compareDisclosureTerms } from "@/lib/disclosure-change-model";
import { reviewTarget } from "@/lib/loan-review-model";
import type { Loan, Workspace } from "@/lib/model";
import { latestSelectedPricingRun, pricingInputsMatch } from "@/lib/pricing-model";
import { feeKeys, feeLabels, sampleFeeLabel, type QuoteOption } from "@/lib/quote-worksheet";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";
import { FeeWorksheetEditor } from "./quote-worksheet";
import { LoanStageEditNotice, useLoanStageEdit } from "./loan-stage-edits";
import { DisclosurePackageDocuments } from "./disclosure-templates";
import { DisclosureTermChanges, SavedDisclosureTermChanges } from "./disclosure-term-changes";
import type { WorkspaceMutationSuccess } from "@/lib/commands";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const cents = (value: number | null | undefined) => value == null ? "Not entered" : usd.format(value / 100);
const stamp = (value?: string | null) => value ? `${dateTime(value)} ET` : "Pending";

function DeclineFollowUp({ item }: { item: DisclosurePackage }) {
  const followUp = item.declineFollowUp;
  return followUp && <div>
    <strong>Decline follow-up recorded</strong>
    <p>{followUp.note}</p>
    <p className="muted">{followUp.actor} · {stamp(followUp.at)}</p>
  </div>;
}

function QuoteDetails({ quote }: { quote: QuoteOption }) {
  return <>
    <p>{quote.product} · {quote.rate.toFixed(3)}% · {money(quote.loanAmount)}</p>
    {quote.estimate && <>
      <p>Estimated closing costs {cents(quote.estimate.closingCosts)} · Estimated cash to close {cents(quote.estimate.cashToClose)}</p>
      <ul>{feeKeys.map((key) => <li key={key}>{feeLabels[key]} · {sampleFeeLabel(quote.estimate?.inputs, key)}</li>)}</ul>
    </>}
  </>;
}

function ChangeReview({ item }: { item: DisclosurePackage }) {
  const review = item.changeReview;
  return review && <div>
    <strong>Change review from version {review.fromVersion} · {review.reason}</strong>
    <p>{review.note}</p>
    <p className="muted">{review.actor} · {stamp(review.at)}</p>
    <SavedDisclosureTermChanges changes={review.changes} legacyChanges={item.legacyChanges} />
  </div>;
}

function PackagePreview({ item }: { item: DisclosurePackage }) {
  return <details className="document-form">
    <summary>Preview sample package v{item.version}</summary>
    <div className="record-form">
      <p>Reviewed 1003 revision {item.applicationRevision} · Fee worksheet revision {item.feeRevision}</p>
      {item.templateBasis && <p><strong>{item.templateBasis.title} · Template v{item.templateBasis.revision}</strong> · {item.templateBasis.purpose}
        {" · "}{item.templateBasis.propertyState || "Any property state"}</p>}
      <p>Sample signing target {dateLabel(item.signBy)} · {item.deadlineBasis ? `Brokerage calendar v${item.deadlineBasis.version}` : "Manual date"}</p>
      {item.deadlineBasis && <p className="muted">{item.deadlineBasis.days} open days after {dateLabel(item.deadlineBasis.anchorOn)}.
        {item.deadlineBasis.skipped.length > 0 && ` Skipped ${item.deadlineBasis.skipped.map(({ on, label }) => `${dateLabel(on)} · ${label}`).join(", ")}.`}</p>}
      <ul>{item.documents.map((document) => <li key={document}>{document}</li>)}</ul>
      <QuoteDetails quote={item.quote} />
    </div>
  </details>;
}

function SigningTarget({ current, suggestion, today, busy, refresh }: {
  current?: DisclosurePackage; suggestion?: DisclosureDeadline; today: string; busy: boolean; refresh?: () => void;
}) {
  const [choice, setChoice] = useState<string>();
  const mode = suggestion ? choice ?? (current && !current.deadlineBasis ? "manual" : "calendar") : "manual";
  return <div className="record-form">
    <label className="field">Signing target basis<select name="dateBasis" value={mode} disabled={busy}
      onChange={(event) => setChoice(event.target.value)}>
      <option value="calendar" disabled={!suggestion}>Brokerage calendar</option><option value="manual">Manual date</option>
    </select></label>
    {mode === "calendar" && suggestion ? <>
      <input type="hidden" name="signBy" value={suggestion.signBy} />
      <p><strong>Suggested signing target {dateLabel(suggestion.signBy)}</strong> · Brokerage calendar v{suggestion.version}</p>
      <p className="muted">{suggestion.days} open days after {dateLabel(suggestion.anchorOn)}{suggestion.skipped.length > 0 &&
        ` · Skipped ${suggestion.skipped.map(({ on, label }) => `${dateLabel(on)} · ${label}`).join(", ")}`}</p>
      {suggestion.anchorOn !== today && <p>Refresh the loan to calculate the date from today.</p>}
    </> : <label className="field">Sample signing target<input name="signBy" type="date" min={today} required
      defaultValue={current && current.signBy >= today ? current.signBy : today} /></label>}
    {!suggestion && <p className="muted">Refresh the loan to check for a calendar suggestion.</p>}
    {refresh && <div><Button size="sm" variant="outline" disabled={busy} onClick={refresh}>Refresh signing target</Button></div>}
  </div>;
}

export function DisclosureWorkbench({ loan, state, busy, readOnly, brokerageId, save, open, refresh }: {
  loan: Loan; state: Workspace; busy: boolean; readOnly?: boolean; save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
  open: (target: string) => void; refresh?: () => void; brokerageId: string;
}) {
  const work = state.disclosureWork;
  const [current, ...previous] = work?.packages ?? [];
  const status = current && disclosurePackageStatus(current);
  const app = state.applications.find(({ loanId }) => loanId === loan.id);
  const target = state.closingPlans.find(({ loanId }) => loanId === loan.id)?.targetDate;
  const funded = state.closingProgress.find(({ loanId }) => loanId === loan.id)?.fundingDate;
  const closed = state.pastClients.find(({ loanId }) => loanId === loan.id)?.closingDate;
  const editable = !readOnly && (!loan.disposition || loan.disposition === "Active") && loan.stage !== "Closed" && loan.stage !== "Funded";
  const feeEdits = useLoanStageEdit("fees", loan.id, loan.stage, brokerageId, save, editable);
  const today = easternDate();
  const source = work?.source;
  const run = latestSelectedPricingRun(state.pricingRuns, loan.id);
  const offer = run?.mode === "mock" ? run.offers.find(({ id }) => id === run.selectedId) : undefined;
  const worksheet = state.feeWorksheets.find((item) => item.runId === run?.id && item.offerId === offer?.id);
  const command = current ? { loanId: loan.id, version: current.version, revision: current.revision } : null;
  const declined = current?.signers.find(({ status }) => status === "Declined");
  const targetPassed = status === "Awaiting signatures" && current && current.signBy < today;
  const sourceChanged = current && source && (current.applicationRevision !== source.applicationRevision ||
    current.feeRevision !== source.feeRevision || current.quote.runId !== source.quote.runId || current.quote.offerId !== source.quote.offerId);
  const reviewReason = current?.reviewReason ?? (sourceChanged ? "Application or quote changed" : null);
  const needsChangeNote = Boolean(reviewReason);
  const shifted = work?.draftTargetChanged;
  const returned = work?.closingAssignment?.status === "Changes requested" ? work.closingAssignment : undefined;

  return <section className="details-section document-section" id={disclosureTarget} tabIndex={-1} aria-label="Disclosure and Critical Dates">
    <div className="section-heading"><h3><ClipboardList size={17} /> Disclosure &amp; Critical Dates</h3><span className="pill">Mock signing</span></div>
    <p className="muted">Assemble a sample package from the reviewed 1003 and saved quote. Signing activity stays in Orbit.</p>
    <div className="form-grid">
      <div><strong>1003 submitted</strong><p>{stamp(app?.submittedAt)}</p></div>
      <div><strong>1003 reviewed</strong><p>{stamp(app?.reviewedAt)}</p></div>
      <div><strong>Sample signing target</strong><p>{current ? dateLabel(current.signBy) : "Unscheduled"}{targetPassed && " · Past due"}</p>
        {current?.deadlineBasis && <small>Brokerage calendar v{current.deadlineBasis.version}</small>}</div>
      <div><strong>Closing target</strong><p>{target ? dateLabel(target) : "Unscheduled"}</p></div>
      {closed && <div><strong>Closing recorded</strong><p>{dateLabel(closed)}</p></div>}
      {funded && <div><strong>Funding recorded</strong><p>{dateLabel(funded)}</p></div>}
    </div>
    {!work && <p>{refresh ? <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>Load disclosure workbench</Button> :
      "Open this loan from Pipeline to load the disclosure workbench."}</p>}
    {current && reviewReason && <div className="work-queue">
      <strong>Review required · {reviewReason}</strong>
      {returned?.correctionReason && <div className="record-form">
        <p className="break-words">{returned.reviewerName} · {returned.correctionReason}</p>
        <div><Button size="sm" variant="outline" className="min-h-11" onClick={() => open(reviewTarget(returned.id))}>Open closing review</Button></div>
      </div>}
      <p>Review the updated terms and prepare a revised sample package to resolve the task. Prior responses stay with their version.</p>
      {source && <DisclosureTermChanges changes={compareDisclosureTerms(current, source)} />}
    </div>}
    {current && command && <section className="document-item" aria-label={`Sample disclosure package version ${current.version}`}>
      <div className="document-item-head"><strong>Sample package v{current.version}</strong><span className="pill">{status}</span></div>
      <p className="muted">Prepared {stamp(current.preparedAt)}{current.issuedAt && ` · Issued ${stamp(current.issuedAt)}`}</p>
      <ChangeReview item={current} />
      <PackagePreview item={current} />
      <ul className="loan-task-list">{current.signers.map((signer) => <li className="loan-task" key={signer.role}>
        <div className="loan-task-copy"><strong>{signer.role} · {signer.name}</strong>
          <span>{signer.status}{signer.actedAt && ` · ${stamp(signer.actedAt)}`}</span>
          {signer.receipt && <span>{signer.receipt}{signer.respondedVia && ` · ${signer.respondedVia}`}</span>}
        </div>
        {editable && source && !reviewReason && status === "Awaiting signatures" && signer.status === "Pending" &&
          <div className="loan-application-actions">{disclosureResponses.map((response) =>
            <Button key={response} size="sm" variant={response === "Signed" ? "default" : "outline"} disabled={busy}
              onClick={() => void save({ type: "respondToDisclosurePackage", ...command, signer: signer.role, response })}>
              {response === "Signed" ? "Simulate signature" : "Simulate decline"}
            </Button>)}</div>}
      </li>)}</ul>
      {targetPassed && <p className="muted">The signing target has passed. The pending mock responses remain available.</p>}
      {declined && <div className="work-queue">
        {current.declineFollowUp ? <DeclineFollowUp item={current} /> : <>
          <strong>Follow up with the {declined.role.toLowerCase()}</strong>
          <p>Record how you handled the decline, or prepare a revised sample package. This version retains the response and its receipt.</p>
          {editable && <form className="record-form" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void save({ type: "reviewDisclosureDecline", ...command, note: data.get("declineNote") });
          }}>
            <label className="field">Internal follow-up note<textarea name="declineNote" rows={2} required maxLength={500} /></label>
            <div><Button size="sm" type="submit" disabled={busy}>Record decline follow-up</Button></div>
          </form>}
        </>}
      </div>}
      {shifted && <p role="status">Calendar v{shifted.version} moves this draft’s target to {dateLabel(shifted.signBy)}. Prepare a revised package before issuing.</p>}
      {editable && source && !reviewReason && !shifted && status === "Draft" && <div><Button size="sm" disabled={busy}
        onClick={() => void save({ type: "issueDisclosurePackage", ...command })}>Issue sample package</Button></div>}
    </section>}
    {work && !source && <div className="work-queue">
      <p>{work.unavailable}</p>
      <div className="loan-application-actions">
        <Button size="sm" variant="outline" onClick={() => open("loan-application")}>Open 1003</Button>
        <Button size="sm" variant="outline" onClick={() => open("loan-pricing")}>Open Pricing &amp; credit</Button>
      </div>
    </div>}
    {editable && work && run && offer && <>
      <LoanStageEditNotice area="fees" control={feeEdits} busy={busy} />
      <FeeWorksheetEditor key={`${run.id}:${offer.id}:${worksheet?.revision ?? 0}`} run={run} offer={offer} saved={worksheet}
        busy={busy} save={feeEdits.save} stageBlocked={feeEdits.blocked} brokerageId={brokerageId} current={pricingInputsMatch(run, app)} />
    </>}
    {editable && source && work && <details className="document-form" open={!current || Boolean(reviewReason) || Boolean(declined) || Boolean(shifted)} key={current?.version ?? 0}>
      <summary>{current ? "Prepare revised sample package" : "Assemble sample package"}</summary>
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const suggestion = data.get("dateBasis") === "calendar" ? work.suggestedDeadline : undefined;
        const templateKey = String(data.get("disclosureTemplate") ?? "");
        const [id, revision] = templateKey.split(":");
        void save({ type: "prepareDisclosurePackage", loanId: loan.id, previousVersion: current?.version ?? null,
          applicationRevision: source.applicationRevision, feeRevision: source.feeRevision, runId: source.quote.runId,
          offerId: source.quote.offerId, documents: data.getAll("documents"), signBy: data.get("signBy"),
          ...(templateKey ? { template: { id, revision: Number(revision) } } : {}),
          ...(suggestion ? { deadlineCalendar: { version: suggestion.version, anchorOn: suggestion.anchorOn } } : {}),
          ...(needsChangeNote ? { reviewedPackageRevision: current?.revision, revisionNote: data.get("revisionNote") } : {}) });
      }}>
        <p>Reviewed 1003 revision {source.applicationRevision} · Fee worksheet revision {source.feeRevision} · {source.quote.product}</p>
        {needsChangeNote && <label className="field">Internal change-review note<textarea name="revisionNote" rows={2} required maxLength={500} /></label>}
        <SigningTarget current={current} suggestion={work.suggestedDeadline} today={today} busy={busy} refresh={refresh} />
        <DisclosurePackageDocuments options={work.templateOptions} current={current} busy={busy} />
        <Button size="sm" type="submit" disabled={busy}>{current ? "Prepare revised package" : "Prepare sample package"}</Button>
      </form>
    </details>}
    {previous.length > 0 && <section className="record-form" aria-label="Previous sample packages">
      <h4>Recent package history</h4>
      {previous.map((item) => <div className="document-item" key={item.version}>
        <p>v{item.version} · Superseded {stamp(item.supersededAt)}</p>
        <ul>{item.signers.map(({ role, status, actedAt, receipt, respondedVia }) => <li key={role}>
          {role} · {status}{actedAt && ` · ${stamp(actedAt)}`}{receipt && ` · ${receipt}`}{respondedVia && ` · ${respondedVia}`}
        </li>)}</ul>
        <DeclineFollowUp item={item} />
        <ChangeReview item={item} />
        <PackagePreview item={item} />
      </div>)}
    </section>}
  </section>;
}

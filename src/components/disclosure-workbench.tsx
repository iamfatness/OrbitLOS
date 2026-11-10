"use client";

import { ClipboardList } from "lucide-react";
import { dateLabel, easternDate } from "@/lib/client-retention";
import { disclosurePackageStatus, disclosureResponses, disclosureTarget, sampleDisclosureDocuments,
  type DisclosurePackage, type DisclosureSource } from "@/lib/disclosure-model";
import type { Loan, Workspace } from "@/lib/model";
import { latestSelectedPricingRun, pricingInputsMatch } from "@/lib/pricing-model";
import { feeKeys, feeLabels, type QuoteOption } from "@/lib/quote-worksheet";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";
import { FeeWorksheetEditor } from "./quote-worksheet";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const cents = (value: number | null | undefined) => value == null ? "Not entered" : usd.format(value / 100);
const stamp = (value?: string | null) => value ? `${dateTime(value)} ET` : "Pending";

function QuoteDetails({ quote }: { quote: QuoteOption }) {
  return <>
    <p>{quote.product} · {quote.rate.toFixed(3)}% · {money(quote.loanAmount)}</p>
    {quote.estimate && <>
      <p>Estimated closing costs {cents(quote.estimate.closingCosts)} · Estimated cash to close {cents(quote.estimate.cashToClose)}</p>
      <ul>{feeKeys.map((key) => <li key={key}>{feeLabels[key]} · {cents(quote.estimate?.inputs.fees[key])}</li>)}</ul>
    </>}
  </>;
}

function FeeChanges({ previous, current }: { previous: DisclosurePackage; current: DisclosureSource }) {
  const old = previous.quote.estimate;
  const next = current.quote.estimate;
  if (!old || !next || previous.quote.runId !== current.quote.runId || previous.quote.offerId !== current.quote.offerId) return null;
  const changes: { title: string; before: number | null; after: number | null }[] = feeKeys.filter((key) => old.inputs.fees[key] !== next.inputs.fees[key])
    .map((key) => ({ title: feeLabels[key], before: old.inputs.fees[key], after: next.inputs.fees[key] }));
  if (old.cashToClose !== next.cashToClose) changes.push({ title: "Estimated cash to close", before: old.cashToClose, after: next.cashToClose });
  return changes.length ? <ul>{changes.map(({ title, before, after }) =>
    <li key={title}>{title} · {cents(before)} → {cents(after)}</li>)}</ul> : null;
}

function PackagePreview({ item }: { item: DisclosurePackage }) {
  return <details className="document-form">
    <summary>Preview sample package v{item.version}</summary>
    <div className="record-form">
      <p>Reviewed 1003 revision {item.applicationRevision} · Fee worksheet revision {item.feeRevision}</p>
      <ul>{item.documents.map((document) => <li key={document}>{document}</li>)}</ul>
      <QuoteDetails quote={item.quote} />
    </div>
  </details>;
}

export function DisclosureWorkbench({ loan, state, busy, readOnly, brokerageId, save, open, refresh }: {
  loan: Loan; state: Workspace; busy: boolean; readOnly?: boolean; save: (input: unknown) => Promise<void>;
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
  const today = easternDate();
  const source = work?.source;
  const run = latestSelectedPricingRun(state.pricingRuns, loan.id);
  const offer = run?.mode === "mock" ? run.offers.find(({ id }) => id === run.selectedId) : undefined;
  const worksheet = state.feeWorksheets.find((item) => item.runId === run?.id && item.offerId === offer?.id);
  const command = current ? { loanId: loan.id, version: current.version, revision: current.revision } : null;

  return <section className="details-section document-section" id={disclosureTarget} tabIndex={-1} aria-label="Disclosure and Critical Dates">
    <div className="section-heading"><h3><ClipboardList size={17} /> Disclosure &amp; Critical Dates</h3><span className="pill">Mock signing</span></div>
    <p className="muted">Assemble a sample package from the reviewed 1003 and saved quote. Signing activity stays in Orbit.</p>
    <div className="form-grid">
      <div><strong>1003 submitted</strong><p>{stamp(app?.submittedAt)}</p></div>
      <div><strong>1003 reviewed</strong><p>{stamp(app?.reviewedAt)}</p></div>
      <div><strong>Sample signing target</strong><p>{current ? dateLabel(current.signBy) : "Unscheduled"}</p></div>
      <div><strong>Closing target</strong><p>{target ? dateLabel(target) : "Unscheduled"}</p></div>
      {closed && <div><strong>Closing recorded</strong><p>{dateLabel(closed)}</p></div>}
      {funded && <div><strong>Funding recorded</strong><p>{dateLabel(funded)}</p></div>}
    </div>
    {!work && <p>{refresh ? <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>Load disclosure workbench</Button> :
      "Open this loan from Pipeline to load the disclosure workbench."}</p>}
    {current?.reviewReason && <div className="work-queue">
      <strong>Review required · {current.reviewReason}</strong>
      <p>Review the updated terms and prepare a revised sample package to resolve the task. Prior responses stay with their version.</p>
      {source && <FeeChanges previous={current} current={source} />}
    </div>}
    {current && command && <section className="document-item" aria-label={`Sample disclosure package version ${current.version}`}>
      <div className="document-item-head"><strong>Sample package v{current.version}</strong><span className="pill">{status}</span></div>
      <p className="muted">Prepared {stamp(current.preparedAt)}{current.issuedAt && ` · Issued ${stamp(current.issuedAt)}`}</p>
      <PackagePreview item={current} />
      <ul className="loan-task-list">{current.signers.map((signer) => <li className="loan-task" key={signer.role}>
        <div className="loan-task-copy"><strong>{signer.role} · {signer.name}</strong>
          <span>{signer.status}{signer.actedAt && ` · ${stamp(signer.actedAt)}`}</span>
          {signer.receipt && <span>{signer.receipt}{signer.respondedVia && ` · ${signer.respondedVia}`}</span>}
        </div>
        {editable && source && status === "Awaiting signatures" && signer.status === "Pending" &&
          <div className="loan-application-actions">{disclosureResponses.map((response) =>
            <Button key={response} size="sm" variant={response === "Signed" ? "default" : "outline"} disabled={busy}
              onClick={() => void save({ type: "respondToDisclosurePackage", ...command, signer: signer.role, response })}>
              {response === "Signed" ? "Simulate signature" : "Simulate decline"}
            </Button>)}</div>}
      </li>)}</ul>
      {editable && source && status === "Draft" && <div><Button size="sm" disabled={busy}
        onClick={() => void save({ type: "issueDisclosurePackage", ...command })}>Issue sample package</Button></div>}
    </section>}
    {work && !source && <div className="work-queue">
      <p>{work.unavailable}</p>
      <div className="loan-application-actions">
        <Button size="sm" variant="outline" onClick={() => open("loan-application")}>Open 1003</Button>
        <Button size="sm" variant="outline" onClick={() => open("loan-pricing")}>Open Pricing &amp; credit</Button>
      </div>
    </div>}
    {editable && work && run && offer && <FeeWorksheetEditor key={`${run.id}:${offer.id}:${worksheet?.revision ?? 0}`}
      run={run} offer={offer} saved={worksheet} busy={busy} save={save} brokerageId={brokerageId} current={pricingInputsMatch(run, app)} />}
    {editable && source && <details className="document-form" open={!current || Boolean(current.reviewReason)} key={current?.version ?? 0}>
      <summary>{current ? "Prepare revised sample package" : "Assemble sample package"}</summary>
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void save({ type: "prepareDisclosurePackage", loanId: loan.id, previousVersion: current?.version ?? null,
          applicationRevision: source.applicationRevision, feeRevision: source.feeRevision, runId: source.quote.runId,
          offerId: source.quote.offerId, documents: data.getAll("documents"), signBy: data.get("signBy") });
      }}>
        <p>Reviewed 1003 revision {source.applicationRevision} · Fee worksheet revision {source.feeRevision} · {source.quote.product}</p>
        <label className="field">Sample signing target<input name="signBy" type="date" min={today} required
          defaultValue={current && current.signBy >= today ? current.signBy : today} /></label>
        <fieldset disabled={busy}><legend>Package documents</legend>{sampleDisclosureDocuments.map((document) =>
          <label className="disclosure-document-choice" key={document}><input name="documents" type="checkbox" value={document}
            defaultChecked={!current || current.documents.includes(document)} />{document}</label>)}</fieldset>
        <Button size="sm" type="submit" disabled={busy}>{current ? "Prepare revised package" : "Prepare sample package"}</Button>
      </form>
    </details>}
    {previous.length > 0 && <section className="record-form" aria-label="Previous sample packages">
      <h4>Recent package history</h4>
      {previous.map((item) => <div className="document-item" key={item.version}>
        <p>v{item.version} · Superseded {stamp(item.supersededAt)}</p>
        <p>{item.signers.map(({ role, status }) => `${role} ${status.toLowerCase()}`).join(" · ")}</p>
        <PackagePreview item={item} />
      </div>)}
    </section>}
  </section>;
}

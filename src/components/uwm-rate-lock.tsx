"use client";

import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import type { StaffApplication } from "@/lib/application-model";
import type { Submission } from "@/lib/model";
import { mockLockExtensionPeriods, mockLockPeriods, mockRateQuoteTermsLabel, mockRateStatus, mockUwmRateReceiptIssue,
  type MockLockExtensionPeriod, type MockLockPeriod, type MockUwmRate, type PricingOffer, type PricingRun } from "@/lib/pricing-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

function ActiveLockActions({ rate, busy, save }: { rate: MockUwmRate; busy: boolean; save: (input: unknown) => Promise<void> }) {
  const [extension, setExtension] = useState<MockLockExtensionPeriod>(7);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const lock = { loanId: rate.loanId, lockReference: rate.lockReference, expectedExpiresAt: rate.lockExpiresAt };
  return <div className="rate-lock-management">
    <div className="rate-lock-actions">
      <label className="field"><span>Extend by</span><select value={extension} onChange={(event) => setExtension(Number(event.target.value) as MockLockExtensionPeriod)} disabled={busy}>
        {mockLockExtensionPeriods.map((period) => <option key={period} value={period}>{period} days</option>)}
      </select></label>
      <Button size="sm" variant="outline" disabled={busy || confirmCancel} onClick={() => void save({ type: "extendMockLock", ...lock, days: extension })}>Extend lock (mock)</Button>
      {!confirmCancel && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel lock (mock)</Button>}
    </div>
    {confirmCancel && <div className="quote-preview" role="group" aria-label="Confirm mock lock cancellation">
      <p>Cancel the mock lock on {rate.product} at {rate.rate.toFixed(3)}%?</p>
      <div className="rate-lock-actions">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep lock</Button>
        <Button size="sm" disabled={busy} onClick={() => void save({ type: "cancelMockLock", ...lock })}>Confirm cancellation (mock)</Button>
      </div>
    </div>}
  </div>;
}

export function UwmRateLock({ loanId, submissions, application, rate, saved, offer, needsReprice, amountIssue, use1003Amount,
  openApplication, busy, save }: {
  loanId: string; submissions: Submission[]; rate?: MockUwmRate; saved?: PricingRun; offer?: PricingOffer;
  application?: Pick<StaffApplication, "revision" | "submittedAt" | "reviewedAt" | "correctionNote" | "uwmReference" | "versions">;
  openApplication: () => void;
  needsReprice: boolean; amountIssue: string | null; use1003Amount?: () => void; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const [fileChoice, setFileChoice] = useState("");
  const [days, setDays] = useState<MockLockPeriod>(30);
  const files = submissions.filter((submission) => submission.lender === "UWM" && submission.syncedAt &&
    (!application?.uwmReference || submission.externalId === application.uwmReference));
  const fileId = files.find((file) => file.id === fileChoice)?.id ?? files.find((file) => file.id === rate?.submissionId)?.id
    ?? (files.length === 1 ? files[0].id : "");
  const status = rate && mockRateStatus(rate, new Date().toISOString());
  const receipt = application?.versions.find(({ revision }) => revision === application.revision)?.uwmReceipt;
  const receiptIssue = mockUwmRateReceiptIssue(application, files.find(({ id }) => id === fileId)?.externalId, Boolean(receipt));
  const matchingFloat = status === "Floating" && rate?.submissionId === fileId && rate.runId === saved?.id && rate.offerId === offer?.id;

  return <section className="quote-saved" aria-label="Mock UWM rate lock" id="uwm-rate-lock" tabIndex={-1}>
    <div className="section-heading"><h3><LockKeyhole size={17} /> UWM rate lock</h3><span className="pill">Mock</span></div>
    {application?.uwmReference && receipt && !receiptIssue && <p className="muted">Mock UWM received 1003 revision {application.revision} · {dateTime(receipt.sentAt)} ET</p>}
    {rate && <div className="quote-preview">
      <div className="section-heading"><strong>{rate.product} at {rate.rate.toFixed(3)}%</strong><span className="pill">{status}</span></div>
      {rate.quoteTerms && <p><strong>{rate.lockReference ? "Locked amount" : "Floated amount"}</strong> {mockRateQuoteTermsLabel(rate.quoteTerms)}</p>}
      <p className="muted">UWM file {rate.loanNumber} · Quoted {dateTime(rate.quotedAt)} ET</p>
      <p className="rate-receipt">Floated {dateTime(rate.floatedAt)} ET · {rate.floatReference}</p>
      {rate.lockReference && rate.lockedAt && rate.lockExpiresAt && <>
        <p>Mock lock confirmed {dateTime(rate.lockedAt)} ET · Initial period {rate.lockDays} days</p>
        <p>{rate.lockCancelledAt ? "Scheduled expiration" : "Expires"} {dateTime(rate.lockExpiresAt)} ET</p>
        <p className="rate-receipt">Confirmation {rate.lockReference}</p>
        {rate.lockExtensionReference && <p className="rate-receipt">Latest extension · {rate.lockExtensionDays} days · {rate.lockExtensionReference}</p>}
        {rate.lockCancelledAt && <p className="rate-receipt">Cancelled {dateTime(rate.lockCancelledAt)} ET · {rate.lockCancellationReference}</p>}
      </>}
    </div>}
    {status === "Mock locked" && rate && <ActiveLockActions key={rate.lockReference} rate={rate} busy={busy} save={save} />}
    {status !== "Mock locked" && (receiptIssue ? <div className="rate-lock-actions">
      <p className="quote-disclaimer">{receiptIssue}</p>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={openApplication}>Open 1003 handoff</Button>
    </div> : offer?.manual || saved?.scenario.nonAgency ? <p className="muted">Mock UWM float and lock require a conventional sample UWM offer.</p> : !saved || !offer || saved.mode !== "mock"
      ? <p className="muted">Save a sample pricing option to start the mock float and lock flow.</p>
      : needsReprice ? <p className="quote-disclaimer">Save a fresh quote from the current 1003 to float or request a mock lock.</p>
      : !files.length ? <p className="muted">Use Sync UWM for a sample UWM file, or send a reviewed 1003 to UWM (mock) from this loan first.</p>
      : amountIssue ? <div className="rate-lock-actions">
        <p className="quote-disclaimer">{amountIssue}</p>
        {use1003Amount && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={use1003Amount}>Use 1003 amount in pricing</Button>}
      </div>
      : <div className="rate-lock-actions">
        {files.length > 1 && <label className="field"><span>UWM loan file</span><select value={fileId} onChange={(event) => setFileChoice(event.target.value)} disabled={busy}>
          <option value="" disabled>Choose a UWM file</option>
          {files.map((file) => <option key={file.id} value={file.id}>{file.externalId}</option>)}
        </select></label>}
        {matchingFloat && rate ? <>
          <label className="field"><span>Mock lock period</span><select value={days} onChange={(event) => setDays(Number(event.target.value) as MockLockPeriod)} disabled={busy}>
            {mockLockPeriods.map((period) => <option key={period} value={period}>{period} days</option>)}
          </select></label>
          <Button size="sm" disabled={busy} onClick={() => void save({ type: "lockMockRate", loanId, floatReference: rate.floatReference, days })}>
            <LockKeyhole /> Request lock (mock)
          </Button>
        </> : <>
          <p>{offer.product} at {offer.rate.toFixed(3)}% · Saved sample quote</p>
          <Button size="sm" variant="outline" disabled={busy || !fileId} onClick={() => void save({
            type: "floatMockRate", loanId, submissionId: fileId, runId: saved.id, offerId: offer.id, previousFloatReference: rate?.floatReference ?? null,
          })}>{status === "Floating" ? "Float updated rate (mock)" : "Float rate (mock)"}</Button>
        </>}
      </div>)}
  </section>;
}

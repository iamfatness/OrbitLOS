"use client";

import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import type { Submission } from "@/lib/model";
import { mockLockPeriods, mockRateStatus, type MockLockPeriod, type MockUwmRate, type PricingOffer, type PricingRun } from "@/lib/pricing-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function UwmRateLock({ loanId, submissions, rate, saved, offer, busy, save }: {
  loanId: string; submissions: Submission[]; rate?: MockUwmRate; saved?: PricingRun; offer?: PricingOffer;
  busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const [fileChoice, setFileChoice] = useState("");
  const [days, setDays] = useState<MockLockPeriod>(30);
  const files = submissions.filter((submission) => submission.lender === "UWM" && submission.syncedAt);
  const fileId = files.find((file) => file.id === fileChoice)?.id ?? files.find((file) => file.id === rate?.submissionId)?.id
    ?? (files.length === 1 ? files[0].id : "");
  const status = rate && mockRateStatus(rate, new Date().toISOString());
  const matchingFloat = status === "Floating" && rate?.submissionId === fileId && rate.runId === saved?.id && rate.offerId === offer?.id;

  return <section className="quote-saved" aria-label="Mock UWM rate lock">
    <div className="section-heading"><h3><LockKeyhole size={17} /> UWM rate lock</h3><span className="pill">Mock</span></div>
    {rate && <div className="quote-preview">
      <div className="section-heading"><strong>{rate.product} at {rate.rate.toFixed(3)}%</strong><span className="pill">{status}</span></div>
      <p className="muted">UWM file {rate.loanNumber} · Quoted {dateTime(rate.quotedAt)} ET</p>
      <p className="rate-receipt">Floated {dateTime(rate.floatedAt)} ET · {rate.floatReference}</p>
      {rate.lockReference && rate.lockedAt && rate.lockExpiresAt && <>
        <p>Mock lock confirmed {dateTime(rate.lockedAt)} ET · {rate.lockDays} days</p>
        <p>Expires {dateTime(rate.lockExpiresAt)} ET</p>
        <p className="rate-receipt">Confirmation {rate.lockReference}</p>
      </>}
    </div>}
    {status !== "Mock locked" && (!saved || !offer || saved.mode !== "mock"
      ? <p className="muted">Save a sample pricing option to start the mock float and lock flow.</p>
      : !files.length ? <p className="muted">Use Sync UWM for a sample UWM file, or send a reviewed 1003 to UWM (mock) from this loan first.</p>
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

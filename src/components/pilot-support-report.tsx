"use client";

import { useEffect, useRef, useState } from "react";
import { supportChanged, supportSampleLimit, supportUnavailable, type PilotSupportPreview, type SupportRequestCounts } from "@/lib/pilot-support-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

function Counts({ title, sampled, limited, rows }: {
  title: string; sampled: number; limited: boolean; rows: Array<[string, number]>;
}) {
  return <div>
    <h3>{title}</h3>
    <p className="muted">{sampled} {sampled === 1 ? "entry" : "entries"} checked{limited ? " · Earlier entries omitted" : ""}</p>
    <dl className="support-report-metrics">{rows.map(([label, count]) =>
      <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
  </div>;
}

function LenderCounts({ title, counts }: { title: string; counts: SupportRequestCounts }) {
  return <Counts title={title} sampled={counts.sampled} limited={counts.limited} rows={[
    ["Awaiting outcome", counts.awaitingOutcome], ["Needs reconciliation", counts.needsReconciliation], ["Failed or rejected", counts.unsuccessful],
  ]} />;
}

export function PilotSupportReport({ endpoint }: { endpoint: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<PilotSupportPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (window.location.hash === "#pilot-support-report") heading.current?.focus();
  }, []);

  async function run(action: "preview" | "download") {
    if (busy || (action === "download" && !preview)) return;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint + "&support=1", action === "download" ? {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: preview?.fingerprint }),
      } : undefined);
      if (!response.ok || response.redirected) {
        if (response.status === 409) throw new Error(supportChanged);
        if (response.status === 403 || response.redirected) throw new Error("Sign in as an active pilot admin to view the report.");
        throw new Error(supportUnavailable);
      }
      if (action === "download") {
        downloadSampleFile(await response.blob(), "orbit-pilot-support.json");
        setMessage("Redacted report downloaded. The export is recorded in Access history.");
      } else {
        setPreview(await response.json() as PilotSupportPreview);
        setMessage("Report preview ready.");
      }
    } catch (failure) {
      const changed = failure instanceof Error && failure.message === supportChanged;
      if (changed) {
        setPreview(null);
        previewButton.current?.focus();
      }
      setError(failure instanceof Error ? failure.message : supportUnavailable);
    } finally {
      setBusy(null);
    }
  }

  const snapshot = preview?.snapshot;
  return <section className="pipeline relationship-panel support-report" id="pilot-support-report" aria-labelledby="pilot-support-heading">
    <h2 id="pilot-support-heading" ref={heading} tabIndex={-1}>Support report</h2>
    <p className="muted">Review handoff counts and recovery status before downloading a report. The file contains no borrower details, documents, or provider credentials.</p>
    <div className="loan-application-actions">
      <Button ref={previewButton} variant={preview ? "outline" : "default"} aria-disabled={Boolean(busy)} onClick={() => void run("preview")}>
        {busy === "preview" ? "Checking report…" : preview ? "Refresh report" : "Preview report"}
      </Button>
      {preview && <Button aria-disabled={Boolean(busy)} onClick={() => void run("download")}>
        {busy === "download" ? "Preparing download…" : "Download redacted report"}
      </Button>}
    </div>
    {error && <p role="alert" className="application-message banner-error">{error}</p>}
    {message && <p role="status" className="muted">{message}</p>}
    {snapshot && <div className="record-form">
      <p className="muted">Checked {new Date(preview.checkedAt).toLocaleString()}. Counts cover up to {supportSampleLimit} recent entries per source.</p>
      <div className="maintenance-columns support-report-sections">
        <div>
          <h3>Workspace recovery</h3>
          <dl className="support-report-metrics">
            <div><dt>Workspace status</dt><dd>{snapshot.recovery.mode}</dd></div>
            <div><dt>Restore verification</dt><dd>{snapshot.recovery.pendingRestore ? "Pending" : "None pending"}</dd></div>
            <div><dt>Internal edit recovery</dt><dd>{snapshot.recovery.pendingReplay ? "Pending" : "None pending"}</dd></div>
            <div><dt>Unconfirmed internal edits</dt><dd>{snapshot.recovery.pendingEditReceipt ? "Present" : "None pending"}</dd></div>
          </dl>
        </div>
        <Counts title="Processing handoffs" sampled={snapshot.processing.sampled} limited={snapshot.processing.limited} rows={[
          ["Waiting for acceptance", snapshot.processing.awaitingAcceptance], ["Returned to loan officer", snapshot.processing.returnedToOfficer],
          ["Missing processor assignment", snapshot.processing.unassigned],
        ]} />
        <LenderCounts title="Lender request history" counts={snapshot.lenderRequests} />
        <LenderCounts title="Lender operation history" counts={snapshot.lenderOperations} />
      </div>
    </div>}
  </section>;
}

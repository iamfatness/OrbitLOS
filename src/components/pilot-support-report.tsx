"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { supportChanged, supportSampleLimit, supportUnavailable, supportLoanUrl, supportReportUrl, supportWorkGroup, supportWorkOffset,
  supportWorkPageSize, supportWorkPaused, supportWorkTitles, type PilotSupportPreview, type SupportRequestCounts, type SupportWorkGroup,
  type SupportWorkPage } from "@/lib/pilot-support-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

function Counts({ title, sampled, limited, rows, review }: {
  title: string; sampled: number; limited: boolean; rows: Array<[string, number]>; review?: () => void;
}) {
  return <div>
    <h3>{title}</h3>
    <p className="muted">{sampled} {sampled === 1 ? "entry" : "entries"} checked{limited ? " · Earlier entries omitted" : ""}</p>
    <dl className="support-report-metrics">{rows.map(([label, count]) =>
      <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
    {review && rows.some(([, count]) => count > 0) && <Button variant="outline" size="sm" onClick={review}>Review {title.toLowerCase()}</Button>}
  </div>;
}

function LenderCounts({ title, counts, review }: { title: string; counts: SupportRequestCounts; review?: () => void }) {
  return <Counts title={title} sampled={counts.sampled} limited={counts.limited} review={review} rows={[
    ["Awaiting outcome", counts.awaitingOutcome], ["Needs reconciliation", counts.needsReconciliation], ["Failed or rejected", counts.unsuccessful],
  ]} />;
}

export function PilotSupportReport({ endpoint, brokerageId, recoveryReady, onRecovery }: {
  endpoint: string; brokerageId: string; recoveryReady: boolean; onRecovery: (target: "restore" | "replay" | "unconfirmed") => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const workHeading = useRef<HTMLHeadingElement>(null);
  const [preview, setPreview] = useState<PilotSupportPreview | null>(null);
  const [work, setWork] = useState<SupportWorkPage | null>(null);
  const [busy, setBusy] = useState<"preview" | "download" | "work" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const reportEndpoint = endpoint + "&support=1";
  async function loadWork(group: SupportWorkGroup, offset: number, fingerprint: string) {
    const query = new URLSearchParams({ work: group, offset: String(offset), fingerprint });
    const response = await fetch(reportEndpoint + "&" + query);
    const data = await response.json() as SupportWorkPage & { error?: string };
    if (!response.ok) throw new Error(data.error ?? supportUnavailable);
    setWork(data);
    window.history.replaceState(window.history.state, "", supportReportUrl(brokerageId, group, data.offset));
  }
  useEffect(() => { if (work) workHeading.current?.focus(); }, [work]);

  async function run(action: "preview" | "download", resume?: { group: SupportWorkGroup; offset: number }) {
    if (busy || (action === "download" && !preview)) return;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch(reportEndpoint, action === "download" ? {
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
        const next = await response.json() as PilotSupportPreview;
        setPreview(next);
        setWork(null);
        if (resume && next.snapshot.recovery.mode === "Open") await loadWork(resume.group, resume.offset, next.fingerprint);
        setMessage("Report preview ready.");
      }
    } catch (failure) {
      const changed = failure instanceof Error && failure.message === supportChanged;
      if (changed) {
        setPreview(null);
        setWork(null);
        previewButton.current?.focus();
      }
      setError(failure instanceof Error ? failure.message : supportUnavailable);
    } finally {
      setBusy(null);
    }
  }
  async function review(group: SupportWorkGroup, offset=0) {
    if (!preview || busy) return;
    setBusy("work");
    setError("");
    setMessage("");
    try {
      await loadWork(group, offset, preview.fingerprint);
    } catch (failure) {
      setWork(null);
      setError(failure instanceof Error ? failure.message : supportUnavailable);
      previewButton.current?.focus();
    } finally {
      setBusy(null);
    }
  }
  const resumeReport = useEffectEvent((group:SupportWorkGroup,offset:number)=>{void run("preview",{group,offset});});
  useEffect(() => {
    if (window.location.hash !== "#pilot-support-report") return;
    heading.current?.focus();
    const search = new URLSearchParams(window.location.search);
    const group = supportWorkGroup(search.get("supportWork"));
    if (group) {
      const frame = requestAnimationFrame(()=>resumeReport(group,supportWorkOffset(search.get("offset"))));
      return ()=>cancelAnimationFrame(frame);
    }
  }, []);

  const snapshot = preview?.snapshot;
  return <section className="pipeline relationship-panel support-report" id="pilot-support-report" aria-labelledby="pilot-support-heading">
    <h2 id="pilot-support-heading" ref={heading} tabIndex={-1}>Support report</h2>
    <p className="muted">Review handoff counts and recovery status before downloading a report. The file contains no borrower details, documents, or provider credentials.</p>
    <div className="loan-application-actions">
      <Button ref={previewButton} variant={preview ? "outline" : "default"} aria-disabled={Boolean(busy)} onClick={() => void run("preview",work??undefined)}>
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
          {recoveryReady && <div className="loan-application-actions">
            {snapshot.recovery.pendingRestore && <Button variant="outline" size="sm" onClick={()=>onRecovery("restore")}>Open pending restore</Button>}
            {snapshot.recovery.pendingReplay && <Button variant="outline" size="sm" onClick={()=>onRecovery("replay")}>Open pending edit recovery</Button>}
            {snapshot.recovery.pendingEditReceipt && <Button variant="outline" size="sm" onClick={()=>onRecovery("unconfirmed")}>Review unconfirmed edits</Button>}
          </div>}
        </div>
        <Counts title="Processing handoffs" sampled={snapshot.processing.sampled} limited={snapshot.processing.limited}
          review={snapshot.recovery.mode==="Open"?()=>void review("handoffs"):undefined} rows={[
          ["Waiting for acceptance", snapshot.processing.awaitingAcceptance], ["Returned to loan officer", snapshot.processing.returnedToOfficer],
          ["Missing processor assignment", snapshot.processing.unassigned],
        ]} />
        <LenderCounts title="Lender requests" counts={snapshot.lenderRequests} review={snapshot.recovery.mode==="Open"?()=>void review("requests"):undefined} />
        <LenderCounts title="Lender operations" counts={snapshot.lenderOperations} review={snapshot.recovery.mode==="Open"?()=>void review("operations"):undefined} />
      </div>
      {snapshot.recovery.mode!=="Open" && <p className="muted">{supportWorkPaused}</p>}
      {busy==="work" && <p className="muted" role="status">Loading work…</p>}
      {work && <section className="record-form" aria-labelledby="pilot-support-work-heading">
        <h3 id="pilot-support-work-heading" ref={workHeading} tabIndex={-1}>{supportWorkTitles[work.group]} to review</h3>
        {work.total ? <>
          {work.total>supportWorkPageSize && <p className="muted">Showing {work.offset+1}–{work.offset+work.items.length} of {work.total}</p>}
          <ul className="document-list">{work.items.map(item=><li className="document-item" key={item.id}>
            <div className="document-item-head"><strong>{item.name}</strong>
              <Button asChild variant="outline" size="sm"><a aria-label={`Open loan for ${item.name}`}
                href={supportLoanUrl(brokerageId,item.loanId,work.group,work.offset)}>Open loan</a></Button>
            </div>
            <p>{item.status} · {new Date(item.at).toLocaleString()}</p>
          </li>)}</ul>
          {(work.offset>0||work.next!==null) && <nav className="loan-application-actions" aria-label="Support work pages">
            <Button variant="outline" size="sm" disabled={Boolean(busy)||work.offset===0}
              onClick={()=>void review(work.group,Math.max(0,work.offset-supportWorkPageSize))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={Boolean(busy)||work.next===null}
              onClick={()=>work.next!==null&&void review(work.group,work.next)}>Next</Button>
          </nav>}
        </> : <p>No matching work remains in the recent entries.</p>}
      </section>}
    </div>}
  </section>;
}

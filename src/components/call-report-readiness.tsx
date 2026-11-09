"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { accessReportingReadiness } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { currentReportingPeriod, type ReportingPeriod, type ReportingReadiness } from "@/lib/call-report-readiness-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type List = Extract<ReportingReadiness, { kind: "list" }>;
const validYear = (year: string, maximum: string) => /^\d{4}$/.test(year) && year >= "1900" && year <= maximum;

export function ReportingPeriodFields({ period, maxYear, change }: { period: ReportingPeriod; maxYear: string; change: (value: ReportingPeriod) => void }) {
  return <>
    <label className="field">Reporting year<input type="number" min={1900} max={maxYear} value={period.year}
      onChange={(event) => change({ ...period, year: event.target.value })} /></label>
    <label className="field">Reporting quarter<select value={period.quarter} onChange={(event) => change({ ...period, quarter: Number(event.target.value) })}>
      {[1, 2, 3, 4].map((value) => <option key={value} value={value}>Q{value}</option>)}
    </select></label>
  </>;
}

export function ReportingReadinessPanel({ brokerageId, period, setPeriod, version, busy, openLoan, openReport }: {
  brokerageId: string; period: ReportingPeriod; setPeriod: (period: ReportingPeriod) => void; version: object; busy: boolean;
  openLoan: (id: string) => void; openReport: () => void;
}) {
  const [maximum] = useState(() => currentReportingPeriod().year);
  const [after, setAfter] = useState<List["next"]>(null);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; version: object; data: List | { error: string } }>();
  const valid = validYear(period.year, maximum);
  const key = JSON.stringify([period.year, period.quarter, after, refresh]);
  useEffect(() => {
    if (!valid) return;
    let active = true;
    const failure = { error: "Could not check reporting readiness. Refresh to try again." };
    void accessReportingReadiness({ type: "list", year: Number(period.year), quarter: period.quarter, after: after ?? undefined }, brokerageId).then((data) => {
      if (active) setResult({ key, version, data: "error" in data || data.kind === "list" ? data : failure });
    }, () => { if (active) setResult({ key, version, data: failure }); });
    return () => { active = false; };
  }, [after, brokerageId, key, period.quarter, period.year, valid, version]);
  const data = result?.key === key && result.version === version ? result.data : undefined;
  const page = data && !("error" in data) ? data : undefined;
  return <section className="record-form" aria-label="Reporting readiness">
    <div className="section-heading"><h3>Reporting readiness</h3>
      <Button size="sm" variant="outline" onClick={() => { setAfter(null); setRefresh((value) => value + 1); }}><RefreshCw /> Refresh readiness</Button></div>
    <p className="muted">Find missing or inconsistent call report facts for the whole quarter. A brokerage admin confirms the facts on each file.</p>
    <div className="form-grid"><ReportingPeriodFields period={period} maxYear={maximum} change={(value) => { setAfter(null); setPeriod(value); }} /></div>
    <div><Button size="sm" variant="outline" disabled={!valid} onClick={openReport}>Open call report prep</Button></div>
    {!valid && <p role="alert">Enter a four-digit reporting year through {maximum}.</p>}
    {valid && !data && <p className="muted" role="status">Checking reporting records…</p>}
    {data && "error" in data && <p role="alert">{data.error}</p>}
    {page && <>
      <p role="status">{page.indexing ? `${page.blockers} found so far. Reporting records are still being checked.` :
        `${page.blockers} ${page.blockers === 1 ? "file needs" : "files need"} attention.`}</p>
      {page.items.length ? <ul className="playbook-exceptions">{page.items.map((item) => <li className="document-item" key={item.id}>
        <div className="document-item-head"><strong>{item.borrower}</strong><span className="pill">{item.issues.length} to resolve</span></div>
        <p>{item.issues.join(" · ")}</p>
        <p className="muted">File owner · {item.officer || "Unassigned"} · {item.revision ? `Facts revision ${item.revision}` : "Facts awaiting confirmation"}</p>
        <p className="muted">{[item.firstApplication && `First 1003 ${dateLabel(item.firstApplication)}`,
          item.fundingDate && `Funding ${dateLabel(item.fundingDate)}`].filter(Boolean).join(" · ") || "Application and funding dates to confirm"}</p>
        <div><Button size="sm" variant="outline" disabled={busy} aria-label={`Open reporting facts for ${item.borrower}`} onClick={() => openLoan(item.id)}>Open reporting facts</Button></div>
      </li>)}</ul> : <p className="empty-inline">{page.indexing ? "Refresh readiness to continue checking the quarter." : "No unresolved call report facts in this quarter."}</p>}
      <div className="loan-application-actions">
        {after && <Button size="sm" variant="outline" onClick={() => setAfter(null)}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setAfter(page.next)}>Next page</Button>}
      </div>
    </>}
  </section>;
}

export function ReconciledCallReportExport({ brokerageId, period, openReadiness }: {
  brokerageId: string; period: ReportingPeriod; openReadiness: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  async function download() {
    if (pending) return;
    setPending(true);
    setFeedback(undefined);
    try {
      const result = await accessReportingReadiness({ type: "export", year: Number(period.year), quarter: period.quarter }, brokerageId);
      if ("error" in result) setFeedback({ text: result.error, error: true });
      else if (result.kind === "export") {
        downloadSampleFile(result.csv, `orbit-reconciled-call-report-${period.year}-Q${period.quarter}.csv`, "text/csv");
        setFeedback({ text: `Exported ${result.count} reconciled ${result.count === 1 ? "record" : "records"}.` });
      }
    } catch { setFeedback({ text: "Could not export the reconciled quarter. Try again.", error: true }); }
    finally { setPending(false); }
  }
  return <>
    <div className="loan-application-actions">
      <Button size="sm" disabled={pending} onClick={() => void download()}>Export reconciled quarter CSV</Button>
      <Button size="sm" variant="outline" onClick={openReadiness}>Review reporting blockers</Button>
    </div>
    <p className="muted">The reconciled CSV checks the whole quarter. Use the draft review CSV for a filtered working copy.</p>
    {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
  </>;
}

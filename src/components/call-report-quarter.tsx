"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessReportingReadiness } from "@/app/actions";
import { quarterName, type CarryoverTotals, type QuarterReviewPage } from "@/lib/call-report-quarter-model";
import type { ReportingPeriod, ReportingReadinessInput } from "@/lib/call-report-readiness-model";
import { dateTime, money } from "@/lib/utils";
import { Fv7QuarterReview } from "./call-report-fv7";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

const displayTotals = (total: CarryoverTotals | null) => total ? `${total.count} · ${money(total.amount)}` : "—";

export function CallReportQuarterReview({ brokerageId, period, openLoan, openReadiness, openPrior, version }: {
  brokerageId: string; period: ReportingPeriod; openLoan: (id: string) => void; openReadiness: () => void;
  openPrior: (period: ReportingPeriod) => void; version: object;
}) {
  const [started, setStarted] = useState(false);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ offset: number; refresh: number; version: object; data: QuarterReviewPage | { error: string } }>();
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ fields: string; id: string } | null>(null);
  const pending = useRef(false);
  const year = Number(period.year);
  const { quarter } = period;
  useEffect(() => {
    if (!started) return;
    let active = true;
    const error = { error: "Could not open the quarter review. Refresh to try again." };
    void accessReportingReadiness({ type: "quarterReview", year, quarter, offset }, brokerageId).then((result) => {
      if (active) setLoaded({ offset, refresh, version, data: "error" in result || result.kind === "quarterReview" ? result : error });
    }, () => { if (active) setLoaded({ offset, refresh, version, data: error }); });
    return () => { active = false; };
  }, [brokerageId, offset, quarter, refresh, started, version, year]);
  const data = loaded?.offset === offset && loaded.refresh === refresh && loaded.version === version ? loaded.data : undefined;
  const page = data && !("error" in data) ? data : undefined;
  const comparison = page?.comparison;
  const latest = page?.history[0];
  const oldest = page?.history.at(-1);

  async function perform(input: ReportingReadinessInput) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await accessReportingReadiness(input, brokerageId);
      if ("error" in result) setFeedback({ text: result.error, error: true });
      else if (result.kind === "quarterReviewSaved") {
        attempt.current = null;
        setOffset(0);
        setRefresh((value) => value + 1);
        setFeedback({ text: `Quarter review v${result.review.version} saved.` });
      } else if (result.kind === "quarterReviewDownload") {
        downloadSampleFile(result.csv, `orbit-call-report-review-${year}-Q${quarter}-v${result.version}.csv`, "text/csv");
        setFeedback({ text: `Downloaded saved review v${result.version}.` });
      }
    } catch {
      setFeedback({ text: "Could not complete the quarter review action. Try again.", error: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comparison) return;
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    const input = { type: "saveQuarterReview" as const, year, quarter, note, evidenceKey: comparison.key, previousVersion: latest?.version ?? null };
    const fields = JSON.stringify(input);
    if (attempt.current?.fields !== fields) attempt.current = { fields, id: crypto.randomUUID() };
    void perform({ ...input, requestId: attempt.current.id });
  }

  const download = (version: number) => void perform({ type: "downloadQuarterReview", year, quarter, version });

  return <details className="document-form" onToggle={(event) => { if (event.currentTarget.open) setStarted(true); }}>
    <summary>Quarter reconciliation and review exports</summary>
    {started && <section className="record-form" aria-label="Quarter reconciliation">
      <p className="muted">Compare the saved prior quarter’s ending pipeline with this quarter’s opening files. This is an internal review of the whole brokerage quarter.</p>
      <div><Button size="sm" variant="outline" disabled={busy} onClick={() => { setOffset(0); setRefresh((value) => value + 1); }}>Refresh quarter review</Button></div>
      {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      {!data && <p role="status">Checking quarter evidence…</p>}
      {data && "error" in data && <p role="alert">{data.error}</p>}
      {page?.unavailable && <div className="document-item">
        <p>{page.unavailable}</p>
        <div><Button size="sm" variant="outline" onClick={openReadiness}>Open reporting readiness</Button></div>
      </div>}
      {page && comparison && <>
        <div className="work-queue">
          <div className="section-heading"><h3>{quarterName(page.period)} opening pipeline</h3>
            <span className="pill">{page.closed ? "Quarter ended" : "Quarter in progress"}</span></div>
          <p>Current opening · {displayTotals(comparison.opening)}</p>
          <p>Prior ending · {displayTotals(comparison.previousEnding)}</p>
          {comparison.prior ? <>
            <p>Compared with {quarterName(page.priorPeriod)} v{comparison.prior.version} · {comparison.changeCount} loan {comparison.changeCount === 1 ? "difference" : "differences"}</p>
            {!comparison.prior.closed && <p className="muted">The prior review was captured before that quarter ended.</p>}
          </> : <>
            <p>No saved baseline for {quarterName(page.priorPeriod)}. Save that quarter first, or record why review history starts here.</p>
            {page.priorPeriod.year >= 1900 && <div><Button size="sm" variant="outline" onClick={() => openPrior({
              year: String(page.priorPeriod.year), quarter: page.priorPeriod.quarter,
            })}>Open {quarterName(page.priorPeriod)}</Button></div>}
          </>}
        </div>
        {comparison.states.length > 0 && <details className="document-form">
          <summary>Compare by state · {comparison.states.length}</summary>
          <ul className="document-list">{comparison.states.map(({ state, previous, opening }) => <li key={state} className="document-item">
            <strong>{state}</strong><p>Prior ending {displayTotals(previous)} · Current opening {displayTotals(opening)}</p>
          </li>)}</ul>
        </details>}
        {comparison.differences.length > 0 && <>
          <h4>Loans behind the differences</h4>
          <ul className="document-list">{comparison.differences.map((item) => <li key={item.loanId} className="document-item">
            <div className="document-item-head"><strong>{item.borrower ?? "Historical loan record"}</strong>
              <span className="pill">{item.reasons.join(" · ")}</span></div>
            <p>Prior {item.before ? `${item.before.state} · ${money(item.before.amount)}` : "—"} · Current {item.current ?
              `${item.current.state} · ${money(item.current.amount)}` : "—"}</p>
            {item.borrower && <div><Button size="sm" variant="outline" aria-label={`Open reporting facts for ${item.borrower}`}
              onClick={() => openLoan(item.loanId)}>Open reporting facts</Button></div>}
          </li>)}</ul>
          <div className="loan-application-actions">
            {offset > 0 && <Button size="sm" variant="outline" onClick={() => setOffset(0)}>First differences</Button>}
            {comparison.next !== null && <Button size="sm" variant="outline" onClick={() => setOffset(comparison.next ?? 0)}>More differences</Button>}
          </div>
        </>}
        {page.latestCurrent ? <p>Saved review v{latest?.version} matches the current evidence.</p> : <form className="record-form" onSubmit={save} key={comparison.key}>
          {latest && <p className="muted">The loan facts or comparison basis changed since v{latest.version}.</p>}
          <label className="field">Quarter review note{comparison.needsNote ? " (required)" : " (optional)"}
            <textarea name="note" rows={2} maxLength={500} required={comparison.needsNote} disabled={busy} /></label>
          <div><Button size="sm" type="submit" disabled={busy}>Save quarter review v{(latest?.version ?? 0) + 1}</Button></div>
        </form>}
      </>}
      {page?.fv7Available && <Fv7QuarterReview brokerageId={brokerageId} period={page.period}
        reviews={page.history.filter(item => item.closed)} openLoan={openLoan} />}
      {!!page?.history.length && <div className="record-form">
        <h4>Saved review exports</h4>
        <ul className="document-list">{page.history.map((item) => <li key={item.version} className="document-item">
          <p><strong>Review v{item.version}</strong> · {item.recordedBy} · {dateTime(item.recordedAt)} ET</p>
          <p className="muted">{item.count} records · {item.closed ? "Quarter ended" : "Quarter in progress"} · {item.priorVersion === null ?
            "No saved prior baseline" : `Prior quarter v${item.priorVersion}`}</p>
          <div><Button size="sm" variant="outline" disabled={busy} onClick={() => download(item.version)}>Download review v{item.version} CSV</Button></div>
        </li>)}</ul>
        {oldest && oldest.version > 1 && <form className="record-form" onSubmit={(event) => {
          event.preventDefault();
          download(Number(new FormData(event.currentTarget).get("version")));
        }}>
          <label className="field">Earlier review version<input type="number" name="version" min={1} max={oldest.version - 1} required /></label>
          <div><Button size="sm" type="submit" variant="outline" disabled={busy}>Download earlier review CSV</Button></div>
        </form>}
      </div>}
    </section>}
  </details>;
}

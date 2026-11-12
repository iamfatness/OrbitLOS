import { useRef, useState } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { ausMethods, creditAusAttemptTarget, creditCoversApplication, mockAusScenarios, mockCreditScenarios, mockRunMatchesApplication,
  unconfirmedMockOrder, type AusMethod, type MockCreditAusRun } from "@/lib/credit-aus-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: () => void) => Promise<void>;
type Revision = number | null;
type MethodRuns = Record<AusMethod, MockCreditAusRun | undefined>;

function Attempt({ run, creditReference, stale, busy = false, save, canReviewConflict }: {
  run: MockCreditAusRun; creditReference?: string; stale?: boolean; busy?: boolean; save?: Save; canReviewConflict?: boolean;
}) {
  const { result, conflict } = run;
  const id = creditAusAttemptTarget(run.id);
  const needsAdmin = conflict && !conflict.reviewedAt;
  const lookup = useRef<{ attemptId: string; id: string } | null>(null);
  const focusOutcome = () => requestAnimationFrame(() => document.getElementById(id)?.querySelector<HTMLElement>("[data-credit-aus-outcome]")?.focus());
  return <div className="document-item" id={id} tabIndex={-1}>
    <div className="document-item-head"><strong>{run.reference}</strong><span className="pill" tabIndex={-1} data-credit-aus-outcome>{result.status}</span></div>
    <p className="muted">{run.retryOf ? "Retry · " : ""}{run.requestedBy} · {dateTime(run.requestedAt)} ET</p>
    <p className="muted">{run.applicationRevision == null ? "No submitted 1003 linked" : `1003 revision ${run.applicationRevision}`}
      {run.borrowerCount !== undefined && (run.borrowerCount === 1 ? " · Primary borrower" : ` · All ${run.borrowerCount} borrowers`)}
      {run.batchId && " · Paired AUS"}{stale && " · Previous inputs"}</p>
    {run.reconciledAt && <p className="muted">Original result confirmed {dateTime(run.reconciledAt)} ET</p>}
    {creditReference && <p className="muted">Mock credit reference {creditReference}</p>}
    {run.authorization && <details><summary>Mock credit authorization</summary>
      <p className="muted">{run.authorization.reference} · {run.authorization.recordedBy} · {dateTime(run.authorization.recordedAt)} ET</p>
    </details>}
    {conflict && <div className="credit-aus-panel">
      {needsAdmin ? <p>The returned reference differs from this order. {canReviewConflict ? "Dismiss the unmatched response to allow another lookup." : "A brokerage admin needs to review it."}</p> :
        <p className="muted">Mismatched response dismissed by {conflict.reviewedBy} · {dateTime(conflict.reviewedAt!)} ET</p>}
      {canReviewConflict && <p className="muted">Returned reference <strong>{conflict.reference}</strong></p>}
      {needsAdmin && canReviewConflict && save && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
        type: "reviewMockUnderwritingConflict", loanId: run.loanId, attemptId: run.id, detectedAt: conflict.detectedAt, reference: conflict.reference,
      }, focusOutcome)}>Dismiss mismatched response</Button></div>}
    </div>}
    {result.status === unconfirmedMockOrder && !needsAdmin && <>
      <p>{conflict?.reviewedAt ? "Check the original order again to confirm its result." : run.lastCheckedAt ? `Last check inconclusive · ${dateTime(run.lastCheckedAt)} ET` :
        "The mock provider’s response is missing. Check this order’s original result."}</p>
      {save && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => {
        if (lookup.current?.attemptId !== run.id) lookup.current = { attemptId: run.id, id: crypto.randomUUID() };
        void save({ type: "reconcileMockCreditAus", loanId: run.loanId, attemptId: run.id, lookupId: lookup.current.id },
          () => { lookup.current = null; focusOutcome(); });
      }}>
        Check original {run.service === "Credit" ? "credit" : run.service} result
      </Button></div>}
    </>}
    {result.status === "Failed" && <p>{result.reason}</p>}
    {result.status === "Report ready" && <p>Fictional credit score <strong>{result.score}</strong></p>}
    {result.status === "Findings ready" && <div>
      <p><strong>{result.recommendation}</strong></p>
      <ul className="credit-aus-findings">{result.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>
    </div>}
  </div>;
}

function RetryButton({ run, revision, busy, save }: { run: MockCreditAusRun; revision: Revision; busy: boolean; save: Save }) {
  const request = useRef<{ previousId: string; attemptId: string } | null>(null);
  return <Button size="sm" variant="outline" disabled={busy} onClick={() => {
    if (request.current?.previousId !== run.id) request.current = { previousId: run.id, attemptId: crypto.randomUUID() };
    void save({ type: "retryMockCreditAus", loanId: run.loanId, ...request.current, service: run.service, applicationRevision: revision });
  }}>Retry mock {run.service === "Credit" ? "credit" : run.service}</Button>;
}

function CreditPanel({ loanId, credit, revision, borrowerCount, busy, save, openPricing, canReviewConflict }: {
  loanId: string; credit?: MockCreditAusRun; revision: Revision; borrowerCount: number; busy: boolean; save: Save;
  openPricing?: () => void; canReviewConflict?: boolean;
}) {
  const [borrowers, setBorrowers] = useState(borrowerCount > 1 ? "" : "primary");
  const [authorized, setAuthorized] = useState(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const stale = !!credit && !mockRunMatchesApplication(credit, revision);
  const pending = credit?.result.status === unconfirmedMockOrder;
  return <section className="credit-aus-panel" aria-label="Mock credit">
    <h4>Credit report</h4>
    {credit ? <Attempt run={credit} stale={stale} busy={busy} save={save} canReviewConflict={canReviewConflict} /> : <p className="muted">Confirm demo authorization to generate a fictional report and reference.</p>}
    {credit && creditCoversApplication(credit, revision, borrowerCount) && openPricing && <div>
      <Button size="sm" disabled={busy} onClick={openPricing}>Price with mock score</Button>
    </div>}
    {!pending && <form className="credit-aus-panel" onSubmit={(event) => {
      event.preventDefault();
      if (!authorized || !borrowers) return;
      const scenario = new FormData(event.currentTarget).get("scenario");
      const key = JSON.stringify([borrowers, scenario, credit?.id ?? null, revision]);
      if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
      void save({ type: "runMockCredit", loanId, attemptId: request.current.id, previousId: credit?.id ?? null, authorized,
        borrowers, scenario, applicationRevision: revision }, () => { request.current = null; setAuthorized(false); });
    }}>
      {borrowerCount > 1 && <label className="field">Credit borrowers
        <select value={borrowers} onChange={(event) => { setBorrowers(event.target.value); setAuthorized(false); }} disabled={busy}>
          <option value="">Select borrowers</option><option value="primary">Primary borrower</option>
          <option value="all" disabled={revision === null}>All borrowers ({borrowerCount})</option>
        </select>
      </label>}
      <label className="demo-confirm"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} disabled={busy || !borrowers} />
        Confirm mock credit authorization{borrowerCount > 1 ? " for the selected borrowers" : " for the primary borrower"}
      </label>
      <div className="rate-lock-actions">
        <label className="field">Mock credit scenario<select name="scenario" disabled={busy}>
          {mockCreditScenarios.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <Button size="sm" type="submit" disabled={busy || !authorized || !borrowers}>Run mock credit</Button>
        {!stale && credit?.result.status === "Failed" && <RetryButton run={credit} revision={revision} busy={busy} save={save} />}
      </div>
    </form>}
  </section>;
}

const methodNames: Record<AusMethod, string> = { DU: "Desktop Underwriter", LPA: "Loan Product Advisor" };

function ScenarioOptions() {
  return mockAusScenarios.map(([value, label]) => <option key={value} value={value}>{label}</option>);
}

function PairedAusPanel({ loanId, runs, latest, credit, revision, busy, readOnly, save }: {
  loanId: string; runs: MockCreditAusRun[]; latest: MethodRuns; credit?: MockCreditAusRun; revision: Revision;
  busy: boolean; readOnly?: boolean; save: Save;
}) {
  const request = useRef<{ key: string; batchId: string; DU: string; LPA: string } | null>(null);
  const recentPair = runs.find((run) => run.batchId && !run.retryOf);
  const needsCredit = !credit?.authorization;
  const pending = ausMethods.some((method) => latest[method]?.result.status === unconfirmedMockOrder);
  const ready = revision !== null && !needsCredit && !pending;
  if (readOnly && !recentPair) return null;
  return <section className="credit-aus-panel" aria-label="Paired mock AUS">
    <h4>Run DU and LPA together</h4>
    {recentPair && <div className="document-item" aria-label="Latest paired AUS result">
      <p><strong>1003 revision {recentPair.applicationRevision}</strong>
        {(!mockRunMatchesApplication(recentPair, revision) || recentPair.creditId !== credit?.id) && " · Previous inputs"}</p>
      {ausMethods.map((method) => {
        const run = runs.find((item) => item.batchId === recentPair.batchId && item.service === method);
        if (!run) return null;
        const { result } = run;
        return <p key={method}><strong>{method}</strong> · {result.status === "Findings ready" ? result.recommendation : result.status}
          {run.retryOf && " · Retried"}</p>;
      })}
    </div>}
    {!readOnly && <>
      <p className="muted">{revision === null ? "Submit the 1003 to run both services on the same application." : needsCredit
        ? "Run authorized mock credit for all borrowers on this 1003 before ordering both services."
        : pending ? "Check any unconfirmed DU or LPA result below before ordering both services again."
        : "Both services use the same submitted 1003 and sample credit report. Each returns its own findings."}</p>
      <form className="rate-lock-actions" onSubmit={(event) => {
        event.preventDefault();
        if (!ready || !credit) return;
        const form = new FormData(event.currentTarget);
        const du = { previousId: latest.DU?.id ?? null, scenario: form.get("DU") };
        const lpa = { previousId: latest.LPA?.id ?? null, scenario: form.get("LPA") };
        const key = JSON.stringify([loanId, revision, credit.id, du, lpa]);
        if (request.current?.key !== key) request.current = { key, batchId: crypto.randomUUID(), DU: crypto.randomUUID(), LPA: crypto.randomUUID() };
        const { batchId, DU, LPA } = request.current;
        void save({ type: "runMockPairedAus", loanId, batchId, creditId: credit.id, applicationRevision: revision,
          orders: { DU: { ...du, attemptId: DU }, LPA: { ...lpa, attemptId: LPA } } }, () => { request.current = null; });
      }}>
        {ausMethods.map((method) => <label className="field" key={method}>Paired {method} scenario
          <select name={method} disabled={busy || !ready}><ScenarioOptions /></select>
        </label>)}
        <Button size="sm" type="submit" disabled={busy || !ready}>Run mock DU and LPA</Button>
      </form>
    </>}
  </section>;
}

function AusPanel({ loanId, method, run, credit, previousCredit, revision, busy, save, canReviewConflict }: {
  loanId: string; method: AusMethod; run?: MockCreditAusRun; credit?: MockCreditAusRun; previousCredit?: MockCreditAusRun;
  revision: Revision; busy: boolean; save: Save; canReviewConflict?: boolean;
}) {
  const request = useRef<{ key: string; id: string } | null>(null);
  const current = !!credit && run?.creditId === credit.id && mockRunMatchesApplication(run, revision);
  const pending = run?.result.status === unconfirmedMockOrder;
  return <section className="credit-aus-panel" aria-label={`Mock ${method}`}>
    <h4>{methodNames[method]} ({method})</h4>
    {run && <Attempt run={run} creditReference={previousCredit?.reference} stale={!current} busy={busy} save={save} canReviewConflict={canReviewConflict} />}
    {!pending && (!credit ? <p className="muted">{revision === null ? "Submit the 1003 before ordering mock AUS."
      : `Run mock credit for all borrowers on this 1003 before ordering ${method}.`}</p>
      : run && !current && <p className="muted">Run {method} again to use the current application and credit report.</p>)}
    {!pending && <form className="rate-lock-actions" onSubmit={(event) => {
      event.preventDefault();
      if (!credit) return;
      const scenario = new FormData(event.currentTarget).get("scenario");
      const key = JSON.stringify([loanId, method, credit.id, scenario, run?.id ?? null, revision]);
      if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
      void save({ type: "runMockAus", loanId, attemptId: request.current.id, previousId: run?.id ?? null, method, creditId: credit.id, scenario,
        applicationRevision: revision }, () => { request.current = null; });
    }}>
      <label className="field">Mock {method} scenario<select name="scenario" disabled={busy || !credit}><ScenarioOptions /></select></label>
      <Button size="sm" type="submit" disabled={busy || !credit}>Run mock {method}</Button>
      {current && run.result.status === "Failed" && <RetryButton run={run} revision={revision} busy={busy} save={save} />}
    </form>}
  </section>;
}

export function CreditAusWorkbench({ loanId, runs, revision, borrowerCount, busy, readOnly, save, openPricing, canReviewConflict }: {
  loanId: string; runs: MockCreditAusRun[]; revision: Revision; borrowerCount: number; busy: boolean; readOnly?: boolean;
  save: Save; openPricing?: () => void; canReviewConflict?: boolean;
}) {
  const credit = runs.find((run) => run.service === "Credit");
  const report = revision !== null && credit && creditCoversApplication(credit, revision, borrowerCount) ? credit : undefined;
  const latest = { DU: runs.find((run) => run.service === "DU"), LPA: runs.find((run) => run.service === "LPA") };
  const latestIds = new Set([credit?.id, latest.DU?.id, latest.LPA?.id]);
  const history = runs.filter((run) => !latestIds.has(run.id));
  const byId = new Map(runs.map((run) => [run.id, run]));
  return <section className="details-section credit-aus-panel" aria-label="Credit & AUS" id="credit-aus" tabIndex={-1}>
    <div className="section-heading"><h3><ClipboardCheck size={17} /> Credit &amp; AUS</h3>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "refreshWorkspace" })}><RefreshCw /> Refresh</Button>
    </div>
    <p className="muted">Mock credit and AUS use fictional reports. Live providers will appear in Integrations when connected.</p>
    {!readOnly && <CreditPanel key={`${loanId}:${revision}:${borrowerCount}`} loanId={loanId} credit={credit} revision={revision}
      borrowerCount={borrowerCount} busy={busy} save={save} openPricing={openPricing} canReviewConflict={canReviewConflict} />}
    <PairedAusPanel loanId={loanId} runs={runs} latest={latest} credit={report} revision={revision} busy={busy} readOnly={readOnly} save={save} />
    {readOnly ? <><p className="muted">The loan officer runs credit and AUS. Saved results are available for review.</p>
      {runs.filter((run) => latestIds.has(run.id)).map((run) => <Attempt key={run.id} run={run}
        stale={!mockRunMatchesApplication(run, revision) || (run.service !== "Credit" && run.creditId !== report?.id)}
        creditReference={run.creditId ? byId.get(run.creditId)?.reference : undefined} />)}
    </> : ausMethods.map((method) => {
      const run = latest[method];
      return <AusPanel key={method} loanId={loanId} method={method} run={run} credit={report} revision={revision}
        previousCredit={run?.creditId ? byId.get(run.creditId) : undefined} busy={busy} save={save} canReviewConflict={canReviewConflict} />;
    })}
    {history.length > 0 && <details className="document-form"><summary>Previous mock requests ({history.length})</summary>
      <div className="credit-aus-panel">
        {history.map((run) => <Attempt key={run.id} run={run} busy={busy} save={readOnly ? undefined : save} canReviewConflict={canReviewConflict}
          creditReference={run.creditId ? byId.get(run.creditId)?.reference : undefined} />)}
      </div>
    </details>}
  </section>;
}

import { useState } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { ausMethods, type AusMethod, type MockCreditAusRun } from "@/lib/credit-aus-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: () => void) => Promise<void>;

function Attempt({ run, creditReference }: { run: MockCreditAusRun; creditReference?: string }) {
  const { result } = run;
  return <div className="document-item">
    <div className="document-item-head"><strong>{run.reference}</strong><span className="pill">{result.status}</span></div>
    <p className="muted">{run.retryOf ? "Retry · " : ""}{run.requestedBy} · {dateTime(run.requestedAt)} ET</p>
    {creditReference && <p className="muted">Mock credit reference {creditReference}</p>}
    {result.status === "Failed" && <p>{result.reason}</p>}
    {result.status === "Report ready" && <p>Fictional credit score <strong>{result.score}</strong></p>}
    {result.status === "Findings ready" && <div>
      <p><strong>{result.recommendation}</strong></p>
      <ul className="credit-aus-findings">{result.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>
    </div>}
  </div>;
}

function retryAttempt(run: MockCreditAusRun, save: Save) {
  void save({ type: "retryMockCreditAus", loanId: run.loanId, attemptId: crypto.randomUUID(), previousId: run.id, service: run.service });
}

function CreditPanel({ loanId, credit, busy, save }: { loanId: string; credit?: MockCreditAusRun; busy: boolean; save: Save }) {
  const [authorized, setAuthorized] = useState(false);
  return <section className="credit-aus-panel" aria-label="Mock credit">
    <h4>Credit report</h4>
    {credit ? <Attempt run={credit} /> : <p className="muted">Confirm demo authorization to generate a fictional report and reference.</p>}
    <form className="credit-aus-panel" onSubmit={(event) => {
      event.preventDefault();
      const scenario = new FormData(event.currentTarget).get("scenario");
      void save({ type: "runMockCredit", loanId, attemptId: crypto.randomUUID(), previousId: credit?.id ?? null, authorized, scenario },
        () => setAuthorized(false));
    }}>
      <label className="demo-confirm"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} disabled={busy} />
        Confirm mock credit authorization
      </label>
      <div className="rate-lock-actions">
        <label className="field">Mock credit scenario<select name="scenario" disabled={busy}><option value="ready">Report ready</option><option value="failure">Temporary failure</option></select></label>
        <Button size="sm" type="submit" disabled={busy || !authorized}>Run mock credit</Button>
        {credit?.result.status === "Failed" && <Button size="sm" variant="outline" disabled={busy} onClick={() => retryAttempt(credit, save)}>Retry mock credit</Button>}
      </div>
    </form>
  </section>;
}

const methodNames: Record<AusMethod, string> = { DU: "Desktop Underwriter", LPA: "Loan Product Advisor" };

function AusPanel({ loanId, method, run, credit, previousCredit, busy, save }: {
  loanId: string; method: AusMethod; run?: MockCreditAusRun; credit?: MockCreditAusRun; previousCredit?: MockCreditAusRun; busy: boolean; save: Save;
}) {
  const ready = credit?.result.status === "Report ready";
  const current = ready && run?.creditId === credit.id;
  return <section className="credit-aus-panel" aria-label={`Mock ${method}`}>
    <h4>{methodNames[method]} ({method})</h4>
    {run && <Attempt run={run} creditReference={previousCredit?.reference} />}
    {!ready ? <p className="muted">Run mock credit to make a report available for {method}.</p>
      : run && !current && <p className="muted">This result uses a previous mock credit report. Run {method} again with the current report.</p>}
    <form className="rate-lock-actions" onSubmit={(event) => {
      event.preventDefault();
      if (!ready) return;
      const scenario = new FormData(event.currentTarget).get("scenario");
      void save({ type: "runMockAus", loanId, attemptId: crypto.randomUUID(), previousId: run?.id ?? null, method, creditId: credit.id, scenario });
    }}>
      <label className="field">Mock {method} scenario<select name="scenario" disabled={busy || !ready}>
        <option value="eligible">Eligible sample</option><option value="review">Review required</option><option value="failure">Temporary failure</option>
      </select></label>
      <Button size="sm" type="submit" disabled={busy || !ready}>Run mock {method}</Button>
      {current && run.result.status === "Failed" && <Button size="sm" variant="outline" disabled={busy} onClick={() => retryAttempt(run, save)}>Retry mock {method}</Button>}
    </form>
  </section>;
}

export function CreditAusWorkbench({ loanId, runs, busy, save }: { loanId: string; runs: MockCreditAusRun[]; busy: boolean; save: Save }) {
  const credit = runs.find((run) => run.service === "Credit");
  const methods = ausMethods.map((method) => ({ method, run: runs.find((run) => run.service === method) }));
  const latestIds = new Set([credit?.id, ...methods.map(({ run }) => run?.id)]);
  const history = runs.filter((run) => !latestIds.has(run.id));
  const byId = new Map(runs.map((run) => [run.id, run]));
  return <section className="details-section credit-aus-panel" aria-label="Credit & AUS" id="credit-aus" tabIndex={-1}>
    <div className="section-heading"><h3><ClipboardCheck size={17} /> Credit &amp; AUS</h3>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "refreshWorkspace" })}><RefreshCw /> Refresh</Button>
    </div>
    <p className="muted">Demo only. Credit and automated underwriting use fictional reports and loan inputs.</p>
    <CreditPanel loanId={loanId} credit={credit} busy={busy} save={save} />
    {methods.map(({ method, run }) => <AusPanel key={method} loanId={loanId} method={method} run={run} credit={credit}
      previousCredit={run?.creditId ? byId.get(run.creditId) : undefined} busy={busy} save={save} />)}
    {history.length > 0 && <details className="document-form"><summary>Previous mock requests ({history.length})</summary>
      <div className="credit-aus-panel">
        {history.map((run) => <Attempt key={run.id} run={run} creditReference={run.creditId ? byId.get(run.creditId)?.reference : undefined} />)}
      </div>
    </details>}
  </section>;
}

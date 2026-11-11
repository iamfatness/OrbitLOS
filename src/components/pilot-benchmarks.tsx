"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { pilotBenchmarkBoundaries, pilotBenchmarkWorkflow, pilotWalkthroughs, type PendingPilotBenchmark, type PilotBenchmark,
  type PilotBenchmarkRun, type PilotBenchmarkSide, type PilotHandling, type PilotWalkthrough } from "@/lib/brokerage-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const metricRows = [
  { key: "seconds", label: "Elapsed time", min: 1, max: 86_400 },
  { key: "repeatEntries", label: "Fields entered again", min: 0, max: 2_000 },
  { key: "systemSwitches", label: "System switches", min: 0, max: 2_000 },
] as const;

const handlingRows = [
  { key: "ownerSeconds", label: "Owner active time", time: true },
  { key: "officerSeconds", label: "Loan officer active time", time: true },
  { key: "processorSeconds", label: "Processor active time", time: true },
  { key: "waitingSeconds", label: "Waiting time", time: true },
  { key: "staffHandoffs", label: "Staff handoffs", time: false },
] as const;

function displayMetric(value: number | undefined, time: boolean) {
  if (value === undefined) return "Not measured";
  if (!time) return value.toLocaleString("en-US");
  const minutes = Math.floor(value / 60);
  return minutes ? `${minutes} min ${value % 60} sec` : `${value} sec`;
}

function RunFields() {
  return <fieldset className="record-form">
    <legend>Run measurements</legend>
    <div className="form-grid">
      {metricRows.map(({ key, label, min, max }) => <label className="field" key={key}>{key === "seconds" ? "Elapsed seconds" : label}
        <input name={key} type="number" required min={min} max={max} />
      </label>)}
      <label className="field">Run outcome<select name="outcome"><option>Completed</option><option>Blocked</option></select></label>
    </div>
    <details className="document-form"><summary>Handling and handoffs</summary>
      <div className="form-grid">{handlingRows.map(({ key, label, time }) => <label className="field" key={key}>{label}{time && " (seconds)"}
        <input name={key} type="number" min={0} max={time ? 86_400 : 2_000} />
      </label>)}</div>
    </details>
    <label className="field">External steps and blockers <small className="muted">Use fictional details. Required for blocked runs.</small>
      <textarea name="notes" rows={3} maxLength={800} />
    </label>
  </fieldset>;
}

function readRun(data: FormData): PilotBenchmarkRun {
  const handling: PilotHandling = {};
  for (const { key } of handlingRows) {
    const value = data.get(key);
    if (typeof value === "string" && value !== "") handling[key] = Number(value);
  }
  const notes = String(data.get("notes") ?? "").trim();
  return {
    seconds: Number(data.get("seconds")), repeatEntries: Number(data.get("repeatEntries")), systemSwitches: Number(data.get("systemSwitches")),
    ...(Object.keys(handling).length && { handling }), ...(notes && { notes }),
    ...(data.get("outcome") === "Blocked" && { outcome: "Blocked" as const }),
  };
}

function RunBoundary({ walkthrough }: { walkthrough: PilotWalkthrough }) {
  const boundary = pilotBenchmarkBoundaries[walkthrough];
  return <dl className="muted">
    <dt><strong>Start</strong></dt><dd>{boundary.start}</dd>
    <dt><strong>Stop</strong></dt><dd>{boundary.finish}</dd>
  </dl>;
}

type SaveRun = (action: Record<string, unknown>, onSaved: () => void, onError: (message: string) => void) => Promise<void>;

function PendingRun({ entry, busy, save, focus }: {
  entry: PendingPilotBenchmark; busy: boolean; save: SaveRun; focus: (id: string) => void;
}) {
  const [error, setError] = useState("");
  const [discardError, setDiscardError] = useState("");
  const next = entry.side === "orbit" ? "baseline" : "orbit";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const run = readRun(new FormData(event.currentTarget));
    setError("");
    void save({ type: "recordPilotBenchmarkRun", action: "finish", id: entry.id, side: next, run }, () => focus(entry.id), setError);
  };
  return <li className="document-item">
    <div className="document-item-head">
      <strong id={"pilot-benchmark-" + entry.id} tabIndex={-1}>{entry.caseLabel}</strong>
      <span className="pill">1 of 2 runs saved</span>
    </div>
    <p className="muted">{entry.walkthrough} · {pilotBenchmarkWorkflow[entry.side]} {entry.run.outcome === "Blocked" ? "blocked" : "completed"} · {displayMetric(entry.run.seconds, true)}</p>
    {entry.run.notes && <p className="pilot-benchmark-notes">{entry.run.notes}</p>}
    <details className="loan-task-create">
      <summary>Add {next === "orbit" ? "Orbit run" : "current workflow run"}</summary>
      <form className="record-form pilot-benchmark-form" onChange={() => { if (error) setError(""); }} onSubmit={submit}>
        <RunBoundary walkthrough={entry.walkthrough} />
        <RunFields />
        <div><Button type="submit" size="sm" disabled={busy}>Save matching run</Button></div>
        {error && <p className="application-message banner-error" role="alert">{error}</p>}
      </form>
    </details>
    <details className="document-form">
      <summary>Discard first run</summary>
      <p>Discard the saved run for {entry.caseLabel}?</p>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
        setDiscardError("");
        void save({ type: "recordPilotBenchmarkRun", action: "discard", id: entry.id }, () => focus("start"), setDiscardError);
      }}>Discard saved run</Button>
      {discardError && <p className="application-message banner-error" role="alert">{discardError}</p>}
    </details>
  </li>;
}

export function PilotBenchmarks({ benchmarks, pending, busy, save }: {
  benchmarks: PilotBenchmark[]; pending: PendingPilotBenchmark[]; busy: boolean; save: SaveRun;
}) {
  const [walkthrough, setWalkthrough] = useState<PilotWalkthrough>("Campaign lead to repeat loan");
  const attempt = useRef<{ id: string; fields: string } | null>(null);
  const start = useRef<HTMLDetailsElement>(null);
  const [focus, setFocus] = useState<{ id: string } | null>(null);
  const focusRecord = (id: string) => setFocus({ id });
  const [error, setError] = useState("");
  useEffect(() => {
    if (focus) document.getElementById("pilot-benchmark-" + focus.id)?.focus();
  }, [focus]);

  return <div className="record-form pilot-benchmarks">
    <div>
      <h3>Paired benchmarks</h3>
      <p className="muted">Use the same team and fictional case in both workflows. Save either run first.</p>
    </div>
    <details className="loan-task-create" ref={start}><summary id="pilot-benchmark-start">Start a benchmark</summary>
      <form className="record-form pilot-benchmark-form" onChange={() => { if (error) setError(""); }} onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const input = { type: "recordPilotBenchmarkRun", action: "start", walkthrough, caseLabel: data.get("caseLabel"), side: data.get("side"), run: readRun(data) };
        const fields = JSON.stringify(input);
        if (attempt.current?.fields !== fields) attempt.current = { id: crypto.randomUUID(), fields };
        const { id } = attempt.current;
        setError("");
        void save({ ...input, id }, () => {
          attempt.current = null;
          form.reset();
          if (start.current) start.current.open = false;
          focusRecord(id);
        }, setError);
      }}>
        <div className="form-grid pilot-benchmark-setup">
          <label className="field">Fictional case name<input name="caseLabel" required minLength={2} maxLength={80} placeholder="Example purchase and repeat loan" /></label>
          <label className="field">Comparison walkthrough<select value={walkthrough} onChange={(event) => setWalkthrough(event.target.value as PilotWalkthrough)}>
            {pilotWalkthroughs.map((item) => <option key={item}>{item}</option>)}
          </select></label>
          <label className="field">Workflow measured<select name="side" defaultValue="orbit">
            {(Object.keys(pilotBenchmarkWorkflow) as PilotBenchmarkSide[]).map(side => <option key={side} value={side}>{pilotBenchmarkWorkflow[side]}</option>)}
          </select></label>
        </div>
        <RunBoundary walkthrough={walkthrough} />
        <details className="document-form"><summary>How to count each measure</summary>
          <ul className="muted list-disc pl-5">
            <li>Count each field re-entered and each move between separate systems.</li>
            <li>Time active staff work by role. Count each transfer of responsibility as a handoff.</li>
            <li>Time periods blocked on a borrower, lender, or vendor. Count overlapping waits once.</li>
            <li>Leave unmeasured values blank. Enter zero when you observed no time or events.</li>
          </ul>
        </details>
        <RunFields />
        <div><Button size="sm" type="submit" disabled={busy}>Save first run</Button></div>
        {error && <p className="application-message banner-error" role="alert">{error}</p>}
      </form>
    </details>
    {!!pending.length && <>
      <h4>Waiting for a matching run</h4>
      <ul className="document-list">{pending.map(entry => <PendingRun key={entry.id} entry={entry} busy={busy} save={save} focus={focusRecord} />)}</ul>
    </>}
    {!!benchmarks.length && <h4>Completed comparisons</h4>}
    {benchmarks.length ? <ul className="document-list">{benchmarks.map((entry) => {
      const comparable = entry.baseline.outcome !== "Blocked" && entry.orbit.outcome !== "Blocked";
      return <li className="document-item" key={entry.id}>
        <strong id={"pilot-benchmark-" + entry.id} tabIndex={-1}>{entry.caseLabel}</strong><small className="muted">{entry.walkthrough} · {dateTime(entry.createdAt)} ET</small>
        {!comparable && <p className="muted">Both runs must reach the finish to compare their measurements.</p>}
        <div className="table-scroll pilot-benchmark-table" role="region" aria-label={`Comparison for ${entry.caseLabel}`} tabIndex={0}><table className="data-table">
          <caption className="sr-only">{entry.caseLabel}</caption>
          <thead><tr><th scope="col">Measure</th><th scope="col">Current workflow</th><th scope="col">Orbit</th><th scope="col">Orbit difference</th></tr></thead>
          <tbody>
          {!comparable && <tr><th scope="row">Outcome</th><td>{entry.baseline.outcome ?? "Completed"}</td><td>{entry.orbit.outcome ?? "Completed"}</td><td>—</td></tr>}
          {[
            ...metricRows.map(({ key, label }) => ({ key, label, time: key === "seconds", baseline: entry.baseline[key], orbit: entry.orbit[key] })),
            ...handlingRows.map((row) => ({ ...row, baseline: entry.baseline.handling?.[row.key], orbit: entry.orbit.handling?.[row.key] })),
          ].map(({ key, label, time, baseline, orbit }) => {
            if (baseline === undefined && orbit === undefined) return null;
            const difference = !comparable || baseline === undefined || orbit === undefined ? undefined : orbit - baseline;
            return <tr key={key}><th scope="row">{label}</th><td>{displayMetric(baseline, time)}</td><td>{displayMetric(orbit, time)}</td>
              <td>{difference === undefined ? "—" : difference === 0 ? "Same" : `${displayMetric(Math.abs(difference), time)} ${difference < 0 ? "less" : "more"}`}</td></tr>;
          })}</tbody>
        </table></div>
        {(entry.baseline.notes || entry.orbit.notes) && <dl className="pilot-benchmark-notes">
          {entry.baseline.notes && <><dt><strong>Current workflow notes</strong></dt><dd>{entry.baseline.notes}</dd></>}
          {entry.orbit.notes && <><dt><strong>Orbit notes</strong></dt><dd>{entry.orbit.notes}</dd></>}
        </dl>}
      </li>;
    })}</ul> : <p className="muted">Completed comparisons appear after both runs are saved.</p>}
  </div>;
}

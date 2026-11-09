"use client";

import { useRef, useState } from "react";
import { pilotBenchmarkBoundaries, pilotWalkthroughs, type PilotBenchmark, type PilotBenchmarkRun, type PilotHandling, type PilotWalkthrough } from "@/lib/brokerage-model";
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

function RunFields({ name, title }: { name: "orbit" | "baseline"; title: string }) {
  return <fieldset className="form-grid">
    <legend>{title}</legend>
    {metricRows.map(({ key, label, min, max }) => <label className="field" key={key}>{key === "seconds" ? "Elapsed seconds" : label}
      <input name={`${name}.${key}`} type="number" required min={min} max={max} />
    </label>)}
    <details className="document-form col-span-full"><summary>Handling and handoffs</summary>
      <div className="form-grid">{handlingRows.map(({ key, label, time }) => <label className="field" key={key}>{label}{time && " (seconds)"}
        <input name={`${name}.${key}`} type="number" min={0} max={time ? 86_400 : 2_000} />
      </label>)}</div>
    </details>
  </fieldset>;
}

export function PilotBenchmarks({ benchmarks, busy, save }: {
  benchmarks: PilotBenchmark[]; busy: boolean;
  save: (action: Record<string, unknown>, reset: () => void) => Promise<void>;
}) {
  const [walkthrough, setWalkthrough] = useState<PilotWalkthrough>("Campaign lead to repeat loan");
  const attempt = useRef<{ id: string; fields: string } | null>(null);
  const boundary = pilotBenchmarkBoundaries[walkthrough];

  return <div className="record-form">
    <div>
      <h3>Paired benchmarks</h3>
      <p className="muted">Use the same team and fictional case in both workflows.</p>
    </div>
    <details className="loan-task-create"><summary>Record a paired benchmark</summary>
      <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const metrics = (name: "orbit" | "baseline"): PilotBenchmarkRun => {
          const handling: PilotHandling = {};
          for (const { key } of handlingRows) {
            const value = data.get(`${name}.${key}`);
            if (typeof value === "string" && value !== "") handling[key] = Number(value);
          }
          return {
            seconds: Number(data.get(`${name}.seconds`)),
            repeatEntries: Number(data.get(`${name}.repeatEntries`)),
            systemSwitches: Number(data.get(`${name}.systemSwitches`)),
            ...(Object.keys(handling).length && { handling }),
          };
        };
        const input = { type: "recordPilotMeasurement", walkthrough, caseLabel: data.get("caseLabel"), orbit: metrics("orbit"), baseline: metrics("baseline") };
        const fields = JSON.stringify(input);
        if (attempt.current?.fields !== fields) attempt.current = { id: crypto.randomUUID(), fields };
        void save({ ...input, id: attempt.current.id }, () => { attempt.current = null; form.reset(); });
      }}>
        <div className="form-grid">
          <label className="field">Fictional case name<input name="caseLabel" required minLength={2} maxLength={80} placeholder="Example purchase and repeat loan" /></label>
          <label className="field">Comparison walkthrough<select value={walkthrough} onChange={(event) => setWalkthrough(event.target.value as PilotWalkthrough)}>
            {pilotWalkthroughs.map((item) => <option key={item}>{item}</option>)}
          </select></label>
        </div>
        <dl className="muted">
          <dt><strong>Start</strong></dt><dd>{boundary.start}</dd>
          <dt><strong>Stop</strong></dt><dd>{boundary.finish}</dd>
        </dl>
        <details className="document-form"><summary>How to count each measure</summary>
          <ul className="muted list-disc pl-5">
            <li>Count each field re-entered and each move between separate systems.</li>
            <li>Time active staff work by role. Count each transfer of responsibility as a handoff.</li>
            <li>Time periods blocked on a borrower, lender, or vendor. Count overlapping waits once.</li>
            <li>Leave unmeasured values blank. Enter zero when you observed no time or events.</li>
          </ul>
        </details>
        <RunFields name="baseline" title="Current brokerage workflow" />
        <RunFields name="orbit" title="Orbit" />
        <div><Button size="sm" type="submit" disabled={busy}>Save paired benchmark</Button></div>
      </form>
    </details>
    {benchmarks.length ? <ul className="document-list">{benchmarks.map((entry) => <li className="document-item" key={entry.id}>
      <strong>{entry.caseLabel}</strong><small className="muted">{entry.walkthrough} · {dateTime(entry.createdAt)} ET</small>
      <div className="table-scroll pilot-benchmark-table" role="region" aria-label={`Comparison for ${entry.caseLabel}`} tabIndex={0}><table className="data-table">
        <caption className="sr-only">{entry.caseLabel}</caption>
        <thead><tr><th scope="col">Measure</th><th scope="col">Current workflow</th><th scope="col">Orbit</th><th scope="col">Orbit difference</th></tr></thead>
        <tbody>{[
          ...metricRows.map(({ key, label }) => ({ key, label, time: key === "seconds", baseline: entry.baseline[key], orbit: entry.orbit[key] })),
          ...handlingRows.map((row) => ({ ...row, baseline: entry.baseline.handling?.[row.key], orbit: entry.orbit.handling?.[row.key] })),
        ].map(({ key, label, time, baseline, orbit }) => {
          if (baseline === undefined && orbit === undefined) return null;
          const difference = baseline === undefined || orbit === undefined ? undefined : orbit - baseline;
          return <tr key={key}><th scope="row">{label}</th><td>{displayMetric(baseline, time)}</td><td>{displayMetric(orbit, time)}</td>
            <td>{difference === undefined ? "—" : difference === 0 ? "Same" : `${displayMetric(Math.abs(difference), time)} ${difference < 0 ? "less" : "more"}`}</td></tr>;
        })}</tbody>
      </table></div>
    </li>)}</ul> : <p className="muted">Save both runs to see the comparison here.</p>}
  </div>;
}

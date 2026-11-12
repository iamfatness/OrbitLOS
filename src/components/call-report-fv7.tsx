"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessReportingReadiness } from "@/app/actions";
import { quarterName, type Quarter, type QuarterReviewSummary } from "@/lib/call-report-quarter-model";
import { fv7EvidenceFileLimit, type ReportingReadiness } from "@/lib/call-report-readiness-model";
import { money } from "@/lib/utils";
import { Button } from "./ui/button";
import { downloadSampleFile } from "./sample-download";

type Workpaper = Extract<ReportingReadiness, { kind: "fv7Preview" }>["workpaper"];
const totals = (value: { count: number; amount: number } | null) => value
  ? `${value.count} · ${value.amount === 0 ? "$0" : money(value.amount)}` : "Needs evidence";

function Fv7EvidenceForm({ brokerageId, period, version, openLoan }: {
  brokerageId: string; period: Quarter; version: number; openLoan: (loanId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [workpaper, setWorkpaper] = useState<Workpaper>();
  const [stateFilter, setStateFilter] = useState("");
  const [fileLimit, setFileLimit] = useState(10);
  const feedback = useRef<HTMLParagraphElement>(null);
  const pending = useRef(false);
  const fileName = `orbit-fv7-${period.year}-Q${period.quarter}-v${version}`;

  useEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);

  async function run(type: "fv7Template" | "fv7Preview", file?: File) {
    if (pending.current) return;
    if (type === "fv7Preview") {
      setWorkpaper(undefined);
      if (!file?.size || file.size > fv7EvidenceFileLimit) {
        setMessage({ text: "Choose a reviewed JSON evidence file under 1 MB.", error: true });
        return;
      }
    }
    pending.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const target = { ...period, version };
      const result = await accessReportingReadiness(type === "fv7Preview"
        ? { ...target, type, evidence: await file!.text() } : { ...target, type }, brokerageId);
      if ("error" in result) {
        setMessage({ text: result.error, error: true });
      } else if (result.kind === "fv7Template") {
        downloadSampleFile(result.json, `${fileName}-evidence.json`, "application/json");
        setMessage({ text: "Evidence template downloaded." });
      } else if (result.kind === "fv7Preview") {
        setWorkpaper(result.workpaper);
        setStateFilter("");
        setFileLimit(10);
        setMessage({ text: result.workpaper.reconciled ? "Reviewed totals reconcile for the supplied evidence." : "Review the differences below." });
      }
    } catch {
      setMessage({ text: "Could not check the selected review. Try again.", error: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("evidence");
    void run("fv7Preview", file instanceof File ? file : undefined);
  }

  const files = workpaper?.evidence.files.filter(file => !stateFilter || file.state === stateFilter) ?? [];
  return <>
    <div><Button variant="outline" size="sm" disabled={busy} onClick={() => void run("fv7Template")}>Download evidence template</Button></div>
    <form className="record-form" onSubmit={submit}>
      <label className="field">Reviewed evidence file
        <input type="file" name="evidence" accept=".json,application/json" required disabled={busy}
          onChange={() => { setWorkpaper(undefined); setMessage(undefined); }} />
      </label>
      <p className="muted">Fill in the template’s entity, prior balances, intake source and evidence references. Include reporting states with zero activity.</p>
      <div><Button type="submit" size="sm" disabled={busy}>{busy ? "Checking evidence…" : "Check evidence"}</Button></div>
    </form>
    {message && <p ref={feedback} tabIndex={-1} role={message.error ? "alert" : "status"}>{message.text}</p>}
    {workpaper && <div className="record-form" aria-label="FV7 workpaper results" role="region">
      <div>
        <h4>{quarterName(period)} · Review v{version}</h4>
        <p className="break-words">Entity {workpaper.evidence.entityReference} · {workpaper.evidence.files.length} reviewed {workpaper.evidence.files.length === 1 ? "file" : "files"}</p>
        <p>Application pipeline · {workpaper.pipelineReconciled ? "Reconciled" : "Needs review"}</p>
        <p>Funded ledger and MLO evidence · {workpaper.fundedReview ? workpaper.fundedReview.reconciled ? "Reconciled" : "Needs review" : "Evidence not supplied"}</p>
      </div>
      <label className="field">Reporting state<select value={stateFilter} onChange={event => {
        setStateFilter(event.target.value);
        setFileLimit(10);
      }}><option value="">All reviewed states</option>{workpaper.states.map(({ state }) => <option key={state}>{state}</option>)}</select></label>
      {workpaper.states.filter(({ state }) => !stateFilter || state === stateFilter).map(({ state, direct, thirdParty, issues }) =>
        <article className="work-queue" key={state}>
          <h4>{state}</h4>
          <div className="grid gap-3 sm:grid-cols-2">{([["Direct", direct], ["Third party", thirdParty]] as const).map(([label, column]) =>
            <div key={label}>
              <strong>{label}</strong>
              <p>AC066 pipeline · {totals(column.calculated.AC066)}</p>
              <p>AC090 funded and ending · {totals(column.calculated.AC090)}</p>
              {!!column.issues.length && <ul>{column.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
            </div>)}</div>
          {[...issues, ...(workpaper.fundedReview?.states.find(item => item.state === state)?.issues ?? [])].map(issue => <p key={issue}>{issue}</p>)}
        </article>)}
      {workpaper.fundedReview?.issues.map(issue => <p key={issue}>{issue}</p>)}
      <details className="document-form">
        <summary>Loan evidence · {files.length} {files.length === 1 ? "file" : "files"}</summary>
        <ul className="document-list">{files.slice(0, fileLimit).map(file => <li className="document-item" key={file.loanId}>
          <p>{file.state} · {file.source === "direct" ? "Direct" : "Third party"} · {file.lines.join(" / ")} · Facts v{file.revision}</p>
          <p className="muted break-words">Intake reference {file.intakeReference}</p>
          <div><Button size="sm" variant="outline" onClick={() => openLoan(file.loanId)}>Open loan facts</Button></div>
        </li>)}</ul>
        {files.length > fileLimit && <div><Button variant="outline" size="sm" onClick={() => setFileLimit(limit => limit + 10)}>Show more loans</Button></div>}
      </details>
      <div><Button size="sm" variant="outline" onClick={() =>
        downloadSampleFile(JSON.stringify(workpaper, null, 2), `${fileName}-workpaper.json`, "application/json")}>Download internal workpaper</Button></div>
    </div>}
  </>;
}

export function Fv7QuarterReview({ brokerageId, period, reviews, openLoan }: {
  brokerageId: string; period: Quarter; reviews: QuarterReviewSummary[]; openLoan: (loanId: string) => void;
}) {
  const [selection, setSelection] = useState(0);
  const version = reviews.find(item => item.version === selection)?.version ?? reviews[0]?.version;
  return <details className="document-form">
    <summary>FV7 evidence workpaper</summary>
    <div className="record-form">
      <p className="muted">Check a saved 2026 quarter with reviewed evidence in this fictional pilot. Download the result for internal review.</p>
      {version ? <>
        <label className="field">Saved quarter review<select value={version} onChange={event => setSelection(Number(event.target.value))}>
          {reviews.map(item => <option key={item.version} value={item.version}>Review v{item.version} · {item.count} {item.count === 1 ? "record" : "records"}</option>)}
        </select></label>
        <Fv7EvidenceForm key={version} brokerageId={brokerageId} period={period} version={version} openLoan={openLoan} />
      </> : <p>Save a review after the quarter ends to check FV7 evidence.</p>}
    </div>
  </details>;
}

"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { accessReportingReadiness } from "@/app/actions";
import { quarterName, type Quarter, type QuarterReviewSummary } from "@/lib/call-report-quarter-model";
import { fv7EvidenceFileLimit, type Fv7SavedWorkpaper, type Fv7Workpaper, type ReportingReadiness } from "@/lib/call-report-readiness-model";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";
import { downloadSampleFile } from "./sample-download";

const totals = (value: { count: number; amount: number } | null) => value
  ? `${value.count} · ${value.amount === 0 ? "$0" : money(value.amount)}` : "Needs evidence";

function Fv7EvidenceForm({ brokerageId, period, version, openLoan, onSaved }: {
  brokerageId: string; period: Quarter; version: number; openLoan: (loanId: string) => void; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [workpaper, setWorkpaper] = useState<Fv7Workpaper>();
  const [saved, setSaved] = useState<Fv7SavedWorkpaper>();
  const [checked, setChecked] = useState("");
  const preview = useRef<{ evidence: string; checked: string }>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const pending = useRef(false);
  const fileName = `orbit-fv7-${period.year}-Q${period.quarter}-v${version}`;

  useEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);

  async function run(type: "fv7Template" | "fv7Preview" | "fv7Save", file?: File) {
    if (pending.current) return;
    if (type === "fv7Preview") {
      clearPreview();
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
      const evidence = type === "fv7Preview" ? await file?.text() : undefined;
      const source = preview.current;
      const request = type === "fv7Save" && source ? { ...target, type, ...source } :
        type === "fv7Preview" && evidence ? { ...target, type, evidence } : { ...target, type: "fv7Template" };
      if (type !== request.type) return;
      const result = await accessReportingReadiness(request, brokerageId);
      if ("error" in result) {
        setMessage({ text: result.error, error: true });
      } else if (result.kind === "fv7Template") {
        downloadSampleFile(result.json, `${fileName}-evidence.json`, "application/json");
        setMessage({ text: "Evidence template downloaded." });
      } else if (result.kind === "fv7Preview" && evidence) {
        setWorkpaper(result.workpaper);
        preview.current = { evidence, checked: result.checked };
        setChecked(result.checked);
        setMessage({ text: result.workpaper.reconciled ? "Reviewed totals reconcile for the supplied evidence." : "Review the differences below." });
      } else if (result.kind === "fv7Saved") {
        setSaved(result.saved);
        onSaved();
        setMessage({ text: `Workpaper #${result.saved.sequence} saved to review v${result.saved.version}.` });
      }
    } catch {
      setMessage({ text: "Could not check the selected review. Try again.", error: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function clearPreview() {
    preview.current = null;
    setWorkpaper(undefined);
    setSaved(undefined);
    setChecked("");
    setMessage(undefined);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("evidence");
    void run("fv7Preview", file instanceof File ? file : undefined);
  }

  return <>
    <div><Button variant="outline" size="sm" disabled={busy} onClick={() => void run("fv7Template")}>Download evidence template</Button></div>
    <form className="record-form" onSubmit={submit}>
      <label className="field">Reviewed evidence file
        <input type="file" name="evidence" accept=".json,application/json" required disabled={busy}
          onChange={clearPreview} />
      </label>
      <p className="muted">Fill in the template’s entity, prior balances, intake source and evidence references. Include reporting states with zero activity.</p>
      <div><Button type="submit" size="sm" disabled={busy}>{busy ? "Checking evidence…" : "Check evidence"}</Button></div>
    </form>
    {message && <p ref={feedback} tabIndex={-1} role={message.error ? "alert" : "status"}>{message.text}</p>}
    {workpaper && <Fv7Results key={checked} period={period} version={version} workpaper={workpaper}
      saved={saved} openLoan={openLoan} actions={!saved && <Button size="sm" disabled={busy} onClick={() => void run("fv7Save")}>
        Save workpaper</Button>} />}
  </>;
}

function Fv7Results({ period, version, workpaper, openLoan, actions, saved }: {
  period: Quarter; version: number; workpaper: Fv7Workpaper; openLoan: (loanId: string) => void;
  actions?: ReactNode; saved?: Fv7SavedWorkpaper;
}) {
  const [stateFilter, setStateFilter] = useState("");
  const [fileLimit, setFileLimit] = useState(10);
  const files = workpaper.evidence.files.filter(file => !stateFilter || file.state === stateFilter);
  const fileName = `orbit-fv7-${period.year}-Q${period.quarter}-v${version}-workpaper${saved ? `-${saved.sequence}` : ""}`;
  return <div className="record-form" aria-label={saved ? "Saved FV7 workpaper" : "FV7 workpaper results"} role="region">
      <div>
        <h4>{quarterName(period)} · Review v{version}{saved && ` · Workpaper #${saved.sequence}`}</h4>
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
      <div className="loan-application-actions">
        {actions}
        <Button size="sm" variant="outline" onClick={() =>
          downloadSampleFile(JSON.stringify(workpaper, null, 2), `${fileName}.json`, "application/json")}>Download internal workpaper</Button>
      </div>
    </div>;
}

function Fv7WorkpaperHistory({ brokerageId, period, openLoan, historyVersion }: {
  brokerageId: string; period: Quarter; openLoan: (loanId: string) => void; historyVersion: number;
}) {
  type History = Extract<ReportingReadiness, { kind: "fv7History" }>;
  type Saved = Extract<ReportingReadiness, { kind: "fv7Read" }>;
  const [started, setStarted] = useState(false);
  const [before, setBefore] = useState<number>();
  const [retry, setRetry] = useState(0);
  const [listed, setListed] = useState<{ key: string; result: History | { error: string } }>();
  const [selected, setSelected] = useState<Saved | { error: string }>();
  const [opening, setOpening] = useState(false);
  const opened = useRef<HTMLDivElement>(null);
  const { year, quarter } = period;
  const key = `${before ?? ""}:${historyVersion}:${retry}`;
  const list = listed?.key === key ? listed.result : undefined;

  useEffect(() => {
    if (!started) return;
    let active = true;
    const failure = { error: "Could not load saved workpapers. Try again." };
    void accessReportingReadiness({ type: "fv7History", year, quarter, before }, brokerageId).then(result => {
      if (active) setListed({ key, result: "error" in result || result.kind === "fv7History" ? result : failure });
    }, () => { if (active) setListed({ key, result: failure }); });
    return () => { active = false; };
  }, [started, key, before, brokerageId, year, quarter]);

  useEffect(() => {
    if (selected) opened.current?.focus();
  }, [selected]);

  async function open(sequence: number) {
    setOpening(true);
    setSelected(undefined);
    const failure = { error: "Could not reopen this workpaper. Try again." };
    try {
      const result = await accessReportingReadiness({ type: "fv7Read", year, quarter, sequence }, brokerageId);
      setSelected("error" in result || result.kind === "fv7Read" ? result : failure);
    } catch {
      setSelected(failure);
    } finally {
      setOpening(false);
    }
  }

  return <details className="document-form" onToggle={event => { if (event.currentTarget.open) setStarted(true); }}>
    <summary>Saved workpapers</summary>
    {started && <section className="record-form" aria-label="Saved FV7 workpapers">
      {!list && <p role="status">Loading saved workpapers…</p>}
      {list && "error" in list && <>
        <p role="alert">{list.error}</p>
        <div><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>Retry history</Button></div>
      </>}
      {list && !("error" in list) && <>
        {!list.items.length && <p>No workpapers saved for this quarter.</p>}
        <ul className="document-list">{list.items.map(item => <li className="document-item" key={item.sequence}>
          <p><strong>Workpaper #{item.sequence}</strong> · Review v{item.version} · {item.reconciled ? "Reconciled" : "Needs review"}</p>
          <p className="muted break-words">{item.entityReference} · {item.recordedBy} · {dateTime(item.recordedAt)} ET</p>
          <div><Button variant="outline" size="sm" disabled={opening}
            onClick={() => void open(item.sequence)}>Open workpaper #{item.sequence}</Button></div>
        </li>)}</ul>
        {(before || list.next) && <div className="loan-application-actions">
          {before && <Button variant="outline" size="sm" onClick={() => setBefore(undefined)}>Latest workpapers</Button>}
          {list.next && <Button variant="outline" size="sm" onClick={() => setBefore(list.next ?? undefined)}>Older workpapers</Button>}
        </div>}
      </>}
      {opening && <p role="status">Opening saved workpaper…</p>}
      {selected && <div ref={opened} tabIndex={-1} className="record-form">
        {"error" in selected ? <p role="alert">{selected.error}</p> :
          <Fv7Results key={selected.saved.sequence} period={period} version={selected.saved.version} workpaper={selected.workpaper}
            saved={selected.saved} openLoan={openLoan} actions={<Button variant="outline" size="sm" onClick={() =>
              downloadSampleFile(selected.evidence, `orbit-fv7-${year}-Q${quarter}-workpaper-${selected.saved.sequence}-evidence.json`, "application/json")}>
              Download saved evidence</Button>} />}
      </div>}
    </section>}
  </details>;
}

export function Fv7QuarterReview({ brokerageId, period, reviews, openLoan }: {
  brokerageId: string; period: Quarter; reviews: QuarterReviewSummary[]; openLoan: (loanId: string) => void;
}) {
  const [selection, setSelection] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const version = reviews.find(item => item.version === selection)?.version ?? reviews[0]?.version;
  return <details className="document-form">
    <summary>FV7 evidence workpaper</summary>
    <div className="record-form">
      <p className="muted">Check a saved 2026 quarter with reviewed evidence in this fictional pilot. Save the result for internal review.</p>
      <Fv7WorkpaperHistory brokerageId={brokerageId} period={period} openLoan={openLoan} historyVersion={historyVersion} />
      {version ? <>
        <label className="field">Saved quarter review<select value={version} onChange={event => setSelection(Number(event.target.value))}>
          {reviews.map(item => <option key={item.version} value={item.version}>Review v{item.version} · {item.count} {item.count === 1 ? "record" : "records"}</option>)}
        </select></label>
        <Fv7EvidenceForm key={version} brokerageId={brokerageId} period={period} version={version} openLoan={openLoan}
          onSaved={() => setHistoryVersion(current => current + 1)} />
      </> : <p>Save a review after the quarter ends to check FV7 evidence.</p>}
    </div>
  </details>;
}

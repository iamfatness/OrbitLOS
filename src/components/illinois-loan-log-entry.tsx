"use client";

import { useEffect, useRef, useState } from "react";
import { accessLoanRetention } from "@/app/actions";
import { illinoisLoanLogRequest, illinoisLogGaps, type IllinoisLogFacts as Facts, type IllinoisLogStatus } from "@/lib/illinois-loan-log-model";
import type { IllinoisLoanLogResult } from "@/lib/illinois-loan-log";
import { dateTime } from "@/lib/utils";
import { IllinoisLoanLogFields, IllinoisLoanLogFacts } from "./illinois-loan-log-fields";
import { RecordsGroup, RegisterChoice as Choice, RegisterField as Field } from "./retention-register-fields";
import { Button } from "./ui/button";

type History = Extract<IllinoisLoanLogResult, { kind: "illinoisLogHistory" }>;
type Entry = History["versions"][number];
type Candidate = Extract<IllinoisLoanLogResult, { kind: "illinoisLogCandidates" }>["items"][number];
export type IllinoisLogSelection = { kind: "new" | "existing"; entryId: string; candidate?: Candidate };
type Draft = { facts: Facts; status: IllinoisLogStatus; evidence: string; correction: string };

function blank(candidate?: Candidate): Draft {
  return { facts: { product: "Unresolved", borrowers: candidate ? [{ name: candidate.borrower }] : [], originators: [], processors: [],
    appraisers: [], sellers: [], outcome: "Unresolved", exceptions: {} }, status: "Draft", evidence: "", correction: "" };
}

function Details({ entry }: { entry: Entry }) {
  const { facts } = entry;
  const gaps = illinoisLogGaps(facts);
  return <div className="record-form min-w-0 break-words">
    <p><strong>{entry.status}</strong> · Version {entry.version} · {entry.actor} · {dateTime(entry.at)} ET</p>
    <p className="muted">{entry.entity.name} · {entry.loanId ? "Linked Orbit loan" : "Outside application"}</p>
    <dl className="record-form">
      <div><dt>Product and outcome</dt><dd>{facts.product}{facts.highRisk && ` · ${facts.highRisk}`}
        {facts.product !== "Reverse mortgage" && ` · ${facts.outcome}`}</dd></div>
      <div><dt>Application date</dt><dd>{facts.applicationDate ?? "Unresolved"}</dd></div>
      {facts.fileNumber && <div><dt>File number</dt><dd>{facts.fileNumber}</dd></div>}
      {facts.borrowers.length > 0 && <div><dt>Borrowers</dt><dd>{facts.borrowers.map(person => person.name).join(" · ")}</dd></div>}
      <div><dt>Evidence reference</dt><dd>{entry.evidence}</dd></div>
      {entry.correction && <div><dt>Reason for change</dt><dd>{entry.correction}</dd></div>}
    </dl>
    {entry.reviewIssue && <p><strong>Reconciliation needed</strong> · {entry.reviewIssue}</p>}
    {!!gaps.length && <RecordsGroup title={`Evidence to review · ${gaps.length}`}><ul className="loan-task-list">
      {gaps.map(gap => <li key={gap}>{gap}</li>)}
    </ul></RecordsGroup>}
    <IllinoisLoanLogFacts facts={facts} />
  </div>;
}

export function IllinoisLoanLogEntry({ brokerageId, entityId, selection, onBack, onSaved }: {
  brokerageId: string; entityId: string; selection: IllinoisLogSelection; onBack: () => void; onSaved: () => void;
}) {
  const [history, setHistory] = useState<History>();
  const [draft, setDraft] = useState<Draft | undefined>(() => selection.kind === "new" ? blank(selection.candidate) : undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const formHeading = useRef<HTMLLegendElement>(null);
  const correctionAction = useRef<HTMLButtonElement>(null);
  const reloadAction = useRef<HTMLButtonElement>(null);
  const problem = useRef<HTMLParagraphElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const restoreFocus = useRef(false);
  const request = useRef<{ fingerprint: string; id: string }>(null);
  const latest = history?.versions[0];
  const stale = error.includes("entry changed");
  const editing = Boolean(draft);
  const pending = selection.kind === "existing" && !history && !error;
  const name = latest?.facts.borrowers[0]?.name ?? selection.candidate?.borrower ?? "Outside application";

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (editing && latest) formHeading.current?.focus(); }, [editing, latest]);
  useEffect(() => { if (error) problem.current?.focus(); }, [error]);
  useEffect(() => { if (notice) receipt.current?.focus(); }, [notice]);
  useEffect(() => {
    if (restoreFocus.current && history && !editing && !busy) {
      (correctionAction.current ?? reloadAction.current ?? heading.current)?.focus();
      restoreFocus.current = false;
    }
  }, [history, editing, busy]);
  useEffect(() => {
    if (selection.kind === "new") return;
    let active = true;
    void accessLoanRetention({ type: "illinoisLoanLog", entityId,
      input: { operation: "history", entryId: selection.entryId } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "illinoisLogHistory") setHistory(result);
    }).catch(() => { if (active) setError("Could not load the Illinois loan log entry. Reload to try again."); });
    return () => { active = false; };
  }, [brokerageId, entityId, selection.entryId, selection.kind, reload]);

  function reset() {
    setDraft(undefined);
    setError("");
    setNotice("");
    request.current = null;
    restoreFocus.current = true;
  }
  function reloadEntry() {
    reset();
    setHistory(undefined);
    setReload(value => value + 1);
  }
  function changeEntry(status: IllinoisLogStatus) {
    if (!latest) return;
    setError("");
    setNotice("");
    setDraft({ facts: latest.facts, evidence: latest.evidence, status, correction: "" });
  }
  async function save() {
    if (!draft || busy || stale) return;
    const input = { operation: "save", entryId: selection.entryId, expected: latest?.version ?? 0,
      loanId: latest?.loanId ?? selection.candidate?.loanId ?? null, status: draft.status, facts: draft.facts,
      evidence: draft.evidence, correction: latest ? draft.correction : undefined };
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    const parsed = illinoisLoanLogRequest.safeParse({ type: "illinoisLoanLog", entityId, input: { ...input, requestId: request.current.id } });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path[1];
      setError(issue?.code === "custom" ? issue.message : field === "evidence" || field === "correction"
        ? "Enter at least four characters for the evidence reference and any correction reason."
        : "Check the application dates, amounts, names and identifiers. Remove any empty person rows.");
      problem.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accessLoanRetention(parsed.data, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "illinoisLogHistory") {
        setHistory(result);
        setDraft(undefined);
        request.current = null;
        setNotice(`Illinois loan log entry saved. Current version ${result.versions[0].version}.`);
        onSaved();
      }
    } catch {
      setError("Could not confirm the save. Try again with the same evidence.");
    } finally {
      setBusy(false);
    }
  }
  async function older() {
    if (!history?.next || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await accessLoanRetention({ type: "illinoisLoanLog", entityId, input: {
        operation: "history", entryId: selection.entryId, before: history.next,
      } }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "illinoisLogHistory") {
        setHistory({ ...history, next: result.next, versions: [...history.versions, ...result.versions] });
        if (!result.next) restoreFocus.current = true;
      }
    } catch { setError("Could not load older versions. Try again."); }
    finally { setBusy(false); }
  }

  const feedback = error && <p role="alert" ref={problem} tabIndex={-1}>{error}</p>;
  const withdrawing = draft?.status === "Withdrawn";
  return <section className="record-form min-w-0 w-full max-w-2xl" aria-label="Illinois loan log entry" aria-busy={busy || pending}>
    <div className="section-heading">
      <h3 className="break-words" ref={heading} tabIndex={-1}>{name}</h3>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onBack}>Back to loan log</Button>
    </div>
    {notice && <p role="status" ref={receipt} tabIndex={-1}>{notice}</p>}
    {!draft && feedback}
    {pending && <p role="status">Loading loan log entry…</p>}
    {history && !latest && <p>Entry unavailable for this legal entity.</p>}
    {selection.candidate && draft && <RecordsGroup title="Orbit file references">
      <p>{selection.candidate.stage} · {selection.candidate.disposition}</p>
      {selection.candidate.reportedApplicationDate && <p>Reported application date · {selection.candidate.reportedApplicationDate}</p>}
      {selection.candidate.propertyState && <p>Property state · {selection.candidate.propertyState}</p>}
      {selection.candidate.reportState && <p>Reporting state · {selection.candidate.reportState}</p>}
    </RecordsGroup>}
    {!draft && latest && <>
      <Details entry={latest} />
      <div className="loan-application-actions">
        <Button type="button" className="min-h-11" ref={correctionAction} disabled={busy}
          onClick={() => changeEntry(latest.status === "Withdrawn" ? "Draft" : latest.status)}>Record correction</Button>
        {latest.status !== "Withdrawn" && <Button type="button" variant="outline" className="min-h-11" disabled={busy}
          onClick={() => changeEntry("Withdrawn")}>Withdraw entry</Button>}
      </div>
    </>}
    {!draft && error && <div><Button type="button" variant="outline" className="min-h-11" ref={reloadAction} onClick={reloadEntry}>Reload entry</Button></div>}
    {draft && <form className="record-form min-w-0" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="record-form min-w-0" disabled={busy || stale}>
        <legend ref={formHeading} tabIndex={-1} className="mb-2 font-semibold">{withdrawing ? "Withdraw entry" : latest ? "Correct entry" : "Record application"}</legend>
        {withdrawing ? <p>Withdrawal removes this entry from future workbooks and preserves its history.</p> : <>
          <IllinoisLoanLogFields facts={draft.facts} change={facts => setDraft({ ...draft, facts })} />
          <Choice label="Entry status" value={draft.status as Exclude<IllinoisLogStatus, "Withdrawn">} options={["Draft", "Reviewed"]}
            change={status => setDraft({ ...draft, status })} />
          <Field label="Evidence reference" multiline limit={240} value={draft.evidence}
            change={evidence => setDraft({ ...draft, evidence })} />
        </>}
        {latest && <Field label="Reason for change" multiline limit={240} value={draft.correction}
          change={correction => setDraft({ ...draft, correction })} />}
      </fieldset>
      {feedback}
      <div className="loan-application-actions">
        <Button type="submit" className="min-h-11" disabled={busy || stale}>{busy ? "Saving…" : withdrawing ? "Confirm withdrawal" : "Save loan log entry"}</Button>
        {stale ? <Button type="button" variant="outline" className="min-h-11" onClick={latest ? reloadEntry : onBack}>Reload and discard draft</Button> :
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={latest ? reset : onBack}>Cancel edit</Button>}
      </div>
    </form>}
    {!draft && history && history.versions.length > 1 && <RecordsGroup title="Previous versions">
      {history.versions.slice(1).map(entry => <RecordsGroup key={entry.version} title={`Version ${entry.version} · ${dateTime(entry.at)} ET`}>
        <Details entry={entry} />
      </RecordsGroup>)}
      {history.next && <div><Button type="button" variant="outline" className="min-h-11" disabled={busy}
        onClick={() => void older()}>Load older versions</Button></div>}
    </RecordsGroup>}
  </section>;
}

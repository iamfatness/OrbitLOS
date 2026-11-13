"use client";

import { useEffect, useRef, useState } from "react";
import { accessLoanRetention } from "@/app/actions";
import { illinoisFileDocuments, illinoisRecordsSources, illinoisRecordkeepingRequest,
  type IllinoisRecordkeepingFacts as Facts } from "@/lib/illinois-recordkeeping-model";
import type { IllinoisRecordkeepingResult } from "@/lib/illinois-recordkeeping";
import { dateTime } from "@/lib/utils";
import { RecordsGroup, RegisterField } from "./retention-register-fields";
import { IllinoisRecordkeepingFields } from "./illinois-recordkeeping-fields";
import { Button } from "./ui/button";

type History = Extract<IllinoisRecordkeepingResult, { kind: "illinoisRecordkeeping" }>;
type Version = History["versions"][number];
const empty = (): Facts => ({ activity: "Unresolved", risk: "Unresolved", outcome: { status: "Unresolved" },
  documents: {}, archive: { format: "Unresolved" } });
const sourceLabels: Record<string, string> = {
  [illinoisRecordsSources.file]: "Application file rule",
  [illinoisRecordsSources.retention]: "Retention rule",
  [illinoisRecordsSources.highRisk]: "High-risk file rule",
};

function Evidence({ version, finding = version.finding }: { version: Version; finding?: Version["finding"] }) {
  const { facts: { activity, activityReference, risk, riskReference, outcome, documents, archive } } = version;
  return <div className="record-form min-w-0 break-words">
    <p className="muted">{version.actor} · {dateTime(version.at)} ET</p>
    {version.correction && <p><strong>Correction</strong> · {version.correction}</p>}
    <dl className="record-form">
      <div><dt>Application outcome</dt><dd><strong>{outcome.status}</strong>{"on" in outcome && ` · ${outcome.on}`}</dd></div>
      <div><dt>Illinois retention review date</dt><dd><strong>{finding.stateReviewDate ?? "Unresolved"}</strong>
        {finding.stateMonths && ` · ${finding.stateMonths} months`}</dd></div>
    </dl>
    {finding.findings.length > 0 ? <RecordsGroup title={`Evidence to review · ${finding.findings.length}`}>
      <ul className="loan-task-list">{finding.findings.map(item => <li key={item.key} className="border-b border-[var(--line)] py-2">
        {item.message} <a className="underline" href={item.source}>{sourceLabels[item.source]}</a>
      </li>)}</ul>
    </RecordsGroup> : <p>No gaps flagged in this evidence review.</p>}
    <RecordsGroup title="Recorded evidence">
      <dl className="record-form">
        <div><dt>Illinois activity</dt><dd>{activity}{activityReference && ` · ${activityReference}`}</dd></div>
        <div><dt>High-risk home loan classification</dt><dd>{risk}{riskReference && ` · ${riskReference}`}</dd></div>
        {"on" in outcome && <div><dt>{outcome.status === "Closed" ? "Closing evidence" : "Termination evidence"}</dt><dd>{outcome.on} · {outcome.reference}</dd></div>}
        {Object.entries(documents).map(([key, item]) => <div key={key}>
          <dt>{illinoisFileDocuments[key as keyof typeof illinoisFileDocuments]}</dt><dd>{item.status} · {item.reference}</dd>
        </div>)}
        <div><dt>Retention medium</dt><dd>{archive.format}{"location" in archive && ` · ${archive.location}`}</dd></div>
        {"conversion" in archive && <>
          {archive.reproduction && <div><dt>Legible hard-copy reproduction check</dt><dd>{archive.reproduction.on} · {archive.reproduction.reference}</dd></div>}
          {archive.changesPreserved && <div><dt>Preservation of alterations check</dt><dd>{archive.changesPreserved.on} · {archive.changesPreserved.reference}</dd></div>}
          <div><dt>Paper conversion</dt><dd>{archive.conversion.status}
            {archive.conversion.status === "No paper conversion" && ` · ${archive.conversion.reference}`}</dd></div>
          {archive.conversion.status === "Paper converted" && archive.conversion.batches.map((batch, index) => <div key={index}>
            <dt>Conversion {index + 1} · {batch.on}</dt>
            <dd>{batch.method}</dd><dd>Paper originals · {batch.originals}</dd><dd>{batch.reference}</dd>
          </div>)}
        </>}
      </dl>
    </RecordsGroup>
  </div>;
}

function validation(path: readonly PropertyKey[] | undefined) {
  if (path?.[0] === "correction") return "Enter at least four characters for the correction reason.";
  if (path?.[1] === "outcome") return "Enter a valid closing or termination date and its evidence reference.";
  if (path?.[1] === "documents") {
    const label = illinoisFileDocuments[path[2] as keyof typeof illinoisFileDocuments];
    if (label) return `Enter a reference for ${label} in Application file documents.`;
  }
  if (path?.[1] === "archive") {
    if (path[2] === "conversion" && typeof path[4] === "number")
      return `Enter the date, method, original disposition and reference for conversion ${path[4] + 1}.`;
    return "Check the dates and references in Archive and paper conversion. Enter at least four characters per reference.";
  }
  return "Check the dates and references. Enter at least four characters per reference.";
}

export function IllinoisRecordkeeping({ brokerageId, loan, onBack, backLabel = "Back to loan retention" }: {
  brokerageId: string; loan: { id: string; label: string }; onBack: () => void; backLabel?: string;
}) {
  const [history, setHistory] = useState<History>();
  const [draft, setDraft] = useState<Facts>();
  const [correction, setCorrection] = useState("");
  const [loadId, setLoadId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<{ fingerprint: string; id: string }>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const legend = useRef<HTMLLegendElement>(null);
  const problem = useRef<HTMLParagraphElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const restoreEditFocus = useRef(false);
  const editing = !!draft;
  const latest = history?.versions[0];
  const stale = error.includes("evidence changed");

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (editing) legend.current?.focus(); }, [editing]);
  useEffect(() => { if (error) problem.current?.focus(); }, [error]);
  useEffect(() => { if (notice) receipt.current?.focus(); }, [notice]);
  useEffect(() => {
    if (restoreEditFocus.current && history && !editing && !busy) {
      (edit.current ?? reloadButton.current)?.focus();
      restoreEditFocus.current = false;
    }
  }, [history, editing, busy]);
  useEffect(() => {
    let active = true;
    void accessLoanRetention({ type: "illinoisRecordkeepingHistory", loanId: loan.id }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "illinoisRecordkeeping") setHistory(result);
    }).catch(() => { if (active) setError("Could not load Illinois recordkeeping evidence. Reload to try again."); });
    return () => { active = false; };
  }, [brokerageId, loan.id, loadId]);

  function closeEditor() {
    setDraft(undefined);
    setCorrection("");
    request.current = null;
  }
  function reload() {
    closeEditor();
    setError("");
    setNotice("");
    setHistory(undefined);
    restoreEditFocus.current = true;
    setLoadId(value => value + 1);
  }
  async function save() {
    if (!draft || !history || busy || stale) return;
    const expected = latest?.version ?? 0;
    const fingerprint = JSON.stringify([expected, draft, correction]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    const parsed = illinoisRecordkeepingRequest.safeParse({ type: "saveIllinoisRecordkeeping", loanId: loan.id, expected,
      facts: draft, requestId: request.current.id, correction: expected ? correction : undefined });
    if (!parsed.success) {
      setError(validation(parsed.error.issues[0]?.path));
      problem.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accessLoanRetention(parsed.data, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "illinoisRecordkeeping") {
        setHistory(result);
        closeEditor();
        setNotice(`Illinois recordkeeping evidence saved. Current version ${result.versions[0].version}.`);
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
      const result = await accessLoanRetention({ type: "illinoisRecordkeepingHistory", loanId: loan.id, before: history.next }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "illinoisRecordkeeping") {
        setHistory({ ...history, next: result.next, versions: [...history.versions, ...result.versions] });
        if (!result.next) restoreEditFocus.current = true;
      }
    } catch {
      setError("Could not load older versions. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const feedback = error && <p role="alert" ref={problem} tabIndex={-1}>{error}</p>;
  return <section className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2 ref={heading} tabIndex={-1}>Illinois borrower-file review</h2>
      <Button type="button" variant="outline" className="min-h-11" onClick={onBack} disabled={busy}>{backLabel}</Button>
    </div>
    <p className="break-words"><strong>{loan.label}</strong></p>
    <div className="loan-application-actions">
      {Object.entries(sourceLabels).map(([href, label]) => <a className="underline" key={href} href={href}>{label}</a>)}
    </div>
    <div className="record-form min-w-0 w-full max-w-2xl" aria-busy={busy || (!history && !error)}>
      {!editing && feedback}
      {notice && <p role="status" ref={receipt} tabIndex={-1}>{notice}</p>}
      {!history && !error && <p role="status">Loading Illinois recordkeeping evidence…</p>}
      {history?.targetChanged && <p role="status">This record’s scope changed. Its saved versions remain available for review.</p>}
      {!editing && history && <>
        {latest ? <section className="record-form min-w-0" aria-label="Current evidence">
          <h3>Current evidence · Version {latest.version}</h3>
          <Evidence version={latest} finding={history.currentFinding ?? undefined} />
        </section> : <p>No Illinois recordkeeping evidence recorded.</p>}
        <div className="loan-application-actions">
          {!history.targetChanged && <Button ref={edit} type="button" className="min-h-11" disabled={busy} onClick={() => {
            setNotice(""); setError(""); setDraft(latest?.facts ?? empty());
          }}>{latest ? "Record correction" : "Record evidence"}</Button>}
          <Button ref={reloadButton} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={reload}>Reload evidence</Button>
        </div>
      </>}
      {!history && error && <div><Button type="button" variant="outline" className="min-h-11" onClick={reload}>Reload evidence</Button></div>}
      {draft && <form className="record-form min-w-0" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset className="record-form min-w-0" disabled={busy || stale}>
          <legend ref={legend} tabIndex={-1} className="mb-2 font-semibold">{latest ? "Correct evidence" : "Record evidence"}</legend>
          <IllinoisRecordkeepingFields facts={draft} change={setDraft} />
          {latest && <RegisterField label="Reason for correction" value={correction} change={setCorrection} multiline limit={240} required />}
        </fieldset>
        {feedback}
        <div className="loan-application-actions">
          <Button type="submit" className="min-h-11" disabled={busy || stale}>{busy ? "Saving…" : "Save Illinois recordkeeping evidence"}</Button>
          {stale ? <Button type="button" variant="outline" className="min-h-11" onClick={reload}>Reload and discard draft</Button> :
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => {
              closeEditor(); setError(""); restoreEditFocus.current = true;
            }}>Cancel edit</Button>}
        </div>
      </form>}
      {!editing && history && history.versions.length > 1 && <RecordsGroup title="Previous versions">
        {history.versions.slice(1).map(version => <RecordsGroup key={version.version} title={`Version ${version.version} · ${dateTime(version.at)} ET`}>
          <Evidence version={version} />
        </RecordsGroup>)}
        {history.next && <div><Button type="button" variant="outline" className="min-h-11" disabled={busy}
          onClick={() => void older()}>Load older versions</Button></div>}
      </RecordsGroup>}
    </div>
  </section>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { accessComplianceCases, accessLoanRetention } from "@/app/actions";
import type { ProgramEntity } from "@/lib/compliance-program-model";
import { floridaBooksAndRecordsRule, floridaRecordGroups, floridaRecordkeepingSource, floridaRecordkeepingRequest,
  type FloridaRecordkeepingFacts as Facts } from "@/lib/florida-recordkeeping-model";
import type { FloridaRecordkeepingResult } from "@/lib/florida-recordkeeping";
import { RecordsGroup, RegisterField } from "./retention-register-fields";
import { blankFloridaFacts, FloridaRecordkeepingFields, floridaGroupKeys } from "./florida-recordkeeping-fields";
import { Button } from "./ui/button";

type History = Extract<FloridaRecordkeepingResult, { kind: "floridaRecordkeeping" }>;
type Version = History["versions"][number];
const displayAt = (version: Version) => new Intl.DateTimeFormat("en-US", {
  timeZone: version.facts.zone, dateStyle: "medium", timeStyle: "short",
}).format(new Date(version.at)) + (version.facts.zone === "America/Chicago" ? " CT" : " ET");

function Evidence({ version, finding = version.finding }: { version: Version; finding?: Version["finding"] }) {
  const { facts, entity } = version;
  const { custody, examination } = facts;
  const dated = (value?: { on: string; reference: string }) => value && `${value.on} · ${value.reference}`;
  const alternate = custody.method === "OFR-authorized location" ? custody : undefined;
  const locationChange = alternate?.locationChange;
  const clock = examination?.clock;
  const rows: [string, string | undefined][] = [
    ["Legal entity", `${entity.name} · NMLS ${entity.nmls}`],
    ["Florida authority", `${facts.authority} · ${facts.authorityReference}`], ["File inventory", facts.inventory],
    ["Custody method", custody.method], ["Records location", "location" in custody ? custody.location : undefined],
    ["OFR authorization", "authorization" in custody ? custody.authorization : undefined],
    ["Secure storage evidence", alternate?.secureStorage],
    ["Location history", locationChange?.status],
    ["Original location evidence", locationChange?.status === "Original location" ? locationChange.reference : undefined],
    ["Location change effective date", locationChange?.status === "Location change" ? locationChange.effectiveOn : undefined],
    ["MU1 filing", locationChange?.status === "Location change" ? dated(locationChange.filing) : undefined],
    ["Request format", clock?.request], ["Third business day", clock?.request === "Written OFR request" ? dated(clock.deadline) : undefined],
    ["Request format evidence", clock?.request === "Other request" ? clock.reference : undefined],
    ["Retrieval check", "retrieval" in custody ? dated(custody.retrieval) : undefined],
    ["OFR examination request", dated(examination?.notice)], ["Florida production location", examination?.floridaLocation],
    ["Records produced", dated(examination?.production)],
  ];
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p className="muted">{version.actor} · {displayAt(version)}</p>
    {version.correction && <p><strong>Correction</strong> · {version.correction}</p>}
    <dl className="record-form">
      <div><dt>Three-year retention planning date</dt><dd><strong>{finding.stateReviewDate ?? "Unresolved"}</strong></dd></div>
      {finding.amendmentDueOn && <div><dt>MU1 amendment due</dt><dd><strong>{finding.amendmentDueOn}</strong></dd></div>}
      {finding.productionDueOn && <div><dt>OFR production due</dt><dd><strong>{finding.productionDueOn}</strong></dd></div>}
      {examination && <div><dt>OFR examination response</dt><dd><strong>{examination.production ? "Production recorded" : "Awaiting production"}</strong></dd></div>}
    </dl>
    {finding.findings.length > 0 ? <RecordsGroup title={`Evidence to review · ${finding.findings.length}`}>
      <ul className="loan-task-list">{finding.findings.map(item => <li key={item.key} className="border-b border-[var(--line)] py-2">{item.message}</li>)}</ul>
    </RecordsGroup> : <p>No gaps flagged in this evidence review.</p>}
    <RecordsGroup title="Record entry dates"><dl className="record-form">
      {floridaGroupKeys.map(key => {
        const record = facts.records[key];
        const reviewOn = finding.recordDates.find(item => item.key === key)?.reviewOn;
        return <div key={key}><dt>{floridaRecordGroups[key]}</dt><dd>
          {record.status === "On file" ? dated(record.latestOriginalEntry) :
            record.status === "Not applicable" ? `Not applicable · ${record.reference}` : record.status}
          {reviewOn && <div className="muted">Three-year planning date {reviewOn}</div>}
        </dd></div>;
      })}
    </dl></RecordsGroup>
    <RecordsGroup title="Recorded evidence"><dl className="record-form">
      {rows.map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl></RecordsGroup>
  </div>;
}

function validation(path: readonly PropertyKey[] | undefined, message?: string) {
  if (path?.[0] === "correction") return "Enter at least four characters for the correction reason.";
  if (message) return message;
  switch (path?.[1]) {
    case "entityId": return "Select the brokerage legal entity.";
    case "authorityReference": return "Enter a Florida authority reference of at least four characters.";
    case "records": {
      const label = floridaRecordGroups[path[2] as keyof typeof floridaRecordGroups];
      return `Check the original-entry date or applicability evidence for ${label?.toLowerCase() ?? "the record group"}.`;
    }
    case "custody": return "Check the records location, authorization and retrieval evidence.";
    case "examination": return "Check the OFR request, Florida location and production evidence.";
    default: return "Check the recorded evidence. Enter at least four characters per reference.";
  }
}

export function FloridaRecordkeeping({ brokerageId, loan, onBack, backLabel = "Back to loan retention" }: {
  brokerageId: string; loan: { id: string; label: string }; onBack: () => void; backLabel?: string;
}) {
  const [history, setHistory] = useState<History>();
  const [entities, setEntities] = useState<ProgramEntity[]>();
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
    void Promise.all([
      accessLoanRetention({ type: "floridaRecordkeepingHistory", loanId: loan.id }, brokerageId),
      accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId),
    ]).then(([result, scope]) => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if ("error" in scope) setError(scope.error);
      else if (result.kind === "floridaRecordkeeping" && scope.kind === "programEntities") {
        setHistory(result);
        setEntities(scope.entities);
      }
    }).catch(() => { if (active) setError("Could not load Florida evidence. Reload to try again."); });
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
    const parsed = floridaRecordkeepingRequest.safeParse({ type: "saveFloridaRecordkeeping", loanId: loan.id, expected,
      facts: draft, requestId: request.current.id, correction: expected ? correction : undefined });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(validation(issue?.path, issue?.code === "custom" ? issue.message : undefined));
      problem.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accessLoanRetention(parsed.data, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "floridaRecordkeeping") {
        setHistory(result);
        closeEditor();
        setNotice(`Florida recordkeeping evidence saved. Current version ${result.versions[0].version}.`);
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
      const result = await accessLoanRetention({ type: "floridaRecordkeepingHistory", loanId: loan.id, before: history.next }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "floridaRecordkeeping") {
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
      <h2 ref={heading} tabIndex={-1}>Florida borrower-file review</h2>
      <Button type="button" variant="outline" className="min-h-11" onClick={onBack} disabled={busy}>{backLabel}</Button>
    </div>
    <p className="break-words"><strong>{loan.label}</strong></p>
    <div className="loan-application-actions">
      <a className="underline" href={floridaRecordkeepingSource}>Florida recordkeeping statute</a>
      <a className="underline" href={floridaBooksAndRecordsRule}>Florida books and records rule</a>
    </div>
    <div className="record-form min-w-0 w-full max-w-2xl" aria-busy={busy || (!history && !error)}>
      {!editing && feedback}
      {notice && <p role="status" ref={receipt} tabIndex={-1}>{notice}</p>}
      {!history && !error && <p role="status">Loading Florida recordkeeping evidence…</p>}
      {history?.targetChanged && <p role="status">This record’s scope changed. Its saved versions remain available for review.</p>}
      {!editing && history && <>
        {latest ? <section className="record-form min-w-0" aria-label="Current evidence">
          <h3>Current evidence · Version {latest.version}</h3>
          <Evidence version={latest} finding={history.currentFinding ?? undefined} />
        </section> : <p>No Florida recordkeeping evidence recorded.</p>}
        {entities?.length === 0 && <p>Add a legal entity in Monthly review before recording evidence.</p>}
        <div className="loan-application-actions">
          {!history.targetChanged && !!entities?.length && <Button ref={edit} type="button" className="min-h-11" disabled={busy} onClick={() => {
            setNotice(""); setError(""); setDraft(latest?.facts ?? blankFloridaFacts());
          }}>{latest ? "Record correction" : "Record evidence"}</Button>}
          <Button ref={reloadButton} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={reload}>Reload evidence</Button>
        </div>
      </>}
      {!history && error && <div><Button type="button" variant="outline" className="min-h-11" onClick={reload}>Reload evidence</Button></div>}
      {draft && <form className="record-form min-w-0" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        {feedback}
        <fieldset className="record-form min-w-0" disabled={busy || stale}>
          <legend ref={legend} tabIndex={-1} className="mb-2 font-semibold">{latest ? "Correct evidence" : "Record evidence"}</legend>
          <FloridaRecordkeepingFields facts={draft} entities={entities ?? []} change={setDraft} />
          {latest && <RegisterField label="Reason for correction" value={correction} change={setCorrection} multiline limit={240} required />}
        </fieldset>
        <div className="loan-application-actions">
          <Button type="submit" className="min-h-11" disabled={busy || stale}>{busy ? "Saving…" : "Save Florida recordkeeping evidence"}</Button>
          {stale ? <Button type="button" variant="outline" className="min-h-11" onClick={reload}>Reload and discard draft</Button> :
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => {
              closeEditor(); setError(""); restoreEditFocus.current = true;
            }}>Cancel edit</Button>}
        </div>
      </form>}
      {!editing && history && history.versions.length > 1 && <RecordsGroup title="Previous versions">
        {history.versions.slice(1).map(version => <RecordsGroup key={version.version} title={`Version ${version.version} · ${displayAt(version)}`}>
          <Evidence version={version} />
        </RecordsGroup>)}
        {history.next && <div><Button type="button" variant="outline" className="min-h-11" disabled={busy}
          onClick={() => void older()}>Load older versions</Button></div>}
      </RecordsGroup>}
    </div>
  </section>;
}

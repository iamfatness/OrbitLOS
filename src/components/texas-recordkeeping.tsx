"use client";

import { useEffect, useRef, useState } from "react";
import { accessComplianceCases, accessLoanRetention } from "@/app/actions";
import type { ProgramEntity } from "@/lib/compliance-program-model";
import { texasRecordGroups, texasRecordkeepingSources, texasRecordkeepingRequest,
  type TexasRecordkeepingFacts as Facts } from "@/lib/texas-recordkeeping-model";
import type { TexasRecordkeepingResult } from "@/lib/texas-recordkeeping";
import { RecordsGroup, RegisterField } from "./retention-register-fields";
import { blankTexasFacts, TexasRecordkeepingFields, texasGroupKeys } from "./texas-recordkeeping-fields";
import { Button } from "./ui/button";

type History = Extract<TexasRecordkeepingResult, { kind: "texasRecordkeeping" }>;
type Version = History["versions"][number];
const displayAt = (version: Version) => new Intl.DateTimeFormat("en-US", {
  timeZone: version.facts.zone, dateStyle: "medium", timeStyle: "short",
}).format(new Date(version.at)) + (version.facts.zone === "America/Denver" ? " MT" : " CT");

function Evidence({ version, finding = version.finding }: { version: Version; finding?: Version["finding"] }) {
  const { facts, entity } = version;
  const { archive, examination } = facts;
  const dated = (value?: { on: string; reference: string }) => value && `${value.on} · ${value.reference}`;
  const rows: [string, string | undefined][] = [
    ["Legal entity", `${entity.name} · NMLS ${entity.nmls}`],
    ["Texas authority", `${facts.authority} · ${facts.authorityReference}`], ["Transaction role", facts.role],
    ["Initial application", dated(facts.application)], ["File inventory", facts.inventory],
    ["Executed lender copies retrieved", dated(facts.lenderCopies)], ["Archive location", archive?.location],
    ["Archive reference", archive?.reference], ["Retrieval check", dated(archive?.retrieval)],
    ["Retention basis", dated(facts.retentionBasis)], ["SML examination request", dated(examination?.notice)],
    ["Records produced", dated(examination?.production)],
  ];
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p className="muted">{version.actor} · {displayAt(version)}</p>
    {version.correction && <p><strong>Correction</strong> · {version.correction}</p>}
    <dl className="record-form">
      <div><dt>Three-year retention planning date</dt><dd><strong>{finding.stateReviewDate ?? "Unresolved"}</strong></dd></div>
      {examination && <div><dt>SML examination response</dt><dd><strong>{examination.production ? "Production recorded" : "Awaiting production"}</strong></dd></div>}
    </dl>
    {finding.findings.length > 0 ? <RecordsGroup title={`Evidence to review · ${finding.findings.length}`}>
      <ul className="loan-task-list">{finding.findings.map(item => <li key={item.key} className="border-b border-[var(--line)] py-2">{item.message}</li>)}</ul>
    </RecordsGroup> : <p>No gaps flagged in this evidence review.</p>}
    <RecordsGroup title="Loan file checklist"><dl className="record-form">
      {texasGroupKeys.map(key => {
        const record = facts.records[key];
        return <div key={key}><dt>{texasRecordGroups[key]}</dt><dd>{record ? `${record.status} · ${record.reference}` : "Unreviewed"}</dd></div>;
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
    case "authorityReference": return "Enter a Texas authority reference of at least four characters.";
    case "records": {
      const label = texasRecordGroups[path[2] as keyof typeof texasRecordGroups];
      return `Check the file reference or applicability evidence for ${label?.toLowerCase() ?? "the record group"}.`;
    }
    case "archive": return "Check the archive location and retrieval evidence.";
    case "examination": return "Check the SML request and production evidence.";
    default: return "Check the recorded evidence. Enter at least four characters per reference.";
  }
}

export function TexasRecordkeeping({ brokerageId, loan, onBack, backLabel = "Back to loan retention" }: {
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
      accessLoanRetention({ type: "texasRecordkeepingHistory", loanId: loan.id }, brokerageId),
      accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId),
    ]).then(([result, scope]) => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if ("error" in scope) setError(scope.error);
      else if (result.kind === "texasRecordkeeping" && scope.kind === "programEntities") {
        setHistory(result);
        setEntities(scope.entities);
      }
    }).catch(() => { if (active) setError("Could not load Texas evidence. Reload to try again."); });
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
    const parsed = texasRecordkeepingRequest.safeParse({ type: "saveTexasRecordkeeping", loanId: loan.id, expected,
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
      else if (result.kind === "texasRecordkeeping") {
        setHistory(result);
        closeEditor();
        setNotice(`Texas recordkeeping evidence saved. Current version ${result.versions[0].version}.`);
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
      const result = await accessLoanRetention({ type: "texasRecordkeepingHistory", loanId: loan.id, before: history.next }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "texasRecordkeeping") {
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
      <h2 ref={heading} tabIndex={-1}>Texas borrower-file review</h2>
      <Button type="button" variant="outline" className="min-h-11" onClick={onBack} disabled={busy}>{backLabel}</Button>
    </div>
    <p className="break-words"><strong>{loan.label}</strong></p>
    <div className="loan-application-actions">
      <a className="underline" href={texasRecordkeepingSources.rules}>Texas books and records rules</a>
      <a className="underline" href={texasRecordkeepingSources.guide}>SML mortgage compliance guide</a>
    </div>
    <div className="record-form min-w-0 w-full max-w-2xl" aria-busy={busy || (!history && !error)}>
      {!editing && feedback}
      {notice && <p role="status" ref={receipt} tabIndex={-1}>{notice}</p>}
      {!history && !error && <p role="status">Loading Texas recordkeeping evidence…</p>}
      {history?.targetChanged && <p role="status">This record’s scope changed. Its saved versions remain available for review.</p>}
      {!editing && history && <>
        {latest ? <section className="record-form min-w-0" aria-label="Current evidence">
          <h3>Current evidence · Version {latest.version}</h3>
          <Evidence version={latest} finding={history.currentFinding ?? undefined} />
        </section> : <p>No Texas recordkeeping evidence recorded.</p>}
        {entities?.length === 0 && <p>Add a legal entity in Monthly review before recording evidence.</p>}
        <div className="loan-application-actions">
          {!history.targetChanged && !!entities?.length && <Button ref={edit} type="button" className="min-h-11" disabled={busy} onClick={() => {
            setNotice(""); setError(""); setDraft(latest?.facts ?? blankTexasFacts());
          }}>{latest ? "Record correction" : "Record evidence"}</Button>}
          <Button ref={reloadButton} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={reload}>Reload evidence</Button>
        </div>
      </>}
      {!history && error && <div><Button type="button" variant="outline" className="min-h-11" onClick={reload}>Reload evidence</Button></div>}
      {draft && <form className="record-form min-w-0" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        {feedback}
        <fieldset className="record-form min-w-0" disabled={busy || stale}>
          <legend ref={legend} tabIndex={-1} className="mb-2 font-semibold">{latest ? "Correct evidence" : "Record evidence"}</legend>
          <TexasRecordkeepingFields facts={draft} entities={entities ?? []} change={setDraft} />
          {latest && <RegisterField label="Reason for correction" value={correction} change={setCorrection} multiline limit={240} required />}
        </fieldset>
        <div className="loan-application-actions">
          <Button type="submit" className="min-h-11" disabled={busy || stale}>{busy ? "Saving…" : "Save Texas recordkeeping evidence"}</Button>
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

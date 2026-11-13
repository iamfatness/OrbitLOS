"use client";

import { useEffect, useRef, useState } from "react";
import { accessComplianceCases, accessLoanRetention } from "@/app/actions";
import type { ProgramEntity } from "@/lib/compliance-program-model";
import { californiaDreArchiveChecks, californiaDreRecordsSources, californiaDreRecordkeepingRequest,
  type CaliforniaDreRecordkeepingFacts as Facts } from "@/lib/california-dre-recordkeeping-model";
import type { CaliforniaDreRecordkeepingResult } from "@/lib/california-dre-recordkeeping";
import { RecordsGroup, RegisterField } from "./retention-register-fields";
import { blankDreFacts, CaliforniaDreRecordkeepingFields, dreArchiveCheckKeys, dreFileCheckKeys, dreFileChecks, drePrivateCheckKeys, drePrivateChecks } from "./california-dre-recordkeeping-fields";
import { Button } from "./ui/button";

type History = Extract<CaliforniaDreRecordkeepingResult, { kind: "californiaDreRecordkeeping" }>;
type Version = History["versions"][number];
const sourceLabels: Record<string, string> = {
  [californiaDreRecordsSources.statute]: "California statutes",
  [californiaDreRecordsSources.regulations]: "Archive regulations",
  [californiaDreRecordsSources.manual]: "DRE mortgage manual",
};
const pacificTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
const displayAt = (at: string) => pacificTime.format(new Date(at)) + " PT";

function Evidence({ version, finding = version.finding }: { version: Version; finding?: Version["finding"] }) {
  const { facts, entity } = version;
  const { outcome, archive, privateMoney } = facts;
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p className="muted">{version.actor} · {displayAt(version.at)}</p>
    {version.correction && <p><strong>Correction</strong> · {version.correction}</p>}
    <dl className="record-form">
      <div><dt>Application outcome</dt><dd><strong>{outcome.status === "Unconsummated" ? "Ended without closing" : outcome.status}</strong></dd></div>
      <div><dt>Three-year retention planning date</dt><dd><strong>{finding.stateReviewDate ?? "Unresolved"}</strong>
        {finding.basis && ` · ${finding.basis.event} ${finding.basis.on}`}</dd></div>
    </dl>
    {finding.findings.length > 0 ? <RecordsGroup title={`Evidence to review · ${finding.findings.length}`}>
      <ul className="loan-task-list">{finding.findings.map(item => <li key={item.key} className="border-b border-[var(--line)] py-2">
        {item.message} <a className="underline" href={item.source}>{sourceLabels[item.source]}</a>
      </li>)}</ul>
    </RecordsGroup> : <p>No gaps flagged in this evidence review.</p>}
    <RecordsGroup title="Recorded evidence">
      <dl className="record-form">
        <div><dt>Legal entity and DRE authority</dt><dd>{entity.name} · NMLS {entity.nmls} · {facts.authorityReference}</dd></div>
        {outcome.status === "Closed" && <div><dt>Closing evidence</dt><dd>{outcome.on} · {outcome.reference}</dd></div>}
        {outcome.status === "Unconsummated" && <>
          <div><dt>Application evidence</dt><dd>{outcome.application.on} · {outcome.application.reference}</dd></div>
          {outcome.listing && <div><dt>Listing evidence</dt><dd>{outcome.listing.on} · {outcome.listing.reference}</dd></div>}
        </>}
        {facts.fileInventory && <div><dt>Transaction file inventory</dt><dd>{facts.fileInventory}</dd></div>}
        {dreFileCheckKeys.map(key => {
          const item = facts[key];
          return <div key={key}><dt>{dreFileChecks[key]}</dt><dd>{item.status}{"reference" in item && ` · ${item.reference}`}</dd></div>;
        })}
        <div><dt>Retention medium</dt><dd>{archive.format}{"location" in archive && ` · ${archive.location}`}</dd></div>
        {"inspection" in archive && archive.inspection && <div><dt>Office viewing and paper-copy test</dt>
          <dd>{archive.inspection.on} · {archive.inspection.reference}</dd></div>}
        {(archive.format === "Electronic" || archive.format === "Paper and electronic") && dreArchiveCheckKeys.map(key =>
          archive[key] && <div key={key}><dt>{californiaDreArchiveChecks[key]}</dt><dd>{archive[key]}</dd></div>)}
        <div><dt>Private-money scope</dt><dd>{privateMoney.status}{"reference" in privateMoney && ` · ${privateMoney.reference}`}</dd></div>
        {privateMoney.status === "Applicable" && <>
          {drePrivateCheckKeys.map(key => {
            const item = privateMoney[key];
            return <div key={key}><dt>{drePrivateChecks[key]}</dt><dd>{item.status}{"reference" in item && ` · ${item.reference}`}</dd></div>;
          })}
          {privateMoney.retainThrough && <div><dt>Private-money retain-through date</dt><dd>{privateMoney.retainThrough}</dd></div>}
          {privateMoney.retentionEvidence && <div><dt>Four-year retention evidence</dt><dd>{privateMoney.retentionEvidence}</dd></div>}
        </>}
      </dl>
    </RecordsGroup>
  </div>;
}

function validation(path: readonly PropertyKey[] | undefined) {
  if (path?.[0] === "correction") return "Enter at least four characters for the correction reason.";
  switch (path?.[1]) {
    case "entityId": return "Select the brokerage legal entity.";
    case "authorityReference": return "Enter the DRE authority reference using at least four characters.";
    case "outcome": return "Enter a valid application, listing or closing date and its evidence reference.";
    case "archive": return "Check the archive location, retrieval date and evidence references.";
    case "privateMoney": return "Check the private-money evidence references.";
    default: return "Check the recorded evidence. Enter at least four characters per reference.";
  }
}

export function CaliforniaDreRecordkeeping({ brokerageId, loan, onBack, backLabel = "Back to loan retention" }: {
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
      accessLoanRetention({ type: "californiaDreRecordkeepingHistory", loanId: loan.id }, brokerageId),
      accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId),
    ]).then(([result, scope]) => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if ("error" in scope) setError(scope.error);
      else if (result.kind === "californiaDreRecordkeeping" && scope.kind === "programEntities") {
        setHistory(result);
        setEntities(scope.entities);
      }
    }).catch(() => { if (active) setError("Could not load California DRE evidence. Reload to try again."); });
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
    const parsed = californiaDreRecordkeepingRequest.safeParse({ type: "saveCaliforniaDreRecordkeeping", loanId: loan.id, expected,
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
      else if (result.kind === "californiaDreRecordkeeping") {
        setHistory(result);
        closeEditor();
        setNotice(`California DRE recordkeeping evidence saved. Current version ${result.versions[0].version}.`);
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
      const result = await accessLoanRetention({ type: "californiaDreRecordkeepingHistory", loanId: loan.id, before: history.next }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "californiaDreRecordkeeping") {
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
      <h2 ref={heading} tabIndex={-1}>California DRE borrower-file review</h2>
      <Button type="button" variant="outline" className="min-h-11" onClick={onBack} disabled={busy}>{backLabel}</Button>
    </div>
    <p className="break-words"><strong>{loan.label}</strong></p>
    <p>Use this review for loans handled under a DRE broker license. Confirm the applicable authority before recording evidence.</p>
    <div className="loan-application-actions">
      {Object.entries(sourceLabels).map(([href, label]) => <a className="underline" key={href} href={href}>{label}</a>)}
    </div>
    <div className="record-form min-w-0 w-full max-w-2xl" aria-busy={busy || (!history && !error)}>
      {!editing && feedback}
      {notice && <p role="status" ref={receipt} tabIndex={-1}>{notice}</p>}
      {!history && !error && <p role="status">Loading California DRE recordkeeping evidence…</p>}
      {history?.targetChanged && <p role="status">This record’s scope changed. Its saved versions remain available for review.</p>}
      {!editing && history && <>
        {latest ? <section className="record-form min-w-0" aria-label="Current evidence">
          <h3>Current evidence · Version {latest.version}</h3>
          <Evidence version={latest} finding={history.currentFinding ?? undefined} />
        </section> : <p>No California DRE recordkeeping evidence recorded.</p>}
        {entities?.length === 0 && <p>Add a legal entity in Monthly review before recording evidence.</p>}
        <div className="loan-application-actions">
          {!history.targetChanged && !!entities?.length && <Button ref={edit} type="button" className="min-h-11" disabled={busy} onClick={() => {
            setNotice(""); setError(""); setDraft(latest?.facts ?? blankDreFacts());
          }}>{latest ? "Record correction" : "Record evidence"}</Button>}
          <Button ref={reloadButton} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={reload}>Reload evidence</Button>
        </div>
      </>}
      {!history && error && <div><Button type="button" variant="outline" className="min-h-11" onClick={reload}>Reload evidence</Button></div>}
      {draft && <form className="record-form min-w-0" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        {feedback}
        <fieldset className="record-form min-w-0" disabled={busy || stale}>
          <legend ref={legend} tabIndex={-1} className="mb-2 font-semibold">{latest ? "Correct evidence" : "Record evidence"}</legend>
          <CaliforniaDreRecordkeepingFields facts={draft} entities={entities ?? []} change={setDraft} />
          {latest && <RegisterField label="Reason for correction" value={correction} change={setCorrection} multiline limit={240} required />}
        </fieldset>
        <div className="loan-application-actions">
          <Button type="submit" className="min-h-11" disabled={busy || stale}>{busy ? "Saving…" : "Save California DRE recordkeeping evidence"}</Button>
          {stale ? <Button type="button" variant="outline" className="min-h-11" onClick={reload}>Reload and discard draft</Button> :
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => {
              closeEditor(); setError(""); restoreEditFocus.current = true;
            }}>Cancel edit</Button>}
        </div>
      </form>}
      {!editing && history && history.versions.length > 1 && <RecordsGroup title="Previous versions">
        {history.versions.slice(1).map(version => <RecordsGroup key={version.version} title={`Version ${version.version} · ${displayAt(version.at)}`}>
          <Evidence version={version} />
        </RecordsGroup>)}
        {history.next && <div><Button type="button" variant="outline" className="min-h-11" disabled={busy}
          onClick={() => void older()}>Load older versions</Button></div>}
      </RecordsGroup>}
    </div>
  </section>;
}

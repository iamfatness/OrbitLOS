"use client";

import { useEffect, useRef, useState } from "react";
import { accessComplianceCases, accessLoanRetention } from "@/app/actions";
import type { ProgramEntity } from "@/lib/compliance-program-model";
import { californiaDfpiSources, californiaDfpiRequest, cflDocuments, crmlaDocuments,
  type CaliforniaDfpiFacts as Facts } from "@/lib/california-dfpi-recordkeeping-model";
import type { CaliforniaDfpiResult } from "@/lib/california-dfpi-recordkeeping";
import { RecordsGroup, RegisterChoice, RegisterField } from "./retention-register-fields";
import { blankDfpiFacts, CaliforniaDfpiFields } from "./california-dfpi-recordkeeping-fields";
import { Button } from "./ui/button";

type History = Extract<CaliforniaDfpiResult, { kind: "californiaDfpi" }>;
type Version = History["versions"][number];
const sourceLabels: Record<string, string> = {
  [californiaDfpiSources.cfl]: "CFL retention statute",
  [californiaDfpiSources.cflRecords]: "CFL records rule",
  [californiaDfpiSources.crmla]: "CRMLA records rule",
};
const pacificTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
const displayAt = (at: string) => pacificTime.format(new Date(at)) + " PT";

function Evidence({ version, finding = version.finding }: { version: Version; finding?: Version["finding"] }) {
  const { facts, entity } = version;
  const documents = facts.authority === "CFL" ?
    (Object.keys(cflDocuments) as (keyof typeof cflDocuments)[]).map(key => [cflDocuments[key], facts[key]] as const) :
    (Object.keys(crmlaDocuments) as (keyof typeof crmlaDocuments)[]).map(key => [crmlaDocuments[key], facts[key]] as const);
  const rows: [string, string | undefined][] = [
    ["Legal entity", entity.name + " · NMLS " + entity.nmls],
    ["License and role", facts.authority + " · " + facts.role],
    ["Authority reference", facts.authorityReference],
    ["Final entry", facts.finalEntry && `${facts.finalEntry.on} · ${facts.finalEntry.reference}`],
    ["Retained file inventory", facts.inventory],
    ...documents.map(([label, item]): [string, string] => [label, item.status + ("reference" in item ? " · " + item.reference : "")]),
  ];
  if (facts.authority === "CFL") {
    const { custody } = facts;
    rows.push(["Records custody", custody.method],
      ["Licensed office", "office" in custody ? custody.office : undefined],
      ["Custody approval", "approval" in custody ? custody.approval : undefined],
      ["Retrieval test", "retrieval" in custody && custody.retrieval ? `${custody.retrieval.on} · ${custody.retrieval.reference}` : undefined]);
  } else {
    rows.push(["Loan log", facts.loanLog],
      ["Outstanding balance", facts.balance.status + ("reference" in facts.balance ? " · " + facts.balance.reference : "")],
      ["Examination notice", facts.production && `${facts.production.notice.on} · ${facts.production.notice.reference}`],
      ["Records made available", facts.production?.produced && `${facts.production.produced.on} · ${facts.production.produced.reference}`]);
  }
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p className="muted">{version.actor} · {displayAt(version.at)}</p>
    {version.correction && <p><strong>Correction</strong> · {version.correction}</p>}
    <dl className="record-form">
      <div><dt>Retention planning date</dt><dd><strong>{finding.stateReviewDate ?? "Unresolved"}</strong></dd></div>
      {finding.productionDue && <div><dt>Examination access</dt><dd><strong>{finding.productionStatus}</strong> · Due {finding.productionDue}</dd></div>}
    </dl>
    {finding.findings.length > 0 ? <RecordsGroup title={`Evidence to review · ${finding.findings.length}`}>
      <ul className="loan-task-list">{finding.findings.map(item => <li key={item.key} className="border-b border-[var(--line)] py-2">
        {item.message} <a className="underline" href={item.source}>{sourceLabels[item.source]}</a>
      </li>)}</ul>
    </RecordsGroup> : <p>No gaps flagged in this evidence review.</p>}
    <RecordsGroup title="Recorded evidence"><dl className="record-form">
      {rows.map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl></RecordsGroup>
  </div>;
}

function validation(path: readonly PropertyKey[] | undefined) {
  if (path?.[0] === "correction") return "Enter at least four characters for the correction reason.";
  switch (path?.[1]) {
    case "entityId": return "Select the brokerage legal entity.";
    case "authorityReference": return "Enter a DFPI authority reference of at least four characters.";
    case "finalEntry": return "Enter the final entry date and its evidence reference.";
    case "production": return "Enter the examination notice date and reference, and complete any access evidence.";
    case "custody": return "Check the custody location, approval and retrieval evidence.";
    default: return "Check the recorded evidence. Enter at least four characters per reference.";
  }
}

function AuthorityReview({ brokerageId, loan, authority, onEditing }: {
  brokerageId: string; loan: { id: string; label: string }; authority: Facts["authority"]; onEditing: (value: boolean) => void;
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
  const edit = useRef<HTMLButtonElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const legend = useRef<HTMLLegendElement>(null);
  const problem = useRef<HTMLParagraphElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const restoreEditFocus = useRef(false);
  const editing = !!draft;
  const latest = history?.versions[0];
  const stale = error.includes("evidence changed");

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
      accessLoanRetention({ type: "californiaDfpiHistory", authority, loanId: loan.id }, brokerageId),
      accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId),
    ]).then(([result, scope]) => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if ("error" in scope) setError(scope.error);
      else if (result.kind === "californiaDfpi" && scope.kind === "programEntities") {
        setHistory(result);
        setEntities(scope.entities);
      }
    }).catch(() => { if (active) setError("Could not load California DFPI evidence. Reload to try again."); });
    return () => { active = false; };
  }, [brokerageId, loan.id, authority, loadId]);

  function closeEditor() {
    setDraft(undefined);
    onEditing(false);
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
    const parsed = californiaDfpiRequest.safeParse({ type: "saveCaliforniaDfpi", loanId: loan.id, expected,
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
      else if (result.kind === "californiaDfpi") {
        setHistory(result);
        closeEditor();
        setNotice(`California DFPI recordkeeping evidence saved. Current version ${result.versions[0].version}.`);
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
      const result = await accessLoanRetention({ type: "californiaDfpiHistory", authority, loanId: loan.id, before: history.next }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "californiaDfpi") {
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
  return <>
    <div className="loan-application-actions">
      {(authority === "CFL" ? [californiaDfpiSources.cfl, californiaDfpiSources.cflRecords] : [californiaDfpiSources.crmla])
        .map(href => <a className="underline" key={href} href={href}>{sourceLabels[href]}</a>)}
    </div>
    <div className="record-form min-w-0 w-full max-w-2xl" aria-busy={busy || (!history && !error)}>
      {!editing && feedback}
      {notice && <p role="status" ref={receipt} tabIndex={-1}>{notice}</p>}
      {!history && !error && <p role="status">Loading California DFPI recordkeeping evidence…</p>}
      {history?.targetChanged && <p role="status">This record’s scope changed. Its saved versions remain available for review.</p>}
      {!editing && history && <>
        {latest ? <section className="record-form min-w-0" aria-label="Current evidence">
          <h3>Current evidence · Version {latest.version}</h3>
          <Evidence version={latest} finding={history.currentFinding ?? undefined} />
        </section> : <p>No California DFPI recordkeeping evidence recorded.</p>}
        {entities?.length === 0 && <p>Add a legal entity in Monthly review before recording evidence.</p>}
        <div className="loan-application-actions">
          {!history.targetChanged && !!entities?.length && <Button ref={edit} type="button" className="min-h-11" disabled={busy} onClick={() => {
            setNotice(""); setError(""); setDraft(latest?.facts ?? blankDfpiFacts(authority)); onEditing(true);
          }}>{latest ? "Record correction" : "Record evidence"}</Button>}
          <Button ref={reloadButton} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={reload}>Reload evidence</Button>
        </div>
      </>}
      {!history && error && <div><Button type="button" variant="outline" className="min-h-11" onClick={reload}>Reload evidence</Button></div>}
      {draft && <form className="record-form min-w-0" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        {feedback}
        <fieldset className="record-form min-w-0" disabled={busy || stale}>
          <legend ref={legend} tabIndex={-1} className="mb-2 font-semibold">{latest ? "Correct evidence" : "Record evidence"}</legend>
          <CaliforniaDfpiFields facts={draft} entities={entities ?? []} change={setDraft} />
          {latest && <RegisterField label="Reason for correction" value={correction} change={setCorrection} multiline limit={240} required />}
        </fieldset>
        <div className="loan-application-actions">
          <Button type="submit" className="min-h-11" disabled={busy || stale}>{busy ? "Saving…" : "Save California DFPI recordkeeping evidence"}</Button>
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
  </>;
}

export function CaliforniaDfpiRecordkeeping({ brokerageId, loan, onBack, backLabel = "Back to loan retention" }: {
  brokerageId: string; loan: { id: string; label: string }; onBack: () => void; backLabel?: string;
}) {
  const [authority, setAuthority] = useState<Facts["authority"]>("CFL");
  const [editing, setEditing] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2 ref={heading} tabIndex={-1}>California DFPI borrower-file review</h2>
      <Button type="button" variant="outline" className="min-h-11" onClick={onBack} disabled={editing}>{backLabel}</Button>
    </div>
    <p className="break-words"><strong>{loan.label}</strong></p>
    <div className="max-w-md">
      <RegisterChoice label="License authority" value={authority} options={["CFL", "CRMLA"]} disabled={editing} change={setAuthority} />
    </div>
    <AuthorityReview key={authority} brokerageId={brokerageId} loan={loan} authority={authority} onEditing={setEditing} />
  </section>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { accessComplianceCases, accessLoanRetention } from "@/app/actions";
import type { ProgramEntity } from "@/lib/compliance-program-model";
import { illinoisLoanLogLaw, illinoisLogProducts, type IllinoisLoanLogRequest } from "@/lib/illinois-loan-log-model";
import type { IllinoisLoanLogResult } from "@/lib/illinois-loan-log";
import { RegisterChoice, RegisterField } from "./retention-register-fields";
import { IllinoisLoanLogEntry, type IllinoisLogSelection } from "./illinois-loan-log-entry";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type Query = Extract<IllinoisLoanLogRequest["input"], { operation: "list" | "candidates" }>;
type List = Extract<Query, { operation: "list" }>;
type Page = Extract<IllinoisLoanLogResult, { kind: "illinoisLogList" | "illinoisLogCandidates" }>;
const workbookType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function initialQuery(): List {
  const through = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { operation: "list", search: "", status: "All", product: "All", from: through.slice(0, 4) + "-01-01", through, offset: 0 };
}

function LogEntries({ brokerageId, entityId, onDetail, downloading, setDownloading }: {
  brokerageId: string; entityId: string; onDetail: (detail: boolean) => void;
  downloading: boolean; setDownloading: (downloading: boolean) => void;
}) {
  const [filters, setFilters] = useState<List>(initialQuery);
  const [query, setQuery] = useState<Query>(filters);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState("");
  const [download, setDownload] = useState<{ message: string; error?: true }>();
  const [selection, setSelection] = useState<IllinoisLogSelection>();
  const listHeading = useRef<HTMLHeadingElement>(null);
  const downloadFeedback = useRef<HTMLParagraphElement>(null);
  const origin = useRef<string>(null);
  const actions = useRef(new Map<string, HTMLButtonElement>());
  const candidates = query.operation === "candidates";
  const pending = !page && !error;
  const unappliedDates = !candidates && (filters.from !== query.from || filters.through !== query.through);

  useEffect(() => {
    let active = true;
    void accessLoanRetention({ type: "illinoisLoanLog", entityId, input: query }, brokerageId)
      .then(result => {
        if (!active) return;
        if ("error" in result) setError(result.error);
        else if (result.kind === "illinoisLogList" || result.kind === "illinoisLogCandidates") setPage(result);
      }).catch(() => { if (active) setError("Could not load the Illinois loan log. Reload to try again."); });
    return () => { active = false; };
  }, [brokerageId, entityId, query]);
  useEffect(() => {
    if (!selection && !pending && origin.current) {
      (actions.current.get(origin.current) ?? listHeading.current)?.focus();
      origin.current = null;
    }
  }, [selection, page, pending]);
  useEffect(() => { if (download) downloadFeedback.current?.focus(); }, [download]);

  function load(next: Query) {
    setError("");
    setDownload(undefined);
    setPage(undefined);
    setQuery(next);
  }
  function open(selection: IllinoisLogSelection, key: string) {
    origin.current = key;
    setSelection(selection);
    onDetail(true);
  }
  function attach(key: string, node: HTMLButtonElement | null) {
    if (node) actions.current.set(key, node);
    else actions.current.delete(key);
  }
  async function exportLog() {
    if (candidates || !page || downloading || unappliedDates) return;
    setDownloading(true);
    setDownload(undefined);
    try {
      const result = await accessLoanRetention({ type: "illinoisLoanLog", entityId,
        input: { operation: "export", from: query.from, through: query.through } }, brokerageId);
      if ("error" in result) setDownload({ message: result.error, error: true });
      else if (result.kind === "illinoisLogExport") {
        const bytes = Uint8Array.from(atob(result.xlsx), value => value.charCodeAt(0));
        downloadSampleFile(new Blob([bytes], { type: workbookType }), `orbit-illinois-loan-log-${query.from}-${query.through}.xlsx`);
        const { reviewedApplications, highRiskApplications, incomplete, unmatchedCandidates } = result;
        setDownload({ message: `Excel downloaded. ${reviewedApplications} reviewed ${reviewedApplications === 1 ? "application" : "applications"} in the selected period. ` +
          `${highRiskApplications} high-risk ${highRiskApplications === 1 ? "application" : "applications"} from ${result.highRiskFrom} through ${query.through}. ` +
          `${incomplete} incomplete ${incomplete === 1 ? "entry" : "entries"} and ${unmatchedCandidates} potential ${unmatchedCandidates === 1 ? "loan" : "loans"} across the workspace need review.` });
      }
    } catch {
      setDownload({ message: "Could not download the Excel loan log. Try again.", error: true });
    } finally {
      setDownloading(false);
    }
  }

  return <>
    <div hidden={!!selection}>
      <div className="record-form">
        <div className="loan-application-actions">
          <Button type="button" className="min-h-11" variant={candidates ? "outline" : "default"} aria-pressed={!candidates}
            disabled={downloading} onClick={() => load({ ...filters, offset: 0 })}>Loan log entries</Button>
          <Button type="button" className="min-h-11" variant={candidates ? "default" : "outline"} aria-pressed={candidates}
            disabled={downloading} onClick={() => load({ operation: "candidates", search: candidateSearch.trim(), offset: 0 })}>Potential Illinois loans</Button>
        </div>
        <form className="record-form w-full max-w-2xl" onSubmit={event => {
          event.preventDefault();
          load(candidates ? { operation: "candidates", search: candidateSearch.trim(), offset: 0 } :
            { ...filters, search: filters.search.trim(), offset: 0 });
        }}>
          <fieldset className="record-form min-w-0" disabled={downloading} aria-label="Loan log filters">
            <RegisterField label={candidates ? "Borrower name" : "Borrower name or file number"}
              value={candidates ? candidateSearch : filters.search} change={search => {
                if (candidates) setCandidateSearch(search);
                else setFilters({ ...filters, search });
              }} />
            {!candidates && <>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <RegisterField label="Applications from" date required value={filters.from} change={from => setFilters({ ...filters, from })} />
                <RegisterField label="Applications through" date required value={filters.through} change={through => setFilters({ ...filters, through })} />
                <RegisterChoice label="Entry status" options={["All", "Draft", "Reviewed", "Withdrawn"]} value={filters.status}
                  change={status => setFilters({ ...filters, status })} />
                <RegisterChoice label="Log product" options={["All", ...illinoisLogProducts]} value={filters.product}
                  change={product => setFilters({ ...filters, product })} />
              </div>
            </>}
          </fieldset>
          <div className="loan-application-actions">
            <Button type="submit" variant="outline" className="min-h-11" disabled={downloading}>Apply filters</Button>
            <Button type="button" variant="outline" className="min-h-11" ref={node => attach("reload", node)} disabled={pending || downloading}
              onClick={() => { origin.current = "reload"; load({ ...query }); }}>Reload results</Button>
          </div>
        </form>
        {error && <p role="alert">{error}</p>}
        {pending && <p role="status">Loading loan log results…</p>}
        <section className="record-form" aria-label={candidates ? "Potential loan results" : "Saved loan log results"} aria-busy={pending}>
          <div className="section-heading">
            <h3 ref={listHeading} tabIndex={-1}>{candidates ? "Loans to review" : "Saved entries"}</h3>
            {!candidates && <div className="loan-application-actions">
              <Button type="button" className="min-h-11" ref={node => attach("external", node)} disabled={downloading}
                onClick={() => open({ kind: "new", entryId: crypto.randomUUID() }, "external")}>Record outside application</Button>
              <Button type="button" className="min-h-11" variant="outline" disabled={downloading || !page || unappliedDates}
                onClick={() => void exportLog()}>{downloading ? "Preparing Excel…" : "Download Excel loan log"}</Button>
            </div>}
          </div>
          {!candidates && <p className="muted">{unappliedDates ? "Apply the new application dates to enable download." :
            `Excel period ${query.from} through ${query.through}. The high-risk sheet looks back 60 months from the end date. Search, status and product filters apply to this screen.`}</p>}
          {download && <p ref={downloadFeedback} tabIndex={-1} role={download.error ? "alert" : "status"}>{download.message}</p>}
          {page?.items.length === 0 && <p>{candidates ? "No potential Illinois loans match." : "No saved loan log entries match."}</p>}
          {page?.kind === "illinoisLogList" && !!page.items.length && <ul className="loan-task-list">{page.items.map(item => {
            const name = item.facts.borrowers[0]?.name ?? "Unnamed loan log entry";
            return <li className="document-item record-form min-w-0" key={item.entryId}>
              <strong className="break-words">{name}</strong>
              <p className="muted break-words">{item.facts.product} · {item.reviewIssue && item.status === "Reviewed" ? "Needs reconciliation" : item.status} · {item.facts.applicationDate ?? "Application date unresolved"}
                {item.facts.fileNumber && ` · File ${item.facts.fileNumber}`}</p>
              {item.reviewIssue && <p>{item.reviewIssue}</p>}
              <div><Button type="button" variant="outline" className="min-h-11" ref={node => attach(item.entryId, node)} disabled={downloading}
                aria-label={`Open entry for ${name}`} onClick={() => open({ kind: "existing", entryId: item.entryId }, item.entryId)}>Open entry</Button></div>
            </li>;
          })}</ul>}
          {page?.kind === "illinoisLogCandidates" && !!page.items.length && <ul className="loan-task-list">{page.items.map(item =>
            <li className="document-item record-form min-w-0" key={item.loanId}>
              <strong className="break-words">{item.borrower}</strong>
              <p className="muted">{item.stage} · {item.disposition}{item.reportedApplicationDate && ` · Reported application ${item.reportedApplicationDate}`}</p>
              {item.propertyState && item.reportState && item.propertyState !== item.reportState &&
                <p>Property state {item.propertyState} and reporting state {item.reportState} differ.</p>}
              {item.draftInAnotherEntity ? <p>A draft belongs to another legal entity.</p> :
                <div><Button type="button" variant="outline" className="min-h-11" ref={node => attach(item.loanId, node)}
                  aria-label={`Review loan for ${item.borrower}`} onClick={() => open(item.draftEntryId
                    ? { kind: "existing", entryId: item.draftEntryId, candidate: item }
                    : { kind: "new", entryId: crypto.randomUUID(), candidate: item }, item.loanId)}>
                  {item.draftEntryId ? "Open draft" : "Review loan"}</Button></div>}
            </li>)}</ul>}
          {page && (query.offset > 0 || page.next !== null) && <div className="loan-application-actions">
            <Button type="button" variant="outline" className="min-h-11" disabled={query.offset === 0 || downloading}
              onClick={() => load({ ...query, offset: Math.max(0, query.offset - 20) })}>Previous results</Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={page.next === null || downloading}
              onClick={() => load({ ...query, offset: page.next ?? 0 })}>Next results</Button>
          </div>}
        </section>
      </div>
    </div>
    {selection && <IllinoisLoanLogEntry brokerageId={brokerageId} entityId={entityId} selection={selection}
      onBack={() => { setSelection(undefined); onDetail(false); }} onSaved={() => load({ ...query })} />}
  </>;
}

export function IllinoisLoanLog({ brokerageId, onBack }: { brokerageId: string; onBack: () => void }) {
  const [entities, setEntities] = useState<ProgramEntity[]>();
  const [entityId, setEntityId] = useState("");
  const [detail, setDetail] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const entityChoice = useRef<HTMLDivElement>(null);
  const entity = entities?.find(item => item.id === entityId);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    if (entities && reload) (entityChoice.current?.querySelector("select") ?? heading.current)?.focus();
  }, [entities, reload]);
  useEffect(() => {
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId)
      .then(result => {
        if (!active) return;
        if ("error" in result) setError(result.error);
        else if (result.kind === "programEntities") setEntities(result.entities);
      }).catch(() => { if (active) setError("Could not load legal entities. Reload to try again."); });
    return () => { active = false; };
  }, [brokerageId, reload]);

  return <div className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2 ref={heading} tabIndex={-1}>Illinois loan log</h2>
      {!detail && <Button type="button" variant="outline" className="min-h-11" disabled={downloading} onClick={onBack}>Back to loan retention</Button>}
    </div>
    {!detail && <div className="loan-application-actions">
      <a className="underline" href={illinoisLoanLogLaw}>Illinois loan-log rule</a>
    </div>}
    {error && <div className="record-form"><p role="alert">{error}</p>
      <div><Button type="button" variant="outline" className="min-h-11" onClick={() => { setError(""); setReload(value => value + 1); }}>Reload legal entities</Button></div>
    </div>}
    {!error && !entities && <p role="status">Loading legal entities…</p>}
    {entities?.length === 0 && <p>Add a legal entity in Monthly review to use the loan log.</p>}
    {!!entities?.length && !detail && <div className="w-full max-w-2xl" ref={entityChoice}>
      <RegisterChoice label="Legal entity" value={entityId} options={["", ...entities.map(item => item.id)]} disabled={downloading}
        optionLabel={id => id ? entities.find(item => item.id === id)?.name ?? id : "Select legal entity"} change={setEntityId} />
    </div>}
    {entity && <p className="break-words"><strong>{entity.name}</strong> · NMLS {entity.nmls}</p>}
    {entity && <LogEntries key={`${brokerageId}/${entity.id}`} brokerageId={brokerageId} entityId={entity.id} onDetail={setDetail}
      downloading={downloading} setDownloading={setDownloading} />}
  </div>;
}

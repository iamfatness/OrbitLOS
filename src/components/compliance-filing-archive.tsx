"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { filingArchiveFilters, filingArchivePage, filingArchiveRow } from "@/lib/compliance-obligations-model";
import { ComplianceFilingReceipts } from "./compliance-filing-receipts";
import { Button } from "./ui/button";

type Filters = z.infer<typeof filingArchiveFilters>;
type Archive = z.infer<typeof filingArchivePage>;
type Record = z.infer<typeof filingArchiveRow>;
const initialFilters: Filters = { year: "", entityId: "", confirmation: "" };
const recordKey = (record: Record) => `${record.entityId}-${record.obligationId}-${record.period}`;

export function ComplianceFilingArchive({ brokerageId, paused }: { brokerageId: string; paused: boolean }) {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [offset, setOffset] = useState(0);
  const [revision, refresh] = useState(0);
  const [response, setResponse] = useState<{ key: string; data: Archive | { error: string } }>();
  const [entities, setEntities] = useState<Archive["entities"]>([]);
  const [selected, setSelected] = useState<Record>();
  const [validation, setValidation] = useState("");
  const returnFocus = useRef<string | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const yearField = useRef<HTMLInputElement>(null);
  const key = JSON.stringify([filters, offset, revision]);
  const result = response?.key === key ? response.data : undefined;
  const archive = result && "kind" in result ? result : undefined;
  const filtered = Boolean(filters.entityId || filters.year || filters.confirmation);

  useEffect(() => {
    if (paused) return;
    let active = true;
    const fail = () => { if (active) setResponse({ key, data: { error: "Could not load filing history. Try again." } }); };
    void accessComplianceCases({ type: "obligations", input: { operation: "filingArchive", filters, offset } }, brokerageId).then(result => {
      if (!active) return;
      const parsed = filingArchivePage.safeParse("kind" in result && result.kind === "obligations" ? result.result : null);
      if (!parsed.success) { fail(); return; }
      setEntities(parsed.data.entities);
      setResponse({ key, data: parsed.data });
    }, fail);
    return () => { active = false; };
  }, [brokerageId, filters, key, offset, paused]);

  useEffect(() => { if (!paused) listHeading.current?.focus(); }, [paused]);

  useEffect(() => {
    if (selected) detailHeading.current?.focus();
    else if (returnFocus.current && result) {
      (document.getElementById(returnFocus.current) ?? listHeading.current)?.focus();
      returnFocus.current = null;
    }
  }, [selected, result]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = filingArchiveFilters.safeParse(draft);
    if (!parsed.success) {
      setValidation("Enter a four-digit reporting year from 2000 to 2099.");
      yearField.current?.focus();
      return;
    }
    setValidation("");
    setFilters(parsed.data);
    setOffset(0);
    refresh(value => value + 1);
  }

  function clear() {
    setDraft(initialFilters);
    setFilters(initialFilters);
    setValidation("");
    setOffset(0);
    yearField.current?.focus();
  }

  if (paused) return <p>Filing history is unavailable while the workspace is paused.</p>;
  return <div className="record-form">
    <section className="integration manager-panel record-form" aria-label="Filing history search" hidden={!!selected}>
      <h2 ref={listHeading} tabIndex={-1}>Filing history</h2>
      <p className="muted">Find confirmation details your team recorded after filing outside Orbit.</p>
      <form className="record-form" onSubmit={apply} noValidate>
        <div className="form-grid compliance-filing-filters">
          <label className="field">Company<select value={draft.entityId} onChange={event => setDraft({ ...draft, entityId: event.target.value })}>
            <option value="">All companies</option>{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select></label>
          <div className="field">
            <label className="field" htmlFor="filing-year">Reporting year<input id="filing-year" ref={yearField} inputMode="numeric" maxLength={4} value={draft.year}
              placeholder="Any year" aria-invalid={!!validation} aria-describedby={validation ? "filing-year-error" : undefined}
              onChange={event => { setDraft({ ...draft, year: event.target.value }); setValidation(""); }} /></label>
            {validation && <span id="filing-year-error" role="alert">{validation}</span>}
          </div>
          <label className="field">Confirmation number<input type="search" value={draft.confirmation} maxLength={120}
            onChange={event => setDraft({ ...draft, confirmation: event.target.value })} /></label>
        </div>
        <div className="loan-application-actions">
          <Button type="submit" size="sm">Search filings</Button>
          {(filtered || draft.entityId || draft.year || draft.confirmation) && <Button size="sm" variant="outline" onClick={clear}>Clear filters</Button>}
        </div>
      </form>
      {!result && <p role="status">Loading filing history…</p>}
      {result && "error" in result && <div className="record-form">
        <p role="alert">{result.error}</p>
        <div><Button id="filing-archive-retry" size="sm" variant="outline" onClick={() => {
          returnFocus.current = "filing-archive-retry";
          refresh(value => value + 1);
        }}>Retry filing history</Button></div>
      </div>}
      {archive && !archive.items.length && <p role="status">{filtered ? "No filings match these filters. Try another year or confirmation number." : "No external filing confirmations have been recorded."}</p>}
      {!!archive?.items.length && <ul className="compliance-home-list" aria-label="Recorded filing confirmations">
        {archive.items.map(record => <li key={recordKey(record)} className="compliance-home-row">
          <div><strong>{record.entityName} · Q{record.basis.report.quarter} {record.basis.report.year}</strong>
            <p>{record.title}</p>
            <p className="muted">Latest recorded status {record.status} · {dateLabel(record.confirmedOn)} · {record.confirmation}</p>
            {record.matchedVersion !== record.version && <p>Search matched an earlier confirmation (version {record.matchedVersion}).</p>}
          </div>
          <Button id={`filing-archive-${recordKey(record)}`} size="sm" variant="outline"
            aria-label={`Open filing for ${record.entityName}, Q${record.basis.report.quarter} ${record.basis.report.year}`}
            onClick={event => { returnFocus.current = event.currentTarget.id; setSelected(record); }}>Open filing</Button>
        </li>)}
      </ul>}
      {archive && (offset > 0 || archive.more) && <div className="loan-application-actions">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(value => value - 25)}>Previous page</Button>
        <Button size="sm" variant="outline" disabled={!archive.more} onClick={() => setOffset(value => value + 25)}>Next page</Button>
      </div>}
    </section>
    {selected && <section className="integration manager-panel record-form" aria-label="Selected filing">
      <div><Button size="sm" variant="outline" onClick={() => setSelected(undefined)}>Back to filing results</Button></div>
      <h2 ref={detailHeading} tabIndex={-1}>{selected.entityName} · Q{selected.basis.report.quarter} {selected.basis.report.year}</h2>
      <p>{selected.title} · Obligation version {selected.basis.version}</p>
      <ComplianceFilingReceipts brokerageId={brokerageId} entityId={selected.entityId} entityName={selected.entityName}
        basis={selected.basis} initialVersion={selected.matchedVersion} readOnly />
    </section>}
  </div>;
}

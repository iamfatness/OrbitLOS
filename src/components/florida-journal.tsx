"use client";

import { useEffect, useRef, useState } from "react";
import { accessComplianceCases, accessLoanRetention } from "@/app/actions";
import type { ProgramEntity } from "@/lib/compliance-program-model";
import { floridaJournalSources, type FloridaJournalRequest } from "@/lib/florida-journal-model";
import type { FloridaJournalResult } from "@/lib/florida-journal";
import { RegisterChoice, RegisterField } from "./retention-register-fields";
import { FloridaJournalForm } from "./florida-journal-form";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type Input = FloridaJournalRequest["input"];
type Query = Extract<Input, { operation: "list" }>;
type Page = Extract<FloridaJournalResult, { kind: "floridaJournalList" }>;
type History = Extract<FloridaJournalResult, { kind: "floridaJournalHistory" }>;
type Entry = History["versions"][number];
type Change = Omit<Extract<Input, { operation: "save" }>, "requestId"> | Omit<Extract<Input, { operation: "void" }>, "requestId">;

function initialQuery(): Query {
  const date = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return { operation: "list", from: today.slice(0, 4) + "-01-01", through: today, search: "", offset: 0 };
}

function savedDate(entry: Entry) {
  return new Intl.DateTimeFormat("en-US", { timeZone: entry.facts.zone, dateStyle: "medium" }).format(new Date(entry.at));
}

function entryName(entry: Entry) {
  return entry.facts.transactionNumber ?? entry.facts.applicants.join(", ");
}

function EntryEvidence({ entry }: { entry: Entry }) {
  const { facts, review } = entry;
  const rows: [string, string | undefined][] = [
    ["Authority", facts.authority], ["Transaction number", facts.transactionNumber], ["Applicants", facts.applicants.join(" · ")],
    ["Principal or originating branch office", facts.office], ["Office custody reference", facts.officeReference],
    ["Office time zone", facts.zone === "America/Chicago" ? "Central" : "Eastern"], ["Application date", facts.applicationOn],
    ["Disposition", facts.disposition], ["Disposition reference", facts.dispositionReference], ["Lender status", facts.lender.status],
    ["Lender name", facts.lender.status === "Identified" ? facts.lender.name : undefined],
    ["Lender applicability reference", facts.lender.status === "Not applicable" ? facts.lender.reference : undefined],
    ["Date transaction was entered into", facts.enteredOn], ["Documented seventh business day", facts.calendar?.dueOn],
    ["Business-day calendar reference", facts.calendar?.reference], ["Journal initiated", review.firstOn],
    ["Initiation basis", review.documentedExternalEntry ? "Documented earlier journal entry" : "First Orbit save"],
    ["Earlier journal evidence reference", facts.initiation?.reference], ["Entry timing", entry.voided ? "Voided" : review.status],
    ["Retention review date", review.retainThrough ?? undefined], ["Correction reason", entry.correction ?? undefined],
  ];
  return <div className="record-form">
    <p>{entry.entity.name} · {entry.actor} · {savedDate(entry)}</p>
    {!!review.gaps.length && <div><strong>Evidence gaps</strong><ul className="list-disc pl-5">
      {review.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
    <dl className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      {rows.map(([label, value]) => value && <div key={label} className="contents"><dt className="font-medium">{label}</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>)}
    </dl>
  </div>;
}

function FloridaJournalDetail({ brokerageId, entityId, entryId, isNew, onBack, onChange }: {
  brokerageId: string; entityId: string; entryId: string; isNew: boolean; onBack: () => void; onChange: () => void;
}) {
  const [history, setHistory] = useState<History>();
  const [mode, setMode] = useState<"read" | "edit" | "void">(isNew ? "edit" : "read");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const heading = useRef<HTMLHeadingElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const retry = useRef<{ body: string; id: string }>(undefined);
  const current = history?.versions[0];

  useEffect(() => {
    if (isNew && reload === 0) return;
    let active = true;
    void accessLoanRetention({ type: "floridaJournal", entityId, input: { operation: "history", entryId } }, brokerageId)
      .then(result => {
        if (!active) return;
        if ("error" in result || result.kind !== "floridaJournalHistory") throw new Error();
        setHistory(result);
        if (reload) { setStale(false); setMode("read"); setFeedback({ text: "Florida journal entry reloaded." }); }
      }).catch(() => {
        if (active) setFeedback({ error: true, text: "Could not load the Florida journal entry. Reload to try again." });
      }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [brokerageId, entityId, entryId, isNew, reload]);
  useEffect(() => { heading.current?.focus(); }, [mode]);
  useEffect(() => { if (feedback) status.current?.focus(); }, [feedback]);

  async function change(input: Change) {
    if (busy || stale) return;
    setBusy(true);
    setFeedback(undefined);
    const body = JSON.stringify(input);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    try {
      const result = await accessLoanRetention({ type: "floridaJournal", entityId, input: { ...input, requestId: retry.current.id } }, brokerageId);
      if ("error" in result) {
        setStale(result.error.includes("entry changed"));
        setFeedback({ error: true, text: result.error });
      } else if (result.kind === "floridaJournalHistory" && result.versions[0]) {
        retry.current = undefined;
        setHistory(result);
        setMode("read");
        setFeedback({ text: input.operation === "void" ? "Florida journal entry voided." : "Florida journal entry saved. Version " + result.versions[0].version + "." });
        onChange();
      }
    } catch {
      setFeedback({ error: true, text: "Could not confirm the save. Retry with the same evidence." });
    } finally { setBusy(false); }
  }

  async function older() {
    if (!history?.next || busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await accessLoanRetention({ type: "floridaJournal", entityId,
        input: { operation: "history", entryId, before: history.next } }, brokerageId);
      if ("error" in result || result.kind !== "floridaJournalHistory") throw new Error();
      setHistory({ ...result, versions: [...history.versions, ...result.versions] });
      setFeedback({ text: "Earlier Florida journal versions loaded." });
    } catch { setFeedback({ error: true, text: "Could not load earlier versions. Try again." }); }
    finally { setBusy(false); }
  }

  return <section className="record-form min-w-0" aria-label="Florida journal entry">
    <div className="section-heading">
      <h3 ref={heading} tabIndex={-1}>{mode === "edit" ? current ? "Correct Florida journal entry" : "Record Florida journal entry" : current ? entryName(current) : "Florida journal entry"}</h3>
      {mode === "read" && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onBack}>Back to Florida journal</Button>}
    </div>
    {feedback && <p ref={status} role={feedback.error ? "alert" : "status"} tabIndex={-1}>{feedback.text}</p>}
    {(stale || (!isNew && !current && feedback?.error)) && <div><Button type="button" variant="outline" className="min-h-11"
      disabled={busy} onClick={() => { setBusy(true); setFeedback(undefined); setReload(value => value + 1); }}>
      {stale ? "Reload entry and discard draft" : "Reload entry"}
    </Button></div>}
    {!isNew && !current && !feedback && <p role="status">Loading Florida journal entry…</p>}
    {history && !current && <p>This entry is unavailable for the selected legal entity.</p>}
    {mode === "edit" && <FloridaJournalForm key={current?.version ?? 0} initial={current?.facts}
      busy={busy || stale} cancel={() => current ? setMode("read") : onBack()}
      save={data => void change({ ...data, operation: "save", entryId, expected: current?.version ?? 0 })} />}
    {mode === "void" && current && <form className="record-form w-full max-w-2xl" onSubmit={event => {
      event.preventDefault();
      const correction = String(new FormData(event.currentTarget).get("correction") ?? "").trim();
      if (correction.length < 4) { setFeedback({ error: true, text: "Enter a void reason of at least four characters." }); return; }
      void change({ operation: "void", entryId, expected: current.version, correction });
    }}>
      <fieldset className="record-form" disabled={busy || stale}>
        <label className="field">Reason for voiding (required)<input name="correction" required maxLength={240} /></label>
        <div className="loan-application-actions">
          <Button type="submit" className="min-h-11">Confirm void</Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setMode("read")}>Cancel</Button>
        </div>
      </fieldset>
    </form>}
    {mode === "read" && current && <>
      <p>{current.voided ? "Voided · " : ""}Version {current.version}</p>
      <EntryEvidence entry={current} />
      {!current.voided && <div className="loan-application-actions">
        <Button className="min-h-11" type="button" disabled={busy} onClick={() => { setFeedback(undefined); setMode("edit"); }}>Record correction</Button>
        <Button className="min-h-11" type="button" variant="outline" disabled={busy} onClick={() => { setFeedback(undefined); setMode("void"); }}>Void entry</Button>
      </div>}
      {history.versions.length > 1 && <details className="details-section">
        <summary className="min-h-11 content-center">Previous versions</summary>
        {history.versions.slice(1).map(item => <details key={item.version} className="details-section">
          <summary className="min-h-11 content-center">Version {item.version} · {savedDate(item)}</summary>
          <EntryEvidence entry={item} />
        </details>)}
        {history.next && <Button type="button" variant="outline" disabled={busy} className="min-h-11" onClick={() => void older()}>Load earlier versions</Button>}
      </details>}
    </>}
  </section>;
}

function FloridaJournalEntries({ brokerageId, entityId, setDetail, downloading, setDownloading }: {
  brokerageId: string; entityId: string; setDetail: (value: boolean) => void; downloading: boolean; setDownloading: (value: boolean) => void;
}) {
  const [filters, setFilters] = useState(initialQuery);
  const [query, setQuery] = useState(filters);
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const [selection, setSelection] = useState<{ entryId: string; isNew: boolean }>();
  const returnKey = useRef<string>(null);
  const actions = useRef(new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const pending = !page && !error;

  useEffect(() => {
    let active = true;
    void accessLoanRetention({ type: "floridaJournal", entityId, input: query }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "floridaJournalList") setPage(result);
    }).catch(() => { if (active) setError("Could not load Florida transaction journal. Reload to try again."); });
    return () => { active = false; };
  }, [brokerageId, entityId, query]);

  useEffect(() => {
    if (selection || pending || !returnKey.current) return;
    (actions.current.get(returnKey.current) ?? heading.current)?.focus();
    returnKey.current = null;
  }, [selection, pending]);
  useEffect(() => { if (feedback) status.current?.focus(); }, [feedback]);

  function load(input: Query) {
    setPage(undefined);
    setError("");
    setFeedback(undefined);
    setQuery(input);
  }
  function open(entryId?: string) {
    returnKey.current = entryId ?? "new";
    setSelection({ entryId: entryId ?? crypto.randomUUID(), isNew: !entryId });
    setDetail(true);
  }
  function attach(id: string, node: HTMLButtonElement | null) {
    if (node) actions.current.set(id, node);
    else actions.current.delete(id);
  }

  async function download() {
    setDownloading(true);
    setFeedback(undefined);
    try {
      const { from, through } = query;
      const result = await accessLoanRetention({ type: "floridaJournal", entityId, input: { operation: "export", from, through } }, brokerageId);
      if ("error" in result) setFeedback({ error: true, text: result.error });
      else if (result.kind === "floridaJournalExport") {
        const bytes = Uint8Array.from(atob(result.xlsx), value => value.charCodeAt(0));
        downloadSampleFile(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          "orbit-florida-transaction-journal-" + from + "-" + through + ".xlsx");
        setFeedback({ text: "Excel downloaded. " + result.entries + (result.entries === 1 ? " entry, " : " entries, ") + result.gaps +
          " with evidence gaps and " + result.late + " late." });
      }
    } catch { setFeedback({ error: true, text: "Could not download the Florida journal. Try again." }); }
    finally { setDownloading(false); }
  }

  return <>
    <div className={selection ? undefined : "record-form"} hidden={!!selection}>
      <form className="record-form w-full max-w-2xl" onSubmit={event => { event.preventDefault(); load({ ...filters, offset: 0 }); }}>
        <fieldset className="record-form min-w-0" disabled={downloading}>
          <RegisterField label="Applicant, office or transaction number" value={filters.search} limit={120} change={search => setFilters({ ...filters, search })} />
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <RegisterField label="Applications from" date required value={filters.from} change={from => setFilters({ ...filters, from })} />
            <RegisterField label="Applications through" date required value={filters.through} change={through => setFilters({ ...filters, through })} />
          </div>
          <div className="loan-application-actions">
            <Button className="min-h-11" type="submit" variant="outline">Apply filters</Button>
            <Button className="min-h-11" type="button" variant="outline" disabled={pending} onClick={() => load({ ...query })}>Reload results</Button>
          </div>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {pending && <p role="status">Loading Florida transaction journal…</p>}
      <section className="record-form" aria-label="Saved journal entries" aria-busy={pending}>
        <div className="section-heading">
          <h3 ref={heading} tabIndex={-1}>Saved journal entries</h3>
          <div className="loan-application-actions">
            <Button type="button" className="min-h-11" ref={node => attach("new", node)} disabled={downloading} onClick={() => open()}>Record an entry</Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={downloading || !page || filters.from !== query.from || filters.through !== query.through}
              onClick={() => void download()}>{downloading ? "Preparing Excel…" : "Download journal"}</Button>
          </div>
        </div>
        {feedback && <p ref={status} role={feedback.error ? "alert" : "status"} tabIndex={-1}>{feedback.text}</p>}
        {page?.items.length === 0 && <p>No journal entries match these filters.</p>}
        {page?.items.map(item => <article key={item.entryId} className="record-form rounded-lg border border-[var(--line)] p-3">
          <strong className="break-words">{entryName(item)}</strong>
          <p>{item.facts.office} · {item.voided ? "Voided" : item.facts.disposition} · {item.facts.applicationOn}</p>
          <p>Version {item.version} · {item.review.gaps.length} evidence gaps{!item.voided && " · " + item.review.status}</p>
          <div><Button type="button" variant="outline" className="min-h-11" aria-label={"Open entry " + entryName(item)}
            ref={node => attach(item.entryId, node)} disabled={downloading} onClick={() => open(item.entryId)}>Open evidence</Button></div>
        </article>)}
        {(query.offset > 0 || page?.next != null) && <div className="loan-application-actions">
          <Button type="button" variant="outline" className="min-h-11" disabled={query.offset === 0 || pending || downloading}
            onClick={() => load({ ...query, offset: Math.max(0, query.offset - 20) })}>Previous page</Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={page?.next == null || downloading}
            onClick={() => { if (page?.next != null) load({ ...query, offset: page.next }); }}>Next page</Button>
        </div>}
      </section>
    </div>
    {selection && <FloridaJournalDetail key={selection.entryId} brokerageId={brokerageId} entityId={entityId} {...selection}
      onBack={() => { setSelection(undefined); setDetail(false); }} onChange={() => load({ ...query })} />}
  </>;
}

export function FloridaJournal({ brokerageId, onBack }: { brokerageId: string; onBack: () => void }) {
  const [entities, setEntities] = useState<ProgramEntity[]>();
  const [entityId, setEntityId] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [detail, setDetail] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const selected = entities?.find(entity => entity.id === entityId);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "programEntities") setEntities(result.entities);
    }).catch(() => { if (active) setError("Could not load legal entities. Try again."); });
    return () => { active = false; };
  }, [brokerageId, reload]);
  return <div className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2 ref={heading} tabIndex={-1}>Florida transaction journal</h2>
      {!detail && <Button type="button" variant="outline" className="min-h-11" disabled={downloading} onClick={onBack}>Back to loan retention</Button>}
    </div>
    {!detail && <p><a className="underline" href={floridaJournalSources.rule}>Florida journal rule</a>
      {" · "}<a className="underline" href={floridaJournalSources.form}>OFR-494-10</a></p>}
    {error && <div className="record-form"><p role="alert">{error}</p>
      <div><Button type="button" variant="outline" className="min-h-11" onClick={() => { setError(""); setReload(value => value + 1); }}>Reload legal entities</Button></div>
    </div>}
    {!error && !entities && <p role="status">Loading legal entities…</p>}
    {entities?.length === 0 && <p>Add a legal entity in Monthly review to use the Florida journal.</p>}
    {!!entities?.length && !detail && <div className="w-full max-w-2xl">
      <RegisterChoice label="Legal entity" value={entityId} options={["", ...entities.map(entity => entity.id)]}
        disabled={downloading} change={setEntityId}
        optionLabel={id => id ? entities.find(entity => entity.id === id)?.name ?? id : "Select legal entity"} />
    </div>}
    {selected && <p className="break-words"><strong>{selected.name}</strong> · NMLS {selected.nmls}</p>}
    {selected && <FloridaJournalEntries key={selected.id} brokerageId={brokerageId} entityId={selected.id}
      setDetail={setDetail} downloading={downloading} setDownloading={setDownloading} />}
  </div>;
}

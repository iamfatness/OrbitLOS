"use client";

import { useEffect, useRef, useState } from "react";
import { accessComplianceCases, accessLoanRetention } from "@/app/actions";
import type { ProgramEntity } from "@/lib/compliance-program-model";
import { easternDate } from "@/lib/client-retention";
import { newYorkApplicationLogSource } from "@/lib/new-york-application-log-model";
import { newYorkExamRecordFacts, type NewYorkExamRecordFacts as Facts, type NewYorkExamRecordsRequest } from "@/lib/new-york-exam-records-model";
import type { NewYorkExamRecordsResult as Result } from "@/lib/new-york-exam-records";
import { RecordsGroup, RegisterChoice, RegisterField } from "./retention-register-fields";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type Category = Facts["category"];
type List = Extract<Result, { kind: "newYorkExamRecordsList" }>;
type History = Extract<Result, { kind: "newYorkExamRecordsHistory" }>;
type Version = History["versions"][number];
type Feedback = { text: string; error?: boolean };
const categories = ["Written consumer complaint", "DFS correspondence"] as const;
const grid = "grid min-w-0 items-end gap-3 sm:grid-cols-2";
const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium" });

function Field({ name, label, value, date, required, limit = 240 }: {
  name: string; label: string; value?: string; date?: boolean; required?: boolean; limit?: number;
}) {
  return <label className="field min-w-0">{label}<input name={name} type={date ? "date" : "text"}
    defaultValue={value} required={required} maxLength={date ? undefined : limit} /></label>;
}

function Evidence({ record }: { record: Version }) {
  const { facts, finding } = record;
  const dated = (event?: { on: string; reference: string }) => event && event.on + " · " + event.reference;
  const values = [
    ["Original record", facts.original], ["Record date", facts.on],
    ["Status", facts.category === "Written consumer complaint" ? facts.status : facts.direction],
    ["Archive location", facts.location], ["Retrieval check", dated(facts.retrieval)],
    ["Reviewed retention start", dated(facts.retentionBasis)], ["Three-year planning date", finding.reviewOn ?? "Unresolved"],
    ["Related correspondence", facts.category === "Written consumer complaint" && "reference" in facts.related ? facts.related.reference : undefined],
    ["Correction reason", record.correction],
  ];
  return <div className="record-form min-w-0 [overflow-wrap:anywhere]">
    <p className="muted">{record.actor} · {dateLabel.format(new Date(record.at))}</p>
    {finding.gaps.length > 0 && <ul className="list-disc pl-5">{finding.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
    <dl className="record-form">{values.map(([label, value]) => value && <div key={label}><dt className="font-medium">{label}</dt><dd>{value}</dd></div>)}</dl>
    {facts.category === "Written consumer complaint" && facts.actions.length > 0 && <RecordsGroup title="Actions taken">
      <ul className="record-form">{facts.actions.map((event, index) => <li key={index}>{dated(event)}</li>)}</ul>
    </RecordsGroup>}
  </div>;
}

function RecordEditor({ category, initial, disabled, save, cancel }: {
  category: Category; initial?: Facts; disabled: boolean; save: (facts: Facts, correction?: string) => void; cancel: () => void;
}) {
  const complaint = category === "Written consumer complaint";
  const previous = initial?.category === "Written consumer complaint" ? initial : undefined;
  const [actions, setActions] = useState(previous?.actions.length ?? 0);
  const [related, setRelated] = useState(previous?.related.status ?? "Unreviewed");
  const [error, setError] = useState("");
  function submit(form: FormData) {
    const read = (name: string) => String(form.get(name) ?? "").trim();
    const dated = (name: string) => {
      const on = read(name + "On"), reference = read(name + "Reference");
      return on || reference ? { on, reference } : undefined;
    };
    const common = { fileNumber: read("fileNumber"), on: read("on"), original: read("original"),
      location: read("location") || undefined, retrieval: dated("retrieval"), retentionBasis: dated("retention") };
    const parsed = newYorkExamRecordFacts.safeParse(complaint ? {
      ...common, category, status: read("status"), actions: Array.from({ length: actions }, (_, index) => dated("action" + index)),
      related: related === "Unreviewed" ? { status: related } : { status: related, reference: read("related") },
    } : { ...common, category, direction: read("direction") });
    const correction = read("correction");
    if (!parsed.success || (initial && correction.length < 4)) {
      const issue = parsed.error?.issues[0];
      setError(!parsed.success ? issue?.code === "custom" ? issue.message : "Check the dates and enter at least four characters for each evidence reference."
        : "Enter at least four characters for the correction reason.");
      return;
    }
    setError("");
    save(parsed.data, correction || undefined);
  }
  return <form className="record-form w-full max-w-2xl" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    {error && <p role="alert" tabIndex={-1} ref={node => { node?.focus(); }}>{error}</p>}
    <fieldset className="record-form min-w-0" disabled={disabled}>
      <div className={grid}>
        <Field name="fileNumber" label="File number" value={initial?.fileNumber} required limit={100} />
        <Field name="on" label={complaint ? "Complaint received" : "Correspondence date"} value={initial?.on} date required />
      </div>
      <Field name="original" label={complaint ? "Original written complaint reference" : "Original or copy reference"} value={initial?.original} required />
      {complaint ? <>
        <label className="field">Complaint status<select name="status" defaultValue={previous?.status ?? "Open"}><option>Open</option><option>Resolved</option></select></label>
        <RegisterChoice label="Related correspondence" value={related} options={["Unreviewed", "None", "On file"]} change={setRelated} />
        {related !== "Unreviewed" && <Field name="related" label="Related correspondence evidence"
          value={previous && "reference" in previous.related ? previous.related.reference : undefined} required />}
        {Array.from({ length: actions }, (_, index) => <fieldset key={index} className={grid}>
          <legend>Action {index + 1}</legend>
          <Field name={"action" + index + "On"} label="Action date" value={previous?.actions[index]?.on} date required />
          <Field name={"action" + index + "Reference"} label="Action evidence" value={previous?.actions[index]?.reference} required />
        </fieldset>)}
        <div className="loan-application-actions">
          <Button type="button" variant="outline" className="min-h-11" disabled={actions >= 50} onClick={() => setActions(actions + 1)}>Add complaint action</Button>
          {actions > 0 && <Button type="button" variant="outline" className="min-h-11" onClick={() => setActions(actions - 1)}>Remove last action</Button>}
        </div>
      </> : <label className="field">Direction<select name="direction" defaultValue={initial?.category === "DFS correspondence" ? initial.direction : "From DFS"}>
        <option>From DFS</option><option>To DFS</option></select></label>}
      <Field name="location" label="Archive location" value={initial?.location} />
      <div className={grid}>
        <Field name="retrievalOn" label="Retrieval check date" value={initial?.retrieval?.on} date />
        <Field name="retrievalReference" label="Retrieval check evidence" value={initial?.retrieval?.reference} />
        <Field name="retentionOn" label="Reviewed retention start" value={initial?.retentionBasis?.on} date />
        <Field name="retentionReference" label="Retention basis reference" value={initial?.retentionBasis?.reference} />
      </div>
      {initial && <Field name="correction" label="Correction reason" required />}
      <div className="loan-application-actions">
        <Button className="min-h-11" type="submit">Save examination record</Button>
        <Button className="min-h-11" variant="outline" type="button" onClick={cancel}>Cancel</Button>
      </div>
    </fieldset>
  </form>;
}

export function NewYorkExamRecords({ brokerageId, onBack }: { brokerageId: string; onBack: () => void }) {
  const [entities, setEntities] = useState<ProgramEntity[]>();
  const [entityId, setEntityId] = useState("");
  const [category, setCategory] = useState<Category>(categories[0]);
  const [load, setLoad] = useState(0);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "programEntities") setEntities(result.entities);
    }).catch(() => { if (active) setError("Could not load legal entities."); });
    return () => { active = false; };
  }, [brokerageId, load]);
  return <section className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2 ref={heading} tabIndex={-1}>New York examination records</h2>
      <Button className="min-h-11" variant="outline" disabled={locked} onClick={onBack}>Back to loan retention</Button>
    </div>
    <p><a className="underline" href={newYorkApplicationLogSource}>New York recordkeeping rule</a></p>
    {error && <div className="record-form"><p role="alert">{error}</p><div>
      <Button className="min-h-11" variant="outline" onClick={() => { setError(""); setLoad(value => value + 1); }}>Reload legal entities</Button>
    </div></div>}
    {!error && !entities && <p role="status">Loading legal entities…</p>}
    {entities?.length === 0 && <p>Add a legal entity in Monthly review.</p>}
    {!!entities?.length && <div className={grid + " w-full max-w-2xl"}>
      <RegisterChoice label="Legal entity" value={entityId} options={["", ...entities.map(item => item.id)]}
        optionLabel={id => entities.find(item => item.id === id)?.name ?? "Select legal entity"} change={setEntityId} disabled={locked} />
      <RegisterChoice label="Register" value={category} options={categories} change={setCategory} disabled={locked} />
    </div>}
    {entityId && <Register key={entityId + category} brokerageId={brokerageId} entityId={entityId} category={category} lock={setLocked} />}
  </section>;
}

function Register({ brokerageId, entityId, category, lock }: { brokerageId: string; entityId: string; category: Category; lock: (value: boolean) => void }) {
  const [page, setPage] = useState<List>();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ search: "", offset: 0 });
  const [selection, setSelection] = useState<string>();
  const [history, setHistory] = useState<History>();
  const [editing, setEditing] = useState(false);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [listError, setListError] = useState("");
  const [range, setRange] = useState(() => {
    const through = easternDate();
    return { from: through.slice(0, 4) + "-01-01", through };
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const actions = useRef(new Map<string, HTMLButtonElement>());
  const returnKey = useRef<string>(null);
  const retry = useRef<{ signature: string; requestId: string }>(null);
  const current = history?.versions[0];

  useEffect(() => {
    let active = true;
    void accessLoanRetention({ type: "newYorkExamRecords", entityId, input: { operation: "list", category, ...query } }, brokerageId)
      .then(result => {
        if (!active) return;
        if ("error" in result) setListError(result.error);
        else if (result.kind === "newYorkExamRecordsList") setPage(result);
      }).catch(() => { if (active) setListError("Could not load examination records. Reload to try again."); });
    return () => { active = false; };
  }, [brokerageId, entityId, category, query]);
  useEffect(() => { if (selection) detailHeading.current?.focus(); }, [selection, editing]);
  useEffect(() => {
    if (!selection && (page || listError) && returnKey.current) {
      (actions.current.get(returnKey.current) ?? heading.current)?.focus();
      returnKey.current = null;
    }
  }, [selection, page, listError]);
  useEffect(() => { if (feedback) feedbackRef.current?.focus(); }, [feedback]);

  function reloadList(next = { ...query }) {
    setPage(undefined);
    setListError("");
    setQuery(next);
  }
  async function request(input: NewYorkExamRecordsRequest["input"], apply: (result: Exclude<Result, { error: string }>) => void, failure: string) {
    setBusy(true);
    lock(true);
    setFeedback(undefined);
    try {
      const result = await accessLoanRetention({ type: "newYorkExamRecords", entityId, input }, brokerageId);
      if ("error" in result) {
        if (input.operation === "save" && result.error.includes("record changed")) setStale(true);
        setFeedback({ text: result.error, error: true });
      } else if (result.kind === "newYorkExamRecordsHistory" || result.kind === "newYorkExamRecordsExport") apply(result);
    } catch { setFeedback({ text: failure, error: true }); }
    finally { setBusy(false); if (input.operation === "export") lock(false); }
  }
  function read(id: string, before?: number) {
    void request({ operation: "history", recordId: id, before }, result => {
      if (result.kind !== "newYorkExamRecordsHistory") return;
      if (before !== undefined && history) {
        setHistory({ ...result, versions: [...history.versions, ...result.versions] });
        setFeedback({ text: "Earlier versions loaded." });
      } else {
        setHistory(result);
        setStale(false);
        setEditing(false);
        if (!result.versions.length) setFeedback({ text: "This examination record is unavailable.", error: true });
        else if (stale) setFeedback({ text: "Examination record reloaded." });
      }
    }, "Could not load the examination record. Reload to try again.");
  }
  function open(id?: string) {
    returnKey.current = id ?? "new";
    setHistory(undefined);
    setFeedback(undefined);
    setStale(false);
    retry.current = null;
    setSelection(id ?? crypto.randomUUID());
    lock(true);
    setEditing(!id);
    if (id) read(id);
  }
  function back() {
    setSelection(undefined);
    lock(false);
    setFeedback(undefined);
  }
  function save(facts: Facts, correction?: string) {
    if (!selection || busy || stale) return;
    const input = { operation: "save" as const, recordId: selection, expected: current?.version ?? 0, facts, correction };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() };
    void request({ ...input, requestId: retry.current.requestId }, result => {
      if (result.kind !== "newYorkExamRecordsHistory" || !result.versions[0]) return;
      setHistory(result);
      setEditing(false);
      retry.current = null;
      setFeedback({ text: "Examination record saved. Version " + result.versions[0].version + "." });
      reloadList();
    }, "Could not confirm the save. Retry with the same evidence.");
  }
  function download() {
    void request({ operation: "export", category, ...range }, result => {
      if (result.kind !== "newYorkExamRecordsExport") return;
      const label = category === "DFS correspondence" ? "dfs-correspondence" : "complaint-files";
      downloadSampleFile(result.json, "orbit-ny-" + label + "-" + range.from + "-" + range.through + ".json", "application/json");
      setFeedback({ text: "Downloaded " + result.count + (result.count === 1 ? " record" : " records") + " with version history." });
    }, "Could not download the examination records. Try again.");
  }
  function attach(key: string, node: HTMLButtonElement | null) {
    if (node) actions.current.set(key, node);
    else actions.current.delete(key);
  }

  const status = feedback && <p ref={feedbackRef} role={feedback.error ? "alert" : "status"} tabIndex={-1}>{feedback.text}</p>;
  if (selection) return <section className="record-form min-w-0">
    <div className="section-heading">
      <h3 ref={detailHeading} tabIndex={-1}>{editing ? current ? "Correct examination record" : "Record examination evidence" : current?.facts.fileNumber ?? "Examination record"}</h3>
      {!editing && <Button className="min-h-11" variant="outline" disabled={busy} onClick={back}>Back to examination records</Button>}
    </div>
    {status}
    {busy && !current && !editing && <p role="status">Loading examination record…</p>}
    {(stale || (!editing && !current && feedback?.error)) && <div><Button className="min-h-11" variant="outline"
      disabled={busy} onClick={() => read(selection)}>{stale ? "Reload record and discard draft" : "Reload record"}</Button></div>}
    {editing && <RecordEditor key={current?.version ?? 0} category={category} initial={current?.facts} disabled={busy || stale} save={save}
      cancel={() => {
        if (!current) back();
        else if (stale) read(selection);
        else { setEditing(false); setFeedback(undefined); }
      }} />}
    {!editing && current && <>
      <p>Version {current.version}</p>
      <Evidence record={current} />
      <div><Button className="min-h-11" disabled={busy} onClick={() => { setEditing(true); setFeedback(undefined); }}>Record correction</Button></div>
      {history && history.versions.length > 1 && <RecordsGroup title="Previous versions">
        {history.versions.slice(1).map(record => <RecordsGroup key={record.version} title={"Version " + record.version}>
          <Evidence record={record} />
        </RecordsGroup>)}
        {history.next && <div><Button className="min-h-11" variant="outline" disabled={busy}
          onClick={() => read(selection, history.next ?? undefined)}>Load earlier versions</Button></div>}
      </RecordsGroup>}
    </>}
  </section>;

  return <>
    <form className="record-form w-full max-w-2xl" onSubmit={event => { event.preventDefault(); reloadList({ search, offset: 0 }); }}>
      <RegisterField label="Search file number" value={search} limit={100} change={setSearch} />
      <div className="loan-application-actions">
        <Button className="min-h-11" type="submit" variant="outline" disabled={busy}>Apply filter</Button>
        <Button className="min-h-11" type="button" variant="outline" disabled={busy || (!page && !listError)} onClick={() => reloadList()}>Reload results</Button>
      </div>
    </form>
    {status}
    {listError && <p role="alert">{listError}</p>}
    {!page && !listError && <p role="status">Loading examination records…</p>}
    <section className="record-form">
      <div className="section-heading">
        <h3 ref={heading} tabIndex={-1}>Saved examination records</h3>
        <Button className="min-h-11" ref={node => attach("new", node)} disabled={busy} onClick={() => open()}>Record examination evidence</Button>
      </div>
      {page?.records.length === 0 && <p>No records match this register and file number.</p>}
      {page?.records.map(record => <article className="record-form rounded-lg border border-[var(--line)] p-3" key={record.recordId}>
        <strong className="break-words">{record.facts.fileNumber}</strong>
        <p>{record.facts.category === "DFS correspondence" ? record.facts.direction : record.facts.status} · {record.facts.on}</p>
        <p>Version {record.version} · {record.finding.gaps.length} evidence gaps</p>
        <div><Button className="min-h-11" variant="outline" ref={node => attach(record.recordId, node)}
          disabled={busy} aria-label={"Open record " + record.facts.fileNumber} onClick={() => open(record.recordId)}>Open evidence</Button></div>
      </article>)}
      {(query.offset > 0 || page?.next != null) && <div className="loan-application-actions">
        <Button className="min-h-11" variant="outline" disabled={busy || !page || query.offset === 0}
          onClick={() => reloadList({ ...query, offset: Math.max(0, query.offset - 20) })}>Previous page</Button>
        <Button className="min-h-11" variant="outline" disabled={busy || page?.next == null}
          onClick={() => { if (page?.next != null) reloadList({ ...query, offset: page.next }); }}>Next page</Button>
      </div>}
    </section>
    <RecordsGroup title="Export examination records">
      <form className="record-form w-full max-w-2xl" onSubmit={event => { event.preventDefault(); if (!busy) download(); }}>
        <fieldset className="record-form min-w-0" disabled={busy}>
          <div className={grid}>
            <RegisterField label="Records from" date required value={range.from} change={from => setRange({ ...range, from })} />
            <RegisterField label="Records through" date required value={range.through} change={through => setRange({ ...range, through })} />
          </div>
          <div><Button className="min-h-11" type="submit">{busy ? "Preparing export…" : "Download examination JSON"}</Button></div>
        </fieldset>
      </form>
    </RecordsGroup>
  </>;
}

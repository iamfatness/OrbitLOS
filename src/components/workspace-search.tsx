"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { searchWorkspace } from "@/app/actions";
import { searchFilters, searchLabels, type SearchPage, type SearchQuery, type SearchRecord } from "@/lib/workspace-search-model";
import { Button } from "./ui/button";

export type SearchSelection = Pick<SearchQuery, "query" | "filter">;

export function WorkspaceSearch({ brokerageId, processor, selection, onSearch, version, busy, open }: {
  brokerageId: string; processor: boolean; selection: SearchSelection; onSearch: (selection: SearchSelection) => void;
  version: object; busy: boolean; open: (record: SearchRecord) => void;
}) {
  const [text, setText] = useState(selection.query);
  const [filter, setFilter] = useState(selection.filter);
  const [request, setRequest] = useState<SearchQuery | undefined>(() => selection.query ? { type: "search", ...selection } : undefined);
  const [data, setData] = useState<{ request: SearchQuery; version: object; result: SearchPage | { error: string } }>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!request) return;
    let active = true;
    const failure = { error: "Could not search this workspace. Try again." };
    void searchWorkspace(request, brokerageId).then((result) => {
      if (active) setData({ request, version, result: "error" in result || result.kind === "results" ? result : failure });
    }, () => { if (active) setData({ request, version, result: failure }); });
    return () => { active = false; };
  }, [brokerageId, request, version]);

  function search(query: string, nextFilter: SearchQuery["filter"]) {
    const next = { query: query.trim(), filter: nextFilter };
    onSearch(next);
    setRequest({ type: "search", ...next });
  }

  const result = data?.request === request && data?.version === version ? data.result : undefined;
  const page = result && !("error" in result) ? result : undefined;
  return <section className="integration record-form manager-panel" aria-label="Workspace search">
    <form className="workspace-search-form" role="search" onSubmit={(event) => { event.preventDefault(); search(text, filter); }}>
      <label className="field">Search terms<input ref={input} type="search" value={text} required minLength={2} maxLength={100}
        placeholder="Borrower, address, lender reference, or work title" onChange={(event) => setText(event.target.value)} /></label>
      <label className="field">Record type<select value={filter} onChange={(event) => {
        const next = event.target.value as SearchQuery["filter"];
        setFilter(next);
        if (text.trim().length >= 2) search(text, next);
      }}>
        {searchFilters.filter((type) => !processor || (type !== "Leads" && type !== "Tasks")).map((type) => <option key={type}>{type}</option>)}
      </select></label>
      <Button type="submit" size="sm"><Search /> Search</Button>
    </form>
    {!request && <p className="muted">Enter a name, property address, contact detail, lender reference, or work title.</p>}
    {request && !result && <p className="muted" role="status">Searching your workspace…</p>}
    {result && "error" in result && <p role="alert">{result.error}</p>}
    {page && <>
      <div className="section-heading"><h2>Search results</h2><span className="pill" role="status">{page.rows.length} on this page</span></div>
      {page.indexing && <div className="loan-application-actions">
        <p className="muted">Some records are still being indexed.</p>
        <Button size="sm" variant="outline" onClick={() => request && setRequest({ ...request, after: undefined })}>Check for more matches</Button>
      </div>}
      {page.rows.length ? <ul className="loan-task-list">{page.rows.map((row) => <li className="loan-task workspace-search-result" key={`${row.kind}:${row.id}`}>
        <div className="loan-task-copy"><span className="pill">{searchLabels[row.kind]}</span><strong>{row.title}</strong><span>{row.detail}</span></div>
        <Button size="sm" variant="outline" disabled={busy}
          aria-label={`Open ${searchLabels[row.kind].toLowerCase()} for ${row.title}${row.kind === "conversation" ? ` · ${row.detail}` : ""}`}
          onClick={() => open(row)}>Open</Button>
      </li>)}</ul> : <p className="empty-inline">{page.indexing ? "No matches indexed for this search yet." : request?.after ? "No further matches on this page." : "No matching records in your workspace."}</p>}
      {request && (request.after || (page.next && !page.indexing)) && <div className="loan-application-actions">
        {request.after && <Button size="sm" variant="outline" onClick={() => setRequest({ ...request, after: undefined })}>First page</Button>}
        {page.next && !page.indexing && <Button size="sm" variant="outline" onClick={() => setRequest({ ...request, after: page.next ?? undefined })}>Next page</Button>}
      </div>}
    </>}
  </section>;
}

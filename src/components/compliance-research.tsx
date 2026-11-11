"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import { complianceCaseStatuses } from "@/lib/compliance-case-model";
import { researchBaseline, researchSources, type ResearchFilters, type ResearchRequest, type ResearchSource } from "@/lib/compliance-research-model";
import type { complianceResearchWork } from "@/lib/compliance-research";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Result = ReturnType<typeof complianceResearchWork>;
type Detail = Extract<Result, { kind: "researchDetail" }>;
type List = Extract<Result, { kind: "researchList" }>;
const initialFilters: ResearchFilters = { jurisdiction: "", status: "", ownership: "all" };
const states = researchSources.filter((entry) => entry.jurisdiction !== "US");

function Jurisdiction({ value, all, change }: { value: string; all?: boolean; change: (value: string) => void }) {
  return <label className="field">Jurisdiction<select value={value} onChange={(event) => change(event.target.value)}>
    {all && <option value="">All jurisdictions</option>}<option value="US">Federal</option>
    {states.map((entry) => <option key={entry.key} value={entry.jurisdiction}>{entry.title}</option>)}
  </select></label>;
}

function ResearchEditor({ detail, pending, save }: { detail: Detail; pending: boolean; save: (input: Omit<Extract<ResearchRequest, { operation: "save" }>, "requestId">) => void }) {
  const { item } = detail;
  const savedSource = JSON.parse(item.sourceSnapshot) as ResearchSource & { researchBaseline: string };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save({ operation: "save", caseId: item.id, expectedRevision: item.revision,
      status: String(form.get("status")) as (typeof complianceCaseStatuses)[number], ownerEmail: String(form.get("owner")),
      followUpOn: String(form.get("followUpOn")) || null, nextAction: String(form.get("nextAction")), note: String(form.get("note")) });
  }
  return <div className="record-form">
    <h3 tabIndex={-1}>{item.title}</h3>
    <p className="muted">{item.kind} · {item.status} · Revision {item.revision}</p>
    {!item.ownerAvailable && <p role="alert">The recorded owner is no longer eligible. Assign an active brokerage admin.</p>}
    {item.sourceChanged && <p role="alert">The research source has changed or is unavailable. Review current authority; this case retains its original source snapshot.</p>}
    <details className="document-form"><summary>Research basis · {savedSource.researchBaseline}</summary>
      <p>{savedSource.summary}</p><p>{savedSource.applicability}</p><p>{savedSource.gap}</p>
      <p><strong>Evidence to investigate:</strong> {savedSource.evidence}</p>
      <a className="underline" target="_blank" rel="noreferrer" href={savedSource.sourceUrl}>Official source</a>
    </details>
    <form key={`${item.id}:${item.revision}`} className="record-form" onSubmit={submit}>
      <fieldset disabled={pending} className="record-form">
        <div className="form-grid">
          <label className="field">Workflow status<select name="status" defaultValue={item.status}>
            {complianceCaseStatuses.map((status) => <option key={status}>{status}</option>)}
          </select></label>
          <label className="field">Accountable admin<select name="owner" required defaultValue={item.ownerAvailable ? item.ownerEmail : ""}>
            <option value="">Choose an active admin</option>{detail.owners.map((owner) => <option key={owner.email} value={owner.email}>{owner.name}</option>)}
          </select></label>
          <label className="field">Internal follow-up date (UTC)<input name="followUpOn" type="date" defaultValue={item.followUpOn ?? ""} /></label>
        </div>
        <p className="muted">This date is an internal planning target. It does not calculate or change a legal deadline.</p>
        <label className="field">Next action<textarea name="nextAction" required maxLength={500} rows={2} defaultValue={item.nextAction} /></label>
        <label className="field">Reason or progress note<textarea name="note" required maxLength={1000} rows={3} /></label>
        <p className="muted">General research only. Keep borrower data, confidential investigations and privileged advice out of these notes.</p>
        <div><Button type="submit" size="sm">{pending ? "Saving…" : "Save research work"}</Button></div>
      </fieldset>
    </form>
    <details className="document-form"><summary>Review history</summary>
      <ul className="loan-task-list">{detail.history.map((entry) => <li key={entry.revision} className="loan-task compliance-row">
        <div className="loan-task-copy"><strong>{entry.action}</strong><span>{entry.actor} · {dateTime(entry.at)} ET · Revision {entry.revision}</span>
          {entry.note && <span>{entry.note}</span>}</div>
      </li>)}</ul>{detail.moreHistory && <p>Showing the most recent 50 changes.</p>}
    </details>
  </div>;
}

export function ComplianceResearch({ brokerageId, paused }: { brokerageId: string; paused: boolean }) {
  const [view, setView] = useState<"Sources" | "Research work">("Sources");
  const [jurisdiction, setJurisdiction] = useState("US");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(initialFilters);
  const [after, setAfter] = useState<List["next"]>(null);
  const [caseId, setCaseId] = useState<string>();
  const [revision, refresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [response, setResponse] = useState<{ key: string; data: Result }>();
  const attempt = useRef<{ key: string; id: string }>(null);
  const request = useMemo<ResearchRequest>(() => caseId ? { operation: "read", caseId } :
    { operation: "list", filters, ...(after ? { after } : {}) }, [caseId, filters, after]);
  const key = JSON.stringify([brokerageId, request, revision]);
  const activeBrokerage = useRef<string | null>(brokerageId);
  useEffect(() => { activeBrokerage.current = brokerageId; return () => { activeBrokerage.current = null; }; }, [brokerageId]);
  useEffect(() => {
    if (paused || (view === "Sources" && !caseId)) return;
    let active = true;
    void accessComplianceCases({ type: "research", input: request }, brokerageId).then((result) => {
      if (active && ("error" in result || result.kind === "researchList" || result.kind === "researchDetail")) setResponse({ key, data: result });
    }, () => { if (active) setResponse({ key, data: { error: "Could not load research work. Refresh to try again." } }); });
    return () => { active = false; };
  }, [brokerageId, caseId, key, paused, request, view]);
  const data = response?.key === key ? response.data : undefined;
  const detail = data && "kind" in data && data.kind === "researchDetail" ? data : undefined;
  const list = data && "kind" in data && data.kind === "researchList" ? data : undefined;
  const matches = researchSources.filter((entry) => entry.jurisdiction === jurisdiction &&
    `${entry.title} ${entry.summary} ${entry.gap} ${entry.evidence}`.toLowerCase().includes(search.trim().toLowerCase()));
  function changeFilters(next: ResearchFilters) { setFilters(next); setAfter(null); setMessage(undefined); }
  async function mutate(input: Extract<ResearchRequest, { operation: "open" }> | Omit<Extract<ResearchRequest, { operation: "save" }>, "requestId">) {
    if (pending || paused) return;
    setPending(true); setMessage(undefined);
    const attemptKey = JSON.stringify([brokerageId, input]);
    if (attempt.current?.key !== attemptKey) attempt.current = { key: attemptKey, id: crypto.randomUUID() };
    const payload = input.operation === "save" ? { ...input, requestId: attempt.current.id } : input;
    try {
      const result = await accessComplianceCases({ type: "research", input: payload }, brokerageId);
      if (activeBrokerage.current !== brokerageId) return;
      if ("error" in result) { setMessage({ text: result.error, error: true }); return; }
      if (result.kind !== "researchDetail") { setMessage({ text: "Unexpected response. Refresh before continuing.", error: true }); return; }
      attempt.current = null;
      setCaseId(result.item.id); setView("Research work"); refresh((value) => value + 1);
      setMessage({ text: input.operation === "open" ? "Research work opened. Existing work is reused." : "Research work saved. Legal approval remains unverified." });
    } catch { setMessage({ text: "The response was interrupted. Retry the same save or refresh to check its outcome.", error: true }); }
    finally { if (activeBrokerage.current === brokerageId) setPending(false); }
  }
  return <div className="integration manager-panel record-form">
    <h2>Research &amp; control gaps</h2>
    <p className="muted">50 states · 25 federal research areas · Baseline {researchBaseline}. DC and territories require separate research.</p>
    <div className="document-item"><strong>Legal approval and enforcement remain unverified</strong>
      <p>Track review work and missing controls. Workflow status and notes do not approve a jurisdiction or verify compliance.</p></div>
    <div className="loan-application-actions">
      {(["Sources", "Research work"] as const).map((option) => <Button key={option} size="sm" disabled={pending}
        variant={view === option && !caseId ? "default" : "outline"} onClick={() => { setView(option); setCaseId(undefined); setMessage(undefined); }}>{option}</Button>)}
      {(view === "Research work" || caseId) && <Button size="sm" variant="outline" disabled={pending || paused}
        onClick={() => { setAfter(null); refresh((value) => value + 1); }}>Refresh research work</Button>}
    </div>
    {message && <p role={message.error ? "alert" : "status"}>{message.text}</p>}
    {view === "Sources" && !caseId ? <>
      <div className="form-grid"><Jurisdiction value={jurisdiction} change={(value) => { setJurisdiction(value); setSearch(""); }} />
        <label className="field">Search research<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      {matches.map((entry) => <article key={entry.key} className="document-item record-form">
        <h3>{entry.title}</h3><p>{entry.summary}</p><p className="muted">{entry.applicability}</p><p><strong>Gap:</strong> {entry.gap}</p>
        <details><summary>Evidence to investigate</summary><p>{entry.evidence}</p></details>
        <a className="underline" target="_blank" rel="noreferrer" href={entry.sourceUrl}>Official source</a>
        <div className="loan-application-actions"><Button size="sm" disabled={pending || paused}
          onClick={() => void mutate({ operation: "open", sourceKey: entry.key, kind: "Requirement review" })}>Track requirement review</Button>
          <Button size="sm" variant="outline" disabled={pending || paused}
            onClick={() => void mutate({ operation: "open", sourceKey: entry.key, kind: "Control gap" })}>Track control gap</Button></div>
      </article>)}{!matches.length && <p>No research matches. Clear the search to see this jurisdiction.</p>}
    </> : <>
      {!caseId && <div className="form-grid"><Jurisdiction all value={filters.jurisdiction} change={(value) => changeFilters({ ...filters, jurisdiction: value })} />
        <label className="field">Status<select value={filters.status} onChange={(event) => changeFilters({ ...filters, status: event.target.value as ResearchFilters["status"] })}>
          <option value="">All statuses</option>{complianceCaseStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="field">Ownership<select value={filters.ownership} onChange={(event) => changeFilters({ ...filters, ownership: event.target.value as ResearchFilters["ownership"] })}>
          <option value="all">All owners</option><option value="mine">Assigned to me</option><option value="unavailable">Owner unavailable</option></select></label>
      </div>}
      {!data && <p role="status">Loading research work…</p>}
      {data && "error" in data && <p role="alert">{data.error}</p>}
      {detail && <ResearchEditor detail={detail} pending={pending || paused} save={(input) => void mutate(input)} />}
      {list && <><p>{list.counts.total} research items · {list.counts.overdue} past internal follow-up date (UTC). Loan compliance has not been evaluated.</p>
        <ul className="loan-task-list">{list.items.map((item) => <li key={item.id} className="loan-task compliance-row">
          <div className="loan-task-copy"><strong>{item.title}</strong><span>{item.status} · {item.ownerName ?? "Owner unavailable"}</span>
            <span>{item.nextAction}</span><span>{item.followUpOn ? `Internal follow-up: ${item.followUpOn}${item.overdue ? " · Overdue" : ""}` : "No internal follow-up date"}</span></div>
          <Button size="sm" variant="outline" onClick={() => { setCaseId(item.id); setMessage(undefined); }}>Open research work</Button>
        </li>)}</ul>{!list.items.length && <p>No research work matches. Open Sources to track a review; an empty queue does not indicate compliance.</p>}
        <div className="loan-application-actions">{after && <Button size="sm" variant="outline" onClick={() => setAfter(null)}>First page</Button>}
          {list.next && <Button size="sm" variant="outline" onClick={() => setAfter(list.next)}>Next page</Button>}</div>
      </>}
    </>}
  </div>;
}

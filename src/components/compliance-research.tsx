"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { accessComplianceCases } from "@/app/actions";
import { complianceCaseStatuses } from "@/lib/compliance-case-model";
import { researchBaseline, researchKinds, researchSources, type ResearchFilters, type ResearchRequest, type ResearchSource } from "@/lib/compliance-research-model";
import type { complianceResearchWork } from "@/lib/compliance-research";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { ComplianceStateScope } from "./compliance-state-scope";

type Result = ReturnType<typeof complianceResearchWork>;
type Detail = Extract<Result, { kind: "researchDetail" }>;
type List = Extract<Result, { kind: "researchList" }>;
type RolloutCases = Extract<Result, { kind: "stateRollout" }>["items"][number]["cases"];
const initialFilters: ResearchFilters = { jurisdiction: "", status: "", ownership: "all" };
const states = researchSources.filter((entry) => entry.jurisdiction !== "US");

function Jurisdiction({ value, all, change }: { value: string; all?: boolean; change: (value: string) => void }) {
  return <label className="field">Jurisdiction<select value={value} onChange={(event) => change(event.target.value)}>
    {all && <option value="">All jurisdictions</option>}<option value="US">Federal</option>
    {states.map((entry) => <option key={entry.key} value={entry.jurisdiction}>{entry.title}</option>)}
  </select></label>;
}

function ResearchEditor({ detail, pending, save, heading }: {
  detail: Detail; pending: boolean; heading: RefObject<HTMLHeadingElement | null>;
  save: (input: Omit<Extract<ResearchRequest, { operation: "save" }>, "requestId">) => void;
}) {
  const { item } = detail;
  const savedSource = JSON.parse(item.sourceSnapshot) as ResearchSource & { researchBaseline: string };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save({ operation: "save", caseId: item.id, expectedRevision: item.revision,
      status: String(form.get("status")) as (typeof complianceCaseStatuses)[number], ownerEmail: String(form.get("owner")),
      followUpOn: String(form.get("followUpOn")) || null, nextAction: String(form.get("nextAction")),
      evidenceReference: String(form.get("evidenceReference")), note: String(form.get("note")) });
  }
  return <section className="record-form" aria-label="Research case">
    <h3 ref={heading} tabIndex={-1}>{item.title}</h3>
    <p className="muted">{item.kind} · {item.status} · Revision {item.revision}</p>
    {!item.ownerAvailable && <p role="alert">The recorded owner is no longer eligible. Assign an active brokerage admin.</p>}
    {item.sourceChanged && <p role="alert">The research source has changed or is unavailable. Review current authority; this case retains its original source snapshot.</p>}
    <details className="document-form"><summary>Research basis · {savedSource.researchBaseline}</summary>
      <p>{savedSource.summary}</p><p>{savedSource.applicability}</p><p>{savedSource.gap}</p>
      {savedSource.counselQuestion && <p><strong>Counsel review</strong> · {savedSource.counselQuestion}</p>}
      <p><strong>Evidence to investigate</strong> · {savedSource.evidence}</p>
      <ResearchLinks source={savedSource} />
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
        <label className="field">Evidence reference (optional)<input name="evidenceReference" maxLength={250} defaultValue={item.evidenceReference} /></label>
        <label className="field">Reason or progress note<textarea name="note" required maxLength={1000} rows={3} /></label>
        <p className="muted">General research only. Keep borrower data, confidential investigations and privileged advice out of these notes.</p>
        <div><Button type="submit" size="sm">{pending ? "Saving…" : "Save research work"}</Button></div>
      </fieldset>
    </form>
    <details className="document-form"><summary>Review history</summary>
      <ul className="loan-task-list">{detail.history.map((entry) => <li key={entry.revision} className="loan-task compliance-row">
        <div className="loan-task-copy"><strong>{entry.action}</strong><span>{entry.actor} · {dateTime(entry.at)} ET · Revision {entry.revision}</span>
          {entry.evidenceReference && <span>Evidence · {entry.evidenceReference}</span>}
          {entry.note && <span>{entry.note}</span>}</div>
      </li>)}</ul>{detail.moreHistory && <p>Showing the most recent 50 changes.</p>}
    </details>
  </section>;
}

function ResearchLinks({ source }: { source: ResearchSource }) {
  const links = new Map((source.relatedSources ?? []).map(link => [link.url, link]));
  if (!links.has(source.sourceUrl)) links.set(source.sourceUrl, { label: "Starting authority", url: source.sourceUrl });
  return <ul>{[...links.values()].map(link =>
    <li key={link.url}><a className="underline" target="_blank" rel="noreferrer" href={link.url}>{link.label}</a></li>)}</ul>;
}

export function ComplianceResearch({ brokerageId, paused, startWithState, active, openReview, stateTarget }: {
  brokerageId: string; paused: boolean; startWithState?: boolean; active: boolean;
  openReview: (target: import("@/lib/compliance-program-model").ProgramReviewTarget, origin: string) => void;
  stateTarget?: import("@/lib/compliance-program-model").StateScopeTarget;
}) {
  const [view, setView] = useState<"Sources" | "Research work" | "State rollout">(startWithState ? "State rollout" : "Sources");
  const [jurisdiction, setJurisdiction] = useState("US");
  const [rolloutState, setRolloutState] = useState(stateTarget?.jurisdiction ?? (startWithState ? "" : "MI"));
  const rolloutSelect = useRef<HTMLSelectElement>(null);
  const rolloutSearch = useRef<HTMLInputElement>(null);
  const [requirementSearch, setRequirementSearch] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const origin = useRef<string | null>(null);
  const enteringCase = useRef(false);
  const returning = useRef(false);
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
    view === "State rollout" ? { operation: "stateRollout", jurisdiction: rolloutState } :
    { operation: "list", filters, ...(after ? { after } : {}) }, [caseId, view, rolloutState, filters, after]);
  const key = JSON.stringify([brokerageId, request, revision]);
  const activeBrokerage = useRef<string | null>(brokerageId);
  useEffect(() => { activeBrokerage.current = brokerageId; return () => { activeBrokerage.current = null; }; }, [brokerageId]);
  useEffect(() => {
    if (paused || (!caseId && (view === "Sources" || (view === "State rollout" && !rolloutState)))) return;
    let active = true;
    void accessComplianceCases({ type: "research", input: request }, brokerageId).then((result) => {
      if (active && ("error" in result || result.kind === "researchList" || result.kind === "researchDetail" || result.kind === "stateRollout")) {
        setResponse({ key, data: result });
      }
    }, () => { if (active) setResponse({ key, data: { error: "Could not load research work. Refresh to try again." } }); });
    return () => { active = false; };
  }, [brokerageId, caseId, key, paused, request, rolloutState, view]);
  const data = response?.key === key ? response.data : undefined;
  const detail = data && "kind" in data && data.kind === "researchDetail" ? data : undefined;
  const list = data && "kind" in data && data.kind === "researchList" ? data : undefined;
  const rollout = data && "kind" in data && data.kind === "stateRollout" ? data : undefined;
  const selectedState = rollout?.states.find(item => item.jurisdiction === rolloutState);
  const terms = requirementSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const visibleAreas = rollout?.items.map(area => ({
    ...area,
    requirements: searching ? area.requirements.filter(({ source }) => {
      const searchable = [source.title, source.summary, source.evidence, source.counselQuestion,
        ...source.relatedSources?.map(link => link.label) ?? []].join(" ").toLowerCase();
      return terms.every(term => searchable.includes(term));
    }) : area.requirements,
  })).filter(area => !searching || area.requirements.length > 0) ?? [];
  const visibleRequirements = visibleAreas.reduce((total, area) => total + area.requirements.length, 0);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);
  useEffect(() => {
    if (detail && enteringCase.current) {
      enteringCase.current = false;
      heading.current?.focus();
    }
    if (!caseId && returning.current && (view === "Sources" || data)) {
      returning.current = false;
      const button = origin.current && panel.current?.querySelector<HTMLButtonElement>(`[data-research-action="${CSS.escape(origin.current)}"]`);
      if (button) button.closest("details")?.setAttribute("open", "");
      (button || rolloutSelect.current)?.focus();
    }
  }, [caseId, data, detail, view]);
  const matches = researchSources.filter((entry) => entry.jurisdiction === jurisdiction &&
    `${entry.title} ${entry.summary} ${entry.gap} ${entry.evidence}`.toLowerCase().includes(search.trim().toLowerCase()));
  function changeFilters(next: ResearchFilters) { setFilters(next); setAfter(null); setMessage(undefined); }
  function openCase(id: string, action: string) {
    origin.current = action;
    enteringCase.current = true;
    setCaseId(id);
    setMessage(undefined);
  }
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
      if (input.operation === "open") openCase(result.item.id, `${input.sourceKey}:${input.kind}`);
      else setMessage({ text: "Research work saved." });
      refresh((value) => value + 1);
    } catch { setMessage({ text: "The response was interrupted. Retry the same save or refresh to check its outcome.", error: true }); }
    finally { if (activeBrokerage.current === brokerageId) setPending(false); }
  }
  function renderCases(source: ResearchSource, cases: RolloutCases) {
    return researchKinds.map(kind => {
      const item = cases.find(entry => entry.kind === kind);
      return <div className="loan-task compliance-row" key={kind}>
        <div className="loan-task-copy"><strong>{kind}</strong>
          <span>{item ? `${item.status} · ${item.ownerName ?? "Owner unavailable"}` : "Untracked"}</span>
          {item?.followUpOn && <span>Internal follow-up · {item.followUpOn} UTC</span>}
          {item?.evidenceReference && <span>Evidence · {item.evidenceReference}</span>}
          {item?.sourceChanged && <span>Source changed since tracking began</span>}
          {item?.overdue && <span>Past internal follow-up date</span>}
        </div>
        <Button data-research-action={`${source.key}:${kind}`} size="sm" variant="outline" disabled={pending || paused} onClick={() => {
          if (item) openCase(item.id, `${source.key}:${kind}`);
          else void mutate({ operation: "open", sourceKey: source.key, kind });
        }}>{item ? `Open ${kind.toLowerCase()}` : `Track ${kind.toLowerCase()}`}</Button>
      </div>;
    });
  }
  return <div className="integration manager-panel record-form compliance-research-panel" ref={panel}>
    <h2>{startWithState && view === "State rollout" && !caseId ? "States and activities" : "Research & control gaps"}</h2>
    <p className="muted">50 states · 25 federal research areas · Baseline {researchBaseline}. DC and territories require separate research.</p>
    <div className="document-item"><strong>Legal approval and enforcement remain unverified</strong>
      <p>Track review work and missing controls. Workflow status and notes do not approve a jurisdiction or verify compliance.</p></div>
    <div className="loan-application-actions">
      {(["Sources", "State rollout", "Research work"] as const).map((option) => <Button key={option} size="sm" disabled={pending}
        aria-pressed={view === option} variant={view === option ? "default" : "outline"}
        onClick={() => { setView(option); setCaseId(undefined); setMessage(undefined); }}>{option}</Button>)}
      {(view !== "Sources" || caseId) && <Button size="sm" variant="outline" disabled={pending || paused}
        onClick={() => { setAfter(null); refresh((value) => value + 1); }}>Refresh research work</Button>}
    </div>
    {message && <p ref={feedback} tabIndex={-1} role={message.error ? "alert" : "status"}>{message.text}</p>}
    {caseId && <div><Button size="sm" variant="outline" disabled={pending} onClick={() => {
      returning.current = true;
      enteringCase.current = false;
      setCaseId(undefined);
      setMessage(undefined);
    }}>Back to {view === "State rollout" ? "state rollout" : view.toLowerCase()}</Button></div>}
    {view === "State rollout" && !caseId ? <section className="record-form" aria-label="State rollout">
      <div className="form-grid">
        <label className="field">State<select ref={rolloutSelect} value={rolloutState} disabled={pending} onChange={event => setRolloutState(event.target.value)}>
          {startWithState && <option value="">Choose a state</option>}
          {states.map(item => <option key={item.key} value={item.jurisdiction}>{item.title}</option>)}
        </select></label>
        <label className="field">Search requirements<input ref={rolloutSearch} type="search" value={requirementSearch}
          disabled={!rolloutState} maxLength={120} onChange={event => setRequirementSearch(event.target.value)} /></label>
      </div>
      {!rolloutState && <p>Choose a state where your brokerage operates. You can save business facts for review.</p>}
      {rolloutState && !data && <p role="status">{paused ? "State rollout is unavailable while the workspace is paused." : "Loading state rollout…"}</p>}
      {data && "error" in data && <p role="alert">{data.error}</p>}
      {rollout && <>
        <div role="status">
          <p>{selectedState?.name} · {selectedState?.tracked} of {selectedState?.total} review areas tracked</p>
          <p className="muted">{searching
            ? `${visibleRequirements} of ${selectedState?.requirements} specific requirements match`
            : `${selectedState?.requirements} specific requirements · ${rollout.states.filter(item => item.tracked > 0).length} of ${rollout.states.length} states have tracked work`}</p>
        </div>
        <ComplianceStateScope key={`${brokerageId}:${rolloutState}`} brokerageId={brokerageId} jurisdiction={rolloutState}
          paused={paused} initiallyOpen={startWithState} initialEntityId={stateTarget?.jurisdiction === rolloutState ? stateTarget.entityId : undefined}
          active={active} openReview={openReview} />
        <details className="document-form"><summary>Tracking by state</summary>
          <ul className="document-list">{rollout.states.map(item => <li key={item.jurisdiction} className="document-item">
            <div><strong>{item.name}</strong><p>{item.tracked} of {item.total} review areas tracked · {item.requirements} specific requirements</p></div>
            <Button size="sm" variant="outline" disabled={item.jurisdiction === rolloutState || pending || paused}
              onClick={event => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                rolloutSelect.current?.focus();
                setRolloutState(item.jurisdiction);
              }}>Review {item.name}</Button>
          </li>)}</ul>
        </details>
        {searching && visibleRequirements === 0 && <div className="record-form">
          <p>No matching requirements in {selectedState?.name}.</p>
          <div><Button size="sm" variant="outline" className="min-h-11" onClick={() => {
            setRequirementSearch("");
            rolloutSearch.current?.focus();
          }}>Clear search</Button></div>
        </div>}
        {visibleAreas.map(({ source, cases, requirements }) => <section aria-label={source.title} className="document-item record-form" key={source.key}>
          <h3>{source.title}</h3>
          {!searching && <>
            <details className="document-form"><summary>Open questions and evidence</summary>
              <p>{source.summary}</p><p>{source.applicability}</p><p>{source.gap}</p><p>{source.evidence}</p><ResearchLinks source={source} />
            </details>
            {renderCases(source, cases)}
          </>}
          {requirements.length > 0 && <details className="document-form" open={searching || undefined}>
            <summary>Specific requirements ({requirements.length})</summary>
            <div className="record-form">{requirements.map(requirement => <section className="record-form state-rollout-requirement"
              key={requirement.source.key} aria-label={requirement.source.title}>
              <h4>{requirement.source.title}</h4>
              <p>{requirement.source.summary}</p>
              <p><strong>Counsel review</strong> · {requirement.source.counselQuestion}</p>
              <details><summary>Source and evidence</summary>
                <p>Source checked {requirement.source.sourceDate}</p>
                <ResearchLinks source={requirement.source} />
                <p>{requirement.source.evidence}</p>
              </details>
              {renderCases(requirement.source, requirement.cases)}
            </section>)}</div>
          </details>}
        </section>)}
      </>}
    </section> : view === "Sources" && !caseId ? <>
      <div className="form-grid"><Jurisdiction value={jurisdiction} change={(value) => { setJurisdiction(value); setSearch(""); }} />
        <label className="field">Search research<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      {matches.map((entry) => <article key={entry.key} className="document-item record-form">
        <h3>{entry.title}</h3><p>{entry.summary}</p><p className="muted">{entry.applicability}</p><p><strong>Gap:</strong> {entry.gap}</p>
        <details><summary>Evidence to investigate</summary><p>{entry.evidence}</p></details>
        <a className="underline" target="_blank" rel="noreferrer" href={entry.sourceUrl}>Official source</a>
        <div className="loan-application-actions"><Button data-research-action={`${entry.key}:Requirement review`} size="sm" disabled={pending || paused}
          onClick={() => void mutate({ operation: "open", sourceKey: entry.key, kind: "Requirement review" })}>Track requirement review</Button>
          <Button data-research-action={`${entry.key}:Control gap`} size="sm" variant="outline" disabled={pending || paused}
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
      {detail && <ResearchEditor detail={detail} heading={heading} pending={pending || paused} save={(input) => void mutate(input)} />}
      {list && <><p>{list.counts.total} research items · {list.counts.overdue} past internal follow-up date (UTC). Loan compliance has not been evaluated.</p>
        <ul className="loan-task-list">{list.items.map((item) => <li key={item.id} className="loan-task compliance-row">
          <div className="loan-task-copy"><strong>{item.title}</strong><span>{item.status} · {item.ownerName ?? "Owner unavailable"}</span>
            <span>{item.nextAction}</span><span>{item.followUpOn ? `Internal follow-up: ${item.followUpOn}${item.overdue ? " · Overdue" : ""}` : "No internal follow-up date"}</span></div>
          <Button data-research-action={item.id} size="sm" variant="outline" onClick={() => openCase(item.id, item.id)}>Open research work</Button>
        </li>)}</ul>{!list.items.length && <p>No research work matches. Open Sources to track a review; an empty queue does not indicate compliance.</p>}
        <div className="loan-application-actions">{after && <Button size="sm" variant="outline" onClick={() => setAfter(null)}>First page</Button>}
          {list.next && <Button size="sm" variant="outline" onClick={() => setAfter(list.next)}>Next page</Button>}</div>
      </>}
    </>}
  </div>;
}

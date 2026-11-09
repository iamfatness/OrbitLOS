"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { RefreshCw } from "lucide-react";
import { accessPlaybookRuns } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { documentReminderTimingLabel } from "@/lib/playbook-model";
import { playbookRunFilters, playbookRunSources, type PlaybookRun, type PlaybookRunQuery, type PlaybookRunResult } from "@/lib/playbook-run-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type ListQuery = Extract<PlaybookRunQuery, { type: "list" }>;
type ListPage = Extract<PlaybookRunResult, { kind: "list" }>;
type AttemptPage = Extract<PlaybookRunResult, { kind: "attempts" }>;
type DocumentSchedule = Extract<PlaybookRunResult, { kind: "document-schedule" }>;
type RecoveryPreview = Extract<PlaybookRunResult, { kind: "document-recovery-preview" | "campaign-recovery-preview" }>;
type RecoveryResult = Extract<PlaybookRunResult, { kind: "document-recovery" | "campaign-recovery" }>;
type RecoveryCandidate = RecoveryPreview["ready"][number];
type RecoveryReview = { preview: RecoveryPreview; selected: string[]; operationId?: string; error?: string };
type RecoverySource = "document" | "campaign";
const recoveryLabels = {
  document: { title: "Review failed mock reminders", items: "reminders", action: "mock reminders", open: "Open document request",
    region: "Review document reminder recovery", description: "Choose the reminders to retry. Orbit checks the current request and deadline again when you confirm." },
  campaign: { title: "Review campaign follow-ups", items: "follow-ups", action: "campaign follow-ups", open: "Open campaign lead",
    region: "Review campaign follow-up recovery", description: "Choose the follow-ups to restore at their original deadlines. Orbit checks the current call, owner, and outreach preferences when you confirm." },
};
const runLabels = {
  funding: { title: "Post-funding follow-up", open: "Open funding record" },
  campaign: { title: "Campaign follow-up", open: "Open campaign lead" },
  document: { title: "Document reminder", open: "Open document request" },
};

function RunAttempts({ id, source, brokerageId, version }: { id: string; source: PlaybookRun["source"]; brokerageId: string; version: number }) {
  const [before, setBefore] = useState<number>();
  const [data, setData] = useState<AttemptPage | { error: string }>();
  useEffect(() => {
    let active = true;
    const failure = { error: "Could not load attempts. Refresh runs to try again." };
    void accessPlaybookRuns({ type: "attempts", id, source, before }, brokerageId).then((result) => {
      if (active) setData("error" in result || result.kind === "attempts" ? result : failure);
    }, () => { if (active) setData(failure); });
    return () => { active = false; };
  }, [before, brokerageId, id, source, version]);
  if (!data) return <p className="muted" role="status">Loading attempts…</p>;
  if ("error" in data) return <p role="alert">{data.error}</p>;
  return <div className="document-section" aria-label="Attempt history">
    <ul className="document-list">{data.attempts.map((attempt) => <li className="document-item" key={attempt.attempt}>
      <strong>{attempt.mode} {attempt.attempt} · {attempt.status}</strong>
      <p>{attempt.reason}</p><p className="muted">{attempt.actor} · {dateTime(attempt.at)} ET</p>
    </li>)}</ul>
    <div className="loan-application-actions">
      {before && <Button size="sm" variant="ghost" onClick={() => setBefore(undefined)}>Latest attempts</Button>}
      {data.before && <Button size="sm" variant="outline" onClick={() => setBefore(data.before ?? undefined)}>Older attempts</Button>}
    </div>
  </div>;
}

function DocumentReminderSchedule({ brokerageId, busy }: { brokerageId: string; busy: boolean }) {
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<{ version: number; data: DocumentSchedule | { error: string } }>();
  const [changing, setChanging] = useState(false);
  const [saveError, setSaveError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    const failure = { error: "Could not load the reminder schedule. Refresh it to try again." };
    void accessPlaybookRuns({ type: "documentSchedule" }, brokerageId).then((data) => {
      if (active) setSnapshot({ version, data: "error" in data || data.kind === "document-schedule" ? data : failure });
    }, () => { if (active) setSnapshot({ version, data: failure }); });
    return () => { active = false; };
  }, [brokerageId, version]);
  const data = snapshot?.data;
  const schedule = data && !("error" in data) ? data : undefined;
  const loadError = data && "error" in data ? data.error : "";
  const loading = snapshot?.version !== version;
  const working = busy || loading || changing;

  async function toggleSchedule() {
    if (!schedule?.available || working || pending.current) return;
    pending.current = true;
    setChanging(true);
    setSaveError("");
    try {
      const data = await accessPlaybookRuns({ type: "setDocumentSchedule", enabled: !schedule.enabled, revision: schedule.revision }, brokerageId);
      if ("error" in data) {
        setSaveError(data.error);
        setVersion((current) => current + 1);
      } else if (data.kind === "document-schedule") setSnapshot({ version, data });
      else throw new Error("Unexpected reminder schedule response");
    } catch {
      setSaveError("Could not confirm the schedule change. Orbit is checking the current setting.");
      setVersion((current) => current + 1);
    } finally {
      pending.current = false;
      setChanging(false);
    }
  }

  if (schedule && !schedule.available) return null;
  if (!schedule && !loadError) return null;
  const nextCheck = schedule?.enabled ? (schedule.nextAt ? `${dateTime(schedule.nextAt)} ET` : "Awaiting schedule") : "Paused";
  return <section className="document-item" aria-label="Scheduled mock reminders">
    <div className="section-heading"><strong>Scheduled mock reminders</strong>
      {schedule && <span className="pill" role="status">{schedule.enabled ? "Enabled" : "Paused"}</span>}
    </div>
    {schedule && <>
      <p className="muted">When enabled, Orbit checks eligible requests shortly and then daily at midnight Eastern. It catches up in batches and records mock deliveries. Manual checks and recovery remain available.</p>
      <p className="muted">Next check · {nextCheck}</p>
      <p className="muted">Last check · {schedule.lastCheckedAt ? `${dateTime(schedule.lastCheckedAt)} ET` : "None yet"}
        {schedule.lastProcessed !== null && ` · ${schedule.lastProcessed} processed`}
      </p>
    </>}
    {saveError && <p role="alert">{saveError}</p>}
    {loadError && <p role="alert">{loadError}</p>}
    <div className="loan-application-actions">
      {schedule && <Button size="sm" disabled={working} onClick={() => void toggleSchedule()}>
        {changing ? "Saving schedule…" : schedule.enabled ? "Pause scheduled reminders" : "Enable scheduled reminders"}
      </Button>}
      <Button size="sm" variant="outline" disabled={working} onClick={() => { setSaveError(""); setVersion((current) => current + 1); }}>
        <RefreshCw /> {loading ? "Refreshing schedule…" : "Refresh schedule"}
      </Button>
    </div>
  </section>;
}

function candidateTitle(item: RecoveryCandidate) {
  return `${item.borrower} · ${"leadId" in item ? item.campaignName : item.documentKind}`;
}

function candidateDetails(item: RecoveryCandidate) {
  if ("leadId" in item) return `${item.delayDays === null ? "Requested callback" : item.outcome} · ${item.status} · ${item.owner ?? "Unassigned"} · Due ${dateTime(item.dueAt)} ET`;
  return `Borrower due ${dateLabel(item.dueOn)} · Reminder eligible ${dateLabel(item.eligibleOn)}`;
}

function RecoveryReviewPanel({ review, busy, recovering, select, cancel, recover, open }: {
  review: RecoveryReview; busy: boolean; recovering: boolean; select: (ids: string[]) => void; cancel: () => void; recover: () => void;
  open: (item: RecoveryCandidate) => void;
}) {
  const { preview, selected, operationId, error } = review;
  const labels = recoveryLabels[preview.kind === "document-recovery-preview" ? "document" : "campaign"];
  const selectionLocked = busy || Boolean(operationId);
  const allSelected = selected.length === preview.ready.length;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [preview]);
  return <section className="document-section" aria-label={labels.region}>
    <h3 ref={heading} tabIndex={-1}>{labels.title}</h3>
    <p className="muted">{labels.description}</p>
    {error && <p role="alert">{error}</p>}
    <div className="document-item">
      <div className="section-heading"><strong>Ready to recover</strong><span className="pill">{selected.length} selected</span></div>
      {preview.ready.length ? <>
        <div><Button size="sm" variant="ghost" disabled={selectionLocked} onClick={() => select(allSelected ? [] : preview.ready.map(({ id }) => id))}>
          {allSelected ? "Clear selection" : "Select all ready"}
        </Button></div>
        <ul className="document-list">{preview.ready.map((item) => <li key={item.id}>
          <label className="demo-confirm"><input type="checkbox" checked={selected.includes(item.id)} disabled={selectionLocked}
            onChange={(event) => select(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />
            {candidateTitle(item)} · {candidateDetails(item)}
          </label>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => open(item)}>{labels.open}</Button>
        </li>)}</ul>
      </> : <p className="muted">No {labels.items} are ready to recover.</p>}
      {preview.moreReady && <p className="muted">More ready {labels.items} remain. Review another batch after these items.</p>}
    </div>
    {preview.blocked.length > 0 && <div className="document-item">
      <strong>Blocked {labels.items}</strong>
      <ul className="document-list">{preview.blocked.map((item) => <li key={item.id}>
        <strong>{candidateTitle(item)}</strong>
        <p className="muted">{candidateDetails(item)}</p>
        {item.blockedReason && <p className="muted">{item.blockedReason}</p>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => open(item)}>{labels.open}</Button>
      </li>)}</ul>
      {preview.moreBlocked && <p className="muted">See Automation run history for more blocked {labels.items}.</p>}
    </div>}
    <div className="loan-application-actions">
      <Button size="sm" disabled={busy || !selected.length} onClick={recover}>
        {recovering ? `Recovering ${labels.items}…` : `${operationId ? "Retry" : "Recover"} selected ${labels.action}`}
      </Button>
      <Button size="sm" variant="outline" disabled={selectionLocked} onClick={cancel}>Cancel recovery</Button>
    </div>
  </section>;
}

export type PlaybookRunHistoryHandle = { reviewCampaignRun: (runId: string) => void };

export function PlaybookRunHistory({ ref, brokerageId, busy, canCheckDocuments, openLoan, openLead, openDocument, refreshWorkspace }: {
  ref: Ref<PlaybookRunHistoryHandle>;
  brokerageId: string; busy: boolean; canCheckDocuments: boolean;
  openLoan: (id: string) => void; openLead: (leadId: string, campaignId: string) => void;
  openDocument: (loanId: string, requestId: string) => void;
  refreshWorkspace: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState<ListQuery>({ type: "list", filter: "All runs" });
  const [result, setResult] = useState<{ query: ListQuery; data: ListPage | { error: string } }>();
  const [version, setVersion] = useState(0);
  const [focused, setFocused] = useState<string>();
  const [action, setAction] = useState<"retry" | "document-check" | "recovery-preview" | "recovery-commit">();
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean; focus?: boolean }>();
  const [simulate, setSimulate] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState<{ operationId: string; simulate: boolean }>();
  const [recoveryReview, setRecoveryReview] = useState<RecoveryReview>();
  const [recoveryResult, setRecoveryResult] = useState<{ result: RecoveryResult; candidates: RecoveryCandidate[] }>();
  const recoveryResultHeading = useRef<HTMLHeadingElement>(null);
  const history = useRef<HTMLDetailsElement>(null);
  const feedbackMessage = useRef<HTMLParagraphElement>(null);
  const pending = useRef(false);
  const retryKey = useRef<{ runId: string; source: PlaybookRun["source"]; attempt: number; operationId: string }>(null);
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    const failure = { error: "Could not load automation runs. Refresh runs to try again." };
    void accessPlaybookRuns(query, brokerageId).then((data) => {
      if (active) setResult({ query, data: "error" in data || data.kind === "list" ? data : failure });
    }, () => { if (active) setResult({ query, data: failure }); });
    return () => { active = false; };
  }, [brokerageId, expanded, query, version]);
  useEffect(() => { if (recoveryResult) recoveryResultHeading.current?.focus(); }, [recoveryResult]);
  useEffect(() => { if (feedback?.focus) feedbackMessage.current?.focus(); }, [feedback]);
  useImperativeHandle(ref, () => ({ reviewCampaignRun(runId) {
    if (busy || pending.current || !history.current) return;
    history.current.open = true;
    history.current.querySelector("summary")?.focus();
    if (recoveryReview?.operationId) {
      setRecoveryReview({ ...recoveryReview, error: "Confirm the result of the open recovery before reviewing another follow-up." });
      return;
    }
    void previewRecovery("campaign", runId);
  } }));
  const data = result?.query === query ? result.data : undefined;
  const page = data && !("error" in data) ? data : undefined;
  const working = Boolean(action);

  async function retry(run: PlaybookRun) {
    if (pending.current) return;
    pending.current = true;
    setAction("retry");
    setFeedback(undefined);
    if (retryKey.current?.runId !== run.id || retryKey.current.source !== run.source || retryKey.current.attempt !== run.attemptCount) {
      retryKey.current = { runId: run.id, source: run.source, attempt: run.attemptCount, operationId: crypto.randomUUID() };
    }
    try {
      const response = await accessPlaybookRuns({ type: "retry", id: run.id, source: run.source, attempt: run.attemptCount, operationId: retryKey.current.operationId }, brokerageId);
      if ("error" in response) setFeedback({ text: response.error, error: true });
      else if (response.kind === "retry") {
        setFeedback({ text: response.message, error: response.status === "Failed" });
        retryKey.current = null;
        setFocused(run.id);
        if (run.source === "campaign" && (response.status === "Completed" || response.status === "Superseded")) void refreshWorkspace();
      }
    } catch { setFeedback({ text: "Could not confirm this retry. Refresh the run or try again.", error: true }); }
    finally { pending.current = false; setAction(undefined); setVersion((value) => value + 1); }
  }

  async function checkDocuments() {
    if (pending.current || !canCheckDocuments) return;
    pending.current = true;
    const attempt = checkAttempt ?? { operationId: crypto.randomUUID(), simulate };
    setCheckAttempt(attempt);
    setAction("document-check");
    setFeedback(undefined);
    try {
      const response = await accessPlaybookRuns({ type: "checkDocuments", ...attempt }, brokerageId);
      if ("error" in response) {
        setCheckAttempt(undefined);
        setFeedback({ text: response.error, error: true });
      } else if (response.kind === "document-check") {
        setCheckAttempt(undefined);
        setSimulate(false);
        setFocused(undefined);
        setQuery({ type: "list", filter: "All runs", automation: "Document reminders" });
        setFeedback({ text: response.message });
      } else {
        throw new Error("Unexpected reminder check response");
      }
    } catch {
      setFeedback({ text: "Could not confirm this check. Retry the same reminder check to continue.", error: true });
    } finally {
      pending.current = false;
      setAction(undefined);
      setVersion((value) => value + 1);
    }
  }

  async function previewRecovery(source: RecoverySource, runId?: string) {
    if (pending.current || (source === "document" && !canCheckDocuments)) return;
    pending.current = true;
    setAction("recovery-preview");
    setFeedback(undefined);
    if (runId) {
      setRecoveryReview(undefined);
      setRecoveryResult(undefined);
    }
    try {
      const response = await accessPlaybookRuns(source === "document" ? { type: "previewDocumentRecovery" } : { type: "previewCampaignRecovery", runId }, brokerageId);
      if ("error" in response) {
        setFeedback({ text: response.error, error: true, focus: Boolean(runId) });
        if (runId) void refreshWorkspace();
      }
      else if (response.kind === "document-recovery-preview" || response.kind === "campaign-recovery-preview") {
        setRecoveryReview({ preview: response, selected: runId && response.ready.some(({ id }) => id === runId) ? [runId] : [] });
        setRecoveryResult(undefined);
      } else throw new Error("Unexpected recovery preview");
    } catch {
      setFeedback({ text: `Could not load ${recoveryLabels[source].action}. Try the review again.`, error: true, focus: Boolean(runId) });
    } finally {
      pending.current = false;
      setAction(undefined);
    }
  }

  async function recoverSelected() {
    if (pending.current || !recoveryReview?.selected.length) return;
    const { preview, selected } = recoveryReview;
    if (preview.kind === "document-recovery-preview" && !canCheckDocuments) return;
    pending.current = true;
    const candidates = preview.ready.filter(({ id }) => selected.includes(id));
    const operationId = recoveryReview.operationId ?? crypto.randomUUID();
    setRecoveryReview({ preview, selected, operationId });
    setAction("recovery-commit");
    setFeedback(undefined);
    try {
      const input: PlaybookRunQuery = preview.kind === "document-recovery-preview" ? { type: "recoverDocuments", operationId,
        items: candidates.map(({ id, attempt }) => ({ id, attempt })) } : { type: "recoverCampaignFollowUps", operationId,
        items: preview.ready.flatMap(({ id, attempt, leadRevision, ownerEmail }) => selected.includes(id) && ownerEmail ? [{ id, attempt, leadRevision, ownerEmail }] : []) };
      const response = await accessPlaybookRuns(input, brokerageId);
      if ("error" in response) setRecoveryReview({ preview, selected, error: response.error });
      else if (response.kind === "document-recovery" || response.kind === "campaign-recovery") {
        setRecoveryReview(undefined);
        setRecoveryResult({ result: response, candidates });
        setFocused(undefined);
        setQuery({ type: "list", filter: "All runs", automation: response.kind === "document-recovery" ? "Document reminders" : "Campaign follow-up" });
        setVersion((value) => value + 1);
        if (response.kind === "campaign-recovery") void refreshWorkspace();
      } else throw new Error("Unexpected recovery result");
    } catch {
      setRecoveryReview({ preview, selected, operationId, error: "Could not confirm recovery. Retry the same selection to see the result." });
    } finally {
      pending.current = false;
      setAction(undefined);
    }
  }

  function openRun(run: PlaybookRun) {
    if (run.source === "document") openDocument(run.loanId, run.requestId);
    else if (run.source === "campaign") openLead(run.leadId, run.campaignId);
    else openLoan(run.loanId);
  }

  function openCandidate(item: RecoveryCandidate) {
    if ("leadId" in item) openLead(item.leadId, item.campaignId);
    else openDocument(item.loanId, item.requestId);
  }

  return <details ref={history} className="integration record-form manager-panel" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Automation run history</summary>
    {expanded && <section aria-label="Automation runs" className="record-form">
      <div className="section-heading"><h2>Automation runs</h2>
        <Button size="sm" variant="outline" disabled={working} onClick={() => setVersion((value) => value + 1)}><RefreshCw /> Refresh runs</Button></div>
      <p className="muted">Review post-funding follow-ups, campaign callbacks, and mock document reminders. Each run records its original deadline and attempts.</p>
      <section className="document-item" aria-label="Campaign follow-up recovery">
        <strong>Campaign follow-up recovery</strong>
        <p className="muted">Restore interrupted callbacks and release held retries once automatic retries resume.</p>
        <div><Button size="sm" variant="outline" disabled={busy || working || Boolean(recoveryReview)} onClick={() => void previewRecovery("campaign")}>
          Review campaign follow-ups
        </Button></div>
      </section>
      {canCheckDocuments && <section className="document-item" aria-label="Mock document reminders">
        <strong>Mock document reminders</strong>
        <p className="muted">Run a manual check for the next batch of eligible document reminders. Orbit records simulated delivery in this history.</p>
        <label className="demo-confirm"><input type="checkbox" checked={simulate} disabled={busy || working || Boolean(checkAttempt)}
          onChange={(event) => setSimulate(event.target.checked)} /> Simulate an interruption for the first due reminder</label>
        <div className="loan-application-actions">
          <Button size="sm" disabled={busy || working} onClick={() => void checkDocuments()}>
            {action === "document-check" ? "Checking due reminders…" : checkAttempt ? "Retry reminder check" : "Run due mock reminders"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy || working || Boolean(recoveryReview)} onClick={() => void previewRecovery("document")}>
            Review failed reminders
          </Button>
        </div>
        <DocumentReminderSchedule brokerageId={brokerageId} busy={busy || working} />
      </section>}
      {action === "recovery-preview" && <p className="muted" role="status">Loading recovery preview…</p>}
      {recoveryReview && <RecoveryReviewPanel review={recoveryReview} busy={busy || working} recovering={action === "recovery-commit"}
        select={(selected) => setRecoveryReview({ ...recoveryReview, selected })} cancel={() => setRecoveryReview(undefined)}
        recover={() => void recoverSelected()} open={openCandidate} />}
      {recoveryResult && <section className="document-section" aria-label={recoveryResult.result.kind === "document-recovery" ? "Document reminder recovery results" : "Campaign follow-up recovery results"}>
        <h3 ref={recoveryResultHeading} tabIndex={-1}>Recovery results</h3>
        <p role="status">{recoveryResult.result.recovered} recovered · {recoveryResult.result.skipped} skipped
          {recoveryResult.result.kind === "campaign-recovery" && ` · ${recoveryResult.result.failed} failed`}</p>
        <ul className="document-list">{recoveryResult.result.rows.map((row) => {
          const item = recoveryResult.candidates.find(({ id }) => id === row.id);
          return <li className="document-item" key={row.id}>
            <strong>{item ? candidateTitle(item) : "Follow-up"} · {row.status}</strong>
            {item && "leadId" in item && <p className="muted">Reviewed owner {item.owner} · Original due {dateTime(item.dueAt)} ET</p>}
            <p>{row.reason}</p>
          </li>;
        })}</ul>
        <div><Button size="sm" variant="ghost" onClick={() => setRecoveryResult(undefined)}>Dismiss recovery results</Button></div>
      </section>}
      <div className="calendar-filters">
        <label className="field">Automation<select value={query.automation ?? "All automations"} disabled={working} onChange={(event) => {
          setFocused(undefined); setFeedback(undefined); setQuery({ ...query, automation: event.target.value as ListQuery["automation"], after: undefined });
        }}>{playbookRunSources.map((source) => <option key={source}>{source}</option>)}</select></label>
        <label className="field">Run status<select value={query.filter} disabled={working} onChange={(event) => {
          setFocused(undefined); setFeedback(undefined); setQuery({ ...query, filter: event.target.value as ListQuery["filter"], after: undefined });
        }}>{playbookRunFilters.map((filter) => <option key={filter}>{filter}</option>)}</select></label>
      </div>
      {feedback && <p ref={feedbackMessage} tabIndex={feedback.focus ? -1 : undefined} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      {!data && <p className="muted" role="status">Loading automation runs…</p>}
      {data && "error" in data && <p role="alert">{data.error}</p>}
      {page && <>
        {page.runs.length ? <ul className="document-list">{page.runs.map((run) => <li className="document-item" key={run.id}>
          <div className="section-heading"><strong>{run.borrower} · {runLabels[run.source].title}</strong><span className="pill">{run.status}</span></div>
          <p>{run.reason}</p>
          {run.source === "funding" ? <>
            <p className="muted">Funding recorded for {dateLabel(run.fundingDate)} · {dateTime(run.at)} ET</p>
            <p className="muted">Funding revision {run.fundingRevision} · Playbook revision {run.ruleRevision} · {run.delayDays} {run.delayDays === 1 ? "day" : "days"} after funding · Due {dateTime(run.dueAt)} ET</p>
          </> : run.source === "campaign" ? <>
            <p className="muted">{run.campaignName} · Call {run.callNumber} · {run.outcome} · {dateTime(run.at)} ET</p>
            <p className="muted">Rule revision {run.ruleRevision} · {run.delayDays === null ? "Borrower-requested time" : `${run.delayDays} ${run.delayDays === 1 ? "weekday" : "weekdays"}`} · Due {dateTime(run.dueAt)} ET</p>
          </> : <>
            <p className="muted">{run.documentKind} · Borrower due {dateLabel(run.dueOn)} · Reminder eligible {dateLabel(run.eligibleOn)}</p>
            <p className="muted">{documentReminderTimingLabel(run.timingOffsetDays)} · Recorded {dateTime(run.at)} ET</p>
            <p className="muted">Document revision {run.documentRevision} · Deadline revision {run.deadlineRevision}</p>
            {run.receipt && <p className="muted">Mock receipt · {run.receipt}</p>}
          </>}
          {run.source !== "funding" && run.blockedReason && <p className="muted">{run.blockedReason}</p>}
          <div className="loan-application-actions">
            <Button size="sm" variant="outline" disabled={busy || working} onClick={() => openRun(run)}>
              {runLabels[run.source].open}
            </Button>
            <Button size="sm" variant="ghost" aria-expanded={focused === run.id} onClick={() => setFocused(focused === run.id ? undefined : run.id)}>
              {focused === run.id ? "Hide attempts" : `View attempts (${run.attemptCount})`}
            </Button>
            {run.canRetry && <Button size="sm" disabled={working || busy} onClick={() => void retry(run)}>
              {run.source === "document" ? "Retry mock reminder" : run.status === "Paused" ? "Release follow-up" : "Retry follow-up"}
            </Button>}
          </div>
          {focused === run.id && <RunAttempts id={run.id} source={run.source} brokerageId={brokerageId} version={version} />}
        </li>)}</ul> : <p className="empty-inline">No automation runs match this view. Follow-up and reminder attempts will appear here when they run.</p>}
        <div className="loan-application-actions">
          {query.after && <Button size="sm" variant="outline" disabled={working} onClick={() => setQuery({ ...query, after: undefined })}>First page</Button>}
          {page.next && <Button size="sm" variant="outline" disabled={working} onClick={() => setQuery({ ...query, after: page.next ?? undefined })}>Next page</Button>}
        </div>
      </>}
    </section>}
  </details>;
}

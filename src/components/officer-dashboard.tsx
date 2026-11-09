"use client";

import { useEffect, useState } from "react";
import { requestOfficerDashboard } from "@/app/actions";
import { dateLabel, easternDate } from "@/lib/client-retention";
import { fundingTargetLimits } from "@/lib/funding-dashboard-model";
import { stalledLoanDays } from "@/lib/loan-workflow";
import { stalledLoanStages, type OfficerDashboardRequest, type OfficerDashboardResult, type RetentionOpportunity, type StalledLoanQuery } from "@/lib/officer-dashboard-model";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthLabel = (month: string) => monthFormat.format(new Date(`${month}-01T12:00:00Z`));
const volumeLabel = (amount: number) => amount ? money(amount) : "$0";
type DashboardProps = { brokerageId: string; version: object; busy: boolean };

function useOfficerDashboard(brokerageId: string, version: object, query?: OfficerDashboardRequest) {
  const [data, setData] = useState<{ brokerageId: string; version: object; query: OfficerDashboardRequest; result: OfficerDashboardResult }>();
  useEffect(() => {
    if (!query) return;
    let active = true;
    const update = (result: OfficerDashboardResult) => { if (active) setData({ brokerageId, version, query, result }); };
    void requestOfficerDashboard(query, brokerageId).then(update, () => update({ error: "Could not load this view. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, query, version]);
  return data?.brokerageId === brokerageId && data.version === version && data.query === query ? data.result : undefined;
}

export function OfficerProduction({ brokerageId, version, busy, openLoan }: DashboardProps & { openLoan: (loanId: string) => void }) {
  const [query, setQuery] = useState<OfficerDashboardRequest>({ type: "production" });
  const [drilldown, setDrilldown] = useState<Extract<OfficerDashboardRequest, { type: "fundedLoans" }>>();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ error: string } | { message: string }>();
  const result = useOfficerDashboard(brokerageId, version, query);
  const loans = useOfficerDashboard(brokerageId, version, drilldown);
  const production = result && "kind" in result && result.kind === "production" ? result : undefined;
  const refresh = () => { setQuery({ type: "production" }); setStatus(undefined); setDrilldown((current) => current && { ...current, after: undefined }); };

  return <section className="integration record-form manager-panel" aria-label="My production">
    <div className="section-heading"><h2>My production</h2>{production && <span className="pill">Checked {dateTime(production.checkedAt)} ET</span>}</div>
    <p className="muted">Funded loans and principal on files assigned to you, grouped by their recorded funding date.</p>
    <div><Button size="sm" variant="outline" disabled={saving || busy} onClick={refresh}>Refresh production</Button></div>
    {!result && <p className="muted" role="status">Loading personal production…</p>}
    {result && "error" in result && <p role="alert">{result.error}</p>}
    {production && <>
      <div className="form-grid officer-production-periods">{[production.current, production.previous].map((period) => {
        const target = period.month === production.current.month ? production.target : null;
        return <section className="document-item" key={period.month} aria-label={monthLabel(period.month)}>
          <h3>{monthLabel(period.month)}</h3>
          <p><strong>{period.count}{target && ` of ${target.count}`}</strong> funded {period.count === 1 && !target ? "loan" : "loans"}</p>
          <p><strong>{volumeLabel(period.volume)}{target && ` of ${volumeLabel(target.volume)}`}</strong> funded principal</p>
          <Button size="sm" variant="outline" disabled={busy} aria-pressed={drilldown?.month === period.month} onClick={() => setDrilldown(
            drilldown?.month === period.month ? undefined : { type: "fundedLoans", month: period.month },
          )}>View funded loans for {monthLabel(period.month)}</Button>
        </section>;
      })}</div>
      <details className="document-form"><summary>{production.target ? "Edit personal targets" : "Set personal targets"}</summary>
        <form className="record-form" key={production.target?.revision ?? 0} onSubmit={async (event) => {
          event.preventDefault();
          if (saving) return;
          const fields = new FormData(event.currentTarget);
          setSaving(true);
          setStatus(undefined);
          try {
            const saved = await requestOfficerDashboard({ type: "saveTarget", month: production.current.month, revision: production.target?.revision ?? 0,
              count: Number(fields.get("count")), volume: Number(fields.get("volume")) }, brokerageId);
            if ("error" in saved) setStatus(saved);
            else if (saved.kind === "saved") { setQuery({ type: "production" }); setStatus({ message: saved.message }); }
          } catch { setStatus({ error: "Could not save your targets. Try again." }); }
          finally { setSaving(false); }
        }}>
          <p className="muted">Targets apply to your current Eastern calendar month.</p>
          <div className="form-grid officer-production-periods">
            <label className="field">Funded loan count target<input name="count" type="number" min={1} max={fundingTargetLimits.count} required defaultValue={production.target?.count} /></label>
            <label className="field">Funded principal target ($)<input name="volume" type="number" min={1} max={fundingTargetLimits.volume} required defaultValue={production.target?.volume} /></label>
          </div>
          <div><Button size="sm" type="submit" disabled={saving || busy}>Save personal targets</Button></div>
        </form>
      </details>
    </>}
    {status && ("error" in status ? <p role="alert">{status.error}</p> : <p role="status">{status.message}</p>)}
    {drilldown && <section className="record-form" aria-label={`Funded loans for ${monthLabel(drilldown.month)}`}>
      <h3>Funded loans for {monthLabel(drilldown.month)}</h3>
      {!loans && <p className="muted" role="status">Loading funded loans…</p>}
      {loans && "error" in loans && <p role="alert">{loans.error}</p>}
      {loans && "kind" in loans && loans.kind === "fundedLoans" && <>
        {loans.loans.length ? <ul className="loan-task-list">{loans.loans.map((loan) => <li className="loan-task" key={loan.id}>
          <div className="loan-task-copy"><strong>{loan.name}</strong><span>{volumeLabel(loan.amount)} · Funded {dateLabel(loan.date)}</span></div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => openLoan(loan.id)}>Open funding</Button>
        </li>)}</ul> : <p className="empty-inline">No funded loans recorded in this month for you.</p>}
        <div className="loan-application-actions">
          {drilldown.after && <Button size="sm" variant="outline" onClick={() => setDrilldown({ ...drilldown, after: undefined })}>First funded loans page</Button>}
          {loans.next && <Button size="sm" variant="outline" onClick={() => setDrilldown({ ...drilldown, after: loans.next ?? undefined })}>Next funded loans page</Button>}
        </div>
      </>}
    </section>}
  </section>;
}

export function OfficerOpportunities({ brokerageId, version, busy, openTask, openPastClients }: DashboardProps & {
  openTask: (item: RetentionOpportunity) => void; openPastClients: () => void;
}) {
  const [query, setQuery] = useState<Extract<OfficerDashboardRequest, { type: "opportunities" }>>({ type: "opportunities" });
  const result = useOfficerDashboard(brokerageId, version, query);
  const page = result && "kind" in result && result.kind === "opportunities" ? result : undefined;
  return <section className="integration record-form manager-panel" aria-label="Past-client opportunities">
    <div className="section-heading"><h2>Past-client opportunities</h2>{page && <span className="pill">Checked {dateTime(page.checkedAt)} ET</span>}</div>
    <p className="muted">Open follow-ups for recorded rate targets and closing anniversaries due within 30 days or overdue.</p>
    <div className="loan-application-actions">
      <Button size="sm" variant="outline" onClick={() => setQuery({ type: "opportunities" })}>Refresh opportunities</Button>
      <Button size="sm" variant="ghost" onClick={openPastClients}>Open Past Clients</Button>
    </div>
    {!result && <p className="muted" role="status">Loading past-client opportunities…</p>}
    {result && "error" in result && <p role="alert">{result.error}</p>}
    {page && <>
      {page.items.length ? <ul className="loan-task-list">{page.items.map((item) => <li className="loan-task" key={item.id}>
        <div className="loan-task-copy"><strong>{item.name} · {item.kind}</strong>
          {item.kind === "Rate target met" ? <><span>{item.context}</span>{item.checkedAt && <span>Observation recorded {dateTime(item.checkedAt)} ET</span>}</> :
            <span>Originally closed {dateLabel(item.closingDate)} · Follow-up due {dateLabel(easternDate(new Date(item.dueAt)))}</span>}
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => openTask(item)}>Open follow-up</Button>
      </li>)}</ul> : <p className="empty-inline">{page.next ? "No eligible opportunities on this page. Check the next page for more." :
        query.after ? "No more open opportunities." : "No open rate-watch or anniversary follow-ups. Open Past Clients to manage your watchlist and closing dates."}</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={() => setQuery({ type: "opportunities" })}>First opportunities page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setQuery({ type: "opportunities", after: page.next ?? undefined })}>Next opportunities page</Button>}
      </div>
    </>}
  </section>;
}

export function StalledLoans({ brokerageId, version, busy, team = false, openLoan, onRefresh }: DashboardProps & {
  team?: boolean; openLoan: (id: string) => void; onRefresh: () => void;
}) {
  const [query, setQuery] = useState<StalledLoanQuery>(team ? { type: "brokerageStalledLoans", owner: "" } : { type: "stalledLoans" });
  const result = useOfficerDashboard(brokerageId, version, query);
  const page = result && "kind" in result && (result.kind === "stalledLoans" || result.kind === "brokerageStalledLoans") ? result : undefined;
  const teamPage = page?.kind === "brokerageStalledLoans" ? page : undefined;
  const owner = query.type === "brokerageStalledLoans" ? query.owner : "";
  const title = team ? "Pipeline workload" : "My stalled loans";
  const firstPage = () => setQuery((current) => ({ ...current, after: undefined }));
  return <section className="integration record-form manager-panel" aria-label={title}>
    <div className="section-heading"><h2>{title}</h2>{page && <span className="pill">Checked {dateTime(page.checkedAt)} ET</span>}</div>
    <p className="muted">{team ? `Review active and stalled files by loan owner and stage. A file counts as stalled after ${stalledLoanDays} days in the same stage.` :
      `Your active loans in the same stage for at least ${stalledLoanDays} days.`} Oldest stage entries appear first.</p>
    <div className="calendar-filters">
      {team && <label className="field workload-owner">Loan owner<select value={owner} onChange={(event) => setQuery({
        type: "brokerageStalledLoans", owner: event.target.value, stage: query.stage,
      })}>
        <option value="">All owners</option>
        <option value="unassigned">Unassigned{teamPage && ` · ${teamPage.owners.find(({ email }) => email === "unassigned")?.stalled ?? 0} stalled`}</option>
        {owner && owner !== "unassigned" && !teamPage?.owners.some(({ email }) => email === owner) && <option value={owner}>{owner}</option>}
        {teamPage?.owners.filter(({ email }) => email !== "unassigned").map(({ email, name, stalled }) =>
          <option key={email} value={email}>{name}{name !== email ? ` (${email})` : ""} · {stalled} stalled</option>)}
      </select></label>}
      <label className="field">Stalled loan stage<select value={query.stage ?? ""} onChange={(event) => {
        const stage = stalledLoanStages.find((value) => value === event.target.value);
        setQuery((current) => ({ ...current, stage, after: undefined }));
      }}>
        <option value="">All active stages</option>
        {stalledLoanStages.map((stage) => <option key={stage}>{stage}</option>)}
      </select></label>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { onRefresh(); firstPage(); }}>Refresh stalled loans</Button>
    </div>
    {team && <div className="campaign-metrics" role="group" aria-label="Workload by stage" aria-busy={!result}>{stalledLoanStages.map((stage) => {
      const totals = teamPage?.stages.find((entry) => entry.stage === stage);
      return <button key={stage} type="button" aria-pressed={query.stage === stage} onClick={() => setQuery((current) => ({
        ...current, stage: current.stage === stage ? undefined : stage, after: undefined,
      }))}><span>{stage}</span><strong>{totals?.stalled ?? "—"}</strong><span>Stalled · {totals?.active ?? "—"} active</span></button>;
    })}</div>}
    {!result && <p className="muted" role="status">Loading stalled loans…</p>}
    {result && "error" in result && <p role="alert">{result.error}</p>}
    {page && <>
      {page.items.length ? <ul className="loan-task-list">{page.items.map((item) => <li className="loan-task" key={item.id}>
        <div className="loan-task-copy"><strong>{item.name}</strong><span>{item.stage} · {item.days} days in stage</span>
          {item.owner && <span>Owner · {item.owner}</span>}
          <span>Next action · {item.action}</span>
          {item.blocker && <span>Blocker · {item.blocker}</span>}
          {item.dueAt && <span>Due · {dateTime(item.dueAt)} ET</span>}
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => openLoan(item.id)}>Open next action</Button>
      </li>)}</ul> : <p className="empty-inline">{query.after ? "No more stalled loans in this view." :
        team ? "No stalled loans match the selected filters." : query.stage ? `You have no stalled loans in ${query.stage}.` : "You have no stalled loans."}</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={firstPage}>First stalled loans page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: page.next ?? undefined })}>Next stalled loans page</Button>}
      </div>
    </>}
  </section>;
}

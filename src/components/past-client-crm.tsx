"use client";

import { useEffect, useState } from "react";
import { readPastClientWork } from "@/app/actions";
import { dateLabel, easternDate, nextAnniversary, pastClientLoan, rateTargetReached } from "@/lib/client-retention";
import type { Loan, PastClientProfile } from "@/lib/model";
import { pastClientsUnavailable, pastClientViews, type PastClientPage, type PastClientQuery } from "@/lib/past-client-queue-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const rate = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;

export function PastClients({ brokerageId, version, busy, openLoan, editRetention, openContact, openRepeat }: {
  brokerageId: string; version: object; busy: boolean;
  openLoan: (loanId: string) => void; editRetention?: (loanId: string) => void; openContact: (contactId: string) => void;
  openRepeat?: (fundedLoanId: string) => void;
}) {
  const [view, setView] = useState<PastClientQuery["view"]>("All clients");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<{ brokerageId: string; view: typeof view; query: string; version: object; retry: number;
    page?: PastClientPage; error?: string }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const search = query.trim();
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void readPastClientWork({ view, query: search }, brokerageId).catch(() => ({ error: pastClientsUnavailable })).then((result) => {
        if (active) setData({ brokerageId, view, query: search, version, retry, ...("error" in result ? { error: result.error } : { page: result }) });
      });
    }, search ? 180 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [brokerageId, view, search, version, retry]);
  const current = data?.brokerageId === brokerageId && data.view === view && data.query === search && data.version === version && data.retry === retry ? data : undefined;
  const page = current?.page;
  const totals = page?.totals;

  async function loadMore() {
    if (!current || !page?.next || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await readPastClientWork({ view, query: search, after: page.next }, brokerageId).catch(() => ({ error: pastClientsUnavailable }));
      setData((previous) => {
        if (previous !== current) return previous;
        if ("error" in result) return { ...current, error: result.error };
        const rows = new Map(page.rows.map((row) => [row.id, row]));
        for (const row of result.rows) rows.set(row.id, row);
        return { ...current, page: { ...page, rows: [...rows.values()], next: result.next }, error: undefined };
      });
    } finally {
      setLoadingMore(false);
    }
  }

  return <section className="pipeline" aria-label="Past-client list">
    <div className="pipeline-heading"><div><h2>Past-client loans {totals && <span>{totals.clients}</span>}</h2>
      {totals && <p>{totals.withDate} with closing dates · {totals.watched} on the rate watchlist · {totals.reached} at target</p>}</div></div>
    <div className="toolbar">
      <label className="search"><input aria-label="Search past clients" placeholder="Search past clients…" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="view-toggle" aria-label="Past-client view">{pastClientViews.map((option) => <button type="button" key={option} aria-pressed={view === option} onClick={() => setView(option)}>{option}</button>)}</div>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setRetry((value) => value + 1)}>Refresh</Button>
    </div>
    {view === "Rate watchlist" && <p className="relationship-inset muted">Compare the rates you enter with each client’s target. A target met creates a follow-up task.</p>}
    {view === "Anniversaries" && <p className="relationship-inset muted">Orbit adds an annual task to the assigned officer’s queue using the recorded closing date.</p>}
    {!current && <p className="empty-inline" role="status">Loading past clients…</p>}
    {current?.error && <p className="empty-inline" role="alert">{current.error}</p>}
    {page && (page.rows.length ? <div className="table-scroll"><table className="data-table">
      <thead><tr><th>Borrower</th><th>Loan officer</th>
        {view === "Rate watchlist" ? <><th>Current rate</th><th>Target</th><th>Observed rate</th><th>Status</th></>
          : <><th>Closing date</th><th>Next anniversary</th><th>Rate watch</th></>}
        <th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{page.rows.map(({ id, stage, address, officer, contactId, borrower, profile, anniversary, reached, repeat }) => <tr key={id}>
        <td><button className="name-link" disabled={busy} onClick={() => openLoan(id)}>{borrower ?? "Borrower"}</button><small>{address || stage}</small>
          {contactId && <small><button className="name-link" disabled={busy} onClick={() => openContact(contactId)}>Contact history</button></small>}</td>
        <td>{officer || "Unassigned"}</td>
        {view === "Rate watchlist" ? <>
          <td>{rate(profile?.currentRate)}</td><td>{rate(profile?.targetRate)}</td>
          <td>{rate(profile?.observedRate)}{profile?.checkedAt && <small>{dateTime(profile.checkedAt)} ET</small>}</td>
          <td><span className={reached ? "open-chip" : "pill"}>{reached ? "Review follow-up" : profile?.observedRate != null ? "Watching" : "Awaiting rate"}</span>
            {reached && <small>{rate(profile?.observedRate)} observed at or below the {rate(profile?.targetRate)} target</small>}</td>
        </> : <>
          <td>{profile?.closingDate ? dateLabel(profile.closingDate) : "Add closing date"}</td>
          <td>{anniversary ? dateLabel(anniversary) : "—"}</td>
          <td>{profile?.watchEnabled ? reached ? "Target met" : `Target ${rate(profile.targetRate)}` : "—"}</td>
        </>}
        <td><div className="loan-application-actions">
          {editRetention && <Button variant="outline" size="sm" disabled={busy} aria-label={`Edit follow-up for ${borrower ?? "borrower"}`} onClick={() => editRetention(id)}>Edit follow-up</Button>}
          {openRepeat && (repeat === "start" || repeat === "open") &&
            <Button variant="outline" size="sm" disabled={busy} onClick={() => openRepeat(id)}>{repeat === "open" ? "Open repeat 1003" : "Start repeat 1003"}</Button>}
          {repeat === "restricted" && <small>Ask an admin for access to the repeat 1003.</small>}
          {repeat === "campaign" && <small>Campaign lead in progress</small>}
        </div></td>
      </tr>)}</tbody>
    </table></div> : <p className="empty-inline no-matches">{search ? "No past clients match your search." :
      view === "Anniversaries" ? "Enter a closing date to start anniversary reminders." :
        view === "Rate watchlist" ? "No past-client loans are on the rate watchlist." : "Funded and closed loans appear here."}</p>)}
    {page?.next && <div className="filter-row"><Button variant="outline" size="sm" disabled={busy || loadingMore} onClick={() => void loadMore()}>
      {loadingMore ? "Loading past clients…" : "Load more past clients"}
    </Button></div>}
  </section>;
}

export function RetentionFields({ profile }: { profile?: PastClientProfile }) {
  const [watchEnabled, setWatchEnabled] = useState(profile?.watchEnabled ?? false);
  return <>
    <label className="field"><span>Closing date</span>
      <input name="closingDate" type="date" max={easternDate()} defaultValue={profile?.closingDate ?? ""} />
    </label>
    <p className="muted">A closing date adds an annual follow-up task to the loan.</p>
    <label className="demo-confirm"><input name="watchEnabled" type="checkbox" checked={watchEnabled} onChange={(event) => setWatchEnabled(event.target.checked)} /> Add to the rate watchlist</label>
    <div className="form-grid">
      <label className="field"><span>Current note rate (%)</span>
        <input name="currentRate" type="number" min="0" max="99.999" step=".001" inputMode="decimal" required={watchEnabled} defaultValue={profile?.currentRate ?? ""} /></label>
      <label className="field"><span>Target rate (%)</span>
        <input name="targetRate" type="number" min="0" max="99.999" step=".001" inputMode="decimal" required={watchEnabled} defaultValue={profile?.targetRate ?? ""} /></label>
      <label className="field"><span>Observed rate (%)</span>
        <input name="observedRate" type="number" min="0" max="99.999" step=".001" inputMode="decimal" defaultValue={profile?.observedRate ?? ""} /></label>
    </div>
    <p className="muted">Enter the rate you want to compare. If it meets or falls below the target, Orbit adds a follow-up task.</p>
    <label className="field"><span>Follow-up notes</span><textarea name="note" rows={3} maxLength={1000} defaultValue={profile?.note ?? ""} /></label>
  </>;
}

export function LoanRetention({ loan, profile, edit }: { loan: Loan; profile?: PastClientProfile; edit: () => void }) {
  if (!pastClientLoan(loan)) return null;
  return <section className="details-section">
    <div className="section-heading"><h3>Past-client follow-up</h3><Button variant="outline" size="sm" onClick={edit}>Edit follow-up</Button></div>
    <p className="muted">{profile?.closingDate ? `Next anniversary ${dateLabel(nextAnniversary(profile.closingDate, easternDate()))}` : "Add the closing date to schedule a reminder."}</p>
    {profile?.watchEnabled && <p className="muted">Rate target {rate(profile.targetRate)} · {rateTargetReached(profile) ? "Target met" : "Watching"}</p>}
    {profile && rateTargetReached(profile) && <p className="relationship-note">Suggested follow-up. You recorded an observed rate of {rate(profile.observedRate)}{profile.checkedAt && ` on ${dateTime(profile.checkedAt)} ET`}, at or below the {rate(profile.targetRate)} target. Review the borrower’s situation before reaching out.</p>}
    {profile?.note && <p className="relationship-note">{profile.note}</p>}
  </section>;
}

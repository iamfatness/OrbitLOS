"use client";

import { useState } from "react";
import { dateLabel, easternDate, nextAnniversary, pastClientLoan, rateTargetReached } from "@/lib/client-retention";
import type { Loan, PastClientProfile, Workspace } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const views = ["All clients", "Anniversaries", "Rate watchlist"] as const;
const rate = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;

export function PastClients({ state, openLoan, editRetention }: {
  state: Workspace; openLoan: (loanId: string) => void; editRetention: (loanId: string) => void;
}) {
  const [view, setView] = useState<(typeof views)[number]>("All clients");
  const [query, setQuery] = useState("");
  const today = easternDate();
  const profiles = new Map(state.pastClients.map((profile) => [profile.loanId, profile]));
  const clients = state.loans.filter(pastClientLoan).map((loan) => {
    const profile = profiles.get(loan.id);
    const contact = state.contacts.find((item) => item.id === loan.contactId);
    const anniversary = profile?.closingDate ? nextAnniversary(profile.closingDate, today) : "";
    return { loan, profile, contact, anniversary, reached: profile ? rateTargetReached(profile) : false };
  });
  const watched = clients.filter(({ profile }) => profile?.watchEnabled);
  const withDate = clients.filter(({ anniversary }) => anniversary);
  const source = view === "Rate watchlist" ? [...watched].sort((a, b) => Number(b.reached) - Number(a.reached))
    : view === "Anniversaries" ? [...withDate].sort((a, b) => a.anniversary.localeCompare(b.anniversary)) : clients;
  const rows = source.filter(({ contact, loan }) => [contact?.name, loan.address, loan.officer]
    .some((value) => value?.toLowerCase().includes(query.trim().toLowerCase())));

  return <section className="pipeline" aria-label="Past-client list">
    <div className="pipeline-heading"><div><h2>Past-client loans <span>{clients.length}</span></h2>
      <p>{withDate.length} with closing dates · {watched.length} on the rate watchlist · {watched.filter(({ reached }) => reached).length} at target</p></div></div>
    <div className="toolbar">
      <label className="search"><input aria-label="Search past clients" placeholder="Search past clients…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="view-toggle" aria-label="Past-client view">{views.map((option) => <button type="button" key={option} aria-pressed={view === option} onClick={() => setView(option)}>{option}</button>)}</div>
    </div>
    {view === "Rate watchlist" && <p className="relationship-inset muted">Compare the rates you enter with each client’s target. A target met creates a follow-up task.</p>}
    {view === "Anniversaries" && <p className="relationship-inset muted">Orbit adds an annual task to the assigned officer’s queue using the recorded closing date.</p>}
    {rows.length ? <div className="table-scroll"><table className="data-table">
      <thead><tr><th>Borrower</th><th>Loan officer</th>
        {view === "Rate watchlist" ? <><th>Current rate</th><th>Target</th><th>Observed rate</th><th>Status</th></>
          : <><th>Closing date</th><th>Next anniversary</th><th>Rate watch</th></>}
        <th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{rows.map(({ loan, profile, contact, anniversary, reached }) => <tr key={loan.id}>
        <td><button className="name-link" onClick={() => openLoan(loan.id)}>{contact?.name ?? "Borrower"}</button><small>{loan.address || loan.stage}</small></td>
        <td>{loan.officer || "Unassigned"}</td>
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
        <td><Button variant="outline" size="sm" aria-label={`Edit follow-up for ${contact?.name ?? "borrower"}`} onClick={() => editRetention(loan.id)}>Edit follow-up</Button></td>
      </tr>)}</tbody>
    </table></div> : <p className="empty-inline no-matches">{query ? "No past clients match your search." :
      view === "Anniversaries" ? "Enter a closing date to start anniversary reminders." :
        view === "Rate watchlist" ? "Edit a past-client loan to set a rate target." : "Funded and closed loans appear here."}</p>}
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

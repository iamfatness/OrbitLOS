"use client";

import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { pastClientLoan } from "@/lib/client-retention";
import type { Workspace } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function RealtorCrm({ state, busy, save, openLoan, editRealtor }: {
  state: Workspace; busy: boolean; save: (input: unknown) => Promise<void>;
  openLoan: (loanId: string) => void; editRealtor: (realtorId: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [viewOpenedAt] = useState(Date.now);
  const partners = state.contacts.filter((contact) => contact.role === "Realtor");
  const realtor = partners.find((contact) => contact.id === selected) ?? partners[0];
  if (!realtor) return <section className="pipeline"><p className="empty-inline no-matches">Add a realtor contact, then link that realtor to a loan.</p></section>;

  const referrals = state.loans.filter((loan) => loan.partnerId === realtor.id);
  const pastCount = referrals.filter(pastClientLoan).length;
  const portal = state.realtorPortals.find((link) => link.realtorId === realtor.id);
  const active = Boolean(portal && Date.parse(portal.expiresAt) > viewOpenedAt);
  const path = active && portal ? `/referrals#${portal.token}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setCopyStatus("Referral link copied.");
    } catch {
      setCopyStatus("Open the realtor view and copy the address from your browser.");
    }
  }

  return <div className="relationship-stack">
    <section className="pipeline relationship-panel" aria-label="Realtor partner">
      <div className="section-heading">
        <h2>Realtor partner</h2>
        <Button variant="outline" size="sm" onClick={() => editRealtor(realtor.id)}>Edit contact</Button>
      </div>
      <label className="field"><span>Realtor</span><select value={realtor.id} onChange={(event) => { setSelected(event.target.value); setCopyStatus(""); }}>
        {partners.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
      </select></label>
      {(realtor.email || realtor.phone) && <p className="muted">{[realtor.email, realtor.phone].filter(Boolean).join(" · ")}</p>}
      <div className="details-grid">
        <div><span>Referrals</span><strong>{referrals.length}</strong></div>
        <div><span>Funded or closed</span><strong>{pastCount}</strong></div>
      </div>
    </section>
    <section className="pipeline relationship-panel" aria-label="Realtor access">
      <h2>Referral link</h2>
      <p className="muted">Share this link with the realtor so they can check their borrowers’ milestones. It expires after seven days.</p>
      {active && portal && <p className="muted">Expires {dateTime(portal.expiresAt)} ET.</p>}
      <div className="loan-application-actions">
        {path && <>
          <Button asChild variant="outline" size="sm"><a href={path} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open realtor view</a></Button>
          <Button variant="outline" size="sm" onClick={() => void copy()}><Copy /> Copy referral link</Button>
        </>}
        <Button size="sm" variant={active ? "outline" : "default"} disabled={busy} onClick={() => {
          setCopyStatus("");
          void save({ type: "createRealtorPortal", realtorId: realtor.id });
        }}>{active ? "Replace link" : "Create referral link"}</Button>
        {active && <Button variant="ghost" size="sm" disabled={busy} onClick={() => {
          setCopyStatus("");
          void save({ type: "revokeRealtorPortal", realtorId: realtor.id });
        }}>Revoke link</Button>}
      </div>
      {active && <p className="empty-inline">Replacing or revoking a link immediately closes access through that link.</p>}
      {copyStatus && <p className="muted" role="status">{copyStatus}</p>}
    </section>
    <section className="pipeline" aria-label="Referred loans">
      <div className="pipeline-heading"><div><h2>Referred loans <span>{referrals.length}</span></h2><p>Open a loan to review activity, tasks, or milestone drafts.</p></div></div>
      {referrals.length ? <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Borrower</th><th>Stage</th><th>Loan officer</th><th>Open tasks</th><th>Last activity</th></tr></thead>
        <tbody>{referrals.map((loan) => {
          const name = state.contacts.find((contact) => contact.id === loan.contactId)?.name ?? "Borrower";
          const open = state.tasks.filter((task) => task.loanId === loan.id && !task.completedAt).length;
          const activity = state.activity.find((item) => item.loanId === loan.id);
          return <tr key={loan.id}><td><button className="name-link" onClick={() => openLoan(loan.id)}>{name}</button></td>
            <td>{loan.stage}</td><td>{loan.officer || "Unassigned"}</td><td>{open}</td><td>{activity ? dateTime(activity.createdAt) + " ET" : "—"}</td></tr>;
        })}</tbody>
      </table></div> : <p className="empty-inline no-matches">Select this realtor in Edit loan to connect a referral.</p>}
    </section>
  </div>;
}

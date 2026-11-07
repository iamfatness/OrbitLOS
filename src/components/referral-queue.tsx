import { useState } from "react";
import type { ReferralReview } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

function ReferralItem({ lead, busy, now, convert, dismiss }: {
  lead: ReferralReview; busy: boolean; now: number;
  convert: (lead: ReferralReview, contactId: string | null, allowDuplicate: boolean) => void;
  dismiss: (lead: ReferralReview) => void;
}) {
  const [choice, setChoice] = useState("");
  const flagged = lead.matches.length > 0 || lead.restrictedMatch;
  const selected = lead.matches.find((match) => match.id === choice);
  const createNew = !flagged || (choice === "new" && !lead.restrictedMatch);

  return <li className="document-item">
    <div className="document-item-head"><strong>{lead.name}</strong><span className="pill">{flagged ? "Possible duplicate" : "New referral"}</span></div>
    <p>{lead.purpose} · Referred by {lead.realtorName}</p>
    <p className="muted">{lead.officer || "Brokerage queue"} · {Date.parse(lead.dueAt) < now ? "Overdue since" : "First contact due"} {dateTime(lead.dueAt)} ET</p>
    <details className="document-form">
      <summary>Review referral</summary>
      <div>
        <p>{[lead.email, lead.phone].filter(Boolean).join(" · ")}</p>
        {lead.restrictedMatch && <p className="muted">A possible match is outside your assigned loans. A brokerage admin can review it.</p>}
        {flagged && (lead.matches.length > 0 || !lead.restrictedMatch) && <label className="field">Contact to use
          <select value={selected?.id ?? (createNew && flagged ? "new" : "")} onChange={(event) => setChoice(event.target.value)} disabled={busy}>
            <option value="">Choose how to handle the match</option>
            {lead.matches.map((match) => <option key={match.id} value={match.id}>Use {match.name} · {match.reason} match</option>)}
            {!lead.restrictedMatch && <option value="new">Create a separate contact</option>}
          </select>
        </label>}
        {selected && <p className="muted">The 1003 will use the selected contact’s saved name, email and phone. The borrower can edit those fields.</p>}
        <div className="loan-application-actions">
          <Button size="sm" disabled={busy || (!selected && !createNew)} onClick={() => convert(lead, selected?.id ?? null, flagged && createNew)}>
            Create loan and prefill 1003
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
            if (window.confirm(`Dismiss the referral for ${lead.name}?`)) dismiss(lead);
          }}>Dismiss referral</Button>
        </div>
      </div>
    </details>
  </li>;
}

export function ReferralQueue({ leads, now, busy, refresh, convert, dismiss }: {
  leads: ReferralReview[]; now: number; busy: boolean; refresh: () => void;
  convert: (lead: ReferralReview, contactId: string | null, allowDuplicate: boolean) => void;
  dismiss: (lead: ReferralReview) => void;
}) {
  return <section className="work-queue" aria-label="Incoming referrals">
    <div className="section-heading"><h3>Incoming referrals <span className="pill">{leads.length} open</span></h3>
      <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>Refresh tasks</Button>
    </div>
    {leads.length ? <ul className="document-list">{leads.map((lead) => <ReferralItem key={lead.id} lead={lead} busy={busy} now={now}
      convert={convert} dismiss={dismiss} />)}</ul> : <p className="empty-inline">No open realtor referrals in this view.</p>}
  </section>;
}

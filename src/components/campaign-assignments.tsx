"use client";

import { useState } from "react";
import { campaignAssignmentLimit, localCampaignOfficers } from "@/lib/call-campaign-model";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import type { InboxLead } from "@/lib/model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { useLeadOwners } from "./use-lead-owners";

export function CampaignAssignments({ campaignId, leads, staff, busy, save, direct = false, routingEnabled }: {
  campaignId: string; leads: InboxLead[]; staff: WorkspaceStaff | null; busy: boolean; direct?: boolean; routingEnabled?: boolean;
  save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
}) {
  const { members, error } = useLeadOwners(staff?.brokerage.id ?? null);
  const roster = staff ? members : localCampaignOfficers;
  const [selection, setSelection] = useState<string[]>([]);
  const [officerEmail, setOfficerEmail] = useState("");
  const selected = direct ? leads.slice(0, 1) : leads.filter((lead) => selection.includes(lead.id));
  const target = roster?.find((member) => member.email === officerEmail);
  const batchSize = Math.min(leads.length, campaignAssignmentLimit);

  return <section className={direct ? "record-form" : "work-queue"} aria-label={direct ? `Assign ${selected[0]?.name ?? "campaign lead"}` : "Assign campaign leads"}>
    {!direct && <h3>Assign campaign leads</h3>}
    <p className="muted">{direct ? "First-contact deadlines and callbacks stay with this lead when its owner changes." : "Assign or reassign open leads. First-contact deadlines and callbacks follow the lead to its new owner."}
      {direct && routingEnabled && " Manual assignments can exceed round-robin limits."}</p>
    {error && <p role="alert">{error}</p>}
    {!leads.length ? <p className="empty-inline">No eligible leads in this view.</p> : <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      if (!target || !selected.length) return;
      void save({ type: "assignCampaignLeads", campaignId, email: target.email,
        leads: selected.map((lead) => ({ id: lead.id, previousEmail: lead.officerEmail })) }, () => setSelection([]));
    }}>
      {!direct && <><div className="loan-application-actions">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setSelection(leads.slice(0, batchSize).map((lead) => lead.id))}>
          {leads.length <= campaignAssignmentLimit ? "Select all eligible leads" : `Select first ${campaignAssignmentLimit} leads`}
        </Button>
        {selected.length > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelection([])}>Clear selection</Button>}
        <span className="muted" role="status">{selected.length} selected</span>
      </div>
      <ul className="document-list">{leads.map((lead) => <li key={lead.id} className="document-item">
        <label className="demo-confirm">
          <input type="checkbox" aria-label={`Select ${lead.name}`} checked={selection.includes(lead.id)}
            disabled={busy || (!selection.includes(lead.id) && selected.length >= campaignAssignmentLimit)} onChange={(event) => {
              setSelection(event.target.checked ? [...selected.map((item) => item.id), lead.id] : selection.filter((id) => id !== lead.id));
            }} />
          <span><strong>{lead.name}</strong><br /><span className="muted">{lead.officerEmail ? lead.officer : "Shared inbox"}
            {!lead.followUp.firstContactAt && !lead.followUp.replyReceivedAt && ` · First contact due ${dateTime(lead.dueAt)} ET`}</span></span>
        </label>
      </li>)}</ul></>}
      <label className="field">Assign to<select value={officerEmail} onChange={(event) => setOfficerEmail(event.target.value)} required disabled={busy || !roster?.length}>
        <option value="">{roster ? "Choose a loan officer" : error ? "Roster unavailable" : "Loading loan officers…"}</option>
        {roster?.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}
      </select></label>
      {roster?.length === 0 && <p className="muted">There are no active loan officers or admins in this brokerage.</p>}
      <div><Button type="submit" size="sm" disabled={busy || !target || !selected.length}>
        {selected.length ? `Assign ${selected.length} ${selected.length === 1 ? "lead" : "leads"}` : "Assign selected leads"}
      </Button></div>
    </form>}
  </section>;
}

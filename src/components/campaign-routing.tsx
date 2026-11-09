"use client";

import { useState } from "react";
import { localCampaignOfficers, type CallCampaign, type CampaignRouting as Routing } from "@/lib/call-campaign-model";
import type { InboxLead } from "@/lib/model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { Button } from "./ui/button";
import { useLeadOwners } from "./use-lead-owners";

export function CampaignRoutingCapacity({ campaignId, routing, leads, staff, busy, save }: {
  campaignId: string; routing: Routing; leads: InboxLead[]; staff: WorkspaceStaff | null; busy: boolean;
  save: (input: unknown) => Promise<void>;
}) {
  const { members, error } = useLeadOwners(staff?.brokerage.id ?? null);
  const roster = staff ? members : localCampaignOfficers;
  const counts = new Map<string, number>();
  let waiting = 0;
  for (const { officerEmail } of leads) {
    if (officerEmail) counts.set(officerEmail, (counts.get(officerEmail) ?? 0) + 1);
    else waiting++;
  }
  const officers = routing.officers.map(({ email, limit }) => ({
    email, limit, owner: roster?.find((member) => member.email === email), open: counts.get(email) ?? 0,
  }));
  const slots = officers.reduce((sum, { owner, open, limit }) => sum + (owner ? Math.max(0, limit - open) : 0), 0);
  return <section className="work-queue record-form" aria-label="Round-robin capacity">
    <div className="section-heading"><h3>Round-robin capacity</h3>
      {roster && <span className="pill">{slots} open {slots === 1 ? "slot" : "slots"}</span>}</div>
    {error && <p role="alert">{error}</p>}
    {!roster && !error && <p className="muted">Loading the active routing roster…</p>}
    {roster && <>
      <p className="muted">{waiting} eligible {waiting === 1 ? "lead waiting" : "leads waiting"} in this campaign.
        {waiting > 0 && slots === 0 && " The routing pool has no available slots."}</p>
      <ul className="loan-task-list">{officers.map(({ email, limit, owner, open }) => <li key={email}>
        <span>{owner?.name || email} · {owner ? `${open} of ${limit} open leads` : "Unavailable"}</span>
      </li>)}</ul>
      {waiting > 0 && slots > 0 && <div><Button size="sm" variant="outline" disabled={busy}
        onClick={() => void save({ type: "routeCampaignQueue", campaignId })}>Route eligible leads</Button></div>}
    </>}
  </section>;
}

export function CampaignRouting({ campaign, staff, busy, save }: {
  campaign: CallCampaign; staff: WorkspaceStaff | null; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const { members, error } = useLeadOwners(staff?.brokerage.id ?? null);
  const roster = staff ? members : localCampaignOfficers;
  const [selected, setSelected] = useState(campaign.routing?.officers.map(({ email }) => email) ?? []);
  const [enabled, setEnabled] = useState(campaign.routing?.enabled ?? false);
  const officers = (roster ?? []).filter((member) => selected.includes(member.email));
  const configured = new Map(campaign.routing?.officers.map(({ email, limit }) => [email, limit]));
  const unavailable = roster && [...configured.keys()].some((email) => !roster.some((member) => member.email === email));

  return <section className="integration record-form manager-panel" aria-label="Campaign routing">
    <div><h2>Campaign routing</h2><p className="muted">Send new, unassigned leads to the next available officer. Limits count open outreach leads in this campaign. Overflow stays in the shared inbox.</p></div>
    {error && <p role="alert">{error}</p>}
    {!roster && !error && <p className="muted">Loading the active roster…</p>}
    {unavailable && <p className="muted">Inactive officers are skipped. Saving removes them from this routing pool.</p>}
    {roster && <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      void save({ type: "saveCampaignRouting", campaignId: campaign.id, revision: campaign.routing?.revision ?? 0, enabled,
        officers: officers.map(({ email }) => ({ email, limit: Number(fields.get(email)) })) });
    }}>
      <label className="demo-confirm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable round robin</label>
      <ul className="document-list">{roster.map((member) => {
        const included = selected.includes(member.email);
        return <li className="document-item" key={member.email}>
          <label className="demo-confirm"><input type="checkbox" checked={included} disabled={!included && officers.length >= 30}
            onChange={(event) => setSelected(event.target.checked ? [...selected, member.email] : selected.filter((email) => email !== member.email))} />
            {member.name} · {member.email}</label>
          {included && <label className="field">Open lead limit for {member.name}
            <input name={member.email} type="number" required min={1} max={100} defaultValue={configured.get(member.email) ?? 10} />
          </label>}
        </li>;
      })}</ul>
      <div><Button size="sm" type="submit" disabled={busy || (enabled && officers.length === 0)}>Save routing</Button></div>
    </form>}
    {campaign.routing?.enabled && <div><Button size="sm" variant="outline" disabled={busy || !roster}
      onClick={() => void save({ type: "routeCampaignQueue", campaignId: campaign.id })}>Route shared leads</Button></div>}
  </section>;
}

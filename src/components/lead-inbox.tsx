"use client";

import { useEffect, useState } from "react";
import { demoBrokerageId, type BrokerageMember, type BrokerageSettings } from "@/lib/brokerage-model";
import { leadOutcomes, leadSequenceSteps, outreachChannels, type LeadRouting, type leadSequenceActions } from "@/lib/lead-inbox-model";
import type { InboxLead } from "@/lib/model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: () => void) => Promise<void>;
type Convert = (id: string, contactId: string | null, allowDuplicate: boolean) => void;
const views = ["All open", "Mine", "Unassigned", "First contact overdue", "Mock step due"] as const;
type View = (typeof views)[number];

export function firstContactOverdue(lead: InboxLead, now: number) {
  return !lead.followUp.firstContactAt && Date.parse(lead.dueAt) <= now;
}

function stepDue(lead: InboxLead, now: number) {
  return lead.followUp.status === "Active" && !!lead.followUp.nextAt && Date.parse(lead.followUp.nextAt) <= now;
}

function OwnerOptions({ members }: { members: BrokerageMember[] }) {
  return <>{members.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}</>;
}

function RoutingForm({ routing, staff, members, busy, save }: {
  routing: LeadRouting; staff: WorkspaceStaff | null; members: BrokerageMember[]; busy: boolean; save: Save;
}) {
  const [realtorRoute, setRealtorRoute] = useState(routing.realtorRoute);
  const [copyStatus, setCopyStatus] = useState("");
  const quotePath = routing.quoteToken ? `/quote#${routing.quoteToken}` : "";
  const mayPublish = !staff || staff.brokerage.pilot || staff.brokerage.id === demoBrokerageId;
  return <details className="loan-task-create">
    <summary>Lead routing and quote form</summary>
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void save({ type: "saveLeadRouting", revision: routing.revision, realtorRoute, realtorOwner: data.get("realtorOwner") || null,
        websiteOwner: data.get("websiteOwner") || null, quoteForm: data.get("quoteForm") || "Keep",
        firstContactHours: Number(data.get("firstContactHours")), secondAfterHours: Number(data.get("secondAfterHours")),
        finalAfterHours: Number(data.get("finalAfterHours")) });
    }}>
      <div className="form-grid">
        <label className="field">Website quote requests<select name="websiteOwner" defaultValue={routing.websiteOwner ?? ""}>
          <option value="">Shared inbox</option><OwnerOptions members={members} />
        </select></label>
        <label className="field">Realtor referrals<select value={realtorRoute} onChange={(event) => setRealtorRoute(event.target.value as LeadRouting["realtorRoute"])}>
          <option>Link owner</option><option>Shared inbox</option><option>Assigned officer</option>
        </select></label>
        {realtorRoute === "Assigned officer" && <label className="field">Realtor referral officer<select name="realtorOwner" required defaultValue={routing.realtorOwner ?? ""}>
          <option value="">Choose an officer</option><OwnerOptions members={members} />
        </select></label>}
        <label className="field">First contact due in hours<input name="firstContactHours" type="number" min={1} max={72} required defaultValue={routing.firstContactHours} /></label>
        <label className="field">Check-in hours after introduction<input name="secondAfterHours" type="number" min={1} max={168} required defaultValue={routing.secondAfterHours} /></label>
        <label className="field">Final check-in hours after check-in<input name="finalAfterHours" type="number" min={1} max={336} required defaultValue={routing.finalAfterHours} /></label>
        {mayPublish && <label className="field">Public quote request link<select name="quoteForm" defaultValue="Keep">
          <option value="Keep">{quotePath ? "Keep current link" : "Keep disabled"}</option>
          <option value="Enable or replace">{quotePath ? "Replace link" : "Enable link"}</option>
          {quotePath && <option value="Disable">Disable link</option>}
        </select></label>}
      </div>
      <p className="muted">Routing applies to new requests. Mock check-in delays apply when the next step is scheduled.</p>
      <div><Button size="sm" type="submit" disabled={busy}>Save routing</Button></div>
    </form>
    {quotePath && <div className="loan-application-actions">
      <Button asChild size="sm" variant="outline"><a href={quotePath} target="_blank" rel="noopener noreferrer">Open public quote form</a></Button>
      <Button size="sm" variant="outline" onClick={async () => {
        try {
          await navigator.clipboard.writeText(new URL(quotePath, window.location.origin).href);
          setCopyStatus("Quote-request link copied.");
        } catch { setCopyStatus("Open the public form and copy its address from the browser."); }
      }}>Copy quote form link</Button>
      {copyStatus && <span role="status">{copyStatus}</span>}
    </div>}
  </details>;
}

function LeadCard({ lead, staff, members, now, busy, focused, save, convert }: {
  lead: InboxLead; staff: WorkspaceStaff | null; members: BrokerageMember[]; now: number; busy: boolean; focused: boolean; save: Save; convert: Convert;
}) {
  const [match, setMatch] = useState("");
  const isAdmin = !staff || staff.brokerage.role === "Admin";
  const canWork = isAdmin || lead.officerEmail === staff?.email;
  const followUp = lead.followUp;
  const flagged = lead.matches.length > 0 || lead.restrictedMatch;
  const chosen = lead.matches.find((item) => item.id === match);
  const canCreate = !flagged || (match === "new" && !lead.restrictedMatch);
  const step = leadSequenceSteps[followUp.nextStep];
  const overdue = firstContactOverdue(lead, now);
  const sequence = (action: (typeof leadSequenceActions)[number]) => void save({
    type: "leadSequence", leadId: lead.id, revision: followUp.revision, action,
  });
  const assign = (email: string | null) => void save({ type: "assignInboxLead", leadId: lead.id, email, previousEmail: lead.officerEmail });
  useEffect(() => {
    if (!focused) return;
    const item = document.getElementById(`inbox-lead-${lead.id}`);
    item?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: "nearest" });
  }, [focused, lead.id]);

  return <li className="document-item" id={`inbox-lead-${lead.id}`} tabIndex={-1}>
    <div className="document-item-head"><strong>{lead.name}</strong><span className={overdue ? "open-chip" : "pill"}>
      {overdue ? "First contact overdue" : followUp.firstContactAt ? "Outreach logged" : "First contact due"}</span></div>
    <p>{lead.realtorName ? `Realtor referral · ${lead.realtorName}` : "Website quote request"} · {lead.purpose}{lead.zip && ` · ZIP ${lead.zip}`}</p>
    <p className="muted">{lead.officer || "Shared inbox"} · {dateTime(followUp.firstContactAt ?? lead.dueAt)} ET{flagged && " · Possible duplicate"}</p>
    {!canWork && staff && <Button variant="outline" size="sm" disabled={busy} onClick={() => assign(staff.email)}>Claim lead</Button>}
    {canWork && <details className="document-form" open={focused || undefined}>
      <summary>Work lead</summary>
      <div className="record-form">
        <p>{[lead.email, lead.phone].filter(Boolean).join(" · ")}</p>
        {isAdmin && members.length > 0 && <form className="task-form" key={lead.officerEmail ?? ""} onSubmit={(event) => {
          event.preventDefault();
          const email = String(new FormData(event.currentTarget).get("owner") ?? "");
          assign(email || null);
        }}>
          <label className="field">Lead owner<select name="owner" defaultValue={lead.officerEmail ?? ""}>
            <option value="">Shared inbox</option><OwnerOptions members={members} />
          </select></label>
          <Button size="sm" type="submit" disabled={busy}>Save owner</Button>
        </form>}
        <div className="work-queue">
          <div className="section-heading"><h4>Mock follow-up sequence</h4><span className="pill">{followUp.status}</span></div>
          {step && (followUp.status === "Active" || followUp.status === "Paused") && <div>
            <p><strong>{step.title}</strong>{followUp.nextAt && followUp.status === "Active" && ` · Due ${dateTime(followUp.nextAt)} ET`}</p>
            <p>{step.body}</p>
          </div>}
          <div className="loan-application-actions">
            {followUp.status === "Not started" && <Button size="sm" variant="outline" disabled={busy} onClick={() => sequence("Start")}>Start mock sequence</Button>}
            {followUp.status === "Active" && <>
              <Button size="sm" variant="outline" disabled={busy || !stepDue(lead, now)} onClick={() => sequence("Mock send")}>Record mock send</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => sequence("Pause")}>Pause sequence</Button>
            </>}
            {followUp.status === "Paused" && <Button size="sm" variant="outline" disabled={busy} onClick={() => sequence("Resume")}>Resume sequence</Button>}
            {(followUp.status === "Active" || followUp.status === "Paused") &&
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => sequence("Stop")}>Stop sequence</Button>}
          </div>
          <p className="muted">Mock sends stay in Orbit. Log an outreach outcome to clear the first-contact deadline. A connection or reply stops the sequence.</p>
        </div>
        <form className="record-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void save({ type: "leadContact", leadId: lead.id, revision: followUp.revision, channel: data.get("channel"),
            outcome: data.get("outcome"), note: data.get("note") }, () => form.reset());
        }}>
          <div className="form-grid">
            <label className="field">Outreach channel<select name="channel">{outreachChannels.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="field">Outreach outcome<select name="outcome" required><option value="">Choose an outcome</option>{leadOutcomes.map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
          <label className="field">Outreach note (optional)<textarea rows={2} maxLength={500} name="note" /></label>
          <div><Button size="sm" type="submit" disabled={busy}>Log outreach</Button></div>
        </form>
        {followUp.events.length > 0 && <div>
          <h4>Lead activity</h4>
          <ul>{followUp.events.map((item) => <li key={item.id}>{item.text} · {item.actor} · {dateTime(item.at)} ET</li>)}</ul>
        </div>}
        {lead.restrictedMatch && <p className="muted">A possible match needs brokerage admin review.</p>}
        {flagged && (lead.matches.length > 0 || !lead.restrictedMatch) && <label className="field">Contact to use
          <select value={match} onChange={(event) => setMatch(event.target.value)}>
            <option value="">Choose how to handle the match</option>
            {lead.matches.map((item) => <option key={item.id} value={item.id}>Use {item.name} · {item.reason} match</option>)}
            {!lead.restrictedMatch && <option value="new">Create a separate contact</option>}
          </select>
        </label>}
        <div className="loan-application-actions">
          <Button size="sm" disabled={busy || (!chosen && !canCreate)}
            onClick={() => convert(lead.id, chosen?.id ?? null, flagged && canCreate)}>Create loan and prefill 1003</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
            if (window.confirm(`Dismiss the lead for ${lead.name}?`)) void save({ type: "dismissReferral", referralId: lead.id });
          }}>Dismiss lead</Button>
        </div>
      </div>
    </details>}
  </li>;
}

export function LeadInbox({ leads, routing, staff, now, busy, focusLeadId, save, convert }: {
  leads: InboxLead[]; routing: LeadRouting | null; staff: WorkspaceStaff | null;
  now: number; busy: boolean; focusLeadId?: string; save: Save; convert: Convert;
}) {
  const [view, setView] = useState<View>("All open");
  const [members, setMembers] = useState<BrokerageMember[]>();
  const [memberError, setMemberError] = useState("");
  const brokerage = staff?.brokerage.role === "Admin" ? staff.brokerage.id : null;
  useEffect(() => {
    if (!brokerage) return;
    const controller = new AbortController();
    fetch(`/api/brokerages?brokerage=${encodeURIComponent(brokerage)}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load active loan officers. Refresh before assigning.");
      const team = await response.json() as BrokerageSettings;
      setMembers(team.members.filter((member) => member.status === "Active" && member.role !== "Processor"));
    }).catch((error: Error) => { if (!controller.signal.aborted) setMemberError(error.message); });
    return () => controller.abort();
  }, [brokerage]);

  const visible = leads.filter((lead) => {
    if (view === "Mine") return !!staff && lead.officerEmail === staff.email;
    if (view === "Unassigned") return !lead.officerEmail;
    if (view === "First contact overdue") return firstContactOverdue(lead, now);
    if (view === "Mock step due") return stepDue(lead, now);
    return true;
  });
  const overdue = leads.filter((lead) => firstContactOverdue(lead, now)).length;
  return <section className="pipeline relationship-panel" aria-label="Lead inbox">
    <div className="section-heading"><h2>Quote requests and referrals</h2><span className={overdue ? "open-chip" : "pill"}>{overdue} overdue first contacts</span></div>
    <p className="muted">Work new prospects here before opening a loan. Overdue first contacts surface in Tasks.</p>
    {memberError && <p role="alert">{memberError}</p>}
    {routing && (!staff || members) && <RoutingForm key={routing.revision} routing={routing} staff={staff} members={members ?? []} busy={busy} save={save} />}
    <div className="filter-row">
      <label className="field">Lead view<select value={view} onChange={(event) => setView(event.target.value as View)}>
        {views.filter((item) => item !== "Mine" || staff).map((item) => <option key={item}>{item}</option>)}</select></label>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "refreshWorkspace" })}>Refresh inbox</Button>
    </div>
    {visible.length ? <ul className="document-list">{visible.map((lead) =>
      <LeadCard key={lead.id} lead={lead} staff={staff} members={members ?? []} now={now} busy={busy} focused={lead.id === focusLeadId} save={save} convert={convert} />
    )}</ul> : <p className="empty-inline">No leads in this view.</p>}
  </section>;
}

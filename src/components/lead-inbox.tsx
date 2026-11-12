"use client";

import { useEffect, useRef, useState } from "react";
import { readArchivePage, readInboxWork } from "@/app/actions";
import { LeadLicenseStateReview } from "./license-state-review";
import { PropertyStateOptions } from "./property-state-field";
import { workspaceFeatures, demoBrokerageId, type BrokerageMember } from "@/lib/brokerage-model";
import { CrmFieldValues } from "./crm-fields";
import { firstContactOverdue, leadInboxUnavailable, leadInboxViews, leadOutcomes, leadSequenceSteps, outreachChannels,
  type ArchivedLead, type InboxLeadSummary, type LeadArchivePage, type LeadInboxPage, type LeadInboxView, type LeadRouting, type leadSequenceActions } from "@/lib/lead-inbox-model";
import type { InboxLead } from "@/lib/model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { QuoteConsentEvidence } from "./quote-consent-receipt";
import { Button } from "./ui/button";
import { useLeadOwners } from "./use-lead-owners";
import { LeadTasks, leadTaskTarget } from "./lead-tasks";
import { SharedRealtorPolicyForm, SharedRealtorQueueView } from "./shared-realtor-queue";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { leadWorkUnavailable } from "@/lib/lead-work-model";
import { QuoteIntakeEditor } from "./quote-intake-settings";
import { quoteRequestPath, quoteRoutingLabel } from "@/lib/quote-intake-model";
import { quoteOccupancyChoices, quotePrefillFields, quotePrefillLabels, type QuotePrefillField, type QuotePrefillSelection } from "@/lib/quote-intake-questions";
import { localCampaignOfficers } from "@/lib/call-campaign-model";
import { LeadDocumentChecklist } from "./lead-document-checklist";
import { BorrowerChannelPreferences } from "./borrower-channel-preferences";
import { borrowerHoursLabel, nextBorrowerContactTime } from "@/lib/borrower-hours";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
type Convert = (id: string, contactId: string | null, allowDuplicate: boolean, after: () => void, intakeReview?: QuotePrefillSelection) => void;

function OwnerOptions({ members }: { members: BrokerageMember[] }) {
  return <>{members.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}</>;
}

function RoutingForm({ routing, staff, members, busy, save, openOnEntry }: {
  routing: LeadRouting; staff: WorkspaceStaff | null; members: BrokerageMember[]; busy: boolean; save: Save; openOnEntry?: boolean;
}) {
  const [realtorRoute, setRealtorRoute] = useState(routing.realtorRoute);
  const [copyStatus, setCopyStatus] = useState("");
  const entry = useRef<HTMLElement>(null);
  useEffect(() => { if (openOnEntry) entry.current?.focus(); }, [openOnEntry]);
  const quotePath = routing.quoteToken ? quoteRequestPath(routing.quoteToken) : "";
  const mayPublish = !staff || staff.brokerage.pilot || staff.brokerage.id === demoBrokerageId;
  return <details className="loan-task-create" open={openOnEntry || undefined}>
    <summary ref={entry}>Lead routing and quote form</summary>
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
    {mayPublish && <QuoteIntakeEditor brokerageId={staff?.brokerage.id ?? demoBrokerageId}
      members={staff ? members : localCampaignOfficers.map((member) => ({ ...member, status: "Active", role: "LO" }))}
      quoteToken={routing.quoteToken} />}
  </details>;
}

function LeadHeading({ lead, now, flagged }: { lead: InboxLeadSummary; now: number; flagged?: boolean }) {
  const { followUp } = lead;
  const overdue = firstContactOverdue(lead, now);
  return <>
    <div className="document-item-head"><strong>{lead.name}</strong><span className={overdue ? "open-chip" : "pill"}>
      {lead.heldAt ? "On hold" : lead.outreachSuppressed ? "Outreach opted out" : followUp.replyReceivedAt ? "Reply received" :
        overdue ? "First contact overdue" : followUp.firstContactAt ? "Outreach logged" : "First contact due"}</span></div>
    <p>{lead.realtorName ? `Realtor referral · ${lead.realtorName}` : lead.source} · {lead.purpose}{lead.propertyState && ` · Property ${lead.propertyState}`}{lead.zip && ` · ZIP ${lead.zip}`}</p>
    <p className="muted">{lead.officer || "Shared inbox"}{lead.heldAt
      ? lead.revisitDate && ` · Revisit ${lead.revisitDate}`
      : ` · ${dateTime(followUp.replyReceivedAt ?? followUp.firstContactAt ?? lead.dueAt)} ET`}{flagged && " · Possible duplicate"}</p>
  </>;
}

function LeadPropertyStateEditor({ lead, busy, save }: { lead: InboxLead; busy: boolean; save: Save }) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const baseline = () => ({ revision: lead.followUp.revision, propertyState: lead.propertyState, reason: "" });
  const [draft, setDraft] = useState<ReturnType<typeof baseline>>();
  const stale = draft && draft.revision !== lead.followUp.revision;
  const ready = draft && !stale && draft.propertyState !== lead.propertyState && draft.reason.trim().length >= 4;
  return <details className="document-form license-state-review" ref={details}
    onToggle={event => setDraft(event.currentTarget.open ? baseline() : undefined)}>
    <summary ref={summary}>Correct property state</summary>
    {draft && <form className="record-form w-full max-w-lg" onSubmit={event => {
      event.preventDefault();
      if (!ready || busy) return;
      void save({ type: "correctLeadPropertyState", leadId: lead.id, ...draft }, () => {
        if (details.current) details.current.open = false;
        summary.current?.focus();
      });
    }}>
      {stale && <p role="alert">The lead changed. The saved state is {lead.propertyState || "Unknown"}. Review it before saving.</p>}
      <label className="field">Corrected property state<select value={draft.propertyState} disabled={busy}
        onChange={event => setDraft({ ...draft, propertyState: event.target.value })}>
        <PropertyStateOptions placeholder="Unknown or undecided" />
      </select></label>
      <label className="field">Reason for property state change
        <textarea value={draft.reason} rows={2} minLength={4} maxLength={240} required disabled={busy}
          onChange={event => setDraft({ ...draft, reason: event.target.value })} />
      </label>
      {stale ? <Button type="button" size="sm" variant="outline" disabled={busy}
        onClick={() => setDraft({ ...draft, revision: lead.followUp.revision })}>Review current state</Button> :
        <Button type="submit" size="sm" disabled={busy || !ready}>Save property state</Button>}
    </form>}
  </details>;
}

function LeadCard({ lead, staff, members, now, busy, focusTaskId, focusDocumentId, save, convert, openCampaign, openConversation, close }: {
  lead: InboxLead; staff: WorkspaceStaff | null; members: BrokerageMember[]; now: number; busy: boolean; focusTaskId?: string; save: Save; convert: Convert;
  focusDocumentId?: string;
  openCampaign: (campaignId: string, leadId: string) => void;
  openConversation: (leadId: string) => void;
  close: () => void;
}) {
  const [match, setMatch] = useState("");
  const [prefill, setPrefill] = useState<QuotePrefillField[]>([]);
  const [corrections, setCorrections] = useState<Partial<Record<QuotePrefillField, string>>>({});
  const [reason, setReason] = useState("");
  const intake = lead.intake;
  const policy = lead.quoteOverridePolicy;
  const values = Object.fromEntries(quotePrefillFields.flatMap((field) =>
    prefill.includes(field) && corrections[field]?.trim() ? [[field, corrections[field]]] : []));
  const hasCorrections = Object.keys(values).length > 0;
  const isAdmin = !staff || staff.brokerage.role === "Admin";
  const canWork = isAdmin || lead.officerEmail === staff?.email;
  const followUp = lead.followUp;
  const checkedAt = new Date(now).toISOString();
  const nextWindow = nextBorrowerContactTime(checkedAt, lead.outreachHours);
  const nextEmailAt = followUp.nextAt && (nextWindow > checkedAt && nextWindow > followUp.nextAt ? nextWindow : followUp.nextAt);
  const flagged = !lead.importedContactId && (lead.matches.length > 0 || lead.restrictedMatch);
  const chosen = lead.matches.find((item) => item.id === match);
  const canCreate = !flagged || (match === "new" && !lead.restrictedMatch);
  const canConvert = !busy && !lead.heldAt && Boolean(lead.importedContactId || chosen || canCreate);
  const step = leadSequenceSteps[followUp.nextStep];
  const sequence = (action: (typeof leadSequenceActions)[number]) => void save({
    type: "leadSequence", leadId: lead.id, revision: followUp.revision, action,
  });
  const assign = (email: string | null) => void save({ type: "assignInboxLead", leadId: lead.id, email, previousEmail: lead.officerEmail });
  useEffect(() => {
    if (focusDocumentId) return;
    const task = focusTaskId ? document.getElementById(leadTaskTarget(focusTaskId)) : null;
    const item = task ?? document.getElementById(`inbox-lead-${lead.id}`);
    item?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: task ? "center" : "nearest" });
  }, [focusTaskId, focusDocumentId, lead.id, members.length]);

  return <li className="document-item" id={`inbox-lead-${lead.id}`} tabIndex={-1}>
    <LeadHeading lead={lead} now={now} flagged={flagged} />
    <div><Button size="sm" variant="ghost" disabled={busy} onClick={close}>Close lead details</Button></div>
    {!canWork && staff && <Button variant="outline" size="sm" disabled={busy} onClick={() => assign(staff.email)}>Claim lead</Button>}
    {canWork && (staff || process.env.NODE_ENV === "development") && <div><Button variant="outline" size="sm" disabled={busy}
      onClick={() => openConversation(lead.id)}>Open lead conversation</Button></div>}
    {canWork && <details className="document-form" open>
      <summary>Work lead</summary>
      <div className="record-form">
        <p>{[lead.email, lead.phone].filter(Boolean).join(" · ")}</p>
        <CrmFieldValues brokerageId={staff?.brokerage.id ?? demoBrokerageId} target={{ record: "lead", recordId: lead.id }} />
        {lead.initialRouting && <section className="work-queue" aria-label="Website routing at submission">
          <h4>Website routing at submission</h4>
          <p>{quoteRoutingLabel(lead.initialRouting)}</p>
          <p className="muted">{lead.initialRouting.profile} form v{lead.initialRouting.formRevision}
            {lead.initialRouting.rule === "Website default" && ` · Website routing v${lead.initialRouting.websiteRevision}`}
            {lead.initialRouting.note && ` · ${lead.initialRouting.note}`}</p>
        </section>}
        {lead.quoteConsent !== undefined && <QuoteConsentEvidence receipt={lead.quoteConsent} />}
        {intake && <a href={`#intake-review-${lead.id}`}>Review intake answers for the 1003</a>}
        <LeadPropertyStateEditor lead={lead} busy={busy} save={save} />
        {staff?.brokerage.role === "Admin" && workspaceFeatures(staff.brokerage).compliance &&
          <LeadLicenseStateReview key={`${lead.id}:${lead.propertyState}`} brokerageId={staff.brokerage.id} propertyState={lead.propertyState} />}
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
        {lead.heldAt ? <div className="work-queue">
          <p><strong>On hold</strong> · {lead.holdReason}</p>
          <p className="muted">Original deadlines stay on the record. {lead.campaignId
            ? "If the campaign owner is at capacity, reactivation returns the lead to the shared queue."
            : "Outreach and lead tasks resume after reactivation."}</p>
          {lead.outreachSuppressed && <p className="muted">This borrower’s outreach opt-out stays in effect.</p>}
          <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
            type: "leadHold", leadId: lead.id, revision: followUp.revision, action: "Reactivate",
          })}>Reactivate lead</Button></div>
        </div> : <details className="document-form">
          <summary>Put lead on hold</summary>
          <form className="record-form" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void save({ type: "leadHold", leadId: lead.id, revision: followUp.revision, action: "Hold",
              reason: data.get("reason"), revisitDate: data.get("revisitDate") || null });
          }}>
            <label className="field">Hold reason<input name="reason" required maxLength={160} /></label>
            <label className="field">Revisit date (optional)<input name="revisitDate" type="date" /></label>
            <div><Button size="sm" type="submit" disabled={busy}>Hold lead</Button></div>
          </form>
        </details>}
        {!lead.heldAt && (lead.outreachSuppressed || lead.campaignId ? <div className="work-queue">
          <p className="muted">{lead.outreachSuppressed ? "This borrower opted out of brokerage outreach. You can still process a borrower-requested application." : "This lead’s outreach and follow-up are managed by its call campaign."}</p>
          {lead.campaignId && <div><Button size="sm" variant="outline" onClick={() => openCampaign(lead.campaignId!, lead.id)}>Open call campaign</Button></div>}
        </div> : <><div className="work-queue">
          <div className="section-heading"><h4>Mock email follow-up sequence</h4><span className="pill">{followUp.status}</span></div>
          {step && (followUp.status === "Active" || followUp.status === "Paused") && <div>
            <p><strong>{step.title}</strong>{nextEmailAt && followUp.status === "Active" && ` · Due ${dateTime(nextEmailAt)} ET`}</p>
            <p>{step.body}</p>
          </div>}
          <div className="loan-application-actions">
            {followUp.status === "Not started" && <Button size="sm" variant="outline" disabled={busy} onClick={() => sequence("Start")}>Start mock sequence</Button>}
            {followUp.status === "Active" && <>
              <Button size="sm" variant="outline" disabled={busy || !nextEmailAt || Date.parse(nextEmailAt) > now} onClick={() => sequence("Mock send")}>Record mock send</Button>
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
        </form></>)}
        <BorrowerChannelPreferences target="lead" recordId={lead.id} blocked={lead.outreachChannelBlocks}
          optedOut={lead.outreachSuppressed} busy={busy} save={save} />
        {lead.outreachHours && <p className="muted">Preferred contact hours · {borrowerHoursLabel(lead.outreachHours)}</p>}
        {!lead.outreachSuppressed && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => {
          if (window.confirm(`Record ${lead.name}’s outreach opt-out across this brokerage? This stops mock sequences and campaign callbacks for matching records.`)) {
            void save({ type: "leadOptOut", leadId: lead.id });
          }
        }}>Record outreach opt-out</Button></div>}
        {followUp.events.length > 0 && <div>
          <h4>Lead activity</h4>
          <ul>{followUp.events.map((item) => <li key={item.id}>{item.text} · {item.actor} · {dateTime(item.at)} ET</li>)}</ul>
        </div>}
        <LeadTasks lead={lead} busy={busy} save={save} />
        {lead.officerEmail && (staff?.brokerage.pilot || (!staff && process.env.NODE_ENV === "development")) &&
          <LeadDocumentChecklist key={focusDocumentId ?? "lead-documents"} brokerageId={staff?.brokerage.id ?? demoBrokerageId}
            leadId={lead.id} busy={busy} focusRequestId={focusDocumentId} />}
        {lead.importedContactId && <p className="muted">This lead is linked to the borrower’s existing contact.</p>}
        {flagged && lead.restrictedMatch && <p className="muted">A possible match needs brokerage admin review.</p>}
        {flagged && (lead.matches.length > 0 || !lead.restrictedMatch) && <label className="field">Contact to use
          <select value={match} onChange={(event) => setMatch(event.target.value)}>
            <option value="">Choose how to handle the match</option>
            {lead.matches.map((item) => <option key={item.id} value={item.id}>Use {item.name} · {item.reason} match</option>)}
            {!lead.restrictedMatch && <option value="new">Create a separate contact</option>}
          </select>
        </label>}
        {(chosen || lead.importedContactId) && <p className="muted">The loan keeps the linked contact’s history. The 1003 uses this lead’s email and phone when provided and fills blanks from the saved contact.</p>}
        <form className="record-form intake-conversion" onSubmit={(event) => {
          event.preventDefault();
          if (!canConvert) return;
          convert(lead.id, chosen?.id ?? null, flagged && canCreate, close, intake && prefill.length ? {
            revision: intake.revision, fields: prefill,
            ...(hasCorrections && policy ? { correction: { policyRevision: policy.revision, values, reason } } : {}),
          } : undefined);
        }}>
          {intake && <fieldset id={`intake-review-${lead.id}`} className="record-form document-item intake-correction" disabled={busy || !!lead.heldAt}>
            <legend>Review intake answers</legend>
            <p className="muted">{intake.profile} profile · Version {intake.revision}. Select which answers to copy to the borrower’s draft. They can edit the fields before submitting.</p>
            {intake.answers.map(({ id, prompt, value, prefill: field }) => <div key={id}>
              <p><strong>{prompt}</strong></p>
              <p className="quote-consent-copy">{value}</p>
              {field && <label className="demo-confirm"><input type="checkbox" checked={prefill.includes(field)}
                onChange={(event) => setPrefill(event.target.checked ? [...prefill, field] : prefill.filter((item) => item !== field))} />
                <span>Prefill {quotePrefillLabels[field].toLowerCase()}</span></label>}
              {field && prefill.includes(field) && policy?.fields.includes(field) && <label className="field">
                Correct {quotePrefillLabels[field].toLowerCase()} (optional)
                {field === "occupancy" ? <select value={corrections[field] ?? ""}
                  onChange={(event) => setCorrections({ ...corrections, [field]: event.target.value })}>
                  <option value="">Use submitted answer</option>
                  {quoteOccupancyChoices.filter((choice) => choice !== value).map((choice) => <option key={choice}>{choice}</option>)}
                </select> : <input inputMode="decimal" maxLength={14} placeholder="Use submitted amount"
                  value={corrections[field] ?? ""} onChange={(event) => setCorrections({ ...corrections, [field]: event.target.value })} />}
              </label>}
            </div>)}
            {hasCorrections && <label className="field">Reason for correction
              <textarea rows={2} minLength={4} maxLength={240} required value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>}
          </fieldset>}
          <div className="loan-application-actions">
            <Button type="submit" size="sm" disabled={!canConvert}>Create loan and prefill 1003</Button>
          </div>
        </form>
        <details className="document-form">
          <summary>Archive lead</summary>
          <p className="muted">You can restore this lead from the Lead Inbox. {lead.campaignId && "Archiving closes open campaign callbacks and keeps them in history."}</p>
          <div><Button size="sm" type="button" variant="danger" disabled={busy} onClick={() => void save({
            type: "dismissReferral", referralId: lead.id, revision: followUp.revision,
          }, close)}>Confirm archive</Button></div>
        </details>
      </div>
    </details>}
  </li>;
}

function ArchivedLeads({ brokerageId, busy, restore, focusId }: {
  brokerageId: string; busy: boolean; restore: (lead: ArchivedLead) => void; focusId?: string;
}) {
  const [search, setSearch] = useState<{ query: string; leadId?: string }>({ query: "", leadId: focusId });
  const [result, setResult] = useState<{ search: typeof search; page: LeadArchivePage | { error: string } }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  useEffect(() => {
    let active = true;
    const update = (page: LeadArchivePage | { error: string }) => { if (active) setResult({ search, page }); };
    void readArchivePage(search, brokerageId).then(update, () => update({ error: "Could not load the lead archive." }));
    return () => { active = false; };
  }, [search, brokerageId]);
  const page = result?.search === search ? result.page : undefined;

  async function loadMore(before: NonNullable<LeadArchivePage["next"]>) {
    if (!page || "error" in page || loadingMore) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const next = await readArchivePage({ ...search, before }, brokerageId);
      if ("error" in next) setMoreError(next.error);
      else setResult((latest) => latest?.search === search
        ? { search, page: { leads: [...page.leads, ...next.leads], next: next.next } } : latest);
    } catch {
      setMoreError("Could not load older archived leads.");
    } finally {
      setLoadingMore(false);
    }
  }

  return <section className="record-form" aria-label="Archived leads">
    <h3>Archived leads</h3>
    <p className="muted">Restore a lead with its activity and original deadlines. If its previous campaign owner is at capacity, the lead returns to the shared queue. Closed campaign callbacks stay in the history.</p>
    <form className="task-form" onSubmit={(event) => {
      event.preventDefault();
      setMoreError("");
      setSearch({ query: String(new FormData(event.currentTarget).get("query") ?? "").trim() });
    }}>
      <label className="field">Search archived leads<input name="query" maxLength={160} placeholder="Name or email" /></label>
      <Button size="sm" type="submit" variant="outline" disabled={loadingMore || busy}>Search archive</Button>
      {search.leadId && <Button size="sm" variant="outline" disabled={busy} onClick={() => setSearch({ query: "" })}>View all archived leads</Button>}
    </form>
    {!page ? <p className="muted" role="status">Loading archived leads…</p> : "error" in page ? <div>
      <p role="alert">{page.error}</p>
      <Button size="sm" variant="outline" onClick={() => setSearch({ ...search })}>Retry archive</Button>
    </div> : <>
      {page.leads.length > 0 ? <ul className="document-list">{page.leads.map((lead) => <li className="document-item" key={lead.id}>
        <div className="document-item-head"><strong>{lead.name}</strong><span className="pill">Archived</span></div>
        <p>{lead.source}{lead.realtorName && ` · ${lead.realtorName}`}</p>
        <p className="muted">{lead.officer || "Shared inbox"} · Archived {dateTime(lead.archivedAt)} ET</p>
        <div><Button size="sm" variant="outline" disabled={busy} onClick={() => restore(lead)}>Restore lead</Button></div>
      </li>)}</ul> : <p className="empty-inline">{search.leadId ? "This archived lead is no longer available." :
        search.query ? "No archived leads match your search." : "No archived leads yet."}</p>}
      {moreError && <p role="alert">{moreError}</p>}
      {page.next && <div><Button size="sm" variant="outline" disabled={loadingMore || busy} onClick={() => void loadMore(page.next!)}>
        {loadingMore ? "Loading…" : "Load older archived leads"}</Button></div>}
    </>}
  </section>;
}

export function LeadInbox({ version, staff, now, busy, initialView, focusLeadId, focusTaskId, focusDocumentId, focusArchivedLeadId, save, convert, openCampaign, openConversation, openRouting }: {
  version: object; staff: WorkspaceStaff | null;
  now: number; busy: boolean; focusLeadId?: string; focusTaskId?: string; focusArchivedLeadId?: string; save: Save; convert: Convert;
  initialView?: LeadInboxView;
  focusDocumentId?: string;
  openCampaign: (campaignId: string, leadId: string) => void;
  openConversation: (leadId: string) => void;
  openRouting?: boolean;
}) {
  const [view, setView] = useState<LeadInboxView>(focusArchivedLeadId ? "Archived" : initialView ?? "All open");
  const [selection, setSelection] = useState<{ from?: string; id?: string }>();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ view: LeadInboxView; version: object; retry: number; page?: LeadInboxPage; error?: string }>();
  const [details, setDetails] = useState<{ id: string; version: object; retry: number; lead?: InboxLead; error?: string }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const focused = selection?.from === focusLeadId ? selection?.id : focusLeadId;
  const selectLead = (id?: string) => {
    setDetails(undefined);
    setSelection({ from: focusLeadId, id });
  };
  const brokerageId = staff?.brokerage.id ?? demoBrokerageId;
  const brokerage = staff?.brokerage.role === "Admin" ? staff.brokerage.id : null;
  const { members, error: memberError } = useLeadOwners(brokerage);
  const { routing, claimPolicy, canClaimRealtor, overdue } = result?.page ?? {};
  const currentView = view === "Shared realtor referrals" && !canClaimRealtor ? "All open" : view;
  const archive = currentView === "Archived";
  const shared = currentView === "Shared realtor referrals";
  const current = result?.view === currentView ? result : undefined;
  const page = current?.page;
  const currentDetails = details?.id === focused ? details : undefined;
  const selected = currentDetails?.lead;
  const reading = current?.version !== version || current?.retry !== retry;
  const readingDetails = !!focused && (currentDetails?.version !== version || currentDetails?.retry !== retry);

  useEffect(() => {
    let active = true;
    void readInboxWork({ type: "list", view: currentView }, brokerageId)
      .catch(() => ({ error: leadInboxUnavailable })).then((response) => {
        if (!active) return;
        setResult((previous) => ({ view: currentView, version, retry, ...("kind" in response && response.kind === "list" ?
          { page: response } : { page: previous?.view === currentView ? previous.page : undefined,
            error: "error" in response ? response.error : leadInboxUnavailable }) }));
      });
    return () => { active = false; };
  }, [brokerageId, currentView, version, retry]);

  useEffect(() => {
    if (!focused || archive || shared) return;
    let active = true;
    void readInboxWork({ type: "open", id: focused }, brokerageId)
      .catch(() => ({ error: leadWorkUnavailable })).then((response) => {
        if (!active) return;
        setDetails({ id: focused, version, retry, ...("kind" in response && response.kind === "open" ?
          { lead: response.lead } : { error: "error" in response ? response.error : leadWorkUnavailable }) });
      });
    return () => { active = false; };
  }, [brokerageId, focused, archive, shared, version, retry]);

  async function loadMore() {
    if (!current || !page?.next || loadingMore || reading) return;
    setLoadingMore(true);
    try {
      const response = await readInboxWork({ type: "list", view: currentView, after: page.next }, brokerageId)
        .catch(() => ({ error: leadInboxUnavailable }));
      setResult((latest) => {
        if (latest !== current) return latest;
        if (!("kind" in response) || response.kind !== "list") {
          return { ...current, error: "error" in response ? response.error : leadInboxUnavailable };
        }
        const leads = new Map(page.leads.map((lead) => [lead.id, lead]));
        for (const lead of response.leads) leads.set(lead.id, lead);
        return { ...current, error: undefined, page: { ...response, overdue: page.overdue, leads: [...leads.values()] } };
      });
    } finally {
      setLoadingMore(false);
    }
  }

  const visible = page?.leads ?? [];
  const rows = selected && !visible.some(({ id }) => id === selected.id) ? [selected, ...visible] : visible;
  return <section className="pipeline relationship-panel" aria-label="Lead inbox">
    <div className="section-heading"><h2>Quote requests and referrals</h2>
      {overdue != null && <span className={overdue ? "open-chip" : "pill"}>{overdue} overdue first contacts</span>}
    </div>
    <p className="muted">Work new prospects here before opening a loan. Overdue first contacts surface in Tasks.</p>
    {memberError && <p role="alert">{memberError}</p>}
    {routing && (!staff || members) && <RoutingForm key={`routing:${routing.revision}`} routing={routing} staff={staff} members={members ?? []}
      busy={busy} save={save} openOnEntry={openRouting} />}
    {brokerage && members && claimPolicy && <SharedRealtorPolicyForm key={`realtor-claim:${claimPolicy.revision}`}
      policy={claimPolicy} members={members} busy={busy} save={save} />}
    <div className="filter-row">
      <label className="field">Lead view<select value={currentView} onChange={(event) => setView(event.target.value as LeadInboxView)}>
        {leadInboxViews.filter((item) => (item !== "Mine" || staff) && (item !== "Shared realtor referrals" || canClaimRealtor))
          .map((item) => <option key={item}>{item}</option>)}</select></label>
      {!archive && !shared && <Button size="sm" variant="outline" disabled={busy || reading}
        onClick={() => setRetry((value) => value + 1)}>Refresh inbox</Button>}
    </div>
    {shared && staff ? <SharedRealtorQueueView key={brokerageId} brokerageId={brokerageId} busy={busy} claim={(leadId) => {
      void save({ type: "claimSharedRealtor", leadId }, () => { selectLead(leadId); setView("Mine"); });
    }} /> : archive ? <ArchivedLeads brokerageId={brokerageId} busy={busy} focusId={focusArchivedLeadId} restore={(lead) => {
      void save({ type: "restoreLead", leadId: lead.id, archiveToken: lead.archiveToken }, ({ restoredLeadId }) => {
        selectLead(restoredLeadId);
        setView("All open");
      });
    }} /> : <>
      {reading && <p className="muted" role="status">Loading leads…</p>}
      {current?.error && <p role="alert">{current.error}</p>}
      {readingDetails && !selected && <p className="muted" role="status">Opening lead details…</p>}
      {!readingDetails && currentDetails?.error && <p role="alert">{currentDetails.error}</p>}
      {rows.length > 0 ? <ul className="document-list">{rows.map((lead) => selected?.id === lead.id ?
        <LeadCard key={`${lead.id}:${selected.quoteOverridePolicy?.revision ?? "none"}`} lead={selected} staff={staff} members={members ?? []} now={now} busy={busy || readingDetails}
          focusTaskId={lead.id === focusLeadId ? focusTaskId : undefined} focusDocumentId={lead.id === focusLeadId ? focusDocumentId : undefined}
          save={save} convert={convert} openCampaign={openCampaign}
          openConversation={openConversation} close={() => selectLead()} /> :
        <li className="document-item" key={lead.id}>
          <LeadHeading lead={lead} now={now} />
          {staff?.brokerage.role === "LO" && !lead.officerEmail ?
            <Button size="sm" variant="outline" disabled={busy || reading} onClick={() => void save({
              type: "assignInboxLead", leadId: lead.id, email: staff.email, previousEmail: null,
            }, () => selectLead(lead.id))}>Claim lead</Button> :
            <Button size="sm" variant="outline" disabled={busy || reading} onClick={() => selectLead(lead.id)}>Work lead</Button>}
        </li>)}</ul> : page && !reading && <p className="empty-inline">No leads in this view.</p>}
      {page?.next && <div><Button size="sm" variant="outline" disabled={loadingMore || busy || reading} onClick={() => void loadMore()}>
        {loadingMore ? "Loading…" : `Load more leads · ${visible.length} shown`}
      </Button></div>}
    </>}
  </section>;
}

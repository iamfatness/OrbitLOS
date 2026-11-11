"use client";

import { useEffect, useRef, useState } from "react";
import { borrowerChannelBlocked } from "@/lib/borrower-channel-model";
import { scheduledBorrowerContactTime } from "@/lib/borrower-hours";
import { Phone, RefreshCw, Upload } from "lucide-react";
import { demoBrokerageId } from "@/lib/brokerage-model";
import { assignableCampaignLead, callOutcomes, campaignCallNote, campaignCallQueues, campaignFollowUpSource, campaignLeadExample, campaignOrigin, campaignRehearsalCsv, defaultCampaignRules, nextCampaignCallId, parseCampaignLeadCsv, sequenceReplacesFirstContact,
  type CallCampaign, type CallCampaignMember, type CallOutcome, type CampaignRehearsal } from "@/lib/call-campaign-model";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import type { CampaignManagerRecord } from "@/lib/campaign-manager-model";
import { firstContactOverdue } from "@/lib/lead-inbox-model";
import type { InboxLead, Workspace } from "@/lib/model";
import type { CampaignCallbackItem } from "@/lib/officer-queue-model";
import type { MigrationReport } from "@/lib/pipeline-migration-model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime, money } from "@/lib/utils";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";
import { CrmSegments } from "./crm-segments";
import { CampaignAssignments } from "./campaign-assignments";
import { sequenceWorkLabel } from "@/lib/campaign-sequence-model";
import { CampaignSequence, CampaignSequenceToggle } from "./campaign-sequence";
import { CampaignRouting, CampaignRoutingCapacity } from "./campaign-routing";
import { CampaignResponse } from "./campaign-response";
import { CampaignCallbackPerformance } from "./campaign-callback-performance";
import { CampaignManager } from "./campaign-manager";
import { LeadTasks, leadTaskTarget } from "./lead-tasks";
import { PersonalCampaignCallbacks } from "./personal-campaign-callbacks";
import { CampaignFollowUp } from "./campaign-follow-up";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void, announce?: boolean) => Promise<void>;
const campaignMetrics = ["Enrolled", "Reached", "1003s started", "1003s submitted", "Funded"] as const;
const views = [...campaignMetrics, "Unassigned", "First contact overdue", "Ready to call", "Next call", "Replies logged", "Scheduled follow-up", "Upcoming callbacks", "Retry limit reached", "Needs recovery", "On hold", "Opted out"] as const;
type CallContinuation = { leadId: string; campaignId: string; ownerEmail: string | null; view: (typeof views)[number]; segmentId: string };
function CampaignRulesForm({ campaign, canManage, busy, save }: { campaign: CallCampaign; canManage: boolean; busy: boolean; save: Save }) {
  const retryTime = campaign.retryTime ?? defaultCampaignRules.retryTime;
  const [hours, minutes] = retryTime.split(":");
  const hour = Number(hours);
  const retryLabel = `${hour % 12 || 12}:${minutes} ${hour < 12 ? "AM" : "PM"}`;
  return <details className="document-form">
    <summary>Campaign follow-up rules</summary>
    <p className="muted">New automatic retries are due at {retryLabel} Eastern on weekdays. Borrower-requested callbacks use the time you enter and follow the lead onto the loan when a 1003 starts.</p>
    {canManage && <div className="loan-application-actions"><span className="pill">New automatic retries {campaign.automaticPaused ? "paused" : "active"}</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "pauseCampaignRetries", campaignId: campaign.id,
        revision: campaign.revision, paused: !campaign.automaticPaused })}>
        {campaign.automaticPaused ? "Resume new automatic retries" : "Pause new automatic retries"}
      </Button>
    </div>}
    {canManage && <p className="muted">Scheduled tasks and borrower-requested callbacks stay active. After resuming, release held retries from Playbooks.</p>}
    {canManage ? <form className="record-form" key={campaign.revision} onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const retryTime = fields.get("retryTime");
      void save({ type: "saveCampaignRules", campaignId: campaign.id, revision: campaign.revision,
        voicemailDays: Number(fields.get("voicemailDays")), noResponseDays: Number(fields.get("noResponseDays")),
        maxAttempts: Number(fields.get("maxAttempts")), retryTime: typeof retryTime === "string" ? retryTime : undefined });
    }}>
      <div className="form-grid">
        <label className="field">Weekdays after voicemail<input name="voicemailDays" type="number" min={0} max={10} required defaultValue={campaign.voicemailDays} /></label>
        <label className="field">Weekdays after no answer<input name="noResponseDays" type="number" min={0} max={10} required defaultValue={campaign.noResponseDays} /></label>
        <label className="field">Automatic retry time (Eastern)<input name="retryTime" type="time" step={60} required defaultValue={retryTime} /></label>
        <label className="field">Stop automatic retries after this many calls<input name="maxAttempts" type="number" min={1} max={10} required defaultValue={campaign.maxAttempts} /></label>
      </div>
      <p className="muted">Use 0 to disable a retry rule. Changes apply when the next outcome is logged.</p>
      <div><Button size="sm" variant="outline" type="submit" disabled={busy}>Save follow-up rules</Button></div>
    </form> : <p className="muted">Voicemail retry {campaign.voicemailDays ? `in ${campaign.voicemailDays} weekdays` : "off"} ·
      No answer retry {campaign.noResponseDays ? `in ${campaign.noResponseDays} weekdays` : "off"} · Automatic retries stop after {campaign.maxAttempts} calls.</p>}
  </details>;
}

function CampaignImport({ campaign, staff, busy, save, rehearsal }: {
  campaign: CallCampaign; staff: WorkspaceStaff | null; busy: boolean; save: Save; rehearsal?: CampaignRehearsal;
}) {
  const buyerEmail = rehearsal?.buyerEmail;
  const [rows, setRows] = useState<ReturnType<typeof parseCampaignLeadCsv>>([]);
  const [assignToMe, setAssignToMe] = useState(!buyerEmail && !campaign.routing?.enabled);
  const [report, setReport] = useState<MigrationReport>();
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [imported, setImported] = useState(false);
  const [error, setError] = useState("");

  function load(csv: string) {
    setReport(undefined);
    setDecisions({});
    setImported(false);
    setError("");
    try { setRows(parseCampaignLeadCsv(csv, new Date().toISOString())); }
    catch (failure) { setRows([]); setError((failure as Error).message); }
  }

  function run(commit: boolean, reviewed = decisions) {
    void save({ type: "migratePipeline", origin: campaignOrigin(campaign.id), campaignId: campaign.id,
      rows: rows.map((row) => ({ ...row, ownerEmail: assignToMe ? staff?.email ?? "" : "" })), decisions: reviewed,
      preview: commit ? report?.fingerprint : undefined }, (result) => {
      setReport(result.migration);
      setDecisions(reviewed);
      setImported(commit);
    }, commit);
  }

  const flagged = report?.rows.filter((row) => row.status === "Review") ?? [];
  const ready = report?.rows.filter((row) => row.status === "Create").length ?? 0;
  const suppressed = report?.rows.filter((row) => row.status === "Suppressed").length ?? 0;
  return <section className="integration record-form manager-panel" aria-label="Import campaign leads">
    <div><h2>Import leads</h2><p className="muted">Upload a fictional CSV with name and phone. Email, purpose, ZIP, and source ID are optional.</p></div>
    <div className="loan-application-actions">
      <Button size="sm" variant="outline" onClick={() => load(rehearsal ? campaignRehearsalCsv : campaignLeadExample)} disabled={busy}>
        {rehearsal ? "Load rehearsal leads" : "Load sample leads"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => downloadSampleFile(campaignLeadExample, "orbit-call-campaign.csv", "text/csv")}>Download CSV template</Button>
    </div>
    <label className="field">Lead CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async (event) => {
      const file = event.currentTarget.files?.[0];
      if (file) load(file.size <= 200_000 ? await file.text() : " ".repeat(200_001));
    }} /></label>
    {buyerEmail && <p className="muted">The walkthrough buyer goes to {buyerEmail}. Review the owner shown on each row before importing.</p>}
    {staff && !buyerEmail && <label className="demo-confirm"><input type="checkbox" checked={assignToMe} disabled={busy} onChange={(event) => {
      setAssignToMe(event.target.checked); setReport(undefined); setImported(false);
    }} /> Assign imported leads to me</label>}
    {error && <p className="application-error" role="alert">{error}</p>}
    {rows.length > 0 && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => run(false)}>Preview {rows.length} leads</Button></div>}
    {report && <div className="record-form">
      <strong>{imported ? "Import complete" : `${ready} ready · ${flagged.length} need review`}{suppressed > 0 && ` · ${suppressed} suppressed`}</strong>
      <ul className="document-list">{report.rows.map((row) => <li className="document-item" key={row.key}>
        <div className="document-item-head"><strong>{row.label}</strong><span className={row.status === "Review" || row.status === "Suppressed" ? "open-chip" : "pill"}>{imported && row.status === "Create" ? "Enrolled" : row.status}</span></div>
        {row.detail && <small className="muted">{row.detail}{imported && row.campaignEnrollment?.owner &&
          ` · First contact due ${dateTime(row.campaignEnrollment.firstContactDueAt)} ET`}</small>}
        {row.campaignDuplicates?.map((match) => <div key={match.id} className="loan-application-actions">
          <span>{match.name} · {match.campaignName ? `Already in ${match.campaignName}` : match.canEnroll ? "Open lead" : "Unavailable for enrollment"}</span>
          {match.canEnroll && <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
            type: "addCampaignLead", campaignId: campaign.id, leadId: match.id,
          }, () => {
            setDecisions((current) => ({ ...current, [row.key]: "skip" }));
            setReport(undefined);
          })}>Add existing lead {match.name}</Button>}
        </div>)}
      </li>)}</ul>
      {imported && report.rows.some((row) => row.campaignEnrollment?.owner) && <p className="muted">
        Assigned officers can find first contacts in <strong>Today → Next 7 days</strong>.
      </p>}
      {!imported && <div className="loan-application-actions">
        {!!flagged.length && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(false, {
          ...decisions, ...Object.fromEntries(flagged.map((row) => [row.key, "skip"])),
        })}>Skip flagged leads and preview again</Button>}
        <Button size="sm" disabled={busy || !!flagged.length || ready === 0} onClick={() => run(true)}><Upload /> Import into campaign</Button>
      </div>}
    </div>}
  </section>;
}

function canStartCampaignApplication(member: CallCampaignMember, lead: InboxLead | undefined, staff: WorkspaceStaff | null): lead is InboxLead {
  return !!lead && (!staff || (!!lead.officerEmail && (staff.brokerage.role === "Admin" || lead.officerEmail === staff.email))) &&
    (member.lastOutcome === "Connected" || member.lastOutcome === "Requested callback") &&
    !member.resolvedAt && !member.loanId && !member.outreachSuppressed && !lead.heldAt && !lead.outreachSuppressed;
}

const applicationCallNotice = "campaign-application-call-notice";

function CampaignApplicationAction({ lead, busy, openLead, convert, focus = false }: {
  lead: InboxLead; busy: boolean; openLead: (id: string) => void; convert: (id: string) => void; focus?: boolean;
}) {
  const action = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);
  const reviewIntake = lead.intake?.answers.some(({ prefill }) => prefill !== null);
  useEffect(() => {
    if (!focus || busy || !action.current || focused.current) return;
    focused.current = true;
    action.current.focus({ preventScroll: true });
    action.current.scrollIntoView({ block: "center" });
  }, [focus, busy]);
  return <Button ref={action} size="sm" disabled={busy} aria-describedby={focus ? applicationCallNotice : undefined} onClick={() => {
    if (reviewIntake || (!lead.importedContactId && (lead.matches.length || lead.restrictedMatch))) openLead(lead.id);
    else convert(lead.id);
  }}>{reviewIntake ? "Review intake and start 1003" : "Start 1003"}</Button>;
}

function CampaignCallContext({ lead, member, campaignName }: { lead: InboxLead; member: CallCampaignMember; campaignName: string }) {
  const events = lead.followUp.events;
  const lastCall = events.find(({ kind }) => kind === "Call");
  const lastNote = lastCall ? campaignCallNote(lastCall, campaignName) : "";
  const { callbackDueAt, callbackPromise } = member;
  const request = callbackPromise && events.find(({ id, kind, outcome }) =>
    id === callbackPromise.requestEventId && kind === "Call" && outcome === "Requested callback");
  const requestNote = request && request.id !== lastCall?.id ? campaignCallNote(request, campaignName) : "";
  return <section className="campaign-call-context" aria-label="Call context">
    {callbackDueAt && <div>
      <strong>{member.lastOutcome === "Requested callback" ? "Borrower-requested callback" :
        member.lastOutcome === "Left message" || member.lastOutcome === "No response" ? "Automatic retry" : "Scheduled follow-up"}</strong>
      <p>Scheduled for <time dateTime={callbackDueAt}>{dateTime(callbackDueAt)} ET</time></p>
      {callbackPromise && callbackPromise.dueAt !== callbackDueAt &&
        <p>Promise deadline <time dateTime={callbackPromise.dueAt}>{dateTime(callbackPromise.dueAt)} ET</time></p>}
      {callbackPromise && callbackPromise.originalDueAt !== callbackDueAt && callbackPromise.originalDueAt !== callbackPromise.dueAt &&
        <p className="muted">First scheduled for <time dateTime={callbackPromise.originalDueAt}>{dateTime(callbackPromise.originalDueAt)} ET</time></p>}
      {requestNote && <p>Callback request note · {requestNote}</p>}
    </div>}
    <div>
      <strong>Last logged call</strong>
      {lastCall ? <>
        <p className="muted">{lastCall.outcome && `${lastCall.outcome} · `}<time dateTime={lastCall.at}>{dateTime(lastCall.at)} ET</time>
          {lastCall.actor && ` · ${lastCall.actor}`}</p>
        {lastNote ? <p>{lastNote}</p> : <p className="muted">No note recorded.</p>}
      </> : <p className="muted">No previous call recorded.</p>}
    </div>
  </section>;
}

function CampaignCall({ member, lead, campaign, staff, now, focused, focusTaskId, busy, overdue, callbackDue, showCallContext, allowDirectAssignment, save, openLead, openConversation, openToday, convert, onCallSaved, onClaim }: {
  member: CallCampaignMember; lead?: InboxLead; campaign: CallCampaign; staff: WorkspaceStaff | null; now: number; busy: boolean; save: Save;
  focused: boolean; focusTaskId?: string; overdue: boolean; callbackDue: boolean; showCallContext: boolean; allowDirectAssignment: boolean;
  openLead: (id: string) => void; openConversation: (id: string) => void; openToday: () => void; convert: (id: string) => void;
  onCallSaved: (lead: InboxLead, outcome: CallOutcome, updated: Workspace) => void;
  onClaim: (leadId: string) => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcome | "">("");
  const [assigning, setAssigning] = useState(false);
  const card = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!focused) return;
    const task = focusTaskId ? document.getElementById(leadTaskTarget(focusTaskId)) : null;
    const target = task ?? card.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: task ? "center" : "nearest" });
  }, [focused, focusTaskId]);
  const canWork = !staff || (!!lead?.officerEmail && (staff.brokerage.role === "Admin" || lead.officerEmail === staff.email));
  const followUp = lead && canWork && (!staff || staff.brokerage.pilot) ? campaignFollowUpSource(lead, member, now) : undefined;
  const optedOut = member.outreachSuppressed;
  const held = !!lead?.heldAt;
  const sequence = lead && !member.resolvedAt && !optedOut && !lead.followUp.replyReceivedAt ? member.sequence : undefined;
  const sequenceCallAt = lead?.outreachHours && sequence?.channel === "Call" && !sequence.paused ?
    scheduledBorrowerContactTime(sequence.dueAt, new Date(now).toISOString(), lead.outreachHours) : null;
  const callWait = sequenceCallAt && Date.parse(sequenceCallAt) > now ? sequenceCallAt : null;
  const canManageSequence = !staff || (staff.brokerage.pilot && staff.brokerage.role === "Admin");
  const retryExhausted = !!member.retryExhaustedAt && !lead?.followUp.replyReceivedAt;
  const shared = lead && !lead.officerEmail && !member.resolvedAt && !held && !optedOut;
  const directAssignment = allowDirectAssignment && shared && assignableCampaignLead(lead);
  const canClaim = staff && staff.brokerage.role !== "Processor" && shared && !lead.realtorId && assignableCampaignLead(lead);
  const rehearseFailure = (!staff ? process.env.NODE_ENV === "development" : staff.brokerage.pilot && staff.brokerage.role === "Admin") &&
    (outcome === "Requested callback" || (!campaign.automaticPaused && ((outcome === "Left message" && campaign.voicemailDays > 0) ||
      (outcome === "No response" && campaign.noResponseDays > 0)) && member.attempts + 1 < campaign.maxAttempts));
  const firstCallReady = campaignCallQueues([{ member, lead, optedOut }], now).firstCalls.length > 0;
  const nextWork = firstCallReady ? "Ready to call" : sequence ?
    (sequence.channel === "Call" && borrowerChannelBlocked(lead?.outreachChannelBlocks, "Call") ? "Calls blocked" : sequenceWorkLabel(sequence, now, callWait)) :
    borrowerChannelBlocked(lead?.outreachChannelBlocks, "Call") ? "Calls blocked" : member.lastOutcome || "No call scheduled";
  const stage = held ? "On hold" : optedOut ? "Opted out" : member.resolvedAt ? "Closed lead" :
    member.followUpRunStatus === "Paused" ? "Automatic retry paused" : member.followUpRunStatus === "Failed" ? "Follow-up needs recovery" :
      member.callbackDueAt ? (member.lastOutcome === "Requested callback" ? "Callback scheduled" : "Retry scheduled") :
        lead?.followUp.replyReceivedAt ? "Reply received" : retryExhausted ? "Retry limit reached" : nextWork;
  const badge = shared && !retryExhausted ? "Needs owner" : callbackDue ? (member.lastOutcome === "Requested callback" ? "Callback due" : "Retry due") : overdue ? "First contact overdue" : stage;
  return <li className="document-item campaign-lead" ref={card} tabIndex={-1}>
    <div className="document-item-head"><strong>{member.name}</strong><span className={overdue || callbackDue ? "open-chip" : "pill"}>{badge}</span></div>
    <p className="muted">{member.attempts} {member.attempts === 1 ? "call" : "calls"} logged{lead && ` · ${lead.officerEmail ? lead.officer : "Shared inbox"}`}
      {lead && (lead.officerEmail || shared) && !lead.followUp.firstContactAt && !lead.followUp.replyReceivedAt && !optedOut && !held &&
        !sequenceReplacesFirstContact(member.sequenceKind) &&
        ` · First contact due ${dateTime(lead.dueAt)} ET`}
      {!(showCallContext && canWork && !optedOut) && !member.resolvedAt && !held && member.callbackDueAt && ` · ${dateTime(member.callbackDueAt)} ET`}</p>
    {sequence && lead && <div className="loan-application-actions">
      <span className="muted">{member.sequenceKind} · {sequence.paused ? "Paused at step" : "Step"} {sequence.position + 1} · {sequence.title} · {dateTime(sequence.dueAt)} ET</span>
      {(!staff || lead.officerEmail === staff.email) && <Button size="sm" variant="ghost" onClick={openToday}>View sequence work in Today</Button>}
      {callWait && <span className="muted">Sequence call available {dateTime(callWait)} ET within preferred hours.</span>}
      {canManageSequence && !held && <CampaignSequenceToggle campaignId={campaign.id} leadId={lead.id} revision={lead.followUp.revision}
        paused={sequence.paused} busy={busy} save={save} />}
    </div>}
    {directAssignment && lead && <div className="record-form">
      <div><Button size="sm" variant="outline" disabled={busy} aria-expanded={assigning} onClick={() => setAssigning(!assigning)}>
        {assigning ? "Close assignment" : "Assign this lead"}
      </Button></div>
      {assigning && <CampaignAssignments campaignId={campaign.id} leads={[lead]} staff={staff} busy={busy} save={save}
        direct routingEnabled={campaign.routing?.enabled} />}
    </div>}
    {lead && (optedOut || held) && <div><Button size="sm" variant="ghost" onClick={() => openLead(lead.id)}>View lead activity</Button></div>}
    {lead && canWork && (staff || process.env.NODE_ENV === "development") && <div><Button size="sm" variant="outline" disabled={busy}
      data-conversation-origin={`lead:${lead.id}`} onClick={() => openConversation(lead.id)}>Open lead conversation</Button></div>}
    {lead && !optedOut && !held && <>
      <p>{lead.phone} · {lead.purpose}</p>
      {canWork ? <>
        {showCallContext && <CampaignCallContext lead={lead} member={member} campaignName={campaign.name} />}
        {member.lastOutcome === "Requested callback" && member.callbackDueAt &&
          <details className="document-form" key={member.callbackDueAt}>
            <summary>Reschedule callback</summary>
            <form className="record-form" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void save({ type: "rescheduleCampaignCallback", campaignId: campaign.id, leadId: lead.id, revision: lead.followUp.revision,
                callbackAt: new Date(String(data.get("callback"))).toISOString(), reason: data.get("reason") });
            }}>
              <label className="field">New callback time (your local time)<input name="callback" type="datetime-local" required /></label>
              <label className="field">Reason for rescheduling<input name="reason" maxLength={400} required /></label>
              <div><Button size="sm" type="submit" disabled={busy}>Save callback time</Button></div>
            </form>
          </details>}
        {borrowerChannelBlocked(lead.outreachChannelBlocks, "Call") ? <p className="muted">This borrower blocks calls.</p> : <form className="record-form" onSubmit={(event) => {
          event.preventDefault();
          if (!outcome) return;
          const form = event.currentTarget;
          const data = new FormData(form);
          const callback = String(data.get("callback") ?? "");
          void save({ type: "recordCampaignCall", campaignId: campaign.id, leadId: lead.id, revision: lead.followUp.revision,
            outcome, note: data.get("note"), callbackAt: outcome === "Requested callback" && callback ? new Date(callback).toISOString() : null,
            simulateFollowUpFailure: data.has("simulateFollowUpFailure") }, ({ state }) => {
            form.reset(); setOutcome("");
            onCallSaved(lead, outcome, state);
          });
        }}>
          <div className="form-grid">
            <label className="field">Call outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value as CallOutcome | "")} required>
              <option value="">Choose an outcome</option>{callOutcomes.map((value) => <option key={value}>{value}</option>)}
            </select></label>
            {outcome === "Requested callback" && <label className="field">Callback time (your local time)<input name="callback" type="datetime-local" required /></label>}
          </div>
          {outcome === "Opted out" && <p className="muted">Orbit stops campaign outreach on matching borrower records across the brokerage.</p>}
          <label className="field">Call note (optional)<input name="note" maxLength={400} /></label>
          {rehearseFailure && <details className="document-form"><summary>Rehearse campaign recovery</summary>
            <label className="demo-confirm"><input type="checkbox" name="simulateFollowUpFailure" /> Simulate a follow-up failure for this call</label>
          </details>}
          <div><Button size="sm" type="submit" variant="outline" disabled={busy || (!!callWait && outcome !== "Opted out")}><Phone /> Log call outcome</Button></div>
        </form>}
        {followUp && <CampaignFollowUp key={JSON.stringify([followUp.callEventId, followUp.callbackAt, lead.email, lead.phone, lead.officerEmail])}
          campaignId={campaign.id} lead={lead} source={followUp} busy={busy} save={save} openConversation={openConversation} />}
        <div className="loan-application-actions">
          {canStartCampaignApplication(member, lead, staff) && <CampaignApplicationAction lead={lead} busy={busy} openLead={openLead} convert={convert} />}
          <Button size="sm" variant="ghost" onClick={() => openLead(lead.id)}>Open lead</Button>
        </div>
      </> : canClaim ? <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
        type: "assignInboxLead", leadId: lead.id, email: staff.email, previousEmail: null,
      }, () => onClaim(lead.id))}>Claim lead</Button></div> : shared && <div><Button size="sm" variant="ghost" onClick={() => openLead(lead.id)}>Open lead inbox</Button></div>}
    </>}
    {lead && canWork && !member.resolvedAt && <LeadTasks lead={lead} busy={busy} save={save} showCampaignCallback={false} />}
  </li>;
}

export function CallCampaigns({ state, staff, selectedId, select, focusLeadId, focusTaskId, now, busy, save, openLead, openLoan, openConversation, openToday, openCallback, openManagerRecord, convert }: {
  state: Workspace; staff: WorkspaceStaff | null; selectedId: string; select: (id: string, alreadyLoaded?: boolean) => void; now: number; busy: boolean;
  focusLeadId?: string; focusTaskId?: string; save: Save; openLead: (id: string) => void; openLoan: (id: string) => void;
  convert: (id: string, after: () => void) => void;
  openConversation: (id: string) => void; openToday: () => void;
  openCallback: (item: CampaignCallbackItem) => void;
  openManagerRecord: (row: CampaignManagerRecord) => void;
}) {
  const [view, setView] = useState<(typeof views)[number]>("Enrolled");
  const [applicationCall, setApplicationCall] = useState<CallContinuation>();
  const [convertedCall, setConvertedCall] = useState<Omit<CallContinuation, "ownerEmail">>();
  const [savedCall, setSavedCall] = useState<CallContinuation & { callEventId: string }>();
  const [segmentFilter, setSegmentFilter] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [importOpen, setImportOpen] = useState(state.campaignRehearsal?.campaignId === selectedId && state.campaignRehearsal.importedCount < 2);
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [routingOpen, setRoutingOpen] = useState(false);
  const [performance, setPerformance] = useState<"response" | "callbacks" | "manager">();
  const [callbacksOpen, setCallbacksOpen] = useState(false);
  const [claimedLeadId, setClaimedLeadId] = useState<string>();
  const [callLeadId, setCallLeadId] = useState<string>();
  const attempt = useRef<{ id: string; name: string } | null>(null);
  const campaign = state.callCampaigns.find((entry) => entry.id === selectedId) ?? state.callCampaigns[0];
  const matchingCampaigns = state.callCampaigns.filter((entry) => entry.name.toLocaleLowerCase().includes(campaignSearch.trim().toLocaleLowerCase()));
  const canManage = !staff || (staff.brokerage.pilot === true && staff.brokerage.role === "Admin");
  const canReadManagerReports = canManage && (staff || process.env.NODE_ENV === "development");
  const inbox = new Map(state.inboxLeads.map((lead) => [lead.id, lead]));
  const enrolled = new Set(state.callCampaignMembers.map((entry) => entry.leadId));
  const available = canManage ? (state.campaignLeadOptions ?? state.inboxLeads.filter(assignableCampaignLead))
    .filter((lead) => !enrolled.has(lead.id)) : [];
  const campaignMembers = state.callCampaignMembers.filter((entry) => entry.campaignId === campaign?.id);
  const segmentChoices = new Map(campaignMembers.flatMap((member) =>
    member.segmentId && member.segmentName ? [[member.segmentId, member.segmentName] as const] : []));
  const segmentId = segmentChoices.has(segmentFilter) ? segmentFilter : "";
  const members = segmentId ? campaignMembers.filter((entry) => entry.segmentId === segmentId) : campaignMembers;
  const memberIds = new Set(members.map(({ leadId }) => leadId));
  const loans = new Map(state.loans.map((loan) => [loan.id, loan]));
  const applications = new Map(state.applications.map((application) => [application.loanId, application]));
  const closing = new Map(state.closingProgress.map((progress) => [progress.loanId, progress]));
  const refreshedFiles = new Map(state.campaignQueueFiles?.map((file) => [file.id, file]));
  const records = members.map((member) => {
    const lead = inbox.get(member.leadId);
    const refreshed = member.loanId ? refreshedFiles.get(member.loanId) : undefined;
    const loan = refreshed ?? (member.loanId ? loans.get(member.loanId) : undefined);
    const application = loan ? applications.get(loan.id) : undefined;
    // A correction can clear the current submission without erasing the campaign conversion.
    const submittedAt = refreshed ? refreshed.submittedAt : application?.versions.at(-1)?.submittedAt ?? application?.submittedAt;
    const fundingDate = refreshed ? refreshed.fundingDate : loan ? closing.get(loan.id)?.fundingDate : undefined;
    return { member, lead, loan, submittedAt, fundingDate, optedOut: member.outreachSuppressed };
  });
  const { dueCallbacks, upcomingCallbacks, firstCalls } = campaignCallQueues(records, now);
  const ready = [...dueCallbacks, ...firstCalls];
  const nextCall = callLeadId ? ready.find(({ member, lead, loan }) => member.leadId === callLeadId && !loan &&
    (!staff || lead?.officerEmail === staff.email)) : undefined;
  const scheduled = [...dueCallbacks, ...upcomingCallbacks];
  const dueCallbackIds = new Set(dueCallbacks.map(({ member }) => member.leadId));
  const overdue = records.filter(({ lead, member, optedOut }) =>
    lead?.officerEmail && !optedOut && !sequenceReplacesFirstContact(member.sequenceKind) && firstContactOverdue(lead, now))
    .sort((a, b) => a.lead!.dueAt.localeCompare(b.lead!.dueAt));
  const overdueIds = new Set(overdue.map(({ member }) => member.leadId));
  const unassigned = records.filter(({ lead, member, optedOut }) => lead && !member.resolvedAt && !member.retryExhaustedAt &&
    !lead.heldAt && !lead.officerEmail && !optedOut && !lead.outreachSuppressed);
  const buckets = {
    Enrolled: records,
    Reached: records.filter(({ member }) => member.reachedAt),
    "1003s started": records.filter(({ loan }) => loan),
    "1003s submitted": records.filter(({ submittedAt }) => submittedAt),
    Funded: records.filter(({ fundingDate }) => fundingDate),
    Unassigned: unassigned,
    "First contact overdue": overdue,
    "Ready to call": ready,
    "Next call": nextCall ? [nextCall] : [],
    "Replies logged": records.filter(({ lead }) => lead?.followUp.replyReceivedAt),
    "Scheduled follow-up": scheduled,
    "Upcoming callbacks": upcomingCallbacks,
    "Retry limit reached": records.filter(({ member, lead, optedOut }) => member.retryExhaustedAt && !member.resolvedAt &&
      !lead?.heldAt && !lead?.followUp.replyReceivedAt && !optedOut),
    "Needs recovery": records.filter(({ member, lead, optedOut }) => !member.resolvedAt && !lead?.heldAt && !optedOut && member.followUpRunStatus),
    "On hold": records.filter(({ lead }) => lead?.heldAt),
    "Opted out": records.filter(({ optedOut }) => optedOut),
  };
  const visible = buckets[view];
  const justConverted = convertedCall && convertedCall.campaignId === campaign?.id && convertedCall.view === view &&
    convertedCall.segmentId === segmentId && !visible.some(({ member }) => member.leadId === convertedCall.leadId) ?
    records.find(({ member, loan }) => member.leadId === convertedCall.leadId && loan) : undefined;
  const continuationFor = (call?: CallContinuation) => call && call.campaignId === campaign?.id && call.view === view && call.segmentId === segmentId &&
    !visible.some(({ member }) => member.leadId === call.leadId)
    ? records.find(({ member, lead }) => member.leadId === call.leadId && lead?.officerEmail === call.ownerEmail) : undefined;
  const continuation = continuationFor(applicationCall);
  const applicationLead = continuation && canStartCampaignApplication(continuation.member, continuation.lead, staff) ? continuation.lead : undefined;
  const scheduledApplicationCall = continuation?.member.lastOutcome === "Requested callback";
  const followUpRecord = continuationFor(savedCall);
  const followUpLead = followUpRecord?.lead;
  const followUp = followUpRecord && followUpLead && (!staff || (staff.brokerage.pilot && (staff.brokerage.role === "Admin" || staff.email === followUpLead.officerEmail)))
    ? campaignFollowUpSource(followUpLead, followUpRecord.member, now) : undefined;
  const followUpDraft = campaign && followUpLead && followUp && followUp.callEventId === savedCall?.callEventId &&
    <CampaignFollowUp key={JSON.stringify([followUp.callEventId, followUp.callbackAt, followUpLead.email, followUpLead.phone, followUpLead.officerEmail])}
      campaignId={campaign.id} lead={followUpLead} source={followUp} busy={busy} save={save} openConversation={openConversation} />;
  const assignmentLeads = visible.flatMap(({ lead, optedOut }) => lead && !optedOut && assignableCampaignLead(lead) ? [lead] : []);
  const showCapacity = canManage && view === "Unassigned" && campaign?.routing?.enabled;
  const routingLeads = showCapacity ? campaignMembers.flatMap((member) => {
    const lead = inbox.get(member.leadId);
    return lead && !member.resolvedAt && !member.retryExhaustedAt && !member.outreachSuppressed &&
      member.lastOutcome !== "Opted out" && assignableCampaignLead(lead) ? [lead] : [];
  }) : [];
  const fundedVolume = buckets.Funded.reduce((sum, { loan }) => sum + (loan?.amount ?? 0), 0);
  const fundedRate = members.length ? Math.round(buckets.Funded.length / members.length * 100) : 0;
  const fundedCohort = staff?.brokerage.role === "LO" ? "your visible campaign leads" :
    segmentId ? "enrolled leads in this segment" : "all enrolled campaign leads";
  const readyGroups = [
    { title: "Due callbacks", rows: dueCallbacks, empty: "No callbacks or retries are due." },
    { title: "First campaign calls", rows: firstCalls, empty: "No first calls are waiting." },
  ];
  const empty = !members.length ? "Import a lead list or add an existing lead to start the queue." : view === "Upcoming callbacks" ?
    "No upcoming callbacks." : view === "Scheduled follow-up" ? "No assigned callbacks or retries are scheduled." :
      view === "Unassigned" ? "No shared leads waiting for an owner." : view === "Retry limit reached" ?
        "No unanswered leads have reached the retry limit." : "No leads in this view.";

  function selectNextCall(snapshot: Workspace, completedLeadId?: string) {
    if (!campaign) return;
    setCallLeadId(nextCampaignCallId(snapshot, { campaignId: campaign.id, segmentId, officerEmail: staff?.email, now, completedLeadId }));
  }

  function changeView(next: typeof view) {
    if (next !== view) {
      setApplicationCall(undefined);
      setSavedCall(undefined);
      setConvertedCall(undefined);
    }
    setClaimedLeadId(undefined);
    if (next === "Next call") selectNextCall(state);
    else setCallLeadId(undefined);
    setView(next);
  }

  function changeCampaign(id: string, alreadyLoaded = false) {
    select(id, alreadyLoaded);
    setApplicationCall(undefined);
    setSavedCall(undefined);
    setConvertedCall(undefined);
    setClaimedLeadId(undefined);
    setCallLeadId(undefined);
    setView("Enrolled");
    setSegmentFilter("");
  }

  function startApplication(leadId: string) {
    if (!campaign) return;
    convert(leadId, () => setConvertedCall({ leadId, campaignId: campaign.id, view, segmentId }));
  }

  function renderRecord({ member, lead, loan, submittedAt, fundingDate }: (typeof records)[number]) {
    if (loan) return <li key={member.leadId} className="document-item">
      <div className="document-item-head"><strong>{member.name}</strong><span className="pill">{fundingDate ? "Funded" : submittedAt ? "1003 submitted" : "1003 started"}</span></div>
      <p className="muted">{loan.officer || "Unassigned"} · {fundingDate ? `Funded ${fundingDate} · ${money(loan.amount)}` : submittedAt ? `Submitted ${dateTime(submittedAt)} ET` : loan.stage}</p>
      <div><Button size="sm" variant="outline" onClick={() => openLoan(loan.id)}>Open loan</Button></div>
    </li>;
    return <CampaignCall key={member.leadId} member={member} lead={lead} campaign={campaign} staff={staff} now={now}
      focused={member.leadId === (view === "Next call" ? callLeadId : claimedLeadId ?? focusLeadId)} busy={busy}
      focusTaskId={view !== "Next call" && member.leadId === focusLeadId ? focusTaskId : undefined} overdue={overdueIds.has(member.leadId)} callbackDue={dueCallbackIds.has(member.leadId)}
      showCallContext={view === "Next call" || (member.leadId === focusLeadId && !!member.callbackDueAt)}
      allowDirectAssignment={canManage && view === "Unassigned"} save={save} openLead={openLead} openConversation={openConversation} openToday={openToday} convert={startApplication}
      onClaim={(leadId) => { changeView("Enrolled"); setClaimedLeadId(leadId); }}
      onCallSaved={(lead, outcome, updated) => {
        const anchor = { leadId: lead.id, campaignId: member.campaignId, ownerEmail: lead.officerEmail, view, segmentId };
        if (outcome === "Connected" || outcome === "Requested callback") setApplicationCall(anchor);
        const call = updated.inboxLeads.find(({ id }) => id === lead.id)?.followUp.events.find(({ kind }) => kind === "Call");
        setSavedCall(call && { ...anchor, callEventId: call.id });
        if (view === "Next call") selectNextCall(updated, lead.id);
      }} />;
  }

  return <div className="relationship-stack campaign-workspace">
    <section className="integration record-form manager-panel" aria-label="Call campaign selection">
      <div className="section-heading"><h2>Campaigns</h2><span className="pill">Manual call logging</span></div>
      <p className="muted">Work a list, schedule callbacks, and start a loan with the outreach history attached. Use fictional leads for the demo.</p>
      {staff && <details className="document-form" onToggle={(event) => setCallbacksOpen(event.currentTarget.open)}>
        <summary>My campaign callbacks</summary>
        {callbacksOpen && <PersonalCampaignCallbacks key={staff.email} brokerageId={staff.brokerage.id} version={state} busy={busy}
          openCallback={(item) => {
            if (!item.loanId) {
              setApplicationCall(undefined);
              setSavedCall(undefined);
              setConvertedCall(undefined);
              setView("Enrolled");
              setSegmentFilter("");
            }
            openCallback(item);
          }} />}
      </details>}
      {(state.callCampaigns.length > 8 || campaignSearch.length > 0) && <div className="record-form">
        <label className="field">Find a campaign<input type="search" value={campaignSearch} onChange={(event) => setCampaignSearch(event.target.value)} placeholder="Search campaign names" /></label>
        {campaignSearch.trim() && <div className="loan-application-actions"><span className="muted" role="status">
          {matchingCampaigns.length ? `${matchingCampaigns.length} matching campaigns` : "No matching campaigns. Your current campaign stays selected."}
        </span><Button size="sm" variant="ghost" onClick={() => setCampaignSearch("")}>Clear campaign search</Button></div>}
      </div>}
      {campaign && <label className="field">Call campaign<select value={campaign.id} disabled={busy} onChange={(event) => changeCampaign(event.target.value)}>
        {!matchingCampaigns.some(({ id }) => id === campaign.id) && <option value={campaign.id}>{campaign.name} · Current campaign</option>}
        {matchingCampaigns.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>}
      {campaign && <CampaignRulesForm key={campaign.id} campaign={campaign} canManage={canManage} busy={busy} save={save} />}
      {canManage && campaign?.sequenceConfig && <CampaignSequence key={`sequence-editor:${campaign.id}`}
        campaignId={campaign.id} config={campaign.sequenceConfig} busy={busy} save={save} />}
      {canManage ? <form className="brokerage-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const name = String(new FormData(form).get("name") ?? "").trim();
        if (!name) return;
        if (attempt.current?.name !== name) attempt.current = { id: crypto.randomUUID(), name };
        const id = attempt.current.id;
        void save({ type: "createCallCampaign", id, name }, () => { changeCampaign(id, true); setImportOpen(true); attempt.current = null; form.reset(); });
      }}>
        <label className="field">New campaign name<input name="name" maxLength={80} required placeholder="e.g. November purchase leads" /></label>
        <Button size="sm" type="submit" disabled={busy}>Create campaign</Button>
      </form> : !campaign && <p className="empty-inline">A pilot admin can create a campaign and add your leads.</p>}
      {canManage && <div className="loan-application-actions">
        <Button size="sm" variant="outline" aria-expanded={segmentsOpen} onClick={() => setSegmentsOpen(!segmentsOpen)}>Saved CRM segments</Button>
        {campaign && <Button size="sm" variant="outline" aria-expanded={routingOpen} onClick={() => setRoutingOpen(!routingOpen)}>Routing</Button>}
        {campaign && <Button size="sm" variant="outline" aria-expanded={importOpen} onClick={() => setImportOpen(!importOpen)}>
        {importOpen ? "Hide import" : "Import leads"}
        </Button>}
      </div>}
    </section>
    {canManage && segmentsOpen && <CrmSegments segments={state.crmSegments} campaign={campaign}
      brokerageId={staff?.brokerage.id ?? demoBrokerageId} busy={busy} save={save} />}
    {campaign && <>
      {canManage && routingOpen && <CampaignRouting key={`routing:${campaign.id}:${campaign.routing?.revision ?? 0}`} campaign={campaign} staff={staff} busy={busy} save={save} />}
      {canManage && importOpen && <CampaignImport key={`import:${campaign.id}:${campaign.routing?.revision ?? 0}`} campaign={campaign} staff={staff} busy={busy} save={save}
        rehearsal={state.campaignRehearsal?.campaignId === campaign.id ? state.campaignRehearsal : undefined} />}
      <section className="integration record-form manager-panel" aria-label="Campaign call queue">
        <div className="section-heading"><h2>{campaign.name}</h2><span className="pill">{members.reduce((sum, member) => sum + member.attempts, 0)} calls logged</span>
          <div className="loan-application-actions">
            <Button size="sm" disabled={busy || (view === "Next call" && !!nextCall)} onClick={() => changeView("Next call")}><Phone /> Next call</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "refreshCampaignQueue", campaignId: campaign.id })}><RefreshCw /> Refresh queue</Button>
          </div>
        </div>
        {segmentChoices.size > 0 && <label className="field">Filter campaign by segment
          <select value={segmentId} onChange={(event) => { changeView("Enrolled"); setSegmentFilter(event.target.value); }}>
            <option value="">All campaign leads</option>
            {[...segmentChoices].map(([id, name]) => <option value={id} key={id}>{name}</option>)}
          </select>
        </label>}
        <div className="campaign-metrics" role="group" aria-label="Campaign performance">
          {campaignMetrics.map((metric) => <button key={metric} type="button" aria-pressed={view === metric} onClick={() => changeView(metric)}>
            <span>{metric}</span><strong>{buckets[metric].length}</strong>
          </button>)}
        </div>
        <p className="muted">{fundedVolume ? money(fundedVolume) : "$0"} funded loan volume · {fundedRate}% of {fundedCohort} funded
          {" · "}{scheduled.length} assigned {scheduled.length === 1 ? "follow-up" : "follow-ups"} scheduled</p>
        <div className="loan-application-actions">
          <Button size="sm" variant="outline" aria-pressed={view === "Ready to call"} onClick={() => changeView("Ready to call")}>
            Ready to call · {buckets["Ready to call"].length}
          </Button>
          <Button size="sm" variant="outline" aria-pressed={view === "Unassigned"} onClick={() => changeView("Unassigned")}>Shared queue · {unassigned.length}</Button>
          <Button size="sm" variant="outline" aria-pressed={view === "Upcoming callbacks"} onClick={() => changeView("Upcoming callbacks")}>
            Upcoming callbacks · {upcomingCallbacks.length}
          </Button>
          {buckets["Retry limit reached"].length > 0 && <Button size="sm" variant="outline" aria-pressed={view === "Retry limit reached"}
            onClick={() => changeView("Retry limit reached")}>Retry limit reached · {buckets["Retry limit reached"].length}</Button>}
          {canManage && <>
            <Button size="sm" variant="outline" aria-pressed={view === "First contact overdue"} onClick={() => changeView("First contact overdue")}>
              {overdue.length} overdue for first contact
            </Button>
            <Button size="sm" variant="outline" aria-expanded={assignmentOpen} onClick={() => setAssignmentOpen(!assignmentOpen)}>Assign leads</Button>
            <Button size="sm" variant="outline" aria-expanded={performance === "response"} onClick={() => setPerformance(performance === "response" ? undefined : "response")}>Response performance</Button>
            {canReadManagerReports && <Button size="sm" variant="outline" aria-expanded={performance === "manager"}
              onClick={() => setPerformance(performance === "manager" ? undefined : "manager")}>Manager view</Button>}
            {canReadManagerReports && <Button size="sm" variant="outline" aria-expanded={performance === "callbacks"}
              onClick={() => setPerformance(performance === "callbacks" ? undefined : "callbacks")}>Callback performance</Button>}
          </>}
        </div>
        {canManage && performance === "response" && <CampaignResponse key={`${campaign.id}:${segmentId}`}
          records={state.campaignResponses.filter((record) => memberIds.has(record.leadId))} now={now} openLead={openLead} openLoan={openLoan} />}
        {canReadManagerReports && performance === "callbacks" && <CampaignCallbackPerformance key={`callback-report:${campaign.id}`}
          brokerageId={staff?.brokerage.id ?? demoBrokerageId} campaignId={campaign.id} version={state} />}
        {canReadManagerReports && performance === "manager" && <CampaignManager key={`manager-report:${campaign.id}`}
          brokerageId={staff?.brokerage.id ?? demoBrokerageId} campaignId={campaign.id} campaignName={campaign.name}
          version={state} busy={busy} save={save} openRecord={openManagerRecord} />}
        {canManage && assignmentOpen && <CampaignAssignments key={`${campaign.id}:${segmentId}:${view}`} campaignId={campaign.id} leads={assignmentLeads} staff={staff} busy={busy} save={save} />}
        {showCapacity && campaign.routing && <CampaignRoutingCapacity key={`routing-capacity:${campaign.id}`} campaignId={campaign.id}
          routing={campaign.routing} leads={routingLeads} staff={staff} busy={busy} save={save} />}
        {canManage && available.length > 0 && <form className="brokerage-form" key={campaign.id} onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void save({ type: "addCampaignLead", campaignId: campaign.id, leadId: data.get("leadId") }, () => form.reset());
        }}>
          <label className="field">Existing lead<select name="leadId" required defaultValue=""><option value="">Choose an open lead</option>
            {available.map((lead) => <option key={lead.id} value={lead.id}>{lead.name} · {lead.phone}</option>)}
          </select></label>
          <Button size="sm" type="submit" variant="outline" disabled={busy}>Add to campaign</Button>
        </form>}
        <label className="field">Call queue view<select value={view} disabled={busy} onChange={(event) => changeView(event.target.value as typeof view)}>
          {views.map((value) => <option key={value} value={value}>{value === "Unassigned" ? "Shared queue" : value}</option>)}
        </select></label>
        {view === "Unassigned" && <p className="muted">Claim or assign a shared lead before calling. Existing callback times stay with the lead.</p>}
        {view === "Retry limit reached" && <p className="muted">These leads keep their owner and call history. They no longer use an automatic routing slot, and you can still log a new call or a requested callback.</p>}
        {view === "Next call" && <p className="muted">Work your assigned leads one at a time. Due callbacks and retries go before first calls.</p>}
        {applicationLead && <div className="document-item" key={applicationLead.id}>
          <div className="document-item-head"><strong id={applicationCallNotice}>{scheduledApplicationCall ? "Callback scheduled for" : "Connected with"} {applicationLead.name}</strong><span className="pill">Call logged</span></div>
          {scheduledApplicationCall && <p className="muted">The scheduled callback will follow the loan if you start the 1003 now.</p>}
          <div><CampaignApplicationAction lead={applicationLead} busy={busy} openLead={openLead} convert={startApplication} focus={view !== "Next call" || !nextCall} /></div>
          {followUpLead?.id === applicationLead.id && followUpDraft}
        </div>}
        {followUpDraft && followUpLead?.id !== applicationLead?.id && <div className="document-item">
          <div className="document-item-head"><strong>Follow up with {followUpLead?.name}</strong><span className="pill">Call logged</span></div>
          {followUpDraft}
        </div>}
        {justConverted && <ul className="document-list" aria-label="Just converted">{renderRecord(justConverted)}</ul>}
        {view === "Next call" && !nextCall ? <p className="empty-inline" role="status">{callLeadId ?
          "This lead is no longer ready. Select Next call to continue." : "You’re caught up. No assigned calls are ready in this view."}</p> :
          view === "Ready to call" && members.length ? readyGroups.map((group) => <section key={group.title} className="document-section" aria-label={group.title}>
          <div className="section-heading"><h3>{group.title}</h3><span className="pill">{group.rows.length}</span></div>
          {group.rows.length ? <ul className="document-list">{group.rows.map(renderRecord)}</ul> : <p className="empty-inline">{group.empty}</p>}
        </section>) : visible.length ? <ul className="document-list">{visible.map(renderRecord)}</ul> : <p className="empty-inline">{empty}</p>}
      </section>
    </>}
  </div>;
}

"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { readConversationWork, saveConversationWork } from "@/app/actions";
import { staffSignInRequired } from "@/lib/brokerage-model";
import { dateLabel } from "@/lib/client-retention";
import { conversationChannels, conversationFilters, conversationsUnavailable, type ConversationCallback, type ConversationChange, type ConversationCursor, type ConversationDetail, type ConversationFocus,
  type ConversationInput, type ConversationQuery, type ConversationResult, type ConversationStartResponse } from "@/lib/conversation-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { useLeadOwners } from "./use-lead-owners";

type Start = Extract<ConversationInput, { type: "start" | "startLead" | "startContact" }>;
type ThreadAction = Exclude<ConversationInput, Start>;
type WithoutEvent<T> = T extends ThreadAction ? Omit<T, "eventId"> : never;
type Change = Start | WithoutEvent<ThreadAction>;

function ContactAssignment({ brokerageId, owner, saving, assign }: { brokerageId: string; owner: string; saving: boolean; assign: (email: string) => void }) {
  const { members, error } = useLeadOwners(brokerageId);
  const replacements = members?.filter((member) => member.email !== owner);
  if (error) return <p className="muted" role="status">{error}</p>;
  if (!replacements?.length) return null;
  return <details className="document-form">
    <summary>Reassign contact conversation</summary>
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      assign(String(new FormData(event.currentTarget).get("email") ?? ""));
    }}>
      <label className="field">New conversation owner<select name="email" defaultValue="" required>
        <option value="">Choose an active staff member</option>
        {replacements.map((member) => <option key={member.email} value={member.email}>{member.name} ({member.role})</option>)}
      </select></label>
      <div><Button size="sm" variant="outline" type="submit" disabled={saving}>Assign conversation</Button></div>
    </form>
  </details>;
}

function ConversationControls({ thread, saving, change }: { thread: ConversationDetail; saving: boolean; change: (action: Change, after?: () => void) => void }) {
  const canLogOutbound = !thread.leadId && !thread.outreachBlocked && !thread.held;
  const [chosenKind, setKind] = useState<"Outbound" | "Inbound" | "Note">(canLogOutbound ? "Outbound" : "Inbound");
  const kind = !canLogOutbound && chosenKind === "Outbound" ? "Inbound" : chosenKind;
  const action = { id: thread.id, revision: thread.revision };
  const replacements = thread.ownerOptions.filter((owner) => owner.role !== thread.ownerRole);
  return <div className="record-form">
    <div className="loan-application-actions">
      {thread.unread && <Button size="sm" variant="outline" disabled={saving} onClick={() => change({ ...action, type: "read" })}>Mark read</Button>}
      <Button size="sm" variant="outline" disabled={saving} onClick={() => change({ ...action, type: "sampleReply" })}>Simulate sample reply</Button>
      <Button size="sm" variant="ghost" disabled={saving} onClick={() => change({ ...action, type: "resolve", closed: thread.status !== "Closed" })}>
        {thread.status === "Closed" ? "Reopen conversation" : "Close conversation"}
      </Button>
    </div>
    {thread.status !== "Closed" && <form className="record-form" key={thread.dueOn ?? "no-follow-up"} onSubmit={(event) => {
      event.preventDefault();
      const dueOn = String(new FormData(event.currentTarget).get("dueOn") ?? "");
      change({ ...action, type: "followUp", dueOn: dueOn || null });
    }}>
      <label className="field">Follow-up date (ET)<input type="date" name="dueOn" defaultValue={thread.dueOn ?? ""} required disabled={thread.held || thread.outreachBlocked} /></label>
      <div className="loan-application-actions">
        <Button size="sm" type="submit" disabled={saving || thread.held || thread.outreachBlocked}>Save follow-up date</Button>
        {thread.dueOn && <Button size="sm" variant="ghost" disabled={saving} onClick={() => change({ ...action, type: "followUp", dueOn: null })}>Clear follow-up</Button>}
      </div>
    </form>}
    {replacements.map((owner) => <div key={owner.role}>
      <Button size="sm" variant="outline" disabled={saving} onClick={() => change({ ...action, type: "assign", ownerRole: owner.role })}>Hand off to {owner.role.toLowerCase()}</Button>
      <small className="muted"> {owner.name}</small>
    </div>)}
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const text = String(values.get("text") ?? "");
      const channel = values.get("channel") as (typeof conversationChannels)[number];
      change(kind === "Note" ? { ...action, type: "note", text } : { ...action, type: "message", direction: kind, channel, text }, () => form.reset());
    }}>
      <div className="form-grid">
        <label className="field">Entry type<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          {canLogOutbound && <option value="Outbound">Log outbound contact</option>}<option value="Inbound">Log incoming reply</option><option value="Note">Internal note</option>
        </select></label>
        {kind !== "Note" && <label className="field">Channel<select name="channel">
          {conversationChannels.map((channel) => <option key={channel}>{channel}</option>)}
        </select></label>}
      </div>
      <label className="field">{kind === "Note" ? "Staff-only note" : "Activity summary"}<textarea name="text" required maxLength={1200} rows={3} /></label>
      <p className="muted">{kind === "Note" ? "Internal notes stay in the staff workspace." : kind === "Inbound" && thread.leadId ?
        "Logging an incoming reply stops automatic outreach for this lead and keeps any borrower-requested callback." :
        "Record a call, email, or text that already happened in the staff activity log."}</p>
      <div><Button size="sm" type="submit" disabled={saving}>{kind === "Note" ? "Save internal note" : kind === "Inbound" ? "Log reply" : "Log outreach"}</Button></div>
    </form>
  </div>;
}

export function ConversationQueue({ brokerageId, signedIn, team, version, focus, setFocus, openLoan, openLead, openCallback, openPipeline, openInbox, openContacts }: {
  brokerageId: string; signedIn: boolean; team: boolean; version: object; focus: ConversationFocus | null;
  setFocus: (value: ConversationFocus | null) => void; openLoan: (id: string) => void; openPipeline: () => void;
  openLead: (id: string) => void; openCallback: (callback: ConversationCallback) => void; openInbox?: () => void; openContacts?: () => void;
}) {
  const [query, setQuery] = useState<Extract<ConversationQuery, { type: "list" }>>({ type: "list", filter: "Active", mine: !team });
  const [eventPage, setEventPage] = useState<{ focus: ConversationFocus; after: ConversationCursor }>();
  const after = eventPage?.focus === focus ? eventPage?.after : undefined;
  const setAfter = (cursor?: ConversationCursor) => setEventPage(focus && cursor ? { focus, after: cursor } : undefined);
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const attempt = useRef<{ key: string; eventId: string } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const outcome = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (feedback) outcome.current?.focus();
  }, [feedback]);
  const context = useRef<{ brokerageId: string; focus: ConversationFocus | null; version: object }>(null);
  const [data, setData] = useState<{ query: typeof query; version: object; refresh: number; result: ConversationResult }>();
  const [history, setHistory] = useState<{ focus: ConversationFocus; after: typeof after; version: object; refresh: number; result: ConversationResult }>();
  const current = data?.query === query && data.version === version && data.refresh === refresh ? data.result : undefined;
  const list = current && "kind" in current && current.kind === "list" ? current : undefined;
  const selected = history?.focus === focus && history?.after === after && history.version === version && history.refresh === refresh ? history.result : undefined;
  const thread = selected && "kind" in selected && selected.kind === "thread" ? selected : undefined;
  const newThread = selected && "kind" in selected && selected.kind === "new" ? selected : undefined;

  const listReady = useEffectEvent(() => !!current);
  const detailReady = useEffectEvent(() => !!selected);
  useLayoutEffect(() => {
    context.current = { brokerageId, focus, version };
    return () => { context.current = null; };
  }, [brokerageId, focus, version]);

  useEffect(() => {
    if (listReady()) return;
    let active = true;
    const update = (result: ConversationResult) => { if (active) setData({ query, version, refresh, result }); };
    void readConversationWork(query, brokerageId).then(update, () => update({ error: "Could not load the conversations. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, query, version, refresh]);

  useEffect(() => {
    if (!focus || detailReady()) return;
    let active = true;
    const input = "id" in focus ? { type: "thread", id: focus.id, after } : "leadId" in focus ? { type: "lead", ...focus } :
      "loanId" in focus ? { type: "loan", ...focus } : { type: "contact", ...focus };
    const update = (result: ConversationResult) => { if (active) setHistory({ focus, after, version, refresh, result }); };
    void readConversationWork(input, brokerageId).then(update, () => update({ error: "Could not open the conversation. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, focus, after, version, refresh]);

  useEffect(() => {
    if (focus) panel.current?.focus();
  }, [focus]);

  function select(next: ConversationFocus | null) {
    setAfter(undefined);
    setFeedback(undefined);
    setFocus(next);
  }

  async function change(action: Change, afterSave?: () => void) {
    if (saving) return;
    setSaving(true);
    setFeedback(undefined);
    try {
      const key = JSON.stringify(action);
      if (attempt.current?.key !== key) attempt.current = { key, eventId: crypto.randomUUID() };
      const starting = action.type === "start" || action.type === "startLead" || action.type === "startContact";
      let result: ConversationChange | ConversationStartResponse;
      if (starting && signedIn) {
        const response = await fetch(`/api/conversation-start?brokerage=${encodeURIComponent(brokerageId)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: action, queue: { filter: query.filter, mine: query.mine } }),
        });
        result = response.headers.get("content-type")?.includes("application/json") ? await response.json() as ConversationStartResponse :
          { error: response.status === 401 ? staffSignInRequired : conversationsUnavailable };
      } else result = await saveConversationWork(starting ? action : { ...action, eventId: attempt.current.eventId }, brokerageId);
      const latest = context.current;
      if (latest?.brokerageId !== brokerageId || latest.focus !== focus) return;
      if ("error" in result) { setFeedback({ error: true, text: result.error }); return; }
      attempt.current = null;
      afterSave?.();
      const nextFocus = !focus || !("id" in focus) ? { id: result.id } : focus;
      const nextQuery = { ...query, after: undefined };
      const nextRefresh = refresh + 1;
      if (nextFocus !== focus) select(nextFocus);
      setAfter(undefined);
      if (result.opened) setHistory({ focus: nextFocus, after: undefined, version: latest.version, refresh: nextRefresh, result: result.opened });
      if ("queue" in result && result.queue) setData({ query: nextQuery, version: latest.version, refresh: nextRefresh, result: result.queue });
      setQuery(nextQuery);
      setRefresh(nextRefresh);
      setFeedback({ error: false, text: result.message });
    } catch {
      setFeedback({ error: true, text: "Could not reach Orbit. Try again." });
    } finally { setSaving(false); }
  }

  return <section className="integration record-form manager-panel" aria-label="Shared communications queue">
    <div className="section-heading"><h2>Conversations</h2>{list && <span className="pill">Checked {dateTime(list.checkedAt)} ET</span>}</div>
    <p className="muted">Work conversations for leads, loan files, and standalone contacts. Staff share the unread and reply state. History labels distinguish manual activity, campaign calls, and simulated replies.</p>
    <div className="loan-application-actions">
      <label className="field">Conversation status<select value={query.filter} disabled={saving} onChange={(event) => setQuery({ ...query, filter: event.target.value as typeof query.filter, after: undefined })}>
        {conversationFilters.map((filter) => <option key={filter}>{filter}</option>)}
      </select></label>
      <label className="field">Ownership<select value={query.mine ? "mine" : "all"} disabled={saving} onChange={(event) => setQuery({ ...query, mine: event.target.value === "mine", after: undefined })}>
        <option value="all">{team ? "Team conversations" : "All accessible conversations"}</option><option value="mine">My conversations</option>
      </select></label>
      <Button size="sm" variant="outline" disabled={saving} onClick={() => { setAfter(undefined); setRefresh((last) => last + 1); }}>Refresh conversations</Button>
    </div>
    {focus && <section ref={panel} tabIndex={-1} className="work-queue record-form" aria-label="Conversation detail">
      <div className="section-heading"><h3>{thread?.thread.name ?? newThread?.name ?? "Conversation detail"}</h3>
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => select(null)}>Close details</Button></div>
      {!selected && <p className="muted" role="status">Loading conversation…</p>}
      {selected && "error" in selected && <p role="alert">{selected.error}</p>}
      {feedback && <p ref={outcome} tabIndex={-1} className="crm-preview-summary" role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      {newThread && <>
        <p className="muted">{"leadId" in newThread.subject ? newThread.convertedLoan ? "Borrower · Converted loan" : "Lead" : "loanId" in newThread.subject ?
          `${newThread.subject.audience} · ${newThread.loanName}’s loan` : `${newThread.subject.audience} · Contact conversation`} · {newThread.owner}</p>
        <div><Button size="sm" disabled={saving} onClick={() => void change("leadId" in newThread.subject ?
          { type: "startLead", ...newThread.subject } : "loanId" in newThread.subject ?
            { type: "start", ...newThread.subject } : { type: "startContact", contactId: newThread.subject.contactId })}>Start conversation</Button></div>
      </>}
      {thread && <>
        <p className="muted">{thread.thread.leadId ? "Lead" : thread.thread.loanId ? `${thread.thread.audience} · ${thread.thread.loanName}’s loan` :
          `${thread.thread.audience} · Contact conversation`} · {thread.thread.owner} · {thread.thread.missedCall ? "Missed call" : thread.thread.status}
          {thread.thread.unread && " · Unread"}{thread.thread.dueOn && ` · Follow up ${dateLabel(thread.thread.dueOn)}`}
          {thread.thread.outreachBlocked && " · Outreach opted out"}{thread.thread.held && " · On hold"}</p>
        <div>{thread.thread.loanId && <Button size="sm" variant="outline" onClick={() => openLoan(thread.thread.loanId!)}>Open linked loan</Button>}
          {thread.thread.leadId && <Button size="sm" variant="outline" onClick={() => openLead(thread.thread.leadId!)}>Open linked lead</Button>}</div>
        {thread.thread.campaignCallback && <div className="loan-application-actions">
          <span>Promised callback · {dateTime(thread.thread.campaignCallback.dueAt)} ET</span>
          {thread.thread.canOpenCampaignCallback && !thread.thread.held && !thread.thread.outreachBlocked && <Button size="sm" variant="outline" disabled={saving}
            onClick={() => openCallback(thread.thread.campaignCallback!)}>Open promised callback</Button>}
        </div>}
        {thread.thread.leadId && <p className="muted">Log outbound contact on the linked lead or in its call campaign to keep first-contact reporting in sync.</p>}
        {team && thread.thread.contactOwnerEmail && <ContactAssignment key={thread.thread.contactOwnerEmail} brokerageId={brokerageId}
          owner={thread.thread.contactOwnerEmail} saving={saving}
          assign={(email) => void change({ type: "assignContact", id: thread.thread.id, revision: thread.thread.revision, email })} />}
        {thread.thread.canManage ? <ConversationControls key={thread.thread.id} thread={thread.thread} saving={saving} change={(input, callback) => void change(input, callback)} /> :
          <p className="muted">This conversation is managed by {thread.thread.owner}.</p>}
        <h4>Conversation history</h4>
        {thread.events.length ? <ul className="loan-task-list">{thread.events.map((event) => <li key={event.id} className="document-item record-form">
          <strong>{event.kind === "State" ? "Status or ownership update" : event.kind === "Note" ? "Internal note" :
            event.kind === "Inbound" && event.channel === "Call" && event.origin === "Simulated" ? "Missed call" : `${event.kind} ${event.channel}`}</strong>
          <small className="muted">{event.origin} · {event.actor} · {dateTime(event.at)} ET</small>
          <p className="whitespace-pre-wrap break-words">{event.text}</p>
        </li>)}</ul> : <p className="empty-inline">No entries yet.</p>}
        {(after || thread.next) && <div className="loan-application-actions">
          {after && <Button size="sm" variant="outline" onClick={() => setAfter(undefined)}>Newest entries</Button>}
          {thread.next && <Button size="sm" variant="outline" onClick={() => setAfter(thread.next ?? undefined)}>Older entries</Button>}
        </div>}
      </>}
    </section>}
    {!current && <p role="status" className="muted">Loading conversations…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {list && (list.rows.length ? <ul className="loan-task-list">{list.rows.map((row) => <li key={row.id} className="document-item record-form">
      <div className="document-item-head"><strong>{row.name}</strong><span className="pill">{row.missedCall ? "Missed call" : row.status}{row.unread && " · Unread"}</span></div>
      <p className="muted">{row.leadId ? "Lead" : row.loanId ? `${row.audience} · ${row.loanName}’s loan` : `${row.audience} · Contact conversation`} · {row.owner}
        {row.dueOn && ` · Follow up ${dateLabel(row.dueOn)}`}{row.outreachBlocked && " · Outreach opted out"}{row.held && " · On hold"}</p>
      <div><Button size="sm" variant="outline" disabled={saving} onClick={() => select({ id: row.id })}>Open conversation</Button></div>
    </li>)}</ul> : <div className="record-form"><p className="empty-inline">No conversations match these filters. Start one from {openContacts ? "a contact, lead, or loan" : "a loan"}.</p>
      <div className="loan-application-actions">{openInbox && <Button size="sm" variant="outline" onClick={openInbox}>Open lead inbox</Button>}
        {openContacts && <Button size="sm" variant="outline" onClick={openContacts}>Open contacts</Button>}
        <Button size="sm" variant="outline" onClick={openPipeline}>Open pipeline</Button></div></div>)}
    <div className="loan-application-actions">
      {query.after && <Button size="sm" variant="outline" disabled={saving} onClick={() => setQuery({ ...query, after: undefined })}>First conversation page</Button>}
      {list?.next && <Button size="sm" variant="outline" disabled={saving} onClick={() => setQuery({ ...query, after: list.next ?? undefined })}>Next conversation page</Button>}
    </div>
  </section>;
}

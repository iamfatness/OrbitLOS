"use client";

import { useEffect, useRef, useState } from "react";
import { readInboundReplyWork, saveInboundReplyWork } from "@/app/actions";
import { inboundReplyChannels, inboundReplyLabel, inboundReplyStatuses, type InboundMatch, type InboundReplyInput,
  type InboundReplyQuery, type InboundReplyResult } from "@/lib/inbound-replies-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type ReplyDetail = Extract<InboundReplyResult, { kind: "reply" }>;
type ListQuery = Extract<InboundReplyQuery, { type: "list" }>;
type MatchCursor = Extract<InboundReplyQuery, { type: "reply" }>["after"];
const matchKey = (match: InboundMatch) => JSON.stringify(match.kind === "contact" ? [match.kind, match.contactId] :
  match.kind === "lead" ? [match.kind, match.leadId] : [match.kind, match.loanId, match.audience]);

function ReplyReview({ detail, busy, more, change, openConversation }: {
  detail: ReplyDetail; busy: boolean; more: boolean; change: (input: InboundReplyInput) => void; openConversation: (id: string) => void;
}) {
  const { reply, matches, next, indexing } = detail;
  const label = reply.channel === "Call" ? "missed call" : "reply";
  const [choice, setChoice] = useState("");
  const selected = matches.find((item) => matchKey(item) === choice);
  const singleKind = matches[0]?.kind;
  return <>
    <p className="muted break-words">{reply.sender} · {dateTime(reply.at)} ET · {reply.status}</p>
    <p className="whitespace-pre-wrap break-words">{reply.text}</p>
    {reply.conversationId && <div><Button size="sm" disabled={busy} onClick={() => reply.conversationId && openConversation(reply.conversationId)}>Open linked conversation</Button></div>}
    {reply.status === "Pending" && <>
      {indexing ? <p role="status">Preparing the sender index for existing leads. Choose Refresh inbound review to continue.</p> : matches.length ? <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        if (!selected) return;
        const receipt = { id: reply.id, revision: reply.revision };
        if (selected.kind === "lead") change({ type: "attachLead", ...receipt, leadId: selected.leadId });
        else if (selected.kind === "contact") change({ type: "attachContact", ...receipt, contactId: selected.contactId });
        else change({ type: "attach", ...receipt, loanId: selected.loanId, contactId: selected.contactId, audience: selected.audience });
      }}>
        <fieldset className="record-form">
          <legend>{more || next || matches.length > 1 ? "Multiple possible matches" : `One possible ${singleKind} match`}</legend>
          {matches.length > 1 && <p className="muted">Choose the record this {label} belongs to. Choose the contact for a conversation between loans.</p>}
          {matches.map((match) => <label key={matchKey(match)} className="document-item record-form">
            <span className="demo-confirm"><input type="radio" name="match" value={matchKey(match)} checked={choice === matchKey(match)}
              onChange={() => setChoice(matchKey(match))} /><strong>{match.kind === "contact" ? `Contact · ${match.name} · ${match.role}` :
              `${match.kind === "lead" ? `Lead · ${match.name}` : `Loan · ${match.borrower}`} · ${match.purpose} · ${match.stage}`}</strong></span>
            <span className="muted">{match.kind === "contact" ? match.owner ?? "Starts a new contact conversation" : <>
              {match.kind === "lead" ? `${match.source} · ${match.owner}` : `${match.audience} ${match.name} · ${match.address || "Address pending"}`}
              {` · Created ${dateTime(match.createdAt)} ET`}</>}</span>
          </label>)}
        </fieldset>
        <div><Button size="sm" type="submit" disabled={!selected || busy}>Attach {label} to {selected?.kind ?? (matches.length === 1 ? singleKind : "record")}</Button></div>
      </form> : <p className="empty-inline">{more ? "No more current matches." :
        "No contact, open lead, or loan participant matches this sender. Update the record and refresh, or dismiss the event."}</p>}
      <div><Button size="sm" variant="ghost" disabled={busy}
        onClick={() => change({ type: "dismiss", id: reply.id, revision: reply.revision })}>Dismiss {label}</Button></div>
    </>}
    <details className="document-form">
      <summary>Source event details</summary>
      <p className="muted break-all">Source ID {reply.sourceId}{reply.replayCount > 0 && ` · ${reply.replayCount} duplicate ${reply.replayCount === 1 ? "replay" : "replays"}`}</p>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => change({
        type: "simulate", channel: reply.channel, sender: reply.sender, sourceId: reply.sourceId, text: reply.text,
      })}>Replay source event</Button>
    </details>
  </>;
}

export function InboundReplyQueue({ brokerageId, openConversation }: { brokerageId: string; openConversation: (id: string) => void }) {
  const [query, setQuery] = useState<ListQuery>({ type: "list", status: "Pending" });
  const [selected, setSelected] = useState("");
  const [matchAfter, setMatchAfter] = useState<MatchCursor>();
  const [sampleId, setSampleId] = useState("");
  const [channel, setChannel] = useState<(typeof inboundReplyChannels)[number]>("Email");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const panel = useRef<HTMLElement>(null);
  const focusOrigin = useRef<HTMLElement>(null);
  const simulator = useRef<HTMLDetailsElement>(null);
  const statusFilter = useRef<HTMLSelectElement>(null);
  const [data, setData] = useState<{ query: ListQuery; refresh: number; result: InboundReplyResult }>();
  const [detail, setDetail] = useState<{ id: string; after: MatchCursor; refresh: number; result: InboundReplyResult }>();
  const current = data?.query === query && data.refresh === refresh ? data.result : undefined;
  const currentDetail = detail?.id === selected && detail.after === matchAfter && detail.refresh === refresh ? detail.result : undefined;
  const list = current && "kind" in current && current.kind === "list" ? current : undefined;
  const reply = currentDetail && "kind" in currentDetail && currentDetail.kind === "reply" ? currentDetail : undefined;

  useEffect(() => {
    let active = true;
    const update = (result: InboundReplyResult) => { if (active) setData({ query, refresh, result }); };
    void readInboundReplyWork(query, brokerageId).then(update, () => update({ error: "Could not load inbound review. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, query, refresh]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const update = (result: InboundReplyResult) => { if (active) setDetail({ id: selected, after: matchAfter, refresh, result }); };
    void readInboundReplyWork({ type: "reply", id: selected, after: matchAfter }, brokerageId)
      .then(update, () => update({ error: "Could not open the inbound event. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, selected, matchAfter, refresh]);

  useEffect(() => {
    if (selected) panel.current?.focus();
  }, [selected]);

  async function change(input: InboundReplyInput, fromSimulator = false) {
    if (busy) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await saveInboundReplyWork(input, brokerageId);
      if ("error" in result) {
        setFeedback({ error: true, text: result.error });
        if (input.type === "attach" || input.type === "attachLead" || input.type === "attachContact") {
          setMatchAfter(undefined);
          setRefresh((last) => last + 1);
        }
        return;
      }
      if (fromSimulator && simulator.current) simulator.current.open = false;
      setSelected(result.id);
      setMatchAfter(undefined);
      setQuery((last) => ({ ...last, after: undefined }));
      setRefresh((last) => last + 1);
      setFeedback({ error: false, text: result.message });
    } catch {
      setFeedback({ error: true, text: "Could not reach Orbit. Try again." });
    } finally { setBusy(false); }
  }

  return <section className="integration record-form manager-panel" aria-label="Inbound review">
    <h2>Inbound review</h2>
    <p className="muted">Route simulated replies and missed calls to the right contact, lead, or loan.</p>
    <details className="document-form" ref={simulator}>
      <summary>Simulate an inbound event</summary>
      <div className="record-form">
        <div><Button size="sm" variant="outline" onClick={() => { setChannel("Email"); setSampleId(crypto.randomUUID()); }}>Load campaign example</Button></div>
        <form className="record-form" key={sampleId} onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          focusOrigin.current = simulator.current?.querySelector("summary") ?? null;
          const text = values.get("text");
          void change({ type: "simulate", channel, sourceId: String(values.get("sourceId")),
            sender: String(values.get("sender")), ...(typeof text === "string" ? { text } : {}) }, true);
        }}>
          <div className="form-grid">
            <label className="field">Event type<select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}>
              {inboundReplyChannels.map((option) => <option value={option} key={option}>{inboundReplyLabel(option)}</option>)}</select></label>
            <label className="field">Source event ID<input name="sourceId" maxLength={100} required defaultValue={sampleId ? `campaign-reply:${sampleId}` : ""} /></label>
            <label className="field">{channel === "Email" ? "Fictional sender email" : "Fictional caller or sender phone"}<input name="sender" maxLength={254} required
              inputMode={channel === "Email" ? "email" : "tel"}
              defaultValue={sampleId ? "jordan-campaign-rehearsal@example.test" : ""} /></label>
          </div>
          {channel !== "Call" && <label className="field">Fictional reply<textarea name="text" rows={3} maxLength={1200} required
            defaultValue={sampleId ? "Thanks for the update. When can we talk about my mortgage options?" : ""} /></label>}
          <div><Button size="sm" type="submit" disabled={busy}>Queue simulated {channel === "Call" ? "missed call" : "reply"}</Button></div>
        </form>
      </div>
    </details>
    {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {selected && <section ref={panel} tabIndex={-1} className="work-queue record-form" aria-label="Inbound event details">
      <div className="section-heading"><h3>{reply ? `Review ${inboundReplyLabel(reply.reply.channel).toLowerCase()}` : "Review inbound event"}</h3>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
          setSelected(""); setFeedback(undefined);
          (focusOrigin.current?.isConnected ? focusOrigin.current : statusFilter.current)?.focus();
        }}>Close review</Button></div>
      {!currentDetail && <p role="status" className="muted">Loading inbound event…</p>}
      {currentDetail && "error" in currentDetail && <p role="alert">{currentDetail.error}</p>}
      {reply && <>
        <ReplyReview key={`${reply.reply.id}:${reply.reply.revision}:${JSON.stringify(matchAfter ?? null)}`} detail={reply} busy={busy}
          more={!!matchAfter} change={(input) => void change(input)} openConversation={openConversation} />
        {(matchAfter || reply.next) && <div className="loan-application-actions">
          {matchAfter && <Button size="sm" variant="outline" onClick={() => setMatchAfter(undefined)}>First matches page</Button>}
          {reply.next && <Button size="sm" variant="outline" onClick={() => setMatchAfter(reply.next ?? undefined)}>Next matches page</Button>}
        </div>}
      </>}
    </section>}
    <div className="loan-application-actions">
      <label className="field">Review status<select ref={statusFilter} value={query.status} onChange={(event) => setQuery({ type: "list", status: event.target.value as ListQuery["status"] })}>
        {inboundReplyStatuses.map((status) => <option key={status}>{status}</option>)}
      </select></label>
      <Button size="sm" variant="outline" onClick={() => setRefresh((last) => last + 1)}>Refresh inbound review</Button>
    </div>
    {!current && <p role="status" className="muted">Loading inbound events…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {list && (list.rows.length ? <ul className="loan-task-list">{list.rows.map((row) => <li className="document-item record-form" key={row.id}>
      <div className="document-item-head"><strong>{inboundReplyLabel(row.channel)}</strong><span className="pill">{row.status}</span></div>
      <p className="muted break-all">{row.sender} · {dateTime(row.at)} ET{row.replayCount > 0 && ` · Duplicate replays ${row.replayCount}`}</p>
      <div><Button size="sm" variant="outline" disabled={busy} onClick={(event) => {
        focusOrigin.current = event.currentTarget;
        setSelected(row.id); setMatchAfter(undefined); setFeedback(undefined);
      }}>Open review</Button></div>
    </li>)}</ul> : <p className="empty-inline">No inbound events in this view.</p>)}
    <div className="loan-application-actions">
      {query.after && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: undefined })}>Newest inbound events</Button>}
      {list?.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: list.next ?? undefined })}>Older inbound events</Button>}
    </div>
  </section>;
}

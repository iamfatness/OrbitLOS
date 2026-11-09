"use client";

import { useEffect, useRef, useState } from "react";
import { readInboundReplyWork, saveInboundReplyWork } from "@/app/actions";
import { inboundReplyChannels, inboundReplyStatuses, type InboundMatch, type InboundReplyInput,
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
  const [choice, setChoice] = useState("");
  const selected = matches.find((item) => matchKey(item) === choice);
  const singleKind = matches[0]?.kind;
  return <>
    <p className="muted">{reply.channel} · {reply.sender} · Received {dateTime(reply.at)} ET · {reply.status}</p>
    <p className="muted">Source ID {reply.sourceId}{reply.replayCount > 0 && ` · ${reply.replayCount} duplicate ${reply.replayCount === 1 ? "replay" : "replays"}`}</p>
    <p className="whitespace-pre-wrap break-words">{reply.text}</p>
    <div className="loan-application-actions">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => change({
        type: "simulate", channel: reply.channel, sender: reply.sender, sourceId: reply.sourceId, text: reply.text,
      })}>Replay source event</Button>
      {reply.conversationId && <Button size="sm" disabled={busy} onClick={() => reply.conversationId && openConversation(reply.conversationId)}>Open linked conversation</Button>}
      {reply.status === "Pending" && <Button size="sm" variant="ghost" disabled={busy}
        onClick={() => change({ type: "dismiss", id: reply.id, revision: reply.revision })}>Dismiss reply</Button>}
    </div>
    {reply.status === "Pending" && <>
      {indexing ? <p role="status">Preparing the sender index for existing leads. Choose Refresh replies to continue.</p> : matches.length ? <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        if (!selected) return;
        const receipt = { id: reply.id, revision: reply.revision };
        if (selected.kind === "lead") change({ type: "attachLead", ...receipt, leadId: selected.leadId });
        else if (selected.kind === "contact") change({ type: "attachContact", ...receipt, contactId: selected.contactId });
        else change({ type: "attach", ...receipt, loanId: selected.loanId, contactId: selected.contactId, audience: selected.audience });
      }}>
        <fieldset className="record-form">
          <legend>{more || next || matches.length > 1 ? "Multiple possible matches" : `One possible ${singleKind} match`}</legend>
          <p className="muted">Choose the record this reply is about. Use the contact for relationship outreach between loans.</p>
          {matches.map((match) => <label key={matchKey(match)} className="document-item record-form">
            <span className="demo-confirm"><input type="radio" name="match" value={matchKey(match)} checked={choice === matchKey(match)}
              onChange={() => setChoice(matchKey(match))} /><strong>{match.kind === "contact" ? `Contact · ${match.name} · ${match.role}` :
              `${match.kind === "lead" ? `Lead · ${match.name}` : `Loan · ${match.borrower}`} · ${match.purpose} · ${match.stage}`}</strong></span>
            <span className="muted">{match.kind === "contact" ? match.owner ?? "Starts a new contact conversation" : <>
              {match.kind === "lead" ? `${match.source} · ${match.owner}` : `${match.audience} ${match.name} · ${match.address || "Address pending"}`}
              {` · Created ${dateTime(match.createdAt)} ET`}</>}</span>
          </label>)}
        </fieldset>
        <div><Button size="sm" type="submit" disabled={!selected || busy}>Attach reply to selected {selected?.kind ?? (matches.length === 1 ? singleKind : "record")}</Button></div>
      </form> : <p className="empty-inline">{more ? "No more current matches." :
        "No contact, open lead, or loan participant matches this sender. Review again after updating the record, or dismiss the reply."}</p>}
    </>}
  </>;
}

export function InboundReplyQueue({ brokerageId, openConversation }: { brokerageId: string; openConversation: (id: string) => void }) {
  const [query, setQuery] = useState<ListQuery>({ type: "list", status: "Pending" });
  const [selected, setSelected] = useState("");
  const [matchAfter, setMatchAfter] = useState<MatchCursor>();
  const [sampleId, setSampleId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const panel = useRef<HTMLElement>(null);
  const [data, setData] = useState<{ query: ListQuery; refresh: number; result: InboundReplyResult }>();
  const [detail, setDetail] = useState<{ id: string; after: MatchCursor; refresh: number; result: InboundReplyResult }>();
  const current = data?.query === query && data.refresh === refresh ? data.result : undefined;
  const currentDetail = detail?.id === selected && detail.after === matchAfter && detail.refresh === refresh ? detail.result : undefined;
  const list = current && "kind" in current && current.kind === "list" ? current : undefined;
  const reply = currentDetail && "kind" in currentDetail && currentDetail.kind === "reply" ? currentDetail : undefined;

  useEffect(() => {
    let active = true;
    const update = (result: InboundReplyResult) => { if (active) setData({ query, refresh, result }); };
    void readInboundReplyWork(query, brokerageId).then(update, () => update({ error: "Could not load the reply queue. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, query, refresh]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const update = (result: InboundReplyResult) => { if (active) setDetail({ id: selected, after: matchAfter, refresh, result }); };
    void readInboundReplyWork({ type: "reply", id: selected, after: matchAfter }, brokerageId)
      .then(update, () => update({ error: "Could not open the reply. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, selected, matchAfter, refresh]);

  useEffect(() => {
    if (selected) panel.current?.focus();
  }, [selected]);

  async function change(input: InboundReplyInput) {
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
      setSelected(result.id);
      setMatchAfter(undefined);
      setQuery((last) => ({ ...last, after: undefined }));
      setRefresh((last) => last + 1);
      setFeedback({ error: false, text: result.message });
    } catch {
      setFeedback({ error: true, text: "Could not reach Orbit. Try again." });
    } finally { setBusy(false); }
  }

  return <section className="integration record-form manager-panel" aria-label="Simulated reply review">
    <h2>Inbound reply review</h2>
    <p className="muted">Queue a fictional email or text and verify the contact, lead, or loan before attaching it. Replaying a source event keeps one receipt.</p>
    <details className="document-form">
      <summary>Simulate an inbound reply</summary>
      <div className="record-form">
        <div><Button size="sm" variant="outline" onClick={() => setSampleId(crypto.randomUUID())}>Load campaign example</Button></div>
        <p className="muted">The sample uses the buyer from the CSV to repeat loan demo. Import the demo CSV to match the open lead. Run through funding and repeat application to see both candidate loans.</p>
        <form className="record-form" key={sampleId} onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void change({ type: "simulate", channel: values.get("channel") as (typeof inboundReplyChannels)[number],
            sourceId: String(values.get("sourceId")), sender: String(values.get("sender")), text: String(values.get("text")) });
        }}>
          <div className="form-grid">
            <label className="field">Channel<select name="channel">{inboundReplyChannels.map((channel) => <option key={channel}>{channel}</option>)}</select></label>
            <label className="field">Source event ID<input name="sourceId" maxLength={100} required defaultValue={sampleId ? `campaign-reply:${sampleId}` : ""} /></label>
            <label className="field">Fictional sender email or phone<input name="sender" maxLength={254} required
              defaultValue={sampleId ? "jordan-campaign-rehearsal@example.test" : ""} /></label>
          </div>
          <label className="field">Fictional reply<textarea name="text" rows={3} maxLength={1200} required
            defaultValue={sampleId ? "Thanks for the update. When can we talk about my mortgage options?" : ""} /></label>
          <div><Button size="sm" type="submit" disabled={busy}>Queue simulated reply</Button></div>
        </form>
      </div>
    </details>
    {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    {selected && <section ref={panel} tabIndex={-1} className="work-queue record-form" aria-label="Reply detail">
      <div className="section-heading"><h3>Review reply</h3>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setSelected(""); setFeedback(undefined); }}>Close reply</Button></div>
      {!currentDetail && <p role="status" className="muted">Loading reply…</p>}
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
      <label className="field">Reply status<select value={query.status} onChange={(event) => setQuery({ type: "list", status: event.target.value as ListQuery["status"] })}>
        {inboundReplyStatuses.map((status) => <option key={status}>{status}</option>)}
      </select></label>
      <Button size="sm" variant="outline" onClick={() => setRefresh((last) => last + 1)}>Refresh replies</Button>
    </div>
    {!current && <p role="status" className="muted">Loading replies…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {list && (list.rows.length ? <ul className="loan-task-list">{list.rows.map((row) => <li className="document-item record-form" key={row.id}>
      <div className="document-item-head"><strong>{row.sender}</strong><span className="pill">{row.status}</span></div>
      <p className="muted">{row.channel} · {dateTime(row.at)} ET{row.replayCount > 0 && ` · Duplicate replays ${row.replayCount}`}</p>
      <div><Button size="sm" variant="outline" disabled={busy} onClick={() => { setSelected(row.id); setMatchAfter(undefined); setFeedback(undefined); }}>Open reply</Button></div>
    </li>)}</ul> : <p className="empty-inline">No replies in this view.</p>)}
    <div className="loan-application-actions">
      {query.after && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: undefined })}>First replies page</Button>}
      {list?.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: list.next ?? undefined })}>Next replies page</Button>}
    </div>
  </section>;
}

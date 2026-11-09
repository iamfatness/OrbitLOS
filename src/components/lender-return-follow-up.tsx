"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { logLenderReturnFollowUp } from "@/app/actions";
import { manualReturnChannels, manualReturnFollowUpNoteLimit, manualReturnParties, type ManualReturnAssignment,
  type ManualReturnFollowUp } from "@/lib/lender-export-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function lenderReturnFollowUpLabel(followUp: ManualReturnFollowUp) {
  return `Last follow-up · ${followUp.party} · ${followUp.channel} · ${followUp.actor} · ${dateTime(followUp.at)} ET`;
}

export function LenderReturnFollowUp({ brokerageId, loanId, name, lenderReturn, latest, paused, onSaved }: {
  brokerageId: string; loanId: string; name: string; lenderReturn: ManualReturnAssignment;
  latest?: ManualReturnFollowUp; paused: boolean; onSaved: () => void;
}) {
  const formId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const attempt = useRef<{ key: string; id: string }>(null);
  const sending = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  function close() {
    attempt.current = null;
    setExpanded(false);
    toggle.current?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (paused || sending.current) return;
    const fields = new FormData(event.currentTarget);
    const values = { party: fields.get("party"), channel: fields.get("channel"), note: String(fields.get("note") ?? "").trim() };
    if (!values.note) { setFeedback({ text: "Enter the outcome of your follow-up.", error: true }); return; }
    const key = JSON.stringify(values);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    sending.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await logLenderReturnFollowUp({ ...lenderReturn, ...values, loanId, entryId: attempt.current.id }, brokerageId);
      if ("error" in result) { setFeedback({ text: result.error, error: true }); return; }
      close();
      setFeedback({ text: "Follow-up logged in loan activity." });
      onSaved();
    } catch {
      setFeedback({ text: "Could not confirm the follow-up. Try saving again.", error: true });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const label = latest ? "Log another follow-up" : "Log follow-up";
  return <>
    <div className="loan-application-actions"><Button ref={toggle} size="sm" variant="outline" aria-expanded={expanded}
      aria-controls={expanded ? formId : undefined} aria-label={`${label} for ${name}`} disabled={paused} onClick={() => {
        if (busy) return;
        setFeedback(undefined);
        if (expanded) close();
        else setExpanded(true);
      }}>{label}</Button></div>
    {expanded && <form id={formId} className="record-form" onSubmit={submit} aria-label={`Log lender return follow-up for ${name}`}>
      <p className="muted">Internal activity only. Use fictional details for the demo.</p>
      <label className="field">Who did you contact?<select name="party" defaultValue="" required disabled={busy || paused}>
        <option value="" disabled>Choose a contact</option>
        {manualReturnParties.map((party) => <option key={party}>{party}</option>)}
      </select></label>
      <label className="field">Channel<select name="channel" defaultValue="" required disabled={busy || paused}>
        <option value="" disabled>Choose a channel</option>
        {manualReturnChannels.map((channel) => <option key={channel}>{channel}</option>)}
      </select></label>
      <label className="field">Outcome<textarea name="note" placeholder="What happened and what happens next?" rows={2}
        maxLength={manualReturnFollowUpNoteLimit} required disabled={busy || paused} /></label>
      <div className="loan-application-actions">
        <Button size="sm" type="submit" disabled={busy || paused}>{busy ? "Saving…" : "Save follow-up"}</Button>
        <Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => { setFeedback(undefined); close(); }}>Cancel</Button>
      </div>
    </form>}
    {feedback && <p className={feedback.error ? "" : "muted"} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
  </>;
}

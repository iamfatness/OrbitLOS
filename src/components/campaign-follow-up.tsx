"use client";

import { useRef, useState } from "react";
import { borrowerChannelBlocked } from "@/lib/borrower-channel-model";
import { campaignFollowUpRecipient, renderCampaignFollowUp, type campaignFollowUpSource } from "@/lib/call-campaign-model";
import { draftChannels } from "@/lib/communication-templates";
import type { DraftChannel, InboxLead } from "@/lib/model";
import { Button } from "./ui/button";

export function CampaignFollowUp({ campaignId, lead, source, busy, save, openConversation }: {
  campaignId: string;
  lead: InboxLead;
  source: NonNullable<ReturnType<typeof campaignFollowUpSource>>;
  busy: boolean;
  save: (input: unknown, after?: () => void) => Promise<void>;
  openConversation: (leadId: string) => void;
}) {
  const channels = draftChannels.filter((channel) => campaignFollowUpRecipient(channel, lead) && !borrowerChannelBlocked(lead.outreachChannelBlocks, channel));
  const [chosen, setChannel] = useState<DraftChannel>(channels[0] ?? "Email");
  const [edits, setEdits] = useState<Partial<Record<DraftChannel, { subject: string; body: string }>>>({});
  const [recorded, setRecorded] = useState<DraftChannel[]>([]);
  const attempt = useRef<{ signature: string; id: string } | undefined>(undefined);
  const { callEventId, outcome, callbackAt } = source;
  const channel = channels.includes(chosen) ? chosen : channels[0];
  if (!channel) return null;
  const recipient = campaignFollowUpRecipient(channel, lead);
  const draft = edits[channel] ?? renderCampaignFollowUp(outcome, channel, lead.name, lead.officer, callbackAt);
  const done = recorded.includes(channel);
  if (!recipient) return null;
  return <details className="document-form">
    <summary>Preview follow-up draft</summary>
    <form className="record-form" aria-label={`Mock follow-up for ${lead.name}`} onSubmit={(event) => {
      event.preventDefault();
      const signature = JSON.stringify([channel, recipient, draft.subject.trim(), draft.body.trim()]);
      if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
      void save({ type: "recordCampaignFollowUp", campaignId, leadId: lead.id, callEventId, callbackAt,
        revision: lead.followUp.revision, eventId: attempt.current.id, channel, recipient, ...draft }, () => {
        setRecorded((prior) => [...prior, channel]);
      });
    }}>
      <p className="muted">Mock delivery only. Orbit records the reviewed message in the lead conversation.</p>
      <label className="field">Follow-up channel<select value={channel} disabled={busy}
        onChange={(event) => setChannel(event.target.value as DraftChannel)}>
        {channels.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <p>Demo recipient · {recipient}</p>
      {channel === "Email" && <label className="field">Email subject<input required maxLength={120} value={draft.subject}
        disabled={busy || done} onChange={(event) => setEdits({ ...edits, [channel]: { ...draft, subject: event.target.value } })} /></label>}
      <label className="field">Draft message<textarea required maxLength={1200} rows={4} value={draft.body} disabled={busy || done}
        onChange={(event) => setEdits({ ...edits, [channel]: { ...draft, body: event.target.value } })} /></label>
      <Button size="sm" variant="outline" type="submit" disabled={busy || done || !draft.body.trim() || (channel === "Email" && !draft.subject.trim())}>
        Record mock {channel.toLowerCase()}
      </Button>
      {done && <div className="loan-application-actions">
        <p role="status">Mock {channel.toLowerCase()} recorded.</p>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => openConversation(lead.id)}>View conversation</Button>
      </div>}
    </form>
  </details>;
}

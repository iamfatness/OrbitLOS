"use client";

import { useState } from "react";
import { borrowerChannelBits, borrowerChannelBlocked, borrowerChannels } from "@/lib/borrower-channel-model";
import { Button } from "./ui/button";

const labels = { Call: "Accepts calls", Email: "Accepts email", Text: "Accepts texts" };

export function BorrowerChannelPreferences({ target, recordId, blocked = 0, optedOut, busy, save }: {
  target: "lead" | "contact"; recordId: string; blocked?: number; optedOut?: boolean;
  busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  return <details className="document-form" aria-label="Borrower contact preferences">
    <summary>Contact preferences</summary>
    <PreferenceForm key={`${recordId}:${blocked}`} target={target} recordId={recordId} blocked={blocked}
      optedOut={optedOut} busy={busy} save={save} />
  </details>;
}

function PreferenceForm({ target, recordId, blocked, optedOut, busy, save }: {
  target: "lead" | "contact"; recordId: string; blocked: number; optedOut?: boolean;
  busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const [draft, setDraft] = useState(blocked);
  return <form className="record-form" onSubmit={(event) => {
    event.preventDefault();
    void save({ type: "saveBorrowerChannels", target, recordId, expected: blocked, blocked: draft });
  }}>
    <p className="muted">{optedOut ? "The brokerage-wide outreach opt-out is active." : "Sequences skip channels the borrower blocks. Email and text are simulated."}</p>
    <fieldset className="loan-application-actions borrower-channel-options" disabled={busy || optedOut}>
      <legend>Outreach channels</legend>
      {borrowerChannels.map((channel) => <label className="demo-confirm" key={channel}>
        <input type="checkbox" checked={!optedOut && !borrowerChannelBlocked(draft, channel)}
          onChange={(event) => {
            const accepts = event.target.checked;
            setDraft((current) => accepts ? current & ~borrowerChannelBits[channel] : current | borrowerChannelBits[channel]);
          }} />{labels[channel]}
      </label>)}
    </fieldset>
    {!optedOut && <div><Button size="sm" type="submit" disabled={busy || draft === blocked}>Save contact preferences</Button></div>}
  </form>;
}

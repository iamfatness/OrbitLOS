"use client";

import { useState } from "react";
import { michiganApplicationChannels, michiganBookletAuthority, michiganBookletGuidance, michiganBookletMethods,
  type MichiganBookletReview, type reviewMichiganBooklet } from "@/lib/michigan-booklet-review";
import type { TridEntry } from "@/lib/trid-model";

export function MichiganBookletFields() {
  const [documented, setDocumented] = useState(false);
  return <>
    <p>Record the Michigan application event for one applicant. Enter local times when supported by the evidence.</p>
    <div className="form-grid items-start">
      <label className="field">Michigan booklet scope<select name="bookletScope">
        <option>Unresolved</option><option>Covered application for review</option>
      </select></label>
      <label className="field">Application channel<select name="applicationChannel" defaultValue="Other or unresolved">
        {michiganApplicationChannels.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label className="field">Michigan application date<input name="on" type="date" required /></label>
      <label className="field">Application local time (optional)<input name="localTime" type="time" /></label>
    </div>
    <label className="compliance-choice"><input type="checkbox" name="bookletDocumented" checked={documented}
      onChange={event => setDocumented(event.target.checked)} /> Booklet delivery is documented</label>
    {documented && <div className="form-grid items-start">
      <label className="field">Booklet provided on<input name="bookletOn" type="date" required /></label>
      <label className="field">Delivery local time (optional)<input name="bookletTime" type="time" /></label>
      <label className="field">Provided by<select name="bookletProvider" defaultValue="Other or unresolved">
        <option>Broker</option><option>Lender</option><option>Other or unresolved</option>
      </select></label>
      <label className="field">Delivery method<select name="bookletMethod" defaultValue="Other or unresolved">
        {michiganBookletMethods.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label className="field">Booklet version reference<textarea name="bookletEdition" rows={2} maxLength={180} required /></label>
      <label className="field">Delivery evidence reference<textarea name="bookletReference" rows={2} maxLength={180} required /></label>
    </div>}
  </>;
}

export function MichiganBookletEvidence({ event }: { event: MichiganBookletReview }) {
  const delivery = event.delivery;
  return <>
    <p>Recorded scope · {event.applicability}</p>
    <p>Application · {event.channel} · {event.on}{event.localTime && ` ${event.localTime}`}</p>
    <p className="muted">Application evidence · {event.reference}</p>
    {delivery && <>
      <p>Booklet · {delivery.provider} · {delivery.method} · {delivery.on}{delivery.localTime && ` ${delivery.localTime}`}</p>
      <p>Version · {delivery.edition}</p>
      <p className="muted">Delivery evidence · {delivery.reference}</p>
    </>}
  </>;
}

export function MichiganBookletResult({ active, review }: {
  active: readonly TridEntry[];
  review: ReturnType<typeof reviewMichiganBooklet>;
}) {
  const event = active.find(entry => entry.sequence === review?.sequence)?.event;
  return <details className="details-section">
    <summary className="min-h-11 content-center">Michigan application booklet</summary>
    <p>Review the recorded application and booklet delivery under Michigan’s Consumer Mortgage Protection Act.</p>
    <p><a className="underline" href={michiganBookletAuthority} target="_blank" rel="noreferrer">MCL 445.1636</a>
      {" · "}<a className="underline" href={michiganBookletGuidance} target="_blank" rel="noreferrer">DIFS guidance</a></p>
    {review && event?.type === "miBookletReview" ? <div className="document-item">
      <div className="min-w-0 break-words">
        <strong>{review.chronology}</strong>
        <MichiganBookletEvidence event={event} />
        {review.issues.length > 0 && <ul>{review.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        <p className="muted">Counsel review remains pending for the scope, timing and booklet used.</p>
      </div>
    </div> : <p>No Michigan booklet evidence recorded.</p>}
  </details>;
}

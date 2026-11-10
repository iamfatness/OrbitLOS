"use client";

import { useState } from "react";
import { campaignSequenceKinds, defaultCampaignSequenceSteps, sequenceChannels,
  type CampaignSequenceConfig, type CampaignSequenceKind, type CampaignSequenceStep } from "@/lib/campaign-sequence-model";
import { Button } from "./ui/button";

export function CampaignSequenceToggle({ campaignId, leadId, revision, paused, busy, save }: {
  campaignId: string; leadId: string; revision: number; paused: boolean; busy: boolean;
  save: (input: unknown) => Promise<void>;
}) {
  return <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
    type: "changeCampaignSequence", campaignId, leadId, revision, action: paused ? "Resume" : "Pause",
  })}>{paused ? "Resume sequence" : "Pause sequence"}</Button>;
}

export function CampaignSequence({ campaignId, config, busy, save }: {
  campaignId: string; config: CampaignSequenceConfig; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const [kind, setKind] = useState<CampaignSequenceKind>(config.attachedKind ?? "New Lead");
  const audience = kind === "Cold Lead Reactivation" ? "Use Quiet leads in Saved CRM segments, or import a prepared CSV." :
    kind === "Past Client Outreach" ? "Use Past clients or Past clients at rate target in Saved CRM segments, or import a prepared CSV." :
      "Use a CSV import to enroll new leads.";
  return <details className="record-form" aria-label="Campaign sequence">
    <summary>{config.attachedKind ? `${config.attachedKind} sequence · Attached v${config.attachedVersion}` : "Campaign sequence · Off"}</summary>
    <label className="field">Sequence template<select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as CampaignSequenceKind)}>
      {campaignSequenceKinds.map((option) => <option key={option}>{option}</option>)}
    </select></label>
    <p className="muted">{audience} Current enrollments keep their saved version. Email and text are simulated.</p>
    <CampaignSequenceEditor key={`${kind}:${config.latest[kind]?.version}:${config.attachedVersion}`}
      campaignId={campaignId} kind={kind} config={config} busy={busy} save={save} />
  </details>;
}

function CampaignSequenceEditor({ campaignId, kind, config, busy, save }: {
  campaignId: string; kind: CampaignSequenceKind; config: CampaignSequenceConfig; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const latest = config.latest[kind];
  const [steps, setSteps] = useState(latest?.steps ?? defaultCampaignSequenceSteps[kind]);
  function update(index: number, change: Partial<CampaignSequenceStep>) {
    setSteps((current) => current.map((step, i) => i === index ? { ...step, ...change } : step));
  }
  function attach(next: CampaignSequenceStep[] | null) {
    void save({ type: "saveCampaignSequence", campaignId, kind, expectedVersion: config.attachedVersion,
      expectedTemplateVersion: latest?.version ?? null, steps: next });
  }

  return <form className="record-form" onSubmit={(event) => { event.preventDefault(); attach(steps); }}>
      {latest && <p className="muted">Brokerage template v{latest.version}. Saving changed steps creates a reusable version.</p>}
      {steps.map((step, index) => <fieldset key={index} className="record-form">
        <legend>Step {index + 1}</legend>
        <div className="form-grid">
          <label className="field">Channel<select aria-label={`Step ${index + 1} channel`} value={step.channel}
            onChange={(event) => update(index, { channel: event.target.value as CampaignSequenceStep["channel"] })}>
            {sequenceChannels.map((channel) => <option key={channel}>{channel}</option>)}
          </select></label>
          <label className="field">{step.channel === "Email" ? "Email subject" : "Step title"}<input aria-label={`Step ${index + 1} title`} required maxLength={100}
            value={step.title} onChange={(event) => update(index, { title: event.target.value })} /></label>
          <label className="field">Business-day delay<input aria-label={`Step ${index + 1} business-day delay`} type="number" required min={0} max={30}
            value={step.delay} onChange={(event) => update(index, { delay: Number(event.target.value) })} /></label>
        </div>
        {step.channel !== "Call" && <label className="field">Mock draft<textarea aria-label={`Step ${index + 1} mock draft`} required maxLength={1000} rows={2}
          value={step.body} onChange={(event) => update(index, { body: event.target.value })} /></label>}
        <div className="loan-application-actions">
          <Button type="button" size="sm" variant="ghost" disabled={busy || !index} onClick={() => setSteps((current) => {
            const reordered = [...current];
            [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
            return reordered;
          })}>Move step {index + 1} up</Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy || steps.length === 1}
            onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}>Remove step {index + 1}</Button>
        </div>
      </fieldset>)}
      <p className="muted">Each delay starts when the lead is enrolled or the prior step is completed. Zero means immediately. Later steps are due at 9 a.m. Eastern on a weekday.</p>
      <div className="loan-application-actions">
        <Button type="button" size="sm" variant="outline" disabled={busy || steps.length >= 6}
          onClick={() => setSteps((current) => [...current, { channel: "Call", title: "", delay: 1, body: "" }])}>Add sequence step</Button>
        <Button type="submit" size="sm" disabled={busy}>Save and attach {kind} sequence</Button>
        {config.attachedKind === kind && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => attach(null)}>Detach sequence</Button>}
      </div>
  </form>;
}

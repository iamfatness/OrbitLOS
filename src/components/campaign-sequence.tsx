"use client";

import { useState } from "react";
import { defaultNewLeadSteps, sequenceChannels, type CampaignSequenceConfig, type CampaignSequenceStep } from "@/lib/campaign-sequence-model";
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
  const [steps, setSteps] = useState(config.latest?.steps ?? defaultNewLeadSteps);
  function update(index: number, change: Partial<CampaignSequenceStep>) {
    setSteps((current) => current.map((step, i) => i === index ? { ...step, ...change } : step));
  }
  function attach(next: CampaignSequenceStep[] | null) {
    void save({ type: "saveCampaignSequence", campaignId, expectedVersion: config.attachedVersion,
      expectedTemplateVersion: config.latest?.version ?? null, steps: next });
  }

  return <details className="record-form" aria-label="New Lead sequence"><summary>New Lead sequence · {config.attachedVersion ? `Attached v${config.attachedVersion}` : "Off"}</summary>
    <p className="muted">Apply the brokerage’s New Lead template to future CSV imports for this campaign. Current enrollments keep their saved version. Email and text are simulated.</p>
    {config.latest && <p className="muted">Editing brokerage template v{config.latest.version}. Save to attach the edited version to this campaign.</p>}
    <form className="record-form" onSubmit={(event) => { event.preventDefault(); attach(steps); }}>
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
        <Button type="submit" size="sm" disabled={busy}>Save and attach New Lead sequence</Button>
        {config.attachedVersion && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => attach(null)}>Detach sequence</Button>}
      </div>
    </form>
  </details>;
}

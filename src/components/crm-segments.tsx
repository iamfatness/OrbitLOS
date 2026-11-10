"use client";

import { useRef, useState } from "react";
import type { CallCampaign } from "@/lib/call-campaign-model";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { segmentEnrollmentLimit, segmentKinds, sequenceKindForSegment, type CrmSegment, type SegmentPreview } from "@/lib/crm-segment-model";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void, announce?: boolean) => Promise<void>;

function SegmentEditor({ segment, busy, save, onSaved }: {
  segment?: CrmSegment; busy: boolean; save: Save; onSaved: (id: string) => void;
}) {
  const [kind, setKind] = useState<CrmSegment["kind"]>(segment?.kind ?? segmentKinds[0]);
  const newId = useRef<string | null>(null);
  return <form className="record-form" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const id = segment?.id ?? (newId.current ??= crypto.randomUUID());
    void save({ type: "saveCrmSegment", id, revision: segment?.revision ?? 0, name: fields.get("name"), kind,
      quietDays: kind === "Quiet leads" ? Number(fields.get("quietDays")) : 7 }, () => onSaved(id));
  }}>
    <div className="form-grid">
      <label className="field">Segment name<input name="name" maxLength={80} defaultValue={segment?.name} required placeholder="e.g. Quiet for a week" /></label>
      <label className="field">Audience<select value={kind} onChange={(event) => setKind(event.target.value as CrmSegment["kind"])}>
        {segmentKinds.map((option) => <option key={option}>{option}</option>)}
      </select></label>
      {kind === "Quiet leads" && <label className="field">Days without a reply<input name="quietDays" type="number" min={1} max={90}
        defaultValue={segment?.quietDays ?? 7} required /></label>}
    </div>
    <div><Button size="sm" variant="outline" disabled={busy} type="submit">{segment ? "Save segment changes" : "Save new segment"}</Button></div>
  </form>;
}

export function CrmSegments({ segments, campaign, busy, save }: {
  segments: CrmSegment[]; campaign?: CallCampaign; busy: boolean; save: Save;
}) {
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<{ key: string; preview: SegmentPreview }>();
  const segment = segments.find((item) => item.id === selected);
  const attachedKind = campaign?.sequenceConfig?.attachedKind;
  const matchingSequence = segment && attachedKind === sequenceKindForSegment(segment.kind);
  const key = `${segment?.id}:${segment?.revision}:${campaign?.id}:${campaign?.sequenceConfig?.attachedVersion}`;
  const preview = result?.key === key ? result.preview : undefined;
  const batch = Math.min(preview?.eligible ?? 0, segmentEnrollmentLimit);
  const run = (enroll: boolean) => {
    if (!segment || !campaign) return;
    void save({ type: "enrollCrmSegment", segmentId: segment.id, campaignId: campaign.id,
      fingerprint: enroll ? preview?.fingerprint : undefined }, ({ segmentPreview }) => {
      setResult(segmentPreview ? { key, preview: segmentPreview } : undefined);
    }, enroll);
  };

  return <section className="integration record-form manager-panel" aria-label="Saved CRM segments">
    <div><h2>Saved CRM segments</h2><p className="muted">Save a filter and preview today’s matches before adding borrowers to the selected campaign.</p></div>
    <label className="field">Saved segment<select value={selected} onChange={(event) => { setSelected(event.target.value); setResult(undefined); }}>
      <option value="">New segment</option>
      {segments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <SegmentEditor key={segment ? `${segment.id}:${segment.revision}` : "new"} segment={segment} busy={busy} save={save}
      onSaved={(id) => { setSelected(id); setResult(undefined); }} />
    {segment && (campaign ? <div className="work-queue">
      <h3>Preview for {campaign.name}</h3>
      <p className="muted">{segment.kind === "Quiet leads" ? "Existing leads keep their assigned officer." :
        "Enrolled borrowers get a returning-client refinance lead."}
        {campaign.routing?.enabled ? " Round robin routes unassigned leads when capacity is available." : " Unassigned leads enter the shared inbox."}</p>
      {!preview && matchingSequence && <p className="muted">Eligible borrowers start {attachedKind} v{campaign.sequenceConfig?.attachedVersion}. Assigned steps appear in Today.</p>}
      <div><Button size="sm" variant="outline" disabled={busy} onClick={() => run(false)}>Preview segment</Button></div>
      {preview && <>
        {preview.sequence && <p className="muted">Eligible borrowers start {preview.sequence.kind} v{preview.sequence.version}. Assigned steps appear in Today.</p>}
        <p role="status"><strong>{preview.eligible} eligible · {preview.excluded} excluded</strong></p>
        {preview.rows.length > 0 ? <ul className="document-list">{preview.rows.map((row) => <li className="document-item" key={row.id}>
          <div className="document-item-head"><strong>{row.name}</strong><span className={row.status === "Eligible" ? "pill" : "open-chip"}>{row.status}</span></div>
          <small className="muted">{row.owner} · {row.detail}</small>
        </li>)}</ul> : <p className="empty-inline">No borrowers match this filter today.</p>}
        {preview.eligible + preview.excluded > preview.rows.length && <p className="muted">Showing up to {segmentEnrollmentLimit} records in each group.</p>}
        {batch > 0 && <div><Button size="sm" disabled={busy} onClick={() => run(true)}>Enroll {batch} eligible {batch === 1 ? "borrower" : "borrowers"}</Button></div>}
      </>}
    </div> : <p className="empty-inline">Create a call campaign to preview enrollment.</p>)}
  </section>;
}

"use client";

import { useRef, useState } from "react";
import type { CallCampaign } from "@/lib/call-campaign-model";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { segmentEnrollmentLimit, segmentKinds, sequenceKindForSegment, type CrmSegment, type SegmentPreview } from "@/lib/crm-segment-model";
import { CrmFieldFilterEditor } from "./crm-fields";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void, announce?: boolean) => Promise<void>;

function SegmentEditor({ segment, brokerageId, busy, save, onSaved }: {
  segment?: CrmSegment; brokerageId: string; busy: boolean; save: Save; onSaved: (id: string) => void;
}) {
  const [kind, setKind] = useState<CrmSegment["kind"]>(segment?.kind ?? segmentKinds[0]);
  const [customFilter, setCustomFilter] = useState(segment?.customFilter);
  const newId = useRef<string | null>(null);
  return <form className="record-form" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const id = segment?.id ?? (newId.current ??= crypto.randomUUID());
    void save({ type: "saveCrmSegment", id, revision: segment?.revision ?? 0, name: fields.get("name"), kind,
      quietDays: kind === "Quiet leads" ? Number(fields.get("quietDays")) : 7, customFilter }, () => onSaved(id));
  }}>
    <div className="form-grid">
      <label className="field">Segment name<input name="name" maxLength={80} defaultValue={segment?.name} required placeholder="e.g. Quiet for a week" /></label>
      <label className="field">Audience<select value={kind} onChange={(event) => setKind(event.target.value as CrmSegment["kind"])}>
        {segmentKinds.map((option) => <option key={option}>{option}</option>)}
      </select></label>
      {kind === "Quiet leads" && <label className="field">Days without a reply<input name="quietDays" type="number" min={1} max={90}
        defaultValue={segment?.quietDays ?? 7} required /></label>}
    </div>
    <CrmFieldFilterEditor brokerageId={brokerageId} value={customFilter} change={setCustomFilter} disabled={busy}
      scope={kind === "Quiet leads" ? "Matches values saved on leads." : "Matches values saved on borrower contacts."} />
    <div><Button size="sm" variant="outline" disabled={busy} type="submit">{segment ? "Save segment changes" : "Save new segment"}</Button></div>
  </form>;
}

export function CrmSegments({ segments, campaign, brokerageId, busy, save }: {
  segments: CrmSegment[]; campaign?: CallCampaign; brokerageId: string; busy: boolean; save: Save;
}) {
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<{ key: string; preview: SegmentPreview; selectedIds: string[] }>();
  const segment = segments.find((item) => item.id === selected);
  const attachedKind = campaign?.sequenceConfig?.attachedKind;
  const matchingSequence = segment && attachedKind === sequenceKindForSegment(segment.kind);
  const key = `${segment?.id}:${segment?.revision}:${campaign?.id}:${campaign?.sequenceConfig?.attachedVersion}:${campaign?.routing?.revision}`;
  const current = result?.key === key ? result : undefined;
  const preview = current?.preview;
  const selectedIds = current?.selectedIds ?? [];
  const selectedSet = new Set(selectedIds);
  const pageIds = preview?.rows.filter(({ status }) => status === "Eligible").map(({ id }) => id) ?? [];
  const pageSelection = [...new Set([...selectedIds, ...pageIds])];
  const setSelection = (ids: string[]) => {
    if (current && ids.length <= segmentEnrollmentLimit) setResult({ ...current, selectedIds: ids });
  };
  const run = (enroll: boolean, previewPage = 1) => {
    if (!segment || !campaign) return;
    if (enroll && (!preview || !selectedIds.length)) return;
    void save({ type: "enrollCrmSegment", segmentId: segment.id, campaignId: campaign.id,
      ...(enroll ? { fingerprint: preview?.fingerprint, selectedIds } : { previewPage }) }, ({ segmentPreview }) => {
      setResult((previous) => segmentPreview ? {
        key, preview: segmentPreview,
        selectedIds: previous?.key === key && previous.preview.fingerprint === segmentPreview.fingerprint ? previous.selectedIds : [],
      } : undefined);
    }, enroll);
  };

  return <section className="integration record-form manager-panel" aria-label="Saved CRM segments">
    <div><h2>Saved CRM segments</h2><p className="muted">Save a filter and preview today’s matches before adding borrowers to the selected campaign.</p></div>
    <label className="field">Saved segment<select value={selected} onChange={(event) => { setSelected(event.target.value); setResult(undefined); }}>
      <option value="">New segment</option>
      {segments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <SegmentEditor key={segment ? `${segment.id}:${segment.revision}` : "new"} segment={segment} brokerageId={brokerageId} busy={busy} save={save}
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
        {preview.eligible > 0 && <div className="loan-application-actions">
          <span className="pill" role="status">{selectedIds.length} selected</span>
          <Button size="sm" variant="outline"
            disabled={busy || pageSelection.length === selectedIds.length || pageSelection.length > segmentEnrollmentLimit}
            onClick={() => setSelection(pageSelection)}>Select eligible on this page</Button>
          <Button size="sm" variant="ghost" disabled={busy || !selectedIds.length} onClick={() => setSelection([])}>Clear selection</Button>
          <Button size="sm" disabled={busy || !selectedIds.length} onClick={() => run(true)}>Enroll selected ({selectedIds.length})</Button>
        </div>}
        {preview.rows.length > 0 ? <ul className="document-list">{preview.rows.map((row) => <li className="document-item" key={row.id}>
          <div className="document-item-head">
            {row.status === "Eligible" ? <label className="demo-confirm">
              <input type="checkbox" aria-label={`Select ${row.name}`} checked={selectedSet.has(row.id)}
                disabled={busy || (!selectedSet.has(row.id) && selectedIds.length >= segmentEnrollmentLimit)}
                onChange={(event) => setSelection(event.target.checked ? [...selectedIds, row.id] : selectedIds.filter((id) => id !== row.id))} />
              <strong>{row.name}</strong>
            </label> : <strong>{row.name}</strong>}
            <span className={row.status === "Eligible" ? "pill" : "open-chip"}>{row.status}</span>
          </div>
          <small className="muted">{row.owner} · {row.detail}</small>
        </li>)}</ul> : <p className="empty-inline">No borrowers match this filter today.</p>}
        {preview.pages > 1 && <>
          <p className="muted">Select up to {segmentEnrollmentLimit} borrowers per enrollment. Selections carry between pages.</p>
          <div className="loan-application-actions">
            <Button size="sm" variant="outline" disabled={busy || preview.page === 1} onClick={() => run(false, preview.page - 1)}>Previous page</Button>
            <span className="muted">Eligible page {preview.page} of {preview.pages}</span>
            <Button size="sm" variant="outline" disabled={busy || preview.page === preview.pages} onClick={() => run(false, preview.page + 1)}>Next page</Button>
          </div>
        </>}
        {preview.page === 1 && preview.excluded > segmentEnrollmentLimit &&
          <p className="muted">Showing the first {segmentEnrollmentLimit} excluded borrowers.</p>}
      </>}
    </div> : <p className="empty-inline">Create a call campaign to preview enrollment.</p>)}
  </section>;
}

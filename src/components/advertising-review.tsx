"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { accessComplianceCases } from "@/app/actions";
import type { AdvertisingFacts, AdvertisingReviewRequest } from "@/lib/advertising-review-model";
import type { AdvertisingReviewResult } from "@/lib/advertising-review";
import type { ProgramEntity } from "@/lib/compliance-program-model";
import { dateTime } from "@/lib/utils";
import { AdvertisingReviewForm } from "./advertising-review-form";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type List = Extract<AdvertisingReviewResult, { kind: "advertisingList" }>;
type Record = Extract<AdvertisingReviewResult, { kind: "advertisingReview" }>;
type Editor = { id: string; base?: Record };

function Facts({ items }: { items: [string, ReactNode][] }) {
  return <dl className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
    {items.map(([name, value]) => <div key={name} className="contents">
      <dt className="font-medium">{name}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{value || "Unrecorded"}</dd>
    </div>)}
  </dl>;
}

function SavedEvidence({ record }: { record: Record }) {
  const { facts, review } = record;
  const { creative, distribution, archive } = facts;
  const assessed = (value?: { result: string; reference: string }) => value ? `${value.result} · ${value.reference}` : undefined;
  return <>
    <section className="record-form" aria-label="Review findings">
      <h3 className="font-semibold">Review findings</h3>
      {review.findings.length ? <ul className="loan-task-list">
        {review.findings.map(finding => <li key={finding.code} className="border-t border-[var(--line)] py-2">
          <p><strong>{finding.status}</strong> · {finding.message}</p>
          {!!finding.sources.length && <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {finding.sources.map(source => <li key={source.url}><a className="underline" href={source.url}>{source.label}</a></li>)}
          </ul>}
        </li>)}
      </ul> : <p>No gaps or concerns recorded in this version.</p>}
      {review.federalArchiveReviewDate && <p><strong>Federal archive review date</strong> · {review.federalArchiveReviewDate}</p>}
    </section>
    <details className="border-t border-[var(--line)] py-2">
      <summary className="font-semibold">Creative and scope</summary>
      <div className="record-form pt-2">
        <Facts items={[
          ["Audience", facts.audience], ["Campaign scope reference", facts.scopeReference], ["Mortgage scope", facts.mortgageScope],
          ["Review date", `${facts.reviewedOn} · ${facts.zone === "America/Detroit" ? "Eastern" : "Central"}`],
          ["Creative format", creative.kind], ["SHA-256", record.creativeDigest],
        ]} />
        {creative.kind === "Text" ?
          <p className="document-item whitespace-pre-wrap [overflow-wrap:anywhere]">{creative.copy}</p> :
          <Facts items={[["Archived creative reference", creative.reference]]} />}
      </div>
    </details>
    <details className="border-t border-[var(--line)] py-2">
      <summary className="font-semibold">Recorded checks and distribution</summary>
      <div className="record-form pt-2">
        <Facts items={[
          ["Michigan claims", assessed(facts.stateClaims)], ["Advertises specific terms", facts.specificTerms],
          ["Michigan terms", assessed(facts.stateTerms)], ["Individual originator advertising", facts.originatorAdvertising],
          ["Displayed company NMLS ID", facts.sponsoringCompanyDisplayed], ["Credit type", facts.creditType],
          ["Regulation Z", assessed(facts.regulationZ)], ["Regulation N", assessed(facts.regulationN)],
          ["Federal archive rule applies", archive.applies], ["Archive scope reference", archive.scopeReference],
          ["Communications and materials", archive.materials], ["Available mortgage products", archive.availableProducts],
          ["Additional products or services", archive.additionalProducts],
          ["First use date", distribution?.firstOn], ["Final use date", distribution?.finalOn],
          ["Same-day order", distribution?.sameDayOrder], ["Distribution reference", distribution?.reference],
        ]} />
        {facts.originators.map((originator, index) => <section key={index} className="record-form border-t border-[var(--line)] py-2">
          <h4 className="font-semibold">{originator.name}</h4>
          <Facts items={[["Verified NMLS ID", originator.expected], ["Displayed NMLS ID", originator.displayed],
            ["Visibility", originator.visibility], ["Reference", originator.reference]]} />
        </section>)}
      </div>
    </details>
    <details className="border-t border-[var(--line)] py-2">
      <summary className="font-semibold">Sources used in this version</summary>
      <ul className="mt-2 list-disc pl-5">
        {review.sources.map(source => <li key={source.url}><a href={source.url} className="underline">{source.label}</a></li>)}
      </ul>
    </details>
  </>;
}

export function AdvertisingReview({ brokerageId, paused, openMonthlyReview }: {
  brokerageId: string; paused: boolean; openMonthlyReview: () => void;
}) {
  return paused ? <p className="muted">Advertising review is unavailable while the workspace is paused.</p> :
    <AdvertisingReviewWorkspace brokerageId={brokerageId} openMonthlyReview={openMonthlyReview} />;
}

function AdvertisingReviewWorkspace({ brokerageId, openMonthlyReview }: { brokerageId: string; openMonthlyReview: () => void }) {
  const [entities, setEntities] = useState<ProgramEntity[]>();
  const [entityId, setEntityId] = useState("");
  const [entityError, setEntityError] = useState("");
  const [entityReload, setEntityReload] = useState(0);
  const [list, setList] = useState<List>();
  const [listError, setListError] = useState("");
  const [listReload, setListReload] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<{ id: string; revision?: number }>();
  const [loadedRecord, setRecord] = useState<Record>();
  const [editor, setEditor] = useState<Editor>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const correctButton = useRef<HTMLButtonElement>(null);
  const links = useRef(new Map<string, HTMLButtonElement>());
  const returnTo = useRef<string | "new">(null);
  const focusDetail = useRef(false);
  const focusCorrection = useRef(false);
  const request = useRef<{ id: string; fingerprint: string }>(null);
  const entity = entities?.find(item => item.id === entityId);
  const record = loadedRecord && loadedRecord.adId === selection?.id && loadedRecord.revision === selection.revision ? loadedRecord : undefined;

  useEffect(() => {
    let active = true;
    void accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setEntityError(result.error);
      else if (result.kind === "programEntities") setEntities(result.entities);
    }).catch(() => { if (active) setEntityError("Could not load legal entities. Try again."); });
    return () => { active = false; };
  }, [brokerageId, entityReload]);
  useEffect(() => {
    if (!entityId) return;
    let active = true;
    const input = { operation: "list", entityId, jurisdiction: "MI", offset } satisfies AdvertisingReviewRequest;
    void accessComplianceCases({ type: "advertisingReview", input }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setListError(result.error);
      else if (result.kind === "advertisingList") setList(result);
    }).catch(() => { if (active) setListError("Could not load advertising records. Try again."); });
    return () => { active = false; };
  }, [brokerageId, entityId, offset, listReload]);
  useEffect(() => {
    if (editor || selection || !list || !returnTo.current) return;
    const target = returnTo.current === "new" ? newButton.current : links.current.get(returnTo.current);
    (target ?? heading.current)?.focus();
    returnTo.current = null;
  }, [editor, selection, list]);
  useEffect(() => {
    if (!editor && record && notice) receipt.current?.focus();
  }, [editor, record, notice]);
  useEffect(() => {
    if (editor || !record || busy) return;
    if (focusDetail.current) {
      detailHeading.current?.focus();
      focusDetail.current = false;
    }
    if (focusCorrection.current) {
      correctButton.current?.focus();
      focusCorrection.current = false;
    }
  }, [editor, record, busy]);

  function reloadList(nextOffset = offset) {
    setListError("");
    setList(undefined);
    setOffset(nextOffset);
    setListReload(value => value + 1);
  }

  function back() {
    returnTo.current = selection?.id ?? "new";
    setSelection(undefined);
    setRecord(undefined);
    setEditor(undefined);
    setError("");
    setNotice("");
  }

  async function open(id: string, revision?: number, before?: number, keepFocus = false) {
    if (busy) return;
    setSelection({ id, revision });
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const input = { operation: "read", entityId, jurisdiction: "MI", adId: id, revision, before } satisfies AdvertisingReviewRequest;
      const result = await accessComplianceCases({ type: "advertisingReview", input }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "advertisingReview") {
        setRecord(before && record ? { ...result, history: [...record.history, ...result.history] } : result);
        setSelection({ id, revision: result.revision });
        focusDetail.current = !keepFocus || (before !== undefined && result.next === null);
      }
    } catch { setError("Could not open the saved evidence. Try again."); }
    finally { setBusy(false); }
  }

  async function save(facts: AdvertisingFacts, correction?: string) {
    if (busy || !editor) return;
    const expectedRevision = editor.base?.revision ?? 0;
    const fingerprint = JSON.stringify([editor.id, expectedRevision, facts, correction]);
    if (request.current?.fingerprint !== fingerprint) request.current = { id: crypto.randomUUID(), fingerprint };
    setBusy(true);
    setError("");
    try {
      const input = { operation: "save", entityId, jurisdiction: "MI", adId: editor.id, expectedRevision,
        requestId: request.current.id, facts, correction } satisfies AdvertisingReviewRequest;
      const result = await accessComplianceCases({ type: "advertisingReview", input }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "advertisingReview") {
        setRecord(result);
        setSelection({ id: result.adId, revision: result.revision });
        setEditor(undefined);
        setNotice(`Advertising evidence saved. Version ${result.revision}.`);
        reloadList(0);
      }
    } catch { setError("Could not confirm the save. Try again with the same evidence."); }
    finally { setBusy(false); }
  }

  function download(current: Record) {
    const { adId, jurisdiction, entitySnapshot, revision, creativeDigest, facts, review, savedAt, reviewer, correction } = current;
    downloadSampleFile(JSON.stringify({ format: 1, adId, jurisdiction, entity: entitySnapshot, revision, creativeDigest,
      facts, review, savedAt, reviewer, correction }, null, 2), `orbit-advertising-${adId}-v${revision}.json`, "application/json");
    setNotice(`Version ${revision} sent to your downloads.`);
  }

  return <div className="integration manager-panel record-form">
    {editor ?
      <AdvertisingReviewForm key={editor.id} initial={editor.base?.facts} entityName={entity?.name ?? ""} busy={busy} error={error}
        onSave={(facts, correction) => void save(facts, correction)} onCancel={() => {
          if (!editor.base) { back(); return; }
          focusCorrection.current = true;
          setEditor(undefined);
          setError("");
        }} onReload={editor.base ? () => { setEditor(undefined); void open(editor.id); } : undefined} />
    : selection ? <>
      <div className="section-heading">
        <h2 className="min-w-0 [overflow-wrap:anywhere]" ref={detailHeading} tabIndex={-1}>
          {record?.facts.title ?? "Advertising evidence"}
        </h2>
        <Button type="button" variant="outline" disabled={busy} onClick={back}>Back to advertising</Button>
      </div>
      {notice && <p role="status" tabIndex={-1} ref={receipt}>{notice}</p>}
      {busy && <p role="status">Loading advertising evidence…</p>}
      {error && <div className="record-form"><p role="alert">{error}</p>
        <div><Button type="button" variant="outline" onClick={() => void open(selection.id, selection.revision)}>Retry evidence</Button></div>
      </div>}
      {record && <div className="record-form" aria-busy={busy}>
        <p className="muted [overflow-wrap:anywhere]">{record.entitySnapshot.name} · Michigan · {record.facts.channel}</p>
        <p className="muted">Version {record.revision} · {record.reviewer} · {dateTime(record.savedAt)} ET</p>
        {record.correction && <p className="[overflow-wrap:anywhere]">{record.correction}</p>}
        {(record.rulesChanged || record.entityChanged) && <p>Source rules or legal entity details changed after this version was saved.</p>}
        <div className="loan-application-actions">
          {record.revision === record.latestRevision ?
            <Button type="button" ref={correctButton} disabled={busy} onClick={() => {
              setError(""); setNotice(""); setEditor({ id: record.adId, base: record });
            }}>Record correction</Button> :
            <Button type="button" variant="outline" disabled={busy} onClick={() => void open(record.adId)}>Back to current version</Button>}
          <Button type="button" variant="outline" disabled={busy} onClick={() => download(record)}>Download version</Button>
        </div>
        <SavedEvidence record={record} />
        {(record.history.length > 1 || record.next !== null) && <details className="border-t border-[var(--line)] py-2">
          <summary className="font-semibold">Version history</summary>
          <ul className="loan-task-list mt-2">
            {record.history.map(item => <li key={item.revision} className="border-t border-[var(--line)] py-2">
              <div className="loan-application-actions">
                <Button type="button" variant="outline" disabled={busy || item.revision === record.revision}
                  onClick={() => void open(record.adId, item.revision)}>Open version {item.revision}</Button>
                <span className="muted">{dateTime(item.savedAt)} ET · {item.reviewer}</span>
              </div>
              {item.correction && <p className="mt-1 [overflow-wrap:anywhere]">{item.correction}</p>}
            </li>)}
          </ul>
          {record.next !== null && <div><Button type="button" variant="outline" disabled={busy}
            onClick={() => void open(record.adId, record.revision, record.next ?? undefined, true)}>Load older versions</Button></div>}
        </details>}
      </div>}
    </> : <>
      <div className="section-heading">
        <h2 ref={heading} tabIndex={-1}>Michigan advertising review</h2>
        {entity && <Button type="button" ref={newButton} onClick={() => setEditor({ id: crypto.randomUUID() })}>Record an advertisement</Button>}
      </div>
      {!entities && !entityError && <p role="status">Loading legal entities…</p>}
      {entityError && <div className="record-form"><p role="alert">{entityError}</p>
        <div><Button type="button" variant="outline" onClick={() => {
          setEntityError(""); setEntityReload(value => value + 1);
        }}>Retry legal entities</Button></div></div>}
      {entities?.length === 0 && <div className="record-form"><p>Add a legal entity in Monthly review to record advertising evidence.</p>
        <div><Button type="button" variant="outline" onClick={openMonthlyReview}>Open Monthly review</Button></div></div>}
      {!!entities?.length && <label className="field w-full max-w-2xl">Legal entity
        <select value={entityId} onChange={event => { setEntityId(event.target.value); reloadList(0); }}>
          <option value="">Select a legal entity</option>
          {entities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      {entity && <section className="record-form" aria-label="Saved advertising records">
        <p className="muted [overflow-wrap:anywhere]">{entity.name}{entity.nmls ? ` · NMLS ${entity.nmls}` : ""}</p>
        {listError && <div className="record-form"><p role="alert">{listError}</p>
          <div><Button type="button" variant="outline" onClick={() => reloadList()}>Retry advertising records</Button></div></div>}
        {!list && !listError && <p role="status">Loading advertising records…</p>}
        {list && (list.items.length ? <ul className="loan-task-list">
          {list.items.map(item => <li key={item.id} className="loan-task document-item record-form">
            <strong className="[overflow-wrap:anywhere]">{item.title}</strong>
            <p className="muted">{item.channel} · Version {item.revision} · {item.gaps} {item.gaps === 1 ? "gap" : "gaps"} · {item.concerns} {item.concerns === 1 ? "concern" : "concerns"}</p>
            <div><Button type="button" variant="outline" aria-label={`Open ${item.title}`}
              ref={node => { if (node) links.current.set(item.id, node); else links.current.delete(item.id); }}
              onClick={() => void open(item.id)}>Open evidence</Button></div>
          </li>)}
        </ul> : <p>No advertising records for this legal entity.</p>)}
        {list && (offset > 0 || list.next !== null) && <div className="loan-application-actions">
          <Button type="button" variant="outline" disabled={offset === 0} onClick={() => reloadList(Math.max(0, offset - 20))}>Previous records</Button>
          <Button type="button" variant="outline" disabled={list.next === null} onClick={() => reloadList(list.next ?? 0)}>Next records</Button>
        </div>}
      </section>}
    </>}
  </div>;
}

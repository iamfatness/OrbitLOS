"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { accessComplianceCases } from "@/app/actions";
import { advertisingStateNames, type AdvertisingFacts, type AdvertisingReviewRequest, type AdvertisingState } from "@/lib/advertising-review-model";
import { coloradoAdContentChecks, coloradoAdIdentityChecks } from "@/lib/advertising-state-review";
import type { AdvertisingReviewResult } from "@/lib/advertising-review";
import type { ProgramEntity } from "@/lib/compliance-program-model";
import { dateTime } from "@/lib/utils";
import { AdvertisingReviewForm, advertisingTimeZoneLabels } from "./advertising-review-form";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type List = Extract<AdvertisingReviewResult, { kind: "advertisingList" }>;
type Record = Extract<AdvertisingReviewResult, { kind: "advertisingReview" }>;
type Editor = { id: string; base?: Record };

function Facts({ items }: { items: [string, ReactNode][] }) {
  return <dl className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
    {items.map(([name, value]) => <div key={name} className="contents">
      <dt className="font-medium">{name}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{value === undefined || value === null || value === "" ? "Unrecorded" : value}</dd>
    </div>)}
  </dl>;
}

const assessed = (value?: { result: string; reference: string }) => value ? `${value.result} · ${value.reference}` : undefined;

function SavedStateEvidence({ evidence }: { evidence: NonNullable<AdvertisingFacts["stateEvidence"]> }) {
  const items: [string, ReactNode][] = [["State advertising scope", evidence.coverage], ["State scope reference", evidence.scopeReference]];
  switch (evidence.jurisdiction) {
    case "OH":
      items.push(["Registered company name", assessed(evidence.companyName)], ["Registered office address", assessed(evidence.officeAddress)],
        ["Company identifier visibility", assessed(evidence.companyIdentifier)], ["Ohio archive", assessed(evidence.archive)],
        ["Website information status", evidence.website?.status], ["Date information became outdated", evidence.website?.outdatedOn],
        ["Website update date", evidence.website?.updatedOn], ["Website evidence reference", evidence.website?.reference]);
      break;
    case "IN":
      items.push(["Used to solicit borrowers", evidence.solicitation], ["Indiana solicitation archive", assessed(evidence.archive)],
        ["Includes an internet communication", evidence.internetCommunication], ["Internet recipient count", evidence.recipientCount],
        ["Internet distribution reference", evidence.distributionReference]);
      break;
    case "IL":
      items.push(["Company identifier visibility", assessed(evidence.companyIdentifier)], ["Placement format", evidence.placement],
        ["Consumer Access", assessed(evidence.consumerAccess)], ["Includes other lines of business", evidence.mixedActivity],
        ["Prominence of mortgage services", assessed(evidence.prominence)]);
      break;
    case "CA": {
      const { route } = evidence;
      items.push(["California advertising authority", route.authority]);
      if (route.authority === "DRE endorsement") {
        items.push(["DRE solicitation purpose", route.purpose], ["DRE license numbers", assessed(route.dreIdentifiers)],
          ["Applicable NMLS identifiers", assessed(route.nmlsIdentifiers)], ["Broker or license designation", assessed(route.phrasing)],
          ["Identifier size or oral presentation", assessed(route.presentation)], ["DRE submission and solicitation review", assessed(route.submission)]);
      } else if (route.authority === "California Financing Law") {
        items.push(["CFL disclosure placement", route.placement], ["Platform character limit", route.characterLimit],
          ["Link and destination disclosures", assessed(route.linkedDisclosure)], ["Applicable NMLS identifier", assessed(route.identifier)],
          ["CFL license wording", assessed(route.phrasing)], ["Identifiable advertiser", assessed(route.advertiserIdentity)],
          ["Broadcast on radio or television", route.broadcast], ["Broadcast transcript or station copy", assessed(route.broadcastArchive)]);
      } else if (route.authority === "CRMLA") {
        items.push(["Identifies a mortgage loan originator", route.identifiesOriginator], ["Originator NMLS identifier", assessed(route.identifier)],
          ["CRMLA license wording", assessed(route.phrasing)], ["Identifiable advertiser", assessed(route.advertiserIdentity)],
          ["Claims of state oversight or bonding", assessed(route.regulatorClaims)]);
      }
      items.push(["Product, rate and payment disclosures", assessed(evidence.productDisclosures)],
        ["Advertising archive and examination retrieval", assessed(evidence.archive)]);
      break;
    }
    case "CO":
      items.push(["Colorado identification requirements", evidence.identification], ["Identification exception evidence", evidence.exceptionReference]);
      for (const [key, label] of [...coloradoAdIdentityChecks, ...coloradoAdContentChecks]) items.push([label, assessed(evidence[key])]);
      items.push(["Advertising archive and Board retrieval", assessed(evidence.archive)]);
      break;
    case "NY":
      items.push(["New York authority", evidence.authority], ["Advertising placement", evidence.placement],
        ["Registration or licensing legend", assessed(evidence.legend)], ["Entity name and office address", assessed(evidence.officeDisclosure)],
        ["Third-party loan arrangement statement", assessed(evidence.thirdPartyStatement)], ["Broker funding impression", assessed(evidence.fundingImpression)],
        ["Advertises a mortgage product", evidence.advertisesProduct], ["Product availability or disclosed allocation", assessed(evidence.productAvailability)],
        ["Credit access claims and material limitations", assessed(evidence.creditLimitations)], ["Prevailing rate notice", assessed(evidence.rateNotice)],
        ["Prepayment penalty disclosure", assessed(evidence.prepaymentPenalty)], ["Published sample and applicable scripts", assessed(evidence.archive)]);
      break;
    case "FL":
      items.push(["Suggests unqualified access to credit", evidence.unqualifiedCredit], ["Material credit limitations", assessed(evidence.materialLimits)],
        ["States an interest rate", evidence.expressedRate], ["Rate change or availability notice", assessed(evidence.rateNotice)],
        ["Federal agency names and representations", assessed(evidence.federalAgencyNames)],
        ["Advertiser requires a Chapter 494 license", evidence.chapterLicense], ["Published ad sample and OFR retrieval", assessed(evidence.sampleArchive)],
        ["Broadcast on radio or television", evidence.radioTelevision], ["Commercial script archive", assessed(evidence.broadcastScripts)]);
      break;
    case "TX":
      items.push(["Texas authority", evidence.authority], ["Company name", assessed(evidence.companyName)],
        ["Company identifier visibility", assessed(evidence.companyIdentifier)], ["Company has a website", evidence.companyWebsite],
        ["Displayed website address", assessed(evidence.websiteAddress)], ["Texas complaint notice", assessed(evidence.complaintNotice)],
        ["Social media disclosure location", evidence.socialPlacement], ["Social profile prominence", assessed(evidence.profileProminence)],
        ["Uses a team name or logo", evidence.teamBranding], ["Team link and prominence", assessed(evidence.teamLinkage)],
        ["Published ad archive and retrieval", assessed(evidence.archive)]);
      break;
    case "WI":
      items.push(["Brokerage, banker or sponsor name", assessed(evidence.companyName)],
        ["Company identifier visibility", assessed(evidence.companyIdentifier)],
        ["Government or organization affiliation", assessed(evidence.affiliation)]);
      break;
  }
  return <details className="border-t border-[var(--line)] py-2">
    <summary className="font-semibold">{advertisingStateNames[evidence.jurisdiction]} evidence</summary>
    <div className="pt-2"><Facts items={items} /></div>
  </details>;
}

function SavedEvidence({ record }: { record: Record }) {
  const { facts, review } = record;
  const { creative, distribution, archive } = facts;
  const stateName = advertisingStateNames[record.jurisdiction];
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
      {review.websiteUpdateDue && <p><strong>Ohio website update due</strong> · {review.websiteUpdateDue}</p>}
      {review.stateArchiveReviewDate && <p><strong>{stateName} archive review date</strong> · {review.stateArchiveReviewDate}</p>}
      {review.federalArchiveReviewDate && <p><strong>Federal archive review date</strong> · {review.federalArchiveReviewDate}</p>}
    </section>
    <details className="border-t border-[var(--line)] py-2">
      <summary className="font-semibold">Creative and scope</summary>
      <div className="record-form pt-2">
        <Facts items={[
          ["Audience", facts.audience], ["Campaign scope reference", facts.scopeReference], ["Mortgage scope", facts.mortgageScope],
          ["Review date", `${facts.reviewedOn} · ${advertisingTimeZoneLabels[facts.zone]}`],
          ["Creative format", creative.kind], ["SHA-256", record.creativeDigest],
        ]} />
        {creative.kind === "Text" ?
          <p className="document-item whitespace-pre-wrap [overflow-wrap:anywhere]">{creative.copy}</p> :
          <Facts items={[["Archived creative reference", creative.reference]]} />}
      </div>
    </details>
    {facts.stateEvidence && <SavedStateEvidence evidence={facts.stateEvidence} />}
    <details className="border-t border-[var(--line)] py-2">
      <summary className="font-semibold">Recorded checks and distribution</summary>
      <div className="record-form pt-2">
        <Facts items={[
          [`${stateName} claims`, assessed(facts.stateClaims)], ["Advertises specific terms", facts.specificTerms],
          [`${stateName} terms`, assessed(facts.stateTerms)], [record.jurisdiction === "TX" ? "Made or distributed by a sponsored originator" : "Individual originator advertising", facts.originatorAdvertising],
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
            ["Visibility", originator.visibility], ["Reference", originator.reference],
            ...(record.jurisdiction === "OH" ? [["Originator name matches NMLS", assessed(originator.nameReview)] as [string, ReactNode]] : [])]} />
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
  const [jurisdiction, setJurisdiction] = useState<AdvertisingState>("MI");
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
    const input = { operation: "list", entityId, jurisdiction, offset } satisfies AdvertisingReviewRequest;
    void accessComplianceCases({ type: "advertisingReview", input }, brokerageId).then(result => {
      if (!active) return;
      if ("error" in result) setListError(result.error);
      else if (result.kind === "advertisingList") setList(result);
    }).catch(() => { if (active) setListError("Could not load advertising records. Try again."); });
    return () => { active = false; };
  }, [brokerageId, entityId, jurisdiction, offset, listReload]);
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
      const input = { operation: "read", entityId, jurisdiction, adId: id, revision, before } satisfies AdvertisingReviewRequest;
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
      const input = { operation: "save", entityId, jurisdiction, adId: editor.id, expectedRevision,
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
      <AdvertisingReviewForm key={editor.id} initial={editor.base?.facts} entityName={entity?.name ?? ""} jurisdiction={jurisdiction} busy={busy} error={error}
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
        <p className="muted [overflow-wrap:anywhere]">{record.entitySnapshot.name} · {advertisingStateNames[record.jurisdiction]} · {record.facts.channel}</p>
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
        <h2 ref={heading} tabIndex={-1}>Advertising review</h2>
        {entity && <Button type="button" ref={newButton} onClick={() => setEditor({ id: crypto.randomUUID() })}>Record an advertisement</Button>}
      </div>
      {!entities && !entityError && <p role="status">Loading legal entities…</p>}
      {entityError && <div className="record-form"><p role="alert">{entityError}</p>
        <div><Button type="button" variant="outline" onClick={() => {
          setEntityError(""); setEntityReload(value => value + 1);
        }}>Retry legal entities</Button></div></div>}
      {entities?.length === 0 && <div className="record-form"><p>Add a legal entity in Monthly review to record advertising evidence.</p>
        <div><Button type="button" variant="outline" onClick={openMonthlyReview}>Open Monthly review</Button></div></div>}
      {!!entities?.length && <div className="grid w-full max-w-2xl min-w-0 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className="field min-w-0">Legal entity
          <select value={entityId} onChange={event => { setEntityId(event.target.value); reloadList(0); }}>
            <option value="">Select a legal entity</option>
            {entities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field min-w-0">Review state
          <select value={jurisdiction} onChange={event => { setJurisdiction(event.target.value as AdvertisingState); reloadList(0); }}>
            {(["MI", "CA"] as const).map(state => <option key={state} value={state}>{advertisingStateNames[state]}</option>)}
          </select>
        </label>
      </div>}
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
        </ul> : <p>No {advertisingStateNames[jurisdiction]} advertising records for this legal entity.</p>)}
        {list && (offset > 0 || list.next !== null) && <div className="loan-application-actions">
          <Button type="button" variant="outline" disabled={offset === 0} onClick={() => reloadList(Math.max(0, offset - 20))}>Previous records</Button>
          <Button type="button" variant="outline" disabled={list.next === null} onClick={() => reloadList(list.next ?? 0)}>Next records</Button>
        </div>}
      </section>}
    </>}
  </div>;
}

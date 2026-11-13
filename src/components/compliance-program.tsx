"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import { programCategories, programStatuses, type ProgramEntity, type ProgramMonth, type ProgramRequest, type ProgramReviewTarget } from "@/lib/compliance-program-model";
import type { ObligationReviewBasis } from "@/lib/compliance-obligations-model";
import { dateLabel } from "@/lib/client-retention";
import { ComplianceFilingReceipts } from "./compliance-filing-receipts";
import { Button } from "./ui/button";

const value = (form: FormData, name: string) => String(form.get(name) ?? "");
export function ComplianceProgram({ brokerageId, paused, target, openReport }: {
  brokerageId: string; paused: boolean; target?: ProgramReviewTarget;
  openReport: (basis: ObligationReviewBasis, entity: string) => void;
}) {
  const [entities, setEntities] = useState<ProgramEntity[]>([]);
  const [entityId, setEntity] = useState(target?.entityId ?? "");
  const [month, setMonth] = useState(() => target?.month ?? new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<ProgramMonth>();
  const [version, refresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openingReview, setOpeningReview] = useState(!!target);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [screen, setScreen] = useState<"list" | "entity" | "schedule" | "review" | "item">("list");
  const [itemId, setItem] = useState("");
  const pendingTarget = useRef(target);
  const [status, setStatus] = useState("");
  const [evidenceGapsOnly, setEvidenceGapsOnly] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const returnToWork = useRef(false);
  const workButton = useRef<HTMLButtonElement>(null);
  const active = useRef(false);
  const retry = useRef<{ body: string; id: string }>(undefined);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, [brokerageId]);
  useEffect(() => {
    if (paused) return;
    let current = true;
    const input: ProgramRequest = entityId ? { operation: "month", entityId, month } : { operation: "entities" };
    void accessComplianceCases({ type: "program", input }, brokerageId).then(result => {
      if (!current) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "programEntities") setEntities(result.entities);
      else if (result.kind === "programMonth") {
        setData(result);
        const opening = pendingTarget.current;
        if (opening?.entityId === result.entity.id && opening.month === result.month) {
          pendingTarget.current = undefined;
          if (result.items.some(item => item.id === opening.itemId)) {
            setItem(opening.itemId);
            setScreen("item");
          } else setError("This review item is no longer available. Check the current monthly work.");
        }
      }
    }).catch(() => { if (current) setError("Could not load the program. Refresh to try again."); })
      .finally(() => { if (current) { setLoading(false); setOpeningReview(false); } });
    return () => { current = false; };
  }, [brokerageId, entityId, month, paused, version]);
<<<<<<< HEAD
  useEffect(() => {
    if (paused || !target) return;
    let current = true;
    void accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId).then(result => {
      if (current && "kind" in result && result.kind === "programEntities") setEntities(result.entities);
    }, () => { /* The selected review can still be opened. */ });
    return () => { current = false; };
  }, [brokerageId, paused, target]);
  useEffect(() => { heading.current?.focus(); }, [screen, itemId]);
=======
  useEffect(() => { if (!returnToWork.current) heading.current?.focus(); }, [screen, itemId]);
  useEffect(() => {
    if (screen !== "list" || loading || !returnToWork.current) return;
    returnToWork.current = false;
    (workButton.current ?? heading.current)?.focus();
  }, [screen, loading]);
>>>>>>> 5ae41b5e (Surface linked filing evidence gaps in monthly review)
  useEffect(() => { if (error || notice) feedback.current?.focus(); }, [error, notice]);
  function reload() { setLoading(true); setError(""); setNotice(""); setData(undefined); refresh(v => v + 1); }
  function navigate(next: typeof screen) { setError(""); setNotice(""); setScreen(next); }
  async function save(input: Omit<Extract<ProgramRequest, { requestId: string }>, "requestId"> | object) {
    if (busy || paused) return;
    const body = JSON.stringify([brokerageId, input]);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await accessComplianceCases({ type: "program", input: { ...input, requestId: retry.current.id } }, brokerageId);
      if (!active.current) return;
      if ("error" in result) setError(result.error);
      else if (result.kind === "programMonth" || result.kind === "programEntities") {
        retry.current = undefined;
        if (result.kind === "programMonth") setData(result);
        else { setEntities(result.entities); setEntity(""); setData(undefined); }
        const savedStateReview = "operation" in input && input.operation === "update" && selected?.stateReview;
        if (!savedStateReview) setScreen("list");
        setNotice(savedStateReview ? "State review updated." : "Saved internal review work.");
      }
    } catch { if (active.current) setError("Save could not be confirmed. Retry the unchanged form to check the same request."); }
    finally { if (active.current) setBusy(false); }
  }
  const current = data?.entity.id === entityId && data.month === month ? data : undefined;
  const selected = current?.items.find(i => i.id === itemId);
<<<<<<< HEAD
  const readyToComplete = selected?.status === "Awaiting review";
  const obligation = selected?.obligation;
  const reporting = obligation?.reportingBasis;
  const obligationSource = obligation && <>
    <p><strong>Recorded period {obligation.period} · Obligation version {obligation.version}</strong></p>
    {!reporting && <p>{obligation.status}</p>}
    {obligation.stateBasis && <p>{obligation.stateBasis.jurisdiction} · State scope version {obligation.stateBasis.revision}</p>}
    <a className="name-link break-words" href={obligation.sourceUrl} target="_blank" rel="noreferrer">{obligation.authority}</a>
  </>;
  const entityOptions = current && !entities.some(entity => entity.id === current.entity.id) ? [current.entity, ...entities] : entities;
=======
  const hasFilingProgress = current?.items.some(item => item.filingProgress);
  const visibleItems = current?.items.filter(item => (!status || item.status === status) &&
    (!hasFilingProgress || !evidenceGapsOnly || Boolean(item.filingProgress?.gaps.length))) ?? [];
>>>>>>> 5ae41b5e (Surface linked filing evidence gaps in monthly review)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (screen === "entity") void save({ operation: "createEntity", name: value(form, "name"), nmls: value(form, "nmls"), scopeNote: value(form, "scopeNote") });
    if (screen === "schedule") void save({ operation: "schedule", entityId, month, title: value(form, "title"), category: value(form, "category"),
      ownerEmail: value(form, "ownerEmail"), internalTarget: value(form, "internalTarget"), instructions: value(form, "instructions") });
    if (screen === "item" && selected) void save({ operation: "update", entityId, month, id: selected.id, expectedRevision: selected.revision,
      status: value(form, "status"), ownerEmail: value(form, "ownerEmail"), internalTarget: value(form, "internalTarget"), evidence: value(form, "evidence"), note: value(form, "note") });
    if (screen === "review" && current) void save({ operation: "reviewMonth", entityId, month, fingerprint: current.fingerprint, note: value(form, "note") });
  }
  const formTitle = screen === "entity" ? "Add entity profile" : screen === "schedule" ? "Schedule review work" : screen === "review" ? "Record monthly review" :
    selected?.stateReview ? "State review question" : selected?.title ?? "Monthly review";
  if (paused) return <p>Program work is unavailable while the workspace is paused.</p>;
  if (openingReview && loading && !error) return <section className="integration manager-panel record-form compliance-pilot-form" aria-label="Compliance program">
    <h2>Review work</h2>
    <p role="status">Loading the selected review…</p>
  </section>;
  return <section className="integration manager-panel record-form compliance-pilot-form" aria-label="Compliance program">
    <h2 ref={heading} tabIndex={-1}>{screen === "list" ? "Monthly review" : formTitle}</h2>
    {screen === "item" && current && !selected?.stateReview && <p className="muted">{current.entity.name}{!reporting && ` · Review month ${current.month}`}</p>}
    {screen === "item" && selected?.stateReview && <section className="record-form" aria-label="Saved state review basis">
      <h3>{selected.stateReview.entityName} · {selected.stateReview.jurisdiction} state record v{selected.stateReview.revision}</h3>
      <p><strong>Question</strong> · {selected.instructions}</p>
      {selected.stateReview.source && <p><a className="name-link break-words" href={selected.stateReview.source.sourceUrl} target="_blank" rel="noreferrer">
        {selected.stateReview.source.title}</a></p>}
      {selected.stateReview.latestNote && <dl className="state-scope-facts">
        <div><dt>Last recorded decision or next action</dt><dd>{selected.stateReview.latestNote}</dd></div>
      </dl>}
      <details className="details-section">
        <summary className="min-h-11 content-center">Saved business facts and evidence references</summary>
        <dl className="state-scope-facts">
          {([
            ["Activity", "activity"], ["Lien scope", "lienScope"], ["Products", "products"], ["Responsibilities", "responsibility"],
            ["Reporting basis", "reportingBasis"], ["Company evidence", "companyEvidence"], ["Branch evidence", "officeEvidence"],
            ["Originator evidence", "originatorEvidence"], ["Counsel packet reference", "counselPacketReference"],
          ] as const).map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{selected.stateReview?.facts[key] || "Not recorded"}</dd></div>)}
        </dl>
      </details>
    </section>}
    {screen === "item" && selected?.obligation && current && <div className="record-form">
      {reporting && <section className="record-form" aria-label="Filing plan">
        <p><strong>Review before filing</strong> · {reporting.review}</p>
        <dl className="form-grid state-scope-facts">
          <div><dt>Internal target</dt><dd>{dateLabel(selected.internalTarget)}</dd></div>
          <div><dt>Nominal filing date</dt><dd>{reporting.nominalDueOn ? dateLabel(reporting.nominalDueOn) : "Needs confirmation"}</dd></div>
          <div><dt>Filing route</dt><dd>{reporting.route}</dd></div>
          <div><dt>Scope review</dt><dd>{selected.obligation.status === "Applicability review gap" ? "Confirm whether this applies" : selected.obligation.status}</dd></div>
        </dl>
      </section>}
      {reporting ? <details className="details-section">
        <summary className="min-h-11 content-center">Recorded period and source</summary>
        {obligationSource}
      </details> : <div>{obligationSource}</div>}
      {selected.obligation.report && <div><Button size="sm" variant="outline" id="compliance-open-report-prep"
        onClick={() => { if (selected.obligation) openReport(selected.obligation, current.entity.name); }}>
        Open Q{selected.obligation.report.quarter} {selected.obligation.report.year} report preparation
      </Button></div>}
      {selected.obligation.filingReceipts && <ComplianceFilingReceipts key={selected.id} brokerageId={brokerageId}
        entityId={current.entity.id} entityName={current.entity.name} basis={selected.obligation} />}
    </div>}
    <p className="muted">Internal planning and evidence review. Regulatory applicability and legal deadlines still require review before launch.</p>
    {(error || notice) && <div ref={feedback} tabIndex={-1} className={error ? "application-message banner-error" : "application-message"} role={error ? "alert" : "status"}>{error || notice}</div>}
    {screen === "list" ? <>
      <div className="form-grid">
        <label className="field">Legal entity<select value={entityId} disabled={busy} onChange={e => { pendingTarget.current = undefined; setEntity(e.target.value); setData(undefined); setLoading(true); setError(""); }}>
          <option value="">Select an entity</option>{entityOptions.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
        <label className="field">Review month<input type="month" required min="2000-01" max="2099-12" value={month} onChange={e => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value)) { pendingTarget.current = undefined; setMonth(e.target.value); setData(undefined); setLoading(true); setError(""); } }} /></label>
      </div>
      <div className="loan-application-actions">
        <Button variant="outline" onClick={() => navigate("entity")}>Add entity</Button>
        <Button variant="outline" onClick={reload}>Refresh program</Button>
        {current && <Button onClick={() => navigate("schedule")}>Schedule review</Button>}
      </div>
      {loading ? <p role="status">Loading program…</p> : !entityId ? <p>Select or add the legal entity whose internal program you want to review.</p> : current && <>
        <p>{current.counts.open} open · {current.counts.overdue} past internal target · {current.counts.unavailableOwners} needing an owner</p>
        <label className="field">Work status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{programStatuses.map(s => <option key={s}>{s}</option>)}</select></label>
        {hasFilingProgress && <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={evidenceGapsOnly} onChange={event => setEvidenceGapsOnly(event.target.checked)} />
          Filing evidence gaps only
        </label>}
        <ul className="document-list" aria-label="Monthly work">
          {visibleItems.map(item => <li className="document-item" key={item.id}>
            <div className="min-w-0 [overflow-wrap:anywhere]"><strong>{item.title}</strong><p>{item.category} · {item.status}</p><p>Internal target: {item.internalTarget} · {item.ownerAvailable ? item.ownerEmail : "Owner unavailable"}</p>
              {item.filingProgress && <p>{item.filingProgress.summary}{item.filingProgress.gaps.length > 0 &&
                <> · {item.filingProgress.gaps.length} evidence {item.filingProgress.gaps.length === 1 ? "gap" : "gaps"}</>}</p>}</div>
            <Button ref={item.id === itemId ? workButton : undefined} variant="outline"
              onClick={() => { setItem(item.id); navigate("item"); }}>Review work</Button>
          </li>)}
        </ul>
        {!visibleItems.length && <p>No work matches this month and filter.</p>}
        <Button variant="outline" disabled={!current.items.length} onClick={() => navigate("review")}>Record monthly review</Button>
        <details><summary>Monthly review history</summary>{!current.reviews.length && <p>No monthly reviews recorded.</p>}{current.reviews.map(r => <article className="document-item" key={r.id}><strong>{r.at.slice(0, 10)} · {r.actor}</strong><p>{r.note}</p><p>{r.current ? "Matches current review basis" : "Historical snapshot — review basis has changed"}</p></article>)}</details>
        <details><summary>Work history</summary>{current.history.map((h, index) => <article key={`${h.id}:${index}`}><p>{h.action} · {h.actor} · {h.at}</p><p>{h.note}</p></article>)}{current.moreHistory && <p>Showing the latest 50 events. Earlier events remain retained.</p>}</details>
      </>}
    </> : <form key={`${screen}:${selected?.id ?? ""}:${selected?.revision ?? ""}`} className="record-form" onSubmit={submit}>
      <fieldset disabled={busy} className="record-form">
        {screen === "entity" ? <>
          <label className="field">Legal entity name<input name="name" required minLength={3} maxLength={160} /></label>
          <label className="field">NMLS ID (optional)<input name="nmls" inputMode="numeric" pattern="[0-9]*" maxLength={15} /></label>
          <label className="field">Scope and review needs<textarea name="scopeNote" required minLength={5} maxLength={1500} placeholder="States, business role and items needing legal review" /></label>
        </> : screen === "review" ? <>
          <p>{current?.counts.open} work items remain open. Recording this review preserves those gaps and does not mark filings complete.</p>
          <label className="field">Review findings and next steps<textarea name="note" required minLength={5} maxLength={1500} /></label>
        </> : <>
          {screen === "schedule" ? <><label className="field">Review title<input name="title" required minLength={3} maxLength={160} /></label>
            <label className="field">Category<select name="category">{programCategories.map(c => <option key={c}>{c}</option>)}</select></label>
<<<<<<< HEAD
            <label className="field">Work to review<textarea name="instructions" required minLength={5} maxLength={1500} /></label></> : <>{!selected?.stateReview && !reporting && <p>{selected?.instructions}</p>}
            <label className="field">Work status<select name="status" defaultValue={selected?.status} aria-describedby="compliance-review-status-help">
              {programStatuses.map(s => <option key={s} disabled={s === "Completed" && !readyToComplete && selected?.status !== s}>{s}</option>)}
            </select></label>
            <p className="muted" id="compliance-review-status-help">{readyToComplete
              ? "Once the review is finished, choose Completed and record the evidence and outcome below."
              : selected?.status === "Completed"
                ? "This review is complete. Choose a different status to reopen it."
                : "When the work is ready for review, choose Awaiting review and save."}</p></>}
=======
            <label className="field">Work to review<textarea name="instructions" required minLength={5} maxLength={1500} /></label></> : <><p className="[overflow-wrap:anywhere]">{selected?.instructions}</p>
            {selected?.filingProgress && <div><h3>Filing evidence</h3><p>{selected.filingProgress.summary}</p>
              {selected.filingProgress.gaps.length > 0 && <ul className="list-disc pl-5">
                {selected.filingProgress.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}</div>}
            <label className="field">Work status<select name="status" defaultValue={selected?.status}>{programStatuses.map(s => <option key={s}>{s}</option>)}</select></label></>}
>>>>>>> 5ae41b5e (Surface linked filing evidence gaps in monthly review)
          <div className="form-grid"><label className="field">Accountable admin<select name="ownerEmail" required defaultValue={selected?.ownerAvailable ? selected.ownerEmail : ""}>
            <option value="">Select an active admin</option>{current?.owners.map(o => <option key={o.email} value={o.email}>{o.name}</option>)}</select></label>
            <label className="field">Internal target (UTC)<input name="internalTarget" type="date" required defaultValue={selected?.internalTarget ?? `${month}-28`} /></label></div>
          {screen === "item" && <><label className="field">Evidence reference<textarea name="evidence" maxLength={1500} defaultValue={selected?.evidence}
              aria-describedby="compliance-review-evidence-help" /></label>
            <p className="muted" id="compliance-review-evidence-help">Use a reference your team can retrieve, such as a ticket number or a link to a restricted file. Keep borrower data and privileged material out of these notes.</p>
            <label className="field">{selected?.stateReview ? "Decision or next action (required)" : "Reason or progress note"}
              <textarea name="note" required minLength={5} maxLength={1500} /></label></>}
        </>}
        <div className="loan-application-actions"><Button type="submit">{busy ? "Saving…" : "Save review work"}</Button>
          <Button type="button" variant="outline" onClick={() => { returnToWork.current = screen === "item"; navigate("list"); reload(); }}>
            Back to monthly review
          </Button></div>
      </fieldset>
    </form>}
  </section>;
}

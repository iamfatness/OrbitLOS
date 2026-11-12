"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import { programCategories, programStatuses, type ProgramEntity, type ProgramMonth, type ProgramRequest, type ProgramReviewTarget } from "@/lib/compliance-program-model";
import type { ObligationReviewBasis } from "@/lib/compliance-obligations-model";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [screen, setScreen] = useState<"list" | "entity" | "schedule" | "review" | "item">("list");
  const [itemId, setItem] = useState("");
  const pendingTarget = useRef(target);
  const [status, setStatus] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
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
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [brokerageId, entityId, month, paused, version]);
  useEffect(() => {
    if (paused || !target) return;
    let current = true;
    void accessComplianceCases({ type: "program", input: { operation: "entities" } }, brokerageId).then(result => {
      if (current && "kind" in result && result.kind === "programEntities") setEntities(result.entities);
    }, () => { /* The selected review can still be opened. */ });
    return () => { current = false; };
  }, [brokerageId, paused, target]);
  useEffect(() => { heading.current?.focus(); }, [screen, itemId]);
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
        setScreen("list"); setNotice("Saved internal review work.");
      }
    } catch { if (active.current) setError("Save could not be confirmed. Retry the unchanged form to check the same request."); }
    finally { if (active.current) setBusy(false); }
  }
  const current = data?.entity.id === entityId && data.month === month ? data : undefined;
  const selected = current?.items.find(i => i.id === itemId);
  const entityOptions = current && !entities.some(entity => entity.id === current.entity.id) ? [current.entity, ...entities] : entities;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (screen === "entity") void save({ operation: "createEntity", name: value(form, "name"), nmls: value(form, "nmls"), scopeNote: value(form, "scopeNote") });
    if (screen === "schedule") void save({ operation: "schedule", entityId, month, title: value(form, "title"), category: value(form, "category"),
      ownerEmail: value(form, "ownerEmail"), internalTarget: value(form, "internalTarget"), instructions: value(form, "instructions") });
    if (screen === "item" && selected) void save({ operation: "update", entityId, month, id: selected.id, expectedRevision: selected.revision,
      status: value(form, "status"), ownerEmail: value(form, "ownerEmail"), internalTarget: value(form, "internalTarget"), evidence: value(form, "evidence"), note: value(form, "note") });
    if (screen === "review" && current) void save({ operation: "reviewMonth", entityId, month, fingerprint: current.fingerprint, note: value(form, "note") });
  }
  const formTitle = screen === "entity" ? "Add entity profile" : screen === "schedule" ? "Schedule review work" : screen === "review" ? "Record monthly review" : selected?.title ?? "Monthly review";
  if (paused) return <p>Program work is unavailable while the workspace is paused.</p>;
  return <section className="integration manager-panel record-form compliance-pilot-form" aria-label="Compliance program">
    <h2 ref={heading} tabIndex={-1}>{screen === "list" ? "Monthly review" : formTitle}</h2>
    {screen === "item" && current && <p className="muted">{current.entity.name} · Review month {current.month}</p>}
    {screen === "item" && selected?.stateReview && <section className="record-form" aria-label="Saved state review basis">
      <h3>{selected.stateReview.entityName} · {selected.stateReview.jurisdiction} state record v{selected.stateReview.revision}</h3>
      <p><strong>Question</strong> · {selected.instructions}</p>
      <p><a className="name-link break-words" href={selected.stateReview.source.sourceUrl} target="_blank" rel="noreferrer">
        {selected.stateReview.source.title}</a></p>
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
      <div><strong>Recorded period {selected.obligation.period} · Obligation version {selected.obligation.version}</strong>
        <p>{selected.obligation.status}</p>
        {selected.obligation.stateBasis && <p>{selected.obligation.stateBasis.jurisdiction} · State scope version {selected.obligation.stateBasis.revision}</p>}
        <a className="name-link break-words" href={selected.obligation.sourceUrl} target="_blank" rel="noreferrer">{selected.obligation.authority}</a>
      </div>
      {selected.obligation.report && <div><Button size="sm" variant="outline" id="compliance-open-report-prep"
        onClick={() => { if (selected.obligation) openReport(selected.obligation, current.entity.name); }}>
        Open Q{selected.obligation.report.quarter} {selected.obligation.report.year} report preparation
      </Button></div>}
      {selected.obligation.report && <ComplianceFilingReceipts key={selected.id} brokerageId={brokerageId}
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
        <ul className="document-list" aria-label="Monthly work">
          {current.items.filter(i => !status || i.status === status).map(item => <li className="document-item" key={item.id}>
            <div><strong>{item.title}</strong><p>{item.category} · {item.status}</p><p>Internal target: {item.internalTarget} · {item.ownerAvailable ? item.ownerEmail : "Owner unavailable"}</p></div>
            <Button variant="outline" onClick={() => { setItem(item.id); navigate("item"); }}>Review work</Button>
          </li>)}
        </ul>
        {!current.items.some(i => !status || i.status === status) && <p>No work matches this month and filter.</p>}
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
            <label className="field">Work to review<textarea name="instructions" required minLength={5} maxLength={1500} /></label></> : <>{!selected?.stateReview && <p>{selected?.instructions}</p>}
            <label className="field">Work status<select name="status" defaultValue={selected?.status}>{programStatuses.map(s => <option key={s}>{s}</option>)}</select></label></>}
          <div className="form-grid"><label className="field">Accountable admin<select name="ownerEmail" required defaultValue={selected?.ownerAvailable ? selected.ownerEmail : ""}>
            <option value="">Select an active admin</option>{current?.owners.map(o => <option key={o.email} value={o.email}>{o.name}</option>)}</select></label>
            <label className="field">Internal target (UTC)<input name="internalTarget" type="date" required defaultValue={selected?.internalTarget ?? `${month}-28`} /></label></div>
          {screen === "item" && <><label className="field">Evidence reference<textarea name="evidence" maxLength={1500} defaultValue={selected?.evidence} /></label>
            <p className="muted">Reference reviewed records; keep borrower data and privileged material out of these notes. Completion requires Awaiting review and an evidence reference.</p>
            <label className="field">{selected?.stateReview ? "Decision or next action" : "Reason or progress note"}
              <textarea name="note" required minLength={5} maxLength={1500} /></label></>}
        </>}
        <div className="loan-application-actions"><Button type="submit">{busy ? "Saving…" : "Save review work"}</Button><Button type="button" variant="outline" onClick={() => { navigate("list"); reload(); }}>Back to monthly review</Button></div>
      </fieldset>
    </form>}
  </section>;
}

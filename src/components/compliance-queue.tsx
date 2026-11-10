"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { accessComplianceCases } from "@/app/actions";
import { complianceCaseKinds, complianceCaseStatuses, complianceCaseTarget, complianceTarget } from "@/lib/compliance-case-model";
import type { ComplianceCaseResult } from "@/lib/compliance-cases";
import type { MigrationDestination } from "@/lib/migration-record-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { ComplianceInventory } from "./compliance-inventory";
import { ComplianceLeadBackfill } from "./compliance-lead-backfill";

type Queue = Extract<ComplianceCaseResult, { kind: "list" }>;
type Query = { type: "list"; loanId?: string; kind?: Queue["items"][number]["kind"]; status?: Queue["items"][number]["status"]; after?: NonNullable<Queue["next"]> };

export function ComplianceQueue({ brokerageId, admin, loanId, initialCaseId, openLoan, openHistoryRecord, openDisclosures }: {
  brokerageId: string; admin: boolean; loanId?: string; initialCaseId?: string;
  openLoan?: (loanId: string, caseId?: string) => void; openHistoryRecord?: (destination: MigrationDestination) => void; openDisclosures?: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState<Query>({ type: "list", loanId });
  const [caseId, setCaseId] = useState(initialCaseId);
  const [version, refresh] = useState(0);
  const [response, setResponse] = useState<{ query: Query; caseId?: string; version: number; data: ComplianceCaseResult }>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const attempt = useRef<{ key: string; requestId: string }>(null);
  const focus = useRef<string>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let current = true;
    const update = (data: ComplianceCaseResult) => { if (current) setResponse({ query, caseId, version, data }); };
    void accessComplianceCases(caseId ? { type: "read", caseId, loanId } : query, brokerageId).then(update, () => update({ error: "Could not load compliance work. Try again." }));
    return () => { current = false; };
  }, [brokerageId, query, caseId, loanId, version]);
  const data = response?.query === query && response.caseId === caseId && response.version === version ? response.data : undefined;
  const list = data && "kind" in data && data.kind === "list" ? data : undefined;
  const detail = data && "kind" in data && data.kind === "detail" ? data : undefined;
  const loaded = Boolean(data);
  useEffect(() => {
    if (!loaded || focus.current === undefined) return;
    const target = focus.current ? document.getElementById(`${id}-${focus.current}`) : null;
    (target ?? heading.current)?.focus();
    if (caseId) heading.current?.scrollIntoView({ block: "start" });
    focus.current = undefined;
  }, [caseId, id, loaded]);

  function open(next?: string) {
    focus.current = next ? "" : caseId ?? "";
    setMessage(undefined);
    setCaseId(next);
  }

  async function save(input: Record<string, unknown>, success: string) {
    if (pending) return;
    setPending(true);
    setMessage(undefined);
    try {
      const command = detail ? { caseId: detail.item.id, expectedRevision: detail.item.revision, ...input } : input;
      const key = JSON.stringify(command);
      if (attempt.current?.key !== key) attempt.current = { key, requestId: crypto.randomUUID() };
      const result = await accessComplianceCases(detail ? { ...command, requestId: attempt.current.requestId } : command, brokerageId);
      if ("error" in result) { setMessage({ text: result.error, error: true }); return; }
      if (result.kind !== "detail") return;
      attempt.current = null;
      if (result.item.id === caseId) setResponse({ query, caseId, version, data: result });
      else open(result.item.id);
      setMessage({ text: success });
    } catch { setMessage({ text: "Could not save compliance work. Try again.", error: true }); }
    finally { setPending(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>, type: "updateStatus" | "assign", field: "status" | "ownerEmail", success: string) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get(field);
    if (value) void save({ type, [field]: value }, success);
  }

  const title = detail?.item.title ?? (loanId ? "File compliance" : "Compliance work queue");
  const currentLoanId = detail?.item.loanId;
  const Heading = loanId || detail ? "h3" : "h2";
  return <section id={loanId ? initialCaseId ? complianceCaseTarget(initialCaseId) : complianceTarget : undefined} tabIndex={loanId ? -1 : undefined}
    className={`${loanId ? "details-section" : "integration manager-panel"} compliance-work record-form`} aria-labelledby={`${id}-heading`}>
    <div className="section-heading"><Heading id={`${id}-heading`} ref={heading} tabIndex={-1}>{title}</Heading>
      {caseId ? <Button size="sm" variant="outline" disabled={pending} onClick={() => open()}>Back to cases</Button> :
        <Button size="sm" variant="outline" disabled={pending} onClick={() => { setQuery({ ...query, after: undefined }); setMessage(undefined); }}>Refresh cases</Button>}</div>
    <div className="document-item compliance-coverage"><strong>Coverage not evaluated</strong><p>Fictional cases and sample evidence only.</p></div>
    {admin && !loanId && !caseId && openLoan && <ComplianceInventory key={brokerageId} brokerageId={brokerageId} openLoan={openLoan} />}
    {admin && !loanId && !caseId && openHistoryRecord && <ComplianceLeadBackfill key={`lead:${brokerageId}`}
      brokerageId={brokerageId} openRecord={openHistoryRecord} />}
    {!data && <p role="status" className="muted">Loading compliance work…</p>}
    {data && "error" in data && <div className="loan-application-actions"><p role="alert">{data.error}</p>
      <Button size="sm" variant="outline" onClick={() => { setQuery({ ...query, after: undefined }); refresh((value) => value + 1); }}>Reload</Button></div>}
    {!loanId && !caseId && <div className="calendar-filters">
        <label className="field">Case type<select value={query.kind ?? ""} onChange={(event) => setQuery({ ...query, kind: (event.target.value || undefined) as Query["kind"], after: undefined })}>
          <option value="">All case types</option>{complianceCaseKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label className="field">Workflow status<select value={query.status ?? ""} onChange={(event) => setQuery({ ...query, status: (event.target.value || undefined) as Query["status"], after: undefined })}>
          <option value="">All statuses</option>{complianceCaseStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
    </div>}
    {list && <>
      <p role="status" className="muted">{list.counts.cases} {list.counts.cases === 1 ? "case" : "cases"} · {list.counts.files} {list.counts.files === 1 ? "affected file" : "affected files"}</p>
      {list.items.length ? <ul className="loan-task-list">{list.items.map((item) => <li className="loan-task compliance-row" key={item.id}>
        <div className="loan-task-copy"><strong>{item.title}</strong><span>{item.kind} · {item.status}</span>
          <span>{item.ownerState === "Assigned" ? "Owner" : item.ownerState}{item.ownerName && ` · ${item.ownerName}`}</span></div>
        <Button id={`${id}-${item.id}`} size="sm" variant="outline" disabled={pending} aria-label={`Open case ${item.title}`} onClick={() => open(item.id)}>Open case</Button>
      </li>)}</ul> : <p className="muted">{query.kind || query.status ? "No cases match these filters." : loanId ? "No sample findings on this file." : "No sample cases yet. Open a fictional loan’s Compliance section to start."}</p>}
      {loanId && admin && <div className="loan-application-actions">
        {list.samplePackageVersion && !list.items.some((item) => item.packageVersion === list.samplePackageVersion) ?
          <Button size="sm" disabled={pending} onClick={() => void save({ type: "openFixture", loanId, packageVersion: list.samplePackageVersion }, "Sample cases opened.")}>Open sample finding</Button> :
          !list.samplePackageVersion && openDisclosures && <Button size="sm" variant="outline" onClick={openDisclosures}>Open sample disclosures</Button>}
      </div>}
      {(query.after || list.next) && <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: undefined })}>First page</Button>}
        {list.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: list.next ?? undefined })}>Next page</Button>}
      </div>}
    </>}
    {detail && <>
      <p><strong>{detail.item.kind}</strong> · {detail.item.status}</p>
      <p className="muted">{detail.item.ownerState === "Assigned" ? "Owner" : detail.item.ownerState}{detail.item.ownerName && ` · ${detail.item.ownerName}`} · Deadline undetermined</p>
      {detail.item.loanId && <div className="document-item record-form"><strong>Sample package v{detail.item.packageVersion} · {detail.packageState}</strong>
        <p>{detail.sampleReview ? `Sample workbench review recorded for revision ${detail.sampleReview.packageRevision}.` :
          detail.packageState !== "Current" ? "Open the current file for new evidence. This case retains its original history." :
            detail.sampleReviewRevision ? "The current sample workbench review is available to record here." : "Current sample workbench review is missing."}</p>
        <div className="loan-application-actions">
          {openLoan && currentLoanId && <Button size="sm" onClick={() => openLoan(currentLoanId, detail.item.id)}>Open file finding</Button>}
          {openDisclosures && detail.packageState === "Current" && <Button size="sm" variant="outline" onClick={openDisclosures}>Open sample disclosures</Button>}
          {admin && detail.sampleReviewRevision && !detail.sampleReview && <Button size="sm" disabled={pending}
            onClick={() => void save({ type: "recordSampleReview", packageRevision: detail.sampleReviewRevision }, "Sample workbench review recorded.")}>Record sample review</Button>}
        </div>
      </div>}
      {detail.canUpdateStatus && <form className="calendar-filters" key={`status-${detail.item.id}`}
        onSubmit={(event) => submit(event, "updateStatus", "status", "Workflow status saved.")}>
        <label className="field">Workflow status<select name="status" defaultValue={detail.item.status} disabled={pending}>{complianceCaseStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <Button size="sm" variant="outline" type="submit" disabled={pending}>Save status</Button>
      </form>}
      {detail.assignableOwners.length > 0 && <form className="calendar-filters" key={`owner-${detail.item.id}`}
        onSubmit={(event) => submit(event, "assign", "ownerEmail", "Case owner saved.")}>
        <label className="field">Case owner<select name="ownerEmail" required disabled={pending} defaultValue={detail.item.ownerState === "Assigned" ? detail.item.ownerEmail ?? "" : ""}>
          <option value="">Choose active staff</option>{detail.assignableOwners.map(({ email, name }) => <option value={email} key={email}>{name || email}</option>)}</select></label>
        <Button size="sm" variant="outline" type="submit" disabled={pending}>Save owner</Button>
      </form>}
      {!loanId && detail.item.parentCaseId && <Button size="sm" variant="outline" disabled={pending} onClick={() => open(detail.item.parentCaseId ?? undefined)}>Open related case</Button>}
      <details className="document-form"><summary>Case history</summary><ul className="loan-task-list">{detail.history.map((event) => <li key={event.revision} className="loan-task compliance-row">
        <div className="loan-task-copy"><strong>{({ recordSampleReview: "Recorded sample workbench review", assign: "Changed case owner", updateStatus: "Changed workflow status" })[event.action] ?? event.action}</strong>
          <span>{event.actor} · {dateTime(event.at)} ET · Revision {event.revision}</span></div></li>)}</ul>{detail.moreHistory && <p className="muted">Showing the most recent 50 changes.</p>}</details>
    </>}
    {message && <p role={message.error ? "alert" : "status"}>{message.text}</p>}
    {message?.error && detail && <Button size="sm" variant="outline" disabled={pending} onClick={() => { setMessage(undefined); refresh((value) => value + 1); }}>Reload case</Button>}
  </section>;
}

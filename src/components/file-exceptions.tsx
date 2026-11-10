"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { readManagerFileExceptions } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { fileExceptionFilters, overdueManualReturnFilter, unattendedManualReturnFilter,
  type FileException, type FileExceptionPage, type FileExceptionQuery } from "@/lib/file-exception-model";
import { cn, dateTime } from "@/lib/utils";
import { observeTabReturn, observeVisibleChecks } from "@/lib/tab-return";
import type { ManualReturnAssignment } from "@/lib/lender-export-model";
import { Button } from "./ui/button";
import { lenderReturnFollowUpLabel } from "./lender-return-follow-up";

function fileExceptionAction(item: FileException) {
  switch (item.kind) {
    case "Missing evidence": return "Open document request";
    case "Internal reviews": return "Open internal review";
    case "Required 1003 approvals": return item.status === "Reviewer needed" ? "Assign second reviewer" : "Open second review";
    case "Manual lender returns": return item.action;
    case "Closing and funding holds": return "Open required evidence";
    case "Unassigned handoffs": return "Open processing handoff";
    case "Disclosure reviews": return "Open disclosure review";
    default: return "Open lender condition";
  }
}

export function FileExceptions({ brokerageId, version, busy, open, assign, standalone = false }: {
  brokerageId: string; version: object; busy: boolean; open: (item: FileException, trigger: HTMLButtonElement) => void;
  assign?: (loanId: string, manualReturn: ManualReturnAssignment) => void;
  standalone?: boolean;
}) {
  const [query, setQuery] = useState<FileExceptionQuery>({ filter: "All file exceptions" });
  const [result, setResult] = useState<{ brokerageId: string; query: FileExceptionQuery; version: object; data: FileExceptionPage | { error: string } }>();
  const watch = !query.after && !busy;
  const watchChecks = standalone || ["Manual lender returns", overdueManualReturnFilter, unattendedManualReturnFilter].includes(query.filter);
  useEffect(() => {
    let active = true;
    let reading = false;
    async function refresh(isCurrent: () => boolean, initial = false) {
      if (reading) return;
      reading = true;
      try {
        const data = await readManagerFileExceptions(query, brokerageId);
        if (active && isCurrent()) setResult({ brokerageId, query, version, data });
      } catch {
        if (active && initial) setResult({ brokerageId, query, version, data: { error: "Could not load file exceptions. Refresh to try again." } });
      } finally { reading = false; }
    }
    void refresh(() => true, true);
    const stopReturn = watch && watchChecks ? observeTabReturn(document, window, (isCurrent) => void refresh(isCurrent)) : undefined;
    const stopChecks = watch && watchChecks ? observeVisibleChecks(document, window, refresh, standalone ? 60_000 : undefined) : undefined;
    return () => { active = false; stopReturn?.(); stopChecks?.(); };
  }, [brokerageId, query, version, watch, watchChecks, standalone]);
  const current = result?.brokerageId === brokerageId && result.query === query ? result : undefined;
  const data = current?.data;
  const page = data && !("error" in data) ? data : undefined;
  return <section className={cn("record-form", standalone && "integration file-exception-panel")} aria-label="File exceptions" aria-busy={current?.version !== version}>
    <div className="section-heading">{standalone ? <h2>File exceptions</h2> : <h3>File exceptions</h3>}
      <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: undefined })}><RefreshCw /> Refresh file exceptions</Button></div>
    <p className="muted">Find files that need an assignment, evidence, or a review. Open an item to act on the loan.</p>
    <label className="field playbook-filter">File exception type<select id={standalone ? "owner-exception-filter" : undefined} value={query.filter} onChange={(event) => setQuery({ filter: event.target.value as FileExceptionQuery["filter"] })}>
      {fileExceptionFilters.map((filter) => <option key={filter}>{filter}</option>)}
    </select></label>
    {!data && <p className="muted" role="status">Loading file exceptions…</p>}
    {data && "error" in data && <p role="alert">{data.error}</p>}
    {page && <>
      {page.items.length ? <ul className="playbook-exceptions">{page.items.map((item) => <li className="document-item" key={`${item.kind}:${item.parentId}:${item.id}`}>
        <div className="document-item-head"><strong>{item.title} · {item.borrower}</strong><span className="pill">{item.status}</span></div>
        <p>{item.action}</p>
        <p className="muted">{item.owner ? `Staff owner · ${item.owner}${item.ownerAvailable ? "" : " · Owner unavailable"}` : "Staff owner · Unassigned"}
          {item.dueOn ? ` · Due ${dateLabel(item.dueOn)}` : item.kind === "Required 1003 approvals" ? " · Due date pending" : null}
          {item.dueAt && ` · Due ${dateTime(item.dueAt)} ET`}
          {item.reopenedAt && ` · ${item.kind === "Manual lender returns" ? "Returned" : "Reopened"} ${dateTime(item.reopenedAt)} ET`}</p>
        {item.returnDueAt && <p className={item.overdue ? "open-chip" : "muted"}>
          {item.overdue ? "Return overdue since" : "Follow up by"} {dateTime(item.returnDueAt)} ET
        </p>}
        {item.returnFollowUp ? <div><p className="muted">{lenderReturnFollowUpLabel(item.returnFollowUp)}</p><p>{item.returnFollowUp.note}</p></div> :
          item.returnEventId && <p className="muted">No follow-up logged yet.</p>}
        {(item.evidence || item.nextParty || item.overdue || item.escalated) && <p className="muted">
          {[item.evidence, item.nextParty && `${item.kind === "Manual lender returns" ? "Lender file" : "Manual condition next party"} · ${item.nextParty}`, item.overdue && !item.returnDueAt && "Overdue", item.escalated && "Escalated"].filter(Boolean).join(" · ")}
        </p>}
        <div className="loan-application-actions"><Button size="sm" variant="outline" disabled={busy}
          aria-label={`${fileExceptionAction(item)} for ${item.borrower} · ${item.title}`} onClick={(event) => open(item, event.currentTarget)}>
          {fileExceptionAction(item)}
        </Button>
          {assign && item.returnEventId && <Button size="sm" variant="outline" disabled={busy} aria-label={`Reassign loan for ${item.borrower}`}
            onClick={() => assign(item.loanId, { eventId: item.returnEventId!, submissionId: item.id })}>Reassign loan</Button>}
        </div>
      </li>)}</ul> : <p className="empty-inline" role="status">{query.after ? "No more exceptions on this page." :
        query.filter === "All file exceptions" ? "You're caught up. No open file exceptions." : "No open file exceptions match this filter."}</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: undefined })}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: page.next ?? undefined })}>Next page</Button>}
      </div>
    </>}
  </section>;
}

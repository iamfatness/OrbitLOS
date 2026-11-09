"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { readManagerFileExceptions } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { fileExceptionFilters, overdueManualReturnFilter, type FileException, type FileExceptionPage, type FileExceptionQuery } from "@/lib/file-exception-model";
import { dateTime } from "@/lib/utils";
import { observeTabReturn, observeVisibleChecks } from "@/lib/tab-return";
import type { ManualReturnAssignment } from "@/lib/lender-export-model";
import { Button } from "./ui/button";

function fileExceptionAction(item: FileException) {
  switch (item.kind) {
    case "Missing evidence": return "Open document request";
    case "Internal reviews": return "Open internal review";
    case "Required 1003 approvals": return item.status === "Reviewer needed" ? "Assign second reviewer" : "Open second review";
    case "Manual lender returns": return item.action;
    default: return "Open lender condition";
  }
}

export function FileExceptions({ brokerageId, version, busy, open, assign }: {
  brokerageId: string; version: object; busy: boolean; open: (item: FileException) => void;
  assign?: (loanId: string, manualReturn: ManualReturnAssignment) => void;
}) {
  const [query, setQuery] = useState<FileExceptionQuery>({ filter: "All file exceptions" });
  const [result, setResult] = useState<{ query: FileExceptionQuery; version: object; data: FileExceptionPage | { error: string } }>();
  const watchReturns = (query.filter === "Manual lender returns" || query.filter === overdueManualReturnFilter) && !query.after && !busy;
  useEffect(() => {
    let active = true;
    let reading = false;
    async function refresh(isCurrent: () => boolean, initial = false) {
      if (reading) return;
      reading = true;
      try {
        const data = await readManagerFileExceptions(query, brokerageId);
        if (active && isCurrent()) setResult({ query, version, data });
      } catch {
        if (active && initial) setResult({ query, version, data: { error: "Could not load file exceptions. Refresh to try again." } });
      } finally { reading = false; }
    }
    void refresh(() => true, true);
    const stopReturn = watchReturns ? observeTabReturn(document, window, (isCurrent) => void refresh(isCurrent)) : undefined;
    const stopChecks = watchReturns ? observeVisibleChecks(document, window, refresh) : undefined;
    return () => { active = false; stopReturn?.(); stopChecks?.(); };
  }, [brokerageId, query, version, watchReturns]);
  const data = result?.query === query && result.version === version ? result.data : undefined;
  const page = data && !("error" in data) ? data : undefined;
  return <section className="record-form" aria-label="File exceptions">
    <div className="section-heading"><h3>File exceptions</h3>
      <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: undefined })}><RefreshCw /> Refresh file exceptions</Button></div>
    <p className="muted">Work outstanding evidence, required 1003 approvals, internal reviews, and lender returns or reopened conditions.</p>
    <label className="field playbook-filter">File exception type<select value={query.filter} onChange={(event) => setQuery({ filter: event.target.value as FileExceptionQuery["filter"] })}>
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
          {item.reopenedAt && ` · ${item.kind === "Manual lender returns" ? "Returned" : "Reopened"} ${dateTime(item.reopenedAt)} ET`}</p>
        {item.returnDueAt && <p className={item.overdue ? "open-chip" : "muted"}>
          {item.overdue ? "Follow-up overdue since" : "Follow up by"} {dateTime(item.returnDueAt)} ET
        </p>}
        {(item.evidence || item.nextParty || item.overdue || item.escalated) && <p className="muted">
          {[item.evidence, item.nextParty && `${item.kind === "Manual lender returns" ? "Lender file" : "Manual condition next party"} · ${item.nextParty}`, item.overdue && !item.returnDueAt && "Overdue", item.escalated && "Escalated"].filter(Boolean).join(" · ")}
        </p>}
        <div className="loan-application-actions"><Button size="sm" variant="outline" disabled={busy}
          aria-label={`${item.kind === "Required 1003 approvals" || item.kind === "Manual lender returns" ? fileExceptionAction(item) : `Open ${item.title}`} for ${item.borrower}`} onClick={() => open(item)}>
          {fileExceptionAction(item)}
        </Button>
          {assign && item.returnEventId && <Button size="sm" variant="outline" disabled={busy} aria-label={`Reassign loan for ${item.borrower}`}
            onClick={() => assign(item.loanId, { eventId: item.returnEventId!, submissionId: item.id })}>Reassign loan</Button>}
        </div>
      </li>)}</ul> : <p className="empty-inline">No open file exceptions match this view.</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: undefined })}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, after: page.next ?? undefined })}>Next page</Button>}
      </div>
    </>}
  </section>;
}

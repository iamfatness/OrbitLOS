"use client";

import { useState } from "react";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import type { LoanAuditEvent } from "@/lib/loan-audit";
import { dateTime, money } from "@/lib/utils";
import { Button } from "./ui/button";

export function LoanAudit({ loanId, busy, save }: {
  loanId: string; busy: boolean; save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
}) {
  const [history, setHistory] = useState<LoanAuditEvent[]>();
  const value = (field: string, item: string | number | null) =>
    item === null ? "—" : typeof item === "number" && field.toLowerCase().includes("amount") ? (item ? money(item) : "$0") : item;
  return <section className="details-section" aria-label="Loan audit history">
    <h3>Loan audit history</h3>
    <p className="muted">See up to 100 recent changes to loan, assignment, and reporting fields. History starts when this feature was enabled.</p>
    <div className="loan-application-actions"><Button variant="outline" size="sm" disabled={busy} onClick={() =>
      void save({ type: "loadLoanAudit", loanId }, ({ loanAudit }) => setHistory(loanAudit))
    }>{history ? "Refresh audit history" : "Load audit history"}</Button></div>
    {history && (history.length ? <ul className="loan-task-list">{history.map((entry) => <li className="loan-task" key={entry.id}>
      <div className="loan-task-copy">
        <strong>{entry.action}</strong><span>{entry.actor} · {dateTime(entry.occurredAt)} ET</span>
        {entry.changes.map((change) => <span key={change.field}>{change.field} · {value(change.field, change.before)} → {value(change.field, change.after)}</span>)}
      </div>
    </li>)}</ul> : <p className="muted">There are no tracked changes on this file yet.</p>)}
  </section>;
}

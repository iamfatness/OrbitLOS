"use client";

import { useState, type FormEvent } from "react";
import { dispositions, type Disposition, type Loan, type Workspace } from "@/lib/model";
import { loanNextAction, pausedLoan } from "@/lib/loan-workflow";
import { dateTime, stageDays } from "@/lib/utils";
import { Button } from "./ui/button";

export function LoanWorkflow({ loan, state, busy, readOnly, save, open }: {
  loan: Loan; state: Workspace; busy: boolean; readOnly?: boolean; save: (input: unknown) => void; open: (target: string) => void;
}) {
  const current = loan.disposition ?? "Active";
  const [disposition, setDisposition] = useState<Disposition>(current);
  const action = loanNextAction(loan, state);
  const canChange = !readOnly && loan.stage !== "Funded" && loan.stage !== "Closed";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    save({ type: "loanDisposition", loanId: loan.id, disposition, reason: String(fields.get("reason") ?? ""),
      revisitDate: fields.get("revisitDate") || null, revision: loan.dispositionRevision ?? 0 });
  }

  return <section className="details-section" aria-label="Loan next action" id="loan-workflow" tabIndex={-1}>
    <div className="section-heading"><h3>Next action</h3><span className="pill">{current}</span></div>
    <div className="details-grid">
      <div><span>Stage</span><strong suppressHydrationWarning>{loan.stage} · {stageDays(loan.stageSince)} days</strong></div>
      <div><span>Owner</span><strong>{loan.officer || "Unassigned"}</strong></div>
      <div><span>Due</span><strong>{action.dueAt ? `${dateTime(action.dueAt)} ET` : "No date set"}</strong></div>
      <div><span>Blocker</span><strong>{action.blocker || "None recorded"}</strong></div>
    </div>
    {action.target !== "loan-workflow" && <Button variant="outline" size="sm" onClick={() => open(action.target)}>{action.title}</Button>}
    {canChange && <details className="loan-task-create" open={pausedLoan(loan) || undefined}>
      <summary>Change loan status</summary>
      <form className="task-form" onSubmit={submit}>
        <label className="field">Loan status<select value={disposition} onChange={(event) => setDisposition(event.target.value as Disposition)}>
          {dispositions.map((item) => <option key={item} value={item}>{item === "Active" && pausedLoan(loan) ? "Reopen to active" : item}</option>)}
        </select></label>
        {disposition !== "Active" && <label className="field">Reason<input name="reason" defaultValue={loan.dispositionReason} required maxLength={500} /></label>}
        {disposition === "On hold" && <label className="field">Revisit on<input type="date" name="revisitDate" defaultValue={loan.revisitDate ?? ""} /></label>}
        <Button size="sm" type="submit" disabled={busy}>Save status</Button>
      </form>
    </details>}
  </section>;
}

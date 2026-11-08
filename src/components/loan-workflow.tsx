"use client";

import { useState, type FormEvent } from "react";
import { dispositions, type Disposition, type Loan } from "@/lib/model";
import { pausedLoan } from "@/lib/loan-workflow";
import { Button } from "./ui/button";

export function LoanWorkflow({ loan, busy, readOnly, save }: {
  loan: Loan; busy: boolean; readOnly?: boolean; save: (input: unknown) => void;
}) {
  const current = loan.disposition ?? "Active";
  const [disposition, setDisposition] = useState<Disposition>(current);
  const canChange = !readOnly && loan.stage !== "Funded" && loan.stage !== "Closed";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    save({ type: "loanDisposition", loanId: loan.id, disposition, reason: String(fields.get("reason") ?? ""),
      revisitDate: fields.get("revisitDate") || null, revision: loan.dispositionRevision ?? 0 });
  }

  return <section className="details-section" aria-label="Loan workflow" id="loan-workflow" tabIndex={-1}>
    <div className="section-heading"><h3>Loan workflow</h3><span className="pill">{current}</span></div>
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

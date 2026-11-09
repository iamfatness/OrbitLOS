"use client";

import { useRef } from "react";
import { manualHandoffOutcomes } from "@/lib/application-model";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import type { Loan, Workspace } from "@/lib/model";
import { money } from "@/lib/utils";
import { Button } from "./ui/button";
import { PreapprovalLetters } from "./preapproval-letters";

export function FileReadiness({ loan, state, busy, save, open, preapprovalBrokerage }: {
  loan: Loan; state: Workspace; busy: boolean;
  preapprovalBrokerage?: string;
  save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
  open: (target: string) => void;
}) {
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const application = state.applications.find((item) => item.loanId === loan.id);
  const documents = state.documentRequests.filter((item) => item.loanId === loan.id);
  const findings = state.mockCreditAusRuns.filter((item) => item.loanId === loan.id);
  const latest = (service: "Credit" | "DU" | "LPA") => findings.find((item) => item.service === service);
  const borrower = state.contacts.find((item) => item.id === loan.contactId)?.name || "Borrower";
  const openItems = documents.filter((item) => item.status !== "Accepted");
  const status = application?.reviewedAt ? "Reviewed" : application?.submittedAt ? "Waiting for review" :
    application?.correctionNote ? "Waiting for borrower corrections" : "Waiting for a submitted 1003";
  const summary = [
    `Fictional file summary · ${borrower}`,
    `${loan.purpose} · ${money(loan.amount)} · ${loan.stage}`,
    `Application: ${status}${application?.submittedAt ? ` · revision ${application.revision}` : ""}`,
    ...documents.map((item) => `${item.kind}: ${item.status} · document revision ${item.revision}`),
    ...(documents.length ? [] : ["Document checklist: no requests entered"]),
    ...(["Credit", "DU", "LPA"] as const).map((service) => {
      const run = latest(service);
      return `${service}: ${run ? `${run.result.status} · sample reference ${run.reference}` : "No sample run"}`;
    }),
  ].join("\n");

  return <section className="details-section" id="file-readiness" tabIndex={-1} aria-label="File readiness">
    <div className="section-heading"><h3>File readiness</h3><span className="pill">{openItems.length} open document requests</span></div>
    <div className="loan-application-actions">
      <Button size="sm" variant="outline" onClick={() => open("loan-application")}>1003 · {status}</Button>
      <Button size="sm" variant="outline" onClick={() => open("document-checklist")}>Open document checklist</Button>
      <Button size="sm" variant="outline" onClick={() => open("credit-aus")}>Review mock credit and AUS</Button>
    </div>
    {openItems.length > 0 && <ul className="loan-task-list">{openItems.map((item) => <li key={item.id}>
      <button className="name-link" type="button" onClick={() => open(`document-${item.id}`)}>{item.kind} · {item.status}</button>
    </li>)}</ul>}
    <details className="loan-task-create" id="manual-lender-handoff"><summary>Preview file summary and record a handoff</summary>
      <label className="field">File summary<textarea rows={7} readOnly value={summary} /></label>
      {application?.reviewedAt && <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        const input = { type: "recordManualHandoff", loanId: loan.id, revision: application.revision, lenderRevision: application.lender?.revision ?? 0,
          outcome: fields.get("outcome"), note: fields.get("note") };
        const key = JSON.stringify(input);
        if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
        void save({ ...input, eventId: attempt.current.id }, () => { attempt.current = null; form.reset(); });
      }}>
        <label className="field">Handoff outcome<select name="outcome">
          {manualHandoffOutcomes.map((outcome) => <option key={outcome}>{outcome}</option>)}
        </select></label>
        <label className="field">Handoff note<textarea name="note" rows={2} maxLength={500} /></label>
        <div><Button size="sm" disabled={busy} type="submit">Record manual handoff</Button></div>
      </form>}
    </details>
    {preapprovalBrokerage && (loan.purpose === "Purchase" || !!application?.reviewedAt) &&
      <PreapprovalLetters loanId={loan.id} brokerageId={preapprovalBrokerage} revision={application?.revision} />}
  </section>;
}

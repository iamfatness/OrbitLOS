"use client";

import { useRef, useState, type FormEvent } from "react";
import { accessBrokerageFinance } from "@/app/actions";
import { financeMoney, settlementEvidence, type FinanceLoan, type SettlementEvidence, type SettlementEvidencePreview } from "@/lib/brokerage-finance-model";
import { dateLabel } from "@/lib/client-retention";
import { Button } from "./ui/button";
import { downloadSampleFile } from "./sample-download";

export function SettlementEvidenceImport({ brokerageId, loan, busy, onSaved }: {
  brokerageId: string; loan: FinanceLoan; busy: boolean; onSaved: (message: string) => void;
}) {
  const [kind, setKind] = useState<SettlementEvidence["kind"]>("Purchase advice");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<{ evidence: SettlementEvidence; result: SettlementEvidencePreview; entryId: string }>();
  const feedback = useRef<HTMLDivElement>(null);
  const pending = useRef(false);

  function update(value: string) {
    setText(value);
    setPreview(undefined);
    setError("");
  }

  function downloadExample() {
    const id = crypto.randomUUID();
    const base = { schemaVersion: 1, source: "orbit-sample", evidenceId: id, loanId: loan.id, cycle: loan.cycle,
      fundingDate: loan.date, occurredOn: loan.date, reference: `SAMPLE-${id.slice(0, 8)}` };
    const example = kind === "Purchase advice" ?
      { ...base, kind, sequence: 1, grossCents: 35_000_000, feesCents: 125_000, adjustmentCents: 0 } :
      { ...base, kind, amountCents: 34_875_000 };
    downloadSampleFile(JSON.stringify(example, null, 2), "orbit-sample-settlement-evidence.json", "application/json");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || busy) return;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch {
      setError("Paste valid JSON. Download an example to check the format.");
      requestAnimationFrame(() => feedback.current?.focus());
      return;
    }
    const parsed = settlementEvidence.safeParse(raw);
    if (!parsed.success) {
      setError("Check the evidence fields and whole-cent amounts against the example.");
      requestAnimationFrame(() => feedback.current?.focus());
      return;
    }
    pending.current = true;
    setWorking(true);
    setError("");
    const target = { loanId: loan.id, cycle: loan.cycle, evidence: parsed.data };
    try {
      const response = await accessBrokerageFinance(preview ? { ...target, type: "settlementEvidenceImport",
        fundingDate: loan.date, revision: preview.result.revision, entryId: preview.entryId } :
        { ...target, type: "settlementEvidencePreview" }, brokerageId);
      if ("error" in response) {
        setError(response.error);
        setPreview(undefined);
      } else if (response.kind === "settlementEvidencePreview") {
        setPreview({ evidence: parsed.data, result: response, entryId: crypto.randomUUID() });
      } else if (response.kind === "saved") {
        update("");
        onSaved(response.message);
      }
    } catch {
      setError(preview ? "Import could not be confirmed. Retry the same evidence to check the result." : "Preview failed. Try again.");
    } finally {
      pending.current = false;
      setWorking(false);
      requestAnimationFrame(() => feedback.current?.focus());
    }
  }

  return <details className="document-form">
    <summary className="min-h-11 content-center">Import sample settlement evidence</summary>
    <form className="record-form" onSubmit={submit}>
      <p className="muted">Use a fictional purchase advice or wire receipt for cycle {loan.cycle}, funded {dateLabel(loan.date)}.</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(12rem,auto)_1fr]">
        <label className="field">Example evidence type<select className="min-h-11" value={kind} disabled={working}
          onChange={event => setKind(event.target.value === "Wire receipt" ? "Wire receipt" : "Purchase advice")}>
          <option>Purchase advice</option><option>Wire receipt</option>
        </select></label>
        <div className="self-end"><Button type="button" size="sm" variant="outline" className="min-h-11" onClick={downloadExample}>Download JSON example</Button></div>
      </div>
      <label className="field">Evidence JSON<textarea rows={5} required maxLength={8192} value={text} disabled={busy || working}
        onChange={event => update(event.target.value)} /></label>
      <div ref={feedback} tabIndex={-1}>
        {error && <p role="alert">{error}</p>}
        {preview && <div role="status" className="break-words">
          <strong>{preview.evidence.kind} · {financeMoney(preview.result.amountCents)}</strong>
          <p>{preview.evidence.reference} · {preview.evidence.source} · {dateLabel(preview.evidence.occurredOn)}</p>
          <p>{preview.result.alreadyRecorded ? "Already recorded. Totals are unchanged." : `Matched to ${loan.borrower} · Cycle ${loan.cycle}`}</p>
        </div>}
      </div>
      <div className="loan-application-actions">
        <Button type="submit" size="sm" className="min-h-11" disabled={busy || working || preview?.result.alreadyRecorded}>
          {working ? (preview ? "Importing…" : "Checking…") : preview ? "Import matched evidence" : "Check match"}
        </Button>
        {preview && <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={working} onClick={() => setPreview(undefined)}>Check again</Button>}
      </div>
    </form>
  </details>;
}

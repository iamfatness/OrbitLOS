import { createHash } from "node:crypto";
import { settlementEvidence, type FinanceInput, type FinanceLoan, type FinanceResult, type SettlementFeedRow } from "./brokerage-finance-model";
import { importSettlementEvidence } from "./settlement-reconciliation";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

type FeedInput = Extract<FinanceInput, { type: "settlementFeed" | "pullSettlementFeed" | "reviewSettlementFeed" }>;
type ProviderEvidence = { fundingReference: string; evidenceId: string; occurredOn: string; reference: string } & (
  { kind: "Purchase advice"; sequence: number; grossCents: number; feesCents: number; adjustmentCents: number } |
  { kind: "Wire receipt"; amountCents: number }
);
type Receipt = Pick<SettlementFeedRow, "status" | "detail" | "reviewNote" | "reviewedBy" | "reviewedAt"> & { payload: string };

const source = "orbit-settlement-sandbox";
const fundingReference = (loan: FinanceLoan) => createHash("sha256").update(JSON.stringify([loan.id, loan.cycle, loan.date])).digest("hex").slice(0, 16);
const evidenceAmount = (record: ProviderEvidence) => record.kind === "Wire receipt" ?
  record.amountCents : record.grossCents - record.feesCents + record.adjustmentCents;

function simulatedDeliveries(loan: FinanceLoan): ProviderEvidence[] {
  const key = fundingReference(loan);
  const base = { fundingReference: key, occurredOn: loan.date };
  const wire = { ...base, kind: "Wire receipt" as const, evidenceId: `wire-${key}`, reference: `WIRE-${key}`, amountCents: 34_875_000 };
  return [
    { ...base, kind: "Purchase advice", evidenceId: `advice-${key}`, reference: `ADVICE-${key}`, sequence: 1,
      grossCents: 35_000_000, feesCents: 125_000, adjustmentCents: 0 },
    wire,
    wire,
    { ...wire, fundingReference: `unknown-${key}`, evidenceId: `unmatched-${key}`, reference: `UNMATCHED-${key}`, amountCents: 25_000 },
  ];
}

export function settlementFeedWork(db: Store, input: FeedInput, loan: FinanceLoan | undefined,
  staff: WorkspaceStaff, at: string, today: string): FinanceResult {
  if (!loan || (input.type !== "settlementFeed" && loan.reversedAt) ||
      (input.type === "pullSettlementFeed" && input.fundingDate !== loan.date)) {
    return { error: "This funding cycle changed. Reopen it before pulling settlement evidence." };
  }
  const args = [loan.id, loan.cycle] as const;
  // Simulated deliveries use the funding date as their occurrence date, including receipts saved before date checks.
  const batch = db.prepare(`SELECT json_extract(payload, '$.occurredOn') AS date
    FROM settlement_feed_receipts WHERE loanId = ? AND cycle = ? AND sequence = 1`).get(...args);
  let checkedFundingDate = typeof batch?.date === "string" ? batch.date : null;
  if (input.type !== "settlementFeed" && checkedFundingDate && checkedFundingDate !== loan.date) {
    return { error: "These provider deliveries belong to the earlier funding date. Compare the saved deliveries and review the corrected cycle." };
  }
  if (input.type === "pullSettlementFeed") {
    if (!batch) {
      for (const [index, record] of simulatedDeliveries(loan).entries()) {
        const { fundingReference: reference, ...fields } = record;
        let status: SettlementFeedRow["status"] = "Needs review";
        let detail = "The provider funding reference does not match this cycle. Check the source before using the evidence.";
        if (reference === fundingReference(loan)) {
          const evidence = settlementEvidence.parse({ ...fields, schemaVersion: 1, source, loanId: loan.id, cycle: loan.cycle, fundingDate: loan.date });
          const target = { loanId: loan.id, cycle: loan.cycle, evidence };
          const preview = importSettlementEvidence(db, { ...target, type: "settlementEvidencePreview" }, loan, staff, at, today);
          if ("error" in preview) detail = preview.error;
          else if (preview.kind === "settlementEvidencePreview") {
            if (preview.alreadyRecorded) {
              status = "Already recorded";
              detail = "This delivery matches evidence already in the cycle history.";
            } else {
              const result = importSettlementEvidence(db, { ...target, type: "settlementEvidenceImport", fundingDate: loan.date,
                revision: preview.revision, entryId: crypto.randomUUID() }, loan, staff, at, today);
              if ("error" in result) detail = result.error;
              else if (result.kind === "saved") {
                status = "Imported";
                detail = result.message;
              }
            }
          }
        }
        db.prepare(`INSERT INTO settlement_feed_receipts (loanId, cycle, sequence, payload, status, detail)
          VALUES (?, ?, ?, ?, ?, ?)`).run(...args, index + 1, JSON.stringify(record), status, detail);
      }
      checkedFundingDate = loan.date;
    }
  } else if (input.type === "reviewSettlementFeed") {
    const row = db.prepare(`SELECT status, reviewNote FROM settlement_feed_receipts WHERE loanId = ? AND cycle = ?
      AND status IN ('Needs review', 'Reviewed') AND json_extract(payload, '$.evidenceId') = ?`).get(...args, input.evidenceId);
    if (!row || (row.status === "Reviewed" && row.reviewNote !== input.note)) return { error: "This delivery has changed. Reload the provider results." };
    if (row.status === "Needs review") db.prepare(`UPDATE settlement_feed_receipts SET status = 'Reviewed', reviewNote = ?, reviewedBy = ?, reviewedAt = ?
      WHERE loanId = ? AND cycle = ? AND status = 'Needs review' AND json_extract(payload, '$.evidenceId') = ?`)
      .run(input.note, staff.name, at, ...args, input.evidenceId);
  }
  const receipts = db.prepare(`SELECT payload, status, detail, reviewNote, reviewedBy, reviewedAt
    FROM settlement_feed_receipts WHERE loanId = ? AND cycle = ? ORDER BY sequence`).all(...args) as unknown as Receipt[];
  return { kind: "settlementFeed", checkedFundingDate, rows: receipts.map(({ payload, ...receipt }) => {
    const record = JSON.parse(payload) as ProviderEvidence;
    return { ...receipt, evidenceId: record.evidenceId, fundingReference: record.fundingReference, kind: record.kind,
      amountCents: evidenceAmount(record) };
  }) };
}

import { createHash } from "node:crypto";
import { settlementEvidence, type FinanceInput, type FinanceLoan, type FinanceResult, type SettlementFeedRow } from "./brokerage-finance-model";
import { importSettlementEvidence } from "./settlement-reconciliation";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

type FeedInput = Extract<FinanceInput, { type: "settlementFeed" | "pullSettlementFeed" | "reviewSettlementFeed" | "matchSettlementFeed" }>;
type ProviderEvidence = { fundingReference: string; evidenceId: string; occurredOn: string; reference: string } & (
  { kind: "Purchase advice"; sequence: number; grossCents: number; feesCents: number; adjustmentCents: number } |
  { kind: "Wire receipt"; amountCents: number }
);
type Receipt = Pick<SettlementFeedRow, "status" | "detail" | "reviewNote" | "reviewedBy" | "reviewedAt"> & { payload: string };

const source = "orbit-settlement-sandbox";
const fundingReference = (loan: FinanceLoan) => createHash("sha256").update(JSON.stringify([loan.id, loan.cycle, loan.date])).digest("hex").slice(0, 16);
const evidenceAmount = (record: ProviderEvidence) => record.kind === "Wire receipt" ?
  record.amountCents : record.grossCents - record.feesCents + record.adjustmentCents;
const isUnmatchedWire = (record: ProviderEvidence, loan: FinanceLoan) =>
  record.kind === "Wire receipt" && record.fundingReference !== fundingReference(loan);

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
  staff: WorkspaceStaff, at: string, today: string, findCycle: (id: string, cycle: number) => FinanceLoan | undefined): FinanceResult {
  if (!loan || (input.type !== "settlementFeed" && loan.reversedAt) ||
      ("fundingDate" in input && input.fundingDate !== loan.date)) {
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
  } else if (input.type === "reviewSettlementFeed" || input.type === "matchSettlementFeed") {
    const matching = input.type === "matchSettlementFeed";
    const decision = matching ? "Matched by owner" : "Reviewed";
    const rows = db.prepare(`SELECT sequence, payload, status, reviewNote FROM settlement_feed_receipts WHERE loanId = ? AND cycle = ?
      AND status IN ('Needs review', 'Reviewed', 'Matched by owner') AND json_extract(payload, '$.evidenceId') = ? LIMIT 2`)
      .all(...args, input.evidenceId);
    const [row] = rows;
    if (rows.length !== 1 || (row.status !== "Needs review" && (row.status !== decision || row.reviewNote !== input.note))) {
      return { error: "This delivery has changed. Reload the provider results." };
    }
    const destination = input.type === "matchSettlementFeed" ? input.destination : undefined;
    if (matching && row.status === "Matched by owner") {
      const saved = db.prepare("SELECT payload FROM settlement_imports WHERE source = ? AND evidenceId = ?").get(source, input.evidenceId);
      const evidence = settlementEvidence.safeParse(saved && JSON.parse(String(saved.payload)));
      if (!evidence.success || evidence.data.loanId !== (destination?.id ?? loan.id) ||
          evidence.data.cycle !== (destination?.cycle ?? loan.cycle) || evidence.data.fundingDate !== (destination?.date ?? loan.date)) {
        return { error: "This delivery has changed. Reload the provider results." };
      }
    }
    if (row.status === "Needs review") {
      let detail: string | null = null;
      if (matching) {
        const { fundingReference: reference, ...fields } = JSON.parse(String(row.payload)) as ProviderEvidence;
        if (!isUnmatchedWire({ fundingReference: reference, ...fields }, loan) || !checkedFundingDate) {
          return { error: "Only an unmatched wire from this funding date can be matched here." };
        }
        const selected = destination ? findCycle(destination.id, destination.cycle) : loan;
        if (!selected || selected.reversedAt || (destination && (selected.id === loan.id || selected.date !== destination.date))) {
          return { error: "The destination funding cycle changed. Search again and choose the current cycle." };
        }
        const evidence = settlementEvidence.parse({ ...fields, schemaVersion: 1, source, loanId: selected.id, cycle: selected.cycle, fundingDate: selected.date });
        const target = { loanId: selected.id, cycle: selected.cycle, evidence };
        const preview = importSettlementEvidence(db, { ...target, type: "settlementEvidencePreview" }, selected, staff, at, today);
        if ("error" in preview) return preview;
        if (preview.kind !== "settlementEvidencePreview") return { error: "Could not check this delivery against the settlement ledger." };
        const imported = importSettlementEvidence(db, { ...target, type: "settlementEvidenceImport", fundingDate: selected.date,
          revision: preview.revision, entryId: crypto.randomUUID() }, selected, staff, at, today);
        if ("error" in imported) return imported;
        detail = destination ? "The owner matched the wire to a different funding cycle." :
          preview.alreadyRecorded ? "The wire was already recorded in this cycle." : "The owner confirmed the wire belongs to this cycle and added it to received proceeds.";
      }
      db.prepare(`UPDATE settlement_feed_receipts SET status = ?, detail = coalesce(?, detail), reviewNote = ?, reviewedBy = ?, reviewedAt = ?
        WHERE loanId = ? AND cycle = ? AND sequence = ?`)
        .run(decision, detail, input.note, staff.name, at, ...args, row.sequence);
    }
  }
  const receipts = db.prepare(`SELECT payload, status, detail, reviewNote, reviewedBy, reviewedAt
    FROM settlement_feed_receipts WHERE loanId = ? AND cycle = ? ORDER BY sequence`).all(...args) as unknown as Receipt[];
  return { kind: "settlementFeed", checkedFundingDate, rows: receipts.map(({ payload, ...receipt }) => {
    const record = JSON.parse(payload) as ProviderEvidence;
    const imported = receipt.status === "Matched by owner" && db.prepare(`SELECT event.loanId, event.cycle, contact.name AS borrower,
      json_extract(imported.payload, '$.fundingDate') AS date FROM settlement_imports imported
      JOIN settlement_events event ON event.id = imported.eventId JOIN loans loan ON loan.id = event.loanId
      JOIN contacts contact ON contact.id = loan.contactId WHERE imported.source = ? AND imported.evidenceId = ? AND event.loanId <> ?`)
      .get(source, record.evidenceId, loan.id);
    return { ...receipt, evidenceId: record.evidenceId, fundingReference: record.fundingReference, kind: record.kind,
      amountCents: evidenceAmount(record),
      ...(imported ? { destination: { id: String(imported.loanId), cycle: Number(imported.cycle), date: String(imported.date), borrower: String(imported.borrower) } } : {}),
      ...(receipt.status === "Needs review" && checkedFundingDate === loan.date && isUnmatchedWire(record, loan) ? { canMatch: true } : {}) };
  }) };
}

import type { FinanceLoan, FinanceResult, SettlementEntry, SettlementMutation, SettlementQueuePage, SettlementQueueQuery,
  SettlementQueueRow, SettlementWork } from "./brokerage-finance-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";
import { settlementFeeQueueCounts, settlementFeeQueuePage } from "./settlement-fees";

const pageSize = 20;
const balanceLimit = 50_000_000_000;
type SettlementLoan = Pick<FinanceLoan, "id" | "cycle" | "date">;
type EvidenceRow = { revision: number; id: string; at: string; actorName: string; request: string; amountCents: number | null; reversed: number };
type SettlementSummary = { revision: number; expectedCents: number | null; receivedCents: number; receiptCount: number; reviewFundingDate: string | null };
const expectedProceeds = (advice: NonNullable<SettlementWork["advice"]>) => advice.grossCents - advice.feesCents + advice.adjustmentCents;
const receiptKey = (reference: string) => reference.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function initializeSettlementSummaries(db: Store) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settlement_cycle_summary'").get()) return;
  db.exec(`
    CREATE TABLE settlement_cycle_summary (
      loanId TEXT NOT NULL, cycle INTEGER NOT NULL, revision INTEGER NOT NULL,
      expectedCents INTEGER, receivedCents INTEGER NOT NULL, receiptCount INTEGER NOT NULL,
      reviewFundingDate TEXT, changedAt TEXT NOT NULL, PRIMARY KEY (loanId, cycle),
      FOREIGN KEY (loanId, cycle) REFERENCES loan_financials(loanId, cycle) ON DELETE CASCADE
    );
    CREATE INDEX settlement_summary_by_change ON settlement_cycle_summary(changedAt DESC, loanId DESC, cycle DESC);
    INSERT INTO settlement_cycle_summary (loanId, cycle, revision, expectedCents, receivedCents, receiptCount, reviewFundingDate, changedAt)
    WITH totals AS (
      SELECT loanId, cycle, max(revision) AS latest, max(CASE WHEN kind = 'settlementAdvice' THEN revision END) AS advice,
        sum(CASE WHEN kind IN ('settlementReceipt', 'settlementReverse') THEN amountCents ELSE 0 END) AS received,
        sum(CASE kind WHEN 'settlementReceipt' THEN 1 WHEN 'settlementReverse' THEN -1 ELSE 0 END) AS count
      FROM settlement_events GROUP BY loanId, cycle
    )
    SELECT totals.loanId, totals.cycle, totals.latest, advice.amountCents, totals.received, totals.count,
      CASE WHEN latest.kind = 'settlementReview' THEN json_extract(latest.request, '$.fundingDate') END, latest.at
    FROM totals JOIN settlement_events latest ON latest.loanId = totals.loanId AND latest.cycle = totals.cycle AND latest.revision = totals.latest
    LEFT JOIN settlement_events advice ON advice.loanId = totals.loanId AND advice.cycle = totals.cycle AND advice.revision = totals.advice;
    CREATE TRIGGER settlement_cycle_event_insert AFTER INSERT ON settlement_events BEGIN
      INSERT INTO settlement_cycle_summary (loanId, cycle, revision, expectedCents, receivedCents, receiptCount, reviewFundingDate, changedAt)
      VALUES (NEW.loanId, NEW.cycle, NEW.revision,
        CASE WHEN NEW.kind = 'settlementAdvice' THEN NEW.amountCents END,
        CASE WHEN NEW.kind IN ('settlementReceipt', 'settlementReverse') THEN NEW.amountCents ELSE 0 END,
        CASE NEW.kind WHEN 'settlementReceipt' THEN 1 WHEN 'settlementReverse' THEN -1 ELSE 0 END,
        CASE WHEN NEW.kind = 'settlementReview' THEN json_extract(NEW.request, '$.fundingDate') END, NEW.at)
      ON CONFLICT (loanId, cycle) DO UPDATE SET
        revision = excluded.revision,
        expectedCents = coalesce(excluded.expectedCents, settlement_cycle_summary.expectedCents),
        receivedCents = settlement_cycle_summary.receivedCents + excluded.receivedCents,
        receiptCount = settlement_cycle_summary.receiptCount + excluded.receiptCount,
        reviewFundingDate = excluded.reviewFundingDate,
        changedAt = excluded.changedAt;
    END;
  `);
}

function settlementStatus(expected: number | null, received: number, count: number, reviewed: boolean): SettlementWork["status"] {
  if (expected === null) return "Awaiting advice";
  if (!count) return "Awaiting receipts";
  if (expected === received) return reviewed ? "Reconciled" : "Ready to confirm";
  return reviewed ? "Difference reviewed" : "Difference to review";
}

function settlementTotals(db: Store, loan: SettlementLoan) {
  const summary = db.prepare(`SELECT revision, expectedCents, receivedCents, receiptCount, reviewFundingDate
    FROM settlement_cycle_summary WHERE loanId = ? AND cycle = ?`).get(loan.id, loan.cycle) as SettlementSummary | undefined;
  const latestAdvice = summary?.expectedCents != null && db.prepare(`SELECT request FROM settlement_events WHERE loanId = ? AND cycle = ? AND kind = 'settlementAdvice'
    ORDER BY revision DESC LIMIT 1`).get(loan.id, loan.cycle);
  const advice: SettlementWork["advice"] = latestAdvice ? JSON.parse(String(latestAdvice.request)) : null;
  const expectedCents = summary?.expectedCents ?? null;
  const receivedCents = summary?.receivedCents ?? 0;
  const receiptCount = summary?.receiptCount ?? 0;
  const differenceCents = expectedCents === null ? null : expectedCents - receivedCents;
  const reviewed = summary?.reviewFundingDate === loan.date;
  const status = settlementStatus(expectedCents, receivedCents, receiptCount, reviewed);
  return { revision: summary?.revision ?? 0, advice, expectedCents, receivedCents, differenceCents, receiptCount, reviewed, status };
}

export function settlementStatuses(db: Store, loans: FinanceLoan[]) {
  if (!loans.length) return new Map<string, SettlementWork["status"]>();
  const rows = db.prepare(`SELECT summary.loanId, summary.cycle, summary.expectedCents, summary.receivedCents, summary.receiptCount,
      summary.reviewFundingDate = json_extract(selection.value, '$.date') AS reviewed
    FROM json_each(?) selection JOIN settlement_cycle_summary summary
      ON summary.loanId = json_extract(selection.value, '$.id') AND summary.cycle = json_extract(selection.value, '$.cycle')`)
    .all(JSON.stringify(loans.map(({ id, cycle, date }) => ({ id, cycle, date })))) as unknown as
    (Pick<SettlementSummary, "expectedCents" | "receivedCents" | "receiptCount"> & { loanId: string; cycle: number; reviewed: number | null })[];
  return new Map(rows.map(({ loanId, cycle, expectedCents, receivedCents, receiptCount, reviewed }) =>
    [`${loanId}:${cycle}`, settlementStatus(expectedCents, receivedCents, receiptCount, Boolean(reviewed))]));
}

export function readSettlementQueue(db: Store, { view, after }: SettlementQueueQuery): SettlementQueuePage {
  const source = `FROM settlement_cycle_summary summary JOIN closing_progress progress
    ON progress.loanId = summary.loanId AND progress.fundingCycle = summary.cycle`;
  const reviewed = "coalesce(summary.reviewFundingDate = progress.fundingDate, 0)";
  const category = `CASE
    WHEN summary.expectedCents IS NULL OR summary.receiptCount = 0 THEN 'Missing evidence'
    WHEN summary.expectedCents = summary.receivedCents THEN CASE WHEN NOT ${reviewed} THEN 'Matches to confirm' END
    WHEN ${reviewed} THEN 'Reviewed differences'
    ELSE 'Differences' END`;
  const counts: SettlementQueuePage["counts"] = { Differences: 0, "Matches to confirm": 0, "Missing evidence": 0, "Reviewed differences": 0,
    ...settlementFeeQueueCounts(db) };
  const totals = db.prepare(`SELECT ${category} AS view, count(*) AS count ${source} WHERE progress.fundingDate IS NOT NULL GROUP BY view`)
    .all() as { view: SettlementQueueQuery["view"] | null; count: number }[];
  for (const total of totals) if (total.view) counts[total.view] = total.count;
  if (view === "Fee differences" || view === "Reviewed fee differences") return settlementFeeQueuePage(db, { type: "settlementQueue", view, after }, counts);
  const cursor = after ? "AND (summary.changedAt, summary.loanId, summary.cycle) < (?, ?, ?)" : "";
  const records = db.prepare(`SELECT summary.loanId AS id, summary.cycle, summary.changedAt,
      contact.name AS borrower, loan.officer, progress.fundingDate AS date, summary.expectedCents, summary.receivedCents,
      summary.expectedCents - summary.receivedCents AS differenceCents, summary.receiptCount, ${reviewed} AS reviewed
    ${source} JOIN loans loan ON loan.id = summary.loanId JOIN contacts contact ON contact.id = loan.contactId
    WHERE progress.fundingDate IS NOT NULL AND (${category}) = ? ${cursor}
    ORDER BY summary.changedAt DESC, summary.loanId DESC, summary.cycle DESC LIMIT ?`)
    .all(view, ...(after ? [after.changedAt, after.id, after.cycle] : []), pageSize + 1) as unknown as
    (Omit<SettlementQueueRow, "status"> & { receiptCount: number; reviewed: number })[];
  const rows = records.slice(0, pageSize).map(({ receiptCount, reviewed, ...row }) => ({
    ...row, status: settlementStatus(row.expectedCents, row.receivedCents, receiptCount, Boolean(reviewed)),
  }));
  const last = rows.at(-1);
  return { kind: "settlementQueue", rows, counts,
    next: records.length > pageSize && last ? { id: last.id, cycle: last.cycle, changedAt: last.changedAt } : null };
}

export function readSettlement(db: Store, loan: SettlementLoan, before?: number): SettlementWork {
  const totals = settlementTotals(db, loan);
  const rows = db.prepare(`SELECT event.revision, event.id, event.at, event.actorName, event.request, event.amountCents,
      EXISTS (SELECT 1 FROM settlement_events reversal WHERE reversal.reversesId = event.id) AS reversed
    FROM settlement_events event WHERE event.loanId = ? AND event.cycle = ? ${before ? "AND event.revision < ?" : ""}
    ORDER BY event.revision DESC LIMIT ?`)
    .all(loan.id, loan.cycle, ...(before ? [before] : []), pageSize + 1) as unknown as EvidenceRow[];
  const entries: SettlementEntry[] = rows.slice(0, pageSize).map(({ request, reversed, ...entry }) =>
    ({ ...entry, input: JSON.parse(request), reversed: Boolean(reversed) }));
  return { ...totals, entries, before: rows.length > pageSize ? entries.at(-1)?.revision ?? null : null };
}

const savedMessages = {
  settlementAdvice: "Sample purchase advice recorded.",
  settlementReceipt: "Sample settlement receipt recorded.",
  settlementReverse: "Sample settlement receipt reversed. Its original stays in history.",
  settlementReview: "Sample settlement review recorded.",
} as const;

export function saveSettlement(db: Store, data: SettlementMutation, current: FinanceLoan | undefined, staff: WorkspaceStaff, at: string, today: string): FinanceResult {
  const request = JSON.stringify(data);
  const prior = db.prepare("SELECT request, actorEmail FROM settlement_events WHERE id = ?").get(data.entryId);
  const result = { kind: "saved", message: savedMessages[data.type] } as const;
  if (prior) return prior.request === request && prior.actorEmail === staff.email ? result : { error: "This settlement event identifier was already used." };
  if (!current || current.reversedAt || current.date !== data.fundingDate) {
    return { error: "The funding cycle changed. Open the current funded loan before recording settlement evidence." };
  }
  const state = settlementTotals(db, current);
  if (data.revision !== state.revision) return { error: "Settlement evidence changed. Refresh the loan before saving." };
  if ("occurredOn" in data && (data.occurredOn < "1900-01-01" || data.occurredOn > today)) return { error: "Enter an evidence date on or before today." };

  let amountCents: number | null = null;
  let reference: string | null = null;
  let reversesId: string | null = null;
  switch (data.type) {
    case "settlementAdvice":
      amountCents = expectedProceeds(data);
      if (amountCents < 1 || amountCents > balanceLimit) return { error: "Expected net proceeds must be positive and within the supported amount." };
      if (state.advice && !data.note) return { error: "Explain what changed in the corrected purchase advice." };
      break;
    case "settlementReceipt":
      amountCents = data.amountCents;
      reference = receiptKey(data.reference);
      if (db.prepare(`SELECT 1 FROM settlement_events WHERE loanId = ? AND cycle = ? AND receiptReference = ? COLLATE NOCASE`)
        .get(data.loanId, data.cycle, reference)) return { error: "This sample receipt reference is already recorded for the funding cycle." };
      if (state.receivedCents + amountCents > balanceLimit) return { error: "The settlement receipts exceed the supported balance." };
      break;
    case "settlementReverse": {
      const original = db.prepare(`SELECT amountCents, json_extract(request, '$.occurredOn') AS occurredOn FROM settlement_events
        WHERE loanId = ? AND cycle = ? AND id = ? AND kind = 'settlementReceipt'
          AND NOT EXISTS (SELECT 1 FROM settlement_events WHERE reversesId = ?)`)
        .get(data.loanId, data.cycle, data.originalId, data.originalId);
      if (!original || data.occurredOn < String(original.occurredOn)) {
        return { error: "Choose an unreversed receipt and a reversal date on or after its recorded date." };
      }
      amountCents = -Number(original.amountCents);
      reversesId = data.originalId;
      break;
    }
    case "settlementReview":
      if (!state.advice || !state.receiptCount) return { error: "Record purchase advice and at least one receipt before reviewing settlement." };
      if (state.reviewed) return { error: "This settlement evidence already has a current review." };
      if (state.differenceCents !== 0 && !data.note) return { error: "Record why you reviewed the remaining settlement difference." };
      amountCents = state.differenceCents;
      break;
  }
  db.prepare(`INSERT INTO loan_financials (loanId, cycle, fundingDate) VALUES (?, ?, ?)
    ON CONFLICT (loanId, cycle) DO NOTHING`).run(data.loanId, data.cycle, data.fundingDate);
  db.prepare(`INSERT INTO settlement_events (loanId, cycle, revision, id, kind, receiptReference, amountCents, reversesId, at, actorName, actorEmail, request)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(data.loanId, data.cycle, state.revision + 1, data.entryId,
    data.type, reference, amountCents, reversesId, at, staff.name, staff.email, request);
  if (data.type === "settlementReview") accessEvent(db, staff, "Reviewed sample settlement evidence", data.loanId, at);
  return result;
}

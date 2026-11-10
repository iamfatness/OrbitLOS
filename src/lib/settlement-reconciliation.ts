import type { FinanceLoan, FinanceResult, SettlementEntry, SettlementMutation, SettlementWork } from "./brokerage-finance-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const pageSize = 20;
const balanceLimit = 50_000_000_000;
type SettlementLoan = Pick<FinanceLoan, "id" | "cycle" | "date">;
type EvidenceRow = { revision: number; id: string; at: string; actorName: string; request: string; amountCents: number | null; reversed: number };
const expectedProceeds = (advice: NonNullable<SettlementWork["advice"]>) => advice.grossCents - advice.feesCents + advice.adjustmentCents;
const receiptKey = (reference: string) => reference.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

function settlementStatus(expected: number | null, received: number, count: number, reviewed: boolean): SettlementWork["status"] {
  if (expected === null) return "Awaiting advice";
  if (!count) return "Awaiting receipts";
  if (expected === received) return reviewed ? "Reconciled" : "Ready to confirm";
  return reviewed ? "Difference reviewed" : "Difference to review";
}

function settlementTotals(db: Store, loan: SettlementLoan) {
  const latest = db.prepare(`SELECT revision, kind, request FROM settlement_events
    WHERE loanId = ? AND cycle = ? ORDER BY revision DESC LIMIT 1`).get(loan.id, loan.cycle);
  const latestAdvice = db.prepare(`SELECT request FROM settlement_events WHERE loanId = ? AND cycle = ? AND kind = 'settlementAdvice'
    ORDER BY revision DESC LIMIT 1`).get(loan.id, loan.cycle);
  const { receivedCents, receiptCount } = db.prepare(`SELECT coalesce(sum(amountCents), 0) AS receivedCents,
    coalesce(sum(CASE kind WHEN 'settlementReceipt' THEN 1 ELSE -1 END), 0) AS receiptCount
    FROM settlement_events WHERE loanId = ? AND cycle = ? AND kind IN ('settlementReceipt', 'settlementReverse')`)
    .get(loan.id, loan.cycle) as { receivedCents: number; receiptCount: number };
  const advice: SettlementWork["advice"] = latestAdvice ? JSON.parse(String(latestAdvice.request)) : null;
  const expectedCents = advice ? expectedProceeds(advice) : null;
  const differenceCents = expectedCents === null ? null : expectedCents - receivedCents;
  const reviewed = latest?.kind === "settlementReview" && JSON.parse(String(latest.request)).fundingDate === loan.date;
  const status = settlementStatus(expectedCents, receivedCents, receiptCount, reviewed);
  return { revision: Number(latest?.revision ?? 0), advice, expectedCents, receivedCents, differenceCents, receiptCount, reviewed, status };
}

export function settlementStatuses(db: Store, loans: FinanceLoan[]) {
  if (!loans.length) return new Map<string, SettlementWork["status"]>();
  const rows = db.prepare(`WITH selected AS (
      SELECT json_extract(value, '$.id') AS loanId, json_extract(value, '$.cycle') AS cycle, json_extract(value, '$.date') AS date
      FROM json_each(?)
    ), totals AS (
      SELECT event.loanId, event.cycle, selected.date, max(event.revision) AS latest,
        max(CASE WHEN event.kind = 'settlementAdvice' THEN event.revision END) AS advice,
        sum(CASE WHEN event.kind IN ('settlementReceipt', 'settlementReverse') THEN event.amountCents ELSE 0 END) AS received,
        sum(CASE event.kind WHEN 'settlementReceipt' THEN 1 WHEN 'settlementReverse' THEN -1 ELSE 0 END) AS count
      FROM selected JOIN settlement_events event ON event.loanId = selected.loanId AND event.cycle = selected.cycle
      GROUP BY event.loanId, event.cycle
    )
    SELECT totals.loanId, totals.cycle, totals.received, totals.count, advice.amountCents AS expected,
      latest.kind = 'settlementReview' AND json_extract(latest.request, '$.fundingDate') = totals.date AS reviewed
    FROM totals JOIN settlement_events latest ON latest.loanId = totals.loanId AND latest.cycle = totals.cycle AND latest.revision = totals.latest
    LEFT JOIN settlement_events advice ON advice.loanId = totals.loanId AND advice.cycle = totals.cycle AND advice.revision = totals.advice`)
    .all(JSON.stringify(loans.map(({ id, cycle, date }) => ({ id, cycle, date })))) as unknown as {
      loanId: string; cycle: number; received: number; count: number; expected: number | null; reviewed: number;
    }[];
  return new Map(rows.map(({ loanId, cycle, expected, received, count, reviewed }) =>
    [`${loanId}:${cycle}`, settlementStatus(expected, received, count, Boolean(reviewed))]));
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

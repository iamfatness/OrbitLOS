import type { FinanceLoan, FinanceResult, SettlementEntry, SettlementEvidenceInput, SettlementMutation, SettlementQueuePage, SettlementQueueQuery,
  SettlementQueueRow, SettlementWork } from "./brokerage-finance-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";
import { settlementFeeQueueCounts, settlementFeeQueuePage } from "./settlement-fees";

const pageSize = 20;
const balanceLimit = 50_000_000_000;
type SettlementLoan = Pick<FinanceLoan, "id" | "cycle" | "date">;
type EvidenceRow = { revision: number; id: string; at: string; actorName: string; request: string; amountCents: number | null; reversed: number;
  source: string | null; evidenceId: string | null; sequence: number | null };
type SettlementSummary = { revision: number; expectedCents: number | null; receivedCents: number; receiptCount: number; reviewFundingDate: string | null };
const expectedProceeds = (advice: Pick<NonNullable<SettlementWork["advice"]>, "grossCents" | "feesCents" | "adjustmentCents">) =>
  advice.grossCents - advice.feesCents + advice.adjustmentCents;
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
  const source = `FROM closing_progress progress LEFT JOIN settlement_cycle_summary summary
    ON progress.loanId = summary.loanId AND progress.fundingCycle = summary.cycle`;
  const reviewed = "coalesce(summary.reviewFundingDate = progress.fundingDate, 0)";
  const category = `CASE
    WHEN summary.expectedCents IS NULL OR summary.receiptCount = 0 THEN 'Missing evidence'
    WHEN summary.expectedCents = summary.receivedCents THEN CASE WHEN NOT ${reviewed} THEN 'Matches to confirm' END
    WHEN ${reviewed} THEN 'Reviewed differences'
    ELSE 'Differences' END`;
  const counts: SettlementQueuePage["counts"] = { Differences: 0, "Matches to confirm": 0, "Missing evidence": 0, "Reviewed differences": 0,
    ...settlementFeeQueueCounts(db), "Wires to review": 0 };
  const totals = db.prepare(`SELECT ${category} AS view, count(*) AS count ${source} WHERE progress.fundingDate IS NOT NULL GROUP BY view`)
    .all() as { view: SettlementQueueQuery["view"] | null; count: number }[];
  for (const total of totals) if (total.view) counts[total.view] = total.count;
  const pendingWires = `FROM settlement_feed_receipts receipt JOIN closing_progress progress
    ON progress.loanId = receipt.loanId AND progress.fundingCycle = receipt.cycle
    WHERE progress.fundingDate IS NOT NULL AND receipt.status = 'Needs review'
      AND json_extract(receipt.payload, '$.kind') = 'Wire receipt'`;
  counts["Wires to review"] = Number(db.prepare(`SELECT count(*) AS total ${pendingWires}`).get()?.total ?? 0);
  if (view === "Wires to review") {
    const rows = db.prepare(`WITH wires AS (
      SELECT receipt.loanId AS id, receipt.cycle, receipt.sequence, receipt.payload, progress.fundingDate AS date,
        (SELECT json_extract(snapshot, '$.at') FROM settlement_feed_corrections correction
          WHERE correction.loanId = receipt.loanId AND correction.cycle = receipt.cycle
            AND correction.evidenceId = json_extract(receipt.payload, '$.evidenceId')
          ORDER BY correction.sequence DESC LIMIT 1) AS reopenedAt
      ${pendingWires}
    ), ordered AS (
      SELECT *, coalesce(reopenedAt, json_extract(payload, '$.occurredOn') || 'T00:00:00.000Z') AS changedAt FROM wires
    )
    SELECT ordered.*, contact.name AS borrower, loan.officer FROM ordered
    JOIN loans loan ON loan.id = ordered.id JOIN contacts contact ON contact.id = loan.contactId
    ${after ? "WHERE (changedAt, ordered.id, cycle, sequence) < (?, ?, ?, ?)" : ""}
    ORDER BY changedAt DESC, ordered.id DESC, cycle DESC, sequence DESC LIMIT ?`)
      .all(...(after ? [after.changedAt, after.id, after.cycle, after.sequence ?? 0] : []), pageSize + 1) as unknown as
      (Pick<SettlementQueueRow, "id" | "cycle" | "date" | "borrower" | "officer" | "changedAt"> &
        { sequence: number; payload: string; reopenedAt: string | null })[];
    const page = rows.slice(0, pageSize).map(({ payload, reopenedAt, ...row }): SettlementQueueRow => {
      const { evidenceId, fundingReference, amountCents, occurredOn } = JSON.parse(payload) as
        { evidenceId: string; fundingReference: string; amountCents: number; occurredOn: string };
      return { ...row, status: occurredOn !== row.date ? "Earlier funding date" : reopenedAt ? "Reopened wire" : "Unmatched wire",
        wire: { evidenceId, reference: fundingReference, amountCents }, expectedCents: null, receivedCents: 0, differenceCents: null };
    });
    const last = page.at(-1);
    return { kind: "settlementQueue", rows: page, counts,
      next: rows.length > pageSize && last ? { id: last.id, cycle: last.cycle, changedAt: last.changedAt, sequence: last.sequence } : null };
  }
  if (view === "Fee differences" || view === "Reviewed fee differences") return settlementFeeQueuePage(db, { type: "settlementQueue", view, after }, counts);
  const changed = "coalesce(summary.changedAt, progress.fundingDate || 'T00:00:00.000Z')";
  const order = `${changed}, progress.loanId, progress.fundingCycle`;
  const cursor = after ? `AND (${order}) < (?, ?, ?)` : "";
  const records = db.prepare(`SELECT progress.loanId AS id, progress.fundingCycle AS cycle, ${changed} AS changedAt,
      contact.name AS borrower, loan.officer, progress.fundingDate AS date, summary.expectedCents, coalesce(summary.receivedCents, 0) AS receivedCents,
      summary.expectedCents - summary.receivedCents AS differenceCents, coalesce(summary.receiptCount, 0) AS receiptCount, ${reviewed} AS reviewed
    ${source} JOIN loans loan ON loan.id = progress.loanId JOIN contacts contact ON contact.id = loan.contactId
    WHERE progress.fundingDate IS NOT NULL AND (${category}) = ? ${cursor}
    ORDER BY changedAt DESC, progress.loanId DESC, progress.fundingCycle DESC LIMIT ?`)
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
      imported.source, imported.evidenceId, imported.sequence,
      EXISTS (SELECT 1 FROM settlement_events reversal WHERE reversal.reversesId = event.id) AS reversed
    FROM settlement_events event LEFT JOIN settlement_imports imported ON imported.eventId = event.id
    WHERE event.loanId = ? AND event.cycle = ? ${before ? "AND event.revision < ?" : ""}
    ORDER BY event.revision DESC LIMIT ?`)
    .all(loan.id, loan.cycle, ...(before ? [before] : []), pageSize + 1) as unknown as EvidenceRow[];
  const entries: SettlementEntry[] = rows.slice(0, pageSize).map(({ request, reversed, source, evidenceId, sequence, ...entry }) =>
    ({ ...entry, input: JSON.parse(request), reversed: Boolean(reversed),
      ...(source && evidenceId ? { importedEvidence: { source, evidenceId, sequence } } : {}) }));
  return { ...totals, entries, before: rows.length > pageSize ? entries.at(-1)?.revision ?? null : null };
}

export function importSettlementEvidence(db: Store, data: SettlementEvidenceInput, current: FinanceLoan | undefined,
  staff: WorkspaceStaff, at: string, today: string): FinanceResult {
  const evidence = data.evidence;
  if (evidence.loanId !== data.loanId || evidence.cycle !== data.cycle) return { error: "This evidence names a different loan or funding cycle." };
  const payload = JSON.stringify(evidence);
  const prior = db.prepare("SELECT payload FROM settlement_imports WHERE source = ? AND evidenceId = ?").get(evidence.source, evidence.evidenceId);
  if (prior && prior.payload !== payload) return { error: "This source and evidence ID were already used with different details." };
  if (prior && data.type === "settlementEvidenceImport") return { kind: "saved", message: "This sample evidence is already recorded." };
  if (!current || current.reversedAt || current.date !== evidence.fundingDate ||
      (data.type === "settlementEvidenceImport" && current.date !== data.fundingDate)) {
    return { error: "The evidence funding date or cycle is no longer current. Check the source before importing." };
  }
  const state = settlementTotals(db, current);
  const isAdvice = evidence.kind === "Purchase advice";
  const amountCents = isAdvice ? expectedProceeds(evidence) : evidence.amountCents;
  if (!prior) {
    if (evidence.occurredOn < "1900-01-01" || evidence.occurredOn > today) return { error: "The evidence date must be on or before today." };
    if (isAdvice) {
      const latest = db.prepare(`SELECT imported.source, imported.sequence FROM settlement_events event
        LEFT JOIN settlement_imports imported ON imported.eventId = event.id
        WHERE event.loanId = ? AND event.cycle = ? AND event.kind = 'settlementAdvice' ORDER BY event.revision DESC LIMIT 1`)
        .get(data.loanId, data.cycle);
      if (latest && latest.source !== evidence.source) return { error: "Purchase advice from another source is already on file. Compare the records and use the corrected advice form if needed." };
      if (latest && Number(latest.sequence) >= evidence.sequence) return { error: "A newer or matching purchase advice version is already on file." };
      if (amountCents < 1 || amountCents > balanceLimit) return { error: "Expected net proceeds must be positive and within the supported amount." };
    } else {
      if (db.prepare("SELECT 1 FROM settlement_events WHERE loanId = ? AND cycle = ? AND receiptReference = ? COLLATE NOCASE")
        .get(data.loanId, data.cycle, receiptKey(evidence.reference))) return { error: "This wire reference is already recorded for the funding cycle. Compare it with settlement evidence history." };
      if (state.receivedCents + amountCents > balanceLimit) return { error: "The settlement receipts exceed the supported balance." };
    }
  }
  if (data.type === "settlementEvidencePreview") return { kind: "settlementEvidencePreview", amountCents, alreadyRecorded: !!prior, revision: state.revision };
  const base = { loanId: data.loanId, cycle: data.cycle, fundingDate: data.fundingDate, revision: data.revision, entryId: data.entryId,
    occurredOn: evidence.occurredOn, reference: evidence.reference, note: isAdvice && state.advice ? "Imported a newer sample purchase advice version." : "" };
  const change: SettlementMutation = isAdvice ? { ...base, type: "settlementAdvice", grossCents: evidence.grossCents,
    feesCents: evidence.feesCents, adjustmentCents: evidence.adjustmentCents } :
    { ...base, type: "settlementReceipt", amountCents };
  if (db.prepare("SELECT 1 FROM settlement_events WHERE id = ?").get(data.entryId)) return { error: "This settlement event identifier was already used." };
  const result = saveSettlement(db, change, current, staff, at, today);
  if ("error" in result) return result;
  db.prepare("INSERT INTO settlement_imports(source, evidenceId, eventId, sequence, payload) VALUES (?, ?, ?, ?, ?)")
    .run(evidence.source, evidence.evidenceId, data.entryId, isAdvice ? evidence.sequence : null, payload);
  return { kind: "saved", message: isAdvice ? "Sample purchase advice imported." : "Sample wire receipt imported." };
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

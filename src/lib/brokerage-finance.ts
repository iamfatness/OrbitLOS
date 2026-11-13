import { canManageFinance, financeInput, financeMoney, financeUnavailable, type FinanceEntry, type FinanceInput,
  type FinanceLoan, type FinanceMutation, type FinanceResult, type FinanceTotals, type SettlementDestination } from "./brokerage-finance-model";
import { easternDate } from "./client-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { readSettlementFees, saveSettlementFees } from "./settlement-fees";
import { accessEvent } from "./workspace-access";
import { importSettlementEvidence, readSettlement, readSettlementQueue, saveSettlement, settlementStatuses } from "./settlement-reconciliation";
import { settlementFeedWork } from "./settlement-feed";

const pageSize = 20;
const exportLimit = 1000;
const ledgerLimit = 10_000_000_000;
const sources = {
  Funded: { joins: `FROM closing_progress progress JOIN loans loan ON loan.id = progress.loanId
    LEFT JOIN loan_financials ledger ON ledger.loanId = loan.id AND ledger.cycle = progress.fundingCycle`,
    id: "progress.loanId", date: "progress.fundingDate", cycle: "progress.fundingCycle", eligible: "progress.fundingDate IS NOT NULL" },
  Reversed: { joins: "FROM loan_financials ledger JOIN loans loan ON loan.id = ledger.loanId", id: "ledger.loanId", date: "ledger.fundingDate", cycle: "ledger.cycle",
    eligible: "ledger.reversedAt IS NOT NULL" },
};
const margin = "CASE WHEN ledger.expenseReviewed = 1 THEN ledger.expectedCents - ledger.commissionCents - ledger.expensesCents END";
const financeColumns = `loan.id, contact.name AS borrower, loan.officer, ledger.reversedAt, coalesce(ledger.revision, 0) AS revision,
  ledger.expectedCents, ledger.commissionCents, coalesce(ledger.receiptsCents, 0) AS receiptsCents,
  coalesce(ledger.expensesCents, 0) AS expensesCents, coalesce(ledger.expenseReviewed, 0) AS expenseReviewed,
  ledger.expectedCents - coalesce(ledger.receiptsCents, 0) AS remainingCents, ${margin} AS marginCents`;
type FinanceRow = Omit<FinanceLoan, "expenseReviewed"> & { expenseReviewed: number };
const mapLoan = (row: FinanceRow): FinanceLoan => ({ ...row, expenseReviewed: Boolean(row.expenseReviewed) });

export function archiveFundingFinancials(db: Store, loanId: string, fundingDate: string, at: string) {
  db.prepare(`UPDATE loan_financials SET fundingDate = ?, reversedAt = ? WHERE loanId = ? AND cycle = (
    SELECT fundingCycle FROM closing_progress WHERE loanId = ?)`)
    .run(fundingDate, at, loanId, loanId);
}

function financeRecord(db: Store, id: string, cycle: number, archived = false) {
  const source = sources[archived ? "Reversed" : "Funded"];
  const row = db.prepare(`SELECT ${source.date} AS date, ${source.cycle} AS cycle, ${financeColumns} ${source.joins}
    JOIN contacts contact ON contact.id = loan.contactId WHERE ${source.eligible} AND loan.id = ? AND ${source.cycle} = ?`)
    .get(id, cycle) as unknown as FinanceRow | undefined;
  return row && mapLoan(row);
}

function csvCell(value: string) {
  const safe = /^\s*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function summaryCsv(loans: FinanceLoan[]) {
  const dollars = (cents: number | null) => cents === null ? "" : (cents / 100).toFixed(2);
  const header = "Loan ID,Borrower,Loan officer,Funding date,Funding cycle,Reversed at,Expected compensation USD,Recorded receipts USD,Expected less receipts USD,Commission obligation USD,Recorded direct expenses USD,Expense review complete,Estimated loan margin USD";
  const rows = loans.map((loan) => [csvCell(loan.id), csvCell(loan.borrower), csvCell(loan.officer), loan.date, loan.cycle, loan.reversedAt ?? "",
    dollars(loan.expectedCents), dollars(loan.receiptsCents), dollars(loan.remainingCents), dollars(loan.commissionCents),
    dollars(loan.expensesCents), loan.expenseReviewed ? "Yes" : "No", dollars(loan.marginCents)].join(","));
  return [header, ...rows].join("\r\n");
}

function financePage(db: Store, input: Extract<FinanceInput, { type: "list" | "export" }>, staff: WorkspaceStaff, at: string): FinanceResult {
  const source = sources[input.view];
  const owner = input.owner.startsWith("email:") ? "AND loan.officerEmail = ?" : input.owner.startsWith("name:") ? "AND loan.officerEmail IS NULL AND loan.officer = ?" : "";
  const where = `WHERE ${source.date} BETWEEN ? AND ? AND ${source.eligible} ${owner}`;
  const args = [input.from, input.through, ...(owner ? [input.owner.slice(input.owner.indexOf(":") + 1)] : [])];
  const after = input.type === "list" ? input.after : undefined;
  const cursor = after ? `AND (${source.date}, ${source.id}, ${source.cycle}) < (?, ?, ?)` : "";
  const limit = input.type === "list" ? pageSize : exportLimit;
  const rows = db.prepare(`SELECT ${source.date} AS date, ${source.cycle} AS cycle, ${financeColumns} ${source.joins}
    JOIN contacts contact ON contact.id = loan.contactId ${where} ${cursor}
    ORDER BY ${source.date} DESC, ${source.id} DESC, ${source.cycle} DESC LIMIT ?`)
    .all(...args, ...(after ? [after.date, after.id, after.cycle] : []), limit + 1) as unknown as FinanceRow[];
  const loans = rows.slice(0, limit).map(mapLoan);
  if (input.type === "export") {
    if (rows.length > exportLimit) return { error: "Choose a smaller date range or an officer to export up to 1,000 financial records." };
    accessEvent(db, staff, "Exported brokerage finance summary", `${input.view} · ${input.from} to ${input.through} · ${loans.length} records`, at);
    return { kind: "export", csv: summaryCsv(loans), count: loans.length };
  }
  const totals = db.prepare(`SELECT count(*) AS count, count(ledger.expectedCents) AS expectedCount, coalesce(sum(ledger.expectedCents), 0) AS expectedCents,
    coalesce(sum(ledger.receiptsCents), 0) AS receiptsCents, coalesce(sum(ledger.expensesCents), 0) AS expensesCents,
    count(${margin}) AS marginCount, coalesce(sum(${margin}), 0) AS marginCents ${source.joins} ${where}`)
    .get(...args) as unknown as FinanceTotals;
  const last = loans.at(-1);
  const settlements = settlementStatuses(db, loans);
  return { kind: "list", loans: loans.map((loan) => {
    const settlementStatus = settlements.get(`${loan.id}:${loan.cycle}`);
    return settlementStatus ? { ...loan, settlementStatus } : loan;
  }), totals: { ...totals }, next: rows.length > limit && last ? { id: last.id, date: last.date, cycle: last.cycle } : null };
}

function financeDetail(db: Store, input: Extract<FinanceInput, { type: "detail" }>, today: string): FinanceResult {
  const loan = financeRecord(db, input.loanId, input.cycle) ?? financeRecord(db, input.loanId, input.cycle, true);
  if (!loan) return { error: "This funded or reversed financial record is unavailable." };
  const rows = db.prepare(`SELECT entry.sequence, entry.id, entry.kind, entry.amountCents, entry.occurredOn, entry.reference, entry.note,
    entry.reversesId, correction.id AS reversedBy, entry.at, entry.actorName FROM loan_financial_entries entry
    LEFT JOIN loan_financial_entries correction ON correction.reversesId = entry.id
    WHERE entry.loanId = ? AND entry.cycle = ? ${input.before ? "AND entry.sequence < ?" : ""} ORDER BY entry.sequence DESC LIMIT ?`)
    .all(input.loanId, input.cycle, ...(input.before ? [input.before] : []), pageSize + 1) as unknown as FinanceEntry[];
  const entries = rows.slice(0, pageSize).map((entry) => ({ ...entry }));
  return { kind: "detail", loan, entries, before: rows.length > pageSize ? entries.at(-1)?.sequence ?? null : null, today,
    settlement: readSettlement(db, loan, input.settlementBefore), settlementFees: readSettlementFees(db, loan, input.feeBefore) };
}

function saveFinance(db: Store, input: FinanceMutation, staff: WorkspaceStaff, at: string, today: string): FinanceResult {
  const request = JSON.stringify(input);
  const prior = db.prepare("SELECT actorEmail, request FROM loan_financial_entries WHERE id = ?").get(input.entryId);
  const message = { estimate: "Financial estimate saved.", post: "Ledger entry posted.", reverse: "Ledger entry reversed. The original remains in the history." }[input.type];
  if (prior) return prior.actorEmail === staff.email && prior.request === request ? { kind: "saved", message } : { error: "This entry identifier was already used." };
  const current = financeRecord(db, input.loanId, input.cycle);
  if (!current || current.reversedAt || current.date !== input.fundingDate || current.revision !== input.revision) {
    return { error: "The funding record or ledger changed. Refresh the file before saving." };
  }
  const { loanId, cycle } = input;
  let { expectedCents, commissionCents, expenseReviewed, receiptsCents, expensesCents } = current;
  let kind: FinanceEntry["kind"] = "Estimate";
  let amount: number | null = null;
  let reference = "";
  let note: string;
  let reversesId: string | null = null;
  if (input.type === "estimate") {
    const display = (expected: number | null, commission: number | null, reviewed: boolean) =>
      `Expected ${financeMoney(expected)} · Commission ${financeMoney(commission)} · Expenses ${reviewed ? "reviewed" : "incomplete"}`;
    note = `${display(expectedCents, commissionCents, expenseReviewed)} → ${display(input.expectedCents, input.commissionCents, input.expenseReviewed)}`;
    ({ expectedCents, commissionCents, expenseReviewed } = input);
  } else {
    if (input.occurredOn < "1900-01-01" || input.occurredOn > today) return { error: "Enter a posted date on or before today." };
    note = input.note;
    if (input.type === "reverse") {
      const original = db.prepare(`SELECT kind, amountCents, reference, occurredOn FROM loan_financial_entries entry WHERE id = ? AND loanId = ? AND cycle = ?
        AND kind IN ('Receipt', 'Expense') AND NOT EXISTS (SELECT 1 FROM loan_financial_entries reversal WHERE reversal.reversesId = entry.id)`)
        .get(input.originalId, loanId, cycle);
      if (!original || input.occurredOn < String(original.occurredOn)) return { error: "Choose an unreversed entry and a reversal date on or after its posting date." };
      kind = original.kind === "Receipt" ? "Reverse receipt" : "Reverse expense";
      amount = -Number(original.amountCents);
      reference = String(original.reference);
      reversesId = input.originalId;
    } else {
      ({ kind, reference, amountCents: amount } = input);
    }
    if (kind === "Receipt" || kind === "Reverse receipt") receiptsCents += amount;
    else { expensesCents += amount; expenseReviewed = false; }
    if (receiptsCents > ledgerLimit || expensesCents > ledgerLimit) return { error: "This ledger is above the supported balance limit." };
  }
  db.prepare(`INSERT INTO loan_financials (loanId, cycle, fundingDate, expectedCents, commissionCents, expenseReviewed, receiptsCents, expensesCents, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(loanId, cycle) DO UPDATE SET expectedCents = excluded.expectedCents,
      commissionCents = excluded.commissionCents, expenseReviewed = excluded.expenseReviewed,
      receiptsCents = excluded.receiptsCents, expensesCents = excluded.expensesCents, revision = revision + 1`)
    .run(loanId, cycle, current.date, expectedCents, commissionCents, Number(expenseReviewed), receiptsCents, expensesCents);
  db.prepare(`INSERT INTO loan_financial_entries (id, loanId, cycle, kind, amountCents, occurredOn, reference, note, reversesId, at, actorName, actorEmail, request)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.entryId, loanId, cycle, kind, amount,
    input.type === "estimate" ? today : input.occurredOn, reference, note, reversesId, at, staff.name, staff.email, request);
  return { kind: "saved", message };
}

export function brokerageFinanceWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()): FinanceResult {
  if (!staff || staff.brokerage.id !== brokerageId || !canManageFinance(staff)) return { error: financeUnavailable };
  const parsed = financeInput.safeParse(input);
  if (!parsed.success) return { error: "Check the financial form or select a date range of up to 366 days." };
  const data = parsed.data;
  const today = easternDate(now);
  const at = now.toISOString();
  if (data.type === "list" || data.type === "export") return financePage(db, data, staff, at);
  if (data.type === "detail") return financeDetail(db, data, today);
  if (data.type === "settlementQueue") return readSettlementQueue(db, data);
  if (data.type === "findSettlementDestination") {
    if (!financeRecord(db, data.loanId, data.cycle)) return { error: "Open a current funding cycle before searching." };
    const rows = db.prepare(`SELECT loan.id, progress.fundingDate AS date, progress.fundingCycle AS cycle, contact.name AS borrower
      FROM closing_progress progress JOIN loans loan ON loan.id = progress.loanId JOIN contacts contact ON contact.id = loan.contactId
      WHERE progress.fundingDate IS NOT NULL AND loan.id <> ? AND (loan.id = ? OR instr(lower(contact.name), lower(?)) > 0)
      ORDER BY progress.fundingDate DESC, loan.id LIMIT 11`).all(data.loanId, data.search, data.search) as unknown as SettlementDestination[];
    return { kind: "settlementDestinations", rows: rows.slice(0, 10).map(row => ({ ...row })), more: rows.length > 10 };
  }
  if (data.type === "settlementFeed" || data.type === "pullSettlementFeed" || data.type === "reviewSettlementFeed" || data.type === "matchSettlementFeed") {
    return db.transaction(() => settlementFeedWork(db, data, financeRecord(db, data.loanId, data.cycle) ??
      (data.type === "settlementFeed" ? financeRecord(db, data.loanId, data.cycle, true) : undefined), staff, at, today,
      (id, cycle) => financeRecord(db, id, cycle) ?? financeRecord(db, id, cycle, true)));
  }
  if (data.type === "settlementEvidencePreview" || data.type === "settlementEvidenceImport") {
    return db.transaction(() => importSettlementEvidence(db, data, financeRecord(db, data.loanId, data.cycle), staff, at, today));
  }
  if (data.type === "settlementFeeStatement" || data.type === "settlementFeeReview") {
    return db.transaction(() => saveSettlementFees(db, data, financeRecord(db, data.loanId, data.cycle), staff, at, today));
  }
  if (data.type === "settlementAdvice" || data.type === "settlementReceipt" || data.type === "settlementReverse" || data.type === "settlementReview") {
    return db.transaction(() => saveSettlement(db, data, financeRecord(db, data.loanId, data.cycle), staff, at, today));
  }
  return db.transaction(() => saveFinance(db, data, staff, at, today));
}

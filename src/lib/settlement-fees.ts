import type { FinanceLoan, FinanceResult, SettlementFeeMutation, SettlementQueuePage, SettlementQueueQuery, SettlementQueueRow } from "./brokerage-finance-model";
import { readDisclosureWork } from "./disclosures";
import { borrowerFee, feeKeys } from "./quote-worksheet";
import { compareSettlementFees, type SettlementFeeBaseline, type SettlementFeeEvent, type SettlementFeeStatement,
  type SettlementFeeWork } from "./settlement-fee-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const pageSize = 20;
type EventRow = Omit<SettlementFeeEvent, "statement"> & { statement: string; baseline: string };
const reviewed = "coalesce(event.kind = 'Review' AND event.fundingDate = progress.fundingDate, 0)";
const queueSource = `FROM settlement_fee_events event JOIN closing_progress progress
  ON progress.loanId = event.loanId AND progress.fundingCycle = event.cycle`;
const queueWhere = "event.supersededAt IS NULL AND event.differenceCount > 0 AND progress.fundingDate IS NOT NULL";
const eventColumns = "revision, kind, at, actor, fundingDate, statement, baseline, note, differenceCount, missingCount";

function confirmedBaseline(db: Store, loanId: string): SettlementFeeBaseline | null {
  const work = readDisclosureWork(db, loanId);
  const review = work.closingReviews.find(({ current }) => current);
  const inputs = work.packages[0]?.quote.estimate?.inputs;
  if (!review || !inputs || !feeKeys.some((key) => inputs.fees[key] !== null)) return null;
  const { version, revision, feeRevision, at, actor } = review;
  const lines = Object.fromEntries(feeKeys.map((key) => [key, {
    gross: inputs.fees[key], borrower: borrowerFee(inputs, key), payee: inputs.allocations?.[key]?.payee ?? "",
  }])) as SettlementFeeBaseline["lines"];
  return { version, revision, feeRevision, confirmedAt: at, confirmedBy: actor, lines };
}

function latestFeeEvent(db: Store, loan: FinanceLoan) {
  return db.prepare(`SELECT ${eventColumns} FROM settlement_fee_events WHERE loanId = ? AND cycle = ? AND supersededAt IS NULL`)
    .get(loan.id, loan.cycle) as unknown as EventRow | undefined;
}

export function readSettlementFees(db: Store, loan: FinanceLoan, before?: number): SettlementFeeWork {
  const latest = latestFeeEvent(db, loan);
  const baseline = latest ? JSON.parse(latest.baseline) as SettlementFeeBaseline : loan.reversedAt ? null : confirmedBaseline(db, loan.id);
  const statement = latest ? JSON.parse(latest.statement) as SettlementFeeStatement : null;
  const reviewed = latest?.kind === "Review" && latest.fundingDate === loan.date;
  const status = !baseline ? "Awaiting confirmed fees" : !latest ? "Awaiting fee statement" :
    latest.differenceCount ? reviewed ? "Fee difference reviewed" : "Fee difference to review" :
    latest.missingCount ? "More fee figures needed" : "Fees match";
  const rows = latest ? db.prepare(`SELECT revision, kind, at, actor, fundingDate, statement, note, differenceCount, missingCount
    FROM settlement_fee_events WHERE loanId = ? AND cycle = ?
    ${before ? "AND revision < ?" : ""} ORDER BY revision DESC LIMIT ?`)
    .all(loan.id, loan.cycle, ...(before ? [before] : []), pageSize + 1) as unknown as Omit<EventRow, "baseline">[] : [];
  const entries = rows.slice(0, pageSize).map(({ statement, ...event }) =>
    ({ ...event, statement: JSON.parse(statement) as SettlementFeeStatement }));
  return { revision: latest?.revision ?? 0, baseline, statement, status, reviewed, entries,
    before: rows.length > pageSize ? entries.at(-1)?.revision ?? null : null };
}

export function settlementFeeQueueCounts(db: Store) {
  const totals = db.prepare(`SELECT ${reviewed} AS reviewed, count(*) AS total ${queueSource} WHERE ${queueWhere} GROUP BY reviewed`).all();
  return { "Fee differences": Number(totals.find((row) => !row.reviewed)?.total ?? 0),
    "Reviewed fee differences": Number(totals.find((row) => row.reviewed)?.total ?? 0) };
}

export function settlementFeeQueuePage(db: Store, { view, after }: SettlementQueueQuery, counts: SettlementQueuePage["counts"]): SettlementQueuePage {
  const reviewedView = view === "Reviewed fee differences";
  const cursor = after ? "AND (event.at, event.loanId, event.cycle) < (?, ?, ?)" : "";
  const items = db.prepare(`SELECT event.loanId AS id, event.cycle, event.at AS changedAt, contact.name AS borrower, loan.officer,
    progress.fundingDate AS date, event.differenceCount, event.missingCount
    ${queueSource} JOIN loans loan ON loan.id = event.loanId JOIN contacts contact ON contact.id = loan.contactId
    WHERE ${queueWhere} AND ${reviewed} = ? ${cursor}
    ORDER BY event.at DESC, event.loanId DESC, event.cycle DESC LIMIT ?`)
    .all(Number(reviewedView), ...(after ? [after.changedAt, after.id, after.cycle] : []), pageSize + 1) as unknown as
    (Pick<SettlementQueueRow, "id" | "cycle" | "changedAt" | "borrower" | "officer" | "date"> & { differenceCount: number; missingCount: number })[];
  const rows = items.slice(0, pageSize).map(({ differenceCount, missingCount, ...item }): SettlementQueueRow => ({
    ...item, feeComparison: { differenceCount, missingCount }, expectedCents: null, receivedCents: 0, differenceCents: null,
    status: reviewedView ? "Fee difference reviewed" : "Fee difference to review",
  }));
  const last = rows.at(-1);
  return { kind: "settlementQueue", counts, rows,
    next: items.length > pageSize && last ? { id: last.id, cycle: last.cycle, changedAt: last.changedAt } : null };
}

export function saveSettlementFees(db: Store, data: SettlementFeeMutation, loan: FinanceLoan | undefined, staff: WorkspaceStaff, at: string, today: string): FinanceResult {
  const request = JSON.stringify(data);
  const prior = db.prepare("SELECT request, actorEmail FROM settlement_fee_events WHERE id = ?").get(data.entryId);
  const isStatement = data.type === "settlementFeeStatement";
  const result = { kind: "saved", message: isStatement ? "Sample settlement fee statement recorded." : "Sample settlement fee review recorded." } as const;
  if (prior) return prior.request === request && prior.actorEmail === staff.email ? result : { error: "This fee event identifier was already used." };
  if (!loan || loan.reversedAt || loan.date !== data.fundingDate) {
    return { error: "Open the current funded cycle to record sample fee evidence." };
  }
  const latest = latestFeeEvent(db, loan);
  if (data.revision !== (latest?.revision ?? 0)) return { error: "The fee comparison changed. Refresh the ledger before saving." };
  const baseline = latest ? JSON.parse(latest.baseline) as SettlementFeeBaseline : confirmedBaseline(db, loan.id);
  if (!baseline) return { error: "Confirm a sample disclosure with itemized fees before recording a settlement fee statement." };
  let statement: SettlementFeeStatement;
  if (isStatement) {
    if (baseline.version !== data.baseline.version || baseline.revision !== data.baseline.revision) {
      return { error: "The confirmed fee baseline changed. Refresh the ledger before saving." };
    }
    if (data.occurredOn < "1900-01-01" || data.occurredOn > today) return { error: "Enter a sample statement date on or before today." };
    if (latest && !data.note) return { error: "Record what changed on the corrected fee statement." };
    const { occurredOn, reference, lines } = data;
    statement = { occurredOn, reference, lines };
  } else {
    if (!latest?.differenceCount || latest.kind === "Review" && latest.fundingDate === loan.date) {
      return { error: "Open a current fee difference before recording a review." };
    }
    statement = JSON.parse(latest.statement) as SettlementFeeStatement;
  }
  const rows = compareSettlementFees(baseline, statement);
  db.prepare(`INSERT INTO loan_financials (loanId, cycle, fundingDate) VALUES (?, ?, ?)
    ON CONFLICT (loanId, cycle) DO NOTHING`).run(loan.id, loan.cycle, loan.date);
  db.prepare("UPDATE settlement_fee_events SET supersededAt = ? WHERE loanId = ? AND cycle = ? AND supersededAt IS NULL")
    .run(at, loan.id, loan.cycle);
  db.prepare(`INSERT INTO settlement_fee_events (loanId, cycle, revision, id, kind, fundingDate, at, actor, actorEmail,
    note, baseline, statement, request, differenceCount, missingCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(loan.id, loan.cycle, data.revision + 1, data.entryId, isStatement ? "Statement" : "Review", loan.date, at, staff.name, staff.email,
      data.note, JSON.stringify(baseline), JSON.stringify(statement), request, rows.filter((row) => row.different).length, rows.filter((row) => row.missing).length);
  if (!isStatement) accessEvent(db, staff, "Reviewed sample settlement fee differences", loan.id, at);
  return result;
}

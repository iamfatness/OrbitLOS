import { z } from "zod";
import type { WorkspaceStaff } from "./staff-store";
import { validReportRange } from "./report-date-range";
import { settlementFeeAmounts, settlementFeeBaselineVersion, settlementFeeQueueViews,
  type SettlementFeeStatus, type SettlementFeeWork } from "./settlement-fee-model";

export const financeUnavailable = "Brokerage financials are available to the fictional workspace owner.";
export function canManageFinance(staff: WorkspaceStaff | null) {
  return staff?.brokerage.role === "Admin" && staff.brokerage.pilot === true && staff.brokerage.financeAccess === true;
}

const loanId = z.string().min(1).max(160);
const date = z.iso.date();
const cycle = z.number().int().positive();
const revision = z.number().int().nonnegative();
const entryId = z.uuid();
const cents = z.number().int().min(0).max(1_000_000_000);
const cursor = z.object({ id: loanId, date, cycle });
const filters = { from: date, through: date, view: z.enum(["Funded", "Reversed"]), owner: z.string().max(306).regex(/^(?:|email:.+|name:.*)$/) };
const record = { loanId, cycle };
const write = { ...record, entryId, revision, fundingDate: date };
const note = z.string().trim().max(280);
const settlementAmount = z.number().int().min(0).max(5_000_000_000);
const settlementReference = z.string().trim().min(1).max(120);
const evidenceIdentity = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const settlementImportBase = { schemaVersion: z.literal(1), source: evidenceIdentity, evidenceId: evidenceIdentity,
  ...record, fundingDate: date, occurredOn: date, reference: settlementReference };
export const settlementEvidence = z.discriminatedUnion("kind", [
  z.strictObject({ ...settlementImportBase, kind: z.literal("Purchase advice"), sequence: z.number().int().positive(),
    grossCents: settlementAmount.min(1), feesCents: settlementAmount, adjustmentCents: z.number().int().min(-5_000_000_000).max(5_000_000_000) }),
  z.strictObject({ ...settlementImportBase, kind: z.literal("Wire receipt"), amountCents: settlementAmount.min(1) }),
]);
export type SettlementEvidence = z.infer<typeof settlementEvidence>;
export const settlementQueueViews = ["Differences", "Matches to confirm", "Missing evidence", "Reviewed differences", ...settlementFeeQueueViews] as const;
const settlementCursor = z.object({ id: loanId, cycle, changedAt: z.iso.datetime() });

const settlementInputs = [
  z.object({ type: z.literal("settlementAdvice"), ...write, occurredOn: date, reference: settlementReference,
    grossCents: settlementAmount.min(1), feesCents: settlementAmount, adjustmentCents: z.number().int().min(-5_000_000_000).max(5_000_000_000), note }),
  z.object({ type: z.literal("settlementReceipt"), ...write, occurredOn: date, reference: settlementReference, amountCents: settlementAmount.min(1), note }),
  z.object({ type: z.literal("settlementReverse"), ...write, occurredOn: date, originalId: entryId, note: note.min(1) }),
  z.object({ type: z.literal("settlementReview"), ...write, note }),
] as const;
const settlementFeeInputs = [
  z.object({ type: z.literal("settlementFeeStatement"), ...write, baseline: settlementFeeBaselineVersion,
    occurredOn: date, reference: settlementReference, lines: settlementFeeAmounts, note }),
  z.object({ type: z.literal("settlementFeeReview"), ...write, note: note.min(1) }),
] as const;

export const financeInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), ...filters, after: cursor.optional() }).refine(validReportRange),
  z.object({ type: z.literal("export"), ...filters }).refine(validReportRange),
  z.object({ type: z.literal("detail"), ...record, before: z.number().int().positive().optional(),
    settlementBefore: revision.min(1).optional(), feeBefore: revision.min(1).optional() }),
  z.object({ type: z.literal("settlementQueue"), view: z.enum(settlementQueueViews), after: settlementCursor.optional() }),
  z.object({ type: z.literal("settlementEvidencePreview"), ...record, evidence: settlementEvidence }),
  z.object({ type: z.literal("settlementEvidenceImport"), ...write, evidence: settlementEvidence }),
  z.object({ type: z.literal("settlementFeed"), ...record }),
  z.object({ type: z.literal("pullSettlementFeed"), ...record, fundingDate: date }),
  z.object({ type: z.literal("reviewSettlementFeed"), ...record, evidenceId: evidenceIdentity, note: note.min(5) }),
  z.object({ type: z.literal("estimate"), ...write, expectedCents: cents.nullable(), commissionCents: cents.nullable(), expenseReviewed: z.boolean() }),
  z.object({ type: z.literal("post"), ...write, kind: z.enum(["Receipt", "Expense"]), amountCents: cents.min(1), occurredOn: date,
    reference: z.string().trim().min(1).max(120), note }),
  z.object({ type: z.literal("reverse"), ...write, originalId: entryId, occurredOn: date, note: note.min(1) }),
  ...settlementInputs,
  ...settlementFeeInputs,
]);

export type FinanceInput = z.infer<typeof financeInput>;
export type SettlementEvidenceInput = Extract<FinanceInput, { type: "settlementEvidencePreview" | "settlementEvidenceImport" }>;
export type SettlementEvidencePreview = { kind: "settlementEvidencePreview"; amountCents: number; alreadyRecorded: boolean; revision: number };
export type SettlementFeedRow = {
  evidenceId: string; fundingReference: string; kind: SettlementEvidence["kind"];
  amountCents: number; status: "Imported" | "Already recorded" | "Needs review" | "Reviewed";
  detail: string; reviewNote: string | null; reviewedBy: string | null; reviewedAt: string | null;
};
export type SettlementFeed = { kind: "settlementFeed"; checkedFundingDate: string | null; rows: SettlementFeedRow[] };
export type FinanceListQuery = Extract<FinanceInput, { type: "list" }>;
export type SettlementQueueQuery = Extract<FinanceInput, { type: "settlementQueue" }>;
export type SettlementQueueRow = z.infer<typeof settlementCursor> & {
  borrower: string; officer: string; date: string; expectedCents: number | null; receivedCents: number;
  differenceCents: number | null; status: SettlementWork["status"] | SettlementFeeStatus;
  feeComparison?: { differenceCount: number; missingCount: number };
};
export type SettlementQueuePage = { kind: "settlementQueue"; rows: SettlementQueueRow[];
  counts: Record<SettlementQueueQuery["view"], number>; next: z.infer<typeof settlementCursor> | null };
export type FinanceMutation = Extract<FinanceInput, { type: "estimate" | "post" | "reverse" }>;
export type SettlementMutation = z.infer<(typeof settlementInputs)[number]>;
export type SettlementChange<Action = SettlementMutation> = Action extends SettlementMutation
  ? Omit<Action, "loanId" | "cycle" | "fundingDate" | "revision" | "entryId"> : never;
export type SettlementFeeMutation = z.infer<(typeof settlementFeeInputs)[number]>;
export type SettlementFeeChange<Action = SettlementFeeMutation> = Action extends SettlementFeeMutation
  ? Omit<Action, "loanId" | "cycle" | "fundingDate" | "revision" | "entryId"> : never;
export type SettlementEntry = { revision: number; id: string; at: string; actorName: string; input: SettlementMutation;
  importedEvidence?: { source: string; evidenceId: string; sequence: number | null };
  amountCents: number | null; reversed: boolean };
export type SettlementWork = {
  revision: number; expectedCents: number | null; receivedCents: number; differenceCents: number | null;
  advice: Extract<SettlementMutation, { type: "settlementAdvice" }> | null;
  receiptCount: number; reviewed: boolean;
  status: "Awaiting advice" | "Awaiting receipts" | "Difference to review" | "Ready to confirm" | "Difference reviewed" | "Reconciled";
  entries: SettlementEntry[]; before: number | null;
};
export type FinanceAmounts = { expectedCents: number | null; commissionCents: number | null; receiptsCents: number;
  expensesCents: number; expenseReviewed: boolean; remainingCents: number | null; marginCents: number | null };
export type FinanceLoan = z.infer<typeof cursor> & FinanceAmounts & { borrower: string; officer: string; reversedAt: string | null; revision: number;
  settlementStatus?: SettlementWork["status"] };
export type FinanceTotals = { count: number; expectedCount: number; expectedCents: number; receiptsCents: number;
  expensesCents: number; marginCount: number; marginCents: number };
export type FinanceEntry = { sequence: number; id: string; kind: "Estimate" | "Receipt" | "Expense" | "Reverse receipt" | "Reverse expense";
  amountCents: number | null; occurredOn: string; reference: string; note: string; reversesId: string | null; reversedBy: string | null;
  at: string; actorName: string };
export type FinanceResult = { kind: "list"; loans: FinanceLoan[]; totals: FinanceTotals; next: z.infer<typeof cursor> | null } |
  { kind: "detail"; loan: FinanceLoan; entries: FinanceEntry[]; before: number | null; today: string; settlement: SettlementWork; settlementFees?: SettlementFeeWork } |
  { kind: "export"; csv: string; count: number } | { kind: "saved"; message: string } | SettlementQueuePage | SettlementEvidencePreview | SettlementFeed | { error: string };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const financeMoney = (amount: number | null) => amount === null ? "Unknown" : usd.format(amount / 100);
export const inputDollars = (amount: number | null) => amount === null ? "" : (amount / 100).toFixed(2);

export function financeInputCents(value: FormDataEntryValue | null, limit = 1_000_000_000, signed = false) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parts = /^(\d*)(?:\.(\d{1,2}))?$/.exec(signed && text.startsWith("-") ? text.slice(1) : text);
  if (!parts || !(parts[1] || parts[2])) return undefined;
  const amount = Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount <= limit ? (text.startsWith("-") && amount ? -amount : amount) : undefined;
}

import { z } from "zod";
import type { WorkspaceStaff } from "./staff-store";
import { validReportRange } from "./report-date-range";

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

export const financeInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), ...filters, after: cursor.optional() }).refine(validReportRange),
  z.object({ type: z.literal("export"), ...filters }).refine(validReportRange),
  z.object({ type: z.literal("detail"), ...record, before: z.number().int().positive().optional() }),
  z.object({ type: z.literal("estimate"), ...write, expectedCents: cents.nullable(), commissionCents: cents.nullable(), expenseReviewed: z.boolean() }),
  z.object({ type: z.literal("post"), ...write, kind: z.enum(["Receipt", "Expense"]), amountCents: cents.min(1), occurredOn: date,
    reference: z.string().trim().min(1).max(120), note }),
  z.object({ type: z.literal("reverse"), ...write, originalId: entryId, occurredOn: date, note: note.min(1) }),
]);

export type FinanceInput = z.infer<typeof financeInput>;
export type FinanceListQuery = Extract<FinanceInput, { type: "list" }>;
export type FinanceMutation = Extract<FinanceInput, { type: "estimate" | "post" | "reverse" }>;
export type FinanceAmounts = { expectedCents: number | null; commissionCents: number | null; receiptsCents: number;
  expensesCents: number; expenseReviewed: boolean; remainingCents: number | null; marginCents: number | null };
export type FinanceLoan = z.infer<typeof cursor> & FinanceAmounts & { borrower: string; officer: string; reversedAt: string | null; revision: number };
export type FinanceTotals = { count: number; expectedCount: number; expectedCents: number; receiptsCents: number;
  expensesCents: number; marginCount: number; marginCents: number };
export type FinanceEntry = { sequence: number; id: string; kind: "Estimate" | "Receipt" | "Expense" | "Reverse receipt" | "Reverse expense";
  amountCents: number | null; occurredOn: string; reference: string; note: string; reversesId: string | null; reversedBy: string | null;
  at: string; actorName: string };
export type FinanceResult = { kind: "list"; loans: FinanceLoan[]; totals: FinanceTotals; next: z.infer<typeof cursor> | null } |
  { kind: "detail"; loan: FinanceLoan; entries: FinanceEntry[]; before: number | null; today: string } |
  { kind: "export"; csv: string; count: number } | { kind: "saved"; message: string } | { error: string };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const financeMoney = (amount: number | null) => amount === null ? "Unknown" : usd.format(amount / 100);

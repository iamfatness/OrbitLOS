import { z } from "zod";
import type { Loan } from "./model";
import type { LoanProcessing } from "./processing-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const id = z.string().min(1).max(100);
const cursor = z.object({ id, stageSince: z.string().min(1).max(80) });
const request = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), search: z.string().trim().max(160), after: cursor.optional() }),
  z.object({ type: z.literal("open"), loanId: id }),
]);
export const loanAssignmentUnavailable = "This loan assignment is unavailable.";
export type AssignmentLoan = Pick<Loan, "id" | "address" | "stage" | "stageSince" | "officer" | "officerEmail"> & { name: string };
export type AssignmentPage = { kind: "list"; loans: AssignmentLoan[]; next: z.infer<typeof cursor> | null };
export type AssignmentDetail = { kind: "assignment"; loan: AssignmentLoan;
  processing: Pick<LoanProcessing, "processorEmail" | "processorName" | "status" | "updatedAt" | "revision"> | null };

const from = `SELECT loan.id, loan.address, loan.stage, loan.stageSince, loan.officer, loan.officerEmail, contact.name
  FROM loans loan JOIN contacts contact ON contact.id = loan.contactId`;
const pageSize = 20;

export function readLoanAssignments(db: Store, input: unknown, staff: WorkspaceStaff, brokerageId: string):
  AssignmentPage | AssignmentDetail | { error: string } {
  const parsed = request.safeParse(input);
  if (!parsed.success || staff.brokerage.role !== "Admin" || staff.brokerage.id !== brokerageId) return { error: loanAssignmentUnavailable };
  if (parsed.data.type === "open") {
    const row = db.prepare(`${from} WHERE loan.id = ?`).get(parsed.data.loanId);
    if (!row) return { error: loanAssignmentUnavailable };
    const processing = db.prepare("SELECT processorEmail, processorName, status, updatedAt, revision FROM loan_processing WHERE loanId = ?")
      .get(parsed.data.loanId);
    return { kind: "assignment", loan: { ...row } as AssignmentLoan,
      processing: processing ? { ...processing } as AssignmentDetail["processing"] : null };
  }
  const needle = parsed.data.search.toLowerCase();
  const loans: AssignmentLoan[] = [];
  let after = parsed.data.after;
  const limit = needle ? 100 : pageSize + 1;
  const match = needle ? `AND (instr(lower(contact.name), ?) OR instr(lower(loan.address), ?) OR instr(lower(loan.officer), ?)
    OR contact.name GLOB '*[^ -~]*' OR loan.address GLOB '*[^ -~]*' OR loan.officer GLOB '*[^ -~]*')` : "";
  while (loans.length <= pageSize) {
    const rows = db.prepare(`${from} WHERE 1 ${match}
      ${after ? "AND (loan.stageSince < ? OR (loan.stageSince = ? AND loan.id > ?))" : ""}
      ORDER BY loan.stageSince DESC, loan.id LIMIT ?`)
      .all(...(needle ? [needle, needle, needle] : []), ...(after ? [after.stageSince, after.stageSince, after.id] : []), limit) as unknown as AssignmentLoan[];
    loans.push(...rows.filter(({ name, address, officer }) => !needle || [name, address, officer].some((value) => value.toLowerCase().includes(needle))));
    if (rows.length < limit) break;
    after = rows.at(-1);
  }
  const last = loans[pageSize - 1];
  return { kind: "list", loans: loans.slice(0, pageSize).map((loan) => ({ ...loan })),
    next: loans.length > pageSize && last ? { id: last.id, stageSince: last.stageSince } : null };
}

import { z } from "zod";

export const loanContactPickerUnavailable = "Could not load contacts for this loan.";
const id = z.string().min(1).max(100);
const cursor = z.object({ name: z.string().max(500), id });
export const loanContactPickerInput = z.object({
  kind: z.enum(["borrower", "realtor"]), search: z.string().trim().max(120), selectedId: id.optional(), after: cursor.optional(),
});
export type LoanContactOption = { id: string; name: string; detail: string };
export type LoanContactPage = {
  options: LoanContactOption[];
  selected: LoanContactOption | null;
  selectedHasLoan: boolean;
  next: z.infer<typeof cursor> | null;
  officers: string[];
};

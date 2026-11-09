import { z } from "zod";

export const fileExceptionsUnavailable = "File exceptions are available to brokerage admins.";
export const fileExceptionKinds = ["Missing evidence", "Internal reviews", "Reopened conditions", "Required 1003 approvals", "Manual lender returns"] as const;
export const fileExceptionFilters = ["All file exceptions", ...fileExceptionKinds] as const;
const key = z.string().min(1).max(500);
const cursor = z.object({ sortOn: z.iso.date(), kind: z.enum(fileExceptionKinds), id: key, parentId: key });
export const fileExceptionQuery = z.object({ filter: z.enum(fileExceptionFilters), after: cursor.optional() });
export type FileExceptionQuery = z.infer<typeof fileExceptionQuery>;
export type FileException = z.infer<typeof cursor> & {
  loanId: string; borrower: string; title: string; status: string; target: string; action: string;
  owner: string | null; ownerAvailable: boolean; nextParty: string | null; dueOn: string | null; reopenedAt: string | null;
  evidence: string | null; overdue: boolean; escalated: boolean;
};
export type FileExceptionPage = { items: FileException[]; next: FileExceptionQuery["after"] | null; today: string };

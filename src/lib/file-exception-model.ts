import { z } from "zod";
import type { ManualReturnFollowUp } from "./lender-export-model";

export const fileExceptionsUnavailable = "File exceptions are available to brokerage admins.";
export const fileExceptionKinds = ["Missing evidence", "Internal reviews", "Reopened conditions", "Required 1003 approvals", "Manual lender returns"] as const;
export const overdueManualReturnFilter = "Overdue lender returns";
export const unattendedManualReturnFilter = "Overdue lender returns without follow-up";
export const fileExceptionFilters = ["All file exceptions", ...fileExceptionKinds, overdueManualReturnFilter, unattendedManualReturnFilter] as const;
const key = z.string().min(1).max(500);
const cursor = z.object({ sortOn: z.union([z.iso.date(), z.iso.datetime()]), kind: z.enum(fileExceptionKinds), id: key, parentId: key });
export const fileExceptionQuery = z.object({ filter: z.enum(fileExceptionFilters), after: cursor.optional() });
export type FileExceptionQuery = z.infer<typeof fileExceptionQuery>;
export type FileException = z.infer<typeof cursor> & {
  loanId: string; borrower: string; title: string; status: string; target: string; action: string;
  owner: string | null; ownerAvailable: boolean; nextParty: string | null; dueOn: string | null; reopenedAt: string | null;
  evidence: string | null; overdue: boolean; escalated: boolean;
  returnEventId?: string;
  returnDueAt?: string;
  returnFollowUp?: ManualReturnFollowUp;
};
export type FileExceptionPage = { items: FileException[]; next: FileExceptionQuery["after"] | null; today: string };

import { z } from "zod";

export const incomingLoanWorkUnavailable = "Incoming loan work is unavailable in this workspace.";
export const incomingLoanWorkProcessingStatuses = ["Assigned", "Ready for processing", "In processing", "Returned to LO"] as const;

const cursor = z.object({ receivedAt: z.iso.datetime(), kind: z.enum(["application", "document", "handoff"]), id: z.string().min(1).max(160) });
export const incomingLoanWorkQuery = z.object({ view: z.enum(["today", "processing"]), after: cursor.optional() });
export type IncomingLoanWorkQuery = z.infer<typeof incomingLoanWorkQuery>;
export type IncomingLoanWorkItem = z.infer<typeof cursor> & {
  loanId: string; name: string; title: string; revision: number; assignee: string | null; linkedCondition: boolean; note: string | null;
};
export type IncomingLoanWorkPage = { items: IncomingLoanWorkItem[]; next: z.infer<typeof cursor> | null };

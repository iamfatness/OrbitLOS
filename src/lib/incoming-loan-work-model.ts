import { z } from "zod";
import type { ManualReturnFollowUp, ManualReturnStatus } from "./lender-export-model";
import { preapprovalWorkKinds } from "./preapproval-policy-model";

export const incomingLoanWorkUnavailable = "Incoming loan work is unavailable in this workspace.";
export const importRejectionTargetPrefix = "uwm-import-rejection-";
export const importRejectionTarget = (id: string) => importRejectionTargetPrefix + id;
export const incomingLoanWorkProcessingStatuses = ["Assigned", "Ready for processing", "In processing", "Returned to LO"] as const;

const cursor = z.object({ receivedAt: z.iso.datetime(), kind: z.enum(["application", "document", "handoff", "lender-return", "lead-document", "question", "underwriting",
  "realtor-financing", "import-rejection", ...preapprovalWorkKinds]), id: z.string().min(1).max(160) });
export const incomingLoanWorkQuery = z.object({ view: z.enum(["today", "processing"]), after: cursor.optional() });
export type IncomingLoanWorkQuery = z.infer<typeof incomingLoanWorkQuery>;
type IncomingCursor = z.infer<typeof cursor>;
export type IncomingLoanWorkItem = Omit<IncomingCursor, "kind"> & {
  name: string; title: string; revision: number; assignee: string | null; linkedCondition: boolean; note: string | null;
  returnStatus?: ManualReturnStatus;
  returnEventId?: string;
  returnSubmissionId?: string | null;
  returnDeadline?: { dueAt: string; overdue: boolean };
  returnFollowUp?: ManualReturnFollowUp;
} & ({ kind: "lead-document"; leadId: string } | { kind: Exclude<IncomingCursor["kind"], "lead-document">; loanId: string });
export type IncomingLoanWorkPage = { items: IncomingLoanWorkItem[]; next: z.infer<typeof cursor> | null };

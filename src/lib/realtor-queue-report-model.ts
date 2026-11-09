import { z } from "zod";

export const realtorQueueReportUnavailable = "The realtor queue report is available to brokerage admins.";
const cursor = z.object({ at: z.iso.datetime(), id: z.uuid() });
export const realtorQueueReportInput = z.object({
  view: z.enum(["Waiting", "Claim history"]), days: z.union([z.literal(7), z.literal(30)]), after: cursor.optional(),
});
export const assignWaitingRealtorInput = z.object({
  leadId: z.uuid(), waitingSince: z.iso.datetime(), officerEmail: z.email().max(254),
});
export type AssignWaitingRealtorInput = z.infer<typeof assignWaitingRealtorInput>;
export type RealtorQueueReportInput = z.infer<typeof realtorQueueReportInput>;
export type RealtorQueueReport = {
  checkedAt: string;
  waiting: number;
  oldestWaitSeconds: number | null;
  claims: number;
  measuredClaims: number;
  averageWaitSeconds: number | null;
  items: (z.infer<typeof cursor> & { leadId: string; name: string; realtor: string; loanId: string | null; closed: boolean;
    officer: string | null; seconds: number; estimated: boolean; dueAt: string; contactStatus: string | null })[];
  next: z.infer<typeof cursor> | null;
};

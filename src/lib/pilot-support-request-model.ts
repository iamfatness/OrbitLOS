import { z } from "zod";
import { pilotFeedbackStatuses, type PilotFeedback } from "./brokerage-model";

const cursor = z.object({ id: z.uuid(), createdAt: z.iso.datetime() });
export const pilotSupportRequestQuery = z.object({
  type: z.literal("readPilotSupportRequests"),
  id: z.uuid().optional(),
  status: z.enum(pilotFeedbackStatuses).optional(),
  after: cursor.optional(),
}).refine(({ id, status, after }) => !id || (!status && !after));
export type PilotSupportRequest = Pick<PilotFeedback, "id" | "step" | "message" | "createdAt" | "priority" | "status"> & {
  ownerName: string | null;
  needsOwner: boolean;
  updatedAt: string;
  requesterUpdate: string;
  triage?: Pick<PilotFeedback, "author" | "owner" | "retest" | "revision">;
};
export type PilotSupportRequestPage = { kind: "pilotSupportRequests"; items: PilotSupportRequest[]; next: z.infer<typeof cursor> | null };

import { z } from "zod";
import type { PilotFeedback } from "./brokerage-model";

const id = z.uuid();
export const pilotSupportAccessHours = [1, 4, 24] as const;
export const pilotSupportAccessInput = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("manage"), requestId: id }),
  z.strictObject({ type: z.literal("mine") }),
  z.strictObject({ type: z.literal("approve"), requestId: id, grantId: id, reviewer: z.email().max(254),
    reviewerRevision: z.number().int().nonnegative(), hours: z.literal(pilotSupportAccessHours) }),
  z.strictObject({ type: z.literal("revoke"), requestId: id, grantId: id }),
  z.strictObject({ type: z.literal("open"), grantId: id, openId: id }),
]);
export type PilotSupportAccessInput = z.infer<typeof pilotSupportAccessInput>;
export type PilotSupportGrantStatus = "Active" | "Expired" | "Revoked" | "Staff access changed";
export type PilotSupportGrant = {
  id: string;
  reviewer: string;
  approver: string;
  approvedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  status: PilotSupportGrantStatus;
  openCount: number;
  lastOpenedAt: string | null;
};
export type PilotSupportGrantOffer = { id: string; step: PilotFeedback["step"]; expiresAt: string };
export type PilotSupportSharedSummary = Pick<PilotFeedback, "step" | "status" | "priority" | "createdAt"> & {
  updatedAt: string;
  expiresAt: string;
  openedAt: string;
  receiptId: string;
};
export type PilotSupportAccessResult =
  | { kind: "manage"; grants: PilotSupportGrant[] }
  | { kind: "mine"; offers: PilotSupportGrantOffer[] }
  | { kind: "summary"; summary: PilotSupportSharedSummary }
  | { kind: "saved"; message: string }
  | { error: string; status: 403 | 404 | 409 };

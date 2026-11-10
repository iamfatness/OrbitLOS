import { z } from "zod";
import type { ServiceOrder } from "./service-order-model";

export const closingServiceEvidenceLimit = 8;
const id = z.string().min(1).max(100);
export const closingServiceEvidenceInput = z.strictObject({
  type: z.literal("setClosingServiceEvidence"), loanId: id, itemId: id,
  itemRevision: z.number().int().positive(), orderId: z.uuid(), reference: id, linked: z.boolean(),
});
export type ClosingServiceEvidence = {
  itemId: string; orderId: string; kind: ServiceOrder["kind"]; reference: string; recipient?: ServiceOrder["recipient"];
  returnedAt: string; acceptedAt: string; acceptedBy: string; linkedAt: string; linkedBy: string;
};

import { z } from "zod";

const note = z.string().trim().max(1000);
const scope = { entityId: z.uuid(), jurisdiction: z.string().length(2) };
export const stateScopeFacts = z.strictObject({
  activity: z.enum(["Brokerage", "Brokerage and lending", "Brokerage and servicing", "Multiple or unresolved"]),
  lienScope: z.enum(["First lien", "Secondary lien", "First and secondary liens", "Unresolved"]),
  companyEvidence: note, officeEvidence: note, originatorEvidence: note,
  products: note, responsibility: note, reportingBasis: note,
  counselPacketReference: note,
});
export const stateScopeRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read"), ...scope, revision: z.number().int().positive().optional() }),
  z.strictObject({ operation: z.literal("save"), ...scope, requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(), facts: stateScopeFacts }),
]);
export type StateScopeFacts = z.infer<typeof stateScopeFacts>;
export type StateScopeRequest = z.infer<typeof stateScopeRequest>;

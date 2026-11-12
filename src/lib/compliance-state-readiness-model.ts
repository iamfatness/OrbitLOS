import { z } from "zod";

const note = z.string().trim().max(1000);
export const stateCounselDecisions = ["Pending counsel", "Counsel advised applicable", "Counsel advised out of scope"] as const;
export const stateControlStatuses = ["Open", "Control tested internally", "Procedure rehearsed internally"] as const;
export const stateReadinessFacts = z.strictObject({
  counsel: z.enum(stateCounselDecisions),
  counselEvidence: note,
  control: z.enum(stateControlStatuses),
  controlEvidence: note,
  nextAction: note,
}).superRefine((facts, ctx) => {
  if (facts.counsel !== "Pending counsel" && !facts.counselEvidence)
    ctx.addIssue({ code: "custom", path: ["counselEvidence"], message: "Enter the counsel decision reference." });
  if (facts.control !== "Open" && !facts.controlEvidence)
    ctx.addIssue({ code: "custom", path: ["controlEvidence"], message: "Enter the test or rehearsal evidence reference." });
});
const scope = { entityId: z.uuid(), jurisdiction: z.string().regex(/^[A-Z]{2}$/), scopeRevision: z.number().int().positive() };
const sourceKey = z.string().regex(/^REQ-[A-Z]{2}-[A-Z]+-[A-Z0-9]+(?:-[A-Z0-9]+)*$/).max(30);
export const stateReadinessRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read"), ...scope, sourceKey: sourceKey.optional() }),
  z.strictObject({ operation: z.literal("save"), ...scope, sourceKey, requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(), facts: stateReadinessFacts }),
]);
export type StateReadinessFacts = z.infer<typeof stateReadinessFacts>;
export type StateReadinessRequest = z.infer<typeof stateReadinessRequest>;

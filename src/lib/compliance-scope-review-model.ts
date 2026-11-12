import { z } from "zod";

const scope = { entityId: z.uuid(), jurisdiction: z.string().regex(/^[A-Z]{2}$/), scopeRevision: z.int().positive() };
export const scopeReviewRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read"), ...scope, offset: z.int().nonnegative().optional() }),
  z.strictObject({ operation: z.literal("assign"), ...scope, requestId: z.uuid(), sourceKey: z.string().min(1).max(48).optional(),
    reviewerEmail: z.email().toLowerCase(), reviewerRevision: z.int().nonnegative(),
    internalTarget: z.iso.date().refine(date => /^20/.test(date)), question: z.string().trim().min(5).max(1000) }),
]);
export type ScopeReviewRequest = z.infer<typeof scopeReviewRequest>;

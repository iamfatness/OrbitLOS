import { z } from "zod";

const date = z.iso.date().refine(on => on >= "1900-01-01" && on <= "2199-12-31");
const reference = z.string().trim().min(4).max(240);
const event = z.strictObject({ on: date, reference });
const common = {
  fileNumber: z.string().trim().min(1).max(100),
  on: date,
  original: reference,
  location: reference.optional(),
  retrieval: event.optional(),
  retentionBasis: event.optional(),
};
export const newYorkExamRecordFacts = z.discriminatedUnion("category", [
  z.strictObject({ ...common, category: z.literal("Written consumer complaint"),
    status: z.enum(["Open", "Resolved"]), actions: z.array(event).max(50),
    related: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("Unreviewed") }),
      z.strictObject({ status: z.literal("None"), reference }),
      z.strictObject({ status: z.literal("On file"), reference }),
    ]),
  }),
  z.strictObject({ ...common, category: z.literal("DFS correspondence"), direction: z.enum(["To DFS", "From DFS"]) }),
]).superRefine((facts, ctx) => {
  const later = [facts.retrieval, facts.retentionBasis, ...(facts.category === "Written consumer complaint" ? facts.actions : [])];
  if (later.some(event => event && event.on < facts.on))
    ctx.addIssue({ code: "custom", message: "File events cannot precede the original complaint or correspondence." });
});
export type NewYorkExamRecordFacts = z.infer<typeof newYorkExamRecordFacts>;

export const newYorkExamRecordsRequest = z.strictObject({
  type: z.literal("newYorkExamRecords"), entityId: z.uuid(),
  input: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("list"), category: z.enum(["Written consumer complaint", "DFS correspondence"]),
      search: z.string().trim().max(100), offset: z.int().min(0).max(10000) }),
    z.strictObject({ operation: z.literal("history"), recordId: z.uuid(), before: z.int().positive().optional() }),
    z.strictObject({ operation: z.literal("save"), recordId: z.uuid(), requestId: z.uuid(), expected: z.int().nonnegative(),
      facts: newYorkExamRecordFacts, correction: reference.optional() }),
    z.strictObject({ operation: z.literal("export"), category: z.enum(["Written consumer complaint", "DFS correspondence"]), from: date, through: date }),
  ]),
});
export type NewYorkExamRecordsRequest = z.infer<typeof newYorkExamRecordsRequest>;

export function reviewNewYorkExamRecord(facts: NewYorkExamRecordFacts) {
  const gaps: string[] = [];
  if (!facts.location || !facts.retrieval) gaps.push("Document the archive location and retrieval check.");
  if (facts.category === "Written consumer complaint") {
    if (!facts.actions.length) gaps.push("Document actions taken on the complaint.");
    if (facts.related.status === "Unreviewed") gaps.push("Reconcile the related correspondence.");
    if (facts.status === "Open") gaps.push("The complaint remains open.");
  }
  const on = facts.retentionBasis?.on;
  let reviewOn: string | null = null;
  if (!on) gaps.push("Document the reviewed retention start.");
  else if (facts.category === "Written consumer complaint" && facts.actions.some(action => action.on > on))
    gaps.push("Reconcile the reviewed retention start with later complaint actions.");
  else {
    const anniversary = date.safeParse(String(Number(on.slice(0, 4)) + 3) + on.slice(4));
    if (anniversary.success) reviewOn = anniversary.data;
    else gaps.push("Confirm the three-year anniversary.");
  }
  return { gaps, reviewOn };
}

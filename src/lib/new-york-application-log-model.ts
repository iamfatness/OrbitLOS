import { z } from "zod";

export const newYorkApplicationLogSource = "https://govt.westlaw.com/nycrr/Document/I4e77f867cd1711dda432a117e6e0f345?transitionType=Default";
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "2199-12-31");
const text = (max: number) => z.string().trim().min(1).max(max);
const reference = text(240).min(4);
const uuid = z.uuid();
const person = z.strictObject({ name: text(160), address: text(300) });
const party = person.extend({ description: text(160) });
const cents = z.int().positive().max(10_000_000_000);
const accounting = z.strictObject({ status: z.literal("Accounting record"), reference });

const preclosingFees = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("Unreviewed") }),
  z.strictObject({ status: z.literal("None"), reference }),
  accounting,
  z.strictObject({ status: z.literal("Recorded"), items: z.array(z.strictObject({
    amountCents: cents, paidOn: date, purpose: text(160),
    direction: z.enum(["Collected", "Distributed"]), counterparty: party,
  })).min(1).max(100) }),
]);
const brokerageFees = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("Unreviewed") }),
  z.strictObject({ status: z.literal("None"), reference }),
  accounting,
  z.strictObject({ status: z.literal("Recorded"), items: z.array(z.strictObject({
    amountCents: cents, source: text(160), sourceType: z.enum(["Applicant", "Lender", "Broker", "Other"]),
  })).min(1).max(100) }),
]);

export const newYorkApplicationFacts = z.strictObject({
  fileNumber: text(100), office: text(160), applicationOn: date,
  applicants: z.array(person).min(1).max(12), propertyAddress: text(300),
  source: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("Unreviewed") }),
    z.strictObject({ status: z.literal("Direct"), description: text(160) }),
    z.strictObject({ status: z.literal("Referral"), referrer: party }),
    accounting,
  ]),
  disposition: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("Pending") }),
    z.strictObject({ status: z.literal("Final"), outcome: z.enum(["Closed", "Denied", "Withdrawn", "Other"]),
      on: date, reference }),
  ]),
  placement: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("Unreviewed") }),
    z.strictObject({ status: z.literal("Placed"), entity: text(160) }),
    z.strictObject({ status: z.literal("Not placed"), reference }),
    accounting,
  ]),
  preclosingFees, brokerageFees,
  earlierLog: z.strictObject({ on: date, reference }).optional(),
}).superRefine((facts, ctx) => {
  if (facts.earlierLog && facts.earlierLog.on < facts.applicationOn)
    ctx.addIssue({ code: "custom", path: ["earlierLog"], message: "The earlier log entry cannot precede application receipt." });
  if (facts.disposition.status === "Final" && facts.disposition.on < facts.applicationOn)
    ctx.addIssue({ code: "custom", path: ["disposition"], message: "The disposition cannot precede application receipt." });
  if (facts.disposition.status === "Final" && facts.disposition.outcome === "Closed" && facts.placement.status === "Not placed")
    ctx.addIssue({ code: "custom", path: ["placement"], message: "Identify where the closed loan was placed or reference the accounting record." });
});
export type NewYorkApplicationFacts = z.infer<typeof newYorkApplicationFacts>;

export function reviewNewYorkApplication(facts: NewYorkApplicationFacts, firstSavedOn: string) {
  const gaps: string[] = [];
  if (facts.source.status === "Unreviewed") gaps.push("Application source");
  if (facts.placement.status === "Unreviewed") gaps.push("Placement or basis");
  if (facts.preclosingFees.status === "Unreviewed") gaps.push("Preclosing fee reconciliation");
  if (facts.brokerageFees.status === "Unreviewed") gaps.push("Brokerage compensation by source");
  const firstLoggedOn = facts.earlierLog?.on ?? firstSavedOn;
  const loggedAfterReceipt = firstLoggedOn > facts.applicationOn;
  if (loggedAfterReceipt) gaps.push("First documented log entry follows receipt date");
  if (firstLoggedOn < facts.applicationOn) gaps.push("Recorded application date follows the first Orbit save");
  return { gaps, firstLoggedOn, loggedAfterReceipt };
}

export const newYorkApplicationLogRequest = z.strictObject({
  type: z.literal("newYorkApplicationLog"), entityId: uuid,
  input: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("list"), from: date, through: date, search: z.string().trim().max(120), offset: z.int().min(0).max(10000) }),
    z.strictObject({ operation: z.literal("history"), entryId: uuid, before: z.int().positive().optional() }),
    z.strictObject({ operation: z.literal("save"), entryId: uuid, requestId: uuid, expected: z.int().nonnegative(),
      facts: newYorkApplicationFacts, correction: reference.optional() }),
    z.strictObject({ operation: z.literal("void"), entryId: uuid, requestId: uuid, expected: z.int().positive(), correction: reference }),
    z.strictObject({ operation: z.literal("export"), from: date, through: date }),
  ]),
});
export type NewYorkApplicationLogRequest = z.infer<typeof newYorkApplicationLogRequest>;

import { z } from "zod";
import { shiftReportDate } from "./report-date-range";

export const floridaJournalSources = {
  rule: "https://flrules.org/gateway/ruleNo.asp?id=69V-40.265",
  form: "https://flofr.gov/docs/default-source/documents/forms/ofr-494-10---mortgage-transaction-journal.pdf",
  records: "https://www.flsenate.gov/Laws/Statutes/2026/0494.0016",
  proposed: "https://flrules.org/gateway/view_notice.asp?id=31379420",
};
export const floridaJournalOutcomes = ["Pending", "Funded", "Denied", "Withdrawn", "Other"] as const;
const date = z.iso.date().refine(on => on >= "1900-01-01" && on <= "2199-12-31");
const text = (max: number) => z.string().trim().min(1).max(max);
const reference = text(240).min(4);
const uuid = z.uuid();

export const floridaJournalFacts = z.strictObject({
  authority: z.enum(["Mortgage broker", "Mortgage lender"]), zone: z.enum(["America/New_York", "America/Chicago"]),
  office: text(160), officeReference: reference, transactionNumber: text(100).optional(),
  applicants: z.array(text(160)).min(1).max(12), applicationOn: date,
  disposition: z.enum(floridaJournalOutcomes), dispositionReference: reference,
  lender: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("Unresolved") }),
    z.strictObject({ status: z.literal("Identified"), name: text(160) }),
    z.strictObject({ status: z.literal("Not applicable"), reference }),
  ]),
  enteredOn: date.optional(), initiation: z.strictObject({ on: date, reference }).optional(),
  calendar: z.strictObject({ dueOn: date, reference }).optional(),
}).superRefine((facts, ctx) => {
  if (facts.calendar && (!facts.enteredOn || facts.calendar.dueOn < shiftReportDate(facts.enteredOn, 7)))
    ctx.addIssue({ code: "custom", path: ["calendar"], message: "Record the transaction trigger and a seventh business day at least seven calendar days later." });
  if (facts.enteredOn && facts.initiation && facts.initiation.on < facts.enteredOn)
    ctx.addIssue({ code: "custom", path: ["initiation"], message: "The documented journal entry cannot precede the transaction trigger." });
});
export type FloridaJournalFacts = z.infer<typeof floridaJournalFacts>;

export function reviewFloridaJournal(facts: FloridaJournalFacts, savedOn: string) {
  const gaps: string[] = [];
  if (!facts.enteredOn) gaps.push("Date the transaction was entered into");
  if (!facts.calendar) gaps.push("Documented seventh business day and calendar");
  if (facts.lender.status === "Unresolved" || (facts.disposition === "Funded" && facts.lender.status !== "Identified"))
    gaps.push("Lender name or applicable basis");
  const firstOn = facts.initiation?.on ?? savedOn;
  const status = !facts.calendar || (facts.enteredOn && firstOn < facts.enteredOn) ? "Needs review" :
    firstOn > facts.calendar.dueOn ? "Late" : "On time";
  const anniversary = String(Number(firstOn.slice(0, 4)) + 3).padStart(4, "0") + firstOn.slice(4);
  const retainThrough = date.safeParse(anniversary).success ? anniversary : null;
  if (!retainThrough) gaps.push("Confirm the archive anniversary for a February 29 entry");
  return { gaps, firstOn, status, retainThrough, documentedExternalEntry: !!facts.initiation };
}

export const floridaJournalRequest = z.strictObject({
  type: z.literal("floridaJournal"), entityId: uuid,
  input: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("list"), from: date, through: date, search: z.string().trim().max(120), offset: z.int().min(0).max(10000) }),
    z.strictObject({ operation: z.literal("history"), entryId: uuid, before: z.int().positive().optional() }),
    z.strictObject({ operation: z.literal("save"), entryId: uuid, requestId: uuid, expected: z.int().nonnegative(),
      facts: floridaJournalFacts, correction: reference.optional() }),
    z.strictObject({ operation: z.literal("void"), entryId: uuid, requestId: uuid, expected: z.int().positive(), correction: reference }),
    z.strictObject({ operation: z.literal("export"), from: date, through: date }),
  ]),
});
export type FloridaJournalRequest = z.infer<typeof floridaJournalRequest>;

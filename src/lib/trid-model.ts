import { z } from "zod";
import { disclosureFeeSnapshot } from "./trid-fee-comparison";

export const tridElements = {
  name: "Applicant name", income: "Income", creditReportId: "SSN for obtaining a credit report",
  propertyAddress: "Property address", estimatedValue: "Estimated property value", loanAmount: "Mortgage amount sought",
} as const;
const elements = Object.keys(tridElements) as [keyof typeof tridElements, ...(keyof typeof tridElements)[]];
const date = z.iso.date().refine(value => value >= "2022-01-01" && value <= "2099-12-31", "Enter a date from 2022 through 2099.");
const reference = z.string().trim().min(1).max(180);
const document = z.enum(["Initial LE", "Revised LE", "Initial CD", "Corrected CD"]);
const artifact = { document, version: reference };
const dates = z.array(date).max(60);
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Enter a local time in hours and minutes.").optional();
const sequence = z.number().int().positive();
export const estimateRevisionReasons = [
  "Changed settlement charges", "Changed eligibility", "Borrower-requested change",
  "Rate lock", "Estimate expired", "Delayed construction settlement",
] as const;
export const tridEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("scope"), coveredScenario: z.literal(true), creditor: reference, leSender: z.enum(["Broker", "Creditor"]), reference,
    zone: z.enum(["America/Detroit", "America/Menominee"]), openWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    calendarFrom: date, calendarThrough: date, closures: dates, extraOpen: dates }),
  z.strictObject({ type: z.literal("element"), element: z.enum(elements), on: date, reference }),
  z.strictObject({ type: z.literal("sent"), ...artifact, on: date, method: z.enum(["In person", "Mail", "Electronic"]),
    sender: z.enum(["Broker", "Creditor", "Settlement agent"]), reference, consentReference: reference.optional() }),
  z.strictObject({ type: z.literal("received"), ...artifact, on: date, localTime, reference }),
  z.strictObject({ type: z.literal("intent"), receiptSequence: sequence, on: date, localTime, reference }),
  z.strictObject({ type: z.literal("fee"), intentSequence: sequence.optional(), on: date, localTime, reference,
    category: z.enum(["Credit report", "Other"]), activity: z.enum(["Fee imposed", "Payment method required"]), name: reference }),
  disclosureFeeSnapshot.safeExtend({ type: z.literal("feeSnapshot") }),
  z.strictObject({ type: z.literal("estimateRevision"), originalSequence: sequence, revisedSequence: sequence,
    on: date, reason: z.enum(estimateRevisionReasons), reference,
    chargeKeys: z.array(z.string().trim().min(1).max(80)).min(1).max(150).refine(keys => new Set(keys).size === keys.length, "Use each charge key once."),
    reviewReference: reference.optional() }),
  z.strictObject({ type: z.literal("closing"), on: date, reference }),
  z.strictObject({ type: z.literal("void"), sequence, reference }),
]);
const loanId = z.string().min(1).max(100);
export const tridRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read"), loanId,
    feeBasis: z.strictObject({ estimateSequence: sequence, closingSequence: sequence }).optional() }),
  z.strictObject({ operation: z.literal("record"), loanId, requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(), event: tridEvent }),
]);
export type TridEvent = z.infer<typeof tridEvent>;
export type TridRequest = z.infer<typeof tridRequest>;
export type TridEntry = { sequence: number; at: string; actor: string; event: TridEvent };

export function isLoanEstimateReceipt(event: TridEvent): event is Extract<TridEvent, { type: "received" }> {
  return event.type === "received" && (event.document === "Initial LE" || event.document === "Revised LE");
}

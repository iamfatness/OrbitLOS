import { z } from "zod";

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
export const tridEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("scope"), coveredScenario: z.literal(true), creditor: reference, leSender: z.enum(["Broker", "Creditor"]), reference,
    zone: z.enum(["America/Detroit", "America/Menominee"]), openWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    calendarFrom: date, calendarThrough: date, closures: dates, extraOpen: dates }),
  z.strictObject({ type: z.literal("element"), element: z.enum(elements), on: date, reference }),
  z.strictObject({ type: z.literal("sent"), ...artifact, on: date, method: z.enum(["In person", "Mail", "Electronic"]),
    sender: z.enum(["Broker", "Creditor", "Settlement agent"]), reference, consentReference: reference.optional() }),
  z.strictObject({ type: z.literal("received"), ...artifact, on: date, reference }),
  z.strictObject({ type: z.literal("closing"), on: date, reference }),
  z.strictObject({ type: z.literal("void"), sequence: z.number().int().positive(), reference }),
]);
const loanId = z.string().min(1).max(100);
export const tridRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read"), loanId }),
  z.strictObject({ operation: z.literal("record"), loanId, requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(), event: tridEvent }),
]);
export type TridEvent = z.infer<typeof tridEvent>;
export type TridRequest = z.infer<typeof tridRequest>;
export type TridEntry = { sequence: number; at: string; actor: string; event: TridEvent };

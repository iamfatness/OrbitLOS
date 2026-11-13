import { z } from "zod";
import { reportMonthDates } from "./report-date-range";
import { californiaDfpiSources } from "./california-dfpi-recordkeeping-model";

export const crmlaRegisterSource = californiaDfpiSources.crmla;
const date = z.iso.date().refine(on => on >= "1900-01-01" && on <= "2199-12-31");
const text = (max: number) => z.string().trim().min(1).max(max);
const reference = text(240).min(4);
const uuid = z.uuid();

export function crmlaRegisterFrom(through: string) {
  const month = String(Number(through.slice(0, 4)) - 3).padStart(4, "0") + through.slice(4, 7);
  const end = reportMonthDates(month).through;
  return month + "-" + (through.slice(8) > end.slice(8) ? end.slice(8) : through.slice(8));
}

export const crmlaRegisterFacts = z.strictObject({
  fileNumber: text(100), applicationOn: date, applicationReference: reference,
  applicants: z.array(text(160)).min(1).max(12),
  propertyAddress: text(300).optional(), amountCents: z.int().positive().max(100_000_000_000).optional(),
  terms: text(300).optional(), program: text(160).optional(), officer: text(160).optional(),
  outcome: z.discriminatedUnion("status", [
    z.strictObject({ status: z.enum(["Unreviewed", "Pending"]) }),
    z.strictObject({ status: z.literal("Ended without closing"), reference }),
    z.strictObject({ status: z.literal("Closed"), on: date, disposition: text(240).optional(),
      servicing: text(240).optional(), reference }),
  ]),
}).superRefine((facts, ctx) => {
  if (facts.outcome.status === "Closed" && facts.outcome.on < facts.applicationOn)
    ctx.addIssue({ code: "custom", path: ["outcome"], message: "The closing date cannot precede application receipt." });
});
export type CrmlaRegisterFacts = z.infer<typeof crmlaRegisterFacts>;

export function reviewCrmlaRegister(facts: CrmlaRegisterFacts) {
  const gaps: string[] = [];
  if (!facts.propertyAddress) gaps.push("Property address");
  if (facts.amountCents === undefined) gaps.push("Loan amount");
  if (!facts.terms) gaps.push("Loan terms");
  if (!facts.program) gaps.push("Loan program");
  if (!facts.officer) gaps.push("Loan officer");
  if (facts.outcome.status === "Unreviewed") gaps.push("Application outcome");
  if (facts.outcome.status === "Closed") {
    if (!facts.outcome.disposition) gaps.push("Disposition of the loan");
    if (!facts.outcome.servicing) gaps.push("Disposition of servicing");
  }
  return { gaps };
}

export const crmlaRegisterRequest = z.strictObject({
  type: z.literal("crmlaRegister"), entityId: uuid,
  input: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("list"), from: date, through: date, search: z.string().trim().max(120), offset: z.int().min(0).max(10000) }),
    z.strictObject({ operation: z.literal("history"), entryId: uuid, before: z.int().positive().optional() }),
    z.strictObject({ operation: z.literal("save"), entryId: uuid, requestId: uuid, expected: z.int().nonnegative(),
      facts: crmlaRegisterFacts, correction: reference.optional() }),
    z.strictObject({ operation: z.literal("void"), entryId: uuid, requestId: uuid, expected: z.int().positive(), correction: reference }),
    z.strictObject({ operation: z.literal("export"), through: date }),
  ]),
});
export type CrmlaRegisterRequest = z.infer<typeof crmlaRegisterRequest>;

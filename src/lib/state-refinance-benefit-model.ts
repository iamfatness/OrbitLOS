import { z } from "zod";

export const refinanceBenefitStates = ["MN", "NE"] as const;
export type RefinanceBenefitState = typeof refinanceBenefitStates[number];
export const refinanceBenefitAuthority = {
  MN: { label: "Minn. Stat. §58.13", url: "https://www.revisor.mn.gov/statutes/2026/cite/58.13" },
  NE: { label: "Neb. Rev. Stat. §45-737", url: "https://nebraskalegislature.gov/laws/statutes.php?statute=45-737" },
} as const;
export const nebraskaBenefitForm = "https://ndbf.nebraska.gov/sites/default/files/doc/Net%20Tangible%20Benefit%20Form%20(1).pdf";
const nebraskaEffective = "2026-07-18";
const reference = z.string().trim().min(1).max(180);
const date = z.iso.date().refine(value => value >= "2022-01-01" && value <= "2099-12-31");
const event = z.strictObject({ on: date, reference });
const scope = {
  applicability: z.enum(["Unresolved", "Covered for internal review"]),
  scopeReference: reference,
  comparisonReference: reference.optional(),
  outcome: z.enum(["Unresolved", "Benefit documented", "No benefit identified"]),
  rationale: z.string().trim().max(1000).optional(),
  closed: event.optional(),
};
export const refinanceBenefitFacts = z.discriminatedUnion("state", [
  z.strictObject({ ...scope, state: z.literal("MN"), applicationCircumstances: event.optional(), signed: event.optional() }),
  z.strictObject({ ...scope, state: z.literal("NE"), zone: z.enum(["America/Chicago", "America/Denver"]),
    worksheetVersion: reference.optional(), delivered: event.optional(), acknowledged: event.optional() }),
]);
export const refinanceBenefitRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read"), loanId: z.string().min(1).max(100), state: z.enum(refinanceBenefitStates) }),
  z.strictObject({ operation: z.literal("save"), loanId: z.string().min(1).max(100), expectedRevision: z.number().int().nonnegative(),
    requestId: z.uuid(), facts: refinanceBenefitFacts, correction: reference.optional() }),
]);
export type RefinanceBenefitFacts = z.infer<typeof refinanceBenefitFacts>;
export type RefinanceBenefitRequest = z.infer<typeof refinanceBenefitRequest>;

export function refinanceBenefitDates(facts: RefinanceBenefitFacts) {
  return facts.state === "MN" ? [facts.applicationCircumstances?.on, facts.signed?.on, facts.closed?.on] :
    [facts.delivered?.on, facts.acknowledged?.on, facts.closed?.on];
}

export function reviewRefinanceBenefit(facts: RefinanceBenefitFacts) {
  const gaps: string[] = [];
  if (facts.applicability === "Unresolved") gaps.push("Confirm the loan, activity and entity covered by the state requirement.");
  if (!facts.comparisonReference) gaps.push("Reference the existing and proposed terms and costs.");
  if (facts.outcome === "Unresolved" || !facts.rationale) gaps.push("Record the reviewed benefit outcome and rationale.");
  if (facts.state === "MN") {
    if (!facts.applicationCircumstances) gaps.push("Reference the written circumstances at application.");
    if (!facts.signed) gaps.push("Record the borrower's signed evidence.");
    if (facts.signed && facts.applicationCircumstances && facts.signed.on < facts.applicationCircumstances.on)
      gaps.push("Review why the recorded signature predates the application circumstances.");
    if (facts.signed && facts.closed && facts.signed.on >= facts.closed.on)
      gaps.push("The recorded signature date is on or after the closing date. Review the timing with counsel.");
    if (facts.outcome === "No benefit identified") gaps.push("Escalate the no-benefit outcome for the Minnesota churning review.");
  } else {
    if (!facts.worksheetVersion || !facts.delivered) gaps.push("Record the worksheet version and borrower delivery evidence.");
    if (!facts.acknowledged) gaps.push("Review the borrower's receipt acknowledgment evidence.");
    if (facts.acknowledged && facts.delivered && facts.acknowledged.on < facts.delivered.on)
      gaps.push("Review why the recorded acknowledgment predates delivery.");
    if (facts.closed && facts.closed.on < nebraskaEffective)
      gaps.push("The recorded closing predates July 18, 2026. Confirm the applicable rule version.");
    if (facts.closed && facts.delivered && facts.delivered.on >= facts.closed.on)
      gaps.push("Confirm the worksheet was provided before the refinance. The recorded dates do not establish that order.");
    if (facts.closed && facts.acknowledged && facts.acknowledged.on >= facts.closed.on)
      gaps.push("Review acknowledgment timing relative to the refinance.");
  }
  if (!facts.closed) gaps.push("Closing date is missing. The review remains open for timing evidence.");
  return gaps;
}

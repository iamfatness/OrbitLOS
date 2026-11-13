import { z } from "zod";

export const illinoisLoanLogLaw = "https://ilga.gov/commission/jcar/admincode/038/038010500J11750R.html";
export const sharedAppreciationRuleDate = "2026-06-01";
export const illinoisLogProducts = ["Unresolved", "Brokerage or origination", "Reverse mortgage", "Shared appreciation agreement"] as const;
export const illinoisLogOutcomes = ["Unresolved", "Pending", "Cancelled", "Rejected", "Closed"] as const;
export const illinoisLogStatuses = ["Draft", "Reviewed", "Withdrawn"] as const;
export const illinoisLogExceptions = { employment: "Employment", seller: "Seller", processors: "Processors", appraisers: "Appraisers" } as const;
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "2199-12-31");
const text = (max: number) => z.string().trim().min(1).max(max);
const reference = text(240).min(4);
const cents = z.int().min(0).max(100_000_000_000);
const percent = z.number().min(0).max(100);
const borrower = z.strictObject({ name: text(160), employer: text(160).optional(), employerAddress: text(320).optional(),
  age: z.int().min(0).max(130).optional() });
const originator = z.strictObject({ name: text(160), nmls: z.string().regex(/^\d{1,15}$/).optional() });
const appraiser = z.strictObject({ name: text(160), license: text(60).optional() });
const closing = z.strictObject({ on: date.optional(), owner: text(160).optional(), servicer: text(160).optional(),
  closer: text(160).optional(), closerEmployer: text(160).optional(), location: text(320).optional() });
const reverse = z.strictObject({
  lumpSumCents: cents.optional(), monthlyPaymentCents: cents.optional(), lineOfCreditCents: cents.optional(),
  appraisedCents: cents.min(1).optional(), loanToValue: z.number().min(0).max(1000).optional(),
  counseling: z.enum(["Unresolved", "Yes", "No"]), counselingAgency: text(160).optional(),
  hudApproved: z.enum(["Unresolved", "Yes", "No"]).optional(),
});
const shared = z.strictObject({
  startingValueCents: cents.min(1).optional(), startingValueMethod: text(240).optional(), sharePercent: percent.optional(),
  counselingOn: date.optional(), counselingProvider: text(160).optional(), transitionReference: reference.optional(),
});
export const illinoisLogFacts = z.strictObject({
  product: z.enum(illinoisLogProducts), applicationDate: date.optional(), fileNumber: text(100).optional(),
  borrowers: z.array(borrower).max(12), originators: z.array(originator).max(12),
  processors: z.array(text(160)).max(12), appraisers: z.array(appraiser).max(12),
  propertyAddress: text(320).optional(), purpose: z.enum(["Purchase", "Refinance", "Other"]).optional(),
  sellers: z.array(text(160)).max(12), amountCents: cents.min(1).optional(),
  aprPercent: z.number().min(0).max(1000).optional(), loanProgram: text(160).optional(),
  highRisk: z.enum(["Unresolved", "Standard", "High risk"]).optional(), classificationReference: reference.optional(),
  outcome: z.enum(illinoisLogOutcomes), closing: closing.optional(), reverse: reverse.optional(), shared: shared.optional(),
  exceptions: z.strictObject({ employment: reference.optional(), seller: reference.optional(),
    processors: reference.optional(), appraisers: reference.optional() }),
}).superRefine((facts, ctx) => {
  const issue = (path: string[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (facts.closing && facts.outcome !== "Closed") issue(["closing"], "Closing details require a closed outcome.");
  if (facts.applicationDate && facts.closing?.on && facts.closing.on < facts.applicationDate)
    issue(["closing", "on"], "The closing date cannot precede the application.");
  if (facts.purpose === "Refinance" && facts.sellers.length) issue(["sellers"], "For a refinance, leave seller names empty.");
  if (facts.product !== "Reverse mortgage" && facts.reverse) issue(["reverse"], "Reverse mortgage fields require the reverse mortgage product.");
  if (facts.product !== "Shared appreciation agreement" && facts.shared)
    issue(["shared"], "Shared appreciation fields require the shared appreciation product.");
  if (facts.product !== "Brokerage or origination" && facts.highRisk && facts.highRisk !== "Unresolved")
    issue(["highRisk"], "Use the high-risk classification with a brokerage or origination entry.");
});
export type IllinoisLogFacts = z.infer<typeof illinoisLogFacts>;
export type IllinoisLogStatus = typeof illinoisLogStatuses[number];
export type IllinoisLogProduct = typeof illinoisLogProducts[number];

export function illinoisLogGaps(facts: IllinoisLogFacts) {
  const { product, borrowers, originators, processors, appraisers, exceptions, reverse, shared, closing } = facts;
  const gaps: string[] = [];
  if (!facts.applicationDate) gaps.push("Application date");
  if (!borrowers.length) gaps.push("Borrower names");
  if (!facts.propertyAddress) gaps.push("Property address");
  if (!originators.length || originators.some(person => !person.nmls)) gaps.push("Originator names and NMLS identifiers");
  if (!processors.length && !exceptions.processors) gaps.push("Processor names or supporting explanation");
  if ((!appraisers.length && !exceptions.appraisers) ||
    (product !== "Reverse mortgage" && appraisers.some(person => !person.license)))
    gaps.push(product === "Reverse mortgage" ? "Appraiser names or supporting explanation" : "Appraiser names and license numbers or supporting explanation");
  if (product === "Unresolved") return [...gaps, "Loan log product"];
  if (!facts.classificationReference) gaps.push("Product classification reference");
  if (product === "Reverse mortgage") {
    if (borrowers.some(person => person.age === undefined)) gaps.push("Borrower ages");
    if (!facts.loanProgram || facts.aprPercent === undefined) gaps.push("APR and loan program");
    if (reverse?.lumpSumCents === undefined && reverse?.monthlyPaymentCents === undefined && reverse?.lineOfCreditCents === undefined)
      gaps.push("Reverse mortgage payment arrangement");
    if (reverse?.appraisedCents === undefined || reverse.loanToValue === undefined) gaps.push("Appraised value and loan-to-value ratio");
    if (!reverse || reverse.counseling === "Unresolved" ||
      (reverse.counseling === "Yes" && (!reverse.counselingAgency || !reverse.hudApproved || reverse.hudApproved === "Unresolved")))
      gaps.push("Counseling status and, when provided, agency and HUD approval");
    return gaps;
  }
  if (!facts.purpose || (facts.purpose !== "Refinance" && !facts.sellers.length && !(facts.purpose === "Other" && exceptions.seller)))
    gaps.push("Property seller or documented applicability");
  if (facts.amountCents === undefined) gaps.push("Loan amount");
  if (facts.outcome === "Unresolved") gaps.push("Application status");
  if (facts.outcome === "Closed" && (!closing?.on || !closing.owner || !closing.servicer ||
    !closing.closer || !closing.closerEmployer || !closing.location)) gaps.push("Closing date, owner, servicer, closer and location");
  if (product === "Shared appreciation agreement") {
    if (facts.applicationDate && facts.applicationDate < sharedAppreciationRuleDate && !shared?.transitionReference)
      gaps.push("Counsel review of the shared appreciation rule transition");
    if (shared?.startingValueCents === undefined || !shared.startingValueMethod || shared.sharePercent === undefined)
      gaps.push("Starting value, calculation method and share percentage");
    if (!shared?.counselingOn || !shared.counselingProvider) gaps.push("Counseling date and provider");
  } else {
    if (!exceptions.employment && borrowers.some(person => !person.employer || !person.employerAddress))
      gaps.push("Borrower employers and addresses or supporting explanation");
    if (!facts.loanProgram || facts.aprPercent === undefined) gaps.push("APR and loan program");
    if (!facts.highRisk || facts.highRisk === "Unresolved") gaps.push("High-risk classification");
  }
  return gaps;
}

const paging = { search: z.string().trim().max(160), offset: z.int().min(0).max(100000) };
const range = { from: date, through: date };
export const illinoisLoanLogRequest = z.strictObject({
  type: z.literal("illinoisLoanLog"), entityId: z.uuid(),
  input: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("candidates"), ...paging }),
    z.strictObject({ operation: z.literal("list"), ...paging, ...range,
      product: z.enum(["All", ...illinoisLogProducts]), status: z.enum(["All", ...illinoisLogStatuses]) }),
    z.strictObject({ operation: z.literal("history"), entryId: z.uuid(), before: z.int().positive().optional() }),
    z.strictObject({ operation: z.literal("save"), entryId: z.uuid(), requestId: z.uuid(), expected: z.int().nonnegative(),
      loanId: text(200).nullable(), status: z.enum(illinoisLogStatuses), facts: illinoisLogFacts,
      evidence: reference, correction: reference.optional() }),
    z.strictObject({ operation: z.literal("export"), ...range }),
  ]),
});
export type IllinoisLoanLogRequest = z.infer<typeof illinoisLoanLogRequest>;

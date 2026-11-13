import { z } from "zod";

const reference = z.string().trim().min(1).max(180);
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "2199-12-31");
const response = z.enum(["Unknown", "Yes", "No"]);
const assessment = z.strictObject({
  reference,
  result: z.enum(["Unresolved", "No concern recorded", "Concern recorded"]),
});
const service = z.strictObject({
  key: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/),
  reference,
  feeCharged: response,
  provided: response,
  thirdPartyAmount: z.enum(["Unknown", "No third party", "Reconciled", "Discrepancy"]),
});
const term = z.strictObject({
  reference,
  startsOn: date,
  maturesOn: date,
  regularPaymentsAmortize: response,
  bridgeForPrincipalDwelling: response,
}).refine(value => value.startsOn < value.maturesOn, {
  path: ["maturesOn"], message: "Maturity must follow the recorded term start.",
});

export const michiganLoanPracticesFacts = z.strictObject({
  state: z.literal("MI"),
  zone: z.enum(["America/Detroit", "America/Menominee"]),
  reviewedOn: date,
  scopeReference: reference,
  scope: z.enum(["Unresolved", "In scope for pilot review", "Outside scope for pilot review"]),
  services: z.array(service).max(40).refine(rows => new Set(rows.map(row => row.key.toLowerCase())).size === rows.length,
    "Use a different key for each reviewed charge."),
  serviceInventory: z.enum(["Unresolved", "No charges identified", "Listed charges reviewed"]),
  serviceInventoryReference: reference.optional(),
  representations: assessment.optional(),
  applicationChanges: assessment.optional(),
  signedNote: assessment.optional(),
  appraisalPayment: assessment.optional(),
  appraisalInfluence: assessment.optional(),
  premium: z.strictObject({ reference, financedSinglePremiumCreditCoverage: response }).optional(),
  term: term.optional(),
}).refine(facts => facts.serviceInventory !== "No charges identified" || facts.services.length === 0, {
  path: ["serviceInventory"], message: "Reconcile the service inventory with the listed charges.",
});

const loanId = z.string().min(1).max(100);
export const michiganLoanPracticesRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read"), state: z.literal("MI"), loanId }),
  z.strictObject({ operation: z.literal("save"), loanId, expectedRevision: z.number().int().nonnegative(),
    requestId: z.uuid(), facts: michiganLoanPracticesFacts, correction: reference.optional() }),
]);
export type MichiganLoanPracticesFacts = z.infer<typeof michiganLoanPracticesFacts>;
export type MichiganLoanPracticesRequest = z.infer<typeof michiganLoanPracticesRequest>;

type Finding = { status: "Evidence gap" | "Review concern"; message: string };
type Review = { requirement: string; findings: Finding[] };
const evidenceGap = (message: string): Finding => ({ status: "Evidence gap", message });
const concern = (message: string): Finding => ({ status: "Review concern", message });

function checkAssessments(items: ReadonlyArray<readonly [string, z.infer<typeof assessment> | undefined]>) {
  const findings: Finding[] = [];
  for (const [label, item] of items) {
    if (!item || item.result === "Unresolved") findings.push(evidenceGap(`Review ${label} and record the evidence reference.`));
    if (item?.result === "Concern recorded") findings.push(concern(`A concern was recorded for ${label}.`));
  }
  return findings;
}

function reviewServices(facts: MichiganLoanPracticesFacts) {
  const findings: Finding[] = [];
  if (facts.serviceInventory === "Unresolved" || !facts.serviceInventoryReference ||
    (facts.serviceInventory === "Listed charges reviewed" && facts.services.length === 0)) {
    findings.push(evidenceGap("Reconcile the charge inventory with the loan file."));
  }
  for (const item of facts.services) {
    if (item.feeCharged === "Unknown" || (item.feeCharged === "Yes" && item.provided === "Unknown"))
      findings.push(evidenceGap(`${item.key}: establish whether the charge was assessed and the service was provided.`));
    if (item.feeCharged === "Yes" && item.provided === "No")
      findings.push(concern(`${item.key}: the recorded fee is for a service or product that was not provided.`));
    if (item.thirdPartyAmount === "Unknown") findings.push(evidenceGap(`${item.key}: reconcile any third-party amount.`));
    if (item.thirdPartyAmount === "Discrepancy") findings.push(concern(`${item.key}: a third-party amount discrepancy was recorded.`));
  }
  return findings;
}

function beforeAnniversary(startsOn: string, maturesOn: string, years: number) {
  const year = Number(startsOn.slice(0, 4)) + years;
  const anniversary = `${year}${startsOn.slice(4)}`;
  const february29 = startsOn.endsWith("-02-29");
  const boundaryYearIsLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (february29 && !boundaryYearIsLeap && maturesOn === `${year}-02-28`) return null;
  return maturesOn < anniversary;
}

function reviewTerm(value: MichiganLoanPracticesFacts["term"]): Finding[] {
  if (!value) return [evidenceGap("Record the term start, maturity and supporting note or schedule.")];
  if (value.regularPaymentsAmortize === "Yes") return [];
  const underFive = beforeAnniversary(value.startsOn, value.maturesOn, 5);
  if (underFive === null) return [evidenceGap("Confirm the five-year boundary for the February 29 term start.")];
  if (!underFive) return [];
  const underOne = beforeAnniversary(value.startsOn, value.maturesOn, 1);
  if (underOne === null && value.bridgeForPrincipalDwelling !== "No")
    return [evidenceGap("Confirm the one-year bridge boundary for the February 29 term start.")];
  if (underOne && value.bridgeForPrincipalDwelling === "Yes") return [];
  const findings: Finding[] = [];
  if (value.regularPaymentsAmortize === "Unknown")
    findings.push(evidenceGap("Review whether regular periodic payments fully amortize the principal."));
  if (underOne && value.bridgeForPrincipalDwelling === "Unknown")
    findings.push(evidenceGap("Review whether the loan bridges acquisition or construction of the intended principal dwelling."));
  if (value.regularPaymentsAmortize === "No" && (!underOne || value.bridgeForPrincipalDwelling === "No"))
    findings.push(concern("The recorded term is under five years with principal remaining after the regular payments and no indicated bridge exception."));
  return findings;
}

export function reviewMichiganLoanPractices(facts: MichiganLoanPracticesFacts) {
  const premium = facts.premium?.financedSinglePremiumCreditCoverage;
  const reviews: Review[] = [
    { requirement: "REQ-MI-LOAN-CMPA-SERVICE", findings: reviewServices(facts) },
    { requirement: "REQ-MI-LOAN-CMPA-INTEGRITY", findings: checkAssessments([
      ["qualification and valuation representations", facts.representations],
      ["changes to application information", facts.applicationChanges],
      ["terms present at note signing", facts.signedNote],
    ]) },
    { requirement: "REQ-MI-LOAN-CMPA-APPRAISAL", findings: checkAssessments([
      ["appraisal payment conditions", facts.appraisalPayment],
      ["appraisal independence", facts.appraisalInfluence],
    ]) },
    { requirement: "REQ-MI-LOAN-CMPA-PREMIUM", findings: premium === "No" ? [] : premium === "Yes"
      ? [concern("Financed single-premium credit life, disability or unemployment coverage was recorded.")]
      : [evidenceGap("Review whether the loan finances single-premium credit life, disability or unemployment coverage.")] },
    { requirement: "REQ-MI-LOAN-CMPA-TERM", findings: reviewTerm(facts.term) },
  ];
  return { scope: facts.scope, scopeReference: facts.scopeReference, reviews };
}

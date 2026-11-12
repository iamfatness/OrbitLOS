import { z } from "zod";

export const advertisingStates = ["MI"] as const;
export const advertisingChannels = ["Website", "Social media", "Email", "Text message", "Print", "Audio or video", "Script", "Other"] as const;
const reference = z.string().trim().min(4).max(300);
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "9990-12-31");
const choice = z.enum(["Yes", "No", "Unresolved"]);
const nmlsId = z.string().trim().regex(/^\d{1,15}$/);
const assessment = z.strictObject({ result: z.enum(["Supported", "Concern"]), reference });
const federalAssessment = assessment.extend({ result: z.enum(["Supported", "Concern", "Outside scope"]) });
const creative = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("Text"), copy: z.string().max(16000).refine(value => !!value.trim()) }),
  z.strictObject({ kind: z.literal("Archived artifact"), reference, sha256: z.string().regex(/^[a-f0-9]{64}$/i).transform(value => value.toLowerCase()) }),
]);
export const advertisingFacts = z.strictObject({
  title: z.string().trim().min(3).max(140),
  channel: z.enum(advertisingChannels),
  audience: reference,
  creative,
  reviewedOn: date,
  zone: z.enum(["America/Detroit", "America/Menominee"]),
  scopeReference: reference,
  mortgageScope: z.enum(["First mortgage", "Secondary mortgage", "First and secondary", "Unresolved"]),
  creditType: z.enum(["Closed-end", "Open-end", "Unresolved"]),
  specificTerms: choice,
  originatorAdvertising: choice,
  originators: z.array(z.strictObject({
    name: z.string().trim().min(2).max(100),
    expected: nmlsId.optional(),
    displayed: nmlsId.optional(),
    visibility: z.enum(["Clear", "Unclear", "Unresolved"]),
    reference: reference.optional(),
  })).max(20),
  sponsoringCompanyDisplayed: nmlsId.optional(),
  stateClaims: assessment.optional(),
  stateTerms: assessment.optional(),
  regulationZ: federalAssessment.optional(),
  regulationN: federalAssessment.optional(),
  archive: z.strictObject({
    applies: choice,
    scopeReference: reference.optional(),
    materials: reference.optional(),
    availableProducts: reference.optional(),
    additionalProducts: reference.optional(),
  }),
  distribution: z.strictObject({ firstOn: date, finalOn: date.optional(), reference,
    sameDayOrder: z.enum(["Before review", "After review"]).optional() }).optional(),
}).superRefine((facts, ctx) => {
  if (facts.distribution?.finalOn && facts.distribution.finalOn < facts.distribution.firstOn) {
    ctx.addIssue({ code: "custom", path: ["distribution", "finalOn"], message: "Last use must be on or after first use." });
  }
  if (facts.distribution?.sameDayOrder && facts.distribution.firstOn !== facts.reviewedOn) {
    ctx.addIssue({ code: "custom", path: ["distribution", "sameDayOrder"], message: "Record same-day order when review and first use share a date." });
  }
  const expected = facts.originators.flatMap(item => item.expected ? [item.expected] : []);
  if (new Set(expected).size !== expected.length) {
    ctx.addIssue({ code: "custom", path: ["originators"], message: "Record each verified originator identifier once." });
  }
});
export type AdvertisingFacts = z.infer<typeof advertisingFacts>;

const scope = { entityId: z.uuid(), jurisdiction: z.enum(advertisingStates) };
const revision = z.number().int().positive();
export const advertisingReviewRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("list"), ...scope, offset: z.number().int().min(0).max(10000) }),
  z.strictObject({ operation: z.literal("read"), ...scope, adId: z.uuid(), revision: revision.optional(),
    before: revision.optional() }),
  z.strictObject({ operation: z.literal("save"), ...scope, adId: z.uuid(), requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(), correction: reference.optional(), facts: advertisingFacts }),
]);
export type AdvertisingReviewRequest = z.infer<typeof advertisingReviewRequest>;

const authority = {
  first: { label: "MCL 445.1672a", url: "https://legislature.mi.gov/Laws/MCL?objectName=MCL-445-1672A" },
  secondary: { label: "MCL 493.76", url: "https://legislature.mi.gov/Laws/MCL?objectName=mcl-493-76" },
  originatorClaims: { label: "MCL 493.165(c)", url: "https://legislature.mi.gov/Laws/MCL?objectName=mcl-493-165" },
  originatorId: { label: "MCL 493.171", url: "https://www.legislature.mi.gov/Laws/MCL?objectName=MCL-493-171" },
  sponsoringCompany: { label: "Michigan DIFS advertising FAQ", url: "https://www.michigan.gov/difs/news-and-outreach/faq/consumer-finance/mortgage-loan-originator" },
  closedEnd: { label: "Regulation Z §1026.24", url: "https://www.consumerfinance.gov/rules-policy/regulations/1026/24/" },
  openEnd: { label: "Regulation Z §1026.16", url: "https://www.consumerfinance.gov/rules-policy/regulations/1026/16/" },
  mapClaims: { label: "Regulation N §1014.3", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1014/section-1014.3" },
  mapArchive: { label: "Regulation N §1014.5", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1014/section-1014.5" },
};
export const advertisingRuleRevision = "2026-11-12.1";
export type AdvertisingFinding = {
  code: string;
  status: "Evidence gap" | "Review concern" | "Advisory";
  message: string;
  sources: { label: string; url: string }[];
};

export function evaluateMichiganAdvertising(facts: AdvertisingFacts, sponsorId: string) {
  const findings: AdvertisingFinding[] = [];
  const sources = Object.values(authority);
  const add = (code: string, status: AdvertisingFinding["status"], message: string,
    ...rules: AdvertisingFinding["sources"]) => findings.push({ code, status, message, sources: rules });
  function assess(code: string, subject: string, result: { result: string } | undefined,
    rules: AdvertisingFinding["sources"]) {
    if (!result) add(code, "Evidence gap", `Record the review and supporting evidence for ${subject}.`, ...rules);
    else if (result.result === "Concern") add(code, "Review concern", `A concern was recorded for ${subject}.`, ...rules);
  }

  const stateRules = facts.mortgageScope === "First mortgage" ? [authority.first] :
    facts.mortgageScope === "Secondary mortgage" ? [authority.secondary] : [authority.first, authority.secondary];
  if (facts.mortgageScope === "Unresolved") add("mortgage-scope", "Evidence gap", "Confirm first or secondary mortgage scope.", ...stateRules);
  assess("state-claims", "the claims and overall impression of the advertisement", facts.stateClaims,
    facts.originatorAdvertising === "Yes" ? [...stateRules, authority.originatorClaims] : stateRules);
  if (facts.specificTerms === "Unresolved") add("state-terms-scope", "Evidence gap", "Confirm whether the advertisement includes specific lending terms.", ...stateRules);
  if (facts.specificTerms === "Yes") assess("state-terms", "the ability and intent to offer the advertised terms to qualifying applicants",
    facts.stateTerms, stateRules);

  if (facts.originatorAdvertising === "Unresolved") add("originator-scope", "Evidence gap", "Confirm whether individual originator advertising is in scope.", authority.originatorId);
  if (facts.originatorAdvertising === "No" && facts.originators.length) {
    add("originator-conflict", "Evidence gap", "Reconcile the originator scope with the recorded originators.", authority.originatorId);
  }
  if (facts.originatorAdvertising === "Yes") {
    if (!facts.originators.length) add("originator-list", "Evidence gap", "Record the originators and their identifiers.", authority.originatorId);
    for (const [index, item] of facts.originators.entries()) {
      if (!item.expected || !item.reference || item.visibility === "Unresolved")
        add(`originator-proof-${index}`, "Evidence gap", `${item.name} needs identifier or visibility evidence.`, authority.originatorId);
      if (!item.displayed || (item.expected && item.displayed !== item.expected) || item.visibility === "Unclear")
        add(`originator-display-${index}`, "Review concern", `${item.name} has a missing, mismatched or unclear displayed identifier.`, authority.originatorId);
    }
    if (!sponsorId || facts.sponsoringCompanyDisplayed !== sponsorId)
      add("sponsor-id", "Advisory", "Review the sponsoring company identifier against DIFS guidance.", authority.sponsoringCompany);
  }
  if (facts.creditType === "Unresolved") add("credit-type", "Evidence gap", "Identify the credit type for the Regulation Z review.", authority.closedEnd, authority.openEnd);
  else assess("regulation-z", "available terms, triggered disclosures and prohibited representations under Regulation Z", facts.regulationZ,
    [facts.creditType === "Closed-end" ? authority.closedEnd : authority.openEnd]);
  assess("regulation-n", "material representations under Regulation N", facts.regulationN, [authority.mapClaims]);

  if (facts.archive.applies === "Unresolved" || !facts.archive.scopeReference)
    add("archive-scope", "Evidence gap", "Document which advertising recordkeeping requirements apply.", authority.mapArchive);
  let federalArchiveReviewDate: string | null = null;
  if (facts.archive.applies === "Yes") {
    if (facts.regulationN?.result === "Outside scope")
      add("archive-conflict", "Evidence gap", "Reconcile the Regulation N claims and archive scope.", authority.mapClaims, authority.mapArchive);
    if (!facts.archive.materials || !facts.archive.availableProducts || !facts.archive.additionalProducts)
      add("archive-materials", "Evidence gap", "Reference the communications, available mortgage products and additional products or services for the relevant period.", authority.mapArchive);
    if (facts.distribution?.finalOn) {
      const last = facts.distribution.finalOn;
      const anniversary = String(Number(last.slice(0, 4)) + 2).padStart(4, "0") + last.slice(4);
      if (z.iso.date().safeParse(anniversary).success) federalArchiveReviewDate = anniversary;
      else add("archive-anniversary", "Evidence gap", "Confirm the archive date with counsel for a February 29 last use.", authority.mapArchive);
    }
  }
  if (facts.distribution?.firstOn === facts.reviewedOn && !facts.distribution.sameDayOrder)
    add("same-day-review", "Evidence gap", "Review and first use share a date. Confirm their order from the source records.");
  else if (facts.distribution && (facts.distribution.firstOn < facts.reviewedOn || facts.distribution.sameDayOrder === "Before review"))
    add("review-after-use", "Advisory", "Recorded first use predates this review.");
  return { ruleRevision: advertisingRuleRevision, sources, findings, federalArchiveReviewDate };
}

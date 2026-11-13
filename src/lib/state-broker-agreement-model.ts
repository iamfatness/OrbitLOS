import { z } from "zod";
import { compareLocalEvidenceOrder as chronology } from "./local-evidence-order";

export const brokerAgreementStates = ["IN", "IL", "WI"] as const;
export const brokerAgreementZones = ["America/Indiana/Indianapolis", "America/Chicago"] as const;
export const brokerAgreementSources = {
  IN: { label: "Ind. Code §23-2.5-8-1", href: "https://iga.in.gov/ic/2026/Title_23.html#23-2.5-8-1" },
  IL: { label: "38 Ill. Adm. Code §1050.1010", href: "https://www.ilga.gov/commission/jcar/admincode/038/038010500I10100R.html" },
  WI: { label: "Wis. Stat. §224.79", href: "https://docs.legis.wisconsin.gov/statutes/statutes/224/iii/79" },
} as const;

const state = z.enum(brokerAgreementStates);
const reference = z.string().trim().min(1).max(180);
const evidence = z.strictObject({
  on: z.iso.date().refine(value => value >= "2022-01-01" && value <= "2099-12-31", "Enter a date from 2022 through 2099."),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  reference,
});
const common = {
  applicability: z.enum(["Covered for internal review", "Unresolved"]),
  scopeReference: reference,
  zone: z.enum(brokerAgreementZones),
  agreementVersion: reference.optional(),
  signed: evidence.optional(),
  deliveredCopy: evidence.optional(),
};
export const brokerAgreementFacts = z.discriminatedUnion("state", [
  z.strictObject({ ...common, state: z.literal("IN"), exclusiveLender: z.enum(["Unresolved", "Applies", "Does not apply"]),
    exclusiveDisclosure: evidence.optional() }),
  z.strictObject({ ...common, state: z.literal("IL"), applicationSigned: evidence.optional(), consideration: evidence.optional(),
    incorporatedDisclosureVersion: reference.optional() }),
  z.strictObject({ ...common, state: z.literal("WI"), form: z.enum(["Unresolved", "MB302TRID", "MB302", "MB303", "Other for counsel review"]),
    disclosureVersion: reference.optional(), disclosureDelivered: evidence.optional(), explanation: evidence.optional(),
    acknowledgment: evidence.optional() }),
]).superRefine((facts, ctx) => {
  if (facts.state !== "IN" && facts.zone !== "America/Chicago")
    ctx.addIssue({ code: "custom", path: ["zone"], message: "Use Central time for Illinois or Wisconsin reviews." });
});

const loanId = z.string().min(1).max(100);
export const brokerAgreementRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read"), loanId, state }),
  z.strictObject({ operation: z.literal("save"), loanId, requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
    facts: brokerAgreementFacts, correction: reference.optional() }),
]);
export type BrokerAgreementFacts = z.infer<typeof brokerAgreementFacts>;
export type BrokerAgreementRequest = z.infer<typeof brokerAgreementRequest>;
type Evidence = z.infer<typeof evidence>;

export function brokerAgreementEvents(facts: BrokerAgreementFacts) {
  const common = [facts.signed, facts.deliveredCopy];
  switch (facts.state) {
    case "IN": return [...common, facts.exclusiveDisclosure];
    case "IL": return [...common, facts.applicationSigned, facts.consideration];
    case "WI": return [...common, facts.disclosureDelivered, facts.explanation, facts.acknowledgment];
  }
}

export function reviewBrokerAgreement(facts: BrokerAgreementFacts) {
  const gaps: string[] = [];
  const timing: { label: string; result: ReturnType<typeof chronology> }[] = [];
  const compare = (label: string, event: Evidence | undefined, baseline: Evidence | undefined, expected: "Before" | "Same recorded minute") => {
    const result = chronology(event, baseline);
    timing.push({ label, result });
    if (result !== expected) gaps.push(`Review ${label.toLowerCase()}.`);
  };
  if (facts.applicability === "Unresolved") gaps.push("Confirm state coverage, parties and responsible entity.");
  if (!facts.agreementVersion) gaps.push("Record the signed agreement version.");
  if (!facts.signed) gaps.push("Record when the required parties completed signing.");
  switch (facts.state) {
    case "IN":
      compare("Signed copy relative to signing", facts.deliveredCopy, facts.signed, "Same recorded minute");
      if (facts.exclusiveLender === "Applies")
        compare("Exclusive lender disclosure relative to signing", facts.exclusiveDisclosure, facts.signed, "Same recorded minute");
      if (facts.exclusiveLender === "Unresolved") gaps.push("Confirm whether an exclusive lender arrangement applies.");
      break;
    case "IL":
      compare("Agreement relative to application signature", facts.signed, facts.applicationSigned, "Before");
      compare("Agreement relative to consideration", facts.signed, facts.consideration, "Before");
      const copyOrder = chronology(facts.deliveredCopy, facts.signed);
      timing.push({ label: "Executed copy relative to signing", result: copyOrder });
      if (!facts.deliveredCopy) gaps.push("Record delivery of the executed agreement copy.");
      else if (copyOrder === "Before") gaps.push("Review why the recorded copy delivery predates signing.");
      else if (copyOrder !== "After" && copyOrder !== "Same recorded minute")
        gaps.push("Review the timing of executed copy delivery relative to signing.");
      if (!facts.incorporatedDisclosureVersion) gaps.push("Identify the incorporated brokerage disclosure.");
      break;
    case "WI":
      if (facts.form === "Unresolved" || facts.form === "Other for counsel review") gaps.push("Confirm the agreement form for this product.");
      if (!facts.disclosureVersion) gaps.push("Record the separate consumer disclosure version.");
      compare("Consumer disclosure relative to agreement", facts.disclosureDelivered, facts.signed, "Before");
      compare("Disclosure explanation relative to agreement", facts.explanation, facts.signed, "Before");
      compare("Disclosure acknowledgment relative to agreement", facts.acknowledgment, facts.signed, "Before");
      break;
  }
  return { timing, gaps };
}

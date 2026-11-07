import { z } from "zod";

export const mismoNamespace = "http://www.mismo.org/residential/2009/schemas";
const purposes = { Purchase: "Purchase", Refinance: "Refinance" } as const;
const uses = { PrimaryResidence: "Primary residence", SecondHome: "Second home", Investment: "Investment property" } as const;

export const mismoFields = z.object({
  firstName: z.string().trim().min(1).max(70), lastName: z.string().trim().min(1).max(85),
  amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).refine((value) => Number(value) > 0 && Number(value) <= 1_000_000_000),
  purpose: z.enum(["Purchase", "Refinance"]),
  occupancy: z.enum(["", "Primary residence", "Second home", "Investment property"]),
  street: z.string().trim().max(240), unit: z.string().trim().max(30),
  city: z.string().trim().max(100), state: z.string().regex(/^([A-Z]{2})?$/), zip: z.string().regex(/^(\d{5}(-\d{4})?)?$/),
});
export type MismoFields = z.infer<typeof mismoFields>;

export const importMismo = z.object({ type: z.literal("importMismo"), requestId: z.uuid(), fields: mismoFields, fictional: z.literal(true) });
export const exportMismo = z.object({ type: z.literal("exportMismo"), loanId: z.string().max(100) });

export const mismoMapping = [
  ["firstName", "Borrower first name", "PARTY / INDIVIDUAL / NAME / FirstName"],
  ["lastName", "Borrower last name", "PARTY / INDIVIDUAL / NAME / LastName"],
  ["amount", "Loan amount", "LOAN / TERMS_OF_LOAN / NoteAmount"],
  ["purpose", "Loan purpose", "LOAN / TERMS_OF_LOAN / LoanPurposeType"],
  ["occupancy", "Occupancy", "SUBJECT_PROPERTY / PROPERTY_DETAIL / PropertyUsageType"],
  ["street", "Property street", "SUBJECT_PROPERTY / ADDRESS / AddressLineText"],
  ["unit", "Unit", "SUBJECT_PROPERTY / ADDRESS / AddressUnitIdentifier"],
  ["city", "City", "SUBJECT_PROPERTY / ADDRESS / CityName"],
  ["state", "State", "SUBJECT_PROPERTY / ADDRESS / StateCode"],
  ["zip", "ZIP code", "SUBJECT_PROPERTY / ADDRESS / PostalCode"],
] as const;

export function readMismo(xml: string) {
  if (xml.length > 600_000 || /<!\s*(DOCTYPE|ENTITY)/i.test(xml)) throw new Error("Use an XML file under 600 KB without a DTD or entities.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  const descendants = (parent: Element | Document, tag: string) => Array.from(parent.getElementsByTagNameNS(mismoNamespace, tag));
  const first = (parent: Element | undefined, tag: string) => parent && descendants(parent, tag)[0];
  const value = (parent: Element | undefined, tag: string) => first(parent, tag)?.textContent?.trim() ?? "";
  const version = root.getAttribute("MISMOReferenceModelIdentifier") || "";
  if (root.localName !== "MESSAGE" || root.namespaceURI !== mismoNamespace || !/^3\.4(?:[.\s]|$)/.test(version)) {
    throw new Error("Choose a MISMO 3.4 MESSAGE XML file.");
  }
  const deals = descendants(root, "DEAL");
  const loans = descendants(root, "LOAN");
  const properties = descendants(root, "SUBJECT_PROPERTY");
  if (deals.length !== 1 || loans.length !== 1 || properties.length > 1) {
    throw new Error("This rehearsal supports one deal, one loan, and up to one subject property.");
  }
  const borrowers = descendants(deals[0], "PARTY").filter((party) =>
    descendants(party, "ROLE").some((role) => value(role, "PartyRoleType") === "Borrower"));
  if (!borrowers.length) throw new Error("The XML needs an individual party with the Borrower role.");
  const person = first(first(borrowers[0], "INDIVIDUAL"), "NAME");
  const address = first(properties[0], "ADDRESS");
  const property = first(properties[0], "PROPERTY_DETAIL");
  const terms = first(loans[0], "TERMS_OF_LOAN");
  const use = value(property, "PropertyUsageType");
  const purpose = value(terms, "LoanPurposeType");
  const parsed = mismoFields.safeParse({
    firstName: value(person, "FirstName"), lastName: value(person, "LastName"),
    amount: value(terms, "NoteAmount"), purpose: purposes[purpose as keyof typeof purposes] ?? "",
    occupancy: use ? uses[use as keyof typeof uses] : "",
    street: value(address, "AddressLineText"), unit: value(address, "AddressUnitIdentifier"),
    city: value(address, "CityName"), state: value(address, "StateCode"), zip: value(address, "PostalCode"),
  });
  if (!parsed.success) throw new Error(`Review this XML field before importing: ${String(parsed.error.issues[0]?.path[0] ?? "application")}.`);
  return { fields: parsed.data, extraBorrowers: borrowers.length - 1 };
}

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (character) =>
  ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);

export function mismoXml(fields: MismoFields) {
  const field = (tag: string, value: string) => value ? `<${tag}>${escapeXml(value)}</${tag}>` : "";
  const occupancy = Object.entries(uses).find(([, value]) => value === fields.occupancy)?.[0] ?? "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- OrbitLOS fictional mapping rehearsal. Keep this file within the pilot. -->
<MESSAGE xmlns="${mismoNamespace}" MISMOReferenceModelIdentifier="3.4.032420160128">
  <DEAL_SETS><DEAL_SET><DEALS><DEAL>
    <COLLATERALS><COLLATERAL><SUBJECT_PROPERTY>
      <ADDRESS>${field("AddressLineText", fields.street)}${field("AddressUnitIdentifier", fields.unit)}${field("CityName", fields.city)}${field("PostalCode", fields.zip)}${field("StateCode", fields.state)}</ADDRESS>
      <PROPERTY_DETAIL>${field("PropertyUsageType", occupancy)}</PROPERTY_DETAIL>
    </SUBJECT_PROPERTY></COLLATERAL></COLLATERALS>
    <LOANS><LOAN LoanRoleType="SubjectLoan"><TERMS_OF_LOAN>${field("LoanPurposeType", fields.purpose)}${field("NoteAmount", fields.amount)}</TERMS_OF_LOAN></LOAN></LOANS>
    <PARTIES><PARTY>
      <INDIVIDUAL><NAME>${field("FirstName", fields.firstName)}${field("LastName", fields.lastName)}</NAME></INDIVIDUAL>
      <ROLES><ROLE><ROLE_DETAIL><PartyRoleType>Borrower</PartyRoleType></ROLE_DETAIL></ROLE></ROLES>
    </PARTY></PARTIES>
  </DEAL></DEALS></DEAL_SET></DEAL_SETS>
</MESSAGE>
`;
}

export const mismoExample = mismoXml({
  firstName: "Riley", lastName: "Example", amount: "280000.50", purpose: "Purchase", occupancy: "Primary residence",
  street: "102 Fictional Avenue", unit: "2", city: "Troy", state: "MI", zip: "48084",
});

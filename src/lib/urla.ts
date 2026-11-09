import { z } from "zod";

export type AnswerRow = Record<string, string>;
type Kind = "money" | "rate" | "integer" | "date" | "email" | "phone" | "demoTaxId" | "address" | "multi";
type Condition = readonly [string, string];
export type Question = {
  key: string; label: string; kind?: Kind; choices?: readonly string[];
  required?: boolean; when?: Condition | readonly Condition[];
};
type Group = { key: string; label: string; fields: Question[]; when?: Condition; required?: boolean };
export type Questionnaire = { label: string; fields: Question[]; groups?: Group[] };
export type Answers = { fields: AnswerRow; groups: Record<string, AnswerRow[]> };
export const blankAnswers = (): Answers => ({ fields: {}, groups: {} });

const yesNo = ["Yes", "No"] as const;
const occupancy = ["Primary residence", "Second home", "Investment property", "FHA secondary residence", "Other"];
const text = (key: string, label: string, required = false): Question => ({ key, label, required });
const ask = (key: string, label: string, choices: readonly string[] = yesNo, when?: Question["when"]): Question =>
  ({ key, label, choices, required: true, when });
const value = (key: string, label: string, kind: Kind, required = false, when?: Question["when"]): Question =>
  ({ key, label, kind, required, when });
const money = (key: string, label: string, required = false, when?: Question["when"]) => value(key, label, "money", required, when);
const date = (key: string, label: string, required = false) => value(key, label, "date", required);
const account = () => text("account", "Fictional account reference (last four only)");
const moneyFields = (entries: [string, string][]) => entries.map(([key, label]) => money(key, label));

const housing = [
  value("years", "Years at address", "integer", true), value("months", "Additional months at address", "integer", true),
  ask("housing", "Housing arrangement", ["Own", "Rent", "No primary housing expense"]),
  money("rent", "Monthly rent", true, ["housing", "Rent"]),
];
const jobs: Question[] = [
  ask("status", "Employment period", ["Current", "Previous"]), text("employer", "Employer or business name", true),
  value("address", "Employer address", "address"), value("phone", "Employer phone", "phone"), text("position", "Position or title", true),
  date("start", "Start date", true), value("end", "End date", "date", true, ["status", "Previous"]),
  value("industryYears", "Years in this line of work", "integer"), value("industryMonths", "Additional months in this line of work", "integer"),
  ask("related", "Employed by a relative or party to this transaction?"), ask("selfEmployed", "Self-employed or business owner?"),
  ask("ownership", "Ownership share", ["Less than 25%", "25% or more"], ["selfEmployed", "Yes"]),
  ...moneyFields([["base","Monthly base pay"], ["overtime","Monthly overtime"], ["bonus","Monthly bonus"], ["commission","Monthly commission"],
    ["military","Monthly military entitlements"], ["other","Other monthly employment income"], ["business","Monthly business income or loss"]]),
];
const sourceTypes = ["Alimony", "Child support", "Separate maintenance", "Boarder income", "Capital gains", "Disability", "Foster care",
  "Housing allowance", "Interest and dividends", "Mortgage credit certificate", "Mortgage differential payments", "Notes receivable",
  "Public assistance", "Retirement or pension", "Royalty payments", "Social Security", "Trust", "Unemployment", "VA compensation", "Other"];
const mortgageTypes = ["Conventional", "FHA", "VA", "USDA-RD", "Other"];
const occupancyChoices = occupancy.slice(0, 4);
const chapters = ["Chapter 7", "Chapter 11", "Chapter 12", "Chapter 13"];
const nonAnswer = "Prefer not to provide";
const detailsWhenOther = (key: string, label: string, parent: string) => ({ ...text(key, label, true), when: [parent, "Other"] as const });

export const identityQuestions: Questionnaire = {
  label: "Personal information and housing",
  fields: [
    text("name", "Full legal name", true), text("aliases", "Other names used for credit"), value("taxId", "Fictional SSN or ITIN (000-00-####)", "demoTaxId", true),
    date("birthDate", "Date of birth", true), ask("citizenship", "Citizenship or residency", ["U.S. citizen", "Permanent resident", "Non-permanent resident"]),
    ask("marital", "Marital status", ["Married", "Separated", "Unmarried"]), value("dependentCount", "Number of dependents", "integer", true),
    text("dependentAges", "Dependents’ ages"), value("email", "Email", "email", true), value("cell", "Cell phone", "phone"),
    value("homePhone", "Home phone", "phone"), value("workPhone", "Work phone", "phone"), text("workExtension", "Work phone extension"),
    value("current", "Current address", "address", true), ...housing, ask("mailingDiffers", "Is your mailing address different?"),
    value("mailing", "Mailing address", "address", true, ["mailingDiffers", "Yes"]),
  ],
  groups: [{ key: "prior", label: "Former address", fields: [value("address", "Former address", "address", true), ...housing] }],
};

export const borrowerQuestions = {
  identity: identityQuestions,
  work: {
    label: "Employment and other income",
    fields: [ask("hasJobs", "Do you have current or previous employment to report?"), ask("hasIncome", "Do you want to report other income?")],
    groups: [
      { key: "jobs", label: "Job or business", fields: jobs, when: ["hasJobs", "Yes"] },
      { key: "income", label: "Other income source", fields: [ask("type", "Income source", sourceTypes), detailsWhenOther("description", "Describe the income", "type"), money("monthly", "Monthly amount", true)], when: ["hasIncome", "Yes"] },
    ],
  },
  finances: {
    label: "Assets, credits, and liabilities",
    fields: [ask("hasAssets", "Do you have accounts or assets to report?"), ask("hasCredits", "Do you have other assets or credits?"),
      ask("hasDebts", "Do you owe credit, other debts, or leases?"), ask("hasExpenses", "Do you have other recurring liabilities?")],
    groups: [
      { key: "assets", label: "Asset or account", when: ["hasAssets", "Yes"], fields: [
        ask("type", "Asset type", ["Checking", "Savings", "Money market", "Certificate of deposit", "Mutual fund", "Stocks", "Bonds", "Stock options", "Retirement", "Bridge loan proceeds", "Individual development account", "Trust", "Life insurance cash value", "Other"]),
        text("institution", "Financial institution", true), account(), money("value", "Cash or market value", true)] },
      { key: "credits", label: "Other asset or credit", when: ["hasCredits", "Yes"], fields: [
        ask("type", "Asset or credit type", ["Real estate sale proceeds", "Other asset sale proceeds", "Secured borrowed funds", "Unsecured borrowed funds", "Earnest money", "Employer assistance", "Lot equity", "Relocation", "Rent credit", "Sweat equity", "Trade equity", "Other"]), money("value", "Cash or market value", true)] },
      { key: "debts", label: "Debt or lease", when: ["hasDebts", "Yes"], fields: [
        ask("type", "Account type", ["Revolving", "Installment", "Open 30-day", "Lease", "Other"]), text("creditor", "Creditor", true), account(),
        money("balance", "Unpaid balance", true), money("payment", "Monthly payment", true), ask("paidOff", "Pay off at or before closing?")] },
      { key: "expenses", label: "Other liability or expense", when: ["hasExpenses", "Yes"], fields: [
        ask("type", "Expense type", ["Alimony", "Child support", "Separate maintenance", "Job-related expenses", "Other"]), money("payment", "Monthly payment", true)] },
    ],
  },
  realEstate: {
    label: "Real estate owned",
    fields: [ask("hasProperty", "Do you own real estate?")],
    groups: [
      { key: "properties", label: "Owned property", when: ["hasProperty", "Yes"], fields: [
        value("address", "Property address", "address", true), money("value", "Estimated value", true), ask("status", "Property status", ["Sold", "Pending sale", "Retained"]),
        ask("occupancy", "Intended occupancy", occupancy), money("expenses", "Monthly taxes, insurance and dues outside mortgage payment"),
        money("rent", "Gross monthly rental income"), ask("hasMortgage", "Is there a mortgage on this property?")] },
      { key: "mortgages", label: "Mortgage on owned property", when: ["hasProperty", "Yes"], required: false, fields: [
        value("property", "Related property item number", "integer", true), text("creditor", "Creditor", true), account(),
        money("payment", "Monthly mortgage payment", true), money("balance", "Unpaid balance", true), ask("paidOff", "Pay off by closing?"),
        ask("type", "Mortgage type", mortgageTypes), money("limit", "Credit limit")] },
    ],
  },
  declarations: {
    label: "Declarations",
    fields: [
      ask("primary", "Will this be your primary residence?"), ask("owned", "Owned an interest in another property in the last three years?", yesNo, ["primary", "Yes"]),
      ask("ownedType", "Type of property previously owned", occupancyChoices, [["primary", "Yes"], ["owned", "Yes"]]),
      ask("title", "How you held title", ["Individually", "With spouse", "With another person"], [["primary", "Yes"], ["owned", "Yes"]]),
      ask("seller", "Related to or affiliated with the seller?", ["Yes", "No", "Not a purchase"]),
      ask("borrowed", "Undisclosed funds for this transaction?"), money("borrowedAmount", "Amount of undisclosed funds", true, ["borrowed", "Yes"]),
      ask("otherMortgage", "Undisclosed mortgage application on another property before closing?"), ask("newCredit", "Other undisclosed new credit before closing?"),
      ask("priorityLien", "Is there a lien that could take priority over this mortgage?"), ask("guarantor", "Co-signed or guaranteed an undisclosed debt?"),
      ask("judgments", "Outstanding judgments?"), ask("federalDebt", "Delinquent or in default on federal debt?"),
      ask("lawsuit", "In a lawsuit with potential personal financial liability?"), ask("deedInLieu", "Deed in lieu of foreclosure in the past seven years?"),
      ask("shortSale", "Short sale or pre-foreclosure sale in the past seven years?"), ask("foreclosure", "Foreclosure in the past seven years?"),
      ask("bankruptcy", "Bankruptcy in the past seven years?"),
      { ...value("chapters", "Bankruptcy chapter or chapters", "multi", true, ["bankruptcy", "Yes"]), choices: chapters },
    ],
  },
  military: {
    label: "Military service",
    fields: [ask("served", "Have you or a deceased spouse served in the U.S. Armed Forces?"),
      { ...value("service", "Service status", "multi", true, ["served", "Yes"]), choices: ["Active duty", "Retired, discharged, or separated", "Reserve or National Guard only", "Surviving spouse"] },
      date("end", "Expected end of active duty")],
  },
  demographics: {
    label: "Demographic information",
    fields: [
      { ...value("ethnicity", "Ethnicity (select all that apply)", "multi", true), choices: ["Hispanic or Latino", "Mexican", "Puerto Rican", "Cuban", "Other Hispanic or Latino", "Not Hispanic or Latino", nonAnswer] },
      text("ethnicityDetails", "Other Hispanic or Latino origin"),
      ask("sex", "Sex", ["Female", "Male", nonAnswer]),
      { ...value("race", "Race (select all that apply)", "multi", true), choices: ["American Indian or Alaska Native", "Asian", "Asian Indian", "Chinese", "Filipino", "Japanese", "Korean", "Vietnamese", "Other Asian", "Black or African American", "Native Hawaiian or Other Pacific Islander", "Native Hawaiian", "Guamanian or Chamorro", "Samoan", "Other Pacific Islander", "White", nonAnswer] },
      text("tribe", "Enrolled or principal tribe"), text("asianDetails", "Other Asian origin"), text("pacificDetails", "Other Pacific Islander origin"),
    ],
  },
  acknowledgment: {
    label: "Acknowledgment and signature",
    fields: [ask("agreed", "I reviewed the sample answers and understand this is a demo"), text("signature", "Type the fictional borrower’s full name", true)],
  },
} satisfies Record<string, Questionnaire>;

export const propertyQuestions: Questionnaire = {
  label: "Loan and property details",
  fields: [
    value("units", "Number of units", "integer", true), text("county", "County"),
    text("otherPurpose", "Describe the other loan purpose"),
    { ...ask("propertyPending", "Is the subject property address still to be determined?"), required: false },
    ask("mixedUse", "Will you run a business in part of the home?"), ask("manufactured", "Is this a manufactured home?"),
    ask("hasLiens", "Any other new mortgages on the subject property?"),
    money("rentalIncome", "Expected monthly rent, if this purchase will generate rental income"),
    ask("hasGifts", "Will you receive any gifts or grants?"),
  ],
  groups: [
    { key: "liens", label: "Other new mortgage", when: ["hasLiens", "Yes"], fields: [
      text("creditor", "Creditor", true), ask("lien", "Lien position", ["First lien", "Subordinate lien"]), money("payment", "Monthly payment", true),
      money("amount", "Amount to be drawn", true), money("limit", "Credit limit")] },
    { key: "gifts", label: "Gift or grant", when: ["hasGifts", "Yes"], fields: [
      ask("type", "Gift or grant type", ["Cash gift", "Gift of equity", "Grant"]), ask("deposited", "Already deposited?"),
      ask("source", "Source", ["Community nonprofit", "Employer", "Federal agency", "Local agency", "Relative", "Religious nonprofit", "State agency", "Unmarried partner", "Lender", "Other"]),
      money("value", "Amount", true)] },
  ],
};

export const applicationCredit: Questionnaire = {
  label: "Application type",
  fields: [ask("type", "Credit type", ["Individual", "Joint"])],
};

export const jointQuestions: Questionnaire = { label: "Joint credit intent", fields: [text("initials", "Initials confirming joint credit intent", true)] };

export type BorrowerSection = keyof typeof borrowerQuestions;
export type BorrowerDetails = Record<BorrowerSection, Answers> & { joint: Answers };
export type UrlaDetails = { credit: Answers; primary: BorrowerDetails; additional: BorrowerDetails[]; property: Answers };

const rowSchema = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), z.string().trim().max(750));
const answersSchema = z.object({
  fields: rowSchema.default({}),
  groups: z.record(z.string(), z.array(rowSchema).max(12)).default({}),
}).default(blankAnswers);
export const borrowerDetailsSchema = z.object({
  identity: answersSchema, work: answersSchema, finances: answersSchema, realEstate: answersSchema, declarations: answersSchema,
  military: answersSchema, demographics: answersSchema, acknowledgment: answersSchema, joint: answersSchema,
});
export const urlaDetailsSchema = z.object({
  credit: answersSchema, primary: borrowerDetailsSchema, additional: z.array(borrowerDetailsSchema).max(4).default([]), property: answersSchema,
});
export const blankBorrower = (): BorrowerDetails => borrowerDetailsSchema.parse({});
export const blankUrla = (): UrlaDetails => urlaDetailsSchema.parse({ primary: {} });

export function active(when: Question["when"], row: AnswerRow) {
  if (!when) return true;
  return typeof when[0] === "string" ? row[when[0]] === when[1] : (when as readonly Condition[]).every(([key, value]) => row[key] === value);
}

export function readAddress(value: string | undefined) {
  const empty = { street: "", unit: "", city: "", state: "", zip: "", country: "" };
  if (!value) return empty;
  try { return z.object({
    street: z.string().max(240), unit: z.string().max(30), city: z.string().max(100),
    state: z.string().max(100), zip: z.string().max(20), country: z.string().max(100),
  }).parse(JSON.parse(value)); }
  catch { return empty; }
}

function validValue(field: Question, answer: string) {
  if (field.kind === "multi") {
    const choices = answer.split("|");
    return new Set(choices).size === choices.length && choices.every((choice) => field.choices?.includes(choice))
      && (!choices.includes(nonAnswer) || choices.length === 1);
  }
  if (field.choices) return field.choices.includes(answer);
  switch (field.kind) {
    case "email": return z.email().safeParse(answer).success;
    case "date": return z.iso.date().safeParse(answer).success;
    case "money": return /^-?\d{1,10}(\.\d{1,2})?$/.test(answer) && Math.abs(Number(answer)) <= 1_000_000_000
      && (["business", "cash", "net", "rentalNet"].includes(field.key) || Number(answer) >= 0);
    case "rate": return /^\d{1,2}(\.\d{1,3})?$/.test(answer);
    case "integer": return /^\d{1,3}$/.test(answer) && (field.key !== "months" || Number(answer) < 12) && (field.key !== "units" || Number(answer) > 0);
    case "demoTaxId": return /^000-00-\d{4}$/.test(answer);
    case "address": {
      const address = readAddress(answer);
      return !!Object.values(address).some(Boolean);
    }
    default: return field.key !== "account" || /^\d{4}$/.test(answer);
  }
}

export function cleanAnswers(definition: Questionnaire, answers: Answers, complete = false) {
  const issues: string[] = [];
  const cleanRow = (fields: Question[], row: AnswerRow, prefix: string, enabled: boolean) => {
    const result: AnswerRow = {};
    for (const field of fields) {
      const answer = row[field.key]?.trim() ?? "";
      const applicable = enabled && active(field.when, row);
      if (answer && ((complete && applicable) || field.kind === "demoTaxId" || field.key === "account") && !validValue(field, answer)) {
        issues.push(prefix + field.label);
      }
      if (complete && applicable && field.required && !answer) issues.push(prefix + field.label);
      if (complete && applicable && field.kind === "address" && answer) {
        const address = readAddress(answer);
        const domestic = !address.country || /^(US|USA|United States)$/i.test(address.country.trim());
        if (!address.street.trim() || !address.city.trim() || (domestic && (!/^[A-Z]{2}$/i.test(address.state.trim()) || !/^\d{5}(?:-\d{4})?$/.test(address.zip.trim())))) issues.push(prefix + field.label);
      }
      if (answer) result[field.key] = answer;
    }
    return result;
  };
  const fields = cleanRow(definition.fields, answers.fields, "", true);
  const groups: Answers["groups"] = {};
  for (const group of definition.groups ?? []) {
    const rows = answers.groups[group.key] ?? [];
    const enabled = active(group.when, answers.fields);
    if (complete && group.when && group.required !== false && enabled && !rows.length) issues.push("Add " + group.label.toLowerCase());
    if (rows.length) groups[group.key] = rows.map((row, index) => cleanRow(group.fields, row, `${group.label} ${index + 1} · `, enabled));
  }
  return { answers: { fields, groups }, issues };
}

const primaryDefinitions = {
  ...borrowerQuestions,
  identity: { ...identityQuestions, fields: identityQuestions.fields.filter(({ key }) => !["name", "email", "cell", "current"].includes(key)) },
};

export function borrowerDefinition(section: BorrowerSection, primary: boolean) {
  return primary ? primaryDefinitions[section] : borrowerQuestions[section];
}

export function normalizeBorrowerDetails(borrower: BorrowerDetails, primary: boolean, complete: boolean, joint: boolean, hasLegacyPrior = false) {
  const issues: string[] = [];
  const result = blankBorrower();
  function clean(section: BorrowerSection | "joint", definition: Questionnaire, check: boolean) {
    const cleaned = cleanAnswers(definition, borrower[section], check);
    issues.push(...cleaned.issues.map((issue) => `${definition.label} · ${issue}`));
    result[section] = cleaned.answers;
  }
  for (const section of Object.keys(borrowerQuestions) as BorrowerSection[]) clean(section, borrowerDefinition(section, primary), complete);
  clean("joint", jointQuestions, complete && joint);
  if (complete) {
    if (borrower.acknowledgment.fields.agreed !== "Yes") issues.push("Each borrower must acknowledge their sample answers");
    const housing = Number(borrower.identity.fields.years) * 12 + Number(borrower.identity.fields.months);
    if (housing < 24 && !borrower.identity.groups.prior?.length && !(primary && hasLegacyPrior)) {
      issues.push("Add former housing if at the current address for less than two years");
    }
    const properties = borrower.realEstate.fields.hasProperty === "Yes" ? borrower.realEstate.groups.properties ?? [] : [];
    const mortgages = borrower.realEstate.groups.mortgages ?? [];
    for (const [index, property] of properties.entries()) {
      if (property.hasMortgage === "Yes" && !mortgages.some((item) => item.property === String(index + 1))) {
        issues.push(`Add a mortgage entry with related property item number ${index + 1}`);
      }
    }
    if (properties.length && mortgages.some((item) => Number(item.property) < 1 || Number(item.property) > properties.length)) {
      issues.push("Each property mortgage must reference an owned property item number");
    }
  }
  return { borrower: result, issues };
}

export function normalizeUrla(details: UrlaDetails, complete: boolean, hasLegacyPrior = false, separateJoint = false) {
  const issues: string[] = [];
  const clean = (definition: Questionnaire, input: Answers) => {
    const result = cleanAnswers(definition, input, complete);
    issues.push(...result.issues.map((issue) => `${definition.label} · ${issue}`));
    return result.answers;
  };
  const credit = clean(applicationCredit, details.credit);
  const joint = credit.fields.type === "Joint";
  if (complete && joint && !separateJoint && !details.additional.length) issues.push("Add at least one additional borrower for joint credit");
  function person(borrower: BorrowerDetails, primary: boolean) {
    const result = normalizeBorrowerDetails(borrower, primary, complete, joint, hasLegacyPrior);
    issues.push(...result.issues);
    return result.borrower;
  }
  const primary = person(details.primary, true);
  const additional = details.additional.map((borrower) => person(borrower, false));
  const property = clean(propertyQuestions, details.property);
  return { details: { credit, primary, additional, property }, issues };
}

export function sampleUrla(name: string, purchase: boolean): UrlaDetails {
  const details = blankUrla();
  const person = details.primary;
  details.credit.fields = { type: "Individual" };
  person.identity.fields = { taxId: "000-00-1234", birthDate: "1990-04-12", citizenship: "U.S. citizen", marital: "Unmarried",
    dependentCount: "0", years: "3", months: "0", housing: "Rent", rent: "1800", mailingDiffers: "No" };
  person.work.fields = { hasJobs: "Yes", hasIncome: "No" };
  person.work.groups.jobs = [{ status: "Current", employer: "Sample Design Studio", position: "Designer", start: "2022-04-01",
    related: "No", selfEmployed: "No", base: "7500" }];
  person.finances.fields = { hasAssets: "Yes", hasCredits: "No", hasDebts: "Yes", hasExpenses: "No" };
  person.finances.groups.assets = [{ type: "Savings", institution: "Sample Credit Union", account: "1234", value: "67000" }];
  person.finances.groups.debts = [{ type: "Installment", creditor: "Sample Auto Finance", account: "5678", balance: "12000", payment: "490", paidOff: "No" }];
  person.realEstate.fields = { hasProperty: "No" };
  person.declarations.fields = { primary: "Yes", owned: "No", seller: purchase ? "No" : "Not a purchase", borrowed: "No", otherMortgage: "No",
    newCredit: "No", priorityLien: "No", guarantor: "No", judgments: "No", federalDebt: "No", lawsuit: "No", deedInLieu: "No",
    shortSale: "No", foreclosure: "No", bankruptcy: "No" };
  person.military.fields = { served: "No" };
  person.demographics.fields = { ethnicity: nonAnswer, race: nonAnswer, sex: nonAnswer };
  person.acknowledgment.fields = { agreed: "Yes", signature: name };
  details.property.fields = { units: "1", county: "Oakland", mixedUse: "No", manufactured: "No", hasLiens: "No", hasGifts: "No" };
  return details;
}

const optionalChoice = (key: string, label: string, choices: readonly string[] = yesNo): Question => ({ key, label, choices });

export const lenderQuestions: Questionnaire = {
  label: "Loan originator and lender information",
  fields: [
    text("loanNumber", "Lender loan number"), text("uli", "Universal loan identifier"), text("agencyNumber", "Agency case number"),
    text("originator", "Loan originator name"), text("originatorNmls", "Originator NMLS ID"), text("originatorLicense", "Originator state license ID"),
    text("organization", "Originator organization"), value("organizationAddress", "Organization address", "address"),
    text("organizationNmls", "Organization NMLS ID"), text("organizationLicense", "Organization state license ID"),
    value("email", "Originator email", "email"), value("phone", "Originator phone", "phone"), text("signature", "Sample originator signature"), date("signed", "Date signed"),
  ],
};

export const lenderSupplement: Questionnaire = {
  label: "Lender loan information supplement",
  fields: [
    optionalChoice("borrowerCommunity", "Borrower lives in a community property state?"), optionalChoice("propertyCommunity", "Property is in a community property state?"),
    { ...value("transactions", "Transaction details", "multi"), choices: ["Contract for deed conversion", "Renovation", "Construction to permanent", "Single closing", "Two closings"] },
    money("constructionCosts", "Construction or improvement costs"), date("lotDate", "Lot acquired date"), money("lotCost", "Original lot cost"),
    optionalChoice("refinance", "Refinance type", ["No cash out", "Limited cash out", "Cash out"]),
    optionalChoice("refinanceProgram", "Refinance program", ["Full documentation", "Interest rate reduction", "Streamlined without appraisal", "Other"]),
    optionalChoice("energyImprovements", "Finance energy improvements?"), optionalChoice("energyLien", "Existing priority energy lien?"),
    optionalChoice("project", "Project type", ["Condominium", "Cooperative", "Planned unit development", "Not in a project"]),
    text("titleNames", "Names to hold title"), text("refinanceTitleNames", "Current title holders for refinance"),
    optionalChoice("estate", "Estate type", ["Fee simple", "Leasehold"]), date("leaseExpiry", "Leasehold expiration"),
    optionalChoice("vesting", "Title vesting", ["Sole ownership", "Joint tenants with survivorship", "Life estate", "Tenancy by entirety", "Tenancy in common", "Other"]),
    optionalChoice("trust", "Trust type", ["Living trust", "Land trust"]),
    optionalChoice("landTenure", "Indian Country land tenure", ["Fee simple on reservation", "Individual trust land", "Tribal trust land on reservation", "Tribal trust land off reservation", "Alaska Native Corporation land"]),
    optionalChoice("mortgage", "Mortgage program", mortgageTypes), value("rate", "Note rate (%)", "rate"), value("term", "Loan term (months)", "integer"),
    optionalChoice("mortgageLien", "Mortgage lien", ["First lien", "Subordinate lien"]),
    optionalChoice("amortization", "Amortization", ["Fixed rate", "Adjustable rate", "Other"]), text("amortizationDetails", "Other amortization details"),
    value("firstAdjustment", "Months to first rate adjustment", "integer"), value("laterAdjustment", "Months between adjustments", "integer"),
    { ...value("features", "Loan features", "multi"), choices: ["Balloon", "Interest only", "Negative amortization", "Prepayment penalty", "Temporary buydown", "Other"] },
    value("balloonTerm", "Balloon term (months)", "integer"), value("interestOnlyTerm", "Interest-only term (months)", "integer"),
    value("prepaymentTerm", "Prepayment penalty term (months)", "integer"), value("buydownRate", "Initial buydown rate (%)", "rate"), text("otherFeatures", "Other loan features"),
    ...moneyFields([["firstPayment","First mortgage principal and interest"], ["subordinatePayment","Subordinate mortgage principal and interest"],
      ["insurance","Homeowner insurance"], ["supplementalInsurance","Supplemental insurance"], ["propertyTaxes","Property taxes"],
      ["mortgageInsurance","Mortgage insurance"], ["associationDues","Association dues"], ["otherPayment","Other monthly payment"],
      ["totalPayment","Total proposed monthly payment"], ["rentalNet","Expected net monthly rental income"],
      ["purchasePrice","Sales contract price"], ["improvements","Improvements, renovations and repairs"], ["land","Land on a separate purchase"],
      ["mortgagePayoffs","Mortgage balances paid in this transaction"], ["debtPayoffs","Other debts paid in this transaction"],
      ["closingCosts","Closing costs including prepaid items"], ["discountPoints","Discount points"], ["totalDue","Total due from borrower"],
      ["loanAmount","Loan amount"], ["financedInsurance","Financed mortgage insurance or funding fee"], ["otherNewLoan","Other new mortgage proceeds"],
      ["totalMortgage","Total mortgage loans"], ["sellerCredit","Seller credits"], ["otherCredits","Other credits"], ["totalCredits","Total credits"]]),
    money("cash", "Cash due from or to borrower"),
  ],
  groups: [{ key: "rentalNet", label: "Owned property net rent", fields: [
    text("property", "Borrower and property item", true), money("net", "Net monthly rent", true),
  ] }],
};

export const lenderDetailsSchema = z.object({
  originator: answersSchema, supplement: answersSchema,
});
export type LenderDetails = z.infer<typeof lenderDetailsSchema>;
export const blankLenderDetails = (): LenderDetails => lenderDetailsSchema.parse({});

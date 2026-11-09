import { applicationDraft, applicationIssues, type ApplicationDraft } from "./application-model";
import { getApplication } from "./applications";
import { easternDate } from "./client-retention";
import { mismoNamespace } from "./mismo-rehearsal-model";
import type { ExportName, exportReviewedApplication } from "./lender-export-model";
import { mismoBorrower, mismoFinances, mortgage, usage } from "./mismo-borrower-export";
import { container, contactPoint, fields, indicator, label, mismoAddress, partyRole, relationship } from "./mismo-xml";
import type { StaffIdentity } from "./staff-store";
import type { Store } from "./store";
import { blankLenderDetails, lenderDetailsSchema, readAddress, type LenderDetails } from "./urla";
import type { z } from "zod";

function originatorParties(details: LenderDetails) {
  const org = details.originator.fields;
  const contact = container("CONTACT_POINTS", [contactPoint("email", org.email), contactPoint("phone", org.phone, "Work")]);
  const license = (value: string, nmls: boolean) => value ? container("LICENSE", [
    fields("LICENSE_DETAIL", { LicenseAuthorityLevelType: nmls ? undefined : "PublicState", LicenseIdentifier: value,
      LicenseIssuingAuthorityName: nmls ? "NMLS" : undefined }),
  ]) : "";
  const role = (type: string, nmls: string, state: string) => container("ROLES", [
    container("ROLE", [
      container("LICENSES", [license(nmls, true), license(state, false)]), partyRole(type),
    ]),
  ]);
  return [
    org.originator ? container("PARTY", [
      container("INDIVIDUAL", [contact, fields("NAME", { FullName: org.originator })]),
      role("LoanOriginator", org.originatorNmls, org.originatorLicense),
    ]) : "",
    org.organization ? container("PARTY", [
      container("LEGAL_ENTITY", [fields("LEGAL_ENTITY_DETAIL", { FullName: org.organization })]),
      container("ADDRESSES", [mismoAddress(readAddress(org.organizationAddress))]),
      role("LoanOriginationCompany", org.organizationNmls, org.organizationLicense),
    ]) : "",
  ];
}

function subjectProperty(draft: ApplicationDraft, details: LenderDetails) {
  const property = draft.urla.property.fields;
  const terms = details.supplement.fields;
  return container("COLLATERALS", [container("COLLATERAL", [container("SUBJECT_PROPERTY", [
    property.propertyPending === "Yes" ? "" : mismoAddress({ street: draft.propertyAddress, ...draft.propertyLocation }, undefined, property.county),
    fields("PROPERTY_DETAIL", {
      CommunityPropertyStateIndicator: indicator(terms.propertyCommunity),
      ConstructionMethodType: property.manufactured === "Yes" ? "Manufactured" : undefined,
      FHASecondaryResidenceIndicator: draft.occupancy === "FHA secondary residence" ? "true" : undefined,
      FinancedUnitCount: property.units,
      PropertyEstateType: terms.estate === "Fee simple" ? "FeeSimple" : terms.estate === "Leasehold" ? "Leasehold" : undefined,
      PropertyEstimatedValueAmount: draft.estimatedValue, PropertyExistingCleanEnergyLienIndicator: indicator(terms.energyLien),
      PropertyGroundLeaseExpirationDate: terms.leaseExpiry, PropertyMixedUsageIndicator: indicator(property.mixedUse),
      PropertyOriginalCostAmount: terms.lotCost,
      PropertyUsageType: usage[draft.occupancy], RentalEstimatedGrossMonthlyRentAmount: property.rentalIncome,
      RentalEstimatedNetMonthlyRentAmount: terms.rentalNet,
    }),
    terms.purchasePrice ? container("SALES_CONTRACTS", [container("SALES_CONTRACT", [
      fields("SALES_CONTRACT_DETAIL", { SalesContractAmount: terms.purchasePrice }),
    ])]) : "",
  ])])]);
}

function subjectLoan(draft: ApplicationDraft, details: LenderDetails, receivedDate: string, loanId: string) {
  const terms = details.supplement.fields;
  const originator = details.originator.fields;
  const features = (terms.features ?? "").split("|");
  const transaction = (terms.transactions ?? "").split("|");
  const amortization = ({ "Fixed rate": "Fixed", "Adjustable rate": "AdjustableRate", Other: "Other" } as Record<string, string>)[terms.amortization];
  const lien = terms.mortgageLien === "First lien" ? "FirstLien" : undefined;
  const identifiers = [[originator.loanNumber, "LenderLoan"], [originator.uli, "UniversalLoan"], [originator.agencyNumber, "AgencyCase"]]
    .filter(([id]) => id).map(([id, type]) => fields("LOAN_IDENTIFIER", { LoanIdentifier: id, LoanIdentifierType: type }));
  return container("LOAN", [
    container("AMORTIZATION", [fields("AMORTIZATION_RULE", {
      AmortizationType: amortization, AmortizationTypeOtherDescription: terms.amortizationDetails,
      LoanAmortizationPeriodCount: terms.term, LoanAmortizationPeriodType: terms.term ? "Month" : undefined,
    })]),
    fields("LOAN_DETAIL", {
      ApplicationReceivedDate: receivedDate,
      BalloonIndicator: features.includes("Balloon") ? "true" : undefined,
      BorrowerCount: 1 + draft.urla.additional.length,
      BuydownTemporarySubsidyFundingIndicator: features.includes("Temporary buydown") ? "true" : undefined,
      ConstructionLoanIndicator: transaction.includes("Construction to permanent") ? "true" : undefined,
      ConversionOfContractForDeedIndicator: transaction.includes("Contract for deed conversion") ? "true" : undefined,
      EnergyRelatedImprovementsIndicator: indicator(terms.energyImprovements),
      InterestOnlyIndicator: features.includes("Interest only") ? "true" : undefined,
      NegativeAmortizationIndicator: features.includes("Negative amortization") ? "true" : undefined,
      PrepaymentPenaltyIndicator: features.includes("Prepayment penalty") ? "true" : undefined,
      RenovationLoanIndicator: transaction.includes("Renovation") ? "true" : undefined,
    }),
    container("LOAN_IDENTIFIERS", identifiers),
    container("ORIGINATION_SYSTEMS", [fields("ORIGINATION_SYSTEM", { LoanOriginationSystemLoanIdentifier: loanId, LoanOriginationSystemName: "OrbitLOS" })]),
    draft.purpose === "Refinance" ? fields("REFINANCE", {
      RefinanceCashOutDeterminationType: ({ "No cash out": "NoCashOut", "Limited cash out": "LimitedCashOut", "Cash out": "CashOut" } as Record<string, string>)[terms.refinance],
    }) : "",
    fields("TERMS_OF_LOAN", {
      LienPriorityType: lien, LoanPurposeType: draft.purpose, LoanPurposeTypeOtherDescription: draft.urla.property.fields.otherPurpose,
      MortgageType: mortgage[terms.mortgage], NoteAmount: terms.loanAmount || draft.loanAmount, NoteRatePercent: terms.rate,
    }),
  ], { ...label("LOAN_1"), LoanRoleType: "SubjectLoan" });
}

export function reviewedApplicationXml(draft: ApplicationDraft, details: LenderDetails, names: ExportName[], receivedDate: string, loanId: string) {
  const people = [draft.urla.primary, ...draft.urla.additional];
  if (people.length !== names.length) throw new Error("Confirm one export name for each borrower on the current application.");
  const relationships: string[] = [];
  const borrowers = people.map((person, index) => {
    relationships.push(relationship("LOAN_1", `BORROWER_${index + 1}`, "LOAN_IsAssociatedWith_ROLE"));
    return mismoBorrower(person, draft, names[index], index, relationships);
  });
  const finances = people.map((person, index) => mismoFinances(person, index, relationships));
  const deal = container("DEAL", [
    container("ASSETS", finances.flatMap((row) => row.assets)), subjectProperty(draft, details),
    container("EXPENSES", finances.flatMap((row) => row.expenses)),
    container("LIABILITIES", finances.flatMap((row) => row.liabilities)),
    container("LOANS", [subjectLoan(draft, details, receivedDate, loanId)]),
    container("PARTIES", [...borrowers, ...originatorParties(details)]),
    container("RELATIONSHIPS", relationships),
  ]);
  const xml = container("MESSAGE", [container("DEAL_SETS", [container("DEAL_SET", [container("DEALS", [deal])])])], {
    xmlns: mismoNamespace, "xmlns:xlink": "http://www.w3.org/1999/xlink", MISMOReferenceModelIdentifier: "3.4.032420160128",
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- OrbitLOS pilot manual handoff. Fictional data. -->\n${xml}\n`;
}

export function prepareLenderExport(db: Store, input: z.infer<typeof exportReviewedApplication>, staff: StaffIdentity, now: string) {
  const application = getApplication(db, input.loanId);
  if (!application?.submittedAt || !application.reviewedAt || application.correctionNote || application.revision !== input.revision) {
    return { error: "Review the current submitted 1003 before downloading it. Refresh the loan if it changed." };
  }
  const lender = db.prepare("SELECT details, revision FROM application_lender_details WHERE loanId = ?").get(input.loanId);
  if (Number(lender?.revision ?? 0) !== input.lenderRevision) return { error: "Lender details changed. Refresh the loan before downloading." };
  const draft = applicationDraft.parse(JSON.parse(application.draft));
  if (!draft.confirmedDemo) return { error: "Manual export is available for fictional pilot applications." };
  if (applicationIssues(draft).length) return { error: "The reviewed 1003 has missing answers. Request corrections before downloading." };
  const details = lender ? lenderDetailsSchema.parse(JSON.parse(String(lender.details))) : blankLenderDetails();
  const first = db.prepare("SELECT min(submittedAt) AS date FROM application_versions WHERE loanId = ?").get(input.loanId);
  const receivedDate = easternDate(new Date(String(first?.date ?? application.submittedAt)));
  let xml: string;
  try { xml = reviewedApplicationXml(draft, details, input.names, receivedDate, input.loanId); }
  catch (error) { return { error: error instanceof Error ? error.message : "Orbit could not prepare the XML." }; }

  const message = `Prepared MISMO 3.4 XML for manual handoff · Application revision ${input.revision} · Lender details revision ${input.lenderRevision} · ${staff.email}`;
  const previous = db.prepare("SELECT loanId, text FROM activity WHERE id = ?").get(input.eventId);
  if (previous && (previous.loanId !== input.loanId || previous.text !== message)) return { error: "Reopen the export panel and start a new download." };
  if (!previous) db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(input.eventId, input.loanId, message, now);
  db.prepare(`INSERT OR IGNORE INTO application_handoff_events (activityId, loanId, applicationRevision, lenderRevision, outcome)
    VALUES (?, ?, ?, ?, 'Export prepared')`).run(input.eventId, input.loanId, input.revision, input.lenderRevision);
  return { xml };
}

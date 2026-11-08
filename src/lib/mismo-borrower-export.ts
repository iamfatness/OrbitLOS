import type { ApplicationDraft } from "./application-model";
import { readAddress, type AnswerRow, type BorrowerDetails } from "./urla";
import type { ExportName } from "./lender-export-model";
import { container, contactPoint, fields, indicator, label, mismoAddress, partyRole, relationship } from "./mismo-xml";

const housing: Record<string, string> = { Own: "Own", Rent: "Rent", "No primary housing expense": "LivingRentFree" };
const citizenship: Record<string, string> = { "U.S. citizen": "USCitizen", "Permanent resident": "PermanentResidentAlien", "Non-permanent resident": "NonPermanentResidentAlien" };
export const usage: Record<string, string> = { "Primary residence": "PrimaryResidence", "Second home": "SecondHome", "Investment property": "Investment", Other: "Other" };
export const mortgage: Record<string, string> = { Conventional: "Conventional", FHA: "FHA", VA: "VA", "USDA-RD": "USDARuralDevelopment", Other: "Other" };
const otherIncome: Record<string, string> = {
  Alimony: "Alimony", "Child support": "ChildSupport", "Separate maintenance": "SeparateMaintenance", "Boarder income": "BoarderIncome",
  "Capital gains": "CapitalGains", Disability: "Disability", "Foster care": "FosterCare", "Housing allowance": "HousingAllowance",
  "Interest and dividends": "DividendsInterest", "Mortgage credit certificate": "MortgageCreditCertificate",
  "Mortgage differential payments": "MortgageDifferential", "Notes receivable": "NotesReceivableInstallment",
  "Public assistance": "PublicAssistance", "Retirement or pension": "Pension", "Royalty payments": "Royalties", "Social Security": "SocialSecurity",
  Trust: "Trust", Unemployment: "Unemployment", "VA compensation": "VABenefitsNonEducational", Other: "Other",
};
const assets: Record<string, string> = {
  Checking: "CheckingAccount", Savings: "SavingsAccount", "Money market": "MoneyMarketFund", "Certificate of deposit": "CertificateOfDepositTimeDeposit",
  "Mutual fund": "MutualFund", Stocks: "Stock", Bonds: "Bond", "Stock options": "StockOptions", Retirement: "RetirementFund",
  "Bridge loan proceeds": "BridgeLoanNotDeposited", "Individual development account": "IndividualDevelopmentAccount",
  Trust: "TrustAccount", "Life insurance cash value": "LifeInsurance", Other: "Other",
  "Real estate sale proceeds": "PendingNetSaleProceedsFromRealEstateAssets", "Other asset sale proceeds": "ProceedsFromSaleOfNonRealEstateAsset",
  "Secured borrowed funds": "ProceedsFromSecuredLoan", "Unsecured borrowed funds": "ProceedsFromUnsecuredLoan",
  "Earnest money": "EarnestMoneyCashDepositTowardPurchase", "Employer assistance": "EmployerAssistance", Relocation: "RelocationMoney",
  "Lot equity": "Other", "Rent credit": "Other", "Sweat equity": "Other", "Trade equity": "Other",
};
const debts: Record<string, string> = { Revolving: "Revolving", Installment: "Installment", "Open 30-day": "Open30DayChargeAccount", Lease: "LeasePayment" };
const expenses: Record<string, string> = { Alimony: "Alimony", "Child support": "ChildSupport", "Separate maintenance": "SeparateMaintenanceExpense", "Job-related expenses": "JobRelatedExpenses", Other: "Other" };
const chapters: Record<string, string> = { "Chapter 7": "ChapterSeven", "Chapter 11": "ChapterEleven", "Chapter 12": "ChapterTwelve", "Chapter 13": "ChapterThirteen" };
const propertyStatus: Record<string, string> = { Sold: "Sold", "Pending sale": "PendingSale", Retained: "Retain" };

const namedHolder = (tag: string, name?: string) => container(tag, [fields("NAME", { FullName: name })]);

function residence(address: Parameters<typeof mismoAddress>[0], data: AnswerRow, type: string) {
  if (!address.street && !address.city && !address.zip) return "";
  return container("RESIDENCE", [mismoAddress(address), fields("RESIDENCE_DETAIL", {
    BorrowerResidencyBasisType: housing[data.housing], BorrowerResidencyDurationMonthsCount: data.months,
    BorrowerResidencyDurationYearsCount: data.years, BorrowerResidencyType: type,
  })]);
}

function employerInfo(person: BorrowerDetails, personId: string, relationships: string[]) {
  const incomeItems: string[] = [];
  const income = (id: string, type: string, amount: string, employment: boolean, description?: string) =>
    container("CURRENT_INCOME_ITEM", [fields("CURRENT_INCOME_ITEM_DETAIL", {
      CurrentIncomeMonthlyTotalAmount: amount, EmploymentIncomeIndicator: String(employment),
      IncomeType: type, IncomeTypeOtherDescription: description,
    })], label(id));
  const employers = (person.work.groups.jobs ?? []).map((job, index) => {
    const id = `EMPLOYER_${personId}_${index + 1}`;
    const hasSeparateBusinessIncome = job.selfEmployed === "Yes" && Boolean(job.business);
    const reportedPriorIncome = [job.base, job.overtime, job.bonus, job.commission, job.military, job.other, job.business].filter(Boolean);
    const monthlyIncome = job.status === "Previous" && reportedPriorIncome.length
      ? reportedPriorIncome.reduce((sum, value) => sum + Number(value), 0).toFixed(2)
      : hasSeparateBusinessIncome ? job.business : undefined;
    if (job.status === "Current") {
      const pay = [
        ["Base", job.base], ["Overtime", job.overtime], ["Bonus", job.bonus], ["Commissions", job.commission],
        ["Other", job.military, "Military entitlements"], ["Other", job.other, "Other employment income"],
      ];
      for (const [type, amount, description] of pay) {
        if (!amount) continue;
        const payId = `INCOME_${personId}_${incomeItems.length + 1}`;
        incomeItems.push(income(payId, type, amount, true, description));
        relationships.push(relationship(payId, id, "CURRENT_INCOME_ITEM_IsAssociatedWith_EMPLOYER"));
      }
    }
    return container("EMPLOYER", [
      container("LEGAL_ENTITY", [
        container("CONTACTS", [container("CONTACT", [container("CONTACT_POINTS", [contactPoint("phone", job.phone, "Work")])])]),
        fields("LEGAL_ENTITY_DETAIL", { FullName: job.employer }),
      ]),
      mismoAddress(readAddress(job.address)), fields("EMPLOYMENT", {
        EmploymentBorrowerSelfEmployedIndicator: indicator(job.selfEmployed), EmploymentEndDate: job.end,
        EmploymentMonthlyIncomeAmount: monthlyIncome, EmploymentPositionDescription: job.position, EmploymentStartDate: job.start, EmploymentStatusType: job.status,
        EmploymentTimeInLineOfWorkMonthsCount: job.industryMonths, EmploymentTimeInLineOfWorkYearsCount: job.industryYears,
        OwnershipInterestType: job.ownership === "Less than 25%" ? "LessThan25Percent" : job.ownership === "25% or more" ? "GreaterThanOrEqualTo25Percent" : undefined,
        SpecialBorrowerEmployerRelationshipIndicator: indicator(job.related),
      }),
    ], label(id));
  });
  for (const row of person.work.groups.income ?? []) {
    const type = otherIncome[row.type];
    if (type) incomeItems.push(income(`INCOME_${personId}_${incomeItems.length + 1}`, type, row.monthly, false, row.description));
  }
  return {
    income: container("CURRENT_INCOME", [container("CURRENT_INCOME_ITEMS", incomeItems)]),
    employers: container("EMPLOYERS", employers),
  };
}

export function mismoBorrower(person: BorrowerDetails, draft: ApplicationDraft, name: ExportName, index: number, relationships: string[]) {
  const personId = String(index + 1);
  const id = `BORROWER_${personId}`;
  const identity = person.identity.fields;
  const declaration = person.declarations.fields;
  const primary = index === 0;
  const current = primary ? { street: draft.currentAddress, ...draft.currentLocation } : readAddress(identity.current);
  const prior = (person.identity.groups.prior ?? []).map((item) => residence(readAddress(item.address), item, "Prior"));
  if (primary && draft.priorAddress && !prior.length) prior.push(residence({ street: draft.priorAddress, ...draft.priorLocation }, {}, "Prior"));
  const employment = employerInfo(person, personId, relationships);

  const borrower = container("BORROWER", [
    container("BANKRUPTCIES", (declaration.chapters ?? "").split("|").filter((item) => chapters[item]).map((item) =>
      container("BANKRUPTCY", [fields("BANKRUPTCY_DETAIL", { BankruptcyChapterType: chapters[item] })]))),
    fields("BORROWER_DETAIL", {
      BorrowerBirthDate: identity.birthDate, BorrowerClassificationType: primary ? "Primary" : "Secondary",
      DependentCount: identity.dependentCount, MaritalStatusType: identity.marital,
      SelfDeclaredMilitaryServiceIndicator: indicator(person.military.fields.served),
    }),
    employment.income,
    container("DECLARATION", [fields("DECLARATION_DETAIL", {
      BankruptcyIndicator: indicator(declaration.bankruptcy), CitizenshipResidencyType: citizenship[identity.citizenship],
      HomeownerPastThreeYearsType: declaration.owned, IntentToOccupyType: declaration.primary,
      OutstandingJudgmentsIndicator: indicator(declaration.judgments), PartyToLawsuitIndicator: indicator(declaration.lawsuit),
      PresentlyDelinquentIndicator: indicator(declaration.federalDebt), PriorPropertyDeedInLieuConveyedIndicator: indicator(declaration.deedInLieu),
      PriorPropertyForeclosureCompletedIndicator: indicator(declaration.foreclosure),
      PriorPropertyShortSaleCompletedIndicator: indicator(declaration.shortSale),
      PriorPropertyTitleType: ({ Individually: "Sole", "With spouse": "JointWithSpouse", "With another person": "JointWithOtherThanSpouse" } as Record<string, string>)[declaration.title],
      PriorPropertyUsageType: usage[declaration.ownedType],
      UndisclosedBorrowedFundsAmount: declaration.borrowedAmount, UndisclosedBorrowedFundsIndicator: indicator(declaration.borrowed),
      UndisclosedComakerOfNoteIndicator: indicator(declaration.guarantor), UndisclosedCreditApplicationIndicator: indicator(declaration.newCredit),
      UndisclosedMortgageApplicationIndicator: indicator(declaration.otherMortgage),
    })]),
    container("DEPENDENTS", (identity.dependentAges ?? "").split(/[,;\s]+/).filter((value) => /^\d{1,3}$/.test(value))
      .map((value) => fields("DEPENDENT", { DependentAgeYearsCount: value }))),
    employment.employers,
    container("RESIDENCES", [residence(current, identity, "Current"), ...prior]),
  ]);
  return container("PARTY", [
    container("INDIVIDUAL", [
      container("CONTACT_POINTS", [
        contactPoint("email", primary ? draft.email : identity.email), contactPoint("phone", primary ? draft.phone : identity.cell, "Mobile"),
        contactPoint("phone", identity.homePhone, "Home"), contactPoint("phone", identity.workPhone, "Work", identity.workExtension),
      ]),
      fields("NAME", { FirstName: name.first, LastName: name.last, MiddleName: name.middle, SuffixName: name.suffix }),
    ]),
    identity.mailingDiffers === "Yes" ? container("ADDRESSES", [mismoAddress(readAddress(identity.mailing), "Mailing")]) : "",
    container("ROLES", [container("ROLE", [borrower, partyRole("Borrower")], label(id))]),
  ]);
}

export function mismoFinances(person: BorrowerDetails, index: number, relationships: string[]) {
  const personId = index + 1;
  const borrower = `BORROWER_${personId}`;
  const related = (id: string, kind: string) => relationships.push(relationship(id, borrower, `${kind}_IsAssociatedWith_ROLE`));
  const accountAssets = [...person.finances.groups.assets ?? [], ...person.finances.groups.credits ?? []].flatMap((item, position) => {
    const type = assets[item.type];
    if (!type) return [];
    const id = `ASSET_${personId}_${position + 1}`;
    related(id, "ASSET");
    return [container("ASSET", [fields("ASSET_DETAIL", {
      AssetCashOrMarketValueAmount: item.value, AssetType: type, AssetTypeOtherDescription: type === "Other" ? item.type : undefined,
    }), namedHolder("ASSET_HOLDER", item.institution)], label(id))];
  });
  const properties = (person.realEstate.groups.properties ?? []).map((item, position) => {
    const id = `REO_${personId}_${position + 1}`;
    related(id, "ASSET");
    return container("ASSET", [
      fields("ASSET_DETAIL", { AssetType: "RealEstateOwned" }),
      container("OWNED_PROPERTY", [
        fields("OWNED_PROPERTY_DETAIL", {
          OwnedPropertyDispositionStatusType: propertyStatus[item.status], OwnedPropertyMaintenanceExpenseAmount: item.expenses,
          OwnedPropertyRentalIncomeGrossAmount: item.rent,
        }),
        container("PROPERTY", [mismoAddress(readAddress(item.address)), fields("PROPERTY_DETAIL", {
          PropertyEstimatedValueAmount: item.value, PropertyUsageType: usage[item.occupancy],
        })]),
      ]),
    ], label(id));
  });
  const debtItems = [
    ...(person.finances.groups.debts ?? []).map((item) => ({ item, liabilityType: debts[item.type], mortgageType: undefined, propertyIndex: undefined })),
    ...(person.realEstate.groups.mortgages ?? []).map((item) => ({ item, liabilityType: "MortgageLoan", mortgageType: mortgage[item.type], propertyIndex: item.property })),
  ].flatMap((item, position) => {
    if (!item.liabilityType) return [];
    const id = `LIABILITY_${personId}_${position + 1}`;
    related(id, "LIABILITY");
    if (item.propertyIndex && properties[Number(item.propertyIndex) - 1]) {
      relationships.push(relationship(`REO_${personId}_${item.propertyIndex}`, id, "ASSET_IsAssociatedWith_LIABILITY"));
    }
    return [container("LIABILITY", [fields("LIABILITY_DETAIL", {
      LiabilityMonthlyPaymentAmount: item.item.payment, LiabilityPayoffStatusIndicator: indicator(item.item.paidOff),
      LiabilityType: item.liabilityType, LiabilityUnpaidBalanceAmount: item.item.balance, MortgageType: item.mortgageType,
    }), namedHolder("LIABILITY_HOLDER", item.item.creditor)], label(id))];
  });
  const expenseItems = (person.finances.groups.expenses ?? []).flatMap((item, position) => {
    const type = expenses[item.type];
    if (!type) return [];
    const id = `EXPENSE_${personId}_${position + 1}`;
    related(id, "EXPENSE");
    return [fields("EXPENSE", { ExpenseMonthlyPaymentAmount: item.payment, ExpenseType: type }, label(id))];
  });
  return { assets: [...accountAssets, ...properties], liabilities: debtItems, expenses: expenseItems };
}

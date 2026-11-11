import { z } from "zod";

// Verified against the authenticated UWM Developer Portal on November 10, 2026.
// No default branch, contact, condition category, product or price is invented.
const contact = z.string().min(1).max(25);
export const uwmScanRequest = z.strictObject({
  entityId: contact, contactId: contact, alternativeContactId: contact.optional(),
  lockAndShop: z.boolean().optional(), teamMemberLoan: z.boolean().optional(),
  loanOriginatorType: z.enum(["Broker", "Correspondent", "Lender", "Other"]).optional(),
  correspondentReason: z.enum(["BranchNotCorrespondent", "CorrespondentNotFHAApproved", "NotLicensedInPropertyType",
    "TransitioningToCorrespondent", "WarehouseLineProductTypeNotAllowed", "WarehouseLineMaxedOut"]).optional(),
  name: z.string().max(50).optional(), email: z.string().max(50).optional(),
});
export const uwmDocumentType = z.enum(["All Conditions", "Underwriter II Conditions", "Senior Underwriter Conditions",
  "Project Review Conditions", "Disclosures/Compliance Conditions", "Master Conditions"]);
const attachment = z.strictObject({ documentType: uwmDocumentType, comments: z.string(),
  files: z.array(z.strictObject({ documentId: z.number().int().positive() })).min(1),
  conditions: z.array(z.string().min(1)).min(1),
});
export const uwmConditionSubmission = z.strictObject({ attachments: z.array(attachment).min(1) });
export const uwmConditionAttachments = z.strictObject({ attachments: z.array(attachment.extend({
  attachmentId: z.number().int().nonnegative().nullable(), revisionId: z.string().min(1).nullable(),
}).refine(value => value.attachmentId ? value.revisionId !== null : value.revisionId === null,
  "Existing attachments require their current revision; new attachments require a null revision.")).min(1) });
export const uwmConditionAcknowledgment = z.object({ documentTypes: z.array(uwmDocumentType), errors: z.array(z.string()) });
export const uwmDocumentName = z.string().min(1).max(255)
  .regex(/^[^/\\\u0000-\u001f]+\.(docx?|txt|tiff?|gif|jpe?g|png|xlsx?|csv|heif|heic|bmp|pdf)$/i);

export const uwmLoanNumber = z.string().regex(/^\d{10}$/);
const int32 = z.number().int().min(0).max(2147483647);
const nullableText = z.string().nullable();
export const uwmBrokerAssociations = z.object({ entityId: int32, alias2: nullableText, name: nullableText,
  branches: z.array(z.object({ entityId: int32, alias2: nullableText, name: nullableText, correspondent: z.boolean(),
    accountExecutive: z.object({ contactId: int32, firstName: nullableText, lastName: nullableText, emailAddress: nullableText }).nullable(),
    contacts: z.array(z.object({ contactId: int32, firstName: nullableText, lastName: nullableText, licenseNumber: nullableText })),
  })) });

export function requireUwmBranchContact(associations: z.infer<typeof uwmBrokerAssociations>, scan: z.infer<typeof uwmScanRequest>) {
  const branch = associations.branches.find(item => String(item.entityId) === scan.entityId);
  if (!branch || !branch.contacts.some(item => String(item.contactId) === scan.contactId)) {
    throw new Error("Choose a branch and loan officer returned by your UWM account.");
  }
  return branch;
}

export const uwmScanResponse = z.object({ success: z.literal(true), errors: z.null(), validationErrors: z.null().optional(),
  data: z.object({ transferStatus: z.string().min(1), fields: z.array(z.object({
    required: z.boolean(), validated: z.boolean(),
  }).passthrough()) }) });
export const uwmAmendRequest = z.strictObject({ transferStatus: z.enum(["New", "Validating"]),
  fields: z.array(z.object({ id: z.string().min(1), xPath: z.string().min(1), value: z.unknown(),
    required: z.boolean(), validated: z.boolean() }).passthrough()).min(1) });

export const uwmAttachmentList = z.object({ attachments: z.array(attachment.extend({
  attachmentId: int32.positive(), revisionId: z.string().min(1), SubmittedDateTime: z.string().nullable(),
})) });

export const uwmCommitment = z.union([z.literal(-1), ...[8,11,15,22,30,45,60,90,120,150,180,270,365].map(n => z.literal(n))]);
const buydown = z.enum(["None", "Buydown 1-0", "Buydown 1-0 LLPA", "Buydown 1-1", "Buydown 1-1 LLPA",
  "Buydown 2-1", "Buydown 2-1 LLPA", "Buydown 3-2-1", "Buydown 3-2-1 LLPA"]);
export const uwmLockRequest = z.strictObject({
  productId: int32.positive(), calculationTypeId: z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3)]),
  targetRate: z.number(), targetPrice: z.number(), targetCash: z.number(), commitmentPeriod: uwmCommitment,
  compensationType: z.union([z.literal(0),z.literal(1),z.literal(2)]), waiveUWFeeIndicator: z.boolean(), escrowWaiver: z.boolean(),
  waiveEscrowOption: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),
  flexTerm: z.number().int().refine(n => (n >= 8 && n <= 30) || n === 40),
  correspondentDiscountFee: z.number().nullable().optional(), correspondentDiscountPercent: z.number().nullable().optional(),
  tracTypeId: z.union([z.literal(0),z.literal(2),z.literal(3)]), loanShieldTypeId: z.enum(["0","1","2"]),
  loppBasisPoints: int32.max(20), cypBasisPoints: int32.max(40), paPlusTypeId: int32.max(8).nullable().optional(),
  applicationSourceId: z.enum(["0","2","3","4","5","6","7"]).nullable().optional(),
  waiveTRACFee: z.boolean().nullable().optional(), waiveTRACPlusFee: z.boolean().nullable().optional(),
  waivePAPlusProcessingFee: z.boolean().nullable().optional(), buydownTypeId: buydown,
  firstTimeHomebuyerId: z.enum(["1","2"]), freeLockExtensionDays: int32,
  tracPlusIncentiveOptionId: z.enum(["1","2","3"]).nullable().optional(), feeTypeOptionId: z.enum(["1","2","3","4"]).optional(),
});
export const uwmRelockRequest = uwmLockRequest.extend({ isQuickLock: z.boolean() });
export const uwmLockAcknowledgment = z.object({ LockRateItems: z.array(z.object({
  ItemId: z.string(), Label: z.string(), Value: z.string(), Display: z.number().int(), DisplayFormat: z.number().int(),
})).min(1) }).refine(value => value.LockRateItems.some(item => item.ItemId === "LockSuccessFul" && item.Value === "True") &&
  !value.LockRateItems.some(item => item.ItemId === "LockSuccessFul" && item.Value !== "True"));
export const uwmFloatAcknowledgment = z.object({ statusCode: z.literal(200), success: z.literal(true),
  errorMessage: z.null(), errorMessages: z.array(z.string()).max(0).nullable(), message: z.string().nullable() });
export const uwmCancelAcknowledgment = z.object({ ItemId: z.union([z.literal(1),z.literal("1")]),
  Title: z.literal("Success!"), Messages: z.array(z.string()) });

const pricingOptions = {
  loanNumber: uwmLoanNumber.nullable().optional(), loanShield: z.enum(["Yes","No"]),
  titleSelection: z.enum(["TRAC+","TRAC Lite","Traditional Lender's Policy"]), commitmentPeriodDays: uwmCommitment,
  waiveUnderwritingFee: z.boolean(), waiveOption: z.enum(["No Waiver","Waive Taxes & Hazard Insurance","Waive Hazard Insurance Only","Waive Taxes Only"]),
  fundingFeeType: z.enum(["Financed","Non-Financed","Exempt"]).nullable().optional(),
  mortgageInsuranceTypes: z.array(z.string().min(1)).nullable().optional(), vaUseTypes: z.array(z.enum(["First Use","Subsequent Use"])).nullable().optional(),
  exactType: z.enum(["TargetRate","TargetCash"]).nullable().optional(), exactValue: z.number().nullable().optional(),
  processingOption: z.array(z.string().min(1)).nullable().optional(), buydownTypeOption: buydown.nullable().optional(),
  waiveTRACFee: z.boolean().nullable().optional(), loanAmount: z.number().positive().max(25000000).nullable().optional(),
  salesPrice: z.number().positive().max(25000000).nullable().optional(), appraisedValue: z.number().positive().max(25000000).nullable().optional(),
  isFirstTimeHomeBuyer: z.boolean().nullable().optional(), compensationPayerType: z.enum(["Lender paid","Borrower paid"]).nullable().optional(),
  waivePAPlusFee: z.boolean().optional(), loanPurposeType: z.enum(["Refinance","Purchase","Construction Purchase","Construction Refinance"]).nullable().optional(),
  refinancePurposeType: z.string().min(1).nullable().optional(),
  tracPlusCreditOption: z.enum(["Apply Credit as an LLPA","Send Check to Borrower","Apply Credit in Fees"]).nullable().optional(),
};
const pairedTarget = (v: { exactType?: string | null; exactValue?: number | null }) => (v.exactType != null) === (v.exactValue != null);
export const uwmProductSearch = z.strictObject({ ...pricingOptions, excludeInvalidProducts: z.boolean(),
  exactPriceValue: z.number().nullable().optional() }).refine(pairedTarget, "Specify both target type and target value.");
export const uwmFloatRequest = z.strictObject({ ...pricingOptions, productId: int32.positive(),
  interestRate: z.number().min(1).refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001),
  buydownAlias: z.literal("None").nullable(), actualTerm: int32.positive().multipleOf(12), isUWMAppraisalDirectSelected: z.boolean(),
  mortgageInsuranceBrandId: z.string().optional(), mortgageInsuranceProductId: int32.nullable().optional(), mortgageInsuranceFactor: z.number().optional(),
  occupancy: z.enum(["Primary Residence","Secondary Residence","Investment Property"]).nullable().optional(),
  documentationType: z.enum(["Full","Streamline"]).nullable().optional(), monthsOfReserves: int32.optional(),
  flexTerms: z.array(z.string()).nullable().optional(), propertyType: z.string().nullable().optional(), propertyState: z.string().length(2).nullable().optional(),
  secondLoanAmount: z.number().nullable().optional(), numberOfUnits: int32.min(1).max(4).nullable().optional(),
  zipCode: z.string().nullable().optional(), county: z.string().nullable().optional(),
  prepaymentPenalty: z.enum(["None","1 Year","2 Year","3 Year"]).nullable().optional(), isRuralProperty: z.boolean().optional(),
  loanFICO: z.number().int().min(580).max(850).nullable().optional(), loanTerms: z.array(z.string()).nullable().optional(), loanTypes: z.array(z.string()).nullable().optional(),
  lienPosition: z.enum([" ","1st","2nd"]).nullable().optional(), firstLienLoanAmount: z.number().nullable().optional(), totalLineAmount: int32.nullable().optional(),
  attachedType: z.enum(["Detached","Attached","Semi-Detached"]).nullable().optional(),
  secondaryFinancingSource: z.enum(["Government","Non-Profit","Family/Relative","Employer/Other"]).nullable().optional(),
  biltBorrowerLoyalty: z.enum(["1","2","3","4"]).nullable().optional(), cypBasisPoints: int32.max(40).optional(),
  waivableFees: z.array(z.enum(["Underwriting Fee","TRAC+ Fee","PA+ Fee"])).nullable().optional(), creditModel: z.enum(["FICO","VantageScore"]).nullable().optional(),
  constructionPeriod: int32.nullable().optional(), acquisitionDate: z.string().nullable().optional(), valueOfLot: z.number().nullable().optional(), costOfImprovements: z.number().nullable().optional(),
}).refine(pairedTarget, "Specify both target type and target value.");

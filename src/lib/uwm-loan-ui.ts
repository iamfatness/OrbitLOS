import { uwmFloatRequest, uwmLockRequest, uwmProductSearch, uwmRelockRequest } from "./uwm-public-contracts";

export type RateAction = "products" | "float" | "lock" | "relock" | "extend-lock" | "cancel-lock";
export type UwmField = { name: string; label: string; type?: "number" | "boolean"; options?: [string, string][]; optional?: boolean };
const choices = (values: string[]) => values.map(value => [value, value] as [string, string]);
const period = choices(["8","11","15","22","30","45","60","90","120","150","180","270","365"]);
const common: UwmField[] = [
  { name:"loanShield", label:"Loan Shield", options:[["Yes","Yes"],["No","No"]] },
  { name:"titleSelection", label:"Title service", options:choices(["Traditional Lender's Policy","TRAC+","TRAC Lite"]) },
  { name:"commitmentPeriodDays", label:"Commitment period (days)", type:"number", options:period },
  { name:"waiveUnderwritingFee", label:"Waive underwriting fee", type:"boolean" },
  { name:"waiveOption", label:"Escrow waiver", options:choices(["No Waiver","Waive Taxes & Hazard Insurance","Waive Hazard Insurance Only","Waive Taxes Only"]) },
  { name:"fundingFeeType", label:"Funding fee treatment", optional:true, options:choices(["Financed","Non-Financed","Exempt"]) },
  { name:"compensationPayerType", label:"Compensation paid by", optional:true, options:choices(["Lender paid","Borrower paid"]) },
];
const lock: UwmField[] = [
  { name:"productId", label:"UWM product number", type:"number" },
  { name:"calculationTypeId", label:"Pricing target", type:"number", options:[["0","No target"],["1","Rate"],["2","Price"],["3","Cash"]] },
  { name:"targetRate", label:"Target rate (%)", type:"number" }, { name:"targetPrice", label:"Target price", type:"number" },
  { name:"targetCash", label:"Target cash ($)", type:"number" },
  { name:"commitmentPeriod", label:"Commitment period (days)", type:"number", options:period },
  { name:"compensationType", label:"Compensation paid by", type:"number", options:[["0","Borrower"],["1","Lender"],["2","Unknown"]] },
  { name:"waiveUWFeeIndicator", label:"Waive underwriting fee", type:"boolean" }, { name:"escrowWaiver", label:"Escrow waiver applies", type:"boolean" },
  { name:"waiveEscrowOption", label:"Escrow waiver", type:"number", options:[["1","No waiver"],["2","Taxes only"],["3","Hazard insurance only"],["4","Taxes and hazard insurance"]] },
  { name:"flexTerm", label:"Loan term (years)", type:"number" },
  { name:"tracTypeId", label:"Title service", type:"number", options:[["0","Traditional lender policy"],["2","TRAC+"],["3","TRAC Lite"]] },
  { name:"loanShieldTypeId", label:"Loan Shield", options:[["0","None"],["1","5 years"],["2","10 years"]] },
  { name:"loppBasisPoints", label:"LO Partner Points (basis points)", type:"number" }, { name:"cypBasisPoints", label:"CYP basis points", type:"number" },
  { name:"buydownTypeId", label:"Buydown", options:choices(["None","Buydown 1-0","Buydown 1-0 LLPA","Buydown 1-1","Buydown 1-1 LLPA","Buydown 2-1","Buydown 2-1 LLPA","Buydown 3-2-1","Buydown 3-2-1 LLPA"]) },
  { name:"firstTimeHomebuyerId", label:"First-time homebuyer", options:[["1","No"],["2","Yes"]] },
  { name:"freeLockExtensionDays", label:"Free extension days", type:"number" },
  { name:"correspondentDiscountFee", label:"Correspondent discount ($)", type:"number", optional:true },
  { name:"correspondentDiscountPercent", label:"Correspondent discount (%)", type:"number", optional:true },
  { name:"paPlusTypeId", label:"Processing service", type:"number", optional:true, options:[["0","In-house"],["1","PA+ Full Service"],["2","PA+ Setup"],["3","PA+ Underwriting"],["4","PA+ Closing"],["5","Third-party processor"],["6","Setup and underwriting"],["7","Setup and closing"],["8","Underwriting and closing"]] },
  { name:"waiveTRACFee", label:"Waive TRAC fee", type:"boolean", optional:true },
  { name:"waiveTRACPlusFee", label:"Waive TRAC+ fee", type:"boolean", optional:true },
  { name:"waivePAPlusProcessingFee", label:"Waive PA+ fee", type:"boolean", optional:true },
  { name:"tracPlusIncentiveOptionId", label:"TRAC+ credit", optional:true, options:[["1","Apply as LLPA"],["2","Send check to borrower"],["3","Apply in fees"]] },
  { name:"feeTypeOptionId", label:"Bilt fee treatment", optional:true, options:[["1","Opt out"],["2","Comp from wire"],["3","LO Partner Points"],["4","LLPA"]] },
];
export function uwmRateFields(action: RateAction): UwmField[] {
  if (action === "cancel-lock") return [];
  if (action === "products") return [...common, {name:"excludeInvalidProducts",label:"Only eligible products",type:"boolean"}];
  if (action === "float") return [...common,
    {name:"productId",label:"UWM product number",type:"number"}, {name:"interestRate",label:"Selected rate (%)",type:"number"},
    {name:"actualTerm",label:"Loan term (months)",type:"number"}, {name:"isUWMAppraisalDirectSelected",label:"Use Appraisal Direct",type:"boolean"},
    {name:"mortgageInsuranceBrandId",label:"Mortgage insurance provider number",optional:true},
    {name:"mortgageInsuranceProductId",label:"Mortgage insurance product number",type:"number",optional:true},
    {name:"mortgageInsuranceFactor",label:"Mortgage insurance factor",type:"number",optional:true}];
  return [...lock, ...(action === "lock" ? [] : [{name:"isQuickLock",label:"Quick Lock",type:"boolean" as const}])];
}
export function uwmRateBody(action: RateAction, values: Record<string, string>) {
  const body: Record<string, unknown> = {};
  for (const field of uwmRateFields(action)) {
    const value = values[field.name]?.trim() ?? "";
    if (!value) { if (field.optional) continue; throw new Error(`Choose or enter ${field.label.toLowerCase()}.`); }
    if (field.type === "boolean" && !["true","false"].includes(value)) throw new Error(`Choose ${field.label.toLowerCase()}.`);
    body[field.name] = field.type === "number" ? Number(value) : field.type === "boolean" ? value === "true" : value;
  }
  if (action === "cancel-lock") return body;
  if (action === "float") body.buydownAlias = "None"; // Required constant in UWM's float contract.
  const schema = action === "products" ? uwmProductSearch : action === "float" ? uwmFloatRequest : action === "lock" ? uwmLockRequest : uwmRelockRequest;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0], field = uwmRateFields(action).find(field => field.name === issue.path[0]);
    throw new Error(`Check ${field?.label.toLowerCase() ?? "the selected terms"}: ${issue.message}`);
  }
  return parsed.data;
}
export const uwmActionLabels: Record<string, string> = {
  "prepare-import":"Check submission", "amend-import":"Save corrections", "commit-import":"Submit loan to UWM",
  "upload-document":"Upload document", "attach-documents":"Attach documents", "submit-documents":"Send to underwriting",
  products:"Find UWM products", float:"Float product", lock:"Request rate lock", relock:"Request relock",
  "extend-lock":"Request lock extension", "cancel-lock":"Cancel rate lock", "reconcile-request":"Record lender verification",
};

import { z } from "zod";
import { sampleNonAgencyMetrics, type PricingResult, type PricingScenario } from "./pricing-model";

export interface PricingProvider {
  quote(scenario: PricingScenario): Promise<PricingResult>;
}

export type PricingFailure = "configuration" | "unsupported" | "authentication" | "throttled" | "unavailable" | "invalid-response" | "rejected";

export class PricingError extends Error {
  readonly code: PricingFailure;

  constructor(code: PricingFailure, message: string) {
    super(message);
    this.code = code;
  }
}

const providerName = "UWM Easy Qualifier";
const mockNotice = "Sample pricing for demonstration. Principal and interest exclude taxes, insurance and other costs. Rates and prices are illustrative.";
const nonAgencyNotice = "Sample coverage and income calculations are illustrations. UWM program eligibility and Easy Qualifier results require a live lender review.";

export function unsupportedPricingResult(simulated: boolean, notice: string): PricingResult {
  return { provider: providerName, mode: simulated ? "mock" : "stage", outcome: "unsupported",
    reference: null, offers: [], notices: [notice] };
}

export function principalAndInterest(amount: number, rate: number, years: number) {
  const monthlyRate = rate / 1200;
  return Math.round(amount * monthlyRate / (1 - (1 + monthlyRate) ** (-years * 12)) * 100) / 100;
}

const mockPricing: PricingProvider = {
  async quote(scenario) {
    const basis = Math.min(scenario.propertyValue, scenario.purpose === "Purchase" ? scenario.purchasePrice ?? scenario.propertyValue : scenario.propertyValue);
    const nonAgency = scenario.nonAgency;
    let base = 6.125 + (scenario.creditScore < 740 ? 0.25 : 0) + (scenario.loanAmount / basis > 0.8 ? 0.25 : 0)
      + (scenario.occupancy === "Investment property" ? 0.5 : scenario.occupancy === "Second home" ? 0.25 : 0)
      + (scenario.propertyType === "Attached condominium" ? 0.125 : 0);
    if (nonAgency) {
      base += 0.875 + (nonAgency.refinanceType === "Cash out" ? 0.25 : 0) + (nonAgency.reservesMonths < 6 ? 0.125 : 0);
      const sample = sampleNonAgencyMetrics(nonAgency, principalAndInterest(scenario.loanAmount, base, 30));
      if (sample.program === "DSCR" ? sample.dscr < 1.15 : sample.dti > 0.43) base += 0.25;
    }
    const options = [
      { years: 30, rate: base - 0.25, percent: 1, label: "Discount points" },
      { years: 30, rate: base, percent: 0, label: "Rate adjustment" },
      { years: 30, rate: base + 0.25, percent: -0.75, label: "Lender credit" },
    ];
    if (!nonAgency) options.push({ years: 15, rate: base - 0.625, percent: 0.5, label: "Discount points" });
    return {
      provider: providerName, mode: "mock", reference: null, notices: nonAgency ? [mockNotice, nonAgencyNotice] : [mockNotice],
      offers: options.map(({ years, rate, percent, label }, index) => ({
        id: `sample-${index}`, product: `${nonAgency?.program ?? "Conventional"} ${years}-year fixed`, years, rate, apr: null,
        principalAndInterest: principalAndInterest(scenario.loanAmount, rate, years),
        pricingPercent: percent, pricingAmount: Math.round(scenario.loanAmount * percent) / 100, pricingLabel: label,
      })),
    };
  },
};

const metrics = z.object({ value: z.number().nonnegative(), display: z.boolean().optional() });
const eqPoint = z.object({
  interestRate: metrics, principalAndInterest: metrics, annualPercentageRate: z.number().nonnegative().nullish(),
  finalPrice: z.object({ percent: z.number(), amount: z.number(), display: z.boolean().optional() }).nullish(),
});
const eqQuotes = z.object({
  validQuoteItems: z.array(z.object({
    mortgageProductId: z.number(), mortgageProductName: z.string(),
    actualTermYears: z.number().positive(), quotePricePoints: z.array(z.unknown()),
  })),
  errorMessages: z.array(z.string()).nullish(),
  obfuscatedScenarioId: z.number().nullish(),
});
const eqDisclaimers = z.array(z.object({ DisclaimerHeader: z.string(), DisclaimerDescription: z.array(z.string()) }));
const eqToken = z.object({ access_token: z.string().min(1) });

const eqStage = "https://stg.api.uwm.com";
const occupancyCodes = { "Primary residence": "1", "Investment property": "2", "Second home": "3" };

async function readEq(response: Response) {
  if (response.status === 429) throw new PricingError("throttled", "UWM is limiting pricing requests. Try again in a minute.");
  if (response.status === 401 || response.status === 403) throw new PricingError("authentication", "UWM stage denied access. Check the EQ credentials and permissions.");
  if (!response.ok) throw new PricingError("unavailable", "UWM stage could not return pricing for this scenario.");
  try {
    return await response.json();
  } catch {
    throw new PricingError("invalid-response", "UWM stage returned a pricing response Orbit could not read.");
  }
}

async function requestEq(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    throw new PricingError("unavailable", "Orbit could not reach UWM stage. Try pricing again.");
  }
}

export function pricingProvider(env: Record<string, string | undefined> = process.env): PricingProvider {
  env = { ...env, UWM_EQ_CLIENT_ID: env.UWM_CLIENT_ID || env.UWM_EQ_CLIENT_ID,
    UWM_EQ_CLIENT_SECRET: env.UWM_CLIENT_SECRET || env.UWM_EQ_CLIENT_SECRET };
  const mode = env.ORBIT_PRICING_MODE;
  if (!mode || mode === "mock") return mockPricing;
  if (mode !== "uwm-stage") throw new PricingError("configuration", "Pricing mode is unavailable. Check the workspace configuration.");
  return {
    async quote(scenario) {
      if (scenario.nonAgency) throw new PricingError("unsupported", `UWM stage pricing is unavailable for ${scenario.nonAgency.program}. Use a manual lender quote for this scenario.`);
      if (!env.UWM_EQ_CLIENT_ID || !env.UWM_EQ_CLIENT_SECRET) {
        throw new PricingError("configuration", "UWM stage pricing needs an EQ client ID and secret.");
      }
      const token = eqToken.safeParse(await readEq(await requestEq("https://sso.uwm.com/adfs/oauth2/token", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          grant_type: "client_credentials", client_id: env.UWM_EQ_CLIENT_ID,
          client_secret: env.UWM_EQ_CLIENT_SECRET, scope: "https://api.uwm.com/loanorigination-stg",
        }),
      })));
      if (!token.success) throw new PricingError("invalid-response", "UWM stage returned an invalid token response.");
      const headers = { Authorization: `Bearer ${token.data.access_token}`, "Content-Type": "application/json" };
      const [quoteResponse, disclaimerResponse] = await Promise.all([
        requestEq(`${eqStage}/public/products/v1/mortgage-price-quotes`, {
          method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({
            brokerAlias: env.UWM_EQ_BROKER_ALIAS || undefined, loanOfficer: env.UWM_EQ_LO_EMAIL || undefined,
            borrowerName: "Orbit Stage Scenario", loanTypeIds: ["0"], purposeTypeId: scenario.purpose === "Purchase" ? "1" : "3",
            refinancePurposeId: scenario.purpose === "Refinance" ? "Rate And Term Reduction-CONV" : undefined,
            salesPrice: scenario.purpose === "Purchase" ? scenario.purchasePrice ?? undefined : undefined,
            appraisedValue: scenario.propertyValue, loanAmount: scenario.loanAmount, occupancyTypeId: occupancyCodes[scenario.occupancy],
            propertyTypeId: scenario.propertyType === "Single family" ? "22" : "34",
            attachmentTypeId: scenario.propertyType === "Attached condominium" ? "1" : undefined,
            propertyZipCode: scenario.zip, creditModel: "1", creditScore: scenario.creditScore, monthlyIncome: scenario.monthlyIncome,
            firstTimeHomeBuyer: scenario.purpose === "Purchase" ? scenario.firstTimeBuyer : undefined,
          }),
        }),
        requestEq(`${eqStage}/public/products/v1/disclaimers`, { headers, redirect: "error", signal: AbortSignal.timeout(10_000) }),
      ]);
      const quotes = eqQuotes.safeParse(await readEq(quoteResponse));
      if (!quotes.success) throw new PricingError("invalid-response", "UWM stage returned a pricing response Orbit could not read.");
      if (quotes.data.errorMessages?.length) throw new PricingError("rejected", "UWM stage could not price these inputs. Review the scenario before retrying.");
      const disclaimers = eqDisclaimers.safeParse(await readEq(disclaimerResponse));
      if (!disclaimers.success || !disclaimers.data.length) throw new PricingError("invalid-response", "UWM stage pricing disclosures could not be loaded.");
      const offers = quotes.data.validQuoteItems.flatMap((product, productIndex) =>
        product.quotePricePoints.flatMap((item, pointIndex) => {
          const parsed = eqPoint.safeParse(item);
          if (!parsed.success) return [];
          const point = parsed.data;
          if (point.interestRate.display === false || point.principalAndInterest.display === false) return [];
          return [{
            id: `${product.mortgageProductId}-${productIndex}-${pointIndex}`, product: product.mortgageProductName, years: product.actualTermYears,
            rate: point.interestRate.value, apr: point.annualPercentageRate || null, principalAndInterest: point.principalAndInterest.value,
            pricingPercent: point.finalPrice?.display === false ? null : point.finalPrice?.percent ?? null,
            pricingAmount: point.finalPrice?.display === false ? null : point.finalPrice?.amount ?? null, pricingLabel: "EQ final price",
          }];
        }));
      return {
        provider: providerName, mode: "stage", reference: quotes.data.obfuscatedScenarioId ? String(quotes.data.obfuscatedScenarioId) : null,
        offers: offers.slice(0, 40), notices: disclaimers.data.flatMap((item) => item.DisclaimerDescription),
      };
    },
  };
}

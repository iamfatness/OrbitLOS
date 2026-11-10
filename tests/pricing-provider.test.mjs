import assert from "node:assert/strict";
import test from "node:test";
import "../scripts/workspace-baseline.mjs";

const { pricingScenario } = await import("../src/lib/pricing-model.ts");
const { PricingError, pricingProvider } = await import("../src/lib/pricing-provider.ts");

test("UWM stage rejects unsupported programs before network calls while demo pricing stays simulated", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("Unsupported programs must not reach UWM"));
  const common = { monthlyTaxes: 400, monthlyInsurance: 150, monthlyHoa: 0, reservesMonths: 6, refinanceType: null };
  const programs = [
    { ...common, program: "DSCR", monthlyRent: 2800 },
    { ...common, program: "Bank statement", source: { type: "Personal" }, statementMonths: 12,
      averageMonthlyDeposits: 10000, monthlyDebts: 400, selfEmployed: true },
  ];
  for (const nonAgency of programs) {
    const scenario = pricingScenario.parse({ purpose: "Purchase", loanAmount: 250000, propertyValue: 350000, purchasePrice: 350000,
      zip: "48067", creditScore: 750, occupancy: "Investment property", propertyType: "Single family", firstTimeBuyer: false, nonAgency });
    await assert.rejects(pricingProvider({ ORBIT_PRICING_MODE: "uwm-stage", UWM_EQ_CLIENT_ID: "fixture", UWM_EQ_CLIENT_SECRET: "fixture" }).quote(scenario),
      (error) => error instanceof PricingError && error.code === "unsupported" && error.message.includes(nonAgency.program));
    const sample = await pricingProvider({ ORBIT_PRICING_MODE: "mock" }).quote(scenario);
    assert.equal(sample.mode, "mock");
    assert.ok(sample.offers.every(({ product }) => product.startsWith(nonAgency.program)));
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("the EQ sandbox adapter maps conventional quotes and reports provider failures without sample pricing", async (t) => {
  const scenario = pricingScenario.parse({ purpose: "Purchase", loanAmount: 250000, propertyValue: 350000, purchasePrice: 340000,
    zip: "48067", creditScore: 750, monthlyIncome: 7500, occupancy: "Primary residence", propertyType: "Single family", firstTimeBuyer: true });
  let quoteFailure;
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.redirect, "error");
    if (url === "https://sso.uwm.com/adfs/oauth2/token") {
      assert.equal(options.body.get("scope"), "https://api.uwm.com/loanorigination-stg");
      return Response.json({ access_token: "synthetic-token" });
    }
    assert.equal(options.headers.Authorization, "Bearer synthetic-token");
    if (url === "https://stg.api.uwm.com/public/products/v1/disclaimers") {
      return Response.json([{ DisclaimerHeader: "Fixture", DisclaimerDescription: ["Fictional sandbox terms"] }]);
    }
    assert.equal(url, "https://stg.api.uwm.com/public/products/v1/mortgage-price-quotes");
    const request = JSON.parse(options.body);
    assert.deepEqual([request.loanTypeIds, request.purposeTypeId, request.salesPrice, request.propertyZipCode, request.borrowerName],
      [["0"], "1", 340000, "48067", "Orbit Stage Scenario"]);
    if (quoteFailure instanceof Error) throw quoteFailure;
    if (quoteFailure) return quoteFailure;
    const visible = { interestRate: { value: 6.25 }, principalAndInterest: { value: 1539.29 },
      annualPercentageRate: 6.5, finalPrice: { percent: 0.25, amount: 625 } };
    return Response.json({ obfuscatedScenarioId: 42, validQuoteItems: [{ mortgageProductId: 7,
      mortgageProductName: "Fixture conventional", actualTermYears: 30, quotePricePoints: [
        visible, { ...visible, interestRate: { value: 6.5, display: false } },
      ] }] });
  });
  assert.throws(() => pricingProvider({ ORBIT_PRICING_MODE: "invalid" }), { code: "configuration" });
  await assert.rejects(pricingProvider({ ORBIT_PRICING_MODE: "uwm-stage" }).quote(scenario), { code: "configuration" });
  assert.equal(fetch.mock.callCount(), 0);
  const provider = pricingProvider({ ORBIT_PRICING_MODE: "uwm-stage", UWM_EQ_CLIENT_ID: "fixture", UWM_EQ_CLIENT_SECRET: "fixture" });
  const result = await provider.quote(scenario);
  assert.deepEqual({ mode: result.mode, reference: result.reference, offers: result.offers, notices: result.notices }, {
    mode: "stage", reference: "42", notices: ["Fictional sandbox terms"], offers: [{
      id: "7-0-0", product: "Fixture conventional", years: 30, rate: 6.25, apr: 6.5, principalAndInterest: 1539.29,
      pricingPercent: 0.25, pricingAmount: 625, pricingLabel: "EQ final price",
    }],
  });
  for (const [response, code] of [
    [new Response(null, { status: 403 }), "authentication"],
    [new Response(null, { status: 429 }), "throttled"],
    [new Response("invalid JSON"), "invalid-response"],
    [Response.json({ validQuoteItems: [], errorMessages: ["Fixture rejection"] }), "rejected"],
    [new Error("Fixture timeout"), "unavailable"],
  ]) {
    quoteFailure = response;
    await assert.rejects(provider.quote(scenario), { code });
  }
});

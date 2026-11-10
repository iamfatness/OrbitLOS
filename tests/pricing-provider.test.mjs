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
      (error) => error instanceof PricingError && error.message.includes(nonAgency.program));
    const sample = await pricingProvider({ ORBIT_PRICING_MODE: "mock" }).quote(scenario);
    assert.equal(sample.mode, "mock");
    assert.ok(sample.offers.every(({ product }) => product.startsWith(nonAgency.program)));
  }
  assert.equal(fetch.mock.callCount(), 0);
});

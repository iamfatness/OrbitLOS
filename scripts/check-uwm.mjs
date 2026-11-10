import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });
const { uwmPublicToken, uwmJson } = await import("../src/lib/uwm-live.ts");
const { pricingProvider } = await import("../src/lib/pricing-provider.ts");
try {
  // Deliberately stage-only. Never prints tokens, credentials or borrower data.
  const env = { ...process.env, UWM_ENVIRONMENT: "stage", ORBIT_PRICING_MODE: "uwm-stage" };
  const token = await uwmPublicToken(env);
  const disclosures = await uwmJson("https://stg.api.uwm.com/public/products/v1/disclaimers", {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(JSON.stringify({ authentication: "ok", disclosureGroups: Array.isArray(disclosures) ? disclosures.length : 0 }));
  if (process.argv.includes("--quote")) {
    const quote = await pricingProvider(env).quote({ purpose: "Purchase", loanAmount: 300000, propertyValue: 400000,
      purchasePrice: 400000, zip: "48326", creditScore: 780, monthlyIncome: 12000,
      occupancy: "Primary residence", propertyType: "Single family", firstTimeBuyer: false });
    console.log(JSON.stringify({ pricing: quote.mode, offers: quote.offers.length, notices: quote.notices.length }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "UWM verification failed.");
  process.exitCode = 1;
}

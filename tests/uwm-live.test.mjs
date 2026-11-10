import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });
const { uwmPublicToken, uwmInsightsConnector, uwmWorkspaceEnabled } = await import("../src/lib/uwm-live.ts");
const { syncUwm } = await import("../src/lib/uwm.ts");
const { pricingProvider } = await import("../src/lib/pricing-provider.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
test("Public auth uses the verified grant and keeps environments separate", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://sso.dev.uwm.com/adfs/oauth2/token");
    assert.equal(init.body.get("grant_type"), "client_credentials");
    assert.equal(init.body.get("scope"), "https://api.uwm.com/loanorigination-int");
    assert.equal(init.redirect, "manual");
    return Response.json({ access_token: "test" });
  });
  assert.equal(await uwmPublicToken({ UWM_ENVIRONMENT: "int", UWM_CLIENT_ID: "id", UWM_CLIENT_SECRET: "secret" }), "test");
});
test("live credentials are restricted to the configured non-pilot brokerage", () => {
  const env = { UWM_BROKERAGE_ID: "shop" };
  assert.equal(uwmWorkspaceEnabled(env, null), false);
  assert.equal(uwmWorkspaceEnabled(env, { brokerage: { id: "other" } }), false);
  assert.equal(uwmWorkspaceEnabled(env, { brokerage: { id: "shop", pilot: true } }), false);
  assert.equal(uwmWorkspaceEnabled(env, { brokerage: { id: "shop" } }), true);
});
test("Public credentials never substitute for Insights credentials", () => {
  assert.throws(() => uwmInsightsConnector({ UWM_CLIENT_ID: "id", UWM_CLIENT_SECRET: "secret" }), /separate broker-shop Insights/);
});
test("GraphQL errors and empty results are not saved as successful syncs", async t => {
  for (const payload of [{ data: { Loans: [] }, errors: [{ message: "secret upstream details" }] }, { data: { Loans: [] } }]) {
    t.mock.method(globalThis, "fetch", async url => String(url).includes("microsoftonline")
      ? Response.json({ access_token: "test" }) : Response.json(payload));
    const connector = uwmInsightsConnector({ UWM_INSIGHTS_CLIENT_ID: "id", UWM_INSIGHTS_CLIENT_SECRET: "secret" });
    await assert.rejects(connector.listLoans(), /invalid pipeline|returned no loans/);
    t.mock.restoreAll();
  }
});
test("failed condition reads leave the database untouched", async () => {
  let saved = false;
  await assert.rejects(syncUwm({ transaction() { saved = true; } }, {
    async listLoans() { return { data: { Loans: [{ LoanId: "1" }] } }; },
    async getConditions() { throw new Error("unavailable"); },
  }), /unavailable/);
  assert.equal(saved, false);
});
test("live non-agency pricing fails instead of returning mock offers", async () => {
  await assert.rejects(pricingProvider({ ORBIT_PRICING_MODE: "uwm-stage" }).quote({ nonAgency: { program: "DSCR" } }), /manual lender quote/);
});
test("real brokerage sync fails closed without configuration or Insights access", async t => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: sql => sqlite.exec(sql), prepare: sql => sqlite.prepare(sql), transaction: run => run() };
  initializeStore(db, false);
  const staff = { name: "Admin", email: "admin@example.test", brokerage: { id: crypto.randomUUID(), role: "Admin", name: "Shop", pilot: false } };
  const missing = await executeCommand(db, { type: "sync" }, staff, undefined, [], { uwmEnvironment: {} });
  assert.match(missing.error, /Configure this brokerage/);
  const env = { UWM_BROKERAGE_ID: staff.brokerage.id };
  const denied = await executeCommand(db, { type: "sync" }, staff, undefined, [], { uwmEnvironment: env });
  assert.match(denied.error, /Insights credentials/);
  const simulation = await executeCommand(db, { type: "simulateUwmChanges" }, staff, undefined, [], { uwmEnvironment: env });
  assert.match(simulation.error, /Simulated lender actions are disabled/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM submissions").get().count, 0);
  assert.equal(sqlite.prepare("SELECT value FROM settings WHERE key = 'uwmSyncedAt'").get(), undefined);
});
test("hosted pilot pricing uses provided server credentials and saves stage offers", async t => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: sql => sqlite.exec(sql), prepare: sql => sqlite.prepare(sql), transaction: run => run() };
  initializeStore(db, false);
  const staff = { name: "Admin", email: "admin@example.test", brokerage: { id: crypto.randomUUID(), role: "Admin", name: "Pilot", pilot: true } };
  const contactId = crypto.randomUUID(), loanId = crypto.randomUUID();
  insertContact(db, { id: contactId, name: "Fictional Test", email: "", phone: "", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: "Admin", officerEmail: staff.email,
    address: "", amount: 300000, purpose: "Purchase", stage: "Application", stageSince: new Date().toISOString() });
  let tokenCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).includes("oauth2/token")) {
      tokenCalls++;
      assert.equal(init.body.get("client_id"), "public-id");
      assert.equal(init.body.get("grant_type"), "client_credentials");
      return Response.json({ access_token: "token" });
    }
    assert.equal(init.headers.Authorization, "Bearer token");
    return String(url).endsWith("disclaimers") ? Response.json([{ DisclaimerHeader: "Stage", DisclaimerDescription: ["Test quote"] }])
      : Response.json({ validQuoteItems: [{ mortgageProductId: 1, mortgageProductName: "UWM test product", actualTermYears: 30,
        quotePricePoints: [{ interestRate: { value: 6 }, principalAndInterest: { value: 1800 } }] }], obfuscatedScenarioId: 123 });
  });
  const result = await executeCommand(db, { type: "runPricing", loanId, applicationRevision: null,
    scenario: { purpose: "Purchase", loanAmount: 300000, propertyValue: 400000, purchasePrice: 400000,
      zip: "48326", creditScore: 780, monthlyIncome: 12000, occupancy: "Primary residence", propertyType: "Single family", firstTimeBuyer: false } },
    staff, undefined, [], { uwmEnvironment: { ORBIT_PRICING_MODE: "uwm-stage", UWM_CLIENT_ID: "public-id", UWM_CLIENT_SECRET: "secret" } });
  assert.equal(result.error, undefined);
  assert.equal(tokenCalls, 1);
  const saved = sqlite.prepare("SELECT mode, offers, reference FROM pricing_runs WHERE loanId = ?").get(loanId);
  assert.equal(saved.mode, "stage");
  assert.equal(saved.reference, "123");
  assert.equal(JSON.parse(saved.offers)[0].product, "UWM test product");
});

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";
const { uwmPublicToken, uwmInsightsConnector, uwmConnectionSettings, uwmWorkspaceEnabled } = await import("../src/lib/uwm-live.ts");
const { syncUwm } = await import("../src/lib/uwm.ts");
const { pricingProvider } = await import("../src/lib/pricing-provider.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { easternDate } = await import("../src/lib/client-retention.ts");
const { initializeStore, insertContact, insertLoan, insertSubmission } = await import("../src/lib/store.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const staff = { name: "Fictional admin", email: "admin@example.test",
    brokerage: { id: crypto.randomUUID(), role: "Admin", name: "Fictional shop", pilot: false } };
  return { db, staff };
}

function createLoan(db, staff) {
  const contactId = crypto.randomUUID(), loanId = crypto.randomUUID();
  insertContact(db, { id: contactId, name: "Fictional Test", email: "", phone: "", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: staff.name, officerEmail: staff.email,
    address: "", amount: 300000, purpose: "Purchase", stage: "Application", stageSince: importedAt });
  return loanId;
}

const stage = { ORBIT_PRICING_MODE: "uwm-stage", UWM_CLIENT_ID: "public-id", UWM_CLIENT_SECRET: "fixture-secret" };
const scenario = { purpose: "Purchase", loanAmount: 300000, propertyValue: 400000, purchasePrice: 400000,
  zip: "48326", creditScore: 780, monthlyIncome: 12000, occupancy: "Primary residence", propertyType: "Single family", firstTimeBuyer: false };
const importedAt = "2026-11-10T12:00:00Z";
const providerLoan = (LoanId, LoanStatusDescription = "Wholesale - Approved With Conditions") => ({
  LoanId, PrimaryBorrowerFirstName: "Fictional", PrimaryBorrowerLastName: "Borrower", ImportedDateTime: importedAt, LoanStatusDescription,
});
const noConditions = { conditionGroups: [], clearedConditions: [] };
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
test("failed condition reads leave the database untouched", async t => {
  const { db } = fixture(t);
  await assert.rejects(syncUwm(db, {
    async listLoans() { return { data: { Loans: [providerLoan("1")] } }; },
    async getConditions() { throw new Error("unavailable"); },
  }), /unavailable/);
  assert.equal(db.prepare("SELECT 1 FROM submissions").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM settings WHERE key = 'uwmSyncedAt'").get(), undefined);
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
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
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
  const request = { type: "runPricing", loanId, applicationRevision: null,
    scenario: { purpose: "Purchase", loanAmount: 300000, propertyValue: 400000, purchasePrice: 400000,
      zip: "48326", creditScore: 780, monthlyIncome: 12000, occupancy: "Primary residence", propertyType: "Single family", firstTimeBuyer: false } };
  const execution = { uwmEnvironment: { ORBIT_PRICING_MODE: "uwm-stage", UWM_CLIENT_ID: "public-id", UWM_CLIENT_SECRET: "secret" } };
  const run = (input, actor = staff) => executeCommand(db, input, actor, undefined, [], execution);
  const result = await run(request);
  assert.equal(result.error, undefined);
  assert.equal(tokenCalls, 1);
  const saved = sqlite.prepare("SELECT mode, offers, reference FROM pricing_runs WHERE loanId = ?").get(loanId);
  assert.equal(saved.mode, "stage");
  assert.equal(saved.reference, "123");
  assert.equal(JSON.parse(saved.offers)[0].product, "UWM test product");
  const calls = fetch.mock.callCount();
  assert.match((await run({ ...request, sampleOnly: true, manualLender: true })).error, /one pricing mode/);
  assert.match((await run({ ...request, sampleOnly: true }, { ...staff, brokerage: { ...staff.brokerage, pilot: false } })).error, /fictional pilot/);
  assert.equal((await run({ ...request, sampleOnly: true })).error, undefined);
  assert.equal(fetch.mock.callCount(), calls);
  assert.equal(sqlite.prepare("SELECT mode FROM pricing_runs WHERE loanId = ? ORDER BY rowid DESC LIMIT 1").get(loanId).mode, "mock");
});

test("operational workspaces reject stage quotes and simulated writes regardless of mapping", async t => {
  const { db, staff } = fixture(t);
  const loanId = createLoan(db, staff);
  const requestId = crypto.randomUUID();
  const document = { loanId, requestId, revision: 0 };
  db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, status)
    VALUES (?, ?, 'Pay stubs', '', ?, 'Received')`).run(requestId, loanId, importedAt);
  const network = t.mock.method(globalThis, "fetch", () => assert.fail("Operational actions must not reach UWM stage"));
  for (const env of [stage, { ...stage, UWM_BROKERAGE_ID: staff.brokerage.id }]) {
    const run = input => executeCommand(db, input, staff, undefined, [], { uwmEnvironment: env });
    assert.equal(uwmConnectionSettings(env, staff).pricing, "Not configured");
    assert.match((await run({ type: "runPricing", loanId, applicationRevision: null, scenario })).error, /Record a manual lender quote/);
    for (const input of [{ type: "sendApplication", loanId, revision: 0 },
      { type: "lockMockRate", loanId, floatReference: "Fictional float", days: 30 },
      { type: "runMockCredit", loanId, attemptId: crypto.randomUUID(), previousId: null, authorized: true, scenario: "ready" },
      { type: "sendConditionDocument", ...document },
      { type: "reviewDocument", ...document, decision: "Accepted", replacementNote: "", sendToMockUwm: true },
      { type: "processDocumentBatch", loanId, batchId: crypto.randomUUID(), action: "accept-and-send", reviewed: true,
        items: [{ requestId, revision: 0 }] }]) {
      assert.match((await run(input)).error, /Simulated lender actions are disabled/, input.type);
    }
  }
  assert.equal(db.prepare("SELECT status FROM document_requests WHERE id = ?").get(requestId).status, "Received");
  const accepted = await executeCommand(db, { type: "processDocumentBatch", loanId, batchId: crypto.randomUUID(), action: "accept", reviewed: true,
    items: [{ requestId, revision: 0 }] }, staff, undefined, [], { uwmEnvironment: stage });
  assert.equal(accepted.error, undefined);
  assert.equal(db.prepare("SELECT status FROM document_requests WHERE id = ?").get(requestId).status, "Accepted");
  assert.equal(db.prepare("SELECT 1 FROM uwm_document_deliveries").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM pricing_runs").get(), undefined);
  assert.equal(network.mock.callCount(), 0);
});

test("mapped admin sync persists provider observations, status and condition alerts", async t => {
  const { db, staff } = fixture(t);
  const env = { UWM_BROKERAGE_ID: staff.brokerage.id, UWM_INSIGHTS_CLIENT_ID: "insights-id", UWM_INSIGHTS_CLIENT_SECRET: "fixture-secret" };
  const loanNumber = "73507001";
  const condition = { id: "condition-1", conditionCategory: "Income", conditionDescription: "Fictional document request", isConditionUploaded: true };
  let reopened = false;
  const network = t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.startsWith("https://login.microsoftonline.com/")) {
      assert.equal(init.body.get("client_id"), "insights-id");
      assert.equal(init.body.get("grant_type"), "client_credentials");
      return Response.json({ access_token: "fixture-token", expires_in: 3600 });
    }
    assert.equal(init.headers.Authorization, "Bearer fixture-token");
    if (url === "https://api.uwm.com/brokers/insights/") {
      assert.match(JSON.parse(init.body).query, /LoanId.+LoanStatusDescription/);
      return Response.json({ data: { Loans: [providerLoan(loanNumber, reopened ? "Wholesale - Underwriting" : undefined)] } });
    }
    assert.equal(url, `https://api.uwm.com/public/underwriting/v1/loans/${loanNumber}/conditions`);
    return Response.json(reopened ? { clearedConditions: [], conditionGroups: [{ key: "Underwriting", countItems: 1,
      uploadedConditionsCount: 1, conditions: [{ ...condition, conditionSatisfactionDate: null }] }] } :
      { conditionGroups: [], clearedConditions: [{ ...condition, conditionSatisfactionDate: importedAt }] });
  });
  const run = actor => executeCommand(db, { type: "sync" }, actor, undefined, [], { uwmEnvironment: env });
  assert.match((await run({ ...staff, brokerage: { ...staff.brokerage, id: "different-shop" } })).error, /Configure this brokerage/);
  assert.match((await run({ ...staff, brokerage: { ...staff.brokerage, role: "LO" } })).error, /access to this workspace action/);
  assert.equal(network.mock.callCount(), 0);

  const synced = await run(staff);
  assert.match(synced.message, /1 imported/);
  assert.equal(synced.state.submissions[0].syncSource, "Insights");
  const before = db.prepare("SELECT submissionId, snapshotId FROM uwm_insights_observations").get();
  reopened = true;
  assert.match((await run(staff)).message, /1 refreshed.*2 new alerts/);
  assert.match((await run(staff)).message, /1 refreshed.*0 new alerts/);
  const after = db.prepare("SELECT submissionId, snapshotId FROM uwm_insights_observations").get();
  assert.equal(after.submissionId, before.submissionId);
  assert.notEqual(after.snapshotId, before.snapshotId);
  assert.deepEqual(db.prepare("SELECT kind FROM uwm_alerts ORDER BY kind").all().map(row => row.kind), ["Reopened condition", "Status changed"]);
  assert.equal(db.prepare("SELECT status FROM submissions").get().status, "Wholesale - Underwriting");
  assert.equal(db.prepare("SELECT 1 FROM mock_uwm_condition_events").get(), undefined);
  assert.equal(network.mock.callCount(), 9);
});

test("a new operational file can save manual lender terms without a provider or a sample offer", async t => {
  const { db, staff } = fixture(t);
  const loanId = createLoan(db, staff);
  const network = t.mock.method(globalThis, "fetch", () => assert.fail("Manual pricing must never contact a lender"));
  const run = (input, actor = staff) => executeCommand(db, input, actor, undefined, [], { uwmEnvironment: stage });
  const input = { type: "runPricing", loanId, applicationRevision: null, scenario, manualLender: true };
  const unrelated = { ...staff, email: "different-lo@example.test", brokerage: { ...staff.brokerage, role: "LO" } };
  assert.ok((await run(input, unrelated)).error);
  const saved = await run(input);
  assert.match(saved.message, /Add the lender’s terms/);
  const [pricing] = saved.state.pricingRuns;
  assert.equal(pricing.mode, "manual");
  assert.equal(pricing.provider, "Manual lender");
  assert.deepEqual(pricing.offers, []);
  assert.equal(pricing.reference, null);
  const today = easternDate();
  const quote = { loanId, runId: pricing.id, offerId: crypto.randomUUID() };
  const added = await run({ type: "addManualQuote", ...quote, details: { lender: "Fictional Lender", product: "30-year fixed",
    reference: "MANUAL-1", quotedOn: today, expiresOn: today, years: 30, rate: 6.125, apr: null, adjustment: 0 } });
  assert.match(added.message, /added to this pricing scenario/);
  const selected = await run({ type: "selectOffer", ...quote });
  assert.equal(selected.state.pricingRuns[0].selectedId, quote.offerId);
  assert.equal(selected.state.pricingRuns[0].offers[0].manual.reference, "MANUAL-1");
  assert.equal(network.mock.callCount(), 0);
});

test("Insights preserves manual evidence and discards a late concurrent snapshot", async t => {
  const { db, staff } = fixture(t);
  const manualLoan = createLoan(db, staff);
  insertSubmission(db, { id: "manual-file", loanId: manualLoan, lender: "UWM", externalId: "manual-reference", status: "Manually confirmed",
    conditions: [], syncedAt: null });
  const connector = loans => ({ async listLoans() { return { data: { Loans: loans } }; }, async getConditions() { return noConditions; } });
  const conflict = await syncUwm(db, connector([providerLoan("new-reference"), providerLoan("manual-reference")]));
  assert.match(conflict.error, /without verified Insights history/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM submissions").get().count, 1);
  assert.equal(db.prepare("SELECT status FROM submissions WHERE id = 'manual-file'").get().status, "Manually confirmed");
  const repeated = await syncUwm(db, connector([providerLoan("new-reference"), providerLoan("new-reference")]));
  assert.match(repeated.error, /empty or duplicate pipeline/);

  let completeRead;
  const delayed = syncUwm(db, { ...connector([providerLoan("new-reference")]),
    getConditions() { return new Promise(resolve => { completeRead = resolve; }); } });
  await Promise.resolve();
  const saved = await syncUwm(db, connector([providerLoan("new-reference", "Wholesale - Clear To Close")]));
  assert.equal(saved.imported, 1);
  completeRead(noConditions);
  assert.match((await delayed).error, /saved a newer snapshot/);
  assert.equal(db.prepare("SELECT status FROM submissions WHERE externalId = 'new-reference'").get().status, "Wholesale - Clear To Close");
});

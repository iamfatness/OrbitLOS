import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { blankApplication } = await import("../src/lib/application-model.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { feeTemplateWork } = await import("../src/lib/fee-templates.ts");
const { blankFees, borrowerFee, borrowerQuotePresentation, estimateFees, missingFees, sampleFeeLabel, saveAllocatedFeeWorksheetInput } = await import("../src/lib/quote-worksheet.ts");
const { sharedQuoteExpiry } = await import("../src/lib/shared-quote-model.ts");
const { compareQuoteCosts } = await import("../src/lib/quote-cost-comparison.ts");
const { fixedLoanSchedule } = await import("../src/lib/loan-amortization.ts");

test("direct fee contributions change borrower cost once and retain the gross fee and payee", () => {
  const scenario = { purpose: "Purchase", loanAmount: 360000 };
  const { payment } = fixedLoanSchedule({ loanAmount: 36_000_000, rate: 6.125, years: 30, upfrontCost: 0 });
  const offer = { product: "Fictional 30-year fixed", rate: 6.125, years: 30, principalAndInterest: payment / 100, pricingAmount: -50 };
  const worksheet = { fees: { origination: 50000, appraisal: 65000, creditReport: 0, settlement: 140000, government: 0, prepaid: 30000, escrow: 0, other: 0 },
    purchasePrice: 45_000_000, payoffs: null, deposit: 0, sellerCredits: 10000, otherCredits: 5000,
    allocations: { appraisal: { payee: " Fictional Valuation Co ", seller: 20000, lender: 10000, other: 5000 } } };
  const save = { type: "saveAllocatedFeeWorksheet", loanId: "loan", runId: "run", offerId: "offer", feeRevision: 0, worksheet };
  const parsed = saveAllocatedFeeWorksheetInput.parse(save).worksheet;
  const estimate = estimateFees(scenario, offer, parsed);
  assert.equal(parsed.fees.appraisal, 65000);
  assert.equal(borrowerFee(parsed, "appraisal"), 30000);
  assert.equal(estimate.closingCosts, 245000);
  assert.equal(estimate.cashToClose, 9_230_000);
  assert.equal(sampleFeeLabel(parsed, "appraisal"), "$650.00 · Borrower $300.00 · Seller $200.00 · Lender $100.00 · Other party $50.00 · Paid to Fictional Valuation Co");
  const option = { ...offer, loanAmount: scenario.loanAmount, purpose: scenario.purpose, estimate };
  assert.equal(compareQuoteCosts({ primary: option, alternatives: [] })[0].cost, 215000);
  const over = structuredClone(save);
  over.worksheet.allocations.appraisal.seller = 65001;
  assert.match(saveAllocatedFeeWorksheetInput.safeParse(over).error.issues[0].message, /exceed/);
  const unknown = structuredClone(save);
  unknown.worksheet.fees.appraisal = null;
  assert.match(saveAllocatedFeeWorksheetInput.safeParse(unknown).error.issues[0].message, /positive appraisal/);
  const refi = structuredClone(save);
  refi.worksheet.purchasePrice = null;
  refi.worksheet.payoffs = 35_000_000;
  assert.match(saveAllocatedFeeWorksheetInput.safeParse(refi).error.issues[0].message, /seller-paid/);
  assert.equal(saveAllocatedFeeWorksheetInput.parse({ ...save, worksheet: { ...worksheet, allocations: {} } }).worksheet.allocations, undefined);
});

test("fee templates scope use and preserve the original fee and source snapshot", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const at = "2026-11-06T17:00:00.000Z";
  const tenant = "fictional";
  const staff = (role) => ({ email: `${role.toLowerCase()}@example.test`, name: `Fictional ${role}`,
    brokerage: { id: tenant, role, pilot: true } });
  const owner = staff("Admin");
  const officer = staff("LO");
  const loanId = "fictional-loan";
  const runId = randomUUID();
  const offerId = randomUUID();
  const manage = (input, actor = owner, brokerageId = tenant) => feeTemplateWork(db, input, actor, brokerageId, new Date(at));
  const send = (input) => executeCommand(db, { loanId, ...input }, officer, undefined, [], { scopedLoanUpdates: true });

  insertContact(db, { id: "sample-borrower", name: "Fictional Borrower", email: "", phone: "", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId: "sample-borrower", partnerId: null, officer: officer.name, officerEmail: officer.email,
    stage: "Application", stageSince: at, address: "", amount: 350000, purpose: "Purchase" });
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, revision, updatedAt, submittedAt)
    VALUES (?, ?, ?, ?, 3, ?, ?)`).run(loanId, randomUUID(), at, JSON.stringify(blankApplication()), at, at);
  const scenario = { purpose: "Purchase", loanAmount: 350000, propertyValue: 360000, purchasePrice: 360000, zip: "48304" };
  const offer = { id: offerId, product: "Fictional 30 year fixed", rate: 6.5, years: 30, principalAndInterest: 2212.24, pricingAmount: -500 };
  db.prepare(`INSERT INTO pricing_runs (id, loanId, provider, mode, scenario, offers, notices, quotedAt, selectedId, selectedAt, applicationRevision)
    VALUES (?, ?, 'sample', 'mock', ?, ?, '[]', ?, ?, ?, 3)`)
    .run(runId, loanId, JSON.stringify(scenario), JSON.stringify([offer]), at, offerId, at);
  const fees = { ...blankFees(), origination: 99500, appraisal: 65000, creditReport: 0 };
  const config = { title: "Sample purchase", source: "Internal fictional fee schedule", effectiveOn: "2025-01-01",
    purpose: "Purchase", zip: scenario.zip, fees };
  const publish = { type: "publish", id: randomUUID(), revision: 0, config };
  const forQuote = { type: "forQuote", loanId, runId };
  assert.match(manage(publish, officer).error, /admins/);
  assert.match(manage(publish, owner, "different-brokerage").error, /unavailable/);
  assert.match(manage(forQuote, staff("Processor")).error, /unavailable/);
  assert.match(manage(forQuote, { ...officer, email: "other@example.test" }).error, /unavailable/);
  assert.match(manage({ ...publish, config: { ...config, effectiveOn: "2026-11-07" } }).error, /on or before/);
  const v1 = manage(publish).templates[0];
  assert.equal(v1.revision, 1);
  assert.deepEqual(manage(publish).templates, [v1]);
  assert.ok(manage({ ...publish, id: randomUUID(), config: { ...config, title: "Other ZIP", zip: "10001" } }).templates);
  assert.ok(manage({ ...publish, id: randomUUID(), config: { ...config, title: "Refinance", purpose: "Refinance", zip: "" } }).templates);
  assert.deepEqual(manage(forQuote, officer).templates, [v1]);

  const worksheet = { fees, purchasePrice: 36000000, payoffs: null, deposit: 100000, sellerCredits: 100000, otherCredits: 0 };
  const estimate = estimateFees(scenario, offer, worksheet);
  assert.deepEqual(missingFees(estimate.inputs.fees), ["settlement", "government", "prepaid", "escrow", "other"]);
  assert.equal(estimate.lenderCredit, 50000);
  assert.equal(estimate.closingCosts, 114500);
  assert.equal(estimate.cashToClose, 914500);

  const choice = { runId, offerId, feeRevision: 0 };
  const save = { type: "saveFeeWorksheet", ...choice, worksheet, template: { id: v1.id, revision: v1.revision } };
  const result = await send(save);
  const saved = result.loanWork.feeWorksheets[0];
  assert.equal(saved.origin.source, config.source);
  assert.equal(saved.inputs.fees.settlement, null);
  assert.equal(saved.inputs.fees.creditReport, 0);
  assert.equal((await send(save)).loanWork.feeWorksheets[0].revision, 1);
  const share = { type: "publishQuote", ...choice, feeRevision: 1 };
  const first = (await send(share)).state.publishedQuotes[0].presentation;
  assert.deepEqual(first.primary.feeOrigin, saved.origin);
  assert.equal(first.primary.estimate.cashToClose, 914500);
  const allocations = { appraisal: { payee: "Fictional Appraiser", seller: 20000, lender: 10000, other: 0 } };
  const v2 = { ...publish, revision: 1, config: { ...config, source: "New fee schedule", fees: { ...fees, appraisal: 75000 }, allocations } };
  assert.match(manage({ ...v2, config: { ...v2.config, purpose: "Any loan purpose" } }).error, /Choose Purchase/);
  assert.match(manage({ ...v2, config: { ...v2.config, fees: { ...fees, appraisal: 20000 } } }).error, /contributions exceed/);
  assert.equal(manage(v2).templates.find(({ id }) => id === v1.id).revision, 2);
  assert.deepEqual(manage(v2).templates.find(({ id }) => id === v1.id).allocations, allocations);
  assert.match(manage({ ...v2, config: { ...config, title: "Stale edit" } }).error, /changed/i);

  const edited = { ...worksheet, fees: { ...fees, appraisal: 67500 } };
  const edit = await send({ ...save, worksheet: edited, feeRevision: 1 });
  assert.equal(edit.loanWork.feeWorksheets[0].origin.fees.appraisal, 65000);
  assert.deepEqual(edit.loanWork.publishedQuotes[0].presentation, first);
  assert.match((await send(share)).error, /changed/);
  assert.match((await send({ ...share, feeRevision: 2 })).error, /refresh pricing/i);
  const pending = edit.loanWork.publishedQuotes[0];
  const replacement = (await send({ ...share, type: "publishDatedQuote", feeRevision: 2, alternatives: [],
    expiresOn: sharedQuoteExpiry().suggested, previousPublishedAt: pending.publishedAt, reviewRevision: pending.reviewRevision,
    reviewNote: "Confirmed the revised appraisal fee." })).loanWork;
  assert.deepEqual(replacement.sharedQuoteHistory[0].presentation, first);
  assert.equal(replacement.publishedQuotes[0].presentation.primary.estimate.inputs.fees.appraisal, 67500);
  assert.equal(replacement.publishedQuotes[0].presentation.primary.feeOrigin.revision, 1);

  const updatedWorksheet = { ...worksheet, fees: v2.config.fees,
    allocations: { appraisal: { ...allocations.appraisal, seller: 15000 } } };
  const updated = { ...save, worksheet: updatedWorksheet, feeRevision: 2, template: { id: v1.id, revision: 2 } };
  assert.match((await send({ ...updated, worksheet: { ...worksheet, fees: v2.config.fees } })).error, /Refresh pricing/);
  const savedV2 = (await send({ ...updated, type: "saveAllocatedFeeWorksheet" })).loanWork.feeWorksheets[0];
  assert.deepEqual(savedV2.origin.allocations, allocations);
  assert.deepEqual(savedV2.inputs.allocations, updatedWorksheet.allocations);
  assert.equal(borrowerFee(savedV2.inputs, "appraisal"), 50000);
  const sharedV2 = replacement.publishedQuotes[0];
  const allocatedQuote = (await send({ ...share, type: "publishDatedQuote", feeRevision: 3, alternatives: [],
    expiresOn: sharedQuoteExpiry().suggested, previousPublishedAt: sharedV2.publishedAt, reviewRevision: sharedV2.reviewRevision + 1,
    reviewNote: "Confirmed the sample appraisal allocation." })).loanWork.publishedQuotes[0].presentation;
  assert.deepEqual(allocatedQuote.primary.feeOrigin.allocations, allocations);
  assert.deepEqual(borrowerQuotePresentation(allocatedQuote).primary.estimate.inputs.allocations, updatedWorksheet.allocations);
  assert.equal(borrowerQuotePresentation(allocatedQuote).primary.feeOrigin, undefined);
  assert.ok(manage({ type: "archive", id: v1.id, revision: 2, archived: true }).templates);
  assert.deepEqual(manage(forQuote, officer).templates, []);
  assert.match((await send({ ...updated, type: "saveAllocatedFeeWorksheet", feeRevision: 3, template: { id: v1.id, revision: 3 } })).error, /no longer applies/);
  const rules = { origination: { basis: "Loan amount", basisPoints: 125 }, government: { basis: "Purchase price", basisPoints: 13 } };
  const percentageTemplate = { type: "publish", id: randomUUID(), revision: 0,
    config: { ...config, title: "Percentage estimates", fees: blankFees(), rules } };
  assert.match(manage({ ...percentageTemplate, config: { ...percentageTemplate.config, purpose: "Any loan purpose" } }).error, /Choose Purchase/);
  assert.match(manage({ ...percentageTemplate, config: { ...percentageTemplate.config, fees } }).error, /Choose one calculation/);
  assert.ok(manage(percentageTemplate).templates);
  db.prepare("UPDATE pricing_runs SET scenario = ? WHERE id = ?").run(JSON.stringify({ ...scenario, purchasePrice: null }), runId);
  assert.match(manage(forQuote, officer).templates[0].blocked, /Reprice with a purchase price/);
  db.prepare("UPDATE pricing_runs SET scenario = ? WHERE id = ?").run(JSON.stringify({ ...scenario, loanAmount: 350000.4 }), runId);
  const calculation = manage(forQuote, officer).templates[0];
  assert.deepEqual(calculation.calculations.origination, { ...rules.origination, baseCents: 35_000_040, amountCents: 437_501 });
  assert.deepEqual(calculation.calculations.government, { ...rules.government, baseCents: 36_000_000, amountCents: 46_800 });
  const calculatedSave = { ...updated, type: "saveAllocatedFeeWorksheet", feeRevision: 3,
    template: { id: percentageTemplate.id, revision: 1 }, worksheet: { ...worksheet, fees: { ...calculation.fees, origination: 440000 } } };
  assert.match((await send({ ...calculatedSave, worksheet: { ...calculatedSave.worksheet, purchasePrice: 37_000_000 } })).error, /Match the purchase price/);
  const calculated = (await send(calculatedSave)).loanWork.feeWorksheets[0];
  assert.deepEqual(calculated.origin.calculations, calculation.calculations);
  assert.equal(calculated.origin.fees.origination, 437_501);
  assert.equal(calculated.inputs.fees.origination, 440_000);
  assert.equal((await send(calculatedSave)).loanWork.feeWorksheets[0].revision, 4);
  assert.ok(manage({ ...percentageTemplate, revision: 1,
    config: { ...percentageTemplate.config, rules: { ...rules, origination: { ...rules.origination, basisPoints: 200 } } } }).templates);
  assert.deepEqual((await send({ ...calculatedSave, feeRevision: 4 })).loanWork.feeWorksheets[0].origin.calculations, calculation.calculations);
  assert.ok(manage({ type: "archive", id: percentageTemplate.id, revision: 2, archived: true }).templates);
  const regional = (title, state, zip = "") => ({ type: "publish", id: randomUUID(), revision: 0,
    config: { ...config, title, state, zip } });
  assert.match(manage(regional("Incorrect pairing", "OH", scenario.zip)).error, /ZIP 48304 is listed in Michigan/);
  assert.match(manage(regional("Unresolved pairing", "MI", "00000")).error, /ZIP in the property directory/);
  const broad = regional("General purchase", undefined);
  const stateOnly = regional("Michigan purchase", "MI");
  const differentState = regional("Ohio purchase", "OH");
  const zipOnly = regional("ZIP purchase", undefined, scenario.zip);
  const exact = regional("Michigan local purchase", "MI", scenario.zip);
  const unknownZip = regional("Unlisted ZIP purchase", undefined, "00000");
  for (const entry of [broad, stateOnly, differentState, zipOnly, exact, unknownZip]) assert.ok(manage(entry).templates);
  const matching = manage(forQuote, officer);
  assert.deepEqual(matching.property, { state: "MI", zip: scenario.zip });
  assert.deepEqual(matching.templates.map(({ id }) => id), [exact.id, zipOnly.id, stateOnly.id, broad.id]);
  const regionalSave = { ...save, type: "saveAllocatedFeeWorksheet", feeRevision: 4, template: { id: stateOnly.id, revision: 1 } };
  const regionalWorksheet = (await send(regionalSave)).loanWork.feeWorksheets[0];
  assert.deepEqual(regionalWorksheet.origin.property, matching.property);
  assert.equal(regionalWorksheet.origin.state, "MI");
  assert.ok(manage({ ...stateOnly, revision: 1, config: { ...stateOnly.config, state: "OH" } }).templates);
  const stateRetry = await send(regionalSave);
  assert.deepEqual(stateRetry.loanWork.feeWorksheets[0].origin, regionalWorksheet.origin);
  db.prepare("UPDATE pricing_runs SET scenario = ? WHERE id = ?").run(JSON.stringify({ ...scenario, zip: "00000" }), runId);
  const unresolved = manage(forQuote, officer);
  assert.deepEqual(unresolved.property, { zip: "00000" });
  assert.deepEqual(unresolved.templates.map(({ id }) => id), [unknownZip.id, broad.id]);
  assert.match((await send({ ...regionalSave, feeRevision: 5, template: { id: exact.id, revision: 1 } })).error, /no longer applies/);
  db.prepare("UPDATE pricing_runs SET scenario = ?, offers = ? WHERE id = ?")
    .run(JSON.stringify(scenario), JSON.stringify([offer, { ...offer, id: "alternate" }]), runId);
  const request = { type: "requestFeeEstimate", loanId, runId, offerId, requestId: randomUUID(), scenario: "Temporary error" };
  assert.match(manage(request, { ...officer, brokerage: { ...officer.brokerage, pilot: false } }).error, /unavailable/);
  assert.match(manage(request, { ...officer, email: "other@example.test" }).error, /unavailable/);
  const failed = manage(request, officer).estimate;
  assert.equal(failed.status, "Failed");
  assert.deepEqual(manage(request, officer).estimate, failed);
  assert.match(manage({ ...request, offerId: "alternate" }, officer).error, /different fee estimate/);
  const retry = { ...request, requestId: randomUUID(), retryOf: request.requestId };
  const available = manage(retry, officer).estimate;
  assert.equal(available.status, "Available");
  assert.equal(available.retryOf, failed.requestId);
  assert.equal(available.fees.appraisal, 67500);
  assert.equal(available.fees.origination, null);
  assert.deepEqual(manage({ type: "recentFeeEstimate", loanId, runId, offerId }, officer).estimate, available);
  assert.equal(manage({ ...request, requestId: randomUUID(), scenario: "No coverage" }, officer).estimate.status, "Unavailable");
  assert.equal(manage(forQuote, officer).templates[0].id, exact.id);
  const fromProvider = { ...regionalSave, template: null, feeRevision: 5, estimateId: available.requestId,
    worksheet: { ...worksheet, fees: { ...available.fees, appraisal: 68000 } } };
  assert.match((await send({ ...fromProvider, estimateId: failed.requestId })).error, /available fee estimate/);
  assert.match((await send({ ...fromProvider, offerId: "alternate" })).error, /available fee estimate/);
  assert.match((await send({ ...fromProvider, template: regionalSave.template })).error, /one source/);
  const providerWorksheet = (await send(fromProvider)).loanWork.feeWorksheets[0];
  assert.equal(providerWorksheet.origin.providerEstimate.reference, available.reference);
  assert.equal(providerWorksheet.origin.fees.appraisal, 67500);
  assert.equal(providerWorksheet.inputs.fees.appraisal, 68000);
  assert.equal((await send(fromProvider)).loanWork.feeWorksheets[0].revision, 6);
  db.prepare("UPDATE applications SET revision = 4 WHERE loanId = ?").run(loanId);
  assert.match((await send({ ...save, feeRevision: 4 })).error, /Reprice/);
});

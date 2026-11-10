import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
      return next(`${specifier}.ts`, context);
    }
  },
});

const { executeCommand } = await import("../src/lib/commands.ts");
const { initializeStore, insertContact, insertLoan, insertSubmission } = await import("../src/lib/store.ts");
const { borrowerCommandResult, loanActionApplications } = await import("../src/lib/applications.ts");
const { applicationIssues, blankApplication, sampleApplication } = await import("../src/lib/application-model.ts");
const { zipCityState } = await import("../src/lib/zip-city-state.ts");
const { blankLenderDetails } = await import("../src/lib/urla.ts");
const { readOfficerQueue } = await import("../src/lib/officer-queue.ts");

test("sample application answers preserve the property ZIP and its locality from intake", () => {
  const draft = blankApplication();
  const zip = "48304";
  const locality = zipCityState(zip);
  assert.ok(locality);
  const propertyLocation = { ...draft.propertyLocation, ...locality, zip };
  const sample = sampleApplication({ ...draft, propertyLocation });
  assert.deepEqual(sample.propertyLocation, propertyLocation);
  assert.ok(!applicationIssues({ ...sample, confirmedDemo: true }).some((issue) => issue.includes("Subject property")));
  const unknown = sampleApplication({ ...draft, propertyLocation: { ...draft.propertyLocation, zip: "00000" } });
  assert.equal(unknown.propertyLocation.zip, "00000");
  assert.equal(unknown.propertyLocation.city, "");
  assert.ok(applicationIssues(unknown).some((issue) => issue.includes("Subject property")));
});

test("corrected 1003s update the same mock UWM file and require fresh quotes", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    exec: (query) => sqlite.exec(query),
    prepare: (query) => sqlite.prepare(query),
    transaction(run) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = run();
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  initializeStore(db, false);
  const staff = { email: "loan-officer@example.test", name: "Demo Loan Officer",
    brokerage: { id: crypto.randomUUID(), name: "Fictional team", role: "LO", pilot: true } };
  const loanId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  insertContact(db, { id: contactId, name: "Fictional Borrower", email: "borrower@example.test", phone: "2485550111", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: staff.name, officerEmail: staff.email,
    address: "", amount: 0, purpose: "Purchase", stage: "Lead", stageSince: new Date().toISOString() });
  const command = (type, fields = {}) => executeCommand(db, { type, loanId, ...fields }, staff);
  const apply = async (type, fields) => {
    const result = await command(type, fields);
    assert.ok(result.state, result.error);
    return result.state;
  };
  const scenario = { purpose: "Purchase", loanAmount: 350000, propertyValue: 450000, purchasePrice: null, zip: "48304",
    creditScore: 760, monthlyIncome: 9500, occupancy: "Primary residence", propertyType: "Single family", firstTimeBuyer: false };
  const legacy = (await apply("runPricing", { scenario, applicationRevision: null })).pricingRuns[0];
  const selection = (run) => ({ runId: run.id, offerId: run.offers[0].id });
  const app = (await apply("startApplication")).applications[0];
  const { token } = app;
  const read = () => borrowerCommandResult(db, { type: "read", token }).application;
  const status = () => borrowerCommandResult(db, { type: "status", token }).statusView;
  assert.deepEqual(status(), { kind: "resume" });
  const zipOnly = read().draft;
  zipOnly.propertyLocation.zip = scenario.zip;
  db.prepare("UPDATE applications SET draft = ? WHERE loanId = ?").run(JSON.stringify(zipOnly), loanId);
  assert.deepEqual(read().draft.propertyLocation, { ...zipOnly.propertyLocation, ...zipCityState(scenario.zip) });
  const submit = (revision, draft) => borrowerCommandResult(db, { type: "submit", token, revision, step: 9, draft }).application;
  const first = submit(app.revision, { ...sampleApplication(read().draft), confirmedDemo: true });
  assert.ok(first.submittedAt);
  assert.match((await command("selectOffer", selection(legacy))).error, /Reprice/);
  assert.match((await command("runPricing", { scenario, applicationRevision: app.revision })).error, /changed/);
  await apply("reviewApplication", { revision: first.revision });
  const manualExport = { revision: first.revision, lenderRevision: 0, eventId: crypto.randomUUID(),
    names: [{ first: "Fictional", middle: "", last: "Borrower", suffix: "" }] };
  const exportResult = await command("exportReviewedApplication", manualExport);
  assert.ok(exportResult.mismoXml?.includes("MISMOReferenceModelIdentifier"));
  assert.deepEqual(exportResult.state.applications[0].manualHandoff, { exportPrepared: true, outcome: null });
  const acknowledgment = { revision: first.revision, lenderRevision: 0, eventId: crypto.randomUUID(), outcome: "Acknowledged", note: "Fictional response" };
  assert.equal((await apply("recordManualHandoff", acknowledgment)).applications[0].manualHandoff.outcome, "Acknowledged");
  await apply("recordManualHandoff", { ...acknowledgment, eventId: crypto.randomUUID(), outcome: "Returned for changes" });
  assert.deepEqual((await apply("recordManualHandoff", acknowledgment)).applications[0].manualHandoff,
    { exportPrepared: true, outcome: "Returned for changes" });
  const changed = await apply("saveLenderDetails", { revision: 0, details: blankLenderDetails() });
  assert.equal(changed.applications[0].manualHandoff, undefined);
  assert.match((await command("recordManualHandoff", acknowledgment)).error, /Lender details changed/);
  assert.match((await command("recordManualHandoff", { ...acknowledgment, lenderRevision: 1 })).error, /new handoff entry/);
  await apply("exportReviewedApplication", { ...manualExport, lenderRevision: 1, eventId: crypto.randomUUID() });
  await apply("recordManualHandoff", { ...acknowledgment, lenderRevision: 1, eventId: crypto.randomUUID() });
  const pending = await apply("simulateMissingUwmReceipt", { revision: first.revision });
  assert.equal(pending.submissions.length, 0);
  assert.equal(pending.applications[0].uwmReference, null);
  assert.equal(pending.applications[0].uwmPendingReceipt.revision, first.revision);
  assert.deepEqual(loanActionApplications(db, [loanId])[0].uwmPendingReceipt, pending.applications[0].uwmPendingReceipt);
  const queued = () => readOfficerQueue(db, { horizon: 7 }, staff, staff.brokerage.id).items
    .filter(({ id }) => id.startsWith("uwm-receipt:"));
  assert.equal(queued().length, 1);
  assert.equal(queued()[0].target, "loan-application");
  assert.match((await command("sendApplication", { revision: first.revision })).error, /missing submission receipt/);
  assert.match((await command("simulateMissingUwmReceipt", { revision: first.revision })).error, /missing submission receipt/);
  assert.match((await command("requestApplicationCorrection", { revision: first.revision, note: "Fictional correction" })).error, /Recover/);
  assert.match((await command("completeTask", { id: queued()[0].id, completed: true })).error, /missing receipt/);
  assert.ok((await command("reconcileMockUwmReceipt", { revision: first.revision + 1 })).error);
  const acceptance = db.prepare("SELECT reference, receipt, attemptedAt FROM mock_uwm_acceptances WHERE loanId = ?").get(loanId);
  const firstSend = await apply("reconcileMockUwmReceipt", { revision: first.revision });
  assert.equal(queued().length, 0);
  assert.equal(firstSend.applications[0].uwmPendingReceipt, undefined);
  const recoveredAgain = await apply("reconcileMockUwmReceipt", { revision: first.revision });
  assert.deepEqual(recoveredAgain.submissions, firstSend.submissions);
  assert.deepEqual(recoveredAgain.uwmAlerts, firstSend.uwmAlerts);
  const file = firstSend.submissions[0];
  const firstReceipt = firstSend.applications[0].versions.find((item) => item.revision === first.revision).uwmReceipt;
  assert.equal(file.externalId, acceptance.reference);
  assert.deepEqual(firstReceipt, { reference: acceptance.receipt, sentAt: acceptance.attemptedAt });
  const retry = await apply("sendApplication", { revision: first.revision });
  assert.deepEqual(retry.applications[0].versions[0].uwmReceipt, firstReceipt);
  assert.deepEqual(retry.uwmAlerts, firstSend.uwmAlerts);
  const original = (await apply("runPricing", {
    scenario: { ...scenario, loanAmount: Number(first.draft.loanAmount) }, applicationRevision: first.revision,
  })).pricingRuns[0];
  await apply("selectOffer", selection(original));
  await apply("publishQuote", selection(original));
  assert.ok(read().loanStatus.quote);
  assert.deepEqual(status(), { kind: "status", submittedAt: first.submittedAt, loanStatus: read().loanStatus });
  const floatInput = { submissionId: file.id, ...selection(original), previousFloatReference: null };
  const floating = (await apply("floatMockRate", floatInput)).mockUwmRates[0];
  const lockInput = { floatReference: floating.floatReference, days: 30 };

  await apply("requestApplicationCorrection", { revision: first.revision, note: "Confirm the requested loan amount." });
  assert.match((await command("sendApplication", { revision: first.revision })).error, /review/);
  assert.match((await command("lockMockRate", lockInput)).error, /Reprice/);
  assert.match((await command("floatMockRate", floatInput)).error, /Reprice/);
  const correction = read();
  assert.deepEqual(status(), { kind: "resume" });
  assert.equal(correction.correctionNote, "Confirm the requested loan amount.");
  assert.equal(correction.draft.loanAmount, first.draft.loanAmount);
  const corrected = submit(correction.revision, { ...correction.draft, loanAmount: "340000", confirmedDemo: true });
  assert.ok(corrected.submittedAt);
  assert.match((await command("sendApplication", { revision: corrected.revision })).error, /review/);
  const reviewedCorrection = await apply("reviewApplication", { revision: corrected.revision });
  assert.equal(reviewedCorrection.applications[0].manualHandoff, undefined);
  assert.match((await command("sendApplication", { revision: first.revision })).error, /current submitted 1003/);
  const synced = await executeCommand(db, { type: "sync" }, { ...staff, brokerage: { ...staff.brokerage, role: "Admin" } });
  assert.deepEqual(synced.state.submissions.find((item) => item.id === file.id).conditions, file.conditions);
  assert.match((await command("publishQuote", selection(original))).error, /Reprice/);
  const alternative = (await apply("runPricing", { scenario: { ...scenario, loanAmount: 340000.01 }, applicationRevision: corrected.revision })).pricingRuns[0];
  await apply("selectOffer", selection(alternative));
  for (const quote of [undefined, selection(alternative)]) {
    assert.match((await command("sendApplication", { revision: corrected.revision, quote })).error,
      /saved quote is \$340,000\.01 and the 1003 requests \$340,000/);
  }
  assert.equal(db.prepare("SELECT uwmReceipt FROM application_versions WHERE loanId = ? AND revision = ?").get(loanId, corrected.revision).uwmReceipt, null);
  const fresh = (await apply("runPricing", { scenario: { ...scenario, loanAmount: 340000 }, applicationRevision: corrected.revision }))
    .pricingRuns.find((item) => item.applicationRevision === corrected.revision);
  assert.match((await command("sendApplication", { revision: corrected.revision, quote: selection(original) })).error, /saved mock quote changed/);
  await apply("selectOffer", { runId: fresh.id, offerId: fresh.offers[1].id });
  assert.match((await command("sendApplication", { revision: corrected.revision, quote: selection(fresh) })).error, /saved mock quote changed/);
  await apply("selectOffer", selection(fresh));
  const freshFloat = { submissionId: file.id, ...selection(fresh), previousFloatReference: floating.floatReference };
  const pendingReceipt = new RegExp(`Send 1003 revision ${corrected.revision} to the linked mock UWM file`);
  assert.match((await command("floatMockRate", freshFloat)).error, pendingReceipt);
  db.prepare("UPDATE mock_uwm_rates SET runId = ?, offerId = ? WHERE loanId = ?").run(fresh.id, fresh.offers[0].id, loanId);
  assert.match((await command("lockMockRate", lockInput)).error, pendingReceipt);
  assert.equal(db.prepare("SELECT lockReference FROM mock_uwm_rates WHERE loanId = ?").get(loanId).lockReference, null);
  const resent = await apply("sendApplication", { revision: corrected.revision, quote: selection(fresh) });
  assert.equal(resent.submissions.length, 1);
  assert.equal(resent.submissions[0].externalId, file.externalId);
  assert.deepEqual(resent.submissions[0].conditions, file.conditions);
  const receipts = resent.applications[0].versions.filter((version) => version.uwmReceipt);
  assert.deepEqual(receipts.map((version) => version.revision), [corrected.revision, first.revision]);
  assert.notEqual(receipts[0].uwmReceipt.reference, firstReceipt.reference);
  const resendRetry = await apply("sendApplication", { revision: corrected.revision, quote: selection(fresh) });
  assert.deepEqual(resendRetry.applications[0].versions, resent.applications[0].versions);
  assert.equal(db.prepare("SELECT count(*) AS count FROM activity WHERE loanId = ? AND text LIKE 'Mock UWM received 1003 revision %'").get(loanId).count, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE subject = ? AND action = 'Sent updated 1003 to mock UWM'").get(loanId).count, 1);
  assert.equal(read().loanStatus.quote, null);
  assert.match((await command("publishQuote", { ...selection(fresh), alternatives: [{ ...selection(original), feeRevision: 0 }] })).error, /Reprice/);
  await apply("publishQuote", { ...selection(fresh), alternatives: [{ runId: fresh.id, offerId: fresh.offers[1].id, feeRevision: 0 }] });
  assert.equal(read().loanStatus.quote.presentation.primary.loanAmount, 340000);
  assert.deepEqual(status(), { kind: "status", submittedAt: corrected.submittedAt, loanStatus: read().loanStatus });
  await apply("selectOffer", selection(alternative));
  const mismatchedRate = /\$340,000\.01 and the 1003 requests \$340,000.*before floating or locking/;
  assert.match((await command("floatMockRate", { submissionId: file.id, ...selection(alternative),
    previousFloatReference: floating.floatReference })).error, mismatchedRate);
  // Simulate a float created before the amount check was introduced.
  db.prepare("UPDATE mock_uwm_rates SET runId = ?, offerId = ? WHERE loanId = ?")
    .run(alternative.id, alternative.offers[0].id, loanId);
  assert.match((await command("lockMockRate", lockInput)).error, mismatchedRate);
  assert.equal(db.prepare("SELECT lockReference FROM mock_uwm_rates WHERE loanId = ?").get(loanId).lockReference, null);
  await apply("selectOffer", selection(fresh));
  const otherFile = { ...file, id: crypto.randomUUID(), externalId: "FICT-SYNC-OTHER", conditions: [] };
  insertSubmission(db, otherFile);
  assert.match((await command("floatMockRate", { ...freshFloat, submissionId: otherFile.id })).error, /Use the mock UWM file linked to the current 1003/);
  const current = (await apply("floatMockRate", freshFloat)).mockUwmRates[0];
  const locked = (await apply("lockMockRate", { ...lockInput, floatReference: current.floatReference })).mockUwmRates[0];
  assert.deepEqual(locked.quoteTerms, { loanAmount: 340000, applicationRevision: corrected.revision });
  await apply("selectOffer", selection(alternative));
  assert.deepEqual((await apply("lockMockRate", { ...lockInput, floatReference: current.floatReference })).mockUwmRates[0], locked);
  const confirmations = db.prepare("SELECT text FROM activity WHERE loanId = ? AND text LIKE 'Mock UWM rate lock confirmed%'").all(loanId);
  assert.equal(confirmations.length, 1);
  assert.ok(confirmations[0].text.endsWith(`${locked.lockReference} · $340,000 · 1003 revision ${corrected.revision}`));
  const replay = await apply("sendApplication", { revision: corrected.revision });
  assert.deepEqual(replay.applications[0].versions, resent.applications[0].versions);
  await apply("requestApplicationCorrection", { revision: corrected.revision, note: "Confirm the property address." });
  const extended = (await apply("extendMockLock", { lockReference: locked.lockReference, expectedExpiresAt: locked.lockExpiresAt, days: 7 }))
    .mockUwmRates[0];
  assert.ok(extended.lockExpiresAt > locked.lockExpiresAt);
  assert.deepEqual(extended.quoteTerms, locked.quoteTerms);
  const cancelled = await apply("cancelMockLock", { lockReference: locked.lockReference, expectedExpiresAt: extended.lockExpiresAt });
  assert.ok(cancelled.mockUwmRates[0].lockCancellationReference);
  assert.deepEqual(cancelled.mockUwmRates[0].quoteTerms, locked.quoteTerms);
  assert.equal(cancelled.sharedQuoteHistory[0].runId, original.id);
  const revised = read();
  const third = submit(revised.revision, { ...revised.draft, confirmedDemo: true });
  await apply("reviewApplication", { revision: third.revision });
  const beforeRecovery = await apply("simulateMissingUwmReceipt", { revision: third.revision });
  const recoveredRevision = await apply("reconcileMockUwmReceipt", { revision: third.revision });
  assert.equal(recoveredRevision.applications[0].uwmReference, file.externalId);
  assert.deepEqual(recoveredRevision.submissions, beforeRecovery.submissions);
  assert.deepEqual(recoveredRevision.uwmAlerts, beforeRecovery.uwmAlerts);
  assert.equal(recoveredRevision.applications[0].versions.filter((version) => version.uwmReceipt).length, 3);
  assert.equal(queued().length, 0);
  await apply("revokeApplication", { token });
  assert.equal(borrowerCommandResult(db, { type: "status", token }).status, 404);

  const importedId = crypto.randomUUID();
  insertLoan(db, { id: importedId, contactId, partnerId: null, officer: staff.name, officerEmail: staff.email,
    address: "", amount: scenario.loanAmount, purpose: "Purchase", stage: "Processing", stageSince: new Date().toISOString() });
  const importedFile = { ...otherFile, loanId: importedId, id: crypto.randomUUID(), externalId: "FICT-SYNC-LEGACY" };
  insertSubmission(db, importedFile);
  const importedRun = (await apply("runPricing", { loanId: importedId, scenario, applicationRevision: null })).pricingRuns.find((run) => run.loanId === importedId);
  await apply("selectOffer", { loanId: importedId, ...selection(importedRun) });
  const imported = await apply("floatMockRate", { loanId: importedId, submissionId: importedFile.id, ...selection(importedRun), previousFloatReference: null });
  const importedRate = imported.mockUwmRates.find((rate) => rate.loanId === importedId);
  assert.equal(importedRate.loanNumber, importedFile.externalId);
  assert.deepEqual(importedRate.quoteTerms, { loanAmount: scenario.loanAmount, applicationRevision: null });
});

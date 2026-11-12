import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });

const { initializeStore, insertContact, insertLoan, insertSubmission, workspace } = await import("../src/lib/store.ts");
const { borrowerCommandResult, startApplication } = await import("../src/lib/applications.ts");
const { sampleApplication } = await import("../src/lib/application-model.ts");
const { realtorReferrals } = await import("../src/lib/realtor-portal.ts");
const { loanReviewWork, reviewParticipants } = await import("../src/lib/loan-reviews.ts");
const { loanReviewsTarget, reviewInput, reviewTarget } = await import("../src/lib/loan-review-model.ts");
const { loanNextAction } = await import("../src/lib/loan-workflow.ts");
const { readPipeline } = await import("../src/lib/pipeline.ts");
const { emptyPipelineFilters } = await import("../src/lib/pipeline-model.ts");
const { stalledLoanPage } = await import("../src/lib/officer-stalled.ts");
const { readOfficerQueue, readWorkspaceCalendar } = await import("../src/lib/officer-queue.ts");
const { readProcessorQueue } = await import("../src/lib/processor-queue.ts");
const { readFileExceptions, fileExceptionOwners, nameFileExceptions } = await import("../src/lib/file-exceptions.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { readPlaybook } = await import("../src/lib/playbooks.ts");
const { readDisclosureWork } = await import("../src/lib/disclosures.ts");
const { closingPackageReviewCategory, disclosureClosingReviewPrefix, sampleDisclosureDocuments } = await import("../src/lib/disclosure-model.ts");
const { loanStageEditWork } = await import("../src/lib/loan-stage-edits.ts");
const { closingGateWork } = await import("../src/lib/closing-gates.ts");
const { newPortalAccessCode, portalToken } = await import("../src/lib/brokerage-model.ts");
const { lenderPackageAccess, lenderShareWork } = await import("../src/lib/lender-handoff-share.ts");
const { disclosureTemplatesForLoan, disclosureTemplateWork } = await import("../src/lib/disclosure-templates.ts");
const { blankLenderDetails } = await import("../src/lib/urla.ts");
const at = "2026-11-08T15:00:00.000Z";
const today = "2026-11-08";

function fixture(t, pilot = false) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction(fn) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = fn(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const id = crypto.randomUUID();
  const person = (role, name) => ({ email: `${name}@example.test`, name, brokerage: { id, name: "Fictional brokerage", role, pilot } });
  const admin = person("Admin", "admin");
  const officer = person("LO", "officer");
  const outsider = person("LO", "outsider");
  const processor = person("Processor", "processor");
  const nextProcessor = person("Processor", "next-processor");
  const roster = [admin, officer, outsider, processor, nextProcessor].map(({ email, name, brokerage }) => ({ email, name, role: brokerage.role, status: "Active", accessRevision: 1 }));
  insertContact(db, { id: "borrower", name: "Fictional borrower", role: "Borrower", phone: "", email: "borrower@example.test" });
  insertContact(db, { id: "partner", name: "Fictional realtor", role: "Realtor", phone: "", email: "realtor@example.test" });
  insertLoan(db, { id: "loan", contactId: "borrower", partnerId: "partner", officer: officer.name, officerEmail: officer.email,
    address: "", purpose: "Purchase", stage: "Processing", stageSince: at, amount: 275000 });
  db.prepare("INSERT INTO loan_processing VALUES ('loan', ?, ?, 'In processing', '', ?, 1)").run(processor.email, processor.name, at);
  const work = (input, staff = officer, members = roster, time = at) => loanReviewWork(db, reviewInput.parse(input), staff, id, members, new Date(time));
  const create = (fields = {}) => ({ type: "create", loanId: "loan", id: crypto.randomUUID(), title: "Second look", category: "General file review",
    reviewerEmail: processor.email, dueOn: today, note: "Fictional internal instructions", ...fields });
  return { db, id, admin, officer, outsider, processor, nextProcessor, roster, work, create };
}

test("a manual lender quote stays with its exact export and acknowledgment and cannot be sent to mock UWM", async (t) => {
  const { db, id, officer, outsider, roster } = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date(at) });
  const loanId = "loan";
  const pilot = { ...officer, brokerage: { ...officer.brokerage, pilot: true } };
  const change = (type, fields = {}, actor = pilot) => executeCommand(db, { type, loanId, ...fields }, actor, undefined, roster);
  const ok = async (type, fields) => {
    const result = await change(type, fields);
    assert.ok(!result.error, result.error);
    return result;
  };
  const { token } = (await ok("startApplication")).state.applications[0];
  const borrower = (input) => borrowerCommandResult(db, { token, ...input });
  const initial = borrower({ type: "read" }).application;
  const draft = { ...sampleApplication(initial.draft), confirmedDemo: true };
  const { revision } = borrower({ type: "submit", revision: initial.revision, step: 9, draft }).application;
  await ok("reviewApplication", { revision });
  const scenario = { purpose: "Purchase", loanAmount: Number(draft.loanAmount), propertyValue: 450000, purchasePrice: 450000,
    zip: draft.propertyLocation.zip, creditScore: 760, monthlyIncome: 9500, occupancy: "Primary residence",
    propertyType: "Single family", firstTimeBuyer: false };
  const [run] = (await ok("runPricing", { scenario, applicationRevision: revision })).state.pricingRuns;
  const choice = { runId: run.id, offerId: crypto.randomUUID() };
  const mock = { runId: run.id, offerId: run.offers[0].id };
  const names = [{ first: "Fictional", middle: "", last: "Borrower", suffix: "" }];
  const base = { revision, lenderRevision: 0, profile: "basic", names };
  const exportWith = (manualQuote, eventId = crypto.randomUUID()) => ({ ...base, eventId, manualQuote });
  const legacyExport = await ok("exportReviewedApplication", exportWith(undefined));
  assert.doesNotMatch(legacyExport.mismoXml, /<NoteRatePercent>5\.875/);
  const details = { lender: "Fictional Harbor Wholesale", product: "Flex fixed", reference: "PRIVATE-QA-REF-108", quotedOn: today,
    expiresOn: "2026-11-12", years: 20, rate: 5.875, apr: null, adjustment: -0.25 };
  const manual = { ...choice, details };
  assert.ok((await change("addManualQuote", manual, outsider)).error);
  assert.match((await change("addManualQuote", { ...manual, details: { ...details, expiresOn: "2026-11-07" } })).error, /expiration/);
  await ok("addManualQuote", manual);
  await ok("addManualQuote", manual);
  assert.match((await change("addManualQuote", { ...manual, details: { ...details, rate: 5.9 } })).error, /new manual offer/);
  const added = (await ok("selectOffer", choice)).state.pricingRuns[0];
  assert.equal(added.offers.filter(({ manual }) => manual).length, 1);
  assert.equal(added.offers.find(({ id }) => id === choice.offerId).pricingAmount, -scenario.loanAmount / 400);
  assert.match((await change("sendApplication", { revision })).error, /Manual lender export/);
  assert.match((await change("sendApplication", { revision, quote: mock })).error, /Manual lender export/);
  assert.match((await change("exportReviewedApplication", exportWith(undefined))).error, /quote changed/);
  const ack = { revision, lenderRevision: 0, eventId: crypto.randomUUID(), profile: "basic", outcome: "Acknowledged", note: "",
    manualQuote: choice, lenderFile: { lender: details.lender, externalId: "FICTIONAL-HARBOR-108" } };
  assert.match((await change("recordManualHandoff", ack)).error, /Prepare the MISMO export/);
  const download = exportWith(choice);
  const { mismoXml } = await ok("exportReviewedApplication", download);
  assert.match(mismoXml, /<NoteRatePercent>5\.875<\/NoteRatePercent>/);
  assert.match(mismoXml, /<LoanAmortizationPeriodCount>240<\/LoanAmortizationPeriodCount>/);
  assert.equal((await ok("exportReviewedApplication", download)).mismoXml, mismoXml);
  assert.match((await change("recordManualHandoff", { ...ack, lenderFile: { ...ack.lenderFile, lender: "Fictional Other" } })).error, /lender on the selected/);
  await ok("recordManualHandoff", ack);
  await ok("recordManualHandoff", ack);
  assert.equal(db.prepare("SELECT count(*) AS count FROM submissions").get().count, 1);
  const basis = JSON.parse(db.prepare("SELECT quoteBasis FROM application_handoff_events WHERE activityId = ?").get(ack.eventId).quoteBasis);
  assert.deepEqual(basis, { ...details, ...choice, loanAmount: scenario.loanAmount });

  const offer = { ...choice, feeRevision: 0, alternatives: [], expiresOn: "2026-11-13", previousPublishedAt: null, reviewRevision: 0, reviewNote: "" };
  assert.match((await change("publishDatedQuote", offer)).error, /expiration/);
  await ok("publishDatedQuote", { ...offer, expiresOn: details.expiresOn });
  const borrowerStatus = borrower({ type: "status" }).statusView;
  assert.match(JSON.stringify(borrowerStatus), /Fictional Harbor Wholesale/);
  assert.doesNotMatch(JSON.stringify(borrowerStatus), /PRIVATE-QA-REF-108/);
  const packageInput = { type: "create", loanId, ...base, manualQuote: choice, shareId: crypto.randomUUID(), token: portalToken(id),
    code: newPortalAccessCode(), recipient: details.lender, confirmedFictional: true, documents: [], hours: 1 };
  const read = { type: "download", slot: 0, token: packageInput.token, code: packageInput.code };
  assert.equal((await lenderShareWork(db, packageInput, pilot, id, undefined, new Date(at))).createdId, packageInput.shareId);
  assert.equal(lenderPackageAccess(db, read, at).xml, mismoXml);
  await ok("selectOffer", mock);
  assert.equal(lenderPackageAccess(db, read, at).status, 404);
  assert.match((await change("exportReviewedApplication", exportWith(choice))).error, /quote changed/);
  await ok("sendApplication", { revision, quote: mock });
  const submissionId = db.prepare("SELECT id FROM submissions WHERE lender = 'UWM'").get().id;
  await ok("selectOffer", choice);
  assert.match((await change("floatMockRate", { ...choice, submissionId, previousFloatReference: null })).error, /Choose a UWM offer/);
  assert.equal(JSON.parse(db.prepare("SELECT quoteBasis FROM application_handoff_events WHERE activityId = ?").get(ack.eventId).quoteBasis).reference, details.reference);
});

test("closing and funding policies link to current evidence and audit only a successful admin override", async (t) => {
  const { db, id, admin, officer, outsider, processor, roster } = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date(at) });
  const loanId = "loan";
  const read = { type: "loan", loanId };
  const work = (input, actor = admin, tenant = id) => closingGateWork(db, input, actor, tenant, at);
  const change = (type, fields = {}, actor = officer) => executeCommand(db, { type, loanId, ...fields }, actor, undefined, roster);
  const ok = async (type, fields, actor) => {
    const result = await change(type, fields, actor);
    assert.ok(!result.error, result.error);
    return result.state;
  };
  const exceptions = (filter = "Closing and funding holds") =>
    nameFileExceptions(readFileExceptions(db, { filter }, admin, id, new Date(at)), roster).items;
  const closing = { revision: 0, closingDate: today };
  const funding = { revision: 0, fundingDate: today };
  const publish = { type: "publish", revision: 0, rules: { closing: ["1003", "checklist"], funding: ["conditions"] },
    reason: "Check current evidence before recording milestones." };
  assert.deepEqual(work(read, officer).closing.blockers, []);
  assert.ok(work(publish, officer).error);
  assert.ok(work(publish, admin, crypto.randomUUID()).error);
  assert.equal(work(publish).revision, 1);
  assert.equal(work(publish).revision, 1);
  assert.match(work({ ...publish, rules: { closing: [], funding: [] } }).error, /changed/);
  assert.ok(work(read, outsider).error);
  assert.equal(work(read, processor).canOverride, false);
  assert.ok(readFileExceptions(db, { filter: "Closing and funding holds" }, officer, id).error);

  await ok("saveClosingTarget", { previous: null, targetDate: today });
  assert.deepEqual(work(read, officer).closing.blockers.map(({ target }) => target), ["loan-application", "closing-checklist-items"]);
  const checklist = { itemId: crypto.randomUUID(), revision: 0, title: "Review fictional escrow statement", owner: "Processor", dueDate: today };
  await ok("saveClosingItem", checklist);
  assert.deepEqual(exceptions().map(({ target, owner, dueOn }) => [target, owner, dueOn]).sort(), [
    [`closing-checklist-${checklist.itemId}`, processor.name, today], ["loan-application", officer.name, today],
  ].sort());
  assert.equal(exceptions("All file exceptions").filter(({ kind }) => kind === "Closing and funding holds").length, 2);
  assert.match((await change("recordClosing", closing)).error, /before recording closing/);
  assert.match((await change("move", { id: loanId, stage: "Funded" })).error, /record the funding date/i);
  const reason = "Reviewed the outstanding fictional evidence.";
  const closingOverride = { reason, key: work(read).closing.key };
  assert.match((await change("recordClosing", { ...closing, gateOverride: closingOverride })).error, /Only a brokerage admin/);
  const { token } = (await ok("startApplication")).applications[0];
  const borrower = (input) => borrowerCommandResult(db, { token, ...input });
  const initial = borrower({ type: "read" }).application;
  const draft = { ...sampleApplication(initial.draft), confirmedDemo: true };
  const submitted = borrower({ type: "submit", revision: initial.revision, step: 9, draft }).application;
  await ok("reviewApplication", { revision: submitted.revision });
  assert.deepEqual(exceptions().map(({ target }) => target), [`closing-checklist-${checklist.itemId}`]);
  assert.match((await change("recordClosing", { ...closing, gateOverride: closingOverride }, admin)).error, /checks changed/);
  await ok("completeClosingItem", { itemId: checklist.itemId, revision: 1, completed: true }, processor);
  await ok("recordClosing", closing);

  const condition = { id: "title", category: "Title", group: null, description: "Fictional pending title review", uploaded: false, satisfiedAt: null };
  insertSubmission(db, { id: "mock-lender-file", loanId, lender: "UWM", externalId: "DEMO-title", status: "Open", conditions: [condition], syncedAt: at });
  assert.deepEqual(exceptions().map(({ status, target }) => [status, target]), [["Before funding", "lender-condition-mock-lender-file:title"]]);
  assert.match((await change("recordFunding", funding)).error, /before recording funding/);
  const openCondition = (changes) => db.prepare("UPDATE submissions SET conditions = ? WHERE id = 'mock-lender-file'").run(JSON.stringify([{ ...condition, ...changes }]));
  openCondition({ mockReopenedAt: at });
  const overrideFunding = () => ({ ...funding, gateOverride: { reason, key: work(read).funding.key } });
  assert.match((await change("recordFunding", overrideFunding(), admin)).error, /reopened/i);
  const staleFunding = overrideFunding();
  openCondition({ description: "Fictional title evidence changed" });
  assert.match((await change("recordFunding", staleFunding, admin)).error, /checks changed/);
  const fundingOverride = overrideFunding();
  await ok("recordFunding", fundingOverride, admin);
  await ok("recordFunding", fundingOverride, admin);
  assert.deepEqual(exceptions(), []);
  const audits = db.prepare("SELECT actor, action, changes FROM loan_audit WHERE action LIKE 'Overrode required %'").all();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor, admin.email);
  assert.equal(audits[0].action, "Overrode required funding checks");
  assert.ok(JSON.parse(audits[0].changes).some(({ field, after }) => field === "Reason" && after === reason));
});

test("stage policy locks staff edits, audits only successful overrides, and keeps mock borrower work open", async (t) => {
  const { db, id, admin, officer, outsider, processor, roster } = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date(at) });
  const loanId = "loan";
  const work = (input, actor = admin, tenant = id) => loanStageEditWork(db, input, actor, tenant, at);
  const change = (type, fields = {}, actor = officer) =>
    executeCommand(db, { type, loanId, ...fields }, { ...actor, brokerage: { ...actor.brokerage, pilot: true } }, undefined, roster);
  const apply = async (type, fields, actor) => {
    const result = await change(type, fields, actor);
    assert.ok(!result.error, result.error);
    return result.state;
  };
  const { token } = (await apply("startApplication")).applications[0];
  const borrower = (input) => borrowerCommandResult(db, { token, ...input });
  const initial = borrower({ type: "read" }).application;
  const draft = { ...sampleApplication(initial.draft), confirmedDemo: true };
  const submitted = borrower({ type: "submit", revision: initial.revision, step: 9, draft }).application;
  await apply("reviewApplication", { revision: submitted.revision });
  const scenario = { purpose: "Purchase", loanAmount: Number(draft.loanAmount), propertyValue: 450000, purchasePrice: 450000,
    zip: draft.propertyLocation.zip, creditScore: 760, monthlyIncome: 9500, occupancy: "Primary residence",
    propertyType: "Single family", firstTimeBuyer: false };
  const [run] = (await apply("runPricing", { scenario, applicationRevision: submitted.revision })).pricingRuns;
  const choice = { runId: run.id, offerId: run.offers[0].id };
  await apply("selectOffer", choice);
  const fees = { origination: 95_000, appraisal: 65_000, creditReport: 0, settlement: 100_000, government: 0, prepaid: 0, escrow: 0, other: 0 };
  const worksheet = { fees, purchasePrice: 45_000_000, payoffs: null, deposit: 0, sellerCredits: 0, otherCredits: 0 };
  await apply("saveFeeWorksheet", { ...choice, feeRevision: 0, worksheet });
  await apply("prepareDisclosurePackage", { ...choice, feeRevision: 1, applicationRevision: submitted.revision,
    previousVersion: null, documents: sampleDisclosureDocuments, signBy: today });
  const before = readDisclosureWork(db, loanId).packages[0];
  const rules = { application: ["Processing"], fees: ["Processing"] };
  const publish = { type: "publish", revision: 0, rules, reason: "Keep the fictional processing file stable." };
  assert.equal(work({ type: "settings" }).revision, 0);
  assert.ok(work(publish, officer).error);
  assert.ok(work(publish, admin, "another-brokerage").error);
  assert.equal(work(publish).revision, 1);
  assert.equal(work(publish).revision, 1);
  assert.ok(work({ ...publish, rules: { ...rules, fees: [] } }).error);
  const read = { type: "loan", loanId };
  assert.deepEqual(work(read, officer).locked, { application: true, fees: true });
  assert.equal(work(read, processor).canOverride, false);
  assert.equal(work(read).canOverride, true);
  assert.ok(work(read, outsider).error);
  await apply("issueDisclosurePackage", { version: before.version, revision: before.revision });
  const signed = borrower({ type: "respondToSampleDisclosure", version: before.version, response: "Signed", confirmedDemo: true });
  assert.ok(signed.statusView, signed.error);
  assert.equal(readDisclosureWork(db, loanId).packages[0].signers[0].status, "Signed");

  const stageOverride = { revision: 1, stage: "Processing", reason: "Verified the revised fictional vendor fee." };
  const edit = { ...choice, feeRevision: 1, worksheet: { ...worksheet, fees: { ...fees, appraisal: 71_000 } } };
  const audit = () => db.prepare("SELECT actor, action, changes FROM loan_audit WHERE action LIKE 'Admin stage override%' ORDER BY rowid").all();
  assert.match((await change("saveFeeWorksheet", edit)).error, /locked at Processing/);
  assert.match((await change("saveAllocatedFeeWorksheet", edit, admin)).error, /locked at Processing/);
  assert.match((await change("saveFeeWorksheet", { ...edit, stageOverride })).error, /Only a brokerage admin/);
  assert.match((await change("saveFeeWorksheet", { ...edit, stageOverride: { ...stageOverride, stage: "Underwriting" } }, admin)).error, /changed/);
  assert.match((await change("selectOffer", { runId: run.id, offerId: run.offers[1].id })).error, /locked at Processing/);
  assert.equal(audit().length, 0);
  assert.equal(readDisclosureWork(db, loanId).packages[0].reviewReason, null);
  assert.equal(db.prepare("SELECT revision FROM fee_worksheets WHERE runId = ? AND offerId = ?").get(choice.runId, choice.offerId).revision, 1);
  await apply("saveAllocatedFeeWorksheet", { ...edit, stageOverride }, admin);
  await apply("saveAllocatedFeeWorksheet", { ...edit, stageOverride }, admin);
  const [feeAudit] = audit();
  assert.equal(audit().length, 1);
  assert.equal(feeAudit.actor, admin.email);
  assert.ok(JSON.parse(feeAudit.changes).some(({ field, after }) => field === "Internal reason" && after === stageOverride.reason));
  assert.equal(readDisclosureWork(db, loanId).packages[0].reviewReason, "Fees changed");
  assert.ok(db.prepare("SELECT 1 FROM tasks WHERE loanId = ? AND title = 'Review disclosure package · Fees changed' AND completedAt IS NULL").get(loanId));

  const supplement = { revision: 0, details: blankLenderDetails() };
  assert.match((await change("saveLenderDetails", supplement, processor)).error, /locked at Processing/);
  await apply("saveLenderDetails", { ...supplement, stageOverride: { ...stageOverride, reason: "Verified the fictional lender details." } }, admin);
  const correction = { revision: submitted.revision, note: "Please recheck the fictional property details." };
  assert.match((await change("requestApplicationCorrection", correction, processor)).error, /locked at Processing/);
  await apply("requestApplicationCorrection", { ...correction, stageOverride: { ...stageOverride, reason: "Reopen the fictional property section." } }, admin);
  const reopened = borrower({ type: "read" }).application;
  const resubmitted = borrower({ type: "submit", revision: reopened.revision, step: 9, draft }).application;
  assert.ok(resubmitted.submittedAt);
  await apply("reviewApplication", { revision: resubmitted.revision });
  assert.equal(audit().length, 3);
  assert.doesNotMatch(JSON.stringify(borrower({ type: "status" })), /Internal reason|revised fictional vendor fee/);
  assert.equal(work({ ...publish, revision: 1, rules: { application: [], fees: [] }, reason: "Restore the usual staff edit access." }).revision, 2);
  assert.match((await change("saveLenderDetails", { ...supplement, revision: 1, stageOverride }, admin)).error, /changed/);
  await apply("saveLenderDetails", { ...supplement, revision: 1 }, processor);
});

test("matching disclosure templates pin documents and provenance through edits, signing, and fee review", async (t) => {
  const { db, id, admin, officer, roster } = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date(at) });
  const pilot = (actor) => ({ ...actor, brokerage: { ...actor.brokerage, pilot: true } });
  const loanId = "loan";
  const manage = (input, actor = admin, tenant = id) => disclosureTemplateWork(db, input, pilot(actor), tenant, at);
  const publish = (title, purpose, propertyState, documents) => ({ type: "publish", id: crypto.randomUUID(), revision: 0,
    config: { title, purpose, propertyState, documents } });
  const exact = publish("Michigan purchase package", "Purchase", "mi", [sampleDisclosureDocuments[0], sampleDisclosureDocuments[2]]);
  const regional = publish("Michigan all loans", "Any loan purpose", "MI", [...sampleDisclosureDocuments]);
  const generic = publish("General sample package", "Any loan purpose", "", [...sampleDisclosureDocuments]);
  const incompatible = publish("Ohio purchases", "Purchase", "OH", [...sampleDisclosureDocuments]);
  const refinance = publish("Michigan refinance", "Refinance", "MI", [...sampleDisclosureDocuments]);
  assert.ok(manage(exact, officer).error);
  assert.ok(manage(exact, admin, "other-brokerage").error);
  assert.ok(manage({ ...exact, config: { ...exact.config, propertyState: "XX" } }).error);
  for (const request of [generic, regional, incompatible, refinance, exact, exact]) assert.ok(!manage(request).error);
  assert.equal(manage({ type: "list" }).templates.find(({ id }) => id === exact.id).revision, 1);
  const michigan = { purpose: "Purchase", propertyState: "MI" };
  assert.deepEqual(disclosureTemplatesForLoan(db, michigan).templates.map(({ id }) => id), [exact.id, regional.id, generic.id]);
  assert.equal(disclosureTemplatesForLoan(db, michigan).recommendedId, exact.id);
  assert.deepEqual(disclosureTemplatesForLoan(db, { ...michigan, propertyState: "" }).templates.map(({ id }) => id), [generic.id]);
  const tied = publish("Michigan purchase alternative", "Purchase", "MI", [...sampleDisclosureDocuments]);
  assert.ok(!manage(tied).error);
  assert.equal(disclosureTemplatesForLoan(db, michigan).recommendedId, null);
  assert.ok(!manage({ type: "archive", id: tied.id, revision: 1, archived: true }).error);
  assert.equal(disclosureTemplatesForLoan(db, michigan).recommendedId, exact.id);

  const command = (type, fields = {}) => executeCommand(db, { type, loanId, ...fields }, pilot(officer), undefined, roster);
  const apply = async (type, fields) => {
    const result = await command(type, fields);
    assert.ok(!result.error, result.error);
    return result.state;
  };
  const { token } = (await apply("startApplication")).applications[0];
  const borrower = (input) => borrowerCommandResult(db, { token, ...input });
  const initial = borrower({ type: "read" }).application;
  const demo = sampleApplication(initial.draft);
  const draft = { ...demo, confirmedDemo: true, currentLocation: { ...demo.currentLocation, city: "Columbus", state: "OH", zip: "43215" } };
  const submitted = borrower({ type: "submit", revision: initial.revision, step: 9, draft }).application;
  assert.ok(submitted?.submittedAt);
  await apply("reviewApplication", { revision: submitted.revision });
  const scenario = { purpose: "Purchase", loanAmount: Number(draft.loanAmount), propertyValue: 450000, purchasePrice: 450000,
    zip: draft.propertyLocation.zip, creditScore: 760, monthlyIncome: 9500, occupancy: "Primary residence",
    propertyType: "Single family", firstTimeBuyer: false };
  const [run] = (await apply("runPricing", { scenario, applicationRevision: submitted.revision })).pricingRuns;
  const choice = { runId: run.id, offerId: run.offers[0].id };
  await apply("selectOffer", choice);
  const fees = { origination: 95_000, appraisal: 65_000, creditReport: 0, settlement: 100_000, government: 0, prepaid: 0, escrow: 0, other: 0 };
  const worksheet = { fees, purchasePrice: 45_000_000, payoffs: null, deposit: 0, sellerCredits: 0, otherCredits: 0 };
  await apply("saveFeeWorksheet", { ...choice, feeRevision: 0, worksheet });
  const read = () => readDisclosureWork(db, loanId);
  assert.equal(read().templateOptions.propertyState, "MI");
  assert.equal(read().templateOptions.recommendedId, exact.id);
  const prepare = { ...choice, feeRevision: 1, applicationRevision: submitted.revision, previousVersion: null,
    documents: exact.config.documents, signBy: today, template: { id: exact.id, revision: 1 } };
  assert.match((await command("prepareDisclosurePackage", { ...prepare, template: { id: incompatible.id, revision: 1 } })).error, /no longer matches/);
  assert.match((await command("prepareDisclosurePackage", { ...prepare, documents: [...sampleDisclosureDocuments] })).error, /differs from this template/);
  await apply("prepareDisclosurePackage", prepare);
  const original = read().packages[0];
  assert.deepEqual(original.templateBasis, { id: exact.id, revision: 1, title: exact.config.title, purpose: "Purchase", propertyState: "MI" });

  const nextConfig = { ...exact.config, title: "Updated Michigan purchase", documents: [...sampleDisclosureDocuments] };
  assert.ok(!manage({ ...exact, revision: 1, config: nextConfig }).error);
  assert.match((await command("prepareDisclosurePackage", { ...prepare, previousVersion: 1 })).error, /template changed/);
  await apply("issueDisclosurePackage", { version: 1, revision: original.revision });
  const response = borrower({ type: "respondToSampleDisclosure", version: 1, response: "Signed", confirmedDemo: true });
  assert.ok(response.statusView, response.error);
  assert.doesNotMatch(JSON.stringify(response), /Michigan purchase package|templateBasis/);
  const signed = read().packages[0].signers[0];
  assert.ok(signed.receipt);
  assert.deepEqual(read().packages[0].documents, exact.config.documents);
  await apply("saveFeeWorksheet", { ...choice, feeRevision: 1, worksheet: { ...worksheet, fees: { ...fees, appraisal: 67_500 } } });
  const reviewedPackageRevision = read().packages[0].revision;
  await apply("prepareDisclosurePackage", { ...prepare, previousVersion: 1, feeRevision: 2, documents: nextConfig.documents,
    template: { id: exact.id, revision: 2 }, reviewedPackageRevision, revisionNote: "Checked the new fictional fee and template." });
  const [revised, previous] = read().packages;
  assert.equal(revised.templateBasis.revision, 2);
  assert.deepEqual(revised.documents, nextConfig.documents);
  assert.equal(revised.signers[0].status, "Pending");
  assert.deepEqual(previous.templateBasis, original.templateBasis);
  assert.deepEqual(previous.signers[0], signed);
  assert.ok(!manage({ type: "archive", id: exact.id, revision: 2, archived: true }).error);
  assert.equal(read().templateOptions.recommendedId, regional.id);
  await apply("prepareDisclosurePackage", { ...prepare, previousVersion: 2, feeRevision: 2, template: undefined });
  assert.equal(read().packages[0].templateBasis, undefined);
  assert.equal(read().packages[1].templateBasis.revision, 2);
});

const reviewTime = "2026-11-09T03:30:00.000Z";

function secondReviewFixture(t, pilot = false) {
  const base = fixture(t, pilot);
  const { db, admin, officer, work } = base;
  const formerReviewer = { name: "Former reviewer", email: "former-reviewer@example.test", role: "Admin", status: "Active", accessRevision: 1 };
  const roster = [...base.roster, formerReviewer];
  const reviewer = roster.find(({ email }) => email === admin.email);
  t.mock.timers.enable({ apis: ["Date"], now: new Date(reviewTime) });
  const command = (input, actor = officer, options) => executeCommand(db, input, actor, undefined, roster, options);
  const save = (fields = {}, actor = admin) => command({ type: "savePlaybook", revision: readPlaybook(db).revision,
    quietHours: 48, reviewHours: 24, handoffHours: 24, fundingDays: 7, backupEmail: null, ...fields }, actor);
  const enable = (dueDays = 2) => save({ secondReview: { reviewerEmail: reviewer.email, dueDays } });
  const submit = (revision) => db.prepare("UPDATE applications SET submittedAt = ?, revision = ?, correctionNote = '' WHERE loanId = 'loan'")
    .run(reviewTime, revision);
  const review = (revision, actor = officer, routing = { reviewerEmail: reviewer.email, reviewer }) =>
    command({ type: "reviewApplication", loanId: "loan", revision }, actor, { reviewRouting: routing });
  const approve = (id) => work({ type: "decide", decision: "Approved", loanId: "loan", id, eventId: crypto.randomUUID(),
    revision: 1, note: "Approved the fictional evidence." }, admin, roster, reviewTime);
  const file = (actor = officer) => work({ type: "loan", loanId: "loan" }, actor, roster, reviewTime);
  assert.equal(startApplication(db, "loan", reviewTime), true);
  return { ...base, roster, reviewer, formerReviewer, command, save, enable, submit, review, approve, file };
}

test("preflight pins sample evidence, rejects stale decisions, and keeps the approval history", async (t) => {
  const { db, officer, processor, outsider, admin, roster, work, create } = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: new Date(at) });
  const pilot = (staff) => ({ ...staff, brokerage: { ...staff.brokerage, pilot: true } });
  const loanId = "loan";
  const preflight = (staff = officer) => work({ type: "preflight", loanId }, pilot(staff));
  const lookup = (input, staff = officer) => work({ loanId, ...input }, pilot(staff));
  const mutate = async (type, fields = {}) => {
    const result = await executeCommand(db, { type, loanId, ...fields }, pilot(officer), undefined, roster);
    assert.ok(!result.error, result.error);
    return result.state ?? result.loanWork;
  };
  assert.ok(work({ type: "preflight", loanId }, officer).error);
  assert.ok(preflight(outsider).error);
  assert.ok(work({ type: "preflight", loanId }, { ...pilot(admin), brokerage: { ...pilot(admin).brokerage, id: "another-brokerage" } }).error);
  const missing = preflight().preflight;
  assert.equal(missing.checks.find(({ id }) => id === "1003").target, "loan-application");
  assert.equal(missing.checks.find(({ id }) => id === "disclosures").state, "Needs attention");
  const request = create({ category: "File preflight", preflightKey: missing.key });
  assert.equal(lookup(request).kind, "saved");
  assert.equal(lookup(request).kind, "saved");
  assert.match(lookup({ ...request, id: crypto.randomUUID() }).error, /already has a preflight review/);
  const detail = { type: "detail", id: request.id };
  const decide = (decision, revision) => ({ type: "decide", id: request.id, revision, decision, eventId: crypto.randomUUID(), note: "Fictional evidence reviewed." });
  assert.match(lookup(decide("Approved", 1), processor).error, /Resolve the preflight issues/);
  assert.match(lookup(decide("Changes requested", 1), admin).error, /current assigned reviewer/);
  assert.equal(lookup(decide("Changes requested", 1), processor).kind, "saved");
  assert.equal(lookup(detail).history[0].preflight.key, missing.key);
  assert.equal(lookup({ type: "queue", view: "Requested by me", filter: "Open" }).reviews[0].status, "Changes requested");

  const app = (await mutate("startApplication")).applications[0];
  const borrower = (input) => borrowerCommandResult(db, { token: app.token, ...input });
  const initial = borrower({ type: "read" }).application;
  const draft = { ...sampleApplication(initial.draft), confirmedDemo: true };
  const submitted = borrower({ type: "submit", revision: initial.revision, step: 9, draft }).application;
  assert.ok(submitted?.submittedAt);
  await mutate("reviewApplication", { revision: submitted.revision });
  const scenario = { purpose: "Purchase", loanAmount: Number(draft.loanAmount), propertyValue: 450000, purchasePrice: 450000,
    zip: draft.propertyLocation.zip, creditScore: 760, monthlyIncome: 9500, occupancy: "Primary residence",
    propertyType: "Single family", firstTimeBuyer: false };
  const [run] = (await mutate("runPricing", { applicationRevision: submitted.revision, scenario })).pricingRuns;
  const choice = { runId: run.id, offerId: run.offers[0].id };
  await mutate("selectOffer", choice);
  const sampleFees = { origination: 95_000, appraisal: 65_000, creditReport: 0, settlement: 100_000, government: 0, prepaid: 0, escrow: 0, other: 0 };
  const worksheet = { fees: { ...sampleFees, appraisal: null }, purchasePrice: 45_000_000, payoffs: null,
    deposit: 0, sellerCredits: 0, otherCredits: 0 };
  await mutate("saveFeeWorksheet", { ...choice, feeRevision: 0, worksheet });
  assert.equal(preflight().preflight.checks.find(({ id }) => id === "fees").target, "preflight-fee-worksheet-appraisal");
  await mutate("saveFeeWorksheet", { ...choice, feeRevision: 1, worksheet: { ...worksheet, fees: sampleFees } });
  await mutate("prepareDisclosurePackage", { ...choice, feeRevision: 2, applicationRevision: submitted.revision,
    previousVersion: null, documents: sampleDisclosureDocuments, signBy: today });
  const version = () => {
    const [row] = readDisclosureWork(db, loanId).packages;
    return { version: row.version, revision: row.revision };
  };
  await mutate("issueDisclosurePackage", version());
  await mutate("respondToDisclosurePackage", { ...version(), signer: "Borrower", response: "Signed" });
  assert.equal(preflight().preflight.checks.find(({ id }) => id === "disclosures").target, "closing-disclosure-review");
  await mutate("confirmClosingDisclosure", version());
  await mutate("sendApplication", { revision: submitted.revision, quote: choice });
  const lender = db.prepare("SELECT id, conditions, externalId FROM submissions WHERE loanId = ?").get(loanId);
  const conditions = JSON.parse(lender.conditions);
  assert.equal(preflight().preflight.checks.find(({ id }) => id.startsWith("condition:")).state, "Needs attention");
  db.prepare("UPDATE submissions SET conditions = ? WHERE id = ?").run(JSON.stringify(conditions.map((item) => ({ ...item, satisfiedAt: at }))), lender.id);
  const ready = preflight().preflight;
  assert.ok(ready.checks.every(({ state }) => state === "Ready"), JSON.stringify(ready.checks));
  const resend = { type: "resubmit", id: request.id, revision: 2, eventId: crypto.randomUUID(), dueOn: today,
    note: "Resolved the sample issues.", preflightKey: ready.key };
  assert.match(lookup({ ...resend, preflightKey: missing.key }).error, /preflight changed/);
  assert.equal(lookup(resend).kind, "saved");
  assert.equal(lookup(detail, processor).review.canDecide, true);
  const decision = decide("Approved", 3);
  assert.equal(lookup(decision, processor).kind, "saved");
  assert.equal(lookup(decision, processor).kind, "saved");
  assert.equal(preflight().latest.current, true);
  assert.equal(preflight().canRequest, false);
  const approved = lookup(detail).history[0];
  assert.deepEqual([approved.action, approved.actorName, approved.preflight.key], ["Approved", processor.name, ready.key]);
  await mutate("saveFeeWorksheet", { ...choice, feeRevision: 2, worksheet: { ...worksheet, fees: { ...sampleFees, appraisal: 70_000 } } });
  assert.equal(preflight().latest.current, false);
  assert.equal(preflight().canRequest, true);
  assert.equal(lookup(detail).review.evidenceChanged, true);
  assert.deepEqual(lookup(detail).history[0], approved);
  assert.doesNotMatch(JSON.stringify(borrower({ type: "status" })), /preflight|Resolved the sample issues/i);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("a named closing reviewer returns and approves exact signed versions without bypassing the handoff", async (t) => {
  const { db, id, officer, processor, admin, outsider, roster, work, create } = fixture(t, true);
  t.mock.timers.enable({ apis: ["Date"], now: new Date(at) });
  const loanId = "loan";
  const command = (type, fields, actor = officer) => executeCommand(db, { type, loanId, ...fields }, actor, undefined, roster);
  const ok = async (type, fields, actor) => {
    const result = await command(type, fields, actor);
    assert.ok(!result.error, result.error);
    return result.state ?? result.loanWork;
  };
  const application = (await ok("startApplication")).applications[0];
  const borrower = (input) => borrowerCommandResult(db, { token: application.token, ...input });
  const initial = borrower({ type: "read" }).application;
  const draft = { ...sampleApplication(initial.draft), confirmedDemo: true };
  const submitted = borrower({ type: "submit", revision: initial.revision, step: 9, draft }).application;
  await ok("reviewApplication", { revision: submitted.revision });
  const scenario = { purpose: "Purchase", loanAmount: Number(draft.loanAmount), propertyValue: 450000, purchasePrice: 450000,
    zip: draft.propertyLocation.zip, creditScore: 760, monthlyIncome: 9500, occupancy: "Primary residence",
    propertyType: "Single family", firstTimeBuyer: false };
  const [run] = (await ok("runPricing", { applicationRevision: submitted.revision, scenario })).pricingRuns;
  const choice = { runId: run.id, offerId: run.offers[0].id };
  await ok("selectOffer", choice);
  const saveFees = (feeRevision, settlement) => ok("saveFeeWorksheet", { ...choice, feeRevision, worksheet: {
    fees: { origination: 95_000, appraisal: 65_000, creditReport: 0, settlement, government: 0, prepaid: 0, escrow: 0, other: 0 },
    purchasePrice: 45_000_000, payoffs: null, deposit: 0, sellerCredits: 0, otherCredits: 0,
  } });
  const packageRef = () => {
    const [{ version, revision }] = readDisclosureWork(db, loanId).packages;
    return { version, revision };
  };
  async function signedReplacement(feeRevision, previous) {
    await ok("prepareDisclosurePackage", { ...choice, feeRevision, applicationRevision: submitted.revision, documents: sampleDisclosureDocuments,
      previousVersion: previous?.version ?? null, signBy: today,
      ...(previous ? { reviewedPackageRevision: previous.revision, revisionNote: "Reconciled the fictional settlement fee." } : {}) });
    await ok("issueDisclosurePackage", packageRef());
    await ok("respondToDisclosurePackage", { ...packageRef(), signer: "Borrower", response: "Signed" });
    return packageRef();
  }
  const isOpenTask = ({ version }) => !!db.prepare("SELECT 1 FROM tasks WHERE id = ? AND completedAt IS NULL")
    .get(`${disclosureClosingReviewPrefix}${loanId}:${version}`);
  await saveFees(0, 125_000);
  const first = await signedReplacement(1);
  await ok("confirmClosingDisclosure", first);
  await saveFees(1, 137_500);
  const second = await signedReplacement(2, packageRef());
  assert.equal(isOpenTask(second), true);
  assert.deepEqual(work({ type: "loan", loanId, prepareClosing: true }).closingPackage, second);
  const assignment = create({ category: closingPackageReviewCategory, closingPackage: second });
  assert.ok(work({ ...assignment, closingPackage: first }).error);
  assert.ok(work(assignment, { ...admin, brokerage: { ...admin.brokerage, pilot: false } }).error);
  assert.ok(work(assignment, { ...admin, brokerage: { ...admin.brokerage, id: "foreign" } }).error);
  assert.equal(work(assignment).kind, "saved");
  assert.equal(work(assignment).kind, "saved");
  assert.ok(work({ ...assignment, id: crypto.randomUUID() }).error);
  assert.equal(isOpenTask(second), false);
  assert.match((await command("confirmClosingDisclosure", second, admin)).error, /assigned closing package review/);
  const detail = { type: "detail", loanId, id: assignment.id };
  assert.ok(work(detail, outsider).error);
  const assigned = work({ type: "queue", view: "Assigned to me", filter: "Open" }, processor);
  assert.equal(assigned.reviews[0].id, assignment.id);
  assert.equal(work(detail, processor).review.closingPackage.changeReview.changes.find(({ label }) => label === "Title and settlement").after, "$1,375.00");
  const change = { type: "decide", loanId, id: assignment.id, revision: 1, eventId: crypto.randomUUID(),
    decision: "Changes requested", note: "Correct the title and settlement entry before approval." };
  assert.match(work(change, admin).error, /assigned reviewer/);
  assert.match(work(change, processor, roster.map((member) => member.email === processor.email ?
    { ...member, accessRevision: member.accessRevision + 1 } : member)).error, /assigned reviewer/);
  assert.equal(work(change, processor).kind, "saved");
  assert.equal(work(change, processor).kind, "saved");
  const returned = work(detail);
  assert.equal(returned.review.status, "Changes requested");
  assert.deepEqual(returned.history[0].closingPackage, second);
  assert.equal(returned.history[0].note, change.note);
  assert.equal(readDisclosureWork(db, loanId).closingAssignment.correctionReason, change.note);
  assert.ok(work({ type: "inbox", unread: false }).notices.some(({ reviewId, label }) => reviewId === assignment.id && label === "Changes requested"));
  const resend = { type: "resubmit", loanId, id: assignment.id, revision: 2, eventId: crypto.randomUUID(), dueOn: today, note: "Reconciled the title estimate." };
  assert.match(work({ ...resend, closingPackage: second }).error, /newer sample package/);
  await saveFees(2, 151_000);
  const third = await signedReplacement(3, packageRef());
  assert.equal(isOpenTask(third), false);
  assert.match((await command("confirmClosingDisclosure", third, admin)).error, /assigned closing package review/);
  assert.deepEqual(work(detail).review.resubmitClosingPackage, third);
  assert.equal(work({ ...resend, closingPackage: third }).kind, "saved");
  const approve = { ...change, revision: 3, eventId: crypto.randomUUID(), decision: "Approved", note: "Verified the corrected settlement entry." };
  assert.equal(work(approve, processor).kind, "saved");
  assert.equal(isOpenTask(third), true);
  await ok("confirmClosingDisclosure", third, processor);
  assert.equal(isOpenTask(third), false);
  const history = work(detail).history.map(({ action, closingPackage }) => [action, closingPackage.version]);
  assert.deepEqual(history, [["Approved", 3], ["Resubmitted", 3], ["Changes requested", 2], ["Requested", 2]]);
  await saveFees(3, 165_000);
  assert.equal(work(detail).review.evidenceChanged, true);
  assert.deepEqual(work(detail).history.map(({ action, closingPackage }) => [action, closingPackage.version]), history);
  assert.doesNotMatch(JSON.stringify(borrower({ type: "status" })), /Correct the title|reconciled the title|closingAssignment|closingPackage/i);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("the second 1003 review rule defaults off, validates the selected admin, and survives an older playbook save", async (t) => {
  const { db, admin, officer, formerReviewer, save, enable, submit, review, file } = secondReviewFixture(t);
  assert.equal(readPlaybook(db).secondReview, null);
  submit(7);
  const initial = await review(7, officer, null);
  assert.ok(initial.state, initial.error);
  assert.deepEqual(file().reviews, []);

  assert.match((await save({ secondReview: { reviewerEmail: officer.email, dueDays: 2 } })).error, /active brokerage admin/i);
  assert.match((await save({ secondReview: { reviewerEmail: "missing@example.test", dueDays: 2 } })).error, /active brokerage admin/i);
  formerReviewer.status = "Revoked";
  assert.match((await save({ secondReview: { reviewerEmail: formerReviewer.email, dueDays: 2 } })).error, /active brokerage admin/i);
  assert.ok((await save({ secondReview: { reviewerEmail: admin.email, dueDays: 15 } })).error);
  assert.match((await save({ secondReview: { reviewerEmail: admin.email, dueDays: 2 } }, officer)).error, /only a brokerage admin/i);
  assert.equal(readPlaybook(db).secondReview, null);

  const enabled = await enable();
  assert.ok(enabled.state, enabled.error);
  const rule = { reviewerEmail: admin.email, dueDays: 2 };
  assert.deepEqual(readPlaybook(db).secondReview, rule);
  assert.ok((await save({ quietHours: 72 })).state);
  assert.deepEqual(readPlaybook(db).secondReview, rule);
  assert.equal(readPlaybook(db).quietHours, 72);
  assert.ok((await save({ secondReview: null })).state);
  assert.equal(readPlaybook(db).secondReview, null);
});

test("the first staff review routes one second review at the Eastern deadline and preserves it on a corrected 1003", async (t) => {
  const { db, admin, officer, reviewer, formerReviewer, command, save, enable, submit, review, file, work } = secondReviewFixture(t);
  assert.ok((await save({ secondReview: { reviewerEmail: formerReviewer.email, dueDays: 2 } })).state);
  assert.ok((await enable()).state);
  submit(7);

  const staleDirectory = await review(7, officer, { reviewerEmail: formerReviewer.email, reviewer: formerReviewer });
  assert.match(staleDirectory.error, /routing changed/i);
  assert.equal(db.prepare("SELECT reviewedAt FROM applications WHERE loanId = 'loan'").get().reviewedAt, null);
  assert.deepEqual(file().reviews, []);

  const first = await review(7);
  assert.ok(first.state, first.error);
  assert.equal(db.prepare("SELECT reviewedAt FROM applications WHERE loanId = 'loan'").get().reviewedAt, reviewTime);
  const [created] = file().reviews;
  assert.deepEqual([created.category, created.status, created.requesterName, created.reviewerName, created.dueOn],
    ["1003 second review", "Requested", officer.name, reviewer.name, "2026-11-10"]);
  const detail = () => work({ type: "detail", loanId: "loan", id: created.id }, admin, undefined, reviewTime);
  assert.equal(detail().review.applicationRevision, 7);
  assert.equal(detail().review.canDecide, true);
  const assigned = () => work({ type: "inbox", unread: true }, admin, undefined, reviewTime).notices
    .filter(({ label }) => label === "Review assigned").map(({ reviewId }) => reviewId);
  assert.deepEqual(assigned(), [created.id]);

  assert.ok((await review(7)).state);
  assert.deepEqual(file().reviews.map(({ id }) => id), [created.id]);
  assert.deepEqual(detail().history.map(({ action }) => action), ["Requested"]);
  assert.deepEqual(assigned(), [created.id]);

  const correction = await command({ type: "requestApplicationCorrection", loanId: "loan", revision: 7, note: "Please correct the fictional 1003." });
  assert.ok(correction.state, correction.error);
  submit(8);
  assert.ok((await review(8)).state);
  assert.deepEqual(file().reviews.map(({ id }) => id), [created.id]);
  assert.equal(detail().review.applicationRevision, 7);
  assert.equal(detail().review.evidenceChanged, true);
  assert.equal(work({ type: "resubmit", loanId: "loan", id: created.id, eventId: crypto.randomUUID(), revision: 1,
    dueOn: "2026-11-10", note: "Review the corrected fictional application." }, officer, undefined, reviewTime).kind, "saved");
  assert.equal(detail().review.applicationRevision, 8);
  assert.equal(detail().review.evidenceChanged, false);
});

test("an approved second review on the current 1003 remains the only second review", async (t) => {
  const { admin, officer, work, create, enable, submit, review, file } = secondReviewFixture(t);
  assert.ok((await enable()).state);
  submit(7);
  const existing = create({ category: "1003 second review", reviewerEmail: admin.email });
  assert.equal(work(existing, officer, undefined, reviewTime).kind, "saved");
  assert.equal(work({ type: "decide", decision: "Approved", loanId: "loan", id: existing.id, eventId: crypto.randomUUID(),
    revision: 1, note: "Approved the fictional evidence." }, admin, undefined, reviewTime).kind, "saved");

  const result = await review(7);
  assert.ok(result.state, result.error);
  assert.deepEqual(file().reviews.map(({ id, status }) => [id, status]), [[existing.id, "Approved"]]);
});

test("a self-assigned or unavailable second reviewer leaves a durable manager exception until a manual request", async (t) => {
  for (const reason of ["self-review", "unavailable"]) {
    await t.test(reason, async (t) => {
      const { db, id, admin, officer, processor, reviewer, roster, work, create, enable, submit, review, file } = secondReviewFixture(t);
      const actor = reason === "self-review" ? admin : officer;
      assert.ok((await enable(0)).state);
      submit(7);
      const result = await review(7, actor, { reviewerEmail: reviewer.email, reviewer: reason === "self-review" ? reviewer : null });
      assert.ok(result.state, result.error);
      assert.equal(db.prepare("SELECT reviewedAt FROM applications WHERE loanId = 'loan'").get().reviewedAt, reviewTime);
      const loan = file(actor);
      assert.deepEqual(loan.reviews, []);
      assert.equal(loan.routingBlock.dueOn, today);
      assert.match(loan.routingBlock.reason, reason === "self-review" ? /recorded the first review/i : /unavailable/i);

      const exceptions = (filter = "Internal reviews") => nameFileExceptions(
        readFileExceptions(db, { filter }, admin, id, new Date(reviewTime)), roster).items;
      const [exception] = exceptions();
      assert.deepEqual([exception.kind, exception.status, exception.loanId, exception.dueOn, exception.target, exception.evidence],
        ["Internal reviews", "Reviewer needed", "loan", today, loanReviewsTarget, "Submitted 1003 revision 7"]);
      assert.ok(exceptions("All file exceptions").some(({ id }) => id === exception.id));
      assert.ok((await review(7, actor, { reviewerEmail: reviewer.email, reviewer: null })).state);
      assert.deepEqual(exceptions().map(({ id }) => id), [exception.id]);

      const unrelated = create({ reviewerEmail: processor.email });
      assert.equal(work(unrelated, actor, roster, reviewTime).kind, "saved");
      assert.deepEqual(file(actor).routingBlock, loan.routingBlock);
      const request = create({ category: "1003 second review", reviewerEmail: processor.email });
      assert.equal(work(request, actor, roster, reviewTime).kind, "saved");
      assert.equal(file(actor).routingBlock, undefined);
      assert.deepEqual(file(actor).reviews.filter(({ category }) => category === "1003 second review").map(({ id }) => id), [request.id]);
      assert.deepEqual(exceptions(), []);
    });
  }
});

test("the processing checkpoint requires a staff-reviewed 1003 and approval of its exact revision at both handoffs", async (t) => {
  const { db, id, admin, processor, nextProcessor, command, save, submit, review, work, create, approve } = secondReviewFixture(t);
  const apply = async (input, actor) => {
    const result = await command(input, actor);
    assert.ok(result.state, result.error);
    return result.state;
  };
  const transition = (action, revision) => ({ type: "updateProcessing", loanId: "loan", action, revision, note: "" });
  const queue = (readyOnly = true, actor = processor) => readProcessorQueue(db, { readyOnly }, actor, id).files.map(({ id }) => id);
  const state = () => db.prepare("SELECT status, revision FROM loan_processing WHERE loanId = 'loan'").get();
  const requestApproval = (category) => {
    const request = create({ category, reviewerEmail: admin.email });
    assert.equal(work(request, undefined, undefined, reviewTime).kind, "saved");
    return request.id;
  };
  const approvalNeeded = /approved second review/i;

  assert.ok((await save({ requireSecondReview: true })).state);
  const returned = await apply(transition("Return to LO", 1), processor);
  assert.equal(returned.loanProcessing[0].status, "Returned to LO");
  const send = transition("Send to processing", 2);
  assert.match((await command(send)).error, /submit the current 1003 before the required second review/i);
  submit(7);
  assert.match((await command(send)).error, /first review.*current 1003/i);
  assert.ok((await review(7)).state);
  assert.equal(approve(requestApproval("General file review")).kind, "saved");
  assert.match((await command(send)).error, approvalNeeded);
  const firstReview = requestApproval("1003 second review");
  assert.match((await command(send)).error, approvalNeeded);
  assert.deepEqual({ ...state() }, { status: "Returned to LO", revision: 2 });

  assert.equal(approve(firstReview).kind, "saved");
  const ready = await apply(send);
  assert.equal(ready.applications[0].secondReviewApproved, true);
  assert.equal(ready.loanProcessing[0].status, "Ready for processing");
  assert.deepEqual(queue(), ["loan"]);
  assert.deepEqual(queue(true, admin), ["loan"]);
  assert.deepEqual(queue(true, nextProcessor), []);
  const accept = transition("Accept handoff", 3);
  const corrected = await apply({ type: "requestApplicationCorrection", loanId: "loan", revision: 7, note: "Correct the fictional application." });
  assert.equal(corrected.applications[0].secondReviewApproved, false);
  assert.match((await command(accept, processor)).error, /submit the current 1003 before the required second review/i);
  assert.deepEqual(queue(), []);
  assert.deepEqual(queue(false), ["loan"]);
  assert.ok((await save({ requireSecondReview: false })).state);
  assert.deepEqual(queue(), []);
  submit(8);
  assert.deepEqual(queue(), []);
  assert.ok((await review(8)).state);
  assert.deepEqual(queue(), ["loan"]);
  assert.ok((await save({ requireSecondReview: true })).state);
  assert.deepEqual(queue(), []);
  assert.deepEqual(queue(false), ["loan"]);
  assert.match((await command(accept, processor)).error, approvalNeeded);
  assert.deepEqual({ ...state() }, { status: "Ready for processing", revision: 3 });

  assert.equal(approve(requestApproval("1003 second review")).kind, "saved");
  assert.deepEqual(queue(), ["loan"]);
  const accepted = await apply(accept, processor);
  assert.equal(accepted.applications[0].secondReviewApproved, true);
  assert.equal(accepted.loanProcessing[0].status, "In processing");
  assert.deepEqual(queue(), []);
});

test("the mock UWM checkpoint gates initial and revised sends while manual MISMO export still works", async (t) => {
  const { db, admin, command, save, submit, review, work, create, approve } = secondReviewFixture(t, true);
  const token = db.prepare("SELECT token FROM applications WHERE loanId = 'loan'").get().token;
  const borrower = () => borrowerCommandResult(db, { type: "read", token });
  const draft = { ...sampleApplication(borrower().application.draft), confirmedDemo: true };
  db.prepare("UPDATE applications SET draft = ? WHERE loanId = 'loan'").run(JSON.stringify(draft));
  const send = (revision) => command({ type: "sendApplication", loanId: "loan", revision });
  const files = () => db.prepare("SELECT id, externalId FROM submissions WHERE loanId = 'loan' AND lender = 'UWM'").all();
  const receipts = () => db.prepare("SELECT revision, uwmReceipt FROM application_versions WHERE loanId = 'loan' AND uwmReceipt IS NOT NULL ORDER BY revision").all();
  const approveCurrent = () => {
    const request = create({ category: "1003 second review", reviewerEmail: admin.email });
    assert.equal(work(request, undefined, undefined, reviewTime).kind, "saved");
    assert.equal(approve(request.id).kind, "saved");
  };

  assert.ok((await save({ requireSecondReview: true })).state);
  submit(7);
  const reviewed = await review(7);
  assert.ok(reviewed.state, reviewed.error);
  assert.equal(reviewed.state.applications[0].secondReviewApproved, false);
  assert.match((await send(7)).error, /approved second review/i);
  assert.deepEqual(files(), []);
  assert.deepEqual(receipts(), []);
  const exportId = crypto.randomUUID();
  const exported = await command({ type: "exportReviewedApplication", loanId: "loan", revision: 7, lenderRevision: 0,
    eventId: exportId, names: [{ first: "Fictional", middle: "", last: "Borrower", suffix: "" }] });
  assert.match(exported.mismoXml, /MISMOReferenceModelIdentifier/);
  assert.deepEqual(exported.state.applications[0].manualHandoff, { exportPrepared: true, outcome: null,
    preparedExports: [{ eventId: exportId, profile: "basic" }] });

  approveCurrent();
  const initial = await send(7);
  assert.ok(initial.state, initial.error);
  assert.equal(initial.state.applications[0].secondReviewApproved, true);
  assert.doesNotMatch(JSON.stringify(borrower()), /secondReviewApproved|Approved the fictional evidence/);
  const firstFiles = files();
  const firstReceipts = receipts();
  assert.equal(firstFiles.length, 1);
  assert.equal(firstReceipts.length, 1);
  assert.equal(firstReceipts[0].revision, 7);
  assert.match(firstReceipts[0].uwmReceipt, /^DEMO-1003-/);

  const correction = await command({ type: "requestApplicationCorrection", loanId: "loan", revision: 7, note: "Correct the fictional application." });
  assert.ok(correction.state, correction.error);
  submit(8);
  assert.ok((await review(8)).state);
  assert.match((await send(8)).error, /approved second review/i);
  assert.deepEqual(files(), firstFiles);
  assert.deepEqual(receipts(), firstReceipts);

  approveCurrent();
  const revised = await send(8);
  assert.ok(revised.state, revised.error);
  assert.deepEqual(files(), firstFiles);
  const bothReceipts = receipts();
  assert.deepEqual(bothReceipts.map(({ revision }) => revision), [7, 8]);
  assert.deepEqual(bothReceipts[0], firstReceipts[0]);
  assert.notEqual(bothReceipts[1].uwmReceipt, bothReceipts[0].uwmReceipt);
  assert.ok((await send(8)).state);
  assert.deepEqual(receipts(), bothReceipts);
  assert.equal(db.prepare("SELECT count(*) AS count FROM activity WHERE loanId = 'loan' AND text LIKE 'Mock UWM received 1003 revision %'").get().count, 2);
});

test("enabling the checkpoint preserves an existing mock UWM receipt and survives legacy playbook saves", async (t) => {
  const { db, officer, command, save, submit, review } = secondReviewFixture(t, true);
  const send = () => command({ type: "sendApplication", loanId: "loan", revision: 7 });
  assert.equal(readPlaybook(db).requireSecondReview, false);
  assert.match((await save({ requireSecondReview: true }, officer)).error, /only a brokerage admin/i);
  submit(7);
  assert.ok((await review(7)).state);
  const initial = await send();
  assert.ok(initial.state, initial.error);
  const [firstVersion] = initial.state.applications[0].versions;
  assert.match(firstVersion.uwmReceipt.reference, /^DEMO-1003-/);
  assert.equal(initial.state.applications[0].secondReviewApproved, false);

  assert.ok((await save({ requireSecondReview: true })).state);
  assert.ok((await save({ quietHours: 72 })).state);
  assert.equal(readPlaybook(db).requireSecondReview, true);
  const retry = await send();
  assert.ok(retry.state, retry.error);
  assert.equal(retry.state.applications[0].secondReviewApproved, false);
  assert.deepEqual(retry.state.applications[0].versions, [firstVersion]);
  assert.deepEqual(retry.state.submissions, initial.state.submissions);
  assert.equal(db.prepare("SELECT count(*) AS count FROM activity WHERE loanId = 'loan' AND text LIKE 'Mock UWM received 1003 revision %'").get().count, 1);

  assert.ok((await save({ requireSecondReview: false })).state);
  assert.equal(readPlaybook(db).requireSecondReview, false);
});

test("the assigned reviewer signs off the submitted version and the decision trail stays staff-only", (t) => {
  const { db, id, admin, officer, outsider, processor, work, create } = fixture(t);
  const request = create({ category: "1003 second review", note: "Internal source note for the second reviewer" });
  assert.match(work(request).error, /submitted 1003/i);
  assert.equal(startApplication(db, "loan", new Date().toISOString()), true);
  db.exec(`UPDATE applications SET revision = 7, submittedAt = '${at}' WHERE loanId = 'loan'`);
  assert.ok(work({ ...request, reviewerEmail: outsider.email }).error);
  assert.ok(work({ ...request, reviewerEmail: officer.email }).error);
  assert.ok(work(request, outsider).error);
  assert.equal(work(request).kind, "saved");
  assert.equal(work(request).kind, "saved");
  const detail = { type: "detail", loanId: "loan", id: request.id };
  const current = (staff = processor) => work(detail, staff);
  assert.equal(current().review.applicationRevision, 7);
  assert.equal(current().review.canDecide, true);
  assert.equal(current(admin).review.canDecide, false);
  assert.equal(current().history.length, 1);
  assert.ok(current(outsider).error);
  assert.equal(reviewParticipants(db, reviewInput.parse(detail), outsider), null);
  const processorCalendar = () => readWorkspaceCalendar(db, { week: today, scope: "Mine", group: "Reviews" }, processor, id, new Date(at));
  assert.equal(processorCalendar().items[0].target, reviewTarget(request.id));
  const action = (type, revision, fields = {}) => ({ type, loanId: "loan", id: request.id, eventId: crypto.randomUUID(), revision, note: "Fictional evidence decision", ...fields });
  const approve = action("decide", 1, { decision: "Approved" });
  assert.ok(work(approve, admin).error);
  db.exec("UPDATE applications SET revision = 8 WHERE loanId = 'loan'");
  assert.equal(current().review.evidenceChanged, true);
  assert.match(work(approve, processor).error, /submitted 1003 changed/);
  assert.equal(work(action("resubmit", 1, { dueOn: today })).kind, "saved");
  assert.equal(work(action("decide", 2, { decision: "Changes requested" }), processor).kind, "saved");
  assert.equal(current().review.status, "Changes requested");
  assert.deepEqual(processorCalendar().items, []);
  const officerPage = readOfficerQueue(db, { horizon: 1 }, officer, id, new Date(at));
  assert.equal(officerPage.items.find(({ id }) => id === request.id).title, "Respond to review · Second look");
  assert.equal(work(action("resubmit", 3, { dueOn: today })).kind, "saved");
  const accepted = action("decide", 4, { decision: "Approved", note: "Private decision note should stay on the file" });
  assert.equal(work(accepted, processor).kind, "saved");
  assert.equal(work(accepted, processor).kind, "saved");
  assert.ok(work({ ...accepted, note: "Different replay" }, processor).error);
  const final = current();
  assert.equal(final.review.status, "Approved");
  assert.deepEqual(final.history.map(({ action }) => action), ["Approved", "Resubmitted", "Changes requested", "Resubmitted", "Requested"]);
  assert.equal(final.history[0].context, "1003 revision 8");
  assert.deepEqual(processorCalendar().items, []);
  assert.equal(db.prepare("SELECT stage FROM loans WHERE id = 'loan'").get().stage, "Processing");
  assert.equal(db.prepare("SELECT reviewedAt FROM applications WHERE loanId = 'loan'").get().reviewedAt, null);
  const token = db.prepare("SELECT token FROM applications WHERE loanId = 'loan'").get().token;
  const borrower = borrowerCommandResult(db, { type: "read", token });
  assert.equal(borrower.application.loanStatus.stage, "Processing");
  const realtorToken = "f".repeat(64);
  db.prepare("INSERT INTO realtor_portals (realtorId, token, expiresAt) VALUES ('partner', ?, '9999-01-01T00:00:00.000Z')").run(realtorToken);
  const realtor = realtorReferrals(db, { type: "read", token: realtorToken }, at);
  assert.equal(realtor.value.referrals.length, 1);
  for (const portal of [borrower, realtor]) assert.doesNotMatch(JSON.stringify(portal), /Internal source note|Private decision note|Second look/);
});

test("assignment and membership changes block stale reviewer access and managers can escalate or reassign", (t) => {
  const { db, admin, officer, outsider, processor, nextProcessor, roster, work, create } = fixture(t);
  const request = create({ category: "Closing readiness" });
  assert.equal(work(request, admin).kind, "saved");
  const detail = { type: "detail", loanId: "loan", id: request.id };
  const action = (type, revision, fields = {}) => ({ type, loanId: "loan", id: request.id, eventId: crypto.randomUUID(), revision, note: "Fictional blocker", ...fields });
  const queue = (view, filter, staff) => work({ type: "queue", view, filter }, staff);
  assert.ok(queue("Brokerage", "Open", officer).error);
  assert.equal(queue("Assigned to me", "Open", processor).reviews.length, 1);
  const returned = roster.map((member) => member.email === processor.email ? { ...member, accessRevision: 4 } : member);
  assert.equal(work(detail, processor, returned).review.canDecide, false);
  assert.ok(work(action("decide", 1, { decision: "Approved" }), processor, returned).error);
  db.prepare("UPDATE loan_processing SET processorEmail = ?, processorName = ? WHERE loanId = 'loan'").run(nextProcessor.email, nextProcessor.name);
  assert.ok(work(detail, processor).error);
  assert.deepEqual(queue("Assigned to me", "Open", processor).reviews, []);
  assert.equal(work(detail, admin).review.reviewerAvailable, false);
  assert.ok(work(action("escalate", 1), outsider).error);
  assert.equal(work(action("escalate", 1), admin).kind, "saved");
  assert.equal(queue("Brokerage", "Escalated", admin).reviews.length, 1);
  assert.ok(work(action("reassign", 2, { reviewerEmail: processor.email, dueOn: today }), admin).error);
  assert.equal(work(action("reassign", 2, { reviewerEmail: nextProcessor.email, dueOn: "2026-11-09" }), admin).kind, "saved");
  assert.equal(work(detail, nextProcessor).review.canDecide, true);
  assert.deepEqual(queue("Brokerage", "Escalated", admin).reviews, []);
  assert.ok(work(action("decide", 2, { decision: "Approved" }), nextProcessor).error);
  assert.equal(work(action("cancel", 3), admin).kind, "saved");
  assert.equal(work(detail, nextProcessor).review.status, "Canceled");
  assert.ok(loanReviewWork(db, reviewInput.parse(detail), admin, crypto.randomUUID(), roster).error);
  assert.equal(work({ type: "queue", view: "Brokerage", filter: "All" }, admin).reviews[0].loanId, "loan");
});

test("review queues and decision history have stable, bounded pages", (t) => {
  const { admin, processor, work, create } = fixture(t);
  const requests = Array.from({ length: 25 }, () => create());
  for (const request of requests) assert.equal(work(request).kind, "saved");
  const queue = { type: "queue", view: "Assigned to me", filter: "Open" };
  const page = work(queue, processor);
  const next = work({ ...queue, after: page.next }, processor);
  assert.equal(page.reviews.length, 20);
  assert.equal(next.reviews.length, 5);
  assert.equal(new Set([...page.reviews, ...next.reviews].map(({ id }) => id)).size, 25);
  const overdue = work({ ...queue, view: "Brokerage", filter: "Overdue" }, admin, undefined, "2026-11-09T05:00:00.000Z");
  assert.equal(overdue.reviews.length, 20);
  assert.ok(overdue.reviews.every((item) => item.overdue));
  const id = page.reviews[0].id;
  const comment = { type: "comment", loanId: "loan", id, note: "Fictional internal comment" };
  for (let index = 0; index < 24; index++) assert.equal(work({ ...comment, eventId: crypto.randomUUID() }, processor).kind, "saved");
  const detail = { type: "detail", loanId: "loan", id };
  const history = work(detail, processor);
  const older = work({ ...detail, before: history.before }, processor);
  assert.equal(history.history.length, 20);
  assert.equal(older.history.length, 5);
  assert.equal(older.history.at(-1).action, "Requested");
  assert.equal(history.review.revision, 1);
});

test("manager review exceptions show the current owner, stale evidence, and only unresolved work", (t) => {
  const { db, id, admin, officer, processor, roster, work, create } = fixture(t);
  assert.equal(startApplication(db, "loan", at), true);
  db.prepare("UPDATE applications SET revision = 4, submittedAt = ? WHERE loanId = 'loan'").run(at);
  const request = create({ category: "1003 second review" });
  assert.equal(work(request).kind, "saved");
  const read = (time, members = roster) => nameFileExceptions(readFileExceptions(db, { filter: "Internal reviews" }, admin, id, new Date(time)), members);
  assert.deepEqual(read(at).items, []);
  const overnight = "2026-11-09T05:00:00.000Z";
  const [due] = read(overnight).items;
  assert.equal(due.owner, processor.name);
  assert.equal(due.overdue, true);
  assert.equal(due.target, reviewTarget(request.id));
  assert.equal(due.evidence, "Submitted 1003 revision 4");
  assert.deepEqual(fileExceptionOwners(readFileExceptions(db, { filter: "Internal reviews" }, admin, id, new Date(overnight))), [processor.email]);
  const reinvited = roster.map((member) => member.email === processor.email ? { ...member, accessRevision: 2 } : member);
  assert.equal(read(overnight, reinvited).items[0].ownerAvailable, false);
  const action = (type, revision, fields = {}) => ({ type, id: request.id, loanId: "loan", eventId: crypto.randomUUID(), revision, note: "Fictional QA", ...fields });
  assert.equal(work(action("decide", 1, { decision: "Changes requested" }), processor).kind, "saved");
  assert.equal(read(overnight).items[0].owner, officer.name);
  assert.equal(read(overnight).items[0].action, "Respond to requested changes");
  assert.equal(work(action("resubmit", 2, { dueOn: today })).kind, "saved");
  db.exec("UPDATE applications SET revision = 5 WHERE loanId = 'loan'");
  assert.equal(read(at).items[0].owner, officer.name);
  assert.equal(read(at).items[0].action, "Resubmit the review for the current 1003");
  assert.equal(work(action("resubmit", 3, { dueOn: today })).kind, "saved");
  assert.equal(work(action("escalate", 4)).kind, "saved");
  assert.equal(read(at).items[0].escalated, true);
  assert.equal(work(action("decide", 5, { decision: "Approved" }), processor).kind, "saved");
  assert.deepEqual(read(overnight).items, []);
});

const requiredApprovals = "Required 1003 approvals";

function approvalExceptionPage({ db, id, admin, roster }, { filter = requiredApprovals, time = reviewTime, members = roster, after } = {}) {
  const page = readFileExceptions(db, { filter, after }, admin, id, new Date(time));
  assert.equal(page.error, undefined);
  return nameFileExceptions(page, members);
}

test("the required 1003 approval queue names the next actor and prioritizes the current revision", async (t) => {
  const context = secondReviewFixture(t);
  const { db, id, admin, officer, roster, command, save, submit, review, work, create, approve } = context;
  const read = (options) => approvalExceptionPage(context, options).items;
  const required = () => {
    const items = read();
    assert.equal(items.length, 1);
    return items[0];
  };
  const makeReview = (fields) => {
    const request = create({ reviewerEmail: admin.email, ...fields });
    assert.equal(work(request, officer, roster, reviewTime).kind, "saved");
    return request.id;
  };
  const selection = { filter: requiredApprovals };
  assert.ok(readFileExceptions(db, selection, officer, id).error);
  assert.ok(readFileExceptions(db, selection, null, id).error);
  assert.ok(readFileExceptions(db, selection, admin, crypto.randomUUID()).error);

  assert.deepEqual(read(), []);
  assert.ok((await save({ requireSecondReview: true })).state);
  assert.deepEqual(read(), []);
  submit(7);
  assert.deepEqual(read(), []);
  assert.ok((await review(7)).state);
  const missing = required();
  assert.deepEqual([missing.kind, missing.status, missing.owner, missing.dueOn, missing.target, missing.evidence],
    [requiredApprovals, "Reviewer needed", officer.name, null, loanReviewsTarget, "Submitted 1003 revision 7"]);
  assert.equal(missing.overdue, false);

  const general = makeReview({ category: "General file review" });
  const dueOn = "2026-11-10";
  const original = makeReview({ category: "1003 second review", dueOn });
  const pending = required();
  assert.deepEqual([pending.id, pending.status, pending.owner, pending.dueOn, pending.target],
    [original, "Awaiting approval", admin.name, dueOn, reviewTarget(original)]);
  assert.equal(pending.ownerAvailable, true);
  assert.equal(pending.overdue, false);
  const afterDue = "2026-11-11T05:00:00.000Z";
  assert.equal(read({ time: "2026-11-11T04:59:59.999Z" })[0].overdue, false);
  assert.equal(read({ time: afterDue })[0].overdue, true);
  const reinvited = roster.map((member) => member.email === admin.email ? { ...member, accessRevision: 2 } : member);
  const [unavailable] = read({ members: reinvited });
  assert.equal(unavailable.status, "Reviewer unavailable");
  assert.equal(unavailable.ownerAvailable, false);
  assert.equal(unavailable.target, reviewTarget(original));

  const all = () => read({ filter: "All file exceptions", time: afterDue });
  assert.deepEqual(all().map(({ id, kind }) => [id, kind]), [[general, "Internal reviews"], [original, requiredApprovals]]);
  const change = { type: "decide", loanId: "loan", id: original, eventId: crypto.randomUUID(), revision: 1,
    decision: "Changes requested", note: "Correct the fictional evidence." };
  assert.equal(work(change, admin, roster, reviewTime).kind, "saved");
  const returned = required();
  assert.deepEqual([returned.status, returned.owner, returned.dueOn, returned.target], ["Changes requested", officer.name, dueOn, reviewTarget(original)]);

  const correction = await command({ type: "requestApplicationCorrection", loanId: "loan", revision: 7, note: "Correct the fictional application." });
  assert.ok(correction.state, correction.error);
  assert.deepEqual(read(), []);
  submit(8);
  assert.deepEqual(read(), []);
  assert.ok((await review(8)).state);
  const stale = required();
  assert.deepEqual([stale.id, stale.status, stale.owner, stale.target, stale.evidence],
    [original, "Resubmission needed", officer.name, reviewTarget(original), "Submitted 1003 revision 8"]);

  const current = makeReview({ category: "1003 second review", dueOn: "2026-11-12" });
  assert.deepEqual([required().id, required().status], [current, "Awaiting approval"]);
  assert.deepEqual(all().map(({ id, kind }) => [id, kind]), [[general, "Internal reviews"], [current, requiredApprovals]]);
  assert.equal(approve(current).kind, "saved");
  assert.deepEqual(read(), []);

  assert.ok((await save({ requireSecondReview: false })).state);
  assert.deepEqual(read(), []);
  const internal = read({ filter: "Internal reviews", time: afterDue });
  assert.deepEqual(internal.map(({ id }) => id), [general, original]);
});

test("a missing required reviewer keeps the captured routing deadline without a duplicate internal exception", async (t) => {
  const context = secondReviewFixture(t);
  const { officer, reviewer, save, submit, review } = context;
  assert.ok((await save({ requireSecondReview: true, secondReview: { reviewerEmail: reviewer.email, dueDays: 2 } })).state);
  submit(7);
  assert.ok((await review(7, officer, { reviewerEmail: reviewer.email, reviewer: null })).state);

  const required = approvalExceptionPage(context).items;
  assert.equal(required.length, 1);
  const [item] = required;
  assert.deepEqual([item.status, item.owner, item.dueOn, item.target], ["Reviewer needed", officer.name, "2026-11-10", loanReviewsTarget]);
  assert.deepEqual(approvalExceptionPage(context, { filter: "All file exceptions" }).items, required);

  assert.ok((await save({ requireSecondReview: false })).state);
  assert.deepEqual(approvalExceptionPage(context).items, []);
  const [legacy] = approvalExceptionPage(context, { filter: "Internal reviews" }).items;
  assert.deepEqual([legacy.status, legacy.dueOn, legacy.target], [item.status, item.dueOn, item.target]);
});

test("an exact mock UWM receipt leaves only an assigned or ready processor handoff in the approval queue", async (t) => {
  const context = secondReviewFixture(t, true);
  const { db, command, save, submit, review } = context;
  submit(7);
  assert.ok((await review(7)).state);
  const sent = await command({ type: "sendApplication", loanId: "loan", revision: 7 });
  assert.ok(sent.state, sent.error);
  assert.ok((await save({ requireSecondReview: true })).state);

  const rows = () => approvalExceptionPage(context).items;
  assert.deepEqual(rows(), []);
  const processing = db.prepare("UPDATE loan_processing SET status = ? WHERE loanId = 'loan'");
  for (const status of ["Assigned", "Ready for processing"]) {
    processing.run(status);
    assert.deepEqual(rows().map(({ loanId, evidence }) => [loanId, evidence]), [["loan", "Submitted 1003 revision 7"]]);
  }
  processing.run("In processing");
  assert.deepEqual(rows(), []);
  assert.ok((await command({ type: "requestApplicationCorrection", loanId: "loan", revision: 7, note: "Correct the fictional application." })).state);
  submit(8);
  assert.ok((await review(8)).state);
  assert.deepEqual(rows().map(({ loanId, evidence }) => [loanId, evidence]), [["loan", "Submitted 1003 revision 8"]]);
  db.exec("UPDATE loans SET disposition = 'On hold' WHERE id = 'loan'");
  assert.deepEqual(rows(), []);
  db.exec("UPDATE loans SET disposition = 'Active', stage = 'Funded' WHERE id = 'loan'");
  assert.deepEqual(rows(), []);
});

test("a current manual receipt preserves condition work until the application is corrected or processing is pending", async (t) => {
  const context = secondReviewFixture(t);
  const { db, command, enable, save, submit, review, file, officer, reviewer } = context;
  const token = db.prepare("SELECT token FROM applications WHERE loanId = 'loan'").get().token;
  const draft = { ...sampleApplication(borrowerCommandResult(db, { type: "read", token }).application.draft), confirmedDemo: true };
  db.prepare("UPDATE applications SET draft = ? WHERE loanId = 'loan'").run(JSON.stringify(draft));
  const unavailable = { reviewerEmail: reviewer.email, reviewer: null };
  assert.ok((await enable()).state);
  submit(7);
  assert.ok((await review(7, officer, unavailable)).state);
  assert.ok(file().routingBlock);
  const prepared = await command({ type: "exportReviewedApplication", loanId: "loan", revision: 7, lenderRevision: 0,
    eventId: crypto.randomUUID(), names: [{ first: "Fictional", middle: "", last: "Borrower", suffix: "" }] });
  assert.ok(prepared.mismoXml);
  const receipt = await command({ type: "recordManualHandoff", loanId: "loan", revision: 7, lenderRevision: 0, eventId: crypto.randomUUID(),
    outcome: "Acknowledged", note: "", lenderFile: { lender: "Fictional lender", externalId: "MANUAL-7" } });
  const submissionId = receipt.state.applications[0].manualHandoff.submissionId;
  assert.ok((await command({ type: "saveManualCondition", loanId: "loan", submissionId, conditionId: crypto.randomUUID(), revision: 0,
    category: "Income", owner: "Loan officer", description: "Fictional income request." })).state);
  assert.ok((await save({ requireSecondReview: true })).state);

  const next = () => {
    const state = workspace(db);
    const action = loanNextAction(state.loans[0], state, "LO").title;
    const pipeline = readPipeline(db, { view: "List", search: "", filters: emptyPipelineFilters }, officer);
    const stalled = stalledLoanPage(db, officer, { type: "stalledLoans", stage: "" }, new Date("2026-11-20T15:00:00.000Z"));
    assert.equal(pipeline.list.loans[0].action.title, action);
    assert.equal(stalled.items[0].action, action);
    return action;
  };
  const required = () => approvalExceptionPage(context).items;
  assert.equal(next(), "Work income condition");
  assert.deepEqual(required(), []);
  assert.deepEqual(approvalExceptionPage(context, { filter: "All file exceptions" }).items, []);
  assert.equal(file().routingBlock, undefined);
  const processing = db.prepare("UPDATE loan_processing SET status = ? WHERE loanId = 'loan'");
  for (const status of ["Assigned", "Ready for processing"]) {
    processing.run(status);
    assert.equal(next(), "Complete required second review");
    assert.equal(required()[0].evidence, "Submitted 1003 revision 7");
    assert.ok(file().routingBlock);
  }
  processing.run("In processing");
  const returned = await command({ type: "requestApplicationCorrection", loanId: "loan", revision: 7, note: "Correct the fictional amount.",
    lenderReturn: { eventId: crypto.randomUUID(), submissionId, lenderRevision: 0 } });
  assert.ok(returned.state, returned.error);
  assert.deepEqual(required(), []);
  submit(8);
  assert.ok((await review(8, officer, unavailable)).state);
  assert.equal(next(), "Complete required second review");
  assert.equal(required()[0].evidence, "Submitted 1003 revision 8");
  assert.ok(file().routingBlock);
});

test("required approval pages preserve loans with tied fallback dates", async (t) => {
  const context = secondReviewFixture(t);
  const { db, officer, save } = context;
  assert.ok((await save({ requireSecondReview: true })).state);
  const ids = Array.from({ length: 24 }, (_, index) => `approval-${String(index).padStart(2, "0")}`);
  const reviewed = db.prepare("UPDATE applications SET submittedAt = ?, reviewedAt = ?, revision = 7 WHERE loanId = ?");
  for (const id of ids) {
    insertLoan(db, { id, contactId: "borrower", partnerId: null, officer: officer.name, officerEmail: officer.email,
      address: "", purpose: "Purchase", stage: "Processing", stageSince: reviewTime, amount: 275000 });
    assert.equal(startApplication(db, id, reviewTime), true);
    reviewed.run(reviewTime, reviewTime, id);
  }
  const first = approvalExceptionPage(context);
  const second = approvalExceptionPage(context, { after: first.next });
  assert.deepEqual([first.items.length, second.items.length], [20, 4]);
  assert.equal(second.next, null);
  assert.deepEqual([...first.items, ...second.items].map(({ loanId }) => loanId).sort(), ids);
  assert.ok([...first.items, ...second.items].every(({ dueOn, status }) => dueOn === null && status === "Reviewer needed"));
});

test("review mentions and handoffs are private, scoped, and read once per recipient", (t) => {
  const { db, id, admin, officer, outsider, processor, nextProcessor, roster, work, create } = fixture(t);
  const request = create({ dueOn: "2026-11-12" });
  const inbox = { type: "inbox", unread: true };
  assert.equal(work(request).kind, "saved");
  assert.equal(work(request).kind, "saved");
  const assigned = work(inbox, processor).notices;
  assert.deepEqual(assigned.map(({ label }) => label), ["Review assigned"]);
  assert.doesNotMatch(JSON.stringify(assigned), /Fictional internal instructions/);
  const read = { type: "readNotice", id: assigned[0].id, reviewId: request.id };
  assert.ok(work(read, admin).error);
  assert.ok(work(read, processor, []).error);
  assert.ok(loanReviewWork(db, reviewInput.parse(read), processor, `${id}-wrong`, roster).error);
  assert.deepEqual(work(read, processor), { kind: "noticeRead", loanId: "loan", reviewId: request.id });
  assert.equal(work(read, processor).kind, "noticeRead");
  assert.deepEqual(work(inbox, processor).notices, []);
  assert.equal(work({ ...inbox, unread: false }, processor).notices[0].read, true);

  const note = { type: "comment", loanId: "loan", id: request.id, eventId: crypto.randomUUID(), note: "Internal example comment", mentionEmail: officer.email };
  assert.ok(work({ ...note, mentionEmail: outsider.email }, processor).error);
  assert.ok(work({ ...note, mentionEmail: processor.email }, processor).error);
  assert.ok(work({ ...note, mentionEmail: officer.email }, processor, roster.map((member) =>
    member.email === officer.email ? { ...member, status: "Revoked" } : member)).error);
  assert.equal(work(note, processor).kind, "saved");
  assert.equal(work(note, processor).kind, "saved");
  assert.deepEqual(work(inbox, officer).notices.map(({ label }) => label), ["Mentioned in a comment"]);
  assert.deepEqual(work(inbox, outsider).notices, []);
  const history = work({ type: "detail", loanId: "loan", id: request.id }, officer).history;
  assert.equal(history.filter(({ context }) => context === "Mentioned officer").length, 1);
  const reinvited = roster.map((member) => member.email === officer.email ? { ...member, accessRevision: 2 } : member);
  assert.deepEqual(work(inbox, officer, reinvited).notices, []);

  const change = { type: "decide", loanId: "loan", id: request.id, eventId: crypto.randomUUID(), revision: 1,
    decision: "Changes requested", note: "Fictional corrections" };
  assert.equal(work(change, processor).kind, "saved");
  assert.ok(work(inbox, officer).notices.some(({ label }) => label === "Changes requested"));
  db.prepare("UPDATE loan_processing SET processorEmail = ? WHERE loanId = 'loan'").run(nextProcessor.email);
  assert.deepEqual(work({ ...inbox, unread: false }, processor).notices, []);
  assert.ok(work(read, processor).error);
});

test("current deadlines recover across date, assignment, and review changes without duplicate notices", (t) => {
  const { db, admin, officer, processor, nextProcessor, roster, work, create } = fixture(t);
  const request = create({ dueOn: "2026-11-09" });
  const before = "2026-11-09T04:59:59.999Z";
  const due = "2026-11-09T05:00:00.000Z";
  const overdue = "2026-11-10T05:00:00.000Z";
  const inbox = { type: "inbox", unread: true };
  const reminders = (staff, time, members) => work(inbox, staff, members, time).notices.filter(({ actor }) => actor === null);
  const action = (type, revision, fields = {}) => ({ type, revision, loanId: "loan", id: request.id, eventId: crypto.randomUUID(), note: "Fictional review update", ...fields });
  assert.equal(work(request).kind, "saved");
  assert.deepEqual(reminders(processor, before), []);
  assert.deepEqual(reminders(processor, due).map(({ label }) => label), ["Review due today"]);
  const notice = reminders(processor, due)[0];
  assert.equal(work({ type: "readNotice", id: notice.id, reviewId: request.id }, processor, undefined, due).kind, "noticeRead");
  assert.equal(work(action("escalate", 1), admin, undefined, due).kind, "saved");
  assert.deepEqual(reminders(processor, due), []);
  assert.deepEqual(reminders(processor, overdue).map(({ label }) => label), ["Review overdue"]);
  const reinvited = roster.map((member) => member.email === processor.email ? { ...member, accessRevision: 2 } : member);
  assert.deepEqual(reminders(processor, overdue, reinvited), []);

  assert.equal(work(action("decide", 2, { decision: "Changes requested" }), processor, undefined, due).kind, "saved");
  assert.deepEqual(reminders(processor, due), []);
  assert.equal(reminders(officer, due).length, 1);
  assert.equal(work(action("resubmit", 3, { dueOn: "2026-11-12" }), officer, undefined, due).kind, "saved");
  assert.ok(work(inbox, processor).notices.some(({ label }) => label === "Review resubmitted"));
  assert.deepEqual(reminders(officer, due), []);
  assert.deepEqual(reminders(processor, due), []);

  db.prepare("UPDATE loan_processing SET processorEmail = ? WHERE loanId = 'loan'").run(nextProcessor.email);
  assert.equal(work(action("reassign", 4, { dueOn: "2026-11-09", reviewerEmail: nextProcessor.email }), admin, undefined, due).kind, "saved");
  assert.deepEqual(reminders(nextProcessor, due).map(({ label }) => label), ["Review due today"]);
  assert.equal(work(action("decide", 5, { decision: "Approved" }), nextProcessor, undefined, due).kind, "saved");
  assert.deepEqual(reminders(nextProcessor, overdue), []);
  assert.ok(work(inbox, officer).notices.some(({ label }) => label === "Review approved"));
});

test("review inbox pages mix handoffs and reminders without dropping tied rows", (t) => {
  const { processor, work, create } = fixture(t);
  for (let i = 0; i < 25; i++) assert.equal(work(create()).kind, "saved");
  const query = { type: "inbox", unread: true };
  const first = work(query, processor);
  const second = work({ ...query, after: first.next }, processor);
  const third = work({ ...query, after: second.next }, processor);
  assert.deepEqual([first, second, third].map(({ notices }) => notices.length), [20, 20, 10]);
  assert.equal(new Set([first, second, third].flatMap(({ notices }) => notices.map(({ id }) => id))).size, 50);
  assert.equal(third.next, null);
});

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

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { complianceCaseWork } = await import("../src/lib/compliance-cases.ts");
const { staffApplications } = await import("../src/lib/applications.ts");

test("Michigan loan practices preserve independent findings, scope and term boundaries on the pilot loan", t => {
  const { db, work, addLoan, officer, processor, unrelated } = fixture(t);
  const loanId = addLoan({ state: " mi " });
  const other = addLoan({ state: "OH" });
  const record = (input, actor) => work({ type: "michiganLoanPractices", input }, actor);
  const read = (id, actor) => record({ operation: "read", state: "MI", loanId: id }, actor);
  const evidence = { reference: "Fictional evidence", result: "No concern recorded" };
  const service = { key: "appraisal", reference: "Fictional vendor record", feeCharged: "Yes", provided: "No",
    thirdPartyAmount: "Discrepancy" };
  const term = { reference: "Fictional note", startsOn: "2026-11-01", maturesOn: "2027-11-01",
    regularPaymentsAmortize: "No", bridgeForPrincipalDwelling: "Yes" };
  const facts = { state: "MI", reviewedOn: "2026-11-06", zone: "America/Detroit", scope: "Unresolved",
    scopeReference: "Fictional scope record", serviceInventory: "Listed charges reviewed",
    serviceInventoryReference: "Fictional charge inventory", services: [service],
    representations: evidence, applicationChanges: { ...evidence, result: "Concern recorded" },
    appraisalPayment: { ...evidence, result: "Unresolved" }, appraisalInfluence: evidence,
    premium: { reference: "Fictional credit life premium", financedSinglePremiumCreditCoverage: "Yes" }, term };
  const request = { operation: "save", loanId, expectedRevision: 0, requestId: crypto.randomUUID(), facts };
  assert.ok(read(other, officer).error);
  assert.ok(read(loanId, unrelated).error);
  assert.ok(record(request, processor).error);
  assert.ok(record({ ...request, facts: { ...facts, reviewedOn: "2026-11-15" } }, officer).error);
  assert.ok(record({ ...request, facts: { ...facts, services: [service, { ...service, key: "Appraisal" }] } }, officer).error);
  assert.ok(record({ ...request, facts: { ...facts, term: { ...term, maturesOn: term.startsOn } } }, officer).error);
  const saved = record(request, officer);
  assert.equal(saved.revision, 1);
  assert.equal(saved.review.scope, "Unresolved");
  const outcomes = result => Object.fromEntries(result.review.reviews.map(row =>
    [row.requirement, row.findings.map(finding => finding.status)]));
  assert.deepEqual(outcomes(saved), {
    "REQ-MI-LOAN-CMPA-SERVICE": ["Review concern", "Review concern"],
    "REQ-MI-LOAN-CMPA-INTEGRITY": ["Review concern", "Evidence gap"],
    "REQ-MI-LOAN-CMPA-APPRAISAL": ["Evidence gap"],
    "REQ-MI-LOAN-CMPA-PREMIUM": ["Review concern"],
    "REQ-MI-LOAN-CMPA-TERM": ["Review concern"],
  });
  assert.equal(record(request, officer).history.length, 1);
  assert.ok(record({ ...request, requestId: crypto.randomUUID() }, officer).error);
  assert.ok(record({ ...request, expectedRevision: 1, requestId: crypto.randomUUID() }, officer).error);
  const correct = (expectedRevision, fields) => record({ ...request, expectedRevision, requestId: crypto.randomUUID(),
    correction: "Fictional schedule correction", facts: { ...facts, term: { ...term, ...fields } } }, officer);
  assert.deepEqual(outcomes(correct(1, { maturesOn: "2027-10-31" }))["REQ-MI-LOAN-CMPA-TERM"], []);
  assert.deepEqual(outcomes(correct(2, { maturesOn: "2031-11-01" }))["REQ-MI-LOAN-CMPA-TERM"], []);
  const leap = correct(3, { startsOn: "2024-02-29", maturesOn: "2025-02-28" });
  assert.deepEqual(outcomes(leap)["REQ-MI-LOAN-CMPA-TERM"], ["Evidence gap"]);
  const history = read(loanId, processor).history;
  assert.equal(history[3].facts.term.maturesOn, "2027-11-01");
  assert.equal(history[0].correction, "Fictional schedule correction");
  const noProof = record({ ...request, expectedRevision: 4, requestId: crypto.randomUUID(), correction: "Fictional no-charge review",
    facts: { ...facts, serviceInventory: "No charges identified", serviceInventoryReference: undefined, services: [] } }, officer);
  assert.deepEqual(outcomes(noProof)["REQ-MI-LOAN-CMPA-SERVICE"], ["Evidence gap"]);
  db.prepare("UPDATE loans SET disposition='Paused' WHERE id=?").run(loanId);
  assert.match(correct(5, {}).error, /paused/);
});

test("Kansas notice keeps consumer-specific trigger reviews, rule dates and version history", (t) => {
  const { db, work, addLoan, officer, processor, unrelated, admin, staff, roster, brokerageId } = fixture(t);
  const loanId = addLoan({ state: " ks " });
  const other = addLoan({ state: "MI" });
  const record = (input, actor) => work({ type: "kansasNotice", input }, actor);
  const read = (id, actor) => record({ operation: "read", state: "KS", loanId: id }, actor);
  assert.equal(staffApplications(db, loanId)[0].hasKansasProperty, true);
  assert.equal(staffApplications(db, loanId)[0].draft, null);
  assert.ok(read(other, officer).error);
  assert.ok(read(loanId, unrelated).error);
  const input = { type: "kansasNotice", input: { operation: "read", state: "KS", loanId } };
  const actor = staff(admin);
  assert.deepEqual(complianceCaseWork(db, input, {
    ...actor, brokerage: { ...actor.brokerage, features: { compliance: false, uwm: false } },
  }, brokerageId, roster, at), unavailable);
  assert.deepEqual(complianceCaseWork(db, input, {
    ...actor, brokerage: { ...actor.brokerage, pilot: false, features: { compliance: true, uwm: false } },
  }, brokerageId, roster, at), unavailable);
  const date = (on, time) => ({ on, time, reference: "Fictional dated record" });
  const notice = (on, time) => ({ ...date(on, time), version: "Fictional notice v1", reviewedContents: true });
  const primary = { recipient: "Primary consumer", notice: notice("2026-11-03", "09:00"), reviewedTriggers: true,
    contract: date("2026-11-03", "09:30"), compensation: date("2026-11-03", "08:00") };
  const additional = { recipient: "Additional consumer", notice: notice("2026-11-05"), reviewedTriggers: true,
    transfer: date("2026-10-21") };
  const facts = { state: "KS", zone: "America/Chicago", recipientScope: "Two consumers",
    scopeReference: "Fictional Kansas role review", consumers: [primary, additional] };
  const request = { operation: "save", loanId, expectedRevision: 0, requestId: crypto.randomUUID(), facts };
  assert.ok(record(request, processor).error);
  assert.ok(record({ ...request, facts: { ...facts, consumers: [primary, primary] } }, officer).error);
  assert.ok(record({ ...request, facts: { ...facts, consumers: [{ ...primary, contract: date("2026-11-15") }, additional] } }, officer).error);
  const saved = record(request, officer);
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.review.consumers[0].timing.map(item => item.result), ["Before", "After"]);
  assert.equal(saved.review.consumers[1].cutoff, "2026-11-05");
  assert.equal(saved.review.consumers[1].timing[0].result, "Same date, order unresolved");
  assert.equal(record(request, officer).history.length, 1);
  assert.ok(record({ ...request, requestId: crypto.randomUUID() }, officer).error);
  assert.ok(record({ ...request, expectedRevision: 1, requestId: crypto.randomUUID() }, officer).error);
  const historical = record({ ...request, expectedRevision: 1, requestId: crypto.randomUUID(), correction: "Fictional earlier notice record",
    facts: { ...facts, consumers: [{ ...primary, notice: notice("2026-07-23"), compensation: date("2026-07-23") }] } }, officer);
  assert.match(historical.review.scopeGaps[0], /additional consumer/);
  assert.match(historical.review.consumers[0].gaps[0], /before July 24/);
  assert.equal(historical.history[1].facts.consumers.length, 2);
  assert.equal(read(loanId, processor).revision, 2);
});

test("state refinance benefit review preserves different state evidence and closing checks", (t) => {
  const { db, work, addLoan, officer, processor, unrelated } = fixture(t);
  const mn = addLoan({ state: " mn ", purpose: "Refinance" });
  const ne = addLoan({ state: "NE", purpose: "Refinance" });
  const purchase = addLoan({ state: "NE", purpose: "Purchase" });
  const record = (input, actor) => work({ type: "stateRefinanceBenefit", input }, actor);
  const event = on => ({ on, reference: "Fictional document reference" });
  const common = { applicability: "Covered for internal review", scopeReference: "Fictional scope",
    comparisonReference: "Fictional terms and costs", outcome: "Benefit documented", rationale: "Fictional terms reviewed",
    closed: event("2026-11-06") };
  const save = (loanId, facts) => ({ operation: "save", loanId, facts: { ...common, ...facts },
    requestId: crypto.randomUUID(), expectedRevision: 0 });
  const read = (loanId, state, actor) => record({ operation: "read", loanId, state }, actor);
  assert.equal(staffApplications(db, mn)[0].draft, null);
  assert.equal(staffApplications(db, mn)[0].refinanceBenefitState, "MN");
  assert.ok(read(mn, "NE", officer).error);
  assert.ok(read(purchase, "NE", officer).error);
  assert.ok(read(mn, "MN", unrelated).error);
  const mnSave = save(mn, { state: "MN", applicationCircumstances: event("2026-11-02"), signed: event("2026-11-06") });
  assert.ok(record(mnSave, processor).error);
  assert.ok(record({ ...mnSave, facts: { ...mnSave.facts, signed: event("2026-11-12") } }, officer).error);
  assert.match(record(mnSave, officer).review[0], /on or after the closing date/);
  assert.equal(record(mnSave, officer).revision, 1);
  assert.ok(record({ ...mnSave, requestId: crypto.randomUUID() }, officer).error);
  assert.ok(record({ ...mnSave, expectedRevision: 1, requestId: crypto.randomUUID() }, officer).error);
  const update = record({ ...mnSave, expectedRevision: 1, requestId: crypto.randomUUID(), correction: "Fictional revised signature record",
    facts: { ...mnSave.facts, signed: event("2026-11-05") } }, officer);
  assert.deepEqual(update.review, []);
  assert.equal(update.history[1].facts.signed.on, "2026-11-06");
  assert.equal(read(mn, "MN", processor).revision, 2);
  const neSave = save(ne, { state: "NE", zone: "America/Chicago", outcome: "No benefit identified",
    worksheetVersion: "2026-10-15", delivered: event("2026-11-06"), acknowledged: event("2026-11-05") });
  assert.deepEqual(record(neSave, officer).review.map(gap => gap.includes("predates delivery") || gap.includes("establish that order")), [true, true]);
  const historical = record({ ...neSave, requestId: crypto.randomUUID(), expectedRevision: 1, correction: "Fictional date correction",
    facts: { ...neSave.facts, closed: event("2026-07-17"), delivered: event("2026-07-15"), acknowledged: event("2026-07-15") } }, officer);
  assert.match(historical.review[0], /predates July 18/);
  db.prepare("UPDATE loans SET purpose='Purchase' WHERE id=?").run(ne);
  assert.ok(read(ne, "NE", officer).error);
});

test("broker agreement evidence keeps state triggers and corrections with the accessible pilot loan", (t) => {
  const { db, work, addLoan, admin, officer, processor, unrelated } = fixture(t);
  const indiana = addLoan({ state: "in " });
  const illinois = addLoan({ state: "IL" });
  const wisconsin = addLoan({ state: "WI" });
  assert.equal(staffApplications(db, indiana)[0].brokerAgreementState, "IN");
  assert.equal(staffApplications(db, indiana)[0].draft, null);
  const record = (input, actor) => work({ type: "stateBrokerAgreement", input }, actor);
  const date = (time, on = "2026-11-08") => ({ on, time, reference: "Fictional supporting document" });
  const facts = { applicability: "Covered for internal review", scopeReference: "Fictional review scope",
    agreementVersion: "Fictional agreement v1", zone: "America/Chicago", signed: date("09:00") };
  const save = (loanId, evidence) => ({ operation: "save", loanId, facts: { ...facts, ...evidence },
    requestId: crypto.randomUUID(), expectedRevision: 0 });
  const read = (loanId, state, actor) => record({ operation: "read", loanId, state }, actor);
  const inSave = save(indiana, { state: "IN", deliveredCopy: date("09:00"), exclusiveLender: "Applies" });
  assert.equal(read(indiana, "IN", processor).revision, 0);
  assert.ok(read(indiana, "IN", unrelated).error);
  assert.ok(read(indiana, "IL", admin).error);
  assert.ok(record(inSave, processor).error);
  assert.ok(record({ ...inSave, facts: { ...inSave.facts, signed: date("09:00", "2026-11-11") } }, officer).error);
  const initial = record(inSave, officer);
  assert.deepEqual(initial.review.timing.map(item => item.result), ["Same recorded minute", "Evidence missing"]);
  assert.equal(record(inSave, officer).revision, 1);
  assert.ok(record({ ...inSave, requestId: crypto.randomUUID() }, officer).error);
  assert.ok(record({ ...inSave, requestId: crypto.randomUUID(), expectedRevision: 1 }, officer).error);
  const corrected = record({ ...inSave, requestId: crypto.randomUUID(), expectedRevision: 1,
    correction: "Fictional correction receipt", facts: { ...inSave.facts, exclusiveDisclosure: date(undefined) } }, officer);
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.review.timing[1].result, "Same date, order unresolved");
  assert.equal(corrected.history[1].facts.exclusiveDisclosure, undefined);
  assert.equal(read(indiana, "IN", processor).history.length, 2);
  const repeatedHour = record({ ...inSave, requestId: crypto.randomUUID(), expectedRevision: 2,
    correction: "Fictional repeated clock hour", facts: { ...inSave.facts,
      signed: date("01:45", "2026-11-01"), deliveredCopy: date("01:45", "2026-11-01"),
      exclusiveDisclosure: date("01:30", "2026-11-01") } }, officer);
  assert.deepEqual(repeatedHour.review.timing.map(item => item.result),
    ["Repeated local hour, order unresolved", "Repeated local hour, order unresolved"]);
  const ilSave = save(illinois, { state: "IL", applicationSigned: date("09:30"), consideration: date("08:30"),
    deliveredCopy: date("09:03"), incorporatedDisclosureVersion: "Fictional disclosure v1" });
  assert.deepEqual(record(ilSave).review.timing.map(item => item.result), ["Before", "After", "After"]);
  const ilCopy = record({ ...ilSave, requestId: crypto.randomUUID(), expectedRevision: 1, correction: "Fictional signed copy review",
    facts: { ...ilSave.facts, signed: date("01:10", "2026-11-01"), deliveredCopy: date("01:45", "2026-11-01") } });
  assert.equal(ilCopy.review.timing[2].result, "Repeated local hour, order unresolved");
  assert.match(ilCopy.review.gaps.join(" "), /timing of executed copy delivery/);
  const wiSave = save(wisconsin, { state: "WI", form: "MB302TRID", disclosureVersion: "Fictional MB600 v1",
    disclosureDelivered: date("08:30"), explanation: date("08:45"), acknowledgment: date("09:00") });
  assert.deepEqual(record(wiSave).review.timing.map(item => item.result), ["Before", "Before", "Same recorded minute"]);
  assert.equal(record(wiSave).review.gaps.length, 1);
  const skippedHour = record({ ...wiSave, requestId: crypto.randomUUID(), expectedRevision: 1,
    correction: "Fictional skipped clock hour", facts: { ...wiSave.facts,
      signed: date("03:10", "2026-03-08"), acknowledgment: date("02:45", "2026-03-08"),
      explanation: date("02:30", "2026-03-08"), disclosureDelivered: date("01:45", "2026-03-08") } });
  assert.deepEqual(skippedHour.review.timing.map(item => item.result),
    ["Before", "Skipped local hour, order unresolved", "Skipped local hour, order unresolved"]);
  db.prepare("UPDATE applications SET draft=? WHERE loanId=?").run(JSON.stringify({ propertyLocation: { state: "IL" } }), indiana);
  assert.ok(read(indiana, "IN", officer).error);
  assert.equal(read(indiana, "IL", officer).revision, 0);
  db.prepare("UPDATE loans SET disposition='Paused' WHERE id=?").run(illinois);
  assert.ok(record(ilSave).error);
});

test("lead history backfill resumes, keeps source references and separates unknown times from task deadlines", (t) => {
  const { db, work, addLoan, admin, officer, processor, brokerageId } = fixture(t);
  const loanId = addLoan();
  const addLead = db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, createdAt, dueAt, loanId, importSource)
    VALUES (?, ?, 'Fictional Lead', '', '', 'Purchase', 'Fictional LO', ?, ?, ?, ?)`);
  const migrate = db.prepare("INSERT INTO migration_records (origin, recordKey, targetId) VALUES ('Fictional CRM', ?, ?)");
  const dateFromLegacy = "2026-10-20T17:00:00.000Z";
  for (let index = 0; index < 26; index++) {
    const id = `lead-${String(index).padStart(2, "0")}`;
    addLead.run(id, id, index === 1 ? dateFromLegacy : index === 2 ? "bad date" : at, at,
      index === 0 ? loanId : null, index === 0 ? "Website quote request" : null);
  }
  migrate.run("Lead:prior-lead", "lead-01");
  db.prepare("UPDATE referral_leads SET resolvedAt = ?, archiveToken = 'fictional-archive' WHERE id = 'lead-03'").run(at);
  const event = db.prepare("INSERT INTO lead_events (id, leadId, at, actor, kind, text) VALUES (?, ?, ?, 'Fictional LO', 'Call', 'Private note text')");
  event.run("event-carried", "lead-00", at);
  event.run("event-date-import", "lead-01", dateFromLegacy);
  event.run("event-bad", "lead-02", "invalid");
  migrate.run("Note:original-note", "event-date-import");
  db.prepare("INSERT INTO activity (id, loanId, createdAt, kind, text) VALUES (?, ?, ?, 'Call', 'Private note text')")
    .run("event-carried", loanId, at);
  migrate.run("Note:carried-note", "event-carried");
  db.prepare("INSERT INTO activity (id, loanId, createdAt, kind, text) VALUES (?, ?, ?, 'Email', 'Private note text')")
    .run("event-only-loan", loanId, at);
  migrate.run("Note:loan-only", "event-only-loan");
  const task = db.prepare("INSERT INTO lead_import_tasks (id, leadId, dueAt, completedAt, title) VALUES (?, ?, ?, ?, 'Private task title')");
  task.run("task-carried", "lead-00", at, null);
  task.run("task-done", "lead-01", at, at);
  db.prepare("INSERT INTO tasks (id, loanId, dueAt, completedAt, title) VALUES (?, ?, ?, ?, 'Private task title')")
    .run("task-carried", loanId, at, null);
  migrate.run("Task:carried-task", "task-carried");
  db.prepare("INSERT INTO tasks (id, loanId, dueAt, completedAt, title) VALUES (?, ?, ?, ?, 'Private task title')")
    .run("task-only-loan", loanId, at, dateFromLegacy);
  migrate.run("Task:original-loan-task", "task-only-loan");

  assert.deepEqual(work({ type: "leadBackfill" }, officer), unavailable);
  assert.deepEqual(work({ type: "advanceLeadBackfill", revision: 0 }, processor), unavailable);
  assert.deepEqual(work({ type: "leadBackfill" }, admin, undefined, `${brokerageId}-elsewhere`), unavailable);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'compliance_lead_backfill'").get(), undefined);
  assert.equal(work({ type: "leadBackfill" }).state, "Not started");
  const first = work({ type: "advanceLeadBackfill", revision: 0 });
  assert.equal(first.state, "Scanning");
  assert.equal(first.scanned, 25);
  initializeStore(db, false);
  assert.equal(work({ type: "advanceLeadBackfill", revision: 0 }).scanned, 25);
  const completed = work({ type: "advanceLeadBackfill", revision: first.revision });
  assert.equal(completed.state, "Complete");
  assert.equal(completed.scanned, 33);
  assert.equal(completed.unknown, 6);
  const second = work({ type: "leadBackfill", after: completed.next });
  const entries = [...completed.entries, ...second.entries];
  assert.equal(entries.length, 33);
  assert.equal(new Set(entries.map(({ kind, id }) => `${kind}:${id}`)).size, 33);
  const unknown = work({ type: "leadBackfill", unknownOnly: true });
  assert.equal(unknown.entries.length, 6);
  assert.equal(unknown.entries.every(({ occurredAt }) => occurredAt === null), true);
  assert.deepEqual(unknown.entries.find(({ id }) => id === "event-date-import"), {
    id: "event-date-import", leadId: "lead-01", loanId: null, name: "Fictional Lead", kind: "Lead activity",
    event: "Call", source: "CRM import", sourceRef: "Fictional CRM · Note:original-note", occurredAt: null, recordedDate: "2026-10-20",
    destination: { kind: "lead", id: "lead-01" },
  });
  assert.equal(entries.find(({ id }) => id === "event-only-loan").occurredAt, at);
  assert.equal(entries.find(({ id }) => id === "task-carried").event, "Task recorded");
  assert.equal(entries.find(({ id }) => id === "task-carried").loanId, loanId);
  assert.equal(entries.find(({ id }) => id === "lead-00").source, "Website quote form");
  assert.deepEqual(entries.find(({ id }) => id === "lead-03").destination, { kind: "archivedLead", id: "lead-03" });
  assert.equal(JSON.stringify(entries).includes("Private"), false);
  assert.match(work({ type: "leadBackfill", unknownOnly: true, after: completed.next }).error, /changed/);

  db.prepare("UPDATE lead_events SET at = ? WHERE id = 'event-bad'").run(at);
  db.prepare("UPDATE tasks SET completedAt = ? WHERE id = 'task-carried'").run(at);
  assert.equal(work({ type: "leadBackfill" }).state, "Stale");
  assert.equal(work({ type: "leadBackfill" }).scanned, null);
  assert.match(work({ type: "leadBackfill", after: completed.next }).error, /changed/);
  const rebuiltFirst = work({ type: "advanceLeadBackfill", revision: work({ type: "leadBackfill" }).revision });
  assert.equal(rebuiltFirst.scanned, 25);
  const rebuilt = work({ type: "advanceLeadBackfill", revision: rebuiltFirst.revision });
  assert.equal(rebuilt.scanned, 33);
  assert.equal(rebuilt.unknown, 4);
  const finishedTask = rebuilt.entries.find(({ id }) => id === "task-carried");
  assert.equal(finishedTask.occurredAt, at);
  assert.deepEqual(finishedTask.destination, { kind: "loan", id: loanId, target: "loan-task-task-carried" });
});

const at = "2026-11-10T12:00:00.000Z";
const unavailable = { error: "This compliance work is unavailable." };
const member = (name, role) => ({ name, email: `${name.toLowerCase()}@example.test`, role, status: "Active", accessRevision: 1 });

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { prepare: (sql) => sqlite.prepare(sql), exec: (sql) => sqlite.exec(sql), transaction(run) {
    sqlite.exec("BEGIN");
    try { const result = run(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const brokerageId = crypto.randomUUID();
  const admin = member("Owner", "Admin");
  const officer = member("Loan", "LO");
  const processor = member("Processing", "Processor");
  const unrelated = member("Other", "LO");
  const roster = [admin, officer, processor, unrelated];
  const staff = ({ email, name, role, accessRevision }) => ({ email, name, brokerage: {
    id: brokerageId, name: "Fictional Brokerage", role, pilot: true, accessRevision,
  } });
  const work = (input, actor = admin, members = roster, target = brokerageId) =>
    complianceCaseWork(db, input, staff(actor), target, members, at);

  function addLoan({ state = "MI", mode = "mock", purpose = "Purchase", nonAgency } = {}) {
    const loanId = crypto.randomUUID();
    insertContact(db, { id: loanId, name: "Fictional Borrower", email: "", phone: "", role: "Borrower" });
    insertLoan(db, { id: loanId, contactId: loanId, partnerId: null, officer: officer.name, officerEmail: officer.email,
      address: "Fictional test property", amount: 240000, purpose, stage: "Application", stageSince: at });
    db.prepare("INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt) VALUES (?, ?, ?, ?, ?)")
      .run(loanId, crypto.randomUUID(), at, JSON.stringify({ propertyLocation: { state } }), at);
    db.prepare("INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision) VALUES (?, ?, ?, 'Assigned', '', ?, 1)")
      .run(loanId, processor.email, processor.name, at);
    db.prepare(`INSERT INTO pricing_runs (id, loanId, provider, mode, scenario, offers, notices, quotedAt)
      VALUES (?, ?, 'Fixture', ?, ?, '[]', '[]', ?)`).run(loanId, loanId, mode, JSON.stringify({ purpose, nonAgency }), at);
    addPackage(loanId, 1);
    return loanId;
  }

  function addPackage(loanId, version) {
    db.prepare("UPDATE disclosure_packages SET supersededAt = ? WHERE loanId = ?").run(at, loanId);
    db.prepare(`INSERT INTO disclosure_packages (loanId, version, runId, offerId, applicationRevision, feeRevision,
      quote, documents, signers, preparedAt, signBy) VALUES (?, ?, ?, 'sample', 0, 0, '{}', '[]', '[]', ?, '2026-11-20')`)
      .run(loanId, version, loanId, at);
  }
  const open = (loanId, packageVersion = 1, actor = admin) => work({ type: "openFixture", loanId, packageVersion }, actor);
  const read = (caseId, actor = admin, members = roster) => work({ type: "read", caseId }, actor, members);
  const edit = (item, data, actor = admin) => work({ caseId: item.id, expectedRevision: item.revision, requestId: crypto.randomUUID(), ...data }, actor);
  return { db, brokerageId, roster, admin, officer, processor, unrelated, staff, work, read, open, edit, addLoan, addPackage };
}

test("existing files and new fictional cases have separate scope, history and unknown coverage", (t) => {
  const { addLoan, open, work, read, db } = fixture(t);
  const loanId = addLoan();
  assert.deepEqual(work({ type: "list" }).coverage, { state: "Not evaluated", evaluatedFiles: 0,
    eligibleFiles: null, mode: "Fictional fixture", approval: "None" });
  assert.deepEqual(work({ type: "list" }).counts, { cases: 0, files: 0 });
  initializeStore(db, false);
  assert.deepEqual(work({ type: "list" }).counts, { cases: 0, files: 0 });
  const finding = open(loanId);
  assert.equal(finding.item.kind, "Operational finding");
  assert.equal(finding.item.applicability, "Unknown");
  assert.equal(finding.item.coverage, "Not approved");
  assert.equal(finding.packageState, "Current");
  assert.equal(finding.sampleReview, null);
  assert.equal(finding.history[0].payload.packageRevision, 1);
  assert.equal(open(loanId).item.id, finding.item.id);
  initializeStore(db, false);
  assert.equal(read(finding.item.id).history.length, 1);
  const gap = read(finding.item.parentCaseId);
  assert.equal(gap.item.kind, "Control gap");
  assert.equal(read(gap.item.parentCaseId).item.kind, "Requirement review");
  open(addLoan());
  assert.deepEqual(work({ type: "list" }).counts, { cases: 4, files: 2 });
  assert.deepEqual(work({ type: "list", kind: "Control gap" }).counts, { cases: 1, files: 0 });
  assert.equal(open(addLoan({ state: "OH" })).error, "Open a current sample disclosure package for a fictional Michigan conventional purchase.");
  assert.ok(open(addLoan({ mode: "stage" })).error);
  assert.ok(open(addLoan({ nonAgency: { program: "DSCR" } })).error);
});

test("owner inventory backfills bounded batches, resumes after initialization and pages exact categories", (t) => {
  const { addLoan, work, db, officer, processor, admin, brokerageId } = fixture(t);
  const get = (bucket, after) => work({ type: "inventory", bucket, after });
  const scan = (revision) => work({ type: "advanceInventory", revision });
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'compliance_inventory'").get(), undefined);
  assert.deepEqual(work({ type: "inventory" }, officer), unavailable);
  assert.deepEqual(work({ type: "advanceInventory", revision: 0 }, processor), unavailable);
  assert.deepEqual(work({ type: "inventory" }, admin, undefined, `${brokerageId}-other`), unavailable);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'compliance_inventory'").get(), undefined);
  assert.equal(get().state, "Not started");
  assert.equal(get().scanned, null);
  const sampleReviewNeeded = Array.from({ length: 27 }, () => addLoan());
  addLoan({ state: "" });
  addLoan({ state: "OH" });
  addLoan({ mode: "stage" });
  const reviewed = addLoan();
  db.prepare("INSERT INTO closing_disclosure_reviews VALUES (?, 1, 1, ?, ?)").run(reviewed, at, admin.email);
  const initial = scan(0);
  assert.equal(initial.state, "Scanning");
  assert.equal(initial.scanned, 25);
  assert.equal(scan(0).scanned, 25);
  initializeStore(db, false);
  const complete = scan(initial.revision);
  assert.equal(complete.state, "Complete");
  assert.equal(complete.scanned, 31);
  assert.deepEqual(complete.counts.map(({ count }) => count), [1, 1, 1, 27, 1]);
  assert.equal(complete.asOf, at);
  const first = get("Sample review needed");
  const second = get("Sample review needed", first.next);
  assert.equal(first.files.length, 25);
  assert.equal(second.next, null);
  assert.deepEqual([...first.files, ...second.files].map(({ loanId }) => loanId), sampleReviewNeeded.sort());
  assert.equal(get("Sample review available").files[0].loanId, reviewed);
  assert.equal(scan(complete.revision).revision, complete.revision);
  assert.deepEqual(work({ type: "list" }).counts, { cases: 0, files: 0 });
  assert.equal(work({ type: "list" }).coverage.state, "Not evaluated");
});

test("source changes invalidate inventory during and after scanning, including files before the cursor", (t) => {
  const { addLoan, addPackage, work, db } = fixture(t);
  const loans = Array.from({ length: 26 }, () => addLoan()).sort();
  const scan = (revision) => work({ type: "advanceInventory", revision });
  const get = () => work({ type: "inventory" });
  const first = scan(0);
  db.prepare("UPDATE applications SET draft = json_set(draft, '$.unrelated', 'new') WHERE loanId = ?").run(loans[0]);
  assert.equal(get().revision, first.revision);
  db.prepare("UPDATE applications SET draft = json_set(draft, '$.propertyLocation.state', 'OH') WHERE loanId = ?").run(loans[0]);
  const stale = scan(first.revision);
  assert.equal(stale.state, "Stale");
  assert.equal(stale.scanned, null);
  assert.ok(stale.counts.every(({ count }) => count === 0));
  const rebuilt = scan(stale.revision);
  const completed = scan(rebuilt.revision);
  assert.equal(completed.scanned, 26);
  assert.deepEqual(completed.counts.map(({ count }) => count), [0, 1, 0, 25, 0]);
  addPackage(loans[1], 2);
  assert.equal(get().state, "Stale");
  assert.match(work({ type: "inventory", bucket: "Sample review needed", after: {
    revision: completed.revision, bucket: "Sample review needed", loanId: loans[0],
  } }).error, /inventory changed/);
});

test("tenant, current roster, file assignment and confidentiality restrict detail and counts", (t) => {
  const { addLoan, open, work, read, edit, staff, roster, db, admin, officer, processor, unrelated, brokerageId } = fixture(t);
  const loanId = addLoan();
  const { item } = open(loanId);
  assert.deepEqual(work({ type: "list", loanId }, officer).counts, { cases: 1, files: 1 });
  assert.deepEqual(work({ type: "read", caseId: item.id, loanId: addLoan() }), unavailable);
  assert.deepEqual(work({ type: "list" }, officer), unavailable);
  assert.deepEqual(work({ type: "list", loanId }, unrelated), unavailable);
  assert.equal(read(item.id, processor).item.parentCaseId, null);
  assert.deepEqual(read(item.parentCaseId, officer), unavailable);
  assert.deepEqual(edit(item, { type: "updateStatus", status: "Awaiting evidence" }, processor), unavailable);
  assert.deepEqual(work({ type: "read", caseId: item.id }, admin, roster, crypto.randomUUID()), unavailable);
  const otherBrokerageId = crypto.randomUUID();
  const otherStaff = { ...staff(admin), brokerage: { ...staff(admin).brokerage, id: otherBrokerageId } };
  assert.deepEqual(complianceCaseWork(db, { type: "read", caseId: item.id }, otherStaff, otherBrokerageId, roster), unavailable);
  assert.deepEqual(complianceCaseWork(db, { type: "list" }, otherStaff, otherBrokerageId, roster).counts, { cases: 0, files: 0 });
  assert.deepEqual(complianceCaseWork(db, { type: "list" }, { ...staff(admin), brokerage: { ...staff(admin).brokerage, pilot: false } }, brokerageId, roster), unavailable);

  const restricted = crypto.randomUUID();
  db.prepare(`INSERT INTO compliance_cases (brokerageId, id, caseKey, kind, confidentiality, title, status,
    ownerEmail, ownerAccessRevision, revision, openedAt, updatedAt) VALUES (?, ?, 'restricted', 'Requirement review', 'Restricted',
    'Restricted case', 'Open', ?, 1, 1, ?, ?)`).run(brokerageId, restricted, admin.email, at, at);
  db.prepare("UPDATE compliance_cases SET parentCaseId = ? WHERE id = ?").run(restricted, item.id);
  assert.deepEqual(read(restricted), unavailable);
  assert.equal(read(item.id).item.parentCaseId, null);
  assert.deepEqual(work({ type: "list" }).counts, { cases: 3, files: 1 });

  const revoked = roster.map((member) => member.email === officer.email ? { ...member, status: "Revoked" } : member);
  assert.deepEqual(read(item.id, officer, revoked), unavailable);
  assert.equal(read(item.id, admin, revoked).item.ownerState, "Backup review");
  const reinvited = roster.map((member) => member.email === officer.email ? { ...member, accessRevision: 2 } : member);
  assert.equal(read(item.id, admin, reinvited).item.ownerEmail, admin.email);
  assert.deepEqual(read(item.id, officer, reinvited), unavailable);
  assert.equal(edit(item, { type: "assign", ownerEmail: processor.email }).item.ownerEmail, processor.email);
  db.prepare("UPDATE loan_processing SET processorEmail = NULL WHERE loanId = ?").run(loanId);
  assert.deepEqual(read(item.id, processor), unavailable);
  assert.equal(read(item.id).item.ownerState, "Backup review");
});

test("manual status and older sample evidence cannot resolve or review another package revision", (t) => {
  const { db, addLoan, addPackage, open, work, read, edit, admin, officer } = fixture(t);
  const loanId = addLoan();
  const { item } = open(loanId);
  const update = { type: "updateStatus", caseId: item.id, expectedRevision: item.revision, status: "Awaiting evidence", requestId: crypto.randomUUID() };
  const next = work(update, officer);
  assert.equal(next.item.revision, 2);
  assert.equal(work(update, officer).history.length, 2);
  assert.match(work({ ...update, status: "In progress" }, officer).error, /changed/);
  assert.match(work({ ...update, requestId: crypto.randomUUID() }, officer).error, /changed/);
  assert.deepEqual(edit(next.item, { type: "updateStatus", status: "Resolved" }), unavailable);

  db.prepare("INSERT INTO closing_progress (loanId, disclosureStatus, disclosureDate) VALUES (?, 'Sent', '2026-11-10')").run(loanId);
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, completedAt) VALUES (?, ?, 'Sample work', ?, ?)").run(loanId, loanId, at, at);
  const review = { type: "recordSampleReview", packageRevision: 1 };
  assert.match(edit(next.item, review).error, /workbench/);
  assert.deepEqual(edit(next.item, review, officer), unavailable);
  db.prepare("INSERT INTO closing_disclosure_reviews VALUES (?, 1, 1, ?, ?)").run(loanId, at, admin.email);
  const reviewed = edit(next.item, review);
  assert.equal(reviewed.item.status, "Awaiting evidence");
  assert.equal(reviewed.sampleReview.mode, "Sample workbench review");
  assert.deepEqual(reviewed.history[0].payload.sampleEvidence, { mode: "Sample workbench review", packageVersion: 1, reviewedAt: at, reviewer: admin.email });
  assert.equal(reviewed.coverage.approval, "None");
  db.prepare("UPDATE disclosure_packages SET revision = 2 WHERE loanId = ? AND version = 1").run(loanId);
  assert.equal(read(item.id).sampleReview, null);
  assert.match(edit(reviewed.item, review).error, /workbench/);
  addPackage(loanId, 2);
  assert.equal(read(item.id).packageState, "Superseded");
  assert.equal(read(item.id).history[0].action, "recordSampleReview");
  assert.match(edit(reviewed.item, review).error, /workbench/);
  const newer = open(loanId, 2);
  assert.notEqual(newer.item.id, item.id);
  assert.equal(newer.item.parentCaseId, item.parentCaseId);
  assert.equal(newer.sampleReview, null);
  assert.match(edit(newer.item, review).error, /workbench/);
  assert.deepEqual(work({ type: "list", kind: "Operational finding" }).counts, { cases: 2, files: 1 });
});

test("daily findings follow the current owner and hand off a revision-bound review request to the manager", (t) => {
  const { db, brokerageId, addLoan, open, work, read, edit, staff, admin, officer, processor, unrelated, roster } = fixture(t);
  const loanId = addLoan();
  const finding = open(loanId).item;
  const mine = { type: "daily", view: "mine" };
  const review = { type: "daily", view: "review" };
  assert.deepEqual(work(mine, officer).counts, { cases: 1, files: 1 });
  assert.equal(work(mine, officer).items[0].id, finding.id);
  assert.equal(work(mine, officer).items[0].borrower, "Fictional Borrower");
  assert.equal("dueAt" in work(mine, officer).items[0], false);
  assert.deepEqual(work(mine, processor).counts, { cases: 0, files: 0 });
  assert.deepEqual(work(mine, unrelated).counts, { cases: 0, files: 0 });
  assert.deepEqual(work(review, officer), unavailable);
  assert.deepEqual(work(review, processor), unavailable);
  assert.deepEqual(work(mine, admin, roster, `${brokerageId}-other`), unavailable);
  const operational = staff(admin);
  operational.brokerage.pilot = false;
  assert.deepEqual(complianceCaseWork(db, review, operational, brokerageId, roster, at), unavailable);

  const assigned = edit(finding, { type: "assign", ownerEmail: processor.email }).item;
  assert.deepEqual(work(mine, officer).counts, { cases: 0, files: 0 });
  assert.equal(work(mine, processor).items[0].id, finding.id);
  const retired = roster.map((member) => member.email === processor.email ? { ...member, accessRevision: 2 } : member);
  assert.deepEqual(work(mine, processor, retired), unavailable);
  assert.equal(work(mine, admin, retired).items[0].ownerState, "Backup review");
  assert.deepEqual(work(mine, { ...processor, accessRevision: 2 }, retired).counts, { cases: 0, files: 0 });

  const request = { type: "submitForReview", caseId: finding.id, expectedRevision: assigned.revision, packageRevision: 1,
    requestId: crypto.randomUUID(), note: "Review the sample delivery details." };
  assert.deepEqual(work(request, officer), unavailable);
  assert.match(work({ ...request, packageRevision: 2 }, processor).error, /package changed/);
  const submitted = work(request, processor);
  assert.equal(submitted.item.status, "Awaiting review");
  assert.equal(submitted.sampleReview, null);
  assert.equal(submitted.coverage.state, "Not evaluated");
  assert.equal(work(request, processor).history.length, submitted.history.length);
  assert.match(work({ ...request, expectedRevision: submitted.item.revision, requestId: crypto.randomUUID() }, processor).error, /changed/);
  assert.deepEqual(work(mine, processor).counts, { cases: 0, files: 0 });
  assert.deepEqual(work(review).counts, { cases: 1, files: 1 });
  assert.equal(work(review).items[0].id, finding.id);
  assert.equal(read(finding.id).reviewSubmission.note, request.note);
  const returned = edit(submitted.item, { type: "decideReview", decision: "Return for evidence", reason: "Attach the sample receipt.",
    packageRevision: 1, submissionRevision: submitted.reviewSubmission.revision });
  assert.equal(returned.reviewSubmission, null);
  assert.equal(returned.history.find(({ action }) => action === "submitForReview").reviewNote, request.note);
  assert.deepEqual(work(review).counts, { cases: 0, files: 0 });
  assert.equal(work(mine, processor).items[0].id, finding.id);
});

test("daily pages exclude restricted findings and refresh when assigned work changes", (t) => {
  const { db, brokerageId, addLoan, open, edit, work, admin, officer } = fixture(t);
  const mine = { type: "daily", view: "mine" };
  for (let i = 0; i < 21; i++) open(addLoan());
  const original = work(mine, officer);
  const restricted = original.items.at(0);
  db.prepare("UPDATE compliance_cases SET confidentiality = 'Restricted' WHERE brokerageId = ? AND id = ?").run(brokerageId, restricted.id);
  assert.deepEqual(work(mine, officer).counts, { cases: 20, files: 20 });
  assert.deepEqual(work({ type: "read", caseId: restricted.id }), unavailable);
  assert.match(work({ ...mine, after: original.next }, officer).error, /changed/);
  open(addLoan());
  const first = work(mine, officer);
  const next = work({ ...mine, after: first.next }, officer);
  assert.equal(next.items.length, 1);
  assert.equal(new Set([...first.items, ...next.items].map(({ id }) => id)).size, 21);
  assert.match(work({ ...mine, after: first.next }, admin).error, /changed/);
  edit(first.items[0], { type: "assign", ownerEmail: admin.email });
  assert.match(work({ ...mine, after: first.next }, officer).error, /changed/);
});

test("queue pages use stable ties, reject changed filters or revisions, and reconcile counts", (t) => {
  const { addLoan, open, edit, work } = fixture(t);
  for (let i = 0; i < 21; i++) open(addLoan());
  const input = { type: "list", kind: "Operational finding" };
  const first = work(input);
  const last = work({ ...input, after: first.next });
  assert.equal(first.items.length, 20);
  assert.equal(last.items.length, 1);
  assert.equal(last.next, null);
  assert.deepEqual(last.counts, { cases: 21, files: 21 });
  assert.equal(new Set([...first.items, ...last.items].map(({ id }) => id)).size, 21);
  assert.match(work({ ...input, status: "Open", after: first.next }).error, /queue changed/);
  assert.match(work({ ...input, after: { ...first.next, id: crypto.randomUUID() } }).error, /queue changed/);
  edit(last.items[0], { type: "updateStatus", status: "In progress" });
  assert.match(work({ ...input, after: first.next }).error, /queue changed/);
  assert.deepEqual(work({ ...input, status: "Open" }).counts, { cases: 20, files: 20 });
});

test("brokerage overview counts reconcile with scoped queues and keep inventory separate from evaluation", (t) => {
  const { db, roster, brokerageId, work, addLoan, addPackage, open, edit, admin, officer, processor } = fixture(t);
  const overview = { type: "overview" };
  const queue = (attention) => ({ type: "list", attention });
  const firstLoan = addLoan();
  const first = open(firstLoan).item;
  edit(first, { type: "updateStatus", status: "Awaiting evidence" });
  addPackage(firstLoan, 2);
  const latest = open(firstLoan, 2).item;
  edit(latest, { type: "updateStatus", status: "Awaiting evidence" });
  const needsReview = open(addLoan()).item;
  edit(needsReview, { type: "updateStatus", status: "Awaiting review" });
  const restricted = open(addLoan()).item;
  edit(restricted, { type: "updateStatus", status: "Awaiting review" });
  db.prepare("UPDATE compliance_cases SET confidentiality = 'Restricted' WHERE brokerageId = ? AND id = ?").run(brokerageId, restricted.id);
  db.prepare("UPDATE loans SET officerEmail = ? WHERE id = ?").run(processor.email, needsReview.loanId);
  assert.deepEqual(work(overview, officer), unavailable);
  assert.deepEqual(work(overview, processor), unavailable);
  assert.deepEqual(work(overview, admin, roster, `${brokerageId}-other`), unavailable);
  assert.deepEqual(work({ ...queue("review"), loanId: firstLoan }, officer), unavailable);
  const snapshot = work(overview);
  assert.deepEqual(snapshot.findings, { cases: 3, files: 2 });
  assert.deepEqual(snapshot.attention, [
    { key: "review", cases: 1, files: 1 },
    { key: "evidence", cases: 2, files: 1 },
    { key: "ownership", cases: 1, files: 1 },
  ]);
  for (const { key, cases, files } of snapshot.attention) assert.deepEqual(work(queue(key)).counts, { cases, files });
  assert.deepEqual(work(queue("ownership")).items.map(({ id, ownerState }) => [id, ownerState]), [[needsReview.id, "Backup review"]]);
  assert.deepEqual(work(queue("review")).items.map(({ id }) => id), [needsReview.id]);
  assert.deepEqual(snapshot.inventory, { state: "Not started", scanned: null, asOf: null });
  assert.equal(snapshot.fileTotal, 3);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'compliance_inventory'").get(), undefined);
  work({ type: "advanceInventory", revision: 0 });
  assert.equal(work(overview).inventory.scanned, 3);
  assert.equal(work(overview).coverage.state, "Not evaluated");
  assert.equal(work(overview).coverage.eligibleFiles, null);
  addLoan();
  assert.deepEqual(work(overview).inventory, { state: "Stale", scanned: null, asOf: at });
  assert.equal(work(overview).fileTotal, 4);
});

test("staff can record a sample observation without advancing the workflow or recording verified evidence", (t) => {
  const { work, addLoan, addPackage, open, officer, processor } = fixture(t);
  const loanId = addLoan();
  const { item } = open(loanId);
  const input = { type: "recordEvidenceNote", caseId: item.id, expectedRevision: item.revision, requestId: crypto.randomUUID(),
    source: "Fictional closing workbench", note: "Reviewed the sample receipt and could not confirm delivery.", packageRevision: 1 };
  assert.deepEqual(work(input, processor), unavailable);
  const saved = work(input, officer);
  assert.equal(saved.item.status, "Open");
  assert.equal(saved.sampleReview, null);
  assert.equal(saved.reviewSubmission, null);
  assert.equal(saved.coverage.state, "Not evaluated");
  assert.equal(saved.history[0].actor, officer.email);
  assert.equal(saved.history[0].at, at);
  assert.deepEqual(saved.history[0].evidenceNote, { source: input.source, note: input.note, packageRevision: 1 });
  assert.equal(work(input, officer).history.length, saved.history.length);
  addPackage(loanId, 2);
  const expired = work({ ...input, requestId: crypto.randomUUID(), expectedRevision: saved.item.revision }, officer);
  assert.match(expired.error, /sample package changed/);
  assert.equal(work({ type: "read", caseId: item.id }, officer).history[0].evidenceNote.note, input.note);
});

test("review decisions bind to one current request and package revision and retain both outcomes", (t) => {
  const { db, work, addLoan, open, edit, read, admin, officer, processor, brokerageId } = fixture(t);
  const loanId = addLoan();
  const { item } = open(loanId);
  const submit = (finding, packageRevision, note) => edit(finding, { type: "submitForReview", packageRevision, note }, officer);
  const first = submit(item, 1, "Review the sample receipt.");
  const decision = { type: "decideReview", caseId: item.id, expectedRevision: first.item.revision, requestId: crypto.randomUUID(),
    packageRevision: 1, submissionRevision: first.reviewSubmission.revision, decision: "Return for evidence", reason: "Sample receipt page is missing." };
  assert.equal(first.canDecideReview, false);
  assert.equal(read(item.id, admin).canDecideReview, true);
  assert.equal(read(item.id, officer).canUpdateStatus, false);
  assert.deepEqual(work(decision, officer), unavailable);
  assert.deepEqual(work(decision, processor), unavailable);
  assert.deepEqual(work(decision, admin, undefined, `${brokerageId}-other`), unavailable);
  assert.deepEqual(work({ ...decision, reason: " " }), unavailable);
  assert.match(work({ ...decision, submissionRevision: 1 }).error, /current review request/);
  assert.match(edit(first.item, { type: "updateStatus", status: "In progress" }).error, /sample review decision/);
  const returned = work(decision);
  assert.equal(returned.item.status, "Awaiting evidence");
  assert.equal(returned.reviewDecision.actor, admin.email);
  assert.equal(returned.reviewDecision.at, at);
  assert.equal(returned.reviewDecision.reason, decision.reason);
  assert.equal(returned.reviewSubmission, null);
  assert.equal(work(decision).history.length, returned.history.length);
  assert.deepEqual(work({ type: "daily", view: "mine" }, officer).items.map(({ id }) => id), [item.id]);

  const resubmitted = submit(returned.item, 1, "The fictional receipt page is attached.");
  assert.notEqual(resubmitted.reviewSubmission.revision, decision.submissionRevision);
  assert.match(work({ ...decision, expectedRevision: resubmitted.item.revision, requestId: crypto.randomUUID() }).error, /current review request/);
  const accepted = edit(resubmitted.item, { type: "decideReview", decision: "Accept sample review", reason: "The sample receipt matches the request.",
    packageRevision: 1, submissionRevision: resubmitted.reviewSubmission.revision });
  assert.equal(accepted.item.status, "In progress");
  assert.equal(accepted.coverage.state, "Not evaluated");
  assert.equal(accepted.sampleReview, null);
  assert.deepEqual(accepted.history.filter((entry) => entry.reviewDecision).map((entry) => entry.reviewDecision.decision),
    ["Accept sample review", "Return for evidence"]);
  assert.deepEqual(work({ type: "daily", view: "review" }).counts, { cases: 0, files: 0 });

  const newRequest = submit(accepted.item, 1, "Check one more sample observation.");
  db.prepare("UPDATE disclosure_packages SET revision = 2 WHERE loanId = ?").run(loanId);
  assert.match(edit(newRequest.item, { type: "decideReview", decision: "Accept sample review", reason: "Stale package decision.",
    packageRevision: 1, submissionRevision: newRequest.reviewSubmission.revision }).error, /package changed/);
  const current = read(item.id);
  assert.equal(current.reviewDecision, null);
  assert.equal(current.canDecideReview, false);
  assert.equal(current.submitPackageRevision, 2);
  assert.equal(current.history.filter((entry) => entry.reviewDecision).length, 2);
});

test("sample receipt evaluations preserve exact inputs and distinguish absent, changed and matching evidence", (t) => {
  const { db, work, open, read, edit, addLoan, addPackage, admin, officer, processor, brokerageId } = fixture(t);
  const loanId = addLoan();
  const first = open(loanId);
  const run = (detail, actor = admin) => edit(detail.item, { type: "evaluateSampleReceipt", ...detail.sampleReceiptCheck.ready }, actor);
  assert.equal(read(first.item.id, processor).sampleReceiptCheck.ready, null);
  assert.deepEqual(run(first, processor), unavailable);
  assert.equal(work({ type: "read", caseId: first.item.id }, admin, undefined, `${brokerageId}-other`).error, unavailable.error);

  const missingReview = run(first, officer);
  assert.equal(missingReview.sampleReceiptCheck.latest.outcome, "Workbench review missing");
  assert.equal(missingReview.sampleReceiptCheck.latest.basis.workbenchReview, null);
  assert.equal(missingReview.item.status, "Open");
  assert.equal(run(missingReview).item.revision, missingReview.item.revision);
  assert.equal(run(missingReview).history.length, missingReview.history.length);

  db.prepare("INSERT INTO closing_disclosure_reviews VALUES (?, 1, 1, ?, ?)").run(loanId, at, officer.email);
  assert.match(run(missingReview).error, /sample evidence changed/);
  const newSource = read(first.item.id);
  assert.equal(newSource.sampleReceiptCheck.latest.current, false);
  const missingCaseEvidence = run(newSource);
  assert.equal(missingCaseEvidence.sampleReceiptCheck.latest.outcome, "Case evidence missing");
  assert.deepEqual(missingCaseEvidence.sampleReceiptCheck.latest.basis.workbenchReview, { reviewer: officer.email, reviewedAt: at });
  assert.equal(missingCaseEvidence.sampleReceiptCheck.latest.basis.caseEvidence, null);

  const recorded = edit(missingCaseEvidence.item, { type: "recordSampleReview", packageRevision: 1 });
  const matched = run(recorded);
  assert.equal(matched.sampleReceiptCheck.latest.outcome, "Sample evidence matches");
  assert.equal(matched.sampleReceiptCheck.latest.current, true);
  assert.equal(matched.sampleReceiptCheck.latest.version, 1);
  assert.equal(matched.sampleReceiptCheck.latest.basis.caseEvidence.revision, recorded.item.revision);
  assert.equal(matched.sampleReceiptCheck.latest.basis.caseEvidence.recordedBy, admin.email);
  assert.equal(matched.item.status, "Open");
  assert.equal(matched.coverage.state, "Not evaluated");
  assert.equal(matched.reviewDecision, null);
  assert.deepEqual(matched.history.filter((entry) => entry.sampleEvaluation).map((entry) => entry.sampleEvaluation.outcome),
    ["Sample evidence matches", "Case evidence missing", "Workbench review missing"]);

  const correctedReview = "2026-11-10T13:00:00.000Z";
  db.prepare("UPDATE closing_disclosure_reviews SET reviewedAt = ? WHERE loanId = ?").run(correctedReview, loanId);
  const outOfDate = run(read(first.item.id));
  assert.equal(outOfDate.sampleReceiptCheck.latest.outcome, "Case evidence out of date");
  assert.equal(outOfDate.sampleReceiptCheck.latest.basis.workbenchReview.reviewedAt, correctedReview);
  assert.equal(outOfDate.sampleReceiptCheck.latest.basis.caseEvidence.reviewedAt, at);
  addPackage(loanId, 2);
  assert.match(run(outOfDate).error, /sample package changed/);
  const replaced = read(first.item.id);
  assert.equal(replaced.sampleReceiptCheck.ready, null);
  assert.equal(replaced.sampleReceiptCheck.latest.current, false);
  assert.equal(replaced.sampleReceiptCheck.latest.basis.packageVersion, 1);
});

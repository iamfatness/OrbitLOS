import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { quarterlyCallReport, emptyCallReportFacts, quarterRange } = await import("../src/lib/call-report-model.ts");
const { callReportFiles } = await import("../src/lib/call-report.ts");
const { reportingReadinessWork } = await import("../src/lib/call-report-readiness.ts");
const { buildFv7QuarterWorkpaper } = await import("../src/lib/mcr-fv7-quarter-evidence.ts");
const { easternDate, easternDayStart } = await import("../src/lib/client-retention.ts");
const { borrowerCommandResult } = await import("../src/lib/applications.ts");
const { contactFollowUpExceptions, fundingTaskId } = await import("../src/lib/playbook-model.ts");
const { readRecordHistory } = await import("../src/lib/record-history.ts");
const { fundingRecordAction, readFundingDashboard } = await import("../src/lib/funding-dashboard.ts");
const { currentFundingMonth } = await import("../src/lib/funding-dashboard-model.ts");
const { playbookRunWork } = await import("../src/lib/playbook-runs.ts");
const { brokerageFinanceWork } = await import("../src/lib/brokerage-finance.ts");
const { initializeBrokerages, activateBrokerages, changeBrokerage, activeBrokerages } = await import("../src/lib/brokerages.ts");
const { readCsv } = await import("../src/lib/contact-csv.ts");
const { canRecordFundingCheckIn, fundingCheckInTarget, loanNextAction } = await import("../src/lib/loan-workflow.ts");
const { readOfficerQueue } = await import("../src/lib/officer-queue.ts");
const { queueActionLabel } = await import("../src/lib/officer-queue-model.ts");
const { sampleApplication } = await import("../src/lib/application-model.ts");
const { sampleDisclosureDocuments } = await import("../src/lib/disclosure-model.ts");
const { readBorrowerDisclosure, readDisclosureWork } = await import("../src/lib/disclosures.ts");
const { disclosureCalendarWork } = await import("../src/lib/disclosure-calendar.ts");
const { defaultDisclosureCalendar, disclosureSigningDeadline } = await import("../src/lib/disclosure-calendar-model.ts");
const { blankFees } = await import("../src/lib/quote-worksheet.ts");

function fundingFixture(t) {
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
  const brokerage = { id: crypto.randomUUID(), role: "Admin", pilot: true, name: "Fictional team" };
  const admin = { name: "Demo Admin", email: "admin@example.test", brokerage };
  const officer = { name: "Demo Officer", email: "lo@example.test", brokerage: { ...brokerage, role: "LO" } };
  const loanId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const partnerId = crypto.randomUUID();
  const day = (offset) => easternDate(new Date(Date.now() + offset * 86_400_000));
  const closing = day(-3);
  const initialFunding = day(-2);
  const correctedFunding = day(-1);
  const stageSince = `${closing}T15:00:00.000Z`;
  insertContact(db, { id: contactId, name: "Fictional Borrower", email: "borrower@example.test", phone: "", role: "Borrower" });
  insertContact(db, { id: partnerId, name: "Fictional Realtor", email: "realtor@example.test", phone: "", role: "Realtor" });
  insertLoan(db, { id: loanId, contactId, partnerId, officer: officer.name, officerEmail: officer.email,
    address: "", amount: 350000, purpose: "Purchase", stage: "Underwriting", stageSince });
  const run = (input, actor = admin) => executeCommand(db, { loanId, ...input }, actor);
  const apply = async (input, actor) => {
    const result = await run(input, actor);
    assert.ok(result.state, result.error);
    return result.state;
  };
  return { db, admin, officer, loanId, contactId, partnerId, day, closing, initialFunding, correctedFunding, stageSince, run, apply };
}

test("fictional settlement matches partial receipts, preserves corrections, and archives the funding cycle", async (t) => {
  const { db, admin, officer, loanId, run, apply, closing, initialFunding, day } = fundingFixture(t);
  const owner = { ...admin, brokerage: { ...admin.brokerage, financeAccess: true } };
  const finance = (input, actor = owner, brokerageId = owner.brokerage.id) => brokerageFinanceWork(db, { loanId, cycle: 1, ...input }, actor, brokerageId);
  const detail = (cycle = 1) => finance({ type: "detail", cycle });
  const write = (type, fields = {}) => ({ type, fundingDate: initialFunding, entryId: crypto.randomUUID(), revision: detail().settlement.revision, ...fields });
  const save = (input) => {
    const result = finance(input);
    assert.equal(result.kind, "saved", result.error);
    return result;
  };
  const list = (view = "Funded") => finance({ type: "list", from: day(-10), through: day(1), owner: "", view });
  const queue = (view = "Differences") => finance({ type: "settlementQueue", view });
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 });
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 });
  assert.equal(detail().settlement.status, "Awaiting advice");
  assert.deepEqual(queue("Missing evidence").rows.map(row => [row.id, row.cycle, row.status]), [[loanId, 1, "Awaiting advice"]]);
  assert.match(finance({ type: "detail" }, officer).error, /workspace owner/);
  assert.match(finance({ type: "detail" }, admin).error, /workspace owner/);
  assert.match(finance({ type: "detail" }, owner, crypto.randomUUID()).error, /workspace owner/);
  for (const actor of [null, officer, admin]) assert.match(finance({ type: "settlementQueue", view: "Differences" }, actor).error, /workspace owner/);
  assert.match(finance({ type: "settlementQueue", view: "Differences" }, owner, crypto.randomUUID()).error, /workspace owner/);
  const advice = write("settlementAdvice", { reference: "Fictional advice 01", occurredOn: closing, grossCents: 35_000_000,
    feesCents: 125_000, adjustmentCents: -5_000, note: "" });
  save(advice);
  assert.equal(detail().settlement.expectedCents, 34_870_000);
  assert.equal(detail().settlement.status, "Awaiting receipts");
  assert.equal(queue("Missing evidence").rows[0].status, "Awaiting receipts");
  const first = write("settlementReceipt", { reference: "DEMO-RECEIPT 01", occurredOn: initialFunding, amountCents: 34_820_000, note: "" });
  save(first);
  save(first);
  assert.equal(detail().settlement.receiptCount, 1);
  assert.equal(detail().settlement.differenceCents, 50_000);
  assert.equal(list().loans[0].settlementStatus, "Difference to review");
  assert.deepEqual(queue().rows.map(({ id, cycle, expectedCents, receivedCents, differenceCents }) =>
    ({ id, cycle, expectedCents, receivedCents, differenceCents })), [
    { id: loanId, cycle: 1, expectedCents: 34_870_000, receivedCents: 34_820_000, differenceCents: 50_000 },
  ]);
  assert.match(finance(write("settlementReceipt", { reference: "demo-receipt   01", occurredOn: initialFunding, amountCents: 50_000, note: "" })).error,
    /reference is already recorded/);
  assert.match(finance(write("settlementReview", { note: "" })).error, /Record why/);
  save(write("settlementReview", { note: "Fictional second receipt is still pending." }));
  assert.equal(detail().settlement.status, "Difference reviewed");
  assert.equal(detail().settlement.entries[0].amountCents, 50_000);
  assert.deepEqual(queue().counts, { Differences: 0, "Matches to confirm": 0, "Missing evidence": 0, "Reviewed differences": 1,
    "Fee differences": 0, "Reviewed fee differences": 0 });
  const beforeUpgrade = queue("Reviewed differences");
  db.exec("DROP TRIGGER settlement_cycle_event_insert; DROP TABLE settlement_cycle_summary");
  initializeStore(db, false);
  initializeStore(db, false);
  assert.deepEqual(queue("Reviewed differences"), beforeUpgrade);
  const second = write("settlementReceipt", { reference: "DEMO-RECEIPT 02", occurredOn: initialFunding, amountCents: 50_000, note: "" });
  save(second);
  assert.equal(detail().settlement.status, "Ready to confirm");
  assert.equal(queue("Matches to confirm").rows[0].id, loanId);
  assert.match(finance(write("settlementReview", { revision: second.revision, note: "" })).error, /evidence changed/);
  save(write("settlementReview", { note: "" }));
  assert.equal(detail().settlement.status, "Reconciled");
  assert.equal(Object.values(queue().counts).reduce((total, count) => total + count), 0);
  const correction = write("settlementAdvice", { reference: advice.reference, occurredOn: closing, grossCents: advice.grossCents,
    feesCents: 175_000, adjustmentCents: advice.adjustmentCents, note: "Fictional settlement fee was corrected." });
  save(correction);
  assert.equal(detail().settlement.differenceCents, -50_000);
  assert.equal(detail().settlement.status, "Difference to review");
  assert.equal(queue().rows[0].differenceCents, -50_000);
  assert.match(finance(write("settlementReverse", { originalId: second.entryId, occurredOn: closing, note: "Too early" })).error, /on or after/);
  save(write("settlementReverse", { originalId: second.entryId, occurredOn: initialFunding, note: "Fictional duplicate installment reversed." }));
  assert.equal(detail().settlement.entries.find(({ id }) => id === second.entryId).reversed, true);
  assert.equal(detail().settlement.status, "Ready to confirm");
  assert.equal(queue("Matches to confirm").rows[0].differenceCents, 0);
  assert.match(finance(write("settlementReverse", { originalId: second.entryId, occurredOn: initialFunding, note: "Already reversed" })).error, /unreversed/);
  save(write("settlementReview", { note: "Corrected fictional proceeds match." }));
  assert.equal(detail().loan.receiptsCents, 0);
  assert.equal(detail().loan.expectedCents, null);
  const saved = detail();
  const reversal = await run({ type: "reverseFunding", fundingDate: initialFunding, revision: 1, reason: "Fictional funding reversal." });
  assert.ok(reversal.state, reversal.error);
  assert.ok(detail().loan.reversedAt);
  assert.deepEqual(detail().settlement, saved.settlement);
  assert.equal(list("Reversed").loans[0].settlementStatus, "Reconciled");
  assert.match(finance(write("settlementReview", { note: "" })).error, /funding cycle changed/);
  await apply({ type: "recordFunding", fundingDate: day(-1), revision: 2 });
  assert.equal(detail(2).settlement.status, "Awaiting advice");
  assert.equal(detail(2).settlement.receivedCents, 0);
  assert.equal(detail().settlement.status, "Reconciled");
  assert.deepEqual(queue("Missing evidence").rows.map(row => [row.id, row.cycle, row.status]), [[loanId, 2, "Awaiting advice"]]);
});

test("simulated settlement feed imports exact matches and records unmatched evidence without counting it", async t => {
  const { db, admin, officer, loanId, apply, closing, initialFunding, correctedFunding } = fundingFixture(t);
  const owner = { ...admin, brokerage: { ...admin.brokerage, financeAccess: true } };
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 });
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 });
  const finance = (input, actor = owner) => brokerageFinanceWork(db, { loanId, cycle: 1, ...input }, actor, owner.brokerage.id);
  const pull = { type: "pullSettlementFeed", fundingDate: initialFunding };
  assert.match(finance(pull, officer).error, /workspace owner/);
  assert.match(finance({ ...pull, fundingDate: correctedFunding }).error, /cycle changed/);
  assert.deepEqual(finance({ type: "settlementFeed" }).rows, []);
  const result = finance(pull);
  assert.equal(result.checkedFundingDate, initialFunding);
  assert.deepEqual(result.rows.map(row => row.status), ["Imported", "Imported", "Already recorded", "Needs review"]);
  assert.deepEqual(finance(pull), result);
  const detail = () => finance({ type: "detail" }).settlement;
  assert.equal(detail().receivedCents, 34_875_000);
  assert.equal(detail().revision, 2);
  assert.equal(detail().status, "Ready to confirm");
  const review = { type: "reviewSettlementFeed", evidenceId: result.rows[3].evidenceId, note: "Wrong funding reference." };
  assert.match(finance({ ...review, evidenceId: result.rows[1].evidenceId }).error, /changed/);
  const reviewed = finance(review);
  assert.equal(reviewed.rows[3].status, "Reviewed");
  assert.equal(reviewed.rows[3].reviewNote, review.note);
  assert.deepEqual(finance(review), reviewed);
  assert.match(finance({ ...review, note: "Changed after the fact." }).error, /changed/);
  assert.equal(detail().revision, 2);
  assert.deepEqual(finance({ type: "settlementFeed" }), reviewed);
  await apply({ type: "recordFunding", fundingDate: correctedFunding, revision: 1 });
  assert.deepEqual(finance({ type: "settlementFeed" }), reviewed);
  assert.match(finance({ ...pull, fundingDate: correctedFunding }).error, /earlier funding date/);
  assert.match(finance(review).error, /earlier funding date/);
  assert.equal(detail().revision, 2);
  assert.equal(detail().receivedCents, 34_875_000);
});

test("only the owner can match the exact unmatched wire once and retain the source reference", async t => {
  const { db, admin, officer, loanId, apply, closing, initialFunding, correctedFunding } = fundingFixture(t);
  const owner = { ...admin, brokerage: { ...admin.brokerage, financeAccess: true } };
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 });
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 });
  const finance = (input, actor = owner) => brokerageFinanceWork(db, { loanId, cycle: 1, ...input }, actor, owner.brokerage.id);
  const pull = { type: "pullSettlementFeed", fundingDate: initialFunding };
  const feed = finance(pull);
  const wire = feed.rows.find(row => row.canMatch);
  assert.ok(wire);
  const match = { type: "matchSettlementFeed", evidenceId: wire.evidenceId, fundingDate: initialFunding, note: "Compared the fictional bank receipt to this funding." };
  assert.match(finance(match, officer).error, /workspace owner/);
  assert.match(finance({ ...match, evidenceId: feed.rows[1].evidenceId }).error, /delivery has changed/);
  assert.match(finance({ ...match, fundingDate: correctedFunding }).error, /cycle changed/);
  const before = finance({ type: "detail" }).settlement;
  const matched = finance(match);
  const saved = matched.rows.find(row => row.evidenceId === wire.evidenceId);
  assert.equal(saved.status, "Matched by owner");
  assert.equal(saved.fundingReference, wire.fundingReference);
  assert.equal(saved.reviewNote, match.note);
  assert.ok(saved.reviewedAt);
  assert.equal(saved.canMatch, undefined);
  assert.deepEqual(finance(match), matched);
  assert.deepEqual(finance(pull), matched);
  assert.match(finance({ ...match, note: "A different decision." }).error, /delivery has changed/);
  assert.match(finance({ ...match, type: "reviewSettlementFeed" }).error, /delivery has changed/);
  const after = finance({ type: "detail" }).settlement;
  assert.equal(after.receivedCents, before.receivedCents + wire.amountCents);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.status, "Difference to review");
});

test("routing a simulated wire keeps the original delivery and adds proceeds only to the selected loan", async t => {
  const { db, admin, officer, loanId, contactId, stageSince, apply, closing, initialFunding, correctedFunding } = fundingFixture(t);
  const owner = { ...admin, brokerage: { ...admin.brokerage, financeAccess: true } };
  const id = "destination-loan";
  insertLoan(db, { id, contactId, partnerId: null, officer: officer.name, officerEmail: officer.email, address: "", amount: 350000,
    purpose: "Purchase", stage: "Underwriting", stageSince });
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 });
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 });
  for (const input of [{ type: "recordClosing", closingDate: closing }, { type: "recordFunding", fundingDate: initialFunding }]) {
    const result = await executeCommand(db, { loanId: id, revision: 0, ...input }, owner);
    assert.ok(result.state, result.error);
  }
  const finance = (input, actor = owner) => brokerageFinanceWork(db, { loanId, cycle: 1, ...input }, actor, owner.brokerage.id);
  const find = { type: "findSettlementDestination", search: id };
  assert.match(finance(find, officer).error, /workspace owner/);
  const [destination] = finance(find).rows;
  assert.deepEqual([destination.id, destination.cycle, destination.date], [id, 1, initialFunding]);
  const feed = finance({ type: "pullSettlementFeed", fundingDate: initialFunding });
  const wire = feed.rows.find(row => row.canMatch);
  const match = { type: "matchSettlementFeed", evidenceId: wire.evidenceId, fundingDate: initialFunding,
    note: "Confirmed the wire belongs to the other funded loan.", destination };
  assert.match(finance({ ...match, destination: { ...destination, date: correctedFunding } }).error, /destination funding cycle changed/);
  assert.match(finance({ ...match, destination: { ...destination, id: "absent-loan" } }).error, /destination funding cycle changed/);
  const matched = finance(match);
  const saved = matched.rows.find(row => row.evidenceId === wire.evidenceId);
  assert.deepEqual(saved.destination, destination);
  assert.equal(saved.fundingReference, wire.fundingReference);
  assert.deepEqual(finance(match), matched);
  assert.match(finance({ ...match, destination: undefined }).error, /delivery has changed/);
  assert.equal(finance({ type: "detail" }).settlement.receivedCents, 34_875_000);
  const dest = finance({ type: "detail", loanId: id }).settlement;
  assert.equal(dest.receivedCents, wire.amountCents);
  assert.equal(dest.entries[0].importedEvidence.evidenceId, wire.evidenceId);
  const correction = { type: "correctSettlementFeedMatch", fundingDate: initialFunding, evidenceId: wire.evidenceId,
    matchId: saved.matchId, entryId: crypto.randomUUID(), note: "The bank receipt names the original loan." };
  assert.match(finance(correction, officer).error, /workspace owner/);
  assert.match(finance({ ...correction, matchId: crypto.randomUUID() }).error, /match changed/);
  const corrected = finance(correction);
  const reopened = corrected.rows.find(row => row.evidenceId === wire.evidenceId);
  assert.equal(reopened.status, "Needs review");
  assert.equal(reopened.corrections[0].matchNote, match.note);
  assert.equal(reopened.corrections[0].note, correction.note);
  assert.deepEqual(finance(correction), corrected);
  assert.match(finance(match).error, /match changed/);
  const reversed = finance({ type: "detail", loanId: id }).settlement;
  assert.equal(reversed.receivedCents, 0);
  assert.equal(reversed.entries[0].input.originalId, saved.matchId);
  assert.equal(reversed.entries[1].reversed, true);
  const rematch = finance({ ...match, destination: undefined, afterCorrection: reopened.afterCorrection });
  assert.equal(rematch.rows.find(row => row.evidenceId === wire.evidenceId).status, "Matched by owner");
  assert.equal(finance({ type: "detail" }).settlement.receivedCents, 34_900_000);
});

test("sample settlement import validates the exact cycle and retains source identity across replay and late evidence", async t => {
  const { db, admin, officer, loanId, apply, closing, initialFunding, day } = fundingFixture(t);
  const owner = { ...admin, brokerage: { ...admin.brokerage, financeAccess: true } };
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 });
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 });
  const target = { loanId, cycle: 1 };
  const base = { ...target, schemaVersion: 1, source: "mock-settlement", fundingDate: initialFunding, occurredOn: initialFunding };
  const finance = (input, actor = owner) => brokerageFinanceWork(db, { ...target, ...input }, actor, owner.brokerage.id);
  const detail = () => finance({ type: "detail" }).settlement;
  const preview = evidence => finance({ type: "settlementEvidencePreview", evidence });
  const save = (evidence, revision = detail().revision) => finance({ type: "settlementEvidenceImport", evidence,
    fundingDate: initialFunding, entryId: crypto.randomUUID(), revision });
  const receipt = { ...base, kind: "Wire receipt", evidenceId: "wire-1", reference: "WIRE 001", amountCents: 34_875_000 };
  const advice = { ...base, kind: "Purchase advice", evidenceId: "advice-1", reference: "ADVICE 001", sequence: 1,
    grossCents: 35_000_000, feesCents: 125_000, adjustmentCents: 0 };
  assert.match(finance({ type: "settlementEvidencePreview", evidence: receipt }, officer).error, /workspace owner/);
  assert.match(preview({ ...receipt, loanId: crypto.randomUUID() }).error, /different loan or funding cycle/);
  assert.match(preview({ ...receipt, cycle: 2 }).error, /different loan or funding cycle/);
  assert.match(preview({ ...receipt, fundingDate: day(-1) }).error, /no longer current/);
  assert.deepEqual(preview(receipt), { kind: "settlementEvidencePreview", amountCents: 34_875_000, alreadyRecorded: false, revision: 0 });
  assert.equal(detail().revision, 0);
  assert.equal(save(receipt).kind, "saved");
  assert.equal(detail().status, "Awaiting advice");
  assert.equal(save(receipt, 0).kind, "saved");
  assert.equal(detail().revision, 1);
  assert.equal(preview(receipt).alreadyRecorded, true);
  assert.match(preview({ ...receipt, amountCents: 5 }).error, /different details/);
  assert.match(preview({ ...receipt, evidenceId: "duplicate", reference: "wire  001" }).error, /wire reference is already recorded/);
  assert.match(save(advice, 0).error, /evidence changed/);
  assert.equal(save(advice).kind, "saved");
  assert.equal(detail().status, "Ready to confirm");
  assert.equal(finance({ type: "settlementReview", fundingDate: initialFunding, revision: 2, entryId: crypto.randomUUID(), note: "" }).kind, "saved");
  assert.equal(detail().status, "Reconciled");
  assert.equal(save({ ...advice, evidenceId: "advice-3", sequence: 3, feesCents: 150_000 }).kind, "saved");
  assert.match(preview({ ...advice, evidenceId: "advice-2", sequence: 2 }).error, /newer or matching/);
  assert.equal(detail().status, "Difference to review");
  assert.deepEqual(detail().entries.flatMap(entry => entry.importedEvidence ? [entry.importedEvidence.evidenceId] : []),
    ["advice-3", "advice-1", "wire-1"]);
});

test("settlement exceptions page across tied timestamps and reopen only the current funding cycle", async (t) => {
  const { db, admin, officer, contactId, closing, initialFunding, correctedFunding, stageSince } = fundingFixture(t);
  const owner = { ...admin, brokerage: { ...admin.brokerage, financeAccess: true } };
  const now = new Date();
  const finance = (input) => brokerageFinanceWork(db, input, owner, owner.brokerage.id, now);
  const ids = Array.from({ length: 23 }, (_, index) => `fixture-loan-${String(index).padStart(2, "0")}`);
  for (const [index, loanId] of ids.entries()) {
    insertLoan(db, { id: loanId, contactId, partnerId: null, officer: officer.name, officerEmail: officer.email, address: "", amount: 350000,
      purpose: "Purchase", stage: "Underwriting", stageSince });
    for (const input of [{ type: "recordClosing", closingDate: closing }, { type: "recordFunding", fundingDate: initialFunding }]) {
      const result = await executeCommand(db, { loanId, revision: 0, ...input }, owner);
      assert.ok(result.state, result.error);
    }
    const evidence = { loanId, cycle: 1, fundingDate: initialFunding, occurredOn: initialFunding, note: "" };
    assert.equal(finance({ ...evidence, type: "settlementAdvice", revision: 0, entryId: crypto.randomUUID(),
      reference: "Sample advice", grossCents: 100_000, feesCents: 0, adjustmentCents: 0 }).kind, "saved");
    if (index === 22) continue;
    assert.equal(finance({ ...evidence, type: "settlementReceipt", revision: 1, entryId: crypto.randomUUID(),
      reference: "Sample receipt", amountCents: 90_000 }).kind, "saved");
  }
  const query = { type: "settlementQueue", view: "Differences" };
  const first = finance(query);
  const second = finance({ ...query, after: first.next });
  assert.deepEqual(first.rows.map(({ id }) => id), ids.slice(2, 22).reverse());
  assert.deepEqual(second.rows.map(({ id }) => id), ids.slice(0, 2).reverse());
  assert.equal(second.next, null);
  assert.deepEqual(second.counts, { Differences: 22, "Matches to confirm": 0, "Missing evidence": 1, "Reviewed differences": 0,
    "Fee differences": 0, "Reviewed fee differences": 0 });

  const loanId = ids[0];
  assert.equal(finance({ type: "settlementReview", loanId, cycle: 1, fundingDate: initialFunding, revision: 2,
    entryId: crypto.randomUUID(), note: "Fictional shortfall reviewed." }).kind, "saved");
  assert.equal(finance({ ...query, view: "Reviewed differences" }).rows[0].date, initialFunding);
  const correct = await executeCommand(db, { loanId, type: "recordFunding", fundingDate: correctedFunding, revision: 1 }, owner);
  assert.ok(correct.state, correct.error);
  assert.equal(finance(query).counts.Differences, 22);
  assert.equal(finance({ ...query, view: "Reviewed differences" }).rows.length, 0);
  const reversal = await executeCommand(db, { loanId, type: "reverseFunding", fundingDate: correctedFunding, revision: 2, reason: "Sample reversal." }, owner);
  assert.ok(reversal.state, reversal.error);
  assert.equal(finance(query).counts.Differences, 21);
  assert.equal(finance({ type: "detail", loanId, cycle: 1 }).settlement.differenceCents, 10_000);
});

test("itemized settlement differences pin the confirmed sample and reopen on a funding correction", async (t) => {
  const { db, admin, officer, loanId, run, apply, closing, initialFunding, correctedFunding, day } = fundingFixture(t);
  const owner = { ...admin, brokerage: { ...admin.brokerage, financeAccess: true } };
  const finance = (input, actor = owner) => brokerageFinanceWork(db, { loanId, cycle: 1, ...input }, actor, owner.brokerage.id);
  const detail = (cycle = 1) => finance({ type: "detail", cycle });
  const work = () => detail().settlementFees;
  const queue = (view = "Fee differences") => finance({ type: "settlementQueue", view });
  const save = (input) => {
    const result = finance(input);
    assert.equal(result.kind, "saved", result.error);
  };
  const app = (await apply({ type: "startApplication" })).applications[0];
  const draft = sampleApplication(borrowerCommandResult(db, { type: "read", token: app.token }).application.draft);
  Object.assign(draft.propertyLocation, { city: "Bloomfield Hills", state: "MI", zip: "48304" });
  const submitted = borrowerCommandResult(db, { type: "submit", token: app.token, step: 9, revision: app.revision,
    draft: { ...draft, confirmedDemo: true } });
  assert.ok(submitted.application?.submittedAt, submitted.error);
  const applicationRevision = submitted.application.revision;
  await apply({ type: "reviewApplication", revision: applicationRevision });
  const pricing = (await apply({ type: "runPricing", applicationRevision, scenario: { purpose: "Purchase",
    loanAmount: 350000, propertyValue: 450000, purchasePrice: 450000, zip: "48304", creditScore: 760, monthlyIncome: 9500,
    occupancy: "Primary residence", propertyType: "Single family", firstTimeBuyer: false } })).pricingRuns[0];
  const choice = { runId: pricing.id, offerId: pricing.offers[0].id };
  await apply({ type: "selectOffer", ...choice });
  const worksheet = { fees: { ...blankFees(), settlement: 100_000, appraisal: 40_000 },
    allocations: { settlement: { payee: "Fictional Title Co", seller: 30_000, lender: 0, other: 0 } },
    purchasePrice: 45_000_000, payoffs: null, deposit: 0, sellerCredits: 0, otherCredits: 0 };
  await apply({ type: "saveAllocatedFeeWorksheet", ...choice, feeRevision: 0, worksheet });
  await apply({ type: "prepareDisclosurePackage", ...choice, applicationRevision, feeRevision: 1,
    previousVersion: null, documents: sampleDisclosureDocuments, signBy: day(0) });
  const version = () => {
    const [{ version, revision }] = readDisclosureWork(db, loanId).packages;
    return { version, revision };
  };
  await apply({ type: "issueDisclosurePackage", ...version() });
  await apply({ type: "respondToDisclosurePackage", ...version(), signer: "Borrower", response: "Signed" });
  await apply({ type: "confirmClosingDisclosure", ...version() });
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 });
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 });
  assert.equal(work().status, "Awaiting fee statement");
  const pinned = work().baseline;
  assert.deepEqual(pinned.lines.settlement, { gross: 100_000, borrower: 70_000, payee: "Fictional Title Co" });
  const request = {
    type: "settlementFeeStatement", fundingDate: initialFunding, revision: 0, entryId: crypto.randomUUID(),
    baseline: { version: pinned.version, revision: pinned.revision }, occurredOn: initialFunding, reference: "Fictional statement A", note: "",
    lines: { ...pinned.lines, settlement: { gross: 125_000, borrower: 95_000, payee: "Fictional Escrow Co" },
      appraisal: { gross: 15_000, borrower: 15_000, payee: "" } },
  };
  assert.match(finance(request, officer).error, /workspace owner/);
  assert.match(finance({ ...request, baseline: { ...request.baseline, version: 99 } }).error, /baseline changed/);
  save(request);
  save(request);
  assert.equal(work().revision, 1);
  assert.equal(work().status, "Fee difference to review");
  assert.deepEqual(queue().rows[0].feeComparison, { differenceCount: 2, missingCount: 0 });
  assert.equal(queue().rows[0].id, loanId);
  assert.equal(queue().counts.Differences, 0);
  assert.equal(detail().settlement.status, "Awaiting advice");
  const review = { type: "settlementFeeReview", fundingDate: initialFunding, revision: 1,
    entryId: crypto.randomUUID(), note: "Fictional title increase and offsetting appraisal decrease reviewed." };
  save(review);
  assert.equal(queue().counts["Fee differences"], 0);
  assert.equal(queue("Reviewed fee differences").rows[0].cycle, 1);
  await apply({ type: "saveAllocatedFeeWorksheet", ...choice, feeRevision: 1,
    worksheet: { ...worksheet, fees: { ...worksheet.fees, settlement: 160_000 } } });
  assert.deepEqual(work().baseline, pinned);
  const corrected = { ...request, entryId: crypto.randomUUID(), revision: 2, reference: "Fictional statement B",
    note: "Corrected figures match the confirmed comparison.", lines: pinned.lines };
  save(corrected);
  assert.equal(work().status, "Fees match");
  assert.equal(work().entries[1].note, review.note);
  assert.deepEqual(work().entries[1].statement.lines, request.lines);
  assert.equal(queue("Reviewed fee differences").counts["Reviewed fee differences"], 0);
  save({ ...request, entryId: crypto.randomUUID(), revision: 3, note: "Record corrected simulated source statement." });
  assert.match(finance({ ...review, entryId: crypto.randomUUID(), revision: 2 }).error, /comparison changed/);
  save({ ...review, entryId: crypto.randomUUID(), revision: 4 });
  await apply({ type: "recordFunding", fundingDate: correctedFunding, revision: 1 });
  assert.equal(queue().rows[0].date, correctedFunding);
  assert.equal(work().status, "Fee difference to review");
  assert.match(finance({ ...review, entryId: crypto.randomUUID(), revision: 5 }).error, /current funded cycle/);
  save({ ...review, entryId: crypto.randomUUID(), revision: 5, fundingDate: correctedFunding });
  const archived = work();
  assert.ok((await run({ type: "reverseFunding", fundingDate: correctedFunding, revision: 2, reason: "Fictional reversal." })).state);
  assert.deepEqual(work(), archived);
  assert.equal(queue("Reviewed fee differences").rows.length, 0);
  await apply({ type: "recordFunding", fundingDate: day(0), revision: 3 });
  assert.equal(detail(2).settlementFees.status, "Awaiting confirmed fees");
  assert.equal(detail(2).settlementFees.revision, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("reporting readiness and reconciled export share blockers, including a funding correction across quarters", async (t) => {
  const { db, admin, officer, loanId, run, apply } = fundingFixture(t);
  const checkedAt = new Date("2026-11-08T15:00:00.000Z");
  const work = (type, quarter, actor = admin, brokerageId = admin.brokerage.id) =>
    reportingReadinessWork(db, { type, year: 2026, quarter }, actor, brokerageId, checkedAt);
  await apply({ type: "recordClosing", closingDate: "2026-09-28", revision: 0 });
  await apply({ type: "recordFunding", fundingDate: "2026-09-30", revision: 0 });
  const pending = work("list", 3);
  assert.equal(pending.blockers, 1);
  assert.equal(pending.items[0].officer, officer.name);
  assert.equal(pending.items[0].fundingDate, "2026-09-30");
  assert.match(work("export", 3).error, /Resolve the quarter/);
  assert.match(work("export", 3, officer).error, /brokerage admins/);
  assert.match(work("list", 3, admin, crypto.randomUUID()).error, /brokerage admins/);
  const facts = { ...emptyCallReportFacts, eligibility: "Include", state: "MI", originator: "0000000", receivedDate: "2026-09-01",
    receivedAmount: 350000, outcome: "Closed and funded", outcomeDate: "2026-09-30", outcomeAmount: 345000 };
  await apply({ type: "saveCallReport", revision: 0, facts });
  assert.equal(work("list", 3).blockers, 0);
  const ready = work("export", 3);
  assert.equal(ready.count, 1);
  const [, initial] = readCsv(ready.csv);
  assert.deepEqual(initial.slice(2, 11), [loanId, "MI", "0000000", "Applications received | Closed and funded", "2026-09-01", "350000",
    "Closed and funded", "2026-09-30", "345000"]);

  await apply({ type: "recordFunding", fundingDate: "2026-10-01", revision: 1 });
  for (const quarter of [3, 4]) {
    const [row] = quarterlyCallReport(callReportFiles(db, loanId), quarterRange(2026, quarter));
    const result = work("list", quarter);
    assert.equal(result.blockers, 1);
    assert.equal(result.items[0].revision, 1);
    assert.deepEqual(result.items[0].issues, row.issues);
    assert.match(work("export", quarter).error, /Resolve the quarter/);
  }
  assert.match((await run({ type: "saveCallReport", revision: 0, facts: { ...facts, outcomeDate: "2026-10-01" } })).error, /changed/);
  await apply({ type: "saveCallReport", revision: 1, facts: { ...facts, outcomeDate: "2026-10-01" } });
  assert.equal(work("list", 3).blockers, 0);
  const [, corrected] = readCsv(work("export", 4).csv);
  assert.equal(corrected[5], "Beginning pipeline | Closed and funded");
  assert.equal(corrected[9], "2026-10-01");
  await apply({ type: "reverseFunding", fundingDate: "2026-10-01", revision: 2, reason: "Fictional QA reversal" });
  const [, reversed] = readCsv(work("export", 4).csv);
  assert.equal(reversed[5], "Beginning pipeline | Ending pipeline");
  assert.equal(reversed[8], "");
});

test("reporting readiness resumes a bounded legacy backfill and excludes reviewed files from the blocker queue", (t) => {
  const { db, admin, officer, contactId } = fundingFixture(t);
  const now = new Date("2026-11-08T15:00:00.000Z");
  const query = { type: "list", year: 2026, quarter: 4 };
  const work = (input) => reportingReadinessWork(db, input, admin, admin.brokerage.id, now);
  for (let i = 0; i < 322; i++) {
    insertLoan(db, { id: `legacy-${String(i).padStart(3, "0")}`, contactId, partnerId: null, officer: officer.name, officerEmail: officer.email,
      address: "", amount: 0, purpose: "Purchase", stage: "Underwriting", stageSince: now.toISOString() });
  }
  db.exec("DELETE FROM call_report_readiness_dirty");
  assert.match(work({ ...query, type: "export" }).error, /still being checked/);
  const partial = work(query);
  assert.equal(partial.indexing, true);
  assert.equal(partial.items.length, 20);
  const complete = work(query);
  assert.equal(complete.indexing, false);
  assert.equal(complete.blockers, 323);
  const next = work({ ...query, after: complete.next });
  assert.equal(new Set([...complete.items, ...next.items].map(({ id }) => id)).size, 40);
  const excluded = { ...emptyCallReportFacts, eligibility: "Exclude", exclusionReason: "Fictional or training file" };
  db.prepare("INSERT INTO call_report_facts VALUES ('legacy-000', ?, 1)").run(JSON.stringify(excluded));
  assert.equal(work(query).blockers, 322);
  db.exec("DELETE FROM loans WHERE id = 'legacy-001'");
  assert.equal(work(query).blockers, 321);
});

test("internal signing targets count after the anchor and honor weekend, holiday, and year boundaries", () => {
  const basis = { version: 2, anchorOn: "2026-11-05" };
  const rules = { ...defaultDisclosureCalendar, saturday: true,
    holidays: [{ on: "2026-11-06", label: "Office closure" }, { on: "2026-11-09", label: "Team holiday" }] };
  assert.equal(disclosureSigningDeadline(defaultDisclosureCalendar, basis).signBy, "2026-11-09");
  const target = disclosureSigningDeadline(rules, basis);
  assert.equal(target.signBy, "2026-11-10");
  assert.deepEqual(target.skipped.map(({ label }) => label), ["Office closure", "Sunday closed", "Team holiday"]);
  assert.equal(disclosureSigningDeadline({ ...defaultDisclosureCalendar, holidays: [{ on: "2027-01-01", label: "Closed" }] },
    { ...basis, anchorOn: "2026-12-31" }).signBy, "2027-01-05");
});

test("deadline calendar previews moved drafts and keeps issued mock targets and reminders pinned", async (t) => {
  const { db, admin, officer, loanId, run, apply } = fundingFixture(t);
  const calendar = (input, staff = admin, brokerageId = admin.brokerage.id) => disclosureCalendarWork(db, input, staff, brokerageId);
  const read = () => readDisclosureWork(db, loanId);
  const command = () => {
    const [{ version, revision }] = read().packages;
    return { version, revision };
  };
  const app = (await apply({ type: "startApplication" })).applications[0];
  const draft = sampleApplication(borrowerCommandResult(db, { type: "read", token: app.token }).application.draft);
  Object.assign(draft.propertyLocation, { city: "Bloomfield Hills", state: "MI", zip: "48304" });
  const submitted = borrowerCommandResult(db, { type: "submit", token: app.token, step: 9, revision: app.revision, draft: { ...draft, confirmedDemo: true } });
  const applicationRevision = submitted.application.revision;
  await apply({ type: "reviewApplication", revision: applicationRevision });
  const pricing = (await apply({ type: "runPricing", applicationRevision, scenario: { purpose: "Purchase", loanAmount: 350000, propertyValue: 450000,
    purchasePrice: 450000, zip: "48304", creditScore: 760, monthlyIncome: 9500, occupancy: "Primary residence",
    propertyType: "Single family", firstTimeBuyer: false } })).pricingRuns[0];
  const choice = { runId: pricing.id, offerId: pricing.offers[0].id };
  await apply({ type: "selectOffer", ...choice });
  await apply({ type: "saveFeeWorksheet", ...choice, feeRevision: 0, worksheet: { fees: blankFees(), purchasePrice: 45_000_000,
    payoffs: null, deposit: 0, sellerCredits: 0, otherCredits: 0 } });
  const prepare = ({ version, anchorOn, signBy }, previousVersion = null) => ({ type: "prepareDisclosurePackage", ...choice,
    applicationRevision, feeRevision: 1, previousVersion, documents: sampleDisclosureDocuments, signBy, deadlineCalendar: { version, anchorOn } });
  const first = read().suggestedDeadline;
  assert.equal(first.version, 0);
  assert.match((await run(prepare({ ...first, signBy: first.anchorOn }), officer)).error, /current calendar suggestion/);
  await apply(prepare(first), officer);
  const rules = { ...defaultDisclosureCalendar, holidays: [{ on: first.signBy, label: "Fictional office closure" }] };
  const publish = { type: "publish", version: 0, rules, note: "Fictional office schedule change." };
  assert.match(calendar(publish, officer).error, /admins/);
  assert.match(calendar(publish, admin, crypto.randomUUID()).error, /admins/);
  const preview = (version, rules) => calendar({ type: "preview", version, rules, anchorOn: first.anchorOn });
  assert.equal(preview(0, rules).affected[0].loanId, loanId);
  assert.equal(preview(0, rules).affected[0].state, "Draft");
  assert.match(preview(0, { ...rules, holidays: [...rules.holidays, ...rules.holidays] }).error, /only once/);
  assert.equal(calendar({ type: "read" }).current.version, 0);
  assert.equal(calendar(publish).current.version, 1);
  assert.equal(calendar(publish).current.version, 1);
  assert.match(preview(0, rules).error, /calendar changed/);
  assert.equal(read().packages[0].signBy, first.signBy);
  assert.equal(read().draftTargetChanged.signBy, read().suggestedDeadline.signBy);
  assert.match((await run({ type: "issueDisclosurePackage", ...command() }, officer)).error, /moved this draft/);
  assert.match((await run(prepare(first, 1), officer)).error, /preview changed/);
  const second = read().suggestedDeadline;
  await apply(prepare(second, 1), officer);
  await apply({ type: "issueDisclosurePackage", ...command() }, officer);
  assert.equal(readBorrowerDisclosure(db, loanId, "Borrower").signBy, second.signBy);
  const reminder = () => db.prepare("SELECT dueAt FROM tasks WHERE id = ?").get(`disclosure-signing:${loanId}:2`).dueAt;
  assert.equal(reminder(), easternDayStart(second.signBy));
  const revisedRules = { ...rules, signingDays: 4 };
  assert.equal(preview(1, revisedRules).affected[0].state, "Issued");
  assert.equal(calendar({ ...publish, version: 1, rules: revisedRules, note: "Extend the internal follow-up window." }).current.version, 2);
  assert.equal(read().draftTargetChanged, null);
  assert.deepEqual(read().packages.map(({ signBy, deadlineBasis }) => [signBy, deadlineBasis.version]), [[second.signBy, 1], [first.signBy, 0]]);
  assert.equal(reminder(), easternDayStart(second.signBy));
  assert.equal(readBorrowerDisclosure(db, loanId, "Borrower").signBy, second.signBy);
  await apply({ type: "respondToDisclosurePackage", ...command(), signer: "Borrower", response: "Signed" }, officer);
  assert.equal(read().packages[0].signers[0].status, "Signed");
  assert.equal(preview(2, defaultDisclosureCalendar).checked, 0);
  assert.deepEqual(calendar({ type: "read" }).history.map(({ version, publishedBy }) => [version, publishedBy]), [[2, admin.name], [1, admin.name]]);
  assert.equal(db.prepare("SELECT count(*) AS total FROM workspace_access_history WHERE action = 'Published disclosure deadline calendar'").get().total, 2);
});

test("quarter review uses a pinned prior ending, shows loan differences, and downloads immutable versions", async (t) => {
  const { db, admin, officer, loanId, contactId, stageSince } = fundingFixture(t);
  const checkedAt = new Date("2026-11-08T15:00:00.000Z");
  const work = (input, actor = admin, brokerage = admin.brokerage.id, now = checkedAt) =>
    reportingReadinessWork(db, { year: 2026, ...input }, actor, brokerage, now);
  const read = (quarter) => work({ type: "quarterReview", quarter });
  const request = (page, note = "") => ({ type: "saveQuarterReview", quarter: page.period.quarter, previousVersion: page.history[0]?.version ?? null,
    evidenceKey: page.comparison.key, note, requestId: crypto.randomUUID() });
  const saveFacts = async (id, revision, facts) => {
    const result = await executeCommand(db, { type: "saveCallReport", loanId: id, revision, facts }, admin);
    assert.ok(result.state, result.error);
  };
  const loan = (id) => insertLoan(db, { id, contactId, partnerId: null, officer: officer.name, officerEmail: officer.email,
    address: "", amount: 350000, purpose: "Purchase", stage: "Underwriting", stageSince });
  const base = { ...emptyCallReportFacts, eligibility: "Include", state: "MI", originator: "123456",
    receivedDate: "2026-09-01", receivedAmount: 350000 };
  assert.match(work({ type: "quarterReview", quarter: 4 }, officer).error, /brokerage admins/);
  assert.match(work({ type: "quarterReview", quarter: 4 }, admin, crypto.randomUUID()).error, /brokerage admins/);
  assert.match(work({ type: "quarterReview", quarter: 4 }, admin, admin.brokerage.id, new Date("2026-09-20T15:00:00Z")).error, /earlier quarter/);
  assert.match(read(3).unavailable, /reporting exceptions/);
  loan("later-excluded");
  loan("late-entry");
  loan("unchanged");
  await saveFacts(loanId, 0, base);
  await saveFacts("later-excluded", 0, { ...base, receivedAmount: 190000 });
  await saveFacts("late-entry", 0, { ...base, state: "OH", receivedAmount: 240000, receivedDate: "2026-10-05" });
  await saveFacts("unchanged", 0, { ...base, state: "NY", receivedAmount: 110000 });
  const prior = read(3);
  assert.equal(prior.closed, true);
  assert.equal(prior.comparison.prior, null);
  assert.equal(prior.comparison.changeCount, null);
  assert.equal(prior.comparison.count, 3);
  assert.match(work(request(prior)).error, /Record a review note/);
  const baselineRequest = request(prior, "First internal baseline.");
  const baseline = work(baselineRequest);
  assert.equal(baseline.review.version, 1);
  assert.deepEqual(work(baselineRequest), baseline);
  assert.match(work({ ...baselineRequest, note: "Other text" }).error, /already used/);
  assert.match(work({ ...baselineRequest, quarter: 4 }).error, /already used/);
  const opening = read(4);
  assert.deepEqual(opening.comparison.previousEnding, { count: 3, amount: 650000 });
  assert.deepEqual(opening.comparison.opening, opening.comparison.previousEnding);
  assert.equal(opening.comparison.changeCount, 0);
  assert.equal(opening.comparison.needsNote, false);
  assert.equal(opening.closed, false);
  assert.equal("ending" in opening.comparison.prior, false);
  assert.equal(work(request(opening)).review.version, 1);
  const download = (version, actor = admin) => work({ type: "downloadQuarterReview", quarter: 4, version }, actor);
  const first = download(1);
  assert.match(first.csv, /2026 Q3 v1/);
  assert.match(first.csv, /Quarter in progress/);
  assert.match(download(1, officer).error, /brokerage admins/);

  await saveFacts(loanId, 1, { ...base, state: "OH", receivedAmount: 355000 });
  await saveFacts("later-excluded", 1, { ...base, receivedAmount: 190000, eligibility: "Exclude", exclusionReason: "Duplicate file" });
  await saveFacts("late-entry", 1, { ...base, state: "OH", receivedAmount: 240000, receivedDate: "2026-09-26" });
  assert.match(work(request(opening)).error, /quarter or its baseline changed/);
  const amended = read(4);
  assert.equal(amended.latestCurrent, false);
  assert.deepEqual(amended.comparison.opening, { count: 3, amount: 705000 });
  assert.deepEqual(amended.comparison.previousEnding, { count: 3, amount: 650000 });
  assert.equal(amended.comparison.changeCount, 3);
  assert.deepEqual(amended.comparison.differences.find(({ loanId: id }) => id === loanId).reasons, ["State changed", "Amount changed"]);
  assert.equal(amended.comparison.differences.find(({ loanId: id }) => id === "later-excluded").current, null);
  assert.equal(amended.comparison.differences.find(({ loanId: id }) => id === "late-entry").before, null);
  assert.deepEqual(amended.comparison.states.find(({ state }) => state === "MI"),
    { state: "MI", previous: { count: 2, amount: 540000 }, opening: { count: 0, amount: 0 } });
  assert.match(work(request(amended)).error, /Record a review note/);
  assert.equal(work(request(amended, "=Review late change")).review.version, 2);
  assert.equal(read(4).latestCurrent, true);
  const [header, ...records] = readCsv(download(2).csv);
  const record = (type, match) => records.find((row) => row[0] === type && match(row));
  assert.equal(record("Internal review", () => true)[header.indexOf("Internal review note")], "'=Review late change");
  assert.equal(record("Carryover difference", (row) => row[header.indexOf("Loan ID")] === "later-excluded")
    [header.indexOf("Opening amount difference")], "-190000");
  assert.doesNotMatch(download(2).csv, /Fictional Borrower/);
  const updatedPrior = read(3);
  assert.equal(work(request(updatedPrior, "Corrected the prior reviewed facts.")).review.version, 2);
  const current = read(4);
  assert.equal(current.comparison.prior.version, 2);
  assert.equal(current.comparison.changeCount, 0);
  assert.equal(current.latestCurrent, false);
  assert.deepEqual(download(1), first);

  await saveFacts("unchanged", 1, { ...base, state: "NY", originator: "", receivedAmount: 110000 });
  assert.match(read(4).unavailable, /reporting exceptions/);
  assert.deepEqual(download(1), first);
});

test("FV7 evidence links a downloaded closed-quarter review to source and adjustment ledgers", async (t) => {
  const { db, admin, officer, loanId, contactId, stageSince } = fundingFixture(t);
  const now = new Date("2026-10-05T15:00:00Z");
  const work = (input, actor = admin) => reportingReadinessWork(db, { year: 2026, quarter: 3, ...input }, actor, admin.brokerage.id, now);
  const earlier = { ...emptyCallReportFacts, eligibility: "Include", state: "MI", originator: "123456",
    receivedDate: "2026-06-20", receivedAmount: 300000 };
  for (const [id, facts] of [[loanId, earlier], ["late-add", { ...earlier, receivedAmount: 130000 }],
    ["scope-removal", { ...earlier, receivedAmount: 200000 }],
    ["denied", { ...earlier, receivedDate: "2026-07-02", receivedAmount: 180000, outcome: "Denied", outcomeDate: "2026-08-25", outcomeAmount: 180000 }]]) {
    if (id !== loanId) insertLoan(db, { id, contactId, partnerId: null, officer: officer.name, officerEmail: officer.email, address: "",
      amount: facts.receivedAmount, purpose: "Purchase", stage: "Underwriting", stageSince });
    const result = await executeCommand(db, { type: "saveCallReport", loanId: id, revision: 0, facts }, admin);
    assert.ok(result.state, result.error);
  }
  const page = work({ type: "quarterReview" });
  assert.equal(page.closed, true);
  const saved = work({ type: "saveQuarterReview", previousVersion: null, evidenceKey: page.comparison.key,
    requestId: crypto.randomUUID(), note: "Fictional closed quarter with independently supplied prior balance." });
  const version = saved.review.version;
  assert.match(work({ type: "downloadQuarterReview", version }, officer).error, /brokerage admins/);
  const { csv } = work({ type: "downloadQuarterReview", version });
  const checksum = (contents) => createHash("sha256").update(contents).digest("hex");
  const file = (loanId, source, details) => ({ loanId, revision: 1, state: "MI", source, intakeReference: `intake-${loanId}`, ...details });
  const amount = (value, reference) => ({ amount: value, reference });
  const evidence = {
    entityReference: "fictional-mi-broker", snapshotSha256: checksum(csv), year: 2026, quarter: 3, version,
    priorEnding: { period: "2026 Q2", reference: "fixture-prior-receipt", states: [
      { state: "MI", direct: { count: 1, amount: 300000 }, thirdParty: { count: 1, amount: 200000 } },
    ] },
    adjustmentLedgerReference: "fixture-adjustment-ledger", amountChangeLedgerReference: "fixture-amount-ledger",
    files: [
      file(loanId, "direct", { opening: amount(300000, "prior-ledger"), ending: amount(290000, "closing-ledger") }),
      file("late-add", "direct", { opening: amount(130000, "addition"), ending: amount(130000, "closing-ledger") }),
      file("scope-removal", "thirdParty", { opening: amount(200000, "prior-ledger"), ending: amount(210000, "removal") }),
      file("denied", "thirdParty", { outcomeReference: "fixture-decision" }),
    ],
    amountChanges: [
      { loanId, date: "2026-08-02", sequence: 1, before: 300000, after: 295000, reference: "fixture-first-change" },
      { loanId, date: "2026-08-02", sequence: 2, before: 295000, after: 290000, reference: "fixture-reduction" },
      { loanId: "scope-removal", date: "2026-08-03", sequence: 1, before: 200000, after: 210000, reference: "fixture-increase" },
    ],
    adjustments: [
      { loanId: "late-add", kind: "add", date: "2026-07-20", reference: "fixture-add", commentary: "Reviewed late addition." },
      { loanId: "scope-removal", kind: "remove", date: "2026-08-05", reference: "fixture-remove", commentary: "Reviewed scope removal." },
    ],
  };
  const result = buildFv7QuarterWorkpaper(csv, evidence);
  assert.equal(result.reconciled, true);
  const templateRequest = { type: "fv7Template", version };
  const preview = { type: "fv7Preview", version, evidence: JSON.stringify(evidence) };
  assert.match(work(templateRequest, officer).error, /brokerage admins/);
  assert.match(work(preview, { ...admin, brokerage: { ...admin.brokerage, id: "different-pilot" } }).error, /brokerage admins/);
  assert.match(work(templateRequest, { ...admin, brokerage: { ...admin.brokerage, pilot: false } }).error, /fictional pilot/);
  assert.match(work({ ...templateRequest, version: version + 1 }).error, /saved review/);
  assert.match(work({ ...preview, evidence: "{" }).error, /not valid JSON/);
  const downloaded = work(templateRequest);
  assert.equal(downloaded.kind, "fv7Template");
  const template = JSON.parse(downloaded.json);
  assert.equal(template.snapshotSha256, checksum(csv));
  const entryRequest = { type: "fv7Entry", version };
  const prepared = work(entryRequest);
  assert.equal(prepared.kind, "fv7Entry");
  assert.deepEqual(prepared.entry.template, template);
  assert.deepEqual(prepared.entry.loans.find(item => item.id === loanId), {
    id: loanId, name: "Fictional Borrower", received: "2026-06-20", amount: "300000", outcome: "", outcomeOn: "", outcomeAmount: "",
  });
  assert.match(work(entryRequest, officer).error, /brokerage admins/);
  assert.match(work({ ...entryRequest, version: 99 }).error, /saved review/);
  assert.deepEqual(template.files.find(file => file.loanId === loanId),
    { loanId, revision: 1, state: "MI", source: null, intakeReference: "", opening: { amount: null, reference: "" }, ending: { amount: null, reference: "" } });
  assert.match(work({ ...preview, evidence: downloaded.json }).error, /entityReference/);
  assert.match(work({ ...preview, evidence: JSON.stringify({ ...evidence, snapshotSha256: "a".repeat(64) }) }).error, /reviewed checksum/);
  const checked = work(preview);
  assert.equal(checked.kind, "fv7Preview");
  assert.deepEqual(checked.workpaper, result);
  assert.deepEqual(work({ type: "fv7History" }), { kind: "fv7History", items: [], next: null });
  const save = { ...preview, type: "fv7Save", checked: checked.checked };
  assert.match(work({ ...save, evidence: save.evidence + " " }).error, /differs from the checked result/);
  assert.match(work(save, officer).error, /brokerage admins/);
  const receipt = work(save);
  assert.equal(receipt.kind, "fv7Saved");
  assert.equal(receipt.saved.sequence, 1);
  assert.equal(receipt.saved.version, version);
  assert.deepEqual(work(save), receipt);
  assert.deepEqual(work({ type: "fv7Read", sequence: 1 }), {
    kind: "fv7Read", saved: receipt.saved, workpaper: result, evidence: preview.evidence,
  });
  assert.match(work({ type: "fv7Read", sequence: 1, quarter: 2 }).error, /unavailable for the selected quarter/);
  assert.match(work({ type: "fv7Read", sequence: 1 }, officer).error, /brokerage admins/);
  const later = { ...evidence, priorEnding: { ...evidence.priorEnding, reference: "Updated evidence with a prior-balance discrepancy",
    states: [{ ...evidence.priorEnding.states[0], direct: { count: 1, amount: 299000 } }] } };
  for (let index = 0; index < 11; index++) {
    const source = JSON.stringify({ ...later, adjustmentLedgerReference: `Fictional review ${index}` });
    const checked = work({ ...preview, evidence: source });
    assert.equal(checked.workpaper.reconciled, false);
    assert.equal(work({ ...save, evidence: source, checked: checked.checked }).saved.sequence, index + 2);
  }
  const history = work({ type: "fv7History" });
  assert.equal(history.items.length, 10);
  assert.equal(history.items[0].reconciled, false);
  assert.deepEqual(work({ type: "fv7History", before: history.next }).items.map(item => item.sequence), [2, 1]);
  db.prepare("UPDATE mcr_fv7_workpapers SET evidence = ? WHERE sequence = 1").run("{}");
  assert.match(work({ type: "fv7Read", sequence: 1 }).error, /integrity check/);
  const [{ direct, thirdParty }] = result.states;
  assert.deepEqual(direct.calculated.AC090, { count: 2, amount: 420000 });
  assert.deepEqual(direct.lines.AC063, { count: 1, amount: 130000 });
  assert.equal(direct.lines.AC065, -10000);
  assert.deepEqual(thirdParty.calculated.AC090, { count: 0, amount: 0 });
  assert.deepEqual(thirdParty.lines.AC063, { count: -1, amount: -210000 });
  assert.equal(thirdParty.lines.AC065, 10000);
  assert.deepEqual(result.evidence.files.find((entry) => entry.loanId === "scope-removal").lines, ["AC010", "AC063"]);
  assert.throws(() => buildFv7QuarterWorkpaper(csv + "\r\n", evidence), /reviewed checksum/);
  const provisional = csv.replace("Quarter ended", "Quarter in progress");
  assert.throws(() => buildFv7QuarterWorkpaper(provisional, { ...evidence, snapshotSha256: checksum(provisional) }), /saved, ended quarter/);
  const stale = structuredClone(evidence);
  stale.files[0].revision = 2;
  assert.throws(() => buildFv7QuarterWorkpaper(csv, stale), /exact state and facts revision/);
  const missing = structuredClone(evidence);
  missing.amountChanges.shift();
  assert.throws(() => buildFv7QuarterWorkpaper(csv, missing), /disconnected/);
  const misplaced = structuredClone(evidence);
  misplaced.adjustments[0].loanId = "denied";
  assert.throws(() => buildFv7QuarterWorkpaper(csv, misplaced), /cannot use AC063/);
  const mismatch = structuredClone(evidence);
  mismatch.priorEnding.states[0].direct.amount = 299000;
  assert.equal(buildFv7QuarterWorkpaper(csv, mismatch).reconciled, false);
});

test("FV7 funded review checks individual closings against the saved pipeline and state MLO evidence", async (t) => {
  const { db, admin, officer, loanId, contactId, stageSince } = fundingFixture(t);
  const quarter = { year: 2026, quarter: 3 };
  const now = new Date("2026-10-05T15:00:00Z");
  const work = (input) => reportingReadinessWork(db, { ...quarter, ...input }, admin, admin.brokerage.id, now);
  const second = "second-direct-closing";
  const thirdParty = "funded-from-third-party";
  for (const id of [second, thirdParty]) {
    insertLoan(db, { id, contactId, partnerId: null, officer: officer.name, officerEmail: officer.email,
      address: "", amount: 310000, purpose: "Purchase", stage: "Underwriting", stageSince });
  }
  const fundedOn = "2026-09-22";
  for (const [id, originator] of [[loanId, "00123456"], [second, "654321"], [thirdParty, "987654"]]) {
    db.prepare("INSERT INTO closing_progress (loanId, fundingDate) VALUES (?, ?)").run(id, fundedOn);
    const result = await executeCommand(db, { type: "saveCallReport", loanId: id, revision: 0, facts: {
      ...emptyCallReportFacts, eligibility: "Include", state: "MI", originator, receivedDate: "2026-07-08", receivedAmount: 310000,
      outcome: "Closed and funded", outcomeDate: fundedOn, outcomeAmount: 310000,
    } }, admin);
    assert.ok(result.state, result.error);
  }
  const page = work({ type: "quarterReview" });
  const { review } = work({ type: "saveQuarterReview", previousVersion: null, evidenceKey: page.comparison.key,
    requestId: crypto.randomUUID(), note: "Fictional closed quarter." });
  const { csv } = work({ type: "downloadQuarterReview", version: review.version });
  const scope = (state) => ({ state, direct: { count: 0, amount: 0 }, thirdParty: { count: 0, amount: 0 } });
  const entry = (id, originator, channel, qmLine) => ({
    loanId: id, state: "MI", fundedOn, amount: 310000, originator, channel, qmLine, fundingReference: `funding-${id}`,
    classificationReference: `classification-${id}`,
  });
  const evidence = {
    ...quarter, entityReference: "fictional-mi-broker", snapshotSha256: createHash("sha256").update(csv).digest("hex"), version: review.version,
    priorEnding: { period: "2026 Q2", reference: "fixture-prior-receipt", states: [scope("MI"), scope("OH")] },
    adjustmentLedgerReference: "no-adjustments-review", amountChangeLedgerReference: "no-amount-changes-review", amountChanges: [], adjustments: [],
    files: [
      { loanId, revision: 1, state: "MI", source: "direct", intakeReference: "intake-direct", outcomeReference: "settlement-direct" },
      { loanId: second, revision: 1, state: "MI", source: "direct", intakeReference: "intake-direct-two", outcomeReference: "settlement-direct-two" },
      { loanId: thirdParty, revision: 1, state: "MI", source: "thirdParty", intakeReference: "intake-third-party", outcomeReference: "settlement-third-party" },
    ],
    fundedReview: {
      ledgerReference: "fixture-closing-ledger", rosterReference: "fixture-mi-mlo-roster",
      entries: [entry(loanId, "123456", "brokered", "AC920"), entry(second, "654321", "brokered", "AC930"),
        entry(thirdParty, null, "wholesale", "AC940")],
      originators: [{ state: "MI", originator: "123456", reference: "license-a" }, { state: "MI", originator: "654321", reference: "license-b" }],
    },
  };
  const check = (value = evidence) => buildFv7QuarterWorkpaper(csv, value);
  const result = check();
  assert.equal(result.reconciled, true);
  assert.equal(result.fundedReview.reconciled, true);
  const [mi, oh] = result.fundedReview.states;
  assert.deepEqual(mi.AC070, { count: 3, amount: 930000 });
  assert.deepEqual(mi.AC990, mi.AC070);
  assert.deepEqual(mi.mloTotal, { count: 2, amount: 620000 });
  assert.deepEqual(mi.AC070BySource.direct, mi.mloTotal);
  assert.deepEqual(mi.AC070BySource.thirdParty, { count: 1, amount: 310000 });
  assert.deepEqual(mi.channels.find(({ channel }) => channel === "brokered").lines.AC930, { count: 1, amount: 310000 });
  assert.deepEqual(mi.channels.find(({ channel }) => channel === "wholesale").lines.AC940, mi.AC070BySource.thirdParty);
  assert.equal(result.fundedReview.loans.find((file) => file.loanId === second).originatorReference, "license-b");
  assert.equal(result.fundedReview.loans.find((file) => file.loanId === thirdParty).originatorReference, null);
  assert.deepEqual(oh.AC070, { count: 0, amount: 0 });
  assert.deepEqual(oh.originators, []);
  assert.equal(result.fundedReview.forwardBreakdown, undefined);
  const classified = structuredClone(evidence);
  classified.fundedReview.forwardBreakdown = true;
  classified.fundedReview.entries[0].forward = { type: "AC100", purpose: "AC300", lien: "AC500", reference: "fixture-a" };
  classified.fundedReview.entries[1].forward = { type: "AC110", purpose: "AC320", lien: "AC510", reference: "fixture-b",
    exposureAmount: 330000, exposureReference: "fixture-reviewed-lien-exposure" };
  classified.fundedReview.entries[2].forward = { type: "AC120", purpose: "AC310", lien: "AC520", reference: "fixture-c" };
  const breakdown = check(classified).fundedReview.forwardBreakdown;
  assert.equal(breakdown.reconciled, true);
  const [forwardMi, forwardOh] = breakdown.states;
  const brokered = forwardMi.channels.find(item => item.channel === "brokered");
  assert.deepEqual(brokered.lines.AC110, { count: 1, amount: 310000 });
  assert.deepEqual(brokered.AC190, { count: 2, amount: 620000 });
  assert.deepEqual(brokered.AC390, brokered.AC190);
  assert.deepEqual(brokered.AC590, { count: 2, amount: 640000 });
  assert.deepEqual(brokered.lines.AC510, { count: 1, amount: 330000 });
  const missingExposure = structuredClone(classified);
  delete missingExposure.fundedReview.entries[1].forward.exposureReference;
  assert.throws(() => check(missingExposure), /exposureReference/);
  assert.deepEqual(forwardMi.channels.find(item => item.channel === "wholesale").lines.AC520, { count: 1, amount: 310000 });
  assert.deepEqual(forwardOh.channels[0].AC190, { count: 0, amount: 0 });
  const unmatched = structuredClone(classified);
  unmatched.fundedReview.originators.shift();
  const unmatchedResult = check(unmatched).fundedReview;
  assert.equal(unmatchedResult.forwardBreakdown.reconciled, false);
  assert.deepEqual(unmatchedResult.forwardBreakdown.states[0].channels[0].AC190, { count: 1, amount: 310000 });
  assert.equal(unmatchedResult.loans.some((file) => file.loanId === loanId), false);
  const forwardEvidence = JSON.stringify(classified);
  const forwardPreview = work({ type: "fv7Preview", version: review.version, evidence: forwardEvidence });
  assert.equal(forwardPreview.kind, "fv7Preview");
  assert.deepEqual(forwardPreview.workpaper.fundedReview.forwardBreakdown, breakdown);
  const forwardSave = work({ type: "fv7Save", version: review.version, evidence: forwardEvidence, checked: forwardPreview.checked });
  assert.equal(forwardSave.kind, "fv7Saved");
  const reopened = work({ type: "fv7Read", sequence: forwardSave.saved.sequence });
  assert.deepEqual(reopened.workpaper.fundedReview.forwardBreakdown, breakdown);
  assert.equal(reopened.evidence, forwardEvidence);
  delete classified.fundedReview.entries[0].forward;
  const partial = check(classified);
  assert.equal(partial.fundedReview.reconciled, true);
  assert.equal(partial.fundedReview.forwardBreakdown.reconciled, false);
  assert.equal(partial.reconciled, false);
  assert.deepEqual(partial.fundedReview.forwardBreakdown.states[0].unclassified.map(file => file.loanId), [loanId]);
  const { fundedReview, ...pipelineOnly } = evidence;
  assert.equal(check(pipelineOnly).fundedReview, null);
  const swapped = structuredClone(evidence);
  swapped.fundedReview.entries[0].originator = "654321";
  swapped.fundedReview.entries[1].originator = "123456";
  const rejected = check(swapped);
  assert.equal(rejected.reconciled, false);
  assert.equal(rejected.fundedReview.states[0].issues.filter((issue) => issue.includes("differs between")).length, 2);
  const swappedChannels = structuredClone(evidence);
  swappedChannels.fundedReview.entries[0].channel = "wholesale";
  swappedChannels.fundedReview.entries[2].channel = "brokered";
  const channelIssues = check(swappedChannels).fundedReview.states[0].issues.join();
  assert.match(channelIssues, /retail closings do not add up to direct AC070/);
  assert.match(channelIssues, /Wholesale closings do not add up to third-party AC070/);
  const wrongLicense = structuredClone(evidence);
  wrongLicense.fundedReview.originators[0].state = "OH";
  const missingRoster = check(wrongLicense).fundedReview.states[0];
  assert.deepEqual(missingRoster.AC990, missingRoster.AC070);
  assert.match(missingRoster.issues.join(), /needs reviewed MLO evidence/);
  const missing = structuredClone(evidence);
  missing.fundedReview.entries[0].loanId = "not-in-saved-quarter";
  const missingReview = check(missing).fundedReview;
  assert.equal(missingReview.reconciled, false);
  assert.match(missingReview.states[0].issues.join(), /missing from the reviewed funded ledger/);
  assert.match(missingReview.issues.join(), /absent from the saved funded activity/);
  assert.throws(() => check({ ...evidence, fundedReview: { ...fundedReview, entries: [...fundedReview.entries, fundedReview.entries[0]] } }),
    /Duplicate loan/);
});

test("an empty or provisional quarter is explicit and a closed snapshot can supersede it across years", (t) => {
  const { db, admin } = fundingFixture(t);
  db.exec("DELETE FROM loans");
  const call = (input, date) => reportingReadinessWork(db, input, admin, admin.brokerage.id, new Date(date));
  const q4 = { year: 2025, quarter: 4 };
  const q1 = { year: 2026, quarter: 1 };
  const inQuarter = "2025-12-20T15:00:00Z";
  const after = "2026-01-04T15:00:00Z";
  const open = call({ ...q4, type: "quarterReview" }, inQuarter);
  assert.equal(open.comparison.count, 0);
  assert.equal(open.closed, false);
  assert.equal(call({ ...q4, type: "saveQuarterReview", previousVersion: null, evidenceKey: open.comparison.key,
    requestId: crypto.randomUUID(), note: "No activity in this working sample." }, inQuarter).review.version, 1);
  const next = call({ ...q1, type: "quarterReview" }, after);
  assert.deepEqual(next.priorPeriod, q4);
  assert.equal(next.comparison.prior.closed, false);
  assert.equal(next.comparison.needsNote, true);
  assert.deepEqual(next.comparison.previousEnding, { count: 0, amount: 0 });
  const completed = call({ ...q4, type: "quarterReview" }, after);
  assert.equal(completed.closed, true);
  assert.equal(completed.latestCurrent, false);
  assert.equal(call({ ...q4, type: "saveQuarterReview", previousVersion: 1, evidenceKey: completed.comparison.key,
    requestId: crypto.randomUUID(), note: "Fictional quarter ended without activity." }, after).review.version, 2);
  const refreshed = call({ ...q1, type: "quarterReview" }, after);
  assert.equal(refreshed.comparison.prior.closed, true);
  assert.equal(refreshed.comparison.needsNote, false);
});

test("the finance grant follows the active fictional workspace creator and denies another admin", (t) => {
  const { db, admin, officer } = fundingFixture(t);
  initializeBrokerages(db);
  const bootstrap = [admin.email];
  activateBrokerages(db, admin, bootstrap);
  const id = admin.brokerage.id;
  assert.deepEqual(changeBrokerage(db, "orbit-demo", admin, bootstrap, { type: "create", id, name: "Fictional team", pilot: true }), { created: id });
  const staff = (actor) => ({ ...actor, brokerage: activeBrokerages(db, actor.email, bootstrap).find((entry) => entry.id === id) });
  const otherAdmin = { ...officer, name: "Another admin" };
  assert.ok(changeBrokerage(db, id, admin, bootstrap, { type: "invite", email: otherAdmin.email, role: "Admin" }).message);
  activateBrokerages(db, otherAdmin, bootstrap);
  const detail = { type: "detail", loanId: "unknown", cycle: 1 };
  assert.equal(staff(admin).brokerage.financeAccess, true);
  assert.equal(staff(otherAdmin).brokerage.financeAccess, undefined);
  assert.match(brokerageFinanceWork(db, detail, staff(admin), id).error, /financial record is unavailable/);
  assert.match(brokerageFinanceWork(db, detail, staff(otherAdmin), id).error, /workspace owner/);
  assert.ok(changeBrokerage(db, id, otherAdmin, bootstrap, { type: "role", email: admin.email, role: "LO" }).message);
  assert.equal(staff(admin).brokerage.financeAccess, undefined);
  assert.match(brokerageFinanceWork(db, detail, staff(admin), id).error, /workspace owner/);
  assert.equal(activeBrokerages(db, admin.email, bootstrap).find(({ id }) => id === "orbit-demo").financeAccess, undefined);
});

test("partial receipts and offset entries reconcile to the loan, cohort, and export", async (t) => {
  const { db, admin, officer, loanId, contactId, day, closing, initialFunding, apply } = fundingFixture(t);
  const owner = { ...admin, brokerage: { ...admin.brokerage, financeAccess: true } };
  const work = (input, staff = owner, brokerageId = owner.brokerage.id) => brokerageFinanceWork(db, input, staff, brokerageId);
  const detail = { type: "detail", loanId, cycle: 1 };
  const list = { type: "list", from: day(-10), through: day(0), view: "Funded", owner: "" };
  const current = () => work(detail);
  const post = (fields) => ({ ...detail, fundingDate: initialFunding, revision: current().loan.revision, entryId: crypto.randomUUID(), ...fields });
  assert.match(work(detail).error, /record is unavailable/);
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 }, officer);
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 }, officer);
  assert.equal(current().loan.marginCents, null);
  assert.equal(work(list).totals.expectedCount, 0);
  for (const staff of [null, admin, officer, { ...owner, brokerage: { ...owner.brokerage, role: "Processor" } }]) {
    assert.match(work(list, staff).error, /workspace owner/);
    assert.match(work({ ...list, type: "export" }, staff).error, /workspace owner/);
  }
  assert.match(work(detail, owner, crypto.randomUUID()).error, /workspace owner/);
  const estimate = { type: "estimate", expectedCents: 500_000, commissionCents: 125_000, expenseReviewed: false };
  assert.equal(work(post(estimate)).kind, "saved");
  const receipt = { type: "post", kind: "Receipt", amountCents: 310_012, occurredOn: day(0), reference: "Sample receipt 1", note: "" };
  const first = post(receipt);
  assert.equal(work(first).kind, "saved");
  assert.equal(work(first).kind, "saved");
  assert.match(work({ ...first, amountCents: 200 }).error, /already used/);
  assert.equal(work(post({ ...receipt, amountCents: 75_000, reference: "Sample receipt 2" })).kind, "saved");
  assert.equal(work(post({ ...receipt, kind: "Expense", amountCents: 27_540, reference: "Fictional processing invoice" })).kind, "saved");
  assert.equal(current().loan.marginCents, null);
  assert.equal(work(post({ ...estimate, expenseReviewed: true })).kind, "saved");
  assert.equal(current().loan.marginCents, 347_460);
  assert.equal(current().loan.remainingCents, 114_988);
  const stale = post({ ...receipt, reference: "Stale copy" });
  const reverse = post({ type: "reverse", originalId: first.entryId, occurredOn: day(0), note: "Corrected reference" });
  assert.equal(work(reverse).kind, "saved");
  assert.equal(work(reverse).kind, "saved");
  assert.match(work(stale).error, /changed/);
  assert.match(work(post({ type: "reverse", originalId: first.entryId, occurredOn: day(0), note: "Repeated reversal" })).error, /unreversed/);
  assert.equal(current().entries.find((entry) => entry.id === first.entryId).reversedBy, reverse.entryId);
  const totals = work(list).totals;
  assert.deepEqual(totals, { count: 1, expectedCount: 1, expectedCents: 500_000, receiptsCents: 75_000, expensesCents: 27_540, marginCount: 1, marginCents: 347_460 });
  assert.equal(work({ ...list, owner: `email:${officer.email}` }).totals.count, 1);
  assert.equal(work({ ...list, owner: "email:other@example.test" }).totals.count, 0);
  db.prepare("UPDATE contacts SET name = ? WHERE id = ?").run('=SUM("1,2")', contactId);
  const exported = work({ ...list, type: "export" });
  assert.equal(exported.count, 1);
  const [, row] = readCsv(exported.csv);
  assert.equal(row[1], "'=SUM(\"1,2\")");
  assert.deepEqual(row.slice(6), ["5000.00", "750.00", "4250.00", "1250.00", "275.40", "Yes", "3474.60"]);
  const workspace = await apply({ type: "refreshWorkspace" }, officer);
  assert.doesNotMatch(JSON.stringify(workspace), /Fictional processing invoice|commissionCents|375000|347460/);
});

test("correcting a funding date preserves its ledger, and reversing then refunding starts a clean cycle", async (t) => {
  const { db, admin, loanId, day, closing, initialFunding, correctedFunding, apply, run } = fundingFixture(t);
  const owner = { ...admin, brokerage: { ...admin.brokerage, financeAccess: true } };
  const work = (input) => brokerageFinanceWork(db, input, owner, owner.brokerage.id);
  const query = { type: "list", from: day(-10), through: day(0), view: "Funded", owner: "" };
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 });
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 });
  const entry = { type: "post", loanId, cycle: 1, fundingDate: initialFunding, revision: 0, entryId: crypto.randomUUID(),
    kind: "Receipt", amountCents: 50_000, occurredOn: day(0), reference: "Original funding receipt", note: "" };
  assert.equal(work(entry).kind, "saved");
  await apply({ type: "recordFunding", fundingDate: correctedFunding, revision: 1 });
  assert.equal(work(query).loans[0].date, correctedFunding);
  assert.equal(work(query).totals.receiptsCents, 50_000);
  assert.match(work({ ...entry, revision: 1, entryId: crypto.randomUUID() }).error, /changed/);
  await apply({ type: "reverseFunding", fundingDate: correctedFunding, revision: 2, reason: "Fictional reversal" });
  assert.equal(work(query).totals.count, 0);
  const [archived] = work({ ...query, view: "Reversed" }).loans;
  assert.equal(archived.date, correctedFunding);
  assert.ok(archived.reversedAt);
  assert.equal(work({ type: "detail", loanId, cycle: 1 }).entries[0].id, entry.entryId);
  await apply({ type: "recordFunding", fundingDate: correctedFunding, revision: 3 });
  const [refunded] = work(query).loans;
  assert.equal(refunded.cycle, 2);
  assert.equal(refunded.receiptsCents, 0);
  assert.equal(refunded.expectedCents, null);
  assert.match(work({ ...entry, fundingDate: correctedFunding, revision: 1, entryId: crypto.randomUUID() }).error, /changed/);
  assert.equal(work({ ...query, view: "Reversed" }).totals.receiptsCents, 50_000);
  assert.match((await run({ type: "deleteLoan", id: loanId })).error, /retained records/);
  db.prepare("DELETE FROM loans WHERE id = ?").run(loanId);
  assert.equal(work({ ...query, view: "Reversed" }).totals.count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM loan_financial_entries").get().count, 0);
});

test("a real task-write failure leaves a funded loan and an admin can retry the original playbook exactly once", async (t) => {
  const { db, admin, officer, loanId, closing, initialFunding, run, apply } = fundingFixture(t);
  const id = admin.brokerage.id;
  const work = (input, actor = admin, workspaceId = id) => playbookRunWork(db, input, actor, workspaceId);
  const list = { type: "list", filter: "Failed" };
  const taskIds = [fundingTaskId(loanId, "borrower"), fundingTaskId(loanId, "realtor")];
  const tasks = () => db.prepare("SELECT id, dueAt FROM tasks WHERE id IN (?, ?) ORDER BY id").all(...taskIds);
  db.exec(`CREATE TRIGGER interrupt_realtor_follow_up BEFORE INSERT ON tasks WHEN NEW.id LIKE 'post-funding:realtor:%'
    BEGIN SELECT RAISE(ABORT, 'Fictional write failure'); END;`);
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 }, officer);
  const record = { type: "recordFunding", fundingDate: initialFunding, revision: 0 };
  const failure = await run(record, officer);
  assert.match(failure.message, /admin can retry/);
  assert.equal(failure.state.closingProgress[0].fundingDate, initialFunding);
  assert.equal(failure.state.loans[0].stage, "Funded");
  assert.ok(failure.state.communicationDrafts.some(({ milestone }) => milestone === "Funded"));
  assert.deepEqual(tasks(), []);
  const [failed] = work(list).runs;
  assert.equal(failed.attemptCount, 1);
  assert.equal(failed.ruleRevision, 0);
  assert.equal(failed.delayDays, 7);
  assert.equal(failed.canRetry, true);
  assert.doesNotMatch(failed.reason, /Fictional write failure/);
  assert.ok(work(list, officer).error);
  assert.ok(work(list, admin, crypto.randomUUID()).error);
  await apply(record, officer);
  assert.equal(work(list).runs[0].attemptCount, 1);

  const retry = { type: "retry", id: failed.id, attempt: 1, operationId: crypto.randomUUID() };
  assert.ok(work(retry, officer).error);
  assert.equal(work(retry).status, "Failed");
  assert.equal(work(retry).status, "Failed");
  assert.match(work({ ...retry, operationId: crypto.randomUUID() }).error, /changed/);
  assert.deepEqual(tasks(), []);
  db.exec("DROP TRIGGER interrupt_realtor_follow_up");
  await apply({ type: "savePlaybook", revision: 0, quietHours: 48, reviewHours: 24, handoffHours: 24, fundingDays: 2, backupEmail: null });
  await apply({ type: "saveDisclosureStatus", status: "Delivered manually", date: initialFunding, revision: 1 }, officer);
  const recover = { ...retry, attempt: 2, operationId: crypto.randomUUID() };
  assert.equal(work(recover).status, "Completed");
  assert.equal(work(recover).status, "Completed");
  assert.deepEqual(work(list).runs, []);
  assert.deepEqual(tasks().map(({ id, dueAt }) => [id, dueAt]), taskIds.map((id) => [id, failed.dueAt]));
  const { attempts } = work({ type: "attempts", id: failed.id });
  assert.deepEqual(attempts.map(({ mode, status, taskChanges }) => [mode, status, taskChanges]), [
    ["Retry", "Completed", 2], ["Retry", "Failed", 0], ["Trigger", "Failed", 0],
  ]);
});

test("a funding correction retires a failed schedule and a reversal blocks even same-date retries", async (t) => {
  const { db, admin, officer, loanId, closing, initialFunding, correctedFunding, run, apply } = fundingFixture(t);
  const work = (input) => playbookRunWork(db, input, admin, admin.brokerage.id);
  const find = (filter) => work({ type: "list", filter }).runs;
  const borrowerTask = fundingTaskId(loanId, "borrower");
  const realtorTask = fundingTaskId(loanId, "realtor");
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 });
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 });
  await apply({ type: "completeTask", id: borrowerTask, completed: true }, officer);
  const original = find("Completed")[0];
  const correction = { type: "recordFunding", fundingDate: correctedFunding, revision: 1, simulateFollowUpFailure: true };
  assert.match((await run(correction, officer)).error, /fictional pilot admin/i);
  const ordinaryAdmin = { ...admin, brokerage: { ...admin.brokerage, pilot: false } };
  assert.match((await run(correction, ordinaryAdmin)).error, /fictional pilot admin/i);
  await apply(correction);
  assert.equal(find("Superseded")[0].id, original.id);
  assert.equal(find("Superseded")[0].reason, "Funding date corrected");
  const corrected = find("Failed")[0];
  assert.match(corrected.reason, /Fictional pilot/);
  assert.ok(db.prepare("SELECT completedAt FROM tasks WHERE id = ?").get(borrowerTask)?.completedAt);
  assert.equal(db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(realtorTask), undefined);
  const retry = { type: "retry", id: corrected.id, attempt: 1, operationId: crypto.randomUUID() };
  await apply({ type: "reverseFunding", fundingDate: correctedFunding, revision: 2, reason: "Fictional reversal for test" });
  assert.ok(work(retry).error);
  await apply({ type: "recordFunding", fundingDate: correctedFunding, revision: 3 });
  assert.ok(work(retry).error);
  assert.equal(find("Completed")[0].fundingRevision, 4);
  assert.equal(find("Superseded").find(({ id }) => id === corrected.id).reason, "Funding reversed");
  assert.equal(work({ type: "attempts", id: corrected.id }).attempts[0].status, "Failed");
  assert.equal(db.prepare("SELECT count(*) AS total FROM tasks WHERE id IN (?, ?)").get(borrowerTask, realtorTask).total, 2);
  db.prepare("DELETE FROM loans WHERE id = ?").run(loanId);
  assert.deepEqual(find("All runs"), []);
  assert.ok(work({ type: "attempts", id: corrected.id }).error);
});

test("the borrower funding task opens one new 1003 with the original borrower and owner", async (t) => {
  const { db, admin, officer, loanId, contactId, closing, initialFunding, run, apply } = fundingFixture(t);
  db.prepare("UPDATE loans SET address = ? WHERE id = ?").run("987 Fictional Way, Troy, MI 48084", loanId);
  db.prepare("UPDATE contacts SET phone = ? WHERE id = ?").run("2485550100", contactId);
  const start = { type: "startReturningClient1003", purpose: "Refinance" };
  assert.match((await run(start, officer)).error, /active funding/);
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 }, officer);
  const funded = await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 }, officer);
  const taskId = fundingTaskId(loanId, "borrower");
  await apply({ type: "completeTask", id: taskId, completed: true }, officer);
  assert.match((await run(start, officer)).error, /post-funding check-in/);
  await apply({ type: "completeTask", id: taskId, completed: false }, officer);

  const created = await run(start, admin);
  assert.ok(created.state, created.error);
  const repeatId = created.applicationLoanId;
  assert.notEqual(repeatId, loanId);
  const repeat = created.state.loans.find((item) => item.id === repeatId);
  assert.equal(repeat.contactId, contactId);
  assert.equal(repeat.officerEmail, officer.email);
  assert.equal(repeat.stage, "Lead");
  assert.equal(repeat.leadSource, "Returning client");
  assert.equal(repeat.partnerId, null);
  assert.equal(repeat.callCampaignName, null);
  assert.equal(created.state.loans.find((item) => item.id === loanId).stage, "Funded");
  assert.equal(created.state.tasks.find((item) => item.id === taskId).completedAt, null);
  const report = created.state.managerReports.returningClients;
  assert.deepEqual(report.map(({ metric, loanId, officerEmail, detail }) => ({ metric, loanId, officerEmail, detail })),
    [{ metric: "applications", loanId: repeatId, officerEmail: officer.email, detail: "Draft" }]);
  const token = created.state.applications.find((item) => item.loanId === repeatId).token;
  const { draft } = borrowerCommandResult(db, { type: "read", token }).application;
  assert.equal(draft.borrowerName, "Fictional Borrower");
  assert.equal(draft.email, "borrower@example.test");
  assert.equal(draft.phone, "2485550100");
  assert.equal(draft.purpose, "Refinance");
  assert.equal(draft.loanAmount, "");
  assert.equal(draft.propertyAddress, "");

  const retry = await run({ ...start, purpose: "Purchase" }, officer);
  assert.equal(retry.applicationLoanId, repeatId);
  assert.equal(retry.state.loans.find((item) => item.id === repeatId).purpose, "Refinance");
  assert.deepEqual(retry.state.returningClientLoans, [{ fundedLoanId: loanId, loanId: repeatId }]);
  assert.equal(retry.state.applications[0].token, token);
  assert.equal(retry.state.managerReports, null);
  const newOwner = { ...officer, name: "New LO", email: "new-lo@example.test" };
  db.prepare("UPDATE loans SET officerEmail = ?, officer = ? WHERE id = ?").run(newOwner.email, newOwner.name, loanId);
  assert.deepEqual((await apply({ type: "refreshWorkspace" }, newOwner)).returningClientLoans, []);
  assert.match((await run(start, newOwner)).error, /review access/);
  const reversed = await apply({ type: "reverseFunding", fundingDate: initialFunding, revision: funded.closingProgress[0].revision,
    reason: "The funding was recorded in error." });
  assert.deepEqual(reversed.returningClientLoans, [{ fundedLoanId: loanId, loanId: repeatId }]);
  assert.match((await run(start, newOwner)).error, /active funding/);
});

test("a borrower check-in logs one outcome and schedules the next reminder for the loan owner", async (t) => {
  const { db, admin, officer, loanId, contactId, day, closing, initialFunding, run, apply } = fundingFixture(t);
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 }, officer);
  const funded = await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 }, officer);
  const fundingRevision = funded.closingProgress[0].revision;
  const taskId = fundingTaskId(loanId, "borrower");
  const loan = funded.loans.find(({ id }) => id === loanId);
  const queue = (actor) => readOfficerQueue(db, { horizon: 7 }, actor, admin.brokerage.id).items;
  const openTask = queue(officer).find(({ id }) => id === taskId);
  assert.equal(loanNextAction(loan, funded, "LO").target, fundingCheckInTarget);
  assert.equal(openTask.target, fundingCheckInTarget);
  assert.equal(queueActionLabel(openTask), "Record check-in");
  assert.equal(canRecordFundingCheckIn(loan, funded, "LO"), true);
  assert.equal(canRecordFundingCheckIn(loan, funded, "Processor"), false);
  assert.equal(canRecordFundingCheckIn({ ...loan, disposition: "On hold" }, funded, "LO"), false);
  assert.equal(canRecordFundingCheckIn(loan, { ...funded, closingProgress: [] }, "LO"), false);
  assert.notEqual(loanNextAction(loan, funded, "Processor").target, fundingCheckInTarget);
  const checkIn = { type: "recordFundingCheckIn", eventId: crypto.randomUUID(), fundingRevision,
    kind: "Call", outcome: "Requested callback", note: "The borrower asked to discuss their next move.", followUp: day(3), purpose: "Loan service" };
  const otherOfficer = { ...officer, email: "other@example.test" };
  assert.match((await run(checkIn, otherOfficer)).error, /access/);
  assert.match((await run({ ...checkIn, followUp: null })).error, /requested callback/);
  assert.match((await run({ ...checkIn, followUp: day(-1) })).error, /future date/);
  assert.match((await run({ ...checkIn, fundingRevision: fundingRevision - 1 })).error, /changed/);
  await apply({ type: "optOutContact", contactId }, officer);
  assert.match((await run({ ...checkIn, purpose: "Prospecting" })).error, /opted out/);

  const saved = await apply(checkIn, admin);
  assert.ok(saved.tasks.find((task) => task.id === taskId).completedAt);
  assert.equal(canRecordFundingCheckIn(loan, saved, "LO"), false);
  assert.notEqual(loanNextAction(loan, saved, "LO").target, fundingCheckInTarget);
  assert.equal(queue(officer).some(({ id }) => id === taskId), false);
  assert.equal(queue(officer).find(({ id }) => id === checkIn.eventId).kind, "contact");
  assert.equal(queue(admin).some(({ id }) => id === checkIn.eventId), false);
  const reminder = saved.contactActivity.find((item) => item.id === checkIn.eventId);
  assert.equal(reminder.outcome, checkIn.outcome);
  assert.equal(reminder.postFundingCheckIn, true);
  assert.equal(reminder.officerEmail, admin.email);
  assert.equal(reminder.followUpOwnerEmail, officer.email);
  assert.equal(reminder.dueAt, `${checkIn.followUp}T17:00:00.000Z`);
  const deadline = Date.parse(reminder.dueAt);
  const owners = [{ name: officer.name, email: officer.email, status: "Active", role: "LO" }];
  assert.deepEqual(contactFollowUpExceptions(saved, owners, deadline - 1), []);
  const callbacks = contactFollowUpExceptions(saved, owners, deadline);
  assert.deepEqual(callbacks.map(({ id, title, ownerEmail, dueAt }) => ({ id, title, ownerEmail, dueAt })),
    [{ id: checkIn.eventId, title: "Post-funding callback", ownerEmail: officer.email, dueAt: reminder.dueAt }]);
  assert.equal(contactFollowUpExceptions(saved, [], deadline).length, 1);
  assert.equal(contactFollowUpExceptions(saved, null, deadline).length, 1);
  assert.deepEqual(contactFollowUpExceptions({ ...saved, contactActivity: [{ ...reminder, purpose: "Prospecting" }] },
    owners, deadline), []);
  assert.deepEqual(saved.managerReports.returningClients.map(({ metric, officerEmail }) => ({ metric, officerEmail })),
    [{ metric: "check-ins", officerEmail: officer.email }, { metric: "callbacks", officerEmail: officer.email }]);
  assert.deepEqual((await apply(checkIn)).contactActivity, saved.contactActivity);
  assert.match((await run({ ...checkIn, eventId: crypto.randomUUID() })).error, /changed/);
  assert.match((await run({ ...checkIn, note: "Different note." })).error, /new check-in entry/);

  await apply({ type: "completeTask", id: taskId, completed: false }, officer);
  const noteOnly = { ...checkIn, eventId: crypto.randomUUID(), outcome: "Connected", followUp: null, note: "No additional action requested." };
  const recorded = await apply(noteOnly);
  assert.equal(recorded.contactActivity.filter((item) => item.postFundingCheckIn).length, 1);
  const history = readRecordHistory(db, officer, { record: "contact", id: contactId });
  assert.equal(history.events.find((item) => item.id === noteOnly.eventId).text, "Post-funding borrower check-in · No additional action requested.");
  assert.equal(history.events.find((item) => item.id === checkIn.eventId).followUpOwner, officer.name);
  const reassigned = await executeCommand(db, { type: "assignContactFollowUp", contactId, eventId: checkIn.eventId,
    revision: 0, email: otherOfficer.email }, admin, undefined, [otherOfficer]);
  assert.ok(reassigned.state, reassigned.error);
  assert.equal(reassigned.state.managerReports.returningClients.find((item) => item.metric === "callbacks").officerEmail, otherOfficer.email);
  assert.ok(reassigned.state.managerReports.returningClients.filter((item) => item.metric === "check-ins").every((item) => item.officerEmail === officer.email));

  const reversed = await apply({ type: "reverseFunding", fundingDate: initialFunding, revision: fundingRevision,
    reason: "The funding date was recorded in error." });
  assert.equal(reversed.contactActivity.find((item) => item.id === checkIn.eventId).completedAt, null);
  assert.equal(reversed.managerReports.returningClients.filter((item) => item.metric === "check-ins").length, 2);
  const refunded = await apply({ type: "recordFunding", fundingDate: day(0), revision: reversed.closingProgress[0].revision }, officer);
  assert.equal(refunded.tasks.find((item) => item.id === taskId).completedAt, null);
  assert.match((await run({ ...checkIn, eventId: crypto.randomUUID() })).error, /changed/);
  const replay = await apply(checkIn);
  assert.equal(replay.tasks.find((item) => item.id === taskId).completedAt, null);
  assert.equal(db.prepare("SELECT count(*) AS count FROM funding_check_ins").get().count, 2);
  const completed = await apply({ type: "completeContactFollowUp", contactId, eventId: checkIn.eventId, revision: 1, completed: true }, otherOfficer);
  assert.deepEqual(contactFollowUpExceptions(completed, [], deadline), []);
  const afterCallback = (await apply({ type: "refreshWorkspace" })).managerReports.returningClients;
  assert.equal(afterCallback.filter((item) => item.metric === "callbacks").length, 0);
  assert.equal(afterCallback.filter((item) => item.metric === "check-ins").length, 2);
});

test("rescheduling a borrower callback preserves history and rejects stale or unauthorized edits", async (t) => {
  const { db, admin, officer, contactId, day, closing, initialFunding, run, apply } = fundingFixture(t);
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 }, officer);
  const funded = await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 }, officer);
  const checkIn = { type: "recordFundingCheckIn", eventId: crypto.randomUUID(), fundingRevision: funded.closingProgress[0].revision,
    kind: "Call", outcome: "Requested callback", note: "Check in on refinance plans.", followUp: day(1), purpose: "Prospecting" };
  await apply(checkIn, officer);
  const repeat = await run({ type: "startReturningClient1003", purpose: "Refinance" }, officer);
  assert.ok(repeat.applicationLoanId, repeat.error);
  assert.equal(repeat.state.returningClientLoans[0].loanId, repeat.applicationLoanId);
  const move = { type: "rescheduleBorrowerCallback", contactId, eventId: checkIn.eventId, revision: 0, date: day(3),
    reason: "Borrower asked for a later call." };
  const stranger = { ...officer, email: "another@example.test" };
  const processor = { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } };
  assert.match((await run(move, stranger)).error, /unavailable/);
  assert.match((await run(move, processor)).error, /access/);
  assert.match((await run({ ...move, reason: " " })).error, /Enter a reason/);
  assert.match((await run({ ...move, date: day(-1) })).error, /future/);
  assert.match((await run({ ...move, date: checkIn.followUp })).error, /different callback date/);
  const first = await apply(move);
  const originalDueAt = `${checkIn.followUp}T17:00:00.000Z`;
  const firstDueAt = `${move.date}T17:00:00.000Z`;
  assert.deepEqual(first.managerReports.returningClients.filter((row) => row.metric === "callbacks").map((row) => row.at), [firstDueAt]);
  assert.equal(contactFollowUpExceptions(first, null, Date.parse(originalDueAt)).length, 0);
  assert.deepEqual((await apply(move)).contactActivity, first.contactActivity);
  assert.match((await run({ ...move, reason: "Different reason" })).error, /callback changed/);
  const next = { ...move, revision: 1, date: day(5), reason: "Borrower will be traveling." };
  const updated = await apply(next, officer);
  const callback = updated.contactActivity.find((item) => item.id === checkIn.eventId);
  assert.equal(callback.followUpOwnerEmail, officer.email);
  assert.equal(callback.dueAt, `${next.date}T17:00:00.000Z`);
  assert.equal(callback.completedAt, null);
  assert.equal((await apply(checkIn, officer)).contactActivity[0].dueAt, callback.dueAt);
  assert.equal(db.prepare("SELECT count(*) AS count FROM contact_callback_reschedules").get().count, 2);
  const { events } = readRecordHistory(db, officer, { record: "contact", id: contactId });
  const changes = events.filter((item) => item.source === "reschedule");
  assert.equal(changes.length, 2);
  const earlier = changes.find((item) => item.text === move.reason);
  const later = changes.find((item) => item.text === next.reason);
  assert.deepEqual([earlier.author, earlier.previousDueAt, earlier.dueAt], [admin.name, originalDueAt, firstDueAt]);
  assert.deepEqual([later.author, later.previousDueAt, later.dueAt], [officer.name, firstDueAt, callback.dueAt]);
  assert.ok(readRecordHistory(db, stranger, { record: "contact", id: contactId }).error);
  await apply({ type: "optOutContact", contactId }, officer);
  assert.match((await run({ ...move, revision: 2, date: day(7) })).error, /opted out/);
});

test("reversing funding reconciles reports and keeps completed work when the loan funds again", async (t) => {
  const { db, admin, officer, loanId, partnerId, day, closing, initialFunding, correctedFunding, stageSince, run, apply } = fundingFixture(t);
  const filters = { from: correctedFunding, through: correctedFunding, owner: "", metric: "actual", period: "selected" };
  const dashboard = (input = {}) => readFundingDashboard(db, { ...filters, ...input }, admin, admin.brokerage.id);
  await apply({ type: "saveClosingTarget", targetDate: closing, previous: null });
  await apply({ type: "saveDisclosureStatus", status: "Signed", date: closing, revision: 0 });
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 }, officer);
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 1 }, officer);
  assert.deepEqual(dashboard().periods.selected.actual, { count: 0, volume: 0 });
  assert.deepEqual(dashboard({ period: "previous" }).loans.map(({ id, date }) => ({ id, date })), [{ id: loanId, date: initialFunding }]);
  const funded = await apply({ type: "recordFunding", fundingDate: correctedFunding, revision: 2 }, officer);
  assert.deepEqual(dashboard().periods.selected.actual, { count: 1, volume: 350000 });
  assert.deepEqual(dashboard().periods.previous.actual, { count: 0, volume: 0 });
  assert.equal(funded.loans[0].stage, "Funded");
  assert.equal(funded.closingProgress[0].preFundingStage, "Underwriting");
  assert.equal((await apply({ type: "refreshWorkspace" })).managerReports.records[0].fundingDate, correctedFunding);
  const borrowerTask = funded.tasks.find((task) => task.id.startsWith("post-funding:borrower:"));
  await apply({ type: "completeTask", id: borrowerTask.id, completed: true });
  const oldDraft = funded.communicationDrafts.find((draft) => draft.milestone === "Realtor thank-you");
  await apply({ type: "copyDraft", draftId: oldDraft.id, contactId: partnerId, audience: "Realtor", milestone: oldDraft.milestone, channel: "Email" });
  const facts = { ...emptyCallReportFacts, eligibility: "Include", state: "MI", originator: "12345", receivedDate: day(-7),
    receivedAmount: 350000, outcome: "Closed and funded", outcomeDate: correctedFunding, outcomeAmount: 350000 };
  await apply({ type: "saveCallReport", revision: 0, facts });
  const reverse = { type: "reverseFunding", fundingDate: correctedFunding, revision: 3, reason: "Funding confirmation was entered on the wrong file." };
  assert.match((await run(reverse, officer)).error, /admin/);
  assert.ok((await run({ ...reverse, revision: 2 })).error);
  const reversed = await apply(reverse);
  const backInProjection = dashboard({ from: closing, metric: "projected" });
  assert.deepEqual(backInProjection.periods.selected.actual, { count: 0, volume: 0 });
  assert.deepEqual(backInProjection.periods.selected.projected, { count: 1, volume: 350000 });
  assert.deepEqual(backInProjection.loans.map(({ id, date }) => ({ id, date })), [{ id: loanId, date: closing }]);
  assert.equal(reversed.loans[0].stage, "Underwriting");
  assert.equal(reversed.loans[0].stageSince, stageSince);
  assert.equal(reversed.closingProgress[0].fundingDate, null);
  assert.equal(reversed.closingProgress[0].disclosureStatus, "Signed");
  assert.equal(reversed.pastClients[0].closingDate, closing);
  assert.equal(reversed.managerReports.records[0].fundingDate, null);
  assert.equal(reversed.managerReports.records[0].targetDate, closing);
  assert.equal(reversed.callReportFiles[0].facts.outcome, "");
  assert.equal(reversed.callReportFiles[0].facts.originator, facts.originator);
  assert.equal(reversed.callReportFiles[0].revision, 2);
  assert.ok(quarterlyCallReport(reversed.callReportFiles, { from: day(-10), through: day(0) })[0].groups.includes("Ending pipeline"));
  assert.ok(reversed.tasks.every((task) => !task.id.startsWith("post-funding:") && !task.id.startsWith("closing-anniversary:")));
  const completed = reversed.tasks.find((task) => task.id.startsWith("reversed-funding:"));
  assert.ok(completed.completedAt);
  assert.deepEqual(reversed.managerReports.returningClients.map(({ metric, detail }) => ({ metric, detail })),
    [{ metric: "check-ins", detail: "Marked complete" }]);
  assert.ok((await run({ type: "completeTask", id: completed.id, completed: false })).error);
  const historical = reversed.communicationDrafts.find((draft) => draft.id === oldDraft.id);
  assert.ok(historical.supersededAt && historical.emailCopiedAt);
  assert.ok((await run(reverse)).error);
  assert.ok((await run({ type: "recordFunding", fundingDate: correctedFunding, revision: 3 }, officer)).error);
  const audit = await run({ type: "loadLoanAudit" });
  assert.ok(audit.loanAudit.some((entry) => entry.action === "Reversed funding" &&
    entry.changes.some((change) => change.field === "Funding date" && change.before === correctedFunding && change.after === null)));

  const again = await apply({ type: "recordFunding", fundingDate: day(0), revision: 4 });
  assert.ok(again.tasks.some((task) => task.id === borrowerTask.id && !task.completedAt));
  assert.ok(again.tasks.some((task) => task.id === completed.id && task.completedAt));
  const fresh = again.communicationDrafts.find((draft) => draft.milestone === oldDraft.milestone && !draft.supersededAt);
  assert.notEqual(fresh.id, oldDraft.id);
  assert.equal(fresh.emailCopiedAt, null);

  db.prepare("UPDATE closing_progress SET preFundingStage = NULL, preFundingStageSince = NULL WHERE loanId = ?").run(loanId);
  const legacy = await apply({ ...reverse, fundingDate: again.closingProgress[0].fundingDate, revision: 5 });
  assert.equal(legacy.loans[0].stage, "Clear to Close");
});

test("funding totals and bounded loan pages use the same brokerage, officer, date and eligibility rules", (t) => {
  const { db, admin, officer, contactId, loanId, closing, stageSince } = fundingFixture(t);
  const read = (query, staff = admin, brokerageId = admin.brokerage.id) => readFundingDashboard(db, query, staff, brokerageId);
  const query = { from: closing, through: closing, owner: `email:${officer.email}`, metric: "projected", period: "selected" };
  const record = db.prepare("INSERT INTO closing_plans (loanId, targetDate) VALUES (?, ?)");
  record.run(loanId, closing);
  const addLoan = (id, overrides = {}) => {
    insertLoan(db, { id, contactId, partnerId: null, officer: officer.name, officerEmail: officer.email,
      address: "", amount: 100000, purpose: "Purchase", stage: "Underwriting", stageSince, ...overrides });
    record.run(id, closing);
  };
  for (let i = 0; i < 33; i++) addLoan(`page-${i.toString().padStart(2, "0")}`);
  addLoan("other-officer", { officer: admin.name, officerEmail: admin.email });
  addLoan("held");
  db.prepare("UPDATE loans SET disposition = 'On hold' WHERE id = ?").run("held");
  addLoan("stage-only", { stage: "Funded" });
  addLoan("recorded");
  db.prepare("INSERT INTO closing_progress (loanId, fundingDate) VALUES (?, ?)").run("recorded", closing);

  const first = read(query);
  assert.deepEqual(first.periods.selected.projected, { count: 34, volume: 3650000 });
  assert.deepEqual(first.periods.selected.actual, { count: 1, volume: 100000 });
  assert.equal(first.loans.length, 30);
  assert.equal(Object.getPrototypeOf(first.loans[0]), Object.prototype);
  const second = read({ ...query, after: first.next });
  assert.equal(second.loans.length, 4);
  assert.equal(second.next, null);
  const all = [...first.loans, ...second.loans];
  assert.equal(new Set(all.map(({ id }) => id)).size, 34);
  assert.equal(all.reduce((sum, row) => sum + row.amount, 0), first.periods.selected.projected.volume);
  assert.deepEqual(read({ ...query, metric: "actual" }).loans.map(({ id }) => id), ["recorded"]);
  assert.equal(read({ ...query, owner: `email:${admin.email}` }).periods.selected.projected.count, 1);
  assert.equal(read({ ...query, owner: "" }).periods.selected.projected.count, 35);
  assert.ok(read(query, officer).error);
  assert.ok(read(query, { ...officer, brokerage: { ...officer.brokerage, role: "Processor" } }).error);
  assert.ok(read(query, admin, crypto.randomUUID()).error);
  assert.ok(read(query, null).error);
  assert.ok(read({ ...query, from: "2020-01-01", through: "2022-01-01" }).error);

  db.exec("DROP INDEX closing_plans_by_target; DROP INDEX closing_progress_by_funding;");
  initializeStore(db, false);
  initializeStore(db, false);
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name IN ('closing_plans_by_target', 'closing_progress_by_funding')").get().count, 2);
  assert.deepEqual(read(query).periods, first.periods);
  assert.deepEqual(read(query).loans, first.loans);
});

test("funding loan details, saved views and monthly targets stay scoped and survive retries", async (t) => {
  const { db, admin, officer, loanId, closing, initialFunding, apply } = fundingFixture(t);
  db.exec("DROP TABLE funding_dashboard_views; DROP TABLE funding_monthly_targets;");
  initializeStore(db, false);
  const otherBrokerage = fundingFixture(t);
  const action = (input, staff = admin, id = admin.brokerage.id) => fundingRecordAction(db, input, staff, id);
  const query = { ...currentFundingMonth(), owner: "", metric: "actual", period: "selected" };
  const report = (input = {}) => readFundingDashboard(db, { ...query, ...input }, admin, admin.brokerage.id);
  const view = { type: "saveView", id: crypto.randomUUID(), name: "Fictional funded loans", filters: { ...query,
    metric: "projected", after: { date: closing, id: loanId } } };
  const target = { type: "saveTarget", month: query.from.slice(0, 7), revision: 0, count: 12, volume: 4000000 };
  const detail = { type: "loan", id: loanId };

  assert.ok(action(detail, officer).error);
  assert.ok(action(view, officer).error);
  assert.ok(action(target, admin, otherBrokerage.admin.brokerage.id).error);
  assert.ok(fundingRecordAction(otherBrokerage.db, detail, otherBrokerage.admin, otherBrokerage.admin.brokerage.id).error);
  assert.deepEqual(action(detail).loan, { id: loanId, name: "Fictional Borrower", officer: officer.name, stage: "Underwriting",
    amount: 350000, address: "", targetDate: null, closingDate: null, fundingDate: null, disclosureStatus: null, outstanding: 0 });
  await apply({ type: "saveClosingTarget", targetDate: closing, previous: null });
  await apply({ type: "recordClosing", closingDate: closing, revision: 0 }, officer);
  await apply({ type: "recordFunding", fundingDate: initialFunding, revision: 0 }, officer);
  assert.equal(action(detail).loan.fundingDate, initialFunding);

  assert.ok(action(view).message);
  assert.ok(action(view).message);
  assert.ok(action({ ...view, id: crypto.randomUUID(), name: view.name.toUpperCase() }).error);
  assert.deepEqual(report().views, [{ id: view.id, name: view.name, filters: { ...query, metric: "projected" } }]);
  assert.ok(action(target).message);
  assert.ok(action(target).message);
  assert.match(action({ ...target, volume: 5000000 }).error, /changed/);
  assert.ok(action({ ...target, revision: 1, volume: 5000000 }).message);
  assert.deepEqual(report().target, { month: target.month, revision: 2, count: 12, volume: 5000000 });
  assert.equal(report({ owner: `email:${officer.email}` }).target, null);
  assert.equal(report({ through: query.from }).target, null);
  initializeStore(db, false);
  assert.equal(report().target.revision, 2);
  assert.equal(report().views.length, 1);
  assert.ok(action({ type: "removeView", id: view.id }).message);
  assert.ok(action({ type: "removeView", id: view.id }).message);
  assert.ok(action(view).error);
  assert.deepEqual(report().views, []);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Saved monthly production target'").get().count, 2);
});

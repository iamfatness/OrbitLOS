import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });
const { tridElements } = await import("../src/lib/trid-model.ts");
const { preciseBusinessDay, tridTiming } = await import("../src/lib/trid-timing.ts");
const { reviewEstimateRevisions } = await import("../src/lib/trid-fee-evidence.ts");
const { michiganChargeReview, reviewMichiganCharges } = await import("../src/lib/michigan-charge-review.ts");

test("Michigan charge evidence distinguishes unknown amounts, expense gaps and written extensions", () => {
  const base = { type: "miChargeReview", key: " Guarantee ", name: "Fictional guarantee", category: "Rate guarantee",
    applicability: "First mortgage by this licensee or registrant", chargedCents: 10000, paidCents: 0, collections: 0,
    termsReference: "Written terms", originalExpiry: "2026-07-15", extension: "Extended", extendedExpiry: "2026-07-20",
    extensionReference: "All parties' written extension", reference: "Fictional ledger" };
  const parse = input => michiganChargeReview.parse(input);
  const review = input => reviewMichiganCharges([{ sequence: 1, event: parse(input) }])[0].issues;
  assert.equal(parse(base).key, "guarantee");
  assert.deepEqual(review(base), []);
  assert.match(review({ ...base, extensionReference: undefined })[0], /written extension/);
  assert.match(review({ ...base, extendedExpiry: base.originalExpiry })[0], /does not move/);
  assert.match(review({ ...base, paidCents: undefined })[0], /Reconcile/);
  assert.equal(michiganChargeReview.safeParse({ ...base, collections: 2 }).success, false);
  assert.equal(michiganChargeReview.safeParse({ ...base, extension: "No extension" }).success, false);
  const expense = { type: base.type, key: "appraisal", name: "Fictional appraisal", category: "Actual expense",
    applicability: "Unresolved", chargedCents: 12000, paidCents: 14000, collections: 2, expenseCents: 11000, reference: "Fictional ledger" };
  assert.match(review(expense).join(" "), /Confirm the first mortgage.*Multiple collections.*payments exceed.*documented actual expense.*charge exceeds/);
});

test("revised LE dates use the office calendar and actual receipt uses the precise interval", () => {
  const original = { type: "sent", document: "Initial LE", version: "LE-1", sender: "Creditor", on: "2026-07-01" };
  const revised = { type: "sent", document: "Revised LE", version: "LE-2", sender: "Creditor", on: "2026-07-08" };
  const line = { key: "appraisal", label: "Appraisal", borrowerCents: 10000, bucket: "Individual" };
  const snapshot = (evidenceSequence, cents) => ({ type: "feeSnapshot", evidenceSequence, complete: true, lines: [{ ...line, borrowerCents: cents }] });
  const evidence = [
    scope, original, revised, snapshot(2, 10000), snapshot(3, 11500),
    { type: "received", document: "Revised LE", version: "LE-2", on: "2026-07-09" },
    { type: "sent", document: "Initial CD", on: "2026-07-10" },
    { type: "closing", on: "2026-07-14" },
    { type: "estimateRevision", originalSequence: 4, revisedSequence: 5, chargeKeys: ["appraisal"], on: "2026-07-02", reviewReference: "Fixture" },
  ];
  const review = events => reviewEstimateRevisions(events.map((event, index) => ({ sequence: index + 1, event })))[0];
  const result = review(evidence);
  assert.equal(result.dueOn, "2026-07-08");
  assert.equal(result.receivedOn, "2026-07-09");
  assert.match(result.status, /Recorded dates meet the checks/);
  evidence[7] = { type: "closing", on: "2026-07-13" };
  assert.match(review(evidence).status, /four-day interval/);
  evidence[6] = { type: "sent", document: "Initial CD", on: "2026-07-08" };
  assert.match(review(evidence).status, /on or after/);
});

const now = "2026-07-20T12:00:00Z";
const scope = { type: "scope", coveredScenario: true, creditor: "Fictional creditor", leSender: "Creditor",
  zone: "America/Detroit", openWeekdays: [1, 2, 3, 4, 5], calendarFrom: "2026-07-01",
  calendarThrough: "2026-07-31", closures: ["2026-07-03"], extraOpen: [], reference: "Scope-1" };
const elements = Object.keys(tridElements).map((element, index) => ({
  type: "element", element, on: index === 5 ? "2026-07-02" : "2026-07-01", reference: "Intake-1",
}));
const le = { type: "sent", document: "Initial LE", version: "LE-1", sender: "Creditor", method: "Mail", on: "2026-07-03" };
const cd = { type: "sent", document: "Initial CD", version: "CD-1", sender: "Settlement agent", method: "Mail", on: "2026-07-08" };
const calculate = events => tridTiming(events.map((event, index) => ({ sequence: index + 1, event })), now);

test("the sixth receipt starts the clock and each timing check uses the correct calendar", () => {
  const result = calculate([scope, ...elements, le, cd, { type: "closing", on: "2026-07-14" }]);
  assert.equal(result.applicationOn, "2026-07-02");
  assert.equal(result.leDue, "2026-07-08");
  assert.equal(result.leEarliest, "2026-07-13");
  assert.equal(result.cdReceipt, "2026-07-11");
  assert.equal(result.cdEarliest, "2026-07-15");
  assert.equal(result.cdWait, "Scheduled date falls short");
  assert.equal(preciseBusinessDay("2026-07-03"), true);
  assert.equal(preciseBusinessDay("2026-07-04"), false);
  assert.equal(preciseBusinessDay("2027-06-19"), false);
  assert.equal(preciseBusinessDay("2026-11-26"), false);
});

test("incomplete calendars and unresolved delivery cannot produce a positive result", () => {
  assert.equal(calculate([scope, ...elements.slice(0, 5)]).applicationOn, null);
  assert.equal(calculate([{ ...scope, calendarThrough: "2026-07-07" }, ...elements]).leDue, null);
  assert.equal(calculate([scope, ...elements, { ...le, sender: "Broker" }]).leEarliest, null);
  const electronic = { ...cd, method: "Electronic" };
  assert.equal(calculate([scope, ...elements, electronic]).cdEarliest, null);
  const receipt = { type: "received", document: "Initial CD", version: "CD-1", on: "2026-07-09" };
  assert.equal(calculate([scope, ...elements, electronic, receipt]).cdEarliest, "2026-07-13");
  assert.equal(calculate([scope, ...elements, electronic, receipt, { ...cd, document: "Corrected CD" }]).cdEarliest, null);
  assert.equal(calculate([scope, ...elements, { type: "void", sequence: 7 }]).applicationOn, null);
});

test("fee review requires receipt, intent and fee order on linked records", () => {
  const receipt = { type: "received", document: "Initial LE", version: "LE-1", on: "2026-07-07", localTime: "09:00" };
  const intent = { type: "intent", receiptSequence: 2, on: "2026-07-07", localTime: "09:30" };
  const fee = { type: "fee", intentSequence: 3, category: "Other", activity: "Payment method required", on: "2026-07-07", localTime: "10:00" };
  const review = (receiptEntry, intentEntry, ...entries) => calculate([scope, receiptEntry, intentEntry, ...entries]).feeEvidence;
  assert.match(review(receipt, intent, fee).at(-1).status, /after the linked receipt and intent/);
  assert.match(review(receipt, intent, { ...fee, localTime: "09:15" }).at(-1).status, /before its prerequisite/);
  assert.match(review(receipt, { ...intent, localTime: "08:55" }, fee).at(-1).status, /before its prerequisite/);
  assert.match(review(receipt, intent, { ...fee, localTime: undefined }).at(-1).status, /same-day event order/);
  assert.match(review(receipt, intent, fee, { type: "void", sequence: 2 }).at(-1).status, /Needs linked receipt/);
  assert.match(review(receipt, intent, fee, { type: "void", sequence: 3 }).at(-1).status, /Needs linked receipt/);
  assert.match(review(receipt, intent, { ...fee, category: "Credit report", intentSequence: undefined }).at(-1).status, /Review the credit report fee exception/);
  const repeated = "2026-11-01";
  assert.match(review({ ...receipt, on: repeated, localTime: "01:00" },
    { ...intent, on: repeated, localTime: "01:30" }, { ...fee, on: repeated }).at(-1).status, /same-day event order/);
});

test("fee cure tracks independent refund and corrected disclosure dates and keeps gaps visible", async () => {
  const { reviewFeeCures } = await import("../src/lib/trid-closing-review.ts");
  const send = (document, on) => ({ type: "sent", document, version: document, on });
  const snapshot = (evidenceSequence, borrowerCents) => ({
    type: "feeSnapshot", evidenceSequence, complete: true, reference: "Fictional fee evidence",
    lines: [{ key: "appraisal", label: "Fictional appraisal", bucket: "Individual", borrowerCents }],
  });
  const entries = [
    send("Initial LE", "2026-06-22"), send("Initial CD", "2026-06-26"),
    snapshot(1, 10000), snapshot(2, 11250), { type: "consummated", on: "2026-06-30" },
    send("Corrected CD", "2026-08-28"),
    { type: "feeCure", on: "2026-08-29", refundCents: 1250,
      consummationSequence: 5, estimateSequence: 3, closingSequence: 4, correctedSendSequence: 6 },
  ].map((event, index) => ({ sequence: index + 1, event }));
  const [review] = reviewFeeCures(entries);
  assert.equal(review.dueOn, "2026-08-29");
  assert.equal(review.potential, 1250);
  assert.equal(review.refundStatus, "Recorded within 60 days");
  assert.equal(review.correctionStatus, "Recorded within 60 days");
  const [withdrawnCorrection] = reviewFeeCures(entries.filter(entry => entry.sequence !== 6));
  assert.equal(withdrawnCorrection.correctionStatus, "Needs linked corrected disclosure evidence");
  assert.equal(withdrawnCorrection.refundStatus, review.refundStatus);
  const [withdrawnSnapshot] = reviewFeeCures(entries.filter(entry => entry.sequence !== 4));
  assert.equal(withdrawnSnapshot.potential, null);
  assert.equal(withdrawnSnapshot.refundStatus, review.refundStatus);
  assert.equal(withdrawnSnapshot.correctionStatus, review.correctionStatus);
  const [withdrawnConsummation] = reviewFeeCures(entries.filter(entry => entry.sequence !== 5));
  assert.equal(withdrawnConsummation.dueOn, null);
  assert.equal(withdrawnConsummation.refundStatus, "Needs active consummation evidence");
});

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
const { initializeStore, insertContact } = await import("../src/lib/store.ts");
const { createMilestoneDrafts, createRealtorLenderDraft } = await import("../src/lib/communications.ts");
const { borrowerCommandResult } = await import("../src/lib/applications.ts");
const { realtorReferrals } = await import("../src/lib/realtor-portal.ts");
const { readWorkspaceCalendar } = await import("../src/lib/officer-queue.ts");
const { easternDate } = await import("../src/lib/client-retention.ts");
const { shiftReportDate } = await import("../src/lib/report-date-range.ts");
const { applyLoanMutation } = await import("../src/lib/loan-work-model.ts");
const { readUwmDelivery } = await import("../src/lib/uwm-delivery.ts");
const { latestMockConditionUpdate, receiveMockConditionUpdate } = await import("../src/lib/uwm-condition-events.ts");
const { conditionEvidenceKey } = await import("../src/lib/condition-evidence-model.ts");
const { borrowerDocuments } = await import("../src/lib/borrower-documents.ts");
const { documentCleanupBatch, downloadableDocument } = await import("../src/lib/document-files.ts");

function setup(t) {
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
  const staff = { name: "Demo Admin", email: "demo@example.test",
    brokerage: { id: crypto.randomUUID(), role: "Admin", pilot: true, name: "Fictional team" } };
  const command = (input) => executeCommand(db, input, staff);
  const apply = async (input) => {
    const result = await command(input);
    assert.ok(result.state, result.error);
    return result.state;
  };
  return { db, staff, command, apply };
}

test("a scoped loan save preserves unrelated files and returns current revisions", async (t) => {
  const { db, staff, apply } = setup(t);
  const state = await apply({ type: "sync" });
  const [loan, other] = state.loans;
  const itemId = crypto.randomUUID();
  const input = { type: "saveClosingItem", loanId: loan.id, itemId, revision: 0, title: "Confirm signing",
    owner: "Loan officer", dueDate: "2026-11-10" };
  const write = (data, actor = staff) => executeCommand(db, data, actor, undefined, [], { scopedLoanUpdates: true });
  const saved = await write(input);
  assert.ok(!("state" in saved));
  assert.deepEqual(saved.loanWork.loans.map(({ id }) => id), [loan.id]);
  assert.equal(saved.loanWork.closingItems[0].revision, 1);
  const updated = applyLoanMutation(state, saved.loanWork);
  const previousWorker = { ...saved.loanWork };
  delete previousWorker.borrowerQuestions;
  assert.equal(applyLoanMutation(state, previousWorker).closingItems.find(({ id }) => id === itemId).revision, 1);
  assert.equal(updated.loans.find(({ id }) => id === other.id), other);
  assert.equal(updated.closingItems.find(({ id }) => id === itemId).title, input.title);
  assert.equal(updated.contacts, state.contacts);
  assert.equal((await write(input)).loanWork.closingItems[0].revision, 1);
  assert.match((await write({ ...input, title: "Stale revision" })).error, /changed/);
  const stranger = { ...staff, email: "unassigned@example.test", brokerage: { ...staff.brokerage, role: "Processor" } };
  assert.match((await write({ ...input, revision: 1 }, stranger)).error, /access/);
});

test("suggested UWM document requests are scoped, atomic, and safe to retry", async (t) => {
  const { db, staff, command, apply } = setup(t);
  const initial = await apply({ type: "sync" });
  const file = initial.submissions.find((item) => item.status === "Wholesale - Approved With Conditions");
  const [income, assets, cleared] = file.conditions;
  const batch = { type: "requestSuggestedUwmDocuments", loanId: file.loanId, submissionId: file.id, conditionIds: [income.id, assets.id] };
  const otherLoan = initial.loans.find((loan) => loan.id !== file.loanId);
  assert.match((await command({ ...batch, loanId: otherLoan.id })).error, /unavailable/);
  assert.match((await executeCommand(db, batch, { ...staff, brokerage: { ...staff.brokerage, role: "LO" } })).error, /access/);
  assert.match((await command({ ...batch, conditionIds: [income.id, cleared.id] })).error, /changed/);
  assert.equal(db.prepare("SELECT count(*) AS count FROM document_requests").get().count, 0);
  const saved = await apply(batch);
  assert.equal(saved.documentRequests.length, 2);
  assert.equal(saved.submissions.find((item) => item.id === file.id).conditions[0].satisfiedAt, null);
  for (const [condition, kind] of [[income, "Pay stub"], [assets, "Bank statement"]]) {
    const request = saved.documentRequests.find((item) => item.conditionId === condition.id);
    assert.equal(request.submissionId, file.id);
    assert.equal(request.kind, kind);
    assert.equal(request.instructions, condition.description);
    assert.equal(request.status, "Requested");
  }
  assert.deepEqual((await apply(batch)).documentRequests, saved.documentRequests);
});

test("linked condition evidence keeps the accepted PDF revision through delivery and replacements", async (t) => {
  const { db, staff, apply } = setup(t);
  const initial = await apply({ type: "sync" });
  const file = initial.submissions.find((item) => item.status === "Wholesale - Approved With Conditions");
  const [income, assets] = file.conditions;
  const { loanId } = file;
  const processor = { ...staff, email: "processor@example.test", name: "Fictional Processor",
    brokerage: { ...staff.brokerage, role: "Processor" } };
  const otherProcessor = { ...processor, email: "unassigned@example.test" };
  const write = (input, actor = processor) => executeCommand(db, input, actor, undefined, [], { scopedLoanUpdates: true });
  const at = new Date().toISOString();
  db.prepare("INSERT INTO loan_processing VALUES (?, ?, ?, 'In processing', '', ?, 1)").run(loanId, processor.email, processor.name, at);
  await apply({ type: "requestDocument", loanId, kind: "Pay stub", instructions: "Sample income condition.",
    condition: { submissionId: file.id, conditionId: income.id } });
  const state = await apply({ type: "requestDocument", loanId, kind: "Pay stub", instructions: "Sample payroll evidence." });
  const target = state.documentRequests.find(({ conditionId }) => conditionId === income.id);
  const source = state.documentRequests.find(({ conditionId }) => conditionId === null);
  const original = crypto.randomUUID();
  db.prepare("UPDATE document_requests SET status = 'Received', revision = 1, submittedAt = ? WHERE id = ?").run(at, source.id);
  db.prepare("INSERT INTO document_files (requestId, objectId, uploadedAt, attemptedAt, uploadMode) VALUES (?, ?, ?, ?, 'mock')")
    .run(source.id, original, at, Date.parse(at));
  const review = await write({ type: "reviewDocument", loanId, requestId: source.id, revision: 1, decision: "Accepted", replacementNote: "" });
  assert.ok(review.loanWork, review.error);
  const link = { type: "reuseConditionEvidence", loanId, submissionId: file.id, conditionId: income.id,
    conditionKey: conditionEvidenceKey(income), target: { id: target.id, revision: target.revision },
    source: { id: source.id, revision: 2 }, linkId: crypto.randomUUID(), confirmed: true };
  assert.match((await write(link, otherProcessor)).error, /access/i);
  assert.match((await write({ ...link, target: null })).error, /changed/i);
  assert.match((await write({ ...link, source: { id: source.id, revision: 1 } })).error, /current accepted revision/i);
  assert.match((await write({ ...link, conditionKey: "stale" })).error, /changed/i);
  const linked = await write(link);
  assert.ok(linked.loanWork, linked.error);
  const document = linked.loanWork.documentRequests.find(({ id }) => id === target.id);
  assert.equal(document.status, "Accepted");
  assert.equal(document.revision, target.revision + 1);
  assert.equal(document.uwmReceipt, null);
  assert.equal(document.evidenceLinks.length, 1);
  assert.deepEqual(document.evidenceLinks.map(({ sourceId, sourceRevision, reviewedBy, linkedBy, pdf }) =>
    ({ sourceId, sourceRevision, reviewedBy, linkedBy, pdf })),
  [{ sourceId: source.id, sourceRevision: 2, reviewedBy: processor.name, linkedBy: processor.name, pdf: true }]);
  assert.equal((await write(link)).message, linked.message);
  assert.match((await write({ ...link, conditionId: assets.id, conditionKey: conditionEvidenceKey(assets), target: null })).error, /new evidence link/i);
  assert.match((await write({ ...link, conditionId: assets.id, conditionKey: conditionEvidenceKey(assets), target: null,
    linkId: crypto.randomUUID(), source: { id: target.id, revision: document.revision } })).error, /current accepted revision/i);
  assert.doesNotMatch(JSON.stringify(borrowerDocuments(db, loanId, "Primary borrower")), /evidenceLinks|Fictional Processor/);
  assert.equal(downloadableDocument(db, processor, target.id, link.linkId).objectId, original);
  assert.equal(downloadableDocument(db, processor, source.id, link.linkId), null);
  assert.equal(downloadableDocument(db, otherProcessor, target.id, link.linkId), null);
  const sent = await write({ type: "sendConditionDocument", loanId, requestId: target.id, revision: document.revision });
  assert.match(sent.loanWork.documentRequests.find(({ id }) => id === target.id).uwmReceipt, /^DEMO-DOC-/);
  const cleared = await write({ type: "refreshMockUwmClearance", loanId, submissionId: file.id });
  assert.ok(cleared.loanWork.submissions.find(({ id }) => id === file.id).conditions.find(({ id }) => id === income.id).satisfiedAt);
  const replace = db.prepare("UPDATE document_files SET objectId = ? WHERE requestId = ?");
  replace.run(crypto.randomUUID(), source.id);
  replace.run(crypto.randomUUID(), target.id);
  assert.equal(downloadableDocument(db, processor, target.id, link.linkId).objectId, original);
  assert.ok(!documentCleanupBatch(db).includes(original));
  db.prepare("DELETE FROM document_requests WHERE id = ?").run(target.id);
  assert.equal(documentCleanupBatch(db).filter((id) => id === original).length, 1);
  assert.equal(downloadableDocument(db, processor, target.id, link.linkId), null);
});

test("assigned processors can bulk review, deliver, retry and clear only the selected evidence", async (t) => {
  const { db, staff, apply } = setup(t);
  const initial = await apply({ type: "sync" });
  const file = initial.submissions.find((item) => item.status === "Wholesale - Approved With Conditions");
  const [income, assets] = file.conditions;
  const loanId = file.loanId;
  const processor = { ...staff, email: "processor@example.test", name: "Fictional Processor", brokerage: { ...staff.brokerage, role: "Processor" } };
  db.prepare("INSERT INTO loan_processing VALUES (?, ?, ?, 'In processing', '', ?, 1)").run(loanId, processor.email, processor.name, new Date().toISOString());
  await apply({ type: "requestSuggestedUwmDocuments", loanId, submissionId: file.id, conditionIds: [income.id, assets.id] });
  const { documentRequests } = await apply({ type: "requestDocument", loanId, kind: "Photo ID", instructions: "Fictional standalone evidence." });
  const ids = [income.id, assets.id, null].map((conditionId) => documentRequests.find((item) => item.conditionId === conditionId).id);
  const [pay, bank, photo] = ids.map((requestId) => ({ requestId, revision: 1 }));
  const markReceived = db.prepare("UPDATE document_requests SET status = 'Received', revision = 1, submittedAt = ? WHERE id = ?");
  for (const id of ids) markReceived.run(new Date().toISOString(), id);
  const batch = (action, items, reviewed = false) => ({ type: "processDocumentBatch", loanId, batchId: crypto.randomUUID(), action, items, reviewed });
  const write = (input, actor = processor) => executeCommand(db, input, actor, undefined, [], { scopedLoanUpdates: true });
  const current = (id) => db.prepare("SELECT status, revision FROM document_requests WHERE id = ?").get(id);
  const receipt = (id) => db.prepare("SELECT receipt, mockClearedAt FROM uwm_document_deliveries WHERE requestId = ?").get(id);
  const outsider = { ...processor, email: "unassigned@example.test" };
  assert.match((await write(batch("accept", [bank, photo], true), outsider)).error, /access/i);
  assert.match((await write(batch("accept", [bank, photo]))).error, /reviewed/i);
  assert.match((await write(batch("accept", [bank, bank], true))).error, /only once/i);
  assert.match((await write(batch("accept", [bank, { ...photo, revision: 0 }], true))).error, /changed/i);
  assert.match((await write(batch("accept-and-send", [pay, photo], true))).error, /changed/i);
  assert.ok(ids.every((id) => current(id).status === "Received" && current(id).revision === 1));
  assert.equal(db.prepare("SELECT count(*) AS count FROM loan_document_batches").get().count, 0);

  const accepted = batch("accept", [bank, photo], true);
  const result = await write(accepted);
  assert.equal(result.message, "Accepted 2 documents.");
  assert.deepEqual(result.loanWork.loans.map(({ id }) => id), [loanId]);
  assert.equal((await write({ ...accepted, items: [photo, bank] })).message, result.message);
  assert.match((await write({ ...accepted, items: [pay, bank] })).error, /Start a new batch/);
  assert.equal(current(bank.requestId).revision, 2);
  assert.equal(current(photo.requestId).status, "Accepted");
  assert.equal(current(pay.requestId).status, "Received");
  const acceptAndSend = batch("accept-and-send", [pay], true);
  assert.equal((await write(acceptAndSend)).message, "Accepted and sent 1 document to mock UWM.");
  const payReceipt = receipt(pay.requestId).receipt;
  assert.match((await write(acceptAndSend)).message, /Accepted and sent/);
  assert.equal(receipt(pay.requestId).receipt, payReceipt);
  assert.ok(!receipt(bank.requestId));
  await apply({ type: "simulateDeliveryFailure", loanId, requestId: bank.requestId, revision: 2 });
  assert.equal((await write(batch("send", [{ ...bank, revision: 2 }]))).message, "Sent 1 document to mock UWM.");
  const bankReceipt = receipt(bank.requestId).receipt;
  const clearPay = batch("clear", [{ ...pay, revision: 2, receipt: payReceipt }]);
  assert.match((await write({ ...clearPay, items: [...clearPay.items, { ...bank, revision: 2, receipt: "outdated receipt" }] })).error, /changed/i);
  assert.equal(receipt(pay.requestId).mockClearedAt, null);
  assert.match((await write(clearPay)).message, /1 selected condition/);
  const clearedAt = receipt(pay.requestId).mockClearedAt;
  assert.ok(clearedAt);
  assert.equal(receipt(bank.requestId).mockClearedAt, null);
  assert.match((await write(clearPay)).message, /1 selected condition/);
  assert.equal(receipt(pay.requestId).mockClearedAt, clearedAt);
  const final = await write(batch("clear", [{ ...bank, revision: 2, receipt: bankReceipt }]));
  assert.ok(final.loanWork.submissions.find(({ id }) => id === file.id).conditions.every(({ satisfiedAt }) => satisfiedAt));
  assert.equal(db.prepare("SELECT count(*) AS count FROM loan_document_batches").get().count, 5);
});

test("borrower due dates track the open request without changing its upload revision", async (t) => {
  const { db, staff, command, apply } = setup(t);
  const initial = await apply({ type: "sync" });
  const file = initial.submissions.find((item) => item.status === "Wholesale - Approved With Conditions");
  const [income] = file.conditions;
  const now = new Date();
  const week = easternDate(now);
  const firstDate = shiftReportDate(week, 1);
  const secondDate = shiftReportDate(week, 2);
  const calendar = (day, actor = staff, scope = "Team") => readWorkspaceCalendar(db, { week, day, scope, group: "Documents" }, actor, staff.brokerage.id, now);
  await apply({ type: "startApplication", loanId: file.loanId });
  db.prepare("UPDATE applications SET submittedAt = ? WHERE loanId = ?").run(now.toISOString(), file.loanId);
  const token = db.prepare("SELECT token FROM applications WHERE loanId = ?").get(file.loanId).token;
  const state = await apply({ type: "requestDocument", loanId: file.loanId, kind: "Pay stub", instructions: income.description,
    condition: { submissionId: file.id, conditionId: income.id }, dueOn: firstDate });
  const [request] = state.documentRequests;
  const borrowerRequest = () => borrowerCommandResult(db, { type: "read", token }).application.loanStatus.documents[0];
  assert.equal(borrowerRequest().dueOn, firstDate);
  assert.equal(calendar(firstDate).items[0].target, `document-${request.id}`);
  assert.equal(borrowerRequest().revision, request.revision);
  assert.equal(calendar(secondDate).items.length, 0);
  const move = { type: "setDocumentDeadline", loanId: file.loanId, requestId: request.id, revision: request.revision,
    deadlineRevision: request.deadlineRevision, dueOn: secondDate };
  const outsider = { ...staff, brokerage: { ...staff.brokerage, role: "Processor" } };
  assert.ok((await executeCommand(db, move, outsider)).error);
  assert.equal(calendar(firstDate, outsider, "Mine").items.length, 0);
  await apply(move);
  await apply(move);
  assert.ok((await command({ ...move, dueOn: null })).error);
  assert.equal(borrowerRequest().dueOn, secondDate);
  assert.equal(borrowerRequest().revision, request.revision);
  assert.equal(calendar(firstDate).items.length, 0);
  assert.equal(calendar(secondDate).items[0].id, request.id);
  assert.equal(db.prepare("SELECT count(*) AS count FROM activity WHERE text LIKE 'Document due date set%'").get().count, 1);
  const received = borrowerCommandResult(db, { type: "attachSample", token, requestId: request.id, revision: request.revision });
  assert.equal(received.application.loanStatus.documents[0].status, "Received");
  assert.equal(calendar(secondDate).items.length, 0);
  assert.ok((await command(move)).error);
  await apply({ type: "reviewDocument", loanId: file.loanId, requestId: request.id, revision: request.revision + 1,
    decision: "Needs replacement", replacementNote: "Attach the newer sample.", dueOn: firstDate });
  assert.equal(borrowerRequest().dueOn, firstDate);
  assert.match(calendar(firstDate).items[0].title, /Replacement pay stub/);
});

test("reopened conditions survive sync and only an accepted replacement revision can clear them", async (t) => {
  const { db, staff, command, apply } = setup(t);
  const initial = await apply({ type: "sync" });
  const file = initial.submissions.find((item) => item.status === "Wholesale - Clear To Close");
  const condition = file.conditions[0];
  const requestId = crypto.randomUUID();
  const partnerId = crypto.randomUUID();
  const now = new Date().toISOString();
  insertContact(db, { id: partnerId, name: "Fictional realtor", email: "partner@example.test", phone: "", role: "Realtor" });
  db.prepare("UPDATE loans SET partnerId = ? WHERE id = ?").run(partnerId, file.loanId);
  await apply({ type: "startApplication", loanId: file.loanId });
  db.prepare("UPDATE applications SET submittedAt = ? WHERE loanId = ?").run(now, file.loanId);
  const borrowerToken = db.prepare("SELECT token FROM applications WHERE loanId = ?").get(file.loanId).token;
  const portal = (await apply({ type: "createRealtorPortal", realtorId: partnerId })).realtorPortals[0];
  const borrowerStatus = () => borrowerCommandResult(db, { type: "read", token: borrowerToken }).application.loanStatus;
  const realtorStatus = () => realtorReferrals(db, { type: "read", token: portal.token }).value.referrals[0];
  createMilestoneDrafts(db, file.loanId, "Clear to Close", now);
  createRealtorLenderDraft(db, file.loanId, "Lender review complete", "initial-clearance", now);
  const starting = (await apply({ type: "refreshWorkspace" })).communicationDrafts;
  const firstDraft = starting.find(({ milestone }) => milestone === "Lender review complete");
  const closingDrafts = starting.filter(({ milestone }) => milestone === "Clear to Close");
  const closingDraft = closingDrafts.find(({ audience }) => audience === "Realtor");
  const closingCopy = { type: "copyDraft", loanId: file.loanId, contactId: partnerId, audience: "Realtor",
    milestone: "Clear to Close", channel: "Email" };
  const copiedClosingAt = (await apply({ ...closingCopy, draftId: closingDraft.id })).communicationDrafts.find(({ id }) => id === closingDraft.id).emailCopiedAt;
  assert.ok(copiedClosingAt);
  assert.equal(borrowerStatus().closingPause, undefined);
  assert.equal(realtorStatus().closingPause, undefined);
  const copy = { type: "copyDraft", loanId: file.loanId, contactId: partnerId, audience: "Realtor", milestone: firstDraft.milestone, channel: "Email" };
  const firstCopy = (await apply({ ...copy, draftId: firstDraft.id })).communicationDrafts[0].emailCopiedAt;
  assert.ok(firstCopy);
  db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, status, revision, submissionId, conditionId, dueOn)
    VALUES (?, ?, 'Other', 'Provide title evidence', ?, 'Accepted', 2, ?, ?, '2026-11-03')`).run(requestId, file.loanId, now, file.id, condition.id);
  db.prepare(`INSERT INTO uwm_document_deliveries (requestId, receipt, sentAt, mockClearedAt, documentRevision)
    VALUES (?, 'original-receipt', ?, ?, 2)`).run(requestId, now, now);
  const reopen = { type: "reopenMockUwmCondition", loanId: file.loanId, submissionId: file.id, conditionId: condition.id,
    expectedSatisfiedAt: condition.satisfiedAt, expectedReopenedAt: null };
  const denied = await executeCommand(db, reopen, { ...staff, brokerage: { ...staff.brokerage, pilot: false } });
  assert.match(denied.error, /fictional/);
  const reopened = await apply(reopen);
  const request = reopened.documentRequests.find((item) => item.id === requestId);
  assert.equal(request.status, "Needs replacement");
  assert.equal(request.dueOn, null);
  assert.equal(request.uwmReceipt, null);
  assert.equal(request.previousUwmDeliveries[0].receipt, "original-receipt");
  assert.equal(reopened.uwmAlerts.filter((alert) => alert.kind === "Reopened condition" && alert.conditionId === condition.id).length, 1);
  const resumed = reopened.communicationDrafts.find(({ milestone }) => milestone === "Lender review resumed");
  const previous = reopened.communicationDrafts.find(({ id }) => id === firstDraft.id);
  assert.equal(resumed.milestone, "Lender review resumed");
  assert.equal(previous.id, firstDraft.id);
  assert.equal(previous.emailCopiedAt, firstCopy);
  assert.ok(previous.supersededAt);
  assert.ok((await command({ ...copy, draftId: previous.id })).error);
  assert.ok((await command(reopen)).error);
  assert.equal(borrowerStatus().closingPause.label, "Closing on hold");
  assert.deepEqual(realtorStatus().closingPause, borrowerStatus().closingPause);
  assert.doesNotMatch(JSON.stringify(realtorStatus()), /Provide title evidence|original-receipt|documents/);
  assert.equal(reopened.communicationDrafts.find(({ id }) => id === closingDraft.id).emailCopiedAt, copiedClosingAt);
  assert.ok(reopened.communicationDrafts.filter(({ milestone }) => milestone === "Clear to Close").every(({ supersededAt }) => supersededAt));
  assert.ok((await command({ ...closingCopy, draftId: closingDraft.id })).error);
  // Emulate a workspace upgraded with a condition already open and an unretired draft.
  db.prepare("UPDATE communication_drafts SET supersededAt = NULL WHERE id = ?").run(closingDraft.id);
  db.prepare("DELETE FROM settings WHERE key = 'retiredClosingHoldDrafts'").run();
  initializeStore(db, false);
  assert.ok(db.prepare("SELECT supersededAt FROM communication_drafts WHERE id = ?").get(closingDraft.id).supersededAt);

  const clearance = { type: "refreshMockUwmClearance", loanId: file.loanId, submissionId: file.id };
  const send = { type: "sendConditionDocument", loanId: file.loanId, requestId };
  assert.ok((await command({ ...send, revision: 2 })).error);
  for (const input of [clearance, { type: "sync" }]) {
    const state = await apply(input);
    const saved = state.submissions.find((item) => item.id === file.id);
    assert.equal(saved.status, "Wholesale - Approved With Conditions");
    assert.equal(saved.conditions[0].satisfiedAt, null);
    assert.deepEqual(state.communicationDrafts, reopened.communicationDrafts);
  }
  db.prepare("UPDATE document_requests SET status = 'Received', revision = revision + 1 WHERE id = ?").run(requestId);
  await apply({ type: "reviewDocument", loanId: file.loanId, requestId, revision: request.revision + 1, decision: "Accepted", replacementNote: "" });
  assert.match((await command({ ...send, revision: 2 })).error, /document changed/);
  const delivered = await apply({ ...send, revision: request.revision + 2 });
  const current = delivered.documentRequests.find((item) => item.id === requestId);
  assert.ok(current.uwmReceipt);
  assert.notEqual(current.uwmReceipt, "original-receipt");
  const final = await apply(clearance);
  const cleared = final.submissions.find((item) => item.id === file.id);
  assert.ok(cleared.conditions[0].satisfiedAt);
  assert.equal(cleared.status, "Conditions cleared");
  const replay = { ...reopen, type: "replayMockUwmConditionDelivery", expectedSatisfiedAt: cleared.conditions[0].satisfiedAt,
    expectedReopenedAt: cleared.conditions[0].mockReopenedAt };
  const query = { loanId: file.loanId, submissionId: file.id };
  const timeline = (actor = staff, input = query, brokerageId = staff.brokerage.id) => readUwmDelivery(db, input, actor, brokerageId);
  assert.match(timeline(null).error, /unavailable/);
  assert.match(timeline(staff, { ...query, submissionId: initial.submissions.find(({ id }) => id !== file.id).id }).error, /unavailable/);
  assert.match(timeline(staff, query, crypto.randomUUID()).error, /unavailable/);
  const processor = { ...staff, email: "processor@example.test", brokerage: { ...staff.brokerage, role: "Processor" } };
  assert.match(timeline(processor).error, /unavailable/);
  db.prepare(`INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision)
    VALUES (?, ?, 'Assigned processor', 'Assigned', '', ?, 1)`).run(file.loanId, processor.email, now);
  assert.ok(timeline(processor).events.length);
  assert.match((await executeCommand(db, replay, processor)).error, /access/);
  assert.match((await executeCommand(db, replay, { ...staff, brokerage: { ...staff.brokerage, pilot: false } })).error, /fictional/);
  assert.match((await command({ ...replay, expectedSatisfiedAt: condition.satisfiedAt })).error, /changed/);
  const taskCount = final.tasks.length;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await command(replay);
    assert.match(result.message, /still cleared/);
    assert.deepEqual(result.state.submissions, final.submissions);
    assert.deepEqual(result.state.uwmAlerts, final.uwmAlerts);
    assert.deepEqual(result.state.communicationDrafts, final.communicationDrafts);
    assert.deepEqual(result.state.documentRequests, final.documentRequests);
    assert.equal(result.state.tasks.length, taskCount);
    const events = timeline().events;
    assert.equal(events.filter(({ title }) => title === "Older condition update ignored").length, 1);
    assert.ok(events.find(({ title, detail }) => title === "Duplicate condition update recognized" && detail.includes(`${attempt} repeat deliver`)));
    assert.ok(events.find(({ title, receipt, detail }) =>
      title === "Condition document acknowledged" && receipt === current.uwmReceipt && detail.includes(`revision ${current.revision}`)));
    assert.ok(events.find(({ title, receipt }) => title === "Prior condition document acknowledged" && receipt === "original-receipt"));
  }
  const currentEvent = latestMockConditionUpdate(db, file.id, condition.id);
  assert.equal(receiveMockConditionUpdate(db, file.id, condition.category, { ...currentEvent, state: "Open" }, now,
    () => assert.fail("Conflicting mock event identity was applied")), "Conflicting identity");
  assert.deepEqual(latestMockConditionUpdate(db, file.id, condition.id), currentEvent);
  assert.ok((await command(reopen)).error);
  const currentDraft = final.communicationDrafts.find(({ milestone, supersededAt }) => milestone === firstDraft.milestone && !supersededAt);
  const earlierResumed = final.communicationDrafts.find(({ id }) => id === resumed.id);
  const earlierComplete = final.communicationDrafts.find(({ id }) => id === firstDraft.id);
  assert.equal(currentDraft.milestone, firstDraft.milestone);
  assert.notEqual(currentDraft.id, firstDraft.id);
  assert.equal(currentDraft.supersededAt, null);
  assert.equal(currentDraft.emailCopiedAt, null);
  assert.equal(earlierResumed.id, resumed.id);
  assert.ok(earlierResumed.supersededAt);
  assert.equal(earlierComplete.emailCopiedAt, firstCopy);
  const copied = await apply({ ...copy, draftId: currentDraft.id, channel: "Text" });
  assert.ok(copied.communicationDrafts.find(({ id }) => id === currentDraft.id).textCopiedAt);
  assert.equal(copied.communicationDrafts.find(({ id }) => id === firstDraft.id).textCopiedAt, null);
  assert.equal(borrowerStatus().closingPause, undefined);
  assert.equal(realtorStatus().closingPause, undefined);
  const currentClosing = copied.communicationDrafts.filter(({ milestone, supersededAt }) => milestone === "Clear to Close" && !supersededAt);
  assert.equal(currentClosing.length, 2);
  assert.ok(currentClosing.every(({ id, emailCopiedAt }) => !closingDrafts.some((item) => item.id === id) && !emailCopiedAt));
  assert.ok((await command({ ...closingCopy, draftId: closingDraft.id })).error);
  const latestClosing = await apply(closingCopy);
  assert.ok(latestClosing.communicationDrafts.find(({ id }) => id === currentClosing.find(({ audience }) => audience === "Realtor").id).emailCopiedAt);
  assert.deepEqual((await apply({ type: "sync" })).communicationDrafts, latestClosing.communicationDrafts);
  const newer = await apply({ ...replay, type: "reopenMockUwmCondition" });
  assert.equal(newer.submissions.find(({ id }) => id === file.id).conditions[0].satisfiedAt, null);
  assert.equal(timeline().events.filter(({ title }) => title === "Condition reopened").length, 2);
  for (let index = 0; index < 23; index++) {
    assert.equal(receiveMockConditionUpdate(db, file.id, condition.category, { ...currentEvent, id: `older-${index}`, version: 0 }, now,
      () => assert.fail("Stale mock condition update was applied")), "Ignored stale");
  }
  const firstPage = timeline();
  const secondPage = timeline(staff, { ...query, before: firstPage.next });
  assert.equal(firstPage.events.length, 20);
  assert.ok(secondPage.events.length);
  assert.equal(secondPage.next, null);
  assert.equal(new Set([...firstPage.events, ...secondPage.events].map(({ id }) => id)).size, firstPage.events.length + secondPage.events.length);
});

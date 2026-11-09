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
const { createRealtorLenderDraft } = await import("../src/lib/communications.ts");
const { borrowerCommandResult } = await import("../src/lib/applications.ts");
const { readWorkspaceCalendar } = await import("../src/lib/officer-queue.ts");
const { easternDate } = await import("../src/lib/client-retention.ts");
const { shiftReportDate } = await import("../src/lib/report-date-range.ts");
const { applyLoanMutation } = await import("../src/lib/loan-work-model.ts");

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
  createRealtorLenderDraft(db, file.loanId, "Lender review complete", "initial-clearance", now);
  const firstDraft = (await apply({ type: "refreshWorkspace" })).communicationDrafts[0];
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
  const [resumed, previous] = reopened.communicationDrafts;
  assert.equal(resumed.milestone, "Lender review resumed");
  assert.equal(previous.id, firstDraft.id);
  assert.equal(previous.emailCopiedAt, firstCopy);
  assert.ok(previous.supersededAt);
  assert.ok((await command({ ...copy, draftId: previous.id })).error);
  assert.ok((await command(reopen)).error);

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
  assert.ok((await command(reopen)).error);
  const [currentDraft, earlierResumed, earlierComplete] = final.communicationDrafts;
  assert.equal(currentDraft.milestone, firstDraft.milestone);
  assert.notEqual(currentDraft.id, firstDraft.id);
  assert.equal(currentDraft.supersededAt, null);
  assert.equal(currentDraft.emailCopiedAt, null);
  assert.equal(earlierResumed.id, resumed.id);
  assert.ok(earlierResumed.supersededAt);
  assert.equal(earlierComplete.emailCopiedAt, firstCopy);
  const copied = await apply({ ...copy, draftId: currentDraft.id, channel: "Text" });
  assert.ok(copied.communicationDrafts[0].textCopiedAt);
  assert.equal(copied.communicationDrafts[2].textCopiedAt, null);
  assert.deepEqual((await apply({ type: "sync" })).communicationDrafts, copied.communicationDrafts);
});

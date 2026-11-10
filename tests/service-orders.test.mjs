import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { readEditableLoan } = await import("../src/lib/editable-loan.ts");
const { readOfficerQueue, readWorkspaceTasks } = await import("../src/lib/officer-queue.ts");
const { readProcessorQueue } = await import("../src/lib/processor-queue.ts");
const { serviceOrderTarget } = await import("../src/lib/service-order-model.ts");
const { serviceOrderPdf } = await import("../src/lib/service-order-pdf.ts");
const { easternDate } = await import("../src/lib/client-retention.ts");
const { shiftReportDate } = await import("../src/lib/report-date-range.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const brokerageId = randomUUID();
  const staff = (role, name) => ({ name, email: `${name.toLowerCase()}@example.test`,
    brokerage: { id: brokerageId, name: "Fictional brokerage", role, pilot: true } });
  const owner = staff("LO", "Owner"), admin = staff("Admin", "Admin"), processor = staff("Processor", "Processor");
  const another = staff("Processor", "Another");
  const now = new Date(), today = easternDate(now), overdue = shiftReportDate(today, -1);
  const loan = (name) => {
    const loanId = randomUUID(), contactId = randomUUID();
    insertContact(db, { id: contactId, name, role: "Borrower", email: "", phone: "" });
    insertLoan(db, { id: loanId, contactId, partnerId: null, stage: "Processing", stageSince: now.toISOString(),
      purpose: "Purchase", amount: 360000, address: "", officer: owner.name, officerEmail: owner.email });
    return loanId;
  };
  const loanId = loan("Fictional Applicant");
  const send = (input, actor = owner, id = loanId) => executeCommand(db, { loanId: id, ...input }, actor, undefined, [], { scopedLoanUpdates: true });
  const queue = (view, actor = admin, tenant = brokerageId, after) =>
    readProcessorQueue(db, { readyOnly: false, serviceOrders: { view, after } }, actor, tenant, now);
  return { db, brokerageId, owner, admin, processor, another, now, today, overdue, loanId, loan, send, queue };
}

test("mock orders route to the current processor and retain each returned and reviewed PDF", async (t) => {
  const { db, brokerageId, owner, processor, another, now, overdue, loanId, send, queue } = fixture(t);
  const orderId = randomUUID();
  const create = { type: "createServiceOrder", orderId, kind: "Appraisal", dueOn: overdue, note: "Fictional overdue appointment" };
  const changed = async (input, actor = owner) => {
    const result = await send(input, actor);
    assert.ok(result.loanWork, result.error);
    return result.loanWork.serviceOrders.find(({ id }) => id === orderId);
  };
  assert.equal((await changed(create)).status, "Ordered");
  assert.equal((await changed(create)).revision, 0);
  assert.match((await send({ ...create, orderId: randomUUID() })).error, /already exists/);
  const mine = () => readOfficerQueue(db, { horizon: 1 }, owner, brokerageId, now).items.find(({ id }) => id === orderId);
  assert.equal(mine().target, serviceOrderTarget(orderId));
  assert.equal(mine().overdue, true);
  assert.equal(queue("Overdue").serviceOrders.rows[0].owner, "Owner");
  assert.equal(queue("Overdue", processor).serviceOrders.rows.length, 0);
  db.prepare(`INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision)
    VALUES (?, ?, ?, 'In processing', '', ?, 1)`).run(loanId, processor.email, processor.name, now.toISOString());
  assert.equal(mine(), undefined);
  assert.equal(queue("Overdue", processor).serviceOrders.rows[0].owner, "Processor");
  assert.equal(queue("Overdue", another).serviceOrders.rows.length, 0);
  assert.ok(queue("Open", processor, "other-brokerage").error);
  assert.ok(readEditableLoan(db, loanId, another, brokerageId).error);
  const personalTasks = () => readWorkspaceTasks(db, { type: "list", view: "Overdue", group: "Service orders", scope: "Mine" },
    processor, brokerageId, now).items;
  assert.equal(personalTasks()[0].title, "Follow up on mock appraisal");
  const update = (revision, action, note = "", dueOn) => ({ type: "updateServiceOrder", orderId, revision, action, note, dueOn });
  assert.match((await send(update(0, "Simulate return"), another)).error, /access/);
  const first = await changed(update(0, "Simulate return"), processor);
  assert.equal(first.returns.length, 1);
  assert.equal(first.status, "Received");
  assert.equal((await changed(update(0, "Simulate return"), processor)).returns.length, 1);
  assert.equal(queue("Ready to review", processor).serviceOrders.rows[0].id, orderId);
  assert.equal(personalTasks()[0].title, "Review mock appraisal");
  const originalPdf = serviceOrderPdf(first.kind, first.returns[0]);
  assert.ok(originalPdf.startsWith("%PDF-1.4"));
  assert.ok(originalPdf.includes(Buffer.from(first.returns[0].reference).toString("hex")));
  assert.match((await send(update(1, "Request replacement"), processor)).error, /internal reason/);
  const replacement = await changed(update(1, "Request replacement", "Use the revised sample report"), processor);
  assert.equal(replacement.status, "Ordered");
  assert.equal(replacement.returns[0].review.decision, "Replacement requested");
  assert.equal(queue("Ready to review", processor).serviceOrders.rows.length, 0);
  await changed(update(2, "Simulate return"), processor);
  assert.match((await send(update(1, "Accept"), processor)).error, /changed/);
  const completed = await changed(update(3, "Accept", "Reviewed the revised sample"), processor);
  assert.equal(completed.status, "Completed");
  assert.equal(completed.returns[1].review.decision, "Accepted");
  assert.equal(completed.returns[1].review.actor, processor.name);
  assert.equal(serviceOrderPdf(completed.kind, completed.returns[0]), originalPdf);
  assert.equal(queue("Open", processor).serviceOrders.rows.length, 0);
  assert.deepEqual(personalTasks(), []);
  assert.ok(db.prepare("SELECT 1 FROM activity WHERE loanId = ? AND text LIKE '%Reviewed the revised sample%'").get(loanId));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("mock title orders support deadlines, cancellation, scoped pagination and demo access", async (t) => {
  const { db, admin, owner, loanId, loan, today, overdue, send, queue } = fixture(t);
  const orderId = randomUUID();
  const create = { type: "createServiceOrder", orderId, kind: "Title", dueOn: today, note: "" };
  assert.match((await send(create, { ...owner, brokerage: { ...owner.brokerage, pilot: false } })).error, /fictional workspaces/);
  assert.ok((await send(create)).loanWork);
  const changed = await send({ type: "updateServiceOrder", action: "Reschedule", orderId, revision: 0, dueOn: overdue, note: "" });
  assert.equal(changed.loanWork.serviceOrders[0].dueOn, overdue);
  assert.equal(queue("Overdue").serviceOrders.rows.length, 1);
  const cancelled = await send({ type: "updateServiceOrder", action: "Cancel", orderId, revision: 1, note: "Fictional order withdrawn" });
  assert.equal(cancelled.loanWork.serviceOrders[0].cancellation, "Fictional order withdrawn");
  assert.equal(queue("Open").serviceOrders.rows.length, 0);
  for (let index = 0; index < 21; index++) {
    const id = index === 0 ? loanId : loan(`Fictional Applicant ${index}`);
    const result = await send({ ...create, orderId: randomUUID() }, owner, id);
    assert.ok(result.loanWork, result.error);
  }
  const first = queue("Open").serviceOrders;
  const second = queue("Open", admin, admin.brokerage.id, first.next).serviceOrders;
  assert.equal(first.rows.length, 20);
  assert.equal(second.rows.length, 1);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.rows, ...second.rows].map(({ id }) => id)).size, 21);
  db.prepare("UPDATE loans SET disposition = 'On hold' WHERE id = ?").run(loanId);
  assert.ok(!queue("Open").serviceOrders.rows.some((item) => item.loanId === loanId));
});

test("existing two-service workspaces retain accepted evidence when the order catalog expands", async (t) => {
  const { db, loanId, today, now, send, queue } = fixture(t);
  const titleId = randomUUID(), previousReference = "MOCK-TITLE-LEGACY-V1";
  const at = now.toISOString();
  const returns = [{ reference: previousReference, returnedAt: at, receivedBy: "Prior processor",
    review: { at, actor: "Prior processor", decision: "Accepted", note: "Accepted before catalog change" } }];
  db.exec(`DROP TABLE closing_service_evidence;
    DROP TABLE service_orders;
    CREATE TABLE service_orders (
      id TEXT PRIMARY KEY, loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('Appraisal', 'Title')),
      status TEXT NOT NULL DEFAULT 'Ordered' CHECK(status IN ('Ordered', 'Received', 'Completed', 'Cancelled')),
      dueOn TEXT NOT NULL, originalDueOn TEXT NOT NULL, createdAt TEXT NOT NULL, createdBy TEXT NOT NULL, note TEXT NOT NULL,
      returns TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 0, cancellation TEXT, lastCommand TEXT
    );`);
  db.prepare(`INSERT INTO service_orders (id, loanId, kind, status, dueOn, originalDueOn, createdAt, createdBy, note, returns, revision)
    VALUES (?, ?, 'Title', 'Completed', ?, ?, ?, 'Prior processor', '', ?, 2)`).run(titleId, loanId, today, today, at, JSON.stringify(returns));
  initializeStore(db, false);
  for (const kind of ["Homeowners insurance", "Flood", "Mortgage insurance"]) {
    const orderId = randomUUID();
    const created = await send({ type: "createServiceOrder", orderId, kind, dueOn: today, note: "" });
    assert.ok(created.loanWork, created.error);
    assert.deepEqual(created.loanWork.serviceOrders.find(({ id }) => id === titleId).returns, returns);
    const result = await send({ type: "updateServiceOrder", orderId, action: "Simulate return", revision: 0, note: "" });
    const sample = result.loanWork.serviceOrders.find(({ id }) => id === orderId).returns[0];
    assert.match(sample.reference, /^MOCK-[A-Z-]+-[A-F0-9-]+-V1$/);
    assert.ok(serviceOrderPdf(kind, sample).includes(Buffer.from(sample.reference).toString("hex")));
  }
  initializeStore(db, false);
  assert.equal(queue("Ready to review").serviceOrders.rows.length, 3);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

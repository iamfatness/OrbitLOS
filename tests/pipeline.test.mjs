import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan, insertSubmission, readWorkspace } = await import("../src/lib/store.ts");
const { readPipeline } = await import("../src/lib/pipeline.ts");
const { emptyPipelineFilters } = await import("../src/lib/pipeline-model.ts");
const { loanNextAction, matchesWorkFilter, pausedLoan } = await import("../src/lib/loan-workflow.ts");
const { scopeWorkspace } = await import("../src/lib/workspace-access.ts");
const { prospectingBlocked } = await import("../src/lib/model.ts");
const { optOutContact } = await import("../src/lib/outreach-preferences.ts");

test("paged Pipeline preserves scoped metrics, matching loans, and next-action rules", (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const identity = (role) => ({ name: role, email: `${role.toLowerCase()}@example.test`,
    brokerage: { id: "fictional-pipeline", name: "Fictional pipeline", role, pilot: true } });
  const admin = identity("Admin");
  const officer = identity("LO");
  const processor = identity("Processor");
  const stageSince = "2026-10-25T15:00:00.000Z";
  const now = Date.parse("2026-11-09T15:00:00.000Z");
  for (let i = 0; i < 36; i++) {
    const id = `loan-${String(i).padStart(2, "0")}`;
    const contactId = `contact-${i}`;
    insertContact(db, { id: contactId, name: i === 34 ? "ÉSME Example" : `Fictional borrower ${i}`,
      email: `private-${i}@example.test`, phone: "", role: "Borrower" });
    const owner = i === 35 ? admin : officer;
    insertLoan(db, { id, contactId, partnerId: null, officer: owner.name, officerEmail: owner.email,
      address: "Fictional property", amount: 100_000 + i, purpose: "Purchase", stage: "Lead", stageSince });
  }
  insertSubmission(db, { id: "uwm-34", loanId: "loan-34", lender: "UWM", externalId: "DEMO_%34", status: "Open",
    syncedAt: stageSince, conditions: [{ id: "income", category: "Income", description: "Private detail", group: null, uploaded: false, satisfiedAt: null }] });
  insertSubmission(db, { id: "manual-35", loanId: "loan-35", lender: "Manual lender", externalId: "MANUAL", status: "Open", syncedAt: null,
    conditions: [{ id: "id", category: "Identity", description: "Private detail", group: null, uploaded: false, satisfiedAt: null }] });
  db.prepare("UPDATE loans SET disposition = 'On hold', revisitDate = '2026-11-01' WHERE id = 'loan-33'").run();
  db.prepare("INSERT INTO loan_processing VALUES ('loan-34', ?, ?, 'In processing', '', ?, 1)").run(processor.email, processor.name, stageSince);
  optOutContact(db, "contact-32", stageSince);
  const task = db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, purpose) VALUES (?, ?, 'Fictional task', ?, ?)");
  task.run("older-service", "loan-34", stageSince, "Loan service");
  task.run("suppressed-prospecting", "loan-32", stageSince, "Prospecting");
  const initial = { view: "List", search: "", filters: emptyPipelineFilters };
  const read = (query, staff = officer) => readPipeline(db, query, staff, now);
  const legacy = scopeWorkspace(readWorkspace(db), officer);
  const first = read(initial);
  assert.equal(first.metrics.total, 35);
  assert.equal(first.metrics.active, 34);
  assert.equal(first.metrics.openConditions, 1);
  assert.equal(first.list.loans.length, 30);
  const next = read({ ...initial, after: first.list.next });
  assert.deepEqual([...first.list.loans, ...next.list.loans].map(({ id }) => id), legacy.loans.map(({ id }) => id));
  assert.equal(next.list.next, null);
  for (const row of [...first.list.loans, ...next.list.loans]) {
    assert.deepEqual(row.action, loanNextAction(legacy.loans.find(({ id }) => id === row.id), legacy, "LO"));
  }
  assert.equal(read(initial, admin).metrics.openConditions, 2);
  assert.deepEqual(read(initial, processor).list.loans.map(({ id }) => id), ["loan-34"]);
  assert.equal(read({ ...initial, search: "ésme" }).matches, 1);
  assert.equal(read({ ...initial, search: "demo_%34" }).matches, 1);
  assert.equal(read({ ...initial, search: "%" }).matches, 1);
  const overdue = read({ ...initial, filters: { ...emptyPipelineFilters, work: "Overdue" } });
  const expected = legacy.loans.filter((loan) => matchesWorkFilter(loan, loanNextAction(loan, legacy, "LO").dueAt, "Overdue", now, true) ||
    (!pausedLoan(loan) && legacy.tasks.some((entry) => entry.loanId === loan.id && !entry.completedAt &&
      !prospectingBlocked(entry.purpose, legacy.contacts.find(({ id }) => id === loan.contactId)?.outreachSuppressed) && Date.parse(entry.dueAt) < now)));
  assert.deepEqual(overdue.list.loans.map(({ id }) => id), expected.map(({ id }) => id));
  assert.deepEqual(expected.map(({ id }) => id), ["loan-33", "loan-34"]);
  assert.doesNotMatch(JSON.stringify(overdue), /private-34@|Private detail/);
  const board = read({ ...initial, view: "Board" });
  const lead = board.lanes.find(({ stage }) => stage === "Lead");
  assert.equal(lead.count, 35);
  assert.equal(lead.loans.length, 12);
  const more = read({ ...initial, view: "Board", lane: "Lead", after: lead.next });
  assert.equal(more.lanes.length, 1);
  assert.equal(more.lanes[0].volume, lead.volume);
  assert.deepEqual(more.lanes[0].loans.map(({ id }) => id), legacy.loans.slice(12, 24).map(({ id }) => id));
});

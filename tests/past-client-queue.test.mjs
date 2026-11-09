import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { readPastClientQueue } = await import("../src/lib/past-client-queue.ts");
const { readEditableLoan } = await import("../src/lib/editable-loan.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { fundingTaskId } = await import("../src/lib/playbook-model.ts");

const brokerage = { id: "fictional", pilot: true };
const staff = (name, role) => ({ name, email: `${name.toLowerCase()}@example.test`, brokerage: { ...brokerage, role } });
const officer = staff("Officer", "LO");
const other = staff("Other", "LO");
const admin = staff("Admin", "Admin");
const processor = staff("Processor", "Processor");
const at = "2026-02-28T17:00:00.000Z";
const date = at.slice(0, 10);

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  function loan(id, { owner = officer, name = id, stage = "Funded", date: closingDate, watch, funded = false } = {}) {
    insertContact(db, { id: `${id}-borrower`, name, role: "Borrower", email: "", phone: "" });
    insertLoan(db, { id, contactId: `${id}-borrower`, partnerId: null, officer: owner.name, officerEmail: owner.email,
      stage, stageSince: at, address: "", amount: 250000, purpose: "Purchase" });
    if (closingDate || watch) db.prepare(`INSERT INTO past_client_profiles
      (loanId, closingDate, watchEnabled, targetRate, observedRate, note) VALUES (?, ?, ?, ?, ?, 'Private follow-up note')`)
      .run(id, closingDate ?? null, Number(Boolean(watch)), watch ? 6 : null, watch?.observed ?? null);
    if (funded) {
      db.prepare("INSERT INTO closing_progress (loanId, fundingDate) VALUES (?, ?)").run(id, date);
      db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, 'Fictional check-in', ?)").run(fundingTaskId(id, "borrower"), id, at);
    }
    return id;
  }
  const read = (actor, view = "All clients", query = "", after, today = date) => readPastClientQueue(db, { view, query, after }, actor, today);
  const write = (actor, input) => executeCommand(db, input, actor, undefined, [], { scopedLoanUpdates: true });
  return { db, loan, read, write };
}

test("past clients page and search only permitted funded and closed files, with stable anniversary and target order", (t) => {
  const { db, loan, read } = fixture(t);
  for (let i = 0; i < 22; i++) loan(`client-${String(i).padStart(2, "0")}`, { date: "2024-02-29", watch: { observed: 6.5 } });
  loan("client-22", { name: "ÉLODIE", stage: "Closed", date: "2025-03-01", watch: { observed: 6 } });
  loan("other-client", { owner: other, name: "Élodie Other" });
  loan("outside-stage", { stage: "Lead", date: "2024-02-29", watch: { observed: 5 } });
  db.prepare("INSERT INTO loan_processing VALUES (?, ?, ?, 'Assigned', '', ?, 1)").run("client-22", processor.email, processor.name, at);

  const first = read(officer, "Anniversaries");
  assert.deepEqual(first.totals, { clients: 23, withDate: 23, watched: 23, reached: 1 });
  assert.equal(first.rows.length, 20);
  assert.equal(first.rows[0].anniversary, "2026-02-28");
  assert.equal(first.rows.at(-1).id, "client-19");
  const rest = read(officer, "Anniversaries", "", first.next);
  assert.deepEqual(rest.rows.map(({ id }) => id), ["client-20", "client-21", "client-22"]);
  assert.equal(rest.next, null);
  assert.equal(rest.totals, undefined);
  assert.equal(read(officer, "Anniversaries", "", undefined, "2026-03-01").rows[0].id, "client-22");
  assert.equal(read(officer, "Rate watchlist").rows[0].id, "client-22");
  assert.equal(read(officer, "Rate watchlist").rows[0].reached, true);
  assert.deepEqual(read(officer, "All clients", " élodie ").rows.map(({ id }) => id), ["client-22"]);
  assert.deepEqual(read(admin, "All clients", "Élodie").rows.map(({ id }) => id), ["client-22", "other-client"]);
  assert.equal(read(processor).totals.clients, 1);
  assert.equal(read(other).totals.clients, 1);
  assert.doesNotMatch(JSON.stringify(first), /Private follow-up note|outside-stage|other-client/);
});

test("retention saves return the authorized loan with its follow-up, and repeat creation is safe to replay", async (t) => {
  const { db, loan, read, write } = fixture(t);
  const id = loan("source", { funded: true });
  const stale = loan("stale", { funded: true });
  db.prepare("UPDATE tasks SET completedAt = ? WHERE loanId = ?").run(at, stale);
  assert.equal(read(officer, "All clients", "stale").rows[0].repeat, "unavailable");
  assert.equal(read(officer, "All clients", "source").rows[0].repeat, "start");
  const save = { type: "saveRetention", loanId: id, revision: 0, closingDate: date, currentRate: "7", targetRate: "6",
    observedRate: "5.75", watchEnabled: true, note: "Fictional rate observation" };
  assert.ok((await write(other, save)).error);
  const saved = await write(officer, save);
  assert.equal(saved.state, undefined);
  assert.equal(saved.loanWork.pastClients[0].revision, 1);
  assert.ok(saved.loanWork.tasks.some((task) => task.id === `rate-watch:${id}` && !task.completedAt));
  assert.ok((await write(officer, save)).error);
  assert.equal(read(officer, "Rate watchlist").rows[0].reached, true);

  const start = { type: "startReturningClient1003", loanId: id, purpose: "Refinance" };
  const created = await write(officer, start);
  assert.equal(created.state, undefined);
  assert.notEqual(created.applicationLoanId, id);
  assert.equal(created.loanWork.loans[0].id, created.applicationLoanId);
  assert.ok(created.loanWork.applications[0].token);
  assert.equal((await write(officer, { ...start, purpose: "Purchase" })).applicationLoanId, created.applicationLoanId);
  assert.equal(read(officer, "All clients", "source").rows[0].repeat, "open");
  db.prepare("UPDATE loans SET officerEmail = ? WHERE id = ?").run(other.email, created.applicationLoanId);
  const restricted = read(officer, "All clients", "source");
  assert.equal(restricted.rows[0].repeat, "restricted");
  assert.equal(JSON.stringify(restricted).includes(created.applicationLoanId), false);
  const exact = readEditableLoan(db, id, officer, brokerage.id);
  assert.deepEqual(exact.repeatOption, { kind: "restricted" });
  assert.deepEqual(exact.returningClientLoans, []);
  assert.ok((await write(officer, start)).error);
  assert.equal(read(admin, "All clients", "source").rows[0].repeat, "open");
  db.prepare("UPDATE closing_progress SET fundingDate = NULL WHERE loanId = ?").run(id);
  assert.equal(read(admin, "All clients", "source").rows[0].repeat, "unavailable");
  assert.ok((await write(admin, start)).error);
});

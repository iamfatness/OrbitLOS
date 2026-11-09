import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { blankApplication } = await import("../src/lib/application-model.ts");
const { borrowerCommandResult } = await import("../src/lib/applications.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { playbookRunWork } = await import("../src/lib/playbook-runs.ts");
const { runScheduledDocumentReminders } = await import("../src/lib/document-reminder-runs.ts");

const beforeMidnight = new Date("2026-11-09T04:50:00.000Z");
const afterMidnight = new Date("2026-11-09T05:05:00.000Z");
const at = beforeMidnight.toISOString();

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const brokerage = { id: crypto.randomUUID(), name: "Reminder rehearsal", role: "Admin", pilot: true };
  const admin = { name: "Fictional admin", email: "admin@example.test", brokerage };
  const work = (input, now = afterMidnight, staff = admin, id = brokerage.id, canSchedule = false) => playbookRunWork(db, input, staff, id, now, canSchedule);
  const check = (simulate = false) => ({ type: "checkDocuments", operationId: crypto.randomUUID(), simulate });
  const list = (filter = "All runs", after) => work({ type: "list", filter, automation: "Document reminders", after });
  function addLoan(dueOn, { expiresAt = "2099-01-01T00:00:00.000Z", disposition = "Active", stage = "Processing" } = {}) {
    const loanId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const token = loanId.replaceAll("-", "").repeat(2);
    insertContact(db, { id: loanId, name: "Fictional borrower", email: "borrower@example.test", phone: "", role: "Borrower" });
    insertLoan(db, { id: loanId, contactId: loanId, partnerId: null, officer: admin.name, officerEmail: admin.email, address: "",
      amount: 300000, purpose: "Purchase", stage, stageSince: at });
    db.prepare("UPDATE loans SET disposition = ? WHERE id = ?").run(disposition, loanId);
    db.prepare("INSERT INTO applications (loanId, token, draft, expiresAt, updatedAt, submittedAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(loanId, token, JSON.stringify(blankApplication()), expiresAt, at, at);
    db.prepare("INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, dueOn) VALUES (?, ?, 'Pay stub', '', ?, ?)")
      .run(requestId, loanId, at, dueOn);
    return { loanId, requestId, token };
  }
  const retry = (run) => ({ type: "retry", source: "document", id: run.id, attempt: run.attemptCount, operationId: crypto.randomUUID() });
  return { db, admin, work, check, list, addLoan, retry };
}

test("an interrupted mock reminder resumes once at the original Eastern deadline", (t) => {
  const { db, admin, work, check, list, addLoan, retry } = fixture(t);
  const file = addLoan("2026-11-09");
  assert.equal(work(check(), beforeMidnight).processed, 0);
  const request = check(true);
  db.exec(`CREATE TRIGGER fixture_interrupt BEFORE INSERT ON document_reminder_attempts BEGIN SELECT RAISE(ABORT, 'fixture interruption'); END`);
  assert.throws(() => work(request), /fixture interruption/);
  db.exec("DROP TRIGGER fixture_interrupt");
  assert.deepEqual(list().runs, []);
  const started = work(request);
  assert.equal(started.interrupted, 1);
  assert.deepEqual(work(request), started);
  assert.ok(work({ ...request, simulate: false }).error);
  const [failed] = list("Failed").runs;
  assert.equal(failed.requestId, file.requestId);
  assert.equal(failed.dueOn, "2026-11-09");
  assert.equal(failed.receipt, null);
  assert.equal(failed.canRetry, true);
  assert.equal(work(check()).processed, 0);

  const input = retry(failed);
  assert.ok(work({ ...input, attempt: 2 }).error);
  assert.ok(work(input, afterMidnight, { ...admin, brokerage: { ...admin.brokerage, role: "LO" } }).error);
  assert.ok(work(input, afterMidnight, admin, crypto.randomUUID()).error);
  assert.ok(work(input, afterMidnight, { ...admin, brokerage: { ...admin.brokerage, pilot: false } }).error);
  const recovered = work(input);
  assert.equal(recovered.status, "Completed");
  assert.deepEqual(work(input), recovered);
  assert.ok(work(retry(failed)).error);
  const [completed] = list("Completed").runs;
  assert.equal(completed.id, failed.id);
  assert.equal(completed.dueOn, failed.dueOn);
  assert.match(completed.receipt, /^MOCK-DOC-/);
  const attempts = work({ type: "attempts", source: "document", id: completed.id }).attempts;
  assert.deepEqual(attempts.map(({ mode, status, actor }) => [mode, status, actor]), [
    ["Retry", "Completed", admin.name], ["Trigger", "Failed", admin.name],
  ]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM document_reminder_runs WHERE receipt IS NOT NULL").get().count, 1);
  assert.equal(db.prepare("SELECT status FROM document_requests WHERE id = ?").get(file.requestId).status, "Requested");
});

test("deadline changes and received documents retire old reminders and blocked links can recover", async (t) => {
  const { db, admin, work, check, list, addLoan, retry } = fixture(t);
  const changed = addLoan("2026-11-08");
  work(check(true));
  const [old] = list("Failed").runs;
  const revision = db.prepare("SELECT revision, deadlineRevision FROM document_requests WHERE id = ?").get(changed.requestId);
  const dueOn = "2026-11-10";
  const updated = await executeCommand(db, { type: "setDocumentDeadline", loanId: changed.loanId, requestId: changed.requestId, dueOn, ...revision }, admin);
  assert.ok(!updated.error, updated.error);
  assert.equal(list("Failed").runs.length, 0);
  assert.equal(list("Superseded").runs[0].id, old.id);
  assert.equal(work(retry(old)).status, "Superseded");
  assert.equal(work(check()).processed, 0);

  const received = addLoan("2026-11-09");
  work(check(true));
  const [waiting] = list("Failed").runs;
  assert.equal(waiting.requestId, received.requestId);
  const sample = borrowerCommandResult(db, { type: "attachSample", statusOnly: true, token: received.token, requestId: received.requestId, revision: 0 });
  assert.equal(sample.statusView.loanStatus.documents[0].status, "Received");
  assert.equal(work(retry(waiting)).status, "Superseded");
  assert.equal(work(check()).processed, 0);

  const newDeadline = new Date("2026-11-10T05:00:00.000Z");
  assert.equal(work(check(true), newDeadline).interrupted, 1);
  const [current] = work({ type: "list", filter: "Failed", automation: "Document reminders" }, newDeadline).runs;
  assert.equal(current.dueOn, dueOn);
  db.prepare("UPDATE applications SET revokedAt = ? WHERE loanId = ?").run(at, changed.loanId);
  assert.match(work(retry(current), newDeadline).error, /active link/);
  db.prepare("UPDATE applications SET revokedAt = NULL WHERE loanId = ?").run(changed.loanId);
  db.prepare("UPDATE loans SET disposition = 'On hold' WHERE id = ?").run(changed.loanId);
  assert.match(work(retry(current), newDeadline).error, /Resume the loan/);
  db.prepare("UPDATE loans SET disposition = 'Active' WHERE id = ?").run(changed.loanId);
  assert.equal(work(retry(current), newDeadline).status, "Completed");
  assert.equal(db.prepare("SELECT count(*) AS count FROM document_reminder_runs WHERE receipt IS NOT NULL").get().count, 1);
});

test("due checks page a backlog and skip undated, expired, and inactive work", (t) => {
  const { work, check, list, addLoan } = fixture(t);
  for (let i = 0; i < 21; i++) addLoan("2026-11-08");
  addLoan(null);
  addLoan("2026-11-08", { expiresAt: at });
  addLoan("2026-11-08", { disposition: "On hold" });
  addLoan("2026-11-08", { stage: "Funded" });
  const input = check();
  const first = work(input);
  assert.equal(first.processed, 20);
  assert.equal(first.more, true);
  assert.deepEqual(work(input), first);
  assert.equal(work(check()).processed, 1);
  assert.equal(work(check()).processed, 0);
  const page = list("Completed");
  const last = list("Completed", page.next);
  assert.equal(page.runs.length, 20);
  assert.equal(last.runs.length, 1);
  assert.ok(page.runs.every(({ id }) => id !== last.runs[0].id));
});

test("a reviewed recovery batch rechecks each selected reminder and replays its original results", (t) => {
  const { db, admin, work, check, list, addLoan, retry } = fixture(t);
  const interrupted = () => {
    const file = addLoan("2026-11-09");
    assert.equal(work(check(true)).interrupted, 1);
    return { ...file, run: list("Failed").runs.find(({ requestId }) => requestId === file.requestId) };
  };
  const ready = interrupted();
  const received = interrupted();
  const completed = interrupted();
  const expired = interrupted();
  const held = interrupted();
  db.prepare("UPDATE loans SET disposition = 'On hold' WHERE id = ?").run(held.loanId);
  const previewInput = { type: "previewDocumentRecovery" };
  const preview = work(previewInput);
  assert.deepEqual(preview.ready.map(({ id }) => id).sort(), [ready, received, completed, expired].map(({ run }) => run.id).sort());
  assert.deepEqual(preview.blocked.map(({ id }) => id), [held.run.id]);
  assert.match(preview.blocked[0].blockedReason, /Resume the loan/);
  assert.equal(db.prepare("SELECT count(*) AS count FROM document_reminder_recoveries").get().count, 0);

  assert.equal(borrowerCommandResult(db, { type: "attachSample", statusOnly: true, token: received.token,
    requestId: received.requestId, revision: 0 }).statusView.loanStatus.documents[0].status, "Received");
  assert.equal(work(retry(completed.run)).status, "Completed");
  db.prepare("UPDATE applications SET expiresAt = ? WHERE loanId = ?").run(at, expired.loanId);
  const input = { type: "recoverDocuments", operationId: crypto.randomUUID(), items: preview.ready.map(({ id, attempt }) => ({ id, attempt })) };
  const officer = { ...admin, brokerage: { ...admin.brokerage, role: "LO" } };
  assert.ok(work(previewInput, afterMidnight, officer).error);
  assert.ok(work(input, afterMidnight, officer).error);
  assert.ok(work(input, afterMidnight, admin, crypto.randomUUID()).error);
  assert.ok(work({ ...input, items: [...input.items, input.items[0]] }).error);
  const recovered = work(input);
  assert.equal(recovered.recovered, 1);
  assert.equal(recovered.skipped, 3);
  const rows = Object.fromEntries(recovered.rows.map((row) => [row.id, row]));
  assert.equal(rows[ready.run.id].status, "Recovered");
  assert.match(rows[received.run.id].reason, /no longer current/);
  assert.match(rows[completed.run.id].reason, /already has a mock receipt/);
  assert.match(rows[expired.run.id].reason, /active link/);
  assert.ok(!rows[held.run.id]);
  assert.deepEqual(work(input), recovered);
  assert.ok(work({ ...input, items: input.items.slice(0, 1) }).error);
  assert.ok(work(input, afterMidnight, { ...admin, email: "other-admin@example.test" }).error);
  assert.equal(db.prepare("SELECT count(*) AS count FROM document_reminder_runs WHERE receipt IS NOT NULL").get().count, 2);
  assert.equal(work({ type: "attempts", source: "document", id: ready.run.id }).attempts.length, 2);
});

test("bulk recovery is bounded and a database interruption rolls back the whole batch", (t) => {
  const { db, work, check, addLoan } = fixture(t);
  for (let i = 0; i < 21; i++) {
    addLoan("2026-11-09");
    assert.equal(work(check(true)).interrupted, 1);
  }
  const preview = () => work({ type: "previewDocumentRecovery" });
  const first = preview();
  assert.equal(first.ready.length, 20);
  assert.equal(first.moreReady, true);
  const items = first.ready.map(({ id, attempt }) => ({ id, attempt }));
  const commit = { type: "recoverDocuments", operationId: crypto.randomUUID(), items };
  assert.ok(work({ ...commit, items: [...items, { id: crypto.randomUUID(), attempt: 1 }] }).error);
  db.exec(`CREATE TRIGGER fixture_bulk_interrupt BEFORE INSERT ON document_reminder_attempts
    WHEN NEW.mode = 'Retry' AND NEW.runId = '${items[1].id}' BEGIN SELECT RAISE(ABORT, 'batch interruption'); END`);
  assert.throws(() => work(commit), /batch interruption/);
  db.exec("DROP TRIGGER fixture_bulk_interrupt");
  assert.equal(db.prepare("SELECT count(*) AS count FROM document_reminder_runs WHERE receipt IS NOT NULL").get().count, 0);
  assert.equal(work(commit).recovered, 20);
  const last = preview();
  assert.equal(last.ready.length, 1);
  assert.equal(last.moreReady, false);
});

const playbookFields = { quietHours: 48, reviewHours: 24, handoffHours: 24, fundingDays: 7, backupEmail: null };

test("timing changes apply to new reminder runs while recovery keeps the captured Eastern date", async (t) => {
  const { db, admin, work, check, list, addLoan } = fixture(t);
  const save = (revision, documentReminderOffsetDays, staff = admin) => executeCommand(db,
    { type: "savePlaybook", ...playbookFields, revision, ...(documentReminderOffsetDays === undefined ? {} : { documentReminderOffsetDays }) }, staff);
  const loan = addLoan("2026-11-11");
  assert.ok((await save(0, 15)).error);
  assert.ok((await save(0, -2, { ...admin, brokerage: { ...admin.brokerage, role: "LO" } })).error);
  assert.equal((await save(0, -2)).state.playbook.documentReminderOffsetDays, -2);
  assert.equal(work(check(), beforeMidnight).processed, 0);
  const interrupted = check(true);
  assert.equal(work(interrupted).interrupted, 1);
  const [early] = list("Failed").runs;
  assert.equal(early.dueOn, "2026-11-11");
  assert.equal(early.eligibleOn, "2026-11-09");
  assert.equal(early.timingOffsetDays, -2);

  assert.match((await save(0, 2)).error, /playbook changed/i);
  assert.equal((await save(1, 2)).state.playbook.documentReminderOffsetDays, 2);
  assert.equal((await save(2)).state.playbook.documentReminderOffsetDays, 2, "older playbook saves preserve the timing rule");
  const later = addLoan("2026-11-09");
  assert.equal(work(check()).processed, 0);
  assert.equal(work(interrupted).interrupted, 1, "the earlier check replays its original result");
  const preview = work({ type: "previewDocumentRecovery" });
  assert.deepEqual(preview.ready.map(({ id, eligibleOn }) => ({ id, eligibleOn })), [{ id: early.id, eligibleOn: "2026-11-09" }]);
  const recovery = work({ type: "recoverDocuments", operationId: crypto.randomUUID(), items: [{ id: early.id, attempt: early.attemptCount }] });
  assert.equal(recovery.recovered, 1);
  assert.equal(db.prepare("SELECT dueOn FROM document_requests WHERE id = ?").get(loan.requestId).dueOn, "2026-11-11");

  assert.equal(work(check(), new Date("2026-11-11T04:59:00.000Z")).processed, 0);
  const after = new Date("2026-11-11T05:00:00.000Z");
  assert.equal(work(check(), after).processed, 1);
  const history = work({ type: "list", filter: "Completed", automation: "Document reminders" }, after).runs;
  const late = history.find(({ requestId }) => requestId === later.requestId);
  assert.equal(late.dueOn, "2026-11-09");
  assert.equal(late.eligibleOn, "2026-11-11");
  assert.equal(late.timingOffsetDays, 2);
});

test("older playbook settings and reminder rows keep due-date timing through schema initialization", (t) => {
  const { db, work, check, list, addLoan } = fixture(t);
  db.prepare("INSERT INTO settings (key, value) VALUES ('brokeragePlaybook', ?)").run(JSON.stringify({ ...playbookFields, revision: 3 }));
  addLoan("2026-11-09");
  assert.equal(work(check(true)).interrupted, 1);
  db.exec("ALTER TABLE document_reminder_runs DROP COLUMN eligibleOn; ALTER TABLE document_reminder_runs DROP COLUMN timingOffsetDays;");
  initializeStore(db, false);
  const [legacy] = list("Failed").runs;
  assert.equal(legacy.eligibleOn, legacy.dueOn);
  assert.equal(legacy.timingOffsetDays, 0);
  assert.equal(work({ type: "previewDocumentRecovery" }).ready[0].eligibleOn, "2026-11-09");
});

test("only a hosted demo or pilot admin can opt in, and pausing preserves manual recovery", (t) => {
  const { db, admin, work, check, list, addLoan, retry } = fixture(t);
  const schedule = { type: "documentSchedule" };
  const enable = { type: "setDocumentSchedule", enabled: true, revision: 0 };
  const hosted = (input, staff = admin, id = admin.brokerage.id) => work(input, afterMidnight, staff, id, true);
  addLoan("2026-11-09");
  runScheduledDocumentReminders(db, afterMidnight);
  assert.equal(list().runs.length, 0);
  assert.equal(hosted(schedule).enabled, false);
  assert.equal(work(schedule).available, false);
  assert.ok(work(enable).error);
  assert.ok(hosted(enable, { ...admin, brokerage: { ...admin.brokerage, role: "LO" } }).error);
  assert.ok(hosted(enable, admin, crypto.randomUUID()).error);
  const standard = { ...admin, brokerage: { ...admin.brokerage, pilot: false } };
  assert.equal(hosted(schedule, standard).available, false);
  assert.ok(hosted(enable, standard).error);

  const enabled = hosted(enable);
  assert.equal(enabled.nextAt, "2026-11-09T05:05:05.000Z");
  assert.deepEqual(hosted(enable), enabled);
  assert.match(hosted({ ...enable, enabled: false }).error, /changed/);
  assert.equal(hosted({ ...enable, enabled: false, revision: enabled.revision }).nextAt, null);
  assert.ok(hosted(enable).error);
  runScheduledDocumentReminders(db, new Date(enabled.nextAt));
  assert.equal(list().runs.length, 0);
  assert.equal(work(check(true)).interrupted, 1);
  assert.equal(work(retry(list("Failed").runs[0])).status, "Completed");
  assert.deepEqual(db.prepare("SELECT action FROM workspace_access_history ORDER BY rowid").all().map(({ action }) => action),
    ["Enabled scheduled mock reminders", "Paused scheduled mock reminders"]);
});

test("missed scheduled checks catch up in bounded batches and commit receipts with the next Eastern wake", (t) => {
  const { db, admin, work, addLoan, check } = fixture(t);
  const hosted = (input, now) => work(input, now, admin, admin.brokerage.id, true);
  const schedule = { type: "documentSchedule" };
  const enable = { type: "setDocumentSchedule", enabled: true, revision: 0 };
  const start = new Date("2027-11-05T17:00:00.000Z");
  const late = new Date("2027-11-07T04:30:00.000Z");
  for (let index = 0; index < 21; index++) addLoan("2027-11-07");
  const enabled = hosted(enable, start);
  const receiptCount = () => db.prepare("SELECT count(*) AS count FROM document_reminder_runs WHERE receipt IS NOT NULL").get().count;
  runScheduledDocumentReminders(db, start);
  assert.equal(receiptCount(), 0);
  db.exec("CREATE TRIGGER fixture_schedule_failure BEFORE UPDATE ON document_reminder_schedule BEGIN SELECT RAISE(ABORT, 'schedule interruption'); END");
  assert.throws(() => runScheduledDocumentReminders(db, late), /schedule interruption/);
  db.exec("DROP TRIGGER fixture_schedule_failure");
  assert.equal(receiptCount(), 0);
  assert.deepEqual(hosted(schedule, late), enabled);

  runScheduledDocumentReminders(db, late);
  const first = hosted(schedule, late);
  assert.equal(first.lastProcessed, 20);
  assert.equal(first.lastCheckedAt, late.toISOString());
  assert.equal(first.nextAt, "2027-11-07T04:31:00.000Z");
  runScheduledDocumentReminders(db, late);
  assert.equal(receiptCount(), 20);
  const continuation = new Date(first.nextAt);
  runScheduledDocumentReminders(db, continuation);
  assert.equal(receiptCount(), 21);
  assert.equal(work(check(), continuation).processed, 0);
  assert.deepEqual(hosted(schedule, continuation), { ...first, lastProcessed: 1,
    lastCheckedAt: continuation.toISOString(), nextAt: "2027-11-08T05:00:00.000Z" });
  assert.equal(db.prepare("SELECT DISTINCT actor FROM document_reminder_attempts").get().actor, "Scheduled mock check");
});

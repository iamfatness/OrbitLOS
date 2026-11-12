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
const { initializeStore } = await import("../src/lib/store.ts");
const { automationDestinationWork } = await import("../src/lib/automation-destinations.ts");
const { automationEventWork, queueAutomationEvent } = await import("../src/lib/automation-events.ts");
const { automationBatchWork } = await import("../src/lib/automation-batches.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    exec: sql => sqlite.exec(sql), prepare: sql => sqlite.prepare(sql),
    transaction(run) {
      sqlite.exec("BEGIN");
      try { const result = run(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  initializeStore(db, false);
  const admin = { email: "owner@example.test", name: "Fictional Owner",
    brokerage: { id: crypto.randomUUID(), role: "Admin", pilot: true } };
  const destinationId = crypto.randomUUID();
  const first = "2026-10-01T12:00:00.123Z";
  const eventTypes = ["lead.created"];
  const name = "Fictional delivery destination";
  const addDestination = retryDelayMinutes => automationDestinationWork(db, admin, {
    type: "createDestination", id: destinationId, name, eventTypes, ...(retryDelayMinutes !== undefined ? { retryDelayMinutes } : {}),
  }, first);
  const addEvent = (at = first) => {
    const id = crypto.randomUUID();
    queueAutomationEvent(db, { eventType: "lead.created", kind: "lead", id, revision: 1, origin: "Direct entry" }, at);
    return db.prepare("SELECT id FROM automation_events WHERE resourceId = ?").get(id).id;
  };
  const change = (action, revision, at = first) => automationDestinationWork(db, admin,
    { id: destinationId, operationId: crypto.randomUUID(), revision, ...action }, at);
  const read = (action, at = first) => automationEventWork(db, admin, { ...action, destinationId }, at);
  const attempt = (id, count, fail, at = first, destinationRevision = 1, operationId = crypto.randomUUID()) => read(
    { type: "attempt", id, attempt: count, operationId, simulateFailure: fail, destinationRevision }, at);
  const batch = (action, at = first) => automationBatchWork(db, admin, { status: "Failed", destinationId, ...action }, at);
  return { destinationId, first, eventTypes, name, addDestination, addEvent, change, read, attempt, batch };
}

test("captured retry delay applies to individual and batch attempts at the exact due time", t => {
  const f = fixture(t);
  assert.equal(f.addDestination(5).destination.retryDelayMinutes, 5);
  const id = f.addEvent();
  assert.equal(f.change({ type: "editDestination", name: f.name, eventTypes: f.eventTypes, retryDelayMinutes: 0 }, 1).destination.retryDelayMinutes, undefined);
  const immediate = f.addEvent();
  assert.equal(f.attempt(immediate, 0, true, f.first, 2).event.retryAt, undefined);
  const failed = f.attempt(id, 0, true, f.first, 2);
  assert.equal(failed.subscription.retryDelayMinutes, 5);
  assert.equal(failed.event.retryAt, "2026-10-01T12:05:00.123Z");
  const early = "2026-10-01T12:05:00.122Z";
  assert.match(f.attempt(id, 1, false, early, 2).error, /scheduled/);
  const before = f.batch({ type: "preview" }, early);
  assert.deepEqual(before.items.map(item => item.eventId), [immediate]);
  const ready = f.batch({ type: "preview" }, failed.event.retryAt);
  assert.deepEqual(ready.items.map(item => item.eventId), [id, immediate]);
  assert.match(f.batch({ type: "run", batchId: crypto.randomUUID(), fingerprint: before.fingerprint }, failed.event.retryAt).error, /queue changed/);
  assert.equal(f.change({ type: "setDestinationState", state: "Paused" }, 2).destination.state, "Paused");
  assert.match(f.batch({ type: "preview" }, failed.event.retryAt).error, /Resume/);
  assert.match(f.attempt(id, 1, false, failed.event.retryAt, 3).error, /Resume/);
  assert.equal(f.change({ type: "setDestinationState", state: "Active" }, 3).destination.state, "Active");
  const operationId = crypto.randomUUID();
  const terminal = f.attempt(id, 1, true, failed.event.retryAt, 4, operationId);
  assert.equal(terminal.event.attemptCount, 2);
  assert.deepEqual(f.attempt(id, 1, true, failed.event.retryAt, 4, operationId), terminal);
  assert.match(f.attempt(id, 2, false, failed.event.retryAt, 4).error, /used its retry/);
  assert.deepEqual(f.batch({ type: "preview" }, failed.event.retryAt).items.map(item => item.eventId), [immediate]);
});

test("archived terminal deliveries remain readable with their attempts and pending work stays current", t => {
  const f = fixture(t);
  assert.equal(f.addDestination().destination.retryDelayMinutes, undefined);
  const succeeded = f.addEvent();
  const unresolved = f.addEvent();
  const exhausted = f.addEvent();
  f.attempt(succeeded, 0, false);
  f.attempt(unresolved, 0, true);
  f.attempt(exhausted, 0, true);
  f.attempt(exhausted, 1, true);
  const beforeCutoff = "2026-10-31T12:00:00.122Z";
  const cutoff = "2026-10-31T12:00:00.123Z";
  assert.deepEqual(f.read({ type: "list", history: "archived" }, beforeCutoff).events, []);
  assert.deepEqual(f.read({ type: "list", history: "current" }, cutoff).events.map(e => e.payload.eventId), [unresolved]);
  assert.deepEqual(f.read({ type: "list", history: "archived" }, cutoff).events.map(e => e.payload.eventId), [exhausted, succeeded]);
  const detail = f.read({ type: "detail", id: exhausted }, cutoff);
  assert.equal(detail.event.archived, true);
  assert.deepEqual(detail.attempts.map(a => a.number), [2, 1]);
  assert.equal(f.read({ type: "list" }, cutoff).events.length, 3);
});

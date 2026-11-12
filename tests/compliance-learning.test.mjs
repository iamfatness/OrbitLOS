import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (e) {
    if (e.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw e;
    return next(`${specifier}.ts`, context);
  }
} });
const { initializeComplianceLearning, complianceLearningWork } = await import("../src/lib/compliance-learning.ts");
const { learningRequest } = await import("../src/lib/compliance-learning-model.ts");
const at = "2026-11-11T12:00:00.000Z";
const uuid = () => crypto.randomUUID();
function fixture(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("PRAGMA foreign_keys=ON"); initializeComplianceLearning(db);
  const admin = { email: "admin@example.test", role: "Admin", name: "Owner", status: "Active", accessRevision: 1 };
  const employee = { email: "employee@example.test", role: "LO", name: "Employee", status: "Active", accessRevision: 1 };
  const other = { email: "other@example.test", role: "Processor", name: "Other", status: "Active", accessRevision: 1 };
  const roster = [admin, employee, other], tenant = uuid();
  function work(input, actor = admin, members = roster, brokerageId = tenant) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = complianceLearningWork(db, input, { ...actor, brokerage: { id: brokerageId, role: actor.role, accessRevision: actor.accessRevision } }, members, at);
      db.exec("COMMIT"); return result;
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  const mutate = (operation, fields = {}, actor) => work({ operation, requestId: uuid(), ...fields }, actor);
  function draft(kind = "Policy", extra = {}) {
    return mutate("createVersion", { contentId: uuid(), previousVersionId: null, kind, title: "Brokerage original content",
      body: "Original fictional policy content entered by the brokerage.", sourceReferences: "Counsel source review reference",
      questions: kind === "Course" ? [{ prompt: "Who reviews?", options: ["Owner", "Nobody"], correctIndex: 0, explanation: "Use owner review." }] : [], passPercent: 80, ...extra });
  }
  function publish(versionId) {
    assert.equal(mutate("review", { versionId, note: "Owner content review", userReviewed: true,
      lawyerReviewReference: "Counsel review evidence 001", rightsConfirmed: true }).state, "Owner reviewed");
    assert.equal(mutate("publish", { versionId }).state, "Internally published");
  }
  function assign(versionId, actor = employee) {
    return mutate("assign", { versionId, employeeEmail: actor.email, dueAt: at }).assignmentId;
  }
  return { db, work, mutate, draft, publish, assign, admin, employee, other, roster, tenant };
}

test("strict schemas reject fabricated approval, invalid assessments and unknown fields", () => {
  assert.equal(learningRequest.safeParse({ operation: "list", legalApproved: true }).success, false);
  assert.equal(learningRequest.safeParse({ operation: "attempt", requestId: uuid(), assignmentId: uuid(), versionId: uuid(), answers: [-1] }).success, false);
  assert.equal(learningRequest.safeParse({ operation: "review", requestId: uuid(), versionId: uuid(), note: "review",
    lawyerReviewReference: "x", userReviewed: true, rightsConfirmed: false }).success, false);
});

test("policy lifecycle is version-bound, immutable, idempotent and not CE", t => {
  const f = fixture(t), contentId = uuid();
  const request = { operation: "createVersion", requestId: uuid(), contentId, previousVersionId: null, kind: "Policy",
    title: "Original", body: "Original policy", sourceReferences: "Official source", questions: [], passPercent: 80 };
  const created = f.work(request), id = created.versionId;
  assert.deepEqual(f.work(request), created);
  assert.match(f.work({ ...request, title: "Collision" }).error, /changed/);
  assert.match(f.mutate("publish", { versionId: id }).error, /changed/);
  assert.match(f.mutate("assign", { versionId: id, employeeEmail: f.employee.email, dueAt: at }).error, /changed/);
  f.publish(id); const assignmentId = f.assign(id);
  assert.equal(f.work({ operation: "readVersion", versionId: id }).history.find(e => e.operation === "review").lawyerReviewReference, "Counsel review evidence 001");
  assert.equal(f.work({ operation: "listAssignments", versionId: id }).items[0].id, assignmentId);
  assert.match(f.work({ operation: "listAssignments", versionId: id }, f.employee).error, /unavailable/);
  const ack = { operation: "acknowledge", requestId: uuid(), assignmentId, versionId: id, acknowledged: true };
  const evidence = f.work(ack, f.employee);
  assert.equal(evidence.completed, true); assert.match(evidence.disclaimer, /not NMLS CE/);
  assert.deepEqual(f.work(ack, f.employee), evidence);
  assert.match(f.work({ ...ack, requestId: uuid() }, f.employee).error, /changed/);
  assert.equal(f.work({ operation: "readAssignment", assignmentId }, f.employee).completion.digest, evidence.digest);
  const successor = f.draft("Policy", { contentId, previousVersionId: id, body: "New version" });
  assert.notEqual(successor.versionId, id);
  assert.equal(f.work({ operation: "readVersion", versionId: id }).version.body, "Original policy");
  assert.equal(f.work({ operation: "readVersion", versionId: successor.versionId }).version.state, "Draft");
  assert.match(f.draft("Policy", { contentId, previousVersionId: id }).error, /changed/);
  assert.match(f.work({ ...ack, requestId: uuid(), versionId: successor.versionId }, f.employee).error, /unavailable/);
  initializeComplianceLearning(f.db);
  assert.equal(f.work({ operation: "readAssignment", assignmentId }).completion.completed, true);
});

test("request collisions, revoked admin sessions and invalid payloads cannot mutate history", t => {
  const f = fixture(t), versionId = f.draft().versionId; f.publish(versionId);
  const request = { operation: "assign", requestId: uuid(), versionId, employeeEmail: f.employee.email, dueAt: at };
  const assigned = f.work(request); assert.deepEqual(f.work(request), assigned);
  assert.match(f.work({ ...request, employeeEmail: f.other.email }).error, /changed/);
  assert.match(f.work({ ...request, requestId: uuid() }).error, /already assigned/);
  assert.match(f.work(request, f.admin, f.roster.map(m => m.role === "Admin" ? { ...m, status: "Revoked" } : m)).error, /unavailable/);
  const before = f.db.prepare("SELECT count(*) n FROM compliance_learning_events").get().n;
  assert.match(f.work({ ...request, requestId: uuid(), legalApproved: true }).error, /unavailable/);
  assert.equal(f.db.prepare("SELECT count(*) n FROM compliance_learning_events").get().n, before);
});

test("tenant and live roster checks prevent stale roles, revoked users and cross-employee access", t => {
  const f = fixture(t), id = f.draft().versionId; f.publish(id); const assignmentId = f.assign(id);
  const read = { operation: "readAssignment", assignmentId };
  assert.match(f.work(read, f.other).error, /unavailable/);
  assert.match(f.work(read, f.admin, f.roster, uuid()).error, /unavailable/);
  assert.match(f.work({ operation: "readVersion", versionId: id }, f.employee).error, /unavailable/);
  assert.match(f.work(read, f.employee, f.roster.map(m => m.email === f.employee.email ? { ...m, status: "Revoked" } : m)).error, /unavailable/);
  assert.match(f.work(read, f.employee, f.roster.map(m => m.email === f.employee.email ? { ...m, accessRevision: 2 } : m)).error, /unavailable/);
  const upgraded = { ...f.employee, accessRevision: 2 };
  assert.match(f.work(read, upgraded, [f.admin, upgraded, f.other]).error, /unavailable/);
  assert.match(f.work({ operation: "list" }, { ...f.employee, role: "Admin" }).error, /unavailable/);
  assert.match(f.mutate("publish", { versionId: id }, f.employee).error, /unavailable/);
  assert.match(f.mutate("acknowledge", { assignmentId, versionId: id, acknowledged: true }).error, /unavailable/);
  f.mutate("revokeAssignment", { assignmentId, note: "Assignment withdrawn" });
  assert.match(f.work(read, f.employee).error, /unavailable/);
  assert.equal(f.work({ operation: "list" }, f.employee).items.length, 0);
  assert.equal(f.work(read).assignment.active, false);
});

test("course grading is server-side with immutable attempts and no pre-attempt answer leakage", t => {
  const f = fixture(t), id = f.draft("Course").versionId; f.publish(id); const assignmentId = f.assign(id);
  const view = f.work({ operation: "readAssignment", assignmentId }, f.employee);
  assert.deepEqual(view.version.questions, [{ prompt: "Who reviews?", options: ["Owner", "Nobody"] }]);
  assert.match(f.mutate("acknowledge", { assignmentId, versionId: id, acknowledged: true }, f.employee).error, /unavailable/);
  assert.match(f.mutate("attempt", { assignmentId, versionId: id, answers: [5] }, f.employee).error, /unavailable/);
  const failed = f.mutate("attempt", { assignmentId, versionId: id, answers: [1] }, f.employee);
  assert.equal(failed.completed, false); assert.equal(failed.correct, 0);
  const req = { operation: "attempt", requestId: uuid(), assignmentId, versionId: id, answers: [0] };
  const passed = f.work(req, f.employee); assert.equal(passed.completed, true); assert.equal(passed.attempt, 2);
  assert.deepEqual(f.work(req, f.employee), passed);
  assert.equal(f.work({ operation: "readAssignment", assignmentId }, f.employee).history.filter(e => e.operation === "attempt").length, 2);
  f.mutate("revokeAssignment", { assignmentId, note: "Revoked after completion" });
  assert.match(f.work(req, f.employee).error, /unavailable/);
  assert.equal(f.work({ operation: "readAssignment", assignmentId }).completion.completed, true);
});

test("bounded pagination and bounded assessment attempts retain all history", t => {
  const f = fixture(t);
  for (let i = 0; i < 27; i++) f.draft();
  const page = f.work({ operation: "list" }); assert.equal(page.items.length, 25); assert.ok(page.next);
  const next = f.work({ operation: "list", after: page.next }); assert.equal(next.items.length, 2); assert.equal(next.next, null);
  const id = f.draft("Course").versionId; f.publish(id); const assignmentId = f.assign(id);
  for (let i = 0; i < 20; i++) assert.equal(f.mutate("attempt", { assignmentId, versionId: id, answers: [1] }, f.employee).completed, false);
  assert.match(f.mutate("attempt", { assignmentId, versionId: id, answers: [0] }, f.employee).error, /limit/);
  assert.equal(f.db.prepare("SELECT count(*) n FROM compliance_learning_events WHERE operation='attempt'").get().n, 20);
});

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
const { complianceCaseWork } = await import("../src/lib/compliance-cases.ts");
const { researchSources, stateRolloutSources } = await import("../src/lib/compliance-research-model.ts");
const now = "2026-11-11T12:00:00.000Z";
const filters = { jurisdiction: "", status: "", ownership: "all" };
const unavailable = { error: "This compliance work is unavailable." };
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction(run) {
    sqlite.exec("BEGIN");
    try { const result = run(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const member = (email, role = "Admin") => ({ email, name: email.split("@")[0], role, status: "Active", accessRevision: 1 });
  const owner = member("owner@example.test"), backup = member("backup@example.test"), lo = member("lo@example.test", "LO");
  const roster = [owner, backup, lo];
  const tenant = crypto.randomUUID();
  const staff = (actor = owner, id = tenant) => ({ email: actor.email, name: actor.name, brokerage: { id, name: "Fictional", pilot: true,
    role: actor.role, accessRevision: actor.accessRevision } });
  const run = (input, actor = owner, members = roster, target = tenant) => complianceCaseWork(db, { type: "research", input }, staff(actor), target, members, now);
  const open = (sourceKey = "FED-02", kind = "Requirement review") => run({ operation: "open", sourceKey, kind });
  const list = (changes = {}, after) => run({ operation: "list", filters: { ...filters, ...changes }, ...(after ? { after } : {}) });
  const saveInput = (item, changes = {}) => ({ operation: "save", caseId: item.id, expectedRevision: item.revision, requestId: crypto.randomUUID(),
    ownerEmail: owner.email, status: "In progress", followUpOn: "2026-11-10", nextAction: "Confirm approved scope with reviewer", note: "Fictional research progress", ...changes });
  return { db, sqlite, run, open, list, saveInput, roster, owner, backup, lo, tenant, staff };
}

test("catalog covers 50 states and 25 federal areas without unknown jurisdiction fallback", () => {
  assert.equal(researchSources.length, 75);
  assert.equal(new Set(researchSources.map((entry) => entry.key)).size, 75);
  assert.equal(researchSources.filter((entry) => entry.jurisdiction === "US").length, 25);
  assert.equal(researchSources.some((entry) => entry.jurisdiction === "DC"), false);
});
test("state rollout tracks five independently owned areas across all 50 states", t => {
  const f = fixture(t);
  const query = { operation: "stateRollout", jurisdiction: "MI" };
  const overview = f.run(query);
  assert.equal(overview.kind, "stateRollout");
  assert.equal(overview.states.length, 50);
  assert.equal(stateRolloutSources.length, 250);
  assert.equal(new Set(stateRolloutSources.map(item => item.key)).size, 250);
  assert.ok(overview.states.every(item => item.total === 5 && item.tracked === 0));
  assert.ok(stateRolloutSources.filter(item => item.key.endsWith("-REPORTING")).every(item => item.sourceDate && item.relatedSources.length));
  assert.ok(overview.items.every(item => !item.cases.length));
  assert.deepEqual(f.run({ ...query, jurisdiction: "DC" }), unavailable);
  assert.deepEqual(f.run(query, f.lo), unavailable);
  assert.deepEqual(f.run(query, f.owner, [], f.tenant), unavailable);
  const item = f.open("STATE-MI-REPORTING").item;
  assert.equal(f.open("STATE-MI-REPORTING").item.id, item.id);
  assert.equal(JSON.parse(item.sourceSnapshot).researchBaseline, "2026-11-11");
  assert.ok(JSON.parse(item.sourceSnapshot).relatedSources.length);
  f.open("STATE-MI-REPORTING", "Control gap");
  f.open("STATE-NV-LICENSING");
  const updated = f.run(query);
  assert.equal(updated.states.find(state => state.jurisdiction === "MI").tracked, 1);
  assert.equal(updated.states.find(state => state.jurisdiction === "NV").tracked, 1);
  assert.equal(updated.items.find(entry => entry.source.key === "STATE-MI-REPORTING").cases.length, 2);
  assert.equal(f.list({ jurisdiction: "MI" }).counts.total, 2);
  assert.equal(updated.coverage.legalApproval, false);
  assert.equal(updated.coverage.runtimeEnforcement, false);
  const otherTenant = "other";
  const isolated = complianceCaseWork(f.db, { type: "research", input: query }, f.staff(f.owner, otherTenant), otherTenant, f.roster, now);
  assert.equal(isolated.states.find(state => state.jurisdiction === "MI").tracked, 0);
  f.db.prepare("UPDATE compliance_cases SET confidentiality = 'Restricted' WHERE id = ?").run(item.id);
  assert.equal(f.run(query).items.find(entry => entry.source.key === "STATE-MI-REPORTING").cases.length, 1);
});
test("opening research is idempotent, canonical, and preserves research-only status", (t) => {
  const f = fixture(t);
  assert.equal(f.list().counts.total, 0);
  assert.equal(f.list().coverage.evaluatedFiles, null);
  const first = f.open();
  assert.equal(first.kind, "researchDetail");
  assert.equal(f.open().item.id, first.item.id);
  assert.equal(f.open().history.length, 1);
  const gap = f.open("FED-02", "Control gap");
  assert.notEqual(gap.item.id, first.item.id);
  assert.equal(f.list().counts.total, 2);
  assert.equal(JSON.parse(first.item.sourceSnapshot).researchBaseline, "2026-11-10");
  assert.deepEqual(first.coverage, { legalApproval: false, runtimeEnforcement: false, evaluatedFiles: null });
  const canonical = complianceCaseWork(f.db, { type: "list" }, f.staff(), f.tenant, f.roster, now);
  assert.equal(canonical.items.some((item) => item.id === first.item.id), true);
  assert.deepEqual(f.open("STATE-DC"), unavailable);
});
test("admin, tenant, pilot and current roster checks precede research reads and mutations", (t) => {
  const f = fixture(t), id = f.open().item.id;
  for (const input of [{ operation: "list", filters }, { operation: "read", caseId: id }, { operation: "open", sourceKey: "FED-01", kind: "Control gap" }]) {
    assert.deepEqual(f.run(input, f.lo), unavailable);
    assert.deepEqual(f.run(input, f.owner, f.roster, "other"), unavailable);
    assert.deepEqual(f.run(input, f.owner, [{ ...f.owner, status: "Revoked" }]), unavailable);
    assert.deepEqual(f.run(input, f.owner, [{ ...f.owner, accessRevision: 2 }]), unavailable);
    const staff = f.staff(); staff.brokerage.pilot = false;
    assert.deepEqual(complianceCaseWork(f.db, { type: "research", input }, staff, f.tenant, f.roster, now), unavailable);
  }
  const other = f.staff(f.owner, "other");
  assert.deepEqual(complianceCaseWork(f.db, { type: "research", input: { operation: "read", caseId: id } }, other, "other", f.roster, now), unavailable);
});
test("restricted research cases do not leak through reads, counts or reopening", (t) => {
  const f = fixture(t), { id } = f.open().item;
  f.db.prepare("UPDATE compliance_cases SET confidentiality = 'Restricted' WHERE id = ?").run(id);
  assert.equal(f.list().counts.total, 0);
  assert.deepEqual(f.run({ operation: "read", caseId: id }), unavailable);
  assert.deepEqual(f.open(), unavailable);
});
test("save is atomic, revision checked and retry-safe; workflow cannot grant legal approval", (t) => {
  const f = fixture(t), first = f.open(), input = f.saveInput(first.item);
  const saved = f.run(input);
  assert.equal(saved.item.revision, 2);
  assert.equal(saved.item.overdue, true);
  assert.equal(saved.history[0].note, input.note);
  assert.equal(f.run(input).item.revision, 2);
  assert.equal(f.run(input).history.length, 2);
  assert.match(f.run({ ...input, note: "Different payload" }).error, /changed/);
  assert.match(f.run({ ...input, requestId: crypto.randomUUID() }).error, /changed/);
  assert.deepEqual(f.run(f.saveInput(saved.item, { status: "Resolved" })), unavailable);
  assert.deepEqual(f.run({ ...f.saveInput(saved.item), legalApproval: true }), unavailable);
  assert.equal(f.run(f.saveInput(saved.item, { status: "Awaiting review" })).coverage.legalApproval, false);
});
test("owner revocation/reinvite requires reassignment and never silently restores ownership", (t) => {
  const f = fixture(t), first = f.open();
  const reassigned = f.run(f.saveInput(first.item, { ownerEmail: f.backup.email }));
  const roster = f.roster.map((member) => member.email === f.backup.email ? { ...member, accessRevision: 2 } : member);
  const staleOwner = f.run({ operation: "read", caseId: first.item.id }, f.owner, roster);
  assert.equal(staleOwner.item.ownerAvailable, false);
  const missing = f.run({ operation: "list", filters: { ...filters, ownership: "unavailable" } }, f.owner, roster);
  assert.equal(missing.counts.total, 1);
  const restored = f.run(f.saveInput(reassigned.item, { ownerEmail: f.backup.email }), f.owner, roster);
  assert.equal(restored.item.ownerAvailable, true);
  assert.match(f.run(f.saveInput(restored.item, { ownerEmail: f.lo.email })).error, /active brokerage admin/);
});
test("filtered keyset pages detect changes and reject cross-filter or revoked-roster cursors", (t) => {
  const f = fixture(t);
  for (const entry of researchSources.slice(0, 25)) f.open(entry.key);
  const first = f.list();
  assert.equal(first.items.length, 20);
  const last = f.list({}, first.next);
  assert.equal(last.items.length, 5);
  assert.equal(new Set([...first.items, ...last.items].map((item) => item.id)).size, 25);
  assert.match(f.list({ jurisdiction: "US" }, first.next).error, /changed/);
  assert.match(f.run({ operation: "list", filters, after: first.next }, f.owner, [f.owner, f.lo]).error, /changed/);
  f.run(f.saveInput(first.items[0]));
  assert.match(f.list({}, first.next).error, /changed/);
  assert.equal(f.list({ status: "In progress" }).counts.overdue, 1);
  assert.deepEqual(f.list({ jurisdiction: "ZZ" }), unavailable);
});
test("source changes and reopened stores retain the original source and review history", (t) => {
  const f = fixture(t), first = f.open("STATE-MI");
  const saved = f.run(f.saveInput(first.item, { followUpOn: null }));
  initializeStore(f.db, false);
  assert.equal(f.open("STATE-MI").item.id, first.item.id);
  assert.equal(f.open("STATE-MI").history.length, 2);
  f.db.prepare("UPDATE compliance_research_work SET sourceSnapshot = ? WHERE caseId = ?").run(JSON.stringify({ title: "Prior source" }), first.item.id);
  assert.equal(f.run({ operation: "read", caseId: first.item.id }).item.sourceChanged, true);
  assert.equal(saved.item.overdue, false);
});
test("audit-write failure rolls back case and metadata changes", (t) => {
  const f = fixture(t), first = f.open();
  f.db.exec("CREATE TRIGGER reject_research_event BEFORE INSERT ON compliance_case_events BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  assert.throws(() => f.run(f.saveInput(first.item)), /fixture failure/);
  const row = f.run({ operation: "read", caseId: first.item.id });
  assert.equal(row.item.revision, 1);
  assert.equal(row.item.followUpOn, null);
  assert.equal(row.history.length, 1);
});

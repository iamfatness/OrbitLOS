import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const { activeBrokerages, bootstrapDemoMembers, changeBrokerage, initializeBrokerages, rememberWorkspace } =
  await import("../src/lib/brokerages.ts");
const { defaultWorkspace, demoBrokerageId, releaseWorkspaceClosed, workspaceFeatures } =
  await import("../src/lib/brokerage-model.ts");
const { uwmAccountEnabled, uwmConnectionSettings, uwmPricingEnvironment, uwmWorkspaceEnabled } = await import("../src/lib/uwm-live.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: sql => sqlite.exec(sql), prepare: sql => sqlite.prepare(sql), transaction: callback => {
    sqlite.exec("BEGIN");
    try { const result = callback(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeBrokerages(db);
  db.exec("CREATE TABLE staff_sessions (tokenHash TEXT, email TEXT, name TEXT, method TEXT, expiresAt INTEGER)");
  const owner = { email: "owner@example.test", name: "Owner" };
  const officer = { email: "officer@example.test", name: "Officer" };
  const allowed = [owner.email];
  bootstrapDemoMembers(db, allowed);
  db.prepare("INSERT INTO staff_sessions VALUES ('owner-token', ?, ?, 'google', 1000)").run(owner.email, owner.name);
  const change = (id, input, actor = owner) => changeBrokerage(db, id, actor, allowed, input);
  const create = (name, pilot, purpose) => {
    const id = randomUUID();
    assert.equal(change(demoBrokerageId, { type: "create", name, id, pilot, purpose }).created, id);
    return id;
  };
  const memberships = (actor = owner) => activeBrokerages(db, actor.email, allowed);
  const read = id => memberships().find(item => item.id === id);
  const addOfficer = id => db.prepare("INSERT INTO brokerage_members (brokerageId,email,name,role,status) VALUES (?,?,?,'LO','Active')")
    .run(id, officer.email, officer.name);
  return { db, owner, officer, allowed, change, create, memberships, read, addOfficer };
}

test("feature settings preserve old defaults, enforce role and revision, and leave other brokerages alone", t => {
  const { owner, officer, change, create, read, addOfficer, db } = fixture(t);
  const operational = create("Daily Brokerage", false);
  const pilot = create("Active pilot", true);
  addOfficer(operational);
  assert.deepEqual(workspaceFeatures(read(operational)), { uwm: true, compliance: false, revision: 0 });
  assert.deepEqual(workspaceFeatures(read(pilot)), { uwm: true, compliance: true, revision: 0 });
  const input = { type: "setWorkspaceFeatures", uwm: false, compliance: true, revision: 0 };
  assert.ok(change(operational, input, officer).error);
  assert.ok(change(operational, input).message);
  assert.ok(change(operational, input).message);
  assert.equal(change(operational, { ...input, uwm: true }).status, 409);
  assert.deepEqual(workspaceFeatures(read(operational)), { uwm: false, compliance: true, revision: 1 });
  assert.equal(workspaceFeatures(read(pilot)).revision, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM brokerage_access_history WHERE action='Updated workspace features'").get().n, 1);
  const staff = { ...owner, brokerage: read(operational) };
  assert.deepEqual(uwmConnectionSettings({}, staff), { pricing: "Off", pipeline: "Off", lenderActions: "Off" });
  assert.equal(uwmAccountEnabled(staff), false);
  assert.equal(uwmWorkspaceEnabled({}, staff), false);
  assert.throws(() => uwmPricingEnvironment({}, staff), /turned off/);
});

test("hiding is per account, protects current and default and keeps membership and access intact", t => {
  const { db, officer, allowed, change, create, memberships, read, addOfficer } = fixture(t);
  const operational = create("Daily Brokerage", false);
  const pilot = create("Active pilot", true);
  const spare = create("QA fixture", true);
  addOfficer(spare);
  assert.equal(rememberWorkspace(db, "owner-token", 10, allowed, pilot, true), true);
  const hide = ids => change(operational, { type: "setWorkspaceListVisibility", hidden: true, ids });
  assert.ok(hide([spare, pilot]).error);
  assert.ok(hide([operational]).error);
  assert.ok(hide([spare]).message);
  assert.equal(read(spare).hidden, true);
  assert.equal(memberships(officer)[0].hidden, undefined);
  assert.equal(rememberWorkspace(db, "owner-token", 10, allowed, spare, true), false);
  assert.ok(change(operational, { type: "setWorkspaceListVisibility", hidden: false, ids: [spare] }).message);
  assert.equal(read(spare).hidden, undefined);
});

test("release fixtures expire without changing the sign-in default, and guided demo creation reuses a fixture", t => {
  const { db, allowed, change, create, memberships, read } = fixture(t);
  const operational = create("Daily Brokerage", false);
  const release = create("November release", true, "release");
  const guided = create("OrbitLOS Guided Demo", true, "guided");
  const releaseItem = read(release);
  assert.equal(releaseWorkspaceClosed(releaseItem), false);
  assert.equal(releaseWorkspaceClosed(releaseItem, releaseItem.releaseEndsAt), true);
  assert.equal(defaultWorkspace(memberships(), release).id, operational);
  assert.equal(rememberWorkspace(db, "owner-token", 10, allowed, release, true), false);
  assert.ok(change(release, { type: "closeReleaseWorkspace" }).message);
  assert.ok(change(release, { type: "closeReleaseWorkspace" }).message);
  assert.equal(releaseWorkspaceClosed(read(release)), true);
  assert.ok(change(guided, { type: "closeReleaseWorkspace" }).error);
  assert.equal(change(operational, { type: "create", id: randomUUID(), name: "OrbitLOS Guided Demo", pilot: true, purpose: "guided" }).created, guided);
});

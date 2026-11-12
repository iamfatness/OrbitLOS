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

const { initializeStore } = await import("../src/lib/store.ts");
const { pilotSupportAccess } = await import("../src/lib/pilot-support-access.ts");
const { restoreBlockers } = await import("../src/lib/workspace-restore.ts");

test("pilot support opens expire precisely and do not survive changed staff access", t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const store = { prepare: sql => db.prepare(sql), exec: sql => db.exec(sql), transaction: fn => fn() };
  initializeStore(store, false);
  const id = randomUUID(), requestId = randomUUID(), grantId = randomUUID();
  const start = new Date("2026-11-12T13:00:00.000Z");
  const admin = { name: "Fictional Admin", email: "admin@example.test", role: "Admin", status: "Active", accessRevision: 2 };
  const reviewer = { name: "Fictional Reviewer", email: "reviewer@example.test", role: "Processor", status: "Active", accessRevision: 4 };
  const staff = member => ({ ...member, brokerage: { id, name: "Fictional pilot", role: member.role, pilot: true, accessRevision: member.accessRevision } });
  db.prepare("INSERT INTO pilot_feedback (id, author, step, message, createdAt) VALUES (?, ?, ?, ?, ?)")
    .run(requestId, "reporter@example.test", "Documents", "Private fictional report text", start.toISOString());
  const decide = (action, actor = admin, offset = 0, roster = [admin, reviewer]) =>
    pilotSupportAccess(store, staff(actor), action, roster, new Date(start.getTime() + offset));
  const approve = { type: "approve", requestId, grantId, reviewer: reviewer.email, reviewerRevision: reviewer.accessRevision, hours: 1 };
  const open = { type: "open", grantId, openId: randomUUID() };
  assert.equal(decide(approve).kind, "saved");
  const beforeExpiry = decide(open, reviewer, 3_599_999);
  assert.equal(beforeExpiry.kind, "summary");
  assert.equal(beforeExpiry.summary.expiresAt, "2026-11-12T14:00:00.000Z");
  assert.equal(beforeExpiry.summary.openedAt, "2026-11-12T13:59:59.999Z");
  assert.deepEqual(decide(open, reviewer, 3_600_000), {
    error: "This support summary is unavailable. Ask a pilot admin for access.", status: 404,
  });
  const replacedReviewer = { ...reviewer, role: "LO", accessRevision: reviewer.accessRevision + 1 };
  assert.equal(decide(open, replacedReviewer, 0, [admin, replacedReviewer]).status, 404);
  const replacedAdmin = { ...admin, accessRevision: admin.accessRevision + 1 };
  assert.equal(decide(open, reviewer, 0, [replacedAdmin, reviewer]).status, 404);
  assert.deepEqual(decide({ type: "mine" }, reviewer, 3_600_000).offers, []);
  const history = decide({ type: "manage", requestId }, admin, 3_600_000).grants;
  assert.equal(history[0].status, "Expired");
  assert.equal(history[0].openCount, 1);
  assert.equal(history[0].lastOpenedAt, beforeExpiry.summary.openedAt);
});

test("workspace restore blocks rewinding support grants and access receipts", () => {
  const manifest = { schema: "same", impact: {}, files: [], tables: [
    { name: "pilot_support_grants", digest: "grant-before-revocation" },
    { name: "pilot_support_grant_reads", digest: "one-view" },
  ] };
  assert.deepEqual(restoreBlockers(manifest, manifest), []);
  for (const name of ["pilot_support_grants", "pilot_support_grant_reads"]) {
    const current = { ...manifest, tables: manifest.tables.map(table => table.name === name ? { ...table, digest: "changed" } : table) };
    assert.match(restoreBlockers(manifest, current).join(" "), /access records changed/);
  }
});

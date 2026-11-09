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

const { executeCommand } = await import("../src/lib/commands.ts");
const { initializeStore, insertContact } = await import("../src/lib/store.ts");
const { realtorReferrals } = await import("../src/lib/realtor-portal.ts");

const expiresAt = "2099-01-01T00:00:00.000Z";
const token = "7".repeat(64);

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction(fn) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = fn(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const admin = { name: "Fictional admin", email: "admin@example.test", brokerage: { id: crypto.randomUUID(), name: "Test", role: "Admin" } };
  const prior = { name: "Fictional prior owner", email: "prior@example.test" };
  const recipient = { name: "Fictional new owner", email: "new@example.test" };
  insertContact(db, { id: "partner", name: "Fictional realtor", role: "Realtor", phone: "", email: "" });
  // Exercise migration of an already issued link and verify a second initialization is safe.
  db.exec("ALTER TABLE realtor_portals DROP COLUMN revision");
  db.prepare("INSERT INTO realtor_portals (realtorId,token,expiresAt,officer,officerEmail) VALUES ('partner',?,?,?,?)")
    .run(token, expiresAt, prior.name, prior.email);
  initializeStore(db, false);
  initializeStore(db, false);
  const edit = (officerEmail, revision = 0) => ({ type: "saveRealtorLinkOwner", realtorId: "partner", token, officerEmail, revision });
  const portal = () => db.prepare("SELECT * FROM realtor_portals WHERE realtorId = 'partner'").get();
  const submission = (name) => ({ type: "submit", token, requestId: crypto.randomUUID(), name, email: "buyer@example.test", phone: "",
    purpose: "Purchase", consent: true });
  return { db, admin, prior, recipient, edit, portal, submission };
}

test("retargets an existing link while preserving expiry, milestones, and previously assigned referrals", async (t) => {
  const { db, admin, prior, recipient, edit, portal, submission } = fixture(t);
  const original = submission("Fictional earlier lead");
  const next = submission("Fictional next lead");
  const initialRoute = { revision: 0, linkRevision: 0, owner: prior };
  assert.equal(portal().revision, 0);
  assert.ok(realtorReferrals(db, original, undefined, false, initialRoute).value);
  const changed = await executeCommand(db, edit(recipient.email), admin, recipient);
  assert.ok(changed.state, changed.error);
  assert.equal(changed.state.realtorPortals[0].revision, 1);
  assert.equal(portal().token, token);
  assert.equal(portal().expiresAt, expiresAt);
  assert.ok((await executeCommand(db, edit(recipient.email), admin, recipient)).state);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Updated realtor link routing'").get().count, 1);

  assert.equal(realtorReferrals(db, next, undefined, false, initialRoute).status, 409);
  assert.ok(realtorReferrals(db, original, undefined, false, initialRoute).value, "a previously committed request is safe to replay");
  const view = realtorReferrals(db, next, undefined, false, { revision: 0, linkRevision: 1, owner: recipient }).value;
  assert.deepEqual(view.referrals.map(({ borrowerName }) => borrowerName).sort(), [original.name, next.name].sort());
  assert.doesNotMatch(JSON.stringify(view), /prior@example|new@example|linkRevision/);
  const assignment = (id) => db.prepare("SELECT officerEmail FROM referral_leads WHERE requestId = ?").get(id).officerEmail;
  assert.equal(assignment(original.requestId), prior.email);
  assert.equal(assignment(next.requestId), recipient.email);
  assert.equal(db.prepare("SELECT count(*) AS count FROM referral_leads").get().count, 2);

  assert.ok((await executeCommand(db, edit(null, 1), admin)).state);
  const shared = submission("Fictional shared lead");
  assert.ok(realtorReferrals(db, shared, undefined, false, { revision: 0, linkRevision: 2, owner: null }).value);
  assert.equal(assignment(shared.requestId), null);
  assert.equal(portal().token, token);
});

test("rejects invalid editors, targets, stale revisions, and replaced or expired links", async (t) => {
  const { db, admin, recipient, edit, portal, submission } = fixture(t);
  for (const role of ["LO", "Processor"]) {
    assert.match((await executeCommand(db, edit(null), { ...admin, brokerage: { ...admin.brokerage, role } })).error, /brokerage admin/);
  }
  assert.match((await executeCommand(db, edit(null))).error, /brokerage admin/);
  assert.match((await executeCommand(db, edit(recipient.email), admin)).error, /active loan officer/);
  assert.ok((await executeCommand(db, edit(admin.email), admin)).state);
  assert.match((await executeCommand(db, edit(null), admin)).error, /changed or expired/);
  assert.ok((await executeCommand(db, { type: "createRealtorPortal", realtorId: "partner", officerEmail: null }, admin)).state);
  assert.notEqual(portal().token, token);
  assert.equal(portal().officerEmail, null);
  assert.match((await executeCommand(db, edit(admin.email, portal().revision), admin)).error, /changed or expired/);
  assert.equal(realtorReferrals(db, submission("Fictional stale link")).status, 404);
  db.prepare("UPDATE realtor_portals SET expiresAt = '2000-01-01T00:00:00.000Z'").run();
  assert.match((await executeCommand(db, { ...edit(admin.email, portal().revision), token: portal().token }, admin)).error, /changed or expired/);
});

test("brokerage routing takes precedence over an updated link default", async (t) => {
  const { db, admin, prior, recipient, edit, submission } = fixture(t);
  const route = await executeCommand(db, { type: "saveLeadRouting", revision: 0, websiteOwner: null, realtorRoute: "Assigned officer",
    realtorOwner: prior.email, firstContactHours: 24, secondAfterHours: 48, finalAfterHours: 72, quoteForm: "Keep" }, admin, undefined, [prior]);
  assert.ok(route.state, route.error);
  assert.ok((await executeCommand(db, edit(recipient.email), admin, recipient)).state);
  const request = submission("Fictional assigned lead");
  assert.equal(realtorReferrals(db, request, undefined, false, { revision: 0, linkRevision: 0, owner: prior }).status, 409);
  assert.ok(realtorReferrals(db, request, undefined, false, { revision: 1, owner: prior }).value);
  assert.equal(db.prepare("SELECT officerEmail FROM referral_leads WHERE requestId = ?").get(request.requestId).officerEmail, prior.email);
});

test("partner milestone pages keep tied loan and referral rows private and reachable", (t) => {
  const { db } = fixture(t);
  const otherToken = "8".repeat(64);
  insertContact(db, { id: "other-partner", name: "Other realtor", role: "Realtor", email: "", phone: "" });
  insertContact(db, { id: "buyer", name: "Tied loan borrower", role: "Borrower", email: "private@example.test", phone: "" });
  db.prepare("INSERT INTO realtor_portals (realtorId, token, expiresAt) VALUES ('other-partner', ?, ?)").run(otherToken, expiresAt);
  const at = "2026-11-08T12:00:00.000Z";
  const addLoan = db.prepare(`INSERT INTO loans (id, contactId, partnerId, officer, address, amount, purpose, stage, stageSince)
    VALUES (?, 'buyer', ?, 'Private officer', 'Private address', 325000, 'Purchase', 'Processing', ?)`);
  const addLead = db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, createdAt, dueAt, resolvedAt, loanId)
    VALUES (?, ?, ?, ?, 'private@example.test', '', 'Purchase', 'Private officer', ?, ?, ?, ?)`);
  addLoan.run("same-id", "partner", at);
  addLoan.run("other-loan", "other-partner", at);
  addLead.run("same-id", "pending", "partner", "Tied pending borrower", at, at, null, null);
  addLead.run("converted", "converted", "partner", "Tied original referral name", at, at, at, "same-id");
  addLead.run("other-lead", "other", "other-partner", "Unrelated referral", at, at, null, null);
  for (let i = 0; i < 19; i++) addLead.run(`recent-${i}`, `recent-${i}`, "partner", `Recent referral ${i}`, "2026-11-09T12:00:00.000Z", at, null, null);
  for (let i = 0; i < 25; i++) addLead.run(`older-${i}`, `older-${i}`, "partner", `Older referral ${i}`, "2026-11-07T12:00:00.000Z", at, null, null);
  const read = (after, link = token) => realtorReferrals(db, { type: "read", token: link, after }, at).value;
  const first = read();
  assert.equal(first.referrals.length, 20);
  assert.equal(first.referrals.at(-1).borrowerName, "Tied pending borrower");
  assert.equal(first.next.source, "referral");
  const second = read(first.next);
  assert.equal(second.referrals[0].borrowerName, "Tied original referral name");
  assert.equal(second.referrals[0].stage, "Processing");
  const third = read(second.next);
  assert.equal(third.next, null);
  const all = [first, second, third].flatMap(({ referrals }) => referrals);
  assert.equal(all.length, 46);
  assert.equal(new Set(all.map(({ borrowerName }) => borrowerName)).size, 46);
  assert.ok(all.every((row) => Object.keys(row).sort().join(",") === "borrowerName,stage,updatedAt"));
  assert.doesNotMatch(JSON.stringify(all), /Unrelated referral|private@example.test|Private address|325000/);
  assert.ok(read(first.next, otherToken).referrals.every(({ borrowerName }) => borrowerName === "Tied loan borrower" || borrowerName === "Unrelated referral"));
  db.exec("UPDATE loans SET stage = 'Funded', stageSince = '2026-11-10T12:00:00.000Z' WHERE id = 'same-id'");
  assert.equal(read().referrals[0].stage, "Funded");
});

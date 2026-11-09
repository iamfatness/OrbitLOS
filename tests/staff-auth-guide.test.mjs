import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
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
const { staffAuthStore } = await import("../src/lib/staff-store.ts");
const { handleStaffAuth, staffLoginUrl, staffSessionHash } = await import("../src/lib/staff-auth.ts");
const { brokerageUrl } = await import("../src/lib/brokerage-model.ts");
const { initializeBrokerages, readStaffAccess } = await import("../src/lib/brokerages.ts");

test("staff sign-in preserves only an allowed guide through an older workspace and a cancelled attempt", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction: (fn) => fn() };
  initializeStore(db, false);
  db.exec("ALTER TABLE staff_google_attempts DROP COLUMN guide");
  initializeStore(db, false);

  const store = staffAuthStore(db);
  const settings = { clientId: "demo-client", clientSecret: "test-secret", allowedEmails: new Set(["admin@example.test"]) };
  const brokerageId = crypto.randomUUID();
  const request = (path, headers) => {
    const url = new URL(path, "https://orbitlos.test");
    return handleStaffAuth(new Request(url, { headers }), url, settings, store, async () => []);
  };

  const login = await request(staffLoginUrl(brokerageId, undefined, "campaign"));
  assert.match(await login.text(), new RegExp(`href="/auth/google\\?brokerage=${brokerageId}&amp;guide=campaign"`));
  const start = await request(`/auth/google?brokerage=${brokerageId}&guide=campaign`);
  const target = new URL(start.headers.get("location"));
  const cookie = start.headers.get("set-cookie").split(";", 1)[0];
  const state = target.searchParams.get("state");
  const cancelled = await request(`/auth/google/callback?error=access_denied&state=${state}`, { Cookie: cookie });
  assert.equal(cancelled.headers.get("location"), staffLoginUrl(brokerageId, "restart", "campaign"));
  assert.equal(db.prepare("SELECT 1 FROM staff_google_attempts WHERE state = ?").get(state), undefined);
  const invalid = await request("/auth/google?guide=https://example.test");
  assert.equal(new URL(invalid.headers.get("location")).hostname, "accounts.google.com");
  assert.equal(db.prepare("SELECT guide FROM staff_google_attempts").get().guide, null);
  assert.equal(brokerageUrl(brokerageId, "1"), `/workspace?brokerage=${brokerageId}&guide=1`);
});

test("one authenticated lookup keeps session expiry, current memberships and bootstrap access", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction: (fn) => fn() };
  initializeStore(db, false);
  initializeBrokerages(db);
  const store = staffAuthStore(db);
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("base64url");
  const staff = { email: "officer@example.test", name: "Fictional officer" };
  const settings = { clientId: "demo-client", clientSecret: "test-secret", allowedEmails: new Set([staff.email]) };
  const request = new Request("https://orbitlos.test/workspace", { headers: { Cookie: "__Host-orbit-session=" + token } });
  assert.equal(await staffSessionHash(request, settings), hash);
  assert.equal(await staffSessionHash(request, { ...settings, clientSecret: "" }), null);
  await store.createStaffSession(hash, staff, 2000, 1000);
  for (const id of ["first", "second"]) {
    db.prepare("INSERT INTO brokerages (id, name, pilot) VALUES (?, ?, 1)").run(id, id);
    db.prepare("INSERT INTO brokerage_members (brokerageId, email, name, role, status) VALUES (?, ?, ?, 'LO', 'Active')").run(id, staff.email, staff.name);
  }
  const access = (now, allowed = [staff.email]) => readStaffAccess(db, hash, now, allowed);
  assert.deepEqual(access(1000).identity, staff);
  assert.deepEqual(access(1000).brokerages.map(({ id, role }) => [id, role]), [["orbit-demo", "Admin"], ["first", "LO"], ["second", "LO"]]);
  db.prepare("UPDATE brokerage_members SET status = 'Revoked', accessRevision = 2 WHERE brokerageId = 'first'").run();
  db.prepare("UPDATE brokerage_members SET role = 'Processor', accessRevision = 3 WHERE brokerageId = 'second'").run();
  assert.deepEqual(access(1100, []).brokerages.map(({ id, role, accessRevision }) => [id, role, accessRevision]), [["second", "Processor", 3]]);
  assert.equal(access(2000), null);
  await store.removeStaffSession(hash);
  assert.equal(access(1100), null);
});

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
const { handleStaffAuth, staffLoginUrl, staffSessionHash, workspaceAccessDenied } = await import("../src/lib/staff-auth.ts");
const { brokerageUrl, defaultWorkspace, demoBrokerageId } = await import("../src/lib/brokerage-model.ts");
const { bootstrapDemoMembers, changeBrokerage, consumeStaffEmailCode, initializeBrokerages, readStaffAccess, reserveStaffEmailCode } = await import("../src/lib/brokerages.ts");

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


test("workspace denial offers safe account recovery without revealing brokerage details", async () => {
  const id = crypto.randomUUID();
  const response = workspaceAccessDenied(id, "campaign");
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Type"), /text\/html/);
  assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  const html = await response.text();
  assert.match(html, /href="\/workspace"/);
  assert.match(html, new RegExp(`href="/login\\?brokerage=${id}&amp;guide=campaign"`));
  assert.match(html, /Use a different Google account/);
  const invalid = await workspaceAccessDenied('"<script>alert(1)</script>').text();
  assert.doesNotMatch(invalid, /<script>|alert\(1\)/);
  assert.match(invalid, /href="\/login"/);
});


test("workspace entry prefers accessible operational work and explicit demo links remain available", () => {
  const demo={id:demoBrokerageId,name:"Demo",role:"Admin"};
  const testSpace={id:crypto.randomUUID(),name:"QA",role:"Admin",pilot:true};
  const production={id:crypto.randomUUID(),name:"Production",role:"Admin"};
  const second={id:crypto.randomUUID(),name:"Second",role:"LO"};
  assert.equal(defaultWorkspace([demo,testSpace,production],production.id),production);
  assert.equal(defaultWorkspace([demo,testSpace,production],"inaccessible"),production);
  assert.equal(defaultWorkspace([demo,production,second],second.id),second);
  assert.equal(defaultWorkspace([demo,{...production,maintenance:true}],production.id),demo);
  assert.equal(defaultWorkspace([demo,testSpace]),demo);
  assert.equal(defaultWorkspace([]),undefined);
  assert.equal(brokerageUrl(demoBrokerageId),"/workspace?brokerage=orbit-demo");
});

test("email sign-in activates the invited role and preserves Google-only bootstrap access", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction: (fn) => fn() };
  initializeStore(db, false);
  initializeBrokerages(db);
  const store = staffAuthStore(db);
  const admin = { email: "owner@example.test", name: "Fictional owner" };
  const email = "new-processor@outlook.com";
  const bootstrap = [admin.email, email];
  const settings = { clientId: "test-client", clientSecret: "test-secret", allowedEmails: new Set(bootstrap) };
  const brokerageId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const savedId = crypto.randomUUID();
  db.prepare("INSERT INTO brokerages (id, name) VALUES (?, 'Fictional brokerage')").run(brokerageId);
  db.prepare("INSERT INTO brokerages (id, name) VALUES (?, 'Other brokerage'), (?, 'Saved brokerage')").run(otherId, savedId);
  db.prepare("INSERT INTO brokerage_members (brokerageId, email, name, role, status) VALUES (?, ?, ?, 'Admin', 'Active')")
    .run(brokerageId, admin.email, admin.name);
  assert.ok(changeBrokerage(db, brokerageId, admin, bootstrap, { type: "invite", email, role: "Processor" }).message);
  db.prepare("INSERT INTO brokerage_members (brokerageId, email, name, role, status) VALUES (?, ?, ?, 'Admin', 'Invited'), (?, ?, ?, 'LO', 'Active')")
    .run(otherId, email, email, savedId, email, email);
  db.prepare("INSERT INTO staff_workspace_preferences (email, brokerageId) VALUES (?, ?)").run(email, savedId);

  const outbox = [];
  const emailAuth = {
    reserve: async (proof) => reserveStaffEmailCode(db, proof), consume: async (proof) => consumeStaffEmailCode(db, proof),
    allowRequest: async () => true, send: (to, code) => outbox.push({ to, code }),
  };
  const origin = "https://orbitlos.test";
  const request = (path, body, cookie = "", from = origin, query = `?brokerage=${brokerageId}&guide=campaign`) => {
    const url = new URL(`${path}${query}`, origin);
    const options = body ? { method: "POST", headers: { Origin: from, Cookie: cookie }, body: new URLSearchParams(body) } : {};
    return handleStaffAuth(new Request(url, options), url, settings, store, async () => [], emailAuth);
  };
  const send = (address, cookie, from) => request("/auth/email/request", { email: address }, cookie, from);
  const verify = (address, code, cookie) => request("/auth/email/verify", { email: address, code }, cookie);
  const login = await request("/login");
  assert.match(await login.text(), /Continue with Google[\s\S]*Sign in with an email code/);
  assert.equal((await send(email, "", "https://elsewhere.test")).status, 403);
  assert.match(await (await send("uninvited@example.test")).text(), /uninvited@example.test<\/strong>If this address has Orbit access/);
  assert.equal(outbox.length, 0);

  const issued = await send(email.toUpperCase());
  const browser = issued.headers.get("set-cookie").split(";", 1)[0];
  const [{ to, code }] = outbox;
  assert.equal(to, email);
  assert.match(code, /^\d{6}$/);
  await send(email, browser);
  assert.equal(outbox.length, 1);
  assert.equal((await verify(email, code, "")).status, 400);
  assert.equal((await verify(email, code === "123456" ? "654321" : "123456", browser)).status, 400);
  const signedIn = await verify(email, code, browser);
  assert.equal(signedIn.status, 303);
  assert.equal(signedIn.headers.get("location"), `/workspace?brokerage=${brokerageId}&guide=campaign`);
  const session = signedIn.headers.getSetCookie().find((entry) => entry.startsWith("__Host-orbit-email-session=")).split(";", 1)[0];
  const tokenHash = await staffSessionHash(new Request(origin, { headers: { Cookie: session } }), settings);
  const access = readStaffAccess(db, tokenHash, Date.now(), bootstrap);
  assert.deepEqual(access.brokerages.map(({ id, role }) => [id, role]), [[brokerageId, "Processor"], [savedId, "LO"]]);
  assert.equal(db.prepare("SELECT status FROM brokerage_members WHERE brokerageId = ? AND email = ?").get(otherId, email).status, "Invited");
  const wrongCookie = session.replace("__Host-orbit-email-session", "__Host-orbit-session");
  const legacyHash = await staffSessionHash(new Request(origin, { headers: { Cookie: wrongCookie } }), settings);
  assert.equal(readStaffAccess(db, legacyHash, Date.now(), bootstrap), null);
  assert.equal((await verify(email, code, browser)).status, 400);
  assert.equal(db.prepare("SELECT count(*) AS count FROM brokerage_access_history WHERE action = 'Accepted invitation'").get().count, 1);

  db.prepare("UPDATE staff_email_codes SET nextSendAt = 0 WHERE email = ?").run(email);
  const generic = await request("/auth/email/request", { email }, "", origin, "");
  const genericBrowser = generic.headers.get("set-cookie").split(";", 1)[0];
  const genericResult = await request("/auth/email/verify", { email, code: outbox.at(-1).code }, genericBrowser, origin, "");
  assert.equal(genericResult.headers.get("location"), "/workspace");
  assert.equal(defaultWorkspace(access.brokerages, access.preferredWorkspace)?.id, savedId);
});

test("email codes expire, stop after five guesses, and become invalid when an invite is cancelled and recreated", (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction: (fn) => fn() };
  initializeBrokerages(db);
  const email = "invited@example.test";
  const brokerageId = "orbit-demo";
  const admin = { email: "owner@example.test", name: "Fictional owner" };
  const bootstrap = [admin.email];
  bootstrapDemoMembers(db, bootstrap);
  const change = (type) => changeBrokerage(db, brokerageId, admin, bootstrap, { type, email, ...(type === "invite" ? { role: "LO" } : {}) });
  assert.ok(change("invite").message);
  const proof = { email, brokerageId, browserHash: "browser", codeHash: "correct", now: 10_000 };
  assert.equal(reserveStaffEmailCode(db, proof), true);
  for (let attempt = 0; attempt < 5; attempt++) assert.equal(consumeStaffEmailCode(db, { ...proof, codeHash: "wrong" }), null);
  assert.equal(consumeStaffEmailCode(db, proof), null);

  proof.now += 60_000;
  assert.equal(reserveStaffEmailCode(db, proof), true);
  assert.equal(consumeStaffEmailCode(db, { ...proof, now: proof.now + 600_000 }), null);

  proof.now += 600_000;
  assert.equal(reserveStaffEmailCode(db, proof), true);
  assert.ok(change("revoke").message);
  assert.ok(change("invite").message);
  assert.equal(consumeStaffEmailCode(db, proof), null);
  assert.equal(db.prepare("SELECT status FROM brokerage_members WHERE email = ?").get(email).status, "Invited");
});

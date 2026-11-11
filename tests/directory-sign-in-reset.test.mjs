import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
}});
const { commitDirectorySignInReset, previewDirectorySignInReset } = await import("../src/lib/directory-sign-in-reset.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = {
    prepare: sql => sqlite.prepare(sql),
    exec: sql => sqlite.exec(sql),
    transaction: fn => {
      sqlite.exec("BEGIN");
      try { const result = fn(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  db.exec(`CREATE TABLE staff_sessions(tokenHash TEXT PRIMARY KEY,email TEXT);
    CREATE TABLE staff_google_attempts(state TEXT PRIMARY KEY,verifier TEXT);
    CREATE TABLE brokerage_members(id TEXT PRIMARY KEY);
    INSERT INTO staff_sessions VALUES ('fictional-session','owner@example.test');
    INSERT INTO staff_google_attempts VALUES ('fictional-state','fictional-verifier');
    INSERT INTO brokerage_members VALUES ('fictional-member');`);
  const review = previewDirectorySignInReset(db);
  const intent = { id:crypto.randomUUID(), fingerprint:review.fingerprint, incident:"QA", markerVersion:"marker", deployment:"fixture" };
  return { db, review, intent };
}

test("directory reset clears sessions and OAuth attempts atomically and retries without clearing new rows", t => {
  const { db, review, intent } = fixture(t);
  assert.equal(review.sessions,1);
  assert.equal(review.attempts,1);
  assert(!JSON.stringify(review).includes("fictional-session"));
  assert(!JSON.stringify(review).includes("fictional-verifier"));
  assert.deepEqual(commitDirectorySignInReset(db,intent),{sessions:1,attempts:1});
  assert.equal(previewDirectorySignInReset(db).sessions,0);
  assert.equal(previewDirectorySignInReset(db).attempts,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM brokerage_members").get().n,1);
  db.exec("INSERT INTO staff_sessions VALUES ('fresh-session','owner@example.test')");
  assert.deepEqual(commitDirectorySignInReset(db,intent),{sessions:1,attempts:1});
  assert.equal(previewDirectorySignInReset(db).sessions,1);
});

test("same-count replacement invalidates a reviewed sign-in reset", t => {
  const { db, intent } = fixture(t);
  db.exec("UPDATE staff_google_attempts SET verifier='different-verifier'");
  assert.equal(commitDirectorySignInReset(db,intent),null);
  assert.equal(previewDirectorySignInReset(db).sessions,1);
  assert.equal(previewDirectorySignInReset(db).attempts,1);
});

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { blankApplication, sampleApplication } = await import("../src/lib/application-model.ts");
const { portalToken } = await import("../src/lib/brokerage-model.ts");
const { confirmLenderPackagePdf, lenderPackageAccess, lenderShareWork } = await import("../src/lib/lender-handoff-share.ts");
const { newLenderPackageCode } = await import("../src/lib/lender-handoff-share-model.ts");
const { loadProtectedPilotScenario } = await import("../src/lib/pilot.ts");

test("only current approved sample artifacts can be shared and expiration and revocation deny all files", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const at = "2026-11-09T17:00:00.000Z";
  const expiresAt = "2026-11-09T18:00:00.000Z";
  const loanId = randomUUID();
  const brokerageId = randomUUID();
  const officer = { name: "Fictional Officer", email: "officer@example.test", brokerage: { id: brokerageId, role: "LO", pilot: true } };
  insertContact(db, { id: "fictional-borrower", name: "Fictional Borrower", email: "", phone: "", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId: "fictional-borrower", partnerId: null, officer: officer.name, officerEmail: officer.email,
    stage: "Application", stageSince: at, address: "", amount: 350000, purpose: "Purchase" });
  const draft = { ...sampleApplication({ ...blankApplication(), borrowerName: "Fictional Borrower" }), confirmedDemo: true };
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, revision, updatedAt, submittedAt, reviewedAt)
    VALUES (?, ?, ?, ?, 3, ?, ?, ?)`).run(loanId, portalToken(brokerageId), expiresAt, JSON.stringify(draft), at, at, at);
  const attach = (mode) => {
    const id = randomUUID();
    const objectId = randomUUID();
    const kind = mode === "mock" ? "Bank statement" : mode === "live" ? "Photo ID" : "Pay stubs";
    db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, status, requestedAt, revision)
      VALUES (?, ?, ?, '', 'Accepted', ?, 2)`).run(id, loanId, kind, at);
    db.prepare("INSERT INTO document_files (requestId, objectId, attemptedAt, uploadMode) VALUES (?, ?, 0, ?)").run(id, objectId, mode);
    return { id, revision: 2, objectId };
  };
  const sample = attach("mock");
  const real = attach("live");
  const unknown = attach(null);
  const token = portalToken(brokerageId);
  const code = newLenderPackageCode();
  const create = { type: "create", loanId, revision: 3, lenderRevision: 0, shareId: randomUUID(), token, code, hours: 1,
    recipient: "Fictional lender", confirmedFictional: true, names: [{ first: "Fictional", middle: "", last: "Borrower", suffix: "" }],
    documents: [{ id: sample.id, revision: sample.revision }] };
  const work = (input, protect) => lenderShareWork(db, input, officer, brokerageId, protect, new Date(at));
  assert.deepEqual((await work({ type: "read", loanId })).eligible.map(({ id }) => id), [sample.id]);
  for (const unapproved of [real, unknown]) {
    assert.match((await work({ ...create, documents: [{ id: unapproved.id, revision: 2 }] })).error, /evidence changed/);
  }
  const page = await work(create);
  assert.equal(page.createdId, create.shareId, page.error);
  assert.deepEqual(await work(create), page);
  assert.match((await work({ ...create, shareId: randomUUID(), token: portalToken(brokerageId) })).error, /Revoke the previous/);
  const stored = db.prepare("SELECT tokenHash, codeHash, requestHash FROM lender_package_links").get();
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(stored.tokenHash, hash(token));
  assert.equal(stored.codeHash, hash(code));
  assert.ok(!JSON.stringify(stored).includes(token) && !JSON.stringify(stored).includes(code));
  const read = { type: "read", token, code };
  assert.equal(lenderPackageAccess(db, { ...read, code: newLenderPackageCode() }, at).status, 404);
  assert.equal(lenderPackageAccess(db, read, expiresAt).status, 404);
  assert.equal(lenderPackageAccess(db, read, at).value.expiresAt, expiresAt);
  const getPdf = { ...read, type: "download", slot: 1 };
  assert.equal(lenderPackageAccess(db, getPdf, at).objectId, sample.objectId);
  assert.equal(confirmLenderPackagePdf(db, getPdf, randomUUID(), at), false);
  assert.equal(confirmLenderPackagePdf(db, getPdf, sample.objectId, at), true);
  db.prepare("UPDATE document_files SET objectId = ? WHERE requestId = ?").run(randomUUID(), sample.id);
  assert.equal(confirmLenderPackagePdf(db, getPdf, sample.objectId, at), false);
  assert.equal(lenderPackageAccess(db, { ...read, type: "download", slot: 0 }, at).status, 404);
  const status = (await work({ type: "read", loanId })).shares[0];
  assert.equal(status.status, "File changed");
  assert.deepEqual(status.files.map(({ downloads }) => downloads), [0, 1]);

  const revoke = { type: "revoke", loanId, shareId: create.shareId };
  assert.match((await work(revoke, async () => false)).error, /protect/);
  assert.equal((await work(revoke, async (links) => {
    assert.deepEqual(links, [{ tokenHash: hash(token), expiresAt }]);
    return true;
  })).shares[0].status, "Revoked");
  assert.match((await work(create)).error, /new package/);
  assert.equal(lenderPackageAccess(db, read, at).status, 404);

  const replacement = { ...create, shareId: randomUUID(), token: portalToken(brokerageId), documents: [] };
  assert.equal((await work(replacement)).createdId, replacement.shareId);
  const previousId = randomUUID();
  db.prepare("INSERT INTO pilot_scenario VALUES (1, ?, ?, ?, ?, ?, 0)").run(previousId, "fictional-realtor", loanId, at, officer.email);
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const reset = { type: "loadPilotScenario", id: randomUUID(), previousId, officerEmail: officer.email, presenter: false };
  const result = await loadProtectedPilotScenario(db, admin, reset, officer, async (links) => {
    assert.deepEqual(links.filter((link) => "tokenHash" in link), [{ tokenHash: hash(replacement.token), expiresAt }]);
    return true;
  }, new Date(at));
  assert.ok(result.message, result.error);
  assert.equal(lenderPackageAccess(db, { ...read, token: replacement.token }, at).status, 404);
});

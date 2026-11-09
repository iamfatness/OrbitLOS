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

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { blankApplication, sampleApplication } = await import("../src/lib/application-model.ts");
const { workOnPreapprovalLetters } = await import("../src/lib/preapproval-letters.ts");
const { preapprovalLetterPdf } = await import("../src/lib/preapproval-letter-pdf.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { prepare: (sql) => sqlite.prepare(sql), exec: (sql) => sqlite.exec(sql), transaction(run) {
    sqlite.exec("BEGIN");
    try { const result = run(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const now = new Date("2026-11-10T04:59:59.999Z");
  const staff = { name: "Sample Officer", email: "officer@example.test",
    brokerage: { id: crypto.randomUUID(), name: "Fictional Brokerage", role: "LO", pilot: true } };
  const borrower = "José (Sample)";
  const draft = { ...sampleApplication({ ...blankApplication(), borrowerName: borrower }), confirmedDemo: true };
  const loanId = "sample-purchase";
  insertContact(db, { id: "borrower", name: borrower, role: "Borrower", phone: "", email: "borrower@example.test" });
  insertLoan(db, { id: loanId, contactId: "borrower", partnerId: null, officer: staff.name, officerEmail: staff.email,
    address: "400 Demo Way", amount: 360000, purpose: "Purchase", stage: "Application", stageSince: now.toISOString() });
  const at = now.toISOString();
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt, reviewedAt, revision)
    VALUES (?, ?, '2099-01-01', ?, ?, ?, ?, 1)`).run(loanId, "a".repeat(64), JSON.stringify(draft), at, at, at);
  const read = { type: "read", loanId };
  const issue = { type: "issue", loanId, requestId: crypto.randomUUID(), applicationRevision: 1, previousVersion: 0,
    amountCents: 35_000_000, expiresOn: "2026-11-10", scope: "Subject property", confirmed: true };
  const work = (input = read, actor = staff, clock = now, brokerage = staff.brokerage.id) =>
    workOnPreapprovalLetters(db, input, actor, brokerage, clock);
  const download = (version) => work({ type: "download", loanId, version });
  return { db, draft, loanId, staff, read, issue, work, download };
}

test("sample preapproval preserves version bytes, reviews, and Eastern expiry across retries", (t) => {
  const { db, read, issue, work, staff, download } = fixture(t);
  const firstPage = work().page;
  assert.equal(firstPage.issue.earliestExpiry, "2026-11-10");
  assert.equal(firstPage.issue.suggestedExpiry, "2026-12-09");
  assert.ok(work({ ...issue, confirmed: false }).error);
  assert.match(work({ ...issue, amountCents: 36_000_001 }).error, /at or below/);
  assert.match(work({ ...issue, expiresOn: "2026-11-09" }).error, /1 to 60/);
  assert.equal(work(issue).issuedVersion, 1);
  assert.equal(work(issue).issuedVersion, 1);
  assert.match(work({ ...issue, scope: "Property search" }).error, /new sample letter entry/);
  assert.match(work({ ...issue, requestId: crypto.randomUUID() }).error, /newer sample letter/);
  const v1 = download(1);
  assert.match(v1.pdf, /^%PDF-1\.4\n/);
  assert.equal(v1.filename, "orbit-fictional-preapproval-v1.pdf");
  assert.equal(work(read, staff, new Date("2026-11-11T04:59:59.999Z")).page.letters[0].status, "Current");
  assert.equal(work(read, staff, new Date("2026-11-11T05:00:00.000Z")).page.letters[0].status, "Expired");
  assert.equal(work({ ...issue, requestId: crypto.randomUUID(), previousVersion: 1, amountCents: 34_000_000 }).issuedVersion, 2);
  assert.deepEqual(work().page.letters.map(({ version, status }) => ({ version, status })),
    [{ version: 2, status: "Current" }, { version: 1, status: "Superseded" }]);
  assert.deepEqual(download(1), v1);
  assert.notEqual(download(2).pdf, v1.pdf);
  assert.equal(db.prepare("SELECT count(*) AS total FROM activity WHERE text LIKE 'Issued fictional preapproval%'").get().total, 2);
  assert.equal(db.prepare("SELECT count(*) AS total FROM workspace_access_history WHERE action LIKE 'Issued sample preapproval%'").get().total, 2);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("sample letters enforce the current application and staff scope, and page archived versions", (t) => {
  const { db, draft, staff, loanId, read, issue, work } = fixture(t);
  for (const actor of [null, { ...staff, email: "other@example.test" },
    { ...staff, brokerage: { ...staff.brokerage, role: "Processor" } },
    { ...staff, brokerage: { ...staff.brokerage, pilot: false } }]) {
    assert.ok(work(read, actor).error);
  }
  assert.ok(work(read, staff, undefined, crypto.randomUUID()).error);
  const pending = { ...draft, urla: { ...draft.urla, property: { ...draft.urla.property,
    fields: { ...draft.urla.property.fields, propertyPending: "Yes" } } } };
  db.prepare("UPDATE applications SET draft = ?").run(JSON.stringify(pending));
  assert.match(work(issue).error, /with a subject property/);
  for (let version = 1; version <= 6; version++) {
    const result = work({ ...issue, requestId: crypto.randomUUID(), previousVersion: version - 1, scope: "Property search" });
    assert.equal(result.issuedVersion, version, result.error);
  }
  const first = work().page;
  assert.deepEqual(first.letters.map(({ version }) => version), [6, 5, 4, 3, 2]);
  assert.deepEqual(work({ ...read, beforeVersion: first.beforeVersion }).page.letters.map(({ version }) => version), [1]);
  const reissue = { ...issue, requestId: crypto.randomUUID(), previousVersion: 6, scope: "Property search" };
  db.exec("UPDATE applications SET revision = 2, submittedAt = NULL, reviewedAt = NULL, correctionNote = 'Check amount'");
  assert.equal(work().page.letters[0].status, "1003 changed");
  assert.match(work(reissue).error, /Review the current submitted/);
  db.exec("UPDATE applications SET submittedAt = '2026-11-09', reviewedAt = '2026-11-09', correctionNote = ''");
  assert.match(work(reissue).error, /1003 changed/);
  assert.equal(work({ ...reissue, applicationRevision: 2 }).issuedVersion, 7);
  db.prepare("UPDATE loans SET officerEmail = ?").run("new-owner@example.test");
  assert.ok(work({ type: "download", loanId, version: 7 }).error);
  assert.match(work({ type: "download", loanId, version: 7 }, { ...staff, email: "new-owner@example.test" }).pdf, /^%PDF/);
  db.exec("DELETE FROM loans");
  assert.equal(db.prepare("SELECT count(*) AS total FROM sample_preapproval_letters").get().total, 0);
});

test("the sample PDF escapes text and preserves Latin names", () => {
  const pdf = preapprovalLetterPdf({ names: ["José (Example) \\ Sample"], property: null, version: 2,
    issuedOn: "2026-11-09", expiresOn: "2026-12-09", issuer: "Demo Officer", brokerage: "Example Demo", amountCents: 36_000_000 });
  assert.match(pdf, /<4a6f73e920284578616d706c6529205c2053616d706c65>/);
  const offset = Number(/startxref\n(\d+)/.exec(pdf)[1]);
  assert.ok(pdf.slice(offset).startsWith("xref\n0 7\n"));
  assert.equal(Buffer.byteLength(pdf), pdf.length);
});

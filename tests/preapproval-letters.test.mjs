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
const { readSharedPreapprovalLetters, sharedPreapprovalDownload } = await import("../src/lib/preapproval-sharing.ts");
const { readIncomingLoanWorkPage } = await import("../src/lib/incoming-loan-work.ts");
const { readActionCounts } = await import("../src/lib/workspace-action-counts.ts");
const { currentPreapprovalWork } = await import("../src/lib/preapproval-work.ts");

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

test("daily sample letter work follows the exact version, current owner, decision and first share", (t) => {
  const { db, staff, loanId, issue, work } = fixture(t);
  const now = new Date("2026-11-10T04:59:59.999Z");
  const id = staff.brokerage.id;
  const admin = { ...staff, name: "Sample Admin", email: "admin@example.test", brokerage: { ...staff.brokerage, role: "Admin" } };
  const nextOfficer = { ...staff, name: "Second Officer", email: "second@example.test" };
  const processor = { ...staff, brokerage: { ...staff.brokerage, role: "Processor" } };
  const queue = (actor, view = "today", clock = now) =>
    readIncomingLoanWorkPage(db, { view }, actor, id, undefined, clock).items.filter(({ kind }) => kind.startsWith("preapproval-"));
  const actions = (actor) => readActionCounts(db, actor, id, now).today;
  const base = actions(staff);
  assert.equal(work(issue).issuedVersion, 1);
  assert.equal(queue(staff)[0].kind, "preapproval-share");
  assert.equal(actions(staff), base + 1);
  assert.equal(queue(nextOfficer).length, 0);
  assert.equal(queue(processor, "processing").length, 0);
  assert.ok(readIncomingLoanWorkPage(db, { view: "today" }, staff, crypto.randomUUID()).error);
  const config = { maxAmountCents: null, maxExpiryDays: 60, requireApproval: true };
  assert.equal(work({ type: "policySave", revision: 0, config }, admin).policy.revision, 1);
  assert.equal(queue(staff).length, 0);
  assert.equal(queue(admin)[0].kind, "preapproval-review");
  assert.equal(queue({ ...admin, email: staff.email }).length, 0);
  const review = { type: "reviewLetter", loanId, version: 1, revision: 1, decision: "Changes requested", note: "Use the revised amount." };
  assert.ok(work(review, admin).page);
  assert.equal(queue(admin).length, 0);
  assert.equal(queue(staff)[0].note, review.note);
  assert.equal(queue(staff)[0].kind, "preapproval-revision");
  assert.equal(currentPreapprovalWork(db, staff, loanId, now).revision, 1);
  db.prepare("UPDATE loans SET officerEmail = ? WHERE id = ?").run(nextOfficer.email, loanId);
  assert.equal(queue(staff).length, 0);
  assert.equal(queue(nextOfficer)[0].kind, "preapproval-revision");
  const replacement = { ...issue, previousVersion: 1, requestId: crypto.randomUUID(), amountCents: issue.amountCents - 100 };
  const preview = work({ ...replacement, type: "preview" }, nextOfficer).preview;
  assert.equal(work({ ...replacement, previewStamp: preview.stamp }, nextOfficer).issuedVersion, 2);
  assert.equal(queue(nextOfficer).length, 0);
  assert.equal(queue(admin)[0].revision, 2);
  assert.ok(work({ ...review, version: 2, decision: "Approved" }, admin).page);
  assert.equal(currentPreapprovalWork(db, admin, loanId, now), undefined);
  assert.equal(queue(nextOfficer)[0].kind, "preapproval-share");
  assert.equal(queue(nextOfficer, "today", new Date("2026-11-11T05:00:00Z")).length, 0);
  const state = work({ type: "read", loanId }, nextOfficer).page.sharing;
  const grant = { type: "publish", loanId, version: 2, audience: "Borrower", grantId: crypto.randomUUID(),
    previousGrantId: null, recipientStamp: state.audiences[0].recipient.stamp, confirmed: true };
  assert.ok(work(grant, nextOfficer).page);
  assert.equal(queue(nextOfficer).length, 0);
  assert.ok(work({ ...grant, type: "withdraw" }, nextOfficer).page);
  assert.equal(queue(nextOfficer).length, 0);
});

test("brokerage templates retain versions and issuance confirms the exact preview", (t) => {
  const { db, staff, issue, work, download } = fixture(t);
  const admin = { ...staff, email: "owner@example.test", brokerage: { ...staff.brokerage, role: "Admin" } };
  const id = crypto.randomUUID();
  const first = { title: "Fictional purchase letter", note: "Bring your fictional purchase details to the next conversation." };
  const publish = (revision, config = first, actor = admin) => work({ type: "templatePublish", id, revision, config }, actor);
  assert.match(publish(0, first, staff).error, /admins/);
  assert.match(publish(0, { ...first, note: "🏡" }).error, /Latin-script/);
  assert.equal(publish(0).templates[0].revision, 1);
  assert.equal(publish(0).templates[0].revision, 1);
  assert.deepEqual(work().page.templates, [{ id, title: first.title, revision: 1 }]);
  const preview = (revision, update = {}) => work({ ...issue, type: "preview", template: { id, revision }, ...update }).preview;
  const initial = preview(1);
  assert.equal(initial.template.note, first.note);
  assert.equal(initial.version, 1);
  assert.equal(initial.names[0], "José (Sample)");
  const input = (revision, stamp, update = {}) => work({ ...issue, template: { id, revision }, previewStamp: stamp, ...update });
  assert.match(input(1).error, /Preview the letter again/i);
  assert.match(input(1, initial.stamp, { amountCents: issue.amountCents - 100 }).error, /details changed/);
  assert.equal(db.prepare("SELECT count(*) AS total FROM sample_preapproval_letters").get().total, 0);
  const second = { ...first, note: "Please confirm the fictional closing schedule." };
  assert.equal(publish(1, second).templates[0].revision, 2);
  assert.match(input(1, initial.stamp).error, /template changed/);
  assert.match(publish(1, first).error, /template changed/);
  const updated = preview(2);
  assert.notEqual(updated.stamp, initial.stamp);
  assert.equal(input(2, updated.stamp).issuedVersion, 1);
  const issued = download(1).pdf;
  assert.ok(issued.includes(Buffer.from(second.note).toString("hex")));
  assert.ok(!issued.includes(Buffer.from(first.note).toString("hex")));
  assert.equal(work().page.letters[0].template.revision, 2);
  assert.ok(work().page.sharing.audiences.every(({ visible }) => !visible));
  const archive = { type: "templateArchive", id, revision: 2, archived: true };
  assert.equal(work(archive, admin).templates[0].archived, true);
  assert.equal(work(archive, admin).templates[0].revision, 3);
  assert.deepEqual(work({ type: "templateHistory", id }, admin).history.map(({ revision, archived, note }) => [revision, archived, note]),
    [[3, true, second.note], [2, false, second.note], [1, false, first.note]]);
  assert.equal(input(2, updated.stamp).issuedVersion, 1);
  assert.equal(download(1).pdf, issued);
  assert.equal(work().page.templates, undefined);
  assert.equal(work({ ...archive, revision: 3, archived: false }, admin).templates[0].revision, 4);
  assert.equal(db.prepare("SELECT count(*) AS total FROM sample_preapproval_letters").get().total, 1);
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

test("portal grants are versioned, independently withdrawn, and return the original PDF", (t) => {
  const { db, loanId, issue, work, download } = fixture(t);
  const borrower = "a".repeat(64);
  const realtor = "b".repeat(64);
  const clock = new Date("2026-11-10T04:59:59.999Z");
  insertContact(db, { id: "realtor", name: "Fictional Partner", role: "Realtor", phone: "", email: "partner@example.test" });
  db.prepare("INSERT INTO realtor_portals (realtorId, token, expiresAt) VALUES ('realtor', ?, '2099-01-01')").run(realtor);
  db.exec("UPDATE loans SET partnerId = 'realtor'");
  assert.equal(work(issue).issuedVersion, 1);
  const initial = work().page.sharing;
  assert.deepEqual(initial.audiences.map(({ visible }) => visible), [false, false]);
  const grant = (audience) => {
    const target = work().page.sharing.audiences.find((item) => item.audience === audience);
    return { type: "publish", loanId, version: work().page.latestVersion, audience,
      grantId: crypto.randomUUID(), previousGrantId: target.grantId, recipientStamp: target.recipient.stamp, confirmed: true };
  };
  const borrowerGrant = grant("Borrower");
  const realtorGrant = grant("Realtor");
  assert.ok(work({ ...borrowerGrant, confirmed: false }).error);
  assert.match(work({ ...realtorGrant, recipientStamp: "c".repeat(64) }).error, /recipient or portal link changed/);
  assert.ok(work(borrowerGrant).shareMessage);
  assert.ok(work(borrowerGrant).shareMessage);
  assert.ok(work(realtorGrant).shareMessage);
  const request = (token, audience, grantId, at = clock) => sharedPreapprovalDownload(db, { token, audience, grantId }, at);
  assert.equal(request(realtor, "Borrower", borrowerGrant.grantId).status, 404);
  assert.equal(request(borrower, "Realtor", realtorGrant.grantId).status, 404);
  assert.equal(request("c".repeat(64), "Realtor", realtorGrant.grantId).status, 404);
  assert.deepEqual(request(borrower, "Borrower", borrowerGrant.grantId).value, download(1));
  assert.deepEqual(request(realtor, "Realtor", realtorGrant.grantId).value, download(1));
  assert.deepEqual(request(realtor, "Realtor", realtorGrant.grantId).value, download(1));
  assert.deepEqual(work().page.sharing.audiences.map(({ firstDownloadedAt }) => firstDownloadedAt), [clock.toISOString(), clock.toISOString()]);
  assert.equal(db.prepare("SELECT count(*) AS total FROM activity WHERE text LIKE '%portal first requested sample preapproval%'").get().total, 2);
  assert.equal(db.prepare("SELECT count(*) AS total FROM activity WHERE text LIKE 'Shared sample letter%'").get().total, 2);

  const beforeExpiry = new Date("2026-11-11T04:59:59.999Z");
  const expired = new Date("2026-11-11T05:00:00.000Z");
  assert.ok(request(realtor, "Realtor", realtorGrant.grantId, beforeExpiry).value);
  assert.equal(request(realtor, "Realtor", realtorGrant.grantId, expired).status, 404);
  const withdraw = { ...borrowerGrant, type: "withdraw" };
  assert.ok(work(withdraw).shareMessage);
  assert.ok(work(withdraw).shareMessage);
  assert.equal(request(borrower, "Borrower", borrowerGrant.grantId).status, 404);
  assert.ok(request(realtor, "Realtor", realtorGrant.grantId).value);
  const next = work({ ...issue, requestId: crypto.randomUUID(), previousVersion: 1, amountCents: 34_000_000 });
  assert.equal(next.issuedVersion, 2);
  assert.deepEqual(next.page.sharing.audiences.map(({ visible }) => visible), [false, false]);
  assert.equal(request(realtor, "Realtor", realtorGrant.grantId).status, 404);
  const newRealtor = grant("Realtor");
  assert.ok(work(newRealtor).shareMessage);
  assert.equal(readSharedPreapprovalLetters(db, [loanId], "Realtor", realtor, clock.toISOString()).get(loanId).version, 2);
  db.exec("UPDATE applications SET revision = revision + 1, submittedAt = NULL, reviewedAt = NULL, correctionNote = 'Correction required'");
  assert.equal(request(realtor, "Realtor", newRealtor.grantId).status, 404);
  assert.equal(readSharedPreapprovalLetters(db, [loanId], "Realtor", realtor, clock.toISOString()).size, 0);
  assert.ok(download(1).pdf);
});

test("recipient changes require explicit publication against the new portal link", (t) => {
  const { db, loanId, issue, work } = fixture(t);
  const old = "b".repeat(64);
  const renewed = "c".repeat(64);
  const clock = new Date("2026-11-10T04:59:59.999Z");
  insertContact(db, { id: "realtor", name: "Fictional Partner", role: "Realtor", phone: "", email: "partner@example.test" });
  db.prepare("INSERT INTO realtor_portals (realtorId, token, expiresAt) VALUES ('realtor', ?, '2099-01-01')").run(old);
  db.exec("UPDATE loans SET partnerId = 'realtor'");
  assert.equal(work(issue).issuedVersion, 1);
  const target = () => work().page.sharing.audiences.find(({ audience }) => audience === "Realtor");
  const publish = () => ({ type: "publish", loanId, version: 1, audience: "Realtor",
    grantId: crypto.randomUUID(), previousGrantId: target().grantId, recipientStamp: target().recipient.stamp, confirmed: true });
  const first = publish();
  assert.ok(work(first).shareMessage);
  const check = (token, grantId) => sharedPreapprovalDownload(db, { token, audience: "Realtor", grantId }, clock);
  assert.ok(check(old, first.grantId).value);
  db.prepare("UPDATE realtor_portals SET token = ?").run(renewed);
  assert.equal(check(old, first.grantId).status, 404);
  assert.equal(check(renewed, first.grantId).status, 404);
  assert.match(work(first).error, /recipient or portal link changed/);
  const second = publish();
  assert.ok(work(second).shareMessage);
  assert.ok(check(renewed, second.grantId).value);
  db.exec("UPDATE loans SET partnerId = NULL; UPDATE loans SET partnerId = 'realtor';");
  assert.equal(check(renewed, second.grantId).status, 404);
  assert.equal(target().visible, false);
  db.exec("DELETE FROM loans");
  assert.equal(db.prepare("SELECT count(*) AS total FROM sample_preapproval_shares").get().total, 0);
});

test("brokerage policy enforces limits and independent approval of the exact current letter", (t) => {
  const { db, staff, loanId, issue, work } = fixture(t);
  const admin = { ...staff, name: "Sample Admin", email: "admin@example.test", brokerage: { ...staff.brokerage, role: "Admin" } };
  const secondAdmin = { ...admin, email: "second-admin@example.test" };
  const config = { maxAmountCents: 34_000_000, maxExpiryDays: 10, requireApproval: true };
  const settings = { type: "policySave", revision: 0, config };
  const readPolicy = { type: "policyRead" };
  assert.match(work(settings).error, /Only brokerage admins/);
  assert.match(work(readPolicy).error, /Only brokerage admins/);
  assert.equal(work(settings, admin).policy.revision, 1);
  assert.equal(work(settings, admin).policy.revision, 1);
  assert.match(work({ ...settings, config: { ...config, maxExpiryDays: 8 } }, admin).error, /policy changed/);
  assert.equal(work().page.issue.amountCents, 34_000_000);
  assert.equal(work().page.issue.latestExpiry, "2026-11-19");
  assert.match(work(issue).error, /brokerage limit/);
  const terms = { ...issue, amountCents: 34_000_000 };
  assert.match(work({ ...terms, expiresOn: "2026-11-20" }).error, /1 to 10/);
  const preview = work({ ...terms, type: "preview" }).preview;
  assert.equal(preview.requiresApproval, true);
  assert.match(work(terms).error, /Preview the letter again/);
  assert.equal(work({ ...terms, previewStamp: preview.stamp }).issuedVersion, 1);
  const initial = work().page.sharing;
  assert.equal(initial.canPublish, false);
  assert.equal(initial.review.canDecide, false);
  const recipient = initial.audiences[0].recipient;
  const grant = { type: "publish", loanId, version: 1, audience: "Borrower", grantId: crypto.randomUUID(),
    previousGrantId: null, recipientStamp: recipient.stamp, confirmed: true };
  assert.match(work(grant).error, /independent brokerage admin/);
  assert.equal(work({ ...readPolicy, search: "sample officer" }, admin).pending[0].loanId, loanId);
  assert.equal(work({ ...readPolicy, search: "no matching name" }, admin).pending.length, 0);
  const review = { type: "reviewLetter", loanId, version: 1, revision: 1, decision: "Approved", note: "Verified the exact letter." };
  assert.match(work(review).error, /Only brokerage admins/);
  assert.match(work({ ...review, revision: 0 }, admin).error, /policy changed/);
  assert.match(work({ ...review, decision: "Changes requested", note: "" }, admin).error, /Add a reason/);
  assert.match(work(review, { ...admin, email: staff.email }).error, /another brokerage admin/);
  assert.equal(work(review, admin).page.sharing.review.receipt.note, review.note);
  assert.equal(work(review, admin).page.sharing.canPublish, true);
  assert.match(work(review, secondAdmin).error, /already has a decision/);
  assert.equal(work(readPolicy, admin).pending.length, 0);
  assert.ok(work(grant).shareMessage);

  const tighten = { ...settings, revision: 1, config: { ...config, maxExpiryDays: 8 } };
  const replacement = { ...terms, requestId: crypto.randomUUID(), previousVersion: 1 };
  const oldPreview = work({ ...replacement, type: "preview" }).preview;
  assert.equal(work(tighten, admin).policy.revision, 2);
  assert.equal(work().page.sharing.canPublish, false);
  assert.equal(work().page.sharing.audiences[0].visible, true);
  assert.ok(work(grant).shareMessage);
  assert.ok(readSharedPreapprovalLetters(db, [loanId], "Borrower", "a".repeat(64), "2026-11-10T04:59:59.999Z").get(loanId));
  assert.match(work({ ...replacement, previewStamp: oldPreview.stamp }).error, /Preview the letter again/);
  assert.match(work(review, admin).error, /policy changed/);
  const returned = { ...review, revision: 2, decision: "Changes requested", note: "Use the revised closing date." };
  assert.equal(work(returned, admin).page.sharing.review.receipt.decision, "Changes requested");
  assert.equal(sharedPreapprovalDownload(db, { token: "a".repeat(64), audience: "Borrower", grantId: grant.grantId },
    new Date("2026-11-10T04:59:59.999Z")).status, 404);
  assert.equal(work(readPolicy, admin).pending.length, 0);
  assert.equal(work({ ...settings, revision: 2, config: { ...config, requireApproval: false } }, admin).policy.revision, 3);
  assert.equal(work().page.sharing.canPublish, false);
  assert.equal(work().page.sharing.review.receipt.note, returned.note);
  const newPreview = work({ ...replacement, type: "preview" }).preview;
  assert.equal(work({ ...replacement, previewStamp: newPreview.stamp }).issuedVersion, 2);
  assert.equal(work().page.sharing.canPublish, true);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

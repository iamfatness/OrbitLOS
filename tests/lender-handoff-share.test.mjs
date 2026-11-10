import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { blankApplication, sampleApplication } = await import("../src/lib/application-model.ts");
const { newPortalAccessCode, portalToken } = await import("../src/lib/brokerage-model.ts");
const { confirmLenderPackagePdf, lenderPackageAccess, lenderShareWork } = await import("../src/lib/lender-handoff-share.ts");
const { loadProtectedPilotScenario } = await import("../src/lib/pilot.ts");
const { hasPreparedLenderExport, prepareLenderExport } = await import("../src/lib/lender-export.ts");
const { lenderExportIssues } = await import("../src/lib/lender-export-profile.ts");
const { lenderDetailsSchema } = await import("../src/lib/urla.ts");
const { prepareUwmXmlUpload, uwmXmlUploadSuccessStatus } = await import("../src/lib/uwm-origination-blob.ts");

test("fictional wholesale checks gate both export paths and pin the exact XML and profile", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const now = "2026-11-10T17:00:00.000Z";
  const loanId = randomUUID();
  const brokerageId = randomUUID();
  const officer = { name: "Fictional Officer", email: "officer@example.test", brokerage: { id: brokerageId, role: "LO", pilot: true } };
  insertContact(db, { id: "borrower", name: "Fictional Borrower", email: "", phone: "", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId: "borrower", partnerId: null, officer: officer.name, officerEmail: officer.email,
    stage: "Application", stageSince: now, address: "", amount: 360000, purpose: "Purchase" });
  const draft = { ...sampleApplication({ ...blankApplication(), borrowerName: "Fictional Borrower" }), confirmedDemo: true };
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, revision, updatedAt, submittedAt, reviewedAt)
    VALUES (?, ?, '2026-11-20T18:00:00.000Z', ?, 3, ?, ?, ?)`).run(loanId, portalToken(brokerageId), JSON.stringify(draft), now, now, now);
  const names = [{ first: "Fictional", middle: "", last: "Borrower", suffix: "" }];
  const profile = "fictional-wholesale-v1";
  const input = { type: "exportReviewedApplication", loanId, revision: 3, lenderRevision: 0, eventId: randomUUID(), names, profile };
  const work = (value) => lenderShareWork(db, value, officer, brokerageId, undefined, new Date(now));
  const share = { type: "create", loanId, revision: 3, lenderRevision: 0, names, profile, shareId: randomUUID(),
    token: portalToken(brokerageId), code: newPortalAccessCode(), hours: 1, recipient: "Fictional Wholesale",
    confirmedFictional: true, documents: [] };
  assert.match(prepareLenderExport(db, input, officer, now).error, /Loan originator name/);
  assert.match((await work(share)).error, /Loan originator name/);
  assert.equal(db.prepare("SELECT count(*) AS count FROM application_handoff_events").get().count, 0);
  assert.ok(prepareLenderExport(db, { ...input, profile: undefined }, officer, now).xml);
  assert.equal(hasPreparedLenderExport(db, input), false);

  const details = lenderDetailsSchema.parse({
    originator: { fields: { originator: officer.name, originatorNmls: "999991", organization: "Fictional Brokerage", organizationNmls: "999992" } },
    supplement: { fields: { mortgage: "Conventional", rate: "6.250", term: "360", mortgageLien: "First lien",
      amortization: "Fixed rate", purchasePrice: "450000", loanAmount: draft.loanAmount } },
  });
  assert.deepEqual(lenderExportIssues(draft, details, names, profile), []);
  const pending = structuredClone(draft);
  pending.urla.property.fields.propertyPending = "Yes";
  assert.match(lenderExportIssues(pending, details, names, profile).at(-1).label, /pending property/);
  const refinance = { ...draft, purpose: "Refinance" };
  const refiIssues = lenderExportIssues(refinance, details, names, profile);
  assert.ok(refiIssues.some(({ field }) => field === "refinance"));
  assert.ok(!refiIssues.some(({ field }) => field === "purchasePrice"));
  assert.deepEqual(lenderExportIssues(draft, { ...details, supplement: { ...details.supplement,
    fields: { ...details.supplement.fields, loanAmount: "99999", rate: "0", term: "999" } } }, names, profile).map(({ field }) => field),
  ["rate", "term", "loanAmount"]);

  db.prepare("INSERT INTO application_lender_details (loanId, details, revision) VALUES (?, ?, 1)").run(loanId, JSON.stringify(details));
  assert.match(prepareLenderExport(db, input, officer, now).error, /Lender details changed/);
  const current = { ...input, lenderRevision: 1, eventId: randomUUID() };
  const { xml } = prepareLenderExport(db, current, officer, now);
  assert.match(xml, /<SalesContractAmount>450000<\/SalesContractAmount>/);
  assert.match(xml, /<NoteRatePercent>6.250<\/NoteRatePercent>/);
  assert.match(xml, /<LicenseIdentifier>999991<\/LicenseIdentifier>/);
  assert.deepEqual(prepareLenderExport(db, current, officer, now), { xml });
  assert.match(prepareLenderExport(db, { ...current, names: [{ ...names[0], first: "Different" }] }, officer, now).error, /new download/);
  assert.equal(hasPreparedLenderExport(db, current), true);
  assert.equal(hasPreparedLenderExport(db, { ...current, profile: "basic" }), false);
  const exportEvent = db.prepare("SELECT exportProfile, exportDigest FROM application_handoff_events WHERE activityId = ?").get(current.eventId);
  assert.equal(exportEvent.exportProfile, profile);
  assert.equal(exportEvent.exportDigest, createHash("sha256").update(xml).digest("hex"));
  const storageOrigin = "https://uwm-fixture.invalid";
  const signedUrl = `${storageOrigin}/synthetic/loan.xml?sig=fictional`;
  const upload = { storageOrigin, signedUrl, bytes: new TextEncoder().encode(xml), digest: exportEvent.exportDigest };
  const network = t.mock.method(globalThis, "fetch", () => assert.fail("Fixture preparation must never send a request"));
  const request = prepareUwmXmlUpload(upload);
  assert.deepEqual([request.method, request.url, request.redirect, request.headers.get("x-ms-blob-type"),
    request.headers.get("authorization"), uwmXmlUploadSuccessStatus], ["PUT", signedUrl, "manual", "BlockBlob", null, 201]);
  assert.deepEqual(new Uint8Array(await request.arrayBuffer()), upload.bytes);
  assert.throws(() => prepareUwmXmlUpload({ ...upload, bytes: new TextEncoder().encode(`${xml} `) }), /do not match/);
  for (const url of [`${storageOrigin}.example.org/file.xml?sig=fictional`, `${storageOrigin}/file.xml`, `${storageOrigin}/file.xml?unsigned=true`,
    `${signedUrl}&sig=another`, `${signedUrl}#fragment`, "https://login@uwm-fixture.invalid/file.xml?sig=fictional", signedUrl.replace("https:", "http:")]) {
    assert.throws(() => prepareUwmXmlUpload({ ...upload, signedUrl: url }), /approved storage origin/);
  }
  assert.equal(network.mock.callCount(), 0);

  const packagePage = await work({ ...share, lenderRevision: 1 });
  assert.equal(packagePage.createdId, share.shareId, packagePage.error);
  assert.match(packagePage.shares[0].files[0].label, /Fictional Wholesale/);
  const download = { type: "download", slot: 0, token: share.token, code: share.code };
  assert.equal(lenderPackageAccess(db, download, now).xml, xml);
  db.prepare("UPDATE lender_package_links SET xml = ? WHERE id = ?").run(`${xml} `, share.shareId);
  assert.equal(lenderPackageAccess(db, download, now).status, 404);
  assert.equal(db.prepare("SELECT downloads FROM lender_package_files WHERE shareId = ? AND slot = 0").get(share.shareId).downloads, 1);
  db.prepare("UPDATE lender_package_links SET xml = ? WHERE id = ?").run(xml, share.shareId);
  db.prepare("UPDATE application_handoff_events SET exportDigest = NULL WHERE activityId = ?").run(share.shareId);
  assert.equal(lenderPackageAccess(db, download, now).xml, xml);
  db.prepare("UPDATE application_handoff_events SET applicationRevision = applicationRevision - 1 WHERE activityId = ?").run(share.shareId);
  assert.equal(lenderPackageAccess(db, download, now).status, 404);
});

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
  const code = newPortalAccessCode();
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
  const replace = { ...create, replacesId: create.shareId, shareId: randomUUID(), token: portalToken(brokerageId), code: newPortalAccessCode() };
  assert.match((await work(replace, async () => assert.fail("A current link must stay available"))).error, /previous lender package changed/);
  const stored = db.prepare("SELECT tokenHash, codeHash, requestHash FROM lender_package_links").get();
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(stored.tokenHash, hash(token));
  assert.equal(stored.codeHash, hash(code));
  assert.ok(!JSON.stringify(stored).includes(token) && !JSON.stringify(stored).includes(code));
  const read = { type: "read", token, code };
  assert.equal(lenderPackageAccess(db, { ...read, code: newPortalAccessCode() }, at).status, 404);
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
  assert.match((await work(replace, async () => false)).error, /protect the old link/);
  assert.deepEqual((await work({ type: "read", loanId })).shares, [status]);

  const revoke = { type: "revoke", loanId, shareId: create.shareId };
  assert.match((await work(revoke, async () => false)).error, /protect/);
  assert.equal((await work(revoke, async (links) => {
    assert.deepEqual(links, [{ tokenHash: hash(token), expiresAt }]);
    return true;
  })).shares[0].status, "Revoked");
  assert.match((await work(create)).error, /new package/);
  assert.equal(lenderPackageAccess(db, read, at).status, 404);

  const interim = { ...create, shareId: randomUUID(), token: portalToken(brokerageId), code: newPortalAccessCode() };
  assert.equal((await work(interim)).createdId, interim.shareId);
  const interimPdf = { ...getPdf, token: interim.token, code: interim.code };
  const previousObject = lenderPackageAccess(db, interimPdf, at).objectId;
  assert.ok(previousObject);
  assert.equal(confirmLenderPackagePdf(db, interimPdf, previousObject, at), true);
  const updatedObject = randomUUID();
  db.prepare("UPDATE document_files SET objectId = ? WHERE requestId = ?").run(updatedObject, sample.id);
  db.prepare("UPDATE document_requests SET revision = 3 WHERE id = ?").run(sample.id);
  db.prepare("UPDATE applications SET revision = 4 WHERE loanId = ?").run(loanId);
  const replacement = { ...create, shareId: randomUUID(), token: portalToken(brokerageId), code: newPortalAccessCode(),
    replacesId: interim.shareId, revision: 4, documents: [{ id: sample.id, revision: 3 }] };
  assert.match((await work({ ...replacement, documents: interim.documents })).error, /evidence changed/);
  assert.equal(confirmLenderPackagePdf(db, interimPdf, previousObject, at), false);
  assert.equal((await work(replacement)).createdId, replacement.shareId);
  const replacementPdf = { ...getPdf, token: replacement.token, code: replacement.code };
  const newPdf = lenderPackageAccess(db, replacementPdf, at);
  assert.equal(newPdf.objectId, updatedObject);
  assert.match(newPdf.filename, /^orbit-fictional-evidence-r4-[0-9a-f]{12}-1\.pdf$/);
  assert.equal(confirmLenderPackagePdf(db, replacementPdf, previousObject, at), false);
  assert.equal(confirmLenderPackagePdf(db, replacementPdf, updatedObject, at), true);
  assert.equal(lenderPackageAccess(db, interimPdf, at).status, 404);
  const afterReplacement = (await work({ type: "read", loanId })).shares;
  assert.deepEqual(afterReplacement.slice(0, 2).map(({ status, applicationRevision, files }) =>
    [status, applicationRevision, files[1].downloads]), [["Available", 4, 1], ["Revoked", 3, 1]]);
  const previousId = randomUUID();
  db.prepare("INSERT INTO pilot_scenario VALUES (1, ?, ?, ?, ?, ?, 0)").run(previousId, "fictional-realtor", loanId, at, officer.email);
  const admin = { ...officer, brokerage: { ...officer.brokerage, role: "Admin" } };
  const reset = { type: "loadPilotScenario", id: randomUUID(), previousId, officerEmail: officer.email, presenter: false };
  const result = await loadProtectedPilotScenario(db, admin, reset, officer, async (links) => {
    assert.deepEqual(links.filter((link) => "tokenHash" in link), [{ tokenHash: hash(replacement.token), expiresAt }]);
    return true;
  }, new Date(at));
  assert.ok(result.message, result.error);
  assert.equal(lenderPackageAccess(db, replacementPdf, at).status, 404);
});

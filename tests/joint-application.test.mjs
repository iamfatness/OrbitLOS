import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { applicationIssues, applicationSteps, sampleApplication } = await import("../src/lib/application-model.ts");
const { borrowerCommandResult, coBorrowerCommandResult, getApplication, staffApplications, startApplication } = await import("../src/lib/applications.ts");
const { coBorrowerReviewStep, primaryJointDraft, sampleCoBorrower } = await import("../src/lib/joint-application-model.ts");
const { jointApplication } = await import("../src/lib/joint-application.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { readEditableLoan } = await import("../src/lib/editable-loan.ts");
const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { beginDocumentUpload, finishDocumentUpload, failDocumentUpload, issueDocumentCode, verifyDocumentCode } = await import("../src/lib/document-files.ts");
const { checkDocumentReminders, documentReminderPage } = await import("../src/lib/document-reminder-runs.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const brokerage = { id: crypto.randomUUID(), name: "Fictional Joint Brokerage", role: "LO", pilot: true };
  const officer = { name: "Fictional Owner", email: "joint-owner@example.test", brokerage };
  const processor = { name: "Fictional Processor", email: "processor@example.test", brokerage: { ...brokerage, role: "Processor" } };
  const outsider = { ...officer, email: "different-officer@example.test" };
  const loanId = crypto.randomUUID();
  const now = new Date().toISOString();
  insertContact(db, { id: loanId, name: "Fictional Primary", email: "primary-private@example.test", role: "Borrower", phone: "" });
  insertLoan(db, { id: loanId, contactId: loanId, partnerId: null, officer: officer.name, officerEmail: officer.email,
    amount: 0, address: "", purpose: "Purchase", stage: "Lead", stageSince: now });
  startApplication(db, loanId, now, brokerage.id);
  const primaryToken = getApplication(db, loanId).token;
  const primary = (input = { type: "read" }) => borrowerCommandResult(db, { token: primaryToken, ...input }, true, true);
  const co = (input = { type: "read" }, token = jointApplication(db, loanId)?.token) => coBorrowerCommandResult(db, { token, ...input }, true);
  const run = (type, input = {}, actor = officer, options) => executeCommand(db, { type, loanId, ...input }, actor, undefined, [], options);
  const enable = (actor = officer) => run("enableJointApplication", { revision: 0 }, actor);
  function primaryWrite(draft, revision, type = "submit") {
    return { type, revision, draft, step: applicationSteps.length - 1 };
  }
  function primarySample(current) {
    const draft = { ...primaryJointDraft(sampleApplication(current)), confirmedDemo: true };
    draft.urla.primary.joint.fields.initials = "FP";
    draft.urla.primary.work.groups.jobs[0].employer = "Private fictional primary employer";
    return draft;
  }
  function coSample(current) {
    const draft = sampleCoBorrower(current);
    draft.work.groups.jobs[0].employer = "Private fictional co-borrower employer";
    return draft;
  }
  const coWrite = (draft, revision, type = "submit") => ({ type, revision, draft, step: coBorrowerReviewStep, confirmedDemo: true });
  const count = (table, filter = "") => db.prepare(`SELECT count(*) AS total FROM ${table} WHERE loanId = ? ${filter}`).get(loanId).total;
  return { db, officer, processor, outsider, brokerage, loanId, now, primaryToken, primary, co, run, enable, primaryWrite, primarySample, coSample, coWrite, count };
}

test("joint borrower links isolate drafts and finalize only after both portions arrive", async (t) => {
  const f = fixture(t);
  const old = f.primary().application;
  assert.ok((await f.enable(f.outsider)).error);
  assert.ok((await f.enable(f.processor)).error);
  assert.equal((await f.enable()).message, "Separate borrower links are ready.");
  assert.equal((await f.enable()).message, "Separate borrower links are ready.");
  const coToken = jointApplication(f.db, f.loanId).token;
  assert.equal(f.primary({ type: "read", token: coToken }).status, 404);
  assert.equal(f.co({ type: "read" }, f.primaryToken).status, 404);
  assert.equal(f.primary(f.primaryWrite(sampleApplication(old.draft), old.revision, "save")).status, 409);
  const independent = f.primary().application;
  assert.equal(independent.separateJoint, true);
  const primaryDraft = f.primarySample(independent.draft);
  const initial = f.co().value;
  assert.doesNotMatch(JSON.stringify(initial), /Fictional Primary|primary-private/);
  const coDraft = f.coSample(initial.draft);
  const partial = f.co(f.coWrite(coDraft, initial.revision, "save"));
  assert.deepEqual(f.co().value, partial.value);
  assert.doesNotMatch(JSON.stringify(f.primary()), /Private fictional co-borrower employer|joint-borrower@example.test/);
  assert.equal(f.co(f.coWrite(coDraft, initial.revision)).status, 409);

  const forged = { ...primaryDraft, coBorrowerName: "Injected primary answer",
    urla: { ...primaryDraft.urla, additional: [coDraft] } };
  const submitPrimary = f.primaryWrite(forged, independent.revision);
  const pending = f.primary(submitPrimary).application;
  assert.ok(pending.submittedAt);
  assert.equal(pending.loanStatus, null);
  assert.equal(f.primary({ type: "status" }).statusView.kind, "joint-waiting");
  assert.equal(f.primary(submitPrimary).application.loanStatus, null);
  assert.equal(f.count("application_versions"), 0);
  assert.equal(f.count("tasks", "AND id LIKE 'application-follow-up:%'"), 0);
  assert.ok((await f.run("reviewApplication", { revision: pending.revision })).error);
  assert.equal(f.co().value.complete, false);
  assert.doesNotMatch(JSON.stringify(f.co()), /primary-private|Private fictional primary employer/);

  const submitCo = f.coWrite(coDraft, partial.value.revision);
  f.db.exec("CREATE TRIGGER interrupt_joint BEFORE INSERT ON application_versions BEGIN SELECT RAISE(ABORT, 'joint fixture interruption'); END");
  assert.throws(() => f.co(submitCo), /joint fixture interruption/);
  assert.equal(f.co().value.submittedAt, null);
  assert.equal(f.count("application_versions"), 0);
  f.db.exec("DROP TRIGGER interrupt_joint");
  assert.equal(f.co(submitCo).value.complete, true);
  assert.equal(f.co(submitCo).value.complete, true);
  assert.equal(f.count("application_versions"), 1);
  assert.equal(f.count("tasks", "AND id LIKE 'application-follow-up:%'"), 1);
  const primaryStatus = f.primary(submitPrimary).application;
  assert.ok(primaryStatus.loanStatus);
  assert.equal(primaryStatus.draft.urla.additional.length, 0);
  assert.doesNotMatch(JSON.stringify(primaryStatus), /Private fictional co-borrower employer|joint-borrower@example.test|Injected primary answer/);
  const [combined] = staffApplications(f.db, f.loanId);
  assert.equal(combined.draft.urla.additional[0].work.groups.jobs[0].employer, "Private fictional co-borrower employer");
  assert.deepEqual(applicationIssues(combined.draft), []);
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("the co-borrower can submit first, revoke and replace, then correct only their portion", async (t) => {
  const f = fixture(t);
  await f.enable();
  const link = jointApplication(f.db, f.loanId);
  const coDraft = f.coSample(f.co().value.draft);
  assert.equal(f.co(f.coWrite(coDraft, 0)).value.complete, false);
  assert.equal(f.primary({ type: "status" }).statusView.kind, "resume");
  assert.equal(f.count("application_versions"), 0);

  let protectedLinks;
  const protectPilotLinks = async (links) => { protectedLinks = links; return true; };
  assert.ok((await f.run("revokeJointLink", { token: link.token }, f.outsider, { protectPilotLinks })).error);
  assert.ok((await f.run("revokeJointLink", { token: link.token }, f.officer, { protectPilotLinks })).message);
  assert.deepEqual(protectedLinks, [{ token: link.token, expiresAt: link.expiresAt }]);
  assert.equal(f.co({ type: "read" }, link.token).status, 404);
  assert.ok(f.primary().application);
  assert.ok((await f.run("replaceJointLink", { token: link.token })).message);
  const replacement = jointApplication(f.db, f.loanId);
  assert.notEqual(replacement.token, link.token);
  assert.ok(f.co().value.submittedAt);
  assert.equal(f.co().value.draft.identity.fields.name, coDraft.identity.fields.name);

  const primary = f.primary().application;
  assert.ok(f.primary(f.primaryWrite(f.primarySample(primary.draft), primary.revision)).application.loanStatus);
  const [before] = staffApplications(f.db, f.loanId);
  const note = "Private fictional correction for the co-borrower only.";
  assert.ok((await f.run("requestApplicationCorrection", { revision: before.revision, recipient: "Co-borrower", note })).message);
  assert.equal(f.primary({ type: "status" }).statusView.kind, "joint-waiting");
  assert.doesNotMatch(JSON.stringify(f.primary()), /Private fictional correction|joint-borrower@example.test/);
  const correction = f.co().value;
  assert.equal(correction.correctionNote, note);
  assert.equal(correction.confirmedDemo, false);
  assert.equal(correction.submittedAt, null);
  const revised = { ...coDraft, identity: { ...coDraft.identity, fields: { ...coDraft.identity.fields, cell: "248-555-0196" } } };
  assert.equal(f.co(f.coWrite(revised, correction.revision)).value.complete, true);
  const [after] = staffApplications(f.db, f.loanId);
  assert.deepEqual(after.draft.urla.primary, before.draft.urla.primary);
  assert.equal(after.draft.urla.additional[0].identity.fields.cell, "248-555-0196");
  assert.equal(after.versions.length, 2);
  assert.equal(after.reviewedAt, null);
  f.db.prepare(`INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision)
    VALUES (?, ?, ?, 'Assigned', '', ?, 1)`).run(f.loanId, f.processor.email, f.processor.name, f.now);
  assert.equal(readEditableLoan(f.db, f.loanId, f.processor, f.brokerage.id).applications[0].joint.token, undefined);
  assert.ok(readEditableLoan(f.db, f.loanId, f.outsider, f.brokerage.id).error);
});

test("same-kind evidence, upload sessions, and replacement notes stay with each borrower", async (t) => {
  const f = fixture(t);
  const request = (recipient, instructions) => f.run("requestDocument", { kind: "Bank statement", recipient, instructions, dueOn: "2026-11-05" });
  assert.ok((await request("Co-borrower", "Co-borrower sample only")).error);
  await f.enable();
  const primary = f.primary().application;
  const co = f.co().value;
  assert.ok((await request(undefined, "Primary sample only")).message);
  assert.ok((await request("Co-borrower", "Co-borrower sample only")).message);
  assert.ok((await request("Co-borrower", "Duplicate")).error);
  assert.equal(f.co().value.documents, undefined);
  f.primary(f.primaryWrite(f.primarySample(primary.draft), primary.revision));
  assert.equal(f.co().value.documents, undefined);
  const coToken = jointApplication(f.db, f.loanId).token;
  assert.equal(issueDocumentCode(f.db, coToken, coToken, "mock").status, 404);
  assert.ok(f.co(f.coWrite(f.coSample(co.draft), co.revision)).value.complete);
  const [primaryRequest] = f.primary({ type: "status" }).statusView.loanStatus.documents;
  const [coRequest] = f.co().value.documents;
  assert.equal(primaryRequest.instructions, "Primary sample only");
  assert.equal(coRequest.instructions, "Co-borrower sample only");
  assert.notEqual(primaryRequest.id, coRequest.id);
  const sample = ({ id, revision }) => ({ type: "attachSample", requestId: id, revision, statusOnly: true });
  assert.equal(f.primary(sample(coRequest)).status, 404);
  assert.equal(f.co(sample(primaryRequest)).status, 404);
  const now = Date.now();
  const verify = (token) => {
    const { code } = issueDocumentCode(f.db, token, token, "mock", now);
    assert.match(code, /^\d{6}$/);
    const { session } = verifyDocumentCode(f.db, token, code, token, "mock", now + 1);
    assert.ok(session);
    return session;
  };
  const primarySession = verify(f.primaryToken);
  const coSession = verify(coToken);
  assert.notEqual(primarySession, coSession);
  assert.equal(issueDocumentCode(f.db, coToken, "unused", "live", now).status, 404);
  const access = (token, session, item) => ({ token, session, requestId: item.id, revision: item.revision, mode: "mock" });
  assert.equal(beginDocumentUpload(f.db, access(coToken, primarySession, coRequest), now + 2).status, 401);
  assert.equal(beginDocumentUpload(f.db, access(coToken, coSession, primaryRequest), now + 2).status, 404);
  assert.equal(beginDocumentUpload(f.db, access(f.primaryToken, primarySession, coRequest), now + 2).status, 404);
  const primaryUpload = access(f.primaryToken, primarySession, primaryRequest);
  const primaryLease = beginDocumentUpload(f.db, primaryUpload, now + 3);
  assert.ok(finishDocumentUpload(f.db, primaryUpload, primaryLease.objectId, now + 4).received);
  const coUpload = access(coToken, coSession, coRequest);
  const lease = beginDocumentUpload(f.db, coUpload, now + 3);
  assert.ok(finishDocumentUpload(f.db, coUpload, lease.objectId, now + 4).received);
  const coReceived = f.co().value.documents[0];
  const replacementNote = "Fictional co-borrower-only replacement note";
  assert.ok((await f.run("reviewDocument", { requestId: coReceived.id, revision: coReceived.revision, decision: "Needs replacement",
    replacementNote, dueOn: "2026-11-05" })).message);
  assert.equal(f.co().value.documents[0].replacementNote, replacementNote);
  assert.doesNotMatch(JSON.stringify(f.primary()), /co-borrower-only replacement/);
  const replacementUpload = access(coToken, coSession, f.co().value.documents[0]);
  const replacementLease = beginDocumentUpload(f.db, replacementUpload, now + 1_100);
  assert.ok(replacementLease.objectId);
  assert.ok((await f.run("revokeJointLink", { token: coToken })).message);
  assert.equal(finishDocumentUpload(f.db, replacementUpload, replacementLease.objectId, now + 1_101).status, 404);
  failDocumentUpload(f.db, coRequest.id, replacementLease.objectId);
  assert.equal(f.primary({ type: "status" }).statusView.loanStatus.documents[0].status, "Received");
  assert.equal(f.co({ type: "read" }, coToken).status, 404);
  assert.ok((await f.run("replaceJointLink", { token: coToken })).message);
  const updatedToken = jointApplication(f.db, f.loanId).token;
  assert.equal(f.co().value.documents[0].status, "Needs replacement");
  assert.equal(beginDocumentUpload(f.db, access(updatedToken, coSession, f.co().value.documents[0]), now + 1_102).status, 401);
});

test("legacy upload access survives migration and co-borrower reminders follow their own link", async (t) => {
  const f = fixture(t);
  await f.enable();
  const primary = f.primary().application;
  const co = f.co().value;
  f.co(f.coWrite(f.coSample(co.draft), co.revision));
  f.primary(f.primaryWrite(f.primarySample(primary.draft), primary.revision));
  const now = Date.now();
  const { code } = issueDocumentCode(f.db, f.primaryToken, f.primaryToken, "mock", now);
  const { session } = verifyDocumentCode(f.db, f.primaryToken, code, f.primaryToken, "mock", now + 1);
  const columns = "loanId, tokenHash, email, codeHash, codeUntil, sendWindow, sendCount, sentAt, attempts, sessionHash, sessionUntil";
  f.db.exec(`ALTER TABLE borrower_upload_access RENAME TO current_access;
    CREATE TABLE borrower_upload_access (
      loanId TEXT PRIMARY KEY REFERENCES applications(loanId) ON DELETE CASCADE, tokenHash TEXT NOT NULL, email TEXT NOT NULL,
      codeHash TEXT, codeUntil INTEGER NOT NULL, sendWindow INTEGER NOT NULL, sendCount INTEGER NOT NULL, sentAt INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, sessionHash TEXT, sessionUntil INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO borrower_upload_access (${columns}) SELECT ${columns} FROM current_access;
    DROP TABLE current_access;`);
  initializeStore(f.db, false);
  const add = (recipient) => f.run("requestDocument", { kind: "Pay stub", recipient, instructions: "", dueOn: "2026-11-01" });
  assert.ok((await add("Primary borrower")).message);
  assert.ok((await add("Co-borrower")).message);
  const [request] = f.primary({ type: "status" }).statusView.loanStatus.documents;
  const access = { token: f.primaryToken, session, requestId: request.id, revision: request.revision, mode: "mock" };
  const begun = beginDocumentUpload(f.db, access, now + 2);
  assert.ok(begun.objectId);
  failDocumentUpload(f.db, request.id, begun.objectId);
  const admin = { ...f.officer, brokerage: { ...f.brokerage, role: "Admin" } };
  const coToken = jointApplication(f.db, f.loanId).token;
  const check = () => checkDocumentReminders(f.db, { type: "checkDocuments", operationId: crypto.randomUUID(), simulate: false }, admin, new Date(now));
  assert.ok((await f.run("revokeJointLink", { token: coToken })).message);
  assert.equal(check().processed, 1);
  assert.ok((await f.run("replaceJointLink", { token: coToken })).message);
  assert.equal(check().processed, 1);
  const runs = documentReminderPage(f.db, { type: "list", filter: "All runs", automation: "Document reminders" }, new Date(now), 10);
  assert.deepEqual(new Set(runs.map(({ borrower }) => borrower)), new Set(["Fictional Primary", "Jordan Sample"]));
  assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
});

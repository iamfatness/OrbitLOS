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

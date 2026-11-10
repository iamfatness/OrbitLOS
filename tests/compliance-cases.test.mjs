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
const { complianceCaseWork } = await import("../src/lib/compliance-cases.ts");

const at = "2026-11-10T12:00:00.000Z";
const unavailable = { error: "This compliance work is unavailable." };
const member = (name, role) => ({ name, email: `${name.toLowerCase()}@example.test`, role, status: "Active", accessRevision: 1 });

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { prepare: (sql) => sqlite.prepare(sql), exec: (sql) => sqlite.exec(sql), transaction(run) {
    sqlite.exec("BEGIN");
    try { const result = run(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const brokerageId = crypto.randomUUID();
  const admin = member("Owner", "Admin");
  const officer = member("Loan", "LO");
  const processor = member("Processing", "Processor");
  const unrelated = member("Other", "LO");
  const roster = [admin, officer, processor, unrelated];
  const staff = ({ email, name, role, accessRevision }) => ({ email, name, brokerage: {
    id: brokerageId, name: "Fictional Brokerage", role, pilot: true, accessRevision,
  } });
  const work = (input, actor = admin, members = roster, target = brokerageId) =>
    complianceCaseWork(db, input, staff(actor), target, members, at);

  function addLoan({ state = "MI", mode = "mock", purpose = "Purchase", nonAgency } = {}) {
    const loanId = crypto.randomUUID();
    insertContact(db, { id: loanId, name: "Fictional Borrower", email: "", phone: "", role: "Borrower" });
    insertLoan(db, { id: loanId, contactId: loanId, partnerId: null, officer: officer.name, officerEmail: officer.email,
      address: "Fictional test property", amount: 240000, purpose, stage: "Application", stageSince: at });
    db.prepare("INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt) VALUES (?, ?, ?, ?, ?)")
      .run(loanId, crypto.randomUUID(), at, JSON.stringify({ propertyLocation: { state } }), at);
    db.prepare("INSERT INTO loan_processing (loanId, processorEmail, processorName, status, note, updatedAt, revision) VALUES (?, ?, ?, 'Assigned', '', ?, 1)")
      .run(loanId, processor.email, processor.name, at);
    db.prepare(`INSERT INTO pricing_runs (id, loanId, provider, mode, scenario, offers, notices, quotedAt)
      VALUES (?, ?, 'Fixture', ?, ?, '[]', '[]', ?)`).run(loanId, loanId, mode, JSON.stringify({ purpose, nonAgency }), at);
    addPackage(loanId, 1);
    return loanId;
  }

  function addPackage(loanId, version) {
    db.prepare("UPDATE disclosure_packages SET supersededAt = ? WHERE loanId = ?").run(at, loanId);
    db.prepare(`INSERT INTO disclosure_packages (loanId, version, runId, offerId, applicationRevision, feeRevision,
      quote, documents, signers, preparedAt, signBy) VALUES (?, ?, ?, 'sample', 0, 0, '{}', '[]', '[]', ?, '2026-11-20')`)
      .run(loanId, version, loanId, at);
  }
  const open = (loanId, packageVersion = 1, actor = admin) => work({ type: "openFixture", loanId, packageVersion }, actor);
  const read = (caseId, actor = admin, members = roster) => work({ type: "read", caseId }, actor, members);
  const edit = (item, data, actor = admin) => work({ caseId: item.id, expectedRevision: item.revision, requestId: crypto.randomUUID(), ...data }, actor);
  return { db, brokerageId, roster, admin, officer, processor, unrelated, staff, work, read, open, edit, addLoan, addPackage };
}

test("existing files and new fictional cases have separate scope, history and unknown coverage", (t) => {
  const { addLoan, open, work, read, db } = fixture(t);
  const loanId = addLoan();
  assert.deepEqual(work({ type: "list" }).coverage, { state: "Not evaluated", evaluatedFiles: 0,
    eligibleFiles: null, mode: "Fictional fixture", approval: "None" });
  assert.deepEqual(work({ type: "list" }).counts, { cases: 0, files: 0 });
  initializeStore(db, false);
  assert.deepEqual(work({ type: "list" }).counts, { cases: 0, files: 0 });
  const finding = open(loanId);
  assert.equal(finding.item.kind, "Operational finding");
  assert.equal(finding.item.applicability, "Unknown");
  assert.equal(finding.item.coverage, "Not approved");
  assert.equal(finding.packageState, "Current");
  assert.equal(finding.sampleReview, null);
  assert.equal(finding.history[0].payload.packageRevision, 1);
  assert.equal(open(loanId).item.id, finding.item.id);
  initializeStore(db, false);
  assert.equal(read(finding.item.id).history.length, 1);
  const gap = read(finding.item.parentCaseId);
  assert.equal(gap.item.kind, "Control gap");
  assert.equal(read(gap.item.parentCaseId).item.kind, "Requirement review");
  open(addLoan());
  assert.deepEqual(work({ type: "list" }).counts, { cases: 4, files: 2 });
  assert.deepEqual(work({ type: "list", kind: "Control gap" }).counts, { cases: 1, files: 0 });
  assert.equal(open(addLoan({ state: "OH" })).error, "Open a current sample disclosure package for a fictional Michigan conventional purchase.");
  assert.ok(open(addLoan({ mode: "stage" })).error);
  assert.ok(open(addLoan({ nonAgency: { program: "DSCR" } })).error);
});

test("owner inventory backfills bounded batches, resumes after initialization and pages exact categories", (t) => {
  const { addLoan, work, db, officer, processor, admin, brokerageId } = fixture(t);
  const get = (bucket, after) => work({ type: "inventory", bucket, after });
  const scan = (revision) => work({ type: "advanceInventory", revision });
  assert.equal(get().state, "Not started");
  assert.equal(get().scanned, null);
  assert.deepEqual(work({ type: "inventory" }, officer), unavailable);
  assert.deepEqual(work({ type: "advanceInventory", revision: 0 }, processor), unavailable);
  assert.deepEqual(work({ type: "inventory" }, admin, undefined, `${brokerageId}-other`), unavailable);
  const sampleReviewNeeded = Array.from({ length: 27 }, () => addLoan());
  addLoan({ state: "" });
  addLoan({ state: "OH" });
  addLoan({ mode: "stage" });
  const reviewed = addLoan();
  db.prepare("INSERT INTO closing_disclosure_reviews VALUES (?, 1, 1, ?, ?)").run(reviewed, at, admin.email);
  const initial = scan(0);
  assert.equal(initial.state, "Scanning");
  assert.equal(initial.scanned, 25);
  assert.equal(scan(0).scanned, 25);
  initializeStore(db, false);
  const complete = scan(initial.revision);
  assert.equal(complete.state, "Complete");
  assert.equal(complete.scanned, 31);
  assert.deepEqual(complete.counts.map(({ count }) => count), [1, 1, 1, 27, 1]);
  assert.equal(complete.asOf, at);
  const first = get("Sample review needed");
  const second = get("Sample review needed", first.next);
  assert.equal(first.files.length, 25);
  assert.equal(second.next, null);
  assert.deepEqual([...first.files, ...second.files].map(({ loanId }) => loanId), sampleReviewNeeded.sort());
  assert.equal(get("Sample review available").files[0].loanId, reviewed);
  assert.equal(scan(complete.revision).revision, complete.revision);
  assert.deepEqual(work({ type: "list" }).counts, { cases: 0, files: 0 });
  assert.equal(work({ type: "list" }).coverage.state, "Not evaluated");
});

test("source changes invalidate inventory during and after scanning, including files before the cursor", (t) => {
  const { addLoan, addPackage, work, db } = fixture(t);
  const loans = Array.from({ length: 26 }, () => addLoan()).sort();
  const scan = (revision) => work({ type: "advanceInventory", revision });
  const get = () => work({ type: "inventory" });
  const first = scan(0);
  db.prepare("UPDATE applications SET draft = json_set(draft, '$.unrelated', 'new') WHERE loanId = ?").run(loans[0]);
  assert.equal(get().revision, first.revision);
  db.prepare("UPDATE applications SET draft = json_set(draft, '$.propertyLocation.state', 'OH') WHERE loanId = ?").run(loans[0]);
  const stale = scan(first.revision);
  assert.equal(stale.state, "Stale");
  assert.equal(stale.scanned, null);
  assert.ok(stale.counts.every(({ count }) => count === 0));
  const rebuilt = scan(stale.revision);
  const completed = scan(rebuilt.revision);
  assert.equal(completed.scanned, 26);
  assert.deepEqual(completed.counts.map(({ count }) => count), [0, 1, 0, 25, 0]);
  addPackage(loans[1], 2);
  assert.equal(get().state, "Stale");
  assert.match(work({ type: "inventory", bucket: "Sample review needed", after: {
    revision: completed.revision, bucket: "Sample review needed", loanId: loans[0],
  } }).error, /inventory changed/);
});

test("tenant, current roster, file assignment and confidentiality restrict detail and counts", (t) => {
  const { addLoan, open, work, read, edit, staff, roster, db, admin, officer, processor, unrelated, brokerageId } = fixture(t);
  const loanId = addLoan();
  const { item } = open(loanId);
  assert.deepEqual(work({ type: "list", loanId }, officer).counts, { cases: 1, files: 1 });
  assert.deepEqual(work({ type: "read", caseId: item.id, loanId: addLoan() }), unavailable);
  assert.deepEqual(work({ type: "list" }, officer), unavailable);
  assert.deepEqual(work({ type: "list", loanId }, unrelated), unavailable);
  assert.equal(read(item.id, processor).item.parentCaseId, null);
  assert.deepEqual(read(item.parentCaseId, officer), unavailable);
  assert.deepEqual(edit(item, { type: "updateStatus", status: "Awaiting evidence" }, processor), unavailable);
  assert.deepEqual(work({ type: "read", caseId: item.id }, admin, roster, crypto.randomUUID()), unavailable);
  const otherBrokerageId = crypto.randomUUID();
  const otherStaff = { ...staff(admin), brokerage: { ...staff(admin).brokerage, id: otherBrokerageId } };
  assert.deepEqual(complianceCaseWork(db, { type: "read", caseId: item.id }, otherStaff, otherBrokerageId, roster), unavailable);
  assert.deepEqual(complianceCaseWork(db, { type: "list" }, otherStaff, otherBrokerageId, roster).counts, { cases: 0, files: 0 });
  assert.deepEqual(complianceCaseWork(db, { type: "list" }, { ...staff(admin), brokerage: { ...staff(admin).brokerage, pilot: false } }, brokerageId, roster), unavailable);

  const restricted = crypto.randomUUID();
  db.prepare(`INSERT INTO compliance_cases (brokerageId, id, caseKey, kind, confidentiality, title, status,
    ownerEmail, ownerAccessRevision, revision, openedAt, updatedAt) VALUES (?, ?, 'restricted', 'Requirement review', 'Restricted',
    'Restricted case', 'Open', ?, 1, 1, ?, ?)`).run(brokerageId, restricted, admin.email, at, at);
  db.prepare("UPDATE compliance_cases SET parentCaseId = ? WHERE id = ?").run(restricted, item.id);
  assert.deepEqual(read(restricted), unavailable);
  assert.equal(read(item.id).item.parentCaseId, null);
  assert.deepEqual(work({ type: "list" }).counts, { cases: 3, files: 1 });

  const revoked = roster.map((member) => member.email === officer.email ? { ...member, status: "Revoked" } : member);
  assert.deepEqual(read(item.id, officer, revoked), unavailable);
  assert.equal(read(item.id, admin, revoked).item.ownerState, "Backup review");
  const reinvited = roster.map((member) => member.email === officer.email ? { ...member, accessRevision: 2 } : member);
  assert.equal(read(item.id, admin, reinvited).item.ownerEmail, admin.email);
  assert.deepEqual(read(item.id, officer, reinvited), unavailable);
  assert.equal(edit(item, { type: "assign", ownerEmail: processor.email }).item.ownerEmail, processor.email);
  db.prepare("UPDATE loan_processing SET processorEmail = NULL WHERE loanId = ?").run(loanId);
  assert.deepEqual(read(item.id, processor), unavailable);
  assert.equal(read(item.id).item.ownerState, "Backup review");
});

test("manual status and older sample evidence cannot resolve or review another package revision", (t) => {
  const { db, addLoan, addPackage, open, work, read, edit, admin, officer } = fixture(t);
  const loanId = addLoan();
  const { item } = open(loanId);
  const update = { type: "updateStatus", caseId: item.id, expectedRevision: item.revision, status: "Awaiting evidence", requestId: crypto.randomUUID() };
  const next = work(update, officer);
  assert.equal(next.item.revision, 2);
  assert.equal(work(update, officer).history.length, 2);
  assert.match(work({ ...update, status: "In progress" }, officer).error, /changed/);
  assert.match(work({ ...update, requestId: crypto.randomUUID() }, officer).error, /changed/);
  assert.deepEqual(edit(next.item, { type: "updateStatus", status: "Resolved" }), unavailable);

  db.prepare("INSERT INTO closing_progress (loanId, disclosureStatus, disclosureDate) VALUES (?, 'Sent', '2026-11-10')").run(loanId);
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, completedAt) VALUES (?, ?, 'Sample work', ?, ?)").run(loanId, loanId, at, at);
  const review = { type: "recordSampleReview", packageRevision: 1 };
  assert.match(edit(next.item, review).error, /workbench/);
  assert.deepEqual(edit(next.item, review, officer), unavailable);
  db.prepare("INSERT INTO closing_disclosure_reviews VALUES (?, 1, 1, ?, ?)").run(loanId, at, admin.email);
  const reviewed = edit(next.item, review);
  assert.equal(reviewed.item.status, "Awaiting evidence");
  assert.equal(reviewed.sampleReview.mode, "Sample workbench review");
  assert.deepEqual(reviewed.history[0].payload.sampleEvidence, { mode: "Sample workbench review", packageVersion: 1, reviewedAt: at, reviewer: admin.email });
  assert.equal(reviewed.coverage.approval, "None");
  db.prepare("UPDATE disclosure_packages SET revision = 2 WHERE loanId = ? AND version = 1").run(loanId);
  assert.equal(read(item.id).sampleReview, null);
  assert.match(edit(reviewed.item, review).error, /workbench/);
  addPackage(loanId, 2);
  assert.equal(read(item.id).packageState, "Superseded");
  assert.equal(read(item.id).history[0].action, "recordSampleReview");
  assert.match(edit(reviewed.item, review).error, /workbench/);
  const newer = open(loanId, 2);
  assert.notEqual(newer.item.id, item.id);
  assert.equal(newer.item.parentCaseId, item.parentCaseId);
  assert.equal(newer.sampleReview, null);
  assert.match(edit(newer.item, review).error, /workbench/);
  assert.deepEqual(work({ type: "list", kind: "Operational finding" }).counts, { cases: 2, files: 1 });
});

test("queue pages use stable ties, reject changed filters or revisions, and reconcile counts", (t) => {
  const { addLoan, open, edit, work } = fixture(t);
  for (let i = 0; i < 21; i++) open(addLoan());
  const input = { type: "list", kind: "Operational finding" };
  const first = work(input);
  const last = work({ ...input, after: first.next });
  assert.equal(first.items.length, 20);
  assert.equal(last.items.length, 1);
  assert.equal(last.next, null);
  assert.deepEqual(last.counts, { cases: 21, files: 21 });
  assert.equal(new Set([...first.items, ...last.items].map(({ id }) => id)).size, 21);
  assert.match(work({ ...input, status: "Open", after: first.next }).error, /queue changed/);
  assert.match(work({ ...input, after: { ...first.next, id: crypto.randomUUID() } }).error, /queue changed/);
  edit(last.items[0], { type: "updateStatus", status: "In progress" });
  assert.match(work({ ...input, after: first.next }).error, /queue changed/);
  assert.deepEqual(work({ ...input, status: "Open" }).counts, { cases: 20, files: 20 });
});

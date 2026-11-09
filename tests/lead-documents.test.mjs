import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore } = await import("../src/lib/store.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { newPortalAccessCode, portalToken } = await import("../src/lib/brokerage-model.ts");
const { beginLeadSample, convertedLeadLinkHashes, failLeadSample, finishLeadSample, leadDocumentWork,
  readLeadDocumentPortal } = await import("../src/lib/lead-documents.ts");
const { startLeadFollowUp } = await import("../src/lib/lead-inbox.ts");
const { readIncomingLoanWorkPage } = await import("../src/lib/incoming-loan-work.ts");
const { readOfficerQueue, readWorkspaceTasks } = await import("../src/lib/officer-queue.ts");

test("lead conversion atomically carries the exact sample file and closes its old access", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const clock = Date.parse("2026-11-10T18:00:00.000Z");
  const at = new Date(clock).toISOString();
  const leadId = randomUUID();
  const tenant = randomUUID();
  const officer = { name: "Fictional Officer", email: "lead-owner@example.test", brokerage: { id: tenant, role: "LO", pilot: true } };
  const other = { ...officer, email: "unrelated@example.test" };
  db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
    VALUES (?, ?, 'Fictional Evidence Lead', 'evidence@example.test', '2485550127', 'Purchase', ?, ?, ?, ?)`)
    .run(leadId, randomUUID(), officer.name, officer.email, at, at);
  startLeadFollowUp(db, leadId, at);
  const work = (input, staff = officer, protect) => leadDocumentWork(db, { leadId, ...input }, staff, tenant, true, protect, new Date(clock));
  const pay = { type: "request", requestId: randomUUID(), kind: "Pay stub", instructions: "Provide a sample pay statement.", dueOn: "2026-11-10" };
  const bank = { ...pay, requestId: randomUUID(), kind: "Bank statement", instructions: "Provide the sample statement.", dueOn: "2026-11-09" };
  const locate = (requestId, staff) => work({ type: "locate", requestId }, staff);
  const today = (staff = officer) => readOfficerQueue(db, { horizon: 1 }, staff, tenant, new Date(clock + 2_000)).items;
  const incoming = (staff = officer, view = "today") => readIncomingLoanWorkPage(db, { view }, staff, tenant).items;
  const tasks = (view, scope = "Mine", staff = officer) =>
    readWorkspaceTasks(db, { type: "list", view, scope, group: "Documents" }, staff, tenant, new Date(clock + 2_000)).items;
  assert.match((await work(pay, other)).error, /assigned/);
  assert.equal((await work(pay)).requests.length, 1);
  assert.equal((await work(pay)).requests.length, 1);
  assert.equal((await work(bank)).requests.length, 2);
  assert.deepEqual((await locate(pay.requestId)).location, { kind: "lead", recordId: leadId });
  assert.ok((await locate(pay.requestId, other)).error);
  assert.ok((await locate(randomUUID())).error);
  assert.equal(today().find((item) => item.id === bank.requestId)?.overdue, true);
  assert.equal(today().find((item) => item.id === pay.requestId)?.overdue, false);
  assert.equal(today(other).length, 0);
  assert.deepEqual(tasks("Overdue").map(({ kind, id }) => ({ kind, id })), [{ kind: "lead-document", id: bank.requestId }]);
  const token = portalToken(tenant);
  const code = newPortalAccessCode();
  const issue = { type: "issue", linkId: randomUUID(), token, code, hours: 1, confirmedFictional: true };
  assert.equal((await work(issue)).createdId, issue.linkId);
  assert.equal((await work(issue)).createdId, issue.linkId);
  assert.equal(readLeadDocumentPortal(db, { token, code: newPortalAccessCode() }, clock).status, 404);
  assert.equal(readLeadDocumentPortal(db, { token, code }, clock + 3_600_000).status, 404);
  assert.equal(beginLeadSample(db, { token, code, requestId: randomUUID(), revision: 0 }, clock).status, 404);
  db.prepare("UPDATE referral_leads SET heldAt = ? WHERE id = ?").run(at, leadId);
  assert.equal(readLeadDocumentPortal(db, { token, code }, clock).status, 404);
  assert.ok((await locate(pay.requestId)).error);
  assert.ok(!today().some((item) => item.id === bank.requestId));
  db.prepare("UPDATE referral_leads SET heldAt = NULL WHERE id = ?").run(leadId);
  assert.equal(readLeadDocumentPortal(db, { token, code }, clock).value.requests.length, 2);

  const upload = { token, code, requestId: pay.requestId, revision: 0 };
  const blocked = beginLeadSample(db, upload, clock);
  assert.ok(blocked.objectId);
  failLeadSample(db, pay.requestId, blocked.objectId);
  assert.ok(db.prepare("SELECT 1 FROM document_file_cleanup WHERE objectId = ?").get(blocked.objectId));
  assert.equal(readLeadDocumentPortal(db, { token, code }, clock).value.requests[0].status, "Requested");
  const started = beginLeadSample(db, upload, clock + 1_001);
  assert.ok(started.objectId);
  const convert = () => executeCommand(db, { type: "convertReferral", referralId: leadId, contactId: null }, officer);
  assert.match((await convert()).error, /PDF is still processing/);
  assert.equal(db.prepare("SELECT count(*) AS total FROM loans").get().total, 0);
  assert.equal(finishLeadSample(db, upload, started.objectId, clock + 2_000).received, true);
  assert.deepEqual(incoming().map(({ kind, id, leadId }) => ({ kind, id, leadId })), [{ kind: "lead-document", id: pay.requestId, leadId }]);
  assert.equal(incoming(other).length, 0);
  const admin = { ...other, brokerage: { ...other.brokerage, role: "Admin" } };
  assert.equal(incoming(admin, "processing").length, 0);
  assert.ok(!today().some((item) => item.id === pay.requestId));
  assert.equal(tasks("Open", "Team", admin).find((item) => item.id === pay.requestId)?.kind, "lead-document-review");
  const accepted = await work({ type: "review", requestId: pay.requestId, revision: 1, decision: "Accepted", replacementNote: "" });
  assert.equal(accepted.requests[0].status, "Accepted");
  assert.equal(incoming().length, 0);
  const converted = await convert();
  assert.ok(converted.referralLoanId, converted.error);
  assert.deepEqual((await locate(bank.requestId)).location, { kind: "loan", recordId: converted.referralLoanId });
  assert.ok((await locate(bank.requestId, other)).error);
  assert.deepEqual(today().filter(({ id }) => id === bank.requestId).map(({ kind, target }) => ({ kind, target })),
    [{ kind: "document", target: `document-${bank.requestId}` }]);
  assert.equal((await convert()).referralLoanId, converted.referralLoanId);
  assert.equal(db.prepare("SELECT count(*) AS total FROM loans").get().total, 1);
  const docs = converted.state.documentRequests.filter(({ loanId }) => loanId === converted.referralLoanId);
  assert.deepEqual(docs.map(({ id, status, revision, dueOn }) => ({ id, status, revision, dueOn })).sort((a, b) => a.id.localeCompare(b.id)),
    [{ id: pay.requestId, status: "Accepted", revision: 2, dueOn: pay.dueOn }, { id: bank.requestId, status: "Requested", revision: 0, dueOn: bank.dueOn }]
      .sort((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual({ ...db.prepare("SELECT objectId, uploadMode FROM document_files WHERE requestId = ?").get(pay.requestId) },
    { objectId: started.objectId, uploadMode: "mock" });
  assert.equal(db.prepare("SELECT 1 FROM document_file_cleanup WHERE objectId = ?").get(started.objectId), undefined);
  assert.equal(readLeadDocumentPortal(db, { token, code }, clock).status, 404);
  const hash = createHash("sha256").update(token).digest("hex");
  assert.deepEqual(convertedLeadLinkHashes(db, leadId, converted.referralLoanId, at).map(({ tokenHash }) => tokenHash), [hash]);
  assert.equal(db.prepare("SELECT count(*) AS total FROM activity WHERE loanId = ? AND text LIKE 'Accepted sample lead document%'")
    .get(converted.referralLoanId).total, 1);
});

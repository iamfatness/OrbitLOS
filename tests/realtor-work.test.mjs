import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { readLeadArchive } = await import("../src/lib/lead-inbox.ts");
const { readRealtorWork } = await import("../src/lib/realtor-work.ts");
const { readEditableLead } = await import("../src/lib/editable-lead.ts");
const { realtorReferrals } = await import("../src/lib/realtor-portal.ts");

const brokerage = { id: crypto.randomUUID(), role: "Admin", pilot: true };
const admin = { name: "Fictional Admin", email: "admin@example.test", brokerage };
const officer = { name: "Fictional Officer", email: "owner@example.test" };
const at = "2026-11-08T17:00:00.000Z";
const day = at.slice(0, 10);
const filters = { from: "", through: "", officer: "", source: "" };
const firstToken = "7".repeat(64);
const secondToken = "8".repeat(64);

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const partner = (id, name) => insertContact(db, { id, name, role: "Realtor", email: `${id}@example.test`, phone: "555-0100" });
  partner("origin", "Élodie Origin");
  partner("current", "Taylor Current");
  insertContact(db, { id: "buyer", name: "Fictional borrower", role: "Borrower", email: "private@example.test", phone: "" });
  const link = db.prepare("INSERT INTO realtor_portals (realtorId, token, expiresAt, officer, officerEmail) VALUES (?, ?, '2099-01-01T00:00:00.000Z', ?, ?)");
  link.run("origin", firstToken, officer.name, officer.email);
  link.run("current", secondToken, officer.name, officer.email);
  function loan(id, partnerId, { source = "Realtor referral", stage = "Lead", owner = officer, createdAt = at } = {}) {
    insertLoan(db, { id, contactId: "buyer", partnerId, officer: owner.name, officerEmail: owner.email,
      stage, stageSince: at, createdAt, address: "", amount: 350000, purpose: "Purchase", leadSource: source });
  }
  function lead(id, { loanId = null, archived = false, held = false } = {}) {
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail,
      createdAt, dueAt, resolvedAt, loanId, archiveToken, heldAt)
      VALUES (?, ?, 'origin', ?, 'private@example.test', '', 'Purchase', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, crypto.randomUUID(), `Fictional ${id}`, officer.name, officer.email, at, at, archived || loanId ? at : null,
        loanId, archived ? crypto.randomUUID() : null, held ? at : null);
  }
  const directory = (search = "", options = {}, after) => readRealtorWork(db, { type: "directory", search, filters: { ...filters, ...options }, after }, admin);
  const records = (partnerId, view, options = {}, after) => readRealtorWork(db, { type: "records", partnerId, view, filters: { ...filters, ...options }, after }, admin);
  const profile = (partnerId) => readRealtorWork(db, { type: "profile", partnerId }, admin);
  return { db, loan, lead, directory, profile, records, partner };
}

test("counts and drilldowns reconcile across original attribution, current partner, filters and funding reversal", (t) => {
  const { db, loan, lead, directory, profile, records } = fixture(t);
  const archived = crypto.randomUUID();
  const held = crypto.randomUUID();
  loan("moved", "current", { stage: "Funded" });
  loan("manual", "current", { stage: "Funded" });
  loan("direct", null, { source: "Direct", owner: admin });
  lead("converted", { loanId: "moved" });
  lead(archived, { archived: true });
  lead(held, { held: true });
  db.prepare("INSERT INTO closing_progress (loanId, fundingDate) VALUES ('moved', ?)").run(day);
  db.prepare("INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt) VALUES ('moved', 'private-application-token', ?, '{}', ?)").run(at, at);
  db.prepare("INSERT INTO application_versions (loanId, revision, draft, submittedAt) VALUES ('moved', 1, '{}', ?)").run(at);
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES ('task', 'moved', 'Fictional follow-up', ?)").run(at);

  const summary = directory();
  const count = (id) => summary.partners.find((item) => item.id === id).counts;
  assert.deepEqual(count("origin"), { referrals: 3, submitted: 1, funded: 1 });
  assert.deepEqual(count("current"), { referrals: 1, submitted: 0, funded: 0 });
  assert.equal(summary.direct.counts.referrals, 1);
  assert.equal(records("", "referrals").rows[0].id, "direct");
  assert.deepEqual(records("origin", "submitted").rows.map(({ id }) => id), ["moved"]);
  assert.deepEqual(records("origin", "funded").rows.map(({ id }) => id), ["moved"]);
  assert.deepEqual(records("current", "linked").rows.map(({ id }) => id), ["manual", "moved"]);
  assert.equal(records("current", "linked").rows.find(({ id }) => id === "moved").openTasks, 1);
  assert.equal(profile("current").closed, 2);
  assert.equal(profile("origin").linked, 0);
  assert.equal(profile("origin").open, 1);
  assert.deepEqual(records("origin", "open").rows.map(({ id, status }) => [id, status]), [[held, "On hold"]]);
  assert.equal(records("origin", "referrals").rows.find(({ id }) => id === archived).archived, true);
  assert.equal(readEditableLead(db, { leadId: held }, admin, brokerage.id).lead.id, held);
  assert.equal(readLeadArchive(db, admin, { query: "", leadId: archived }).leads[0].id, archived);
  assert.equal(readLeadArchive(db, admin, { query: "", leadId: held }).leads.length, 0);
  assert.doesNotMatch(JSON.stringify([summary, records("origin", "referrals")]), /private@example|private-application-token|7777777777|8888888888/);
  assert.equal(profile("origin").portal.token, firstToken);
  assert.doesNotMatch(JSON.stringify(profile("origin")), /8888888888|quoteToken/);

  const matching = { from: day, through: day, source: "Realtor referral", officer: officer.email };
  assert.equal(directory("elodie", matching).partners[0].counts.referrals, records("origin", "referrals", matching).total);
  for (const override of [{ from: "2026-11-09" }, { source: "Direct" }, { officer: admin.email }]) {
    assert.equal(directory("elodie", override).partners[0].counts.referrals, 0);
    assert.equal(records("origin", "referrals", override).total, 0);
  }
  db.exec(`UPDATE referral_leads SET createdAt = '2026-11-09T04:59:59.999Z' WHERE id = 'converted';
    UPDATE loans SET createdAt = '2026-11-09T12:00:00.000Z', leadSource = 'Direct' WHERE id = 'moved';`);
  assert.equal(directory("elodie", matching).partners[0].counts.funded, 1);
  assert.deepEqual(records("origin", "funded", matching).rows.map(({ id, at, source }) => [id, at, source]),
    [["moved", "2026-11-09T04:59:59.999Z", "Realtor referral"]]);
  db.prepare("UPDATE closing_progress SET fundingDate = NULL WHERE loanId = 'moved'").run();
  assert.equal(directory("elodie").partners[0].counts.funded, 0);
  assert.equal(records("origin", "funded").total, 0);
});

test("directory and record cursors are stable and link commands refresh only the selected partner", async (t) => {
  const { db, lead, directory, profile, partner, records } = fixture(t);
  for (let index = 0; index < 34; index++) {
    partner(`tie-${String(index).padStart(2, "0")}`, "Tied realtor");
    lead(`lead-${String(index).padStart(2, "0")}`);
  }
  const first = directory("tied");
  assert.equal(first.partners.length, 30);
  assert.equal(first.partners.at(-1).id, "tie-29");
  assert.deepEqual(directory("tied", {}, first.next).partners.map(({ id }) => id), ["tie-30", "tie-31", "tie-32", "tie-33"]);
  const entries = records("origin", "referrals");
  assert.equal(entries.total, 34);
  assert.equal(entries.rows.length, 20);
  assert.equal(records("origin", "referrals", {}, entries.next).rows[0].id, "lead-20");
  for (const role of ["LO", "Processor"]) {
    assert.ok(readRealtorWork(db, { type: "profile", partnerId: "origin" }, { ...admin, brokerage: { ...brokerage, role } }).error);
  }
  assert.ok(profile("buyer").error);
  const change = { type: "saveRealtorLinkOwner", realtorId: "origin", token: firstToken, revision: 0, officerEmail: null };
  const write = (input) => executeCommand(db, input, admin, undefined, [], { scopedRealtorUpdates: true });
  const changed = await write(change);
  assert.equal(changed.realtorChanged, true);
  assert.equal(changed.state, undefined);
  assert.equal(profile("origin").portal.revision, 1);
  assert.equal(profile("origin").portal.token, firstToken);
  assert.ok((await write(change)).realtorChanged);
  assert.ok((await write({ type: "createRealtorPortal", realtorId: "origin", officerEmail: null })).realtorChanged);
  const replaced = profile("origin").portal.token;
  assert.notEqual(replaced, firstToken);
  assert.equal(realtorReferrals(db, { type: "read", token: firstToken }).status, 404);
  assert.ok((await write({ type: "revokeRealtorPortal", realtorId: "origin" })).realtorChanged);
  assert.equal(profile("origin").portal, null);
  assert.equal(profile("current").portal.token, secondToken);
});

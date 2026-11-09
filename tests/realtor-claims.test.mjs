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

const { activateBrokerages, activeBrokerages, brokerageMembers, changeBrokerage, initializeBrokerages } = await import("../src/lib/brokerages.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { borrowerCommandResult } = await import("../src/lib/applications.ts");
const { initializeStore, insertContact, readWorkspace } = await import("../src/lib/store.ts");
const { scopeWorkspace } = await import("../src/lib/workspace-access.ts");
const { readSharedRealtorQueue } = await import("../src/lib/realtor-claim-queue.ts");
const { assignWaitingRealtor, readRealtorQueueReport } = await import("../src/lib/realtor-queue-report.ts");
const { claimSharedRealtor, updateInboxLead } = await import("../src/lib/lead-inbox.ts");
const { realtorReferrals } = await import("../src/lib/realtor-portal.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction(fn) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = fn(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  initializeBrokerages(db);
  const admin = { name: "Owner", email: "owner@example.test" };
  const bootstrap = [admin.email];
  activateBrokerages(db, admin, bootstrap);
  const id = crypto.randomUUID();
  assert.equal(changeBrokerage(db, "orbit-demo", admin, bootstrap, { type: "create", id, name: "Claims QA", pilot: true }).created, id);
  const staff = (identity) => ({ ...identity, brokerage: activeBrokerages(db, identity.email, bootstrap).find((item) => item.id === id) });
  const invite = (name, role = "LO") => {
    const identity = { name, email: `${name}@example.test` };
    assert.ok(changeBrokerage(db, id, admin, bootstrap, { type: "invite", email: identity.email, role }).message);
    activateBrokerages(db, identity, bootstrap);
    return staff(identity);
  };
  const officer = invite("officer");
  const second = invite("second");
  const unrelated = invite("unrelated");
  const processor = invite("processor", "Processor");
  insertContact(db, { id: "partner", name: "Fictional partner", role: "Realtor", email: "", phone: "" });
  const dueAt = "2099-06-02T16:00:00.000Z";
  const lead = (name, { realtorId = "partner", owner = null, heldAt = null } = {}) => {
    const leadId = crypto.randomUUID();
    db.prepare(`INSERT INTO referral_leads (id,requestId,realtorId,name,email,phone,purpose,officer,officerEmail,createdAt,dueAt,heldAt)
      VALUES (?, ?, ?, ?, ?, '', 'Purchase', '', ?, ?, ?, ?)`)
      .run(leadId, leadId, realtorId, name, `${leadId}@example.test`, owner, "2026-11-08T15:00:00.000Z", dueAt, heldAt);
    return leadId;
  };
  const policy = (officers, revision = 0, actor = staff(admin)) => executeCommand(db,
    { type: "saveRealtorClaimPolicy", officers, revision }, actor, undefined,
    brokerageMembers(db, id, bootstrap).filter(({ status }) => status === "Active"));
  const list = (actor, input = {}, tenant = id) => readSharedRealtorQueue(db, actor, tenant, input);
  const claim = (actor, leadId) => executeCommand(db, { type: "claimSharedRealtor", leadId }, actor);
  return { db, id, admin, bootstrap, staff, officer, second, unrelated, processor, lead, dueAt, policy, list, claim };
}

test("authorized officers see a masked queue and only one can claim a referral", async (t) => {
  const { db, officer, second, unrelated, processor, lead, dueAt, policy, list, claim } = fixture(t);
  const leadId = lead("Fictional borrower");
  assert.ok(list(officer).error);
  assert.ok((await policy([officer.email], 0, officer)).error);
  assert.ok((await policy([processor.email])).error);
  assert.ok((await policy([officer.email, second.email])).state);
  assert.ok(list(unrelated).error);
  assert.ok(list(processor).error);
  assert.ok(list(officer, {}, crypto.randomUUID()).error);
  assert.deepEqual(list(officer).leads, [{ id: leadId, dueAt, purpose: "Purchase", realtor: "Fictional partner", firstContactLogged: false }]);
  assert.ok(!scopeWorkspace(readWorkspace(db, false), officer).inboxLeads.some(({ id }) => id === leadId));
  assert.ok((await executeCommand(db, { type: "assignInboxLead", leadId, email: officer.email, previousEmail: null }, officer)).error);

  const [first, rival] = await Promise.all([claim(officer, leadId), claim(second, leadId)]);
  assert.ok(first.state, first.error);
  assert.match(rival.error, /no longer available/);
  assert.equal(first.state.inboxLeads.find(({ id }) => id === leadId).name, "Fictional borrower");
  assert.equal(first.state.realtorClaimPolicy, undefined);
  assert.deepEqual(list(second).leads, []);
  const retry = await executeCommand(db, { type: "claimSharedRealtor", leadId }, officer, undefined, [], { scopedLeadUpdates: true });
  assert.equal(retry.leadWork.lead.officerEmail, officer.email);
  assert.equal(retry.leadWork.lead.dueAt, dueAt);
  assert.equal(retry.manager, undefined);
  assert.equal(retry.state, undefined);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Claimed shared realtor referral'").get().count, 1);
  assert.deepEqual({ ...db.prepare("SELECT officerEmail, dueAt FROM referral_leads WHERE id = ?").get(leadId) }, { officerEmail: officer.email, dueAt });
  const loan = await executeCommand(db, { type: "convertReferral", referralId: leadId, contactId: null }, officer);
  assert.ok(loan.referralLoanId, loan.error);
  const token = loan.state.applications.find(({ loanId }) => loanId === loan.referralLoanId).token;
  const draft = borrowerCommandResult(db, { type: "read", token }).application.draft;
  assert.equal(draft.borrowerName, "Fictional borrower");
  assert.equal(draft.email, `${leadId}@example.test`);
});

test("excludes ineligible records, pages tied deadlines, and invalidates approvals after role changes or removal", async (t) => {
  const { db, id, admin, bootstrap, staff, officer, unrelated, lead, policy, list, claim } = fixture(t);
  assert.ok((await policy([officer.email])).state);
  const openIds = Array.from({ length: 25 }, (_, i) => lead(`Fictional prospect ${i}`));
  const held = lead("Fictional held lead", { heldAt: "2026-11-08T16:00:00.000Z" });
  const owned = lead("Fictional assigned lead", { owner: unrelated.email });
  const quote = lead("Fictional quote", { realtorId: null });
  const suppressed = lead("Fictional opted out");
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', ?, NULL, ?)").run(`email:${suppressed}@example.test`, "2026-11-08T16:00:00.000Z");
  const first = list(officer);
  const next = list(officer, { after: first.next });
  assert.deepEqual([...first.leads, ...next.leads].map(({ id }) => id), openIds.sort());
  assert.equal(next.next, null);
  for (const id of [held, owned, quote, suppressed]) assert.ok((await claim(officer, id)).error);
  assert.ok(changeBrokerage(db, id, admin, bootstrap, { type: "role", email: officer.email, role: "Processor" }).message);
  assert.ok(list(staff(officer)).error);
  assert.ok(changeBrokerage(db, id, admin, bootstrap, { type: "role", email: officer.email, role: "LO" }).message);
  assert.ok(list(staff(officer)).error);
  assert.ok((await claim(staff(officer), openIds[0])).error);
  assert.ok(changeBrokerage(db, id, admin, bootstrap, { type: "revoke", email: officer.email }).message);
  assert.ok(changeBrokerage(db, id, admin, bootstrap, { type: "invite", email: officer.email, role: "LO" }).message);
  activateBrokerages(db, officer, bootstrap);
  assert.ok(list(staff(officer)).error);
  assert.ok((await policy([officer.email], 1)).state);
  assert.equal(list(staff(officer)).leads.length, 20);
  assert.ok((await policy([], 2)).state);
  assert.ok(list(staff(officer)).error);
});

test("reports active waits and records exact pickup time across returns and reassignment", async (t) => {
  const { db, id, admin, staff, officer, second, lead, policy } = fixture(t);
  const owner = staff(admin);
  const token = "5".repeat(64);
  db.prepare("INSERT INTO realtor_portals (realtorId, token, expiresAt) VALUES ('partner', ?, '2099-01-01T00:00:00.000Z')").run(token);
  assert.ok((await policy([officer.email, second.email])).state);
  const date = (hhmm) => `2026-11-08T${hhmm}:00.000Z`;
  const report = (hhmm, input = {}) => readRealtorQueueReport(db, owner, id, { view: "Waiting", days: 7, ...input }, new Date(date(hhmm)));
  assert.ok(readRealtorQueueReport(db, officer, id, {}).error);
  assert.ok(readRealtorQueueReport(db, owner, "unrelated", {}).error);
  const ref = { type: "submit", token, requestId: crypto.randomUUID(), name: "Fictional timed prospect", email: "timed@example.test",
    phone: "", purpose: "Purchase", consent: true };
  assert.ok(realtorReferrals(db, ref, date("12:00")).value);
  const leadId = db.prepare("SELECT id FROM referral_leads WHERE requestId = ?").get(ref.requestId).id;
  assert.equal(report("12:10").waiting, 1);
  assert.equal(report("12:10").oldestWaitSeconds, 600);
  assert.equal(report("12:10").items[0].estimated, false);
  const claim = (member, at, target = leadId) => db.transaction(() => claimSharedRealtor(db, member, target, at));
  const assign = (email, previousEmail, at) => db.transaction(() => updateInboxLead(db, owner,
    { type: "assignInboxLead", leadId, email, previousEmail }, [officer, second], at));
  assert.ok(claim(officer, date("12:20")).message);
  assert.ok(claim(officer, date("12:21")).message);
  assert.ok(assign(second.email, officer.email, date("12:30")).message);
  const initial = report("12:35", { view: "Claim history" });
  assert.equal(initial.waiting, 0);
  assert.equal(initial.claims, 1);
  assert.equal(initial.items[0].officer, officer.name);
  assert.equal(initial.averageWaitSeconds, 1200);
  assert.ok(assign(null, second.email, date("13:00")).message);
  assert.equal(report("13:03").items[0].seconds, 180);
  assert.ok(claim(second, date("13:05")).message);
  const legacy = lead("Fictional legacy lead");
  assert.ok(claim(second, date("15:03"), legacy).message);
  const result = report("15:10", { view: "Claim history" });
  assert.equal(result.claims, 3);
  assert.equal(result.measuredClaims, 2);
  assert.equal(result.averageWaitSeconds, 750);
  assert.deepEqual(result.items.map(({ officer, seconds, estimated }) => [officer, seconds, estimated]),
    [[second.name, 180, true], [second.name, 300, false], [officer.name, 1200, false]]);
  assert.equal(readRealtorQueueReport(db, owner, id, { view: "Claim history", days: 7 }, new Date("2026-11-20T15:10:00Z")).claims, 0);
  assert.equal(readRealtorQueueReport(db, owner, id, { view: "Claim history", days: 30 }, new Date("2026-11-20T15:10:00Z")).claims, 3);
});

test("the manager queue pages oldest waits and marks outreach opt-outs", (t) => {
  const { db, id, admin, staff, lead } = fixture(t);
  const owner = staff(admin);
  const leads = Array.from({ length: 23 }, (_, i) => lead(`Fictional waiting ${i}`));
  const firstId = leads.toSorted()[0];
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', ?, NULL, '2026-11-08T16:00:00.000Z')").run(`lead:${firstId}`);
  const now = new Date("2026-11-09T15:00:00.000Z");
  const query = { view: "Waiting", days: 7 };
  const first = readRealtorQueueReport(db, owner, id, query, now);
  const second = readRealtorQueueReport(db, owner, id, { ...query, after: first.next }, now);
  assert.equal(first.waiting, 23);
  assert.equal(first.oldestWaitSeconds, 86400);
  assert.equal(first.items[0].contactStatus, "Outreach opted out");
  assert.deepEqual([...first.items, ...second.items].map(({ id }) => id), leads.toSorted());
  assert.equal(second.next, null);
});

test("a manager assigns a waiting referral without changing its deadline or overriding a claim", async (t) => {
  const { db, id, admin, staff, officer, second, lead, dueAt, policy } = fixture(t);
  const owner = staff(admin);
  const direct = lead("Fictional direct assignment");
  const claimed = lead("Fictional competing claim");
  const held = lead("Fictional held referral", { heldAt: "2026-11-08T15:10:00.000Z" });
  assert.ok((await policy([officer.email])).state);
  const now = new Date("2026-11-08T16:00:00.000Z");
  const report = (at = now) => readRealtorQueueReport(db, owner, id, { view: "Waiting", days: 7 }, at);
  const input = (item) => ({ leadId: item.leadId, waitingSince: item.at, officerEmail: second.email });
  const initial = report();
  const directInput = input(initial.items.find((item) => item.leadId === direct));
  const claimedInput = input(initial.items.find((item) => item.leadId === claimed));
  const assign = (target, at = now) => assignWaitingRealtor(db, owner, id, target, second, at);
  const record = (leadId) => ({ ...db.prepare("SELECT officerEmail, dueAt FROM referral_leads WHERE id = ?").get(leadId) });

  assert.ok(assignWaitingRealtor(db, officer, id, directInput, second, now).error);
  assert.ok(assignWaitingRealtor(db, owner, "other", directInput, second, now).error);
  assert.ok(assignWaitingRealtor(db, owner, id, directInput, null, now).error);
  assert.ok(assign({ ...directInput, leadId: held }).error);
  assert.match(assign(directInput).message, /deadline is unchanged/);
  assert.deepEqual(record(direct), { officerEmail: second.email, dueAt });
  assert.deepEqual(report().items.map((item) => item.leadId), [claimed]);
  assert.equal(report().claims, 0);
  assert.match(assign(directInput).error, /changed or left/);
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_access_history WHERE action = 'Assigned waiting realtor referral'").get().count, 1);

  assert.ok(db.transaction(() => claimSharedRealtor(db, officer, claimed, "2026-11-08T16:30:00.000Z")).message);
  const returned = new Date("2026-11-08T17:00:00.000Z");
  assert.match(assign(claimedInput, returned).error, /changed or left/);
  assert.deepEqual(record(claimed), { officerEmail: officer.email, dueAt });
  assert.ok(db.transaction(() => updateInboxLead(db, owner, { type: "assignInboxLead", leadId: claimed,
    email: null, previousEmail: officer.email }, [officer, second], returned.toISOString())).message);
  assert.match(assign(claimedInput, returned).error, /changed or left/);
  assert.ok(assign(input(report(returned).items[0]), returned).message);
  assert.deepEqual(record(claimed), { officerEmail: second.email, dueAt });
  assert.equal(report(returned).claims, 1);
});

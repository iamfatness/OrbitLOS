import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact } = await import("../src/lib/store.ts");
const { readLeadInbox } = await import("../src/lib/lead-inbox-query.ts");
const { leadEvent } = await import("../src/lib/lead-inbox.ts");
const { optOutContact } = await import("../src/lib/outreach-preferences.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { getApplication } = await import("../src/lib/applications.ts");

const at = "2026-11-09T12:00:00.000Z";
const staff = (role, email) => ({ name: `Fictional ${role}`, email, brokerage: { id: "fixture", role, pilot: true } });
const officer = staff("LO", "officer@example.test");
const other = staff("LO", "other@example.test");
const admin = staff("Admin", "owner@example.test");
const processor = staff("Processor", "processor@example.test");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  function lead({ id = crypto.randomUUID(), owner, realtor = null, email = "", dueAt = at, heldAt = null } = {}) {
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, zip, heldAt)
      VALUES (?, ?, ?, ?, ?, '', 'Purchase', ?, ?, ?, ?, '48304', ?)`)
      .run(id, id, realtor, `Fictional ${id}`, email, owner?.name ?? "", owner?.email ?? null, at, dueAt, heldAt);
    return id;
  }
  return { db, lead, read: (input, actor = officer) => readLeadInbox(db, input, actor, new Date(at)) };
}

test("inbox pages summaries by deadline and applies role, follow-up, hold, and suppression filters", (t) => {
  const { db, lead, read } = fixture(t);
  for (let i = 1; i <= 27; i++) lead({ id: `lead-${String(i).padStart(2, "0")}`, owner: officer });
  insertContact(db, { id: "realtor", name: "Fictional partner", email: "", phone: "", role: "Realtor" });
  insertContact(db, { id: "blocked", name: "Fictional opt-out", email: "blocked@example.test", phone: "", role: "Borrower" });
  lead({ id: "shared-realtor", realtor: "realtor" });
  lead({ id: "shared-web" });
  lead({ id: "other-owned", owner: other });
  lead({ id: "held", owner: officer, heldAt: at });
  lead({ id: "suppressed", owner: officer, email: "blocked@example.test" });
  lead({ id: "campaign-opted", owner: officer });
  lead({ id: "already-replied", owner: officer });
  lead({ id: "due-sequence", owner: officer, dueAt: "2026-11-10T12:00:00.000Z" });
  lead({ id: "due-campaign", owner: officer, dueAt: "2026-11-10T12:00:00.000Z" });
  db.prepare("INSERT INTO call_campaigns VALUES ('campaign', 'Fictional campaign', ?)").run(at);
  db.prepare("INSERT INTO call_campaign_members (leadId, campaignId, joinedAt, lastOutcome) VALUES ('campaign-opted', 'campaign', ?, 'Opted out'), ('due-campaign', 'campaign', ?, NULL)").run(at, at);
  db.prepare(`INSERT INTO lead_follow_up (leadId, status, nextAt, replyReceivedAt)
    VALUES ('already-replied', 'Stopped', NULL, ?), ('due-sequence', 'Active', ?, NULL), ('due-campaign', 'Active', ?, NULL)`).run(at, at, at);
  leadEvent(db, "lead-27", "Fictional LO", at, "Private test note");
  optOutContact(db, "blocked", at);
  const list = { type: "list", view: "All open" };
  const first = read(list);
  const second = read({ ...list, after: first.next });
  assert.equal(first.leads.length, 25);
  assert.equal(second.next, null);
  const visible = [...first.leads, ...second.leads].map(({ id }) => id);
  assert.equal(new Set(visible).size, visible.length);
  assert.ok(visible.includes("held") && visible.includes("campaign-opted") && visible.includes("shared-web"));
  assert.ok(!visible.includes("other-owned") && !visible.includes("shared-realtor"));
  assert.equal(first.overdue, 28);
  assert.equal(first.routing, null);
  assert.ok(read(list, admin).routing);
  assert.ok(read(list, processor).error);
  assert.deepEqual(read({ ...list, view: "On hold" }).leads.map(({ id }) => id), ["held"]);
  assert.deepEqual(read({ ...list, view: "Opted out" }).leads.map(({ id }) => id), ["campaign-opted", "suppressed"]);
  assert.deepEqual(read({ ...list, view: "Mock step due" }).leads.map(({ id }) => id), ["due-sequence"]);
  assert.deepEqual(read({ ...list, view: "Unassigned" }).leads.map(({ id }) => id), ["shared-web"]);
  assert.equal(read({ ...list, view: "First contact overdue" }).leads.length, 25);
  assert.ok(!JSON.stringify(first).includes("Private test note") && !("email" in first.leads[0]));
  assert.equal(read({ type: "open", id: "lead-27" }).lead.followUp.events[0].text, "Private test note");
  assert.ok(read({ type: "open", id: "other-owned" }).error);
  assert.ok(read({ type: "open", id: "shared-realtor" }).error);
});

test("inbox claim, outreach, archive, restore, and conversion preserve current access and a prefilled 1003", async (t) => {
  const { db, lead, read } = fixture(t);
  const id = lead({ email: "borrower@example.test" });
  const write = (actor, input) => executeCommand(db, input, actor, undefined, [], { scopedInboxUpdates: true, scopedLeadUpdates: true });
  const open = () => read({ type: "open", id }).lead;
  const claim = { type: "assignInboxLead", leadId: id, email: officer.email, previousEmail: null };
  const receipt = await write(officer, claim);
  assert.equal(receipt.inboxChanged, true);
  assert.equal(receipt.state, undefined);
  assert.equal(open().officerEmail, officer.email);
  assert.ok((await write(other, { ...claim, email: other.email })).error);
  assert.ok(read({ type: "open", id }, other).error);
  const contact = await write(officer, { type: "leadContact", leadId: id, revision: open().followUp.revision,
    channel: "Call", outcome: "Connected", note: "Fictional outreach completed." });
  assert.equal(contact.inboxChanged, true);
  assert.ok(open().followUp.firstContactAt);
  const archived = await write(officer, { type: "dismissReferral", referralId: id, revision: open().followUp.revision });
  assert.equal(archived.inboxChanged, true);
  assert.ok(read({ type: "open", id }).error);
  const archiveToken = db.prepare("SELECT archiveToken FROM referral_leads WHERE id = ?").get(id).archiveToken;
  assert.equal((await write(officer, { type: "restoreLead", leadId: id, archiveToken })).restoredLeadId, id);
  assert.ok(open().followUp.events.some(({ text }) => text.includes("Restored")));
  const converted = await write(officer, { type: "convertReferral", referralId: id, contactId: null, allowDuplicate: false });
  assert.equal(converted.inboxChanged, true);
  assert.equal(converted.state, undefined);
  assert.equal(converted.inboxLoan.loanId, converted.referralLoanId);
  const draft = JSON.parse(getApplication(db, converted.referralLoanId).draft);
  assert.equal(draft.email, "borrower@example.test");
  assert.equal(draft.propertyLocation.zip, "48304");
  assert.ok(read({ type: "open", id }).error);
});

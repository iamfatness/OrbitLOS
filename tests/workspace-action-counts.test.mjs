import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { readActionCounts } = await import("../src/lib/workspace-action-counts.ts");
const { readLeadInbox } = await import("../src/lib/lead-inbox-query.ts");
const { leadAttentionView } = await import("../src/lib/lead-inbox-model.ts");

test("sidebar counts follow staff scope and deduplicate incoming application work", (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const brokerageId = randomUUID();
  const staff = (name, role) => ({ name, email: `${name}@example.test`, brokerage: { id: brokerageId, role, pilot: true } });
  const lo = staff("officer", "LO"), other = staff("other", "LO"), admin = staff("owner", "Admin"), processor = staff("processor", "Processor");
  const now = new Date("2026-11-10T17:00:00.000Z"), at = now.toISOString();
  const tomorrow = "2026-11-11T17:00:00.000Z";
  const counts = (actor, workspace = brokerageId) => readActionCounts(db, actor, workspace, now);
  const lead = (name, owner, heldAt = null, resolvedAt = null) => {
    const id = randomUUID();
    db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, heldAt, resolvedAt)
      VALUES (?, ?, ?, ?, '', 'Purchase', ?, ?, ?, ?, ?, ?)`).run(id, id, name, `${id}@example.test`, owner?.name ?? "", owner?.email ?? null,
      at, tomorrow, heldAt, resolvedAt);
    return id;
  };
  const mine = lead("Fictional assigned first contact", lo);
  const shared = lead("Fictional unassigned first contact", null);
  const theirs = lead("Fictional other officer", other);
  lead("Fictional held", lo, at);
  lead("Fictional converted", lo, null, at);
  const contacted = lead("Fictional contacted", lo);
  const replied = lead("Fictional replied", lo);
  const optedOut = lead("Fictional opted out", lo);
  db.prepare("INSERT INTO lead_follow_up (leadId, firstContactAt) VALUES (?, ?)").run(contacted, at);
  db.prepare("INSERT INTO lead_follow_up (leadId, replyReceivedAt) VALUES (?, ?)").run(replied, at);
  db.prepare("INSERT INTO outreach_opt_outs VALUES ('fixture', ?, NULL, ?)").run(`lead:${optedOut}`, at);
  assert.deepEqual(counts(lo), { today: 0, leads: 1 });
  assert.deepEqual(counts(admin), { today: 0, leads: 3 });
  assert.deepEqual(readLeadInbox(db, { type: "list", view: leadAttentionView }, lo, now).leads.map(({ id }) => id), [mine]);
  assert.deepEqual(new Set(readLeadInbox(db, { type: "list", view: leadAttentionView }, admin, now).leads.map(({ id }) => id)),
    new Set([mine, shared, theirs]));
  assert.ok(counts(processor).error);
  assert.ok(counts(lo, randomUUID()).error);

  const loanId = randomUUID(), contactId = randomUUID();
  insertContact(db, { id: contactId, name: "Fictional borrower", email: "", phone: "", role: "Borrower" });
  insertLoan(db, { id: loanId, contactId, partnerId: null, officer: lo.name, officerEmail: lo.email,
    stage: "Application", stageSince: at, purpose: "Purchase", amount: 350000, address: "" });
  db.prepare(`INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt)
    VALUES (?, ?, '2099-01-01', '{}', ?, ?)`).run(loanId, randomUUID(), at, at);
  const task = db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, ?, ?)");
  task.run(`application-follow-up:${loanId}`, loanId, "Review the submitted 1003", at);
  const feeTask = randomUUID();
  task.run(feeTask, loanId, "Review disclosure package · Fees changed", at);
  task.run(randomUUID(), loanId, "Tomorrow's work", tomorrow);
  db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, status, requestedAt, submittedAt)
    VALUES (?, ?, 'Pay stub', '', 'Received', ?, ?)`).run(randomUUID(), loanId, at, at);
  db.prepare(`INSERT INTO contact_conversations (id, contactId, ownerEmail, ownerName, status, unread, updatedAt)
    VALUES (?, ?, ?, ?, 'Needs reply', 1, ?)`).run(randomUUID(), contactId, lo.email, lo.name, at);
  assert.deepEqual(counts(lo), { today: 4, leads: 1 });
  assert.deepEqual(counts(admin), { today: 0, leads: 3 });
  assert.deepEqual(counts(other), { today: 0, leads: 1 });
  db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ?").run(at, feeTask);
  db.prepare("INSERT INTO lead_follow_up (leadId, firstContactAt) VALUES (?, ?)").run(mine, at);
  assert.deepEqual(counts(lo), { today: 3, leads: 0 });
  for (let index = 0; index < 105; index++) {
    lead(`Fictional lead ${index}`, lo);
    task.run(randomUUID(), loanId, `Fictional task ${index}`, at);
  }
  assert.deepEqual(counts(lo), { today: 100, leads: 100 });
});

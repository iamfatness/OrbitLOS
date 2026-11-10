import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqliteStore } from "../scripts/workspace-baseline.mjs";

const { initializeStore, insertContact, insertLoan } = await import("../src/lib/store.ts");
const { readOwnerScorecard, changeOwnerScorecardSettings } = await import("../src/lib/owner-scorecard.ts");
const { readSalesDashboard } = await import("../src/lib/sales-dashboard.ts");
const { conditionTarget } = await import("../src/lib/uwm-alert-model.ts");
const { searchTaskTarget } = await import("../src/lib/workspace-search-model.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = sqliteStore(sqlite);
  initializeStore(db, false);
  const owner = "owner@example.test";
  const other = "other@example.test";
  const admin = { name: "Owner", email: owner, brokerage: { id: "fixture", role: "Admin" } };
  const now = new Date("2026-11-10T17:00:00.000Z");
  const filters = { from: "2026-11-01", through: "2026-11-30", owner: "" };
  const read = (query = {}, staff = admin, tenant = admin.brokerage.id) =>
    readOwnerScorecard(db, { kind: "summary", ...filters, ...query }, staff, tenant, now);
  const loan = (id, email, amount) => {
    insertContact(db, { id: `contact-${id}`, name: id, email: "", phone: "", role: "Borrower" });
    insertLoan(db, { id, contactId: `contact-${id}`, partnerId: null, officer: email === owner ? "Owner" : "Other",
      officerEmail: email, address: "", amount, purpose: "Purchase", stage: "Processing", stageSince: "2026-11-02T12:00:00.000Z" });
  };
  return { db, owner, other, admin, filters, read, loan, now };
}

test("owner scorecard reconciles campaign counts and dated funding separately from current work", (t) => {
  const { db, owner, other, admin, filters, read, loan, now } = fixture(t);
  loan("funded", owner, 450000);
  loan("projected", other, 300000);
  loan("outside", owner, 110000);
  db.exec(`INSERT INTO call_campaigns VALUES ('campaign', 'Fictional campaign', '2026-11-01T12:00:00.000Z');
    INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, resolvedAt, loanId)
      VALUES ('converted', 'converted', 'Converted', '', '', 'Purchase', 'Other', 'other@example.test', '2026-11-01T12:00:00.000Z',
        '2026-11-02T12:00:00.000Z', '2026-11-03T12:00:00.000Z', 'funded'),
      ('waiting', 'waiting', 'Waiting', '', '', 'Purchase', 'Other', 'other@example.test', '2026-11-02T12:00:00.000Z',
        '2026-11-03T12:00:00.000Z', NULL, NULL),
      ('paused', 'paused', 'Paused', '', '', 'Purchase', 'Other', 'other@example.test', '2026-11-02T12:00:00.000Z',
        '2026-11-03T12:00:00.000Z', NULL, NULL);
    UPDATE referral_leads SET heldAt = '2026-11-04T12:00:00.000Z' WHERE id = 'paused';
    INSERT INTO call_campaign_members (leadId, campaignId, joinedAt)
      VALUES ('converted', 'campaign', '2026-11-01T12:00:00.000Z'), ('waiting', 'campaign', '2026-11-02T12:00:00.000Z');
    INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt, submittedAt)
      VALUES ('funded', 'test', '2026-12-01', '{}', '2026-11-03', '2026-11-03T12:00:00.000Z');
    INSERT INTO closing_plans (loanId, targetDate) VALUES ('projected', '2026-11-18'), ('funded', '2026-11-09'), ('outside', '2026-12-07');
    INSERT INTO closing_progress (loanId, fundingDate) VALUES ('funded', '2026-11-09');
    INSERT INTO submissions (id, loanId, lender, externalId, status, conditions, syncedAt) VALUES ('receipt', 'projected', 'UWM',
      'MOCK-123', 'Approved with Conditions', '[{"id":"paystub","category":"Income"},{"id":"statement","category":"Assets"}]', '2026-11-06T14:00:00.000Z');
    INSERT INTO tasks (id, loanId, title, dueAt) VALUES ('application-follow-up:projected', 'projected', 'Follow up on 1003', '2026-11-04T14:00:00.000Z');`);

  const summary = read();
  const campaign = summary.sales.groups[0];
  assert.deepEqual([campaign.selected.leads, campaign.selected.submitted, campaign.selected.funded], [2, 1, 1]);
  const conversion = readSalesDashboard(db, { ...filters, kind: "records", channel: "Campaigns", metric: "funded", groupId: campaign.id,
    period: "selected" }, admin, admin.brokerage.id, now);
  assert.deepEqual(conversion.records.map(({ loanId }) => loanId), ["funded"]);
  assert.deepEqual(summary.counts, { followUps: 2, conditions: 1 });
  assert.deepEqual(summary.funding, { projected: { count: 1, volume: 300000 }, actual: { count: 1, volume: 450000 } });
  const work = (metric, query = {}) => read({ kind: "work", metric, ...query }).rows;
  assert.deepEqual(work("followUps").map(({ id, destination }) => [id, destination]), [
    ["waiting", { kind: "lead", leadId: "waiting", task: "lead" }],
    ["application-follow-up:projected", { kind: "loan", loanId: "projected", target: searchTaskTarget("application-follow-up:projected") }],
  ]);
  const [condition] = work("conditions");
  assert.equal(condition.conditionCount, 2);
  assert.deepEqual(condition.destination, { kind: "loan", loanId: "projected", target: conditionTarget("receipt", "paystub") });
  assert.deepEqual(work("projected").map(({ id }) => id), ["projected"]);
  assert.deepEqual(work("actual").map(({ id }) => id), ["funded"]);
  const ownerSummary = read({ owner: `email:${owner}` });
  assert.equal(ownerSummary.sales.periods.selected.funded, 1);
  assert.deepEqual(ownerSummary.counts, { followUps: 0, conditions: 0 });
  assert.deepEqual(work("conditions", { owner: `email:${other}` }).map(({ id }) => id), ["projected"]);
  assert.deepEqual(read({ from: "2026-10-01", through: "2026-10-31" }).counts, summary.counts);
  db.exec("UPDATE submissions SET conditions = '[]'; UPDATE closing_progress SET fundingDate = NULL;");
  assert.equal(read().counts.conditions, 0);
  assert.equal(read().funding.actual.count, 0);
});

test("owner scorecard saves a brokerage-only view and rejects out-of-scope reads and writes", (t) => {
  const { db, admin, filters, read } = fixture(t);
  const input = { type: "saveView", id: "fd983cc9-cf97-4d09-8845-0d624f21789b", name: "November", filters };
  const change = (request, staff = admin, tenant = admin.brokerage.id) => changeOwnerScorecardSettings(db, request, staff, tenant);
  for (const staff of [null, ...["LO", "Processor"].map((role) => ({ ...admin, brokerage: { ...admin.brokerage, role } }))]) {
    assert.ok(read({}, staff).error);
    assert.ok(read({ kind: "work", metric: "actual" }, staff).error);
    assert.ok(change(input, staff).error);
  }
  assert.ok(read({}, admin, "different").error);
  assert.ok(change(input, admin, "different").error);
  assert.ok(change(input).message);
  assert.ok(change(input).message);
  assert.deepEqual(read().views, [{ id: input.id, name: "November", filters }]);
  assert.ok(change({ ...input, id: "81713d60-79b8-4539-ace7-616400ce732b" }).error);
  assert.ok(change({ type: "removeView", id: input.id }).message);
  assert.deepEqual(read().views, []);
});
